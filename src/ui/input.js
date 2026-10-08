import { isTap } from './touch-logic.js';

// Tastatur (WASD/Pfeile, Leertaste), Maus und Touch. Einmal-Tasten (Anker werfen/lichten) via tap().
// Maus: Pumpe/Ponton folgt dem Zeiger, gedrückt = saugen. Touch: Der Spielfeld-Touch ist nur ein Tippen
// (onTap); bewegt wird mit dem virtuellen Stick und gesaugt mit dem Saugen-Knopf (siehe touch.js).
export function createInput(canvas) {
  const keys = new Set();
  const taps = new Set();
  const pointer = { active: false, down: false, x: 0, y: 0 }; // Canvas-Pixel (nur Maus/Stift)
  const virtual = { dx: 0, dy: 0, suction: false }; // wird vom Touch-Stick und -Knopf gesetzt
  let tapHandler = null;
  let touchStart = null, dragHandler = null;

  addEventListener('keydown', (e) => {
    if (!e.repeat) taps.add(e.code);
    keys.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * (canvas.logicalW ?? canvas.width), y: ((e.clientY - r.top) / r.height) * (canvas.logicalH ?? canvas.height) }; // logische Einheiten, unabhängig von der Render-Auflösung
  };
  const setPos = (e) => { Object.assign(pointer, toCanvas(e)); pointer.active = true; };

  canvas.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') setPos(e); });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') { touchStart = { ...toCanvas(e), cx: e.clientX, cy: e.clientY, t: performance.now(), id: e.pointerId }; return; }
    setPos(e); pointer.down = true; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || !touchStart || touchStart.id !== e.pointerId || !dragHandler) return;
    if (!touchStart.drag && Math.hypot(e.clientX - touchStart.cx, e.clientY - touchStart.cy) < 10) return;
    dragHandler(e.clientX - (touchStart.lx ?? touchStart.cx), e.clientY - (touchStart.ly ?? touchStart.cy));
    touchStart.drag = true; touchStart.lx = e.clientX; touchStart.ly = e.clientY;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') {
      if (touchStart && !touchStart.drag && touchStart.id === e.pointerId && isTap(Math.hypot(e.clientX - touchStart.cx, e.clientY - touchStart.cy), performance.now() - touchStart.t)) {
        tapHandler?.(touchStart.x, touchStart.y);
      }
      touchStart = null;
      return;
    }
    pointer.down = false;
  });
  canvas.addEventListener('pointercancel', () => { pointer.down = false; touchStart = null; });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !pointer.down) pointer.active = false; });

  return {
    virtual,
    onDrag(fn) { dragHandler = fn; }, // Ziehen mit dem Finger (Client-Pixel, Differenz zum letzten Ereignis)
    onTap(fn) { tapHandler = fn; }, // Tippen aufs Spielfeld (Canvas-Pixel)
    // cur = Position des gesteuerten Objekts in Canvas-Pixeln. holdToMove: Maus steuert nur bei gedrückter Taste.
    read(cur, { holdToMove = false, soft = false, keysOnly = false } = {}) {
      let dx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      let dy = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
      if (!dx && !dy) { dx = virtual.dx; dy = virtual.dy; } // Touch-Stick
      if (!keysOnly && !dx && !dy && pointer.active && (!holdToMove || pointer.down)) {
        const tx = pointer.x - cur.x, ty = pointer.y - cur.y, d = Math.hypot(tx, ty);
        if (d > (soft ? 8 : 4)) { const k = Math.min(1, d / (soft ? 40 : 16)); // schon kleiner Abstand = volles Tempo, ohne Anlaufphase
          dx = (tx / d) * k; dy = (ty / d) * k; }
      }
      return { dx, dy, suction: keys.has('Space') || pointer.down || virtual.suction };
    },
    tap(...codes) { return codes.some((c) => taps.has(c)); },
    endFrame() { taps.clear(); },
  };
}
