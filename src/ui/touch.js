import { snapStick } from './touch-logic.js';

// Touch-Bedienung: Daumen-Stick links (vier Richtungen) auf der Karte, Pfeil-Knöpfe im Querschnitt, grosser Knopf rechts
// (Karte: Anker werfen, Querschnitt: Pumpe ein/aus, beim Freispülen: Auslösen). Alle arbeiten unabhängig voneinander (Mehrfinger).
const KNOB_RADIUS = 38;
const DEAD = 5; // Totzone des Sticks in Pixeln

export function setupTouch(input, hooks) {
  const root = document.getElementById('touch-ui'), stick = document.getElementById('stick'), knob = document.getElementById('knob');
  const act = document.getElementById('act'), dpad = document.getElementById('dpad');
  root.hidden = false;
  document.body.classList.add('touch');
  let mode = 'map';

  let stickId = null;
  const moveStick = (e) => {
    const r = stick.getBoundingClientRect(), vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height / 2);
    const s = snapStick(vx, vy, DEAD, input.virtual);
    input.virtual.dx = s.dx; input.virtual.dy = s.dy;
    const len = Math.hypot(vx, vy) || 1, k = Math.min(1, KNOB_RADIUS / len);
    knob.style.transform = `translate(${vx * k}px, ${vy * k}px)`;
  };
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null; input.virtual.dx = 0; input.virtual.dy = 0; knob.style.transform = '';
  };
  stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); e.preventDefault(); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  const pressed = new Map();
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const applyDpad = () => {
    let dx = 0, dy = 0;
    for (const dir of pressed.values()) { dx += DIRS[dir][0]; dy += DIRS[dir][1]; }
    input.virtual.dx = Math.max(-1, Math.min(1, dx)); input.virtual.dy = Math.max(-1, Math.min(1, dy));
  };
  for (const btn of dpad.querySelectorAll('.dp')) {
    const release = (e) => { if (pressed.delete(e.pointerId)) { btn.classList.remove('held'); applyDpad(); } };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); pressed.set(e.pointerId, btn.dataset.dir); btn.classList.add('held'); applyDpad(); });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  act.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (mode === 'tow') { act.setPointerCapture(e.pointerId); input.virtual.suction = true; act.classList.add('held'); return; } // Zugtaste: halten
    if (mode === 'map') hooks.anchor(); else hooks.togglePump();
  });
  const releaseAct = () => { if (mode === 'tow') { input.virtual.suction = false; act.classList.remove('held'); } };
  act.addEventListener('pointerup', releaseAct); act.addEventListener('pointercancel', releaseAct); act.addEventListener('lostpointercapture', releaseAct);
  for (const el of [stick, act]) el.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    setPump(on, clogged = false, tool = 'pump') {
      if (mode !== 'slice') return;
      act.textContent = clogged ? '🔧 Freispülen!' : tool === 'beton' ? (on ? '🧱 Beton AN' : '🧱 Beton AUS') : tool === 'loeffel' ? (on ? '⛏ Löffel AN' : '⛏ Löffel AUS') : on ? '🌀 Pumpe AN' : '🌀 Pumpe AUS';
      act.classList.toggle('held', on && !clogged);
    },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      act.classList.remove('held');
      pressed.clear(); for (const b of dpad.querySelectorAll('.dp')) b.classList.remove('held');
      stick.hidden = m === 'slice'; dpad.hidden = m !== 'slice';
      input.virtual.dx = 0; input.virtual.dy = 0; knob.style.transform = '';
      input.virtual.suction = false;
      act.textContent = { map: '⚓ Anker', slice: '🌀 Pumpe AUS', tow: '🪢 Ziehen (halten)' }[m];
    },
  };
}
