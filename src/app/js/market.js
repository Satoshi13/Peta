/* Local catalog packs and Scraps exchanges; creator accounts remain previews. */
const MARKET_PACKS = [
  { id: "tokyo", title: "Tokyo Pack", by: "Peta", count: 8, price: "Free", hue: 200, kind: "holo", blurb: "A walk through the city in eight small things.", keys: ["sCamera", "sCoffee", "sPolaroid", "sCassette", "sComputer", "sBubble", "sGoodDay", "sEgg"] },
  { id: "coffee", title: "Coffee Club", by: "Nao", count: 6, price: "Free", hue: 0, kind: "kraft", blurb: "Slow mornings, one cup at a time.", keys: ["sCoffee", "sEgg", "sGoodDay", "sCamera", "sPlant", "sCat"] },
  { id: "pixel", title: "Pixel Dream", by: "Ryo", count: 6, price: "Scraps", hue: 120, kind: "holo", blurb: "Late-night screens and soft glow.", keys: ["sComputer", "sCassette", "sBubble", "sScribble", "sCamera", "sGoodDay"] },
  { id: "cats", title: "Cats", by: "Yuki", count: 5, price: "Scraps", hue: 0, kind: "matte", blurb: "Mostly asleep. Occasionally on a skateboard.", keys: ["sCat", "sScribble", "sCoffee", "sPlant", "sBubble"] },
  { id: "plants", title: "Houseplants", by: "Mika", count: 5, price: "Free", hue: 0, kind: "kraft", blurb: "Leaves for the corner of your screen.", keys: ["sPlant", "sBlueFlower", "sEgg", "sPolaroid", "sCoffee"] },
  { id: "night", title: "Night Market", by: "Ren", count: 6, price: "Scraps", hue: 245, kind: "holo", blurb: "Paper lanterns and street snacks.", keys: ["sEgg", "sCassette", "sGoodDay", "sPolaroid", "sCamera", "sBubble"] },
];
const MARKET_CREATORS = [
  { name: "Nao", src: "sCoffee", packs: 3, line: "Cafés, cups and quiet mornings" }, { name: "Ryo", src: "sComputer", packs: 5, line: "Pixels, cables, small screens" },
  { name: "Yuki", src: "sCat", packs: 4, line: "Cats, mostly" }, { name: "Mika", src: "sPlant", packs: 2, line: "Plants and windowsills" }, { name: "Ren", src: "sCassette", packs: 6, line: "Night walks, tape hiss" },
];
const MK = { tab: "packs" };

const Market = {
  pouch(p) { const foil = (p.kind || "holo") === "holo"; return h("div.pk-stack.mk-pouch", h("i.pk-img" + (foil && p.hue ? ".tinted" : ""), { style: { "--k": 0, "--hue": p.hue + "deg", "--pk": packVar(p.kind) } }, foil ? h("i.sheen") : null), PackLabel(p)); },
  own(id) { return !!S.owned[id]; },
  /* Sealed stickers still in the bag, and whether another set would overflow it. */
  sealed(id) { return S.packs.find((p) => p.id === id)?.left.length || 0; },
  full(pack) { const rate = Scraps.pack(pack.id); return !!rate && this.sealed(pack.id) + rate.stickers > PACK_SEALED_CAP; },
  price(pack) { const rate = Scraps.pack(pack.id); return pack.price === "Free" && !this.own(pack.id) ? "Free" : rate ? `${rate.exchange} Scraps` : "Coming later"; },
  exchange(pack) {
    const rate = Scraps.pack(pack.id), own = this.own(pack.id);
    return Scraps.button("pack", pack.id, !rate ? "Coming later" : this.full(pack) ? "The bag is full" : `${own ? "Add another set" : "Exchange"} — ${rate.exchange} Scraps`, !rate || this.full(pack) || !S.developer && S.scraps.balance < rate.exchange);
  },
  /* Free packs are taken straight away; anything else (including a second set of a pack you already have) goes through the exchange. */
  async get(pack) {
    if (this.own(pack.id) || pack.price !== "Free") { this.exchange(pack).click(); return; }
    try { await Bridge.invoke("pack_install_demo", {packId:pack.id}); await Bridge.reload(); Snd.chime(3,784); Shell.toast(`${pack.title} is on your Packs shelf.`); Shell.refresh(); }
    catch(e) { Shell.toast(String(e)); }
  },
  /* What one set costs: nothing in the developer edition. */
  unit(pack) { const rate = Scraps.pack(pack.id); return !rate || S.developer ? 0 : rate.exchange; },
  /* How many sets can be bought right now, and what stops more. */
  limit(pack) {
    const rate = Scraps.pack(pack.id); if (!rate) return { max: 0, stop: "Not available yet." };
    const room = Math.floor((PACK_SEALED_CAP - this.sealed(pack.id)) / rate.stickers), unit = this.unit(pack), afford = unit ? Math.floor(S.scraps.balance / unit) : Infinity;
    const max = Math.max(0, Math.min(room, afford, 1000));
    const stop = room < 1 ? "This bag is full. Open a few stickers to make room." : afford < 1 ? `You need ${(unit - S.scraps.balance).toLocaleString("en-US")} more Scraps.` : max === room && room <= afford ? "That fills the bag." : max === afford ? "That is all your Scraps will buy." : "";
    return { max, stop, rate };
  },
  /* Choose how many sets and buy them in one go, inside the card. Nothing is redrawn that holds focus; the numbers change in place. */
  buyBox(pack, onBought) {
    let qty = 1, busy = false, request = null;
    const n = (v) => v.toLocaleString("en-US");
    const out = h("output.mkz-n", { "aria-live": "polite" }), minus = h("button.mkz-ctl", { type: "button", "aria-label": "One set fewer" }, "−"), plus = h("button.mkz-ctl", { type: "button", "aria-label": "One set more" }, "+");
    const adds = h("b"), costs = h("b"), after = h("b"), afterRow = h("div", h("span", "Scraps after"), after), perSet = h("b"), have = h("small.muted"), stop = h("small.mkz-stop", { role: "status" }), note = h("small.muted");
    const buy = h("button.btn.mkz-primary", { type: "button" });
    const update = () => {
      const { max, stop: why, rate } = this.limit(pack), own = this.own(pack.id), unit = this.unit(pack);
      qty = Math.min(Math.max(1, qty), Math.max(1, max));
      const total = unit * qty;
      out.textContent = String(qty); minus.disabled = busy || qty <= 1; plus.disabled = busy || qty >= max;
      adds.textContent = rate ? `${n(qty * rate.stickers)} sealed stickers` : "—";
      costs.textContent = S.developer ? "No Scraps (developer)" : `${n(total)} Scraps`;
      afterRow.hidden = S.developer; after.textContent = max < 1 ? "—" : n(S.scraps.balance - total);
      perSet.textContent = S.developer ? "Free (developer)" : rate ? `${n(rate.exchange)} Scraps` : "Coming later";
      have.textContent = S.developer ? "" : `You have ${n(S.scraps.balance)} Scraps`; have.hidden = S.developer;
      buy.disabled = busy || max < 1; buy.textContent = max < 1 ? (rate ? "Can't buy right now" : "Coming later") : `Buy ${qty} ${qty === 1 ? "set" : "sets"}`;
      if (!stop.dataset.error) stop.textContent = max < 1 || qty >= max ? why : ""; stop.hidden = !stop.textContent;
      note.textContent = own ? "Sets go into the same bag. Stickers you have already opened stay in your Collection." : "Adds this pack to your Packs shelf. What's inside stays a surprise until you tear it.";
    };
    const step = (d) => () => { qty += d; request = null; delete stop.dataset.error; Snd.tap(); update(); };
    minus.addEventListener("click", step(-1)); plus.addEventListener("click", step(1));
    buy.addEventListener("click", async () => {
      if (busy || Scraps.inFlight) return;
      const trade = { kind: "pack", itemId: pack.id, quantity: qty };
      if (!request || JSON.stringify(request.trade) !== JSON.stringify(trade)) request = { trade, requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("") };
      const was = this.own(pack.id);
      busy = true; Scraps.inFlight = true; Bridge.busy = true; delete stop.dataset.error; update();
      try {
        await Bridge.invoke("scrap_trade", request); await Bridge.reload();
        Snd.chime(2, 740); Shell.toast(`${qty} ${qty === 1 ? "set" : "sets"} of ${pack.title} ${qty === 1 ? "is" : "are"} ${was ? "in the bag" : "on your shelf"}.`);
        request = null; qty = 1; PackZoom.stale(); onBought();
      } catch (e) { stop.dataset.error = "1"; stop.textContent = String(e); }
      finally { busy = false; Scraps.inFlight = false; Bridge.busy = false; update(); }
    });
    const el = h("div.mkz-qty",
      h("div.mkz-price", h("span", "Per set"), perSet), have,
      h("div.mkz-stepper", { role: "group", "aria-label": "Number of sets" }, h("span", "Sets"), h("div.mkz-ctls", minus, out, plus)),
      h("dl.mkz-sum", h("div", h("span", "Adds"), adds), h("div", h("span", "Costs"), costs), afterRow),
      stop, buy, note);
    update(); return { el, update };
  },
  /* The zoomed card: details first, then what it costs. */
  card(pack) {
    const paid = pack.price !== "Free" || this.own(pack.id);
    const peek = h("div.peek", pack.keys.slice(0, pack.count).map((k, i) => { const c = h("div.peek-s" + (i < 3 ? "" : ".sealed")); if (i < 3) Stk.make(A[k], { border: 10, material: "matte", max: 240 }).then((r) => c.append(Stk.el(r, r.aspect >= 1 ? 62 : 62 * r.aspect))); else c.append(h("b", "?")); return c; }));
    const own = h("p.mkz-own"), paintOwn = () => { const have = this.own(pack.id); own.hidden = !have; own.replaceChildren(h("b", "On your shelf"), ` · ${this.sealed(pack.id)} sealed`); };
    paintOwn();
    const buy = paid ? this.buyBox(pack, paintOwn) : null;
    const free = paid ? null : h("button.btn.mkz-act", { on: { click: () => Market.get(pack) } }, "Get — Free");
    return h("aside.mkz-card", CloseButton("Back to the shelf", {}, ".mkz-x"),
      h("p.eyebrow", `by ${pack.by} · ${pack.count} stickers`), h("h2", pack.title), h("p.mkz-blurb", pack.blurb),
      own, h("p.eyebrow.mkz-peek", "A peek inside"), peek,
      h("div.mkz-buy", buy ? buy.el : [h("div.mkz-price", h("span", "Price"), h("b", "Free")), free,
        h("small.muted", "Open it any time, as often as you like. What's inside stays a surprise until you tear it.")],
        h("button.mkz-back.link", { type: "button" }, "Back to the shelf")));
  },
};

Pages.market = {
  build() {
    const root = h("div.page-in.marketpage");
    const paint = () => {
      root.replaceChildren(
        PageHead("Market", "Packs, materials and creators", Scraps.badge()),
        h("div.seg.mk-seg", ["packs", "materials", "creators"].map((t) => SegButton(t[0].toUpperCase() + t.slice(1), { "aria-pressed": String(MK.tab === t), on: { click: () => { MK.tab = t; Snd.tap(); paint(); } } }))),
        MK.tab === "packs" ? this.packs(paint) : MK.tab === "materials" ? this.materials(paint) : this.creators(paint));
      const form = Scraps.form(); if(form) root.insertBefore(form, root.children[2]);
    };
    paint(); return root;
  },
  packs(paint) {
    const feat = MARKET_PACKS[0];
    const open = (p, tile) => { Snd.tap(); PackZoom.open(p, tile, (pack) => Market.card(pack)); };
    const cell = (p, i) => {
      const own = Market.own(p.id);
      return h("div.mk-item", h("button.mk-tile", { "aria-label": `${p.title} by ${p.by}${own ? ", on your shelf" : ""} — look closer`, "aria-haspopup": "dialog", data: { pack: p.id }, style: { "--i": i }, on: { click: (e) => open(p, e.currentTarget) } },
        Market.pouch(p), own ? h("span.pk-badge.own", "On shelf") : p.price === "Free" ? h("span.pk-badge.free", "Free") : null));
    };
    const main = h("div.mk-main",
      h("section.mk-hero", h("div.mk-hero-art", Market.pouch(feat), h("div.fan", feat.keys.slice(0, 3).map((k, i) => { const e = h("div.fan-s", { style: { "--i": i } }); Stk.make(A[k], { border: 12, material: "matte", max: 300 }).then((r) => { const width = r.aspect >= 1 ? 84 : 84 * r.aspect; e.style.setProperty("--fan-width", width+"px"); e.append(Stk.el(r, width)); }); return e; }))),
        h("div.mk-hero-text", h("p.eyebrow", "Featured"), h("h2", feat.title), h("p.muted", `by ${feat.by} · ${feat.count} stickers`), h("p", feat.blurb),
          h("div.mk-hero-actions", h("button.btn", { on: { click: (e) => Market.own(feat.id) ? open(feat, e.currentTarget.closest(".mk-hero").querySelector(".mk-hero-art")) : Market.get(feat) } }, Market.own(feat.id) ? "Add another set…" : "Get — Free")))),
      h("p.eyebrow.mk-h", "New and popular"), h("div.mk-grid", MARKET_PACKS.slice(1).map(cell)));
    return h("div.mk", main);
  },
  materials(paint) {
    // TODO(owner): cash purchases remain unavailable. Sakura awaits its seasonal distribution.
    const items = Object.values(MAT);
    return h("div.mk-mats", h("p.muted.lede", "Exchange Scraps for sheets. Save unused sheets as Scraps in your Materials."),
      h("button.btn.paper.small.scrap-action", {on:{click:()=>Shell.go("materials")}}, "Dismantle materials…"),
      h("div.mgrid", items.map((m, i) => h("div.mbook.mk-mat", { style: { "--i": i } },
        h("div.mc", MatCard({ ...m, id: m.id }, 176)), h("div.mmeta", h("b", m.name), h("span.seal", { data: { rarity: m.rarity } }, m.rarity), h("small.recipe", m.recipe),
          h("small", m.locked ? "Not in your book yet" : `${S.stock[m.id] || 0} sheets in stock`),
          Scraps.material(m.id)?.exchange != null ? Scraps.button("material", m.id, `Exchange — ${Scraps.material(m.id).exchange} Scraps`, !S.developer && S.scraps.balance < Scraps.material(m.id).exchange)
            : h("button.btn.paper.small.scrap-action", {disabled:true}, m.id === "sakura" ? "Spring edition" : "Coming later"))))));
  },
  creators(paint) {
    return h("div.mk-creators",
      h("div.cr-card.cr-self", CreatorIcon.image(),h("div.cr-t",h("b",S.name),h("small","Your creator profile")),
        h("button.btn.paper.small.creator-icon-change",{on:{click:e=>CreatorIcon.choose(e.currentTarget)}},"Change icon…")),
      MARKET_CREATORS.map((c, i) => {
      const t = h("div.cr-av"); Stk.make(A[c.src], { border: 10, material: "matte", max: 240 }).then((r) => t.append(Stk.el(r, r.aspect >= 1 ? 70 : 70 * r.aspect)));
      const on = !!S.followed[c.name];
      return h("div.cr-card", { style: { "--i": i } }, t, h("div.cr-t", h("b", c.name), h("small", c.line), h("small", `${c.packs} packs`)),
        h("button.btn.small" + (on ? ".paper" : ""), { on: { click: () => { /* TODO(owner): creator accounts are not available yet. */ Shell.toast("Creator profiles are coming later."); } } }, on ? "Following" : "Follow"));
    }));
  },
};
