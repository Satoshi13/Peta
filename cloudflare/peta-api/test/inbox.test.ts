import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import worker, { Env } from "../src/index";
import { mailboxId, bindingBytes, keyHash, sweepReports } from "../src/inbox";
import { base64, requestBytes, utf8, unbase64, verify } from "../src/proofs";
import vectors from "./vectors-s2.json";

const db = (env as unknown as Env).DB;
const bindings = { ...env, REQUESTS_PER_MINUTE: "10000", PACKS_PER_HOUR: "10000", RATE_LIMITER: undefined } as unknown as Env;
let alice: CryptoKeyPair, bob: CryptoKeyPair, eve: CryptoKeyPair;
const pub = async (k: CryptoKeyPair) => base64(new Uint8Array((await crypto.subtle.exportKey("raw", k.publicKey)) as ArrayBuffer));
const sign = async (k: CryptoKeyPair, bytes: Uint8Array) => base64(new Uint8Array(await crypto.subtle.sign("Ed25519", k.privateKey, bytes)));
const enc = base64(new Uint8Array(32).fill(9));

async function call(method: string, path: string, key: CryptoKeyPair, body?: unknown, use: Env = bindings) {
  const bytes = body === undefined ? new Uint8Array() : body instanceof Uint8Array ? body : utf8(JSON.stringify(body));
  const time = String(Math.floor(Date.now() / 1000)), nonce = base64(crypto.getRandomValues(new Uint8Array(16)));
  return worker.fetch(new Request(`https://peta.test${path}`, {
    method,
    headers: { "X-Peta-Key": await pub(key), "X-Peta-Time": time, "X-Peta-Nonce": nonce, "X-Peta-Sig": await sign(key, await requestBytes(method, path, time, nonce, bytes)) },
    ...(method === "GET" ? {} : { body: bytes }),
  }), use);
}
async function refused(r: Response, status: number, error: string) { expect(r.status).toBe(status); expect(((await r.json()) as { error: string }).error).toBe(error); }
async function open(k: CryptoKeyPair, name = "Alice") {
  const signKey = await pub(k), binding = await sign(k, bindingBytes(unbase64(enc, 32), name));
  const r = await call("POST", "/v1/mailbox", k, { signKey, encKey: enc, name, binding });
  expect(r.status).toBe(200);
  return ((await r.json()) as { id: string }).id;
}
const hash = async (k: CryptoKeyPair) => keyHash(await pub(k));
const gift = (n = 64) => crypto.getRandomValues(new Uint8Array(n));

beforeAll(async () => {
  await applyD1Migrations(db, (env as any).TEST_MIGRATIONS);
  [alice, bob, eve] = await Promise.all([1, 2, 3].map(() => crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as Promise<CryptoKeyPair>));
});
beforeEach(async () => {
  await db.batch(["messages", "friend_requests", "mailbox_allow", "mailbox_blocks", "report_listing_access", "reports", "mailboxes", "nonces", "rate_counters"].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

it("Rust friend codes and mailbox ids agree", async () => {
  expect(await mailboxId(vectors.signKey)).toBe(vectors.mailboxId);
  for (const v of vectors.codes) {
    const bytes = bindingBytes(unbase64(v.code.encKey, 32), v.code.name);
    expect(base64(bytes)).toBe(v.bindingBytes);
    expect(await verify(v.code.signKey, bytes, v.code.binding)).toBe(true);
  }
});

it("a mailbox is made once, only by its key and with a valid binding", async () => {
  const id = await open(alice);
  expect(id).toBe(await mailboxId(await pub(alice)));
  expect(await open(alice)).toBe(id);
  await refused(await call("POST", "/v1/mailbox", bob, { signKey: await pub(alice), encKey: enc, name: "x", binding: "" }), 403, "not_yours");
  await refused(await call("POST", "/v1/mailbox", bob, { signKey: await pub(bob), encKey: enc, name: "Bob", binding: await sign(bob, utf8("other")) }), 400, "bad_binding");
});

it("a friend request, approval, a gift, pickup and deletion", async () => {
  const a = await open(alice), b = await open(bob, "Bob");
  // Bob asks; anyone may ask, nobody may send a gift before approval.
  expect((await call("POST", `/v1/mailbox/${a}/requests/req-00001`, bob, { sealed: base64(gift(100)) })).status).toBe(200);
  expect((await call("POST", `/v1/mailbox/${a}/requests/req-00001`, bob, { sealed: base64(gift(100)) })).status).toBe(409);
  await refused(await call("POST", `/v1/mailbox/${a}/messages/msg-00001`, bob, gift()), 403, "not_allowed");
  await refused(await call("GET", `/v1/mailbox/${a}/requests`, bob), 403, "not_yours");
  const list = (await (await call("GET", `/v1/mailbox/${a}/requests`, alice)).json()) as { requests: { id: string; senderHash: string }[] };
  expect(list.requests.map((r) => r.id)).toEqual(["req-00001"]);
  expect(list.requests[0].senderHash).toBe(await hash(bob));
  expect(await (await call("GET", `/v1/mailbox/${a}/allowed`, bob)).json()).toEqual({ allowed: false });
  // Alice approves: Bob's key goes on her allow list and the request is gone.
  expect((await call("PUT", `/v1/mailbox/${a}/allow`, alice, { add: [await hash(bob)] })).status).toBe(200);
  expect((await call("DELETE", `/v1/mailbox/${a}/requests/req-00001`, alice)).status).toBe(200);
  expect(await (await call("GET", `/v1/mailbox/${a}/allowed`, bob)).json()).toEqual({ allowed: true });
  expect(await (await call("GET", `/v1/mailbox/${a}/allowed`, eve)).json()).toEqual({ allowed: false });
  const sealed = gift(1000);
  expect((await call("POST", `/v1/mailbox/${a}/messages/msg-00001`, bob, sealed)).status).toBe(200);
  expect((await call("POST", `/v1/mailbox/${a}/messages/msg-00001`, bob, sealed)).status).toBe(200);   // a retry is the same gift
  await refused(await call("POST", `/v1/mailbox/${a}/messages/msg-00001`, bob, gift(999)), 409, "taken");
  const box = (await (await call("GET", `/v1/mailbox/${a}/messages`, alice)).json()) as { messages: { id: string; size: number; senderHash: string }[] };
  expect(box.messages).toMatchObject([{ id: "msg-00001", size: 1000, senderHash: await hash(bob) }]);
  await refused(await call("GET", `/v1/mailbox/${a}/messages/msg-00001`, bob), 403, "not_yours");
  const fetched = new Uint8Array(await (await call("GET", `/v1/mailbox/${a}/messages/msg-00001`, alice)).arrayBuffer());
  expect(fetched).toEqual(sealed);
  expect((await call("DELETE", `/v1/mailbox/${a}/messages/msg-00001`, alice)).status).toBe(200);
  expect(((await (await call("GET", `/v1/mailbox/${a}/messages`, alice)).json()) as { messages: unknown[] }).messages).toEqual([]);
  expect(await (env as any).GIFTS.get(`${a}/msg-00001`)).toBeNull();
  void b;
});

it("a sender can take back a gift before it is picked up; nobody else can", async () => {
  const a = await open(alice); await open(bob, "Bob");
  await call("PUT", `/v1/mailbox/${a}/allow`, alice, { add: [await hash(bob)] });
  expect((await call("POST", `/v1/mailbox/${a}/messages/msg-00002`, bob, gift())).status).toBe(200);
  await refused(await call("DELETE", `/v1/mailbox/${a}/messages/msg-00002`, eve), 403, "not_yours");
  expect((await call("DELETE", `/v1/mailbox/${a}/messages/msg-00002`, bob)).status).toBe(200);
  expect(((await (await call("GET", `/v1/mailbox/${a}/messages`, alice)).json()) as { messages: unknown[] }).messages).toEqual([]);
});

it("blocking stops requests and gifts and clears what was waiting", async () => {
  const a = await open(alice);
  await call("POST", `/v1/mailbox/${a}/requests/req-00002`, eve, { sealed: base64(gift()) });
  await call("PUT", `/v1/mailbox/${a}/allow`, alice, { add: [await hash(eve)] });
  expect((await call("PUT", `/v1/mailbox/${a}/allow`, alice, { block: [await hash(eve)] })).status).toBe(200);
  await refused(await call("POST", `/v1/mailbox/${a}/requests/req-00003`, eve, { sealed: base64(gift()) }), 403, "blocked");
  await refused(await call("POST", `/v1/mailbox/${a}/messages/msg-00003`, eve, gift()), 403, "blocked");
  expect(((await (await call("GET", `/v1/mailbox/${a}/requests`, alice)).json()) as { requests: unknown[] }).requests).toEqual([]);
  await refused(await call("PUT", `/v1/mailbox/${a}/allow`, bob, { add: [await hash(bob)] }), 403, "not_yours");
  await refused(await call("PUT", `/v1/mailbox/${a}/allow`, alice, { add: ["nope"] }), 400, "invalid");
});

it("caps: pending requests per mailbox and per sender, gifts per mailbox, sizes", async () => {
  const a = await open(alice), tight = { ...bindings, PENDING_FROM_ONE: "2", PENDING_REQUESTS: "3", PENDING_GIFTS: "1" } as Env;
  for (const n of [1, 2]) expect((await call("POST", `/v1/mailbox/${a}/requests/cap-0000${n}`, bob, { sealed: base64(gift()) }, tight)).status).toBe(200);
  await refused(await call("POST", `/v1/mailbox/${a}/requests/cap-00003`, bob, { sealed: base64(gift()) }, tight), 429, "mailbox_full");
  expect((await call("POST", `/v1/mailbox/${a}/requests/cap-00004`, eve, { sealed: base64(gift()) }, tight)).status).toBe(200);
  await refused(await call("POST", `/v1/mailbox/${a}/requests/cap-00005`, eve, { sealed: base64(gift()) }, tight), 429, "mailbox_full");
  await refused(await call("POST", `/v1/mailbox/${a}/requests/cap-00006`, eve, { sealed: base64(gift(4000)) }, tight), 400, "invalid");
  await call("PUT", `/v1/mailbox/${a}/allow`, alice, { add: [await hash(bob)] });
  expect((await call("POST", `/v1/mailbox/${a}/messages/cap-00007`, bob, gift(), tight)).status).toBe(200);
  await refused(await call("POST", `/v1/mailbox/${a}/messages/cap-00008`, bob, gift(), tight), 429, "mailbox_full");
  await refused(await call("POST", `/v1/mailbox/NOTAMAILBOX0000000000000000/requests/cap-00009`, bob, { sealed: "" }), 404, "not_found");
});

it("expired requests and gifts are swept", async () => {
  const a = await open(alice);
  await call("PUT", `/v1/mailbox/${a}/allow`, alice, { add: [await hash(bob)] });
  await call("POST", `/v1/mailbox/${a}/requests/old-00001`, bob, { sealed: base64(gift()) });
  await call("POST", `/v1/mailbox/${a}/messages/old-00002`, bob, gift());
  await db.batch([db.prepare("UPDATE friend_requests SET expires_at=1"), db.prepare("UPDATE messages SET expires_at=1")]);
  expect(((await (await call("GET", `/v1/mailbox/${a}/requests`, alice)).json()) as { requests: unknown[] }).requests).toEqual([]);
  expect(((await (await call("GET", `/v1/mailbox/${a}/messages`, alice)).json()) as { messages: unknown[] }).messages).toEqual([]);
  expect(await (env as any).GIFTS.get(`${a}/old-00002`)).toBeNull();
});

it("leaving deletes the mailbox, its lists, requests and gifts", async () => {
  const a = await open(alice);
  await call("PUT", `/v1/mailbox/${a}/allow`, alice, { add: [await hash(bob)] });
  await call("POST", `/v1/mailbox/${a}/requests/bye-00001`, eve, { sealed: base64(gift()) });
  await call("POST", `/v1/mailbox/${a}/messages/bye-00002`, bob, gift());
  await refused(await call("DELETE", `/v1/mailbox/${a}`, bob), 403, "not_yours");
  expect((await call("DELETE", `/v1/mailbox/${a}`, alice)).status).toBe(200);
  for (const t of ["mailboxes", "mailbox_allow", "friend_requests", "messages"]) expect((await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n).toBe(0);
  expect(await (env as any).GIFTS.get(`${a}/bye-00002`)).toBeNull();
  await refused(await call("POST", `/v1/mailbox/${a}/requests/bye-00003`, bob, { sealed: base64(gift()) }), 404, "unknown_mailbox");
});

it("a report is kept privately and the note carries no content", async () => {
  const mailbox=await open(alice);await call("PUT",`/v1/mailbox/${mailbox}/allow`,alice,{block:[await hash(eve)]});
  const seen: string[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => { seen.push(String(init?.body)); return new Response("ok"); });
  const r = await call("POST", "/v1/report", alice, { senderHash: await hash(eve), reason: "Hurtful", gift: base64(gift(200)) }, { ...bindings, REPORT_WEBHOOK: "https://hooks.example/peta" } as Env);
  spy.mockRestore();
  expect(r.status).toBe(200);
  const { id } = (await r.json()) as { id: string };
  const stored = JSON.parse(await (await (env as any).REPORTS.get(`reports/${id}.json`)).text());
  expect(stored).toMatchObject({ id, senderHash: await hash(eve), reason: "Hurtful" });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toContain(id);
  expect(seen[0]).not.toContain(stored.gift.slice(0, 20));
  expect(seen[0]).not.toContain(await hash(eve));
  await refused(await call("POST", "/v1/report", alice, { senderHash: "x", reason: "", gift: "" }), 400, "invalid");
});

it("PUT and DELETE are signed and replay-protected like POST", async () => {
  const a = await open(alice);
  const path = `/v1/mailbox/${a}/allow`, bytes = utf8(JSON.stringify({ add: [await hash(bob)] }));
  const time = String(Math.floor(Date.now() / 1000)), nonce = base64(new Uint8Array(16).fill(4));
  const headers = { "X-Peta-Key": await pub(alice), "X-Peta-Time": time, "X-Peta-Nonce": nonce, "X-Peta-Sig": await sign(alice, await requestBytes("PUT", path, time, nonce, bytes)) };
  expect((await worker.fetch(new Request(`https://peta.test${path}`, { method: "PUT", headers, body: bytes }), bindings)).status).toBe(200);
  await refused(await worker.fetch(new Request(`https://peta.test${path}`, { method: "PUT", headers, body: bytes }), bindings), 401, "replay");
});

it("reports require a known sender, deduplicate content and enforce rolling quotas atomically",async()=>{
  const mailbox=await open(alice),senderHash=await hash(bob),payload={senderHash,reason:"Hurtful",gift:base64(gift(200))};
  await refused(await call("POST","/v1/report",alice,payload),403,"not_recipient");
  await call("PUT",`/v1/mailbox/${mailbox}/allow`,alice,{add:[senderHash]});
  const replies=await Promise.all([call("POST","/v1/report",alice,payload),call("POST","/v1/report",alice,{...payload,reason:"Duplicate"})]);
  expect(replies.map(r=>r.status)).toEqual([200,200]);
  const ids=await Promise.all(replies.map(r=>r.json() as Promise<{id:string}>));expect(ids[0].id).toBe(ids[1].id);
  expect((await db.prepare("SELECT COUNT(*) AS n FROM reports").first<{n:number}>())?.n).toBe(1);
  const more=await Promise.all(Array.from({length:7},()=>call("POST","/v1/report",alice,{...payload,gift:base64(gift(200))})));
  expect(more.filter(r=>r.status===200)).toHaveLength(4);expect(more.filter(r=>r.status===429)).toHaveLength(3);
  expect((await db.prepare("SELECT COUNT(*) AS n FROM reports").first<{n:number}>())?.n).toBe(5);
  expect((await call("POST","/v1/report",alice,payload)).status).toBe(200);
  await db.prepare("UPDATE reports SET created_at=created_at-86401").run();
  expect((await call("POST","/v1/report",alice,{...payload,gift:base64(gift(200))})).status).toBe(200);
});

it("the global pending quota reserves capacity before storing content",async()=>{
  const mailbox=await open(alice),senderHash=await hash(bob);await call("PUT",`/v1/mailbox/${mailbox}/allow`,alice,{block:[senderHash]});
  const use={...bindings,REPORTS_PENDING:"2",REPORTS_PER_DAY:"100"};
  const replies=await Promise.all(Array.from({length:4},()=>call("POST","/v1/report",alice,{senderHash,reason:"Review",gift:base64(gift())},use)));
  expect(replies.filter(r=>r.status===200)).toHaveLength(2);expect(replies.filter(r=>r.status===429)).toHaveLength(2);
  await db.prepare("UPDATE reports SET resolved_at=?").bind(Math.floor(Date.now()/1000)).run();
  expect((await call("POST","/v1/report",alice,{senderHash,reason:"Review",gift:base64(gift())},use)).status).toBe(200);
});

it("daily cron deletes only reports resolved at least thirty days ago",async()=>{
  const now=Math.floor(Date.now()/1000),bucket=(env as any).REPORTS;
  for(const [id,resolved] of [["old",now-30*86400],["recent",now-29*86400],["pending",null]] as const){
    await db.prepare("INSERT INTO reports(id,reporter_hash,sender_hash,reason,created_at,resolved_at) VALUES(?,?,?,?,?,?)").bind(id,"a","b","Review",now-40*86400,resolved).run();await bucket.put(`reports/${id}.json`,id);
  }
  await worker.scheduled({scheduledTime:now*1000} as ScheduledController,bindings);
  expect(await bucket.get('reports/old.json')).toBeNull();expect(await bucket.get('reports/recent.json')).not.toBeNull();expect(await bucket.get('reports/pending.json')).not.toBeNull();
  expect((await db.prepare("SELECT id FROM reports ORDER BY id").all()).results.map((r:any)=>r.id)).toEqual(['pending','recent']);
  expect(await sweepReports(bindings,now)).toBe(0);
});

it("a failed report upload reserves one slot and an identical retry repairs it",async()=>{
  const mailbox=await open(alice),senderHash=await hash(bob),payload={senderHash,reason:'Review',gift:base64(gift())};await call('PUT',`/v1/mailbox/${mailbox}/allow`,alice,{add:[senderHash]});
  const bad={...bindings,REPORTS:{put:async()=>{throw Error('injected R2 failure');}}} as unknown as Env;
  await refused(await call('POST','/v1/report',alice,payload,bad),503,'unavailable');
  expect(await db.prepare('SELECT stored FROM reports').first('stored')).toBe(0);
  expect((await call('POST','/v1/report',alice,payload)).status).toBe(200);
  expect(await db.prepare('SELECT COUNT(*) FROM reports').first('COUNT(*)')).toBe(1);
  expect(await db.prepare('SELECT stored FROM reports').first('stored')).toBe(1);
});

it("a failed retention deletion keeps the index for the next cron",async()=>{
  const now=Math.floor(Date.now()/1000);
  await db.prepare("INSERT INTO reports(id,reporter_hash,sender_hash,reason,created_at,resolved_at) VALUES('retry','a','b','Review',?,?)").bind(now-40*86400,now-31*86400).run();
  await bindings.REPORTS!.put('reports/retry.json','private content');
  const bad={...bindings,REPORTS:{delete:async()=>{throw Error('injected R2 failure');}}} as unknown as Env;
  await expect(sweepReports(bad,now)).rejects.toThrow('injected R2 failure');
  expect(await db.prepare("SELECT id FROM reports WHERE id='retry'").first('id')).toBe('retry');
  expect(await sweepReports(bindings,now)).toBe(1);expect(await bindings.REPORTS!.get('reports/retry.json')).toBeNull();
});
