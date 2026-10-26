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
//  - Surprises (2026-10-29) : rien de ce qui est encore verrouille n'est
//    montre ni nomme (onglets et liens masques, etapes futures « mystere »).
//    Chaque deblocage arrive avec une cinematique (checkUnlocks, renvoye
//    dans « discoveries » de la reponse, comme une decouverte).
//  - Milo et Moka (2026-10-29) : un nouveau compte n'a pas d'animaux ; Milo
//    l'adopte au premier os, Moka au premier poisson (Users.PetsAdopted).
//   GET  /webhook/starter?userId=
//   POST /webhook/starter { userId, action: 'status' | 'claim', key? }

import { ok, fail, userById, levelForXp, parseJson, now } from './common.js';
import { setting, rawSetting, setSettings } from './settings.js';
import { FEATURES } from './features.js';

export const schema = { Users: { StarterState: { type: 'Text' }, StarterSeen: { type: 'Text' }, PetsAdopted: { type: 'Text' } } };

// Compagnons a adopter : premiere fois que le joueur a la ressource (ou deja
// utilise l'animal avant cette regle). hide : ce que le site masque avant.
export const PET_UNLOCKS = [
  { key: 'milo', icon: '🐕', label: 'Milo', url: 'jeux.html#fouille', hide: ['#dig-kennel'],
    had: (u) => Number(u.BoneCount) > 0 || Number(u.DogUntil) > 0 || Number(u.DogTiredUntil) > 0,
    text: 'Un chien errant a flairé ton os… et ne te quitte plus d’une semelle. Il s’appelle Milo : donne-lui un os et il creuse la fouille à ta place.' },
  { key: 'moka', icon: '🐈', label: 'Moka', url: 'jeux.html#peche', hide: ['#fish-cat'],
    had: (u) => Number(u.CatFish) > 0 || !!u.CatState,
    text: 'Une odeur de poisson frais… Un chat curieux s’installe sur ton ponton. C’est Moka : nourris-le de poisson et il pêche pour toi.' }
];
// Phrase d'accroche de la cinematique de deblocage.
const PITCH = {
  shop: 'La boutique ouvre ses portes : ressources et bonus contre tes poussières.',
  vault: 'Un coffre-fort rien qu’à toi pour mettre tes plus belles cartes à l’abri.',
  trade: 'Tu peux maintenant échanger tes cartes avec les autres joueurs.',
  dig: 'Prends ta pioche : des trésors dorment sous la terre.',
  guess: 'Cinq cartes à reconnaître chaque jour : à toi de jouer !',
  expedition: 'Envoie tes cartes explorer le monde et rapporter un butin.',
  fishing: 'Le lac t’attend : lance ta ligne et vois ce qui mord.',
  archeo: 'Des tablettes anciennes à dégager, grain de terre après grain de terre.',
  bingo: 'Une grille d’objectifs pour tout le mois.',
  dinos: 'Des os, un crâne… et un dino de compagnie qui revient à la vie !',
  garden: 'Un lopin de terre rien qu’à toi : plante, attends, récolte.',
  boss: 'Un boss menace toute la guilde : attaque-le avec les autres.',
  guildChest: 'Le coffre commun de la guilde : on donne, on partage.',
  blackMarket: 'Psst… Un marchand de l’ombre a des offres pour toi.',
  auctions: 'La salle des enchères est ouverte : surenchéris !',
  machine: 'La salle des machines tourne pour toute la communauté.',
  teams: 'Choisis ton camp : la guerre des équipes commence.',
  lottery: 'Un ticket, un tirage chaque dimanche.',
  wanted: 'Des avis de recherche : trouve les cartes demandées.',
  duo: 'Pars en expédition à deux avec un ami.',
  evening: 'Chaque soir, de nouvelles missions.'
};

export const REWARD_FIELDS = { BoosterCount: ['jeton booster', 'jetons booster'], StardustCount: ['poussière', 'poussières'], Worms: ['ver', 'vers'], KeyCount: ['clé', 'clés'], BoneCount: ['os', 'os'], XP: ['XP', 'XP'] };
const READ_ACTIONS = new Set(['status', 'list', 'get', '']);

const stateOf = (user) => { const s = parseJson(user.StarterState, null); return s && typeof s === 'object' ? { counts: s.counts || {}, claimed: s.claimed || [], done: !!s.done } : { counts: {}, claimed: [], done: false }; };

// Compte concerne par les deblocages (cree apres la mise en ligne).
export function isNewcomer(store, user) {
  if (!user || !setting(store, 'StarterEnabled')) return false;
  const since = Number(rawSetting(store, 'StarterSince')) || 0;
  return since > 0 && (Number(user.CreatedAt) || 0) >= since;
}

const adoptedOf = (user) => { const a = parseJson(user && user.PetsAdopted, null); return a && typeof a === 'object' ? a : {}; };
// Animal adopte (toujours vrai pour les anciens comptes).
export function petAdopted(store, user, pet) {
  if (!isNewcomer(store, user)) return true;
  return !!adoptedOf(user)[pet];
}

// Textes qui nomment un compagnon pas encore adopte (boutique, histoire,
// lots...) : le nom disparait. « Os pour Milo » -> « Os », « Le flair de
// Milo » -> « Le flair du chien », « Moka te fixe » -> « Le chat te fixe ».
const PET_WORD = { milo: 'chien', moka: 'chat' };
export function petMask(store, user) {
  const hide = PET_UNLOCKS.filter((p) => !petAdopted(store, user, p.key));
  if (!hide.length) return (s) => s;
  return (s) => {
    if (typeof s !== 'string' || !s) return s;
    let out = s;
    for (const p of hide) {
      const n = p.label, w = PET_WORD[p.key];
      out = out
        .replace(new RegExp(`\\s+pour ${n}( le ${w})?\\b`, 'g'), '')
        .replace(new RegExp(`\\b${n},? le ${w},?`, 'g'), n)
        .replace(new RegExp(`\\bde ${n}\\b`, 'g'), `du ${w}`)
        .replace(new RegExp(`\\bà ${n}\\b`, 'g'), `au ${w}`)
        .replace(new RegExp(`\\b${n}\\b`, 'g'), (m, at, str) => (!str.slice(0, at).trim() || /[.!?…:«]\s*$/.test(str.slice(0, at)) ? `Le ${w}` : `le ${w}`));
    }
    return out;
  };
}
// Le texte nomme-t-il un compagnon pas encore adopte ?
export function namesHiddenPet(store, user, s) {
  return PET_UNLOCKS.some((p) => !petAdopted(store, user, p.key) && new RegExp(`\\b${p.label}\\b`).test(String(s || '')));
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
    const featLevel = newcomer && s.feature ? Number(unlocks[s.feature]) || 0 : 0;
    const req = Math.max(featLevel, Number(s.level) || 0);
    const needLevel = req > level ? req : 0;
    // Etape vers une fonctionnalite pas encore debloquee : rien n'est devoile.
    const secret = featLevel > level;
    return { key: s.key, label: secret ? 'Étape mystère' : s.label, icon: secret ? '❔' : s.icon || '⭐', url: secret ? null : s.url || null, hint: secret ? 'Elle se révélera en montant de niveau.' : s.hint || '', secret, target, progress, complete: progress >= target, claimed: st.claimed.includes(s.key), current: false, needLevel, reward: s.reward || {} };
  });
  const cur = list.find((s) => !s.claimed);
  if (cur) cur.current = true;
  const finished = st.done || !list.length || list.every((s) => s.claimed);
  const future = newcomer ? FEATURES.map((f) => Number(unlocks[f.key])).filter((l) => l > level) : [];
  const adopted = adoptedOf(user);
  return {
    enabled: !!setting(store, 'StarterEnabled'), active: !!setting(store, 'StarterEnabled') && newcomer && !st.done,
    steps: list, claimedCount: list.filter((s) => s.claimed).length, total: list.length, finished, done: st.done,
    finalReward: setting(store, 'StarterFinalReward'), level,
    // Seulement ce qui est deja ouvert (les surprises restent secretes) et le prochain palier.
    unlocks: newcomer ? FEATURES.filter((f) => Number(unlocks[f.key]) > 1 && Number(unlocks[f.key]) <= level).map((f) => ({ key: f.key, label: f.label.replace(/\s*\(.*\)$/, ''), icon: f.icon, level: Number(unlocks[f.key]) })).sort((a, b) => a.level - b.level) : [],
    nextUnlockLevel: future.length ? Math.min(...future) : null,
    pets: Object.fromEntries(PET_UNLOCKS.map((p) => [p.key, !newcomer || !!adopted[p.key]])),
    locks: [
      ...lockedFor(store, user).map(({ feature: f, level: l }) => ({ key: f.key, level: l, page: f.page || null, hide: f.hide })),
      ...(newcomer ? PET_UNLOCKS.filter((p) => !adopted[p.key]).map((p) => ({ key: p.key, pet: true, level: null, page: null, hide: p.hide })) : [])
    ]
  };
}

// Cinematique de deblocage : ce qui s'est ouvert depuis la derniere requete
// (niveau de compte atteint, animal adopte). Premier appel : on note ce qui est
// deja ouvert sans rien rejouer (sauf les adoptions de cet appel).
export function checkUnlocks(store, userId) {
  let user = userId && store.tables.has('Users') ? store.get('Users', Number(userId)) : null;
  if (!user || !isNewcomer(store, user)) return null;
  const adopted = adoptedOf(user);
  const t = now();
  const fresh = PET_UNLOCKS.filter((p) => !adopted[p.key] && p.had(user));
  fresh.forEach((p) => { adopted[p.key] = t; });
  const level = levelForXp(Number(user.XP) || 0);
  const unlocks = setting(store, 'StarterUnlocks') || {};
  const open = FEATURES.filter((f) => Number(unlocks[f.key]) > 1 && Number(unlocks[f.key]) <= level);
  const seenRaw = parseJson(user.StarterSeen, null);
  const seen = Array.isArray(seenRaw) ? seenRaw : open.map((f) => f.key);
  const newFeatures = open.filter((f) => !seen.includes(f.key));
  if (!fresh.length && !newFeatures.length && Array.isArray(seenRaw)) return null;
  user = store.update('Users', user.id, {
    ...(fresh.length ? { PetsAdopted: JSON.stringify(adopted) } : {}),
    StarterSeen: JSON.stringify([...seen, ...newFeatures.map((f) => f.key)])
  });
  const items = [
    ...newFeatures.map((f) => ({ key: 'unlock-' + f.key, unlock: true, kicker: 'Nouveau : débloqué !', icon: f.icon, name: f.label.replace(/\s*\(.*\)$/, ''), riddle: PITCH[f.key] || 'Une nouvelle activité s’ouvre à toi.', url: (f.urls || [])[0] || f.page || null, color: '#facc15' })),
    ...fresh.map((p) => ({ key: 'adopt-' + p.key, unlock: true, kicker: 'Nouveau compagnon !', icon: p.icon, name: p.label, riddle: p.text, url: p.url, color: '#f472b6' }))
  ];
  return items.length ? items : null;
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
  // Compagnon pas encore adopte : ni gestes, ni travail.
  const act = String(body.action || '');
  const pet = path === 'pets' ? String(body.pet || '') : path === 'cat' ? 'moka' : path === 'dog-gift' ? 'milo' : path === 'dig' && ['useBone', 'frenzy'].includes(act) ? 'milo' : '';
  if (pet && PET_UNLOCKS.some((p) => p.key === pet) && !petAdopted(store, user, pet)) return fail('pet_not_adopted', 403, { pet, message: 'Tu n’as pas encore de compagnon ici.' });
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
