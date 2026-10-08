import { buyShip, sellShip, setRoute, routeInfo, shipBlock, withMap, SHIPPING } from './sim/shipping.js';
import { PORT, buyPrice, sellPrice, machineOf, isDocked, cycleWaitCargo, loadHit as portLoadHit } from './sim/port.js';
import { buildRoad, buildHall, autoRoad, demolishAt, roadBlock, hallBlock, landOf, LAND } from './sim/land.js';
import { LEVELS, ENDLESS, levelById, CONFIG, UPGRADES, SHIPS, CARGOS, KIND, shipById, cargoById, depositType } from './config.js';
import { Game } from './sim/game.js';
import { acceptContract } from './sim/contracts.js';
import { waitingByClass, shipPos } from './sim/traffic.js';
import { lentUnit, lendBlock, lendPonton, recallPonton, hireUnit, hireBlock, dismissUnit, nextHireCost, setGoal, setWiden, setPour, setMine, setAvoid, targetClass, addArea, addRoute, setAreaWidth, setZoneUnit, setUnitLoc, planPile, clearPilePlan, lineCells, PILE, removeArea, setAreaDepth, setAreaUnit, areaWork, MAX_AREAS } from './sim/fleet.js';
import { bayCapacity, maxZones, zoneClasses } from './sim/traffic.js';
import { materialPrice } from './sim/plant.js';
import { TowSim, groundedNear } from './sim/tow.js';
import { makeHarborView, HARBOR, waitPos } from './sim/harbor.js';
import { toolName } from './sim/dredge.js';
import { priceOf, trend } from './sim/market.js';
import { needDepth, minNeedDepth } from './sim/fairway.js';
import { Advisor } from './sim/advisor.js';
import { serializeGame, restoreGame, savedSummary } from './sim/save.js';
import { createInput } from './ui/input.js';
import { setupTouch } from './ui/touch.js';
import { steerToward } from './ui/touch-logic.js';
import { setupPort } from './ui/port.js';
import { fitSize, renderQuality } from './ui/layout.js';
import { hintsFor } from './ui/hints.js';
import { Fx } from './ui/fx.js';
import { createAudio } from './ui/audio.js';
import { view, CELL, OX, sizeCanvas, drawMap, drawHarborScene, drawSlice, drawTowView, autoLineX, sliceHeadScreen, sliceMouthScreen, sliceY } from './ui/render.js';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const chf = (n) => `${Math.round(n).toLocaleString('de-CH')} CHF`;
const num = (n) => Math.round(n).toLocaleString('de-CH');
const pct = (v) => `${Math.round(v * 100)}%`;

// ---------- Browser-Speicher: Rekorde, Spielstand, Einstellungen (alles darf fehlen) ----------
const LEVELS_KEY = 'dredging.levels', SAVE_KEY = 'dredging.save', FRITZ_KEY = 'dredging.fritz', MUTE_KEY = 'dredging.fritz.muted';
const loadLevels = () => { try { return JSON.parse(localStorage.getItem(LEVELS_KEY) ?? '{}'); } catch { return {}; } };
const loadBest = (id = game.levelId) => loadLevels()[id] ?? null;
const saveBest = (v, id = game.levelId) => { try { localStorage.setItem(LEVELS_KEY, JSON.stringify({ ...loadLevels(), [id]: v })); } catch { /* egal */ } };
const levelUnlocked = (i) => i === 0 || (loadLevels()[LEVELS[i - 1].id] ?? 0) > 0;
const readSave = () => { try { return localStorage.getItem(SAVE_KEY); } catch { return null; } };
const clearSave = () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* egal */ } };
let saveClock = 0, savedDay = 0, stateSig = null, stateSigTimer = 0;
const gameSig = () => JSON.stringify([game.levels, game.contracts.map((c) => c.id + c.status), game.targetDepth, game.pumpSpeed]);
function saveGame() {
  if (game.status !== 'playing' || overlayOpen()) return;
  try { localStorage.setItem(SAVE_KEY, serializeGame(game)); savedDay = game.day; saveClock = 0; } catch { /* Speicher voll oder gesperrt: egal */ }
}
const fritzOn = () => { try { return localStorage.getItem(FRITZ_KEY) !== '0'; } catch { return true; } };
const loadMuted = () => { try { return JSON.parse(localStorage.getItem(MUTE_KEY) ?? '[]'); } catch { return []; } };
const saveMuted = (a) => { try { localStorage.setItem(MUTE_KEY, JSON.stringify([...a])); } catch { /* egal */ } };

let advisor = new Advisor(loadMuted());
advisor.enabled = fritzOn();
let tipOpen = false, tipTimer = 0;
const fx = new Fx();
const audio = createAudio();
let game = new Game();
let sim = game.createSession(); sim.autoRange = game.autoRange ?? null;
let paused = false, endShown = false;
const readInput = createInput(canvas);
sizeCanvas(canvas);
let mapTarget = null;
let harborView = false, mainSim = null, harborSim = null; // Hafenkarte: eigener Ponton fährt im Becken, die Hauptkarte pausiert für ihn
let classSel = null; // gewählte Schiffsklasse: Engstellen auf Karte und Querschnitt
let sheetOpen = false, menuOpen = false, mapFull = false, panYm = 0;
let pileMode = false, pileTool = 'cell', pileA = null, pileZoom = 2.4; const planFocus = { x: 22, y: 18 }; // Pfahlwand planen (Karte, gezoomt): Zellen antippen oder Linie ziehen
let landMode = false, landTool = 'road'; // Landseite des Hafens bauen (Karte)
let areaKind = 'rect'; // 'rect' = Rechteck, 'route' = Linie mit Wegpunkten (beide über areaMode)
let areaMode = false; // Arbeitsgebiet für gemietete Pontons aufziehen (Karte): zwei Ecken antippen
let zoneMode = false; // Kreuzungsstellen setzen/entfernen (Karte)
let tow = null; // Minispiel: Aufläufer freischleppen
const curMode = () => (tow ? 'tow' : sim.mode);
const narrow = () => matchMedia('(max-width: 860px)').matches;
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const ui = { classSel: null, floaters: [], t: 0, dt: 1 / 60, mapTarget: null };

// ---------- Schiffsklassen oben ----------
function buildClassbar() {
  const bar = $('classbar'), nodes = [];
  game.level.classes.forEach((id, k) => {
    const cls = shipById(id), b = document.createElement('button');
    b.className = 'cls'; b.dataset.id = id; b.title = `Taste ${k + 1}`;
    b.innerHTML = `<span class="wait" hidden></span><b><i class="dot" style="background:${cls.color}"></i>${cls.icon} ${cls.name}</b><small></small>`;
    b.onclick = () => chooseClass(id);
    nodes.push(b);
  });
  bar.replaceChildren(...nodes);
}
function chooseClass(id) {
  if (mapFull && sim.mode !== 'slice') { // Kartenvollbild: nur eine Klasse sichtbar, Antippen schaltet zur nächsten um
    const ids = game.level.classes, cur = pickedClass(); id = ids[(ids.indexOf(cur) + 1) % ids.length];
    classSel = id; ui.classSel = id; updateClassbar(); return;
  }
  if (sim.mode === 'slice') { classSel = id; setDepthValue(Math.round((needDepth(shipById(id)) + 0.25) * 10) / 10); } // im Querschnitt: Solltiefe für diese Klasse
  else classSel = classSel === id ? null : id; // auf der Karte: Engstellen ein/aus
  ui.classSel = classSel;
  updateClassbar();
}
function pickedClass() { // die eine Klasse, die das Kartenvollbild anzeigt
  const ids = game.level.classes;
  return classSel && ids.includes(classSel) ? classSel : ids.find((id) => game.fair?.[id] && !game.fair[id].passable) ?? ids[ids.length - 1];
}
function updateClassbar() {
  const wait = waitingByClass(game), pick = pickedClass();
  for (const b of $('classbar').children) {
    const id = b.dataset.id, f = game.fair?.[id], cls = shipById(id);
    b.classList.toggle('ok', !!f?.passable); b.classList.toggle('on', classSel === id); b.classList.toggle('pick', id === pick);
    const small = b.querySelector('small'), w = b.querySelector('.wait');
    const need = `${minNeedDepth(cls).toFixed(1)}–${needDepth(cls).toFixed(1)}`;
    small.textContent = !f ? '' : f.passable ? `${Math.round(f.loadFactor * 100)} % Ladung${f.twoWay ? ' · ⇄' : ''}${f.loadFrac < 0.999 ? ` · +${num(f.fullVolume)} m³ bis voll` : ' · voll'}` : `${game.unlocked[id] ? '⚠ gesperrt' : '🔒'} ${need} m · ${f.volume === Infinity ? 'Korridor zu schmal' : `fehlt ${num(f.volume)} m³`}`;
    w.hidden = !(wait[id] > 0); w.textContent = wait[id] ?? '';
  }
}

// ---------- Panel (einmal aufgebaut, danach nur aktualisiert: Klicks gehen nie verloren) ----------
const upRows = {};
// Ausrüstung in Reitern (Übersicht): jeder Reiter listet seine Verbesserungen
const UP_TABS = [
  { id: 'pump', label: '🌀 Pumpe', ids: ['power', 'radius', 'speed', 'winch', 'curtain'] },
  { id: 'gear', label: '⚙ Geräte', ids: ['auto', 'echolot', 'cutter', 'loeffel', 'betonrohr'], gate: 'up_gear' },
  { id: 'plant', label: '🏭 Anlage', ids: ['plant', 'dewater', 'sorter', 'mixer'], gate: 'up_plant' },
  { id: 'traffic', label: '🚢 Verkehr', ids: ['beacons', 'signals', 'tugs', 'vts', 'pilot'], gate: 'up_traffic' },
];
let upTab = 'pump';
const upTabBtns = {}, upTabBodies = {};
function buildUpgrades() {
  const bar = document.createElement('div'); bar.className = 'tabs'; bar.setAttribute('role', 'tablist');
  const nodes = [bar];
  for (const tab of UP_TABS) {
    const tb = document.createElement('button'); tb.className = 'tab'; tb.type = 'button'; tb.innerHTML = `${tab.label} <i class="badge" hidden></i>`;
    tb.onclick = () => { upTab = tab.id; showUpTab(); };
    bar.append(tb); upTabBtns[tab.id] = tb;
    const body = document.createElement('div'); body.className = 'tabbody'; upTabBodies[tab.id] = body; nodes.push(body);
    for (const id of tab.ids) {
      const def = UPGRADES[id]; if (!def) continue;
      const row = document.createElement('div'); row.className = 'up';
      const label = document.createElement('div'), small = document.createElement('small');
      label.append(def.name + ' ', small);
      const btn = document.createElement('button');
      btn.onclick = () => { if (game.buyUpgrade(id)) { applyStats(); updatePanel(); } };
      const sell = document.createElement('button');
      sell.className = 'sell';
      let armed = 0;
      sell.onclick = () => {
        if (!armed) { armed = setTimeout(() => { armed = 0; updateUpgrades(); }, 3000); sell.textContent = 'Sicher?'; return; }
        clearTimeout(armed); armed = 0;
        if (game.sellUpgrade(id)) { applyStats(); updatePanel(); }
      };
      const btns = document.createElement('div'); btns.className = 'upbtns'; btns.append(sell, btn);
      row.append(label, btns);
      upRows[id] = { small, btn, sell, armed: () => armed };
      body.append(row);
    }
  }
  $('upgrades').replaceChildren(...nodes);
  showUpTab();
}
function showUpTab() {
  for (const t of UP_TABS) { upTabBtns[t.id].classList.toggle('on', t.id === upTab); upTabBodies[t.id].hidden = t.id !== upTab; }
}
function applyStats() {
  sim.setStats(game.stats);
  if (sim.mode === 'slice' && game.stats.autoLevel <= 0 && sim.slice.auto.on) { sim.slice.auto.on = false; sim.slice.auto.error = null; }
}
function updateUpgrades() {
  for (const [id, def] of Object.entries(UPGRADES)) {
    const cost = game.nextUpgradeCost(id), r = upRows[id];
    r.small.textContent = `Stufe ${game.levels[id]}/${def.maxLevel} · ${def.desc}`;
    r.btn.textContent = game.upgradeLocked(id) ? '🔒 Hafen' : cost === null ? 'Max' : chf(cost);
    r.btn.disabled = cost === null || game.money < cost || game.status !== 'playing';
    if (game.upgradeLocked(id)) r.small.textContent += ' · gesperrt: Aufbereitungshalle im Hafen bauen/ausbauen (jede Karte mit Halle zählt)';
    const refund = game.refundFor(id);
    if (!r.armed()) r.sell.textContent = '↩';
    if (refund !== null) r.small.textContent += ` · Rückbau +${chf(refund)}`;
    r.sell.disabled = refund === null || game.status !== 'playing';
    r.sell.title = `Rückbau: ${Math.round(CONFIG.refundShare * 100)}% der Investition kommen zurück`;
  }
  for (const t of UP_TABS) { // Punkt am Reiter: hier ist etwas bezahlbar
    const n = t.ids.filter((id) => { const c = game.nextUpgradeCost(id); return c !== null && game.money >= c && game.status === 'playing'; }).length, bd = upTabBtns[t.id].querySelector('.badge');
    bd.hidden = n === 0; bd.textContent = n;
  }
}

function updatePlant() {
  const st = game.stats;
  $('p-stock').textContent = game.stockTotal.toFixed(0);
  $('p-cap').textContent = st.bufferCapacity;
  $('p-prog').max = st.bufferCapacity; $('p-prog').value = game.stockTotal;
  $('p-thru').textContent = st.plantCapacity.toFixed(1);
  const el = $('p-mats');
  if (!el.children.length) el.replaceChildren(...CONFIG.materials.map((m) => { const d = document.createElement('div'); d.innerHTML = `<i style="background:${m.color}"></i><span></span><small></small>`; return d; }));
  CONFIG.materials.forEach((m, k) => {
    const d = el.children[k], price = k === KIND.kies ? m.price * st.sortBonus * priceOf(game.market, 'kies') / 18 : m.price < 0 ? m.price * st.disposalFactor : m.price * st.sortBonus;
    d.querySelector('span').textContent = `${m.name} ${game.stock[k].toFixed(0)}`;
    d.querySelector('small').textContent = `${price >= 0 ? '+' : '−'}${Math.abs(Math.round(price))}/m³`;
    d.title = `${m.name}: ${price >= 0 ? 'Verkauf' : 'Entsorgung'} ${Math.abs(Math.round(price))} CHF pro m³`;
  });
}

function updateGoal() {
  const g = game, goal = g.level.goalTons, done = g.totals.tons;
  let box = $('goal');
  if (!box.firstChild) box.innerHTML = '<div id="goal-txt"></div><progress id="goal-prog" max="1" value="0"></progress><div id="goal-sub"></div><button id="btn-finish" class="primary" hidden>Konzession sichern und abschliessen</button>';
  const fin = Number.isFinite(goal);
  $('goal-txt').innerHTML = fin ? `<b>${num(done)}</b> / ${num(goal)} t Fracht durchgebracht` : `<b>${num(done)}</b> t Fracht durchgebracht <small>(Endlos, Seed ${game.seed})</small>`;
  $('goal-prog').hidden = !fin; $('goal-prog').value = fin ? Math.min(1, done / goal) : 0;
  $('goal-sub').innerHTML = `<small>${g.totals.ships} Schiffe · Verkehr +${chf(g.totals.trafficIncome)} · ${g.totals.rejected} abgewiesen${g.totals.groundings ? ` · ${g.totals.groundings} Havarien` : ''}</small>`;
  const btn = $('btn-finish');
  btn.hidden = !g.goalReached || g.status !== 'playing';
  btn.onclick = () => { if (game.finish('goal')) { /* showEnd läuft in der Schleife */ } };
}

function updateFairway() {
  const wait = waitingByClass(game), box = $('fairway');
  if (box.children.length !== game.level.classes.length) box.replaceChildren(...game.level.classes.map(() => { const d = document.createElement('div'); d.className = 'frow'; return d; }));
  game.level.classes.forEach((id, k) => {
    const f = game.fair?.[id], cls = shipById(id), row = box.children[k];
    const status = !f ? '' : f.passable ? `<span class="ok">✓ ${Math.round(f.loadFactor * 100)} % Ladung${f.twoWay ? ' · Gegenverkehr' : ' · einspurig'}</span>${f.loadFrac < 0.999 ? `<br><small>für Volllast fehlen ${num(f.fullVolume)} m³</small>` : ''}` : f.volume === Infinity ? '<span class="no">Korridor zu schmal</span>' : `<span class="no">fehlt ${num(f.volume)} m³</span>`;
    row.innerHTML = `<div>${cls.icon} <b>${cls.name}</b><br><small>Tiefe ${minNeedDepth(cls).toFixed(1)}–${needDepth(cls).toFixed(1)} m · Breite ${cls.beam} · ${cls.tons} t · ${chf(cls.fee)}${(game.rejectedBy[id] ?? 0) ? ` · ${game.rejectedBy[id]} abgewiesen` : ''}</small></div><div style="text-align:right">${status}${wait[id] ? `<br><small>${wait[id]} wartend</small>` : ''}</div>`;
  });
}

function sparkline(h, color) {
  const lo = Math.min(...h), hi = Math.max(...h), span = hi - lo || 1;
  const pts = h.map((v, i) => `${(i / Math.max(1, h.length - 1)) * 56},${16 - ((v - lo) / span) * 14}`).join(' ');
  return `<svg viewBox="0 0 56 18"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`;
}
let marketSig = '';
function updateMarket() {
  const sig = `${game.day}|${game.levelId}|${Math.round((game.market.glut ?? 0) * 20)}|${game.mapIdx}`;
  if (sig === marketSig) return;
  marketSig = sig;
  const used = new Set(SHIPS.filter((s) => game.level.classes.includes(s.id)).flatMap((s) => s.cargo));
  $('market').replaceChildren(...CARGOS.filter((c) => used.has(c.id)).map((c) => {
    const row = document.createElement('div'), t = trend(game.market, c.id), p = priceOf(game.market, c.id), ratio = p / c.base;
    row.className = 'mrow';
    row.innerHTML = `<div><i class="dot" style="background:${c.color};display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px"></i>${c.name}</div><div><b>${p.toFixed(p < 50 ? 1 : 0)}</b> CHF/t <span class="${t > 0 ? 'tr-up' : t < 0 ? 'tr-down' : ''}">${t > 0 ? '▲' : t < 0 ? '▼' : '–'}</span></div>${sparkline(game.market.history[c.id], ratio > 1.15 ? '#7bd88f' : ratio < 0.85 ? '#ff7a6b' : '#8fa6ba')}`;
    return row;
  }));
  if ((game.market.glut ?? 0) > 0.04) { const n = document.createElement('small'); n.className = 'warn'; n.textContent = `⚠ Stau: ${game.closed ? 'Sperrung' : 'Niedrigwasser'} drückt die Preise hier um ${Math.round(game.market.glut * 100)} %. Günstig einkaufen und im Hafenlager einlagern, bis die Schiffe wieder fahren.`; $('market').append(n); }
}

let depositSig = null;
function updateDeposits() {
  const r = game.river, price = (d) => materialPrice(d.kind, game.stats, game.market);
  const rows = r.deposits.filter((d) => !d.depleted).map((d) => ({ d, rest: r.depositRemaining(d.id) }));
  const sig = JSON.stringify([rows.map(({ d, rest }) => [d.id, d.known, d.owned, Math.round(rest / 5)]), Math.floor(game.money / 500), game.fleet.mine, Math.round(game.totals.premium / 100)]);
  if (sig === depositSig) return;
  depositSig = sig;
  const box = $('deposits'), unknown = rows.filter(({ d }) => !d.known).length, eb = game.exploreBlock();
  const items = rows.filter(({ d }) => d.known).map(({ d, rest }) => {
    const worth = rest * price(d) * (d.mult - 1), block = game.concessionBlock(d.id);
    return `<div class="unit"><div><i style="display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:5px;background:${depositType(d.type).color}"></i><b>${d.name}</b> <small>Spalte ${Math.round(d.cx) + 1} · Aufschlag ×${d.mult} · Rest ${num(rest)} m³ (Mehrwert ca. ${chf(worth)})<br>${d.owned ? '✓ Konzession erworben: Abbau wird mit Aufschlag bezahlt' : 'ohne Konzession kein Aufschlag'}</small></div>${d.owned ? '' : `<button data-conc="${d.id}" ${block ? 'disabled' : ''} title="${block ?? ''}">Konzession ${chf(d.cost)}</button>`}</div>`;
  }).join('');
  box.innerHTML = `<small>Hochwertige Vorkommen im Flussbett (Kies, Quarzsand, Erz): Mit Konzession wird der Abbau sofort mit Preisaufschlag bezahlt, zusätzlich zu Baggerentgelt und Verkauf. Das erste Vorkommen gehört dir schon: baggere dort zuerst. Bisher Aufschlag: ${chf(game.totals.premium)}.</small>
    ${items}
    ${unknown ? `<button id="btn-explore" class="primary" ${eb ? 'disabled' : ''}>Gebiet erkunden (${chf(CONFIG.deposits.exploreCost)}) · ${unknown} unbekannt</button>${eb ? `<small class="warn">${eb}</small>` : ''}` : '<small>Alle Vorkommen sind erkundet.</small>'}`;
  for (const b of box.querySelectorAll('[data-conc]')) b.onclick = () => { if (game.buyConcession(+b.dataset.conc)) { depositSig = null; updateDeposits(); updatePanel(); } };
  const eBtn = $('btn-explore'); if (eBtn) eBtn.onclick = () => { const d = game.explore(); if (d) { toast(`Gefunden: ${d.name} bei Spalte ${Math.round(d.cx) + 1}`, 'good', true); depositSig = null; updateDeposits(); updatePanel(); } };
}

// ---------- Karten (Endlos): Engstellen verwalten ----------
function changeMap(i) {
  if (!game.endless || i === game.mapIdx || i < 0 || i >= game.maps.length) return;
  if (harborView) leaveHarbor(true);
  harborSim = null;
  if (tow) tow = null;
  if (sim.mode === 'slice') sim.leave();
  game.site = null; game.switchMap(i);
  sim = game.createSession(); sim.autoRange = game.autoRange ?? null;
  mapTarget = null; zoneMode = false; ui.zoneMode = false; areaMode = false; ui.areaMode = false; areaKind = 'rect'; ui.areaKind = 'rect'; ui.routePts = null; ui.areaA = null; pileMode = false; ui.pileMode = false; document.body.classList.remove('pile-mode'); $('pile-bar').hidden = true; ui.hoverX = null;
  const first = game.level.classes.find((id) => game.fair?.[id] && !game.fair[id].passable); classSel = first ?? null; ui.classSel = classSel;
  fleetSig = null; trafficSig = null; hazardSig = null; depositSig = null; shoreSig = null; mapsSig = null;
  fx.clear(); syncMode(); updatePanel(); applyLevel(); fitCanvas();
  toast(`Karte ${game.map.name}`, 'info', true);
}
let shipSig = null;
function updateShipping() {
  const on = game.endless && game.maps.length > 1, box = $('shipping');
  $('h-ship').hidden = !on; box.hidden = !on; if (!on) return;
  const S = game.shipping, sig = JSON.stringify([S.ships.map((s) => [s.id, s.state, s.from, s.to, s.cargo, s.autoBuy, s.toStock, s.note, Math.round(s.profit / 100)]), game.maps.map((m) => m.name), Math.floor(game.money / 2000), game.maps.map((m) => game.maps.length && [Math.round(m.fair.kahn.loadFactor * 20), Math.round(m.fair.motor.loadFactor * 20)])]);
  if (sig === shipSig) return; shipSig = sig;
  const mapOpts = (sel) => game.maps.map((m, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${m.name}</option>`).join('');
  const prices = ['kies', 'oel', 'container'].map((id) => `${PORT.label[id]}: ` + game.maps.map((m, i) => `${m.name} <b>${withMap(game, i, () => Math.round(buyPrice(game, id)))}</b>/${withMap(game, i, () => Math.round(sellPrice(game, id)))}`).join(' · ')).join('<br>');
  const cards = S.ships.map((s) => {
    const T = SHIPPING.types[s.type], info = routeInfo(game, s);
    return `<div class="unit ship"><div><b>${T.icon} ${s.name}</b> <small>${s.state === 'sail' ? (s.leg === 'out' ? `unterwegs mit ${Math.round(s.load)} t` : 'Rückfahrt') : 'im Hafen'} · ${s.trips} Fahrten · ${s.profit >= 0 ? '+' : '−'}${chf(Math.abs(s.profit))}<br>${s.note}</small>
      <div class="row"><select data-sr="from" data-id="${s.id}">${mapOpts(s.from)}</select> ➜ <select data-sr="to" data-id="${s.id}">${mapOpts(s.to)}</select> <b>${PORT.label[s.cargo]}</b></div>
      <label title="Auf der Rückfahrt in die Gegenrichtung laden, wenn es sich lohnt"><input type="checkbox" data-sr="backhaul" data-id="${s.id}" ${s.backhaul !== false ? 'checked' : ''}> Rückfracht</label> <label><input type="checkbox" data-sr="autoBuy" data-id="${s.id}" ${s.autoBuy ? 'checked' : ''}> im Starthafen einkaufen</label> <label title="Das Schiff fährt nur, wenn die erwartete Marge mindestens so hoch ist">Mindestmarge <input type="number" step="1" min="-50" max="200" value="${s.minMargin ?? 0}" data-sr="minMargin" data-id="${s.id}" style="width:54px"> CHF/t</label> <label><input type="checkbox" data-sr="toStock" data-id="${s.id}" ${s.toStock ? 'checked' : ''}> im Zielhafen einlagern</label>
      <small class="${info.ok ? (info.margin > 0 ? '' : 'warn') : 'warn'}">${info.ok ? `Ladung ${Math.round(info.eff)} t (${Math.round(info.lf * 100)} % je nach Rinne) · Fracht ${info.perT.toFixed(1)} CHF/t · Kauf ${Math.round(info.priceFrom)} ➜ Verkauf ${Math.round(info.priceTo)} · Marge ${info.margin >= 0 ? '+' : ''}${info.margin.toFixed(1)} CHF/t` : info.reason}</small></div>
      <button data-sellship="${s.id}" ${s.state === 'sail' ? 'disabled' : ''} title="Verkauf: ${Math.round(SHIPPING.sellShare * 100)} % des Preises">Verkaufen</button></div>`;
  }).join('');
  const buys = Object.entries(SHIPPING.types).map(([k, T]) => `<button data-buyship="${k}" ${shipBlock(game, k) ? 'disabled' : ''} title="${shipBlock(game, k) ?? ''}">${T.icon} ${T.name} (${T.cap} t, ${PORT.label[T.cargos[0]]}) ${chf(T.cost)}</button>`).join('');
  box.innerHTML = `<small>Eigene Frachter fahren Ware zwischen den Häfen der Karten (beide Häfen brauchen Kai, Lager und ein tiefes Hafenbecken). Gewinn = Preisunterschied (Kauf/Verkauf je Karte) minus Fracht; bei Niedrigwasser darf weniger geladen werden, die Fracht wird teurer. Unterhalt läuft täglich.<br>Preise je Karte (Kauf/Verkauf je t):<br>${prices}</small>${cards}<div class="shipbuy">${buys}</div>`;
  for (const el of box.querySelectorAll('[data-sr]')) el.onchange = () => { const k = el.dataset.sr, id = +el.dataset.id; setRoute(game, id, { [k]: el.type === 'checkbox' ? el.checked : +el.value }); shipSig = null; updateShipping(); };
  for (const b of box.querySelectorAll('[data-sellship]')) b.onclick = () => { sellShip(game, +b.dataset.sellship); shipSig = null; updateShipping(); };
  for (const b of box.querySelectorAll('[data-buyship]')) b.onclick = () => { if (buyShip(game, b.dataset.buyship)) { shipSig = null; updateShipping(); updatePanel(); } };
}
let mapsSig = null;
function updateMapSelect() {
  const sel = $('map-select'), show = game.endless && game.maps.length > 1;
  sel.hidden = !show; if (!show) return;
  const sig = game.maps.map((m) => m.name).join('|');
  if (sel.dataset.sig !== sig) { sel.innerHTML = game.maps.map((m, i) => `<option value="${i}">🗺 ${m.name}</option>`).join(''); sel.dataset.sig = sig; }
  sel.value = String(game.mapIdx);
}
function updateMaps() {
  const on = game.endless, box = $('maps');
  $('h-maps').hidden = !on; box.hidden = !on; if (!on) return;
  const sig = JSON.stringify([game.maps.map((m) => [m.name, Object.keys(m.unlocked).length, m.fleet.units.length, m.traffic.ships.length]), game.mapIdx, Math.floor(game.money / 1000)]);
  if (sig === mapsSig) return; mapsSig = sig;
  const cost = game.mapCost(), block = game.mapBlock();
  box.innerHTML = `<small>Flussnetz (Seed ${game.seed}): jede Karte ist eine eigene Engstelle mit eigenem Verkehr, eigener Flotte und eigenen Kreuzungsstellen. Alle laufen im Hintergrund weiter; Geld, Anlage, Ausrüstung und Markt sind gemeinsam.</small>` +
    game.maps.map((m, i) => `<div class="unit"><div><b>${i === game.mapIdx ? '▶ ' : ''}${m.name}</b> <small>Schwierigkeit ${m.difficulty + 1} · ${SHIPS.filter((s) => m.unlocked[s.id]).map((s) => s.icon).join(' ') || '–'} · ${m.fleet.units.length} Pontons · ${m.traffic.ships.filter((s) => s.state === 'sail').length} Schiffe unterwegs</small></div><button data-map="${i}" ${i === game.mapIdx ? 'disabled' : ''}>Wechseln</button></div>`).join('') +
    `<button id="btn-addmap" class="primary" ${block ? 'disabled' : ''}>${cost === null ? 'Flussnetz vollständig' : `Neue Karte erschliessen (${chf(cost)})`}</button>${block && cost !== null ? `<small class="warn">${block}</small>` : ''}`;
  for (const b of box.querySelectorAll('[data-map]')) b.onclick = () => changeMap(+b.dataset.map);
  const add = $('btn-addmap'); if (add) add.onclick = () => { const k = game.addMap(); if (k !== false) { mapsSig = null; updateMaps(); toast(`Neue Karte: ${game.maps[k].name}`, 'good', true); } };
}

let shoreSig = null;
function updateShore() {
  const secs = game.shoreSections(), sig = JSON.stringify([secs.map((q) => q.cells.length), Math.floor(game.money / 500)]);
  if (sig === shoreSig) return;
  shoreSig = sig;
  const part = ['Oberlauf', 'Mittellauf', 'Unterlauf'], side = ['Nordufer', 'Südufer'], P = CONFIG.zones.shoreParts;
  $('shore').innerHTML = `<small>Die Flachwasserstreifen am Ufer sind Naturschutzgebiet (hohe Bussen). Du kannst sie abschnittsweise freikaufen: Sie werden zum Baggerkorridor, die Rinne kann dort breiter werden (muss aber noch ausgebaggert werden).</small>` +
    secs.map((q) => { const b = game.shoreBlock(q.side, q.part); return `<div class="unit"><div><b>${side[q.side]} · ${part[q.part] ?? 'Abschnitt ' + (q.part + 1)}</b> <small>${q.cells.length ? q.cells.length + ' Zellen geschützt' : '✓ freigegeben'}</small></div>${q.cells.length ? `<button data-shore="${q.side}:${q.part}" ${b ? 'disabled' : ''} title="${b ?? ''}">${chf(q.cost)}</button>` : ''}</div>`; }).join('');
  for (const b of $('shore').querySelectorAll('[data-shore]')) b.onclick = () => { const [s, p] = b.dataset.shore.split(':').map(Number); if (game.buyShore(s, p)) { shoreSig = null; updateShore(); updatePanel(); toast('Uferstreifen freigegeben', 'good', true); } };
  void P;
}

let hazardSig = null;
function updateHazard() {
  const r = game.river, sum = r.altlastSummary(), price = Math.abs(CONFIG.materials[KIND.altlast].price * game.stats.disposalFactor);
  const lanes = game.level.classes.map((id) => [id, game.fair?.[id]?.altlast ?? 0]).filter(([, v]) => v > 0.5);
  const sig = JSON.stringify([Math.round(sum.volume), sum.cells, Math.round(sum.corridor), lanes.map(([id, v]) => [id, Math.round(v)]), game.totals.sunk, Math.round(price)]);
  if (sig === hazardSig) return;
  hazardSig = sig;
  const rows = lanes.map(([id, v]) => `<div class="frow"><div>${shipById(id).icon} <b>${shipById(id).name}</b><br><small>Altlast in der Rinne, die weg muss</small></div><div style="text-align:right"><span class="no">${num(v)} m³</span><br><small>≈ ${chf(v * price)} Entsorgung</small></div></div>`).join('');
  $('hazard').innerHTML = sum.cells ? `<div><b>${num(sum.volume)} m³</b> Altlast in ${sum.cells} Zellen (davon im Baggerkorridor ${num(sum.corridor)} m³)</div>
    <small>Auf der Karte orange mit ☢. Entsorgung kostet ${chf(price)} pro m³ (Entwässerung senkt es), Abtrag trübt stärker. Quellen: alte Industrie (beim Start ausgewiesen) und gesunkene Schiffe (Öl, Chemie, Treibstoff).${game.totals.sunk ? ` Bisher gesunken: ${game.totals.sunk}.` : ''}</small>${rows}` : '<small>Keine Altlasten im Fluss. Sinkt ein Schiff, entstehen welche (Öl, Chemie, Treibstoff).</small>';
}

let trafficSig = null;
function updateTrafficPanel() {
  const st = game.stats, cap = bayCapacity(game), mz = maxZones(game), cid = game.zoneClassId, cls = shipById(cid);
  const plans = game.zones.map((z) => { const p = game.zonePlanFor(z.x, z.cls ?? cid); return [z.id, z.x, z.cls ?? cid, p.ready, Math.round(p.volume === Infinity ? -1 : p.volume)]; });
  const sig = JSON.stringify([cap, mz, plans, game.zones.map((z) => z.unit ?? 0), game.fleet.units.map((u) => u.id), cid, zoneMode, game.totals.turnedAway, st.signals, st.tugs, Math.floor(game.money / 500)]);
  if (sig === trafficSig) return;
  trafficSig = sig;
  const box = $('trafficpanel');
  const opts = (sel) => game.level.classes.map((id) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${shipById(id).icon} ${shipById(id).name} (${2 * shipById(id).beam + 1} Zellen)</option>`).join('');
  const rows = game.zones.map((z, k) => { const [, , zc, ready, vol] = plans[k]; return `<div class="unit"><div><b>Kreuzung bei Spalte ${z.x + 1}</b> <small>${ready ? '✓ bereit: Schiffe begegnen sich hier' : vol < 0 ? 'kein Platz, auch nicht mit Uferstreifen' : `geplant: fehlt noch ${num(vol)} m³ Aushub`}<br><select data-zcls="${z.id}">${opts(zc)}</select><br><select data-zunit="${z.id}" title="Zugeteiltes Ponton baut diese Stelle vorrangig und stoppt alles andere"><option value="">Ausbau: alle freien Pontons</option>${game.fleet.units.map((q) => `<option value="${q.id}" ${z.unit === q.id ? 'selected' : ''}>⚡ Vorrang: ${q.name}</option>`).join('')}</select></small></div><button data-zone="${z.id}">Entfernen</button></div>`; }).join('');
  box.innerHTML = `<div>Warteplatz: <b>${cap}</b> Schiff${cap > 1 ? 'e' : ''} je Seite · Kreuzungsstellen <b>${game.zones.length}/${mz}</b></div>
    <small>Wer keinen Platz im Warteplatz findet, dreht ab (bisher ${game.totals.turnedAway}). Rotlichter (Signalanlage) und Schlepper bauen den Warteplatz aus, Rotlichter erlauben weitere Kreuzungsstellen, Schlepper machen grosse Schiffe schneller.</small>
    <small>Kreuzen brauchen zwei Rinnen nebeneinander: <b>2 × Schiffsbreite + 1 Zelle</b> quer zum Fluss (Lastkahn und Motorschiff 5, Tanker und Container 7, Schubverband 9 Zellen), durchgehend so tief wie die Klasse braucht, auf 3 Spalten. Kreuzungsstellen lassen sich überall <b>planen</b>: die Karte zeigt, wie viel noch auszutragen ist (rot markiert). Die Flotte baut geplante Stellen aus.</small>
    <label class="fleet-widen">Planen für <select id="zone-cls">${opts(cid)}</select></label>
    ${rows}<button id="btn-zone2" class="primary">${zoneMode ? '✔ Fertig (K)' : `↔ Kreuzungsstelle planen oder entfernen (${chf(CONFIG.zones.cost)}, K)`}</button>`;
  $('btn-zone2').onclick = toggleZoneMode;
  $('zone-cls').onchange = (e) => { game.zoneClass = e.target.value; trafficSig = null; updateTrafficPanel(); };
  for (const b of box.querySelectorAll('[data-zone]')) b.onclick = () => { game.removeZone(+b.dataset.zone); trafficSig = null; updateTrafficPanel(); };
  for (const sel of box.querySelectorAll('[data-zunit]')) sel.onchange = () => { setZoneUnit(game, +sel.dataset.zunit, sel.value ? +sel.value : null); trafficSig = null; fleetSig = null; updateTrafficPanel(); };
  for (const sel of box.querySelectorAll('[data-zcls]')) sel.onchange = (e) => { game.setZoneClass(+sel.dataset.zcls, e.target.value); trafficSig = null; updateTrafficPanel(); };
}
function toggleZoneMode() {
  if (tow || sim.mode !== 'map') { toast('Kreuzungsstellen planst du auf der Karte (Anker lichten mit Q)', 'info', true); return; }
  if (pileMode) togglePileMode();
  zoneMode = !zoneMode; ui.zoneMode = zoneMode; trafficSig = null; mapTarget = null;
  $('btn-zone').textContent = zoneMode ? '✔ Kreuzung: fertig (K)' : '↔ Kreuzung (K)';
  updateTrafficPanel();
  if (zoneMode) { const c = shipById(game.zoneClassId); toast(`Planen für ${c.name}: Spalte antippen, die Zahl zeigt den fehlenden Aushub`, 'info', true); }
}
function toggleLandMode() {
  if (tow || sim.mode !== 'map') { toast('Die Landseite baust du auf der Karte (Anker lichten mit Q)', 'info', true); return; }
  if (!game.port.open) { toast('Erst das Hafengelände erwerben (Hafen, H)', 'bad', true); return; }
  if (zoneMode) toggleZoneMode(); if (areaMode) toggleAreaMode(); if (pileMode) togglePileMode();
  landMode = !landMode; ui.landMode = landMode; ui.landTool = landTool; ui.hoverCell = null; mapTarget = null;
  $('btn-land').textContent = landMode ? '✔ Land: fertig (L)' : '🛣 Land (L)'; $('land-bar').hidden = !landMode;
  if (landMode) toast(`Landseite: Strasse ${chf(LAND.road.cost)} je Zelle, Lagerhalle ${chf(LAND.hall.cost)} plus Erdarbeiten`, 'info', true);
}
function setLandTool(t) { landTool = t; ui.landTool = t; for (const b of $('land-bar').querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t); }
function landClick(px, py) {
  const c = cellAt(px, py), x = Math.floor(c.x), y = Math.floor(c.y);
  if (landTool === 'road') { const why = roadBlock(game, x, y); if (why) toast(why, 'bad', true); else buildRoad(game, x, y); }
  else if (landTool === 'hall') { const why = hallBlock(game, x, y); if (why) toast(why, 'bad', true); else { buildHall(game, x, y); toast('Lagerhalle gebaut: mit einer Strasse ans Hafenbecken anbinden', 'good', true); } }
  else if (landTool === 'auto') {
    const h = landOf(game).halls.find((q) => x >= q.x && x < q.x + LAND.hall.w && y >= q.y && y < q.y + LAND.hall.h);
    if (!h) { toast('Auf eine Lagerhalle tippen', 'bad', true); return; }
    const res = autoRoad(game, h.id); toast(res.ok ? `Strasse gebaut: ${res.cells} Zellen (−${chf(res.cost)})` : res.why, res.ok ? 'good' : 'bad', true);
  } else if (landTool === 'demo') { if (!demolishAt(game, x, y)) toast('Hier steht nichts', 'info', true); }
  updatePanel();
}
function toggleAreaMode() {
  if (tow || sim.mode !== 'map') { toast('Arbeitsgebiete gibst du auf der Karte vor (Anker lichten mit Q)', 'info', true); return; }
  if (areaMode && areaKind === 'route') { finishRoute(); return; }
  if (zoneMode) toggleZoneMode(); if (landMode) toggleLandMode(); if (pileMode) togglePileMode();
  areaKind = 'rect'; ui.areaKind = 'rect'; ui.routePts = null;
  areaMode = !areaMode; ui.areaMode = areaMode; ui.areaA = null; ui.hoverCell = null; mapTarget = null;
  syncAreaButtons();
  if (areaMode) toast(`Zwei Ecken antippen: das Rechteck wird von den gemieteten Pontons auf die Gebietstiefe gebaggert (max. ${MAX_AREAS} Gebiete)`, 'info', true);
}
function syncAreaButtons() {
  const rect = areaMode && areaKind === 'rect', route = areaMode && areaKind === 'route';
  $('btn-area').textContent = rect ? '✔ Gebiet: fertig (G)' : '▭ Gebiet (G)';
  $('btn-route').textContent = route ? `✔ Route: fertig (N)${ui.routePts?.length ? ` · ${ui.routePts.length} Punkte` : ''}` : '〰 Route (N)';
}
// Baggerroute: Wegpunkte antippen, «fertig» legt die Route an; die Flotte baggert sie auf Tiefe aus (auch Ufer und Land im Ausbaustreifen mit Löffelbagger)
function toggleRouteMode() {
  if (tow || sim.mode !== 'map') { toast('Routen zeichnest du auf der Karte (Anker lichten mit Q)', 'info', true); return; }
  if (areaMode && areaKind === 'route') { finishRoute(); return; }
  if (zoneMode) toggleZoneMode(); if (landMode) toggleLandMode(); if (areaMode) toggleAreaMode(); if (pileMode) togglePileMode();
  areaKind = 'route'; ui.areaKind = 'route'; ui.routePts = []; areaMode = true; ui.areaMode = true; ui.areaA = null; ui.hoverCell = null; mapTarget = null;
  syncAreaButtons();
  toast(`Wegpunkte der Route antippen, zuletzt «Route: fertig» (N) oder den letzten Punkt nochmals antippen (max. ${MAX_AREAS} Gebiete/Routen)`, 'info', true);
}
function finishRoute() {
  const pts = ui.routePts ?? []; areaMode = false; ui.areaMode = false; areaKind = 'rect'; ui.areaKind = 'rect'; ui.routePts = null; ui.hoverCell = null;
  syncAreaButtons();
  if (pts.length < 2) { toast('Route abgebrochen: mindestens zwei Punkte nötig', 'info', true); return; }
  const a = addRoute(game, pts);
  if (!a) { toast(`Hier geht nichts: höchstens ${MAX_AREAS} Gebiete/Routen, und die Linie muss abbaubare Zellen berühren`, 'bad', true); return; }
  toast(`Route ${a.id} angelegt: Breite ${a.w}, Tiefe ${a.depth.toFixed(1)} m${a.lost ? ` · ${a.lost} Zellen auf nicht abbaubarem Land bleiben stehen` : ''}${game.stats.loeffel > 0 ? '' : ' · Land braucht den Löffelbagger'}`, 'good', true);
  fleetSig = null; updateFleet();
}
// ---------- Pfahlwand planen ----------
function togglePileMode() {
  if (tow || sim.mode !== 'map' || harborView) { toast('Die Pfahlwand planst du auf der Hauptkarte (Anker lichten mit Q)', 'info', true); return; }
  if (game.stats.betonrohr <= 0 && !pileMode) toast('Pfähle setzen kann erst, wer das Betoniergerät hat (Technik)', 'info', true);
  if (zoneMode) toggleZoneMode(); if (landMode) toggleLandMode(); if (areaMode) { if (areaKind === 'route') finishRoute(); else toggleAreaMode(); }
  pileMode = !pileMode; ui.pileMode = pileMode; pileA = null; ui.pileA = null; ui.hoverCell = null; mapTarget = null;
  if (pileMode) { planFocus.x = sim.x; planFocus.y = sim.y; toast('Pfahlwand: Zellen antippen (Einzelzelle) oder zwei Punkte für eine Linie. Mit Joystick/Pfeiltasten verschieben, ± zoomt. Gebaut wird mit dem Betoniergerät aus dem Betonvorrat.', 'info', true); }
  document.body.classList.toggle('pile-mode', pileMode); $('pile-bar').hidden = !pileMode; syncPileButton(); layoutSig = ''; fitCanvas();
}
function syncPileButton() { $('btn-pile').textContent = pileMode ? '✔ Pfahlwand: fertig (O)' : '🧱 Pfahlwand (O)'; for (const b of $('pile-bar').querySelectorAll('[data-ptool]')) b.classList.toggle('on', b.dataset.ptool === pileTool); }
function pileClick(px, py) {
  const c = cellAt(px, py), x = Math.floor(c.x), y = Math.floor(c.y), r = game.river;
  if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return;
  const plan = new Set(game.fleet.pilePlan ?? []);
  const note = (n, on) => toast(on ? `${n} Zelle${n === 1 ? '' : 'n'} geplant · Plan: ${(game.fleet.pilePlan ?? []).length} Pfähle, ${(game.fleet.pilePlan ?? []).length * PILE.concrete} m³ Beton` : `${n} Zelle${n === 1 ? '' : 'n'} aus dem Plan genommen`, on ? 'good' : 'info', true);
  if (pileTool === 'line') {
    if (!pileA) { pileA = { x, y }; ui.pileA = pileA; return; }
    const cells = lineCells(r, pileA.x, pileA.y, x, y), allIn = cells.every((i) => plan.has(i) || r.pile[i]); pileA = null; ui.pileA = null;
    const n = planPile(game, cells, !allIn); if (!n) toast('Hier kann kein Pfahl geplant werden (nur Wasser im Baggerkorridor)', 'bad', true); else note(n, !allIn);
    fleetSig = null; return;
  }
  const i = y * r.cols + x;
  if (r.pile[i]) { toast('Hier steht schon ein Pfahl', 'info', true); return; }
  const on = !plan.has(i), n = planPile(game, [i], on);
  if (!n) { toast(`Hier nicht möglich: ${(function () { const why = pileBlockText(i); return why; })()}`, 'bad', true); return; }
  note(n, on); fleetSig = null;
}
const pileBlockText = (i) => { const r = game.river; return r.bay[i] ? 'nicht im Hafenbecken' : 'nur im Wasser des Baggerkorridors'; };
function pileZoomBy(f) { pileZoom = Math.min(4, Math.max(1.2, pileZoom * f)); layoutSig = ''; fitCanvas(); }
function cellAt(px, py) { return { x: (px - OX) / CELL, y: py / CELL }; }
function areaClick(px, py) {
  const c = cellAt(px, py);
  if (areaKind === 'route') {
    const pts = ui.routePts ??= [], last = pts[pts.length - 1], p = { x: Math.floor(c.x) + 0.5, y: Math.floor(c.y) + 0.5 };
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.6) { if (pts.length >= 2) finishRoute(); return; } // letzten Punkt nochmals antippen = fertig
    pts.push(p); syncAreaButtons(); return;
  }
  if (!ui.areaA) { ui.areaA = c; toast('Zweite Ecke antippen', 'info', true); return; }
  const a = addArea(game, ui.areaA.x, ui.areaA.y, c.x, c.y);
  ui.areaA = null;
  if (!a) { toast(`Hier geht nichts: höchstens ${MAX_AREAS} Gebiete, und das Rechteck muss Baggerkorridor oder Ausbaustreifen enthalten`, 'bad', true); return; }
  toast(`Gebiet ${a.id} angelegt: Tiefe ${a.depth.toFixed(1)} m (im Panel Flotte änderbar)`, 'good', true);
  fleetSig = null; updateFleet();
}
function zoneClick(px, py) {
  void py;
  const x = Math.floor((px - OX) / CELL), near = game.zones.find((z) => Math.abs(z.x - x) <= 1);
  if (near) { game.removeZone(near.id); toast('Kreuzungsstelle entfernt', 'info', true); }
  else {
    const why = game.zoneBlock(x);
    if (why) toast(why, 'bad', true);
    else if (game.placeZone(x)) { const z = game.zones[game.zones.length - 1], p = game.zonePlanFor(z.x, z.cls); toast(p.ready ? 'Kreuzungsstelle ausgewiesen: sofort nutzbar' : `Kreuzungsstelle geplant: noch ${num(p.volume)} m³ Aushub`, 'good', true); }
  }
  trafficSig = null; updateTrafficPanel();
}

let concreteSig = null;
function updateConcrete() {
  const C = CONFIG.concrete, st = game.stats;
  const sig = JSON.stringify([Math.round(game.concrete), Math.round(game.agg.kies), Math.round(game.agg.sand), st.mixer, st.betonrohr, game.divertAgg, Math.floor(game.money / 1000), Math.round(game.totals.concreteUsed / 10)]);
  if (sig === concreteSig) return;
  concreteSig = sig;
  const box = $('concrete');
  const packs = C.packs.map((m) => ({ m, block: game.concreteBlock(m) }));
  box.innerHTML = `<div>Betonvorrat: <b>${num(game.concrete)}</b> / ${C.stockCap} m³ · ${num(game.totals.concreteUsed)} m³ verbaut</div>
    <small>${st.betonrohr > 0 ? 'Betoniergerät: Taste V (Gerät wechseln) im Querschnitt, Leertaste bringt Beton aus.' : 'Betoniergerät (Ausrüstung) bringt Beton aus.'} Beton verhärtet Boden und Ufer: weniger Verlandung, die Böschung hält. Zum Tieferbaggern muss er mit dem Löffel wieder aufgebrochen werden.</small>
    <div class="packs">${packs.map((p) => `<button data-pack="${p.m}" ${p.block ? 'disabled' : ''} title="${p.block ?? ''}">+${p.m} m³ kaufen (${chf(p.m * C.price)})</button>`).join('')}</div>
    ${st.mixer > 0 ? `<div class="mixer">Betonwerk Stufe ${st.mixer}: mischt ${st.mixRate.toFixed(1)} m³/s · Lager Kies ${game.agg.kies.toFixed(0)} / Sand ${game.agg.sand.toFixed(0)} m³ (je m³ Beton ${C.mix.kies} Kies, ${C.mix.sand} Sand, Zement ${C.cement} CHF)
      <label><input type="checkbox" id="chk-divert" ${game.divertAgg ? 'checked' : ''}> Kies und Sand aus der Anlage ins Betonwerk statt verkaufen</label></div>` : '<small>Mit dem Betonwerk (Anlage ausbauen) mischst du Beton selbst aus Kies und Sand des Flusses, viel billiger als Zukaufen.</small>'}`;
  for (const b of box.querySelectorAll('[data-pack]')) b.onclick = () => { if (game.buyConcrete(+b.dataset.pack)) { concreteSig = null; updateConcrete(); updatePanel(); } };
  const chk = $('chk-divert'); if (chk) chk.onchange = (e) => { game.divertAgg = e.target.checked; };
}

let fleetSig = null;
function updateFleet() {
  $('btn-area').hidden = sim.mode !== 'map' || tow || game.stats.autoLevel < 1; $('btn-route').hidden = $('btn-area').hidden;
  $('btn-land').hidden = sim.mode !== 'map' || !!tow || !game.port.open;
  const F = game.fleet, goal = F.goal ?? '', block = hireBlock(game), cost = nextHireCost(game);
  const sig = JSON.stringify([F.units.map((u) => [u.id, u.state, u.note, u.loc ?? 'main', !!game.port.harbor, Math.floor(u.removed / 20)]), goal, block, game.levelId, targetClass(game)?.id, F.widen, F.widenW, game.stats.loeffel, F.pour, F.mine, game.stats.betonrohr, Math.round(game.concrete / 10), (F.areas ?? []).map((a) => [a.id, a.depth, a.unit, a.w, areaWork(game, a)]), areaMode, areaKind, F.noNature, F.noAltlast, !!lentUnit(game)]);
  if (sig === fleetSig) return;
  fleetSig = sig;
  const box = $('fleet'), cls = targetClass(game);
  const rows = F.units.map((u) => `<div class="unit"><div><b>${u.name}</b> <small>${u.state === 'work' ? '⛏' : u.state === 'travel' ? '➜' : '⏸'} ${u.note}<br>${num(u.removed)} m³ gebaggert${!u.self && game.port.harbor ? `<br>Einsatz: <select data-uloc="${u.id}"><option value="main" ${(u.loc ?? 'main') === 'main' ? 'selected' : ''}>Hauptkarte</option><option value="harbor" ${u.loc === 'harbor' ? 'selected' : ''}>Hafen</option></select>` : ''}</small></div>${u.self ? '<button data-recall="1" title="Eigenen Ponton zurückrufen">Zurückrufen</button>' : `<button data-fire="${u.id}" title="Ponton entlassen (kein Rückkauf)">Entlassen</button>`}</div>`).join('');
  const opts = ['<option value="">automatisch (kleinste Klasse, die noch nicht fährt)</option>', ...game.level.classes.map((id) => `<option value="${id}" ${goal === id ? 'selected' : ''}>${shipById(id).icon} ${shipById(id).name}</option>`)].join('');
  box.innerHTML = `<small>Gemietete Pontons baggern selbstständig (Automatik, Löhne ${chf(CONFIG.fleet.wage)}/Tag). Du musst den Querschnitt nicht öffnen.</small>
    ${rows}
    <label class="fleet-widen"><input type="checkbox" id="fleet-widen" ${F.widen ? 'checked' : ''} ${game.stats.loeffel > 0 ? '' : 'disabled'}> Ufer verbreitern (Löffelbagger): der letzte Ponton baut Land im Ausbaustreifen ab <select id="fleet-widthsel">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${F.widenW === n ? 'selected' : ''}>${n} Zeilen</option>`).join('')}</select></label>
    <label class="fleet-widen"><input type="checkbox" id="fleet-mine" ${F.mine ? 'checked' : ''}> Rohstoffe abbauen: freie Pontons baggern Vorkommen mit Konzession (Preisaufschlag)</label>
    <label class="fleet-widen"><input type="checkbox" id="fleet-pour" ${F.pour ? 'checked' : ''} ${game.stats.betonrohr > 0 ? '' : 'disabled'}> Rinne betonieren (Betoniergerät und Beton nötig): freie Pontons verhärten Rinne und Böschung</label>
    ${(F.areas ?? []).map((a) => `<div class="unit"><div><b>${a.route ? '〰 Route' : '▭ Gebiet'} ${a.id}</b> <small>Spalten ${a.x0 + 1}–${a.x1 + 1}${a.route ? ` · Breite ${a.w}` : `, Zeilen ${a.y0 + 1}–${a.y1 + 1}`} · ${areaWork(game, a) ? `noch ${areaWork(game, a)} Spalten offen` : '✓ fertig'}</small>
      <div class="row"><button data-area-d="${a.id}:-0.1">−</button> <b>${a.depth.toFixed(1)} m</b> <button data-area-d="${a.id}:0.1">+</button>${a.route ? ` <button data-area-w="${a.id}:-1">schmaler</button> <button data-area-w="${a.id}:1">breiter</button>` : ''} <select data-area-u="${a.id}"><option value="">alle Pontons</option>${F.units.map((u) => `<option value="${u.id}" ${a.unit === u.id ? 'selected' : ''}>${u.name}</option>`).join('')}</select></div></div><button data-area-x="${a.id}">Löschen</button></div>`).join('')}
    <button id="btn-route2" ${F.units.length ? '' : 'disabled'} title="Wegpunkte auf der Karte antippen">${areaMode && areaKind === 'route' ? '✔ Route: fertig (N)' : `〰 Baggerroute einzeichnen (N) · ${(F.areas ?? []).length}/${MAX_AREAS}`}</button>
    <button id="btn-area2" ${F.units.length ? '' : 'disabled'} title="Zwei Ecken auf der Karte antippen">${areaMode ? '✔ Gebiet: fertig (G)' : `▭ Arbeitsgebiet vorgeben (G) · ${(F.areas ?? []).length}/${MAX_AREAS}`}</button>
    <label class="fleet-widen"><input type="checkbox" id="fleet-nonat" ${F.noNature ? 'checked' : ''}> Naturschutzzonen meiden: Pontons tragen kein Flachwasser am Ufer ab</label>
    <label class="fleet-widen"><input type="checkbox" id="fleet-noalt" ${F.noAltlast ? 'checked' : ''}> Altlastenbereiche meiden: Pontons lassen belastetes Material liegen</label>
    <button id="btn-lend" ${lentUnit(game) || lendBlock(game) ? 'disabled' : ''} title="${lendBlock(game) ?? ''}">🧑‍✈️ Meinen Ponton der Flotte zuteilen</button>
    <label class="fleet-goal">Ausbauziel <select id="fleet-goal">${opts}</select></label>
    <small>${cls ? `Aktuell: ${cls.icon} ${cls.name}` : 'Alle Klassen fahren'}</small>
    <button id="btn-hire" class="primary" ${block ? 'disabled' : ''}>${cost === null ? 'Flotte ist voll' : `Ponton mieten (${chf(cost)})`}</button>${block && cost !== null ? `<small class="warn">${block}</small>` : ''}`;
  $('fleet-nonat').onchange = (e) => { setAvoid(game, e.target.checked, F.noAltlast); fleetSig = null; updateFleet(); };
  $('fleet-noalt').onchange = (e) => { setAvoid(game, F.noNature, e.target.checked); fleetSig = null; updateFleet(); };
  $('fleet-mine').onchange = (e) => { setMine(game, e.target.checked); fleetSig = null; updateFleet(); };
  $('fleet-pour').onchange = (e) => { setPour(game, e.target.checked); fleetSig = null; updateFleet(); };
  $('fleet-widen').onchange = (e) => { setWiden(game, e.target.checked); fleetSig = null; updateFleet(); };
  $('fleet-widthsel').onchange = (e) => { setWiden(game, F.widen, +e.target.value); fleetSig = null; updateFleet(); };
  $('fleet-goal').onchange = (e) => { setGoal(game, e.target.value || null); fleetSig = null; updateFleet(); };
  $('btn-hire').onclick = () => { if (hireUnit(game)) { fleetSig = null; updateFleet(); updatePanel(); } };
  $('btn-lend').onclick = () => { if (sim.mode === 'slice') sim.leave(); if (lendPonton(game, sim.x, sim.y)) { syncMode(); fleetSig = null; updateFleet(); toast('Dein Ponton arbeitet für die Flotte', 'good', true); } };
  for (const sel of box.querySelectorAll('[data-uloc]')) sel.onchange = () => { setUnitLoc(game, +sel.dataset.uloc, sel.value); fleetSig = null; updateFleet(); toast(sel.value === 'harbor' ? 'Ponton arbeitet jetzt im Hafen' : 'Ponton arbeitet wieder auf der Hauptkarte', 'info', true); };
  for (const b of box.querySelectorAll('[data-recall]')) b.onclick = () => { const pos = recallPonton(game); if (pos) { sim.x = pos.x; sim.y = pos.y; } fleetSig = null; updateFleet(); toast('Ponton zurückgerufen', 'info', true); };
  $('btn-area2').onclick = toggleAreaMode; $('btn-route2').onclick = toggleRouteMode;
  for (const b of box.querySelectorAll('[data-area-w]')) b.onclick = () => { const [id, d] = b.dataset.areaW.split(':'); const a = F.areas.find((q) => q.id === +id); setAreaWidth(game, +id, a.w + +d); fleetSig = null; updateFleet(); };
  for (const b of box.querySelectorAll('[data-area-d]')) b.onclick = () => { const [id, d] = b.dataset.areaD.split(':'); const a = F.areas.find((q) => q.id === +id); setAreaDepth(game, +id, a.depth + +d); fleetSig = null; updateFleet(); };
  for (const sEl of box.querySelectorAll('[data-area-u]')) sEl.onchange = () => { setAreaUnit(game, +sEl.dataset.areaU, sEl.value ? +sEl.value : null); fleetSig = null; updateFleet(); };
  for (const b of box.querySelectorAll('[data-area-x]')) b.onclick = () => { removeArea(game, +b.dataset.areaX); fleetSig = null; updateFleet(); };
  for (const b of box.querySelectorAll('[data-fire]')) b.onclick = () => { dismissUnit(game, +b.dataset.fire); fleetSig = null; updateFleet(); };
}

let contractSig = null;
function updateContracts() {
  const sig = JSON.stringify(game.contracts.map((c) => [c.id, c.status, Math.floor(c.done / 50)])) + Math.floor(game.money / 500);
  if (sig === contractSig) return;
  contractSig = sig;
  const box = $('contracts');
  if (!game.contracts.length) { box.innerHTML = '<div class="empty">Keine Aufträge. Reedereien melden sich ab und zu.</div>'; return; }
  box.replaceChildren(...game.contracts.map((c) => {
    const d = document.createElement('div'), cargo = cargoById(c.cargo), cls = shipById(c.cls), active = c.status === 'active';
    const left = Math.max(0, Math.ceil(((active ? c.dueAt : c.offerExpiresAt) - game.time) / CONFIG.daySeconds));
    d.className = 'contract';
    d.innerHTML = `<b>${c.client}</b><small>${num(c.tons)} t ${cargo.name} (${cls.icon} ${cls.name}) · Prämie ${chf(c.bonus)} · Strafe ${chf(c.penalty)}</small><small>${active ? `Noch ${left} Tage` : `Angebot gilt noch ${left} Tage`}</small>`;
    if (active) { const p = document.createElement('progress'); p.max = c.tons; p.value = c.done; d.append(p); }
    else {
      const b = document.createElement('button'); b.textContent = 'Annehmen';
      b.disabled = game.contracts.filter((x) => x.status === 'active').length >= CONFIG.contracts.maxOpen;
      b.onclick = () => { if (acceptContract(game, c.id)) { contractSig = null; updateContracts(); } };
      d.append(b);
    }
    return d;
  }));
}

let logSig = '';
function updateLog() {
  const sig = `${game.log.length}|${game.log[0]?.text}|${game.log[0]?.day}`;
  if (sig === logSig) return;
  logSig = sig;
  $('log').replaceChildren(...game.log.map((e) => { const li = document.createElement('li'); li.className = e.kind; li.textContent = `Tag ${e.day}: ${e.text}`; return li; }));
}

let deltaUntil = 0, lastMoney = null, moneyTimer = 0;
function updateHud() {
  const left = game.timeLeft, mm = Math.floor(left / 60), ss = String(Math.floor(left % 60)).padStart(2, '0');
  const fin = Number.isFinite(game.deadlineDays);
  $('h-day').textContent = fin ? `${Math.min(game.day, game.deadlineDays)}/${game.deadlineDays}` : `${game.day}`;
  $('h-left').textContent = fin ? `(${mm}:${ss})` : '';
  $('h-money').textContent = chf(game.money);
  $('h-money').style.color = game.money < 0 ? 'var(--bad)' : '';
  { const cap = game.stats.bufferCapacity, st = game.stockTotal; $('h-buf').textContent = `${Math.round(st)}/${Math.round(cap)} m³`; $('h-buf').classList.toggle('warn', st >= cap * 0.85); }
  if (performance.now() > deltaUntil) { $('h-income').textContent = ''; $('h-income').className = ''; }
  $('h-tons').textContent = Number.isFinite(game.level.goalTons) ? `${Math.round((game.totals.tons / game.level.goalTons) * 100)}%` : `${num(game.totals.tons)} t`;
  updateMapSelect();
  $('h-wl').textContent = `${game.wl.toFixed(1)} m${game.closed ? ' ⛔' : ''}`;
  const best = loadBest();
  $('h-best').textContent = best === null ? '–' : chf(best);
}
function flashDelta(d) {
  const el = $('h-income');
  el.textContent = `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d)).toLocaleString('de-CH')}`;
  el.className = `delta ${d > 0 ? 'plus' : 'minus'}`;
  deltaUntil = performance.now() + 1500;
}
function trackMoney(dt) {
  moneyTimer += dt;
  if (moneyTimer < 0.7) return;
  moneyTimer = 0;
  if (lastMoney !== null && Math.abs(game.money - lastMoney) >= 5) flashDelta(game.money - lastMoney);
  lastMoney = game.money;
}

// ---------- Menü in Reitern mit Stufensystem: Bereiche erscheinen erst, wenn sie gebraucht werden ----------
const PTABS = [
  { id: 'home', label: '🏠', name: 'Ziel' },
  { id: 'river', label: '🌊', name: 'Fluss' },
  { id: 'gear', label: '⚙', name: 'Technik' },
  { id: 'fleet', label: '🚤', name: 'Flotte', gate: 'tab_fleet' },
  { id: 'trade', label: '💰', name: 'Handel', gate: 'tab_trade' },
  { id: 'maps', label: '🗺', name: 'Karten', gate: 'tab_maps' },
  { id: 'more', label: '☰', name: 'Mehr' },
];
// Freischaltung: Bedingung → Name (für die Meldung «Neu»). Einmal erfüllt bleibt der Bereich offen.
const GATES = {
  tab_fleet: { when: (g) => g.stats.autoLevel >= 1 || g.fleet.units.length > 0 || g.totals.removed >= 600, text: 'Flotte: gemietete Pontons baggern selbstständig' },
  tab_trade: { when: (g) => g.totals.removed >= 150, text: 'Handel: Frachtmarkt und Aufträge' },
  tab_maps: { when: (g) => g.endless, text: 'Karten' },
  sec_traffic: { when: (g) => g.totals.ships >= 3, text: 'Verkehr: Kreuzungsstellen und Warteplätze (Reiter Fluss)' },
  sec_hazard: { when: (g) => g.totals.removed >= 300, text: 'Altlasten (Reiter Fluss)' },
  sec_deposits: { when: (g) => g.day >= 3 || g.totals.removed >= 400, text: 'Rohstoffgebiete (Reiter Fluss)' },
  sec_shore: { when: (g) => g.totals.removed >= 800, text: 'Uferstreifen: breitere Rinne (Reiter Fluss)' },
  up_plant: { when: (g) => g.totals.removed >= 200, text: 'Technik: Anlage ausbauen' },
  up_traffic: { when: (g) => g.totals.ships >= 2, text: 'Technik: Verkehr verbessern' },
  up_gear: { when: (g) => g.totals.removed >= 200, text: 'Technik: Geräte' },
};
let curTab = 'home', ptabsInit = false, newTabs = new Set(), unlockSilent = true;
function gateOpen(id) { return !id || !!game.tabsSeen?.[id]; }
function updateUnlocks() {
  game.tabsSeen ??= {};
  for (const [id, G] of Object.entries(GATES)) {
    if (game.tabsSeen[id] || !G.when(game)) continue;
    game.tabsSeen[id] = true;
    if (!unlockSilent) { toast(`Neu freigeschaltet: ${G.text}`, 'good', true); if (id.startsWith('tab_')) newTabs.add(id.slice(4)); else if (id.startsWith('sec_')) newTabs.add('river'); else newTabs.add('gear'); }
  }
  unlockSilent = false;
  for (const el of document.querySelectorAll('#panel [data-gate]')) el.hidden = !gateOpen(el.dataset.gate);
  for (const [tid, b] of Object.entries(upTabBtns)) { const g = UP_TABS.find((t) => t.id === tid)?.gate; b.hidden = !gateOpen(g); }
  if (upTabBtns[upTab]?.hidden) { upTab = 'pump'; showUpTab(); }
  const vis = PTABS.filter((t) => gateOpen(t.gate));
  if (!vis.some((t) => t.id === curTab)) curTab = 'home';
  const nav = $('ptabs'), sig = vis.map((t) => t.id).join() + curTab + [...newTabs].join();
  if (nav.dataset.sig !== sig) {
    nav.dataset.sig = sig; nav.innerHTML = '';
    for (const t of vis) {
      const b = document.createElement('button'); b.type = 'button'; b.className = `ptab-btn${t.id === curTab ? ' on' : ''}`; b.innerHTML = `<span>${t.label}</span><small>${t.name}</small>${newTabs.has(t.id) ? '<i class="dot"></i>' : ''}`;
      b.onclick = () => { curTab = t.id; newTabs.delete(t.id); nav.dataset.sig = ''; updateUnlocks(); $('panel').scrollTop = 0; };
      nav.append(b);
    }
  }
  for (const el of document.querySelectorAll('#panel .ptab')) el.hidden = el.dataset.tab !== curTab;
}
function updatePanel() { updateUnlocks(); updateMaps(); updateShipping(); updateDeposits(); updateShore(); updateHazard(); updateToolButton(); updateTowButton(); updateTrafficPanel(); updateConcrete(); updateFleet(); updateGoal(); updateFairway(); updateMarket(); updateContracts(); updateUpgrades(); updatePlant(); updateLog(); updateClassbar(); }

// ---------- Overlay, Toast ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = `<div>${html}</div>`; o.classList.add('show'); }
function hideOverlay() { $('overlay').classList.remove('show'); }
const overlayOpen = () => $('overlay').classList.contains('show');

let toastTimer = 0;
function placeHud() { // Anzeigen (Trübung, Puffer) liegen im Querschnitt über dem Bild
  const hud = $('shift-hud'); if (sim.mode !== 'slice') { hud.style.top = ''; hud.style.left = ''; hud.style.right = ''; return; }
  hud.style.top = `${canvas.offsetTop + 4}px`; hud.style.left = '4px'; hud.style.right = '4px';
}
function placeToast() {
  const t = $('toast');
  if (mapFull) { t.style.right = '8px'; t.style.top = ''; return; }
  const visTop = canvas.offsetTop + (cropVis !== null ? panY : 0), visH = cropVis !== null ? cropVis : canvas.clientHeight;
  t.style.right = '8px'; t.style.top = `${Math.max(8, visTop + visH - t.offsetHeight - 12)}px`;
}
function toast(text, kind = 'info', force = false, goto = null) {
  if (!force && (kind === 'info' || kind === 'upgrade')) return;
  $('toast').innerHTML = `<span class="${kind}"></span>`;
  $('toast').firstChild.textContent = text;
  if (goto) { // Meldung mit Sprungknopf zum aufgelaufenen Schiff
    const b = document.createElement('button'); b.className = 'toast-go'; b.textContent = '📍 Zum Schiff';
    b.onclick = () => { gotoShip(goto); $('toast').innerHTML = ''; };
    $('toast').firstChild.append(' ', b);
  }
  placeToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').innerHTML = ''; }, goto ? 12000 : force ? 3800 : 2600);
}

// ---------- Spielfeld einpassen und Steuerungsanzeige ----------
let zoom = 1, panX = 0, panY = 0, cropVis = null;
const MAX_ZOOM = 1.7, MAX_ZOOM_SLICE = 2.3; // im Querschnitt (Hochformat) darf das Bild näher an die Pumpe
let layoutSig = '';
function focusY(lh, h) {
  if (pileMode) return ((planFocus.y * CELL) / lh) * h;
  if (sim.mode === 'slice') return (sliceHeadScreen(sim.slice).y / lh) * h;
  return ((sim.y * CELL) / lh) * h;
}
// Kartenvollbild nur auf Rechner und Handy quer; Handy hochkant behält das bisherige Layout (Karte oben, Bedienung unten)
function applyLayoutMode() {
  const want = curMode() !== 'slice' && !(narrow() && matchMedia('(orientation: portrait)').matches);
  if (document.body.classList.contains('mode-map') !== want) { document.body.classList.toggle('mode-map', want); if (!want) setMenu(false); resetBars(); }
}
// Leisten (Aktionen, Klassen, Kopfzeile) wachsen nur: wechselt ihr Inhalt (Knopf erscheint, Text bricht um), springt die Karte sonst kurz kleiner und wieder grösser
const barMax = {};
function resetBars() { for (const id of Object.keys(barMax)) { $(id).style.minHeight = ''; delete barMax[id]; } layoutSig = ''; }
function stableBar(id) {
  const el = $(id), h = el.offsetHeight;
  if (document.body.classList.contains('mode-map')) return h; // Kartenvollbild: Leisten schweben über der Karte
  if (h > (barMax[id] ?? 0)) { barMax[id] = h; el.style.minHeight = `${h}px`; }
  return barMax[id] ?? h;
}
function panCanvas(dt) {
  applyLayoutMode();
  const sig = `${stableBar('shift-actions')}/${$('touch-ui').offsetHeight}/${stableBar('topbar')}/${stableBar('header-bar')}/${innerHeight}/${innerWidth}`;
  if (sig !== layoutSig) { layoutSig = sig; fitCanvas(); }
  const stageW = $('stage').clientWidth, cw = parseFloat(canvas.style.width) || stageW, ch = parseFloat(canvas.style.height) || 0;
  if (mapFull) {
    const AW = innerWidth, AH = innerHeight, fx0 = pileMode ? planFocus : sim, fxp = tow ? cw / 2 : ((OX + fx0.x * CELL) / canvas.logicalW) * cw;
    const want = cw <= AW ? (AW - cw) / 2 : Math.min(0, Math.max(AW - cw, AW / 2 - fxp));
    panX += (want - panX) * (dt > 0 ? Math.min(1, dt * 6) : 1);
    const fyp = tow ? ch / 2 : ((fx0.y * CELL) / canvas.logicalH) * ch, wantY = ch <= AH ? (AH - ch) / 2 : Math.min(0, Math.max(AH - ch, AH / 2 - fyp));
    panYm += (wantY - panYm) * (dt > 0 ? Math.min(1, dt * 6) : 1);
    canvas.style.left = `${panX}px`; canvas.style.top = `${panYm}px`;
    canvas.style.marginLeft = canvas.style.marginTop = canvas.style.marginBottom = canvas.style.clipPath = '';
    return;
  }
  if (zoom > 1 && pileMode) {
    const fxp = ((OX + planFocus.x * CELL) / canvas.logicalW) * cw, want = Math.min(Math.max(0, fxp - stageW / 2), Math.max(0, cw - stageW));
    panX += (want - panX) * Math.min(1, dt * 6); canvas.style.marginLeft = `${-panX}px`;
  } else if (zoom > 1 && sim.mode === 'slice') {
    const sl = sim.slice, fxp = ((sl.x - sl.x0) / 16) * cw;
    const want = Math.min(Math.max(0, fxp - stageW / 2), Math.max(0, cw - stageW));
    panX += (want - panX) * Math.min(1, dt * 6);
    canvas.style.marginLeft = `${-panX}px`;
  } else canvas.style.marginLeft = '';
  if (cropVis !== null && ch > cropVis) {
    const want = Math.min(Math.max(0, focusY(canvas.logicalH, ch) - cropVis / 2), ch - cropVis);
    panY += (want - panY) * Math.min(1, dt * 6);
    const bottom = ch - cropVis - panY;
    canvas.style.marginTop = `${-panY}px`; canvas.style.marginBottom = `${-bottom}px`; canvas.style.clipPath = `inset(${panY}px 0 ${bottom}px 0)`;
  } else { panY = 0; canvas.style.marginTop = canvas.style.marginBottom = canvas.style.clipPath = ''; }
}
function fitCanvas() {
  const lw = canvas.logicalW, lh = canvas.logicalH, stage = $('stage');
  if (!lw) return;
  let below = 0;
  for (const el of stage.children) {
    if (el === canvas || el.hidden) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.position !== 'static') continue;
    below += (el.id === 'shift-actions' ? el.scrollHeight : el.offsetHeight) + (el.id === 'touch-ui' ? 0 : parseFloat(cs.marginTop) + parseFloat(cs.marginBottom));
  }
  const docTop = stage.getBoundingClientRect().top + scrollY - $('topbar').offsetHeight * 0; // die Klassenleiste zählt oben mit
  const stageW = stage.clientWidth;
  const portrait = narrow() && matchMedia('(orientation: portrait)').matches;
  zoom = 1; cropVis = null;
  let w, h;
  document.documentElement.style.setProperty('--hdr-h', `${$('header-bar').offsetHeight}px`);
  mapFull = document.body.classList.contains('mode-map');
  if (mapFull) { // Karte und Schleppen: das Bild füllt den ganzen Bildschirm (hochkant: Höhe füllen, seitlich dem Ponton folgen)
    const AW = innerWidth, AH = innerHeight, aspect = lw / lh;
    if (AW / AH >= aspect) { w = AW; h = AW / aspect; } // breiter als die Karte: Breite füllen, in der Höhe dem Ponton folgen
    else { w = Math.min(AH * aspect, AW * 2.1); h = w / aspect; } // schmaler: Höhe füllen (bis 2,1-fach), seitlich dem Ponton folgen
    if (pileMode) { w *= pileZoom; h *= pileZoom; }
    canvas.style.position = 'absolute';
  } else { canvas.style.position = ''; canvas.style.left = ''; canvas.style.top = ''; }
  if (mapFull) { /* oben berechnet */ }
  else if (portrait && pileMode) { // Pfahlwand planen im Hochformat: auf die Planungsstelle zoomen, Joystick verschiebt
    const visAvail = Math.max(60, innerHeight - docTop - below - 12);
    zoom = pileZoom; w = stageW * zoom; h = w * (lh / lw); if (h > visAvail + 1) cropVis = visAvail;
  }
  else if (portrait && sim.mode === 'slice') {
    const visAvail = Math.max(60, innerHeight - docTop - below - 12), nat = (stageW * lh) / lw;
    zoom = Math.min(MAX_ZOOM_SLICE, Math.max(1, visAvail / nat));
    w = stageW * zoom; h = w * (lh / lw);
    if (h > visAvail + 1) cropVis = visAvail;
  } else {
    const availH = Math.max(narrow() ? 60 : 220, innerHeight - docTop - below - (narrow() ? 64 : 16));
    ({ w, h } = fitSize(stageW, availH, lw, lh));
  }
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  const q = renderQuality(devicePixelRatio, w, lw);
  const cw = Math.round(lw * q), chh = Math.round(lh * q);
  if (canvas.width !== cw || canvas.height !== chh) { canvas.width = cw; canvas.height = chh; }
  canvas.q = cw / lw;
  view.s = w / lw; fx.view = view.s;
  panCanvas(0); placeToast(); placeHud();
}

function updateHints() {
  const box = $('hints');
  box.replaceChildren(...hintsFor(curMode(), isTouch).map(([key, what]) => {
    const item = document.createElement('span'), k = document.createElement('kbd');
    k.textContent = key; item.append(k, what);
    return item;
  }));
}

// ---------- Modus: Karte / Querschnitt ----------
function syncMode() {
  const mode = curMode();
  fx.clear(); audio.hum(false, 0);
  $('shift-hud').hidden = false; $('shift-actions').hidden = false;
  document.body.classList.toggle('mode-slice', mode === 'slice'); applyLayoutMode(); // Querschnitt: Anzeigen liegen im Bild, Leisten werden kompakt
  $('btn-anchor').hidden = mode !== 'map'; $('btn-leave').hidden = mode !== 'slice' && mode !== 'tow'; $('btn-pump').hidden = mode !== 'slice';
  $('btn-land').hidden = mode !== 'map' || !game.port.open; $('btn-zone').hidden = mode !== 'map'; $('btn-area').hidden = mode !== 'map' || game.stats.autoLevel < 1; $('btn-route').hidden = $('btn-area').hidden; syncAreaButtons();
  $('btn-leave').textContent = mode === 'tow' ? '↩ Schleppen abbrechen (Q)' : '↩ Zurück zur Karte (Q)';
  $('s-mode').textContent = { map: 'Karte', slice: 'Querschnitt', tow: 'Schleppen' }[mode];
  if (mode !== 'slice') { $('btn-tool').hidden = true; $('btn-auto').hidden = true; $('btn-fix').hidden = true; $('cut-box').hidden = true; $('spd-box').hidden = true; }
  updateHints(); fitCanvas();
}
function anchor() {
  if (lentUnit(game)) { toast('Dein Ponton arbeitet für die Flotte: im Panel «Flotte» zurückrufen', 'bad', true); return; }
  if (!sim.canFloat(sim.x, sim.y)) { toast('Hier ist zu wenig Wasser für den Ponton', 'bad', true); return; }
  if (!sim.anchor()) return;
  syncMode();
}
function leave() { if (tow) { tow = null; syncMode(); return; } if (sim.leave()) syncMode(); }

// Aufläufer freischleppen: Ponton nahe ans Schiff, dann Minispiel
// Hafenkarte: der eigene Ponton fährt im Hafenbecken (eigenes Flussbett), die Hauptkarte läuft im Hintergrund weiter
function enterHarbor() {
  if (harborView || tow) return;
  if (!game.port.harbor) { toast('Der Hafen muss erst eröffnet sein (Hafen, H)', 'bad', true); return; }
  if (sim.mode === 'slice') sim.leave();
  mainSim = sim;
  if (!harborSim || harborSim.river !== game.port.harbor.river) { harborSim = game.createSession(game.port.harbor.river); harborSim.x = 1.5; harborSim.y = (HARBOR.entrance.y0 + HARBOR.entrance.y1 + 1) / 2; }
  if (lentUnit(game)) { harborSim.x = (HARBOR.basin.x0 + HARBOR.basin.x1) / 2; harborSim.y = (HARBOR.basin.y0 + HARBOR.basin.y1) / 2; } // dein Ponton arbeitet für die Flotte: nur zuschauen
  sim = harborSim; sim.setStats(game.stats); harborView = true; ui.harborView = true; document.body.classList.add('harbor-view');
  mapTarget = null; zoneMode = false; ui.zoneMode = false; areaMode = false; ui.areaMode = false; landMode = false; ui.landMode = false;
  syncMode(); updateTowButton(); fitCanvas(); toast('Hafenkarte: Becken ausbaggern, Pontons im Panel «Flotte» zuteilen', 'info', true);
}
function leaveHarbor(silent = false) {
  if (!harborView) return;
  if (sim.mode === 'slice') sim.leave();
  sim = mainSim; mainSim = null; harborView = false; ui.harborView = false; document.body.classList.remove('harbor-view'); mapTarget = null;
  if (sim) sim.setStats(game.stats);
  syncMode(); updateTowButton(); fitCanvas(); if (!silent) toast('Zurück auf der Hauptkarte', 'info', true);
}
// Verladen auf der Hafenkarte: Zeiger im grünen Bereich auslösen (Taste L oder Knopf); lädt den ersten angelegten Auftrag, Kran/Radlader zeigen den Umschlag
const lb = { phase: 0, zone: 0.5, msg: '', msgT: 0 };
function harborLoadHit() {
  const g = game, M = PORT.machines[machineOf(g)], pos = 0.5 + 0.5 * Math.sin(lb.phase), d = Math.abs(pos - lb.zone) / (M.zone / 2), q = d <= 1 ? 1 - d * 0.5 : 0, got = portLoadHit(g, q);
  lb.msg = q <= 0 ? 'Daneben!' : q > 0.85 ? `Voltreffer! +${Math.round(got)} t` : `+${Math.round(got)} t`; lb.msgT = 1.2; lb.zone = 0.2 + Math.random() * 0.6;
}
function updateLoadBar(dt) {
  const bar = $('load-bar'), job = harborView ? game.port.jobs?.find(isDocked) : null;
  bar.hidden = !job; if (!job) return;
  const M = PORT.machines[machineOf(game)];
  lb.phase += dt * M.speed * 2.2; lb.msgT = Math.max(0, lb.msgT - dt);
  $('lb-mark').style.left = `${(0.5 + 0.5 * Math.sin(lb.phase)) * 100}%`; $('lb-zone').style.left = `${(lb.zone - M.zone / 2) * 100}%`; $('lb-zone').style.width = `${M.zone * 100}%`;
  $('lb-text').textContent = lb.msgT > 0 ? lb.msg : `${PORT.commodities[job.cargo].icon} ${job.out ? 'Laden' : 'Entladen'} ${Math.round(job.done)}/${job.tons} t · ${M.icon} ${M.name}`;
}
$('lb-hit').onclick = harborLoadHit;
function toggleHarborView() { if (harborView) leaveHarbor(); else enterHarbor(); }
// Zum aufgelaufenen Schiff springen: Karte wechseln, Ponton neben das Schiff setzen
function gotoShip({ map, ship: id }) {
  if (map !== game.mapIdx) { if (!game.endless) return; changeMap(map); }
  const ship = game.traffic.ships.find((s) => s.id === id);
  if (!ship || ship.state !== 'grounded') { toast('Das Schiff ist schon wieder frei oder abgeschleppt.', 'info', true); return; }
  if (tow) tow = null;
  if (sim.mode === 'slice') sim.leave();
  const p = shipPos(ship); let best = null, bd = Infinity; // nächste Zelle, auf der der Ponton schwimmt
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = Math.floor(p.x) + dx + 0.5, y = Math.floor(p.y) + dy + 0.5, d = Math.hypot(x - p.x, y - p.y); if (d < bd && d <= 3.5 && sim.canFloat(x, y)) { bd = d; best = { x, y }; } }
  if (!best) { toast('Kein Platz für den Ponton neben dem Schiff: von Hand heranfahren.', 'bad', true); return; }
  sim.x = best.x; sim.y = best.y; mapTarget = null; syncMode(); updateTowButton();
  toast('Beim Schiff: «Schleppen» (T) startet das Freiziehen', 'info', true);
}
function startTow() {
  if (tow || sim.mode !== 'map') return;
  const ship = groundedNear(game, sim.x, sim.y);
  if (!ship) { toast('Kein aufgelaufenes Schiff in Reichweite: näher heranfahren', 'bad', true); return; }
  tow = new TowSim(game, ship); mapTarget = null; syncMode();
  toast('Zugtaste halten: Spannung im grünen Bereich halten', 'info', true);
}
// Aufgelaufene Schiffe auf allen Karten (aktuelle Karte zuerst)
function groundedAll() {
  const out = [];
  game.maps.forEach((m, k) => { for (const s of m.traffic.ships) if (s.state === 'grounded' && s.path) out.push({ map: k, ship: s.id, name: m.name, x: Math.floor(shipPos(s).x) + 1 }); });
  return out.sort((a, b) => (a.map === game.mapIdx ? 0 : 1) - (b.map === game.mapIdx ? 0 : 1));
}
// Schnellknopf: eigenen Ponton der Flotte zuteilen bzw. wieder herausnehmen
function toggleLend() {
  if (tow) return;
  if (lentUnit(game)) { const pos = recallPonton(game); if (pos) { sim.x = pos.x; sim.y = pos.y; } fleetSig = null; updateFleet(); syncMode(); updateTowButton(); toast('Dein Ponton ist zurück: du steuerst ihn wieder selbst', 'info', true); return; }
  const why = lendBlock(game); if (why) { toast(why, 'bad', true); return; }
  if (sim.mode === 'slice') sim.leave();
  if (lendPonton(game, sim.x, sim.y)) { fleetSig = null; updateFleet(); syncMode(); updateTowButton(); toast('Dein Ponton arbeitet für die Flotte (nochmals tippen: zurücknehmen)', 'good', true); }
}
// Knöpfe unter der Karte: «Flotte ▾» klappt alle Werkzeuge rund um die Flotte (Gebiet, Route, Pfahlwand, Kreuzung, Land, Ponton zuteilen) auf
let toolsOpen = false;
function toggleTools(open = !toolsOpen) { toolsOpen = open; document.body.classList.toggle('tools-open', open); layoutSig = ''; }
function updateToolButtons() {
  const act = { 'btn-area': areaMode && areaKind === 'rect', 'btn-route': areaMode && areaKind === 'route', 'btn-pile': pileMode, 'btn-zone': zoneMode, 'btn-land': landMode };
  const tools = [...document.querySelectorAll('#shift-actions .tool-btn')];
  for (const b of tools) b.classList.toggle('on', !!act[b.id]);
  $('btn-pile').hidden = !(game.stats.betonrohr > 0 || (game.fleet.pilePlan ?? []).length || pileMode) || sim.mode !== 'map' || !!tow;
  const fm = $('btn-fleetmenu'); fm.hidden = !tools.some((b) => !b.hidden) || sim.mode !== 'map' || !!tow;
  fm.classList.toggle('open', toolsOpen); fm.textContent = toolsOpen ? '🚤 Flotte ▴' : '🚤 Flotte ▾';
}
$('btn-fleetmenu').onclick = () => toggleTools();
function updateTowButton() {
  updateToolButtons();
  const hb = $('btn-harborview'); hb.hidden = !game.port.open || !game.port.harbor || !!tow; hb.textContent = harborView ? '↩ Hauptkarte (Y)' : '⚓ Hafenkarte (Y)'; hb.classList.toggle('primary', harborView);
  const lb = $('btn-fleetlend'), lent = !!lentUnit(game);
  lb.hidden = !!tow || (!lent && game.stats.autoLevel < 1);
  lb.textContent = lent ? '↩ Aus Flotte nehmen (J)' : '🧑‍✈️ Zur Flotte (J)'; lb.classList.toggle('primary', lent);
  const gb = $('btn-goto'), all = groundedAll(), first = all[0];
  gb.hidden = !first || !!tow || (first.map === game.mapIdx && sim.mode === 'map' && !!groundedNear(game, sim.x, sim.y));
  if (!gb.hidden) { gb.textContent = `📍 Zum Aufläufer${game.maps.length > 1 ? ` (${first.name}, Spalte ${first.x})` : ` (Spalte ${first.x})`}${all.length > 1 ? ` · ${all.length}` : ''}`; gb.onclick = () => gotoShip(first); }
  const b = $('btn-tow'), any = game.traffic.ships.some((s) => s.state === 'grounded');
  b.hidden = !any || !!tow || sim.mode !== 'map';
  if (!b.hidden) { const near = groundedNear(game, sim.x, sim.y); b.disabled = !near; b.textContent = near ? '🛟 Aufläufer freischleppen (T)' : '🛟 Aufläufer: näher heranfahren'; b.classList.toggle('primary', !!near); }
}
function toggleAuto() { sim.toggleAuto(); }
function toggleSound() { audio.setMuted(!audio.muted); for (const id of ['btn-sound', 'btn-sound2']) $(id).textContent = audio.muted ? '🔇 Ton aus (M)' : '🔊 Ton an (M)'; }
function togglePump() {
  if (sim.mode === 'slice' && sim.slice.freeing) {
    const r = sim.freeAttempt();
    if (r) { const m = sliceMouthScreen(sim.slice); audio.free(r); fx.burst(m.x, m.y, r === 'cleared' ? 24 : r === 'hit' ? 8 : 4, r === 'miss' ? 'dust' : 'hard', r === 'cleared' ? 220 : 120); }
    return;
  }
  if (sim.togglePump()) audio.toggle(sim.pumpOn);
}
function fixAuto() { sim.fixAuto(); }
function toggleTool() {
  const to = sim.nextTool();
  if (to === sim.tool) { toast('Kein weiteres Gerät: Löffelbagger oder Betoniergerät unter Ausrüstung kaufen', 'bad', true); return; }
  if (!sim.setTool(to)) { toast('Gerät lässt sich jetzt nicht wechseln (Verstopfung)', 'bad', true); return; }
  game.tool = sim.tool; audio.toggle(true);
  if (sim.mode === 'map') toast(`Nächste Verankerung mit ${toolName(to)}`, 'info', true);
}
function updateToolButton() {
  const b = $('btn-tool'), has = game.stats.loeffel > 0 || game.stats.betonrohr > 0;
  b.hidden = !has || !!tow;
  if (has) b.textContent = `🔧 Gerät: ${toolName(sim.tool)} (V)`;
}
function setDepthValue(v) {
  sim.setTargetDepth(v);
  game.targetDepth = sim.targetDepth;
  $('cut').value = sim.targetDepth; $('cut-val').textContent = `${sim.targetDepth.toFixed(1)} m`;
}
function setSpeed(v) {
  sim.setPumpSpeed(v);
  game.pumpSpeed = sim.pumpSpeed;
  $('spd').value = sim.pumpSpeed; $('spd-val').textContent = pct(sim.pumpSpeed);
}
function togglePause() {
  paused = !paused;
  $('btn-pause').textContent = paused ? '▶ Weiter (P)' : '⏸ Pause (P)';
  $('btn-pause2').textContent = paused ? '▶' : '⏸';
  if (paused) saveGame();
}
function setMenu(open) { // Menü (Panel) im Kartenvollbild: Schublade von rechts; auf dem Handy pausiert das Spiel wie beim Panel
  menuOpen = open && document.body.classList.contains('mode-map');
  document.body.classList.toggle('menu-open', menuOpen); $('scrim').hidden = !menuOpen;
  sheetOpen = menuOpen && narrow() ? true : (document.body.classList.contains('mode-map') ? false : sheetOpen);
  if (menuOpen) { saveGame(); updatePanel(); }
}
function setSheet(open) {
  sheetOpen = open && narrow();
  $('panel').classList.toggle('open', sheetOpen);
  if (sheetOpen) saveGame();
}

// ---------- Flussmeister Fritz (Tipps, Spiel pausiert) ----------
const FRITZ_SVG = `<svg viewBox="0 0 100 100" width="72" height="72" aria-hidden="true">
  <circle cx="50" cy="60" r="30" fill="#f1c9a0" stroke="#7a5230" stroke-width="2"/>
  <path d="M18 44 Q50 6 82 44 L82 50 L18 50Z" fill="#1f3f66" stroke="#10243f" stroke-width="2"/>
  <rect x="14" y="46" width="72" height="9" rx="4" fill="#0f2742"/><circle cx="50" cy="32" r="7" fill="#f2c94c" stroke="#8a6d00" stroke-width="1.5"/>
  <circle cx="39" cy="63" r="5.5" fill="#fff" stroke="#444"/><circle cx="61" cy="63" r="5.5" fill="#fff" stroke="#444"/>
  <circle cx="40" cy="64" r="2.6" fill="#222"/><circle cx="62" cy="64" r="2.6" fill="#222"/>
  <path d="M36 76 Q50 70 64 76 Q58 86 50 83 Q42 86 36 76Z" fill="#cfcfcf" stroke="#777"/>
  <path d="M42 80 Q50 84 58 80" stroke="#7a3b2a" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>`;
function closeTip() { tipOpen = false; $('bruno').hidden = true; $('bruno').innerHTML = ''; }
function showTip(tip) {
  tipOpen = true;
  const box = $('bruno');
  box.innerHTML = `<div class="bruno-row"><div class="bruno-head">${FRITZ_SVG}<small>Flussmeister Fritz</small></div>
    <div class="bruno-bubble"><p></p><div class="bruno-btns"></div><div class="bruno-links"></div></div></div>`;
  box.querySelector('p').textContent = tip.text;
  const btns = box.querySelector('.bruno-btns'), links = box.querySelector('.bruno-links');
  const mk = (parent, text, fn, cls = '') => { const b = document.createElement('button'); b.textContent = text; if (cls) b.className = cls; b.onclick = fn; parent.append(b); return b; };
  if (tip.upgrade) {
    const u = UPGRADES[tip.upgrade.id];
    mk(btns, `${u.name} kaufen (${chf(tip.upgrade.cost)})`, () => { if (game.buyUpgrade(tip.upgrade.id)) { applyStats(); updatePanel(); toast(`${u.name} gekauft. Fritz nickt anerkennend.`, 'good', true); } closeTip(); }, 'primary');
  }
  mk(btns, 'Danke, Fritz', closeTip);
  mk(links, 'Diesen Tipp nie mehr', () => { advisor.mute(tip.id); saveMuted(advisor.muted); closeTip(); });
  mk(links, 'Fritz ausschalten', () => { setFritz(false); closeTip(); });
  box.hidden = false;
}
function setFritz(on) {
  advisor.enabled = on; $('chk-fritz').checked = on;
  try { localStorage.setItem(FRITZ_KEY, on ? '1' : '0'); } catch { /* egal */ }
  if (!on) closeTip();
}

// ---------- Spielende, Level ----------
function showEnd() {
  endShown = true;
  clearSave();
  const e = game.end, t = game.totals, best = loadBest(), won = game.won;
  const record = won && (best === null || e.finalMoney > best);
  const idx = LEVELS.findIndex((l) => l.id === game.levelId), wasLocked = idx >= 0 && idx + 1 < LEVELS.length && !levelUnlocked(idx + 1);
  if (record) saveBest(e.finalMoney);
  const unlockNote = wasLocked && levelUnlocked(idx + 1) ? `Neues Level freigeschaltet: ${LEVELS[idx + 1].name}!` : '';
  const title = e.reason === 'bankrupt' ? 'Konzession entzogen' : won ? 'Wasserstrasse offen: Ziel erreicht!' : e.goalReached ? 'Frist abgelaufen (mit Verlust)' : 'Frist abgelaufen: Verkehrsziel verfehlt';
  const cargoLine = Object.entries(t.byCargo).sort((a, b) => b[1] - a[1]).map(([id, v]) => `${cargoById(id).name} ${num(v)} t`).join(' · ');
  showOverlay(`<h2>${title}</h2>
    <p>Endstand: <b>${chf(e.finalMoney)}</b>${record ? ' <b class="good">Neuer Rekord!</b>' : best !== null ? `<br><small>Rekord: ${chf(best)}</small>` : ''}</p>
    <p><small>Fracht ${num(t.tons)}${Number.isFinite(game.level.goalTons) ? ` / ${num(game.level.goalTons)}` : ''} t · ${t.ships} Schiffe · ${t.rejected} abgewiesen (entgangen ca. ${chf(t.lostValue)}) · ${t.groundings} Havarien (${chf(t.salvage)})<br>
    Verkehr +${chf(t.trafficIncome)} · Baggerentgelt +${chf(t.pay)} · Anlage ${t.plantNet >= 0 ? '+' : '−'}${chf(Math.abs(t.plantNet))} · Aufträge +${chf(t.contractsPaid)} (${t.contractsDone} erfüllt, ${t.contractsFailed} verpasst)<br>
    Betrieb −${chf(t.opCost)} · Bussen −${chf(t.fines + t.protectFines)} · Reparaturen −${chf(t.repairs + t.eventCosts)}<br>
    Gebaggert ${num(t.removed)} m³ · ${cargoLine || 'keine Fracht'}</small></p>
    <p>${e.reason === 'bankrupt' ? 'Das Geld ist weg.' : won ? 'Gewonnen hat, wer am Ende am meisten Geld hat.' : 'Das Verkehrsziel schaltet das nächste Level frei.'}</p>
    <button class="primary" id="btn-restart">Neues Spiel</button>`);
  $('btn-restart').onclick = () => showLevels(unlockNote);
}

function applyLevel() {
  const nm = game.endless ? `${game.level.short} #${game.seed} · ${game.map.name}` : game.level.short;
  $('level-name').textContent = nm;
  document.title = `Fahrrinne frei! · ${nm}`;
}

function showLevels(note = '') {
  const best = loadLevels();
  const rows = LEVELS.map((l, i) => {
    const open = levelUnlocked(i), b = best[l.id];
    return `<button class="level${open ? '' : ' locked'}" data-level="${l.id}" ${open ? '' : 'disabled'}>
      <span class="swatch" style="background:rgb(${l.palette.water.join(',')})"></span>
      <span class="ltxt"><b>${open ? '' : '🔒 '}${l.name}</b><small>${l.blurb}</small>
      <small>Ziel ${num(l.goalTons)} t · ${l.deadlineDays} Tage · Start ${chf(l.startMoney)}${b !== undefined ? ` · Rekord ${chf(b)}` : ''}${open ? '' : ` · erreiche das Ziel in ${LEVELS[i - 1].short} und schliesse mit Gewinn ab`}</small></span></button>`;
  }).join('');
  const endless = `<div class="endless-row"><b>♾ ${ENDLESS.name}</b><small>${ENDLESS.blurb}</small>
      <div class="seedrow"><label>Seed <input id="seed-in" type="number" min="0" max="99999999" value="${Math.floor(Math.random() * 90000) + 1000}"></label><button id="btn-seed" title="Zufälliger Seed">🎲</button><button id="btn-endless" class="primary">Endlos starten</button></div></div>`;
  showOverlay(`<h2>Fahrrinne frei!</h2>${note ? `<p class="good">${note}</p>` : ''}<p>Welcher Fluss soll es sein?</p><div class="levels">${rows}</div>${endless}`);
  for (const b of document.querySelectorAll('#overlay .level:not(.locked)')) b.onclick = () => restart(b.dataset.level);
  $('btn-seed').onclick = () => { $('seed-in').value = Math.floor(Math.random() * 90000000); };
  $('btn-endless').onclick = () => restart({ levelId: ENDLESS.id, seed: Math.max(0, Math.floor(+$('seed-in').value) || 0) });
}

function restart(loaded = null) {
  harborView = false; ui.harborView = false; mainSim = null; harborSim = null; document.body.classList.remove('harbor-view');
  curTab = 'home'; newTabs = new Set(); unlockSilent = true; $('ptabs').dataset.sig = '';
  game = loaded instanceof Game ? loaded : loaded && typeof loaded === 'object' ? new Game(loaded.seed, loaded.levelId) : new Game(undefined, typeof loaded === 'string' ? loaded : game.levelId);
  sim = game.createSession(); sim.autoRange = game.autoRange ?? null; paused = false; endShown = false;
  $('btn-pause').textContent = '⏸ Pause (P)';
  sizeCanvas(canvas);
  setSheet(false); mapTarget = null; contractSig = null; marketSig = ''; logSig = ''; $('goal').innerHTML = '';
  classSel = null; ui.classSel = null; ui.floaters = []; fleetSig = null; concreteSig = null; trafficSig = null; hazardSig = null; depositSig = null; zoneMode = false; ui.zoneMode = false; ui.hoverX = null; areaMode = false; ui.areaMode = false; areaKind = 'rect'; ui.areaKind = 'rect'; ui.routePts = null; ui.areaA = null; pileMode = false; ui.pileMode = false; document.body.classList.remove('pile-mode'); $('pile-bar').hidden = true; landMode = false; ui.landMode = false; $('land-bar').hidden = true; $('btn-land').textContent = '🛣 Land (L)'; tow = null;
  buildClassbar();
  // Vorauswahl: die kleinste Klasse, die noch nicht fährt
  const first = game.level.classes.find((id) => !game.fair[id].passable);
  if (first) { classSel = first; ui.classSel = first; }
  hideOverlay(); syncMode(); updatePanel();
  lastMoney = null; stateSig = null; closeTip(); advisor = new Advisor(loadMuted()); advisor.enabled = fritzOn();
  applyLevel();
  setDepthValue(game.targetDepth);
  if (!(loaded instanceof Game)) { clearSave(); toast(game.level.blurb, 'info', true); } else saveGame();
}

// Spielstand sichern/laden (Datei oder Zwischenablage): so lässt er sich weitergeben oder auf ein anderes Gerät holen
const saveMsg = (t) => { $('save-msg').textContent = t; };
$('btn-export').onclick = () => {
  try {
    const blob = new Blob([serializeGame(game)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `fahrrinne-frei-tag${game.day}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    saveMsg('Spielstand als Datei gespeichert.');
  } catch { saveMsg('Export nicht möglich.'); }
};
$('btn-copy').onclick = async () => {
  try { await navigator.clipboard.writeText(serializeGame(game)); saveMsg('Spielstand in die Zwischenablage kopiert.'); } catch { saveMsg('Kopieren nicht möglich: nimm den Export als Datei.'); }
};
$('btn-import').onclick = () => $('file-import').click();
$('file-import').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const text = await file.text(), g = restoreGame(text);
    if (!g) { saveMsg('Datei ist kein gültiger Spielstand (oder von einer inkompatiblen Version).'); return; }
    restart(g); saveMsg('Spielstand geladen.');
  } catch { saveMsg('Datei konnte nicht gelesen werden.'); }
};

$('btn-pump').onclick = togglePump;
$('chk-fritz').checked = advisor.enabled;
$('chk-fritz').onchange = (e) => setFritz(e.target.checked);
$('btn-sound').onclick = toggleSound; $('btn-sound2').onclick = toggleSound;
for (const id of ['btn-sound', 'btn-sound2']) $(id).textContent = audio.muted ? '🔇 Ton aus (M)' : '🔊 Ton an (M)';
$('btn-pause').onclick = togglePause;
let resizeT = 0;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { resetBars(); fitCanvas(); placeToast(); }, 120); }); // gebündelt: Adressleisten und Tastatur lösen viele Resize-Ereignisse aus
addEventListener('orientationchange', () => setTimeout(() => { resetBars(); fitCanvas(); }, 250));
$('btn-pause2').onclick = togglePause;
$('panel-handle').onclick = () => setSheet(!sheetOpen);
$('map-select').onchange = (e) => changeMap(+e.target.value);
$('btn-menu').onclick = () => setMenu(!menuOpen); $('btn-menu-close').onclick = () => setMenu(false); $('scrim').onclick = () => setMenu(false);
addEventListener('resize', () => { if (sheetOpen && !narrow()) setSheet(false); });

const touch = isTouch ? setupTouch(readInput, { anchor, togglePump }) : null;
readInput.onTap((px, py) => {
  if (pileMode && sim.mode === 'map' && !tow && !paused && !sheetOpen && !overlayOpen()) { pileClick(px, py); return; }
  if (landMode && sim.mode === 'map' && !tow && !paused && !sheetOpen && !overlayOpen()) { landClick(px, py); return; }
  if (areaMode && sim.mode === 'map' && !tow && !paused && !sheetOpen && !overlayOpen()) { areaClick(px, py); return; }
  if (zoneMode && sim.mode === 'map' && !tow && !paused && !sheetOpen && !overlayOpen()) { zoneClick(px, py); return; }
  if (harborView && !paused && !sheetOpen && !overlayOpen()) { // Klick auf einen Warteraum: Fracht zuweisen (alle → Kies → Öl → Container)
    const cx = (px - OX) / CELL, cy = py / CELL;
    for (let k = 0; k < HARBOR.waitX.length; k++) { const wp = waitPos(k); if (cx >= wp.x - 2 && cx <= wp.x + 2 && cy >= wp.y - 1.5 && cy <= wp.y + 1.5 + 1) { if (cycleWaitCargo(game, k)) { const c = game.port.waitCargo[k]; toast(`Warteraum ${k + 1}: ${c ? PORT.commodities[c].name : 'alle Frachten'}`, 'info', true); return; } } }
  }
  if (sim.mode !== 'map' || paused || sheetOpen || overlayOpen()) return;
  mapTarget = { x: Math.min(game.river.cols, Math.max(0, (px - OX) / CELL)), y: Math.min(game.river.rows, Math.max(0, py / CELL)) };
});
$('btn-anchor').onclick = anchor;
$('btn-zone').onclick = toggleZoneMode;
$('btn-harborview').onclick = toggleHarborView; $('btn-fleetlend').onclick = toggleLend; $('btn-pile').onclick = togglePileMode; $('btn-area').onclick = toggleAreaMode; $('btn-route').onclick = toggleRouteMode; $('btn-land').onclick = toggleLandMode;
for (const b of $('land-bar').querySelectorAll('[data-tool]')) b.onclick = () => setLandTool(b.dataset.tool);
$('land-done').onclick = toggleLandMode;
for (const b of $('pile-bar').querySelectorAll('[data-ptool]')) b.onclick = () => { pileTool = b.dataset.ptool; pileA = null; ui.pileA = null; syncPileButton(); };
$('pile-clear').onclick = () => { const n = clearPilePlan(game); toast(n ? `Plan gelöscht (${n} Zellen)` : 'Plan ist leer', 'info', true); fleetSig = null; };
$('pile-zin').onclick = () => pileZoomBy(1.3); $('pile-zout').onclick = () => pileZoomBy(1 / 1.3); $('pile-done').onclick = togglePileMode;
canvas.addEventListener('pointermove', (e) => { // Setz-Modus: Spalte unter dem Zeiger
  if (areaMode || landMode || pileMode) { const r = canvas.getBoundingClientRect(); ui.hoverCell = cellAt(((e.clientX - r.left) / r.width) * canvas.logicalW, ((e.clientY - r.top) / r.height) * canvas.logicalH); return; }
  if (!zoneMode) { ui.hoverX = null; return; }
  const r = canvas.getBoundingClientRect();
  ui.hoverX = Math.floor((((e.clientX - r.left) / r.width) * canvas.logicalW - OX) / CELL);
});
canvas.addEventListener('pointerdown', (e) => { // Maus: Klick setzt oder entfernt eine Kreuzungsstelle (Touch läuft über onTap)
  if (pileMode && e.pointerType !== 'touch' && sim.mode === 'map' && !tow) { const r2 = canvas.getBoundingClientRect(); pileClick(((e.clientX - r2.left) / r2.width) * canvas.logicalW, ((e.clientY - r2.top) / r2.height) * canvas.logicalH); return; }
  if (landMode && e.pointerType !== 'touch' && sim.mode === 'map' && !tow) { const r1 = canvas.getBoundingClientRect(); landClick(((e.clientX - r1.left) / r1.width) * canvas.logicalW, ((e.clientY - r1.top) / r1.height) * canvas.logicalH); return; }
  if (areaMode && e.pointerType !== 'touch' && sim.mode === 'map' && !tow) { const r0 = canvas.getBoundingClientRect(); areaClick(((e.clientX - r0.left) / r0.width) * canvas.logicalW, ((e.clientY - r0.top) / r0.height) * canvas.logicalH); return; }
  if (!zoneMode || e.pointerType === 'touch' || sim.mode !== 'map' || tow) return;
  const r = canvas.getBoundingClientRect();
  zoneClick(((e.clientX - r.left) / r.width) * canvas.logicalW, ((e.clientY - r.top) / r.height) * canvas.logicalH);
});
// Automatik-Linien ziehen (Maus und Touch)
let lineDrag = null;
const logicalPos = (e) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * canvas.logicalW, y: ((e.clientY - r.top) / r.height) * canvas.logicalH }; };
canvas.addEventListener('pointerdown', (e) => {
  if (sim.mode !== 'slice' || sim.stats.autoLevel <= 0 || paused || sim.slice.freeing) return;
  const p = logicalPos(e), [xa, xb] = autoLineX(sim.slice), grab = e.pointerType === 'touch' ? 34 : 20;
  const da = Math.abs(p.x - xa), db = Math.abs(p.x - xb);
  if (Math.min(da, db) > grab || p.y > 150) return; // nur am oberen Griff greifen, damit das Steuern nicht stört
  lineDrag = da <= db ? 'a' : 'b';
  canvas.setPointerCapture(e.pointerId); e.stopImmediatePropagation(); e.preventDefault();
}, true);
canvas.addEventListener('pointermove', (e) => {
  if (!lineDrag) return;
  const sl = sim.slice, [xa, xb] = autoLineX(sl), x = logicalPos(e).x, U = canvas.logicalW / 16;
  const a = sl.x0 + (lineDrag === 'a' ? Math.round(x / U) : Math.round(xa / U)), b = sl.x0 + (lineDrag === 'b' ? Math.round(x / U) - 1 : Math.round(xb / U) - 1);
  const k = lineDrag === 'a' ? Math.min(a, b) : a, m = lineDrag === 'b' ? Math.max(b, a) : b;
  sim.setAutoBounds(k, m); game.autoRange = sim.autoRange;
});
addEventListener('pointerup', () => { lineDrag = null; });
const portUi = setupPort($('port-page'), () => game, () => updatePanel());
const portOpen = () => !$('port-page').hidden;
function togglePort() { if (!portOpen() && overlayOpen()) return; $('port-page').hidden = portOpen(); if (portOpen()) portUi.render(true); }
$('port-page').addEventListener('click', (e) => { if (e.target.closest('#port-close')) togglePort(); });
$('btn-port').onclick = togglePort;
$('btn-leave').onclick = leave;
$('btn-auto').onclick = toggleAuto;
$('btn-fix').onclick = fixAuto;
$('btn-tool').onclick = toggleTool;
$('btn-tow').onclick = startTow;
$('cut').oninput = (e) => setDepthValue(parseFloat(e.target.value));
$('spd').oninput = (e) => setSpeed(parseFloat(e.target.value));

// ---------- Hauptschleife ----------
let last = performance.now(), panelTimer = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  ui.dt = dt; ui.t += dt;
  if (game.endless && sim.mode === 'map' && !tow) { if (readInput.tap('Period')) changeMap((game.mapIdx + 1) % game.maps.length); if (readInput.tap('Comma')) changeMap((game.mapIdx + game.maps.length - 1) % game.maps.length); }
  if (readInput.tap('Tab')) setMenu(!menuOpen);
  if (menuOpen && readInput.tap('Escape')) setMenu(false);
  if (readInput.tap('KeyH')) togglePort();
  if (portOpen() && readInput.tap('Escape')) togglePort();
  if (portOpen()) { portUi.render(); portUi.tick(dt); }
  if (readInput.tap('KeyP')) togglePause();
  if (readInput.tap('KeyB') && !overlayOpen()) setFritz(!advisor.enabled);
  const running = !paused && !sheetOpen && !overlayOpen() && !tipOpen && game.status === 'playing';
  touch?.setMode(curMode());

  if (!running) audio.hum(false, 0);
  if (readInput.tap('KeyM')) toggleSound();
  if (running) {
    saveClock += dt;
    if (game.day !== savedDay || saveClock > 10) saveGame();
    const inMap = sim.mode === 'map';
    const cur = inMap ? { x: OX + sim.x * CELL, y: sim.y * CELL } : sliceHeadScreen(sim.slice);
    const inp = readInput.read(cur, { holdToMove: true });
    if (lentUnit(game) && sim.mode === 'map') { const lu = lentUnit(game); sim.x = lu.x; sim.y = lu.y; } // der eigene Ponton fährt als Flottenschiff mit
    if (pileMode) { planFocus.x = Math.min(game.river.cols, Math.max(0, planFocus.x + inp.dx * dt * 16)); planFocus.y = Math.min(game.river.rows, Math.max(0, planFocus.y + inp.dy * dt * 16)); }
    if (tow || zoneMode || areaMode || landMode || pileMode || lentUnit(game)) { inp.dx = 0; inp.dy = 0; mapTarget = null; } // beim Schleppen liegt der Ponton still
    ui.towShip = !tow && sim.mode === 'map' ? groundedNear(game, sim.x, sim.y)?.id ?? null : tow?.shipId ?? null;
    for (let k = 0; k < game.level.classes.length; k++) if (readInput.tap(`Digit${k + 1}`, `Numpad${k + 1}`)) chooseClass(game.level.classes[k]);
    if (inMap) {
      inp.suction = false;
      if (mapTarget) {
        if (Math.abs(inp.dx) + Math.abs(inp.dy) > 0.1) mapTarget = null;
        else {
          const st = steerToward(sim, mapTarget);
          if (st.arrived) { mapTarget = null; anchor(); } else { inp.dx = st.dx; inp.dy = st.dy; }
        }
      }
      if (!tow && readInput.tap('Space', 'Enter', 'KeyE')) anchor();
      if (!tow && readInput.tap('KeyV')) toggleTool();
      if (!tow && readInput.tap('KeyT')) startTow();
      if (!tow && readInput.tap('KeyK')) toggleZoneMode();
      if (!tow && readInput.tap('KeyG')) toggleAreaMode();
      if (!tow && readInput.tap('KeyO')) togglePileMode();
      if (!tow && readInput.tap('KeyN')) toggleRouteMode();
      if (!tow && readInput.tap('KeyJ')) toggleLend();
      if (!tow && readInput.tap('KeyY')) toggleHarborView();
      if (harborView && readInput.tap('KeyL')) harborLoadHit();
      if (!tow && readInput.tap('KeyL')) toggleLandMode();
      if (tow && readInput.tap('Escape', 'KeyQ')) leave();
    } else {
      if (readInput.tap('Escape', 'KeyQ')) leave();
      if (readInput.tap('KeyT')) toggleAuto();
      if (readInput.tap('KeyR')) fixAuto();
      if (readInput.tap('KeyV')) toggleTool();
      if (readInput.tap('Space')) togglePump();
      inp.suction = sim.pumpOn;
      if (readInput.tap('KeyZ')) setSpeed(sim.pumpSpeed - 0.1);
      if (readInput.tap('KeyX')) setSpeed(sim.pumpSpeed + 0.1);
      if (readInput.tap('KeyF')) setDepthValue(sim.targetDepth - 0.1);
      if (readInput.tap('KeyG')) setDepthValue(sim.targetDepth + 0.1);
    }
    updateLoadBar(dt);
    game.site = sim.mode === 'slice' && !harborView ? { x: sim.x, y: sim.y } : null;
    sim.bufferRoom = game.bufferRoom;
    sim.concreteAvail = game.concrete;
    if (tow) {
      tow.update(dt, readInput.read({ x: 0, y: 0 }, { keysOnly: true }).suction);
      for (const ev of tow.events.splice(0)) {
        if (ev.kind === 'snap') { audio.clog(); toast('Leine gerissen! (Strafe)', 'bad'); try { navigator.vibrate?.(60); } catch { /* egal */ } }
        else if (ev.kind === 'free') { audio.free('cleared'); toast('Schiff frei!', 'good', true); }
        else if (ev.kind === 'lost') toast('Zeit abgelaufen: die Schlepper übernehmen (teuer)', 'bad', true);
        else if (ev.kind === 'gone') toast('Das Schiff ist inzwischen frei', 'info', true);
      }
      if (tow.over) { tow = null; syncMode(); }
    }
    const before = game.money, d = sim.update(dt, inp);
    game.collect(d);
    advisor.observe(dt, d, game, sim);
    for (const n of sim.notes.splice(0)) {
      if (n.kind !== 'clog') toast(n.text, n.kind); // beim Verstopfen zeigt das Minispiel selbst den Gegenstand
      if (sim.mode === 'slice' && n.kind === 'clog') {
        const m = sliceMouthScreen(sim.slice);
        fx.burst(m.x, m.y, 18, 'hard');
        audio[n.kind]();
        try { navigator.vibrate?.(40); } catch { /* egal */ }
      }
    }
    if (sim.mode === 'slice') {
      const sl = sim.slice, m = sliceMouthScreen(sl), load = Math.min(1, d.removed / Math.max(1e-6, sim.stats.power * dt));
      fx.feed(m, sliceY(sl.surfaceAt(sl.mouth().x), game.wl), d, dt, Math.max(0, game.money - before));
      audio.hum(sim.pumpOn && sl.suctioning, load);
      $('btn-auto').hidden = sim.stats.autoLevel <= 0;
      $('btn-auto').textContent = sl.auto.on ? '🤖 AN (T)' : '🤖 Auto (T)';
      $('btn-fix').hidden = !sl.auto.error;
      const tl = sl.tool;
      $('btn-pump').textContent = sl.freeing ? '🔧 Freispülen! (Leertaste)' : tl === 'beton' ? (sim.pumpOn ? '🧱 Beton: AN (Leertaste)' : '🧱 Beton: AUS (Leertaste)') : tl === 'loeffel' ? (sim.pumpOn ? '⛏ Löffel: AN (Leertaste)' : '⛏ Löffel: AUS (Leertaste)') : sim.pumpOn ? '🌀 Pumpe: AN (Leertaste)' : '🌀 Pumpe: AUS (Leertaste)';
      $('btn-pump').classList.toggle('on', sim.pumpOn);
      touch?.setPump(sim.pumpOn, !!sl.freeing, tl);
      $('spd-box').hidden = false;
      if (document.activeElement !== $('spd')) { $('spd').value = sim.pumpSpeed; $('spd-val').textContent = pct(sim.pumpSpeed); }
      $('cut-box').hidden = false;
      if (document.activeElement !== $('cut')) { $('cut').value = sim.targetDepth; $('cut-val').textContent = `${sim.targetDepth.toFixed(1)} m`; }
    }
    $('s-removed').textContent = tow ? `Schleppen: ${Math.round((tow.progress / tow.need) * 100)} % · noch ${Math.ceil(tow.timeLeft)} s` : sim.mode === 'slice'
      ? `${game.totals.removed.toFixed(0)} m³ gebaggert · ${sim.slice.restCount()} Zellen über Solltiefe${sim.bufferFull ? ' · Puffer voll, Pumpe pausiert!' : ''}`
      : `${game.traffic.ships.filter((s) => s.state === 'sail').length} Schiffe unterwegs · ${game.traffic.ships.filter((s) => s.state === 'queue').length} wartend`;
    $('h-ships').textContent = `${game.traffic.ships.filter((s) => s.state === 'sail').length} unterwegs · ${game.traffic.ships.filter((s) => s.state === 'queue').length} wartend`;
    $('s-turb').value = sim.turbidity;
    $('s-buf').value = Math.min(1, game.stockTotal / game.stats.bufferCapacity); $('s-buf').classList.toggle('hot', game.stockTotal >= game.stats.bufferCapacity * 0.9);
    $('s-open').textContent = sim.mode === 'slice' ? `${sim.slice.restCount()} offen` : '';
    $('s-turbzone').textContent = sim.mode === 'slice' ? ({ channel: 'Rinne: Busse kaum', altlast: '☢ Altlast: Busse', nature: '🌿 Naturschutz: Busse sehr hoch!' })[sim.turbZone] : '';
    fx.update(dt);
    game.update(dt);
    for (const f of game.flash.splice(0)) ui.floaters.push({ ...f, life: 1.6 });
    for (const f of ui.floaters) f.life -= dt;
    ui.floaters = ui.floaters.filter((f) => f.life > 0);
    tipTimer += dt;
    if (tipTimer > 1) {
      tipTimer = 0;
      if (advisor.enabled && !(sim.mode === 'slice' && sim.slice.freeing)) { const tip = advisor.pick(game, sim); if (tip) showTip(tip); }
    }
    for (const n of game.notes.splice(0)) toast(n.text, n.kind, false, n.goto);
  }
  readInput.endFrame();

  trackMoney(dt);
  stateSigTimer += dt;
  if (stateSigTimer > 0.5) {
    stateSigTimer = 0;
    const sig = gameSig();
    if (sig !== stateSig) { if (stateSig !== null) saveGame(); stateSig = sig; }
  }
  panelTimer += dt;
  if (panelTimer > 0.25) { panelTimer = 0; updatePanel(); }
  updateHud();
  if (game.status === 'ended' && !endShown) { updatePanel(); showEnd(); }

  if (sim.mode !== 'map') mapTarget = null;
  ui.mapTarget = mapTarget;
  ctx.setTransform(canvas.q || 1, 0, 0, canvas.q || 1, 0, 0);
  if (tow) drawTowView(ctx, game, tow, ui);
  else if (sim.mode === 'slice') {
    const o = fx.offset();
    ctx.save(); ctx.translate(o.x, o.y); drawSlice(ctx, harborView ? makeHarborView(game) : game, sim, ui); fx.draw(ctx); ctx.restore();
  } else if (harborView) { const hv = makeHarborView(game); drawMap(ctx, hv, lentUnit(game) ? null : sim, ui); drawHarborScene(ctx, hv, ui); } else drawMap(ctx, game, sim, ui);
  panCanvas(1 / 60);
  requestAnimationFrame(frame);
}

// ---------- Start ----------
const saved = (() => { const t = readSave(); const m = t && savedSummary(t); return m && m.status === 'playing' ? m : null; })();
applyLevel();
buildUpgrades();
buildClassbar();
syncMode();
updatePanel();
setDepthValue(game.targetDepth);
function showIntro() {
  showOverlay(`<h2>Fahrrinne frei!</h2>
    <p>Du betreibst einen Flussabschnitt. Schiffe brauchen eine <b>Fahrrinne</b> mit genug Wasser unter dem Kiel (Tiefgang + 0,3 m) und genug Breite. Am Anfang kommen nur Lastkähne durch. Wer die Flusssohle <b>ausbaggert</b>, lässt grössere Schiffe und mehr Schiffe durch: für jedes gibt es eine <b>Gebühr</b> und einen Anteil am <b>Frachtwert</b> (die Frachtpreise schwanken). Baggergut wird in der Anlage an Land aufbereitet: Kies und Sand bringen Geld, Schlick und Altlasten kosten Entsorgung.
    Erreichst du das <b>Verkehrsziel</b> (Tonnen Fracht) und hast am Ende Gewinn, schaltest du das nächste Fluss frei. Gewonnen hat, wer am Ende am meisten Geld hat.</p>
    <details ${isTouch ? 'open' : ''}><summary>Steuerung am Handy</summary>
      <p><b>Stick</b> links fährt den Ponton auf der Karte, ein <b>Tipp auf die Karte</b> fährt hin und ankert. Der grosse Knopf wirft den Anker bzw. schaltet im Querschnitt die <b>Pumpe</b> ein und aus. Im Querschnitt steuerst du die Pumpe mit den <b>Pfeil-Knöpfen</b> (halten = fahren) und stellst <b>Tempo</b> und <b>Solltiefe</b> mit den Reglern ein. Oben wählst du eine <b>Schiffsklasse</b>: rote Stellen auf der Karte sind Engstellen (lila = Fels), die gestrichelte Linie ist die günstigste Rinne. Der Shop liegt unten im Fach; solange es offen ist, steht das Spiel still.</p></details>
    <details ${isTouch ? '' : 'open'}><summary>Steuerung am Computer</summary>
      <p>Karte: WASD / Pfeile (oder Maus gedrückt) fahren, <b>E</b> / Leertaste wirft den Anker, <b>1–5</b> wählen die Schiffsklasse. Querschnitt: A/D fährt die Pumpe quer zum Fluss, W/S zieht sie hoch oder lässt sie runter, <b>Leertaste</b> schaltet die Pumpe ein und aus (saugt nach rechts und im Stillstand, rückwärts nie), <b>1–5</b> setzen die Solltiefe für eine Klasse, <b>F/G</b> ändern sie, <b>Z/X</b> Tempo, <b>T</b> Automatik, <b>R</b> Reset, <b>Q</b> zurück zur Karte, <b>P</b> Pause.</p></details>
    <details><summary>Regeln im Fluss</summary>
      <p>Der Ponton baggert gleichzeitig 4 Spalten in Flussrichtung und 16 Zellen quer. Im Querschnitt zeigt die dicke Linie die <b>engste Stelle</b> (höchster Punkt) im Kasten; orange gestrichelt ist deine Solltiefe, die farbigen Linien sind die Tiefen der Schiffsklassen. Die Pumpe saugt nur am Boden und nur nach rechts.</p>
      <p><b>Böschungen rutschen nach:</b> schmal und tief baggern füllt sich wieder auf. Ufer und Flachwasser sind Naturschutzzone (schraffiert, kostet Busse). <b>Fels</b> (grau) lässt sich ohne Felsfräse kaum abtragen. Der Fluss <b>verlandet</b>: besonders am Rand und nach Hochwasser lagert er Schlick in der Rinne ab. Bei <b>Niedrigwasser</b> fehlt Tiefe (Schiffe können auflaufen: Bergung kostet), bei <b>Hochwasser</b> ist die Schifffahrt gesperrt. Ein Ponton in der Rinne bremst den Verkehr. Fremdstoffe (weisse Punkte) verstopfen die Pumpe: Freispülen im grünen Bereich; bei Fliegerbomben hilft nur ruhig bleiben.</p>
      <p>In einer Einbahnrinne fahren Schiffe nur in einer Richtung; erst mit zwei getrennten Rinnen (⇄) ist Gegenverkehr möglich. Wer nicht durchkommt, dreht nach einer Weile ab und die Fracht geht auf die Bahn. Reedereien bieten <b>Frachtaufträge</b> mit Prämie an.</p></details>
    <button class="primary" id="btn-go">Los</button>`);
  $('btn-go').onclick = () => showLevels();
  if (saved) {
    const b = document.createElement('button');
    b.className = 'primary'; b.id = 'btn-continue';
    b.textContent = `Weiterspielen (${saved.level}, Tag ${saved.day}, ${chf(saved.money)})`;
    b.onclick = () => { const g = restoreGame(readSave()); if (g) restart(g); else { clearSave(); hideOverlay(); } };
    $('btn-go').before(b);
    $('btn-go').textContent = 'Neues Spiel';
    $('btn-go').classList.remove('primary');
  }
}
showIntro();
addEventListener('pagehide', saveGame);
addEventListener('beforeunload', saveGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
requestAnimationFrame(frame);
globalThis.__dbg = () => ({ game, sim, ui });
