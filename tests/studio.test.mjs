import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** catalog.js is plain data: run it on its own. */
function catalog() {
  const ctx = vm.createContext({ A: new Proxy({}, { get: () => 'art.png' }) });
  vm.runInContext(read('src/app/js/catalog.js') + '\n;this.__out = { BAGS, PACK_BAG_IDS, PACK_BAG_COMPAT_IDS, GIFT_BAG_IDS, isPouch, NAV };', ctx);
  return ctx.__out;
}
/** The small pure helpers at the top of studio.js, taken out by name. */
function helpers() {
  const src = read('src/app/js/studio.js'), pick = (name) => src.split('\n').find((l) => l.startsWith(`const ${name} =`));
  const ctx = vm.createContext({ STUDIO: { weights: [1, 2, 4, 8, 16] } });
  vm.runInContext(['stEm', 'stClip', 'stOdds', 'stPct', 'stOddsLine'].map(pick).join('\n') + '\n;this.__out = { stEm, stClip, stOdds, stPct, stOddsLine };', ctx);
  return ctx.__out;
}

test('every wrapping has its picture, and every place on it is inside the picture', () => {
  const { BAGS } = catalog(), assets = read('src/app/js/assets.js');
  for (const b of Object.values(BAGS)) {
    assert.match(assets, new RegExp(`\\b${b.art}:`), `${b.id}: no art entry ${b.art}`);
    for (const [name, v] of Object.entries({ cover: b.cover, clip: b.clip, pin: b.pin, tape: b.tape, lbl: b.lbl })) assert.ok(v && v.every(Number.isFinite), `${b.id}.${name}`);
    for (const [x, y] of [b.cover, b.clip, b.pin]) assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100, `${b.id}: a decoration sits outside the picture`);
    const [l, t, r, bt] = b.lbl; assert.ok(l < r && t < bt && l >= 0 && r <= 100 && t >= 0 && bt <= 100, `${b.id}: label box`);
    const [x0, y0, x1, y1] = b.body; assert.ok(x0 < x1 && y0 < y1 && x1 <= 100 && y1 <= 100, `${b.id}: body box`);
    assert.ok(b.cm > 0 && ['hang', 'stand'].includes(b.show) && ['tape', 'seal', 'sweep', 'string', 'slide', 'press'].includes(b.seal), `${b.id}: real-world facts`);
    if (b.seal === 'seal') assert.ok(b.disc, `${b.id}: a round seal needs a colour`);
    if (b.peek) assert.ok(b.peek.box.length === 4);
  }
});

test('the app and the Rust core agree on which wrappings exist', () => {
  const { PACK_BAG_COMPAT_IDS, GIFT_BAG_IDS, BAGS } = catalog(), rs = read('src-tauri/crates/core/src/creator_pack.rs'), gift = read('src-tauri/crates/core/src/gift.rs');
  const list = (text, name) => [...text.match(new RegExp(`${name}:\\s*\\[&str;\\s*\\d+\\]\\s*=\\s*\\[([^\\]]*)\\]`))[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...PACK_BAG_COMPAT_IDS].sort(), list(rs, 'BAGS').sort());
  assert.deepEqual([...GIFT_BAG_IDS].sort(), list(gift, 'GIFT_BAGS').sort());
  for (const id of [...PACK_BAG_COMPAT_IDS, ...GIFT_BAG_IDS]) assert.ok(BAGS[id], id);
  assert.equal(list(rs, 'DECOS').join(), 'clip,pin,tape,seal');
});

test('new packs offer four paper wrappings and a gift of six; only the three pouches are torn open', () => {
  const { PACK_BAG_IDS, GIFT_BAG_IDS, isPouch } = catalog();
  assert.equal(PACK_BAG_IDS.length, 4); assert.equal(GIFT_BAG_IDS.length, 6);
  assert.deepEqual([...PACK_BAG_IDS.filter(isPouch)], ['kraft', 'matte', 'holo']);
});

test('Studio is in the nav under Make with no shortcut of its own, and the others keep theirs', () => {
  const { NAV } = catalog(), by = Object.fromEntries(NAV.map((n) => [n.id, n]));
  assert.equal(NAV.findIndex((n) => n.id === 'book'), NAV.findIndex((n) => n.id === 'studio') + 1);
  assert.equal(by.book.group,'Library');assert.equal(by.packs.group,undefined);assert.equal(NAV.filter(n=>n.group==='Library').length,1);
  assert.equal(by.studio.key, undefined);
  assert.deepEqual(['today', 'create', 'book', 'packs', 'gifts', 'materials', 'market'].map((id) => by[id].key), [1, 2, 3, 4, 5, 6, 7]);
});

test('the odds are copies over all remaining copies and prize slots', () => {
  const { stOdds, stPct, stOddsLine } = helpers(), close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
  [0.1, 0.1, 0.8].forEach((v, i) => close(stOdds([{ copies: 1 }, { copies: 1 }, { copies: 8 }])[i], v));
  close(stOdds([{ copies: 4 }, { copies: 4 }]).reduce((a, b) => a + b), 1);
  assert.equal(stPct(0.333), '33%'); assert.equal(stPct(0.05), '5.0%');
  assert.match(stOddsLine([{ copies: 4 }, { copies: 4 }, { copies: 4 }]), /12 editions/);
  assert.match(stOddsLine([{ copies: 1 }, { copies: 4 }, { copies: 16 }]), /21 editions/);   // finite design count
  assert.equal(stOddsLine([]), '');
});

test('names are measured in full-width characters and cut to fit, so a label stays on one line', () => {
  const { stEm, stClip } = helpers();
  assert.equal(stEm('ひるさがり'), 5); assert.equal(stEm('Sunny'), 2.75);
  assert.equal(stClip('ひるさがりのちいさなステッカーたち', 14), 'ひるさがりのちいさなステッカ'.slice(0, 14));
  assert.equal(stClip('Sunny Pack', 14), 'Sunny Pack');
  assert.ok(stEm(stClip('A'.repeat(60), 14)) <= 14);
});

test('Studio sends exactly what the Rust commands accept', () => {
  const src = read('src/app/js/studio.js'), rs = read('src-tauri/crates/core/src/creator_pack.rs'), edition = read('src-tauri/crates/core/src/edition_pack.rs');
  assert.match(src, /stickerId: x\.id, name: titleOf\(stEntry\(x\.id\)\), copies: x\.copies/);   // Selection { sticker_id, name, copies }
  assert.match(edition, /pub struct Selection \{pub sticker_id:String,pub name:String,pub copies:u32\}/);
  assert.match(src,/prizes:p.prizes/);
  assert.match(src, /dress: \{ color:packColor\(p\.bag,p\.color\)\?\.id \|\| null, cover: p\.cover \|\| null, deco: lay\.accents\[0\]\?\.kind \|\| null, blurb: p\.blurb\.trim\(\) \|\| null, layout: lay \}/);   // Dress { cover, deco, blurb, layout }
  assert.match(rs, /pub struct Layout \{pub comp:String,#\[serde\(default\)\] pub label:Option<\[f64;2\]>,#\[serde\(default\)\] pub cover:Option<\[f64;2\]>,#\[serde\(default\)\] pub accents:Vec<Accent>\}/);
  assert.match(src, /return \{ comp: r\.comp, label: null, cover: p\.cover \? r\.cover : null, accents: r\.accents \};/);   // Layout { comp, label, cover, accents:[{kind,x,y}] }
  assert.match(src, /dress: \{ bag: g\.bag, deco: g\.deco === "none" \? null : g\.deco \}/);
  const perms = read('src-tauri/permissions/desktop-effects.toml');
  for (const cmd of ['creator_pack_save', 'creator_pack_shelve', 'gift_send', 'pack_peek', 'pack_peek_picture']) assert.match(perms, new RegExp(`"${cmd}"`));
});
