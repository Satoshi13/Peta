import test from 'node:test';
import assert from 'node:assert/strict';
import {navShortcut} from '../src/ui-math.js';
test('Command navigation follows the displayed order',()=>{
  for(const [i,page] of ['today','create','book','packs','gifts','materials','market'].entries()) assert.equal(navShortcut({key:String(i+1),metaKey:true}),page);
  assert.equal(navShortcut({key:',',metaKey:true}),'settings');
});
test('typing, dialogs, ceremonies and native editing shortcuts are untouched',()=>{
  for(const flag of ['input','dialog','busy','ceremony']) assert.equal(navShortcut({key:'1',metaKey:true},{[flag]:true}),null);
  for(const flag of ['ctrlKey','altKey','shiftKey','isComposing']) assert.equal(navShortcut({key:'1',metaKey:true,[flag]:true}),null);
  for(const key of ['z','Z','y','q','8','ArrowRight']) assert.equal(navShortcut({key,metaKey:true}),null);
  assert.equal(navShortcut({key:'1'}),null);
});
