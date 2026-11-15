// Ironwake — sound effects, synthesised live with the Web Audio API.
// No audio files: every sound is oscillators and filtered noise.

export class Sfx {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.out = null;
    this.noiseBuf = null;
  }

  /** Must be called from a user gesture; safe to call repeatedly. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.7;
        this.out.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 2;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }

  play(name) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const fn = SOUNDS[name];
    if (!fn) return;
    try { fn(this, this.ctx.currentTime + 0.01); } catch { /* audio must never break the game */ }
  }

  tone(t, { type = 'sine', f0, f1 = f0, dur, gain = 0.3, attack = 0.005, curve = 'exp' }) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(t, { dur, gain = 0.3, type = 'lowpass', f0 = 1000, f1 = f0, q = 0.8, attack = 0.005 }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
}

const SOUNDS = {
  click(s, t) {
    s.tone(t, { type: 'triangle', f0: 880, f1: 660, dur: 0.06, gain: 0.12 });
  },
  toggle(s, t) {
    s.tone(t, { type: 'triangle', f0: 520, f1: 780, dur: 0.08, gain: 0.12 });
  },
  place(s, t) {
    s.tone(t, { type: 'sine', f0: 190, f1: 90, dur: 0.14, gain: 0.35 });
    s.noise(t, { dur: 0.07, gain: 0.12, type: 'highpass', f0: 2500 });
  },
  rotate(s, t) {
    s.tone(t, { type: 'triangle', f0: 420, f1: 620, dur: 0.09, gain: 0.14 });
  },
  error(s, t) {
    s.tone(t, { type: 'square', f0: 150, f1: 110, dur: 0.16, gain: 0.1 });
    s.tone(t + 0.09, { type: 'square', f0: 120, f1: 90, dur: 0.16, gain: 0.1 });
  },
  ping(s, t) {
    s.tone(t, { f0: 1320, dur: 0.9, gain: 0.16, attack: 0.002 });
    s.tone(t + 0.22, { f0: 1320, dur: 0.7, gain: 0.05, attack: 0.002 });
    s.tone(t + 0.44, { f0: 1320, dur: 0.5, gain: 0.02, attack: 0.002 });
  },
  deploy(s, t) {
    [392, 523, 659].forEach((f, i) => s.tone(t + i * 0.09, { type: 'triangle', f0: f, dur: 0.22, gain: 0.16 }));
  },
  fire(s, t) {
    s.tone(t, { f0: 150, f1: 38, dur: 0.32, gain: 0.55 });
    s.noise(t, { dur: 0.22, gain: 0.3, f0: 2600, f1: 300 });
    s.tone(t + 0.05, { f0: 1500, f1: 520, dur: 0.48, gain: 0.035, curve: 'lin' }); // shell whistle
  },
  splash(s, t) {
    s.noise(t, { dur: 0.5, gain: 0.26, type: 'bandpass', f0: 900, f1: 2800, q: 0.7, attack: 0.02 });
    s.noise(t + 0.08, { dur: 0.7, gain: 0.1, type: 'highpass', f0: 3200, attack: 0.1 });
    s.tone(t, { f0: 240, f1: 70, dur: 0.2, gain: 0.16 });
  },
  hit(s, t) {
    s.tone(t, { f0: 110, f1: 30, dur: 0.6, gain: 0.7 });
    s.noise(t, { dur: 0.55, gain: 0.55, f0: 3200, f1: 180, attack: 0.002 });
    s.noise(t + 0.03, { dur: 0.12, gain: 0.25, type: 'highpass', f0: 4000 });
    s.tone(t, { type: 'square', f0: 70, f1: 40, dur: 0.25, gain: 0.12 });
  },
  sunk(s, t) {
    SOUNDS.hit(s, t);
    s.tone(t + 0.12, { f0: 80, f1: 24, dur: 1.5, gain: 0.6 });
    s.noise(t + 0.1, { dur: 1.6, gain: 0.3, f0: 900, f1: 90, attack: 0.05 });
    s.tone(t + 0.25, { type: 'sawtooth', f0: 320, f1: 60, dur: 1.2, gain: 0.05, curve: 'lin' }); // groaning hull
    for (let i = 0; i < 7; i++) { // bubbles
      const f = 500 + Math.random() * 700;
      s.tone(t + 0.7 + i * 0.11, { f0: f, f1: f * 1.8, dur: 0.07, gain: 0.05 });
    }
  },
  win(s, t) {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => {
      s.tone(t + i * 0.13, { type: 'triangle', f0: f, dur: i === 6 ? 0.9 : 0.24, gain: 0.2 });
      s.tone(t + i * 0.13, { type: 'sine', f0: f / 2, dur: i === 6 ? 0.9 : 0.24, gain: 0.12 });
    });
  },
  lose(s, t) {
    [392, 349, 311, 233].forEach((f, i) => {
      s.tone(t + i * 0.26, { type: 'triangle', f0: f, dur: i === 3 ? 1.2 : 0.36, gain: 0.18 });
      s.tone(t + i * 0.26, { type: 'sine', f0: f / 2, dur: i === 3 ? 1.2 : 0.36, gain: 0.14 });
    });
  },
};
