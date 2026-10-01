import {
  toPixels, fromPixels, resizedWidth, distance, pointerAngle, rotatedAngle,
} from "./placement.js";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const layer = document.getElementById("layer");
const hint = document.getElementById("edit-hint");
const imageCache = new Map(); // stickerId -> Promise<HTMLImageElement> (for aspect ratio)
const nodes = new Map(); // stickerId -> { el, placement, aspect }
let editing = false;

const assetUrl = (stickerId) => `assets/${stickerId}.png`;

function loadImage(stickerId) {
  if (!imageCache.has(stickerId)) {
    imageCache.set(stickerId, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = assetUrl(stickerId);
    }));
  }
  return imageCache.get(stickerId);
}

function layerSize() {
  return { w: layer.clientWidth, h: layer.clientHeight };
}

/** Apply a placement (stored form) to its DOM node. Move/rotate only touch `transform`
 *  (compositor-only); width/height are written only when the size actually changed. */
function render(node) {
  const { w: lw, h: lh } = layerSize();
  const box = toPixels(node.placement, lw, lh, node.aspect);
  const s = node.el.style;
  if (node.lastW !== box.w) {
    s.width = `${box.w}px`;
    s.height = `${box.h}px`;
    node.lastW = box.w;
  }
  s.transform = `translate3d(${box.cx - box.w / 2}px, ${box.cy - box.h / 2}px, 0) rotate(${box.rotation}deg)`;
}

/** Coalesce pointermove bursts into at most one render per animation frame. */
function scheduleRender(node) {
  if (node.raf) return;
  node.raf = requestAnimationFrame(() => {
    node.raf = 0;
    render(node);
  });
}

async function addSticker(placement) {
  const img = await loadImage(placement.stickerId);
  const el = document.createElement("div");
  el.className = "sticker";
  el.innerHTML = `<img alt="" draggable="false" src="${assetUrl(placement.stickerId)}">
    <div class="frame"></div><div class="handle resize"></div><div class="handle rotate"></div>`;
  layer.appendChild(el);
  const node = { el, placement: { ...placement }, aspect: img.naturalWidth / img.naturalHeight };
  nodes.set(placement.stickerId, node);
  render(node);
  wireEditing(node);
}

// ---- Edit mode: move / resize / rotate (spec §9, spike steps 06-08) ----

function wireEditing(node) {
  const { el } = node;

  const begin = (e, onMove) => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    layer.appendChild(el); // bring to front (local only for now)
    el.classList.add("dragging");
    const move = (ev) => { onMove(ev); scheduleRender(node); };
    const end = async (ev) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.classList.remove("dragging");
      render(node); // flush the final position synchronously
      await persist(node);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const center = () => {
    const { w: lw, h: lh } = layerSize();
    const b = toPixels(node.placement, lw, lh, node.aspect);
    return { cx: b.cx, cy: b.cy, w: b.w };
  };
  const apply = (px) => {
    const { w: lw, h: lh } = layerSize();
    Object.assign(node.placement, fromPixels(px, lw, lh));
  };

  // move: grab anywhere on the sticker
  el.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("handle")) return;
    const start = center();
    const ox = e.clientX, oy = e.clientY;
    begin(e, (ev) => apply({ ...start, cx: start.cx + ev.clientX - ox, cy: start.cy + ev.clientY - oy }));
  });

  // resize: bottom-right handle, uniform around the center
  el.querySelector(".resize").addEventListener("pointerdown", (e) => {
    const start = center();
    const { w: lw } = layerSize();
    const d0 = distance(start.cx, start.cy, e.clientX, e.clientY);
    begin(e, (ev) => apply({ ...start, w: resizedWidth(start.w, d0, distance(start.cx, start.cy, ev.clientX, ev.clientY), lw) }));
  });

  // rotate: top handle, angular delta around the center
  el.querySelector(".rotate").addEventListener("pointerdown", (e) => {
    const start = center();
    const r0 = node.placement.rotation;
    const a0 = pointerAngle(start.cx, start.cy, e.clientX, e.clientY);
    begin(e, (ev) => {
      node.placement.rotation = rotatedAngle(r0, a0, pointerAngle(start.cx, start.cy, ev.clientX, ev.clientY));
    });
  });
}

async function persist(node) {
  node.placement.placedAt = node.placement.placedAt || new Date().toISOString();
  try {
    await invoke("save_placement", { placement: node.placement });
  } catch (err) {
    console.error("save_placement failed", err);
  }
}

function setEditMode(on) {
  editing = on;
  layer.classList.toggle("editing", on);
  hint.hidden = !on;
}

// ---- boot ----

async function boot() {
  const info = await invoke("layer_info");
  setEditMode(info.editMode);
  for (const p of await invoke("layer_placements")) await addSticker(p);

  await listen("edit-mode", (e) => setEditMode(Boolean(e.payload)));
  window.addEventListener("resize", () => nodes.forEach(render));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && editing) invoke("exit_edit_mode"); });
  document.getElementById("edit-done").addEventListener("click", () => invoke("exit_edit_mode"));
}

boot().catch((err) => console.error("peta layer boot failed", err));
