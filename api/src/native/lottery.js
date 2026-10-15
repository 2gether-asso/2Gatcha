// Loterie du dimanche (2026-10-15) : des tickets achetes en poussieres
// remplissent une cagnotte (LotteryBurnPct de chaque ticket est detruit),
// tiree le dimanche a 21 h (heure de Paris). Un ticket = une chance. Sans
// ticket vendu, la cagnotte est reportee a la semaine suivante.
//   POST /webhook/lottery { userId, action: 'status' | 'buy', count? }

import { now, ok, fail, userById, parisDay, parseJson } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';
import { parisEpoch } from './daily.js';
import { addFeed } from './feed.js';

export const schema = { Users: { LotteryWeek: { type: 'Text' }, LotteryTickets: { type: 'Numeric' } } };

const KEY = 'lottery';
const LAST = 'lotteryLast';
const dust = (u) => Number(u.StardustCount) || 0;

function row(store, key) { return store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === key) : null; }
function read(store, key, def) { const r = row(store, key); return r ? parseJson(r.Value, def) : def; }
function save(store, key, value) {
  const r = row(store, key);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: key, Value: JSON.stringify(value) });
}

// Tirage d'une semaine : dimanche 21 h.
function drawAt(week) {
  const sunday = parisDay(6, Date.parse(week + 'T12:00:00Z'));
  return parisEpoch(sunday, 21);
}
// Semaine sur laquelle se vendent les tickets maintenant (apres le tirage : la suivante).
function sellingWeek() {
  const w = weekKey();
  return now() < drawAt(w) ? w : weekKey(Date.parse(w + 'T12:00:00Z') + 7 * 86400000);
}
function potOf(store, week) {
  const st = read(store, KEY, null);
  return st && st.week === week ? st : { week, pot: (st && st.carry) || setting(store, 'LotterySeed') };
}
const ticketsOf = (user, week) => (user.LotteryWeek === week ? Number(user.LotteryTickets) || 0 : 0);

function stateOf(store, user) {
  const week = sellingWeek();
  const st = potOf(store, week);
  const players = store.getAll('Users').filter((u) => ticketsOf(u, week) > 0);
  const total = players.reduce((s, u) => s + ticketsOf(u, week), 0);
  const mine = ticketsOf(user, week);
  return {
    enabled: !!setting(store, 'LotteryEnabled'), week, drawAt: drawAt(week), pot: Math.round(st.pot),
    price: setting(store, 'LotteryTicketPrice'), cap: setting(store, 'LotteryWeeklyCap'),
    tickets: mine, totalTickets: total, players: players.length,
    chance: total ? Math.round((mine / total) * 1000) / 10 : 0,
    last: read(store, LAST, null), stardust: dust(user)
  };
}

function handleLottery({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(stateOf(store, user));
  if (action !== 'buy') return fail('unknown_action');
  if (!setting(store, 'LotteryEnabled')) return fail('lottery_closed');
  const week = sellingWeek();
  const count = Math.max(1, Math.min(100, Math.floor(Number(body.count) || 1)));
  const mine = ticketsOf(user, week);
  if (mine + count > setting(store, 'LotteryWeeklyCap')) return fail('weekly_cap', 400, stateOf(store, user));
  const cost = count * setting(store, 'LotteryTicketPrice');
  if (dust(user) < cost) return fail('not_enough_dust', 400, stateOf(store, user));
  user = store.update('Users', user.id, { StardustCount: dust(user) - cost, LotteryWeek: week, LotteryTickets: mine + count });
  const st = potOf(store, week);
  save(store, KEY, { week, pot: st.pot + cost * (1 - setting(store, 'LotteryBurnPct')) });
  return ok({ ...stateOf(store, user), bought: count, paid: cost });
}

// Tirage : premiere requete apres le dimanche 21 h.
let checked = 0;
export function beforeRequest({ store }) {
  const t = now();
  if (t - checked < 60 || !store.tables.has('AppSettings')) return;
  checked = t;
  const st = read(store, KEY, null);
  if (!st || !st.week || st.drawn || t < drawAt(st.week)) return;
  const players = store.getAll('Users').filter((u) => ticketsOf(u, st.week) > 0);
  const total = players.reduce((s, u) => s + ticketsOf(u, st.week), 0);
  const pot = Math.round(st.pot);
  if (!total) {
    save(store, KEY, { week: st.week, drawn: true, carry: pot });
    return;
  }
  let pick = Math.random() * total, winner = players[0];
  for (const u of players) { pick -= ticketsOf(u, st.week); if (pick < 0) { winner = u; break; } }
  store.update('Users', winner.id, { StardustCount: dust(winner) + pot });
  save(store, LAST, { week: st.week, at: t, userId: winner.id, pseudo: winner.Pseudo, pot, tickets: ticketsOf(winner, st.week), totalTickets: total, players: players.length });
  save(store, KEY, { week: st.week, drawn: true, carry: 0 });
  addFeed(store, { userId: winner.id, kind: 'lottery', icon: '🎟️', text: `remporte la loterie du dimanche : ${pot.toLocaleString('fr-FR')} poussières (${ticketsOf(winner, st.week)} ticket${ticketsOf(winner, st.week) > 1 ? 's' : ''} sur ${total}) !` });
}

export function _reset() { checked = 0; }
export const routes = { 'POST lottery': handleLottery };
