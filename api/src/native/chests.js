// Coffres (page d'ouverture des boosters, menu Jouer) : achetes contre des
// poussieres ou gagnes en montant de niveau (1 coffre tous les 5 niveaux,
// 1 clef tous les 10), ouverts avec une clef secrete. Contenu : poussieres a
// coup sur, souvent une carte (parfois deux), parfois des boosters.
//   POST /webhook/chests  { userId, action: 'status' | 'buy' | 'open', count? }
// count (2026-10-15) : acheter ou ouvrir plusieurs coffres d'un coup (1 a
// MAX_BATCH ; a l'ouverture, borne par les coffres ET les clefs possedes).
// Les coffres/clefs de niveau sont attribues a chaque appel (rattrapage des
// niveaux deja atteints, une seule fois : Users.ChestLevelGranted).
// Gatchapon (2026-10-18) : un coffre (Users.ChestCount) est une piece de
// gatchapon. action 'spin' (count?) : chaque piece fait tomber une boule qui
// contient un coffre de palier 1 a 8 (poids ChestTierWeights), gardee dans
// Users.ChestBalls. action 'open' + tier : ouvre une boule de ce palier avec
// une clef ; le butin est multiplie par ChestTierMults (divise par la moyenne
// ponderee : a nombre de coffres egal, l'economie ne change pas), et les
// raretes de cartes penchent vers le haut sur les gros paliers.
// action 'open' + all (2026-10-30) : toutes les boules d'un coup (paliers les
// plus beaux d'abord si les clefs manquent, au plus ALL_MAX), une seule ouverture.
// action 'open' sans tier : ancienne ouverture directe (garde pour compat).
// COFFRES V2 (2026-11-16) :
//  - FAMILLES (reglage ChestFamilies) : chaque boule a un palier ET une
//    famille (Collectionneur, Explorateur, Nature, Compagnons, Fortune), avec
//    son butin propre (facteurs poussieres / cartes / boosters, bonus de la
//    famille, plus mineraux, garde-manger ou nourriture des compagnons). Les
//    boules d'avant gardent l'ancien butin (famille '' = classique).
//    Users.ChestBalls = [{ t, f }] (un nombre = ancienne boule).
//  - PIECES DE COULEUR (Users.ChestCoins { famille: n }) : la boule tombe dans
//    cette famille (action spin + family).
//  - TROIS CLES : cle ordinaire (KeyCount) jusqu'au palier ChestOrdinaryKeyMaxTier
//    (les anciennes boules s'ouvrent toujours avec elle) ; cle d'or
//    (Users.GoldKeys) tout palier + bonus tires deux fois et finitions x1,5 ;
//    cle speciale, celle de la forge de la salle interdite (Users.SpecialKeys,
//    meme recette : 1 cle + 1 de chaque mineral ; porte ouverte seulement) :
//    tout palier et gros butin (voir ROOM_LOOT).
//  - SERRURIER (action craftKey, reglage ChestKeyRecipes) : fabrique les cles.
//  - COLLECTION (Users.ChestLog { 'famille:palier': n }) : premiere ouverture
//    d'une combinaison = petit bonus ; les 40 = titre « Maitre des coffres ».
//  - Autres sources : addBall / addCoins (boss, carnet des metiers, fouille
//    profonde, expeditions, cuisine, comptoir des maitres, coffre-fort).

import { refId, now, ok, fail, userById, levelForXp, firstAttachment } from './common.js';
import { setting } from './settings.js';
import { price as indexed } from './inflation.js';
import { visualLabel } from './visuals.js';
import { RESOURCES, grant } from './rewards.js';
import { parseJson } from './common.js';
import { MINERALS, mineralsOf } from './digdepth.js';
import { pantryFields } from './cooking.js';
import { grantCosmetic } from './cosmetics.js';

export const schema = {
  Users: { ChestCount: { type: 'Numeric' }, ChestLevelGranted: { type: 'Numeric' }, ChestBalls: { type: 'Text' }, ChestCoins: { type: 'Text' }, GoldKeys: { type: 'Numeric' }, ChestLog: { type: 'Text' } }
};

// Tous les parametres sont reglables dans l'admin (groupe "Coffres").
const chestCost = (store) => indexed(store, setting(store, 'ChestCost'));
const every = (n, level) => (n > 0 ? Math.floor(level / n) : 0);
const MAX_BATCH = 20;
const ALL_MAX = 50; // « Ouvrir tous les coffres » : une ouverture, au plus 50 boules
const countOf = (body) => Math.min(MAX_BATCH, Math.max(1, Math.floor(Number(body.count) || 1)));

// Coffres / clefs dus pour les niveaux atteints depuis le dernier passage.
function grantLevelRewards(store, user) {
  const level = levelForXp(user.XP);
  const done = Number(user.ChestLevelGranted) || 0;
  if (level <= done) return { user, granted: null };
  const ce = setting(store, 'ChestEveryLevels'), ke = setting(store, 'KeyEveryLevels');
  const chests = every(ce, level) - every(ce, done);
  const keys = every(ke, level) - every(ke, done);
  const updated = store.update('Users', user.id, {
    ChestLevelGranted: level,
    ChestCount: (Number(user.ChestCount) || 0) + chests,
    KeyCount: (Number(user.KeyCount) || 0) + keys
  });
  return { user: updated, granted: chests || keys ? { chests, keys, level } : null };
}

// --- gatchapon -----------------------------------------------------------
export const CHEST_TIERS = [
  { tier: 1, name: 'Coffre en bois', color: '#a16207' },
  { tier: 2, name: 'Coffre du marin', color: '#ea580c' },
  { tier: 3, name: 'Coffre renforcé', color: '#dc2626' },
  { tier: 4, name: 'Coffre du voyageur', color: '#d97706' },
  { tier: 5, name: 'Coffre ancien', color: '#a3a35c' },
  { tier: 6, name: 'Coffre d’acier', color: '#94a3b8' },
  { tier: 7, name: 'Coffre d’émeraude', color: '#10b981' },
  { tier: 8, name: 'Coffre mystique', color: '#d946ef' }
];
const tierWeights = (store) => { const w = setting(store, 'ChestTierWeights'); return CHEST_TIERS.map((_, i) => Math.max(0, Number(w[i]) || 0)); };
const tierMults = (store) => { const m = setting(store, 'ChestTierMults'); return CHEST_TIERS.map((_, i) => Math.max(0.1, Number(m[i]) || 1)); };
// Boules : { t: palier, f: famille ('' = boule d'avant la V2) }.
const ballsOf = (user) => {
  const b = parseJson(user && user.ChestBalls, []);
  return (Array.isArray(b) ? b : []).map((x) => (typeof x === 'number' ? { t: x, f: '' } : x && { t: Number(x.t), f: FAMILY_KEYS.includes(x.f) ? x.f : '' })).filter((x) => x && x.t >= 1 && x.t <= 8);
};
const saveBalls = (balls) => JSON.stringify(balls.map((b) => (b.f ? { t: b.t, f: b.f } : b.t)));

// --- familles (V2) --------------------------------------------------------
export const FAMILY_KEYS = ['collector', 'explorer', 'nature', 'pets', 'fortune'];
function families(store) {
  const raw = setting(store, 'ChestFamilies');
  const list = Array.isArray(raw) ? raw : [];
  return FAMILY_KEYS.map((key) => {
    const f = list.find((x) => x && x.key === key) || {};
    return { key, label: String(f.label || key), icon: String(f.icon || '🎁'), color: String(f.color || '#a78bfa'), desc: String(f.desc || ''), weight: Math.max(0, Number(f.weight) || 0), dust: Math.max(0, Number(f.dust ?? 1)), card: Math.max(0, Number(f.card ?? 1)), booster: Math.max(0, Number(f.booster ?? 1)), extras: Array.isArray(f.extras) ? f.extras : [] };
  });
}
const familyOf = (store, key) => families(store).find((f) => f.key === key) || null;
function drawFamily(store) {
  const fam = families(store);
  const total = fam.reduce((s, f) => s + f.weight, 0);
  if (!total) return FAMILY_KEYS[Math.floor(Math.random() * FAMILY_KEYS.length)];
  let r = Math.random() * total;
  for (const f of fam) { r -= f.weight; if (r <= 0) return f.key; }
  return fam[fam.length - 1].key;
}
const coinsOf = (user) => { const c = parseJson(user && user.ChestCoins, {}); return c && typeof c === 'object' ? c : {}; };
const logOf = (user) => { const c = parseJson(user && user.ChestLog, {}); return c && typeof c === 'object' ? c : {}; };
// Sources (autres modules) : une boule directement dans le bac, ou des pieces de couleur.
export function addBall(store, userId, tier, family = '') {
  const u = store.get('Users', userId);
  if (!u) return null;
  const b = { t: Math.max(1, Math.min(8, Math.round(tier) || 1)), f: FAMILY_KEYS.includes(family) ? family : drawFamily(store) };
  store.update('Users', userId, { ChestBalls: saveBalls([...ballsOf(u), b]) });
  return { tier: b.t, family: b.f, name: CHEST_TIERS[b.t - 1].name, familyLabel: familyOf(store, b.f).label };
}
export function addCoins(store, userId, family, n = 1) {
  const u = store.get('Users', userId);
  if (!u || !FAMILY_KEYS.includes(family)) return null;
  const c = coinsOf(u);
  c[family] = (Number(c[family]) || 0) + n;
  store.update('Users', userId, { ChestCoins: JSON.stringify(c) });
  return { family, n };
}
// Cle ordinaire : jusqu'a ce palier (les boules d'avant la V2 : toutes).
const ordinaryMax = (store) => Math.max(1, Math.min(8, setting(store, 'ChestOrdinaryKeyMaxTier')));
const keyFits = (store, ball, kt) => kt !== 'key' || !ball.f || ball.t <= ordinaryMax(store);
const KEY_FIELD = { key: 'KeyCount', gold: 'GoldKeys', room: 'SpecialKeys' };
// Butin d'une cle speciale (2026-11-16) : elle coute 1 cle + 1 de chaque
// mineral (23), donc un coffre ouvert avec elle rapporte beaucoup plus.
const ROOM_LOOT = { dust: 3, boosters: 3, cards: 2, extras: 3, minerals: 4, chips: 60, finishK: 20 };
const tierArt = (t) => `Coffres/${t === 4 ? '4.png' : t + '.PNG'}`;
const tierView = (store, t) => ({ ...t, name: visualLabel(store, tierArt(t.tier), t.name) });
function tiersInfo(store, balls) {
  const w = tierWeights(store), m = tierMults(store);
  const total = w.reduce((s, x) => s + x, 0) || 1;
  return CHEST_TIERS.map((t, i) => ({ ...tierView(store, t), chance: Math.round((w[i] / total) * 1000) / 10, mult: m[i], balls: balls.filter((b) => b.t === t.tier).length }));
}
// Facteur de butin d'un palier : multiplicateur / moyenne ponderee des multiplicateurs.
function tierFactor(store, tier) {
  const w = tierWeights(store), m = tierMults(store);
  const total = w.reduce((s, x) => s + x, 0) || 1;
  const avg = w.reduce((s, x, i) => s + x * m[i], 0) / total || 1;
  return { k: m[tier - 1] / avg, mult: m[tier - 1] };
}
function drawTier(store) {
  const w = tierWeights(store);
  let r = Math.random() * (w.reduce((s, x) => s + x, 0) || 1);
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i + 1; }
  return 1;
}

function statusOf(store, user, extra = {}) {
  const level = levelForXp(user.XP);
  const balls = ballsOf(user);
  const coins = coinsOf(user);
  const fams = families(store);
  const log = logOf(user);
  const groups = new Map();
  for (const b of balls) { const k = `${b.t}|${b.f}`; groups.set(k, (groups.get(k) || 0) + 1); }
  const room = Number(user.ForbiddenUnlocked) > 0;
  return {
    balls: balls.length,
    tiers: tiersInfo(store, balls),
    // V2 : boules par palier et famille, cles, pieces de couleur, serrurier, collection.
    groups: [...groups].map(([k, n]) => { const [t, f] = k.split('|'); const tier = Number(t); const fam = fams.find((x) => x.key === f); return { tier, family: f, familyLabel: fam ? fam.label : 'Classique', familyIcon: fam ? fam.icon : '🎁', n, ordinary: keyFits(store, { t: tier, f }, 'key') }; }).sort((a, b) => b.tier - a.tier || a.family.localeCompare(b.family)),
    families: fams.map((f) => ({ key: f.key, label: f.label, icon: f.icon, color: f.color, desc: f.desc, coins: Number(coins[f.key]) || 0 })),
    goldKeys: Number(user.GoldKeys) || 0, roomKeys: Number(user.SpecialKeys) || 0, room, ordinaryMax: ordinaryMax(store),
    recipes: keyRecipes(store, user),
    collection: { log: Object.fromEntries(Object.entries(log).filter(([k]) => !k.startsWith('classic:'))), total: FAMILY_KEYS.length * CHEST_TIERS.length, seen: Object.keys(log).filter((k) => !k.startsWith('classic:')).length, firstDust: setting(store, 'ChestFirstOpenDust') },
    chests: Number(user.ChestCount) || 0,
    keys: Number(user.KeyCount) || 0,
    stardust: Number(user.StardustCount) || 0,
    cost: chestCost(store),
    level,
    nextChestLevel: setting(store, 'ChestEveryLevels') > 0 ? (every(setting(store, 'ChestEveryLevels'), level) + 1) * setting(store, 'ChestEveryLevels') : null,
    nextKeyLevel: setting(store, 'KeyEveryLevels') > 0 ? (every(setting(store, 'KeyEveryLevels'), level) + 1) * setting(store, 'KeyEveryLevels') : null,
    ...extra
  };
}

function weighted(rows, weightOf) {
  const total = rows.reduce((s, r) => s + Math.max(0, weightOf(r)), 0);
  if (!total) return rows[0] || null;
  let roll = Math.random() * total;
  for (const r of rows) { roll -= Math.max(0, weightOf(r)); if (roll <= 0) return r; }
  return rows[rows.length - 1];
}

// Une carte : rarete selon Rarities.Weight (comme les boosters), finition 15 %
// speciale, etat selon Qualities.DropWeight, plus petit numero de serie libre.
function drawCard(store, userId, batchId, { tilt = 1, finishK = 1, preferNew = false } = {}) {
  const rarities = store.getAll('Rarities').filter((r) => (Number(r.Weight) || 0) > 0);
  const cards = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo);
  const pool = rarities.filter((r) => cards.some((c) => refId(c.Rarity) === r.id)).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  // Gros paliers du gatchapon : les raretes hautes pesent plus lourd.
  const rarity = weighted(pool, (r) => (Number(r.Weight) || 0) * Math.pow(tilt, pool.indexOf(r) * 0.35));
  if (!rarity) return null;
  let candidates = cards.filter((c) => refId(c.Rarity) === rarity.id);
  // Collectionneur (V2) : une carte jamais obtenue si possible.
  if (preferNew) {
    const owned = new Set(store.peekBy('Pulls', 'User', userId).map((p) => refId(p.Card)));
    const fresh = candidates.filter((c) => !owned.has(c.id));
    if (fresh.length) candidates = fresh;
  }
  const card = candidates[Math.floor(Math.random() * candidates.length)];
  const finishes = store.tables.has('Finishes') ? store.getAll('Finishes').filter((f) => f.Key !== 'normal' && (f.DropWeight || 0) > 0) : [];
  const finish = finishes.length && Math.random() < Math.min(0.9, setting(store, 'ChestSpecialFinishChance') * finishK) ? weighted(finishes, (f) => f.DropWeight).Key : 'normal';
  const qualities = store.tables.has('Qualities') ? store.getAll('Qualities').filter((q) => (q.DropWeight || 0) > 0) : [];
  const quality = qualities.length ? weighted(qualities, (q) => q.DropWeight).Key : 'good';
  const used = new Set(store.getAll('Pulls').filter((p) => refId(p.Card) === card.id).map((p) => p.SerialNumber));
  let serialNumber = 1;
  while (used.has(serialNumber)) serialNumber++;
  const t = now();
  store.create('Pulls', { User: userId, Card: card.id, ObtainedAt: t, BatchId: batchId, SerialNumber: serialNumber, Finish: finish, Quality: quality });
  const isFirstEver = !refId(card.FirstObtainedBy);
  if (isFirstEver) store.update('Cards', card.id, { FirstObtainedBy: userId, FirstObtainedAt: t });
  return {
    cardId: card.id, name: card.Name, artist: card.Artist, description: card.Description || null,
    imageId: firstAttachment(card.Image),
    rarity: { id: rarity.id, key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex, sortOrder: rarity.SortOrder || 0 },
    serialNumber, finish, quality, isFirstEver
  };
}

// Bonus du coffre (ChestExtraLoot, 2026-10-26) : des ressources des autres
// jeux, tirees a chaque coffre ; k = facteur du palier (1 hors gatchapon).
function rollExtras(store, n, k = 1, rowsIn = null) {
  const rows = (rowsIn || setting(store, 'ChestExtraLoot') || []).filter((l) => l && RESOURCES[l.key]);
  const got = new Map();
  for (let i = 0; i < n; i++) {
    for (const l of rows) {
      // Chance 1 = toujours ; sinon multipliee par le palier, plafonnee a 95 %.
      const c = Number(l.chance) || 0;
      if (c < 1 && Math.random() >= Math.min(0.95, c * k)) continue;
      const lo = Math.max(1, Math.round(Number(l.min) || 1)), hi = Math.max(lo, Math.round(Number(l.max) || lo));
      const q = Math.round((lo + Math.floor(Math.random() * (hi - lo + 1))) * Math.max(1, Math.sqrt(k)));
      got.set(l.key, (got.get(l.key) || 0) + q);
    }
  }
  return [...got].map(([key, q]) => ({ type: 'resource', key, n: Math.min(q, RESOURCES[key].max) }));
}
// Donne les bonus et renvoie les objets du butin (icone et libelle).
function giveExtras(store, userId, lines, batchId) {
  if (!lines.length) return [];
  const g = grant(store, userId, lines, batchId);
  return lines.map((l, i) => ({ type: 'resource', key: l.key, amount: l.n, icon: (g.rewards[i] || {}).icon || RESOURCES[l.key].icon, label: (g.rewards[i] || {}).label || `+${l.n} ${RESOURCES[l.key].many}` }));
}

// --- serrurier (V2) -------------------------------------------------------
function keyRecipes(store, user) {
  const r = setting(store, 'ChestKeyRecipes') || {};
  const owned = mineralsOf(user);
  const tierOwned = (t) => MINERALS.filter((m) => m.tier === t).reduce((s, m) => s + (Number(owned[m.key]) || 0), 0);
  const room = Number(user.ForbiddenUnlocked) > 0;
  const out = [];
  for (const kind of ['key', 'gold', 'room']) {
    const x = r[kind];
    if (!x || (kind === 'room' && !room)) continue;
    const need = [];
    if (x.dust) need.push({ what: 'dust', n: x.dust, have: Number(user.StardustCount) || 0, label: `${x.dust} ✨` });
    if (x.parts) need.push({ what: 'parts', n: x.parts, have: Number(user.SpareParts) || 0, label: `${x.parts} pièce${x.parts > 1 ? 's' : ''} détachée${x.parts > 1 ? 's' : ''}` });
    if (x.keys) need.push({ what: 'keys', n: x.keys, have: Number(user.KeyCount) || 0, label: `${x.keys} clé${x.keys > 1 ? 's' : ''} ordinaire${x.keys > 1 ? 's' : ''}` });
    if (x.goldKeys) need.push({ what: 'goldKeys', n: x.goldKeys, have: Number(user.GoldKeys) || 0, label: `${x.goldKeys} clé${x.goldKeys > 1 ? 's' : ''} d’or` });
    if (x.mineral) { const m = MINERALS.find((y) => y.key === x.mineral); need.push({ what: 'mineral', key: x.mineral, n: x.minerals || 1, have: Number(owned[x.mineral]) || 0, label: `${x.minerals || 1} ${m ? m.name : x.mineral}` }); }
    else if (x.mineralTier) need.push({ what: 'mineralTier', tier: x.mineralTier, n: x.minerals || 1, have: tierOwned(x.mineralTier), label: `${x.minerals || 1} minéra${(x.minerals || 1) > 1 ? 'ux' : 'l'} de palier ${x.mineralTier}` });
    if (x.allMinerals) need.push({ what: 'allMinerals', n: x.allMinerals, have: Math.min(...MINERALS.map((m) => Number(owned[m.key]) || 0)), label: `${x.allMinerals > 1 ? x.allMinerals + ' de chaque' : '1 de chaque'} minéral (${MINERALS.length})` });
    if (x.chips) need.push({ what: 'chips', n: x.chips, have: Number(user.CasinoChips) || 0, label: `${x.chips} jetons de la salle` });
    out.push({ kind, label: { key: 'Clé ordinaire', gold: 'Clé d’or', room: 'Clé spéciale' }[kind], icon: { key: '🔑', gold: '🔑', room: '⛓️' }[kind], need, can: need.every((n) => n.have >= n.n), max: Math.max(0, Math.min(...need.map((n) => Math.floor(n.have / Math.max(1, n.n))))) });
  }
  return out;
}
function craftKey(store, user, body) {
  const kind = String(body.kind || '');
  const recipe = keyRecipes(store, user).find((r) => r.kind === kind);
  if (!recipe) return fail('unknown_key');
  const n = Math.min(recipe.max, Math.max(1, Math.min(20, Math.floor(Number(body.count) || 1))));
  if (!recipe.can || n < 1) return fail('missing_ingredients', 400, { need: recipe.need });
  const fields = {};
  const owned = { ...mineralsOf(user) };
  for (const x of recipe.need) {
    const q = x.n * n;
    if (x.what === 'dust') fields.StardustCount = (Number(user.StardustCount) || 0) - q;
    if (x.what === 'parts') fields.SpareParts = (Number(user.SpareParts) || 0) - q;
    if (x.what === 'keys') fields.KeyCount = (Number(user.KeyCount) || 0) - q;
    if (x.what === 'goldKeys') fields.GoldKeys = (Number(user.GoldKeys) || 0) - q;
    if (x.what === 'chips') fields.CasinoChips = (Number(user.CasinoChips) || 0) - q;
    if (x.what === 'mineral') owned[x.key] = (Number(owned[x.key]) || 0) - q;
    if (x.what === 'allMinerals') MINERALS.forEach((m) => { owned[m.key] = (Number(owned[m.key]) || 0) - q; });
    if (x.what === 'mineralTier') {
      // Les mineraux les plus nombreux du palier d'abord.
      let left = q;
      for (const m of MINERALS.filter((y) => y.tier === x.tier).sort((a, b) => (Number(owned[b.key]) || 0) - (Number(owned[a.key]) || 0))) {
        const take = Math.min(left, Number(owned[m.key]) || 0);
        owned[m.key] = (Number(owned[m.key]) || 0) - take; left -= take;
        if (!left) break;
      }
    }
  }
  fields.Minerals = JSON.stringify(owned);
  const f = KEY_FIELD[kind];
  fields[f] = (fields[f] ?? (Number(user[f]) || 0)) + n;
  user = store.update('Users', user.id, fields);
  return ok(statusOf(store, user, { crafted: { kind, n, label: recipe.label, icon: recipe.icon } }));
}

// Butin propre a une famille (en plus de ses bonus) : champs Users et objets montres.
function familySpecial(store, user, fam, tier, k, fields) {
  const items = [];
  const cur = { ...user, ...fields };
  if (fam.key === 'explorer') {
    const owned = { ...mineralsOf(cur) };
    const maxT = Math.min(5, 1 + Math.floor(tier / 2));
    const n = 1 + Math.floor(Math.random() * 2) + (tier >= 6 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = 1 + Math.floor(Math.random() * maxT);
      const pool = MINERALS.filter((m) => m.tier === t);
      const m = pool[Math.floor(Math.random() * pool.length)];
      owned[m.key] = (Number(owned[m.key]) || 0) + 1;
      items.push({ type: 'resource', key: 'mineral:' + m.key, amount: 1, img: 'Fouille/' + m.img, icon: '💎', many: m.name, label: `+1 ${m.name}` });
    }
    fields.Minerals = JSON.stringify(owned);
  } else if (fam.key === 'nature') {
    const add = { veg: 1 + Math.floor(Math.random() * 3), herb: 1 + Math.floor(Math.random() * 2) };
    if (Math.random() < 0.4 * k) add.mush = 1 + Math.floor(Math.random() * 2);
    if (Math.random() < 0.25 * k) add.honey = 1;
    if (Math.random() < 0.25 * k) add.flower = 1 + Math.floor(Math.random() * 2);
    if (tier >= 5 && Math.random() < 0.5) add.truffle = 1;
    Object.assign(fields, pantryFields(cur, add, fields));
    const LAB = { veg: ['🥬', 'légume', 'légumes'], herb: ['🌿', 'herbe', 'herbes'], mush: ['🍄', 'champignon', 'champignons'], honey: ['🍯', 'pot de miel', 'pots de miel'], flower: ['🌸', 'fleur', 'fleurs'], truffle: ['🟤', 'truffe', 'truffes'] };
    for (const [key, q] of Object.entries(add)) items.push({ type: 'resource', key: 'pantry:' + key, amount: q, icon: LAB[key][0], one: LAB[key][1], many: LAB[key][2], label: `+${q} ${q > 1 ? LAB[key][2] : LAB[key][1]}` });
  } else if (fam.key === 'pets') {
    const carrots = 2 + Math.floor(Math.random() * 4 * Math.sqrt(k)), grubs = 2 + Math.floor(Math.random() * 4 * Math.sqrt(k));
    fields.Carrots = (Number(cur.Carrots) || 0) + carrots;
    fields.Grubs = (Number(cur.Grubs) || 0) + grubs;
    const cheese = 1 + Math.floor(Math.random() * 2 * Math.sqrt(k));
    fields.Cheese = (Number(cur.Cheese) || 0) + cheese;
    items.push({ type: 'resource', key: 'cheese', amount: cheese, icon: '🧀', label: `+${cheese} fromage${cheese > 1 ? 's' : ''} pour Poivre` });
    const food = parseJson(cur.DinoFood, {}) || {};
    const fish = 2 + Math.floor(Math.random() * 3), shrimp = Math.random() < 0.5 * k ? 1 + Math.floor(Math.random() * 2) : 0;
    food.fish = (Number(food.fish) || 0) + fish; food.shrimp = (Number(food.shrimp) || 0) + shrimp;
    fields.DinoFood = JSON.stringify(food);
    // Compagnons V2 : fragments d'equipement.
    const frags = 1 + Math.floor(Math.random() * 2 * Math.sqrt(k));
    fields.PetFrags = (Number(cur.PetFrags) || 0) + frags;
    items.push({ type: 'resource', key: 'petfrags', amount: frags, icon: '🧩', label: `+${frags} fragment${frags > 1 ? 's' : ''} d’équipement` });
    items.push({ type: 'resource', key: 'carrots', amount: carrots, icon: '🥕', label: `+${carrots} carottes` }, { type: 'resource', key: 'grubs', amount: grubs, icon: '🐛', label: `+${grubs} vers blancs` }, { type: 'resource', key: 'dinofood', amount: fish + shrimp, icon: '🐟', label: `+${fish} poissons${shrimp ? `, +${shrimp} crevettes` : ''} pour l’enclos` });
  }
  return items;
}

function handleChests({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const g = grantLevelRewards(store, user);
  user = g.user;
  const extra = g.granted ? { levelGrant: g.granted } : {};

  if (body.action === 'buy') {
    const cost = chestCost(store);
    const n = countOf(body);
    if ((Number(user.StardustCount) || 0) < cost * n) return fail('not_enough_dust', 400, statusOf(store, user, extra));
    user = store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) - cost * n, ChestCount: (Number(user.ChestCount) || 0) + n });
    return ok(statusOf(store, user, { ...extra, bought: n, paid: cost * n }));
  }

  if (body.action === 'craftKey') return craftKey(store, user, body);

  if (body.action === 'spin') {
    // Piece de couleur (V2) : la boule tombe dans cette famille.
    const colored = body.family && FAMILY_KEYS.includes(String(body.family)) ? String(body.family) : null;
    const coins = coinsOf(user);
    const have = colored ? Number(coins[colored]) || 0 : Number(user.ChestCount) || 0;
    if (have < 1) return fail('no_chest', 400, statusOf(store, user, extra));
    const n = Math.min(countOf(body), have);
    const drawn = Array.from({ length: n }, () => ({ t: drawTier(store), f: colored || drawFamily(store) }));
    const upd = { ChestBalls: saveBalls([...ballsOf(user), ...drawn]) };
    if (colored) { coins[colored] = have - n; upd.ChestCoins = JSON.stringify(coins); } else upd.ChestCount = have - n;
    user = store.update('Users', user.id, upd);
    const fams = families(store);
    return ok(statusOf(store, user, { ...extra, spun: n, drawn: drawn.map((b) => { const fam = fams.find((x) => x.key === b.f); return { ...tierView(store, CHEST_TIERS[b.t - 1]), family: b.f, familyLabel: fam.label, familyIcon: fam.icon }; }) }));
  }

  // Une boule d'un palier (tier, + family V2 et keyType 'key' | 'gold' | 'room'),
  // ou toutes les boules d'un coup (all : cles ordinaires sur les boules qui
  // les acceptent, les plus beaux paliers d'abord ; body.gold : cles d'or sur
  // le reste ; au plus ALL_MAX).
  if (body.action === 'open' && (body.tier != null || body.all)) {
    const balls = ballsOf(user);
    const have = { key: Number(user.KeyCount) || 0, gold: Number(user.GoldKeys) || 0, room: Number(user.SpecialKeys) || 0 };
    if (!have.room && Number(user.ForbiddenUnlocked) <= 0) have.room = 0;
    const rest = [...balls];
    const plan = []; // [{ ball, kt }]
    const take = (ball, kt) => { plan.push({ ball, kt }); have[kt]--; rest.splice(rest.indexOf(ball), 1); };
    if (body.all) {
      if (!balls.length) return fail('no_ball', 400, statusOf(store, user, extra));
      const sorted = [...balls].sort((x, y) => y.t - x.t);
      for (const ball of sorted) {
        if (plan.length >= ALL_MAX) break;
        if (have.key > 0 && keyFits(store, ball, 'key')) take(ball, 'key');
        else if (body.gold && have.gold > 0) take(ball, 'gold');
      }
      if (!plan.length) return fail(have.key + have.gold > 0 ? 'key_too_weak' : 'no_key', 400, statusOf(store, user, extra));
    } else {
      const tier = Math.floor(Number(body.tier));
      const fam = body.family != null ? String(body.family) : null;
      const kt = ['key', 'gold', 'room'].includes(body.keyType) ? body.keyType : 'key';
      if (kt === 'room' && Number(user.ForbiddenUnlocked) <= 0) return fail('no_key', 400, statusOf(store, user, extra));
      const mine = balls.filter((x) => x.t === tier && (fam == null || x.f === fam));
      if (!(tier >= 1 && tier <= 8) || !mine.length) return fail('no_ball', 400, statusOf(store, user, extra));
      if (have[kt] < 1) return fail('no_key', 400, statusOf(store, user, extra));
      if (!keyFits(store, mine[0], kt)) return fail('key_too_weak', 400, statusOf(store, user, { ...extra, ordinaryMax: ordinaryMax(store) }));
      const n = Math.min(countOf(body), mine.length, have[kt]);
      for (let i = 0; i < n; i++) take(mine[i], kt);
    }
    const batchId = `lootchest-${user.id}-${Date.now()}`;
    const dMin = setting(store, 'ChestDustMin'), dMax = Math.max(dMin, setting(store, 'ChestDustMax'));
    let dust = 0, boosters = 0, chips = 0;
    const cards = [], extraLines = [], special = [], firsts = [];
    const fields = {};
    const log = logOf(user);
    const fams = families(store);
    for (const { ball, kt } of plan) {
      const fam = ball.f ? fams.find((x) => x.key === ball.f) : null;
      const { k, mult } = tierFactor(store, ball.t);
      const fk = (x) => (fam ? fam[x] : 1);
      const p = (key, x) => Math.min(1, setting(store, key) * k * fk(x));
      dust += Math.round((dMin + Math.floor(Math.random() * (dMax - dMin + 1))) * k * fk('dust') * (kt === 'room' ? ROOM_LOOT.dust : 1));
      if (kt === 'room') boosters += ROOM_LOOT.boosters;
      boosters += Math.random() < Math.min(0.9, p('ChestDoubleBoosterChance', 'booster')) ? 2 : Math.random() < p('ChestBoosterChance', 'booster') ? 1 : 0;
      const finishK = Math.max(1, k) * (kt === 'gold' ? 1.5 : kt === 'room' ? ROOM_LOOT.finishK : 1);
      const opts = { tilt: mult, finishK, preferNew: fam && fam.key === 'collector' && ball.t >= 4 };
      // Cle speciale : des cartes assurees (la premiere jamais obtenue si possible).
      if (kt === 'room') for (let i = 0; i < ROOM_LOOT.cards; i++) { const c = drawCard(store, user.id, batchId, { ...opts, preferNew: i === 0 }); if (c) cards.push(c); }
      if (Math.random() < p('ChestCardChance', 'card')) { const c = drawCard(store, user.id, batchId, opts); if (c) cards.push(c); }
      if (Math.random() < p('ChestSecondCardChance', 'card')) { const c = drawCard(store, user.id, batchId, { ...opts, preferNew: false }); if (c) cards.push(c); }
      const rows = fam ? fam.extras : null;
      extraLines.push(...rollExtras(store, kt === 'gold' ? 2 : kt === 'room' ? ROOM_LOOT.extras : 1, k, rows));
      if (fam) special.push(...familySpecial(store, user, fam, ball.t, k, fields));
      // Cle speciale : des mineraux precieux (paliers 4-5) et des jetons de la salle.
      if (kt === 'room') {
        const owned = { ...mineralsOf({ ...user, ...fields }) };
        const pool = MINERALS.filter((m) => m.tier >= 4);
        for (let i = 0; i < ROOM_LOOT.minerals; i++) {
          const m = pool[Math.floor(Math.random() * pool.length)];
          owned[m.key] = (Number(owned[m.key]) || 0) + 1;
          special.push({ type: 'resource', key: 'mineral:' + m.key, amount: 1, img: 'Fouille/' + m.img, icon: '💎', label: `+1 ${m.name}` });
        }
        fields.Minerals = JSON.stringify(owned);
        chips += ROOM_LOOT.chips;
      }
      // Collection : premiere ouverture de cette famille et de ce palier.
      const lk = `${ball.f || 'classic'}:${ball.t}`;
      if (ball.f && !log[lk]) { const bonus = setting(store, 'ChestFirstOpenDust') * ball.t; dust += bonus; firsts.push({ tier: ball.t, family: ball.f, familyLabel: fam.label, name: CHEST_TIERS[ball.t - 1].name, dust: bonus }); }
      log[lk] = (Number(log[lk]) || 0) + 1;
    }
    const spent = { key: 0, gold: 0, room: 0 };
    plan.forEach((x) => { spent[x.kt]++; });
    const u0 = store.get('Users', user.id);
    user = store.update('Users', user.id, {
      ...fields,
      ChestBalls: saveBalls(rest),
      KeyCount: (Number(u0.KeyCount) || 0) - spent.key,
      GoldKeys: (Number(u0.GoldKeys) || 0) - spent.gold,
      SpecialKeys: (Number(u0.SpecialKeys) || 0) - spent.room,
      StardustCount: (Number(u0.StardustCount) || 0) + dust,
      BoosterCount: (Number(u0.BoosterCount) || 0) + boosters,
      ...(chips ? { CasinoChips: (Number(u0.CasinoChips) || 0) + chips } : {}),
      ChestLog: JSON.stringify(log)
    });
    const seen = Object.keys(log).filter((x) => !x.startsWith('classic:')).length;
    const master = seen >= FAMILY_KEYS.length * CHEST_TIERS.length && grantCosmetic(store, user.id, 'chest-master', { type: 'title', label: 'Maître des coffres' });
    // Bonus de plusieurs coffres : une ligne par ressource.
    const merged = new Map();
    for (const l of extraLines) merged.set(l.key, Math.min(RESOURCES[l.key].max * plan.length, (merged.get(l.key) || 0) + l.n));
    const bonus = giveExtras(store, user.id, [...merged].map(([key, n]) => ({ type: 'resource', key, n })), batchId);
    // Objets propres aux familles, regroupes par cle.
    const sp = new Map();
    for (const it of special) { const cur = sp.get(it.key); if (cur) { cur.amount += it.amount; cur.label = cur.many ? `+${cur.amount} ${cur.many}` : it.label.replace(/^\+\d+/, `+${cur.amount}`); } else sp.set(it.key, { ...it }); }
    user = store.get('Users', user.id);
    const items = [{ type: 'dust', amount: dust }];
    if (boosters) items.push({ type: 'booster', count: boosters });
    if (chips) items.push({ type: 'resource', key: 'chips', amount: chips, icon: '🪙', label: `+${chips} jetons de la salle` });
    items.push(...bonus, ...sp.values());
    cards.sort((a, b) => a.rarity.sortOrder - b.rarity.sortOrder).forEach((card) => items.push({ type: 'card', card }));
    const opened = plan.length;
    const tiersOpened = new Map();
    plan.forEach(({ ball }) => { const kk = `${ball.t}|${ball.f}`; tiersOpened.set(kk, (tiersOpened.get(kk) || 0) + 1); });
    const openedTiers = [...tiersOpened].map(([kk, n]) => { const [t, f] = kk.split('|'); const fam = fams.find((x) => x.key === f); return { ...tierView(store, CHEST_TIERS[Number(t) - 1]), family: f, familyLabel: fam ? fam.label : 'Classique', familyIcon: fam ? fam.icon : '🎁', opened: n }; }).sort((a, b) => b.tier - a.tier);
    const top = plan.reduce((m, x) => (x.ball.t > m.ball.t ? x : m), plan[0]);
    const topFam = top.ball.f ? fams.find((x) => x.key === top.ball.f) : null;
    return ok(statusOf(store, user, { ...extra, opened, tier: { ...tierView(store, CHEST_TIERS[top.ball.t - 1]), family: top.ball.f, familyLabel: topFam ? topFam.label : 'Classique', familyIcon: topFam ? topFam.icon : '🎁', color: (topFam && topFam.color) || CHEST_TIERS[top.ball.t - 1].color }, openedTiers, keysUsed: spent, batchId, items, dust, boosters, extras: [...bonus, ...sp.values()], firsts, masterTitle: master ? 'Maître des coffres' : null, cardCount: cards.length, newBoosterCount: user.BoosterCount, newStardust: user.StardustCount }));
  }

  if (body.action === 'open') {
    if ((Number(user.ChestCount) || 0) < 1) return fail('no_chest', 400, statusOf(store, user, extra));
    if ((Number(user.KeyCount) || 0) < 1) return fail('no_key', 400, statusOf(store, user, extra));
    const n = Math.min(countOf(body), Number(user.ChestCount) || 0, Number(user.KeyCount) || 0);
    const batchId = `lootchest-${user.id}-${Date.now()}`;
    const dMin = setting(store, 'ChestDustMin'), dMax = Math.max(dMin, setting(store, 'ChestDustMax'));
    let dust = 0, boosters = 0;
    const cards = [];
    // Chaque coffre est tire independamment ; le butin est regroupe.
    for (let i = 0; i < n; i++) {
      dust += dMin + Math.floor(Math.random() * (dMax - dMin + 1));
      boosters += Math.random() < setting(store, 'ChestDoubleBoosterChance') ? 2 : Math.random() < setting(store, 'ChestBoosterChance') ? 1 : 0;
      if (Math.random() < setting(store, 'ChestCardChance')) { const c = drawCard(store, user.id, batchId); if (c) cards.push(c); }
      if (Math.random() < setting(store, 'ChestSecondCardChance')) { const c = drawCard(store, user.id, batchId); if (c) cards.push(c); }
    }
    user = store.update('Users', user.id, {
      ChestCount: (Number(user.ChestCount) || 0) - n,
      KeyCount: (Number(user.KeyCount) || 0) - n,
      StardustCount: (Number(user.StardustCount) || 0) + dust,
      BoosterCount: (Number(user.BoosterCount) || 0) + boosters
    });
    // Ordre de revelation : poussieres, boosters, puis cartes de la moins a
    // la plus rare (le meilleur en dernier, comme a l'ouverture d'un booster).
    const bonus = giveExtras(store, user.id, rollExtras(store, n), batchId);
    user = store.get('Users', user.id);
    const items = [{ type: 'dust', amount: dust }];
    if (boosters) items.push({ type: 'booster', count: boosters });
    items.push(...bonus);
    cards.sort((a, b) => a.rarity.sortOrder - b.rarity.sortOrder).forEach((card) => items.push({ type: 'card', card }));
    return ok(statusOf(store, user, { ...extra, opened: n, batchId, items, dust, boosters, extras: bonus, cardCount: cards.length, newBoosterCount: user.BoosterCount, newStardust: user.StardustCount }));
  }

  return ok(statusOf(store, user, extra));
}

export const routes = { 'POST chests': handleChests };

// --- sources de coffres (V2) -----------------------------------------------
// Fouille profonde : un coffre enfoui (boule Explorateur) avec chaque tresor
// degage a partir de la profondeur 3 ; expedition de 8 h et plus : une piece
// Explorateur ; commande livree en cuisine : une piece Nature.
export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  if (path === 'dig' && body.action === 'dig' && response.json.revealed) {
    const depth = Number(user.DigDepth) || 1;
    if (depth >= 3 && Math.random() < setting(store, 'ChestBuriedChance') * (depth - 2)) {
      const b = addBall(store, user.id, Math.min(8, depth + Math.floor(Math.random() * 3)), 'explorer');
      if (b) { response.json.buriedChest = b; response.json.notices = [...(response.json.notices || []), { kind: 'chest', icon: '🧰', label: `Un coffre enfoui sous le trésor : ${b.name} (${b.familyLabel}), dans ton bac du gatchapon !` }]; }
    }
  } else if (path === 'expedition' && body.action === 'claim' && response.json.reward) {
    if ((Number(request._expeditionTripHours) || 0) >= 8 && Math.random() < setting(store, 'ChestExpeditionCoinChance')) {
      addCoins(store, user.id, 'explorer', 1);
      response.json.chestCoin = { family: 'explorer', label: 'pièce Explorateur' };
      response.json.notices = [...(response.json.notices || []), { kind: 'chest', icon: '🪙', label: 'Au retour de l’expédition : une pièce de gatchapon Explorateur !' }];
    }
  }
}
export function afterNative({ store, path, request, response }) {
  const body = request.body || {};
  if (path !== 'cook' || body.action !== 'deliver' || !response.json.delivered) return;
  if (Math.random() >= setting(store, 'ChestCookCoinChance')) return;
  addCoins(store, Number(body.userId), 'nature', 1);
  response.json.notices = [...(response.json.notices || []), { kind: 'chest', icon: '🪙', label: 'Le client te laisse une pièce de gatchapon Nature en pourboire !' }];
}
