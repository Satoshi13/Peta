/* Packs: a shelf of pouches. Tearing one open is the ceremony in pack.js. */
Pages.packs = {
  build() {
    const root = h("div.page-in.packspage"), locked = false;
    root.append(PageHead("Packs", "Open one at random", h("span.quota", { "aria-live": "polite" }, h("b", "Welcome Pack"), ` ${S.packAvailable ? 0 : 1} of 1 today`, h("small", "resets at midnight · other packs open any time"))));
    const total = S.packs.reduce((a, p) => a + p.left.length, 0);
    const items = [
      ...S.packs.map((p) => ({ ...p, empty: !p.left.length })),
    ];
    root.append(h("p.muted.lede", "Opening a pack gives you one sticker, picked at random. The Welcome Pack opens once a day; packs you get from the Market open any time, as often as you like."));
    root.append(h("div.shelf", items.map((p, i) => this.pack(p, i, locked)), h("i.ledge")));
    root.append(h("p.shelf-note.muted", total ? `${total} sticker${total === 1 ? "" : "s"} still sealed.` : "Every pack is open."));
    return root;
  },
  pack(p, i, locked) {
    const off = p.empty || !packOpenable(p), n = Math.min(3, p.left.length || 1);
    const stack = h("div.pk-stack", Array.from({ length: n }, (_, k) => h("i.pk-img" + ((p.kind || "holo") === "holo" && p.hue ? ".tinted" : ""), { style: { "--k": k, "--hue": p.hue + "deg", "--pk": packVar(p.kind) } }, k === n - 1 && (p.kind || "holo") === "holo" ? h("i.sheen") : null)));
    const card = h("button.pack", { disabled: off, "aria-label": `${p.title}, ${p.left.length} left`, data: { empty: p.empty, pack: p.id }, style: { "--i": i }, on: { click: () => { Snd.tap(); Cer.openPack(p); } } },
      stack,
      h("span.pack-tag", h("b.hand", p.title), h("small", `by ${p.by} · ${p.empty ? "all opened" : p.daily ? p.left.length + " of " + p.total + " left" : p.left.length + " left · " + p.total + " total"}`), h("small.rule", p.empty ? "" : p.daily ? (packsLeftToday() ? "once a day" : "back tomorrow") : "open any time")),
      h("span.open-cta", { "aria-hidden": off ? "true" : null, style: { visibility: off ? "hidden" : "visible" } }, "Open one"));
    if (!off) { onPointerFollow(card, (x, y) => { stack.style.setProperty("--sx", (1 - x) * 100 + "%"); stack.style.setProperty("--sy", (1 - y) * 100 + "%"); stack.style.setProperty("--ry", (x - .5) * 14 + "deg"); stack.style.setProperty("--rx", -(y - .5) * 10 + "deg"); }, () => { stack.style.setProperty("--ry", "0deg"); stack.style.setProperty("--rx", "0deg"); stack.style.setProperty("--sx", "30%"); stack.style.setProperty("--sy", "30%"); }); }
    return card;
  },
};
