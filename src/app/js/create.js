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
function crReset() { CR.flushStroke?.(); CR.flushStroke=null; CR.previewObserver?.disconnect(); if(CR.keys) document.removeEventListener('keydown',CR.keys); CR.urls.forEach(u=>URL.revokeObjectURL(u)); Object.assign(CR,{stage:'empty',src:null,photo:null,original:null,res:null,note:'',editing:null,editMaterial:null,urls:[],history:{canUndo:false,canRedo:false},zoom:{scale:1,x:0,y:0}}); }
async function crBegin(bytes) {
  if(!usableMats().includes(S.chosen)) { Shell.toast("No material sheets left. Visit Market to exchange Scraps."); return; }
  CR.stage='cutting'; Shell.refresh();
  try { await Bridge.invoke('creator_begin_bytes',{bytes:Array.from(bytes),materialId:S.chosen}); } catch(e) { crReset(); Shell.refresh(); Shell.toast(String(e)); }
}
async function crLoadFile(file) { if(!file?.type.startsWith('image/')) return; CR.samplePhoto=null; await crBegin(new Uint8Array(await file.arrayBuffer())); }
async function crLoadSample(key) {
  const {photo,alpha}=await Stk.fakePhoto(A[key],PHOTO_W); CR.samplePhoto=photo;
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
  CR.original=photo; CR.photo=CR.samplePhoto || photo; CR.stage='ready'; await Bridge.reload(); if(S.page==='create') Shell.refresh();
}
Bridge.listen('creator-changed',()=>crSync().catch(e=>Shell.toast(String(e))));
const canvasPoint = (cv, e) => {
  const r = cv.getBoundingClientRect(), k = Math.min(r.width / cv.width, r.height / cv.height), ox = (r.width - cv.width * k) / 2, oy = (r.height - cv.height * k) / 2;
  return { x: (e.clientX - r.left - ox) / k, y: (e.clientY - r.top - oy) / k, k, ox, oy, r };
};

Pages.create = {
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
    else if (CR.stage === "cutting") root.append(h("div.cr-cutting", h("div.cut-anim"), h("p", "Cutting…"), h("p.muted", "Taking the background away")));
    else root.append(this.mat());
    return root;
  },
  empty() {
    const file = h("input", { type: "file", accept: "image/*", hidden: true, on: { change: (e) => crLoadFile(e.target.files[0]) } });
    const zone = h("div.drop", { tabindex: 0, role: "button", "aria-label": "Choose an image",
      on: { click: () => crChooseFile(), keydown: (e) => (e.key === "Enter" || e.key === " ") && crChooseFile(),
        dragover: (e) => { e.preventDefault(); zone.classList.add("over"); }, dragleave: () => zone.classList.remove("over"),
        drop: (e) => { e.preventDefault(); zone.classList.remove("over"); crLoadFile(e.dataTransfer.files[0]); } } },
      h("i.drop-obj"), h("b", "Drop an image here"), h("small", "or click to choose a file"), file);
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
      if (width > 0 && height > 0) sticker.style.width = Math.min(230, 230 * res.aspect, width, height * res.aspect) + "px";
    };
    const sizeCv = () => { origCv.width = CR.photo.width; origCv.height = CR.photo.height; cutCv.width = CR.photo.width; cutCv.height = CR.photo.height; };
    sizeCv();
    origBg.width=origCv.width;origBg.height=origCv.height;
    origBg.getContext("2d").drawImage(CR.photo,0,0);origCv.getContext("2d").drawImage(CR.photo,0,0);
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
    const seg = h("div.seg", ["erase", "restore"].map((t) => h("button", { "aria-pressed": String(CR.tool === t), on: { click: (e) => { CR.tool = t; $$(".seg button", mat).forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); Snd.tap(); } } }, t === "erase" ? "Erase" : "Restore")));
    const make = h("button.btn", { on: { click: () => this.make() } }, CR.editing ? "Save changes" : "Make this Peta");
    const syncMake = () => { make.disabled = !CR.res || painting || Boolean(rendering); };

    const tray = CR.editing ? h("div.edit-material", h("div.material-plate", {data:{m:S.chosen}}, MaterialPlateContents(MAT[S.chosen], "Original material"))) : MaterialTray({w:86,onPick:()=>{redraw();const u=$(".uses");if(u)u.replaceChildren(...usesLabel());}});

    const mat = h("div.cr-mat",
      h("i.tape.t1", { style: { left: "26px", top: "-12px", transform: "rotate(-6deg)" } }), h("i.tape.t4", { style: { right: "40px", top: "-12px", transform: "rotate(5deg)" } }),
      h("div.panes",
        pane("orig", "Original", origBg, origCv), h("span.arrow", "→"),
        h("figure.pane.cut", cutFrame, caption(2,"Cutout — paint to fix")), h("span.arrow", "→"),
        h("figure.pane.stk-pane", h("div.frame.desk", stkHost), caption(3,"Sticker"))),
      h("div.cr-controls",
        h("div.grp.g-mat", h("label.lbl", "Material"), tray),
        h("div.grp.g-look", h("label.lbl", "Look"), slider("Outline", "border", 4, 64, "", redraw), slider("Smooth", "smooth", 0, 12, "", redraw)),
        h("div.grp.g-tools", h("label.lbl", "Brush"), h("div.tools", seg, undoBtn, redoBtn), slider("Size", "brush", 1, 60, "", () => {})),
        h("div.grp.g-go", CR.note ? h("p.muted.small", CR.note) : null, h("div.go-btns", h("span.muted.small.uses", usesLabel()), h("button.btn.quiet", { on: { click: async () => { const editing=CR.editing; CR.flushStroke?.(); await CR.queue; await Bridge.invoke("creator_cancel"); crReset(); await Shell.open(editing ? "book" : "create"); } } }, "Cancel"), make))));
    Stk.tilt(stkHost, {max:8,scale:1.02,trigger:stkHost.parentElement});
    syncUndo(); syncMake(); redraw();
    return h("div.cr-wrap", mat);
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
