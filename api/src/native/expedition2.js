// Expedition v2 (2026-10-18) : des DESTINATIONS par-dessus le workflow
// expedition.json (garde tel quel : duree, poussieres, booster, et tous les
// modules branches dessus continuent de marcher).
//  - Chaque destination (setting ExpeditionDestinations) rapporte, en plus,
//    des ressources pour les autres jeux : vers, os, appats, pieces detachees,
//    poissons pour Moka, mineraux, cles, cranes de dino, pieces de gatchapon.
//    Quantites "par 2 h", multipliees selon la duree (x1, x2,5, x5) ; la
//    partie decimale est une chance (0,3 cle = 30 %).
//  - Affinite du jour par destination (tiree par la date) : une rarete et une
//    extension. Un explorateur de la bonne rarete ou extension rapporte
//    +ExpeditionAffinityPct % de ressources chacun (cumulable).
//  - Destinations debloquees par le niveau d'expedition.
//  - 2026-10-26 : une carte UNIQUE en exploratrice rapporte
//    +ExpeditionUniqueDustPct % de poussieres, +ExpeditionUniqueLootPct % de
//    ressources (cumulable avec l'affinite) et a ExpeditionUniqueBoosterChance %
//    de chance d'un jeton booster en plus (le workflow ne connait pas la rarete
//    Unique : bonus x1 jusque-la).
//   POST /webhook/expedition { ..., action: 'start', destination }
//   reponses : + destinations[], expedition.destination, reward.resources[]

import { fail, now, refId, parisDay, parseJson } from './common.js';
import { setting } from './settings.js';
import { expeditionLevel } from './levels.js';
import { MINERALS, mineralsOf } from './digdepth.js';

export const schema = { Users: { ExpeditionTrip: { type: 'Text' } } };

export const RESOURCES = {
  Worms: { label: ['ver', 'vers'], img: 'Pêche/Vers.png' },
  BoneCount: { label: ['os', 'os'], img: 'Os.PNG' },
  GoldBait: { label: ['appât doré', 'appâts dorés'], img: 'Pêche/Vers.png', gold: true },
  SpareParts: { label: ['pièce détachée', 'pièces détachées'], img: 'PieceDetachee.PNG' },
  CatFish: { label: ['poisson pour Moka', 'poissons pour Moka'], img: 'Pêche/Poisson_12.png' },
  KeyCount: { label: ['clé', 'clés'], img: 'clés.PNG' },
  DinoSkulls: { label: ['crâne de dino', 'crânes de dino'], img: 'CraneDeDino.png' },
  ChestCount: { label: ['pièce de gatchapon', 'pièces de gatchapon'], img: 'PièceKraken.PNG' },
  minerals: { label: ['minéral', 'minéraux'], img: 'Fouille/Agathe.PNG' }
};
const DURATION_MULT = { 2: 1, 8: 2.5, 24: 5 };
const MINERAL_MAX_TIER = { 2: 2, 8: 3, 24: 4 };

function seeded(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } let a = h >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const destinationsOf = (store) => setting(store, 'ExpeditionDestinations');

// Affinite du jour (meme pour tout le monde).
function affinityOf(store, dest, day = parisDay(0)) {
  const rnd = seeded(`expe-${dest.key}-${day}`);
  const playable = store.getAll('Cards').filter((c) => c.Active && !c.IsSecret && !c.IsPromo);
  // Seulement des raretes assez fournies (pas une rarete "Unique" a 1 carte).
  const perRarity = new Map();
  playable.forEach((c) => perRarity.set(refId(c.Rarity), (perRarity.get(refId(c.Rarity)) || 0) + 1));
  const rarities = store.getAll('Rarities').filter((r) => r.Key && (perRarity.get(r.id) || 0) >= 3).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  const extIds = new Set(playable.map((c) => refId(c.Extension)).filter(Boolean));
  const exts = store.tables.has('Extensions') ? store.getAll('Extensions').filter((e) => e.Active !== false && extIds.has(e.id)).sort((a, b) => a.id - b.id) : [];
  const r = rarities.length ? rarities[Math.floor(rnd() * rarities.length)] : null;
  const e = exts.length ? exts[Math.floor(rnd() * exts.length)] : null;
  return { rarity: r ? { key: r.Key, name: r.Name, colorHex: r.ColorHex } : null, extension: e ? { id: e.id, name: e.Name } : null };
}

function matchOf(store, dest, cardId) {
  const card = store.get('Cards', Number(cardId));
  const aff = affinityOf(store, dest);
  if (!card) return { rarity: false, extension: false, bonus: 1 };
  const rar = store.get('Rarities', refId(card.Rarity));
  const rarity = !!(aff.rarity && rar && rar.Key === aff.rarity.key);
  const extension = !!(aff.extension && refId(card.Extension) === aff.extension.id);
  const pct = setting(store, 'ExpeditionAffinityPct') / 100;
  const unique = !!(rar && rar.Key === 'unique');
  const uniq = unique ? setting(store, 'ExpeditionUniqueLootPct') / 100 : 0;
  return { rarity, extension, unique, bonus: 1 + (rarity ? pct : 0) + (extension ? pct : 0) + uniq };
}

function view(store, user) {
  const lvl = expeditionLevel(store, user).level;
  return destinationsOf(store).map((d) => ({
    key: d.key, name: d.name, icon: d.icon || '🧭', desc: d.desc || '', level: Number(d.level) || 1, unlocked: lvl >= (Number(d.level) || 1),
    loot: Object.entries(d.loot || {}).map(([k, n]) => ({ key: k, perTrip: Number(n), label: RESOURCES[k]?.label[1] || k, img: RESOURCES[k]?.img || null, ...(RESOURCES[k]?.gold ? { gold: true } : {}) })),
    affinity: affinityOf(store, d)
  }));
}

const roll = (x) => Math.floor(x) + (Math.random() < x - Math.floor(x) ? 1 : 0);

function rollMinerals(n, hours) {
  const maxTier = MINERAL_MAX_TIER[hours] || 2;
  const pool = MINERALS.filter((m) => m.tier <= maxTier);
  const out = {};
  for (let i = 0; i < n; i++) {
    // Les paliers bas sont plus frequents (poids 1/tier^2).
    const total = pool.reduce((s, m) => s + 1 / (m.tier * m.tier), 0);
    let x = Math.random() * total;
    const m = pool.find((p) => (x -= 1 / (p.tier * p.tier)) <= 0) || pool[0];
    out[m.key] = (out[m.key] || 0) + 1;
  }
  return out;
}

export function beforeWorkflow({ store, path, request }) {
  if (path !== 'expedition') return null;
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user) return null;
  if (body.action === 'start') {
    const dests = destinationsOf(store);
    const dest = dests.find((d) => d.key === (body.destination || dests[0]?.key));
    if (!dest) return fail('unknown_destination');
    if (expeditionLevel(store, user).level < (Number(dest.level) || 1)) return fail('destination_locked', 400, { level: Number(dest.level) || 1 });
    request._expeditionDest = dest.key;
  } else if (body.action === 'claim') {
    request._expeditionTrip = parseJson(user.ExpeditionTrip, null);
    request._expeditionTripHours = Number(user.ExpeditionDuration) || 0;
  }
  return null;
}

export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'expedition' || response.status !== 200 || !response.json || response.json.error) return;
  const body = request.body || {};
  let user = store.get('Users', Number(body.userId));
  if (!user) return;
  const json = response.json;
  const dests = destinationsOf(store);
  if (body.action === 'start' && json.expedition && json.expedition.active && request._expeditionDest) {
    const dest = dests.find((d) => d.key === request._expeditionDest);
    const m = matchOf(store, dest, body.cardId);
    const trip = { dest: dest.key, bonus: m.bonus, rarity: m.rarity, extension: m.extension, ...(m.unique ? { unique: true } : {}), at: now() };
    user = store.update('Users', user.id, { ExpeditionTrip: JSON.stringify(trip) });
  } else if (body.action === 'claim' && json.reward) {
    const trip = request._expeditionTrip;
    const dest = trip && dests.find((d) => d.key === trip.dest);
    if (dest) {
      const hours = request._expeditionTripHours || 2;
      const mult = (DURATION_MULT[hours] || 1) * (Number(trip.bonus) || 1);
      const fields = {};
      const resources = [];
      for (const [k, perTrip] of Object.entries(dest.loot || {})) {
        const n = roll(Number(perTrip) * mult * (0.75 + Math.random() * 0.5));
        if (n <= 0) continue;
        if (k === 'minerals') {
          const got = rollMinerals(n, hours);
          const owned = mineralsOf(user);
          for (const [mk, q] of Object.entries(got)) {
            owned[mk] = (Number(owned[mk]) || 0) + q;
            const min = MINERALS.find((x) => x.key === mk);
            resources.push({ key: 'mineral', mineral: mk, n: q, label: min.name, img: 'Fouille/' + min.img, tier: min.tier });
          }
          fields.Minerals = JSON.stringify(owned);
        } else if (RESOURCES[k]) {
          fields[k] = (Number(user[k]) || 0) + n;
          resources.push({ key: k, n, label: RESOURCES[k].label[n > 1 ? 1 : 0], img: RESOURCES[k].img, ...(RESOURCES[k].gold ? { gold: true } : {}) });
        }
      }
      // Carte Unique : poussieres et chance de jeton booster en plus.
      if (trip.unique) {
        const dust = Math.round((Number(json.reward.dust) || 0) * setting(store, 'ExpeditionUniqueDustPct') / 100);
        const booster = Math.random() * 100 < setting(store, 'ExpeditionUniqueBoosterChance') ? 1 : 0;
        if (dust) fields.StardustCount = (Number(user.StardustCount) || 0) + dust;
        if (booster) fields.BoosterCount = (Number(user.BoosterCount) || 0) + booster;
        json.reward.dust = (Number(json.reward.dust) || 0) + dust;
        json.reward.boosters = (Number(json.reward.boosters) || 0) + booster;
        json.reward.unique = { dust, booster, lootPct: setting(store, 'ExpeditionUniqueLootPct') };
      }
      fields.ExpeditionTrip = '';
      user = store.update('Users', user.id, fields);
      if (json.newStardust != null) json.newStardust = Number(user.StardustCount) || 0;
      if (json.newBoosterCount != null) json.newBoosterCount = Number(user.BoosterCount) || 0;
      json.reward.resources = resources;
      json.reward.destination = { key: dest.key, name: dest.name, icon: dest.icon || '🧭' };
      json.reward.affinity = { rarity: !!trip.rarity, extension: !!trip.extension, bonus: Number(trip.bonus) || 1 };
    } else if (trip === null && user.ExpeditionTrip) store.update('Users', user.id, { ExpeditionTrip: '' });
  }
  json.destinations = view(store, user);
  json.affinityPct = setting(store, 'ExpeditionAffinityPct');
  // Bonus des cartes Unique (affichage du choix de l'explorateur).
  json.rarityBonus = { ...(json.rarityBonus || {}), unique: 1 + setting(store, 'ExpeditionUniqueDustPct') / 100 };
  json.uniqueBonus = { dustPct: setting(store, 'ExpeditionUniqueDustPct'), lootPct: setting(store, 'ExpeditionUniqueLootPct'), boosterChance: setting(store, 'ExpeditionUniqueBoosterChance') };
  const trip = parseJson(user.ExpeditionTrip, null);
  if (json.expedition && json.expedition.active && trip) {
    const d = dests.find((x) => x.key === trip.dest);
    if (d) json.expedition.destination = { key: d.key, name: d.name, icon: d.icon || '🧭', bonus: Number(trip.bonus) || 1, rarity: !!trip.rarity, extension: !!trip.extension, unique: !!trip.unique };
  }
}

// Pour les tests.
export const _affinity = (store, key) => affinityOf(store, destinationsOf(store).find((d) => d.key === key));
