/* Friend Market. Only ciphertext is stored; slot claims and sale receipts share one D1 transaction. */
import { Env, fail, ok, stmt, assertion, batch, slotClaimStatements } from "./index";
import { keyHash, mailboxId } from "./inbox";
import { sha256, unbase64, Transfer } from "./proofs";
export const FRIEND_PULL_PRICE = 6;
export const SELLER_CUT_PERMILLE = 700;
export const MARKET_PULLS_PER_DAY = 20;
export const MARKET_LISTINGS = 10;
export const MARKET_CARD_MAX = 1024 * 1024;
export const MARKET_PACK_MAX = 24 * 1024 * 1024;
export const SEALED_OVERHEAD = 36;
const now = () => Math.floor(Date.now() / 1000);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(v);
const uint = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const cap = (v: string | undefined, fallback: number, maximum: number) => {
  const n = Number(v ?? fallback); return uint(n, maximum) && n > 0 ? n : fallback;
};
export function contentLimit(env: Env, kind: string) {
  return (kind === "card" ? cap(env.MARKET_CARD_MAX, MARKET_CARD_MAX, MARKET_CARD_MAX) : MARKET_PACK_MAX) + SEALED_OVERHEAD;
}
interface Listing {
  listing_id: string; pack_id: string; seller_key: string; seller_hash: string; price: number; cut_permille: number;
  state: string; card_digest: string; card_size: number; pack_digest: string; pack_size: number; updated_at: number;
}
const row = (env: Env, listing: string) => stmt(env.DB, "SELECT * FROM market_listings WHERE listing_id=?", listing).first<Listing>();
async function own(env: Env, key: string, listing: string) {
  const l = await row(env, listing); if (!l) fail(404, "unknown_listing");
  if (l.seller_key !== key) fail(403, "not_yours"); return l;
}
// The stored hash is derived from the signing key, never supplied by a client.
const FRIEND = `EXISTS(SELECT 1 FROM mailboxes seller JOIN mailbox_allow sa ON sa.mailbox_id=seller.id
 JOIN mailboxes buyer ON buyer.sign_key=? JOIN mailbox_allow ba ON ba.mailbox_id=buyer.id
 WHERE seller.sign_key=l.seller_key AND sa.key_hash=? AND ba.key_hash=l.seller_hash)
 AND NOT EXISTS(SELECT 1 FROM blocked_keys WHERE key_hash=l.seller_hash)`;
const ELIGIBLE = `l.state IN ('open','paused') AND EXISTS(SELECT 1 FROM market_envelopes e WHERE e.listing_id=l.listing_id AND e.recipient_hash=?) AND ${FRIEND}`;
async function visible(env: Env, key: string, listing: string) {
  const buyer = await keyHash(key);
  const l = await stmt(env.DB, `SELECT l.* FROM market_listings l WHERE l.listing_id=? AND ${ELIGIBLE}`, listing, buyer, key, buyer).first<Listing>();
  if (!l) fail(403, "not_friend"); return l;
}
async function register(env: Env, key: string, data: any) {
  const { listingId, packId, price, cardDigest, cardSize, packDigest, packSize } = data;
  if (!id(listingId) || typeof packId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(packId) || price !== FRIEND_PULL_PRICE || !hash(cardDigest) || !hash(packDigest) || !uint(cardSize, contentLimit(env,"card")) || cardSize < SEALED_OVERHEAD || !uint(packSize,contentLimit(env,"pack")) || packSize < SEALED_OVERHEAD) fail(400,"invalid");
  const seller = await keyHash(key), limit = cap(env.MARKET_LISTINGS, MARKET_LISTINGS, 100);
  await batch(env.DB, [
    assertion(env.DB,"not_yours","EXISTS(SELECT 1 FROM packs WHERE pack_id=? AND creator_key=?)",packId,key),
    assertion(env.DB,"taken","NOT EXISTS(SELECT 1 FROM market_listings WHERE (pack_id=? OR listing_id=?) AND NOT (listing_id=? AND pack_id=? AND seller_key=? AND price=? AND card_digest=? AND card_size=? AND pack_digest=? AND pack_size=?))",packId,listingId,listingId,packId,key,price,cardDigest,cardSize,packDigest,packSize),
    assertion(env.DB,"too_many_listings","EXISTS(SELECT 1 FROM market_listings WHERE listing_id=?) OR (SELECT COUNT(*) FROM market_listings WHERE seller_key=? AND state!='closed')<?",listingId,key,limit),
    stmt(env.DB,"INSERT INTO market_listings VALUES(?,?,?,?,?,?,'draft',?,?,?,?,?,?) ON CONFLICT(listing_id) DO NOTHING",listingId,packId,key,seller,price,SELLER_CUT_PERMILLE,cardDigest,cardSize,packDigest,packSize,now(),now()),
  ]); return ok();
}
async function upload(env: Env, key: string, listing: string, kind: "card" | "pack", body: Uint8Array) {
  const l = await own(env,key,listing); if (l.state === "closed") fail(409,"listing_closed");
  if (!env.MARKET) fail(503,"unavailable");
  const object = `market/${listing}/${kind}`;
  if (body.length > contentLimit(env,kind)) fail(413,"too_large");
  const digest = await sha256(body);
  if (body.length !== l[`${kind}_size`] || digest !== l[`${kind}_digest`] || body.length < SEALED_OVERHEAD || new TextDecoder().decode(body.slice(0,8)) !== "PETAMKT1") {
    await env.MARKET.delete(object); fail(400,"digest_mismatch");
  }
  await env.MARKET.put(object,body,{customMetadata:{digest}});
  if ((await row(env,listing))?.state === "closed") { await env.MARKET.delete(object); fail(409,"listing_closed"); }
  return ok();
}
async function envelopes(env: Env, key: string, listing: string, data: any) {
  const l = await own(env,key,listing); if (l.state === "closed") fail(409,"listing_closed");
  const add = data.add ?? [], remove = data.remove ?? [];
  if (!Array.isArray(add) || !Array.isArray(remove) || add.length+remove.length>200 || !remove.every(hash)) fail(400,"invalid");
  for (const e of add) {
    if (!e || !hash(e.to) || typeof e.sealed !== "string" || e.sealed.length>684) fail(400,"invalid");
    try { const bytes = unbase64(e.sealed); if (bytes.length<48 || bytes.length>512) fail(400,"invalid"); } catch { fail(400,"invalid"); }
  }
  const mailbox = await mailboxId(key);
  await batch(env.DB,[
    assertion(env.DB,"listing_closed","EXISTS(SELECT 1 FROM market_listings WHERE listing_id=? AND state!='closed')",listing),
    assertion(env.DB,"not_friend","NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM mailbox_allow WHERE mailbox_id=? AND key_hash=json_extract(j.value,'$.to')))",JSON.stringify(add),mailbox),
    stmt(env.DB,"INSERT INTO market_envelopes SELECT ?,json_extract(value,'$.to'),json_extract(value,'$.sealed'),? FROM json_each(?) WHERE 1 ON CONFLICT(listing_id,recipient_hash) DO UPDATE SET sealed=excluded.sealed",listing,now(),JSON.stringify(add)),
    stmt(env.DB,"DELETE FROM market_envelopes WHERE listing_id=? AND recipient_hash IN (SELECT value FROM json_each(?))",listing,JSON.stringify(remove)),
  ]); return ok();
}
async function transition(env: Env,key:string,listing:string,action:string) {
  const l = await own(env,key,listing); if (l.state === "closed") fail(409,"listing_closed");
  if (action === "open") {
    if (!env.MARKET) fail(503,"unavailable");
    for (const kind of ["card","pack"] as const) {
      const object = await env.MARKET.get(`market/${listing}/${kind}`);
      if (!object || object.size !== l[`${kind}_size`] || await sha256(new Uint8Array(await object.arrayBuffer())) !== l[`${kind}_digest`]) fail(409,"incomplete_listing");
    }
  } else if (!['open','paused'].includes(l.state)) fail(409,"listing_closed");
  await batch(env.DB,[assertion(env.DB,"listing_closed","EXISTS(SELECT 1 FROM market_listings WHERE listing_id=? AND state!='closed')",listing),stmt(env.DB,"UPDATE market_listings SET state=?,updated_at=? WHERE listing_id=?",action==='open'?'open':'paused',now(),listing)]);
  return ok();
}
export async function closeListing(env:Env,key:string,listing:string) {
  await own(env,key,listing);
  // Fence purchases/uploads first; cleanup is idempotent after any R2 failure.
  await env.DB.batch([stmt(env.DB,"UPDATE market_listings SET state='closed',updated_at=? WHERE listing_id=?",now(),listing),stmt(env.DB,"DELETE FROM market_envelopes WHERE listing_id=?",listing)]);
  if (!env.MARKET) fail(503,"unavailable");
  await env.MARKET.delete([`market/${listing}/card`,`market/${listing}/pack`]); return ok();
}
export async function leaveMarket(env:Env,key:string) {
  const listings = await stmt(env.DB,"SELECT listing_id FROM market_listings WHERE seller_key=?",key).all<{listing_id:string}>();
  for (const l of listings.results) await closeListing(env,key,l.listing_id);
  await env.DB.batch([stmt(env.DB,"DELETE FROM market_envelopes WHERE recipient_hash=?",await keyHash(key))]);
}
async function pull(env:Env,key:string,listing:string,pullId:string,data:{slot:number;claim?:Transfer|null;price:number}) {
  if (!id(pullId) || !uint(data.slot,199) || !uint(data.price,1000)) fail(400,"invalid");
  const l = await row(env,listing); if (!l) fail(404,"unknown_listing");
  const buyer = await keyHash(key), sig = data.claim?.sig ?? "";
  const prior = await stmt(env.DB,"SELECT * FROM market_sales WHERE pull_id=?",pullId).first<{listing_id:string;buyer_hash:string;slot_no:number;price:number}>();
  if (prior && (prior.listing_id!==listing || prior.buyer_hash!==buyer || prior.slot_no!==data.slot || prior.price!==data.price)) fail(409,"pull_used");
  if (prior) {
    const saved = await stmt(env.DB,"SELECT claim_sig FROM pack_slots WHERE pack_id=? AND slot_no=?",l.pack_id,data.slot).first<string>("claim_sig");
    if (saved !== sig) fail(409,"pull_used");
  }
  if (!prior) {
    if (await stmt(env.DB,"SELECT 1 FROM blocked_keys WHERE key_hash IN (?,?)",buyer,l.seller_hash).first()) fail(403,"blocked");
    if (l.seller_key===key) fail(403,"own_pack");
    await visible(env,key,listing);
    if (!await stmt(env.DB,"SELECT 1 FROM pack_slots WHERE pack_id=? AND claimer_key IS NULL",l.pack_id).first()) fail(409,"sold_out");
  }
  const claims = await slotClaimStatements(env,key,l.pack_id,data.slot,data);
  const replay = "EXISTS(SELECT 1 FROM market_sales s JOIN pack_slots p ON p.pack_id=s.pack_id AND p.slot_no=s.slot_no WHERE s.pull_id=? AND s.listing_id=? AND s.buyer_hash=? AND s.slot_no=? AND s.price=? AND p.claim_sig=?)";
  const replayArgs = [pullId,listing,buyer,data.slot,data.price,sig];
  const limit = cap(env.MARKET_PULLS_PER_DAY,MARKET_PULLS_PER_DAY,10000);
  await batch(env.DB,[
    assertion(env.DB,"pull_used","NOT EXISTS(SELECT 1 FROM market_sales WHERE pull_id=?) OR "+replay,pullId,...replayArgs),
    assertion(env.DB,"blocked",`(${replay}) OR NOT EXISTS(SELECT 1 FROM blocked_keys WHERE key_hash IN (?,?))`,...replayArgs,buyer,l.seller_hash),
    assertion(env.DB,"own_pack","EXISTS(SELECT 1 FROM market_listings WHERE listing_id=? AND seller_key!=?)",listing,key),
    assertion(env.DB,"listing_closed",`(${replay}) OR EXISTS(SELECT 1 FROM market_listings WHERE listing_id=? AND state='open')`,...replayArgs,listing),
    assertion(env.DB,"not_friend",`(${replay}) OR EXISTS(SELECT 1 FROM market_listings l WHERE l.listing_id=? AND ${ELIGIBLE})`,...replayArgs,listing,buyer,key,buyer),
    assertion(env.DB,"price_changed",`(${replay}) OR EXISTS(SELECT 1 FROM market_listings WHERE listing_id=? AND price=?)`,...replayArgs,listing,data.price),
    assertion(env.DB,"too_many_pulls",`(${replay}) OR (SELECT COUNT(*) FROM market_sales WHERE buyer_hash=? AND at>?)<?`,...replayArgs,buyer,now()-86400,limit),
    assertion(env.DB,"sold_out",`(${replay}) OR EXISTS(SELECT 1 FROM pack_slots WHERE pack_id=? AND claimer_key IS NULL)`,...replayArgs,l.pack_id),
    assertion(env.DB,"slot_taken",`(${replay}) OR EXISTS(SELECT 1 FROM pack_slots WHERE pack_id=? AND slot_no=? AND claimer_key IS NULL)`,...replayArgs,l.pack_id,data.slot),
    ...claims,
    stmt(env.DB,"INSERT INTO market_sales(listing_id,pack_id,slot_no,pull_id,buyer_hash,seller_key,price,cut_milli,at) SELECT listing_id,pack_id,?,?,?,seller_key,price,price*cut_permille,? FROM market_listings WHERE listing_id=? AND NOT EXISTS(SELECT 1 FROM market_sales WHERE pull_id=?)",data.slot,pullId,buyer,now(),listing,pullId),
  ]);
  const sale = await stmt(env.DB,"SELECT sale_id AS saleId FROM market_sales WHERE pull_id=?",pullId).first<{saleId:number}>();
  const left = await stmt(env.DB,"SELECT COUNT(*) AS n FROM pack_slots WHERE pack_id=? AND claimer_key IS NULL",l.pack_id).first<number>("n");
  return Response.json({saleId:sale!.saleId,slotsLeft:Number(left)});
}
export async function market(request:Request,env:Env,path:string,key:string,body:Uint8Array,data:any):Promise<Response|null> {
  const method = request.method;
  if (path === "/v1/market/payouts" && method === "GET") {
    const after = Number(new URL(request.url).searchParams.get("after") ?? 0); if (!uint(after)) fail(400,"invalid");
    const rows = await stmt(env.DB,"SELECT sale_id AS saleId,pack_id AS packId,slot_no AS slot,cut_milli AS cutMilli,at,buyer_hash AS buyerHash FROM market_sales WHERE seller_key=? AND sale_id>MAX(?,COALESCE((SELECT acked_upto FROM market_payout_marks WHERE seller_key=?),0)) ORDER BY sale_id LIMIT 200",key,after,key).all(); return Response.json(rows.results);
  }
  if (path === "/v1/market/payouts/ack" && method === "POST") {
    if (!uint(data.upTo)) fail(400,"invalid");
    const max = Number(await stmt(env.DB,"SELECT COALESCE(MAX(sale_id),0) AS max FROM market_sales WHERE seller_key=?",key).first<number>("max") ?? 0);
    if (data.upTo>max) fail(400,"invalid");
    await env.DB.batch([stmt(env.DB,"INSERT INTO market_payout_marks VALUES(?,?) ON CONFLICT(seller_key) DO UPDATE SET acked_upto=MAX(acked_upto,excluded.acked_upto)",key,data.upTo)]); return ok();
  }
  if (path === "/v1/market/listings" && method === "POST") return register(env,key,data);
  if (path === "/v1/market/listings" && method === "GET") {
    const buyer = await keyHash(key);
    const rows = await stmt(env.DB,`SELECT l.listing_id AS listingId,l.seller_hash AS sellerHash,l.pack_id AS packId,l.price,l.state,p.slot_count AS slotCount,(SELECT COUNT(*) FROM pack_slots s WHERE s.pack_id=l.pack_id AND s.claimer_key IS NULL) AS slotsLeft,e.sealed,l.card_digest AS cardDigest,l.pack_digest AS packDigest,l.updated_at AS updatedAt FROM market_listings l JOIN packs p ON p.pack_id=l.pack_id JOIN market_envelopes e ON e.listing_id=l.listing_id AND e.recipient_hash=? WHERE ${ELIGIBLE} ORDER BY l.created_at,l.listing_id LIMIT 100`,buyer,buyer,key,buyer).all(); return Response.json(rows.results);
  }
  const m = /^\/v1\/market\/listings\/([A-Za-z0-9_-]{22})(?:\/(card|pack|envelopes|open|pause|pulls)(?:\/([A-Za-z0-9_-]{22}))?)?$/.exec(path);
  if (!m) return path.startsWith("/v1/market/") ? fail(404,"not_found") : null;
  const [, listing,action,pullId] = m; if (!id(listing)) fail(400,"invalid");
  if (!action && method === "DELETE") return closeListing(env,key,listing);
  if ((action === "card" || action === "pack") && method === "PUT") return upload(env,key,listing,action,body);
  if ((action === "card" || action === "pack") && method === "GET") {
    await visible(env,key,listing); if (!env.MARKET) fail(503,"unavailable");
    const object = await env.MARKET.get(`market/${listing}/${action}`); if (!object) fail(404,"unknown_listing");
    return new Response(object.body,{headers:{"Content-Type":"application/octet-stream"}});
  }
  if (action === "envelopes" && method === "PUT") return envelopes(env,key,listing,data);
  if ((action === "open" || action === "pause") && method === "POST") return transition(env,key,listing,action);
  if (action === "pulls" && pullId && method === "POST") return pull(env,key,listing,pullId,data);
  fail(405,"method_not_allowed");
}
