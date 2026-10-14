import { beforeAll, beforeEach, expect, it } from "vitest";
import { base, setup, clear, post, req } from "./helpers";
import { TEST_SEED } from "./test-key";
import { readEvent } from "../src/bundle";
import apiWorker, { type Env as ApiEnv } from "../../peta-api/src/index";
import { base64, requestBytes, utf8 } from "../../peta-api/src/proofs";
const use = { ...base, COUPON_KEY_ID: "c1", COUPON_SIGNING_KEY: TEST_SEED };
const t = () => Math.floor(Date.now() / 1000);
const coupon = () => ({ name: "THANKYOU", items: [{ kind: "scraps", count: 50 }], endsAt: t() + 86400, maxClaims: 2, title: "From Peta", message: "Enjoy!" });
beforeAll(setup); beforeEach(clear);
it("issues an event that the unchanged signed redeem endpoint reads and counts", async () => {
  const result = await post("/api/coupons", coupon(), use); expect(result.status).toBe(201);
  const c = await use.DB.prepare("SELECT * FROM coupons").first<any>();
  const event = readEvent(c.event)!;
  expect(event.kind).toBe("bundle"); expect(event.signer).toEqual({ kind: "official", keyId: "c1" });
  expect(event.attachments).toEqual([]); expect(event.eventId).toMatch(/^cpn-thankyou-\d{12}$/);
  expect(Date.parse(event.notAfter) / 1000).toBe(c.ends_at); expect(Date.parse(event.notBefore) / 1000).toBe(c.starts_at);
  const key = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
  const body = utf8(JSON.stringify({ name: "thankyou" })), path = "/v1/coupons/redeem", time = String(t()), nonce = base64(crypto.getRandomValues(new Uint8Array(16)));
  const sig = base64(new Uint8Array(await crypto.subtle.sign("Ed25519", key.privateKey, await requestBytes("POST", path, time, nonce, body))));
  const publicKey = base64(new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey) as ArrayBuffer));
  const response = await apiWorker.fetch(new Request(`https://peta.test${path}`, { method: "POST", headers: { "X-Peta-Key": publicKey, "X-Peta-Time": time, "X-Peta-Nonce": nonce, "X-Peta-Sig": sig }, body }), { ...use, REQUESTS_PER_MINUTE: "10000", RATE_LIMITER: undefined } as unknown as ApiEnv);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ event: c.event });
  expect((await use.DB.prepare("SELECT claims FROM coupons").first<any>()).claims).toBe(1);
  const listing = await (await req("/api/coupons")).json<any>(); expect(listing.coupons[0]).toMatchObject({ name: "THANKYOU", items: [{ count: 50, id: "", kind: "scraps" }], state: "open", claims: 1 });
  const logs = JSON.stringify((await use.DB.prepare("SELECT * FROM admin_log").all()).results);
  expect(logs).not.toContain(TEST_SEED); expect(logs).not.toContain(c.event); expect(logs).not.toContain("owner@example.com");
});
it("rejects duplicates and invalid bounds, counts, items and names without inserting", async () => {
  for (const patch of [{ name: "AB" }, { items: [] }, { items: [{ kind: "scraps", count: 1001 }] }, { items: [{ kind: "envelope", count: 4 }] }, { items: [{ kind: "material", id: "matte", count: 1 }] }, { items: [{ kind: "tool", id: "board", count: 13 }] }, { items: [{ kind: "pack", id: "cats", count: 6 }] }, { items: [coupon().items[0], coupon().items[0]] }, { items: Array(11).fill(coupon().items[0]) }, { endsAt: t() - 1 }, { startsAt: t() + 100, endsAt: t() + 50 }, { startsAt: "invalid" }, { endsAt: 1.5 }, { maxClaims: 0 }, { maxClaims: 1.1 }, { title: "" }, { title: "x\ny" }, { message: "x".repeat(1001) }]) expect((await post("/api/coupons", { ...coupon(), ...patch }, use)).status).toBe(400);
  expect((await use.DB.prepare("SELECT COUNT(*) AS n FROM coupons").first<any>()).n).toBe(0);
  expect((await post("/api/coupons", coupon(), use)).status).toBe(201);
  expect((await post("/api/coupons", { ...coupon(), name: " thankyou " }, use)).status).toBe(409);
  expect((await use.DB.prepare("SELECT COUNT(*) AS n FROM coupons").first<any>()).n).toBe(1);
});
it("lists legacy events and all states; stops one or every coupon including offline coupons", async () => {
  await post("/api/coupons", coupon(), use);
  const original = await use.DB.prepare("SELECT event FROM coupons").first<{ event: string }>();
  for (const [name, start, end, cap, claims] of [["SOON", t()+100, t()+200, null, 0], ["ENDED", null, t()-1, null, 0], ["FULL", null, t()+100, 1, 1]] as const)
    await use.DB.prepare("INSERT INTO coupons(name,event,starts_at,ends_at,max_claims,claims,created_at) VALUES(?,?,?,?,?,?,?)").bind(name, original!.event, start, end, cap, claims, t()).run();
  const states = (await (await req("/api/coupons")).json<any>()).coupons.map((c: any) => c.state);
  expect(states).toEqual(expect.arrayContaining(["open", "not yet", "ended", "used up"]));
  expect((await post("/api/coupons/stop", { name: "THANKYOU" })).status).toBe(200);
  expect((await post("/api/coupons/stop-all", {})).status).toBe(400);
  expect((await post("/api/coupons/stop-all", { confirm: true })).status).toBe(200);
  expect((await (await req("/api/coupons")).json<any>()).coupons.every((c: any) => c.state === "stopped")).toBe(true);
});
it("fails signing safely, never echoes secrets, and refuses mutations with a busy lease", async () => {
  const bad = { ...use, COUPON_SIGNING_KEY: "CANARY-SECRET", CF_API_TOKEN: "CANARY-TOKEN" };
  const r = await post("/api/coupons", coupon(), bad); expect(r.status).toBe(503); expect(await r.text()).not.toContain("CANARY");
  expect(JSON.stringify((await use.DB.prepare("SELECT * FROM admin_log").all()).results)).not.toContain("CANARY");
  await use.DB.prepare("INSERT INTO admin_locks VALUES('mutation','other',?)").bind(t()+120).run();
  expect((await post("/api/coupons", coupon(), use)).status).toBe(409);
  expect((await use.DB.prepare("SELECT COUNT(*) AS n FROM coupons").first<any>()).n).toBe(0);
});

it("keeps malformed legacy coupon rows isolated and rejects a mismatched signing public key", async () => {
  const { signBundle } = await import("../src/bundle");
  const event = await signBundle({ eventId: "legacy", issuedAt: "2026-10-14T00:00:00Z", notBefore: null, notAfter: "2026-11-01T00:00:00Z", title: "From Peta", message: "", items: [{ kind: "scraps", id: "", count: 1 }] }, "c1", TEST_SEED);
  const bytes = Uint8Array.from(atob(event), c => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes.slice(13,-64)), invalid = JSON.parse(text);
  invalid.payload.items = [null];
  const json = new TextEncoder().encode(JSON.stringify(invalid)), malformed = new Uint8Array(13 + json.length + 64);
  malformed.set(new TextEncoder().encode("PETAEVNT")); malformed[8] = 1; new DataView(malformed.buffer).setUint32(9, json.length, false); malformed.set(json,13);
  await use.DB.prepare("INSERT INTO coupons(name,event,ends_at,created_at) VALUES(?,?,?,?)").bind("LEGACY", btoa(String.fromCharCode(...malformed)), t()+3600, t()).run();
  const list = await (await req("/api/coupons")).json<any>(); expect(list.coupons[0]).toMatchObject({ name: "LEGACY", items: [], readable: false });
  for (const key of ["", btoa("x".repeat(32))]) expect((await post("/api/coupons", coupon(), { ...use, COUPON_PUBLIC_KEY: key })).status).toBe(503);
  expect((await use.DB.prepare("SELECT COUNT(*) AS n FROM coupons WHERE name='THANKYOU'").first<any>()).n).toBe(0);
});
