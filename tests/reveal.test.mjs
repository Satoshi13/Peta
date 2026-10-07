import test from 'node:test';
import assert from 'node:assert/strict';
import {revealPlan, sheetWave, sheetCell} from '../src/ui-math.js';

test('the room darkens in proportion to the rarity, and only rare and above hold the stage', () => {
  const dims = ['common', 'uncommon', 'rare', 'special', 'archive'].map(r => revealPlan(r).dim);
  assert.deepEqual(dims, [0, .14, .48, .7, .56]);
  assert.deepEqual(['common', 'uncommon', 'rare', 'special', 'archive'].map(r => revealPlan(r).hot), [false, false, true, true, true]);
});

test('common and uncommon never get an edge light; the aura is prism, gold or sepia', () => {
  assert.equal(revealPlan('common').aura, null);
  assert.equal(revealPlan('uncommon').aura, null);
  assert.deepEqual(['rare', 'special', 'archive'].map(r => revealPlan(r).aura), ['prism', 'gold', 'sepia']);
});

test('an unknown rarity falls back to common and special takes the longest breath', () => {
  assert.equal(revealPlan('mythic').rarity, 'common');
  assert.ok(revealPlan('special').pre > revealPlan('rare').pre && revealPlan('rare').pre > 0);
  assert.equal(revealPlan('common').pre, 0);
});

test('the wave keeps the order and marks the rares', () => {
  const wave = sheetWave(['common', 'rare', 'uncommon', 'special']);
  assert.deepEqual(wave.map(w => w.index), [0, 1, 2, 3]);
  assert.deepEqual(wave.map(w => w.hot), [false, true, false, true]);
  assert.ok(wave[3].hold > wave[1].hold);
});

test('a ten-sleeve sheet is two rows of five and fits inside small windows', () => {
  const big = sheetCell({stageWidth: 940, stageHeight: 620, footer: 170, count: 10});
  assert.equal(big.cols, 5); assert.equal(big.rows, 2); assert.ok(big.width <= 150);
  const small = sheetCell({stageWidth: 620, stageHeight: 440, footer: 170, count: 10});
  assert.ok(small.width * 5 + small.gap * 4 <= 620 - 40);
  assert.ok(small.height * 2 + small.gap <= 440 - 170 - 54 + 1);
  assert.equal(sheetCell({stageWidth: 900, stageHeight: 600, footer: 170, count: 3}).rows, 1);
});
