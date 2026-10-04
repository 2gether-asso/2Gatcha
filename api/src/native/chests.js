// Coffres (page d'ouverture des boosters, menu Jouer) : achetes contre des
// poussieres ou gagnes en montant de niveau (1 coffre tous les 5 niveaux,
// 1 clef tous les 10), ouverts avec une clef secrete. Contenu : poussieres a
// coup sur, souvent une carte (parfois deux), parfois des boosters.
//   POST /webhook/chests  { userId, action: 'status' | 'buy' | 'open' }
// Les coffres/clefs de niveau sont attribues a chaque appel (rattrapage des
// niveaux deja atteints, une seule fois : Users.ChestLevelGranted).

import { refId, now, ok, fail, configRow, userById, levelForXp, firstAttachment } from './common.js';

export const schema = {
  Users: { ChestCount: { type: 'Numeric' }, ChestLevelGranted: { type: 'Numeric' } },
  Config: { ChestCost: { type: 'Numeric' } }
};

const CHEST_EVERY = 5, KEY_EVERY = 10;
const chestCost = (store) => Number(configRow(store).ChestCost) > 0 ? Number(configRow(store).ChestCost) : 100;

// Coffres / clefs dus pour les niveaux atteints depuis le dernier passage.
function grantLevelRewards(store, user) {
  const level = levelForXp(user.XP);
  const done = Number(user.ChestLevelGranted) || 0;
  if (level <= done) return { user, granted: null };
  const chests = Math.floor(level / CHEST_EVERY) - Math.floor(done / CHEST_EVERY);
  const keys = Math.floor(level / KEY_EVERY) - Math.floor(done / KEY_EVERY);
  const updated = store.update('Users', user.id, {
    ChestLevelGranted: level,
    ChestCount: (Number(user.ChestCount) || 0) + chests,
    KeyCount: (Number(user.KeyCount) || 0) + keys
  });
  return { user: updated, granted: chests || keys ? { chests, keys, level } : null };
}

function statusOf(store, user, extra = {}) {
  const level = levelForXp(user.XP);
  return {
    chests: Number(user.ChestCount) || 0,
    keys: Number(user.KeyCount) || 0,
    stardust: Number(user.StardustCount) || 0,
    cost: chestCost(store),
    level,
    nextChestLevel: (Math.floor(level / CHEST_EVERY) + 1) * CHEST_EVERY,
    nextKeyLevel: (Math.floor(level / KEY_EVERY) + 1) * KEY_EVERY,
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
function drawCard(store, userId, batchId) {
  const rarities = store.getAll('Rarities').filter((r) => (Number(r.Weight) || 0) > 0);
  const cards = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo);
  const pool = rarities.filter((r) => cards.some((c) => refId(c.Rarity) === r.id));
  const rarity = weighted(pool, (r) => Number(r.Weight) || 0);
  if (!rarity) return null;
  const candidates = cards.filter((c) => refId(c.Rarity) === rarity.id);
  const card = candidates[Math.floor(Math.random() * candidates.length)];
  const finishes = store.tables.has('Finishes') ? store.getAll('Finishes').filter((f) => f.Key !== 'normal' && (f.DropWeight || 0) > 0) : [];
  const finish = finishes.length && Math.random() < 0.15 ? weighted(finishes, (f) => f.DropWeight).Key : 'normal';
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

function handleChests({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const g = grantLevelRewards(store, user);
  user = g.user;
  const extra = g.granted ? { levelGrant: g.granted } : {};

  if (body.action === 'buy') {
    const cost = chestCost(store);
    if ((Number(user.StardustCount) || 0) < cost) return fail('not_enough_dust', 400, statusOf(store, user, extra));
    user = store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) - cost, ChestCount: (Number(user.ChestCount) || 0) + 1 });
    return ok(statusOf(store, user, { ...extra, bought: true }));
  }

  if (body.action === 'open') {
    if ((Number(user.ChestCount) || 0) < 1) return fail('no_chest', 400, statusOf(store, user, extra));
    if ((Number(user.KeyCount) || 0) < 1) return fail('no_key', 400, statusOf(store, user, extra));
    const batchId = `lootchest-${user.id}-${Date.now()}`;
    const dust = 40 + Math.floor(Math.random() * 81);
    const boosters = Math.random() < 0.08 ? 2 : Math.random() < 0.35 ? 1 : 0;
    const cards = [];
    if (Math.random() < 0.7) { const c = drawCard(store, user.id, batchId); if (c) cards.push(c); }
    if (Math.random() < 0.2) { const c = drawCard(store, user.id, batchId); if (c) cards.push(c); }
    user = store.update('Users', user.id, {
      ChestCount: (Number(user.ChestCount) || 0) - 1,
      KeyCount: (Number(user.KeyCount) || 0) - 1,
      StardustCount: (Number(user.StardustCount) || 0) + dust,
      BoosterCount: (Number(user.BoosterCount) || 0) + boosters
    });
    // Ordre de revelation : poussieres, boosters, puis cartes de la moins a
    // la plus rare (le meilleur en dernier, comme a l'ouverture d'un booster).
    const items = [{ type: 'dust', amount: dust }];
    if (boosters) items.push({ type: 'booster', count: boosters });
    cards.sort((a, b) => a.rarity.sortOrder - b.rarity.sortOrder).forEach((card) => items.push({ type: 'card', card }));
    return ok(statusOf(store, user, { ...extra, opened: true, batchId, items, dust, boosters, newBoosterCount: user.BoosterCount, newStardust: user.StardustCount }));
  }

  return ok(statusOf(store, user, extra));
}

export const routes = { 'POST chests': handleChests };
