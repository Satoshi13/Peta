/* Packs: a shelf of pouches. Tearing one open is the ceremony in pack.js. */

/* What a Studio-made pack shows of itself: its cover and up to three pictures (Rust picks the cover, then the most common items; the rarest stay a
   surprise). Fetched once and kept. */
const PackArt = {
  cache: new Map(),
  covers: new Map(),
  decorated(p) { return !!BAGS[p.bag] && (BAGS[p.bag].gen || p.signed); },
  cover(p) {
    if(!p.cover || !p.signed) return Promise.resolve(null);
    if(!this.covers.has(p.id)) this.covers.set(p.id, Bridge.invoke("pack_cover_picture",{packId:p.id}).then(bytes=>URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:"image/png"}))).catch(()=>null));
    return this.covers.get(p.id);
  },
  /** [{ src, baked: true }] for a signed pack; [] for the packs that ship with the app. */
  peek(p) {
    if(!p.signed) return Promise.resolve([]);
    if(!this.cache.has(p.id)) this.cache.set(p.id, (async () => {
      const items = await Bridge.invoke("pack_peek", { packId: p.id });
      return Promise.all(items.map(async (it) => { const bytes = await Bridge.invoke("pack_peek_picture", { itemId: it.itemId }); return { src: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" })), baked: true, name: it.name }; }));
    })().catch(() => []));
    return this.cache.get(p.id);
  },
  /** The wrapped pack for a shelf cell, standing on the ledge; `cover` is a picture url or null. Scales with its box, so the zoom can enlarge it. */
  shelf(p, cover) {
    const b = BAGS[p.bag], [x0, , x1, y1] = b.body, bw = x1 - x0, obj = Math.min(b.cm * 15, 166);
    const pic = BagPic({ bag: p.bag, title: p.title, sub: "by " + p.by, cover, deco: p.deco || "none", layout: p.layout, k: 15, fit: 166, shut: true, id: p.id });
    pic.style.width = (obj / (bw / 100) / 168 * 100) + "%"; pic.style.left = "50%"; pic.style.bottom = "0"; pic.style.translate = `-50% ${100 - y1}%`; pic.style.position = "absolute";
    return pic;
  },
};

/* The title and the author are printed on the pouch's own white label, wherever the pouch is shown. */
function PackLabel(p) {
  return h("span.pk-label", { "aria-hidden": "true", data: { kind: p.kind || "holo" } }, h("b", p.title), h("small", "by " + p.by));
}

/* Click a pack (in the Market or on the Packs shelf) and the camera moves in on it: the whole shelf scales up around the pouch until it
   fills the left half, the page behind softens, and only then do the details and the choices appear. Back, Esc or a click outside moves
   the camera out again. The pouch never travels on its own; it stays where it is in the world and the world moves.
   `build(pack)` returns the card; a button inside it with the class mkz-act closes the view at once before its own handler runs. */
const PackZoom = {
  current: null,
  get active() { return this.current?.root.isConnected ? this.current : null; },
  open(pack, tile, build) {
    if (this.active) return;
    if (this.current) this.dispose();
    const page = Shell.current, source = $(".pk-stack", tile);
    if (!page || !source) return;
    const root = h("div.mkz", { role: "dialog", "aria-label": pack.title, tabindex: -1 }), scrim = h("div.mkz-scrim");
    const clone = source.cloneNode(true); clone.classList.add("mkz-pack"); clone.removeAttribute("style");
    const card = build(pack), world = [...page.children], nav = $("#nav");
    const savedWorld = world.map(el => ({ el, inert: el.inert, transform: el.style.transform, origin: el.style.transformOrigin }));
    const cur = this.current = { root, scrim, clone, card, source, tile, pack, world, savedWorld, nav, page,
      overflow: page.style.overflowY, sourceVisibility: source.style.visibility, closing: false };
    const buttons = () => $$(".mkz-act, .mkz-ctl, .mkz-primary, .mkz-back, .mkz-x", card).filter(b => !b.disabled && !b.hidden && b.getClientRects().length);
    const focusable = () => [...buttons(), ...(nav ? $$("button:not(:disabled)", nav).filter(b => !b.closest("[inert]") && b.getClientRects().length) : [])];
    try {
      // Freeze the shelf at its current scroll position; navigation and window controls stay available.
      root.style.cssText = `top:${page.scrollTop}px;bottom:auto;height:${page.clientHeight}px`; page.style.overflowY = "hidden";
      root.append(scrim, clone, card); page.append(root);
      const to = this.target(root), from = this.rectIn(root, source), k = to.width / from.width;
      cur.camera = `translate(${to.left - from.left * k}px, ${to.top - from.top * k}px) scale(${k})`;
      cur.packFrom = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${1 / k})`;
      const rr = root.getBoundingClientRect();
      for (const el of world) {
        const r = el.getBoundingClientRect(); el.style.transformOrigin = `${rr.left - r.left}px ${rr.top - r.top}px`; el.inert = true;
      }
      cur.onKey = e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
        if (e.key === "Tab") {
          e.preventDefault(); e.stopImmediatePropagation();
          const list = focusable(), i = list.indexOf(document.activeElement);
          const next = i < 0 ? (e.shiftKey ? list.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + list.length) % list.length;
          (list[next] || root).focus({ preventScroll: true }); return;
        }
        const input = e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
        const button = e.target.closest?.("button");
        if (!input && (e.metaKey || e.ctrlKey)) e.preventDefault();
        if (!input && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key) && !(button && e.key === " ")) e.preventDefault();
        // Preserve native Enter/Space activation and text editing, while isolating global handlers.
        e.stopImmediatePropagation();
      };
      cur.onFocus = e => {
        if (!root.contains(e.target) && !nav?.contains(e.target) && !e.target.closest?.(".wctl")) (buttons()[0] || root).focus({ preventScroll: true });
      };
      // The window can change size while a pack is zoomed: the overlay was sized when it opened, so keep it covering the page and the pouch beside the card.
      cur.onResize = () => {
        if (cur.closing || this.current !== cur) return;
        root.style.cssText = `top:${page.scrollTop}px;bottom:auto;height:${page.clientHeight}px`;
        const t = this.target(root);
        cur.world.forEach((el) => { el.getAnimations().forEach((a) => a.cancel()); el.style.transform = ""; el.style.transformOrigin = ""; }); // the shelf is hidden behind the veil; no camera to undo
        cur.camera = "none";
        clone.getAnimations().forEach((a) => a.cancel());
        Object.assign(clone.style, { left: t.left + "px", top: t.top + "px", width: t.width + "px", height: t.height + "px", transform: "none" });
      };
      window.addEventListener("resize", cur.onResize);
      window.addEventListener("keydown", cur.onKey, true);
      window.addEventListener("focusin", cur.onFocus, true);
      root.focus({ preventScroll: true });
      scrim.addEventListener("click", () => this.close());
      card.addEventListener("click", e => { if (e.target.closest(".mkz-back, .mkz-x")) this.close(); });
      card.addEventListener("click", e => { if (e.target.closest(".mkz-act")) this.dispose(); }, true);
      // Rasterize at the final size; only the journey uses a scale.
      Object.assign(clone.style, { left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px", transformOrigin: "0 0", transform: cur.packFrom });
      source.style.visibility = "hidden";
      anim(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: EASE.out, delay: 120 });
      this.move(cur, "none", cur.camera, 680).then(async () => {
        if (cur.closing || !root.isConnected) return;
        const animation = anim(card, [{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: EASE.out });
        card.classList.add("on"); (buttons().find(b => b.matches(".mkz-act, .mkz-primary")) || buttons()[0] || root).focus({ preventScroll: true });
        (await animation).cancel?.();
      }).catch(error => { if (this.current === cur) this.dispose(true); Shell.toast(String(error)); });
      // the picture and its label are tilted as ONE layer; tilting each on its own gives each its own perspective, and the label slides off the pouch
      const tiltLayer = h("div.mkz-tilt"); tiltLayer.append(...clone.childNodes); clone.append(tiltLayer);
      const zoomImg = $(".pk-img", clone), zoomLight = zoomImg ? SurfaceLight.attach(zoomImg, pack.kind || "holo") : { aim() {}, rest() {} };
      onPointerFollow(clone, (x, y, e, amount) => {
        if (!e) return;
        const r = (zoomImg || $(".bagpic", clone)).getBoundingClientRect(), px = clamp((e.clientX - r.left) / r.width, -.2, 1.2), py = clamp((e.clientY - r.top) / r.height, -.2, 1.2);
        zoomLight.aim(px, py, amount);
        clone.style.setProperty("--rx", -(py - .5) * 8 * amount + "deg"); clone.style.setProperty("--ry", (px - .5) * 8 * amount + "deg");
      }, () => { zoomLight.rest(); clone.style.setProperty("--rx", "0deg"); clone.style.setProperty("--ry", "0deg"); });
    } catch (error) { this.dispose(true); throw error; }
  },
  /* One camera move for the pouch and the page around it, so they always stay in the same place relative to each other. */
  move(cur, a, b, duration) {
    return Promise.all([cur.clone, ...cur.world].map((el) => {
      const start = getComputedStyle(el).transform;
      el.getAnimations().forEach((animation) => animation.cancel());
      const end = el === cur.clone ? (b === "none" ? cur.packFrom : "none") : b;
      return animCommit(el, [{ transform: start }, { transform: end }], { duration, easing: EASE.inOut }).then(() => {
        if (el === cur.clone && b !== "none" && !cur.closing) el.style.transform = "none";
      });
    }));
  },
  /* Where the pouch comes to rest: left of the card, as large as the window allows. */
  target(root) {
    const r = root.getBoundingClientRect(), cardW = Math.min(340, r.width * .44), leftW = r.width - cardW - 52;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    let height = Math.min(r.height * .72, 440, 1024 / dpr), width = height * .75;
    if (width > leftW * .84) { width = leftW * .84; height = width / .75; }
    return { left: 24 + (leftW - width) / 2, top: (r.height - height) / 2 + 6, width, height };
  },
  rectIn(root, el) { const a = root.getBoundingClientRect(), b = el.getBoundingClientRect(); return { left: b.left - a.left, top: b.top - a.top, width: b.width, height: b.height }; },
  /* Move back out: the card goes first, then the camera pulls back to the whole shelf. */
  async close() {
    const cur = this.active; if (!cur || cur.closing) return; cur.closing = true;
    try {
      anim(cur.card, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(16px)" }], { duration: 160, easing: EASE.out });
      anim(cur.scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: EASE.out, delay: 120 });
      await this.move(cur, cur.camera, "none", 560);
    } finally { if (this.current === cur) this.dispose(true); }
  },
  /* Remove the view at once (no motion). `restore` hands focus back to the pack that was chosen. */
  dispose(restore = false) {
    const cur = this.current; if (!cur) return;
    window.removeEventListener("resize", cur.onResize);
    window.removeEventListener("keydown", cur.onKey, true);
    window.removeEventListener("focusin", cur.onFocus, true);
    for (const { el, inert, transform, origin } of cur.savedWorld) { el.getAnimations().forEach(a => a.cancel()); el.style.transform = transform; el.style.transformOrigin = origin; el.inert = inert; }
    for (const el of [cur.clone, cur.scrim, cur.card]) el.getAnimations().forEach(a => a.cancel());
    cur.page.style.overflowY = cur.overflow;
    cur.source.style.visibility = cur.sourceVisibility; cur.root.remove(); this.current = null;
    if (cur.stale) { Shell.refresh(); const id = cur.pack.id; $(`[data-pack="${id}"]`)?.focus({ preventScroll: true }); return; }
    if (restore && cur.tile.isConnected) cur.tile.focus({ preventScroll: true });
  },
  /* Something behind the card changed (a purchase): redraw the page once the card has gone, not under it. */
  stale() { if (this.current) this.current.stale = true; },
};

/* The remaining count, written by hand on the wall. No two letters are drawn alike: each gets its own small tilt, lift, size and pressure
   (from a seed, so a pack's count is always written the same way), and the whole line leans a little. The ink look itself is the #wall-ink filter. */
const WallInk = {
  rng(key) { let a = 2166136261; for (const c of String(key)) { a ^= c.charCodeAt(0); a = Math.imul(a, 16777619); } return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; },
  write(text, key) {
    const r = this.rng(key), span = (k) => (r() * 2 - 1) * k;
    const words = String(text).split(" ").map((word) => h("span.ink-w", [...word].map((c) => h("span.ink", { style: { "--r": span(3.4) + "deg", "--y": span(1.3) + "px", "--s": (1 + span(.05)).toFixed(3), "--o": (.8 + r() * .2).toFixed(2) } }, c))));
    return { nodes: words.flatMap((w, i) => i ? [" ", w] : [w]), tilt: span(1.3) + "deg", dx: span(3) + "px" };
  },
};

/* A listing is only this Mac's display of the same finished pack. */
const PackListing = {
  visible() { return S.packs.filter(p => p.own && p.listed).map(p => ({...p, local:true, empty:!p.left.length})); },
  control(p) {
    if(!p.own || (!p.canList && !p.listed)) return null;
    let busy=false;
    const status=h("p.mkz-rule", {role:"status", "aria-live":"polite"});
    const button=h("button.btn.paper.mkz-primary", {type:"button", on:{click:async()=>{
      if(busy || Bridge.busy) return;
      const desired=!p.listed;
      busy=true; Bridge.busy=true; paint();
      try {
        const listed=await Bridge.invoke("creator_pack_set_listed", {packId:p.id, listed:desired});
        // Commit the native result before any fallible UI refresh.
        p.listed=listed;
        const stored=S.packs.find(pack=>pack.id===p.id); if(stored) stored.listed=listed;
        PackZoom.stale();
        try { await Bridge.reload(); } catch { Shell.toast("Saved the listing. The shelf will refresh when you reopen it."); }
        Snd.tap();
      } catch(err) { Shell.toast(String(err)); }
      finally {
        busy=false; Bridge.busy=false; paint();
        if(!PackZoom.current) Shell.refresh();
      }
    }}});
    const paint=()=>{
      button.disabled=busy;
      button.textContent=busy ? "Saving…" : p.listed ? "Take down from Market" : "List in Market";
      status.textContent=p.listed ? "Listed in Market · visible on this Mac" : "Kept on My shelf · not listed";
    };
    paint(); return h("div.pk-listing", status, button);
  },
};

Pages.packs = {
  build() {
    const root = h("div.page-in.packspage");
    root.append(PageHead("Packs", "Open one at random", h("span.quota", { "aria-live": "polite" }, h("b", "Welcome Pack"), ` ${S.packAvailable ? 0 : 1} of 1 today`, h("small", "resets at midnight · other packs open any time"))));
    const items = S.packs.map((p) => ({ ...p, empty: !p.left.length })), stored=items.filter(p=>p.own), received=items.filter(p=>!p.own);
    if(stored.length) root.append(h("h2.pk-section-title","My shelf"),h("p.muted.lede","Keep finished packs for another season. List or take them down in this Mac’s Market, or save the same signed file to share."),this.shelf(stored));
    if(received.length) root.append(stored.length ? h("h2.pk-section-title","Packs to open") : null,h("p.muted.lede","Choose a pack to look closer and open a random sticker. The Welcome Pack opens once a day; packs from friends open any time."),this.shelf(received));
    const total=received.reduce((n,p)=>n+p.left.length,0);
    root.append(h("p.shelf-note.muted", received.length ? `${total} slots still sealed in packs to open.` : "Your finished packs are stored on My shelf."));
    return root;
  },
  /* The pouches stand on shelf boards, as many to a row as fit; every row gets its own board. The cards are kept and only moved between rows,
     so listeners, focus and the zoom's references survive a resize. */
  shelf(items) {
    const GAP = 22, CELL = 192, cards = items.map((p, i) => this.pack(p, i)), shelf = h("div.shelf");
    let cols = 0;
    const place = (n) => {
      if (n === cols) return; cols = n;
      const rows = []; for (let i = 0; i < cards.length; i += n) rows.push(h("div.shelf-row", cards.slice(i, i + n), h("i.ledge")));
      shelf.replaceChildren(...rows);
    };
    place(3);
    new ResizeObserver(() => {
      if (!shelf.clientWidth || PackZoom.active) return;
      place(Math.max(1, Math.floor((shelf.clientWidth + GAP) / (CELL + GAP))));
    }).observe(shelf);
    return shelf;
  },
  pack(p, i) {
    const gen = PackArt.decorated(p);
    const img = gen ? null : h("i.pk-img" + ((p.kind || "holo") === "holo" && p.hue ? ".tinted" : ""), { style: { "--k": 0, "--hue": p.hue + "deg", "--pk": packVar(p.kind) } });
    const stack = h("div.pk-stack", {data:{empty:p.empty, gen: gen ? "1" : "0", kind: p.kind || "holo"}}, gen ? PackArt.shelf(p, null) : img, gen ? null : PackLabel(p));
    if(gen && p.cover) PackArt.cover(p).then((cover) => { if(cover && stack.isConnected) $(".bagpic", stack)?.replaceWith(PackArt.shelf(p, cover)); });
    const light = gen ? { aim() {}, rest() {} } : SurfaceLight.attach(img, p.kind || "holo"); // the glint is lit over the pack's own surface, not slid across it
    const card = h("button.pack", { "aria-label": `${p.title} by ${p.by}${p.own ? p.listed ? ", listed in Market on this Mac" : ", kept on My shelf" : ""}, ${p.empty ? "all opened" : p.left.length + " sealed"} — look closer`, "aria-haspopup": "dialog", data: { empty: p.empty, pack: p.id }, style: { "--i": i }, on: { click: (e) => { Snd.tap(); PackZoom.open(p, e.currentTarget, (pack) => this.card(pack)); } } },
      stack, (() => { const ink = WallInk.write(`${p.left.length} left`, p.id); return h("span.pk-count", { "aria-hidden": "true", style: { "--tilt": ink.tilt, "--dx": ink.dx } }, ...ink.nodes); })()); // written on the wall behind the pouch, so it stays put when the pouch lifts
    onPointerFollow(card, (x, y, e, amount) => {
      if (!e) return;
      const r = (img || $(".bagpic", stack)).getBoundingClientRect(), px = clamp((e.clientX - r.left) / r.width, -.2, 1.2), py = clamp((e.clientY - r.top) / r.height, -.2, 1.2);
      light.aim(px, py, amount);
      stack.style.setProperty("--rx", -(py - .5) * 7 * amount + "deg"); stack.style.setProperty("--ry", (px - .5) * 7 * amount + "deg");
    }, () => { light.rest(); stack.style.setProperty("--rx", "0deg"); stack.style.setProperty("--ry", "0deg"); });
    return card;
  },
  /* The zoomed card: what is left, then the two ways to open. */
  card(p) {
    const left = p.left.length, many = Math.min(10, left), more = left >= 2 && !p.daily;
    const available = p.freeOpenings || 0, progress = available ? 10 : Math.max(0, p.total - left) % 10;
    /* A ready free opening always comes first: while one is waiting, it is the only thing the card offers. */
    const rule = p.own ? "Stored on My shelf. Listing it again keeps the same editions and remaining slots." : available ? `${available === 1 ? "A free opening is" : "Free openings are"} ready. ${available === 1 ? "It comes" : "They come"} first.` : p.empty ? "No regular openings left." : p.daily ? (packsLeftToday() ? "Once a day — today's is ready." : "Back tomorrow. This one opens once a day.") : "";
    const listed = MARKET_PACKS.find((m) => m.id === p.id), blurb = listed?.blurb || p.blurb;
    // the packs that ship with the app show shipped pictures; a pack made in Studio shows its own (the cover first, the rarest kept hidden)
    const peekHost = h("div.peek-host"), shipped = listed ? listed.keys : p.id === "welcome" ? ["sCat", "sEgg", "sBlueFlower"] : [];
    if(shipped.length) peekHost.append(PackPeek(shipped, "") || "");
    else PackArt.peek(p).then((items) => { const fig = PackPeek(items, ""); if(fig) peekHost.replaceChildren(fig); });
    const peek = peekHost;
    const go = (fn) => () => { PackZoom.dispose(); fn(); };
    const exportPack=p.own ? h("button.btn.mkz-primary",{type:"button",on:{click:async ev=>{const b=ev.currentTarget;b.disabled=true;try {const path=await Bridge.fileDialog("creator_pack_export",{packId:p.id});if(path)Shell.toast("Saved the finished pack.");}catch(err){Shell.toast(String(err));}finally{b.disabled=false;}}}},"Save file…") : null;
    const one = p.own ? null : h("button.btn.mkz-act", { type: "button", disabled: !packOpenable(p), on: { click: go(() => { Snd.tap(); Cer.openPack(p); }) } }, "Open one");
    const free = available && !p.own ? h("button.btn.mkz-act", {type:"button",on:{click:go(()=>{Snd.tap();Cer.openPack(p,{free:true});})}}, "Open free") : null;
    const ten = more && !p.own ? h("button.btn.paper.mkz-act", { type: "button", on: { click: go(() => { Snd.tap(); Cer.openPackMany(p, many); }) } }, many === 10 ? "Open 10" : `Open all ${many}`) : null;
    return h("aside.mkz-card", CloseButton("Back to the shelf", {}, ".mkz-x"),
      h("p.eyebrow", `by ${p.by}${p.signatureStatus ? " ✓" : ""}`), h("h2", p.title), blurb ? h("p.mkz-blurb", blurb) : null,
      p.fingerprint ? h("p.mkz-fp.muted", `${p.fingerprint}${p.signatureStatus === "mine" ? " · Made by you" : p.signatureStatus === "new" ? " · New friend" : p.signatureStatus === "warning" ? " · Same name, different key" : ""}`) : null,
      h("p.mkz-own", h("b", p.own ? `${left} sealed slots` : `${left} ${left === 1 ? "opening" : "openings"} left`)),
      p.own ? null : h("div.mkz-reward", h("p.small.muted", available ? `${available} free ${available === 1 ? "opening" : "openings"} ready` : `${progress} / 10 toward a free opening`),
        h("div.mkz-pips", {role:"progressbar","aria-label":"Free opening progress","aria-valuemin":0,"aria-valuemax":10,"aria-valuenow":progress,"aria-valuetext":available ? `${available} free ${available === 1 ? "opening" : "openings"} ready` : `${progress} of 10 openings`}, Array.from({length:10}, (_, i) => h("i" + (i < progress ? "" : ".o"))))),
      peek,
      h("div.mkz-buy", rule ? h("p.mkz-rule", rule) : null,
        PackListing.control(p), exportPack, free,
        p.own || available ? null : p.empty ? h("button.btn.mkz-act", { type: "button", on: { click: () => Shell.go("market") } }, "Find more in the Market") : [one, ten],
        h("button.mkz-back.link", { type: "button" }, "Back to the shelf")));
  },
};

