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
// Potager et Noisette (2026-10-30) : graine « Potager » (legumes et herbes
// pour la cuisine, cooking.js), vers blancs a la recolte (nourriture de
// Pistache, archeo.js), soupe du potager (pousse plus rapide). NOISETTE LA
// LAPINE : on lui donne des carottes (Users.Carrots ; BunnyMinutesPerCarrot
// minutes de travail chacune) et elle recolte les parcelles pretes puis
// replante la meme graine (payee en poussieres, la tendresse lui donne de
// l'avance sur la pousse). Ses recoltes s'accumulent dans un rapport
// (Users.BunnyReport) remis a la visite du jardin (takeReport).
//   POST /webhook/garden { userId, action: 'status' | 'plant' | 'harvest' | 'buyPlot' | 'fertilize' | 'bunnyFeed', plot?, seed?, count?, takeReport? }

import { ok, fail, userById, now, parisDay, parseJson } from './common.js';
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
import { petBoost, petGift } from './pets.js';
import { pantryFields, gardenBuff } from './cooking.js';

export const PLOTS = 4;

export const schema = {
  Users: { GardenPlots: { type: 'Text' }, GoldBait: { type: 'Numeric' }, GardenExtraPlots: { type: 'Numeric' }, GardenStreak: { type: 'Numeric' }, GardenStreakDay: { type: 'Text' }, Carrots: { type: 'Numeric' }, Grubs: { type: 'Numeric' }, BunnyState: { type: 'Text' }, BunnyReport: { type: 'Text' } }
};

// Graines : prix (x GardenPlantCost), temps de pousse (x), recolte.
const SEEDS = {
  mix: { label: 'Mélange', icon: '🌱', cost: 1, grow: 1, desc: 'Vers, parfois un appât ou des poussières.' },
  worm: { label: 'Terreau à vers', icon: '🪱', cost: 1, grow: 1, desc: '3 à 5 vers, rien d’autre.' },
  bait: { label: 'Fleur dorée', icon: '🌼', cost: 3, grow: 1.5, desc: 'Chance d’appât doré doublée, 1 ver.' },
  dust: { label: 'Étoile filante', icon: '🌠', cost: 4, grow: 2, desc: '30 à 70 poussières, pas de vers.' },
  catnip: { label: 'Herbe à chat', icon: '🌿', cost: 2, grow: 1.2, level: 2, desc: '2 à 4 poissons pour Moka.' },
  bone: { label: 'Arbre à os', icon: '🦴', cost: 3, grow: 1.5, level: 4, desc: '1 ou 2 os pour Milo, parfois un crâne de dino.' },
  mushroom: { label: 'Champignon lumineux', icon: '🍄', cost: 4, grow: 2, level: 6, desc: '20 à 40 poussières, souvent une pièce détachée.' },
  veggie: { label: 'Potager', icon: '🥬', cost: 2, grow: 1.2, desc: '2 à 4 légumes pour la cuisine, souvent des herbes.' }
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
// p.fast : soupe du potager (cooking.js), fixee a la plantation pour qu'une
// plante prete ne redevienne pas « en train de pousser » a la fin du bonus.
export const seedMult = (p) => seedCfg(p).grow * (Number(p && p.fast) > 0 && Number(p.fast) < 1 ? Number(p.fast) : 1);
// Nouvelle plantation (toi ou Noisette).
const newPlot = (store, user, seed, at) => {
  const fast = gardenBuff(store, user);
  return { plantedAt: at, ...(seed === 'mix' ? {} : { seed }), ...(fast < 1 ? { fast } : {}) };
};
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
    bunny: bunnyView(store, user), grubs: Number(user.Grubs) || 0,
    streak, rareChance: rareChance(store, streak + (user.GardenStreakDay === parisDay(-1) ? 1 : 0)), wiltHours: wiltSeconds(store, user) / 3600
  };
}

function handleGarden({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  user = protectPlots(store, user);
  seedStore = store;
  // Noisette : ce qu'elle a recolte depuis le dernier passage.
  const worked = settleBunny(store, user);
  if (worked) user = store.update('Users', user.id, worked);
  const report = takeReport(store, user, body.takeReport === true || body.takeReport === 'true');
  if (report.bunnyReport) user = store.get('Users', user.id);
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
    free.slice(0, affordable).forEach((i) => { plots[i] = newPlot(store, user, seed, now()); });
    user = store.update('Users', user.id, { GardenPlots: JSON.stringify(plots), StardustCount: (Number(user.StardustCount) || 0) - cost * affordable });
    return ok({ ...state(store, user), planted: affordable });
  }
  if (action === 'harvest') {
    const grow = growSeconds(store, user);
    const baitChance = Math.min(1, setting(store, 'GardenBaitChance') + gardenLevel(store, user).perks.baitBonus);
    const ready = plots.map((p, i) => (p && p.plantedAt + Math.round(grow * seedMult(p)) <= now() ? i : null)).filter((i) => i != null);
    if (!ready.length) return fail('nothing_ready');
    let worms = 0, bait = 0, dust = 0;
    const more = { CatFish: 0, BoneCount: 0, DinoSkulls: 0, SpareParts: 0, Grubs: 0 };
    const items = [];
    let xp = 0;
    const wilt = wiltSeconds(store, user);
    const diplo = dinoTalent(user, 'long');
    const kitchen = { veg: 0, herb: 0, mush: 0 };
    for (const i of ready) {
      const wilted = wilt > 0 && wiltFrom(plots[i], plots[i].plantedAt + Math.round(grow * seedMult(plots[i])), talentUntil(user, 'stego')) + wilt <= now();
      const item = rollPlot(store, plots[i], i, { wilted, baitChance, diplo });
      worms += item.worms; bait += item.bait; dust += item.dust;
      more.CatFish += item.catFish; more.BoneCount += item.bones; more.DinoSkulls += item.skulls; more.SpareParts += item.parts; more.Grubs += item.grubs;
      kitchen.veg += item.veg; kitchen.herb += item.herb; kitchen.mush += item.mush;
      xp += item.xp;
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
      GardenXP: (Number(user.GardenXP) || 0) + xp, GardenStreak: streak, GardenStreakDay: today, ...extra, ...pantryFields(user, kitchen)
    });
    const after = gardenLevel(store, user).level;
    return ok({ ...state(store, user), harvested: ready.length, items, gained: { worms, bait, dust, xp, rare, catFish: more.CatFish, bones: more.BoneCount, skulls: more.DinoSkulls, parts: more.SpareParts, grubs: more.Grubs, ...kitchen, wilted: items.filter((x) => x.wilted).length }, ...(after > before ? { levelUp: after } : {}), ...report });
  }
  if (action === 'bunnyFeed') {
    const count = Math.max(1, Math.floor(Number(body.count) || 1));
    const v = bunnyView(store, user);
    if (v.carrots < count) return fail('no_carrot', 400, { bunny: v });
    const t = now();
    const s = bunnyStateOf(user);
    const until = (s && s.until > t ? s.until : t) + count * v.minutesPerCarrot * 60;
    if (until - t > v.maxMinutes * 60) return fail('bunny_max_time', 400, { bunny: v });
    user = store.update('Users', user.id, { Carrots: v.carrots - count, BunnyState: JSON.stringify(s && s.until > t ? { ...s, until } : { start: t, until }) });
    // Elle se met au travail tout de suite (parcelles deja pretes).
    const now2 = settleBunny(store, user);
    if (now2) user = store.update('Users', user.id, now2);
    return ok({ ...state(store, user), fed: count, ...takeReport(store, user, true) });
  }
  if (action !== 'status') return fail('unknown_action');
  return ok({ ...state(store, user), ...report });
}

// Ce que donne une parcelle recoltee (toi ou Noisette).
function rollPlot(store, p, i, { wilted = false, baitChance = 0, diplo = false } = {}) {
  const seed = (p && p.seed) || 'mix';
  const item = { plot: i, seed, worms: 0, bait: 0, dust: 0, catFish: 0, bones: 0, skulls: 0, parts: 0, grubs: 0, veg: 0, herb: 0, mush: 0, xp: seed === 'mix' || seed === 'worm' ? 2 : 3 };
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  if (seed === 'worm') item.worms = rnd(3, 5);
  else if (seed === 'bait') { item.worms = 1; if (Math.random() < Math.min(0.95, baitChance * 2)) item.bait = 1; }
  else if (seed === 'dust') item.dust = rnd(30, 70);
  else if (seed === 'catnip') item.catFish = rnd(2, 4);
  else if (seed === 'bone') { item.bones = rnd(1, 2); if (Math.random() < 0.06) item.skulls = 1; }
  else if (seed === 'mushroom') { item.dust = rnd(20, 40); if (Math.random() < 0.35) item.parts = 1; if (Math.random() < 0.5) item.mush = 1; }
  else if (seed === 'veggie') { item.veg = rnd(2, 4); if (Math.random() < 0.6) item.herb = 1; }
  else {
    item.worms = rnd(1, 2);
    if (Math.random() < baitChance) item.bait = 1;
    if (Math.random() < 0.15) item.dust = rnd(15, 40);
    if (Math.random() < 0.3) item.veg = 1;
  }
  // Vers blancs (nourriture de Pistache) : plus souvent dans le terreau a vers.
  if (Math.random() < setting(store, 'GrubGardenChance') * (seed === 'worm' ? 2 : 1)) item.grubs = 1;
  if (p.fert) { item.fertilized = true; item.worms *= 2; item.catFish *= 2; item.bones *= 2; item.veg *= 2; if (seed === 'mushroom') item.dust *= 2; }
  if (p.gfert) { item.goldFertilized = true; item.bait = Math.max(1, item.bait); }
  if (diplo) { item.dino = true; item.worms += 1; }
  if (wilted) { item.wilted = true; item.worms = Math.floor(item.worms / 2); item.bait = 0; item.dust = 0; item.catFish = Math.floor(item.catFish / 2); item.bones = Math.floor(item.bones / 2); item.skulls = 0; item.parts = 0; item.grubs = 0; item.veg = Math.floor(item.veg / 2); item.herb = 0; item.mush = 0; }
  return item;
}

// ------------------------------------------------------------- Noisette
const bunnyStateOf = (user) => { const s = parseJson(user && user.BunnyState, null); return s && s.start && s.until ? s : null; };
function bunnyView(store, user) {
  const s = bunnyStateOf(user);
  const t = now();
  return { carrots: Number(user.Carrots) || 0, secondsLeft: s ? Math.max(0, s.until - t) : 0, minutesPerCarrot: setting(store, 'BunnyMinutesPerCarrot'), maxMinutes: setting(store, 'BunnyMaxMinutes'), pending: !!parseJson(user.BunnyReport, null) };
}
const GAIN_KEYS = ['worms', 'bait', 'dust', 'catFish', 'bones', 'skulls', 'parts', 'grubs', 'veg', 'herb', 'mush'];
// Travail de Noisette depuis le dernier passage : champs a ecrire (ou null).
// Elle recolte chaque parcelle prete pendant ses heures de travail (au moment
// ou elle l'est), puis replante la meme graine si tu as de quoi la payer.
export function settleBunny(store, user) {
  const s = bunnyStateOf(user);
  if (!s) return null;
  const t = now();
  const end = Math.min(t, s.until);
  const n = plotCount(store, user);
  const plots = plotsOf(user, n);
  const grow = growSeconds(store, user);
  const wilt = wiltSeconds(store, user);
  const stegoUntil = talentUntil(user, 'stego');
  const love = petBoost(store, user, 'noisette');
  const baitChance = Math.min(1, setting(store, 'GardenBaitChance') + gardenLevel(store, user).perks.baitBonus);
  const seeds = seedsOf(store);
  const level = gardenLevel(store, user).level;
  const base = setting(store, 'GardenPlantCost');
  let dust = Number(user.StardustCount) || 0;
  const sum = Object.fromEntries(GAIN_KEYS.map((k) => [k, 0]));
  let harvests = 0, replanted = 0, spent = 0, xp = 0, wilted = 0;
  for (let guard = 0; guard < 120; guard++) {
    let best = -1, at = Infinity;
    plots.forEach((p, i) => { if (!p) return; const r = p.plantedAt + Math.round(grow * seedMult(p)); if (r <= end && r < at) { at = r; best = i; } });
    if (best < 0) break;
    const p = plots[best];
    const h = Math.max(at, s.start);
    const isWilted = wilt > 0 && wiltFrom(p, at, stegoUntil) + wilt <= h;
    const item = rollPlot(store, p, best, { wilted: isWilted, baitChance });
    // Tendresse : un peu plus de vers et de poussieres.
    if (love.loot > 0) { item.worms = Math.round(item.worms * (1 + love.loot)); item.dust = Math.round(item.dust * (1 + love.loot)); }
    GAIN_KEYS.forEach((k) => { sum[k] += item[k] || 0; });
    xp += item.xp;
    harvests++;
    if (isWilted) wilted++;
    plots[best] = null;
    const seed = seeds[p.seed || 'mix'] && level >= (seeds[p.seed || 'mix'].level || 1) ? p.seed || 'mix' : 'mix';
    const cost = Math.round(base * (seeds[seed] || seeds.mix).cost);
    if (h < s.until && dust + sum.dust >= cost) {
      dust -= cost; spent += cost; replanted++;
      const fresh = newPlot(store, user, seed, h);
      // Avance de pousse grace a la tendresse (jusqu'a PetMaxSpeedPct %).
      fresh.plantedAt = h - Math.round(grow * seedMult(fresh) * love.speed);
      plots[best] = fresh;
    }
  }
  const finished = t >= s.until;
  if (!harvests) return finished ? { BunnyState: '' } : null;
  const fields = {
    GardenPlots: JSON.stringify(plots), Worms: (Number(user.Worms) || 0) + sum.worms, GoldBait: (Number(user.GoldBait) || 0) + sum.bait,
    StardustCount: dust + sum.dust, GardenXP: (Number(user.GardenXP) || 0) + xp,
    CatFish: (Number(user.CatFish) || 0) + sum.catFish, BoneCount: (Number(user.BoneCount) || 0) + sum.bones, DinoSkulls: (Number(user.DinoSkulls) || 0) + sum.skulls,
    SpareParts: (Number(user.SpareParts) || 0) + sum.parts, Grubs: (Number(user.Grubs) || 0) + sum.grubs,
    ...pantryFields(user, { veg: sum.veg, herb: sum.herb, mush: sum.mush }),
    BunnyState: finished ? '' : JSON.stringify(s)
  };
  const gift = petGift(store, { ...user, ...fields }, 'noisette');
  if (gift) Object.assign(fields, gift.fields);
  // Rapport cumule jusqu'a la prochaine visite du jardin.
  const prev = parseJson(user.BunnyReport, null) || {};
  const rep = { harvests: (prev.harvests || 0) + harvests, replanted: (prev.replanted || 0) + replanted, spent: (prev.spent || 0) + spent, wilted: (prev.wilted || 0) + wilted, xp: (prev.xp || 0) + xp, gained: { ...(prev.gained || {}) }, done: finished, ...(gift ? { loveGift: gift.gift } : prev.loveGift ? { loveGift: prev.loveGift } : {}) };
  GAIN_KEYS.forEach((k) => { if (sum[k]) rep.gained[k] = (rep.gained[k] || 0) + sum[k]; });
  fields.BunnyReport = JSON.stringify(rep);
  return fields;
}
// Carottes sauvages a la fouille : une par grille terminee (toi ou Milo),
// et une chance a chaque tresor degage.
export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'dig' || response.status !== 200 || !response.json) return;
  const json = response.json;
  const user = store.get('Users', Number((request.body || {}).userId));
  if (!user) return;
  let n = (json.boardCleared ? 1 : 0) + (json.revealed && Math.random() < setting(store, 'CarrotDigChance') ? 1 : 0);
  const dogBoards = json.dogReport ? Number(json.dogReport.boards) || 0 : 0;
  if (dogBoards && !json.boardCleared) n += Math.min(3, dogBoards);
  if (!n) return;
  store.update('Users', user.id, { Carrots: (Number(user.Carrots) || 0) + n });
  json.carrotsFound = n;
}

// Rapport de Noisette, remis (et efface) quand le site le demande.
function takeReport(store, user, take) {
  const rep = parseJson(user.BunnyReport, null);
  if (!take || !rep) return { bunny: bunnyView(store, user) };
  store.update('Users', user.id, { BunnyReport: '' });
  return { bunny: { ...bunnyView(store, user), pending: false }, bunnyReport: rep };
}

export const routes = { 'POST garden': handleGarden };
