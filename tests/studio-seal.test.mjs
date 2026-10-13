import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js = fs.readFileSync(new URL('../src/app/js/studio.js', import.meta.url), 'utf8');

function sealFixture({cancel=false,fail=false,refreshFails=false,confirm=true,dest='shelf'}={}) {
  const calls=[],forgot=[],toasts=[],draft={dest,sealed:false};
  const send=async(cmd,args)=>{assert.equal(context.Bridge.busy,true);assert.equal(draft.sealed,false);calls.push({cmd,args});if(fail)throw Error('save');return cancel?null:cmd==='creator_pack_shelve'?'pack-id':{path:'/tmp/pack.peta',savedTo:'/tmp/gift.peta',packId:'pack-id'};};
  const context=vm.createContext({Bridge:{busy:false,invoke:send,fileDialog:send,reload:async()=>{assert.equal(draft.sealed,true);assert.equal(forgot.length,1);if(refreshFails)throw Error('refresh');}},Shell:{renderNav(){},toast:s=>toasts.push(s)},stForget:kind=>forgot.push(kind),stConfirmTransfer:async()=>confirm,draft});
  vm.runInContext(js.slice(js.indexOf('async function stCommitSeal('),js.indexOf('/** The stickers the pickers show:')),context);
  return {draft,calls,forgot,toasts,context,seal:mode=>vm.runInContext(`stCommitSeal('${mode}',draft,{title:'My pack'})`,context)};
}
for(const [mode,dest,command] of [['pack','shelf','creator_pack_shelve'],['pack','file','creator_pack_save'],['gift','file','gift_send']]) test(`${command} records success before a failed refresh`,async()=>{
  const f=sealFixture({refreshFails:true,dest});const result=await f.seal(mode);
  assert.equal(f.draft.sealed,true);assert.equal(f.draft.result,result);assert.deepEqual(f.forgot,[mode]);assert.equal(f.calls.length,1);assert.equal(f.calls[0].cmd,command);
  assert.equal(f.context.Bridge.busy,false);assert.match(f.toasts[0],/Sealed and saved/);
});
test('cancellation, rejected transfer and failed save do not seal or forget a draft',async()=>{
  for(const mode of ['pack','gift']) {
    const cancelled=sealFixture({cancel:true,dest:'file'});assert.equal(await cancelled.seal(mode),null);assert.equal(cancelled.draft.sealed,false);assert.deepEqual(cancelled.forgot,[]);
    const failed=sealFixture({fail:true});await assert.rejects(failed.seal(mode),/save/);assert.equal(failed.draft.sealed,false);assert.equal(failed.context.Bridge.busy,false);assert.deepEqual(failed.forgot,[]);
  }
  const declined=sealFixture({confirm:false});assert.equal(await declined.seal('gift'),null);assert.deepEqual(declined.calls,[]);
});
test('editing another draft cannot persist a pack that is already sealed',()=>{
  let saved;const context=vm.createContext({ST:{pack:{sealed:true},gift:{sealed:false,sticker:'gift-sticker'}},stDraftKey:'peta.studio',localStorage:{setItem:(_key,value)=>{saved=JSON.parse(value);}}});
  vm.runInContext(js.slice(js.indexOf('function stSave()'),js.indexOf('/** A saved layout')),context);vm.runInContext('stSave()',context);
  assert.equal(saved.pack,undefined);assert.equal(saved.gift.sticker,'gift-sticker');
});
test('the pickers have a search, and a tap does not rebuild the list (so it keeps its scroll and focus)', () => {
  assert.match(js, /function stFind\(fill\)/);
  const gather = js.slice(js.indexOf('const packGather = () =>'), js.indexOf('const packChances = () =>'));
  assert.match(gather, /stFind\(fill\)/);
  assert.doesNotMatch(gather.slice(gather.indexOf('const toggle')), /\bpaint\(\)/);
});
test('a step that cannot go on says why beside its button', () => {
  assert.match(js, /const stNext = /);
  for(const reason of ['Give the pack a name to continue.', 'Choose who it is for to continue.', 'Choose a sticker to continue.']) assert.ok(js.includes(reason), reason);
});
