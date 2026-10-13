import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import worker, { Env } from "../src/index";
import { base64, utf8, unbase64, sha256, requestBytes, creationBytes, transferBytes, Creation, Transfer } from "../src/proofs";
import { mailboxId, keyHash, bindingBytes } from "../src/inbox";
const bindings = {...env, REQUESTS_PER_MINUTE:"10000",PACKS_PER_HOUR:"10000",RATE_LIMITER:undefined} as unknown as Env;
const db = bindings.DB;
let a:CryptoKeyPair,b:CryptoKeyPair,c:CryptoKeyPair,d:CryptoKeyPair;
const id = () => base64(crypto.getRandomValues(new Uint8Array(16))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
const pub = async (k:CryptoKeyPair) => base64(new Uint8Array((await crypto.subtle.exportKey("raw",k.publicKey)) as ArrayBuffer));
const sign = async (k:CryptoKeyPair,bytes:Uint8Array) => base64(new Uint8Array(await crypto.subtle.sign("Ed25519",k.privateKey,bytes)));
const hash = async (k:CryptoKeyPair) => keyHash(await pub(k));
async function req(path:string,method="GET",data?:unknown,key=a,e=bindings) {
  const bytes = data instanceof Uint8Array ? data : data===undefined ? new Uint8Array() : utf8(JSON.stringify(data));
  const time=String(Math.floor(Date.now()/1000)),nonce=base64(crypto.getRandomValues(new Uint8Array(16)));
  const signature=await sign(key,await requestBytes(method,path.split("?")[0],time,nonce,bytes));
  return worker.fetch(new Request(`https://peta.test${path}`,{method,headers:{"X-Peta-Key":await pub(key),"X-Peta-Time":time,"X-Peta-Nonce":nonce,"X-Peta-Sig":signature},...(method==='GET'?{}:{body:bytes})}),e);
}
async function error(r:Response,status:number,code:string) { expect(r.status).toBe(status); expect((await r.json() as any).error).toBe(code); }
async function mailbox(k:CryptoKeyPair) {
  const enc=crypto.getRandomValues(new Uint8Array(32)),name="Friend";
  expect((await req("/v1/mailbox","POST",{signKey:await pub(k),encKey:base64(enc),name,binding:await sign(k,bindingBytes(enc,name))},k)).status).toBe(200);
  return mailboxId(await pub(k));
}
async function allow(from:CryptoKeyPair,to:CryptoKeyPair,add=true) {
  return req(`/v1/mailbox/${await mailboxId(await pub(from))}/allow`,"PUT",{[add?'add':'remove']:[await hash(to)]},from);
}
async function claim(pack:string,slot=0,key=b,seq=1):Promise<Transfer> {
  const t={stickerId:`${pack}-edition`,seq,kind:"claim",actorKey:await pub(key),ref:`${pack}:slot-${slot}`,at:new Date().toISOString(),sig:""};
  t.sig=await sign(key,transferBytes(t)); return t;
}
async function make(count=6,open=true,e=bindings) {
  const packId=`pack-${id()}`,listingId=id();
  const creation:Creation={stickerId:`${packId}-edition`,creatorPublicKey:await pub(a),creatorName:"Maker",createdAt:new Date().toISOString(),imageDigest:"a".repeat(64),creatorSig:null,editionNo:1,editionTotal:1};
  creation.creatorSig=await sign(a,creationBytes(creation));
  const release:Transfer={stickerId:creation.stickerId,seq:0,kind:"release",actorKey:await pub(a),ref:`${packId}:slot-0`,at:new Date().toISOString(),sig:""};release.sig=await sign(a,transferBytes(release));
  const registration={packId,creatorKey:await pub(a),slotCount:count,headerDigest:"b".repeat(64),editions:[{creation,release}],movedReleases:[]};
  expect((await req("/v1/packs","POST",registration,a,e)).status).toBe(200);
  const ciphertext=(tag:number)=>new Uint8Array([...utf8("PETAMKT1"),...new Uint8Array(12).fill(tag),...crypto.getRandomValues(new Uint8Array(64))]);
  const card=ciphertext(1),pack=ciphertext(2);
  const listing={listingId,packId,price:6,cardDigest:await sha256(card),cardSize:card.length,packDigest:await sha256(pack),packSize:pack.length};
  expect((await req("/v1/market/listings","POST",listing,a,e)).status).toBe(200);
  expect((await req(`/v1/market/listings/${listingId}/card`,"PUT",card,a,e)).status).toBe(200);
  expect((await req(`/v1/market/listings/${listingId}/pack`,"PUT",pack,a,e)).status).toBe(200);
  for (const friend of [b,d]) {
    expect((await allow(a,friend)).status).toBe(200); expect((await allow(friend,a)).status).toBe(200);
  }
  expect((await req(`/v1/market/listings/${listingId}/envelopes`,"PUT",{add:await Promise.all([b,d].map(async k=>({to:await hash(k),sealed:base64(new Uint8Array(80))}))),remove:[]})).status).toBe(200);
  if (open) expect((await req(`/v1/market/listings/${listingId}/open`,"POST",{})).status).toBe(200);
  return {listing,listingId,packId,card,pack,registration};
}
const pull = (listing:string,slot:number,key=b,transfer:Transfer|null=null,pullId=id(),e=bindings,price=6) => req(`/v1/market/listings/${listing}/pulls/${pullId}`,"POST",{slot,claim:transfer,price},key,e);
beforeAll(async()=>{
  await applyD1Migrations(db,(env as any).TEST_MIGRATIONS);
  [a,b,c,d]=await Promise.all([1,2,3,4].map(()=>crypto.subtle.generateKey("Ed25519",true,["sign","verify"]) as Promise<CryptoKeyPair>));
});
beforeEach(async()=>{
  await db.batch(["market_sales","market_envelopes","market_listings","market_payout_marks","reports","mailboxes","pack_slots","packs","transfers","stickers","nonces","blocked_keys","rate_counters","assertions","cancelled_releases","cancelled_packs"].map(t=>db.prepare(`DELETE FROM ${t}`)));
  for (const bucket of [bindings.MARKET!,bindings.REPORTS!]) { const objects=await bucket.list(); if(objects.objects.length) await bucket.delete(objects.objects.map(o=>o.key)); }
  await Promise.all([a,b,c,d].map(mailbox));
});
it("only mutual friends holding an envelope can list, download or pull, even with a known listing ID",async()=>{
  const p=await make(); const list=await (await req("/v1/market/listings","GET",undefined,b)).json() as any[];
  expect(list).toHaveLength(1); expect(list[0]).toMatchObject({listingId:p.listingId,price:6,slotsLeft:6});
  expect(JSON.stringify(list)).not.toContain(await pub(a));
  expect(await (await req("/v1/market/listings","GET",undefined,c)).json()).toEqual([]);
  for(const kind of ['card','pack']) await error(await req(`/v1/market/listings/${p.listingId}/${kind}`,"GET",undefined,c),403,"not_friend");
  await error(await pull(p.listingId,1,c),403,"not_friend");
  await allow(b,a,false);
  expect(await (await req("/v1/market/listings","GET",undefined,b)).json()).toEqual([]);
  await error(await pull(p.listingId,1),403,"not_friend");
  await allow(b,a); await req(`/v1/market/listings/${p.listingId}/envelopes`,"PUT",{remove:[await hash(b)]});
  await error(await req(`/v1/market/listings/${p.listingId}/card`,"GET",undefined,b),403,"not_friend");
});
it("registration and uploads are idempotent, bounded, immutable and restricted to the registered maker",async()=>{
  const p=await make(6,false);
  expect((await req("/v1/market/listings","POST",p.listing)).status).toBe(200);
  await error(await req("/v1/market/listings","POST",{...p.listing,cardDigest:'c'.repeat(64)}),409,"taken");
  await error(await req("/v1/market/listings","POST",{...p.listing,listingId:id()},b),403,"not_yours");
  await error(await req(`/v1/market/listings/${p.listingId}/card`,"PUT",p.card,b),403,"not_yours");
  await error(await req(`/v1/market/listings/${p.listingId}/card`,"PUT",new Uint8Array(1048576+37)),413,"too_large");
  const bent=p.card.slice();bent[40]^=1;
  await error(await req(`/v1/market/listings/${p.listingId}/card`,"PUT",bent),400,"digest_mismatch");
  expect(await bindings.MARKET!.head(`market/${p.listingId}/card`)).toBeNull();
  await error(await req(`/v1/market/listings/${p.listingId}/open`,"POST",{}),409,"incomplete_listing");
  expect((await req(`/v1/market/listings/${p.listingId}/card`,"PUT",p.card)).status).toBe(200);
  expect((await req(`/v1/market/listings/${p.listingId}/open`,"POST",{})).status).toBe(200);
});
it("envelopes require the seller's allow list and stay bounded",async()=>{
  const p=await make();
  await error(await req(`/v1/market/listings/${p.listingId}/envelopes`,"PUT",{add:[{to:await hash(c),sealed:base64(new Uint8Array(80))}]}),403,"not_friend");
  await error(await req(`/v1/market/listings/${p.listingId}/envelopes`,"PUT",{add:[],remove:new Array(201).fill(await hash(b))}),400,"invalid");
  await error(await req(`/v1/market/listings/${p.listingId}/envelopes`,"PUT",{add:[{to:await hash(b),sealed:base64(new Uint8Array(513))}]}),400,"invalid");
});
it("edition ownership and a sale commit together, with exactly one concurrent winner",async()=>{
  const p=await make(),tb=await claim(p.packId,0,b),td=await claim(p.packId,0,d);
  const outcomes=await Promise.all([pull(p.listingId,0,b,tb),pull(p.listingId,0,d,td)]);
  expect(outcomes.map(r=>r.status).sort()).toEqual([200,409]);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM market_sales").first("n")).toBe(1);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM pack_slots WHERE claimer_key IS NOT NULL").first("n")).toBe(1);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM transfers WHERE kind='claim'").first("n")).toBe(1);
});
it("a bad signed claim rolls back both the slot and sale",async()=>{
  const p=await make();await error(await pull(p.listingId,0,b,await claim(p.packId,0,b,9)),409,"seq_mismatch");
  expect(await db.prepare("SELECT COUNT(*) n FROM market_sales").first("n")).toBe(0);
  expect(await db.prepare("SELECT COUNT(*) n FROM pack_slots WHERE claimer_key IS NOT NULL").first("n")).toBe(0);
});
it("same-pull retries return the same sale, including after a listing closes",async()=>{
  const p=await make(),t=await claim(p.packId),pid=id();
  const first=await (await pull(p.listingId,0,b,t,pid)).json();
  expect(await (await pull(p.listingId,0,b,t,pid)).json()).toEqual(first);
  await error(await pull(p.listingId,1,b,null,pid),409,"pull_used");
  await error(await pull(p.listingId,0,d,await claim(p.packId,0,d),pid),409,"pull_used");
  await req(`/v1/market/listings/${p.listingId}`,"DELETE");
  expect(await (await pull(p.listingId,0,b,t,pid)).json()).toEqual(first);
  expect(await db.prepare("SELECT COUNT(*) n FROM market_sales").first("n")).toBe(1);
});
it("own packs, changed prices, paused packs and sold-out packs reject without sales",async()=>{
  const p=await make(2);
  await error(await pull(p.listingId,1,a),403,"own_pack");
  await error(await pull(p.listingId,1,b,null,id(),bindings,4),409,"price_changed");
  await req(`/v1/market/listings/${p.listingId}/pause`,"POST",{});
  expect((await (await req("/v1/market/listings","GET",undefined,b)).json() as any[])[0].state).toBe('paused');
  await error(await pull(p.listingId,1),409,"listing_closed");
  await req(`/v1/market/listings/${p.listingId}/open`,"POST",{});
  expect((await pull(p.listingId,0,b,await claim(p.packId))).status).toBe(200);
  expect((await pull(p.listingId,1)).status).toBe(200);
  await error(await pull(p.listingId,1,d),409,"sold_out");
});
it("a rolling 24-hour pull limit is atomic and does not count retries twice",async()=>{
  const p=await make(),limited={...bindings,MARKET_PULLS_PER_DAY:'2'},pid=id();
  expect((await pull(p.listingId,1,b,null,pid,limited)).status).toBe(200);
  expect((await pull(p.listingId,2,b,null,id(),limited)).status).toBe(200);
  await error(await pull(p.listingId,3,b,null,id(),limited),429,"too_many_pulls");
  expect((await pull(p.listingId,1,b,null,pid,limited)).status).toBe(200);
  expect(await db.prepare("SELECT COUNT(*) n FROM market_sales").first("n")).toBe(2);
  await db.prepare("UPDATE market_sales SET at=?").bind(Math.floor(Date.now()/1000)-86401).run();
  expect((await pull(p.listingId,3,b,null,id(),limited)).status).toBe(200);
});
it("payouts are maker-only, retain milli-Scraps, and acknowledgements advance only after valid sales",async()=>{
  const p=await make();for(let slot=1;slot<6;slot++) expect((await pull(p.listingId,slot)).status).toBe(200);
  const sales=await (await req("/v1/market/payouts?after=0")).json() as any[];
  expect(sales).toHaveLength(5);expect(sales.reduce((n,s)=>n+s.cutMilli,0)).toBe(21000);
  expect(await (await req("/v1/market/payouts?after=0","GET",undefined,b)).json()).toEqual([]);
  expect((await req("/v1/market/payouts/ack","POST",{upTo:sales[1].saleId})).status).toBe(200);
  expect((await (await req("/v1/market/payouts?after=0")).json() as any[])).toHaveLength(3);
  await req("/v1/market/payouts/ack","POST",{upTo:sales[0].saleId});
  expect((await (await req(`\/v1/market/payouts?after=${sales[3].saleId}`)).json() as any[])).toHaveLength(1);
  await error(await req("/v1/market/payouts/ack","POST",{upTo:sales[4].saleId+1}),400,"invalid");
});
it("listed packs never regain free file opening, including after Stop selling",async()=>{
  const p=await make();await error(await req(`/v1/packs/${p.packId}/slots/1/claim`,"POST",{},b),403,"for_sale");
  expect((await req(`/v1/market/listings/${p.listingId}`,"DELETE")).status).toBe(200);
  expect((await req(`/v1/market/listings/${p.listingId}`,"DELETE")).status).toBe(200);
  await error(await req(`/v1/packs/${p.packId}/slots/1/claim`,"POST",{},b),403,"for_sale");
  expect(await bindings.MARKET!.head(`market/${p.listingId}/pack`)).toBeNull();
});
it("seller limits are configurable and exclude closed listings",async()=>{
  const limited={...bindings,MARKET_LISTINGS:'1'},p=await make(6,true,limited);
  const second={...p.listing,listingId:id()};
  await error(await req('/v1/market/listings','POST',second),409,'taken');
  // A separate registered pack cannot bypass the cap.
  const packId='another-pack',registration={...p.registration,packId,editions:[],movedReleases:[]};
  expect((await req('/v1/packs','POST',registration)).status).toBe(200);
  await error(await req('/v1/market/listings','POST',{...second,packId},a,limited),429,'too_many_listings');
  await req(`/v1/market/listings/${p.listingId}`,'DELETE');
  expect((await req('/v1/market/listings','POST',{...second,packId},a,limited)).status).toBe(200);
});
it("Remove immediately hides cached envelopes, while a completed claim stays held",async()=>{
  const p=await make();expect((await pull(p.listingId,0,b,await claim(p.packId))).status).toBe(200);
  await allow(a,b,false);
  expect(await (await req('/v1/market/listings','GET',undefined,b)).json()).toEqual([]);
  await error(await pull(p.listingId,1),403,'not_friend');
  expect(await db.prepare("SELECT holder_key FROM stickers WHERE id=?").bind(`${p.packId}-edition`).first('holder_key')).toBe(await pub(b));
});
it("leaving closes own listings and removes addressed envelopes and ciphertext, retaining sales",async()=>{
  const p=await make();expect((await pull(p.listingId,1)).status).toBe(200);
  expect((await req(`/v1/mailbox/${await mailboxId(await pub(a))}`,'DELETE')).status).toBe(200);
  expect(await db.prepare('SELECT state FROM market_listings').first('state')).toBe('closed');
  expect(await db.prepare('SELECT COUNT(*) n FROM market_envelopes').first('n')).toBe(0);
  expect(await db.prepare('SELECT COUNT(*) n FROM market_sales').first('n')).toBe(1);
  expect((await bindings.MARKET!.list()).objects).toHaveLength(0);
});
it("consented listing reports retain kind and opened card in the private report bucket",async()=>{
  const p=await make();const r=await req('/v1/report','POST',{kind:'listing',listingId:p.listingId,senderHash:await hash(a),reason:'test',card:base64(utf8('{"title":"opened"}'))},b);
  expect(r.status).toBe(200);const report=await r.json() as any;
  const saved=JSON.parse(await (await bindings.REPORTS!.get(`reports/${report.id}.json`))!.text());
  expect(saved).toMatchObject({kind:'listing',listingId:p.listingId});
  expect(await db.prepare('SELECT kind FROM reports').first('kind')).toBe('listing');
});
it("generic sticker and pack cancellation cannot extract listed editions, even after closure",async()=>{
  const p=await make();
  const original=(await db.prepare('SELECT state,seq,release_ref FROM stickers').all()).results;
  for(const closed of [false,true]) {
    if(closed) await req(`/v1/market/listings/${p.listingId}`,'DELETE');
    await error(await req(`/v1/stickers/${p.packId}-edition/cancel`,'POST',p.registration.editions[0].release),403,'for_sale');
    await error(await req(`/v1/packs/${p.packId}/cancel`,'POST',p.registration),403,'for_sale');
    expect((await db.prepare('SELECT state,seq,release_ref FROM stickers').all()).results).toEqual(original);
    expect(await db.prepare('SELECT COUNT(*) n FROM transfers').first('n')).toBe(1);
  }
});
it("an exact committed purchase recovers after buyer or seller blocking, while new purchases are refused",async()=>{
  const p=await make(),pid=id(),t=await claim(p.packId);
  const first=await (await pull(p.listingId,0,b,t,pid)).json();
  for(const blocked of [b,a]) {
    await db.prepare('DELETE FROM blocked_keys').run();
    await db.prepare('INSERT INTO blocked_keys VALUES(?,?,?)').bind(await hash(blocked),'test',0).run();
    expect(await (await pull(p.listingId,0,b,t,pid)).json()).toEqual(first);
    await error(await pull(p.listingId,1),403,'blocked');
    expect(await db.prepare('SELECT COUNT(*) n FROM market_sales').first('n')).toBe(1);
  }
});
it("a non-friend cannot learn sold-out state by calling pulls with a known ID",async()=>{
  const p=await make(1);expect((await pull(p.listingId,0,b,await claim(p.packId))).status).toBe(200);
  await error(await pull(p.listingId,0,c),403,'not_friend');
});
