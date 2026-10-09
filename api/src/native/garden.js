// Jardin (2026-10-05) : deuxieme metier de recolte, relie a la peche.
// 4 parcelles : on plante (GardenPlantCost poussieres), ca pousse
// GardenGrowHours heures, puis on recolte : vers de terre et, avec un peu de
// chance, un APPAT DORE (Users.GoldBait). Un appat dore utilise a la peche
// supprime les prises vides et multiplie les prises rares pour ce lancer.
// Jardin etendu (2026-10-09) : graines au choix (melange, vers, appats,
// poussieres d'etoile) et parcelles supplementaires a acheter (prix
// croissant, indexe sur la richesse, GardenMaxPlots au total).
//   POST /webhook/garden { userId, action: 'status' | 'plant' | 'harvest' | 'buyPlot', plot?, seed? }

import { ok, fail, userById, now } from './common.js';
import { setting } from './settings.js';
import { gardenLevel } from './levels.js';
import { talentValue } from './talents.js';
import { diceFace } from './daily.js';
import { price as indexed } from './inflation.js';

export const PLOTS = 4;

export const schema = {
  Users: { GardenPlots: { type: 'Text' }, GoldBait: { type: 'Numeric' }, GardenExtraPlots: { type: 'Numeric' } }
};

// Graines : prix (x GardenPlantCost), temps de pousse (x), recolte.
export const SEEDS = {
  mix: { label: 'Mélange', icon: '🌱', cost: 1, grow: 1, desc: 'Vers, parfois un appât ou des poussières.' },
  worm: { label: 'Terreau à vers', icon: '🪱', cost: 1, grow: 1, desc: '3 à 5 vers, rien d’autre.' },
  bait: { label: 'Fleur dorée', icon: '🌼', cost: 3, grow: 1.5, desc: 'Chance d’appât doré doublée, 1 ver.' },
  dust: { label: 'Étoile filante', icon: '🌠', cost: 4, grow: 2, desc: '30 à 70 poussières, pas de vers.' }
};
export const seedMult = (p) => (SEEDS[p && p.seed] || SEEDS.mix).grow;
const plotCount = (store, user) => Math.min(setting(store, 'GardenMaxPlots'), PLOTS + (Number(user.GardenExtraPlots) || 0));
const plotPrice = (store, user) => indexed(store, setting(store, 'GardenPlotPrice') * (1 + (Number(user.GardenExtraPlots) || 0)));

// Temps de pousse du joueur (2026-10-07) : niveau de jardinage, talent Main
// verte, de du jour (face 3 : 2x plus vite). Au moins 20 % du temps de base.
export function growSeconds(store, user) {
  const base = setting(store, 'GardenGrowHours') * 3600;
  const cut = Math.min(0.8, gardenLevel(store, user).perks.growReduction + talentValue(user, 'greenthumb'));
  return Math.max(60, Math.round(base * (1 - cut) * (diceFace(user) === 3 ? 0.5 : 1)));
}

const plotsOf = (user, n = PLOTS) => {
  let p = [];
  try { p = JSON.parse(user.GardenPlots || '[]'); } catch (e) { p = []; }
  return Array.from({ length: n }, (_, i) => (p[i] && p[i].plantedAt ? p[i] : null));
};

function state(store, user) {
  const grow = growSeconds(store, user);
  const t = now();
  const plots = plotsOf(user, plotCount(store, user)).map((p, i) => {
    if (!p) return { plot: i, planted: false };
    const g = Math.round(grow * seedMult(p));
    return { plot: i, planted: true, seed: p.seed || 'mix', plantedAt: p.plantedAt, readyAt: p.plantedAt + g, ready: p.plantedAt + g <= t, progress: Math.min(1, (t - p.plantedAt) / g) };
  });
  const base = setting(store, 'GardenPlantCost');
  const max = setting(store, 'GardenMaxPlots');
  return {
    plots, growHours: Math.round((grow / 3600) * 10) / 10, plantCost: base,
    seeds: Object.entries(SEEDS).map(([key, s]) => ({ key, label: s.label, icon: s.icon, desc: s.desc, cost: base * s.cost, growHours: Math.round((grow * s.grow / 3600) * 10) / 10 })),
    extraPlot: plots.length < max ? { price: plotPrice(store, user), owned: plots.length, max } : { price: null, owned: plots.length, max },
    baitChance: Math.min(1, setting(store, 'GardenBaitChance') + gardenLevel(store, user).perks.baitBonus), level: gardenLevel(store, user), stardust: Number(user.StardustCount) || 0,
    goldBait: Number(user.GoldBait) || 0, worms: Number(user.Worms) || 0,
    readyCount: plots.filter((p) => p.ready).length
  };
}

function handleGarden({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  const n = plotCount(store, user);
  const plots = plotsOf(user, n);
  if (action === 'buyPlot') {
    if (n >= setting(store, 'GardenMaxPlots')) return fail('max_plots');
    const price = plotPrice(store, user);
    if ((Number(user.StardustCount) || 0) < price) return fail('not_enough_dust', 400, { price });
    user = store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) - price, GardenExtraPlots: (Number(user.GardenExtraPlots) || 0) + 1 });
    return ok({ ...state(store, user), boughtPlot: true, paid: price });
  }
  if (action === 'plant') {
    const seed = SEEDS[body.seed] ? body.seed : 'mix';
    const targets = body.plot == null ? plots.map((p, i) => (p ? null : i)).filter((i) => i != null) : [Number(body.plot)];
    const free = targets.filter((i) => i >= 0 && i < n && !plots[i]);
    if (!free.length) return fail('no_free_plot');
    const cost = setting(store, 'GardenPlantCost') * SEEDS[seed].cost;
    const affordable = cost > 0 ? Math.min(free.length, Math.floor((Number(user.StardustCount) || 0) / cost)) : free.length;
    if (!affordable) return fail('not_enough_dust');
    free.slice(0, affordable).forEach((i) => { plots[i] = seed === 'mix' ? { plantedAt: now() } : { plantedAt: now(), seed }; });
    user = store.update('Users', user.id, { GardenPlots: JSON.stringify(plots), StardustCount: (Number(user.StardustCount) || 0) - cost * affordable });
    return ok({ ...state(store, user), planted: affordable });
  }
  if (action === 'harvest') {
    const grow = growSeconds(store, user);
    const baitChance = Math.min(1, setting(store, 'GardenBaitChance') + gardenLevel(store, user).perks.baitBonus);
    const ready = plots.map((p, i) => (p && p.plantedAt + Math.round(grow * seedMult(p)) <= now() ? i : null)).filter((i) => i != null);
    if (!ready.length) return fail('nothing_ready');
    let worms = 0, bait = 0, dust = 0;
    const items = [];
    let xp = 0;
    for (const i of ready) {
      const seed = (plots[i] && plots[i].seed) || 'mix';
      const item = { plot: i, seed, worms: 0, bait: 0, dust: 0 };
      if (seed === 'worm') item.worms = 3 + Math.floor(Math.random() * 3);
      else if (seed === 'bait') { item.worms = 1; if (Math.random() < Math.min(0.95, baitChance * 2)) item.bait = 1; }
      else if (seed === 'dust') item.dust = 30 + Math.floor(Math.random() * 41);
      else {
        item.worms = 1 + Math.floor(Math.random() * 2);
        if (Math.random() < baitChance) item.bait = 1;
        if (Math.random() < 0.15) item.dust = 15 + Math.floor(Math.random() * 26);
      }
      worms += item.worms; bait += item.bait; dust += item.dust;
      xp += seed === 'mix' || seed === 'worm' ? 2 : 3;
      items.push(item);
      plots[i] = null;
    }
    const before = gardenLevel(store, user).level;
    user = store.update('Users', user.id, {
      GardenPlots: JSON.stringify(plots), Worms: (Number(user.Worms) || 0) + worms,
      GoldBait: (Number(user.GoldBait) || 0) + bait, StardustCount: (Number(user.StardustCount) || 0) + dust,
      GardenXP: (Number(user.GardenXP) || 0) + xp
    });
    const after = gardenLevel(store, user).level;
    return ok({ ...state(store, user), harvested: ready.length, items, gained: { worms, bait, dust, xp }, ...(after > before ? { levelUp: after } : {}) });
  }
  if (action !== 'status') return fail('unknown_action');
  return ok(state(store, user));
}

export const routes = { 'POST garden': handleGarden };
