// Dinos de compagnie (2026-10-15). Chaque coup de pelle a une chance
// extremement rare (DinoSkullChance) de deterrer un CRANE DE DINOSAURE
// (Users.DinoSkulls). Crane + DinoHatchBones os (Users.BoneCount) = un dino
// de compagnie, 5 au maximum (Users.Dinos, JSON). Espece, couleur et motif
// tires au hasard ; 3 % de chromatiques et quelques couleurs nommees
// ultra-rares (albinos, obsidienne, or, fossile vivant).
// Facon tamagotchi : satiete (36 h) et bonheur (72 h) baissent avec le temps
// (calcul paresseux depuis le dernier releve `at`, rien ne tourne en tache de
// fond). Si les deux tombent a zero, le dino meurt : il ne reste qu'un TAS
// D'OS, a ramasser (on recupere DinoHatchBones os) pour liberer la place.
// Nourriture : poissons, algues, crevettes (prises en plus a la peche, voir
// fishingBycatch) et vers de terre. Chaque dino a un plat prefere, a decouvrir.
// Digestion -> CACAS a ramasser -> ENGRAIS pour le jardin (garden.js, action
// fertilize) ; la crevette donne parfois un caca DORE (parcelle prete tout de
// suite, appat dore garanti).
// Suite (2026-10-15, lot 2) :
//   - fouille automatique des adultes contents (butin a recuperer : action
//     collect), talent par espece (dinoTalent : T-Rex, Triceratops, Diplodocus,
//     Stegosaure, Velociraptor, Pterodactyle), compagnon d'expedition ;
//   - oeufs : deux adultes heureux pondent (action breed), le petit herite d'un
//     melange des couleurs ; Dinodex avec paliers et titre « Paleontologue » ;
//   - accessoires (boutique du dino), dino vedette du profil, premieres au
//     livre d'or (AppSettings dinoFirsts, lu par halloffame.js) ;
//   - saisons : costume automatique et Pterodactyle saisonnier a l'eclosion ;
//   - enclos vivant : nuit (23 h - 7 h), caresses, decorations qui ralentissent
//     la baisse du bonheur.
//   POST /webhook/dino { userId, action, dino?, food?, name?, key?, a?, b?, egg?, gold? }

import { ok, fail, userById, now, parisHour, parseJson as parse } from './common.js';
import { setting } from './settings.js';
import { addFeed } from './feed.js';
import { grantCosmetic } from './cosmetics.js';
import { currentSeason } from './seasonal.js';
import { ruleOn } from './moderules.js';

export const schema = {
  Users: {
    DinoSkulls: { type: 'Numeric' }, Dinos: { type: 'Text' }, DinoFood: { type: 'Text' }, DinoPoop: { type: 'Numeric' }, DinoGoldPoop: { type: 'Numeric' },
    DinoEggs: { type: 'Text' }, DinoDex: { type: 'Text' }, DinoAccessories: { type: 'Text' }, DinoDecor: { type: 'Text' },
    DinoStar: { type: 'Numeric' }, DinoCompanion: { type: 'Numeric' }
  }
};

export const MAX_DINOS = 5;
const MAX_EGGS = 3;
export const FOODS = {
  fish: { label: 'Poisson', icon: '🐟', food: 30, happy: 5 },
  seaweed: { label: 'Algues', icon: '🌿', food: 15, happy: 0 },
  shrimp: { label: 'Crevette', icon: '🦐', food: 20, happy: 15 },
  worm: { label: 'Ver de terre', icon: '🪱', food: 6, happy: 3 }
};
const FOOD_KEYS = Object.keys(FOODS);
const SPECIES = {
  rex: { label: 'Tyrannosaure', talent: '+25 % de poussières sur tes trésors de fouille' },
  trice: { label: 'Tricératops', talent: 'sa fouille automatique est 2 fois plus rapide' },
  long: { label: 'Diplodocus', talent: '+1 ver de terre par parcelle récoltée au jardin' },
  stego: { label: 'Stégosaure', talent: 'tes plantes ne fanent plus' },
  raptor: { label: 'Vélociraptor', talent: 'sa fouille automatique ramène des os' },
  ptero: { label: 'Ptérodactyle', talent: 'sa fouille automatique ramène du poisson', seasonal: true }
};
const BASE_SPECIES = Object.keys(SPECIES).filter((k) => !SPECIES[k].seasonal);
const PTERO_NAMES = {
  halloween: 'Ptérodactyle fantôme', christmas: 'Ptérodactyle des neiges', newyear: 'Ptérodactyle étincelant', valentine: 'Ptérodactyle Cupidon',
  easter: 'Ptérodactyle pastel', aprilfools: 'Ptérodactyle farceur', summer: 'Ptérodactyle mélomane'
};
const PATTERNS = { plain: 'Uni', spots: 'Taches', stripes: 'Rayures', belly: 'Ventre clair', galaxy: 'Galaxie', zigzag: 'Zigzag' };
const BASE_PATTERNS = ['plain', 'spots', 'stripes', 'belly'];
const RARE_PATTERNS = ['galaxy', 'zigzag'];
const COLORS = { albino: 'Albinos', obsidian: 'Obsidienne', gold: 'Or', fossil: 'Fossile vivant', chroma: 'Chromatique' };
const NAMES = ['Rexou', 'Pistache', 'Croquette', 'Galet', 'Brindille', 'Mochi', 'Pépite', 'Caillou', 'Fossile', 'Dino', 'Kiwi', 'Biscotte', 'Noisette', 'Tic-Tac', 'Bambou'];
const STAGES = [{ key: 'bebe', label: 'Bébé', xp: 0 }, { key: 'jeune', label: 'Jeune', xp: 60 }, { key: 'adulte', label: 'Adulte', xp: 200 }];
export const ACCESSORIES = {
  bow: { label: 'Nœud', icon: '🎀', price: 200 },
  glasses: { label: 'Lunettes de soleil', icon: '🕶️', price: 250 },
  scarf: { label: 'Écharpe', icon: '🧣', price: 250 },
  hat: { label: 'Haut-de-forme', icon: '🎩', price: 300 },
  cape: { label: 'Cape de héros', icon: '🦸', price: 400 },
  crown: { label: 'Couronne', icon: '👑', price: 1500 }
};
export const DECOR = {
  rock: { label: 'Rocher', icon: '🪨', price: 300 },
  nest: { label: 'Nid douillet', icon: '🪺', price: 500 },
  palm: { label: 'Palmier', icon: '🌴', price: 600 },
  pond: { label: 'Mare', icon: '💧', price: 800 },
  hut: { label: 'Cabane', icon: '🛖', price: 1200 }
};
const DECOR_BONUS = 0.06; // chaque decoration : bonheur 6 % moins vite
// Dinodex : 6 especes, 6 motifs, 5 couleurs rares, 3 stades = 20 entrees.
const DEX_TOTAL = Object.keys(SPECIES).length + Object.keys(PATTERNS).length + Object.keys(COLORS).length + STAGES.length;
const DEX_TIERS = [
  { n: 5, dust: 300, label: '300 poussières' },
  { n: 10, dust: 500, boosters: 1, label: '500 poussières et 1 booster' },
  { n: 15, boosters: 3, label: '3 boosters' },
  { n: DEX_TOTAL, boosters: 5, title: true, label: '5 boosters et le titre « Paléontologue »' }
];

const HOUR = 3600;
const FOOD_DECAY = 100 / 36;   // satiete : de 100 a 0 en 36 h
const HAPPY_DECAY = 100 / 72;  // bonheur : de 100 a 0 en 72 h (x2 affame, x2 enclos sale)
const DIGEST_HOURS = 2;
const PLAY_COOLDOWN = 3 * HOUR;
const PET_COOLDOWN = 30 * 60;
const BREED_COOLDOWN = 72 * HOUR;
const EGG_HOURS = 12;
const MAX_POOPS = 8;
const MAX_FINDS = 4;

const clamp = (v) => Math.max(0, Math.min(100, v));
const rnd = (list) => list[Math.floor(Math.random() * list.length)];
const arr = (s) => (Array.isArray(parse(s, [])) ? parse(s, []) : []);
export const dinosOf = (user) => arr(user.Dinos);
export const foodOf = (user) => ({ fish: 0, seaweed: 0, shrimp: 0, ...parse(user.DinoFood, {}) });
const eggsOf = (user) => arr(user.DinoEggs);
const accOf = (user) => arr(user.DinoAccessories);
const decorOf = (user) => arr(user.DinoDecor);
const dexOf = (user) => ({ species: {}, patterns: {}, colors: {}, stages: {}, claimed: [], ...parse(user.DinoDex, {}) });
const stageOf = (xp) => [...STAGES].reverse().find((s) => (xp || 0) >= s.xp) || STAGES[0];
const favOf = (d) => d.fav || FOOD_KEYS[(d.id || 0) % FOOD_KEYS.length];
const decorK = (user) => 1 - Math.min(0.3, decorOf(user).length * DECOR_BONUS);
const sleepingNow = () => { const h = parisHour(); return h >= 23 || h < 7; };

// Vacances des dinos (mode Cool, moderules.js) : faim et humeur figees, ponte
// deux fois plus rapide. Au debut et a la fin des vacances, tous les dinos
// sont "figes" (holidayTransition) : aucun temps n'est compte en retard.
let holiday = false;
export const dinoHoliday = () => holiday;
const breedCooldown = () => BREED_COOLDOWN / (holiday ? 2 : 1);
const eggHours = () => EGG_HOURS / (holiday ? 2 : 1);

// Valeurs du moment depuis le dernier releve. k : ralentissement du bonheur
// (decorations). Un dino deja mort le reste.
function live(d, t = now(), k = 1) {
  if (d.deadAt) return { food: 0, happy: 0, ripe: 0, clean: 0, dead: true, deadAt: d.deadAt };
  if (holiday) {
    const ripeNow = (d.poops || []).filter((p) => p <= t).length;
    return { food: clamp(d.food ?? 80), happy: clamp(d.happy ?? 80), ripe: ripeNow, clean: clamp(100 - 25 * ripeNow), dead: false };
  }
  const at = d.at || t;
  const dt = Math.max(0, t - at) / HOUR;
  const food0 = d.food ?? 80, happy0 = d.happy ?? 80;
  const food = clamp(food0 - FOOD_DECAY * dt);
  const hungryFrom = food0 / FOOD_DECAY; // heures avant d'etre affame
  const ripe = (d.poops || []).filter((p) => p <= t).sort((a, b) => a - b);
  const dirtyFrom = ripe.length >= 3 ? Math.max(0, ripe[2] - at) / HOUR : Infinity;
  // Bonheur : vitesse x1, +1 affame, +1 enclos sale. Integre par morceaux pour
  // connaitre l'instant exact ou il atteint zero.
  const r = HAPPY_DECAY * k;
  const marks = [0, hungryFrom, dirtyFrom, dt].filter((x) => x >= 0 && x <= dt).sort((a, b) => a - b);
  let happy = happy0, zeroAt = null;
  for (let i = 0; i < marks.length - 1 && happy > 0; i++) {
    const a = marks[i], b = marks[i + 1];
    const rate = r * (1 + (a >= hungryFrom ? 1 : 0) + (a >= dirtyFrom ? 1 : 0));
    const loss = rate * (b - a);
    if (loss >= happy) { zeroAt = a + happy / rate; happy = 0; } else happy -= loss;
  }
  happy = clamp(happy);
  // Mort : satiete ET bonheur a zero.
  if (food <= 0 && happy <= 0) {
    const deadH = Math.max(hungryFrom, zeroAt ?? dt);
    return { food: 0, happy: 0, ripe: ripe.length, clean: clamp(100 - 25 * ripe.length), dead: true, deadAt: Math.round(at + deadH * HOUR) };
  }
  return { food, happy, ripe: ripe.length, clean: clamp(100 - 25 * ripe.length), dead: false };
}

const content = (v) => !v.dead && v.food >= 25 && v.happy >= 40;
function moodOf(v, sleeping) {
  if (v.dead) return { key: 'dead', label: 'Tas d’os', icon: '🦴' };
  if (v.food < 25 && v.happy < 25) return { key: 'dying', label: 'En danger !', icon: '⚠️' };
  if (v.food < 25) return { key: 'hungry', label: 'Affamé', icon: '🍖' };
  if (sleeping) return { key: 'sleep', label: 'Dort', icon: '💤' };
  if (v.ripe >= 3) return { key: 'dirty', label: 'Enclos sale', icon: '💩' };
  if (v.happy < 30) return { key: 'sad', label: 'Triste', icon: '😢' };
  if (v.happy >= 75 && v.food >= 60) return { key: 'happy', label: 'Aux anges', icon: '😄' };
  return { key: 'ok', label: 'Content', icon: '🙂' };
}

const speciesLabel = (d) => (d.species === 'ptero' && d.season && PTERO_NAMES[d.season]) || SPECIES[d.species]?.label || 'Dinosaure';
const digBase = (d) => d.digAt || d.grownAt || d.bornAt || now();
const digPeriod = (store, d) => setting(store, 'DinoDigHours') * HOUR / (d.species === 'trice' ? 2 : 1);
function findsOf(store, d, v, t) {
  if (!content(v) || stageOf(d.xp).key !== 'adulte') return 0;
  return Math.min(MAX_FINDS, Math.floor((t - digBase(d)) / digPeriod(store, d)));
}

function view(store, user, d, t = now()) {
  const v = live(d, t, decorK(user));
  const st = stageOf(d.xp);
  const next = STAGES[STAGES.indexOf(st) + 1] || null;
  const sleeping = !v.dead && sleepingNow();
  return {
    id: d.id, name: d.name, species: d.species, speciesLabel: speciesLabel(d), talent: SPECIES[d.species]?.talent || '', season: d.season || null,
    hue: d.hue, pattern: d.pattern, patternLabel: PATTERNS[d.pattern] || '', shiny: !!d.shiny, color: d.color || null, colorLabel: d.color ? COLORS[d.color] : null,
    acc: d.acc || null, bornAt: d.bornAt, xp: d.xp || 0, stage: st.key, stageLabel: st.label, nextStageXp: next ? next.xp : null,
    food: Math.round(v.food), happy: Math.round(v.happy), clean: v.clean, poops: v.ripe,
    goldPoops: v.dead ? 0 : (d.goldPoops || []).filter((p) => p <= t).length,
    nextPoopAt: [...(d.poops || []), ...(d.goldPoops || [])].filter((p) => p > t).sort((a, b) => a - b)[0] || null,
    canPlayAt: (d.playAt || 0) + PLAY_COOLDOWN, canPetAt: (d.petAt || 0) + PET_COOLDOWN, canBreedAt: (d.breedAt || 0) + breedCooldown(),
    fav: d.favKnown ? favOf(d) : null, sleeping, dead: v.dead, deadAt: v.deadAt || null,
    finds: v.dead ? 0 : findsOf(store, d, v, t), digging: !v.dead && st.key === 'adulte' && content(v),
    mood: moodOf(v, sleeping),
    walkUntil: d.walkUntil || null, walkedToday: d.walkDay === parisDayKey()
  };
}

const parisDayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

// Debut / fin des vacances : on fige tous les dinos avec l'ancien regime, puis on bascule.
export function holidayTransition(store, on) {
  const t = now();
  for (const user of store.getAll('Users')) {
    if (!user.Dinos) continue;
    const list = dinosOf(user);
    if (!list.length) continue;
    store.update('Users', user.id, { Dinos: JSON.stringify(list.map((d) => settle(user, d, t))) });
  }
  holiday = !!on;
}
export function setDinoHoliday(on) { holiday = !!on; }

// Fige les valeurs du moment (avant une modification).
function settle(user, d, t = now()) {
  const v = live(d, t, decorK(user));
  return v.dead ? { ...d, deadAt: v.deadAt } : { ...d, food: v.food, happy: v.happy, at: t };
}

// --- talents (utilises par boosts.js, garden.js) ------------------------------
// Vrai si le joueur a au moins un dino vivant et content de cette espece.
export function dinoTalent(user, species) {
  if (!user || !user.Dinos) return false;
  const t = now(), k = decorK(user);
  return dinosOf(user).some((d) => d.species === species && content(live(d, t, k)));
}
// Compagnon d'expedition : bonus selon son bonheur (0 a +30 %).
export function companionBonus(user) {
  const d = dinosOf(user).find((x) => x.id === Number(user.DinoCompanion));
  if (!d) return 0;
  const v = live(d, now(), decorK(user));
  return v.dead ? 0 : Math.round(0.3 * v.happy) / 100;
}

// --- Dinodex et premieres ----------------------------------------------------------
function dexCount(dex) {
  return Object.keys(dex.species).length + Object.keys(dex.patterns).length + Object.keys(dex.colors).length + Object.keys(dex.stages).length;
}
// Note un dino dans le Dinodex ; paie les paliers atteints. Renvoie les champs
// Users a ecrire et les recompenses gagnees.
function dexNote(store, user, dinos) {
  const dex = dexOf(user);
  const t = now();
  for (const d of dinos) {
    if (!d) continue;
    dex.species[d.species] = dex.species[d.species] || t;
    if (d.pattern) dex.patterns[d.pattern] = dex.patterns[d.pattern] || t;
    if (d.color) dex.colors[d.color] = dex.colors[d.color] || t;
    if (d.shiny) dex.colors.chroma = dex.colors.chroma || t;
    const st = stageOf(d.xp);
    for (const s of STAGES) if (s.xp <= st.xp) dex.stages[s.key] = dex.stages[s.key] || t;
  }
  const n = dexCount(dex);
  const fields = {};
  const rewards = [];
  for (const tier of DEX_TIERS) {
    if (n < tier.n || dex.claimed.includes(tier.n)) continue;
    dex.claimed.push(tier.n);
    if (tier.dust) fields.StardustCount = (fields.StardustCount ?? (Number(user.StardustCount) || 0)) + tier.dust;
    if (tier.boosters) fields.BoosterCount = (fields.BoosterCount ?? (Number(user.BoosterCount) || 0)) + tier.boosters;
    if (tier.title) grantCosmetic(store, user.id, 'paleontologist', { type: 'title', label: 'Paléontologue 🦖' });
    rewards.push({ n: tier.n, label: tier.label });
  }
  fields.DinoDex = JSON.stringify(dex);
  return { fields, rewards };
}

function recordFirst(store, key, user, label, icon) {
  if (!store.tables.has('AppSettings')) return;
  const row = store.getAll('AppSettings').find((r) => r.Key === 'dinoFirsts');
  const firsts = parse(row && row.Value, {});
  if (firsts[key]) return;
  firsts[key] = { at: now(), userId: user.id, pseudo: user.Pseudo, label, icon };
  if (row) store.update('AppSettings', row.id, { Value: JSON.stringify(firsts) });
  else store.create('AppSettings', { Key: 'dinoFirsts', Value: JSON.stringify(firsts) });
}
function noteFirsts(store, user, d, dinos) {
  if (d.shiny) recordFirst(store, 'shiny', user, 'Premier dino chromatique', '🌈');
  if (d.color && COLORS[d.color]) recordFirst(store, 'color:' + d.color, user, `Premier dino ${COLORS[d.color].toLowerCase()}`, '🦖');
  if (stageOf(d.xp).key === 'adulte') recordFirst(store, 'adult', user, 'Premier dino adulte', '🦕');
  if (dinos.filter((x) => !x.deadAt && stageOf(x.xp).key === 'adulte').length >= MAX_DINOS) recordFirst(store, 'breeder', user, 'Éleveur : 5 dinos adultes', '🏅');
}

// --- naissance ---------------------------------------------------------------------
function newDino(store, dinos, genes = {}) {
  const t = now();
  const season = currentSeason(store);
  const seasonal = season && PTERO_NAMES[season.key] && Math.random() < setting(store, 'DinoSeasonalChance');
  let color = genes.color || null;
  if (!genes.fromEgg) {
    const r = Math.random();
    color = r < 0.005 ? 'gold' : r < 0.01 ? 'fossil' : r < 0.02 ? 'obsidian' : r < 0.03 ? 'albino' : null;
  }
  return {
    id: Math.max(0, ...dinos.map((d) => d.id || 0)) + 1,
    name: genes.name || rnd(NAMES),
    species: seasonal ? 'ptero' : genes.species || rnd(BASE_SPECIES), season: seasonal ? season.key : genes.season || null,
    hue: genes.hue ?? Math.floor(Math.random() * 360),
    pattern: genes.pattern || (Math.random() < 0.03 ? rnd(RARE_PATTERNS) : rnd(BASE_PATTERNS)),
    shiny: genes.shiny ?? Math.random() < 0.03, color,
    fav: rnd(FOOD_KEYS), favKnown: false,
    bornAt: t, at: t, food: 60, happy: 80, xp: 0, digest: 0, poops: [], goldPoops: [], playAt: 0, petAt: 0, breedAt: 0
  };
}
// Petit d'un couple : espece d'un parent, teinte melangee, motif herite (ou
// rare, 15 %), couleur nommee transmise une fois sur quatre.
function eggGenes(a, b) {
  const p = Math.random() < 0.5 ? a : b;
  const ha = (a.hue * Math.PI) / 180, hb = (b.hue * Math.PI) / 180;
  const mean = (Math.atan2(Math.sin(ha) + Math.sin(hb), Math.cos(ha) + Math.cos(hb)) * 180) / Math.PI;
  const named = [a.color, b.color].filter(Boolean);
  return {
    species: p.species, season: p.species === 'ptero' ? p.season : null,
    hue: Math.round((mean + (Math.random() * 30 - 15) + 360) % 360),
    pattern: Math.random() < 0.15 ? rnd(RARE_PATTERNS) : rnd([a.pattern, b.pattern].filter(Boolean)),
    shiny: Math.random() < (a.shiny || b.shiny ? 0.08 : 0.02),
    color: named.length && Math.random() < 0.25 ? rnd(named) : null,
    fromEgg: true
  };
}

// --- etat ----------------------------------------------------------------------------
function state(store, user) {
  const t = now();
  const season = currentSeason(store);
  const dex = dexOf(user);
  const dinos = dinosOf(user);
  return {
    unlocked: (Number(user.DinoSkulls) || 0) > 0 || dinos.length > 0 || eggsOf(user).length > 0 || Object.keys(dex.species).length > 0,
    dinos: dinos.map((d) => view(store, user, d, t)),
    max: MAX_DINOS,
    // Regles du mode (moderules.js) : balade (Chill), vacances (Cool).
    walkOn: ruleOn(store, 'chill.dinoWalk'), holiday,
    skulls: Number(user.DinoSkulls) || 0,
    bones: Number(user.BoneCount) || 0,
    hatchBones: setting(store, 'DinoHatchBones'),
    stardust: Number(user.StardustCount) || 0,
    poop: Number(user.DinoPoop) || 0,
    goldPoop: Number(user.DinoGoldPoop) || 0,
    food: { ...foodOf(user), worm: Number(user.Worms) || 0 },
    foods: Object.entries(FOODS).map(([key, f]) => ({ key, ...f })),
    eggs: eggsOf(user).map((e) => ({ id: e.id, laidAt: e.laidAt, hatchAt: e.hatchAt, ready: e.hatchAt <= t, parents: e.parents || [] })),
    maxEggs: MAX_EGGS,
    accessories: Object.entries(ACCESSORIES).map(([key, a]) => ({ key, ...a, owned: accOf(user).includes(key) })),
    decor: Object.entries(DECOR).map(([key, a]) => ({ key, ...a, owned: decorOf(user).includes(key) })),
    decorBonus: Math.round((1 - decorK(user)) * 100),
    star: Number(user.DinoStar) || null,
    companion: Number(user.DinoCompanion) || null,
    species: Object.entries(SPECIES).map(([key, s]) => ({ key, label: s.label, talent: s.talent, seasonal: !!s.seasonal })),
    dex: {
      count: dexCount(dex), total: DEX_TOTAL,
      species: Object.entries(SPECIES).map(([key, s]) => ({ key, label: s.label, found: !!dex.species[key] })),
      patterns: Object.entries(PATTERNS).map(([key, label]) => ({ key, label, found: !!dex.patterns[key] })),
      colors: Object.entries(COLORS).map(([key, label]) => ({ key, label, found: !!dex.colors[key] })),
      stages: STAGES.map((s) => ({ key: s.key, label: s.label, found: !!dex.stages[s.key] })),
      tiers: DEX_TIERS.map((x) => ({ n: x.n, label: x.label, claimed: dex.claimed.includes(x.n) }))
    },
    season: season ? { key: season.key, label: season.label, icon: season.icon, ptero: PTERO_NAMES[season.key] || null } : null,
    sleeping: sleepingNow(),
    skullChance: setting(store, 'DinoSkullChance'),
    digHours: setting(store, 'DinoDigHours')
  };
}

// Marque les dinos morts depuis le dernier passage (date de deces figee).
function reap(store, user) {
  const t = now(), k = decorK(user);
  let changed = false;
  const list = dinosOf(user).map((d) => {
    if (d.deadAt) return d;
    const v = live(d, t, k);
    if (!v.dead) return d;
    changed = true;
    return { ...d, deadAt: v.deadAt };
  });
  return changed ? store.update('Users', user.id, { Dinos: JSON.stringify(list) }) : user;
}

function handleDino({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  user = reap(store, user);
  // Dinodex : tous les dinos vivants (y compris ceux d'avant le Dinodex).
  const seen = dexNote(store, user, dinosOf(user).filter((d) => !d.deadAt));
  if (seen.fields.DinoDex !== JSON.stringify(dexOf(user))) user = store.update('Users', user.id, seen.fields);
  const action = body.action || 'status';
  if (action === 'status') return ok({ ...state(store, user), dexRewards: seen.rewards });
  const t = now();
  const dinos = dinosOf(user);
  const alive = dinos.filter((d) => !d.deadAt);
  const save = (list, extra = {}) => store.update('Users', user.id, { Dinos: JSON.stringify(list), ...extra });
  const dust = Number(user.StardustCount) || 0;

  // Boutique du dino : accessoires et decorations.
  if (action === 'buyAcc' || action === 'buyDecor') {
    const cat = action === 'buyAcc' ? ACCESSORIES : DECOR;
    const item = cat[String(body.key)];
    if (!item) return fail('unknown_item');
    const owned = action === 'buyAcc' ? accOf(user) : decorOf(user);
    if (owned.includes(body.key)) return fail('already_owned');
    if (dust < item.price) return fail('not_enough_dust', 400, { price: item.price });
    // Bonheur fige avant que la decoration change la vitesse de baisse.
    const list = action === 'buyDecor' ? dinos.map((d) => settle(user, d, t)) : dinos;
    user = save(list, { StardustCount: dust - item.price, [action === 'buyAcc' ? 'DinoAccessories' : 'DinoDecor']: JSON.stringify([...owned, body.key]) });
    return ok({ ...state(store, user), bought: body.key });
  }

  if (action === 'hatch') {
    if (alive.length + dinos.filter((d) => d.deadAt).length >= MAX_DINOS) return fail('max_dinos');
    if ((Number(user.DinoSkulls) || 0) < 1) return fail('no_skull');
    const need = setting(store, 'DinoHatchBones');
    if ((Number(user.BoneCount) || 0) < need) return fail('not_enough_bones', 400, { need });
    const dino = newDino(store, dinos, { name: String(body.name || '').trim().slice(0, 20) || null });
    const list = [...dinos, dino];
    const dex = dexNote(store, user, [dino]);
    user = save(list, { DinoSkulls: (Number(user.DinoSkulls) || 0) - 1, BoneCount: (Number(user.BoneCount) || 0) - need, ...dex.fields });
    noteFirsts(store, user, dino, list);
    announce(store, user, dino, 'a ramené à la vie');
    return ok({ ...state(store, user), hatched: view(store, user, dino, t), dexRewards: dex.rewards });
  }

  if (action === 'hatchEgg') {
    const eggs = eggsOf(user);
    const egg = eggs.find((e) => e.id === Number(body.egg));
    if (!egg) return fail('unknown_egg', 404);
    if (egg.hatchAt > t) return fail('egg_not_ready', 400, { wait: egg.hatchAt - t });
    if (dinos.length >= MAX_DINOS) return fail('max_dinos');
    const dino = newDino(store, dinos, egg.genes || {});
    const list = [...dinos, dino];
    const dex = dexNote(store, user, [dino]);
    user = save(list, { DinoEggs: JSON.stringify(eggs.filter((e) => e !== egg)), ...dex.fields });
    noteFirsts(store, user, dino, list);
    announce(store, user, dino, 'a vu éclore');
    return ok({ ...state(store, user), hatched: view(store, user, dino, t), fromEgg: true, dexRewards: dex.rewards });
  }

  if (action === 'clean') {
    let n = 0, g = 0;
    const list = dinos.map((d) => {
      if (d.deadAt || (body.dino != null && d.id !== Number(body.dino))) return d;
      const ripe = (d.poops || []).filter((p) => p <= t).length;
      const gold = (d.goldPoops || []).filter((p) => p <= t).length;
      if (!ripe && !gold) return d;
      n += ripe; g += gold;
      const s = settle(user, d, t);
      return { ...s, poops: (d.poops || []).filter((p) => p > t), goldPoops: (d.goldPoops || []).filter((p) => p > t), happy: clamp(s.happy + 5), xp: (d.xp || 0) + 2 * (ripe + gold) };
    });
    if (!n && !g) return fail('nothing_to_clean');
    user = save(list, { DinoPoop: (Number(user.DinoPoop) || 0) + n, DinoGoldPoop: (Number(user.DinoGoldPoop) || 0) + g });
    return ok({ ...state(store, user), collected: n, collectedGold: g });
  }

  // Fouille automatique : butin de tous les adultes contents.
  if (action === 'collect') {
    const loot = { dust: 0, worms: 0, bones: 0, fish: 0, skulls: 0, finds: 0 };
    const k = decorK(user);
    const list = dinos.map((d) => {
      if (d.deadAt) return d;
      const v = live(d, t, k);
      const n = findsOf(store, d, v, t);
      if (!n) return d;
      for (let i = 0; i < n; i++) {
        loot.finds++;
        loot.dust += (15 + Math.floor(Math.random() * 26)) * (dinoTalent(user, 'rex') ? 2 : 1);
        if (Math.random() < 0.25) loot.worms += 1 + Math.floor(Math.random() * 3);
        if (d.species === 'raptor') loot.bones += 1;
        if (d.species === 'ptero') loot.fish += 1;
        if (Math.random() < setting(store, 'DinoAutoSkullChance')) loot.skulls++;
      }
      return { ...d, digAt: digBase(d) + n * digPeriod(store, d) };
    });
    if (!loot.finds) return fail('nothing_to_collect');
    const stock = foodOf(user);
    stock.fish = (stock.fish || 0) + loot.fish;
    user = save(list, {
      StardustCount: dust + loot.dust, Worms: (Number(user.Worms) || 0) + loot.worms, BoneCount: (Number(user.BoneCount) || 0) + loot.bones,
      DinoSkulls: (Number(user.DinoSkulls) || 0) + loot.skulls, DinoFood: JSON.stringify(stock)
    });
    if (loot.skulls) addFeed(store, { userId: user.id, kind: 'dino', icon: '💀', text: 'a reçu un crâne de dinosaure déterré par ses dinos !' });
    return ok({ ...state(store, user), loot });
  }

  // Ponte : deux adultes heureux.
  if (action === 'breed') {
    const a = dinos.find((d) => d.id === Number(body.a)), b = dinos.find((d) => d.id === Number(body.b));
    if (!a || !b || a === b) return fail('unknown_dino', 404);
    const eggs = eggsOf(user);
    if (eggs.length >= MAX_EGGS) return fail('max_eggs');
    const k = decorK(user);
    for (const d of [a, b]) {
      const v = live(d, t, k);
      if (v.dead || stageOf(d.xp).key !== 'adulte') return fail('not_adult');
      if (v.happy < 70 || v.food < 40) return fail('not_happy_enough');
      if ((d.breedAt || 0) + breedCooldown() > t) return fail('breed_cooldown', 429, { wait: d.breedAt + breedCooldown() - t });
    }
    const egg = { id: Math.max(0, ...eggs.map((e) => e.id || 0)) + 1, laidAt: t, hatchAt: t + eggHours() * HOUR, parents: [a.name, b.name], genes: eggGenes(a, b) };
    const list = dinos.map((d) => (d === a || d === b ? { ...settle(user, d, t), breedAt: t, happy: clamp(settle(user, d, t).happy - 10) } : d));
    user = save(list, { DinoEggs: JSON.stringify([...eggs, egg]) });
    addFeed(store, { userId: user.id, kind: 'dino', icon: '🥚', text: `attend un œuf de ${a.name} et ${b.name} !` });
    return ok({ ...state(store, user), laid: egg.id });
  }

  const idx = dinos.findIndex((d) => d.id === Number(body.dino));
  if (action === 'companion' && body.dino == null) return ok(state(store, store.update('Users', user.id, { DinoCompanion: 0 })));
  if (idx < 0) return fail('unknown_dino', 404);
  const d = settle(user, dinos[idx], t);

  // Tas d'os : on ramasse les os, la place se libere.
  if (action === 'bury') {
    if (!d.deadAt) return fail('not_dead');
    const bones = setting(store, 'DinoHatchBones');
    const extra = { BoneCount: (Number(user.BoneCount) || 0) + bones };
    if (Number(user.DinoStar) === d.id) extra.DinoStar = 0;
    if (Number(user.DinoCompanion) === d.id) extra.DinoCompanion = 0;
    user = save(dinos.filter((x) => x.id !== d.id), extra);
    return ok({ ...state(store, user), buried: { name: d.name, bones } });
  }
  if (d.deadAt) return fail('dino_dead');

  if (action === 'rename') {
    const name = String(body.name || '').trim().slice(0, 20);
    if (!name) return fail('invalid_name');
    dinos[idx] = { ...d, name };
    return ok(state(store, save(dinos)));
  }
  if (action === 'equip') {
    const key = body.key ? String(body.key) : null;
    if (key && !accOf(user).includes(key)) return fail('not_owned');
    dinos[idx] = { ...d, acc: key };
    return ok(state(store, save(dinos)));
  }
  if (action === 'star') return ok(state(store, store.update('Users', user.id, { DinoStar: Number(user.DinoStar) === d.id ? 0 : d.id })));
  if (action === 'companion') return ok(state(store, store.update('Users', user.id, { DinoCompanion: Number(user.DinoCompanion) === d.id ? 0 : d.id })));

  // Balade (mode Chill) : une heure, une fois par jour et par dino.
  if (action === 'walk') {
    if (!ruleOn(store, 'chill.dinoWalk')) return fail('wrong_mode');
    if (sleepingNow()) return fail('sleeping');
    if (d.walkUntil) return fail('already_walking');
    if (d.walkDay === parisDayKey()) return fail('walked_today');
    dinos[idx] = { ...d, walkUntil: t + HOUR, walkDay: parisDayKey() };
    return ok({ ...state(store, save(dinos)), walking: d.id });
  }
  if (action === 'walk-back') {
    if (!d.walkUntil) return fail('not_walking');
    if (d.walkUntil > t) return fail('still_walking', 429, { wait: d.walkUntil - t });
    const loot = { dust: 20 + Math.floor(Math.random() * 41), worms: 1 + Math.floor(Math.random() * 3) };
    const foodKey = ['fish', 'seaweed', 'shrimp'][Math.floor(Math.random() * 3)];
    loot.food = { key: foodKey, label: FOODS[foodKey].label, icon: FOODS[foodKey].icon, n: 1 + (Math.random() < 0.3 ? 1 : 0) };
    loot.bone = Math.random() < 0.08 ? 1 : 0;
    const stock = foodOf(user);
    stock[foodKey] = (stock[foodKey] || 0) + loot.food.n;
    const { walkUntil, ...rest } = d;
    dinos[idx] = grow({ ...rest, happy: clamp(d.happy + 15) }, 4);
    return finishCare(store, user, dinos, idx, d, { walked: { dino: d.id, ...loot } }, {
      StardustCount: (Number(user.StardustCount) || 0) + loot.dust, Worms: (Number(user.Worms) || 0) + loot.worms,
      BoneCount: (Number(user.BoneCount) || 0) + loot.bone, DinoFood: JSON.stringify(stock)
    });
  }

  if (action === 'pet') {
    if ((d.petAt || 0) + PET_COOLDOWN > t) return ok({ ...state(store, user), petted: d.id, quiet: true });
    dinos[idx] = { ...d, happy: clamp(d.happy + 4), petAt: t };
    return ok({ ...state(store, save(dinos)), petted: d.id });
  }

  if (action === 'play') {
    if (sleepingNow()) return fail('sleeping');
    if ((d.playAt || 0) + PLAY_COOLDOWN > t) return fail('play_cooldown', 429, { wait: d.playAt + PLAY_COOLDOWN - t });
    dinos[idx] = grow({ ...d, happy: clamp(d.happy + 25), playAt: t }, 5);
    return finishCare(store, user, dinos, idx, d, { played: d.id });
  }

  if (action === 'feed') {
    const key = String(body.food || '');
    const f = FOODS[key];
    if (!f) return fail('unknown_food');
    if (d.food >= 95) return fail('not_hungry');
    const extra = {};
    if (key === 'worm') {
      if ((Number(user.Worms) || 0) < 1) return fail('no_food');
      extra.Worms = (Number(user.Worms) || 0) - 1;
    } else {
      const stock = foodOf(user);
      if ((stock[key] || 0) < 1) return fail('no_food');
      stock[key] -= 1;
      extra.DinoFood = JSON.stringify(stock);
    }
    // Digestion : un caca tous les 40 points (30 adulte), 8 en attente au plus.
    const per = stageOf(d.xp).key === 'adulte' ? 30 : 40;
    let digest = (d.digest || 0) + f.food;
    const poops = [...(d.poops || [])];
    while (digest >= per) { digest -= per; if (poops.length < MAX_POOPS) poops.push(t + DIGEST_HOURS * HOUR + poops.length * 600); }
    const goldPoops = [...(d.goldPoops || [])];
    if (key === 'shrimp' && Math.random() < setting(store, 'DinoGoldPoopChance') && goldPoops.length < 3) goldPoops.push(t + DIGEST_HOURS * HOUR);
    const isFav = favOf(d) === key;
    const favFound = isFav && !d.favKnown;
    dinos[idx] = grow({ ...d, food: clamp(d.food + f.food), happy: clamp(d.happy + f.happy + (isFav ? 20 : 0)), digest, poops, goldPoops, favKnown: d.favKnown || isFav }, d.food < 80 ? 3 : 1);
    return finishCare(store, user, dinos, idx, d, { fed: { dino: d.id, food: key, fav: isFav, favFound } }, extra);
  }
  return fail('unknown_action');
}

const grow = (d, xp) => {
  const before = stageOf(d.xp).key;
  const out = { ...d, xp: (d.xp || 0) + xp };
  if (stageOf(out.xp).key === 'adulte' && before !== 'adulte') { out.grownAt = now(); out.digAt = now(); }
  return out;
};
// Fin d'un soin : passage de stade (Dinodex, premieres), sauvegarde.
function finishCare(store, user, dinos, idx, before, payload, extra = {}) {
  const d = dinos[idx];
  const grown = stageOf(d.xp).key !== stageOf(before.xp).key ? stageOf(d.xp).label : null;
  const dex = grown ? dexNote(store, user, [d]) : { fields: {}, rewards: [] };
  const u = store.update('Users', user.id, { Dinos: JSON.stringify(dinos), ...extra, ...dex.fields });
  if (grown) noteFirsts(store, u, d, dinos);
  return ok({ ...state(store, u), ...payload, ...(grown ? { grown: { dino: d.id, stage: grown } } : {}), dexRewards: dex.rewards });
}
function announce(store, user, d, verb) {
  const special = d.shiny ? ' CHROMATIQUE' : d.color ? ` ${COLORS[d.color].toUpperCase()}` : '';
  addFeed(store, { userId: user.id, kind: 'dino', icon: d.shiny || d.color ? '🌈' : '🦖', text: `${verb} un dinosaure${special} : ${d.name} le ${speciesLabel(d)} !` });
}

export const routes = { 'POST dino': handleDino };

// Profil et carte de joueur : le dino vedette (vivant).
export function starDinoOf(store, user) {
  const d = dinosOf(user).find((x) => x.id === Number(user.DinoStar));
  if (!d) return null;
  const v = view(store, user, d);
  if (v.dead) return null;
  return { name: v.name, speciesLabel: v.speciesLabel, species: v.species, hue: v.hue, pattern: v.pattern, shiny: v.shiny, color: v.color, acc: v.acc, stage: v.stage, stageLabel: v.stageLabel, season: v.season, mood: v.mood };
}

// Peche : nourriture en plus (seulement avec un dino ou un crane).
export function fishingBycatch(store, user, count) {
  if (!dinosOf(user).length && !(Number(user.DinoSkulls) || 0)) return null;
  const chance = setting(store, 'DinoFoodChance');
  const stock = foodOf(user);
  const items = [];
  for (let i = 0; i < count; i++) {
    if (Math.random() >= chance) continue;
    const r = Math.random();
    const key = r < 0.55 ? 'fish' : r < 0.88 ? 'seaweed' : 'shrimp';
    const amount = key === 'fish' && Math.random() < 0.3 ? 2 : 1;
    stock[key] = (stock[key] || 0) + amount;
    items.push({ type: key, label: FOODS[key].label, icon: FOODS[key].icon, amount });
  }
  if (!items.length) return null;
  return { items, fields: { DinoFood: JSON.stringify(stock) } };
}

// Suggestions de l'accueil (insights.js).
export function dinoAlerts(user) {
  const t = now(), k = decorK(user);
  const out = [];
  const list = dinosOf(user).map((d) => ({ d, v: live(d, t, k) }));
  const dying = list.filter((x) => !x.v.dead && x.v.food < 25 && x.v.happy < 25);
  const hungry = list.filter((x) => !x.v.dead && x.v.food < 25);
  const dead = list.filter((x) => x.v.dead);
  const poops = list.reduce((s, x) => s + (x.v.dead ? 0 : x.v.ripe), 0);
  if (dying.length) out.push({ priority: 98, key: 'dino-hungry', icon: '⚠️', label: `${dying[0].d.name} est en danger : nourris-le vite !`, url: 'jeux.html#dinos' });
  else if (hungry.length) out.push({ priority: 70, key: 'dino-hungry', icon: '🦖', label: hungry.length > 1 ? `${hungry.length} dinos ont faim` : `${hungry[0].d.name} a faim`, url: 'jeux.html#dinos' });
  if (dead.length) out.push({ priority: 60, key: 'dino-hungry', icon: '🦴', label: `Un tas d'os t'attend dans l'enclos`, url: 'jeux.html#dinos' });
  if (poops >= 2) out.push({ priority: 50, key: 'dino-poop', icon: '💩', label: `${poops} cacas de dino à ramasser (engrais)`, url: 'jeux.html#dinos' });
  if (eggsOf(user).some((e) => e.hatchAt <= t)) out.push({ priority: 75, key: 'dino-skull', icon: '🥚', label: 'Un œuf de dino est prêt à éclore !', url: 'jeux.html#dinos' });
  if (!list.length && (Number(user.DinoSkulls) || 0) > 0) out.push({ priority: 64, key: 'dino-skull', icon: '💀', label: 'Un crâne de dinosaure attend d’être ramené à la vie', url: 'jeux.html#dinos' });
  return out;
}

export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  const body = request.body || {};
  // Profil public : dino vedette.
  if (path === 'public-profile') {
    const pseudo = String((request.query || {}).pseudo || body.pseudo || '').trim().toLowerCase();
    const user = store.getAll('Users').find((u) => String(u.Pseudo || '').trim().toLowerCase() === pseudo);
    if (user) response.json.starDino = starDinoOf(store, user);
    return;
  }
  // Expedition : le compagnon revient affame (le bonus est dans boosts.js).
  if (path === 'expedition' && body.action === 'claim' && response.json.reward) {
    const user = store.get('Users', Number(body.userId));
    if (!user || !user.DinoCompanion) return;
    const dinos = dinosOf(user);
    const i = dinos.findIndex((d) => d.id === Number(user.DinoCompanion));
    if (i < 0 || live(dinos[i], now(), decorK(user)).dead) return;
    const s = settle(user, dinos[i]);
    dinos[i] = grow({ ...s, food: clamp(s.food - 30), happy: clamp(s.happy + 10) }, 5);
    store.update('Users', user.id, { Dinos: JSON.stringify(dinos) });
    response.json.dinoCompanion = { name: s.name, hungry: dinos[i].food < 25 };
    return;
  }
  // Mode excite du chien (50 os d'un coup, dig.json) : crane garanti.
  if (path === 'dig' && body.action === 'frenzy' && response.json.frenzy) {
    const u = store.get('Users', Number(body.userId));
    if (!u) return;
    const skulls = (Number(u.DinoSkulls) || 0) + 1;
    store.update('Users', u.id, { DinoSkulls: skulls });
    response.json.dinoSkull = { total: skulls, hatchBones: setting(store, 'DinoHatchBones'), guaranteed: true };
    addFeed(store, { userId: u.id, kind: 'dino', icon: '💀', text: 'a lâché Milo en mode excité… et il a déterré un CRÂNE DE DINOSAURE !' });
    return;
  }
  // Fouille : chaque tuile creusee peut cacher un crane (extremement rare).
  if (path !== 'dig' || body.action !== 'dig' || !response.json.dug) return;
  if (Math.random() >= setting(store, 'DinoSkullChance')) return;
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  const skulls = (Number(user.DinoSkulls) || 0) + 1;
  store.update('Users', user.id, { DinoSkulls: skulls });
  response.json.dinoSkull = { total: skulls, hatchBones: setting(store, 'DinoHatchBones') };
  addFeed(store, { userId: user.id, kind: 'dino', icon: '💀', text: 'a déterré un CRÂNE DE DINOSAURE en creusant !' });
}
