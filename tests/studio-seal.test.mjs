import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const js = fs.readFileSync(new URL('../src/app/js/studio.js', import.meta.url), 'utf8');

test('sealing is the real thing: it signs and writes first, and only then marks the draft sealed', () => {
  const seal = js.slice(js.indexOf('const seal = async () =>'), js.indexOf('const paintPanel'));
  assert.ok(seal.indexOf('await sealGift()') > 0 && seal.indexOf('await sealPack()') > 0);
  assert.ok(seal.indexOf('await sealPack()') < seal.indexOf('d.sealed = true'), 'sealed is set after the file or shelf entry was made');
  assert.match(seal, /if\(!result\) \{ ST\.sealing = false; paint\(\); return; \}/);   // a cancelled save dialog makes nothing
  assert.match(seal, /stForget\(ST\.mode\)/);                                          // and what was made does not come back as a draft
  assert.match(js, /gift_send/); assert.match(js, /creator_pack_shelve/); assert.match(js, /creator_pack_save/);
});
test('the pickers have a search, and a tap does not rebuild the list (so it keeps its scroll and focus)', () => {
  assert.match(js, /function stFind\(fill\)/);
  const gather = js.slice(js.indexOf('const packGather = () =>'), js.indexOf('const packDress = () =>'));
  assert.match(gather, /stFind\(fill\)/);
  assert.doesNotMatch(gather.slice(gather.indexOf('const toggle')), /\bpaint\(\)/);
});
test('a step that cannot go on says why beside its button', () => {
  assert.match(js, /const stNext = /);
  for(const reason of ['Give the pack a name to continue.', 'Write who it is for to continue.', 'Choose a sticker to continue.']) assert.ok(js.includes(reason), reason);
});
