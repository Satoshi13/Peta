import {test} from 'node:test';
import assert from 'node:assert/strict';
import {REFLECTIVE_MATERIALS,staticSheen,reflectedSheen,approachSheen} from '../src/reflection.js';
const box={cx:720,cy:450,rotation:-4};
test('reflection fallback is the original position/rotation band',()=>{
  assert.deepEqual(staticSheen(box,1440,900),{x:50,y:50,angle:119});
  assert.deepEqual(reflectedSheen(box,1440,900,null),staticSheen(box,1440,900));
  assert.deepEqual(reflectedSheen(box,1440,900,{x:1,y:1,inside:false}),staticSheen(box,1440,900));
  assert.deepEqual(reflectedSheen(box,1440,900,{x:720,y:450,inside:true}),staticSheen(box,1440,900));
  assert.deepEqual([...REFLECTIVE_MATERIALS],['holographic','gold']);
});
test('cursor direction moves only a bounded band',()=>{
  const before={...box},right=reflectedSheen(box,1440,900,{x:999999,y:450,inside:true});
  assert.equal(right.x,72);assert.equal(right.y,50);assert.equal(right.angle,137);assert.deepEqual(box,before);
  assert.ok(reflectedSheen(box,1440,900,{x:0,y:450,inside:true}).x<50);
});
test('interpolation converges exactly and has a stopping condition',()=>{
  const target={x:70,y:30,angle:135};let value={x:50,y:50,angle:115},done=false,frames=0;
  while(!done && frames++<100) ({value,done}=approachSheen(value,target,16));
  assert.ok(done && frames<100);assert.deepEqual(value,target);
  assert.deepEqual(approachSheen(target,target,16),{value:target,done:true});
});
