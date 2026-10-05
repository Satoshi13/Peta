/* Sticker Book: a page per month, a detail card you can turn over, peel / gift / stick-as-today. */
const BK = { sel: null, gift: false, anim: false };

const monthKey = (d) => d.getFullYear() * 12 + d.getMonth();
const monthName = (k) => fmtDate(new Date(Math.floor(k / 12), k % 12, 1), { month: "long", year: "numeric" });
const monthShort = (k) => fmtDate(new Date(Math.floor(k / 12), k % 12, 1), { month: "short" });

function BackCard(entry) {
  const recv = entry.kind === "received", mat = MAT[entry.material];
  const row = (l, ...v) => h("div.row", h("span.label", l), v.filter(Boolean).map((t) => h("span.value", t)));
  const card = h("div.back-card", { data: { kind: entry.kind, mat: entry.material } },
    h("div.face",
      recv ? null : h("div.stamp", "ORIGINAL"),
      h("div.rows", row("Created by", recv ? entry.from : S.name, fmtDate(entry.date, { month: "short", day: "numeric", year: "numeric" })),
        recv ? row("Received from", entry.from, fmtDate(S.today, { month: "short", day: "numeric", year: "numeric" })) : null, row("Material", mat.name)),
      h("div.number", recv ? `Edition #${pad4(entry.edition || 1)}` : `No. ${pad4(entry.no)}`),
      h("i.peta-mark"), h("small.code", `PETA-${(entry.id + "A6F4").slice(0, 4).toUpperCase()}-${pad4(entry.no || entry.edition || 1).slice(1)}Q2`)));
  if (entry.material === "holographic" || entry.material === "gold") onPointerFollow(card, (x, y) => { card.style.setProperty("--sx", (1 - x) * 100 + "%"); card.style.setProperty("--sy", (1 - y) * 100 + "%"); });
  return card;
}

async function BackingFront(entry) {
  const res = await resOf(entry, { max: 420 });
  const el = h("div.backing", { data: { mat: entry.material } }, h("i.tape.t3"), Stk.el(res, res.aspect >= 1 ? 170 : 170 * res.aspect));
  return el;
}

function peelFromDesk(id) {
  const i = S.desk.findIndex((d) => d.id === id); if (i < 0) return false;
  const node = $$(".desk-stk").find((n) => n.dataset.id === id);
  S.desk.splice(i, 1);
  if (node) { Snd.swoosh(); anim(node, [{ transform: `translate(-50%,-50%) rotate(var(--rot,0deg)) scale(1)`, opacity: 1 }, { transform: "translate(-50%,-70%) rotate(-12deg) scale(1.15)", opacity: 1, offset: .35 }, { transform: "translate(-50%,-70%) rotate(-20deg) scale(.4)", opacity: 0 }], { duration: 520, easing: EASE.inOut }).then(() => node.remove()); }
  return true;
}

Pages.book = {
  build() {
    const root = h("div.page-in.bookpage");
    const months = [...new Set(S.lib.map((e) => monthKey(e.date)))].sort((a, b) => b - a);
    if (S.bookMonth == null || !months.includes(S.bookMonth)) S.bookMonth = months[0];
    const paint = () => {
      const items = S.lib.filter((e) => monthKey(e.date) === S.bookMonth).sort((a, b) => a.date - b.date);
      const sel = S.lib.find((e) => e.id === BK.sel);
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
    const b = h("button.tile", { "aria-pressed": String(BK.sel === e.id), style: { "--i": i }, on: { click: () => { BK.sel = BK.sel === e.id ? null : e.id; BK.gift = false; Snd.tap(); paint(); } } },
      holder, h("small", fmtDate(e.date), " · ", titleOf(e)), onDesk ? h("i.on-desk", "on desktop") : null, e.kind === "received" ? h("i.recv", "gift") : null);
    Stk.tilt(holder, { max: 8, scale: 1.04 }); return b;
  },
  detail(e, paint) {
    const mat = MAT[e.material], onDesk = S.desk.some((d) => d.id === e.id), flip = h("div.flip-inner"), front = h("div.flip-face.f-front"), back = h("div.flip-face.f-back", BackCard(e));
    BackingFront(e).then((el) => front.append(el)); flip.append(front, back);
    let turned = false;
    const turn = h("button.btn.paper.small", { on: { click: () => { turned = !turned; Snd.flip(); flip.classList.toggle("turned", turned); turn.textContent = turned ? "Turn back" : "Turn over"; } } }, "Turn over");
    const form = BK.gift ? this.giftForm(e, paint) : null;
    return h("aside.detail", { role: "dialog", "aria-label": "Sticker details" },
      h("button.x", { "aria-label": "Close", on: { click: () => { BK.sel = null; BK.gift = false; paint(); } } }, "✕"),
      h("div.flip-stage", flip), h("div.turn-row", turn),
      form || h("div.actions",
        onDesk ? h("button.btn.paper", { on: { click: () => { peelFromDesk(e.id); Shell.toast("Peeled off — it's waiting in your Book."); paint(); } } }, "Peel off the desktop") : h("button.btn", { on: { click: () => this.stick(e) } }, "Stick on the desktop"),
        h("button.btn.paper.small", { on: { click: () => { BK.gift = true; paint(); } } }, "Gift…")),
      h("dl", h("dt", "Name"), h("dd", titleOf(e)), h("dt", "Material"), h("dd", h("span.seal", { data: { rarity: mat.rarity } }, mat.name)), h("dt", "Made"), h("dd", fmtDate(e.date, { month: "short", day: "numeric", year: "numeric" })),
        h("dt", e.kind === "received" ? "Edition" : "No."), h("dd", e.kind === "received" ? "#" + pad4(e.edition) : pad4(e.no))),
      h("ul.history", h("li", h("span", e.kind === "received" ? `Received from ${e.from}` : `Created by ${S.name}`), h("span", fmtDate(e.date))), onDesk ? h("li", h("span", "Stuck on the desktop"), h("span", "now")) : null));
  },
  giftForm(e, paint) {
    const to = h("input", { type: "text", maxlength: 40, placeholder: "Who is it for?", autocomplete: "off" }), note = h("input", { type: "text", maxlength: 140, placeholder: "(optional)", autocomplete: "off" });
    return h("form.gift-form", { on: { submit: (ev) => { ev.preventDefault(); GiftSeal(e, to.value.trim() || "a friend", note.value.trim()).then(() => { BK.gift = false; paint(); }); } } },
      h("label", "To", to), h("label", "A few words", note),
      h("div.row-btns", h("button.btn.stamp", { type: "submit" }, "Seal & save…"), h("button.link", { type: "button", on: { click: () => { BK.gift = false; paint(); } } }, "Cancel")),
      h("small.muted", "You give a copy; yours stays in your book. The file holds only the finished sticker — never your photo."));
  },
  async stick(e) {
    S.pickMode = false; BK.sel = null; Snd.tap();
    await Desktop.print(e);
  },
};
