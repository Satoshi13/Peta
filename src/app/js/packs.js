/* Packs: a shelf of pouches. Tearing one open is the ceremony in pack.js. */
Pages.packs = {
  build() {
    const root = h("div.page-in.packspage"), locked = false;
    root.append(PageHead("Packs", "Open one at random", h("span.quota", { "aria-live": "polite" }, h("b", "Welcome Pack"), ` ${S.packAvailable ? 0 : 1} of 1 today`, h("small", "resets at midnight · other packs open any time"))));
    const total = S.packs.reduce((a, p) => a + p.left.length, 0);
    const items = [
      ...S.packs.map((p) => ({ ...p, empty: !p.left.length })),
    ];
    root.append(h("p.muted.lede", "Opening a pack gives you one sticker, picked at random. The Welcome Pack opens once a day; packs you get from the Market or friends open any time, as often as you like."));
    root.append(h("div.shelf", items.map((p, i) => this.pack(p, i, locked)), h("i.ledge")));
    root.append(h("p.shelf-note.muted", total ? `${total} sticker${total === 1 ? "" : "s"} still sealed.` : "Every pack is open."));
    return root;
  },
  pack(p, i, locked) {
    const off = p.empty || !packOpenable(p), n = Math.min(3, p.left.length || 1);
    const stack = h("div.pk-stack", Array.from({ length: n }, (_, k) => h("i.pk-img" + ((p.kind || "holo") === "holo" && p.hue ? ".tinted" : ""), { style: { "--k": k, "--hue": p.hue + "deg", "--pk": packVar(p.kind) } }, k === n - 1 && (p.kind || "holo") === "holo" ? h("i.sheen") : null)));
    const card = h("button.pack", { disabled: off, "aria-label": `${p.title}, ${p.left.length} left`, data: { empty: p.empty, pack: p.id }, style: { "--i": i }, on: { click: () => { Snd.tap(); Cer.openPack(p); } } },
      stack,
      h("span.pack-tag", h("b.hand", p.title), h("small", `by ${p.by}${p.signatureStatus ? " ✓" : ""} · ${p.empty ? "all opened" : p.daily ? p.left.length + " of " + p.total + " left" : p.left.length + " left · " + p.total + " total"}`), p.fingerprint ? h("small", `${p.fingerprint}${p.signatureStatus==="new" ? " · New friend" : p.signatureStatus==="warning" ? " · Same name, different key" : ""}`) : null, h("small.rule", p.empty ? "" : p.daily ? (packsLeftToday() ? "once a day" : "back tomorrow") : "open any time")),
      h("span.open-cta", { "aria-hidden": off ? "true" : null, style: { visibility: off ? "hidden" : "visible" } }, "Open one"));
    if (!off) { onPointerFollow(card, (x, y) => { stack.style.setProperty("--sx", (1 - x) * 100 + "%"); stack.style.setProperty("--sy", (1 - y) * 100 + "%"); stack.style.setProperty("--ry", (x - .5) * 14 + "deg"); stack.style.setProperty("--rx", -(y - .5) * 10 + "deg"); }, () => { stack.style.setProperty("--ry", "0deg"); stack.style.setProperty("--rx", "0deg"); stack.style.setProperty("--sx", "30%"); stack.style.setProperty("--sy", "30%"); }); }
    return card;
  },
};

/* Export finished copies; names and rarity belong to the pack, not the Book's originals. */
const PackMaker = {
  open() {
    if(document.querySelector("dialog")) return;
    const entries=[...new Map(S.lib.map(e=>[e.id,e])).values()], selected=new Map();let step=1,pending=false,observer=null;
    const title=h("input", {maxLength:40,required:true,value:"My Pack","aria-label":"Pack title"});
    const pouch=h("select", {"aria-label":"Pack wrapper"},["kraft","matte","holo"].map(id=>h("option",{value:id},id==="holo" ? "Holographic" : MAT[id].name)));
    const status=h("p.small", {role:"status"}), body=h("div"), next=h("button.btn", {type:"button",on:{click:()=>{step=2;paint();}}}, "Next"), save=h("button.btn", {type:"submit"},"Seal & Save…");
    const back=h("button.link",{type:"button",on:{click:()=>{step=1;paint();}}},"Back"),cancel=h("button.btn.paper",{type:"button",on:{click:()=>dialog.close()}},"Cancel");
    const paint=()=>{
      observer?.disconnect();status.textContent="";
      if(step===1) {
        next.disabled=selected.size<3;body.replaceChildren(h("p.small",`${selected.size} selected · Choose 3–24 stickers.`));
        observer=new IntersectionObserver(records=>{for(const r of records) if(r.isIntersecting){observer.unobserve(r.target);r.target._load?.();}}, {root:dialog,rootMargin:"80px"});
        entries.forEach((entry,i)=>{
          const thumb=h("span",{style:{display:"inline-block",width:"42px",height:"42px"}});thumb._load=()=>resOf(entry).then(res=>{if(thumb.isConnected)thumb.append(Stk.el(res,res.aspect>=1 ? 40 : 40*res.aspect));}).catch(e=>{status.textContent=Distribution.error(e);});
          const check=h("input", {type:"checkbox",checked:selected.has(entry.id),"aria-label":`Select sticker ${i+1}`,on:{change:e=>{
            if(e.target.checked && selected.size===24){e.target.checked=false;status.textContent="Choose up to 24 stickers.";return;}
            if(e.target.checked)selected.set(entry.id,{stickerId:entry.id,name:`Sticker ${i+1}`,rarity:"common"});else selected.delete(entry.id);
            next.disabled=selected.size<3;body.firstChild.textContent=`${selected.size} selected · Choose 3–24 stickers.`;
          }}});
          body.append(h("label", {style:{display:"flex",flexDirection:"row",alignItems:"center",gap:"10px"}},check,thumb,`${fmtDate(entry.date)} · ${MAT[entry.material].name} · ${entry.id}`));observer.observe(thumb);
        });
      } else {
        body.replaceChildren(h("label","Pack name",title),h("label","Wrapper",pouch),h("p.small",`by ${S.name} · Finished copies only. Your own stickers stay in the Collection.`),
          h("div.row-btns",h("small","Set all:"),...["common","uncommon","rare"].map(r=>h("button.link",{type:"button",on:{click:()=>{for(const item of selected.values())item.rarity=r;paint();}}},r[0].toUpperCase()+r.slice(1)))));
        for(const item of selected.values()) {
          const name=h("input",{maxLength:40,required:true,value:item.name,"aria-label":`Name for ${item.stickerId}`,on:{input:e=>item.name=e.target.value}});
          const rarity=h("select",{"aria-label":`Rarity for ${item.stickerId}`,on:{change:e=>item.rarity=e.target.value}},["common","uncommon","rare"].map(r=>h("option",{value:r,selected:r===item.rarity},r[0].toUpperCase()+r.slice(1))));
          body.append(h("label",item.stickerId,name,rarity));
        }
      }
      next.hidden=step!==1;save.hidden=step!==2;back.hidden=step!==2;
    };
    const form=h("form.gift-form",{on:{submit:async e=>{
      e.preventDefault();if(pending || step!==2)return;pending=true;Bridge.dialogOpen=true;save.disabled=true;cancel.disabled=true;back.disabled=true;
      try {const file=await Bridge.invoke("creator_pack_save",{title:title.value.trim(),pouch:pouch.value,items:[...selected.values()]});if(file){dialog.close();Shell.toast("Pack saved. Your own stickers stay in the Collection.");}}
      catch(error){status.textContent=Distribution.error(error);}
      finally {pending=false;save.disabled=false;cancel.disabled=false;back.disabled=false;}
    }}},h("h2","Make a Pack"),body,status,h("div.row-btns",cancel,back,next,save));
    const dialog=h("dialog",{"aria-label":"Make a creator pack",style:{...Distribution.dialogStyle,width:"min(640px,90vw)",maxHeight:"80vh",overflowY:"auto"},on:{cancel:e=>{e.stopPropagation();if(pending)e.preventDefault();},keydown:e=>{if(e.key==="Escape")e.stopPropagation();},close:()=>{observer?.disconnect();dialog.remove();Distribution.afterClose();}}},form);
    Bridge.dialogOpen=true;document.body.append(dialog);dialog.showModal();paint();cancel.focus({preventScroll:true});dialog.scrollTop=0;
  },
};
