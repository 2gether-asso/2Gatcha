// La salle des machines (2026-10-14) : jeu mensuel de la page Communaute,
// fait pour bruler un maximum de ressources. Une fois par mois et par joueur :
// ouvrir la salle (20 cles), puis allumer la chaudiere, graisser les
// engrenages, alimenter le generateur et calibrer la machine, chaque etape
// demandant un nouveau sacrifice. Au bout : un vote pour la difficulte du jeu.
// Par defaut (MachineVoteDay = 0) la salle et le vote restent ouverts tout le
// mois et le mode le plus vote s'applique le 1er du mois suivant. Avec
// MachineVoteDay = 1 a 28, le vote se ferme a la fin de ce jour et le mode
// gagnant s'applique aussitot jusqu'a la fin du mois (presets.js).
// Suite (2026-10-15) :
//  - jauge commune : MachinePressureGoal salles terminees dans le mois ->
//    1 booster le 1er du mois suivant pour chaque participant ;
//  - etape 6 facultative "Surchauffe" : le vote compte double ;
//  - chef mecanicien : le plus gros sacrifice du mois, titre et cadre
//    jusqu'au mois suivant ;
//  - assiduite : 3 mois d'affilee -> carte promo (MachineLoyaltyCard) ;
//  - second vote : l'evenement du mois prochain (planifie tout seul) ;
//  - porte ouverte = fragment de la carte fantome (phantom.js).
//   POST /webhook/machine-room { userId, action: 'status' | 'advance' | 'vote' | 'voteEvent', mode?, event? }

import { refId, now, ok, fail, userById, parseJson, parisDay } from './common.js';
import { setting } from './settings.js';
import { seasonId, seasonEnd } from './seasons.js';
import { parisEpoch } from './daily.js';
import { applyPreset, currentMode, MODE_KEYS, PRESET_INFO } from './presets.js';
import { addFeed } from './feed.js';
import { grantCosmetic } from './cosmetics.js';
import { setMachineLeader } from './modeextras.js';
import { grantFragment } from './phantom.js';

export const schema = {
  Users: {
    MachineMonth: { type: 'Text' }, MachineStage: { type: 'Numeric' }, MachineVote: { type: 'Text' },
    MachineSpent: { type: 'Numeric' }, MachineHistory: { type: 'Text' }, MachineLoyaltyAt: { type: 'Text' }, MachineEventVote: { type: 'Text' }
  }
};

const MODES = MODE_KEYS;
const label = (k) => `${PRESET_INFO[k].icon} ${PRESET_INFO[k].label}`;
const KEY = 'machineRoom';
const SETTLED = 'machineSettled';
const CHIEF = 'machineChief';
const MAIN_STAGES = 5;

// Evenements proposes au second vote (memes reglages que les modeles de l'admin).
export const EVENT_OPTIONS = [
  { key: 'stars', icon: '✨', label: 'Week-end des étoiles', dust: 2, finish: 1.5, fishing: 1, worms: 1 },
  { key: 'fishing', icon: '🎣', label: 'Week-end de la pêche', dust: 1, finish: 1, fishing: 2, worms: 1.5 },
  { key: 'worms', icon: '🪱', label: 'Chasse aux vers', dust: 1, finish: 1, fishing: 1, worms: 3 },
  { key: 'finish', icon: '🌈', label: 'Nuit des finitions', dust: 1, finish: 2.5, fishing: 1, worms: 1 }
];

// Valeur d'une unite sacrifiee (classement du chef mecanicien).
const WORTH = { KeyCount: 10, StardustCount: 1, Worms: 5, SpareParts: 20, GoldBait: 30, BoosterCount: 100, cards: 15, legendary: 300 };

// Etapes : ressources a sacrifier (quantites reglables : MachineRoomCosts, MachineOverheatCosts).
function stages(store) {
  const c = setting(store, 'MachineRoomCosts');
  const o = setting(store, 'MachineOverheatCosts');
  return [
    { key: 'door', icon: '🚪', label: 'Ouvrir la salle', story: 'La porte blindée ne cède qu’à un trousseau complet.', cost: [{ field: 'KeyCount', n: c.keys, label: 'clés', icon: '🔑' }] },
    { key: 'boiler', icon: '🔥', label: 'Allumer la chaudière', story: 'Il faut de la poussière d’étoile pour le feu et des vers pour… on ne pose pas de questions.', cost: [{ field: 'StardustCount', n: c.dust, label: 'poussières', icon: '✨' }, { field: 'Worms', n: c.worms, label: 'vers de terre', icon: '🪱' }] },
    { key: 'gears', icon: '⚙️', label: 'Graisser les engrenages', story: 'Les rouages grincent : pièces détachées et appâts dorés fondus en graisse.', cost: [{ field: 'SpareParts', n: c.parts, label: 'pièces détachées', icon: '🔩' }, { field: 'GoldBait', n: c.bait, label: 'appâts dorés', icon: '🪝' }] },
    { key: 'generator', icon: '⚡', label: 'Alimenter le générateur', story: 'Le générateur se nourrit de jetons booster.', cost: [{ field: 'BoosterCount', n: c.boosters, label: 'boosters', icon: '🃏' }] },
    { key: 'calibrate', icon: '🎛️', label: 'Calibrer la machine', story: 'Pour l’étalonnage, la machine avale des cartes en double (jamais un #001, une arc-en-ciel, un parfait état, une édition limitée ni un exemplaire protégé).', cost: [{ field: 'cards', n: c.cards, label: 'cartes en double', icon: '🎴' }] },
    { key: 'overheat', icon: '🌋', optional: true, label: 'Surchauffe (facultatif)', story: 'Pousser la machine au-delà de ses limites : ton vote comptera double.', cost: [{ field: 'BoosterCount', n: o.boosters, label: 'boosters', icon: '🃏' }, { field: 'legendary', n: o.legendary, label: 'légendaire en double (ou mieux)', icon: '🌟' }] }
  ];
}

const month = () => seasonId();
const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
const voteDay = (store) => Math.min(28, Math.max(0, Number(setting(store, 'MachineVoteDay')) || 0));
// Fin du vote : fin du mois (0) ou fin de la journee MachineVoteDay (heure de Paris).
function voteClose(store, m = month()) {
  const day = voteDay(store);
  if (!day) return seasonEnd(m);
  return parisEpoch(`${m}-${String(day).padStart(2, '0')}`, 0) + 86400;
}

// Doublons sacrifiables : exemplaires en trop (on garde le meilleur de chaque carte).
function sacrificable(store, userId, { minRank = null } = {}) {
  const QUALITY = ['damaged', 'worn', 'good', 'mint'];
  const rank = new Map(store.getAll('Rarities').map((r) => [r.id, Number(r.SortOrder) || 0]));
  const cards = new Map(store.getAll('Cards').map((c) => [c.id, c]));
  const mine = store.getAll('Pulls').filter((p) => refId(p.User) === userId);
  const byCard = new Map();
  mine.forEach((p) => { const k = refId(p.Card); if (!byCard.has(k)) byCard.set(k, []); byCard.get(k).push(p); });
  const out = [];
  for (const [cardId, list] of byCard) {
    if (list.length < 2) continue;
    if (minRank != null && (rank.get(refId((cards.get(cardId) || {}).Rarity)) || 0) < minRank) continue;
    const ok = list.filter((p) => p.SerialNumber !== 1 && !p.Insured && !p.Starred && !p.InVault && !p.ForgedInFire && !p.Edition && (p.Finish || 'normal') !== 'rainbow' && (p.Quality || 'damaged') !== 'mint')
      .sort((a, b) => QUALITY.indexOf(a.Quality || 'damaged') - QUALITY.indexOf(b.Quality || 'damaged') || (b.SerialNumber || 0) - (a.SerialNumber || 0));
    out.push(...ok.slice(0, list.length - 1));
  }
  return out;
}
function legendaryRank(store) {
  const r = store.getAll('Rarities').find((x) => x.Key === 'legendaire');
  return r ? Number(r.SortOrder) || 0 : Infinity;
}
function pool(store, userId, field) {
  if (field === 'cards') return sacrificable(store, userId);
  if (field === 'legendary') return sacrificable(store, userId, { minRank: legendaryRank(store) });
  return null;
}

const have = (store, user, item) => { const p = pool(store, user.id, item.field); return p ? p.length : Number(user[item.field]) || 0; };
const progressOf = (user, m = month()) => (user.MachineMonth === m
  ? { stage: Number(user.MachineStage) || 0, vote: user.MachineVote || null, eventVote: user.MachineEventVote || null, spent: Number(user.MachineSpent) || 0 }
  : { stage: 0, vote: null, eventVote: null, spent: 0 });

// Votes du mois (la surchauffe compte double).
function tally(store, m = month()) {
  const votes = Object.fromEntries(MODES.map((k) => [k, 0]));
  let voters = 0;
  store.getAll('Users').forEach((u) => {
    if (u.MachineMonth !== m || !MODES.includes(u.MachineVote)) return;
    votes[u.MachineVote] += (Number(u.MachineStage) || 0) > MAIN_STAGES ? 2 : 1;
    voters++;
  });
  return { votes, voters };
}
function tallyEvents(store, m = month()) {
  const votes = Object.fromEntries(EVENT_OPTIONS.map((e) => [e.key, 0]));
  store.getAll('Users').forEach((u) => { if (u.MachineMonth === m && votes[u.MachineEventVote] != null) votes[u.MachineEventVote]++; });
  return votes;
}
// Egalite : le mode le plus "neutre" l'emporte.
const ORDER = ['medium', 'chill', 'hard', 'cool', 'chaos'];
function winnerOf(votes) {
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const keys = [...ORDER.filter((k) => k in votes), ...Object.keys(votes).filter((k) => !ORDER.includes(k))];
  return keys.reduce((best, k) => (votes[k] > votes[best] ? k : best), keys[0]);
}
const finishers = (store, m) => store.getAll('Users').filter((u) => u.MachineMonth === m && (Number(u.MachineStage) || 0) >= MAIN_STAGES).length;

function appRead(store, key) {
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === key) : null;
  return row ? parseJson(row.Value, {}) : {};
}
function appSave(store, key, value) {
  const row = store.getAll('AppSettings').find((r) => r.Key === key);
  if (row) store.update('AppSettings', row.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: key, Value: JSON.stringify(value) });
}
const roomState = (store) => appRead(store, KEY);

// Mode en tete du vote du mois et heure de fermeture (preavis, modeextras.js).
export function leader(store) {
  const m = month();
  return { winner: winnerOf(tally(store, m).votes), closeAt: voteClose(store, m) };
}
setMachineLeader((store) => (setting(store, 'MachineRoomEnabled') ? leader(store) : null));

function stateOf(store, user) {
  const list = stages(store);
  const p = progressOf(user);
  const close = voteClose(store);
  const open = !!setting(store, 'MachineRoomEnabled') && now() < close;
  const { votes, voters } = tally(store);
  const rs = roomState(store);
  const goal = setting(store, 'MachinePressureGoal');
  const hist = parseJson(user.MachineHistory, []);
  const chief = appRead(store, CHIEF);
  const top = store.getAll('Users').filter((u) => u.MachineMonth === month() && (Number(u.MachineSpent) || 0) > 0)
    .sort((a, b) => (Number(b.MachineSpent) || 0) - (Number(a.MachineSpent) || 0)).slice(0, 3)
    .map((u) => ({ userId: u.id, pseudo: u.Pseudo, spent: Number(u.MachineSpent) || 0 }));
  return {
    month: month(), open, voteClosesAt: close, monthEndsAt: seasonEnd(month()), appliesNextMonth: !voteDay(store),
    stage: p.stage, vote: p.vote, done: p.stage >= MAIN_STAGES, overheated: p.stage > MAIN_STAGES, spent: p.spent,
    stages: list.map((s, i) => ({
      key: s.key, icon: s.icon, label: s.label, story: s.story, optional: !!s.optional, done: i < p.stage, current: i === p.stage,
      cost: s.cost.map((c) => ({ label: c.label, icon: c.icon, need: c.n, have: have(store, user, c) }))
    })),
    votes, voters,
    modes: MODES.map((k) => ({ key: k, label: label(k) })),
    current: currentMode(store).key,
    result: rs.month === month() ? rs : null,
    lastResult: rs.month && rs.month !== month() ? rs : null,
    pressure: { goal, finished: finishers(store, month()), reached: goal > 0 && finishers(store, month()) >= goal },
    chief: { holder: chief.userId ? { userId: chief.userId, pseudo: (store.get('Users', chief.userId) || {}).Pseudo || '?', month: chief.month } : null, top },
    loyalty: { months: [month(), prevMonth(month()), prevMonth(prevMonth(month()))].filter((m) => hist.includes(m)).length, needed: 3, card: Number(setting(store, 'MachineLoyaltyCard')) || 0 },
    eventVote: setting(store, 'MachineEventVote') ? { options: EVENT_OPTIONS.map(({ key, icon, label: l }) => ({ key, icon, label: l })), votes: tallyEvents(store), mine: p.eventVote } : null
  };
}

function nextSerial(store, cardId) {
  const used = new Set(store.getAll('Pulls').filter((p) => refId(p.Card) === cardId).map((p) => p.SerialNumber));
  let n = 1; while (used.has(n)) n++;
  return n;
}
// Assiduite : 3 mois d'affilee a terminer la salle -> carte promo (ou 3 boosters).
function loyalty(store, user) {
  const m = month(), p1 = prevMonth(m), p2 = prevMonth(p1);
  const hist = [...new Set([...parseJson(user.MachineHistory, []), m])].slice(-24);
  const fields = { MachineHistory: JSON.stringify(hist) };
  let reward = null;
  if ([m, p1, p2].every((x) => hist.includes(x)) && !(user.MachineLoyaltyAt && user.MachineLoyaltyAt >= p2)) {
    fields.MachineLoyaltyAt = m;
    const cardId = Number(setting(store, 'MachineLoyaltyCard')) || 0;
    const card = cardId ? store.get('Cards', cardId) : null;
    if (card) {
      store.create('Pulls', { User: user.id, Card: card.id, SerialNumber: nextSerial(store, card.id), Finish: 'normal', Quality: 'mint', ObtainedAt: now(), BatchId: `machine-loyalty-${m}-${user.id}` });
      reward = `la carte ${card.Name}`;
    } else {
      fields.BoosterCount = (Number(user.BoosterCount) || 0) + 3;
      reward = '3 jetons booster';
    }
    addFeed(store, { userId: user.id, kind: 'machine', icon: '⚙️', text: `fait tourner la salle des machines 3 mois d’affilée et gagne ${reward} !` });
  }
  return { fields, reward };
}

function handleMachine({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(stateOf(store, user));
  const st = stateOf(store, user);
  if (!st.open) return fail('room_closed', 400, st);
  const list = stages(store);
  if (action === 'advance') {
    if (st.stage >= list.length) return fail('already_done', 400, st);
    const stage = list[st.stage];
    const missing = stage.cost.filter((c) => have(store, user, c) < c.n);
    if (missing.length) return fail('not_enough', 400, { ...st, missing: missing.map((c) => c.label) });
    let spent = 0;
    const fields = { MachineMonth: month(), MachineStage: st.stage + 1 };
    if (st.stage === 0) Object.assign(fields, { MachineVote: '', MachineEventVote: '' });
    for (const c of stage.cost) {
      const p = pool(store, user.id, c.field);
      if (p) p.slice(0, c.n).forEach((pull) => store.delete('Pulls', pull.id));
      else fields[c.field] = (Number(user[c.field]) || 0) - c.n;
      spent += (WORTH[c.field] || 1) * c.n;
    }
    fields.MachineSpent = (st.stage === 0 ? 0 : st.spent) + spent;
    const extra = {};
    if (st.stage + 1 === MAIN_STAGES) {
      const l = loyalty(store, user);
      Object.assign(fields, l.fields);
      if (l.reward) extra.loyaltyReward = l.reward;
      addFeed(store, { userId: user.id, kind: 'machine', icon: '⚙️', text: 'a remis en marche la salle des machines et peut voter pour la difficulté du mois !' });
    }
    if (stage.optional) addFeed(store, { userId: user.id, kind: 'machine', icon: '🌋', text: 'pousse la salle des machines en surchauffe : son vote comptera double !' });
    user = store.update('Users', user.id, fields);
    if (st.stage === 0) { const n = grantFragment(store, user.id, 'machine'); if (n) extra.phantom = n.label; }
    return ok({ ...stateOf(store, store.get('Users', user.id)), advanced: stage.key, ...extra });
  }
  if (action === 'vote') {
    if (!st.done) return fail('room_not_finished', 400, st);
    if (st.vote) return fail('already_voted', 400, st);
    if (!MODES.includes(body.mode)) return fail('invalid_mode');
    user = store.update('Users', user.id, { MachineVote: body.mode });
    return ok({ ...stateOf(store, user), voted: body.mode });
  }
  if (action === 'voteEvent') {
    if (!setting(store, 'MachineEventVote')) return fail('event_vote_closed');
    if (!st.done) return fail('room_not_finished', 400, st);
    if (st.eventVote && st.eventVote.mine) return fail('already_voted', 400, st);
    if (!EVENT_OPTIONS.some((e) => e.key === body.event)) return fail('invalid_event');
    user = store.update('Users', user.id, { MachineEventVote: body.event });
    return ok({ ...stateOf(store, user), votedEvent: body.event });
  }
  return fail('unknown_action');
}

// ------------------------------------------------------------------ fin du vote et du mois
let checked = null;
export function beforeRequest({ store }) {
  const key = month() + ':' + Math.floor(now() / 600);
  if (checked === key || !store.tables.has('AppSettings') || !setting(store, 'MachineRoomEnabled')) return;
  checked = key;
  // Mois precedent d'abord (vote ouvert tout le mois), puis mois en cours si le vote ferme tot.
  for (const m of [prevMonth(month()), month()]) {
    const done = roomState(store).month;
    if (now() >= voteClose(store, m) && !(done && done >= m)) closeVote(store, m);
  }
  const settled = appRead(store, SETTLED).month;
  const prev = prevMonth(month());
  if (!(settled && settled >= prev)) settleMonth(store, prev);
}

function closeVote(store, m) {
  const { votes, voters } = tally(store, m);
  const winner = winnerOf(votes);
  appSave(store, KEY, { month: m, at: now(), votes, voters, winner });
  if (!winner) return;
  applyPreset(store, winner, 'machine-room');
  const until = m === month() ? 'jusqu’à la fin du mois' : 'pour ce mois-ci';
  addFeed(store, { kind: 'machine', icon: '⚙️', text: `La salle des machines a parlé : mode ${label(winner)} ${until} (${votes[winner]} voix sur ${Object.values(votes).reduce((a, b) => a + b, 0)}).` });
}

// 2e week-end du mois en cours : vendredi 18 h -> dimanche minuit.
function secondWeekend() {
  const m = month();
  let saturdays = 0;
  for (let d = 1; d <= 14; d++) {
    const day = `${m}-${String(d).padStart(2, '0')}`;
    if (new Date(day + 'T12:00:00Z').getUTCDay() === 6 && ++saturdays === 2) {
      const friday = parisDay(-1, Date.parse(day + 'T12:00:00Z'));
      const monday = parisDay(2, Date.parse(day + 'T12:00:00Z'));
      return { start: parisEpoch(friday, 18), end: parisEpoch(monday, 0) };
    }
  }
  return null;
}

// Bilan du mois ecoule : jauge commune, chef mecanicien, evenement vote.
function settleMonth(store, m) {
  appSave(store, SETTLED, { month: m, at: now() });
  const users = store.getAll('Users').filter((u) => u.MachineMonth === m);
  // Jauge commune.
  const goal = setting(store, 'MachinePressureGoal');
  const n = users.filter((u) => (Number(u.MachineStage) || 0) >= MAIN_STAGES).length;
  if (goal > 0 && n >= goal) {
    const players = users.filter((u) => (Number(u.MachineStage) || 0) >= 1);
    players.forEach((u) => store.update('Users', u.id, { BoosterCount: (Number(store.get('Users', u.id).BoosterCount) || 0) + 1 }));
    addFeed(store, { kind: 'machine', icon: '⚙️', text: `Jauge de la salle des machines remplie (${n}/${goal}) : ${players.length} participant${players.length > 1 ? 's reçoivent' : ' reçoit'} 1 jeton booster !` });
  }
  // Chef mecanicien : titre et cadre jusqu'au mois suivant.
  const best = users.filter((u) => (Number(u.MachineSpent) || 0) > 0).sort((a, b) => (Number(b.MachineSpent) || 0) - (Number(a.MachineSpent) || 0))[0];
  const old = appRead(store, CHIEF);
  if (old.userId && store.tables.has('UserCosmetics') && (!best || old.userId !== best.id)) {
    store.getAll('UserCosmetics').filter((r) => refId(r.User) === old.userId && (r.Key === 'machine-chief' || r.Key === 'frame-gears')).forEach((r) => store.delete('UserCosmetics', r.id));
    const u = store.get('Users', old.userId);
    if (u) store.update('Users', u.id, { ...(u.EquippedTitle === 'machine-chief' ? { EquippedTitle: '' } : {}), ...(u.EquippedFrame === 'frame-gears' ? { EquippedFrame: '' } : {}) });
  }
  if (best) {
    grantCosmetic(store, best.id, 'machine-chief', { type: 'title', label: 'Chef mécanicien ⚙️' });
    grantCosmetic(store, best.id, 'frame-gears', { type: 'frame', label: 'Cadre engrenage' });
    appSave(store, CHIEF, { month: m, userId: best.id });
    addFeed(store, { userId: best.id, kind: 'machine', icon: '⚙️', text: `devient Chef mécanicien pour le plus gros sacrifice du mois (${(Number(best.MachineSpent) || 0).toLocaleString('fr-FR')} points) !` });
  } else appSave(store, CHIEF, {});
  // Evenement vote : planifie le 2e week-end du mois.
  if (setting(store, 'MachineEventVote') && store.tables.has('ScheduledEvents')) {
    const winner = winnerOf(tallyEvents(store, m));
    const ev = winner && EVENT_OPTIONS.find((e) => e.key === winner);
    const w = secondWeekend();
    if (ev && w && w.end > now()) {
      store.create('ScheduledEvents', { Label: `${ev.label} (voté en salle des machines)`, StartAt: w.start, EndAt: w.end, Enabled: true, DustMultiplier: ev.dust, FinishMultiplier: ev.finish, FishingRare: ev.fishing, WormsMultiplier: ev.worms });
      addFeed(store, { kind: 'machine', icon: ev.icon, text: `La salle des machines a choisi l’événement du mois : ${ev.label}, le 2e week-end !` });
    }
  }
}

export function _reset() { checked = null; }
export const _settleMonth = settleMonth;
export const routes = { 'POST machine-room': handleMachine };
