import { api, audit, fail, now, type Env } from "./index";
import { checkGrants, CATALOG, readEvent, signBundle } from "./bundle";
import { couponName } from "../../peta-api/src/coupons";
type Coupon = { name: string; event: string; starts_at: number | null; ends_at: number; max_claims: number | null; claims: number; created_at: number; stopped_at: number | null };
export function state(c: Coupon, t = now()) {
  return c.stopped_at !== null ? "stopped" : t >= c.ends_at ? "ended" : c.max_claims !== null && c.claims >= c.max_claims ? "used up" : c.starts_at !== null && t < c.starts_at ? "not yet" : "open";
}
export async function coupons(request: Request, env: Env, path: string, actor: string, data: any): Promise<Response | null> {
  if (!path.startsWith("/api/coupons")) return null;
  if (path === "/api/coupons" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM coupons ORDER BY created_at DESC,name").all<Coupon>();
    return api({ catalog: CATALOG, coupons: rows.results.map(c => {
      const event = readEvent(c.event);
      return { name: c.name, items: Array.isArray(event?.payload?.items) ? event.payload.items : [], title: typeof event?.title === "string" ? event.title : "From Peta", message: typeof event?.message === "string" ? event.message : "", startsAt: c.starts_at, endsAt: c.ends_at, claims: c.claims, maxClaims: c.max_claims, state: state(c), readable: !!event };
    }) });
  }
  if (request.method !== "POST") fail(405, "method_not_allowed", "This action is not available.");
  if (path === "/api/coupons") {
    const name = couponName(data?.name);
    if (!name) fail(400, "invalid", "Use a coupon name of 3–24 letters, digits or hyphens.");
    const items = checkGrants(data.items), t = now();
    const start = data.startsAt ?? t, end = data.endsAt, limit = data.maxClaims ?? null;
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end <= start || end <= t || end > 7258118400)
      fail(400, "invalid", "Choose an end after the start and after now.");
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000000)) fail(400, "invalid", "Choose between 1 and 1,000,000 Macs, or leave it blank.");
    const title = typeof data.title === "string" ? data.title.trim() : "From Peta", message = data.message ?? "";
    if (!title || [...title].length > 120 || /[\u0000-\u001f\u007f-\u009f]/.test(title) || typeof message !== "string" || [...message].length > 1000)
      fail(400, "invalid", "Use a title up to 120 characters and a message up to 1000.");
    if (await env.DB.prepare("SELECT 1 FROM coupons WHERE name=?").bind(name).first()) fail(409, "duplicate", "That coupon name has already been used.");
    const iso = (seconds: number) => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
    const eventId = `cpn-${name.toLowerCase()}-${iso(t).replace(/[-:T]/g, "").slice(0, 12)}`;
    const event = await signBundle({ eventId, issuedAt: iso(t), notBefore: iso(start), notAfter: iso(end), title, message, items }, env.COUPON_KEY_ID ?? "", env.COUPON_SIGNING_KEY ?? "");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO coupons(name,event,starts_at,ends_at,max_claims,created_at) VALUES(?,?,?,?,?,?)").bind(name, event, start, end, limit, t),
      audit(env.DB, actor, "coupon.created", { name, eventId, items, startsAt: start, endsAt: end, maxClaims: limit }),
    ]);
    return api({ name, items, title, message, startsAt: start, endsAt: end, maxClaims: limit }, 201);
  }
  if (path === "/api/coupons/stop-all") {
    if (data?.confirm !== true) fail(400, "confirm", "Confirm stopping all coupons.");
    await env.DB.batch([env.DB.prepare("UPDATE coupons SET stopped_at=? WHERE stopped_at IS NULL").bind(now()), audit(env.DB, actor, "coupon.stopped_all")]);
    return api({ stopped: true });
  }
  if (path === "/api/coupons/stop") {
    const name = couponName(data?.name);
    if (!name || !await env.DB.prepare("SELECT 1 FROM coupons WHERE name=?").bind(name).first()) fail(404, "not_found", "That coupon wasn't found.");
    await env.DB.batch([env.DB.prepare("UPDATE coupons SET stopped_at=COALESCE(stopped_at,?) WHERE name=?").bind(now(), name), audit(env.DB, actor, "coupon.stopped", { name })]);
    return api({ stopped: true });
  }
  return api({ error: "not_found" }, 404);
}
