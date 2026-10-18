// Grand Chantier (2026-10-18) : jeu commun de la semaine (onglet Ensemble, a
// la place de la grande fouille). Tout le serveur construit un phare en 5
// etapes (reglage GuildWorksStages) en apportant des ressources gagnees dans
// les autres jeux : poussieres, vers, os, pieces detachees, appats, mineraux
// (par palier) et doublons de cartes (par rarete).
//  - Objectifs proportionnels aux joueurs actifs des 7 derniers jours (3 au
//    minimum) : le chantier doit tenir la semaine.
//  - Un joueur apporte au plus GuildWorksPlayerShare de chaque ressource d'une
//    etape : il faut s'y mettre a plusieurs.
//  - Etape terminee : chaque contributeur de l'etape recoit sa recompense.
//    Phare termine avant la fin de la semaine : NG+1 (niveau suivant,
//    objectifs x GuildWorksGrowth, recompenses x1,25). Le lundi, tout
//    repart de zero (niveau 0).
//   POST /webhook/guild-works { userId, action: 'status' | 'give', resource?, amount? }

import { ok, fail, userById, now, refId, parseJson } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';
import { mineralsOf, MINERALS } from './digdepth.js';
import { addFeed } from './feed.js';

export const schema = { GuildWorks: { Week: { type: 'Text' }, State: { type: 'Text' } } };

const weekEndsAt = (week) => Math.floor(new Date(week + 'T00:00:00+02:00').getTime() / 1000) + 7 * 86400 - 1;

// Ressources : libelle, icone, points de contribution par unite, et comment
// les prendre au joueur.
const FIELD_RES = {
  dust: { label: 'Poussières', icon: '✨', points: 0.1, field: 'StardustCount' },
  worms: { label: 'Vers de terre', icon: '🪱', points: 2, field: 'Worms' },
  bone: { label: 'Os', icon: '🦴', points: 8, field: 'BoneCount' },
  part: { label: 'Pièces détachées', icon: '🔩', points: 25, field: 'SpareParts' },
  bait: { label: 'Appâts dorés', icon: '🎣', points: 10, field: 'GoldBait' }
};
const MINERAL_POINTS = [3, 8, 20, 50, 150];
const CARD_POINTS = { commune: 5, rare: 10, epique: 25, legendaire: 60 };
const MINERAL_TIER_NAMES = ['communs', 'peu communs', 'rares', 'précieux', 'légendaires'];
function resInfo(key) {
  if (FIELD_RES[key]) return { key, ...FIELD_RES[key], kind: 'field' };
  let m = /^mineral([1-5])$/.exec(key);
  if (m) return { key, kind: 'mineral', tier: Number(m[1]), label: `Minéraux ${MINERAL_TIER_NAMES[Number(m[1]) - 1]}`, icon: '💎', points: MINERAL_POINTS[Number(m[1]) - 1] };
  m = /^card_(commune|rare|epique|legendaire)$/.exec(key);
  if (m) return { key, kind: 'card', rarity: m[1], label: `Doublons ${{ commune: 'communs', rare: 'rares', epique: 'épiques', legendaire: 'légendaires' }[m[1]]}`, icon: '🃏', points: CARD_POINTS[m[1]] };
  return null;
}

// Doublons donnables d'une rarete : exemplaires au-dela du premier, jamais
// precieux (#1, arc-en-ciel, parfait etat, edition, ★, assure, coffre).
function spareCards(store, userId, rarityKey) {
  const rar = store.getAll('Rarities').find((r) => r.Key === rarityKey);
  if (!rar) return [];
  const cards = new Set(store.getAll('Cards').filter((c) => refId(c.Rarity) === rar.id && !c.IsPromo).map((c) => c.id));
  const byCard = new Map();
  store.getAll('Pulls').forEach((p) => {
    if (refId(p.User) !== userId || !cards.has(refId(p.Card))) return;
    const c = refId(p.Card);
    if (!byCard.has(c)) byCard.set(c, []);
    byCard.get(c).push(p);
  });
  const out = [];
  byCard.forEach((list) => {
    const free = list.filter((p) => p.SerialNumber !== 1 && p.Finish !== 'rainbow' && p.Quality !== 'mint' && !p.Edition && !p.Starred && !p.Insured && !p.InVault);
    const keepOne = free.length === list.length ? 1 : 0;
    free.sort((a, b) => (b.SerialNumber || 0) - (a.SerialNumber || 0)).slice(0, Math.max(0, free.length - keepOne)).forEach((p) => out.push(p));
  });
  return out;
}

function haveOf(store, user, info) {
  if (info.kind === 'field') return Math.floor(Number(user[info.field]) || 0);
  if (info.kind === 'mineral') { const owned = mineralsOf(user); return MINERALS.filter((m) => m.tier === info.tier).reduce((s, m) => s + (Number(owned[m.key]) || 0), 0); }
  if (info.kind === 'card') return spareCards(store, user.id, info.rarity).length;
  return 0;
}

function activePlayers(store) {
  const since = now() - 7 * 86400;
  return Math.max(3, store.getAll('Users').filter((u) => (Number(u.LastSeenAt) || 0) >= since).length);
}

function freshState(store, level = 0, week = weekKey()) {
  return { level, stage: 0, players: activePlayers(store), progress: {}, contrib: {}, stageContrib: {}, log: [], completed: 0, week };
}
function load(store, week = weekKey()) {
  let row = store.getAll('GuildWorks').find((r) => r.Week === week);
  if (!row) row = store.create('GuildWorks', { Week: week, State: JSON.stringify(freshState(store, 0, week)) });
  const state = parseJson(row.State, null) || freshState(store, 0, week);
  return { row, state };
}
const save = (store, row, state) => store.update('GuildWorks', row.id, { State: JSON.stringify(state) });

function stageTargets(store, state, stageIdx) {
  const stages = setting(store, 'GuildWorksStages');
  const st = stages[stageIdx];
  if (!st) return null;
  const mult = Math.pow(setting(store, 'GuildWorksGrowth'), state.level);
  const needs = Object.entries(st.needs || {}).map(([key, perPlayer]) => ({ key, target: Math.max(1, Math.ceil(Number(perPlayer) * state.players * mult)) })).filter((n) => resInfo(n.key));
  return { ...st, needs };
}
const rewardOf = (store, state, st) => {
  const k = Math.pow(1.25, state.level);
  return { dust: Math.round((Number(st.reward && st.reward.dust) || 0) * k), boosters: Math.round((Number(st.reward && st.reward.boosters) || 0) * (state.level ? 1 + 0.5 * state.level : 1)) };
};

function view(store, user, state) {
  const stages = setting(store, 'GuildWorksStages');
  const users = new Map(store.getAll('Users').map((u) => [u.id, u]));
  const cur = stageTargets(store, state, state.stage);
  const share = setting(store, 'GuildWorksPlayerShare');
  const mine = (state.stageContrib[user.id] || {});
  return {
    enabled: !!setting(store, 'GuildWorksEnabled'),
    week: state.week, endsAt: weekEndsAt(state.week), level: state.level, players: state.players, completed: state.completed,
    stages: stages.map((s, i) => ({ index: i, label: s.label, icon: s.icon, done: i < state.stage, current: i === state.stage })),
    stage: cur ? {
      index: state.stage, label: cur.label, icon: cur.icon, story: cur.story || '', reward: rewardOf(store, state, cur),
      needs: cur.needs.map((n) => {
        const info = resInfo(n.key);
        const progress = Number(state.progress[n.key]) || 0;
        const cap = Math.max(1, Math.ceil(n.target * share));
        const given = Number(mine[n.key]) || 0;
        return { key: n.key, label: info.label, icon: info.icon, target: n.target, progress, done: progress >= n.target, myGiven: given, myCap: cap, have: haveOf(store, user, info), points: info.points };
      })
    } : null,
    myPoints: Math.round(Number(state.contrib[user.id]) || 0),
    top: Object.entries(state.contrib).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, p]) => ({ pseudo: users.get(Number(id))?.Pseudo || '?', points: Math.round(p) })),
    log: state.log.slice(-8).reverse()
  };
}

// Recompense d'une etape a ses contributeurs ; NG+1 apres la derniere.
function completeStage(store, state) {
  const stages = setting(store, 'GuildWorksStages');
  const st = stageTargets(store, state, state.stage);
  const reward = rewardOf(store, state, st);
  const ids = Object.keys(state.stageContrib).map(Number);
  ids.forEach((id) => {
    const u = store.get('Users', id);
    if (!u) return;
    store.update('Users', id, { StardustCount: (Number(u.StardustCount) || 0) + reward.dust, BoosterCount: (Number(u.BoosterCount) || 0) + reward.boosters });
  });
  state.log.push({ at: now(), text: `${st.icon} ${st.label} terminé : ${ids.length} contributeur${ids.length > 1 ? 's' : ''} récompensé${ids.length > 1 ? 's' : ''}` });
  state.stageContrib = {};
  state.progress = {};
  state.stage++;
  if (state.stage >= stages.length) {
    const next = state.level + 1;
    addFeed(store, { kind: 'guildworks', icon: '🗼', text: `Le Grand Chantier est terminé ! Le phare repart au niveau NG+${next}.` });
    state.log.push({ at: now(), text: `🗼 Phare terminé ! Nouveau chantier : NG+${next}` });
    state.level = next;
    state.stage = 0;
    state.completed++;
    state.players = activePlayers(store);
  }
  return { reward, contributors: ids.length };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const { row, state } = load(store);
  if ((body.action || 'status') === 'status') return ok(view(store, user, state));
  if (body.action !== 'give') return fail('unknown_action');
  if (!setting(store, 'GuildWorksEnabled')) return fail('feature_disabled');
  const cur = stageTargets(store, state, state.stage);
  const need = cur && cur.needs.find((n) => n.key === String(body.resource));
  if (!need) return fail('not_needed', 400, view(store, user, state));
  const info = resInfo(need.key);
  const progress = Number(state.progress[need.key]) || 0;
  const mine = state.stageContrib[user.id] || {};
  const cap = Math.max(1, Math.ceil(need.target * setting(store, 'GuildWorksPlayerShare')));
  const want = Math.max(1, Math.floor(Number(body.amount) || 1));
  const have = haveOf(store, user, info);
  const n = Math.min(want, need.target - progress, cap - (Number(mine[need.key]) || 0), have);
  if (need.target - progress <= 0) return fail('already_full', 400, view(store, user, state));
  if (cap - (Number(mine[need.key]) || 0) <= 0) return fail('share_reached', 400, view(store, user, state));
  if (n <= 0) return fail('not_enough', 400, view(store, user, state));
  // Prelevement.
  if (info.kind === 'field') user = store.update('Users', user.id, { [info.field]: (Number(user[info.field]) || 0) - n });
  else if (info.kind === 'mineral') {
    const owned = mineralsOf(user);
    let left = n;
    MINERALS.filter((m) => m.tier === info.tier).sort((a, b) => (Number(owned[b.key]) || 0) - (Number(owned[a.key]) || 0)).forEach((m) => { const take = Math.min(left, Number(owned[m.key]) || 0); owned[m.key] = (Number(owned[m.key]) || 0) - take; left -= take; });
    user = store.update('Users', user.id, { Minerals: JSON.stringify(owned) });
  } else if (info.kind === 'card') spareCards(store, user.id, info.rarity).slice(0, n).forEach((p) => store.delete('Pulls', p.id));
  state.progress[need.key] = progress + n;
  mine[need.key] = (Number(mine[need.key]) || 0) + n;
  state.stageContrib[user.id] = mine;
  const pts = n * info.points;
  state.contrib[user.id] = (Number(state.contrib[user.id]) || 0) + pts;
  state.log.push({ at: now(), text: `${user.Pseudo || '?'} apporte ${info.label.toLowerCase()} ×${n}` });
  if (state.log.length > 40) state.log = state.log.slice(-40);
  let completed = null;
  if (cur.needs.every((x) => (Number(state.progress[x.key]) || 0) >= x.target)) completed = completeStage(store, state);
  save(store, row, state);
  user = store.get('Users', user.id);
  return ok({ ...view(store, user, state), given: { key: need.key, label: info.label, amount: n, points: Math.round(pts) }, completed, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount });
}

export const routes = { 'POST guild-works': handle };
