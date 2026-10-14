import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import worker, { Env } from "../src/index";
import { couponName } from "../src/coupons";
import { base64, requestBytes, utf8 } from "../src/proofs";

const db = (env as unknown as Env).DB;
const open = { ...env, REQUESTS_PER_MINUTE: "10000", RATE_LIMITER: undefined } as unknown as Env;
let alice: CryptoKeyPair, bob: CryptoKeyPair, carol: CryptoKeyPair;
const pub = async (k: CryptoKeyPair) => base64(new Uint8Array((await crypto.subtle.exportKey("raw", k.publicKey)) as ArrayBuffer));
async function redeem(key: CryptoKeyPair, name: unknown, use: Env = open) {
  const path = "/v1/coupons/redeem", bytes = utf8(JSON.stringify({ name }));
  const time = String(Math.floor(Date.now() / 1000)), nonce = base64(crypto.getRandomValues(new Uint8Array(16)));
  const sig = base64(new Uint8Array(await crypto.subtle.sign("Ed25519", key.privateKey, await requestBytes("POST", path, time, nonce, bytes))));
  return worker.fetch(new Request(`https://peta.test${path}`, { method: "POST", headers: { "X-Peta-Key": await pub(key), "X-Peta-Time": time, "X-Peta-Nonce": nonce, "X-Peta-Sig": sig }, body: bytes }), use);
}
async function refused(r: Response, status: number, error: string) { expect(r.status).toBe(status); expect(((await r.json()) as { error: string }).error).toBe(error); }
const now = () => Math.floor(Date.now() / 1000);
const add = (name: string, extra: Partial<{ starts_at: number; ends_at: number; max_claims: number }> = {}) =>
  db.prepare("INSERT INTO coupons(name,event,starts_at,ends_at,max_claims,created_at) VALUES(?,?,?,?,?,?)")
    .bind(name, `EVENT-${name}`, extra.starts_at ?? null, extra.ends_at ?? now() + 3600, extra.max_claims ?? null, now()).run();

beforeAll(async () => {
  await applyD1Migrations(db, (env as any).TEST_MIGRATIONS);
  [alice, bob, carol] = await Promise.all([1, 2, 3].map(() => crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as Promise<CryptoKeyPair>));
});
beforeEach(async () => {
  await db.batch(["coupon_claims", "coupons", "invites", "nonces", "rate_counters"].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

it("names are short words, typed in any case", () => {
  expect(couponName(" thankyou ")).toBe("THANKYOU");
  expect(couponName("FALL-26")).toBe("FALL-26");
  for (const bad of ["AB", "-START", "WAY-TOO-LONG-FOR-A-COUPON-NAME", "SPACE IN", "", 42]) expect(couponName(bad)).toBeNull();
});

it("a coupon hands back its signed event, once counted per Mac", async () => {
  await add("THANKYOU", { max_claims: 2 });
  for (const k of [alice, alice, bob]) expect(await (await redeem(k, "thankyou")).json()).toEqual({ event: "EVENT-THANKYOU" });
  expect((await db.prepare("SELECT claims FROM coupons").first<any>()).claims).toBe(2);
  await refused(await redeem(carol, "THANKYOU"), 409, "coupon_used_up");
  expect((await db.prepare("SELECT COUNT(*) AS n FROM coupon_claims").first<any>()).n).toBe(2);
  // A Mac that already claimed it can fetch it again (its first try may not have arrived).
  expect((await redeem(alice, "THANKYOU")).status).toBe(200);
});

it("unknown, not yet open, ended and stopped coupons are refused", async () => {
  await refused(await redeem(alice, "NOPE"), 404, "unknown_coupon");
  await refused(await redeem(alice, "x"), 400, "invalid");
  await add("SOON", { starts_at: now() + 600 });
  await refused(await redeem(alice, "SOON"), 409, "coupon_not_started");
  await add("OVER", { ends_at: now() - 1 });
  await refused(await redeem(alice, "OVER"), 409, "coupon_ended");
  await add("PAUSED");
  await db.prepare("UPDATE coupons SET stopped_at=1 WHERE name='PAUSED'").run();
  await refused(await redeem(alice, "PAUSED"), 404, "unknown_coupon");
});

it("guessing names is limited, and an uninvited Mac gets nothing", async () => {
  for (let i = 0; i < 20; i++) await refused(await redeem(alice, `GUESS${i}`), 404, "unknown_coupon");
  await refused(await redeem(alice, "GUESSMORE"), 429, "slow_down");
  await add("FRIENDS");
  await refused(await redeem(bob, "FRIENDS", { ...open, INVITE_REQUIRED: "1" } as Env), 403, "not_invited");
});
