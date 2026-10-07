import test from 'node:test';
import assert from 'node:assert/strict';
import {posterLayout, fitInside, calendarMonth} from '../src/ui-math.js';

test('poster layout places days on a seven-column grid below the header', () => {
  const l = posterLayout(4, 31);               // October 2026 starts on a Thursday with Sunday-first weeks
  assert.equal(l.rows, 5);
  assert.equal(l.cellW, (1600 - 96 * 2) / 7);
  const first = l.cell(1), second = l.cell(2), nextRow = l.cell(4);
  assert.equal(first.y, l.gridTop);
  assert.ok(Math.abs(second.x - first.x - l.cellW) < 1e-9);
  assert.equal(nextRow.y - first.y, l.cellH);   // day 4 is the first Sunday: back to column 0, one row down
  assert.equal(nextRow.x, l.margin);
});

test('poster height grows with the number of week rows and every cell stays inside the image', () => {
  for (const [offset, days] of [[0, 28], [6, 31], [5, 30], [4, 31]]) {
    const l = posterLayout(offset, days);
    const last = l.cell(days);
    assert.ok(last.x + last.w <= l.width);
    assert.ok(last.y + last.h <= l.height);
  }
  assert.ok(posterLayout(6, 31).height > posterLayout(0, 28).height);
});

test('stickers fit a cell without distortion', () => {
  const f = fitInside(1024, 512, 190, 190);
  assert.equal(f.w, 190); assert.equal(f.h, 95);
  const t = fitInside(100, 400, 190, 190);
  assert.equal(t.h, 190); assert.equal(t.w, 47.5);
});

test('poster rows agree with the calendar month the page shows', () => {
  const m = calendarMonth([], 2026 * 12 + 9, new Date(2026, 9, 6, 12), 0);
  assert.equal(posterLayout(m.offset, m.days).rows, 5);
});
