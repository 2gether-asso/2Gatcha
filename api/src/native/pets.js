// Tendresse pour Milo (chien de fouille) et Moka (chat pecheur), 2026-10-25.
// Chaque animal a une jauge d'affection de 0 a 100 qui baisse avec le temps
// (PetLoveDecayPerHour points par heure). Trois gestes pour la remplir :
//  - Caresse : gratuite, toutes les PetCuddleMinutes ;
//  - Jeu : gratuit, toutes les PetPlayHours, rapporte plus ;
//  - Friandise : coute PetTreatPrice poussieres, PetTreatsPerDay par jour.
// L'affection rend l'animal plus productif et plus genereux :
//  - vitesse : jusqu'a PetMaxSpeedPct % de temps en moins entre deux coups de
//    pelle de Milo (dig.json lit Users.MiloSpeed, ecrit juste avant la
//    fouille) ou deux lancers de Moka (cat.js) ;
//  - butin : jusqu'a PetMaxLootPct % de poussieres en plus sur ce qu'ils
//    rapportent, et au-dela de 80 d'affection une chance de petit cadeau.
// Fatigue (2026-10-26, a la place des os / poissons limites par jour) : ils
// travaillent par cycles de PetWorkMinutes puis font une pause de
// PetRestMinutes (jusqu'a 50 % plus courte avec la tendresse). Le rythme moyen
// en tient compte : dig.json lit Users.MiloRest (intervalle x (travail+pause)/travail),
// cat.js aussi pour Moka. La jauge affichee suit le cycle en cours.
// 2026-10-30 : Noisette la lapine (jardin) et Pistache le herisson
// (archeologie) ont la meme jauge ; la tarte aux baies (cooking.js) la
// compte pleine le temps de son bonus.
//   POST /webhook/pets { userId, action: 'status' | 'cuddle' | 'play' | 'treat', pet: 'milo' | 'moka' | 'noisette' | 'pistache' }
// Users.PetLove = { milo: { v, at, cuddle, play, treats, treatDay }, moka: {...} }

import { ok, fail, userById, now, parisDay, parseJson } from './common.js';
import { setting } from './settings.js';
import { buffOn } from './cooking.js';

export const schema = { Users: { PetLove: { type: 'Text' }, MiloSpeed: { type: 'Numeric' }, MiloRest: { type: 'Numeric' } } };

export const PETS = {
  milo: { label: 'Milo', icon: '🐕', gifts: [{ field: 'BoneCount', label: 'un os', icon: '🦴' }, { field: 'Worms', label: '2 vers', icon: '🪱', n: 2 }, { field: 'KeyCount', label: 'une clé', icon: '🔑', rare: true }] },
  moka: { label: 'Moka', icon: '🐈', fem: true, gifts: [{ field: 'CatFish', label: 'un poisson', icon: '🐟' }, { field: 'GoldBait', label: 'un appât doré', icon: '✨' }, { field: 'SpareParts', label: 'une pièce détachée', icon: '🔩', rare: true }] },
  // 2026-10-30 : Noisette (jardin, garden.js) et Pistache (archeologie, archeo.js).
  noisette: { label: 'Noisette', icon: '🐇', fem: true, gifts: [{ field: 'Worms', label: '3 vers', icon: '🪱', n: 3 }, { field: 'GoldBait', label: 'un appât doré', icon: '✨' }, { field: 'SpareParts', label: 'une pièce détachée', icon: '🔩', rare: true }] },
  pistache: { label: 'Pistache', icon: '🦔', gifts: [{ field: 'Worms', label: '2 vers', icon: '🪱', n: 2 }, { field: 'Tablets', label: 'une tablette d’argile', icon: '🟫' }, { field: 'KeyCount', label: 'une clé', icon: '🔑', rare: true }] }
};
const GESTURES = {
  cuddle: { label: 'Caresse', icon: '🤲', love: 'PetCuddleLove' },
  play: { label: 'Jeu', icon: '🎾', love: 'PetPlayLove' },
  treat: { label: 'Friandise', icon: '🍖', love: 'PetTreatLove' }
};

function allLove(user) {
  const v = parseJson(user && user.PetLove, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
// Affection actuelle (avec la baisse depuis le dernier geste).
export function loveOf(store, user, pet, t = now()) {
  const p = allLove(user)[pet];
  if (!p) return 0;
  const hours = Math.max(0, (t - (Number(p.at) || t)) / 3600);
  return Math.max(0, Math.min(100, (Number(p.v) || 0) - hours * setting(store, 'PetLoveDecayPerHour')));
}
// Bonus de l'animal : fractions (0,25 = 25 %).
export function petBoost(store, user, pet) {
  if (!setting(store, 'PetLoveEnabled')) return { love: 0, speed: 0, loot: 0, giftChance: 0 };
  // Tarte aux baies (cooking.js) : ils travaillent comme s'ils t'adoraient.
  const love = buffOn(user, 'pets') ? 100 : loveOf(store, user, pet);
  const k = love / 100;
  return {
    love,
    speed: Math.round(k * setting(store, 'PetMaxSpeedPct')) / 100,
    loot: Math.round(k * setting(store, 'PetMaxLootPct')) / 100,
    giftChance: love >= 80 ? setting(store, 'PetGiftChance') : 0
  };
}
// Fatigue : minutes de travail et de pause d'un cycle, et la jauge du moment.
export function petRhythm(store, user, pet, t = now()) {
  const work = Math.max(5, setting(store, 'PetWorkMinutes'));
  const love = loveOf(store, user, pet, t);
  const rest = Math.max(0, setting(store, 'PetRestMinutes') * (1 - (love / 100) * 0.5));
  const cycle = work + rest;
  const phase = ((t / 60) + (Number(user.id) || 0) * 7 + ({ moka: 23, noisette: 11, pistache: 37 }[pet] || 0)) % cycle;
  const resting = phase >= work;
  return {
    workMinutes: work, restMinutes: Math.round(rest), factor: rest > 0 ? cycle / work : 1, resting,
    fatigue: Math.round(resting ? 100 - ((phase - work) / Math.max(1, rest)) * 100 : (phase / work) * 100),
    nextChange: Math.round(((resting ? cycle : work) - phase) * 60)
  };
}
// Petit cadeau d'un animal tres aime : champs a ecrire et libelle, ou null.
export function petGift(store, user, pet) {
  const b = petBoost(store, user, pet);
  if (!b.giftChance || Math.random() >= b.giftChance) return null;
  const pool = PETS[pet].gifts.filter((g) => !g.rare || Math.random() < 0.2);
  const g = pool[Math.floor(Math.random() * pool.length)];
  const n = g.n || 1;
  return { fields: { [g.field]: (Number(user[g.field]) || 0) + n }, gift: { icon: g.icon, label: g.label, field: g.field, n } };
}

function cooldowns(store) {
  return { cuddle: setting(store, 'PetCuddleMinutes') * 60, play: setting(store, 'PetPlayHours') * 3600 };
}
function petView(store, user, pet, t = now()) {
  const p = allLove(user)[pet] || {};
  const cd = cooldowns(store);
  const b = petBoost(store, user, pet);
  const treats = p.treatDay === parisDay(0) ? Number(p.treats) || 0 : 0;
  const next = (k) => Math.max(0, (Number(p[k]) || 0) + cd[k] - t);
  const mood = b.love >= 80 ? { key: 'adore', label: 'Il t’adore', icon: '😻' } : b.love >= 50 ? { key: 'happy', label: 'Heureux', icon: '😊' } : b.love >= 20 ? { key: 'ok', label: 'Ça va', icon: '🙂' } : { key: 'lonely', label: 'Il s’ennuie de toi', icon: '🥺' };
  if (PETS[pet].fem) mood.label = mood.label.replace('Il ', 'Elle ').replace('Heureux', 'Heureuse');
  return {
    pet, label: PETS[pet].label, icon: PETS[pet].icon, fem: !!PETS[pet].fem, love: Math.round(b.love), mood, cooked: buffOn(user, 'pets'),
    speedPct: Math.round(b.speed * 100), lootPct: Math.round(b.loot * 100), giftChance: b.giftChance,
    gestures: {
      cuddle: { ...GESTURES.cuddle, gain: setting(store, 'PetCuddleLove'), wait: next('cuddle') },
      play: { ...GESTURES.play, gain: setting(store, 'PetPlayLove'), wait: next('play') },
      treat: { ...GESTURES.treat, gain: setting(store, 'PetTreatLove'), price: setting(store, 'PetTreatPrice'), left: Math.max(0, setting(store, 'PetTreatsPerDay') - treats) }
    },
    maxSpeedPct: setting(store, 'PetMaxSpeedPct'), maxLootPct: setting(store, 'PetMaxLootPct'), decayPerHour: setting(store, 'PetLoveDecayPerHour'),
    rhythm: petRhythm(store, user, pet, t)
  };
}
const stateOf = (store, user) => ({ enabled: !!setting(store, 'PetLoveEnabled'), pets: Object.keys(PETS).map((k) => petView(store, user, k)), stardust: Number(user.StardustCount) || 0 });

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(stateOf(store, user));
  if (!GESTURES[action]) return fail('unknown_action');
  if (!setting(store, 'PetLoveEnabled')) return fail('pets_closed');
  const pet = String(body.pet || '');
  if (!PETS[pet]) return fail('unknown_pet');
  const t = now();
  const view = petView(store, user, pet, t);
  const g = view.gestures[action];
  if (action !== 'treat' && g.wait > 0) return fail('pet_cooldown', 400, { wait: g.wait, ...stateOf(store, user) });
  const fields = {};
  if (action === 'treat') {
    if (g.left <= 0) return fail('daily_limit', 400, stateOf(store, user));
    if ((Number(user.StardustCount) || 0) < g.price) return fail('not_enough_dust', 400, stateOf(store, user));
    fields.StardustCount = (Number(user.StardustCount) || 0) - g.price;
  }
  const love = Math.min(100, loveOf(store, user, pet, t) + g.gain);
  fields.PetLove = loveFields(store, user, pet, g.gain, (p) => { if (action === 'treat') { p.treats = (p.treatDay === parisDay(0) ? Number(p.treats) || 0 : 0) + 1; p.treatDay = parisDay(0); } else p[action] = t; });
  user = store.update('Users', user.id, fields);
  return ok({ ...stateOf(store, user), pet, gesture: action, gained: Math.round(love - view.love) });
}

// Affection en plus (gestes, promenade) : nouvelle valeur de Users.PetLove.
export function loveFields(store, user, pet, gain, tweak = null) {
  const t = now();
  const all = allLove(user);
  const p = { ...(all[pet] || {}) };
  p.v = Math.min(100, loveOf(store, user, pet, t) + gain);
  p.at = t;
  if (tweak) tweak(p);
  all[pet] = p;
  return JSON.stringify(all);
}

// Juste avant la fouille : vitesse de Milo lue par dig.json (Users.MiloSpeed).
export function beforeWorkflow({ store, path, request }) {
  if (path !== 'dig') return null;
  const user = store.get('Users', Number((request.body || {}).userId));
  if (!user) return null;
  const speed = petBoost(store, user, 'milo').speed;
  const rest = Math.round(petRhythm(store, user, 'milo').factor * 1000) / 1000;
  if ((Number(user.MiloSpeed) || 0) !== speed || (Number(user.MiloRest) || 0) !== rest) store.update('Users', user.id, { MiloSpeed: speed, MiloRest: rest });
  return null;
}

// Apres la fouille : butin de Milo plus genereux (poussieres en plus) et petit cadeau.
export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'dig' || response.status !== 200 || !response.json || !response.json.dogReport) return;
  const report = response.json.dogReport;
  if (!(Number(report.tiles) > 0)) return;
  let user = store.get('Users', Number((request.body || {}).userId));
  if (!user) return;
  const b = petBoost(store, user, 'milo');
  const dust = Number(report.dust) || 0;
  const bonus = dust > 0 && b.loot > 0 ? Math.round(dust * b.loot) : 0;
  const gift = petGift(store, user, 'milo');
  if (!bonus && !gift) return;
  const fields = { ...(gift ? gift.fields : {}) };
  if (bonus) fields.StardustCount = (Number(user.StardustCount) || 0) + bonus;
  user = store.update('Users', user.id, fields);
  if (bonus) { report.dust = dust + bonus; report.loveBonus = bonus; }
  if (gift) report.loveGift = gift.gift;
  if ('newStardust' in response.json) response.json.newStardust = user.StardustCount;
}

export const routes = { 'POST pets': handle };
