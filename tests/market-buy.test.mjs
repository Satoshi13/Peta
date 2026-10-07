import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const market = fs.readFileSync(new URL("../src/app/js/market.js", import.meta.url), "utf8");
const packs = fs.readFileSync(new URL("../src/app/js/packs.js", import.meta.url), "utf8");

test("the Market card buys sets in place: the buy button must not carry mkz-act, which closes the zoom", () => {
  const box = market.slice(market.indexOf("buyBox(pack"), market.indexOf("/* The zoomed card"));
  assert.match(box, /"scrap_trade"/);
  assert.match(box, /button\.btn\.mkz-primary/);
  assert.doesNotMatch(box, /mkz-act/);
});

test("the zoom's focus trap reaches the stepper and the buy button", () => {
  assert.match(packs, /\$\$\("\.mkz-act, \.mkz-ctl, \.mkz-primary,/);
});

test("a purchase never redraws the page under an open card", () => {
  assert.match(fs.readFileSync(new URL("../src/app/js/bridge.js", import.meta.url), "utf8"), /PackZoom\.current\) PackZoom\.stale\(\)/);
});
