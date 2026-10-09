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
// Eaux profondes (2026-10-09) : zone debloquee au niveau DeepFishingLevel
// (ou des le premier prestige), table DeepFishingLoot, lancer plus cher
// (DeepFishingCostMult vers), nouvelles prises : perle noire (grosse somme de
// poussieres) et appat dore.
//   POST /webhook/fishing  { userId, action: 'status' | 'cast', count?: 1..5, zone?: 'shore' | 'deep' }

import { ok, fail, userById, parisDay, now } from './common.js';
import { setting } from './settings.js';
import { talentValue } from './talents.js';
import { levelInfo, weeklyXpFields } from './levels.js';
import { eventState } from './events.js';
import { grantCosmetic } from './cosmetics.js';

export const schema = {
  Users: { FishingDay: { type: 'Text' }, FishingCasts: { type: 'Numeric' }, BoneCount: { type: 'Numeric' }, ChestCount: { type: 'Numeric' }, SpareParts: { type: 'Numeric' }, FishingRecords: { type: 'Text' }, Worms: { type: 'Numeric' },
    FishingPrestige: { type: 'Numeric' }, TourneyKey: { type: 'Text' }, TourneyCasts: { type: 'Numeric' }, TourneyScore: { type: 'Numeric' } }
};

const LABELS = { nothing: 'Rien du tout', dust: 'Poussières', bone: 'Os', key: 'Clé', booster: 'Booster', chest: 'Coffre', part: 'Pièce détachée', pearl: 'Perle noire', bait: 'Appât doré' };
// Rarete d'affichage (couleur / animation cote site).
const TIER = { nothing: 'nothing', dust: 'commune', bone: 'rare', booster: 'epique', chest: 'legendaire', part: 'legendaire', key: 'mythique', pearl: 'legendaire', bait: 'epique' };
const FIELD = { dust: 'StardustCount', bone: 'BoneCount', key: 'KeyCount', booster: 'BoosterCount', chest: 'ChestCount', part: 'SpareParts', pearl: 'StardustCount', bait: 'GoldBait' };
export const FISH_TYPES = Object.keys(LABELS);
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

// Meteo du joueur : celle du jour, ou celle obtenue par une relance payante.
export function weatherFor(user) {
  if (user && user.WeatherDay === parisDay(0) && user.WeatherKey) return WEATHERS.find((w) => w.key === user.WeatherKey) || weatherOf();
  return weatherOf();
}

// --- tournoi de peche du week-end -------------------------------------------
// Samedi et dimanche (heure de Paris) : les 10 premiers lancers du week-end
// comptent ; score = somme des points de rarete. Le lundi, les premiers sont
// recompenses (FishingTourneyPrizes), le premier recoit le titre "Roi de la peche".
export const TOURNEY_CASTS = 10;
const TIER_POINTS = { nothing: 0, commune: 1, rare: 3, epique: 6, legendaire: 10, mythique: 15 };
const dow = (day) => new Date(day + 'T12:00:00Z').getUTCDay();
export function tourneyKey(offset = 0) {
  const today = parisDay(offset);
  const d = dow(today);
  if (d === 6) return today;
  if (d === 0) return parisDay(offset - 1);
  return null;
}
// Dernier tournoi termine : le samedi le plus recent dont le dimanche est passe.
function lastFinishedTourney() {
  for (let i = 2; i <= 9; i++) {
    const day = parisDay(-i);
    if (dow(day) === 6) return day;
  }
  return null;
}
const tourneyEnd = (key) => Math.floor(new Date(key + 'T00:00:00+02:00').getTime() / 1000) + 2 * 86400 - 1;

function tourneyBoard(store, key) {
  const users = store.getAll('Users').filter((u) => u.TourneyKey === key && (Number(u.TourneyCasts) || 0) > 0);
  return users.sort((a, b) => (Number(b.TourneyScore) || 0) - (Number(a.TourneyScore) || 0) || (Number(a.TourneyCasts) || 0) - (Number(b.TourneyCasts) || 0))
    .slice(0, 10).map((u, i) => ({ rank: i + 1, userId: u.id, pseudo: u.Pseudo, avatar: u.DiscordAvatar || null, score: Number(u.TourneyScore) || 0, casts: Number(u.TourneyCasts) || 0 }));
}

// Paie le dernier tournoi termine (une seule fois).
export function payTourney(store) {
  const key = lastFinishedTourney();
  if (!key || !store.tables.has('AppSettings')) return null;
  const flag = 'tourney-paid:' + key;
  if (store.getAll('AppSettings').some((r) => r.Key === flag)) return null;
  const board = tourneyBoard(store, key);
  const prizes = setting(store, 'FishingTourneyPrizes');
  const winners = board.slice(0, prizes.length).map((r, i) => {
    const u = store.get('Users', r.userId);
    store.update('Users', r.userId, { StardustCount: (Number(u.StardustCount) || 0) + (Number(prizes[i]) || 0) });
    if (i === 0) grantCosmetic(store, r.userId, 'tourney-win', { type: 'title', label: 'Roi de la pêche' });
    return { pseudo: r.pseudo, score: r.score, prize: Number(prizes[i]) || 0 };
  });
  store.create('AppSettings', { Key: flag, Value: JSON.stringify({ at: now(), winners }) });
  return winners;
}

let tourneyCheckedDay = null;
export function beforeRequest({ store }) {
  const day = parisDay(0);
  if (tourneyCheckedDay === day) return;
  tourneyCheckedDay = day;
  payTourney(store);
}

function handleTourney({ store, query }) {
  const key = tourneyKey();
  const last = lastFinishedTourney();
  const lastRow = last && store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === 'tourney-paid:' + last) : null;
  let lastWinners = null;
  try { lastWinners = lastRow ? JSON.parse(lastRow.Value).winners : null; } catch (e) { lastWinners = null; }
  const me = store.get('Users', Number(query.userId));
  let next = null;
  for (let i = 0; i <= 7 && !next; i++) if (dow(parisDay(i)) === 6) next = parisDay(i);
  return ok({
    active: !!key, key, endsAt: key ? tourneyEnd(key) : null, nextStart: key ? null : next,
    casts: TOURNEY_CASTS, prizes: setting(store, 'FishingTourneyPrizes'),
    board: key ? tourneyBoard(store, key) : [],
    me: key && me ? { score: me.TourneyKey === key ? Number(me.TourneyScore) || 0 : 0, casts: me.TourneyKey === key ? Number(me.TourneyCasts) || 0 : 0 } : null,
    lastWinners
  });
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
  const prestige = Number(user.FishingPrestige) || 0;
  return { ...info, prestige, perks: { extraCasts: 2 * l, emptyReduction: 0.06 * l, rareBoost: 0.08 * l + 0.03 * prestige, prestigeBoost: 0.03 * prestige } };
}

// Poids ajustes au niveau : moins de prises vides, plus de prises rares
// (tout sauf les poussieres).
// bait : appat dore du jardin (aucune prise vide, prises rares x2,5) ;
// eventRare : multiplicateur d'un evenement "semaine de la peche".
function lootTable(store, perks = { emptyReduction: 0, rareBoost: 0 }, weather = {}, { bait = false, eventRare = 1, deep = false } = {}) {
  const loot = setting(store, deep ? 'DeepFishingLoot' : 'FishingLoot').filter((x) => x && LABELS[x.type] && Number(x.weight) > 0 && !(bait && x.type === 'nothing')).map((x) => {
    let k = x.type === 'nothing' ? Math.max(0.05, 1 - perks.emptyReduction - (weather.emptyReduction || 0)) : x.type === 'dust' || x.type === 'pearl' ? 1 : (1 + perks.rareBoost + (weather.rareBoost || 0)) * eventRare * (bait ? 2.5 : 1);
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

// Eaux profondes : niveau requis (ou un prestige de peche).
function deepOf(store, user, level, weather, eventRare) {
  const need = setting(store, 'DeepFishingLevel');
  const unlocked = level.level >= need || (Number(user.FishingPrestige) || 0) > 0;
  return {
    unlocked, level: need, cost: setting(store, 'FishingCost') * setting(store, 'DeepFishingCostMult'),
    table: lootTable(store, level.perks, weather, { eventRare, deep: true }).map(({ type, label, chance, min, max, tier }) => ({ type, label, chance: Math.round(chance * 1000) / 10, min, max, tier }))
  };
}

function statusOf(store, user) {
  const today = parisDay(0);
  const casts = user.FishingDay === today ? Number(user.FishingCasts) || 0 : 0;
  const level = fishingLevel(store, user);
  const base = setting(store, 'FishingDailyCasts');
  const daily = base > 0 ? base + level.perks.extraCasts + talentValue(user, 'angler') : 0;
  const weather = weatherFor(user);
  const ev = eventState(store);
  const eventRare = ev.active ? ev.fishingRare : 1;
  const tk = tourneyKey();
  const fullDaily = setting(store, 'FishingFullRewardsPerDay');
  return {
    weather: { key: weather.key, label: weather.label, icon: weather.icon, effect: weather.effect, personal: user.WeatherDay === today },
    event: ev.active && (ev.fishingRare > 1 || ev.wormsMultiplier > 1) ? { label: ev.label, fishingRare: ev.fishingRare, wormsMultiplier: ev.wormsMultiplier } : null,
    goldBait: Number(user.GoldBait) || 0,
    fullRewardsLeft: fullDaily > 0 ? Math.max(0, fullDaily - casts) : null,
    tourney: tk ? { active: true, key: tk, casts: user.TourneyKey === tk ? Number(user.TourneyCasts) || 0 : 0, score: user.TourneyKey === tk ? Number(user.TourneyScore) || 0 : 0, max: TOURNEY_CASTS } : { active: false },
    records: recordsList(user),
    cost: setting(store, 'FishingCost'),
    castsToday: casts,
    dailyLimit: daily,
    castsLeft: daily > 0 ? Math.max(0, daily - casts) : null,
    stardust: Number(user.StardustCount) || 0,
    worms: Number(user.Worms) || 0,
    spareParts: Number(user.SpareParts) || 0,
    level,
    table: lootTable(store, level.perks, weather, { eventRare }).map(({ type, label, chance, min, max, tier }) => ({ type, label, chance: Math.round(chance * 1000) / 10, min, max, tier })),
    deep: deepOf(store, user, level, weather, eventRare)
  };
}

function handleFishing({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const st = statusOf(store, user);
  if (body.action !== 'cast') return ok(st);
  const count = Math.min(5, Math.max(1, Number(body.count) || 1));
  const deep = body.zone === 'deep';
  if (deep && !st.deep.unlocked) return fail('deep_locked', 400, st);
  const cost = deep ? st.deep.cost : st.cost;
  if (st.castsLeft != null && st.castsLeft < count) return fail('daily_limit', 400, st);
  if (st.worms < cost * count) return fail('not_enough_worms', 400, st);
  const useBait = body.bait === true || body.bait === 'true';
  if (useBait && st.goldBait < count) return fail('not_enough_bait', 400, st);
  const weather = weatherFor(user);
  const ev = eventState(store);
  const eventRare = ev.active ? ev.fishingRare : 1;
  const table = lootTable(store, st.level.perks, weather, { bait: useBait, eventRare, deep });
  const fullDaily = setting(store, 'FishingFullRewardsPerDay');
  const tk = tourneyKey();
  let tCasts = tk && user.TourneyKey === tk ? Number(user.TourneyCasts) || 0 : 0;
  let tScore = tk && user.TourneyKey === tk ? Number(user.TourneyScore) || 0 : 0;
  const records = readRecords(user);
  if (!table.length) return fail('no_loot_table');
  const fields = { Worms: st.worms - cost * count, FishingDay: parisDay(0), FishingCasts: st.castsToday + count };
  if (useBait) fields.GoldBait = st.goldBait - count;
  const catches = [];
  let xp = 0;
  let reducedAny = false;
  for (let i = 0; i < count; i++) {
    let x = roll(table);
    const min = Math.max(1, Number(x.min) || 1), max = Math.max(min, Number(x.max) || min);
    let amount = x.type === 'nothing' ? 0 : min + Math.floor(Math.random() * (max - min + 1));
    if (x.type === 'dust' && weather.dustBonus) amount = Math.round(amount * (1 + weather.dustBonus));
    // Rendements decroissants : au-dela de FishingFullRewardsPerDay lancers
    // dans la journee, poussieres divisees par 2 et objets une fois sur deux
    // remplaces par une pincee de poussieres.
    let reduced = false;
    if (fullDaily > 0 && st.castsToday + i >= fullDaily && x.type !== 'nothing') {
      reduced = true;
      if (x.type === 'dust' || x.type === 'pearl') amount = Math.max(1, Math.floor(amount / 2));
      else if (Math.random() < 0.5) { x = { ...x, type: 'dust', label: LABELS.dust, tier: TIER.dust }; amount = 5; }
    }
    if (reduced) reducedAny = true;
    if (tk && tCasts < TOURNEY_CASTS) { tCasts++; tScore += TIER_POINTS[x.tier] || 0; }
    const r = records[x.type] || { count: 0, first: null, best: 0 };
    const isFirst = !r.count;
    const isRecord = amount > (r.best || 0) && r.count > 0;
    records[x.type] = { count: r.count + 1, first: r.first || now(), best: Math.max(r.best || 0, amount) };
    if (FIELD[x.type]) fields[FIELD[x.type]] = (fields[FIELD[x.type]] ?? (Number(user[FIELD[x.type]]) || 0)) + amount;
    catches.push({ type: x.type, label: x.label, amount, tier: x.tier, first: isFirst, record: isRecord && x.type === 'dust', reduced });
    xp += (deep ? 2 : 1) + (TIER_XP[x.tier] || 0);
  }
  fields.FishingXP = (Number(user.FishingXP) || 0) + xp;
  Object.assign(fields, weeklyXpFields(user, 'Fishing', xp));
  fields.FishingRecords = JSON.stringify(records);
  if (tk) Object.assign(fields, { TourneyKey: tk, TourneyCasts: tCasts, TourneyScore: tScore });
  user = store.update('Users', user.id, fields);
  const after = statusOf(store, user);
  return ok({ catches, zone: deep ? 'deep' : 'shore', xpGained: xp, reducedRewards: reducedAny, baitUsed: useBait ? count : 0, levelUp: after.level.level > st.level.level ? after.level.level : null, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount, newKeyCount: user.KeyCount, newBoneCount: user.BoneCount, newChestCount: user.ChestCount, newSpareParts: user.SpareParts, newWorms: user.Worms, newGoldBait: user.GoldBait, ...after });
}

export const routes = { 'POST fishing': handleFishing, 'GET fishing-tournament': handleTourney };

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
  const evW = eventState(store);
  const wm = evW.active ? evW.wormsMultiplier : 1;
  const mine = json.boardCleared ? Math.round((perBoard + perTile * (Number(json.leftoverTiles) || 0)) * wm) : 0;
  const dog = json.dogReport && json.dogReport.boards ? Math.round((perBoard * json.dogReport.boards + perTile * (Number(json.dogReport.leftover) || 0)) * wm) : 0;
  if (mine) json.wormsFound = mine;
  if (dog) json.dogReport.worms = dog;
  if (mine + dog) store.update('Users', user.id, { Worms: (Number(user.Worms) || 0) + mine + dog });
  json.worms = (Number(user.Worms) || 0) + mine + dog;
}
