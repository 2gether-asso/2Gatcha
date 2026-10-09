// Pity par rarete et booster mystere (2026-10-09).
//  - Pity par rarete : pour chaque rarete peu frequente (moins de 15 % des
//    tirages), un compteur par joueur avance a chaque carte tiree et retombe
//    a 0 des qu'une carte de cette rarete (ou mieux) sort. Au seuil
//    (RarityPityMultiplier x tirages moyens pour l'obtenir), la plus petite
//    carte du booster est remplacee par une carte de cette rarete. La
//    rarete du pity du workflow (Config.TopRarity) garde son propre compteur.
//  - Booster mystere : open-pack { mystery: true } tire l'extension au
//    hasard parmi les extensions actives ; bonus de finition speciale
//    (MysteryFinishBonus, applique par boosts.js).
//   GET /webhook/rarity-pity ?userId=&extensionId= -> { rarities: [{ key, name, colorHex, threshold, left }] }

import { refId, ok, fail, userById, configRow, firstAttachment } from './common.js';
import { setting } from './settings.js';

export const schema = {
  Users: { RarityPity: { type: 'Text' } }
};

const parse = (v, def) => { try { const x = JSON.parse(v || ''); return x == null ? def : x; } catch (e) { return def; } };

// Raretes suivies et leur seuil.
export function pityRarities(store) {
  const mult = setting(store, 'RarityPityMultiplier');
  if (!(mult > 0)) return [];
  const all = store.getAll('Rarities').filter((r) => r.Key !== 'unique' && (Number(r.Weight) || 0) > 0);
  const total = all.reduce((s, r) => s + (Number(r.Weight) || 0), 0) || 1;
  const cfg = configRow(store);
  const top = Number(cfg.PityThreshold) > 0 ? refId(cfg.TopRarity) : null;
  return all
    .filter((r) => (Number(r.Weight) || 0) / total < 0.15 && r.id !== top)
    .sort((a, b) => (b.SortOrder || 0) - (a.SortOrder || 0))
    .map((r) => ({ r, threshold: Math.ceil((mult * total) / (Number(r.Weight) || 1)) }));
}

function nextSerial(store, cardId) {
  const used = new Set(store.getAll('Pulls').filter((p) => refId(p.Card) === cardId).map((p) => p.SerialNumber));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

// Extensions qu'un booster mystere peut tirer.
export function mysteryPool(store) {
  const exts = store.tables.has('Extensions') ? store.getAll('Extensions').filter((e) => e.Active !== false) : [];
  const cards = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo);
  return exts.filter((e) => cards.some((c) => refId(c.Extension) === e.id));
}

export function beforeWorkflow({ store, path, request }) {
  const body = request.body || {};
  if (path !== 'open-pack' || !body.mystery) return null;
  const pool = mysteryPool(store);
  if (!pool.length) return { status: 400, json: { error: 'no_extension' } };
  const ext = pool[Math.floor(Math.random() * pool.length)];
  request.body = { ...body, extensionId: ext.id };
  request._mystery = { extensionId: ext.id, name: ext.Name };
  return null;
}

export function afterWorkflow({ store, path, request, response }) {
  const body = request.body || {};
  if (path !== 'open-pack' || body.dryRun || response.status !== 200 || !response.json || !Array.isArray(response.json.cards) || !response.json.batchId) return;
  const json = response.json;
  if (request._mystery) json.mystery = request._mystery;
  const userId = Number(body.userId);
  const user = store.get('Users', userId);
  if (!user) return;
  const tracked = pityRarities(store);
  if (!tracked.length) return;
  const sortOf = (c) => (c.rarity && c.rarity.sortOrder != null ? Number(c.rarity.sortOrder) : (store.get('Rarities', Number(c.rarity && c.rarity.id)) || {}).SortOrder || 0);
  const counts = parse(user.RarityPity, {});
  const extId = Number((json.booster && json.booster.extensionId) || body.extensionId);
  let upgraded = false;
  for (const { r, threshold } of tracked) {
    const order = r.SortOrder || 0;
    if (json.cards.some((c) => sortOf(c) >= order)) { counts[r.id] = 0; continue; }
    counts[r.id] = (Number(counts[r.id]) || 0) + json.cards.length;
    if (upgraded || counts[r.id] < threshold) continue;
    const pool = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo && refId(c.Extension) === extId && refId(c.Rarity) === r.id);
    if (!pool.length) continue;
    // La plus petite carte du booster (hors carte bonus) devient la garantie.
    const pulls = store.getAll('Pulls').filter((p) => p.BatchId === json.batchId && refId(p.User) === userId);
    const target = [...json.cards].filter((c) => !c.isBonusCard).sort((a, b) => sortOf(a) - sortOf(b))
      .find((c) => pulls.some((p) => refId(p.Card) === c.cardId && p.SerialNumber === c.serialNumber));
    if (!target) continue;
    const pull = pulls.find((p) => refId(p.Card) === target.cardId && p.SerialNumber === target.serialNumber);
    const card = pool[Math.floor(Math.random() * pool.length)];
    const serial = nextSerial(store, card.id);
    store.update('Pulls', pull.id, { Card: card.id, SerialNumber: serial });
    const first = !card.FirstObtainedBy;
    if (first && 'FirstObtainedBy' in card) store.update('Cards', card.id, { FirstObtainedBy: userId });
    Object.assign(target, {
      cardId: card.id, name: card.Name, artist: card.Artist, description: card.Description, imageId: firstAttachment(card.Image),
      rarity: { id: r.id, name: r.Name, key: r.Key, colorHex: r.ColorHex, sortOrder: order },
      serialNumber: serial, isFirstEver: first, pityUpgrade: true
    });
    counts[r.id] = 0;
    upgraded = true;
    json.rarityPity = { key: r.Key, name: r.Name };
  }
  // Une carte plus rare sortie grace au pity remet aussi a zero les raretes en dessous.
  if (upgraded) for (const { r } of tracked) if (json.cards.some((c) => sortOf(c) >= (r.SortOrder || 0))) counts[r.id] = 0;
  json.cards.sort((a, b) => sortOf(a) - sortOf(b));
  store.update('Users', userId, { RarityPity: JSON.stringify(counts) });
}

function handleStatus({ store, query }) {
  const user = userById(store, query.userId);
  if (!user) return fail('unknown_user', 404);
  const counts = parse(user.RarityPity, {});
  const list = pityRarities(store).map(({ r, threshold }) => ({ key: r.Key, name: r.Name, colorHex: r.ColorHex, sortOrder: r.SortOrder || 0, threshold, left: Math.max(1, threshold - (Number(counts[r.id]) || 0)) }));
  // Pity historique du workflow (rarete du sommet, compteur par extension).
  const cfg = configRow(store);
  const top = Number(cfg.PityThreshold) > 0 ? store.get('Rarities', refId(cfg.TopRarity)) : null;
  const extId = Number(query.extensionId);
  if (top && extId && store.tables.has('BoosterInventory')) {
    const inv = store.getAll('BoosterInventory').find((x) => refId(x.User) === user.id && refId(x.Extension) === extId);
    list.unshift({ key: top.Key, name: top.Name, colorHex: top.ColorHex, sortOrder: top.SortOrder || 0, threshold: Number(cfg.PityThreshold), left: Math.max(1, Number(cfg.PityThreshold) - (Number(inv && inv.PullsSinceTopRarity) || 0)), perExtension: true });
  }
  list.sort((a, b) => b.sortOrder - a.sortOrder);
  return ok({ rarities: list, mystery: { extensions: mysteryPool(store).length, finishBonus: setting(store, 'MysteryFinishBonus') } });
}

export const routes = { 'GET rarity-pity': handleStatus };
