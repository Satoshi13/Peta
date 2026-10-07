/* Packs: a shelf of pouches. Tearing one open is the ceremony in pack.js. */

/* The title and the author are printed on the pouch's own white label, wherever the pouch is shown. */
function PackLabel(p) {
  return h("span.pk-label", { "aria-hidden": "true", data: { kind: p.kind || "holo" } }, h("b", p.title), h("small", "by " + p.by));
}

/* Click a pack (in the Market or on the Packs shelf) and the camera moves in on it: the whole shelf scales up around the pouch until it
   fills the left half, the page behind softens, and only then do the details and the choices appear. Back, Esc or a click outside moves
   the camera out again. The pouch never travels on its own; it stays where it is in the world and the world moves.
   `build(pack)` returns the card; a button inside it with the class mkz-act closes the view at once before its own handler runs. */
const PackZoom = {
  current: null,
  get active() { return this.current?.root.isConnected ? this.current : null; },
  open(pack, tile, build) {
    if (this.active) return;
    if (this.current) this.dispose();
    const page = Shell.current, source = $(".pk-stack", tile);
    if (!page || !source) return;
    const root = h("div.mkz", { role: "dialog", "aria-label": pack.title, tabindex: -1 }), scrim = h("div.mkz-scrim");
    const clone = source.cloneNode(true); clone.classList.add("mkz-pack"); clone.removeAttribute("style");
    const card = build(pack), world = [...page.children], nav = $("#nav");
    const savedWorld = world.map(el => ({ el, inert: el.inert, transform: el.style.transform, origin: el.style.transformOrigin }));
    const cur = this.current = { root, scrim, clone, card, source, tile, pack, world, savedWorld, nav, page,
      overflow: page.style.overflowY, sourceVisibility: source.style.visibility, closing: false };
    const buttons = () => $$(".mkz-act, .mkz-back, .mkz-x", card).filter(b => !b.disabled && !b.hidden && b.getClientRects().length);
    const focusable = () => [...buttons(), ...(nav ? $$("button:not(:disabled)", nav).filter(b => !b.closest("[inert]") && b.getClientRects().length) : [])];
    try {
      // Freeze the shelf at its current scroll position; navigation and window controls stay available.
      root.style.cssText = `top:${page.scrollTop}px;bottom:auto;height:${page.clientHeight}px`; page.style.overflowY = "hidden";
      root.append(scrim, clone, card); page.append(root);
      const to = this.target(root), from = this.rectIn(root, source), k = to.width / from.width;
      cur.camera = `translate(${to.left - from.left * k}px, ${to.top - from.top * k}px) scale(${k})`;
      cur.packFrom = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${1 / k})`;
      const rr = root.getBoundingClientRect();
      for (const el of world) {
        const r = el.getBoundingClientRect(); el.style.transformOrigin = `${rr.left - r.left}px ${rr.top - r.top}px`; el.inert = true;
      }
      cur.onKey = e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
        if (e.key === "Tab") {
          e.preventDefault(); e.stopImmediatePropagation();
          const list = focusable(), i = list.indexOf(document.activeElement);
          const next = i < 0 ? (e.shiftKey ? list.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + list.length) % list.length;
          (list[next] || root).focus({ preventScroll: true }); return;
        }
        const input = e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
        const button = e.target.closest?.("button");
        if (!input && (e.metaKey || e.ctrlKey)) e.preventDefault();
        if (!input && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key) && !(button && e.key === " ")) e.preventDefault();
        // Preserve native Enter/Space activation and text editing, while isolating global handlers.
        e.stopImmediatePropagation();
      };
      cur.onFocus = e => {
        if (!root.contains(e.target) && !nav?.contains(e.target) && !e.target.closest?.(".wctl")) (buttons()[0] || root).focus({ preventScroll: true });
      };
      window.addEventListener("keydown", cur.onKey, true);
      window.addEventListener("focusin", cur.onFocus, true);
      root.focus({ preventScroll: true });
      scrim.addEventListener("click", () => this.close());
      card.addEventListener("click", e => { if (e.target.closest(".mkz-back, .mkz-x")) this.close(); });
      card.addEventListener("click", e => { if (e.target.closest(".mkz-act")) this.dispose(); }, true);
      // Rasterize at the final size; only the journey uses a scale.
      Object.assign(clone.style, { left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px", transformOrigin: "0 0", transform: cur.packFrom });
      source.style.visibility = "hidden";
      anim(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: EASE.out, delay: 120 });
      this.move(cur, "none", cur.camera, 680).then(async () => {
        if (cur.closing || !root.isConnected) return;
        const animation = anim(card, [{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: EASE.out });
        card.classList.add("on"); (buttons().find(b => b.matches(".mkz-act")) || buttons()[0] || root).focus({ preventScroll: true });
        (await animation).cancel?.();
      }).catch(error => { if (this.current === cur) this.dispose(true); Shell.toast(String(error)); });
      onPointerFollow(clone, (x, y, e, amount) => { clone.style.setProperty("--sx", lerp(30, (1 - x) * 100, amount) + "%"); clone.style.setProperty("--sy", lerp(30, (1 - y) * 100, amount) + "%"); }, () => { clone.style.setProperty("--sx", "30%"); clone.style.setProperty("--sy", "30%"); });
    } catch (error) { this.dispose(true); throw error; }
  },
  /* One camera move for the pouch and the page around it, so they always stay in the same place relative to each other. */
  move(cur, a, b, duration) {
    return Promise.all([cur.clone, ...cur.world].map((el) => {
      const start = getComputedStyle(el).transform;
      el.getAnimations().forEach((animation) => animation.cancel());
      const end = el === cur.clone ? (b === "none" ? cur.packFrom : "none") : b;
      return animCommit(el, [{ transform: start }, { transform: end }], { duration, easing: EASE.inOut }).then(() => {
        if (el === cur.clone && b !== "none" && !cur.closing) el.style.transform = "none";
      });
    }));
  },
  /* Where the pouch comes to rest: left of the card, as large as the window allows. */
  target(root) {
    const r = root.getBoundingClientRect(), cardW = Math.min(340, r.width * .44), leftW = r.width - cardW - 52;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    let height = Math.min(r.height * .72, 440, 1024 / dpr), width = height * .75;
    if (width > leftW * .84) { width = leftW * .84; height = width / .75; }
    return { left: 24 + (leftW - width) / 2, top: (r.height - height) / 2 + 6, width, height };
  },
  rectIn(root, el) { const a = root.getBoundingClientRect(), b = el.getBoundingClientRect(); return { left: b.left - a.left, top: b.top - a.top, width: b.width, height: b.height }; },
  /* Move back out: the card goes first, then the camera pulls back to the whole shelf. */
  async close() {
    const cur = this.active; if (!cur || cur.closing) return; cur.closing = true;
    try {
      anim(cur.card, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(16px)" }], { duration: 160, easing: EASE.out });
      anim(cur.scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: EASE.out, delay: 120 });
      await this.move(cur, cur.camera, "none", 560);
    } finally { if (this.current === cur) this.dispose(true); }
  },
  /* Remove the view at once (no motion). `restore` hands focus back to the pack that was chosen. */
  dispose(restore = false) {
    const cur = this.current; if (!cur) return;
    window.removeEventListener("keydown", cur.onKey, true);
    window.removeEventListener("focusin", cur.onFocus, true);
    for (const { el, inert, transform, origin } of cur.savedWorld) { el.getAnimations().forEach(a => a.cancel()); el.style.transform = transform; el.style.transformOrigin = origin; el.inert = inert; }
    for (const el of [cur.clone, cur.scrim, cur.card]) el.getAnimations().forEach(a => a.cancel());
    cur.page.style.overflowY = cur.overflow;
    cur.source.style.visibility = cur.sourceVisibility; cur.root.remove(); this.current = null;
    if (restore && cur.tile.isConnected) cur.tile.focus({ preventScroll: true });
  },
};

Pages.packs = {
  build() {
    const root = h("div.page-in.packspage");
    root.append(PageHead("Packs", "Open one at random", h("span.quota", { "aria-live": "polite" }, h("b", "Welcome Pack"), ` ${S.packAvailable ? 0 : 1} of 1 today`, h("small", "resets at midnight · other packs open any time"))));
    const total = S.packs.reduce((a, p) => a + p.left.length, 0);
    const items = S.packs.map((p) => ({ ...p, empty: !p.left.length }));
    root.append(h("p.muted.lede", "Choose a pack to look closer, then open one sticker at a time or ten at once. Each is picked at random. The Welcome Pack opens once a day; packs you get from the Market or friends open any time."));
    root.append(h("div.shelf", items.map((p, i) => this.pack(p, i)), h("i.ledge")));
    root.append(h("p.shelf-note.muted", total ? `${total} sticker${total === 1 ? "" : "s"} still sealed.` : "Every pack is open."));
    return root;
  },
  pack(p, i) {
    const stack = h("div.pk-stack", h("i.pk-img" + ((p.kind || "holo") === "holo" && p.hue ? ".tinted" : ""), { style: { "--k": 0, "--hue": p.hue + "deg", "--pk": packVar(p.kind) } }, (p.kind || "holo") === "holo" ? h("i.sheen") : null), PackLabel(p));
    const card = h("button.pack", { "aria-label": `${p.title} by ${p.by}, ${p.empty ? "all opened" : p.left.length + " sealed"} — look closer`, "aria-haspopup": "dialog", data: { empty: p.empty, pack: p.id }, style: { "--i": i }, on: { click: (e) => { Snd.tap(); PackZoom.open(p, e.currentTarget, (pack) => this.card(pack)); } } },
      stack, h("span.pk-badge", p.empty ? "All opened" : `${p.left.length} left`));
    onPointerFollow(card, (x, y, e, amount) => { stack.style.setProperty("--sx", lerp(30,(1-x)*100,amount)+"%"); stack.style.setProperty("--sy", lerp(30,(1-y)*100,amount)+"%"); }, () => { stack.style.setProperty("--sx", "30%"); stack.style.setProperty("--sy", "30%"); });
    return card;
  },
  /* The zoomed card: what is left, then the two ways to open. */
  card(p) {
    const left = p.left.length, many = Math.min(10, left), more = left >= 2 && !p.daily;
    const rule = p.empty ? "Every sticker in this pack has been opened." : p.daily ? (packsLeftToday() ? "Once a day — today's is ready." : "Back tomorrow. This one opens once a day.") : "Open any time, as often as you like.";
    const blurb = MARKET_PACKS.find((m) => m.id === p.id)?.blurb;
    const go = (fn) => () => { PackZoom.dispose(); fn(); };
    const one = h("button.btn.mkz-act", { type: "button", disabled: !packOpenable(p), on: { click: go(() => { Snd.tap(); Cer.openPack(p); }) } }, "Open one");
    const ten = more ? h("button.btn.paper.mkz-act", { type: "button", on: { click: go(() => { Snd.tap(); Cer.openPackMany(p, many); }) } }, many === 10 ? "Open 10" : `Open all ${many}`) : null;
    return h("aside.mkz-card", h("button.mkz-x", { type: "button", "aria-label": "Back to the shelf" }, "✕"),
      h("p.eyebrow", `by ${p.by}${p.signatureStatus ? " ✓" : ""}`), h("h2", p.title), blurb ? h("p.mkz-blurb", blurb) : null,
      p.fingerprint ? h("p.mkz-fp.muted", `${p.fingerprint}${p.signatureStatus === "new" ? " · New friend" : p.signatureStatus === "warning" ? " · Same name, different key" : ""}`) : null,
      h("p.mkz-own", h("b", p.empty ? "All opened" : `${left} sealed`), ` · ${p.total - left} opened of ${p.total}`),
      p.total <= 60 ? h("div.mkz-pips", { "aria-hidden": "true" }, Array.from({ length: p.total }, (_, i) => h("i" + (i < left ? "" : ".o")))) : null,
      h("div.mkz-buy", h("p.mkz-rule", rule),
        p.empty ? h("button.btn.mkz-act", { type: "button", on: { click: () => Shell.go("market") } }, "Find more in the Market") : [one, ten],
        !p.empty && more ? h("small.muted", many === 10 ? "Ten at a time: one tear, ten stickers, all picked at random." : "All the rest in one go.") : null,
        h("button.mkz-back.link", { type: "button" }, "Back to the shelf")));
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
