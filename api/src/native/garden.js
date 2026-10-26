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
// Nouvelles graines (2026-10-26), debloquees par le niveau de jardinage :
// herbe a chat (poissons pour Moka), arbre a os (os pour Milo, parfois un
// crane de dino), champignon lumineux (poussieres, souvent une piece
// detachee). Nom, prix, pousse, niveau requis et retrait de chaque graine :
// reglage GardenSeeds. L'engrais double le butin principal de chaque graine.
//   POST /webhook/garden { userId, action: 'status' | 'plant' | 'harvest' | 'buyPlot' | 'fertilize', plot?, seed? }

import { ok, fail, userById, now, parisDay } from './common.js';
import { setting } from './settings.js';
import { gardenLevel } from './levels.js';
import { talentValue } from './talents.js';
import { diceFace } from './daily.js';
import { price as indexed } from './inflation.js';
import { upgradeValue } from './upgrades.js';
import { modeIs } from './modeperks.js';
import { dinoTalent, talentUntil } from './dino.js';
import { ruleOn } from './moderules.js';
import { petMask } from './starter.js';

export const PLOTS = 4;

export const schema = {
  Users: { GardenPlots: { type: 'Text' }, GoldBait: { type: 'Numeric' }, GardenExtraPlots: { type: 'Numeric' }, GardenStreak: { type: 'Numeric' }, GardenStreakDay: { type: 'Text' } }
};

// Graines : prix (x GardenPlantCost), temps de pousse (x), recolte.
const SEEDS = {
  mix: { label: 'Mélange', icon: '🌱', cost: 1, grow: 1, desc: 'Vers, parfois un appât ou des poussières.' },
  worm: { label: 'Terreau à vers', icon: '🪱', cost: 1, grow: 1, desc: '3 à 5 vers, rien d’autre.' },
  bait: { label: 'Fleur dorée', icon: '🌼', cost: 3, grow: 1.5, desc: 'Chance d’appât doré doublée, 1 ver.' },
  dust: { label: 'Étoile filante', icon: '🌠', cost: 4, grow: 2, desc: '30 à 70 poussières, pas de vers.' },
  catnip: { label: 'Herbe à chat', icon: '🌿', cost: 2, grow: 1.2, level: 2, desc: '2 à 4 poissons pour Moka.' },
  bone: { label: 'Arbre à os', icon: '🦴', cost: 3, grow: 1.5, level: 4, desc: '1 ou 2 os pour Milo, parfois un crâne de dino.' },
  mushroom: { label: 'Champignon lumineux', icon: '🍄', cost: 4, grow: 2, level: 6, desc: '20 à 40 poussières, souvent une pièce détachée.' }
};
// Graines reglables (GardenSeeds) : on ne change que nom, prix, pousse,
// niveau et presence ; ce que donne chaque graine reste celui du jeu.
let seedStore = null;
function seedsOf(store) {
  const rows = store ? setting(store, 'GardenSeeds') : [];
  const out = {};
  for (const [k, s] of Object.entries(SEEDS)) {
    const r = (Array.isArray(rows) ? rows : []).find((x) => x && x.key === k) || {};
    const num = (v, def, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : def; };
    if (r.active === false && k !== 'mix') continue;
    out[k] = { ...s, label: String(r.label || s.label).slice(0, 40), cost: num(r.cost, s.cost, 0, 100), grow: num(r.grow, s.grow, 0.1, 10), level: Math.round(num(r.level, s.level || 1, 1, 10)) };
  }
  return out;
}
// Les autres modules (minuteurs, notifications...) lisent la pousse sans store.
export function init({ store }) { seedStore = store; }
const seedCfg = (p) => { const all = seedsOf(seedStore); return all[p && p.seed] || SEEDS[p && p.seed] || SEEDS.mix; };
export const seedMult = (p) => seedCfg(p).grow;
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
// Stegosaure (dino.js) : les plantes ne fanent plus.
const wiltSeconds = (store, user) => (ruleOn(store, 'cool.magicGarden') || dinoTalent(user, 'stego') ? 0 : setting(store, 'GardenWiltHours') * 3600);
// Une plante protegee (Stegosaure, jardin magique) garde la date de sa derniere
// protection (p.safeAt) : si la protection s'arrete, elle ne fane qu'a partir
// de la, jamais d'un coup pour tout le temps deja passe (2026-10-26).
const wiltFrom = (p, readyAt, stegoUntil = 0) => Math.max(readyAt, Number(p.safeAt) || 0, stegoUntil);
function protectPlots(store, user) {
  if (wiltSeconds(store, user) > 0) return user;
  let p = [];
  try { p = JSON.parse(user.GardenPlots || '[]'); } catch (e) { return user; }
  if (!Array.isArray(p) || !p.some((x) => x && x.plantedAt)) return user;
  const t = now();
  const next = p.map((x) => (x && x.plantedAt ? { ...x, safeAt: t } : x));
  return store.update('Users', user.id, { GardenPlots: JSON.stringify(next) });
}
export { protectPlots };

function state(store, user) {
  seedStore = store;
  const grow = growSeconds(store, user);
  const wilt = wiltSeconds(store, user);
  const stegoUntil = talentUntil(user, 'stego');
  const t = now();
  const plots = plotsOf(user, plotCount(store, user)).map((p, i) => {
    if (!p) return { plot: i, planted: false };
    const g = Math.round(grow * seedMult(p));
    const wiltAt = wiltFrom(p, p.plantedAt + g, stegoUntil) + wilt;
    return { plot: i, planted: true, seed: p.seed || 'mix', fertilized: !!p.fert, goldFertilized: !!p.gfert, plantedAt: p.plantedAt, readyAt: p.plantedAt + g, ready: p.plantedAt + g <= t, wiltAt, wilted: wilt > 0 && wiltAt <= t, progress: Math.min(1, (t - p.plantedAt) / g) };
  });
  const streak = gardenStreak(user);
  const base = setting(store, 'GardenPlantCost');
  const max = setting(store, 'GardenMaxPlots');
  return {
    plots, growHours: Math.round((grow / 3600) * 10) / 10, plantCost: base,
    seeds: Object.entries(seedsOf(store)).map(([key, s]) => ({ key, label: petMask(store, user)(s.label), icon: s.icon, desc: petMask(store, user)(s.desc), cost: Math.round(base * s.cost), growHours: Math.round((grow * s.grow / 3600) * 10) / 10, level: s.level || 1, locked: gardenLevel(store, user).level < (s.level || 1) })),
    catFish: Number(user.CatFish) || 0, bones: Number(user.BoneCount) || 0,
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
  user = protectPlots(store, user);
  seedStore = store;
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
    const seeds = seedsOf(store);
    const seed = seeds[body.seed] ? body.seed : 'mix';
    if (gardenLevel(store, user).level < (seeds[seed].level || 1)) return fail('seed_locked', 400, { level: seeds[seed].level });
    const targets = body.plot == null ? plots.map((p, i) => (p ? null : i)).filter((i) => i != null) : [Number(body.plot)];
    const free = targets.filter((i) => i >= 0 && i < n && !plots[i]);
    if (!free.length) return fail('no_free_plot');
    const cost = Math.round(setting(store, 'GardenPlantCost') * seeds[seed].cost);
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
    const more = { CatFish: 0, BoneCount: 0, DinoSkulls: 0, SpareParts: 0 };
    const items = [];
    let xp = 0;
    const wilt = wiltSeconds(store, user);
    const diplo = dinoTalent(user, 'long');
    for (const i of ready) {
      const seed = (plots[i] && plots[i].seed) || 'mix';
      const item = { plot: i, seed, worms: 0, bait: 0, dust: 0, catFish: 0, bones: 0, skulls: 0, parts: 0 };
      const wilted = wilt > 0 && wiltFrom(plots[i], plots[i].plantedAt + Math.round(grow * seedMult(plots[i])), talentUntil(user, 'stego')) + wilt <= now();
      if (seed === 'worm') item.worms = 3 + Math.floor(Math.random() * 3);
      else if (seed === 'bait') { item.worms = 1; if (Math.random() < Math.min(0.95, baitChance * 2)) item.bait = 1; }
      else if (seed === 'dust') item.dust = 30 + Math.floor(Math.random() * 41);
      else if (seed === 'catnip') item.catFish = 2 + Math.floor(Math.random() * 3);
      else if (seed === 'bone') { item.bones = 1 + Math.floor(Math.random() * 2); if (Math.random() < 0.06) item.skulls = 1; }
      else if (seed === 'mushroom') { item.dust = 20 + Math.floor(Math.random() * 21); if (Math.random() < 0.35) item.parts = 1; }
      else {
        item.worms = 1 + Math.floor(Math.random() * 2);
        if (Math.random() < baitChance) item.bait = 1;
        if (Math.random() < 0.15) item.dust = 15 + Math.floor(Math.random() * 26);
      }
      if (plots[i].fert) { item.fertilized = true; item.worms *= 2; item.catFish *= 2; item.bones *= 2; if (seed === 'mushroom') item.dust *= 2; }
      if (plots[i].gfert) { item.goldFertilized = true; item.bait = Math.max(1, item.bait); }
      if (diplo) { item.dino = true; item.worms += 1; }
      if (wilted) { item.wilted = true; item.worms = Math.floor(item.worms / 2); item.bait = 0; item.dust = 0; item.catFish = Math.floor(item.catFish / 2); item.bones = Math.floor(item.bones / 2); item.skulls = 0; item.parts = 0; }
      worms += item.worms; bait += item.bait; dust += item.dust;
      more.CatFish += item.catFish; more.BoneCount += item.bones; more.DinoSkulls += item.skulls; more.SpareParts += item.parts;
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
      else if (r < 0.7) { rare = { icon: '🔩', label: 'une pièce détachée' }; more.SpareParts += 1; }
      else { rare = { icon: '✨', label: '60 poussières' }; dust += 60; }
    }
    for (const [k, v] of Object.entries(more)) if (v) extra[k] = (Number(user[k]) || 0) + v;
    const before = gardenLevel(store, user).level;
    user = store.update('Users', user.id, {
      GardenPlots: JSON.stringify(plots), Worms: (Number(user.Worms) || 0) + worms,
      GoldBait: (Number(user.GoldBait) || 0) + bait, StardustCount: (Number(user.StardustCount) || 0) + dust,
      GardenXP: (Number(user.GardenXP) || 0) + xp, GardenStreak: streak, GardenStreakDay: today, ...extra
    });
    const after = gardenLevel(store, user).level;
    return ok({ ...state(store, user), harvested: ready.length, items, gained: { worms, bait, dust, xp, rare, catFish: more.CatFish, bones: more.BoneCount, skulls: more.DinoSkulls, parts: more.SpareParts, wilted: items.filter((x) => x.wilted).length }, ...(after > before ? { levelUp: after } : {}) });
  }
  if (action !== 'status') return fail('unknown_action');
  return ok(state(store, user));
}

export const routes = { 'POST garden': handleGarden };
