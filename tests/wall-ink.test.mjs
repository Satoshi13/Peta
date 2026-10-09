import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the remaining count is written letter by letter, with its own tilt, lift, size and pressure, and goes through the wall-ink filter', () => {
  const js = read('src/app/js/packs.js'), css = read('src/app/css/native.css'), html = read('src/app.html');
  assert.match(js, /const WallInk = \{/);
  assert.match(js, /WallInk\.write\(`\$\{p\.left\.length\} left`, p\.id\)/);
  assert.match(css, /\.pk-count \{[^}]*filter:url\(#wall-ink\)/);
  assert.match(css, /\.pk-count \.ink \{[^}]*translateY\(var\(--y,0\)\) rotate\(var\(--r,0deg\)\) scale\(var\(--s,1\)\)/);
  assert.match(html, /<filter id="wall-ink"[^]*feDisplacementMap[^]*feGaussianBlur[^]*feComposite[^]*<\/filter>/);
});

test('the same pack is always written the same way, and different packs are not written alike', () => {
  const src = read('src/app/js/packs.js');
  const body = src.slice(src.indexOf('const WallInk = {'), src.indexOf('Pages.packs = {'));
  const WallInk = new Function('h', `${body}; return WallInk;`)((tag, attrs, ...kids) => ({ tag, attrs, kids }));
  const flat = (o) => JSON.stringify(o);
  assert.equal(flat(WallInk.write('12 left', 'welcome')), flat(WallInk.write('12 left', 'welcome')));
  assert.notEqual(flat(WallInk.write('12 left', 'welcome')), flat(WallInk.write('12 left', 'pixel')));
  const w = WallInk.write('6 left', 'x');
  assert.ok(Math.abs(parseFloat(w.tilt)) <= 1.3 && Math.abs(parseFloat(w.dx)) <= 3);
});

test('the wall grain only makes the ink uneven; it never cuts holes in 2px strokes (the count has to stay legible at 1x)', () => {
  const html = read('src/app.html');
  const m = html.match(/<feColorMatrix in="grain"[^>]*values="([^"]+)"/);
  assert.ok(m, 'the grain matrix exists');
  const alpha = m[1].trim().split(/\s+/).slice(15, 20).map(Number); // the alpha row: R G B A offset
  const [r, , , , offset] = alpha;
  // the lowest the ink density can go (noise red 0.2) must still be at least half
  assert.ok(r * 0.2 + offset >= 0.5, `ink never drops below half density, got ${r * 0.2 + offset}`);
  assert.match(html, /feDisplacementMap[^>]*scale="1\.1"/);
});
