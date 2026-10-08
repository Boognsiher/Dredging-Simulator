// Level-System nach Schiffsklassen: Das Level ist die höchste Klasse, deren Rinne schon einmal befahrbar war (auf irgendeiner Karte).
// Jedes Level schaltet Mechaniken frei; so wächst die Komplexität im Takt der Tiefe. Zentrale Tabelle: hier verschieben, was wann kommt.
export const RANK_ORDER = ['kahn', 'motor', 'tank', 'container', 'schub'];
export const UNLOCK = { enabled: true };
// Freischaltungen je Level (Text für Meldungen und Sperrhinweise)
export const RANK_INFO = [
  { text: 'Dein Ponton: Pumpe, Querschnitt, Fahrrinne, Automatik, Anlage ausbauen (Aufbereitung, Entwässerung, Sortierung); eine gemietete Flotte mit 1 Ponton' },
  { text: 'Verkehr (Kreuzungsstellen, Warteplätze), Rohstoffgebiete, «Rinne festlegen»; Flotte bis 2 Pontons' },
  { text: 'Handel (Frachtmarkt, Aufträge), Geräte (Felsfräse, Löffel, Beton, Betonwerk, Pfahlgerät und Pfahlwand), Altlasten, Uferstreifen, weitere Karten; Flotte bis 3 Pontons' },
  { text: 'Hafen und Hafenkarte, Gebiet und Route; Flotte bis 4 Pontons' },
  { text: 'Eigene Frachtschiffe' },
];
export const NEED = { zone: 2, lane: 2, trafficTab: 2, plantTab: 1, deposits: 2, trade: 3, gear: 3, hazard: 3, shore: 3, port: 4, area: 4, ships: 5, maps: 3 };
const UP_NEED = { cutter: 3, loeffel: 3, betonrohr: 3, mixer: 3, piler: 3, beacons: 2, signals: 2, tugs: 2, vts: 2, pilot: 2 };
export const upgradeRank = (id) => UP_NEED[id] ?? 1;
export const rankOf = (g) => (UNLOCK.enabled ? g.rank ?? 1 : 99);
export const hasRank = (g, key) => rankOf(g) >= (typeof key === 'number' ? key : NEED[key]);
export const fleetMax = (g) => [1, 2, 3, 4, 4][Math.min(4, rankOf(g) - 1)];
export const rankName = (n) => ({ kahn: 'Lastkahn', motor: 'Motorgüterschiff', tank: 'Tankschiff', container: 'Containerschiff', schub: 'Schubverband' })[RANK_ORDER[n - 1]];
// Höchstes Level aus den freigeschalteten Klassen aller Karten
export function computeRank(g) {
  let r = 1;
  for (const m of g.maps) RANK_ORDER.forEach((id, k) => { if (m.unlocked?.[id] && g.level.classes.includes(id)) r = Math.max(r, k + 1); });
  return r;
}
