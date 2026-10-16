import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import worker, { Env } from "../src/index";
import { keyHash } from "../src/inbox";
import { newer } from "../src/updates";
import { base64, requestBytes, utf8 } from "../src/proofs";

const db = (env as unknown as Env).DB;
const open = { ...env, REQUESTS_PER_MINUTE: "10000", RATE_LIMITER: undefined } as unknown as Env;
const gated = { ...open, INVITE_REQUIRED: "1" } as Env;
let alice: CryptoKeyPair, bob: CryptoKeyPair;
const pub = async (k: CryptoKeyPair) => base64(new Uint8Array((await crypto.subtle.exportKey("raw", k.publicKey)) as ArrayBuffer));
async function call(method: string, path: string, key: CryptoKeyPair, body?: unknown, use: Env = gated) {
  const bytes = body === undefined ? new Uint8Array() : utf8(JSON.stringify(body));
  const time = String(Math.floor(Date.now() / 1000)), nonce = base64(crypto.getRandomValues(new Uint8Array(16)));
  const sig = base64(new Uint8Array(await crypto.subtle.sign("Ed25519", key.privateKey, await requestBytes(method, path.split('?')[0], time, nonce, bytes))));
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
  await db.batch(["invites", "nonces", "rate_counters", "update_tokens", "update_downloads"].map((t) => db.prepare(`DELETE FROM ${t}`)));
});


const bucket=open.RELEASES!;
const release=(version='0.2.0')=>({version,publishedAt:'2026-10-16T00:00:00Z',update:{version,file:`updates/${version}/Peta.app.tar.gz`,signature:'A'.repeat(88),notes:'A quiet update.'}});
async function publish(version='0.2.0'){await bucket.put('releases/latest.json',JSON.stringify(release(version)));await bucket.put(`releases/updates/${version}/Peta.app.tar.gz`,'test archive');}
const invite=async()=>{await issue('a'.repeat(64),'ABCDE12345');await call('POST','/v1/invite',alice,{code:'ABCDE12345'});};
it('uses semver including pre-release and build metadata',()=>{
 expect(newer('0.2.0','0.1.9')).toBe(true);expect(newer('1.0.0','1.0.0-rc.2')).toBe(true);
 expect(newer('1.0.0-rc.10','1.0.0-rc.2')).toBe(true);expect(newer('1.0.0+build','1.0.0')).toBe(false);
 expect(newer('1.0.0-01','0.1.0')).toBe(false);expect(newer('1.0.0-alpha','1.0.0')).toBe(false);
});
it('requires an invited Mac and returns 204 for equal, older or absent releases',async()=>{
 await publish();await refused(await call('GET','/v1/update?current=0.1.0',alice),403,'not_invited');await invite();
 expect((await call('GET','/v1/update?current=0.2.0',alice)).status).toBe(204);
 expect((await call('GET','/v1/update?current=0.3.0',alice)).status).toBe(204);
 await bucket.put('releases/latest.json','{}');expect((await call('GET','/v1/update?current=0.1.0',alice)).status).toBe(204);
});
it('streams only the bound Mac and version during the ten minute window',async()=>{
 await publish();await invite();const r=await call('GET','/v1/update?current=0.1.0',alice);expect(r.status).toBe(200);
 const m=await r.json() as any;expect(m.platforms['darwin-aarch64']).toEqual(m.platforms['darwin-x86_64']);
 const path=new URL(m.platforms['darwin-aarch64'].url).pathname;
 await refused(await call('GET',path,bob,undefined,open),403,'update_expired');
 const file=await call('GET',path,alice);expect(file.status).toBe(200);expect(file.headers.get('Content-Length')).toBe('12');expect(file.headers.get('Cache-Control')).toBe('private, no-store');expect(await file.text()).toBe('test archive');
 expect((await db.prepare('SELECT * FROM update_downloads').all()).results).toHaveLength(1);
 await db.prepare('UPDATE update_tokens SET expires_at=0').run();await refused(await call('GET',path,alice),403,'update_expired');
});
it('rejects a token for another release and a paused invitation',async()=>{
 await publish();await invite();const m=await(await call('GET','/v1/update?current=0.1.0',alice)).json() as any;
 const path=new URL(m.platforms['darwin-aarch64'].url).pathname;await publish('0.3.0');await refused(await call('GET',path,alice),403,'update_expired');
 await db.prepare('UPDATE invites SET revoked_at=1').run();await refused(await call('GET',path,alice),403,'not_invited');
});
