import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { handle, Env, emailHash, newCode, validRelease, Release } from "../src/index";
import { accessEmail } from "../src/access";

const TEAM = "https://peta-friends.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://peta-download-prod.peta-api.workers.dev";
const page = { fetch: async () => new Response("<p>page</p>", { headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=99" } }) } as unknown as Fetcher;
const base = { ...(env as unknown as Env), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ASSETS: page } as Env;
const db = base.DB, bucket = base.RELEASES;
let signer: CryptoKeyPair, jwk: JsonWebKey;
const keys = async (url: string) => (url === `${TEAM}/cdn-cgi/access/certs` ? [jwk] : []);
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const part = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
async function jwt(claims: Record<string, unknown> = {}, kid = "k1", key = signer.privateKey) {
  const body = `${part({ alg: "RS256", kid })}.${part({ iss: TEAM, aud: [AUD], email: "Nao@Example.com", exp: Date.now() / 1000 + 600, ...claims })}`;
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body))))}`;
}
const req = async (path: string, init: RequestInit = {}, token?: string | null) => {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set("Cf-Access-Jwt-Assertion", token ?? (await jwt()));
  return handle(new Request(ORIGIN + path, { ...init, headers }), base, keys);
};
const release: Release = { version: "0.1.0", file: "Peta-0.1.0.dmg", size: 10, sha256: "b".repeat(64), minimumSystemVersion: "14.0", architectures: ["arm64", "x86_64"], publishedAt: "2026-10-14T00:00:00Z" };
const rsa = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;

beforeAll(async () => {
  await applyD1Migrations(db, (env as any).TEST_MIGRATIONS);
  signer = await rsa();
  jwk = { ...((await crypto.subtle.exportKey("jwk", signer.publicKey)) as JsonWebKey), kid: "k1" } as JsonWebKey;
});
beforeEach(async () => {
  await db.batch(["invites", "downloads"].map((t) => db.prepare(`DELETE FROM ${t}`)));
  await bucket.delete(["releases/latest.json", "releases/Peta-0.1.0.dmg"]);
});

it("only a valid Access token for this team and audience gets in", async () => {
  expect(await accessEmail(new Request(ORIGIN, { headers: { "Cf-Access-Jwt-Assertion": await jwt() } }), base, keys)).toBe("nao@example.com");
  for (const bad of [
    null,
    "garbage",
    await jwt({ aud: ["c".repeat(64)] }),
    await jwt({ iss: "https://other.cloudflareaccess.com" }),
    await jwt({ exp: Date.now() / 1000 - 120 }),
    await jwt({ email: undefined }),
    await jwt({}, "k2"),
    await jwt({}, "k1", (await rsa()).privateKey),
  ]) {
    const r = await req("/", {}, bad);
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("invited friends");
  }
  // The Access cookie works the same as the header.
  const r = await handle(new Request(ORIGIN + "/", { headers: { Cookie: `x=1; CF_Authorization=${await jwt()}` } }), base, keys);
  expect(r.status).toBe(200);
});

it("an unconfigured Worker refuses everyone", async () => {
  for (const env of [{ ...base, ACCESS_AUD: "" }, { ...base, ACCESS_TEAM_DOMAIN: "https://evil.example.com" }]) {
    const r = await handle(new Request(ORIGIN + "/", { headers: { "Cf-Access-Jwt-Assertion": await jwt() } }), env, keys);
    expect(r.status).toBe(403);
  }
});

it("pages are private, framed nowhere and not indexed", async () => {
  const r = await req("/");
  expect(await r.text()).toBe("<p>page</p>");
  expect(r.headers.get("Cache-Control")).toBe("private, max-age=300");
  expect(r.headers.get("X-Robots-Tag")).toContain("noindex");
  expect(r.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
});

it("each friend gets one stable invite, keyed by a hash of their email", async () => {
  const me = await (await req("/api/me")).json<any>();
  expect(me.email).toBe("nao@example.com");
  expect(me.release).toBeNull();
  expect(me.invite.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  expect(me.invite.inUse).toBe(false);
  expect((await (await req("/api/me")).json<any>()).invite.code).toBe(me.invite.code);
  const rows = await db.prepare("SELECT * FROM invites").all<any>();
  expect(rows.results).toHaveLength(1);
  expect(rows.results[0].email_hash).toBe(await emailHash("nao@example.com"));
  expect(JSON.stringify(rows.results)).not.toContain("example.com");
});

it("a new code for a new Mac unbinds the old one, only from this page", async () => {
  const first = (await (await req("/api/me")).json<any>()).invite.code;
  await db.prepare("UPDATE invites SET key_hash='k',bound_at=1760400000").run();
  expect((await (await req("/api/me")).json<any>()).invite).toEqual({ code: first, inUse: true, since: 1760400000 });
  expect((await req("/api/new-code", { method: "POST", headers: { Origin: "https://evil.example" } })).status).toBe(403);
  expect((await req("/api/new-code", { method: "POST" })).status).toBe(403);
  const next = await (await req("/api/new-code", { method: "POST", headers: { Origin: ORIGIN } })).json<any>();
  expect(next.code).not.toBe(first);
  expect(next.inUse).toBe(false);
  expect((await db.prepare("SELECT key_hash FROM invites").first<any>()).key_hash).toBeNull();
});

it("downloads only the current release from private storage, and counts them", async () => {
  expect((await req("/download/Peta-0.1.0.dmg")).status).toBe(404);
  await bucket.put("releases/Peta-0.1.0.dmg", "0123456789");
  expect((await req("/download/Peta-0.1.0.dmg")).status).toBe(404); // no manifest yet
  await bucket.put("releases/latest.json", JSON.stringify(release));
  const me = await (await req("/api/me")).json<any>();
  expect(me.release).toEqual(release);
  const r = await req("/download/Peta-0.1.0.dmg");
  expect(r.status).toBe(200);
  expect(r.headers.get("Content-Type")).toBe("application/x-apple-diskimage");
  expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="Peta-0.1.0.dmg"');
  expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  expect(new TextDecoder().decode(await r.arrayBuffer())).toBe("0123456789");
  const part = await req("/download/Peta-0.1.0.dmg", { headers: { Range: "bytes=2-5" } });
  expect(part.status).toBe(206);
  expect(part.headers.get("Content-Range")).toBe("bytes 2-5/10");
  expect(new TextDecoder().decode(await part.arrayBuffer())).toBe("2345");
  expect((await db.prepare("SELECT version,email_hash FROM downloads").all<any>()).results).toEqual([{ version: "0.1.0", email_hash: await emailHash("nao@example.com") }]);
  expect((await req("/download/Other-0.0.9.dmg")).status).toBe(404);
  expect((await req("/download/Peta-0.1.0.dmg", {}, null)).status).toBe(403);
});

it("a paused invite sees no release and cannot download", async () => {
  await bucket.put("releases/Peta-0.1.0.dmg", "0123456789");
  await bucket.put("releases/latest.json", JSON.stringify(release));
  await req("/api/me");
  await db.prepare("UPDATE invites SET revoked_at=1").run();
  expect(await (await req("/api/me")).json<any>()).toMatchObject({ release: null, invite: { paused: true } });
  expect((await req("/download/Peta-0.1.0.dmg")).status).toBe(403);
  expect((await req("/api/new-code", { method: "POST", headers: { Origin: ORIGIN } })).status).toBe(403);
});

it("codes and manifests are well formed", () => {
  for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  expect(validRelease(release)).toBe(true);
  expect(validRelease({ ...release, file: "../x.dmg" })).toBe(false);
  expect(validRelease({ ...release, file: "Peta.zip" })).toBe(false);
  expect(validRelease({ ...release, architectures: ["ppc"] })).toBe(false);
});
