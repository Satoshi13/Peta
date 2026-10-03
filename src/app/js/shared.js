/* Shared page pieces + the Today page: envelope -> reveal -> the four ways to make today's Peta. */
function PageHead(title, sub, ...extra) {
  return h("header.ph", h("div.ph-text", h("p.eyebrow", sub || ""), h("h1", title)), h("div.ph-extra", ...extra));
}
const DateStamp = () => h("span.datestamp", fmtDate(S.today, { month: "short", day: "numeric" }) + " · " + fmtDate(S.today, { weekday: "short" }));
const usableMats = () => ["matte", "kraft", "holographic", "gold", "riso", "vintage"].filter((id) => !MAT[id].locked && (MAT[id].unlimited || S.stock[id] > 0));

/** A tray of material cards. Picking lifts one and tapes it down; it is what the next Create is made of. */
function MaterialTray({ w = 148, onPick, interactive = true, selected = S.chosen } = {}) {
  const tray = h("div.mtray", { role: "radiogroup", "aria-label": "Material" });
  const render = () => {
    const sel = usableMats().includes(S.chosen) ? S.chosen : usableMats()[0]; S.chosen = sel;
    tray.replaceChildren(...usableMats().map((id, i) => {
      const m = MAT[id], on = id === sel;
      const c = h("button.mcard", { role: "radio", "aria-checked": String(on), data: { m: id, sel: on }, vars: { "--w": w + "px", "--r": [-3, 2, -1.5][i % 3] + "deg" }, disabled: !interactive,
        on: { click: () => { if (S.chosen === id) return; S.chosen = id; Snd.tap(); render(); onPick && onPick(id); } } },
        h("i.art"), h("span.lab", h("b", m.name), h("small", m.rarity)), m.unlimited ? null : h("span.cnt", "×" + S.stock[id]), on ? h("i.tape.t1") : null);
      Stk.tilt(c, { max: 8, scale: 1 }); return c;
    }));
  };
  render(); tray.rerender = render; return tray;
}

const CHOICES = [
  { id: "create", key: "chCreate", label: "Create", sub: "From an image you pick" },
  { id: "book", key: "chCollection", label: "Collection", sub: "Stick one you already have" },
  { id: "gifts", key: "chGift", label: "Gift", sub: () => { const n = S.gifts.filter((g) => !g.opened).length; return n ? `${n} waiting` : "Open one that arrived"; } },
  { id: "packs", key: "chPack", label: "Pack", sub: () => { const n = S.packs.filter(packOpenable).length; return n ? "Open one at random" : S.packs.some((p) => p.left.length) ? "Welcome Pack: back tomorrow" : "All opened"; } },
];
function Choices({ compact } = {}) {
  return h("div.choices" + (compact ? ".compact" : ""), CHOICES.map((c, i) => {
    const sub = typeof c.sub === "function" ? c.sub() : c.sub, off = c.id === "packs" && !S.packs.some(packOpenable);
    return h("button.choice", { disabled: off, style: { "--i": i }, data: { id: c.id },
      on: { click: (e) => { Snd.tap(); if (c.id === "book") S.pickMode = true; Shell.go(c.id, { origin: e.currentTarget, via: "object" }); } } },
      h("span.choice-obj", { style: { backgroundImage: `var(--a-${c.key})` } }), h("b", c.label), compact ? null : h("small", sub));
  }));
}

/** A material card that is just something to look at (not a control). */
function MatCard(m, w = 132) {
  const c = h("div.mcard", { data: { m: m.id }, vars: { "--w": w + "px" } }, h("i.art"), h("span.lab", h("b", m.name), h("small", m.rarity)));
  Stk.tilt(c, { max: 9, scale: 1.03 }); return c;
}
function StuckStrip() {
  const strip = h("div.stuck-strip");
  if (!S.stuckToday.length) return strip.append(h("p.hand.empty-note", "Nothing stuck yet — your desktop is waiting.")), strip;
  S.stuckToday.forEach((id, i) => { const e = S.lib.find((l) => l.id === id); if (!e) return; const t = h("div.stuck-t", { style: { "--i": i } }); resOf(e, { max: 360 }).then((res) => t.append(Stk.el(res, res.aspect >= 1 ? 74 : 74 * res.aspect))); strip.append(t); });
  return strip;
}

function EnvelopeScene() {
  return h("div.env-scene", { role: "button", tabindex: 0, "aria-label": "Open today's material" },
    h("div.env-float",
      img("envBack", "layer back"), img("envCard", "layer card"),
      h("span.layer.pocket", img("envPocket"), h("span.env-label", "Today's", h("br"), "Material")),
      img("envFlap", "layer flap")));
}
function RevealScene(m) {
  const card = h("div.mcard.big", { data: { m: m.id }, vars: { "--w": "300px" } }, h("i.art"), h("span.lab", h("b", m.name), h("small", m.rarity)));
  return h("div.reveal-scene", { data: { m: m.id, rarity: m.rarity } },
    h("i.glow"), img("foilBack", "layer foil-back"), h("div.card-hold", card), img("foilFront", "layer foil-front"), h("i.sparkle"));
}

