// Print → Grab → Paste (spec §26-29). A finished Peta is not stuck down for you: it is printed out of an
// abstract slot at the top of the screen, on its backing sheet, and waits there. You grab it, drag it anywhere
// and let go: "ペタッ". Nothing is stored here — Rust says what is waiting (`print_pending`) and does the sticking
// (`print_paste`), so quitting in the middle just brings the Peta back at the slot next launch.
//
// Art: the slot (`data-art="print-slot"` / `print-slot-glow`), the backing sheet (`data-art="backing-sheet"`)
// and the sound (`pata()`) are plain CSS / WebAudio placeholders until the art layer replaces them.

const MIN_DRAG = 24; // px: let go closer than this to where you grabbed it and it goes back on the sheet

/** A short, soft "ペタッ": a tap of filtered noise on top of a quick low thump. No audio file needed. */
export function pata() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (pata.ctx ??= new AC());
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(ctx.destination);

    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass"; band.frequency.value = 1800; band.Q.value = 0.7;
    src.connect(band).connect(out);
    src.start(t);

    const thump = ctx.createOscillator();
    const g = ctx.createGain();
    thump.frequency.setValueAtTime(170, t);
    thump.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    thump.connect(g).connect(out);
    thump.start(t);
    thump.stop(t + 0.12);
  } catch { /* no sound is fine */ }
}

export function initPrint(ctx) {
  const { layer, invoke, listen, info, addSticker, nodes, render, lift, settle, removeNode, layerSize, fromPixels, loadAsset } = ctx;
  if (!info.isPrimary) return; // the print slot is on the main display only

  const hint = document.getElementById("print-hint");
  let job = null; // { pending, stage, sheet, img, slot }

  const el = (cls, art) => {
    const e = document.createElement("div");
    e.className = cls;
    if (art) e.dataset.art = art;
    return e;
  };

  async function show(pending) {
    if (job?.pending.stickerId === pending.stickerId) return;
    hide(true);
    const asset = await loadAsset(pending.stickerId);
    const { w: lw } = layerSize();
    const stickerW = pending.relativeScale * lw;
    const stickerH = stickerW / pending.aspect;
    const sheetW = Math.round(Math.max(220, stickerW * 1.3, stickerH / 0.76 / 1.25));

    const stage = el("print-stage");
    const slot = el("print-slot", "print-slot");
    slot.append(el("print-slot-glow", "print-slot-glow"));
    const sheet = el("print-sheet backing", "backing-sheet");
    sheet.style.width = `${sheetW}px`;
    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.src = asset.url;
    img.style.width = `${Math.round(stickerW)}px`;
    sheet.append(img);
    stage.append(sheet);
    layer.append(stage, slot);
    hint.hidden = false;
    job = { pending, stage, sheet, img, slot, stickerW };

    // the slot opens, the sheet slides out of it
    slot.animate([{ transform: "translateX(-50%) scaleX(0.1)", opacity: 0 }, { transform: "translateX(-50%) scaleX(1)", opacity: 1 }],
      { duration: 220, easing: "ease-out", fill: "both" });
    sheet.animate(
      [{ transform: "translateY(-105%) rotate(-1.5deg)" }, { transform: "translateY(0) rotate(0.6deg)", offset: 0.82 }, { transform: "translateY(0) rotate(0deg)" }],
      { duration: 1000, delay: 180, easing: "cubic-bezier(.2,.7,.25,1)", fill: "backwards" });
    sheet.addEventListener("pointerdown", grab);
  }

  function hide(instant = false) {
    if (!job) return;
    const { stage, slot, sheet } = job;
    job = null;
    hint.hidden = true;
    if (instant) { stage.remove(); slot.remove(); return; }
    sheet.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-30px)", opacity: 0 }], { duration: 320, easing: "ease-in", fill: "forwards" })
      .finished.then(() => { stage.remove(); }).catch(() => stage.remove());
    slot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, delay: 120, fill: "forwards" }).finished.then(() => slot.remove()).catch(() => slot.remove());
  }

  // ---- grab -> drag -> paste ----

  let hold = null; // { node, dx, dy, ox, oy, moved }

  async function grab(e) {
    if (!job || hold || e.button !== 0) return;
    const r = job.img.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return; // the sticker, not the sheet
    e.preventDefault();
    e.stopPropagation();
    const { pending } = job;
    const { w, h } = layerSize();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    hold = { node: null, x0: e.clientX, y0: e.clientY, cx, cy, moved: false, pointer: e.pointerId };
    layer.setPointerCapture(e.pointerId);
    await addSticker({
      stickerId: pending.stickerId, displayId: "", relativeX: cx / w, relativeY: cy / h, relativeScale: pending.relativeScale,
      rotation: 0, isOnDesktop: true, z: 0, placedAt: "", materialId: pending.material_id ?? pending.materialId ?? null,
    });
    const node = nodes.get(pending.stickerId);
    if (!hold || !node) return;
    hold.node = node;
    node.live = true; // while it is in the hand, reconciling with the library must leave it alone
    lift(node);
    job.img.style.visibility = "hidden"; // it came off the sheet
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
    if (layer.hasPointerCapture?.(e.pointerId)) layer.releasePointerCapture(e.pointerId);
    layer.classList.remove("dragging");
    layer.dataset.cursor = "";
    if (!h.node) { job?.img && (job.img.style.visibility = ""); return; }
    const { node } = h;
    if (!h.moved) { // barely moved: it goes back onto the sheet
      removeNode(node);
      if (job) job.img.style.visibility = "";
      return;
    }
    const id = node.placement.stickerId;
    const { relativeX: x, relativeY: y } = node.placement;
    settle(node, { save: false }); // the little scale 1.03 -> 0.98 -> 1.00
    pata();
    try {
      await invoke("print_paste", { stickerId: id, x, y });
      const list = await invoke("layer_placements"); // Rust picks the final tilt; take it
      const saved = list.find((p) => p.stickerId === id);
      if (saved) { Object.assign(node.placement, saved); render(node); }
      node.live = false;
    } catch (err) {
      console.error("print_paste failed", err);
      removeNode(node);
      if (job) job.img.style.visibility = "";
    }
  }

  layer.addEventListener("pointermove", move);
  layer.addEventListener("pointerup", release);
  layer.addEventListener("pointercancel", release);

  // ---- Rust says what is waiting ----

  async function refresh() {
    const pending = await invoke("print_pending");
    if (pending) await show(pending);
    else hide();
  }

  const later = () => { invoke("print_later"); };
  document.getElementById("print-later").addEventListener("click", later);
  window.addEventListener("keydown", (e) => { if (job && e.key === "Escape") later(); });
  listen("print-changed", (e) => { if (e.payload) refresh(); else hide(); });
  refresh();
}
