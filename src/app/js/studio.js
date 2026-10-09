/* Studio: make a Pack (for the Market and friends) or a Gift (for one person). Both are three steps: what goes in, how it looks, seal it.
   Nothing is placed freely. A pack or a gift is a handful of IDs (the wrapping, the cover, one decoration) plus a few words; where each
   thing sits is fixed per wrapping (js/catalog.js BAGS), so every combination looks right and the same on every screen. */
const STUDIO = {
  limits: { min: 3, max: 24, name: 14, blurb: 60, to: 14, note: 80 },   // name / to are measured in full-width characters
  weights: [1, 2, 4, 8, 16],                                                 // how likely an item is to come out (relative); 4 is the usual
  decos: [["none", "None"], ["clip", "Clip"], ["pin", "Pin"], ["tape", "Tape"]],
  steps: { pack: ["Gather", "Dress", "Seal"], gift: ["Choose", "Dress", "Seal"] },
};
const stEm = (text) => [...text].reduce((s, c) => s + (c.charCodeAt(0) > 255 ? 1 : .55), 0);
const stClip = (text, max) => { let v = text; while (stEm(v) > max) v = v.slice(0, -1); return v; };

const ST = {
  mode: null, sealing: false, urls: new Map(), ctx: "shelf",
  pack: { step: 1, seen: new Set([1]), sealed: false, sel: [], bag: "kraft", deco: "none", cover: null, title: "", blurb: "" },
  gift: { step: 1, seen: new Set([1]), sealed: false, sticker: null, bag: "airmail", deco: "none", to: "", note: "" },
};
const stDraftKey = "peta.studio";
function stLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(stDraftKey) || "null"); if(!d) return;
    const known = new Set(S.lib.map((e) => e.id));
    if(d.pack) { const p = ST.pack; p.sel = (d.pack.sel || []).filter((x) => known.has(x.id) && STUDIO.weights.includes(x.weight)).slice(0, STUDIO.limits.max); p.bag = PACK_BAG_IDS.includes(d.pack.bag) ? d.pack.bag : "kraft"; p.deco = ["none", "clip", "pin", "tape"].includes(d.pack.deco) ? d.pack.deco : "none";
      p.cover = p.sel.some((x) => x.id === d.pack.cover) ? d.pack.cover : null; p.title = stClip(String(d.pack.title || ""), STUDIO.limits.name); p.blurb = String(d.pack.blurb || "").slice(0, STUDIO.limits.blurb); }
    if(d.gift) { const g = ST.gift; g.sticker = known.has(d.gift.sticker) ? d.gift.sticker : null; g.bag = GIFT_BAG_IDS.includes(d.gift.bag) ? d.gift.bag : "airmail"; g.deco = ["none", "clip", "pin", "tape"].includes(d.gift.deco) ? d.gift.deco : "none";
      g.to = stClip(String(d.gift.to || ""), STUDIO.limits.to); g.note = String(d.gift.note || "").slice(0, STUDIO.limits.note); }
  } catch {}
}
function stSave() {
  const p = ST.pack, g = ST.gift;
  try { localStorage.setItem(stDraftKey, JSON.stringify({ pack: { sel: p.sel, bag: p.bag, deco: p.deco, cover: p.cover, title: p.title, blurb: p.blurb }, gift: { sticker: g.sticker, bag: g.bag, deco: g.deco, to: g.to, note: g.note } })); } catch {}
}
const stEntries = () => PetaMath.newestBookEntries(S.lib);
const stEntry = (id) => S.lib.find((e) => e.id === id);
const stDraft = () => (ST.mode === "gift" ? ST.gift : ST.pack);
/* a sticker's small picture for the bag and the tiles; the bench is drawn again when one arrives */
function stUrl(id) {
  if(ST.urls.has(id)) return ST.urls.get(id);
  ST.urls.set(id, null); const e = stEntry(id); if(!e) return null;
  thumbOf(e).then((res) => { ST.urls.set(id, res.url); if(S.page === "studio") Pages.studio.repaintBench?.(); }).catch(() => ST.urls.delete(id));
  return null;
}
/** The odds: an item's weight over all the weights. */
const stOdds = (sel) => { const sum = sel.reduce((s, x) => s + x.weight, 0) || 1; return sel.map((x) => x.weight / sum); };
const stPct = (v) => (v < .1 ? (v * 100).toFixed(1) : Math.round(v * 100)) + "%";
const stOddsLine = (sel) => { if(!sel.length) return ""; const odds = stOdds(sel), min = Math.min(...odds), same = Math.max(...odds) - min < 1e-9; return same ? `Every sticker has the same chance (1 in ${sel.length}).` : `The hardest to get comes out 1 time in ${Math.round(1 / min)}.`; };
const stName = () => S.name.trim() || "You";

/** What the bag on the bench looks like right now. */
function stBag({ k = 22, fit = 0, shut = false, open = true, d = stDraft(), mode = ST.mode } = {}) {
  if(mode === "gift") { const url = d.sticker ? stUrl(d.sticker) : null; return BagPic({ bag: d.bag, title: d.to.trim() ? "For " + d.to.trim() : "For you", sub: "from " + stName(), deco: d.deco, k, fit, shut, items: open && url ? [url] : [], id: "gift" }); }
  const urls = d.sel.map((x) => stUrl(x.id)).filter(Boolean), cover = d.cover ? stUrl(d.cover) : null;
  return BagPic({ bag: d.bag, title: d.title.trim() || "Untitled", sub: "by " + stName(), cover, deco: d.deco, k, fit, shut, items: open ? urls.slice(0, 6) : [], id: "pack" });
}

Pages.studio = {
  repaintBench: null,
  build() {
    const root = h("div.page-in.studiopage"); stLoad();
    const head = h("div.st-head"), work = h("div.st-work"), choose = h("div.st-choose");
    const bench = h("div.st-bench", h("div.st-ruler"), h("div.st-stage"), h("div.st-cap", h("span.l"), h("span.r")), h("i.st-flash")), panel = h("div.st-panel");
    work.append(bench, panel); root.append(head, choose, work);
    const stage = $(".st-stage", bench), capL = $(".l", bench), capR = $(".r", bench), ruler = $(".st-ruler", bench);
    for(let c = 0; c <= 15; c += 5) ruler.append(h("span", { style: { left: c * 18 + 4 + "px" } }, c === 0 ? "0" : String(c))); ruler.append(h("span.u", { style: { left: "292px" } }, "cm"));
    const D = () => stDraft(), count = () => (ST.mode === "gift" ? (ST.gift.sticker ? 1 : 0) : ST.pack.sel.length);
    const canGo = (to) => { const d = D(); if(to > 1 && (ST.mode === "gift" ? !d.sticker : d.sel.length < STUDIO.limits.min)) return false; if(to > 2 && !(ST.mode === "gift" ? d.to.trim() : d.title.trim())) return false; return true; };
    const go = (to) => { const d = D(); if(d.sealed || ST.sealing || !canGo(to)) return; d.step = to; d.seen.add(to); Snd.tap(); paint(); };
    const paintBench = () => {
      stage.replaceChildren(); if(!ST.mode) return;
      const d = D(), bag = BAGS[d.bag] || BAGS.kraft, pic = stBag({ k: 18, fit: 228, shut: d.sealed }); stage.append(h("div.st-tilt", pic));
      capL.textContent = `${count()} sticker${count() === 1 ? "" : "s"} · ${bag.name} · ${bag.cm}cm`; capR.textContent = d.sealed ? "Sealed ✓" : "Draft";
    };
    this.repaintBench = () => { if(root.isConnected) paintBench(); };
    bench.addEventListener("pointermove", (ev) => {
      const t = $(".st-tilt", bench); if(!t || ST.sealing || reduced()) return; const r = bench.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
      t.style.transform = `perspective(900px) rotateY(${(x - .5) * 14}deg) rotateX(${-(y - .5) * 10}deg)`; bench.style.setProperty("--shx", -(x - .5) * 22 + "px");
    });
    bench.addEventListener("pointerleave", () => { const t = $(".st-tilt", bench); if(t) t.style.transform = ""; });

    /* ---------- the header ---------- */
    const paintHead = () => {
      const d = ST.mode ? D() : null, names = STUDIO.steps[ST.mode || "pack"];
      const steps = ST.mode ? h("div.st-steps", { role: "tablist" }, names.map((n, i) => h("button", { role: "tab", disabled: d.sealed, class: d.seen.has(i + 1) && i + 1 !== d.step ? "done" : "", "aria-current": d.step === i + 1 ? "step" : "false", on: { click: () => go(i + 1) } }, h("b", String(i + 1)), n))) : null;
      head.replaceChildren(PageHead(ST.mode === "gift" ? "Gift Studio" : ST.mode === "pack" ? "Pack Studio" : "Studio", ST.mode ? (ST.mode === "gift" ? "Make · Gift" : "Make · Pack") : "Make"),
        h("div.st-head-r", ST.mode ? [h("button.btn.quiet.small", { on: { click: () => { if(ST.sealing) return; ST.mode = null; Snd.tap(); paint(); } } }, "← Change"), steps] : null));
    };

    /* ---------- the first choice ---------- */
    const paintChoose = () => {
      const card = (mode, title, text, who, art) => h("button.st-card", { on: { click: () => { ST.mode = mode; Snd.tap(); paint(); } } }, h("div.st-card-art", art), h("h3", title), h("p", text), h("span.st-for", who));
      const pic = (id, css) => { const b = BAGS[id]; return h("i", { style: { backgroundImage: `var(--a-${b.art})`, ...css } }); };
      choose.replaceChildren(h("div", h("h2", "What are you making?"), h("p.muted", "Both are three steps: choose what goes in, dress it, seal it. The difference is who it is for.")),
        h("div.st-cards", card("pack", "A Pack", `Collect ${STUDIO.limits.min}–${STUDIO.limits.max} stickers, decide how likely each one is, and put them in a wrapping. Every opening gives one at random.`, "For the Market and friends", [pic("kraft-parcel", { left: "6%", top: "18%", width: "34%", rotate: "-5deg" }), pic("glassine", { left: "33%", top: "8%", width: "34%" }), pic("cotton", { left: "58%", top: "20%", width: "36%", rotate: "5deg" })]),
          card("gift", "A Gift", "One sticker, a wrapping and a few words, for one person. They open it and it joins their Collection.", "For one person", [pic("airmail", { left: "4%", top: "26%", width: "62%", rotate: "-4deg" }), pic("glassine", { left: "52%", top: "36%", width: "40%", rotate: "4deg" })])));
    };

    /* ---------- the panels ---------- */
    const foot = (back, next) => h("div.st-foot", back ? h("button.btn.quiet", { on: { click: () => go(D().step - 1) } }, "Back") : h("span"), next);
    const nextBtn = (label, ok, fn) => h("button.btn", { disabled: !ok, on: { click: fn } }, label);
    const sec = (label, ...k) => h("div.st-sec", h("label", label), ...k);
    const field = (value, max, label, onInput, ph, em) => {
      const used = (v) => (em ? `${Math.ceil(stEm(v))}/${max}` : `${v.length}/${max}`), c = h("span.cnt", used(value));
      const i = h("input", { value, maxLength: em ? 40 : max, placeholder: ph || "", "aria-label": label, autocomplete: "off", spellcheck: false, on: { input: (e) => { if(em) e.target.value = stClip(e.target.value, max); onInput(e.target.value); c.textContent = used(e.target.value); } } });
      return h("div.st-field", i, c);
    };
    const bagPicker = (d, ids) => h("div.st-bags", ids.map((id) => h("button.st-bagt", { "aria-pressed": String(d.bag === id), title: BAGS[id].name, on: { click: () => { d.bag = id; stSave(); Snd.tap(); paint(); } } }, h("i", { style: { backgroundImage: `var(--a-${BAGS[id].art})` } }), h("span", BAGS[id].name))));
    const decoSeg = (d) => h("div.st-seg", STUDIO.decos.map(([k, n]) => h("button", { "aria-pressed": String(d.deco === k), on: { click: () => { d.deco = k; stSave(); Snd.tap(); paint(); } } }, n)));
    const tile = (e, props, extra, size = 56) => { const t = h("button.st-tile", { title: titleOf(e), ...props }, extra || null); thumbOf(e).then((res) => { if(t.isConnected) t.prepend(Stk.el(res, res.aspect >= 1 ? size : size * res.aspect)); }).catch(() => {}); return t; };

    const packGather = () => {
      const p = ST.pack, by = new Map(p.sel.map((x) => [x.id, x])), odds = stOdds(p.sel), n = p.sel.length;
      const tiles = stEntries().map((e) => {
        const it = by.get(e.id);
        const t = tile(e, { "aria-pressed": String(!!it), on: { click: () => { const at = p.sel.findIndex((x) => x.id === e.id); if(at >= 0) { p.sel.splice(at, 1); if(p.cover === e.id) p.cover = null; Snd.tap(); } else if(p.sel.length < STUDIO.limits.max) { p.sel.push({ id: e.id, weight: 4 }); Snd.tap(); } stSave(); paint(); } } },
          it ? h("span.st-weight", { role: "button", title: "How likely it is to come out: tap to change", "data-w": it.weight, on: { click: (ev) => { ev.stopPropagation(); it.weight = STUDIO.weights[(STUDIO.weights.indexOf(it.weight) + 1) % STUDIO.weights.length]; stSave(); Snd.tap(); paint(); } } }, stPct(odds[p.sel.indexOf(it)])) : null);
        return t;
      });
      return [h("h2", "Choose the stickers"), h("p.st-help", `${STUDIO.limits.min}–${STUDIO.limits.max} stickers. Tap the percentage on a chosen one to change how likely it is to come out.`),
        h("div.st-count", h("b", String(n)), h("span", `of ${STUDIO.limits.max} · at least ${STUDIO.limits.min}`)),
        h("div.st-odds", n >= STUDIO.limits.min ? stOddsLine(p.sel) : `${STUDIO.limits.min - n} more to go`),
        h("div.st-scroll", tiles.length ? h("div.st-grid", tiles) : h("p.muted", "Your Collection is empty. Make a few stickers first.")),
        foot(false, nextBtn("Next →", n >= STUDIO.limits.min, () => go(2)))];
    };
    const packDress = () => {
      const p = ST.pack, covers = h("div.st-covers", h("button.st-cv.none", { "aria-pressed": String(!p.cover), on: { click: () => { p.cover = null; stSave(); paint(); } } }, "None"),
        p.sel.map((x) => { const e = stEntry(x.id); return e ? tile(e, { class: "st-cv", "aria-pressed": String(p.cover === x.id), on: { click: () => { p.cover = x.id; stSave(); Snd.tap(); paint(); } } }, null, 34) : null; }));
      return [h("h2", "Dress the pack"), h("p.st-help", "Just choose. Each wrapping has its own places for the label, the cover sticker and the decoration."),
        h("div.st-scroll", sec("Wrapping", bagPicker(p, PACK_BAG_IDS)), sec("Name", field(p.title, STUDIO.limits.name, "Pack name", (v) => { p.title = v; stSave(); paintBench(); const b = $(".st-foot .btn:not(.quiet)", panel); if(b) b.disabled = !p.title.trim(); }, "", true)),
          sec("Cover sticker", covers), sec("Decoration", decoSeg(p))),
        foot(true, nextBtn("Next →", !!p.title.trim(), () => go(3)))];
    };
    const sealScenes = () => {
      const d = D(), bag = BAGS[d.bag];
      const wrap = (caption, scene) => h("div", scene, h("div.st-scap", caption));
      if(ST.mode === "gift") {
        const a = stBag({ k: 9.5, shut: true, open: false }); a.style.cssText += "left:50%;top:30px;translate:-50% 0;";
        const url = d.sticker ? stUrl(d.sticker) : null;
        return h("div.st-pair", wrap("Arrives", h("div.st-scene", a, h("span.st-small", `A gift from ${stName()}`))),
          wrap("Opened", h("div.st-scene", h("div.st-note", h("div.to", "To " + (d.to.trim() || "you") + ","), url ? h("img", { src: url, alt: "" }) : null, h("div.msg", d.note), h("div.from", `from ${stName()}`)))));
      }
      const stand = bag.show === "stand", a = stBag({ k: 9.5, shut: true, open: false }), c = stBag({ k: 9.5, shut: true, open: false });
      a.style.cssText += "left:50%;bottom:22px;translate:-50% 0;transform-origin:50% 100%;";
      const shelf = h("div.st-scene", a, h("div.st-plank"), h("span.st-count-hand", `${d.sel.length} left`));
      let market;
      if(stand) { c.style.cssText += "left:50%;bottom:22px;translate:-50% 0;transform-origin:50% 100%;"; market = h("div.st-scene", c, h("div.st-plank"), h("span.st-small.top", "Free")); }
      else { c.style.cssText += "left:50%;top:46px;translate:-50% 0;"; market = h("div.st-scene", h("div.st-rod"), h("i.st-endl"), h("i.st-endr"), c, h("i.st-rclip", { style: { left: "50%", top: "16px", translate: "-50% 0" } }), h("span.st-small", "Free")); }
      return h("div.st-pair", wrap("Shelf", shelf), wrap(stand ? "Market · standing" : "Market · hanging", market));
    };
    const packSeal = () => {
      const p = ST.pack;
      if(p.sealed) return [doneBlock("pack"), sealScenes()];
      return [h("h2", "Check it, then seal it"), h("p.st-help", "How it looks on your shelf and in the Market. Once sealed, it is signed with your key and can't be changed."),
        h("div.st-scroll", sealScenes(), sec("Description (shown on the Market card)", field(p.blurb, STUDIO.limits.blurb, "Description", (v) => { p.blurb = v; stSave(); })),
          h("div.st-signed", h("i", "SIGN"), `${p.title.trim()} · ${p.sel.length} stickers · ${stOddsLine(p.sel)}`)),
        foot(true, nextBtn("Seal the pack", true, seal))];
    };
    const giftChoose = () => {
      const g = ST.gift, tiles = stEntries().map((e) => tile(e, { "aria-pressed": String(g.sticker === e.id), on: { click: () => { g.sticker = e.id; stSave(); Snd.tap(); paint(); } } }));
      return [h("h2", "Choose the sticker"), h("p.st-help", "One sticker. You give a copy; yours stays in your Collection."), h("div.st-scroll", tiles.length ? h("div.st-grid", tiles) : h("p.muted", "Your Collection is empty. Make a sticker first.")), foot(false, nextBtn("Next →", !!g.sticker, () => go(2)))];
    };
    const giftDress = () => {
      const g = ST.gift;
      const note = h("textarea", { rows: 2, maxLength: STUDIO.limits.note, "aria-label": "Note", on: { input: (e) => { g.note = e.target.value; cnt.textContent = `${g.note.length}/${STUDIO.limits.note}`; stSave(); } } }, g.note), cnt = h("span.cnt", `${g.note.length}/${STUDIO.limits.note}`);
      return [h("h2", "Dress the gift"), h("p.st-help", "Choose a wrapping, write who it is for, and a few words only they will see."),
        h("div.st-scroll", sec("Wrapping", bagPicker(g, GIFT_BAG_IDS)), sec("To", field(g.to, STUDIO.limits.to, "To", (v) => { g.to = v; stSave(); paintBench(); const b = $(".st-foot .btn:not(.quiet)", panel); if(b) b.disabled = !g.to.trim(); }, "Who is it for?", true)),
          sec("A few words", h("div.st-field", note, cnt)), sec("Decoration", decoSeg(g))),
        foot(true, nextBtn("Next →", !!g.to.trim(), () => go(3)))];
    };
    const giftSeal = () => {
      const g = ST.gift;
      if(g.sealed) return [doneBlock("gift"), sealScenes()];
      return [h("h2", "Check it, then seal it"), h("p.st-help", "How it looks when it arrives and when it is opened. Once sealed, it can't be changed."),
        h("div.st-scroll", sealScenes(), h("div.st-signed", h("i", "SIGN"), `For ${g.to.trim()} · 1 sticker · your photo is never inside`)), foot(true, nextBtn("Seal the gift", true, seal))];
    };
    const doneBlock = (kind) => {
      const again = () => { if(kind === "pack") Object.assign(ST.pack, { step: 1, seen: new Set([1]), sealed: false, sel: [], cover: null, title: "", blurb: "" }); else Object.assign(ST.gift, { step: 1, seen: new Set([1]), sealed: false, sticker: null, to: "", note: "" }); stSave(); Snd.tap(); paint(); };
      const msg = (t) => { const m = h("div.st-toast", t); root.append(m); setTimeout(() => m.remove(), 2200); };
      const act = (label, fn, cls = "") => h("button.btn" + cls, { on: { click: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { await fn(msg); } catch(err) { Shell.toast(Distribution?.error ? Distribution.error(err) : String(err)); } finally { b.disabled = false; } } } }, label);
      const actions = kind === "pack"
        ? [act("Save pack file…", async (m) => { const path = await Bridge.invoke("creator_pack_save", packArgs()); if(path) { Snd.chime(2, 740); m("Saved."); } }),
           act("Put on my shelf", async (m) => { await Bridge.invoke("creator_pack_shelve", packArgs()); await Bridge.reload(); Shell.renderNav(); Snd.chime(2, 740); m("It's on your Packs shelf."); }, ".paper")]
        : [act("Save gift file…", async (m) => { const sent = await Bridge.invoke("gift_send", giftArgs()); if(sent) { await Bridge.reload(); Snd.chime(2, 740); m("Saved."); } })];
      return h("div.st-done", h("h2", kind === "pack" ? `Sealed. ${ST.pack.title.trim()} · ${ST.pack.sel.length} stickers` : `Sealed. For ${ST.gift.to.trim()}`), h("p.muted", kind === "pack" ? "Save the file to share it, or put it on your own shelf." : "Save the file and send it any way you like."),
        h("div.st-done-actions", ...actions, h("button.btn.quiet", { on: { click: again } }, "Make another")));
    };
    const packArgs = () => { const p = ST.pack; return { title: p.title.trim(), pouch: p.bag, items: p.sel.map((x) => ({ stickerId: x.id, name: titleOf(stEntry(x.id)), weight: x.weight })), dress: { cover: p.cover || null, deco: p.deco === "none" ? null : p.deco, blurb: p.blurb.trim() || null } }; };
    const giftArgs = () => { const g = ST.gift; return { stickerId: g.sticker, to: g.to.trim(), note: g.note.trim() || null, dress: { bag: g.bag, deco: g.deco === "none" ? null : g.deco } }; };

    /* ---------- sealing: every wrapping closes its own way ---------- */
    const seal = async () => {
      if(ST.sealing) return; const d = D(); ST.sealing = true;
      const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 1 : ms)), tilt = $(".st-tilt", bench); if(tilt) tilt.style.transform = "";
      const open = BAGS[d.bag]; const p = $(".bagpic", bench);
      try { if(p) await StudioSeal.run(p, open, bench, wait); } catch {}
      const st = h("div.st-stamp", "SEALED"); bench.append(st); st.animate([{ opacity: 0, transform: "scale(2.2)" }, { opacity: .9, transform: "scale(.94)", offset: .6 }, { opacity: .85, transform: "scale(1)" }], { duration: reduced() ? 1 : 360, easing: "ease-out", fill: "forwards" }); Snd.tap(); await wait(700); Snd.chime(2, 880);
      d.sealed = true; ST.sealing = false; paint(); setTimeout(() => st.remove(), 400);
    };

    const paintPanel = () => {
      if(!ST.mode) { panel.replaceChildren(); return; }
      const n = D().step, body = (ST.mode === "gift" ? [giftChoose, giftDress, giftSeal] : [packGather, packDress, packSeal])[n - 1]();
      panel.replaceChildren(...[].concat(body));
    };
    const paint = () => { const on = !!ST.mode; work.hidden = !on; choose.hidden = on; paintHead(); if(on) { paintBench(); paintPanel(); } else paintChoose(); };
    paint(); return root;
  },
};

/* The sealing ceremonies. A press for the foil, tape for the paper bags, a round seal for glassine and the folded wrap, a thumb along the flap for
   envelopes, the string pulled tight on the cotton pouch, the sleeve pushed over the drawer. */
const StudioSeal = {
  async run(p, bag, bench, wait) {
    const t = bag.seal, dur = (ms) => (reduced() ? 1 : ms), mk = (cls, css) => { const e = h("div." + cls); Object.assign(e.style, css); p.append(e); return e; };
    const squash = () => p.animate([{ transform: "scale(1)" }, { transform: "scale(.975,.955) translateY(5px)" }, { transform: "scale(1.012)" }, { transform: "scale(1)" }], { duration: dur(420), easing: "ease-out" });
    const thumb = async (x, y, w, x2) => { const th = mk("bp-thumb", { left: x + "%", top: y + "%", width: w + "%" }); th.animate([{ opacity: 0 }, { opacity: 1, offset: .15 }, { left: (x2 ?? x) + "%", opacity: 1, offset: .85 }, { left: (x2 ?? x) + "%", opacity: 0 }], { duration: dur(520), easing: "ease-in-out", fill: "both" }); await wait(420); squash(); await wait(120); th.remove(); };
    const tapeRect = bag.tape || [12, 5.5, 76, 8, -1.5];
    if(t === "press") {
      const press = h("div.st-press"); p.append(press);
      press.animate([{ transform: "translateY(-140%)" }, { transform: "translateY(62%)" }], { duration: dur(520), easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" }); await wait(500);
      Snd.seal(); squash(); $(".st-flash", bench).animate([{ opacity: 0 }, { opacity: .75 }, { opacity: 0 }], { duration: dur(520) });
      await wait(380); press.animate([{ transform: "translateY(62%)" }, { transform: "translateY(-140%)" }], { duration: dur(460), easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" }); await wait(300);
    } else if(t === "tape") {
      const tp = h("i.bp-tape.cream"); const [tx, ty, tw, th, tr] = tapeRect; Object.assign(tp.style, { left: tx + "%", top: ty + "%", width: tw + "%", height: th + "%", rotate: tr + "deg" }); p.append(tp);
      tp.animate([{ opacity: 0, transform: "translateY(-70px) rotate(8deg)" }, { opacity: 1, transform: "translateY(0) rotate(0)" }], { duration: dur(320), easing: "cubic-bezier(.5,0,.8,.5)", fill: "both" }); Snd.crinkle(3, .15); await wait(340);
      await thumb(tx + 6, ty + th / 2, Math.max(9, tw * .22), tx + tw - 8); await wait(150);
    } else if(t === "seal") {
      const [cx, cy, cs] = bag.cover, disc = mk("bp-disc", { left: cx + "%", top: cy + "%", width: cs * .92 + "%", background: bag.disc });
      disc.animate([{ opacity: 0, transform: "translate(-50%,-50%) translateY(-50px) scale(1.5)" }, { opacity: 1, transform: "translate(-50%,-50%) scale(1)" }], { duration: dur(300), easing: "cubic-bezier(.4,0,.9,.5)", fill: "both" }); await wait(300);
      Snd.tap(); await thumb(cx, cy, cs * 1.4); await wait(120); disc.remove();
    } else if(t === "sweep") { const [tx, ty, tw, th] = tapeRect; Snd.crinkle(4, .25); await thumb(tx + 4, ty + th / 2, 13, tx + tw - 4); await wait(200); }
    else if(t === "string") {
      const f = $(".bp-fan", p); if(f) f.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(45%)", opacity: 0 }], { duration: dur(420), easing: "ease-in", fill: "both" });
      Snd.crinkle(4, .25); await wait(220); p.animate([{ transform: "scale(1)" }, { transform: "scale(.955,1.03)" }, { transform: "scale(1)" }], { duration: dur(560), easing: "ease-in-out" });
      const kn = mk("bp-knot", { left: "50%", top: bag.pin[1] + "%" }); kn.animate([{ transform: "translate(-50%,-50%) scale(0)" }, { transform: "translate(-50%,-50%) scale(1.25)", offset: .6 }, { transform: "translate(-50%,-50%) scale(1)" }], { duration: dur(420), easing: "ease-out", fill: "both" }); await wait(560); kn.remove();
    } else if(t === "slide") {
      $(".bp-art", p).style.opacity = 0; const f = $(".bp-fan", p); if(f) f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur(160), fill: "both" });
      const box = h("div.bp-drbox"), sl = h("div.bp-drsleeve"); box.style.transform = "translateX(0)"; p.append(box, sl); await wait(120); Snd.crinkle(3, .2);
      box.animate([{ transform: "translateX(0)" }, { transform: "translateX(-29%)" }], { duration: dur(720), easing: "cubic-bezier(.3,.1,.2,1)", fill: "both" }); await wait(740); squash(); await wait(160);
    }
  },
};

/** Open Studio from elsewhere (the Collection's "Make a Pack…" and "Gift…"): `sticker` is chosen already. */
function StudioOpen(mode, sticker) {
  stLoad(); ST.mode = mode;
  if(sticker) { if(mode === "gift") Object.assign(ST.gift, { sticker, step: 1, sealed: false }); else if(!ST.pack.sel.some((x) => x.id === sticker)) ST.pack.sel.push({ id: sticker, weight: 4 }); }
  Shell.go("studio");
}
