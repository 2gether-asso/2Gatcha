// Defis de saison (2026-10-18) : chaque semaine, 3 defis tires dans une liste
// (les memes pour tout le monde) ; chacun reussi rapporte SeasonQuestXp XP de
// SAISON (paliers et coffre du mois, pas l'XP du compte), et les 3 reussis
// un bonus de SeasonQuestAllXp. Progression par les evenements d'activite.
//   POST /webhook/season-quests { userId, action: 'status' | 'claim', key? }

import { ok, fail, userById, parseJson } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';
import { addSeasonXp } from './seasons.js';

export const schema = { Users: { SeasonQuests: { type: 'Text' } } };

export const POOL = [
  { key: 'open5', label: 'Ouvrir 5 boosters', icon: '🃏', type: 'boosterOpened', target: 5 },
  { key: 'dig30', label: 'Creuser 30 cases', icon: '⛏️', type: 'dig', target: 30 },
  { key: 'fish10', label: 'Lancer 10 fois ta ligne', icon: '🎣', type: 'fish', target: 10 },
  { key: 'expe2', label: 'Revenir de 2 expéditions', icon: '🧭', type: 'expedition', target: 2 },
  { key: 'guess5', label: 'Jouer 5 fois à Devine la carte', icon: '❓', type: 'guess', target: 5 },
  { key: 'harvest6', label: 'Récolter 6 plantes', icon: '🌱', type: 'harvest', target: 6 },
  { key: 'craft2', label: 'Crafter 2 cartes', icon: '✨', type: 'craft', target: 2 },
  { key: 'recycle10', label: 'Recycler 10 doublons', icon: '♻️', type: 'disenchant', target: 10 },
  { key: 'chest3', label: 'Ouvrir 3 coffres du gatchapon', icon: '🎁', type: 'chestOpened', target: 3 },
  { key: 'boss5', label: 'Envoyer 5 cartes au boss', icon: '💀', type: 'bossAttack', target: 5 },
  { key: 'wheel3', label: 'Tourner 3 fois la roue', icon: '🎡', type: 'wheel', target: 3 }
];

function seeded(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } let a = h >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Les 3 defis de la semaine (memes pour tous).
export function weekQuests(week = weekKey()) {
  const rnd = seeded('seasonq-' + week);
  const left = [...POOL], out = [];
  while (out.length < 3 && left.length) out.push(left.splice(Math.floor(rnd() * left.length), 1)[0]);
  return out;
}
const stateOf = (user, week) => { const s = parseJson(user.SeasonQuests, null); return s && s.week === week ? { week, counts: s.counts || {}, claimed: s.claimed || [], all: !!s.all } : { week, counts: {}, claimed: [], all: false }; };

function view(store, user) {
  const week = weekKey();
  const st = stateOf(user, week);
  const xp = setting(store, 'SeasonQuestXp');
  const quests = weekQuests(week).map((q) => { const n = Math.min(q.target, Number(st.counts[q.key]) || 0); return { ...q, progress: n, complete: n >= q.target, claimed: st.claimed.includes(q.key), xp }; });
  return { enabled: !!setting(store, 'SeasonEnabled') && setting(store, 'SeasonQuestXp') > 0, week, quests, allBonus: setting(store, 'SeasonQuestAllXp'), allClaimed: st.all };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if ((body.action || 'status') === 'status') return ok(view(store, user));
  if (body.action !== 'claim') return fail('unknown_action');
  const v = view(store, user);
  if (!v.enabled) return fail('season_disabled');
  const q = v.quests.find((x) => x.key === body.key);
  if (!q) return fail('unknown_quest');
  if (q.claimed) return fail('already_claimed', 400, v);
  if (!q.complete) return fail('not_complete', 400, v);
  const st = stateOf(user, v.week);
  st.claimed.push(q.key);
  let gained = addSeasonXp(store, user.id, q.xp);
  let allBonus = 0;
  if (!st.all && v.quests.every((x) => x.claimed || x.key === q.key) && v.allBonus > 0) { st.all = true; allBonus = addSeasonXp(store, user.id, v.allBonus); gained += allBonus; }
  user = store.update('Users', user.id, { SeasonQuests: JSON.stringify(st) });
  return ok({ ...view(store, user), claimed: q.key, seasonXp: gained, allBonus });
}

export function onEvents(store, events) {
  const week = weekKey();
  const quests = weekQuests(week);
  const notices = [];
  const byUser = new Map();
  for (const e of events) { if (!byUser.has(e.userId)) byUser.set(e.userId, []); byUser.get(e.userId).push(e); }
  for (const [uid, evs] of byUser) {
    const user = store.get('Users', Number(uid));
    if (!user) continue;
    const st = stateOf(user, week);
    let changed = false;
    for (const q of quests) {
      const before = Number(st.counts[q.key]) || 0;
      if (before >= q.target) continue;
      const n = evs.filter((e) => e.type === q.type).reduce((s, e) => s + (Number(e.n) || 1), 0);
      if (!n) continue;
      st.counts[q.key] = Math.min(q.target, before + n);
      changed = true;
      if (st.counts[q.key] >= q.target) notices.push({ userId: user.id, kind: 'seasonQuest', icon: q.icon, label: `Défi de saison réussi : ${q.label} (récupère ton XP de saison)` });
    }
    if (changed) store.update('Users', user.id, { SeasonQuests: JSON.stringify(st) });
  }
  return notices;
}

export const routes = { 'POST season-quests': handle };
