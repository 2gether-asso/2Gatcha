// Rendez-vous quotidiens (2026-10-07) : de petites raisons de revenir chaque
// jour, sans casser l'economie.
//  - Boite du jour : un objet aleatoire gratuit par jour (DailyBoxLoot).
//      POST /webhook/daily-box { userId, action: 'status' | 'open' }
//  - De du jour : un lancer par jour, un petit bonus sur une activite.
//      POST /webhook/daily-dice { userId, action: 'status' | 'roll' }
//  - Action du jour : une activite designee rapporte x2 XP (index.js).
//  - Heures de chance : une heure tiree chaque jour (deux le week-end), avec
//    finitions et poussieres boostees ; prevenue 1 h avant (push.js).
//  - Coup de chance de la semaine : la 1re legendaire (ou mieux) de la
//    semaine rapporte un coffre et sa cle.
//  - Bonus de retour : apres ReturnerMinDays jours d'absence, un colis et le
//    resume de ce qui a change.
//      POST /webhook/welcome-back { userId, action: 'status' | 'claim' }
//  - Missions du soir : de 18 h a minuit, 3 missions rapides.
//      POST /webhook/evening { userId, action: 'status' | 'claim' }
//   GET /webhook/today ?userId= : tout ce qui precede en un appel (accueil).

import { refId, now, ok, fail, userById, parisDay, parisHour } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';
import { grantCosmetic } from './cosmetics.js';

export const schema = {
  Users: {
    BoxDay: { type: 'Text' }, DiceDay: { type: 'Text' }, DiceFace: { type: 'Numeric' }, LuckyHitWeek: { type: 'Text' },
    LastSeenAt: { type: 'Numeric' }, ReturnPending: { type: 'Text' },
    EveningDay: { type: 'Text' }, EveningProgress: { type: 'Text' }, EveningClaimed: { type: 'Text' }
  }
};

const parse = (v, def) => { try { const x = JSON.parse(v || ''); return x == null ? def : x; } catch (e) { return def; } };
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// --- action du jour ----------------------------------------------------------
export const HOUSE = [
  { key: 'open-pack', label: 'Ouvrir des boosters', icon: '🎴', url: 'ouverture.html' },
  { key: 'dig', label: 'Fouiller', icon: '⛏️', url: 'jeux.html#fouille' },
  { key: 'fishing', label: 'Pêcher', icon: '🎣', url: 'jeux.html#peche' },
  { key: 'expedition', label: 'Partir en expédition', icon: '🧭', url: 'jeux.html#expedition' },
  { key: 'garden', label: 'Jardiner', icon: '🌱', url: 'jeux.html#jardin' },
  { key: 'craft', label: 'Crafter des cartes', icon: '✨', url: 'collection.html#crafter' },
  { key: 'foil-upgrade', label: 'Fusionner des finitions', icon: '🌈', url: 'collection.html#finitions' },
  { key: 'card-quality-repair', label: 'Restaurer des cartes', icon: '🧰', url: 'collection.html#qualite' }
];
export const houseOf = (day = parisDay(0)) => HOUSE[hash('house:' + day) % HOUSE.length];
export const isHouseSource = (source) => !!source && houseOf().key === source;

// --- heures de chance -----------------------------------------------------------
function parisOffsetHours(day) { return parisHour(Date.parse(day + 'T12:00:00Z')) - 12; }
function parisEpoch(day, hour) { return Math.floor((Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`) - parisOffsetHours(day) * 3600e3) / 1000); }

export function luckyWindows(day = parisDay(0)) {
  const dow = new Date(day + 'T12:00:00Z').getUTCDay();
  const h = hash('lucky:' + day);
  const hours = dow === 0 || dow === 6 ? [11 + (h % 4), 18 + ((h >>> 8) % 4)] : [12 + (h % 10)];
  return hours.map((hour) => ({ start: parisEpoch(day, hour), end: parisEpoch(day, hour) + 3600, hour }));
}

export function luckyState(at = now()) {
  const today = luckyWindows(parisDay(0, at * 1000));
  const active = today.find((w) => w.start <= at && at < w.end) || null;
  const next = today.find((w) => w.start > at) || luckyWindows(parisDay(1, at * 1000))[0];
  return { active: !!active, window: active, next };
}

// --- de du jour -----------------------------------------------------------------
export const DICE = [
  null,
  { face: 1, icon: '🎣', label: 'Pêche : +3 vers de terre tout de suite' },
  { face: 2, icon: '⛏️', label: 'Fouille : +25 % de poussières aujourd’hui' },
  { face: 3, icon: '🌱', label: 'Jardin : tes plantations poussent 2× plus vite aujourd’hui' },
  { face: 4, icon: '♻️', label: 'Décraft : +25 % de poussières aujourd’hui' },
  { face: 5, icon: '🧭', label: 'Expédition : +25 % de poussières aujourd’hui' },
  { face: 6, icon: '🌈', label: 'Boosters : +5 points de chance de finition spéciale aujourd’hui' }
];
export const diceFace = (user) => (user && user.DiceDay === parisDay(0) ? Number(user.DiceFace) || 0 : 0);

function handleDice({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const face = diceFace(user);
  if ((body.action || 'status') === 'status') return ok({ rolled: !!face, face: face || null, effect: face ? DICE[face] : null, faces: DICE.slice(1) });
  if (body.action !== 'roll') return fail('unknown_action');
  if (face) return fail('already_claimed', 400, { face, effect: DICE[face] });
  const roll = 1 + Math.floor(Math.random() * 6);
  const fields = { DiceDay: parisDay(0), DiceFace: roll };
  if (roll === 1) fields.Worms = (Number(user.Worms) || 0) + 3;
  user = store.update('Users', user.id, fields);
  return ok({ rolled: true, face: roll, effect: DICE[roll], faces: DICE.slice(1), worms: Number(user.Worms) || 0 });
}

// --- boite du jour ------------------------------------------------------------
const BOX_LABEL = { dust: 'poussières', worms: 'vers de terre', bait: 'appât doré', key: 'clé', part: 'pièce détachée', booster: 'booster', chest: 'coffre', cosmetic: 'cosmétique' };
const BOX_ICON = { dust: '✨', worms: '🪱', bait: '🪝', key: '🔑', part: '🔩', booster: '🎴', chest: '🧰', cosmetic: '🎨' };
const BOX_FIELD = { dust: 'StardustCount', worms: 'Worms', bait: 'GoldBait', key: 'KeyCount', part: 'SpareParts', booster: 'BoosterCount', chest: 'ChestCount' };

function handleBox({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const today = parisDay(0);
  const opened = user.BoxDay === today;
  if ((body.action || 'status') === 'status') return ok({ available: !opened });
  if (body.action !== 'open') return fail('unknown_action');
  if (opened) return fail('already_claimed');
  const loot = setting(store, 'DailyBoxLoot').filter((x) => x && BOX_LABEL[x.type] && Number(x.weight) > 0);
  const total = loot.reduce((s, x) => s + Number(x.weight), 0);
  let r = Math.random() * total;
  let pick = loot[loot.length - 1];
  for (const x of loot) { r -= Number(x.weight); if (r <= 0) { pick = x; break; } }
  const min = Math.max(1, Number(pick.min) || 1), max = Math.max(min, Number(pick.max) || min);
  let amount = min + Math.floor(Math.random() * (max - min + 1));
  let item = { type: pick.type, amount, icon: BOX_ICON[pick.type], label: `${amount} ${BOX_LABEL[pick.type]}` };
  const fields = { BoxDay: today };
  if (pick.type === 'cosmetic') {
    const ownedKeys = new Set(store.tables.has('UserCosmetics') ? store.getAll('UserCosmetics').filter((c) => refId(c.User) === user.id).map((c) => c.Key) : []);
    const free = setting(store, 'CosmeticsCatalog').filter((c) => c && c.key && !ownedKeys.has(c.key) && (Number(c.price) || 0) <= 1500);
    if (free.length) {
      const c = free[Math.floor(Math.random() * free.length)];
      grantCosmetic(store, user.id, c.key, { type: c.type, label: c.label });
      item = { type: 'cosmetic', amount: 1, icon: BOX_ICON.cosmetic, label: `Cosmétique : ${c.label}`, key: c.key };
    } else {
      amount = 100;
      item = { type: 'dust', amount, icon: BOX_ICON.dust, label: `${amount} poussières (tu as déjà tous les cosmétiques)` };
      fields.StardustCount = (Number(user.StardustCount) || 0) + amount;
    }
  } else {
    fields[BOX_FIELD[pick.type]] = (Number(user[BOX_FIELD[pick.type]]) || 0) + amount;
  }
  user = store.update('Users', user.id, fields);
  return ok({ opened: true, item, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount });
}

// --- bonus de retour --------------------------------------------------------------
// Nouveautes annoncees aux joueurs de retour (les plus recentes d'abord).
export const CHANGELOG = [
  { date: '2026-10-07', text: 'Maîtrise des extensions, talents, constellations, cartes ★, rangs de compte' },
  { date: '2026-10-07', text: 'Boîte du jour, dé du jour, heures de chance, missions du soir, enchères, contrats de collection' },
  { date: '2026-10-05', text: 'Défis de la semaine, objectif commun, boutique de cosmétiques, jardin, grande fouille commune' },
  { date: '2026-10-05', text: 'Pêche aux vers de terre, niveaux de pêche et de fouille, cartes Unique au Comptoir' },
  { date: '2026-10-04', text: 'Saisons mensuelles, coffres, notifications push, collection et atelier réunis' }
];

// Appele a chaque requete d'un joueur : retient la derniere visite.
export function touch(store, userId) {
  const user = store.get('Users', userId);
  if (!user) return;
  const t = now();
  const last = Number(user.LastSeenAt) || 0;
  if (last && t - last < 600) return;
  const fields = { LastSeenAt: t };
  if (last && t - last >= setting(store, 'ReturnerMinDays') * 86400 && !user.ReturnPending) {
    fields.ReturnPending = JSON.stringify({ since: last, days: Math.floor((t - last) / 86400) });
  }
  store.update('Users', userId, fields);
}

function welcomeState(store, user) {
  const pending = parse(user.ReturnPending, null);
  if (!pending) return { pending: false };
  const days = Number(pending.days) || 0;
  const since = Number(pending.since) || 0;
  const sinceDay = parisDay(0, since * 1000);
  const gift = { boosters: Math.min(6, 1 + Math.floor(days / 7)), dust: Math.min(600, 25 * days) };
  const news = CHANGELOG.filter((c) => c.date >= sinceDay).map((c) => c.text);
  const newCards = store.getAll('Cards').filter((c) => c.Active && Number(c.CreatedAt) > since).length;
  return { pending: true, days, since, gift, news, newCards };
}

function handleWelcome({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const st = welcomeState(store, user);
  if ((body.action || 'status') === 'status') return ok(st);
  if (body.action !== 'claim') return fail('unknown_action');
  if (!st.pending) return fail('nothing_to_claim');
  user = store.update('Users', user.id, {
    ReturnPending: '', StardustCount: (Number(user.StardustCount) || 0) + st.gift.dust, BoosterCount: (Number(user.BoosterCount) || 0) + st.gift.boosters
  });
  return ok({ claimed: true, gift: st.gift, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount });
}

// --- missions du soir ----------------------------------------------------------
export const EVENING = [
  { key: 'boosters2', type: 'boosterOpened', target: 2, label: 'Ouvrir 2 boosters', icon: '🎴', url: 'ouverture.html' },
  { key: 'dig10', type: 'dig', target: 10, label: 'Creuser 10 cases', icon: '⛏️', url: 'jeux.html#fouille' },
  { key: 'fish5', type: 'fish', target: 5, label: 'Lancer 5 fois ta ligne', icon: '🎣', url: 'jeux.html#peche' },
  { key: 'decraft3', type: 'disenchant', target: 3, label: 'Décrafter 3 cartes', icon: '♻️', url: 'collection.html#decrafter' },
  { key: 'harvest1', type: 'harvest', target: 1, label: 'Récolter au jardin', icon: '🌱', url: 'jeux.html#jardin' },
  { key: 'trade1', type: 'tradeProposed', target: 1, label: 'Proposer un échange', icon: '🔄', url: 'trade.html' },
  { key: 'boss3', type: 'bossAttack', target: 3, label: 'Envoyer 3 cartes au boss', icon: '🗡️', url: 'communaute.html#boss' },
  { key: 'craft1', type: 'craft', target: 1, label: 'Crafter une carte', icon: '✨', url: 'collection.html#crafter' },
  { key: 'treasure1', type: 'treasure', target: 1, label: 'Dégager un trésor de fouille', icon: '💎', url: 'jeux.html#fouille' },
  { key: 'cdig2', type: 'communityDig', target: 2, label: '2 coups de pioche à la grande fouille', icon: '🗺️', url: 'communaute.html#ensemble' }
];
export const EVENING_START = 18;

export function eveningMissions(day = parisDay(0)) {
  const list = [...EVENING];
  const out = [];
  let h = hash('evening:' + day);
  while (out.length < 3 && list.length) { out.push(list.splice(h % list.length, 1)[0]); h = hash(String(h)); }
  return out;
}

function eveningState(store, user, hour = parisHour()) {
  const today = parisDay(0);
  const progress = user.EveningDay === today ? parse(user.EveningProgress, {}) : {};
  const claimedList = user.EveningDay === today ? parse(user.EveningClaimed, []) : [];
  const missions = eveningMissions(today).map((m) => {
    const p = Math.min(m.target, Number(progress[m.key]) || 0);
    return { ...m, progress: p, done: p >= m.target, claimed: claimedList.includes(m.key) };
  });
  const allDone = missions.every((m) => m.done);
  return {
    open: hour >= EVENING_START, startsAt: EVENING_START, missions, dust: setting(store, 'EveningMissionDust'), bonusDust: setting(store, 'EveningBonusDust'),
    bonusClaimed: claimedList.includes('bonus'), allDone,
    claimable: missions.filter((m) => m.done && !m.claimed).length + (allDone && !claimedList.includes('bonus') ? 1 : 0)
  };
}

function handleEvening({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const st = eveningState(store, user);
  if ((body.action || 'status') === 'status') return ok(st);
  if (body.action !== 'claim') return fail('unknown_action');
  const today = parisDay(0);
  const claimedList = user.EveningDay === today ? parse(user.EveningClaimed, []) : [];
  let dust = 0;
  for (const m of st.missions) if (m.done && !m.claimed) { claimedList.push(m.key); dust += st.dust; }
  if (st.allDone && !st.bonusClaimed) { claimedList.push('bonus'); dust += st.bonusDust; }
  if (!dust) return fail('nothing_to_claim', 400, st);
  user = store.update('Users', user.id, { EveningDay: today, EveningProgress: user.EveningDay === today ? user.EveningProgress : '{}', EveningClaimed: JSON.stringify(claimedList), StardustCount: (Number(user.StardustCount) || 0) + dust });
  return ok({ ...eveningState(store, user), claimedDust: dust, newStardust: user.StardustCount });
}

// Abonne du bus d'activite : progression des missions du soir.
export function onEvents(store, events) {
  const hour = parisHour();
  if (hour < EVENING_START) return [];
  const today = parisDay(0);
  const missions = eveningMissions(today);
  const notices = [];
  for (const e of events) {
    const m = missions.find((x) => x.type === e.type);
    if (!m) continue;
    const user = store.get('Users', e.userId);
    if (!user) continue;
    const progress = user.EveningDay === today ? parse(user.EveningProgress, {}) : {};
    const before = Number(progress[m.key]) || 0;
    if (before >= m.target) continue;
    progress[m.key] = Math.min(m.target, before + (Number(e.n) || 1));
    const fields = { EveningDay: today, EveningProgress: JSON.stringify(progress) };
    if (user.EveningDay !== today) fields.EveningClaimed = '[]';
    store.update('Users', e.userId, fields);
    if (progress[m.key] >= m.target) notices.push({ userId: e.userId, kind: 'evening', icon: '🌙', label: `Mission du soir accomplie : ${m.label}` });
  }
  return notices;
}

// --- coup de chance de la semaine ---------------------------------------------
export function afterWorkflow({ store, path, request, response }) {
  const body = request.body || {};
  if (path !== 'open-pack' || body.dryRun || response.status !== 200 || !response.json || !Array.isArray(response.json.cards) || !response.json.batchId) return;
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  const week = weekKey();
  if (user.LuckyHitWeek === week) return;
  if (!response.json.cards.some((c) => c.rarity && ['legendaire', 'mythique'].includes(c.rarity.key))) return;
  store.update('Users', user.id, { LuckyHitWeek: week, ChestCount: (Number(user.ChestCount) || 0) + 1, KeyCount: (Number(user.KeyCount) || 0) + 1 });
  response.json.luckyHit = { chests: 1, keys: 1 };
  response.json.notices = [...(response.json.notices || []), { kind: 'lucky', icon: '🍀', label: 'Coup de chance de la semaine : ta 1re légendaire te rapporte un coffre et sa clé !' }];
}

// --- tout le quotidien en un appel (accueil) -------------------------------------
function handleToday({ store, query }) {
  const user = userById(store, query.userId);
  if (!user) return fail('unknown_user', 404);
  const face = diceFace(user);
  return ok({
    house: { ...houseOf(), multiplier: setting(store, 'HouseXpMultiplier') },
    lucky: { ...luckyState(), windows: luckyWindows(), finishBonus: setting(store, 'LuckyHourFinishBonus'), dustBonus: setting(store, 'LuckyHourDustBonus') },
    box: { available: user.BoxDay !== parisDay(0) },
    dice: { rolled: !!face, face: face || null, effect: face ? DICE[face] : null },
    luckyHit: { done: user.LuckyHitWeek === weekKey() },
    evening: eveningState(store, user),
    welcome: welcomeState(store, user)
  });
}

export const routes = {
  'POST daily-box': handleBox,
  'POST daily-dice': handleDice,
  'POST welcome-back': handleWelcome,
  'POST evening': handleEvening,
  'GET today': handleToday
};
