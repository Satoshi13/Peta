import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('every link tag command the pages and the layer call is registered and granted', () => {
  const ui = read('src/app/js/linktag.js') + read('src/app/js/bridge.js') + read('src/app/js/book.js') + read('src/main.js');
  const called = [...new Set([...ui.matchAll(/(?:invoke|Bridge\.invoke)\(["'](link_tag_[a-z_]+|layer_capture)["']/g)].map((m) => m[1]))];
  assert.ok(called.length >= 6, called.join());
  const lib = read('src-tauri/src/lib.rs'), perms = read('src-tauri/permissions/desktop-effects.toml');
  for (const c of called) { assert.match(lib, new RegExp(`\\b${c}\\b`), `${c} is not registered`); assert.match(perms, new RegExp(`"${c}"`), `${c} is not granted`); }
});

test('the kinds a tag may have are the same in the dialog and in Rust, and the Rust side only ever opens (no commands)', () => {
  const kinds = [...read('src/app/js/linktag.js').match(/LT_KINDS = \[(.*?)\];/s)[1].matchAll(/\["(\w+)"/g)].map((m) => m[1]);
  const rs = read('src-tauri/crates/core/src/link_tag.rs');
  assert.deepEqual(kinds, [...rs.match(/KINDS: \[&str; 3\] = \[(.*?)\]/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]));
  const opener = read('src-tauri/src/link_tags.rs');
  assert.match(opener, /Command::new\("\/usr\/bin\/open"\)/);
  assert.doesNotMatch(opener.replace(/\/\/.*$/gm, ''), /Command::new\("(?!\/usr\/bin\/(open|osascript))/); // nothing else is ever run
  assert.match(opener, /args\(\["-l", "JavaScript", "-e", ICON_JXA\]\)/); // osascript only runs the fixed icon script; the app's path is an argument, never part of the script
  assert.match(opener, /link_tag::validate\(&tag\.kind, &tag\.target, &tag\.label\)/); // re-checked from the saved record before opening
});

test('a Gift transaction releases tags and its serialized envelope never carries a target', () => {
  const core=read('src-tauri/crates/core/src/gift.rs'), ownership=read('src-tauri/crates/core/src/ownership.rs');
  assert.ok(core.indexOf('o::release_local') < core.indexOf('persist(&bytes)?'));
  assert.match(ownership,/\["placements","link_tags","print_queue"\]/);
  const header=core.slice(core.indexOf('pub struct GiftHeader'),core.indexOf('pub const GIFT_BAGS'));
  assert.doesNotMatch(header,/pub (target|link_tag)/);
  assert.match(read('src-tauri/src/gifts.rs'),/export::Export::publish/);
});

test('the desktop layer only captures the mouse for a tagged sticker, never in Edit Mode, and hands it back', () => {
  const m = read('src/main.js');
  assert.match(m, /if \(editing \|\| !tagged\.size\) \{ if \(captured\) setCapture\(false, null\); return; \}/);
  assert.match(m, /setCapture\(!!node && tagged\.has\(node\.placement\.stickerId\), node\)/);
  assert.match(read('src-tauri/src/layers.rs'), /if st\.edit_mode \|\| info\.edit_mode \|\| \(st\.print && info\.is_primary\) \{ return Ok\(\(\)\); \}/);
});
