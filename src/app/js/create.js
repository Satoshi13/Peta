/* The prototype's controls call the real Rust cutting session. */
const CR = {stage:"empty",src:null,photo:null,border:20,smooth:4,tool:"erase",brush:26,res:null,note:"",urls:[],history:{canUndo:false,canRedo:false},queue:Promise.resolve()};
const SAMPLE_KEYS = ["sCat","sBlueFlower","sCoffee","sCamera","sEgg","sGoodDay","sPlant","sPolaroid","sCassette","sComputer","sScribble","sBubble"];
const PHOTO_W = 720;
const usesText = () => "Uses one "+MAT[S.chosen].name+(MAT[S.chosen].unlimited?" (never runs out)":` — ${S.stock[S.chosen]} left`);
function crReset() { if(CR.keys) document.removeEventListener('keydown',CR.keys); CR.urls.forEach(u=>URL.revokeObjectURL(u)); Object.assign(CR,{stage:'empty',src:null,photo:null,res:null,note:'',urls:[],history:{canUndo:false,canRedo:false}}); }
async function crBegin(bytes) {
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
  if(info.phase==='failed') { CR.stage='empty'; Shell.refresh(); Shell.toast(info.error); return; }
  if(info.phase==='loading') { CR.stage='cutting'; if(S.page==='create') Shell.refresh(); return; }
  if(info.phase!=='ready') return;
  const bytes=await Bridge.invoke('creator_original'), url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}));
  const i=await Stk.load(url), photo=Stk.cv(info.width,info.height); photo.getContext('2d').drawImage(i,0,0,info.width,info.height); URL.revokeObjectURL(url);
  CR.photo=CR.samplePhoto || photo; CR.stage='ready'; await Bridge.reload(); if(S.page==='create') Shell.refresh();
}
Bridge.listen('creator-changed',()=>crSync().catch(e=>Shell.toast(String(e))));
const canvasPoint = (cv, e) => {
  const r = cv.getBoundingClientRect(), k = Math.min(r.width / cv.width, r.height / cv.height), ox = (r.width - cv.width * k) / 2, oy = (r.height - cv.height * k) / 2;
  return { x: (e.clientX - r.left - ox) / k, y: (e.clientY - r.top - oy) / k, k, ox, oy, r };
};

Pages.create = {
  build() {
    if (!usableMats().includes(S.chosen)) S.chosen = usableMats()[0];
    const root = h("div.page-in.create");
    const ready = CR.stage === "ready";
    root.append(PageHead("Create", ready ? "Cutting Mat" : "Make a Peta", ready ? h("span.muted.small.uses", usesText()) : null));
    if (CR.stage === "empty") root.append(this.empty());
    else if (CR.stage === "cutting") root.append(h("div.cr-cutting", h("div.cut-anim"), h("p.hand", "Cutting…"), h("p.muted", "Taking the background away")));
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
    const origCv = h("canvas"), cutCv = h("canvas.cut"), ring = h("i.ring");
    const stkHost = h("div.stk-host"), pane = (cls, title, ...kids) => h("figure.pane." + cls, h("div.frame", ...kids), h("figcaption", title));
    const sizeCv = () => { origCv.width = CR.photo.width; origCv.height = CR.photo.height; cutCv.width = CR.photo.width; cutCv.height = CR.photo.height; };
    sizeCv();
    let seq = 0;
    const redraw = async () => {
      const mine = ++seq;
      try {
        const buffer = await Bridge.invoke("creator_render", { materialId:S.chosen, strength:.5, smooth:CR.smooth/12, outline:CR.border, preview:false });
        const bytes = new Uint8Array(buffer), length = new DataView(bytes.buffer).getUint32(0);
        const head = JSON.parse(new TextDecoder().decode(bytes.slice(4,4+length)));
        const offset = 4+length;
        const sticker = URL.createObjectURL(new Blob([bytes.slice(offset,offset+head.stickerLen)], {type:"image/png"}));
        const cutout = URL.createObjectURL(new Blob([bytes.slice(offset+head.stickerLen)], {type:"image/png"}));
        const [stickerImg,cutImg] = await Promise.all([Stk.load(sticker),Stk.load(cutout)]);
        if(mine !== seq || !stkHost.isConnected) { URL.revokeObjectURL(sticker); URL.revokeObjectURL(cutout); return; }
        CR.urls.forEach(url=>URL.revokeObjectURL(url)); CR.urls=[sticker,cutout];
        origCv.getContext("2d").drawImage(CR.photo,0,0);
        const cx = cutCv.getContext("2d"); cx.clearRect(0,0,cutCv.width,cutCv.height);
        // Rust returns the cutout at the original working-image size.
        cx.drawImage(cutImg,0,0,cutCv.width,cutCv.height);
        const dim=Stk.cv(origCv.width,origCv.height), dx=dim.getContext("2d"); dx.fillStyle="rgba(30,24,16,.5)"; dx.fillRect(0,0,dim.width,dim.height); dx.globalCompositeOperation="destination-out"; dx.drawImage(cutImg,0,0,dim.width,dim.height); origCv.getContext("2d").drawImage(dim,0,0);
        const res = {url:sticker,w:head.width,h:head.height,aspect:head.width/head.height,material:S.chosen,mask:['holographic','gold'].includes(S.chosen)?sticker:null}; CR.res=res;
        stkHost.replaceChildren(Stk.el(res,res.aspect>=1?230:230*res.aspect)); Stk.tilt(stkHost,{max:8,scale:1.02}); syncMake();
      } catch(e) { CR.res=null; stkHost.replaceChildren(h("p.muted", "Nothing left to cut out")); syncMake(); Shell.toast(String(e)); }
    };
    // brush
    let painting=false,last=null,first=true;
    const stroke = p => {
      const points = last ? [[last.x/CR.photo.width,last.y/CR.photo.height],[p.x/CR.photo.width,p.y/CR.photo.height]] : [[p.x/CR.photo.width,p.y/CR.photo.height]];
      const newStroke = first; first=false; last=p;
      CR.queue=CR.queue.then(()=>Bridge.invoke("creator_stroke",{points,radius:CR.brush/CR.photo.width,restore:CR.tool==='restore',newStroke})).then(history=>{ CR.history=history; syncUndo(); redraw(); }).catch(e=>Shell.toast(String(e)));
    };
    const cutFrame = h("div.frame.checker", cutCv, ring);
    const moveRing = (e) => { const p = canvasPoint(cutCv, e), fr = cutFrame.getBoundingClientRect(), d = CR.brush * 2 * p.k; ring.style.width = ring.style.height = d + "px"; ring.style.left = e.clientX - fr.left + "px"; ring.style.top = e.clientY - fr.top + "px"; ring.dataset.tool = CR.tool; ring.style.opacity = 1; };
    cutFrame.addEventListener("pointermove", (e) => { moveRing(e); if (painting) stroke(canvasPoint(cutCv, e)); });
    cutFrame.addEventListener("pointerleave", () => { ring.style.opacity = 0; });
    cutFrame.addEventListener("pointerdown", (e) => {
      cutFrame.setPointerCapture(e.pointerId); painting = true; last = null;
      first = true;
      stroke(canvasPoint(cutCv, e));
    });
    const endPaint = () => { painting = false; last = null; }; cutFrame.addEventListener("pointerup", endPaint); cutFrame.addEventListener("pointercancel", endPaint);

    const history = async command => { await CR.queue; CR.history=await Bridge.invoke(command); syncUndo(); await redraw(); Snd.tap(); };
    const undo=()=>history("creator_undo"), redo=()=>history("creator_redo");
    const undoBtn = h("button.btn.paper.small", { title: "Undo (⌘Z)", on: { click: undo } }, "Undo");
    const redoBtn = h("button.btn.paper.small", { title: "Redo (⇧⌘Z)", on: { click: redo } }, "Redo");
    const syncUndo = () => { undoBtn.disabled = !CR.history.canUndo; redoBtn.disabled = !CR.history.canRedo; };
    CR.keys && document.removeEventListener("keydown", CR.keys);
    CR.keys = (e) => { if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || !$(".cr-mat") || e.target.closest("input")) return; e.preventDefault(); e.shiftKey ? redo() : undo(); };
    document.addEventListener("keydown", CR.keys);
    const slider = (label, key, min, max, unit, onChange) => { const out = h("output", CR[key] + unit); const inp = h("input", { type: "range", min, max, value: CR[key], on: { input: (e) => { CR[key] = +e.target.value; out.textContent = CR[key] + unit; onChange(); } } }); return h("label.slider", h("span", label), inp, out); };
    const seg = h("div.seg", ["erase", "restore"].map((t) => h("button", { "aria-pressed": String(CR.tool === t), on: { click: (e) => { CR.tool = t; $$(".seg button", mat).forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); Snd.tap(); } } }, t === "erase" ? "Erase" : "Restore")));
    const make = h("button.btn", { on: { click: () => this.make() } }, "Make this Peta");
    const syncMake = () => { make.disabled = !CR.res; };

    const tray = MaterialTray({ w: 86, onPick: () => { redraw(); const u = $(".uses"); if (u) u.textContent = usesText(); } });
    const mat = h("div.cr-mat",
      h("i.tape.t1", { style: { left: "26px", top: "-12px", transform: "rotate(-6deg)" } }), h("i.tape.t4", { style: { right: "40px", top: "-12px", transform: "rotate(5deg)" } }),
      h("div.panes",
        pane("orig", "Original", origCv), h("span.arrow", "→"),
        h("figure.pane.cut", cutFrame, h("figcaption", "Cutout — paint to fix")), h("span.arrow", "→"),
        h("figure.pane.stk-pane", h("div.frame.desk", stkHost), h("figcaption", "Sticker"))),
      h("div.cr-controls",
        h("div.grp.g-mat", h("label.lbl", "Material"), tray),
        h("div.grp.g-look", h("label.lbl", "Look"), slider("Outline", "border", 4, 64, "", redraw), slider("Smooth", "smooth", 0, 12, "", redraw)),
        h("div.grp.g-tools", h("label.lbl", "Brush"), h("div.tools", seg, undoBtn, redoBtn), slider("Size", "brush", 8, 60, "", () => {})),
        h("div.grp.g-go", CR.note ? h("p.muted.small", CR.note) : null, h("div.go-btns", h("button.btn.paper", { on: { click: async () => { await Bridge.invoke("creator_cancel"); crReset(); await Shell.open("create"); } } }, "Cancel"), make))));
    syncUndo(); syncMake(); redraw();
    return h("div.cr-wrap", mat);
  },
  async make() {
    if (!CR.res || CR.finishing) return;
    CR.finishing = true; Bridge.busy = true;
    try { await CR.queue; await Bridge.invoke("creator_finish",{materialId:S.chosen,strength:.5,smooth:CR.smooth/12,outline:CR.border}); crReset(); await Bridge.reload(); await Shell.close(); }
    catch(e) { Shell.toast(String(e)); } finally { CR.finishing=false; Bridge.busy=false; }
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
