// Prestige du compte (2026-10-09) : une fois tous les talents debloques, la
// progression continue. Une etoile au niveau AccountPrestigeLevel, puis une
// de plus tous les AccountPrestigeStep niveaux, sans remise a zero. Chaque
// etoile donne +1 point de talent (talents de prestige, talents.js), un
// titre, AccountPrestigeBoosters boosters et AccountPrestigeDust poussieres
// (une fois, ProgressClaims 'prestige:N') ; la premiere donne aussi le cadre
// d'avatar "Prestige". La nouvelle etoile est annoncee au site (prestigeUnlocked).
//   GET /webhook/account-prestige ?userId= -> { stars, level, nextLevel, titles }

import { ok, fail, userById, levelForXp, refId, now } from './common.js';
import { setting } from './settings.js';
import { grantCosmetic } from './cosmetics.js';

export function prestigeStars(store, user) {
  const level = levelForXp(Number(user && user.XP) || 0);
  const start = setting(store, 'AccountPrestigeLevel');
  const step = Math.max(1, setting(store, 'AccountPrestigeStep'));
  return level < start ? 0 : 1 + Math.floor((level - start) / step);
}

const titleOf = (n) => `Prestige ${'★'.repeat(Math.min(n, 5))}${n > 5 ? ' ' + n : ''}`;

// Recompenses gagnees (idempotent) : appele a chaque statut. Renvoie ce qui
// vient d'etre donne (null si rien).
function grantRewards(store, user, stars) {
  const titles = [];
  for (let n = 1; n <= stars; n++) if (grantCosmetic(store, user.id, `prestige-${n}`, { type: 'title', label: titleOf(n) })) titles.push(titleOf(n));
  if (stars >= 1 && grantCosmetic(store, user.id, 'frame-prestige', { type: 'frame', label: 'Cadre Prestige' })) titles.push('Cadre Prestige');
  let boosters = 0, dust = 0, star = 0, gained = 0;
  if (stars >= 1 && store.tables.has('ProgressClaims')) {
    const done = new Set(store.getAll('ProgressClaims').filter((c) => refId(c.User) === user.id && String(c.Kind || '').startsWith('prestige:')).map((c) => c.Kind));
    for (let n = 1; n <= stars; n++) {
      if (done.has('prestige:' + n)) continue;
      store.create('ProgressClaims', { User: user.id, Ext: 0, Kind: 'prestige:' + n, At: now() });
      boosters += setting(store, 'AccountPrestigeBoosters');
      dust += setting(store, 'AccountPrestigeDust');
      star = n;
      gained++;
    }
    if (boosters || dust) {
      const u = store.get('Users', user.id);
      store.update('Users', user.id, { BoosterCount: (Number(u.BoosterCount) || 0) + boosters, StardustCount: (Number(u.StardustCount) || 0) + dust });
    }
  }
  return titles.length || boosters || dust ? { stars, star: star || stars, gained, titles, boosters, dust } : null;
}
// XP a partir de laquelle on est au niveau L (passer de n a n+1 coute 50 x n).
const xpAt = (level) => 25 * level * (level - 1);

export function stateOf(store, user) {
  const stars = prestigeStars(store, user);
  const level = levelForXp(Number(user.XP) || 0);
  const start = setting(store, 'AccountPrestigeLevel');
  const step = Math.max(1, setting(store, 'AccountPrestigeStep'));
  const nextLevel = stars ? start + stars * step : start;
  const fromLevel = stars ? start + (stars - 1) * step : 1;
  const xp = Number(user.XP) || 0;
  const pct = Math.max(0, Math.min(1, (xp - xpAt(fromLevel)) / Math.max(1, xpAt(nextLevel) - xpAt(fromLevel))));
  return {
    stars, level, startLevel: start, step, nextLevel, talentPoints: stars, xp, xpNext: xpAt(nextLevel), progress: Math.round(pct * 1000) / 10,
    reward: { boosters: setting(store, 'AccountPrestigeBoosters'), dust: setting(store, 'AccountPrestigeDust') }
  };
}

function handleStatus({ store, query }) {
  const user = userById(store, query.userId);
  if (!user) return fail('unknown_user', 404);
  const st = stateOf(store, user);
  const fresh = grantRewards(store, user, st.stars);
  return ok({ ...st, unlocked: fresh ? fresh.titles : [], fresh });
}

export const routes = { 'GET account-prestige': handleStatus };

// Etoiles visibles partout : en-tete (booster-status) et profil public.
export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  if (path === 'booster-status') {
    const user = store.get('Users', Number((request.query || {}).userId));
    if (user) {
      response.json.prestigeStars = prestigeStars(store, user);
      const fresh = grantRewards(store, user, response.json.prestigeStars);
      if (fresh) { response.json.prestigeUnlocked = fresh; const u = store.get('Users', user.id); response.json.newBoosterCount = u.BoosterCount; }
    }
  } else if (path === 'leaderboard') {
    // Classement : etoiles a cote du pseudo.
    const byPseudo = new Map(store.getAll('Users').map((u) => [String(u.Pseudo || ''), u]));
    for (const list of [response.json.topPullers, response.json.topLegendaries, response.json.topCollectors]) {
      (list || []).forEach((row) => { const u = byPseudo.get(String(row.pseudo || '')); if (u) row.prestigeStars = prestigeStars(store, u); });
    }
  } else if (path === 'public-profile') {
    const pseudo = String((request.query || {}).pseudo || (request.body || {}).pseudo || '').toLowerCase();
    const user = pseudo && store.getAll('Users').find((u) => String(u.Pseudo || '').toLowerCase() === pseudo);
    if (user) response.json.prestigeStars = prestigeStars(store, user);
  }
}
