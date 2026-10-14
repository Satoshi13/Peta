/* Coupons: a short name (THANKYOU) for a bundle the owner signed offline with peta-pass and stored with scripts/coupon.py.
   The app verifies the official signature itself and applies the bundle once per Mac; this only decides whether the name
   is open, counts Macs against an optional limit, and hands the same event back to a Mac that already claimed it. */
import { Env, fail, counter, stmt, assertion, batch } from "./index";

export function couponName(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const n = s.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,23}$/.test(n) ? n : null;
}
type Coupon = { event: string; starts_at: number | null; ends_at: number; max_claims: number | null; claims: number };
export async function coupons(request: Request, env: Env, path: string, hash: string, data: any): Promise<Response | null> {
  if (path !== "/v1/coupons/redeem") return null;
  if (request.method !== "POST") fail(405, "method_not_allowed");
  // Names are guessable words, so guessing is limited per Mac.
  await counter(env, hash, "coupon", 3600, 20);
  const name = couponName(data.name);
  if (!name) fail(400, "invalid");
  const c = await stmt(env.DB, "SELECT event,starts_at,ends_at,max_claims,claims FROM coupons WHERE name=? AND stopped_at IS NULL", name).first<Coupon>();
  if (!c) fail(404, "unknown_coupon");
  const t = Math.floor(Date.now() / 1000);
  if (await stmt(env.DB, "SELECT 1 FROM coupon_claims WHERE name=? AND key_hash=?", name, hash).first())
    return Response.json({ event: c.event });
  if (c.starts_at !== null && t < c.starts_at) fail(409, "coupon_not_started");
  if (t >= c.ends_at) fail(409, "coupon_ended");
  await batch(env.DB, [
    assertion(env.DB, "coupon_used_up", "EXISTS(SELECT 1 FROM coupons WHERE name=? AND (max_claims IS NULL OR claims<max_claims))", name),
    stmt(env.DB, "INSERT INTO coupon_claims VALUES(?,?,?)", name, hash, t),
    stmt(env.DB, "UPDATE coupons SET claims=claims+1 WHERE name=?", name),
  ]);
  return Response.json({ event: c.event });
}
