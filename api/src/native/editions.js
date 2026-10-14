// Editions limitees (2026-10-15) : une "finition" de plus, posee PAR-DESSUS
// la finition classique (Pulls.Edition) pour ne rien casser de l'echelle
// holo -> arc-en-ciel (decraft, amelioration, coffre...). Une par mode de jeu
// et une par evenement saisonnier (seasonal.js) ; Fantome pour la carte du
// mois (phantom.js). A l'ouverture d'un booster, chaque carte a une petite
// chance de porter l'edition en cours (celle de l'evenement en priorite).
// Une carte en edition limitee n'est jamais usee (Hard) ni sacrifiee
// automatiquement (salle des machines).

import { refId } from './common.js';
import { setting } from './settings.js';
import { currentMode } from './presets.js';
import { currentSeason } from './seasonal.js';
import { addFeed } from './feed.js';

export const schema = { Pulls: { Edition: { type: 'Text' } } };

export const EDITIONS = {
  // Modes de jeu
  frost: { label: 'Givrée', icon: '❄️', mode: 'cool' },
  tropical: { label: 'Tropicale', icon: '🌺', mode: 'chill' },
  prism: { label: 'Prismatique', icon: '🔷', mode: 'medium' },
  ember: { label: 'Braise', icon: '🔥', mode: 'hard' },
  glitch: { label: 'Glitch', icon: '👾', mode: 'chaos' },
  // Evenements saisonniers
  firework: { label: 'Feu d’artifice', icon: '🎆', season: 'newyear' },
  heart: { label: 'Coup de cœur', icon: '💘', season: 'valentine' },
  pastel: { label: 'Pastel', icon: '🐣', season: 'easter' },
  prank: { label: 'Farceuse', icon: '🐟', season: 'aprilfools' },
  solar: { label: 'Solaire', icon: '☀️', season: 'summer' },
  cursed: { label: 'Maudite', icon: '🎃', season: 'halloween' },
  snow: { label: 'Enneigée', icon: '🎄', season: 'christmas' },
  // Carte fantome du mois
  phantom: { label: 'Fantôme', icon: '👻' }
};
const MODE_EDITION = Object.fromEntries(Object.entries(EDITIONS).filter(([, e]) => e.mode).map(([k, e]) => [e.mode, k]));

// Edition qu'une carte peut recevoir maintenant, et sa chance.
export function activeEdition(store) {
  const season = currentSeason(store);
  if (season) return { key: season.edition, chance: setting(store, 'SeasonalEditionChance') };
  const key = MODE_EDITION[currentMode(store).key];
  return key ? { key, chance: setting(store, 'EditionChance') } : null;
}

export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  const json = response.json;
  const body = request.body || {};
  if (path === 'open-pack' && !body.dryRun && Array.isArray(json.cards)) {
    const ed = activeEdition(store);
    if (!ed || !(ed.chance > 0)) return;
    const userId = Number(body.userId);
    const pulls = store.getAll('Pulls').filter((p) => p.BatchId === json.batchId && refId(p.User) === userId);
    let n = 0;
    for (const c of json.cards) {
      if (Math.random() >= ed.chance) continue;
      const pull = pulls.find((p) => refId(p.Card) === c.cardId && p.SerialNumber === c.serialNumber && !p.Edition);
      if (!pull) continue;
      store.update('Pulls', pull.id, { Edition: ed.key });
      c.edition = ed.key;
      n++;
    }
    if (n) {
      json.editions = n;
      const e = EDITIONS[ed.key];
      addFeed(store, { userId, kind: 'edition', icon: e.icon, text: `tire ${n > 1 ? n + ' cartes' : 'une carte'} en édition limitée ${e.label} !` });
    }
    return;
  }
  if (path === 'collection') {
    const userId = Number((request.query || {}).userId || body.userId);
    const map = {};
    store.getAll('Pulls').forEach((p) => { if (p.Edition && refId(p.User) === userId) map[p.id] = p.Edition; });
    json.editionPulls = map;
  }
}
