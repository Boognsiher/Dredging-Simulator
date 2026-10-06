// Steuerungsanzeige je Ansicht und Gerät: [Taste oder Geste, Wirkung]
export const HINTS = {
  keys: {
    map: [['WASD / Pfeile', 'Ponton fahren'], ['Maus halten', 'zum Mauszeiger fahren'], ['E / Leertaste', 'Anker werfen'], ['T', 'Aufläufer freischleppen'], ['K', 'Kreuzungsstellen setzen'], ['V', 'Gerät wählen'], ['1–5', 'Schiffsklasse wählen (rote Stellen = Engstellen)'], ['P', 'Pause']],
    slice: [['A D', 'Pumpe quer zum Fluss'], ['W S', 'Kette hoch/runter'], ['Leertaste', 'Pumpe an/aus'], ['Z X', 'Tempo'], ['F G', 'Solltiefe'], ['1–5', 'Solltiefe für Klasse'], ['T', 'Automatik'], ['V', 'Gerät: Saugkopf/Löffel/Beton'], ['R', 'Automatik-Reset'], ['Q', 'zurück zur Karte'], ['P', 'Pause']],
    tow: [['Leertaste halten', 'Zug aufbauen'], ['loslassen', 'Zug sinkt'], ['grüner Bereich', 'Schiff kommt frei'], ['Q', 'abbrechen']],
  },
  touch: {
    map: [['Stick', 'Ponton fahren'], ['Tipp auf die Karte', 'hinfahren und ankern'], ['Knopf', 'Anker werfen'], ['Klassen oben', 'Engstellen anzeigen']],
    tow: [['Knopf halten', 'Zug aufbauen'], ['loslassen', 'Zug sinkt'], ['grüner Bereich', 'Schiff kommt frei']],
    slice: [['Pfeile', 'Pumpe fahren (halten)'], ['Knopf', 'Pumpe an/aus'], ['Regler', 'Tempo und Solltiefe'], ['Klassen oben', 'Solltiefe für Klasse'], ['Knöpfe unten', 'Automatik, Gerät, zurück zur Karte']],
  },
};
export const hintsFor = (mode, touch) => HINTS[touch ? 'touch' : 'keys'][mode] ?? [];
