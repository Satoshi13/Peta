/* Local free packs and Scraps exchanges; paid packs and creators remain previews. */
const MARKET_PACKS = [
  { id: "tokyo", title: "Tokyo Pack", by: "Peta", count: 8, price: "Free", hue: 200, kind: "holo", blurb: "A walk through the city in eight small things.", keys: ["sCamera", "sCoffee", "sPolaroid", "sCassette", "sComputer", "sBubble", "sGoodDay", "sEgg"] },
  { id: "coffee", title: "Coffee Club", by: "Nao", count: 6, price: "Free", hue: 0, kind: "kraft", blurb: "Slow mornings, one cup at a time.", keys: ["sCoffee", "sEgg", "sGoodDay", "sCamera", "sPlant", "sCat"] },
  { id: "pixel", title: "Pixel Dream", by: "Ryo", count: 6, price: "¥480", hue: 120, kind: "holo", blurb: "Late-night screens and soft glow.", keys: ["sComputer", "sCassette", "sBubble", "sScribble", "sCamera", "sGoodDay"] },
  { id: "cats", title: "Cats", by: "Yuki", count: 5, price: "¥300", hue: 0, kind: "matte", blurb: "Mostly asleep. Occasionally on a skateboard.", keys: ["sCat", "sScribble", "sCoffee", "sPlant", "sBubble"] },
  { id: "plants", title: "Houseplants", by: "Mika", count: 5, price: "Free", hue: 0, kind: "kraft", blurb: "Leaves for the corner of your screen.", keys: ["sPlant", "sBlueFlower", "sEgg", "sPolaroid", "sCoffee"] },
  { id: "night", title: "Night Market", by: "Ren", count: 6, price: "¥380", hue: 245, kind: "holo", blurb: "Paper lanterns and street snacks.", keys: ["sEgg", "sCassette", "sGoodDay", "sPolaroid", "sCamera", "sBubble"] },
];
const MARKET_CREATORS = [
  { name: "Nao", src: "sCoffee", packs: 3, line: "Cafés, cups and quiet mornings" }, { name: "Ryo", src: "sComputer", packs: 5, line: "Pixels, cables, small screens" },
  { name: "Yuki", src: "sCat", packs: 4, line: "Cats, mostly" }, { name: "Mika", src: "sPlant", packs: 2, line: "Plants and windowsills" }, { name: "Ren", src: "sCassette", packs: 6, line: "Night walks, tape hiss" },
];
const MK = { tab: "packs", sel: null };

const Market = {
  pouch(p) { const foil = (p.kind || "holo") === "holo"; return h("div.pk-stack.mk-pouch", h("i.pk-img" + (foil && p.hue ? ".tinted" : ""), { style: { "--k": 0, "--hue": p.hue + "deg", "--pk": packVar(p.kind) } }, foil ? h("i.sheen") : null)); },
  own(id) { return !!S.owned[id]; },
  refill(pack) {
    const rate = Scraps.pack(pack.id);
    if(!rate || !S.packs.some(p=>p.id===pack.id && !p.left.length)) return null;
    return Scraps.button("pack", pack.id, `Refill — ${rate.exchange} Scraps`, S.scraps.balance < rate.exchange);
  },
  async get(pack) {
    if (this.own(pack.id)) {
      Snd.tap(); await Shell.go("packs");
      const bag = Array.from(Shell.current.querySelectorAll(".pack")).find(p => p.dataset.pack === pack.id);
      bag?.scrollIntoView({block:"nearest",behavior:reduced() ? "instant" : "smooth"});
      if (bag && !bag.disabled) bag.focus({preventScroll:true});
      return;
    }
    // TODO(owner): paid packs need a purchase backend; do not simulate a payment.
    if (pack.price !== "Free") { Shell.toast("Purchases are not available yet."); return; }
    try { await Bridge.invoke("pack_install_demo", {packId:pack.id}); await Bridge.reload(); Snd.chime(3,784); Shell.toast(`${pack.title} is on your Packs shelf.`); Shell.refresh(); }
    catch(e) { Shell.toast(String(e)); }
  },
};

Pages.market = {
  build() {
    const root = h("div.page-in.marketpage");
    const paint = () => {
      const sel = MK.tab === "packs" ? MARKET_PACKS.find((p) => p.id === MK.sel) : null;
      root.replaceChildren(
        PageHead("Market", "Packs, materials and creators", Scraps.badge()),
        h("div.seg.mk-seg", ["packs", "materials", "creators"].map((t) => h("button", { "aria-pressed": String(MK.tab === t), on: { click: () => { MK.tab = t; MK.sel = null; Snd.tap(); paint(); } } }, t[0].toUpperCase() + t.slice(1)))),
        MK.tab === "packs" ? this.packs(paint, sel) : MK.tab === "materials" ? this.materials(paint) : this.creators(paint));
      const form = Scraps.form(); if(form) root.insertBefore(form, root.children[2]);
    };
    paint(); return root;
  },
  packs(paint, sel) {
    const feat = MARKET_PACKS[0];
    const cell = (p, i) => {
      const own = Market.own(p.id);
      return h("div.mk-item", h("button.mk-tile", { "aria-pressed": own ? null : String(MK.sel === p.id), "aria-label": own ? `${p.title} — view on your Packs shelf` : null, style: { "--i": i }, on: { click: () => { if (own) { Market.get(p); return; } MK.sel = MK.sel === p.id ? null : p.id; Snd.tap(); paint(); } } },
        Market.pouch(p), h("span.pack-tag", h("b.hand", p.title), h("small", `by ${p.by} · ${p.count} stickers`)), h("span.price" + (own ? ".own" : p.price === "Free" ? ".free" : ""), own ? "On your shelf" : p.price)), Market.refill(p));
    };
    const main = h("div.mk-main",
      h("section.mk-hero", h("div.mk-hero-art", Market.pouch(feat), h("div.fan", feat.keys.slice(0, 3).map((k, i) => { const e = h("div.fan-s", { style: { "--i": i } }); Stk.make(A[k], { border: 12, material: "matte", max: 300 }).then((r) => { const width = r.aspect >= 1 ? 84 : 84 * r.aspect; e.style.setProperty("--fan-width", width+"px"); e.append(Stk.el(r, width)); }); return e; }))),
        h("div.mk-hero-text", h("p.eyebrow", "Featured"), h("h2", feat.title), h("p.muted", `by ${feat.by} · ${feat.count} stickers`), h("p", feat.blurb),
          h("div.mk-hero-actions", h("button.btn", { on: { click: () => Market.get(feat) } }, Market.own(feat.id) ? "On your shelf" : "Get — Free"), Market.refill(feat)))),
      h("p.eyebrow.mk-h", "New and popular"), h("div.mk-grid", MARKET_PACKS.slice(1).map(cell)));
    return h("div.mk" + (sel ? ".has-detail" : ""), main, sel ? this.detail(sel, paint) : null);
  },
  detail(p, paint) {
    const own = Market.own(p.id);
    return h("aside.detail.mk-detail", h("button.x", { "aria-label": "Close", on: { click: () => { MK.sel = null; paint(); } } }, "✕"),
      h("div.mk-d-art", Market.pouch(p)), h("h3", p.title), h("p.muted", `by ${p.by} · ${p.count} stickers`), h("p", p.blurb),
      h("p.eyebrow", { style: { marginTop: "10px" } }, "A peek inside"),
      h("div.peek", p.keys.slice(0, p.count).map((k, i) => { const c = h("div.peek-s" + (i < 3 ? "" : ".sealed")); if (i < 3) Stk.make(A[k], { border: 10, material: "matte", max: 240 }).then((r) => c.append(Stk.el(r, r.aspect >= 1 ? 62 : 62 * r.aspect))); else c.append(h("b", "?")); return c; })),
      h("button.btn", { style: { width: "100%", marginTop: "12px" }, on: { click: () => Market.get(p) } }, own ? "On your shelf" : p.price === "Free" ? "Get — Free" : `Get — ${p.price}`),
      Market.refill(p),
      h("p.muted.small", { style: { marginTop: "8px" } }, "Open it any time, as often as you like. What's inside stays a surprise until you tear it."));
  },
  materials(paint) {
    // TODO(owner): cash purchases and future material recipes are still unavailable.
    const items = ["kraft", "holographic", "gold", "riso", "vintage"].map((id) => MAT[id]);
    return h("div.mk-mats", h("p.muted.lede", "Exchange Scraps for sheets. Save unused Kraft or Holographic as Scraps in your Material Book."),
      h("button.btn.paper.small.scrap-action", {on:{click:()=>Shell.go("materials")}}, "Dismantle materials…"),
      h("div.mgrid", items.map((m, i) => h("div.mbook.mk-mat", { style: { "--i": i } },
        h("div.mc", MatCard({ ...m, id: m.id }, 176)), h("div.mmeta", h("b", m.name), h("span.seal", { data: { rarity: m.rarity } }, m.rarity), h("small.recipe", m.recipe),
          h("small", m.locked ? "Not in your book yet" : `${S.stock[m.id] || 0} sheets in stock`),
          Scraps.material(m.id) ? Scraps.button("material", m.id, `Exchange — ${Scraps.material(m.id).exchange} Scraps`, S.scraps.balance < Scraps.material(m.id).exchange)
            : h("button.btn.paper.small.scrap-action", {disabled:true}, "Coming later"))))));
  },
  creators(paint) {
    return h("div.mk-creators", MARKET_CREATORS.map((c, i) => {
      const t = h("div.cr-av"); Stk.make(A[c.src], { border: 10, material: "matte", max: 240 }).then((r) => t.append(Stk.el(r, r.aspect >= 1 ? 70 : 70 * r.aspect)));
      const on = !!S.followed[c.name];
      return h("div.cr-card", { style: { "--i": i } }, t, h("div.cr-t", h("b", c.name), h("small", c.line), h("small", `${c.packs} packs`)),
        h("button.btn.small" + (on ? ".paper" : ""), { on: { click: () => { /* TODO(owner): creator accounts are not available yet. */ Shell.toast("Creator profiles are coming later."); } } }, on ? "Following" : "Follow"));
    }));
  },
};
