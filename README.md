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
- **Ziel:** Jedes Level hat ein Verkehrsziel in Tonnen. Erreichst du es und schliesst mit Gewinn ab (oder die Frist läuft mit Gewinn ab), schaltest du das nächste Level frei.
  Gewonnen hat, wer am Ende am meisten Geld hat. Levels: **Hochrhein** (Einstieg), **Loreley-Enge** (schmal, Felsriegel, Schubverband), **Eisernes Tor** (Fels, Altlasten, Blindgänger).

## Steuerung
**Computer**
- Karte: WASD / Pfeile (oder Maus gedrückt) fahren den Ponton, `E`/Leertaste wirft den Anker, `1`–`5` wählen die Schiffsklasse, Tippen/Klicken auf die Klassenleiste auch.
- Querschnitt: `A`/`D` Pumpe quer zum Fluss, `W`/`S` Kette hoch/runter, Leertaste Pumpe ein/aus (saugt nach rechts und im Stillstand, rückwärts nie), `Z`/`X` Tempo,
  `F`/`G` Solltiefe, `1`–`5` Solltiefe für eine Klasse, `T` Automatik, `R` Reset, `Q` zurück zur Karte, `P` Pause, `M` Ton, `B` Flussmeister Fritz.

**Handy:** Stick links (Karte), Pfeil-Knöpfe (Querschnitt), grosser Knopf rechts (Anker / Pumpe an-aus / Freispülen), Tempo- und Solltiefe-Regler, Tipp auf die Karte fährt hin und ankert,
Klassenleiste oben, Shop als Fach unten (Spiel steht still, solange es offen ist).

**Querschnitt lesen:** Der Ponton baggert 4 Spalten in Flussrichtung gleichzeitig. Die **dicke Linie** ist der höchste Punkt im Kasten (= die engste Stelle für Schiffe), die dünne gestrichelte der
tiefste. Orange gestrichelt ist deine **Solltiefe**, die farbigen Linien sind die Tiefen der Schiffsklassen. Rote Pfeile zeigen in cm, wie viel noch über der Solltiefe liegt.
Die **Automatik** (Upgrade) fährt auf die Solltiefe, **Echolot** macht die Peilung genauer. Verstopft ein Fremdstoff die Pumpe, startet das **Freispülen** (grüner Bereich, Leertaste).

## Aufbau
| Pfad | Zweck |
|---|---|
| `src/config.js` | Balance: Kosten, Schiffe, Fracht, Upgrades, Levels – hier drehen |
| `src/sim/river.js` | Flusssohle-Raster: Baggern (massenerhaltend), Nachrutschen, Verlandung, Hochwasser |
| `src/sim/fairway.js` | Fahrrinnen-Analyse je Schiffsklasse (Dijkstra), Gegenverkehr, Pfade |
| `src/sim/slice.js` | Querschnitt: Pumpe, Kette, Automatik, Fremdstoffe, Freispülen |
| `src/sim/dredge.js` | Ponton-Sitzung: Karte und Querschnitt, Trübung |
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
Gespeichert werden Geld, Zeit, Upgrades, Markt, Schiffe, Aufträge und die Flusssohle; die laufende Pontonfahrt nicht. Rekorde je Level stehen unter `dredging.levels`.

## Ideen für später
Tauchdrohne für Peilung und Abnahme, Kran-Minispiel für Wracks, Schleusen und Häfen als eigene Stationen, Kosten für Verklappung im Fluss, Jahreszeiten (Pegelkurve), weitere Flüsse.
