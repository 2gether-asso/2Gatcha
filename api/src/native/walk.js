// Promenade des compagnons (2026-10-30). Une fois par jour (heure de Paris)
// et par compagnon adopte, on l'emmene se balader dans un lieu au choix : une
// trouvaille tiree selon le lieu (ingredients de cuisine, nourriture des
// compagnons, poussieres...) et de l'affection (WalkLove). Chaque compagnon
// a son lieu prefere : trouvailles x WalkFavMult et affection x 1,5. La
// clairiere aux lucioles n'ouvre que la nuit (WalkNightStart a WalkNightEnd).
//   POST /webhook/walk { userId, action: 'status' | 'go', pet?, place? }
// Users.WalkDay = { day, done: { milo: 'foret', ... } }

import { ok, fail, userById, parisDay, parisHour, parseJson } from './common.js';
import { setting } from './settings.js';
import { PETS, loveOf, loveFields } from './pets.js';
import { petAdopted } from './starter.js';
import { pantryFields } from './cooking.js';
import { addTabletsFields } from './archeo.js';
import { MINERALS, mineralsOf } from './digdepth.js';

export const schema = { Users: { WalkDay: { type: 'Text' }, WalkCount: { type: 'Numeric' } } };

// Trouvailles : cle, chance, quantite min-max. Cles : ingredients de
// cooking.js (veg, herb, berry, mush, honey, fish, carrot) ou ressources.
const RES = {
  bone: { field: 'BoneCount', label: 'os', icon: '🦴' },
  worm: { field: 'Worms', label: 'vers', icon: '🪱' },
  grub: { field: 'Grubs', label: 'vers blancs', icon: '🐛' },
  bait: { field: 'GoldBait', label: 'appât doré', icon: '✨' },
  dust: { field: 'StardustCount', label: 'poussières', icon: '✨' },
  key: { field: 'KeyCount', label: 'clé', icon: '🔑' }
};
const ING = { veg: ['légumes', '🥬'], herb: ['herbes', '🌿'], berry: ['baies', '🫐'], mush: ['champignons', '🍄'], honey: ['miel', '🍯'], fish: ['poissons', '🐟'], carrot: ['carottes', '🥕'] };
export const PLACES = [
  { key: 'foret', label: 'La forêt', icon: '🌲', fav: 'milo', desc: 'Baies, champignons et parfois un os.',
    loot: [['berry', 0.6, 1, 3], ['mush', 0.5, 1, 2], ['herb', 0.3, 1, 1], ['bone', 0.25, 1, 1], ['dust', 0.4, 10, 30]],
    story: ['a flairé quelque chose sous les fougères', 'a couru après un écureuil', 'a fouillé un tas de feuilles mortes'] },
  { key: 'lac', label: 'Le bord du lac', icon: '🏞️', fav: 'moka', desc: 'Poissons, vers et parfois un appât doré.',
    loot: [['fish', 0.6, 1, 2], ['worm', 0.6, 2, 4], ['herb', 0.25, 1, 1], ['bait', 0.08, 1, 1], ['dust', 0.3, 10, 25]],
    story: ['a guetté les poissons depuis un rocher', 'a trempé une patte dans l’eau', 'a suivi un héron le long de la rive'] },
  { key: 'prairie', label: 'La prairie', icon: '🌼', fav: 'noisette', desc: 'Carottes sauvages, herbes, légumes et miel.',
    loot: [['carrot', 0.55, 1, 2], ['herb', 0.5, 1, 2], ['veg', 0.4, 1, 2], ['honey', 0.2, 1, 1], ['dust', 0.3, 10, 25]],
    story: ['a gambadé dans les hautes herbes', 'a reniflé chaque fleur de la prairie', 'a dérangé une famille d’abeilles'] },
  { key: 'ruines', label: 'Les ruines', icon: '🏛️', fav: 'pistache', desc: 'Vers blancs, minéraux et parfois une tablette.',
    loot: [['grub', 0.55, 1, 2], ['mineral', 0.35, 1, 1], ['tablet', 0.12, 1, 1], ['dust', 0.4, 15, 40]],
    story: ['a gratté entre deux vieilles pierres', 'a exploré un couloir effondré', 'a déterré quelque chose près d’une colonne'] },
  { key: 'clairiere', label: 'La clairière aux lucioles', icon: '✨', night: true, desc: 'Seulement la nuit : miel, champignons, appât doré et, qui sait, une clé.',
    loot: [['honey', 0.4, 1, 1], ['mush', 0.5, 1, 2], ['berry', 0.4, 1, 2], ['bait', 0.2, 1, 1], ['dust', 0.5, 30, 60], ['key', 0.03, 1, 1]],
    story: ['a dansé au milieu des lucioles', 'a contemplé les étoiles', 'a suivi une lueur entre les arbres'] }
];

export function isNight(store, h = parisHour()) {
  const a = setting(store, 'WalkNightStart'), b = setting(store, 'WalkNightEnd');
  return a > b ? h >= a || h < b : h >= a && h < b;
}
const doneToday = (user) => { const w = parseJson(user && user.WalkDay, null); return w && w.day === parisDay(0) && w.done && typeof w.done === 'object' ? w.done : {}; };
const adoptedPets = (store, user) => Object.keys(PETS).filter((p) => petAdopted(store, user, p));

function view(store, user) {
  const night = isNight(store);
  const done = doneToday(user);
  const mult = setting(store, 'WalkFavMult');
  return {
    enabled: !!setting(store, 'WalkEnabled'), night, favMult: mult, love: setting(store, 'WalkLove'),
    places: PLACES.map((p) => ({ key: p.key, label: p.label, icon: p.icon, desc: p.desc, fav: p.fav || null, night: !!p.night, open: !p.night || night })),
    pets: adoptedPets(store, user).map((k) => ({ pet: k, label: PETS[k].label, icon: PETS[k].icon, fem: !!PETS[k].fem, love: Math.round(loveOf(store, user, k)), walked: done[k] || null, fav: (PLACES.find((p) => p.fav === k) || {}).key || null })),
    left: adoptedPets(store, user).filter((k) => !done[k]).length
  };
}

function rollFinds(store, user, place, fav) {
  const k = fav ? setting(store, 'WalkFavMult') : 1;
  const out = [];
  for (const [key, chance, min, max] of place.loot) if (Math.random() < chance) out.push({ key, n: Math.max(1, Math.round((min + Math.floor(Math.random() * (max - min + 1))) * k)) });
  // Jamais bredouille : la premiere trouvaille du lieu au minimum.
  if (!out.length) { const [key, , min] = place.loot[0]; out.push({ key, n: Math.max(1, Math.round(min * k)) }); }
  const fields = {};
  const add = (f, n) => { fields[f] = (fields[f] ?? (Number(user[f]) || 0)) + n; };
  const items = [];
  for (const f of out) {
    if (ING[f.key]) { Object.assign(fields, pantryFields(user, { [f.key]: f.n }, fields)); items.push({ key: f.key, label: ING[f.key][0], icon: ING[f.key][1], n: f.n }); }
    else if (RES[f.key]) { add(RES[f.key].field, f.n); items.push({ key: f.key, label: RES[f.key].label, icon: RES[f.key].icon, n: f.n }); }
    else if (f.key === 'tablet') { Object.assign(fields, addTabletsFields({ ...user, ...fields }, 'clay', 1)); items.push({ key: 'tablet', label: 'tablette d’argile', icon: '🟫', n: 1 }); }
    else if (f.key === 'mineral') {
      const pool = MINERALS.filter((m) => m.tier <= 2);
      const m = pool[Math.floor(Math.random() * pool.length)];
      const mins = { ...mineralsOf({ ...user, ...fields }) };
      mins[m.key] = (Number(mins[m.key]) || 0) + f.n;
      fields.Minerals = JSON.stringify(mins);
      items.push({ key: 'mineral', label: m.name, img: 'Fouille/' + m.img, icon: '💎', n: f.n });
    }
  }
  return { fields, items };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(view(store, user));
  if (action !== 'go') return fail('unknown_action');
  if (!setting(store, 'WalkEnabled')) return fail('walk_closed');
  const pet = String(body.pet || '');
  if (!PETS[pet]) return fail('unknown_pet');
  if (!petAdopted(store, user, pet)) return fail('pet_not_adopted', 403);
  const place = PLACES.find((p) => p.key === String(body.place || ''));
  if (!place) return fail('unknown_place');
  if (place.night && !isNight(store)) return fail('place_closed', 400, view(store, user));
  const done = doneToday(user);
  if (done[pet]) return fail('already_walked', 400, view(store, user));
  const fav = place.fav === pet;
  const { fields, items } = rollFinds(store, user, place, fav);
  const gain = Math.round(setting(store, 'WalkLove') * (fav ? 1.5 : 1));
  fields.PetLove = loveFields(store, { ...user, ...fields }, pet, gain);
  fields.WalkDay = JSON.stringify({ day: parisDay(0), done: { ...done, [pet]: place.key } });
  fields.WalkCount = (Number(user.WalkCount) || 0) + 1;
  user = store.update('Users', user.id, fields);
  const p = PETS[pet];
  const story = `${p.label} ${place.story[Math.floor(Math.random() * place.story.length)]}`;
  return ok({ ...view(store, user), walk: { pet, label: p.label, icon: p.icon, place: place.key, placeLabel: place.label, placeIcon: place.icon, fav, story, items, love: gain } });
}

export const routes = { 'POST walk': handle };
