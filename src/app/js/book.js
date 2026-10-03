/* Sticker Book: a page per month, a detail card you can turn over, peel / gift / stick-as-today. */
const BK = { sel: null, gift: false, anim: false, deleteId: null };

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
  build() {
    const root = h("div.page-in.bookpage");
    const months = [...new Set(S.lib.map((e) => monthKey(e.date)))].sort((a, b) => b - a);
    if (!months.length) months.push(monthKey(S.today));
    if (S.bookMonth == null || !months.includes(S.bookMonth)) S.bookMonth = months[0];
    const paint = () => {
      const items = S.lib.filter((e) => monthKey(e.date) === S.bookMonth).sort((a, b) => a.date - b.date);
      const sel = S.lib.find((e) => e.id === BK.sel && monthKey(e.date) === S.bookMonth);
      root.replaceChildren(
        PageHead("Book", "Sticker Book", S.pickMode ? h("div.pick-banner", h("span", "Choose one to stick on the desktop"), h("button.link", { on: { click: () => { S.pickMode = false; paint(); } } }, "Cancel")) : null),
        h("nav.months", months.map((k) => h("button.month", { "aria-current": k === S.bookMonth ? "true" : null, on: { click: () => { if (k === S.bookMonth) return; S.bookMonth = k; BK.sel = null; Snd.flip(); this.turn(root, paint); } } },
          monthShort(k), h("small", S.lib.filter((e) => monthKey(e.date) === k).length)))),
        h("div.bk" + (sel ? ".has-detail" : ""),
          h("div.bk-main", h("h2.month-title", monthName(S.bookMonth)), h("p.muted", `${items.length} sticker${items.length === 1 ? "" : "s"}`), h("div.bk-grid", items.map((e, i) => this.tile(e, i, paint)))),
          sel ? this.detail(sel, paint) : null));
    };
    paint(); return root;
  },
  async turn(root, paint) { const g = $(".bk", root); if (g) await anim(g, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-26px) rotate(-.8deg)" }], { duration: 160, easing: "ease-in" }); paint(); const n = $(".bk", root); anim(n, [{ opacity: 0, transform: "translateX(26px) rotate(.8deg)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: EASE.out }); },
  tile(e, i, paint) {
    const holder = h("div.tile-stk"), onDesk = S.desk.some((d) => d.id === e.id);
    resOf(e, { max: 360 }).then((res) => holder.append(Stk.el(res, res.aspect >= 1 ? 128 : 128 * res.aspect)));
    const b = h("button.tile", { "aria-pressed": String(BK.sel === e.id), style: { "--i": i }, on: { click: () => { BK.sel = BK.sel === e.id ? null : e.id; BK.gift = false; BK.deleteId = null; Snd.tap(); paint(); } } },
      holder, h("small", fmtDate(e.date), " · ", titleOf(e)), onDesk ? h("i.on-desk", "on desktop") : null, e.kind === "received" ? h("i.recv", "gift") : null);
    Stk.tilt(holder, { max: 8, scale: 1.04 }); return b;
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
      form || (BK.deleteId === e.id ? this.deleteForm(e, paint) : h("div.actions.book-actions",
        onDesk ? h("button.btn.book-action.primary", { data: { action: "peel" }, on: { click: async () => { await peelFromDesk(e.id); Shell.toast("Peeled off — it's waiting in your Book."); paint(); } } }, "Peel off desktop") : h("button.btn.book-action.primary", { data: { action: "stick" }, on: { click: () => this.stick(e) } }, "Stick on desktop"),
        h("div.book-action-row", h("button.btn.book-action.secondary", { data: { action: "gift" }, on: { click: () => { BK.deleteId = null; BK.gift = true; paint(); } } }, "Gift…"),
          e.canManage ? h("button.btn.book-action.secondary", { data: { action: "edit" }, on: { click: () => this.edit(e) } }, "Edit") : null),
        e.canManage ? h("button.btn.book-action.danger", { data: { action: "delete" }, on: { click: () => { BK.deleteId = e.id; paint(); } } }, "Delete…") : null)),
      h("dl", h("dt", "Name"), h("dd", titleOf(e)), h("dt", "Material"), h("dd", h("span.seal", { data: { rarity: mat.rarity } }, mat.name)), h("dt", "Made"), h("dd", fmtDate(e.date, { month: "short", day: "numeric", year: "numeric" })),
        h("dt", e.kind === "received" ? "Edition" : "No."), number),
      history);
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
