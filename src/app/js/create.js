/* The prototype's controls call the real Rust cutting session. */
const CR = {stage:"empty",src:null,photo:null,original:null,border:20,smooth:4,strength:.5,editing:null,editMaterial:null,tool:"erase",brush:12,res:null,note:"",urls:[],history:{canUndo:false,canRedo:false},queue:Promise.resolve(),zoom:{scale:1,x:0,y:0}};
const SAMPLE_KEYS = ["sCat","sBlueFlower","sCoffee","sCamera","sEgg","sGoodDay","sPlant","sPolaroid","sCassette","sComputer","sScribble","sBubble"];
const PHOTO_W = 720;
const usesText = () => !S.chosen ? "No material sheets left" : CR.editing ? "Editing original · no material used" : (MAT[S.chosen].unlimited ? "Uses one "+MAT[S.chosen].name+" (never runs out)" : `Uses 1 ${MAT[S.chosen].name} · ${S.stock[S.chosen]} left`);
const usesLabel = () => {
  const text=usesText(); if(!S.chosen) return text;
  const name=MAT[S.chosen].name, at=text.indexOf(name);
  return CR.editing ? text : [text.slice(0,at),h("b",name),text.slice(at+name.length)];
};
function crReset() { if(CR.preview?.startsWith('blob:')) URL.revokeObjectURL(CR.preview); CR.flushStroke?.(); CR.flushStroke=null; CR.previewObserver?.disconnect(); if(CR.keys) document.removeEventListener('keydown',CR.keys); CR.urls.forEach(u=>URL.revokeObjectURL(u)); Object.assign(CR,{preview:null,reveal:false,stage:'empty',src:null,photo:null,original:null,res:null,note:'',editing:null,editMaterial:null,urls:[],history:{canUndo:false,canRedo:false},zoom:{scale:1,x:0,y:0}}); }
async function crBegin(bytes) {
  if(!usableMats().includes(S.chosen)) { Shell.toast("No material sheets left. Visit Market to exchange Scraps."); return; }
  CR.stage='cutting'; Shell.refresh();
  try { await Bridge.invoke('creator_begin_bytes',{bytes:Array.from(bytes),materialId:S.chosen}); } catch(e) { crReset(); Shell.refresh(); Shell.toast(String(e)); }
}
async function crLoadFile(file) { if(!file?.type.startsWith('image/')) return; CR.samplePhoto=null; CR.preview=URL.createObjectURL(file); await crBegin(new Uint8Array(await file.arrayBuffer())); }
async function crLoadSample(key) {
  const {photo,alpha}=await Stk.fakePhoto(A[key],PHOTO_W); CR.samplePhoto=photo; CR.preview=photo.toDataURL('image/jpeg',.85);
  const blob=await new Promise(resolve=>alpha.toBlob(resolve,'image/png'));
  await crBegin(new Uint8Array(await blob.arrayBuffer()));
}
async function crSync() {
  const info=await Bridge.invoke('creator_info');
  if(info.phase==='idle') { if(CR.stage!=='empty') { crReset(); Shell.refresh(); } return; }
  if(info.phase==='failed') { const editing=CR.editing; crReset(); if(editing) await Shell.open('book'); else Shell.refresh(); Shell.toast(info.error); return; }
  if(info.phase==='loading') { CR.stage='cutting'; if(S.page==='create') Shell.refresh(); return; }
  if(info.phase!=='ready') return;
  CR.editing=info.editingStickerId || null; CR.editMaterial=CR.editing ? info.defaultMaterial : null; CR.strength=info.defaultStrength;
  if(CR.editing) { S.chosen=CR.editMaterial; CR.border=info.defaultOutline; CR.smooth=Math.round(info.defaultSmooth*12); CR.strength=info.defaultStrength; }
  const bytes=await Bridge.invoke('creator_original'), url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}));
  const i=await Stk.load(url), photo=Stk.cv(info.width,info.height); photo.getContext('2d').drawImage(i,0,0,info.width,info.height); URL.revokeObjectURL(url);
  CR.original=photo; CR.photo=CR.samplePhoto || photo; CR.reveal=CR.stage==='cutting'; CR.stage='ready'; await Bridge.reload(); if(S.page==='create') Shell.refresh();
}
Bridge.listen('creator-changed',()=>crSync().catch(e=>Shell.toast(String(e))));
const canvasPoint = (cv, e) => {
  const r = cv.getBoundingClientRect(), k = Math.min(r.width / cv.width, r.height / cv.height), ox = (r.width - cv.width * k) / 2, oy = (r.height - cv.height * k) / 2;
  return { x: (e.clientX - r.left - ox) / k, y: (e.clientY - r.top - oy) / k, k, ox, oy, r };
};

/* ⌘V on the empty Create page cuts out the picture on the clipboard (Rust reads it; the page has no Edit menu to receive a paste). */
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.key.toLowerCase()!=='v' || S.page!=='create' || CR.stage!=='empty') return;
  if(e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || Bridge.dialogOpen || Bridge.busy || document.querySelector('.cer, dialog[open]')) return;
  e.preventDefault();
  if(!usableMats().includes(S.chosen)) { Shell.toast('No material sheets left. Visit Market to exchange Scraps.'); return; }
  CR.samplePhoto=null;
  Bridge.invoke('creator_begin_clipboard',{materialId:S.chosen}).catch(err=>Shell.toast(String(err)));
});

/* The three steps shown over the mat: the photo is in, the cutout is yours to fix, then the stock decides what it becomes. */
function createSteps(active) {
  const els = ["Photo", "Cutout", "Stock"].map((t, i) => h("span", h("b", String(i + 1)), t));
  const set = n => els.forEach((e, i) => { e.classList.toggle("on", i === n); e.classList.toggle("done", i < n); });
  set(active); return { el: h("div.cs-steps", els), set };
}

Pages.create = {
  /* A picture can reach Rust first (Finder "Open With", the Dock, the menu bar): pick up a session that is already running. */
  async enter(el, o = {}) {
    if(o.refresh || CR.stage!=='empty') return;
    try { const info=await Bridge.invoke('creator_info'); if(['loading','ready'].includes(info.phase)) await crSync(); } catch {}
  },
  build() {
    if(CR.editing) S.chosen=CR.editMaterial || S.chosen;
    else if (!usableMats().includes(S.chosen)) S.chosen = usableMats()[0];
    const root = h("div.page-in.create");
    const ready = CR.stage === "ready";
    root.append(PageHead(CR.editing ? "Edit sticker" : "Create", ready ? "Cutting Mat" : "Make a Peta"));
    if(!CR.editing && !S.chosen) {
      root.append(h("div.empty",h("p","No material sheets left."),h("p.muted","Open an envelope or exchange Scraps for more."),h("button.btn.paper",{on:{click:()=>{MK.tab="materials";Shell.go("market");}}},"Visit Market")));
      return root;
    }
    if (CR.stage === "empty") root.append(this.empty());
    else if (CR.stage === "cutting") root.append(this.cutting());
    else root.append(this.mat());
    return root;
  },
  /* While Rust finds the edge, the photo sits on the mat under a slow band of light. */
  cutting() {
    const card = h("div.cs-photo", h("div.cs-photo-in", CR.preview ? h("img", { src: CR.preview, alt: "" }) : h("div.cut-anim"), h("i.cs-scan.loop", { "aria-hidden": "true" })), h("i.cs-tape", { "aria-hidden": "true" }));
    return h("div.cr-wrap", h("div.cr-stage.cs-wait", h("div.cs-top", createSteps(0).el), h("div.cs-center", card, h("p.cs-wait-text", { role: "status" }, "Finding the edge…"))));
  },
  empty() {
    const file = h("input", { type: "file", accept: "image/*", hidden: true, on: { change: (e) => crLoadFile(e.target.files[0]) } });
    const zone = h("div.drop", { tabindex: 0, role: "button", "aria-label": "Choose an image",
      on: { click: () => crChooseFile(), keydown: (e) => (e.key === "Enter" || e.key === " ") && crChooseFile(),
        dragover: (e) => { e.preventDefault(); zone.classList.add("over"); }, dragleave: () => zone.classList.remove("over"),
        drop: (e) => { e.preventDefault(); zone.classList.remove("over"); crLoadFile(e.dataTransfer.files[0]); } } },
      h("i.drop-obj"), h("b", "Drop an image here"), h("small", "or click to choose a file · ⌘V to paste"), file);
    return h("section.cr-empty", zone,
      h("div.cr-samples", h("p.eyebrow", "Or try one of these"), h("div.sample-grid", SAMPLE_KEYS.map((k, i) =>
        h("button.sample", { style: { "--i": i }, title: SAMPLE_TITLES[k], on: { click: () => { Snd.tap(); crLoadSample(k); } } }, h("img", { src: A[k], alt: SAMPLE_TITLES[k] }))))));
  },
  mat() {
    const origCv = h("canvas"), origBg = h("canvas.original-background"), cutCv = h("canvas.cut"), ring = h("i.ring");
    const caption = (n,title) => h("figcaption", h("i.step-number",String(n)), title);
    const stkHost = h("div.stk-host"), pane = (cls, title, ...kids) => h("figure.pane." + cls, h("div.frame", ...kids), caption(1,title));
    const fitSticker = () => {
      const sticker = stkHost.querySelector(".stk"), res = CR.res;
      if (!sticker || !res) return;
      const css = getComputedStyle(stkHost);
      const width = stkHost.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const height = stkHost.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      if (width > 0 && height > 0) sticker.style.width = Math.min(460, 460 * res.aspect, width, height * res.aspect) + "px";
    };
    const sizeCv = () => { origCv.width = CR.photo.width; origCv.height = CR.photo.height; cutCv.width = CR.photo.width; cutCv.height = CR.photo.height; };
    sizeCv();
    origBg.width=origCv.width;origBg.height=origCv.height;
    origBg.getContext("2d").drawImage(CR.photo,0,0);origCv.getContext("2d").drawImage(CR.photo,0,0);
    // The first time the cutout is ready: a band of light, a glow around the subject, the photograph falls away and the
    // subject is lifted into the finished sticker. Never on later redraws, and not with Reduce motion.
    let reveal = CR.reveal && !reduced(); CR.reveal = false;
    const photoCv = h("canvas"), ghost = h("canvas.cs-ghost"), scan = h("i.cs-scan", { "aria-hidden": "true" });
    photoCv.width = ghost.width = CR.photo.width; photoCv.height = ghost.height = CR.photo.height;
    photoCv.getContext("2d").drawImage(CR.photo, 0, 0);
    const photoCard = h("div.cs-photo", { hidden: !reveal, "aria-hidden": "true" }, h("div.cs-photo-in", photoCv, ghost, scan), h("i.cs-tape"));
    const landReveal = async () => {
      const sticker = stkHost.firstElementChild, inner = photoCard.firstElementChild;
      if (!sticker || !inner.isConnected) { photoCard.hidden = true; return; }
      sticker.style.opacity = 0;
      ghost.getContext("2d").drawImage(cutCv, 0, 0);
      const small = document.createElement("canvas"), k0 = Math.min(1, 160 / Math.max(cutCv.width, cutCv.height));
      small.width = Math.max(1, Math.round(cutCv.width * k0)); small.height = Math.max(1, Math.round(cutCv.height * k0));
      small.getContext("2d").drawImage(cutCv, 0, 0, small.width, small.height);
      const b0 = PetaMath.alphaBounds(small.getContext("2d").getImageData(0, 0, small.width, small.height).data, small.width, small.height);
      const box = b0 && { x: b0.x / k0, y: b0.y / k0, w: b0.w / k0, h: b0.h / k0 };
      anim(scan, [{ transform: "translateY(-110%)", opacity: .9 }, { transform: "translateY(520%)", opacity: 0 }], { duration: 760, easing: EASE.inOut });
      await anim(ghost, [{ filter: "none" }, { filter: "drop-shadow(0 0 2px #fff) drop-shadow(0 0 10px #a9e4ff) drop-shadow(0 0 20px #ffc2e6)" }], { duration: 520, easing: EASE.out });
      photoCard.classList.add("fall");
      anim(photoCv, [{ opacity: 1, filter: "blur(0)" }, { opacity: 0, filter: "blur(6px)" }], { duration: 420, easing: EASE.out });
      await sleep(280);
      const sr = sticker.getBoundingClientRect(), ir = inner.getBoundingClientRect();
      if (box && sr.width) {
        const kp = Math.min(ir.width / CR.photo.width, ir.height / CR.photo.height), ox = ir.left + (ir.width - CR.photo.width * kp) / 2, oy = ir.top + (ir.height - CR.photo.height * kp) / 2;
        const cx = ox + (box.x + box.w / 2) * kp, cy = oy + (box.y + box.h / 2) * kp, gr = ghost.getBoundingClientRect();
        const scale = (sr.width * box.w / (box.w + 2 * CR.border)) / (box.w * kp);
        ghost.style.transformOrigin = `${cx - gr.left}px ${cy - gr.top}px`;
        await anim(ghost, [{ transform: "none" }, { transform: `translate(${sr.left + sr.width / 2 - cx}px, ${sr.top + sr.height / 2 - cy}px) scale(${scale})` }], { duration: 620, easing: EASE.inOut });
      }
      sticker.style.opacity = ""; photoCard.hidden = true;
      anim(sticker, [{ transform: "scale(1.06)" }, { transform: "scale(.975)", offset: .6 }, { transform: "none" }], { duration: 380, easing: EASE.out }).then(a => a.cancel());
    };
    let seq = 0, rendering = null, renderRequested = false;
    const redraw = () => {
      ++seq; renderRequested = true;
      return drainRender();
    };
    // One render at a time. New edits invalidate its result and request only the latest image.
    const drainRender = () => {
      if (rendering) return rendering;
      if (painting || !renderRequested) return Promise.resolve();
      rendering = (async () => {
        while (renderRequested && !painting && stkHost.isConnected) {
          renderRequested = false;
          let queued;
          do { queued=CR.queue; await queued; } while(queued!==CR.queue);
          if (painting) { renderRequested = true; break; }
          const mine = seq;
          try {
            const buffer = await Bridge.invoke("creator_render", { materialId:S.chosen, strength:CR.strength, smooth:CR.smooth/12, outline:CR.border, preview:false });
            if(mine !== seq || painting || !stkHost.isConnected) continue;
            const bytes = new Uint8Array(buffer), length = new DataView(bytes.buffer).getUint32(0);
            const head = JSON.parse(new TextDecoder().decode(bytes.slice(4,4+length)));
            const offset = 4+length;
            const sticker = URL.createObjectURL(new Blob([bytes.slice(offset,offset+head.stickerLen)], {type:"image/png"}));
            const cutout = URL.createObjectURL(new Blob([bytes.slice(offset+head.stickerLen)], {type:"image/png"}));
            const [stickerImg,cutImg] = await Promise.all([Stk.load(sticker),Stk.load(cutout)]);
            if(mine !== seq || painting || !stkHost.isConnected) { URL.revokeObjectURL(sticker); URL.revokeObjectURL(cutout); continue; }
            CR.urls.forEach(url=>URL.revokeObjectURL(url)); CR.urls=[sticker,cutout];
            const cx = cutCv.getContext("2d"); cx.clearRect(0,0,cutCv.width,cutCv.height);
            // Rust returns the cutout at the original working-image size.
            cx.drawImage(cutImg,0,0,cutCv.width,cutCv.height);
            const res = {url:sticker,w:head.width,h:head.height,aspect:head.width/head.height,material:S.chosen,mask:['holographic','gold'].includes(S.chosen)?sticker:null}; CR.res=res;
            stkHost.replaceChildren(Stk.el(res,res.aspect>=1?230:230*res.aspect)); fitSticker(); syncMake();
            if(reveal) { reveal=false; landReveal(); }
          } catch(e) {
            if (mine !== seq || painting || !stkHost.isConnected) continue;
            CR.res=null; stkHost.replaceChildren(h("p.muted", "Nothing left to cut out")); syncMake(); Shell.toast(String(e));
          }
        }
      })().finally(() => { rendering=null; syncMake(); if(renderRequested && !painting && stkHost.isConnected) drainRender(); });
      return rendering;
    };
    // Paint locally immediately, retain every input point, then commit one native undo step on release.
    // Restore uses the real working photo, never the sample's invented background.
    let painting=false, last=null, activeStroke=null;
    const stroke = p => {
      const c=cutCv.getContext("2d"), radius=activeStroke.radius;
      activeStroke.points.push([p.x/CR.photo.width,p.y/CR.photo.height]);
      c.save(); c.beginPath(); c.lineWidth=radius*2; c.lineCap=c.lineJoin="round";
      if(last) { c.moveTo(last.x,last.y); c.lineTo(p.x,p.y); }
      else { c.arc(p.x,p.y,radius,0,Math.PI*2); }
      if(activeStroke.restore) {
        // A stroke outline is needed to clip the original photo into a round brush path.
        const mask=activeStroke.mask, m=mask.getContext("2d");
        m.clearRect(0,0,mask.width,mask.height); m.lineWidth=radius*2; m.lineCap=m.lineJoin="round";
        m.beginPath(); if(last) { m.moveTo(last.x,last.y); m.lineTo(p.x,p.y); m.stroke(); }
        else { m.arc(p.x,p.y,radius,0,Math.PI*2); m.fill(); }
        m.globalCompositeOperation="source-in"; m.drawImage(CR.original,0,0); m.globalCompositeOperation="source-over";
        c.drawImage(mask,0,0);
      } else {
        c.globalCompositeOperation="destination-out"; last ? c.stroke() : c.fill();
      }
      c.restore(); last=p;
    };
    const resetZoom = h("button.preview-reset", { type:"button", hidden:CR.zoom.scale===1, "aria-label":"Reset cutout zoom", title:"Reset zoom", on:{click:()=>{Object.assign(CR.zoom,{scale:1,x:0,y:0});applyZoom();}} }, "100%");
    const cutFrame = h("div.frame.checker", { title:"Scroll to zoom the cutout" }, cutCv, ring, resetZoom);
    const constrainZoom = () => {
      const fit=Math.min(cutFrame.clientWidth/cutCv.width,cutFrame.clientHeight/cutCv.height);
      const mx=Math.max(0,(cutCv.width*fit*CR.zoom.scale-cutFrame.clientWidth)/2),my=Math.max(0,(cutCv.height*fit*CR.zoom.scale-cutFrame.clientHeight)/2);
      CR.zoom.x=clamp(CR.zoom.x,-mx,mx);CR.zoom.y=clamp(CR.zoom.y,-my,my);
    };
    const applyZoom = () => {
      if(!cutFrame.clientWidth) return;
      constrainZoom();
      cutCv.style.transform=`translate(${CR.zoom.x}px,${CR.zoom.y}px) scale(${CR.zoom.scale})`;
      resetZoom.textContent=Math.round(CR.zoom.scale*100)+"%";
      resetZoom.hidden=CR.zoom.scale===1;
    };
    cutFrame.addEventListener("wheel",e=>{
      e.preventDefault();
      if(painting || e.target.closest("button")) return;
      const r=cutFrame.getBoundingClientRect(),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?r.height:1);
      const next=clamp(CR.zoom.scale*Math.exp(-delta*.002),1,6),factor=next/CR.zoom.scale;
      const x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;
      CR.zoom.x=x-(x-CR.zoom.x)*factor;CR.zoom.y=y-(y-CR.zoom.y)*factor;CR.zoom.scale=next;
      applyZoom();moveRing(e);
    },{passive:false});
    const resizePreview=new ResizeObserver(()=>{ applyZoom(); fitSticker(); });resizePreview.observe(cutFrame);resizePreview.observe(stkHost);
    CR.previewObserver?.disconnect();CR.previewObserver=resizePreview;
    // The reset button must never start a Rust brush stroke.
    resetZoom.addEventListener("pointerdown",e=>e.stopPropagation());
    const moveRing = (e) => { const p = canvasPoint(cutCv, e), fr = cutFrame.getBoundingClientRect(), d = CR.brush * 2 * p.k; ring.style.width = ring.style.height = d + "px"; ring.style.left = e.clientX - fr.left + "px"; ring.style.top = e.clientY - fr.top + "px"; ring.dataset.tool = CR.tool; ring.style.opacity = 1; };
    cutFrame.addEventListener("pointermove", e => {
      moveRing(e);
      if(painting) { const events=e.getCoalescedEvents?.(); for(const point of events?.length ? events : [e]) stroke(canvasPoint(cutCv,point)); }
    });
    cutFrame.addEventListener("pointerleave", () => { ring.style.opacity = 0; });
    cutFrame.addEventListener("pointerdown", (e) => {
      if(e.button!==0 || e.target.closest("button")) return;
      e.preventDefault();
      cutFrame.setPointerCapture(e.pointerId); painting = true; last = null; ++seq;
      activeStroke={points:[],radius:CR.brush,restore:CR.tool==='restore',pointerId:e.pointerId,
        mask:CR.tool==='restore'?Stk.cv(cutCv.width,cutCv.height):null};
      syncMake();
      stroke(canvasPoint(cutCv, e));
    });
    const endPaint = e => {
      if(!painting) return;
      if(e?.type==='pointerup') stroke(canvasPoint(cutCv,e));
      const completed=activeStroke; painting=false; activeStroke=null; last=null;
      if(cutFrame.hasPointerCapture(completed.pointerId)) cutFrame.releasePointerCapture(completed.pointerId);
      const args={points:completed.points,radius:completed.radius/CR.photo.width,restore:completed.restore,newStroke:true};
      CR.queue=CR.queue.then(()=>Bridge.invoke("creator_stroke",args)).then(value=>{
        CR.history=value; syncUndo();
      }).catch(e=>Shell.toast(String(e)));
      redraw();
    };
    cutFrame.addEventListener("pointerup",endPaint); cutFrame.addEventListener("pointercancel",endPaint);
    cutFrame.addEventListener("lostpointercapture",endPaint);
    CR.flushStroke=endPaint;

    const history = async command => {
      endPaint(); ++seq;
      CR.queue=CR.queue.then(()=>Bridge.invoke(command)).then(value=>{CR.history=value;syncUndo();}).catch(e=>Shell.toast(String(e)));
      await CR.queue; await redraw(); Snd.tap();
    };
    const undo=()=>history("creator_undo"), redo=()=>history("creator_redo");
    const historyIcon = reverse => {
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg"), path=document.createElementNS(svg.namespaceURI,"path");
      svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");
      path.setAttribute("d",reverse ? "M21 8h-6M21 8V2M21 8c-3-5-11-5-13 0-3 5 1 11 6 11" : "M3 8h6M3 8V2M3 8c3-5 11-5 13 0 3 5-1 11-6 11");
      path.setAttribute("fill","none");path.setAttribute("stroke","currentColor");path.setAttribute("stroke-width","1.7");path.setAttribute("stroke-linecap","round");path.setAttribute("stroke-linejoin","round");svg.append(path);return svg;
    };
    const undoBtn = h("button.history-button", { "aria-label":"Undo", title: "Undo (⌘Z)", on: { click: undo } }, historyIcon(false));
    const redoBtn = h("button.history-button", { "aria-label":"Redo", title: "Redo (⇧⌘Z)", on: { click: redo } }, historyIcon(true));
    const syncUndo = () => { undoBtn.disabled = !CR.history.canUndo; redoBtn.disabled = !CR.history.canRedo; };
    CR.keys && document.removeEventListener("keydown", CR.keys);
    CR.keys = (e) => { if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || !$(".cr-mat") || e.target.closest("input")) return; e.preventDefault(); e.shiftKey ? redo() : undo(); };
    document.addEventListener("keydown", CR.keys);
    const slider = (label, key, min, max, unit, onChange) => { const out = h("output", CR[key] + unit); const inp = h("input", { type: "range", min, max, value: CR[key], on: { input: (e) => { CR[key] = +e.target.value; out.textContent = CR[key] + unit; onChange(); } } }); return h("label.slider", h("span", label), inp, out); };
    const seg = h("div.seg.only-edit", ["erase", "restore"].map((t) => SegButton(t === "erase" ? "Erase" : "Restore", { "aria-pressed": String(CR.tool === t), on: { click: (e) => { CR.tool = t; $$(".seg button", mat).forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); Snd.tap(); } } })));
    const make = h("button.btn", { on: { click: () => this.make() } }, CR.editing ? "Save changes" : "Make this Peta");
    const syncMake = () => { make.disabled = !CR.res || painting || Boolean(rendering); };

    const steps = createSteps(1);
    const tray = CR.editing ? h("div.edit-material", h("div.material-plate", {data:{m:S.chosen}}, MaterialPlateContents(MAT[S.chosen], "Original material"))) : MaterialTray({w:86,onPick:()=>{steps.set(2);redraw();const u=$(".uses");if(u)u.replaceChildren(...usesLabel());}});

    // The sticker is the subject. Fixing the cutout swaps it for the editable cutout; the sticker keeps updating in a corner.
    const setMode = mode => { mat.dataset.mode = mode; fixBtn.setAttribute("aria-pressed", String(mode === "edit")); Snd.tap(); };
    const fixBtn = h("button.cs-tool.only-view", { type: "button", "aria-pressed": "false", title: "Erase or restore parts of the cutout", on: { click: () => setMode("edit") } }, "Fix the cutout");
    const doneBtn = h("button.cs-tool.cs-done.only-edit", { type: "button", on: { click: () => { endPaint(); setMode("view"); } } }, "Done");
    const refine = h("div.cs-refine", { hidden: true, role: "group", "aria-label": "Refine the edge" }, slider("Outline", "border", 4, 64, "", redraw), slider("Smooth", "smooth", 0, 12, "", redraw));
    const refineBtn = h("button.cs-tool", { type: "button", "aria-expanded": "false", title: "Outline and smoothness", on: { click: () => { const open = refine.hidden; refine.hidden = !open; refineBtn.setAttribute("aria-expanded", String(open)); Snd.tap(); } } }, "Refine");
    const size = slider("Size", "brush", 1, 60, "", () => {}); size.classList.add("only-edit");
    const dock = h("div.cs-dock", { role: "toolbar", "aria-label": "Cutout tools" }, fixBtn, seg, size, undoBtn, redoBtn, h("span.cs-sep"), refineBtn, doneBtn);
    const orig = h("div.cs-orig", { title: "Your original photo", tabindex: 0, "aria-label": "Original photo" }, h("div.frame", origBg, origCv), h("small", "Original"));

    const stickerBox = h("div.cs-sticker", stkHost);
    const mat = h("div.cr-mat.cr-stage", { data: { mode: "view" } },
      h("div.cs-top", steps.el, CR.note ? h("p.muted.small", CR.note) : null),
      h("div.cs-center", photoCard, stickerBox, h("div.cs-editor", cutFrame, orig)),
      h("aside.cs-rail", h("label.lbl", CR.editing ? "Material" : "Stock"), tray),
      refine, dock);
    const foot = h("div.cs-foot.g-go", h("span.muted.small.uses", usesLabel()), h("div.go-btns", h("button.btn.quiet", { on: { click: async () => { const editing=CR.editing; CR.flushStroke?.(); await CR.queue; await Bridge.invoke("creator_cancel"); crReset(); await Shell.open(editing ? "book" : "create"); } } }, CR.editing ? "Cancel" : "Start over"), make));
    Stk.tilt(stkHost, {max:8,scale:1.02,trigger:stickerBox});
    syncUndo(); syncMake(); redraw();
    return h("div.cr-wrap", mat, foot);
  },
  suspend() { CR.flushStroke?.(); },
  leave() { CR.flushStroke?.(); CR.previewObserver?.disconnect(); if(CR.keys) document.removeEventListener("keydown",CR.keys); },
  async make() {
    if (!CR.res || CR.finishing) return;
    CR.flushStroke?.(); CR.finishing = true; Bridge.busy = true;
    $$(".g-go button").forEach(b=>{ b.disabled=true; });
    if(CR.editing) {
      try { await CR.queue; const id=await Bridge.invoke("creator_save_original",{materialId:CR.editMaterial,strength:CR.strength,smooth:CR.smooth/12,outline:CR.border}); crReset(); BK.sel=id; await Bridge.reload(); await Shell.open("book"); Shell.toast("Changes saved."); }
      catch(e) { Shell.toast(String(e)); $$(".g-go button").forEach(b=>{ b.disabled=false; }); } finally { CR.finishing=false; Bridge.busy=false; }
      return;
    }
    try { await CR.queue; await Bridge.printAction("creator_finish",{materialId:S.chosen,strength:CR.strength,smooth:CR.smooth/12,outline:CR.border}); crReset(); await Bridge.reload(); Shell.refresh(); }
    catch(e) { Shell.toast(String(e)); $$(".g-go button").forEach(b=>{ b.disabled=false; }); } finally { CR.finishing=false; Bridge.busy=false; }
  },
};

async function crChooseFile() {
  Bridge.dialogOpen=true; CR.samplePhoto=null;
  try { await Bridge.invoke('daily_create',{materialId:S.chosen}); } catch(e) { Shell.toast(String(e)); }
  finally { Bridge.dialogOpen=false; }
}
window.__TAURI__.webview.getCurrentWebview().onDragDropEvent(async event=>{
  const p=event.payload, zone=document.querySelector('.drop');
  zone?.classList.toggle('over',p.type==='enter'||p.type==='over');
  if(p.type!=='drop'||S.page!=='create'||!p.paths.length) return;
  CR.samplePhoto=null; CR.stage='cutting'; Shell.refresh();
  try { await Bridge.invoke('creator_begin_path',{path:p.paths[0],materialId:S.chosen}); }
  catch(e) { crReset(); Shell.refresh(); Shell.toast(String(e)); }
});
