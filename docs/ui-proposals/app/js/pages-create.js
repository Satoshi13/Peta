/* Create: the Cutting Mat. Same ideas as the app (original -> cutout -> sticker, brush, outline, material),
   done in canvas. Samples are already cut out, so we paint them onto a fake "photo" and cut it again. */
const CR = { stage: "empty", src: null, photo: null, mask: null, border: 14, smooth: 4, tool: "erase", brush: 26, undo: [], redo: [], res: null, cutCanvas: null, note: "" };
const SAMPLE_KEYS = ["sCat", "sBlueFlower", "sCoffee", "sCamera", "sEgg", "sGoodDay", "sPlant", "sPolaroid", "sCassette", "sComputer", "sScribble", "sBubble"];
const PHOTO_W = 720;

const usesText = () => "Uses one " + MAT[S.chosen].name + (MAT[S.chosen].unlimited ? " (never runs out)" : ` — ${S.stock[S.chosen]} left`);
function crReset() { Object.assign(CR, { stage: "empty", src: null, photo: null, mask: null, undo: [], redo: [], res: null, cutCanvas: null, note: "" }); }

async function crLoadSample(key) {
  CR.stage = "cutting"; CR.src = key; CR.note = "";
  Shell.refresh();
  const { photo, alpha } = await Stk.fakePhoto(A[key], PHOTO_W);
  const m = Stk.cv(photo.width, photo.height); m.getContext("2d").drawImage(alpha, 0, 0);
  Object.assign(CR, { photo, mask: m, undo: [], redo: [] });
  await sleep(reduced() ? 50 : 1500); CR.stage = "ready"; Snd.chime(2, 740); Shell.refresh();
}
async function crLoadFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  CR.stage = "cutting"; CR.src = "upload"; Shell.refresh();
  const url = URL.createObjectURL(file), im = await Stk.load(url);
  const k = Math.min(1, PHOTO_W / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.round(im.naturalWidth * k), hh = Math.round(im.naturalHeight * k);
  const photo = Stk.cv(w, hh); photo.getContext("2d").drawImage(im, 0, 0, w, hh);
  const m = Stk.cv(w, hh), x = m.getContext("2d"); x.fillStyle = "#fff"; x.beginPath(); x.ellipse(w / 2, hh / 2, w * .38, hh * .43, 0, 0, 7); x.fill();
  Object.assign(CR, { photo, mask: m, undo: [], redo: [], note: "This preview can't find the subject on its own — paint with Restore and Erase." });
  await sleep(reduced() ? 50 : 1300); CR.stage = "ready"; Shell.refresh();
}

/** mask -> smoothed mask (blur by down/up-scaling, then a soft threshold) */
function smoothMask(mask, r) {
  if (r <= 0) return mask;
  const w = mask.width, hh = mask.height, f = 1 + r * .6, s = Stk.cv(w / f, hh / f), sx = s.getContext("2d"); sx.imageSmoothingQuality = "high"; sx.drawImage(mask, 0, 0, s.width, s.height);
  const o = Stk.cv(w, hh), ox = o.getContext("2d"); ox.imageSmoothingQuality = "high"; ox.drawImage(s, 0, 0, w, hh);
  const d = ox.getImageData(0, 0, w, hh), p = d.data;
  for (let i = 3; i < p.length; i += 4) p[i] = clamp((p[i] - 110) * (255 / 60), 0, 255);
  ox.putImageData(d, 0, 0); return o;
}
function bboxCrop(canvas, pad = 4) {
  const w = canvas.width, hh = canvas.height, p = canvas.getContext("2d").getImageData(0, 0, w, hh).data;
  let x0 = w, y0 = hh, x1 = 0, y1 = 0;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (p[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0 || y1 <= y0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(hh, y1 + pad);
  const c = Stk.cv(x1 - x0, y1 - y0); c.getContext("2d").drawImage(canvas, -x0, -y0); return c;
}
function crCutout() {
  const sm = smoothMask(CR.mask, CR.smooth), c = Stk.cv(CR.photo.width, CR.photo.height), x = c.getContext("2d");
  x.drawImage(CR.photo, 0, 0); x.globalCompositeOperation = "destination-in"; x.drawImage(sm, 0, 0); return c;
}
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
      on: { click: () => file.click(), keydown: (e) => (e.key === "Enter" || e.key === " ") && file.click(),
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
    let raf = 0;
    const redraw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(async () => {
        const cut = crCutout(); CR.cutCanvas = cut;
        const ox = origCv.getContext("2d"); ox.clearRect(0, 0, origCv.width, origCv.height); ox.drawImage(CR.photo, 0, 0);
        const dim = Stk.cv(origCv.width, origCv.height), dx = dim.getContext("2d"); dx.fillStyle = "rgba(30,24,16,.5)"; dx.fillRect(0, 0, dim.width, dim.height); dx.globalCompositeOperation = "destination-out"; dx.drawImage(smoothMask(CR.mask, CR.smooth), 0, 0);
        ox.drawImage(dim, 0, 0);
        const cx = cutCv.getContext("2d"); cx.clearRect(0, 0, cutCv.width, cutCv.height); cx.drawImage(cut, 0, 0);
        const crop = bboxCrop(cut); if (!crop) { stkHost.replaceChildren(h("p.muted", "Nothing left to cut out")); CR.res = null; syncMake(); return; }
        CR.crop = crop;
        const res = await Stk.fromDrawable(crop, crop.width, crop.height, { border: CR.border, material: S.chosen, max: 520 }); CR.res = res;
        const maxD = 230, el = Stk.el(res, res.aspect >= 1 ? maxD : maxD * res.aspect); el.classList.add("live");
        stkHost.replaceChildren(el); Stk.tilt(stkHost, { max: 8, scale: 1.02 }); syncMake();
      });
    };
    // brush
    let painting = false, last = null;
    const stroke = (p) => {
      const mx = CR.mask.getContext("2d"), r = CR.brush; mx.save();
      mx.globalCompositeOperation = CR.tool === "erase" ? "destination-out" : "source-over"; mx.fillStyle = "#fff";
      const seg = last ? Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / (r * .35))) : 1;
      for (let i = 1; i <= seg; i++) { const t = i / seg, x = last ? lerp(last.x, p.x, t) : p.x, y = last ? lerp(last.y, p.y, t) : p.y; mx.beginPath(); mx.arc(x, y, r, 0, 7); mx.fill(); }
      mx.restore(); last = p; redraw();
    };
    const cutFrame = h("div.frame.checker", cutCv, ring);
    const moveRing = (e) => { const p = canvasPoint(cutCv, e), fr = cutFrame.getBoundingClientRect(), d = CR.brush * 2 * p.k; ring.style.width = ring.style.height = d + "px"; ring.style.left = e.clientX - fr.left + "px"; ring.style.top = e.clientY - fr.top + "px"; ring.dataset.tool = CR.tool; ring.style.opacity = 1; };
    cutFrame.addEventListener("pointermove", (e) => { moveRing(e); if (painting) stroke(canvasPoint(cutCv, e)); });
    cutFrame.addEventListener("pointerleave", () => { ring.style.opacity = 0; });
    cutFrame.addEventListener("pointerdown", (e) => {
      cutFrame.setPointerCapture(e.pointerId); painting = true; last = null;
      CR.undo.push(snapMask()); if (CR.undo.length > 30) CR.undo.shift(); CR.redo = []; syncUndo();
      stroke(canvasPoint(cutCv, e));
    });
    const endPaint = () => { painting = false; last = null; }; cutFrame.addEventListener("pointerup", endPaint); cutFrame.addEventListener("pointercancel", endPaint);

    const snapMask = () => { const c = Stk.cv(CR.mask.width, CR.mask.height); c.getContext("2d").drawImage(CR.mask, 0, 0); return c; };
    const restore = (c) => { const x = CR.mask.getContext("2d"); x.globalCompositeOperation = "copy"; x.drawImage(c, 0, 0); x.globalCompositeOperation = "source-over"; };
    const undo = () => { const c = CR.undo.pop(); if (!c) return; CR.redo.push(snapMask()); restore(c); syncUndo(); redraw(); Snd.tap(); };
    const redo = () => { const c = CR.redo.pop(); if (!c) return; CR.undo.push(snapMask()); restore(c); syncUndo(); redraw(); Snd.tap(); };
    const undoBtn = h("button.btn.paper.small", { title: "Undo (⌘Z)", on: { click: undo } }, "Undo");
    const redoBtn = h("button.btn.paper.small", { title: "Redo (⇧⌘Z)", on: { click: redo } }, "Redo");
    const syncUndo = () => { undoBtn.disabled = !CR.undo.length; redoBtn.disabled = !CR.redo.length; };
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
        h("div.grp.g-look", h("label.lbl", "Look"), slider("Outline", "border", 4, 30, "", redraw), slider("Smooth", "smooth", 0, 12, "", redraw)),
        h("div.grp.g-tools", h("label.lbl", "Brush"), h("div.tools", seg, undoBtn, redoBtn), slider("Size", "brush", 8, 60, "", () => {})),
        h("div.grp.g-go", CR.note ? h("p.muted.small", CR.note) : null, h("div.go-btns", h("button.btn.paper", { on: { click: () => { crReset(); Shell.refresh(); } } }, "Cancel"), make))));
    syncUndo(); syncMake(); redraw();
    return h("div.cr-wrap", mat);
  },
  async make() {
    if (!CR.res) return;
    const id = "L" + pad4(S.nextNo).slice(2), mat = S.chosen;
    if (!MAT[mat].unlimited) S.stock[mat]--;
    const url = CR.crop.toDataURL("image/png");
    const entry = { id, cutout: url, material: mat, kind: "original", no: S.nextNo++, date: S.today, title: "My Peta" };
    Snd.tap(); crReset(); Shell.refresh();
    await Desktop.print(entry);
  },
};
