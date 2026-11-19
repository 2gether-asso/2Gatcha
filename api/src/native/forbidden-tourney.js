// Salle interdite V2 (2026-11-19) : tournoi de la semaine. Inscription
// gratuite, le meme budget de tours pour tous (ForbiddenTourneySpins), sur
// une Classique « neutre » (slots.js tourneyRoll : sans incrustation, sans
// niveau, sans geode) : seul le hasard et le moment ou l'on joue comptent.
// Aucun gain pendant le tournoi : des points (TOURNEY_TABLE x5 pour un
// triple, cascades x2, x3, x4). Recompenses reglees a la premiere visite de
// la semaine suivante (AppSettings ForbiddenTourneyPaid) : 1er 5 jetons
// booster + titre « Champion de la salle », 2e 3, 3e 2, 4e a 10e 100 jetons
// du casino, les autres participants 30 jetons.
// Appele par forbidden.js : action 'tourney' { op: 'status' | 'join' | 'spin', count }.
// Users.ForbiddenTourney = { week, left, score, spins, best: { label, points } }

import { ok, fail, now, parseJson } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';
import { grantCosmetic } from './cosmetics.js';
import { addFeed } from './feed.js';
import { inbox } from './modefun.js';
import { tourneyRoll, TOURNEY_TABLE, symbolIcon } from './slots.js';

export const schema = { Users: { ForbiddenTourney: { type: 'Text' } } };

const PRIZES = [
  { boosters: 5, title: true, label: '5 jetons booster et le titre « Champion de la salle »' },
  { boosters: 3, label: '3 jetons booster' },
  { boosters: 2, label: '2 jetons booster' }
];
const TOP_CHIPS = 100, PART_CHIPS = 30;
const mineOf = (user, week = weekKey()) => { const t = parseJson(user.ForbiddenTourney, null); return t && t.week === week ? t : null; };
const prevWeek = () => weekKey(Date.now() - 7 * 86400000);

function board(store, week = weekKey(), limit = 10) {
  return store.getAll('Users').map((u) => ({ u, t: mineOf(u, week) })).filter((x) => x.t && x.t.spins > 0)
    .sort((a, b) => b.t.score - a.t.score || (a.t.lastAt || 0) - (b.t.lastAt || 0))
    .slice(0, limit).map(({ u, t }, i) => ({ rank: i + 1, userId: u.id, pseudo: u.Pseudo || '?', score: t.score, spins: t.spins, best: t.best || null }));
}

// Recompenses de la semaine passee, une fois.
export function settleTourney(store) {
  const week = prevWeek();
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === 'ForbiddenTourneyPaid') : null;
  const paid = row ? parseJson(row.Value, null) : null;
  if (paid && paid.week >= week) return null;
  const all = board(store, week, 100000);
  for (const p of all) {
    const u = store.get('Users', p.userId);
    if (!u) continue;
    const prize = PRIZES[p.rank - 1];
    if (prize) {
      store.update('Users', u.id, { BoosterCount: (Number(u.BoosterCount) || 0) + prize.boosters });
      if (prize.title) grantCosmetic(store, u.id, 'title-champion-salle', { type: 'title', label: 'Champion de la salle' });
      inbox(store, u.id, '🏆', `Tournoi de la salle : ${p.rank}${p.rank === 1 ? 'er' : 'e'} avec ${p.score} points ! ${prize.label}.`);
    } else {
      const chips = p.rank <= 10 ? TOP_CHIPS : PART_CHIPS;
      store.update('Users', u.id, { CasinoChips: (Number(u.CasinoChips) || 0) + chips });
      inbox(store, u.id, '🏆', `Tournoi de la salle : ${p.rank}e avec ${p.score} points, +${chips} jetons du casino.`);
    }
  }
  if (all.length) addFeed(store, { userId: all[0].userId, kind: 'forbidden', icon: '🏆', text: `remporte le tournoi de la salle interdite avec ${all[0].score} points.` });
  const v = JSON.stringify({ week, at: now(), players: all.length, winner: all[0] ? all[0].pseudo : null });
  if (row) store.update('AppSettings', row.id, { Value: v }); else store.create('AppSettings', { Key: 'ForbiddenTourneyPaid', Value: v });
  return all.length;
}

export function tourneyView(store, user) {
  if (!setting(store, 'ForbiddenTourneyEnabled')) return null;
  const week = weekKey();
  const t = mineOf(user, week);
  const top = board(store, week);
  const rank = t && t.spins ? board(store, week, 100000).findIndex((x) => x.userId === user.id) + 1 : null;
  const lastRow = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === 'ForbiddenTourneyPaid') : null;
  return {
    week, budget: setting(store, 'ForbiddenTourneySpins'), joined: !!t, left: t ? t.left : null, score: t ? t.score : 0, spins: t ? t.spins : 0, best: t ? t.best : null, rank,
    top, prizes: PRIZES.map((p) => p.label), topChips: TOP_CHIPS, partChips: PART_CHIPS,
    table: Object.entries(TOURNEY_TABLE).map(([k, pts]) => ({ key: k, icon: symbolIcon(k), pts })),
    last: lastRow ? parseJson(lastRow.Value, null) : null
  };
}

export function tourneyAction(store, user, body) {
  if (!setting(store, 'ForbiddenTourneyEnabled')) return fail('tourney_closed');
  settleTourney(store);
  user = store.get('Users', user.id);
  const op = body.op || 'status';
  if (op === 'status') return ok({ tourney: tourneyView(store, user) });
  const week = weekKey();
  let t = mineOf(user, week);
  if (op === 'join') {
    if (t) return fail('already_joined', 400, { tourney: tourneyView(store, user) });
    t = { week, left: setting(store, 'ForbiddenTourneySpins'), score: 0, spins: 0, best: null };
    user = store.update('Users', user.id, { ForbiddenTourney: JSON.stringify(t) });
    return ok({ tourney: tourneyView(store, user), joined: true });
  }
  if (op === 'spin') {
    if (!t) return fail('not_joined', 400, { tourney: tourneyView(store, user) });
    const n = Math.min(Number(body.count) === 10 ? 10 : 1, t.left);
    if (n < 1) return fail('tourney_done', 400, { tourney: tourneyView(store, user) });
    const rolls = Array.from({ length: n }, () => tourneyRoll());
    for (const r of rolls) {
      t.score += r.points;
      t.spins++;
      t.left--;
      if (r.points && (!t.best || r.points > t.best.points)) t.best = { label: r.label, points: r.points, line: r.line };
    }
    t.lastAt = now();
    user = store.update('Users', user.id, { ForbiddenTourney: JSON.stringify(t) });
    return ok({ tourney: { ...tourneyView(store, user), spun: n }, rolls });
  }
  return fail('unknown_action');
}
