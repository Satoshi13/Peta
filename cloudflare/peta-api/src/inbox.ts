/* S2: friends and the Gift inbox. Everything here is addressed by a mailbox id derived from its owner's signing key, and everything
   a friend sends is sealed on their Mac to the owner's sealing key: the server keeps addresses, allow lists and boxes it cannot open.
   Unopened requests and gifts expire after 7 days (R2 lifecycle for the gifts, a sweep on write for the index). */
import { Env, fail, ok, counter, stmt } from "./index";
import { base64, sha256, unbase64, utf8, verify } from "./proofs";

const DAY = 86400;
const TTL = 7 * DAY;
export const MAX_GIFT = 8 * 1024 * 1024 + 1024;
const MAX_REQUEST = 2048;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const limits = (env: Env) => ({
  pendingRequests: Number(env.PENDING_REQUESTS ?? 20),
  pendingFromOne: Number(env.PENDING_FROM_ONE ?? 3),
  requestsPerDay: Number(env.REQUESTS_PER_DAY ?? 10),
  pendingGifts: Number(env.PENDING_GIFTS ?? 50),
  giftsPerDay: Number(env.GIFTS_PER_DAY ?? 30),
});
const now = () => Math.floor(Date.now() / 1000);
const safe = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(s);
const isHash = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);

function base32(bytes: Uint8Array): string {
  let out = "", acc = 0, bits = 0;
  for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; out += ALPHABET[(acc >> bits) & 31]; } acc &= (1 << bits) - 1; }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}
/** The first 16 bytes of SHA-256 of the signing key, in the friend code's base32 (same as the app's `identity::mailbox_id`). */
export async function mailboxId(signKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", unbase64(signKey, 32)));
  return base32(digest.slice(0, 16));
}
export const keyHash = (key: string) => sha256(unbase64(key, 32));
export const bindingBytes = (enc: Uint8Array, name: string) => new Uint8Array([...utf8("peta.friend.v1"), ...enc, ...utf8(name)]);

async function sweep(env: Env) {
  const t = now();
  const gone = await stmt(env.DB, "SELECT mailbox_id,id FROM messages WHERE expires_at<? LIMIT 50", t).all<{ mailbox_id: string; id: string }>();
  for (const m of gone.results) await env.GIFTS?.delete(`${m.mailbox_id}/${m.id}`);
  await env.DB.batch([stmt(env.DB, "DELETE FROM messages WHERE expires_at<?", t), stmt(env.DB, "DELETE FROM friend_requests WHERE expires_at<?", t)]);
}
async function owner(env: Env, key: string, id: string) {
  if (id !== (await mailboxId(key))) fail(403, "not_yours");
  if (!(await stmt(env.DB, "SELECT 1 FROM mailboxes WHERE id=?", id).first())) fail(404, "unknown_mailbox");
}
async function mailbox(env: Env, id: string) {
  if (!(await stmt(env.DB, "SELECT 1 FROM mailboxes WHERE id=?", id).first())) fail(404, "unknown_mailbox");
}

/** Returns a response for an inbox path, or null when the path is not the inbox's. `data` is the parsed JSON body (empty for uploads). */
export async function inbox(request: Request, env: Env, path: string, key: string, body: Uint8Array, data: any): Promise<Response | null> {
  const method = request.method;
  if (path === "/v1/mailbox" && method === "POST") {
    const { signKey, encKey, name, binding } = data ?? {};
    if (signKey !== key) fail(403, "not_yours");
    if (typeof name !== "string" || utf8(name).length > 24 || typeof encKey !== "string" || typeof binding !== "string") fail(400, "invalid");
    let enc: Uint8Array;
    try { enc = unbase64(encKey, 32); } catch { fail(400, "invalid"); }
    if (!(await verify(key, bindingBytes(enc, name), binding))) fail(400, "bad_binding");
    const id = await mailboxId(key);
    // Idempotent; a restored key on a new Mac updates its own row (the same signing key signed the new sealing key).
    await env.DB.batch([stmt(env.DB, "INSERT INTO mailboxes VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enc_key=excluded.enc_key,name=excluded.name,binding=excluded.binding", id, key, encKey, name, binding, now())]);
    return Response.json({ id });
  }
  if (path === "/v1/report" && method === "POST") return report(env, key, data);
  const m = /^\/v1\/mailbox\/([0-9A-Z]{26})(?:\/(allow|requests|messages)(?:\/([A-Za-z0-9_-]{8,64}))?)?$/.exec(path);
  if (!m) return null;
  const [, id, part, item] = m;
  await sweep(env);
  if (!part) {
    if (method !== "DELETE") fail(405, "method_not_allowed");
    await owner(env, key, id);
    const all = await stmt(env.DB, "SELECT id FROM messages WHERE mailbox_id=?", id).all<{ id: string }>();
    for (const g of all.results) await env.GIFTS?.delete(`${id}/${g.id}`);
    await env.DB.batch([stmt(env.DB, "DELETE FROM mailboxes WHERE id=?", id)]);
    return ok();
  }
  if (part === "allow") {
    if (method !== "PUT" || item) fail(405, "method_not_allowed");
    await owner(env, key, id);
    const lists: Record<string, unknown> = data ?? {};
    const pick = (k: string) => { const v = lists[k] ?? []; if (!Array.isArray(v) || v.length > 200 || !v.every(isHash)) fail(400, "invalid"); return v as string[]; };
    const [add, remove, block, unblock] = ["add", "remove", "block", "unblock"].map(pick);
    await env.DB.batch([
      ...add.map((h) => stmt(env.DB, "INSERT OR IGNORE INTO mailbox_allow VALUES(?,?)", id, h)),
      ...remove.map((h) => stmt(env.DB, "DELETE FROM mailbox_allow WHERE mailbox_id=? AND key_hash=?", id, h)),
      ...block.map((h) => stmt(env.DB, "INSERT OR IGNORE INTO mailbox_blocks VALUES(?,?)", id, h)),
      ...block.map((h) => stmt(env.DB, "DELETE FROM mailbox_allow WHERE mailbox_id=? AND key_hash=?", id, h)),
      ...block.map((h) => stmt(env.DB, "DELETE FROM friend_requests WHERE mailbox_id=? AND sender_hash=?", id, h)),
      ...unblock.map((h) => stmt(env.DB, "DELETE FROM mailbox_blocks WHERE mailbox_id=? AND key_hash=?", id, h)),
    ]);
    return ok();
  }
  const sender = await keyHash(key);
  const L = limits(env);
  if (part === "requests") {
    if (method === "POST" && item) {
      await mailbox(env, id);
      if (await stmt(env.DB, "SELECT 1 FROM mailbox_blocks WHERE mailbox_id=? AND key_hash=?", id, sender).first()) fail(403, "blocked");
      const sealed = data?.sealed;
      if (typeof sealed !== "string" || sealed.length > Math.ceil(MAX_REQUEST / 3) * 4) fail(400, "invalid");
      try { unbase64(sealed); } catch { fail(400, "invalid"); }
      const same = await stmt(env.DB, "SELECT sender_hash,sealed FROM friend_requests WHERE mailbox_id=? AND id=?", id, item).first<{ sender_hash: string; sealed: string }>();
      if (same) { if (same.sender_hash !== sender || same.sealed !== sealed) fail(409, "taken"); return ok(); }
      const pending = await stmt(env.DB, "SELECT COUNT(*) AS n, SUM(sender_hash=?) AS mine FROM friend_requests WHERE mailbox_id=?", sender, id).first<{ n: number; mine: number }>();
      if (Number(pending?.n) >= L.pendingRequests || Number(pending?.mine) >= L.pendingFromOne) fail(429, "mailbox_full");
      await counter(env, sender, "requests", DAY, L.requestsPerDay);
      await env.DB.batch([stmt(env.DB, "INSERT INTO friend_requests VALUES(?,?,?,?,?,?)", id, item, sender, sealed, now(), now() + TTL)]);
      return ok();
    }
    await owner(env, key, id);
    if (method === "GET" && !item) {
      const rows = await stmt(env.DB, "SELECT id,sender_hash AS senderHash,sealed,created_at AS createdAt FROM friend_requests WHERE mailbox_id=? ORDER BY created_at", id).all();
      return Response.json({ requests: rows.results });
    }
    if (method === "DELETE" && item) { await env.DB.batch([stmt(env.DB, "DELETE FROM friend_requests WHERE mailbox_id=? AND id=?", id, item)]); return ok(); }
    fail(405, "method_not_allowed");
  }
  // messages: sealed gifts in R2
  if (method === "POST" && item) {
    await mailbox(env, id);
    if (await stmt(env.DB, "SELECT 1 FROM mailbox_blocks WHERE mailbox_id=? AND key_hash=?", id, sender).first()) fail(403, "blocked");
    if (!(await stmt(env.DB, "SELECT 1 FROM mailbox_allow WHERE mailbox_id=? AND key_hash=?", id, sender).first())) fail(403, "not_allowed");
    if (body.length < 48 || body.length > MAX_GIFT) fail(413, "too_large");
    const same = await stmt(env.DB, "SELECT sender_hash,size FROM messages WHERE mailbox_id=? AND id=?", id, item).first<{ sender_hash: string; size: number }>();
    if (same) { if (same.sender_hash !== sender || same.size !== body.length) fail(409, "taken"); return ok(); }
    const pending = await stmt(env.DB, "SELECT COUNT(*) AS n FROM messages WHERE mailbox_id=?", id).first<{ n: number }>();
    if (Number(pending?.n) >= L.pendingGifts) fail(429, "mailbox_full");
    await counter(env, sender, "gifts", DAY, L.giftsPerDay);
    if (!env.GIFTS) fail(503, "unavailable");
    await env.GIFTS.put(`${id}/${item}`, body);
    await env.DB.batch([stmt(env.DB, "INSERT INTO messages VALUES(?,?,?,?,?,?)", id, item, sender, body.length, now(), now() + TTL)]);
    return ok();
  }
  if (method === "DELETE" && item) {
    // The owner after picking it up, or the sender taking back a gift that was not picked up yet.
    const row = await stmt(env.DB, "SELECT sender_hash FROM messages WHERE mailbox_id=? AND id=?", id, item).first<{ sender_hash: string }>();
    const mine = id === (await mailboxId(key));
    if (!mine && row?.sender_hash !== sender) fail(403, "not_yours");
    if (row) { await env.GIFTS?.delete(`${id}/${item}`); await env.DB.batch([stmt(env.DB, "DELETE FROM messages WHERE mailbox_id=? AND id=?", id, item)]); }
    return ok();
  }
  await owner(env, key, id);
  if (method === "GET" && !item) {
    const rows = await stmt(env.DB, "SELECT id,sender_hash AS senderHash,size,created_at AS createdAt FROM messages WHERE mailbox_id=? ORDER BY created_at", id).all();
    return Response.json({ messages: rows.results });
  }
  if (method === "GET" && item) {
    if (!(await stmt(env.DB, "SELECT 1 FROM messages WHERE mailbox_id=? AND id=?", id, item).first())) fail(404, "unknown");
    const object = await env.GIFTS?.get(`${id}/${item}`);
    if (!object) fail(404, "unknown");
    return new Response(object.body, { headers: { "Content-Type": "application/octet-stream" } });
  }
  fail(405, "method_not_allowed");
}

/* A report, made only when the recipient agrees: the opened gift and its sender go to a private bucket for the owner to look at.
   The owner is told how many reports wait, never what they hold. */
async function report(env: Env, key: string, data: any) {
  const { senderHash, reason, gift } = data ?? {};
  if (!isHash(senderHash) || typeof reason !== "string" || reason.length < 1 || reason.length > 200 || typeof gift !== "string") fail(400, "invalid");
  let bytes: Uint8Array;
  try { bytes = unbase64(gift); } catch { fail(400, "invalid"); }
  if (bytes.length > MAX_GIFT) fail(413, "too_large");
  if (!env.REPORTS) fail(503, "unavailable");
  const reporter = await keyHash(key), id = base64(crypto.getRandomValues(new Uint8Array(12))).replace(/[+/=]/g, "").slice(0, 16);
  await env.REPORTS.put(`reports/${id}.json`, JSON.stringify({ id, reporter, senderHash, reason, gift, at: new Date().toISOString() }));
  await env.DB.batch([stmt(env.DB, "INSERT INTO reports VALUES(?,?,?,?,?)", id, reporter, senderHash, reason, now())]);
  if (env.REPORT_WEBHOOK) {
    const open = await stmt(env.DB, "SELECT COUNT(*) AS n FROM reports").first<{ n: number }>();
    try { await fetch(env.REPORT_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `Peta: a new report (${id}). ${Number(open?.n)} on file.` }) }); } catch { /* the report is kept even if the note fails */ }
  }
  return Response.json({ id });
}
