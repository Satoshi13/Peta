import { beforeAll, beforeEach, expect, it } from "vitest";
import { accessEmail } from "../../shared/access";
import { handle } from "../src/index";
import { base, TEAM, AUD, ORIGIN, keys, jwt, rsa, req, setup, clear } from "./helpers";
beforeAll(setup);
beforeEach(clear);
it("checks the shared Access implementation on every page, asset and API request", async () => {
  expect(await accessEmail(new Request(ORIGIN, { headers: { "Cf-Access-Jwt-Assertion": await jwt() } }), base, keys)).toBe("owner@example.com");
  const bad = [null, "garbage", await jwt({ email: "friend@example.com" }), await jwt({ aud: ["b".repeat(64)] }), await jwt({ iss: "https://other.cloudflareaccess.com" }), await jwt({ exp: Date.now() / 1000 - 120 }), await jwt({ nbf: Date.now() / 1000 + 120 }), await jwt({ email: undefined }), await jwt({}, { kid: "missing" }), await jwt({}, { alg: "none" }), await jwt({}, {}, (await rsa()).privateKey)];
  for (const token of bad) for (const path of ["/", "/admin.js", "/api/me", "/api/coupons"]) expect((await req(path, {}, base, token)).status).toBe(403);
  expect((await req("/")).status).toBe(200);
  expect((await req("/api/me")).status).toBe(200);
  expect((await handle(new Request(ORIGIN, { headers: { Cookie: `CF_Authorization=${await jwt()}` } }), base, keys)).status).toBe(200);
});
it("fails closed on every missing or malformed owner/Access setting", async () => {
  for (const config of [{ OWNER_EMAILS: "" }, { OWNER_EMAILS: "owner@example.com,wrong" }, { OWNER_EMAILS: " " }, { ACCESS_AUD: "" }, { ACCESS_AUD: "bad" }, { ACCESS_TEAM_DOMAIN: "" }, { ACCESS_TEAM_DOMAIN: "https://evil.example" }]) expect((await req("/", {}, { ...base, ...config })).status).toBe(403);
});
it("uses the same strict security headers for pages and failures and never caches", async () => {
  for (const r of [await req("/"), await req("/api/me"), await req("/", {}, base, null)]) {
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
  }
});
it("requires same-origin JSON POSTs; GET does not write anything", async () => {
  for (const headers of [{}, { Origin: ORIGIN }, { Origin: "https://evil.test", "Content-Type": "application/json" }] as Record<string,string>[]) expect((await req("/api/action", { method: "POST", headers, body: "{}" })).status).toBe(403);
  const logs = await base.DB.prepare("SELECT detail FROM admin_log").all<{ detail: string }>();
  expect(logs.results).toHaveLength(3);
  expect(JSON.stringify(logs)).not.toContain("example.com");
  await req("/api/me"); await req("/");
  expect((await base.DB.prepare("SELECT COUNT(*) AS n FROM admin_log").first<any>()).n).toBe(3);
});
