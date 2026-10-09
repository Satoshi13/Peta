/* BagPic: a wrapped pack or gift, drawn the same way everywhere (the Studio bench, the shelf, the Market card, the gift inbox).
   It is only a picture of a wrapping (js/catalog.js BAGS) with what is written and stuck on it: nothing here is positioned freely, every place is
   read from the wrapping. Small natural differences (the tilt of the label, of a clip) come from the pack's own name, so a pack always looks the same. */
const bagHash = (str) => { let x = 2166136261; for (const c of str) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
const bagRnd = (seed, i) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
const bagEm = (text) => [...text].reduce((s, c) => s + (c.charCodeAt(0) > 255 ? 1 : .55), 0);   // full-width characters count 1, the rest about half


/**
 * @param bag    a BAGS id
 * @param title  written on the label (one line; a long name shrinks)
 * @param sub    the small line under it ("by Satoshi")
 * @param cover  the url of a sticker picture to stick on, or null
 * @param deco   "none" | "clip" | "pin" | "tape"
 * @param k      pixels per centimetre (every wrapping is drawn to scale)
 * @param fit    when set, the object is at most this wide in px
 * @param items  urls of stickers peeking out of it (up to six); left empty on a shelf
 * @param shut   closed: opaque wrappings hide what is inside (glassine and the folded wrap stay see-through)
 */
function BagPic({ bag: id, title = "", sub = "", cover = null, deco = "none", k = 15, fit = 0, items = [], shut = false, id: key = "" } = {}) {
  const bag = BAGS[id] || BAGS.kraft, [x0, y0, x1, y1] = bag.body, bw = x1 - x0, bh = y1 - y0, seed = bagHash(title + bag.id + key), jit = (i, amp) => (bagRnd(seed, i) - .5) * amp;
  let boxW = bag.cm * k / (bw / 100); if (fit) boxW = Math.min(boxW, fit / (bw / 100));
  const el = h("div.bagpic", { data: { kind: bag.gen ? "gen" : bag.id, bag: bag.id, gloss: bag.gen && bag.gloss ? "1" : "0", nolabel: bag.gen && !bag.hasLabel ? "1" : "0" },
    style: { "--w": boxW + "px", "--art": `var(--a-${bag.art})`, "--gloss": bag.gloss ?? 0, aspectRatio: `${bag.W} / ${bag.H}` } });
  if (bag.lean) el.style.rotate = bag.lean + "deg";
  const [l, t, r, b] = bag.lbl;
  el.style.setProperty("--ll", l + "%"); el.style.setProperty("--lt", t + "%"); el.style.setProperty("--lr", 100 - r + "%"); el.style.setProperty("--lb", 100 - b + "%"); el.style.setProperty("--lrot", (bag.rot || 0) + jit(1, 3) + "deg");
  const art = h("div.bp-art"); if (shut && bag.seal === "slide") art.style.opacity = 0;
  const showItems = items.length && (!shut || bag.see);
  if (showItems) {
    const f = h("div.bp-fan"), pk = bag.peek; let sz = 36, spread = 150, cut = false;
    if (bag.gen && pk) {
      Object.assign(f.style, { left: pk.box[0] + "%", right: "auto", width: pk.box[2] + "%", top: pk.box[1] + "%", height: pk.box[3] + "%", zIndex: pk.front ? 4 : 1 });
      if (pk.alpha) f.style.opacity = pk.alpha; if (pk.cut) f.style.clipPath = "inset(-200% -40% 0 -40%)";
      sz = pk.sz || 36; spread = pk.spread || 150; cut = !!pk.cut;
    } else if (bag.gen) { const fw = bw * .74, fh = bh * .34; Object.assign(f.style, { left: (x0 + bw / 2 - fw / 2) + "%", right: "auto", width: fw + "%", top: (y0 + 13 - fh) + "%", height: fh + "%" }); }
    items.slice(0, 6).forEach((src, i, all) => { const n = all.length, sp = n === 1 ? 0 : (i / (n - 1) - .5); f.append(h("img", { src, alt: "", style: { transform: `translateX(-50%) translateX(${sp * spread}%) rotate(${sp * 40}deg) translateY(${-6 - (1 - Math.abs(sp) * 2) * 12}%)`, zIndex: i, width: (n === 1 ? sz * 1.4 : sz) + "%", bottom: cut ? (pk.sink ?? -40) + "%" : "" } })); });
    el.append(f);
  }
  el.append(art);
  if (shut && bag.seal === "slide") el.append(h("div.bp-drbox"), h("div.bp-drsleeve"));
  if (deco === "tape") { const tp = h("i.bp-tape"); const [tx, ty, tw, th, tr] = bag.tape; Object.assign(tp.style, { left: tx + "%", top: ty + "%", width: tw + "%", height: th + "%", rotate: tr + jit(3, 3) + "deg" }); el.append(tp); }
  else if (shut && bag.seal === "tape") { const tp = h("i.bp-tape.cream"); const [tx, ty, tw, th, tr] = bag.tape; Object.assign(tp.style, { left: tx + "%", top: ty + "%", width: tw + "%", height: th + "%", rotate: tr + "deg" }); el.append(tp); }
  const fitName = Math.min(1, 100 * .9 / (bagEm(title) * 13)), name = h("b", {}, title);
  name.style.fontSize = 13 * 1.1 * fitName * (bag.gen ? .88 : 1) + "cqw";
  const lbl = h("div.bp-lbl", {}, h("i.bp-cover"), name, sub ? h("small", {}, sub) : null);
  lbl.style.translate = `${jit(2, 1.6)}% ${jit(5, 1.6)}%`; el.append(lbl);
  if (cover) el.append(bagThing(cover, "sticker", bag.cover[0], bag.cover[1], bag.cover[2], bag.cover[3] + jit(4, 6)));
  if (deco === "clip") el.append(bagThing(A.paperClip, "clip", bag.clip[0], bag.clip[1], bag.clip[2], bag.clip[3] + jit(6, 8)));
  if (deco === "pin") el.append(bagThing(A.pinRed, "pin", bag.pin[0] + jit(7, 1), bag.pin[1], bag.pin[2], 0));
  return el;
}
const bagThing = (src, kind, x, y, size, rot) => h("div.bp-deco" + (kind === "sticker" ? ".sticker" : ""), { data: { k: kind }, style: { left: x + "%", top: y + "%", width: size + "%", "--r": rot + "deg" } }, h("img", { src, alt: "" }));
