/* Tiny synthesized sounds (no files). Quiet, optional, off with one switch (spec §56). */
const Snd = {
  on: true, ctx: null, master: null,
  ensure() {
    if (!this.on) return null;
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      this.ctx = new C(); this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = b;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  noise(t0, dur, { f = 2000, q = 0.8, type = "bandpass", gain = 0.1, f2 = null, attack = 0.005 } = {}) {
    const c = this.ensure(); if (!c) return;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const flt = c.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, c.currentTime + t0); flt.Q.value = q;
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, c.currentTime + t0 + dur);
    const g = c.createGain(); const T = c.currentTime + t0;
    g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(gain, T + attack); g.gain.exponentialRampToValueAtTime(0.0001, T + dur);
    s.connect(flt).connect(g).connect(this.master); s.start(T, Math.random()); s.stop(T + dur + 0.05);
  },
  tone(t0, freq, dur, { type = "sine", gain = 0.1, f2 = null, attack = 0.005 } = {}) {
    const c = this.ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), T = c.currentTime + t0;
    o.type = type; o.frequency.setValueAtTime(freq, T); if (f2) o.frequency.exponentialRampToValueAtTime(f2, T + dur);
    g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(gain, T + attack); g.gain.exponentialRampToValueAtTime(0.0001, T + dur);
    o.connect(g).connect(this.master); o.start(T); o.stop(T + dur + 0.05);
  },
  swoosh() { this.noise(0, 0.35, { f: 500, f2: 2600, q: 0.7, gain: 0.07, attack: 0.08 }); },
  flip() { this.noise(0, 0.5, { f: 900, f2: 3200, q: 0.5, gain: 0.06, attack: 0.12 }); this.noise(0.32, 0.12, { f: 2400, q: 0.4, type: "highpass", gain: 0.03 }); },
  tick() { this.tone(0, 1200, 0.03, { type: "square", gain: 0.02 }); },
  tap() { this.tone(0, 330, 0.06, { gain: 0.05, f2: 220 }); },
  crinkle(n = 10, span = 0.5) { for (let i = 0; i < n; i++) this.noise(Math.random() * span, rand(0.015, 0.05), { f: rand(3500, 7500), q: 0.9, type: "bandpass", gain: rand(0.03, 0.08) }); },
  tear() { this.noise(0, 0.5, { f: 4200, q: 0.6, type: "highpass", gain: 0.07, attack: 0.02 }); this.crinkle(14, 0.5); },
  peta() { this.tone(0, 190, 0.11, { gain: 0.16, f2: 62 }); this.noise(0, 0.05, { f: 1800, q: 0.7, gain: 0.08 }); this.noise(0.05, 0.12, { f: 600, q: 0.6, gain: 0.04 }); },
  chime(n = 3, base = 880) { for (let i = 0; i < n; i++) { this.tone(i * 0.09, base * Math.pow(1.5, i % 3) * (i > 2 ? 2 : 1), 0.9, { gain: 0.035, attack: 0.01 }); } },
  seal() { this.tone(0, 140, 0.18, { gain: 0.12, f2: 55 }); this.noise(0, 0.08, { f: 900, q: 0.6, gain: 0.05 }); },
  feed(steps = 14, span = 2) { for (let i = 0; i < steps; i++) this.noise(i * (span / steps), 0.05, { f: 1500 + (i % 2) * 400, q: 1.2, gain: 0.03 }); },
  crack() { this.noise(0, 0.07, { f: 3000, q: 1.5, gain: 0.1 }); this.tone(0, 420, 0.08, { type: "triangle", gain: 0.05, f2: 180 }); },
  /* The sound of a rarity: the same family of notes, brighter and longer as the light does more.
     Common is a soft paper pop; the archive is a small music box in a quiet room. */
  glass(t0, f, dur = 1.1, gain = 0.045) { [1, 2.003, 3.01, 4.17].forEach((r, i) => this.tone(t0, f * r, dur / (1 + i * 0.4), { gain: gain / (1 + i * 1.1), attack: 0.002 })); },
  bell(t0, f, dur = 2.2, gain = 0.055) { [1, 2.76, 5.4, 8.93].forEach((r, i) => this.tone(t0, f * r, dur / (1 + i * 0.55), { gain: gain / (1 + i * 0.9), attack: 0.003 })); },
  pluck(t0, f, gain = 0.05) { this.tone(t0, f, 0.9, { type: "triangle", gain, attack: 0.002 }); this.tone(t0, f * 2.01, 0.35, { gain: gain * 0.35, attack: 0.002 }); },
  hush(dur = 0.9) { this.noise(0, dur, { f: 380, type: "lowpass", gain: 0.05, attack: dur * 0.5 }); },
  reveal(rarity, volume = 1) {
    const v = volume;
    if (rarity === "uncommon") { this.pluck(0, 659.3, 0.05 * v); this.pluck(0.1, 880, 0.055 * v); }
    else if (rarity === "rare") { this.swoosh(); [659.3, 880, 987.8, 1318.5, 1568].forEach((f, i) => this.glass(0.12 + i * 0.075, f, 1.4, 0.045 * v)); }
    else if (rarity === "special") { this.tone(0, 98, 1.25, { type: "sawtooth", f2: 196, gain: 0.02 * v, attack: 0.9 }); this.tone(0, 196, 1.25, { f2: 392, gain: 0.06 * v, attack: 0.9 }); [523.3, 784, 1318.5].forEach((f, i) => this.bell(0.95 + i * 0.07, f, 2.6, 0.05 * v)); }
    else if (rarity === "archive") { [659.3, 587.3, 493.9, 659.3, 784, 880].forEach((f, i) => this.pluck(0.1 + i * 0.26, f, 0.042 * v)); this.hush(1.6); }
    else { this.tone(0, 700, 0.05, { f2: 420, gain: 0.06, attack: 0.001 }); this.glass(0.03, 659.3, 0.9, 0.03 * v); }
  },
};

// Tactile feedback is independent of sounds and reduced motion; unsupported hardware is silent.
const Haptic = {
  on: true,
  tap(kind) {
    if (!this.on || !["paste", "peel", "seal"].includes(kind)) return;
    window.__TAURI__?.core.invoke("haptic_tap", { kind }).catch(() => {});
  },
};
