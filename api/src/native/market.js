// Marche et economie (2026-10-07) : de vrais puits a poussieres et a doublons.
//  - Contrats de collection : chaque semaine, ContractsPerWeek demandes
//    ("3 Rares holo") a remplir avec ses exemplaires contre un coffre, des
//    boosters... (une fois par contrat et par semaine).
//      POST /webhook/contracts { userId, action: 'status' | 'fulfill', key?, pullIds? }
//  - Enchères : un exemplaire mis en vente 24 h (sequestre : il quitte la
//    collection), encheres en poussieres (remboursees si surencheri), taxe
//    detruite a la vente, prolongation de 5 min si une enchere arrive a la fin.
//      POST /webhook/auctions { userId, action: 'list' | 'create' | 'bid' | 'cancel', pullId?, startPrice?, auctionId?, amount? }
//  - Cours du decraft : la valeur de decraft de chaque rarete varie chaque
//    semaine selon l'offre (decrafts) et la demande (crafts) de la semaine
//    passee (boosts.js applique le cours).
//      GET /webhook/exchange-rates
//  - Assurance : un exemplaire assure ne peut plus etre decrafte, fusionne,
//    sacrifie, depose ni echange par erreur (il est mis de cote pendant ces
//    actions). Payee une fois.
//      POST /webhook/insurance { userId, pullId, action: 'insure' | 'remove' }
//  - Boutique de boosters : quelques boosters par semaine, prix croissant.
//      POST /webhook/booster-shop { userId, action: 'status' | 'buy' }
//  - Restaurations repetees : la n-ieme restauration d'une meme carte dans la
//    semaine coute (n-1) x RepairEscalationDust poussieres en plus.

import { refId, now, ok, fail, userById, cardSummary } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';
import { talentValue } from './talents.js';
import { price as indexed, taxMultiplier } from './inflation.js';
import { addFeed } from './feed.js';

export const schema = {
  Users: { ShopWeek: { type: 'Text' }, ShopBought: { type: 'Numeric' }, RepairWeek: { type: 'Text' }, RepairCounts: { type: 'Text' } },
  ContractClaims: { User: { type: 'Ref:Users' }, Week: { type: 'Text' }, Key: { type: 'Text' }, At: { type: 'Numeric' } },
  Auctions: {
    Seller: { type: 'Ref:Users' }, Card: { type: 'Ref:Cards' }, Pull: { type: 'Numeric' }, Serial: { type: 'Numeric' }, Finish: { type: 'Text' }, Quality: { type: 'Text' }, Starred: { type: 'Bool' },
    StartPrice: { type: 'Numeric' }, CurrentBid: { type: 'Numeric' }, Bidder: { type: 'Ref:Users' }, Bids: { type: 'Numeric' },
    OutbidUser: { type: 'Ref:Users' }, OutbidAt: { type: 'Numeric' },
    EndsAt: { type: 'Numeric' }, Status: { type: 'Text' }, CreatedAt: { type: 'Numeric' }, SettledAt: { type: 'Numeric' }, Tax: { type: 'Numeric' }
  }
};

const parse = (v, def) => { try { const x = JSON.parse(v || ''); return x == null ? def : x; } catch (e) { return def; } };
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const dust = (u) => Number(u.StardustCount) || 0;
const QUALITY_ORDER = ['damaged', 'worn', 'good', 'mint'];
const FINISH_LABEL = { normal: 'normale', holo: 'holo', gold: 'dorée', ghost: 'ghost', diamond: 'diamant', rainbow: 'arc-en-ciel' };

function rarityKeyOf(store, cardId) {
  const card = store.get('Cards', cardId);
  const r = card ? store.get('Rarities', refId(card.Rarity)) : null;
  return r ? r.Key : null;
}
function rarityTier(store, cardId) {
  const card = store.get('Cards', cardId);
  if (!card) return 1;
  const sorted = store.getAll('Rarities').filter((r) => r.Key !== 'unique').sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  return Math.max(1, sorted.findIndex((r) => r.id === refId(card.Rarity)) + 1);
}

// --- cours du decraft ----------------------------------------------------------
function appGet(store, key) { const r = store.getAll('AppSettings').find((x) => x.Key === key); return r ? parse(r.Value, null) : null; }
function appSet(store, key, value) {
  const r = store.getAll('AppSettings').find((x) => x.Key === key);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: key, Value: JSON.stringify(value) });
}

function recordRate(store, rarityKey, kind) {
  if (!rarityKey) return;
  const key = 'rateStats:' + weekKey();
  const stats = appGet(store, key) || {};
  stats[rarityKey] = stats[rarityKey] || { d: 0, c: 0 };
  stats[rarityKey][kind] += 1;
  appSet(store, key, stats);
}

const rateCache = new Map();
export function rateFactor(store, rarityKey, week = weekKey()) {
  const swing = setting(store, 'ExchangeRateSwing');
  if (!swing || !rarityKey) return 1;
  const ck = `${week}|${rarityKey}|${swing}`;
  if (rateCache.has(ck)) return rateCache.get(ck);
  const prev = weekKey(Date.parse(week + 'T12:00:00Z') - 7 * 86400000);
  const s = (appGet(store, 'rateStats:' + prev) || {})[rarityKey] || { d: 0, c: 0 };
  const pressure = Math.max(-1, Math.min(1, (s.c - s.d) / (s.c + s.d + 5)));
  const noise = ((hash(week + rarityKey) % 7) - 3) / 100;
  const f = Math.round(Math.max(1 - swing, Math.min(1 + swing, 1 + swing * pressure + noise)) * 100) / 100;
  rateCache.set(ck, f);
  return f;
}

function handleRates({ store }) {
  const rarities = store.getAll('Rarities').filter((r) => r.Key !== 'unique').sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  return ok({
    week: weekKey(), swing: setting(store, 'ExchangeRateSwing'),
    rates: rarities.map((r) => ({ key: r.Key, name: r.Name, colorHex: r.ColorHex, base: Number(r.DisenchantValue) || 0, factor: rateFactor(store, r.Key), value: Math.round((Number(r.DisenchantValue) || 0) * rateFactor(store, r.Key)) }))
  });
}

// --- assurance --------------------------------------------------------------------
export const insuranceCost = (store, cardId) => setting(store, 'InsuranceCostPerTier') * rarityTier(store, cardId);

function handleInsurance({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const pull = store.get('Pulls', Number(body.pullId));
  if (!pull || refId(pull.User) !== user.id) return fail('copy_not_owned');
  const cost = insuranceCost(store, refId(pull.Card));
  if (body.action === 'remove') {
    if (!pull.Insured) return fail('not_insured');
    store.update('Pulls', pull.id, { Insured: false });
    return ok({ insured: false, pullId: pull.id, cost });
  }
  if (body.action !== 'insure') return ok({ insured: !!pull.Insured, pullId: pull.id, cost });
  if (pull.Insured) return fail('already_insured');
  if (dust(user) < cost) return fail('not_enough_dust', 400, { cost });
  const after = store.update('Users', user.id, { StardustCount: dust(user) - cost });
  store.update('Pulls', pull.id, { Insured: true });
  return ok({ insured: true, pullId: pull.id, cost, newStardust: after.StardustCount });
}

// Exemplaires assures (et cartes ★) mis de cote pendant les workflows qui
// consomment des exemplaires : marques InVault (ignores par tous les
// workflows, comme le coffre-fort), remis en place juste apres.
const CONSUMING = { 'disenchant': null, 'foil-upgrade': null, 'card-quality-repair': null, 'altar-sacrifice': null, 'trade': ['create', 'counter', 'respond'], 'guild-chest': ['deposit'] };

function repairSurcharge(store, user, cardId) {
  const counts = user.RepairWeek === weekKey() ? parse(user.RepairCounts, {}) : {};
  const n = Number(counts[cardId]) || 0;
  return Math.round(n * setting(store, 'RepairEscalationDust') * Math.max(0, 1 - talentValue(user, 'restorer')));
}

export function beforeWorkflow({ store, path, request }) {
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user) return null;
  if (path === 'card-quality-repair') {
    const extra = repairSurcharge(store, user, Number(body.cardId));
    const copies = Math.max(0, Math.floor(Number(body.dustCopies) || 0)) * setting(store, 'RepairDustPerCopy');
    if (extra > 0 && dust(user) < extra + copies) return { status: 400, json: { error: 'not_enough_dust_repair', surcharge: extra } };
    request._repairSurcharge = extra;
  }
  if (!(path in CONSUMING)) return null;
  const actions = CONSUMING[path];
  if (actions && !actions.includes(body.action)) return null;
  const explicit = new Set([body.pullId, body.offeredPullId, body.requestedPullId, ...(Array.isArray(body.pullIds) ? body.pullIds : [])].map(Number).filter(Boolean));
  const owners = new Set([user.id]);
  if (path === 'trade' && body.action === 'respond' && store.tables.has('Trades')) {
    const tr = store.get('Trades', Number(body.tradeId));
    if (tr) owners.add(refId(tr.FromUser));
  }
  const mine = store.getAll('Pulls').filter((p) => owners.has(refId(p.User)) && !p.InVault);
  if (mine.some((p) => p.Insured && explicit.has(p.id))) return { status: 400, json: { error: 'insured_copy' } };
  if (path === 'disenchant' && Number(body.pullId)) {
    const p = store.get('Pulls', Number(body.pullId));
    if (p && p.Starred) request._starred = true;
  }
  const hide = mine.filter((p) => p.Insured || (p.Starred && !explicit.has(p.id)));
  hide.forEach((p) => store.update('Pulls', p.id, { InVault: true }));
  request._hidden = hide.map((p) => p.id);
  return null;
}

// A appeler avant tout autre traitement apres le workflow.
export function restoreHidden(store, request) {
  for (const id of request._hidden || []) if (store.get('Pulls', id)) store.update('Pulls', id, { InVault: false });
  request._hidden = [];
}

// --- boutique de boosters ---------------------------------------------------------
function shopState(store, user) {
  const week = weekKey();
  const bought = user.ShopWeek === week ? Number(user.ShopBought) || 0 : 0;
  const cap = setting(store, 'BoosterShopWeeklyCap');
  return { week, bought, cap, left: Math.max(0, cap - bought), price: Math.round(indexed(store, setting(store, 'BoosterShopPrice')) * (1 + setting(store, 'BoosterShopIncrease') * bought)), stardust: dust(user) };
}

function handleShop({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const st = shopState(store, user);
  if ((body.action || 'status') === 'status') return ok(st);
  if (body.action !== 'buy') return fail('unknown_action');
  if (st.left < 1) return fail('weekly_cap', 400, st);
  if (st.stardust < st.price) return fail('not_enough_dust', 400, st);
  user = store.update('Users', user.id, { StardustCount: st.stardust - st.price, BoosterCount: (Number(user.BoosterCount) || 0) + 1, ShopWeek: st.week, ShopBought: st.bought + 1 });
  return ok({ ...shopState(store, user), bought: true, paid: st.price, newBoosterCount: user.BoosterCount, newStardust: user.StardustCount });
}

// --- contrats de collection ----------------------------------------------------
export const CONTRACTS = [
  { key: 'rare-holo', label: '3 Rares holo', icon: '✨', rarity: 'rare', finish: 'holo', count: 3, reward: { chests: 1, keys: 1 } },
  { key: 'commons', label: '10 Communes', icon: '📦', rarity: 'commune', count: 10, reward: { boosters: 1 } },
  { key: 'epic-good', label: '2 Épiques en bon état ou mieux', icon: '💜', rarity: 'epique', minQuality: 'good', count: 2, reward: { dust: 400 } },
  { key: 'gold2', label: '2 cartes dorées', icon: '🥇', finish: 'gold', count: 2, reward: { boosters: 2 } },
  { key: 'worn5', label: '5 cartes usées', icon: '🧽', quality: 'worn', count: 5, reward: { dust: 150, worms: 5 } },
  { key: 'legend1', label: '1 Légendaire', icon: '🌟', rarity: 'legendaire', count: 1, reward: { boosters: 3 } },
  { key: 'ghost1', label: '1 carte ghost', icon: '👻', finish: 'ghost', count: 1, reward: { chests: 1, keys: 1 } },
  { key: 'rare-mint', label: '2 Rares en parfait état', icon: '💎', rarity: 'rare', quality: 'mint', count: 2, reward: { dust: 300 } },
  { key: 'damaged8', label: '8 cartes abîmées', icon: '🩹', quality: 'damaged', count: 8, reward: { dust: 200 } },
  { key: 'diamond1', label: '1 carte diamant', icon: '💠', finish: 'diamond', count: 1, reward: { boosters: 2, dust: 200 } },
  { key: 'epic3', label: '3 Épiques', icon: '🔮', rarity: 'epique', count: 3, reward: { chests: 1, keys: 1, dust: 100 } }
];

export function weekContracts(store, week = weekKey()) {
  const list = [...CONTRACTS];
  const out = [];
  let h = hash('contracts:' + week);
  while (out.length < setting(store, 'ContractsPerWeek') && list.length) { out.push(list.splice(h % list.length, 1)[0]); h = hash(String(h)); }
  return out;
}

function matches(store, c, p) {
  if (p.InVault || p.Insured || p.Starred) return false;
  if (c.rarity && rarityKeyOf(store, refId(p.Card)) !== c.rarity) return false;
  if (c.finish && (p.Finish || 'normal') !== c.finish) return false;
  if (c.quality && (p.Quality || 'damaged') !== c.quality) return false;
  if (c.minQuality && QUALITY_ORDER.indexOf(p.Quality || 'damaged') < QUALITY_ORDER.indexOf(c.minQuality)) return false;
  return true;
}

function contractState(store, user) {
  const week = weekKey();
  const done = new Set(store.getAll('ContractClaims').filter((r) => refId(r.User) === user.id && r.Week === week).map((r) => r.Key));
  const pulls = store.getAll('Pulls').filter((p) => refId(p.User) === user.id);
  const copies = new Map();
  pulls.forEach((p) => copies.set(refId(p.Card), (copies.get(refId(p.Card)) || 0) + 1));
  const contracts = weekContracts(store, week).map((c) => {
    // Suggestion : d'abord les cartes en plusieurs exemplaires, les plus hauts numeros.
    const eligible = pulls.filter((p) => matches(store, c, p))
      .sort((a, b) => (copies.get(refId(b.Card)) - copies.get(refId(a.Card))) || ((b.SerialNumber || 0) - (a.SerialNumber || 0)));
    const suggested = [];
    const used = new Map();
    for (const p of eligible) {
      if (suggested.length >= c.count) break;
      const cid = refId(p.Card);
      if ((copies.get(cid) || 0) - (used.get(cid) || 0) <= 1) continue;
      suggested.push(p.id); used.set(cid, (used.get(cid) || 0) + 1);
    }
    return {
      ...c, done: done.has(c.key), available: eligible.length, ready: eligible.length >= c.count,
      suggested: suggested.length >= c.count ? suggested : null,
      eligible: eligible.slice(0, 40).map((p) => ({ pullId: p.id, cardId: refId(p.Card), serialNumber: p.SerialNumber || null, finish: p.Finish || 'normal', quality: p.Quality || 'damaged', copies: copies.get(refId(p.Card)) || 1, card: cardSummary(store, store.get('Cards', refId(p.Card)) || { id: refId(p.Card) }) }))
    };
  });
  return { week, contracts, endsAt: Math.floor(Date.parse(week + 'T00:00:00Z') / 1000) + 7 * 86400 };
}

function handleContracts({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const st = contractState(store, user);
  if ((body.action || 'status') === 'status') return ok(st);
  if (body.action !== 'fulfill') return fail('unknown_action');
  const c = st.contracts.find((x) => x.key === String(body.key));
  if (!c) return fail('unknown_contract');
  if (c.done) return fail('already_claimed');
  const ids = [...new Set((Array.isArray(body.pullIds) ? body.pullIds : []).map(Number))];
  if (ids.length !== c.count) return fail('wrong_count', 400, { need: c.count });
  const pulls = ids.map((id) => store.get('Pulls', id));
  if (pulls.some((p) => !p || refId(p.User) !== user.id)) return fail('copy_not_owned');
  if (pulls.some((p) => !matches(store, c, p))) return fail('copy_not_matching');
  pulls.forEach((p) => store.delete('Pulls', p.id));
  store.create('ContractClaims', { User: user.id, Week: st.week, Key: c.key, At: now() });
  const r = c.reward;
  user = store.update('Users', user.id, {
    StardustCount: dust(user) + (r.dust || 0), BoosterCount: (Number(user.BoosterCount) || 0) + (r.boosters || 0),
    ChestCount: (Number(user.ChestCount) || 0) + (r.chests || 0), KeyCount: (Number(user.KeyCount) || 0) + (r.keys || 0),
    Worms: (Number(user.Worms) || 0) + (r.worms || 0)
  });
  return ok({ ...contractState(store, user), fulfilled: c.key, reward: r, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount });
}

// --- encheres -------------------------------------------------------------------
const minNext = (a) => (Number(a.CurrentBid) > 0 ? Number(a.CurrentBid) + Math.max(5, Math.ceil(Number(a.CurrentBid) * 0.05)) : Number(a.StartPrice) || 10);

export function settleAuctions(store, t = now()) {
  if (!store.tables.has('Auctions')) return 0;
  let n = 0;
  for (const a of store.getAll('Auctions')) {
    if (a.Status !== 'open' || (a.EndsAt || 0) > t) continue;
    const pull = store.get('Pulls', Number(a.Pull));
    const bidder = refId(a.Bidder);
    if (bidder && Number(a.CurrentBid) > 0) {
      const seller = store.get('Users', refId(a.Seller));
      const rate = Math.min(0.9, setting(store, 'AuctionTaxPct') * taxMultiplier(store)) * (1 - (seller ? talentValue(seller, 'master') : 0));
      const tax = Math.round(Number(a.CurrentBid) * rate);
      if (pull) store.update('Pulls', pull.id, { User: bidder });
      if (seller) store.update('Users', seller.id, { StardustCount: dust(seller) + Number(a.CurrentBid) - tax });
      store.update('Auctions', a.id, { Status: 'sold', SettledAt: t, Tax: tax });
      const card = store.get('Cards', refId(a.Card));
      if (Number(a.CurrentBid) >= 500 && card) addFeed(store, { userId: bidder, kind: 'auction', icon: '🔨', text: `remporte ${card.Name} aux enchères pour ${a.CurrentBid} ✨`, cardId: card.id });
    } else {
      if (pull) store.update('Pulls', pull.id, { User: refId(a.Seller) });
      store.update('Auctions', a.id, { Status: 'unsold', SettledAt: t });
    }
    n++;
  }
  return n;
}

let lastSettle = 0;
export function beforeRequest({ store }) {
  const t = now();
  if (t - lastSettle < 20) return;
  lastSettle = t;
  settleAuctions(store, t);
}

function auctionView(store, a, me, users) {
  const card = store.get('Cards', refId(a.Card));
  const seller = users.get(refId(a.Seller));
  const bidder = users.get(refId(a.Bidder));
  return {
    id: a.id, card: card ? cardSummary(store, card) : null, serialNumber: a.Serial || null, finish: a.Finish || 'normal', quality: a.Quality || 'damaged', starred: !!a.Starred,
    seller: seller ? seller.Pseudo : '?', mine: refId(a.Seller) === me, startPrice: Number(a.StartPrice) || 0,
    currentBid: Number(a.CurrentBid) || 0, bids: Number(a.Bids) || 0, leading: refId(a.Bidder) === me, bidder: bidder ? bidder.Pseudo : null,
    minNext: minNext(a), endsAt: a.EndsAt, status: a.Status, settledAt: a.SettledAt || null
  };
}

function auctionList(store, user) {
  const users = new Map(store.getAll('Users').map((u) => [u.id, u]));
  const all = store.getAll('Auctions');
  const t = now();
  return {
    open: all.filter((a) => a.Status === 'open').sort((a, b) => (a.EndsAt || 0) - (b.EndsAt || 0)).map((a) => auctionView(store, a, user.id, users)),
    history: all.filter((a) => a.Status !== 'open' && (a.SettledAt || 0) > t - 7 * 86400 && (refId(a.Seller) === user.id || refId(a.Bidder) === user.id))
      .sort((a, b) => (b.SettledAt || 0) - (a.SettledAt || 0)).slice(0, 20).map((a) => auctionView(store, a, user.id, users)),
    taxPct: Math.min(0.9, setting(store, 'AuctionTaxPct') * taxMultiplier(store)) * (1 - talentValue(user, 'master')), hours: setting(store, 'AuctionHours'), maxActive: setting(store, 'AuctionMaxActive'),
    stardust: dust(user)
  };
}

function handleAuctions({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  settleAuctions(store);
  const action = body.action || 'list';
  if (action === 'create') {
    const pull = store.get('Pulls', Number(body.pullId));
    if (!pull || refId(pull.User) !== user.id) return fail('copy_not_owned');
    if (pull.InVault) return fail('copy_in_vault');
    if (pull.Insured) return fail('insured_copy');
    const active = store.getAll('Auctions').filter((a) => a.Status === 'open' && refId(a.Seller) === user.id).length;
    if (active >= setting(store, 'AuctionMaxActive')) return fail('too_many_auctions');
    const start = Math.floor(Number(body.startPrice) || 0);
    if (start < 10 || start > 1000000) return fail('invalid_price');
    store.create('Auctions', {
      Seller: user.id, Card: refId(pull.Card), Pull: pull.id, Serial: pull.SerialNumber || null, Finish: pull.Finish || 'normal', Quality: pull.Quality || 'damaged', Starred: !!pull.Starred,
      StartPrice: start, CurrentBid: 0, Bids: 0, EndsAt: now() + setting(store, 'AuctionHours') * 3600, Status: 'open', CreatedAt: now()
    });
    store.update('Pulls', pull.id, { User: null });
    return ok({ ...auctionList(store, user), created: true });
  }
  if (action === 'bid') {
    const a = store.get('Auctions', Number(body.auctionId));
    if (!a || a.Status !== 'open' || (a.EndsAt || 0) <= now()) return fail('auction_closed');
    if (refId(a.Seller) === user.id) return fail('own_auction');
    if (refId(a.Bidder) === user.id) return fail('already_leading');
    const amount = Math.floor(Number(body.amount) || 0);
    if (amount < minNext(a)) return fail('bid_too_low', 400, { minNext: minNext(a) });
    if (dust(user) < amount) return fail('not_enough_dust');
    const prev = refId(a.Bidder);
    if (prev) { const p = store.get('Users', prev); if (p) store.update('Users', p.id, { StardustCount: dust(p) + Number(a.CurrentBid) }); }
    user = store.update('Users', user.id, { StardustCount: dust(user) - amount });
    const left = (a.EndsAt || 0) - now();
    store.update('Auctions', a.id, { CurrentBid: amount, Bidder: user.id, Bids: (Number(a.Bids) || 0) + 1, OutbidUser: prev || null, OutbidAt: prev ? now() : null, EndsAt: left < 300 ? now() + 300 : a.EndsAt });
    return ok({ ...auctionList(store, user), bid: amount, newStardust: user.StardustCount });
  }
  if (action === 'cancel') {
    const a = store.get('Auctions', Number(body.auctionId));
    if (!a || refId(a.Seller) !== user.id || a.Status !== 'open') return fail('not_found', 404);
    if (Number(a.Bids) > 0) return fail('has_bids');
    const pull = store.get('Pulls', Number(a.Pull));
    if (pull) store.update('Pulls', pull.id, { User: user.id });
    store.update('Auctions', a.id, { Status: 'cancelled', SettledAt: now() });
    return ok({ ...auctionList(store, user), cancelled: true });
  }
  if (action !== 'list') return fail('unknown_action');
  return ok(auctionList(store, user));
}

export const routes = {
  'POST contracts': handleContracts,
  'POST auctions': handleAuctions,
  'GET exchange-rates': handleRates,
  'POST insurance': handleInsurance,
  'POST booster-shop': handleShop
};

// Apres les workflows : statistiques du cours, supplement de restauration.
export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json) return;
  const body = request.body || {};
  if (path === 'disenchant' && response.json.disenchanted) recordRate(store, rarityKeyOf(store, Number(body.cardId)), 'd');
  else if (path === 'craft' && response.json.crafted) recordRate(store, rarityKeyOf(store, Number(body.cardId)), 'c');
  else if (path === 'card-quality-repair' && response.json.repaired) {
    const user = store.get('Users', Number(body.userId));
    if (!user) return;
    const week = weekKey();
    const counts = user.RepairWeek === week ? parse(user.RepairCounts, {}) : {};
    const cid = Number(body.cardId);
    counts[cid] = (Number(counts[cid]) || 0) + 1;
    const extra = Number(request._repairSurcharge) || 0;
    store.update('Users', user.id, { RepairWeek: week, RepairCounts: JSON.stringify(counts), ...(extra ? { StardustCount: Math.max(0, dust(user) - extra) } : {}) });
    if (extra) response.json.repairSurcharge = extra;
    response.json.nextRepairSurcharge = repairSurcharge(store, store.get('Users', user.id), cid);
  }
}

export { repairSurcharge, FINISH_LABEL };
