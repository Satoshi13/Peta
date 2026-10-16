Pages.settings = {
  build() {
    const root = h("div.page-in.settingspage");
    root.append(PageHead("Settings", "Quiet by default"));
    const name = h("input", { type: "text", value: S.name, "aria-label": "Your name on stickers", maxlength: 40, autocomplete: "off", spellcheck: false, on: { change: async (e) => { try { S.name = (await Bridge.invoke("profile_set", { displayName: e.target.value })).displayName; e.target.value = S.name; Shell.renderNav(); } catch(err) { Shell.error(err); } } } });
    const sw = (label, sub, get, set) => { const b = h("button.switch", { role: "switch", "aria-checked": String(get()), on: { click: () => { set(!get()); b.setAttribute("aria-checked", String(get())); Snd.tap(); } } }, h("i")); return h("div.setrow", h("div", h("b", label), h("small", sub)), b); };
    const segRow = (label, sub, opts, get, set) => { const seg = h("div.seg", opts.map(([v, text]) => SegButton(text, { "aria-pressed": String(get() === v), on: { click: () => { set(v); Snd.tap(); $$("button", seg).forEach((b, i) => b.setAttribute("aria-pressed", String(opts[i][0] === v))); } } }))); return h("div.setrow", h("div", h("b", label), h("small", sub)), seg); };
    root.append(h("div.setcard.settings-preferences",
      h("div.setrow", h("div", h("b", "Your name on stickers"), h("small", "Printed on the back of stickers you make from now on")), name),
      h("div.setrow", h("div", h("b", "Creator icon"), h("small", "Choose an original sticker from your Collection")),
        h("button.btn.paper.creator-icon-change", {on:{click:e=>CreatorIcon.choose(e.currentTarget)}}, CreatorIcon.image(), "Change icon…")),
      segRow("Window style", "Desk lays the pages on a cutting mat; Studio is a clean sidebar window", [["desk", "Desk"], ["studio", "Studio"]], () => S.shell, (v) => { Shell.setShell(v); }),
      segRow("Appearance", "Auto follows macOS", [["day", "Day"], ["night", "Night"], ["auto", "Auto"]], () => S.appearance, (v) => { S.appearance=v; Bridge.savePreferences(); }),
      sw("Sounds", "Paper, tear, and the little peta", () => Snd.on, (v) => { Snd.on = v; S.sound = v; Bridge.savePreferences(); }),
      sw("Haptics", "A small tap when you stick, peel, or break a seal", () => Haptic.on, (v) => { Haptic.on = v; S.haptics = v; Bridge.savePreferences(); }),
      sw("Hide on outside click", "Hide browsing pages when you switch apps. Editing stays open", () => S.closeOutside, (v) => { S.closeOutside = v; Bridge.savePreferences(); }),
      sw("Reduce motion", "Skips page turns and ceremonies' flourishes", () => document.documentElement.dataset.motion === "reduce", (v) => { document.documentElement.dataset.motion = v ? "reduce" : "full"; S.motion = v ? "reduce" : "full"; Bridge.savePreferences(); }),
      h("div.setrow", h("div", h("b", "Coupon code"), h("small", "Enter a code from Peta or a friend.")),
        h("button.btn.paper.small", {type:"button",on:{click:()=>Distribution.redeem()}}, "Coupon code…"))));
    if(S.developer) root.append(h("section.setcard.developer-tools", h("h2","Peta Developer"), h("p.muted.small","Unlimited materials, exchanges, envelopes and pack openings. Data stays separate from Peta."),
      h("div.row-btns",
        h("button.btn.paper.small",{on:{click:()=>{S.extraEnvelope=true;S.dayState="arrived";Shell.go("today");}}},"Open another envelope"),
        h("button.btn.paper.small",{on:{click:async e=>{const b=e.currentTarget;b.disabled=true;try {await Bridge.invoke("developer_show_arrival");await Shell.close();}catch(err){Shell.error(err);}finally{b.disabled=false;}}}},"Show desktop envelope once"),
        h("button.btn.paper.small",{on:{click:async()=>{try {await Bridge.invoke("developer_next_day");S.envelopeDeadline=null;await Bridge.reload();Shell.go("today",{force:true});}catch(e){Shell.error(e);}}}},"Next Day (+1 day)"),
        h("button.btn.paper.small",{on:{click:async()=>{try {await Bridge.invoke("developer_sync_displays");Shell.toast("Displays re-synced.");}catch(e){Shell.error(e);}}}},"Re-sync Displays"))));
    if(S.inbox.enabled) root.append(RefereeSettings.card());
    const friends = Friends.settingsCard(), key = Friends.keyCard(); if(friends) root.append(friends); if(key) root.append(key);
    if(S.developer)root.append(UpdateUI.supplyCard());
    root.append(LibraryMove.card(),AboutPeta.card());
    root.append(h("p.muted.fine", "Your stickers and saved layouts are stored on this Mac. Open Peta again from the menu bar to continue."));
    return root;
  },
};

/* A local profile uses the same finished original as the Book; no copied asset or account. */
const CreatorIcon = {
  image(id = S.iconStickerId, lazy = false) {
    const icon=h("span.creator-icon",{data:{image:id ? "1" : "0"}}, h("span",{hidden:!!id},Array.from(S.name.trim())[0]?.toUpperCase() || "P"));
    icon._load=()=>{if(!id)return;(lazy ? Bridge.thumb(id,192) : Bridge.asset(id)).then(url=>{
      if(!icon.isConnected)return;
      const picture=h("img",{src:url,alt:"",draggable:false,on:{error:()=>{picture.remove();const fallback=icon.querySelector("span");if(fallback)fallback.hidden=false;},load:()=>icon.querySelector("span")?.remove()}});
      icon.append(picture);
    }).catch(()=>{const fallback=icon.querySelector("span");if(fallback)fallback.hidden=false;});};
    if(id && !lazy)queueMicrotask(icon._load);
    return icon;
  },
  choose(trigger) {
    if(document.querySelector("dialog"))return;
    const entries=[...new Map(S.lib.filter(e=>e.canManage).map(e=>[e.id,e])).values()];
    let selected=entries.some(e=>e.id===S.iconStickerId) ? S.iconStickerId : null,pending=false;
    const status=h("p.creator-icon-status",{role:"status"}),grid=h("div.creator-icon-grid",{role:"radiogroup","aria-label":"Original stickers"});
    const save=h("button.btn",{type:"submit"},"Save icon"),cancel=h("button.btn.quiet",{type:"button",on:{click:()=>dialog.close()}},"Cancel");
    const mark=()=>{$$("[role=radio]",grid).forEach(b=>{const on=(b.dataset.sticker || null)===selected;b.setAttribute("aria-checked",String(on));b.tabIndex=on ? 0 : -1;b.disabled=pending;});save.disabled=selected===S.iconStickerId || pending;};
    const choice=(id,label)=>h("button.creator-icon-choice",{type:"button",role:"radio",data:{sticker:id || ""},on:{click:()=>{if(pending)return;selected=id;mark();}}},this.image(id,true),h("small",label));
    grid.append(choice(null,"Use initial"),...entries.map(e=>choice(e.id,titleOf(e))));
    // Thumbnails enter the native asset cache only near the visible picker rows.
    const observer=new IntersectionObserver(records=>{for(const r of records)if(r.isIntersecting){observer.unobserve(r.target);r.target._load?.();}},{root:grid,rootMargin:"80px"});
    $$(".creator-icon",grid).forEach(icon=>observer.observe(icon));
    grid.addEventListener("keydown",e=>{
      if(pending || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))return;
      e.preventDefault();const buttons=$$("[role=radio]",grid),index=buttons.indexOf(e.target);
      const next=e.key==="Home" ? 0 : e.key==="End" ? buttons.length-1 : (index+(["ArrowLeft","ArrowUp"].includes(e.key) ? -1 : 1)+buttons.length)%buttons.length;
      buttons[next].click();buttons[next].focus();
    });
    const form=h("form.creator-icon-form",{on:{submit:async e=>{
      e.preventDefault();if(pending || save.disabled)return;pending=true;save.disabled=true;cancel.disabled=true;save.textContent="Saving…";status.textContent="";mark();
      try {const profile=await Bridge.invoke("profile_set_icon",{stickerId:selected});S.iconStickerId=profile.iconStickerId;dialog.close();Shell.refresh();Shell.toast("Creator icon saved.");}
      catch(error){status.textContent=userError(error);}
      finally {pending=false;cancel.disabled=false;save.textContent="Save icon";mark();}
    }}},h("header.creator-icon-head",h("h2#creator-icon-title","Creator icon"),h("p.muted.small",entries.length ? "Choose a sticker. It stays in your Collection." : "Make an original sticker to use it as your icon.")),grid,h("footer.creator-icon-foot",status,h("div.row-btns",cancel,save)));
    const dialog=h("dialog.creator-icon-dialog",{tabindex:-1,"aria-label":"Choose creator icon",on:{
      cancel:e=>{e.stopPropagation();if(pending)e.preventDefault();},keydown:e=>{if(e.key==="Escape")e.stopPropagation();},
      close:()=>{observer.disconnect();dialog.remove();Distribution.afterClose();}
    }},form);
    Bridge.dialogOpen=true;document.body.append(dialog);Dialogs.open(dialog);mark();dialog.focus({preventScroll:true});
  },
};

const RefereeSettings = {
  card() {
    const status=h("p.small",{role:"status"},"Checking connection…");
    const contact=h("p.small.muted");
    const address=h("p"), pending=h("p");
    const details=S.developer ? h("details.referee-details",h("summary","Connection details"),address,pending) : null;
    const card=h("section.setcard.referee-tools",h("h2","Sticker checks"),status,contact);
    const refresh=async()=>{try {
      const state=await Bridge.invoke("referee_status");if(!card.isConnected)return;
      const count=state.pending.registrations+state.pending.cancellations+state.pending.slots;
      status.textContent=!state.url ? "Sticker checks are unavailable in this build." : count ? `${count} check${count===1 ? " is" : "s are"} waiting to sync.` : state.lastContact ? "Your sticker checks are up to date." : "Ready to check your stickers.";
      contact.textContent=state.lastContact ? `Last synced ${new Date(state.lastContact*1000).toLocaleString()}` : "Peta confirms sticker ownership when you send, receive or open a pack.";
      address.textContent=state.url || "No server configured.";
      pending.textContent=`Waiting to check: ${state.pending.registrations} · Taking back: ${state.pending.cancellations} · Pending draws: ${state.pending.slots} · Recovered transfers: ${state.pending.reconciliations}`;
    }catch(e){status.textContent=userError(e);}};
    card.append(h("button.btn.paper.small",{on:{click:async e=>{const button=e.currentTarget;button.disabled=true;try {await Bridge.invoke("referee_sync");await Bridge.reload();Shell.toast("Checks synced.");}catch(error){Shell.error(error);}finally{button.disabled=false;await refresh();}}}},"Sync now"));
    if(details)card.append(details);
    queueMicrotask(refresh);return card;
  },
};

/* About Peta: a still taped to the card like a photo; the tour plays in a paper frame, with its music
   (muted only if the webview refuses sound). Enable playback once its metadata has loaded. */
const AboutPeta = {
  TOUR: "art/tour/peta-tour.mp4",
  card() {
    const button=h("button.btn.paper.small.about-watch",{type:"button",disabled:true,"aria-busy":"true",on:{click:()=>this.play()}},"Loading…");
    const photo=h("button.about-photo",{type:"button",disabled:true,"aria-label":"Watch the tour",on:{click:()=>this.play()}},
      h("span.about-window",h("img.about-still",{src:A.tourStill,alt:"",draggable:false})),h("img.about-tape",{src:A.peekTape,alt:"",draggable:false}),h("span.about-play",{"aria-hidden":"true"}));
    const probe=h("video",{preload:"metadata",muted:true});
    const ready=()=>{button.disabled=false;photo.disabled=false;button.setAttribute("aria-busy","false");button.textContent="Watch the tour";photo.classList.add("ready");probe.removeAttribute("src");probe.load();};
    probe.addEventListener("loadedmetadata",ready,{once:true});probe.addEventListener("error",()=>{button.setAttribute("aria-busy","false");button.textContent="Tour unavailable";probe.removeAttribute("src");},{once:true});probe.src=this.TOUR;
    const legal=h("div.row-btns",{hidden:true});
    queueMicrotask(()=>Bridge.invoke("about_links").then(links=>{if(!legal.isConnected)return;for(const link of links)legal.append(h("button.btn.paper.small",{type:"button",on:{click:async()=>{try{await Bridge.invoke("about_open_link",{id:link.id});}catch(e){Shell.error(e);}}}},link.label));legal.hidden=!links.length;}).catch(()=>{}));
    return h("section.setcard.about-card",photo,h("div.about-text",h("h2","About Peta"),UpdateUI.card(),h("p.small","A short film of how Peta works: make a sticker, stick it on your desktop, and send one to a friend."),button,h("button.btn.paper.small",{type:"button",on:{click:async()=>{try{await Bridge.invoke("about_notices");}catch(e){Shell.error(e);}}}},"Third-party notices…"),legal));
  },
  play() {
    if(document.querySelector("dialog")) return;
    const video=h("video.tour-video",{controls:true,playsInline:true,preload:"auto",poster:A.tourStill,src:this.TOUR});
    const close=CloseButton("Close",{on:{click:()=>dialog.close()}},".tour-x");
    const dialog=h("dialog.tour-dialog",{"aria-label":"Peta tour",on:{keydown:e=>{if(e.key==="Escape")e.stopPropagation();},click:e=>{if(e.target===dialog)dialog.close();},close:()=>{video.pause();video.removeAttribute("src");video.load();dialog.remove();Bridge.dialogOpen=!!document.querySelector("dialog");}}},
      h("div.tour-frame",h("img.tour-tape",{src:A.peekTape,alt:"",draggable:false}),video,close));
    Bridge.dialogOpen=true;document.body.append(dialog);Dialogs.open(dialog);
    if(document.documentElement.dataset.motion!=="reduce") video.play().catch(()=>{video.muted=true;video.play().catch(()=>{});});
  },
};


/** Keep the current draft and resume sharing after the name is saved. */
const ProfileName = {
  flight: null,
  request() {
    if(S.name.trim()) return Promise.resolve(true);
    if(this.flight) return this.flight;
    let finish, pending=false, saved=false;
    this.flight=new Promise(resolve=>{finish=resolve;});
    const input=h("input.bd-input",{type:"text",maxlength:40,required:true,autocomplete:"nickname","aria-label":"Your name on stickers",value:S.name});
    const error=h("p.bd-error",{role:"alert"});
    const cancel=h("button.link",{type:"button",on:{click:()=>{if(!pending)dialog.close();}}},"Cancel");
    const submit=h("button.btn",{type:"submit"},"Save and continue");
    const form=h("form.bd-form",{on:{submit:async e=>{
      e.preventDefault();if(pending)return;
      const name=input.value.trim();if(!name){error.textContent="Enter your name to continue.";input.focus();return;}
      pending=true;error.textContent="";input.disabled=cancel.disabled=submit.disabled=true;submit.textContent="Saving…";
      try {
        const profile=await Bridge.invoke("profile_set",{displayName:name});
        S.name=profile.displayName;Shell.renderNav();saved=true;dialog.close();
      } catch(cause) {error.textContent=userError(cause);}
      finally {pending=false;input.disabled=cancel.disabled=submit.disabled=false;submit.textContent="Save and continue";if(dialog.open)input.focus();}
    }}},h("label.bd-field",h("span","Your name"),input),error,h("div.bd-dacts",cancel,submit));
    const dialog=h("dialog.bd-dialog.profile-name-dialog",{"aria-label":"Choose your name",on:{cancel:e=>{if(pending)e.preventDefault();},close:()=>{
      dialog.remove();this.flight=null;finish(saved);
    }}},h("div.setcard.bd-sheet",h("h2","Choose your name"),h("p.small","Friends will see this name on your code, gifts and packs."),form));
    document.body.append(dialog);Dialogs.open(dialog);input.focus();
    return this.flight;
  },
};


/** A full library move is offline and separate from the existing keys-only backup. */
const LibraryMove = {
  card() {
    const restore=h("button.btn.paper.small",{type:"button",disabled:true,on:{click:()=>this.dialog(true)}},"Restore a move file…");
    const note=h("small","Restore on the first launch of a fresh installation, before you use Peta or close it.");
    const card=h("section.setcard",h("h2","Move to a new Mac"),h("p.small.muted","Your Collection, friends, desktop arrangements and keys in one file, sealed with a passphrase. Nothing is sent to a server."),
      h("div.row-btns",h("button.btn.paper.small",{type:"button",on:{click:()=>this.dialog(false)}},"Make a move file…"),restore),note);
    queueMicrotask(()=>Bridge.invoke("move_status").then(ready=>{if(card.isConnected){restore.disabled=!ready;note.textContent=ready ? "This fresh installation can restore a move file. Peta will restart afterward." : "Restore on the first launch of a fresh installation, before you use Peta or close it.";}}).catch(()=>{}));
    return card;
  },
  dialog(restoring) {
    const pass=label=>h("input.bd-input",{type:"password",autocomplete:restoring ? "current-password" : "new-password","aria-label":label,placeholder:label});
    const a=pass(restoring ? "Passphrase of the move file" : "Passphrase (12 characters or more)"),b=restoring ? null : pass("The same passphrase again"),status=h("p.small.bd-error",{role:"status"});
    const submit=h("button.btn",{type:"submit"},restoring ? "Restore and restart…" : "Save move file…");let pending=false;
    const form=h("form.bd-form",{on:{submit:async e=>{
      e.preventDefault();if(pending)return;
      if(!restoring && [...a.value].length<12){status.textContent="Use 12 characters or more.";return;}
      if(b && a.value!==b.value){status.textContent="The two passphrases differ.";return;}
      pending=true;submit.disabled=true;status.textContent=restoring ? "Checking the move file…" : "Making the move file…";
      try{const saved=await Bridge.fileDialog(restoring ? "library_move_import" : "library_move_export",{passphrase:a.value});
        if(saved){dialog.close();Shell.toast(restoring ? "Your Peta library was restored. Restart Peta to finish." : "Move file saved. After restoring it, do not use Peta on this Mac.",6500);}else status.textContent="";
      }catch(err){status.textContent=Friends.error(err);}finally{pending=false;submit.disabled=false;}
    }}},h("p.small",restoring ? "Restore on the first launch of a fresh installation, before you use Peta or close it. Peta checks the whole file before replacing anything, then restarts." : "Keep the file and passphrase apart. After restoring it on the new Mac, do not use Peta on this Mac. Using the same keys on two Macs at once is not supported."),a,b,status,h("div.bd-dacts",h("button.link",{type:"button",on:{click:()=>{if(!pending)dialog.close();}}},"Cancel"),submit));
    const dialog=Friends.sheet(restoring ? "Restore your Peta library" : "Move to a new Mac",h("h2",restoring ? "Restore your Peta library" : "Move to a new Mac"),form);
    if(dialog){dialog.addEventListener("cancel",e=>{if(pending)e.preventDefault();});a.focus();}
  },
};
