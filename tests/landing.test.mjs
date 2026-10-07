import test from 'node:test';
import assert from 'node:assert/strict';
import {landingState} from '../src/ui-math.js';

test('a sticker lands on the Today stage once per day', () => {
  const first = landingState(null, '2026-10-06', ['a']);
  assert.deepEqual(first.fresh, ['a']);
  const again = landingState(first.next, '2026-10-06', ['a']);
  assert.deepEqual(again.fresh, []);
  assert.deepEqual(landingState(first.next, '2026-10-06', ['a', 'b']).fresh, ['b']);
});

test('a new day starts with an empty record and old records are ignored', () => {
  const old = landingState(null, '2026-10-05', ['a']).next;
  assert.deepEqual(landingState(old, '2026-10-06', ['a']).fresh, ['a']);
  assert.deepEqual(landingState({date:'2026-10-06', ids:'broken'}, '2026-10-06', ['x']).fresh, ['x']);
});

test('the stored list stays small', () => {
  const ids = Array.from({length: 40}, (_, i) => 'id' + i);
  assert.equal(landingState(null, '2026-10-06', ids).next.ids.length, 24);
});
