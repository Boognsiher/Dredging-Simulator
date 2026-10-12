import { RHEIN } from '../sim/world.js';
import { depositType, ENDLESS } from '../config.js';

// Weltkarte: der Rhein als Folge von Abschnitten (= Karten). Zeigt, welche erschlossen sind, was sie bieten (Rohstoffe, Öl, regionale Preise) und was der nächste Abschnitt kostet.
const chf = (n) => `${Math.round(n).toLocaleString('de-CH')} CHF`;
const PRICE = { kies: 'Kies', oel: 'Öl', container: 'Container' };
const tag = (b) => (b <= -0.08 ? `<span class="pos">günstig ${Math.round(b * 100)} %</span>` : b >= 0.08 ? `<span class="neg">teuer +${Math.round(b * 100)} %</span>` : '<span class="zero">normal</span>');

// Daten eines Abschnitts: erschlossene Karten zeigen die echten Werte, noch gesperrte die festen Eigenschaften des Rheins
export function stationInfo(g, k) {
  const S = RHEIN[k], m = g.maps[k] ?? null;
  const dep = m ? m.river.deposits.filter((d) => !d.depleted) : null;
  const oil = m ? (m.oilStart !== undefined ? m.oilStart > 0 : m.oil ?? null) : S?.oil ?? null;
  const bias = m ? m.market?.bias ?? S?.bias : S?.bias;
  const known = dep ? dep.filter((d) => d.known) : null;
  return { name: m?.name ?? S?.name ?? `Abschnitt ${k + 1}`, note: S?.note ?? '', unlocked: !!m, current: m && k === g.mapIdx, pos: S?.pos ?? [50, 50], dep, known, depTypes: S?.dep ?? [], oil, bias, hard: !!S?.hard };
}

export function worldHtml(g, sel) {
  const n = Math.min(RHEIN.length, ENDLESS.maxMaps), st = Array.from({ length: n }, (_, k) => stationInfo(g, k));
  const pts = st.map((s) => s.pos), path = (a, b) => pts.slice(a, b).map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  const open = g.maps.length; // Anzahl erschlossener Abschnitte
  const svg = `<svg viewBox="0 0 100 100" class="wmap" role="img" aria-label="Rhein von Rheinfelden bis Rotterdam">
    <rect width="100" height="100" rx="4" fill="#0f2f4d"/>
    <path d="M0,0 H46 C40,8 32,4 24,14 C16,22 10,18 0,26 Z" fill="#18517a"/>
    <path d="M28,100 L100,100 L100,0 L52,0 C46,12 40,16 36,26 C32,38 26,46 30,60 C34,72 24,86 28,100 Z" fill="#3f6b3a" opacity=".9"/>
    <path d="M60,100 L100,100 L100,60 C86,66 74,62 68,74 C62,84 66,92 60,100 Z" fill="#8a8f98" opacity=".75"/>
    <text x="8" y="8" class="wlab dim">Nordsee</text><text x="78" y="92" class="wlab dim">Alpen</text>
    <path d="${path(0, n)}" fill="none" stroke="#5a7a8f" stroke-width="1.4" stroke-dasharray="1.6 1.6" stroke-linecap="round"/>
    ${open > 1 ? `<path d="${path(0, Math.min(open, n))}" fill="none" stroke="#5cc8f0" stroke-width="1.8" stroke-linecap="round"/>` : ''}
    ${st.map((s, k) => `<g data-st="${k}" class="wst ${s.unlocked ? 'on' : k === open ? 'next' : 'off'} ${s.current ? 'cur' : ''} ${k === sel ? 'sel' : ''}">
      <circle cx="${s.pos[0]}" cy="${s.pos[1]}" r="${k === sel ? 3.6 : 3}"/>
      <text x="${s.pos[0] + 5}" y="${s.pos[1] + 1}" class="wlab">${s.unlocked ? '' : '🔒 '}${s.name}</text>
      <text x="${s.pos[0] + 5}" y="${s.pos[1] + 4.4}" class="wlab dim">${[s.oil ? '🛢' : '', (s.dep ?? s.depTypes).some((d) => (d.type ?? d) === 'seife') ? '💎' : '', (s.dep ?? s.depTypes).some((d) => (d.type ?? d) === 'delta') ? '🌾' : '', s.hard ? '🪨' : ''].join(' ')}</text>
    </g>`).join('')}
  </svg>`;
  const s = st[sel] ?? st[0], k = st[sel] ? sel : 0, cost = g.mapCost?.();
  let action = '';
  if (s.current) action = '<button disabled>▶ Aktuelle Karte</button>';
  else if (s.unlocked) action = `<button class="primary" data-world="go" data-k="${k}">▶ Hierher wechseln</button>`;
  else if (k === open) { const blk = g.mapBlock(); action = `<button class="primary" data-world="add" ${blk ? 'disabled' : ''}>Erschliessen (${cost === null ? '–' : chf(cost)})</button>${blk ? `<small class="warn">${blk}</small>` : ''}`; }
  else action = `<small>Erst «${st[open]?.name ?? 'der vorherige Abschnitt'}» erschliessen.</small>`;
  const depNames = s.dep ? [...s.known.map((d) => depositType(d.type)?.name ?? d.name), ...(s.dep.length > s.known.length ? [`${s.dep.length - s.known.length}× unerkundet`] : [])] : [...new Set(s.depTypes)].map((t) => depositType(t)?.name ?? t);
  const card = `<div class="wcard"><b>${s.unlocked ? '' : '🔒 '}${s.name}</b> <small>Abschnitt ${k + 1} von ${n} · Schwierigkeit ${k + 1}</small><p>${s.note}</p>
    <div><b>Vorkommen:</b> ${depNames.length ? depNames.join(', ') : '–'}</div>
    <div><b>Öl:</b> ${s.oil === null ? '?' : s.oil ? 'Ölvorkommen (Ölfeld bauen)' : 'kein Öl'}${s.hard ? ' · <b>Fels</b>: Löffel/Fräse nötig' : ''}</div>
    <div class="wprice">${Object.entries(PRICE).map(([id, nm]) => `<span>${nm}: ${tag(s.bias?.[id] ?? 0)}</span>`).join('')}</div>
    <div class="wact">${action}</div></div>`;
  return `<div class="books-head"><h2>🗺 Rhein</h2><button data-world="close" aria-label="Schliessen">✕</button></div>
    <div class="wlayout">${svg}${card}</div>
    <small>Der Rhein von Rheinfelden bis Rotterdam, Abschnitt für Abschnitt flussabwärts. 🛢 Öl · 💎 Erzseife · 🌾 Kies-Delta · 🪨 Felsriegel. Preise zeigen, wo Kies, Öl und Container günstig zu kaufen oder teuer zu verkaufen sind.</small>`;
}

export function setupWorld(getGame, { go, add }) {
  const el = document.createElement('div'); el.id = 'world'; el.hidden = true; document.body.append(el);
  let open = false, sel = 0;
  const render = () => { const g = getGame(); if (sel >= RHEIN.length) sel = 0; el.innerHTML = `<div class="books-card">${worldHtml(g, sel)}</div>`; };
  const set = (v) => { open = v; el.hidden = !v; if (v) { sel = getGame().mapIdx; render(); } };
  el.addEventListener('click', (e) => {
    const st = e.target.closest('[data-st]'); if (st) { sel = +st.dataset.st; render(); return; }
    const a = e.target.closest('[data-world]');
    if (a) { const w = a.dataset.world; if (w === 'close') set(false); else if (w === 'go') { go(+a.dataset.k); set(false); } else if (w === 'add') { const k = add(); if (k !== false && k != null) sel = k; render(); } return; }
    if (e.target === el) set(false);
  });
  addEventListener('keydown', (e) => { if (open && e.code === 'Escape') set(false); });
  const btn = document.getElementById('btn-world'); if (btn) btn.onclick = () => set(!open);
  return { toggle: () => set(!open), isOpen: () => open };
}
