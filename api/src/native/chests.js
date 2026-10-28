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

import { refId, now, ok, fail, userById, levelForXp, firstAttachment } from './common.js';
import { setting } from './settings.js';
import { price as indexed } from './inflation.js';
import { visualLabel } from './visuals.js';
import { RESOURCES, grant } from './rewards.js';

export const schema = {
  Users: { ChestCount: { type: 'Numeric' }, ChestLevelGranted: { type: 'Numeric' }, ChestBalls: { type: 'Text' } }
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
const ballsOf = (user) => { try { const b = JSON.parse(user.ChestBalls || '[]'); return Array.isArray(b) ? b.filter((t) => t >= 1 && t <= 8) : []; } catch (e) { return []; } };
const tierArt = (t) => `Coffres/${t === 4 ? '4.png' : t + '.PNG'}`;
const tierView = (store, t) => ({ ...t, name: visualLabel(store, tierArt(t.tier), t.name) });
function tiersInfo(store, balls) {
  const w = tierWeights(store), m = tierMults(store);
  const total = w.reduce((s, x) => s + x, 0) || 1;
  return CHEST_TIERS.map((t, i) => ({ ...tierView(store, t), chance: Math.round((w[i] / total) * 1000) / 10, mult: m[i], balls: balls.filter((b) => b === t.tier).length }));
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
  return {
    balls: balls.length,
    tiers: tiersInfo(store, balls),
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
function drawCard(store, userId, batchId, { tilt = 1, finishK = 1 } = {}) {
  const rarities = store.getAll('Rarities').filter((r) => (Number(r.Weight) || 0) > 0);
  const cards = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo);
  const pool = rarities.filter((r) => cards.some((c) => refId(c.Rarity) === r.id)).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  // Gros paliers du gatchapon : les raretes hautes pesent plus lourd.
  const rarity = weighted(pool, (r) => (Number(r.Weight) || 0) * Math.pow(tilt, pool.indexOf(r) * 0.35));
  if (!rarity) return null;
  const candidates = cards.filter((c) => refId(c.Rarity) === rarity.id);
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
function rollExtras(store, n, k = 1) {
  const rows = (setting(store, 'ChestExtraLoot') || []).filter((l) => l && RESOURCES[l.key]);
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

  if (body.action === 'spin') {
    const have = Number(user.ChestCount) || 0;
    if (have < 1) return fail('no_chest', 400, statusOf(store, user, extra));
    const n = Math.min(countOf(body), have);
    const drawn = Array.from({ length: n }, () => drawTier(store));
    user = store.update('Users', user.id, { ChestCount: have - n, ChestBalls: JSON.stringify([...ballsOf(user), ...drawn]) });
    return ok(statusOf(store, user, { ...extra, spun: n, drawn: drawn.map((t) => tierView(store, CHEST_TIERS[t - 1])) }));
  }

  // Une boule d'un palier (tier), ou toutes les boules d'un coup (all,
  // 2026-10-30 : « Ouvrir tous les coffres », une seule ouverture, les plus
  // beaux paliers d'abord si les clefs manquent ; au plus ALL_MAX).
  if (body.action === 'open' && (body.tier != null || body.all)) {
    const balls = ballsOf(user);
    const keys = Number(user.KeyCount) || 0;
    const plan = [];
    if (body.all) {
      if (!balls.length) return fail('no_ball', 400, statusOf(store, user, extra));
      if (keys < 1) return fail('no_key', 400, statusOf(store, user, extra));
      let left = Math.min(keys, ALL_MAX);
      for (let t = 8; t >= 1 && left > 0; t--) { const n = Math.min(left, balls.filter((b) => b === t).length); if (n) { plan.push([t, n]); left -= n; } }
    } else {
      const tier = Math.floor(Number(body.tier));
      const mine = balls.filter((b) => b === tier).length;
      if (!(tier >= 1 && tier <= 8) || !mine) return fail('no_ball', 400, statusOf(store, user, extra));
      if (keys < 1) return fail('no_key', 400, statusOf(store, user, extra));
      plan.push([tier, Math.min(countOf(body), mine, keys)]);
    }
    const batchId = `lootchest-${user.id}-${Date.now()}`;
    const dMin = setting(store, 'ChestDustMin'), dMax = Math.max(dMin, setting(store, 'ChestDustMax'));
    let dust = 0, boosters = 0, opened = 0;
    const cards = [], extraLines = [];
    const rest = [...balls];
    for (const [tier, n] of plan) {
      const { k, mult } = tierFactor(store, tier);
      const p = (key) => Math.min(1, setting(store, key) * k);
      for (let i = 0; i < n; i++) {
        dust += Math.round((dMin + Math.floor(Math.random() * (dMax - dMin + 1))) * k);
        boosters += Math.random() < Math.min(0.9, p('ChestDoubleBoosterChance')) ? 2 : Math.random() < p('ChestBoosterChance') ? 1 : 0;
        const opts = { tilt: mult, finishK: Math.max(1, k) };
        if (Math.random() < p('ChestCardChance')) { const c = drawCard(store, user.id, batchId, opts); if (c) cards.push(c); }
        if (Math.random() < p('ChestSecondCardChance')) { const c = drawCard(store, user.id, batchId, opts); if (c) cards.push(c); }
        rest.splice(rest.indexOf(tier), 1);
      }
      extraLines.push(...rollExtras(store, n, k));
      opened += n;
    }
    user = store.update('Users', user.id, {
      ChestBalls: JSON.stringify(rest),
      KeyCount: keys - opened,
      StardustCount: (Number(user.StardustCount) || 0) + dust,
      BoosterCount: (Number(user.BoosterCount) || 0) + boosters
    });
    // Bonus de plusieurs paliers : une ligne par ressource.
    const merged = new Map();
    for (const l of extraLines) merged.set(l.key, Math.min(RESOURCES[l.key].max * plan.length, (merged.get(l.key) || 0) + l.n));
    const bonus = giveExtras(store, user.id, [...merged].map(([key, n]) => ({ type: 'resource', key, n })), batchId);
    user = store.get('Users', user.id);
    const items = [{ type: 'dust', amount: dust }];
    if (boosters) items.push({ type: 'booster', count: boosters });
    items.push(...bonus);
    cards.sort((a, b) => a.rarity.sortOrder - b.rarity.sortOrder).forEach((card) => items.push({ type: 'card', card }));
    const tiers = plan.map(([t, n]) => ({ ...tierView(store, CHEST_TIERS[t - 1]), opened: n }));
    return ok(statusOf(store, user, { ...extra, opened, tier: body.all ? null : tierView(store, CHEST_TIERS[plan[0][0] - 1]), ...(body.all ? { openedTiers: tiers } : {}), batchId, items, dust, boosters, extras: bonus, cardCount: cards.length, newBoosterCount: user.BoosterCount, newStardust: user.StardustCount }));
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
