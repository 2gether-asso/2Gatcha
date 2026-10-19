// Bonus et malus propres a chaque mode de jeu (2026-10-14).
//  Cool   : calin du jour, peche sans prise vide, decraft annulable 24 h,
//           2 trouvailles du chien, jardin magique, echanges sans taxe.
//  Chill  : 2 heures de chance par jour, pity x2 le week-end, marche aussi
//           le mercredi, 4e defi (+ fragments), doublon porte-bonheur.
//  Medium : pari du booster, contrat de la semaine, booster a double
//           tranchant, coup de chance aleatoire du jour.
//  Hard   : usure des doublons, finitions plus rares mais arc-en-ciel
//           "forgees dans les flammes", boss enrage, marche noir brulant,
//           taxe de luxe redistribuee, succes de survie.
//  Tous   : carte exclusive du mode (objectif commun), annonce du
//           changement de mode, medaille "Toutes saisons".
// Chaque module concerne interroge modeIs(store, 'cool'...) ; les crochets
// generiques (statut, ouverture de booster, decraft...) sont ici.
//   POST /webhook/decraft-undo  { userId, action: 'list' | 'undo', id? }
//   POST /webhook/weekly-goal   { userId, action: 'status' | 'claim' }

import { refId, now, ok, fail, userById, parisDay, parseJson, cardSummary, firstAttachment, nextSerial } from './common.js';
import { setting } from './settings.js';
import { keepsMint } from './secrets.js';
import { currentMode } from './presets.js';
import { weekKey } from './levels.js';
import { grantCosmetic } from './cosmetics.js';
import { addFeed } from './feed.js';
import { addShards } from './comfort.js';
import { setExtraLucky } from './daily.js';
import { ruleOn } from './moderules.js';

export const schema = {
  Users: {
    HugDay: { type: 'Text' }, WearDay: { type: 'Text' }, ModeDays: { type: 'Text' }, ModeCards: { type: 'Text' },
    LuckyOpenDay: { type: 'Text' }, LuckyOpenCount: { type: 'Numeric' }, WeeklyGoal: { type: 'Text' }
  },
  Pulls: { ForgedInFire: { type: 'Bool' } },
  DecraftUndo: { User: { type: 'Ref:Users' }, Card: { type: 'Ref:Cards' }, Finish: { type: 'Text' }, Quality: { type: 'Text' }, Serial: { type: 'Numeric' }, Dust: { type: 'Numeric' }, At: { type: 'Numeric' }, Undone: { type: 'Bool' } }
};

export const modeKey = (store) => (currentMode(store) || {}).key || 'medium';
export const modeIs = (store, key) => modeKey(store) === key;

// Ce que chaque mode change pour les joueurs (annonce du changement de mode).
export const MODE_PERKS = {
  cool: ['🎁 Un petit cadeau à chaque connexion du jour', '🎣 Plus aucune prise vide à la pêche', '↩️ Décraft annulable pendant 24 h', '🐕 Milo rapporte 2 trouvailles par jour', '🌱 Le jardin ne fane plus, une récolte sur cinq est rare', '🤝 Échanges et enchères sans taxe'],
  chill: ['🍀 Deux heures de chance par jour', '🎯 Le pity avance deux fois plus vite le week-end', '☀️ Marché aussi le mercredi', '🎯 Un 4e défi de la semaine, et des fragments en plus', '🍀 Un doublon sur dix devient une carte qui te manque'],
  medium: ['🎲 Pari du booster : mise 100 ✨, triplée si une épique sort', '📜 Un contrat personnel chaque semaine (booster à la clé)', '⚔️ Booster à double tranchant : 3 cartes dont une rare garantie', '🍀 Un booster par jour, au hasard, a ses finitions doublées'],
  chaos: ['👾 Une règle surprise chaque jour, annoncée dans le bandeau', '🎲 Base Medium, mais tout peut changer à minuit', '👾 Édition limitée Glitch à l’ouverture des boosters', '🏆 Succès « Agent du chaos » : 5 règles différentes'],
  hard: ['🧽 Tes doublons s’usent un peu chaque jour (sauf sous un parapluie ☂️)', '🔥 Finitions plus rares, mais les arc-en-ciel sont « forgées dans les flammes »', '👹 Boss enragé : 2× plus résistant, récompense ×3', '🌋 Marché noir brûlant : offres plus rares et plus courtes', '💸 Taxe de luxe pour les plus riches, redistribuée aux joueurs actifs', '🏆 Succès et cadres de survie exclusifs']
};

// ------------------------------------------------------------------ outils communs
const QUALITY = ['damaged', 'worn', 'good', 'mint'];
const rarityRank = (store, key) => { const r = store.getAll('Rarities').find((x) => x.Key === key); return r ? r.SortOrder || 0 : 99; };
const sortOf = (store, card) => (card.rarity && card.rarity.sortOrder != null ? Number(card.rarity.sortOrder) : (store.get('Rarities', Number(card.rarity && card.rarity.id)) || {}).SortOrder || 0);
function giveCard(store, userId, cardId, batch, extra = {}) {
  const serial = nextSerial(store, cardId);
  store.create('Pulls', { User: userId, Card: cardId, SerialNumber: serial, Finish: 'normal', Quality: 'good', ObtainedAt: now(), BatchId: batch, ...extra });
  return serial;
}

// ------------------------------------------------------------------ contrat de la semaine (Medium)
const GOALS = [
  { key: 'epics', label: 'Obtenir 3 cartes épiques ou mieux', target: 3 },
  { key: 'boosterOpened', label: 'Ouvrir 10 boosters', target: 10 },
  { key: 'board', label: 'Terminer 5 grilles de fouille', target: 5 },
  { key: 'harvest', label: 'Récolter 8 fois au jardin', target: 8 },
  { key: 'fish', label: 'Pêcher 30 fois', target: 30 },
  { key: 'tradeDone', label: 'Conclure 2 échanges', target: 2 }
];
function goalOf(user) {
  const week = weekKey();
  const g = parseJson(user.WeeklyGoal, {});
  if (g.week === week) return g;
  let h = 0; for (const ch of `${week}:${user.id}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { week, key: GOALS[h % GOALS.length].key, progress: 0, claimed: false };
}
function goalView(store, user) {
  const g = goalOf(user);
  const t = GOALS.find((x) => x.key === g.key);
  return { active: ruleOn(store, 'medium.contract'), week: g.week, key: g.key, label: t.label, target: t.target, progress: Math.min(t.target, g.progress), done: g.progress >= t.target, claimed: !!g.claimed, reward: { boosters: 1, title: 'Contractuel' } };
}
function bumpGoal(store, userId, type, n) {
  if (!ruleOn(store, 'medium.contract')) return;
  const user = store.get('Users', userId);
  if (!user) return;
  const g = goalOf(user);
  if (g.key !== type || g.claimed) return;
  g.progress = (Number(g.progress) || 0) + n;
  store.update('Users', userId, { WeeklyGoal: JSON.stringify(g) });
}
function handleGoal({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const v = goalView(store, user);
  if ((body.action || 'status') === 'status') return ok(v);
  if (body.action !== 'claim') return fail('unknown_action');
  if (!v.active) return fail('wrong_mode');
  if (!v.done || v.claimed) return fail('nothing_to_claim', 400, v);
  const g = goalOf(user);
  g.claimed = true;
  user = store.update('Users', user.id, { WeeklyGoal: JSON.stringify(g), BoosterCount: (Number(user.BoosterCount) || 0) + 1 });
  grantCosmetic(store, user.id, 'mode-contract', { type: 'title', label: 'Contractuel' });
  return ok({ ...goalView(store, user), reward: { boosters: 1 }, newBoosterCount: user.BoosterCount });
}

// Abonne du bus d'activite : progression du contrat.
export function onEvents(store, events) {
  for (const e of events) if (GOALS.some((g) => g.key === e.type)) bumpGoal(store, e.userId, e.type, Number(e.n) || 1);
  return [];
}

// ------------------------------------------------------------------ decraft annulable (Cool)
function handleUndo({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const limit = now() - 24 * 3600;
  const list = () => (store.tables.has('DecraftUndo') ? store.getAll('DecraftUndo') : []).filter((r) => refId(r.User) === user.id && !r.Undone && (Number(r.At) || 0) >= limit)
    .sort((a, b) => b.At - a.At).slice(0, 20)
    .map((r) => { const c = store.get('Cards', refId(r.Card)); return { id: r.id, card: c ? cardSummary(store, c) : null, finish: r.Finish, quality: r.Quality, dust: Number(r.Dust) || 0, at: r.At, until: (Number(r.At) || 0) + 24 * 3600 }; });
  const active = ruleOn(store, 'cool.decraftUndo');
  if ((body.action || 'list') === 'list') return ok({ active, items: active ? list() : [] });
  if (body.action !== 'undo') return fail('unknown_action');
  if (!active) return fail('wrong_mode');
  const r = store.get('DecraftUndo', Number(body.id));
  if (!r || refId(r.User) !== user.id || r.Undone || (Number(r.At) || 0) < limit) return fail('not_undoable');
  const dust = Number(r.Dust) || 0;
  if ((Number(user.StardustCount) || 0) < dust) return fail('not_enough_dust', 400, { dust });
  const used = new Set(store.getAll('Pulls').filter((p) => refId(p.Card) === refId(r.Card)).map((p) => p.SerialNumber));
  const serial = r.Serial && !used.has(r.Serial) ? r.Serial : nextSerial(store, refId(r.Card));
  store.create('Pulls', { User: user.id, Card: refId(r.Card), SerialNumber: serial, Finish: r.Finish || 'normal', Quality: r.Quality || 'damaged', ObtainedAt: now(), BatchId: `undo-${r.id}` });
  store.update('DecraftUndo', r.id, { Undone: true });
  user = store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) - dust });
  return ok({ undone: true, serialNumber: serial, newStardust: user.StardustCount, items: list() });
}

// ------------------------------------------------------------------ avant les workflows
export function beforeWorkflow({ store, path, request }) {
  const body = request.body || {};
  if (path === 'disenchant') {
    // Cool : on note ce qui va etre decrafte (le workflow supprime l'exemplaire).
    if (ruleOn(store, 'cool.decraftUndo')) {
      const pulls = store.getAll('Pulls').filter((p) => refId(p.User) === Number(body.userId) && refId(p.Card) === Number(body.cardId));
      const pull = body.pullId ? pulls.find((p) => p.id === Number(body.pullId)) : pulls.find((p) => (!body.finish || (p.Finish || 'normal') === body.finish) && (!body.quality || (p.Quality || 'damaged') === body.quality));
      if (pull) request._undo = { card: refId(pull.Card), finish: pull.Finish || 'normal', quality: pull.Quality || 'damaged', serial: pull.SerialNumber || null };
    }
    return null;
  }
  if (path !== 'open-pack' || body.dryRun) return null;
  const user = store.get('Users', Number(body.userId));
  if (!user) return null;
  if (modeIs(store, 'medium')) {
    // Pari du booster.
    if (body.bet && ruleOn(store, 'medium.bet')) {
      const stake = setting(store, 'BoosterBetStake');
      if ((Number(user.StardustCount) || 0) < stake) return { status: 400, json: { error: 'not_enough_dust_bet', stake } };
      request._bet = stake;
    }
    if (body.edge && ruleOn(store, 'medium.edge')) request._edge = true;
    // Coup de chance aleatoire : le n-ieme booster du jour (n tire par joueur et par jour).
    const today = parisDay(0);
    const count = user.LuckyOpenDay === today ? Number(user.LuckyOpenCount) || 0 : 0;
    let h = 0; for (const ch of `${today}:${user.id}`) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    if (count + 1 === 1 + (h % 4) && ruleOn(store, 'medium.luckyOpen')) request._luckyOpen = true;
    store.update('Users', user.id, { LuckyOpenDay: today, LuckyOpenCount: count + 1 });
  }
  return null;
}

// ------------------------------------------------------------------ apres les workflows
function dailyVisit(store, user, json) {
  const today = parisDay(0);
  const mode = modeKey(store);
  const fields = {};
  // Medaille "Toutes saisons" et succes de survie : jours joues par mode.
  const days = parseJson(user.ModeDays, {});
  if (days.last !== today) {
    days[mode] = (Number(days[mode]) || 0) + 1;
    days.last = today;
    fields.ModeDays = JSON.stringify(days);
    if (mode === 'hard' && ruleOn(store, 'hard.survival') && days.hard >= 7 && grantCosmetic(store, user.id, 'frame-inferno', { type: 'frame', label: 'Cadre Infernal' })) json.modeUnlock = 'Cadre Infernal (7 jours en Hard)';
    if (['cool', 'chill', 'medium', 'hard'].every((k) => (Number(days[k]) || 0) >= 5) && grantCosmetic(store, user.id, 'frame-seasons', { type: 'frame', label: 'Cadre Toutes saisons' })) json.modeUnlock = 'Cadre Toutes saisons';
  }
  // Cool : calin du jour.
  if (ruleOn(store, 'cool.hug') && user.HugDay !== today) {
    fields.HugDay = today;
    const r = Math.random();
    if (r < 0.4) { fields.Worms = (Number(user.Worms) || 0) + 3; json.hug = '🪱 3 vers de terre'; }
    else if (r < 0.75) { fields.StardustCount = (Number(user.StardustCount) || 0) + 30; json.hug = '✨ 30 poussières'; }
    else { json.hug = '🧩 2 fragments de booster'; json._hugShards = 2; }
  }
  // Hard : usure d'un doublon (jamais un #001, un exemplaire assure, ★ ou au coffre).
  if (ruleOn(store, 'hard.wear') && user.WearDay !== today) {
    fields.WearDay = today;
    if ((Number(user.UmbrellaUntil) || 0) > now()) json.umbrella = true;
    else if (Math.random() < setting(store, 'HardWearChance')) {
      const mine = store.getAll('Pulls').filter((p) => refId(p.User) === user.id);
      const byCard = new Map();
      mine.forEach((p) => byCard.set(refId(p.Card), (byCard.get(refId(p.Card)) || 0) + 1));
      const pool = mine.filter((p) => byCard.get(refId(p.Card)) > 1 && p.SerialNumber !== 1 && !p.Insured && !p.Starred && !p.InVault && !p.Edition && !keepsMint(store, refId(p.Card)) && QUALITY.indexOf(p.Quality || 'damaged') > 0);
      if (pool.length) {
        const p = pool[Math.floor(Math.random() * pool.length)];
        const from = p.Quality || 'damaged', to = QUALITY[QUALITY.indexOf(from) - 1];
        store.update('Pulls', p.id, { Quality: to });
        const c = store.get('Cards', refId(p.Card));
        json.wear = { card: c ? c.Name : '?', from, to };
      }
    }
  }
  if (Object.keys(fields).length) user = store.update('Users', user.id, fields);
  if (json._hugShards) { addShards(store, user.id, json._hugShards); delete json._hugShards; }
}

function afterOpenPack(store, request, json) {
  const body = request.body || {};
  const userId = Number(body.userId);
  let user = store.get('Users', userId);
  if (!user || !Array.isArray(json.cards)) return;
  const mode = modeKey(store);
  const pulls = () => store.getAll('Pulls').filter((p) => p.BatchId === json.batchId && refId(p.User) === userId);
  // Hard : un quart des finitions speciales retombent en normale ; les arc-en-ciel restantes sont forgees.
  if (ruleOn(store, 'hard.forge')) {
    let forged = 0;
    for (const c of json.cards) {
      const pull = pulls().find((p) => refId(p.Card) === c.cardId && p.SerialNumber === c.serialNumber);
      if (!pull) continue;
      if ((c.finish || 'normal') !== 'normal' && Math.random() < setting(store, 'HardFinishLoss')) { store.update('Pulls', pull.id, { Finish: 'normal' }); c.finish = 'normal'; c.finishLost = true; continue; }
      if (c.finish === 'rainbow') { store.update('Pulls', pull.id, { ForgedInFire: true }); c.forgedInFire = true; forged++; }
    }
    if (forged) { json.forged = forged; addFeed(store, { userId, kind: 'forged', icon: '🔥', text: `forge une arc-en-ciel dans les flammes du mode Hard !` }); }
  }
  // Succes de survie : une legendaire (ou mieux) en mode Hard.
  if (ruleOn(store, 'hard.survival')) {
    if (json.cards.some((c) => sortOf(store, c) >= rarityRank(store, 'legendaire')) && grantCosmetic(store, userId, 'title-survivor', { type: 'title', label: 'Survivant 🔥' })) json.modeUnlock = 'Titre « Survivant 🔥 »';
  }
  // Medium : coup de chance (deja applique par boosts.js), pari.
  if (request._luckyOpen) json.luckyOpen = true;
  if (request._bet) {
    const stake = request._bet;
    const won = json.cards.some((c) => sortOf(store, c) >= rarityRank(store, 'epique'));
    const delta = won ? stake * 2 : -stake;
    user = store.update('Users', userId, { StardustCount: Math.max(0, (Number(user.StardustCount) || 0) + delta) });
    json.bet = { stake, won, payout: won ? stake * 3 : 0, newStardust: user.StardustCount };
  }
  // Contrat de la semaine (Medium) : epiques ou mieux obtenues.
  const epics = json.cards.filter((c) => sortOf(store, c) >= rarityRank(store, 'epique')).length;
  if (epics) bumpGoal(store, userId, 'epics', epics);
}

export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  const json = response.json;
  const body = request.body || {};
  if (path === 'booster-status') {
    const user = store.get('Users', Number((request.query || {}).userId));
    if (user) dailyVisit(store, user, json);
    json.gameMode = currentMode(store);
    return;
  }
  if (path === 'open-pack' && !body.dryRun) { afterOpenPack(store, request, json); return; }
  if (path === 'disenchant' && json.disenchanted && request._undo && store.tables.has('DecraftUndo')) {
    const u = request._undo;
    const row = store.create('DecraftUndo', { User: Number(body.userId), Card: u.card, Finish: u.finish, Quality: u.quality, Serial: u.serial, Dust: Number(json.dustGained) || 0, At: now(), Undone: false });
    json.undoId = row.id;
    json.undoUntil = now() + 24 * 3600;
    return;
  }
  if (path === 'collection') {
    const userId = Number((request.query || {}).userId || body.userId);
    json.forgedPullIds = store.getAll('Pulls').filter((p) => refId(p.User) === userId && p.ForgedInFire).map((p) => p.id);
  }
}

// ------------------------------------------------------------------ carte exclusive du mode (objectif commun)
export function modeCardFor(store) {
  const key = modeKey(store);
  const id = Number(setting(store, 'ModeCards')[key]) || 0;
  const card = id ? store.get('Cards', id) : null;
  return card ? { key, card } : null;
}
// Donnee une fois par joueur a la recuperation de l'objectif commun (challenges.js).
export function grantModeCard(store, userId) {
  const mc = modeCardFor(store);
  if (!mc) return null;
  const user = store.get('Users', userId);
  const got = parseJson(user && user.ModeCards, []);
  if (!user || got.includes(mc.card.id)) return null;
  const serial = giveCard(store, userId, mc.card.id, `mode-${mc.key}-${userId}`);
  store.update('Users', userId, { ModeCards: JSON.stringify([...got, mc.card.id]) });
  return { cardId: mc.card.id, name: mc.card.Name, imageId: firstAttachment(mc.card.Image), serialNumber: serial, mode: mc.key };
}

// ------------------------------------------------------------------ taxe de luxe (Hard)
const POT = 'luxuryPot';
function potState(store) {
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === POT) : null;
  return { row, value: row ? parseJson(row.Value, {}) : {} };
}
function potSave(store, value) {
  const { row } = potState(store);
  if (row) store.update('AppSettings', row.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: POT, Value: JSON.stringify(value) });
}
function averageWealth(store) {
  const since = now() - 14 * 86400;
  const users = store.getAll('Users').filter((u) => (Number(u.LastSeenAt) || 0) >= since);
  return users.length ? users.reduce((s, u) => s + (Number(u.StardustCount) || 0), 0) / users.length : 0;
}
// Multiplicateur de taxe d'un joueur (1, ou 1,5 s'il est plus riche que la moyenne en Hard).
export function luxuryFactor(store, user) {
  if (!user || !ruleOn(store, 'hard.luxuryTax')) return 1;
  return (Number(user.StardustCount) || 0) > averageWealth(store) ? setting(store, 'LuxuryTaxMultiplier') : 1;
}
export function addToPot(store, amount) {
  if (!(amount > 0)) return;
  const v = potState(store).value;
  const week = weekKey();
  potSave(store, { week: v.week || week, amount: (Number(v.amount) || 0) + Math.round(amount) });
}
// Redistribution chaque lundi (premiere requete de la semaine).
let potChecked = null;
export function beforeRequest({ store }) {
  setExtraLucky(ruleOn(store, 'chill.luckyHours'));
  const week = weekKey();
  if (potChecked === week || !store.tables.has('AppSettings')) return;
  potChecked = week;
  const v = potState(store).value;
  if (!v.week || v.week === week || !(Number(v.amount) > 0)) return;
  const since = now() - 7 * 86400;
  const active = store.getAll('Users').filter((u) => (Number(u.LastSeenAt) || 0) >= since);
  const share = active.length ? Math.floor(v.amount / active.length) : 0;
  if (share > 0) {
    active.forEach((u) => store.update('Users', u.id, { StardustCount: (Number(u.StardustCount) || 0) + share }));
    addFeed(store, { kind: 'luxury', icon: '💸', text: `Taxe de luxe : ${v.amount} poussières redistribuées, ${share} pour chacun des ${active.length} joueurs actifs !` });
  }
  potSave(store, { week, amount: 0 });
}

export const routes = { 'POST decraft-undo': handleUndo, 'POST weekly-goal': handleGoal };
