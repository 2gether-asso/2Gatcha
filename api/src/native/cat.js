// Moka le chat (2026-10-17) : l'equivalent de Milo pour la peche. On lui
// donne du poisson (Users.CatFish : 1 par espece de l'aquarium pechee, ou la
// boite de sardines de la boutique) et il peche a ta place, sans ver ni
// energie : chaque poisson donne CatMinutesPerFish minutes de peche, 1 lancer
// toutes les CatCastMinutes (table du rivage avec tes bonus de niveau et la
// meteo, mais jamais de booster : remplace par des poussieres), plus des
// especes pour l'aquarium. Plafonds : CatMaxMinutes devant lui, CatDailyFish
// poissons par jour. Ses prises sont creditees a ton retour sur la peche
// (catReport, une seule fois).
//   POST /webhook/cat { userId, action: 'status' | 'feed', count? }
// Users.CatState = { start, until, done } (secondes ; done = lancers deja credites).

import { ok, fail, userById, now, parisDay, parseJson } from './common.js';
import { setting } from './settings.js';
import { catLoot } from './fishing.js';
import { catchSpecies } from './aquarium.js';
import { petBoost, petGift, petRhythm } from './pets.js';

export const schema = { Users: { CatFish: { type: 'Numeric' }, CatState: { type: 'Text' }, CatFedDay: { type: 'Text' }, CatFedCount: { type: 'Numeric' } } };

const BOOSTER_DUST = 15;
const fedToday = (user) => (user.CatFedDay === parisDay(0) ? Number(user.CatFedCount) || 0 : 0);
const stateOf = (user) => { const s = parseJson(user && user.CatState, null); return s && s.start && s.until ? s : null; };

// Lancers de Moka pas encore credites : champs a ecrire et rapport (ou null).
export function settleCat(store, user) {
  const s = stateOf(user);
  if (!s) return null;
  const t = now();
  // Tendresse (pets.js) : Moka lance plus souvent et rapporte plus de poussieres.
  const love = petBoost(store, user, 'moka');
  // Fatigue (pets.js) : ses pauses ralentissent le rythme moyen.
  const castSec = Math.max(60, Math.round(setting(store, 'CatCastMinutes') * 60 * (1 - love.speed) * petRhythm(store, user, 'moka').factor));
  const total = Math.floor((Math.min(t, s.until) - s.start) / castSec);
  const n = Math.max(0, total - (Number(s.done) || 0));
  const finished = t >= s.until;
  if (!n) return finished ? { fields: { CatState: '' }, report: null } : null;
  const { table, field, weather } = catLoot(store, user);
  const fields = {};
  const add = (col, v) => { fields[col] = (fields[col] ?? (Number(user[col]) || 0)) + v; };
  const items = new Map();
  for (let i = 0; i < n && table.length; i++) {
    let x = rollLoot(table);
    if (x.type === 'nothing') continue;
    const min = Math.max(1, Number(x.min) || 1), max = Math.max(min, Number(x.max) || min);
    let amount = min + Math.floor(Math.random() * (max - min + 1));
    // Jamais de booster par Moka (equilibre de l'economie).
    if (x.type === 'booster') { x = table.find((y) => y.type === 'dust') || { type: 'dust', label: 'Poussières', tier: 'commune' }; amount = BOOSTER_DUST; }
    if (!field[x.type]) continue;
    add(field[x.type], amount);
    const g = items.get(x.type) || { type: x.type, label: x.label, tier: x.tier, amount: 0 };
    g.amount += amount;
    items.set(x.type, g);
  }
  if (love.loot > 0 && fields.StardustCount != null) {
    const gained = fields.StardustCount - (Number(user.StardustCount) || 0);
    const extra = Math.round(gained * love.loot);
    if (extra > 0) { fields.StardustCount += extra; const g = items.get('dust'); if (g) g.amount += extra; }
  }
  const gift = petGift(store, { ...user, ...fields }, 'moka');
  if (gift) Object.assign(fields, gift.fields);
  const species = catchSpecies({ ...user, ...fields }, { store, count: n, weatherKey: weather.key });
  if (species) { Object.assign(fields, species.fields); add('StardustCount', species.dust); }
  fields.CatState = finished && total >= Math.floor((s.until - s.start) / castSec) ? '' : JSON.stringify({ ...s, done: total });
  // P.S. (2026-10-19) : un indice sur ses amis chats (reglages MokaHints, MokaHintChance).
  const hints = (setting(store, 'MokaHints') || []).filter((h) => typeof h === 'string' && h.trim());
  const hint = hints.length && Math.random() < setting(store, 'MokaHintChance') ? hints[Math.floor(Math.random() * hints.length)] : null;
  return { fields, report: { casts: n, items: [...items.values()], species: species ? species.items : [], speciesDust: species ? species.dust : 0, done: !fields.CatState, ...(hint ? { hint } : {}), ...(gift ? { loveGift: gift.gift } : {}), ...(love.love ? { love: Math.round(love.love) } : {}) } };
}

function rollLoot(table) {
  let r = Math.random();
  for (const x of table) { r -= x.chance; if (r <= 0) return x; }
  return table[table.length - 1];
}

export function catView(store, user) {
  const s = stateOf(user);
  const t = now();
  return {
    fish: Number(user.CatFish) || 0,
    secondsLeft: s ? Math.max(0, s.until - t) : 0,
    minutesPerFish: setting(store, 'CatMinutesPerFish'),
    castMinutes: setting(store, 'CatCastMinutes'),
    maxMinutes: setting(store, 'CatMaxMinutes'),
    // Plus de limite de poissons par jour (2026-10-26) : la fatigue (pets.js) la remplace.
    dailyFish: 0,
    fedToday: fedToday(user)
  };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  // Credite d'abord ce que Moka a deja peche.
  const settled = settleCat(store, user);
  if (settled) user = store.update('Users', user.id, settled.fields);
  const report = settled && settled.report;
  if ((body.action || 'status') === 'status') return ok({ cat: catView(store, user), catReport: report });
  if (body.action !== 'feed') return fail('unknown_action');
  const count = Math.max(1, Math.floor(Number(body.count) || 1));
  const v = catView(store, user);
  if (v.fish < count) return fail('no_cat_fish', 400, { cat: v });
  const t = now();
  const s = stateOf(user);
  const add = count * v.minutesPerFish * 60;
  const until = (s && s.until > t ? s.until : t) + add;
  if (until - t > v.maxMinutes * 60) return fail('cat_max_time', 400, { cat: v });
  const state = s && s.until > t ? { ...s, until } : { start: t, until, done: 0 };
  user = store.update('Users', user.id, { CatFish: v.fish - count, CatState: JSON.stringify(state), CatFedDay: parisDay(0), CatFedCount: v.fedToday + count });
  return ok({ cat: catView(store, user), fed: count, catReport: report });
}

export const routes = { 'POST cat': handle };
