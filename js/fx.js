// Ironwake — transient battle effects on one full-screen canvas: targeting pulses,
// splashes, explosions, fireworks. The loop only runs while something is alive,
// and game logic never waits on it (timing lives in app.js), so a throttled or
// hidden tab cannot stall a match.

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

export class Fx {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.rings = [];
    this.running = false;
    this.reduced = false;
    this.light = false;
    this.last = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear() {
    this.parts.length = 0;
    this.rings.length = 0;
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  kick() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  aim(x, y, size, dur) {
    if (this.reduced) return;
    this.rings.push({
      x, y, r0: size * 0.64, r1: size * 0.2, life: 0, max: dur / 1000,
      color: this.light ? '#a6451a' : '#ffbf63', width: 2,
    });
    this.kick();
  }

  splash(x, y, s = 1) {
    this.rings.push({ x, y, r0: 4 * s, r1: 34 * s, life: 0, max: 0.6, color: this.light ? '#3c6f7a' : '#bfe9e4', width: 2.5 });
    if (this.reduced) return this.kick();
    this.rings.push({ x, y, r0: 2 * s, r1: 56 * s, life: -0.12, max: 0.8, color: this.light ? '#3c6f7a' : '#bfe9e4', width: 1.5 });
    for (let i = 0; i < 22; i++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const v = rand(70, 260) * s;
      this.parts.push({ x, y, vx: Math.cos(a) * v * 0.55, vy: Math.sin(a) * v, life: 0, max: rand(0.45, 0.85), size: rand(1.6, 3.8) * s, color: this.light ? '#4f8590' : '#d9f6f2', g: 620 * s, drag: 0.6, kind: 'drop' });
    }
    this.kick();
  }

  explosion(x, y, s = 1) {
    this.rings.push({ x, y, r0: 6 * s, r1: 58 * s, life: 0, max: 0.4, color: '#ffb347', width: 4 });
    if (this.reduced) return this.kick();
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.3, size: 46 * s, color: '#fff3c9', g: 0, drag: 0, kind: 'flash' });
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU);
      const v = rand(60, 380) * s;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0, max: rand(0.3, 0.8), size: rand(1.8, 4.5) * s, color: Math.random() < 0.5 ? '#ffd166' : '#ff6a3d', g: 260, drag: 2.2, kind: 'spark' });
    }
    for (let i = 0; i < 9; i++) {
      const a = rand(0, TAU);
      const v = rand(10, 60) * s;
      this.parts.push({ x: x + rand(-6, 6), y: y + rand(-6, 6), vx: Math.cos(a) * v, vy: Math.sin(a) * v - 34, life: 0, max: rand(0.8, 1.5), size: rand(9, 20) * s, color: this.light ? '#5b5b5b' : '#39474b', g: -24, drag: 1.2, kind: 'smoke' });
    }
    this.kick();
  }

  fireworks(n = 6) {
    if (this.reduced) return;
    const colors = ['#46f0c4', '#ffbe55', '#ffffff', '#7fd4ff'];
    for (let k = 0; k < n; k++) {
      const x = rand(this.w * 0.15, this.w * 0.85);
      const y = rand(this.h * 0.12, this.h * 0.5);
      const color = colors[k % colors.length];
      const delay = k * 0.28;
      for (let i = 0; i < 44; i++) {
        const a = rand(0, TAU);
        const v = rand(60, 300);
        this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: -delay, max: rand(0.8, 1.5), size: rand(1.6, 3.4), color, g: 150, drag: 1.6, kind: 'spark' });
      }
    }
    this.kick();
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = this.light ? 'source-over' : 'lighter';

    // rings
    for (const r of this.rings) {
      r.life += dt;
      if (r.life < 0) continue;
      const k = r.life / r.max;
      if (k >= 1) continue;
      const e = 1 - (1 - k) * (1 - k);
      c.globalAlpha = (1 - k) * 0.9;
      c.strokeStyle = r.color;
      c.lineWidth = r.width * (1 - k * 0.6);
      c.beginPath();
      c.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, TAU);
      c.stroke();
    }
    this.rings = this.rings.filter((r) => r.life < r.max);

    // particles
    for (const p of this.parts) {
      p.life += dt;
      if (p.life < 0) continue;
      const k = p.life / p.max;
      if (k >= 1) continue;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'smoke') {
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = (1 - k) * 0.42;
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (0.6 + k * 1.3), 0, TAU);
        c.fill();
        c.globalCompositeOperation = this.light ? 'source-over' : 'lighter';
      } else if (p.kind === 'flash') {
        c.globalAlpha = (1 - k) * 0.85;
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (0.4 + k * 0.9), 0, TAU);
        c.fill();
      } else {
        c.globalAlpha = 1 - k * k;
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, TAU);
        c.fill();
      }
    }
    this.parts = this.parts.filter((p) => p.life < p.max);
    c.globalAlpha = 1;

    if (this.parts.length || this.rings.length) {
      requestAnimationFrame((t) => this.frame(t));
    } else {
      this.running = false;
      c.clearRect(0, 0, this.w, this.h);
    }
  }
}
