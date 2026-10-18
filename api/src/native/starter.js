// Progression d'un nouveau joueur (2026-10-18).
//  - Parcours du debutant (setting StarterSteps) : etapes guidees a valider
//    dans l'ordre, chacune avec sa recompense (de quoi faire l'etape suivante),
//    puis un bonus final (StarterFinalReward). La progression compte des que
//    l'action est faite (meme en avance) ; on reclame dans l'ordre.
//  - Deblocages par niveau (StarterUnlocks : { fonctionnalite de features.js :
//    niveau }) : jeux et pages verrouilles tant que le niveau de compte n'est
//    pas atteint. Seulement pour les comptes crees apres la mise en ligne
//    (StarterSince, pose au premier demarrage) : les joueurs deja la ne
//    perdent rien. Le site garde les onglets visibles avec un cadenas ; l'API
//    refuse les ecritures ({ error: 'level_locked', level }).
//  - Tant que le parcours n'est pas fini, l'accueil est simplifie (site).
//   GET  /webhook/starter?userId=
//   POST /webhook/starter { userId, action: 'status' | 'claim', key? }

import { ok, fail, userById, levelForXp, parseJson, now } from './common.js';
import { setting, rawSetting, setSettings } from './settings.js';
import { FEATURES } from './features.js';

export const schema = { Users: { StarterState: { type: 'Text' } } };

export const REWARD_FIELDS = { BoosterCount: ['jeton booster', 'jetons booster'], StardustCount: ['poussière', 'poussières'], Worms: ['ver', 'vers'], KeyCount: ['clé', 'clés'], BoneCount: ['os', 'os'], XP: ['XP', 'XP'] };
const READ_ACTIONS = new Set(['status', 'list', 'get', '']);

const stateOf = (user) => { const s = parseJson(user.StarterState, null); return s && typeof s === 'object' ? { counts: s.counts || {}, claimed: s.claimed || [], done: !!s.done } : { counts: {}, claimed: [], done: false }; };

// Compte concerne par les deblocages (cree apres la mise en ligne).
export function isNewcomer(store, user) {
  if (!user || !setting(store, 'StarterEnabled')) return false;
  const since = Number(rawSetting(store, 'StarterSince')) || 0;
  return since > 0 && (Number(user.CreatedAt) || 0) >= since;
}

// Fonctionnalites encore verrouillees pour ce joueur : [{ feature, level }].
export function lockedFor(store, user) {
  if (!isNewcomer(store, user)) return [];
  const level = levelForXp(Number(user.XP) || 0);
  const unlocks = setting(store, 'StarterUnlocks') || {};
  return FEATURES.filter((f) => Number(unlocks[f.key]) > level).map((f) => ({ feature: f, level: Number(unlocks[f.key]) }));
}

function view(store, user) {
  const st = stateOf(user);
  const steps = setting(store, 'StarterSteps');
  const level = levelForXp(Number(user.XP) || 0);
  const unlocks = setting(store, 'StarterUnlocks') || {};
  const newcomer = isNewcomer(store, user);
  const list = steps.map((s, i) => {
    const target = Number(s.target) || 0;
    const progress = target ? Math.min(target, Number(st.counts[s.key]) || 0) : 0;
    // Niveau requis : deblocage de la fonctionnalite (nouveaux comptes) ou niveau propre de l'etape (craft...).
    const req = Math.max(newcomer && s.feature ? Number(unlocks[s.feature]) || 0 : 0, Number(s.level) || 0);
    const needLevel = req > level ? req : 0;
    return { key: s.key, label: s.label, icon: s.icon || '⭐', url: s.url || null, hint: s.hint || '', target, progress, complete: progress >= target, claimed: st.claimed.includes(s.key), current: false, needLevel, reward: s.reward || {} };
  });
  const cur = list.find((s) => !s.claimed);
  if (cur) cur.current = true;
  const finished = st.done || !list.length || list.every((s) => s.claimed);
  return {
    enabled: !!setting(store, 'StarterEnabled'), active: !!setting(store, 'StarterEnabled') && newcomer && !st.done,
    steps: list, claimedCount: list.filter((s) => s.claimed).length, total: list.length, finished, done: st.done,
    finalReward: setting(store, 'StarterFinalReward'), level,
    // Tous les deblocages (nouveaux comptes) : "bientot" sur l'accueil, passage de niveau.
    unlocks: newcomer ? FEATURES.filter((f) => Number(unlocks[f.key]) > 1).map((f) => ({ key: f.key, label: f.label.replace(/\s*\(.*\)$/, ''), icon: f.icon, level: Number(unlocks[f.key]) })).sort((a, b) => a.level - b.level) : [],
    locks: lockedFor(store, user).map(({ feature: f, level: l }) => ({ key: f.key, label: f.label.replace(/\s*\(.*\)$/, ''), icon: f.icon, level: l, page: f.page || null, hide: f.hide }))
  };
}

// Recompense : champs connus + 1 jeton par niveau de compte gagne (comme les workflows).
function grant(store, user, reward) {
  const fields = {};
  for (const [k, v] of Object.entries(reward || {})) if (REWARD_FIELDS[k] && Number(v) > 0) fields[k] = (Number(user[k]) || 0) + Math.floor(Number(v));
  if (fields.XP) {
    const gained = levelForXp(fields.XP) - levelForXp(Number(user.XP) || 0);
    if (gained > 0) fields.BoosterCount = (fields.BoosterCount != null ? fields.BoosterCount : Number(user.BoosterCount) || 0) + gained;
  }
  return fields;
}

function handle({ store, body, query }) {
  const input = { ...(query || {}), ...(body || {}) };
  let user = userById(store, input.userId);
  if (!user) return fail('unknown_user', 404);
  const action = input.action || 'status';
  if (action === 'status') return ok(view(store, user));
  if (action !== 'claim') return fail('unknown_action');
  if (!setting(store, 'StarterEnabled')) return fail('starter_disabled');
  const st = stateOf(user);
  const steps = setting(store, 'StarterSteps');
  if (st.done) return fail('already_done', 400, view(store, user));
  // Bonus final.
  if (input.key === 'final') {
    if (!steps.every((s) => st.claimed.includes(s.key))) return fail('not_finished', 400, view(store, user));
    const fields = grant(store, user, setting(store, 'StarterFinalReward'));
    user = store.update('Users', user.id, { ...fields, StarterState: JSON.stringify({ ...st, done: true, doneAt: now() }) });
    return ok({ ...view(store, user), claimed: 'final', reward: setting(store, 'StarterFinalReward'), newStardust: user.StardustCount, newBoosterCount: user.BoosterCount });
  }
  const i = steps.findIndex((s) => !st.claimed.includes(s.key));
  const step = steps[i];
  if (!step || step.key !== input.key) return fail('not_current_step', 400, view(store, user));
  const target = Number(step.target) || 0;
  if (target && (Number(st.counts[step.key]) || 0) < target) return fail('step_not_complete', 400, view(store, user));
  const fields = grant(store, user, step.reward);
  user = store.update('Users', user.id, { ...fields, StarterState: JSON.stringify({ ...st, claimed: [...st.claimed, step.key] }) });
  return ok({ ...view(store, user), claimed: step.key, reward: step.reward || {}, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount });
}

// Progression des etapes a partir des evenements d'activite (activity.js).
export function onEvents(store, events) {
  if (!setting(store, 'StarterEnabled')) return [];
  const steps = setting(store, 'StarterSteps');
  const notices = [];
  const byUser = new Map();
  for (const e of events) { if (!byUser.has(e.userId)) byUser.set(e.userId, []); byUser.get(e.userId).push(e); }
  for (const [userId, evs] of byUser) {
    const user = store.get('Users', Number(userId));
    if (!user) continue;
    const st = stateOf(user);
    if (st.done) continue;
    let changed = false;
    for (const s of steps) {
      const target = Number(s.target) || 0;
      if (!target || st.claimed.includes(s.key)) continue;
      const types = Array.isArray(s.type) ? s.type : [s.type];
      const before = Number(st.counts[s.key]) || 0;
      if (before >= target) continue;
      const n = evs.filter((e) => types.includes(e.type)).reduce((sum, e) => sum + (Number(e.n) || 1), 0);
      if (!n) continue;
      st.counts[s.key] = Math.min(target, before + n);
      changed = true;
      if (st.counts[s.key] >= target) notices.push({ userId: user.id, kind: 'starter', icon: s.icon || '⭐', label: `Parcours du débutant : « ${s.label} » réussi, viens récupérer ta récompense !` });
    }
    if (changed) store.update('Users', user.id, { StarterState: JSON.stringify(st) });
  }
  return notices;
}

// Ecriture vers une fonctionnalite pas encore debloquee : refus.
export function gate(store, method, path, body = {}) {
  if (method === 'GET' || READ_ACTIONS.has(String(body.action || '')) || body.discordId) return null;
  const uid = Number(body.userId || body.fromUserId) || 0;
  if (!uid) return null;
  const user = store.get('Users', uid);
  const lock = lockedFor(store, user).find((l) => l.feature.paths.includes(path));
  if (!lock) return null;
  const label = lock.feature.label.replace(/\s*\(.*\)$/, '');
  return fail('level_locked', 403, { feature: lock.feature.key, label, level: lock.level, message: `${label} se débloque au niveau ${lock.level}.` });
}
export function beforeWorkflow({ store, path, request }) { return gate(store, 'POST', path, request.body || {}); }

// Date de mise en ligne : les comptes plus anciens ne sont jamais verrouilles.
export function init({ store }) {
  try { if (!(Number(rawSetting(store, 'StarterSince')) > 0)) setSettings(store, { StarterSince: now() }); } catch (e) { console.error(e); }
}

export const routes = { 'GET starter': handle, 'POST starter': handle };
