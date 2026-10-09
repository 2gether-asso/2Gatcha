// Pilotage de l'inflation (2026-10-09).
//  - Prix indexes sur la richesse : les prix en poussieres (boutique, os,
//    relances, coffre) suivent le solde moyen des joueurs actifs (14 jours),
//    rapporte a une richesse de reference (WealthReference). Facteur adouci
//    (racine carree), entre 1 et PriceIndexMax.
//  - Mode anti-inflation automatique : une verification par jour ; si le
//    tableau de l'economie est en alerte 7 jours d'affilee (AutoTightDays),
//    le mode "serre" s'active (doublons /2, prix +25 %, taxes x1,5, decraft
//    -10 %) et une annonce part dans le fil du serveur. Il retombe apres
//    TightCalmDays jours sans alerte. InflationModeForce : 0 auto, 1 force,
//    2 desactive.
//   GET /webhook/economy-state -> { priceFactor, tight, since, avgWealth }

import { ok, now, parisDay } from './common.js';
import { setting } from './settings.js';
import { flows } from './economy.js';
import { addFeed } from './feed.js';

const KEY = 'inflationMode';
const parse = (v, def) => { try { const x = JSON.parse(v || ''); return x == null ? def : x; } catch (e) { return def; } };

function appGet(store) { const r = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === KEY) : null; return r ? parse(r.Value, {}) : {}; }
function appSet(store, value) {
  const r = store.getAll('AppSettings').find((x) => x.Key === KEY);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: KEY, Value: JSON.stringify(value) });
}

// --- richesse moyenne et facteur de prix (cache 60 s) ---------------------------
let cache = { at: 0, store: null, avg: 0, factor: 1 };
function wealth(store) {
  const t = now();
  if (cache.store === store && t - cache.at < 60) return cache;
  const since = t - 14 * 86400;
  const users = store.tables.has('Users') ? store.getAll('Users') : [];
  const active = users.filter((u) => (Number(u.LastSeenAt) || 0) >= since);
  const pool = active.length ? active : users;
  const avg = pool.length ? pool.reduce((s, u) => s + (Number(u.StardustCount) || 0), 0) / pool.length : 0;
  let factor = 1;
  if (setting(store, 'PriceIndexEnabled')) {
    const ref = Math.max(1, setting(store, 'WealthReference'));
    factor = Math.min(setting(store, 'PriceIndexMax'), Math.max(1, Math.sqrt(avg / ref)));
  }
  cache = { at: t, store, avg, factor: Math.round(factor * 100) / 100 };
  return cache;
}

export function isTight(store) {
  const force = setting(store, 'InflationModeForce');
  if (force === 1) return true;
  if (force === 2) return false;
  return !!appGet(store).tight;
}

// Multiplicateur des prix en poussieres (index de richesse x mode serre).
export function priceMultiplier(store) {
  return wealth(store).factor * (isTight(store) ? 1.25 : 1);
}
export const price = (store, base) => Math.max(1, Math.round((Number(base) || 0) * priceMultiplier(store)));
// Taxes (echanges, encheres) : x1,5 en mode serre.
export const taxMultiplier = (store) => (isTight(store) ? 1.5 : 1);
// Gains passifs (doublons) : /2 en mode serre.
export const gainMultiplier = (store) => (isTight(store) ? 0.5 : 1);

// --- verification quotidienne ----------------------------------------------------
let checkedDay = null;
export function dailyCheck(store, day = parisDay(0)) {
  if (checkedDay === day || !store.tables.has('AppSettings')) return null;
  checkedDay = day;
  const st = appGet(store);
  if (st.lastDay === day) return st;
  const since = now() - 7 * 86400;
  const active = store.getAll('Users').filter((u) => (Number(u.LastSeenAt) || 0) >= since).length;
  const f = flows(store, active);
  const alert = !!(f && f.alerts.length);
  const next = { ...st, lastDay: day, alertDays: alert ? (st.alertDays || 0) + 1 : 0, calmDays: alert ? 0 : (st.calmDays || 0) + 1, alerts: f ? f.alerts : [] };
  if (!st.tight && next.alertDays >= setting(store, 'AutoTightDays')) {
    next.tight = true; next.since = now();
    addFeed(store, { kind: 'economy', icon: '🏦', text: 'Mode anti-inflation activé : prix et taxes en hausse, doublons moins rentables, le temps que l’économie se calme.' });
  } else if (st.tight && next.calmDays >= setting(store, 'TightCalmDays')) {
    next.tight = false; next.since = now();
    addFeed(store, { kind: 'economy', icon: '🏦', text: 'L’économie s’est calmée : fin du mode anti-inflation, les prix reviennent à la normale.' });
  }
  appSet(store, next);
  return next;
}

export function beforeRequest({ store }) { dailyCheck(store); }

function handleState({ store }) {
  const w = wealth(store);
  const st = appGet(store);
  return ok({ priceFactor: Math.round(priceMultiplier(store) * 100) / 100, wealthFactor: w.factor, avgWealth: Math.round(w.avg), tight: isTight(store), forced: setting(store, 'InflationModeForce'), since: st.since || null, alertDays: st.alertDays || 0, calmDays: st.calmDays || 0 });
}

export const routes = { 'GET economy-state': handleState };
export function _reset() { checkedDay = null; cache = { at: 0, store: null, avg: 0, factor: 1 }; }
