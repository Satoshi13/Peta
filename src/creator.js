// Cutting Mat logic (spec §25). Rendering happens in Rust (peta-core); this file wires the controls to it.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const els = {
  original: $("img-original"), dim: $("img-dim"), cutout: $("img-cutout"), sticker: $("img-sticker"),
  frame: $("cutout-frame"), ring: $("brush-ring"), wrap: $("sticker-wrap"), stickerFrame: $("sticker-frame"),
  materials: $("materials"), strength: $("strength"), smooth: $("smooth"), brush: $("brush-size"), trail: $("paint-trail"), zoom: $("zoom"), undo: $("undo"), redo: $("redo"),
  make: $("make"), cancel: $("cancel"), note: $("note"), error: $("error"), hint: $("hint"),
  loading: $("loading"), failed: $("failed"), failedReason: $("failed-reason"), caption: $("sticker-caption"),
};

let info = null;
let material = null;
let tool = "erase"; // "erase" | "restore"
let seq = 0; // render sequence: late answers are dropped
let sessionKey = 0;
let loadedKey = -1;
let aspect = 1; // image aspect (width / height)
let busy = false;
let timer = 0;
const urls = { original: null, cutout: null, sticker: null };

const swapUrl = (key, img, blob) => {
  if (urls[key]) URL.revokeObjectURL(urls[key]);
  urls[key] = URL.createObjectURL(blob);
  img.src = urls[key];
};

function setError(text) {
  els.error.textContent = text || "";
  els.error.hidden = !text;
}
const friendly = (e) => (String(e) === "already_used_today" ? "Today's Peta is already stuck. See you tomorrow." : String(e));

function unpack(buf) {
  const dv = new DataView(buf);
  const hl = dv.getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  let o = 4 + hl;
  const sticker = buf.slice(o, o + header.stickerLen);
  o += header.stickerLen;
  const cutout = buf.slice(o, o + header.cutoutLen);
  return { header, sticker, cutout };
}

// ---- rendering ----

function scheduleRender(delay = 90) {
  clearTimeout(timer);
  timer = setTimeout(() => render(true), delay);
}

async function render(preview) {
  const mine = ++seq;
  try {
    const buf = await invoke("creator_render", { materialId: material, strength: Number(els.strength.value), smooth: Number(els.smooth.value), preview });
    if (mine !== seq) return;
    const { header, sticker, cutout } = unpack(buf);
    swapUrl("cutout", els.cutout, new Blob([cutout], { type: "image/png" }));
    swapUrl("sticker", els.sticker, new Blob([sticker], { type: "image/png" }));
    els.wrap.style.setProperty("--mask", `url(${urls.sticker})`);
    els.wrap.dataset.material = material;
    setError(header.coverage < 0.02 ? "Couldn't find a clear subject. Try “Loose”, or paint it back with Restore." : "");
  } catch (e) {
    if (mine === seq) setError(friendly(e));
  }
}

function renderMaterials() {
  els.materials.replaceChildren(...info.materials.map((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(m.id === material));
    b.textContent = m.unlimited ? m.name : `${m.name} ×${m.count}`;
    b.addEventListener("click", () => { material = m.id; renderMaterials(); els.caption.textContent = m.name; scheduleRender(0); });
    return b;
  }));
  els.caption.textContent = info.materials.find((m) => m.id === material)?.name ?? "Material";
}

// ---- session lifecycle ----

async function refresh() {
  info = await invoke("creator_info");
  els.loading.hidden = info.phase !== "loading";
  els.failed.hidden = info.phase !== "failed";
  if (info.phase === "failed") els.failedReason.textContent = info.error;
  els.make.disabled = info.phase !== "ready" || busy;
  if (info.phase === "loading") { sessionKey++; return; }
  if (info.phase !== "ready" || loadedKey === sessionKey) return;

  loadedKey = sessionKey;
  aspect = info.width / info.height;
  const bytes = await invoke("creator_original");
  const blob = new Blob([bytes], { type: "image/jpeg" });
  swapUrl("original", els.original, blob);
  els.dim.src = urls.original;
  material = info.defaultMaterial;
  resetView();
  setHistory({ canUndo: false, canRedo: false });
  els.strength.value = String(info.defaultStrength);
  els.smooth.value = String(info.defaultSmooth);
  els.hint.textContent = info.hadAlpha ? "This image already has a transparent background." : "";
  els.note.textContent = info.countsForToday
    ? "Nothing is used up until you make it. Cancel any time."
    : "Developer: this one does not count as today's Peta.";
  renderMaterials();
  await render(true);
}

// ---- zoom: scroll to zoom around the pointer, hold Space (or the middle button) and drag to move ----

const view = { s: 1, x: 0, y: 0 };
const ZOOM_MAX = 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const frameBox = () => ({ w: els.frame.clientWidth, h: els.frame.clientHeight });

function applyView() {
  const { w, h } = frameBox();
  view.x = clamp(view.x, w * (1 - view.s), 0); // the image always covers the pane
  view.y = clamp(view.y, h * (1 - view.s), 0);
  els.zoom.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  $("zoom-pct").textContent = `${Math.round(view.s * 100)}%`;
}

function zoomAt(cx, cy, factor) {
  const s = clamp(view.s * factor, 1, ZOOM_MAX);
  const k = s / view.s;
  view.x = cx - (cx - view.x) * k;
  view.y = cy - (cy - view.y) * k;
  view.s = s;
  applyView();
}

const resetView = () => { view.s = 1; view.x = 0; view.y = 0; applyView(); };
const frameCenter = () => { const { w, h } = frameBox(); return [w / 2, h / 2]; };

els.frame.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = els.frame.getBoundingClientRect();
  const lx = e.clientX - r.left - els.frame.clientLeft, ly = e.clientY - r.top - els.frame.clientTop;
  const unit = e.deltaMode === 1 ? 16 : 1; // lines -> pixels
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) { // sideways scroll moves the picture
    view.x -= e.deltaX * unit;
    applyView();
    return;
  }
  zoomAt(lx, ly, Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.012 : 0.0028))); // a pinch (ctrl + wheel) is stronger
}, { passive: false });
$("zoom-in").addEventListener("click", () => zoomAt(...frameCenter(), 1.5));
$("zoom-out").addEventListener("click", () => zoomAt(...frameCenter(), 1 / 1.5));
$("zoom-fit").addEventListener("click", resetView);
window.addEventListener("resize", applyView);

// ---- brush (paints on the cutout pane) ----

/** Where the image sits inside the pane before zooming (object-fit: contain). */
function imageRect() {
  const { w, h } = frameBox();
  const k = Math.min(w / aspect, h);
  const iw = k * aspect;
  return { left: (w - iw) / 2, top: (h - k) / 2, w: iw, h: k };
}

let stroke = null; // { restore, radius, points, sent, ... } while the pointer is down
let panning = null; // { x, y, vx, vy } while the picture is being moved
let spaceDown = false;

/** Pointer -> position in the picture (0..1), through the zoom. */
const toImage = (e) => {
  const fr = els.frame.getBoundingClientRect();
  const lx = e.clientX - fr.left - els.frame.clientLeft, ly = e.clientY - fr.top - els.frame.clientTop;
  const qx = (lx - view.x) / view.s, qy = (ly - view.y) / view.s;
  const r = imageRect();
  return [clamp((qx - r.left) / r.w, 0, 1), clamp((qy - r.top) / r.h, 0, 1)];
};

function moveRing(e) {
  const fr = els.frame.getBoundingClientRect();
  const d = Number(els.brush.value) * imageRect().w * 2 * view.s;
  els.ring.hidden = spaceDown || Boolean(panning);
  els.ring.dataset.tool = tool;
  els.ring.style.width = els.ring.style.height = `${d}px`;
  els.ring.style.left = `${e.clientX - fr.left - els.frame.clientLeft}px`;
  els.ring.style.top = `${e.clientY - fr.top - els.frame.clientTop}px`;
}

// The stroke is felt at once in two ways: a coloured trail is drawn under the pointer (no round trip), and the
// stroke is streamed to Rust in small pieces while you paint, each followed by a quick preview render, so the
// cutout and the sticker change as you go instead of after you let go. Undo / redo go through the same queue, so
// they always come after the strokes that were painted before them.
const TRAIL = { erase: "rgba(255, 90, 90, 0.42)", restore: "rgba(70, 200, 120, 0.42)" };
const SEND_EVERY_MS = 45;
let trailCtx = null;
let queue = []; // work waiting for Rust, in order: { kind: "stroke" | "undo" | "redo", ... }
let pumping = false;

function setHistory(h) {
  els.undo.disabled = !h.canUndo;
  els.redo.disabled = !h.canRedo;
}

function startTrail() {
  const { w, h } = frameBox();
  const sf = (window.devicePixelRatio || 1) * Math.min(view.s, 4); // sharper when zoomed in
  els.trail.width = Math.round(w * sf);
  els.trail.height = Math.round(h * sf);
  trailCtx = els.trail.getContext("2d");
  trailCtx.scale(sf, sf);
  trailCtx.lineCap = trailCtx.lineJoin = "round";
}

function drawTrail(from, to) {
  if (!trailCtx || !stroke) return;
  const r = imageRect();
  const px = ([x, y]) => [r.left + x * r.w, r.top + y * r.h];
  const [ax, ay] = px(from), [bx, by] = px(to);
  trailCtx.strokeStyle = TRAIL[stroke.restore ? "restore" : "erase"];
  trailCtx.lineWidth = stroke.radius * r.w * 2;
  trailCtx.beginPath();
  trailCtx.moveTo(ax, ay);
  trailCtx.lineTo(bx, by);
  trailCtx.stroke();
}

function clearTrail() {
  trailCtx?.clearRect(0, 0, els.trail.width, els.trail.height);
}

/** Queue what has been painted since the last piece (it starts at the previous piece's last point, so there is no gap). */
function sendPiece() {
  if (!stroke) return;
  const { points, sent } = stroke;
  if (points.length <= sent && sent > 0) return; // nothing new
  const from = Math.max(0, sent - 1);
  queue.push({ kind: "stroke", points: points.slice(from), radius: stroke.radius, restore: stroke.restore, newStroke: sent === 0 });
  stroke.sent = points.length;
  pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      if (job.kind === "stroke") setHistory(await invoke("creator_stroke", { points: job.points, radius: job.radius, restore: job.restore, newStroke: job.newStroke }));
      else setHistory(await invoke(job.kind === "undo" ? "creator_undo" : "creator_redo"));
      if (!queue.length) await render(true); // skip renders that would be out of date at once
    }
  } catch (err) {
    queue = [];
    setError(friendly(err));
  } finally {
    pumping = false;
    if (!stroke && !queue.length) clearTrail(); // the real cutout now shows the stroke
  }
}

function undo() { if (!stroke && !els.undo.disabled) { queue.push({ kind: "undo" }); pump(); } }
function redo() { if (!stroke && !els.redo.disabled) { queue.push({ kind: "redo" }); pump(); } }
els.undo.addEventListener("click", undo);
els.redo.addEventListener("click", redo);

window.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName) && document.activeElement.type !== "range";
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.altKey && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && !e.altKey && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
  if (mod && e.key === "0") { e.preventDefault(); resetView(); return; }
  if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomAt(...frameCenter(), 1.5); return; }
  if (mod && e.key === "-") { e.preventDefault(); zoomAt(...frameCenter(), 1 / 1.5); return; }
  if (e.code === "Space" && !typing && !e.repeat) {
    e.preventDefault();
    spaceDown = true;
    els.frame.dataset.pan = "ready";
    els.ring.hidden = true;
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") { spaceDown = false; if (!panning) delete els.frame.dataset.pan; }
});

els.frame.addEventListener("pointerenter", moveRing);
els.frame.addEventListener("pointerleave", () => { if (!stroke) els.ring.hidden = true; });
els.frame.addEventListener("pointerdown", (e) => {
  if (info?.phase !== "ready") return;
  els.frame.setPointerCapture(e.pointerId);
  if (spaceDown || e.button === 1) { // move the picture instead of painting
    e.preventDefault();
    panning = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    els.frame.dataset.pan = "moving";
    els.ring.hidden = true;
    return;
  }
  const p = toImage(e);
  stroke = { points: [p], sent: 0, restore: tool === "restore", radius: Number(els.brush.value), timer: 0 };
  startTrail();
  drawTrail(p, p);
  moveRing(e);
  stroke.timer = setInterval(sendPiece, SEND_EVERY_MS);
});
els.frame.addEventListener("pointermove", (e) => {
  if (panning) {
    view.x = panning.vx + e.clientX - panning.x;
    view.y = panning.vy + e.clientY - panning.y;
    applyView();
    return;
  }
  moveRing(e);
  if (!stroke) return;
  const p = toImage(e);
  drawTrail(stroke.points[stroke.points.length - 1], p);
  stroke.points.push(p);
});
const endStroke = (e) => {
  if (panning) {
    panning = null;
    if (spaceDown) els.frame.dataset.pan = "ready"; else delete els.frame.dataset.pan;
    try { els.frame.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    return;
  }
  if (!stroke) return;
  clearInterval(stroke.timer);
  try { els.frame.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  sendPiece(); // whatever is left goes out now
  stroke = null;
  if (!pumping && !queue.length) clearTrail();
};
els.frame.addEventListener("pointerup", endStroke);
els.frame.addEventListener("pointercancel", endStroke);

// ---- controls ----

const setTool = (t) => {
  tool = t;
  $("tool-erase").setAttribute("aria-pressed", String(t === "erase"));
  $("tool-restore").setAttribute("aria-pressed", String(t === "restore"));
};
$("tool-erase").addEventListener("click", () => setTool("erase"));
$("tool-restore").addEventListener("click", () => setTool("restore"));
$("clear-edits").addEventListener("click", async () => { setHistory(await invoke("creator_clear_edits")); render(true); });
els.strength.addEventListener("input", () => scheduleRender());
els.smooth.addEventListener("input", () => scheduleRender());

// holographic sheen follows the pointer over the material preview
els.stickerFrame.addEventListener("pointermove", (e) => {
  const r = els.stickerFrame.getBoundingClientRect();
  els.wrap.style.setProperty("--sx", `${((e.clientX - r.left) / r.width) * 100}%`);
  els.wrap.style.setProperty("--sy", `${((e.clientY - r.top) / r.height) * 100}%`);
});

els.cancel.addEventListener("click", () => invoke("creator_cancel"));
$("failed-close").addEventListener("click", () => invoke("creator_cancel"));

els.make.addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  els.make.disabled = true;
  els.make.textContent = "Making…";
  setError("");
  try {
    await invoke("creator_finish", { materialId: material, strength: Number(els.strength.value), smooth: Number(els.smooth.value) });
  } catch (e) {
    setError(friendly(e));
    busy = false;
    els.make.textContent = "Make this Peta";
    els.make.disabled = false;
  }
});

await listen("creator-changed", () => refresh());
await refresh();
