// Bingo du mois, version 2 (2026-11) : remplace le workflow bingo.json.
//
// Une grille 5 x 5 commune a tous les joueurs, generee chaque mois (ou
// configuree par l'admin) : case centrale offerte, BingoCardCells cases
// "carte" (posseder une carte precise) et des cases "objectif" (ouvrir 25
// boosters, terminer 8 grilles de fouille...) comptees sur le mois via le bus
// d'activite. Chaque ligne, colonne ou diagonale terminee se recupere
// (BingoLineReward) ; la grille complete donne le carton plein
// (BingoFullReward + titre). Un joker par mois (BingoJokerPrice poussieres)
// valide la case de son choix. Une case validee le reste jusqu'a la fin du mois.
//
// Transition : avant BingoV2From (AAAAMM), la route garde EXACTEMENT
// l'ancien fonctionnement (tables BingoGrids / BingoClaims, 9 cartes, une
// recompense) pour ne pas perturber la grille du mois en cours ; la
// version 2 demarre toute seule le 1er du mois BingoV2From.
//   POST /webhook/bingo { userId, action: 'status' | 'claim' | 'joker', line?, cell? }
//   admin : { discordId, action: 'adminPreview' | 'adminConfig' | 'adminSetGrid', month?, cardIds?, reseed? }

import { refId, now, ok, fail, isAdmin, userById, parseJson, firstAttachment, cardSummary } from './common.js';
import { setting } from './settings.js';
import { seasonId, seasonEnd } from './seasons.js';
import { addFeed } from './feed.js';
import { addShards } from './comfort.js';
import { grantCosmetic } from './cosmetics.js';

export const schema = {
  Users: { BingoMonth: { type: 'Text' }, BingoStats: { type: 'Text' }, BingoDone: { type: 'Text' }, BingoClaimed: { type: 'Text' }, BingoJoker: { type: 'Text' } }
};

const SIZE = 5;
const FREE = 12;
const month = () => seasonId();
const monthNum = (m) => Number(m.replace('-', ''));
export const isV2 = (store, m = month()) => monthNum(m) >= (Number(setting(store, 'BingoV2From')) || 0);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// Objectifs du mois : evenement du bus d'activite -> compteur.
export const OBJECTIVES = [
  { key: 'open', icon: '🎴', label: 'Ouvrir {n} boosters', event: 'boosterOpened', n: 25 },
  { key: 'shiny', icon: '✨', label: 'Tirer {n} cartes à finition spéciale', event: 'shinyPulled', n: 3 },
  { key: 'edition', icon: '💠', label: 'Tirer une carte en édition limitée', event: 'editionPulled', n: 1 },
  { key: 'fish', icon: '🎣', label: 'Lancer sa ligne {n} fois', event: 'fish', n: 50 },
  { key: 'board', icon: '⛏️', label: 'Terminer {n} grilles de fouille', event: 'board', n: 8 },
  { key: 'treasure', icon: '💎', label: 'Déterrer {n} trésors', event: 'treasure', n: 10 },
  { key: 'harvest', icon: '🌻', label: 'Récolter {n} fois au jardin', event: 'harvest', n: 15 },
  { key: 'expedition', icon: '🧭', label: 'Revenir de {n} expéditions', event: 'expedition', n: 6 },
  { key: 'guess', icon: '❓', label: 'Deviner {n} cartes du jour', event: 'guess', n: 8 },
  { key: 'wheel', icon: '🎡', label: 'Tourner la roue {n} fois', event: 'wheel', n: 12 },
  { key: 'login', icon: '🔥', label: 'Récupérer {n} cadeaux de connexion', event: 'login', n: 15 },
  { key: 'trade', icon: '🤝', label: 'Conclure {n} échanges', event: 'tradeDone', n: 2 },
  { key: 'craft', icon: '🛠️', label: 'Crafter {n} cartes', event: 'craft', n: 2 },
  { key: 'disenchant', icon: '♻️', label: 'Décrafter {n} cartes', event: 'disenchant', n: 15 },
  { key: 'fusion', icon: '🌈', label: 'Améliorer une finition', event: 'fusion', n: 1 },
  { key: 'repair', icon: '🧽', label: 'Restaurer {n} cartes', event: 'repair', n: 2 },
  { key: 'boss', icon: '💀', label: 'Envoyer {n} cartes au boss', event: 'bossAttack', n: 8 },
  { key: 'chest', icon: '🧰', label: 'Ouvrir {n} coffres', event: 'chestOpened', n: 3 },
  { key: 'cdig', icon: '🪏', label: 'Donner {n} coups de pioche à la grande fouille', event: 'communityDig', n: 8 },
  { key: 'vault', icon: '🔒', label: 'Compléter une ligne du coffre-fort', event: 'vaultRow', n: 1 },
  { key: 'machine', icon: '⚙️', label: 'Remettre en marche la salle des machines', event: 'machineDone', n: 1 },
  { key: 'lottery', icon: '🎟️', label: 'Acheter {n} tickets de loterie', event: 'lotteryTicket', n: 3 },
  { key: 'wanted', icon: '📜', label: 'Répondre à un avis de recherche', event: 'wantedDonate', n: 1 },
  { key: 'duo', icon: '👯', label: 'Revenir d’une expédition en duo', event: 'duoDone', n: 1 }
];
const BY_EVENT = new Map();
OBJECTIVES.forEach((o) => { if (!BY_EVENT.has(o.event)) BY_EVENT.set(o.event, []); BY_EVENT.get(o.event).push(o); });

// Lignes : 5 lignes, 5 colonnes, 2 diagonales.
export const LINES = [
  ...Array.from({ length: SIZE }, (_, r) => ({ key: 'r' + r, label: `Ligne ${r + 1}`, cells: Array.from({ length: SIZE }, (_, c) => r * SIZE + c) })),
  ...Array.from({ length: SIZE }, (_, c) => ({ key: 'c' + c, label: `Colonne ${c + 1}`, cells: Array.from({ length: SIZE }, (_, r) => r * SIZE + c) })),
  { key: 'd1', label: 'Diagonale descendante', cells: [0, 6, 12, 18, 24] },
  { key: 'd2', label: 'Diagonale montante', cells: [4, 8, 12, 16, 20] }
];

// ------------------------------------------------------------------ grille du mois
function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const configKey = (m) => 'bingo:' + m;
function monthConfig(store, m) {
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === configKey(m)) : null;
  return row ? parseJson(row.Value, {}) : {};
}

// Cartes des cases "carte" : choisies par l'admin, sinon 3 de la rarete la plus
// commune, 3 de la suivante, le reste de la troisieme (jamais promo ni Unique).
function pickCards(store, m, cfg, rand) {
  const n = Math.max(0, Math.min(12, Number(setting(store, 'BingoCardCells')) || 0));
  const valid = (id) => { const c = store.get('Cards', Number(id)); return c && c.Active !== false ? c : null; };
  const chosen = (cfg.cardIds || []).map(valid).filter(Boolean).slice(0, n);
  if (chosen.length >= n) return chosen;
  const rarities = store.getAll('Rarities').filter((r) => r.Key !== 'unique').sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  const tiers = rarities.slice(0, 3).map((r) => r.id);
  const pool = store.getAll('Cards').filter((c) => c.Active !== false && !c.IsPromo && !chosen.some((x) => x.id === c.id));
  const plan = Array.from({ length: n - chosen.length }, (_, i) => tiers[Math.min(tiers.length - 1, i < 3 ? 0 : i < 6 ? 1 : 2)]);
  const out = [...chosen];
  for (const tier of plan) {
    const candidates = shuffle(pool.filter((c) => refId(c.Rarity) === tier && !out.some((x) => x.id === c.id)), rand);
    const pick = candidates[0] || shuffle(pool.filter((c) => !out.some((x) => x.id === c.id)), rand)[0];
    if (pick) out.push(pick);
  }
  return out;
}

const gridCache = new Map();
export function gridFor(store, m = month()) {
  const cfg = monthConfig(store, m);
  const cacheKey = m + '|' + JSON.stringify(cfg);
  if (gridCache.has(cacheKey)) return gridCache.get(cacheKey);
  const rand = rng(`bingo-${m}-${cfg.seed || ''}`);
  const cards = pickCards(store, m, cfg, rand).map((c) => ({ type: 'card', cardId: c.id }));
  const objectives = shuffle(OBJECTIVES, rand).slice(0, 24 - cards.length).map((o) => ({ type: 'objective', key: o.key }));
  const cells = shuffle([...cards, ...objectives], rand);
  cells.splice(FREE, 0, { type: 'free' });
  const grid = { month: m, cells };
  gridCache.clear();
  gridCache.set(cacheKey, grid);
  return grid;
}

// ------------------------------------------------------------------ progression d'un joueur
function progress(user, m = month()) {
  if (user.BingoMonth !== m) return { stats: {}, done: [FREE], claimed: [], joker: null };
  const done = parseJson(user.BingoDone, []);
  if (!done.includes(FREE)) done.push(FREE);
  return { stats: parseJson(user.BingoStats, {}), done, claimed: parseJson(user.BingoClaimed, []), joker: user.BingoJoker ? Number(user.BingoJoker) : null };
}
function save(store, user, p, m = month()) {
  return store.update('Users', user.id, { BingoMonth: m, BingoStats: JSON.stringify(p.stats), BingoDone: JSON.stringify([...new Set(p.done)].sort((a, b) => a - b)), BingoClaimed: JSON.stringify(p.claimed), BingoJoker: p.joker == null ? '' : String(p.joker) });
}
const objective = (key) => OBJECTIVES.find((o) => o.key === key);
const completeLines = (done) => LINES.filter((l) => l.cells.every((i) => done.includes(i)));

// Valide les cases remplies (cartes possedees, objectifs atteints) ; renvoie les nouvelles.
function refresh(store, user, grid, p) {
  const owned = new Set(store.getAll('Pulls').filter((x) => refId(x.User) === user.id).map((x) => refId(x.Card)));
  const fresh = [];
  grid.cells.forEach((cell, i) => {
    if (p.done.includes(i)) return;
    if (cell.type === 'card' && owned.has(cell.cardId)) fresh.push(i);
    if (cell.type === 'objective' && (Number(p.stats[cell.key]) || 0) >= objective(cell.key).n) fresh.push(i);
  });
  p.done.push(...fresh);
  return fresh;
}

function cellView(store, cell, i, p, owned) {
  const base = { index: i, type: cell.type, done: p.done.includes(i), joker: p.joker === i };
  if (cell.type === 'free') return { ...base, done: true, icon: '⭐', label: 'Case offerte' };
  if (cell.type === 'card') {
    const c = store.get('Cards', cell.cardId);
    return { ...base, card: c ? cardSummary(store, c) : null, label: c ? c.Name : '?', owned: owned.has(cell.cardId) };
  }
  const o = objective(cell.key);
  return { ...base, key: o.key, icon: o.icon, label: o.label.replace('{n}', o.n), target: o.n, progress: Math.min(o.n, Number(p.stats[o.key]) || 0) };
}

function leaderboard(store, grid, m) {
  return store.getAll('Users').filter((u) => u.BingoMonth === m).map((u) => {
    const p = progress(u, m);
    return { userId: u.id, pseudo: u.Pseudo, lines: completeLines(p.done).length, cells: p.done.length, full: p.done.length >= SIZE * SIZE };
  }).filter((r) => r.cells > 1).sort((a, b) => b.lines - a.lines || b.cells - a.cells).slice(0, 10);
}

function stateOf(store, user) {
  const m = month();
  const grid = gridFor(store, m);
  let p = progress(user, m);
  const fresh = refresh(store, user, grid, p);
  if (fresh.length || user.BingoMonth !== m) user = save(store, user, p, m);
  const owned = new Set(store.getAll('Pulls').filter((x) => refId(x.User) === user.id).map((x) => refId(x.Card)));
  const lines = completeLines(p.done).map((l) => l.key);
  const full = p.done.length >= SIZE * SIZE;
  return {
    version: 2, hasGrid: true, month: m, monthLabel: monthLabel(m), endsAt: seasonEnd(m),
    cells: grid.cells.map((c, i) => cellView(store, c, i, p, owned)),
    lines: LINES.map((l) => ({ key: l.key, label: l.label, cells: l.cells, complete: lines.includes(l.key), claimed: p.claimed.includes(l.key) })),
    full, fullClaimed: p.claimed.includes('full'),
    rewards: { line: setting(store, 'BingoLineReward'), full: setting(store, 'BingoFullReward') },
    joker: { used: p.joker != null, cell: p.joker, price: setting(store, 'BingoJokerPrice') },
    stardust: Number(user.StardustCount) || 0,
    top: leaderboard(store, grid, m)
  };
}

// ------------------------------------------------------------------ bus d'activite
export function onEvents(store, events) {
  if (!isV2(store)) return [];
  const m = month();
  const grid = gridFor(store, m);
  const notices = [];
  const byUser = new Map();
  for (const e of events) {
    const objs = BY_EVENT.get(e.type);
    const cardish = e.type === 'cardsPulled' || e.type === 'tradeDone' || e.type === 'craft';
    if (!objs && !cardish) continue;
    if (!byUser.has(e.userId)) byUser.set(e.userId, []);
    byUser.get(e.userId).push(e);
  }
  for (const [uid, list] of byUser) {
    let user = store.get('Users', uid);
    if (!user) continue;
    const p = progress(user, m);
    const linesBefore = completeLines(p.done).length;
    for (const e of list) for (const o of BY_EVENT.get(e.type) || []) p.stats[o.key] = (Number(p.stats[o.key]) || 0) + (Number(e.n) || 1);
    const fresh = refresh(store, user, grid, p);
    user = save(store, user, p, m);
    for (const i of fresh) {
      const v = cellView(store, grid.cells[i], i, p, new Set());
      notices.push({ userId: uid, kind: 'bingo', icon: '🎱', label: `Bingo : case validée (${v.label})` });
    }
    const linesAfter = completeLines(p.done).length;
    if (linesAfter > linesBefore) notices.push({ userId: uid, kind: 'bingo', icon: '🎉', label: p.done.length >= SIZE * SIZE ? 'CARTON PLEIN au bingo ! Récupère ta récompense dans Jeux > Bingo.' : `Bingo ! ${linesAfter - linesBefore > 1 ? (linesAfter - linesBefore) + ' nouvelles lignes' : 'Nouvelle ligne'} à récupérer dans Jeux > Bingo.` });
  }
  return notices;
}

// ------------------------------------------------------------------ actions
function claim(store, user, lineKey) {
  const st = stateOf(store, user);
  const p = progress(store.get('Users', user.id));
  if (lineKey === 'full') {
    if (!st.full) return fail('grid_not_complete', 400, st);
    if (p.claimed.includes('full')) return fail('already_claimed', 400, st);
    const r = setting(store, 'BingoFullReward');
    p.claimed.push('full');
    let u = save(store, store.get('Users', user.id), p);
    u = store.update('Users', u.id, { BoosterCount: (Number(u.BoosterCount) || 0) + (Number(r.boosters) || 0), StardustCount: (Number(u.StardustCount) || 0) + (Number(r.dust) || 0) });
    grantCosmetic(store, u.id, `bingo-full-${st.month}`, { type: 'title', label: `Roi du bingo 🎱 (${st.monthLabel})` });
    addFeed(store, { userId: u.id, kind: 'bingo', icon: '🎱', text: `fait CARTON PLEIN au bingo de ${st.monthLabel} !` });
    return ok({ ...stateOf(store, u), reward: { boosters: Number(r.boosters) || 0, dust: Number(r.dust) || 0, title: true } });
  }
  const line = st.lines.find((l) => l.key === lineKey);
  if (!line) return fail('unknown_line');
  if (!line.complete) return fail('line_not_complete', 400, st);
  if (line.claimed) return fail('already_claimed', 400, st);
  const r = setting(store, 'BingoLineReward');
  p.claimed.push(lineKey);
  let u = save(store, store.get('Users', user.id), p);
  u = store.update('Users', u.id, { StardustCount: (Number(u.StardustCount) || 0) + (Number(r.dust) || 0), BoosterCount: (Number(u.BoosterCount) || 0) + (Number(r.boosters) || 0) });
  if (Number(r.shards) > 0) addShards(store, u.id, Number(r.shards));
  return ok({ ...stateOf(store, store.get('Users', u.id)), reward: { dust: Number(r.dust) || 0, shards: Number(r.shards) || 0, boosters: Number(r.boosters) || 0 } });
}

function joker(store, user, cell) {
  const st = stateOf(store, user);
  const i = Number(cell);
  if (st.joker.used) return fail('joker_used', 400, st);
  if (!Number.isInteger(i) || i < 0 || i >= SIZE * SIZE || i === FREE) return fail('invalid_cell', 400, st);
  if (st.cells[i].done) return fail('cell_done', 400, st);
  const price = setting(store, 'BingoJokerPrice');
  if ((Number(user.StardustCount) || 0) < price) return fail('not_enough_dust', 400, st);
  const u0 = store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) - price });
  const p = progress(u0);
  p.done.push(i);
  p.joker = i;
  const u = save(store, u0, p);
  return ok({ ...stateOf(store, u), jokerCell: i, paid: price });
}

// ------------------------------------------------------------------ ancien bingo (avant BingoV2From)
function monthKey(v) {
  if (typeof v === 'number') { const d = new Date(v * 1000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
  return (v || '').toString();
}
const refIdList = (v) => (Array.isArray(v) ? (v[0] === 'L' ? v.slice(1) : v) : []);
function legacy(store, body) {
  const m = month();
  const grids = store.tables.has('BingoGrids') ? store.getAll('BingoGrids') : [];
  const claims = store.tables.has('BingoClaims') ? store.getAll('BingoClaims') : [];
  const action = (body.action || '').toString();
  if (action === 'adminSetGrid') {
    if (!isAdmin(body.discordId)) return fail('forbidden', 403);
    const cardIds = Array.isArray(body.cardIds) ? body.cardIds.map(Number).filter((n) => Number.isFinite(n)) : [];
    if (cardIds.length !== 9) return fail('grid_needs_9_cards');
    const target = (body.month || m).toString();
    const existing = grids.find((g) => monthKey(g.Month) === target);
    const fields = { CardIds: ['L', ...cardIds], RewardBoosters: Number(body.rewardBoosters) || 0 };
    if (existing) store.update('BingoGrids', existing.id, fields); else store.create('BingoGrids', { Month: target, ...fields });
    return ok({ saved: true });
  }
  const userId = Number(body.userId);
  const grid = grids.find((g) => monthKey(g.Month) === m);
  if (!grid) return action === 'claim' ? fail('no_grid_this_month') : ok({ hasGrid: false });
  const owned = new Set(store.getAll('Pulls').filter((p) => refId(p.User) === userId).map((p) => refId(p.Card)));
  const cells = refIdList(grid.CardIds).map((cid) => {
    const card = store.get('Cards', Number(cid));
    if (!card) return null;
    const rarity = store.get('Rarities', refId(card.Rarity));
    return { cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image), rarity: rarity ? { key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex } : null, owned: owned.has(card.id) };
  }).filter(Boolean);
  const allOwned = cells.length === 9 && cells.every((c) => c.owned);
  const claimed = claims.some((c) => refId(c.User) === userId && monthKey(c.Month) === m);
  if (action === 'claim') {
    if (!allOwned) return fail('grid_not_complete');
    if (claimed) return fail('already_claimed');
    const user = store.get('Users', userId);
    store.create('BingoClaims', { User: userId, Month: m, ClaimedAt: now() });
    store.update('Users', userId, { BoosterCount: (Number(user && user.BoosterCount) || 0) + (Number(grid.RewardBoosters) || 0) });
    return ok({ claimed: true, rewardBoosters: Number(grid.RewardBoosters) || 0 });
  }
  return ok({ hasGrid: true, month: m, cells, allOwned, claimed });
}

// ------------------------------------------------------------------ route
function handleBingo({ store, body }) {
  const action = (body.action || 'status').toString();
  // Admin : apercu et configuration d'un mois de la version 2.
  if (action === 'adminPreview' || action === 'adminConfig') {
    if (!isAdmin(body.discordId)) return fail('forbidden', 403);
    const m = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? String(body.month) : month();
    if (action === 'adminConfig') {
      const cfg = monthConfig(store, m);
      const next = { ...cfg };
      if (Array.isArray(body.cardIds)) next.cardIds = body.cardIds.map(Number).filter((n) => n > 0);
      if (body.reseed) next.seed = Math.random().toString(36).slice(2, 8);
      const row = store.getAll('AppSettings').find((r) => r.Key === configKey(m));
      if (row) store.update('AppSettings', row.id, { Value: JSON.stringify(next) }); else store.create('AppSettings', { Key: configKey(m), Value: JSON.stringify(next) });
    }
    const grid = gridFor(store, m);
    const p = { done: [FREE], stats: {}, claimed: [], joker: null };
    return ok({ month: m, v2: isV2(store, m), config: monthConfig(store, m), cells: grid.cells.map((c, i) => cellView(store, c, i, p, new Set())), objectives: OBJECTIVES.map((o) => ({ key: o.key, icon: o.icon, label: o.label.replace('{n}', o.n) })) });
  }
  if (!isV2(store)) return legacy(store, body);
  if (action === 'adminSetGrid') return fail('use_admin_config', 400);
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if (action === 'status') return ok(stateOf(store, user));
  if (action === 'claim') return claim(store, user, body.line == null ? 'full' : String(body.line));
  if (action === 'joker') return joker(store, user, body.cell);
  return fail('unknown_action');
}

export function _reset() { gridCache.clear(); }
export const routes = { 'POST bingo': handleBingo };
