// Spielfeldgrösse (reine Rechnung, ohne DOM): das Feld füllt die verfügbare Fläche, behält sein Seitenverhältnis
// und wird höchstens um maxScale vergrössert. Gerendert wird in der passenden Auflösung (scharf auf grossen und Retina-Bildschirmen).
export function fitSize(availW, availH, logicalW, logicalH, maxScale = 3) {
  const w = Math.max(1, Math.min(availW, (availH * logicalW) / logicalH, logicalW * maxScale));
  return { w, h: (w * logicalH) / logicalW };
}

// Render-Faktor: ganze Canvas-Pixel pro logischer Einheit (1 bis maxQ). Ganzzahlig, damit die Zellen auf ganzen Pixeln liegen
// (keine Gitternähte) und Linien und Schrift scharf bleiben; der Browser skaliert das Bild dann auf die Anzeigegrösse.
export function renderQuality(dpr, cssWidth, logicalW, maxQ = 3) {
  return Math.max(1, Math.min(maxQ, Math.ceil((dpr || 1) * (cssWidth / logicalW) - 1e-6)));
}
