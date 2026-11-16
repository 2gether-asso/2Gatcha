// Compagnons V2 (2026-11-16). Voir companion-core.js pour le socle (niveaux,
// voies, equipement, Users.Companions). Ce module porte :
//  - le travail : workFields() ajoute l'XP et les trouvailles des competences
//    a chaque unite de travail (case de Milo, lancer de Moka, recolte de
//    Noisette, tache de Pistache) ; les trois nouveaux compagnons ont leurs
//    propres crochets (Praline : interets du coffre-fort, Reglisse : boosters
//    ouverts, Paprika : machine de la salle interdite, secret) ;
//  - l'humeur du jour (une envie par compagnon et par jour), les souvenirs
//    (album par lieu, titres), le concours de la semaine, la visite ;
//  - les missions (2, 4 ou 8 h, seul ou en duo) : pendant une mission le
//    compagnon ne travaille pas dans son jeu. Sa session de travail est
//    decalee de la duree de la mission (rien n'est perdu), on ne peut pas la
//    relancer avant son retour (pet_on_mission) ; rappel = decalage annule ;
//  - l'equipement (collier, outil, porte-bonheur, pierre sertie si la porte
//    de la salle est ouverte), les fragments (Users.PetFrags), la voie
//    (rachetable en poussieres) et la competence active du niveau 30.
//   POST /webhook/companions { userId, action: 'status' | 'adopt' | 'path' | 'respec' | 'gear' | 'socket' | 'active' | 'mission' | 'claim' | 'recall' | 'visit', pet?, path?, slot?, mineral?, place?, hours?, duo?, targetId? }
import { ok, fail, userById, now, parisDay, parseJson } from './common.js';
import { setting } from './settings.js';
import { ruleOn } from './moderules.js';
import { weekKey } from './levels.js';
import { MINERALS, mineralsOf } from './digdepth.js';
import { pantryFields } from './cooking.js';
import { addTabletsFields } from './archeo.js';
import { addBall, addCoins, FAMILY_KEYS } from './chests.js';
import { grantCosmetic } from './cosmetics.js';
import { PETS, loveOf, petGift } from './pets.js';
import { PLACES, isNight, rollFinds } from './walk.js';
import { petAdopted } from './starter.js';
import { vaultLevel } from './personal-vault.js';
import { ripenAllFields } from './garden.js';
import { ratCook } from './cooking.js';
import { compOf, compJson, levelOf, xpForLevel, LEVEL_MAX, V2_PETS, PATHS, GEAR, GEAR_COST, perksOf, missionOf } from './companion-core.js';

export { onMission, perksOf, petLevel } from './companion-core.js';
export const schema = { Users: { Companions: { type: 'Text' }, PetFrags: { type: 'Numeric' } } };

// XP par unite de travail.
const UNIT_XP = { milo: 1, moka: 2, noisette: 4, pistache: 3, poivre: 6, praline: 20, reglisse: 3, paprika: 1 };
export const GESTURE_XP = { cuddle: 3, play: 8, treat: 6 };
const MOOD_XP = 30;
const MISSION_HOURS = [2, 4, 8];
// Ce que chaque compagnon fait dans son jeu (fiches).
const GAMES = {
  milo: { url: 'jeux.html#fouille', label: 'Fouille', does: 'creuse la fouille à ta place' },
  moka: { url: 'jeux.html#peche', label: 'Pêche', does: 'pêche pour toi' },
  noisette: { url: 'jeux.html#jardin', label: 'Jardin', does: 'récolte et replante le potager' },
  pistache: { url: 'jeux.html#archeologie', label: 'Archéologie', does: 'gratte tes tablettes et nettoie tes blocs' },
  poivre: { url: 'jeux.html#cuisine', label: 'Cuisine', does: 'cuisine pour toi avec les ingrédients du garde-manger' },
  praline: { url: 'coffre.html', label: 'Coffre-fort', does: 'fait grossir les intérêts et l’XP du coffre-fort' },
  reglisse: { url: 'ouverture.html', label: 'Ouverture', does: 'rapporte des poussières à chaque booster et, la nuit, des jetons' },
  paprika: { url: null, label: 'Salle interdite', does: 'offre des tours gratuits à la machine' }
};
// Adoption des nouveaux compagnons.
const QUESTS = {
  praline: { need: 5, text: 'Une tortue a élu domicile près de ton coffre-fort. Atteins le niveau 5 du coffre-fort pour qu’elle te fasse confiance.', progress: (store, user) => Math.min(5, vaultLevel(store, user.id).level || 0) },
  reglisse: { need: 20, text: 'Une chouette te regarde ouvrir tes boosters… la nuit seulement. Ouvre 20 boosters la nuit pour l’apprivoiser.', progress: (store, user) => Math.min(20, Number(compOf(user).owl) || 0) },
  paprika: { need: 30, text: 'Un perroquet bavard s’est perché sur la machine de la salle. Joue 30 tours pour qu’il reste avec toi.', progress: (store, user) => Math.min(30, Number(compOf(user).parrot) || 0), secret: true }
};

// --- souvenirs -------------------------------------------------------------
const SOUVENIRS = {
  foret: { title: 'Âme de la forêt', items: [['gland', 'Gland sculpté', '🌰'], ['feuille', 'Feuille d’automne', '🍂'], ['geai', 'Plume de geai', '🪶'], ['cepe', 'Cèpe séché', '🍄']] },
  lac: { title: 'Âme du lac', items: [['galet', 'Galet plat', '🪨'], ['bouchon', 'Vieux bouchon', '🎣'], ['heron', 'Plume de héron', '🪽'], ['nenuphar', 'Fleur de nénuphar', '🪷']] },
  prairie: { title: 'Âme de la prairie', items: [['fleur', 'Fleur séchée', '🌼'], ['coccinelle', 'Coccinelle en bois', '🐞'], ['rayon', 'Rayon de miel', '🍯'], ['epi', 'Épi doré', '🌾']] },
  ruines: { title: 'Âme des ruines', items: [['tesson', 'Tesson peint', '🏺'], ['piece', 'Pièce ancienne', '🪙'], ['statuette', 'Statuette', '🗿'], ['carte', 'Fragment de carte', '🗺️']] },
  clairiere: { title: 'Âme des lucioles', items: [['luciole', 'Luciole en bocal', '🫙'], ['lune', 'Pierre de lune', '🌙'], ['papillon', 'Aile de papillon', '🦋'], ['etoile', 'Étoile filante', '⭐']] },
  plage: { title: 'Âme de la plage', items: [['nacre', 'Coquillage nacré', '🐚'], ['crabe', 'Pince de crabe', '🦀'], ['bouteille', 'Bouteille à la mer', '🍾'], ['corail', 'Corail', '🪸']] }
};
const SOUV_SET_DUST = 300, SOUV_ALL_DUST = 1500;

const pairKey = (a, b) => [a, b].sort().join('+');
export const friendLevel = (fx) => Math.min(5, Math.floor(Math.sqrt((Number(fx) || 0) / 40)));
const placesOf = (store) => PLACES.filter((p) => !p.rule || ruleOn(store, p.rule));
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const label = (pet) => (PETS[pet] ? PETS[pet].label : pet);
const isAdopted = (store, user, pet) => !!PETS[pet] && petAdopted(store, user, pet) && (pet !== 'paprika' || Number(user.ForbiddenUnlocked) > 0);
const adoptedPets = (store, user) => Object.keys(PETS).filter((p) => isAdopted(store, user, p));

function addXp(store, c, pet, xp) {
  const n = Math.max(0, Math.round(xp));
  if (!n) return 0;
  const before = levelOf(store, c.xp[pet] || 0);
  c.xp[pet] = (Number(c.xp[pet]) || 0) + n;
  const w = weekKey();
  if (!c.week || c.week.w !== w) c.week = { w, xp: 0 };
  c.week.xp += n;
  const after = levelOf(store, c.xp[pet]);
  if (after > before) logLine(c, pet, `${label(pet)} passe au niveau ${after} !${after === 15 ? ' Choisis sa voie.' : ''}`);
  return after > before ? after : 0;
}
function logLine(c, pet, text) {
  c.log = [{ at: now(), pet, text }, ...(c.log || [])].slice(0, 30);
}

// --- humeur du jour ----------------------------------------------------------
const MOOD_LABEL = { cuddle: 'un gros câlin', play: 'jouer', treat: 'une friandise', walk: 'se promener' };
export function moodOf(store, user, pet, day = parisDay(0)) {
  const h = hash(`${user.id}:${pet}:${day}`);
  const kinds = ['cuddle', 'play', 'treat', 'walk'];
  const kind = kinds[h % kinds.length];
  const places = placesOf(store).filter((p) => !p.night);
  const place = kind === 'walk' && places.length ? places[(h >>> 4) % places.length] : null;
  const c = compOf(user);
  const done = !!(c.mood && c.mood.day === day && c.mood.done && c.mood.done[pet]);
  return { kind, place: place ? place.key : null, placeLabel: place ? place.label : null, label: place ? `se promener (${place.label})` : MOOD_LABEL[kind], done };
}
// L'envie du jour est-elle comblee par ce geste (ou cette balade) ?
export function moodWanted(store, user, pet, kind, place = null) {
  if (!setting(store, 'CompanionsEnabled')) return false;
  const m = moodOf(store, user, pet);
  return !m.done && m.kind === kind && (kind !== 'walk' || m.place === place);
}

// Souvenir d'un lieu (ou d'un lieu au hasard) : met a jour c et fields.
function giveSouvenir(store, user, c, fields, placeKey = null) {
  const keys = Object.keys(SOUVENIRS).filter((k) => placesOf(store).some((p) => p.key === k));
  const pk = placeKey && SOUVENIRS[placeKey] ? placeKey : pick(keys);
  const set = SOUVENIRS[pk];
  if (!set) return null;
  const missing = set.items.filter(([k]) => !c.souv[`${pk}:${k}`]);
  const [k, name, icon] = missing.length && Math.random() < 0.6 ? pick(missing) : pick(set.items);
  const key = `${pk}:${k}`;
  const first = !c.souv[key];
  c.souv[key] = (Number(c.souv[key]) || 0) + 1;
  const out = { key, label: name, icon, first, place: pk };
  const dust = (n) => { fields.StardustCount = (fields.StardustCount ?? (Number(user.StardustCount) || 0)) + n; };
  if (first && set.items.every(([x]) => c.souv[`${pk}:${x}`])) {
    dust(SOUV_SET_DUST);
    grantCosmetic(store, user.id, 'souv-' + pk, { type: 'title', label: set.title });
    out.setDone = { title: set.title, dust: SOUV_SET_DUST };
    const main = ['foret', 'lac', 'prairie', 'ruines', 'clairiere'];
    if (main.every((p) => SOUVENIRS[p].items.every(([x]) => c.souv[`${p}:${x}`])) && !c.souvAll) {
      c.souvAll = 1;
      dust(SOUV_ALL_DUST);
      grantCosmetic(store, user.id, 'souv-all', { type: 'title', label: 'Mémoire du village' });
      out.allDone = { title: 'Mémoire du village', dust: SOUV_ALL_DUST };
    }
  }
  return out;
}

// Geste, balade : XP, envie du jour et souvenir eventuel. Champs a ecrire.
export function companionEvent(store, user, pet, { xp = 0, mood = null, souvenirChance = 0, place = null } = {}) {
  if (!setting(store, 'CompanionsEnabled')) return { fields: {}, hit: false };
  const c = compOf(user);
  const fields = {};
  let gained = xp, hit = false, souvenir = null;
  if (mood && moodWanted(store, user, pet, mood.kind, mood.place)) {
    hit = true;
    gained += MOOD_XP;
    const day = parisDay(0);
    c.mood = { day, done: { ...(c.mood && c.mood.day === day ? c.mood.done : {}), [pet]: true } };
    logLine(c, pet, `${label(pet)} est ravi${PETS[pet].fem ? 'e' : ''} : tu as deviné son envie du jour !`);
    if (Math.random() < 0.3) souvenir = giveSouvenir(store, user, c, fields, null);
  }
  if (!souvenir && souvenirChance > 0 && Math.random() < souvenirChance) souvenir = giveSouvenir(store, user, c, fields, place);
  const levelUp = addXp(store, c, pet, gained * (1 + perksOf(store, user, pet).xp));
  fields.Companions = compJson(c);
  return { fields, hit, souvenir, xp: Math.round(gained), levelUp };
}

// --- travail ------------------------------------------------------------------
function giveExtra(store, user, fields, x, n, items) {
  const cur = () => ({ ...user, ...fields });
  const add = (f, v) => { fields[f] = (fields[f] ?? (Number(user[f]) || 0)) + v; };
  const per = Number(x.n) || 1;
  if (x.kind === 'mineral') {
    const mins = { ...mineralsOf(cur()) };
    for (let i = 0; i < n; i++) {
      const tier = rnd(x.tiers[0], x.tiers[1]);
      const pool = MINERALS.filter((m) => m.tier === tier);
      const m = pick(pool.length ? pool : MINERALS);
      mins[m.key] = (Number(mins[m.key]) || 0) + 1;
      items.push({ icon: '💎', label: m.name, n: 1 });
    }
    fields.Minerals = JSON.stringify(mins);
  } else if (x.kind === 'ball') {
    for (let i = 0; i < n; i++) if (addBall(store, user.id, rnd(x.tiers[0], x.tiers[1]), x.family)) items.push({ icon: '🎁', label: 'boule de gatchapon', n: 1 });
  } else if (x.kind === 'coin') {
    addCoins(store, user.id, x.family, n);
    items.push({ icon: '🪙', label: 'pièce de gatchapon', n });
  } else if (x.kind === 'cheese') {
    add('Cheese', n * per);
    items.push({ icon: '🧀', label: 'fromage', n: n * per });
  } else if (x.kind === 'tablet') {
    Object.assign(fields, addTabletsFields(cur(), 'clay', n));
    items.push({ icon: '🟫', label: 'tablette d’argile', n });
  } else if (x.kind === 'pantry') {
    const add2 = {};
    for (let i = 0; i < n; i++) { const k = pick(['veg', 'herb', 'berry', 'mush', 'honey']); add2[k] = (add2[k] || 0) + 1; }
    Object.assign(fields, pantryFields(cur(), add2, fields));
    items.push({ icon: '🧺', label: 'ingrédients', n });
  } else if (x.kind === 'dinofood') {
    const food = { ...(parseJson(cur().DinoFood, {}) || {}) };
    for (let i = 0; i < n; i++) { const k = x.food === 'fish' ? 'fish' : Math.random() < 0.5 ? 'shrimp' : 'seaweed'; food[k] = (Number(food[k]) || 0) + 1; }
    fields.DinoFood = JSON.stringify(food);
    items.push({ icon: x.food === 'fish' ? '🐟' : '🦐', label: 'nourriture pour l’enclos', n });
  } else {
    const F = { worm: ['Worms', '🪱', 'vers de terre'], bait: ['GoldBait', '✨', 'appâts dorés'], carrot: ['Carrots', '🥕', 'carottes'], bone: ['BoneCount', '🦴', 'os'], skull: ['DinoSkulls', '💀', 'crâne'], chips: ['CasinoChips', '🎰', 'jetons de la salle'] }[x.kind];
    if (!F) return;
    add(F[0], n * per);
    items.push({ icon: F[1], label: F[2], n: n * per });
  }
}
// Unites de travail d'un compagnon dans son jeu : XP + trouvailles des
// competences. Champs a fusionner (Companions compris) et objets.
export function workFields(store, user, pet, units) {
  if (!setting(store, 'CompanionsEnabled') || !(units > 0) || !PETS[pet]) return { fields: {}, items: [] };
  const c = compOf(user);
  const p = perksOf(store, user, pet);
  const fields = {}, items = [];
  const rolls = Math.min(Math.floor(units), 300);
  for (const x of p.extras) {
    let hits = 0;
    for (let i = 0; i < rolls; i++) if (Math.random() < x.chance) hits++;
    if (hits) giveExtra(store, user, fields, x, hits, items);
  }
  const levelUp = addXp(store, c, pet, units * (UNIT_XP[pet] || 1) * (1 + p.xp));
  if (items.length) logLine(c, pet, `${label(pet)} a trouvé en travaillant : ${items.map((i) => `${i.icon} ${i.n > 1 ? i.n + ' ' : ''}${i.label}`).join(', ')}`);
  fields.Companions = compJson(c);
  return { fields, items, levelUp };
}

// --- missions : decalage de la session de travail ---------------------------
function shiftState(user, col, d) {
  const s = parseJson(user[col], null);
  if (!s || !s.start || !s.until || s.until <= now()) return {};
  return { [col]: JSON.stringify({ ...s, start: s.start + d, until: s.until + d }) };
}
export function shiftWork(user, pet, d) {
  if (pet === 'milo') {
    const until = Number(user.DogUntil) || 0;
    return until > now() ? { DogUntil: until + d, DogLastDigAt: (Number(user.DogLastDigAt) || now()) + d } : {};
  }
  const col = { moka: 'CatState', noisette: 'BunnyState', pistache: 'MoleState', poivre: 'RatState' }[pet];
  return col ? shiftState(user, col, d) : {};
}

// --- nouveaux compagnons ---------------------------------------------------------
const working = (store, user, pet) => setting(store, 'CompanionsEnabled') && isAdopted(store, user, pet) && !missionOf(user, pet);
// Praline : bonus du coffre-fort (personal-vault.js).
export function pralineBonus(store, user) {
  if (!user || !working(store, user, 'praline')) return { rate: 0, bankDays: 0, vaultXp: 0 };
  const p = perksOf(store, user, 'praline');
  const love = loveOf(store, user, 'praline') / 100;
  return { rate: love * 0.05 + p.level * 0.003 + p.interest, bankDays: p.bankDays, vaultXp: p.level * 0.002 + p.vaultXp };
}
function reglisseOnPack(store, user, response) {
  const c = compOf(user);
  const night = isNight(store);
  if (!isAdopted(store, user, 'reglisse')) {
    if (night) { c.owl = (Number(c.owl) || 0) + 1; store.update('Users', user.id, { Companions: compJson(c) }); }
    return;
  }
  if (missionOf(user, 'reglisse', c)) return;
  const p = perksOf(store, user, 'reglisse');
  const love = loveOf(store, user, 'reglisse') / 100;
  const dust = Math.round((2 + p.level / 5) * (0.5 + love / 2) * (1 + p.boosterDust));
  const fields = { StardustCount: (Number(user.StardustCount) || 0) + dust };
  const day = parisDay(0);
  const od = c.owlDay && c.owlDay.day === day ? c.owlDay : { day, n: 0 };
  let token = false;
  if (night && od.n < 3 + p.nightCap && Math.random() < love * 0.04 + p.level * 0.001 + p.night) {
    token = true; od.n++;
    fields.BoosterCount = (Number(user.BoosterCount) || 0) + 1;
  }
  c.owlDay = od;
  store.update('Users', user.id, { ...fields, Companions: compJson(c) });
  const w = workFields(store, store.get('Users', user.id), 'reglisse', 1);
  const u = store.update('Users', user.id, w.fields);
  if ('newStardust' in response.json) response.json.newStardust = u.StardustCount;
  response.json.companion = { pet: 'reglisse', dust, token, items: w.items };
  if (token) response.json.notices = [...(response.json.notices || []), { kind: 'pet', icon: '🦉', label: 'Réglisse rapporte un jeton booster dans la nuit !' }];
}
function paprikaOnForbidden(store, user, body, response) {
  const c = compOf(user);
  if (body.action === 'spin') {
    const n = Math.max(1, Math.min(10, Math.floor(Number(body.count) || Number(body.n) || 1)));
    if (!isAdopted(store, user, 'paprika')) { c.parrot = (Number(c.parrot) || 0) + n; store.update('Users', user.id, { Companions: compJson(c) }); return; }
    if (missionOf(user, 'paprika', c)) return;
    const w = workFields(store, user, 'paprika', n);
    store.update('Users', user.id, w.fields);
    if (w.items.length) response.json.notices = [...(response.json.notices || []), { kind: 'pet', icon: '🦜', label: `Paprika picore : ${w.items.map((i) => `+${i.n} ${i.label}`).join(', ')}` }];
    return;
  }
  if (body.action !== 'status' || !working(store, user, 'paprika')) return;
  const day = parisDay(0);
  if (c.parrotDay === day) return;
  const p = perksOf(store, user, 'paprika');
  const spins = (loveOf(store, user, 'paprika') >= 30 ? 1 : 0) + Math.floor(p.level / 10) + p.spins;
  c.parrotDay = day;
  const fields = { Companions: compJson(c) };
  if (spins > 0) fields.ForbiddenFreeSpins = (Number(user.ForbiddenFreeSpins) || 0) + spins;
  const gift = petGift(store, user, 'paprika');
  if (gift) Object.assign(fields, gift.fields);
  store.update('Users', user.id, fields);
  if ('freeSpins' in response.json && spins > 0) response.json.freeSpins = fields.ForbiddenFreeSpins;
  if (spins > 0 || gift) response.json.notices = [...(response.json.notices || []), { kind: 'pet', icon: '🦜', label: `Paprika t’attendait : ${spins > 0 ? `${spins} tour${spins > 1 ? 's' : ''} gratuit${spins > 1 ? 's' : ''}` : ''}${gift ? `${spins > 0 ? ' et ' : ''}${gift.gift.label}` : ''} !` }];
}

export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'open-pack' || response.status !== 200 || !response.json || !Array.isArray(response.json.cards) || (request.body || {}).dryRun) return;
  if (!setting(store, 'CompanionsEnabled')) return;
  const user = store.get('Users', Number((request.body || {}).userId));
  if (user) reglisseOnPack(store, user, response);
}
export function afterNative({ store, path, request, response }) {
  if (!setting(store, 'CompanionsEnabled') || !response.json || typeof response.json !== 'object') return;
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  if (path === 'forbidden') paprikaOnForbidden(store, user, body, response);
  else if (path === 'personal-vault' && body.action === 'interest' && response.json.interestGained > 0 && working(store, user, 'praline')) {
    const w = workFields(store, user, 'praline', Math.max(1, Number(response.json.interestDays) || 1));
    const gift = petGift(store, { ...user, ...w.fields }, 'praline');
    store.update('Users', user.id, { ...w.fields, ...(gift ? gift.fields : {}) });
    if (gift) response.json.notices = [...(response.json.notices || []), { kind: 'pet', icon: '🐢', label: `Praline a gardé un petit cadeau pour toi : ${gift.gift.label}` }];
  }
}

// --- concours de la semaine --------------------------------------------------------
function appGet(store, key) { const r = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === key) : null; return r ? parseJson(r.Value, null) : null; }
function appSet(store, key, value) {
  const r = store.getAll('AppSettings').find((x) => x.Key === key);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: key, Value: JSON.stringify(value) });
}
function board(store, week) {
  return store.getAll('Users').map((u) => ({ u, c: compOf(u) })).filter((x) => x.c.week && x.c.week.w === week && x.c.week.xp > 0)
    .sort((a, b) => b.c.week.xp - a.c.week.xp).slice(0, 10)
    .map((x, i) => ({ rank: i + 1, userId: x.u.id, pseudo: x.u.Pseudo || '?', xp: x.c.week.xp, pets: adoptedPets(store, x.u).length }));
}
export function settleContest(store) {
  if (!store.tables.has('AppSettings')) return null;
  const w = weekKey();
  const st = appGet(store, 'CompanionContest') || {};
  if (st.week === w) return st;
  let last = st.last || null;
  if (st.week) {
    const prizes = setting(store, 'CompanionContestDust') || [];
    const rows = board(store, st.week);
    const winners = rows.map((r, i) => {
      const dust = Number(prizes[Math.min(i, prizes.length - 1)]) || 0;
      const u = store.get('Users', r.userId);
      if (u && dust) store.update('Users', u.id, { StardustCount: (Number(u.StardustCount) || 0) + dust });
      if (i === 0) grantCosmetic(store, r.userId, 'pet-contest', { type: 'title', label: 'Ami des bêtes' });
      return { ...r, dust };
    });
    last = { week: st.week, winners };
  }
  const next = { week: w, last };
  appSet(store, 'CompanionContest', next);
  return next;
}

// --- vues ------------------------------------------------------------------------
function gearView(store, user, pet, c) {
  const g = c.gear[pet] || {};
  const frags = Number(user.PetFrags) || 0, mins = mineralsOf(user);
  const tierOwned = (t) => MINERALS.filter((m) => m.tier === t).reduce((s, m) => s + (Number(mins[m.key]) || 0), 0);
  return Object.entries(GEAR).map(([slot, def]) => {
    const tier = Number(g[slot]) || 0;
    const nt = def.tiers[tier];
    const cost = GEAR_COST[tier];
    const need = cost ? [
      { label: `${cost.dust} ✨`, ok: (Number(user.StardustCount) || 0) >= cost.dust },
      { label: `${cost.parts} pièces détachées`, ok: (Number(user.SpareParts) || 0) >= cost.parts },
      { label: `${cost.frags} fragments d’équipement`, ok: frags >= cost.frags },
      ...(cost.tier ? [{ label: `${cost.minerals} minéraux de palier ${cost.tier}`, ok: tierOwned(cost.tier) >= cost.minerals }] : []),
      ...(cost.gold ? [{ label: `${cost.gold} Or`, ok: (Number(mins.or) || 0) >= cost.gold }] : [])
    ] : [];
    return {
      slot, label: def.label, icon: def.icon, tier, name: tier ? def.tiers[tier - 1].name : null, fx: tier ? def.tiers[tier - 1] : null,
      next: nt ? { name: nt.name, fx: nt, need, can: need.every((n) => n.ok) } : null
    };
  });
}
function petCard(store, user, pet, c, t = now()) {
  const xp = Number(c.xp[pet]) || 0, level = levelOf(store, xp);
  const p = perksOf(store, user, pet);
  const path = c.path[pet] || null;
  const m = missionOf(user, pet, c);
  const day = parisDay(0);
  const paths = (PATHS[pet] || []).map((x) => ({ key: x.key, label: x.label, icon: x.icon, desc: x.desc, chosen: x.key === path, skills: x.skills.map((s) => ({ lvl: s.lvl, label: s.label, desc: s.desc, active: !!s.active, unlocked: x.key === path && level >= s.lvl })) }));
  const act = path ? (PATHS[pet].find((x) => x.key === path) || { skills: [] }).skills.find((s) => s.active) : null;
  const g = c.gear[pet] || {};
  return {
    pet, label: label(pet), icon: PETS[pet].icon, fem: !!PETS[pet].fem, v2: V2_PETS.includes(pet),
    level, max: LEVEL_MAX, xp, xpFrom: xpForLevel(store, level), xpTo: level < LEVEL_MAX ? xpForLevel(store, level + 1) : null,
    love: Math.round(loveOf(store, user, pet)), mood: moodOf(store, user, pet),
    path, paths, pathAt: 15, game: { ...GAMES[pet], url: pet === 'paprika' ? null : GAMES[pet].url },
    perks: { speedPct: Math.round(p.speed * 100), lootPct: Math.round(p.loot * 100), giftPct: Math.round(p.gift * 100), xpPct: Math.round(p.xp * 100), restPct: Math.round(p.rest * 100), decayPct: Math.round(p.decay * 100) },
    gear: gearView(store, user, pet, c), gem: g.gem ? { key: g.gem, name: (MINERALS.find((x) => x.key === g.gem) || {}).name || g.gem, tier: Number(g.gemTier) || 3 } : null,
    mission: m ? (m.lead ? { duoOf: m.lead, end: m.end, left: Math.max(0, m.end - t) } : { place: m.place, placeLabel: (PLACES.find((x) => x.key === m.place) || {}).label, hours: m.hours, end: m.end, left: Math.max(0, m.end - t), duo: m.duo || null, ready: t >= m.end }) : null,
    active: act ? { label: act.label, desc: act.desc, ready: level >= LEVEL_MAX && c.active[pet] !== day, usedToday: c.active[pet] === day, level: LEVEL_MAX } : null
  };
}
function view(store, user, extra = {}) {
  const c = compOf(user);
  const t = now();
  const pets = adoptedPets(store, user);
  const forbidden = Number(user.ForbiddenUnlocked) > 0;
  const contest = settleContest(store) || {};
  const w = weekKey();
  const pairs = [];
  for (let i = 0; i < pets.length; i++) for (let j = i + 1; j < pets.length; j++) { const k = pairKey(pets[i], pets[j]); const fx = Number(c.friend[k]) || 0; const lv = friendLevel(fx); pairs.push({ key: k, a: pets[i], b: pets[j], xp: fx, level: lv, next: lv < 5 ? (lv + 1) ** 2 * 40 : null }); }
  const places = placesOf(store);
  return {
    enabled: !!setting(store, 'CompanionsEnabled'), night: isNight(store), forbidden,
    pets: pets.map((p) => petCard(store, user, p, c, t)),
    adopt: V2_PETS.filter((p) => !isAdopted(store, user, p) && (!QUESTS[p].secret || forbidden)).map((p) => ({ pet: p, label: label(p), icon: PETS[p].icon, fem: !!PETS[p].fem, text: QUESTS[p].text, need: QUESTS[p].need, progress: QUESTS[p].progress(store, user), does: GAMES[p].does })),
    gems: forbidden ? (() => { const mins = mineralsOf(user); return MINERALS.filter((m) => m.tier >= 3 && Number(mins[m.key]) > 0).map((m) => ({ key: m.key, name: m.name, tier: m.tier, n: Number(mins[m.key]) })); })() : [],
    frags: Number(user.PetFrags) || 0, stardust: Number(user.StardustCount) || 0, respecDust: setting(store, 'CompanionRespecDust'),
    places: places.map((p) => ({ key: p.key, label: p.label, icon: p.icon, desc: p.desc, fav: [p.fav, ...(p.also || [])].filter(Boolean), night: !!p.night, open: !p.night || isNight(store) })),
    hours: MISSION_HOURS, longAt: 10, missionXp: setting(store, 'CompanionMissionXpPerHour'),
    friends: pairs,
    souvenirs: Object.entries(SOUVENIRS).filter(([k]) => places.some((p) => p.key === k)).map(([k, s]) => ({ place: k, label: (PLACES.find((p) => p.key === k) || {}).label, title: s.title, items: s.items.map(([x, name, icon]) => ({ key: x, label: name, icon, n: Number(c.souv[`${k}:${x}`]) || 0 })), done: s.items.every(([x]) => c.souv[`${k}:${x}`]) })),
    souvSetDust: SOUV_SET_DUST, souvAllDust: SOUV_ALL_DUST, souvAll: !!c.souvAll,
    contest: { week: w, board: board(store, w), me: c.week && c.week.w === w ? c.week.xp : 0, last: contest.last || null, prizes: setting(store, 'CompanionContestDust') },
    log: (c.log || []).slice(0, 20),
    ...extra
  };
}

// --- actions ----------------------------------------------------------------------
function activeSkill(store, user, pet, path, c) {
  const fields = {}, items = [];
  const add = (f, n, icon, lbl) => { fields[f] = (fields[f] ?? (Number(user[f]) || 0)) + n; items.push({ icon, label: lbl, n }); };
  const cur = () => ({ ...user, ...fields });
  const mineral = (tiers) => giveExtra(store, user, fields, { kind: 'mineral', tiers }, 1, items);
  const key = `${pet}:${path}`;
  if (key === 'milo:tracker') { mineral([3, 4]); add('StardustCount', 150, '✨', 'poussières'); if (Math.random() < 0.3 && addBall(store, user.id, rnd(3, 5), 'explorer')) items.push({ icon: '🎁', label: 'boule Explorateur', n: 1 }); }
  else if (key === 'milo:digger') {
    const t = now(), until = Number(user.DogUntil) || 0;
    fields.DogUntil = Math.max(t, until) + 3 * 3600;
    if (until <= t) fields.DogLastDigAt = t;
    items.push({ icon: '⛏️', label: 'heures de fouille offertes', n: 3 });
  }
  else if (key === 'moka:deep') { add('GoldBait', 3, '✨', 'appâts dorés'); add('StardustCount', 120, '✨', 'poussières'); if (Math.random() < 0.3 && addBall(store, user.id, rnd(3, 5), 'nature')) items.push({ icon: '🎁', label: 'boule Nature', n: 1 }); }
  else if (key === 'moka:gourmet') {
    const food = { ...(parseJson(user.DinoFood, {}) || {}) };
    food.fish = (Number(food.fish) || 0) + 15; food.seaweed = (Number(food.seaweed) || 0) + 10; food.shrimp = (Number(food.shrimp) || 0) + 6;
    fields.DinoFood = JSON.stringify(food);
    items.push({ icon: '🐟', label: 'poissons', n: 15 }, { icon: '🌿', label: 'algues', n: 10 }, { icon: '🦐', label: 'crevettes', n: 6 });
  }
  else if (key === 'noisette:gardener') { const r = ripenAllFields(store, user); Object.assign(fields, r.fields); items.push({ icon: '🌧️', label: 'parcelles prêtes', n: r.n }); }
  else if (key === 'noisette:picker') { Object.assign(fields, pantryFields(cur(), { veg: 2, herb: 2, berry: 2, mush: 2, honey: 2, fruit: 2 }, fields)); items.push({ icon: '🧺', label: 'ingrédients (2 de chaque)', n: 12 }); }
  else if (key === 'pistache:restorer') {
    const finds = parseJson(user.ArcheoFinds, []);
    const list = Array.isArray(finds) ? finds : [];
    const fixed = list.filter((f) => Number(f.damage) > 0).length;
    fields.ArcheoFinds = JSON.stringify(list.map((f) => ({ ...f, damage: 0 })));
    items.push({ icon: '🖌️', label: 'blocs remis à neuf', n: fixed });
  }
  else if (key === 'pistache:rummager') { Object.assign(fields, addTabletsFields(cur(), 'clay', 2)); Object.assign(fields, addTabletsFields(cur(), 'stone', 1)); items.push({ icon: '🟫', label: 'tablettes', n: 3 }); add('DinoSkulls', 1, '💀', 'crâne de dinosaure'); }
  else if (key === 'poivre:saucier') { const r = ratCook(store, user, 3, { minQ: 2 }); Object.assign(fields, r.fields); for (const d of r.cooked) items.push({ icon: d.icon, label: d.label, n: 1 }); if (!r.cooked.length) items.push({ icon: '🧺', label: r.full ? 'plat (plus de place pour les plats gardés)' : 'plat (pas assez d’ingrédients)', n: 0 }); }
  else if (key === 'poivre:econome') { Object.assign(fields, pantryFields(cur(), { veg: 3, herb: 3, berry: 3, mush: 3, honey: 3 }, fields)); items.push({ icon: '🧺', label: 'ingrédients (3 de chaque)', n: 15 }); }
  else if (key === 'praline:banker') { const per = vaultLevel(store, user.id).interestPerDay || 0; add('StardustCount', per, '✨', 'poussières (une journée d’intérêts)'); }
  else if (key === 'praline:keeper') add('BoosterCount', 2, '🃏', 'jetons booster');
  else if (key === 'reglisse:night') add('BoosterCount', 3, '🃏', 'jetons booster');
  else if (key === 'reglisse:watch') { if (addBall(store, user.id, rnd(4, 6), 'collector')) items.push({ icon: '🎁', label: 'boule Collectionneur', n: 1 }); }
  else if (key === 'paprika:talker') add('ForbiddenFreeSpins', 5, '🎰', 'tours gratuits');
  else if (key === 'paprika:lucky') add('CasinoChips', 100, '🎰', 'jetons de la salle');
  return { fields, items };
}

function payCost(user, cost) {
  const fields = { StardustCount: (Number(user.StardustCount) || 0) - cost.dust, SpareParts: (Number(user.SpareParts) || 0) - cost.parts, PetFrags: (Number(user.PetFrags) || 0) - cost.frags };
  const mins = { ...mineralsOf(user) };
  if (cost.tier) {
    let left = cost.minerals;
    for (const m of MINERALS.filter((y) => y.tier === cost.tier).sort((a, b) => (Number(mins[b.key]) || 0) - (Number(mins[a.key]) || 0))) {
      const take = Math.min(left, Number(mins[m.key]) || 0); mins[m.key] = (Number(mins[m.key]) || 0) - take; left -= take; if (!left) break;
    }
  }
  if (cost.gold) mins.or = (Number(mins.or) || 0) - cost.gold;
  fields.Minerals = JSON.stringify(mins);
  return fields;
}

function claimMission(store, user, pet, c) {
  const m = c.mission[pet];
  const place = PLACES.find((p) => p.key === m.place) || PLACES[0];
  const duo = m.duo && c.mission[m.duo] ? m.duo : null;
  const team = duo ? [pet, duo] : [pet];
  const fk = duo ? pairKey(pet, duo) : null;
  const flv = fk ? friendLevel(c.friend[fk]) : 0;
  const fav = team.some((x) => place.fav === x || (place.also || []).includes(x));
  let rolls = Math.max(1, Math.round(m.hours / 2));
  if (duo) rolls += Math.ceil(rolls / 2) + (Math.random() < flv * 0.1 ? 1 : 0);
  let fields = {};
  const all = [];
  for (let i = 0; i < rolls; i++) {
    const r = rollFinds(store, { ...user, ...fields }, place, fav);
    fields = { ...fields, ...r.fields };
    all.push(...r.items);
  }
  const merged = new Map();
  for (const it of all) { const k = it.key + ':' + it.label; const g = merged.get(k) || { ...it, n: 0 }; g.n += it.n; merged.set(k, g); }
  const items = [...merged.values()];
  const extra = [];
  const frags = (m.hours >= 8 ? rnd(2, 3) : m.hours >= 4 ? 1 : Math.random() < 0.5 ? 1 : 0) + (duo ? 1 : 0);
  if (frags) { fields.PetFrags = (Number(user.PetFrags) || 0) + frags; extra.push({ icon: '🧩', label: 'fragments d’équipement', n: frags }); }
  let event = null;
  if (Math.random() < 0.06 * (m.hours / 2)) {
    const fam = pick(FAMILY_KEYS);
    if (addBall(store, user.id, rnd(3, 6), fam)) { extra.push({ icon: '🎁', label: 'boule de gatchapon', n: 1 }); event = pick(['a croisé un marchand ambulant qui lui a confié un coffre', 'est revenu avec un coffre trouvé au creux d’un arbre', 'a déterré un vieux coffre oublié']); }
  }
  if (m.hours >= 8 && Math.random() < 0.35) { addCoins(store, user.id, 'pets', 1); extra.push({ icon: '🪙', label: 'pièce de gatchapon Compagnons', n: 1 }); }
  if (duo && flv >= 3 && Math.random() < 0.15 && addBall(store, user.id, rnd(4, 6), 'pets')) { extra.push({ icon: '💞', label: 'trésor du duo (boule Compagnons)', n: 1 }); }
  const souvenir = Math.random() < Math.min(0.8, 0.25 * (m.hours / 2)) ? giveSouvenir(store, { ...user, ...fields }, c, fields, place.key) : null;
  const xpEach = setting(store, 'CompanionMissionXpPerHour') * m.hours * (duo ? 1.2 : 1);
  const levelUps = {};
  for (const x of team) { const lu = addXp(store, c, x, xpEach * (1 + perksOf(store, user, x).xp)); if (lu) levelUps[x] = lu; delete c.mission[x]; }
  if (fk) c.friend[fk] = (Number(c.friend[fk]) || 0) + m.hours * 10;
  const names = team.map(label).join(' et ');
  const story = duo ? `${label(pet)} ${pick(place.story)}, pendant que ${label(duo)} ${pick(place.story)}.` : `${label(pet)} ${pick(place.story)}.`;
  logLine(c, pet, `${names} ${duo ? 'sont rentrés' : `est rentré${PETS[pet].fem ? 'e' : ''}`} de mission (${place.label}, ${m.hours} h).`);
  fields.Companions = compJson(c);
  return { fields, report: { pet, duo, place: place.key, placeLabel: place.label, placeIcon: place.icon, hours: m.hours, story, event: event ? `${label(pet)} ${event} !` : null, items: [...items, ...extra], souvenir, xp: Math.round(xpEach), levelUps, friendLevel: fk ? friendLevel(c.friend[fk]) : null } };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(view(store, user));
  if (action === 'visit') {
    const other = userById(store, body.targetId);
    if (!other) return fail('unknown_user', 404);
    const oc = compOf(other);
    return ok({ visit: { userId: other.id, pseudo: other.Pseudo || '?', pets: adoptedPets(store, other).filter((p) => p !== 'paprika').map((p) => { const lv = levelOf(store, oc.xp[p] || 0); const path = (PATHS[p] || []).find((x) => x.key === oc.path[p]); const g = oc.gear[p] || {}; return { pet: p, label: label(p), icon: PETS[p].icon, level: lv, love: Math.round(loveOf(store, other, p)), path: path ? path.label : null, gear: Object.keys(GEAR).map((s) => ({ slot: s, icon: GEAR[s].icon, tier: Number(g[s]) || 0, name: g[s] ? GEAR[s].tiers[g[s] - 1].name : null })) }; }), souvenirs: Object.keys(oc.souv || {}).length, souvTotal: Object.values(SOUVENIRS).reduce((n, s) => n + s.items.length, 0) } });
  }
  if (!setting(store, 'CompanionsEnabled')) return fail('companions_closed');
  const pet = String(body.pet || '');
  if (action === 'adopt') {
    const q = QUESTS[pet];
    if (!q || isAdopted(store, user, pet) || (q.secret && Number(user.ForbiddenUnlocked) <= 0)) return fail('unknown_pet');
    if (q.progress(store, user) < q.need) return fail('quest_not_done', 400, view(store, user));
    const c = compOf(user);
    c.adopt[pet] = now();
    logLine(c, pet, `${label(pet)} fait maintenant partie de la famille !`);
    user = store.update('Users', user.id, { Companions: compJson(c), PetLove: JSON.stringify({ ...(parseJson(user.PetLove, {}) || {}), [pet]: { v: 60, at: now() } }) });
    return ok(view(store, user, { adopted: pet }));
  }
  if (!isAdopted(store, user, pet)) return fail('unknown_pet');
  const c = compOf(user);
  const level = levelOf(store, c.xp[pet] || 0);
  const t = now();

  if (action === 'path') {
    if (level < 15) return fail('level_too_low', 400, { need: 15 });
    if (c.path[pet]) return fail('path_chosen');
    if (!(PATHS[pet] || []).some((x) => x.key === body.path)) return fail('unknown_path');
    c.path[pet] = body.path;
    logLine(c, pet, `${label(pet)} suit maintenant la voie : ${PATHS[pet].find((x) => x.key === body.path).label}.`);
    user = store.update('Users', user.id, { Companions: compJson(c) });
    return ok(view(store, user));
  }
  if (action === 'respec') {
    if (!c.path[pet]) return fail('no_path');
    const price = setting(store, 'CompanionRespecDust');
    if ((Number(user.StardustCount) || 0) < price) return fail('not_enough_dust', 400, view(store, user));
    delete c.path[pet];
    user = store.update('Users', user.id, { Companions: compJson(c), StardustCount: (Number(user.StardustCount) || 0) - price });
    return ok(view(store, user, { respec: pet }));
  }
  if (action === 'gear') {
    const slot = String(body.slot || '');
    if (!GEAR[slot]) return fail('unknown_slot');
    const g = c.gear[pet] || {};
    const tier = Number(g[slot]) || 0;
    if (tier >= GEAR[slot].tiers.length) return fail('gear_max');
    const gv = gearView(store, user, pet, c).find((x) => x.slot === slot);
    if (!gv.next.can) return fail('missing_ingredients', 400, view(store, user));
    c.gear[pet] = { ...g, [slot]: tier + 1 };
    logLine(c, pet, `${label(pet)} porte maintenant : ${GEAR[slot].tiers[tier].name}.`);
    user = store.update('Users', user.id, { ...payCost(user, GEAR_COST[tier]), Companions: compJson(c) });
    return ok(view(store, user, { crafted: { pet, slot, name: GEAR[slot].tiers[tier].name } }));
  }
  if (action === 'socket') {
    if (Number(user.ForbiddenUnlocked) <= 0) return fail('unknown_action');
    const g = c.gear[pet] || {};
    if (!(Number(g.charm) > 0)) return fail('no_charm');
    const m = MINERALS.find((x) => x.key === String(body.mineral || ''));
    if (!m || m.tier < 3) return fail('mineral_too_weak');
    const mins = { ...mineralsOf(user) };
    if (!(Number(mins[m.key]) > 0)) return fail('missing_ingredients');
    mins[m.key]--;
    c.gear[pet] = { ...g, gem: m.key, gemTier: m.tier };
    user = store.update('Users', user.id, { Minerals: JSON.stringify(mins), Companions: compJson(c) });
    return ok(view(store, user, { socketed: { pet, mineral: m.name } }));
  }
  if (action === 'active') {
    const path = c.path[pet];
    if (level < LEVEL_MAX || !path) return fail('level_too_low', 400, { need: LEVEL_MAX });
    if (missionOf(user, pet, c)) return fail('pet_on_mission');
    const day = parisDay(0);
    if (c.active[pet] === day) return fail('already_used_today');
    const r = activeSkill(store, user, pet, path, c);
    c.active[pet] = day;
    const skill = PATHS[pet].find((x) => x.key === path).skills.find((s) => s.active);
    logLine(c, pet, `${label(pet)} utilise ${skill.label} !`);
    user = store.update('Users', user.id, { ...r.fields, Companions: compJson(c) });
    return ok(view(store, user, { activeUsed: { pet, label: skill.label, items: r.items } }));
  }
  if (action === 'mission') {
    if (missionOf(user, pet, c)) return fail('pet_on_mission');
    const hours = Number(body.hours);
    if (!MISSION_HOURS.includes(hours)) return fail('unknown_duration');
    if (hours >= 8 && level < 10) return fail('level_too_low', 400, { need: 10 });
    const place = placesOf(store).find((p) => p.key === String(body.place || ''));
    if (!place) return fail('unknown_place');
    if (place.night && !isNight(store)) return fail('place_closed', 400, view(store, user));
    const duo = body.duo ? String(body.duo) : null;
    if (duo && (duo === pet || !isAdopted(store, user, duo) || missionOf(user, duo, c))) return fail('duo_unavailable');
    const d = hours * 3600;
    const fields = { ...shiftWork(user, pet, d), ...(duo ? shiftWork(user, duo, d) : {}) };
    c.mission[pet] = { place: place.key, hours, start: t, end: t + d, ...(duo ? { duo } : {}) };
    if (duo) c.mission[duo] = { lead: pet, start: t, end: t + d };
    logLine(c, pet, `${label(pet)}${duo ? ` et ${label(duo)}` : ''} ${duo ? 'partent' : 'part'} en mission : ${place.label}, ${hours} h.`);
    user = store.update('Users', user.id, { ...fields, Companions: compJson(c) });
    return ok(view(store, user, { departed: { pet, duo, place: place.key, hours } }));
  }
  if (action === 'claim' || action === 'recall') {
    let m = missionOf(user, pet, c);
    if (!m) return fail('no_mission');
    const lead = m.lead || pet;
    m = c.mission[lead];
    if (!m) { delete c.mission[pet]; user = store.update('Users', user.id, { Companions: compJson(c) }); return fail('no_mission', 400, view(store, user)); }
    if (t >= m.end) {
      const r = claimMission(store, user, lead, c);
      user = store.update('Users', user.id, r.fields);
      return ok(view(store, user, { mission: r.report }));
    }
    if (action === 'claim') return fail('mission_running', 400, { left: m.end - t });
    const back = -(m.end - t);
    const fields = { ...shiftWork(user, lead, back), ...(m.duo ? shiftWork(user, m.duo, back) : {}) };
    delete c.mission[lead];
    if (m.duo) delete c.mission[m.duo];
    logLine(c, lead, `${label(lead)} a été rappelé${PETS[lead].fem ? 'e' : ''} avant la fin de sa mission.`);
    user = store.update('Users', user.id, { ...fields, Companions: compJson(c) });
    return ok(view(store, user, { recalled: lead }));
  }
  return fail('unknown_action');
}

// Toutes les 10 minutes avec le distributeur : rien a faire ici, les missions
// se reclament a la main. Le concours se regle a la premiere visite du lundi.
export const routes = { 'POST companions': handle };
