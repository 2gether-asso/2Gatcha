// Equilibrage des boosters (2026-10-11). Les mini-jeux creaient 25 a 30
// boosters par jour pour un joueur actif (tout le contenu fini en 3
// semaines) ; cible : ~5 par jour.
//  - Fouille : un booster trouve devient des poussieres une fois sur deux
//    (DigBoosterKeepChance), et toujours au-dela de DigFullRewardsPerDay
//    fouilles dans la journee.
//  - Chien : ses boosters deviennent DogBoosterDust poussieres (il garde
//    cartes et poussieres) ; au plus DogBonesPerDay os par jour.
//  - Migration unique (init) : applique les nouvelles valeurs aux reglages
//    deja personnalises s'ils sont plus genereux, et garde l'historique dans
//    AppSettings 'balance-2026-10-11' (anciennes valeurs, pour revenir en
//    arriere a la main si besoin).

import { now, parisDay } from './common.js';
import { setting } from './settings.js';

export const schema = {
  Users: { BoneUseDay: { type: 'Text' }, BoneUseCount: { type: 'Numeric' } }
};

const MIGRATION = 'balance-2026-10-11';

// Reglages "app" : nouvelle valeur si l'actuelle est plus genereuse.
// sens : 'max' = ne pas depasser, 'min' = au moins.
const APP_RULES = [
  ['DuplicateDustCommon', 3, 'max'], ['DuplicateDustOther', 6, 'max'], ['DuplicateDustCapCopies', 5, 'max'],
  ['ExchangeRateSwing', 0.3, 'min'], ['BoosterShopPrice', 450, 'min'], ['BoosterShopIncrease', 0.35, 'min'],
  ['TradeTaxPerCard', 15, 'min'], ['AuctionTaxPct', 0.15, 'min']
];
// Colonnes Config (lues par les workflows).
const CONFIG_RULES = [
  ['DigRegenSeconds', 600, 'min'], ['DogBoneCost', 250, 'min'],
  ['DailyQuestRewardBoosters', 1, 'max'], ['WeeklyQuestRewardBoosters', 3, 'max']
];
// Tables de peche personnalisees : poids maximum de ces prises.
const LOOT_CAPS = { FishingLoot: { booster: 3, bone: 8 }, DeepFishingLoot: { booster: 4, bone: 6 } };

const tooGenerous = (v, target, dir) => (dir === 'max' ? v > target : v < target);

export function init({ store }) {
  // Base d'inflation (30 boosters/jour) : migrations a part, avant le return.
  migrateInflationBase(store);
  migrateBoosterTarget(store);
  migrateBalance30(store);
  if (!store.tables.has('AppSettings') || store.getAll('AppSettings').some((r) => r.Key === MIGRATION)) return;
  const changes = [];
  const appRow = (key) => store.getAll('AppSettings').find((r) => r.Key === 'setting:' + key);
  for (const [key, target, dir] of APP_RULES) {
    const row = appRow(key);
    if (!row) continue;
    let v; try { v = JSON.parse(row.Value); } catch (e) { continue; }
    if (typeof v === 'number' && tooGenerous(v, target, dir)) { store.update('AppSettings', row.id, { Value: JSON.stringify(target) }); changes.push({ key, from: v, to: target }); }
  }
  const cfg = store.tables.has('Config') ? store.getAll('Config')[0] : null;
  if (cfg) {
    const fields = {};
    for (const [key, target, dir] of CONFIG_RULES) {
      const v = Number(cfg[key]) || 0;
      // 0 / vide = valeur par defaut du workflow, deja a jour.
      if (v && tooGenerous(v, target, dir)) { fields[key] = target; changes.push({ key, from: v, to: target }); }
    }
    if (Object.keys(fields).length) store.update('Config', cfg.id, fields);
  }
  for (const [key, caps] of Object.entries(LOOT_CAPS)) {
    const row = appRow(key);
    if (!row) continue;
    let table; try { table = JSON.parse(row.Value); } catch (e) { continue; }
    if (!Array.isArray(table)) continue;
    let touched = false;
    const next = table.map((x) => (x && caps[x.type] != null && Number(x.weight) > caps[x.type] ? (touched = true, { ...x, weight: caps[x.type] }) : x));
    if (touched) { store.update('AppSettings', row.id, { Value: JSON.stringify(next) }); changes.push({ key, from: table, to: next }); }
  }
  // Mythiques : jamais moins de 4000 poussieres au craft.
  if (store.tables.has('Rarities')) {
    for (const r of store.getAll('Rarities')) {
      if (r.Key === 'mythique' && (Number(r.CraftCost) || 0) > 0 && Number(r.CraftCost) < 4000) { store.update('Rarities', r.id, { CraftCost: 4000 }); changes.push({ key: 'Rarities.mythique.CraftCost', from: r.CraftCost, to: 4000 }); }
    }
  }
  store.create('AppSettings', { Key: MIGRATION, Value: JSON.stringify({ at: now(), changes }) });
  if (changes.length) console.log(`Equilibrage ${MIGRATION} : ${changes.length} reglage(s) ajuste(s) (${changes.map((c) => c.key).join(', ')})`);
}

// Inflation (2026-10-15) : on estime qu'un joueur ouvre au moins ~30 boosters
// par jour. Un seuil d'alerte enregistre plus bas (ancienne base ~3) est
// releve une seule fois a 45 ; l'ancienne valeur reste dans l'historique.
const INFLATION_MIGRATION = 'inflation-2026-10-15';
export function migrateInflationBase(store) {
  if (!store.tables.has('AppSettings') || store.getAll('AppSettings').some((r) => r.Key === INFLATION_MIGRATION)) return;
  const row = store.getAll('AppSettings').find((r) => r.Key === 'setting:EconomyAlertBoostersPerPlayer');
  const changes = [];
  let v = null;
  try { v = row ? JSON.parse(row.Value) : null; } catch (e) { v = null; }
  if (row && typeof v === 'number' && v < 45) { store.update('AppSettings', row.id, { Value: JSON.stringify(45) }); changes.push({ key: 'EconomyAlertBoostersPerPlayer', from: v, to: 45 }); }
  store.create('AppSettings', { Key: INFLATION_MIGRATION, Value: JSON.stringify({ at: now(), base: 30, changes }) });
  if (changes.length) console.log(`Inflation : seuil d'alerte releve de ${v} a 45 boosters par joueur et par jour (base 30)`);
}

// Cible de 40 boosters par jour a +/- 20 (2026-10-16), codes de jeu exclus :
// un seuil d'alerte enregistre sous 60 est releve une seule fois a 60.
const TARGET_MIGRATION = 'booster-target-2026-10-16';
export function migrateBoosterTarget(store) {
  if (!store.tables.has('AppSettings') || store.getAll('AppSettings').some((r) => r.Key === TARGET_MIGRATION)) return;
  const row = store.getAll('AppSettings').find((r) => r.Key === 'setting:EconomyAlertBoostersPerPlayer');
  let v = null;
  try { v = row ? JSON.parse(row.Value) : null; } catch (e) { v = null; }
  const changes = [];
  if (row && typeof v === 'number' && v < 60) { store.update('AppSettings', row.id, { Value: JSON.stringify(60) }); changes.push({ key: 'EconomyAlertBoostersPerPlayer', from: v, to: 60 }); }
  store.create('AppSettings', { Key: TARGET_MIGRATION, Value: JSON.stringify({ at: now(), target: 40, margin: 20, changes }) });
  if (changes.length) console.log(`Cible de boosters : seuil d'alerte releve de ${v} a 60 (cible 40 +/- 20, hors codes)`);
}

// Base de 30 boosters par jour (2026-10-15) : l'equilibrage du 11/10 visait
// ~5 boosters par jour ; on vise maintenant ~30 pour un joueur actif (fouille
// 3, chien 10, peche 3, coffres 1,5, quetes 7, fragments 2, boutique 2, le
// reste ~1). Migration unique : les reglages enregistres moins genereux que
// les nouvelles valeurs sont releves ; les anciennes valeurs restent dans
// l'historique (AppSettings 'balance-2026-10-15').
const BALANCE30 = 'balance-2026-10-15';
const APP_RULES_30 = [
  ['DigBoosterKeepChance', 1, 'min'], ['DogBonesPerDay', 6, 'min'], ['ChestBoosterChance', 0.6, 'min'], ['ChestDoubleBoosterChance', 0.15, 'min'],
  ['BoosterShopPrice', 300, 'max'], ['BoosterShopWeeklyCap', 14, 'min'], ['ShardsPerBooster', 5, 'max'], ['ShardsDailyCap', 10, 'min'],
  ['WealthReference', 8000, 'min'], ['DogKeepBoosters', true, 'bool']
];
const CONFIG_RULES_30 = [['DailyQuestRewardBoosters', 5], ['WeeklyQuestRewardBoosters', 14]];
const LOOT_FLOORS_30 = { FishingLoot: { booster: 10 }, DeepFishingLoot: { booster: 12 } };
export function migrateBalance30(store) {
  if (!store.tables.has('AppSettings') || store.getAll('AppSettings').some((r) => r.Key === BALANCE30)) return;
  const changes = [];
  const appRow = (key) => store.getAll('AppSettings').find((r) => r.Key === 'setting:' + key);
  for (const [key, target, dir] of APP_RULES_30) {
    const row = appRow(key);
    if (!row) continue;
    let v; try { v = JSON.parse(row.Value); } catch (e) { continue; }
    const stingy = dir === 'bool' ? v !== target : typeof v === 'number' && (dir === 'min' ? v < target : v > target);
    if (stingy) { store.update('AppSettings', row.id, { Value: JSON.stringify(target) }); changes.push({ key, from: v, to: target }); }
  }
  const cfg = store.tables.has('Config') ? store.getAll('Config')[0] : null;
  if (cfg) {
    const fields = {};
    for (const [key, target] of CONFIG_RULES_30) {
      // Vide = valeur de secours du workflow (ancienne) : on ecrit la nouvelle.
      const v = Number(cfg[key]) || 0;
      if (v < target) { fields[key] = target; changes.push({ key, from: v || null, to: target }); }
    }
    if (Object.keys(fields).length) store.update('Config', cfg.id, fields);
  }
  for (const [key, floors] of Object.entries(LOOT_FLOORS_30)) {
    const row = appRow(key);
    if (!row) continue;
    let table; try { table = JSON.parse(row.Value); } catch (e) { continue; }
    if (!Array.isArray(table)) continue;
    let touched = false;
    const next = table.map((x) => (x && floors[x.type] != null && Number(x.weight) < floors[x.type] ? (touched = true, { ...x, weight: floors[x.type] }) : x));
    if (touched) { store.update('AppSettings', row.id, { Value: JSON.stringify(next) }); changes.push({ key, to: floors }); }
  }
  store.create('AppSettings', { Key: BALANCE30, Value: JSON.stringify({ at: now(), base: 30, changes }) });
  if (changes.length) console.log(`Equilibrage ${BALANCE30} (30 boosters/jour) : ${changes.length} reglage(s) releve(s) (${changes.map((c) => c.key).join(', ')})`);
}

// Os du jour deja utilises.
const bonesToday = (user) => (user.BoneUseDay === parisDay(0) ? Number(user.BoneUseCount) || 0 : 0);

export function beforeWorkflow({ store, path, request }) {
  const body = request.body || {};
  if (path !== 'dig') return null;
  // Reglages du mode excite du chien, transmis au workflow (toujours ecrases :
  // jamais ceux envoyes par le joueur).
  request.body = { ...body, frenzyBones: setting(store, 'DogFrenzyBones'), frenzyBoards: setting(store, 'DogFrenzyBoards'), frenzyRestHours: setting(store, 'DogFrenzyRestHours') };
  if (body.action !== 'useBone') return null;
  const user = store.get('Users', Number(body.userId));
  if (!user) return null;
  const max = setting(store, 'DogBonesPerDay');
  if (max > 0 && bonesToday(user) >= max) return { status: 400, json: { error: 'dog_daily_limit', max } };
  return null;
}

export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'dig' || response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  const body = request.body || {};
  const json = response.json;
  let user = store.get('Users', Number(body.userId));
  if (!user) return;
  const fields = {};
  let boosters = Number(user.BoosterCount) || 0, dust = Number(user.StardustCount) || 0;
  // Os utilise : compteur du jour.
  if (body.action === 'useBone') { fields.BoneUseDay = parisDay(0); fields.BoneUseCount = bonesToday(user) + 1; }
  // Fouille du joueur : booster gardé une fois sur deux, jamais au-dela du plafond du jour.
  if (body.action === 'dig' && json.boosterGranted) {
    const full = setting(store, 'DigFullRewardsPerDay');
    const digsToday = user.DigDay === parisDay(0) ? Number(user.DigDayCount) || 0 : 0;
    if ((full > 0 && digsToday > full) || Math.random() >= setting(store, 'DigBoosterKeepChance')) {
      const gain = 25 + Math.floor(Math.random() * 26);
      boosters = Math.max(0, boosters - 1);
      dust += gain;
      json.boosterGranted = false;
      json.outcome = 'dust';
      json.dustGained = (Number(json.dustGained) || 0) + gain;
      json.boosterConverted = true;
    }
  }
  // Chien : pas de boosters, des poussieres a la place.
  const dogBoosters = json.dogReport ? Number(json.dogReport.boosters) || 0 : 0;
  if (dogBoosters > 0 && !setting(store, 'DogKeepBoosters')) {
    const gain = dogBoosters * setting(store, 'DogBoosterDust');
    boosters = Math.max(0, boosters - dogBoosters);
    dust += gain;
    json.dogReport.boosters = 0;
    json.dogReport.dust = (Number(json.dogReport.dust) || 0) + gain;
    json.dogReport.convertedBoosters = dogBoosters;
  }
  if (boosters !== (Number(user.BoosterCount) || 0)) fields.BoosterCount = boosters;
  if (dust !== (Number(user.StardustCount) || 0)) fields.StardustCount = dust;
  const maxBones = setting(store, 'DogBonesPerDay');
  if (maxBones > 0) json.bonesLeftToday = Math.max(0, maxBones - (fields.BoneUseCount != null ? fields.BoneUseCount : bonesToday(user)));
  if (!Object.keys(fields).length) return;
  user = store.update('Users', user.id, fields);
  if ('newBoosterCount' in json) json.newBoosterCount = user.BoosterCount;
  if ('newStardust' in json) json.newStardust = user.StardustCount;
}
