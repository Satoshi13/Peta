import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const read=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
const core=read('app/js/core.js'),bridge=read('app/js/bridge.js'),studio=read('app/js/studio.js');

test('broken, null, array or unavailable preferences fall back to startup defaults',()=>{
  for(const stored of ['{broken','null','[]','42','"hello"',null]) {
    const context=vm.createContext({localStorage:{getItem:()=>stored}});
    vm.runInContext(core.slice(core.indexOf('function readPreferences()'),core.indexOf('/** h(')),context);
    assert.equal(vm.runInContext('JSON.stringify(readPreferences())',context),'{}');
  }
  const context=vm.createContext({localStorage:{getItem(){throw Error('storage');}}});
  vm.runInContext(core.slice(core.indexOf('function readPreferences()'),core.indexOf('/** h(')),context);
  assert.equal(vm.runInContext('JSON.stringify(readPreferences())',context),'{}');
});

function fixture(invoke) {
  let next=0,invalidated=0;const revoked=[];const document={querySelector:()=>null};
  const context=vm.createContext({readPreferences:()=>({}),window:{__TAURI__:{core:{invoke},window:{getCurrentWindow:()=>({})},event:{listen(){}}}},document,Blob,URL:{createObjectURL:()=>`blob:${++next}`,revokeObjectURL:url=>revoked.push(url)},Pages:{studio:{invalidateAsset(){invalidated++;}}}});
  vm.runInContext(bridge.slice(0,bridge.indexOf('const Vibrancy =')),context);
  return {context,document,revoked,get invalidated(){return invalidated;},run:code=>vm.runInContext(code,context)};
}
test('a temporary image failure can retry instead of caching a rejected promise',async()=>{
  let fail=true;const f=fixture(async()=>{if(fail)throw Error('offline');return [1,2];});
  await assert.rejects(f.run("Bridge.asset('sticker')"),/offline/);fail=false;
  assert.equal(await f.run("Bridge.asset('sticker')"),'blob:1');
  fail=true;await assert.rejects(f.run("Bridge.thumb('another')"),/offline/);fail=false;
  assert.equal(await f.run("Bridge.thumb('another')"),'blob:2');
});
test('invalidating a full-size thumbnail fallback revokes its URL once and also clears Studio',async()=>{
  const f=fixture(async cmd=>{if(cmd==='sticker_thumb')throw Error('no thumbnail');return [1];});
  const url=await f.run("Bridge.thumb('sticker')");assert.equal(await f.run("Bridge.asset('sticker')"),url);
  f.run("Bridge.invalidateAsset('sticker')");await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.revoked,[url]);assert.equal(f.invalidated,1);assert.notEqual(await f.run("Bridge.asset('sticker')"),url);
});
test('a stale failed asset request cannot remove a replacement request',async()=>{
  let reject,calls=0;const f=fixture(async()=>{calls++;return calls===1?new Promise((_r,j)=>reject=j):[1];});
  const old=f.run("Bridge.asset('sticker')");f.run("Bridge.invalidateAsset('sticker')");
  const fresh=await f.run("Bridge.asset('sticker')");reject(Error('old request'));await assert.rejects(old,/old request/);
  assert.equal(await f.run("Bridge.asset('sticker')"),fresh);assert.equal(calls,2);
});
for(const resource of ['resOf','thumbOf']) test(`a stale decoding failure cannot remove the replacement ${resource} cache`,async()=>{
  const f=fixture(async()=>[1]);let reject,loads=0;f.context.Stk={load:async()=>{loads++;return loads===1?new Promise((_r,j)=>reject=j):{naturalWidth:100,naturalHeight:80};}};
  const old=f.run(`${resource}({id:'sticker',material:'matte'})`);await new Promise(resolve=>setImmediate(resolve));f.run("Bridge.invalidateAsset('sticker')");
  const fresh=await f.run(`${resource}({id:'sticker',material:'matte'})`);reject(Error('old decode'));await assert.rejects(old,/old decode/);
  assert.equal(await f.run(`${resource}({id:'sticker',material:'matte'})`),fresh);assert.equal(loads,2);
});
test('a native save dialog protects focus until success, cancellation or failure',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>resolve=r));
  f.run("S.name='Maker'");
  const pending=f.run("Bridge.fileDialog('gift_send',{})");assert.equal(f.run('Bridge.dialogOpen'),true);
  resolve(null);assert.equal(await pending,null);assert.equal(f.run('Bridge.dialogOpen'),false);
  f.document.querySelector=()=>({open:true});const nested=f.run("Bridge.fileDialog('gift_send',{})");resolve({savedTo:'/tmp/file'});await nested;assert.equal(f.run('Bridge.dialogOpen'),true);
  const rejected=fixture(async()=>{throw Error('save');});rejected.run("S.name='Maker'");await assert.rejects(rejected.run("Bridge.fileDialog('gift_send',{})"),/save/);assert.equal(rejected.run('Bridge.dialogOpen'),false);
});
test('a stale Studio thumbnail cannot overwrite a picture requested after editing',async()=>{
  const pending=[];const state={urls:new Map(),urlRequests:new Map()};
  const context=vm.createContext({ST:state,stEntry:()=>({id:'sticker'}),thumbOf:()=>new Promise(r=>pending.push(r)),S:{page:'studio'},Pages:{studio:{repaintBench(){}}}});
  vm.runInContext(studio.slice(studio.indexOf('function stUrl('),studio.indexOf('/** What was just sealed')),context);
  vm.runInContext("stUrl('sticker')",context);state.urls.delete('sticker');state.urlRequests.delete('sticker');vm.runInContext("stUrl('sticker')",context);
  pending[1]({url:'new'});await new Promise(resolve=>setImmediate(resolve));pending[0]({url:'old'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.urls.get('sticker'),'new');
});

test('sharing stops before IPC when no profile name was chosen',async()=>{
  let called=0,asked=0;const f=fixture(async()=>{called++;});f.context.ProfileName={request(){asked++;}};
  for(const cmd of ['gift_send','gift_send_friend','creator_pack_save','creator_pack_shelve','friend_code_copied','friend_add','friend_approve']) await assert.rejects(f.run(`Bridge.invoke('${cmd}',{})`),/Choose your name in Settings/);
  assert.equal(called,0);assert.equal(asked,7);f.run("S.name='Maker'");await f.run("Bridge.invoke('gift_send',{})");assert.equal(called,1);
});
