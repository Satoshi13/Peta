import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test("Market's \"Friends in Settings\" opens Settings at the Friends card, not at the top", () => {
  assert.match(read('src/app/js/market.js'), /on: \{ click: \(\) => Shell\.reveal\("settings", "\.fr-card"\) \} \}, "Friends in Settings "/);
  const shell = read('src/app/js/shell.js');
  assert.match(shell, /async function reveal\(id, selector, o = \{\}\) \{\s*await go\(id, o\);/);
  assert.match(shell, /scrollIntoView\(\{ block: "start", behavior: reduced\(\) \? "auto" : "smooth" \}\)/, 'Reduce motion jumps instead of gliding');
  assert.match(shell, /heading\.focus\(\{ preventScroll: true \}\)/, 'keyboard focus lands on the card');
  assert.match(read('src/app/css/friends.css'), /\.fr-card \{ scroll-margin-top: 28px; \}/);
});
