import { api, audit, fail, now, type Env } from "./index";
import { readEvent } from "./bundle";
import { checkPeriod, checkShop, iso, shopCatalog, signShop, withShopPacks } from "./settings";
import { signedForShop } from "./packs";
export async function shop(request: Request, env: Env, path: string, actor: string, data: any): Promise<Response | null> {
  if (!path.startsWith("/api/shop")) return null;
  const t = now(), catalog = withShopPacks(await signedForShop(env));
  if (request.method === "GET" && path === "/api/shop") {
    const rows = await env.DB.prepare("SELECT * FROM signed_configs WHERE kind='shop_config' ORDER BY created_at DESC,rowid DESC LIMIT 100").all<any>();
    return api({ catalog, configs: rows.results.map(r => {
      const p = readEvent(r.event)?.payload ?? {};
      return { id: r.id, kind: p.configKind ?? null, featured: p.featured ?? [], officialFirst: !!p.officialFirst, order: p.order ?? [], packs: p.packs ?? [], startsAt: r.starts_at, endsAt: r.ends_at, stoppedAt: r.stopped_at,
        state: r.stopped_at !== null ? "stopped" : t >= r.ends_at ? "ended" : t < r.starts_at ? "scheduled" : "active" };
    }) });
  }
  if (request.method !== "POST") fail(405, "method_not_allowed", "This action is not available.");
  if (path === "/api/shop/stop") {
    if (typeof data?.id !== "string" || !await env.DB.prepare("SELECT 1 FROM signed_configs WHERE id=? AND kind='shop_config'").bind(data.id).first()) fail(404, "not_found", "That shop setting wasn't found.");
    await env.DB.batch([env.DB.prepare("UPDATE signed_configs SET stopped_at=COALESCE(stopped_at,?) WHERE id=?").bind(t, data.id), audit(env.DB, actor, "shop.stopped", { id: data.id })]);
    return api({ stopped: true });
  }
  if (path !== "/api/shop") return api({ error: "not_found" }, 404);
  if (!["default", "event"].includes(data?.kind)) fail(400, "invalid", "Choose a standing setting or one for a period.");
  const kind = data.kind as "default" | "event", setting = checkShop(data, catalog);
  // A standing setting has no end the owner chooses; it is re-signed for the longest period the app accepts.
  const [start, end] = kind === "default" ? [t, t + shopCatalog.limits.maxDays * 86400] : checkPeriod(data.startsAt, data.endsAt, t);
  if (end - start > shopCatalog.limits.maxDays * 86400) fail(400, "invalid", "Choose a period of up to 400 days.");
  if (kind === "event" && Number((await env.DB.prepare("SELECT COUNT(*) n FROM signed_configs WHERE kind='shop_config' AND stopped_at IS NULL AND ends_at>?").bind(t).first<any>())?.n) >= shopCatalog.limits.maxConfigs - 1)
    fail(409, "limit", "Stop a shop setting before adding another.");
  const id = `shop-${kind}-${crypto.randomUUID()}`;
  const event = await signShop({ id, kind, issuedAt: iso(t), startsAt: iso(start), endsAt: iso(end), ...setting }, env.COUPON_KEY_ID ?? "", env.COUPON_SIGNING_KEY ?? "", env.COUPON_PUBLIC_KEY ?? "", catalog);
  // One standing setting at a time: the new one replaces the old.
  const standing = (await env.DB.prepare("SELECT id,event FROM signed_configs WHERE kind='shop_config' AND stopped_at IS NULL").all<any>()).results.filter(r => readEvent(r.event)?.payload?.configKind === "default").map(r => r.id);
  await env.DB.batch([
    ...(kind === "default" ? standing.map(old => env.DB.prepare("UPDATE signed_configs SET stopped_at=? WHERE id=?").bind(t, old)) : []),
    env.DB.prepare("INSERT INTO signed_configs(id,kind,starts_at,ends_at,event,created_at) VALUES(?,'shop_config',?,?,?,?)").bind(id, start, end, event, t),
    audit(env.DB, actor, "shop.created", { id, kind, startsAt: start, endsAt: end, ...setting }),
  ]);
  return api({ id }, 201);
}
