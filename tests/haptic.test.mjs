import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

test('haptic helper sends the three patterns once, honours opt-out, and tolerates unavailable hardware', async () => {
  const calls = [];
  const context = vm.createContext({window:{__TAURI__:{core:{invoke(cmd, args) { calls.push({cmd,...args}); return Promise.reject(Error('unavailable')); }}}}});
  vm.runInContext(readFileSync(new URL('../src/app/js/audio.js', import.meta.url), 'utf8') + '\n globalThis.feedback = Haptic;', context);
  for (const kind of ['paste','peel','seal']) context.feedback.tap(kind);
  assert.deepEqual(calls, ['paste','peel','seal'].map(kind=>({cmd:'haptic_tap',kind})));
  context.feedback.on = false;
  context.feedback.tap('paste');
  context.feedback.on = true;
  context.feedback.tap('hover');
  assert.equal(calls.length, 3);
  delete context.window.__TAURI__;
  context.feedback.tap('seal');
  await new Promise(resolve=>setImmediate(resolve));
});
