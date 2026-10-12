// Kalender: der Spieltag zählt als Datum ab dem 1. März 2010 (365-Tage-Jahre, ohne Schaltjahr). Jahreszeiten steuern Aussehen, Wasserstand und Verkehr.
// REAL_EVENTS: Hoch- und Niedrigwasser, angelehnt an reale Ereignisse am Rhein seit 2010 (Zeitpunkt und Stärke sind Näherungen aus dem Gedächtnis, keine Messdaten).
export const START_YEAR = 2010, START_DOY = 59; // 59 = 1. März (0-basiert: Jan 31 + Feb 28)
const ML = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const SEASON_NAME = { winter: 'Winter', spring: 'Frühling', summer: 'Sommer', autumn: 'Herbst' };
export const SEASON_ICON = { winter: '❄️', spring: '🌱', summer: '☀️', autumn: '🍂' };
const CUM = ML.reduce((a, d, i) => (a.push((a[i - 1] ?? 0) + (i ? ML[i - 1] : 0)), a), []).map((v, i) => ML.slice(0, i).reduce((x, y) => x + y, 0));

export function dateOf(day) {
  const n = START_DOY + Math.max(0, Math.floor(day) - 1), year = START_YEAR + Math.floor(n / 365), doy = n % 365;
  let month = 11; for (let i = 0; i < 12; i++) if (doy < CUM[i] + ML[i]) { month = i; break; }
  const dom = doy - CUM[month] + 1, season = seasonOf(doy);
  return { year, doy, month, dom, season, label: `${dom}. ${MONTHS[month]} ${year}` };
}
export const seasonOf = (doy) => (doy >= 334 || doy < 59 ? 'winter' : doy < 151 ? 'spring' : doy < 243 ? 'summer' : 'autumn');
// Spieltag (1-basiert) eines Datums
export const dayOfDate = (year, month1, dom) => (year - START_YEAR) * 365 + CUM[month1 - 1] + dom - 1 - START_DOY + 1;

const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
// Aussehen im Jahreslauf (0..1): Schnee (Dez bis Anfang März), Herbstfarben (Ende Sep bis Ende Nov), Frühlingsblüte (April)
export function seasonLook(doy) {
  const wd = doy >= 334 ? doy - 365 : doy; // Winter: -31 (1. Dez) bis 58
  const snow = wd >= -31 && wd < 68 ? Math.min(ramp(wd, -31, -12), 1 - ramp(wd, 45, 68)) : 0;
  const autumn = Math.min(ramp(doy, 262, 290), 1 - ramp(doy, 318, 338));
  const spring = Math.max(0, 1 - Math.abs(doy - 110) / 22);
  return { snow: Math.max(0, snow), autumn: Math.max(0, autumn), spring };
}
// Jahreszeitlicher Wasserstand (m über Bezugspegel): hoch zur Schneeschmelze (Juni, Juli), niedrig im Spätherbst und Winter
export const waterSeason = (doy) => 0.3 * Math.sin((2 * Math.PI * (doy - 84)) / 365);
// Verkehr im Jahreslauf: Winter weniger (Eis, Kälte), Sommer mehr
export const trafficSeason = (season) => ({ winter: 0.8, spring: 1, summer: 1.1, autumn: 1 })[season] ?? 1;

// Reale Ereignisse (y, m, d = Beginn; days = Dauer in Spieltagen; flood: s = Stärke 0..1; drought: drop = Absenkung in m)
export const REAL_EVENTS = [
  { y: 2011, m: 1, d: 6, type: 'flood', days: 4, s: 0.85, name: 'Rhein-Hochwasser Januar 2011' },
  { y: 2011, m: 4, d: 10, type: 'drought', days: 14, drop: 0.45, name: 'Niedrigwasser Frühjahr 2011' },
  { y: 2011, m: 11, d: 20, type: 'drought', days: 20, drop: 0.55, name: 'Niedrigwasser Herbst 2011' },
  { y: 2013, m: 6, d: 2, type: 'flood', days: 7, s: 1.0, name: 'Juni-Hochwasser 2013' },
  { y: 2015, m: 8, d: 10, type: 'drought', days: 20, drop: 0.5, name: 'Niedrigwasser Sommer 2015' },
  { y: 2016, m: 6, d: 1, type: 'flood', days: 5, s: 0.7, name: 'Hochwasser Frühsommer 2016' },
  { y: 2018, m: 1, d: 22, type: 'flood', days: 6, s: 0.9, name: 'Rhein-Hochwasser Januar 2018' },
  { y: 2018, m: 7, d: 20, type: 'drought', days: 30, drop: 0.5, name: 'Dürresommer 2018' },
  { y: 2018, m: 10, d: 1, type: 'drought', days: 45, drop: 0.75, name: 'Rekord-Niedrigwasser Herbst 2018' },
  { y: 2019, m: 9, d: 15, type: 'drought', days: 35, drop: 0.5, name: 'Niedrigwasser Herbst 2019' },
  { y: 2020, m: 4, d: 15, type: 'drought', days: 20, drop: 0.35, name: 'Niedrigwasser Frühjahr 2020' },
  { y: 2021, m: 7, d: 14, type: 'flood', days: 6, s: 0.9, name: 'Hochwasser Juli 2021' },
  { y: 2022, m: 8, d: 1, type: 'drought', days: 30, drop: 0.65, name: 'Niedrigwasser Sommer 2022' },
  { y: 2022, m: 10, d: 10, type: 'drought', days: 20, drop: 0.5, name: 'Niedrigwasser Herbst 2022' },
  { y: 2023, m: 9, d: 20, type: 'drought', days: 25, drop: 0.4, name: 'Niedrigwasser Herbst 2023' },
  { y: 2023, m: 12, d: 26, type: 'flood', days: 8, s: 0.85, name: 'Weihnachts-Hochwasser 2023' },
  { y: 2024, m: 6, d: 2, type: 'flood', days: 6, s: 0.9, name: 'Juni-Hochwasser 2024' },
].map((e) => ({ ...e, day: dayOfDate(e.y, e.m, e.d) }));
export const LAST_REAL_YEAR = 2024;
export const realEventOn = (day) => REAL_EVENTS.find((e) => e.day === day) ?? null;
