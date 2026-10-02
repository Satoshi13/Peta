// Cutting Mat logic (spec §25). Rendering happens in Rust (peta-core); this file wires the controls to it.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const els = {
  original: $("img-original"), dim: $("img-dim"), cutout: $("img-cutout"), sticker: $("img-sticker"),
  frame: $("cutout-frame"), ring: $("brush-ring"), wrap: $("sticker-wrap"), stickerFrame: $("sticker-frame"),
  materials: $("materials"), strength: $("strength"), brush: $("brush-size"),
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
    const buf = await invoke("creator_render", { materialId: material, strength: Number(els.strength.value), preview });
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
  els.strength.value = String(info.defaultStrength);
  els.hint.textContent = info.hadAlpha ? "This image already has a transparent background." : "";
  els.note.textContent = info.countsForToday
    ? "Nothing is used up until you make it. Cancel any time."
    : "Developer: this one does not count as today's Peta.";
  renderMaterials();
  await render(true);
}

// ---- brush (paints on the cutout pane) ----

/** Where the image sits inside the pane (object-fit: contain). */
function imageRect() {
  const r = els.frame.getBoundingClientRect();
  const k = Math.min(r.width / aspect, r.height) ;
  const w = k * aspect, h = k;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, w, h, frame: r };
}

let stroke = null;
const toImage = (e) => {
  const r = imageRect();
  return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.w)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.h))];
};

function moveRing(e) {
  const r = imageRect();
  const d = Number(els.brush.value) * r.w * 2;
  els.ring.hidden = false;
  els.ring.dataset.tool = tool;
  els.ring.style.width = els.ring.style.height = `${d}px`;
  els.ring.style.left = `${e.clientX - r.frame.left}px`;
  els.ring.style.top = `${e.clientY - r.frame.top}px`;
}

els.frame.addEventListener("pointerenter", moveRing);
els.frame.addEventListener("pointerleave", () => { if (!stroke) els.ring.hidden = true; });
els.frame.addEventListener("pointerdown", (e) => {
  if (info?.phase !== "ready") return;
  els.frame.setPointerCapture(e.pointerId);
  stroke = { points: [toImage(e)] };
  moveRing(e);
});
els.frame.addEventListener("pointermove", (e) => {
  moveRing(e);
  if (stroke) stroke.points.push(toImage(e));
});
const endStroke = async (e) => {
  if (!stroke) return;
  const { points } = stroke;
  stroke = null;
  try { els.frame.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  try {
    await invoke("creator_stroke", { points, radius: Number(els.brush.value), restore: tool === "restore" });
    await render(true);
  } catch (err) {
    setError(friendly(err));
  }
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
$("clear-edits").addEventListener("click", async () => { await invoke("creator_clear_edits"); render(true); });
els.strength.addEventListener("input", () => scheduleRender());

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
    await invoke("creator_finish", { materialId: material, strength: Number(els.strength.value) });
  } catch (e) {
    setError(friendly(e));
    busy = false;
    els.make.textContent = "Make this Peta";
    els.make.disabled = false;
  }
});

await listen("creator-changed", () => refresh());
await refresh();
