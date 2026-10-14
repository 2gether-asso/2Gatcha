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
//  - Pity "carte manquante" (2026-10-11) : la carte garantie par un pity
//    (par rarete, ou celui du workflow pour Config.TopRarity) est en
//    priorite une carte que le joueur n'a pas encore dans cette extension.
//   GET /webhook/rarity-pity ?userId=&extensionId= -> { rarities: [{ key, name, colorHex, threshold, left }] }

import { refId, ok, fail, userById, configRow, firstAttachment, parseJson as parse } from './common.js';
import { setting } from './settings.js';
import { modeIs } from './modeperks.js';

export const schema = {
  Users: { RarityPity: { type: 'Text' } }
};


// Raretes suivies et leur seuil.
function pityRarities(store) {
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

// Cartes possedees par le joueur hors de ce booster.
function ownedBefore(store, userId, batchId) {
  return new Set(store.getAll('Pulls').filter((p) => refId(p.User) === userId && p.BatchId !== batchId).map((p) => refId(p.Card)));
}
const preferMissing = (pool, owned) => { const miss = pool.filter((c) => !owned.has(c.id)); return miss.length ? miss : pool; };

// Remplace la carte d'un exemplaire du booster (ligne Pulls + reponse).
function swapCard(store, userId, pull, target, card, rarity) {
  const serial = nextSerial(store, card.id);
  store.update('Pulls', pull.id, { Card: card.id, SerialNumber: serial });
  const first = !card.FirstObtainedBy;
  if (first && 'FirstObtainedBy' in card) store.update('Cards', card.id, { FirstObtainedBy: userId });
  Object.assign(target, {
    cardId: card.id, name: card.Name, artist: card.Artist, description: card.Description, imageId: firstAttachment(card.Image),
    rarity: { id: rarity.id, name: rarity.Name, key: rarity.Key, colorHex: rarity.ColorHex, sortOrder: rarity.SortOrder || 0 },
    serialNumber: serial, isFirstEver: first
  });
}

// Extensions qu'un booster mystere peut tirer.
function mysteryPool(store) {
  const exts = store.tables.has('Extensions') ? store.getAll('Extensions').filter((e) => e.Active !== false) : [];
  const cards = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo);
  return exts.filter((e) => cards.some((c) => refId(c.Extension) === e.id));
}

function rememberTopPity(store, request) {
  const body = request.body || {};
  if (body.dryRun || !store.tables.has('BoosterInventory')) return;
  const inv = store.getAll('BoosterInventory').find((x) => refId(x.User) === Number(body.userId) && refId(x.Extension) === Number(body.extensionId));
  request._topPityBefore = inv ? Number(inv.PullsSinceTopRarity) || 0 : 0;
}

export function beforeWorkflow({ store, path, request }) {
  const body = request.body || {};
  if (path !== 'open-pack') return null;
  if (!body.mystery) { rememberTopPity(store, request); return null; }
  const pool = mysteryPool(store);
  if (!pool.length) return { status: 400, json: { error: 'no_extension' } };
  const ext = pool[Math.floor(Math.random() * pool.length)];
  request.body = { ...body, extensionId: ext.id };
  request._mystery = { extensionId: ext.id, name: ext.Name };
  rememberTopPity(store, request);
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
  const extId0 = Number((json.booster && json.booster.extensionId) || body.extensionId);
  const owned = ownedBefore(store, userId, json.batchId);
  const pullsOf = () => store.getAll('Pulls').filter((p) => p.BatchId === json.batchId && refId(p.User) === userId);
  const cfg = configRow(store);
  const topId = Number(cfg.PityThreshold) > 0 ? refId(cfg.TopRarity) : null;
  if (topId && request._topPityBefore != null && request._topPityBefore + json.cards.length >= Number(cfg.PityThreshold)) {
    const target = json.cards.find((c) => c.rarity && Number(c.rarity.id) === topId && owned.has(c.cardId));
    const rarity = store.get('Rarities', topId);
    const pull = target && pullsOf().find((p) => refId(p.Card) === target.cardId && p.SerialNumber === target.serialNumber);
    const missing = rarity ? store.getAll('Cards').filter((c) => c.Active && !c.IsPromo && refId(c.Extension) === extId0 && refId(c.Rarity) === topId && !owned.has(c.id)) : [];
    if (pull && missing.length) {
      swapCard(store, userId, pull, target, missing[Math.floor(Math.random() * missing.length)], rarity);
      target.pityUpgrade = true;
      json.missingPity = { key: rarity.Key, name: rarity.Name };
    }
  }
  const sortOfC = (c) => (c.rarity && c.rarity.sortOrder != null ? Number(c.rarity.sortOrder) : (store.get('Rarities', Number(c.rarity && c.rarity.id)) || {}).SortOrder || 0);
  const rarById = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  // Medium : booster a double tranchant -> 3 cartes, dont une rare (ou mieux) garantie.
  if (request._edge) {
    const ps = pullsOf();
    const sorted = [...json.cards].sort((a, b) => sortOfC(b) - sortOfC(a));
    const keep = sorted.slice(0, 3);
    for (const c of sorted.slice(3)) { const p = ps.find((x) => refId(x.Card) === c.cardId && x.SerialNumber === c.serialNumber); if (p) store.delete('Pulls', p.id); }
    json.cards = json.cards.filter((c) => keep.includes(c));
    const ordered = [...rarById.values()].filter((r) => r.Key !== 'unique' && (Number(r.Weight) || 0) > 0).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
    const rareRank = ordered[1] ? ordered[1].SortOrder || 0 : 0;
    if (ordered.length > 1 && !json.cards.some((c) => sortOfC(c) >= rareRank)) {
      const upper = ordered.slice(1);
      let roll = Math.random() * upper.reduce((s, r) => s + (Number(r.Weight) || 0), 0);
      let rar = upper[0];
      for (const r of upper) { roll -= Number(r.Weight) || 0; if (roll <= 0) { rar = r; break; } }
      const pool = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo && refId(c.Extension) === extId0 && refId(c.Rarity) === rar.id);
      const target = [...json.cards].sort((a, b) => sortOfC(a) - sortOfC(b))[0];
      const pull = target && pullsOf().find((p) => refId(p.Card) === target.cardId && p.SerialNumber === target.serialNumber);
      if (pool.length && pull) { const choices = preferMissing(pool, owned); swapCard(store, userId, pull, target, choices[Math.floor(Math.random() * choices.length)], rar); target.pityUpgrade = true; }
    }
    json.edge = true;
  }
  // Chill : un doublon sur dix devient une carte manquante de la meme rarete.
  if (modeIs(store, 'chill')) {
    let lucky = 0;
    const inPack = new Set(json.cards.map((c) => c.cardId));
    for (const c of json.cards) {
      if (!owned.has(c.cardId) || Math.random() >= setting(store, 'ChillLuckyDuplicateChance')) continue;
      const rid = Number(c.rarity && c.rarity.id);
      const pool = store.getAll('Cards').filter((x) => x.Active && !x.IsPromo && refId(x.Extension) === extId0 && refId(x.Rarity) === rid && !owned.has(x.id) && !inPack.has(x.id));
      const pull = pullsOf().find((p) => refId(p.Card) === c.cardId && p.SerialNumber === c.serialNumber);
      if (!pool.length || !pull || !rarById.get(rid)) continue;
      const card = pool[Math.floor(Math.random() * pool.length)];
      swapCard(store, userId, pull, c, card, rarById.get(rid));
      c.luckySwap = true;
      inPack.add(card.id);
      lucky++;
    }
    if (lucky) json.luckyDuplicates = lucky;
  }
  const tracked = pityRarities(store);
  if (!tracked.length) return;
  const sortOf = (c) => (c.rarity && c.rarity.sortOrder != null ? Number(c.rarity.sortOrder) : (store.get('Rarities', Number(c.rarity && c.rarity.id)) || {}).SortOrder || 0);
  const counts = parse(user.RarityPity, {});
  const extId = Number((json.booster && json.booster.extensionId) || body.extensionId);
  let upgraded = false;
  for (const { r, threshold } of tracked) {
    const order = r.SortOrder || 0;
    if (json.cards.some((c) => sortOf(c) >= order)) { counts[r.id] = 0; continue; }
    const dow = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()) + 'T12:00:00Z').getUTCDay();
    const pace = modeIs(store, 'chill') && (dow === 0 || dow === 6) ? 2 : 1;
    counts[r.id] = (Number(counts[r.id]) || 0) + json.cards.length * pace;
    if (upgraded || counts[r.id] < threshold) continue;
    const pool = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo && refId(c.Extension) === extId && refId(c.Rarity) === r.id);
    if (!pool.length) continue;
    // La plus petite carte du booster (hors carte bonus) devient la garantie.
    const pulls = store.getAll('Pulls').filter((p) => p.BatchId === json.batchId && refId(p.User) === userId);
    const target = [...json.cards].filter((c) => !c.isBonusCard).sort((a, b) => sortOf(a) - sortOf(b))
      .find((c) => pulls.some((p) => refId(p.Card) === c.cardId && p.SerialNumber === c.serialNumber));
    if (!target) continue;
    const pull = pulls.find((p) => refId(p.Card) === target.cardId && p.SerialNumber === target.serialNumber);
    const choices = preferMissing(pool, owned);
    swapCard(store, userId, pull, target, choices[Math.floor(Math.random() * choices.length)], r);
    target.pityUpgrade = true;
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
