import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { bagResolveLayout, bagClampPart, bagComposition, bagAccentDefault, bagPartSize } from '../src/ui-math.js';

const kraft = { W: 3, H: 4, body: [4, 5, 96, 97], lbl: [21, 39, 79, 65.5], cover: [72, 80, 30, 8], clip: [76, 6, 9, 16], pin: [50, 6, 7], tape: [12, 5.5, 76, 8, -1.5] };
const inside = (bag, part, [x, y]) => { const [x0, y0, x1, y1] = bag.body, { w, h } = bagPartSize(bag, part); return x - w / 2 >= x0 - 1e-9 && x + w / 2 <= x1 + 1e-9 && y - h / 2 >= y0 - 1e-9 && y + h / 2 <= y1 + 1e-9; };

test('the cover sticker can never be dragged outside the wrapping', () => {
  for (const spot of [[-50, -50], [500, 500], [0, 100], [100, 0], [NaN, 20]]) assert.ok(inside(kraft, 'cover', bagClampPart(kraft, 'cover', spot)), `cover ${spot}`);
});
test('the cover sticker never sits on the name: dropped on it, it goes to a free side', () => {
  const [l, t, r, b] = kraft.lbl, { w, h } = bagPartSize(kraft, 'cover'), apart = ([x, y]) => x - w / 2 >= r - 1e-9 || x + w / 2 <= l + 1e-9 || y - h / 2 >= b - 1e-9 || y + h / 2 <= t + 1e-9;
  for (const spot of [[50, 52], [70, 50], [30, 45], [50, 40], [50, 65], [79, 52]]) { const c = bagClampPart(kraft, 'cover', spot); assert.ok(apart(c), `${spot} -> ${c}`); assert.ok(inside(kraft, 'cover', c)); }
  for (const comp of ['center', 'corner', 'band']) assert.ok(apart(bagComposition(kraft, comp).cover), comp);
  assert.deepEqual(bagClampPart(kraft, 'cover', [72, 80]), [72, 80]);   // a free place is left alone
});
test('an accent keeps its centre on the wrapping', () => {
  const [x, y] = bagClampPart(kraft, 'clip', [-20, 300]); assert.ok(x >= kraft.body[0] && y <= kraft.body[3]);
  const clip=bagAccentDefault(kraft,'clip'); assert.equal(clip[0],76); assert.ok(clip[1]>kraft.body[1] && clip[1]<kraft.body[1]+bagPartSize(kraft,'clip').h/2); assert.deepEqual(bagAccentDefault(kraft, 'tape'), [50, 9.5]);
});
test('every composition keeps the cover inside, and none of them moves the label', () => {
  for (const comp of ['center', 'corner', 'band']) { const c = bagComposition(kraft, comp); assert.ok(inside(kraft, 'cover', c.cover), comp); assert.deepEqual(c.label, [50, 52.25], comp); }
  assert.notDeepEqual(bagComposition(kraft, 'band').cover, bagComposition(kraft, 'center').cover);
});
test('the three cover presets are visibly different on every pack wrapping', () => {
  const ctx=vm.createContext({A:new Proxy({},{get:()=>''})});
  vm.runInContext(fs.readFileSync(new URL('../src/app/js/catalog.js',import.meta.url),'utf8')+';this.catalog={BAGS,PACK_BAG_IDS};',ctx);
  for(const id of ctx.catalog.PACK_BAG_IDS) {
    const bag=ctx.catalog.BAGS[id],positions=['center','corner','band'].map(comp=>bagComposition(bag,comp).cover);
    for(const [i,p] of positions.entries()) {
      assert.ok(inside(bag,'cover',p),`${id}: cover outside the wrapping`);
      for(const q of positions.slice(i+1)) assert.ok(Math.hypot(q[0]-p[0],q[1]-p[1])>10,`${id}: cover presets look the same`);
    }
  }
});
test('a layout always has a label; at most two accents, one of each kind, only the known ones', () => {
  const r = bagResolveLayout(kraft, { comp: 'free', accents: [{ kind: 'clip', x: 10, y: 10 }, { kind: 'clip', x: 20, y: 20 }, { kind: 'pin', x: 50, y: 50 }, { kind: 'tape', x: 1, y: 1 }, { kind: 'glitter', x: 1, y: 1 }] });
  assert.equal(r.comp, 'free'); assert.deepEqual(r.label, [50, 52.25]);   // wherever a file says it is, the label stays on the wrapping's own print
  assert.deepEqual(bagResolveLayout(kraft, { label: [90, 90] }).label, [50, 52.25]);
  assert.deepEqual(r.accents.map(a => a.kind), ['clip', 'pin']);
  assert.deepEqual(bagResolveLayout(kraft, {}).label, bagComposition(kraft, 'corner').label);   // nothing set: the wrapping's own places
  assert.equal(bagResolveLayout(kraft, { comp: 'anywhere' }).comp, 'corner');
});
