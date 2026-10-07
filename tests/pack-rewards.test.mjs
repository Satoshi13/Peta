import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the production ceremony through its tear callback; no native IPC or animations.
function fixture({remaining=0,credits=1,fail=false}={}) {
  const calls=[],toasts=[];let tear,closed=false,overlays=0;
  const pack={id:'welcome',title:'Welcome Pack',daily:true,left:Array(remaining).fill(null),freeOpenings:credits};
  const rig={PW:200,PH:260,cutY:40,focus(){},pullable(){},done:false};
  const cer={stage:{},root:{},hint(){},close:async()=>{closed=true;}};
  const context=vm.createContext({
    packOpenable:p=>p.left.length>0 && !p.daily,
    packHasFreeOpening:p=>(p.freeOpenings||0)>0,
    overlay:()=>{overlays++;return cer;},
    h:()=>({style:{},classList:{add(){}}}),img(){},
    buildRig:(_cer,_stage,options)=>{tear=options.onTear;return rig;},
    Bridge:{busy:false,invoke:async(cmd,args)=>{calls.push({cmd,args:{...args}});if(fail)throw Error('retry');return {stickerId:'bonus',remaining};},entry:async()=>({title:'Sticker'}),reload:async()=>{}},
    Shell:{renderNav(){},toast:s=>toasts.push(s)},anim:async()=>{},fix(){},EASE:{out:'ease-out'},pack,
  });
  const source=readFileSync(new URL('../src/app/js/ceremony.js',import.meta.url),'utf8');
  const begin=source.indexOf('  async function openPack(');
  const end=source.indexOf('  const RARITY_RANK',begin);
  assert.ok(begin>=0 && end>begin,'production pack ceremony boundaries must be present');
  vm.runInContext(source.slice(begin,end),context);
  return {pack,calls,toasts,context,open:free=>vm.runInContext(`openPack(pack,{free:${free}})`,context),tear:()=>tear(rig),get closed(){return closed;},get overlays(){return overlays;}};
}

test('a free opening works on an empty Welcome pack and spends nothing before the tear',async()=>{
  const f=fixture();await f.open(true);
  assert.equal(f.overlays,1);assert.deepEqual(f.calls,[]);
  await f.tear();
  assert.deepEqual(f.calls,[{cmd:'pack_open_free',args:{packId:'welcome'}}]);
  assert.equal(f.pack.left.length,0);
});

test('a credit does not bypass the normal daily rule and free opening requires a credit',async()=>{
  const normal=fixture({remaining:2});await normal.open(false);
  const noCredit=fixture({remaining:2,credits:0});await noCredit.open(true);
  assert.equal(normal.overlays,0);assert.equal(noCredit.overlays,0);
  assert.deepEqual(normal.calls,[]);assert.deepEqual(noCredit.calls,[]);
});

test('a rejected free opening closes the ceremony and clears busy state for retry',async()=>{
  const f=fixture({fail:true});await f.open(true);await f.tear();
  assert.equal(f.closed,true);assert.equal(f.context.Bridge.busy,false);
  assert.equal(f.pack.freeOpenings,1);assert.equal(f.toasts[0],'Error: retry');
});
