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

// Der Nil von Assuan bis ins Delta (flussabwärts, von Süd nach Nord): Wüstenufer, fruchtbarer Streifen, jährliche Nilflut im Spätsommer.
export const NIL = [
  { name: 'Assuan', pos: [56, 90], dep: ['kiesbank'], oil: false, hard: true, bias: { kies: -0.20, oel: 0.20, container: 0.15 }, note: 'Erster Katarakt: Granitfelsen und enge Rinne, günstiger Kies.' },
  { name: 'Luxor', pos: [55, 79], dep: ['quarz'], oil: false, bias: { kies: -0.10, oel: 0.15, container: 0.10 }, note: 'Tempelstadt: viele Ausflugsschiffe, ruhiger Fluss.' },
  { name: 'Sohag', pos: [51, 67], dep: ['kiesbank', 'delta'], oil: false, tune: { shoals: 2 }, bias: { kies: -0.30, oel: 0.10, container: 0.10 }, note: 'Sandbänke und Kies-Delta, Kies sehr günstig.' },
  { name: 'Assiut', pos: [47, 55], dep: ['kiesbank', 'quarz'], oil: false, tune: { shoals: 2, halfWidth: 0.4 }, bias: { kies: -0.10, oel: 0.05, container: 0.0 }, note: 'Stauwehr und viel Sand: die Rinne verlandet schnell.' },
  { name: 'Minya', pos: [49, 43], dep: ['quarz', 'seife'], oil: true, bias: { kies: 0.05, oel: -0.15, container: 0.0 }, note: 'Ölvorkommen am Rand der Wüste, Erzseife im Flussbett.' },
  { name: 'Kairo', pos: [52, 30], dep: ['kiesbank', 'delta'], oil: false, wide: true, bias: { kies: 0.20, oel: -0.05, container: -0.25 }, note: 'Grossstadt: Containerumschlag, Kies wird teuer verkauft.' },
  { name: 'Damietta', pos: [60, 14], dep: ['quarz', 'delta'], oil: true, wide: true, tune: { shoals: 2, depthMax: 0.2 }, bias: { kies: 0.30, oel: -0.25, container: -0.30 }, note: 'Nildelta und Mittelmeerhafen: Öl und Container sehr günstig, Kies teuer.' },
];
// Seehafen: Zufahrt von der offenen See bis zum Binnenhafen. Gezeiten heben und senken den Pegel, Sand wandert, die Schiffe sind gross.
export const SEE = [
  { name: 'Aussenreede', pos: [14, 13], dep: ['kiesbank', 'delta'], oil: false, wide: true, tune: { halfWidth: 1.0, depthMax: 0.5, shoals: 2 }, bias: { kies: 0.10, oel: 0.05, container: 0.10 }, note: 'Offene See: breite Zufahrt, wandernde Sandbänke.' },
  { name: 'Aussenhafen', pos: [29, 28], dep: ['kiesbank'], oil: false, wide: true, tune: { halfWidth: 0.6, depthMax: 0.4 }, bias: { kies: 0.05, oel: 0.0, container: 0.0 }, note: 'Fahrwasser zwischen Molen: Sand wird bei Flut hereingetragen.' },
  { name: 'Containerterminal', pos: [44, 43], dep: ['quarz'], oil: false, wide: true, tune: { depthMax: 0.3 }, bias: { kies: 0.20, oel: 0.10, container: -0.30 }, note: 'Grosse Containerbrücken: Container sehr günstig.' },
  { name: 'Ölhafen', pos: [58, 57], dep: ['quarz', 'delta'], oil: true, tune: { shoals: 1 }, bias: { kies: 0.15, oel: -0.30, container: 0.05 }, note: 'Raffinerie und Tanklager: Ölvorkommen, Öl sehr günstig.' },
  { name: 'Tiefwasserkai', pos: [71, 71], dep: ['kiesbank', 'seife'], oil: false, hard: true, bias: { kies: 0.25, oel: -0.10, container: -0.15 }, note: 'Fels unter dem Sand: die Megaschiffe brauchen ihn tief.' },
  { name: 'Binnenhafen', pos: [83, 86], dep: ['kiesbank', 'delta'], oil: true, wide: true, bias: { kies: 0.30, oel: -0.20, container: -0.20 }, note: 'Das Ende der Zufahrt: Verkehr aus allen Richtungen.' },
];
// Schauplätze (Endlos-Spiele): Abschnittsliste, Titel, Hintergrund der Weltkarte
export const WORLDS = {
  rhein: { title: 'Rhein', sections: RHEIN, aria: 'Rhein von Rheinfelden bis Rotterdam', from: 'Rheinfelden', to: 'Rotterdam', text: 'Der Rhein von Rheinfelden bis Rotterdam, Abschnitt für Abschnitt flussabwärts.' },
  nil: { title: 'Nil', sections: NIL, aria: 'Nil von Assuan bis ins Delta', from: 'Assuan', to: 'Delta', text: 'Der Nil von Assuan bis ins Delta, Abschnitt für Abschnitt flussabwärts (nach Norden).' },
  see: { title: 'Seehafen', sections: SEE, aria: 'Zufahrt von der offenen See bis zum Binnenhafen', from: 'Aussenreede', to: 'Binnenhafen', text: 'Die Zufahrt von der offenen See bis in den Binnenhafen. Gezeiten heben und senken den Pegel.' },
};
export const sectionsOf = (world = 'rhein') => (WORLDS[world] ?? WORLDS.rhein).sections;
export const sectionOf = (k, world = 'rhein') => sectionsOf(world)[k] ?? null;

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
  for (const [key, v] of Object.entries(sec.tune ?? {})) cfg[key] = typeof cfg[key] === 'number' ? +(cfg[key] + v).toFixed(2) : cfg[key]; // Feinabstimmung je Abschnitt (Breite, Tiefe, Sandbänke)
  return cfg;
}
