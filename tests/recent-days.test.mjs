import test from 'node:test';
import assert from 'node:assert/strict';
import {recentDays} from '../src/ui-math.js';

test('the last seven days end today and mark the days with a sticker', () => {
  const days = recentDays(['2026-10-06', '2026-10-04', '2026-09-30'], new Date(2026, 9, 6, 15));
  assert.equal(days.length, 7);
  assert.equal(days[0].key, '2026-09-30');
  assert.equal(days[6].key, '2026-10-06');
  assert.deepEqual(days.map(d => d.filled), [true, false, false, false, true, false, true]);
  assert.deepEqual(days.map(d => d.today), [false, false, false, false, false, false, true]);
});

test('month and year boundaries are crossed by calendar days, not by 24-hour steps', () => {
  const days = recentDays([], new Date(2027, 0, 2, 0, 30));
  assert.equal(days[0].key, '2026-12-27');
  assert.equal(days[6].key, '2027-01-02');
});
