// Depenses de poussieres durables (2026-10-11).
//  - Ameliorations permanentes : chenil (poussieres du chien), serre (pousse
//    du jardin), canne (poussieres et perles pechees). 5 niveaux chacune,
//    prix doubles a chaque niveau, indexes sur la richesse moyenne. Aucune ne
//    cree de booster.
//  - Relance de finition : sur un exemplaire en finition normale, paie pour
//    retenter une finition speciale (FinishRerollChance).
//   POST /webhook/upgrades       { userId, action: 'status' | 'buy', key? }
//   POST /webhook/finish-reroll  { userId, pullId, action: 'status' | 'reroll' }

import { refId, ok, fail, userById } from './common.js';
import { setting } from './settings.js';
import { price as indexed } from './inflation.js';

export const schema = {
  Users: { Upgrades: { type: 'Text' } }
};

const TRACKS = {
  kennel: { label: 'Chenil', icon: '🐕', per: 0.1, effect: (n) => `+${n * 10} % de poussières rapportées par Milo` },
  greenhouse: { label: 'Serre', icon: '🌱', per: 0.06, effect: (n) => `−${n * 6} % de temps de pousse au jardin` },
  rod: { label: 'Canne renforcée', icon: '🎣', per: 0.1, effect: (n) => `+${n * 10} % de poussières et de perles pêchées` }
};
export const MAX_LEVEL = 5;

const parse = (v) => { try { const x = JSON.parse(v || '{}'); return x && typeof x === 'object' ? x : {}; } catch (e) { return {}; } };
const upgradeLevel = (user, key) => Math.min(MAX_LEVEL, Number(parse(user && user.Upgrades)[key]) || 0);
// Bonus d'une amelioration (fraction).
export const upgradeValue = (user, key) => upgradeLevel(user, key) * (TRACKS[key] ? TRACKS[key].per : 0);

const levelPrice = (store, level) => indexed(store, setting(store, 'UpgradeBasePrice') * 2 ** level);

function stateOf(store, user) {
  return {
    stardust: Number(user.StardustCount) || 0,
    upgrades: Object.entries(TRACKS).map(([key, t]) => {
      const level = upgradeLevel(user, key);
      return { key, label: t.label, icon: t.icon, level, max: MAX_LEVEL, effect: t.effect(level), next: level < MAX_LEVEL ? { effect: t.effect(level + 1), price: levelPrice(store, level) } : null };
    })
  };
}

function handleUpgrades({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if ((body.action || 'status') === 'status') return ok(stateOf(store, user));
  if (body.action !== 'buy') return fail('unknown_action');
  const key = String(body.key || '');
  if (!TRACKS[key]) return fail('unknown_upgrade');
  const level = upgradeLevel(user, key);
  if (level >= MAX_LEVEL) return fail('max_level', 400, stateOf(store, user));
  const cost = levelPrice(store, level);
  if ((Number(user.StardustCount) || 0) < cost) return fail('not_enough_dust', 400, stateOf(store, user));
  const all = parse(user.Upgrades);
  all[key] = level + 1;
  user = store.update('Users', user.id, { Upgrades: JSON.stringify(all), StardustCount: (Number(user.StardustCount) || 0) - cost });
  return ok({ ...stateOf(store, user), bought: key, level: level + 1, paid: cost, newStardust: user.StardustCount });
}

// --- relance de finition -------------------------------------------------------
function rerollCost(store, rarityKey) {
  const table = setting(store, 'FinishRerollCost');
  return indexed(store, Number(table[rarityKey]) || Number(table.default) || 800);
}

function handleReroll({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const pull = store.get('Pulls', Number(body.pullId));
  if (!pull || refId(pull.User) !== user.id) return fail('pull_not_owned');
  const card = store.get('Cards', refId(pull.Card));
  const rarity = card ? store.get('Rarities', refId(card.Rarity)) : null;
  if (!card || !rarity || card.IsPromo || rarity.Key === 'unique') return fail('not_rerollable');
  if ((pull.Finish || 'normal') !== 'normal') return fail('already_special');
  if (pull.InVault || pull.Insured) return fail('protected_copy');
  const cost = rerollCost(store, rarity.Key);
  const chance = setting(store, 'FinishRerollChance');
  if ((body.action || 'status') === 'status') return ok({ cost, chance, stardust: Number(user.StardustCount) || 0 });
  if (body.action !== 'reroll') return fail('unknown_action');
  if ((Number(user.StardustCount) || 0) < cost) return fail('not_enough_dust', 400, { cost });
  user = store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) - cost });
  let finish = 'normal';
  const finishes = store.tables.has('Finishes') ? store.getAll('Finishes').filter((f) => f.Key !== 'normal' && (Number(f.DropWeight) || 0) > 0) : [];
  if (finishes.length && Math.random() < chance) {
    const total = finishes.reduce((s, f) => s + (Number(f.DropWeight) || 0), 0);
    let roll = Math.random() * total;
    finish = finishes[finishes.length - 1].Key;
    for (const f of finishes) { roll -= Number(f.DropWeight) || 0; if (roll <= 0) { finish = f.Key; break; } }
    store.update('Pulls', pull.id, { Finish: finish });
  }
  return ok({ rerolled: true, success: finish !== 'normal', finish, cost, chance, newStardust: user.StardustCount });
}

export const routes = { 'POST upgrades': handleUpgrades, 'POST finish-reroll': handleReroll };

// Chenil : bonus sur les poussieres rapportees par le chien (apres balance.js).
export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'dig' || response.status !== 200 || !response.json || !response.json.dogReport) return;
  const report = response.json.dogReport;
  const user = store.get('Users', Number((request.body || {}).userId));
  const k = upgradeValue(user, 'kennel');
  const dust = Number(report.dust) || 0;
  if (!k || dust <= 0) return;
  const bonus = Math.round(dust * k);
  const updated = store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) + bonus });
  report.dust = dust + bonus;
  report.kennelBonus = bonus;
  if ('newStardust' in response.json) response.json.newStardust = updated.StardustCount;
}
