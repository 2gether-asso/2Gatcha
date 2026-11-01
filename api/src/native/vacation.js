// Vacances du mode Chill (2026-11-01), activables une par une (moderules.js,
// Admin > Difficultes), valeurs reglables (ChillVacation) :
//  - sieste au hamac : ne rien faire pendant quelques heures, une fois par jour ;
//  - coucher de soleil : cadeau pendant quelques minutes, le soir ;
//  - carte postale : une carte de sa collection envoyee a un ami (Discord en option) ;
//  - peche sans appat : quelques lancers par jour, poissons exotiques et leur carnet ;
//  - fouille de plage : petite grille sans energie, un coffre de pirate a trouver ;
//  - transat des compagnons : photo souvenir (affection doublee : pets.js) ;
//  - apero du serveur : assez de joueurs dans la meme heure, cadeau pour eux ;
//  - passeport : un tampon par activite et par jour, carnet complet = titre et cadre ;
//  - doublons au soleil : 24 h de bronzage, jamais de perte, parfois un cran d'etat.
// (Cocktails : cooking.js ; graine tropicale : garden.js.)
//   POST /webhook/vacation { userId, action, ... }
//     status | nap-start | nap-claim | sunset-claim | postcard {toPseudo, pullId, message?, discord?}
//     beach-fish | beach-dig {tile} | pet-photo {pet} | sunbath-start {pullId} | sunbath-claim {pullId}

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

export const schema = {
  Users: {
    NapState: { type: 'Text' }, NapDay: { type: 'Text' }, SunsetDay: { type: 'Text' }, PostcardDay: { type: 'Text' }, Postcards: { type: 'Text' },
    BeachFishDay: { type: 'Text' }, ExoticFish: { type: 'Text' }, BeachDig: { type: 'Text' }, PetPhotoDay: { type: 'Text' }, AperoDay: { type: 'Text' }, Passport: { type: 'Text' }
  },
  Pulls: { SunbathUntil: { type: 'Numeric' } }
};

const n = (v) => Number(v) || 0;
const today = () => parisDay(0);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const QUALITY = ['damaged', 'worn', 'good', 'mint'];
const SUNBATH_SECONDS = 24 * 3600;
const BEACH_TILES = 16, BEACH_SIDE = 4;

function appGet(store, key, def) { const r = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === key) : null; return r ? parseJson(r.Value, def) : def; }
function appSet(store, key, value) {
  const r = store.getAll('AppSettings').find((x) => x.Key === key);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: key, Value: JSON.stringify(value) });
}

// ------------------------------------------------------------------ passeport
export const STAMPS = {
  dig: { label: 'Fouille', icon: '⛏️' }, fish: { label: 'Pêche', icon: '🎣' }, harvest: { label: 'Jardin', icon: '🌱' }, booster: { label: 'Booster', icon: '🃏' },
  atelier: { label: 'Atelier', icon: '🛠️' }, boss: { label: 'Boss', icon: '🗡️' }, casino: { label: 'Casino', icon: '🎰' }, archeo: { label: 'Archéologie', icon: '🏺' },
  cook: { label: 'Cuisine', icon: '🍳' }, beach: { label: 'Plage', icon: '🏖️' }
};
const STAMP_OF = { dig: 'dig', fish: 'fish', harvest: 'harvest', boosterOpened: 'booster', craft: 'atelier', disenchant: 'atelier', fusion: 'atelier', repair: 'atelier', bossAttack: 'boss', casinoPlay: 'casino', tablet: 'archeo', cook: 'cook' };
const passportOf = (user) => { const p = parseJson(user.Passport, {}); return p && typeof p === 'object' ? p : {}; };
// Renvoie la nouvelle du carnet complet, ou null.
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

// Sieste interrompue et tampons du passeport.
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

// ------------------------------------------------------------------ peche sans appat
export const EXOTIC = [
  { key: 'clown', label: 'Poisson-clown', icon: '🐠', weight: 40, dust: 10, min: 6, max: 12 },
  { key: 'parrot', label: 'Poisson-perroquet', icon: '🐟', weight: 28, dust: 15, min: 20, max: 60 },
  { key: 'puffer', label: 'Poisson-globe', icon: '🐡', weight: 15, dust: 20, min: 10, max: 35 },
  { key: 'turtle', label: 'Tortue verte', icon: '🐢', weight: 10, dust: 30, min: 50, max: 120 },
  { key: 'octopus', label: 'Poulpe des lagons', icon: '🐙', weight: 5, dust: 50, min: 30, max: 90 },
  { key: 'whale', label: 'Baleine à bosse', icon: '🐋', weight: 2, dust: 120, min: 900, max: 1500 }
];
function rollExotic() {
  let r = Math.random() * EXOTIC.reduce((s, f) => s + f.weight, 0);
  for (const f of EXOTIC) { r -= f.weight; if (r <= 0) return f; }
  return EXOTIC[0];
}
function beachFishView(store, user) {
  const book = parseJson(user.ExoticFish, {});
  return { casts: n(vacationCfg(store).beachCasts), done: user.BeachFishDay === today(), book: EXOTIC.map((f) => ({ key: f.key, label: f.label, icon: f.icon, dust: f.dust, count: n(book[f.key] && book[f.key].count), best: n(book[f.key] && book[f.key].best) })) };
}
function beachFish(store, user) {
  if (user.BeachFishDay === today()) return fail('already_used');
  const book = parseJson(user.ExoticFish, {});
  const catches = [];
  let dust = 0;
  for (let i = 0; i < n(vacationCfg(store).beachCasts); i++) {
    const f = rollExotic();
    const size = rnd(f.min, f.max);
    const r = book[f.key] || { count: 0, best: 0 };
    book[f.key] = { count: n(r.count) + 1, best: Math.max(n(r.best), size) };
    dust += f.dust;
    catches.push({ key: f.key, label: f.label, icon: f.icon, size, dust: f.dust, record: size > n(r.best) && n(r.count) > 0 });
  }
  store.update('Users', user.id, { BeachFishDay: today(), ExoticFish: JSON.stringify(book), StardustCount: n(user.StardustCount) + dust });
  const done = addStamp(store, user.id, 'beach');
  return ok({ catches, dust, toast: `${catches.map((c) => c.icon).join(' ')} +${dust} ✨`, passport: done });
}

// ------------------------------------------------------------------ fouille de plage
function beachBoard(store, user) {
  const b = parseJson(user.BeachDig, null);
  if (b && b.day === today()) return b;
  return { day: today(), chest: rnd(0, BEACH_TILES - 1), dug: {}, left: n(vacationCfg(store).beachDigs), found: false };
}
const heat = (a, b) => {
  const d = Math.abs((a % BEACH_SIDE) - (b % BEACH_SIDE)) + Math.abs(Math.floor(a / BEACH_SIDE) - Math.floor(b / BEACH_SIDE));
  return d <= 1 ? 'hot' : d === 2 ? 'warm' : 'cold';
};
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
  let toast;
  b.left -= 1;
  if (tile === b.chest) {
    const dust = n(vacationCfg(store).beachChestDust);
    b.found = true;
    b.dug[tile] = 'chest';
    fields.StardustCount = n(user.StardustCount) + dust;
    fields.KeyCount = n(user.KeyCount) + 1;
    toast = `🏴‍☠️ Le coffre du pirate : +${dust} ✨ et 1 clé !`;
    addFeed(store, { userId: user.id, kind: 'vacation', icon: '🏴‍☠️', text: 'a déterré le coffre de pirate de la plage !' });
  } else {
    b.dug[tile] = heat(tile, b.chest);
    const dust = rnd(3, 10);
    fields.StardustCount = n(user.StardustCount) + dust;
    toast = `${{ hot: '🔥 Tout près !', warm: '🌡️ Pas loin…', cold: '❄️ Rien par ici.' }[b.dug[tile]]} +${dust} ✨`;
  }
  store.update('Users', user.id, { ...fields, BeachDig: JSON.stringify(b) });
  const done = addStamp(store, user.id, 'beach');
  return ok({ toast, passport: done });
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

// ------------------------------------------------------------------ route
function status(store, user) {
  const cfg = vacationCfg(store);
  const out = {};
  if (ruleOn(store, 'chill.nap')) {
    const nap = parseJson(user.NapState, null);
    out.nap = { hours: n(cfg.napHours), worms: n(cfg.napWorms), dust: n(cfg.napDust), claimed: user.NapDay === today(), until: nap ? n(nap.until) : 0 };
  }
  if (ruleOn(store, 'chill.sunset')) out.sunset = { ...sunsetState(store), dust: n(cfg.sunsetDust), claimed: user.SunsetDay === today() };
  if (ruleOn(store, 'chill.postcard')) out.postcard = { sent: user.PostcardDay === today(), gift: n(cfg.postcardGift) };
  if (ruleOn(store, 'chill.postcard') || parseJson(user.Postcards, []).length) out.postcards = parseJson(user.Postcards, []).map((p) => { const c = store.get('Cards', Number(p.cardId)); return c ? { ...p, card: cardSummary(store, c) } : null; }).filter(Boolean).reverse();
  if (ruleOn(store, 'chill.beachFishing')) out.beachFish = beachFishView(store, user);
  if (ruleOn(store, 'chill.beachDig')) out.beachDig = beachDigView(store, user);
  if (ruleOn(store, 'chill.petHoliday')) out.petHoliday = { taken: user.PetPhotoDay === today(), dust: n(cfg.photoDust), pets: Object.entries(PETS).filter(([k]) => petAdopted(store, user, k)).map(([k, p]) => ({ pet: k, label: p.label, icon: p.icon, love: Math.round(loveOf(store, user, k)) })) };
  if (ruleOn(store, 'chill.apero')) out.apero = aperoView(store, user);
  if (ruleOn(store, 'chill.passport')) out.passport = passportView(store, user);
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
      const nap = parseJson(user.NapState, null);
      if (nap) return fail('already_napping');
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
export const routes = { 'POST vacation': handle };
