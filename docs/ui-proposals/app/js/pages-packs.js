/* Packs: a shelf of pouches. Tearing one open is the ceremony in pack.js. */
Pages.packs = {
  build() {
    const root = h("div.page-in.packspage"), locked = isDone();
    root.append(PageHead("Packs", "Open one at random", locked ? h("span.seal", { data: { rarity: "common" } }, "stuck for today") : null));
    const total = S.packs.reduce((a, p) => a + p.left.length, 0);
    const items = [
      ...S.packs.map((p) => ({ ...p, empty: !p.left.length })),
      { id: "pixel", title: "Pixel Dream", by: "Ryo", total: 24, left: [], hue: 160, empty: true },
    ];
    root.append(h("p.muted.lede", locked ? "Today's Peta is already stuck — packs open again tomorrow." : "Opening a pack gives you one sticker, picked at random. It becomes today's Peta."));
    root.append(h("div.shelf", items.map((p, i) => this.pack(p, i, locked)), h("i.ledge")));
    root.append(h("p.shelf-note.muted", total ? `${total} sticker${total === 1 ? "" : "s"} still sealed.` : "Every pack is open."));
    return root;
  },
  pack(p, i, locked) {
    const off = p.empty || locked, n = Math.min(3, p.left.length || 1);
    const stack = h("div.pk-stack", Array.from({ length: n }, (_, k) => h("i.pk-img", { style: { "--k": k, "--hue": p.hue + "deg" } }, k === n - 1 ? h("i.sheen") : null)));
    const card = h("button.pack", { disabled: off, "aria-label": `${p.title}, ${p.left.length} left`, data: { empty: p.empty }, style: { "--i": i }, on: { click: () => { Snd.tap(); Cer.openPack(p); } } },
      stack,
      h("span.pack-tag", h("b.hand", p.title), h("small", `by ${p.by} · ${p.empty ? "all opened" : p.left.length + " of " + p.total + " left"}`)),
      off ? null : h("span.open-cta", "Open one"));
    if (!off) { onPointerFollow(stack, (x, y) => { stack.style.setProperty("--sx", (1 - x) * 100 + "%"); stack.style.setProperty("--sy", (1 - y) * 100 + "%"); stack.style.setProperty("--ry", (x - .5) * 14 + "deg"); stack.style.setProperty("--rx", -(y - .5) * 10 + "deg"); }, () => { stack.style.setProperty("--ry", "0deg"); stack.style.setProperty("--rx", "0deg"); }); }
    return card;
  },
};
