import {Creation,Transfer,creationBytes,transferBytes,requestBytes,utf8,unbase64,sha256,verify} from './proofs';
export interface Env {DB:D1Database;RATE_LIMITER?:RateLimit;REQUESTS_PER_MINUTE?:string;PACKS_PER_HOUR?:string}
class ApiError extends Error {constructor(public status:number,public code:string){super(code);}}
function fail(status:number,code:string):never {throw new ApiError(status,code);}
const ok=()=>Response.json({ok:true});
const safeId=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(s);
const uint=(n:unknown,max:number):n is number=>Number.isInteger(n)&&Number(n)>=0&&Number(n)<=max;
function at(s:unknown):number {if(typeof s!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s))fail(400,'invalid');const t=Date.parse(s)/1000;if(!Number.isFinite(t))fail(400,'invalid');if(t>Date.now()/1000+300)fail(400,'future_time');return t;}
async function creation(c:Creation,key:string){if(!c||!safeId(c.stickerId)||typeof c.imageDigest!=='string'||!/^[a-f0-9]{64}$/.test(c.imageDigest)||c.legacy!=null||c.creatorName!==null&&(typeof c.creatorName!=='string'||c.creatorName.length>200))fail(400,'invalid');if(c.creatorPublicKey!==key)fail(403,'not_yours');at(c.createdAt);if((c.editionNo==null)!==(c.editionTotal==null)||c.editionNo!=null&&(!uint(c.editionNo,30)||c.editionNo<1||!uint(c.editionTotal,30)||c.editionTotal<c.editionNo))fail(400,'invalid');if(!c.creatorSig||!await verify(key,creationBytes(c),c.creatorSig))fail(401,'bad_signature');}
async function transfer(t:Transfer,key:string,kind:string,id?:string){if(!t||!safeId(t.stickerId)||id!==undefined&&id!==t.stickerId||!uint(t.seq,255)||t.kind!==kind||typeof t.ref!=='string'||!t.ref.length||t.ref.length>512)fail(400,'invalid');if(t.actorKey!==key)fail(403,'not_yours');at(t.at);if(!await verify(key,transferBytes(t),t.sig))fail(401,'bad_signature');}
const stmt=(db:D1Database,sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
function assertion(db:D1Database,code:string,condition:string,...args:unknown[]){return stmt(db,`INSERT INTO assertions(code,ok) SELECT '${code}',CASE WHEN ${condition} THEN 1 ELSE 0 END`,...args);}
const sqlCodes=['taken','not_yours','unknown_pack','unknown','already_claimed','slot_taken','already_opened','seq_mismatch','ref_mismatch','already_released','time_order','invalid'];
async function batch(db:D1Database,statements:D1PreparedStatement[]){try {return await db.batch([...statements,db.prepare('DELETE FROM assertions')]);}catch(e){const message=String(e);const code=[...sqlCodes].sort((a,b)=>b.length-a.length).find(c=>message.includes(c));if(code)fail(code==='not_yours'?403:code.startsWith('unknown')?404:409,code);throw e;}}
async function insertTransfer(db:D1Database,t:Transfer){return stmt(db,'INSERT INTO transfers(sticker_id,seq,kind,actor_key,ref,at,sig,received_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(sticker_id,seq) DO NOTHING',t.stickerId,t.seq,t.kind,t.actorKey,t.ref,t.at,t.sig,Math.floor(Date.now()/1000));}
function insertCreation(db:D1Database,c:Creation){return stmt(db,"INSERT INTO stickers(id,creator_key,creator_sig,creation,holder_key,state,registered_at,updated_at) VALUES(?,?,?,?,?,'held',?,?) ON CONFLICT(id) DO NOTHING",c.stickerId,c.creatorPublicKey,c.creatorSig,JSON.stringify(c),c.creatorPublicKey,Math.floor(Date.now()/1000),Math.floor(Date.now()/1000));}
function creationGuard(db:D1Database,c:Creation){return assertion(db,'taken','NOT EXISTS(SELECT 1 FROM stickers WHERE id=? AND creator_sig!=?)',c.stickerId,c.creatorSig);}
async function counter(env:Env,hash:string,kind:string,period:number,limit:number){const window=Math.floor(Date.now()/1000/period)*period;const rows=await env.DB.batch([stmt(env.DB,'DELETE FROM rate_counters WHERE window<?',window-3600),stmt(env.DB,'INSERT INTO rate_counters VALUES(?,?,?,1) ON CONFLICT(key_hash,kind,window) DO UPDATE SET count=count+1 RETURNING count',hash,kind,window)]);if(Number((rows[1].results[0] as {count:number})?.count)>limit)fail(429,'slow_down');}
async function authenticate(request:Request,env:Env,path:string,body:Uint8Array):Promise<string>{
 const key=request.headers.get('X-Peta-Key')??'',time=request.headers.get('X-Peta-Time')??'',nonce=request.headers.get('X-Peta-Nonce')??'',sig=request.headers.get('X-Peta-Sig')??'';
 if(!/^\d{1,12}$/.test(time)||Math.abs(Number(time)-Date.now()/1000)>300)fail(401,'clock_skew');
 try{unbase64(key,32);unbase64(nonce,16);}catch{fail(401,'bad_signature');}
 if(!await verify(key,await requestBytes(request.method,path,time,nonce,body),sig))fail(401,'bad_signature');
 const hash=await sha256(unbase64(key,32));
 if(await stmt(env.DB,'SELECT 1 FROM blocked_keys WHERE key_hash=?',hash).first())fail(403,'blocked');
 const minute=Number(env.REQUESTS_PER_MINUTE??60),hour=Number(env.PACKS_PER_HOUR??20);
 if(env.RATE_LIMITER&&minute===60&&!((await env.RATE_LIMITER.limit({key:hash})).success))fail(429,'slow_down');
 await counter(env,hash,'minute',60,minute);
 if(request.method==='POST'&&path==='/v1/packs')await counter(env,hash,'packs',3600,hour);
 if(request.method==='POST'){const now=Math.floor(Date.now()/1000);try{await env.DB.batch([stmt(env.DB,'DELETE FROM nonces WHERE expires_at<?',now),stmt(env.DB,'INSERT INTO nonces VALUES(?,?,?)',hash,nonce,now+600)]);}catch(e){if(String(e).includes('UNIQUE'))fail(401,'replay');throw e;}}
 return key;
}
interface PackRegistration {packId:string;creatorKey:string;slotCount:number;headerDigest:string;editions:{creation:Creation;release:Transfer}[];movedReleases:Transfer[]}
async function registerPack(env:Env,key:string,p:PackRegistration){
 if(!p||!safeId(p.packId)||p.creatorKey!==key)fail(403,'not_yours');if(!uint(p.slotCount,200)||p.slotCount<1||typeof p.headerDigest!=='string'||!/^[a-f0-9]{64}$/.test(p.headerDigest)||!Array.isArray(p.editions)||!Array.isArray(p.movedReleases)||p.editions.length+p.movedReleases.length>p.slotCount)fail(400,'invalid');
 const identities=new Set<string>(),slots=new Set<number>();
 const members:{slot:number;sticker:string;minted:number;sig:string}[]=[];
 const releases:Transfer[]=[];
 for(const entry of p.editions){await creation(entry.creation,key);if(entry.creation.editionNo==null)fail(400,'invalid');await transfer(entry.release,key,'release',entry.creation.stickerId);if(entry.release.seq!==0)fail(400,'seq_mismatch');releases.push(entry.release);}
 for(const t of p.movedReleases){await transfer(t,key,'release');releases.push(t);}
 for(const [i,t] of releases.entries()){const prefix=`${p.packId}:slot-`;const s=t.ref.startsWith(prefix)?t.ref.slice(prefix.length):'';const n=Number(s);if(!/^(0|[1-9]\d*)$/.test(s)||!uint(n,p.slotCount-1)||identities.has(t.stickerId)||slots.has(n))fail(400,'invalid');identities.add(t.stickerId);slots.add(n);members.push({slot:n,sticker:t.stickerId,minted:i<p.editions.length?1:0,sig:t.sig});}
 const registration=await sha256(utf8(JSON.stringify(p)));const now=Math.floor(Date.now()/1000);
 const existing=await stmt(env.DB,'SELECT creator_key,registration_digest FROM packs WHERE pack_id=?',p.packId).first<{creator_key:string;registration_digest:string}>();
 if(existing){if(existing.creator_key!==key)fail(403,'not_yours');if(existing.registration_digest!==registration)fail(409,'taken');return ok();}
 const q=[assertion(env.DB,'taken','NOT EXISTS(SELECT 1 FROM packs WHERE pack_id=?)',p.packId),stmt(env.DB,'INSERT INTO packs VALUES(?,?,?,?,?,?)',p.packId,key,p.slotCount,p.headerDigest,registration,now)];
 // Bulk JSON inserts stay below D1 subrequest limits even for 200 slots.
 q.push(assertion(env.DB,'taken',"NOT EXISTS(SELECT 1 FROM json_each(?) j JOIN stickers s ON s.id=json_extract(j.value,'$.creation.stickerId'))",JSON.stringify(p.editions)));
 q.push(stmt(env.DB,"INSERT INTO stickers(id,creator_key,creator_sig,creation,holder_key,state,registered_at,updated_at) SELECT json_extract(value,'$.creation.stickerId'),?,json_extract(value,'$.creation.creatorSig'),json_extract(value,'$.creation'),?,'held',?,? FROM json_each(?)",key,key,now,now,JSON.stringify(p.editions)));
 q.push(stmt(env.DB,'WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x+1<?) INSERT INTO pack_slots(pack_id,slot_no) SELECT ?,x FROM n',p.slotCount,p.packId));
 q.push(stmt(env.DB,"UPDATE pack_slots SET sticker_id=json_extract(j.value,'$.sticker'),minted=json_extract(j.value,'$.minted'),release_sig=json_extract(j.value,'$.sig') FROM json_each(?) j WHERE pack_id=? AND slot_no=json_extract(j.value,'$.slot')",JSON.stringify(members),p.packId));
 q.push(stmt(env.DB,"INSERT INTO transfers SELECT json_extract(value,'$.stickerId'),json_extract(value,'$.seq'),json_extract(value,'$.kind'),json_extract(value,'$.actorKey'),json_extract(value,'$.ref'),json_extract(value,'$.at'),json_extract(value,'$.sig'),? FROM json_each(?)",now,JSON.stringify(releases)));
 await batch(env.DB,q);return ok();
}
async function cancelPack(env:Env,key:string,id:string,body:{headerDigest?:string}){
 const p=await stmt(env.DB,'SELECT * FROM packs WHERE pack_id=?',id).first<{creator_key:string;header_digest:string}>();if(!p)return ok();if(p.creator_key!==key)fail(403,'not_yours');if(body.headerDigest!==p.header_digest)fail(409,'ref_mismatch');
 await batch(env.DB,[assertion(env.DB,'not_yours','EXISTS(SELECT 1 FROM packs WHERE pack_id=? AND creator_key=? AND header_digest=?)',id,key,body.headerDigest),assertion(env.DB,'already_opened','NOT EXISTS(SELECT 1 FROM pack_slots WHERE pack_id=? AND claimer_key IS NOT NULL)',id),
 assertion(env.DB,'already_claimed',"NOT EXISTS(SELECT 1 FROM pack_slots p JOIN stickers s ON s.id=p.sticker_id WHERE p.pack_id=? AND (s.state!='released' OR s.release_ref!=? || ':slot-' || p.slot_no OR NOT EXISTS(SELECT 1 FROM transfers t WHERE t.sticker_id=s.id AND t.seq=s.seq-1 AND t.sig=p.release_sig)))",id,id),
 stmt(env.DB,"UPDATE stickers SET state='held',seq=seq-1,release_ref=NULL,updated_at=? WHERE id IN (SELECT sticker_id FROM pack_slots WHERE pack_id=? AND minted=0)",Math.floor(Date.now()/1000),id),
 stmt(env.DB,'DELETE FROM transfers WHERE sig IN (SELECT release_sig FROM pack_slots WHERE pack_id=? AND minted=0)',id),
 stmt(env.DB,'DELETE FROM transfers WHERE sticker_id IN (SELECT sticker_id FROM pack_slots WHERE pack_id=? AND minted=1)',id),
 // Remove slots before identities because of the membership FK.
 stmt(env.DB,'DELETE FROM stickers WHERE id IN (SELECT sticker_id FROM pack_slots WHERE pack_id=? AND minted=1)',id),stmt(env.DB,'DELETE FROM packs WHERE pack_id=?',id)]);return ok();
}
async function claimSlot(env:Env,key:string,id:string,n:number,body:{claim?:Transfer|null}){
 const p=await stmt(env.DB,'SELECT slot_count FROM packs WHERE pack_id=?',id).first<{slot_count:number}>();if(!p)fail(404,'unknown_pack');if(!uint(n,p.slot_count-1))fail(400,'invalid');
 const t=body.claim??null;if(t){await transfer(t,key,'claim');if(t.ref!==`${id}:slot-${n}`)fail(409,'ref_mismatch');}
 const s=await stmt(env.DB,'SELECT * FROM pack_slots WHERE pack_id=? AND slot_no=?',id,n).first<{sticker_id:string|null;claimer_key:string|null;claim_sig:string|null}>();if(!s)fail(400,'invalid');
 if(s.claimer_key){if(s.claimer_key===key&&s.claim_sig===(t?.sig??''))return ok();fail(409,'slot_taken');}
 if(s.sticker_id!==(t?.stickerId??null))fail(400,'invalid');
 const q=[assertion(env.DB,'unknown_pack','EXISTS(SELECT 1 FROM packs WHERE pack_id=?)',id),assertion(env.DB,'slot_taken','EXISTS(SELECT 1 FROM pack_slots WHERE pack_id=? AND slot_no=? AND (claimer_key IS NULL OR (claimer_key=? AND claim_sig=?)))',id,n,key,t?.sig??''),stmt(env.DB,'UPDATE pack_slots SET claimer_key=?,claim_sig=?,claimed_at=? WHERE pack_id=? AND slot_no=? AND claimer_key IS NULL',key,t?.sig??'',Math.floor(Date.now()/1000),id,n)];
 if(t)q.push(await insertTransfer(env.DB,t));await batch(env.DB,q);return ok();
}
async function route(request:Request,env:Env):Promise<Response>{
 const path=new URL(request.url).pathname;if(path==='/v1/health'&&request.method==='GET')return ok();if(!['GET','POST'].includes(request.method))fail(405,'method_not_allowed');
 if(Number(request.headers.get('Content-Length')??0)>1024*1024)fail(413,'too_large');const body=new Uint8Array(await request.arrayBuffer());if(body.length>1024*1024)fail(413,'too_large');
 const key=await authenticate(request,env,path,body);let data:any={};if(body.length){try{data=JSON.parse(new TextDecoder().decode(body));}catch{fail(400,'invalid');}if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'invalid');}
 if(request.method==='POST'&&path==='/v1/stickers'){await creation(data,key);await batch(env.DB,[creationGuard(env.DB,data),insertCreation(env.DB,data)]);return ok();}
 const sticker=/^\/v1\/stickers\/([A-Za-z0-9_-]+)(?:\/(release|claim|cancel))?$/.exec(path);
 if(sticker){const [,id,action]=sticker;if(request.method==='GET'&&!action){const row=await stmt(env.DB,'SELECT holder_key,state,seq,release_ref FROM stickers WHERE id=?',id).first();if(!row)fail(404,'unknown');return Response.json(row);}
 if(request.method==='POST'&&action){const t:Transfer=data;await transfer(t,key,action==='cancel'?'release':action,id);
 if(action==='cancel'){await batch(env.DB,[assertion(env.DB,'unknown','EXISTS(SELECT 1 FROM stickers WHERE id=?)',id),assertion(env.DB,'not_yours','EXISTS(SELECT 1 FROM stickers WHERE id=? AND holder_key=?)',id,key),assertion(env.DB,'ref_mismatch',"EXISTS(SELECT 1 FROM stickers WHERE id=? AND (state='held' OR (seq=? AND release_ref=? AND EXISTS(SELECT 1 FROM transfers WHERE sticker_id=? AND seq=? AND sig=?))))",id,t.seq+1,t.ref,id,t.seq,t.sig),stmt(env.DB,"DELETE FROM transfers WHERE sticker_id=? AND seq=? AND sig=? AND EXISTS(SELECT 1 FROM stickers WHERE id=? AND state='released')",id,t.seq,t.sig,id),stmt(env.DB,"UPDATE stickers SET state='held',seq=?,release_ref=NULL,updated_at=? WHERE id=? AND state='released' AND seq=? AND release_ref=?",t.seq,Math.floor(Date.now()/1000),id,t.seq+1,t.ref)]);return ok();}
 await batch(env.DB,[await insertTransfer(env.DB,t)]);return ok();}}
 if(path==='/v1/packs'&&request.method==='POST')return registerPack(env,key,data);
 const pack=/^\/v1\/packs\/([A-Za-z0-9_-]+)\/(cancel|slots)(?:\/(\d+)\/claim)?$/.exec(path);
 if(pack){const [,id,action,num]=pack;if(request.method==='POST'&&action==='cancel'&&num===undefined)return cancelPack(env,key,id,data);if(request.method==='POST'&&action==='slots'&&num!==undefined)return claimSlot(env,key,id,Number(num),data);
 if(request.method==='GET'&&action==='slots'&&num===undefined){if(!await stmt(env.DB,'SELECT 1 FROM packs WHERE pack_id=?',id).first())fail(404,'unknown_pack');const rows=await stmt(env.DB,'SELECT slot_no FROM pack_slots WHERE pack_id=? AND claimer_key IS NOT NULL ORDER BY slot_no',id).all<{slot_no:number}>();return Response.json({slots:rows.results.map(r=>r.slot_no)});}}
 fail(404,'not_found');
}
export default {async fetch(request:Request,env:Env):Promise<Response>{try{return await route(request,env);}catch(e){const err=e instanceof ApiError?e:new ApiError(503,'unavailable');return Response.json({error:err.code,message:err.status===503?'Please try again later.':`Request refused: ${err.code}.`},{status:err.status});}}};
