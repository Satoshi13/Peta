import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

// A command that is registered in Rust but missing from the permission lists fails at runtime with
// "<command> not allowed. Command not found". Every native command the UI calls must be granted.
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const granted = new Set([...readdirSync(new URL('src-tauri/permissions/', root)).filter(f => f.endsWith('.toml'))
  .flatMap(f => [...read('src-tauri/permissions/' + f).matchAll(/commands\.allow\s*=\s*\[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/"([a-z_0-9]+)"/g)].map(x => x[1])))]);

test('every native command the app UI invokes is granted by a permission', () => {
  const files = ['app/js/bridge.js', 'app/js/ceremony.js', 'app/js/packs.js', 'app/js/market.js', 'app/js/shared.js', 'app/js/today.js', 'app/js/create.js', 'app/js/book.js', 'app/js/settings.js', 'app/js/library-pages.js', 'app/js/audio.js'];
  const called = new Set(files.flatMap(f => [...read('src/' + f).matchAll(/(?:invoke|printAction)\(\s*(?:[^"'`(),]*\?\s*)?["']([a-z_0-9]+)["']/g)].map(m => m[1])));
  for (const free of read('src/app/js/ceremony.js').matchAll(/free\s*\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/g)) { called.add(free[1]); called.add(free[2]); }
  assert.ok(called.has('pack_open_free'), 'the free opening command must be found by this scan');
  const missing = [...called].filter(name => !granted.has(name));
  assert.deepEqual(missing, [], `not granted: ${missing.join(', ')}`);
});
