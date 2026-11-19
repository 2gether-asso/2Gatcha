// Salle interdite V2 (2026-11-19) : reputation du mois, contrats du croupier
// et bilan economique de la salle. Tout est compte apres coup (afterNative)
// sur les routes forbidden et casino : aucun jeu n'a a s'en occuper.
//  - Contrats : 3 par jour et par joueur (tirage fige pour la journee, parmi
//    ceux qu'il peut faire : jeux du casino ouverts, plusieurs machines...).
//    ForbiddenRepContractPoints par contrat, +15 les 3 faits. Un triple a la
//    machine : 2 points, un jackpot : 10.
//  - 10 paliers par mois (TIERS), une recompense chacun, creditee des le
//    palier atteint. Palier 5 : titre « Habitue de la salle » et la machine
//    « La Pie voleuse » (pour toujours) ; palier 10 : cadre et titre.
//  - Bilan (AppSettings ForbiddenLedger, 31 jours) : tours, poussieres payees
//    et gagnees a la machine, jetons booster, cartes, jackpots, caisse du
//    casino. Montre dans Admin > Sante (taux de retour).
// Users.ForbiddenRep = { month, pts, got: [paliers], best, day, list: [{ key, n, p }], all }

import { parisDay, parseJson, hash } from './common.js';
import { setting } from './settings.js';
import { grantCosmetic } from './cosmetics.js';
import { addFeed } from './feed.js';
import { levelOf as machineLevel, GAME_LEVEL, grantMachineFields, machinesOf } from './slots.js';
import { MINERALS, mineralsOf } from './digdepth.js';

export const schema = { Users: { ForbiddenRep: { type: 'Text' } } };

const monthOf = (at = Date.now()) => parisDay(0, at).slice(0, 7);
export const TIERS = [20, 50, 90, 140, 200, 270, 350, 440, 540, 650];
const REWARDS = [
  { label: '30 jetons du casino', chips: 30 },
  { label: '300 poussières', dust: 300 },
  { label: '3 tours gratuits', free: 3 },
  { label: '1 jeton booster', boosters: 1 },
  { label: 'Titre « Habitué de la salle » et la machine « La Pie voleuse »', title: ['rep-habitue', 'Habitué de la salle'], machine: 'pie' },
  { label: '2 clés', keys: 2 },
  { label: '3 minéraux de palier 3', minerals: 3 },
  { label: '2 jetons booster', boosters: 2 },
  { label: '5 tours gratuits et 100 jetons', free: 5, chips: 100 },
  { label: 'Cadre « Néon de la salle », titre « Pilier de la salle » et 2 jetons booster', frame: ['frame-salle', 'Néon de la salle'], title: ['rep-pilier', 'Pilier de la salle'], boosters: 2 }
];
const CONTRACTS = [
  { key: 'spins', ev: 'spin', n: 20, label: (n) => `Joue ${n} tours de machine` },
  { key: 'bet5', ev: 'spin5', n: 8, label: (n) => `Joue ${n} tours à la mise ×5` },
  { key: 'triple', ev: 'triple', n: 1, label: () => 'Fais un triple à la machine' },
  { key: 'other', ev: 'spinOther', n: 10, label: (n) => `Joue ${n} tours sur une autre machine que la Classique`, ok: (u) => machinesOf(u).owned.size > 1 },
  { key: 'nudge', ev: 'nudge', n: 2, label: (n) => `Relance ${n} fois un rouleau intrus` },
  { key: 'inlay', ev: 'inlay', n: 1, label: () => 'Sertis un minéral dans un rouleau' },
  { key: 'heart', ev: 'heart', n: 1, label: () => 'Nourris le Cœur de la salle' },
  { key: 'scratch', ev: 'scratch', n: 1, game: 'scratch', label: () => 'Gratte un ticket' },
  { key: 'lots', ev: 'lots', n: 1, game: 'lots', label: () => 'Échange des tickets au comptoir des lots' },
  { key: 'bj', ev: 'bj', n: 4, game: 'blackjack', label: (n) => `Joue ${n} mains de blackjack` },
  { key: 'bjwin', ev: 'bjwin', n: 2, game: 'blackjack', label: (n) => `Gagne ${n} mains de blackjack` },
  { key: 'cans', ev: 'cans', n: 1, game: 'cans', label: () => 'Fais une partie de chamboule-tout' },
  { key: 'plinko', ev: 'plinko', n: 4, game: 'plinko', label: (n) => `Lâche ${n} billes au Plinko` },
  { key: 'cups', ev: 'cups', n: 1, game: 'cups', label: () => 'Joue une partie de bonneteau' },
  { key: 'claw', ev: 'claw', n: 1, game: 'claw', label: () => 'Tente la machine à pinces' },
  { key: 'roulette', ev: 'roulette', n: 4, game: 'roulette', label: (n) => `Lance ${n} fois la roulette` },
  { key: 'tourney', ev: 'tourney', n: 10, label: (n) => `Joue ${n} tours du tournoi de la semaine`, ok: (u, store) => !!setting(store, 'ForbiddenTourneyEnabled') }
];
const ALL_BONUS = 15;

function contractsFor(store, user, day) {
  const lv = machineLevel(user).level;
  const pool = CONTRACTS.filter((c) => (!c.game || lv >= (GAME_LEVEL[c.game] || 1)) && (!c.ok || c.ok(user, store)));
  const order = pool.map((c) => ({ c, h: hash(`rep-${user.id}-${day}-${c.key}`) })).sort((a, b) => a.h - b.h).map((x) => x.c);
  // Toujours un contrat de machine (les 3 premiers du tableau) parmi les trois.
  const machineFirst = order.find((c) => ['spins', 'bet5', 'triple'].includes(c.key));
  const picked = [machineFirst, ...order.filter((c) => c !== machineFirst)].filter(Boolean).slice(0, 3);
  return picked.map((c) => ({ key: c.key, n: c.n, p: 0 }));
}
function stateOf(store, user) {
  const s = parseJson(user.ForbiddenRep, null) || {};
  const month = monthOf();
  const day = parisDay(0);
  const out = { best: Number(s.best) || 0, ...(s.month === month ? { month, pts: Number(s.pts) || 0, got: Array.isArray(s.got) ? s.got : [] } : { month, pts: 0, got: [] }) };
  if (s.day === day && Array.isArray(s.list)) Object.assign(out, { day, list: s.list, all: !!s.all });
  else Object.assign(out, { day, list: contractsFor(store, user, day), all: false });
  return out;
}
const tierOf = (pts) => TIERS.filter((t) => pts >= t).length;

export function repView(store, user) {
  if (!setting(store, 'ForbiddenRepEnabled')) return null;
  const s = stateOf(store, user);
  const tier = tierOf(s.pts);
  const byKey = new Map(CONTRACTS.map((c) => [c.key, c]));
  return {
    month: s.month, pts: s.pts, tier, max: TIERS.length, next: TIERS[tier] ?? null, prev: TIERS[tier - 1] || 0,
    tiers: TIERS.map((at, i) => ({ at, label: REWARDS[i].label, got: s.got.includes(i) })),
    contracts: s.list.map((x) => { const c = byKey.get(x.key); return { key: x.key, label: c ? c.label(x.n) : x.key, target: x.n, progress: Math.min(x.n, x.p), done: x.p >= x.n }; }),
    allDone: s.all, allBonus: ALL_BONUS, contractPoints: setting(store, 'ForbiddenRepContractPoints'), best: s.best
  };
}

// Recompense d'un palier : champs a ecrire (cosmetiques et machine a part).
function rewardFields(store, user, r, fields) {
  const add = (k, n) => { fields[k] = (fields[k] ?? (Number(user[k]) || 0)) + n; };
  if (r.chips) add('CasinoChips', r.chips);
  if (r.dust) add('StardustCount', r.dust);
  if (r.free) add('ForbiddenFreeSpins', r.free);
  if (r.boosters) add('BoosterCount', r.boosters);
  if (r.keys) add('KeyCount', r.keys);
  if (r.minerals) {
    const m = { ...mineralsOf({ ...user, ...fields }) };
    const pool = MINERALS.filter((x) => x.tier === 3);
    for (let i = 0; i < r.minerals && pool.length; i++) { const k = pool[Math.floor(Math.random() * pool.length)].key; m[k] = (Number(m[k]) || 0) + 1; }
    fields.Minerals = JSON.stringify(m);
  }
  if (r.title) grantCosmetic(store, user.id, r.title[0], { type: 'title', label: r.title[1] });
  if (r.frame) grantCosmetic(store, user.id, r.frame[0], { type: 'frame', label: r.frame[1] });
  if (r.machine) Object.assign(fields, grantMachineFields({ ...user, ...fields }, r.machine) || {});
}

// Evenements d'une reponse : { ev: nombre }.
function eventsOf(path, body, json) {
  const e = {};
  const add = (k, n = 1) => { if (n > 0) e[k] = (e[k] || 0) + n; };
  const action = body.action || 'status';
  if (path === 'forbidden') {
    if (action === 'spin' && Array.isArray(json.results)) {
      const r = json.results;
      add('spin', r.length);
      add('spin5', r.filter((x) => x.bet === 5).length);
      add('spinOther', r.filter((x) => x.machine && x.machine !== 'classique').length);
      add('triple', r.filter((x) => x.tier === 'triple' || x.tier === 'quad').length);
      add('jackpot', r.filter((x) => x.jackpot || (x.cascades || []).some((c) => c.jackpot)).length);
    }
    if (action === 'nudge' && json.nudge) { add('nudge'); if (json.nudge.tier === 'triple' || json.nudge.tier === 'quad') add('triple'); }
    if (action === 'inlay' && json.inlaid) add('inlay');
    if (action === 'feed') add('heart');
    if (action === 'tourney' && json.tourney && json.tourney.spun) add('tourney', json.tourney.spun);
  }
  if (path === 'casino') {
    const g = String(body.game || 'cashier');
    if (g === 'blackjack' && json.blackjack && json.blackjack.done && action !== 'status') { add('bj'); if (['win', 'blackjack'].includes(json.blackjack.result)) add('bjwin'); }
    if (g === 'roulette' && json.roulette && json.roulette.n != null) add('roulette');
    if (g === 'plinko' && json.plinko && json.plinko.bin != null) add('plinko');
    if (g === 'scratch' && action === 'new') add('scratch');
    if (g === 'cans' && action === 'start') add('cans');
    if (g === 'cups' && action === 'start') add('cups');
    if (g === 'claw' && action === 'grab') add('claw');
    if (g === 'lots' && json.bought) add('lots');
  }
  return e;
}

function track(store, user, ev) {
  const s = stateOf(store, user);
  const notices = [];
  let gained = 0;
  const cp = setting(store, 'ForbiddenRepContractPoints');
  const byKey = new Map(CONTRACTS.map((c) => [c.key, c]));
  for (const x of s.list) {
    const c = byKey.get(x.key);
    if (!c || x.p >= x.n || !ev[c.ev]) continue;
    x.p = Math.min(x.n, x.p + ev[c.ev]);
    if (x.p >= x.n) { gained += cp; notices.push({ icon: '📜', text: `Contrat du croupier rempli : ${c.label(x.n)} (+${cp} réputation)` }); }
  }
  if (!s.all && s.list.length && s.list.every((x) => x.p >= x.n)) { s.all = true; gained += ALL_BONUS; notices.push({ icon: '🎩', text: `Les 3 contrats du jour : +${ALL_BONUS} réputation en plus` }); }
  gained += 2 * (ev.triple || 0) + 10 * (ev.jackpot || 0);
  const before = tierOf(s.pts);
  s.pts += gained;
  const after = tierOf(s.pts);
  const fields = {};
  for (let i = before; i < after; i++) {
    if (s.got.includes(i)) continue;
    s.got.push(i);
    rewardFields(store, user, REWARDS[i], fields);
    notices.push({ icon: '⭐', text: `Réputation de la salle, palier ${i + 1} : ${REWARDS[i].label} !` });
    if (i === TIERS.length - 1) addFeed(store, { userId: user.id, kind: 'forbidden', icon: '⭐', text: 'devient un pilier de la salle interdite ce mois-ci.' });
  }
  s.best = Math.max(s.best, after);
  const next = JSON.stringify(s);
  if (next === String(user.ForbiddenRep || '') && !Object.keys(fields).length) return { user, notices };
  fields.ForbiddenRep = next;
  return { user: store.update('Users', user.id, fields), notices };
}

// ------------------------------------------------------------------ bilan
const LEDGER_DAYS = 31;
function ledgerAdd(store, add) {
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === 'ForbiddenLedger') : null;
  const v = (row && parseJson(row.Value, null)) || { days: {} };
  const day = parisDay(0);
  const d = v.days[day] || {};
  for (const [k, n] of Object.entries(add)) if (n) d[k] = (Number(d[k]) || 0) + n;
  v.days[day] = d;
  const keep = Object.keys(v.days).sort().slice(-LEDGER_DAYS);
  v.days = Object.fromEntries(keep.map((k) => [k, v.days[k]]));
  if (row) store.update('AppSettings', row.id, { Value: JSON.stringify(v) }); else store.create('AppSettings', { Key: 'ForbiddenLedger', Value: JSON.stringify(v) });
}
function ledgerOf(path, body, json) {
  const action = body.action || 'status';
  if (path === 'forbidden' && action === 'spin' && Array.isArray(json.results)) {
    const all = json.results.flatMap((r) => [r, ...(r.cascades || [])]);
    return {
      spins: json.results.length, paid: Number(json.paid) || 0, paidChips: Number(json.paidChips) || 0,
      won: all.reduce((s, x) => s + (Number(x.dust) || 0), 0), boosters: all.reduce((s, x) => s + (Number(x.boosters) || 0), 0),
      cards: all.reduce((s, x) => s + ((x.cards || []).length), 0), jackpots: all.filter((x) => x.jackpot).length, jackpotDust: all.reduce((s, x) => s + (Number(x.jackpot) || 0), 0),
      chipsWon: json.results.reduce((s, r) => s + (Number(r.chipsWon) || 0), 0)
    };
  }
  if (path === 'forbidden' && action === 'nudge' && json.nudge) return { nudges: 1, paid: Number(json.paid) || 0, won: Number(json.nudge.dust) || 0, boosters: Number(json.nudge.boosters) || 0, cards: (json.nudge.cards || []).length };
  if (path === 'casino' && String(body.game || 'cashier') === 'cashier') {
    if (action === 'buy') return { chipsBought: Number(json.bought) || 0, dustToChips: Number(json.paid) || 0 };
    if (action === 'cashout') return { chipsSold: Number(json.cashedOut) || 0, dustFromChips: Number(json.dust) || 0 };
  }
  return null;
}
export function ledgerView(store) {
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === 'ForbiddenLedger') : null;
  const v = (row && parseJson(row.Value, null)) || { days: {} };
  const days = Object.entries(v.days).sort(([a], [b]) => (a < b ? 1 : -1)).map(([day, d]) => ({ day, ...d }));
  const sum = (list, k) => list.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const week = days.slice(0, 7);
  const paid = sum(week, 'paid'), won = sum(week, 'won');
  return {
    days, week: { spins: sum(week, 'spins'), paid, won, rtp: paid ? Math.round((won / paid) * 100) : null, boosters: sum(week, 'boosters'), cards: sum(week, 'cards'), jackpots: sum(week, 'jackpots'), dustToChips: sum(week, 'dustToChips'), dustFromChips: sum(week, 'dustFromChips') },
    payoutScale: setting(store, 'ForbiddenPayoutScale')
  };
}

export function afterNative({ store, path, request, response }) {
  if (path !== 'forbidden' && path !== 'casino') return;
  const json = response.json;
  const body = request.body || {};
  const l = ledgerOf(path, body, json);
  if (l) ledgerAdd(store, l);
  if (!setting(store, 'ForbiddenRepEnabled')) return;
  const user = store.get('Users', Number(body.userId));
  if (!user || !(Number(user.ForbiddenUnlocked) > 0)) return;
  const ev = eventsOf(path, body, json);
  const r = Object.keys(ev).length ? track(store, user, ev) : { user, notices: [] };
  json.rep = repView(store, r.user);
  if (r.notices.length) json.repNotices = r.notices;
}
export const _test = { CONTRACTS, REWARDS, eventsOf };
