// Vacances du mode Chill (2026-11-01, suite le 2026-11-02), activables une par
// une (moderules.js, Admin > Difficultes, et aussi dans d'autres modes a la
// main), valeurs reglables (ChillVacation). Chaque activite s'affiche dans la
// page ou l'on joue deja (site/js/vacation-ui.js) :
//  - sieste au hamac, coucher de soleil (accueil, bandeau) ;
//  - carte postale (fenetre d'une carte), cartes recues (profil) ;
//  - peche sans appat et marees (Peche), fouille de plage et chateau de sable (Fouille) ;
//  - bibliotheque engloutie (Archeologie), promenade a la plage (walk.js) ;
//  - transat des compagnons : photo souvenir (coins des compagnons ; affection : pets.js) ;
//  - apero du serveur et chateau de sable commun (Communaute > Ensemble) ;
//  - passeport, titres de vacances, carnet exotique et amis (profil) ;
//  - doublons au soleil (Collection > Qualite).
// (Cocktails : cooking.js ; graine tropicale : garden.js.)
//   POST /webhook/vacation { userId, action, ... }
//     status | nap-start | nap-claim | sunset-claim | postcard {toPseudo, pullId, message?, discord?}
//     beach-fish | beach-dig {tile} | castle-build | castle-donate {n} | pet-photo {pet}
//     sunbath-start {pullId} | sunbath-claim {pullId} | book-claim {section}
//   POST /webhook/friends { userId, action: 'status' | 'add' | 'remove', pseudo?, friendId? }

import { refId, now, ok, fail, userById, parisDay, parisHour, parseJson, cardSummary } from './common.js';
import { ruleOn, vacationCfg, sunsetState } from './moderules.js';
import { addFeed } from './feed.js';
import { grantCosmetic } from './cosmetics.js';
import { inbox } from './modefun.js';
import { PETS, loveOf } from './pets.js';
import { petAdopted } from './starter.js';
import { currentContext } from './context.js';
import { isTestUser } from './testuser.js';
import { announce } from './discord.js';
import { weekKey } from './levels.js';

export const schema = {
  Users: {
    NapState: { type: 'Text' }, NapDay: { type: 'Text' }, SunsetDay: { type: 'Text' }, PostcardDay: { type: 'Text' }, Postcards: { type: 'Text' },
    BeachFishDay: { type: 'Text' }, ExoticFish: { type: 'Text' }, BeachDig: { type: 'Text' }, PetPhotoDay: { type: 'Text' }, AperoDay: { type: 'Text' }, Passport: { type: 'Text' },
    Sand: { type: 'Numeric' }, Shells: { type: 'Numeric' }, ShellBook: { type: 'Text' }, SeaLore: { type: 'Text' }, Castle: { type: 'Text' },
    VacStats: { type: 'Text' }, BookClaims: { type: 'Text' }, Friends: { type: 'Text' }
  },
  Pulls: { SunbathUntil: { type: 'Numeric' } }
};

const n = (v) => Number(v) || 0;
const today = () => parisDay(0);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const QUALITY = ['damaged', 'worn', 'good', 'mint'];
const SUNBATH_SECONDS = 24 * 3600;
const BEACH_TILES = 16, BEACH_SIDE = 4;
const monthOf = () => today().slice(0, 7);
function hashOf(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; }
const pick = (list) => { let r = Math.random() * list.reduce((s, x) => s + x.weight, 0); for (const x of list) { r -= x.weight; if (r <= 0) return x; } return list[0]; };

function appGet(store, key, def) { const r = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === key) : null; return r ? parseJson(r.Value, def) : def; }
function appSet(store, key, value) {
  const r = store.getAll('AppSettings').find((x) => x.Key === key);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: key, Value: JSON.stringify(value) });
}

// ------------------------------------------------------------------ titres de vacances
// Gagnes en jouant (regle chill.vacationCosmetics), gardes ensuite.
export const VACATION_COSMETICS = {
  pirate: { key: 'pirate-plages', type: 'title', label: 'Pirate des plages 🏴‍☠️', need: 5, stat: 'chests', how: '5 coffres de pirate trouvés à la fouille de plage' },
  bar: { key: 'maitre-bar', type: 'title', label: 'Maître du bar 🍹', need: 10, stat: 'cocktails', how: '10 cocktails préparés à la cuisine' },
  castle: { key: 'batisseur-sable', type: 'title', label: 'Bâtisseur de sable 🏰', need: 6, stat: 'castleTop', how: 'les 6 étages de ton château de sable' },
  shared: { key: 'frame-sable', type: 'frame', label: 'Cadre Château de sable', need: 1, stat: 'sharedTop', how: 'participer au 5e étage du château commun' }
};
const statsOf = (user) => { const s = parseJson(user && user.VacStats, {}); return s && typeof s === 'object' ? s : {}; };
function bumpStat(store, userId, stat, by = 1, max = false) {
  const user = store.get('Users', userId);
  if (!user) return null;
  const s = statsOf(user);
  s[stat] = max ? Math.max(n(s[stat]), by) : n(s[stat]) + by;
  store.update('Users', userId, { VacStats: JSON.stringify(s) });
  if (!ruleOn(store, 'chill.vacationCosmetics')) return null;
  const c = Object.values(VACATION_COSMETICS).find((x) => x.stat === stat && n(s[stat]) >= x.need);
  if (!c || !grantCosmetic(store, userId, c.key, { type: c.type, label: c.label })) return null;
  addFeed(store, { userId, kind: 'vacation', icon: '🎖️', text: `gagne ${c.type === 'frame' ? 'le' : 'le titre'} « ${c.label} » !` });
  return `${c.type === 'frame' ? 'Cadre' : 'Titre'} gagné : ${c.label}`;
}
function cosmeticsView(store, user) {
  const s = statsOf(user);
  const owned = store.tables.has('UserCosmetics') ? new Set(store.getAll('UserCosmetics').filter((r) => refId(r.User) === user.id).map((r) => r.Key)) : new Set();
  return Object.values(VACATION_COSMETICS).map((c) => ({ key: c.key, type: c.type, label: c.label, how: c.how, progress: Math.min(c.need, n(s[c.stat])), need: c.need, owned: owned.has(c.key) }));
}

// ------------------------------------------------------------------ coquillages et fragments
export const SHELLS = [
  { key: 'coque', label: 'Coque', icon: '🐚', weight: 34 }, { key: 'huitre', label: 'Huître', icon: '🦪', weight: 24 },
  { key: 'etoile', label: 'Étoile de mer', icon: '⭐', weight: 18 }, { key: 'nautile', label: 'Nautile', icon: '🌀', weight: 12 },
  { key: 'corail', label: 'Branche de corail', icon: '🪸', weight: 8 }, { key: 'perle', label: 'Perle', icon: '⚪', weight: 4 }
];
// Champs a ecrire pour n coquillages (types tires au hasard), et leur liste.
export function shellFields(user, count, fields = {}) {
  const book = parseJson(fields.ShellBook ?? user.ShellBook, {});
  const got = [];
  for (let i = 0; i < count; i++) { const s = pick(SHELLS); book[s.key] = n(book[s.key]) + 1; got.push(s); }
  return { fields: { Shells: n(fields.Shells ?? user.Shells) + count, ShellBook: JSON.stringify(book) }, got };
}
export const SEA_LORE = [
  'Avant la marée, il y avait une bibliothèque au bord de l’eau, tenue par les premiers dessinateurs de l’asso.',
  'Chaque carte y avait son étagère. Les plus rares dormaient tout en haut, là où la lumière du phare arrivait.',
  'Un soir d’équinoxe, la mer est montée plus haut que d’habitude. Personne n’a voulu fermer les volets.',
  'Les dessinateurs ont glissé leurs croquis dans des bouteilles, une par carte, et les ont confiées au courant.',
  'La bibliothèque a sombré doucement, sans bruit, comme une page qu’on tourne.',
  'Les poissons-clowns y ont fait leur nid entre les rayonnages. Ils gardent encore les titres en mémoire.',
  'On raconte que la tortue verte connaît le chemin de la salle des légendaires, mais qu’elle ne le dit qu’aux patients.',
  'Les bouteilles reviennent parfois sur la plage, à marée basse, avec un coquillage collé au bouchon.',
  'Une carte manquerait toujours : celle que le dernier dessinateur n’a pas eu le temps de finir.',
  'Le poulpe des lagons la cherche depuis des années. Il range ce qu’il trouve dans les coraux.',
  'Quand la baleine chante, les pages engloutis frémissent, et un fragment remonte à la surface.',
  'Si tu rassembles tous les fragments, la bibliothèque t’appartient un peu. Prends-en soin : c’est la mémoire des cartes.'
];
// Un fragment pas encore trouve, ou null.
function loreFields(store, user, fields = {}) {
  if (!ruleOn(store, 'chill.seaLore')) return null;
  const have = parseJson(fields.SeaLore ?? user.SeaLore, []);
  const missing = SEA_LORE.map((_, i) => i).filter((i) => !have.includes(i));
  if (!missing.length) return null;
  const i = missing[Math.floor(Math.random() * missing.length)];
  return { fields: { SeaLore: JSON.stringify([...have, i].sort((a, b) => a - b)) }, index: i, text: SEA_LORE[i] };
}
// Promenade a la plage (walk.js) : coquillages et parfois un fragment.
export function beachWalkFields(store, user, shells, fields) {
  const out = { ...fields };
  const sh = shellFields(user, shells, out);
  Object.assign(out, sh.fields);
  const lore = Math.random() < 0.2 ? loreFields(store, user, out) : null;
  if (lore) Object.assign(out, lore.fields);
  return { fields: out, shells: sh.got, lore: lore ? { index: lore.index, text: lore.text } : null };
}

// ------------------------------------------------------------------ passeport
export const STAMPS = {
  dig: { label: 'Fouille', icon: '⛏️' }, fish: { label: 'Pêche', icon: '🎣' }, harvest: { label: 'Jardin', icon: '🌱' }, booster: { label: 'Booster', icon: '🃏' },
  atelier: { label: 'Atelier', icon: '🛠️' }, boss: { label: 'Boss', icon: '🗡️' }, casino: { label: 'Casino', icon: '🎰' }, archeo: { label: 'Archéologie', icon: '🏺' },
  cook: { label: 'Cuisine', icon: '🍳' }, beach: { label: 'Plage', icon: '🏖️' }
};
const STAMP_OF = { dig: 'dig', fish: 'fish', harvest: 'harvest', boosterOpened: 'booster', craft: 'atelier', disenchant: 'atelier', fusion: 'atelier', repair: 'atelier', bossAttack: 'boss', casinoPlay: 'casino', tablet: 'archeo', cook: 'cook' };
const COCKTAILS = new Set(['mojito', 'pina', 'smoothie', 'planteur']);
const passportOf = (user) => { const p = parseJson(user.Passport, {}); return p && typeof p === 'object' ? p : {}; };
function addStamp(store, userId, key) {
  if (!ruleOn(store, 'chill.passport')) return null;
  const user = store.get('Users', userId);
  if (!user) return null;
  const p = passportOf(user);
  const list = p.day === today() ? p.today || [] : [];
  if (list.includes(key)) return null;
  const total = n(p.total) + 1;
  const completed = !p.done && total >= n(vacationCfg(store).passportGoal);
  store.update('Users', userId, { Passport: JSON.stringify({ day: today(), today: [...list, key], total, done: !!p.done || completed }) });
  if (!completed) return null;
  grantCosmetic(store, userId, 'globetrotter', { type: 'title', label: 'Globe-trotteur 🏝️' });
  grantCosmetic(store, userId, 'frame-tropical', { type: 'frame', label: 'Cadre Tropical' });
  addFeed(store, { userId, kind: 'vacation', icon: '🛂', text: 'a rempli son passeport de vacances et devient Globe-trotteur !' });
  return { userId, kind: 'vacation', icon: '🛂', label: 'Passeport complet : titre Globe-trotteur et Cadre Tropical !' };
}
function passportView(store, user) {
  const p = passportOf(user);
  const list = p.day === today() ? p.today || [] : [];
  return { goal: n(vacationCfg(store).passportGoal), total: n(p.total), done: !!p.done, stamps: Object.entries(STAMPS).map(([key, s]) => ({ key, ...s, today: list.includes(key) })) };
}

// Sieste interrompue, tampons du passeport, cocktails pour le titre du bar.
export function onEvents(store, events) {
  const notices = [];
  for (const e of events) {
    const user = store.get('Users', e.userId);
    if (!user) continue;
    const nap = parseJson(user.NapState, null);
    if (nap && nap.until > now()) {
      store.update('Users', user.id, { NapState: '' });
      notices.push({ userId: user.id, kind: 'vacation', icon: '🛌', label: 'Tu as quitté ton hamac : la sieste est interrompue.' });
    }
    if (STAMP_OF[e.type]) { const done = addStamp(store, e.userId, STAMP_OF[e.type]); if (done) notices.push(done); }
    if (e.type === 'cook' && COCKTAILS.has(e.meta && e.meta.recipe)) { const t = bumpStat(store, e.userId, 'cocktails'); if (t) notices.push({ userId: e.userId, kind: 'vacation', icon: '🎖️', label: t }); }
  }
  return notices;
}

// ------------------------------------------------------------------ apero du serveur
let aperoSeen = { hour: null, ids: new Set() };
export function beforeRequest({ store }) {
  const userId = currentContext().userId;
  if (!userId || !store.tables.has('AppSettings') || !ruleOn(store, 'chill.apero') || isTestUser(store, userId)) return;
  const hour = `${today()}:${parisHour()}`;
  if (aperoSeen.hour !== hour) aperoSeen = { hour, ids: new Set() };
  if (aperoSeen.ids.has(userId) || !store.get('Users', userId)) return;
  aperoSeen.ids.add(userId);
  const saved = appGet(store, 'apero', {});
  const a = saved.hour === hour ? saved : { hour, users: [] };
  if (!a.users.includes(userId)) a.users.push(userId);
  const cfg = vacationCfg(store);
  if (a.users.length >= n(cfg.aperoPlayers)) {
    if (!a.announced && appGet(store, 'apero-day', '') !== today()) {
      a.announced = true;
      appSet(store, 'apero-day', today());
      addFeed(store, { kind: 'vacation', icon: '🥂', text: `Apéro du serveur : ${a.users.length} joueurs réunis, c'est ma tournée !` });
    }
    for (const id of a.users) {
      const u = store.get('Users', id);
      if (!u || u.AperoDay === today()) continue;
      store.update('Users', id, { AperoDay: today(), StardustCount: n(u.StardustCount) + n(cfg.aperoDust) });
      inbox(store, id, '🥂', `Apéro du serveur : +${n(cfg.aperoDust)} poussières, à la tienne !`);
    }
  }
  appSet(store, 'apero', a);
}
function aperoView(store, user) {
  const a = appGet(store, 'apero', {});
  const here = a.hour === `${today()}:${parisHour()}` ? a.users || [] : [];
  return { here: here.length, need: n(vacationCfg(store).aperoPlayers), gifted: user.AperoDay === today(), dust: n(vacationCfg(store).aperoDust) };
}

// ------------------------------------------------------------------ marees et peche sans appat
// Cycle de 6 h (3 h haute, 3 h basse), decale chaque jour.
export function tideState(store) {
  if (!ruleOn(store, 'chill.tides')) return null;
  const offset = hashOf('tide:' + today()) % 6;
  const h = (parisHour() + offset) % 6;
  const minutes = new Date(Date.now()).getUTCMinutes();
  const high = h < 3;
  return { phase: high ? 'high' : 'low', label: high ? 'Marée haute' : 'Marée basse', changeIn: ((3 - (h % 3)) * 60 - minutes) * 60 };
}
export const EXOTIC = [
  { key: 'clown', label: 'Poisson-clown', icon: '🐠', weight: 40, dust: 10, min: 6, max: 12 },
  { key: 'parrot', label: 'Poisson-perroquet', icon: '🐟', weight: 28, dust: 15, min: 20, max: 60 },
  { key: 'puffer', label: 'Poisson-globe', icon: '🐡', weight: 15, dust: 20, min: 10, max: 35 },
  { key: 'turtle', label: 'Tortue verte', icon: '🐢', weight: 10, dust: 30, min: 50, max: 120 },
  { key: 'octopus', label: 'Poulpe des lagons', icon: '🐙', weight: 5, dust: 50, min: 30, max: 90 },
  { key: 'whale', label: 'Baleine à bosse', icon: '🐋', weight: 2, dust: 120, min: 900, max: 1500 }
];
function beachFishView(store, user) {
  const book = parseJson(user.ExoticFish, {});
  return { casts: n(vacationCfg(store).beachCasts), done: user.BeachFishDay === today(), tide: tideState(store), book: EXOTIC.map((f) => ({ key: f.key, label: f.label, icon: f.icon, dust: f.dust, count: n(book[f.key] && book[f.key].count), best: n(book[f.key] && book[f.key].best) })) };
}
function beachFish(store, user) {
  if (user.BeachFishDay === today()) return fail('already_used');
  const tide = tideState(store);
  // Maree haute : les poissons rares mordent plus.
  const table = tide && tide.phase === 'high' ? EXOTIC.map((f) => (f.weight <= 15 ? { ...f, weight: f.weight * 2.5 } : f)) : EXOTIC;
  const book = parseJson(user.ExoticFish, {});
  const catches = [];
  let dust = 0, shellCount = 0;
  let fields = {};
  const lore = [];
  for (let i = 0; i < n(vacationCfg(store).beachCasts); i++) {
    const f = pick(table);
    const size = rnd(f.min, f.max);
    const r = book[f.key] || { count: 0, best: 0 };
    book[f.key] = { count: n(r.count) + 1, best: Math.max(n(r.best), size) };
    dust += f.dust;
    catches.push({ key: f.key, label: f.label, icon: f.icon, size, dust: f.dust, record: size > n(r.best) && n(r.count) > 0 });
    // Maree basse : un coquillage sur deux lancers.
    if (tide && tide.phase === 'low' && Math.random() < 0.5) shellCount++;
    if (Math.random() < 0.15) { const l = loreFields(store, user, fields); if (l) { Object.assign(fields, l.fields); lore.push({ index: l.index, text: l.text }); } }
  }
  const sh = shellCount ? shellFields(user, shellCount, fields) : null;
  if (sh) Object.assign(fields, sh.fields);
  store.update('Users', user.id, { ...fields, BeachFishDay: today(), ExoticFish: JSON.stringify(book), StardustCount: n(user.StardustCount) + dust });
  const done = addStamp(store, user.id, 'beach');
  const bits = [catches.map((c) => c.icon).join(' '), `+${dust} ✨`, sh ? `${sh.got.map((s) => s.icon).join('')} +${shellCount} coquillage${shellCount > 1 ? 's' : ''}` : '', lore.length ? '📜 un fragment englouti' : ''];
  return ok({ catches, dust, shells: sh ? sh.got : [], lore, toast: bits.filter(Boolean).join(' · '), passport: done });
}

// ------------------------------------------------------------------ fouille de plage et chateau de sable
function beachBoard(store, user) {
  const b = parseJson(user.BeachDig, null);
  if (b && b.day === today()) return b;
  return { day: today(), chest: rnd(0, BEACH_TILES - 1), dug: {}, left: n(vacationCfg(store).beachDigs), found: false };
}
const heat = (a, b) => {
  const d = Math.abs((a % BEACH_SIDE) - (b % BEACH_SIDE)) + Math.abs(Math.floor(a / BEACH_SIDE) - Math.floor(b / BEACH_SIDE));
  return d <= 1 ? 'hot' : d === 2 ? 'warm' : 'cold';
};
const sandOn = (store) => ruleOn(store, 'chill.sandcastle') || ruleOn(store, 'chill.sharedCastle');
function beachDigView(store, user) {
  const b = beachBoard(store, user);
  return { tiles: BEACH_TILES, side: BEACH_SIDE, dug: b.dug, left: b.left, found: b.found, chest: b.found || b.left <= 0 ? b.chest : null, chestDust: n(vacationCfg(store).beachChestDust) };
}
function beachDig(store, user, body) {
  const tile = Number(body.tile);
  if (!Number.isInteger(tile) || tile < 0 || tile >= BEACH_TILES) return fail('invalid_tile');
  const b = beachBoard(store, user);
  if (b.found || b.left <= 0) return fail('already_used');
  if (b.dug[tile]) return fail('already_dug');
  const fields = {};
  const bits = [];
  let notice = null;
  b.left -= 1;
  const sand = sandOn(store) ? (tile === b.chest ? 10 : rnd(2, 5)) : 0;
  if (sand) { fields.Sand = n(user.Sand) + sand; bits.push(`+${sand} 🏝️ sable`); }
  if (tile === b.chest) {
    const dust = n(vacationCfg(store).beachChestDust);
    b.found = true;
    b.dug[tile] = 'chest';
    fields.StardustCount = n(user.StardustCount) + dust;
    fields.KeyCount = n(user.KeyCount) + 1;
    bits.unshift(`🏴‍☠️ Le coffre du pirate : +${dust} ✨ et 1 clé !`);
    const l = loreFields(store, user, fields);
    if (l) { Object.assign(fields, l.fields); bits.push('📜 un fragment englouti'); }
    addFeed(store, { userId: user.id, kind: 'vacation', icon: '🏴‍☠️', text: 'a déterré le coffre de pirate de la plage !' });
  } else {
    b.dug[tile] = heat(tile, b.chest);
    const dust = rnd(3, 10);
    fields.StardustCount = n(user.StardustCount) + dust;
    bits.unshift(`${{ hot: '🔥 Tout près !', warm: '🌡️ Pas loin…', cold: '❄️ Rien par ici.' }[b.dug[tile]]} +${dust} ✨`);
    if (Math.random() < 0.25) { const sh = shellFields(user, 1, fields); Object.assign(fields, sh.fields); bits.push(`${sh.got[0].icon} un coquillage`); }
  }
  store.update('Users', user.id, { ...fields, BeachDig: JSON.stringify(b) });
  if (tile === b.chest) notice = bumpStat(store, user.id, 'chests');
  const done = addStamp(store, user.id, 'beach');
  return ok({ toast: bits.join(' · '), passport: done, cosmetic: notice });
}
// Chateau personnel : 6 etages par mois.
export const CASTLE = [
  { sand: 10, reward: { dust: 40 }, label: 'Les fondations' }, { sand: 20, reward: { dust: 60 }, label: 'Le rempart' },
  { sand: 30, shells: 2, reward: { dust: 80 }, label: 'La tour de guet' }, { sand: 45, shells: 4, reward: { keys: 1 }, label: 'Le pont-levis' },
  { sand: 60, shells: 6, reward: { dust: 150 }, label: 'Le donjon' }, { sand: 80, shells: 10, reward: { dust: 200 }, label: 'Le drapeau' }
];
const castleOf = (user) => { const c = parseJson(user.Castle, {}); return c && c.month === monthOf() ? c : { month: monthOf(), level: 0 }; };
function castleView(user) {
  const c = castleOf(user);
  return { level: c.level, floors: CASTLE.map((f, i) => ({ ...f, built: i < c.level })), next: CASTLE[c.level] || null, sand: n(user.Sand), shells: n(user.Shells) };
}
function castleBuild(store, user) {
  const c = castleOf(user);
  const f = CASTLE[c.level];
  if (!f) return fail('castle_done');
  if (n(user.Sand) < f.sand || n(user.Shells) < n(f.shells)) return fail('not_enough_sand', 400, castleView(user));
  const fields = { Sand: n(user.Sand) - f.sand, Shells: n(user.Shells) - n(f.shells), Castle: JSON.stringify({ month: c.month, level: c.level + 1 }) };
  if (f.reward.dust) fields.StardustCount = n(user.StardustCount) + f.reward.dust;
  if (f.reward.keys) fields.KeyCount = n(user.KeyCount) + f.reward.keys;
  store.update('Users', user.id, fields);
  const notice = bumpStat(store, user.id, 'castleTop', c.level + 1, true);
  if (c.level + 1 === CASTLE.length) addFeed(store, { userId: user.id, kind: 'vacation', icon: '🏰', text: 'a terminé son château de sable : drapeau planté !' });
  return ok({ toast: `🏰 ${f.label} : ${f.reward.dust ? `+${f.reward.dust} ✨` : `+${f.reward.keys} clé`}`, cosmetic: notice });
}
// Chateau commun : 5 etages par semaine, chaque etage recompense les participants.
const SHARED_FLOORS = 5;
function sharedGoal(store) {
  const since = now() - 7 * 86400;
  const active = store.getAll('Users').filter((u) => n(u.LastSeenAt) >= since).length;
  return Math.max(30, active * 10);
}
function sharedState(store) {
  const s = appGet(store, 'shared-castle', {});
  return s.week === weekKey() ? s : { week: weekKey(), total: 0, contrib: {}, floors: 0, goal: sharedGoal(store) };
}
function sharedView(store, user) {
  const s = sharedState(store);
  return { week: s.week, total: s.total, goal: s.goal, floors: s.floors, maxFloors: SHARED_FLOORS, mine: n(s.contrib[user.id]), builders: Object.keys(s.contrib).length, sand: n(user.Sand), reward: 40 };
}
function castleDonate(store, user, body) {
  const amount = Math.floor(Number(body.n) || 0);
  if (amount < 1) return fail('invalid_amount');
  if (n(user.Sand) < amount) return fail('not_enough_sand');
  const s = sharedState(store);
  if (s.floors >= SHARED_FLOORS) return fail('castle_done');
  store.update('Users', user.id, { Sand: n(user.Sand) - amount });
  s.contrib[user.id] = n(s.contrib[user.id]) + amount;
  s.total += amount;
  let reached = 0;
  const notices = [];
  while (s.floors < SHARED_FLOORS && s.total >= (s.floors + 1) * s.goal) {
    s.floors++; reached++;
    for (const uid of Object.keys(s.contrib)) {
      const u = store.get('Users', Number(uid));
      if (!u) continue;
      store.update('Users', u.id, { StardustCount: n(u.StardustCount) + 40 });
      if (u.id !== user.id) inbox(store, u.id, '🏯', `Le château de sable commun gagne son étage ${s.floors} : +40 poussières !`);
      if (s.floors === SHARED_FLOORS) { const t = bumpStat(store, u.id, 'sharedTop'); if (t && u.id === user.id) notices.push(t); }
    }
    addFeed(store, { kind: 'vacation', icon: '🏯', text: `Le château de sable commun atteint l’étage ${s.floors} grâce à ${Object.keys(s.contrib).length} bâtisseurs !` });
  }
  appSet(store, 'shared-castle', s);
  return ok({ toast: reached ? `🏯 Étage ${s.floors} atteint ! +${40 * reached} ✨` : `🏯 +${amount} sable au château commun`, cosmetic: notices[0] || null });
}

// ------------------------------------------------------------------ carnet exotique
const BOOKS = {
  fish: { label: 'Poissons exotiques', size: () => EXOTIC.length, have: (u) => EXOTIC.filter((f) => n((parseJson(u.ExoticFish, {})[f.key] || {}).count) > 0).length, reward: { dust: 200, cosmetic: { key: 'roi-lagon', type: 'title', label: 'Roi du lagon 🐠' } } },
  shells: { label: 'Coquillages', size: () => SHELLS.length, have: (u) => SHELLS.filter((s) => n(parseJson(u.ShellBook, {})[s.key]) > 0).length, reward: { dust: 200, cosmetic: { key: 'frame-nacre', type: 'frame', label: 'Cadre Nacré' } } },
  lore: { label: 'Bibliothèque engloutie', size: () => SEA_LORE.length, have: (u) => parseJson(u.SeaLore, []).length, reward: { dust: 300, cosmetic: { key: 'archeologue-lagons', type: 'title', label: 'Archéologue des lagons 🐚' } } }
};
function bookView(store, user) {
  const claimed = parseJson(user.BookClaims, []);
  const fish = parseJson(user.ExoticFish, {}), shells = parseJson(user.ShellBook, {}), lore = parseJson(user.SeaLore, []);
  return {
    open: ruleOn(store, 'chill.exoticBook'),
    sections: Object.entries(BOOKS).map(([key, b]) => ({ key, label: b.label, have: b.have(user), size: b.size(), claimed: claimed.includes(key), reward: { dust: b.reward.dust, label: b.reward.cosmetic.label } })),
    fish: EXOTIC.map((f) => ({ key: f.key, label: f.label, icon: f.icon, count: n((fish[f.key] || {}).count), best: n((fish[f.key] || {}).best) })),
    shells: SHELLS.map((s) => ({ key: s.key, label: s.label, icon: s.icon, count: n(shells[s.key]) })),
    lore: SEA_LORE.map((text, i) => (lore.includes(i) ? { index: i, text } : { index: i, text: null }))
  };
}
function bookClaim(store, user, body) {
  const b = BOOKS[body.section];
  if (!b) return fail('unknown_section');
  const claimed = parseJson(user.BookClaims, []);
  if (claimed.includes(body.section)) return fail('already_claimed');
  if (b.have(user) < b.size()) return fail('book_incomplete');
  store.update('Users', user.id, { BookClaims: JSON.stringify([...claimed, body.section]), StardustCount: n(user.StardustCount) + b.reward.dust });
  const c = b.reward.cosmetic;
  grantCosmetic(store, user.id, c.key, { type: c.type, label: c.label });
  addFeed(store, { userId: user.id, kind: 'vacation', icon: '📔', text: `complète le carnet « ${b.label} » !` });
  return ok({ toast: `📔 Carnet « ${b.label} » complet : +${b.reward.dust} ✨ et ${c.type === 'frame' ? 'le' : 'le titre'} « ${c.label} »` });
}

// ------------------------------------------------------------------ doublons au soleil
function sunbathing(store, userId) {
  return store.rowsBy('Pulls', 'User', userId).filter((p) => n(p.SunbathUntil) > 0);
}
function sunbathView(store, user) {
  const list = sunbathing(store, user.id).map((p) => {
    const card = store.get('Cards', refId(p.Card));
    return card ? { pullId: p.id, card: cardSummary(store, card), quality: p.Quality || 'damaged', serialNumber: p.SerialNumber, until: n(p.SunbathUntil), ready: n(p.SunbathUntil) <= now() } : null;
  }).filter(Boolean);
  return { list, slots: n(vacationCfg(store).sunbathSlots), chance: Number(vacationCfg(store).sunbathChance) || 0 };
}
function sunbathStart(store, user, body) {
  const pull = store.get('Pulls', Number(body.pullId));
  if (!pull || refId(pull.User) !== user.id) return fail('copy_not_owned');
  if (n(pull.SunbathUntil) > 0) return fail('already_sunbathing');
  if ((pull.Quality || 'damaged') === 'mint') return fail('already_mint');
  if (pull.InVault) return fail('copy_in_vault');
  if (store.rowsBy('Pulls', 'User', user.id).filter((p) => refId(p.Card) === refId(pull.Card)).length < 2) return fail('not_a_duplicate');
  if (sunbathing(store, user.id).length >= n(vacationCfg(store).sunbathSlots)) return fail('no_free_slot');
  store.update('Pulls', pull.id, { SunbathUntil: now() + SUNBATH_SECONDS });
  return ok({ toast: '🏖️ Ton doublon bronze pour 24 h.' });
}
function sunbathClaim(store, user, body) {
  const pull = store.get('Pulls', Number(body.pullId));
  if (!pull || refId(pull.User) !== user.id || n(pull.SunbathUntil) <= 0) return fail('copy_not_owned');
  if (n(pull.SunbathUntil) > now()) return fail('too_soon', 429, { at: n(pull.SunbathUntil) });
  const q = QUALITY.indexOf(pull.Quality || 'damaged');
  const up = q >= 0 && q < QUALITY.length - 1 && Math.random() < (Number(vacationCfg(store).sunbathChance) || 0);
  store.update('Pulls', pull.id, { SunbathUntil: 0, ...(up ? { Quality: QUALITY[q + 1] } : {}) });
  return ok({ improved: up, toast: up ? '☀️ Le soleil lui a fait du bien : un cran d’état en plus !' : '🏖️ Bien reposé, mais pas de changement.' });
}

// ------------------------------------------------------------------ amis
const friendsOf = (user) => parseJson(user.Friends, []).map(Number).filter(Boolean);
function friendsView(store, user) {
  const list = friendsOf(user).map((id) => store.get('Users', id)).filter((u) => u && !isTestUser(store, u.id));
  return { enabled: ruleOn(store, 'chill.friends'), max: 50, friends: list.map((u) => ({ userId: u.id, pseudo: u.Pseudo || '?', avatar: u.DiscordAvatar || '', lastSeenAt: n(u.LastSeenAt) })) };
}
function friendsHandler({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(friendsView(store, user));
  if (!ruleOn(store, 'chill.friends')) return fail('wrong_mode', 400, { rule: 'chill.friends' });
  const list = friendsOf(user);
  if (action === 'add') {
    const pseudo = String(body.pseudo || '').trim().toLowerCase();
    const f = store.getAll('Users').find((u) => String(u.Pseudo || '').trim().toLowerCase() === pseudo);
    if (!f || f.id === user.id || isTestUser(store, f.id)) return fail('unknown_target');
    if (list.includes(f.id)) return fail('already_friend');
    if (list.length >= 50) return fail('too_many_friends');
    store.update('Users', user.id, { Friends: JSON.stringify([...list, f.id]) });
    return ok({ ...friendsView(store, store.get('Users', user.id)), toast: `🤝 ${f.Pseudo} ajouté à tes amis.` });
  }
  if (action === 'remove') {
    store.update('Users', user.id, { Friends: JSON.stringify(list.filter((id) => id !== Number(body.friendId))) });
    return ok(friendsView(store, store.get('Users', user.id)));
  }
  return fail('unknown_action');
}

// ------------------------------------------------------------------ route
function status(store, user) {
  const cfg = vacationCfg(store);
  const out = { sand: n(user.Sand), shells: n(user.Shells) };
  if (ruleOn(store, 'chill.nap')) {
    const nap = parseJson(user.NapState, null);
    out.nap = { hours: n(cfg.napHours), worms: n(cfg.napWorms), dust: n(cfg.napDust), claimed: user.NapDay === today(), until: nap ? n(nap.until) : 0 };
  }
  if (ruleOn(store, 'chill.sunset')) out.sunset = { ...sunsetState(store), dust: n(cfg.sunsetDust), claimed: user.SunsetDay === today() };
  if (ruleOn(store, 'chill.postcard')) out.postcard = { sent: user.PostcardDay === today(), gift: n(cfg.postcardGift) };
  const cards = parseJson(user.Postcards, []);
  if (ruleOn(store, 'chill.postcard') || cards.length) out.postcards = cards.map((p) => { const c = store.get('Cards', Number(p.cardId)); return c ? { ...p, card: cardSummary(store, c) } : null; }).filter(Boolean).reverse();
  if (ruleOn(store, 'chill.beachFishing')) out.beachFish = beachFishView(store, user);
  if (ruleOn(store, 'chill.tides')) out.tide = tideState(store);
  if (ruleOn(store, 'chill.beachDig')) out.beachDig = beachDigView(store, user);
  if (ruleOn(store, 'chill.sandcastle')) out.castle = castleView(user);
  if (ruleOn(store, 'chill.sharedCastle')) out.sharedCastle = sharedView(store, user);
  if (ruleOn(store, 'chill.seaLore') || parseJson(user.SeaLore, []).length) out.seaLore = { open: ruleOn(store, 'chill.seaLore'), found: parseJson(user.SeaLore, []).length, total: SEA_LORE.length, pages: bookView(store, user).lore };
  if (ruleOn(store, 'chill.petHoliday')) out.petHoliday = { taken: user.PetPhotoDay === today(), dust: n(cfg.photoDust), pets: Object.entries(PETS).filter(([k]) => petAdopted(store, user, k)).map(([k, p]) => ({ pet: k, label: p.label, icon: p.icon, love: Math.round(loveOf(store, user, k)) })) };
  if (ruleOn(store, 'chill.apero')) out.apero = aperoView(store, user);
  if (ruleOn(store, 'chill.passport')) out.passport = passportView(store, user);
  if (ruleOn(store, 'chill.vacationCosmetics')) out.cosmetics = cosmeticsView(store, user);
  if (ruleOn(store, 'chill.exoticBook')) out.book = bookView(store, user);
  const bath = sunbathView(store, user);
  if (ruleOn(store, 'chill.sunbath') || bath.list.length) out.sunbath = { ...bath, open: ruleOn(store, 'chill.sunbath') };
  return out;
}

function handle({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const cfg = vacationCfg(store);
  const action = body.action || 'status';
  const need = (key) => (ruleOn(store, key) ? null : fail('wrong_mode', 400, { rule: key }));
  let denied;
  switch (action) {
    case 'status': return ok(status(store, user));
    case 'nap-start': {
      if ((denied = need('chill.nap'))) return denied;
      if (user.NapDay === today()) return fail('already_used');
      if (parseJson(user.NapState, null)) return fail('already_napping');
      store.update('Users', user.id, { NapState: JSON.stringify({ start: now(), until: now() + Math.round(Number(cfg.napHours) * 3600) }) });
      return ok({ toast: '🛌 Bonne sieste ! Ne joue pas d’ici là, sinon tu te réveilles.' });
    }
    case 'nap-claim': {
      if ((denied = need('chill.nap'))) return denied;
      const nap = parseJson(user.NapState, null);
      if (!nap) return fail('not_napping');
      if (nap.until > now()) return fail('too_soon', 429, { at: nap.until });
      store.update('Users', user.id, { NapState: '', NapDay: today(), Worms: n(user.Worms) + n(cfg.napWorms), StardustCount: n(user.StardustCount) + n(cfg.napDust) });
      return ok({ toast: `😌 Bien reposé : +${n(cfg.napWorms)} vers et +${n(cfg.napDust)} ✨` });
    }
    case 'sunset-claim': {
      if ((denied = need('chill.sunset'))) return denied;
      if (!sunsetState(store).active) return fail('sunset_closed');
      if (user.SunsetDay === today()) return fail('already_used');
      store.update('Users', user.id, { SunsetDay: today(), StardustCount: n(user.StardustCount) + n(cfg.sunsetDust) });
      return ok({ toast: `🌅 Quel beau coucher de soleil : +${n(cfg.sunsetDust)} ✨` });
    }
    case 'postcard': {
      if ((denied = need('chill.postcard'))) return denied;
      if (user.PostcardDay === today()) return fail('already_used');
      const pseudo = String(body.toPseudo || '').trim().toLowerCase();
      const to = store.getAll('Users').find((u) => String(u.Pseudo || '').trim().toLowerCase() === pseudo);
      if (!to || to.id === user.id || isTestUser(store, to.id)) return fail('unknown_target');
      const pull = store.get('Pulls', Number(body.pullId));
      if (!pull || refId(pull.User) !== user.id) return fail('copy_not_owned');
      const card = store.get('Cards', refId(pull.Card));
      if (!card) return fail('copy_not_owned');
      const message = String(body.message || '').trim().slice(0, 140);
      const list = parseJson(to.Postcards, []).slice(-9);
      list.push({ at: now(), from: user.Pseudo || 'Un joueur', cardId: card.id, finish: pull.Finish || 'normal', quality: pull.Quality || null, message });
      store.update('Users', to.id, { Postcards: JSON.stringify(list), StardustCount: n(to.StardustCount) + n(cfg.postcardGift) });
      store.update('Users', user.id, { PostcardDay: today() });
      inbox(store, to.id, '💌', `${user.Pseudo || 'Un joueur'} t'envoie une carte postale : +${n(cfg.postcardGift)} poussières !`);
      addFeed(store, { userId: user.id, kind: 'vacation', icon: '💌', text: `envoie une carte postale à ${to.Pseudo || 'un ami'}.` });
      // Le mot reste prive : Discord ne recoit que la carte et les pseudos.
      const posted = body.discord === true ? announce(store, 'postcard', { pseudo: user.Pseudo || 'Un joueur', to: to.Pseudo || 'un ami', card: card.Name }, { cardId: card.id }) : false;
      return ok({ posted, toast: `💌 Carte postale envoyée à ${to.Pseudo || 'ton ami'} !` });
    }
    case 'beach-fish':
      if ((denied = need('chill.beachFishing'))) return denied;
      return beachFish(store, user);
    case 'beach-dig':
      if ((denied = need('chill.beachDig'))) return denied;
      return beachDig(store, user, body);
    case 'castle-build':
      if ((denied = need('chill.sandcastle'))) return denied;
      return castleBuild(store, user);
    case 'castle-donate':
      if ((denied = need('chill.sharedCastle'))) return denied;
      return castleDonate(store, user, body);
    case 'book-claim':
      if ((denied = need('chill.exoticBook'))) return denied;
      return bookClaim(store, user, body);
    case 'pet-photo': {
      if ((denied = need('chill.petHoliday'))) return denied;
      const pet = String(body.pet || '');
      if (!PETS[pet] || !petAdopted(store, user, pet)) return fail('unknown_pet');
      const first = user.PetPhotoDay !== today();
      if (first) store.update('Users', user.id, { PetPhotoDay: today(), StardustCount: n(user.StardustCount) + n(cfg.photoDust) });
      return ok({ photo: { pet, label: PETS[pet].label, icon: PETS[pet].icon, fem: !!PETS[pet].fem, love: Math.round(loveOf(store, user, pet)), pseudo: user.Pseudo || '' }, ...(first ? { toast: `📸 Photo souvenir : +${n(cfg.photoDust)} ✨` } : {}) });
    }
    case 'sunbath-start':
      if ((denied = need('chill.sunbath'))) return denied;
      return sunbathStart(store, user, body);
    case 'sunbath-claim':
      return sunbathClaim(store, user, body);
    default:
      return fail('unknown_action');
  }
}

export function _reset() { aperoSeen = { hour: null, ids: new Set() }; }
export const routes = { 'POST vacation': handle, 'POST friends': friendsHandler };
