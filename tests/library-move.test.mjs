import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element{
  constructor(tag,props,children){this.tag=tag;this.value='';this.isConnected=true;Object.assign(this,props);this.children=children.flat(Infinity).filter(v=>v!=null&&v!==false);}
  focus(){} addEventListener(){} close(){this.closed=true;}
}
const h=(tag,...args)=>{const props=args[0]&&typeof args[0]==='object'&&!Array.isArray(args[0])&&!(args[0] instanceof Element)?args.shift():{};return new Element(tag,props,args);};
const nodes=el=>el instanceof Element?[el,...el.children.flatMap(nodes)]:[];
const text=el=>el instanceof Element?(el.textContent||el.children.map(text).join('')):String(el??'');
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(ready=false){
  const calls=[],toasts=[];let dialog;
  const source=fs.readFileSync(new URL('../src/app/js/settings.js',import.meta.url),'utf8');
  const context=vm.createContext({h,queueMicrotask,Bridge:{invoke:async cmd=>{calls.push({cmd});return ready;},fileDialog:async(cmd,args)=>{calls.push({cmd,args});return true;}},Shell:{toast:(...v)=>toasts.push(v)},Friends:{error:String,sheet:(label,...kids)=>dialog=h('dialog',{label},kids)}});
  vm.runInContext(source.slice(source.indexOf('const LibraryMove ='))+';this.LibraryMove=LibraryMove;',context);
  return {move:context.LibraryMove,calls,toasts,get dialog(){return dialog;}};
}
test('full library move is available without the server; only a fresh library can restore',async()=>{
  for(const ready of [false,true]){
    const f=fixture(ready),card=f.move.card();await flush();assert.match(text(card),/Move to a new Mac/);assert.match(text(card),/Nothing is sent to a server/);
    assert.equal(nodes(card).find(n=>text(n)==='Restore a move file…').disabled,!ready);assert.equal(f.calls[0].cmd,'move_status');
  }
});
test('export requires twelve Unicode characters and matching confirmation before opening a save dialog',async()=>{
  const f=fixture();f.move.dialog(false);const form=nodes(f.dialog).find(n=>n.tag==='form.bd-form'),inputs=nodes(form).filter(n=>n.tag==='input.bd-input'),submit=()=>form.on.submit({preventDefault(){}});
  inputs[0].value='short';inputs[1].value='short';await submit();assert.equal(f.calls.length,0);
  inputs[0].value='🌸'.repeat(12);inputs[1].value='different';await submit();assert.equal(f.calls.length,0);
  inputs[1].value=inputs[0].value;await submit();assert.equal(f.calls[0].cmd,'library_move_export');assert.equal(f.calls[0].args.passphrase,inputs[0].value);assert.match(f.toasts[0][0],/do not use Peta on this Mac/);
});
test('restore uses a separate command and explicitly announces a restart',async()=>{
  const f=fixture(true);f.move.dialog(true);assert.match(text(f.dialog),/Peta checks the whole file/);assert.match(text(f.dialog),/Restore and restart/);
  const form=nodes(f.dialog).find(n=>n.tag==='form.bd-form'),input=nodes(form).find(n=>n.tag==='input.bd-input');input.value='restore passphrase';await form.on.submit({preventDefault(){}});assert.equal(f.calls[0].cmd,'library_move_import');
});
