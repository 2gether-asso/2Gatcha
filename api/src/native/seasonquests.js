// Missions du jour (pass de saison V2, 2026-11-15 ; avant : 3 defis de saison
// par semaine depuis le 2026-10-18) : chaque jour (Paris), 3 missions courtes
// tirees dans une liste (les memes pour tout le monde) ; chacune reussie rapporte
// SeasonQuestXp XP de SAISON (paliers et coffre du mois, pas l'XP du compte), et
// les 3 reussies un bonus de SeasonQuestAllXp. Avec l'XP de jeu plafonnee par
// jour (seasons.js), c'est ce qui cale le pass sur 28 jours.
// Progression par les evenements d'activite.
//   POST /webhook/season-quests { userId, action: 'status' | 'claim', key? }

import { ok, fail, userById, parseJson, frozenPick, parisDay } from './common.js';
import { questTypeOpen } from './features.js';
import { setting } from './settings.js';
import { addSeasonXp } from './seasons.js';

export const schema = { Users: { SeasonQuests: { type: 'Text' } } };

// Objectifs a la taille d'une journee, faisables sans ressource rare (pas de
// coffre ni de tablette, qui dependent d'une cle ou d'une trouvaille).
export const POOL = [
  { key: 'open3', label: 'Ouvrir 3 boosters', icon: '🃏', type: 'boosterOpened', target: 3 },
  { key: 'dig10', label: 'Creuser 10 cases', icon: '⛏️', type: 'dig', target: 10 },
  { key: 'fish5', label: 'Lancer 5 fois ta ligne', icon: '🎣', type: 'fish', target: 5 },
  { key: 'expe1', label: 'Revenir d’une expédition', icon: '🧭', type: 'expedition', target: 1 },
  { key: 'guess2', label: 'Trouver 2 cartes à Devine la carte', icon: '❓', type: 'guess', target: 2 },
  { key: 'harvest3', label: 'Récolter 3 plantes', icon: '🌱', type: 'harvest', target: 3 },
  { key: 'craft1', label: 'Crafter une carte', icon: '✨', type: 'craft', target: 1 },
  { key: 'recycle5', label: 'Recycler 5 doublons', icon: '♻️', type: 'disenchant', target: 5 },
  { key: 'boss2', label: 'Envoyer 2 cartes au boss', icon: '💀', type: 'bossAttack', target: 2 },
  { key: 'wheel1', label: 'Tourner la roue de la fortune', icon: '🎡', type: 'wheel', target: 1 }
];

function seeded(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } let a = h >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const today = () => parisDay(0);
// Les 3 missions du jour (memes pour tous).
export function dayQuests(day = today(), store = null) {
  const draw = () => {
    const rnd = seeded('seasonq-day-' + day);
    // Objectifs irrealisables (boss absent, jeu ferme dans le mode) ecartes ; tirage fige pour la semaine.
    const left = POOL.filter((q) => !store || questTypeOpen(store, q.type)), out = [];
    while (out.length < 3 && left.length) out.push(left.splice(Math.floor(rnd() * left.length), 1)[0]);
    return out.map((q) => q.key);
  };
  const keys = day === today() ? frozenPick(store, 'seasonQuestsDay', day, draw) : draw();
  return keys.map((k) => POOL.find((q) => q.key === k)).filter(Boolean);
}
const stateOf = (user, day) => { const s = parseJson(user.SeasonQuests, null); return s && s.day === day ? { day, counts: s.counts || {}, claimed: s.claimed || [], all: !!s.all } : { day, counts: {}, claimed: [], all: false }; };

function view(store, user) {
  const day = today();
  const st = stateOf(user, day);
  const xp = setting(store, 'SeasonQuestXp');
  const quests = dayQuests(day, store).map((q) => { const n = Math.min(q.target, Number(st.counts[q.key]) || 0); return { ...q, progress: n, complete: n >= q.target, claimed: st.claimed.includes(q.key), xp }; });
  return { enabled: !!setting(store, 'SeasonEnabled') && setting(store, 'SeasonQuestXp') > 0, day, quests, allBonus: setting(store, 'SeasonQuestAllXp'), allClaimed: st.all };
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
  const st = stateOf(user, v.day);
  st.claimed.push(q.key);
  let gained = addSeasonXp(store, user.id, q.xp);
  let allBonus = 0;
  if (!st.all && v.quests.every((x) => x.claimed || x.key === q.key) && v.allBonus > 0) { st.all = true; allBonus = addSeasonXp(store, user.id, v.allBonus); gained += allBonus; }
  user = store.update('Users', user.id, { SeasonQuests: JSON.stringify(st) });
  return ok({ ...view(store, user), claimed: q.key, seasonXp: gained, allBonus });
}

export function onEvents(store, events) {
  const day = today();
  const quests = dayQuests(day, store);
  const notices = [];
  const byUser = new Map();
  for (const e of events) { if (!byUser.has(e.userId)) byUser.set(e.userId, []); byUser.get(e.userId).push(e); }
  for (const [uid, evs] of byUser) {
    const user = store.get('Users', Number(uid));
    if (!user) continue;
    const st = stateOf(user, day);
    let changed = false;
    for (const q of quests) {
      const before = Number(st.counts[q.key]) || 0;
      if (before >= q.target) continue;
      const n = evs.filter((e) => e.type === q.type).reduce((s, e) => s + (Number(e.n) || 1), 0);
      if (!n) continue;
      st.counts[q.key] = Math.min(q.target, before + n);
      changed = true;
      if (st.counts[q.key] >= q.target) notices.push({ userId: user.id, kind: 'seasonQuest', icon: q.icon, label: `Mission du jour réussie : ${q.label} (récupère ton XP de saison)` });
    }
    if (changed) store.update('Users', user.id, { SeasonQuests: JSON.stringify(st) });
  }
  return notices;
}

export const routes = { 'POST season-quests': handle };
