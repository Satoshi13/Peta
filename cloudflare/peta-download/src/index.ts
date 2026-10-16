/* The friends-only download page. Every request (page, API and disk image) passes Cloudflare Access and is re-checked here.
   The disk image lives in a private R2 bucket with no public URL; releases/latest.json, written last by
   scripts/publish-release.sh, says which file is current. Invites are shared with peta-api through the same D1 database. */
import {validUpdate,versionParts} from "../../shared/update-manifest";
import { emailHash } from "../../shared/identity";
export { emailHash } from "../../shared/identity";
import { accessEmail, fetchKeys, KeySource, AccessConfig } from "./access";

export interface Env extends AccessConfig {
  ASSETS: Fetcher;
  DB: D1Database;
  RELEASES: R2Bucket;
}
export interface Release {
  update?: {version:string;file:string;signature:string;notes?:string};
  version: string;
  file: string;
  size: number;
  sha256: string;
  minimumSystemVersion: string;
  architectures: string[];
  publishedAt: string;
  /** false when built without the Apple Developer Program (release-mac.sh --unsigned); the page then explains Open Anyway. */
  notarized?: boolean;
}

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SECURITY = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
function respond(body: BodyInit | null, init: ResponseInit & { headers?: Record<string, string> } = {}, cache = "private, no-store") {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
  headers.set("Cache-Control", cache);
  return new Response(body, { ...init, headers });
}
const api = (data: unknown, status = 200) => respond(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const now = () => Math.floor(Date.now() / 1000);

export function newCode(): string {
  // 50 random bits, Crockford base32 (the app's friend-code alphabet).
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  let out = "", acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  for (let i = 0; i < 10; i++) out += ALPHABET[Number((acc >> BigInt(51 - 5 * i)) & 31n)];
  return out;
}
const shown = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`;

type Invite = { code: string; key_hash: string | null; bound_at: number | null; revoked_at: number | null };
async function invite(env: Env, hash: string): Promise<Invite> {
  for (let tries = 0; ; tries++) {
    const row = await env.DB.prepare("SELECT code,key_hash,bound_at,revoked_at FROM invites WHERE email_hash=?").bind(hash).first<Invite>();
    if (row) return row;
    try {
      await env.DB.prepare("INSERT INTO invites(email_hash,code,created_at) VALUES(?,?,?) ON CONFLICT(email_hash) DO NOTHING").bind(hash, newCode(), now()).run();
    } catch (e) {
      if (tries > 3) throw e; // a code collision; draw again
    }
  }
}
async function swap(env: Env, hash: string): Promise<void> {
  for (let tries = 0; ; tries++) {
    try {
      await env.DB.prepare("UPDATE invites SET code=?,key_hash=NULL,bound_at=NULL WHERE email_hash=? AND revoked_at IS NULL").bind(newCode(), hash).run();
      return;
    } catch (e) {
      if (tries > 3) throw e;
    }
  }
}
export function validRelease(r: unknown): r is Release {
  const v = r as Release;
  return !!v && !!versionParts(v.version) &&
    typeof v.file === "string" && /^[A-Za-z0-9._-]{1,80}\.dmg$/.test(v.file) &&
    Number.isSafeInteger(v.size) && v.size > 0 && typeof v.sha256 === "string" && /^[a-f0-9]{64}$/.test(v.sha256) &&
    typeof v.minimumSystemVersion === "string" && /^\d+(?:\.\d+){0,2}$/.test(v.minimumSystemVersion) &&
    Array.isArray(v.architectures) && v.architectures.every((a) => a === "arm64" || a === "x86_64") &&
    typeof v.publishedAt === "string" && (v.notarized === undefined || typeof v.notarized === "boolean") && (v.update === undefined || validUpdate(v));
}
async function release(env: Env): Promise<Release | null> {
  const o = await env.RELEASES.get("releases/latest.json");
  if (!o) return null;
  try {
    const r = await o.json();
    return validRelease(r) ? r : null;
  } catch {
    return null;
  }
}
const DENIED = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Peta</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f8f4eb;color:#2d2c29;font:15px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:16px"><div><p style="font:10px ui-monospace,monospace;letter-spacing:.16em;color:#7d776b">PETA FOR MAC · BY INVITATION</p><h1 style="font-weight:560;letter-spacing:-.04em;margin:0 0 8px">This page is for invited friends.</h1><p style="color:#6b655b;margin:0">Sign in with the email address you were invited with.</p></div></body></html>`;

async function download(request: Request, env: Env, file: string, hash: string): Promise<Response> {
  const r = await release(env);
  if (!r || r.file !== file) return respond("Not found", { status: 404 });
  const range = request.headers.get("Range");
  const object = await env.RELEASES.get(`releases/${file}`, range ? { range: request.headers } : {});
  if (!object) return respond("Not found", { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-apple-diskimage",
    "Content-Disposition": `attachment; filename="${file}"`,
    "Accept-Ranges": "bytes",
    ETag: object.httpEtag,
  };
  let status = 200;
  const part = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && part) {
    const start = part.suffix !== undefined ? object.size - part.suffix : part.offset ?? 0;
    const length = part.suffix ?? part.length ?? object.size - start;
    headers["Content-Range"] = `bytes ${start}-${start + length - 1}/${object.size}`;
    headers["Content-Length"] = String(length);
    status = 206;
  } else {
    headers["Content-Length"] = String(object.size);
    // Only whole downloads are counted; resumed parts are the same download.
    await env.DB.prepare("INSERT INTO downloads(email_hash,version,at) VALUES(?,?,?)").bind(hash, r.version, now()).run();
  }
  return respond(request.method === "HEAD" ? null : (object as R2ObjectBody).body, { status, headers });
}

export async function handle(request: Request, env: Env, keys: KeySource = fetchKeys): Promise<Response> {
  const url = new URL(request.url);
  const email = await accessEmail(request, env, keys);
  if (!email) return respond(DENIED, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } });
  const hash = await emailHash(email);
  if (url.pathname === "/api/me" && request.method === "GET") {
    const i = await invite(env, hash);
    return api({
      email,
      release: i.revoked_at ? null : await release(env),
      invite: i.revoked_at ? { paused: true } : { code: shown(i.code), inUse: !!i.key_hash, since: i.bound_at },
    });
  }
  if (url.pathname === "/api/new-code" && request.method === "POST") {
    // The Access cookie travels with cross-site posts; only this page may ask.
    if (request.headers.get("Origin") !== url.origin) return api({ error: "forbidden" }, 403);
    await swap(env, hash);
    const i = await invite(env, hash);
    return i.revoked_at ? api({ error: "paused" }, 403) : api({ code: shown(i.code), inUse: false, since: null });
  }
  const file = /^\/download\/([A-Za-z0-9._-]{1,80}\.dmg)$/.exec(url.pathname);
  if (file && (request.method === "GET" || request.method === "HEAD")) {
    const i = await invite(env, hash);
    if (i.revoked_at) return respond("Not available", { status: 403 });
    return download(request, env, file[1], hash);
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/download/")) return api({ error: "not_found" }, 404);
  if (request.method !== "GET" && request.method !== "HEAD") return respond(null, { status: 405 });
  const asset = await env.ASSETS.fetch(request);
  const headers = Object.fromEntries(asset.headers);
  return respond(asset.body, { status: asset.status, headers }, "private, max-age=300");
}
export default { fetch: (request: Request, env: Env) => handle(request, env) } satisfies ExportedHandler<Env>;
