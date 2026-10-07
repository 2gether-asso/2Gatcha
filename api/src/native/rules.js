// Regles d'economie (2026-10-05) :
//  - taxe d'echange : TradeTaxPerCard poussieres par carte proposee, payees
//    par celui qui propose (verifiee AVANT le workflow trade, prelevee apres) ;
//  - prix de l'os : +BoneWeeklyIncrease (25 %) par os achete dans la semaine,
//    remis a zero le lundi ;
//  - marche noir automatique : chaque lundi, MarketAutoOffers offres generees
//    (dont un "coup de coeur" moins cher), comme le bingo du mois ;
//  - relances payantes, une fois par jour : meteo de peche perso, retour
//    accelere de l'expedition.
//   POST /webhook/reroll { userId, kind: 'weather' | 'expedition' }

import { refId, now, ok, fail, userById, parisDay } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';
import { talentValue } from './talents.js';

export const schema = {
  Users: {
    BoneWeek: { type: 'Text' }, BonesBoughtWeek: { type: 'Numeric' },
    WeatherDay: { type: 'Text' }, WeatherKey: { type: 'Text' }, RushDay: { type: 'Text' }
  },
  BlackMarketOffers: { Label: { type: 'Text' }, Auto: { type: 'Bool' }, Week: { type: 'Text' } }
};

const dust = (u) => Number(u.StardustCount) || 0;

// --- taxe d'echange --------------------------------------------------------
function tradeTax(store, body) {
  const cards = (Number(body.offeredCardId) ? 1 : 0) + (Number(body.requestedCardId) ? 1 : 0);
  // Talent Maitre artisan (talents.js) : taxe divisee par 2.
  const user = store.get('Users', Number(body.userId));
  return Math.round(setting(store, 'TradeTaxPerCard') * Math.max(1, cards) * (1 - talentValue(user, 'master')));
}

// --- prix de l'os ----------------------------------------------------------
export function bonePrice(store, user) {
  const base = setting(store, 'DogBoneCost');
  const bought = user.BoneWeek === weekKey() ? Number(user.BonesBoughtWeek) || 0 : 0;
  return Math.round(base * (1 + setting(store, 'BoneWeeklyIncrease') * bought));
}

// Verifications avant un workflow : null = OK, sinon la reponse a renvoyer.
export function beforeWorkflow({ store, path, request }) {
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user) return null;
  if (path === 'trade' && (body.action === 'create' || body.action === 'counter')) {
    const tax = tradeTax(store, body);
    if (tax > 0 && dust(user) < tax) return { status: 400, json: { error: 'not_enough_dust_tax', tax } };
  }
  if (path === 'dig' && body.action === 'buyBone') {
    const price = bonePrice(store, user);
    if (dust(user) < price) return { status: 400, json: { error: 'not_enough_dust', price } };
  }
  return null;
}

export function afterWorkflow({ store, path, request, response }) {
  if (!response.json) return;
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (path === 'trade') {
    if (response.status === 200 && user && (body.action === 'create' || body.action === 'counter') && !response.json.error) {
      const tax = tradeTax(store, body);
      if (tax > 0) { store.update('Users', user.id, { StardustCount: Math.max(0, dust(user) - tax) }); response.json.taxPaid = tax; }
    }
    if (response.status === 200) response.json.tradeTaxPerCard = setting(store, 'TradeTaxPerCard');
    return;
  }
  if (path === 'dig' && user) {
    if (body.action === 'buyBone' && response.status === 200) {
      // Le workflow a preleve le prix de base : on preleve le supplement.
      const extra = bonePrice(store, user) - setting(store, 'DogBoneCost');
      const week = weekKey();
      const bought = user.BoneWeek === week ? Number(user.BonesBoughtWeek) || 0 : 0;
      const fresh = store.get('Users', user.id);
      store.update('Users', user.id, { StardustCount: Math.max(0, dust(fresh) - Math.max(0, extra)), BoneWeek: week, BonesBoughtWeek: bought + 1 });
    }
    if (response.status === 200) response.json.boneCost = bonePrice(store, store.get('Users', user.id));
    return;
  }
  if (path === 'black-market' && response.status === 200 && Array.isArray(response.json.offers)) {
    const rows = new Map(store.getAll('BlackMarketOffers').map((o) => [o.id, o]));
    response.json.offers.forEach((o) => { const r = rows.get(Number(o.offerId ?? o.id)); if (r) { o.label = r.Label || null; o.auto = !!r.Auto; } });
  }
}

// --- marche noir automatique ------------------------------------------------
let marketCheckedWeek = null;

function weekEndsAt(week) { return Math.floor(new Date(week + 'T00:00:00+02:00').getTime() / 1000) + 7 * 86400 - 1; }
const round10 = (n) => Math.max(10, Math.round(n / 10) * 10);

export function generateMarket(store, week = weekKey()) {
  if (!setting(store, 'MarketAutoEnabled') || !store.tables.has('BlackMarketOffers')) return 0;
  const offers = store.getAll('BlackMarketOffers');
  if (offers.some((o) => o.Auto && o.Week === week)) return 0;
  offers.filter((o) => o.Auto && o.Active).forEach((o) => store.update('BlackMarketOffers', o.id, { Active: false }));
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  const owners = new Map();
  store.getAll('Pulls').forEach((p) => { const c = refId(p.Card); if (!owners.has(c)) owners.set(c, new Set()); owners.get(c).add(refId(p.User)); });
  const WEIGHT = { rare: 3, epique: 3, legendaire: 2, mythique: 1 };
  let pool = store.getAll('Cards').filter((c) => c.Active !== false && !c.IsPromo && WEIGHT[rarities.get(refId(c.Rarity))?.Key])
    .map((c) => ({ c, w: WEIGHT[rarities.get(refId(c.Rarity)).Key] / (1 + (owners.get(c.id)?.size || 0)) }));
  const n = setting(store, 'MarketAutoOffers');
  const picked = [];
  while (picked.length < n && pool.length) {
    let r = Math.random() * pool.reduce((s, x) => s + x.w, 0);
    const i = pool.findIndex((x) => (r -= x.w) <= 0);
    picked.push(pool.splice(i < 0 ? pool.length - 1 : i, 1)[0].c);
  }
  const expires = weekEndsAt(week);
  picked.forEach((c, i) => {
    const craft = Number(rarities.get(refId(c.Rarity))?.CraftCost) || 200;
    const deal = i === 0;
    store.create('BlackMarketOffers', {
      CardId: c.id, Cost: round10(craft * (deal ? setting(store, 'MarketDealMultiplier') : setting(store, 'MarketPriceMultiplier'))),
      ExpiresAt: expires, Active: true, MaxPurchases: deal ? 2 : setting(store, 'MarketMaxPurchases'),
      Label: deal ? 'Coup de cœur de la semaine' : null, Auto: true, Week: week
    });
  });
  return picked.length;
}

export function beforeRequest({ store }) {
  const week = weekKey();
  if (marketCheckedWeek === week) return;
  marketCheckedWeek = week;
  generateMarket(store, week);
}

// --- relances payantes ----------------------------------------------------
function handleReroll({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const today = parisDay(0);
  if (body.kind === 'weather') {
    if (user.WeatherDay === today) return fail('already_rerolled');
    const cost = setting(store, 'WeatherRerollCost');
    if (dust(user) < cost) return fail('not_enough_dust');
    const keys = ['soleil', 'pluie', 'brume', 'orage'].filter((k) => k !== (body.current || ''));
    const key = keys[Math.floor(Math.random() * keys.length)];
    store.update('Users', user.id, { StardustCount: dust(user) - cost, WeatherDay: today, WeatherKey: key });
    return ok({ rerolled: true, weather: key, cost });
  }
  if (body.kind === 'expedition') {
    if (user.RushDay === today) return fail('already_rerolled');
    const until = Number(user.ExpeditionUntil) || 0;
    if (until <= now()) return fail('no_expedition');
    const cost = setting(store, 'ExpeditionRushCost');
    if (dust(user) < cost) return fail('not_enough_dust');
    const newUntil = now() + Math.ceil((until - now()) / 2);
    store.update('Users', user.id, { StardustCount: dust(user) - cost, RushDay: today, ExpeditionUntil: newUntil });
    return ok({ rerolled: true, expeditionUntil: newUntil, cost });
  }
  return fail('unknown_kind');
}

// Prix affiches par le site (relances, taxe, os).
function handleRules({ store, query }) {
  const user = store.get('Users', Number(query.userId));
  const today = parisDay(0);
  return ok({
    tradeTaxPerCard: setting(store, 'TradeTaxPerCard'),
    weatherRerollCost: setting(store, 'WeatherRerollCost'),
    expeditionRushCost: setting(store, 'ExpeditionRushCost'),
    weatherRerolledToday: !!user && user.WeatherDay === today,
    expeditionRushedToday: !!user && user.RushDay === today,
    bonePrice: user ? bonePrice(store, user) : setting(store, 'DogBoneCost'),
    repairDustPerCopy: setting(store, 'RepairDustPerCopy')
  });
}

export const routes = {
  'POST reroll': handleReroll,
  'GET economy-rules': handleRules
};

