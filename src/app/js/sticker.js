/* Reference canvas rendering is used only for static catalog/sample presentation.
   Real uploads, cutting, brush history and saved stickers use creator_* / sticker_asset in Rust. */
/* Die-cut stickers drawn on canvas: cut-out + white (or kraft / holographic) border, like the app's sticker.rs. */
const Stk = (() => {
  const imgCache = new Map(), made = new Map();
  const load = (src) => {
    if (!imgCache.has(src)) imgCache.set(src, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }));
    return imgCache.get(src);
  };
  const cv = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  /* Growing a silhouette by r px: a few passes of "union of shifted copies" (each pass <= 8 px), so a 60 px border costs
     ~200 draws instead of ~2000. The union of discs adds up, so the shape stays round. */
  const ring = (r) => { const pts = [[0, 0]], n1 = Math.max(8, Math.ceil((Math.PI * 2 * r) / 2.6)), n2 = Math.max(6, Math.ceil(n1 / 2));
    for (let i = 0; i < n1; i++) { const a = (i / n1) * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    for (let i = 0; i < n2; i++) { const a = ((i + .5) / n2) * Math.PI * 2; pts.push([Math.cos(a) * r * .5, Math.sin(a) * r * .5]); } return pts; };
  /** Solid-colour silhouette of an alpha source, grown by r px. `src` is any drawable. */
  function grow(src, w, h, r, pad, fill) {
    const cw = w + pad * 2, ch = h + pad * 2;
    let cur = cv(cw, ch); const sil = cv(w, h), sx = sil.getContext("2d");
    sx.drawImage(src, 0, 0, w, h); sx.globalCompositeOperation = "source-in"; sx.fillStyle = "#fff"; sx.fillRect(0, 0, w, h);
    cur.getContext("2d").drawImage(sil, pad, pad);
    let rem = r;
    while (rem > 0.5) {
      const st = Math.min(rem, 8), nxt = cv(cw, ch), nx = nxt.getContext("2d");
      for (const [dx, dy] of ring(st)) nx.drawImage(cur, dx, dy);
      cur = nxt; rem -= st;
    }
    const x = cur.getContext("2d"); x.globalCompositeOperation = "source-in"; x.fillStyle = fill; x.fillRect(0, 0, cw, ch);
    return cur;
  }
  async function fromDrawable(src, w0, h0, { border = 14, material = "matte", max = 520 } = {}) {
    const k = Math.min(1, max / Math.max(w0, h0)), w = Math.round(w0 * k), h = Math.round(h0 * k);
    const b = Math.round(border * (max / 520)), pad = b + 8;
    const out = cv(w + pad * 2, h + pad * 2), x = out.getContext("2d");
    let maskCanvas;
    if (material === "gold") {
      const film = grow(src, w, h, b, pad, "#fff"), fx = film.getContext("2d");
      const g = fx.createLinearGradient(0, 0, film.width, film.height);
      ["#f8e9ae", "#d9b24f", "#fff3c4", "#c59a3c", "#f3de90", "#d9b24f"].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
      fx.globalCompositeOperation = "source-in"; fx.fillStyle = g; fx.fillRect(0, 0, film.width, film.height);
      fx.globalCompositeOperation = "source-atop";
      for (let i = 0; i < film.width * film.height / 300; i++) { fx.fillStyle = `rgba(255,248,214,${rand(0.3, 0.9)})`; fx.fillRect(Math.random() * film.width, Math.random() * film.height, 1.3, 1.3); }
      x.drawImage(film, 0, 0); x.drawImage(grow(src, w, h, Math.max(2, b * 0.5), pad, "#fffaf0"), 0, 0); maskCanvas = film;
    } else if (material === "riso") {
      x.drawImage(grow(src, w, h, b, pad, "#f2a3b6"), 5, 5);
      x.drawImage(grow(src, w, h, b + 1, pad, "rgba(60,45,20,.12)"), 0, 0);
      const body = grow(src, w, h, b, pad, "#fbf9f4"); x.drawImage(body, 0, 0); maskCanvas = body;
    } else if (material === "vintage") {
      x.drawImage(grow(src, w, h, b + 1, pad, "rgba(110,84,44,.5)"), 0, 0);
      const body = grow(src, w, h, b, pad, "#efe2c6"), bx = body.getContext("2d");
      bx.globalCompositeOperation = "source-atop";
      for (let i = 0; i < body.width * body.height / 150; i++) { bx.fillStyle = `rgba(120,90,50,${rand(0.08, 0.3)})`; bx.fillRect(Math.random() * body.width, Math.random() * body.height, rand(.8, 2), rand(.8, 2)); }
      x.drawImage(body, 0, 0); maskCanvas = body;
    } else if (material === "holographic") {
      const film = grow(src, w, h, b, pad, "#fff"), fx = film.getContext("2d");
      const g = fx.createLinearGradient(0, 0, film.width, film.height);
      ["#f6c6e3", "#c9c3f5", "#bfe3f7", "#c8f2dc", "#f7f0be", "#f9d4c0"].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
      fx.globalCompositeOperation = "source-in"; fx.fillStyle = g; fx.fillRect(0, 0, film.width, film.height);
      fx.globalCompositeOperation = "source-atop";
      for (let i = 0; i < film.width * film.height / 260; i++) { fx.fillStyle = `rgba(255,255,255,${rand(0.25, 0.8)})`; fx.fillRect(Math.random() * film.width, Math.random() * film.height, 1.2, 1.2); }
      x.drawImage(film, 0, 0);
      x.drawImage(grow(src, w, h, Math.max(2, b * 0.55), pad, "#fffefb"), 0, 0);
      maskCanvas = film;
    } else if (material === "kraft") {
      const kraft = await load(A.paperKraft);
      const edge = grow(src, w, h, b + 1, pad, "rgba(118,88,48,.45)"); x.drawImage(edge, 0, 0);
      const body = grow(src, w, h, b, pad, "#fff"), bx = body.getContext("2d");
      bx.globalCompositeOperation = "source-in"; bx.fillStyle = bx.createPattern(kraft, "repeat"); bx.fillRect(0, 0, body.width, body.height);
      bx.globalCompositeOperation = "source-atop"; bx.fillStyle = "rgba(180,130,70,.18)"; bx.fillRect(0, 0, body.width, body.height);
      x.drawImage(body, 0, 0); maskCanvas = body;
    } else {
      const edge = grow(src, w, h, b + 1, pad, "rgba(60,45,20,.16)"); x.drawImage(edge, 0, 0);
      const body = grow(src, w, h, b, pad, "#fbf9f4"); x.drawImage(body, 0, 0); maskCanvas = body;
    }
    x.drawImage(src, pad, pad, w, h);
    return { canvas: out, url: out.toDataURL("image/png"), mask: (material === "holographic" || material === "gold") ? maskCanvas.toDataURL("image/png") : null, w: out.width, h: out.height, aspect: out.width / out.height, material };
  }
  async function make(srcUrl, opt = {}) {
    const key = `${srcUrl}|${opt.border ?? 14}|${opt.material ?? "matte"}|${opt.max ?? 520}`;
    if (!made.has(key)) made.set(key, load(srcUrl).then((i) => fromDrawable(i, i.naturalWidth, i.naturalHeight, opt)));
    return made.get(key);
  }
  /** A DOM sticker. `w` is the CSS width in px (height follows). holographic gets the reflective sheen layer. */
  function el(res, w = 160) {
    const holo = res.material === "holographic" || res.material === "gold";
    const e = h("div.stk", { data: { material: res.material }, style: { width: w + "px", aspectRatio: res.w + " / " + res.h } },
      h("img", { src: res.url, alt: "", draggable: false }));
    if (holo && res.mask) e.append(h("i.sheen", { style: { webkitMaskImage: `url(${res.mask})`, maskImage: `url(${res.mask})` } }));
    return e;
  }
  /** Pointer-reactive tilt + sheen for a sticker element (or any wrapper containing .stk). */
  function tilt(target, { max = 12, scale = 1.04 } = {}) {
    const stk = target.matches(".stk") ? target : target.querySelector(".stk") || target;
    const reset = () => { target.style.transform = ""; stk.style.setProperty("--sx", "30%"); stk.style.setProperty("--sy", "30%"); };
    onPointerFollow(target, (x, y) => {
      target.style.transform = `perspective(700px) rotateY(${(x - 0.5) * max * 2}deg) rotateX(${-(y - 0.5) * max * 2}deg) scale(${scale})`;
      stk.style.setProperty("--sx", `${(1 - x) * 100}%`); stk.style.setProperty("--sy", `${(1 - y) * 100}%`);
    }, reset);
    return reset;
  }
  /** A stand-in "photo" for the Create demo: the sticker art over a soft bokeh background. */
  async function fakePhoto(srcUrl, size = 520) {
    const img = await load(srcUrl), c = cv(size, size * 0.8), x = c.getContext("2d");
    const hue = Math.floor(rand(15, 45));
    const g = x.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, `hsl(${hue + 150},22%,62%)`); g.addColorStop(1, `hsl(${hue},38%,70%)`);
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 26; i++) { x.beginPath(); x.fillStyle = `hsla(${rand(0, 360)},45%,${rand(60, 85)}%,${rand(0.15, 0.4)})`; x.arc(Math.random() * c.width, Math.random() * c.height, rand(14, 60), 0, 7); x.fill(); }
    x.fillStyle = "rgba(255,255,255,.14)"; x.fillRect(0, c.height * 0.72, c.width, c.height * 0.28);
    const k = Math.min((c.width * 0.72) / img.naturalWidth, (c.height * 0.78) / img.naturalHeight);
    const w = img.naturalWidth * k, hh = img.naturalHeight * k, px = (c.width - w) / 2, py = (c.height - hh) / 2 + c.height * 0.02;
    x.save(); x.shadowColor = "rgba(30,20,10,.35)"; x.shadowBlur = 18; x.shadowOffsetY = 8; x.drawImage(img, px, py, w, hh); x.restore();
    const a = cv(c.width, c.height), ax = a.getContext("2d"); ax.drawImage(img, px, py, w, hh);
    return { photo: c, alpha: a };
  }
  return { load, make, el, tilt, fromDrawable, fakePhoto, cv };
})();
