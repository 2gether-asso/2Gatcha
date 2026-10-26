// Casino de la Salle Interdite (2026-10-25) : la suite de la machine a sous
// (slots.js) une fois la porte ouverte (forbidden.js), pour que ce pan du jeu
// reste plein de choses a faire entre deux extensions.
//  - Deux monnaies : les JETONS (Users.CasinoChips) servent a miser ; ils
//    s'achetent a la caisse contre des poussieres (CasinoChipPrice, indexe
//    sur l'inflation) et se revendent a CasinoCashoutRate. Les TICKETS
//    (Users.CasinoTickets) se gagnent aux jeux et s'echangent au comptoir des
//    lots (jetons booster, cles, appats, pieces, carte Interdite, cosmetiques
//    du casino).
//  - Niveau VIP (Users.CasinoXP = jetons mises) : jetons offerts chaque jour
//    a la caisse (CasinoDailyChipsPerLevel x niveau).
//  - Jeux : Blackjack, Roulette, Chamboule-tout des doublons (boites aux
//    couleurs des raretes, 3 balles), Machine a pinces (capsules : booster ou
//    cosmetique de profil), Plinko des createurs, Bonneteau des mascottes
//    (booster rare sous un gobelet), Ticket a gratter quotidien (gratuit 1x
//    par jour, d'autres contre des jetons). Tout est tire par le serveur :
//    le site ne fait qu'animer le resultat.
//   POST /webhook/casino { userId, game, action, ... }  (game: cashier | lots | blackjack | roulette | cans | claw | plinko | cups | scratch)
// Users.CasinoState = { bj, cans, claw, cups, scratch } ; Users.CasinoDaily = { day, ... }
// 2026-10-26 : les jeux s'ouvrent un a un avec le niveau de la machine a sous
// (slots.js, GAME_LEVEL) ; les jetons peuvent aussi payer les tours de la machine.

import { ok, fail, userById, now, parisDay, parseJson, refId, nextSerial } from './common.js';
import { setting } from './settings.js';
import { priceMultiplier } from './inflation.js';
import { grantCosmetic, catalog as cosmeticCatalog } from './cosmetics.js';
import { addFeed } from './feed.js';
import { levelOf as machineLevel, GAME_LEVEL } from './slots.js';
import { addTabletsFields } from './archeo.js';


export const schema = {
  Users: { CasinoChips: { type: 'Numeric' }, CasinoTickets: { type: 'Numeric' }, CasinoXP: { type: 'Numeric' }, CasinoState: { type: 'Text' }, CasinoDaily: { type: 'Text' }, CasinoStats: { type: 'Text' } }
};

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const VIP = [0, 200, 600, 1500, 3500, 8000, 15000, 30000, 60000, 120000];
const LOTS = [
  { key: 'booster', label: 'Jeton booster', icon: '🃏', price: 40, give: { BoosterCount: 1 } },
  { key: 'key', label: 'Clé de coffre', icon: '🔑', price: 25, give: { KeyCount: 1 } },
  { key: 'bait', label: '2 appâts dorés', icon: '🪝', price: 15, give: { GoldBait: 2 } },
  { key: 'part', label: 'Pièce détachée', icon: '🔩', price: 30, give: { SpareParts: 1 } },
  { key: 'bone', label: '2 os pour Milo', icon: '🦴', price: 18, give: { BoneCount: 2 } },
  { key: 'tablet', label: 'Pierre gravée (tablette rare)', icon: '🪨', price: 20, tablet: 'stone' },
  { key: 'card', label: 'Carte Interdite (épique ou mieux)', icon: '⛓️', price: 90, card: true },
  { key: 'title-flambeur', label: 'Titre « Flambeur »', icon: '🎩', price: 120, cosmetic: { type: 'title', label: 'Flambeur' } },
  { key: 'title-highroller', label: 'Titre « High roller »', icon: '💼', price: 300, cosmetic: { type: 'title', label: 'High roller' } },
  { key: 'frame-casino', label: 'Cadre « Néon du casino »', icon: '🖼️', price: 220, cosmetic: { type: 'frame', label: 'Cadre néon du casino' } },
  { key: 'color-casino', label: 'Pseudo « Or du casino »', icon: '🎨', price: 180, cosmetic: { type: 'color', label: 'Pseudo or du casino' } }
];
// Peluches et capsules de la machine a pinces : cosmetiques exclusifs.
const PLUSH = [
  { key: 'title-peluche-milo', type: 'title', label: 'Ami de Milo' },
  { key: 'title-peluche-moka', type: 'title', label: 'Câlin de Moka' },
  { key: 'title-pince', type: 'title', label: 'Pince d’or' },
  { key: 'frame-peluche', type: 'frame', label: 'Cadre peluche' },
  { key: 'color-bonbon', type: 'color', label: 'Pseudo bonbon' }
];
const CAN_VALUE = { commune: 1, rare: 2, epique: 3, legendaire: 5, mythique: 8 };
const MASCOTS = [{ key: 'milo', name: 'Milo', icon: '🐕' }, { key: 'moka', name: 'Moka', icon: '🐈' }, { key: 'pepper', name: 'Pepper', icon: '🦜' }];
const PLINKO_MULTS = [9, 2.5, 1.2, 0.7, 0.4, 0.7, 1.2, 2.5, 9];
const SCRATCH = [
  { key: 'dust', icon: '✨', label: '150 poussières', weight: 30, give: { StardustCount: 150 } },
  { key: 'tickets', icon: '🎟️', label: '8 tickets', weight: 26, give: { CasinoTickets: 8 } },
  { key: 'chips', icon: '🪙', label: '30 jetons', weight: 24, give: { CasinoChips: 30 } },
  { key: 'key', icon: '🔑', label: '1 clé', weight: 10, give: { KeyCount: 1 } },
  { key: 'booster', icon: '🃏', label: '1 jeton booster', weight: 6, give: { BoosterCount: 1 } },
  { key: 'jackpot', icon: '💎', label: '600 poussières', weight: 4, give: { StardustCount: 600 } }
];

// ------------------------------------------------------------------ etat
const chips = (u) => Number(u.CasinoChips) || 0;
const tickets = (u) => Number(u.CasinoTickets) || 0;
const stateOf = (u) => { const s = parseJson(u.CasinoState, {}); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; };
function dailyOf(u) { const d = parseJson(u.CasinoDaily, null); return d && d.day === parisDay(0) ? d : { day: parisDay(0) }; }
const statsOf = (u) => parseJson(u.CasinoStats, {}) || {};
function vipOf(u) {
  const xp = Number(u.CasinoXP) || 0;
  let level = 1;
  VIP.forEach((t, i) => { if (xp >= t) level = i + 1; });
  return { level, xp, prev: VIP[level - 1], next: VIP[level] ?? null };
}
export const chipPrice = (store) => Math.max(1, Math.round(setting(store, 'CasinoChipPrice') * Math.max(1, priceMultiplier(store))));
const maxBet = (store) => setting(store, 'CasinoMaxBet');

// Ecrit un changement : jetons/tickets/etat/journee/stats + autres champs.
function save(store, user, { chipsDelta = 0, ticketsDelta = 0, state, daily, stat, xp = 0, fields = {} } = {}) {
  const f = { ...fields };
  if (chipsDelta) f.CasinoChips = Math.max(0, chips(user) + chipsDelta);
  if (ticketsDelta) f.CasinoTickets = Math.max(0, tickets(user) + ticketsDelta);
  if (state) f.CasinoState = JSON.stringify(state);
  if (daily) f.CasinoDaily = JSON.stringify(daily);
  if (xp) f.CasinoXP = (Number(user.CasinoXP) || 0) + xp;
  if (stat) {
    const s = statsOf(user);
    for (const [k, v] of Object.entries(stat)) s[k] = (Number(s[k]) || 0) + v;
    f.CasinoStats = JSON.stringify(s);
  }
  return Object.keys(f).length ? store.update('Users', user.id, f) : user;
}
// Ajoute des champs entiers (give : { Champ: n }) a ecrire.
function giveFields(user, give, base = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(give || {})) {
    if (k === 'CasinoChips' || k === 'CasinoTickets') continue;
    out[k] = (out[k] ?? (Number(user[k]) || 0)) + v;
  }
  return out;
}

// Mise : refus si pas assez de jetons ou hors limites.
function checkBet(store, user, bet) {
  const b = Math.floor(Number(bet) || 0);
  if (b < 1 || b > maxBet(store)) return { error: fail('invalid_bet', 400, { maxBet: maxBet(store) }) };
  if (chips(user) < b) return { error: fail('not_enough_chips', 400, { chips: chips(user) }) };
  return { bet: b };
}

function bigWinFeed(store, user, label, amount) {
  if (amount >= setting(store, 'CasinoFeedThreshold')) addFeed(store, { userId: user.id, kind: 'casino', icon: '🎰', text: `rafle ${amount.toLocaleString('fr-FR')} jetons au ${label} de la salle interdite !` });
}

// ------------------------------------------------------------------ blackjack
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const newDeck = () => shuffle(SUITS.flatMap((s) => RANKS.map((r) => ({ r, s }))).concat(SUITS.flatMap((s) => RANKS.map((r) => ({ r, s })))));
function handValue(cards) {
  let v = 0, aces = 0;
  for (const c of cards) { if (c.r === 'A') { aces++; v += 11; } else v += ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r); }
  while (v > 21 && aces) { v -= 10; aces--; }
  return v;
}
const isBJ = (cards) => cards.length === 2 && handValue(cards) === 21;
function bjView(bj, reveal) {
  if (!bj) return null;
  const dealer = reveal || bj.done ? bj.dealer : [bj.dealer[0], { r: '?', s: '?' }];
  return { player: bj.player, dealer, playerValue: handValue(bj.player), dealerValue: reveal || bj.done ? handValue(bj.dealer) : handValue([bj.dealer[0]]), bet: bj.bet, doubled: !!bj.doubled, done: !!bj.done, result: bj.result || null, payout: bj.payout || 0, canDouble: !bj.done && bj.player.length === 2 };
}
function bjSettle(store, user, st, bj) {
  const pv = handValue(bj.player);
  if (pv <= 21) while (handValue(bj.dealer) < 17) bj.dealer.push(bj.deck.pop());
  const dv = handValue(bj.dealer);
  let result, payout = 0, tix = 0;
  if (pv > 21) result = 'bust';
  else if (isBJ(bj.player) && !isBJ(bj.dealer)) { result = 'blackjack'; payout = Math.floor(bj.bet * 2.5); tix = 3; }
  else if (dv > 21 || pv > dv) { result = 'win'; payout = bj.bet * 2; tix = 1; }
  else if (pv === dv) { result = 'push'; payout = bj.bet; }
  else result = 'lose';
  bj.done = true; bj.result = result; bj.payout = payout;
  delete bj.deck;
  st.bj = bj;
  const u = save(store, user, { chipsDelta: payout, ticketsDelta: tix, state: st, stat: { bjHands: 1, bjWins: payout > bj.bet ? 1 : 0, won: payout } });
  if (payout > bj.bet) bigWinFeed(store, u, 'blackjack', payout);
  return { user: u, tix };
}
function blackjack(store, user, body) {
  const st = stateOf(user);
  let bj = st.bj && !st.bj.done ? st.bj : null;
  const action = body.action || 'status';
  if (action === 'status') return ok({ blackjack: bjView(st.bj, false) });
  if (action === 'deal') {
    if (bj) return fail('hand_in_progress', 400, { blackjack: bjView(bj, false) });
    const b = checkBet(store, user, body.bet);
    if (b.error) return b.error;
    const deck = newDeck();
    bj = { bet: b.bet, deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()] };
    user = save(store, user, { chipsDelta: -b.bet, xp: b.bet, stat: { wagered: b.bet } });
    st.bj = bj;
    if (isBJ(bj.player) || isBJ(bj.dealer)) { const r = bjSettle(store, user, st, bj); return ok({ blackjack: bjView(bj, true), tickets: r.tix, ...wallet(store, r.user) }); }
    user = save(store, user, { state: st });
    return ok({ blackjack: bjView(bj, false), ...wallet(store, user) });
  }
  if (!bj) return fail('no_hand');
  if (action === 'hit') {
    bj.player.push(bj.deck.pop());
    if (handValue(bj.player) >= 21) { const r = bjSettle(store, user, st, bj); return ok({ blackjack: bjView(bj, true), tickets: r.tix, ...wallet(store, r.user) }); }
    st.bj = bj;
    user = save(store, user, { state: st });
    return ok({ blackjack: bjView(bj, false), ...wallet(store, user) });
  }
  if (action === 'double') {
    if (bj.player.length !== 2) return fail('cannot_double');
    if (chips(user) < bj.bet) return fail('not_enough_chips');
    user = save(store, user, { chipsDelta: -bj.bet, xp: bj.bet, stat: { wagered: bj.bet } });
    bj.bet *= 2; bj.doubled = true;
    bj.player.push(bj.deck.pop());
    const r = bjSettle(store, user, st, bj);
    return ok({ blackjack: bjView(bj, true), tickets: r.tix, ...wallet(store, r.user) });
  }
  if (action === 'stand') { const r = bjSettle(store, user, st, bj); return ok({ blackjack: bjView(bj, true), tickets: r.tix, ...wallet(store, r.user) }); }
  return fail('unknown_action');
}

// ------------------------------------------------------------------ roulette
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function rouletteWins(n, bet) {
  const t = bet.type;
  if (t === 'number') return n === bet.n ? 36 : 0;
  if (n === 0) return 0;
  if (t === 'red') return REDS.has(n) ? 2 : 0;
  if (t === 'black') return !REDS.has(n) ? 2 : 0;
  if (t === 'odd') return n % 2 ? 2 : 0;
  if (t === 'even') return n % 2 ? 0 : 2;
  if (t === 'low') return n <= 18 ? 2 : 0;
  if (t === 'high') return n >= 19 ? 2 : 0;
  if (t === 'dozen1') return n <= 12 ? 3 : 0;
  if (t === 'dozen2') return n >= 13 && n <= 24 ? 3 : 0;
  if (t === 'dozen3') return n >= 25 ? 3 : 0;
  return 0;
}
const ROULETTE_TYPES = new Set(['number', 'red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'dozen2', 'dozen3']);
function roulette(store, user, body) {
  if ((body.action || 'spin') !== 'spin') return ok({ roulette: { reds: [...REDS] } });
  const bets = (Array.isArray(body.bets) ? body.bets : []).slice(0, 12).map((b) => ({ type: String(b && b.type), n: Math.floor(Number(b && b.n)), amount: Math.floor(Number(b && b.amount) || 0) }))
    .filter((b) => ROULETTE_TYPES.has(b.type) && b.amount > 0 && (b.type !== 'number' || (b.n >= 0 && b.n <= 36)));
  if (!bets.length) return fail('invalid_bet');
  const total = bets.reduce((s, b) => s + b.amount, 0);
  if (total > maxBet(store) * 5) return fail('invalid_bet', 400, { maxBet: maxBet(store) * 5 });
  if (chips(user) < total) return fail('not_enough_chips');
  const n = rnd(0, 36);
  const payout = bets.reduce((s, b) => s + b.amount * rouletteWins(n, b), 0);
  const tix = payout > total ? (bets.some((b) => b.type === 'number' && b.n === n) ? 5 : 1) : 0;
  user = save(store, user, { chipsDelta: payout - total, ticketsDelta: tix, xp: total, stat: { wagered: total, won: payout, spins: 1 } });
  if (payout > total) bigWinFeed(store, user, 'roulette', payout);
  return ok({ roulette: { n, color: n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black', bets: bets.map((b) => ({ ...b, win: b.amount * rouletteWins(n, b) })), total, payout }, tickets: tix, ...wallet(store, user) });
}

// ------------------------------------------------------------------ chamboule-tout
// Pyramide de 10 boites (4-3-2-1) aux couleurs des raretes. Une balle :
// x (0 a 1, position) et p (0 a 1, force) ; un peu de hasard sur les deux.
// La force choisit la rangee visee ; une boite touchee tombe, ses voisines
// proches tombent une fois sur deux, et une boite dont un appui tombe tombe aussi.
function newCans() {
  const rows = [shuffle(['commune', 'commune', 'rare', 'rare']), shuffle(['rare', 'epique', 'rare']), shuffle(['epique', 'legendaire']), ['mythique']];
  return { rows: rows.map((r) => r.map((rar) => ({ rar, down: false }))), balls: 3, score: 0 };
}
const canX = (r, i) => (i + 0.5 + r * 0.5) / 4;
function throwBall(cans, x, p) {
  const wx = Math.max(0, Math.min(1, x + (Math.random() - 0.5) * 0.12));
  const wp = Math.max(0, Math.min(1, p + (Math.random() - 0.5) * 0.14));
  const hit = [];
  if (wp > 0.97 || wp < 0.08) return { wx, wp, row: null, hit };
  const row = wp < 0.35 ? 0 : wp < 0.6 ? 1 : wp < 0.82 ? 2 : 3;
  cans.rows[row].forEach((c, i) => {
    if (c.down) return;
    const d = Math.abs(canX(row, i) - wx);
    if (d < 0.12 || (d < 0.25 && Math.random() < 0.5)) { c.down = true; hit.push([row, i]); }
  });
  // Boites sans appui.
  for (let r = 1; r < 4; r++) cans.rows[r].forEach((c, i) => {
    if (c.down) return;
    if (cans.rows[r - 1][i].down || cans.rows[r - 1][i + 1].down) { c.down = true; hit.push([r, i]); }
  });
  return { wx, wp, row, hit };
}
function cansView(c) { return c ? { rows: c.rows, balls: c.balls, score: c.rows.flat().filter((x) => x.down).reduce((s, x) => s + CAN_VALUE[x.rar], 0), done: !!c.done, result: c.result || null } : null; }
function cansGame(store, user, body) {
  const st = stateOf(user);
  const action = body.action || 'status';
  let c = st.cans && !st.cans.done ? st.cans : null;
  if (action === 'status') return ok({ cans: cansView(st.cans), canCost: setting(store, 'CasinoCanCost') });
  if (action === 'start') {
    if (c) return fail('game_in_progress', 400, { cans: cansView(c) });
    const cost = setting(store, 'CasinoCanCost');
    if (chips(user) < cost) return fail('not_enough_chips');
    st.cans = newCans();
    user = save(store, user, { chipsDelta: -cost, xp: cost, state: st, stat: { wagered: cost, cansGames: 1 } });
    return ok({ cans: cansView(st.cans), ...wallet(store, user) });
  }
  if (action !== 'throw') return fail('unknown_action');
  if (!c) return fail('no_game');
  const shot = throwBall(c, Number(body.x) || 0, Number(body.p) || 0);
  c.balls--;
  const allDown = c.rows.flat().every((x) => x.down);
  let reward = null;
  if (c.balls <= 0 || allDown) {
    const score = cansView(c).score * (allDown ? 2 : 1);
    reward = { score, strike: allDown, tickets: Math.floor(score / 4), dust: score * setting(store, 'CasinoCanDustPerPoint') };
    c.done = true; c.result = reward;
  }
  st.cans = c;
  user = save(store, user, { state: st, ...(reward ? { ticketsDelta: reward.tickets, fields: reward.dust ? { StardustCount: (Number(user.StardustCount) || 0) + reward.dust } : {}, stat: { cansStrikes: reward.strike ? 1 : 0 } } : {}) });
  return ok({ cans: cansView(c), shot, reward, ...wallet(store, user) });
}

// ------------------------------------------------------------------ machine a pinces
// Vue de cote (2026-10-26) : les capsules sont en tas au fond du bac (y de
// 0,6 a 0,92, 0 = haut) ; on ne vise qu'a l'horizontale et la pince descend
// sur la capsule la plus haute sous elle.
const CLAW_REACH = 0.075;
function newClaw() {
  const kinds = [...Array(2).fill('gold'), ...Array(3).fill('purple'), ...Array(5).fill('blue'), ...Array(2).fill('pink')];
  return { v: 3, day: parisDay(0), capsules: shuffle(kinds).map((kind, id) => ({ id, kind, x: Math.round((0.08 + Math.random() * 0.7) * 1000) / 1000, y: Math.round((0.6 + Math.random() * 0.32) * 1000) / 1000 })) };
}
function clawPrize(store, user, kind) {
  if (kind === 'gold') return { label: '1 jeton booster', icon: '🃏', fields: { BoosterCount: (Number(user.BoosterCount) || 0) + 1 } };
  const owned = new Set(store.tables.has('UserCosmetics') ? store.getAll('UserCosmetics').filter((r) => refId(r.User) === user.id).map((r) => r.Key) : []);
  let pool;
  if (kind === 'pink') pool = PLUSH;
  else {
    const cat = cosmeticCatalog(store).sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    const half = Math.ceil(cat.length / 2);
    pool = kind === 'purple' ? cat.slice(half) : cat.slice(0, half);
  }
  const left = pool.filter((c) => !owned.has(c.key));
  if (!left.length) return { label: '10 tickets (cosmétique déjà possédé)', icon: '🎟️', tickets: 10 };
  const c = pickOne(left);
  return { label: c.label, icon: c.type === 'title' ? '👑' : c.type === 'frame' ? '🖼️' : '🎨', cosmetic: { key: c.key, type: c.type, label: c.label } };
}
function claw(store, user, body) {
  const st = stateOf(user);
  if (!st.claw || st.claw.v !== 3 || st.claw.day !== parisDay(0) || st.claw.capsules.length < 3) st.claw = newClaw();
  const action = body.action || 'status';
  const view = () => ({ capsules: st.claw.capsules, cost: setting(store, 'CasinoClawCost') });
  if (action === 'status') { user = save(store, user, { state: st }); return ok({ claw: view() }); }
  if (action !== 'grab') return fail('unknown_action');
  const cost = setting(store, 'CasinoClawCost');
  if (chips(user) < cost) return fail('not_enough_chips');
  const x = Math.max(0, Math.min(1, Number(body.x) || 0));
  // La pince tremble un peu en descendant.
  const gx = x + (Math.random() - 0.5) * 0.03;
  // Capsule la plus haute sous la pince (dans sa portee), sinon le vide.
  const under = st.claw.capsules.filter((c) => Math.abs(c.x - gx) <= CLAW_REACH).sort((a, b) => a.y - b.y);
  const best = under[0] || null;
  const bd = best ? Math.abs(best.x - gx) : Infinity;
  const gy = best ? best.y : 0.95;
  const reach = CLAW_REACH;
  let outcome = 'miss', prize = null;
  if (best && bd <= reach) {
    const grip = setting(store, 'CasinoClawGrip') * (1 - (bd / reach) * 0.6);
    if (Math.random() < grip) {
      if (Math.random() < 0.18) {
        outcome = 'dropped';
        best.x = Math.max(0.08, Math.min(0.78, best.x + (Math.random() - 0.5) * 0.3));
        best.y = Math.round((0.6 + Math.random() * 0.32) * 1000) / 1000;
      } else {
        outcome = 'won';
        st.claw.capsules = st.claw.capsules.filter((c) => c !== best);
        prize = clawPrize(store, user, best.kind);
      }
    } else outcome = 'slipped';
  }
  const fields = prize && prize.fields ? prize.fields : {};
  user = save(store, user, { chipsDelta: -cost, ticketsDelta: prize && prize.tickets ? prize.tickets : 0, xp: cost, state: st, fields, stat: { wagered: cost, clawWins: outcome === 'won' ? 1 : 0 } });
  if (prize && prize.cosmetic) grantCosmetic(store, user.id, prize.cosmetic.key, { type: prize.cosmetic.type, label: prize.cosmetic.label });
  return ok({ claw: view(), grab: { x: Math.round(gx * 1000) / 1000, y: Math.round(gy * 1000) / 1000, target: best && bd <= reach ? best.id : null, kind: best ? best.kind : null, outcome, prize: prize ? { label: prize.label, icon: prize.icon } : null }, ...wallet(store, user) });
}

// ------------------------------------------------------------------ plinko
function plinko(store, user, body) {
  if ((body.action || 'drop') !== 'drop') return ok({ plinko: { mults: PLINKO_MULTS, rows: 8 } });
  const b = checkBet(store, user, body.bet);
  if (b.error) return b.error;
  const x = Math.max(0, Math.min(1, Number(body.x) || 0.5));
  // Le point de lacher penche tres legerement la bille (au plus 6 %).
  const pRight = 0.5 + (x - 0.5) * 0.12;
  let pos = 0;
  const path = [];
  for (let r = 0; r < 8; r++) { if (Math.random() < pRight) pos++; path.push(pos); }
  const mult = PLINKO_MULTS[pos];
  const payout = Math.floor(b.bet * mult);
  const tix = pos === 0 || pos === 8 ? 3 : pos === 1 || pos === 7 ? 1 : 0;
  user = save(store, user, { chipsDelta: payout - b.bet, ticketsDelta: tix, xp: b.bet, stat: { wagered: b.bet, won: payout, plinko: 1 } });
  if (payout > b.bet) bigWinFeed(store, user, 'Plinko', payout);
  return ok({ plinko: { x, path, bin: pos, mult, payout, bet: b.bet, mults: PLINKO_MULTS }, tickets: tix, ...wallet(store, user) });
}

// ------------------------------------------------------------------ bonneteau
const CUPS_MULT = { 1: 1.8, 2: 2.4, 3: 3.2 };
function cups(store, user, body) {
  const st = stateOf(user);
  const daily = dailyOf(user);
  const action = body.action || 'status';
  if (action === 'status') return ok({ cups: { playsLeft: Math.max(0, setting(store, 'CasinoCupsDaily') - (Number(daily.cups) || 0)), mults: CUPS_MULT, boosterBet: setting(store, 'CasinoCupsBoosterBet'), boosterLeft: (Number(daily.cupsBooster) || 0) < 1, pending: st.cups && !st.cups.done ? true : false } });
  if (action === 'start') {
    if ((Number(daily.cups) || 0) >= setting(store, 'CasinoCupsDaily')) return fail('daily_limit');
    const b = checkBet(store, user, body.bet);
    if (b.error) return b.error;
    const speed = [1, 2, 3].includes(Number(body.speed)) ? Number(body.speed) : 1;
    const start = rnd(0, 2);
    const swaps = [];
    let pos = start;
    for (let i = 0; i < 4 + speed * 3; i++) {
      const pair = pickOne([[0, 1], [1, 2], [0, 2]]);
      swaps.push(pair);
      if (pos === pair[0]) pos = pair[1]; else if (pos === pair[1]) pos = pair[0];
    }
    const mascot = pickOne(MASCOTS);
    st.cups = { final: pos, bet: b.bet, speed, done: false };
    daily.cups = (Number(daily.cups) || 0) + 1;
    user = save(store, user, { chipsDelta: -b.bet, xp: b.bet, state: st, daily, stat: { wagered: b.bet, cups: 1 } });
    return ok({ cups: { start, swaps, speed, swapMs: [0, 520, 340, 220][speed], mascot, bet: b.bet }, ...wallet(store, user) });
  }
  if (action !== 'pick') return fail('unknown_action');
  const c = st.cups;
  if (!c || c.done) return fail('no_game');
  const pickCup = Math.floor(Number(body.cup));
  const win = pickCup === c.final;
  c.done = true;
  let payout = 0, booster = false, tix = 0;
  const fields = {};
  if (win) {
    payout = Math.floor(c.bet * CUPS_MULT[c.speed]);
    tix = c.speed;
    if (c.speed >= 2 && c.bet >= setting(store, 'CasinoCupsBoosterBet') && (Number(daily.cupsBooster) || 0) < 1) {
      booster = true; daily.cupsBooster = 1; fields.BoosterCount = (Number(user.BoosterCount) || 0) + 1;
    }
  }
  st.cups = c;
  user = save(store, user, { chipsDelta: payout, ticketsDelta: tix, state: st, daily, fields, stat: { won: payout, cupsWins: win ? 1 : 0 } });
  return ok({ cups: { final: c.final, win, payout, booster }, tickets: tix, ...wallet(store, user) });
}

// ------------------------------------------------------------------ ticket a gratter
function newScratch(free) {
  const win = Math.random() < (free ? 0.55 : 0.4);
  const prize = (() => { const total = SCRATCH.reduce((s, x) => s + x.weight, 0); let r = Math.random() * total; for (const x of SCRATCH) { r -= x.weight; if (r <= 0) return x; } return SCRATCH[0]; })();
  let symbols;
  if (win) {
    const others = SCRATCH.filter((x) => x.key !== prize.key);
    const fill = [];
    // 6 autres symboles, jamais 3 fois le meme.
    while (fill.length < 6) { const s = pickOne(others).key; if (fill.filter((k) => k === s).length < 2) fill.push(s); }
    symbols = shuffle([prize.key, prize.key, prize.key, ...fill]);
  } else {
    const fill = [];
    while (fill.length < 9) { const s = pickOne(SCRATCH).key; if (fill.filter((k) => k === s).length < 2) fill.push(s); }
    symbols = fill;
  }
  return { id: Date.now(), free, symbols, prize: win ? prize.key : null, claimed: false };
}
const scratchView = (s) => (s ? { id: s.id, free: s.free, symbols: s.symbols.map((k) => SCRATCH.find((x) => x.key === k).icon), win: !!s.prize, prize: s.prize ? SCRATCH.find((x) => x.key === s.prize).label : null, claimed: s.claimed } : null);
function scratch(store, user, body) {
  const st = stateOf(user);
  const daily = dailyOf(user);
  const action = body.action || 'status';
  const info = () => ({ freeToday: !daily.scratchFree, extraLeft: Math.max(0, setting(store, 'CasinoScratchExtra') - (Number(daily.scratchExtra) || 0)), cost: setting(store, 'CasinoScratchCost'), prizes: SCRATCH.map((x) => ({ icon: x.icon, label: x.label })) });
  if (action === 'status') return ok({ scratch: { ...info(), ticket: st.scratch && !st.scratch.claimed ? scratchView(st.scratch) : null } });
  if (action === 'new') {
    if (st.scratch && !st.scratch.claimed) return fail('ticket_pending', 400, { scratch: { ...info(), ticket: scratchView(st.scratch) } });
    const free = !daily.scratchFree;
    let chipsDelta = 0;
    if (free) daily.scratchFree = true;
    else {
      if ((Number(daily.scratchExtra) || 0) >= setting(store, 'CasinoScratchExtra')) return fail('daily_limit');
      const cost = setting(store, 'CasinoScratchCost');
      if (chips(user) < cost) return fail('not_enough_chips');
      chipsDelta = -cost;
      daily.scratchExtra = (Number(daily.scratchExtra) || 0) + 1;
    }
    st.scratch = newScratch(free);
    user = save(store, user, { chipsDelta, xp: -chipsDelta, state: st, daily, stat: { scratch: 1 } });
    return ok({ scratch: { ...info(), ticket: scratchView(st.scratch) }, ...wallet(store, user) });
  }
  if (action !== 'claim') return fail('unknown_action');
  const s = st.scratch;
  if (!s || s.claimed) return fail('no_ticket');
  s.claimed = true;
  const prize = s.prize ? SCRATCH.find((x) => x.key === s.prize) : null;
  const give = prize ? prize.give : { CasinoChips: s.free ? 5 : 0 };
  st.scratch = s;
  user = save(store, user, { state: st, chipsDelta: give.CasinoChips || 0, ticketsDelta: give.CasinoTickets || 0, fields: giveFields(user, give), stat: { scratchWins: prize ? 1 : 0 } });
  return ok({ scratch: { ...info(), ticket: null, claimed: { win: !!prize, label: prize ? prize.label : s.free ? '5 jetons de consolation' : 'Perdu… retente ta chance !' } }, ...wallet(store, user) });
}

// ------------------------------------------------------------------ caisse et lots
function wallet(store, user) {
  const daily = dailyOf(user);
  const vip = vipOf(user);
  const lv = machineLevel(user).level;
  return { games: Object.entries(GAME_LEVEL).map(([key, level]) => ({ key, level, open: lv >= level })), machineLevel: lv, wallet: { chips: chips(user), tickets: tickets(user), stardust: Number(user.StardustCount) || 0, chipPrice: chipPrice(store), cashoutRate: setting(store, 'CasinoCashoutRate'), vip, dailyChips: daily.vipChips ? 0 : vip.level * setting(store, 'CasinoDailyChipsPerLevel'), maxBet: maxBet(store) } };
}
function cashier(store, user, body) {
  const action = body.action || 'status';
  if (action === 'status') return ok({ ...wallet(store, user), stats: statsOf(user) });
  if (action === 'buy') {
    const n = Math.floor(Number(body.count) || 0);
    if (n < 1 || n > 100000) return fail('invalid_count');
    const cost = n * chipPrice(store);
    if ((Number(user.StardustCount) || 0) < cost) return fail('not_enough_dust');
    user = save(store, user, { chipsDelta: n, fields: { StardustCount: (Number(user.StardustCount) || 0) - cost } });
    return ok({ ...wallet(store, user), bought: n, paid: cost });
  }
  if (action === 'cashout') {
    const n = Math.floor(Number(body.count) || 0);
    if (n < 1 || n > chips(user)) return fail('invalid_count');
    const dust = Math.floor(n * chipPrice(store) * setting(store, 'CasinoCashoutRate'));
    user = save(store, user, { chipsDelta: -n, fields: { StardustCount: (Number(user.StardustCount) || 0) + dust } });
    return ok({ ...wallet(store, user), cashedOut: n, dust });
  }
  if (action === 'daily') {
    const daily = dailyOf(user);
    if (daily.vipChips) return fail('already_claimed');
    const n = vipOf(user).level * setting(store, 'CasinoDailyChipsPerLevel');
    daily.vipChips = true;
    user = save(store, user, { chipsDelta: n, daily });
    return ok({ ...wallet(store, user), dailyGiven: n });
  }
  return fail('unknown_action');
}
function grantForbiddenCard(store, user) {
  const rarities = store.getAll('Rarities').filter((r) => ['epique', 'legendaire', 'mythique'].includes(r.Key));
  const weights = { epique: 70, legendaire: 25, mythique: 5 };
  const total = rarities.reduce((s, r) => s + (weights[r.Key] || 0), 0);
  let roll = Math.random() * total, rar = rarities[0];
  for (const r of rarities) { roll -= weights[r.Key] || 0; if (roll <= 0) { rar = r; break; } }
  const pool = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo && refId(c.Rarity) === (rar && rar.id));
  const card = pool.length ? pickOne(pool) : null;
  if (!card) return null;
  const serial = nextSerial(store, card.id);
  store.create('Pulls', { User: user.id, Card: card.id, SerialNumber: serial, Finish: 'normal', Quality: 'good', Edition: 'forbidden', ObtainedAt: now(), BatchId: `casino-${user.id}-${Date.now()}` });
  return { cardId: card.id, name: card.Name, rarity: rar.Name, serialNumber: serial };
}
// Lots reglables (CasinoLots, 2026-10-26) : nom, prix, retrait ; le contenu reste celui de LOTS.
function lotsOf(store) {
  const rows = setting(store, 'CasinoLots');
  return LOTS.map((l) => {
    const r = (Array.isArray(rows) ? rows : []).find((x) => x && x.key === l.key) || {};
    const price = Math.round(Number(r.price));
    return { ...l, label: String(r.label || l.label).slice(0, 60), price: Number.isFinite(price) && price >= 1 && price <= 100000 ? price : l.price, active: r.active !== false };
  }).filter((l) => l.active);
}
function lots(store, user, body) {
  const LOTS = lotsOf(store);
  const owned = new Set(store.tables.has('UserCosmetics') ? store.getAll('UserCosmetics').filter((r) => refId(r.User) === user.id).map((r) => r.Key) : []);
  const list = LOTS.map((l) => ({ key: l.key, label: l.label, icon: l.icon, price: l.price, owned: l.cosmetic ? owned.has(l.key) : false }));
  const action = body.action || 'status';
  if (action === 'status') return ok({ lots: list, ...wallet(store, user) });
  if (action !== 'buy') return fail('unknown_action');
  const lot = LOTS.find((l) => l.key === String(body.key));
  if (!lot) return fail('unknown_item');
  if (lot.cosmetic && owned.has(lot.key)) return fail('already_owned');
  if (tickets(user) < lot.price) return fail('not_enough_tickets');
  let card = null;
  if (lot.card) { card = grantForbiddenCard(store, user); if (!card) return fail('no_card'); }
  user = save(store, user, { ticketsDelta: -lot.price, fields: { ...giveFields(user, lot.give || {}), ...(lot.tablet ? addTabletsFields(user, lot.tablet, 1) : {}) } });
  if (lot.cosmetic) grantCosmetic(store, user.id, lot.key, { type: lot.cosmetic.type, label: lot.cosmetic.label });
  return ok({ lots: LOTS.map((l) => ({ key: l.key, label: l.label, icon: l.icon, price: l.price, owned: l.cosmetic ? (l.key === lot.key || owned.has(l.key)) : false })), bought: lot.key, card, ...wallet(store, user) });
}

// ------------------------------------------------------------------ route
const GAMES = { cashier, lots, blackjack, roulette, cans: cansGame, claw, plinko, cups, scratch };
function handle({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if (!((Number(user.ForbiddenUnlocked) || 0) > 0)) return fail('locked', 403);
  if (!setting(store, 'CasinoEnabled')) return fail('casino_closed');
  const key = String(body.game || 'cashier');
  const game = GAMES[key];
  if (!game) return fail('unknown_game');
  const need = GAME_LEVEL[key] || 1;
  if (machineLevel(user).level < need) return fail('game_locked', 403, { level: need, ...wallet(store, user) });
  const res = game(store, user, body);
  // Portefeuille toujours joint a une reponse reussie.
  if (res.status === 200 && res.json && !res.json.wallet) Object.assign(res.json, wallet(store, store.get('Users', user.id)));
  else if (res.status === 200 && res.json && !res.json.games) { const w = wallet(store, store.get('Users', user.id)); res.json.games = w.games; res.json.machineLevel = w.machineLevel; }
  return res;
}

export const routes = { 'POST casino': handle };
