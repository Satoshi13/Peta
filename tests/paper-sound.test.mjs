import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../src/app/js/audio.js',import.meta.url),'utf8');
function fixture(){
  let now=0;const calls=[];
  const ctx=vm.createContext({performance:{now:()=>now}});
  vm.runInContext(source+';this.sound=Snd;',ctx);
  ctx.sound.crinkle=(...args)=>calls.push({time:now,args});
  return {sound:ctx.sound,calls,time:value=>{now=value;}};
}
test('paper movement has the same bounded cadence at pointer and animation event rates',()=>{
  const counts=[];
  for(const hz of [30,60,120,240]){
    const f=fixture(),motion=f.sound.paperMotion();
    for(let i=0;i<=hz;i++){f.time(i*1000/hz);motion(i/hz);}
    counts.push(f.calls.length);
    assert.ok(f.calls.length<=11);
    for(let i=0;i<f.calls.length;i++){
      assert.deepEqual(f.calls[i].args,[2,.06]);
      if(i)assert.ok(f.calls[i].time-f.calls[i-1].time>=99.9);
    }
  }
  assert.ok(Math.max(...counts)-Math.min(...counts)<=1,counts.join(','));
});
test('stationary, tiny or muted movement cannot stack sounds; a new gesture starts cleanly',()=>{
  const f=fixture(),motion=f.sound.paperMotion();
  motion(0);motion(NaN);motion(.001);assert.equal(f.calls.length,0);
  motion(.1);f.time(100);motion(.1);motion(.11);assert.equal(f.calls.length,1);
  f.sound.on=false;motion(.5);assert.equal(f.calls.length,1);
  f.sound.on=true;motion(.5);assert.equal(f.calls.length,2);
  f.sound.paperMotion()(.1);assert.equal(f.calls.length,3);
});
