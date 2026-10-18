// Erfolge und Meilensteine: Serien mit Stufen. Jede Stufe zahlt eine Prämie und schaltet oft einen dauerhaften Bonus frei.
// Bonusarten (BONUS) wirken im Spiel; die Summen sind gedeckelt, damit das Gleichgewicht erhalten bleibt.
export const BONUS = {
  power: { label: 'Baggerleistung', cap: 0.25, sign: '+' },
  traffic: { label: 'Verkehr (mehr Schiffe)', cap: 0.25, sign: '+' },
  sell: { label: 'Verkaufserlöse der Anlage', cap: 0.15, sign: '+' },
  wage: { label: 'Löhne der Flotte', cap: 0.4, sign: '−' },
  disposal: { label: 'Entsorgungskosten', cap: 0.3, sign: '−' },
  cement: { label: 'Betonkosten', cap: 0.4, sign: '−' },
};
const MONEY = [2000, 6000, 20000, 60000, 180000, 500000]; // Prämie je Stufe
const fleetUnits = (g) => g.maps.reduce((a, m) => a + m.fleet.units.filter((u) => !u.self).length, 0);
const bestDay = (g) => (g.history ?? []).reduce((a, h) => Math.max(a, h.net ?? 0), 0);

// id, Symbol, Name der Serie, Einheit, Messwert, Stufenziele, Namen der Stufen, Bonus je Stufe, sichtbar
export const SERIES = [
  { id: 'tons', icon: '🚢', name: 'Frachtmeister', unit: 't Fracht', cur: (g) => g.totals.tons, goals: [1000, 10000, 50000, 200000, 1000000], names: ['Erste Ladung', 'Kleiner Hafen', 'Verkehrsader', 'Schwerlastroute', 'Wasserstrassen-Gigant'], bonus: { traffic: 0.02 } },
  { id: 'ships', icon: '🛳️', name: 'Schiffsparade', unit: 'Schiffe durchgeschleust', cur: (g) => g.totals.ships, goals: [10, 100, 500, 2000, 10000], names: ['Erste Schiffe', 'Reger Betrieb', 'Dauerverkehr', 'Verkehrsknoten', 'Nie wieder leer'], bonus: { wage: 0.02 } },
  { id: 'removed', icon: '⛏️', name: 'Baggerkönig', unit: 'm³ gebaggert', cur: (g) => g.totals.removed, goals: [500, 5000, 25000, 100000, 500000], names: ['Erste Schaufel', 'Flusswäscher', 'Sohlenkünstler', 'Erdbewegung', 'Berge versetzt'], bonus: { power: 0.025 } },
  { id: 'money', icon: '💰', name: 'Kapitalist', unit: 'CHF Vermögen', cur: (g) => g.money, goals: [100000, 500000, 2000000, 10000000, 50000000], names: ['Sechsstellig', 'Halbe Million', 'Millionär', 'Zehn Millionen', 'Wasserstrassen-Mogul'], bonus: { sell: 0.015 } },
  { id: 'days', icon: '📅', name: 'Durchhalter', unit: 'Tage im Geschäft', cur: (g) => g.day, goals: [30, 100, 365, 1000, 3650], names: ['Ein Monat', '100 Tage', 'Ein Jahr', 'Fast drei Jahre', 'Ein Jahrzehnt'], bonus: { wage: 0.03 } },
  { id: 'maps', icon: '🗺️', name: 'Flussnetz', unit: 'Karten erschlossen', cur: (g) => g.maps.length, goals: [2, 3, 5, 7, 10], names: ['Zweite Heimat', 'Flussabschnitt', 'Netzbetreiber', 'Grosser Fluss', 'Ganzer Strom'], bonus: { traffic: 0.02 }, when: (g) => g.endless },
  { id: 'rank', icon: '🎖️', name: 'Schiffsklasse', unit: 'Klassenstufe', cur: (g) => g.rank ?? 1, goals: [2, 3, 4, 5], names: ['Motorschiffe fahren', 'Tanker fahren', 'Containerschiffe fahren', 'Schubverbände fahren'], bonus: { power: 0.02 } },
  { id: 'fleet', icon: '🚤', name: 'Flottenchef', unit: 'Pontons in der Flotte', cur: fleetUnits, goals: [1, 3, 6, 10, 20], names: ['Erster Mitarbeiter', 'Kleine Crew', 'Eigene Werft', 'Grosse Flotte', 'Armada'], bonus: { wage: 0.03 } },
  { id: 'contracts', icon: '📜', name: 'Auftragsprofi', unit: 'Aufträge erfüllt', cur: (g) => g.totals.contractsDone, goals: [1, 10, 50, 200], names: ['Erster Auftrag', 'Zuverlässig', 'Stammkunde', 'Erste Adresse'], bonus: { sell: 0.015 } },
  { id: 'altlast', icon: '☢️', name: 'Altlast-Räumer', unit: 'm³ Altlast entsorgt', cur: (g) => g.totals.byKind?.[3] ?? 0, goals: [50, 500, 5000, 20000], names: ['Sauber gemacht', 'Grosse Räumung', 'Umweltpreis', 'Saubere Sohle'], bonus: { disposal: 0.04 } },
  { id: 'beton', icon: '🧱', name: 'Betonbauer', unit: 'm³ Beton verbaut', cur: (g) => g.totals.concreteUsed ?? 0, goals: [20, 150, 800, 4000], names: ['Erster Guss', 'Ufer gesichert', 'Rinne in Beton', 'Betonbaron'], bonus: { cement: 0.08 } },
  { id: 'betonwerk', icon: '🏭', name: 'Betonwerk', unit: 'm³ Beton gemischt', cur: (g) => g.totals.concreteMixed ?? 0, goals: [30, 300, 2000], names: ['Erste Charge', 'Eigene Mischung', 'Fertigbeton-Lieferant'], bonus: { cement: 0.08 } },
  { id: 'missions', icon: '🎯', name: 'Zielstrebig', unit: 'Ziele erreicht', cur: (g) => g.missions?.done ?? 0, goals: [1, 5, 20, 60], names: ['Erstes Ziel', 'Auf Kurs', 'Zuverlässig', 'Projektleiter'], bonus: { wage: 0.02 } },
  { id: 'streak', icon: '🔥', name: 'Serie', unit: 'Ziele in Folge', cur: (g) => g.missions?.best ?? 0, goals: [3, 6, 12], names: ['Dreierserie', 'Sechserserie', 'Unaufhaltsam'], bonus: { sell: 0.015 } },
  { id: 'floods', icon: '🌊', name: 'Hochwasser-Profi', unit: 'Hochwasser überstanden', cur: (g) => g.totals.floods ?? 0, goals: [1, 5, 20], names: ['Erste Flut', 'Wetterfest', 'Sturmerprobt'], bonus: null },
  { id: 'rescued', icon: '🛟', name: 'Retter', unit: 'Schiffe geborgen', cur: (g) => g.totals.rescued ?? 0, goals: [1, 10, 50], names: ['Erste Bergung', 'Bergungsprofi', 'Seenotretter'], bonus: null },
  { id: 'bestday', icon: '📈', name: 'Spitzentag', unit: 'CHF Gewinn an einem Tag', cur: bestDay, goals: [5000, 20000, 100000, 500000], names: ['Guter Tag', 'Sehr guter Tag', 'Rekordtag', 'Goldener Tag'], bonus: null },
  { id: 'reederei', icon: '🚛', name: 'Reeder', unit: 'eigene Frachtschiffe', cur: (g) => g.shipping?.ships?.length ?? 0, goals: [1, 3, 6], names: ['Erstes Schiff', 'Kleine Reederei', 'Grosse Reederei'], bonus: { sell: 0.01 }, when: (g) => g.endless },
  { id: 'harbor', icon: '🏗️', name: 'Hafenbetreiber', unit: 'Häfen eröffnet', cur: (g) => g.maps.filter((m) => m.port?.open).length, goals: [1, 3, 6], names: ['Erster Hafen', 'Hafengruppe', 'Hafenimperium'], bonus: { traffic: 0.015 } },
  { id: 'mega', icon: '⚓', name: 'Megaschiff-Lotse', unit: 'Megaschiffe abgefertigt', cur: (g) => g.totals.byClass?.mega ?? 0, goals: [1, 25, 200], names: ['Das erste Riesenschiff', 'Tiefwasser-Profi', 'Herr der Gezeiten'], bonus: { traffic: 0.02 }, when: (g) => g.level.classes.includes('mega') },
];
export const achId = (s, i) => `${s.id}:${i}`;
export const seriesVisible = (g, s) => !s.when || s.when(g);
export const prize = (i) => MONEY[Math.min(i, MONEY.length - 1)];

// Summe der Boni aus freigeschalteten Stufen (gedeckelt)
export function bonusOf(g) {
  const b = { power: 0, traffic: 0, sell: 0, wage: 0, disposal: 0, cement: 0 }, got = g.ach ?? {};
  for (const s of SERIES) if (s.bonus) s.goals.forEach((_, i) => { if (got[achId(s, i)] !== undefined) for (const [k, v] of Object.entries(s.bonus)) b[k] += v; });
  for (const k of Object.keys(b)) b[k] = Math.min(BONUS[k].cap, b[k]);
  return b;
}
// Bonus auf die Werte der Anlagen anwenden (computeStats), ohne die Upgrade-Tabelle zu verändern
export function applyBonus(stats, b) {
  stats.power *= 1 + b.power; stats.trafficMult *= 1 + b.traffic; stats.sortBonus *= 1 + b.sell; stats.disposalFactor *= 1 - b.disposal;
  return stats;
}

// Fortschritt je Serie für die Anzeige: nächste Stufe, Anteil, Anzahl erledigter Stufen
export function progress(g) {
  const got = g.ach ?? {};
  return SERIES.filter((s) => seriesVisible(g, s)).map((s) => {
    const cur = s.cur(g), done = s.goals.filter((_, i) => got[achId(s, i)] !== undefined).length, next = done < s.goals.length ? done : -1;
    const prev = done ? s.goals[done - 1] : 0, goal = next >= 0 ? s.goals[next] : null;
    return { s, cur, done, total: s.goals.length, next, goal, frac: goal ? Math.max(0, Math.min(1, (cur - prev) / (goal - prev))) : 1 };
  });
}
export const countAch = (g) => { const got = g.ach ?? {}; let n = 0, t = 0; for (const s of SERIES) if (seriesVisible(g, s)) s.goals.forEach((_, i) => { t++; if (got[achId(s, i)] !== undefined) n++; }); return { n, t }; };

// Prüft alle Serien und schaltet erreichte Stufen frei; gibt die neuen Erfolge zurück
export function checkAchievements(g) {
  if (g.achOn === false) return []; g.ach ??= {}; const fresh = [];
  for (const s of SERIES) {
    if (!seriesVisible(g, s)) continue;
    const cur = s.cur(g);
    s.goals.forEach((goal, i) => {
      const id = achId(s, i);
      if (g.ach[id] !== undefined || cur < goal) return;
      g.ach[id] = g.day; fresh.push({ s, i, id });
      const m = prize(i); g.money += m; g.totals.achPrize = (g.totals.achPrize ?? 0) + m; g.book?.('erfolg', m);
      const bonus = s.bonus ? Object.entries(s.bonus).map(([k, v]) => `${BONUS[k].sign}${+(v * 100).toFixed(1)} % ${BONUS[k].label}`).join(', ') : '';
      g.say(`${s.icon} Erfolg «${s.names[i]}»: ${s.unit.includes('CHF') ? goal.toLocaleString('de-CH') : goal.toLocaleString('de-CH')} ${s.unit}. Prämie ${m.toLocaleString('de-CH')} CHF${bonus ? `, dauerhaft ${bonus}` : ''}.`, 'good');
      g.notify(`🏆 ${s.names[i]} · +${m.toLocaleString('de-CH')} CHF${bonus ? ` · ${bonus}` : ''}`, 'good');
    });
  }
  if (fresh.some((f) => f.s.bonus)) { g._stats = null; g._achNew = true; }
  return fresh;
}
