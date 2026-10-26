// Boutique d'objets (2026-10-07) : de quoi depenser ses poussieres au
// quotidien. Ressources (vers, appats, os, coffres, cles, pieces detachees)
// et bonus (elixir de chance, potion de savoir, cafe du fouilleur, engrais
// express, boussole doree). Catalogue reglable dans l'admin (ShopCatalog).
// 2026-10-25 : plus aucun plafond par semaine. Tout est achetable a volonte,
// mais chaque achat du jour d'un objet fait monter SON prix pour ce joueur
// (inflation personnelle, x ShopItemGrowth par achat ; x EnergyRefillGrowth
// pour les recharges d'energie), remise a zero a minuit (heure de Paris).
//   POST /webhook/shop { userId, action: 'status' | 'buy', key? }
// Effets lus ailleurs : Users.LuckCharges (boosts.js, ouverture de booster),
// Users.XpBoostUntil (index.js, XP doublee).

import { ok, fail, userById, now, parisDay, parseJson as parse } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';
import { growSeconds, seedMult } from './garden.js';
import { price as indexed } from './inflation.js';
import { happyFactor, happyHourNow } from './moderules.js';
import { fishEnergy } from './fishing.js';
import { digTimer } from './timers.js';
import { parisEpoch } from './daily.js';
import { petAdopted, petMask } from './starter.js';
// Happy hour (mode Chill) : -30 % sur toute la boutique.
const shopPrice = (store, base) => Math.round(indexed(store, base) * happyFactor(store));

export const schema = {
  Users: { ShopItemsWeek: { type: 'Text' }, ShopItemsBought: { type: 'Text' }, LuckCharges: { type: 'Numeric' }, XpBoostUntil: { type: 'Numeric' }, EnergyBuys: { type: 'Text' } }
};

// Colonnes qu'un objet peut crediter (liste blanche).
const GIVE_FIELDS = ['Worms', 'GoldBait', 'BoneCount', 'ChestCount', 'KeyCount', 'SpareParts', 'LuckCharges', 'CatFish'];
const EFFECTS = ['xpBoost', 'digEnergy', 'fishEnergy', 'gardenRipe', 'expeditionNow', 'umbrella'];

const dust = (u) => Number(u.StardustCount) || 0;

// Objets ajoutes par le code, meme si le catalogue a ete personnalise dans l'admin.
const BUILTIN = (store) => [
  { key: 'sardines', group: 'resources', label: 'Boîte de sardines', icon: '🥫', desc: '3 poissons pour Moka le chat, qui pêche à ta place.', price: 150, weekly: 3, give: { CatFish: 3 } },
  { key: 'thermos', group: 'boosts', label: 'Thermos du pêcheur', icon: '🫖', desc: 'Recharge complète de ton énergie de pêche.', price: 200, weekly: 3, effect: 'fishEnergy' },
  { key: 'umbrella', group: 'boosts', icon: '☂️', label: 'Parapluie', desc: `Protège tes cartes de l’usure du mode Hard pendant ${setting(store, 'UmbrellaDays')} jours.`, price: setting(store, 'UmbrellaPrice'), weekly: 1, effect: 'umbrella' }
];
function catalog(store) {
  const list = setting(store, 'ShopCatalog').filter((it) => it && it.key && Number(it.price) > 0 && (it.give || EFFECTS.includes(it.effect)));
  return [...list, ...BUILTIN(store).filter((b) => !list.some((it) => it.key === b.key))];
}

// Pages ou l'objet s'affiche aussi (boutique eclatee, js/shop-strip.js) :
// colonne « pages » du catalogue, sinon selon l'objet (catalogue deja personnalise).
const DEFAULT_PAGES = { worms10: ['peche'], bait: ['peche'], thermos: ['peche'], bone: ['fouille'], coffee: ['fouille'], chest: ['ouverture'], key: ['ouverture'], luck5: ['ouverture'], part: ['collection'], fertilizer: ['jardin'], compass: ['expedition'], xp1h: ['fouille', 'peche', 'expedition', 'jardin'] };
const pagesOf = (it) => (Array.isArray(it.pages) ? it.pages : DEFAULT_PAGES[it.key] || []);

// Inflation personnelle du jour (Users.EnergyBuys = { day, counts }) :
// recharges d'energie (cafe du fouilleur, thermos du pecheur, ou un objet du
// catalogue avec escalate: true) a EnergyRefillGrowth, tout le reste a
// ShopItemGrowth (2026-10-25).
const ESCALATE_DEFAULT = new Set(['coffee', 'thermos']);
const isEnergy = (it) => (it.escalate != null ? !!it.escalate : ESCALATE_DEFAULT.has(it.key));
const growthOf = (store, it) => setting(store, isEnergy(it) ? 'EnergyRefillGrowth' : 'ShopItemGrowth');
function energyBuysToday(user) {
  const v = parse(user.EnergyBuys, {});
  return v && v.day === parisDay(0) ? v.counts || {} : {};
}
function itemPrice(store, user, it) {
  const base = shopPrice(store, it.price);
  const n = Number(energyBuysToday(user)[it.key]) || 0;
  if (!n) return base;
  return Math.max(base, Math.round((base * Math.pow(growthOf(store, it), n)) / 5) * 5);
}

function boughtThisWeek(user) {
  return user.ShopItemsWeek === weekKey() ? parse(user.ShopItemsBought, {}) : {};
}

// Compagnon pas encore adopte (nouveaux comptes, starter.js) : objets decrits sans lui.
const PET_ITEM = {
  BoneCount: { pet: 'milo', label: 'Os', desc: 'Un os bien rongé. Quelqu’un, quelque part, en raffole…' },
  CatFish: { pet: 'moka', desc: 'Des sardines bien grasses : ça sent le poisson à des kilomètres…' }
};
function petView(store, user, it, mask) {
  const k = Object.keys(it.give || {}).find((f) => PET_ITEM[f] && !petAdopted(store, user, PET_ITEM[f].pet));
  if (k) return { label: PET_ITEM[k].label || mask(it.label), desc: PET_ITEM[k].desc };
  return { label: mask(it.label), desc: mask(it.desc || '') };
}
function stateOf(store, user) {
  const bought = boughtThisWeek(user);
  const t = now();
  const mask = petMask(store, user);
  return {
    stardust: dust(user),
    luckCharges: Number(user.LuckCharges) || 0,
    xpBoostUntil: (Number(user.XpBoostUntil) || 0) > t ? Number(user.XpBoostUntil) : null,
    umbrellaUntil: (Number(user.UmbrellaUntil) || 0) > t ? Number(user.UmbrellaUntil) : null,
    // Minuit (heure de Paris) : remise a zero de l'inflation personnelle.
    resetAt: parisEpoch(parisDay(1), 0),
    items: catalog(store).map((it) => {
      const n = Number(bought[it.key]) || 0;
      const today = Number(energyBuysToday(user)[it.key]) || 0;
      // Catalogue personnalise avant la refonte du gatchapon : « Coffre » = une piece.
      const legacyChest = it.key === 'chest' && /^coffre$/i.test(String(it.label || '').trim());
      const pv = petView(store, user, it, mask);
      return { key: it.key, pages: pagesOf(it), group: it.group || 'resources', label: legacyChest ? 'Pièce de gatchapon' : pv.label, icon: legacyChest ? '🪙' : it.icon || '🎁', desc: pv.desc, price: itemPrice(store, user, it), basePrice: shopPrice(store, it.price), happyHour: happyHourNow(store), weekly: 0, bought: n, left: null, escalate: { today, growth: growthOf(store, it), energy: isEnergy(it) } };
    })
  };
}

// Effet d'un objet "bonus" : champs a ecrire, ou une erreur.
function effectFields(store, user, it) {
  const t = now();
  if (it.effect === 'xpBoost') {
    const from = Math.max(t, Number(user.XpBoostUntil) || 0);
    return { XpBoostUntil: from + Math.round((Number(it.hours) || 1) * 3600) };
  }
  if (it.effect === 'digEnergy') {
    // Meme calcul que la fouille (timers.js) ; refuse si deja pleine (avant :
    // achat possible pour rien, et maximum par defaut different).
    const en = digTimer(store, user, t);
    if (en.energy >= en.max) return { error: 'energy_full' };
    return { DigEnergy: en.max, LastDigEnergyAt: t };
  }
  if (it.effect === 'fishEnergy') {
    const en = fishEnergy(store, user);
    if (en.energy >= en.max) return { error: 'energy_full' };
    return { FishingEnergy: en.max, FishingEnergyAt: t };
  }
  if (it.effect === 'gardenRipe') {
    const plots = parse(user.GardenPlots, []);
    const grow = growSeconds(store, user);
    let n = 0;
    const next = plots.map((p) => { const g = Math.round(grow * seedMult(p)); if (p && p.plantedAt && p.plantedAt + g > t) { n++; return { ...p, plantedAt: t - g - 1 }; } return p; });
    if (!n) return { error: 'nothing_growing' };
    return { GardenPlots: JSON.stringify(next) };
  }
  if (it.effect === 'umbrella') {
    return { UmbrellaUntil: Math.max(t, Number(user.UmbrellaUntil) || 0) + setting(store, 'UmbrellaDays') * 86400 };
  }
  if (it.effect === 'expeditionNow') {
    if (!((Number(user.ExpeditionUntil) || 0) > t)) return { error: 'no_expedition' };
    return { ExpeditionUntil: t };
  }
  return { error: 'unknown_effect' };
}

function handleShop({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if ((body.action || 'status') === 'status') return ok(stateOf(store, user));
  if (body.action !== 'buy') return fail('unknown_action');
  const it = catalog(store).find((x) => x.key === String(body.key));
  if (!it) return fail('unknown_item');
  const bought = boughtThisWeek(user);
  const price = itemPrice(store, user, it);
  if (dust(user) < price) return fail('not_enough_dust', 400, stateOf(store, user));
  const fields = {};
  if (it.effect) {
    const fx = effectFields(store, user, it);
    if (fx.error) return fail(fx.error, 400, stateOf(store, user));
    Object.assign(fields, fx);
  }
  for (const [k, v] of Object.entries(it.give || {})) {
    if (GIVE_FIELDS.includes(k) && Number(v) > 0) fields[k] = (Number(user[k]) || 0) + Number(v);
  }
  bought[it.key] = (Number(bought[it.key]) || 0) + 1;
  const counts = energyBuysToday(user);
  counts[it.key] = (Number(counts[it.key]) || 0) + 1;
  fields.EnergyBuys = JSON.stringify({ day: parisDay(0), counts });
  user = store.update('Users', user.id, { ...fields, StardustCount: dust(user) - price, ShopItemsWeek: weekKey(), ShopItemsBought: JSON.stringify(bought) });
  return ok({ ...stateOf(store, user), bought: it.key, paid: price, newStardust: user.StardustCount });
}

export const routes = { 'POST shop': handleShop };
