// Jardin (2026-10-05) : deuxieme metier de recolte, relie a la peche.
// 4 parcelles : on plante (GardenPlantCost poussieres), ca pousse
// GardenGrowHours heures, puis on recolte : vers de terre et, avec un peu de
// chance, un APPAT DORE (Users.GoldBait). Un appat dore utilise a la peche
// supprime les prises vides et multiplie les prises rares pour ce lancer.
// Jardin etendu (2026-10-09) : graines au choix (melange, vers, appats,
// poussieres d'etoile) et parcelles supplementaires a acheter (prix
// croissant, indexe sur la richesse, GardenMaxPlots au total).
// Jardin vivant (2026-10-11) : une plante prete fane apres GardenWiltHours
// heures (recolte reduite de moitie, sans appat ni poussieres) ; recolter
// plusieurs jours de suite donne une chance de recolte rare (des 3 jours).
// Engrais (2026-10-15) : un caca de dino (Users.DinoPoop, voir dino.js) sur
// une parcelle en train de pousser saute DinoFertilizerBoost de son temps de
// pousse et double les vers de la recolte. Un engrais par plantation.
//   POST /webhook/garden { userId, action: 'status' | 'plant' | 'harvest' | 'buyPlot' | 'fertilize', plot?, seed? }

import { ok, fail, userById, now, parisDay } from './common.js';
import { setting } from './settings.js';
import { gardenLevel } from './levels.js';
import { talentValue } from './talents.js';
import { diceFace } from './daily.js';
import { price as indexed } from './inflation.js';
import { upgradeValue } from './upgrades.js';
import { modeIs } from './modeperks.js';
import { dinoTalent } from './dino.js';
import { ruleOn } from './moderules.js';

export const PLOTS = 4;

export const schema = {
  Users: { GardenPlots: { type: 'Text' }, GoldBait: { type: 'Numeric' }, GardenExtraPlots: { type: 'Numeric' }, GardenStreak: { type: 'Numeric' }, GardenStreakDay: { type: 'Text' } }
};

// Graines : prix (x GardenPlantCost), temps de pousse (x), recolte.
const SEEDS = {
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
  const cut = Math.min(0.8, gardenLevel(store, user).perks.growReduction + talentValue(user, 'greenthumb') + upgradeValue(user, 'greenhouse'));
  return Math.max(60, Math.round(base * (1 - cut) * (diceFace(user) === 3 ? 0.5 : 1)));
}

const plotsOf = (user, n = PLOTS) => {
  let p = [];
  try { p = JSON.parse(user.GardenPlots || '[]'); } catch (e) { p = []; }
  return Array.from({ length: n }, (_, i) => (p[i] && p[i].plantedAt ? p[i] : null));
};

// Serie de jours de recolte (en cours si la derniere recolte date d'hier ou d'aujourd'hui).
function gardenStreak(user) {
  const day = user.GardenStreakDay;
  return day === parisDay(0) || day === parisDay(-1) ? Number(user.GardenStreak) || 0 : 0;
}
const rareChance = (store, streak) => Math.max(ruleOn(store, 'cool.magicGarden') ? 0.2 : 0, streak >= 3 ? Math.min(0.5, setting(store, 'GardenRareChancePerDay') * (streak - 2)) : 0);
// Stegosaure content : les plantes ne fanent plus (dino.js).
const wiltSeconds = (store, user) => (ruleOn(store, 'cool.magicGarden') || dinoTalent(user, 'stego') ? 0 : setting(store, 'GardenWiltHours') * 3600);

function state(store, user) {
  const grow = growSeconds(store, user);
  const wilt = wiltSeconds(store, user);
  const t = now();
  const plots = plotsOf(user, plotCount(store, user)).map((p, i) => {
    if (!p) return { plot: i, planted: false };
    const g = Math.round(grow * seedMult(p));
    const wiltAt = p.plantedAt + g + wilt;
    return { plot: i, planted: true, seed: p.seed || 'mix', fertilized: !!p.fert, goldFertilized: !!p.gfert, plantedAt: p.plantedAt, readyAt: p.plantedAt + g, ready: p.plantedAt + g <= t, wiltAt, wilted: wilt > 0 && wiltAt <= t, progress: Math.min(1, (t - p.plantedAt) / g) };
  });
  const streak = gardenStreak(user);
  const base = setting(store, 'GardenPlantCost');
  const max = setting(store, 'GardenMaxPlots');
  return {
    plots, growHours: Math.round((grow / 3600) * 10) / 10, plantCost: base,
    seeds: Object.entries(SEEDS).map(([key, s]) => ({ key, label: s.label, icon: s.icon, desc: s.desc, cost: base * s.cost, growHours: Math.round((grow * s.grow / 3600) * 10) / 10 })),
    extraPlot: plots.length < max ? { price: plotPrice(store, user), owned: plots.length, max } : { price: null, owned: plots.length, max },
    baitChance: Math.min(1, setting(store, 'GardenBaitChance') + gardenLevel(store, user).perks.baitBonus), level: gardenLevel(store, user), stardust: Number(user.StardustCount) || 0,
    goldBait: Number(user.GoldBait) || 0, worms: Number(user.Worms) || 0, fertilizer: Number(user.DinoPoop) || 0, goldFertilizer: Number(user.DinoGoldPoop) || 0,
    readyCount: plots.filter((p) => p.ready).length,
    streak, rareChance: rareChance(store, streak + (user.GardenStreakDay === parisDay(-1) ? 1 : 0)), wiltHours: wiltSeconds(store, user) / 3600
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
  if (action === 'fertilize' && (body.gold === true || body.gold === 'true')) {
    const grow = growSeconds(store, user);
    const t = now();
    const i = Number(body.plot);
    if (!(i >= 0 && i < n) || !plots[i] || plots[i].gfert || plots[i].plantedAt + Math.round(grow * seedMult(plots[i])) <= t) return fail('nothing_to_fertilize');
    const have = Number(user.DinoGoldPoop) || 0;
    if (have < 1) return fail('no_fertilizer');
    plots[i] = { ...plots[i], plantedAt: t - Math.round(grow * seedMult(plots[i])), gfert: true };
    user = store.update('Users', user.id, { GardenPlots: JSON.stringify(plots), DinoGoldPoop: have - 1 });
    return ok({ ...state(store, user), fertilized: 1, gold: true });
  }
  if (action === 'fertilize') {
    const grow = growSeconds(store, user);
    const t = now();
    const growing = (i) => plots[i] && !plots[i].fert && plots[i].plantedAt + Math.round(grow * seedMult(plots[i])) > t;
    const targets = (body.plot == null ? plots.map((_, i) => i) : [Number(body.plot)]).filter((i) => i >= 0 && i < n && growing(i));
    if (!targets.length) return fail('nothing_to_fertilize');
    const have = Number(user.DinoPoop) || 0;
    if (have < 1) return fail('no_fertilizer');
    const used = targets.slice(0, have);
    const boost = setting(store, 'DinoFertilizerBoost');
    for (const i of used) plots[i] = { ...plots[i], plantedAt: plots[i].plantedAt - Math.round(grow * seedMult(plots[i]) * boost), fert: true };
    user = store.update('Users', user.id, { GardenPlots: JSON.stringify(plots), DinoPoop: have - used.length });
    return ok({ ...state(store, user), fertilized: used.length });
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
    const wilt = wiltSeconds(store, user);
    const diplo = dinoTalent(user, 'long');
    for (const i of ready) {
      const seed = (plots[i] && plots[i].seed) || 'mix';
      const item = { plot: i, seed, worms: 0, bait: 0, dust: 0 };
      const wilted = wilt > 0 && plots[i].plantedAt + Math.round(grow * seedMult(plots[i])) + wilt <= now();
      if (seed === 'worm') item.worms = 3 + Math.floor(Math.random() * 3);
      else if (seed === 'bait') { item.worms = 1; if (Math.random() < Math.min(0.95, baitChance * 2)) item.bait = 1; }
      else if (seed === 'dust') item.dust = 30 + Math.floor(Math.random() * 41);
      else {
        item.worms = 1 + Math.floor(Math.random() * 2);
        if (Math.random() < baitChance) item.bait = 1;
        if (Math.random() < 0.15) item.dust = 15 + Math.floor(Math.random() * 26);
      }
      if (plots[i].fert) { item.fertilized = true; item.worms *= 2; }
      if (plots[i].gfert) { item.goldFertilized = true; item.bait = Math.max(1, item.bait); }
      if (diplo) { item.dino = true; item.worms += 1; }
      if (wilted) { item.wilted = true; item.worms = Math.floor(item.worms / 2); item.bait = 0; item.dust = 0; }
      worms += item.worms; bait += item.bait; dust += item.dust;
      xp += seed === 'mix' || seed === 'worm' ? 2 : 3;
      items.push(item);
      plots[i] = null;
    }
    // Serie de visites et recolte rare.
    const today = parisDay(0);
    const streak = user.GardenStreakDay === today ? Number(user.GardenStreak) || 1 : user.GardenStreakDay === parisDay(-1) ? (Number(user.GardenStreak) || 0) + 1 : 1;
    let rare = null;
    const extra = {};
    if (Math.random() < rareChance(store, streak)) {
      const r = Math.random();
      if (r < 0.4) { rare = { icon: '🪝', label: 'un appât doré en plus' }; bait += 1; }
      else if (r < 0.7) { rare = { icon: '🔩', label: 'une pièce détachée' }; extra.SpareParts = (Number(user.SpareParts) || 0) + 1; }
      else { rare = { icon: '✨', label: '60 poussières' }; dust += 60; }
    }
    const before = gardenLevel(store, user).level;
    user = store.update('Users', user.id, {
      GardenPlots: JSON.stringify(plots), Worms: (Number(user.Worms) || 0) + worms,
      GoldBait: (Number(user.GoldBait) || 0) + bait, StardustCount: (Number(user.StardustCount) || 0) + dust,
      GardenXP: (Number(user.GardenXP) || 0) + xp, GardenStreak: streak, GardenStreakDay: today, ...extra
    });
    const after = gardenLevel(store, user).level;
    return ok({ ...state(store, user), harvested: ready.length, items, gained: { worms, bait, dust, xp, rare, wilted: items.filter((x) => x.wilted).length }, ...(after > before ? { levelUp: after } : {}) });
  }
  if (action !== 'status') return fail('unknown_action');
  return ok(state(store, user));
}

export const routes = { 'POST garden': handleGarden };
