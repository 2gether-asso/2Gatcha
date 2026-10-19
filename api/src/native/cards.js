// Cartes (2026-10-15) : ce qui entoure chaque exemplaire et l'ouverture.
//  - Historique de l'exemplaire : chaque creation, changement de proprietaire,
//    de finition / d'etat / d'edition et suppression d'un exemplaire est
//    journalise (table PullHistory), quel que soit le workflow ou le module
//    qui ecrit (enveloppe du Store, comme le journal de l'economie). Indexe
//    par carte + numero de serie : survit au coffre de guilde, a l'annulation
//    d'un decraft... Les exemplaires plus anciens retrouvent leur origine via
//    BatchId / ObtainedAt.
//  - God pack : GodPackChance des boosters ne contiennent que des epiques ou
//    mieux (cartes du booster remplacees apres le tirage).
//  - Cote d'une carte : ventes aux encheres, valeur de decraft, cout de craft.
//  - Maitre d'une carte : toutes les finitions d'une meme carte possedees.
//  - Partage sur Discord : image de la carte generee par le site, postee par
//    le webhook du bot (DISCORD_WEBHOOK_URL).
//   GET  /webhook/card-history ?cardId=&serial=
//   GET  /webhook/card-price ?cardId=
//   POST /webhook/share-card { userId, cardId, finish?, quality?, edition?, serial?, image }

import { refId, now, ok, fail, userById, parseJson, cardSummary, nextSerial } from './common.js';
import { setting } from './settings.js';
import { currentContext } from './context.js';
import { addFeed } from './feed.js';

export const schema = {
  PullHistory: {
    Card: { type: 'Ref:Cards' }, Serial: { type: 'Numeric' }, At: { type: 'Numeric' }, Kind: { type: 'Text' },
    User: { type: 'Ref:Users' }, Other: { type: 'Ref:Users' }, Source: { type: 'Text' }, Detail: { type: 'Text' }
  },
  Users: { MasteredCards: { type: 'Text' }, LastShareAt: { type: 'Numeric' } },
  // Ordre de la carte dans son extension (admin, 2026-10-17) ; 0 = ordre par defaut.
  Cards: { SortOrder: { type: 'Numeric' } }
};

const FINISHES = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'];

// ------------------------------------------------------------------ historique des exemplaires
// Enveloppe create / update / delete sur Pulls (appelee une fois par index.js).
export function installHistory(store, captureError = () => {}) {
  const log = (fields) => {
    try {
      if (!store.tables.has('PullHistory')) return;
      const ctx = currentContext();
      store.create('PullHistory', { At: now(), Source: String(ctx.source || '').slice(0, 60), ...fields });
    } catch (e) { captureError(e, { hook: 'pull-history' }); }
  };
  const prevCreate = store.create.bind(store);
  store.create = (name, fields) => {
    const row = prevCreate(name, fields);
    if (name === 'Pulls' && row) log({ Card: refId(row.Card), Serial: Number(row.SerialNumber) || 0, Kind: 'created', User: refId(row.User) || null, Detail: JSON.stringify({ finish: row.Finish || 'normal', quality: row.Quality || 'good', edition: row.Edition || null }) });
    return row;
  };
  const prevUpdate = store.update;
  store.update = (name, id, fields) => {
    if (name !== 'Pulls' || !fields) return prevUpdate(name, id, fields);
    const before = store.get('Pulls', id);
    const row = prevUpdate(name, id, fields);
    if (!before || !row) return row;
    const base = { Card: refId(row.Card), Serial: Number(row.SerialNumber) || 0 };
    if ('User' in fields && refId(before.User) !== refId(row.User)) log({ ...base, Kind: 'moved', User: refId(row.User) || null, Other: refId(before.User) || null });
    const changes = {};
    for (const [k, f] of [['finish', 'Finish'], ['quality', 'Quality'], ['edition', 'Edition']]) {
      if (f in fields && (before[f] || '') !== (row[f] || '')) changes[k] = [before[f] || null, row[f] || null];
    }
    if (Object.keys(changes).length) log({ ...base, Kind: 'changed', User: refId(row.User) || null, Detail: JSON.stringify(changes) });
    return row;
  };
  const prevDelete = store.delete.bind(store);
  store.delete = (name, id) => {
    const before = name === 'Pulls' ? store.get('Pulls', id) : null;
    const res = prevDelete(name, id);
    if (before) log({ Card: refId(before.Card), Serial: Number(before.SerialNumber) || 0, Kind: 'deleted', User: refId(before.User) || null });
    return res;
  };
}

function originOf(pull) {
  const m = /^(\d+)-/.exec(String(pull.BatchId || ''));
  return { userId: m ? Number(m[1]) : refId(pull.User), at: Number(pull.ObtainedAt) || null, source: /^\d+-\d+$/.test(String(pull.BatchId || '')) ? 'open-pack' : String(pull.BatchId || '').split('-')[0] || null };
}

function handleHistory({ store, query }) {
  const cardId = Number(query.cardId), serial = Number(query.serial);
  const card = cardId ? store.get('Cards', cardId) : null;
  if (!card || !serial) return fail('unknown_card', 404);
  const users = new Map(store.getAll('Users').map((u) => [u.id, u.Pseudo]));
  const name = (id) => (id ? users.get(Number(id)) || '?' : null);
  const rows = store.tables.has('PullHistory') ? store.getAll('PullHistory').filter((r) => refId(r.Card) === cardId && Number(r.Serial) === serial).sort((a, b) => a.At - b.At || a.id - b.id) : [];
  const events = rows.map((r) => ({ at: r.At, kind: r.Kind, user: name(refId(r.User)), other: name(refId(r.Other)), source: r.Source || null, detail: parseJson(r.Detail, null) }));
  const pull = store.getAll('Pulls').find((p) => refId(p.Card) === cardId && Number(p.SerialNumber) === serial);
  // Exemplaire anterieur au journal : origine retrouvee via le lot de tirage.
  if (pull && !rows.some((r) => r.Kind === 'created')) {
    const o = originOf(pull);
    events.unshift({ at: o.at, kind: 'created', user: name(o.userId), other: null, source: o.source, detail: { finish: pull.Finish || 'normal', quality: pull.Quality || 'good', edition: pull.Edition || null }, reconstructed: true });
  }
  return ok({ card: cardSummary(store, card), serial, owner: pull ? name(refId(pull.User)) : null, exists: !!pull, events });
}

// ------------------------------------------------------------------ cote d'une carte
function handlePrice({ store, query }) {
  const cardId = Number(query.cardId);
  const card = cardId ? store.get('Cards', cardId) : null;
  if (!card) return fail('unknown_card', 404);
  const rarity = store.get('Rarities', refId(card.Rarity)) || {};
  const users = new Map(store.getAll('Users').map((u) => [u.id, u.Pseudo]));
  const sales = (store.tables.has('Auctions') ? store.getAll('Auctions') : [])
    .filter((a) => refId(a.Card) === cardId && a.Status === 'sold')
    .sort((a, b) => (a.SettledAt || 0) - (b.SettledAt || 0))
    .map((a) => ({ at: Number(a.SettledAt) || Number(a.EndsAt) || 0, price: Number(a.CurrentBid) || 0, finish: a.Finish || 'normal', quality: a.Quality || 'good', buyer: users.get(refId(a.Bidder)) || null }));
  const recent = sales.filter((s) => s.at > now() - 30 * 86400);
  const avg = (l) => (l.length ? Math.round(l.reduce((t, s) => t + s.price, 0) / l.length) : null);
  return ok({
    card: cardSummary(store, card), sales: sales.slice(-40),
    stats: { last: sales.length ? sales[sales.length - 1].price : null, avg30: avg(recent), avgAll: avg(sales), count: sales.length, min: sales.length ? Math.min(...sales.map((s) => s.price)) : null, max: sales.length ? Math.max(...sales.map((s) => s.price)) : null },
    reference: { disenchant: Number(rarity.DisenchantValue) || 0, craft: Number(rarity.CraftCost) || 0 },
    copies: store.getAll('Pulls').filter((p) => refId(p.Card) === cardId).length
  });
}

// ------------------------------------------------------------------ maitre d'une carte
export function masteredOf(user) { return parseJson(user && user.MasteredCards, {}); }
// Nouvelles cartes maitrisees (toutes les finitions) ; renvoie les annonces.
function checkMastery(store, userId) {
  const user = store.get('Users', userId);
  if (!user) return [];
  const have = new Map();
  store.getAll('Pulls').forEach((p) => {
    if (refId(p.User) !== userId) return;
    const k = refId(p.Card);
    if (!have.has(k)) have.set(k, new Set());
    have.get(k).add(p.Finish || 'normal');
  });
  const mastered = masteredOf(user);
  const fresh = [];
  for (const [cardId, set] of have) if (!mastered[cardId] && FINISHES.every((f) => set.has(f))) { mastered[cardId] = now(); fresh.push(cardId); }
  if (!fresh.length) return [];
  store.update('Users', userId, { MasteredCards: JSON.stringify(mastered) });
  return fresh.map((cardId) => {
    const c = store.get('Cards', cardId);
    addFeed(store, { userId, kind: 'master', icon: '👑', text: `devient Maître de ${c ? c.Name : 'une carte'} : les 6 finitions réunies !`, cardId });
    return { userId, kind: 'master', icon: '👑', label: `Maître de ${c ? c.Name : 'cette carte'} : les 6 finitions réunies !` };
  });
}
const MASTERY_EVENTS = new Set(['cardsPulled', 'fusion', 'tradeDone', 'craft', 'repair']);
export function onEvents(store, events) {
  const users = new Set(events.filter((e) => MASTERY_EVENTS.has(e.type)).map((e) => e.userId));
  return [...users].flatMap((uid) => checkMastery(store, uid));
}

// ------------------------------------------------------------------ god pack + collection
function cardJson(store, card, pull) {
  const s = cardSummary(store, card);
  return { cardId: card.id, name: card.Name, artist: card.Artist || null, description: card.Description || null, imageId: s.imageId, rarity: s.rarity, serialNumber: pull.SerialNumber };
}
export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  const json = response.json;
  const body = request.body || {};
  if (path === 'open-pack' && !body.dryRun && Array.isArray(json.cards) && json.cards.length && Math.random() < setting(store, 'GodPackChance')) {
    const userId = Number(body.userId);
    const rar = store.getAll('Rarities');
    const epic = rar.find((r) => r.Key === 'epique');
    const min = epic ? Number(epic.SortOrder) || 0 : 3;
    const rank = new Map(rar.map((r) => [r.id, Number(r.SortOrder) || 0]));
    const pulls = store.getAll('Pulls').filter((p) => p.BatchId === json.batchId && refId(p.User) === userId);
    let changed = 0;
    json.cards = json.cards.map((c) => {
      const pull = pulls.find((p) => refId(p.Card) === c.cardId && p.SerialNumber === c.serialNumber);
      const card = store.get('Cards', c.cardId);
      if (!pull || !card || (rank.get(refId(card.Rarity)) || 0) >= min) return c;
      // Meme extension, epique ou mieux (jamais Unique ni promo).
      const pool = store.getAll('Cards').filter((x) => x.Active !== false && !x.IsPromo && refId(x.Extension) === refId(card.Extension) && (rank.get(refId(x.Rarity)) || 0) >= min && (rar.find((r) => r.id === refId(x.Rarity)) || {}).Key !== 'unique');
      if (!pool.length) return c;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const serial = nextSerial(store, pick.id);
      const row = store.update('Pulls', pull.id, { Card: pick.id, SerialNumber: serial });
      changed++;
      return { ...c, ...cardJson(store, pick, row) };
    });
    if (changed || json.cards.length) {
      json.pack = { ...(json.pack || {}), godPack: true };
      addFeed(store, { userId, kind: 'godpack', icon: '🌟', text: 'ouvre un GOD PACK : que des épiques ou mieux !' });
    }
    return;
  }
  if (path === 'collection') {
    const userId = Number((request.query || {}).userId || body.userId);
    const user = store.get('Users', userId);
    if (!user) return;
    checkMastery(store, userId);
    json.masteredCards = Object.keys(masteredOf(store.get('Users', userId))).map(Number);
  }
}

// ------------------------------------------------------------------ partage Discord
const FINISH_LABEL = { normal: '', holo: 'Holo', gold: 'Dorée', ghost: 'Ghost', diamond: 'Diamant', rainbow: 'Arc-en-ciel' };
const QUALITY_LABEL = { damaged: 'Usé', worn: 'Abîmé', good: 'Bon état', mint: 'Parfait état' };
function handleShare({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const cardId = Number(body.cardId);
  const card = cardId ? store.get('Cards', cardId) : null;
  if (!card) return fail('unknown_card', 404);
  if (!store.getAll('Pulls').some((p) => refId(p.User) === user.id && refId(p.Card) === cardId)) return fail('card_not_owned', 403);
  const cooldown = setting(store, 'ShareCardCooldown');
  const wait = (Number(user.LastShareAt) || 0) + cooldown - now();
  if (wait > 0) return fail('share_cooldown', 429, { wait });
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
  if (!m || m[2].length > 4 * 1024 * 1024) return fail('invalid_image');
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return fail('discord_unavailable', 503);
  store.update('Users', user.id, { LastShareAt: now() });
  const rarity = store.get('Rarities', refId(card.Rarity)) || {};
  const bits = [rarity.Name, FINISH_LABEL[body.finish] || '', QUALITY_LABEL[body.quality] || '', body.edition ? `édition ${String(body.edition)}` : '', body.serial ? `#${String(body.serial).padStart(3, '0')}` : ''].filter(Boolean);
  const color = parseInt(String(rarity.ColorHex || '#8b5cf6').replace('#', ''), 16) || 0x8b5cf6;
  const payload = { embeds: [{ title: `🎴 ${card.Name}`, description: `**${user.Pseudo || 'Un joueur'}** partage sa carte : ${bits.join(' · ')}`, color, image: { url: `attachment://carte.${m[1] === 'png' ? 'png' : 'jpg'}` } }] };
  const buffer = Buffer.from(m[2], 'base64');
  setTimeout(async () => {
    try {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payload));
      form.append('files[0]', new Blob([buffer], { type: `image/${m[1]}` }), `carte.${m[1] === 'png' ? 'png' : 'jpg'}`);
      await fetch(url, { method: 'POST', body: form });
    } catch (e) { /* Discord indisponible : sans consequence pour le jeu */ }
  }, 0);
  return ok({ shared: true, cooldown });
}

export const routes = { 'GET card-history': handleHistory, 'GET card-price': handlePrice, 'POST share-card': handleShare };
