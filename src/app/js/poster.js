/* Month poster: the Collection calendar drawn onto one PNG, saved wherever the person chooses (Rust writes the file). */
const Poster = (() => {
  const INK = "#2b2a28", MUTED = "#655e51", SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Hiragino Sans", "Noto Sans JP", sans-serif', TYPE = '"Special Elite", "Courier New", monospace';

  async function render(month, key, weekStart) {
    await Promise.all(['28px "Special Elite"'].map((f) => document.fonts.load(f).catch(() => {})));
    const L = PetaMath.posterLayout(month.offset, month.days), c = document.createElement("canvas");
    c.width = L.width; c.height = L.height;
    const x = c.getContext("2d");
    const [paper, dots, logo] = await Promise.all([Stk.load(A.pagePaper), Stk.load(A.pageDots), Stk.load(A.logo).catch(() => null)]);
    x.fillStyle = x.createPattern(paper, "repeat"); x.fillRect(0, 0, L.width, L.height);
    x.globalAlpha = .7; x.fillStyle = x.createPattern(dots, "repeat"); x.fillRect(0, 0, L.width, L.height); x.globalAlpha = 1;

    x.fillStyle = INK; x.textBaseline = "alphabetic";
    x.font = `700 120px ${SANS}`; x.fillText(monthName(key), L.margin, 216);
    x.fillStyle = MUTED; x.font = `400 40px ${SANS}`; x.fillText(`${month.daysStuck} ${month.daysStuck === 1 ? "day" : "days"} stuck · ${month.petas} ${month.petas === 1 ? "Peta" : "Petas"}`, L.margin + 4, 280);
    if (logo) { const k = 72 / logo.naturalHeight; x.drawImage(logo, L.width - L.margin - logo.naturalWidth * k, 130, logo.naturalWidth * k, 72); }

    x.fillStyle = MUTED; x.font = `400 26px ${TYPE}`; x.textAlign = "center";
    for (let i = 0; i < 7; i++) x.fillText(fmtDate(new Date(2026, 0, 4 + (weekStart + i) % 7, 12), { weekday: "short" }).toUpperCase(), L.margin + (i + .5) * L.cellW, L.gridTop - 14);

    const pics = await Promise.all(month.cells.map(async (cell) => {
      const latest = cell.entries[0];
      if (!latest || cell.state === "future") return null;
      const res = await resOf(latest); return Stk.load(res.url);
    }));
    month.cells.forEach((cell, i) => {
      const r = L.cell(cell.day), cx = r.x + r.w / 2, cy = r.y + r.h / 2 + 16;
      x.textAlign = "left"; x.fillStyle = cell.state === "future" ? "#b5ad9a" : "#8a8372"; x.font = `400 26px ${TYPE}`; x.fillText(String(cell.day), r.x + 14, r.y + 38);
      const pic = pics[i];
      if (pic) {
        const f = PetaMath.fitInside(pic.naturalWidth, pic.naturalHeight, r.w - 22, r.h - 48);
        x.save(); x.translate(cx, cy); x.rotate(cell.tilt * Math.PI / 180);
        x.shadowColor = "rgba(40,28,10,.34)"; x.shadowBlur = 14; x.shadowOffsetY = 6;
        x.drawImage(pic, -f.w / 2, -f.h / 2, f.w, f.h); x.restore();
        if (cell.entries.length > 1) {
          x.fillStyle = INK; x.beginPath(); x.arc(r.x + r.w - 28, r.y + 30, 20, 0, Math.PI * 2); x.fill();
          x.fillStyle = "#fff"; x.font = `600 22px ${SANS}`; x.textAlign = "center"; x.fillText("×" + cell.entries.length, r.x + r.w - 28, r.y + 38);
        }
      } else if (cell.state !== "future") {
        x.save(); x.strokeStyle = "rgba(60,45,20,.3)"; x.lineWidth = 3; x.setLineDash([9, 9]); x.beginPath(); x.arc(cx, cy, 38, 0, Math.PI * 2); x.stroke(); x.restore();
      }
    });

    x.textAlign = "left"; x.fillStyle = MUTED; x.font = `400 28px ${TYPE}`; x.fillText("Peta · One sticker a day.", L.margin, L.height - 64);
    if (month.complete) {
      const text = `${month.days}/${month.days} COMPLETE`;
      x.save(); x.translate(L.width - L.margin - 190, L.height - 78); x.rotate(-6 * Math.PI / 180);
      x.font = `400 40px ${TYPE}`; const w = x.measureText(text).width + 56;
      x.strokeStyle = "#99463a"; x.lineWidth = 6; x.strokeRect(-w / 2, -42, w, 74);
      x.fillStyle = "#99463a"; x.textAlign = "center"; x.fillText(text, 0, 12); x.restore();
    }
    return new Promise((ok, fail) => c.toBlob((b) => b ? ok(b) : fail(new Error("Could not draw the poster.")), "image/png"));
  }

  /** Draw the month, then let Rust ask where to save it. Resolves to the saved path, or null if cancelled. */
  async function save(month, key, weekStart) {
    const blob = await render(month, key, weekStart), bytes = new Uint8Array(await blob.arrayBuffer());
    return Bridge.invoke("poster_save", { name: `Peta ${monthName(key)}`, png: Array.from(bytes) });
  }
  return { render, save };
})();
