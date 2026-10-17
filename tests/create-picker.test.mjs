import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../src/app/js/create.js',import.meta.url),'utf8');
function fixture({picked='ready',hold=false}={}){
  let phase='idle',generation=1,editingStickerId=null,release;const calls=[],paints=[],timers=new Map();let serial=0;
  const ctx=vm.createContext({S:{chosen:'matte',page:'create'},MAT:{},usableMats:()=>['matte'],document:{querySelector:()=>null,removeEventListener(){}},userError:e=>String(e?.message || e),Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},
    setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),Stk:{load:async()=>({}),cv:()=>({getContext:()=>({drawImage(){}})})},Shell:{refresh:()=>paints.push(vm.runInContext('CR.stage',ctx)),error:e=>calls.push('error:'+e.message)},
    Bridge:{dialogOpen:false,reload:async()=>{},invoke:async cmd=>{calls.push(cmd);if(cmd==='daily_create'){if(hold)await new Promise(r=>release=r);phase=picked;return {};}
      if(cmd==='creator_begin_bytes'){phase=picked;return;}
      if(cmd==='creator_info')return {phase,generation,editingStickerId,error:'Cannot cut this image.',width:20,height:20,defaultStrength:.5};if(cmd==='creator_original')return [1,2];}}
  });
  vm.runInContext(source.slice(0,source.indexOf("Bridge.listen('creator-changed'"))+source.slice(source.indexOf('async function crChooseFile()'),source.indexOf('window.__TAURI__.webview')),ctx);
  return {calls,paints,ctx,timers,release:()=>release(),phase:value=>phase=value,generation:value=>generation=value,editing:value=>editingStickerId=value,run:code=>vm.runInContext(code,ctx)};
}
test('native image chooser updates Create without receiving any creator-changed event',async()=>{
  const f=fixture();await f.run('crChooseFile()');assert.equal(f.run('CR.stage'),'ready');assert.ok(f.paints.includes('ready'));assert.equal(f.run('Bridge.dialogOpen'),false);assert.ok(f.calls.includes('creator_original'));
});
test('a missed completion notification is recovered while loading',async()=>{
  const f=fixture({picked:'loading'});await f.run('crChooseFile()');assert.equal(f.run('CR.stage'),'cutting');assert.equal(f.timers.size,1);
  f.phase('ready');const timer=[...f.timers.values()][0];f.timers.clear();timer();await new Promise(r=>setImmediate(r));assert.equal(f.run('CR.stage'),'ready');assert.equal(f.timers.size,0);
});
test('cancel and failure are read back without leaving an invisible native dialog',async()=>{
  for(const picked of ['idle','failed']){const f=fixture({picked});await f.run('crChooseFile()');assert.equal(f.run('CR.stage'),picked==='idle'?'empty':'failed');assert.equal(f.run('Bridge.dialogOpen'),false);assert.equal(f.timers.size,0);}
});
test('repeated chooser activation opens one dialog and cancellation invalidates polling',async()=>{
  const f=fixture({picked:'loading',hold:true}),action=f.run('crChooseFile()');await f.run('crChooseFile()');assert.equal(f.calls.filter(c=>c==='daily_create').length,1);f.release();await action;assert.equal(f.timers.size,1);f.run('crReset()');assert.equal(f.timers.size,0);
});
test('browser file loading reports read failure and retains a retry',async()=>{
  const f=fixture();f.ctx.file={type:'image/png',size:10,arrayBuffer:async()=>{throw Error('Cannot read this image.');}};await f.run('crLoadFile(file)');assert.equal(f.run('CR.stage'),'failed');assert.equal(f.run('typeof CR.retry'),'function');assert.ok(f.paints.includes('failed'));
});

test('loading recovery does not repaint or restart the waiting animation on every poll',async()=>{
  const f=fixture({picked:'loading'});await f.run('crChooseFile()');const paints=f.paints.length;
  for(let i=0;i<3;i++){const timer=[...f.timers.values()][0];f.timers.clear();timer();await new Promise(r=>setImmediate(r));}
  assert.equal(f.paints.length,paints);assert.equal(f.timers.size,1);f.run('crReset()');
});

test('a chosen image reveals even when cutting finishes before the first state read',async()=>{
  const f=fixture();await f.run('crChooseFile()');
  assert.equal(f.run('CR.reveal'),true);
});

test('duplicate ready notifications preserve the reveal and the current cutting mat',async()=>{
  const f=fixture();await f.run('crChooseFile()');const paints=f.paints.length,reads=f.calls.filter(c=>c==='creator_original').length;
  f.run('CR.reveal=false;CR.name="My Peta";CR.border=32'); // the mounted mat has completed its one-shot animation
  await f.run('crSync()');await f.run('crSync()');
  assert.equal(f.paints.length,paints);
  assert.equal(f.calls.filter(c=>c==='creator_original').length,reads);
  assert.equal(f.run('CR.reveal'),false);
  assert.equal(f.run('CR.name'),'My Peta');assert.equal(f.run('CR.border'),32);
});

test('a new native session still reveals when its loading notification was missed',async()=>{
  const f=fixture();await f.run('crChooseFile()');const paints=f.paints.length;
  f.run('CR.reveal=false');f.generation(2);await f.run('crSync()');
  assert.equal(f.paints.length,paints+1);assert.equal(f.run('CR.generation'),2);assert.equal(f.run('CR.reveal'),true);
});

test('restoring an already-ready edit skips the new-photo reveal',async()=>{
  const f=fixture();f.editing('saved-sticker');f.phase('ready');await f.run('crSync()');
  assert.equal(f.run('CR.editing'),'saved-sticker');assert.equal(f.run('CR.reveal'),false);
});
