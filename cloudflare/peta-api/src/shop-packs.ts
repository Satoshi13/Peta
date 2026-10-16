import { sha256, utf8 } from './proofs';
import { fail, stmt, type Env } from './index';

/** At most this many official shop packs are on sale at once (the app shows up to 24 in the shop). */
export const MAX_LIVE = 24;
const TOKEN_SECONDS = 600;

type Live = { pack_id: string; version: number; size: number; sha256: string; ends_at: number | null };
/** Packs on sale now: started, not ended, not stopped; for each pack only the newest such version. */
export async function live(env: Env, now: number): Promise<Live[]> {
  const sale = (t: string) => `${t}.stopped_at IS NULL AND ${t}.removed_at IS NULL AND ${t}.starts_at IS NOT NULL AND ${t}.starts_at<=?1 AND (${t}.ends_at IS NULL OR ${t}.ends_at>?1)`;
  const rows = await stmt(env.DB,
    `SELECT pack_id,version,size,sha256,ends_at FROM shop_packs s WHERE ${sale('s')} AND version=(SELECT MAX(version) FROM shop_packs t WHERE t.pack_id=s.pack_id AND ${sale('t')}) ORDER BY pack_id LIMIT ?2`,
    now, MAX_LIVE).all<Live>();
  return rows.results;
}

/** The shop packs part of /v1/config: what is on sale and, for this Mac only, where to fetch each file for ten minutes. */
export async function listing(request: Request, env: Env, hash: string, now: number) {
  const packs = await live(env, now);
  if (!packs.length) return [];
  // One token covers this answer's files. It names no pack and no Mac; the stored hash binds it to this Mac's key.
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.batch([
    stmt(env.DB, 'DELETE FROM shop_pack_tokens WHERE expires_at<=?', now),
    stmt(env.DB, 'INSERT INTO shop_pack_tokens VALUES(?,?,?)', await sha256(utf8(token)), hash, now + TOKEN_SECONDS),
  ]);
  return packs.map(p => ({
    packId: p.pack_id, version: p.version, size: p.size, sha256: p.sha256, endsAt: p.ends_at,
    url: new URL(`/v1/shop-pack/${token}/${encodeURIComponent(p.pack_id)}/${p.version}`, request.url).href,
  }));
}

/** GET /v1/shop-pack/<token>/<packId>/<version>: the signed file, while the token is this Mac's and the pack is on sale. */
export async function shopPacks(request: Request, env: Env, path: string, hash: string): Promise<Response | null> {
  const match = /^\/v1\/shop-pack\/([a-f0-9]{64})\/([A-Za-z0-9][A-Za-z0-9_-]{0,39})\/([1-9][0-9]{0,8})$/.exec(path);
  if (!match) return null;
  if (request.method !== 'GET') fail(405, 'method');
  const now = Math.floor(Date.now() / 1000);
  const token = await stmt(env.DB, 'SELECT 1 AS ok FROM shop_pack_tokens WHERE token=? AND key_hash=? AND expires_at>?', await sha256(utf8(match[1])), hash, now).first<{ ok: number }>();
  if (!token) fail(403, 'shop_pack_expired');
  const pack = (await live(env, now)).find(p => p.pack_id === match[2] && p.version === Number(match[3]));
  if (!pack) fail(404, 'not_on_sale');
  const object = await env.RELEASES?.get(`shop/${pack.pack_id}/${pack.version}.peta`);
  if (!object || object.size !== pack.size) fail(404, 'not_found');
  return new Response(object.body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(object.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
