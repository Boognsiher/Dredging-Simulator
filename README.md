# Fahrrinne frei! – Dredging Simulator

Ein Fluss ist zu flach für grosse Schiffe. Du baggerst die Flusssohle aus, öffnest die Fahrrinne für immer grössere Schiffe,
lässt mehr Schiffe gleichzeitig durch und verdienst an Gebühren, Fracht und Baggergut. Das Spiel kombiniert **Kanal freilegen**
(Baggern im Querschnitt, Karte, Upgrades) mit einer kleinen **Wirtschaftssimulation** (Schiffe, Fracht, Markt, Aufträge).
Steuerung, Aufbau und Oberfläche folgen dem Seesanierungs-Spiel ([Romans-Altlasten-Game](https://github.com/Boognsiher/Romans-Altlasten-Game)).

## Starten
    npm start        # http://localhost:8000  (nur python3 nötig, kein Build)
    npm test         # Logik-Tests (node:test)

## Spielidee
- **Fahrrinne:** Ein Schiff braucht Wasser unter dem Kiel (Tiefgang + 0,3 m) und eine Rinne von der Breite des Schiffs, jeweils quer zum Fluss gemessen. Die
  Analyse (`src/sim/fairway.js`) sucht je Klasse die günstigste Rinne und meldet, wie viele m³ noch fehlen. In der Klassenleiste oben siehst du den Stand,
  auf der Karte zeigen **rote Zellen** die Engstellen der gewählten Klasse (lila = Fels im Weg), die gestrichelte Linie die günstigste Rinne.
- **Schiffsklassen:** Lastkahn 1,4 m · Motorgüterschiff 2,0 m · Tankschiff 2,6 m · Containerschiff 3,2 m · Schubverband 4,0 m Tiefgang. Am Anfang fährt nur die kleinste Klasse.
  Grössere Schiffe zahlen mehr Gebühr und tragen wertvollere Fracht.
- **Mehr Schiffe:** In einer Einbahnrinne fahren Schiffe nur in eine Richtung (Wechselverkehr, Wartezeit). Erst zwei getrennte Rinnen (⇄) erlauben Gegenverkehr.
  Wer warten muss, dreht nach einer Weile ab: die Fracht geht auf die Bahn (entgangene Einnahmen). Betonnung, Verkehrsleitsystem und Lotsendienst steigern Verkehr und Einnahmen.
- **Wirtschaft:** Pro Schiff gibt es eine **Gebühr** plus `levy` (1,5 %) vom **Frachtwert**. Frachtpreise schwanken (Mean-Reversion + Ereignisse wie Ölschock, Missernte, Bauboom);
  hohe Preise locken mehr Schiffe dieser Fracht an. Reedereien bieten **Frachtaufträge** (X Tonnen bis zum Termin: Prämie, sonst Konventionalstrafe).
- **Baggergut:** Die Anlage an Land sortiert den Puffer nach Material: Kies und Sand (Marktpreis!) und Fels bringen Geld, Schlick und Altlasten kosten Entsorgung. Sortieranlage und
  Entwässerung verbessern das, die Aufbereitungsanlage den Durchsatz. Ist der Puffer voll, muss die Pumpe pausieren. Dazu zahlt die Verwaltung ein **Baggerentgelt** pro m³ aus dem Korridor.
- **Fluss lebt:** Böschungen **rutschen nach** (schmal und tief baggern füllt sich wieder auf), der Fluss **verlandet** (langsames Wasser am Rand, Hochwasser lagert Schlick ab),
  **Niedrigwasser** nimmt Tiefe (Schiffe können auflaufen: Bergung kostet, Rinne blockiert), **Hochwasser** sperrt die Schifffahrt. **Fels** (Felsriegel) lässt sich ohne Felsfräse kaum
  abtragen. Ufer und Flachwasser sind **Naturschutzzone** (Busse pro m³). Ein Ponton in der Rinne bremst den Verkehr (Baustelle).
- **Löffelbagger (Schaufeln):** Upgrade «Löffelbagger», im Querschnitt mit `V` oder dem Knopf «Gerät» umschaltbar. Er ist langsamer als der Saugbagger, verstopft aber nie
  (Fremdstoffe hebt er einfach aus, nur Bomben bleiben ein Problem), schafft harte Schichten und Fels besser, trübt wenig und kippt kaum.
- **Land abtragen:** Der Löffel reicht über den Wasserspiegel. Das Ufer im **gelben Ausbaustreifen** (Karte) lässt sich abgraben, das kostet nur eine Landgebühr
  (`pay.landFee`) statt Busse. Liegt das Land unter Wasser, wird es zum Baggerkorridor: der Fluss wird breiter (mehr Platz für grosse Schiffe und Gegenverkehr). Das Material kommt in den Puffer
  (Aushub wird als Sand verwertet). Ausserhalb des Streifens gilt Schutzgebiet. Böschungen rutschen auch hier nach.
- **Flotte:** Mit der Automatik (Stufe 1 und höher) kannst du bis zu vier **Pontons mieten** (Panel «Flotte», Kosten steigen, Löhne pro Tag). Sie fahren selbstständig zur nächsten Engstelle des
  **Ausbauziels** (Klasse wählbar, Standard: die kleinste, die noch nicht fährt), ankern, baggern per Automatik auf Solltiefe (bei Fels mit dem Löffel, wenn vorhanden) und suchen danach die nächste Stelle.
  Du musst den Querschnitt nicht mehr öffnen; dein eigener Ponton bleibt frei steuerbar. Pontons ohne Arbeit melden, was fehlt (z. B. «Fels im Weg»). Ankernde Pontons bremsen den Verkehr.
- **Freischaltung:** Reedereien schicken nur Schiffe, die gerade durch die Rinne passen. Eine neue Klasse schaltet sich frei, sobald für sie zum ersten Mal eine Rinne frei ist (Meldung); verlandet die Rinne wieder, bleiben die Schiffe aus («⚠ gesperrt» in der Klassenleiste) und kommen erst nach dem Nachbaggern zurück.
- **Warteplatz:** An jedem Ende wartet anfangs **ein** Schiff; weitere drehen ab (entgangener Verdienst). **Rotlichter** (Signalanlage) und **Schlepper** bauen den Warteplatz um je ein Schiff pro Stufe aus.
- **Kreuzungsstellen:** Auf der Karte (Knopf oder `K`) lassen sich Zonen **planen** (3000 CHF), auch wo noch nicht genug Platz ist: Jede Spalte zeigt grün (Platz da) oder gelb bis orange (so viel fehlt), unter der Maus steht der fehlende Aushub in m³, rot markiert die Zellen, die noch ausgetragen werden müssen. Gekreuzt wird erst, wenn **zwei Rinnen nebeneinander** (2 × Schiffsbreite + 1 Zelle, also 5 / 7 / 9 Zellen für Kahn und Motorschiff / Tanker und Container / Schubverband, durchgehend tief genug, 3 Spalten breit) da sind. Die Flotte baut geplante Stellen aus. Die Klasse, für die geplant wird, ist wählbar. In der Einbahnrinne warten sich Schiffe dort ab: das zuerst eingetroffene wartet in der Zone, bis das Gegenschiff eintrifft, dann fahren sie aneinander vorbei. Eine Einfahrt gegen den Verkehr ist nur erlaubt, wenn eine freie Kreuzungsstelle dazwischen liegt. Eine ist erlaubt, jede Stufe Rotlichter erlaubt eine weitere. Sind mehr Pontons oder Aufläufer im Weg, bleibt es bei Wartezeit.
- **Schlepper:** Beschleunigen Schiffe ab 2,6 m Tiefgang um 12 % je Stufe und halten sie im Warteplatz.
- **Flotte betoniert:** Mit «Rinne betonieren» verhärten freie Flottenpontons (Betoniergerät und Beton im Lager nötig) die Rinne der höchsten fahrenden Klasse samt zwei Zeilen Böschung beiderseits. Fehlt der Beton, melden sie es und warten.
- **Rohstoffgebiete:** Im Flussbett liegen hochwertige Vorkommen (Kiesbank ×3, Quarzsand ×4,5, Erzseife ×9, goldgelb auf der Karte). Mit **Konzession** wird der Abbau der obersten ca. 1 bis 1,5 m sofort bar mit Preisaufschlag bezahlt, zusätzlich zu Baggerentgelt und Verkauf. Das erste Vorkommen gehört dir von Anfang an (so kommt das Geld früh), weitere müssen **erkundet** (1500 CHF) und per Konzession erworben werden (Panel «Rohstoffgebiete»). Freie Flottenpontons bauen Vorkommen mit Konzession selbst ab.
- **Altlasten:** Sie werden beim Start des Levels als Flecken gesetzt (Hochrhein 2, Loreley 3, Eisernes Tor 6, nahe der Flussmitte, nur auf Sediment) und neu, wenn ein **Schiff sinkt**: Kommt ein aufgelaufenes Schiff nicht frei, sinkt es je nach Fracht (Öl 80 %, Chemie 90 %, Kohle und Erz 30 %, Container 25 %, Getreide 20 %, Kies 15 %). Dann liegt ein hartes **Wrack** als Untiefe in der Rinne, Treibstoff, Öl oder Chemie machen den Boden ringsum zur Altlast, und es gibt eine Umweltbusse. Das Panel «Altlasten» zeigt Menge, Korridoranteil, Entsorgungskosten und was je Klasse in der Rinne liegt, auf der Karte steht ☢.
- **Land-Automatik:** In der Flotte lässt sich «Ufer verbreitern» einschalten (braucht den Löffelbagger, 1–5 Zeilen Breite wählbar). Der letzte gemietete Ponton baut dann selbstständig
  den Ausbaustreifen neben dem Korridor ab, bis die Tiefe der Ausbauklasse erreicht ist. So entstehen zusätzliche Korridorzellen für breitere Rinnen und Gegenverkehr. Das ist viel Material und dauert.
- **Beton:** Das Betoniergerät (Upgrade, `V` wechselt das Gerät) verhärtet die oberste Sedimentschicht von Boden und Seiten (Leertaste bringt Beton aus, Kosten: Betonvorrat).
  Verhärtete Zellen **verlanden kaum noch** (auch bei Hochwasser) und **rutschen nicht nach**. Wer später tiefer baggern will, muss den Beton **aufbrechen**: der Saugkopf schafft das fast nicht,
  der Löffelbagger schon (Bruch zählt als Fels und wird als Schotter verwertet). Die Flotte nimmt dafür den Löffel; ohne Löffel meldet sie «Beton im Weg».
  Beton wird anfangs **gekauft** (Panel «Beton», 110 CHF/m³). Mit dem **Betonwerk** (Anlage ausbauen) mischst du ihn selbst aus Kies und Sand des Flusses (die Anlage leitet sie ins Lager um, wenn der Haken gesetzt ist)
  plus Zement (38 CHF/m³): deutlich billiger.
- **Aufläufer-Minispiel:** Läuft ein Schiff auf Grund (Niedrigwasser, Verlandung), blockiert es die Rinne. Fährst du mit dem Ponton in seine Nähe (Karte: Ring um das Schiff) und startest
  «Aufläufer freischleppen» (`T` oder Knopf), kannst du es selbst freiziehen: **Zugtaste halten** (Leertaste, am Handy der grosse Knopf), um Spannung aufzubauen, loslassen lässt sie sinken. Nur im **grünen Band** bewegt
  sich das Schiff, zu viel Zug lässt die Leine reissen (Strafe). Schwere Schiffe haben ein schmaleres Band. Schaffst du es, ist das Schiff sofort frei und ein Teil der Bergungskosten kommt zurück; sonst kommen die Schlepper wie gewohnt.
- **Ziel:** Jedes Level hat ein Verkehrsziel in Tonnen. Erreichst du es und schliesst mit Gewinn ab (oder die Frist läuft mit Gewinn ab), schaltest du das nächste Level frei.
  Gewonnen hat, wer am Ende am meisten Geld hat. Levels: **Hochrhein** (Einstieg), **Loreley-Enge** (schmal, Felsriegel, Schubverband), **Eisernes Tor** (Fels, Altlasten, Blindgänger).

## Steuerung
**Computer**
- Karte: WASD / Pfeile (oder Maus gedrückt) fahren den Ponton, `E`/Leertaste wirft den Anker, `1`–`5` wählen die Schiffsklasse, Tippen/Klicken auf die Klassenleiste auch.
- Querschnitt: `A`/`D` Pumpe quer zum Fluss, `W`/`S` Kette hoch/runter, Leertaste Pumpe ein/aus (saugt nach rechts und im Stillstand, rückwärts nie), `Z`/`X` Tempo,
  `F`/`G` Solltiefe, `V` Gerät (Saugkopf/Löffel/Beton), `T` auf der Karte: Aufläufer freischleppen, `1`–`5` Solltiefe für eine Klasse, `T` Automatik, `R` Reset, `Q` zurück zur Karte, `P` Pause, `M` Ton, `B` Flussmeister Fritz.

**Handy:** Stick links (Karte), Pfeil-Knöpfe (Querschnitt), grosser Knopf rechts (Anker / Pumpe an-aus / Freispülen), Tempo- und Solltiefe-Regler, Tipp auf die Karte fährt hin und ankert,
Klassenleiste oben, Shop als Fach unten (Spiel steht still, solange es offen ist).

**Querschnitt lesen:** Der Ponton baggert 4 Spalten in Flussrichtung gleichzeitig. Die **dicke Linie** ist der höchste Punkt im Kasten (= die engste Stelle für Schiffe), die dünne gestrichelte der
tiefste. Orange gestrichelt ist deine **Solltiefe**, die farbigen Linien sind die Tiefen der Schiffsklassen. Rote Pfeile zeigen in cm, wie viel noch über der Solltiefe liegt.
Die **Automatik** (Upgrade) fährt auf die Solltiefe (verstopft die Pumpe, bleibt sie stehen und wartet 15 s – mit besserer Automatik 10 bzw. 5 s – oder du löst das Freispülen-Minispiel, das immer kommt); ihr **Arbeitsbereich** (von wo bis wo) lässt sich im Querschnitt setzen: Pumpe an die gewünschte Stelle fahren, `[` = Auto-Start hier, `]` = Auto-Ende hier, `\` = Bereich löschen (oder die gleichnamigen Knöpfe). Ausserhalb wird der Querschnitt abgedunkelt, der Bereich gilt auch für die nächsten Verankerungen. **Naturschutzzonen** sind unter Wasser kräftig grün schraffiert, mit Leuchtband auf der Sohle, Grenzlinie und Beschriftung (Karte: grün gekachelt). **Echolot** macht die Peilung genauer. Verstopft ein Fremdstoff die Pumpe, startet das **Freispülen** (grüner Bereich, Leertaste).

## Aufbau
| Pfad | Zweck |
|---|---|
| `src/config.js` | Balance: Kosten, Schiffe, Fracht, Upgrades, Levels – hier drehen |
| `src/sim/river.js` | Flusssohle-Raster: Baggern (massenerhaltend), Nachrutschen, Verlandung, Hochwasser |
| `src/sim/fairway.js` | Fahrrinnen-Analyse je Schiffsklasse (Dijkstra), Gegenverkehr, Pfade |
| `src/sim/slice.js` | Querschnitt: Pumpe, Kette, Automatik, Fremdstoffe, Freispülen |
| `src/sim/dredge.js` | Ponton-Sitzung: Karte und Querschnitt, Trübung |
| `src/sim/fleet.js` | Flotte: gemietete Pontons, die selbstständig baggern (Rinne und Uferstreifen) |
| `src/sim/tow.js` | Minispiel: aufgelaufene Schiffe freischleppen |
| `src/sim/traffic.js` | Schiffe: Spawn, Warteschlange, Einbahnrinne, Havarie, Einnahmen |
| `src/sim/market.js` | Frachtpreise (Schwankung, Schocks, Nachfrage) |
| `src/sim/plant.js` | Anlage an Land: Verkauf und Entsorgung des Baggerguts |
| `src/sim/contracts.js` | Frachtaufträge der Reedereien |
| `src/sim/events.js` | Zufallsereignisse (neue = neuer Eintrag) |
| `src/sim/game.js` | Management: Tage, Geld, Upgrades, Wasserstand, Ende |
| `src/sim/advisor.js` | Flussmeister Fritz (Tipps) |
| `src/sim/save.js` | Spielstand (localStorage) |
| `src/ui/` | Canvas-Rendering, Eingabe, Touch, Ton, Effekte |
| `src/main.js` | Verdrahtung, DOM-Panel |
| `tests/` | Logik-Tests |

Prinzip: `src/sim/` kennt weder DOM noch Canvas und ist getestet.

## Speichern
Das Spiel speichert automatisch im Browser (`localStorage`, Schlüssel `dredging.save`): bei jedem neuen Tag, alle 10 Sekunden, bei Käufen, beim Pausieren und beim Verlassen der Seite.
Gespeichert werden Geld, Zeit, Upgrades, Markt, Schiffe, Aufträge, Flotte, Betonvorrat und die Flusssohle (mit Betonschicht) (Spielstände älterer Versionen werden nicht mehr geladen); die laufende Pontonfahrt nicht. Rekorde je Level stehen unter `dredging.levels`.

## Ideen für später
Reedereien nach Klasse freischalten, Betonqualitäten, weitere Geräte (Eimerkettenbagger, Greifer), Tauchdrohne für Peilung und Abnahme, Kran-Minispiel für Wracks, Schleusen und Häfen als eigene Stationen, Kosten für Verklappung im Fluss, Jahreszeiten (Pegelkurve), weitere Flüsse.

## Einzeldatei zum Ausprobieren
`dist/fahrrinne-frei.html` ist eine einzelne Datei, die per Doppelklick (ohne Server) im Browser läuft. Neu bauen mit `npm run build`.
