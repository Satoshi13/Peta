import { api, audit, fail, now, type Env } from "./index";
import { unbase64 } from "./bundle";
/* Reports a friend agreed to send. People are shown only by the first 8 characters of a key hash: the server has no names.
   Pictures leave as base64 PNG data that the page shows through blob: URLs; nothing here is ever served as HTML. */
const ID = /^[a-f0-9]{64}$/, SHORT = /^[a-f0-9]{8}$/;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_PICTURES = 24, MAX_TEXT = 1000;
type Picture = { label: string; png: string };
type Line = { label: string; value: string };
export type Contents = { readable: boolean; pictures: Picture[]; lines: Line[] };
/** Chunked: spreading a large picture into String.fromCharCode would overflow the stack. */
function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
const png = (bytes: Uint8Array) => bytes.length > PNG.length && PNG.every((b, i) => bytes[i] === b);
const clip = (value: unknown) => typeof value === "string" ? [...value].slice(0, MAX_TEXT).join("") : "";
function line(lines: Line[], label: string, value: unknown) { const text = clip(value).trim(); if (text) lines.push({ label, value: text }); }
/** `MAGIC · version · u32 BE header length · header JSON · body · (Ed25519 signature 64)`. Display only: nothing is trusted. */
function frame(bytes: Uint8Array, magic: string, signed: boolean): { version: number; header: any; body: Uint8Array } | null {
  if (bytes.length < 13 || new TextDecoder().decode(bytes.slice(0, 8)) !== magic) return null;
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(9, false), end = bytes.length - (signed ? 64 : 0);
  if (n < 1 || n > 1024 * 1024 || 13 + n > end) return null;
  try { return { version: bytes[8], header: JSON.parse(new TextDecoder().decode(bytes.slice(13, 13 + n))), body: bytes.slice(13 + n, end) }; } catch { return null; }
}
function pictures(body: Uint8Array, parts: { label: string; png: number; mask: number }[], out: Picture[]) {
  let at = 0;
  for (const part of parts) {
    if (!Number.isSafeInteger(part.png) || !Number.isSafeInteger(part.mask) || part.png < 1 || part.mask < 0 || at + part.png + part.mask > body.length) return false;
    const image = body.slice(at, at + part.png); at += part.png + part.mask;
    if (!png(image)) return false;
    if (out.length < MAX_PICTURES) out.push({ label: clip(part.label).slice(0, 80), png: base64(image) });
  }
  return true;
}
export function giftContents(bytes: Uint8Array): Contents {
  const out: Contents = { readable: false, pictures: [], lines: [] };
  const official = frame(bytes, "PETAEVNT", true);
  if (official) {
    const h = official.header;
    line(out.lines, "Title", h?.title); line(out.lines, "Message", h?.message);
    out.readable = Array.isArray(h?.attachments) && pictures(official.body, h.attachments.map((a: any) => ({ label: "Sticker", png: a?.pngLen, mask: a?.maskLen ?? 0 })), out.pictures);
    return out;
  }
  const gift = bytes[8] === 1 ? frame(bytes, "PETAGIFT", false) : frame(bytes, "PETAGIFT", true);
  if (!gift) return out;
  const h = gift.header;
  line(out.lines, "Signed as", h?.from); line(out.lines, "Written to", h?.to); line(out.lines, "Note", h?.note); line(out.lines, "Sent", h?.sentAt);
  out.readable = pictures(gift.body, [{ label: "Sticker", png: h?.pngLen, mask: h?.maskLen ?? 0 }], out.pictures);
  return out;
}
export function listingContents(card: Uint8Array | null, pack: Uint8Array | null): Contents {
  const out: Contents = { readable: false, pictures: [], lines: [] };
  try {
    const c = card ? JSON.parse(new TextDecoder().decode(card)) : null;
    if (c && typeof c === "object") {
      line(out.lines, "Card title", c.title); line(out.lines, "Card line", c.blurb);
      const names = [...(Array.isArray(c.designs) ? c.designs : []), ...(Array.isArray(c.prizes) ? c.prizes : [])].map((d: any) => clip(d?.name)).filter(Boolean);
      line(out.lines, "Inside", names.join(" · "));
      for (const p of Array.isArray(c.peek) ? c.peek.slice(0, 3) : []) {
        try { const image = unbase64(String(p?.png)); if (png(image)) out.pictures.push({ label: `Card · ${clip(p?.name).slice(0, 80)}`, png: base64(image) }); } catch { /* A damaged peek is skipped. */ }
      }
      out.readable = true;
    }
  } catch { /* The card is shown as unreadable. */ }
  const p = pack ? frame(pack, "PETAPACK", true) : null;
  if (p && Array.isArray(p.header?.items)) {
    line(out.lines, "Pack title", p.header.title); line(out.lines, "Pack author", p.header.author); line(out.lines, "Pack line", p.header.blurb);
    out.readable = pictures(p.body, p.header.items.map((i: any) => ({ label: i?.name, png: i?.pngLen, mask: i?.maskLen ?? 0 })), out.pictures) || out.readable;
  } else if (pack) line(out.lines, "Pack", "The pack file couldn't be read.");
  return out;
}
async function contents(env: Env, id: string, kind: string): Promise<Contents | null> {
  const object = await env.REPORTS.get(`reports/${id}.json`);
  if (!object) return null;
  let saved: any;
  try { saved = await object.json(); } catch { return { readable: false, pictures: [], lines: [] }; }
  const decode = (value: unknown) => { try { return typeof value === "string" ? unbase64(value) : null; } catch { return null; } };
  if (kind === "listing") return listingContents(decode(saved?.card), decode(saved?.pack));
  const gift = decode(saved?.gift);
  return gift ? giftContents(gift) : { readable: false, pictures: [], lines: [] };
}
function reasonText(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason || [...reason].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(reason)) fail(400, "invalid", "Write a short reason, up to 200 characters.");
  return reason;
}
const COLUMNS = "r.id,r.reason,r.kind,r.listing_id AS listingId,r.created_at AS createdAt,r.resolved_at AS resolvedAt,r.stored,substr(r.sender_hash,1,8) AS sender,substr(r.reporter_hash,1,8) AS reporter,(SELECT COUNT(*) FROM reports x WHERE x.sender_hash=r.sender_hash) AS senderReports,(SELECT COUNT(*) FROM reports x WHERE x.sender_hash=r.sender_hash AND x.resolved_at IS NULL) AS senderOpen,EXISTS(SELECT 1 FROM blocked_keys b WHERE b.key_hash=r.sender_hash) AS senderBlocked";
export async function reports(request: Request, env: Env, path: string, actor: string, data: any): Promise<Response | null> {
  if (!path.startsWith("/api/reports")) return null;
  const detail = /^\/api\/reports\/([a-f0-9]{64})$/.exec(path);
  if (request.method === "GET") {
    if (path === "/api/reports") {
      const [open, rows, blocked] = await env.DB.batch([
        env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE resolved_at IS NULL"),
        env.DB.prepare(`SELECT ${COLUMNS} FROM reports r ORDER BY (r.resolved_at IS NULL) DESC,r.created_at DESC,r.id LIMIT 200`),
        env.DB.prepare("SELECT substr(key_hash,1,8) AS key,reason,at,(SELECT COUNT(*) FROM reports WHERE sender_hash=key_hash) AS reports FROM blocked_keys ORDER BY at DESC,key_hash LIMIT 200"),
      ]);
      return api({ open: Number((open.results[0] as any)?.n ?? 0), reports: rows.results.map((r: any) => ({ ...r, stored: !!r.stored, senderBlocked: !!r.senderBlocked })), blocked: blocked.results });
    }
    if (!detail) return api({ error: "not_found" }, 404);
    const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM reports r WHERE r.id=?`).bind(detail[1]).first<any>();
    if (!row) fail(404, "not_found", "That report wasn't found. It may have been deleted 30 days after it was resolved.");
    // R2 holds the contents until 30 days after resolution; an unfinished upload never had any.
    const found = row.stored ? await contents(env, row.id, row.kind) : null;
    return api({ ...row, stored: !!row.stored, senderBlocked: !!row.senderBlocked, available: !!found, contents: found });
  }
  if (request.method !== "POST") fail(405, "method_not_allowed", "This action is not available.");
  const t = now();
  if (path === "/api/reports/resolve" || path === "/api/reports/block") {
    if (typeof data?.id !== "string" || !ID.test(data.id)) fail(404, "not_found", "That report wasn't found.");
    const row = await env.DB.prepare("SELECT id,sender_hash,resolved_at FROM reports WHERE id=?").bind(data.id).first<{ id: string; sender_hash: string; resolved_at: number | null }>();
    if (!row) fail(404, "not_found", "That report wasn't found.");
    if (data?.confirm !== true) fail(400, "confirm", "Confirm this action first.");
    if (path.endsWith("resolve")) {
      if (row.resolved_at !== null) return api({ resolved: true, resolvedAt: row.resolved_at });
      await env.DB.batch([env.DB.prepare("UPDATE reports SET resolved_at=? WHERE id=? AND resolved_at IS NULL").bind(t, row.id), audit(env.DB, actor, "report.resolved", { reportId: row.id })]);
      return api({ resolved: true, resolvedAt: t });
    }
    const reason = reasonText(data.reason), resolveOpen = data.resolveOpen === true;
    const open = resolveOpen ? Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE sender_hash=? AND resolved_at IS NULL").bind(row.sender_hash).first<any>())?.n ?? 0) : 0;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO blocked_keys(key_hash,reason,at) VALUES(?,?,?) ON CONFLICT(key_hash) DO UPDATE SET reason=excluded.reason,at=excluded.at").bind(row.sender_hash, reason, t),
      ...(resolveOpen ? [env.DB.prepare("UPDATE reports SET resolved_at=? WHERE sender_hash=? AND resolved_at IS NULL").bind(t, row.sender_hash)] : []),
      audit(env.DB, actor, "report.sender_blocked", { reportId: row.id, keyHash: row.sender_hash, reason, resolved: open }),
    ]);
    return api({ blocked: true, resolved: open });
  }
  if (path === "/api/reports/unblock") {
    if (typeof data?.key !== "string" || !SHORT.test(data.key)) fail(404, "not_found", "That blocked sender wasn't found.");
    const rows = await env.DB.prepare("SELECT key_hash FROM blocked_keys WHERE substr(key_hash,1,8)=? LIMIT 2").bind(data.key).all<{ key_hash: string }>();
    if (!rows.results.length) fail(404, "not_found", "That blocked sender wasn't found. Refresh and try again.");
    // 8 hex characters are 32 bits; refuse rather than guess if two blocked keys ever share them.
    if (rows.results.length > 1) fail(409, "ambiguous", "Two blocked senders share this short code. Unblock with Wrangler instead.");
    if (data?.confirm !== true) fail(400, "confirm", "Confirm this action first.");
    const key = rows.results[0].key_hash;
    await env.DB.batch([env.DB.prepare("DELETE FROM blocked_keys WHERE key_hash=?").bind(key), audit(env.DB, actor, "report.sender_unblocked", { keyHash: key })]);
    return api({ unblocked: true });
  }
  return api({ error: "not_found" }, 404);
}
