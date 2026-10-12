// Der Rhein als Folge von Flussabschnitten (Karten) im Endlos-Modus: flussabwärts von Rheinfelden bis Rotterdam.
// Jeder Abschnitt hat feste Eigenschaften (Rohstoffe, Öl, Fels, regionale Preise); die Form des Flussbetts bleibt aus dem Seed erzeugt.
// pos: Lage auf der Weltkarte (0..100 × 0..100, schematisch). bias: regionaler Preisaufschlag/-abschlag je Fracht. dep: Vorkommen (kiesbank, quarz, seife, delta).
export const RHEIN = [
  { name: 'Rheinfelden', pos: [64, 91], dep: ['quarz'], oil: false, bias: { kies: -0.15, oel: 0.10, container: 0.15 }, note: 'Hochrhein: ruhiger Einstieg, günstiger Kies.' },
  { name: 'Basel', pos: [57, 81], dep: ['kiesbank'], oil: false, bias: { kies: -0.05, oel: 0.05, container: -0.15 }, note: 'Hafenstadt mit Containerumschlag.' },
  { name: 'Kembs', pos: [53, 71], dep: ['kiesbank', 'kiesbank', 'delta'], oil: false, bias: { kies: -0.30, oel: 0.10, container: 0.15 }, note: 'Oberrhein: Kiesbänke und Kies-Delta, Kies sehr günstig.' },
  { name: 'Strassburg', pos: [50, 61], dep: ['quarz', 'delta'], oil: false, bias: { kies: -0.10, oel: 0.0, container: -0.05 }, note: 'Grosser Binnenhafen.' },
  { name: 'Karlsruhe', pos: [54, 51], dep: ['quarz'], oil: true, bias: { kies: 0.05, oel: -0.20, container: 0.0 }, note: 'Raffinerie: Ölvorkommen, Öl günstig.' },
  { name: 'Mannheim', pos: [52, 42], dep: ['kiesbank', 'delta'], oil: false, bias: { kies: 0.05, oel: -0.05, container: -0.20 }, note: 'Chemie und Container, Container günstig.' },
  { name: 'Bingen', pos: [43, 35], dep: ['kiesbank', 'seife'], oil: false, hard: true, bias: { kies: 0.25, oel: 0.05, container: 0.10 }, note: 'Mittelrhein (Loreley): Felsriegel und enge Rinne, Erzseife.' },
  { name: 'Köln', pos: [35, 26], dep: ['quarz', 'delta'], oil: true, bias: { kies: 0.15, oel: -0.22, container: -0.15 }, note: 'Raffinerien: Ölvorkommen, Öl günstig.' },
  { name: 'Duisburg', pos: [30, 17], dep: ['quarz', 'delta'], oil: false, wide: true, bias: { kies: 0.20, oel: -0.10, container: -0.28 }, note: 'Grösster Binnenhafen Europas: Container sehr günstig.' },
  { name: 'Rotterdam', pos: [21, 9], dep: ['kiesbank', 'delta'], oil: true, wide: true, bias: { kies: 0.30, oel: -0.25, container: -0.30 }, note: 'Seehafen: Öl und Container sehr günstig, Kies teuer.' },
];

export const sectionOf = (k) => RHEIN[k] ?? null;

// Eigenschaften des Abschnitts auf die zufälligen Flussparameter anwenden
export function applySection(cfg, sec) {
  if (!sec) return cfg;
  const kinds = sec.dep.filter((d) => d !== 'delta');
  cfg.deposits = ['kiesbank', ...kinds, ...(sec.dep.includes('delta') ? ['delta'] : [])];
  if (sec.hard) { // Felsriegel des Mittelrheins: schmaler, drei Riegel, mehr harte Schichten
    cfg.halfWidth = +(cfg.halfWidth - 0.8).toFixed(2); cfg.hardBlobs += 3;
    cfg.ridges = [8, 22, 36].map((x, i) => ({ x: x + (i - 1), w: 4, depth: 3.1 + 0.1 * i }));
  }
  if (sec.wide) cfg.halfWidth = +(cfg.halfWidth + 0.5).toFixed(2);
  return cfg;
}
