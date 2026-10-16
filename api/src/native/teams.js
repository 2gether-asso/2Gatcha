// Guerre des equipes mensuelle (2026-10-15) : 4 equipes de couleur. Chaque
// joueur est place dans la moins nombreuse a sa premiere action du mois ;
// toute activite rapporte des points a son equipe. Le 1er du mois suivant,
// les membres de l'equipe gagnante (au moins 1 point) recoivent un titre.
//   POST /webhook/teams { userId, action: 'status' }

import { now, ok, fail, userById, parseJson } from './common.js';
import { setting } from './settings.js';
import { seasonId, seasonEnd } from './seasons.js';
import { grantCosmetic } from './cosmetics.js';
import { addFeed } from './feed.js';

export const schema = { Users: { TeamMonth: { type: 'Text' }, Team: { type: 'Text' }, TeamPoints: { type: 'Numeric' } } };

export const TEAMS = [
  { key: 'ruby', label: 'Rubis', icon: '🔴', color: '#ef4444' },
  { key: 'sapphire', label: 'Saphir', icon: '🔵', color: '#3b82f6' },
  { key: 'emerald', label: 'Émeraude', icon: '🟢', color: '#22c55e' },
  { key: 'topaz', label: 'Topaze', icon: '🟡', color: '#eab308' }
];
const POINTS = { boosterOpened: 2, fish: 1, board: 3, harvest: 1, bossAttack: 2, expedition: 3, tradeDone: 2, guess: 1, craft: 1, chestOpened: 2, communityDig: 1, wheel: 1, vaultRow: 2 };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };

function members(store, month) {
  return store.getAll('Users').filter((u) => u.TeamMonth === month && TEAMS.some((t) => t.key === u.Team));
}
// Equipe du joueur ce mois-ci (attribuee si besoin) ; renvoie l'utilisateur a jour.
function ensureTeam(store, user, month = seasonId()) {
  if (user.TeamMonth === month && TEAMS.some((t) => t.key === user.Team)) return user;
  const counts = Object.fromEntries(TEAMS.map((t) => [t.key, 0]));
  members(store, month).forEach((u) => counts[u.Team]++);
  const min = Math.min(...Object.values(counts));
  const choices = TEAMS.filter((t) => counts[t.key] === min);
  const team = choices[Math.floor(Math.random() * choices.length)].key;
  return store.update('Users', user.id, { TeamMonth: month, Team: team, TeamPoints: 0 });
}

function totals(store, month) {
  const list = members(store, month);
  return TEAMS.map((t) => {
    const mine = list.filter((u) => u.Team === t.key);
    return {
      ...t, members: mine.length, points: mine.reduce((s, u) => s + (Number(u.TeamPoints) || 0), 0),
      top: mine.filter((u) => (Number(u.TeamPoints) || 0) > 0).sort((a, b) => (Number(b.TeamPoints) || 0) - (Number(a.TeamPoints) || 0)).slice(0, 3).map((u) => ({ userId: u.id, pseudo: u.Pseudo, points: Number(u.TeamPoints) || 0 }))
    };
  });
}

export function onEvents(store, events) {
  if (!setting(store, 'TeamWarEnabled')) return [];
  const month = seasonId();
  for (const e of events) {
    const pts = POINTS[e.type];
    if (!pts) continue;
    let user = store.get('Users', e.userId);
    if (!user) continue;
    user = ensureTeam(store, user, month);
    store.update('Users', user.id, { TeamPoints: (Number(user.TeamPoints) || 0) + pts * (Number(e.n) || 1) });
  }
  return [];
}

const RESULT = 'teamWar';
function lastResult(store) {
  const r = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === RESULT) : null;
  return r ? parseJson(r.Value, null) : null;
}

function handleTeams({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const month = seasonId();
  if (setting(store, 'TeamWarEnabled')) user = ensureTeam(store, user, month);
  const list = totals(store, month).sort((a, b) => b.points - a.points);
  return ok({
    enabled: !!setting(store, 'TeamWarEnabled'), month, monthLabel: monthLabel(month), endsAt: seasonEnd(month),
    myTeam: user.Team && user.TeamMonth === month ? user.Team : null, myPoints: user.TeamMonth === month ? Number(user.TeamPoints) || 0 : 0,
    teams: list, points: POINTS, last: lastResult(store)
  });
}

// Fin du mois : l'equipe gagnante du mois precedent recoit son titre.
let checked = null;
export function beforeRequest({ store }) {
  const month = seasonId();
  if (checked === month || !store.tables.has('AppSettings')) return;
  checked = month;
  const prev = prevMonth(month);
  const last = lastResult(store);
  if (last && last.month >= prev) return;
  const list = totals(store, prev).sort((a, b) => b.points - a.points);
  const value = { month: prev, at: now(), teams: list.map(({ key, label, icon, points, members: n }) => ({ key, label, icon, points, members: n })), winner: null };
  if (list[0] && list[0].points > 0) {
    const win = list[0];
    value.winner = win.key;
    members(store, prev).filter((u) => u.Team === win.key && (Number(u.TeamPoints) || 0) > 0)
      .forEach((u) => grantCosmetic(store, u.id, `team-${win.key}-${prev}`, { type: 'title', label: `Champion ${win.label} ${win.icon} (${monthLabel(prev)})` }));
    addFeed(store, { kind: 'teams', icon: win.icon, text: `L’équipe ${win.label} remporte la guerre des équipes de ${monthLabel(prev)} avec ${win.points.toLocaleString('fr-FR')} points !` });
  }
  const r = store.getAll('AppSettings').find((x) => x.Key === RESULT);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: RESULT, Value: JSON.stringify(value) });
}

export function _reset() { checked = null; }
export const routes = { 'POST teams': handleTeams };
