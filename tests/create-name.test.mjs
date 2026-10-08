import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the name travels with Make this Peta and Save changes, and an edit starts from the current name', () => {
  const create = read('src/app/js/create.js'), book = read('src/app/js/book.js');
  assert.match(create, /creator_finish",\{[^}]*name:CR\.name\}/);
  assert.match(create, /creator_save_original",\{[^}]*name:CR\.name\}/);
  assert.match(create, /Object\.assign\(CR,\{name:'',/); // a new Create starts with an empty name
  assert.match(book, /CR\.editing = e\.id; CR\.name = e\.name \|\| ""/);
  assert.match(create, /maxlength: 40/);
});

test('the Collection shows the name the person gave, then the pack name, then "Sticker"; the name itself is kept for editing', () => {
  assert.match(read('src/app/js/bridge.js'), /name:e\.title \|\| null, title:e\.title \|\| e\.packName \|\| 'Sticker'/);
});

test('the native side checks the name before it makes anything, and stores it last', () => {
  const rs = read('src-tauri/src/creator.rs');
  assert.match(rs, /peta_core::clean_title\(n\)\.map_err/);
  const finish = rs.slice(rs.indexOf('fn finish('), rs.indexOf('/// Reopen the original source'));
  assert.ok(finish.indexOf('lib.add_made_with_editor') < finish.indexOf('set_sticker_title'), 'the name is saved after the sticker exists');
  assert.match(rs, /creator_save_original\(app: AppHandle, material_id: String, strength: f32, smooth: f32, outline: f32, name: Option<String>\)/);
});

test('the name field is drawn on the delivered paper (2400×360): its left and right 200px are kept and the middle stretches', () => {
  const png = fs.readFileSync(new URL('../src/art/ui/name-tag-paper.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 2400); assert.equal(png.readUInt32BE(20), 360);
  assert.equal(png[25], 6, 'RGBA'); // colour type 6
  assert.match(read('src/app/js/assets.js'), /nameTagPaper: "ui\/name-tag-paper\.png"/);
  assert.match(read('src/app/css/native.css'), /\.nt-paper::before \{[^}]*border-image:var\(--a-nameTagPaper\) 0 200 0 200 fill/);
});

test('the name is written in the bundled Patrick Hand (OFL); Japanese comes from Kiwi Maru (OFL), which has the same stroke weight', () => {
  for (const f of ['PatrickHand-Regular-Latin.woff2', 'PatrickHand-OFL.txt', 'KiwiMaru-Regular-JP.woff2', 'KiwiMaru-OFL.txt'])
    assert.ok(fs.existsSync(new URL(`../src/fonts/${f}`, import.meta.url)), f);
  assert.ok(!fs.existsSync(new URL('../src/fonts/HachiMaruPop-Regular-JP.woff2', import.meta.url)), 'the rejected candidate is not bundled');
  const css = read('src/fonts/fonts.css');
  assert.match(css, /font-family: "Patrick Hand"; src: url\("PatrickHand-Regular-Latin\.woff2"\)/);
  assert.match(css, /font-family: "Kiwi Maru"; src: url\("KiwiMaru-Regular-JP\.woff2"\)/);
  assert.match(read('src/fonts/NOTICE.md'), /Patrick Hand[^]*Kiwi Maru/);
  assert.match(read('src/app/css/native.css'), /\.nt-paper input \{[^}]*font:400 21px\/1 "Patrick Hand","Kiwi Maru","Hiragino Maru Gothic ProN"/);
});

test('the name tag has no outline on focus or hover, and its shadow is always the same depth', () => {
  const css = read('src/app/css/native.css');
  assert.doesNotMatch(css, /\.nt-paper:(focus-within|hover|focus)/);
  assert.match(css, /\.nt-paper::before \{[^}]*filter:drop-shadow\(0 5px 5px rgba\(60,45,20,\.16\)\)/);
  assert.match(css, /\.nt-paper input:focus \{ outline:none; \}/);
});

test('the bottom row of Create uses the app\'s standard sizes: the name field is 44px high, the buttons are the plain .btn, the notes the usual small text', () => {
  const css = read('src/app/css/native.css'), js = read('src/app/js/create.js');
  assert.match(css, /\.cs-foot \{ display:grid; grid-template-columns:minmax\(0,1fr\) auto; align-items:start;/);
  assert.match(css, /\.nametag \{[^}]*grid-template-columns:auto minmax\(0,380px\)/);
  assert.match(css, /\.nt-paper \{ --nt-h:44px; position:relative; height:var\(--nt-h\); \}/);
  assert.match(css, /\.cs-foot \.go-btns \{[^}]*height:44px/);
  assert.doesNotMatch(css, /\.cs-foot \.go-btns \.btn \{/, 'no private button size');
  assert.doesNotMatch(css, /\.nt-notes > \*/, 'no private text size for the notes');
  assert.match(js, /h\("div\.cs-foot-left", this\.nameField\(\), h\("div\.nt-notes", h\("small\.muted\.nt-hint"/);
  assert.match(js, /CR\.editing \? "Cancel" : "Start over"/);
});
