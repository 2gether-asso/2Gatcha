// Guerre des equipes mensuelle (2026-10-15) : 4 equipes de couleur. Chaque
// joueur est place a sa premiere action du mois ; toute activite rapporte des
// points a son equipe. Le 1er du mois suivant, l'equipe gagnante est recompensee.
// Reequilibrage (2026-10-18) :
//  - bareme reglable (TeamPointsTable) ;
//  - plafond de points par joueur et par jour (TeamDailyCap) : un seul gros
//    joueur ne porte plus son equipe ;
//  - placement dans l'equipe la moins "forte" (activite connue de ses membres :
//    points du mois en cours ou du mois precedent, 10 au minimum), pas
//    seulement la moins nombreuse ;
//  - classement au score corrige de la taille (points x taille moyenne /
//    membres) : une equipe plus nombreuse n'est plus avantagee d'office ;
//  - recompenses : titre + TeamWinDust pour les gagnants actifs, et
//    TeamParticipationDust pour les autres joueurs actifs (au moins
//    TeamMinPoints points dans le mois).
//   POST /webhook/teams { userId, action: 'status' }

import { now, ok, fail, userById, parseJson, parisDay } from './common.js';
import { setting } from './settings.js';
import { seasonId, seasonEnd } from './seasons.js';
import { grantCosmetic } from './cosmetics.js';
import { addFeed } from './feed.js';

export const schema = { Users: { TeamMonth: { type: 'Text' }, Team: { type: 'Text' }, TeamPoints: { type: 'Numeric' }, TeamLastPoints: { type: 'Numeric' }, TeamDay: { type: 'Text' }, TeamDayPoints: { type: 'Numeric' } } };

export const TEAMS = [
  { key: 'ruby', label: 'Rubis', icon: '🔴', color: '#ef4444' },
  { key: 'sapphire', label: 'Saphir', icon: '🔵', color: '#3b82f6' },
  { key: 'emerald', label: 'Émeraude', icon: '🟢', color: '#22c55e' },
  { key: 'topaz', label: 'Topaze', icon: '🟡', color: '#eab308' }
];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
const pointsTable = (store) => setting(store, 'TeamPointsTable') || {};

function members(store, month) {
  return store.getAll('Users').filter((u) => u.TeamMonth === month && TEAMS.some((t) => t.key === u.Team));
}
// Force estimee d'un joueur : son activite connue (10 au minimum).
const strength = (u, month) => Math.max(10, u.TeamMonth === month ? Number(u.TeamPoints) || 0 : 0, Number(u.TeamLastPoints) || 0);

// Equipe du joueur ce mois-ci (attribuee si besoin) ; renvoie l'utilisateur a jour.
function ensureTeam(store, user, month = seasonId()) {
  if (user.TeamMonth === month && TEAMS.some((t) => t.key === user.Team)) return user;
  const force = Object.fromEntries(TEAMS.map((t) => [t.key, 0]));
  members(store, month).forEach((u) => { force[u.Team] += strength(u, month); });
  const min = Math.min(...Object.values(force));
  const choices = TEAMS.filter((t) => force[t.key] === min);
  const team = choices[Math.floor(Math.random() * choices.length)].key;
  // Points du mois precedent gardes pour estimer la force au prochain placement.
  const last = user.TeamMonth && user.TeamMonth !== month ? Number(user.TeamPoints) || 0 : Number(user.TeamLastPoints) || 0;
  return store.update('Users', user.id, { TeamMonth: month, Team: team, TeamPoints: 0, TeamLastPoints: last });
}

function totals(store, month) {
  const list = members(store, month);
  const avgSize = list.length / TEAMS.length || 1;
  return TEAMS.map((t) => {
    const mine = list.filter((u) => u.Team === t.key);
    const points = mine.reduce((s, u) => s + (Number(u.TeamPoints) || 0), 0);
    return {
      ...t, members: mine.length, active: mine.filter((u) => (Number(u.TeamPoints) || 0) > 0).length, points,
      score: Math.round(points * avgSize / Math.max(1, mine.length)),
      top: mine.filter((u) => (Number(u.TeamPoints) || 0) > 0).sort((a, b) => (Number(b.TeamPoints) || 0) - (Number(a.TeamPoints) || 0)).slice(0, 3).map((u) => ({ userId: u.id, pseudo: u.Pseudo, points: Number(u.TeamPoints) || 0 }))
    };
  });
}
const ranked = (store, month) => totals(store, month).sort((a, b) => b.score - a.score || b.points - a.points);

export function onEvents(store, events) {
  if (!setting(store, 'TeamWarEnabled')) return [];
  const month = seasonId();
  const table = pointsTable(store);
  const cap = setting(store, 'TeamDailyCap');
  const day = parisDay(0);
  for (const e of events) {
    const pts = Number(table[e.type]) || 0;
    if (pts <= 0) continue;
    let user = store.get('Users', e.userId);
    if (!user) continue;
    user = ensureTeam(store, user, month);
    const today = user.TeamDay === day ? Number(user.TeamDayPoints) || 0 : 0;
    const gain = cap > 0 ? Math.max(0, Math.min(pts * (Number(e.n) || 1), cap - today)) : pts * (Number(e.n) || 1);
    if (!gain) continue;
    store.update('Users', user.id, { TeamPoints: (Number(user.TeamPoints) || 0) + gain, TeamDay: day, TeamDayPoints: today + gain });
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
  const day = parisDay(0);
  return ok({
    enabled: !!setting(store, 'TeamWarEnabled'), month, monthLabel: monthLabel(month), endsAt: seasonEnd(month),
    myTeam: user.Team && user.TeamMonth === month ? user.Team : null, myPoints: user.TeamMonth === month ? Number(user.TeamPoints) || 0 : 0,
    myToday: user.TeamDay === day ? Number(user.TeamDayPoints) || 0 : 0,
    dailyCap: setting(store, 'TeamDailyCap'), minPoints: setting(store, 'TeamMinPoints'),
    winDust: setting(store, 'TeamWinDust'), participationDust: setting(store, 'TeamParticipationDust'),
    teams: ranked(store, month), points: pointsTable(store), last: lastResult(store)
  });
}

// Fin du mois : l'equipe gagnante du mois precedent est recompensee.
let checked = null;
export function beforeRequest({ store }) {
  const month = seasonId();
  if (checked === month || !store.tables.has('AppSettings')) return;
  checked = month;
  const prev = prevMonth(month);
  const last = lastResult(store);
  if (last && last.month >= prev) return;
  const list = ranked(store, prev);
  const value = { month: prev, at: now(), teams: list.map(({ key, label, icon, points, score, members: n }) => ({ key, label, icon, points, score, members: n })), winner: null };
  if (list[0] && list[0].points > 0) {
    const win = list[0];
    value.winner = win.key;
    const minPts = setting(store, 'TeamMinPoints');
    const winDust = setting(store, 'TeamWinDust'), partDust = setting(store, 'TeamParticipationDust');
    members(store, prev).filter((u) => (Number(u.TeamPoints) || 0) >= Math.max(1, minPts)).forEach((u) => {
      const winner = u.Team === win.key;
      if (winner) grantCosmetic(store, u.id, `team-${win.key}-${prev}`, { type: 'title', label: `Champion ${win.label} ${win.icon} (${monthLabel(prev)})` });
      const dust = winner ? winDust : partDust;
      if (dust > 0) store.update('Users', u.id, { StardustCount: (Number(store.get('Users', u.id).StardustCount) || 0) + dust });
    });
    addFeed(store, { kind: 'teams', icon: win.icon, text: `L’équipe ${win.label} remporte la guerre des équipes de ${monthLabel(prev)} avec ${win.score.toLocaleString('fr-FR')} points (score ajusté) !` });
  }
  const r = store.getAll('AppSettings').find((x) => x.Key === RESULT);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: RESULT, Value: JSON.stringify(value) });
}

export function _reset() { checked = null; }
export const routes = { 'POST teams': handleTeams };
