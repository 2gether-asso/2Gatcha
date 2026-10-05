// Grande fouille commune (2026-10-05) : chaque semaine, une grille de 10x10
// que TOUS les joueurs creusent ensemble (CommunityDigPerDay coups de pioche
// par jour et par joueur). Les tresors reviennent a celui qui les deterre ; le
// GRAND TRESOR, une fois trouve, recompense tous les participants de la
// semaine (GrandTreasureDust + GrandTreasureBoosters), et son decouvreur
// encore plus.
//   POST /webhook/community-dig { userId, action: 'status' | 'dig', tile? }

import { ok, fail, userById, now, parisDay } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';

export const SIZE = 100;

export const schema = {
  CommunityDig: { Week: { type: 'Text' }, Board: { type: 'Text' } },
  Users: { CDigDay: { type: 'Text' }, CDigCount: { type: 'Numeric' } }
};

const REWARDS = [
  ...Array(8).fill({ kind: 'dust' }), ...Array(3).fill({ kind: 'worms' }),
  ...Array(2).fill({ kind: 'bait' }), { kind: 'booster' }, { kind: 'part' }
];

function newBoard() {
  const order = Array.from({ length: SIZE }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const tiles = Array.from({ length: SIZE }, () => ({ d: false }));
  tiles[order[0]].r = { kind: 'grand' };
  REWARDS.forEach((r, i) => { tiles[order[i + 1]].r = { ...r }; });
  return { tiles, diggers: {}, grand: null, log: [] };
}

function boardFor(store, week = weekKey()) {
  let row = store.getAll('CommunityDig').find((r) => r.Week === week);
  if (!row) row = store.create('CommunityDig', { Week: week, Board: JSON.stringify(newBoard()) });
  let board;
  try { board = JSON.parse(row.Board); } catch (e) { board = newBoard(); }
  return { row, board };
}

const digsToday = (user) => (user.CDigDay === parisDay(0) ? Number(user.CDigCount) || 0 : 0);

function view(store, user, board) {
  const users = new Map(store.getAll('Users').map((u) => [u.id, u]));
  const perDay = setting(store, 'CommunityDigPerDay');
  const treasuresLeft = board.tiles.filter((t) => t.r && !t.d).length;
  return {
    week: weekKey(),
    tiles: board.tiles.map((t) => (t.d ? { dug: true, reward: t.r ? t.r.kind : null, by: t.by ? users.get(t.by)?.Pseudo || '?' : null } : { dug: false })),
    digsLeft: user ? Math.max(0, perDay - digsToday(user)) : 0, perDay,
    treasuresLeft, grand: board.grand ? { by: users.get(board.grand.by)?.Pseudo || '?', at: board.grand.at } : null,
    participants: Object.keys(board.diggers).length,
    top: Object.entries(board.diggers).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ pseudo: users.get(Number(id))?.Pseudo || '?', n })),
    log: board.log.slice(-8).reverse(),
    reward: { dust: setting(store, 'GrandTreasureDust'), boosters: setting(store, 'GrandTreasureBoosters') }
  };
}

function handleDig({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const { row, board } = boardFor(store);
  if ((body.action || 'status') !== 'dig') return ok(view(store, user, board));
  const tile = Number(body.tile);
  if (!Number.isInteger(tile) || tile < 0 || tile >= SIZE) return fail('invalid_tile');
  if (board.tiles[tile].d) return fail('tile_already_dug');
  if (digsToday(user) >= setting(store, 'CommunityDigPerDay')) return fail('no_digs_left');
  const t = board.tiles[tile];
  t.d = true; t.by = user.id;
  board.diggers[user.id] = (board.diggers[user.id] || 0) + 1;
  const fields = { CDigDay: parisDay(0), CDigCount: digsToday(user) + 1 };
  let found = null;
  if (t.r) {
    const r = t.r;
    if (r.kind === 'dust') { const n = 40 + Math.floor(Math.random() * 81); fields.StardustCount = (Number(user.StardustCount) || 0) + n; found = { kind: 'dust', amount: n, label: `${n} poussières` }; }
    else if (r.kind === 'worms') { fields.Worms = (Number(user.Worms) || 0) + 4; found = { kind: 'worms', amount: 4, label: '4 vers de terre' }; }
    else if (r.kind === 'bait') { fields.GoldBait = (Number(user.GoldBait) || 0) + 1; found = { kind: 'bait', amount: 1, label: 'un appât doré' }; }
    else if (r.kind === 'booster') { fields.BoosterCount = (Number(user.BoosterCount) || 0) + 1; found = { kind: 'booster', amount: 1, label: 'un booster' }; }
    else if (r.kind === 'part') { fields.SpareParts = (Number(user.SpareParts) || 0) + 1; found = { kind: 'part', amount: 1, label: 'une pièce détachée' }; }
    else if (r.kind === 'grand') found = { kind: 'grand', amount: 0, label: 'le GRAND TRÉSOR' };
    board.log.push({ pseudo: user.Pseudo, label: found.label, at: now() });
  }
  user = store.update('Users', user.id, fields);
  // Grand tresor : tous les participants de la semaine sont recompenses.
  if (found && found.kind === 'grand') {
    board.grand = { by: user.id, at: now() };
    const dust = setting(store, 'GrandTreasureDust'), boosters = setting(store, 'GrandTreasureBoosters');
    for (const id of Object.keys(board.diggers).map(Number)) {
      const u = store.get('Users', id);
      if (!u) continue;
      const extra = id === user.id ? 1 : 0;
      store.update('Users', id, { StardustCount: (Number(u.StardustCount) || 0) + dust, BoosterCount: (Number(u.BoosterCount) || 0) + boosters + extra });
    }
    found.shared = { dust, boosters, participants: Object.keys(board.diggers).length };
  }
  store.update('CommunityDig', row.id, { Board: JSON.stringify(board) });
  return ok({ ...view(store, store.get('Users', user.id), board), dug: true, found });
}

export const routes = { 'POST community-dig': handleDig };
