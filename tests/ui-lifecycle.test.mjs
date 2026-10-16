import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read = name => readFileSync(new URL('../src/app/js/'+name, import.meta.url),'utf8');
const tick = () => new Promise(resolve=>setImmediate(resolve));
function bridgeFixture({hold, fail = false} = {}) {
  let batches = 0, paint = 0, release;
  const wait = hold ? new Promise(resolve=>release=resolve) : null;
  const ctx = vm.createContext({readPreferences:()=>({}), queueMicrotask, Blob, URL,
    document:{querySelector:()=>null}, MAT:{matte:{id:'matte',name:'Old',locked:true}}, BAGS:{}, isPouch:()=>false,
    fmtDate:d=>String(d), Pages:{}, Shell:{renderNav(){},syncResources(){},refresh(){paint++;},clearProblem(){},error(){}},
    Distribution:{offer(){}}, PackZoom:{current:null},
    window:{__TAURI__:{window:{getCurrentWindow:()=>({})},event:{listen(){}},core:{invoke:async cmd=>{
      if(cmd==='profile_get'){batches++;return {displayName:'Name '+batches,developer:false};}
      if(cmd==='daily_status')return {date:'2026-10-15',materialOpened:true,material:{id:'matte'}};
      if(cmd==='material_book')return [{material:{id:'matte',name:'New',count:3,rarity:'common'},unlocked:true}];
      if(cmd==='book_index')return [{year:2026,month:10}];
      if(cmd==='book_page'){if(batches===1 && wait)await wait;if(fail===true || fail==='first' && batches===1)throw Error('disk');return [];}
      if(cmd==='pack_status')return {packs:[],canOpen:true};
      if(cmd==='scrap_status')return {balance:batches,materials:[],packs:[]};
      if(cmd==='link_tag_status')return {tags:[],stock:{available:1}};
      if(cmd==='boards_status')return {stock:{available:2}};
      if(cmd==='inbox_status')return {enabled:false,friends:[]};
      if(cmd==='print_pending'||cmd==='creator_pack_pending')return null;
      return [];
    }}}}});
  vm.runInContext(read('bridge.js').split('const Vibrancy =')[0],ctx);
  return {ctx, release:()=>release?.(), get batches(){return batches;}, get paint(){return paint;}, run:code=>vm.runInContext(code,ctx)};
}
test('failed collection read leaves the entire previous snapshot and material palette untouched',async()=>{
  const f=bridgeFixture({fail:true});f.run("S.name='Previous';S.stock={matte:9};S.lib=[{id:'old'}]");
  const before=f.run('JSON.stringify([S,MAT])');
  await assert.rejects(f.run('Bridge.reload()'),e=>e.name==='PetaLoadError');
  assert.equal(f.run('JSON.stringify([S,MAT])'),before);
});
test('overlapping reload requests discard the old read and commit only the latest snapshot',async()=>{
  const f=bridgeFixture({hold:true});f.run("globalThis.names=[];let name=S.name;Object.defineProperty(S,'name',{get:()=>name,set:v=>{name=v;names.push(v)},enumerable:true});");
  const first=f.run('Bridge.reload()');await tick();const second=f.run('Bridge.reload()');
  assert.equal(f.run('S.name'),'');f.release();await Promise.all([first,second]);
  assert.equal(f.batches,2);assert.equal(f.run('JSON.stringify(names)'),JSON.stringify(['Name 2']));
});
test('a newer dirty request is honored even if the first read fails',async()=>{
  const f=bridgeFixture({hold:true,fail:'first'});const first=f.run('Bridge.reload()');await tick();const second=f.run('Bridge.reload()');f.release();await Promise.all([first,second]);
  assert.equal(f.batches,2);assert.equal(f.run('S.name'),'Name 2');
});
test('material metadata changes are reported even when stock counts stay the same',async()=>{
  const f=bridgeFixture();await f.run('Bridge.reload()');f.run("MAT.matte.name='Another';S.materialState[0][1]='Another'");await f.run('Bridge.reload()');
  assert.equal(f.run("Bridge.changes.has('materials')"),true);
});
test('a native event burst produces one visible update after the latest snapshot',async()=>{
  const f=bridgeFixture({hold:true});const first=f.run('Bridge.changed()');await tick();const second=f.run('Bridge.changed()');f.release();await Promise.all([first,second]);
  assert.equal(f.batches,2);assert.equal(f.paint,1);
});
test('a successful mutation followed by failed display refresh retries only reads',async()=>{
  const f=bridgeFixture({fail:true});let retry;f.ctx.Shell.error=(_e,o)=>retry=o.retry;
  assert.equal(await f.run('Bridge.refreshCommitted()'),false);assert.equal(typeof retry,'function');
  await assert.rejects(retry());assert.equal(f.batches,2);
});
test('editing windows stay open by default',()=>{
  const f=bridgeFixture();assert.equal(f.run('S.closeOutside'),false);
});
test('a creator decode cannot restore an image after cancellation and releases its temporary URL',async()=>{
  let finish;const decoded=new Promise(resolve=>finish=resolve),revoked=[];
  const ctx=vm.createContext({S:{chosen:'matte',page:'create'}, MAT:{matte:{name:'Matte'}}, usableMats:()=>['matte'],
    Bridge:{invoke:async cmd=>cmd==='creator_info'?{phase:'ready',width:20,height:20,defaultStrength:.5}:[],reload:async()=>{}},
    Shell:{refresh(){},error(){}},Blob,URL:{createObjectURL:()=> 'blob:stale',revokeObjectURL:url=>revoked.push(url)},
    Stk:{load:()=>decoded,cv:()=>({getContext:()=>({drawImage(){}})})}});
  vm.runInContext(read('create.js').split("Bridge.listen('creator-changed'")[0],ctx);
  const pending=vm.runInContext('crSync()',ctx);await tick();vm.runInContext('crReset()',ctx);finish({});await pending;
  assert.equal(vm.runInContext('CR.stage',ctx),'empty');assert.equal(vm.runInContext('CR.photo',ctx),null);
  assert.deepEqual(revoked,['blob:stale']);
});
test('technical errors become actionable messages instead of database diagnostics',()=>{
  const ctx=vm.createContext({});vm.runInContext(read('ui.js'),ctx);
  assert.equal(vm.runInContext("userError('sqlite error {internal}')",ctx),'This action could not be completed. Please try again.');
  assert.match(vm.runInContext("userError('That picture is too large to cut out.')",ctx),/80 MB/);
});
test('a pack that will not open says why',()=>{
  const ctx=vm.createContext({});vm.runInContext(read('ui.js'),ctx);const say=raw=>vm.runInContext(`userError(${JSON.stringify(raw)})`,ctx);
  assert.match(say('welcome_already_opened_today'),/back tomorrow/);
  assert.equal(say('pack_empty'),'This pack is empty.');
  // the service's answers are already written for people, with the code a developer build adds
  assert.equal(say('Connect to the internet to do this. Nothing was changed.'),'Connect to the internet to do this. Nothing was changed.');
  assert.equal(say('Peta could not check this. Please try again. [unknown]'),'Peta could not check this. Please try again. [unknown]');
  assert.equal(say('database error: no such table: x'),'This action could not be completed. Please try again.');
  assert.equal(say('Damaged pack record {x}.'),'This action could not be completed. Please try again.');
});
