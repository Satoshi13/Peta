import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import worker, { Env } from "../src/index";
import { keyHash } from "../src/inbox";
import { normalizeCode, sweepRecords } from "../src/invites";
import { base64, requestBytes, utf8 } from "../src/proofs";

const db = (env as unknown as Env).DB;
const open = { ...env, REQUESTS_PER_MINUTE: "10000", RATE_LIMITER: undefined } as unknown as Env;
const gated = { ...open, INVITE_REQUIRED: "1" } as Env;
let alice: CryptoKeyPair, bob: CryptoKeyPair;
const pub = async (k: CryptoKeyPair) => base64(new Uint8Array((await crypto.subtle.exportKey("raw", k.publicKey)) as ArrayBuffer));
async function call(method: string, path: string, key: CryptoKeyPair, body?: unknown, use: Env = gated) {
  const bytes = body === undefined ? new Uint8Array() : utf8(JSON.stringify(body));
  const time = String(Math.floor(Date.now() / 1000)), nonce = base64(crypto.getRandomValues(new Uint8Array(16)));
  const sig = base64(new Uint8Array(await crypto.subtle.sign("Ed25519", key.privateKey, await requestBytes(method, path, time, nonce, bytes))));
  return worker.fetch(new Request(`https://peta.test${path}`, {
    method,
    headers: { "X-Peta-Key": await pub(key), "X-Peta-Time": time, "X-Peta-Nonce": nonce, "X-Peta-Sig": sig },
    ...(method === "GET" ? {} : { body: bytes }),
  }), use);
}
async function refused(r: Response, status: number, error: string) { expect(r.status).toBe(status); expect(((await r.json()) as { error: string }).error).toBe(error); }
const status = async (k: CryptoKeyPair, use: Env = gated) => (await call("GET", "/v1/invite", k, undefined, use)).json();
const issue = (email: string, code: string) => db.prepare("INSERT INTO invites(email_hash,code,created_at) VALUES(?,?,0)").bind(email, code).run();

beforeAll(async () => {
  await applyD1Migrations(db, (env as any).TEST_MIGRATIONS);
  [alice, bob] = await Promise.all([1, 2].map(() => crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as Promise<CryptoKeyPair>));
});
beforeEach(async () => {
  await db.batch(["invites", "nonces", "rate_counters"].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

it("typed codes forgive spacing, case and look-alikes", () => {
  expect(normalizeCode("abcde-fgh1o")).toBe("ABCDEFGH10");
  expect(normalizeCode(" ABCDE FGHIL ")).toBe("ABCDEFGH11");
  expect(normalizeCode("ABCDE-FGHU0")).toBeNull();
  expect(normalizeCode("ABCD")).toBeNull();
});

it("without INVITE_REQUIRED every key is active and nothing is gated", async () => {
  expect(await status(alice, open)).toEqual({ required: false, active: true });
  expect((await call("GET", "/v1/mailbox/requests", alice, undefined, open)).status).not.toBe(403);
});

it("a key needs a redeemed invite before any other signed route", async () => {
  expect(await status(alice)).toEqual({ required: true, active: false });
  await refused(await call("GET", "/v1/mailbox/requests", alice), 403, "not_invited");
  await issue("a".repeat(64), "ABCDE12345");
  await refused(await call("POST", "/v1/invite", alice, { code: "ZZZZZ99999" }), 404, "unknown_invite");
  await refused(await call("POST", "/v1/invite", alice, { code: "nope" }), 400, "invalid");
  expect((await call("POST", "/v1/invite", alice, { code: "abcde-12345" })).status).toBe(200);
  expect((await call("POST", "/v1/invite", alice, { code: "ABCDE12345" })).status).toBe(200); // retry is fine
  expect(await status(alice)).toEqual({ required: true, active: true });
  expect((await call("GET", "/v1/mailbox/requests", alice)).status).not.toBe(403);
});

it("one Mac per invite; a new code moves it and revocation stops it", async () => {
  await issue("a".repeat(64), "ABCDE12345");
  expect((await call("POST", "/v1/invite", alice, { code: "ABCDE12345" })).status).toBe(200);
  await refused(await call("POST", "/v1/invite", bob, { code: "ABCDE12345" }), 409, "invite_used");
  // The download page's "new Mac" swaps the code and clears the binding.
  await db.prepare("UPDATE invites SET code='FGHJK67890',key_hash=NULL,bound_at=NULL WHERE email_hash=?").bind("a".repeat(64)).run();
  expect(await status(alice)).toEqual({ required: true, active: false });
  expect((await call("POST", "/v1/invite", bob, { code: "FGHJK67890" })).status).toBe(200);
  expect(await status(bob)).toEqual({ required: true, active: true });
  // A key moving to another friend's invite leaves its first one free.
  await issue("b".repeat(64), "MNPQR11111");
  expect((await call("POST", "/v1/invite", bob, { code: "MNPQR11111" })).status).toBe(200);
  expect((await db.prepare("SELECT key_hash FROM invites WHERE code='FGHJK67890'").first())!.key_hash).toBeNull();
  await db.prepare("UPDATE invites SET revoked_at=1 WHERE key_hash=?").bind(await keyHash(await pub(bob))).run();
  await refused(await call("GET", "/v1/mailbox/requests", bob), 403, "not_invited");
  await refused(await call("POST", "/v1/invite", bob, { code: "MNPQR11111" }), 404, "unknown_invite");
});

it("guessing is limited per key", async () => {
  for (let i = 0; i < 10; i++) await refused(await call("POST", "/v1/invite", alice, { code: `ZZZZZ0000${i}` }), 404, "unknown_invite");
  await refused(await call("POST", "/v1/invite", alice, { code: "ZZZZZ11111" }), 429, "slow_down");
});

it("a lost race for the same invite reports invite_used, not invalid", async () => {
  await issue("a".repeat(64), "ABCDE12345");
  const [a, b] = await Promise.all([call("POST", "/v1/invite", alice, { code: "ABCDE12345" }), call("POST", "/v1/invite", bob, { code: "ABCDE12345" })]);
  const statuses = [a.status, b.status].sort();
  expect(statuses).toEqual([200, 409]);
  const loser = a.status === 409 ? a : b;
  expect(((await loser.json()) as { error: string }).error).toBe("invite_used");
});

it("records older than a year are swept, newer ones stay", async () => {
  const t = 2_000_000_000, old = t - 366 * 86400, recent = t - 10 * 86400;
  await db.batch([
    db.prepare("DELETE FROM downloads"), db.prepare("DELETE FROM coupon_claims"), db.prepare("DELETE FROM coupons"), db.prepare("DELETE FROM admin_log"),
    db.prepare("INSERT INTO downloads VALUES('h',?,?),('h',?,?)").bind("0.1.0", old, "0.2.0", recent),
    db.prepare("INSERT INTO coupons(name,event,ends_at,created_at) VALUES('OLD','E',?,0),('NEW','E',?,0)").bind(old, recent),
    db.prepare("INSERT INTO coupon_claims VALUES('OLD','k',?),('NEW','k',?)").bind(old, recent),
    db.prepare("INSERT INTO admin_log VALUES(?,'a','{}'),(?,'b','{}')").bind(old, recent),
    db.prepare("INSERT INTO invites(email_hash,code,created_at,revoked_at) VALUES('x','AAAAA11111',0,?),('y','BBBBB22222',0,?),('z','CCCCC33333',0,NULL)").bind(old, recent),
  ]);
  await sweepRecords({ ...open, DB: db } as Env, t);
  const left = async (sql: string) => (await db.prepare(sql).all<any>()).results.map((r: any) => Object.values(r)[0]);
  expect(await left("SELECT version FROM downloads")).toEqual(["0.2.0"]);
  expect(await left("SELECT name FROM coupons")).toEqual(["NEW"]);
  expect(await left("SELECT name FROM coupon_claims")).toEqual(["NEW"]);
  expect(await left("SELECT action FROM admin_log")).toEqual(["b"]);
  expect((await left("SELECT email_hash FROM invites ORDER BY email_hash"))).toEqual(["y", "z"]);
});
