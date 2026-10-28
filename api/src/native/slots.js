// Machine a sous de la Salle des Machines Interdites (2026-10-19, appelee par
// forbidden.js une fois la porte ouverte). Fenetre de 3 lignes par rouleau,
// la ligne du milieu paie.
//  - Mise x1 / x3 / x5 : prix et gains multiplies ; le jackpot complet n'est
//    verse qu'a la mise maximale (part mise/5 sinon), la surchauffe monte de
//    la mise a chaque tour.
//  - Combinaisons sur la ligne : paire, triple, carre (4e rouleau, niveau 10,
//    = triple x2). Cascade apres un triple : la ligne retombe jusqu'a 3 fois,
//    chaque nouvelle combinaison paie x2, x3, x4.
//  - Tours bonus : 3 symboles jackpot visibles n'importe ou dans la fenetre
//    = 5 tours gratuits a gains doubles (Users.ForbiddenBonus).
//  - Niveau de la machine (Users.ForbiddenXP, 1 XP par mise) : 👻 au niveau
//    3, 🗝️ au niveau 6, 4e rouleau au niveau 10, un tour gratuit a chaque
//    niveau.
//  - Defis du jour (3) : des tours gratuits mis en reserve
//    (Users.ForbiddenFreeSpins), en plus du tour gratuit quotidien.
//  - Carnet des combinaisons (Users.ForbiddenCombos) : un triple de chacun des
//    7 symboles de base = cadre « Joueur interdit » (frame-forbidden).
//  - Jetons 🃏 (2026-10-28, equilibrage) : la paire paie 30 poussieres (indice),
//    le triple 2 jetons booster ; au plus ForbiddenBoosterDailyCap jetons par
//    jour (Users.ForbiddenDaily.boosters), le surplus est paye en poussieres.
//  - Quitte ou double : les jetons du dernier tour remis en jeu
//    (Users.ForbiddenRisk) ; le tour suivant gagnant les double, sinon perdus.
//  - Jackpot commun vivant (annonce dans le fil a chaque palier), tableau des
//    chanceux de la semaine, heure de folie hebdomadaire (gains x2).
//  - Surchauffe : ForbiddenHeatMax sans triple -> triple garanti. Relance du
//    rouleau intrus sur une paire (ForbiddenNudgeCost).
// Toutes les cartes gagnees sont en edition « Interdite ».
// 2026-10-26 : le niveau de la machine ouvre aussi les jeux du casino
// (casino.js, GAME_LEVEL) et un tour peut se payer en jetons du casino
// (body.currency = 'chips' : prix en poussieres / prix d'un jeton, arrondi au-dessus).

import { ok, fail, now, refId, parisDay, parisHour, firstAttachment, parseJson, nextSerial, hash } from './common.js';
import { setting } from './settings.js';
import { priceMultiplier } from './inflation.js';
import { addFeed } from './feed.js';
import { grantCosmetic } from './cosmetics.js';
import { weekKey } from './levels.js';
import { chipPrice } from './casino.js';

export const schema = {
  Users: {
    ForbiddenSpin: { type: 'Text' }, ForbiddenHeat: { type: 'Numeric' }, ForbiddenFreeDay: { type: 'Text' }, ForbiddenStats: { type: 'Text' },
    ForbiddenXP: { type: 'Numeric' }, ForbiddenBonus: { type: 'Numeric' }, ForbiddenFreeSpins: { type: 'Numeric' }, ForbiddenDaily: { type: 'Text' },
    ForbiddenCombos: { type: 'Text' }, ForbiddenRisk: { type: 'Numeric' }
  }
};

export const SYMBOLS = [
  { key: 'commune', icon: '⚙️', label: 'Commune', weight: 30, rarity: 'commune', level: 1 },
  { key: 'rare', icon: '🔹', label: 'Rare', weight: 24, rarity: 'rare', level: 1 },
  { key: 'epique', icon: '🔮', label: 'Épique', weight: 16, rarity: 'epique', level: 1 },
  { key: 'legendaire', icon: '👑', label: 'Légendaire', weight: 7, rarity: 'legendaire', level: 1 },
  { key: 'finition', icon: '✨', label: 'Finition', weight: 10, level: 1 },
  { key: 'jeton', icon: '🃏', label: 'Jeton', weight: 8, level: 1 },
  { key: 'jackpot', icon: '🎰', label: 'Jackpot', weight: 4, level: 1 },
  { key: 'crane', icon: '💀', label: 'Crâne', weight: 9, level: 1 },
  { key: 'ghost', icon: '👻', label: 'Fantôme', weight: 6, level: 3 },
  { key: 'clef', icon: '🗝️', label: 'Clé', weight: 6, level: 6 },
  // Mythique (2026-10-19) : rare ; paire = 1 mythique, triple = 2 (dont une en finition speciale).
  { key: 'mythique', icon: '💠', label: 'Mythique', weight: 2, rarity: 'mythique', level: 1 }
];
const SYM = new Map(SYMBOLS.map((s) => [s.key, s]));
// Carnet : les 7 symboles de base (le jackpot, le fantome et la cle sont des bonus).
const BASE_COMBOS = ['commune', 'rare', 'epique', 'legendaire', 'finition', 'jeton', 'crane'];
const CARDS_BY_RARITY = { commune: [1, 3], rare: [1, 3], epique: [1, 2], legendaire: [1, 2], mythique: [1, 2] };
const LEVELS = [0, 30, 80, 150, 250, 400, 600, 850, 1150, 1500];
// Niveau de la machine a sous qui ouvre chaque jeu.
export const GAME_LEVEL = { cashier: 1, lots: 1, scratch: 1, blackjack: 2, cans: 3, plinko: 4, cups: 5, claw: 6, roulette: 7 };
export const GAME_LABELS = { cashier: 'la caisse', lots: 'le comptoir des lots', scratch: 'le ticket à gratter', blackjack: 'le Blackjack', cans: 'le Chamboule-tout', plinko: 'le Plinko', cups: 'le Bonneteau', claw: 'la machine à pinces', roulette: 'la Roulette' };
const BASE_PERKS = { 3: 'Nouveau symbole : 👻 Fantôme (cartes en finition ghost)', 6: 'Nouveau symbole : 🗝️ Clé (clés et pièces de gatchapon)', 10: 'Un 4e rouleau : les carrés paient double' };
// Jeux du casino ouverts a chaque niveau (casino.js).
const LEVEL_PERKS = Object.fromEntries(Array.from({ length: 10 }, (_, i) => i + 1).map((lv) => {
  const games = Object.entries(GAME_LEVEL).filter(([, l]) => l === lv && lv > 1).map(([k]) => GAME_LABELS[k]);
  const parts = [BASE_PERKS[lv], games.length ? `Au casino : ${games.join(', ')} ouvre${games.length > 1 ? 'nt' : ''}` : null].filter(Boolean);
  return [lv, parts.join(' · ')];
}).filter(([, t]) => t));
const CHALLENGES = [
  { key: 'pairs', label: 'Obtiens 3 paires', target: 3, reward: 2 },
  { key: 'triples', label: 'Fais un triple', target: 1, reward: 2 },
  { key: 'spins', label: 'Joue 20 tours', target: 20, reward: 3 }
];
const BETS = [1, 3, 5];
const JACKPOT_STEPS = [10000, 25000, 50000, 100000, 250000];
const MAX_CARDS_PER_PAYOUT = 30;
const JETON_PAIR_DUST = 30;
const JETON_TRIPLE_BOOSTERS = 2;

const pick = (list, weightOf) => {
  const total = list.reduce((s, x) => s + Math.max(0, weightOf(x)), 0);
  let r = Math.random() * total;
  for (const x of list) { r -= Math.max(0, weightOf(x)); if (r <= 0) return x; }
  return list[list.length - 1];
};
const pm = (store) => Math.max(1, priceMultiplier(store));
const cost = (store, key) => Math.max(1, Math.round(setting(store, key) * pm(store)));

function appGet(store, key) { const r = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === key) : null; return r ? parseJson(r.Value, null) : null; }
function appSet(store, key, value) {
  const r = store.getAll('AppSettings').find((x) => x.Key === key);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: key, Value: JSON.stringify(value) });
}
const jackpotOf = (store) => { const v = appGet(store, 'ForbiddenJackpot'); return v && Number(v.pool) > 0 ? v : { pool: cost(store, 'ForbiddenJackpotSeed'), winners: [], announced: [] }; };
function weekBoard(store) {
  const w = weekKey();
  const v = appGet(store, 'ForbiddenWeek');
  return v && v.week === w ? v : { week: w, top: [], rarest: null, frenzyAnnounced: false };
}

// ------------------------------------------------------------------ etat joueur
const statsOf = (user) => ({ spins: 0, cards: 0, jackpots: 0, best: null, ...(parseJson(user.ForbiddenStats, {}) || {}) });
export function levelOf(user) {
  const xp = Number(user.ForbiddenXP) || 0;
  let level = 1;
  LEVELS.forEach((t, i) => { if (xp >= t) level = i + 1; });
  return { level, xp, next: LEVELS[level] ?? null, prev: LEVELS[level - 1] || 0 };
}
const symbolsFor = (level) => SYMBOLS.filter((s) => s.level <= level);
const reelsFor = (level) => (level >= 10 ? 4 : 3);
function dailyOf(user) {
  const v = parseJson(user.ForbiddenDaily, null);
  return v && v.day === parisDay(0) ? v : { day: parisDay(0), pairs: 0, triples: 0, spins: 0, boosters: 0, claimed: [] };
}
const combosOf = (user) => parseJson(user.ForbiddenCombos, []) || [];

// Heure de folie : une heure par semaine (jour et heure tires par la semaine), gains x2.
function frenzyOf(at = Date.now()) {
  const w = weekKey(at);
  const day = hash('frenzy-day-' + w) % 7;            // 0 = lundi
  const hour = 18 + (hash('frenzy-hour-' + w) % 5);   // 18 h a 22 h
  const d = new Date(parisDay(0, at) + 'T12:00:00Z');
  const weekday = (d.getUTCDay() + 6) % 7;
  return { active: weekday === day && parisHour(at) === hour, day, hour };
}

// Une carte en edition Interdite (rarete demandee, ou ponderee ; finition imposee possible).
function grantCard(store, user, batchId, { rarityKey = null, special = false, finishKey = null } = {}) {
  const rarities = store.getAll('Rarities').filter((r) => (Number(r.Weight) || 0) > 0).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  const cards = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo && !c.IsSecret && !c.IsVault);
  const withCards = rarities.filter((r) => cards.some((c) => refId(c.Rarity) === r.id));
  if (!withCards.length) return null;
  let rarity = rarityKey ? withCards.find((r) => String(r.Key || '').toLowerCase() === rarityKey) : null;
  if (!rarity && rarityKey) {
    const idx = ['commune', 'rare', 'epique', 'legendaire', 'mythique'].indexOf(rarityKey);
    rarity = withCards[Math.min(withCards.length - 1, Math.max(0, idx))];
  }
  if (!rarity) rarity = pick(withCards, (r) => Number(r.Weight) || 0);
  const pool = cards.filter((c) => refId(c.Rarity) === rarity.id);
  const card = pool[Math.floor(Math.random() * pool.length)];
  const finishes = store.tables.has('Finishes') ? store.getAll('Finishes').filter((f) => f.Key !== 'normal' && (f.DropWeight || 0) > 0) : [];
  let finish = 'normal';
  if (finishKey && (!store.tables.has('Finishes') || store.getAll('Finishes').some((f) => f.Key === finishKey))) finish = finishKey;
  else if (finishes.length && (special || finishKey || Math.random() < 0.12)) finish = pick(finishes, (f) => f.DropWeight).Key;
  const qualities = store.tables.has('Qualities') ? store.getAll('Qualities').filter((q) => (q.DropWeight || 0) > 0) : [];
  const quality = qualities.length ? pick(qualities, (q) => q.DropWeight).Key : 'good';
  const serialNumber = nextSerial(store, card.id);
  const t = now();
  store.create('Pulls', { User: user.id, Card: card.id, ObtainedAt: t, BatchId: batchId, SerialNumber: serialNumber, Finish: finish, Quality: quality, Edition: 'forbidden' });
  const isFirstEver = !refId(card.FirstObtainedBy);
  if (isFirstEver) store.update('Cards', card.id, { FirstObtainedBy: user.id, FirstObtainedAt: t });
  return {
    cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image), serialNumber, finish, quality, edition: 'forbidden', isFirstEver,
    rarity: { id: rarity.id, key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex, sortOrder: rarity.SortOrder || 0 }
  };
}

// Meilleure combinaison d'une ligne.
function combo(line) {
  const counts = {};
  line.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  const [key, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { key, n };
}
const tierOf = (n) => (n >= 4 ? 'quad' : n === 3 ? 'triple' : n === 2 ? 'pair' : 'none');

// Gains d'une ligne. mult : mise x bonus x folie x cascade. Ecrit les cartes
// et le jackpot ; renvoie les ressources a crediter.
// jar : jetons booster encore permis aujourd'hui ({ left }), partage par les lignes d'un appel.
function payout(store, user, line, batchId, { mult = 1, bet = 1, onlyTriple = false, jar = { left: Infinity } } = {}) {
  const { key, n } = combo(line);
  const tier = tierOf(n);
  const out = { tier, key, cards: [], dust: 0, boosters: 0, keys: 0, coins: 0, skulls: 0, jackpot: 0, label: '' };
  if (n < 2 || (onlyTriple && n < 3)) {
    out.tier = 'none';
    if (!onlyTriple && line.includes('jackpot')) { out.dust = Math.round(15 * pm(store) * mult); out.label = 'Une étincelle de jackpot'; }
    return out;
  }
  const big = n >= 3;
  const k = (n >= 4 ? 2 : 1) * mult;  // carre = triple x2
  const cards = (count, opts) => { for (let i = 0; i < Math.min(MAX_CARDS_PER_PAYOUT, count); i++) { const c = grantCard(store, user, batchId, opts); if (c) out.cards.push(c); } };
  const word = n >= 4 ? 'Carré' : big ? 'Triple' : 'Paire';
  const s = SYM.get(key);
  if (CARDS_BY_RARITY[key]) {
    cards((big ? CARDS_BY_RARITY[key][1] : CARDS_BY_RARITY[key][0]) * k, { rarityKey: s.rarity, special: big && (key === 'legendaire' || key === 'mythique') });
    out.label = `${word} ${s.label.toLowerCase()}`;
  } else if (key === 'finition') {
    cards((big ? 2 : 1) * k, { special: true });
    out.label = `${word} finition`;
  } else if (key === 'ghost') {
    cards((big ? 2 : 1) * k, { finishKey: 'ghost' });
    out.label = `${word} fantôme`;
  } else if (key === 'jeton') {
    if (big) {
      const want = JETON_TRIPLE_BOOSTERS * k;
      const give = Math.max(0, Math.min(want, jar.left));
      jar.left -= give;
      out.boosters = give;
      // Plafond du jour : chaque jeton en trop vaut une paire de jetons.
      if (want > give) { out.dust = Math.round(JETON_PAIR_DUST * pm(store) * (want - give)); out.capped = true; }
    } else out.dust = Math.round(JETON_PAIR_DUST * pm(store) * k);
    out.label = `${word} de jetons${out.capped ? ' (plafond du jour : en poussières)' : ''}`;
  } else if (key === 'clef') {
    out.keys = (big ? 3 : 1) * k;
    out.coins = big ? k : 0;
    out.label = `${word} de clés`;
  } else if (key === 'jackpot') {
    if (big) {
      // Jackpot complet a la mise maximale, sinon une part.
      const jp = jackpotOf(store);
      const share = Math.min(1, bet / BETS[BETS.length - 1]);
      const won = Math.round(jp.pool * share);
      out.jackpot = won;
      out.dust += won;
      cards(1, { rarityKey: 'legendaire', special: true });
      const left = Math.max(cost(store, 'ForbiddenJackpotSeed'), jp.pool - won);
      appSet(store, 'ForbiddenJackpot', { pool: share >= 1 ? cost(store, 'ForbiddenJackpotSeed') : left, winners: [{ pseudo: user.Pseudo || '?', amount: won, at: now() }, ...(jp.winners || [])].slice(0, 10), announced: [] });
      addFeed(store, { userId: user.id, kind: 'forbidden', icon: '🎰', text: `a fait sauter le jackpot d’une machine interdite : ${won} poussières !` });
      out.label = share >= 1 ? 'JACKPOT !' : `JACKPOT ! (part de mise ×${bet})`;
    } else {
      out.dust = Math.round(120 * pm(store) * mult);
      out.label = 'Paire de jackpot';
    }
  } else if (key === 'crane') {
    if (big) { out.skulls = n >= 4 ? 2 : 1; out.label = n >= 4 ? 'Quatre crânes… deux vrais !' : 'Trois crânes… un vrai !'; } else out.label = 'Deux crânes';
  }
  return out;
}

// Tirage d'une fenetre : rouleaux x 3 lignes (haut, ligne, bas).
function rollWindow(level, reels, forcedKey = null) {
  const syms = symbolsFor(level);
  const roll = () => pick(syms, (s) => s.weight).key;
  return Array.from({ length: reels }, (_, i) => [roll(), forcedKey && i < 3 ? forcedKey : roll(), roll()]);
}

// Vue de la machine (status).
export function machineView(store, user) {
  const lv = levelOf(user);
  const heatMax = setting(store, 'ForbiddenHeatMax');
  const jp = jackpotOf(store);
  const last = parseJson(user.ForbiddenSpin, null);
  const daily = dailyOf(user);
  const combos = combosOf(user);
  const board = weekBoard(store);
  const fr = frenzyOf();
  const symbols = symbolsFor(lv.level);
  return {
    symbols: symbols.map(({ key, icon, label }) => ({ key, icon, label })),
    reels: reelsFor(lv.level),
    bets: BETS,
    spinCost: cost(store, 'ForbiddenSpinCost'), nudgeCost: cost(store, 'ForbiddenNudgeCost'),
    boosterCap: setting(store, 'ForbiddenBoosterDailyCap'), boostersToday: daily.boosters || 0,
    spinCostChips: Math.ceil(cost(store, 'ForbiddenSpinCost') / chipPrice(store)), chips: Number(user.CasinoChips) || 0,
    freeSpin: user.ForbiddenFreeDay !== parisDay(0),
    freeSpins: Number(user.ForbiddenFreeSpins) || 0,
    bonusSpins: Number(user.ForbiddenBonus) || 0,
    heat: Math.min(heatMax, Number(user.ForbiddenHeat) || 0), heatMax,
    jackpot: jp.pool, lastJackpots: (jp.winners || []).slice(0, 5),
    canNudge: !!(last && last.nudgeable && !last.nudged),
    canRisk: !!(last && last.boosters > 0 && !last.risked) && (Number(user.BoosterCount) || 0) >= (last ? last.boosters : 0),
    lastBoosters: last ? last.boosters || 0 : 0,
    risk: Number(user.ForbiddenRisk) || 0,
    level: { ...lv, perks: LEVEL_PERKS, max: LEVELS.length },
    daily: CHALLENGES.map((c) => ({ key: c.key, label: c.label, target: c.target, progress: Math.min(c.target, daily[c.key] || 0), reward: c.reward, done: daily.claimed.includes(c.key) })),
    combos: SYMBOLS.map((x) => ({ key: x.key, icon: x.icon, label: x.label, done: combos.includes(x.key), base: BASE_COMBOS.includes(x.key), locked: x.level > lv.level })),
    combosReward: { label: 'Cadre « Joueur interdit »', done: BASE_COMBOS.every((k) => combos.includes(k)) },
    week: { top: board.top.slice(0, 5), rarest: board.rarest },
    frenzy: fr.active,
    stats: statsOf(user), stardust: Number(user.StardustCount) || 0
  };
}

// Applique une combinaison au carnet / defis / tableau ; renvoie les notices.
function track(store, user, acc, p, notices) {
  if (p.tier === 'pair') acc.daily.pairs++;
  if (p.tier === 'triple' || p.tier === 'quad') {
    acc.daily.triples++;
    if (!acc.combos.includes(p.key)) {
      acc.combos.push(p.key);
      notices.push({ icon: SYM.get(p.key).icon, text: `Nouvelle combinaison au carnet : triple ${SYM.get(p.key).label.toLowerCase()}` });
      if (BASE_COMBOS.every((k) => acc.combos.includes(k)) && grantCosmetic(store, user.id, 'frame-forbidden', { type: 'frame', label: 'Joueur interdit' })) {
        notices.push({ icon: '🖼️', text: 'Carnet complet : cadre « Joueur interdit » débloqué !' });
      }
    }
  }
}

export function spin(store, user, body) {
  const count = Number(body.count) === 10 ? 10 : 1;
  const lv = levelOf(user);
  const reels = reelsFor(lv.level);
  const today = parisDay(0);
  let bet = BETS.includes(Number(body.bet)) ? Number(body.bet) : 1;
  // Ordre des tours gratuits : bonus (x2), quotidien, reserve ; sinon paye.
  let bonusLeft = Number(user.ForbiddenBonus) || 0;
  let bank = Number(user.ForbiddenFreeSpins) || 0;
  let dailyFree = user.ForbiddenFreeDay !== today;
  const price = cost(store, 'ForbiddenSpinCost');
  let kind = 'paid';
  if (count === 1) {
    if (bonusLeft > 0) kind = 'bonus';
    else if (dailyFree) kind = 'daily';
    else if (bank > 0) kind = 'bank';
  }
  if (kind !== 'paid') bet = 1;
  const total = kind === 'paid' ? price * bet * count : 0;
  // Mise en jetons du casino a la place des poussieres.
  const useChips = kind === 'paid' && body.currency === 'chips';
  const chipCost = useChips ? Math.ceil(total / chipPrice(store)) : 0;
  if (useChips && (Number(user.CasinoChips) || 0) < chipCost) return fail('not_enough_chips', 400, { machine: machineView(store, user) });
  if (!useChips && (Number(user.StardustCount) || 0) < total) return fail('not_enough_dust', 400, { machine: machineView(store, user) });
  if (kind === 'bonus') bonusLeft--; else if (kind === 'daily') dailyFree = false; else if (kind === 'bank') bank--;

  const heatMax = setting(store, 'ForbiddenHeatMax');
  const share = setting(store, 'ForbiddenJackpotShare');
  const fr = frenzyOf();
  const stats = statsOf(user);
  const acc = { daily: dailyOf(user), combos: combosOf(user) };
  const notices = [];
  const jar = { left: Math.max(0, setting(store, 'ForbiddenBoosterDailyCap') - (acc.daily.boosters || 0)) };
  const jarStart = jar.left;
  let heat = Number(user.ForbiddenHeat) || 0;
  let dust = useChips ? 0 : -total, boosters = 0, keys = 0, coins = 0, skulls = 0, xp = 0;
  let risk = Number(user.ForbiddenRisk) || 0;
  let riskResult = null;
  const results = [];
  const board = weekBoard(store);
  let boardChanged = false;
  if (fr.active && !board.frenzyAnnounced) {
    board.frenzyAnnounced = true; boardChanged = true;
    addFeed(store, { userId: null, kind: 'forbidden', icon: '🌀', text: 'Les machines interdites s’emballent : gains doublés pendant une heure !' });
  }
  for (let i = 0; i < count; i++) {
    // Jackpot commun : une part de chaque tour paye ; paliers annonces.
    if (kind === 'paid') {
      const jp = jackpotOf(store);
      const before = jp.pool;
      const after = before + Math.round(price * bet * share);
      const announced = jp.announced || [];
      const step = JACKPOT_STEPS.find((t) => before < t && after >= t && !announced.includes(t));
      if (step) addFeed(store, { userId: null, kind: 'forbidden', icon: '🎰', text: `Le jackpot des machines interdites dépasse ${step.toLocaleString('fr-FR')} poussières…` });
      appSet(store, 'ForbiddenJackpot', { ...jp, pool: after, announced: step ? [...announced, step] : announced });
    }
    const forced = heatMax > 0 && heat >= heatMax;
    const forcedKey = forced ? pick(symbolsFor(lv.level).filter((s) => s.key !== 'jackpot' && s.key !== 'crane'), (s) => s.weight).key : null;
    const window = rollWindow(lv.level, reels, forcedKey);
    const line = window.map((col) => col[1]);
    const mult = bet * (kind === 'bonus' ? 2 : 1) * (fr.active ? 2 : 1);
    const batchId = `forbidden-${user.id}-${Date.now()}-${i}`;
    const p = payout(store, user, line, batchId, { mult, bet, jar });
    track(store, user, acc, p, notices);
    // Cascade : la ligne retombe tant qu'elle gagne (x2, x3, x4).
    const cascades = [];
    if (p.tier === 'triple' || p.tier === 'quad') {
      for (let c = 0; c < 3; c++) {
        const cl = rollWindow(lv.level, reels).map((col) => col[1]);
        const cp = payout(store, user, cl, `${batchId}-c${c}`, { mult: mult * (c + 2), bet, jar });
        if (cp.tier === 'none') break;
        track(store, user, acc, cp, notices);
        cascades.push({ line: cl, mult: c + 2, ...cp });
      }
    }
    // Tours bonus : 3 jackpots visibles n'importe ou.
    const jackpotsSeen = window.flat().filter((k) => k === 'jackpot').length;
    const bonusAwarded = jackpotsSeen >= 3 ? 5 : 0;
    if (bonusAwarded) { bonusLeft += bonusAwarded; notices.push({ icon: '🎰', text: `${jackpotsSeen} jackpots visibles : ${bonusAwarded} tours bonus à gains doublés !` }); }
    const all = [p, ...cascades];
    const won = all.reduce((a, x) => ({ dust: a.dust + x.dust, boosters: a.boosters + x.boosters, keys: a.keys + x.keys, coins: a.coins + x.coins, skulls: a.skulls + x.skulls, cards: a.cards + x.cards.length }), { dust: 0, boosters: 0, keys: 0, coins: 0, skulls: 0, cards: 0 });
    dust += won.dust; boosters += won.boosters; keys += won.keys; coins += won.coins; skulls += won.skulls;
    heat = p.tier === 'triple' || p.tier === 'quad' ? 0 : Math.min(heatMax || 999, heat + bet);
    xp += bet;
    acc.daily.spins++;
    stats.spins++; stats.cards += won.cards; if (all.some((x) => x.jackpot)) stats.jackpots++;
    // Quitte ou double : resolu par le premier tour.
    if (risk > 0 && !riskResult) {
      const win = p.tier !== 'none';
      riskResult = { won: win, amount: win ? risk * 2 : 0, staked: risk };
      if (win) boosters += risk * 2;
      risk = 0;
    }
    // Tableau des chanceux.
    const score = won.dust + won.cards * 60 + won.boosters * 300;
    if (score > 0 && p.tier !== 'none') {
      board.top = [...board.top, { pseudo: user.Pseudo || '?', label: p.label, score, cards: won.cards, dust: won.dust, at: now() }].sort((a, b) => b.score - a.score).slice(0, 5);
      boardChanged = true;
    }
    const best = all.flatMap((x) => x.cards).sort((a, b) => (b.rarity.sortOrder - a.rarity.sortOrder) || ((b.finish !== 'normal') - (a.finish !== 'normal')))[0];
    if (best && (!board.rarest || best.rarity.sortOrder > board.rarest.sortOrder || (best.rarity.sortOrder === board.rarest.sortOrder && best.finish !== 'normal' && board.rarest.finish === 'normal'))) {
      board.rarest = { pseudo: user.Pseudo || '?', card: best.name, rarity: best.rarity.name, colorHex: best.rarity.colorHex, sortOrder: best.rarity.sortOrder, finish: best.finish };
      boardChanged = true;
    }
    results.push({ window, line, forced, kind, bet, mult, ...p, cascades, bonusAwarded, nudgeable: count === 1 && p.tier === 'pair' && p.key !== 'crane' });
  }
  if (boardChanged) appSet(store, 'ForbiddenWeek', board);
  acc.daily.boosters = (acc.daily.boosters || 0) + (jarStart - jar.left);
  // Defis du jour : tours gratuits automatiquement mis en reserve.
  for (const c of CHALLENGES) {
    if (!acc.daily.claimed.includes(c.key) && (acc.daily[c.key] || 0) >= c.target) {
      acc.daily.claimed.push(c.key);
      bank += c.reward;
      notices.push({ icon: '🎯', text: `Défi réussi : ${c.label} (+${c.reward} tours gratuits)` });
    }
  }
  // Niveau de la machine : un tour gratuit par niveau gagne.
  const newLv = levelOf({ ForbiddenXP: (Number(user.ForbiddenXP) || 0) + xp });
  if (newLv.level > lv.level) {
    bank += newLv.level - lv.level;
    notices.push({ icon: '⬆️', text: `Machine niveau ${newLv.level} !${LEVEL_PERKS[newLv.level] ? ' ' + LEVEL_PERKS[newLv.level] : ''} (+1 tour gratuit)` });
  }
  const fresh = store.get('Users', user.id);
  const fields = {
    StardustCount: (Number(fresh.StardustCount) || 0) + dust,
    BoosterCount: (Number(fresh.BoosterCount) || 0) + boosters,
    ForbiddenHeat: heat, ForbiddenStats: JSON.stringify(stats), ForbiddenXP: (Number(user.ForbiddenXP) || 0) + xp,
    ForbiddenBonus: bonusLeft, ForbiddenFreeSpins: bank, ForbiddenDaily: JSON.stringify(acc.daily), ForbiddenCombos: JSON.stringify(acc.combos), ForbiddenRisk: risk,
    ForbiddenSpin: JSON.stringify(count === 1 ? { line: results[0].line, nudgeable: results[0].nudgeable, nudged: false, bet: results[0].bet, mult: results[0].mult, boosters: results[0].boosters + results[0].cascades.reduce((s, x) => s + x.boosters, 0), risked: false, at: now() } : null)
  };
  if (chipCost) fields.CasinoChips = Math.max(0, (Number(fresh.CasinoChips) || 0) - chipCost);
  if (keys) fields.KeyCount = (Number(fresh.KeyCount) || 0) + keys;
  if (coins) fields.ChestCount = (Number(fresh.ChestCount) || 0) + coins;
  if (skulls) fields.DinoSkulls = (Number(fresh.DinoSkulls) || 0) + skulls;
  if (!dailyFree && user.ForbiddenFreeDay !== today) fields.ForbiddenFreeDay = today;
  const updated = store.update('Users', user.id, fields);
  return ok({ machine: machineView(store, updated), results, notices, riskResult, paid: useChips ? 0 : total, paidChips: chipCost, kind, newStardust: updated.StardustCount, newBoosterCount: updated.BoosterCount });
}

export function nudge(store, user) {
  const last = parseJson(user.ForbiddenSpin, null);
  if (!last || !last.nudgeable || last.nudged) return fail('cannot_nudge', 400, { machine: machineView(store, user) });
  const price = cost(store, 'ForbiddenNudgeCost');
  if ((Number(user.StardustCount) || 0) < price) return fail('not_enough_dust', 400, { machine: machineView(store, user) });
  const lv = levelOf(user);
  const syms = symbolsFor(lv.level);
  const { key } = combo(last.line);
  const line = last.line.map((k) => (k === key ? k : pick(syms, (s) => s.weight).key));
  const changed = last.line.map((k, i) => (k !== key ? i : -1)).filter((i) => i >= 0);
  const acc = { daily: dailyOf(user), combos: combosOf(user) };
  const jar = { left: Math.max(0, setting(store, 'ForbiddenBoosterDailyCap') - (acc.daily.boosters || 0)) };
  const p = payout(store, user, line, `forbidden-${user.id}-${Date.now()}-n`, { mult: last.mult || 1, bet: last.bet || 1, onlyTriple: true, jar });
  acc.daily.boosters = (acc.daily.boosters || 0) + p.boosters;
  const notices = [];
  track(store, user, acc, p, notices);
  const stats = statsOf(user);
  stats.cards += p.cards.length; if (p.jackpot) stats.jackpots++;
  const fresh = store.get('Users', user.id);
  const fields = {
    StardustCount: (Number(fresh.StardustCount) || 0) - price + p.dust,
    BoosterCount: (Number(fresh.BoosterCount) || 0) + p.boosters,
    ForbiddenStats: JSON.stringify(stats), ForbiddenCombos: JSON.stringify(acc.combos), ForbiddenDaily: JSON.stringify(acc.daily),
    ForbiddenSpin: JSON.stringify({ ...last, line, nudged: true, boosters: (last.boosters || 0) + p.boosters }),
    ...(p.tier === 'triple' || p.tier === 'quad' ? { ForbiddenHeat: 0 } : {})
  };
  if (p.keys) fields.KeyCount = (Number(fresh.KeyCount) || 0) + p.keys;
  if (p.coins) fields.ChestCount = (Number(fresh.ChestCount) || 0) + p.coins;
  if (p.skulls) fields.DinoSkulls = (Number(fresh.DinoSkulls) || 0) + p.skulls;
  const updated = store.update('Users', user.id, fields);
  return ok({ machine: machineView(store, updated), nudge: { changed, line, ...p }, notices, paid: price, newStardust: updated.StardustCount, newBoosterCount: updated.BoosterCount });
}

// Quitte ou double : les jetons gagnes au dernier tour sont remis en jeu.
export function risk(store, user) {
  const last = parseJson(user.ForbiddenSpin, null);
  const n = last ? Number(last.boosters) || 0 : 0;
  if (!n || last.risked) return fail('cannot_risk', 400, { machine: machineView(store, user) });
  if ((Number(user.BoosterCount) || 0) < n) return fail('not_enough_boosters', 400, { machine: machineView(store, user) });
  const updated = store.update('Users', user.id, {
    BoosterCount: (Number(user.BoosterCount) || 0) - n,
    ForbiddenRisk: (Number(user.ForbiddenRisk) || 0) + n,
    ForbiddenSpin: JSON.stringify({ ...last, risked: true })
  });
  return ok({ machine: machineView(store, updated), staked: n, newBoosterCount: updated.BoosterCount });
}

export const _frenzyOf = frenzyOf;
