// Codes & dons V2 (2026-10-26) : un seul catalogue de ce que l'equipe peut
// donner, pour les codes evenement ET les dons directs.
//  - Ressources : jetons booster, poussieres, cles, pieces de gatchapon,
//    vers, appats dores, os, pieces detachees, charges de chance, Tickets
//    Unique, fragments de booster, cranes de dino, engrais (et dore),
//    poissons pour Moka, jetons et tickets du casino, tablettes (argile,
//    pierre gravee, doree), XP x2 pendant N minutes.
//  - Cartes : une carte precise ou une carte au hasard d'une rarete, avec
//    finition, etat et edition au choix (pas l'emeraude, reservee au coffre).
//  - Cosmetiques du catalogue (titres, cadres, couleurs).
// Un code peut cumuler plusieurs lignes (EventCodes.RewardType = 'bundle',
// detail dans EventCodes.Rewards) et avoir une date de debut (StartsAt) ;
// les anciens codes (booster / carte) passent toujours par redeem-code.json.
// Un don peut viser plusieurs joueurs d'un coup.
//   POST /webhook/admin-rewards { discordId, action: 'catalog' | 'codes' | 'createCode' | 'updateCode' | 'redemptions' | 'gift' | 'preview', ... }
//   POST /webhook/redeem-code : les codes 'bundle' et la date de debut sont
//   geres ici (beforeWorkflow), avant le workflow.

import { refId, now, ok, fail, userById, isAdmin, nextSerial, firstAttachment, parseJson } from './common.js';
import { addTabletsFields } from './archeo.js';
import { EDITIONS } from './editions.js';
import { grantCosmetic, catalog as cosmeticCatalog } from './cosmetics.js';
import { addShards } from './comfort.js';

export const schema = { EventCodes: { Rewards: { type: 'Text' }, StartsAt: { type: 'Numeric' } } };

// Ressources : champ de Users, libelles, plafond par ligne.
export const RESOURCES = {
  booster: { field: 'BoosterCount', icon: '🃏', one: 'jeton booster', many: 'jetons booster', max: 500, group: 'Boosters et poussières' },
  dust: { field: 'StardustCount', icon: '✨', one: 'poussière d’étoile', many: 'poussières d’étoile', max: 1000000, group: 'Boosters et poussières' },
  shards: { field: 'BoosterShards', icon: '🧩', one: 'fragment de booster', many: 'fragments de booster', max: 1000, group: 'Boosters et poussières', shards: true },
  key: { field: 'KeyCount', icon: '🔑', one: 'clé', many: 'clés', max: 200, group: 'Coffres' },
  chest: { field: 'ChestCount', icon: '🪙', one: 'pièce de gatchapon', many: 'pièces de gatchapon', max: 200, group: 'Coffres' },
  uniqueTicket: { field: 'UniqueTickets', icon: '🎫', one: 'Ticket Unique', many: 'Tickets Unique', max: 20, group: 'Coffres' },
  part: { field: 'SpareParts', icon: '🔩', one: 'pièce détachée', many: 'pièces détachées', max: 200, group: 'Atelier' },
  luck: { field: 'LuckCharges', icon: '🧪', one: 'charge de chance', many: 'charges de chance', max: 200, group: 'Atelier' },
  xpBoost: { minutes: true, icon: '📘', one: 'minute d’XP ×2', many: 'minutes d’XP ×2', max: 1440, group: 'Atelier' },
  worms: { field: 'Worms', icon: '🪱', one: 'ver de terre', many: 'vers de terre', max: 1000, group: 'Mini-jeux' },
  bait: { field: 'GoldBait', icon: '🪝', one: 'appât doré', many: 'appâts dorés', max: 200, group: 'Mini-jeux' },
  bone: { field: 'BoneCount', icon: '🦴', one: 'os pour Milo', many: 'os pour Milo', max: 200, group: 'Mini-jeux' },
  catFish: { field: 'CatFish', icon: '🐟', one: 'poisson pour Moka', many: 'poissons pour Moka', max: 200, group: 'Mini-jeux' },
  skull: { field: 'DinoSkulls', icon: '💀', one: 'crâne de dino', many: 'crânes de dino', max: 50, group: 'Mini-jeux' },
  fertilizer: { field: 'DinoPoop', icon: '💩', one: 'engrais', many: 'engrais', max: 200, group: 'Mini-jeux' },
  goldFertilizer: { field: 'DinoGoldPoop', icon: '🌟', one: 'engrais doré', many: 'engrais dorés', max: 100, group: 'Mini-jeux' },
  tabletClay: { tablet: 'clay', icon: '🟫', one: 'tablette d’argile', many: 'tablettes d’argile', max: 20, group: 'Archéologie' },
  tabletStone: { tablet: 'stone', icon: '🪨', one: 'pierre gravée', many: 'pierres gravées', max: 20, group: 'Archéologie' },
  tabletGold: { tablet: 'gold', icon: '🟨', one: 'tablette dorée', many: 'tablettes dorées', max: 10, group: 'Archéologie' },
  chips: { field: 'CasinoChips', icon: '🪙', one: 'jeton de la salle interdite', many: 'jetons de la salle interdite', max: 10000, group: 'Salle interdite' },
  casinoTickets: { field: 'CasinoTickets', icon: '🎟️', one: 'ticket de la salle interdite', many: 'tickets de la salle interdite', max: 1000, group: 'Salle interdite' }
};
const FINISHES = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'];
const QUALITIES = ['damaged', 'worn', 'good', 'mint'];
const FINISH_LABEL = { normal: 'normale', holo: 'holo', gold: 'dorée', ghost: 'ghost', diamond: 'diamant', rainbow: 'arc-en-ciel' };
const QUALITY_LABEL = { damaged: 'usée', worn: 'abîmée', good: 'bon état', mint: 'parfait état' };
const MAX_LINES = 12, MAX_CARDS = 50, MAX_USERS = 100;
const int = (v) => Math.round(Number(v) || 0);
const rarityView = (r) => (r ? { key: r.Key, name: r.Name, colorHex: r.ColorHex } : null);

// ------------------------------------------------------------------ lignes
// Ligne propre (ou { error }) : { type: 'resource', key, n } | { type: 'card', cardId, n, finish, quality, edition }
// | { type: 'randomCard', rarity, n, finish, quality, edition } | { type: 'cosmetic', key }.
function cleanLine(store, l) {
  if (!l || typeof l !== 'object') return { error: 'invalid_reward' };
  if (l.type === 'resource') {
    const r = RESOURCES[l.key];
    const n = int(l.n);
    if (!r) return { error: 'unknown_resource' };
    if (n < 1 || n > r.max) return { error: 'invalid_amount', key: l.key, max: r.max };
    return { line: { type: 'resource', key: l.key, n } };
  }
  if (l.type === 'card' || l.type === 'randomCard') {
    const n = int(l.n) || 1;
    if (n < 1 || n > MAX_CARDS) return { error: 'invalid_amount', max: MAX_CARDS };
    const finish = FINISHES.includes(l.finish) ? l.finish : 'normal';
    const quality = QUALITIES.includes(l.quality) ? l.quality : 'good';
    const edition = l.edition && EDITIONS[l.edition] ? l.edition : '';
    if (l.edition && !edition) return { error: 'unknown_edition' };
    if (l.type === 'card') {
      const card = store.get('Cards', int(l.cardId));
      if (!card) return { error: 'card_not_found' };
      return { line: { type: 'card', cardId: card.id, n, finish, quality, edition } };
    }
    const rarity = store.getAll('Rarities').find((r) => String(r.Key || '') === String(l.rarity || ''));
    if (!rarity) return { error: 'unknown_rarity' };
    return { line: { type: 'randomCard', rarity: rarity.Key, n, finish, quality, edition } };
  }
  if (l.type === 'cosmetic') {
    const item = cosmeticCatalog(store).find((c) => c.key === String(l.key || ''));
    if (!item) return { error: 'unknown_cosmetic' };
    return { line: { type: 'cosmetic', key: item.key } };
  }
  return { error: 'invalid_reward' };
}
export function cleanRewards(store, list) {
  if (!Array.isArray(list) || !list.length) return { error: 'no_reward' };
  if (list.length > MAX_LINES) return { error: 'too_many_rewards', max: MAX_LINES };
  const out = [];
  for (const l of list) {
    const r = cleanLine(store, l);
    if (r.error) return r;
    out.push(r.line);
  }
  return { rewards: out };
}
// Texte d'une ligne (liste des codes, apercu, recu du joueur).
export function describe(store, l) {
  if (l.type === 'resource') { const r = RESOURCES[l.key]; return { icon: r ? r.icon : '🎁', label: r ? `+${l.n.toLocaleString('fr-FR')} ${l.n > 1 ? r.many : r.one}` : `+${l.n} ${l.key}` }; }
  const extra = [l.finish && l.finish !== 'normal' ? FINISH_LABEL[l.finish] : '', QUALITY_LABEL[l.quality] || '', l.edition && EDITIONS[l.edition] ? `édition ${EDITIONS[l.edition].label}` : ''].filter(Boolean).join(', ');
  if (l.type === 'card') { const c = store.get('Cards', l.cardId); return { icon: '🎴', label: `${l.n > 1 ? l.n + '× ' : ''}${c ? c.Name : 'carte #' + l.cardId}${extra ? ` (${extra})` : ''}` }; }
  if (l.type === 'randomCard') { const r = store.getAll('Rarities').find((x) => x.Key === l.rarity); return { icon: '🎲', label: `${l.n > 1 ? l.n + ' cartes' : 'Une carte'} ${r ? r.Name.toLowerCase() : l.rarity} au hasard${extra ? ` (${extra})` : ''}` }; }
  if (l.type === 'cosmetic') { const it = cosmeticCatalog(store).find((c) => c.key === l.key); return { icon: { title: '🏷️', frame: '🖼️', color: '🎨' }[it && it.type] || '🎨', label: it ? it.label : l.key }; }
  return { icon: '🎁', label: '?' };
}
// Anciens codes : la meme forme pour l'affichage.
function legacyRewards(row) {
  if (row.RewardType === 'card') return [{ type: 'card', cardId: refId(row.CardId), n: Number(row.Quantity) || 1, finish: 'normal', quality: 'good', edition: '' }];
  return [{ type: 'resource', key: 'booster', n: Number(row.Quantity) || 1 }];
}
const rewardsOf = (row) => (row.RewardType === 'bundle' ? parseJson(row.Rewards, []) || [] : legacyRewards(row));

// ------------------------------------------------------------------ attribution
function makePull(store, user, card, { finish, quality, edition }, batchId) {
  const serial = nextSerial(store, card.id);
  store.create('Pulls', { User: user.id, Card: card.id, ObtainedAt: now(), BatchId: batchId, SerialNumber: serial, Finish: finish, Quality: quality, ...(edition ? { Edition: edition } : {}) });
  const isFirst = !refId(card.FirstObtainedBy);
  if (isFirst) store.update('Cards', card.id, { FirstObtainedBy: user.id, FirstObtainedAt: now() });
  return { cardId: card.id, name: card.Name, artist: card.Artist, description: card.Description, imageId: firstAttachment(card.Image), serialNumber: serial, finish, quality, edition: edition || null, isFirstEver: isFirst, rarity: rarityView(store.get('Rarities', refId(card.Rarity))) };
}
// Donne les lignes a un joueur. Renvoie { rewards: [{ icon, label }], cards }.
export function grant(store, userId, rewards, batchId) {
  let user = store.get('Users', userId);
  const lines = [], cards = [];
  const fields = {};
  const val = (f) => (fields[f] ?? (Number(user[f]) || 0));
  for (const l of rewards) {
    if (l.type === 'resource') {
      const r = RESOURCES[l.key];
      if (!r) continue;
      if (r.field && !r.shards) fields[r.field] = val(r.field) + l.n;
      else if (r.tablet) Object.assign(fields, addTabletsFields({ ...user, ...fields }, r.tablet, l.n));
      else if (r.minutes) { const until = Math.max(now(), Number(user.XpBoostUntil) || 0); fields.XpBoostUntil = until + l.n * 60; }
      lines.push(describe(store, l));
    } else if (l.type === 'card') {
      const card = store.get('Cards', l.cardId);
      if (!card) continue;
      for (let i = 0; i < l.n; i++) cards.push(makePull(store, user, card, l, batchId));
      lines.push(describe(store, l));
    } else if (l.type === 'randomCard') {
      const rarity = store.getAll('Rarities').find((x) => x.Key === l.rarity);
      const pool = rarity ? store.getAll('Cards').filter((c) => c.Active && !c.IsPromo && !c.IsSecret && !c.IsVault && refId(c.Rarity) === rarity.id) : [];
      if (!pool.length) continue;
      for (let i = 0; i < l.n; i++) cards.push(makePull(store, user, pool[Math.floor(Math.random() * pool.length)], l, batchId));
      lines.push(describe(store, l));
    } else if (l.type === 'cosmetic') {
      const it = cosmeticCatalog(store).find((c) => c.key === l.key);
      if (!it) continue;
      grantCosmetic(store, user.id, it.key, { type: it.type, label: it.label });
      lines.push(describe(store, l));
    }
  }
  if (Object.keys(fields).length) user = store.update('Users', user.id, fields);
  // Fragments : par addShards (un booster complet est converti tout de suite).
  for (const l of rewards) if (l.type === 'resource' && RESOURCES[l.key] && RESOURCES[l.key].shards) addShards(store, user.id, l.n);
  return { rewards: lines, cards };
}

// ------------------------------------------------------------------ codes
const norm = (c) => String(c || '').trim().toLowerCase();
const codeRows = (store) => (store.tables.has('EventCodes') ? store.getAll('EventCodes') : []);
const redemptionRows = (store) => (store.tables.has('CodeRedemptions') ? store.getAll('CodeRedemptions') : []);
function statusOf(row, used, t = now()) {
  if (row.Active === false) return 'disabled';
  if (row.ExpiresAt && t > row.ExpiresAt) return 'expired';
  if (row.StartsAt && t < row.StartsAt) return 'scheduled';
  if (row.MaxRedemptions && used >= row.MaxRedemptions) return 'exhausted';
  return 'active';
}
function codeView(store, row, used) {
  const rewards = rewardsOf(row);
  return {
    code: row.Code, label: row.Label || '', kind: row.RewardType === 'bundle' ? 'bundle' : row.RewardType || 'booster',
    rewards, lines: rewards.map((l) => describe(store, l)), used, maxRedemptions: Number(row.MaxRedemptions) || 0,
    startsAt: Number(row.StartsAt) || null, expiresAt: Number(row.ExpiresAt) || null, createdAt: Number(row.CreatedAt) || null, createdBy: row.CreatedBy || '',
    active: row.Active !== false, status: statusOf(row, used)
  };
}
function listCodes(store) {
  const counts = new Map();
  redemptionRows(store).forEach((r) => counts.set(refId(r.Code), (counts.get(refId(r.Code)) || 0) + 1));
  return codeRows(store).map((r) => codeView(store, r, counts.get(r.id) || 0)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function createCode(store, body) {
  const r = cleanRewards(store, body.rewards);
  if (r.error) return fail(r.error, 400, r);
  const code = (String(body.code || '').trim().toUpperCase() || randomCode());
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return fail('invalid_code_format');
  if (codeRows(store).some((c) => norm(c.Code) === norm(code))) return fail('code_taken');
  const t = now();
  const startsAt = int(body.startsAt) > t ? int(body.startsAt) : 0;
  const expiresAt = int(body.expiresAt) || t + 4 * 3600;
  if (expiresAt <= Math.max(t, startsAt)) return fail('invalid_dates');
  const row = store.create('EventCodes', {
    Code: code, Label: String(body.label || '').slice(0, 60), RewardType: 'bundle', Quantity: 1, CardId: 0,
    MaxRedemptions: Math.max(0, int(body.maxRedemptions)), ExpiresAt: expiresAt, StartsAt: startsAt, CreatedAt: t, CreatedBy: String(body.discordId || ''),
    Active: true, Rewards: JSON.stringify(r.rewards)
  });
  return ok({ created: codeView(store, row, 0), codes: listCodes(store) });
}
function updateCode(store, body) {
  const row = codeRows(store).find((c) => norm(c.Code) === norm(body.code));
  if (!row) return fail('code_not_found', 404);
  const fields = {};
  if (body.active != null) fields.Active = !!body.active;
  if (body.expiresAt != null) fields.ExpiresAt = int(body.expiresAt);
  if (body.startsAt != null) fields.StartsAt = int(body.startsAt) || 0;
  if (body.maxRedemptions != null) fields.MaxRedemptions = Math.max(0, int(body.maxRedemptions));
  if (body.label != null) fields.Label = String(body.label).slice(0, 60);
  if (body.rewards != null) {
    if (row.RewardType !== 'bundle') return fail('legacy_code');
    const r = cleanRewards(store, body.rewards);
    if (r.error) return fail(r.error, 400, r);
    fields.Rewards = JSON.stringify(r.rewards);
  }
  const exp = fields.ExpiresAt ?? row.ExpiresAt, start = fields.StartsAt ?? row.StartsAt;
  if (exp && start && exp <= start) return fail('invalid_dates');
  store.update('EventCodes', row.id, fields);
  return ok({ codes: listCodes(store) });
}
function redemptions(store, body) {
  const row = codeRows(store).find((c) => norm(c.Code) === norm(body.code));
  if (!row) return fail('code_not_found', 404);
  const list = redemptionRows(store).filter((r) => refId(r.Code) === row.id).map((r) => { const u = store.get('Users', refId(r.User)); return { userId: refId(r.User), pseudo: u ? u.Pseudo : '?', at: Number(r.RedeemedAt) || null }; }).sort((a, b) => (b.at || 0) - (a.at || 0));
  return ok({ code: row.Code, redemptions: list });
}

// ------------------------------------------------------------------ dons
function gift(store, body) {
  const r = cleanRewards(store, body.rewards);
  if (r.error) return fail(r.error, 400, r);
  const ids = [...new Set((Array.isArray(body.userIds) ? body.userIds : [body.userId]).map(int).filter(Boolean))];
  if (!ids.length) return fail('no_user');
  if (ids.length > MAX_USERS) return fail('too_many_users', 400, { max: MAX_USERS });
  const users = ids.map((id) => store.get('Users', id));
  if (users.some((u) => !u)) return fail('unknown_user', 404);
  const results = users.map((u) => ({ userId: u.id, pseudo: u.Pseudo, ...grant(store, u.id, r.rewards, `admin-gift-${u.id}-${Date.now()}`) }));
  return ok({ gifted: results.length, results: results.map((x) => ({ userId: x.userId, pseudo: x.pseudo, rewards: x.rewards, cards: x.cards.length })) });
}

// ------------------------------------------------------------------ route admin
function catalog(store) {
  return {
    resources: Object.entries(RESOURCES).map(([key, r]) => ({ key, icon: r.icon, label: r.many, max: r.max, group: r.group })),
    finishes: FINISHES.map((k) => ({ key: k, label: FINISH_LABEL[k] })), qualities: QUALITIES.map((k) => ({ key: k, label: QUALITY_LABEL[k] })),
    editions: Object.entries(EDITIONS).map(([key, e]) => ({ key, label: e.label, icon: e.icon })),
    rarities: store.getAll('Rarities').sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0)).map((r) => ({ key: r.Key, name: r.Name, colorHex: r.ColorHex })),
    cosmetics: cosmeticCatalog(store).map((c) => ({ key: c.key, type: c.type, label: c.label })),
    limits: { lines: MAX_LINES, cards: MAX_CARDS, users: MAX_USERS }
  };
}
function handleAdmin({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const action = body.action || 'catalog';
  if (action === 'catalog') return ok(catalog(store));
  if (action === 'codes') return ok({ codes: listCodes(store) });
  if (action === 'createCode') return createCode(store, body);
  if (action === 'updateCode') return updateCode(store, body);
  if (action === 'redemptions') return redemptions(store, body);
  if (action === 'gift') return gift(store, body);
  if (action === 'preview') { const r = cleanRewards(store, body.rewards); return r.error ? fail(r.error, 400, r) : ok({ lines: r.rewards.map((l) => describe(store, l)) }); }
  return fail('unknown_action');
}
export const routes = { 'POST admin-rewards': handleAdmin };

// ------------------------------------------------------------------ reclamation
// Codes 'bundle' et date de debut (tous codes) : avant le workflow.
export function beforeWorkflow({ store, path, request }) {
  if (path !== 'redeem-code') return null;
  const body = (request && request.body) || {};
  const row = codeRows(store).find((c) => norm(c.Code) === norm(body.code));
  if (!row) return null;
  const t = now();
  if (row.StartsAt && t < row.StartsAt && row.Active !== false) return fail('code_not_started', 400, { startsAt: row.StartsAt });
  if (row.RewardType !== 'bundle') return null;
  if (row.Active === false) return fail('code_inactive');
  if (row.ExpiresAt && t > row.ExpiresAt) return fail('code_expired');
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const mine = redemptionRows(store).filter((r) => refId(r.Code) === row.id);
  if (mine.some((r) => refId(r.User) === user.id)) return fail('already_redeemed');
  if (row.MaxRedemptions && mine.length >= row.MaxRedemptions) return fail('code_exhausted');
  const rewards = parseJson(row.Rewards, []) || [];
  if (!rewards.length) return fail('code_misconfigured');
  store.create('CodeRedemptions', { Code: row.id, User: user.id, RedeemedAt: t });
  const g = grant(store, user.id, rewards, `code-${row.Code}-${Date.now()}`);
  return ok({ type: 'reward', source: 'event', title: row.Label || 'Code événement', rewards: g.rewards, cards: g.cards, newBoosterCount: Number(store.get('Users', user.id).BoosterCount) || 0 });
}
