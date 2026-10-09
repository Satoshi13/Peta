import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the remaining count is written letter by letter, with its own tilt, lift, size and pressure, and gets its grain from a mask', () => {
  const js = read('src/app/js/packs.js'), css = read('src/app/css/native.css'), html = read('src/app.html');
  assert.match(js, /const WallInk = \{/);
  assert.match(js, /WallInk\.write\(`\$\{p\.left\.length\} left`, p\.id\)/);
  assert.match(css, /\.pk-count \{[^}]*mask-image:var\(--a-wallInkGrain\)/);
  assert.match(css, /\.pk-count \.ink \{[^}]*translateY\(var\(--y,0\)\) rotate\(var\(--r,0deg\)\) scale\(var\(--s,1\)\)/);
  assert.doesNotMatch(html, /wall-ink|<filter/, 'no SVG filter: WebKit renders it at 1x and smears 2px strokes on Retina');
  assert.doesNotMatch(css.slice(css.indexOf('.pk-count {'), css.indexOf('\n', css.indexOf('.pk-count {'))), /filter:\s*(?!none)/, 'no CSS filter on the count either');
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

import zlib from 'node:zlib';
/* The grain is a mask on 2px strokes: if it ever dips low the count turns pale and unreadable, so the floor is checked on the real pixels. */
function pngAlpha(buf) {
  let p = 8, w = 0, h = 0, idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len); if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); assert.equal(data[8], 8); assert.equal(data[9], 6, 'RGBA'); } if (type === 'IDAT') idat.push(data); p += len + 12; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (() => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })();
      out[y * stride + x] = (src[x] + pr) & 255;
    }
  }
  const alpha = []; for (let i = 3; i < out.length; i += 4) alpha.push(out[i]); return { w, h, alpha };
}
test('the wall grain only makes the ink uneven; the lowest density is above half, so a 2px stroke stays legible at 1x', () => {
  const { w, h, alpha } = pngAlpha(fs.readFileSync(new URL('../src/art/ui/wall-ink-grain.png', import.meta.url)));
  assert.deepEqual([w, h], [256, 256]);
  assert.ok(Math.min(...alpha) >= 128, `the lowest ink density is ${Math.min(...alpha)}/255`);
  assert.ok(alpha.reduce((s, v) => s + v, 0) / alpha.length >= 200, 'on average the ink is at least 78% dense');
  assert.match(read('src/app/js/assets.js'), /wallInkGrain: "ui\/wall-ink-grain\.png"/);
});
