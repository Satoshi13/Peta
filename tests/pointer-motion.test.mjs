import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function fixture() {
  const frames=new Map(), listeners={}, mutations=[]; let id=0, now=0, resets=0;
  const root={dataset:{motion:'full'},addEventListener:(name,cb)=>listeners['root-'+name]=cb}, samples=[];
  const el={isConnected:true,addEventListener:(name,cb)=>listeners[name]=cb,getBoundingClientRect:()=>({left:10,top:20,width:100,height:100})};
  const context=vm.createContext({Math,el,samples,
    document:{documentElement:root,hidden:false,addEventListener(){}},
    window:{addEventListener:(name,cb)=>listeners['window-'+name]=cb},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    MutationObserver:class {constructor(cb){mutations.push(cb);}observe(){}},
    requestAnimationFrame:cb=>{frames.set(++id,cb);return id;},cancelAnimationFrame:i=>frames.delete(i),
    reset:()=>resets++,
  });
  vm.runInContext(readFileSync(new URL('../src/app/js/core.js',import.meta.url),'utf8')+'\nonPointerFollow(el,(x,y,e,amount)=>samples.push({x,y,amount}),reset);',context);
  return {frames,samples,el,root,mutations,get resets(){return resets;},
    move:(x,y)=>listeners.pointermove({clientX:x,clientY:y,pointerType:'mouse'}),leave:()=>listeners.pointerleave(),blur:()=>listeners['window-blur'](),exit:()=>listeners['root-pointerleave'](),
    step:dt=>{now+=dt;const batch=[...frames.values()];frames.clear();for(const cb of batch)cb(now);},
    settle(){for(let i=0;i<120 && frames.size;i++)this.step(16);assert.equal(frames.size,0);},
  };
}

test('pointer decoration converges without overshoot and stops its clock at rest',()=>{
  const f=fixture();f.move(110,120);f.settle();
  assert.ok(f.samples.length>2);assert.ok(f.samples.every(s=>s.x>=.5 && s.x<=1 && s.y>=.5 && s.y<=1 && s.amount>=0 && s.amount<=1));
  assert.deepEqual({...f.samples.at(-1)},{x:1,y:1,amount:1});
  const n=f.samples.length;f.step(1000);assert.equal(f.samples.length,n);
});

test('leaving and quickly entering again returns continuously, then resets exactly',()=>{
  const f=fixture();f.move(110,20);f.step(16);f.step(16);f.leave();f.step(16);
  const before=f.samples.at(-1);f.move(10,120);f.step(16);
  assert.ok(Math.abs(f.samples.at(-1).x-before.x)<.2);
  f.settle();f.leave();f.settle();assert.equal(f.resets,1);assert.deepEqual({...f.samples.at(-1)},{x:.5,y:.5,amount:0});
});

test('Reduce motion resets even a settled hover; detached targets leave no frames',()=>{
  const f=fixture();f.move(110,120);f.settle();f.root.dataset.motion='reduce';f.mutations[0]();assert.equal(f.resets,1);assert.equal(f.frames.size,0);
  f.root.dataset.motion='full';f.move(10,20);f.el.isConnected=false;f.step(16);assert.equal(f.frames.size,0);assert.equal(f.resets,2);
});

test('leaving the window or losing focus cancels decoration without waiting for background RAF',()=>{
  for (const event of ['exit','blur']) {
    const f=fixture();f.move(110,120);f.step(16);assert.ok(f.frames.size);
    f[event]();assert.equal(f.frames.size,0);assert.equal(f.resets,1);
  }
});
