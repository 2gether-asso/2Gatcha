// Jeu de peche (page Jeux) : chaque lancer coute des vers de terre (Users.Worms,
// trouves dans la terre restante a la fin d'une grille de fouille, voir
// afterWorkflow) et ramene
// une prise tiree dans une table ponderee (reglage FishingLoot) : rien,
// poussieres, os (chien de fouille), cle, booster ou coffre.
// Energie de peche (2026-10-17, remplace les lancers par jour) : 1 energie par
// lancer, jauge FishingMaxEnergy qui se recharge de 1 toutes les
// FishingRegenSeconds (comme la fouille). Users.FishingEnergy + FishingEnergyAt.
// Niveau de peche (1 a 10, voir levels.js) : 1 XP par lancer + bonus selon la
// prise ; chaque niveau donne +1 energie max, une recharge 5 % plus rapide,
// moins de prises vides et plus de prises rares. Piece detachee (Users.SpareParts) : remplace un des
// exemplaires consommes en Finitions ou Qualite (foil-upgrade.json,
// card-quality-repair.json).
// Meteo du jour (meme pour tous, tiree de la date) : un petit bonus et un
// decor different. Carnet de peche (Users.FishingRecords) : nombre, premiere
// fois et record par type de prise.
// Eaux profondes (2026-10-09) : zone debloquee au niveau DeepFishingLevel
// (ou des le premier prestige), table DeepFishingLoot, lancer plus cher
// (DeepFishingCostMult vers), nouvelles prises : perle noire (grosse somme de
// poussieres) et appat dore.
//   POST /webhook/fishing  { userId, action: 'status' | 'cast', count?: 1..MAX_CASTS, zone?: cle d'un lieu }
// 5 lieux de peche (2026-10-18, reglage FishingZones) : rivage, etang,
// riviere, eaux profondes, abysses. Chacun : niveau (ou prestige) requis,
// cout en vers (x FishingCost ; eaux profondes : DeepFishingLevel et
// DeepFishingCostMult), table de base (shore = FishingLoot, deep =
// DeepFishingLoot) avec prises rares x rare et prises vides x empty, especes
// de l'aquarium de cette zone (plus de rares aussi), XP = cout.
// "Tout pecher" (2026-10-15) : jusqu'a MAX_CASTS lancers d'un coup (bornes par
// les vers, l'energie et les appats).
// Aquarium (2026-10-17, aquarium.js) : en plus de la prise, une chance de
// remonter une espece de poisson (collection, tailles, revente en poussieres) ;
// body.strike ('perfect' | 'good' | 'miss', mini-jeu de ferrage du site) vaut
// pour tout le lot ; cote site, le ferrage est plus dur quand le lancer
// utilise plus de vers (x5, Tout pecher, eaux profondes).
// Moka le chat (cat.js) : chaque espece pechee donne aussi 1 poisson pour
// Moka (Users.CatFish) ; ses prises passives sont creditees ici (catReport) a
// chaque lancer, ou au statut si body.settleCat (onglet Peche) : le resume de
// la page Jeux, qui lit aussi le statut, ne "mange" pas la carte postale.

import { ok, fail, userById, parisDay, now } from './common.js';
import { setting } from './settings.js';
import { talentValue } from './talents.js';
import { levelInfo, weeklyXpFields } from './levels.js';
import { eventState } from './events.js';
import { grantCosmetic } from './cosmetics.js';
import { upgradeValue } from './upgrades.js';
import { modeIs } from './modeperks.js';
import { fishingBycatch } from './dino.js';
import { ruleOn } from './moderules.js';
import { catchSpecies, aquariumView } from './aquarium.js';
import { addFeed } from './feed.js';
import { settleCat, catView } from './cat.js';

export const schema = {
  Users: { FishingDay: { type: 'Text' }, FishingCasts: { type: 'Numeric' }, FishingEnergy: { type: 'Numeric' }, FishingEnergyAt: { type: 'Numeric' }, BoneCount: { type: 'Numeric' }, ChestCount: { type: 'Numeric' }, SpareParts: { type: 'Numeric' }, FishingRecords: { type: 'Text' }, Worms: { type: 'Numeric' },
    FishingPrestige: { type: 'Numeric' }, TourneyKey: { type: 'Text' }, TourneyCasts: { type: 'Numeric' }, TourneyScore: { type: 'Numeric' } }
};

const LABELS = { nothing: 'Rien du tout', dust: 'Poussières', bone: 'Os', key: 'Clé', booster: 'Booster', chest: 'Coffre', part: 'Pièce détachée', pearl: 'Perle noire', bait: 'Appât doré' };
// Rarete d'affichage (couleur / animation cote site).
const TIER = { nothing: 'nothing', dust: 'commune', bone: 'rare', booster: 'epique', chest: 'legendaire', part: 'legendaire', key: 'mythique', pearl: 'legendaire', bait: 'epique' };
const FIELD = { dust: 'StardustCount', bone: 'BoneCount', key: 'KeyCount', booster: 'BoosterCount', chest: 'ChestCount', part: 'SpareParts', pearl: 'StardustCount', bait: 'GoldBait' };
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
function weatherFor(user) {
  if (user && user.WeatherDay === parisDay(0) && user.WeatherKey) return WEATHERS.find((w) => w.key === user.WeatherKey) || weatherOf();
  return weatherOf();
}

// --- tournoi de peche du week-end -------------------------------------------
// Samedi et dimanche (heure de Paris) : les 10 premiers lancers du week-end
// comptent ; score = somme des points de rarete. Le lundi, les premiers sont
// recompenses (FishingTourneyPrizes), le premier recoit le titre "Roi de la peche".
const TOURNEY_CASTS = 10;
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
function payTourney(store) {
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
  return { ...info, prestige, perks: { energyBonus: l, regenReduction: 0.05 * l, emptyReduction: 0.06 * l, rareBoost: 0.08 * l + 0.03 * prestige, prestigeBoost: 0.03 * prestige } };
}

// Poids ajustes au niveau : moins de prises vides, plus de prises rares
// (tout sauf les poussieres).
// bait : appat dore du jardin (aucune prise vide, prises rares x2,5) ;
// eventRare : multiplicateur d'un evenement "semaine de la peche".
function lootTable(store, perks = { emptyReduction: 0, rareBoost: 0 }, weather = {}, { bait = false, eventRare = 1, deep = false, zone = null } = {}) {
  const noEmpty = bait || ruleOn(store, 'cool.fishNoEmpty');
  const loot = setting(store, deep ? 'DeepFishingLoot' : 'FishingLoot').filter((x) => x && LABELS[x.type] && Number(x.weight) > 0 && !(noEmpty && x.type === 'nothing')).map((x) => {
    let k = x.type === 'nothing' ? Math.max(0.05, 1 - perks.emptyReduction - (weather.emptyReduction || 0)) : x.type === 'dust' || x.type === 'pearl' ? 1 : (1 + perks.rareBoost + (weather.rareBoost || 0)) * eventRare * (bait ? 2.5 : 1);
    if (x.type === 'part') k *= 1 + (weather.partBoost || 0);
    if (zone) k *= x.type === 'nothing' ? Number(zone.empty) || 1 : x.type === 'dust' ? 1 : Number(zone.rare) || 1;
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

// Lieux de peche : debloque, cout, table affichee.
const fmtTable = (t) => t.map(({ type, label, chance, min, max, tier }) => ({ type, label, chance: Math.round(chance * 1000) / 10, min, max, tier }));
function zonesOf(store, user, level, weather, eventRare) {
  const prestige = Number(user.FishingPrestige) || 0;
  const base = setting(store, 'FishingCost');
  return setting(store, 'FishingZones').filter((z) => z && z.key).map((z) => {
    const isDeep = z.key === 'deep';
    const need = isDeep ? setting(store, 'DeepFishingLevel') : Math.max(1, Number(z.level) || 1);
    const needPrestige = Math.max(0, Number(z.prestige) || 0);
    const unlocked = needPrestige ? prestige >= needPrestige : level.level >= need || prestige > 0;
    const mult = isDeep ? setting(store, 'DeepFishingCostMult') : Math.max(1, Number(z.cost) || 1);
    const zone = { key: z.key, label: z.label || z.key, icon: z.icon || '🎣', pool: z.pool === 'deep' ? 'deep' : 'shore', rare: Number(z.rare) || 1, empty: Number(z.empty) || 1 };
    return { ...zone, unlocked, level: need, prestige: needPrestige, mult, cost: base * mult, table: fmtTable(lootTable(store, level.perks, weather, { eventRare, deep: zone.pool === 'deep', zone })) };
  });
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

// Energie de peche : maximum (reglage + niveau + talent Pecheur assidu +
// arbre celeste) et recharge (reglage - 5 % par niveau), etat courant.
export function fishEnergy(store, user, level = fishingLevel(store, user)) {
  const max = Math.max(1, setting(store, 'FishingMaxEnergy') + level.perks.energyBonus + Math.round(talentValue(user, 'angler')));
  const regen = Math.max(30, Math.round(setting(store, 'FishingRegenSeconds') * (1 - level.perks.regenReduction)));
  const t = now();
  const stored = user.FishingEnergy == null || user.FishingEnergy === '' ? max : Number(user.FishingEnergy) || 0;
  const lastAt = Number(user.FishingEnergyAt) || t;
  let energy = stored, gained = 0, secondsUntilNext = null;
  if (stored < max) {
    const elapsed = Math.max(0, t - lastAt);
    gained = Math.floor(elapsed / regen);
    energy = Math.min(max, stored + gained);
    if (energy < max) secondsUntilNext = regen - (elapsed % regen);
  }
  // Apres une depense : on garde la progression vers le prochain point.
  const spend = (n) => ({ FishingEnergy: energy - n, FishingEnergyAt: energy >= max ? t : lastAt + gained * regen });
  return { energy, max, regen, secondsUntilNext, spend };
}

function statusOf(store, user) {
  const today = parisDay(0);
  const casts = user.FishingDay === today ? Number(user.FishingCasts) || 0 : 0;
  const level = fishingLevel(store, user);
  const en = fishEnergy(store, user, level);
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
    energy: en.energy, maxEnergy: en.max, regenSeconds: en.regen, secondsUntilNext: en.secondsUntilNext,
    stardust: Number(user.StardustCount) || 0,
    worms: Number(user.Worms) || 0,
    spareParts: Number(user.SpareParts) || 0,
    level,
    table: lootTable(store, level.perks, weather, { eventRare }).map(({ type, label, chance, min, max, tier }) => ({ type, label, chance: Math.round(chance * 1000) / 10, min, max, tier })),
    deep: deepOf(store, user, level, weather, eventRare),
    zones: zonesOf(store, user, level, weather, eventRare),
    aquarium: aquariumView(user, weather.key, store),
    cat: catView(store, user)
  };
}

const MAX_CASTS = 50;
// Table de Moka le chat (cat.js) : rivage, bonus de niveau et meteo du joueur.
export function catLoot(store, user) {
  const weather = weatherFor(user);
  const ev = eventState(store);
  return { table: lootTable(store, fishingLevel(store, user).perks, weather, { eventRare: ev.active ? ev.fishingRare : 1 }), field: FIELD, weather };
}

function handleFishing({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const settled = body.action === 'cast' || body.settleCat === true ? settleCat(store, user) : null;
  if (settled) user = store.update('Users', user.id, settled.fields);
  const catReport = settled ? settled.report : null;
  const st = statusOf(store, user);
  if (body.action !== 'cast') return ok({ ...st, catReport });
  const count = Math.min(MAX_CASTS, Math.max(1, Math.floor(Number(body.count) || 1)));
  const zone = st.zones.find((z) => z.key === (body.zone || 'shore')) || st.zones[0];
  if (!zone) return fail('no_zone', 400, st);
  if (!zone.unlocked) return fail(zone.key === 'deep' ? 'deep_locked' : 'zone_locked', 400, st);
  const deep = zone.pool === 'deep';
  const cost = zone.cost;
  if (st.energy < count) return fail('no_energy', 400, st);
  if (st.worms < cost * count) return fail('not_enough_worms', 400, st);
  const useBait = body.bait === true || body.bait === 'true';
  if (useBait && st.goldBait < count) return fail('not_enough_bait', 400, st);
  const weather = weatherFor(user);
  const ev = eventState(store);
  const eventRare = ev.active ? ev.fishingRare : 1;
  const table = lootTable(store, st.level.perks, weather, { bait: useBait, eventRare, deep, zone });
  const fullDaily = setting(store, 'FishingFullRewardsPerDay');
  const tk = tourneyKey();
  let tCasts = tk && user.TourneyKey === tk ? Number(user.TourneyCasts) || 0 : 0;
  let tScore = tk && user.TourneyKey === tk ? Number(user.TourneyScore) || 0 : 0;
  const records = readRecords(user);
  if (!table.length) return fail('no_loot_table');
  const fields = { Worms: st.worms - cost * count, FishingDay: parisDay(0), FishingCasts: st.castsToday + count, ...fishEnergy(store, user, st.level).spend(count) };
  if (useBait) fields.GoldBait = st.goldBait - count;
  const catches = [];
  let xp = 0;
  let reducedAny = false;
  for (let i = 0; i < count; i++) {
    let x = roll(table);
    const min = Math.max(1, Number(x.min) || 1), max = Math.max(min, Number(x.max) || min);
    let amount = x.type === 'nothing' ? 0 : min + Math.floor(Math.random() * (max - min + 1));
    if (x.type === 'dust' && weather.dustBonus) amount = Math.round(amount * (1 + weather.dustBonus));
    if ((x.type === 'dust' || x.type === 'pearl') && upgradeValue(user, 'rod')) amount = Math.round(amount * (1 + upgradeValue(user, 'rod')));
    // Rendements decroissants : au-dela de FishingFullRewardsPerDay lancers
    // dans la journee, poussieres divisees par 2 et objets une fois sur deux
    // remplaces par une pincee de poussieres.
    let reduced = false;
    if (fullDaily > 0 && st.castsToday + i >= fullDaily && x.type !== 'nothing') {
      reduced = true;
      if (x.type === 'dust' || x.type === 'pearl') amount = Math.max(1, Math.floor(amount / 2));
      // Jamais de booster au-dela du plein rendement (2026-10-11).
      else if (x.type === 'booster' || Math.random() < 0.5) { x = { ...x, type: 'dust', label: LABELS.dust, tier: TIER.dust }; amount = 5; }
    }
    if (reduced) reducedAny = true;
    if (tk && tCasts < TOURNEY_CASTS) { tCasts++; tScore += TIER_POINTS[x.tier] || 0; }
    const r = records[x.type] || { count: 0, first: null, best: 0 };
    const isFirst = !r.count;
    const isRecord = amount > (r.best || 0) && r.count > 0;
    records[x.type] = { count: r.count + 1, first: r.first || now(), best: Math.max(r.best || 0, amount) };
    if (FIELD[x.type]) fields[FIELD[x.type]] = (fields[FIELD[x.type]] ?? (Number(user[FIELD[x.type]]) || 0)) + amount;
    catches.push({ type: x.type, label: x.label, amount, tier: x.tier, first: isFirst, record: isRecord && x.type === 'dust', reduced });
    xp += zone.mult + (TIER_XP[x.tier] || 0);
  }
  fields.FishingXP = (Number(user.FishingXP) || 0) + xp;
  Object.assign(fields, weeklyXpFields(user, 'Fishing', xp));
  fields.FishingRecords = JSON.stringify(records);
  if (tk) Object.assign(fields, { TourneyKey: tk, TourneyCasts: tCasts, TourneyScore: tScore });
  const bycatch = fishingBycatch(store, user, count);
  if (bycatch) Object.assign(fields, bycatch.fields);
  // Especes de poissons (aquarium.js) : revendues aussitot en poussieres.
  const strike = ['perfect', 'good', 'miss'].includes(body.strike) ? body.strike : null;
  const species = catchSpecies(user, { store, count, deep, weatherKey: weather.key, strike, rareBoost: (st.level.perks.rareBoost || 0) * 0.5 + Math.max(0, zone.rare - 1), reducedFrom: fullDaily > 0 ? Math.max(0, fullDaily - st.castsToday) : Infinity });
  if (species) {
    Object.assign(fields, species.fields);
    fields.StardustCount = (fields.StardustCount ?? (Number(user.StardustCount) || 0)) + species.dust;
    fields.CatFish = (Number(user.CatFish) || 0) + species.items.length;
    species.items.filter((f) => f.rarity === 'legendaire' || f.rarity === 'mythique').forEach((f) => addFeed(store, { userId: user.id, kind: 'fish', icon: f.icon, text: `a pêché ${f.rarity === 'mythique' ? 'le' : 'un(e)'} ${f.name} de ${f.size} cm !` }));
  }
  user = store.update('Users', user.id, fields);
  const after = statusOf(store, user);
  return ok({ catReport, catches, bycatch: bycatch ? bycatch.items : [], species: species ? species.items : [], strike, zone: zone.key, zoneLabel: zone.label, xpGained: xp, reducedRewards: reducedAny, baitUsed: useBait ? count : 0, levelUp: after.level.level > st.level.level ? after.level.level : null, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount, newKeyCount: user.KeyCount, newBoneCount: user.BoneCount, newChestCount: user.ChestCount, newSpareParts: user.SpareParts, newWorms: user.Worms, newGoldBait: user.GoldBait, ...after });
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
