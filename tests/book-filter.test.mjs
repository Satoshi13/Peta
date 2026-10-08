import test from 'node:test';
import assert from 'node:assert/strict';
import { filterBookEntries, bookSearchText } from '../src/ui-math.js';

const day = (m, d) => new Date(2026, m - 1, d, 12);
const e = (id, title, material, date, extra = {}) => ({ id, title, material, date, createdAt: date.toISOString(), no: null, kind: 'original', ...extra });
const lib = [
  e('a', 'Good Day', 'matte', day(10, 5), { no: 1 }),
  e('b', 'Coffee Club', 'kraft', day(10, 7), { kind: 'received' }),
  e('c', 'Sticker 3', 'holographic', day(10, 6), { no: 3, onDesktop: true }),
  e('d', 'Cats', 'kraft', day(9, 30), { kind: 'received' }),
];
const names = { matte: 'Matte', kraft: 'Kraft', holographic: 'Holographic' };
const run = (o) => filterBookEntries(lib, { materialIds: ['matte', 'kraft', 'holographic'], nameOf: id => names[id], ...o }).map(x => x.id).join('');

test('newest first is the default and keeps every sticker', () => assert.equal(run({}), 'bcad'));
test('oldest first reverses it', () => assert.equal(run({ sort: 'oldest' }), 'dacb'));
test('a material keeps only its stickers, in the chosen order', () => { assert.equal(run({ material: 'kraft' }), 'bd'); assert.equal(run({ material: 'kraft', sort: 'oldest' }), 'db'); });
test('every word of a search must match: name, material, number, date, origin', () => {
  assert.equal(run({ query: 'coffee' }), 'b');
  assert.equal(run({ query: 'KRAFT' }), 'bd');
  assert.equal(run({ query: 'holographic no 3' }), 'c');
  assert.equal(run({ query: 'no 0001' }), 'a');
  assert.equal(run({ query: 'oct 7' }), 'b');
  assert.equal(run({ query: '2026-09-30' }), 'd');
  assert.equal(run({ query: 'received' }), 'bd');
  assert.equal(run({ query: 'desktop' }), 'c');
  assert.equal(run({ query: 'kraft cats' }), 'd');
  assert.equal(run({ query: 'nothing like this' }), '');
});
test('search and material work together', () => assert.equal(run({ query: 'received', material: 'kraft', sort: 'oldest' }), 'db'));
test('name order is A to Z with numbers in order; material order follows the material list; ties fall back to newest', () => {
  assert.equal(run({ sort: 'name' }), 'dbac');      // Cats, Coffee Club, Good Day, Sticker 3
  assert.equal(run({ sort: 'material' }), 'abdc');   // matte, kraft (newest first: b, d), holographic
});
test('the search words are folded: full-width letters and case do not matter', () => { assert.equal(run({ query: 'ＣＡＴＳ' }), 'd'); assert.match(bookSearchText(lib[0], 'Matte'), /good day/); });

import fs from 'node:fs';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
test('the Collection list has the filter bar; typing redraws only the results so the field keeps focus', () => {
  const js = read('src/app/js/book.js');
  assert.match(js, /PetaMath\.filterBookEntries\(items/);
  assert.match(js, /h\("div\.bk-filter", \{ role: "search" \}/);
  assert.match(js, /search\.addEventListener\("input", \(\) => \{ BK\.q = search\.value; fill\(\); \}\)/);
  const fill = js.slice(js.indexOf('const fill = () =>'), js.indexOf('main.append(count'));
  assert.equal(fill.split('paint()').length - 1, 1, 'only the Clear button repaints the whole page; typing does not');
  assert.match(js, /count\.replaceChildren\(\.\.\.\[[^]*\]\.filter\(Boolean\)\)/); // no stray "null" in the count
});
