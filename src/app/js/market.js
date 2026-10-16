/* Local catalog packs and Scraps exchanges; creator accounts remain previews. */
const MARKET_PACKS = [
  { id: "tokyo", title: "Tokyo Pack", by: "Peta", count: 8, price: "Free", hue: 200, kind: "holo", blurb: "A walk through the city in eight small things.", keys: ["sCamera", "sCoffee", "sPolaroid", "sCassette", "sComputer", "sBubble", "sGoodDay", "sEgg"] },
  { id: "coffee", title: "Coffee Club", by: "Nao", count: 6, price: "Free", hue: 0, kind: "kraft", blurb: "Slow mornings, one cup at a time.", keys: ["sCoffee", "sEgg", "sGoodDay", "sCamera", "sPlant", "sCat"] },
  { id: "pixel", title: "Pixel Dream", by: "Ryo", count: 6, price: "Scraps", hue: 120, kind: "holo", blurb: "Late-night screens and soft glow.", keys: ["sComputer", "sCassette", "sBubble", "sScribble", "sCamera", "sGoodDay"] },
  { id: "cats", title: "Cats", by: "Yuki", count: 5, price: "Scraps", hue: 0, kind: "matte", blurb: "Mostly asleep. Occasionally on a skateboard.", keys: ["sCatSleeping", "sCatSkateboard", "sCatSitting", "sCat", "sBubble"] },
  { id: "plants", title: "Houseplants", by: "Mika", count: 5, price: "Free", hue: 0, kind: "kraft", blurb: "Leaves for the corner of your screen.", keys: ["sPlant", "sBlueFlower", "sEgg", "sPolaroid", "sCoffee"] },
  { id: "night", title: "Night Market", by: "Ren", count: 6, price: "Scraps", hue: 245, kind: "holo", blurb: "Paper lanterns and street snacks.", keys: ["sEgg", "sCassette", "sGoodDay", "sPolaroid", "sCamera", "sBubble"] },
];
const MARKET_CREATORS = [
  { name: "Nao", src: "sCoffee", packs: 3, line: "Cafés, cups and quiet mornings" }, { name: "Ryo", src: "sComputer", packs: 5, line: "Pixels, cables, small screens" },
  { name: "Yuki", src: "sCat", packs: 4, line: "Cats, mostly" }, { name: "Mika", src: "sPlant", packs: 2, line: "Plants and windowsills" }, { name: "Ren", src: "sCassette", packs: 6, line: "Night walks, tape hiss" },
];
const MK = { tab: "packs" };

/* Friends' packs (server builds). A maker seals the card and the pack on their Mac; only approved friends can open them. A pull pays
   Scraps on this Mac and the service records the slot, its edition and the sale together. The native side does all of that; this
   keeps what it last said, so the page can draw without waiting and still say when it is showing an older list. */
const FriendShop = {
  data: null, at: 0, loading: null,
  enabled() { return !!this.data?.enabled; },
  stale() { this.at = 0; },
  fresh() { return !!this.data && Date.now() - this.at < 15000; },
  load() {
    if (this.loading) return this.loading;
    this.loading = Bridge.invoke("market_friend_listings").then((d) => { this.data = d; this.at = Date.now(); return d; }, () => this.data)
      .finally(() => { this.loading = null; });
    return this.loading;
  },
  mine(packId) { return this.data?.mine?.find((l) => l.packId === packId) || null; },
  put(listing) { if (!this.data) return; this.data.mine = [...(this.data.mine || []).filter((l) => l.packId !== listing.packId), listing]; },
  left(l) { return l.state === "paused" ? "Back soon" : l.slotsLeft > 0 ? `${l.slotsLeft} of ${l.slotCount} left` : "Sold out"; },
  /* A pack-shaped view of a listing, for the rail, the zoom and the ceremony. */
  pack(l) {
    const c = l.card || {};
    return { id: "friend-" + l.listingId, listingId: l.listingId, title: c.title || "A friend's pack", by: l.sellerName, kind: ["holo", "kraft", "matte"].includes(c.pouch) ? c.pouch : "kraft", hue: 0,
      blurb: c.blurb || "", friend: l, left: Array(Math.max(0, l.slotsLeft)).fill(null), total: l.slotCount };
  },
  /* Why a pull cannot happen right now, or "" when it can. */
  why(l) {
    if (this.data?.offline) return "Connect to the internet to pull from your friends' packs.";
    if (l.state === "paused") return "This pack is taken down for now.";
    if (!(l.slotsLeft > 0)) return "Someone pulled the last one.";
    if (!S.developer && S.scraps.balance < l.price) return `You need ${(l.price - S.scraps.balance).toLocaleString("en-US")} more Scraps.`;
    return "";
  },
  /* Pay for one pull and open it with the same ceremony as a pack on the shelf. */
  pull(pack) {
    if (this.why(pack.friend)) return;
    PackZoom.dispose();
    this.stale();
    return Cer.openPack(pack, { pull: () => Bridge.invoke("market_pull", { listingId: pack.listingId, queue: false }) });
  },
};

/* What the hero at the top of Packs shows, decided on this Mac only: nothing about friends' packs is sent anywhere.
   A friend's pack this Mac can pull (not your own, not sold out, from a friend you know, its card opened) comes first, at random;
   otherwise the owner's featured official packs (the signed shop setting; without one, the first built-in pack), leaving out any
   that are off sale or would overfill the bag; otherwise no hero. "Official first" in the shop setting swaps the two. The choice
   is made again each time Market opens and kept while it stays open. */
const Featured = {
  key: null,
  reset() { this.key = null; },
  friends() {
    const d = FriendShop.data;
    if (!d?.enabled || d.offline) return [];
    const mine = new Set((d.mine || []).map((l) => l.listingId));
    return (d.listings || []).filter((l) => l.card && l.state === "open" && l.slotsLeft > 0 && l.sellerName && !mine.has(l.listingId) && !l.blocked)
      .map((l) => ({ kind: "friend", key: "friend:" + l.listingId, listing: l, pack: FriendShop.pack(l) }));
  },
  officials(packs) {
    const chosen = S.scraps.shop?.featured?.length ? S.scraps.shop.featured : [MARKET_PACKS[0].id];
    return chosen.map((id) => packs.find((p) => p.id === id)).filter((p) => p && Market.onSale(p) && !Market.full(p))
      .map((p) => ({ kind: "official", key: "official:" + p.id, pack: p }));
  },
  pick(packs, random = Math.random) {
    const friends = this.friends(), officials = this.officials(packs);
    const group = (S.scraps.shop?.officialFirst ? [officials, friends] : [friends, officials]).find((g) => g.length) || [];
    const kept = group.find((c) => c.key === this.key);
    if (kept) return kept;
    const next = group.length ? group[Math.min(group.length - 1, Math.floor(random() * group.length))] : null;
    this.key = next?.key ?? null;
    return next;
  },
};

const Market = {
  /* The official packs as the shop setting describes them: its order first, its lines in place of the built-in ones. */
  official() {
    const shop = S.scraps.shop, order = shop?.order || [];
    const rank = (p) => { const i = order.indexOf(p.id); return i < 0 ? order.length + MARKET_PACKS.indexOf(p) : i; };
    return [...MARKET_PACKS].sort((a, b) => rank(a) - rank(b)).map((p) => shop?.blurbs?.[p.id] ? { ...p, blurb: shop.blurbs[p.id] } : p);
  },
  onSale(pack) { return Scraps.pack(pack.id)?.onSale !== false; },
  pouch(p) { const foil = (p.kind || "holo") === "holo"; return h("div.pk-stack.mk-pouch", h("i.pk-img" + (foil && p.hue ? ".tinted" : ""), { style: { "--k": 0, "--hue": p.hue + "deg", "--pk": packVar(p.kind) } }, foil ? h("i.sheen") : null), PackLabel(p)); },
  own(id) { return !!S.owned[id]; },
  /* Sealed stickers still in the bag, and whether another set would overflow it. */
  sealed(id) { return S.packs.find((p) => p.id === id)?.left.length || 0; },
  full(pack) { const rate = Scraps.pack(pack.id); return !!rate && this.sealed(pack.id) + rate.stickers > PACK_SEALED_CAP; },
  price(pack) { const rate = Scraps.pack(pack.id); return !this.onSale(pack) ? "Not on sale" : pack.price === "Free" && !this.own(pack.id) ? "Free" : rate ? `${rate.exchange} Scraps` : "Coming later"; },
  exchange(pack) {
    const rate = Scraps.pack(pack.id), own = this.own(pack.id), sale = this.onSale(pack);
    return Scraps.button("pack", pack.id, !rate ? "Coming later" : !sale ? "Not on sale" : this.full(pack) ? "The bag is full" : [`${own ? "Add another set" : "Exchange"} — `, ScrapAmt(rate.exchange)], !rate || !sale || this.full(pack) || !S.developer && S.scraps.balance < rate.exchange);
  },
  /* Free packs are taken straight away; anything else (including a second set of a pack you already have) goes through the exchange. */
  async get(pack) {
    if(pack.local || pack.canList) return;
    if (!this.onSale(pack)) { Shell.toast("This pack is not on sale right now."); return; }
    if (this.own(pack.id) || pack.price !== "Free") { this.exchange(pack).click(); return; }
    try { await Bridge.invoke("pack_install_demo", {packId:pack.id}); await Bridge.reload(); Snd.chime(3,784); Shell.toast(`${pack.title} is on your Packs shelf.`); Shell.refresh(); }
    catch(e) { Shell.toast(String(e)); }
  },
  /* What one set costs: nothing in the developer edition. */
  unit(pack) { const rate = Scraps.pack(pack.id); return !rate || S.developer ? 0 : rate.exchange; },
  /* How many sets can be bought right now, and what stops more. */
  limit(pack) {
    const rate = Scraps.pack(pack.id); if (!rate) return { max: 0, stop: "Not available yet." };
    if (!this.onSale(pack)) return { max: 0, stop: "This pack is not on sale right now.", rate };
    const room = Math.floor((PACK_SEALED_CAP - this.sealed(pack.id)) / rate.stickers), unit = this.unit(pack), afford = unit ? Math.floor(S.scraps.balance / unit) : Infinity;
    const max = Math.max(0, Math.min(room, afford, 1000));
    const stop = room < 1 ? "This bag is full. Open a few stickers to make room." : afford < 1 ? `You need ${(unit - S.scraps.balance).toLocaleString("en-US")} more Scraps.` : max === room && room <= afford ? "That fills the bag." : max === afford ? "That is all your Scraps will buy." : "";
    return { max, stop, rate };
  },
  /* Choose how many sets and buy them in one go, inside the card. Nothing is redrawn that holds focus; the numbers change in place. */
  buyBox(pack, onBought) {
    let qty = 1, busy = false, request = null;
    const n = (v) => v.toLocaleString("en-US");
    const out = h("output.mkz-n", { "aria-live": "polite" }), minus = h("button.mkz-ctl.minus", { type: "button", "aria-label": "One set fewer" }), plus = h("button.mkz-ctl.plus", { type: "button", "aria-label": "One set more" });
    const adds = h("b"), costs = h("b"), after = h("b"), afterRow = h("div", h("span", "Scraps after"), after), perSet = h("b"), have = h("small.muted"), stop = h("small.mkz-stop", { role: "status" }), note = h("small.muted");
    const buy = h("button.btn.mkz-primary", { type: "button" });
    const update = () => {
      const { max, stop: why, rate } = this.limit(pack), own = this.own(pack.id), unit = this.unit(pack);
      qty = Math.min(Math.max(1, qty), Math.max(1, max));
      const total = unit * qty;
      out.textContent = String(qty); minus.disabled = busy || qty <= 1; plus.disabled = busy || qty >= max;
      adds.textContent = rate ? `${n(qty * rate.stickers)} sealed stickers` : "—";
      if(S.developer) costs.textContent = "No Scraps (developer)"; else costs.replaceChildren(ScrapAmt(n(total)));
      afterRow.hidden = S.developer; if(max < 1) after.textContent = "—"; else after.replaceChildren(ScrapAmt(n(S.scraps.balance - total)));
      if(S.developer) perSet.textContent = "Free (developer)"; else if(rate) perSet.replaceChildren(ScrapAmt(n(rate.exchange))); else perSet.textContent = "Coming later";
      if(S.developer) have.textContent = ""; else have.replaceChildren("You have ", ScrapAmt(n(S.scraps.balance))); have.hidden = S.developer;
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
    if(pack.friend) return this.friendCard(pack);
    if(pack.local || pack.canList) return Pages.packs.card(pack);
    const paid = pack.price !== "Free" || this.own(pack.id);
    const peek = PackPeek(pack.keys, ""); peek?.classList.add("compact"); // the Market card also holds the price box, so the sheet is smaller here
    const own = h("p.mkz-own"), paintOwn = () => { const have = this.own(pack.id); own.hidden = !have; own.replaceChildren(h("b", "On your shelf"), ` · ${this.sealed(pack.id)} sealed`); };
    paintOwn();
    const buy = paid ? this.buyBox(pack, paintOwn) : null;
    const free = paid ? null : h("button.btn.mkz-act", { on: { click: () => Market.get(pack) } }, "Get — Free");
    return h("aside.mkz-card", CloseButton("Back to the shelf", {}, ".mkz-x"),
      h("p.eyebrow", `by ${pack.by} · ${pack.count} stickers`), h("h2", pack.title), h("p.mkz-blurb", pack.blurb),
      own, peek,
      h("div.mkz-buy", buy ? buy.el : [h("div.mkz-price", h("span", "Price"), h("b", "Free")), free,
        h("small.muted", "Open it any time, as often as you like. What's inside stays a surprise until you tear it.")],
        h("button.mkz-back.link", { type: "button" }, "Back to the shelf")));
  },
  /* A friend's pack: what is inside and how much is left, then one pull at a time. The lines fill in from the service once it answers. */
  friendCard(pack) {
    const l = pack.friend, n = (v) => v.toLocaleString("en-US");
    const lines = h("ul.pk-sale-list.mk-friend-lines"), peekHost = h("div.peek-host");
    const fill = (card, taken) => {
      if (!card) return;
      const all = [...(card.designs || []), ...(card.prizes || [])];
      lines.replaceChildren(...all.map((x, i) => h("li.pk-sale-line", h("span.pk-sale-title", h("span", x.name)),
        h("b", taken ? `${Math.max(0, x.total - (taken[i] || 0))} of ${x.total} left` : `${x.total}`))));
      const peek = (card.peek || []).map((p) => ({ src: "data:image/png;base64," + p.png, name: p.name }));
      const fig = peek.length ? PackPeek(peek, "A few from this pack") : null; if (fig) { fig.classList.add("compact"); peekHost.replaceChildren(fig); }
    };
    fill(l.card, null);
    const costs = h("b"), after = h("b"), have = h("small.muted"), stop = h("small.mkz-stop", { role: "status" });
    const buy = h("button.btn.mkz-primary", { type: "button", on: { click: () => FriendShop.pull(pack) } });
    const paint = () => {
      const why = FriendShop.why(l), unit = S.developer ? 0 : l.price;
      if (S.developer) costs.textContent = "No Scraps (developer)"; else costs.replaceChildren(ScrapAmt(n(unit)));
      after.replaceChildren(why ? "—" : ScrapAmt(n(S.scraps.balance - unit)));
      if (S.developer) have.textContent = ""; else have.replaceChildren("You have ", ScrapAmt(n(S.scraps.balance)));
      buy.disabled = !!why; buy.replaceChildren(...(why ? ["Can't pull right now"] : ["Pull one — ", ScrapAmt(n(l.price))]));
      stop.textContent = why; stop.hidden = !why;
    };
    paint();
    Bridge.invoke("market_card", { listingId: l.listingId }).then((v) => {
      Object.assign(l, v.listing); pack.left = Array(Math.max(0, l.slotsLeft)).fill(null); fill(l.card, v.taken.length ? v.taken : null); paint();
    }, (e) => { stop.textContent = String(e); stop.hidden = false; });
    return h("aside.mkz-card", CloseButton("Back to the shelf", {}, ".mkz-x"),
      h("p.eyebrow", `from ${l.sellerName} · ${FriendShop.left(l)}`), h("h2", pack.title), pack.blurb ? h("p.mkz-blurb", pack.blurb) : null,
      peekHost, lines,
      h("div.mkz-buy", h("div.mkz-qty",
        h("div.mkz-price", h("span", "Per pull"), h("b", ScrapAmt(n(l.price)))), have,
        h("dl.mkz-sum", h("div", h("span", "Costs"), costs), h("div", h("span", "Scraps after"), after)),
        stop, buy, h("small.muted", "Each pull opens one sticker or prize at random. Editions are numbered: the one you pull is yours alone.")),
        h("button.mkz-back.link", { type: "button" }, "Back to the shelf")));
  },
};

Pages.market = {
  /* Where the rail is on screen, [x, y]: the packs feel its real motion, whether it is the page sliding in or the page being scrolled. */
  follow(root) { return () => { const r = root.querySelector(".mk-rail-row")?.getBoundingClientRect(); return r ? [r.left, r.top] : null; }; },
  /* The page is still sliding in when the packs start to swing: they are real pendulums on a moving rail. */
  arrive(root, o) { if (MK.tab === "packs") requestAnimationFrame(() => Pages.market.sway(root, o?.dir, Pages.market.follow(root))); },
  build() {
    Featured.reset();
    const root = h("div.page-in.marketpage");
    root.addEventListener("scroll", () => { if (MK.tab === "packs") Pages.market.sway(root, 0, Pages.market.follow(root)); }, { passive: true });
    const paint = () => {
      root.replaceChildren(
        PageHead("Market", "Packs, materials and creators"),
        h("div.seg.mk-seg", ["packs", "materials", "tools", "creators"].map((t) => SegButton(t[0].toUpperCase() + t.slice(1), { "aria-pressed": String(MK.tab === t), on: { click: () => { MK.tab = t; Snd.tap(); paint(); if (t === "packs") Pages.market.sway(root); } } }))),
        MK.tab === "packs" ? this.packs(paint) : MK.tab === "materials" ? this.materials(paint) : MK.tab === "tools" ? this.tools(paint) : this.creators(paint));
      const form = Scraps.form(); if(form) root.insertBefore(form, root.children[2]);
    };
    paint(); return root;
  },
  /* Small tools for your Peta, each on its own taped sheet. The link tag is reusable: it comes back to you when you take it off or seal the sticker
     into a gift or a pack. The board is reusable too: deleting a look gives the blank board back. */
  tools(paint) {
    const stock = LinkTags.stock(), price = LT_PRICE(), cannot = !S.developer && S.scraps.balance < price;
    const sheet = (...kids) => h("article.mk-tool", h("i.mk-tool-tape", { "aria-hidden": "true" }), ...kids);
    const tagPic = LinkTagPic();
    tagPic.append(h("span.lt-face.mk-tag-face", img("marketPetaIcon")));
    const tag = sheet(h("h3", "Link tag"), h("p.mk-tool-sub", "Open an app, website or folder from any Peta."),
      h("div.mk-tool-art.mk-art-tag", { "aria-hidden": "true" }, h("i.mk-art-card"), h("i.mk-art-egg"), h("span.mk-art-hang", tagPic)),
      h("p.mk-tool-cap", "Reusable · Hidden on desktop"),
      h("button.btn.mk-tool-get", { type: "button", disabled: cannot, on: { click: () => LinkTags.buy(paint) } }, cannot ? "Not enough Scraps" : "Get a tag"),
      h("p.mk-tool-price", S.developer ? "Free · Developer" : ScrapAmt(price)), h("p.mk-tool-note", "Returns to you when removed."),
      h("div.mk-tool-foot", h("p", h("span", "Available", h("b", String(stock.available))), h("span", `${stock.attached} attached`)),
        h("button.link", { type: "button", on: { click: () => Shell.go("book") } }, "Manage link tags ", h("i", "→"))));
    const sheets = [tag];
    if(Pages.boards && S.boards) {
      const boardStock=S.boards.stock, info=BoardState.tool(boardStock,S.scraps,S.developer);
      sheets.push(sheet(h("h3", "Board ×1"), h("p.mk-tool-sub", "A blank board to keep one more look."),
        h("div.mk-tool-art.mk-art-board", { "aria-hidden": "true" }, h("i"), h("i"), h("i.mk-art-clip")),
        h("p.mk-tool-cap", "Save a screen, keep a favourite."),
        h("button.btn.mk-tool-get", { type: "button", disabled:this.boardBusy || (!this.boardRequest && info.disabled), on: { click: () => this.buyBoard(paint) } }, this.boardRequest ? "Retry board purchase" : info.label),
        h("p.mk-tool-price", S.developer ? "Free · Developer" : info.price==null ? "Unavailable" : ScrapAmt(info.price)), h("p.mk-tool-note", "Uses one per look. Returns when deleted."),
        h("div.mk-tool-foot", h("p", h("span", "Blank boards", h("b", String(boardStock.available)))),
          h("button.link", { type: "button", on: { click: () => Shell.go("boards") } }, "Open Boards ", h("i", "→")))));
    }
    return h("div.mk-toolspage", h("p.muted.lede", "Small tools for your Peta."), h("div.mk-toolgrid", sheets));
  },
  async buyBoard(paint) {
    if(this.boardBusy || Scraps.inFlight) return;
    const info=BoardState.tool(S.boards.stock,S.scraps,S.developer);if(!this.boardRequest && info.disabled) return;
    this.boardRequest ||= {trade:{kind:"tool",itemId:"board",quantity:1},requestId:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,"0")).join("")};
    this.boardBusy=true;Scraps.inFlight=true;const was=!!Bridge.busy;Bridge.busy=true;paint();
    try {await Bridge.invoke("scrap_trade",this.boardRequest);this.boardRequest=null;await Bridge.reload();Snd.chime(2,740);Shell.toast("A blank board is in your stock.");}
    catch(e) {Shell.toast(String(e));}
    finally {this.boardBusy=false;Scraps.inFlight=false;Bridge.busy=was;paint();}
  },
  packs(paint) {
    const official = Market.official(), feat = Featured.pick(official);
    const open = (p, tile) => { Snd.tap(); PackZoom.open(p, tile, (pack) => Market.card(pack)); };
    const cell = (p, i) => {
      const own = Market.own(p.id);
      /* The clip and the pack hang and swing together; the word under them is written on the wall, so it stays put. */
      return h("div.mk-item", h("div.mk-hang", h("i.mk-clip", { "aria-hidden": "true" }), h("button.mk-tile", { "aria-label": `${p.title} by ${p.by}${own ? ", owned" : ""} — look closer`, "aria-haspopup": "dialog", data: { pack: p.id }, style: { "--i": i }, on: { click: (e) => open(p, e.currentTarget) } },
        Market.pouch(p))), own ? h("span.pk-badge.own", "Owned") : p.price === "Free" ? h("span.pk-badge.free", "Free") : null);
    };
    const rail = official.filter((p) => p.id !== (feat?.kind === "official" ? feat.pack.id : null) && (Market.onSale(p) || Market.own(p.id)));
    const main = h("div.mk-main",
      feat ? this.hero(feat, open) : null,
      this.localPacks(),
      h("p.eyebrow.mk-h", "New and popular"), this.rail(rail.map(cell)),
      this.friendPacks(paint));
    return h("div.mk", main);
  },
  /* The hero: an official pack with three of its stickers fanned out, or a friend's pack with the pictures from its card. */
  hero(feat, open) {
    const art = (e) => e.currentTarget.closest(".mk-hero").querySelector(".mk-hero-art");
    if (feat.kind === "friend") {
      const l = feat.listing, p = feat.pack;
      const fan = (l.card.peek || []).slice(0, 3).map((x, i) => h("div.fan-s", { style: { "--i": i, "--fan-width": "84px" } }, h("img", { src: "data:image/png;base64," + x.png, alt: x.name, width: 84 })));
      return h("section.mk-hero.mk-hero-friend", h("div.mk-hero-art", Market.pouch(p), fan.length ? h("div.fan", fan) : null),
        h("div.mk-hero-text", h("p.eyebrow", "From a friend"), h("h2", p.title), h("p.muted", `by ${l.sellerName} · ${FriendShop.left(l)}`), p.blurb ? h("p", p.blurb) : null,
          h("div.mk-hero-actions", h("button.btn", { "aria-haspopup": "dialog", on: { click: (e) => open(p, art(e)) } }, "Look closer…"))));
    }
    const p = feat.pack, own = Market.own(p.id), free = p.price === "Free" && !own;
    return h("section.mk-hero", h("div.mk-hero-art", Market.pouch(p), h("div.fan", p.keys.slice(0, 3).map((k, i) => { const e = h("div.fan-s", { style: { "--i": i } }); Stk.make(A[k], { border: 12, material: "matte", max: 300 }).then((r) => { const width = r.aspect >= 1 ? 84 : 84 * r.aspect; e.style.setProperty("--fan-width", width+"px"); e.append(Stk.el(r, width)); }); return e; }))),
      h("div.mk-hero-text", h("p.eyebrow", "Featured"), h("h2", p.title), h("p.muted", `by ${p.by} · ${p.count} stickers`), h("p", p.blurb),
        h("div.mk-hero-actions", h("button.btn", { on: { click: (e) => free ? Market.get(p) : open(p, art(e)) } }, own ? "Add another set…" : free ? "Get — Free" : ["Exchange — ", Market.price(p)]))));
  },
  /* Friends' rails, one per friend, below the packs that come with Peta. Nothing is shown in builds without the server. */
  friendPacks(paint) {
    if (!FriendShop.fresh()) FriendShop.load().then((d) => { if (d?.enabled && MK.tab === "packs" && S.page === "market" && !PackZoom.current) paint(); });
    const d = FriendShop.data;
    if (!d?.enabled) return null;
    const head = h("h2.pk-section-title", "From friends");
    if (!d.hasFriends) return h("section.mk-friends", head, h("p.muted.lede", "Add a friend to see the packs they make."),
      h("button.link", { type: "button", on: { click: () => Shell.go("settings") } }, "Friends in Settings ", h("i", "→")));
    const offline = d.offline ? h("p.small.muted.mk-offline", "Connect to the internet to pull from your friends' packs.") : null;
    const listings = (d.listings || []).filter((l) => l.card);
    if (!listings.length) return h("section.mk-friends", head, offline, h("p.muted.lede", "Your friends haven't put any packs out yet."));
    const open = (p, tile) => { Snd.tap(); PackZoom.open(p, tile, (pack) => Market.card(pack)); };
    const cell = (l, i) => {
      const p = FriendShop.pack(l);
      return h("div.mk-item", h("div.mk-hang", h("i.mk-clip", { "aria-hidden": "true" }), h("button.mk-tile", { "aria-label": `${p.title} from ${l.sellerName}, ${FriendShop.left(l)} — look closer`, "aria-haspopup": "dialog", data: { pack: p.id }, style: { "--i": i }, on: { click: (e) => open(p, e.currentTarget) } },
        Market.pouch(p))), h("span.mk-friend-note", `${l.price} Scraps · ${FriendShop.left(l)}`));
    };
    const sellers = [...new Set(listings.map((l) => l.sellerKey))];
    return h("section.mk-friends", head, offline, sellers.map((key) => {
      const theirs = listings.filter((l) => l.sellerKey === key);
      return [h("p.eyebrow.mk-h", `From ${theirs[0].sellerName}`), this.rail(theirs.map(cell))];
    }));
  },
  localPacks() {
    const packs=PackListing.visible();
    if(!packs.length) return null;
    return h("section.mk-local", h("h2.pk-section-title", "On this Mac"),
      h("p.muted.lede", "Your listed packs. Take one down to keep it on My shelf for another season."),
      Pages.packs.shelf(packs));
  },
  /* Each pack is a damped pendulum hanging from the rod: θ'' = -ω₀² sin θ - 2ζω₀ θ' + (a/L) cos θ, where a is the rail's real acceleration along x
     (measured every frame from where the page actually is, by `follow`). Scrolling moves the rail up and down; a pack that hangs a little off-centre
     turns a little when that speeds up or slows down (the ecc term), so a fast scroll sets them swinging too. The rail's motion pushes them, they lag, swing past, and ring down
     on their own once it has stopped, so nothing is timed by hand. A shorter pack swings quicker. Without a moving page, one small push stands in for it. */
  sway(root, dir = 1, follow = null) {
    if (reduced() || root._swinging) return;
    const G = 9.8, PX = .0018, ZETA = .14, GAIN = .3, GAIN_Y = .1;   // 1 css px ≈ 1.8 mm: a pack is about 18 cm tall
    // No two packs hang quite alike: the pouch sits a little lower in one clip than in the next, and the first push is a small stand-in for the page stopping.
    const bobs = $$(".mk-rail .mk-hang", root).map((el, i) => ({ el, th: 0, om: (follow ? .35 : .5) * dir, skew: 1 + (((i * 37) % 11) - 5) * .014, ecc: (((i * 53) % 7) - 3) * .06 }));
    if (!bobs.length) return;
    root._swinging = true;
    let last = performance.now(), start = last, x0 = null, y0 = null, vx = 0, vy = 0, ax0 = 0, ay0 = 0, still = 0;
    const tick = (now) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      if (!dt) return requestAnimationFrame(tick);
      let ax = 0, ay = 0;
      const at = follow?.();
      if (at) {
        if (x0 != null) {
          const u = (at[0] - x0) / dt, w = (at[1] - y0) / dt;
          ax0 += ((u - vx) / dt - ax0) * .5; ay0 += ((w - vy) / dt - ay0) * .5; vx = u; vy = w; ax = ax0 * GAIN; ay = ay0 * GAIN_Y;
        }
        x0 = at[0]; y0 = at[1];
      }
      const n = Math.ceil(dt / .004), h = dt / n;
      let energy = 0;
      for (const b of bobs) {
        const L = b.L ||= Math.max(60, b.el.getBoundingClientRect().height * .5 || 85) * b.skew, w0 = Math.sqrt(G / (L * PX));
        for (let k = 0; k < n; k++) {   // semi-implicit Euler, small steps
          b.om += (-w0 * w0 * Math.sin(b.th) - 2 * ZETA * w0 * b.om + (ax / L) * Math.cos(b.th) + (ay / L) * b.ecc) * h;
          b.th = Math.max(-.45, Math.min(.45, b.th + b.om * h));
        }
        b.el.style.transform = `rotate(${b.th}rad)`; energy += Math.abs(b.th) + Math.abs(b.om) * .1;
      }
      still = energy < .0015 * bobs.length && Math.abs(ax) < 1 && Math.abs(ay) < 1 ? still + dt : 0;
      if ((still > .25 && now - start > 400) || now - start > 9000 || !root.isConnected) { bobs.forEach((b) => { b.el.style.transform = ""; }); root._swinging = false; return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  /* Packs hang from a metal rail by a clip. As many to a row as fit; every row gets its own rail. The cells are only moved between rows,
     so their listeners and focus survive a resize. */
  rail(cells) {
    const GAP = 18, CELL = 150, ENDS = 88, rail = h("div.mk-rail");
    let cols = 0;
    const place = (n) => {
      if (n === cols) return; cols = n;
      const rows = []; for (let i = 0; i < cells.length; i += n) rows.push(h("div.mk-rail-row", { style: { "--n": n } }, h("i.mk-rod"), h("i.mk-end.l"), h("i.mk-end.r"), cells.slice(i, i + n)));
      rail.replaceChildren(...rows);
    };
    place(5);
    new ResizeObserver(() => {
      if (!rail.clientWidth || PackZoom.active) return;
      place(Math.max(2, Math.floor((rail.clientWidth - ENDS + GAP) / (CELL + GAP))));
    }).observe(rail);
    return rail;
  },
  materials(paint) {
    // TODO(owner): cash purchases remain unavailable. Sakura awaits its seasonal distribution.
    const items = Object.values(MAT);
    return h("div.mk-mats", h("p.muted.lede", "Exchange Scraps for sheets. Save unused sheets as Scraps in your Materials."),
      h("button.btn.paper.small.scrap-action", {on:{click:()=>Shell.go("materials")}}, "Dismantle materials…"),
      h("div.mgrid", items.map((m, i) => h("div.mbook.mk-mat", { style: { "--i": i } },
        h("div.mc", MatCard({ ...m, id: m.id }, 176)), h("div.mmeta", h("b", m.name), h("span.seal", { data: { rarity: m.rarity } }, m.rarity), h("small.recipe", m.recipe),
          h("small", m.locked ? "Not in your book yet" : `${S.stock[m.id] || 0} sheets in stock`),
          Scraps.material(m.id)?.exchange != null ? Scraps.button("material", m.id, ["Exchange — ", ScrapAmt(Scraps.material(m.id).exchange)], !S.developer && S.scraps.balance < Scraps.material(m.id).exchange)
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
