import { CELL, OX, W, H } from './render.js';

// Grafik-Aufwertung der Karte: weiches Gelände mit Hillshade und Schaum, Wasserglitzern, Schiffe mit Kielwasser, Ponton-Sprites, Tag-/Nachtlicht.
// Alles wird im Code gezeichnet (keine Bilddateien). Das Gelände liegt in einem Zwischenbild und wird nur bei Änderungen neu berechnet.

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v; };

// Farbverläufe als Nachschlagetabellen (256 Stufen)
function lut(stops, lo, hi) {
  const out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = lo + ((hi - lo) * i) / 255; let c = stops[stops.length - 1][1];
    for (let k = 1; k < stops.length; k++) if (v <= stops[k][0]) { const [a, ca] = stops[k - 1], [b, cb] = stops[k]; c = mix3(ca, cb, Math.max(0, (v - a) / (b - a))); break; }
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  return out;
}
const WATER = lut([[0, hex('#9be3d6')], [0.6, hex('#62c8cf')], [2, hex('#3b9ac0')], [4, hex('#256f9e')], [7, hex('#143f6d')], [12, hex('#0b2547')]], 0, 12);
const LAND = lut([[-0.2, hex('#e5d49a')], [0.5, hex('#cdbd7a')], [1.2, hex('#87a95a')], [3, hex('#5f8c47')], [6, hex('#3f6b3a')], [12, hex('#5d6b4c')]], -0.2, 12);
const FOREST = hex('#2f5a33'), SAND = hex('#d8c58a');

const T = { canvas: null, ctx: null, noise: null, key: '', at: 0, frame: 0, sparks: [], river: null };

function noiseTexture() {
  if (T.noise) return T.noise;
  const n = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const wx = (x - OX) / CELL, wy = y / CELL; n[y * W + x] = vnoise(wx * 2.2, wy * 2.2) * 0.75 + vnoise(wx * 5.5, wy * 5.5) * 0.25; }
  return (T.noise = n);
}

function renderTerrain(game) {
  const r = game.river, wl = r.wl, { cols, rows } = r;
  if (!T.canvas) { T.canvas = document.createElement('canvas'); T.canvas.width = W; T.canvas.height = H; T.ctx = T.canvas.getContext('2d'); }
  const noise = noiseTexture(), hm = new Float32Array(W * H);
  const xi0 = new Int16Array(W), xf = new Float32Array(W);
  for (let x = 0; x < W; x++) { const c = Math.min(cols - 1, Math.max(0, (x - OX) / CELL - 0.5)), i0 = Math.floor(c); xi0[x] = i0; xf[x] = c - i0; }
  for (let y = 0; y < H; y++) {
    const c = Math.min(rows - 1, Math.max(0, y / CELL - 0.5)), y0 = Math.floor(c), y1 = Math.min(rows - 1, y0 + 1), fy = c - y0;
    for (let x = 0; x < W; x++) {
      const x0 = xi0[x], x1 = Math.min(cols - 1, x0 + 1), fx = xf[x];
      hm[y * W + x] = (r.top[y0 * cols + x0] * (1 - fx) + r.top[y0 * cols + x1] * fx) * (1 - fy) + (r.top[y1 * cols + x0] * (1 - fx) + r.top[y1 * cols + x1] * fx) * fy;
    }
  }
  const img = T.ctx.createImageData(W, H), d8 = img.data, S = 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, h = hm[i], d = wl - h, n = noise[i];
    let R, G, B;
    if (d <= 0) {
      const e = -d + (n - 0.5) * 0.9, li = Math.max(0, Math.min(255, ((e + 0.2) / 12.2) * 255)) | 0;
      const hx = hm[i + (x < W - S ? S : 0)] - hm[i - (x >= S ? S : 0)], hy = hm[i + (y < H - S ? S * W : 0)] - hm[i - (y >= S ? S * W : 0)];
      const sh = Math.min(1.25, Math.max(0.72, 1 + (-hx - hy) * 0.55 * 0.35 * 1.4 + (n - 0.5) * 0.12));
      R = LAND[li * 3] * sh; G = LAND[li * 3 + 1] * sh; B = LAND[li * 3 + 2] * sh;
      if (-d > 2.4) { const f = Math.max(0, vnoise(((x - OX) / CELL) * 2.6, (y / CELL) * 2.6) - 0.5) * 0.9; R += (FOREST[0] - R) * f; G += (FOREST[1] - G) * f; B += (FOREST[2] - B) * f; }
    } else {
      const wi = Math.max(0, Math.min(255, ((d + (n - 0.5) * 0.5) / 12) * 255)) | 0;
      R = WATER[wi * 3]; G = WATER[wi * 3 + 1]; B = WATER[wi * 3 + 2];
      const sed = Math.max(0, 1 - d / 1.4) * (0.55 + n * 0.3) * 0.55; R += (SAND[0] - R) * sed; G += (SAND[1] - G) * sed; B += (SAND[2] - B) * sed; // Sand im Flachen
      if (d < 0.28) { const f = Math.pow(1 - d / 0.28, 1.5) * 0.55; R += (235 - R) * f; G += (248 - G) * f; B += (250 - B) * f; } // Schaum am Ufer
    }
    const o = i * 4; d8[o] = R; d8[o + 1] = G; d8[o + 2] = B; d8[o + 3] = 255;
  }
  T.ctx.putImageData(img, 0, 0);
  // Kandidaten für Wasserglitzern: tiefes Wasser
  T.sparks = [];
  for (let k = 0; k < 400 && T.sparks.length < 90; k++) { const sx = hash(k, 11) * (W - 2 * OX) + OX, sy = hash(k, 12) * H, d = wl - hm[(sy | 0) * W + (sx | 0)]; if (d > 1.4) T.sparks.push({ x: sx, y: sy, p: hash(k, 13) * 6.28, v: 3 + hash(k, 14) * 5 }); }
}

// Gelände neu zeichnen, wenn sich das Flussbett geändert hat (Prüfsumme alle 15 Bilder, höchstens alle 0,35 s)
export function drawTerrain(ctx, game) {
  const r = game.river;
  if (typeof document === 'undefined') return false;
  T.frame++;
  if (!T.canvas || T.river !== r || T.frame % 15 === 0) {
    let sum = 0; for (let i = 0; i < r.top.length; i++) sum += r.top[i] * ((i % 7) + 1);
    const key = `${sum.toFixed(3)}/${r.wl.toFixed(2)}/${r.cols}`, now = performance.now();
    if (!T.canvas || T.river !== r || (key !== T.key && now - T.at > 350)) { renderTerrain(game); T.key = key; T.at = now; T.river = r; }
  }
  ctx.drawImage(T.canvas, 0, 0);
  return true;
}

// Wasserglitzern: kurze helle Striche, die langsam flussabwärts treiben
export function drawWaterFx(ctx, ui) {
  const t = ui.t ?? 0;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = 1.3;
  for (const s of T.sparks) {
    const a = 0.5 + 0.5 * Math.sin(t * 1.6 + s.p); if (a < 0.35) continue;
    const x = OX + ((s.x - OX + t * s.v) % (W - 2 * OX));
    ctx.strokeStyle = `rgba(255,255,255,${0.1 + a * 0.18})`; ctx.beginPath(); ctx.moveTo(x, s.y); ctx.lineTo(x + 8 + s.v, s.y - 1); ctx.stroke();
  }
  ctx.restore();
}

// Kielwasser: Schaumspur hinter dem Heck und zwei dünne, auslaufende Heckwellen (V), kein Lichtkegel
function wake(ctx, L, B, t, seed) {
  ctx.save(); ctx.lineCap = 'round';
  for (let k = 0; k < 9; k++) { // Schaumblasen in der Spur
    const f = k / 8, x = -L / 2 - 3 - f * L * 1.7, y = Math.sin(t * 5 + k * 1.7 + seed) * B * 0.12 * (1 + f), r = B * (0.13 + 0.12 * f);
    ctx.fillStyle = `rgba(255,255,255,${0.36 * (1 - f) * (1 - f)})`; ctx.beginPath(); ctx.ellipse(x, y, r * 1.5, r, 0, 0, 7); ctx.fill();
  }
  for (const sg of [-1, 1]) { // Heckwellen: dünne Linie, die sich aufweitet und ausblendet
    const len = L * 2.3, g = ctx.createLinearGradient(-L * 0.3, 0, -L * 0.3 - len, 0); g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-L * 0.3, sg * B * 0.45);
    for (let k = 1; k <= 12; k++) { const f = k / 12; ctx.lineTo(-L * 0.3 - f * len, sg * (B * 0.45 + f * len * 0.34) + Math.sin(f * 14 + t * 3 + seed) * 0.8); }
    ctx.stroke();
  }
  ctx.restore();
}

const SHIP_COL = { kahn: '#b9824b', motor: '#3f7fc0', tank: '#c44a3f', container: '#e0803a', schub: '#6a4fc0' };
export function drawShipSprite(ctx, cls, ship, p, ui, game, cargoColor) {
  const q = { x: OX + p.x * CELL, y: p.y * CELL }, L = cls.len * CELL, B = cls.beam * CELL * 0.7, t = ui.t ?? 0, moving = ship.state === 'sail';
  ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(p.angle); if (ship.state === 'dock') ctx.scale(0.5, 0.5);
  if (moving) wake(ctx, L, B, t, ship.id ?? 0);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(3, 4, L / 2 + 2, B / 2 + 3, 0, 0, 7); ctx.fill();
  const hull = () => { ctx.beginPath(); ctx.moveTo(-L / 2, -B / 2); ctx.lineTo(L / 2 - B * 0.5, -B / 2); ctx.quadraticCurveTo(L / 2 + 2, 0, L / 2 - B * 0.5, B / 2); ctx.lineTo(-L / 2, B / 2); ctx.closePath(); };
  hull(); const hg = ctx.createLinearGradient(0, -B / 2, 0, B / 2); hg.addColorStop(0, '#2c3a47'); hg.addColorStop(1, '#101a22'); ctx.fillStyle = hg; ctx.fill();
  ctx.save(); ctx.scale(0.88, 0.74); hull(); ctx.fillStyle = cls.color ?? SHIP_COL[cls.id] ?? '#888'; ctx.fill(); const dg = ctx.createLinearGradient(0, -B / 2, 0, B / 2); dg.addColorStop(0, 'rgba(255,255,255,.18)'); dg.addColorStop(1, 'rgba(0,0,0,.35)'); ctx.fillStyle = dg; ctx.fill(); ctx.restore();
  if (cls.id === 'container') { for (let k = 0; k < 4; k++) for (let m = 0; m < 2; m++) { ctx.fillStyle = ['#e0803a', '#3a7ae0', '#d94a4a', '#e0c33a'][(k + m) % 4]; ctx.fillRect(-L / 2 + 4 + k * ((L - B) / 4.4), -B * 0.3 + m * B * 0.3, (L - B) / 4.9, B * 0.27); } }
  else { ctx.fillStyle = cargoColor ?? '#999'; for (let k = 0; k < 3; k++) ctx.fillRect(-L * 0.32 + k * L * 0.2, -B * 0.26, L * 0.15, B * 0.52); ctx.fillStyle = 'rgba(0,0,0,.2)'; for (let k = 0; k < 3; k++) ctx.fillRect(-L * 0.32 + k * L * 0.2, -B * 0.26, L * 0.15, B * 0.52); }
  ctx.fillStyle = '#f2f0e8'; ctx.fillRect(L / 2 - B * 1.0, -B * 0.3, L * 0.16, B * 0.6); ctx.fillStyle = '#35566b'; ctx.fillRect(L / 2 - B * 0.92, -B * 0.22, L * 0.05, B * 0.44);
  ctx.restore();
  (ui._lights ??= []).push({ x: q.x, y: q.y, r: 60, c: '255,226,160' });
}

// Ponton: Rumpf, Kabine, Kran und Saugrohr; beim Saugen Sedimentwolke und schwingender Ausleger
export function drawPontoonSprite(ctx, x, y, own, working, ui) {
  const t = ui.t ?? 0, s = CELL / 22 * 1.0;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  if (working) { for (let k = 0; k < 8; k++) { const a = hash(k, 7) * 6.28 + t * 0.4, rr = 8 + hash(k, 8) * 20; ctx.fillStyle = `rgba(150,120,70,${0.2 - k * 0.018})`; ctx.beginPath(); ctx.arc(Math.cos(a) * rr * 0.8, 14 + Math.sin(a) * rr * 0.5, 9 + hash(k, 9) * 9, 0, 7); ctx.fill(); } }
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(4, 7, 34, 18, 0, 0, 7); ctx.fill();
  const base = own ? ['#f3cf4a', '#c99a1c'] : ['#5ccbe3', '#2c8ba3'], bg = ctx.createLinearGradient(0, -14, 0, 14); bg.addColorStop(0, base[0]); bg.addColorStop(1, base[1]);
  ctx.fillStyle = bg; ctx.strokeStyle = '#142a33'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.roundRect(-30, -15, 60, 30, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(-28, -13, 56, 5); ctx.fillStyle = '#26333b'; ctx.fillRect(-20, -8, 16, 16); ctx.fillStyle = '#9fd8ee'; ctx.fillRect(-18, -6, 12, 7);
  const sw = working ? Math.sin(t * 3) * 3 : 0;
  ctx.strokeStyle = '#2b2f33'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(26, -10); ctx.stroke(); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(26, -10); ctx.lineTo(26 + sw, 18); ctx.stroke();
  ctx.fillStyle = working ? '#7bd88f' : '#ff6b4a'; ctx.beginPath(); ctx.arc(26 + sw, 19, 3, 0, 7); ctx.fill();
  ctx.restore();
  (ui._lights ??= []).push({ x, y, r: 70, c: '255,226,160' });
}

// Tag und Nacht: langsamer Zyklus (6 Minuten Spielzeit), Dämmerung mit warmem Ton, Lichtkegel an Schiffen und Pontons. Zusätzlich eine leichte Vignette.
export function drawAmbient(ctx, game, ui) {
  const lights = ui._lights ?? []; ui._lights = [];
  if (ui.dayNight !== false) {
    const phase = ((game.time ?? 0) % 360) / 360, day = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2), dark = Math.max(0, Math.min(1, (0.55 - day) / 0.4));
    if (dark > 0.01) {
      ctx.fillStyle = `rgba(6,14,44,${dark * 0.42})`; ctx.fillRect(0, 0, W, H);
      const dusk = Math.max(0, 1 - Math.abs(dark - 0.25) / 0.25) * 0.5; if (dusk > 0.01) { ctx.fillStyle = `rgba(255,140,60,${dusk * 0.12})`; ctx.fillRect(0, 0, W, H); }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const l of lights) { const g = ctx.createRadialGradient(l.x, l.y, 3, l.x, l.y, l.r); g.addColorStop(0, `rgba(${l.c},${0.34 * dark})`); g.addColorStop(1, `rgba(${l.c},0)`); ctx.fillStyle = g; ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2); }
      ctx.restore();
    }
  }
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.55, W / 2, H / 2, W * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,12,26,.26)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
}
