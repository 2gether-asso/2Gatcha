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

import { setting } from './settings.js';

export const MAX_LEVEL = 10;

export const schema = {
  Users: { DigXP: { type: 'Numeric' }, FishingXP: { type: 'Numeric' } }
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

export function digPerks(level) {
  return { energyBonus: Math.floor(level / 2), regenReduction: 0.05 * (level - 1), dustBonus: 0.1 * (level - 1), dogSpeed: 0.05 * (level - 1), dogFlair: 0.03 * (level - 1) };
}

export function digLevel(store, user) {
  const step = setting(store, 'DigLevelXpStep');
  const info = levelInfo(user.DigXP, step);
  return { ...info, perks: digPerks(info.level) };
}

export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'dig' || response.status !== 200 || !response.json || response.raw) return;
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  const json = response.json;
  const before = digLevel(store, user);
  if (body.action === 'dig' && json.dug) {
    const fields = { DigXP: (Number(user.DigXP) || 0) + 1 + (json.revealed ? 5 : 0) };
    const bonus = json.dustGained > 0 ? Math.round(json.dustGained * before.perks.dustBonus) : 0;
    if (bonus) {
      fields.StardustCount = (Number(user.StardustCount) || 0) + bonus;
      json.dustGained += bonus;
      json.levelDustBonus = bonus;
    }
    const after = store.update('Users', user.id, fields);
    json.digLevel = digLevel(store, after);
    if (json.digLevel.level > before.level) json.levelUp = json.digLevel.level;
  } else {
    json.digLevel = before;
  }
}
