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
- **Mehr Schiffe:** In einer Einbahnrinne fahren Schiffe nur in eine Richtung (Wechselverkehr, Wartezeit). Erst zwei getrennte Rinnen (⇄) erlauben Gegenverkehr. **Beide Rinnen werden wirklich befahren:** bei zwei Rinnen (⇄) fährt Richtung flussabwärts standardmässig die Hauptrinne, flussaufwärts die zweite (orange). Ist die eigene Spur an der Einfahrt belegt und fährt auf der anderen Spur kein Gegenverkehr, weicht das Schiff dorthin aus: bei einseitigem Andrang (lange Warteschlange auf einer Seite) fahren also beide Rinnen in dieselbe Richtung und der Durchsatz verdoppelt sich. Liegt ein Ponton in einer der Rinnen, gilt wieder Einbahnbetrieb.
  Wer warten muss, dreht nach einer Weile ab: die Fracht geht auf die Bahn (entgangene Einnahmen). Betonnung, Verkehrsleitsystem und Lotsendienst steigern Verkehr und Einnahmen.
- **Wirtschaft:** Pro Schiff gibt es eine **Gebühr** plus `levy` (1,5 %) vom **Frachtwert**. Frachtpreise schwanken (Mean-Reversion + Ereignisse wie Ölschock, Missernte, Bauboom);
  hohe Preise locken mehr Schiffe dieser Fracht an. Reedereien bieten **Frachtaufträge** (X Tonnen bis zum Termin: Prämie, sonst Konventionalstrafe).
- **Baggergut:** Die Anlage an Land sortiert den Puffer nach Material: Kies und Sand (Marktpreis!) und Fels bringen Geld, Schlick und Altlasten kosten Entsorgung. Sortieranlage und
  Entwässerung verbessern das, die Aufbereitungsanlage den Durchsatz. Der Durchsatz steigt überproportional (Start 8 m³/s, Stufe 6: 29 m³/s, Stufe 12: 68 m³/s, Stufe 24: 200 m³/s, Puffer 160 → 1 600 m³ bei Stufe 12 und 4 300 m³ bei Stufe 24), damit auch eine Flotte mit mehreren Pontons nachkommt. Ist der Puffer voll, muss die Pumpe pausieren. Dazu zahlt die Verwaltung ein **Baggerentgelt** pro m³ aus dem Korridor.
- **Fluss lebt:** Böschungen **rutschen nach** (schmal und tief baggern füllt sich wieder auf), der Fluss **verlandet** (langsames Wasser am Rand, Hochwasser lagert Schlick ab),
  **Niedrigwasser** nimmt Tiefe (Schiffe können auflaufen: Bergung kostet, Rinne blockiert), **Hochwasser** sperrt die Schifffahrt. **Fels** (Felsriegel) lässt sich ohne Felsfräse kaum
  abtragen. Ufer und Flachwasser sind **Naturschutzzone** (Busse pro m³). Ein Ponton in der Rinne bremst den Verkehr (Baustelle).
- **Löffelbagger (Schaufeln):** Upgrade «Löffelbagger», im Querschnitt mit `V` oder dem Knopf «Gerät» umschaltbar. Er ist langsamer als der Saugbagger, verstopft aber nie
  (Fremdstoffe hebt er einfach aus, nur Bomben bleiben ein Problem), schafft harte Schichten und Fels besser, trübt wenig.
- **Land abtragen:** Der Löffel reicht über den Wasserspiegel. Das Ufer im **gelben Ausbaustreifen** (Karte) lässt sich abgraben, das kostet nur eine Landgebühr
  (`pay.landFee`) statt Busse. Liegt das Land unter Wasser, wird es zum Baggerkorridor: der Fluss wird breiter (mehr Platz für grosse Schiffe und Gegenverkehr). Das Material kommt in den Puffer
  (Aushub wird als Sand verwertet). Ausserhalb des Streifens gilt Schutzgebiet. Böschungen rutschen auch hier nach.
- **Flotte:** Mit der Automatik (Stufe 1 und höher) kannst du bis zu vier **Pontons mieten** (Panel «Flotte», Kosten steigen, Löhne pro Tag). Sie fahren selbstständig zur nächsten Engstelle des
  **Ausbauziels** (Klasse wählbar, Standard: die kleinste, die noch nicht fährt), ankern, baggern per Automatik auf Solltiefe (bei Fels mit dem Löffel, wenn vorhanden) und suchen danach die nächste Stelle.
  Du musst den Querschnitt nicht mehr öffnen; dein eigener Ponton bleibt frei steuerbar. Pontons ohne Arbeit melden, was fehlt (z. B. «Fels im Weg»). Ankernde Pontons bremsen den Verkehr.
- **Freischaltung:** Reedereien schicken nur Schiffe, die gerade durch die Rinne passen. Eine neue Klasse schaltet sich frei, sobald für sie zum ersten Mal eine Rinne frei ist (Meldung); verlandet die Rinne wieder, bleiben die Schiffe aus («⚠ gesperrt» in der Klassenleiste) und kommen erst nach dem Nachbaggern zurück.
- **Warteplatz:** An jedem Ende wartet anfangs **ein** Schiff; weitere drehen ab (entgangener Verdienst). **Rotlichter** (Signalanlage) und **Schlepper** bauen den Warteplatz um je ein Schiff pro Stufe aus.
- **Kreuzungsstellen:** Auf der Karte (Knopf oder `K`) lassen sich Zonen **planen** (3000 CHF), auch wo noch nicht genug Platz ist: Jede Spalte zeigt grün (Platz da) oder gelb bis orange (so viel fehlt), unter der Maus steht der fehlende Aushub in m³, rot markiert die Zellen, die noch ausgetragen werden müssen. Gekreuzt wird erst, wenn **zwei Rinnen nebeneinander** (2 × Schiffsbreite + 1 Zelle, also 5 / 7 / 9 Zellen für Kahn und Motorschiff / Tanker und Container / Schubverband, durchgehend tief genug, 3 Spalten breit) da sind. Die Flotte baut geplante Stellen aus. Die Klasse, für die geplant wird, ist wählbar. In der Einbahnrinne warten sich Schiffe dort ab: das zuerst eingetroffene wartet in der Zone, bis das Gegenschiff eintrifft, dann fahren sie aneinander vorbei. Eine Einfahrt gegen den Verkehr ist nur erlaubt, wenn eine freie Kreuzungsstelle dazwischen liegt. Eine ist erlaubt, jede Stufe Rotlichter erlaubt eine weitere. Sind mehr Pontons oder Aufläufer im Weg, bleibt es bei Wartezeit.
- **Schlepper:** Beschleunigen Schiffe ab 2,6 m Tiefgang um 12 % je Stufe und halten sie im Warteplatz. **Auf Stufe 3** schleppen sie aufgelaufene Schiffe nach Ablauf der Wartezeit auch aus dem Flachen frei: das Schiff sinkt nicht, fährt weiter und ist geschützt: mindestens 5 s und bis es die Untiefe hinter sich hat (höchstens 25 s) (die Bergungskosten fallen trotzdem an).
- **Flotte betoniert:** Mit «Rinne betonieren» verhärten freie Flottenpontons (Betoniergerät und Beton im Lager nötig) die Rinne der höchsten fahrenden Klasse samt zwei Zeilen Böschung beiderseits. Fehlt der Beton, melden sie es und warten.
- **Rohstoffgebiete:** Im Flussbett liegen hochwertige Vorkommen (Kiesbank ×3, Quarzsand ×4,5, Erzseife ×9, goldgelb auf der Karte). Mit **Konzession** wird der Abbau der obersten ca. 1 bis 1,5 m sofort bar mit Preisaufschlag bezahlt, zusätzlich zu Baggerentgelt und Verkauf. Das erste Vorkommen gehört dir von Anfang an (so kommt das Geld früh), weitere müssen **erkundet** (1500 CHF) und per Konzession erworben werden (Panel «Rohstoffgebiete»). Freie Flottenpontons bauen Vorkommen mit Konzession selbst ab. **Leere Vorkommen verschwinden** (Rest unter 6 m³) von Karte und Panel; **mit der Zeit erscheinen neue** (täglich 22 % Chance, solange weniger als drei aktiv sind), sie sind sofort sichtbar und per Konzession kaufbar.
- **Altlasten:** Sie werden beim Start des Levels als Flecken gesetzt (Hochrhein 2, Loreley 3, Eisernes Tor 6, nahe der Flussmitte, nur auf Sediment) und neu, wenn ein **Schiff sinkt**: Kommt ein aufgelaufenes Schiff nicht frei, sinkt es je nach Fracht (Öl 80 %, Chemie 90 %, Kohle und Erz 30 %, Container 25 %, Getreide 20 %, Kies 15 %). Dann liegt ein hartes **Wrack** als Untiefe in der Rinne, Treibstoff, Öl oder Chemie machen den Boden ringsum zur Altlast, und es gibt eine Umweltbusse. Das Panel «Altlasten» zeigt Menge, Korridoranteil, Entsorgungskosten und was je Klasse in der Rinne liegt, auf der Karte steht ☢.
- **Land-Automatik:** In der Flotte lässt sich «Ufer verbreitern» einschalten (braucht den Löffelbagger, 1–5 Zeilen Breite wählbar). Der letzte gemietete Ponton baut dann selbstständig
  den Ausbaustreifen neben dem Korridor ab, bis die Tiefe der Ausbauklasse erreicht ist. So entstehen zusätzliche Korridorzellen für breitere Rinnen und Gegenverkehr. Das ist viel Material und dauert.
- **Beton:** Das Betoniergerät (Upgrade, `V` wechselt das Gerät) verhärtet die oberste Sedimentschicht von Boden und Seiten (Leertaste bringt Beton aus, Kosten: Betonvorrat).
  Verhärtete Zellen **verlanden kaum noch** (auch bei Hochwasser) und **rutschen nicht nach**. Wer später tiefer baggern will, muss den Beton **aufbrechen**: der Saugkopf schafft das fast nicht,
  der Löffelbagger schon (Bruch zählt als Fels und wird als Schotter verwertet). Die Flotte nimmt dafür den Löffel; ohne Löffel meldet sie «Beton im Weg».
  Beton wird anfangs **gekauft** (Panel «Beton», 110 CHF/m³). Mit dem **Betonwerk** (Anlage ausbauen) mischst du ihn selbst aus Kies und Sand des Flusses (die Anlage leitet sie ins Lager um, wenn der Haken gesetzt ist)
  plus Zement (38 CHF/m³): deutlich billiger.
- **Aufläufer-Minispiel:** Läuft ein Schiff auf Grund (Niedrigwasser, Verlandung), blockiert es die Rinne. Fährst du mit dem Ponton in seine Nähe (Karte: Ring um das Schiff) und startest
  «Aufläufer freischleppen» (`T` oder Knopf), kannst du es selbst freiziehen: (die Ansicht zeigt das Schiff im Seitenschnitt auf einem Felsen liegend, das beim Ziehen herunterrutscht und aufschwimmt) **Zugtaste halten** (Leertaste, am Handy der grosse Knopf), um Spannung aufzubauen, loslassen lässt sie sinken. Nur im **grünen Band** bewegt
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
Die **Automatik** (Upgrade) fährt auf die Solltiefe (verstopft die Pumpe, bleibt sie stehen und wartet 15 s – mit besserer Automatik 10 bzw. 5 s – oder du löst das Freispülen-Minispiel, das immer kommt); ihr **Arbeitsbereich** (von wo bis wo) wird mit zwei Linien im Querschnitt begrenzt: die Fähnchen oben mit Maus oder Finger ziehen. Ausserhalb wird der Querschnitt abgedunkelt, der Bereich gilt auch für die nächsten Verankerungen. **Naturschutzzonen** sind unter Wasser kräftig grün schraffiert, mit Leuchtband auf der Sohle, Grenzlinie und Beschriftung (Karte: grün gekachelt). **Echolot** macht die Peilung genauer. Verstopft ein Fremdstoff die Pumpe, startet das **Freispülen** (grüner Bereich, Leertaste).

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

**Trübungsbussen** hängen vom Ort des Saugkopfs ab: in der Durchfahrt (Rinne) praktisch vernachlässigbar, im Altlastenbereich normal, im Naturschutzgebiet sehr hoch (und schon bei geringerer Trübung). Die Anzeige neben dem Trübungsbalken nennt den aktuellen Bereich.

**Uferstreifen kaufen:** Im Panel «Uferstreifen» lassen sich die Naturschutz-Flachwasserstreifen abschnittsweise (Nord-/Südufer × Ober-/Mittel-/Unterlauf, 350 CHF pro Zelle) freikaufen. Sie werden zum Baggerkorridor (keine Schutzbussen), die Rinne kann dort breiter ausgebaggert werden.

## Hafen (neue Spielseite)
Taste `H` oder Knopf «🏗 Hafen» öffnet die Hafen-Seite (das Spiel läuft im Hintergrund weiter). Voraussetzung: Das Motorschiff hat die Rinne schon befahren. Dann:
- **Hafengelände erwerben** (30 000 CHF), danach bis zu 6 Bauplätze: **Kai & Verladestation** (Pflicht, nur einmal), **Kieslager**, **Tanklager** (je 3 Stufen) und **Sanierungsanlage** (spart 50–80 % der Altlast-Entsorgung). Dazu die **Aufbereitungshalle** (3 Stufen, nur einmal): Die Aufbereitungsanlage lässt sich ohne sie nur bis Stufe 6 ausbauen, jede Hallenstufe schaltet zwei weitere Stufen frei. Im **Endlos-Modus** hat jede Karte ihren eigenen Hafen und damit ihre eigene Halle; die Stufen **aller Hallen zählen zusammen** (3 Karten mit je Stufe 3: Anlage bis Stufe 24, Durchsatz dann ca. 200 m³/s). Ab Stufe 12 steigen die Preise nur noch linear (ca. 1,2 bis 4,7 Mio. CHF je Stufe).
- **Handel:** Kies und Öl kaufst du zum Marktpreis plus Spread und verkaufst sie minus Spread, von Hand oder per **Automatik** (kaufen unter X %, verkaufen ab Y % des Basispreises). Durchfahrende Schiffe mit passender Fracht laden bei hohem Preis aus deinem Lager und entladen bei tiefem Preis; der Kai kassiert eine Umschlaggebühr.
- Geplant: eigene Hallen, Reedereiverträge.
- **Verlade-Minispiel:** Fährt ein Schiff mit Kies oder Öl vorbei, entsteht am Kai ein Umschlagauftrag (Frist 40 s, höchstens 4 gleichzeitig). Die Mannschaft lädt langsam; du kannst selbst mit dem **Radlader** (14 t pro Treffer) oder, mit gebautem **Portalkran** (32 t pro Treffer, schnelleres Pendel), laden: Leertaste oder Knopf, wenn der Zeiger im grünen Bereich steht. Schnell fertig gibt einen Zeitbonus (bis ×3 Gebühr), zu spät nur die halbe Gebühr.
- **Gelände planieren:** Jeder Bauplatz ist zuerst unebenes Gelände (Raster 5×4, Höhen −3…+3). Mit der Baumaschine («🚜 Planieren») klickst du rote Zellen (zu hoch: abtragen, Ladung bis 4) und blaue Zellen (zu tief: auffüllen, mit Ladung, sonst Kies aus dem Lager oder 35 CHF Zukauf); auf ebene Zellen kippst du Ladung ab. Jede Aktion und jeder Weg kostet Zeit. Erst wenn alles eben ist, darfst du bauen. Alternativ mietest du eine Planierraupe (70 CHF je Höheneinheit, sofort fertig).

## Teilbeladung (Fortschritt in Stufen)
Jedes Schiff hat eine **Volllast-Tiefe** (Tiefgang + 0,3 m) und eine **Mindesttiefe** (0,3 m weniger, z. B. Motorschiff: voll bei 2,3 m, Minimum bei 2,0 m). Ab der Mindesttiefe fährt die Klasse schon, mit mindestens 30 % Ladung; je tiefer die engste Stelle der Rinne, desto mehr Fracht (linear bis 100 %). Darunter fährt das Schiff nicht. Es müssen immer nur die Abschnitte vertieft werden, an denen die günstigste Rinne zu flach ist: erst auf die Mindesttiefe (rot), dann für Volllast (gelb). Ladung und Gebühr der Schiffe skalieren mit der Beladung; die Anzeige in Klassenleiste und Panel zeigt «xx % Ladung» und was bis voll fehlt. Die Flotte vertieft die Rinne danach selbstständig bis zur Volllast-Tiefe. Das Spiel startet mit einer Rinne auf Mindesttiefe für die kleinste Klasse.

## Oberfläche
Im **Querschnitt** (Hochformat) liegt die Anzeige von Trübung, Puffer und offenen Zellen als schmale Leiste über dem Bild; Tempo und Solltiefe stehen kompakt in einer Zeile, das Bild darf näher an die Pumpe heranzoomen. Die **Ausrüstung** ist in Reiter geteilt (Pumpe, Geräte, Anlage, Verkehr); ein oranger Punkt am Reiter zeigt, wie viele Verbesserungen dort gerade bezahlbar sind.

**Trübung:** Sie entsteht nur, wenn der Saugkopf wirklich Material saugt: pro Sekunde `Pumpenleistung / 250 × Auslastung × Trübungsfaktor × (1 − Trübungsschutz)`, ×1,4 bei Bewegung, ×1,5 bei Altlast (Löffel 0,3, Beton 0,1). Sie klingt exponentiell ab (8 % des Werts pro Sekunde). Das Gleichgewicht liegt bei Leistung 10 etwa bei 25 % (stehend) bzw. 35 % (in Fahrt); stärkere Pumpen brauchen den Trübungsschutz. Die Busse hängt vom Ort ab (Rinne kaum, Altlast normal, Naturschutz sehr hoch).

**Kreuzungsstellen:** Zwei Schiffe kreuzen nur, wenn ihre beiden Spuren (talwärts oben, bergwärts unten, je `beam` Zeilen, mit einer Zeile Abstand) in allen drei Spalten der Stelle tief genug sind; sonst wird die Stelle für dieses Paar nicht benutzt (z. B. Tanker + Kahn brauchen 3 + 1 + 2 = 6 Zeilen). In der Stelle wechseln die Schiffe sichtbar auf ihre Spur.

Hinweis: Die frühere Schieflage (Umkippen der Pumpe) und das Upgrade «Pumpen-Ballast» sind entfernt.

## Arbeitsgebiete und Hafenbecken (Karte)
- **Menü in Reitern mit Stufensystem:** Das Menü hat Reiter statt einer langen Liste: 🏠 Ziel (Verkehrsziel, Anlage, Journal), 🌊 Fluss (Wasserstrasse, Verkehr, Altlasten, Rohstoffgebiete, Uferstreifen), ⚙ Technik (Ausrüstung, Beton), 🚤 Flotte, 💰 Handel, 🗺 Karten (nur Endlos), ☰ Mehr (Steuerung, Spielstand, Pause, Ton). Bereiche schalten sich **nach und nach frei**, damit es am Anfang nicht überladen ist: Technik-Unterreiter Anlage und Geräte nach ca. 200 m³ gebaggert, Handel nach 150 m³, Altlasten nach 300 m³, Rohstoffgebiete ab Tag 3 oder 400 m³, Verkehr nach 3 Schiffen, Uferstreifen nach 800 m³, Flotte mit der Automatik (oder nach 600 m³). Eine Meldung «Neu freigeschaltet» und ein oranger Punkt am Reiter zeigen es an; einmal freigeschaltet bleibt es offen (wird mitgespeichert).
- **Aufgelaufene Schiffe:** Solange irgendwo (auch auf einer anderen Karte) ein Schiff aufgelaufen ist, steht dauerhaft der Knopf **«📍 Zum Aufläufer»** unter der Karte (er verschwindet, wenn du schon in Reichweite bist). Die Meldung nennt Karte und Spalte und hat einen Knopf **«📍 Zum Schiff»** (12 s sichtbar): er wechselt bei Bedarf die Karte und setzt deinen Ponton neben das Schiff, danach startet «Schleppen» (`T`) das Freiziehen. Die Wartezeit bis zum Abschleppen beträgt immer 40 s (unabhängig von Upgrades) und läuft nicht ab, solange du das Schiff schleppst (Minispiel 30 s).
- **Spielstand sichern und laden:** Im Menü unter «Spielstand sichern & laden» exportierst du den Spielstand als Datei oder in die Zwischenablage und importierst ihn wieder (z. B. für den Wechsel zwischen Handy und PC oder zum Weitergeben bei Fehlern).
- **Baggerroute:** Neben Rechtecken zeichnest du eine **Route** (Knopf «〰 Route» oder `N`): Wegpunkte antippen, den letzten nochmals antippen oder «Route: fertig». Die Linie bekommt eine Breite (Standard: Breite der Ziel-Klasse, im Panel «schmaler/breiter») und eine Tiefe; die gemieteten Pontons baggern alle Zellen entlang der Linie aus, auch Ufer und Land im Ausbaustreifen (braucht den Löffelbagger). Nicht abbaubares Land (Hochufer) bleibt stehen, die Meldung nennt die Zahl der Zellen. Routen teilen sich mit den Gebieten die 4 Plätze.
- **Rohstoffgebiete auf der Karte:** ohne Beschriftung, je Art eine Farbe (Kiesbank sandgelb, Quarzsand hellblau, Erzseife orange); kräftig mit Konzession, blass und gestrichelt ohne. Details stehen im Panel.
- **Kreuzungen mit Vorrang:** Im Reiter Fluss (Verkehr) kannst du jeder Kreuzungsstelle ein bestimmtes Ponton zuteilen («⚡ Vorrang»). Dieses Ponton baut die Stelle vor allem anderen aus, bricht seine bisherige Arbeit sofort ab und macht sonst nichts, bis sie fertig ist (steht sie still, sagt die Notiz warum, z. B. «Löffelbagger fehlt»). Andere Pontons lassen eine zugeteilte Stelle in Ruhe.
- **Schnellknopf Flotte:** Mit «🧑‍✈️ Zur Flotte» (`J`, ab der Automatik) teilst du deinen eigenen Ponton der Flotte zu, mit «↩ Aus Flotte nehmen» steuerst du ihn wieder selbst (er steht dann dort, wo er gerade arbeitet). Freigeschleppte Schiffe (durch dich oder durch Schlepper Stufe 3) fahren mindestens 5 s und über die Untiefe hinweg (höchstens 25 s), bevor sie wieder auflaufen können.
- **Liegeplätze im Hafen:** Der Kai hat Liegeplätze (Stufe 1: 2, Stufe 2: 3, Stufe 3: 5, im Hafen ausbaubar). Ein Schiff mit passender Fracht (Kies, Öl, Container) steuert den Hafen nur an, wenn beim Einfahren in die Rinne ein Liegeplatz frei ist; der Platz wird dann für das Schiff **reserviert**. Ist alles belegt oder reserviert, fährt es ohne Stopp vorbei (kein Stau). Beim Hafen biegt es ins Becken ab und legt an (klein gezeichnet), steht also nicht im Fahrwasser; jeder Liegeplatz hat seine Mannschaft, das Minispiel beschleunigt den ersten angelegten Auftrag. Nach dem Verladen fährt das Schiff weiter. Fällt ein Schiff vorher aus (aufgelaufen, gesunken), verfällt die Reservierung.
- **Wegfindung:** Pontons suchen ihren Weg über befahrbare Zellen (mind. 0,8 m Wasser) und kommen so auch über die Kante zwischen Rinne und flacherem Wasser. Gibt es keinen Weg zur Stelle, überspringen sie sie («kein Weg zur Stelle») und nehmen die nächste.
- **Änderungen wirken sofort:** Ändert du Arbeitsgebiete (anlegen, löschen, Tiefe, Zuteilung), Ziel-Klasse, Meiden-Optionen, Ufer verbreitern, Rohstoffabbau oder Betonieren, brechen arbeitende und anfahrende Pontons ab und wählen neu.
- **Arbeitsgebiet vorgeben:** Auf der Karte `G` oder «▭ Arbeitsgebiet» (braucht die Automatik), dann zwei Ecken antippen. Gemietete Pontons baggern das Rechteck (Baggerkorridor; das Ufer im Ausbaustreifen erst, wenn das Wasser im Gebiet die Tiefe hat und «Ufer verbreitern» mit Löffelbagger an ist) auf die Gebietstiefe, bevor sie andere Stellen suchen. Im Panel «Flotte» stellst du je Gebiet die Tiefe ein, wählst «alle Pontons» oder ein bestimmtes Ponton und löschst Gebiete (höchstens 4).
- **Eigener Hafen auf der Karte:** Das Hafenbecken ist eine flache Bucht am Ufer (⚓ Hafen, mit Kaimauer). Die Bucht ist gelb markiert, bis 80 % davon die Zieltiefe (2,3 m) erreichen. Schiffe legen nur an, wenn das Becken tief genug für ihre Klasse ist; dafür vertiefst du die Bucht wie jede Rinne (Ponton dort ankern, ausbaggern). Das Becken zählt nicht zur Fahrrinne der Schiffe.

## Oberfläche: Kartenvollbild und Menü
Auf dem Rechner und auf dem Handy **quer** füllt die **Karte den ganzen Bildschirm** (Handy hochkant bleibt das bisherige Layout: Karte oben, Bedienung unten, Panel als Schublade am unteren Rand). Oben liegt das Dashboard: Kopfzeile (Tag, Geld, Fracht, Pegel, Puffer, Schiffe) und **eine** Schiffsklasse (antippen schaltet zur nächsten um, die Karte zeigt deren Engstellen); die Aktionsknöpfe (Anker, Hafen, Kreuzungsstellen, Gebiet, Ton) stehen nebeneinander am unteren Rand. Das **Menü** (☰ oder `Tab`) ist das frühere Seitenpanel und fährt von rechts herein (Wasserstrasse, Ausrüstung, Flotte, Markt, Journal, Steuerung und Legende); schliessen mit ✕, Esc, `Tab` oder Tippen neben das Menü. Auf schmalen Bildschirmen (Querformat) ist die Karte bis 2,1-fach vergrössert und folgt dem Ponton; sonst ist die ganze Karte sichtbar. Der **Querschnitt (Saugen)** behält sein bisheriges Layout.

## Endlos-Modus (Zufallskarten, mehrere Engstellen)
Im Levelmenü gibt es unten **«♾ Endlos: Flussnetz»**: Du gibst eine **Seed-Nummer** ein (🎲 = Zufall); gleicher Seed = gleiche Karten. Du startest wie am Hochrhein (Kähne fahren schon, Rest ausbaggern) und hast **weder Ziel noch Frist**; verloren ist das Spiel nur bei Pleite.
- **Weitere Karten:** Im Menü unter «Karten» erschliesst du weitere Engstellen (bis 6, Kosten 45 000 → 380 000 CHF). Jede Karte ist ein eigener Fluss, schwerer als die vorige (schmaler, mehr Fels, Altlasten, Fremdstoffe), mit **eigenem Verkehr, eigener Flotte, eigenen Arbeitsgebieten und Kreuzungsstellen**. Alle Karten laufen im Hintergrund weiter; Geld, Aufbereitungsanlage, Ausrüstung, Markt und Aufträge sind gemeinsam.
- **Wechseln:** Auswahlfeld in der Kopfzeile, Liste im Menü oder `,` / `.` auf der Karte. Der Hafen steht an der ersten Karte.
- Ereignisse (Hochwasser, Funde ...) treffen eine zufällige Karte. Der Spielstand speichert alle Karten (ältere Spielstände laden weiter und werden zu «Karte 1»).

## Handel zwischen den Karten, eigene Reederei (Endlos)
- **Regionale Märkte:** Jede Karte hat einen eigenen Frachtmarkt (Preise schwanken getrennt, dazu ein dauerhafter regionaler Aufschlag/Abschlag bei Kies und Öl), einen **eigenen Hafen** (Hafengelände, Kai, Lager, Hafenbecken) und eigene Zwischenlager (Kies- und Tanklager, bis Stufe 3 ausbaubar). Die Aufbereitungsanlage verkauft zu den Preisen der ersten Karte; die beste Sanierungsanlage aller Karten zählt.
- **Reederei:** Im Menü («Reederei», ab der zweiten Karte) kaufst du Frachter (Frachtkahn 45 000 CHF/240 t Kies, Motorfrachter 110 000/640 t Kies, Tankschiff 200 000/560 t Öl), höchstens 6. Pro Schiff wählst du Start- und Zielkarte; es kauft im Starthafen ein (oder nimmt Ware aus dem Lager), fährt (1 + 0,6 Tage je Kartenschritt), und verkauft im Zielhafen oder lagert dort ein. Beide Häfen brauchen Kai, Lager und ein ausreichend tiefes Hafenbecken, und die Rinne muss auf beiden Karten für die Klasse befahrbar sein. Unterhalt läuft täglich (im Hafen 40 %).
- **Fahrrinne und Fracht:** Die erlaubte Ladung ist die Teilbeladung der schlechteren der beiden Rinnen (30–100 %). Bei Niedrigwasser oder flacher Rinne wird weniger geladen, die **Fracht je Tonne steigt**. Die Anzeige zeigt Ladung, Fracht, Kauf- und Verkaufspreis und die Marge je Tonne (rot = Verlust).
- **Flotte schonen:** Im Panel «Flotte» lässt sich einstellen, dass die gemieteten Pontons **Naturschutzzonen** (Flachwasser am Ufer) und **Altlastenbereiche** nicht abtragen (Rinne, Gebiete, Ufer, Kreuzungsstellen).

**Container:** Neben Kies und Öl gibt es Containerfracht. Im Hafen baust du ein **Containerterminal** (32 000 CHF, 3 Stufen, 300 / 800 / 1 800 t Lager); durchfahrende Containerschiffe erzeugen dort Umschlagaufträge (Minispiel). In der Reederei gibt es das **Containerschiff** (380 000 CHF, 1 000 t, braucht eine tiefe Rinne und ein tiefes Hafenbecken). Container haben je Karte eigene Preise wie Kies und Öl.

**Grössere Karte:** Die Karte hat jetzt 36 statt 24 Zeilen: der Fluss bleibt gleich, beiderseits liegt mehr Land (Platz für Hafen und später Strassen und Lager). Im Hochformat wird die Karte dadurch höher, im Vollbild folgt sie dem Ponton auch in der Höhe. Spielstände von vorher (Version 5/6) lassen sich wegen der neuen Kartengrösse nicht mehr laden.

## Landseite des Hafens: Strassen und Lagerhallen
Im Kartenvollbild öffnet `L` (Knopf «🛣 Land», sobald das Hafengelände erworben ist) die Baugerätschaft für die Landseite des Hafens, je Karte:
- **Strassen** (350 CHF je Zelle) nur auf Land. Eine Strasse ist **angebunden**, wenn sie über Nachbarzellen ans Hafenbecken anschliesst. Jede angebundene Strassenzelle beschleunigt den Umschlag der Mannschaft um 5 % (höchstens +80 %).
- **Lagerhallen** (2×2 Zellen, 9 000 CHF plus Erdarbeiten: das Gelände wird eingeebnet, 400 CHF je m Höhenunterschied und Zelle, 2 Ausbaustufen 14 000 / 26 000 CHF). Nur **angebundene** Hallen zählen: sie erweitern die Zwischenlager für Container (300 / 700 / 1 500 t) und Kies (200 / 500 / 1 100 t).
- **Strasse automatisch:** Halle antippen, der kürzeste Weg über freies Land zum Hafenbecken wird gebaut. **Abriss** entfernt Strassen und Hallen. Das Hafen-Panel zeigt Strassen, Anbindung, Umschlagsfaktor und Hallen mit Ausbau.
- **Hafenzone:** Das Flachwasser (Naturschutz) neben dem Hafenbecken gehört zur Hafenzone: dort gibt es beim Baggern keine Schutzbusse. Weitere Schutzstreifen lassen sich weiter getrennt unter «Uferstreifen» kaufen.

**Zweite Fahrrinne und Kreuzungsmöglichkeit auf der Karte:** Für die gewählte Schiffsklasse zeigt die Karte neben der besten Rinne (weiss/grün gestrichelt) eine existierende **zweite, getrennte Rinne in Orange** («2. Rinne», Gegenverkehr ohne Warten). Limegrüne Marken über der Rinne zeigen die Spalten, in denen zwei Rinnen nebeneinander Platz hätten (Kreuzung möglich). Die Legende erklärt beide.

## Handel: Balance, Marktwirkung, Mindestmarge, Rückfracht
- **Marktwirkung:** Grosse Käufe treiben den Preis der Karte hoch, grosse Verkäufe drücken ihn (je 1 000 t: Kies 12 %, Öl 5 %, Container 4 %); die Abweichung klingt täglich um 10 % ab. Eine Route sättigt sich, wenn man sie zu oft fährt. Der Hafen-Spread beträgt 5 % je Seite.
- **Regionale Preise** (Endlos): dauerhafter Aufschlag/Abschlag je Karte (Kies ±40 %, Öl ±25 %, Container ±30 %). Je grösser der Unterschied zwischen zwei Karten, desto besser die Route.
- **Mindestmarge:** Jedes Schiff fährt nur, wenn die erwartete Marge (Verkaufs- minus Einkaufspreis minus Fracht) mindestens den eingestellten Wert hat (Standard 1 CHF/t); sonst wartet es auf bessere Preise. **Rückfracht** (an): auf der Rückfahrt lädt es in Gegenrichtung, wenn sich das lohnt.
- **Richtwerte der Schiffe** (Kauf / Unterhalt je Tag): Frachtkahn 28 000 / 120, Motorfrachter 70 000 / 260, Tankschiff 200 000 / 700, Containerschiff 260 000 / 900 CHF. Kies bringt wenig, Öl am meisten, Container hängt stark von den Preisunterschieden ab. Im Test (2 Karten, 10 Seeds, 120 Tage) lag der Gewinn nach Unterhalt bei Öl im Median bei rund 1 200 CHF/Tag, bei Kies unter 100 CHF/Tag; mit mehr Karten findest du bessere Paare.
- **Hafenbecken:** verlandet langsam (¼ des normalen Tempos) und hat Spundwände (kein Nachrutschen der Böschung).
- **Eigenen Ponton zuteilen:** Im Panel «Flotte» → «Meinen Ponton der Flotte zuteilen» (braucht Automatik): dein Ponton arbeitet dann wie ein gemieteter (ohne Lohn, zählt nicht zur Flottengrösse) und folgt den Flotteneinstellungen. Ankern ist gesperrt, bis du ihn zurückrufst.

## Als App installieren (PWA) und Hosting
Das Spiel ist eine **Progressive Web App**: Manifest (`manifest.webmanifest`), Symbole (`icons/`) und Service Worker (`sw.js`). Über HTTPS (oder `localhost`) bietet der Browser «Zum Startbildschirm hinzufügen» / «App installieren» an; danach startet das Spiel im eigenen Fenster ohne Adressleiste und **läuft offline** (alle einmal geladenen Dateien liegen im Cache; online zuerst die neueste Version, offline die letzte Kopie). Das Layout ist responsiv (Handy hochkant/quer, Tablet, Rechner). Der Spielstand bleibt im Browser des Geräts (`localStorage`).
- **Hosting auf dem NAS:** `index.html`, `style.css`, `manifest.webmanifest`, `sw.js`, `icons/` und `src/` in einen Webordner kopieren (oder nur `dist/fahrrinne-frei.html`, die ohne Installation und ohne Service Worker auch per Doppelklick läuft). Für die Installation als App braucht der Browser HTTPS (z. B. Reverse Proxy mit Zertifikat) oder einen Zugriff über `localhost`.
- **Beim Aktualisieren:** Dateien ersetzen; der Service Worker holt online immer die neueste Version. Ändert sich die Cache-Liste, `CACHE` in `sw.js` hochzählen.

## Stau-Preise und Containerpreise
- **Stau:** Bei **Niedrigwasser** (Pegel unter Normal), **gesperrter Rinne** (freigeschaltete Klassen fahren nicht mehr) oder **Hochwasser-Sperre** sinken die Preise der Waren auf der betroffenen Karte um bis zu 30 % (Hochwasser-Sperre 30 %, Niedrigwasser bis 25 %, gesperrte Rinne bis 20 %), und erholen sich, sobald die Schiffe wieder fahren. Günstig einkaufen und im Hafenlager einlagern (Auto-Handel: «kaufen unter x %»). Das Markt-Panel weist auf den Stau hin.
- **Container:** Containerschiff jetzt 220 000 CHF, 800 t, 700 CHF Unterhalt je Tag; Tankschiff 220 000 / 800.
