import test from 'node:test';
import assert from 'node:assert/strict';
import {alphaBounds} from '../src/ui-math.js';

const image = (w, h, painted) => { const d = new Uint8ClampedArray(w * h * 4); for (const [x, y, a] of painted) d[(y * w + x) * 4 + 3] = a; return d; };

test('the box wraps every visible pixel and nothing else', () => {
  const d = image(10, 8, [[2, 3, 255], [6, 3, 255], [4, 6, 200]]);
  assert.deepEqual(alphaBounds(d, 10, 8), {x:2, y:3, w:5, h:4});
});
test('faint specks below the threshold are ignored; an empty image has no box', () => {
  assert.deepEqual(alphaBounds(image(6, 6, [[0, 0, 10], [5, 5, 12]]), 6, 6), null);
  assert.deepEqual(alphaBounds(image(6, 6, [[0, 0, 10], [3, 2, 255]]), 6, 6), {x:3, y:2, w:1, h:1});
});
