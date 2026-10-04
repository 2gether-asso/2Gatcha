// Jeu de peche (page Jeux) : chaque lancer coute des vers de terre (Users.Worms,
// trouves dans la terre restante a la fin d'une grille de fouille, voir
// afterWorkflow) et ramene
// une prise tiree dans une table ponderee (reglage FishingLoot) : rien,
// poussieres, os (chien de fouille), cle, booster ou coffre. Limite de
// lancers par jour (FishingDailyCasts, 0 = illimite).
// Niveau de peche (1 a 10, voir levels.js) : 1 XP par lancer + bonus selon la
// prise ; chaque niveau donne +2 lancers par jour, moins de prises vides et
// plus de prises rares. Piece detachee (Users.SpareParts) : remplace un des
// exemplaires consommes en Finitions ou Qualite (foil-upgrade.json,
// card-quality-repair.json).
// Meteo du jour (meme pour tous, tiree de la date) : un petit bonus et un
// decor different. Carnet de peche (Users.FishingRecords) : nombre, premiere
// fois et record par type de prise.
//   POST /webhook/fishing  { userId, action: 'status' | 'cast', count?: 1..5 }

import { ok, fail, userById, parisDay, now } from './common.js';
import { setting } from './settings.js';
import { levelInfo, weeklyXpFields } from './levels.js';

export const schema = {
  Users: { FishingDay: { type: 'Text' }, FishingCasts: { type: 'Numeric' }, BoneCount: { type: 'Numeric' }, ChestCount: { type: 'Numeric' }, SpareParts: { type: 'Numeric' }, FishingRecords: { type: 'Text' }, Worms: { type: 'Numeric' } }
};

const LABELS = { nothing: 'Rien du tout', dust: 'Poussières', bone: 'Os', key: 'Clé', booster: 'Booster', chest: 'Coffre', part: 'Pièce détachée' };
// Rarete d'affichage (couleur / animation cote site).
const TIER = { nothing: 'nothing', dust: 'commune', bone: 'rare', booster: 'epique', chest: 'legendaire', part: 'legendaire', key: 'mythique' };
const FIELD = { dust: 'StardustCount', bone: 'BoneCount', key: 'KeyCount', booster: 'BoosterCount', chest: 'ChestCount', part: 'SpareParts' };
// XP de peche par lancer : 1 + bonus selon la rarete de la prise.
const TIER_XP = { nothing: 0, commune: 0, rare: 1, epique: 2, legendaire: 4, mythique: 6 };

const WEATHERS = [
  { key: 'soleil', label: 'Grand soleil', icon: '☀️', effect: 'prises rares +10 %', rareBoost: 0.1 },
  { key: 'pluie', label: 'Pluie fine', icon: '🌧️', effect: 'prises vides -10 %', emptyReduction: 0.1 },
  { key: 'brume', label: 'Brume', icon: '🌫️', effect: 'poussières +25 %', dustBonus: 0.25 },
  { key: 'orage', label: 'Orage', icon: '⛈️', effect: 'pièces détachées x2', partBoost: 1 }
];

export function weatherOf(day = parisDay(0)) {
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return WEATHERS[h % WEATHERS.length];
}

function readRecords(user) {
  try { const r = JSON.parse(user.FishingRecords || '{}'); return r && typeof r === 'object' ? r : {}; } catch (e) { return {}; }
}

function recordsList(user) {
  const rec = readRecords(user);
  return Object.keys(LABELS).map((type) => ({ type, label: LABELS[type], tier: TIER[type], count: rec[type]?.count || 0, first: rec[type]?.first || null, best: rec[type]?.best || 0 }));
}

function fishingLevel(store, user) {
  const info = levelInfo(user.FishingXP, setting(store, 'FishingLevelXpStep'));
  const l = info.level - 1;
  return { ...info, perks: { extraCasts: 2 * l, emptyReduction: 0.06 * l, rareBoost: 0.08 * l } };
}

// Poids ajustes au niveau : moins de prises vides, plus de prises rares
// (tout sauf les poussieres).
function lootTable(store, perks = { emptyReduction: 0, rareBoost: 0 }, weather = {}) {
  const loot = setting(store, 'FishingLoot').filter((x) => x && LABELS[x.type] && Number(x.weight) > 0).map((x) => {
    let k = x.type === 'nothing' ? Math.max(0.05, 1 - perks.emptyReduction - (weather.emptyReduction || 0)) : x.type === 'dust' ? 1 : 1 + perks.rareBoost + (weather.rareBoost || 0);
    if (x.type === 'part') k *= 1 + (weather.partBoost || 0);
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
  const weather = weatherOf();
  return {
    weather: { key: weather.key, label: weather.label, icon: weather.icon, effect: weather.effect },
    records: recordsList(user),
    cost: setting(store, 'FishingCost'),
    castsToday: casts,
    dailyLimit: daily,
    castsLeft: daily > 0 ? Math.max(0, daily - casts) : null,
    stardust: Number(user.StardustCount) || 0,
    worms: Number(user.Worms) || 0,
    spareParts: Number(user.SpareParts) || 0,
    level,
    table: lootTable(store, level.perks, weather).map(({ type, label, chance, min, max, tier }) => ({ type, label, chance: Math.round(chance * 1000) / 10, min, max, tier }))
  };
}

function handleFishing({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const st = statusOf(store, user);
  if (body.action !== 'cast') return ok(st);
  const count = Math.min(5, Math.max(1, Number(body.count) || 1));
  if (st.castsLeft != null && st.castsLeft < count) return fail('daily_limit', 400, st);
  if (st.worms < st.cost * count) return fail('not_enough_worms', 400, st);
  const weather = weatherOf();
  const table = lootTable(store, st.level.perks, weather);
  const records = readRecords(user);
  if (!table.length) return fail('no_loot_table');
  const fields = { Worms: st.worms - st.cost * count, FishingDay: parisDay(0), FishingCasts: st.castsToday + count };
  const catches = [];
  let xp = 0;
  for (let i = 0; i < count; i++) {
    const x = roll(table);
    const min = Math.max(1, Number(x.min) || 1), max = Math.max(min, Number(x.max) || min);
    let amount = x.type === 'nothing' ? 0 : min + Math.floor(Math.random() * (max - min + 1));
    if (x.type === 'dust' && weather.dustBonus) amount = Math.round(amount * (1 + weather.dustBonus));
    const r = records[x.type] || { count: 0, first: null, best: 0 };
    const isFirst = !r.count;
    const isRecord = amount > (r.best || 0) && r.count > 0;
    records[x.type] = { count: r.count + 1, first: r.first || now(), best: Math.max(r.best || 0, amount) };
    if (FIELD[x.type]) fields[FIELD[x.type]] = (fields[FIELD[x.type]] ?? (Number(user[FIELD[x.type]]) || 0)) + amount;
    catches.push({ type: x.type, label: x.label, amount, tier: x.tier, first: isFirst, record: isRecord && x.type === 'dust' });
    xp += 1 + (TIER_XP[x.tier] || 0);
  }
  fields.FishingXP = (Number(user.FishingXP) || 0) + xp;
  Object.assign(fields, weeklyXpFields(user, 'Fishing', xp));
  fields.FishingRecords = JSON.stringify(records);
  user = store.update('Users', user.id, fields);
  const after = statusOf(store, user);
  return ok({ catches, xpGained: xp, levelUp: after.level.level > st.level.level ? after.level.level : null, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount, newKeyCount: user.KeyCount, newBoneCount: user.BoneCount, newChestCount: user.ChestCount, newSpareParts: user.SpareParts, newWorms: user.Worms, ...after });
}

export const routes = { 'POST fishing': handleFishing };

// Une seule fois : quelques vers offerts a chaque joueur existant.
export function init({ store }) {
  if (!store.tables.has('AppSettings') || store.getAll('AppSettings').some((r) => r.Key === 'starterWormsGiven')) return;
  const n = setting(store, 'StarterWorms');
  let users = 0;
  if (n > 0 && store.tables.has('Users')) {
    for (const u of store.getAll('Users')) { store.update('Users', u.id, { Worms: (Number(u.Worms) || 0) + n }); users++; }
  }
  store.create('AppSettings', { Key: 'starterWormsGiven', Value: JSON.stringify({ at: now(), worms: n, users }) });
  if (users) console.log(`Vers de terre : ${n} offerts a ${users} joueur(s)`);
}

export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json) return;
  // Soldes (pieces detachees, vers) avec le statut des boosters (en-tete, atelier).
  if (path === 'booster-status') {
    const user = store.get('Users', Number((request.query || {}).userId));
    if (user) { response.json.spareParts = Number(user.SpareParts) || 0; response.json.worms = Number(user.Worms) || 0; }
    return;
  }
  // Fouille : grille terminee (par le joueur ou le chien) -> vers de terre,
  // selon la terre restante.
  if (path !== 'dig') return;
  const user = store.get('Users', Number((request.body || {}).userId));
  if (!user) return;
  const json = response.json;
  const perBoard = setting(store, 'WormsPerBoard');
  const perTile = setting(store, 'WormsPerLeftoverTile');
  const mine = json.boardCleared ? perBoard + perTile * (Number(json.leftoverTiles) || 0) : 0;
  const dog = json.dogReport && json.dogReport.boards ? perBoard * json.dogReport.boards + perTile * (Number(json.dogReport.leftover) || 0) : 0;
  if (mine) json.wormsFound = mine;
  if (dog) json.dogReport.worms = dog;
  if (mine + dog) store.update('Users', user.id, { Worms: (Number(user.Worms) || 0) + mine + dog });
  json.worms = (Number(user.Worms) || 0) + mine + dog;
}
