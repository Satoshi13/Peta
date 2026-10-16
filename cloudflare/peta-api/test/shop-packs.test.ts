import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import worker, { Env } from "../src/index";
import { base64, requestBytes, utf8 } from "../src/proofs";

const db = (env as unknown as Env).DB;
const open = { ...env, REQUESTS_PER_MINUTE: "10000", RATE_LIMITER: undefined } as unknown as Env;
const gated = { ...open, INVITE_REQUIRED: "1" } as Env;
const bucket = open.RELEASES!;
let alice: CryptoKeyPair, bob: CryptoKeyPair;
const pub = async (k: CryptoKeyPair) => base64(new Uint8Array((await crypto.subtle.exportKey("raw", k.publicKey)) as ArrayBuffer));
async function call(method: string, path: string, key: CryptoKeyPair, use: Env = gated, body?: unknown) {
  const bytes = body === undefined ? new Uint8Array() : utf8(JSON.stringify(body));
  const time = String(Math.floor(Date.now() / 1000)), nonce = base64(crypto.getRandomValues(new Uint8Array(16)));
  const sig = base64(new Uint8Array(await crypto.subtle.sign("Ed25519", key.privateKey, await requestBytes(method, path.split("?")[0], time, nonce, bytes))));
  return worker.fetch(new Request(`https://peta.test${path}`, {
    method,
    headers: { "X-Peta-Key": await pub(key), "X-Peta-Time": time, "X-Peta-Nonce": nonce, "X-Peta-Sig": sig },
    ...(method === "GET" ? {} : { body: bytes }),
  }), use);
}
async function refused(r: Response, status: number, error: string) { expect(r.status).toBe(status); expect(((await r.json()) as { error: string }).error).toBe(error); }
const now = () => Math.floor(Date.now() / 1000);
async function signed(packId: string, version: number, body: string, period: { starts?: number | null; ends?: number | null; stopped?: number | null } = {}) {
  await bucket.put(`shop/${packId}/${version}.peta`, body);
  await db.prepare("INSERT INTO shop_packs(pack_id,version,title,file,size,sha256,starts_at,ends_at,created_at,stopped_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(packId, version, packId, `shop/${packId}/${version}.peta`, utf8(body).length, "ab".repeat(32), period.starts === undefined ? now() - 60 : period.starts, period.ends ?? null, now(), period.stopped ?? null).run();
}
const config = async (k: CryptoKeyPair = alice, use: Env = gated) => (await (await call("GET", "/v1/config", k, use)).json()) as { shopPacks: { packId: string; version: number; size: number; sha256: string; endsAt: number | null; url: string }[] };

beforeAll(async () => {
  await applyD1Migrations(db, (env as any).TEST_MIGRATIONS);
  [alice, bob] = await Promise.all([1, 2].map(() => crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as Promise<CryptoKeyPair>));
});
beforeEach(async () => {
  await db.batch(["invites", "nonces", "rate_counters", "shop_packs", "shop_pack_tokens"].map((t) => db.prepare(`DELETE FROM ${t}`)));
  await db.prepare("INSERT INTO invites(email_hash,code,created_at) VALUES(?,?,0)").bind("a".repeat(64), "ABCDE12345").run();
  await call("POST", "/v1/invite", alice, gated, { code: "ABCDE12345" });
});

it("lists only packs on sale, and only each pack's newest version on sale", async () => {
  await signed("autumn", 1, "autumn one");
  await signed("autumn", 2, "autumn two");
  await signed("later", 1, "later", { starts: now() + 3600 });
  await signed("draft", 1, "draft", { starts: null });
  await signed("ended", 1, "ended", { starts: now() - 7200, ends: now() - 60 });
  await signed("stopped", 1, "stopped", { stopped: now() - 1 });
  await signed("winter", 3, "winter three", { ends: now() + 86400 });
  await signed("winter", 4, "winter four", { stopped: now() });
  const packs = (await config()).shopPacks;
  expect(packs.map((p) => [p.packId, p.version])).toEqual([["autumn", 2], ["winter", 3]]);
  expect(packs[0]).toMatchObject({ size: 10, sha256: "ab".repeat(32), endsAt: null });
  expect(packs[1].endsAt).toBeGreaterThan(now());
  // One token per answer, stored only as a hash.
  const tokens = (await db.prepare("SELECT token FROM shop_pack_tokens").all<{ token: string }>()).results;
  expect(tokens).toHaveLength(1);
  expect(packs[0].url).not.toContain(tokens[0].token);
});

it("sends the file only to the same invited Mac, for a pack on sale, within ten minutes", async () => {
  await signed("autumn", 2, "autumn two");
  const url = new URL((await config()).shopPacks[0].url).pathname;
  const file = await call("GET", url, alice);
  expect(file.status).toBe(200);
  expect(file.headers.get("Cache-Control")).toBe("private, no-store");
  expect(file.headers.get("Content-Length")).toBe("10");
  expect(await file.text()).toBe("autumn two");
  await refused(await call("GET", url, bob, open), 403, "shop_pack_expired");
  await refused(await call("GET", url, bob), 403, "not_invited");
  await refused(await call("GET", url.replace("/2", "/1"), alice), 404, "not_on_sale");
  await db.prepare("UPDATE shop_packs SET stopped_at=?").bind(now()).run();
  await refused(await call("GET", url, alice), 404, "not_on_sale");
  await db.prepare("UPDATE shop_packs SET stopped_at=NULL").run();
  await db.prepare("UPDATE shop_pack_tokens SET expires_at=0").run();
  await refused(await call("GET", url, alice), 403, "shop_pack_expired");
});

it("refuses a file whose size no longer matches, and answers an empty list without a token", async () => {
  expect((await config()).shopPacks).toEqual([]);
  expect((await db.prepare("SELECT COUNT(*) AS n FROM shop_pack_tokens").first<{ n: number }>())!.n).toBe(0);
  await signed("autumn", 2, "autumn two");
  const url = new URL((await config()).shopPacks[0].url).pathname;
  await bucket.put("shop/autumn/2.peta", "something else entirely");
  await refused(await call("GET", url, alice), 404, "not_found");
  await refused(await call("GET", "/v1/config", bob), 403, "not_invited");
});
