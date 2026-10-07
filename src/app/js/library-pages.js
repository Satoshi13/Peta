/* Gifts (inbox), Materials (the Materials), Settings. */
Pages.gifts = {
  build() {
    const root = h("div.page-in.giftspage"), locked = false;
    const waiting = S.gifts.filter((g) => !g.opened), got = S.gifts.filter((g) => g.opened);
    root.append(PageHead("Gifts", "Sealed until you open them"));
    root.append(h("p.muted.lede", "A friend can send you a Peta as a small file. It stays sealed until you open it. Opening a gift never uses up a material."));
    root.append(waiting.length
      ? h("div.inbox", waiting.map((g, i) => h("div", h("button.gift", { disabled: locked, style: { "--i": i, "--r": [-3, 2.5, -1.5][i % 3] + "deg" }, on: { click: () => { Snd.tap(); Cer.openGift(g); } } },
          img("arrGift", "g-env"), h("span.g-from.hand", h("small", "From"), g.from + (["known","official"].includes(g.signatureStatus) ? " ✓" : "")), locked ? null : h("span.open-cta", "Open")), h("p.muted.small", {style:{maxWidth:"240px",textAlign:"center"}}, Distribution.trust(g)))))
      : h("div.empty", h("p", "Nothing has arrived yet."), h("p.muted", "When a friend sends you a .peta file, it lands here.")));
    root.append(h("div.gift-actions", h("button.btn.paper", { on: { click: () => this.receiveFile() } }, "Open Peta file…"), got.length ? h("span.muted.small", `${got.length} already opened and kept in your Collection`) : null));
    if(S.events.length) root.append(h("section", h("h2", "From Peta ✓"), S.events.map(e=>h("article",h("b",e.title),h("p.muted.small",e.result),e.message ? h("p.small",e.message) : null))));
    return root;
  },
  async receiveFile() {
    Bridge.dialogOpen=true;
    try { const gift=await Bridge.invoke("gift_receive_file"); if(gift) { await Bridge.reload(); Shell.renderNav(); Shell.refresh(); Snd.chime(2,740); if(gift.pack) Distribution.offer(gift.pack);else Shell.toast(gift.result); } }
    catch(e) { Shell.toast(Distribution.error(e)); } finally { Bridge.dialogOpen=!!document.querySelector("dialog"); }
  },
};

Pages.materials = {
  selected: null,
  build() {
    const root = h("div.page-in.materialspage");
    root.append(PageHead("Materials", "Materials", Scraps.badge()));
    root.append(h("p.muted.lede", "Preview the materials you've found, or save unused sheets as Scraps. Each sticker uses one sheet."));
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
          lock ? h("small", ["matte","kraft","holographic"].includes(m.id) ? "Open Today's Material to find it" : m.id === "sakura" ? "Spring edition · official distribution" : "Find it in Market · Materials") : this.stock(m)));
      if (!lock) Stk.tilt($(".mcard", card), { max: 9, scale: 1.03, baseTransform: "rotate(-2deg)", trigger: card });
      return h("div.material-entry", card);
    }));
    root.append(grid); return root;
  },
  stock(m) {
    return h("span.material-stock", h("strong", m.unlimited ? "∞" : String(S.stock[m.id] || 0)), h("span", m.unlimited ? "Always available" : (S.stock[m.id] === 1 ? "sheet in stock" : "sheets in stock")));
  },
  preview() {
    const m = MAT[this.selected]; if(!m || m.locked) return null;
    return h("section.material-preview", {"aria-label":`${m.name} preview`}, MatCard(m,240),
      h("div", h("h2",m.name), h("p",m.recipe), this.stock(m),
        Scraps.material(m.id) ? h("div.material-preview-actions", Scraps.button("dismantle",m.id,"Dismantle…",!(S.stock[m.id]>0))) : null),
      h("button.x", {"aria-label":"Close material preview",on:{click:()=>{const id=this.selected;this.selected=null;Shell.refresh();$(`[data-material="${id}"]`)?.focus({preventScroll:true});}}}, "✕"));
  },
};

/* Native dialog semantics provide focus trapping and Escape without changing the paper UI. */
const Distribution = {
  pendingOffer: null,
  dialogStyle: {border:"0",borderRadius:"14px",padding:"12px",background:"var(--paper, #fffdf9)",boxShadow:"var(--sh3)",maxWidth:"calc(100% - 32px)"},
  afterClose() { Bridge.dialogOpen=false; if(this.pendingOffer) { const offer=this.pendingOffer;this.pendingOffer=null;this.offer(offer); } },
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
    const dialog=h("dialog",{style:this.dialogStyle,"aria-label":"Redeem Peta code",on:{cancel:e=>{e.stopPropagation();if(pending)e.preventDefault();},keydown:e=>{if(e.key==="Escape")e.stopPropagation();},close:()=>{dialog.remove();this.afterClose();}}},form);
    Bridge.dialogOpen=true;document.body.append(dialog);dialog.showModal();input.focus();
  },
};

Distribution.offer = function(offer) {
  const existing=document.querySelector("dialog");if(existing?.dataset.packToken===offer.token) return;
  if(existing || document.querySelector(".cer")) {this.pendingOffer=offer;return;}
  this.pendingOffer=null;const p=offer.preview;let pending=false,accepted=false;
  const sender=this.sender({from:p.identity.name,signatureStatus:p.identity.status,fingerprint:p.identity.fingerprint});
  const status=h("p.small",{role:"status"}), accept=h("button.btn",{type:"button",on:{click:async()=>{
    if(pending) return;pending=true;accept.disabled=true;cancel.disabled=true;
    try {await Bridge.invoke("creator_pack_accept",{token:offer.token});accepted=true;await Bridge.reload();dialog.close();await Shell.go("packs",{instant:true});Shell.refresh();Shell.toast("Added to your shelf.");}
    catch(error){status.textContent=this.error(error);}
    finally {pending=false;accept.disabled=false;cancel.disabled=false;}
  }}},"Add to my shelf"),cancel=h("button.btn.paper",{type:"button",on:{click:()=>dialog.close()}},"Cancel");
  const dialog=h("dialog", {style:this.dialogStyle,"aria-label":"Confirm creator pack",data:{packToken:offer.token},on:{cancel:e=>{e.stopPropagation();if(pending)e.preventDefault();},keydown:e=>{if(e.key==="Escape")e.stopPropagation();},close:()=>{if(!accepted)Bridge.invoke("creator_pack_decline",{token:offer.token}).catch(console.error);dialog.remove();this.afterClose();}}},
    h("div.gift-form",h("h2",p.title),h("p",sender),h("p.muted.small",`${p.count} stickers · Version ${p.version}`),h("p.small","Open one sticker at a time, picked at random. Adding the pack does not use a material."),status,h("div.row-btns",cancel,accept)));
  Bridge.dialogOpen=true;document.body.append(dialog);dialog.showModal();cancel.focus({preventScroll:true});
};
