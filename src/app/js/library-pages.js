/* Gifts (inbox), Materials (the Material Book), Settings. */
Pages.gifts = {
  build() {
    const root = h("div.page-in.giftspage"), locked = false;
    const waiting = S.gifts.filter((g) => !g.opened), got = S.gifts.filter((g) => g.opened);
    root.append(PageHead("Gifts", "Sealed until you open them"));
    root.append(h("p.muted.lede", "A friend can send you a Peta as a small file. It stays sealed until you open it. Opening a gift never uses up a material."));
    root.append(waiting.length
      ? h("div.inbox", waiting.map((g, i) => h("button.gift", { disabled: locked, style: { "--i": i, "--r": [-3, 2.5, -1.5][i % 3] + "deg" }, on: { click: () => { Snd.tap(); Cer.openGift(g); } } },
          img("arrGift", "g-env"), h("span.g-from.hand", h("small", "From"), g.from + (["known","official"].includes(g.signatureStatus) ? " ✓" : "")), h("small.muted", Distribution.trust(g)), locked ? null : h("span.open-cta", "Open"))))
      : h("div.empty", h("p.hand", "Nothing has arrived yet."), h("p.muted", "When a friend sends you a .peta file, it lands here.")));
    root.append(h("div.gift-actions", h("button.btn.paper", { on: { click: () => this.receiveFile() } }, "Open Peta file…"), h("button.link", {on:{click:()=>Distribution.redeem()}}, "Redeem Code…"), got.length ? h("span.muted.small", `${got.length} already opened and kept in your Book`) : null));
    if(S.events.length) root.append(h("section", h("h2", "From Peta ✓"), S.events.map(e=>h("article",h("b",e.title),h("p.muted.small",e.result),e.message ? h("p.small",e.message) : null))));
    return root;
  },
  async receiveFile() {
    Bridge.dialogOpen=true;
    try { const gift=await Bridge.invoke("gift_receive_file"); if(gift) { await Bridge.reload(); Shell.renderNav(); Shell.refresh(); Snd.chime(2,740); Shell.toast(gift.result); } }
    catch(e) { Shell.toast(Distribution.error(e)); } finally { Bridge.dialogOpen=false; }
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

/* Native dialog semantics provide focus trapping and Escape without changing the paper UI. */
const Distribution = {
  error(value) { return String(value).replace(/^invalid_signature:\s*/, "").replace(/^unknown_key:\s*/, "").replace("gift_already_received", "This gift was already received."); },
  trust(g) {
    if(g.signatureStatus==="official") return "Official Peta file";
    if(g.signatureStatus==="known") return `${g.fingerprint} · Same key`;
    if(g.signatureStatus==="new") return `${g.fingerprint} · New friend`;
    if(g.signatureStatus==="warning") return `${g.fingerprint} · Same name, different key`;
    return "Unsigned";
  },
  sender(g) {
    if(g.signatureStatus === "official") return "Peta ✓";
    if(g.signatureStatus === "known") return `${g.from} ✓ (${g.fingerprint})`;
    if(g.signatureStatus === "new") return `${g.from} (${g.fingerprint}) · New friend`;
    if(g.signatureStatus === "warning") return `${g.from} (${g.fingerprint}) · Same name, different key`;
    return `${g.from} · Unsigned`;
  },
  redeem() {
    if(document.querySelector("dialog")) return;
    const input=h("input", {type:"text",maxLength:1024,required:true,placeholder:"PETA1-…",autocapitalize:"characters",spellcheck:false});
    const status=h("p.small",{role:"status"}), submit=h("button.btn",{type:"submit"},"Redeem"),cancel=h("button.btn.paper",{type:"button",on:{click:()=>dialog.close()}},"Cancel");let pending=false;
    const form=h("form.gift-form",{on:{submit:async e=>{
      e.preventDefault();if(pending) return;pending=true;submit.disabled=true;cancel.disabled=true;input.disabled=true;
      try {const result=await Bridge.invoke("redeem_code",{code:input.value});await Bridge.reload();dialog.close();Shell.refresh();Shell.toast(result.result);}
      catch(error){status.textContent=this.error(error);}
      finally {pending=false;submit.disabled=false;cancel.disabled=false;input.disabled=false;}
    }}},h("h2","Redeem Code"),h("label","Peta code",input),h("small.muted","Codes work once on this device. Files with pictures use Open Peta file…"),status,h("div.row-btns",cancel,submit));
    const dialog=h("dialog",{"aria-label":"Redeem Peta code",on:{cancel:e=>{e.stopPropagation();if(pending)e.preventDefault();},keydown:e=>{if(e.key==="Escape")e.stopPropagation();},close:()=>{Bridge.dialogOpen=false;dialog.remove();}}},form);
    Bridge.dialogOpen=true;document.body.append(dialog);dialog.showModal();input.focus();
  },
};
