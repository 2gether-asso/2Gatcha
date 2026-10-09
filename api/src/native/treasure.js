// Course aux tresors hebdomadaire (2026-10-09) : chaque semaine, 5 indices
// caches sur 5 pages differentes du site (une petite icone glissee dans la
// page, position propre a chaque joueur). Chaque indice trouve rapporte des
// poussieres ; les 5 trouves, un bonus (booster + cle).
//   GET  /webhook/treasure-hunt ?userId=          -> { week, clues: [{ id, page, label, x, y, found }], found, total, bonus }
//   POST /webhook/treasure-hunt { userId, clue }  -> { found: true, reward, ... }

import { ok, fail, userById } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';

export const schema = {
  Users: { TreasureWeek: { type: 'Text' }, TreasureFound: { type: 'Text' } }
};

export const PAGES = [
  { page: 'index', label: 'Accueil' }, { page: 'collection', label: 'Collection' }, { page: 'ouverture', label: 'Ouverture' },
  { page: 'jeux', label: 'Jeux' }, { page: 'boutique', label: 'Boutique' }, { page: 'coffre', label: 'Coffre-fort' },
  { page: 'communaute', label: 'Communauté' }, { page: 'craft', label: 'Atelier' }, { page: 'trade', label: 'Échanges' },
  { page: 'stats', label: 'Statistiques' }, { page: 'profile', label: 'Profil' }, { page: 'pull-log', label: 'Historique' }
];
const COUNT = 5;

// Generateur pseudo-aleatoire reproductible (graine = semaine + joueur).
function rng(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return h / 4294967296; };
}

export function cluesOf(userId, week = weekKey()) {
  const r = rng(`${week}:${userId}`);
  const pages = [...PAGES];
  for (let i = pages.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pages[i], pages[j]] = [pages[j], pages[i]]; }
  return pages.slice(0, COUNT).map((p, id) => ({ id, page: p.page, label: p.label, x: Math.round(6 + r() * 86), y: Math.round(8 + r() * 80) }));
}

const foundOf = (user, week) => {
  if (user.TreasureWeek !== week) return [];
  try { const a = JSON.parse(user.TreasureFound || '[]'); return Array.isArray(a) ? a.map(Number) : []; } catch (e) { return []; }
};

function stateOf(store, user) {
  const week = weekKey();
  const found = foundOf(user, week);
  return {
    enabled: !!setting(store, 'TreasureHuntEnabled'), week,
    clues: cluesOf(user.id, week).map((c) => ({ ...c, found: found.includes(c.id) })),
    found: found.length, total: COUNT,
    rewardDust: setting(store, 'TreasureClueDust'), bonus: setting(store, 'TreasureHuntBonus')
  };
}

function handleStatus({ store, query }) {
  const user = userById(store, query.userId);
  if (!user) return fail('unknown_user', 404);
  return ok(stateOf(store, user));
}

function handleFind({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if (!setting(store, 'TreasureHuntEnabled')) return fail('disabled');
  const week = weekKey();
  const clue = cluesOf(user.id, week).find((c) => c.id === Number(body.clue));
  if (!clue || (body.page && body.page !== clue.page)) return fail('unknown_clue');
  const found = foundOf(user, week);
  if (found.includes(clue.id)) return fail('already_found', 400, stateOf(store, user));
  found.push(clue.id);
  const reward = { dust: setting(store, 'TreasureClueDust'), boosters: 0, keys: 0 };
  const complete = found.length === COUNT;
  if (complete) { const b = setting(store, 'TreasureHuntBonus'); reward.boosters = Number(b.boosters) || 0; reward.keys = Number(b.keys) || 0; reward.dust += Number(b.dust) || 0; }
  user = store.update('Users', user.id, {
    TreasureWeek: week, TreasureFound: JSON.stringify(found),
    StardustCount: (Number(user.StardustCount) || 0) + reward.dust,
    BoosterCount: (Number(user.BoosterCount) || 0) + reward.boosters,
    KeyCount: (Number(user.KeyCount) || 0) + reward.keys
  });
  return ok({ ...stateOf(store, user), clueFound: clue.id, complete, reward, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount });
}

export const routes = { 'GET treasure-hunt': handleStatus, 'POST treasure-hunt': handleFind };
