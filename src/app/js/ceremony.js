/* Ceremonies: opening a Pack (tear -> pull out -> peel the cover -> reveal), opening a Gift (break the seal -> ...), sealing a gift.
   The point: every step is something you do with your hand, and the last one is yours to play with (tilt the sticker). */
const fix = (el, tf) => { el.getAnimations().forEach((a) => a.cancel()); el.style.transform = tf; };
async function closeCommittedPreview(cer,message) {
  try {await Bridge.reload();} catch {}
  Bridge.busy=false;await cer.close();Shell.refresh();Shell.renderNav();Shell.toast(message);
}
const Cer = (() => {
  const RAR_FX = { common: { n: 0, chime: 1 }, uncommon: { n: 16, chime: 3 }, rare: { n: 46, chime: 6 }, special: { n: 60, chime: 7 }, archive: { n: 30, chime: 4 } };

  function overlay(kind) {
    Bridge.enterCeremony();
    const root = h("div.cer", { data: { kind }, tabindex: -1 }), stage = h("div.cer-stage"), top = h("p.cer-hint");
    let skipped=false, skipAction=null, closing=null;
    const waits=new Set();
    const skip=h("button.cer-skip",{type:"button",hidden:true,on:{click:()=>{
      skipped=true;root.dataset.skipped="true";skip.hidden=true;
      for(const a of root.getAnimations({subtree:true})) {try{a.finish();}catch{}}
      for(const done of [...waits])done();
      const action=skipAction;skipAction=null;action?.();
    }}},"Skip ⏭");
    root.append(h("i.cer-bg"), top, stage, skip); $("#overlay").append(root);
    // the window still moves by its top edge while a ceremony covers the title bar
    root.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest("button, a, input, .pk-sheet, .pouch, .bagrig, .wax, .mcard, .env-wrap, .gift-scene")) return;
      if (e.clientY > Math.max(46, $("#titlebar")?.getBoundingClientRect().bottom || 0)) return;
      e.preventDefault(); Bridge.window.startDragging();
    });
    anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 420 });
    const close = ({keepScene=false} = {}) => closing ||= (async()=>{for(const done of [...waits])done();try {await anim(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 320 });} finally {root.remove();document.removeEventListener("keydown", onKey);if(!keepScene) await Bridge.leaveCeremony();}})();
    const onKey = (e) => { if (e.key === "Escape") root._esc && root._esc(); };
    document.addEventListener("keydown", onKey);
    return { root, stage, close, get skipped(){return skipped;},
      allowSkip(action=null){skipAction=action;skip.hidden=skipped;if(skipped)action?.();},
      endSkip(){skip.hidden=true;skipAction=null;},
      motion:(el,frames,opts={})=>anim(el,frames,{...opts,...(skipped?{duration:1,delay:0}: {})}),
      wait:ms=>skipped || reduced()?Promise.resolve():new Promise(resolve=>{const done=()=>{clearTimeout(timer);waits.delete(done);resolve();};const timer=setTimeout(done,ms);waits.add(done);}),
      hint: (t) => { if (top.textContent === t) return; top.textContent = t; anim(top, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 400 }); } };
  }

  function revealTheme(cer, material, rarity, kind="material") {
    Object.assign(cer.root.dataset,{reveal:kind,material,rarity});
  }

  /* After the sleeve is pulled out: unwrap it, reveal the sticker, let the person play with it. */
  async function unwrapAndReveal({ cer, stage, sleeve, entry, source, onKeep, onLater, laterLabel = "Later" }) {
    cer.hint("Tilt it to catch the light.");
    const res = entry.prize ? {aspect:1} : await resOf(entry, { max: 560 }), mat = MAT[entry.material], fx = RAR_FX[entry.rarity || mat.rarity];
    if(cer.root.dataset.kind==="pack") { revealTheme(cer,entry.material,entry.rarity || mat.rarity,"sticker");cer.allowSkip(); }
    const W = stage.clientWidth, Hh = stage.clientHeight;
    const holder = h("div.rv-holder");
    const max = Math.min(280, W * .45, Hh * .4);
    const sw = max * Math.min(1, res.aspect);
    const stk = entry.prize ? PrizeCard(entry,sw) : Stk.el(res, sw); holder.append(stk);
    const glow = h("i.rv-glow", { data: { m: entry.material } }), rays = h("i.rv-rays", { data: { m: entry.material } });
    stage.append(glow, rays, holder); holder.style.opacity = 0;
    // sleeve glides to the middle and gets a little crumpled
    const sr = sleeve.getBoundingClientRect(), st = stage.getBoundingClientRect();
    const cx = st.left + W * .5, cy = st.top + Hh * .44;
    const dx = cx - (sr.left + sr.width / 2), dy = cy - (sr.top + sr.height / 2);
    Snd.swoosh();
    await cer.motion(sleeve, [{ transform: sleeve.style.transform || "none" }, { transform: `translate(${dx}px, ${dy}px) scale(1.1)` }], { duration: 560, easing: EASE.inOut, composite: "replace" });
    Snd.crinkle(18, .55);
    await cer.motion(sleeve, [{ transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(0)` }, { transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(-3deg)` }, { transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(3deg)` }, { transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(-2deg)` }, { transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(0)` }], { duration: 480, easing: "ease-in-out" });
    // pop
    Snd.chime(fx.chime, 880);
    anim(sleeve, [{ opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(1.1)` }, { opacity: 0, transform: `translate(${dx}px, ${dy - 20}px) scale(1.42) rotate(6deg)` }], { duration: 480, easing: EASE.out });
    anim(glow, [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: "scale(1)" }], { duration: 900, easing: EASE.out });
    if (entry.material !== "matte") anim(rays, [{ opacity: 0, transform: "scale(.5) rotate(0)" }, { opacity: .9, transform: "scale(1) rotate(40deg)" }], { duration: 1200, easing: EASE.out });
    if (fx.n && !cer.skipped && !reduced()) sparkBurst(stage, fx.n, { cx: .5, cy: .44, power: (entry.rarity || mat.rarity) === "rare" ? 1.5 : 1, colors: entry.material === "kraft" ? ["#f2d9a8", "#fff", "#e8bf80"] : undefined });
    await cer.motion(holder, [{ opacity: 0, transform: "scale(.5) rotate(-12deg)" }, { opacity: 1, transform: "scale(1.06) rotate(2deg)", offset: .6 }, { opacity: 1, transform: "scale(1) rotate(0)" }], { duration: 760, easing: EASE.out });
    sleeve.remove();
    holder.style.opacity = 1; holder.getAnimations().forEach((a) => a.cancel());
    // alive: tilt + sheen
    const tilter = h("div.rv-tilt", stk); holder.append(tilter); Stk.tilt(tilter, { max:5, scale:1.015, trigger:holder });
    cer.hint("Tilt it to catch the light.");
    // who/what is it
    const info = h("div.rv-info", h("p.eyebrow", source), h("h2", titleOf(entry)),
      h("div.rv-meta", h("span.seal.stamp-in", { data: { rarity: entry.rarity || mat.rarity } }, mat.name + " · " + (entry.rarity || mat.rarity)), h("span.no", entry.kind === "received" && entry.edition != null ? `Edition #${entry.edition}${entry.editionTotal ? "/"+entry.editionTotal : ""}` : "")),
      h("div.rv-btns", h("button.btn.keep", { on: { click: () => { Snd.tap(); onKeep(); } } }, entry.prize ? "Done" : "Stick it"), onLater ? h("button.btn.paper", { on: { click: onLater } }, laterLabel) : null));
    stage.append(info);
    anim(info, [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: 520, easing: EASE.out });
    const seal = $(".seal", info); await cer.wait(260); Snd.seal();
    await cer.motion(seal, [{ opacity: 0, transform: "scale(2.4) rotate(-14deg)" }, { opacity: 1, transform: "scale(1) rotate(-2.5deg)" }], { duration: 360, easing: EASE.spring });cer.endSkip();
  }

  /* ------------------------------------------------------------------ THE DESK (one pack)
     One pack is opened on a desk under one lamp. The room darkens around what is held, and the pull's light lands on the desk:
     a pool for every rarity, spectral streaks that follow the tilt (rare), gold leaf (special), dust in the beam (archive).
     The light is only ever the pull's own, and only once the pull is committed. */
  const DESK = {
    common: { light: "255,247,232", tint: "18,14,10", dim: .55, hold: 0 },
    uncommon: { light: "255,200,140", tint: "22,14,6", dim: .6, hold: 200 },
    rare: { light: "214,206,255", tint: "12,10,20", dim: .72, hold: 520 },
    special: { light: "255,205,112", tint: "24,14,4", dim: .78, hold: 780 },
    archive: { light: "226,190,138", tint: "26,18,10", dim: .74, hold: 640 },
  };
  const rarityOf = (e) => DESK[e?.rarity] ? e.rarity : DESK[MAT[e?.material]?.rarity] ? MAT[e.material].rarity : "common";
  const curve = { out: (t) => 1 - Math.pow(1 - t, 3), inOut: (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, outBack: (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2) };
  /** Too narrow to put the words beside the sheet: then the pack is set aside above, and the words go below. */
  const narrow = (stage) => stage.clientWidth < 560;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  /** A damped spring. With reduced motion (or a skipped ceremony) it is simply where it is going. */
  class Spring {
    constructor(x = 0, k = 170, c = 24) { this.x = this.t = x; this.v = 0; this.k = k; this.c = c; }
    to(t, k, c) { this.t = t; if (k) this.k = k; if (c) this.c = c; return this; }
    set(x) { this.x = this.t = x; this.v = 0; }
    step(dt, snap = false) {
      if (snap || reduced()) { this.x = this.t; this.v = 0; return; }
      const n = Math.max(1, Math.ceil(dt / .004)), s = dt / n;
      for (let i = 0; i < n; i++) { this.v += (-this.k * (this.x - this.t) - this.c * this.v) * s; this.x += this.v * s; }
    }
    get rest() { return Math.abs(this.x - this.t) < .05 && Math.abs(this.v) < .05; }
  }
  /** fn(dt) on every frame while the ceremony is on screen, until it returns false. */
  function frames(cer, fn) {
    let last = performance.now();
    const f = (now) => { if (!cer.root.isConnected) return; const dt = Math.min(.05, Math.max(0, now - last) / 1000); last = now; if (fn(dt, now) !== false) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }
  /** fn(eased, linear) over `ms`; at once when the ceremony is skipped or motion is reduced. */
  function tween(cer, ms, fn, e = curve.out) {
    if (cer.skipped || reduced()) { fn(1, 1); return Promise.resolve(); }
    return new Promise((res) => { let t = 0; frames(cer, (dt) => { t += dt * 1000; const p = cer.skipped ? 1 : clamp(t / ms, 0, 1); fn(e(p), p); if (p >= 1) { res(); return false; } }); });
  }

  /** The desk of one ceremony: a lamp over the room and two canvases of light, one under the objects and one over them. Coordinates are viewport pixels. */
  function deskFor(cer) {
    if (cer.desk) return cer.desk;
    const root = cer.root, lampEl = h("i.cer-lamp"), under = h("canvas.cer-fx.under"), over = h("canvas.cer-fx.over");
    root.dataset.look = "desk"; $(".cer-bg", root).after(lampEl, under); cer.stage.after(over);
    const tilt = { x: 0, y: 0 }; let sys = [], w = 1, hh = 1, running = false, cu = null, co = null;
    const size = () => {
      const r = root.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); w = Math.max(1, r.width); hh = Math.max(1, r.height);
      for (const c of [under, over]) { c.width = w * d; c.height = hh * d; c.getContext("2d")?.setTransform(d, 0, 0, d, 0, 0); }
      cu = under.getContext("2d"); co = over.getContext("2d");
    };
    size(); new ResizeObserver(size).observe(root);
    const rel = (x, y) => { const r = root.getBoundingClientRect(); return [x - r.left, y - r.top]; };
    const run = () => {
      if (running || !cu || !co) return; running = true;
      frames(cer, (dt) => {
        cu.clearRect(0, 0, w, hh); co.clearRect(0, 0, w, hh);
        sys = sys.filter((s) => {
          s.t += dt; let k = 1; if (s.out) { s.out.t += dt * 1000; k = 1 - s.out.t / s.out.ms; if (k <= 0) return false; }
          const c = s.over ? co : cu; c.save(); c.globalAlpha = k; const alive = s.draw(c, dt, s.t); c.restore(); return alive !== false;
        });
        if (!sys.length) { running = false; return false; }
      });
    };
    const add = (s) => { if (s.decor && reduced()) return s; s.t ??= 0; sys.push(s); run(); return s; };
    const rgba = (rgb, a) => `rgba(${rgb},${a})`;
    /* a pool of light under whatever was revealed: it swells, then rests */
    const pool = (x, y, r, rgb, peak = .9, rest = .45) => add({ t: reduced() ? 2 : 0, draw(c, dt, t) {
      const a = t < .5 ? lerp(0, peak, curve.out(t / .5)) : lerp(peak, rest, smooth(.5, 1.6, t)), rr = r * (t < .5 ? lerp(.6, 1, curve.out(t / .5)) : 1);
      const g = c.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, rgba(rgb, a)); g.addColorStop(.55, rgba(rgb, a * .35)); g.addColorStop(1, rgba(rgb, 0));
      c.fillStyle = g; c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    } });
    /* light split by the foil: spectral streaks falling away from the lamp, moving with the tilt of what is held, like real reflections */
    const prism = (x, y, r) => {
      const st = [[.35, .78, 1], [.62, .7, .8], [.9, .74, .9], [1.15, .82, .7], [-2.6, .8, .55]].map(([a, d, k]) => ({ a, d: r * d, len: r * .2 * k, w: 13 * k + 5, ph: Math.random() * 6 }));
      const hues = ["255,70,140", "255,180,60", "90,230,140", "70,160,255", "170,100,255"];
      add({ decor: true, draw(c, dt, t) {
        const fin = smooth(.1, 1, t); c.globalCompositeOperation = "lighter";
        for (const s of st) {
          const a = s.a - tilt.x * .45 + Math.sin(t * .45 + s.ph) * .03, d = s.d * (1 - tilt.y * .14);
          c.save(); c.translate(x + Math.cos(a) * d, y + Math.sin(a) * d * .72); c.rotate(a + Math.PI / 2 - tilt.x * .25); c.filter = "blur(2.5px)";
          const g = c.createLinearGradient(-s.w, 0, s.w, 0);
          hues.forEach((col, k) => g.addColorStop(.1 + k * .2, `rgba(${col},${.42 * fin * (.75 + .25 * Math.sin(t * 1.1 + s.ph))})`));
          g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0)");
          c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, s.w, s.len, 0, 0, Math.PI * 2); c.fill(); c.restore();
        }
      } });
    };
    /* gold leaf falling slowly through the lamp light */
    const goldLeaf = (x, y, s) => {
      const fl = Array.from({ length: 16 }, () => ({ x: x + (Math.random() - .5) * s * 1.5, y: y - Math.random() * s * .8 - 30, vy: 12 + Math.random() * 16, sw: Math.random() * 6, s: 1.6 + Math.random() * 2.6, ph: Math.random() * 6, rot: Math.random() * 6 }));
      add({ decor: true, over: true, draw(c, dt, t) {
        for (const f of fl) {
          f.y += f.vy * dt; f.ph += dt * (2 + f.sw * .2); f.rot += dt; const sx = Math.cos(f.ph), a = smooth(0, .4, t) * (1 - smooth(4.5, 6, t)), glint = Math.pow(Math.abs(sx), 6);
          c.save(); c.translate(f.x + Math.sin(f.ph * .7) * 10, f.y); c.rotate(f.rot); c.scale(Math.max(.15, Math.abs(sx)), 1);
          c.fillStyle = `hsla(43,${72 + 18 * Math.abs(sx)}%,${46 + 36 * Math.abs(sx) + glint * 12}%,${a * (.7 + .3 * glint)})`; c.fillRect(-f.s * 1.4, -f.s * .55, f.s * 2.8, f.s * 1.1); c.restore();
        }
        return t < 6;
      } });
    };
    /* dust in the beam, for the archive */
    const dust = (x, y, r) => {
      const ms = Array.from({ length: 40 }, () => ({ x: x + (Math.random() - .5) * r * 2, y: y + (Math.random() - .5) * r * 1.4, vx: (Math.random() - .5) * 6, vy: -3 - Math.random() * 6, s: .6 + Math.random() * 1.6, p: Math.random() * 6 }));
      add({ decor: true, over: true, draw(c, dt, t) {
        for (const m of ms) { m.x += m.vx * dt; m.y += m.vy * dt; m.p += dt; c.fillStyle = `rgba(255,236,200,${(.25 + .25 * Math.sin(m.p * 1.7)) * smooth(0, 1, t)})`; c.beginPath(); c.arc(m.x, m.y, m.s, 0, Math.PI * 2); c.fill(); }
      } });
    };
    return cer.desk = {
      tilt,
      /** Darken the room around (x, y): `alpha` is how dark the edge gets; the lamp's rim takes the pull's tint. */
      lamp(alpha, x, y, rarity = "common", inner = 16, outer = 74) {
        const [lx, ly] = rel(x, y), D = DESK[rarity] || DESK.common;
        for (const [k, v] of [["--lx", lx / w * 100 + "%"], ["--ly", ly / hh * 100 + "%"], ["--lr1", inner + "%"], ["--lr2", outer + "%"], ["--tint", D.tint], ["--la", Math.min(.97, alpha * 1.28).toFixed(3)]]) lampEl.style.setProperty(k, v);
        lampEl.style.opacity = alpha > 0 ? 1 : 0; root.dataset.dim = String(alpha > .3);
      },
      /** The light that belongs to a rarity, centred on (x, y) for an object `s` pixels wide. */
      bloom(rarity, x, y, s) {
        const [px, py] = rel(x, y), D = DESK[rarity] || DESK.common;
        pool(px, py, s * (rarity === "common" ? .75 : rarity === "uncommon" ? .95 : 1.2), D.light, rarity === "common" ? .5 : .85, rarity === "common" ? .28 : .42);
        if (rarity === "rare") prism(px, py, s * .95);
        if (rarity === "special") { pool(px, py, s * 1.9, "255,190,90", .35, .2); goldLeaf(px, py, s); }
        if (rarity === "archive") dust(px, py, s);
      },
      /** Flecks from a tear: rainbow foil, or bits of paper of the colour `rgb`. */
      flecks(x, y, n, rgb = null) {
        const [px, py] = rel(x, y), ps = Array.from({ length: n }, () => ({ x: px, y: py, vx: (Math.random() - .3) * 120, vy: -60 - Math.random() * 90, s: 1 + Math.random() * 2.2, life: .5 + Math.random() * .5, hue: Math.random() * 360 }));
        add({ decor: true, over: true, draw(c, dt, t) {
          let alive = false;
          for (const p of ps) { if (t > p.life) continue; alive = true; p.vy += 320 * dt; p.x += p.vx * dt; p.y += p.vy * dt; c.fillStyle = rgb ? rgba(rgb, 1 - t / p.life) : `hsla(${p.hue},80%,82%,${1 - t / p.life})`; c.fillRect(p.x, p.y, p.s, p.s); }
          return alive;
        } });
      },
      fade(ms = 700) { for (const s of sys) s.out = { t: 0, ms }; },
    };
  }

  /* ------------------------------------------------------------------ PACK
     The pouch is torn along its top by hand. The torn piece lifts and curls in two parts as the tear runs, the edge is jagged and bows
     open, and the lining of the mouth shows. Torn through, the strip flies off with the hand's speed and stays on the desk. */
  const MOUTH = { holo: ["#e9ebee", "#a7acb3", "#5d636b"], kraft: ["#d9bb8c", "#a98457", "#6e5232"], matte: ["#f6f2ea", "#d2cbbe", "#8f877a"] };
  const FLECK = { holo: null, kraft: "201,170,120", matte: "236,231,220" };
  /* One tearable pouch. `content` sits inside, behind the front; `onTear(rig)` runs once, the moment the top is torn off. */
  function buildRig(cer, stage, { kind, hue, color, content, onTear, label, decoration }) {
    const desk = deskFor(cer), k = PACK_KINDS[kind] ? kind : "holo", K = PACK_KINDS[k];
    const PW = Math.min(310, stage.clientHeight * .48, stage.clientWidth * .55), PH = PW * 4 / 3, C = K.cut / 100, colorFilter = packColorFilter(kind, color);
    const tint = colorFilter !== "none" ? ".pack-colored" : K.foil && hue ? ".tinted" : "";
    // the torn pieces are drawn from the same art, so they take the same colour as the pouch
    const tintFilter = colorFilter !== "none" ? colorFilter + " " : tint ? `sepia(.55) saturate(1.9) hue-rotate(${(hue || 0) - 40}deg) brightness(1.03) ` : "";
    const mk = (cls) => h("div.pk-layer." + cls + tint, { style: { "--pack-filter": colorFilter, "--hue": (hue || 0) + "deg" } }, PackPaper(kind, color), K.foil ? h("i.sheen") : null);
    const body = mk("pk-body"), attached = mk("pk-attached"), free = h("div.pk-free"), segA = h("i.pk-seg"), segB = h("i.pk-seg");
    const mouth = h("i.pk-mouth", { style: { "--m1": MOUTH[k][0], "--m2": MOUTH[k][1], "--m3": MOUTH[k][2] } }), leak = h("i.pk-leak", { style: { top: PH * (C - .16) + "px" } });
    const tearMark = h("i.pk-tear", { style: { left: PW * .04 + "px", top: PH * (C - .085) + "px" } }, "tear");
    if (decoration) { body.append(decoration); attached.append(decoration.cloneNode(true)); }
    free.append(segA, segB);
    const pouch = h("div.pouch", { data: { kind: k }, style: { width: PW + "px", height: PH + "px", "--pk": packVar(kind), "--cut": C * 100 + "%" } }, mouth, leak, content, body, label || null, attached, free, tearMark);
    const wrapper = h("div.pk-wrap", pouch); stage.append(wrapper);
    const portrait = () => narrow(stage);
    { const st = stage.getBoundingClientRect(); desk.lamp(.4, st.left + st.width / 2, st.top + st.height * .46, "common", 20, 80); }
    // a jagged line for the torn edge, fixed per pack
    const jag = Array.from({ length: 41 }, (_, i) => (i % 2 ? 1 : -1) * (.004 + Math.random() * .007) + (Math.random() - .5) * .004);
    const Y = new Spring(stage.clientHeight * .7, 130, 16).to(0), ROT = new Spring(-10, 130, 15).to(-1), LIFT = new Spring(0, 240, 26), UP = new Spring(0, 200, 24);
    let p = 0, laid = 0, state = "tear", grab = null, tearing = false, stripGone = false, sheetFree = false, leakK = .55, painted = "", fling = { vx: .6, vy: -.6 };
    const rig = { K, PW, PH, cutY: PH * C, pouch, wrapper, content, done: false };
    const pct = (v) => (v * 100).toFixed(2) + "%";
    const piece = (el, x0, pw, hgt, transform, turn, pts) => {
      const inRange = pts.filter(([a]) => a * PW >= x0 - 1 && a * PW <= x0 + pw + 1).map(([a, b]) => `${((a * PW - x0) / Math.max(1, pw) * 100).toFixed(1)}% ${(b * PH / hgt * 100).toFixed(1)}%`);
      Object.assign(el.style, { left: x0 + "px", width: pw + "px", height: hgt + "px", backgroundSize: `${PW}px ${PH}px`, backgroundPosition: `${-x0}px 0`, transform, filter: `${tintFilter}brightness(${(1.04 - turn / 220).toFixed(3)})`,
        clipPath: inRange.length > 1 ? `polygon(0 0, 100% 0, ${inRange.reverse().join(",")})` : `polygon(0 0, 100% 0, 100% ${pct(C * PH / hgt)}, 0 ${pct(C * PH / hgt)})` });
    };
    /* the torn edge is jagged from the left up to the tear, straight beyond it; the torn piece is two parts hinged at the tear point: the near one
       lifts, the far one bends a little more, and a soft shadow falls under them */
    const paintTear = () => {
      const n = jag.length - 1, upto = Math.round(p * n), pts = [];
      const bow = (x) => .026 * Math.sin(Math.PI * clamp(x / Math.max(p, .001), 0, 1)) * smooth(0, .5, p) * (stripGone ? 1.2 : 1);
      for (let i = 0; i <= upto; i++) pts.push([i / n, C + jag[i] + bow(i / n)]);
      body.style.clipPath = `polygon(${[...pts, [p, C], [1, C]].map(([a, b]) => `${pct(a)} ${pct(b)}`).join(",")}, 100% 100%, 0 100%)`;
      attached.style.clipPath = `polygon(${pct(p)} 0, 100% 0, 100% ${pct(C)}, ${pct(p)} ${pct(C)})`;
      free.hidden = stripGone || p <= .002;
      if (!free.hidden) {
        const hgt = C * PH + PH * .03, len = p * PW, near = len * .55, far = len - near, lift = Math.min(34, p * 58), bend = Math.min(26, p * 44);
        piece(segA, len - near, near, hgt, `rotate(${lift}deg)`, lift, pts);
        piece(segB, 0, far, hgt, `translate(${near}px, 0) rotate(${lift}deg) translate(${-near}px, 0) rotate(${bend}deg)`, lift + bend, pts);
      }
      const open = smooth(.05, .9, p) * (stripGone ? 1 : .9);
      mouth.style.opacity = open; tearMark.style.opacity = p > .02 || state !== "tear" ? 0 : 1;
      return open;
    };
    frames(cer, (dt) => {
      for (const s of [Y, ROT, LIFT, UP]) s.step(dt);
      const pt = portrait(), L = laid;
      wrapper.style.transform = `translate(${L * (pt ? -PW * .62 : -PW * 1.45)}px, ${Y.x + LIFT.x + L * PH * (pt ? -.5 : .24)}px) rotate(${ROT.x - L * 16}deg) scale(${1 - L * (pt ? .5 : .3)})`;
      pouch.style.setProperty("--z", (Math.max(0, -LIFT.x) / 30).toFixed(3));
      const key = p + "|" + stripGone + "|" + state;
      if (key !== painted) { painted = key; rig.open = paintTear(); }
      leak.style.opacity = (sheetFree ? 0 : UP.x > 1 ? .95 : (rig.open || 0) * .75) * leakK;
      if (!sheetFree && content) content.style.transform = `translateY(${-UP.x}px)`;
    });
    Snd.crinkle(4, .35); cer.wait(560).then(() => Snd.land());
    // the foil / paper catches the light wherever the pointer is on the stage
    onPointerFollow(stage, (x, y, e, amount) => { pouch.style.setProperty("--sx", lerp(30, (1 - x) * 100, amount) + "%"); pouch.style.setProperty("--sy", lerp(30, (1 - y) * 100, amount) + "%"); }, () => { pouch.style.setProperty("--sx", "30%"); pouch.style.setProperty("--sy", "30%"); });
    const fleck = () => { const r = pouch.getBoundingClientRect(); desk.flecks(r.left + p * r.width, r.top + C * r.height, 3, FLECK[k]); };
    let p0 = 0, lastP = 0, lastT = 0, peekH = 0, needH = 0, onPull = null, mv = null, rustle = Snd.paperMotion();
    drag(pouch, {
      down: (e) => {
        const r = pouch.getBoundingClientRect(), fy = (e.clientY - r.top) / r.height; mv = { x: e.clientX, y: e.clientY, t: performance.now() };
        if (state === "tear" && fy < C + .14) { grab = "tear"; p0 = lastP = p; lastT = performance.now(); pouch.classList.add("pulling"); return; }
        if (state === "pull" && fy < .5) { grab = "pull"; rustle = Snd.paperMotion(); pouch.classList.add("pulling"); return; }
        return false;
      },
      move: (dx, dy, e) => {
        const now = performance.now(), mdt = Math.max(1, now - mv.t); fling = { vx: (e.clientX - mv.x) / mdt, vy: (e.clientY - mv.y) / mdt }; mv = { x: e.clientX, y: e.clientY, t: now };
        if (grab === "tear") {
          const np = clamp(p0 + (dx - dy * .25) / (PW * .95), p, 1), dp = np - lastP;
          if (dp > .004) { Snd.grain(clamp(dp / Math.max(1, now - lastT) * 400, 0, 1)); lastP = np; lastT = now; if (Math.random() < .5) fleck(); }
          for (const mark of [1 / 3, 2 / 3]) if (p < mark && np >= mark) Haptic.tap("align");
          p = np; LIFT.to(-Math.min(dx, 60) * .1);
          if (p >= 1) { grab = null; finish(); }
        } else if (grab === "pull") {
          const up = Math.max(0, -dy); UP.set(peekH + up * .92); LIFT.to(-Math.min(up, 60) * .25); rustle(up / PH);
          if (peekH + up * .92 > needH) { grab = null; release(); }
        }
      },
      up: () => {
        pouch.classList.remove("pulling");
        if (grab === "tear") { grab = null; LIFT.to(0); if (p > .72) autoTear(); }
        else if (grab === "pull") { grab = null; if (!sheetFree) { UP.to(peekH); LIFT.to(0); } }
      },
    });
    const autoTear = async () => {
      if (tearing || stripGone) return; tearing = true; state = null; const from = p;
      await tween(cer, 260 + (1 - from) * 500, (e) => { p = lerp(from, 1, e); if (Math.random() < .5) { Snd.grain(.6); fleck(); } }, curve.inOut);
      finish();
    };
    /* the strip keeps flying with the hand's speed, then rests on the desk */
    const fly = () => {
      const st = stage.getBoundingClientRect(), r = pouch.getBoundingClientRect(), hgt = C * PH, pt = portrait();
      const strip = h("i.pk-strip", { style: { width: PW + "px", height: hgt + "px", backgroundSize: `${PW}px ${PH}px`, "--pk": packVar(kind), filter: `${tintFilter}drop-shadow(2px 4px 4px rgba(30,20,10,.3))`,
        clipPath: `polygon(0 0,100% 0,100% 100%,${jag.map((j, i) => `${(i / (jag.length - 1) * 100).toFixed(1)}% ${((C + j) / C * 100).toFixed(1)}%`).reverse().join(",")})` } });
      stage.prepend(strip);
      let x = r.left - st.left, y = r.top - st.top, vx = clamp(fling.vx * 700, 140, 620), vy = clamp(fling.vy * 700, -520, -220), a = -6, va = 70;
      const floor = Math.min(st.height - hgt - 24, r.top - st.top + PH * .9), right = st.width - PW * .95;
      const put = () => { strip.style.transform = `translate(${x}px, ${y}px) rotate(${a % 360}deg) scale(.82)`; };
      if (pt) { const fx = x, fy = y, to = [st.width - PW * .9, -hgt * .2]; tween(cer, 700, (e) => { x = lerp(fx, to[0], e); y = lerp(fy, to[1], e) - Math.sin(e * Math.PI) * 40; a = lerp(-6, 8, e); put(); }).then(() => Snd.land()); return; }
      if (reduced()) { x = right; y = floor; a = 9; put(); return; }
      frames(cer, (dt) => {
        vy += 1500 * dt; x += vx * dt; y += vy * dt; a += va * dt;
        if (x > right) { x = right; vx = -vx * .3; }
        if (y > floor) { y = floor; vy = -vy * .22; vx *= .55; va = (Math.round(a / 180) * 180 + 9 - a) * 3; if (Math.abs(vy) < 40) { put(); Snd.land(); return false; } }
        put();
      });
    };
    const finish = async () => {
      if (rig.done) return; rig.done = true; stripGone = true; state = null; p = 1;
      pouch.classList.remove("pulling"); pouch.classList.add("torn"); LIFT.to(0); cer.hint(""); Snd.rip(); Haptic.tap("seal"); fly();
      await sleep(180); await onTear(rig);
    };
    const release = () => {
      if (sheetFree) return; sheetFree = true; state = null; Snd.swoosh(); Haptic.tap("level");
      LIFT.to(0); onPull?.();
    };
    const pullOut = () => { if (state !== "pull") return; state = null; UP.to(needH * 1.1, 150, 20); frames(cer, () => { if (UP.x > needH) { release(); return false; } }); };
    const advance = () => state === "tear" ? autoTear() : pullOut();
    pouch.tabIndex = 0; pouch.setAttribute("aria-label", "Tear the pack open");
    pouch.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) advance(); } }); pouch.addEventListener("dblclick", advance);
    rig.focus = () => pouch.focus({ preventScroll: true });
    /** The colour leaking from the mouth is the pull's own; until the pull is committed it is plain lamp light. */
    rig.light = (entry) => { const r = rarityOf(entry); leak.style.setProperty("--light", DESK[r].light); leak.classList.toggle("prism", r === "rare"); leakK = r === "common" ? .55 : 1; };
    /** The emptied pouch stays on the desk, laid aside. It is part of the picture, not something that disappears. */
    rig.linger = () => tween(cer, 850, (e) => { laid = e; }, curve.inOut);
    /** What is inside peeks out of the mouth, and comes out when it is pulled up far enough (or on Enter / double-click). */
    rig.pullable = async (el, { onPull: pulled }) => {
      const sh = el.getBoundingClientRect().height || PW * .87; peekH = sh * .26; needH = sh * .82; onPull = pulled;
      await cer.wait(240); Snd.crinkle(3, .2); UP.to(peekH, 150, 18); await cer.wait(460);
      state = "pull"; pouch.setAttribute("aria-label", "Pull the sheet out");
    };
    return rig;
  }

  /* The same rig for a wrapping that is not a pouch (a Studio pack): the picture of the wrapping stands where the pouch stood, the sheet
     sits behind it, and opening is a tap, a drag, or Enter (there is no top to tear). It gives the same things back (PW, PH, cutY, pullable,
     linger), measured on the object's own box, so the rest of the opening does not care which one it is. */
  function buildBagRig(cer, stage, { pack, content, onTear, cover }) {
    const desk = deskFor(cer), bag = BAGS[pack.bag], [x0, y0, x1, y1] = bag.body, bw = x1 - x0, bh = y1 - y0, ratio = (bh * bag.H) / (bw * bag.W);
    let PW = Math.min(300, stage.clientWidth * .5); if (PW * ratio > stage.clientHeight * .5) PW = stage.clientHeight * .5 / ratio;
    const PH = PW * ratio, picW = PW / (bw / 100), picH = picW * bag.H / bag.W;
    const pic = BagPic({ bag: pack.bag, color: pack.color, title: pack.title, sub: "by " + pack.by, cover, deco: pack.deco || "none", layout: pack.layout, fit: PW, k: 99, id: pack.id });
    Object.assign(pic.style, { position: "absolute", left: -(x0 / 100) * picW + "px", top: -(y0 / 100) * picH + "px", zIndex: 4 });
    const pouch = h("div.bagrig", { style: { width: PW + "px", height: PH + "px" }, tabIndex: 0, role: "button", "aria-label": "Open the pack" }, content, pic);
    const wrapper = h("div.pk-wrap", pouch); stage.append(wrapper);
    { const st = stage.getBoundingClientRect(); desk.lamp(.4, st.left + st.width / 2, st.top + st.height * .46, "common", 20, 80); }
    anim(wrapper, [{ opacity: 0, transform: "translateY(60px) rotate(8deg) scale(.86)" }, { opacity: 1, transform: "none" }], { duration: 720, easing: EASE.spring });
    // the sheet sits inside the object's own box, so a flat envelope never has it hanging out of its bottom
    const sw = Math.min(PW * .72, PH * .68 / 1.24), rig = { PW, PH, cutY: PH * .18, pouch, wrapper, content, done: false, prog: 0, sheetW: sw, sheetLeft: (PW - sw) / 2, sheetTop: PH * .12 };
    const finish = async () => {
      if (rig.done) return; rig.done = true; cer.hint(""); Snd.crinkle(4, .25);
      if (!reduced()) await pic.animate([{ transform: "none" }, { transform: "translateY(-5px) rotate(-1.4deg) scale(1.025)", offset: .4 }, { transform: "none" }], { duration: 420, easing: "ease-out" }).finished;
      Snd.swoosh(); await onTear(rig);
    };
    drag(pouch, { down: () => { if (rig.done) return false; }, move: (dx, dy) => { if (!rig.done && Math.hypot(dx, dy) > 16) finish(); }, up: (e, moved) => { if (!moved && !rig.done) finish(); } });
    pouch.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && finish());
    rig.focus = () => pouch.focus({ preventScroll: true });
    rig.linger = () => anim(pouch, [{ transform: "none" }, { transform: `translate(${-PW * 1.3}px, ${PH * .34}px) rotate(-13deg) scale(.68)` }], { duration: 850, easing: EASE.inOut, delay: 100 });
    rig.pullable = async (el, { rise = .5, need = .5, onPull }) => {
      let pulled = false, rustle = Snd.paperMotion(); const base = `translateY(${-PH * rise}px) rotate(-1.5deg)`;
      await anim(el, [{ transform: "none" }, { transform: base }], { duration: 760, easing: EASE.out }); fix(el, base);
      drag(el, {
        down: () => { if (pulled) return false; rustle = Snd.paperMotion(); },
        move: (dx, dy) => { const up = clamp(-dy, 0, PH * .8), rb = up > PH * .5 ? PH * .5 + (up - PH * .5) * .3 : up; el.style.transform = `translateY(${-PH * rise - rb}px) rotate(${-1.5 + dx * .03}deg)`; rustle(up / PH); if (up > PH * need && !pulled) go(); },
        up: () => { if (!pulled) anim(el, [{ transform: el.style.transform }, { transform: base }], { duration: 300, easing: EASE.spring }).then(() => fix(el, base)); },
      });
      const go = () => { if (pulled) return; pulled = true; el.style.cursor = "default"; Snd.swoosh(); Haptic.tap("level"); onPull(); };
      el.addEventListener("dblclick", go); el.tabIndex = 0; el.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && go());
    };
    return rig;
  }

  /* What is inside a pack: one sticker on its backing card, under a glassine cover. Through the cover its colours and shape are the real
     sticker's; the cover is peeled off to see it. It is built at the size it is revealed at and shrunk into the pack, so it stays sharp. */
  function packSheet(cer, pack) {
    const st = cer.stage, portrait = narrow(st);
    const W = Math.round(Math.min(portrait ? st.clientWidth * .56 : st.clientWidth * .32, st.clientHeight * (portrait ? .4 : .62) / 1.24, 300)), H = W * 1.24;
    const stk = h("div.ps-stk"), ed = h("div.ps-ed"), glass = h("div.ps-glass"), gflap = h("div.ps-gflap"), flapwrap = h("div.ps-flapwrap", gflap);
    const el = h("div.pk-sheet", { style: { width: W + "px", height: H + "px", "--w": W + "px" } }, h("i.ps-shadow"), h("i.ps-backing"),
      h("div.ps-print", h("span", "Peta · " + pack.title), pack.by ? h("span", "by " + pack.by) : null), stk, ed, glass, flapwrap);
    const slot = h("div.pk-sheet-slot", el);
    return { el, slot, stk, ed, glass, gflap, flapwrap, w: W, h: H,
      /** sit inside the rig's mouth, at the rig's scale */
      place(rig, into = slot) {
        const sw = rig.sheetW || rig.PW * .7, k = sw / W;
        Object.assign(into.style, { width: sw + "px", height: H * k + "px", left: (rig.sheetLeft ?? (rig.PW - sw) / 2) + "px", top: (rig.sheetTop ?? rig.cutY + rig.PH * .02) + "px" });
        el.style.transform = `scale(${k})`;
      },
      /** the pulled sticker (or prize) goes on the backing, with its edition stamped once it is uncovered */
      async fill(entry) {
        if (entry.prize) stk.append(PrizeCard(entry, W * .62));
        else { const res = await resOf(entry); stk.append(Stk.el(res, Math.min(W * .78, H * .64 * res.aspect))); }
        if (entry.edition != null) ed.textContent = `No. ${String(entry.edition).padStart(2, "0")}${entry.editionTotal ? " / " + entry.editionTotal : ""}`; else ed.remove();
      },
      /** a pull whose picture could not load is still in the Collection */
      missing() { stk.replaceChildren(h("span.ps-missing", "Saved to Collection")); ed.remove(); },
    };
  }

  /** Springs that carry a sheet across the desk. It leaves the pack where it is, at its own size; (x, y) are stage pixels of its centre. */
  function carry(cer, stage, sh) {
    const st = stage.getBoundingClientRect(), r = sh.el.getBoundingClientRect(), W = sh.w, H = sh.h;
    const x0 = r.left - st.left + r.width / 2, y0 = r.top - st.top + r.height / 2, k0 = r.width / W;
    stage.append(sh.el);
    Object.assign(sh.el.style, { left: x0 - W / 2 + "px", top: y0 - H / 2 + "px", transformOrigin: "50% 50%", transform: `scale(${k0})`, zIndex: 8 });
    const c = { sh, lift: 0, X: new Spring(x0, 120, 18), Y: new Spring(y0, 120, 18), K: new Spring(k0, 120, 18), RZ: new Spring(-2, 120, 18), TX: new Spring(0, 90, 16), TY: new Spring(0, 90, 16), tilt: null };
    c.to = (x, y, k = 1, rz = 1.2, sk = 120, sc = 18) => { c.X.to(x, sk, sc); c.Y.to(y, sk, sc); c.K.to(k, sk, sc); c.RZ.to(rz, sk, sc); };
    c.at = () => { const s = stage.getBoundingClientRect(); return [s.left + c.X.t, s.top + c.Y.t]; };
    const face = () => $(".stk", sh.stk);
    frames(cer, (dt) => {
      if (!sh.el.isConnected) return false;
      for (const s of [c.X, c.Y, c.K, c.RZ, c.TX, c.TY]) s.step(dt, cer.skipped);
      sh.el.style.transform = `translate(${c.X.x - x0}px, ${c.Y.x - y0}px) scale(${c.K.x}) rotate(${c.RZ.x}deg) rotateX(${c.TY.x * -6}deg) rotateY(${c.TX.x * 8}deg)`;
      sh.stk.style.transform = `translate(calc(-50% + ${c.TX.x * 4}px), calc(-50% + ${c.TY.x * 4 - c.lift * 4}px)) scale(${1 + c.lift * .03})`; sh.stk.style.setProperty("--lift", c.lift.toFixed(3));
      const f = face(); if (f) { f.style.setProperty("--sx", 50 - c.TX.x * 45 + "%"); f.style.setProperty("--sy", 50 - c.TY.x * 45 + "%"); }
      if (c.tilt) { c.tilt.x = c.TX.x; c.tilt.y = c.TY.x; }
    });
    return c;
  }

  /* The cover is peeled back by its corner: the fold line is the perpendicular bisector between the corner and the finger. Past a third it
     comes off by itself; Enter or a double-click peels it at once. `done` resolves once it is off. */
  function peel(cer, sh, hold = 0) {
    const W = sh.w, H = sh.h; let P = { x: W - 18, y: H - 18 }, grabbed = false, finished = false, settling = false, breathe = 0, crossed = false, off = { x: 0, y: 0 }, end, resolve;
    const done = new Promise((r) => { resolve = r; });
    const area = (poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
    const clip = (poly, keep) => { const out = []; for (let i = 0; i < poly.length; i++) { const A = poly[i], B = poly[(i + 1) % poly.length], fa = keep(A), fb = keep(B); if (fa >= 0) out.push(A); if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); } } return out; };
    const rect = [[0, 0], [W, 0], [W, H], [0, H]], corner = [W, H];
    // the turned-back flap reaches past the sheet's edge, so its box is three sheets wide and tall, centred on the sheet
    const pc = (pts, dx = 0, dy = 0) => pts.length > 2 ? `polygon(${pts.map(([a, b]) => `${(a + dx).toFixed(1)}px ${(b + dy).toFixed(1)}px`).join(",")})` : "polygon(0 0,0 0,0 0)";
    const paint = () => {
      const dx = corner[0] - P.x, dy = corner[1] - P.y, L = Math.hypot(dx, dy) || 1, n = [dx / L, dy / L], M = [(corner[0] + P.x) / 2, (corner[1] + P.y) / 2];
      const side = (q) => (q[0] - M[0]) * n[0] + (q[1] - M[1]) * n[1];
      const rest = clip(rect, (q) => -side(q)), peeled = clip(rect, side), refl = peeled.map((q) => { const d = side(q); return [q[0] - 2 * d * n[0], q[1] - 2 * d * n[1]]; });
      sh.glass.style.clipPath = pc(rest); sh.gflap.style.clipPath = pc(refl, W, H);
      sh.gflap.style.background = `linear-gradient(${Math.atan2(-n[1], -n[0]) * 180 / Math.PI + 90}deg, rgba(214,212,204,.95), rgba(248,248,244,.97) 35%, rgba(255,255,255,.98))`;
      return area(peeled) / (W * H);
    };
    const local = (cx, cy) => { const b = sh.el.getBoundingClientRect(), kk = b.width / W; return { x: (cx - b.left) / kk, y: (cy - b.top) / kk }; };
    let progress = paint();
    // the corner breathes until it is taken
    frames(cer, (dt) => { if (finished) return false; if (grabbed || settling) return; breathe += dt; const b = reduced() ? 20 : 16 + 8 * (.5 + .5 * Math.sin(breathe * 2.4)); P = { x: W - b, y: H - b }; progress = paint(); });
    const complete = () => end ||= (async () => {
      finished = true; sh.el.removeAttribute("aria-label"); sh.el.removeAttribute("tabindex"); sh.el.classList.add("peeled");
      if (!cer.skipped) { Snd.duck(hold + 400); Haptic.tap("level"); }
      // the cover comes away past the corner and is gone by the time the sheet is bare
      // it ends past the far corner, so the fold line clears the whole sheet and no corner of the cover is left behind
      const from = { ...P }, to = { x: -W * 1.1, y: -H * 1.1 }; let last = 0, away = null;
      const lose = () => away ||= cer.motion(sh.flapwrap, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate(-30px,-60px) rotate(-8deg)" }], { duration: 380, easing: "ease-out" });
      await tween(cer, 520 + hold * .9, (e, q) => { P = { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e) }; paint(); if (q - last > .08) { last = q; Snd.peel(q); } if (q > .55) lose(); }, curve.inOut);
      lose(); sh.glass.style.visibility = "hidden";
      resolve();
    })();
    drag(sh.el, {
      down: (e) => { if (finished) return false; const q = local(e.clientX, e.clientY); if (q.x < W * .45 || q.y < H * .45) return false; grabbed = true; settling = false; off = { x: q.x - P.x, y: q.y - P.y }; },
      move: (dx, dy, e) => {
        if (!grabbed || finished) return; const q = local(e.clientX, e.clientY);
        P = { x: clamp(q.x - off.x, -W * .6, W - 4), y: clamp(q.y - off.y, -H * .4, H - 4) };
        const before = progress; progress = paint(); if (progress - before > .01) Snd.peel(progress);
        if (!crossed && progress > .35) { crossed = true; Haptic.tap("level"); }
      },
      up: () => {
        if (!grabbed || finished) return; grabbed = false;
        if (progress > .35) { complete(); return; }
        const from = { ...P }; settling = true;
        tween(cer, 260, (e) => { if (grabbed || finished) return; P = { x: lerp(from.x, W - 18, e), y: lerp(from.y, H - 18, e) }; progress = paint(); }, curve.outBack).then(() => { settling = false; });
      },
    });
    sh.el.tabIndex = 0; sh.el.setAttribute("aria-label", "Peel the cover");
    sh.el.addEventListener("dblclick", () => complete()); sh.el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) complete(); } });
    return { done, complete, focus: () => sh.el.focus({ preventScroll: true }) };
  }

  /** The uncovered sticker rises off its backing, the light of its rarity lands on the desk, and the edition is stamped. */
  async function lightUp(cer, c, rarity, { quiet = false } = {}) {
    const desk = deskFor(cer), D = DESK[rarity];
    if (!quiet) { Snd.reveal(rarity); Haptic.tap("seal"); desk.bloom(rarity, ...c.at(), c.sh.w * c.K.t); }
    desk.lamp(D.dim, ...c.at(), rarity, 14, 70);
    await tween(cer, 700, (e) => { c.lift = e; }, curve.outBack);
    await cer.wait(240);
    const ed = c.sh.ed;
    if (ed.isConnected) { if (!quiet) { Snd.stamp(); Haptic.tap("align"); } ed.style.opacity = 1; cer.motion(ed, [{ opacity: 0, transform: "scale(2.2) rotate(-16deg)" }, { opacity: 1, transform: "scale(1) rotate(-6deg)" }], { duration: 320, easing: "cubic-bezier(.3,1.4,.5,1)" }); }
  }

  /* After the sheet is pulled out: it comes to the middle of the desk and the cover is peeled off. Then the light of the pull lands on the
     desk, and the sheet makes room for its name beside it; the two sit together in the middle. Then it is yours to tilt. */
  async function peelAndReveal({ cer, stage, sheet: sh, entry, source, onKeep, onLater, laterLabel = "Later" }) {
    const desk = deskFor(cer), mat = MAT[entry.material] || MAT.matte, rarity = rarityOf(entry), D = DESK[rarity], W = sh.w;
    const portrait = narrow(stage), c = carry(cer, stage, sh); sh.slot.remove(); c.tilt = desk.tilt;
    const tx = stage.clientWidth * .5, ty = stage.clientHeight * (portrait ? .4 : .47);
    c.to(tx, ty); desk.lamp(D.dim * .78, ...c.at(), rarity, 14, 72);
    await cer.wait(700);
    cer.hint("Peel the cover.");
    const p = peel(cer, sh, D.hold); p.focus(); cer.allowSkip(() => p.complete());
    await p.done; cer.hint("");
    // the words go beside the sheet on a wide desk (below on a narrow one), and the pair is centred
    const edition = entry.edition != null ? `Edition ${entry.edition}${entry.editionTotal ? " of " + entry.editionTotal : ""}` : "";
    const info = h("div.rv-info.pk-info", { style: { opacity: 0 } }, h("p.eyebrow", source), h("h2", titleOf(entry)),
      h("div.rv-meta", h("span.seal", { data: { rarity }, style: { opacity: 0 } }, rarity), h("span.no", [mat.name, edition].filter(Boolean).join(" · "))),
      h("div.rv-btns", h("button.btn.keep", { on: { click: () => { Snd.tap(); onKeep(); } } }, entry.prize ? "Done" : "Stick it"), onLater && !entry.prize ? h("button.btn.paper", { on: { click: onLater } }, laterLabel) : null),
      h("p.pk-sr", { role: "status" }, `${rarity[0].toUpperCase() + rarity.slice(1)}. ${titleOf(entry)}.`));
    stage.append(info);
    if (!portrait) {
      const gap = 40; info.classList.add("beside"); info.style.maxWidth = Math.max(200, Math.min(320, stage.clientWidth - W - gap - 24)) + "px";
      const iw = info.offsetWidth, left = (stage.clientWidth - (W + gap + iw)) / 2, sx = left + W / 2;
      c.to(sx, ty, 1, 1.2, 150, 22);
      Object.assign(info.style, { left: left + W + gap + "px", top: Math.max(0, ty - info.offsetHeight / 2) + "px" });
    }
    await lightUp(cer, c, rarity);
    if (!reduced()) {
      const onMove = (e) => { const b = sh.el.getBoundingClientRect(); c.TX.to(clamp((e.clientX - (b.left + b.width / 2)) / (b.width * 1.2), -1, 1)); c.TY.to(clamp((e.clientY - (b.top + b.height / 2)) / (b.height * 1.4), -1, 1)); };
      cer.root.addEventListener("pointermove", onMove); cer.root.addEventListener("pointerleave", () => { c.TX.to(0); c.TY.to(0); });
    }
    cer.hint(reduced() ? "" : "Tilt it to catch the light.");
    info.style.opacity = 1; cer.motion(info, [{ opacity: 0 }, { opacity: 1 }], { duration: 360 });
    const name = $("h2", info), seal = $(".seal", info), letters = typeIn(cer, name);
    await cer.wait(260 + titleOf(entry).length * 20); Snd.seal();
    seal.style.opacity = 1; await cer.motion(seal, [{ opacity: 0, transform: "scale(2.4) rotate(-14deg)" }, { opacity: 1, transform: "scale(1) rotate(-2.5deg)" }], { duration: 340, easing: "cubic-bezier(.3,1.4,.5,1)" });
    if (rarity === "archive") inkLine(cer, info, name);
    await letters; cer.endSkip(); $(".keep", info).focus({ preventScroll: true });
  }
  /** A pen stroke under the name and a line of handwriting above it (the archive). */
  function inkLine(cer, info, name) {
    const NS = "http://www.w3.org/2000/svg", w = name.getBoundingClientRect().width + 16, svg = document.createElementNS(NS, "svg"), p = document.createElementNS(NS, "path");
    svg.setAttribute("class", "pk-ink"); svg.setAttribute("width", w); svg.setAttribute("height", 10); p.setAttribute("d", `M4 6 C ${w * .3} 2, ${w * .6} 9, ${w - 4} 4`); svg.append(p); name.after(svg);
    const cap = h("p.pk-hand-cap", "From the archive."); info.prepend(cap);
    const len = p.getTotalLength(); p.style.strokeDasharray = len;
    cer.motion(p, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 700, easing: "cubic-bezier(.3,.6,.3,1)" });
    cer.motion(cap, [{ opacity: 0, clipPath: "inset(0 100% 0 0)" }, { opacity: 1, clipPath: "inset(0 0 0 0)" }], { duration: 800, delay: 300, easing: "cubic-bezier(.3,.6,.3,1)" });
  }

  /* ------------------------------------------------------------------ THE LIGHT OF A PULLED RARITY
     Shared by Today's material and the ten-at-once sheet. Rarity is how light behaves, not how many sparks fly:
     the room darkens in proportion (.cer-exp), a pool of light sits behind what was pulled (.cer-pool), a band of light writes the face,
     and from rare upwards the window's edge glows (.cer-aura). Common and uncommon have no edge and no frame. */
  const LIGHT_RGB = { common: "255,242,214", uncommon: "244,190,114", rare: "207,200,255", special: "255,216,119", archive: "230,197,143" };
  const CAPTION = { uncommon: "Nice find.", rare: "Oh \u2014 a rare one.", special: "Gold. Look at that.", archive: "From the archive." };
  function lightFor(cer) {
    const exp = h("i.cer-exp"), aura = h("i.cer-aura", { data: { kind: "prism" } }, h("i.glow", h("i.spin")), h("i.line", h("i.spin")));
    $(".cer-bg", cer.root).after(exp); cer.root.insertBefore(aura, $(".cer-skip", cer.root) || null);
    const pools = [], inks = [], dark = cer.root.dataset.kind === "pack", rel = (x, y) => { const r = cer.root.getBoundingClientRect(); return [x - r.left, y - r.top]; };
    const level = (plan) => dark ? plan.dim : Math.min(1, plan.dim / .66);
    const api = {
      /** darken the room around a lit spot; (x, y) are viewport pixels. */
      async dim(plan, x, y, ms = 800) {
        const [cx, cy] = rel(x, y); exp.style.setProperty("--cx", cx + "px"); exp.style.setProperty("--cy", cy + "px"); exp.style.setProperty("--tint", plan.tint || "120,100,80");
        const from = getComputedStyle(exp).opacity, to = level(plan);
        if (!dark) cer.root.dataset.tone = plan.dark ? "dim" : "";
        await cer.motion(exp, [{ opacity: from }, { opacity: to }], { duration: ms, easing: EASE.inOut }); exp.style.opacity = to;
      },
      pool(plan, x, y, size) {
        const st = cer.stage.getBoundingClientRect(), s = size * ({ common: .85, uncommon: .95, rare: 1.25, special: 1.45, archive: .8 }[plan.rarity] || 1);
        const e = h("i.cer-pool", { data: { aura: plan.rarity === "rare" ? "prism" : "" }, style: { left: x - st.left + "px", top: y - st.top + "px", width: s + "px", height: s + "px", "--rgb": LIGHT_RGB[plan.rarity] } });
        cer.stage.append(e); pools.push(e); const a = { common: .35, uncommon: .5, rare: .62, special: .75, archive: .28 }[plan.rarity];
        cer.motion(e, [{ opacity: 0, transform: "scale(.5)" }, { opacity: a, transform: "scale(1)" }], { duration: 900, easing: EASE.out });
      },
      showAura(plan) {
        if (!plan.aura) return; aura.dataset.kind = plan.aura;
        if (reduced()) { aura.style.opacity = .6; return; }
        cer.motion(aura, [{ opacity: 0 }, { opacity: 1, offset: .35 }, { opacity: plan.rarity === "special" ? .7 : .55 }], { duration: 1900, easing: "ease-out" });
      },
      /** radiating pen strokes and a line of handwriting, drawn as the light arrives (the archive) */
      ink(plan, x, y, size, ink) {
        if (reduced() || cer.skipped) return; const NS = "http://www.w3.org/2000/svg", st = cer.stage.getBoundingClientRect(), cx = x - st.left, cy = y - st.top;
        const svg = document.createElementNS(NS, "svg"); svg.setAttribute("class", "cer-ink"); svg.setAttribute("viewBox", `0 0 ${st.width} ${st.height}`); cer.stage.append(svg); inks.push(svg);
        const n = plan.rarity === "archive" ? 7 : 12, R0 = size * .62; let k = 1;
        for (let i = 0; i < n; i++) {
          k = (k * 16807) % 2147483647; const jitter = (k / 2147483647 - .5) * .22, a = i / n * Math.PI * 2 + jitter, r1 = R0 * 1.02, r2 = r1 + 16 + (k % 24);
          const p = document.createElementNS(NS, "path"); p.setAttribute("d", `M${cx + Math.cos(a) * r1} ${cy + Math.sin(a) * r1 * .8} L${cx + Math.cos(a) * r2} ${cy + Math.sin(a) * r2 * .8}`);
          p.setAttribute("fill", "none"); p.setAttribute("stroke", ink); p.setAttribute("stroke-width", "2.4"); p.setAttribute("stroke-linecap", "round"); svg.append(p);
          const len = p.getTotalLength(); p.style.strokeDasharray = len; cer.motion(p, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 260, delay: 80 + i * 26, easing: "ease-out" });
        }
        if (size < 250) return; // a cell of the sheet is too small to hold a line of handwriting
        const cap = h("div.cer-caption", { style: { top: Math.max(86, cy - R0 - 40) + "px", color: ink } }, CAPTION[plan.rarity] || ""); cer.stage.append(cap); inks.push(cap);
        cer.motion(cap, [{ opacity: 0, clipPath: "inset(0 100% 0 0)" }, { opacity: 1, clipPath: "inset(0 0 0 0)" }], { duration: 700, delay: 360, easing: "cubic-bezier(.3,.6,.3,1)" });
      },
      /** the light goes back to the paper (the next sticker, or Keep it) */
      async end(ms = 600) {
        cer.root.dataset.tone = "";
        const els = [exp, aura, ...pools, ...inks];
        await Promise.all(els.map(e => cer.motion(e, [{ opacity: getComputedStyle(e).opacity }, { opacity: 0 }], { duration: ms })));
        for (const e of [...pools, ...inks]) e.remove(); pools.length = inks.length = 0; exp.style.opacity = 0; aura.style.opacity = 0;
      },
    };
    return api;
  }
  /** Sound, touch, light and sparks for one pulled thing. `face` carries the .glint bands. Resolves when the first sweep has gone across. */
  function climax(cer, light, plan, { face, x, y, size, ink }) {
    Snd.reveal(plan.rarity); if (plan.hot) Haptic.tap("seal");
    if (plan.dim) light.dim(plan, x, y, 900);
    light.pool(plan, x, y, size); light.showAura(plan);
    if (!cer.skipped && !reduced()) {
      const st = cer.stage.getBoundingClientRect(), fx = (x - st.left) / st.width, fy = (y - st.top) / st.height;
      if (plan.rarity === "rare") sparkBurst(cer.stage, plan.sparks, { cx: fx, cy: fy, power: 1.2 });
      else if (plan.rarity === "special") sparkBurst(cer.stage, plan.sparks, { cx: fx, cy: fy, power: 1.1, colors: ["#ffe9a3", "#ffd05a", "#fff6d6", "#f2b441"] });
      else if (plan.rarity === "uncommon") sparkBurst(cer.stage, 8, { cx: fx, cy: fy, power: .6, colors: ["#f2d9a8", "#fff", "#e8bf80"] });
      if (plan.ink) light.ink(plan, x, y, size, plan.dark || cer.root.dataset.kind === "pack" ? "rgba(246,226,186,.95)" : "#6d4f2a");
    }
    const glints = $$(".glint", face);
    return Promise.all(glints.map((g, i) => cer.motion(g, [{ "--gl": "-60%" }, { "--gl": "150%" }], { duration: plan.rarity === "archive" ? 1 : plan.sweep, easing: "cubic-bezier(.35,.1,.2,1)" })));
  }
  /** A name that comes into focus one letter at a time. The words stay whole for VoiceOver. */
  function typeIn(cer, el) {
    const text = el.textContent; el.setAttribute("aria-label", text); el.textContent = "";
    return Promise.all([...text].map((ch, i) => { const s = h("span.ch", { "aria-hidden": "true" }, ch === " " ? "\u00a0" : ch); el.append(s); return cer.motion(s, [{ opacity: 0, filter: "blur(8px)", transform: "translateY(8px)" }, { opacity: 1, filter: "blur(0)", transform: "none" }], { duration: 520, delay: i * 26, easing: EASE.out }); }));
  }

  /* ------------------------------------------------------------------ TODAY'S MATERIAL: one envelope, one card */
  /** Resolves when the person keeps the card; the daily receipt is committed by Today only once. */
  function openMaterial(m) {
    return new Promise(resolve => {
      const cer=overlay("material"), stage=cer.stage, envelope=EnvelopeScene();
      envelope.classList.add("material-envelope");
      for (const name of ["role","tabindex","aria-label"]) envelope.removeAttribute(name);
      const openedFlap=img("envFlap","layer flap-open"); openedFlap.style.opacity=0;
      $(".env-float",envelope).append(openedFlap);
      const card=h("div.mcard.big", {data:{concealed:"true"},role:"button",tabindex:-1,"aria-label":"Pull out the material card"}, h("i.art"),h("span.lab"));
      $(".card",envelope).replaceWith(h("div.material-card-slot",card)); stage.append(envelope);
      const envelopeSize=new ResizeObserver(()=>card.style.setProperty("--w",envelope.clientWidth*.48+"px"));
      envelopeSize.observe(envelope); card.style.setProperty("--w",envelope.clientWidth*.48+"px");
      let opened=false, pulled=false;
      const base="translateY(-92%) rotate(-2deg)";
      const pull=async () => {
        if (!opened || pulled) return; pulled=true; envelopeSize.disconnect();
        for (const name of ["role","tabindex","aria-label"]) card.removeAttribute(name);
        cer.hint("Tilt it to catch the light."); Snd.swoosh();
        anim(envelope,[{opacity:1},{opacity:0}],{duration:280}).then(()=>envelope.remove());
        const r = card.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        const position = h("div.material-card-position", {style:{position:"absolute",left:r.left-sr.left+"px",top:r.top-sr.top+"px",width:r.width+"px",zIndex:8}});
        stage.append(position); position.append(card);
        card.classList.add("reveal"); card.append(h("i.veil"),h("i.glint")); card.setAttribute("aria-hidden","true"); // the face stays covered until the light writes it
        delete card.dataset.concealed; card.dataset.m=m.id;
        Object.assign(cer.root.dataset,{material:m.id,rarity:m.rarity});cer.allowSkip();
        $(".lab",card).append(h("b",m.name),h("small",m.rarity));
        card.style.cssText = `position:relative;transform:none;--w:${r.width}px;`;
        const {width,height} = card.getBoundingClientRect();
        let resize;
        let kept=false, light=null;
        const info = h("div.rv-info", {"aria-hidden":"true",style:{opacity:0,pointerEvents:"none"}}, h("p.eyebrow", "Today's Material"), h("h2", m.name), h("div.rv-meta", h("span.seal", { data: { rarity: m.rarity } }, m.rarity), h("span.no", m.recipe)),
          h("div.rv-btns", h("button.btn.keep", { disabled:true, on: { click: async e => {
            if (kept) return; kept=true; e.currentTarget.disabled=true; resize?.disconnect(); light?.end(320); Snd.tap(); const rect = card.getBoundingClientRect(), node = card.cloneNode(true); node.classList.remove("in-wrap", "big", "out"); node.getAnimations?.().forEach((a) => a.cancel());
            resolve({ rect, node, close: opts => cer.close(opts) });
          } } }, "Keep it")));
        stage.append(info);
        const hint = $(".cer-hint", cer.root);
        const layout = () => {
          const st = stage.getBoundingClientRect(), hr = hint.getBoundingClientRect();
          const fit = PetaMath.fitMaterialCard({stageWidth:stage.clientWidth,stageHeight:stage.clientHeight,cardWidth:width,cardHeight:height,maxWidth:400,hintBottom:hr.bottom-st.top,infoTop:stage.clientHeight-info.offsetHeight});
          return {dx:fit.cx-(position.offsetLeft+width/2),dy:fit.cy-(position.offsetTop+height/2),k:fit.scale,cy:fit.cy};
        };
        const target = ({dx,dy,k}) => `translate(${dx}px, ${dy}px) scale(${k})`;
        const snap = fit => {
          const w = width * fit.k;
          position.style.left = stage.clientWidth/2-w/2+"px"; position.style.top = fit.cy-height*fit.k/2+"px";
          position.style.width = w+"px"; card.style.setProperty("--w",w+"px");
          fix(position,"none"); // Render the final size crisply instead of enlarging a small GPU surface.
        };
        const fit = layout();
        await cer.motion(position, [{transform:"none"},{transform:target(fit)}], {duration:520,easing:EASE.out});
        snap(fit); fix(card,"rotate(-2deg)");
        // The light of the rarity writes the face: the room dims in proportion, a band sweeps across, and the name comes into focus.
        const plan=PetaMath.revealPlan(m.rarity); light=lightFor(cer);
        { const cr=card.getBoundingClientRect(), cx=cr.left+cr.width/2, cy=cr.top+cr.height/2;
          if(plan.pre) { light.dim({...plan,dim:plan.dim*.4},cx,cy,plan.pre+200); if(plan.rarity==="special"||plan.rarity==="archive")Snd.hush(); await cer.wait(plan.pre); }
          const lit=climax(cer,light,plan,{face:card,x:cx,y:cy,size:cr.width*1.1});
          await cer.motion(card,[{"--wp":"-18%"},{"--wp":"122%"}],{duration:plan.sweep,easing:"cubic-bezier(.35,.1,.2,1)"});
          card.classList.add("shown"); card.removeAttribute("aria-hidden"); await lit; }
        Stk.tilt(card, { max:4, scale:1.01, baseTransform:"rotate(-2deg)", trigger:position });
        resize = new ResizeObserver(() => { const fit = layout(); snap(fit); });
        resize.observe(stage); resize.observe(info); resize.observe(hint);
        info.removeAttribute("aria-hidden"); info.style.opacity = 1; info.style.pointerEvents = "";
        const seal=$(".seal",info); seal.style.opacity=0;
        cer.motion(info, [{ opacity: 0 }, { opacity: 1 }], { duration: 360 }); typeIn(cer,$("h2",info));
        await cer.wait(260); Snd.seal();
        await cer.motion(seal, [{ opacity: 0, transform: "scale(2.5) rotate(-16deg)" }, { opacity: 1, transform: "scale(1) rotate(-2.5deg)" }], { duration: 380, easing: EASE.out }); seal.style.opacity=1;
        info.append(h("p",{role:"status",style:{position:"absolute",width:"1px",height:"1px",overflow:"hidden",clip:"rect(0 0 0 0)"}},`${m.rarity[0].toUpperCase()+m.rarity.slice(1)}. ${m.name}.`));
        const keep=$(".keep",info); keep.disabled=false; keep.focus({preventScroll:true});
        cer.endSkip();
      };
      drag(card, {
        down:()=> { if (!opened || pulled) return false; fix(card,base); },
        move:(dx,dy)=> {
          if (pulled) return;
          const up=clamp(-dy,0,envelope.clientHeight*.6);
          card.style.transform=`translateY(calc(-92% - ${up}px)) rotate(-2deg)`;
          if (up>envelope.clientHeight*.22) pull();
        },
        up:()=> { if (!pulled) anim(card,[{transform:card.style.transform},{transform:base}],{duration:240,easing:EASE.out}).then(()=>{if(!pulled)fix(card,base);}); },
      });
      card.addEventListener("dblclick",pull);
      card.addEventListener("keydown",e=>{if(e.key==="Enter" || e.key===" "){e.preventDefault();pull();}});
      const show=async () => {
        cer.hint("Opening your envelope."); Snd.crinkle(4,.2);
        const back=anim(openedFlap,[{opacity:0,transform:"scaleY(0)"},{opacity:0,transform:"scaleY(0)",offset:.5},{opacity:1,transform:"scaleY(-1)"}],{duration:420,easing:EASE.inOut});
        await anim($(".flap",envelope),[{transform:"rotateX(0)"},{transform:"rotateX(-172deg)"}],{duration:420,easing:EASE.inOut});
        await back;
        await anim(card,[{transform:"none"},{transform:base}],{duration:360,easing:EASE.out});
        fix(card,base); opened=true;
        cer.hint("Pull it out."); card.tabIndex=0; card.focus({preventScroll:true});
      };
      show(); cer.root._esc=()=>{};
    });
  }

  /* ------------------------------------------------------------------ GIFT (open) */
  async function openGift(gift) {
    const cer = overlay("gift"), stage = cer.stage; cer.hint("Break the seal.");
    const EW = Math.min(420, stage.clientWidth * .6, stage.clientHeight * .75), EH = EW * 340 / 480;
    const flapPoly = "polygon(10% 14%, 90% 14%, 50% 57%)", bodyPoly = "polygon(0 0, 10% 14%, 50% 57%, 90% 14%, 100% 0, 100% 100%, 0 100%)";
    const hole = `radial-gradient(circle at 50% 54.5%, transparent 0, transparent ${EW * .066}px, #000 ${EW * .074}px)`;
    const mk = (cls, clip, extra = {}) => h("img.ev-layer." + cls, { src: A.arrGift, alt: "", style: { clipPath: clip, webkitMaskImage: hole, maskImage: hole, ...extra } });
    const inside = h("i.ev-inside"), body = mk("ev-body", bodyPoly), flap = mk("ev-flap", flapPoly);
    const wax = h("div.wax", { style: { width: EW * .17 + "px", left: "50%", top: "54.5%" } }, img("waxSeal", "w-full"), img("waxL", "w-l"), img("waxR", "w-r"));
    const note = h("div.ev-note", { style: { width: EW * .86 + "px" } }, img("noteBlank"), h("p.hand", h("small", "from"), h("b", gift.from), gift.note ? h("span", "“" + gift.note + "”") : null));
    const sleeve = h("div.pk-sleeve.gsleeve", { style: { width: EW * .5 + "px" } }, img("mystery"));
    const env = h("div.env-wrap", { style: { width: EW + "px", height: EH + "px", "--ew": EW + "px" } }, inside, sleeve, note, body, flap, wax);
    const sc = h("div.gift-scene", env); stage.append(sc);
    anim(sc, [{ opacity: 0, transform: "translateY(50px) rotate(-6deg) scale(.88)" }, { opacity: 1, transform: "none" }], { duration: 700, easing: EASE.spring });
    let opened = false, entry = null, settling=false;
    const crack = async () => {
      if (opened) return; opened = true; cer.hint(""); Snd.crack(); Haptic.tap("seal");
      wax.classList.add("cracked");
      anim($(".w-l", wax), [{ transform: "none", opacity: 1 }, { transform: "translate(-34px, 70px) rotate(-28deg)", opacity: 0 }], { duration: 760, easing: "cubic-bezier(.3,0,.7,.6)" });
      anim($(".w-r", wax), [{ transform: "none", opacity: 1 }, { transform: "translate(40px, 84px) rotate(32deg)", opacity: 0 }], { duration: 820, easing: "cubic-bezier(.3,0,.7,.6)" });
      anim($(".w-full", wax), [{ opacity: 1 }, { opacity: 0 }], { duration: 40 });
      await sleep(260); Snd.swoosh();
      flap.style.transformOrigin = "50% 14%"; inside.style.opacity = 1;
      await anim(flap, [{ transform: "rotateX(0)" }, { transform: "rotateX(180deg)", filter: "brightness(.92)" }], { duration: 640, easing: EASE.out });
      fix(flap, "rotateX(180deg)"); flap.style.zIndex = 0;
      // the note comes out first
      Snd.crinkle(6, .3);
      await anim(note, [{ transform: "translate(-50%, 10%) rotate(0)", opacity: 1 }, { transform: `translate(-62%, -${EH * .78}px) rotate(-6deg)`, opacity: 1 }], { duration: 760, easing: EASE.out });
      fix(note, `translate(-62%, -${EH * .78}px) rotate(-6deg)`);
      cer.hint("Pull the sticker out.");
      sleeve.classList.add("out");
      await anim(sleeve, [{ transform: "translateY(0)" }, { transform: `translateY(-${EH * .34}px) rotate(1.5deg)` }], { duration: 640, easing: EASE.out });
      fix(sleeve, `translateY(-${EH * .34}px) rotate(1.5deg)`);
      let id;
      try { Bridge.busy = true; id=await Bridge.invoke("gift_open", {giftId:gift.id}); }
      catch(e) { Bridge.busy=false; await cer.close(); Shell.error(e); return; }
      gift.opened=true;const savedGift=S.gifts.find(g=>g.id===gift.id);if(savedGift)savedGift.opened=true;
      try {entry=await Bridge.entry(id);await Bridge.reload();}
      catch {await closeCommittedPreview(cer,'Gift opened and saved. The preview could not load; find it in your Collection.');return;}
      let pulled = false, rustle=Snd.paperMotion(); const base = sleeve.style.transform;
      drag(sleeve, {
        down: () => {if(pulled)return false;rustle=Snd.paperMotion();},
        move: (dx, dy) => { const up = clamp(-dy, 0, 300); sleeve.style.transform = `translateY(${-EH * .34 - up}px) rotate(${1.5 + dx * .03}deg)`; rustle(up / 300); if (up > 110 && !pulled) pull(); },
        up: () => { if (!pulled) { anim(sleeve, [{ transform: sleeve.style.transform }, { transform: base }], { duration: 300, easing: EASE.spring }).then(() => fix(sleeve, base)); } },
      });
      sleeve.addEventListener("dblclick", () => !pulled && pull()); sleeve.tabIndex = 0; sleeve.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && !pulled && pull());
      async function pull() {
        pulled = true; gift.opened = true; Shell.renderNav();
        anim(note, [{ opacity: 1 }, { opacity: 0, transform: note.style.transform + " translateY(-30px)" }], { duration: 500, delay: 100 });
        anim(env, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(200px) rotate(4deg)", opacity: 0 }], { duration: 700, easing: "cubic-bezier(.5,0,.8,.4)", delay: 120 });
        const r = sleeve.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        stage.append(sleeve); sleeve.style.cssText = `position:absolute;left:${r.left - sr.left}px;top:${r.top - sr.top}px;width:${r.width}px;z-index:8;transform:none;`;
        try {await unwrapAndReveal({ cer, stage, sleeve, entry, source: `Gift from ${gift.from}`, onKeep: keep, onLater: later });}
        catch {await closeCommittedPreview(cer,'Gift opened and saved. The preview could not load; find it in your Collection.');}
      }
    };
    const keep = async () => { if(settling)return;settling=true;Bridge.busy=false;await cer.close();Shell.refresh();try {await Desktop.print(entry);Shell.toast("A gift from " + gift.from + ".");} catch {Shell.toast('Gift saved. Stick it from your Collection whenever you like.');} };
    const later = async () => { if(settling)return;settling=true;try {await Bridge.invoke("print_later");} catch {await closeCommittedPreview(cer,'Gift saved. Stick it from your Collection whenever you like.');return;}Bridge.busy=false;await cer.close();Shell.refresh();Shell.toast("Saved in your Collection for later.");Shell.renderNav(); };
    wax.addEventListener("click", crack); wax.addEventListener("pointerdown", () => Snd.tap()); wax.tabIndex = 0; wax.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && crack());
    wax.style.cursor = "pointer"; cer.root._esc = () => { if (!opened) cer.close(); else if(entry)later(); };
  }

  /* `pull` (friends' packs in Market) replaces the native opening with a paid pull; the ceremony is the same. */
  async function openPack(pack, { free = false, pull = null } = {}) {
    if (!pull && (free ? !packHasFreeOpening(pack) : (!packOpenable(pack) || packHasFreeOpening(pack)))) return; // a ready free opening always comes first
    const cer = overlay("pack"), stage = cer.stage; cer.hint("Tear along the top.");
    const sheet = packSheet(cer, pack); let entry = null, settling=false;
    const onTear = async (rig) => {
      let opened;
      try { Bridge.busy = true; opened=await (pull ? pull() : Bridge.invoke(free ? "pack_open_free" : "pack_open", {packId:pack.id, queue:false})); }
      catch(e) { Bridge.busy=false; await cer.close(); Shell.error(e); return; }
      pack.left=Array(opened.remaining).fill(null);if(free)pack.freeOpenings=Math.max(0,(pack.freeOpenings||0)-1);else if(pack.daily)S.packAvailable=false;
      const savedPack=S.packs.find(p=>p.id===pack.id);if(savedPack){savedPack.left=pack.left;if(free)savedPack.freeOpenings=pack.freeOpenings;}
      try {entry=await Bridge.packEntry(opened);await Bridge.reload();Shell.renderNav();await sheet.fill(entry);}
      catch {await closeCommittedPreview(cer,'Opened and saved to your Collection / stock. The preview could not load.');return;}
      // the pull is committed: from here the light leaking from the mouth is the pull's own colour
      rig.light?.(entry); cer.hint("Pull the sheet out.");
      await rig.pullable(sheet.slot, { onPull: async () => {
        rig.linger();
        try {await peelAndReveal({ cer, stage, sheet, entry, source: `${pack.title} · ${pack.left.length} left`, onKeep: keep, onLater: leave, laterLabel: entry.prize ? "Done" : "Keep in Collection" });}
        catch {await closeCommittedPreview(cer,'Opened and saved to your Collection / stock. The preview could not load.');}
      } });
    };
    // a pouch is torn along its top; every other wrapping (Studio) is simply opened
    const generic = !!(pack.bag && BAGS[pack.bag]?.gen), cover = pack.bag && PackArt.decorated(pack) ? await PackArt.cover(pack) : null;
    const decoration = !generic && pack.bag && PackArt.decorated(pack) ? BagPic({bag:pack.bag,color:pack.color,title:pack.title,sub:"by "+pack.by,cover,deco:pack.deco||"none",layout:pack.layout,id:pack.id,shut:true}) : null;
    if(decoration) { decoration.querySelector(".bp-art")?.remove(); decoration.classList.add("pk-dress"); }
    if (generic) cer.hint("Open it.");
    const rig = generic ? buildBagRig(cer, stage, { pack, content: sheet.slot, cover, onTear })
      : buildRig(cer, stage, { kind: pack.kind, hue: pack.hue, color:pack.color, content: sheet.slot, label: decoration ? null : PackLabel({ ...pack, kind: pack.kind || "holo" }), decoration, onTear });
    sheet.place(rig);
    // A pull is already in the Collection. "Stick it" sends it to the desktop the same way the Collection's "Stick on desktop" does;
    // "Keep in Collection" (or Esc) just closes, and nothing is left waiting at the print slot.
    const keep = async () => {
      if(settling)return;settling=true;
      if(entry.prize) {Bridge.busy=false;await cer.close();Shell.refresh();Shell.toast("Added to your stock.");return;}
      try { await Bridge.printAction("daily_stick_from_collection", { stickerId: entry.id }); }
      catch {await closeCommittedPreview(cer,'Kept in your Collection. Could not place it on the desktop.');return;}
      Bridge.busy=false;await cer.close();Shell.refresh();try {await Desktop.print(entry);Shell.toast("It's yours.");} catch {Shell.toast('Sticker saved. Stick it from your Collection whenever you like.');}
    };
    const leave = async () => { if(settling)return;settling=true;Bridge.busy=false;await cer.close();Shell.refresh();Shell.toast(entry.prize ? "Added to your stock." : "Kept in your Collection."); };
    cer.root._esc = () => { if (!rig.done) cer.close(); else if(entry)leave(); };
    rig.focus();
  }

  /* Several at once: one tear commits the batch (one pack_open per sticker; the rest is presentation). The sheets come out together and
     are peeled one by one; each uncovered sheet rests a moment under the lamp, then is set aside on the desk, and at the end they all come
     back side by side. They go straight to the Collection. */
  const RARITY_RANK = ["common", "uncommon", "rare", "special", "archive"];
  const REST = { common: 650, uncommon: 800, rare: 1500, special: 1800, archive: 1600 };
  async function openPackMany(pack, n) {
    n = Math.min(10, n, pack.left.length);
    if (n < 2) return openPack(pack);
    if (!packOpenable(pack) || packHasFreeOpening(pack)) return; // a ready free opening always comes first
    const cer = overlay("pack"), stage = cer.stage; cer.hint(`Tear along the top · ${n} stickers inside`);
    const sheets = Array.from({ length: n }, () => packSheet(cer, pack)), stack = h("div.pk-sheet-slot.pk-stack");
    stack.append(...sheets.map((s) => s.el).reverse());
    const got = []; let committed = false, settled = false, current = null, next = null;
    const keepIt = async () => {
      if (settled) return; settled = true; Bridge.busy = false; await cer.close(); Shell.refresh(); Shell.renderNav();
      const prizes = got.filter((g) => g.entry?.prize).length, stickers = got.length - prizes;
      Shell.toast(prizes ? `${stickers} stickers in Collection · ${prizes} ${prizes === 1 ? "prize" : "prizes"} added to stock.` : `${stickers} stickers in your Collection.`);
    };
    const onTear = async (rig) => {
      Bridge.busy = true; let failure = null;
      for (let i = 0; i < n; i++) {
        let opened; try { opened = await Bridge.invoke("pack_open", { packId: pack.id, queue: false }); } catch (e) { failure = e; break; }
        // the committed pull is recorded first: a preview that cannot load never loses it
        const one = { sheet: sheets[i], rarity: DESK[opened.rarity] ? opened.rarity : "common", entry: null }; got.push(one); pack.left = Array(opened.remaining).fill(null);
        one.ready = (async () => { try { one.entry = await Bridge.packEntry(opened); one.rarity = rarityOf(one.entry); await one.sheet.fill(one.entry); } catch { one.sheet.missing(); } })();
      }
      committed = true;
      const savedPack = S.packs.find((p) => p.id === pack.id); if (savedPack) savedPack.left = pack.left;
      try { await Bridge.reload(); } catch {} Shell.renderNav();
      if (!got.length) { Bridge.busy = false; await cer.close(); Shell.error(failure); return; }
      if (failure) Shell.toast(`Stopped after ${got.length}. ${failure?.message || failure}`);
      for (const s of sheets.slice(got.length)) s.el.remove();
      await Promise.all(got.map((g) => g.ready));
      rig.light?.({ rarity: got.reduce((best, g) => RARITY_RANK.indexOf(g.rarity) > RARITY_RANK.indexOf(best) ? g.rarity : best, "common") });
      cer.hint("Pull the sheets out.");
      await rig.pullable(stack, { onPull: () => peelAll(rig) });
    };
    const peelAll = async (rig) => {
      rig.linger(); const desk = deskFor(cer), cards = got.map((g) => carry(cer, stage, g.sheet)); stack.remove();
      const W = sheets[0].w, H = sheets[0].h, tx = stage.clientWidth * .5, ty = stage.clientHeight * .47;
      const stackFrom = (from) => cards.slice(from).forEach((c, j) => { c.to(tx + j * 1.5, ty + j * 2.5, 1, j ? (j % 2 ? -1 : 1) * (1 + j * .4) : 1.2); c.sh.el.style.zIndex = 40 - j; c.sh.el.classList.toggle("under", j > 0); });
      stackFrom(0); desk.lamp(.5, ...cards[0].at(), "common", 16, 74);
      await cer.wait(700);
      cer.allowSkip(() => { current?.complete(); next?.(); });
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i], g = got[i], r = g.rarity, D = DESK[r]; stackFrom(i); c.tilt = desk.tilt;
        desk.lamp(D.dim * .78, ...c.at(), r, 14, 72);
        cer.hint(`Peel the cover · ${i + 1} of ${cards.length}`);
        current = peel(cer, c.sh, D.hold); current.focus(); if (cer.skipped) current.complete();
        await current.done; cer.hint("");
        const cap = h("div.pk-cap", { style: { left: tx + "px", top: ty + H / 2 + 34 + "px" } }, h("b", g.entry ? titleOf(g.entry) : "Sticker"), h("span.seal", { data: { rarity: r } }, r));
        stage.append(cap); cer.motion(cap, [{ opacity: 0, transform: "translate(-50%, 6px)" }, { opacity: 1, transform: "translate(-50%, 0)" }], { duration: 300, easing: EASE.out });
        await lightUp(cer, c, r, { quiet: cer.skipped });
        // it rests a moment under the lamp (longer for the rarer ones), or until it is clicked or Enter is pressed
        if (i < cards.length - 1 || !cer.skipped) await Promise.race([cer.wait(REST[r]), new Promise((res) => { next = res; c.sh.el.addEventListener("click", res, { once: true }); })]);
        next = null; c.tilt = null; c.TX.to(0); c.TY.to(0);
        cer.motion(cap, [{ opacity: 1 }, { opacity: 0 }], { duration: 240 }).then(() => cap.remove());
        desk.fade(500); c.sh.el.classList.add("aside"); c.sh.el.style.zIndex = 60;
        const [px, py] = [stage.clientWidth - W * .2 - 14 + (i % 2 ? 3 : -3), H * .2 + 18 + i * 5];
        c.to(px, py, .4, rand(-7, 7), 150, 20); if (!cer.skipped) Snd.crinkle(2, .1);
        cer.wait(500).then(() => { c.sh.el.style.zIndex = 10 + i; });
      }
      await summary(cards);
    };
    const summary = async (cards) => {
      cer.endSkip(); cer.hint("");
      const desk = deskFor(cer), k = cards.length, cols = Math.min(5, k), rows = Math.ceil(k / cols), gap = 16, W = sheets[0].w, H = sheets[0].h, infoH = 132;
      const s = Math.min(.62, (stage.clientWidth - 24 - gap * (cols - 1)) / cols / W, (stage.clientHeight - infoH - 16 - gap * (rows - 1)) / rows / H);
      const gw = cols * W * s + (cols - 1) * gap, gh = rows * H * s + (rows - 1) * gap, gx0 = (stage.clientWidth - gw) / 2, gy0 = Math.max(8, (stage.clientHeight - infoH - gh) / 2);
      desk.fade(600); { const st = stage.getBoundingClientRect(); desk.lamp(.34, st.left + st.width / 2, st.top + gy0 + gh / 2, "common", 30, 95); }
      for (const el of $$(".pk-wrap, .pk-strip", stage)) cer.motion(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 500 }).then(() => { el.style.visibility = "hidden"; });
      for (let i = 0; i < k; i++) {
        const c = cards[i], col = i % cols, row = Math.floor(i / cols); c.sh.el.classList.remove("aside", "under"); c.sh.el.classList.add("sum"); c.sh.el.dataset.rarity = got[i].rarity; c.sh.el.style.zIndex = 20 + i;
        c.to(gx0 + col * (W * s + gap) + W * s / 2, gy0 + row * (H * s + gap) + H * s / 2, s, (i % 3 - 1) * 1.2, 140, 20); await cer.wait(60);
      }
      Snd.crinkle(4, .4);
      // the whole sheet catches the light together as the pointer moves
      if (!reduced()) cer.root.addEventListener("pointermove", (e) => { const b = stage.getBoundingClientRect(); for (const c of cards) { c.TX.to(clamp((e.clientX - b.left - c.X.t) / b.width, -1, 1) * .7); c.TY.to(clamp((e.clientY - b.top - c.Y.t) / b.height, -1, 1) * .7); } });
      const tally = RARITY_RANK.map((r) => [r, got.filter((g) => g.rarity === r).length]).filter(([, c]) => c), best = tally.at(-1)?.[0] || "common";
      const info = h("div.rv-info.pk-info.pk-sum", { style: { top: gy0 + gh + 18 + "px", bottom: "auto", opacity: 0 } }, h("p.eyebrow", `${pack.title} · ${pack.left.length} left`), h("h2", `${k} new ${k === 1 ? "sticker" : "stickers"}`),
        h("div.rv-meta", h("span.seal", { data: { rarity: best } }, best), h("span.no", tally.map(([r, c]) => `${c} ${r}`).join(" · "))),
        h("div.rv-btns", h("button.btn.keep", { on: { click: () => { Snd.tap(); keepIt(); } } }, "Done")));
      stage.append(info); info.style.opacity = 1; cer.motion(info, [{ opacity: 0 }, { opacity: 1 }], { duration: 360 }); typeIn(cer, $("h2", info));
      $(".keep", info).focus({ preventScroll: true });
    };
    // a pouch is torn along its top; every other wrapping (Studio) is simply opened
    const generic = !!(pack.bag && BAGS[pack.bag]?.gen), cover = pack.bag && PackArt.decorated(pack) ? await PackArt.cover(pack) : null;
    const decoration = !generic && pack.bag && PackArt.decorated(pack) ? BagPic({bag:pack.bag,color:pack.color,title:pack.title,sub:"by "+pack.by,cover,deco:pack.deco||"none",layout:pack.layout,id:pack.id,shut:true}) : null;
    if(decoration) { decoration.querySelector(".bp-art")?.remove(); decoration.classList.add("pk-dress"); }
    if (generic) cer.hint(`Open it · ${n} stickers inside`);
    const rig = generic ? buildBagRig(cer, stage, { pack, content: stack, cover, onTear })
      : buildRig(cer, stage, { kind: pack.kind, hue: pack.hue, color: pack.color, content: stack, label: decoration ? null : PackLabel({ ...pack, kind: pack.kind || "holo" }), decoration, onTear });
    for (const s of sheets) s.place(rig, stack);
    cer.root.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && next && !e.repeat) { e.preventDefault(); next(); } });
    cer.root._esc = () => { if (!rig.done) cer.close(); else if (committed && got.length) keepIt(); };
    rig.focus();
  }

  return { openMaterial, openGift, openPack, openPackMany };
})();

