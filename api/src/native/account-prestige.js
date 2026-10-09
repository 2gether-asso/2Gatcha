// Prestige du compte (2026-10-09) : une fois tous les talents debloques, la
// progression continue. Une etoile au niveau AccountPrestigeLevel, puis une
// de plus tous les AccountPrestigeStep niveaux, sans remise a zero. Chaque
// etoile donne +1 point de talent (talents.js) et un titre ; la premiere
// donne aussi le cadre d'avatar "Prestige".
//   GET /webhook/account-prestige ?userId= -> { stars, level, nextLevel, titles }

import { ok, fail, userById, levelForXp } from './common.js';
import { setting } from './settings.js';
import { grantCosmetic } from './cosmetics.js';

export function prestigeStars(store, user) {
  const level = levelForXp(Number(user && user.XP) || 0);
  const start = setting(store, 'AccountPrestigeLevel');
  const step = Math.max(1, setting(store, 'AccountPrestigeStep'));
  return level < start ? 0 : 1 + Math.floor((level - start) / step);
}

const titleOf = (n) => `Prestige ${'★'.repeat(Math.min(n, 5))}${n > 5 ? ' ' + n : ''}`;

// Cosmetiques gagnes (idempotent) : appele a chaque statut.
function grantRewards(store, user, stars) {
  const fresh = [];
  for (let n = 1; n <= stars; n++) if (grantCosmetic(store, user.id, `prestige-${n}`, { type: 'title', label: titleOf(n) })) fresh.push(titleOf(n));
  if (stars >= 1 && grantCosmetic(store, user.id, 'frame-prestige', { type: 'frame', label: 'Cadre Prestige' })) fresh.push('Cadre Prestige');
  return fresh;
}

export function stateOf(store, user) {
  const stars = prestigeStars(store, user);
  const level = levelForXp(Number(user.XP) || 0);
  const start = setting(store, 'AccountPrestigeLevel');
  const step = Math.max(1, setting(store, 'AccountPrestigeStep'));
  return { stars, level, startLevel: start, step, nextLevel: stars ? start + stars * step : start, talentPoints: stars };
}

function handleStatus({ store, query }) {
  const user = userById(store, query.userId);
  if (!user) return fail('unknown_user', 404);
  const st = stateOf(store, user);
  return ok({ ...st, unlocked: grantRewards(store, user, st.stars) });
}

export const routes = { 'GET account-prestige': handleStatus };

// Etoiles visibles partout : en-tete (booster-status) et profil public.
export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  if (path === 'booster-status') {
    const user = store.get('Users', Number((request.query || {}).userId));
    if (user) { response.json.prestigeStars = prestigeStars(store, user); grantRewards(store, user, response.json.prestigeStars); }
  } else if (path === 'public-profile') {
    const pseudo = String((request.query || {}).pseudo || (request.body || {}).pseudo || '').toLowerCase();
    const user = pseudo && store.getAll('Users').find((u) => String(u.Pseudo || '').toLowerCase() === pseudo);
    if (user) response.json.prestigeStars = prestigeStars(store, user);
  }
}
