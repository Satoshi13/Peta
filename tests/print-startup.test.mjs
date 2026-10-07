import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

async function fixture(active = false, pending) {
  const events = {}, calls = [], assets = [];
  const element = {addEventListener(){}, hidden:true};
  const context = vm.createContext({
    document:{getElementById:()=>element}, window:{addEventListener(){}},
    ctx:{layer:element, info:{isPrimary:true},
      listen:async (name, cb)=>{events[name]=cb;},
      invoke:async name=>{
        calls.push(name);
        if(name==='layer_info') events['print-changed']({payload:active});
        if(name==='print_pending') return pending || {stickerId:'saved'};
      },
      loadAsset:id=>{assets.push(id); return new Promise(()=>{});},
    },
  });
  const source = readFileSync(new URL('../src/print.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/m, '').replaceAll('export ', '');
  await vm.runInContext(source+'\ninitPrint(ctx);', context);
  const tick = ()=>new Promise(resolve=>setImmediate(resolve));
  await tick();
  return {calls, assets, tick, emit:on=>events['print-changed']({payload:on})};
}

test('saved queue stays quiet on launch until Resume requests printing', async()=>{
  const f = await fixture();
  assert.deepEqual(f.calls, ['layer_info']);
  assert.deepEqual(f.assets, []);
  f.emit(true); await f.tick();
  assert.deepEqual(f.assets, ['saved']);
});

test('rebuilt primary layer recovers a live print session after subscribing', async()=>{
  const f = await fixture(true);
  assert.deepEqual(f.calls, ['layer_info', 'print_pending']);
  assert.deepEqual(f.assets, ['saved']);
});

test('Later invalidates an in-flight queue read before a sheet starts', async()=>{
  let resolve;
  const f = await fixture(false, new Promise(r=>{resolve=r;}));
  f.emit(true); f.emit(false); resolve({stickerId:'saved'}); await f.tick();
  assert.deepEqual(f.assets, []);
});
