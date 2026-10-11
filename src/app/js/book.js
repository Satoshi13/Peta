/* Sticker Book: a list or local-date calendar, a detail card you can turn over, peel / gift / stick-as-today. */
const BK = { sel: null, anim: false, deleteId: null, day: null, completed: new Set(), q: "", mat: "all", sort: "newest" };
const BOOK_SORTS = [["newest", "Newest first"], ["oldest", "Oldest first"], ["name", "Name A–Z"], ["material", "By material"]];

/** First weekday of the device locale (0 = Sunday); Sunday when the engine cannot say. */
function calendarWeekStart() {
  try { const locale = new Intl.Locale(navigator.language); return (locale.getWeekInfo?.() || locale.weekInfo)?.firstDay % 7 || 0; } catch { return 0; }
}
const monthKey = (d) => d.getFullYear() * 12 + d.getMonth();
const monthName = (k) => fmtDate(new Date(Math.floor(k / 12), k % 12, 1), { month: "long", year: "numeric" });
const monthShort = (k) => fmtDate(new Date(Math.floor(k / 12), k % 12, 1), { month: "short" });

// The back of a sticker (spec §30): ORIGINAL / Received, who made it, when, which material.
// Shared by the desktop layer ("turn over") and the Sticker Book. All text comes from Rust (`sticker_back`);
// this only lays it out. Every value goes in with textContent (names are user input).

const backElement = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** `back` is a `StickerBack` (see docs/ui-handoff.md). Returns the card element. */
function renderBackCard(back) {
  const card = backElement("div", "back-card");
  card.dataset.kind = back.kind;
  card.dataset.mat = back.material?.id || "matte";
  card.dataset.art = "back-paper"; // art hook: paper texture (back/paper-cream.jpg, back/paper-kraft.jpg)
  const face = backElement("div", "face");
  card.append(face);

  const received = back.kind === "received";
  if (!received) {
    const stamp = backElement("div", "stamp", "ORIGINAL");
    stamp.dataset.art = "stamp-frame"; // art hook: rubber-stamp frame
    face.append(stamp);
  }

  const rows = backElement("div", "rows");
  const row = (label, ...values) => {
    const r = backElement("div", "row");
    r.append(backElement("span", "label", label));
    for (const v of values) if (v) r.append(backElement("span", "value", v));
    rows.append(r);
  };
  row("Created by", back.createdBy, back.createdOn);
  if (received) row("Received from", back.receivedFrom, back.receivedOn);
  if (back.material) row("Material", back.material.name);
  face.append(rows);

  const number = back.originalNumber
    ? `No. ${back.originalNumber}`
    : back.editionNumber
      ? `Edition #${back.editionNumber}${back.editionTotal ? "/"+back.editionTotal : ""}`
      : "";
  if(back.editionTotal && !back.editionVerified) face.append(backElement("small","code","Edition numbers are not checked by a server yet"));
  if (number) face.append(backElement("div", "number", number));

  const mark = backElement("div", "peta-mark", "Peta");
  mark.dataset.art = "peta-mark"; // art hook: brush wordmark
  face.append(mark);
  face.append(backElement("small", "code", back.idCode));
  return card;
}

/** Shown if the back could not be loaded. */
function renderBackFallback() {
  const card = backElement("div", "back-card");
  card.dataset.kind = "original";
  const face = backElement("div", "face");
  face.append(backElement("div", "peta-mark", "Peta"));
  card.append(face);
  return card;
}

function BackCard(entry) { const card = entry.back ? renderBackCard(entry.back) : renderBackFallback(); card.dataset.mat=entry.material; if (!entry.back) Bridge.invoke("sticker_back", {stickerId:entry.id}).then(b=>{ if(b) { entry.back=b; const next=renderBackCard(b); next.dataset.mat=entry.material; card.replaceWith(next); }}).catch(e=>Shell.toast(String(e))); return card; }
async function BackingFront(entry) {
  const res = await resOf(entry, { max: 420 });
  const el = h("div.backing", { data: { mat: entry.material } }, h("i.tape.t3"), Stk.el(res, res.aspect >= 1 ? 170 : 170 * res.aspect));
  return el;
}

async function peelFromDesk(id) {
  await Bridge.invoke("peel_sticker", {stickerId:id}); Haptic.tap("peel"); await Bridge.reload();
}

Pages.book = {
  observer: null,
  leave() { this.observer?.disconnect(); this.observer = null; },
  build() {
    const root = h("div.page-in.bookpage");
    const select = (e) => { BK.sel = BK.sel === e.id && BK.day === PetaMath.bookDateKey(e.date) ? null : e.id; BK.day = PetaMath.bookDateKey(e.date); BK.deleteId = null; Snd.tap(); paint(true); };
    this.settled = false; setTimeout(() => { this.settled = true; }, 800);   // the tiles slide in once, when the page opens; picking a sticker or typing in the filter must not replay it
    /* paint(true) = only the selection changed: the list keeps its tiles (and their pictures), and just the highlight and the details card change. */
    let painted = false;
    const paint = (selectionOnly) => {
      // a repaint asked for by a card (after peeling, say) can arrive after the page was already rebuilt by a state change: it must not touch the new page's picture loader
      if(painted && !root.isConnected) return;
      painted = true;
      if(selectionOnly === true && S.bookView !== "calendar" && root.querySelector(".bk-grid")) {
        const items = PetaMath.newestBookEntries(S.lib), sel = items.find(e => e.id === BK.sel && PetaMath.bookDateKey(e.date) === BK.day) || items.find(e => e.id === BK.sel);
        const bk = $(".bk", root);
        if(bk) {
          for(const t of bk.querySelectorAll(".tile")) t.setAttribute("aria-pressed", String(!!sel && t.dataset.sticker === sel.id));
          bk.querySelector(":scope > .detail")?.remove(); bk.classList.toggle("has-detail", !!sel);
          if(sel) { const shown = PetaMath.filterBookEntries(items.filter(e=>e.lineage !== "copy"), { query: BK.q, material: BK.mat, sort: BK.sort, materialIds: Object.keys(MAT), nameOf: id => MAT[id]?.name || id }); bk.append(this.detail(sel, paint, shown.some(x => x.id === sel.id) ? shown : items)); }
          return;
        }
      }
      this.leave();
      this.observer = new IntersectionObserver(records => {
        for(const record of records) if(record.isIntersecting) { this.observer?.unobserve(record.target); record.target._load?.(); }
      }, { root, rootMargin: "80px" });
      const items = PetaMath.newestBookEntries(S.lib);
      // the stickers the arrows page through: what the list shows right now (its filter and order), or everything newest-first in the calendar
      const listFor = (sel, all) => { const shown = S.bookView === "calendar" ? all : PetaMath.filterBookEntries(all, { query: BK.q, material: BK.mat, sort: BK.sort, materialIds: Object.keys(MAT), nameOf: id => MAT[id]?.name || id }); return shown.some(x => x.id === sel.id) ? shown : all; };
      const sel = items.find(e => e.id === BK.sel && PetaMath.bookDateKey(e.date) === BK.day) || items.find(e => e.id === BK.sel);
      const view = h("div.seg.book-view", { role: "group", "aria-label": "Collection view" }, ["list", "calendar"].map(v => SegButton(v === "list" ? "List" : "Calendar", { "aria-pressed": String(S.bookView === v), on: { click: () => {
        if(S.bookView === v) return; S.bookView = v;
        if(v === "calendar" && sel) S.bookMonth = monthKey(sel.date);
        Bridge.savePreferences(); paint();
      } } })));
      const main = h("div.bk-main");
      if(S.bookView === "calendar") main.append(this.calendar(items, select, root, paint));
      else {
        const count = h("p.muted.book-count", { "aria-live": "polite" }), results = h("div.bk-results");
        // Only the numbers and the tiles are redrawn while typing, so the field keeps its focus.
        const fill = () => {
          const shown = PetaMath.filterBookEntries(items.filter(e=>e.lineage !== "copy"), { query: BK.q, material: BK.mat, sort: BK.sort, materialIds: Object.keys(MAT), nameOf: id => MAT[id]?.name || id });
          const filtered = !!BK.q.trim() || BK.mat !== "all";
          count.replaceChildren(...[filtered ? `${shown.length} of ${items.length} sticker${items.length === 1 ? "" : "s"}` : `${items.length} sticker${items.length === 1 ? "" : "s"}`,
            filtered ? h("button.link.bk-clear", { type: "button", on: { click: () => { BK.q = ""; BK.mat = "all"; Snd.tap(); paint(); $(".bk-search input")?.focus({ preventScroll: true }); } } }, "Clear") : null].filter(Boolean));
          results.replaceChildren(shown.length ? h("div.bk-grid", shown.map((e, i) => this.tile(e, i, select)))
            : h("p.empty-note", BK.q.trim() ? `No stickers match “${BK.q.trim()}”.` : BK.mat === "desktop" ? "Nothing is stuck on your desktop right now." : "No stickers in this material yet."));
        };
        main.append(count, items.length ? this.filters(items.filter(e=>e.lineage !== "copy"), fill) : null, items.length ? results : h("p.empty-note", "Your Collection is waiting for its first sticker."));
        if (items.length) fill();
      }
      const poster = S.bookView === "calendar" ? this.posterButton(items) : null;
      const actions = h("div.book-head-actions", poster, h("button.btn.paper.small", {disabled:S.lib.length<3,on:{click:()=>StudioOpen("pack")}}, "Make a Pack…"));
      root.replaceChildren(PageHead("Collection", "Your stickers", actions, view),
        ...(S.pickMode ? [h("div.pick-banner", h("span", "Choose one to stick on the desktop"), h("button.link", { on: { click: () => { S.pickMode = false; paint(); } } }, "Cancel"))] : []),
        h("div.bk" + (sel ? ".has-detail" : ""), main, sel ? this.detail(sel, paint, listFor(sel, items)) : null));
    };
    paint(); return root;
  },
  async turn(root, paint) {
    if(BK.anim) return; BK.anim = true;
    try {
      if(reduced()) { paint(); return; }
      const g = $(".bk", root); if(g) await anim(g, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-26px) rotate(-.8deg)" }], { duration: 160, easing: "ease-in" });
      paint(); const n = $(".bk", root); if(n) await anim(n, [{ opacity: 0, transform: "translateX(26px) rotate(.8deg)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: EASE.out });
    } finally { BK.anim = false; }
  },
  /* Save the month on screen as a PNG poster. Rust opens the save panel; cancelling writes nothing. */
  posterButton(items) {
    const key = clamp(S.bookMonth ?? monthKey(S.today), Math.min(monthKey(S.today), ...items.map(e => monthKey(e.date))), monthKey(S.today));
    const empty = !PetaMath.calendarMonth(items, key, S.today, 0).daysStuck;
    const button = h("button.btn.paper.small.poster-save", { disabled: empty, title: empty ? "Nothing stuck this month yet" : "Save this month as a picture", on: { click: async () => {
      if(button.disabled) return;
      const label = button.textContent; button.disabled = true; button.textContent = "Saving…"; Bridge.dialogOpen = true;
      try {
        const weekStart = calendarWeekStart(), month = PetaMath.calendarMonth(items, key, S.today, weekStart);
        const path = await Poster.save(month, key, weekStart);
        if(path) { Snd.chime(2, 740); Shell.toast("Poster saved."); }
      } catch(err) { Shell.toast(String(err)); }
      finally { Bridge.dialogOpen = !!document.querySelector("dialog"); button.disabled = false; button.textContent = label; }
    } } }, "Save poster…");
    return button;
  },
  lazySticker(holder, entry, size) {
    holder._load = () => {
      holder._load = null;
      thumbOf(entry).then(res => { if(!holder.isConnected) return; const sticker = Stk.el(res, res.aspect >= 1 ? size : size * res.aspect); sticker.style.setProperty("--aspect", res.aspect); holder.append(sticker); }).catch(err => Shell.toast(String(err)));
    };
    this.observer.observe(holder);
  },
  tile(e, i, select) {
    const holder = h("div.tile-stk"), onDesk = S.desk.some(d => d.id === e.id), lt = ltTag(e.id);
    const badges = [e.kind === "received" ? h("i.recv", "Gift") : null,
      lt && lt.showInCollection ? h("span.tile-link", { title: `Opens ${lt.label}` }, ltMark(e.id, lt), h("span.tile-link-label", lt.label)) : null].filter(Boolean);
    this.lazySticker(holder, e, 128);
    return h("button.tile", { data: { sticker: e.id, late: i >= 12 || this.settled ? "1" : "0" }, "aria-pressed": String(BK.sel === e.id && BK.day === PetaMath.bookDateKey(e.date)), style: { "--i": Math.min(i, 8) }, on: { click: () => select(e) } },
      h("span.tile-date", fmtDate(e.date,{month:"short",day:"numeric"})),
      holder, badges.length ? h("span.tile-badges", badges) : null, h("span.tile-footer", h("b", titleOf(e)), e.verified === false && e.lineage !== "copy" ? h("small", "Unverified") : null, h("small", `${MAT[e.material].name} · ${e.kind === "received" ? "Received" : "No. "+pad4(e.no)}`)),
      onDesk ? h("i.on-desk", "On desktop") : null);
  },
  /* Search, material and order for the list. The values live in BK so they survive picking a sticker and coming back to the page. */
  filters(items, fill) {
    const counts = {}; for (const e of items) counts[e.material] = (counts[e.material] || 0) + 1;
    const onDesk = items.filter((e) => e.onDesktop).length;   // "On desktop" sits beside the materials in the same menu
    if (BK.mat !== "all" && !(BK.mat === "desktop" ? onDesk : counts[BK.mat])) BK.mat = "all";
    const search = h("input", { type: "search", placeholder: "Search stickers", value: BK.q, autocomplete: "off", spellcheck: false, "aria-label": "Search stickers", enterkeyhint: "search" });
    search.addEventListener("input", () => { BK.q = search.value; fill(); });
    search.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && search.value) { ev.preventDefault(); ev.stopPropagation(); search.value = ""; BK.q = ""; fill(); } });
    const pick = (label, value, options, set) => {
      const select = h("select", { "aria-label": label, on: { change: () => { set(select.value); Snd.tap(); fill(); } } }, options.map(([v, text]) => h("option", { value: v, selected: v === value }, text)));
      return h("label.bk-select", select);
    };
    return h("div.bk-filter", { role: "search" }, h("label.bk-search", search),
      pick("Material", BK.mat, [["all", "All materials"], ...(onDesk ? [["desktop", `On desktop (${onDesk})`]] : []), ...Object.keys(MAT).filter(id => counts[id]).map(id => [id, `${MAT[id].name} (${counts[id]})`])], v => { BK.mat = v; }),
      pick("Sort by", BK.sort, BOOK_SORTS, v => { BK.sort = v; }));
  },
  calendar(items, select, root, paint) {
    const current = monthKey(S.today), earliest = Math.min(current, ...items.map(e => monthKey(e.date)));
    S.bookMonth = clamp(S.bookMonth ?? current, earliest, current);
    const weekStart = calendarWeekStart();
    const month = PetaMath.calendarMonth(items, S.bookMonth, S.today, weekStart);
    const move = delta => {
      if(BK.anim) return; S.bookMonth = clamp(S.bookMonth + delta, earliest, current); Snd.flip(); this.turn(root, paint);
    };
    const heading = h("div.calendar-heading", h("button.calendar-nav", { disabled: S.bookMonth <= earliest, "aria-label": "Previous month", on: { click: () => move(-1) } }, "‹"),
      h("div", h("div.calendar-month-title", h("h2.month-title", monthName(S.bookMonth))), h("p.muted", `${month.daysStuck} days stuck · ${month.petas} Petas`)),
      h("button.calendar-nav", { disabled: S.bookMonth >= current, "aria-label": "Next month", on: { click: () => move(1) } }, "›"));
    if(month.complete) {
      const stamp = h("span.calendar-complete", `${month.days}/${month.days} COMPLETE`);
      if(!BK.completed.has(S.bookMonth)) { BK.completed.add(S.bookMonth); if(!reduced()) stamp.classList.add("press"); }
      $(".calendar-month-title", heading).append(stamp);
    }
    const weekdays = h("div.calendar-weekdays", Array.from({length:7}, (_,i) => h("span", fmtDate(new Date(2026,0,4+(weekStart+i)%7,12), {weekday:"short"}))));
    const grid = h("div.calendar-grid", Array.from({length:month.offset}, () => h("span.calendar-blank", {"aria-hidden":"true"})), month.cells.map(cell => {
      const dateLabel = fmtDate(cell.date, {month:"short",day:"numeric"}), latest = cell.entries[0];
      const contents = [h("span.calendar-date", String(cell.day))];
      if(latest && cell.state !== "future") {
        const holder = h("div.calendar-sticker", {style:{"--rot":cell.tilt+"deg"}}); this.lazySticker(holder, latest, 84);
        contents.push(holder, cell.entries.length > 1 ? h("span.calendar-multiple", "×"+cell.entries.length) : null);
        return h("button.calendar-day.stuck", { data:{date:PetaMath.bookDateKey(cell.date)}, title:dateLabel+" · "+titleOf(latest), "aria-label":dateLabel+" · "+titleOf(latest)+(cell.entries.length>1?` · ${cell.entries.length} stickers`:""), "aria-pressed":String(BK.day===PetaMath.bookDateKey(cell.date) && BK.sel!=null), on:{click:()=>select(latest)} }, contents);
      }
      if(cell.state === "today") return h("button.calendar-day.today-empty", {"aria-label":"Make a Peta today", on:{click:()=>Shell.go("today")}}, contents, h("span.calendar-add", "+"));
      return h("div.calendar-day."+cell.state, contents, cell.state === "past" ? h("span.calendar-rest", { role:"img", "aria-label":"Rest day" }) : null);
    }));
    return h("div.calendar-ledger", heading, weekdays, grid);
  },
  detail(e, paint, list = [e]) {
    const mat = MAT[e.material], onDesk = S.desk.some((d) => d.id === e.id), flip = h("div.flip-inner"), front = h("div.flip-face.f-front"), back = h("div.flip-face.f-back", BackCard(e));
    BackingFront(e).then((el) => front.prepend(el)); flip.append(front, back);
    const lt = ltTag(e.id); if(lt && lt.showInCollection) { front.append(LinkTags.hang(e, lt)); back.append(LinkTags.hang(e, lt, true)); }
    let turned = false;
    const turn = h("button.flip-stage.book-flip", { type: "button", "aria-label": "Show sticker back", "aria-pressed": "false", on: { click: () => {
      turned = !turned; Snd.flip(); flip.classList.toggle("turned", turned);
      turn.setAttribute("aria-pressed", String(turned)); turn.setAttribute("aria-label", turned ? "Show sticker front" : "Show sticker back");
    } } }, flip);
    const name = titleOf(e), nameWidth = [...name].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 1 : .5), 0);   // a long name shrinks to stay on one line of its paper label
    const act = (cls, action, icon, text, click) => h("button.btn.quiet.book-action." + cls, { data: { action }, on: { click } }, icon, h("span", text));
    const main = onDesk ? act("det-main", "peel", Icon("peel"), "Peel off desktop", async () => { await peelFromDesk(e.id); Shell.toast("Peeled off — it's waiting in your Collection."); paint(); })
      : act("det-main", "stick", Icon("desk"), "Stick on desktop", () => this.stick(e));
    // paging through the collection: arrows either side of the card, and where this one is in the list
    const at = list.findIndex((p) => p.id === e.id), many = list.length > 1 && at >= 0;
    const go = (step) => { const next = list[(at + step + list.length) % list.length]; Snd.tap(); BK.sel = next.id; BK.day = PetaMath.bookDateKey(next.date); if(S.bookView === "calendar") S.bookMonth = monthKey(next.date); BK.deleteId = null; BK.stay = true; paint(S.bookView !== "calendar"); };
    const arrow = (dir, label) => h("button.det-arrow." + (dir < 0 ? "prev" : "next"), { type: "button", "aria-label": label, on: { click: () => go(dir) } }, Icon(dir < 0 ? "left" : "right"));
    const stage = many ? h("div.det-pager", { role: "group", "aria-label": "Stickers in your Collection", on: { keydown: (ev) => { if(ev.key === "ArrowLeft") { ev.preventDefault(); go(-1); } else if(ev.key === "ArrowRight") { ev.preventDefault(); go(1); } } } },
      arrow(-1, "Previous sticker"), turn, arrow(1, "Next sticker")) : turn;
    const stay = BK.stay; BK.stay = false; // moving between stickers keeps the card where it is instead of sliding it in again
    return h("aside.detail" + (stay ? ".stay" : ""), { role: "dialog", "aria-label": "Sticker details" },
      CloseButton("Close", {on: { click: () => { BK.sel = null; BK.deleteId = null; paint(S.bookView !== "calendar"); } }}, ".x"),
      many ? h("small.det-count", { "aria-live": "polite" }, `${at + 1} / ${list.length}`) : null,
      stage,
      h("div.det-label", h("b", { title: name, style: { fontSize: Math.max(14, Math.min(26, 190 / Math.max(nameWidth, 1))) + "px" } }, name)),
      h("div.det-info",
        h("div", h("small", "Material"), h("span.det-mat", MaterialSwatch({ id: mat.id || e.material, sw: mat.sw, card: mat.card }), h("b", mat.name))),
        h("div", h("small", "Made"), h("b", fmtDate(e.date, { month: "short", day: "numeric", year: "numeric" })))),
      e.lineage === "copy" ? h("p",`Existing copy #${e.copyNo} of ${titleOf(S.lib.find(x=>x.id===e.copyOf) || e)} · Stays on this Mac`) : e.pressed ? h("p","Already pressed") : null,
      e.lineage !== "copy" ? this.existingCopies(e,paint) : null,
      LinkTags.row(e, paint),
      (BK.deleteId === e.id ? this.deleteForm(e, paint) : h("div.actions.book-actions", main,
        h("div.book-action-row", e.lineage !== "copy" ? act("det-link", "gift", Icon("gift"), "Gift", () => { BK.deleteId = null; StudioOpen("gift", e.id); }) : null,
          e.canManage && e.lineage !== "copy" ? act("det-link.quiet2", "edit", Icon("edit"), "Edit", () => this.edit(e)) : null,
          e.canManage ? act("det-link.quiet2.danger", "delete", Icon("trash"), "Delete", () => { BK.deleteId = e.id; paint(); }) : null))));
  },
  existingCopies(e,paint) {
    const copies=PetaMath.newestBookEntries(S.lib).filter(x=>x.copyOf===e.id);
    return copies.length ? h("div.book-copies",h("small","Existing copies"),copies.map(copy=>h("button.btn.quiet.small",{on:{click:()=>{BK.sel=copy.id;BK.day=PetaMath.bookDateKey(copy.date);paint(true);}}},`Copy #${copy.copyNo}`))) : null;
  },
  deleteForm(e, paint) {
    return h("div.book-delete", { role: "group", "aria-label": "Confirm sticker deletion" },
      h("b", "Delete this sticker?"), h("p", "Remove it from your Collection, desktop and print queue. Gifts already sent stay with their recipients."),
      h("div.book-action-row", h("button.btn.book-action.secondary", { data: { action: "delete-cancel" }, on: { click: () => { BK.deleteId = null; paint(); } } }, "Cancel"),
        h("button.btn.book-action.danger", { data: { action: "delete-confirm" }, on: { click: async ev => {
          const button = ev.currentTarget; button.disabled = true; Bridge.busy = true;
          try { await Bridge.invoke("sticker_delete_original", { stickerId: e.id }); BK.deleteId = null; BK.sel = null; await Bridge.reload(); Shell.refresh(); Shell.toast("Sticker deleted."); }
          catch(err) { Shell.toast(String(err)); button.disabled = false; }
          finally { Bridge.busy = false; }
        } } }, "Delete")));
  },
  async edit(e) {
    try { await Bridge.invoke("creator_cancel"); crReset(); CR.editing = e.id; CR.name = e.name || ""; CR.stage = "cutting"; CR.samplePhoto = null; await Shell.open("create"); await Bridge.invoke("creator_edit_original", { stickerId: e.id }); }
    catch(err) { crReset(); await Shell.open("book"); Shell.toast(String(err)); }
  },
  async stick(e) {
    S.pickMode = false; BK.sel = null; Snd.tap();
    try { await Bridge.printAction("daily_stick_from_collection", {stickerId:e.id}); await Desktop.print(e); } catch(err) { Shell.toast(String(err)); }
  },
};
