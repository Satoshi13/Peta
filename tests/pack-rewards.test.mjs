import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the production ceremony through its tear callback; no native IPC or animations.
function fixture({remaining=0,credits=1,fail=false,daily=true,metadataFails=false,reloadFails=false,fillFails=false,printFails=false,previewFails=false,pendingOpen=null}={}) {
  const calls=[],toasts=[],refreshes=[];let tear,pull,reveal,closed=false,overlays=0;
  const pack={id:'welcome',title:'Welcome Pack',daily,left:Array(remaining).fill(null),freeOpenings:credits};
  const element=()=>({style:{},classList:{add(){}},getBoundingClientRect:()=>({left:0,top:0,width:100}),append(){}});
  const rig={PW:200,PH:260,cutY:40,focus(){},pullable:(_el,{onPull})=>{pull=onPull;},linger(){},done:false};
  const cer={stage:element(),root:{},hint(){},close:async()=>{closed=true;}};
  const context=vm.createContext({
    packOpenable:p=>p.left.length>0 && !p.daily,
    packHasFreeOpening:p=>(p.freeOpenings||0)>0,
    overlay:()=>{overlays++;return cer;},
    h:element,img(){},PackLabel:()=>({}),S:{packs:[pack],packAvailable:true},
    buildRig:(_cer,_stage,options)=>{tear=options.onTear;return rig;},
    Bridge:{busy:false,invoke:async(cmd,args)=>{calls.push({cmd,args:{...args}});if(fail)throw Error('retry');return pendingOpen || {stickerId:'bonus',remaining};},packEntry:async()=>{if(metadataFails)throw Error('metadata');return {id:'bonus',title:'Sticker'};},reload:async()=>{if(reloadFails)throw Error('refresh');},printAction:async(cmd,args)=>{calls.push({cmd,args:{...args}});if(printFails)throw Error('print');}},
    Shell:{error:s=>toasts.push(String(s)),renderNav(){},refresh:o=>refreshes.push(o||{}),toast:s=>toasts.push(s)},Desktop:{print:async()=>{}},anim:async()=>{},fix(){},EASE:{out:'ease-out'},pack,
    packSheet:()=>({slot:element(),place(){},fill:async()=>{if(fillFails)throw Error('decode');}}),
    peelAndReveal:async options=>{if(previewFails)throw Error('decode');reveal=options;},
  });
  const source=readFileSync(new URL('../src/app/js/ceremony.js',import.meta.url),'utf8');
  const begin=source.indexOf('  async function openPack(');
  const end=source.indexOf('  const RARITY_RANK',begin);
  assert.ok(begin>=0 && end>begin,'production pack ceremony boundaries must be present');
  vm.runInContext(source.slice(source.indexOf('async function closeCommittedPreview'),source.indexOf('const Cer =')),context);
  vm.runInContext(source.slice(begin,end),context);
  return {pack,calls,toasts,refreshes,context,open:free=>vm.runInContext(`openPack(pack,{free:${free}})`,context),tear:()=>{rig.done=true;return tear(rig);},pull:()=>pull(),keep:()=>reveal.onKeep(),escape:()=>cer.root._esc(),get closed(){return closed;},get overlays(){return overlays;}};
}

test('a free opening works on an empty Welcome pack and spends nothing before the tear',async()=>{
  const f=fixture();await f.open(true);
  assert.equal(f.overlays,1);assert.deepEqual(f.calls,[]);
  await f.tear();
  assert.deepEqual(f.calls,[{cmd:'pack_open_free',args:{packId:'welcome',queue:false}}]);
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

test('a ready free opening comes first: a regular opening of an openable pack does not start',async()=>{
  const waiting=fixture({remaining:3,credits:1,daily:false});await waiting.open(false);
  assert.equal(waiting.overlays,0);assert.deepEqual(waiting.calls,[]);
  const none=fixture({remaining:3,credits:0,daily:false});await none.open(false);
  assert.equal(none.overlays,1);
});

for(const failure of ['metadataFails','reloadFails','fillFails','previewFails']) test(`a committed pull survives ${failure} and closes without another opening`,async()=>{
  const f=fixture({remaining:1,[failure]:true});await f.open(true);await f.tear();if(failure==='previewFails')await f.pull();
  assert.equal(f.pack.left.length,1);assert.equal(f.pack.freeOpenings,0);
  assert.equal(f.closed,true);assert.equal(f.context.Bridge.busy,false);
  assert.equal(f.calls.filter(x=>x.cmd==='pack_open_free').length,1);assert.match(f.toasts.at(-1),/saved/);
});

test('a failed Stick it closes the preview and keeps the committed sticker in Collection',async()=>{
  const f=fixture({printFails:true});await f.open(true);await f.tear();await f.pull();await f.keep();await f.keep();
  assert.equal(f.closed,true);assert.equal(f.context.Bridge.busy,false);
  assert.equal(f.calls.filter(x=>x.cmd==='daily_stick_from_collection').length,1);
  assert.match(f.toasts.at(-1),/Kept in your Collection/);
});

test('Escape while the opening command is pending waits for an entry',async()=>{
  let resolve;const pendingOpen=new Promise(r=>resolve=r);const f=fixture({pendingOpen});await f.open(true);
  const opening=f.tear();assert.doesNotThrow(()=>f.escape());assert.equal(f.closed,false);
  resolve({stickerId:'bonus',remaining:0});await opening;await f.escape();assert.equal(f.closed,true);
});

test('the shelf behind is rebuilt while the ceremony covers it, and not again when it closes',async()=>{
  const f=fixture({remaining:3});await f.open(true);await f.tear();
  assert.equal(JSON.stringify(f.refreshes),JSON.stringify([{quiet:true}]));                   // after the commit, before the sheet is even pulled out
  await f.pull();await f.keep();
  assert.equal(JSON.stringify(f.refreshes),JSON.stringify([{quiet:true},{ifStale:true}]));  // closing only rebuilds if something changed since
});
