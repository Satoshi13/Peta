const Stk = (() => {
const load = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
const cv = (w,h) => { const c = document.createElement("canvas"); c.width=w; c.height=h; return c; };
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
return { load, cv, el, tilt, fakePhoto };
})();
