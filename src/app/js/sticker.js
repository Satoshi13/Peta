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
return { load, cv, el, tilt };
})();
