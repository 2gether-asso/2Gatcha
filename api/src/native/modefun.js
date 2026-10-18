// Fonctionnalites exclusives des difficultes (2026-10-16), activables une par
// une (moderules.js, Admin > Difficultes).
//  Cool   : boite a souhaits, atelier gratuit, seconde chance.
//  Chill  : happy hour (prix, market.js / shop.js), jardin partage.
//  Medium : bourse des cartes, quete en chaine.
//  Hard   : ironman, primes de chasse, cartes maudites, larcin.
//  Chaos  : cartes mutantes, boosters glitches, carte instable, chasse aux bugs.
// (Vacances et balade des dinos : dino.js ; draft : draft.js ; regle votee :
// chaosvote.js ; tempetes : moderules.js + features.js.)
//   POST /webhook/mode-extra { userId, action, ... }
//     status | wishbox {cardId} | free-repair {pullId} | second-chance {pullId}
//     garden-water | quest-claim | ironman-pledge | ironman-abandon
//     bounty-deliver {pullId, confirmEdition?} | purify {pullId} | steal {toPseudo}
//     unstable-claim | bug-found {id}

import { refId, now, ok, fail, userById, parisDay, parseJson, cardSummary, firstAttachment } from './common.js';
import { ruleOn, modeKeyOf } from './moderules.js';
import { lastPreset } from './presets.js';
import { weekKey } from './levels.js';
import { grantCosmetic } from './cosmetics.js';
import { addFeed } from './feed.js';
import { editionLoss } from './editions.js';
import { holidayTransition, setDinoHoliday } from './dino.js';

export const schema = {
  Users: {
    WishBox: { type: 'Text' }, FreeRepairDay: { type: 'Text' }, SecondChanceDay: { type: 'Text' }, LastBatch: { type: 'Text' },
    QuestChain: { type: 'Text' }, Ironman: { type: 'Text' }, TheftDay: { type: 'Text' }, TheftCount: { type: 'Numeric' },
    RobbedDay: { type: 'Text' }, RobbedCount: { type: 'Numeric' }, UnstableSession: { type: 'Numeric' }, Bugs: { type: 'Text' }, ModeInbox: { type: 'Text' }
  },
  Pulls: { CursedUntil: { type: 'Numeric' }, MutateAt: { type: 'Numeric' }, Unstable: { type: 'Bool' }, UnstableDay: { type: 'Text' } }
};

// ------------------------------------------------------------------ outils
const QUALITY = ['damaged', 'worn', 'good', 'mint'];
const FINISHES = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'];
const today = () => parisDay(0);
const n = (v) => Number(v) || 0;
const rnd = (list) => list[Math.floor(Math.random() * list.length)];
function hashOf(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; }
function appGet(store, key, def) { const r = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === key) : null; return r ? parseJson(r.Value, def) : def; }
function appSet(store, key, value) {
  const r = store.getAll('AppSettings').find((x) => x.Key === key);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: key, Value: JSON.stringify(value) });
}
function nextSerial(store, cardId) {
  const used = new Set(store.getAll('Pulls').filter((p) => refId(p.Card) === cardId).map((p) => p.SerialNumber));
  let s = 1; while (used.has(s)) s++;
  return s;
}
const rarityOf = (store, card) => (card ? store.get('Rarities', refId(card.Rarity)) : null);
const rarityByKey = (store, key) => store.getAll('Rarities').find((r) => r.Key === key);
const playable = (store) => store.getAll('Cards').filter((c) => c.Active !== false && !c.IsPromo);
const rarityView = (r) => (r ? { id: r.id, name: r.Name, key: r.Key, colorHex: r.ColorHex, sortOrder: r.SortOrder || 0 } : null);
// Change la carte d'un exemplaire (et la carte affichee dans la reponse).
function swapPull(store, userId, pull, card, target = null) {
  const serial = nextSerial(store, card.id);
  store.update('Pulls', pull.id, { Card: card.id, SerialNumber: serial });
  const first = !refId(card.FirstObtainedBy);
  if (first && 'FirstObtainedBy' in card) store.update('Cards', card.id, { FirstObtainedBy: userId });
  if (target) Object.assign(target, { cardId: card.id, name: card.Name, artist: card.Artist, description: card.Description || null, imageId: firstAttachment(card.Image), rarity: rarityView(rarityOf(store, card)), serialNumber: serial, isFirstEver: first });
  return serial;
}
const ownPull = (store, user, pullId) => { const p = store.get('Pulls', Number(pullId)); return p && refId(p.User) === user.id ? p : null; };
// Petits messages differes (larcin subi...), montres a la prochaine visite.
function inbox(store, userId, icon, text) {
  const u = store.get('Users', userId);
  if (!u) return;
  const list = parseJson(u.ModeInbox, []).slice(-9);
  list.push({ at: now(), icon, text });
  store.update('Users', userId, { ModeInbox: JSON.stringify(list) });
}
function popInbox(store, user) {
  const list = parseJson(user.ModeInbox, []);
  if (!list.length) return [];
  store.update('Users', user.id, { ModeInbox: '[]' });
  return list;
}
// Periode du mode en cours (debut = derniere application du preset).
function sessionOf(store, mode) {
  const last = lastPreset(store);
  return last && last.key === mode ? n(last.at) || 1 : 1;
}

// ------------------------------------------------------------------ Cool : boite a souhaits
function wishlistOf(store, userId) {
  return store.tables.has('Wishlist') ? store.getAll('Wishlist').filter((w) => refId(w.User) === userId).map((w) => refId(w.Card)) : [];
}
function wishboxView(store, user) {
  const box = parseJson(user.WishBox, {});
  const mine = box.week === weekKey() ? box : null;
  const card = mine && store.get('Cards', n(mine.cardId));
  return {
    week: weekKey(), set: !!mine, card: card ? cardSummary(store, card) : null, left: mine ? n(mine.left) : 0, done: !!(mine && mine.done),
    wishlist: wishlistOf(store, user.id).map((id) => store.get('Cards', id)).filter((c) => c && !c.IsPromo && c.Active !== false).map((c) => cardSummary(store, c))
  };
}
function wishboxOnOpen(store, user, json) {
  const box = parseJson(user.WishBox, {});
  if (box.week !== weekKey() || box.done || n(box.left) <= 0) return;
  const card = store.get('Cards', n(box.cardId));
  const hit = card && (n(box.left) <= 1 || Math.random() < 1 / n(box.left));
  if (!hit) { store.update('Users', user.id, { WishBox: JSON.stringify({ ...box, left: n(box.left) - 1 }) }); return; }
  // La carte la moins rare du booster devient la carte souhaitee.
  const sortOf = (c) => (c.rarity && c.rarity.sortOrder != null ? n(c.rarity.sortOrder) : 0);
  const target = [...json.cards].sort((a, b) => sortOf(a) - sortOf(b))[0];
  const pull = target && store.getAll('Pulls').find((p) => p.BatchId === json.batchId && refId(p.User) === user.id && refId(p.Card) === target.cardId && p.SerialNumber === target.serialNumber);
  if (!pull) return;
  swapPull(store, user.id, pull, card, target);
  target.wishbox = true;
  json.wishbox = { cardName: card.Name };
  store.update('Users', user.id, { WishBox: JSON.stringify({ ...box, left: 0, done: true }) });
}

// ------------------------------------------------------------------ Chill : jardin partage
const GARDEN = 'shared-garden';
const WATER_EVERY = 2 * 3600;
function gardenGoal(store) {
  const since = now() - 7 * 86400;
  const active = store.getAll('Users').filter((u) => n(u.LastSeenAt) >= since).length;
  return Math.max(20, Math.min(80, active * 4));
}
function gardenView(store, user) {
  const g = appGet(store, GARDEN, {});
  const waters = g.waters || {};
  const total = Object.values(waters).reduce((s, x) => s + n(x), 0);
  const last = n((g.lastWater || {})[user.id]);
  return { cycle: n(g.cycle) + 1, goal: g.goal || gardenGoal(store), total, mine: n(waters[user.id]), gardeners: Object.keys(waters).length, nextWaterAt: last ? last + WATER_EVERY : 0, lastHarvest: g.lastHarvest || null };
}
function gardenWater(store, user) {
  const g = appGet(store, GARDEN, {});
  g.goal = g.goal || gardenGoal(store);
  g.waters = g.waters || {}; g.lastWater = g.lastWater || {};
  if (n(g.lastWater[user.id]) + WATER_EVERY > now()) return fail('too_soon', 429, { at: n(g.lastWater[user.id]) + WATER_EVERY });
  g.waters[user.id] = n(g.waters[user.id]) + 1;
  g.lastWater[user.id] = now();
  const total = Object.values(g.waters).reduce((s, x) => s + n(x), 0);
  let harvest = null;
  if (total >= g.goal) {
    // Recolte : 25 poussieres par arrosage (300 max) et un booster des 3 arrosages.
    const shares = [];
    for (const [uid, w] of Object.entries(g.waters)) {
      const u = store.get('Users', Number(uid));
      if (!u) continue;
      const dust = Math.min(300, 25 * n(w)), boosters = n(w) >= 3 ? 1 : 0;
      store.update('Users', u.id, { StardustCount: n(u.StardustCount) + dust, BoosterCount: n(u.BoosterCount) + boosters });
      shares.push({ userId: u.id, dust, boosters });
      if (u.id !== user.id) inbox(store, u.id, '🌻', `Le jardin partagé a fleuri : +${dust} poussières${boosters ? ' et 1 jeton booster' : ''} pour tes ${w} arrosage${w > 1 ? 's' : ''}.`);
    }
    harvest = { at: now(), gardeners: shares.length, mine: shares.find((s) => s.userId === user.id) || null };
    addFeed(store, { kind: 'garden', icon: '🌻', text: `Le jardin partagé a fleuri grâce à ${shares.length} jardinier${shares.length > 1 ? 's' : ''} : récolte partagée !` });
    appSet(store, GARDEN, { cycle: n(g.cycle) + 1, goal: gardenGoal(store), waters: {}, lastWater: g.lastWater, lastHarvest: { at: harvest.at, gardeners: shares.length } });
  } else appSet(store, GARDEN, g);
  return ok({ garden: gardenView(store, store.get('Users', user.id)), harvest });
}

// ------------------------------------------------------------------ Medium : bourse des cartes
// Moins d'exemplaires d'une carte sur le serveur que la moyenne : elle vaut plus.
let stockCache = { at: 0, store: null, map: null, avg: 1 };
function copiesMap(store) {
  if (stockCache.store === store && Date.now() - stockCache.at < 60000) return stockCache;
  const map = new Map();
  store.getAll('Pulls').forEach((p) => map.set(refId(p.Card), (map.get(refId(p.Card)) || 0) + 1));
  const cards = playable(store);
  const avg = cards.length ? cards.reduce((s, c) => s + (map.get(c.id) || 0), 0) / cards.length : 1;
  stockCache = { at: Date.now(), store, map, avg: Math.max(1, avg) };
  return stockCache;
}
export function stockFactor(store, cardId) {
  if (!ruleOn(store, 'medium.stock') || !store.get('Cards', Number(cardId))) return 1;
  const { map, avg } = copiesMap(store);
  const f = Math.sqrt(avg / Math.max(1, map.get(Number(cardId)) || 0));
  return Math.round(Math.max(0.7, Math.min(1.6, f)) * 100) / 100;
}
function stockView(store) {
  const list = playable(store).map((c) => ({ c, f: stockFactor(store, c.id) }));
  const fmt = (x) => ({ card: cardSummary(store, x.c), factor: x.f });
  return { up: list.filter((x) => x.f > 1).sort((a, b) => b.f - a.f).slice(0, 8).map(fmt), down: list.filter((x) => x.f < 1).sort((a, b) => a.f - b.f).slice(0, 8).map(fmt) };
}

// ------------------------------------------------------------------ Medium : quete en chaine
const STEPS = [
  { type: 'fish', target: 10, text: 'Une bouteille flotte sur l’étang… Pêche 10 fois pour la repêcher.' },
  { type: 'board', target: 3, text: 'La carte au trésor indique un champ : termine 3 grilles de fouille.' },
  { type: 'boosterOpened', target: 5, text: 'Le marchand ambulant veut des preuves : ouvre 5 boosters.' },
  { type: 'harvest', target: 4, text: 'L’herboriste réclame des plantes : récolte 4 fois au jardin.' },
  { type: 'expedition', target: 1, text: 'Le passage secret mène plus loin : pars en expédition.' },
  { type: 'bossAttack', target: 1, text: 'Le gardien bloque la sortie : attaque le boss commun.' },
  { type: 'guess', target: 3, text: 'L’énigme du sphinx : joue 3 fois au jeu de devinettes.' },
  { type: 'chestOpened', target: 1, text: 'Un coffre scellé attend au bout du chemin : ouvre un coffre.' },
  { type: 'craft', target: 1, text: 'Le forgeron a besoin d’aide : crafte une carte.' }
];
const STORIES = ['Le grimoire perdu', 'La carte du pirate', 'Le dragon endormi', 'La cité engloutie', 'L’étoile tombée'];
function questOf(user) {
  const week = weekKey();
  const q = parseJson(user.QuestChain, {});
  if (q.week === week) return q;
  return { week, step: 0, progress: 0, done: false };
}
function questPlan(week) {
  let h = hashOf('quest:' + week);
  const pool = [...STEPS];
  const steps = [];
  while (steps.length < 5) { steps.push(pool.splice(h % pool.length, 1)[0]); h = hashOf(String(h)); }
  return { title: STORIES[hashOf(week) % STORIES.length], steps };
}
function questView(store, user) {
  const q = questOf(user);
  const plan = questPlan(q.week);
  const step = plan.steps[q.step] || null;
  return {
    week: q.week, title: plan.title, stepIndex: q.step, total: plan.steps.length, done: !!q.done,
    step: step && !q.done ? { text: step.text, target: step.target, progress: Math.min(step.target, n(q.progress)), ready: n(q.progress) >= step.target, reward: q.step === plan.steps.length - 1 ? '2 jetons booster + titre « Aventurier »' : '120 poussières' } : null,
    steps: plan.steps.map((s, i) => ({ text: s.text, state: q.done || i < q.step ? 'done' : i === q.step ? 'current' : 'locked' }))
  };
}
function questClaim(store, user) {
  const q = questOf(user);
  const plan = questPlan(q.week);
  const step = plan.steps[q.step];
  if (q.done || !step || n(q.progress) < step.target) return fail('nothing_to_claim');
  const last = q.step === plan.steps.length - 1;
  const fields = last ? { BoosterCount: n(user.BoosterCount) + 2 } : { StardustCount: n(user.StardustCount) + 120 };
  const next = last ? { ...q, done: true } : { ...q, step: q.step + 1, progress: 0 };
  store.update('Users', user.id, { ...fields, QuestChain: JSON.stringify(next) });
  if (last) { grantCosmetic(store, user.id, 'title-adventurer', { type: 'title', label: 'Aventurier' }); addFeed(store, { userId: user.id, kind: 'quest', icon: '🗺️', text: `termine la quête « ${plan.title} » !` }); }
  return ok({ quest: questView(store, store.get('Users', user.id)), reward: last ? { boosters: 2, title: 'Aventurier' } : { dust: 120 } });
}
export function onEvents(store, events) {
  if (!ruleOn(store, 'medium.questChain')) return [];
  for (const e of events) {
    const user = store.get('Users', e.userId);
    if (!user) continue;
    const q = questOf(user);
    const step = questPlan(q.week).steps[q.step];
    if (q.done || !step || step.type !== e.type || n(q.progress) >= step.target) continue;
    store.update('Users', user.id, { QuestChain: JSON.stringify({ ...q, progress: Math.min(step.target, n(q.progress) + (n(e.n) || 1)) }) });
  }
  return [];
}

// ------------------------------------------------------------------ Hard : ironman
function ironmanState(store, user) {
  const p = parseJson(user.Ironman, null);
  const session = sessionOf(store, 'hard');
  const hard = modeKeyOf(store) === 'hard';
  const canPledge = ruleOn(store, 'hard.ironman') && session > 1 && now() - session < 48 * 3600;
  return { pledged: !!(p && p.session === session && hard && !p.broken), since: p && p.at, canPledge: canPledge && !(p && p.session === session), deadline: session > 1 ? session + 48 * 3600 : null, broken: !!(p && p.broken) };
}
// Fin de la periode Hard : recompense des engagements tenus (a la visite suivante).
function ironmanSettle(store, user) {
  const p = parseJson(user.Ironman, null);
  if (!p || p.done) return null;
  const ended = modeKeyOf(store) !== 'hard' || sessionOf(store, 'hard') !== p.session;
  if (!ended) return null;
  store.update('Users', user.id, { Ironman: JSON.stringify({ ...p, done: true }), ...(p.broken ? {} : { BoosterCount: n(user.BoosterCount) + 5 }) });
  if (p.broken) return null;
  grantCosmetic(store, user.id, 'title-ironman', { type: 'title', label: 'Ironman 🛡️' });
  grantCosmetic(store, user.id, 'frame-iron', { type: 'frame', label: 'Cadre d’acier' });
  addFeed(store, { userId: user.id, kind: 'ironman', icon: '🛡️', text: 'a tenu son serment Ironman : aucun décraft de tout le mode Hard !' });
  return { boosters: 5, title: 'Ironman 🛡️', frame: 'Cadre d’acier' };
}

// ------------------------------------------------------------------ Hard : primes de chasse
const BOUNTY = 'bounty';
function bountyState(store) {
  let b = appGet(store, BOUNTY, {});
  const stale = !b.cardId || now() > n(b.until) || (b.winner && now() - n(b.wonAt) > 3600);
  if (stale && ruleOn(store, 'hard.bounty')) {
    const epic = rarityByKey(store, 'epique');
    const min = epic ? n(epic.SortOrder) : 0;
    const pool = playable(store).filter((c) => { const r = rarityOf(store, c); return r && r.Key !== 'unique' && n(r.SortOrder) >= min && c.id !== b.cardId; });
    if (pool.length) {
      b = { cardId: rnd(pool).id, since: now(), until: now() + 3 * 86400, winner: null, wonAt: null, previous: b.winner ? { cardId: b.cardId, winner: b.winner } : b.previous || null };
      appSet(store, BOUNTY, b);
    }
  }
  return b;
}
function bountyView(store, user) {
  const b = bountyState(store);
  const card = b.cardId && store.get('Cards', b.cardId);
  const winner = b.winner && store.get('Users', b.winner);
  const mine = card ? store.getAll('Pulls').filter((p) => refId(p.User) === user.id && refId(p.Card) === card.id && !p.InVault && !p.Insured && !p.Starred)
    // Exemplaires precieux (edition, #001) en dernier : jamais proposes par defaut.
    .sort((a, b) => (!!a.Edition - !!b.Edition) || ((a.SerialNumber === 1) - (b.SerialNumber === 1)) || ((b.SerialNumber || 0) - (a.SerialNumber || 0)))
    .map((p) => ({ pullId: p.id, serialNumber: p.SerialNumber, finish: p.Finish || 'normal', quality: p.Quality || 'damaged', edition: p.Edition || null })) : [];
  return { card: card ? cardSummary(store, card) : null, until: b.until || null, winner: winner ? winner.Pseudo : null, reward: { boosters: 4, dust: 500 }, copies: mine };
}
function bountyDeliver(store, user, body) {
  const b = bountyState(store);
  if (!b.cardId || b.winner) return fail('bounty_taken');
  const pull = ownPull(store, user, body.pullId);
  if (!pull || refId(pull.Card) !== b.cardId) return fail('copy_not_matching');
  if (pull.InVault || pull.Insured || pull.Starred) return fail('protected_copy');
  const denied = editionLoss(store, pull.Edition ? [pull] : [], body);
  if (denied) return denied;
  store.delete('Pulls', pull.id);
  store.update('Users', user.id, { BoosterCount: n(user.BoosterCount) + 4, StardustCount: n(user.StardustCount) + 500 });
  appSet(store, BOUNTY, { ...b, winner: user.id, wonAt: now() });
  const card = store.get('Cards', b.cardId);
  addFeed(store, { userId: user.id, kind: 'bounty', icon: '💰', text: `remporte la prime de chasse sur ${card ? card.Name : 'une carte'} !`, cardId: b.cardId });
  return ok({ bounty: bountyView(store, store.get('Users', user.id)), reward: { boosters: 4, dust: 500 } });
}

// ------------------------------------------------------------------ Hard : cartes maudites
const purifyCost = (store, pull) => { const r = rarityOf(store, store.get('Cards', refId(pull.Card))); return Math.max(30, 2 * n(r && r.DisenchantValue)); };
function cursedOf(store, userId) {
  return store.getAll('Pulls').filter((p) => refId(p.User) === userId && n(p.CursedUntil) > 0);
}
function purify(store, user, pullId) {
  const pull = ownPull(store, user, pullId);
  if (!pull || !(n(pull.CursedUntil) > 0)) return fail('not_cursed');
  const cost = purifyCost(store, pull);
  if (n(user.StardustCount) < cost) return fail('not_enough_dust', 400, { cost });
  store.update('Pulls', pull.id, { CursedUntil: 0 });
  user = store.update('Users', user.id, { StardustCount: n(user.StardustCount) - cost });
  return ok({ purified: true, cost, newStardust: user.StardustCount });
}

// ------------------------------------------------------------------ Hard : larcin
const THEFT_TRIES = 3, ROBBED_MAX = 2, THEFT_CHANCE = 0.35;
function stealable(store, victimId) {
  const mine = store.getAll('Pulls').filter((p) => refId(p.User) === victimId);
  const count = new Map();
  mine.forEach((p) => count.set(refId(p.Card), (count.get(refId(p.Card)) || 0) + 1));
  return mine.filter((p) => count.get(refId(p.Card)) > 1 && p.SerialNumber !== 1 && !p.Insured && !p.InVault && !p.Starred && !p.Edition && !p.Unstable && !store.get('Cards', refId(p.Card))?.IsPromo);
}
function theftState(user) {
  const t = today();
  return { tries: user.TheftDay === t ? n(user.TheftCount) : 0, max: THEFT_TRIES, chance: THEFT_CHANCE, keys: n(user.KeyCount) };
}
function steal(store, user, body) {
  const st = theftState(user);
  if (st.tries >= THEFT_TRIES) return fail('theft_limit', 429, st);
  if (st.keys < 1) return fail('no_key');
  const pseudo = String(body.toPseudo || '').trim().toLowerCase();
  const victim = store.getAll('Users').find((u) => String(u.Pseudo || '').trim().toLowerCase() === pseudo);
  if (!victim || victim.id === user.id) return fail('unknown_target');
  const t = today();
  const robbed = victim.RobbedDay === t ? n(victim.RobbedCount) : 0;
  if (robbed >= ROBBED_MAX) return fail('target_protected', 400, { reason: 'déjà volé deux fois aujourd’hui' });
  const pool = stealable(store, victim.id);
  if (!pool.length) return fail('nothing_to_steal');
  user = store.update('Users', user.id, { KeyCount: st.keys - 1, TheftDay: t, TheftCount: st.tries + 1 });
  if (Math.random() >= THEFT_CHANCE) {
    store.update('Users', victim.id, { StardustCount: n(victim.StardustCount) + 20 });
    inbox(store, victim.id, '🚨', `${user.Pseudo} a tenté de te voler une carte… raté ! L’alarme t’a rapporté 20 poussières.`);
    return ok({ success: false, theft: theftState(user) });
  }
  const pull = rnd(pool);
  store.update('Pulls', pull.id, { User: user.id });
  store.update('Users', victim.id, { RobbedDay: t, RobbedCount: robbed + 1 });
  const card = store.get('Cards', refId(pull.Card));
  inbox(store, victim.id, '🦹', `${user.Pseudo} t’a volé un doublon : ${card ? card.Name : 'une carte'} #${String(pull.SerialNumber || '?').padStart(3, '0')}. Assure ou range tes cartes précieuses !`);
  addFeed(store, { userId: user.id, kind: 'theft', icon: '🦹', text: `a dérobé un doublon à ${victim.Pseudo} !` });
  return ok({ success: true, card: card ? { ...cardSummary(store, card), serialNumber: pull.SerialNumber, finish: pull.Finish || 'normal', quality: pull.Quality || 'damaged' } : null, theft: theftState(user) });
}

// ------------------------------------------------------------------ Chaos : carte instable, bugs
function unstableState(store, user) {
  const session = sessionOf(store, 'chaos');
  const pull = store.getAll('Pulls').find((p) => refId(p.User) === user.id && p.Unstable);
  const card = pull && store.get('Cards', refId(pull.Card));
  return { canClaim: ruleOn(store, 'chaos.unstable') && n(user.UnstableSession) !== session, card: card ? { ...cardSummary(store, card), pullId: pull.id, finish: pull.Finish || 'normal', serialNumber: pull.SerialNumber } : null };
}
function unstableClaim(store, user) {
  const st = unstableState(store, user);
  if (!st.canClaim) return fail('already_claimed');
  const rare = rarityByKey(store, 'rare');
  const pool = playable(store).filter((c) => { const r = rarityOf(store, c); return r && r.Key !== 'unique' && n(r.SortOrder) >= n(rare && rare.SortOrder); });
  if (!pool.length) return fail('no_card');
  const card = rnd(pool);
  store.create('Pulls', { User: user.id, Card: card.id, SerialNumber: nextSerial(store, card.id), Finish: rnd(FINISHES), Quality: 'good', Edition: 'glitch', Unstable: true, UnstableDay: today(), ObtainedAt: now(), BatchId: `unstable-${user.id}-${Date.now()}` });
  store.update('Users', user.id, { UnstableSession: sessionOf(store, 'chaos') });
  addFeed(store, { userId: user.id, kind: 'unstable', icon: '🌀', text: 'récupère une carte instable : elle changera chaque jour…' });
  return ok({ unstable: unstableState(store, store.get('Users', user.id)) });
}

const BUG_PAGES = ['index.html', 'collection.html', 'ouverture.html', 'jeux.html', 'communaute.html', 'boutique.html', 'trade.html', 'coffre.html'];
const BUG_KINDS = ['flee', 'flip', 'pixel', 'shake'];
const BUGS_PER_DAY = 5, BUG_DUST = 25;
function bugsOf(user) {
  const t = today();
  const found = parseJson(user.Bugs, {});
  const done = found.day === t ? found.ids || [] : [];
  const list = Array.from({ length: BUGS_PER_DAY }, (_, i) => {
    const h = hashOf(`bug:${t}:${user.id}:${i}`);
    return { id: `${t}-${i}`, page: BUG_PAGES[h % BUG_PAGES.length], kind: BUG_KINDS[(h >> 4) % BUG_KINDS.length], x: 5 + ((h >> 8) % 85), y: 15 + ((h >> 16) % 70) };
  });
  return { list: list.filter((b) => !done.includes(b.id)), found: done.length, total: BUGS_PER_DAY, dust: BUG_DUST };
}
function bugFound(store, user, id) {
  const t = today();
  const st = bugsOf(user);
  if (!st.list.some((b) => b.id === id)) return fail('unknown_bug');
  const found = parseJson(user.Bugs, {});
  const ids = found.day === t ? found.ids || [] : [];
  user = store.update('Users', user.id, { Bugs: JSON.stringify({ day: t, ids: [...ids, id] }), StardustCount: n(user.StardustCount) + BUG_DUST });
  return ok({ dust: BUG_DUST, newStardust: user.StardustCount, bugs: bugsOf(user) });
}

// ------------------------------------------------------------------ passages periodiques (par joueur)
// Maledictions echues, mutations, carte instable du jour. Notes renvoyees au site.
export function sweepUser(store, userId) {
  const notes = [];
  const t = now();
  const mine = store.getAll('Pulls').filter((p) => refId(p.User) === userId && (n(p.CursedUntil) > 0 || n(p.MutateAt) > 0 || p.Unstable));
  const cursing = ruleOn(store, 'hard.cursed');
  for (const p of mine) {
    const card = store.get('Cards', refId(p.Card));
    const name = card ? card.Name : '?';
    if (n(p.CursedUntil) > 0 && n(p.CursedUntil) <= t) {
      const q = QUALITY.indexOf(p.Quality || 'damaged');
      const fields = { CursedUntil: 0 };
      if (cursing && q > 0) { fields.Quality = QUALITY[q - 1]; notes.push({ icon: '🕯️', text: `La malédiction a frappé : ${name} perd un cran d’état.` }); }
      store.update('Pulls', p.id, fields);
    }
    if (n(p.MutateAt) > 0 && n(p.MutateAt) <= t) {
      const fields = { MutateAt: 0 };
      const up = Math.random() < 0.55 ? 1 : -1;
      if (Math.random() < 0.5) {
        const i = Math.max(0, Math.min(FINISHES.length - 1, FINISHES.indexOf(p.Finish || 'normal') + up));
        fields.Finish = FINISHES[i];
      } else {
        const i = Math.max(0, Math.min(QUALITY.length - 1, QUALITY.indexOf(p.Quality || 'damaged') + up));
        fields.Quality = QUALITY[i];
      }
      store.update('Pulls', p.id, fields);
      notes.push({ icon: '🧬', text: `${name} a muté ${up > 0 ? 'en mieux' : 'en pire'} !` });
    }
    if (p.Unstable && p.UnstableDay !== today() && ruleOn(store, 'chaos.unstable')) {
      const r = rarityOf(store, card);
      const pool = playable(store).filter((c) => refId(c.Rarity) === (r ? r.id : 0) && c.id !== refId(p.Card));
      const h = hashOf(`unstable:${today()}:${p.id}`);
      const next = pool.length ? pool[h % pool.length] : card;
      store.update('Pulls', p.id, { Card: next.id, SerialNumber: next.id === refId(p.Card) ? p.SerialNumber : nextSerial(store, next.id), Finish: FINISHES[(h >> 5) % FINISHES.length], UnstableDay: today() });
      notes.push({ icon: '🌀', text: `Ta carte instable est devenue ${next.Name} !` });
    }
  }
  return notes;
}

// ------------------------------------------------------------------ vacances des dinos (Cool)
let holidayKnown = null;
let holidayStore = null;
export function beforeRequest({ store }) {
  if (!store.tables.has('AppSettings')) return;
  if (holidayStore !== store) { holidayStore = store; holidayKnown = !!appGet(store, 'dino-holiday', {}).on; setDinoHoliday(holidayKnown); }
  const on = ruleOn(store, 'cool.dinoHoliday');
  if (on === holidayKnown) return;
  holidayTransition(store, on);
  appSet(store, 'dino-holiday', { on, at: now() });
  holidayKnown = on;
}

// ------------------------------------------------------------------ crochets des workflows
export function beforeWorkflow({ store, path, request }) {
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user) return null;
  // Ironman : plus aucun decraft tant que l'engagement court.
  if (path === 'disenchant' && ironmanState(store, user).pledged) return { status: 400, json: { error: 'ironman_pledged' } };
  // Bourse : le craft coute plus (ou moins) selon la rarete de la carte sur le serveur.
  if (path === 'craft' && ruleOn(store, 'medium.stock')) {
    const card = store.get('Cards', Number(body.cardId));
    const r = rarityOf(store, card);
    const base = n(r && r.CraftCost);
    const delta = Math.round(base * (stockFactor(store, Number(body.cardId)) - 1));
    if (delta > 0 && n(user.StardustCount) < base + delta) return { status: 400, json: { error: 'insufficient_dust', stockSurcharge: delta } };
    request._stockDelta = delta;
  }
  return null;
}

export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || typeof response.json !== 'object' || Array.isArray(response.json)) return;
  const json = response.json;
  const body = request.body || {};
  const userId = Number(body.userId || (request.query || {}).userId);
  let user = userId ? store.get('Users', userId) : null;
  if (!user) return;
  if (path === 'craft' && json.crafted && n(request._stockDelta)) {
    user = store.update('Users', user.id, { StardustCount: Math.max(0, n(user.StardustCount) - n(request._stockDelta)) });
    json.stockDelta = n(request._stockDelta);
    json.newStardust = user.StardustCount;
    return;
  }
  if (path === 'open-pack' && !body.dryRun && Array.isArray(json.cards) && json.batchId) {
    store.update('Users', user.id, { LastBatch: json.batchId });
    if (ruleOn(store, 'cool.wishbox')) wishboxOnOpen(store, store.get('Users', user.id), json);
    const pulls = store.getAll('Pulls').filter((p) => p.BatchId === json.batchId && refId(p.User) === user.id);
    const pullOf = (c) => pulls.find((p) => refId(p.Card) === c.cardId && p.SerialNumber === c.serialNumber);
    if (ruleOn(store, 'hard.cursed')) {
      for (const c of json.cards) {
        const p = pullOf(c);
        if (!p || p.Edition || c.edition || Math.random() >= 0.05) continue;
        store.update('Pulls', p.id, { CursedUntil: now() + 48 * 3600 });
        c.cursed = now() + 48 * 3600;
        json.cursed = (json.cursed || 0) + 1;
      }
    }
    if (ruleOn(store, 'chaos.mutants')) {
      for (const c of json.cards) {
        const p = pullOf(c);
        if (!p || Math.random() >= 0.1) continue;
        store.update('Pulls', p.id, { MutateAt: now() + (1 + Math.floor(Math.random() * 23)) * 3600 });
        c.mutant = true;
        json.mutants = (json.mutants || 0) + 1;
      }
    }
    // Booster glitche : une carte hors-serie en plus, de n'importe quelle extension.
    if (ruleOn(store, 'chaos.glitchPack') && Math.random() < 0.2) {
      const rarities = store.getAll('Rarities').filter((r) => r.Key !== 'unique' && n(r.Weight) > 0);
      const cards = store.getAll('Cards').filter((c) => !c.IsPromo);
      const pool = rarities.filter((r) => cards.some((c) => refId(c.Rarity) === r.id));
      const total = pool.reduce((s, r) => s + n(r.Weight), 0);
      let roll = Math.random() * total;
      const rarity = pool.find((r) => (roll -= n(r.Weight)) <= 0) || pool[pool.length - 1];
      const candidates = rarity ? cards.filter((c) => refId(c.Rarity) === rarity.id) : [];
      if (candidates.length) {
        const card = rnd(candidates);
        const serial = nextSerial(store, card.id);
        const finish = Math.random() < 0.35 ? rnd(FINISHES.slice(1)) : 'normal';
        store.create('Pulls', { User: user.id, Card: card.id, SerialNumber: serial, Finish: finish, Quality: 'good', Edition: 'glitch', ObtainedAt: now(), BatchId: json.batchId });
        json.cards.push({ cardId: card.id, name: card.Name, artist: card.Artist, description: card.Description || null, imageId: firstAttachment(card.Image), rarity: rarityView(rarity), serialNumber: serial, finish, quality: 'good', edition: 'glitch', glitched: true, isFirstEver: false });
        json.glitchPack = true;
      }
    }
    return;
  }
  // Visite (badge d'en-tete) ou collection : passages periodiques + messages en attente.
  if (path === 'booster-status' || path === 'collection') {
    const notes = sweepUser(store, user.id);
    const iron = ironmanSettle(store, store.get('Users', user.id));
    if (iron) notes.push({ icon: '🛡️', text: `Serment Ironman tenu : +${iron.boosters} jetons booster, titre « ${iron.title} » et ${iron.frame} !` });
    if (path === 'booster-status') notes.push(...popInbox(store, store.get('Users', user.id)));
    if (notes.length) json.modeNotes = notes;
    if (path === 'collection') {
      json.cursedPulls = Object.fromEntries(cursedOf(store, user.id).map((p) => [p.id, n(p.CursedUntil)]));
      if (ruleOn(store, 'medium.stock')) {
        const stock = {};
        playable(store).forEach((c) => { const f = stockFactor(store, c.id); if (f !== 1) stock[c.id] = f; });
        json.stock = stock;
      }
    }
  }
}

// ------------------------------------------------------------------ route
function status(store, user) {
  const out = { mode: modeKeyOf(store) };
  if (ruleOn(store, 'cool.wishbox')) out.wishbox = wishboxView(store, user);
  if (ruleOn(store, 'cool.freeRepair')) out.freeRepair = { available: user.FreeRepairDay !== today() };
  if (ruleOn(store, 'cool.secondChance')) {
    const batch = user.LastBatch;
    const pulls = batch ? store.getAll('Pulls').filter((p) => p.BatchId === batch && refId(p.User) === user.id && now() - n(p.ObtainedAt) < 24 * 3600) : [];
    out.secondChance = { available: user.SecondChanceDay !== today(), cards: pulls.map((p) => { const c = store.get('Cards', refId(p.Card)); return c ? { ...cardSummary(store, c), pullId: p.id, serialNumber: p.SerialNumber, finish: p.Finish || 'normal', quality: p.Quality || 'damaged', edition: p.Edition || null } : null; }).filter(Boolean) };
  }
  if (ruleOn(store, 'chill.sharedGarden')) out.garden = gardenView(store, user);
  if (ruleOn(store, 'medium.stock')) out.stock = stockView(store);
  if (ruleOn(store, 'medium.questChain')) out.quest = questView(store, user);
  if (ruleOn(store, 'hard.ironman') || parseJson(user.Ironman, null)) out.ironman = ironmanState(store, user);
  if (ruleOn(store, 'hard.bounty')) out.bounty = bountyView(store, user);
  if (ruleOn(store, 'hard.cursed') || cursedOf(store, user.id).length) out.cursed = cursedOf(store, user.id).map((p) => { const c = store.get('Cards', refId(p.Card)); return { pullId: p.id, until: n(p.CursedUntil), cost: purifyCost(store, p), card: c ? cardSummary(store, c) : null, serialNumber: p.SerialNumber, finish: p.Finish || 'normal', quality: p.Quality || 'damaged' }; });
  if (ruleOn(store, 'hard.theft')) out.theft = theftState(user);
  if (ruleOn(store, 'chaos.unstable')) out.unstable = unstableState(store, user);
  if (ruleOn(store, 'chaos.bugs')) out.bugs = bugsOf(user);
  return out;
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  const need = (key) => (ruleOn(store, key) ? null : fail('wrong_mode', 400, { rule: key }));
  let denied;
  switch (action) {
    case 'status': {
      const notes = sweepUser(store, user.id);
      return ok({ ...status(store, store.get('Users', user.id)), notes });
    }
    case 'wishbox': {
      if ((denied = need('cool.wishbox'))) return denied;
      const v = wishboxView(store, user);
      if (v.set) return fail('already_set', 400, v);
      if (!wishlistOf(store, user.id).includes(Number(body.cardId))) return fail('not_in_wishlist');
      store.update('Users', user.id, { WishBox: JSON.stringify({ week: weekKey(), cardId: Number(body.cardId), left: 10, done: false }) });
      return ok({ wishbox: wishboxView(store, store.get('Users', user.id)) });
    }
    case 'free-repair': {
      if ((denied = need('cool.freeRepair'))) return denied;
      if (user.FreeRepairDay === today()) return fail('already_used');
      const pull = ownPull(store, user, body.pullId);
      if (!pull) return fail('copy_not_owned');
      const q = QUALITY.indexOf(pull.Quality || 'damaged');
      if (q >= QUALITY.length - 1) return fail('already_mint');
      store.update('Pulls', pull.id, { Quality: QUALITY[q + 1] });
      store.update('Users', user.id, { FreeRepairDay: today() });
      return ok({ repaired: true, pullId: pull.id, from: QUALITY[q], to: QUALITY[q + 1] });
    }
    case 'second-chance': {
      if ((denied = need('cool.secondChance'))) return denied;
      if (user.SecondChanceDay === today()) return fail('already_used');
      const pull = ownPull(store, user, body.pullId);
      if (!pull || !user.LastBatch || pull.BatchId !== user.LastBatch || now() - n(pull.ObtainedAt) > 24 * 3600) return fail('not_last_booster');
      const card = store.get('Cards', refId(pull.Card));
      const pool = playable(store).filter((c) => refId(c.Rarity) === refId(card && card.Rarity) && c.id !== (card && card.id) && (!card || !refId(card.Extension) || refId(c.Extension) === refId(card.Extension)));
      if (!pool.length) return fail('no_other_card');
      const next = rnd(pool);
      const serial = swapPull(store, user.id, pull, next);
      store.update('Users', user.id, { SecondChanceDay: today() });
      return ok({ rerolled: true, from: card ? card.Name : null, card: { ...cardSummary(store, next), serialNumber: serial, finish: pull.Finish || 'normal', quality: pull.Quality || 'damaged', edition: pull.Edition || null } });
    }
    case 'garden-water':
      if ((denied = need('chill.sharedGarden'))) return denied;
      return gardenWater(store, user);
    case 'quest-claim':
      if ((denied = need('medium.questChain'))) return denied;
      return questClaim(store, user);
    case 'ironman-pledge': {
      const st = ironmanState(store, user);
      if (!st.canPledge) return fail('cannot_pledge', 400, st);
      store.update('Users', user.id, { Ironman: JSON.stringify({ session: sessionOf(store, 'hard'), at: now(), broken: false }) });
      return ok({ ironman: ironmanState(store, store.get('Users', user.id)) });
    }
    case 'ironman-abandon': {
      const p = parseJson(user.Ironman, null);
      if (!p || p.broken || p.done) return fail('not_pledged');
      store.update('Users', user.id, { Ironman: JSON.stringify({ ...p, broken: true }) });
      return ok({ ironman: ironmanState(store, store.get('Users', user.id)) });
    }
    case 'bounty-deliver':
      if ((denied = need('hard.bounty'))) return denied;
      return bountyDeliver(store, user, body);
    case 'purify':
      return purify(store, user, body.pullId);
    case 'steal':
      if ((denied = need('hard.theft'))) return denied;
      return steal(store, user, body);
    case 'unstable-claim':
      if ((denied = need('chaos.unstable'))) return denied;
      return unstableClaim(store, user);
    case 'bug-found':
      if ((denied = need('chaos.bugs'))) return denied;
      return bugFound(store, user, String(body.id || ''));
    default:
      return fail('unknown_action');
  }
}

export const routes = { 'POST mode-extra': handle };
