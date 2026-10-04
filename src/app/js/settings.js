Pages.settings = {
  build() {
    const root = h("div.page-in.settingspage");
    root.append(PageHead("Settings", "Quiet by default"));
    const name = h("input", { type: "text", value: S.name, maxlength: 40, autocomplete: "off", spellcheck: false, on: { change: async (e) => { try { S.name = (await Bridge.invoke("profile_set", { displayName: e.target.value })).displayName; e.target.value = S.name; Shell.renderNav(); } catch(err) { Shell.toast(String(err)); } } } });
    const sw = (label, sub, get, set) => { const b = h("button.switch", { role: "switch", "aria-checked": String(get()), on: { click: () => { set(!get()); b.setAttribute("aria-checked", String(get())); Snd.tap(); } } }, h("i")); return h("div.setrow", h("div", h("b", label), h("small", sub)), b); };
    const segRow = (label, sub, opts, get, set) => { const seg = h("div.seg", opts.map(([v, text]) => h("button", { "aria-pressed": String(get() === v), on: { click: () => { set(v); Snd.tap(); $$("button", seg).forEach((b, i) => b.setAttribute("aria-pressed", String(opts[i][0] === v))); } } }, text))); return h("div.setrow", h("div", h("b", label), h("small", sub)), seg); };
    root.append(h("div.setcard",
      h("div.setrow", h("div", h("b", "Your name on stickers"), h("small", "Printed on the back of stickers you make from now on")), name),
      h("div.setrow", h("div", h("b", "Creator icon"), h("small", "Choose an original sticker from your Book")),
        h("button.btn.paper.creator-icon-change", {on:{click:e=>CreatorIcon.choose(e.currentTarget)}}, CreatorIcon.image(), "Change icon…")),
      segRow("Window style", "Desk lays the pages on a cutting mat; Studio is a clean sidebar window", [["desk", "Desk"], ["studio", "Studio"]], () => S.shell, (v) => { Shell.setShell(v); }),
      sw("Sounds", "Paper, tear, and the little peta", () => Snd.on, (v) => { Snd.on = v; S.sound = v; Bridge.savePreferences(); }),
      sw("Haptics", "A small tap when you stick, peel, or break a seal", () => Haptic.on, (v) => { Haptic.on = v; S.haptics = v; Bridge.savePreferences(); }),
      sw("Put away on outside click", "A click on the desktop closes the window, like a menu", () => S.closeOutside, (v) => { S.closeOutside = v; Bridge.savePreferences(); }),
      sw("Reduce motion", "Skips page turns and ceremonies' flourishes", () => document.documentElement.dataset.motion === "reduce", (v) => { document.documentElement.dataset.motion = v ? "reduce" : "full"; S.motion = v ? "reduce" : "full"; Bridge.savePreferences(); })));
    root.append(h("p.muted.fine", "In the real app this window also hosts Cutting Mat, the Sticker Book, Packs and Gifts — what used to be four separate windows. Stickers stay on your desktop; this window comes and goes from the menu bar."));
    return root;
  },
};

/* A local profile uses the same finished original as the Book; no copied asset or account. */
const CreatorIcon = {
  image(id = S.iconStickerId, lazy = false) {
    const icon=h("span.creator-icon", h("span", Array.from(S.name.trim())[0]?.toUpperCase() || "P"));
    icon._load=()=>{if(!id)return;Bridge.asset(id).then(url=>{
      if(!icon.isConnected)return;
      const picture=h("img",{src:url,alt:"",draggable:false,on:{error:()=>picture.remove(),load:()=>icon.querySelector("span")?.remove()}});
      icon.append(picture);
    }).catch(()=>{});};
    if(id && !lazy)queueMicrotask(icon._load);
    return icon;
  },
  choose(trigger) {
    if(document.querySelector("dialog"))return;
    const entries=[...new Map(S.lib.filter(e=>e.canManage).map(e=>[e.id,e])).values()];
    let selected=S.iconStickerId,pending=false;
    const status=h("p.small",{role:"status"}),grid=h("div.creator-icon-grid",{role:"radiogroup","aria-label":"Original stickers"});
    const save=h("button.btn",{type:"submit"},"Save icon"),cancel=h("button.btn.paper",{type:"button",on:{click:()=>dialog.close()}},"Cancel");
    const mark=()=>{$$("[role=radio]",grid).forEach(b=>{const on=(b.dataset.sticker || null)===selected;b.setAttribute("aria-checked",String(on));b.tabIndex=on ? 0 : -1;});save.disabled=selected===S.iconStickerId || pending;};
    const choice=(id,label)=>h("button.creator-icon-choice",{type:"button",role:"radio",data:{sticker:id || ""},on:{click:()=>{if(pending)return;selected=id;mark();}}},this.image(id,true),h("small",label));
    grid.append(choice(null,"Use initial"),...entries.map(e=>choice(e.id,`${e.no==null ? "Original" : "No. "+pad4(e.no)} · ${MAT[e.material].name}`)));
    // Thumbnails enter the native asset cache only near the visible picker rows.
    const observer=new IntersectionObserver(records=>{for(const r of records)if(r.isIntersecting){observer.unobserve(r.target);r.target._load?.();}},{root:grid,rootMargin:"80px"});
    $$(".creator-icon",grid).forEach(icon=>observer.observe(icon));
    grid.addEventListener("keydown",e=>{
      if(pending || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))return;
      e.preventDefault();const buttons=$$("[role=radio]",grid),index=buttons.indexOf(e.target);
      const next=e.key==="Home" ? 0 : e.key==="End" ? buttons.length-1 : (index+(["ArrowLeft","ArrowUp"].includes(e.key) ? -1 : 1)+buttons.length)%buttons.length;
      buttons[next].click();buttons[next].focus();
    });
    const form=h("form.gift-form",{on:{submit:async e=>{
      e.preventDefault();if(pending || save.disabled)return;pending=true;save.disabled=true;cancel.disabled=true;
      try {const profile=await Bridge.invoke("profile_set_icon",{stickerId:selected});S.iconStickerId=profile.iconStickerId;dialog.close();Shell.refresh();Shell.toast("Creator icon saved.");}
      catch(error){status.textContent=String(error);}
      finally {pending=false;cancel.disabled=false;mark();}
    }}},h("h2","Creator icon"),h("p.muted.small",entries.length ? "Choose one of your original stickers. It stays in your Book." : "Create an original sticker to use it as your icon."),grid,status,h("div.row-btns",cancel,save));
    const dialog=h("dialog.creator-icon-dialog",{style:Distribution.dialogStyle,"aria-label":"Choose creator icon",on:{
      cancel:e=>{e.stopPropagation();if(pending)e.preventDefault();},keydown:e=>{if(e.key==="Escape")e.stopPropagation();},
      close:()=>{observer.disconnect();dialog.remove();Distribution.afterClose();(trigger.isConnected ? trigger : $(".creator-icon-change"))?.focus({preventScroll:true});}
    }},form);
    Bridge.dialogOpen=true;document.body.append(dialog);dialog.showModal();mark();cancel.focus({preventScroll:true});
  },
};
