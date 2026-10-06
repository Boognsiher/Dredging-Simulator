// Kette als Verlet-Seil: beide Enden sind festgehalten (Laufkatze oben, Pumpe unten), dazwischen hängen
// die Glieder mit etwas Spiel durch, schwingen beim Fahren nach und bauschen sich, wenn die Pumpe hochgezogen
// wird. Rein optisch: die Spiellogik (Pumpenposition) bleibt davon unberührt. Einheit: Pixel.
const GRAVITY = 700; // px/s², unter Wasser gedämpft durch DRAG
const DRAG = 0.94;
const ITERATIONS = 10;

export class Chain {
  constructor(n = 14) {
    this.n = n;
    this.reset();
  }

  reset() { this.p = null; this.q = null; this.owner = null; }

  update(dt, ax, ay, bx, by) {
    const n = this.n;
    if (!this.p) {
      this.p = []; this.q = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), x = ax + (bx - ax) * t + Math.sin(t * Math.PI) * 6, y = ay + (by - ay) * t;
        this.p.push({ x, y }); this.q.push({ x, y }); // kleiner Anfangsbogen: bestimmt, wohin die Kette ausweicht
      }
    }
    const dist = Math.hypot(bx - ax, by - ay);
    this.seg = (dist * 1.02 + 3) / (n - 1); // etwas länger als der Abstand: hängt leicht durch
    const p = this.p, q = this.q;
    const steps = Math.max(1, Math.ceil(dt / 0.016)), h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 1; i < n - 1; i++) {
        const vx = (p[i].x - q[i].x) * DRAG, vy = (p[i].y - q[i].y) * DRAG;
        q[i].x = p[i].x; q[i].y = p[i].y;
        p[i].x += vx; p[i].y += vy + GRAVITY * h * h;
      }
      for (let k = 0; k < ITERATIONS; k++) {
        p[0].x = ax; p[0].y = ay; p[n - 1].x = bx; p[n - 1].y = by;
        for (let i = 0; i < n - 1; i++) {
          const a = p[i], b = p[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6, diff = (d - this.seg) / d;
          const wa = i === 0 ? 0 : 0.5, wb = i + 1 === n - 1 ? 0 : 0.5, wsum = wa + wb || 1;
          a.x += (dx * diff * wa) / wsum; a.y += (dy * diff * wa) / wsum;
          b.x -= (dx * diff * wb) / wsum; b.y -= (dy * diff * wb) / wsum;
        }
      }
      p[0].x = ax; p[0].y = ay; p[n - 1].x = bx; p[n - 1].y = by;
    }
  }

  // Winkel des unteren Kettenstücks (über drei Glieder gemittelt) gegen die Senkrechte, begrenzt: daran pendelt die Pumpe
  endAngle() {
    const a = this.p[this.n - 4], b = this.p[this.n - 1];
    return Math.max(-0.3, Math.min(0.3, Math.atan2(b.x - a.x, b.y - a.y)));
  }
}

export function drawChain(ctx, chain) {
  const p = chain.p;
  ctx.strokeStyle = '#c3cad0'; ctx.lineWidth = 2;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1];
    ctx.save();
    ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
    const rx = chain.seg * 0.62, ry = i % 2 ? 1.6 : 3.4; // Glieder abwechselnd von der Seite und von vorn
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}
