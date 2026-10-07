/* Ten at once ("Sheet"): one tear, ten sleeves, a wave that waits for every rare.
   This is a port of docs/ui-proposals/gacha-aaa-preview.html (proposal M-B and the Mix rarity light), kept as close to it as the app allows:
   a 960x640 world scaled into the window, the preview's own tear, sleeves, light table, wave, hold-back, rarity light and sound.
   The app supplies the data (pack_open, stickers, print) and the preferences (Sounds, Haptics, Reduce motion). All classes are gx-*. */
const Gx = (() => {
  const W = 960, H = 640, CANCEL = Symbol("cancel");
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const RANK = (r) => ["common", "uncommon", "rare", "special", "archive"].indexOf(r);
  const RGB = { common: "255,242,214", uncommon: "244,190,114", rare: "207,200,255", special: "255,216,119", archive: "230,197,143" };
  const TIME = { common: 1.0, uncommon: 1.1, rare: 1.55, special: 1.95, archive: 2.1 };
  const TINT = { common: "6,4,2", uncommon: "6,4,2", rare: "6,4,2", special: "6,4,2", archive: "6,4,2" };

  /* ---------------------------------------------------------------- a Run is one performance. Everything it creates dies with it. */
  class Run {
    constructor(host, scale) { this.host = host; this.dead = false; this.timers = new Set(); this.anims = new Set(); this.undo = []; this.raf = new Set(); this.pending = new Set(); this.skipping = false; this.getScale = scale; }
    get scale() { return this.getScale(); }
    get sp() { return this.skipping ? 6 : 1; }
    check() { if (this.dead) throw CANCEL; }
    skip() { if (this.skipping || this.dead) return; this.skipping = true; this.anims.forEach((a) => { try { a.playbackRate = 6; } catch {} }); [...this.pending].forEach((f) => f()); this.pending.clear(); }
    wait(ms) { this.check(); const d = reduced() ? Math.min(ms, 40) : ms / this.sp; return new Promise((res, rej) => { const t = setTimeout(() => { this.timers.delete(t); this.dead ? rej(CANCEL) : res(); }, d); this.timers.add(t); }); }
    anim(el, frames, o = {}) {
      this.check(); const r = reduced(), dur = o.duration ?? 400, delay = o.delay ?? 0;
      const a = el.animate(frames, { fill: "both", easing: EASE.out, ...o, duration: r ? 1 : dur / this.sp, delay: r ? 0 : delay / this.sp });
      this.anims.add(a); const p = a.finished.then(() => { this.anims.delete(a); return a; }, () => { this.anims.delete(a); if (this.dead) throw CANCEL; return a; }); p.catch(() => {}); return p;
    }
    async to(el, frames, o = {}) { const a = await this.anim(el, frames, o); if (this.dead) throw CANCEL; try { a.commitStyles(); a.cancel(); } catch {} return a; }
    frames(ms, cb, ease = (t) => t) {
      this.check();
      return new Promise((res, rej) => {
        const dur = reduced() ? 1 : ms / this.sp; let t0 = null; const id = { c: 0 };
        const step = (now) => { if (this.dead) { this.raf.delete(id); return rej(CANCEL); } t0 ??= now; const t = clamp((now - t0) / dur, 0, 1); cb(ease(t), t); if (t < 1) id.c = requestAnimationFrame(step); else { this.raf.delete(id); res(); } };
        this.raf.add(id); id.c = requestAnimationFrame(step);
      });
    }
    later(fn) { this.undo.push(fn); }
    stop() { if (this.dead) return; this.dead = true; this.timers.forEach(clearTimeout); this.anims.forEach((a) => { try { a.cancel(); } catch {} }); this.raf.forEach((r) => cancelAnimationFrame(r.c)); this.undo.forEach((f) => { try { f(); } catch {} }); Sfx.release(); }
    async play(body) { try { await body(this); } catch (e) { if (e !== CANCEL) console.error(e); } }
  }
  /** spring: interruptible, velocity-continuous. */
  function spring(run, { from = 0, to = 1, v = 0, k = 240, c = 26, eps = .0008, onUpdate, onDone }) {
    let x = from, vel = v, last = performance.now(), stopped = false; const rec = { c: 0 };
    const p = new Promise((res) => {
      if (reduced()) { onUpdate?.(to, 0); res(); return; }
      const step = (now) => {
        if (stopped) return res(); if (run.dead) { run.raf.delete(rec); return res(); }
        const dt = Math.min(.032, (now - last) / 1000) * run.sp; last = now; const sub = Math.ceil(dt / .004), h2 = dt / sub;
        for (let i = 0; i < sub; i++) { const a = -k * (x - to) - c * vel; vel += a * h2; x += vel * h2; }
        onUpdate?.(x, vel); const sc = Math.max(1, Math.abs(to - from));
        if (Math.abs(x - to) < eps * sc && Math.abs(vel) < eps * 8 * sc) { x = to; onUpdate?.(x, 0); run.raf.delete(rec); return res(); }
        rec.c = requestAnimationFrame(step);
      };
      run.raf.add(rec); rec.c = requestAnimationFrame(step);
    });
    p.then(() => onDone?.()); return Object.assign(p, { stop() { stopped = true; cancelAnimationFrame(rec.c); } });
  }
  /** pointer drag in world units (the world is scaled to fit the window); tracks velocity. */
  function dragIn(run, el, { down, move, up, threshold = 3 }) {
    const onDown = (e) => {
      if (e.button !== 0) return; if (down && down(e) === false) return; e.preventDefault();
      const s = run.scale, sx = e.clientX, sy = e.clientY; let moved = false; const hist = [{ t: performance.now(), x: 0, y: 0 }];
      try { el.setPointerCapture(e.pointerId); } catch {} el.classList.add("grabbing");
      const mv = (ev) => { const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s; if (!moved && Math.hypot(dx, dy) < threshold) return; moved = true; hist.push({ t: performance.now(), x: dx, y: dy }); if (hist.length > 6) hist.shift(); move?.(dx, dy, ev); };
      const end = (ev) => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", end); el.removeEventListener("pointercancel", end); try { el.releasePointerCapture(e.pointerId); } catch {} el.classList.remove("grabbing");
        const a = hist[0], b = hist[hist.length - 1], dt = Math.max(16, b.t - a.t); up?.(ev, moved, { vx: (b.x - a.x) / dt * 1000, vy: (b.y - a.y) / dt * 1000 }); };
      el.addEventListener("pointermove", mv); el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    };
    el.addEventListener("pointerdown", onDown); run.later(() => el.removeEventListener("pointerdown", onDown)); el.classList.add("gx-draggable");
  }
  function activate(run, el, fn) { const k = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(e); } }; el.tabIndex = 0; el.addEventListener("keydown", k); el.addEventListener("dblclick", fn); run.later(() => { el.removeEventListener("keydown", k); el.removeEventListener("dblclick", fn); }); }
  /** a step the hand performs; Skip performs it for you. */
  function step(run, perform) { let used = false; const go = () => { if (used) return; used = true; run.pending.delete(go); perform(); }; run.pending.add(go); if (run.skipping) run.wait(300).then(go).catch(() => {}); return { done() { used = true; run.pending.delete(go); }, go }; }

  /* ---------------------------------------------------------------- sound: synthesized, in one small room. Follows the Sounds preference. */
  const Sfx = (() => {
    let ctx, master, dry, wet, noiseBuf, pinkBuf, hold = null;
    const ensure = () => {
      if (!Snd.on) return null;
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
        ctx = new C(); master = ctx.createGain(); master.gain.value = .62; const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.2; comp.attack.value = .004; comp.release.value = .2;
        dry = ctx.createGain(); wet = ctx.createGain(); wet.gain.value = .26; const conv = ctx.createConvolver(), len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 900 ? i / 900 : 1); }
        conv.buffer = ir; dry.connect(master); wet.connect(conv); conv.connect(master); master.connect(comp); comp.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const n = noiseBuf.getChannelData(0); for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
        pinkBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const p = pinkBuf.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < p.length; i++) { const w = Math.random() * 2 - 1; b0 = .99765 * b0 + w * .099046; b1 = .963 * b1 + w * .2965164; b2 = .57 * b2 + w * 1.0526913; p[i] = (b0 + b1 + b2 + w * .1848) * .22; }
      }
      if (ctx.state === "suspended") ctx.resume(); return ctx;
    };
    const out = (node, send = .2) => { node.connect(dry); if (send) { const s = ctx.createGain(); s.gain.value = send; node.connect(s); s.connect(wet); } };
    const env = (g, T, a, d, peak) => { g.gain.setValueAtTime(.0001, T); g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), T + a); g.gain.exponentialRampToValueAtTime(.0001, T + a + d); };
    const noise = (t0, dur, { f = 2000, f2, q = .8, type = "bandpass", gain = .08, a = .005, pink = false, send = .12 } = {}) => {
      if (!ensure()) return; const T = ctx.currentTime + t0, s = ctx.createBufferSource(); s.buffer = pink ? pinkBuf : noiseBuf; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, T); fl.Q.value = q; if (f2) fl.frequency.exponentialRampToValueAtTime(f2, T + dur);
      const g = ctx.createGain(); env(g, T, a, dur, gain); s.connect(fl); fl.connect(g); out(g, send); s.start(T, Math.random()); s.stop(T + dur + a + .05);
    };
    const tone = (t0, freq, dur, { type = "sine", gain = .08, f2, a = .004, send = .2, detune = 0 } = {}) => {
      if (!ensure()) return; const T = ctx.currentTime + t0, o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.detune.value = detune;
      o.frequency.setValueAtTime(freq, T); if (f2) o.frequency.exponentialRampToValueAtTime(f2, T + dur); env(g, T, a, dur, gain); o.connect(g); out(g, send); o.start(T); o.stop(T + dur + a + .05);
    };
    const bell = (t0, f, dur = 1.6, gain = .06, ratios = [1, 2.76, 5.4, 8.93], send = .5) => ratios.forEach((r, i) => tone(t0, f * r, dur / (1 + i * .55), { gain: gain / (1 + i * .9), a: .003, send }));
    const glass = (t0, f, dur = 1.1, gain = .05) => [1, 2.003, 3.01, 4.17, 6.2].forEach((r, i) => tone(t0, f * r, dur / (1 + i * .4), { gain: gain / (1 + i * 1.1), a: .002, send: .55, detune: (i - 2) * 3 }));
    const pluck = (t0, f, gain = .06) => { tone(t0, f, .9, { type: "triangle", gain, a: .002, send: .5 }); tone(t0, f * 2.01, .35, { gain: gain * .35, a: .002, send: .5 }); tone(t0, f * 4.2, .12, { gain: gain * .18, a: .001, send: .4 }); };
    const N = { E4: 329.6, G4: 392, A4: 440, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, A5: 880, B5: 987.8, E6: 1318.5, G6: 1568 };
    const api = {
      ensure,
      crinkle(n = 10, span = .5, level = 1) { for (let i = 0; i < n; i++) noise(Math.random() * span, rand(.015, .05), { f: rand(3200, 7800), q: .9, gain: rand(.022, .06) * level }); },
      crinkleTick(v = 1) { noise(0, rand(.02, .045), { f: rand(3600, 7600), q: .8, gain: .02 + .03 * clamp(v, 0, 1) }); },
      tear(dur = .55, level = 1) { noise(0, dur, { f: 2600, f2: 6200, type: "highpass", q: .5, gain: .05 * level, a: .02 }); api.crinkle(Math.round(dur * 26), dur, level); },
      tearSnap() { noise(0, .09, { f: 5200, type: "highpass", gain: .1, a: .001 }); tone(0, 170, .1, { f2: 70, gain: .09 }); api.crinkle(8, .18, 1.1); },
      slide(dur = .5, level = 1) { noise(0, dur, { f: 1100, f2: 2400, q: .6, gain: .04 * level, a: dur * .45, pink: true, send: .08 }); },
      whoosh(dur = .45, f = 500, f2 = 2600, level = 1) { noise(0, dur, { f, f2, q: .7, gain: .07 * level, a: dur * .3, send: .3 }); },
      pap(level = 1) { noise(0, .07, { f: 900, type: "lowpass", q: .4, gain: .09 * level, a: .001, pink: true }); tone(0, 190, .09, { f2: 85, gain: .07 * level }); },
      thock(level = 1) { tone(0, 150, .13, { f2: 56, gain: .15 * level }); noise(0, .05, { f: 1900, q: .7, gain: .07 * level }); noise(.04, .12, { f: 600, q: .6, gain: .035 * level }); },
      stamp() { tone(0, 118, .22, { f2: 44, gain: .17, send: .25 }); noise(0, .1, { f: 700, q: .5, gain: .08, pink: true, a: .002 }); noise(.01, .05, { f: 3200, q: 1.2, gain: .04 }); },
      tick(f = 1800, g = .022) { tone(0, f, .03, { type: "square", gain: g, a: .001, send: .05 }); },
      pop() { tone(0, 700, .05, { f2: 420, gain: .06, a: .001 }); noise(0, .05, { f: 2400, q: .5, gain: .04 }); },
      unwrap() { api.crinkle(18, .9, .8); noise(0, .7, { f: 1800, f2: 4200, q: .6, gain: .028, a: .25, pink: true }); },
      swell(dur = 1.3, f = 110, f2 = 233, gain = .07) { tone(0, f, dur, { type: "sawtooth", f2, gain: gain * .35, a: dur * .7, send: .5 }); tone(0, f * 2, dur, { f2: f2 * 2, gain, a: dur * .7, send: .5 }); },
      hush(dur = 1) { noise(0, dur, { f: 380, type: "lowpass", gain: .05, a: dur * .5, pink: true, send: .2 }); },
      reveal(r, vol = 1) {
        if (!ensure()) return; const v = vol;
        if (r === "common") { api.pop(); bell(.03, N.E5, .9, .03 * v, [1, 2.76], .4); }
        else if (r === "uncommon") { pluck(0, N.E5, .05 * v); pluck(.1, N.A5, .055 * v); noise(0, .2, { f: 3200, q: .5, gain: .02, a: .04 }); }
        else if (r === "rare") { api.whoosh(.55, 700, 4200, .8); [N.E5, N.A5, N.B5, N.E6, N.G6].forEach((f, i) => glass(.12 + i * .075, f, 1.4, .045 * v)); [0, .1, .2].forEach((d) => noise(.45 + d, .35, { f: rand(7000, 10000), type: "highpass", gain: .012, a: .08, send: .6 })); }
        else if (r === "special") { api.swell(1.25, 98, 196, .06 * v); bell(.95, N.C5, 2.8, .06 * v); bell(1.03, N.G5, 2.6, .05 * v); bell(1.1, N.E6, 2.4, .04 * v); bell(1.18, N.B5 * 2, 2.2, .025 * v); for (let i = 0; i < 7; i++) tone(1.2 + i * .09, rand(3000, 5200), .22, { gain: .012, a: .002, send: .6 }); }
        else { [N.E5, N.D5, N.B4, N.E5, N.G5, N.A5].forEach((f, i) => pluck(.1 + i * .26, f, .042 * v)); api.hush(1.6); for (let i = 0; i < 9; i++) noise(.2 + Math.random() * 1.6, .012, { f: rand(2500, 5500), q: 2, gain: .02, a: .001, send: .02 }); }
      },
      release() {},
    };
    return api;
  })();
  /** Touch: the app has three patterns (paste = level change, seal/peel = generic). snap = one level change; thud = generic; flourish/bloom = 2/3 level changes. */
  const Hap = { fire(kind) {
    if (kind === "tick") return; const seq = kind === "flourish" ? [0, 90] : kind === "bloom" ? [0, 110, 240] : [0];
    seq.forEach((d) => setTimeout(() => Haptic.tap(kind === "thud" ? "seal" : "paste"), d));
  } };

  /* ---------------------------------------------------------------- particles, light */
  const Fx = (() => {
    const cols = { prism: ["#ffd1ec", "#d3ccff", "#bfe6ff", "#cffbe2", "#fff6c4", "#fff"], gold: ["#ffe9a3", "#ffd05a", "#fff6d6", "#f2b441"], warm: ["#fff3d8", "#ffe0a3", "#fff"], kraft: ["#f2d9a8", "#fff", "#e8bf80"], petal: ["#f9c9d3", "#f4b0c0", "#fde6ea"] };
    const star = (x, px, py, s, rot) => { x.save(); x.translate(px, py); x.rotate(rot); x.beginPath(); for (let i = 0; i < 4; i++) { x.rotate(Math.PI / 2); x.moveTo(0, 0); x.quadraticCurveTo(s * .13, s * .13, s, 0); x.quadraticCurveTo(s * .13, -s * .13, 0, 0); } x.fill(); x.restore(); };
    const petal = (x, px, py, s, rot) => { x.save(); x.translate(px, py); x.rotate(rot); x.beginPath(); x.moveTo(0, -s); x.bezierCurveTo(s * .9, -s * .6, s * .7, s * .6, 0, s); x.bezierCurveTo(-s * .7, s * .6, -s * .9, -s * .6, 0, -s); x.fill(); x.restore(); };
    function layerFor(host) {
      if (host._gx) return host._gx; const c = h("canvas.gx-fx"), dpr = Math.min(2, devicePixelRatio || 1); host.append(c);
      const L = host._gx = { c, dpr, ps: [], raf: 0, x: c.getContext("2d"), last: 0 }; L.fit = () => { c.width = host.clientWidth * dpr; c.height = host.clientHeight * dpr; }; L.fit();
      L.tick = (now) => {
        const dt = Math.min(.05, (now - L.last) / 1000), x = L.x; L.last = now; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, c.width, c.height); let alive = false;
        for (const p of L.ps) {
          p.t += dt; if (p.t < 0) { alive = true; continue; } if (p.t > p.life) { p.dead = true; continue; } alive = true; const k = p.t / p.life;
          p.vy += (p.g ?? 0) * dt; p.vx *= p.drag ?? .985; p.vy *= p.drag ?? .985; p.x += p.vx * 60 * dt; p.y += p.vy * 60 * dt; p.rot += (p.spin ?? 2) * dt;
          const a = (k < .12 ? k / .12 : 1) * (1 - Math.pow(k, 1.6)) * (p.alpha ?? 1) * (p.tw ? .55 + .45 * Math.sin(p.t * p.tw + p.rot) : 1);
          x.globalAlpha = Math.max(0, a); x.fillStyle = p.col; x.globalCompositeOperation = p.add ? "lighter" : "source-over"; const s = p.s * (p.shrink ? 1 - k * .5 : 1);
          if (p.shape === "dot") { x.beginPath(); x.arc(p.x, p.y, s, 0, 7); x.fill(); } else if (p.shape === "petal") petal(x, p.x, p.y, s, p.rot); else star(x, p.x, p.y, s, p.rot);
        }
        x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; L.ps = L.ps.filter((p) => !p.dead);
        if (L.ps.length && host.isConnected) L.raf = requestAnimationFrame(L.tick); else { L.raf = 0; x.clearRect(0, 0, c.width, c.height); }
      };
      return L;
    }
    return {
      emit(host, x, y, { n = 24, kind = "warm", power = 1, shape = "star", add = false, g = 3.6, life = [.7, 1.3], size = [5, 13], spread = Math.PI * 2, dir = -Math.PI / 2, tw = 0 } = {}) {
        if (reduced()) return; const L = layerFor(host), cs = cols[kind] || cols.warm; L.fit();
        for (let i = 0; i < n; i++) { const a = dir + (Math.random() - .5) * spread, v = rand(1.4, 6) * power; L.ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, s: rand(...size), life: rand(...life), t: -Math.random() * .08, col: pick(cs), rot: rand(0, 6), shape, add, g, drag: .985, spin: rand(-3, 3), tw, shrink: true }); }
        if (!L.raf) { L.last = performance.now(); L.raf = requestAnimationFrame(L.tick); }
      },
      drift(host, { n = 30, kind = "gold", shape = "dot", from = "bottom", add = true, life = [1.6, 3], size = [1.2, 3.2], x0 = .1, x1 = .9 } = {}) {
        if (reduced()) return; const L = layerFor(host), w = host.clientWidth, hh = host.clientHeight, cs = cols[kind]; L.fit();
        for (let i = 0; i < n; i++) { const up = from === "bottom"; L.ps.push({ x: rand(w * x0, w * x1), y: up ? rand(hh * .55, hh * 1.02) : rand(-20, hh * .2), vx: rand(-.3, .3), vy: up ? rand(-1.1, -.4) : rand(.5, 1.2), s: rand(...size), life: rand(...life), t: -Math.random() * 1.2, col: pick(cs), rot: rand(0, 6), shape, add, g: 0, drag: .998, spin: rand(-1.5, 1.5), tw: rand(4, 9), shrink: false, alpha: .9 }); }
        if (!L.raf) { L.last = performance.now(); L.raf = requestAnimationFrame(L.tick); }
      },
    };
  })();

  /* ---------------------------------------------------------------- the pouch: a tear that follows the hand, with the real art */
  const PK = {
    holo: { cut: 21, xl: .115, xr: .875, inside: "linear-gradient(180deg,#4d535e,#858c97 60%,#c1c7d0)" },
    kraft: { cut: 23.5, xl: .105, xr: .895, inside: "linear-gradient(180deg,#4a3320,#7b5a38 60%,#b39466)" },
    matte: { cut: 23.5, xl: .10, xr: .90, inside: "linear-gradient(180deg,#6a6254,#a49a88 60%,#d6cebd)" },
  };
  function pouch(run, host, pack, { pw = 250, x = 480, y = 330 } = {}) {
    const kind = PK[pack.kind] ? pack.kind : "holo", C = PK[kind], PW = pw, PH = pw * 4 / 3, cut = C.cut, rnd = rng(7), jag = Array.from({ length: 27 }, (_, i) => [i * 100 / 26, cut + (rnd() - .5) * 1.5]);
    const jagY = (xp) => { const i = clamp(Math.floor(xp / (100 / 26)), 0, 25), a = jag[i], b = jag[i + 1], t = (xp - a[0]) / (b[0] - a[0]); return lerp(a[1], b[1], t); };
    const jagRange = (a, b) => { const pts = [[a, jagY(a)]]; jag.forEach((p) => { if (p[0] > a && p[0] < b) pts.push(p); }); pts.push([b, jagY(b)]); return pts; };
    const polyBody = () => `polygon(${jag.map((p) => `${p[0]}% ${p[1]}%`).join(",")},100% 100%,0 100%)`;
    const polyTop = (a, b) => { const j = jagRange(a, b); return `polygon(${a}% 0,${b}% 0,${[...j].reverse().map((p) => `${p[0]}% ${p[1]}%`).join(",")})`; };
    const tint = PACK_KINDS[kind].foil && pack.hue ? ".tinted" : "";
    const mk = (cls, clip) => h("div.gx-pk-layer." + cls + tint, { style: { clipPath: clip, webkitClipPath: clip, "--hue": (pack.hue || 0) + "deg" } }, PACK_KINDS[kind].foil ? h("i.gx-sheen") : null);
    const body = mk("gx-pk-body", polyBody()), topL = mk("gx-pk-top", polyTop(0, 0.01)), topR = mk("gx-pk-top", polyTop(0.01, 100)), inside = h("div.gx-pk-inside", { style: { background: C.inside } });
    const line = h("i.gx-pk-line"), tab = h("i.gx-pk-tab", h("b", "tear")), slit = h("i.gx-slit"), label = PackLabel({ ...pack, kind, by: pack.by || "Peta" });
    const pouchEl = h("div.gx-pouch", { style: { width: PW + "px", height: PH + "px", "--pk": packVar(kind) } }, inside, body, topR, topL, label, line, tab, slit);
    const wrap = h("div.gx-pk-wrap", { style: { left: x - PW / 2 + "px", top: y - PH / 2 + "px" } }, pouchEl); host.append(wrap);
    line.style.cssText += `;left:${C.xl * 100}%;right:${(1 - C.xr) * 100}%;top:${cut}%`; tab.style.cssText += `;left:${C.xl * 100 - 3}%;top:${cut - 3.8}%`;
    const xL = PW * C.xl, xR = PW * C.xr, cutY = PH * cut / 100, span = xR - xL;
    const rig = { wrap, pouch: pouchEl, PW, PH, cutY, xL, xR, span, inside, topL, topR, body, slit, prog: 0 };
    rig.setTear = (p) => {
      p = clamp(p, 0, 1); rig.prog = p; const head = xL + p * span, hp = head / PW * 100, th = 36 * smooth(p / .22) + 4 * p;
      topL.style.clipPath = topL.style.webkitClipPath = polyTop(0, Math.max(.01, hp)); topR.style.clipPath = topR.style.webkitClipPath = polyTop(Math.max(.01, hp), 100);
      topL.style.transformOrigin = `${head}px ${cutY}px`; topL.style.transform = p > 0 ? `rotate(${th}deg) translate(${p * 2}px, ${-p * 2}px)` : "none";
      const d = head - xL, ax = head - d * Math.cos(th * Math.PI / 180), ay = cutY - d * Math.sin(th * Math.PI / 180);
      inside.style.clipPath = p > 0 ? `polygon(${xL}px ${cutY - 4}px,${head}px ${cutY - 4}px,${ax}px ${ay}px)` : "polygon(0 0,0 0,0 0)"; inside.style.opacity = p > .005 ? 1 : 0;
      line.style.opacity = p > .02 ? 0 : 1; tab.style.opacity = p > .02 ? 0 : 1; slit.style.left = xL + "px"; slit.style.top = cutY - 3 + "px"; slit.style.width = Math.max(0, d) + "px";
    };
    rig.setTear(0);
    const sheen = (e) => { const r = host.getBoundingClientRect(), nx = clamp((e.clientX - r.left) / r.width, 0, 1), ny = clamp((e.clientY - r.top) / r.height, 0, 1); pouchEl.style.setProperty("--sx", lerp(80, 5, nx) + "%"); pouchEl.style.setProperty("--sy", lerp(80, 5, ny) + "%"); };
    host.addEventListener("pointermove", sheen); run.later(() => host.removeEventListener("pointermove", sheen));
    return rig;
  }
  /** The light in the tear: before anything is known, a warm neutral. */
  const SLIT = { bg: "linear-gradient(90deg, rgba(255,240,205,0), rgba(255,240,205,.95) 20%, rgba(255,240,205,.95) 80%, rgba(255,240,205,0))", glow: "0 0 18px 4px rgba(255,236,190,.55)" };
  function tearGesture(run, rig, kit) {
    return new Promise((resolve) => {
      let done = false, marks = 0, lastSnd = 0; const pouchEl = rig.pouch, wrap = rig.wrap; rig.slit.style.background = SLIT.bg; rig.slit.style.boxShadow = SLIT.glow; pouchEl.style.transformOrigin = "50% 100%";
      const apply = (p) => { rig.setTear(p); rig.slit.style.opacity = smooth(p / .45) * .5; const j = Math.sin(performance.now() / 26) * p * 1.4; wrap.style.transform = `translate(${j}px, ${Math.cos(performance.now() / 31) * p * .9}px) rotate(${j * .06}deg)`; };
      const finish = async () => {
        if (done) return; done = true; st.done(); rig.setTear(1); wrap.style.transform = ""; kit.say(""); kit.showSkip(); Sfx.tearSnap(); Hap.fire("snap");
        run.anim(rig.topL, [{ transform: rig.topL.style.transform, opacity: 1 }, { transform: `translate(${rig.PW * .55}px, ${-rig.PH * .6}px) rotate(70deg)`, opacity: 0 }], { duration: 800, easing: "cubic-bezier(.3,.1,.6,1)" });
        rig.inside.style.clipPath = `polygon(${rig.xL}px ${rig.cutY - 3}px,${rig.xR}px ${rig.cutY - 3}px,${rig.xR}px ${rig.cutY - rig.PH * .035}px,${rig.xL}px ${rig.cutY - rig.PH * .035}px)`;
        rig.slit.style.top = rig.cutY - rig.PH * .018 + "px"; rig.slit.style.width = rig.span + "px";
        run.anim(pouchEl, [{ transform: "none" }, { transform: "scale(1.014,.97)", offset: .25 }, { transform: "scale(.996,1.012)", offset: .58 }, { transform: "none" }], { duration: 560 });
        run.anim(rig.slit, [{ opacity: .85, transform: "scaleY(1)" }, { opacity: 1, transform: "scaleY(3.2)", offset: .25 }, { opacity: .55, transform: "scaleY(1.4)" }], { duration: 760, easing: EASE.out });
        await run.wait(260); resolve();
      };
      const spr = (to) => spring(run, { from: rig.prog, to, k: 80, c: 14, onUpdate: (x) => { apply(clamp(x, 0, 1)); const m = Math.floor(x * 8); if (m > marks) { marks = m; Hap.fire("tick"); Sfx.crinkleTick(.8); } if (x >= .995 && to === 1) finish(); }, onDone: () => { if (to === 0) marks = 0; } });
      dragIn(run, pouchEl, {
        down: (e) => { if (done) return false; const r = pouchEl.getBoundingClientRect(); if ((e.clientY - r.top) / r.height > .45) return false; },
        move: (dx) => { if (done) return; const p = clamp(dx / (rig.span * .9), 0, 1); apply(p); const m = Math.floor(p * 8); if (m > marks) { marks = m; Hap.fire("tick"); } const now = performance.now(); if (now - lastSnd > 60) { lastSnd = now; Sfx.crinkleTick(.5 + p * .5); } if (p >= 1) finish(); },
        up: (e, moved, { vx }) => { if (done || !moved) return; if (rig.prog > .5 || vx > 650) spr(1); else { spr(0); Sfx.pap(.4); } },
      });
      const st = step(run, () => spr(1)); activate(run, pouchEl, () => st.go()); pouchEl.setAttribute("role", "button"); pouchEl.setAttribute("aria-label", "Tear the pack open");
    });
  }

  /* ---------------------------------------------------------------- the light of a rarity (the preview's "Mix": light only for the everyday tiers, atmosphere for rare and special, ink for the archive) */
  const CAPTION = { common: "Fresh from the pack.", uncommon: "Nice find.", rare: "Oh — a rare one.", special: "Gold. Look at that.", archive: "From the archive." };
  function lightWorld(run, root, host) {
    const exp = h("i.gx-exp"); $(".cer-bg", root).after(exp); const expApi = {
      el: exp, async set(a, ms = 700) { const v = a; await run.anim(exp, [{ opacity: exp.style.opacity || 0 }, { opacity: v }], { duration: ms, easing: EASE.inOut }); exp.style.opacity = v; },
      spot(x, y) { const wr = host.getBoundingClientRect(), rr = root.getBoundingClientRect(), s = run.scale; exp.style.setProperty("--cx", (wr.left - rr.left + x * s) + "px"); exp.style.setProperty("--cy", (wr.top - rr.top + y * s) + "px"); exp.style.setProperty("--r", Math.max(rr.width, rr.height) * .5 + "px"); },
    }; return expApi;
  }
  const Rare = {
    pre: async (run, { rarity, exp }) => { const t = { common: 0, uncommon: 0, rare: 260, special: 560, archive: 420 }[rarity]; if (t && exp) { exp.set(rarity === "special" ? .46 : rarity === "archive" ? .32 : .2, t + 200); if (rarity === "special" || rarity === "archive") Sfx.hush(.9); } if (t) await run.wait(t); },
    async play(run, { rarity, obj, cx, cy, exp, size, root, host, kit }) {
      const plan = PetaMath.revealPlan(rarity), mix = { common: "A", uncommon: "A", rare: "B", special: "B", archive: "C" }[rarity], reduce = reduced(), fxEls = [];
      const glints = $$(".gx-glint", obj);
      const sweep = (ms, delay = 0, from = -60, to = 150) => Promise.all(glints.map((g) => run.anim(g, [{ "--gl": from + "%" }, { "--gl": to + "%" }], { duration: ms, delay, easing: "cubic-bezier(.35,.1,.2,1)" })));
      Sfx.reveal(rarity); Hap.fire({ common: "tick", uncommon: "snap", rare: "flourish", special: "bloom", archive: "thud" }[rarity]);
      if (exp && plan.dim > 0) { exp.set(plan.dim, 900); kit.dim(plan.dim > .34); } else kit.dim(false);
      const poolSize = { common: .85, uncommon: .95, rare: 1.25, special: 1.45, archive: .8 }[rarity] * size * 1.5;
      const pool = h("i.gx-pool", { data: { aura: rarity === "rare" ? "prism" : "" }, style: { left: cx + "px", top: cy + "px", width: poolSize + "px", height: poolSize + "px", "--rgb": RGB[rarity], opacity: 0 } }); host.append(pool); fxEls.push(pool);
      const pa = { common: .35, uncommon: .5, rare: .62, special: .75, archive: .28 }[rarity];
      run.anim(pool, [{ opacity: 0, transform: "translate(-50%,-50%) scale(.5)" }, { opacity: pa, transform: "translate(-50%,-50%) scale(1)" }], { duration: 900 * TIME[rarity] / 1.3, easing: EASE.out });
      if (rarity !== "archive") sweep({ common: 700, uncommon: 800, rare: 1100, special: 1500 }[rarity]);
      if (rarity === "rare") sweep(1500, 1250); if (rarity === "special") sweep(1700, 1400);
      if (mix === "B" && plan.aura) { const e = h("i.gx-aura", { data: { kind: plan.aura }, style: { opacity: 0 } }, h("i.glow", h("i.spin")), h("i.line", h("i.spin"))); root.append(e); fxEls.push(e); if (reduce) e.style.opacity = .6; else run.anim(e, [{ opacity: 0 }, { opacity: 1, offset: .35 }, { opacity: rarity === "rare" ? .55 : .7 }], { duration: 1900, easing: "ease-out" }); }
      if (!reduce) {
        if (rarity === "uncommon") Fx.emit(host, cx, cy, { n: 10, kind: "kraft", power: .6, size: [2.5, 6], g: 2.2, life: [.6, 1.1], shape: "dot" });
        if (rarity === "rare") Fx.emit(host, cx, cy, { n: 30, kind: "prism", power: 1.2, size: [5, 12], add: true, life: [.9, 1.5], tw: 7 });
        if (rarity === "special") { Fx.emit(host, cx, cy, { n: 34, kind: "gold", power: 1.1, size: [4, 11], add: true, life: [1, 1.8], g: 1.6, tw: 8 }); Fx.drift(host, { n: 40, kind: "gold", shape: "dot", add: true, x0: .22, x1: .78 }); }
        if (rarity === "archive") Fx.drift(host, { n: 26, kind: "petal", shape: "petal", from: "top", add: false, size: [4, 8], life: [3, 5], x0: .15, x1: .85 });
        if (mix === "C") Rare.ink(run, { host, cx, cy, rarity, size, fxEls });
      }
      return { end: async (ms = 700) => { exp?.set(0, ms); kit.dim(false); fxEls.forEach((e) => { run.anim(e, [{ opacity: getComputedStyle(e).opacity }, { opacity: 0 }], { duration: ms }).then(() => e.remove()); }); await run.wait(ms); } };
    },
    /** radiating pen strokes, drawn by hand; a caption only when there is room for one */
    ink(run, { host, cx, cy, rarity, size, fxEls }) {
      const NS = "http://www.w3.org/2000/svg", ink = "rgba(246,226,186,.9)", svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "gx-ink"); host.append(svg); fxEls.push(svg);
      const n = { uncommon: 8, rare: 12, special: 16, archive: 7 }[rarity] || 0, rr = rng(rarity.length * 13 + 5), R0 = size * .62;
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + (rr() - .5) * .22, r1 = R0 * (.98 + rr() * .1), r2 = r1 + 14 + rr() * 26, wob = (rr() - .5) * 6, p = document.createElementNS(NS, "path");
        p.setAttribute("d", `M${cx + Math.cos(a) * r1} ${cy + Math.sin(a) * r1 * .8} Q${cx + Math.cos(a + .03) * (r1 + r2) / 2 + wob} ${cy + Math.sin(a + .03) * (r1 + r2) / 2 * .8} ${cx + Math.cos(a) * r2} ${cy + Math.sin(a) * r2 * .8}`);
        p.setAttribute("fill", "none"); p.setAttribute("stroke", ink); p.setAttribute("stroke-width", "2.4"); p.setAttribute("stroke-linecap", "round"); svg.append(p); const L = p.getTotalLength(); p.style.strokeDasharray = L;
        run.anim(p, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 260, delay: 80 + i * 26, easing: "ease-out" });
      }
    },
  };

  /* ---------------------------------------------------------------- pieces of the sheet */
  const sleeveEl = (p, w) => {
    const r = p.rarity, tell = RANK(r) >= 2;
    const el = h("div.gx-sleeve", { style: { width: w + "px", height: w * .92 + "px" }, data: { r } }, h("div.gx-sl", img("mystery", "gx-covered")));
    if (tell) el.append(h("i", { style: { position: "absolute", inset: "6% 4%", borderRadius: "10px", boxShadow: `0 0 0 1.5px rgba(${RGB[r]},.8), 0 0 14px 2px rgba(${RGB[r]},.5)`, mixBlendMode: "screen", opacity: r === "archive" ? .5 : .9, pointerEvents: "none" } }));
    return el;
  };
  const ringEl = (run, host, cx, cy, r, w) => { const e = h("i.gx-ring", { style: { left: cx - w / 2 - 6 + "px", top: cy - w * .5 - 6 + "px", width: w + 12 + "px", height: w + 12 + "px", boxShadow: `0 0 0 2px rgba(${RGB[r]},.9), 0 0 24px 4px rgba(${RGB[r]},.55)`, zIndex: 11, borderRadius: "16px" } }); host.append(e); return e; };
  function typeIn(run, el, text) {
    el.textContent = ""; el.setAttribute("aria-label", text);
    const spans = [...text].map((c) => { const s = h("span.gx-ch", { "aria-hidden": "true" }, c === " " ? " " : c); el.append(s); return s; });
    return Promise.all(spans.map((s, i) => run.anim(s, [{ opacity: 0, filter: "blur(8px)", transform: "translateY(8px)" }, { opacity: 1, filter: "blur(0)", transform: "none" }], { duration: 520, delay: i * 28, easing: EASE.out })));
  }

  /* ---------------------------------------------------------------- the ceremony */
  async function sheet(cer, pack, n, { keepIt, laterIt }) {
    const root = cer.root; root.dataset.gx = "true"; root.dataset.kind = "pack";
    const host = h("div.gx-world"), skipBtn = h("button.gx-skip", { type: "button" }, "Skip ⏭"); root.append(host);
    const fit = () => { const s = Math.min(root.clientWidth / W, root.clientHeight / H); host.style.transform = `translate(${(root.clientWidth - W * s) / 2}px, ${(root.clientHeight - H * s) / 2}px) scale(${s})`; scale = s; };
    let scale = 1; fit(); const ro = new ResizeObserver(fit); ro.observe(root);
    const run = new Run(host, () => scale); const lit = h("div.gx-lit", h("i.gx-spot"), h("i.gx-floor")); host.append(lit);
    const hint = h("p.gx-hint"), say = (t) => { if (hint.textContent === t) return; hint.textContent = t; if (t) run.anim(hint, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 420 }).catch?.(() => {}); };
    host.append(hint, skipBtn); skipBtn.addEventListener("click", () => run.skip());
    const kit = { say, showSkip: () => skipBtn.classList.add("on"), hideSkip: () => skipBtn.classList.remove("on"), dim: (on) => { root.dataset.tone = on ? "dim" : ""; } };
    const exp = lightWorld(run, root, host); exp.spot(480, 300); const rz = new ResizeObserver(() => exp.spot(480, 300)); rz.observe(root);
    const closeAll = () => { run.stop(); ro.disconnect(); rz.disconnect(); };
    const origClose = cer.close; cer.close = (o) => { closeAll(); return origClose(o); };

    const got = []; let phase = "wrapped", choosing = false, previewFailed = false; root.dataset.phase = phase;
    const slotsData = [];
    const finishWith = async (fn) => { if (choosing) return; choosing = true; await fn(); };
    const rig = pouch(run, host, pack, { pw: 250, x: 480, y: 330 });
    cer.root._esc = () => { if (phase === "sealed" || phase === "finished") laterIt(); else run.skip(); };
    run.play(async () => {
      await run.anim(rig.wrap, [{ opacity: 0, transform: "translateY(60px) rotate(6deg) scale(.9)" }, { opacity: 1, transform: "none" }], { duration: 760, easing: EASE.spring });
      say(`Tear along the top.  ${n} stickers inside.`); rig.pouch.focus({ preventScroll: true });
      await tearGesture(run, rig, kit);
      // ---- the tear is the commit: ten pack_open calls, one atomic step each. Everything below is presentation.
      phase = "loading"; Bridge.busy = true; root.dataset.phase = phase; say("Here they come."); Sfx.slide(.5, 1);
      const cols = 5, cw = 132, ch = 136, gx = 22, gy = 14, gw = cols * cw + (cols - 1) * gx, x0 = (W - gw) / 2, y0 = 112;
      const box = h("div.gx-lightbox", { style: { left: x0 - 26 + "px", top: y0 - 24 + "px", width: gw + 52 + "px", height: 2 * ch + gy + 48 + "px", opacity: 0 } }); host.append(box);
      const grid = h("div.gx-grid"); host.append(grid); run.anim(box, [{ opacity: 0 }, { opacity: 1 }], { duration: 700 });
      const cells = Array.from({ length: n }, (_, i) => { const c = i % cols, r = Math.floor(i / cols), x = x0 + c * (cw + gx), y = y0 + r * (ch + gy); const slot = h("div.gx-slot", { role: "img", "aria-label": `Sealed sticker ${i + 1}`, style: { left: x + "px", top: y + "px", width: cw + "px", height: ch + "px" } }); grid.append(slot); return { slot, x, y, cx: x + cw / 2, cy: y + ch / 2, sleeve: null }; });
      let failure = ""; rig.wrap.style.zIndex = 4; let pouchGone = false;
      for (let i = 0; i < n; i++) {
        let opened; try { opened = await Bridge.invoke("pack_open", { packId: pack.id }); } catch (e) { failure = String(e); break; }
        // Record the committed ID first: a failed preview must never lose an award.
        const one = { entry: { id: opened.stickerId, title: opened.name || "Sticker", rarity: opened.rarity, material: "matte" }, res: null, rarity: opened.rarity || "common" }; got.push(one); pack.left = Array(opened.remaining).fill(null);
        const c = cells[i], el = sleeveEl(one, cw * .96); el.style.left = (cw - cw * .96) / 2 + "px"; el.style.top = (ch - cw * .96 * .92) / 2 + "px"; el.style.zIndex = 16; c.slot.dataset.rarity = one.rarity; c.slot.append(el); c.sleeve = el;
        const sx = 480 - c.cx, sy = 330 - c.cy; Sfx.slide(.18, .6);
        run.anim(el, [{ transform: `translate(${sx}px, ${sy - 30}px) scale(.5) rotate(${rand(-30, 30)}deg)`, opacity: 0 }, { transform: `translate(${sx * .45}px, ${Math.min(sy, 0) - 90}px) scale(1.04) rotate(${rand(-9, 9)}deg)`, opacity: 1, offset: .5 }, { transform: "translate(0,0) scale(1) rotate(0)", opacity: 1 }], { duration: 640, easing: EASE.inOut });
        if (!pouchGone) { pouchGone = true; run.to(rig.pouch, [{ transform: "none", opacity: 1 }, { transform: `translate(${-rig.PW * 1.5}px, ${rig.PH * .42}px) rotate(-14deg) scale(.5)`, opacity: 0 }], { duration: 900, easing: EASE.inOut, delay: 500 }); }
        (async () => { try { const entry = await Bridge.entry(opened.stickerId); one.entry = { ...entry, rarity: opened.rarity, title: opened.name || entry.title }; one.res = await resOf(one.entry); } catch { previewFailed = true; } })();
        await run.wait(70);
      }
      for (const c of cells.slice(got.length)) c.slot.remove();
      try { await Bridge.reload(); } catch (e) { Shell.toast(`Saved to Collection. ${String(e)}`); } Shell.renderNav();
      if (!got.length) { await cer.close(); Bridge.busy = false; Shell.toast(failure); return; }
      if (failure) Shell.toast(`Stopped after ${got.length}. ${failure}`);
      if (!pouchGone) rig.wrap.remove();
      await run.wait(700); Hap.fire("snap");
      // let in-flight previews settle (they are already committed; this only decides what the cell can show)
      for (let t = 0; t < 40 && got.some((g) => !g.res) && !previewFailed; t++) await run.wait(50);
      if (previewFailed) Shell.toast("Saved to Collection. Some previews could not load.");
      phase = "sealed"; root.dataset.phase = phase;
      const go = h("button.gx-btn", { type: "button", style: { left: "50%", bottom: "92px", translate: "-50% 0", zIndex: 40 } }, "Turn them over"); host.append(go); say(`${got.length === 10 ? "Ten" : got.length} stickers.`); kit.showSkip(); go.focus({ preventScroll: true });
      const gDone = (() => { let r; const p = new Promise((q) => { r = q; }); return { p, r }; })();
      const wave = async () => {
        if (phase !== "sealed") return; phase = "revealing"; root.dataset.phase = phase; go.remove(); say(""); stepW.done();
        for (let i = 0; i < got.length; i++) {
          const c = cells[i], p = got[i], r = p.rarity, hot = RANK(r) >= 2;
          const flip = async (slow) => {
            const stkWrap = h("div", { style: { position: "relative" } }); c.slot.append(stkWrap);
            let face; if (p.res) { const w = cw * .95 * Math.min(1, p.res.aspect), stk = Stk.el(p.res, w); stkWrap.append(stk, h("i.gx-glint", { style: { "--mask": `url(${p.res.url})` } })); face = stkWrap; Stk.tilt(stkWrap, { max: 4, scale: 1.015, trigger: c.slot }); } else stkWrap.append(h("span.gx-missing", "Saved to Collection"));
            stkWrap.style.opacity = 0; const sl = c.sleeve; run.anim(sl, [{ transform: "none", opacity: 1 }, { transform: "rotateY(88deg) scale(1.06)", opacity: 0 }], { duration: slow ? 420 : 280, easing: EASE.in });
            await run.wait(slow ? 260 : 170); Sfx.unwrap();
            await run.anim(stkWrap, [{ opacity: 0, transform: "scale(.7) rotateY(-70deg)" }, { opacity: 1, transform: "scale(1.06)", offset: .6 }, { opacity: 1, transform: "none" }], { duration: slow ? 520 : 340, easing: EASE.out });
            c.slot.classList.add("full"); c.slot.setAttribute("aria-label", `${titleOf(p.entry)} · ${r}`); return stkWrap;
          };
          if (hot) {
            await run.wait(180); await Rare.pre(run, { rarity: r, exp }); c.slot.style.zIndex = 30; const rg = ringEl(run, grid, c.cx, c.cy, r, cw); run.anim(rg, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
            await run.anim(c.slot, [{ transform: "none" }, { transform: "scale(1.22)" }], { duration: 420, easing: EASE.out });
            const face = await flip(true), handle = await Rare.play(run, { rarity: r, obj: face, cx: c.cx, cy: c.cy, exp, size: cw * 1.2, root, host, kit });
            await run.wait(TIME[r] * 650); handle.end(600); await run.anim(c.slot, [{ transform: "scale(1.22)" }, { transform: "none" }], { duration: 420, easing: EASE.inOut }); c.slot.style.zIndex = 12; rg.style.opacity = 1; rg.style.zIndex = 11; await run.wait(260);
          } else { flip(false).then(() => { Sfx.reveal(r, .55); Hap.fire(r === "common" ? "tick" : "snap"); if (r === "uncommon") Fx.emit(host, c.cx, c.cy, { n: 8, kind: "kraft", power: .8, size: [2.5, 6], life: [.6, 1], shape: "dot", g: 2 }); $$(".gx-glint", c.slot).forEach((g) => run.anim(g, [{ "--gl": "-60%" }, { "--gl": "150%" }], { duration: 650 })); }); await run.wait(150); }
        }
        await run.wait(700); gDone.r();
      };
      const stepW = step(run, wave); go.addEventListener("click", wave);
      await gDone.p;
      // ---- the result
      exp.set(0, 700); root.dataset.tone = ""; const tally = ["common", "uncommon", "rare", "special", "archive"].map((r) => [r, got.filter((g) => g.rarity === r).length]).filter(([, c]) => c), best = tally.at(-1)?.[0] || "common";
      const seal = h("span.gx-seal", { data: { r: best } }, best), h2 = h("h2", `${got.length} new stickers`), keepBtn = h("button.gx-btn.keep", { type: "button" }, "Stick them"), laterBtn = h("button.gx-btn.quiet", { type: "button" }, "Later");
      const info = h("div.gx-info", { style: { opacity: 0, pointerEvents: "none" } }, h("p.gx-eyebrow", `${pack.title} · ${pack.left.length} left`), h2, h("div.gx-meta", seal, h("span", tally.map(([r, c]) => `${c} ${r}`).join(" · ")), previewFailed ? h("span", "· some previews are unavailable") : null), h("div.gx-btns", keepBtn, laterBtn)); host.append(info); seal.style.opacity = 0;
      info.style.pointerEvents = ""; run.anim(info, [{ opacity: 0 }, { opacity: 1 }], { duration: 360 }); typeIn(run, h2, h2.textContent); await run.wait(260); Sfx.stamp(); Hap.fire("thud");
      await run.anim(seal, [{ opacity: 0, transform: "scale(2.5) rotate(-16deg)" }, { opacity: 1, transform: "scale(.96) rotate(-2.5deg)", offset: .62 }, { opacity: 1, transform: "rotate(-2.5deg)" }], { duration: 380, easing: EASE.out });
      say("Tilt them to catch the light."); phase = "finished"; root.dataset.phase = phase; kit.hideSkip(); keepBtn.focus({ preventScroll: true });
      keepBtn.addEventListener("click", () => { Snd.tap(); finishWith(async () => { info.style.pointerEvents = "none"; say(""); run.anim(info, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 }); Sfx.whoosh(.6, 500, 2400, .6);
        await run.to(grid, [{ transform: "none", opacity: 1 }, { transform: "translateY(260px) scale(.35)", opacity: 0 }], { duration: 760, easing: EASE.in }); Sfx.thock(.8); Hap.fire("snap"); await keepIt(); }); });
      laterBtn.addEventListener("click", () => { finishWith(() => laterIt()); });
    });
    return { cer, run, get phase() { return phase; }, got };
  }
  return { sheet };
})();
