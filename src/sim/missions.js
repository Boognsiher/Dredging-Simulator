// Wechselnde Ziele: bis zu drei laufende Aufgaben (Baggern, Fracht, Altlasten, Beton ...) mit Frist und Prämie.
// Erfüllte Ziele werden am nächsten Tag durch neue ersetzt; mehrere Erfolge in Folge geben einen Zuschlag (Serie).
// Beton-Ziele sind gewichtet und zahlen mehr (plus Beton als Sachprämie): so lohnt sich das Betonieren und das Betonwerk.
import { createRng } from './rng.js';
import { rankOf, hasRank } from './rank.js';

export const MISSIONS = { slots: 3, life: [6, 10], streakStep: 0.1, streakMax: 0.5, startDay: 2 };
const r10 = (v, k = 10) => Math.max(k, Math.round(v / k) * k);
// Schwierigkeit wächst mit dem Fortschritt: Fracht, Klassenstufe, Karten
const scale = (g) => Math.min(8, 1 + (g.totals.tons ?? 0) / 20000 + (rankOf(g) - 1) * 0.25 + (g.maps.length - 1) * 0.2);
const hasHarbor = (g) => g.maps.some((m) => m.port?.open);
const jobs = (g) => g.maps.reduce((a, m) => a + (m.port?.jobsDone ?? 0), 0);

// key, Gewicht, Bedingung, Messwert (absolut), Erzeugung → { text, target, reward, gift? }
export const TEMPLATES = [
  { key: 'removed', w: 2, val: (g) => g.totals.removed, make: (g, s) => { const n = r10(250 * s, 50); return { text: `Baggere ${n.toLocaleString('de-CH')} m³`, unit: 'm³', target: n, reward: n * 12 }; } },
  { key: 'tons', w: 2, val: (g) => g.totals.tons, make: (g, s) => { const n = r10(1200 * s, 100); return { text: `Bringe ${n.toLocaleString('de-CH')} t Fracht durch die Rinne`, unit: 't', target: n, reward: n * 4 }; } },
  { key: 'ships', w: 1.5, val: (g) => g.totals.ships, make: (g, s) => { const n = r10(7 * s ** 0.8, 1); return { text: `Lass ${n} Schiffe passieren`, unit: 'Schiffe', target: n, reward: n * 420 }; } },
  { key: 'income', w: 1, val: (g) => g.totals.trafficIncome, make: (g, s) => { const n = r10(2500 * s, 100); return { text: `Verdiene ${n.toLocaleString('de-CH')} CHF Verkehrsgebühren`, unit: 'CHF', target: n, reward: Math.round(n * 0.5) }; } },
  { key: 'sold', w: 1, when: (g) => hasRank(g, 'trade') || g.totals.sold > 0, val: (g) => g.totals.sold, make: (g, s) => { const n = r10(150 * s, 10); return { text: `Verkaufe ${n.toLocaleString('de-CH')} m³ Material aus der Anlage`, unit: 'm³', target: n, reward: n * 18 }; } },
  { key: 'altlast', w: 1.5, when: (g) => hasRank(g, 'hazard') && g.river.kind.some((k) => k === 3), val: (g) => g.totals.byKind?.[3] ?? 0, make: (g, s) => { const n = r10(30 * s, 5); return { text: `Entsorge ${n} m³ Altlast`, unit: 'm³', target: n, reward: n * 90 }; } },
  { key: 'contracts', w: 1, when: (g) => hasRank(g, 'trade'), val: (g) => g.totals.contractsDone, make: (g, s) => { const n = s > 3 ? 2 : 1; return { text: `Erfülle ${n === 1 ? 'einen Frachtauftrag' : `${n} Frachtaufträge`}`, unit: 'Aufträge', target: n, reward: Math.round(n * 4000 * s ** 0.5) }; } },
  { key: 'jobs', w: 1, when: hasHarbor, val: jobs, make: (g, s) => { const n = s > 3 ? 4 : 2; return { text: `Erledige ${n} Hafen-Aufträge`, unit: 'Aufträge', target: n, reward: Math.round(n * 2500 * s ** 0.5) }; } },
  // Beton: wichtiger, höher bezahlt, mit Beton als Sachprämie
  { key: 'buyPour', w: 6, when: (g) => hasRank(g, 'gear') && g.stats.betonrohr === 0, val: (g) => g.levels.betonrohr ?? 0, abs: true, make: () => ({ text: 'Rüste das Betoniergerät aus (Technik → Geräte): Beton schützt Rinne und Ufer vor Verlandung', unit: 'Stufe', target: 1, reward: 6000, gift: 30, beton: true }) },
  { key: 'buyMixer', w: 5, when: (g) => g.stats.betonrohr > 0 && g.stats.mixer === 0 && g.totals.concreteBought >= 20, val: (g) => g.levels.mixer ?? 0, abs: true, make: () => ({ text: 'Baue das Betonwerk (Technik → Anlage): mischt Beton aus Kies und Sand, viel billiger als Zukaufen', unit: 'Stufe', target: 1, reward: 9000, gift: 60, beton: true }) },
  { key: 'pour', w: 5, when: (g) => g.stats.betonrohr > 0, val: (g) => g.totals.concreteUsed, make: (g, s) => { const n = r10(30 * s ** 0.7, 5); return { text: `Betoniere ${n} m³ Rinne und Ufer (Beton wirkt gegen Verlandung)`, unit: 'm³ Beton', target: n, reward: Math.round(n * 230), gift: Math.round(n * 0.4), beton: true }; } },
  { key: 'mix', w: 4, when: (g) => g.stats.mixer > 0, val: (g) => g.totals.concreteMixed, make: (g, s) => { const n = r10(50 * s ** 0.7, 10); return { text: `Mische ${n} m³ Beton im Betonwerk`, unit: 'm³ Beton', target: n, reward: Math.round(n * 200), gift: Math.round(n * 0.3), beton: true }; } },
];
const byKey = (k) => TEMPLATES.find((t) => t.key === k);

export const createMissions = () => ({ list: [], seq: 0, done: 0, failed: 0, streak: 0, best: 0 });
export const streakBonus = (g) => Math.min(MISSIONS.streakMax, (g.missions?.streak ?? 0) * MISSIONS.streakStep);
const cur = (g, m) => { const t = byKey(m.key); if (!t) return 0; const v = t.val(g); return t.abs ? v : v - m.base; };
export const missionProgress = (g, m) => { const c = Math.max(0, cur(g, m)); return { cur: c, frac: Math.min(1, c / m.target), left: Math.max(0, Math.ceil(m.due - g.day)) }; };

// neues Ziel erzeugen (eigener Zufall aus Seed und laufender Nummer: verändert den Spielzufall nicht)
function makeMission(g) {
  const M = g.missions, rng = createRng(((g.seed >>> 0) * 2654435761 + (M.seq + 1) * 40503 + 777) >>> 0), s = scale(g), used = new Set(M.list.map((m) => m.key));
  const pool = TEMPLATES.filter((t) => !used.has(t.key) && (!t.when || t.when(g)));
  if (!pool.length) return null;
  let pick = rng() * pool.reduce((a, t) => a + t.w, 0), t = pool[0];
  for (const p of pool) { pick -= p.w; if (pick <= 0) { t = p; break; } }
  const spec = t.make(g, s);
  return { id: ++M.seq, key: t.key, ...spec, base: t.abs ? 0 : t.val(g), born: g.day, due: g.day + Math.round(rng.range(...MISSIONS.life)) };
}

// Ziele prüfen und einlösen (alle paar Sekunden)
export function checkMissions(g) {
  const M = (g.missions ??= createMissions()); let any = false;
  for (const m of [...M.list]) {
    if (cur(g, m) < m.target) continue;
    any = true; M.list = M.list.filter((x) => x !== m);
    const k = 1 + streakBonus(g), pay = Math.round((m.reward * k) / 10) * 10; M.streak++; M.done++; M.best = Math.max(M.best, M.streak);
    g.money += pay; g.book?.('ziele', pay); g.totals.missionPay = (g.totals.missionPay ?? 0) + pay;
    if (m.gift) g.concrete = Math.min(g.concrete + m.gift, Math.max(g.concrete, 800));
    const extra = `${k > 1 ? ` (Serie ×${k.toFixed(1)})` : ''}${m.gift ? ` + ${m.gift} m³ Beton` : ''}`;
    g.say(`🎯 Ziel erreicht: ${m.text}. Prämie ${pay.toLocaleString('de-CH')} CHF${extra}.`, 'good');
    g.notify(`🎯 Ziel erreicht · +${pay.toLocaleString('de-CH')} CHF${extra}`, 'good');
  }
  return any;
}
// Täglich: abgelaufene Ziele entfernen (ohne Strafe, die Serie reisst ab), freie Plätze auffüllen
export function missionsDay(g) {
  const M = (g.missions ??= createMissions());
  for (const m of [...M.list]) if (g.day > m.due) {
    M.list = M.list.filter((x) => x !== m); M.streak = 0; M.failed++;
    g.say(`⏰ Ziel abgelaufen: ${m.text}`, 'info');
  }
  if (g.day < MISSIONS.startDay) return;
  while (M.list.length < MISSIONS.slots) { const m = makeMission(g); if (!m) break; M.list.push(m); g.say(`🎯 Neues Ziel: ${m.text} (Prämie ${m.reward.toLocaleString('de-CH')} CHF${m.gift ? ` + ${m.gift} m³ Beton` : ''}, ${m.due - g.day} Tage)`, 'info'); }
}
