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
    DigDay: { type: 'Text' }, DigDayCount: { type: 'Numeric' }
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

const PRESTIGE = { fishing: { xp: 'FishingXP', prestige: 'FishingPrestige', step: 'FishingLevelXpStep' }, dig: { xp: 'DigXP', prestige: 'DigPrestige', step: 'DigLevelXpStep' } };

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

export function afterWorkflow({ store, path, request, response }) {
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
