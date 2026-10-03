/* Gifts (inbox), Materials (the Material Book), Settings. */
Pages.gifts = {
  build() {
    const root = h("div.page-in.giftspage"), locked = false;
    const waiting = S.gifts.filter((g) => !g.opened), got = S.gifts.filter((g) => g.opened);
    root.append(PageHead("Gifts", "Sealed until you open them", h("span.quota", h("b", "No daily limit"), h("small", "open each one whenever you like"))));
    root.append(h("p.muted.lede", "A friend can send you a Peta as a small file. It stays sealed until you open it. Opening a gift never uses up a material."));
    root.append(waiting.length
      ? h("div.inbox", waiting.map((g, i) => h("button.gift", { disabled: locked, style: { "--i": i, "--r": [-3, 2.5, -1.5][i % 3] + "deg" }, on: { click: () => { Snd.tap(); Cer.openGift(g); } } },
          img("arrGift", "g-env"), h("span.g-from.hand", h("small", "from"), g.from), locked ? null : h("span.open-cta", "Open"))))
      : h("div.empty", h("p.hand", "Nothing has arrived yet."), h("p.muted", "When a friend sends you a .peta file, it lands here.")));
    root.append(h("div.gift-actions", h("button.btn.paper", { on: { click: () => this.receiveFile() } }, "Open a gift file…"), got.length ? h("span.muted.small", `${got.length} already opened and kept in your Book`) : null));
    return root;
  },
  receiveFile() {
    const names = ["Mika", "Ren", "Sora"], src = pick(["sCamera", "sPlant", "sPolaroid", "sEgg", "sBlueFlower"]);
    S.gifts.push({ id: "G" + (S.gifts.length + 1), from: pick(names), note: pick(["happy birthday", "", "saw this and thought of you"]), src, material: rollMaterial(), edition: Math.floor(rand(3, 90)), opened: false });
    Snd.chime(2, 740); Shell.toast("A sealed gift arrived."); Shell.renderNav(); Shell.refresh();
  },
};

Pages.materials = {
  build() {
    const root = h("div.page-in.materialspage");
    root.append(PageHead("Materials", "Material Book"));
    root.append(h("p.muted.lede", "Open Today's Material to add to your book. A material is a way of making stickers. Each one is used up when you make a sticker with it — except plain paper, which never runs out."));
    const grid = h("div.mgrid", Object.values(MAT).map((m, i) => {
      const lock = !!m.locked, on = !lock && S.chosen === m.id;
      const card = h("button.mbook", { "aria-pressed": String(on), disabled: lock, style: { "--i": i }, on: { click: () => { if (lock) return; S.chosen = m.id; Snd.tap(); Shell.toast(`Create will use ${m.name}.`); this.mark(grid); } } },
        h("div.mc", h("div.mcard" + (lock ? ".locked" : ""), { data: { m: lock ? "matte" : m.id }, vars: { "--w": "190px" } }, h("i.art"), h("span.lab", lock ? h("b", "?") : [h("b", m.name), h("small", m.rarity)]))),
        h("div.mmeta", h("b", lock ? "Not found yet" : m.name), h("span.seal", { data: { rarity: m.rarity } }, lock ? "locked" : m.rarity),
          h("small", lock ? "Open Today's Material to find it" : m.unlimited ? "Always available" : `${S.stock[m.id]} in stock · found ${m.found}`), lock ? null : h("small.recipe", m.recipe)));
      if (!lock) Stk.tilt($(".mcard", card), { max: 9, scale: 1.03 });
      return card;
    }));
    root.append(grid); return root;
  },
  mark(grid) { $$(".mbook", grid).forEach((b, i) => b.setAttribute("aria-pressed", String(Object.values(MAT)[i].id === S.chosen))); },
};

Pages.settings = {
  build() {
    const root = h("div.page-in.settingspage");
    root.append(PageHead("Settings", "Quiet by default"));
    const name = h("input", { type: "text", value: S.name, maxlength: 40, autocomplete: "off", spellcheck: false, on: { input: (e) => (S.name = e.target.value || "Me") } });
    const sw = (label, sub, get, set) => { const b = h("button.switch", { role: "switch", "aria-checked": String(get()), on: { click: () => { set(!get()); b.setAttribute("aria-checked", String(get())); Snd.tap(); } } }, h("i")); return h("div.setrow", h("div", h("b", label), h("small", sub)), b); };
    const segRow = (label, sub, opts, get, set) => { const seg = h("div.seg", opts.map(([v, text]) => h("button", { "aria-pressed": String(get() === v), on: { click: () => { set(v); Snd.tap(); $$("button", seg).forEach((b, i) => b.setAttribute("aria-pressed", String(opts[i][0] === v))); } } }, text))); return h("div.setrow", h("div", h("b", label), h("small", sub)), seg); };
    root.append(h("div.setcard",
      h("div.setrow", h("div", h("b", "Your name on stickers"), h("small", "Printed on the back of stickers you make from now on")), name),
      segRow("Window style", "Desk lays the pages on a cutting mat; Studio is a clean sidebar window", [["desk", "Desk"], ["studio", "Studio"]], () => S.shell, (v) => { Shell.setShell(v); }),
      segRow("Close button", "The little hand-made ✕ at the top of the window", [["pencil", "Pencil"], ["stitch", "Stitch"], ["tape", "Tape"], ["wax", "Wax"]], () => S.closeStyle, (v) => Shell.setClose(v)),
      sw("Sounds", "Paper, tear, and the little peta", () => Snd.on, (v) => { Snd.on = v; S.sound = v; $("#tb-sound").setAttribute("aria-pressed", String(v)); }),
      sw("Put away on outside click", "A click on the desktop closes the window, like a menu", () => S.closeOutside, (v) => { S.closeOutside = v; }),
      sw("Reduce motion", "Skips page turns and ceremonies' flourishes", () => document.documentElement.dataset.motion === "reduce", (v) => { document.documentElement.dataset.motion = v ? "reduce" : "full"; S.motion = v ? "reduce" : "full"; })));
    root.append(h("p.muted.fine", "In the real app this window also hosts Cutting Mat, the Sticker Book, Packs and Gifts — what used to be four separate windows. Stickers stay on your desktop; this window comes and goes from the menu bar."));
    return root;
  },
};
