import {env,applyD1Migrations} from 'cloudflare:test';
import {beforeAll,beforeEach,expect,it} from 'vitest';
import worker,{type Env} from '../src/index';
import {sweepRecords} from '../src/invites';
import {base64,requestBytes} from '../src/proofs';
const use={...env,REQUESTS_PER_MINUTE:'10000',RATE_LIMITER:undefined} as unknown as Env,db=use.DB;
let key:CryptoKeyPair;
beforeAll(async()=>{await applyD1Migrations(db,(env as any).TEST_MIGRATIONS);key=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;});
beforeEach(async()=>{await db.batch(['daily_tables','nonces','rate_counters'].map(t=>db.prepare(`DELETE FROM ${t}`)));});
async function get(gated=false){const time=String(Math.floor(Date.now()/1000)),nonce=base64(crypto.getRandomValues(new Uint8Array(16))),path='/v1/daily-table';
 const pub=base64(new Uint8Array((await crypto.subtle.exportKey('raw',key.publicKey)) as ArrayBuffer));const sig=base64(new Uint8Array(await crypto.subtle.sign('Ed25519',key.privateKey,await requestBytes('GET',path,time,nonce,new Uint8Array()))));
 return worker.fetch(new Request('https://peta.test'+path,{headers:{'X-Peta-Key':pub,'X-Peta-Time':time,'X-Peta-Nonce':nonce,'X-Peta-Sig':sig}}),{...use,INVITE_REQUIRED:gated?'1':undefined});}
it('includes latest active default and active/future events, excluding stopped/ended tables',async()=>{
 const now=Math.floor(Date.now()/1000);
 for(const [id,kind,start,end,stopped] of [['old','default',now-100,now+100,null],['new','default',now-50,now+100,null],['live','event',now-10,now+100,null],['future','event',now+10,now+100,null],['ended','event',now-100,now,null],['stopped','event',now-10,now+100,now]])
  await db.prepare('INSERT INTO daily_tables VALUES(?,?,?,?,?,?,?)').bind(id,kind,start,end,id,now,stopped).run();
 expect(await(await get()).json()).toEqual({tables:['new','live','future']});expect((await get(true)).status).toBe(403);
});
it('caps future events at ten and sweeps only records older than one year',async()=>{
 const now=Math.floor(Date.now()/1000);
 for(let i=0;i<12;i++)await db.prepare('INSERT INTO daily_tables VALUES(?,?,?,?,?,?,NULL)').bind('e'+i,'event',now+i,now+100,'e'+i,now).run();
 expect((await(await get()).json<any>()).tables).toHaveLength(10);
 await db.prepare("INSERT INTO daily_tables VALUES('old','event',0,?,'old',0,NULL),('paused','event',0,?,'paused',0,?),('recent','event',0,?,'recent',0,NULL)").bind(now-366*86400,now+86400,now-366*86400,now-10).run();
 await sweepRecords(use,now);const rows=(await db.prepare("SELECT id FROM daily_tables WHERE id IN ('old','paused','recent')").all<any>()).results;expect(rows).toEqual([{id:'recent'}]);
});
