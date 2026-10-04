// Jeu de peche (page Jeux) : chaque lancer coute des poussieres et ramene
// une prise tiree dans une table ponderee (reglage FishingLoot) : rien,
// poussieres, os (chien de fouille), cle, booster ou coffre. Limite de
// lancers par jour (FishingDailyCasts, 0 = illimite).
// Niveau de peche (1 a 10, voir levels.js) : 1 XP par lancer + bonus selon la
// prise ; chaque niveau donne +2 lancers par jour, moins de prises vides et
// plus de prises rares. Piece detachee (Users.SpareParts) : joker du
// coffre-fort perso (remplit un emplacement, voir personal-vault.js).
//   POST /webhook/fishing  { userId, action: 'status' | 'cast', count?: 1..5 }

import { ok, fail, userById, parisDay } from './common.js';
import { setting } from './settings.js';
import { levelInfo } from './levels.js';

export const schema = {
  Users: { FishingDay: { type: 'Text' }, FishingCasts: { type: 'Numeric' }, BoneCount: { type: 'Numeric' }, ChestCount: { type: 'Numeric' }, SpareParts: { type: 'Numeric' } }
};

const LABELS = { nothing: 'Rien du tout', dust: 'Poussières', bone: 'Os', key: 'Clé', booster: 'Booster', chest: 'Coffre', part: 'Pièce détachée' };
// Rarete d'affichage (couleur / animation cote site).
const TIER = { nothing: 'nothing', dust: 'commune', bone: 'rare', booster: 'epique', chest: 'legendaire', part: 'legendaire', key: 'mythique' };
const FIELD = { dust: 'StardustCount', bone: 'BoneCount', key: 'KeyCount', booster: 'BoosterCount', chest: 'ChestCount', part: 'SpareParts' };
// XP de peche par lancer : 1 + bonus selon la rarete de la prise.
const TIER_XP = { nothing: 0, commune: 0, rare: 1, epique: 2, legendaire: 4, mythique: 6 };

function fishingLevel(store, user) {
  const info = levelInfo(user.FishingXP, setting(store, 'FishingLevelXpStep'));
  const l = info.level - 1;
  return { ...info, perks: { extraCasts: 2 * l, emptyReduction: 0.06 * l, rareBoost: 0.08 * l } };
}

// Poids ajustes au niveau : moins de prises vides, plus de prises rares
// (tout sauf les poussieres).
function lootTable(store, perks = { emptyReduction: 0, rareBoost: 0 }) {
  const loot = setting(store, 'FishingLoot').filter((x) => x && LABELS[x.type] && Number(x.weight) > 0).map((x) => {
    const k = x.type === 'nothing' ? 1 - perks.emptyReduction : x.type === 'dust' ? 1 : 1 + perks.rareBoost;
    return { ...x, weight: Number(x.weight) * k };
  });
  const total = loot.reduce((s, x) => s + x.weight, 0) || 1;
  return loot.map((x) => ({ ...x, label: x.label || LABELS[x.type], chance: x.weight / total, tier: TIER[x.type] }));
}

function roll(table) {
  let r = Math.random();
  for (const x of table) { r -= x.chance; if (r <= 0) return x; }
  return table[table.length - 1];
}

function statusOf(store, user) {
  const today = parisDay(0);
  const casts = user.FishingDay === today ? Number(user.FishingCasts) || 0 : 0;
  const level = fishingLevel(store, user);
  const base = setting(store, 'FishingDailyCasts');
  const daily = base > 0 ? base + level.perks.extraCasts : 0;
  return {
    cost: setting(store, 'FishingCost'),
    castsToday: casts,
    dailyLimit: daily,
    castsLeft: daily > 0 ? Math.max(0, daily - casts) : null,
    stardust: Number(user.StardustCount) || 0,
    spareParts: Number(user.SpareParts) || 0,
    level,
    table: lootTable(store, level.perks).map(({ type, label, chance, min, max, tier }) => ({ type, label, chance: Math.round(chance * 1000) / 10, min, max, tier }))
  };
}

function handleFishing({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const st = statusOf(store, user);
  if (body.action !== 'cast') return ok(st);
  const count = Math.min(5, Math.max(1, Number(body.count) || 1));
  if (st.castsLeft != null && st.castsLeft < count) return fail('daily_limit', 400, st);
  if (st.stardust < st.cost * count) return fail('not_enough_dust', 400, st);
  const table = lootTable(store, st.level.perks);
  if (!table.length) return fail('no_loot_table');
  const fields = { StardustCount: st.stardust - st.cost * count, FishingDay: parisDay(0), FishingCasts: st.castsToday + count };
  const catches = [];
  let xp = 0;
  for (let i = 0; i < count; i++) {
    const x = roll(table);
    const min = Math.max(1, Number(x.min) || 1), max = Math.max(min, Number(x.max) || min);
    const amount = x.type === 'nothing' ? 0 : min + Math.floor(Math.random() * (max - min + 1));
    if (FIELD[x.type]) fields[FIELD[x.type]] = (fields[FIELD[x.type]] ?? (Number(user[FIELD[x.type]]) || 0)) + amount;
    catches.push({ type: x.type, label: x.label, amount, tier: x.tier });
    xp += 1 + (TIER_XP[x.tier] || 0);
  }
  fields.FishingXP = (Number(user.FishingXP) || 0) + xp;
  user = store.update('Users', user.id, fields);
  const after = statusOf(store, user);
  return ok({ catches, xpGained: xp, levelUp: after.level.level > st.level.level ? after.level.level : null, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount, newKeyCount: user.KeyCount, newBoneCount: user.BoneCount, newChestCount: user.ChestCount, newSpareParts: user.SpareParts, ...after });
}

export const routes = { 'POST fishing': handleFishing };
