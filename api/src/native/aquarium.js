// Aquarium (refonte de la peche, 2026-10-17) : 24 especes de poissons a
// collectionner, en plus de la prise habituelle. A chaque lancer, une chance
// de remonter un poisson vivant (zone, meteo du jour, heure : certaines
// especes ne se montrent que dans leurs conditions). Chaque poisson a une
// taille (record par espece) et est revendu aussitot en poussieres. Le
// ferrage (mini-jeu du site, pour tout le lot de lancers) augmente la chance,
// la rarete et la taille. Paliers de collection a recuperer (6, 12, 18, 24 especes).
//   POST /webhook/aquarium { userId, action: 'status' | 'claim' }

import { ok, fail, userById, parisHour, parseJson, now } from './common.js';
import { grantCosmetic } from './cosmetics.js';
import { addFeed } from './feed.js';
import { visualLabel } from './visuals.js';

export const schema = { Users: { Aquarium: { type: 'Text' } } };

// rarete : commune, rare, epique, legendaire, mythique. weather : cle de la meteo
// du jour (fishing.js) ; time : 'night' (21 h - 6 h) ou 'day'.
export const SPECIES = [
  { key: 'gardon', name: 'Gardon', icon: '🐟', img: 'Pêche/Poisson_5.png', rarity: 'commune', zone: 'shore', size: [10, 25] },
  { key: 'perche', name: 'Perche', icon: '🐟', img: 'Pêche/Poisson_20.png', rarity: 'commune', zone: 'shore', size: [15, 40] },
  { key: 'carpe', name: 'Carpe', icon: '🐟', img: 'Pêche/Poisson_7.png', rarity: 'commune', zone: 'shore', size: [30, 80] },
  { key: 'ecrevisse', name: 'Écrevisse', icon: '🦞', img: 'Pêche/crabe.png', rarity: 'commune', zone: 'shore', size: [8, 15] },
  { key: 'brochet', name: 'Brochet', icon: '🐟', img: 'Pêche/Poisson_15.png', rarity: 'rare', zone: 'shore', size: [40, 120] },
  { key: 'truite', name: 'Truite arc-en-ciel', icon: '🌈', img: 'Pêche/Poisson_11.png', rarity: 'rare', zone: 'shore', size: [25, 60], weather: 'pluie' },
  { key: 'anguille', name: 'Anguille', icon: '🐍', rarity: 'rare', zone: 'shore', size: [40, 100], time: 'night' },
  { key: 'grenouille', name: 'Grenouille dorée', icon: '🐸', rarity: 'rare', zone: 'shore', size: [5, 12], weather: 'brume' },
  { key: 'tortue', name: 'Tortue d’étang', icon: '🐢', rarity: 'rare', zone: 'shore', size: [15, 40] },
  { key: 'silure', name: 'Silure géant', icon: '🐟', img: 'Pêche/Poisson_10.png', rarity: 'epique', zone: 'shore', size: [80, 250], weather: 'orage' },
  { key: 'lune', name: 'Poisson-lune', icon: '🌙', img: 'Pêche/Poisson_16.png', rarity: 'epique', zone: 'shore', size: [30, 90], time: 'night' },
  { key: 'koi', name: 'Carpe koï', icon: '🎏', img: 'Pêche/Poisson_2.PNG', rarity: 'epique', zone: 'shore', size: [30, 70], weather: 'soleil' },
  { key: 'doree', name: 'Carpe dorée', icon: '✨', img: 'Pêche/Poisson_1.png', rarity: 'legendaire', zone: 'shore', size: [40, 90], weather: 'soleil', time: 'day' },
  { key: 'nessie', name: 'Monstre du lac', icon: '🦕', rarity: 'mythique', zone: 'shore', size: [500, 1500], weather: 'brume', time: 'night' },
  { key: 'maquereau', name: 'Maquereau', icon: '🐟', img: 'Pêche/Poisson_9.png', rarity: 'commune', zone: 'deep', size: [20, 45] },
  { key: 'calamar', name: 'Calamar', icon: '🦑', rarity: 'commune', zone: 'deep', size: [20, 60] },
  { key: 'clown', name: 'Poisson-clown', icon: '🐠', img: 'Pêche/Poisson_4.PNG', rarity: 'rare', zone: 'deep', size: [6, 12] },
  { key: 'crevette', name: 'Crevette géante', icon: '🦐', img: 'Pêche/crevette.png', rarity: 'rare', zone: 'deep', size: [15, 30] },
  { key: 'pieuvre', name: 'Pieuvre', icon: '🐙', img: 'Pêche/Poisson_3.png', rarity: 'rare', zone: 'deep', size: [30, 120] },
  { key: 'requin', name: 'Requin', icon: '🦈', img: 'Pêche/Poisson_6.png', rarity: 'epique', zone: 'deep', size: [150, 500] },
  { key: 'lanterne', name: 'Poisson-lanterne', icon: '🏮', img: 'Pêche/Poisson_14.png', rarity: 'epique', zone: 'deep', size: [5, 20], time: 'night' },
  { key: 'baleine', name: 'Baleine', icon: '🐋', img: 'Pêche/Poisson_13.png', rarity: 'legendaire', zone: 'deep', size: [1000, 3000] },
  { key: 'coelacanthe', name: 'Cœlacanthe', icon: '🐡', img: 'Pêche/Poisson_8.png', rarity: 'legendaire', zone: 'deep', size: [100, 200], weather: 'orage' },
  { key: 'kraken', name: 'Kraken', icon: '🦑', rarity: 'mythique', zone: 'deep', size: [800, 2500], weather: 'orage', time: 'night' }
];
const BY_KEY = new Map(SPECIES.map((s) => [s.key, s]));
// Nom affiche : renommable dans l'admin (Visuels) via l'image de l'espece.
export const speciesName = (store, s) => (store && s.img ? visualLabel(store, s.img, s.name) : s.name);
const WEIGHT = { commune: 55, rare: 28, epique: 12, legendaire: 4, mythique: 1 };
const VALUE = { commune: 8, rare: 20, epique: 60, legendaire: 200, mythique: 800 };
const TIER = { commune: 'commune', rare: 'rare', epique: 'epique', legendaire: 'legendaire', mythique: 'mythique' };
const WEATHER_LABEL = { soleil: 'grand soleil', pluie: 'pluie', brume: 'brume', orage: 'orage' };
export const MILESTONES = [
  { at: 6, label: '6 espèces', reward: { dust: 300 } },
  { at: 12, label: '12 espèces', reward: { boosters: 2 } },
  { at: 18, label: '18 espèces', reward: { boosters: 3, chests: 1 } },
  { at: 24, label: 'Aquarium complet', reward: { boosters: 5, title: 'Maître de l’aquarium' } }
];
const BASE_CHANCE = 0.3;
const STRIKE = { perfect: { chance: 0.25, rare: 1.8, size: 0.55 }, good: { chance: 0.1, rare: 1.25, size: 0.8 }, miss: { chance: -0.1, rare: 1, size: 1 } };

const isNight = () => { const h = parisHour(); return h >= 21 || h < 6; };
export function aquariumOf(user) { const a = parseJson(user && user.Aquarium, {}); return { fish: a.fish || {}, claimed: a.claimed || [] }; }

// Especes qui peuvent mordre maintenant (zone + conditions).
function eligible(zone, weatherKey) {
  const night = isNight();
  return SPECIES.filter((s) => s.zone === zone && (!s.weather || s.weather === weatherKey) && (!s.time || (s.time === 'night') === night));
}

// Poissons remontes pendant un lot de lancers. Renvoie les prises et les champs a ecrire.
export function catchSpecies(user, { store = null, count = 1, deep = false, weatherKey = '', strike = null, rareBoost = 0, reducedFrom = Infinity }) {
  const st = STRIKE[strike] || null;
  const pool = eligible(deep ? 'deep' : 'shore', weatherKey);
  const aq = aquariumOf(user);
  const items = [];
  let dust = 0;
  for (let i = 0; i < count && pool.length; i++) {
    let chance = BASE_CHANCE + (st ? st.chance : 0);
    if (i >= reducedFrom) chance /= 2;
    if (Math.random() >= chance) continue;
    const boost = (st ? st.rare : 1) * (1 + rareBoost);
    const weights = pool.map((s) => WEIGHT[s.rarity] * (s.rarity === 'commune' ? 1 : boost));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    const sp = pool[Math.max(0, weights.findIndex((w) => (r -= w) <= 0))] || pool[0];
    const [min, max] = sp.size;
    const size = Math.round(min + (max - min) * Math.pow(Math.random(), st ? st.size : 1));
    const prev = aq.fish[sp.key] || { count: 0, best: 0, first: null };
    const value = Math.max(1, Math.round(VALUE[sp.rarity] * (0.8 + 0.6 * (size - min) / Math.max(1, max - min))));
    dust += value;
    items.push({ key: sp.key, name: speciesName(store, sp), icon: sp.icon, img: sp.img || null, rarity: sp.rarity, tier: TIER[sp.rarity], size, dust: value, first: !prev.count, record: prev.count > 0 && size > prev.best });
    aq.fish[sp.key] = { count: prev.count + 1, best: Math.max(prev.best, size), first: prev.first || now() };
  }
  if (!items.length) return null;
  return { items, dust, fields: { Aquarium: JSON.stringify(aq) } };
}

export function aquariumView(user, weatherKey = '', store = null) {
  const aq = aquariumOf(user);
  const found = Object.keys(aq.fish).filter((k) => BY_KEY.has(k)).length;
  const night = isNight();
  return {
    found, total: SPECIES.length,
    species: SPECIES.map((s) => {
      const f = aq.fish[s.key];
      const hint = [s.zone === 'deep' ? 'eaux profondes' : 'rivage', s.weather ? 'par ' + WEATHER_LABEL[s.weather] : '', s.time ? (s.time === 'night' ? 'la nuit' : 'le jour') : ''].filter(Boolean).join(', ');
      const now_ = (!s.weather || s.weather === weatherKey) && (!s.time || (s.time === 'night') === night);
      return { key: s.key, name: f ? speciesName(store, s) : '???', icon: f ? s.icon : '', img: f ? s.img || null : null, rarity: s.rarity, zone: s.zone, found: !!f, count: f ? f.count : 0, best: f ? f.best : 0, hint, biteNow: now_ };
    }),
    milestones: MILESTONES.map((m) => ({ ...m, reached: found >= m.at, claimed: aq.claimed.includes(m.at) }))
  };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if ((body.action || 'status') === 'status') return ok(aquariumView(user, '', store));
  if (body.action !== 'claim') return fail('unknown_action');
  const v = aquariumView(user, '', store);
  const todo = v.milestones.filter((m) => m.reached && !m.claimed);
  if (!todo.length) return fail('nothing_to_claim', 400, v);
  const aq = aquariumOf(user);
  const add = { dust: 0, boosters: 0, chests: 0, titles: [] };
  for (const m of todo) {
    aq.claimed.push(m.at);
    add.dust += m.reward.dust || 0; add.boosters += m.reward.boosters || 0; add.chests += m.reward.chests || 0;
    if (m.reward.title && grantCosmetic(store, user.id, 'title-aquarium', { type: 'title', label: m.reward.title })) add.titles.push(m.reward.title);
  }
  user = store.update('Users', user.id, {
    Aquarium: JSON.stringify(aq),
    StardustCount: (Number(user.StardustCount) || 0) + add.dust,
    BoosterCount: (Number(user.BoosterCount) || 0) + add.boosters,
    ChestCount: (Number(user.ChestCount) || 0) + add.chests
  });
  if (add.titles.length) addFeed(store, { userId: user.id, kind: 'aquarium', icon: '🐠', text: 'a complété son aquarium : les 24 espèces !' });
  return ok({ ...aquariumView(user, '', store), claimed: add, newBoosterCount: user.BoosterCount, newStardust: user.StardustCount });
}

export const routes = { 'POST aquarium': handle };
