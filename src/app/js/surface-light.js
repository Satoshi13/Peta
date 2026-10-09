/* Surface light: the glint that follows the pointer over a picture of a physical thing (a pack).
   A band of light sliding across a picture reads as a picture. Here the picture is its own bump map: the folds of the
   foil, the grain of the paper and the rounded edge of the pouch are read out of the art once, turned into a surface
   (a normal for every pixel), and a lamp that follows the pointer is lit over it every frame. The highlight therefore
   breaks up on the creases, pools on the ridges and rims the edge, and on foil its colour turns with the angle of
   each crease, as a hologram's does. Nothing here changes the art; it only draws light (soft-light) over it. */
const SurfaceLight = (() => {
  const W = 224;                              // working width in px; the overlay is scaled to the pack's size
  const maps = new Map();                     // art url -> Promise<surface>
  // How each kind of pack takes the light. shine = how tight the highlight is, spec/diffuse = how much of each, iris = rainbow turn on foil,
  // bump = how strong the creases are, rim = how much the rounded edge catches.
  const LOOK = {
    holo: { shine: 64, spec: 1.5, diffuse: .16, iris: .8, bump: 4.2, rim: .6 },
    kraft: { shine: 8, spec: .34, diffuse: .46, iris: 0, bump: 2.3, rim: .38 },
    matte: { shine: 6, spec: .24, diffuse: .40, iris: 0, bump: 2.0, rim: .32 },
  };

  /** Read the surface out of the art: height = brightness of the picture + the rounded edge of its silhouette; then a normal per pixel. */
  async function surfaceOf(url, bump, rim) {
    const key = url + "|" + bump + "|" + rim;
    if (!maps.has(key)) maps.set(key, (async () => {
      const img = new Image(); img.decoding = "async"; img.src = url; await img.decode();
      const w = W, h = Math.round(W * img.naturalHeight / img.naturalWidth), c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
      const px = x.getImageData(0, 0, w, h).data, n = w * h, lum = new Float32Array(n), alpha = new Float32Array(n);
      for (let i = 0; i < n; i++) { alpha[i] = px[i * 4 + 3] / 255; lum[i] = (.3 * px[i * 4] + .59 * px[i * 4 + 1] + .11 * px[i * 4 + 2]) / 255; }
      const blur = (src, r) => { // a cheap box blur, enough to take the grain off the height
        const out = new Float32Array(n), tmp = new Float32Array(n), k = 2 * r + 1;
        for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { let s = 0; for (let d = -r; d <= r; d++) s += src[y * w + Math.min(w - 1, Math.max(0, xx + d))]; tmp[y * w + xx] = s / k; }
        for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { let s = 0; for (let d = -r; d <= r; d++) s += tmp[Math.min(h - 1, Math.max(0, y + d)) * w + xx]; out[y * w + xx] = s / k; }
        return out;
      };
      const soft = blur(lum, 1), edge = blur(alpha, 4), height = new Float32Array(n);
      for (let i = 0; i < n; i++) height[i] = (soft[i] - .5) * bump * .35 + edge[i] * rim * 2.2;
      const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n);
      for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
        const i = y * w + xx, l = height[y * w + Math.max(0, xx - 1)], r = height[y * w + Math.min(w - 1, xx + 1)], t = height[Math.max(0, y - 1) * w + xx], b = height[Math.min(h - 1, y + 1) * w + xx];
        const gx = (r - l) * 3, gy = (b - t) * 3, len = Math.hypot(gx, gy, 1);
        nx[i] = -gx / len; ny[i] = -gy / len; nz[i] = 1 / len;
      }
      return { w, h, alpha, nx, ny, nz };
    })().catch((e) => { maps.delete(key); throw e; }));
    return maps.get(key);
  }

  const hue = (t) => { t = (t % 1 + 1) % 1; const f = (n) => { const k = (n + t * 6) % 6; return Math.max(0, Math.min(1, Math.min(k, 4 - k))); }; return [f(5), f(3), f(1)]; }; // a bright rainbow (hsv, s=v=1)

  /** Put a light canvas on top of `host` (the element that carries the pack's picture). Returns { aim(x, y, amount), rest() }. */
  function attach(host, kind = "holo") {
    const look = LOOK[kind] || LOOK.holo, key = (PACK_KINDS[kind] || PACK_KINDS.holo).key, url = A[key];
    host.querySelectorAll(":scope > canvas.glint").forEach((c) => c.remove()); // a cloned pack brings a blank canvas along
    const canvas = document.createElement("canvas"); canvas.className = "glint"; canvas.setAttribute("aria-hidden", "true"); host.append(canvas);
    let surface = null, image = null, last = null, frame = 0;
    surfaceOf(url, look.bump, look.rim).then((s) => { surface = s; canvas.width = s.w; canvas.height = s.h; image = canvas.getContext("2d").createImageData(s.w, s.h); if (last) draw(last.x, last.y, last.amount); }).catch(() => {});
    function draw(lx, ly, amount) {
      if (!surface) return;
      const { w, h, alpha, nx, ny, nz } = surface, d = image.data, aspect = h / w;
      // the lamp sits over the surface at the pointer, a little above it
      const Lx = lx, Ly = ly * aspect, Lz = .55 - .12 * amount;
      for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
        const o = i * 4, a = alpha[i];
        if (a < .04) { d[o + 3] = 0; continue; }
        let vx = Lx - x / w, vy = Ly - y / w, vz = Lz; const vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;   // surface -> lamp
        const dif = Math.max(0, nx[i] * vx + ny[i] * vy + nz[i] * vz);
        let hx = vx, hy = vy, hz = vz + 1; const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;               // half-vector to the eye
        const sp = Math.pow(Math.max(0, nx[i] * hx + ny[i] * hy + nz[i] * hz), look.shine), fall = 1 / (1 + 9 * ((x / w - Lx) ** 2 + (y / w - Ly) ** 2));
        // soft-light: 128 leaves the picture alone, above lightens, below darkens
        const lift = (dif - .62) * look.diffuse * 1.4 * fall + sp * look.spec * (.35 + .9 * fall);
        let r = 128 + lift * 255, g = r, b = r;
        if (look.iris) { const c = hue(.62 * (nx[i] * 1.6 + ny[i] * 1.1) + .55 * Lx + .25 * sp), t = look.iris * Math.min(1, sp * 1.7) * (.35 + .65 * fall); r += (c[0] - .5) * 255 * t; g += (c[1] - .5) * 255 * t; b += (c[2] - .5) * 255 * t; }
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = Math.min(255, 255 * a * Math.min(1, amount * 1.6));
      }
      canvas.getContext("2d").putImageData(image, 0, 0);
    }
    return {
      /** x, y: the pointer over the pack (0..1); amount: how far the pointer has eased in (0..1). */
      aim(x, y, amount) { last = { x, y, amount }; if (!surface || frame) return; frame = requestAnimationFrame(() => { frame = 0; if (last) draw(last.x, last.y, last.amount); }); },
      rest() { last = null; cancelAnimationFrame(frame); frame = 0; canvas.style.opacity = 0; canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); requestAnimationFrame(() => { canvas.style.opacity = ""; }); },
    };
  }
  return { attach };
})();
