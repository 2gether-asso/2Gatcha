// Draft (mode Medium, 2026-10-16, moderules.js 'medium.draft') : 2 a 4
// joueurs misent un booster chacun ; a l'ouverture, toutes les cartes (5 par
// booster mise) sont etalees au centre et chacun pioche a son tour, en serpent
// (1-2-3-4-4-3-2-1...). Un joueur qui laisse passer 10 minutes pioche
// automatiquement la plus rare. Un draft commence continue meme si le mode change.
//   POST /webhook/draft { userId, action: 'status' | 'create' | 'join' | 'leave' | 'start' | 'pick', id?, index? }

import { refId, now, ok, fail, userById, parseJson, cardSummary } from './common.js';
import { ruleOn } from './moderules.js';
import { setting } from './settings.js';
import { addFeed } from './feed.js';

export const schema = {
  Drafts: {
    Host: { type: 'Ref:Users' }, Players: { type: 'Text' }, Order: { type: 'Text' }, Pool: { type: 'Text' }, Picks: { type: 'Text' },
    Status: { type: 'Text' }, CreatedAt: { type: 'Numeric' }, TurnAt: { type: 'Numeric' }, BatchId: { type: 'Text' }
  }
};

const MAX_PLAYERS = 4, CARDS_PER_BOOSTER = 5, TURN_SECONDS = 600;
const n = (v) => Number(v) || 0;
const arr = (v) => { const x = parseJson(v, []); return Array.isArray(x) ? x : []; };
const rows = (store) => (store.tables.has('Drafts') ? store.getAll('Drafts') : []);
function weighted(list, w) {
  const total = list.reduce((s, x) => s + Math.max(0, w(x)), 0);
  let r = Math.random() * total;
  for (const x of list) { r -= Math.max(0, w(x)); if (r <= 0) return x; }
  return list[list.length - 1];
}
// Une carte comme dans un booster : rarete selon Rarities.Weight, finition speciale parfois.
function rollCard(store) {
  const cards = store.getAll('Cards').filter((c) => c.Active !== false && !c.IsPromo);
  const rarities = store.getAll('Rarities').filter((r) => r.Key !== 'unique' && n(r.Weight) > 0 && cards.some((c) => refId(c.Rarity) === r.id));
  if (!rarities.length) return null;
  const rarity = weighted(rarities, (r) => n(r.Weight));
  const pool = cards.filter((c) => refId(c.Rarity) === rarity.id);
  const card = pool[Math.floor(Math.random() * pool.length)];
  const finishes = store.tables.has('Finishes') ? store.getAll('Finishes').filter((f) => f.Key !== 'normal' && n(f.DropWeight) > 0) : [];
  const finish = finishes.length && Math.random() < setting(store, 'SpecialFinishChance') ? weighted(finishes, (f) => n(f.DropWeight)).Key : 'normal';
  const qualities = store.tables.has('Qualities') ? store.getAll('Qualities').filter((q) => n(q.DropWeight) > 0) : [];
  const quality = qualities.length ? weighted(qualities, (q) => n(q.DropWeight)).Key : 'good';
  return { cardId: card.id, finish, quality, sort: n(rarity.SortOrder) };
}
// Ordre de pioche en serpent : sequence des joueurs pour chaque carte.
function snake(order, total) {
  const seq = [];
  for (let r = 0; seq.length < total; r++) {
    const round = r % 2 ? [...order].reverse() : order;
    for (const uid of round) if (seq.length < total) seq.push(uid);
  }
  return seq;
}
function nextSerial(store, cardId) {
  const used = new Set(store.getAll('Pulls').filter((p) => refId(p.Card) === cardId).map((p) => p.SerialNumber));
  let s = 1; while (used.has(s)) s++;
  return s;
}

function view(store, d, userId) {
  const players = arr(d.Players), order = arr(d.Order), pool = arr(d.Pool), picks = arr(d.Picks);
  const users = new Map(store.getAll('Users').filter((u) => players.includes(u.id)).map((u) => [u.id, u]));
  const takenBy = new Map(picks.map((p) => [p.index, p.userId]));
  const seq = order.length ? snake(order, pool.length) : [];
  const turn = d.Status === 'running' ? seq[picks.length] : null;
  return {
    id: d.id, status: d.Status, host: refId(d.Host), hostPseudo: users.get(refId(d.Host))?.Pseudo || '?', createdAt: d.CreatedAt,
    players: players.map((id) => ({ userId: id, pseudo: users.get(id)?.Pseudo || '?', picks: picks.filter((p) => p.userId === id).length })),
    max: MAX_PLAYERS, mine: players.includes(userId), turn, turnPseudo: turn ? users.get(turn)?.Pseudo || '?' : null, myTurn: turn === userId,
    turnEndsAt: turn ? n(d.TurnAt) + TURN_SECONDS : null,
    pool: pool.map((c, index) => { const card = store.get('Cards', c.cardId); return { index, card: card ? cardSummary(store, card) : null, finish: c.finish, quality: c.quality, takenBy: takenBy.has(index) ? users.get(takenBy.get(index))?.Pseudo || '?' : null, mine: takenBy.get(index) === userId }; }),
    upcoming: seq.slice(picks.length, picks.length + 6).map((id) => users.get(id)?.Pseudo || '?')
  };
}

// Pioche (joueur ou automatique) ; termine le draft quand le centre est vide.
function doPick(store, d, userId, index) {
  const pool = arr(d.Pool), picks = arr(d.Picks);
  const c = pool[index];
  const serial = nextSerial(store, c.cardId);
  store.create('Pulls', { User: userId, Card: c.cardId, SerialNumber: serial, Finish: c.finish, Quality: c.quality, ObtainedAt: now(), BatchId: d.BatchId || `draft-${d.id}` });
  picks.push({ userId, index, at: now() });
  const done = picks.length >= pool.length;
  return store.update('Drafts', d.id, { Picks: JSON.stringify(picks), TurnAt: now(), ...(done ? { Status: 'done' } : {}) });
}
// Tours expires : pioche automatique de la carte la plus rare restante.
function autoPicks(store, d) {
  let guard = 0;
  while (d.Status === 'running' && now() - n(d.TurnAt) > TURN_SECONDS && guard++ < 40) {
    const pool = arr(d.Pool), picks = arr(d.Picks);
    const taken = new Set(picks.map((p) => p.index));
    const seq = snake(arr(d.Order), pool.length);
    const free = pool.map((c, i) => ({ c, i })).filter((x) => !taken.has(x.i)).sort((a, b) => b.c.sort - a.c.sort);
    if (!free.length) break;
    const at = n(d.TurnAt) + TURN_SECONDS;
    d = doPick(store, d, seq[picks.length], free[0].i);
    d = store.update('Drafts', d.id, { TurnAt: at });
  }
  return d;
}
const refund = (store, uid) => { const u = store.get('Users', uid); if (u) store.update('Users', uid, { BoosterCount: n(u.BoosterCount) + 1 }); };

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  rows(store).filter((d) => d.Status === 'running').forEach((d) => autoPicks(store, d));
  const action = body.action || 'status';
  const activeOf = () => rows(store).find((d) => (d.Status === 'open' || d.Status === 'running') && arr(d.Players).includes(user.id));
  const mineActive = activeOf();
  const status = () => { const cur = activeOf(); return ok({
    active: ruleOn(store, 'medium.draft'),
    current: cur ? view(store, cur, user.id) : null,
    lobbies: rows(store).filter((d) => d.Status === 'open' && !arr(d.Players).includes(user.id)).map((d) => view(store, d, user.id)),
    recent: rows(store).filter((d) => d.Status === 'done' && arr(d.Players).includes(user.id)).sort((a, b) => b.id - a.id).slice(0, 3).map((d) => view(store, d, user.id)),
    boosters: n(store.get('Users', user.id).BoosterCount)
  }); };
  if (action === 'status') return status();
  const d = body.id ? store.get('Drafts', Number(body.id)) : null;

  if (action === 'create' || action === 'join') {
    if (!ruleOn(store, 'medium.draft')) return fail('wrong_mode');
    if (mineActive) return fail('already_in_draft');
    if (n(user.BoosterCount) < 1) return fail('no_boosters');
    if (action === 'join') {
      if (!d || d.Status !== 'open') return fail('draft_closed');
      const players = arr(d.Players);
      if (players.length >= MAX_PLAYERS) return fail('draft_full');
      store.update('Drafts', d.id, { Players: JSON.stringify([...players, user.id]) });
    } else {
      store.create('Drafts', { Host: user.id, Players: JSON.stringify([user.id]), Order: '[]', Pool: '[]', Picks: '[]', Status: 'open', CreatedAt: now(), TurnAt: 0 });
    }
    store.update('Users', user.id, { BoosterCount: n(user.BoosterCount) - 1 });
    return status();
  }
  if (!d || !arr(d.Players).includes(user.id)) return fail('not_in_draft');
  if (action === 'leave') {
    if (d.Status !== 'open') return fail('draft_started');
    if (refId(d.Host) === user.id) {
      arr(d.Players).forEach((uid) => refund(store, uid));
      store.update('Drafts', d.id, { Status: 'cancelled' });
    } else {
      refund(store, user.id);
      store.update('Drafts', d.id, { Players: JSON.stringify(arr(d.Players).filter((x) => x !== user.id)) });
    }
    return status();
  }
  if (action === 'start') {
    if (d.Status !== 'open') return fail('draft_started');
    if (refId(d.Host) !== user.id) return fail('not_host');
    const players = arr(d.Players);
    if (players.length < 2) return fail('need_two_players');
    const pool = [];
    for (let i = 0; i < players.length * CARDS_PER_BOOSTER; i++) { const c = rollCard(store); if (c) pool.push(c); }
    const order = [...players].sort(() => Math.random() - 0.5);
    store.update('Drafts', d.id, { Status: 'running', Order: JSON.stringify(order), Pool: JSON.stringify(pool), Picks: '[]', TurnAt: now(), BatchId: `draft-${d.id}-${Date.now()}` });
    const names = store.getAll('Users').filter((u) => players.includes(u.id)).map((u) => u.Pseudo).join(', ');
    addFeed(store, { userId: user.id, kind: 'draft', icon: '🃏', text: `lance un draft à ${players.length} : ${names} !` });
    return status();
  }
  if (action === 'pick') {
    if (d.Status !== 'running') return fail('draft_not_running');
    const v = view(store, d, user.id);
    if (!v.myTurn) return fail('not_your_turn', 400, { turn: v.turnPseudo });
    const index = Number(body.index);
    if (!v.pool[index] || v.pool[index].takenBy) return fail('card_taken');
    doPick(store, d, user.id, index);
    return status();
  }
  return fail('unknown_action');
}

export const routes = { 'POST draft': handle };
