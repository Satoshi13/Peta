import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("every Market prop named in assets.js exists under src/art/market", () => {
  const keys = [...read("src/app/js/assets.js").matchAll(/(market\w+): "(market\/[\w.-]+)"/g)];
  assert.ok(keys.length >= 7);
  for (const [, key, file] of keys) assert.ok(fs.existsSync(new URL(`../src/art/${file}`, import.meta.url)), `${key} → ${file} is missing`);
});

test("the rail uses the delivered anchors: the rod is 13px high, the hanging clip's ring sits on the rod", () => {
  const anchors = JSON.parse(read("src/art/market/anchors.json")), css = read("src/app/css/native.css");
  assert.equal(anchors["rail-bar"].displayHeightPx, 13);
  assert.match(css, /\.mk-rod \{[^}]*height:13px/);
  // ring centre 42px at 4x → 10.5px below the clip's top; the rod's centre is 23.4px at 4x → 5.85px below the rod's top.
  assert.equal(anchors["rail-clip"].ringCenterY / 4, 10.5);
  assert.match(css, /\.mk-clip \{[^}]*top:calc\(-1 \* var\(--pad\) - 4\.65px\)/);
});

test("each rail row is its own rod, so a wrapped row never hangs from nothing", () => {
  const js = read("src/app/js/market.js");
  assert.match(js, /h\("div\.mk-rail-row"[^]*h\("i\.mk-rod"\)[^]*h\("i\.mk-end\.l"\)[^]*h\("i\.mk-end\.r"\)/);
});

test("the rail's packs are pendulums driven by the page's real motion, start with the transition, and never move on hover or with reduced motion", () => {
  const js = read("src/app/js/market.js"), css = read("src/app/css/native.css"), shell = read("src/app/js/shell.js");
  assert.match(js, /arrive\(root, o\) \{ if \(MK\.tab === "packs"\) requestAnimationFrame\(\(\) => Pages\.market\.sway\(root, o\?\.dir, \(\) => root\.querySelector\("\.mk-rail-row"\)\?\.getBoundingClientRect\(\)\.left\)/);
  assert.match(js, /sway\(root, dir = 1, follow = null\) \{\s*if \(reduced\(\)\) return;/);
  assert.match(js, /Math\.sin\(b\.th\)[^;]*Math\.cos\(b\.th\)/);
  assert.ok(shell.indexOf("Pages[id].arrive?.(next") < shell.indexOf("await TRANS["), "the swing starts before the transition, not after it");
  assert.doesNotMatch(js, /enter\(root, o\)/);
  assert.doesNotMatch(css, /\.mk-item:has\(\.mk-tile:hover\)/);
  assert.match(js, /h\("span\.pk-badge\.own", "Owned"\)/);
  assert.doesNotMatch(js, /On shelf/);
  assert.match(css, /\.mk-tile:hover, \.mk-tile\[aria-pressed="true"\][^}]*background:none; box-shadow:none/);
  assert.match(css, /\.mk-tile \.pk-badge \{ position:static;[^}]*background:none; box-shadow:none/);
});
