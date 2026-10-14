import { env, applyD1Migrations } from "cloudflare:test";
import { type Fetch } from "../src/friends";
import { handle, type Env } from "../src/index";
export const TEAM = "https://peta-friends.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://peta-admin.test";
export const base = { ...env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAILS: "Owner@Example.com", ASSETS: { fetch: async () => new Response("<h1>Owner</h1>") } } as unknown as Env;
let signer: CryptoKeyPair, jwk: JsonWebKey;
export const rsa = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
export const keys = async (url: string) => url === `${TEAM}/cdn-cgi/access/certs` ? [jwk] : [];
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const part = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
export async function jwt(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key?: CryptoKey) {
  const body = `${part({ alg: "RS256", kid: "owner", ...header })}.${part({ iss: TEAM, aud: [AUD], email: "Owner@Example.com", exp: Date.now() / 1000 + 600, ...claims })}`;
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key ?? signer.privateKey, new TextEncoder().encode(body))))}`;
}
export async function setup() {
  await applyD1Migrations(base.DB, (env as any).TEST_MIGRATIONS);
  signer = await rsa();
  jwk = { ...((await crypto.subtle.exportKey("jwk", signer.publicKey)) as JsonWebKey), kid: "owner" } as JsonWebKey;
}
export async function req(path: string, init: RequestInit = {}, use: Env = base, token?: string | null, transport?: Fetch) {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set("Cf-Access-Jwt-Assertion", token ?? await jwt());
  return handle(new Request(ORIGIN + path, { ...init, headers }), use, keys, transport);
}
export const post = (path: string, body: unknown, use: Env = base, transport?: Fetch) => req(path, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) }, use, undefined, transport);
export const clear = () => base.DB.batch(["admin_log", "admin_locks", "coupon_claims", "coupons", "downloads", "invites", "nonces", "rate_counters"].map(t => base.DB.prepare(`DELETE FROM ${t}`)));
