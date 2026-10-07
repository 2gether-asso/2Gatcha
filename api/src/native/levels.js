// Niveaux de metier : peche et fouille (1 a 10), gagnes en jouant.
// Palier : le niveau L demande step * L * (L - 1) / 2 XP (step = reglage
// FishingLevelXpStep / DigLevelXpStep) : 20, 60, 120, 200... pour la fouille.
//
// Fouille (workflow dig, bonus appliques apres coup) :
//   - XP : 1 par case creusee, +5 par tresor degage (Users.DigXP) ;
//   - +1 energie max tous les 2 niveaux, recharge -5 % par niveau (lus par
//     dig.json depuis Users.DigXP) ;
//   - +10 % de poussieres trouvees par niveau au-dessus du 1 ;
//   - chenil : le chien creuse 5 % plus vite et a +3 points de flair par
//     niveau (lus par dig.json).
// Peche : voir fishing.js (XP par lancer, lancers en plus, meilleures prises).
//
// Classement des metiers (page Communaute) : XP gagnee dans la semaine (lundi
// heure de Paris), meilleurs pecheurs et fouilleurs.
//   GET /webhook/skills-leaderboard -> { week, fishing: [...], dig: [...] }
//
// Prestige : au niveau 10, on peut repartir du niveau 1 contre une etoile
// permanente (+3 % de prises rares a la peche, +5 % de poussieres a la
// fouille par etoile).
//   POST /webhook/prestige { userId, skill: 'fishing' | 'dig' }
//
// Rendements decroissants : au-dela de DigFullRewardsPerDay cases creusees
// dans la journee, les poussieres trouvees sont divisees par 2.

import { ok, fail, userById, parisDay } from './common.js';
import { setting } from './settings.js';

export const MAX_LEVEL = 10;

export const schema = {
  Users: {
    DigXP: { type: 'Numeric' }, FishingXP: { type: 'Numeric' },
    DigWeek: { type: 'Text' }, DigWeekXP: { type: 'Numeric' },
    FishingWeek: { type: 'Text' }, FishingWeekXP: { type: 'Numeric' },
    DigPrestige: { type: 'Numeric' }, FishingPrestige: { type: 'Numeric' },
    DigDay: { type: 'Text' }, DigDayCount: { type: 'Numeric' },
    ExpeditionXP: { type: 'Numeric' }, ExpeditionPrestige: { type: 'Numeric' },
    GardenXP: { type: 'Numeric' }, GardenPrestige: { type: 'Numeric' }
  }
};

export const threshold = (level, step) => (step * level * (level - 1)) / 2;

export function levelFor(xp, step) {
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, Number(xp) || 0)) / step)) / 2)));
}

// { level, xp, current, next (null au max), max }
export function levelInfo(xp, step) {
  const level = levelFor(xp, step);
  return {
    level, max: MAX_LEVEL, xp: Number(xp) || 0,
    current: threshold(level, step),
    next: level < MAX_LEVEL ? threshold(level + 1, step) : null
  };
}

// Lundi de la semaine en cours (AAAA-MM-JJ, heure de Paris).
export function weekKey(at = Date.now()) {
  const day = parisDay(0, at);
  const d = new Date(day + 'T12:00:00Z');
  const back = (d.getUTCDay() + 6) % 7;
  return parisDay(-back, at);
}

// Champs a ecrire pour ajouter de l'XP de la semaine (kind : 'Dig' | 'Fishing').
export function weeklyXpFields(user, kind, xp) {
  const week = weekKey();
  const current = user[kind + 'Week'] === week ? Number(user[kind + 'WeekXP']) || 0 : 0;
  return { [kind + 'Week']: week, [kind + 'WeekXP']: current + xp };
}

function board(store, kind, step) {
  const week = weekKey();
  return store.getAll('Users')
    .map((u) => ({ u, xp: u[kind + 'Week'] === week ? Number(u[kind + 'WeekXP']) || 0 : 0 }))
    .filter((x) => x.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 10)
    .map((x, i) => ({
      rank: i + 1, userId: x.u.id, pseudo: x.u.Pseudo, discordId: x.u.DiscordId || null, discordAvatar: x.u.DiscordAvatar || null,
      weekXp: x.xp, level: levelFor(x.u[kind + 'XP'], step), prestige: Number(x.u[kind + 'Prestige']) || 0
    }));
}

function handleLeaderboard({ store }) {
  return ok({
    week: weekKey(),
    fishing: board(store, 'Fishing', setting(store, 'FishingLevelXpStep')),
    dig: board(store, 'Dig', setting(store, 'DigLevelXpStep'))
  });
}

const PRESTIGE = {
  fishing: { xp: 'FishingXP', prestige: 'FishingPrestige', step: 'FishingLevelXpStep' },
  dig: { xp: 'DigXP', prestige: 'DigPrestige', step: 'DigLevelXpStep' },
  expedition: { xp: 'ExpeditionXP', prestige: 'ExpeditionPrestige', step: 'ExpeditionLevelXpStep' },
  garden: { xp: 'GardenXP', prestige: 'GardenPrestige', step: 'GardenLevelXpStep' }
};

function handlePrestige({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const p = PRESTIGE[body.skill];
  if (!p) return fail('invalid_skill');
  if (levelFor(user[p.xp], setting(store, p.step)) < MAX_LEVEL) return fail('not_max_level');
  const stars = (Number(user[p.prestige]) || 0) + 1;
  store.update('Users', user.id, { [p.xp]: 0, [p.prestige]: stars });
  return ok({ prestiged: true, skill: body.skill, prestige: stars });
}

export const routes = { 'GET skills-leaderboard': handleLeaderboard, 'POST prestige': handlePrestige };

export function digPerks(level, prestige = 0) {
  return { energyBonus: Math.floor(level / 2), regenReduction: 0.05 * (level - 1), dustBonus: 0.1 * (level - 1) + 0.05 * prestige, dogSpeed: 0.05 * (level - 1), dogFlair: 0.03 * (level - 1), prestigeBonus: 0.05 * prestige };
}

export function digLevel(store, user) {
  const step = setting(store, 'DigLevelXpStep');
  const info = levelInfo(user.DigXP, step);
  const prestige = Number(user.DigPrestige) || 0;
  return { ...info, prestige, perks: digPerks(info.level, prestige) };
}

// Expedition et jardin (2026-10-07) : memes niveaux 1 a 10 et prestige.
//   Expedition : +6 % de poussieres et -3 % de duree par niveau, +5 % de
//   poussieres par etoile. XP : 2 (2 h), 5 (8 h), 12 (24 h).
//   Jardin : pousse 5 % plus vite et +3 points de chance d'appat dore par
//   niveau, +3 % de vitesse par etoile. XP : 2 par parcelle recoltee.
export const EXPEDITION_XP = { 2: 2, 8: 5, 24: 12 };

export function expeditionLevel(store, user) {
  const info = levelInfo(user.ExpeditionXP, setting(store, 'ExpeditionLevelXpStep'));
  const prestige = Number(user.ExpeditionPrestige) || 0;
  return { ...info, prestige, perks: { dustBonus: 0.06 * (info.level - 1) + 0.05 * prestige, timeReduction: 0.03 * (info.level - 1) } };
}

export function gardenLevel(store, user) {
  const info = levelInfo(user.GardenXP, setting(store, 'GardenLevelXpStep'));
  const prestige = Number(user.GardenPrestige) || 0;
  return { ...info, prestige, perks: { growReduction: 0.05 * (info.level - 1) + 0.03 * prestige, baitBonus: 0.03 * (info.level - 1) } };
}

// Duree de l'expedition au retour : retenue avant le workflow (il la remet a 0).
export function beforeWorkflow({ store, path, request }) {
  const body = request.body || {};
  if (path === 'expedition' && body.action === 'claim') {
    const user = store.get('Users', Number(body.userId));
    if (user) request._expeditionHours = Number(user.ExpeditionDuration) || 0;
  }
  return null;
}

function expeditionAfter(store, body, json, request) {
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  if (body.action === 'start' && json.expedition && json.expedition.active) {
    const lvl = expeditionLevel(store, user);
    const until = Number(user.ExpeditionUntil) || 0;
    const cut = Math.floor((until - Math.floor(Date.now() / 1000)) * lvl.perks.timeReduction);
    if (cut > 0) {
      store.update('Users', user.id, { ExpeditionUntil: until - cut });
      json.expedition.until = until - cut;
      json.expedition.secondsLeft = Math.max(0, (json.expedition.secondsLeft || 0) - cut);
      json.expedition.shortenedBy = cut;
    }
  } else if (body.action === 'claim' && json.reward) {
    const before = expeditionLevel(store, user);
    const gained = EXPEDITION_XP[request._expeditionHours] || 2;
    const after = store.update('Users', user.id, { ExpeditionXP: (Number(user.ExpeditionXP) || 0) + gained });
    json.expeditionLevel = expeditionLevel(store, after);
    json.expeditionXpGained = gained;
    if (json.expeditionLevel.level > before.level) json.levelUp = json.expeditionLevel.level;
  }
  if (!json.expeditionLevel) json.expeditionLevel = expeditionLevel(store, store.get('Users', user.id));
}

export function afterWorkflow({ store, path, request, response }) {
  if (path === 'expedition' && response.status === 200 && response.json && !response.json.error) {
    expeditionAfter(store, request.body || {}, response.json, request);
    return;
  }
  if (path !== 'dig' || response.status !== 200 || !response.json || response.raw) return;
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  const json = response.json;
  const before = digLevel(store, user);
  if (body.action === 'dig' && json.dug) {
    const gained = 1 + (json.revealed ? 5 : 0);
    const today = parisDay(0);
    const digsToday = (user.DigDay === today ? Number(user.DigDayCount) || 0 : 0) + 1;
    const fields = { DigXP: (Number(user.DigXP) || 0) + gained, ...weeklyXpFields(user, 'Dig', gained), DigDay: today, DigDayCount: digsToday };
    const bonus = json.dustGained > 0 ? Math.round(json.dustGained * before.perks.dustBonus) : 0;
    let dustDelta = bonus;
    if (bonus) { json.dustGained += bonus; json.levelDustBonus = bonus; }
    const full = setting(store, 'DigFullRewardsPerDay');
    if (full > 0 && digsToday > full && json.dustGained > 0) {
      const cut = Math.floor(json.dustGained / 2);
      json.dustGained -= cut;
      dustDelta -= cut;
      json.reducedRewards = true;
    }
    if (dustDelta) fields.StardustCount = Math.max(0, (Number(user.StardustCount) || 0) + dustDelta);
    json.fullRewardsLeft = full > 0 ? Math.max(0, full - digsToday) : null;
    const after = store.update('Users', user.id, fields);
    json.digLevel = digLevel(store, after);
    if (json.digLevel.level > before.level) json.levelUp = json.digLevel.level;
  } else {
    json.digLevel = before;
  }
}
