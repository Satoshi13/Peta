/* Market: packs, materials and creators. Everything is a sample; "Get" adds it to your own shelf. */
const MARKET_PACKS = [
  { id: "tokyo", title: "Tokyo Pack", by: "Peta", count: 8, price: "Free", hue: 200, blurb: "A walk through the city in eight small things.", keys: ["sCamera", "sCoffee", "sPolaroid", "sCassette", "sComputer", "sBubble", "sGoodDay", "sEgg"] },
  { id: "coffee", title: "Coffee Club", by: "Nao", count: 6, price: "Free", hue: 28, blurb: "Slow mornings, one cup at a time.", keys: ["sCoffee", "sEgg", "sGoodDay", "sCamera", "sPlant", "sCat"] },
  { id: "pixel", title: "Pixel Dream", by: "Ryo", count: 6, price: "¥480", hue: 120, blurb: "Late-night screens and soft glow.", keys: ["sComputer", "sCassette", "sBubble", "sScribble", "sCamera", "sGoodDay"] },
  { id: "cats", title: "Cats", by: "Yuki", count: 5, price: "¥300", hue: 300, blurb: "Mostly asleep. Occasionally on a skateboard.", keys: ["sCat", "sScribble", "sCoffee", "sPlant", "sBubble"] },
  { id: "plants", title: "Houseplants", by: "Mika", count: 5, price: "Free", hue: 85, blurb: "Leaves for the corner of your screen.", keys: ["sPlant", "sBlueFlower", "sEgg", "sPolaroid", "sCoffee"] },
  { id: "night", title: "Night Market", by: "Ren", count: 6, price: "¥380", hue: 245, blurb: "Paper lanterns and street snacks.", keys: ["sEgg", "sCassette", "sGoodDay", "sPolaroid", "sCamera", "sBubble"] },
];
const MARKET_CREATORS = [
  { name: "Nao", src: "sCoffee", packs: 3, line: "Cafés, cups and quiet mornings" }, { name: "Ryo", src: "sComputer", packs: 5, line: "Pixels, cables, small screens" },
  { name: "Yuki", src: "sCat", packs: 4, line: "Cats, mostly" }, { name: "Mika", src: "sPlant", packs: 2, line: "Plants and windowsills" }, { name: "Ren", src: "sCassette", packs: 6, line: "Night walks, tape hiss" },
];
const MK = { tab: "packs", sel: null };

const Market = {
  pouch(hue, sheen = true) { return h("div.pk-stack.mk-pouch", { style: { "--hue": hue + "deg" } }, h("i.pk-img" + (hue ? ".tinted" : ""), { style: { "--k": 0, "--hue": hue + "deg" } }, sheen ? h("i.sheen") : null)); },
  own(id) { return !!S.owned[id]; },
  get(pack) {
    if (this.own(pack.id)) return;
    S.owned[pack.id] = true; S.packs.push({ id: pack.id, title: pack.title, by: pack.by, total: pack.count, left: [...pack.keys], hue: pack.hue });
    Snd.chime(3, 784); Shell.toast(`${pack.title} is on your Packs shelf.`); Shell.renderNav();
  },
};

Pages.market = {
  build() {
    const root = h("div.page-in.marketpage");
    const paint = () => {
      const sel = MK.tab === "packs" ? MARKET_PACKS.find((p) => p.id === MK.sel) : null;
      root.replaceChildren(
        PageHead("Market", "Packs, materials and creators"),
        h("div.seg.mk-seg", ["packs", "materials", "creators"].map((t) => h("button", { "aria-pressed": String(MK.tab === t), on: { click: () => { MK.tab = t; MK.sel = null; Snd.tap(); paint(); } } }, t[0].toUpperCase() + t.slice(1)))),
        MK.tab === "packs" ? this.packs(paint, sel) : MK.tab === "materials" ? this.materials(paint) : this.creators(paint));
    };
    paint(); return root;
  },
  packs(paint, sel) {
    const feat = MARKET_PACKS[0];
    const cell = (p, i) => h("button.mk-tile", { "aria-pressed": String(MK.sel === p.id), style: { "--i": i }, on: { click: () => { MK.sel = MK.sel === p.id ? null : p.id; Snd.tap(); paint(); } } },
      Market.pouch(p.hue), h("span.pack-tag", h("b.hand", p.title), h("small", `by ${p.by} · ${p.count} stickers`)), h("span.price" + (Market.own(p.id) ? ".own" : ""), Market.own(p.id) ? "On your shelf" : p.price));
    const main = h("div.mk-main",
      h("section.mk-hero", h("div.mk-hero-art", Market.pouch(feat.hue), h("div.fan", feat.keys.slice(0, 4).map((k, i) => { const e = h("div.fan-s", { style: { "--i": i } }); Stk.make(A[k], { border: 12, material: "matte", max: 300 }).then((r) => e.append(Stk.el(r, r.aspect >= 1 ? 92 : 92 * r.aspect))); return e; }))),
        h("div.mk-hero-text", h("p.eyebrow", "Featured"), h("h2", feat.title), h("p.muted", `by ${feat.by} · ${feat.count} stickers`), h("p", feat.blurb),
          h("button.btn", { on: { click: () => { Market.get(feat); paint(); } } }, Market.own(feat.id) ? "On your shelf" : "Get — Free"))),
      h("p.eyebrow.mk-h", "New and popular"), h("div.mk-grid", MARKET_PACKS.slice(1).map(cell)));
    return h("div.mk" + (sel ? ".has-detail" : ""), main, sel ? this.detail(sel, paint) : null);
  },
  detail(p, paint) {
    const own = Market.own(p.id);
    return h("aside.detail.mk-detail", h("button.x", { "aria-label": "Close", on: { click: () => { MK.sel = null; paint(); } } }, "✕"),
      h("div.mk-d-art", Market.pouch(p.hue)), h("h3", p.title), h("p.muted", `by ${p.by} · ${p.count} stickers`), h("p", p.blurb),
      h("p.eyebrow", { style: { marginTop: "10px" } }, "A peek inside"),
      h("div.peek", p.keys.slice(0, p.count).map((k, i) => { const c = h("div.peek-s" + (i < 3 ? "" : ".sealed")); if (i < 3) Stk.make(A[k], { border: 10, material: "matte", max: 240 }).then((r) => c.append(Stk.el(r, r.aspect >= 1 ? 62 : 62 * r.aspect))); else c.append(h("b", "?")); return c; })),
      h("button.btn", { disabled: own, style: { width: "100%", marginTop: "12px" }, on: { click: () => { Market.get(p); paint(); } } }, own ? "On your shelf" : p.price === "Free" ? "Get — Free" : `Get — ${p.price}`),
      h("p.muted.small", { style: { marginTop: "8px" } }, "Packs open one a day. What's inside stays a surprise until you tear it."));
  },
  materials(paint) {
    const items = ["gold", "riso", "vintage"].map((id) => MAT[id]);
    return h("div.mk-mats", h("p.muted.lede", "A material is a way of making stickers. Each sheet is used up when you make a sticker with it. Buying adds three sheets."),
      h("div.mgrid", items.map((m, i) => h("div.mbook.mk-mat", { style: { "--i": i } },
        h("div.mc", MatCard({ ...m, id: m.id }, 176)), h("div.mmeta", h("b", m.name), h("span.seal", { data: { rarity: m.rarity } }, m.rarity), h("small.recipe", m.recipe),
          h("small", m.locked ? "Not in your book yet" : `${S.stock[m.id] || 0} sheets in stock`),
          h("button.btn.small", { on: { click: () => { if (m.locked) { m.locked = false; m.found = fmtDate(S.today); } S.stock[m.id] = (S.stock[m.id] || 0) + 3; Snd.chime(3, 880); Shell.toast(`${m.name} ×3 added to your Material Book.`); paint(); } } }, m.price === "Free" ? "Get 3 — Free" : `Get 3 — ${m.price}`))))));
  },
  creators(paint) {
    return h("div.mk-creators", MARKET_CREATORS.map((c, i) => {
      const t = h("div.cr-av"); Stk.make(A[c.src], { border: 10, material: "matte", max: 240 }).then((r) => t.append(Stk.el(r, r.aspect >= 1 ? 70 : 70 * r.aspect)));
      const on = !!S.followed[c.name];
      return h("div.cr-card", { style: { "--i": i } }, t, h("div.cr-t", h("b", c.name), h("small", c.line), h("small", `${c.packs} packs`)),
        h("button.btn.small" + (on ? ".paper" : ""), { on: { click: () => { S.followed[c.name] = !on; Snd.tap(); paint(); } } }, on ? "Following" : "Follow"));
    }));
  },
};
