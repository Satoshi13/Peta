import { api, audit, fail, now, type Env } from "./index";
import { readEvent } from "./bundle";
import { checkAnnouncement, checkPeriod, iso, signAnnouncement } from "./settings";
const LIVE = 10;
export async function news(request: Request, env: Env, path: string, actor: string, data: any): Promise<Response | null> {
  if (!path.startsWith("/api/news")) return null;
  const t = now();
  if (request.method === "GET" && path === "/api/news") {
    const rows = await env.DB.prepare("SELECT * FROM signed_configs WHERE kind='announcement' ORDER BY created_at DESC,rowid DESC LIMIT 100").all<any>();
    return api({ news: rows.results.map(r => {
      const p = readEvent(r.event)?.payload ?? {};
      return { id: r.id, text: typeof p.text === "string" ? p.text : "", kind: p.kind ?? null, link: p.link ?? null, startsAt: r.starts_at, endsAt: r.ends_at, stoppedAt: r.stopped_at,
        state: r.stopped_at !== null ? "stopped" : t >= r.ends_at ? "ended" : t < r.starts_at ? "scheduled" : "live" };
    }) });
  }
  if (request.method !== "POST") fail(405, "method_not_allowed", "この操作は利用できません。");
  if (path === "/api/news/stop") {
    if (typeof data?.id !== "string" || !await env.DB.prepare("SELECT 1 FROM signed_configs WHERE id=? AND kind='announcement'").bind(data.id).first()) fail(404, "not_found", "お知らせが見つかりません。");
    await env.DB.batch([env.DB.prepare("UPDATE signed_configs SET stopped_at=COALESCE(stopped_at,?) WHERE id=?").bind(t, data.id), audit(env.DB, actor, "news.stopped", { id: data.id })]);
    return api({ stopped: true });
  }
  if (path !== "/api/news") return api({ error: "not_found" }, 404);
  const notice = checkAnnouncement(data), [start, end] = checkPeriod(data?.startsAt ?? t, data?.endsAt, t);
  // The app reads at most ten; keep the owner within what will actually arrive.
  if (Number((await env.DB.prepare("SELECT COUNT(*) n FROM signed_configs WHERE kind='announcement' AND stopped_at IS NULL AND ends_at>?").bind(t).first<any>())?.n) >= LIVE)
    fail(409, "limit", "公開中・予定のお知らせは10件までです。別のお知らせを停止してください。");
  const id = `news-${crypto.randomUUID()}`;
  const event = await signAnnouncement({ id, issuedAt: iso(t), startsAt: iso(start), endsAt: iso(end), ...notice }, env.COUPON_KEY_ID ?? "", env.COUPON_SIGNING_KEY ?? "", env.COUPON_PUBLIC_KEY ?? "");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO signed_configs(id,kind,starts_at,ends_at,event,created_at) VALUES(?,'announcement',?,?,?,?)").bind(id, start, end, event, t),
    audit(env.DB, actor, "news.created", { id, kind: notice.kind, link: notice.link, startsAt: start, endsAt: end }),
  ]);
  return api({ id }, 201);
}
