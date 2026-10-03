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
};
