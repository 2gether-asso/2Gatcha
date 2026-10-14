// La salle des machines (2026-10-14) : jeu mensuel de la page Communaute,
// fait pour bruler un maximum de ressources. Une fois par mois et par joueur :
// ouvrir la salle (20 cles), puis allumer la chaudiere, graisser les
// engrenages, alimenter le generateur et calibrer la machine, chaque etape
// demandant un nouveau sacrifice. Au bout : un vote pour la difficulte du jeu.
// Le vote se ferme le MachineVoteDay du mois (fin de journee) ; le mode le
// plus vote est applique tout seul jusqu'a la fin du mois (presets.js).
//   POST /webhook/machine-room { userId, action: 'status' | 'advance' | 'vote', mode? }

import { refId, now, ok, fail, userById } from './common.js';
import { setting } from './settings.js';
import { seasonId, seasonEnd } from './seasons.js';
import { parisEpoch } from './daily.js';
import { applyPreset, currentMode } from './presets.js';
import { addFeed } from './feed.js';

export const schema = {
  Users: { MachineMonth: { type: 'Text' }, MachineStage: { type: 'Numeric' }, MachineVote: { type: 'Text' } }
};

const MODES = ['cool', 'chill', 'medium', 'hard'];
const MODE_LABEL = { cool: '😎 Cool', chill: '🌴 Chill', medium: '⚖️ Medium', hard: '🔥 Hard' };
const KEY = 'machineRoom';

// Etapes : ressources a sacrifier (quantites reglables : MachineRoomCosts).
function stages(store) {
  const c = setting(store, 'MachineRoomCosts');
  return [
    { key: 'door', icon: '🚪', label: 'Ouvrir la salle', story: 'La porte blindée ne cède qu’à un trousseau complet.', cost: [{ field: 'KeyCount', n: c.keys, label: 'clés', icon: '🔑' }] },
    { key: 'boiler', icon: '🔥', label: 'Allumer la chaudière', story: 'Il faut de la poussière d’étoile pour le feu et des vers pour… on ne pose pas de questions.', cost: [{ field: 'StardustCount', n: c.dust, label: 'poussières', icon: '✨' }, { field: 'Worms', n: c.worms, label: 'vers de terre', icon: '🪱' }] },
    { key: 'gears', icon: '⚙️', label: 'Graisser les engrenages', story: 'Les rouages grincent : pièces détachées et appâts dorés fondus en graisse.', cost: [{ field: 'SpareParts', n: c.parts, label: 'pièces détachées', icon: '🔩' }, { field: 'GoldBait', n: c.bait, label: 'appâts dorés', icon: '🪝' }] },
    { key: 'generator', icon: '⚡', label: 'Alimenter le générateur', story: 'Le générateur se nourrit de boosters encore scellés.', cost: [{ field: 'BoosterCount', n: c.boosters, label: 'boosters', icon: '🃏' }] },
    { key: 'calibrate', icon: '🎛️', label: 'Calibrer la machine', story: 'Pour l’étalonnage, la machine avale des cartes en double (jamais un #001, une arc-en-ciel, un parfait état ni un exemplaire protégé).', cost: [{ field: 'cards', n: c.cards, label: 'cartes en double', icon: '🎴' }] }
  ];
}

const month = () => seasonId();
// Fin du vote : fin de la journee MachineVoteDay du mois (heure de Paris).
function voteClose(store, m = month()) {
  const day = String(Math.min(28, Math.max(1, setting(store, 'MachineVoteDay')))).padStart(2, '0');
  return parisEpoch(`${m}-${day}`, 0) + 86400;
}

// Doublons sacrifiables : exemplaires en trop (on garde le meilleur de chaque carte).
function sacrificable(store, userId) {
  const QUALITY = ['damaged', 'worn', 'good', 'mint'];
  const mine = store.getAll('Pulls').filter((p) => refId(p.User) === userId);
  const byCard = new Map();
  mine.forEach((p) => { const k = refId(p.Card); if (!byCard.has(k)) byCard.set(k, []); byCard.get(k).push(p); });
  const out = [];
  for (const list of byCard.values()) {
    if (list.length < 2) continue;
    const ok = list.filter((p) => p.SerialNumber !== 1 && !p.Insured && !p.Starred && !p.InVault && !p.ForgedInFire && (p.Finish || 'normal') !== 'rainbow' && (p.Quality || 'damaged') !== 'mint')
      .sort((a, b) => QUALITY.indexOf(a.Quality || 'damaged') - QUALITY.indexOf(b.Quality || 'damaged') || (b.SerialNumber || 0) - (a.SerialNumber || 0));
    out.push(...ok.slice(0, list.length - 1));
  }
  return out;
}

const have = (store, user, item) => (item.field === 'cards' ? sacrificable(store, user.id).length : Number(user[item.field]) || 0);
const progressOf = (user) => (user.MachineMonth === month() ? { stage: Number(user.MachineStage) || 0, vote: user.MachineVote || null } : { stage: 0, vote: null });

function tally(store) {
  const m = month();
  const votes = Object.fromEntries(MODES.map((k) => [k, 0]));
  store.getAll('Users').forEach((u) => { if (u.MachineMonth === m && MODES.includes(u.MachineVote)) votes[u.MachineVote]++; });
  return votes;
}
function roomState(store) {
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === KEY) : null;
  try { return row ? JSON.parse(row.Value) : {}; } catch (e) { return {}; }
}

function stateOf(store, user) {
  const list = stages(store);
  const p = progressOf(user);
  const close = voteClose(store);
  const open = !!setting(store, 'MachineRoomEnabled') && now() < close;
  const votes = tally(store);
  const rs = roomState(store);
  return {
    month: month(), open, voteClosesAt: close, monthEndsAt: seasonEnd(month()),
    stage: p.stage, vote: p.vote, done: p.stage >= list.length,
    stages: list.map((s, i) => ({
      key: s.key, icon: s.icon, label: s.label, story: s.story, done: i < p.stage, current: i === p.stage,
      cost: s.cost.map((c) => ({ label: c.label, icon: c.icon, need: c.n, have: have(store, user, c) }))
    })),
    votes, voters: Object.values(votes).reduce((a, b) => a + b, 0),
    modes: MODES.map((k) => ({ key: k, label: MODE_LABEL[k] })),
    current: currentMode(store).key,
    result: rs.month === month() ? rs : null,
    lastResult: rs.month && rs.month !== month() ? rs : null
  };
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
    if (st.done) return fail('already_done', 400, st);
    const stage = list[st.stage];
    const missing = stage.cost.filter((c) => have(store, user, c) < c.n);
    if (missing.length) return fail('not_enough', 400, { ...st, missing: missing.map((c) => c.label) });
    const fields = { MachineMonth: month(), MachineStage: st.stage + 1 };
    for (const c of stage.cost) {
      if (c.field === 'cards') sacrificable(store, user.id).slice(0, c.n).forEach((pull) => store.delete('Pulls', pull.id));
      else fields[c.field] = (Number(user[c.field]) || 0) - c.n;
    }
    user = store.update('Users', user.id, fields);
    if (st.stage + 1 === list.length) addFeed(store, { userId: user.id, kind: 'machine', icon: '⚙️', text: 'a remis en marche la salle des machines et peut voter pour la difficulté du mois !' });
    return ok({ ...stateOf(store, user), advanced: stage.key });
  }
  if (action === 'vote') {
    if (!st.done) return fail('room_not_finished', 400, st);
    if (st.vote) return fail('already_voted', 400, st);
    if (!MODES.includes(body.mode)) return fail('invalid_mode');
    user = store.update('Users', user.id, { MachineVote: body.mode });
    return ok({ ...stateOf(store, user), voted: body.mode });
  }
  return fail('unknown_action');
}

// Fin du vote : le mode le plus vote est applique jusqu'a la fin du mois.
let checked = null;
export function beforeRequest({ store }) {
  const m = month();
  const key = m + ':' + Math.floor(now() / 600);
  if (checked === key || !store.tables.has('AppSettings') || !setting(store, 'MachineRoomEnabled')) return;
  checked = key;
  if (now() < voteClose(store, m) || roomState(store).month === m) return;
  const votes = tally(store);
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  // Egalite : le mode le plus "neutre" l'emporte.
  const order = ['medium', 'chill', 'hard', 'cool'];
  const winner = total ? order.reduce((best, k) => (votes[k] > votes[best] ? k : best), order[0]) : null;
  const value = JSON.stringify({ month: m, at: now(), votes, voters: total, winner });
  const row = store.getAll('AppSettings').find((r) => r.Key === KEY);
  if (row) store.update('AppSettings', row.id, { Value: value }); else store.create('AppSettings', { Key: KEY, Value: value });
  if (!winner) return;
  applyPreset(store, winner, 'machine-room');
  addFeed(store, { kind: 'machine', icon: '⚙️', text: `La salle des machines a parlé : mode ${MODE_LABEL[winner]} jusqu’à la fin du mois (${votes[winner]} vote${votes[winner] > 1 ? 's' : ''} sur ${total}).` });
}

export function _reset() { checked = null; }
export const routes = { 'POST machine-room': handleMachine };
