import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the real tag picker with RNG boundaries and rejected repeats, without a webview.
const source=fs.readFileSync(new URL('../src/layer-port.js',import.meta.url),'utf8');
const picker=source.slice(source.indexOf('let lastPetaTag='),source.indexOf('async function syncArrival'));
test('prototype four slots reject the previous tag and keep success timing / cleanup',async()=>{
  const names={tagEn:'peta-tag-en',tagRound:'peta-tag-round',tagHolo:'peta-tag-holo',tagStamp:'peta-tag-stamp'};
  const draws=[0,0,.25,.25,.5,.5,.999,.999,0];
  const displayed=[],animations=[];let calls=0;
  const math=Object.create(Math);math.random=()=>{calls++;return draws.shift();};
  const context=vm.createContext({Math:math,console,document:{getElementById:()=>({append:tag=>displayed.push(tag)})},
    img:(key,cls)=>({src:`art/fx/${names[key]}.png`,className:cls,dataset:{},style:{},decode:async()=>{},setAttribute(){},remove(){this.removed=true;}}),
    anim:(tag,frames,options)=>{animations.push({tag,frames,options});return Promise.resolve();}});
  vm.runInContext(picker,context);
  for(let i=0;i<5;i++)vm.runInContext('petaTag(310,440)',context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,9);
  assert.deepEqual(displayed.map(t=>t.dataset.art),['peta-tag-en','peta-tag-round','peta-tag-holo','peta-tag-stamp','peta-tag-en']);
  for(const {tag,frames,options} of animations){
    assert.equal(tag.style.left,'310px');assert.equal(tag.style.top,'440px');
    assert.equal(options.duration,1300);assert.equal(options.easing,'ease-out');
    assert.equal(frames[1].offset,.25);assert.equal(frames[2].offset,.8);
    assert.equal(frames[3].opacity,0);assert.equal(tag.removed,true);
  }
});
