import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, average, advise, DEFAULTS, SHEET, MATERIALS } from '../scripts/economy-sim.mjs';

test('a run is the same every time for one seed, and different for another', () => {
  const a = simulate({ seed: 3 }), b = simulate({ seed: 3 }), c = simulate({ seed: 4 });
  assert.deepEqual(a.summary, b.summary); assert.notDeepEqual(a.summary, c.summary);
});
test('the books balance: Scraps now = what we started with + what came in from the world - what was burned or spent', () => {
  for (const over of [{}, { price: 4 }, { sellerShare: .4, editions: 3 }, { players: 20, appetite: .9 }]) {
    const { summary: s } = simulate({ seed: 7, ...over });
    assert.ok(Math.abs(s.scrapsEnd - s.books) < 1e-6, `${JSON.stringify(over)}: ${s.scrapsEnd} vs ${s.books}`);
  }
});
test('nothing is ever duplicated: every minted sticker is in exactly one place (held or in a pack)', () => {
  for (const seed of [1, 2, 3, 4]) { const { summary: s } = simulate({ seed, resellProb: .4 }); assert.equal(s.stickersHeld + s.stickersInPacks, s.minted); }
});
test('the sheet values are the app\'s: the mix adds up to 1 and the averages are between the cheapest and the dearest', () => {
  assert.ok(Math.abs(MATERIALS.reduce((t, m) => t + m.p, 0) - 1) < 1e-9); assert.ok(SHEET.dismantle > 1 && SHEET.dismantle < 6); assert.ok(SHEET.buy > SHEET.dismantle);
});
test('a dearer pull means fewer pulls; a bigger seller share means less Scraps burned', () => {
  assert.ok(average({ price: 5 }, 8).summary.pulls > average({ price: 12 }, 8).summary.pulls);
  assert.ok(average({ sellerShare: .5 }, 8).summary.burnedPerPull > average({ sellerShare: .9 }, 8).summary.burnedPerPull);
});
test('with nothing worth pulling at, nobody lists (the market never starts), and it says so', () => {
  const r = average({ price: 2, sellerShare: .5 }, 6); assert.equal(r.summary.runs, 0);
  assert.ok(advise(r.summary, r.params).some((x) => x.tone === 'bad' && /誰も出品/.test(x.text)));
});
