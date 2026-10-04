/* Gifts (inbox), Materials (the Material Book), Settings. */
Pages.gifts = {
  build() {
    const root = h("div.page-in.giftspage"), locked = false;
    const waiting = S.gifts.filter((g) => !g.opened), got = S.gifts.filter((g) => g.opened);
    root.append(PageHead("Gifts", "Sealed until you open them"));
    root.append(h("p.muted.lede", "A friend can send you a Peta as a small file. It stays sealed until you open it. Opening a gift never uses up a material."));
    root.append(waiting.length
      ? h("div.inbox", waiting.map((g, i) => h("button.gift", { disabled: locked, style: { "--i": i, "--r": [-3, 2.5, -1.5][i % 3] + "deg" }, on: { click: () => { Snd.tap(); Cer.openGift(g); } } },
          img("arrGift", "g-env"), h("span.g-from.hand", h("small", "from"), g.from), locked ? null : h("span.open-cta", "Open"))))
      : h("div.empty", h("p.hand", "Nothing has arrived yet."), h("p.muted", "When a friend sends you a .peta file, it lands here.")));
    root.append(h("div.gift-actions", h("button.btn.paper", { on: { click: () => this.receiveFile() } }, "Open a gift file…"), got.length ? h("span.muted.small", `${got.length} already opened and kept in your Book`) : null));
    return root;
  },
  async receiveFile() {
    Bridge.dialogOpen=true;
    try { const gift=await Bridge.invoke("gift_receive_file"); if(gift) { await Bridge.reload(); Shell.renderNav(); Shell.refresh(); Snd.chime(2,740); Shell.toast("A sealed gift arrived."); } }
    catch(e) { Shell.toast(String(e)); } finally { Bridge.dialogOpen=false; }
  },
};

Pages.materials = {
  selected: null,
  build() {
    const root = h("div.page-in.materialspage");
    root.append(PageHead("Materials", "Material Book", Scraps.badge()));
    root.append(h("p.muted.lede", "Preview the materials you've found, or save unused sheets as Scraps. Plain Matte is always available and cannot be dismantled."));
    const panel = Scraps.form() || this.preview(); if(panel) root.append(panel);
    const grid = h("div.mgrid", Object.values(MAT).map((m, i) => {
      const lock = !!m.locked;
      const card = h("button.mbook", { "aria-label":`Preview ${m.name}`, "aria-expanded":String(!lock && this.selected===m.id), disabled: lock, data:{material:m.id}, style: { "--i": i }, on: { click: () => {
        if(Scraps.inFlight) return;
        this.selected=m.id; Scraps.selection=null; Snd.tap(); Shell.refresh();
        $(".materialspage").scrollTop = 0; $(".material-preview .x")?.focus({preventScroll:true});
      } } },
        h("div.mc", h("div.mcard" + (lock ? ".locked" : ""), { data: { m: lock ? "matte" : m.id }, vars: { "--w": "190px" } }, h("i.art"), h("span.lab", lock ? h("b", "?") : [h("b", m.name), h("small", m.rarity)]))),
        h("div.mmeta", h("b", lock ? "Not found yet" : m.name), h("span.seal", { data: { rarity: m.rarity } }, lock ? "locked" : m.rarity),
          h("small", lock ? "Open Today's Material to find it" : m.unlimited ? "Always available" : `${S.stock[m.id]} in stock · found ${m.found}`), lock ? null : h("small.recipe", m.recipe)));
      if (!lock) Stk.tilt($(".mcard", card), { max: 9, scale: 1.03, trigger: card });
      const rate = Scraps.material(m.id);
      return h("div.material-entry", card, h("div.material-tools", !lock && rate ? Scraps.button("dismantle", m.id, "Dismantle…", !(S.stock[m.id] > 0)) : null));
    }));
    root.append(grid); return root;
  },
  preview() {
    const m = MAT[this.selected]; if(!m || m.locked) return null;
    return h("section.material-preview", {"aria-label":`${m.name} preview`}, MatCard(m,240),
      h("div", h("h2",m.name), h("p",m.recipe), h("p.muted.small",m.unlimited ? "Always available" : `${S.stock[m.id]} sheets in stock · found ${m.found}`),
        Scraps.material(m.id) ? Scraps.button("dismantle",m.id,"Dismantle…",!(S.stock[m.id]>0)) : null),
      h("button.x", {"aria-label":"Close material preview",on:{click:()=>{const id=this.selected;this.selected=null;Shell.refresh();$(`[data-material="${id}"]`)?.focus({preventScroll:true});}}}, "✕"));
  },
};
