// Boutique d'objets (2026-10-07) : de quoi depenser ses poussieres au
// quotidien. Ressources (vers, appats, os, coffres, cles, pieces detachees)
// et bonus (elixir de chance, potion de savoir, cafe du fouilleur, engrais
// express, boussole doree), chacun avec un plafond par semaine pour ne pas
// casser l'economie. Catalogue reglable dans l'admin (ShopCatalog).
//   POST /webhook/shop { userId, action: 'status' | 'buy', key? }
// Effets lus ailleurs : Users.LuckCharges (boosts.js, ouverture de booster),
// Users.XpBoostUntil (index.js, XP doublee).

import { ok, fail, userById, now, configRow } from './common.js';
import { setting } from './settings.js';
import { weekKey, digLevel } from './levels.js';
import { growSeconds, seedMult } from './garden.js';
import { price as indexed } from './inflation.js';

export const schema = {
  Users: { ShopItemsWeek: { type: 'Text' }, ShopItemsBought: { type: 'Text' }, LuckCharges: { type: 'Numeric' }, XpBoostUntil: { type: 'Numeric' } }
};

// Colonnes qu'un objet peut crediter (liste blanche).
export const GIVE_FIELDS = ['Worms', 'GoldBait', 'BoneCount', 'ChestCount', 'KeyCount', 'SpareParts', 'LuckCharges'];
export const EFFECTS = ['xpBoost', 'digEnergy', 'gardenRipe', 'expeditionNow'];

const parse = (v, def) => { try { const x = JSON.parse(v || ''); return x == null ? def : x; } catch (e) { return def; } };
const dust = (u) => Number(u.StardustCount) || 0;

function catalog(store) {
  return setting(store, 'ShopCatalog').filter((it) => it && it.key && Number(it.price) > 0 && (it.give || EFFECTS.includes(it.effect)));
}

function boughtThisWeek(user) {
  return user.ShopItemsWeek === weekKey() ? parse(user.ShopItemsBought, {}) : {};
}

function stateOf(store, user) {
  const bought = boughtThisWeek(user);
  const t = now();
  return {
    stardust: dust(user),
    luckCharges: Number(user.LuckCharges) || 0,
    xpBoostUntil: (Number(user.XpBoostUntil) || 0) > t ? Number(user.XpBoostUntil) : null,
    items: catalog(store).map((it) => {
      const weekly = Number(it.weekly) || 0;
      const n = Number(bought[it.key]) || 0;
      return { key: it.key, group: it.group || 'resources', label: it.label, icon: it.icon || '🎁', desc: it.desc || '', price: indexed(store, it.price), weekly, bought: n, left: weekly ? Math.max(0, weekly - n) : null };
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
    const cfg = configRow(store);
    const max = (Number(cfg.DigMaxEnergy) || 5) + Math.floor(digLevel(store, user).level / 2);
    return { DigEnergy: max, LastDigEnergyAt: t };
  }
  if (it.effect === 'gardenRipe') {
    const plots = parse(user.GardenPlots, []);
    const grow = growSeconds(store, user);
    let n = 0;
    const next = plots.map((p) => { const g = Math.round(grow * seedMult(p)); if (p && p.plantedAt && p.plantedAt + g > t) { n++; return { ...p, plantedAt: t - g - 1 }; } return p; });
    if (!n) return { error: 'nothing_growing' };
    return { GardenPlots: JSON.stringify(next) };
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
  const weekly = Number(it.weekly) || 0;
  if (weekly && (Number(bought[it.key]) || 0) >= weekly) return fail('weekly_cap', 400, stateOf(store, user));
  const price = indexed(store, it.price);
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
  user = store.update('Users', user.id, { ...fields, StardustCount: dust(user) - price, ShopItemsWeek: weekKey(), ShopItemsBought: JSON.stringify(bought) });
  return ok({ ...stateOf(store, user), bought: it.key, paid: price, newStardust: user.StardustCount });
}

export const routes = { 'POST shop': handleShop };
