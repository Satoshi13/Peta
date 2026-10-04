/* Sticker Book: a list or local-date calendar, a detail card you can turn over, peel / gift / stick-as-today. */
const BK = { sel: null, gift: false, anim: false, deleteId: null, day: null, completed: new Set() };

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
      ? `Edition #${back.editionNumber}`
      : "";
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
    const select = (e) => { BK.sel = BK.sel === e.id && BK.day === PetaMath.bookDateKey(e.date) ? null : e.id; BK.day = PetaMath.bookDateKey(e.date); BK.gift = false; BK.deleteId = null; Snd.tap(); paint(); };
    const paint = () => {
      this.leave();
      this.observer = new IntersectionObserver(records => {
        for(const record of records) if(record.isIntersecting) { this.observer?.unobserve(record.target); record.target._load?.(); }
      }, { root, rootMargin: "80px" });
      const items = PetaMath.newestBookEntries(S.lib);
      const sel = items.find(e => e.id === BK.sel && PetaMath.bookDateKey(e.date) === BK.day) || items.find(e => e.id === BK.sel);
      const view = h("div.seg.book-view", { role: "group", "aria-label": "Book view" }, ["list", "calendar"].map(v => h("button", { "aria-pressed": String(S.bookView === v), on: { click: () => {
        if(S.bookView === v) return; S.bookView = v;
        if(v === "calendar" && sel) S.bookMonth = monthKey(sel.date);
        Bridge.savePreferences(); paint();
      } } }, v === "list" ? "List" : "Calendar")));
      const main = h("div.bk-main");
      if(S.bookView === "calendar") main.append(this.calendar(items, select, root, paint));
      else main.append(h("p.muted.book-count", `${items.length} sticker${items.length === 1 ? "" : "s"}`), items.length ? h("div.bk-grid", items.map((e,i) => this.tile(e,i,select))) : h("p.hand.empty-note", "Your Book is waiting for its first sticker."));
      root.replaceChildren(PageHead("Book", "Sticker Book", view, h("button.btn.paper.small", {disabled:S.lib.length<3,on:{click:()=>PackMaker.open()}}, "Make a Pack…")),
        ...(S.pickMode ? [h("div.pick-banner", h("span", "Choose one to stick on the desktop"), h("button.link", { on: { click: () => { S.pickMode = false; paint(); } } }, "Cancel"))] : []),
        h("div.bk" + (sel ? ".has-detail" : ""), main, sel ? this.detail(sel, paint) : null));
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
  lazySticker(holder, entry, size) {
    holder._load = () => {
      holder._load = null;
      resOf(entry).then(res => { if(!holder.isConnected) return; const sticker = Stk.el(res, res.aspect >= 1 ? size : size * res.aspect); sticker.style.setProperty("--aspect", res.aspect); holder.append(sticker); }).catch(err => Shell.toast(String(err)));
    };
    this.observer.observe(holder);
  },
  tile(e, i, select) {
    const holder = h("div.tile-stk"), onDesk = S.desk.some(d => d.id === e.id);
    this.lazySticker(holder, e, 128);
    return h("button.tile", { data: { sticker: e.id }, "aria-pressed": String(BK.sel === e.id && BK.day === PetaMath.bookDateKey(e.date)), style: { "--i": Math.min(i, 8) }, on: { click: () => select(e) } },
      holder, h("small", fmtDate(e.date), " · ", titleOf(e)), onDesk ? h("i.on-desk", "on desktop") : null, e.kind === "received" ? h("i.recv", "gift") : null);
  },
  calendar(items, select, root, paint) {
    const current = monthKey(S.today), earliest = Math.min(current, ...items.map(e => monthKey(e.date)));
    S.bookMonth = clamp(S.bookMonth ?? current, earliest, current);
    let weekStart = 0;
    try { const locale = new Intl.Locale(navigator.language); weekStart = (locale.getWeekInfo?.() || locale.weekInfo)?.firstDay % 7 || 0; } catch {}
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
      return h("div.calendar-day."+cell.state, contents, cell.state === "past" ? h("small.calendar-rest", "rest") : null);
    }));
    return h("div.calendar-ledger", heading, weekdays, grid);
  },
  detail(e, paint) {
    const mat = MAT[e.material], onDesk = S.desk.some((d) => d.id === e.id), flip = h("div.flip-inner"), front = h("div.flip-face.f-front"), back = h("div.flip-face.f-back", BackCard(e));
    BackingFront(e).then((el) => front.append(el)); flip.append(front, back);
    let turned = false;
    const turn = h("button.flip-stage.book-flip", { type: "button", "aria-label": "Show sticker back", "aria-pressed": "false", on: { click: () => {
      turned = !turned; Snd.flip(); flip.classList.toggle("turned", turned);
      turn.setAttribute("aria-pressed", String(turned)); turn.setAttribute("aria-label", turned ? "Show sticker front" : "Show sticker back");
    } } }, flip);
    const history = h("ul.history"), number = h("dd", e.kind === "received" ? "—" : pad4(e.no));
    Bridge.invoke("sticker_back", {stickerId:e.id}).then(b => {
      if (!b) return;
      number.textContent = b.kind === "received" ? (b.editionNumber ? "#"+b.editionNumber : "—") : (b.originalNumber || "—");
      const labels = {created:"Created by",received:"Received from",pack_opened:"Pack opened",stuck:"Stuck on the desktop",peeled:"Peeled off",sent:"Gift sent to"};
      history.replaceChildren(...b.history.map(p=>h("li",h("span",(labels[p.type] || p.type)+(p.by?" "+p.by:"")),h("span",p.on))));
    }).catch(err=>Shell.toast(String(err)));
    const form = BK.gift ? this.giftForm(e, paint) : null;
    return h("aside.detail", { role: "dialog", "aria-label": "Sticker details" },
      h("button.x", { "aria-label": "Close", on: { click: () => { BK.sel = null; BK.gift = false; BK.deleteId = null; paint(); } } }, "✕"),
      turn,
      S.bookView === "calendar" ? this.dayChoices(e, paint) : null,
      form || (BK.deleteId === e.id ? this.deleteForm(e, paint) : h("div.actions.book-actions",
        onDesk ? h("button.btn.book-action.primary", { data: { action: "peel" }, on: { click: async () => { await peelFromDesk(e.id); Shell.toast("Peeled off — it's waiting in your Book."); paint(); } } }, "Peel off desktop") : h("button.btn.book-action.primary", { data: { action: "stick" }, on: { click: () => this.stick(e) } }, "Stick on desktop"),
        h("div.book-action-row", h("button.btn.book-action.secondary", { data: { action: "gift" }, on: { click: () => { BK.deleteId = null; BK.gift = true; paint(); } } }, "Gift…"),
          e.canManage ? h("button.btn.book-action.secondary", { data: { action: "edit" }, on: { click: () => this.edit(e) } }, "Edit") : null),
        e.canManage ? h("button.btn.book-action.danger", { data: { action: "delete" }, on: { click: () => { BK.deleteId = e.id; paint(); } } }, "Delete…") : null)),
      h("dl", h("dt", "Name"), h("dd", titleOf(e)), h("dt", "Material"), h("dd", h("span.seal", { data: { rarity: mat.rarity } }, mat.name)), h("dt", "Made"), h("dd", fmtDate(e.date, { month: "short", day: "numeric", year: "numeric" })),
        h("dt", e.kind === "received" ? "Edition" : "No."), number),
      history);
  },
  dayChoices(e, paint) {
    const peers = PetaMath.newestBookEntries(S.lib.filter(p => PetaMath.bookDateKey(p.date) === PetaMath.bookDateKey(e.date)));
    if(peers.length < 2) return null;
    return h("div.book-day-choices", {role:"group", "aria-label":"Stickers on this day"}, peers.map(p => {
      const button = h("button", {"aria-label":titleOf(p), "aria-pressed":String(p.id===e.id), on:{click:()=>{BK.sel=p.id;BK.gift=false;BK.deleteId=null;paint();}}});
      resOf(p).then(res => {if(button.isConnected) button.append(Stk.el(res, res.aspect >= 1 ? 38 : 38 * res.aspect));}).catch(err => Shell.toast(String(err)));
      return button;
    }));
  },
  deleteForm(e, paint) {
    return h("div.book-delete", { role: "group", "aria-label": "Confirm sticker deletion" },
      h("b", "Delete this sticker?"), h("p", "Remove it from your Book, desktop and print queue. Gifts already sent stay with their recipients."),
      h("div.book-action-row", h("button.btn.book-action.secondary", { data: { action: "delete-cancel" }, on: { click: () => { BK.deleteId = null; paint(); } } }, "Cancel"),
        h("button.btn.book-action.danger", { data: { action: "delete-confirm" }, on: { click: async ev => {
          const button = ev.currentTarget; button.disabled = true; Bridge.busy = true;
          try { await Bridge.invoke("sticker_delete_original", { stickerId: e.id }); BK.deleteId = null; BK.sel = null; await Bridge.reload(); Shell.refresh(); Shell.toast("Sticker deleted."); }
          catch(err) { Shell.toast(String(err)); button.disabled = false; }
          finally { Bridge.busy = false; }
        } } }, "Delete")));
  },
  async edit(e) {
    try { await Bridge.invoke("creator_cancel"); crReset(); CR.editing = e.id; CR.stage = "cutting"; CR.samplePhoto = null; await Shell.open("create"); await Bridge.invoke("creator_edit_original", { stickerId: e.id }); }
    catch(err) { crReset(); await Shell.open("book"); Shell.toast(String(err)); }
  },
  giftForm(e, paint) {
    const to = h("input", { type: "text", maxlength: 40, placeholder: "Who is it for?", autocomplete: "off" }), note = h("input", { type: "text", maxlength: 140, placeholder: "(optional)", autocomplete: "off" });
    return h("form.gift-form", { on: { submit: (ev) => { ev.preventDefault(); GiftSeal(e, to.value.trim() || "a friend", note.value.trim()).then(() => { BK.gift = false; paint(); }); } } },
      h("label", "To", to), h("label", "A few words", note),
      h("div.book-action-row", h("button.btn.book-action.secondary", { type: "button", on: { click: () => { BK.gift = false; paint(); } } }, "Cancel"), h("button.btn.book-action.primary", { type: "submit" }, "Seal & save…")),
      h("small.muted", "You give a copy; yours stays in your book. The file holds only the finished sticker — never your photo."));
  },
  async stick(e) {
    S.pickMode = false; BK.sel = null; Snd.tap();
    try { await Bridge.printAction("daily_stick_from_collection", {stickerId:e.id}); await Desktop.print(e); } catch(err) { Shell.toast(String(err)); }
  },
};
