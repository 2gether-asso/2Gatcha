// Jeu de peche (page Jeux) : chaque lancer coute des poussieres et ramene
// une prise tiree dans une table ponderee (reglage FishingLoot) : rien,
// poussieres, os (chien de fouille), cle, booster ou coffre. Limite de
// lancers par jour (FishingDailyCasts, 0 = illimite).
//   POST /webhook/fishing  { userId, action: 'status' | 'cast', count?: 1..5 }

import { ok, fail, userById, parisDay } from './common.js';
import { setting } from './settings.js';

export const schema = {
  Users: { FishingDay: { type: 'Text' }, FishingCasts: { type: 'Numeric' }, BoneCount: { type: 'Numeric' }, ChestCount: { type: 'Numeric' } }
};

const LABELS = { nothing: 'Rien du tout', dust: 'Poussières', bone: 'Os', key: 'Clé', booster: 'Booster', chest: 'Coffre' };
// Rarete d'affichage (couleur / animation cote site).
const TIER = { nothing: 'nothing', dust: 'commune', bone: 'rare', booster: 'epique', chest: 'legendaire', key: 'mythique' };
const FIELD = { dust: 'StardustCount', bone: 'BoneCount', key: 'KeyCount', booster: 'BoosterCount', chest: 'ChestCount' };

function lootTable(store) {
  const loot = setting(store, 'FishingLoot').filter((x) => x && LABELS[x.type] && Number(x.weight) > 0);
  const total = loot.reduce((s, x) => s + Number(x.weight), 0) || 1;
  return loot.map((x) => ({ ...x, label: x.label || LABELS[x.type], chance: Number(x.weight) / total, tier: TIER[x.type] }));
}

function roll(table) {
  let r = Math.random();
  for (const x of table) { r -= x.chance; if (r <= 0) return x; }
  return table[table.length - 1];
}

function statusOf(store, user) {
  const today = parisDay(0);
  const casts = user.FishingDay === today ? Number(user.FishingCasts) || 0 : 0;
  const daily = setting(store, 'FishingDailyCasts');
  return {
    cost: setting(store, 'FishingCost'),
    castsToday: casts,
    dailyLimit: daily,
    castsLeft: daily > 0 ? Math.max(0, daily - casts) : null,
    stardust: Number(user.StardustCount) || 0,
    table: lootTable(store).map(({ type, label, chance, min, max, tier }) => ({ type, label, chance: Math.round(chance * 1000) / 10, min, max, tier }))
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
  const table = lootTable(store);
  if (!table.length) return fail('no_loot_table');
  const fields = { StardustCount: st.stardust - st.cost * count, FishingDay: parisDay(0), FishingCasts: st.castsToday + count };
  const catches = [];
  for (let i = 0; i < count; i++) {
    const x = roll(table);
    const min = Math.max(1, Number(x.min) || 1), max = Math.max(min, Number(x.max) || min);
    const amount = x.type === 'nothing' ? 0 : min + Math.floor(Math.random() * (max - min + 1));
    if (FIELD[x.type]) fields[FIELD[x.type]] = (fields[FIELD[x.type]] ?? (Number(user[FIELD[x.type]]) || 0)) + amount;
    catches.push({ type: x.type, label: x.label, amount, tier: x.tier });
  }
  user = store.update('Users', user.id, fields);
  return ok({ catches, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount, newKeyCount: user.KeyCount, newBoneCount: user.BoneCount, newChestCount: user.ChestCount, ...statusOf(store, user) });
}

export const routes = { 'POST fishing': handleFishing };
