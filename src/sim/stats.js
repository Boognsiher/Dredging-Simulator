import { BASE_STATS, UPGRADES } from '../config.js';

// Leitet die aktuellen Werte aus den Upgrade-Stufen ab.
export function computeStats(levels = {}) {
  const s = { ...BASE_STATS };
  for (const [id, def] of Object.entries(UPGRADES)) def.apply(s, levels[id] ?? 0);
  return s;
}

export function upgradeCost(id, level) {
  const def = UPGRADES[id];
  return Math.round((def.baseCost * def.growth ** level) / 100) * 100;
}
