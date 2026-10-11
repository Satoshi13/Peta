import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("ten at once never queue prints: the batch opens with queue:false and has no Later", () => {
  const gx = read("src/app/js/gx.js"), cer = read("src/app/js/ceremony.js");
  assert.match(gx, /"pack_open", \{ packId: pack\.id, queue: false \}/);
  assert.doesNotMatch(gx, /laterIt|laterBtn|"Later"|"Stick them"/);
  const many = cer.slice(cer.indexOf("async function openPackMany"), cer.indexOf("return { openMaterial"));
  assert.doesNotMatch(many.replace(/\/\/.*$/gm, ""), /print_later|Desktop\.print|print slot/i);
});

test("one pack sticker: the pull queues nothing; Stick it sends it to the desktop, Keep in Collection (or Esc) just closes", () => {
  const cer = read("src/app/js/ceremony.js");
  const one = cer.slice(cer.indexOf("async function openPack("), cer.indexOf("const RARITY_RANK")).replace(/\/\/.*$/gm, "");
  assert.match(one, /\{packId:pack\.id, queue:false\}/);                       // opening never queues a print
  assert.match(one, /daily_stick_from_collection/);                              // Stick it = the Collection's "Stick on desktop"
  assert.match(one, /Desktop\.print\(entry\)/);
  assert.match(one, /laterLabel: entry.prize \? "Done" : "Keep in Collection"/);                         // there is a way back that is not sticking
  assert.match(one, /else leave\(\)/);                                           // and Esc closes after the reveal too
  assert.doesNotMatch(one, /print_later|print slot/i);                           // nothing is left waiting at the print slot
});

test("the native pack_open takes an optional queue flag and only queues a print when asked", () => {
  const rs = read("src-tauri/src/packs.rs");
  assert.match(rs, /pack_open\(app: AppHandle, pack_id: String, queue: Option<bool>\)/);
  assert.match(rs, /if queue \{ daily::confirm\(/);
  assert.match(rs, /pack_open_free\(app: AppHandle, pack_id: String, queue: Option<bool>\)/);
});
