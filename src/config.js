// Zentrale Spielbalance. Alle Zahlen hier ändern, nichts in der Logik verstecken.
//
// Spielidee: Der Fluss fliesst von links nach rechts. Schiffe brauchen eine Fahrrinne mit genug Wasser unter dem Kiel
// (Tiefgang + Kielfreiheit) und genug Breite. Du baggerst die Flusssohle aus, damit grössere Schiffe und mehr Schiffe
// durchkommen. Jedes Schiff bringt Gebühr + Anteil am Frachtwert (Markt!), das Baggergut wird aufbereitet und verkauft
// oder entsorgt. Gewonnen hat, wer am Ende am meisten Geld hat; das Verkehrsziel schaltet das nächste Level frei.
export const CONFIG = {
  river: { cols: 44, rows: 36 }, // 36 Zeilen: der Fluss liegt in der Mitte, beiderseits bleibt Land (Hafen, später Strassen und Lager)
  daySeconds: 14, // ein Spieltag in Sekunden (120 Tage = 28 Minuten)
  startMoney: 50000, // CHF
  deadlineDays: 120,
  bankruptcyLimit: -40000, // darunter: Konzession entzogen
  // Teilbeladung: Schiffe fahren schon ab (Tiefgang + Kielfreiheit − partialDepth) mit minLoad Ladung; die volle Ladung gibt es bei voller Tiefe, dazwischen linear
  partialDepth: 0.3, minLoad: 0.3,
  clearance: 0.3, // m Wasser, die zusätzlich zum Tiefgang unter dem Kiel bleiben müssen
  water: { base: 8, floodClose: 1.0, floodMax: 1.6, followRate: 0.12 }, // Bezugspegel (m), ab +floodClose wird die Schifffahrt gesperrt
  // Flusssohle: Raster, jede Zelle hat cellArea m² (m³ = Höhe * cellArea)
  layer: {
    cellArea: 16,
    snap: 0.02, // m: so kleine Reste über Fels gelten beim Absaugen als erledigt
    slope: 1.1, // m Höhenunterschied pro Zelle, den eine Böschung hält; steiler rutscht Material nach
    relaxPerTick: 160, // so viele Zellen rutschen pro Spielschritt nach (sichtbar, aber nicht schlagartig)
  },
  hard: { factor: 1.5 }, // harte Schicht: Leistung geteilt durch (1 + Härte * factor)
  box: { cols: 4 }, // der Ponton baggert gleichzeitig 4 Karten-Spalten (Flussrichtung) und 16 Zellen quer zum Fluss
  // Baggerentgelt der Wasserstrassenverwaltung für Material aus dem Baggerkorridor; Naturschutzzone (Ufer, Flachwasser) kostet
  deposits: { exploreCost: 1500, emptyBelow: 6, maxActive: 3, spawnChance: 0.22 }, // leer unter 6 m³ Rest; bis zu 3 Vorkommen gleichzeitig, täglich 22 % Chance auf ein neues
  pay: { perM3: 40, protectFine: 220, landFee: 14 }, // landFee: Landerwerb/Entsorgung pro m³ Aushub aus dem Ausbaustreifen am Ufer
  // Material der Flusssohle (Index = Wert in river.kind). Preis in CHF pro m³ nach der Aufbereitung: positiv = Verkauf, negativ = Entsorgung.
  // Der Kiespreis folgt dem Markt (Fracht "Kies & Sand").
  materials: [
    { id: 'schlick', name: 'Schlick', price: -34, color: '#6e5f4b', particle: '#7d6c55' },
    { id: 'sand', name: 'Sand', price: 12, color: '#c8b27c', particle: '#d9c590' },
    { id: 'kies', name: 'Kies', price: 26, color: '#9d9488', particle: '#b5ab9d' },
    { id: 'altlast', name: 'Altlast', price: -160, color: '#7a4a33', particle: '#ff7a3d' },
    { id: 'fels', name: 'Fels & Bruch', price: 6, color: '#6f747a', particle: '#9aa1a8' },
  ],
  // Sedimentation: der Fluss lagert Schwebstoffe ab, besonders in langsamem Wasser (Rand, Innenkurve). Die Rinne verlandet wieder.
  sediment: { rate: 0.003, maxAbove: 0.3, floodDeposit: [0.18, 0.34], flowPower: 2 },
  // Anlage an Land: nimmt Baggergut aus dem Puffer, sortiert, verkauft oder entsorgt
  plant: { batchFee: 0 },
  // Pumpe an der Kette: Einsaugbereich liegt unten rechts.
  pump: {
    offsetX: 0.3, offsetY: 0.1,
    fullDraw: 2.0, // Summe der Saugwichte, ab der die volle Leistung ankommt
    maxHeightBelowWater: 0.35, // die Pumpe hängt mindestens so tief unter dem Wasserspiegel
  },
  unclog: { hits: 2, zone: 0.24, speed: 1.1, speedUp: 1.4, missPenalty: 1.0 },
  // Fremdstoffe verstopfen die Pumpe; jeder hat im Freispülen eine eigene Schwierigkeit (Reihenfolge wie DEBRIS)
  debris: { count: 22, clogSeconds: 6 },
  debrisInfo: [
    { zone: 0.24, hits: 2, speed: 1.1, clog: 6 }, // Einkaufswagen
    { zone: 0.22, hits: 2, speed: 1.2, clog: 6 }, // Velo
    { zone: 0.34, hits: 1, speed: 1.0, clog: 4 }, // Gummiente
    { zone: 0.18, hits: 3, speed: 1.3, clog: 8 }, // Schiffsanker
    { zone: 0.42, hits: 1, speed: 0.9, clog: 3 }, // Fischernetz-Rest: weich
    { zone: 0.16, hits: 3, speed: 1.2, clog: 9 }, // Autowrack
    { zone: 0.15, hits: 3, speed: 1.2, clog: 9 }, // Schiffswrack
    { zone: 0.14, hits: 3, speed: 1.0, clog: 10 }, // Fliegerbombe (Blindgänger, bitte nicht zucken)
  ],
  turbidityFineThreshold: 0.8, turbidityFinePerSecond: 150,
  // Trübungsbussen je nach Ort des Saugkopfs: Durchfahrt kaum, Altlastenbereich normal, Naturschutzgebiet sehr hoch (und schon bei geringerer Trübung)
  turbidityFine: { channel: { mult: 0.02, threshold: 0.8 }, altlast: { mult: 1, threshold: 0.8 }, nature: { mult: 5, threshold: 0.45 } }, turbidityGain: 500, turbidityDecay: 0.08, // Trübung pro s = Leistung/Gain × Faktoren; Abbau 8 %/s des Werts (+ 0,004/s): Gleichgewicht = Anstieg/Abbau (Leistung 10: ca. 25 %, in Fahrt 35 %, Altlast mehr)
  // Automatik: Stufe 0 = Handbetrieb, 1 = experimentell, 2 = zuverlässig, 3 = voll
  auto: {
    speedFactor: [1, 0.8, 1, 1.25],
    errorRate: [0, 0.08, 0.025, 0],
    errorSeconds: 6,
    clogSeconds: [15, 15, 10, 5], // Wartezeit bei Verstopfung: Pumpe bleibt stehen, bis sie vorbei ist oder das Freispülen gelingt (bessere Automatik = kürzer)
  },
  // Echolot: lotet das Profil vor dem Abtrag aus. Ohne Echolot ist die Messung ungenau (±), die Automatik trifft die Solltiefe schlechter.
  echolot: { noise: [0.35, 0.12, 0.04], doneEps: 0.03, defaultDepth: 2.8, minDepth: 1.0, maxDepth: 7.2 },
  pumpSpeed: { min: 0.2, max: 1, default: 1 },
  // Verkehr: Schiffe erscheinen an beiden Enden, fahren die Fahrrinne ab und zahlen beim Verlassen des Abschnitts
  traffic: {
    shipsPerDay: 2.4, // Grundrate, mal Level-Faktor, Marktnachfrage und Betonnung
    levy: 0.015, // Anteil am Frachtwert, der als Abgabe an die Verwaltung (also an dich) geht
    patience: 75, // Sekunden, die ein Schiff vor der Einfahrt wartet, bevor es abdreht und die Fracht auf die Bahn geht
    bay: 1, // Warteplatz an jedem Ende: so viele Schiffe warten anfangs (Rotlichter und Schlepper bauen ihn aus); weitere drehen sofort ab
    tugSpeed: 0.12, // Schlepper: Tempo-Zuwachs je Stufe für grosse Schiffe (Tiefgang ab 2,6 m)
    holdTimeout: 45, // Sekunden, die ein Schiff in einer Kreuzungsstelle höchstens wartet
    downFactor: 1.15, upFactor: 0.85, // talwärts schneller als bergwärts
    gap: 1.4, // Zellen Sicherheitsabstand hinter dem Vordermann
    enterGap: 3.0,
    groundMargin: 0.2, // m: so viel darf die Sohle über dem Tiefgang liegen, ohne dass das Schiff aufläuft (Kielfreiheit von 0,3 m ist ein Puffer)
    groundSeconds: 40, tugFreeSeconds: 5, tugFreeMax: 25, // Freigeschleppte Schiffe: mind. 5 s, höchstens 25 s geschützt vor erneutem Auflaufen
    salvageFactor: 2.0, // Havarie: Schlepper-Zeit; Bergungskosten = Faktor * Gebühr
    siteRadius: 3.5, siteSlow: 0.5, // Ponton in der Rinne: langsame Fahrt, Wechselverkehr
    switchAfter: 10, // Sekunden Wartezeit auf der Gegenseite, ab der in einer Einbahnrinne die Richtung gewechselt wird
    maxShips: 28,
    marketSpread: 0.2,
  },
  // Kreuzungsstellen: Zonen in der Rinne, in denen zwei Schiffe aneinander vorbeikommen (genug Platz für zwei Rinnen). baseMax + Rotlichter = so viele dürfen ausgewiesen werden
  zones: {
    // Naturschutzstreifen freikaufen: CHF pro Zelle, Abschnitte (Oberlauf, Mittellauf, Unterlauf) je Ufer
    shoreCell: 350, shoreParts: 3,
    baseMax: 1, width: 3, cost: 3000 },
  // Markt: Frachtpreise schwanken (Mean-Reversion + Ereignisse); hohe Preise locken mehr Schiffe dieser Fracht an
  market: { sigma: 0.07, revert: 0.1, minRatio: 0.45, maxRatio: 2.2, history: 24 },
  // Frachtaufträge der Reedereien: X Tonnen einer Fracht bis zu einem Termin durchbringen = Prämie
  contracts: {
    firstAtDay: 7, everyDays: [9, 16], offerDays: 8, dueDays: 28, maxOpen: 3,
    tons: [4, 9], // Vielfache der Schiffsladung
    bonusShare: 0.012, // Prämie in Anteilen des Frachtwerts
    penaltyShare: 0.3,
  },
  dailyCost: 450, perUpgradeLevelCost: 22, // Betrieb und Wartung pro Tag (CHF), plus je ausgebaute Stufe
  advisor: { firstAfter: 18, gap: 55, tipCooldown: 240, tau: 30, eventWindow: 120, bufferFull: 0.45, turbidity: 0.55, richMoney: 40000 },
  refundShare: 0.75,
  // Schiffsuntergang: kommt ein aufgelaufenes Schiff nicht frei (Schlepper müssen es aufgeben), sinkt es mit dieser Wahrscheinlichkeit (je Fracht).
  // Dann liegt ein Wrack als Untiefe in der Rinne, und ausgelaufener Treibstoff, Öl oder Chemie macht den Boden ringsum zur Altlast.
  sinking: { risk: { oel: 0.8, chemie: 0.9, kohle: 0.3, erz: 0.3, container: 0.25, getreide: 0.2, kies: 0.15 }, leakRadius: 1.4, spillRadius: 3.2, raise: 1.0, fineBase: 1500, fineHazard: 6000 },
  // Beton: verhärtet die oberste Sedimentschicht (Boden und Seiten). Verhärtete Zellen verlanden und rutschen kaum noch, müssen zum Tieferbaggern aber
  // erst aufgebrochen werden (Saugkopf fast nutzlos, Löffel schafft es; Bruch zählt als Fels). Anfangs wird Beton gekauft, später mischt ihn das Betonwerk
  // aus Kies und Sand des Flusses (plus Zement).
  concrete: { price: 110, thickness: 0.25, depositFactor: 0.12, pumpBreak: 0.04, bucketBreak: 0.6, cement: 38, mix: { kies: 0.55, sand: 0.35 }, aggCap: 300, stockCap: 800, packs: [20, 100], radius: 1.2 },
  // Aufläufer: ein aufgelaufenes Schiff kann der Spieler mit dem Ponton freischleppen (Minispiel); schafft er es, spart er einen Teil der Bergungskosten
  tow: { range: 4.5, seconds: 30, band: [0.4, 0.7], gain: 0.5, drain: 0.35, snapAt: 1.0, need: 6, refund: 0.6, snapPenalty: 400 },
  // Löffelbagger (Schaufeln): langsamer als der Saugbagger, aber ohne Verstopfen, besser bei harter Schicht und Fels, wenig Trübung,
  // und er reicht über den Wasserspiegel: damit lässt sich Ufer im Ausbaustreifen abtragen (der Fluss wird breiter)
  bucket: { hardFactor: 0.5, turbidity: 0.3, reachAbove: 2.2, bombChance: 1 },
  // Flotte: gemietete Pontons arbeiten selbstständig (Automatik), ohne dass du den Querschnitt öffnest
  fleet: { widenRows: 3, max: 4, costs: [30000, 45000, 65000, 90000], wage: 300, margin: 0.1, soundNoise: 0.03, speedMult: 0.9, idleRetry: 3, rockFirmnessMin: 0.3 },
};

// Materialindex
export const KIND = { schlick: 0, sand: 1, kies: 2, altlast: 3, fels: 4 };

// Basiswerte ohne Upgrades
export const BASE_STATS = {
  power: 10.0, // m³/s Saugleistung
  radius: 1.8, // Zellen
  speed: 4.0, // Zellen/s (Ponton auf der Karte)
  headSpeed: 4.8, // Einheiten/s: Höchsttempo der Pumpe an Katze und Kette
  curtain: 0, // Trübungsschutz (0..1)
  suctionSpeedFactor: 0.55,
  plantCapacity: 8, // m³/s, die die Anlage verarbeitet
  bufferCapacity: 160, // m³ Puffer vor der Anlage; ist er voll, muss das Saugen pausieren
  disposalFactor: 1, // Faktor auf Entsorgungskosten (Entwässerung senkt ihn)
  sortBonus: 1, // Faktor auf Verkaufserlöse (Sortieranlage hebt ihn)
  rockFirmness: 0.10, // Anteil der Leistung, mit der sich Fels abtragen lässt (Felsfräse erhöht ihn)
  autoLevel: 0,
  echolot: 0,
  trafficMult: 1, // Betonnung & Leuchtfeuer: mehr Schiffe
  vts: 0, // Verkehrsleitsystem: schnellere Bergung, kleinere Abstände
  pilot: 0, // Lotsendienst: höhere Gebühren
  signals: 0, // Rotlichter: mehr Kreuzungsstellen und Warteplatz
  tugs: 0, // Schlepper: Warteplatz und schnellere grosse Schiffe
  piler: 0, // Pfahlgerät-Stufe (0 = keine Pfähle möglich)
  pileTime: 10, // Sekunden je Pfahl
  loeffel: 0, // Löffelbagger-Stufe (0 = nicht vorhanden)
  betonrohr: 0, // Betoniergerät-Stufe
  pourPower: 0, // m³/s Beton, die das Gerät ausbringt
  mixer: 0, // Betonwerk-Stufe
  mixRate: 0, // m³/s Beton, die das Werk mischt
  bucketPower: 0, // m³/s Grabeleistung des Löffels
  bucketRadius: 1.1, // Zellen
  bucketRock: 0.3, // Anteil der Leistung im Fels
};

// Jedes Upgrade: Stufe n kostet baseCost * growth^n, wirkt über apply()
export const UPGRADES = {
  power: { group: 'ponton', name: 'Saugpumpe', desc: 'Mehr m³ pro Sekunde', maxLevel: 8, baseCost: 6000, growth: 1.5, apply: (s, l) => { s.power += l * 2.0; } },
  radius: { group: 'ponton', name: 'Saugkopf', desc: 'Grössere Saugfläche', maxLevel: 5, baseCost: 6000, growth: 1.6, apply: (s, l) => { s.radius += l * 0.5; } },
  speed: { group: 'ponton', name: 'Ponton-Antrieb', desc: 'Schnelleres Fahren auf der Karte', maxLevel: 5, baseCost: 5000, growth: 1.5, apply: (s, l) => { s.speed += l * 0.6; } },
  winch: { group: 'ponton', name: 'Katze & Winde', desc: 'Pumpe fährt und taucht schneller (Höchsttempo)', maxLevel: 5, baseCost: 5000, growth: 1.5, apply: (s, l) => { s.headSpeed += l * 0.7; } },
  curtain: { group: 'ponton', name: 'Trübungsschutz', desc: 'Schlammvorhang: weniger Trübung, weniger Bussen', maxLevel: 4, baseCost: 7000, growth: 1.6, apply: (s, l) => { s.curtain = Math.min(0.8, l * 0.2); } },
  cutter: { group: 'ponton', name: 'Felsfräse', desc: 'Schneidkopf: Felsriegel lassen sich abtragen (ohne Fräse kaum)', maxLevel: 4, baseCost: 14000, growth: 1.7, apply: (s, l) => { s.rockFirmness += l * 0.14; } },
  piler: { group: 'ponton', name: 'Pfahlgerät', desc: 'Rammt Betonpfähle bis auf den Fels (Pfahlwand an der Rinne). Ohne Gerät keine Pfähle; höhere Stufen bauen schneller', maxLevel: 4, baseCost: 18000, growth: 1.7, apply: (s, l) => { s.piler = l; s.pileTime = l > 0 ? [10, 6.5, 4.5, 3][l - 1] : 10; } },
  loeffel: { group: 'ponton', name: 'Löffelbagger', desc: 'Ausleger mit Schaufel (V = Gerät wechseln): verstopft nie, schafft Fels und harte Schicht, wenig Trübung, reicht über Wasser (Ufer abtragen). Höhere Stufen: mehr Leistung', maxLevel: 5, baseCost: 12000, growth: 1.6, apply: (s, l) => { s.loeffel = l; if (l > 0) { s.bucketPower = 2.4 + 1.3 * (l - 1); s.bucketRadius = 1.0 + 0.12 * l; s.bucketRock = 0.28 + 0.08 * l; } } },
  betonrohr: { group: 'ponton', name: 'Betoniergerät', desc: 'Verhärtet Boden und Ufer (V = Gerät wechseln): weniger Verlandung und Rutschung. Zum Tieferbaggern muss der Beton wieder aufgebrochen werden (Löffel)', maxLevel: 3, baseCost: 11000, growth: 1.6, apply: (s, l) => { s.betonrohr = l; s.pourPower = l > 0 ? 2 + 2 * (l - 1) : 0; } },
  mixer: { group: 'plant', name: 'Betonwerk', desc: 'Mischt Beton aus Kies und Sand des Flusses (plus Zement), viel billiger als Zukaufen', maxLevel: 3, baseCost: 16000, growth: 1.7, apply: (s, l) => { s.mixer = l; s.mixRate = 0.2 * l; } },
  echolot: { group: 'ponton', name: 'Echolot', desc: 'Genauere Peilung: die Automatik trifft die Solltiefe besser', maxLevel: 2, baseCost: 9000, growth: 1.8, apply: (s, l) => { s.echolot = l; } },
  auto: { group: 'ponton', name: 'Automatik', desc: 'Stufe 1 experimentell (überwachen!), 2 zuverlässig, 3 voll', maxLevel: 3, baseCost: 12000, growth: 1.8, apply: (s, l) => { s.autoLevel = l; } },
  plant: { group: 'plant', name: 'Aufbereitungsanlage', desc: 'Mehr Durchsatz und Puffer (ab Stufe 7 braucht es Aufbereitungshallen im Hafen, jede weitere Karte mit Halle erlaubt mehr)', maxLevel: 24, baseCost: 7000, growth: 1.5, costAt: (l) => (l < 12 ? 7000 * 1.5 ** l : 7000 * 1.5 ** 12 * (1 + 0.35 * (l - 11))), apply: (s, l) => { s.plantCapacity += l * 2 + l * l * 0.25; s.bufferCapacity += l * 60 + l * l * 5; } },
  dewater: { group: 'plant', name: 'Entwässerung', desc: 'Trockeneres Material: Entsorgung wird günstiger', maxLevel: 4, baseCost: 9000, growth: 1.6, apply: (s, l) => { s.disposalFactor = Math.max(0.4, 1 - l * 0.15); } },
  sorter: { group: 'plant', name: 'Sortieranlage', desc: 'Kies und Sand besser verkaufen', maxLevel: 4, baseCost: 9000, growth: 1.6, apply: (s, l) => { s.sortBonus = 1 + l * 0.2; } },
  beacons: { group: 'traffic', name: 'Betonnung & Leuchtfeuer', desc: 'Sicher auch bei Nacht: mehr Schiffe pro Tag', maxLevel: 4, baseCost: 7000, growth: 1.6, apply: (s, l) => { s.trafficMult = 1 + l * 0.18; } },
  signals: { group: 'traffic', name: 'Rotlichter (Signalanlage)', desc: 'Regeln den Gegenverkehr: eine Kreuzungsstelle mehr und ein Schiff mehr im Warteplatz je Stufe', maxLevel: 3, baseCost: 9000, growth: 1.7, apply: (s, l) => { s.signals = l; } },
  tugs: { group: 'traffic', name: 'Schlepper', desc: 'Halten Schiffe im Warteplatz (ein Platz mehr je Stufe) und beschleunigen grosse Schiffe (Tiefgang ab 2,6 m); auf Stufe 3 schleppen sie aufgelaufene Schiffe frei', maxLevel: 3, baseCost: 12000, growth: 1.7, apply: (s, l) => { s.tugs = l; } },
  vts: { group: 'traffic', name: 'Verkehrsleitsystem', desc: 'Kürzere Abstände, schnellere Bergung bei Havarien', maxLevel: 3, baseCost: 12000, growth: 1.7, apply: (s, l) => { s.vts = l; } },
  pilot: { group: 'traffic', name: 'Lotsendienst', desc: 'Höhere Gebühren pro Schiff', maxLevel: 3, baseCost: 10000, growth: 1.7, apply: (s, l) => { s.pilot = l; } },
};

// Schiffsklassen. draught = Tiefgang (m), beam = Breite in Zellen, len = Länge in Zellen, tons = Ladung, share = Anteil am Verkehr
export const SHIPS = [
  { id: 'kahn', name: 'Lastkahn', icon: '🛶', draught: 1.4, beam: 2, len: 2.4, speed: 1.6, tons: 300, fee: 500, share: 0.34, cargo: ['kies', 'getreide'], color: '#a07a52' },
  { id: 'motor', name: 'Motorgüterschiff', icon: '🚤', draught: 2.0, beam: 2, len: 3.2, speed: 2.0, tons: 800, fee: 1100, share: 0.3, cargo: ['getreide', 'kohle', 'kies'], color: '#4f86b8' },
  { id: 'tank', name: 'Tankschiff', icon: '🛢️', draught: 2.9, beam: 3, len: 3.8, speed: 1.9, tons: 1500, fee: 1800, share: 0.16, cargo: ['oel', 'chemie'], color: '#b5483a' },
  { id: 'container', name: 'Containerschiff', icon: '🚢', draught: 4.0, beam: 3, len: 4.6, speed: 2.2, tons: 2500, fee: 2800, share: 0.13, cargo: ['container'], color: '#3b9a78' },
  { id: 'schub', name: 'Schubverband', icon: '⛴️', draught: 5.2, beam: 4, len: 5.4, speed: 1.7, tons: 4500, fee: 4500, share: 0.07, cargo: ['kohle', 'erz'], color: '#7a69b8' },
];
export const shipById = (id) => SHIPS.find((s) => s.id === id);

// Frachtarten: base = Basispreis in CHF pro Tonne
export const CARGOS = [
  { id: 'kies', name: 'Kies & Sand', base: 18, color: '#c9b27a' },
  { id: 'getreide', name: 'Getreide', base: 120, color: '#e0c040' },
  { id: 'kohle', name: 'Kohle', base: 60, color: '#4a4a4a' },
  { id: 'erz', name: 'Erz', base: 75, color: '#a0603c' },
  { id: 'oel', name: 'Mineralöl', base: 180, color: '#2b2b33' },
  { id: 'chemie', name: 'Chemie', base: 320, color: '#7bd88f' },
  { id: 'container', name: 'Container', base: 160, color: '#e0803a' },
];
export const cargoById = (id) => CARGOS.find((c) => c.id === id);

// Rohstoffvorkommen im Flussbett: hochwertiges Material, das mit Konzession (im Panel erwerben) einen Preisaufschlag bringt (mult mal Materialpreis,
// der Aufschlag wird sofort bar bezahlt). Neue Vorkommen müssen erst erkundet werden. kind = Material der Zellen, cost = Konzession in CHF.
export const DEPOSITS = [
  { id: 'kiesbank', name: 'Kiesbank (Premium-Kies)', kind: 2, mult: 3.0, cost: 2500, color: '#e6cf86' },
  { id: 'quarz', name: 'Quarzsand (Glasindustrie)', kind: 1, mult: 4.5, cost: 6000, color: '#7fd4ff' },
  { id: 'seife', name: 'Erzseife (Schwermineralsand)', kind: 1, mult: 9, cost: 12000, color: '#ff9a2e' },
];
export const depositType = (id) => DEPOSITS.find((d) => d.id === id);

// Fremdstoffe im Fluss (Index = Wert in river.debris - 1)
export const DEBRIS = ['Einkaufswagen', 'Velo', 'Gummiente (gross)', 'Schiffsanker', 'Fischernetz', 'Autowrack', 'Schiffswrack (Rumpf)', 'Fliegerbombe (Blindgänger!)'];

// ---------- Levels ----------
// river: Parameter der Flussgenerierung. bars = Barren über die ganze Breite (Höhe in m, die die Rinne dort flacher ist),
// ridges = Felsriegel (Tiefe unter Bezugspegel, ab der Fels beginnt). classes = Schiffsklassen, die in diesem Level fahren.
// Freigeschaltet wird ein Level, wenn das Verkehrsziel des vorherigen erreicht und mit Gewinn abgeschlossen wurde.
export const LEVELS = [
  {
    id: 'hochrhein', name: 'Hochrhein: Basel–Birsfelden', short: 'Hochrhein',
    blurb: 'Der Klassiker: breiter Fluss, ein paar Barren, ein harmloser Felsriegel. Erst kommen nur Kähne durch, mit Baggern kommen Tanker und Containerschiffe.',
    river: { halfWidth: 6.8, depthMax: 2.4, rockDepth: 6.4, meander: 2.4, bars: [{ x: 9, w: 3.5, raise: 0.5 }, { x: 22, w: 4, raise: 0.55 }, { x: 36, w: 3.5, raise: 0.45 }], ridges: [{ x: 30, w: 4, depth: 4.3 }], shoals: 5, altlast: 2, hardBlobs: 3, debris: 14, deposits: ['kiesbank', 'quarz', 'seife'] },
    classes: ['kahn', 'motor', 'tank', 'container'], traffic: 1, goalTons: 70000, startMoney: 60000, deadlineDays: 120, turbidityMult: 1,
    palette: { water: [38, 120, 160], land: [96, 130, 78] },
  },
  {
    id: 'loreley', name: 'Mittelrhein: Loreley-Enge', short: 'Loreley',
    blurb: 'Schmal, felsig und viel Verkehr. Zwei Felsriegel sperren die Grossen aus: ohne Felsfräse kommt kein Schubverband durch, und an der Enge ist Gegenverkehr ein Thema.',
    river: { halfWidth: 5.6, depthMax: 2.3, rockDepth: 5.2, meander: 2.8, bars: [{ x: 7, w: 3, raise: 0.5 }, { x: 18, w: 3.5, raise: 0.5 }, { x: 38, w: 3, raise: 0.5 }], ridges: [{ x: 13, w: 4.5, depth: 3.6 }, { x: 30, w: 4, depth: 3.3 }], shoals: 4, altlast: 3, hardBlobs: 7, debris: 18, deposits: ['kiesbank', 'quarz', 'quarz', 'seife'] },
    classes: ['kahn', 'motor', 'tank', 'container', 'schub'], traffic: 1.3, goalTons: 110000, startMoney: 55000, deadlineDays: 120, turbidityMult: 1.1,
    palette: { water: [44, 104, 124], land: [92, 100, 84] },
  },
  {
    id: 'donau', name: 'Donau: Eisernes Tor', short: 'Eisernes Tor',
    blurb: 'Breiter Strom, harter Fels und alte Industrie am Ufer: viele Altlasten, viele Blindgänger. Wer hier den Schubverbänden die Rinne öffnet, verdient richtig.',
    river: { halfWidth: 7.4, depthMax: 2.6, rockDepth: 5.0, meander: 2.2, bars: [{ x: 8, w: 3.5, raise: 0.6 }, { x: 20, w: 4, raise: 0.6 }, { x: 33, w: 3.5, raise: 0.6 }], ridges: [{ x: 14, w: 4, depth: 3.5 }, { x: 27, w: 5, depth: 3.2 }, { x: 40, w: 3, depth: 3.6 }], shoals: 6, altlast: 6, hardBlobs: 8, debris: 22, deposits: ['kiesbank', 'kiesbank', 'quarz', 'seife', 'seife'] },
    classes: ['kahn', 'motor', 'tank', 'container', 'schub'], traffic: 1.5, goalTons: 160000, startMoney: 60000, deadlineDays: 130, turbidityMult: 1,
    palette: { water: [56, 110, 110], land: [108, 112, 80] },
  },
];
// Endlos-Modus: Zufallskarten aus einer Seed-Nummer, startet wie der Hochrhein und lässt sich um weitere Engstellen (Karten) erweitern.
// Jede weitere Karte ist schwerer (schmaler, mehr Fels, Altlasten, Fremdstoffe) und kostet mehr. Kein Ziel, keine Frist: wer pleite geht, verliert.
export const ENDLESS = {
  id: 'endlos', endless: true, name: 'Endlos: Flussnetz', short: 'Endlos',
  blurb: 'Zufallskarten mit Seed-Nummer. Du startest wie am Hochrhein und erschliesst mit der Zeit weitere Engstellen als neue Karten, die du alle verwaltest.',
  river: null, classes: ['kahn', 'motor', 'tank', 'container', 'schub'], traffic: 1, goalTons: Infinity, startMoney: 60000, deadlineDays: Infinity, turbidityMult: 1,
  palette: { water: [44, 112, 150], land: [98, 124, 80] },
  maxMaps: 6, mapCosts: [0, 45000, 90000, 150000, 240000, 380000],
};
export const levelById = (id) => (id === ENDLESS.id ? ENDLESS : LEVELS.find((l) => l.id === id) ?? LEVELS[0]);
