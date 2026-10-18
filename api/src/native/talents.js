// Arbre de talents (2026-10-07) : un point par niveau de compte au-dessus du 1,
// a repartir dans 3 branches (Collectionneur, Artisan, Aventurier). Chaque
// branche a 3 talents a 3 rangs et un talent ultime qui demande 6 points dans
// la branche : 30 points pour tout debloquer (niveau 31). Talents de prestige
// (2026-10-17) : un par branche, 5 rangs, ouvert quand la branche est complete
// (10 points) ; ils se nourrissent des points des etoiles de prestige
// (account-prestige.js) et renforcent les talents de leur branche (adds) :
// 45 points en tout. Remise a zero payante (TalentResetCost).
//   POST /webhook/talents { userId, action: 'status' | 'learn' | 'reset', key? }
// Effets appliques ailleurs (boosts.js, fishing.js, garden.js, rules.js,
// market.js) via talentValue(user, key).

import { ok, fail, userById, levelForXp } from './common.js';
import { prestigeStars } from './account-prestige.js';
import { setting } from './settings.js';
import { skyAdd } from './skytree.js';

const BRANCHES = [
  { key: 'collector', label: 'Collectionneur', icon: '🎴' },
  { key: 'artisan', label: 'Artisan', icon: '⚒️' },
  { key: 'adventurer', label: 'Aventurier', icon: '🧭' }
];

export const TALENTS = [
  { key: 'lynx', branch: 'collector', label: 'Œil de lynx', icon: '👁️', max: 3, per: 0.01, desc: '+1 point de chance de finition spéciale par rang à l’ouverture des boosters.' },
  { key: 'recycler', branch: 'collector', label: 'Recycleur', icon: '♻️', max: 3, per: 0.15, desc: '+15 % de poussières de doublons par rang.' },
  { key: 'patron', branch: 'collector', label: 'Mécène', icon: '💰', max: 3, per: 0.05, desc: '+5 % de poussières au décraft par rang.' },
  { key: 'born', branch: 'collector', label: 'Collectionneur né', icon: '🌟', max: 1, req: 6, per: 0.05, desc: '5 % de chance qu’une carte tirée d’un booster gagne un état.' },
  { key: 'thrifty', branch: 'artisan', label: 'Économe', icon: '🪙', max: 3, per: 0.05, desc: '−5 % sur le coût de craft par rang (remboursé aussitôt).' },
  { key: 'restorer', branch: 'artisan', label: 'Restaurateur', icon: '🧰', max: 3, per: 0.25, desc: '−25 % par rang sur le supplément des restaurations répétées.' },
  { key: 'founder', branch: 'artisan', label: 'Fondeur', icon: '🔥', max: 3, per: 0.1, desc: '10 % de chance par rang de récupérer des poussières après une fusion ou une restauration.' },
  { key: 'master', branch: 'artisan', label: 'Maître artisan', icon: '🛠️', max: 1, req: 6, per: 0.5, desc: 'Taxes d’échange et d’enchères divisées par 2.' },
  { key: 'angler', branch: 'adventurer', label: 'Pêcheur assidu', icon: '🎣', max: 3, per: 2, desc: '+2 énergie de pêche max par rang.' },
  { key: 'greenthumb', branch: 'adventurer', label: 'Main verte', icon: '🌱', max: 3, per: 0.1, desc: 'Le jardin pousse 10 % plus vite par rang.' },
  { key: 'explorer', branch: 'adventurer', label: 'Explorateur', icon: '🗺️', max: 3, per: 0.1, desc: '+10 % de poussières rapportées d’expédition par rang.' },
  { key: 'tireless', branch: 'adventurer', label: 'Fouilleur infatigable', icon: '⛏️', max: 1, req: 6, per: 0.15, desc: '+15 % de poussières trouvées à la fouille.' },
  // Talents de prestige : branche complete exigee, effets ajoutes aux talents de la branche.
  { key: 'pLuck', branch: 'collector', label: 'Chance insolente', icon: '🍀', max: 5, req: 10, prestige: true, per: 0, adds: { lynx: 0.005, born: 0.01 }, desc: '+0,5 point de finition spéciale et +1 % de chance qu’une carte gagne un état, par rang.' },
  { key: 'pVirtuoso', branch: 'artisan', label: 'Virtuose', icon: '💎', max: 5, req: 10, prestige: true, per: 0, adds: { thrifty: 0.03, patron: 0.03 }, desc: '−3 % sur le craft et +3 % de poussières au décraft, par rang.' },
  { key: 'pLegend', branch: 'adventurer', label: 'Légende vivante', icon: '🏔️', max: 5, req: 10, prestige: true, per: 0, adds: { angler: 1, explorer: 0.05, tireless: 0.05 }, desc: '+1 énergie de pêche max, +5 % de poussières d’expédition et de fouille, par rang.' }
];

export const schema = { Users: { Talents: { type: 'Text' } } };

export function talentRanks(user) {
  try { const t = JSON.parse((user && user.Talents) || '{}'); return t && typeof t === 'object' ? t : {}; } catch (e) { return {}; }
}

// Valeur de l'effet d'un talent pour un joueur (rang x valeur par rang),
// plus ce qu'y ajoutent les talents de prestige.
export function talentValue(user, key) {
  if (!user) return 0;
  const ranks = talentRanks(user);
  const rank = (t) => Math.min(t.max, Number(ranks[t.key]) || 0);
  const def = TALENTS.find((t) => t.key === key);
  let v = def ? rank(def) * def.per : 0;
  for (const t of TALENTS) if (t.adds && t.adds[key]) v += rank(t) * t.adds[key];
  // Etoiles allumees de l'arbre celeste (skytree.js).
  return v + skyAdd(user, key);
}

function state(store, user) {
  const ranks = talentRanks(user);
  const level = levelForXp(user.XP);
  // Prestige du compte : +1 point par etoile (account-prestige.js).
  const total = Math.max(0, level - 1) + prestigeStars(store, user);
  const spent = TALENTS.reduce((s, t) => s + Math.min(t.max, Number(ranks[t.key]) || 0), 0);
  const inBranch = (b) => TALENTS.filter((t) => t.branch === b).reduce((s, t) => s + Math.min(t.max, Number(ranks[t.key]) || 0), 0);
  return {
    level, points: total, spent, available: Math.max(0, total - spent),
    resetCost: setting(store, 'TalentResetCost'), stardust: Number(user.StardustCount) || 0,
    branches: BRANCHES.map((b) => ({ ...b, spent: inBranch(b.key) })),
    talents: TALENTS.map((t) => {
      const rank = Math.min(t.max, Number(ranks[t.key]) || 0);
      const locked = !!t.req && inBranch(t.branch) - rank < t.req;
      return { ...t, rank, locked, canLearn: rank < t.max && !locked && total - spent > 0 };
    })
  };
}

function handleTalents({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'learn') {
    const st = state(store, user);
    const t = st.talents.find((x) => x.key === String(body.key));
    if (!t) return fail('unknown_talent');
    if (st.available < 1) return fail('no_points');
    if (t.rank >= t.max) return fail('max_rank');
    if (t.locked) return fail('talent_locked');
    const ranks = talentRanks(user);
    ranks[t.key] = t.rank + 1;
    user = store.update('Users', user.id, { Talents: JSON.stringify(ranks) });
    return ok({ ...state(store, user), learned: t.key });
  }
  if (action === 'reset') {
    const cost = setting(store, 'TalentResetCost');
    if (!Object.keys(talentRanks(user)).length) return fail('nothing_to_reset');
    if ((Number(user.StardustCount) || 0) < cost) return fail('not_enough_dust');
    user = store.update('Users', user.id, { Talents: '{}', StardustCount: (Number(user.StardustCount) || 0) - cost });
    return ok({ ...state(store, user), reset: true });
  }
  if (action !== 'status') return fail('unknown_action');
  return ok(state(store, user));
}

export const routes = { 'POST talents': handleTalents };
