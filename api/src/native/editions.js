// Editions limitees (2026-10-15) : une "finition" de plus, posee PAR-DESSUS
// la finition classique (Pulls.Edition) pour ne rien casser de l'echelle
// holo -> arc-en-ciel (decraft, amelioration, coffre...). Une par mode de jeu
// et une par evenement saisonnier (seasonal.js) ; Fantome pour la carte du
// mois (phantom.js). A l'ouverture d'un booster, chaque carte a une petite
// chance de porter l'edition en cours (celle de l'evenement en priorite).
// Une carte en edition limitee n'est jamais usee (Hard) ni sacrifiee
// automatiquement (salle des machines).
// Protection (2026-10-16) : comme une carte ★, un exemplaire en edition n'est
// jamais pris d'office par un workflow qui consomme des exemplaires (market.js
// le met de cote). Choisi a la main, il faut confirmer (body.confirmEdition)
// des que l'edition va disparaitre (erreur edition_copy sinon). Fusion de
// finition / restauration d'etat / carte ★ : le nouvel exemplaire GARDE
// l'edition (celle de l'exemplaire dont il garde le numero, sinon la premiere).

import { refId } from './common.js';
import { setting } from './settings.js';
import { currentMode } from './presets.js';
import { currentSeason } from './seasonal.js';
import { addFeed } from './feed.js';
import { ruleEnabled } from './moderules.js';

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
// Fiche d'un exemplaire en edition (messages de confirmation).
export function editionCopyView(store, p) {
  const card = store.get('Cards', refId(p.Card));
  const e = EDITIONS[p.Edition] || { label: p.Edition, icon: '✨' };
  return { pullId: p.id, edition: p.Edition, label: e.label, icon: e.icon, cardName: card ? card.Name : '?', serialNumber: p.SerialNumber ?? null };
}
// Exemplaire dont l'edition passe au resultat d'une fusion : celui dont le
// numero est garde s'il a une edition, sinon le premier (ordre du catalogue).
export function editionCarrier(pulls, keepId = null) {
  const eds = pulls.filter((p) => p && p.Edition);
  if (!eds.length) return null;
  const keep = eds.find((p) => p.id === Number(keepId));
  if (keep) return keep;
  const order = Object.keys(EDITIONS);
  return [...eds].sort((a, b) => order.indexOf(a.Edition) - order.indexOf(b.Edition))[0];
}
// Refus tant que la perte d'exemplaires en edition n'est pas confirmee.
export function editionLoss(store, lost, body, carried = null) {
  if (!lost.length || (body && body.confirmEdition)) return null;
  return { status: 400, json: { error: 'edition_copy', copies: lost.map((p) => editionCopyView(store, p)), carried: carried ? carried.Edition : null } };
}

const MODE_EDITION = Object.fromEntries(Object.entries(EDITIONS).filter(([, e]) => e.mode).map(([k, e]) => [e.mode, k]));

// Edition qu'une carte peut recevoir maintenant, et sa chance.
export function activeEdition(store) {
  const season = currentSeason(store);
  if (season) return { key: season.edition, chance: setting(store, 'SeasonalEditionChance') };
  const mode = currentMode(store).key;
  const key = MODE_EDITION[mode];
  return key && ruleEnabled(store, mode + '.edition') ? { key, chance: setting(store, 'EditionChance') } : null;
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
  // Fusion / restauration : le nouvel exemplaire garde l'edition choisie (market.js).
  if ((path === 'foil-upgrade' || path === 'card-quality-repair') && request._editionCarry) {
    const userId = Number(body.userId);
    const fresh = store.getAll('Pulls')
      .filter((p) => refId(p.User) === userId && refId(p.Card) === Number(json.cardId) && !p.Edition && (json.serialNumber == null || p.SerialNumber === json.serialNumber))
      .sort((a, b) => b.id - a.id)[0];
    if (fresh) { store.update('Pulls', fresh.id, { Edition: request._editionCarry }); json.edition = request._editionCarry; }
    return;
  }
  if (path === 'collection') {
    const userId = Number((request.query || {}).userId || body.userId);
    const map = {};
    store.getAll('Pulls').forEach((p) => { if (p.Edition && refId(p.User) === userId) map[p.id] = p.Edition; });
    json.editionPulls = map;
  }
}
