/* Share card: one sticker lying on a soft sheet of paper, drawn to a 3:2 PNG that sits well in a Discord forum gallery.
   It is a picture of the sticker, not the sticker: it carries no ownership, and importing it makes a new, unrelated sticker.
   Copy puts it on the clipboard (Rust writes the pasteboard); Save asks where to write it (Rust, the same path as the poster). */
const ShareCard = (() => {
  const W = 1500, H = 1000, PAPER = [248, 243, 233];
  /** Sheet colours to choose from; "auto" follows the sticker. The last choice is kept while the app is open. */
  const SHEETS = [["auto", "Match the sticker", null], ["cream", "Cream", "#f8f3e9"], ["kraft", "Kraft", "#e6d6bd"], ["sky", "Sky", "#dfe7ee"],
    ["mint", "Mint", "#e1ece0"], ["blush", "Blush", "#f3e1de"], ["lilac", "Lilac", "#e7e1f0"], ["ink", "Ink", "#2f2e2b"]];
  let chosen = "auto";
  const dark = (css) => { const m = /^#([0-9a-f]{6})$/i.exec(css || ""); if (!m) return false; const v = parseInt(m[1], 16); return (.299 * (v >> 16) + .587 * ((v >> 8) & 255) + .114 * (v & 255)) < 110; };
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

  /** The sheet's colour: always a light paper, leaning toward the sticker's hue (its white border left out). A dark or
   *  colourless sticker gets plain cream rather than grey. */
  function tint(img) {
    const c = Stk.cv(40, 40), x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, 40, 40);
    const d = x.getImageData(0, 0, 40, 40).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 220 || Math.min(d[i], d[i + 1], d[i + 2]) > 232) continue;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    if (!n) return `rgb(${PAPER.join(",")})`;
    [r, g, b] = [r / n / 255, g / n / 255, b / n / 255];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    if (sat < .14) return `rgb(${PAPER.join(",")})`;
    const hue = max === r ? 60 * (((g - b) / (max - min)) % 6) : max === g ? 60 * ((b - r) / (max - min) + 2) : 60 * ((r - g) / (max - min) + 4);
    return `hsl(${Math.round((hue + 360) % 360)}, ${Math.round(Math.min(32, sat * 45))}%, 90%)`;
  }

  /** `sheet` is "auto" or a #rrggbb colour. */
  async function render(e, sheet = "auto") {
    const png = await Bridge.invoke("sticker_export", { stickerId: e.id, cutout: false });
    const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: "image/png" }));
    const [pic, paper, logo] = await Promise.all([Stk.load(url), Stk.load(A.pagePaper), Stk.load(A.logo).catch(() => null)]);
    URL.revokeObjectURL(url);
    const c = Stk.cv(W, H), x = c.getContext("2d");
    const night = dark(sheet);
    x.fillStyle = sheet === "auto" ? tint(pic) : sheet; x.fillRect(0, 0, W, H);
    x.save(); x.globalAlpha = night ? .1 : .22; x.globalCompositeOperation = night ? "overlay" : "multiply"; x.fillStyle = x.createPattern(paper, "repeat"); x.fillRect(0, 0, W, H); x.restore();

    // The sticker, a little tilted (the same tilt every time for the same sticker), with a soft lifted shadow.
    const f = PetaMath.fitInside(pic.naturalWidth, pic.naturalHeight, W * .62, H * .74), cy = H * .53;
    const tilt = ((hash(e.id) % 7) - 3) * Math.PI / 180;
    let face = pic;
    if (["holographic", "gold"].includes(e.material)) {   // a still of the sheen the desktop shows moving
      const s = Stk.cv(f.w, f.h), sx = s.getContext("2d");
      sx.drawImage(pic, 0, 0, f.w, f.h); sx.globalCompositeOperation = "source-atop"; sx.globalAlpha = .22;
      const g = sx.createLinearGradient(0, 0, f.w, f.h);
      (e.material === "gold" ? ["#fff3c4", "#d9a93f", "#fff7d8", "#b8862b"] : ["#ff9ad5", "#9ad8ff", "#c4ffb0", "#ffe39a", "#d0a8ff"]).forEach((col, i, all) => g.addColorStop(i / (all.length - 1), col));
      sx.fillStyle = g; sx.fillRect(0, 0, f.w, f.h); face = s;
    }
    // Rasterize the transformed face once, then paint only its shadows in canvas coordinates.
    // Antialiased edge pixels must not be composited twice along with the two shadows.
    const layer = Stk.cv(W, H), lx = layer.getContext("2d");
    lx.translate(W / 2, cy); lx.rotate(tilt); lx.drawImage(face, -f.w / 2, -f.h / 2, f.w, f.h);
    const shadow = Stk.cv(W, H), sx = shadow.getContext("2d");
    for (const [color, blur, y] of [["rgba(40,28,10,.26)", 38, 18], ["rgba(40,28,10,.18)", 6, 3]]) {
      sx.shadowColor = color; sx.shadowBlur = blur; sx.shadowOffsetX = W * 2; sx.shadowOffsetY = y;
      // The source is outside the canvas: only its shadow is painted, never a second face.
      sx.drawImage(layer, -W * 2, 0);
    }
    x.drawImage(shadow, 0, 0); x.drawImage(layer, 0, 0);

    if (logo) {   // the ink wordmark, or a paper-white one on a dark sheet
      const lh = 34, lw = logo.naturalWidth * lh / logo.naturalHeight, m = Stk.cv(lw, lh), mx = m.getContext("2d");
      mx.drawImage(logo, 0, 0, lw, lh);
      if (night) { mx.globalCompositeOperation = "source-in"; mx.fillStyle = "#f4efe4"; mx.fillRect(0, 0, lw, lh); }
      x.save(); x.globalAlpha = night ? .6 : .5; x.drawImage(m, W - 48 - lw, H - 44 - lh); x.restore();
    }
    return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Could not draw the picture."))), "image/png"));
  }
  const bytes = async (blob) => Array.from(new Uint8Array(await blob.arrayBuffer()));

  /** The share sheet: a preview, Copy image (for pasting into Discord) and Save…. */
  async function open(e) {
    if (document.querySelector("dialog")) return;
    const status = h("p.small.share-status", { role: "status" }, "");
    const preview = h("img.share-preview", { alt: `Share card for ${titleOf(e)}` });
    const copy = h("button.btn.share-copy", { type: "button", disabled: true }, "Copy image");
    const save = h("button.btn.paper.share-save", { type: "button", disabled: true }, "Save…");
    let blob = null, drawing = 0, mode = "card";
    const kind = h("select.share-kind", { "aria-label": "Picture type", on: { change: () => { mode = kind.value; draw(); } } },
      h("option", { value: "card" }, "Share card"), h("option", { value: "sticker" }, "Sticker (transparent)"), h("option", { value: "cutout", disabled: true }, "Cut-out for a pack"));
    const note = h("small.muted", "");
    Bridge.invoke("sticker_export_options", { stickerId: e.id }).then(ok => {
      kind.querySelector('[value="cutout"]').disabled = !ok;
      if (!ok) note.textContent = "The original cut-out isn't available for this finished sticker.";
    }).catch(() => { note.textContent = "The original cut-out isn't available for this sticker."; });
    const sheetOf = (id) => id.startsWith("#") ? id : (SHEETS.find(([k]) => k === id)?.[2] ?? "auto");
    const draw = async () => {
      const mine = ++drawing; copy.disabled = save.disabled = true; status.textContent = "";
      try {
        swatches.parentElement.hidden = mode !== "card"; preview.classList.toggle("transparent", mode !== "card");
        const next = mode === "card" ? await render(e, sheetOf(chosen)) : new Blob([new Uint8Array(await Bridge.invoke("sticker_export", { stickerId: e.id, cutout: mode === "cutout" }))], { type: "image/png" });
        if (mine !== drawing) return;   // a newer colour was picked meanwhile
        blob = next; URL.revokeObjectURL(preview.src); preview.src = URL.createObjectURL(blob); copy.disabled = save.disabled = false;
      } catch (err) { console.error(err); if (mine === drawing) status.textContent = "Couldn't draw the picture. Close this and try again."; }
    };
    const pick = (id) => { chosen = id; for (const b of swatches.querySelectorAll("[aria-pressed]")) b.setAttribute("aria-pressed", String(b.dataset.sheet === id || (b.dataset.sheet === "custom" && id.startsWith("#")))); draw(); };
    const custom = h("input.share-custom", { type: "color", value: chosen.startsWith("#") ? chosen : "#f8f3e9", "aria-label": "Choose any colour", on: { input: (ev) => pick(ev.target.value) } });
    const swatches = h("div.share-sheets", { role: "group", "aria-label": "Background" },
      SHEETS.map(([id, label, color]) => h("button.share-swatch" + (id === "auto" ? ".auto" : ""), { type: "button", title: label, "aria-label": label, "aria-pressed": String(chosen === id), data: { sheet: id }, style: color ? { background: color } : {}, on: { click: () => pick(id) } }, id === "auto" ? "Auto" : null)),
      h("label.share-swatch.custom", { title: "Any colour", "aria-pressed": String(chosen.startsWith("#")), data: { sheet: "custom" } }, custom));
    const dialog = h("dialog.share-dialog", { "aria-label": "Share sticker as a picture", on: { close: () => { drawing++; URL.revokeObjectURL(preview.src); dialog.remove(); Bridge.dialogOpen = false; } } },
      h("div.share-sheet", CloseButton("Close", { on: { click: () => dialog.close() } }, ".share-x"),
        h("h2", "Share as a picture"), kind, preview, note,
        h("div.share-bg", h("small", "Background"), swatches),
        h("div.share-actions", copy, save), status,
        h("small.share-note", "A picture to post, not the sticker itself. It stays yours.")));
    copy.addEventListener("click", async () => {
      try { await Bridge.invoke("share_copy", { png: await bytes(blob) }); Snd.tap(); status.textContent = "Copied. Paste it into Discord with ⌘V."; }
      catch (err) { status.textContent = userError(err); }
    });
    save.addEventListener("click", async () => {
      try { const path = await Bridge.invoke("poster_save", { name: `Peta ${titleOf(e)}${mode === "cutout" ? " cut-out" : ""}`, png: await bytes(blob) }); if (path) status.textContent = "Saved."; }
      catch (err) { status.textContent = userError(err); }
    });
    Bridge.dialogOpen = true; document.body.append(dialog); Dialogs.open(dialog);
    await draw(); copy.focus();
  }
  return { render, open };
})();
