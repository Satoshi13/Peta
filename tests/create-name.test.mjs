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
