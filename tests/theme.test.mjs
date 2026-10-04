import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTheme} from '../src/ui-math.js';
test('explicit Day/Night are independent of the system appearance',()=>{
  for(const dark of [false,true]) {
    assert.equal(resolveTheme('day',dark),'day');assert.equal(resolveTheme('night',dark),'night');
  }
});
test('Auto follows the system; absent or unknown preferences keep Day',()=>{
  assert.equal(resolveTheme('auto',false),'day');assert.equal(resolveTheme('auto',true),'night');
  for(const pref of [undefined,null,'','dark','other']) assert.equal(resolveTheme(pref,true),'day');
});

// Exercise the real preference lifecycle without a timer or a live WebView.
test('Appearance subscribes only during Auto and removes its listener for explicit preferences',async()=>{
  const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');
  const source=readFileSync(new URL('../src/app/js/bridge.js',import.meta.url),'utf8');
  const listeners=new Set(),media={matches:false,addEventListener:(kind,fn)=>{assert.equal(kind,'change');listeners.add(fn);},removeEventListener:(kind,fn)=>{assert.equal(kind,'change');listeners.delete(fn);}};
  const root={dataset:{}},context={S:{appearance:'day'},document:{documentElement:root},PetaMath:{resolveTheme},matchMedia:()=>media};
  runInNewContext(source.slice(source.indexOf('const Appearance =')),context);
  const apply=pref=>runInNewContext(`S.appearance=${JSON.stringify(pref)};Appearance.apply();`,context);
  apply('day');assert.equal(listeners.size,0);assert.equal(root.dataset.theme,'day');
  apply('auto');apply('auto');assert.equal(listeners.size,1);
  media.matches=true;for(const fn of listeners)fn();assert.equal(root.dataset.theme,'night');
  apply('day');assert.equal(listeners.size,0);assert.equal(root.dataset.theme,'day');
  apply('night');assert.equal(listeners.size,0);assert.equal(root.dataset.theme,'night');
  apply('auto');assert.equal(listeners.size,1);apply('night');assert.equal(listeners.size,0);
});
