// Print → Grab → Paste (spec §26-29). A finished Peta is not stuck down for you: it is printed out of an
// abstract slot at the top of the screen, on its backing sheet, and waits there. You grab it, drag it anywhere
// and let go: "Peta!". Nothing is stored here — Rust says what is waiting (`print_pending`) and does the sticking
// (`print_paste`). Saved jobs wait quietly after launch until an explicit Resume / Stick action.
//
// Art: the slot (`data-art="print-slot"` / `print-slot-glow`), the backing sheet (`data-art="backing-sheet"`)
// and the sound (`pata()`) are the original paper artwork / synthesized WebAudio. Peta! uses the four
// delivered en / round / holo / stamp images, picked in layer-port.js after a successful print_paste.

import { REFLECTIVE_MATERIALS } from "./reflection.js";

const MIN_DRAG = 3; // px: let go closer than this to where you grabbed it and it goes back on the sheet

export function pata() { Snd.peta(); Haptic.tap("paste"); }

export async function initPrint(ctx) {
  const { layer, invoke, listen, info, addSticker, nodes, render, lift, settle, removeNode, layerSize, fromPixels, loadAsset } = ctx;
  if (!info.isPrimary) return; // the print slot is on the main display only

  const hint = document.getElementById("print-hint");
  let showRequest = 0, refreshRequest = 0;
  let completing = false, printVisible = false;
  let job = null; // { pending, stage, sheet, img, slot }

  const el = (cls, art) => {
    const e = document.createElement("div");
    e.className = cls;
    if (art) e.dataset.art = art;
    return e;
  };

  async function show(pending) {
    if (job?.pending.stickerId === pending.stickerId) return;
    await hide(true);
    const request = ++showRequest;
    const asset = await loadAsset(pending.stickerId);
    if (request !== showRequest) return;
    const { w: lw } = layerSize();
    const sheetW=Math.min(250,innerHeight*.34), maxD=sheetW*.74;
    const stickerW=pending.aspect>=1?maxD:maxD*pending.aspect;
    const scale=stickerW/lw;
    const stage=el("print-stage"), slot=el("print-slot","print-slot");
    slot.append(el("slot-glow"),el("slot-bar"));
    const sheet=el("print-sheet","backing-sheet"); sheet.style.width=sheetW+"px";
    const holder=el("sheet-stk"), material=pending.materialId||"matte";
    const sticker=Stk.el({url:asset.url,w:asset.img.naturalWidth,h:asset.img.naturalHeight,material,mask:REFLECTIVE_MATERIALS.has(material)?asset.url:null},stickerW),img=sticker.querySelector('img');
    holder.append(sticker); sheet.append(holder);
    stage.append(sheet); layer.append(stage,slot);
    hint.hidden=true;
    const thisJob=job={pending,stage,sheet,img,slot,stickerW,scale,sticker};
    Snd.feed(16,2.2);
    anim(slot.querySelector(".slot-glow"),[{opacity:0},{opacity:1,offset:.15},{opacity:1,offset:.85},{opacity:0}],{duration:2400,easing:"linear"});
    await anim(sheet,[{transform:"translateY(-102%)"},{transform:"translateY(0)"}],{duration:2400,easing:"steps(22, jump-end)"});
    if(job!==thisJob) return;
    await anim(sheet,[{transform:"translateY(0)"},{transform:"translateY(5px)"},{transform:"translateY(0)"}],{duration:260,easing:EASE.out});
    if(job!==thisJob) return;
    hint.getAnimations().forEach(a=>a.cancel());
    hint.hidden=false; anim(hint,[{opacity:0,transform:"translate(-50%, 10px)"},{opacity:1,transform:"translate(-50%, 0)"}],{duration:400});
    sheet.classList.add("ready");
    sheet.addEventListener("pointerdown", grab);
  }

  async function hide(instant = false, fade = true) {
    showRequest++;
    if (!job) return;
    const { stage, slot, sheet } = job;
    job = null;
    sheet.classList.remove("ready");
    if (instant) { hint.hidden=true; stage.remove(); slot.remove(); return; }
    if (fade) fadeHint();
    Snd.feed(8,.8);
    await anim(sheet,[{transform:"translateY(0)"},{transform:"translateY(-104%)"}],{duration:900,easing:"steps(12, jump-end)"});
    stage.remove(); slot.remove();
    if (!job) hint.hidden=true;
  }

  function fadeHint() {
    hint.getAnimations().forEach(a=>a.cancel());
    anim(hint,[{opacity:1},{opacity:0}],{duration:200});
  }

  // ---- grab -> drag -> paste ----

  let hold = null; // { node, dx, dy, ox, oy, moved }

  async function grab(e) {
    if (!job || !job.sheet.classList.contains("ready") || hold || completing || e.button !== 0) return;
    const r = job.img.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return; // the sticker, not the sheet
    e.preventDefault();
    e.stopPropagation();
    const { pending } = job;
    const { w, h } = layerSize();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const previous = nodes.get(pending.stickerId)?.placement;
    if (previous) removeNode(nodes.get(pending.stickerId));
    const grabbed = job;
    hold = { job: grabbed, previous: previous && {...previous}, node: null, x0: e.clientX, y0: e.clientY, cx, cy, moved: false, pointer: e.pointerId };
    layer.setPointerCapture(e.pointerId);
    await addSticker({
      stickerId: pending.stickerId, displayId: "", relativeX: cx / w, relativeY: cy / h, relativeScale: job.scale,
      rotation: 0, isOnDesktop: true, z: 0, placedAt: "", materialId: pending.material_id ?? pending.materialId ?? null,
    });
    const node = nodes.get(pending.stickerId);
    if (!hold || !node) return;
    hold.node = node;
    node.live = true; // while it is in the hand, reconciling with the library must leave it alone
    lift(node);
    node.el.classList.add("print-grab");
    anim(node.body,[{transform:"scale(1)"},{transform:"scale(1.08)"}],{duration:160,easing:EASE.out});
    grabbed.img.style.visibility = "hidden"; grabbed.sheet.classList.add("grabbing"); Snd.tap(); // it came off the sheet
    layer.classList.add("dragging");
    layer.dataset.cursor = "move";
  }

  function move(e) {
    if (!hold || !hold.node) return;
    const { w, h } = layerSize();
    const x = hold.cx + e.clientX - hold.x0, y = hold.cy + e.clientY - hold.y0;
    if (Math.hypot(e.clientX - hold.x0, e.clientY - hold.y0) >= MIN_DRAG) hold.moved = true;
    Object.assign(hold.node.placement, fromPixels({ cx: x, cy: y, w: hold.node.placement.relativeScale * w }, w, h));
    render(hold.node);
  }

  async function release(e) {
    if (!hold) return;
    const h = hold;
    hold = null;
    completing = true; refreshRequest++;
    if (layer.hasPointerCapture?.(e.pointerId)) layer.releasePointerCapture(e.pointerId);
    layer.classList.remove("dragging");
    layer.dataset.cursor = "";
    h.job.sheet.classList.remove("grabbing");
    if (!h.node) { h.job.img.style.visibility=""; completing=false; return; }
    const { node } = h;
    const sr=h.job.sheet.getBoundingClientRect(), over=e.clientX>sr.left && e.clientX<sr.right && e.clientY>sr.top && e.clientY<sr.bottom;
    node.body.getAnimations().forEach(a=>a.cancel());
    if (!h.moved || over || e.type==="pointercancel") {
      const from=node.el.style.transform, holder=h.job.sticker.parentElement.getBoundingClientRect();
      const {w,h:lh}=layerSize();
      Object.assign(node.placement,fromPixels({cx:holder.x+holder.width/2,cy:holder.y+holder.height/2,w:node.placement.relativeScale*w},w,lh));
      render(node);
      await Promise.all([
        anim(node.el,[{transform:from},{transform:node.el.style.transform}],{duration:260,easing:EASE.out}),
        anim(node.body,[{transform:"scale(1.08)"},{transform:"scale(1)"}],{duration:260,easing:EASE.out}),
      ]);
      removeNode(node);
      if(h.previous) await addSticker(h.previous);
      h.job.img.style.visibility="";
      completing=false;
      if (!printVisible) hide();
      return;
    }
    h.job.sheet.classList.remove("ready");
    node.el.classList.remove("print-grab");
    const id = node.placement.stickerId;
    const { relativeX: x, relativeY: y } = node.placement;
    settle(node, { save: false }); // prototype settle animation
    try {
      await invoke("print_paste", { stickerId: id, x, y, relativeScale:node.placement.relativeScale });
      pata();
      const {w:tagW,h:tagH}=layerSize(); petaTag(x*tagW,y*tagH);
      const list = await invoke("layer_placements"); // Rust picks the final tilt; take it
      const saved = list.find((p) => p.stickerId === id);
      if (saved) { Object.assign(node.placement, saved); render(node); }
      node.live = false;
      fadeHint();
      await sleep(450);
      await hide(false,false);
      completing=false;
      if (printVisible) await refresh();
    } catch (err) {
      console.error("print_paste failed", err);
      removeNode(node);
      if(h.previous) await addSticker(h.previous);
      h.job.img.style.visibility = "";
      h.job.sheet.classList.add("ready");
      completing=false;
      if (!printVisible) hide();
    }
  }

  layer.addEventListener("pointermove", move);
  layer.addEventListener("pointerup", release);
  layer.addEventListener("pointercancel", release);

  // ---- Rust says what is waiting ----

  async function refresh() {
    const request=++refreshRequest;
    if (completing || hold) return;
    const pending = await invoke("print_pending");
    if(request!==refreshRequest || completing || hold || !printVisible) return;
    if (pending) await show(pending);
    else hide();
  }

  const later = () => { if (!completing && !hold) invoke("print_later"); };
  document.getElementById("print-later").addEventListener("click", later);
  window.addEventListener("keydown", (e) => { if (job && e.key === "Escape") later(); });
  await listen("print-changed", (e) => {
    printVisible=Boolean(e.payload); refreshRequest++;
    if (completing || hold) return;
    if (printVisible) refresh(); else hide();
  });
  listen("sticker-updated", async e => {
    if(job?.pending.stickerId !== e.payload) return;
    if(hold) { if(hold.node) removeNode(hold.node); if(layer.hasPointerCapture(hold.pointer)) layer.releasePointerCapture(hold.pointer); hold=null; layer.classList.remove("dragging"); layer.dataset.cursor=""; }
    await hide(true); if(printVisible) await refresh();
  });
  // Recover an already active session after display reconstruction, never infer activity from the queue.
  await invoke("layer_info");
}
