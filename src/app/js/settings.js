Pages.settings = {
  build() {
    const root = h("div.page-in.settingspage");
    root.append(PageHead("Settings", "Quiet by default"));
    const name = h("input", { type: "text", value: S.name, maxlength: 40, autocomplete: "off", spellcheck: false, on: { change: async (e) => { try { S.name = (await Bridge.invoke("profile_set", { displayName: e.target.value })).displayName; e.target.value = S.name; } catch(err) { Shell.toast(String(err)); } } } });
    const sw = (label, sub, get, set) => { const b = h("button.switch", { role: "switch", "aria-checked": String(get()), on: { click: () => { set(!get()); b.setAttribute("aria-checked", String(get())); Snd.tap(); } } }, h("i")); return h("div.setrow", h("div", h("b", label), h("small", sub)), b); };
    const segRow = (label, sub, opts, get, set) => { const seg = h("div.seg", opts.map(([v, text]) => h("button", { "aria-pressed": String(get() === v), on: { click: () => { set(v); Snd.tap(); $$("button", seg).forEach((b, i) => b.setAttribute("aria-pressed", String(opts[i][0] === v))); } } }, text))); return h("div.setrow", h("div", h("b", label), h("small", sub)), seg); };
    root.append(h("div.setcard",
      h("div.setrow", h("div", h("b", "Your name on stickers"), h("small", "Printed on the back of stickers you make from now on")), name),
      segRow("Window style", "Desk lays the pages on a cutting mat; Studio is a clean sidebar window", [["desk", "Desk"], ["studio", "Studio"]], () => S.shell, (v) => { Shell.setShell(v); }),
      sw("Sounds", "Paper, tear, and the little peta", () => Snd.on, (v) => { Snd.on = v; S.sound = v; Bridge.savePreferences(); }),
      sw("Haptics", "A small tap when you stick, peel, or break a seal", () => Haptic.on, (v) => { Haptic.on = v; S.haptics = v; Bridge.savePreferences(); }),
      sw("Put away on outside click", "A click on the desktop closes the window, like a menu", () => S.closeOutside, (v) => { S.closeOutside = v; Bridge.savePreferences(); }),
      sw("Reduce motion", "Skips page turns and ceremonies' flourishes", () => document.documentElement.dataset.motion === "reduce", (v) => { document.documentElement.dataset.motion = v ? "reduce" : "full"; S.motion = v ? "reduce" : "full"; Bridge.savePreferences(); })));
    root.append(h("p.muted.fine", "In the real app this window also hosts Cutting Mat, the Sticker Book, Packs and Gifts — what used to be four separate windows. Stickers stay on your desktop; this window comes and goes from the menu bar."));
    return root;
  },
};
