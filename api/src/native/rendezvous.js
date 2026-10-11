// Rendez-vous reguliers (2026-10-11).
//  - Visite du chien : chaque jour, le chien rapporte une petite trouvaille
//    (vers, poussieres, appat, piece, cle, fragments), a recuperer avant minuit.
//  - Marche du dimanche : une selection personnelle de 4 cartes (en priorite
//    celles qui manquent) a prix reduit en poussieres, valable une journee.
//  - Cadeaux entre joueurs : une fois par jour, offrir un petit cadeau (vers,
//    poussieres ou appat) a un autre joueur ; il le recoit en passant sur le
//    site (7 jours pour le recuperer). Le cadeau ne coute rien a l'expediteur.
//  - Recapitulatif de la semaine passee : nouvelles cartes, meilleurs tirages,
//    boosters ouverts, progression de la collection, place sur le serveur.
//   POST /webhook/dog-gift       { userId, action: 'status' | 'claim' }
//   POST /webhook/sunday-market  { userId, action: 'status' | 'buy', cardId? }
//   POST /webhook/player-gift    { userId, action: 'status' | 'send' | 'claim', toUserId?, kind? }
//   GET  /webhook/weekly-recap   ?userId=

import { refId, now, ok, fail, userById, parisDay, cardSummary, parseJson } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';
import { parisEpoch } from './daily.js';

export const schema = {
  Users: { DogGiftDay: { type: 'Text' }, SundayBought: { type: 'Text' }, GiftSentDay: { type: 'Text' } },
  PlayerGifts: { From: { type: 'Ref:Users' }, To: { type: 'Ref:Users' }, Kind: { type: 'Text' }, Amount: { type: 'Numeric' }, At: { type: 'Numeric' }, Claimed: { type: 'Bool' } }
};

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let h = hash(seed); return () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return h / 4294967296; }; };
const addNum = (user, field, n) => (Number(user[field]) || 0) + n;

// ------------------------------------------------------------------ visite du chien
const DOG_LOOT = [
  { type: 'worms', weight: 35, min: 2, max: 4, icon: '🪱', label: (n) => `${n} vers de terre`, field: 'Worms' },
  { type: 'dust', weight: 30, min: 20, max: 60, icon: '✨', label: (n) => `${n} poussières`, field: 'StardustCount' },
  { type: 'bait', weight: 15, min: 1, max: 1, icon: '🪝', label: () => 'un appât doré', field: 'GoldBait' },
  { type: 'part', weight: 10, min: 1, max: 1, icon: '🔩', label: () => 'une pièce détachée', field: 'SpareParts' },
  { type: 'shards', weight: 6, min: 2, max: 2, icon: '🧩', label: (n) => `${n} fragments de booster`, field: 'BoosterShards' },
  { type: 'key', weight: 4, min: 1, max: 1, icon: '🔑', label: () => 'une clé', field: 'KeyCount' }
];

function handleDogGift({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const today = parisDay(0);
  const available = !!setting(store, 'DogGiftEnabled') && user.DogGiftDay !== today;
  if ((body.action || 'status') === 'status') return ok({ available });
  if (body.action !== 'claim') return fail('unknown_action');
  if (!available) return fail('already_claimed');
  const total = DOG_LOOT.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total, pick = DOG_LOOT[0];
  for (const x of DOG_LOOT) { r -= x.weight; if (r <= 0) { pick = x; break; } }
  const n = pick.min + Math.floor(Math.random() * (pick.max - pick.min + 1));
  user = store.update('Users', user.id, { DogGiftDay: today, [pick.field]: addNum(user, pick.field, n) });
  return ok({ available: false, gift: { type: pick.type, amount: n, icon: pick.icon, label: pick.label(n) }, newStardust: user.StardustCount });
}

// ------------------------------------------------------------------ marche du dimanche
const marketOpen = (store) => new Date(parisDay(0) + 'T12:00:00Z').getUTCDay() === setting(store, 'SundayMarketDay');

function marketOffers(store, user) {
  const day = parisDay(0);
  const rarities = store.getAll('Rarities').filter((r) => r.Key !== 'unique' && (Number(r.CraftCost) || 0) > 0).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  const cards = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo);
  // Possession au debut de la journee : la selection ne bouge pas apres un achat.
  const dayStart = parisEpoch(day, 0);
  const mine = store.getAll('Pulls').filter((p) => refId(p.User) === user.id);
  const owned = new Set(mine.filter((p) => (Number(p.ObtainedAt) || 0) < dayStart).map((p) => refId(p.Card)));
  const ownedNow = new Set(mine.map((p) => refId(p.Card)));
  const rand = rng(`sunday:${day}:${user.id}`);
  // Deux cartes des raretes basses, une du milieu, une du haut ; manquantes d'abord.
  const tiers = rarities.length ? [rarities.slice(0, 2), rarities.slice(0, 2), rarities.slice(2, 3), rarities.slice(3)] : [];
  const picked = new Set();
  const out = [];
  for (const tier of tiers) {
    const ids = new Set(tier.map((r) => r.id));
    const pool = cards.filter((c) => ids.has(refId(c.Rarity)) && !picked.has(c.id));
    const missing = pool.filter((c) => !owned.has(c.id));
    const from = missing.length ? missing : pool;
    if (!from.length) continue;
    const card = from[Math.floor(rand() * from.length)];
    picked.add(card.id);
    const rarity = store.get('Rarities', refId(card.Rarity));
    out.push({ card, price: Math.max(1, Math.round((Number(rarity.CraftCost) || 0) * setting(store, 'SundayMarketDiscount'))), owned: ownedNow.has(card.id) });
  }
  return out;
}

function nextMarketAt(store) {
  const target = setting(store, 'SundayMarketDay');
  for (let i = 1; i <= 7; i++) {
    const d = parisDay(i);
    if (new Date(d + 'T12:00:00Z').getUTCDay() === target) return parisEpoch(d, 0);
  }
  return null;
}

function handleSunday({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const day = parisDay(0);
  const open = !!setting(store, 'SundayMarketEnabled') && marketOpen(store);
  if (!open) return ok({ open: false, nextAt: setting(store, 'SundayMarketEnabled') ? nextMarketAt(store) : null, offers: [] });
  const bought = parseJson(user.SundayBought, {});
  const mine = bought.day === day ? bought.ids || [] : [];
  const offers = marketOffers(store, user);
  const view = () => ({ open: true, day, endsAt: parisEpoch(parisDay(1), 0), stardust: Number(user.StardustCount) || 0, discount: setting(store, 'SundayMarketDiscount'),
    offers: offers.map((o) => ({ ...cardSummary(store, o.card), price: o.price, owned: o.owned, bought: mine.includes(o.card.id) })) });
  if ((body.action || 'status') === 'status') return ok(view());
  if (body.action !== 'buy') return fail('unknown_action');
  const offer = offers.find((o) => o.card.id === Number(body.cardId));
  if (!offer) return fail('not_offered');
  if (mine.includes(offer.card.id)) return fail('already_bought', 400, view());
  if ((Number(user.StardustCount) || 0) < offer.price) return fail('not_enough_dust', 400, view());
  const used = new Set(store.getAll('Pulls').filter((p) => refId(p.Card) === offer.card.id).map((p) => p.SerialNumber));
  let serial = 1; while (used.has(serial)) serial++;
  store.create('Pulls', { User: user.id, Card: offer.card.id, SerialNumber: serial, Finish: 'normal', Quality: 'good', ObtainedAt: now(), BatchId: `sunday-${day}-${user.id}` });
  mine.push(offer.card.id);
  user = store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) - offer.price, SundayBought: JSON.stringify({ day, ids: mine }) });
  return ok({ ...view(), purchased: { ...cardSummary(store, offer.card), serialNumber: serial }, newStardust: user.StardustCount });
}

// ------------------------------------------------------------------ cadeaux entre joueurs
const GIFT_KINDS = { worms: { amount: 3, field: 'Worms', icon: '🪱', label: '3 vers de terre' }, dust: { amount: 25, field: 'StardustCount', icon: '✨', label: '25 poussières' }, bait: { amount: 1, field: 'GoldBait', icon: '🪝', label: 'un appât doré' } };

function giftsFor(store, userId) {
  const limit = now() - 7 * 86400;
  return store.tables.has('PlayerGifts') ? store.getAll('PlayerGifts').filter((g) => refId(g.To) === userId && !g.Claimed && (Number(g.At) || 0) >= limit) : [];
}

function handleGift({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const today = parisDay(0);
  const users = new Map(store.getAll('Users').map((u) => [u.id, u]));
  const received = () => giftsFor(store, user.id).map((g) => ({ id: g.id, from: (users.get(refId(g.From)) || {}).Pseudo || '?', kind: g.Kind, icon: (GIFT_KINDS[g.Kind] || {}).icon, label: (GIFT_KINDS[g.Kind] || {}).label, at: g.At }));
  const state = () => ({ canSend: user.GiftSentDay !== today, received: received(), kinds: Object.entries(GIFT_KINDS).map(([key, k]) => ({ key, icon: k.icon, label: k.label })) });
  const action = body.action || 'status';
  if (action === 'status') return ok(state());
  if (action === 'send') {
    if (user.GiftSentDay === today) return fail('already_sent', 400, state());
    const to = users.get(Number(body.toUserId));
    if (!to || to.id === user.id) return fail('invalid_target');
    if (!GIFT_KINDS[body.kind]) return fail('invalid_kind');
    store.create('PlayerGifts', { From: user.id, To: to.id, Kind: body.kind, Amount: GIFT_KINDS[body.kind].amount, At: now(), Claimed: false });
    user = store.update('Users', user.id, { GiftSentDay: today });
    return ok({ ...state(), sent: { to: to.Pseudo, label: GIFT_KINDS[body.kind].label } });
  }
  if (action === 'claim') {
    const list = giftsFor(store, user.id);
    if (!list.length) return fail('nothing_to_claim');
    const fields = {};
    for (const g of list) {
      const k = GIFT_KINDS[g.Kind];
      if (k) fields[k.field] = (fields[k.field] ?? (Number(user[k.field]) || 0)) + (Number(g.Amount) || k.amount);
      store.update('PlayerGifts', g.id, { Claimed: true });
    }
    user = store.update('Users', user.id, fields);
    // Menage : cadeaux recuperes ou expires depuis plus de 30 jours.
    const old = now() - 30 * 86400;
    store.getAll('PlayerGifts').filter((g) => (Number(g.At) || 0) < old).forEach((g) => store.delete('PlayerGifts', g.id));
    return ok({ ...state(), claimed: list.length, newStardust: user.StardustCount });
  }
  return fail('unknown_action');
}

// ------------------------------------------------------------------ recapitulatif de la semaine
const FINISH_RANK = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'];
function handleRecap({ store, query }) {
  const user = userById(store, query.userId);
  if (!user) return fail('unknown_user', 404);
  const monday = weekKey();
  const end = parisEpoch(monday, 0);
  const prevMonday = new Date(Date.parse(monday + 'T12:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);
  const start = parisEpoch(prevMonday, 0);
  const catalog = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo);
  const catalogIds = new Set(catalog.map((c) => c.id));
  const allPulls = store.getAll('Pulls');
  const firstByUserCard = new Map();
  for (const p of allPulls) {
    const k = refId(p.User) + ':' + refId(p.Card);
    const at = Number(p.ObtainedAt) || 0;
    if (!firstByUserCard.has(k) || at < firstByUserCard.get(k)) firstByUserCard.set(k, at);
  }
  const mine = allPulls.filter((p) => refId(p.User) === user.id);
  const week = mine.filter((p) => (Number(p.ObtainedAt) || 0) >= start && (Number(p.ObtainedAt) || 0) < end);
  const newIds = [...new Set(week.map((p) => refId(p.Card)))].filter((id) => { const f = firstByUserCard.get(user.id + ':' + id); return f >= start && f < end; });
  const ownedAt = (t) => [...firstByUserCard.entries()].filter(([k, at]) => k.startsWith(user.id + ':') && at < t && catalogIds.has(Number(k.split(':')[1]))).length;
  const rarityOf = (p) => { const c = store.get('Cards', refId(p.Card)); return c ? store.get('Rarities', refId(c.Rarity)) : null; };
  const byRarity = {};
  week.forEach((p) => { const r = rarityOf(p); if (r) byRarity[r.Key] = { name: r.Name, colorHex: r.ColorHex, sortOrder: r.SortOrder || 0, count: ((byRarity[r.Key] || {}).count || 0) + 1 }; });
  const best = [...week].sort((a, b) => ((rarityOf(b) || {}).SortOrder || 0) - ((rarityOf(a) || {}).SortOrder || 0) || FINISH_RANK.indexOf(b.Finish || 'normal') - FINISH_RANK.indexOf(a.Finish || 'normal')).slice(0, 3)
    .map((p) => ({ ...cardSummary(store, store.get('Cards', refId(p.Card))), finish: p.Finish || 'normal', serialNumber: p.SerialNumber }));
  const boosters = new Set(week.map((p) => p.BatchId).filter((b) => /^\d+-\d+$/.test(String(b || '')))).size;
  // Place sur le serveur (nouvelles cartes de la semaine).
  const perUser = new Map();
  for (const [k, at] of firstByUserCard) if (at >= start && at < end) { const u = Number(k.split(':')[0]); perUser.set(u, (perUser.get(u) || 0) + 1); }
  const ranking = [...perUser.entries()].sort((a, b) => b[1] - a[1]);
  const place = newIds.length ? ranking.findIndex(([u]) => u === user.id) + 1 : null;
  return ok({
    week: prevMonday, start, end, newCards: newIds.length, copies: week.length, boosters,
    collection: { before: ownedAt(start), after: ownedAt(end), total: catalog.length },
    rarities: Object.values(byRarity).sort((a, b) => b.sortOrder - a.sortOrder),
    best, place, players: ranking.length
  });
}

export const routes = { 'POST dog-gift': handleDogGift, 'POST sunday-market': handleSunday, 'POST player-gift': handleGift, 'GET weekly-recap': handleRecap };
