/* Studio: make a Pack (for the Market and friends) or a Gift (for one person). Both are three steps: what goes in, how it looks, seal it.
   Nothing is placed freely. A pack or a gift is a handful of IDs (the wrapping, the cover, one decoration) plus a few words; where each
   thing sits is fixed per wrapping (js/catalog.js BAGS), so every combination looks right and the same on every screen. */
const STUDIO = {
  limits: { min: 3, max: 24, name: 14, blurb: 60, to: 14, note: 80 },   // name / to are measured in full-width characters
  decos: [["none", "None"], ["clip", "Clip"], ["pin", "Pin"], ["tape", "Tape"]],
  steps: { pack: ["Gather", "Dress", "Seal"], gift: ["Choose", "Dress", "Seal"] },
};
const stEm = (text) => [...text].reduce((s, c) => s + (c.charCodeAt(0) > 255 ? 1 : .55), 0);
const stClip = (text, max) => { let v = text; while (stEm(v) > max) v = v.slice(0, -1); return v; };

const ST = {
  mode: null, sealing: false, urls: new Map(), urlRequests: new Map(), ctx: "shelf", find: { q: "", mat: "all" }, view: "pack", open: null, chances: false,
  pack: { step: 1, seen: new Set([1]), sealed: false, dest: "shelf", result: null, sel: [], prizes:[], bag: "kraft", deco: "none", layout: { comp: "corner", label: null, cover: null, accents: [] }, cover: null, title: "", blurb: "" },
  gift: { step: 1, seen: new Set([1]), sealed: false, result: null, sticker: null, bag: "airmail", deco: "none", to: "", note: "" },
};
const stCopyMax = e => e?.canPress ? S.packLimits.copiesPerDesign : 1;
const stSlots = p => p.sel.reduce((sum,x)=>sum+x.copies,0)+(p.prizes || []).reduce((sum,x)=>sum+x.count,0);
function stCleanPrizes(prizes, copies) {
  const out=[], seen=new Set(); let room=Math.max(0,Math.min(S.packLimits.prizes,S.packLimits.packSlots-copies));
  for(const x of Array.isArray(prizes) ? prizes : []) {
    if(!x || !Number.isInteger(x.count) || x.count<=0)continue;
    const tag=x.kind==="tag", material=x.kind==="material" && MAT[x.materialId];
    if(!tag && !material)continue;
    const key=tag ? "tag" : `material:${x.materialId}`;
    if(seen.has(key))continue;seen.add(key);
    const stock=tag ? S.tagStock?.available || 0 : S.prizeStock?.[x.materialId] || 0;
    const count=Math.min(x.count,stock,room);
    if(count>0){out.push(tag ? {kind:"tag",count} : {kind:"material",materialId:x.materialId,count});room-=count;}
  }
  return out;
}
const stDraftKey = "peta.studio";
function stLoad() {
  if(ST.sealing)return;
  try {
    const d = JSON.parse(localStorage.getItem(stDraftKey) || "null"); if(!d) return;
    const known = new Set(S.lib.filter(e => e.lineage !== "copy").map((e) => e.id));
    if(d.pack&&!ST.pack.sealed) { const p = ST.pack; p.sel = (Array.isArray(d.pack.sel)?d.pack.sel:[]).filter((x) => x && known.has(x.id) && !stEntry(x.id)?.pressed && Number.isInteger(x.copies) && x.copies >= 1 && x.copies <= stCopyMax(stEntry(x.id))).slice(0, STUDIO.limits.max); p.bag = PACK_BAG_IDS.includes(d.pack.bag) ? d.pack.bag : "kraft"; p.deco = ["none", "clip", "pin", "tape"].includes(d.pack.deco) ? d.pack.deco : "none";
      p.prizes=stCleanPrizes(d.pack.prizes,p.sel.reduce((n,x)=>n+x.copies,0));
      p.layout = stCleanLayout(d.pack.layout, p.bag);
      p.cover = p.sel.some((x) => x.id === d.pack.cover && stEntry(x.id)?.canPress) ? d.pack.cover : null; p.title = stClip(String(d.pack.title || ""), STUDIO.limits.name); p.blurb = String(d.pack.blurb || "").slice(0, STUDIO.limits.blurb); }
    if(d.gift&&!ST.gift.sealed) { const g = ST.gift; g.sticker = known.has(d.gift.sticker) ? d.gift.sticker : null; g.bag = GIFT_BAG_IDS.includes(d.gift.bag) ? d.gift.bag : "airmail"; g.deco = ["none", "clip", "pin", "tape"].includes(d.gift.deco) ? d.gift.deco : "none";
      g.to = stClip(String(d.gift.to || ""), STUDIO.limits.to); g.note = String(d.gift.note || "").slice(0, STUDIO.limits.note); }
  } catch {}
}
function stSave() {
  const p = ST.pack, g = ST.gift;
  try { localStorage.setItem(stDraftKey, JSON.stringify({ ...(p.sealed?{}:{pack: { sel: p.sel, prizes:p.prizes, bag: p.bag, deco: p.deco, layout: p.layout, cover: p.cover, title: p.title, blurb: p.blurb }}), ...(g.sealed?{}:{gift: { sticker: g.sticker, bag: g.bag, deco: g.deco, to: g.to, note: g.note }}) })); } catch {}
}
/** A saved layout, made safe: a known composition, places that are numbers, at most two different accents. The picture clamps the places again when it draws. */
function stCleanLayout(l, bagId) {
  const out = { comp: "corner", label: null, cover: null, accents: [] }; if(!l || typeof l !== "object") return out;
  if(PetaMath.BAG_COMPOSITIONS.includes(l.comp) || l.comp === "free") out.comp = l.comp;
  const spot = (v) => (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n)) ? [v[0], v[1]] : null);
  out.label = spot(l.label); out.cover = spot(l.cover);
  for(const a of Array.isArray(l.accents) ? l.accents : []) if(out.accents.length < PetaMath.BAG_MAX_ACCENTS && PetaMath.BAG_ACCENTS.includes(a?.kind) && !out.accents.some((x) => x.kind === a.kind) && Number.isFinite(a.x) && Number.isFinite(a.y)) out.accents.push({ kind: a.kind, x: a.x, y: a.y });
  return out;
}
/** Another wrapping has other places: the label and the cover go back to the composition's, and each accent to the place its wrapping gives it. */
function stResetPlaces(p) {
  const bag = BAGS[p.bag]; p.layout.cover = null;
  p.layout.accents = p.layout.accents.map((a) => { const [x, y] = PetaMath.bagAccentDefault(bag, a.kind); return { kind: a.kind, x, y }; });
}
/** What goes to Rust: every place resolved and clamped, the first accent also as the old single decoration. */
function stLayoutArgs(p) {
  const r = PetaMath.bagResolveLayout(BAGS[p.bag], p.layout);
  return { comp: r.comp, label: null, cover: p.cover ? r.cover : null, accents: r.accents };
}
/** Dress step: the cover sticker and the accents on the bench can be dragged (or moved with the arrow keys). Every move is clamped to the wrapping, so nothing can be
 *  put outside it. The label is printed on the wrapping: it stays, and cannot be taken off. `note` is called when a move is done. */
function stEdit(pic, p, note) {
  const bag = BAGS[p.bag], names = { cover: "The cover sticker", clip: "The clip", pin: "The pin", tape: "The tape", seal: "The wax seal" };
  const posOf = (el) => { const r = PetaMath.bagResolveLayout(bag, p.layout); if(el.dataset.part === "cover") return r.cover; const a = r.accents.find((x) => x.kind === el.dataset.kind); return a ? [a.x, a.y] : null; };
  const store = (el, part, pos) => {
    const at = PetaMath.bagClampPart(bag, part, pos);
    if(p.layout.comp !== "free") { p.layout.cover = PetaMath.bagResolveLayout(bag, p.layout).cover; p.layout.comp = "free"; }   // from now on the places are the maker's own: keep where the cover is
    if(part === "cover") p.layout.cover = at;
    else { const a = p.layout.accents.find((x) => x.kind === part); if(a) { a.x = at[0]; a.y = at[1]; } }
    bagPlace(el, bag, part, at);
  };
  for(const el of pic.querySelectorAll("[data-part]")) {
    const part = el.dataset.kind || el.dataset.part; el.tabIndex = 0; el.setAttribute("role", "button"); el.setAttribute("aria-label", `${names[part]}: drag it, or use the arrow keys`);
    el.addEventListener("pointerdown", (ev) => {
      if(ev.button) return; ev.preventDefault(); ev.stopPropagation();
      const box = pic.getBoundingClientRect(), from = posOf(el), x0 = ev.clientX, y0 = ev.clientY; if(!from) return;
      el.setPointerCapture(ev.pointerId); el.classList.add("grab");
      const move = (e) => store(el, part, [from[0] + (e.clientX - x0) / box.width * 100, from[1] + (e.clientY - y0) / box.height * 100]);
      const up = () => { el.classList.remove("grab"); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); stSave(); note(); };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    });
    el.addEventListener("keydown", (ev) => {
      const step = ev.shiftKey ? 5 : 1, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key]; if(!d) return;
      ev.preventDefault(); const f = posOf(el); if(!f) return; store(el, part, [f[0] + d[0], f[1] + d[1]]); stSave(); note();
    });
  }
}
const stEntries = () => PetaMath.newestBookEntries(S.lib).filter(e => e.lineage !== "copy");
const stEntry = (id) => S.lib.find((e) => e.id === id);
const stDraft = () => (ST.mode === "gift" ? ST.gift : ST.pack);
/* a sticker's small picture for the bag and the tiles; the bench is drawn again when one arrives */
function stUrl(id) {
  if(ST.urls.has(id)) return ST.urls.get(id);
  const e = stEntry(id); if(!e) return null;ST.urls.set(id, null);
  const request=Symbol();ST.urlRequests.set(id,request);
  thumbOf(e).then((res) => { if(ST.urlRequests.get(id)!==request)return; ST.urls.set(id, res.url); if(S.page === "studio") Pages.studio.repaintBench?.(); }).catch(() => {if(ST.urlRequests.get(id)===request)ST.urls.delete(id);});
  return null;
}
/** What was just sealed is made: its draft does not come back when Studio is opened again. */
function stForget(kind) { try { const d = JSON.parse(localStorage.getItem(stDraftKey) || "{}"); delete d[kind]; localStorage.setItem(stDraftKey, JSON.stringify(d)); } catch {} }
/** Record a successful native save before fetching any UI state. A refresh failure never repeats the transfer or press. */
async function stCommitSeal(mode,d,args) {
  const busy=!!Bridge.busy;Bridge.busy=true;
  try {
    let result;
    if(mode==='gift') {
      if(!await stConfirmTransfer())return null;
      const sent=await Bridge.fileDialog('gift_send',args);if(!sent)return null;
      result={where:'file',path:sent.savedTo};
    } else if(d.dest==='file') {
      const saved=await Bridge.fileDialog('creator_pack_save',args);if(!saved)return null;
      result={where:'file',path:saved.path,packId:saved.packId};
    } else result={where:'shelf',packId:await Bridge.invoke('creator_pack_shelve',args)};
    d.sealed=true;d.result=result;stForget(mode);
    try {await Bridge.reload();Shell.renderNav();} catch {Shell.toast('Sealed and saved. The display could not refresh.');}
    return result;
  } finally {Bridge.busy=busy;}
}
/** The stickers the pickers show: the search and the material (or "On desktop") above the list. */
const stShown = () => { const f = ST.find; return PetaMath.filterBookEntries(stEntries(), { query: f.q, material: f.mat, sort: "newest", materialIds: Object.keys(MAT), nameOf: (id) => MAT[id]?.name || id }); };
function stFind(fill) {
  const f = ST.find, counts = {}; for(const e of S.lib) counts[e.material] = (counts[e.material] || 0) + 1;
  const onDesk = S.lib.filter((e) => e.onDesktop).length;
  if(f.mat !== "all" && !(f.mat === "desktop" ? onDesk : counts[f.mat])) f.mat = "all";
  const input = h("input", { type: "search", placeholder: "Search stickers", value: f.q, autocomplete: "off", spellcheck: false, "aria-label": "Search stickers", on: { input: () => { f.q = input.value; fill(); } } });
  const options = [["all", "All materials"], ...(onDesk ? [["desktop", `On desktop (${onDesk})`]] : []), ...Object.keys(MAT).filter((id) => counts[id]).map((id) => [id, `${MAT[id].name} (${counts[id]})`])];
  const select = h("select", { "aria-label": "Material", on: { change: () => { f.mat = select.value; Snd.tap(); fill(); } } }, options.map(([v, t]) => h("option", { value: v, selected: v === f.mat }, t)));
  return h("div.st-findwrap", h("div.st-find", h("label.st-search", input), h("label.st-selectw", select)));
}

/** Display odds from remaining copies and prize slots. */
const stOdds = (sel, prizes = []) => { const sum = sel.reduce((s, x) => s + x.copies, 0) + prizes.reduce((s,x)=>s+x.count,0) || 1; return sel.map((x) => x.copies / sum); };
const stPct = (v) => (v < .1 ? (v * 100).toFixed(1) : Math.round(v * 100)) + "%";
const stOddsLine = (sel, prizes = []) => { if(!sel.length) return ""; return `${sel.reduce((s,x)=>s+x.copies,0)} editions · ${prizes.reduce((s,x)=>s+x.count,0)} prizes · Chances follow the remaining slots.`; };
const stName = () => S.name.trim() || "You";

/** What the bag on the bench looks like right now. */
function stBag({ k = 22, fit = 0, shut = false, open = false, d = stDraft(), mode = ST.mode } = {}) {   // the stickers are not shown peeking out of the bag: the count is in the caption
  if(mode === "gift") { const url = d.sticker ? stUrl(d.sticker) : null; return BagPic({ bag: d.bag, title: d.to.trim() ? "For " + d.to.trim() : "For you", sub: "from " + stName(), deco: d.deco, k, fit, shut, items: open && url ? [url] : [], id: "gift" }); }
  const urls = d.sel.map((x) => stUrl(x.id)).filter(Boolean), cover = d.cover ? stUrl(d.cover) : null;
  return BagPic({ bag: d.bag, title: d.title.trim() || "Untitled", sub: "by " + stName(), cover, layout: d.layout, k, fit, shut, items: open ? urls.slice(0, 6) : [], id: "pack" });
}

Pages.studio = {
  invalidateAsset(id) { ST.urls.delete(id); ST.urlRequests.delete(id); },
  repaintBench: null,
  build() {
    const root = h("div.page-in.studiopage"); stLoad();
    const head = h("div.st-head"), work = h("div.st-work"), choose = h("div.st-choose");
    const bench = h("div.st-bench", h("div.st-views"), h("div.st-stage"), h("div.st-cap"), h("i.st-flash")), panel = h("div.st-panel");
    work.append(bench, panel); root.append(head, choose, work);
    const stage = $(".st-stage", bench), cap = $(".st-cap", bench), views = $(".st-views", bench);
    const D = () => stDraft(), count = () => (ST.mode === "gift" ? (ST.gift.sticker ? 1 : 0) : ST.pack.sel.length);
    const canGo = (to) => { const d = D(); if(to > 1 && (ST.mode === "gift" ? !d.sticker : d.sel.length < STUDIO.limits.min)) return false; if(to > 2 && !(ST.mode === "gift" ? d.to.trim() : d.title.trim())) return false; return true; };
    const go = (to) => { const d = D(); if(d.sealed || ST.sealing || !canGo(to)) return; ST.enter = to !== d.step; if(to !== d.step) { ST.open = null; ST.chances = false; ST.view = "pack"; } d.step = to; d.seen.add(to); Snd.tap(); paint(); };
    const VIEWS = { pack: [["pack", "Pack"], ["shelf", "Shelf"], ["market", "Market"]], gift: [["pack", "Gift"], ["arrives", "Arrives"], ["opened", "Opened"]] };
    /* what the left side shows on the last step: the wrapped thing itself, or where it will be seen (the shelf and the Market for a pack; arriving and opened for a gift) */
    const scene = (kind) => {
      const d = D(), bag = BAGS[d.bag], k = 18, put = (el, css) => { el.style.cssText += css; return el; };
      if(ST.mode === "gift") {
        if(kind === "arrives") return h("div.st-scene.big", put(stBag({ k, shut: true, open: false }), "left:50%;top:34%;translate:-50% 0;"), h("span.st-small", `A gift from ${stName()}`));
        const url = d.sticker ? stUrl(d.sticker) : null;
        return h("div.st-scene.big", h("div.st-note", h("div.to", "To " + (d.to.trim() || "you") + ","), url ? h("img", { src: url, alt: "" }) : null, h("div.msg", d.note), h("div.from", `from ${stName()}`)));
      }
      const stand = bag.show === "stand", pic = stBag({ k, shut: true, open: false });
      if(kind === "shelf") return h("div.st-scene.big", put(pic, "left:50%;bottom:34px;translate:-50% 0;transform-origin:50% 100%;"), h("div.st-plank"), h("span.st-count-hand", `${d.sel.length} left`));
      if(stand) return h("div.st-scene.big", put(pic, "left:50%;bottom:34px;translate:-50% 0;transform-origin:50% 100%;"), h("div.st-plank"), h("span.st-small.top", "Free"));
      return h("div.st-scene.big", h("div.st-rod"), h("i.st-endl"), h("i.st-endr"), put(pic, "left:50%;top:15%;translate:-50% 0;"), h("i.st-rclip", { style: { left: "50%", top: "9%", translate: "-50% 0" } }), h("span.st-small", "Free"));
    };
    const paintBench = () => {
      stage.replaceChildren(); views.replaceChildren(); if(!ST.mode) return;
      const d = D(), bag = BAGS[d.bag] || BAGS.kraft, last = d.step === 3 && !d.sealed;
      if(!last) ST.view = "pack";
      if(last && !ST.sealing) views.append(...VIEWS[ST.mode].map(([k, n]) => h("button", { type: "button", "aria-pressed": String(ST.view === k), on: { click: () => { ST.view = k; Snd.tap(); paintBench(); } } }, n)));
      stage.classList.toggle("scene", last && ST.view !== "pack");
      const note = () => `${count()} sticker${count() === 1 ? "" : "s"} · ${bag.name}${d.sealed ? " · Sealed ✓" : ""}`;
      if(last && ST.view !== "pack") stage.append(scene(ST.view));
      else {
        /* the wrapped thing is as large as the stage allows (its own proportions decide which side limits it) */
        const [bx0, by0, bx1, by1] = bag.body, ratio = ((by1 - by0) * bag.H) / ((bx1 - bx0) * bag.W), box = stage.getBoundingClientRect();
        const fit = box.width > 40 && box.height > 40 ? Math.max(160, Math.min(box.width * .82, box.height * .9 / ratio, 360)) : 250;
        if(fit === 250 && !stage.dataset.sized) { stage.dataset.sized = "1"; requestAnimationFrame(() => { delete stage.dataset.sized; if(root.isConnected) paintBench(); }); }
        const pic = stBag({ k: 40, fit, shut: d.sealed }); stage.append(h("div.st-tilt", pic));
        const editing = ST.mode === "pack" && d.step === 2 && !d.sealed && !ST.sealing; stage.classList.toggle("editing", editing); bench.classList.toggle("editing", editing);
        if(editing) stEdit(pic, d, () => { cap.textContent = note(); });
      }
      cap.textContent = note();
    };
    this.repaintBench = () => { if(root.isConnected) paintBench(); };
    bench.addEventListener("pointermove", (ev) => {
      const t = $(".st-tilt", bench); if(!t || ST.sealing || reduced() || bench.classList.contains("editing")) return; const r = bench.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
      t.style.transform = `perspective(900px) rotateY(${(x - .5) * 14}deg) rotateX(${-(y - .5) * 10}deg)`; bench.style.setProperty("--shx", -(x - .5) * 22 + "px");
    });
    bench.addEventListener("pointerleave", () => { const t = $(".st-tilt", bench); if(t) t.style.transform = ""; });

    /* ---------- the header ---------- */
    const paintHead = () => {
      const d = ST.mode ? D() : null, names = STUDIO.steps[ST.mode || "pack"];
      const steps = ST.mode ? h("div.st-steps", { role: "group", "aria-label": "Steps" }, names.map((n, i) => h("button", { type: "button", disabled: d.sealed, "aria-pressed": String(d.step === i + 1), "aria-label": `Step ${i + 1}: ${n}`, class: d.seen.has(i + 1) && i + 1 !== d.step ? "done" : "", on: { click: () => go(i + 1) } }, h("b", String(i + 1)), n))) : null;
      head.replaceChildren(PageHead(ST.mode === "gift" ? "Gift Studio" : ST.mode === "pack" ? "Pack Studio" : "Studio", ST.mode ? (ST.mode === "gift" ? "Make · Gift" : "Make · Pack") : "Make"),
        h("div.st-head-r", ST.mode ? [h("button.btn.quiet.small", { on: { click: () => { if(ST.sealing) return; ST.mode = null; Snd.tap(); paint(); } } }, "← Change"), steps] : null));
    };

    /* ---------- the first choice ---------- */
    const paintChoose = () => {
      const card = (mode, title, text, who, art) => h("button.st-card", { on: { click: () => { ST.mode = mode; ST.enter = true; Snd.tap(); paint(); } } }, h("div.st-card-art", art), h("h3", title), h("p", text), h("span.st-for", who));
      const pic = (id, css) => { const b = BAGS[id]; return h("i", { style: { backgroundImage: `var(--a-${b.art})`, ...css } }); };
      choose.replaceChildren(h("div", h("h2", "What are you making?"), h("p.muted", "Both are three steps: choose what goes in, dress it, seal it. The difference is who it is for.")),
        h("div.st-cards", card("pack", "A Pack", `Collect ${STUDIO.limits.min}–${STUDIO.limits.max} stickers, decide how likely each one is, and put them in a wrapping. Every opening gives one at random.`, "For the Market and friends", [pic("kraft-parcel", { left: "6%", top: "18%", width: "34%", rotate: "-5deg" }), pic("glassine", { left: "33%", top: "8%", width: "34%" }), pic("cotton", { left: "58%", top: "20%", width: "36%", rotate: "5deg" })]),
          card("gift", "A Gift", "One sticker, a wrapping and a few words, for one person. They open it and it joins their Collection.", "For one person", [pic("airmail", { left: "2%", top: "6%", width: "58%", rotate: "-4deg" }), pic("glassine", { left: "52%", top: "14%", width: "40%", rotate: "4deg" })])));
    };

    /* ---------- the panels: a heading, a body that scrolls, and a footer that stays ---------- */
    const heading = (title, help) => h("div.st-ph", h("h2", title), help ? h("p.st-help", help) : null);
    const foot = (back, next, hint) => h("div.st-foot", hint ? h("p.st-hint", h("i", { "aria-hidden": "true" }, "i"), hint) : null, h("div.st-footrow", back ? h("button.btn.quiet", { type: "button", on: { click: () => go(D().step - 1) } }, "Back") : null, next));
    /** The main button of a step, with the reason it is not ready written beside it, so a grey button never has to be guessed at. `okText` is what is written when it is ready. */
    const stNext = (label, fn, okText = "") => { const why = h("span.st-why", { role: "status" }), b = h("button.btn", { type: "button", disabled: true, on: { click: fn } }, label); return { el: h("div.st-nextwrap", why, b), set(ok, reason = "", text = okText) { b.disabled = !ok || ST.sealing; why.textContent = ok ? text : reason; } }; };
    const sec = (label, ...k) => h("div.st-sec", h("label", label), ...k);
    const pills = (options, cur, pick, disabled = false) => h("div.st-pills", { role: "group" }, options.map(([k, n]) => h("button", { type: "button", "aria-pressed": String(cur === k), disabled, on: { click: () => pick(k) } }, n)));
    const field = (value, max, label, onInput, ph, em) => {
      const used = (v) => (em ? `${Math.ceil(stEm(v))}/${max}` : `${v.length}/${max}`), c = h("span.cnt", used(value));
      const i = h("input", { value, maxLength: em ? 40 : max, placeholder: ph || "", "aria-label": label, autocomplete: "off", spellcheck: false, on: { input: (e) => { if(em) e.target.value = stClip(e.target.value, max); onInput(e.target.value); c.textContent = used(e.target.value); } } });
      return h("div.st-field", i, c);
    };
    const bagPicker = (d, ids) => h("div.st-bags", ids.map((id) => h("button.st-bagt", { type: "button", "aria-pressed": String(d.bag === id), title: BAGS[id].name, on: { click: () => { if(d.bag !== id) { d.bag = id; if(d === ST.pack) stResetPlaces(d); } ST.open = null; stSave(); Snd.tap(); paint(); } } }, h("i", { style: { backgroundImage: `var(--a-${BAGS[id].art})` } }), h("span", BAGS[id].name))));
    const tile = (e, props, extra, size = 56) => { const t = h("button.st-tile", { type: "button", title: `${titleOf(e)} · ${MAT[e.material]?.name || ""}`, data: { rarity: MAT[e.material]?.rarity || "common" }, ...props }, extra || null); thumbOf(e).then((res) => { if(t.isConnected) t.prepend(Stk.el(res, res.aspect >= 1 ? size : size * res.aspect)); }).catch(() => {}); return t; };
    /** A row of the Dress step: what is chosen now, and "Change…" opens the choices below it (one at a time). */
    const row = (key, label, thumb, name, change, body) => { const open = ST.open === key; return h("div.st-row", { data: { open: open ? "1" : "0" } }, h("label", label), h("div.st-cur", thumb, h("b", name), change ? h("button.btn.quiet.small", { type: "button", "aria-expanded": String(open), on: { click: () => { ST.open = open ? null : key; Snd.tap(); paint(); } } }, open ? "Done" : change) : null), open && body ? h("div.st-opts", body) : null); };
    const swatch = (url, rarity) => h("span.st-sw", { data: { rarity: rarity || "common" } }, url ? h("img", { src: url, alt: "" }) : null);

    /* ----- Gather (a pack): the stickers, a summary of the chances, and the chances in a panel of their own ----- */
    const packGather = () => {
      const p = ST.pack, L = STUDIO.limits, tiles = new Map();
      if(ST.chances) return packChances();
      const count = h("div.st-count", h("b"), h("span"), h("span.of")), grid = h("div.st-grid"), next = stNext("Next →", () => go(2)), chance = h("div.st-chance"), more = h("button.btn.quiet.small", { type: "button", on: { click: () => { ST.chances = true; ST.enter = true; paint(); } } }, "Editions…");
      next.el.classList.add("wide");
      const toggle = (id) => {
        if(stEntry(id)?.pressed) return;
        const at = p.sel.findIndex((x) => x.id === id);
        if(at >= 0) { p.sel.splice(at, 1); if(p.cover === id) p.cover = null; Snd.tap(); }
        else if(p.sel.length < L.max) { p.sel.push({ id, copies: 1 }); Snd.tap(); }
        else { Shell.toast(`A pack holds up to ${L.max} stickers.`); return; }
        stSave(); sync();
      };
      /* a tap changes the chosen tiles, the numbers and the preview in place: the list keeps its scroll position and the search keeps its focus */
      const sync = () => {
        const n = p.sel.length, short = L.min - n, same = new Set(p.sel.map((x) => x.copies)).size <= 1;
        count.children[0].textContent = String(n); count.children[1].textContent = "selected"; count.children[2].textContent = `of ${L.max}`;
        chance.replaceChildren(h("i.ico", { "aria-hidden": "true" }), h("span", h("b", "Editions"), n >= L.min && !same ? h("small", stOddsLine(p.sel,p.prizes)) : null));
        more.disabled = n < 1;
        next.set(n >= L.min && stSlots(p)<=S.packLimits.packSlots, `Choose ${short} more sticker${short === 1 ? "" : "s"} to continue.`, `${n} sticker${n === 1 ? "" : "s"} selected`);
        for(const [id, t] of tiles) t.setAttribute("aria-pressed", String(p.sel.some((x) => x.id === id)));
        paintBench();
      };
      const fill = () => {
        const shown = stShown(); tiles.clear();
        grid.replaceChildren(...(shown.length ? shown.map((e) => { const t = tile(e, { disabled:!!e.pressed, "aria-label":titleOf(e)+(e.pressed ? " · Already pressed" : ""), "aria-pressed": "false", on: { click: () => toggle(e.id) } }); tiles.set(e.id, t); return t; })
          : [h("p.muted.st-none", S.lib.length ? "No stickers match." : "Your Collection is empty. Make a few stickers first.")]));
        sync();
      };
      const body = [heading("Choose stickers", `Choose ${L.min}–${L.max} stickers for your pack.`), count, stFind(fill), h("div.st-scroll", grid), h("div.st-chancebar", chance, more), foot(false, next.el)];
      fill(); return body;
    };
    /* Editions and inventory prizes share a compact, scrollable list. */
    const packChances = () => {
      const p=ST.pack,list=h("div.st-crows"),summary=h("div.st-slot-summary"),updates=[];
      const sync=()=>{updates.forEach(f=>f());summary.replaceChildren(Icon("pack"),h("b",`${stSlots(p)} / ${S.packLimits.packSlots}`),h("span","slots"));paintBench();};
      const step=(name,get,min,max,set)=>{
        const out=h("output"),change=d=>{set(clamp(get()+d,min,max()));stSave();sync();};
        const minus=h("button",{type:"button","aria-label":`Fewer: ${name}`,on:{click:()=>change(-1)}},"−"),plus=h("button",{type:"button","aria-label":`More: ${name}`,on:{click:()=>change(1)}},"+");
        updates.push(()=>{out.textContent=String(get());minus.disabled=get()<=min;plus.disabled=get()>=max();});
        return h("div.st-step",minus,out,plus);
      };
      for(const x of p.sel) {
        const e=stEntry(x.id),odds=h("small.st-row-odds"),max=stCopyMax(e),name=titleOf(e);
        const thumb=swatch(stUrl(x.id),MAT[e.material]?.rarity);
        if(!thumb.firstChild) thumbOf(e).then(res=>{if(thumb.isConnected)thumb.append(h("img",{src:res.url,alt:""}));}).catch(()=>{});
        const quantity=e.canPress?step(name,()=>x.copies,1,()=>Math.min(max,x.copies+S.packLimits.packSlots-stSlots(p)),n=>x.copies=n):h("span.st-fixed",{title:"Received sticker: moves into the pack once","aria-label":"One received sticker; moves into the pack"},Icon("transfer"),h("b","1"));
        updates.push(()=>{odds.textContent=stPct(x.copies/(stSlots(p)||1));});
        list.append(h("div.st-crow",thumb,h("div.st-item-info",h("b.nm",{title:name},name),odds),quantity));
      }
      const prizeRows=h("div.st-crows");
      const prizeCount=(kind,materialId)=>p.prizes.find(x=>x.kind===kind&&x.materialId===materialId)?.count||0;
      const prizeRow=(kind,materialId,name,stock)=>{
        if(!stock&&!prizeCount(kind,materialId))return;
        const get=()=>prizeCount(kind,materialId),max=()=>Math.max(0,Math.min(stock,S.packLimits.prizes-p.prizes.reduce((n,x)=>n+x.count,0)+get(),S.packLimits.packSlots-stSlots(p)+get()));
        const set=count=>{p.prizes=p.prizes.filter(x=>!(x.kind===kind&&x.materialId===materialId));if(count)p.prizes.push(kind==="tag"?{kind,count}:{kind,materialId,count});};
        const thumb=h("span.st-sw.plain",kind==="tag"?LinkTagPic({size:30}):MaterialSwatch(MAT[materialId]));
        const stockLabel=h("small.st-stock",{title:`${stock} in stock`,"aria-label":`${stock} in stock`},Icon("stock"),String(stock));
        prizeRows.append(h("div.st-crow",thumb,h("div.st-item-info",h("b.nm",{title:name},name),stockLabel),step(name,get,0,max,set)));
      };
      for(const [id,stock] of Object.entries(S.prizeStock||{}))prizeRow("material",id,MAT[id].name,stock);
      prizeRow("tag",undefined,"Link tag",S.tagStock?.available||0);
      const done=h("button.btn",{on:{click:()=>{ST.chances=false;paint();}}},"Done");
      const body=[heading("Editions","Originals stay with you."),summary,h("div.st-scroll",list,h("div.st-prize-head",Icon("gift"),h("h3","Prizes"),h("small",`up to ${S.packLimits.prizes}`)),prizeRows),h("div.st-foot",done)];sync();return body;
    };

    /* ----- Dress (a pack): what is chosen now; "Change…" opens the choices ----- */
    const packDress = () => {
      const p = ST.pack, bag = BAGS[p.bag], next = stNext("Next →", () => go(3)), need = "Give the pack a name to continue.", ids = p.sel.filter(x=>stEntry(x.id)?.canPress).map((x) => x.id);
      const has = (k) => p.layout.accents.some((a) => a.kind === k);
      const accent = (k) => {
        if(k === "none") p.layout.accents = [];
        else if(has(k)) p.layout.accents = p.layout.accents.filter((a) => a.kind !== k);
        else if(p.layout.accents.length >= PetaMath.BAG_MAX_ACCENTS) { Shell.toast("Up to 2 accents."); return; }
        else { const [x, y] = PetaMath.bagAccentDefault(bag, k); p.layout.accents.push({ kind: k, x, y }); }
        stSave(); Snd.tap(); paint();
      };
      const coverE = p.cover ? stEntry(p.cover) : null, coverUrl = p.cover ? stUrl(p.cover) : null;
      const bagSw = h("span.st-bagsw", { style: { backgroundImage: `var(--a-${bag.art})` } });
      const layout = pills([["center", "Center"], ["corner", "Corner"], ["band", "Top"]], p.layout.comp, (c) => { p.layout.comp = c; p.layout.cover = null; if(!p.cover) p.cover=ids[0]||null; stSave(); Snd.tap(); paint(); }, !ids.length);
      const coverBody = h("div.st-covers", h("button.st-cv.none", { type: "button", "aria-pressed": String(!p.cover), on: { click: () => { p.cover = null; ST.open = null; stSave(); paint(); } } }, "None"),
        ids.map((id) => { const e = stEntry(id); return e ? tile(e, { class: "st-cv", "aria-pressed": String(p.cover === id), on: { click: () => { p.cover = id; ST.open = null; stSave(); Snd.tap(); paint(); } } }, null, 38) : null; }));
      const accentBody = h("div.st-accs", [["none", "None", null], ["clip", "Silver clip", A.marketClip], ["seal", "Wax seal", A.waxSeal], ["tape", "Tape", null]].map(([k, n, img]) => h("button.st-acc", { type: "button", "aria-pressed": String(k === "none" ? !p.layout.accents.length : has(k)), on: { click: () => accent(k) } },
        h("i", img ? { style: { backgroundImage: `url("${img}")` } } : { class: k === "tape" ? "strip" : "none" }), h("span", n))));
      const accentName = p.layout.accents.length ? p.layout.accents.map((a) => ({clip:"Silver clip",seal:"Wax seal",pin:"Pin",tape:"Paper tape"})[a.kind]).join(", ") : "None";
      const accentThumb = h("span.st-sw.plain", p.layout.accents[0] ? h("i", { class: p.layout.accents[0].kind === "tape" ? "strip" : "", style: p.layout.accents[0].kind === "tape" ? {} : { backgroundImage: `url("${p.layout.accents[0].kind === "seal" ? A.waxSeal : p.layout.accents[0].kind === "pin" ? A.pinRed : A.marketClip}")` } }) : null);
      const body = [heading("Dress your pack", "A few details. Make it yours."),
        h("div.st-scroll", row("wrap", "Wrapping", bagSw, bag.name, "Change…", bagPicker(p, PACK_BAG_IDS)),
          sec("Name label", field(p.title, STUDIO.limits.name, "Pack name", (v) => { p.title = v; stSave(); paintBench(); next.set(!!v.trim(), need); }, "", true)),
          sec("Cover position", layout, !p.cover ? h("small.st-fine", ids.length ? "Choose a position to add a cover sticker." : "A cover needs one of your own designs.") : null),
          row("cover", "Cover sticker", swatch(coverUrl, coverE ? MAT[coverE.material]?.rarity : null), coverE ? titleOf(coverE) : "None", "Choose…", coverBody),
          row("accent", "Accent", accentThumb, accentName, "Change…", accentBody), h("p.st-fine", "Up to 2 accents. Drag them onto a fold or edge.")),
        foot(true, next.el, "Drag the sticker or an accent in the preview.")];
      next.set(!!p.title.trim(), need); return body;
    };
    /* a link tag on a sticker that is being sealed into a gift or a pack goes back to you (its target is never in the file) */
    const tagNote = (ids) => { const n = ids.filter((id) => ltTag(id)).length; return n ? h("div.st-tagnote", LinkTagPic({ size: 20 }), h("span", h("b", ST.mode === "gift" ? "The link tag returns to you." : `${n} link tag${n === 1 ? "" : "s"} return${n === 1 ? "s" : ""} to you.`), h("small", "Links stay private."))) : null; };
    /* the button that seals: sealing is the real thing (it signs, and writes the shelf entry or the file), so it is also what asks where it goes */
    const sealButton = (label) => { const b = stNext(ST.sealing ? "Sealing…" : label, seal); b.set(true); return b; };
    const packSeal = () => {
      const p = ST.pack, bag = BAGS[p.bag];
      if(p.sealed) return [doneBlock("pack")];
      const note = h("div.st-field", h("textarea", { rows: 2, maxLength: STUDIO.limits.blurb, placeholder: "A few words about this pack…", "aria-label": "Description", on: { input: (e) => { p.blurb = e.target.value; cnt.textContent = `${p.blurb.length}/${STUDIO.limits.blurb}`; stSave(); } } }, p.blurb)), cnt = h("span.cnt", `${p.blurb.length}/${STUDIO.limits.blurb}`); note.append(cnt);
      return [heading("Ready to seal", "Check the details before finishing."),
        h("div.st-scroll", h("div.st-sum", h("b", p.title.trim()), h("span", `${p.sel.length} designs · ${p.sel.reduce((s,x)=>s+x.copies,0)} editions · ${p.prizes.reduce((s,x)=>s+x.count,0)} prizes`), h("small", stOddsLine(p.sel,p.prizes))), sec("Description", note, h("small.st-fine", "Shown on the Market card.")),
          sec("Destination", pills([["shelf", "My shelf"], ["file", "File to share"]], p.dest, (k) => { p.dest = k; Snd.tap(); paint(); }, ST.sealing)), p.dest === "shelf" ? h("p.st-fine", "Keep this finished pack here and export it whenever you want to share it again.") : null, tagNote(p.sel.filter(x=>!stEntry(x.id)?.canPress).map((x) => x.id))),
        foot(true, sealButton(p.dest === "file" ? "Seal and save…" : "Seal the pack").el, "Originals stay with you and can be pressed once. Received stickers and prizes leave your Collection / stock and move into the pack. It cannot be edited afterward.")];
    };

    /* ----- a gift is one sticker for one person: choose it, dress it, seal it ----- */
    const giftChoose = () => {
      const g = ST.gift, tiles = new Map(), grid = h("div.st-grid"), next = stNext("Next →", () => go(2), "1 sticker selected"); next.el.classList.add("wide");
      const sync = () => { for(const [id, t] of tiles) t.setAttribute("aria-pressed", String(g.sticker === id)); next.set(!!g.sticker, "Choose a sticker to continue."); paintBench(); };
      const fill = () => {
        const shown = stShown(); tiles.clear();
        grid.replaceChildren(...(shown.length ? shown.map((e) => { const t = tile(e, { disabled:!!e.pressed, "aria-label":titleOf(e)+(e.pressed ? " · Already pressed" : ""), "aria-pressed": "false", on: { click: () => { g.sticker = e.id; stSave(); Snd.tap(); sync(); } } }); tiles.set(e.id, t); return t; })
          : [h("p.muted.st-none", S.lib.length ? "No stickers match." : "Your Collection is empty. Make a sticker first.")]));
        sync();
      };
      const body = [heading("Choose the sticker", "One sticker. It moves from your Collection to your friend."), stFind(fill), h("div.st-scroll", grid), foot(false, next.el)];
      fill(); return body;
    };
    const giftDress = () => {
      const g = ST.gift, next = stNext("Next →", () => go(3)), need = "Write who it is for to continue.";
      const note = h("textarea", { rows: 2, maxLength: STUDIO.limits.note, "aria-label": "Note", on: { input: (e) => { g.note = e.target.value; cnt.textContent = `${g.note.length}/${STUDIO.limits.note}`; stSave(); } } }, g.note), cnt = h("span.cnt", `${g.note.length}/${STUDIO.limits.note}`);
      const body = [heading("Dress the gift", "Choose a wrapping, write who it is for, and a few words only they will see."),
        h("div.st-scroll", sec("Wrapping", bagPicker(g, GIFT_BAG_IDS)), sec("To (required)", field(g.to, STUDIO.limits.to, "To", (v) => { g.to = v; stSave(); paintBench(); next.set(!!v.trim(), need); }, "Who is it for?", true)),
          sec("A few words", h("div.st-field", note, cnt)), sec("Decoration", pills(STUDIO.decos, g.deco, (k) => { g.deco = k; stSave(); Snd.tap(); paint(); }))),
        foot(true, next.el)];
      next.set(!!g.to.trim(), need); return body;
    };
    const giftSeal = () => {
      const g = ST.gift, bag = BAGS[g.bag];
      if(g.sealed) return [doneBlock("gift")];
      return [heading("Ready to seal", "Check the details before finishing."),
        h("div.st-scroll", h("div.st-sum", h("b", `For ${g.to.trim()}`), h("span", `1 sticker · ${bag.name}`), h("small", "Your photo is never inside.")), tagNote([g.sticker])),
        foot(true, sealButton("Seal and save…").el, "Sealing signs the gift and asks where to save the file. It cannot be edited afterward.")];
    };
    const doneBlock = (kind) => {
      const d = kind === "pack" ? ST.pack : ST.gift, r = d.result || {};
      const again = () => { if(kind === "pack") Object.assign(ST.pack, { step: 1, seen: new Set([1]), sealed: false, result: null, sel: [], prizes:[], cover: null, title: "", blurb: "", layout: { comp: "corner", label: null, cover: null, accents: [] } }); else Object.assign(ST.gift, { step: 1, seen: new Set([1]), sealed: false, result: null, sticker: null, to: "", note: "" }); stSave(); Snd.tap(); paint(); };
      const msg = (t) => { const m = h("div.st-toast", t); root.append(m); setTimeout(() => m.remove(), 2200); };
      const act = (label, fn, cls = "") => h("button.btn" + cls, { on: { click: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { await fn(msg); } catch(err) { Shell.toast(Distribution?.error ? Distribution.error(err) : String(err)); } finally { b.disabled = false; } } } }, label);
      const more = [];
      if(kind === "pack") {
        if(r.where === "shelf") more.push(act("Also save a file…", async (m) => { const path = await Bridge.fileDialog("creator_pack_export", {packId:r.packId}); if(path) { Snd.chime(2, 740); m("Saved."); } }));
        else more.push(act("Also put on my shelf", async (m) => { await Bridge.invoke("creator_pack_store", {packId:r.packId}); r.where="shelf"; paint(); try {await Bridge.reload();Shell.renderNav();} catch {m("Stored on My shelf. The display could not refresh.");return;} Snd.chime(2, 740); m("It's on your Packs shelf."); }, ".paper"));
      }
      const line = r.where === "shelf" ? "It's on your Packs shelf." : kind === "pack" ? "The file is saved. Share it any way you like." : "The file is saved. Send it any way you like.";
      return h("div.st-done", h("i.st-check", { "aria-hidden": "true" }), h("h2", kind === "pack" ? `Sealed. ${ST.pack.title.trim()}` : `Sealed. For ${ST.gift.to.trim()}`), h("p.muted", kind === "pack" ? `${ST.pack.sel.length} stickers · ${line}` : line), r.path ? h("p.muted.st-path", { title: r.path }, r.path) : null,
        h("div.st-done-actions", ...more, h("button.btn.quiet", { on: { click: again } }, "Make another")));
    };
    const packArgs = () => { const p = ST.pack, lay = stLayoutArgs(p); return { title: p.title.trim(), pouch: p.bag, items: p.sel.map((x) => ({ stickerId: x.id, name: titleOf(stEntry(x.id)), copies: x.copies })), prizes:p.prizes, dress: { cover: p.cover || null, deco: lay.accents[0]?.kind || null, blurb: p.blurb.trim() || null, layout: lay } }; };
    const giftArgs = () => { const g = ST.gift; return { stickerId: g.sticker, to: g.to.trim(), note: g.note.trim() || null, dress: { bag: g.bag, deco: g.deco === "none" ? null : g.deco } }; };

    /* ---------- sealing: it signs and writes first (a cancelled save dialog makes nothing), then the wrapping closes its own way ---------- */
    const seal = async () => {
      if(ST.sealing) return; const mode=ST.mode,d=D(),args=mode==='gift'?giftArgs():packArgs(); ST.sealing = true; ST.view = "pack"; paint();
      try {
      if(mode==='pack'&&stSlots(d)>S.packLimits.packSlots)throw new Error('Too many slots.');
      const result=await stCommitSeal(mode,d,args);if(!result)return;
      const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 1 : ms)), tilt = $(".st-tilt", bench); if(tilt) tilt.style.transform = "";
      const open = BAGS[d.bag]; const p = $(".bagpic", bench);
      try { if(p) await StudioSeal.run(p, open, bench, wait); } catch {}
      const st = h("div.st-stamp", "SEALED"); bench.append(st); st.animate([{ opacity: 0, transform: "scale(2.2)" }, { opacity: .9, transform: "scale(.94)", offset: .6 }, { opacity: .85, transform: "scale(1)" }], { duration: reduced() ? 1 : 360, easing: "ease-out", fill: "forwards" }); Snd.tap(); await wait(700); Snd.chime(2, 880);
      setTimeout(() => st.remove(), 400);
      } catch(err) {Shell.toast(d.sealed ? 'Sealed and saved. The preview could not finish.' : (Distribution?.error ? Distribution.error(err) : String(err)));}
      finally {ST.sealing=false;paint();}
    };

    const paintPanel = () => {
      if(!ST.mode) { panel.replaceChildren(); return; }
      const n = D().step, body = (ST.mode === "gift" ? [giftChoose, giftDress, giftSeal] : [packGather, packDress, packSeal])[n - 1]();
      panel.replaceChildren(...[].concat(body));
      if(ST.enter) { ST.enter = false; if(!reduced()) [...panel.children].forEach((c, i) => c.animate([{ opacity: 0, transform: "translateX(14px)" }, { opacity: 1, transform: "none" }], { duration: 300, delay: i * 35, easing: EASE.out, fill: "backwards" })); }
    };
    const paint = () => { const on = !!ST.mode; work.hidden = !on; choose.hidden = on; paintHead(); if(on) { paintBench(); paintPanel(); } else paintChoose(); };
    paint(); return root;
  },
  enter(root) {
    this.resizeObserver?.disconnect();
    // The wrapping must fit again when the window or the page columns change.
    this.resizeObserver = new ResizeObserver(() => {
      if (!ST.sealing) this.repaintBench?.();
    });
    this.resizeObserver.observe($(".st-stage", root));
  },
  leave() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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

function stConfirmTransfer() {
  return new Promise(resolve => {
    const dialog=h("dialog", {"aria-label":"Confirm sticker transfer",on:{cancel:()=>resolve(false),close:()=>dialog.remove()}},
      h("h2","This leaves your Collection."),h("p","The sticker moves to its recipient."),
      S.lib.some(e=>e.copyOf===ST.gift.sticker) ? h("p","Existing copies also disappear from this Mac.") : null,
      h("button.btn.secondary",{on:{click:()=>{resolve(false);dialog.close();}}},"Cancel"),
      h("button.btn",{on:{click:()=>{resolve(true);dialog.close();}}},"Transfer and save…"));
    document.body.append(dialog);dialog.showModal();
  });
}

/** Open Studio from elsewhere (the Collection's "Make a Pack…" and "Gift…"): `sticker` is chosen already. */
function StudioOpen(mode, sticker) {
  if(ST.sealing)return;
  stLoad(); ST.mode = mode;
  if(mode === "pack" && ST.pack.sealed) Object.assign(ST.pack, { step: 1, seen: new Set([1]), sealed: false, result: null, sel: [], prizes:[], cover: null, title: "", blurb: "", layout: { comp: "corner", label: null, cover: null, accents: [] } });
  if(sticker && stEntry(sticker)?.lineage !== "copy" && (mode !== "pack" || !stEntry(sticker)?.pressed)) { if(mode === "gift") Object.assign(ST.gift, { sticker, step: 1, sealed: false }); else if(!ST.pack.sel.some((x) => x.id === sticker)) ST.pack.sel.push({ id: sticker, copies: 1 }); }
  Shell.go("studio");
}
