import { release } from "./release";
import { friends, type Fetch } from "./friends";
import { coupons } from "./coupons";
import { mutate } from "./lock";
import { Problem, fail } from "./validation";
export { Problem, fail } from "./validation";
import { accessEmail, fetchKeys, type AccessConfig, type KeySource } from "../../shared/access";
import { emailHash } from "../../shared/identity";

export interface Env extends AccessConfig {
  OWNER_EMAILS?: string;
  ASSETS: Fetcher;
  DB: D1Database;
  RELEASES: R2Bucket;
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  ACCESS_FRIENDS_POLICY_ID?: string;
  COUPON_SIGNING_KEY?: string;
  COUPON_KEY_ID?: string;
  COUPON_PUBLIC_KEY?: string;
  DOWNLOAD_PAGE_URL?: string;
}
export const now = () => Math.floor(Date.now() / 1000);
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) ? email : null;
}
export function owners(env: Env): string[] | null {
  const parts = (env.OWNER_EMAILS ?? "").split(/[\s,]+/).filter(Boolean);
  const emails = parts.map(normalizeEmail);
  return parts.length > 0 && parts.length <= 200 && emails.every(Boolean) ? [...new Set(emails as string[])] : null;
}
const SECURITY = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY)) headers.set(key, value);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, headers });
}
export const api = (data: unknown, status = 200) => Response.json(data, { status });
export function audit(db: D1Database, actor: string, action: string, detail: Record<string, unknown> = {}) {
  // Call sites pass only explicitly chosen hashes, names, statuses and provider numeric error codes.
  return db.prepare("INSERT INTO admin_log(at,action,detail) VALUES(?,?,?)").bind(now(), action, JSON.stringify({ actor, ...detail }));
}
export async function handle(request: Request, env: Env, keys: KeySource = fetchKeys, transport: Fetch = fetch): Promise<Response> {
  const allowed = owners(env);
  const email = allowed ? await accessEmail(request, env, keys) : null;
  if (!email || !allowed?.includes(email)) return secure(api({ error: "forbidden", message: "This page is for the Peta owner." }, 403));
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/release" && request.method === "GET") return secure(await release(env));
    if (url.pathname === "/api/me" && request.method === "GET") return secure(api({ email }));
    if (url.pathname.startsWith("/api/")) {
      let data: unknown = null;
      if (request.method === "POST") {
        if (request.headers.get("Origin") !== url.origin || request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json")
          fail(403, "forbidden", "Refresh this page and try again.");
        if (Number(request.headers.get("Content-Length")) > 16384) fail(413, "too_large", "This request is too large.");
        const raw = await request.text();
        if (new TextEncoder().encode(raw).length > 16384) fail(413, "too_large", "This request is too large.");
        try { data = JSON.parse(raw); } catch { fail(400, "invalid", "Check the form and try again."); }
      } else if (request.method !== "GET") fail(405, "method_not_allowed", "This action is not available.");
      const actor = await emailHash(email);
      const route = async () => await coupons(request, env, url.pathname, actor, data) ?? await friends(request, env, url.pathname, actor, data, transport) ?? api({ error: "not_found" }, 404);
      return secure(request.method === "POST" ? await mutate(env, route) : await route());
    }
    if (request.method !== "GET" && request.method !== "HEAD") return secure(new Response(null, { status: 405 }));
    return secure(await env.ASSETS.fetch(request));
  } catch (error) {
    const problem = error instanceof Problem ? error : new Problem(500, "unavailable", "Peta couldn't finish this action. Refresh to check its status.");
    if (request.method === "POST") {
      try { await audit(env.DB, await emailHash(email), "request.failed", { code: problem.code, status: problem.status }).run(); } catch { /* Fail closed without exposing database or provider errors. */ }
    }
    return secure(api({ error: problem.code, message: problem.message }, problem.status));
  }
}
export default { fetch: (request: Request, env: Env) => handle(request, env) } satisfies ExportedHandler<Env>;
