import { renderBackCard, renderBackFallback } from "./back-card.js";
import { initPrint } from "./print.js";
import {
  toPixels, fromPixels, toLocalUV, isPivotGrab, pivotResult, pointerAngle, distance, normalizeAngle,
  peelPose, PEEL_COMMIT, PEEL_DISTANCE,
} from "./placement.js";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const layer = document.getElementById("layer");
const hint = document.getElementById("edit-hint");
const meterEl = document.getElementById("edit-meter");

const assets = new Map(); // stickerId -> Promise<{ img, mask }>
const nodes = new Map(); // stickerId -> node
const stack = []; // nodes, bottom -> top (also the pick order, reversed)
let editing = false;
let drag = null; // active pointer drag
let gest = null; // active trackpad pinch/twist
let lastPointer = { x: 0, y: 0 };
let lastAlt = false;

const pending = new Set(); // stickerIds being added (asset still loading)

// ---- assets + alpha mask (so clicks on transparent pixels fall through to nothing) ----

const MASK_MAX = 128;
const ALPHA_HIT = 24;

/** The rendered PNG comes from the Rust library as raw bytes -> blob URL (same-origin, so the
 *  alpha mask below can be read without tainting the canvas). */
function loadAsset(stickerId) {
  if (!assets.has(stickerId)) {
    const promise = invoke("sticker_asset", { stickerId }).then((bytes) => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, MASK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const rgba = ctx.getImageData(0, 0, w, h).data;
        const alpha = new Uint8Array(w * h);
        for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
        resolve({ img, url, mask: { w, h, alpha } });
      };
      img.onerror = reject;
      img.src = url;
    }));
    promise.catch(() => assets.delete(stickerId)); // allow a retry
    assets.set(stickerId, promise);
  }
  return assets.get(stickerId);
}

function opaqueAt(mask, u, v) {
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  return mask.alpha[Math.floor(v * mask.h) * mask.w + Math.floor(u * mask.w)] > ALPHA_HIT;
}

// ---- geometry / rendering ----

const layerSize = () => ({ w: layer.clientWidth, h: layer.clientHeight });

function boxOf(node) {
  const { w, h } = layerSize();
  return toPixels(node.placement, w, h, node.aspect);
}

/**
 * Position/rotate/scale via `transform` only. The element's CSS size (baseW) is the size it was
 * last rasterized at; during a gesture the size change is a compositor-side scale() of that
 * texture, and the size is committed (re-rasterized once) when the gesture ends.
 */
function render(node) {
  const box = boxOf(node);
  if (node.baseW === undefined || (!node.live && node.baseW !== box.w)) {
    node.baseW = box.w;
    node.baseH = box.h;
    node.el.style.width = `${box.w}px`;
    node.el.style.height = `${box.h}px`;
  }
  const k = box.w / node.baseW;
  node.el.style.transform =
    `translate3d(${box.cx - node.baseW / 2}px, ${box.cy - node.baseH / 2}px, 0) rotate(${box.rotation}deg) scale(${k})`;
  if (node.el.dataset.material === "holographic") setSheen(node, box);
}

/** Holographic: the reflection band depends on where the sticker sits and how it is turned, like a fixed
 *  light on a real foil. Static at rest (no animation = no idle cost); it slides as you move or turn it. */
function setSheen(node, box) {
  const { w, h } = layerSize();
  const s = node.el.style;
  s.setProperty("--sx", `${(box.cx / w) * 100}%`);
  s.setProperty("--sy", `${(box.cy / h) * 100}%`);
  s.setProperty("--sa", `${115 - box.rotation}deg`);
}

function scheduleRender(node) {
  if (node.raf) return;
  node.raf = requestAnimationFrame(() => { node.raf = 0; render(node); });
}

async function addSticker(placement) {
  const id = placement.stickerId;
  if (nodes.has(id) || pending.has(id)) return;
  pending.add(id);
  let asset;
  try {
    asset = await loadAsset(id);
  } catch (err) {
    console.error("could not load sticker", id, err);
    return;
  } finally {
    pending.delete(id);
  }
  const { img, mask, url } = asset;
  const el = document.createElement("div");
  el.className = "sticker";
  if (placement.materialId) el.dataset.material = placement.materialId;
  el.style.setProperty("--mask", `url(${url})`);
  el.innerHTML = `<div class="body"><img alt="" draggable="false" src="${url}"></div>`;
  layer.appendChild(el);
  const node = {
    el, body: el.firstElementChild, placement: { ...placement }, mask,
    aspect: img.naturalWidth / img.naturalHeight, live: false,
  };
  nodes.set(placement.stickerId, node);
  stack.push(node);
  render(node);
}

// ---- picking (top-most sticker with an opaque pixel under the pointer) ----

function hits(node, x, y) {
  const box = boxOf(node);
  if (node.flipped) {
    // turned over: it is the back card (a rectangle) you are touching
    const cw = cardWidth(node);
    const { u, v } = toLocalUV(x, y, { ...box, w: cw, h: cw * CARD_RATIO });
    return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  }
  const { u, v } = toLocalUV(x, y, box);
  return opaqueAt(node.mask, u, v);
}

function pick(x, y) {
  for (let i = stack.length - 1; i >= 0; i--) if (hits(stack[i], x, y)) return stack[i];
  return null;
}

// ---- turn over: the back of the sticker (spec §9 "Turn Over", §30) ----
// Double-click (or F) flips it like a real one: the sticker turns edge-on, the back card swings in.
// The card is drawn from what Rust says is printed on the back; nothing here is stored.

const CARD_RATIO = 1.25; // height / width of the back card
const cardWidth = () => 170;
const backs = new Map(); // stickerId -> Promise<StickerBack | null>
const fetchBack = (id) => {
  if (!backs.has(id)) backs.set(id, invoke("sticker_back", { stickerId: id }).catch(() => null));
  return backs.get(id);
};
const turn = (from, to) => [
  { transform: `perspective(900px) rotateY(${from}deg)` },
  { transform: `perspective(900px) rotateY(${to}deg)` },
];
const HALF_FLIP_MS = 170;

async function flip(node, to = !node.flipped) {
  if (node.flipping || Boolean(node.flipped) === to) return;
  node.flipping = true;
  try {
    if (to) {
      const back = await fetchBack(node.placement.stickerId);
      const card = node.cardEl ?? (node.cardEl = document.createElement("div"));
      card.className = "card";
      card.style.width = `${cardWidth(node)}px`;
      card.replaceChildren(back ? renderBackCard(back) : renderBackFallback());
      if (!card.isConnected) node.el.append(card);
      await node.body.animate(turn(0, 90), { duration: HALF_FLIP_MS, easing: "ease-in" }).finished;
      node.el.classList.add("flipped");
      node.flipped = true;
      await card.animate(
        [{ transform: "translate(-50%, -50%) perspective(900px) rotateY(-90deg)" },
         { transform: "translate(-50%, -50%) perspective(900px) rotateY(0deg)" }],
        { duration: HALF_FLIP_MS + 50, easing: "ease-out" },
      ).finished;
    } else {
      await node.cardEl.animate(
        [{ transform: "translate(-50%, -50%) perspective(900px) rotateY(0deg)" },
         { transform: "translate(-50%, -50%) perspective(900px) rotateY(90deg)" }],
        { duration: HALF_FLIP_MS, easing: "ease-in" },
      ).finished;
      node.el.classList.remove("flipped");
      node.flipped = false;
      await node.body.animate(turn(-90, 0), { duration: HALF_FLIP_MS + 50, easing: "ease-out" }).finished;
    }
  } catch {
    /* an animation was cancelled (edit mode ended mid-flip): the state below is already consistent */
  } finally {
    node.flipping = false;
  }
}

/** Instantly back to face-up (leaving edit mode, peeling). */
function unflipNow(node) {
  node.el.classList.remove("flipped");
  node.flipped = false;
  node.flipping = false;
  node.body.getAnimations().forEach((a) => a.cancel());
  node.cardEl?.getAnimations().forEach((a) => a.cancel());
}

function bringToFront(node) {
  stack.splice(stack.indexOf(node), 1);
  stack.push(node);
  layer.appendChild(node.el);
}

// ---- physical feel: lift when picked up, settle ("Peta!") when let go (spec §29) ----

function lift(node) {
  node.live = true;
  node.el.classList.add("lifted");
}

function settle(node, { save = true } = {}) {
  node.live = false;
  node.el.classList.remove("lifted");
  render(node); // commit the final size (single re-raster)
  node.body.animate(
    [{ transform: "scale(1.14)" }, { transform: "scale(.96)", offset: .45 }, { transform: "scale(1.02)", offset: .75 }, { transform: "scale(1)" }],
    { duration: 340, easing: "ease-out" },
  );
  if (save) persist(node);
}

// ---- peel: Option + drag away. The grabbed side lifts around the far edge (a hinge). Pull far
// enough and let go and it comes off; let go early and it presses back down. ----

const PERSPECTIVE = 900;

function peelTransform(pose, angle = pose.angle) {
  return `perspective(${PERSPECTIVE}px) rotate3d(${pose.ax}, ${pose.ay}, 0, ${-angle}deg)`;
}

function showPeel(node, pose) {
  node.body.style.transformOrigin = `${pose.ox}px ${pose.oy}px`;
  node.body.style.transform = peelTransform(pose);
  node.el.classList.toggle("peel-ready", pose.progress >= PEEL_COMMIT);
}

function clearPeel(node) {
  node.body.style.transform = "";
  node.body.style.transformOrigin = "";
  node.el.classList.remove("peeling", "peel-ready");
}

function removeNode(node) {
  nodes.delete(node.placement.stickerId);
  const i = stack.indexOf(node);
  if (i >= 0) stack.splice(i, 1);
  node.el.remove();
}

/** The sticker comes away: keeps turning up and off along the pull, fades, then it's gone for good. */
function peelOff(node, pose, from) {
  node.peeled = true;
  const away = `${peelTransform(pose, 115)} translate3d(${pose.dlx * 160}px, ${pose.dly * 160}px, 90px)`;
  const anim = node.body.animate(
    [{ transform: from, opacity: 1 }, { transform: away, opacity: 0 }],
    { duration: 300, easing: "cubic-bezier(.5, 0, .9, .6)", fill: "forwards" },
  );
  anim.onfinish = async () => {
    removeNode(node);
    try {
      await invoke("peel_sticker", { stickerId: node.placement.stickerId });
    } catch (err) {
      console.error("peel_sticker failed", err);
    }
  };
}

/** Not pulled far enough: it sticks back down. */
function pressBack(node, from) {
  node.body.animate(
    [{ transform: from }, { transform: "none" }],
    { duration: 220, easing: "cubic-bezier(.3, 1.5, .5, 1)" },
  ).onfinish = () => {
    clearPeel(node);
    settle(node, { save: false });
  };
}

async function persist(node) {
  node.placement.placedAt = node.placement.placedAt || new Date().toISOString();
  try {
    await invoke("save_placement", { placement: node.placement });
  } catch (err) {
    console.error("save_placement failed", err);
  }
}

// ---- frame-time meter (shown in the edit bar after each drag) ----

const meter = { id: 0, frames: [] };

function startMeter() {
  meter.frames = [];
  let prev = performance.now();
  const tick = (t) => { meter.frames.push(t - prev); prev = t; meter.id = requestAnimationFrame(tick); };
  meter.id = requestAnimationFrame(tick);
}

function stopMeter() {
  cancelAnimationFrame(meter.id);
  const f = meter.frames.slice(1);
  if (f.length < 5) return;
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  const worst = Math.max(...f);
  meterEl.textContent = `${(1000 / avg).toFixed(0)} fps · worst ${worst.toFixed(0)} ms`;
  console.log(`[peta] drag: ${f.length} frames, avg ${avg.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
}

// ---- pointer: drag the body to move; pull the rim to scale + rotate at once ----

layer.addEventListener("pointerdown", (e) => {
  if (!editing || e.button !== 0) return;
  const node = pick(e.clientX, e.clientY);
  if (!node) return;
  e.preventDefault();
  layer.setPointerCapture(e.pointerId);
  bringToFront(node);

  const box = boxOf(node);
  // a sticker that is turned over can only be moved (and turned back)
  const mode = node.flipped ? "move" : e.altKey ? "peel" : isPivotGrab(e.clientX, e.clientY, box) ? "pivot" : "move";
  drag = {
    node, mode, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY,
    start: {
      cx: box.cx, cy: box.cy, w: box.w, rotation: box.rotation,
      r0: distance(box.cx, box.cy, e.clientX, e.clientY),
      a0: pointerAngle(box.cx, box.cy, e.clientX, e.clientY),
    },
  };
  if (mode === "peel") {
    node.live = true;
    node.el.classList.add("peeling");
  } else {
    lift(node);
  }
  layer.classList.add("dragging");
  layer.dataset.cursor = mode === "pivot" ? "pivot" : "move";
  startMeter();
});

layer.addEventListener("pointermove", (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  lastAlt = e.altKey;
  if (drag) {
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.raf) drag.raf = requestAnimationFrame(applyDrag);
  } else if (editing && !hover.raf) {
    hover.raf = requestAnimationFrame(updateHoverCursor);
  }
});

function applyDrag() {
  if (!drag) return;
  drag.raf = 0;
  const { node, start } = drag;
  const { w: lw, h: lh } = layerSize();
  if (drag.mode === "peel") {
    drag.pose = peelPose(drag.x - drag.ox, drag.y - drag.oy, start.rotation, start.w, start.w / node.aspect);
    showPeel(node, drag.pose);
    return;
  }
  if (drag.mode === "pivot") {
    const r = pivotResult(start, drag.x, drag.y, lw);
    node.placement.rotation = r.rotation;
    Object.assign(node.placement, fromPixels({ cx: start.cx, cy: start.cy, w: r.w }, lw, lh));
  } else {
    Object.assign(node.placement, fromPixels(
      { cx: start.cx + drag.x - drag.ox, cy: start.cy + drag.y - drag.oy, w: start.w }, lw, lh));
  }
  render(node);
}

function endDrag(e) {
  if (!drag) return;
  if (drag.raf) cancelAnimationFrame(drag.raf);
  drag.raf = 0;
  const node = drag.node;
  drag.x = e.clientX ?? drag.x;
  drag.y = e.clientY ?? drag.y;
  applyDrag();
  const { mode, pose } = drag;
  drag = null;
  if (layer.hasPointerCapture?.(e.pointerId)) layer.releasePointerCapture(e.pointerId);
  layer.classList.remove("dragging");
  stopMeter();
  if (mode === "peel") {
    const from = node.body.style.transform || "none";
    if (pose && pose.progress >= PEEL_COMMIT) peelOff(node, pose, from);
    else pressBack(node, from);
  } else {
    settle(node);
  }
  updateHoverCursor();
}
layer.addEventListener("pointerup", endDrag);
layer.addEventListener("pointercancel", endDrag);

// hover feedback: the cursor tells you whether a grab here moves or pinches the rim
const hover = { raf: 0 };
function updateHoverCursor() {
  hover.raf = 0;
  if (drag || !editing) return;
  const node = pick(lastPointer.x, lastPointer.y);
  layer.dataset.cursor = !node ? ""
    : node.flipped ? "move"
    : lastAlt ? "peel"
    : isPivotGrab(lastPointer.x, lastPointer.y, boxOf(node)) ? "pivot" : "move";
}

// ---- trackpad: pinch to scale, twist to rotate (WebKit gesture events), both at once ----

layer.addEventListener("gesturestart", (e) => {
  if (!editing) return;
  e.preventDefault();
  const x = e.clientX ?? lastPointer.x, y = e.clientY ?? lastPointer.y;
  const node = pick(x, y);
  if (!node) { gest = null; return; }
  bringToFront(node);
  gest = { node, w: boxOf(node).w, rotation: node.placement.rotation };
  lift(node);
  startMeter();
});

layer.addEventListener("gesturechange", (e) => {
  if (!editing || !gest) return;
  e.preventDefault();
  const { node } = gest;
  const { w: lw, h: lh } = layerSize();
  const box = boxOf(node);
  node.placement.rotation = normalizeAngle(gest.rotation + e.rotation);
  Object.assign(node.placement, fromPixels({ cx: box.cx, cy: box.cy, w: gest.w * e.scale }, lw, lh));
  scheduleRender(node);
});

layer.addEventListener("gestureend", (e) => {
  if (!gest) return;
  e.preventDefault();
  const { node } = gest;
  gest = null;
  if (node.raf) { cancelAnimationFrame(node.raf); node.raf = 0; }
  stopMeter();
  settle(node);
});

// Delete / Backspace: peel the sticker under the pointer off, upward.
function peelUnderPointer() {
  if (drag || gest) return;
  const node = pick(lastPointer.x, lastPointer.y);
  if (!node || node.peeled) return;
  if (node.flipped) unflipNow(node);
  const box = boxOf(node);
  const pose = peelPose(0, -PEEL_DISTANCE * Math.max(box.w, box.h), box.rotation, box.w, box.h);
  node.live = true;
  node.el.classList.add("peeling");
  node.body.style.transformOrigin = `${pose.ox}px ${pose.oy}px`;
  peelOff(node, pose, "none");
}

// ---- edit mode + boot ----

function setEditMode(on) {
  editing = on;
  layer.classList.toggle("editing", on);
  hint.hidden = !on;
  if (!on) {
    layer.dataset.cursor = "";
    drag = null;
    gest = null;
    stack.forEach((n) => { if (n.flipped || n.flipping) unflipNow(n); }); // stuck face-up again
  }
}

/** Make the DOM match what the library says is on this display's desktop. */
async function reconcile() {
  const list = await invoke("layer_placements");
  const wanted = new Set(list.map((p) => p.stickerId));
  for (const node of [...stack]) {
    if (!wanted.has(node.placement.stickerId) && !node.live && !node.peeled) removeNode(node);
  }
  for (const p of list) await addSticker(p);
}

let flashTimer = 0;
/** Short message in the edit bar (reuses the meter slot). */
function flashHint(text) {
  meterEl.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { meterEl.textContent = ""; }, 3500);
}

/** Drop an image file onto the desktop (edit mode): it becomes today's Peta, where it lands. */
async function wireFileDrop() {
  const webview = window.__TAURI__.webview?.getCurrentWebview?.();
  if (!webview?.onDragDropEvent) return;
  await webview.onDragDropEvent(async (event) => {
    const p = event.payload;
    layer.classList.toggle("drop-target", editing && (p.type === "enter" || p.type === "over"));
    if (p.type !== "drop" || !editing) return;
    // payload position is in physical pixels of the webview
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = layerSize();
    try {
      await invoke("import_dropped", { paths: p.paths, x: p.position.x / dpr / w, y: p.position.y / dpr / h });
    } catch (err) {
      // one new Peta a day: a second drop is refused, politely (spec §14)
      if (String(err) === "already_used_today") flashHint("See you tomorrow.");
      else console.error("import_dropped failed", err);
    }
  });
}

async function boot() {
  const info = await invoke("layer_info");
  setEditMode(info.editMode);
  await reconcile();

  layer.addEventListener("dblclick", (e) => {
    if (!editing) return;
    const node = pick(e.clientX, e.clientY);
    if (node) flip(node);
  });
  await listen("placements-changed", () => reconcile());
  await wireFileDrop();
  initPrint({ layer, invoke, listen, info, addSticker, nodes, render, lift, settle, removeNode, layerSize, fromPixels, loadAsset });
  await listen("edit-mode", (e) => setEditMode(Boolean(e.payload)));
  window.addEventListener("resize", () => nodes.forEach(render));
  window.addEventListener("keydown", (e) => {
    if (!editing) return;
    if (e.key === "Escape") invoke("exit_edit_mode");
    if (e.key === "Delete" || e.key === "Backspace") peelUnderPointer();
    if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !drag) {
      const node = pick(lastPointer.x, lastPointer.y);
      if (node) flip(node);
    }
    if (e.key === "Alt") { lastAlt = true; updateHoverCursor(); }
  });
  window.addEventListener("keyup", (e) => { if (e.key === "Alt") { lastAlt = false; updateHoverCursor(); } });
  document.getElementById("edit-done").addEventListener("click", () => invoke("exit_edit_mode"));
}

boot().catch((err) => console.error("peta layer boot failed", err));
