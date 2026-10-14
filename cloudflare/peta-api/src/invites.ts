/* Private beta invites. The download Worker (cloudflare/peta-download) issues one code per friend after Cloudflare Access;
   the app redeems it here with its signing key. With INVITE_REQUIRED="1", every other signed route refuses keys without
   a live invite, so a copied app cannot use online features. The app's own lock screen is only the friendly half of this. */
import { Env, fail, ok, counter, stmt, assertion, batch } from "./index";

export const invitesRequired = (env: Env) => env.INVITE_REQUIRED === "1";
/** Codes are shown as XXXXX-XXXXX; spaces, hyphens, case and the usual look-alikes are forgiven when typed. */
export function normalizeCode(s: unknown): string | null {
  if (typeof s !== "string" || s.length > 40) return null;
  const c = s.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(c) ? c : null;
}
export async function invited(env: Env, hash: string): Promise<boolean> {
  return !!(await stmt(env.DB, "SELECT 1 FROM invites WHERE key_hash=? AND revoked_at IS NULL", hash).first());
}
export async function invites(request: Request, env: Env, path: string, hash: string, data: any): Promise<Response | null> {
  if (path !== "/v1/invite") return null;
  if (request.method === "GET")
    return Response.json({ required: invitesRequired(env), active: !invitesRequired(env) || (await invited(env, hash)) });
  if (request.method !== "POST") fail(405, "method_not_allowed");
  // 50-bit codes plus this per-key limit keep guessing pointless.
  await counter(env, hash, "invite", 3600, 10);
  const code = normalizeCode(data.code);
  if (!code) fail(400, "invalid");
  const row = await stmt(env.DB, "SELECT key_hash FROM invites WHERE code=? AND revoked_at IS NULL", code).first<{ key_hash: string | null }>();
  if (!row) fail(404, "unknown_invite");
  if (row.key_hash === hash) return ok();
  if (row.key_hash) fail(409, "invite_used");
  const t = Math.floor(Date.now() / 1000);
  // A key holds at most one invite: redeeming a friend's new code moves this Mac to it. The assertion keeps a lost race atomic.
  await batch(env.DB, [
    assertion(env.DB, "invite_used", "EXISTS(SELECT 1 FROM invites WHERE code=? AND key_hash IS NULL AND revoked_at IS NULL)", code),
    stmt(env.DB, "UPDATE invites SET key_hash=NULL,bound_at=NULL WHERE key_hash=?", hash),
    stmt(env.DB, "UPDATE invites SET key_hash=?,bound_at=? WHERE code=?", hash, t, code),
  ]);
  return ok();
}
/** The privacy policy's one year: download records, finished coupons and their claims, operator actions, and paused
 *  invites are deleted a year after they stop mattering. Runs with the daily Cron. */
export async function sweepRecords(env: Env, timestamp: number): Promise<void> {
  const cutoff = timestamp - 365 * 86400;
  await env.DB.batch([
    stmt(env.DB, "DELETE FROM downloads WHERE at<?", cutoff),
    stmt(env.DB, "DELETE FROM coupon_claims WHERE name IN (SELECT name FROM coupons WHERE ends_at<? OR stopped_at<?)", cutoff, cutoff),
    stmt(env.DB, "DELETE FROM coupons WHERE ends_at<? OR stopped_at<?", cutoff, cutoff),
    stmt(env.DB, "DELETE FROM admin_log WHERE at<?", cutoff),
    stmt(env.DB, "DELETE FROM invites WHERE revoked_at IS NOT NULL AND revoked_at<?", cutoff),
  ]);
}
