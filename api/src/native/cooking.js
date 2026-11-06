// Cuisine du village (2026-10-30) : on combine des ingredients en plats qui
// donnent un bonus temporaire. Ingredients du garde-manger (Users.Pantry) :
// legumes et herbes (graine « Potager » du jardin, promenade), baies,
// champignons et miel (promenade, champignon lumineux du jardin), plus les
// poissons de Moka (Users.CatFish) et les carottes de Noisette
// (Users.Carrots). Recettes reglables (CookRecipes) ; chaque recette a un
// effet parmi :
//  - garden : pousse du jardin plus rapide (CookGardenPct %) ;
//  - fish   : prises rares de la peche multipliees (1 + CookFishPct %) ;
//  - archeo : endurance des tablettes ouvertes (+ CookArcheoPct %) ;
//  - pets   : les compagnons travaillent comme s'ils t'adoraient ;
//  - all    : tout ce qui precede a la fois.
// Recuisiner un plat prolonge son bonus (au plus CookMaxHours devant soi).
//
// V2 (2026-11-06) :
//  1. Marmite libre (action 'start' / 'cook' avec body.pot) : 2 a 3 sortes
//     d'ingredients (4 avec le chaudron). Une combinaison exacte donne la
//     recette, y compris les recettes cachees (CookSecretRecipes) qui
//     s'inscrivent au carnet (Users.CookBook). Sinon : un ragout douteux
//     (petit bonus au hasard) et parfois un indice sur une recette proche.
//  2. Cuisson a point (start -> finish) : le serveur tire le moment ideal et
//     mesure le temps ; la qualite (CookQuality : rate, correct, reussi,
//     parfait) change la duree et la force du bonus et donne 0 a 3 etoiles au
//     carnet. Cuisson rapide (action 'cook') : qualite « correct ».
//     Toutes les recettes permanentes a 3 etoiles : cadre « Grand chef ».
//  3. Metier de cuisinier (Users.CookXP, CookLevelXpStep) : recettes, outils,
//     bonus speciaux en meme temps, commandes, tolerance (LEVEL_PERKS).
//  4. Commandes du jour (Users.CookOrders) : 3 clients (4 au niveau 6), une
//     recette et une qualite minimale ; poussieres, affection, ingredient
//     rare ; 7 jours de suite toutes livrees = titre « Aubergiste du village ».
//  5. Ustensiles (Users.CookTools, CookTools : prix) : four (recettes du four,
//     duree +15 % par niveau en plus), fumoir (plats qui se gardent, plats
//     frais plus longtemps), moulin (sel de roche avec du Calcaire, epices
//     avec des herbes), chaudron (4 ingredients, double portion).
//  6. Plats gardes (Users.Dishes, CookDishMax) : un plat cuit se mange, se
//     garde ou se livre. Un plat frais perd une qualite toutes les
//     CookFreshHours heures et se gate apres « rate » ; un plat qui se garde
//     (keeps : fume, en bocal) ne bouge pas.
//  7. Ingredients en plus : oeufs (dinos), truffes (fouille), sel et epices
//     (moulin), poissons rares (peche), fleurs (jardin), + ceux des saisons.
//  8. Effets en plus : dig (mineral en plus a la fouille), expedition (Milo
//     revient plus vite), xp (+CookXpPct %), casino (un ticket a gratter
//     gratuit de plus ; recette seulement porte de la salle interdite
//     ouverte), luck (charges : une carte de la prochaine ouverture gagne une
//     finition, jusqu'au Diamant). Les effets speciaux (dig, expedition, xp,
//     casino) sont limites en meme temps par le niveau (1, 2, puis 3).
//  9. Menu complet : entree + plat + dessert manges dans l'heure = tous les
//     bonus en cours prolonges de CookMealBonusHours.
// 10. Recettes de saison (season) : au menu pendant l'evenement, avec leur
//     ingredient trouve pendant l'evenement (CookSeasonDropChance).
//   POST /webhook/cook { userId, action: 'status' | 'cook' | 'start' | 'finish' | 'eat' | 'deliver' | 'discard' | 'buyTool' | 'mill', recipe?, pot?, id?, ms?, dishId?, order?, tool?, kind?, n?, store? }
// Users.Pantry = { veg, herb, berry, mush, honey, ... } ; Users.Buffs = { garden: fin, ..., luck: charges, power: { effet: force }, meal: { entree, plat, dessert } }

import { ok, fail, userById, now, parseJson, parisDay, hash, refId } from './common.js';
import { setting } from './settings.js';
import { ruleOn } from './moderules.js';
import { levelInfo } from './levels.js';
import { price as indexed } from './inflation.js';
import { currentSeason } from './seasonal.js';
import { grantCosmetic } from './cosmetics.js';
import { MINERALS, mineralsOf } from './digdepth.js';
import { loveOf, PETS } from './pets.js';

export const schema = {
  Users: {
    Pantry: { type: 'Text' }, Buffs: { type: 'Text' }, CookCount: { type: 'Numeric' },
    CookXP: { type: 'Numeric' }, CookBook: { type: 'Text' }, CookOrders: { type: 'Text' }, CookTools: { type: 'Text' }, Dishes: { type: 'Text' }, CookSession: { type: 'Text' }
  }
};

// Ingredients : cle, libelle, icone, et colonne quand ce n'est pas le garde-manger.
export const INGREDIENTS = {
  veg: { label: 'Légumes', one: 'légume', icon: '🥬' },
  herb: { label: 'Herbes', one: 'herbe', icon: '🌿' },
  berry: { label: 'Baies', one: 'baie', icon: '🫐' },
  mush: { label: 'Champignons', one: 'champignon', icon: '🍄' },
  honey: { label: 'Miel', one: 'pot de miel', icon: '🍯' },
  fruit: { label: 'Fruits exotiques', one: 'fruit exotique', icon: '🥭' },
  fish: { label: 'Poissons', one: 'poisson', icon: '🐟', field: 'CatFish' },
  carrot: { label: 'Carottes', one: 'carotte', icon: '🥕', field: 'Carrots' },
  // V2 (2026-11-06)
  egg: { label: 'Œufs', one: 'œuf', icon: '🥚' },
  truffle: { label: 'Truffes', one: 'truffe', icon: '🟤' },
  salt: { label: 'Sel de roche', one: 'pincée de sel', icon: '🧂' },
  spice: { label: 'Épices', one: 'épice', icon: '🌶️' },
  rarefish: { label: 'Poissons rares', one: 'poisson rare', icon: '🐠' },
  flower: { label: 'Fleurs', one: 'fleur', icon: '🌸' },
  // Ingredients de saison (SEASON_INGREDIENT)
  almond: { label: 'Amandes', one: 'amande', icon: '🥜', season: 'newyear' },
  cocoa: { label: 'Cacao', one: 'carré de cacao', icon: '🍫', season: ['valentine', 'easter'] },
  coconut: { label: 'Noix de coco', one: 'noix de coco', icon: '🥥', season: 'summer' },
  pumpkin: { label: 'Potirons', one: 'potiron', icon: '🎃', season: 'halloween' },
  chestnut: { label: 'Châtaignes', one: 'châtaigne', icon: '🌰', season: 'christmas' }
};
const SEASON_INGREDIENT = { newyear: 'almond', valentine: 'cocoa', easter: 'cocoa', summer: 'coconut', halloween: 'pumpkin', christmas: 'chestnut' };
export const EFFECTS = {
  garden: { label: 'Jardin', icon: '🌱' },
  fish: { label: 'Pêche', icon: '🎣' },
  archeo: { label: 'Archéologie', icon: '🏺' },
  pets: { label: 'Compagnons', icon: '🐾' },
  // Effets speciaux (V2) : limites en meme temps par le niveau.
  dig: { label: 'Fouille', icon: '⛏️', special: true },
  expedition: { label: 'Expédition', icon: '🧭', special: true },
  xp: { label: 'Savoir', icon: '📘', special: true },
  casino: { label: 'Casino', icon: '🎰', special: true, forbidden: true }
};
const BASE_EFFECTS = ['garden', 'fish', 'archeo', 'pets'];
const SPECIAL = Object.keys(EFFECTS).filter((k) => EFFECTS[k].special);
const EFFECT_KEYS = [...Object.keys(EFFECTS), 'all', 'luck', 'random'];
const COURSES = { entree: 'Entrée', plat: 'Plat', dessert: 'Dessert' };
// Plats de la V1 : leur place dans le menu (CookRecipes n'en a pas).
const COURSE_OF = { soupe: 'entree', tarte: 'dessert', mojito: 'entree', pina: 'entree', smoothie: 'dessert', planteur: 'dessert' };
export const TOOLS = {
  oven: { label: 'Four', icon: '🔥', text: (lv) => (lv > 1 ? `Recettes du four, bonus +${(lv - 1) * 15} %` : 'Recettes du four : tartes, gratins, rôtis') },
  smoker: { label: 'Fumoir', icon: '🌫️', text: (lv) => (lv > 1 ? `Plats fumés qui se gardent ; plats frais ×${[1, 1.5, 2][lv - 1]} plus longtemps` : 'Plats fumés, qui se gardent') },
  mill: { label: 'Moulin à épices', icon: '⚙️', text: (lv) => `Sel : ${[3, 2, 1][lv - 1]} Calcaire · Épices : ${[3, 2, 1][lv - 1]} herbes` },
  cauldron: { label: 'Chaudron', icon: '🫕', text: (lv) => (lv > 1 ? `Marmite à 4 ingrédients ; ${[0, 15, 30][lv - 1]} % de double portion` : 'Marmite à 4 ingrédients') }
};
const TOOL_LEVEL = { oven: 2, smoker: 3, mill: 4, cauldron: 5 };
export const LEVEL_PERKS = {
  1: 'Marmite à 3 ingrédients, 1 bonus spécial à la fois',
  2: 'Le four (à acheter)',
  3: 'Le fumoir (à acheter)',
  4: 'Le moulin à épices (à acheter) · 2 bonus spéciaux à la fois',
  5: 'Le chaudron (à acheter) : marmite à 4 ingrédients',
  6: 'Une 4e commande chaque jour',
  7: '3 bonus spéciaux à la fois',
  8: '+1 h de bonus au maximum',
  9: 'Cuisson plus tolérante',
  10: 'Titre « Chef étoilé »'
};
// Clients des commandes : les compagnons adoptes et quelques villageois.
const VILLAGERS = [
  { key: 'garance', label: 'Garance la fleuriste', icon: '👩‍🌾' },
  { key: 'barnabe', label: 'le vieux Barnabé', icon: '👴' },
  { key: 'lou', label: 'Lou la factrice', icon: '📮' }
];
// Ragout douteux : petit bonus au hasard.
const DUBIOUS = { key: 'douteux', label: 'Ragoût douteux', icon: '🫠', desc: 'Personne ne sait vraiment ce qu’il y a dedans.', hours: 0.33, course: 'plat' };

// ------------------------------------------------------------------ garde-manger
export function pantryOf(user) {
  const p = parseJson(user && user.Pantry, {});
  const out = {};
  for (const k of Object.keys(INGREDIENTS)) if (!INGREDIENTS[k].field) out[k] = Math.max(0, Math.floor(Number(p && p[k]) || 0));
  return out;
}
// Ajoute des ingredients (n peut etre negatif) : champs a ecrire. `fields`
// sert a cumuler avec des champs deja prepares dans la meme requete.
export function pantryFields(user, add, fields = {}) {
  const out = {};
  const pantry = pantryOf({ Pantry: fields.Pantry ?? user.Pantry });
  let touched = false;
  for (const [k, n] of Object.entries(add || {})) {
    const ing = INGREDIENTS[k];
    if (!ing || !Number(n)) continue;
    if (ing.field) out[ing.field] = Math.max(0, (Number(fields[ing.field] ?? user[ing.field]) || 0) + Number(n));
    else { pantry[k] = Math.max(0, pantry[k] + Number(n)); touched = true; }
  }
  if (touched) out.Pantry = JSON.stringify(pantry);
  return out;
}
const stockOf = (user) => ({ ...pantryOf(user), fish: Number(user.CatFish) || 0, carrot: Number(user.Carrots) || 0 });

// ------------------------------------------------------------------ bonus
function buffsOf(user) {
  const b = parseJson(user && user.Buffs, {});
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}
// Fin du bonus (secondes) ou 0. « all » vaut pour tous les effets.
export function buffUntil(user, effect, t = now()) {
  const b = buffsOf(user);
  const until = Math.max(Number(b[effect]) || 0, Number(b.all) || 0);
  return until > t ? until : 0;
}
export const buffOn = (user, effect) => buffUntil(user, effect) > 0;
// Force du bonus (qualite du plat, CookQuality.power) ; 1 par defaut.
const powerOf = (user, effect) => { const p = buffsOf(user).power; return Math.max(0.1, Number(p && p[effect]) || 1); };
const pctOn = (store, user, effect, key) => (buffOn(user, effect) ? (setting(store, key) * powerOf(user, effect)) / 100 : 0);
// Facteurs lus par les jeux (1 = sans effet).
export const gardenBuff = (store, user) => (buffOn(user, 'garden') ? 1 - Math.min(80, setting(store, 'CookGardenPct') * powerOf(user, 'garden')) / 100 : 1);
export const fishBuff = (store, user) => 1 + pctOn(store, user, 'fish', 'CookFishPct');
export const archeoBuff = (store, user) => 1 + pctOn(store, user, 'archeo', 'CookArcheoPct');
export const xpMult = (store, user) => 1 + pctOn(store, user, 'xp', 'CookXpPct');
// Ticket a gratter gratuit de plus au casino (casino.js).
export const casinoBuff = (user) => buffOn(user, 'casino');
const luckOf = (user) => Math.max(0, Math.floor(Number(buffsOf(user).luck) || 0));

// ------------------------------------------------------------------ recettes
// Bar de plage (mode Chill) : une recette reglee de meme cle prend le dessus.
const COCKTAILS = [
  { key: 'mojito', label: 'Mojito du potager', icon: '🍹', desc: 'Frais, avec les herbes du jardin.', effect: 'garden', hours: 1, needs: { fruit: 1, herb: 2 } },
  { key: 'pina', label: 'Piña du pêcheur', icon: '🍍', desc: 'À siroter sur le ponton.', effect: 'fish', hours: 1, needs: { fruit: 1, honey: 1 } },
  { key: 'smoothie', label: 'Smoothie des compagnons', icon: '🥤', desc: 'Un peu pour toi, beaucoup pour eux.', effect: 'pets', hours: 1, needs: { fruit: 1, berry: 2 } },
  { key: 'planteur', label: 'Planteur du coucher de soleil', icon: '🌅', desc: 'Le cocktail de la maison.', effect: 'all', hours: 1, needs: { fruit: 2, honey: 1, berry: 1 } }
];
// Recettes reglees, bornees ; une recette mal formee est ignoree. Les
// recettes cachees et de saison (CookSecretRecipes) suivent.
function normalize(r, secret) {
  if (!r || !r.key || !EFFECT_KEYS.includes(r.effect) || r.active === false) return null;
  const needs = {};
  for (const [k, n] of Object.entries(r.needs || {})) if (INGREDIENTS[k] && Math.floor(Number(n)) > 0) needs[k] = Math.min(50, Math.floor(Number(n)));
  if (!Object.keys(needs).length) return null;
  const key = String(r.key).slice(0, 30);
  return {
    key, label: String(r.label || r.key).slice(0, 40), icon: String(r.icon || '🍲').slice(0, 8), desc: String(r.desc || '').slice(0, 160), effect: r.effect,
    hours: r.effect === 'luck' ? 0 : Math.max(0.25, Math.min(24, Number(r.hours) || 1)), needs,
    course: COURSES[r.course] ? r.course : COURSE_OF[key] || 'plat',
    tool: TOOLS[r.tool] ? r.tool : null, keeps: !!r.keeps || r.tool === 'smoker',
    secret: !!secret && !r.season, season: r.season ? String(r.season) : null, level: Math.max(1, Math.min(10, Math.floor(Number(r.level) || 1))),
    forbidden: r.effect === 'casino' || !!r.forbidden
  };
}
function recipesOf(store) {
  const saved = setting(store, 'CookRecipes');
  const list = Array.isArray(saved) ? saved : [];
  const rows = ruleOn(store, 'chill.cocktails') ? [...list, ...COCKTAILS.filter((c) => !list.some((r) => r && r.key === c.key))] : list;
  const base = rows.map((r) => normalize(r, false)).filter(Boolean);
  const more = setting(store, 'CookSecretRecipes');
  const secret = (Array.isArray(more) ? more : []).map((r) => normalize(r, true)).filter((r) => r && !base.some((b) => b.key === r.key));
  return [...base, ...secret];
}
// Recettes qui existent pour ce joueur (saison en cours, salle interdite).
function recipesFor(store, user) {
  const season = currentSeason(store);
  const door = Number(user.ForbiddenUnlocked) > 0;
  return recipesOf(store).filter((r) => (!r.season || (season && season.key === r.season)) && (!r.forbidden || door));
}
const bookOf = (user) => { const b = parseJson(user && user.CookBook, {}); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; };
const known = (user, r) => !r.secret || !!bookOf(user)[r.key];
const sameNeeds = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => a[k] === b[k]); };

function effectText(store, effect) {
  if (effect === 'garden') return `Jardin : pousse ${setting(store, 'CookGardenPct')} % plus rapide`;
  if (effect === 'fish') return `Pêche : prises rares +${setting(store, 'CookFishPct')} %`;
  if (effect === 'archeo') return `Archéologie : endurance +${setting(store, 'CookArcheoPct')} % sur les tablettes ouvertes`;
  if (effect === 'pets') return 'Compagnons : ils travaillent comme s’ils t’adoraient';
  if (effect === 'dig') return `Fouille : ${setting(store, 'CookDigPct')} % de chance d’un minéral en plus par coup de pelle`;
  if (effect === 'expedition') return `Expédition : Milo revient ${setting(store, 'CookExpeditionPct')} % plus vite (départs pendant le bonus)`;
  if (effect === 'xp') return `Savoir : +${setting(store, 'CookXpPct')} % d’XP`;
  if (effect === 'casino') return 'Casino : un ticket à gratter gratuit de plus par jour';
  if (effect === 'luck') return 'Chance : une carte de ta prochaine ouverture gagne une finition (jusqu’au Diamant)';
  if (effect === 'random') return 'Surprise : un bonus au hasard';
  return 'Tous les bonus du village à la fois';
}

// ------------------------------------------------------------------ metier
const xpOf = (user) => (user.CookXP != null && user.CookXP !== '' ? Number(user.CookXP) || 0 : (Number(user.CookCount) || 0) * 8);
export const cookLevel = (store, user) => levelInfo(xpOf(user), setting(store, 'CookLevelXpStep'));
const specialSlots = (lv) => (lv >= 7 ? 3 : lv >= 4 ? 2 : 1);
const potKinds = (user) => (toolsOf(user).cauldron ? 4 : 3);
const maxHours = (store, lv) => setting(store, 'CookMaxHours') + (lv >= 8 ? 1 : 0);
const toolsOf = (user) => { const t = parseJson(user && user.CookTools, {}); return t && typeof t === 'object' && !Array.isArray(t) ? t : {}; };
const qualities = (store) => { const q = setting(store, 'CookQuality'); return Array.isArray(q) && q.length === 4 ? q : [{ key: 'rate', label: 'Raté', dur: 0.5, power: 0.75 }, { key: 'correct', label: 'Correct', dur: 1, power: 1 }, { key: 'reussi', label: 'Réussi', dur: 1.3, power: 1.15 }, { key: 'parfait', label: 'Parfait', dur: 1.6, power: 1.3 }]; };
const XP_BY_QUALITY = [4, 8, 12, 18];

// ------------------------------------------------------------------ plats gardes
let dishSeq = 0;
const dishesRaw = (user) => { const d = parseJson(user && user.Dishes, []); return Array.isArray(d) ? d.filter((x) => x && x.key) : []; };
function freshness(store, user, d, t = now()) {
  if (d.keeps) return Number(d.q) || 0;
  const lv = Number(toolsOf(user).smoker) || 0;
  const life = setting(store, 'CookFreshHours') * 3600 * [1, 1, 1.5, 2][lv];
  return (Number(d.q) || 0) - Math.floor(Math.max(0, t - (Number(d.at) || t)) / Math.max(3600, life));
}
// Plats encore bons (les gates sont retires) et ceux qui viennent de se gater.
function dishesOf(store, user, t = now()) {
  const all = dishesRaw(user);
  const good = all.filter((d) => freshness(store, user, d, t) >= 0);
  return { good, spoiled: all.filter((d) => freshness(store, user, d, t) < 0) };
}

// ------------------------------------------------------------------ commandes
function clientsOf(user) {
  const adopted = parseJson(user.PetsAdopted, null);
  const pets = Object.entries(PETS).filter(([k]) => !adopted || typeof adopted !== 'object' || adopted[k]).map(([k, p]) => ({ key: k, label: p.label, icon: p.icon, pet: true }));
  return [...pets, ...VILLAGERS];
}
function ordersOf(store, user, recipes) {
  const day = parisDay(0);
  const cur = parseJson(user.CookOrders, null);
  if (cur && cur.day === day && Array.isArray(cur.list)) return cur;
  const lv = cookLevel(store, user).level;
  const tools = toolsOf(user);
  const pool = recipes.filter((r) => known(user, r) && !r.season && r.effect !== 'casino' && (!r.tool || tools[r.tool]) && r.level <= lv);
  const clients = clientsOf(user);
  const n = setting(store, 'CookOrdersCount') + (lv >= 6 ? 1 : 0);
  const seed = (i, salt) => hash(`${user.id}-${day}-${i}-${salt}`);
  const list = pool.length ? Array.from({ length: n }, (_, i) => {
    const r = pool[seed(i, 'r') % pool.length];
    // Un client different par commande (tant qu'il y en a assez).
    const who = clients[(seed(0, 'w') + i) % clients.length];
    const roll = seed(i, 'q') % 10;
    return { id: i + 1, who: who.key, recipe: r.key, min: roll < 5 ? 1 : roll < 9 ? 2 : 3, done: false };
  }) : [];
  const fresh = { day, list, streak: cur ? Number(cur.streak) || 0 : 0, lastDay: cur ? cur.lastDay || null : null };
  // Tirees une fois par jour : la liste ne bouge plus quand le carnet s'agrandit.
  if (list.length) store.update('Users', user.id, { CookOrders: JSON.stringify(fresh) });
  return fresh;
}

// ------------------------------------------------------------------ vue
function view(store, user) {
  const t = now();
  const stock = stockOf(user);
  const recipes = recipesFor(store, user);
  const book = bookOf(user);
  const lv = cookLevel(store, user);
  const tools = toolsOf(user);
  const q = qualities(store);
  const buffs = buffsOf(user);
  const season = currentSeason(store);
  const recipeView = (r) => ({
    key: r.key, label: r.label, icon: r.icon, desc: r.desc, effect: r.effect, hours: r.hours, course: r.course, courseLabel: COURSES[r.course], tool: r.tool, keeps: r.keeps, season: r.season, level: r.level,
    effectText: effectText(store, r.effect), stars: book[r.key] ? Number(book[r.key].stars) || 0 : 0, cooked: book[r.key] ? Number(book[r.key].n) || 0 : 0,
    can: Object.entries(r.needs).every(([k, n]) => stock[k] >= n) && (!r.tool || !!tools[r.tool]) && r.level <= lv.level,
    needs: Object.entries(r.needs).map(([k, n]) => ({ key: k, label: INGREDIENTS[k].label, one: INGREDIENTS[k].one, icon: INGREDIENTS[k].icon, n, have: stock[k] }))
  });
  const orders = ordersOf(store, user, recipes);
  const clients = clientsOf(user);
  const byKey = new Map(recipes.map((r) => [r.key, r]));
  const { good } = dishesOf(store, user, t);
  const showIng = (k) => stock[k] > 0 || !INGREDIENTS[k].season || (season && [].concat(INGREDIENTS[k].season).includes(season.key));
  const toolPrices = setting(store, 'CookTools');
  const meal = buffs.meal && typeof buffs.meal === 'object' ? buffs.meal : {};
  return {
    enabled: !!setting(store, 'CookEnabled'),
    ingredients: Object.entries(INGREDIENTS).filter(([k]) => showIng(k)).map(([key, i]) => ({ key, label: i.label, icon: i.icon, n: stock[key] })),
    // Menu : les recettes connues (les cachees decouvertes et celles de la saison).
    recipes: recipes.filter((r) => known(user, r)).map(recipeView),
    // Carnet : les recettes cachees encore inconnues ne sont pas nommees.
    book: {
      known: recipes.filter((r) => !r.season && known(user, r)).map((r) => ({ key: r.key, icon: r.icon, label: r.label, stars: book[r.key] ? Number(book[r.key].stars) || 0 : 0, secret: r.secret })),
      hidden: recipes.filter((r) => !r.season && !known(user, r)).length,
      grandChef: !!book._grandChef
    },
    buffs: Object.entries(EFFECTS).filter(([k, e]) => !e.forbidden || Number(user.ForbiddenUnlocked) > 0).map(([key, e]) => ({ key, label: e.label, icon: e.icon, special: !!e.special, text: effectText(store, key), until: buffUntil(user, key, t) || null, power: buffUntil(user, key, t) ? powerOf(user, key) : null })),
    luck: luckOf(user), luckMax: setting(store, 'CookLuckMax'),
    specialSlots: specialSlots(lv.level), specialActive: SPECIAL.filter((k) => buffUntil(user, k, t)).length,
    meal: Object.keys(COURSES).map((c) => ({ course: c, label: COURSES[c], at: Number(meal[c]) > t - 3600 ? Number(meal[c]) : null })),
    level: { ...lv, perks: LEVEL_PERKS },
    potKinds: potKinds(user),
    qualities: q.map((x, i) => ({ key: x.key, label: x.label, stars: i, dur: x.dur, power: x.power })),
    orders: {
      list: orders.list.map((o) => { const r = byKey.get(o.recipe); const c = clients.find((x) => x.key === o.who) || VILLAGERS[0]; return { ...o, who: { key: c.key, label: c.label, icon: c.icon }, recipe: r ? { key: r.key, label: r.label, icon: r.icon } : { key: o.recipe, label: o.recipe, icon: '🍲' }, minLabel: (q[o.min] || {}).label, reward: orderReward(store, o) }; }),
      streak: orders.streak, streakGoal: 7
    },
    dishes: good.map((d) => { const r = byKey.get(d.key) || (d.key === DUBIOUS.key ? DUBIOUS : null); const fq = freshness(store, user, d, t); return { id: d.id, key: d.key, label: r ? r.label : d.key, icon: r ? r.icon : '🍲', q: fq, qLabel: (q[fq] || {}).label, keeps: !!d.keeps, at: d.at }; }),
    dishMax: setting(store, 'CookDishMax'),
    tools: Object.entries(TOOLS).map(([key, x]) => { const level = Number(tools[key]) || 0; const next = (toolPrices[key] || [])[level]; return { key, label: x.label, icon: x.icon, level, max: 3, unlockAt: TOOL_LEVEL[key], open: lv.level >= TOOL_LEVEL[key], text: level ? x.text(level) : x.text(1), next: next ? { text: x.text(level + 1), dust: indexed(store, next[0]), parts: Number(next[1]) || 0 } : null }; }),
    mill: tools.mill ? { salt: [3, 2, 1][tools.mill - 1], spice: [3, 2, 1][tools.mill - 1], calcaire: Number(mineralsOf(user).calcaire) || 0, herb: stock.herb } : null,
    season: season && SEASON_INGREDIENT[season.key] ? { key: season.key, label: season.label, icon: season.icon, ingredient: { key: SEASON_INGREDIENT[season.key], ...INGREDIENTS[SEASON_INGREDIENT[season.key]] } } : null,
    session: activeSession(user),
    maxHours: maxHours(store, lv.level), cookCount: Number(user.CookCount) || 0
  };
}
function orderReward(store, o) {
  return { dust: indexed(store, setting(store, 'CookOrderDust') * (1 + (Number(o.min) || 1))), love: setting(store, 'CookOrderLove'), xp: 10 };
}
function activeSession(user) {
  const s = parseJson(user.CookSession, null);
  return s && s.at && Date.now() - s.at < 60000 ? { id: s.id, target: s.target, total: s.total, windows: s.windows, label: s.label, icon: s.icon } : null;
}

// ------------------------------------------------------------------ cuisson
// Ce que la marmite (ou une recette du menu) va donner ; erreurs sans rien consommer.
function resolvePot(store, user, body) {
  const recipes = recipesFor(store, user);
  const stock = stockOf(user);
  const lv = cookLevel(store, user).level;
  const tools = toolsOf(user);
  let needs, r = null;
  if (body.recipe) {
    r = recipes.find((x) => x.key === String(body.recipe));
    if (!r || !known(user, r)) return { error: fail('unknown_recipe') };
    needs = r.needs;
  } else {
    const pot = body.pot && typeof body.pot === 'object' ? body.pot : {};
    needs = {};
    for (const [k, n] of Object.entries(pot)) if (INGREDIENTS[k] && Math.floor(Number(n)) > 0) needs[k] = Math.min(10, Math.floor(Number(n)));
    const kinds = Object.keys(needs).length;
    const total = Object.values(needs).reduce((s, n) => s + n, 0);
    if (kinds < 1 || total < 2) return { error: fail('pot_too_small') };
    if (kinds > potKinds(user)) return { error: fail('pot_too_many', 400, { max: potKinds(user) }) };
    r = recipes.find((x) => sameNeeds(x.needs, needs)) || null;
  }
  const missing = Object.entries(needs).filter(([k, n]) => stock[k] < n).map(([k]) => k);
  if (missing.length) return { error: fail('missing_ingredients', 400, { missing, ...view(store, user) }) };
  if (r && r.level > lv) return { error: fail('needs_level', 400, { level: r.level }) };
  if (r && r.tool && !tools[r.tool]) return { error: fail('needs_tool', 400, { tool: r.tool, label: TOOLS[r.tool].label }) };
  return { r, needs };
}
// Indice : une recette cachee a un ingredient pres.
function hintFor(store, user, needs) {
  for (const r of recipesFor(store, user)) {
    if (!r.secret || known(user, r)) continue;
    const keys = new Set([...Object.keys(r.needs), ...Object.keys(needs)]);
    let diff = 0, miss = null;
    for (const k of keys) { const d = (r.needs[k] || 0) - (needs[k] || 0); diff += Math.abs(d); if (d > 0) miss = k; }
    if (diff === 1 && miss) return { icon: INGREDIENTS[miss].icon, text: `Presque… il manquait peut-être ${INGREDIENTS[miss].icon} ${INGREDIENTS[miss].label.toLowerCase()}.` };
    if (diff === 1) return { icon: '🤏', text: 'Presque… un ingrédient de trop.' };
  }
  return null;
}
const DUBIOUS_LINES = ['Moka l’a reniflé et s’est enfuie.', 'Ça fait des bulles toutes seules.', 'Milo le mange quand même.', 'La cuillère tient debout dedans.', 'Ça a un goût de… mercredi.'];

// Cuisine : consomme, ajoute le plat, XP et carnet. Renvoie { fields, dish, notices }.
function cookDish(store, user, r, needs, q, fields = {}) {
  const t = now();
  const notices = [];
  const lvBefore = cookLevel(store, user).level;
  Object.assign(fields, pantryFields(user, Object.fromEntries(Object.entries(needs).map(([k, n]) => [k, -n])), fields));
  const book = bookOf(user);
  let discovered = false;
  const key = r ? r.key : DUBIOUS.key;
  if (r) {
    if (!book[key]) { discovered = r.secret; book[key] = { stars: 0, n: 0, at: t }; }
    book[key].n = (Number(book[key].n) || 0) + 1;
    book[key].stars = Math.max(Number(book[key].stars) || 0, q);
  }
  // Grand chef : toutes les recettes permanentes a 3 etoiles.
  const perm = recipesFor(store, user).filter((x) => !x.season);
  if (!book._grandChef && perm.length && perm.every((x) => book[x.key] && Number(book[x.key].stars) >= 3)) {
    book._grandChef = t;
    if (grantCosmetic(store, user.id, 'frame-chef', { type: 'frame', label: 'Grand chef' })) notices.push({ icon: '👨‍🍳', text: 'Toutes les recettes à 3 étoiles : cadre « Grand chef » !' });
  }
  const xp = XP_BY_QUALITY[q] + (discovered ? 25 : 0);
  fields.CookXP = xpOf(user) + xp;
  fields.CookBook = JSON.stringify(book);
  fields.CookCount = (Number(user.CookCount) || 0) + 1;
  const dish = { id: `${t}-${++dishSeq}`, key, q, at: t, keeps: !!(r && r.keeps) };
  const lvAfter = levelInfo(fields.CookXP, setting(store, 'CookLevelXpStep')).level;
  if (lvAfter >= 10 && lvBefore < 10) grantCosmetic(store, user.id, 'title-chef-etoile', { type: 'title', label: 'Chef étoilé' });
  return { fields, dish, discovered, xp, levelUp: lvAfter > lvBefore ? lvAfter : null, notices };
}

// Manger un plat : applique le bonus. Renvoie { fields, text } ou { error }.
function eatFields(store, user, dish, fields = {}) {
  const t = now();
  const recipes = recipesFor(store, user);
  const r = dish.key === DUBIOUS.key ? null : recipes.find((x) => x.key === dish.key) || recipesOf(store).find((x) => x.key === dish.key);
  const qs = qualities(store);
  const q = qs[Math.max(0, Math.min(3, dish.q))] || qs[1];
  const lv = cookLevel(store, { ...user, ...fields }).level;
  const buffs = buffsOf(user);
  let effect = r ? r.effect : BASE_EFFECTS[Math.floor(Math.random() * BASE_EFFECTS.length)];
  if (effect === 'random') effect = BASE_EFFECTS[Math.floor(Math.random() * BASE_EFFECTS.length)];
  const keys = effect === 'all' ? [...BASE_EFFECTS] : effect === 'luck' ? [] : [effect];
  // Effets speciaux : places limitees par le niveau (prolonger un bonus en cours ne prend pas de place).
  if (keys.some((k) => SPECIAL.includes(k) && !(Number(buffs[k]) > t))) {
    const active = SPECIAL.filter((k) => Number(buffs[k]) > t).length;
    if (active >= specialSlots(lv)) return { error: fail('no_special_slot', 400, { slots: specialSlots(lv) }) };
  }
  const toolBoost = r && r.tool === 'oven' ? 1 + Math.max(0, (Number(toolsOf(user).oven) || 1) - 1) * 0.15 : 1;
  const hours = (r ? r.hours : DUBIOUS.hours) * (Number(q.dur) || 1) * toolBoost;
  const cap = t + maxHours(store, lv) * 3600;
  buffs.power = buffs.power && typeof buffs.power === 'object' ? buffs.power : {};
  for (const k of keys) {
    const active = Number(buffs[k]) > t;
    buffs[k] = Math.min(cap, Math.max(t, Number(buffs[k]) || 0) + Math.round(hours * 3600));
    buffs.power[k] = active ? Math.max(Number(buffs.power[k]) || 1, Number(q.power) || 1) : Number(q.power) || 1;
  }
  if (effect === 'luck') buffs.luck = Math.min(setting(store, 'CookLuckMax'), luckOf(user) + (dish.q >= 3 ? 2 : 1));
  // Ancien bonus « tous » : reporte sur chaque effet, puis retire.
  if (buffs.all) { for (const k of BASE_EFFECTS) buffs[k] = Math.max(Number(buffs[k]) || 0, Number(buffs.all) || 0); delete buffs.all; }
  // Menu complet : entree + plat + dessert dans l'heure.
  let meal = false;
  if (r && r.course) {
    buffs.meal = buffs.meal && typeof buffs.meal === 'object' ? buffs.meal : {};
    buffs.meal[r.course] = t;
    if (Object.keys(COURSES).every((c) => Number(buffs.meal[c]) > t - 3600)) {
      const extra = Math.round(setting(store, 'CookMealBonusHours') * 3600);
      for (const k of Object.keys(EFFECTS)) if (Number(buffs[k]) > t) buffs[k] = Math.min(cap + 3600, Number(buffs[k]) + extra);
      buffs.meal = {};
      meal = true;
    }
  }
  fields.Buffs = JSON.stringify(buffs);
  const label = r ? r.label : DUBIOUS.label;
  const text = effect === 'luck' ? effectText(store, 'luck') : effectText(store, effect);
  return { fields, effect, hours, label, icon: r ? r.icon : DUBIOUS.icon, text, meal };
}

const saveDishes = (list) => JSON.stringify(list.slice(-200));

// ------------------------------------------------------------------ actions
function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') {
    // Plats gates depuis la derniere visite : retires, et annonces.
    const { good, spoiled } = dishesOf(store, user);
    if (spoiled.length) user = store.update('Users', user.id, { Dishes: saveDishes(good) });
    return ok({ ...view(store, user), ...(spoiled.length ? { spoiled: spoiled.length } : {}) });
  }
  if (!setting(store, 'CookEnabled')) return fail('cook_closed');
  const t = now();

  // Cuisson rapide (V1) : qualite « correct », mangee tout de suite sauf body.store.
  if (action === 'cook') {
    const res = resolvePot(store, user, body);
    if (res.error) return res.error;
    const keep = !!body.store;
    if (keep && dishesOf(store, user).good.length >= setting(store, 'CookDishMax')) return fail('dishes_full');
    const c = cookDish(store, user, res.r, res.needs, 1);
    let eaten = null;
    if (!keep) {
      eaten = eatFields(store, user, c.dish, c.fields);
      if (eaten.error) return eaten.error;
    } else c.fields.Dishes = saveDishes([...dishesOf(store, user).good, c.dish]);
    user = store.update('Users', user.id, c.fields);
    return ok({ ...view(store, user), ...cookedJson(store, user, res, c, eaten) });
  }

  // Cuisson a point : le serveur tire le moment ideal et garde l'heure de depart.
  if (action === 'start') {
    const res = resolvePot(store, user, body);
    if (res.error) return res.error;
    if (dishesOf(store, user).good.length >= setting(store, 'CookDishMax')) return fail('dishes_full');
    const lv = cookLevel(store, user).level;
    const target = 2200 + Math.floor(Math.random() * 1600);
    const tol = lv >= 9 ? 1.2 : 1;
    const windows = setting(store, 'CookTiming').map((w) => Math.round(Number(w) * tol));
    const s = { id: `${Date.now()}`, at: Date.now(), target, total: Math.round(target * 1.7), windows, needs: res.needs, label: res.r && known(user, res.r) ? res.r.label : '???', icon: res.r && known(user, res.r) ? res.r.icon : '🫕' };
    user = store.update('Users', user.id, { CookSession: JSON.stringify(s) });
    return ok({ session: { id: s.id, target, total: s.total, windows, label: s.label, icon: s.icon } });
  }
  if (action === 'finish') {
    const s = parseJson(user.CookSession, null);
    if (!s || s.id !== String(body.id) || Date.now() - s.at > 60000) return fail('no_session');
    const server = Date.now() - s.at;
    const client = Number(body.ms);
    // Temps du joueur s'il est vraisemblable (la latence le rend plus court que celui du serveur).
    const ms = Number.isFinite(client) && client <= server + 100 && client >= server - 3000 ? client : server;
    const gap = Math.abs(Math.min(ms, s.total) - s.target);
    const [perfect, good, okay] = s.windows;
    const q = ms >= s.total ? 0 : gap <= perfect ? 3 : gap <= good ? 2 : gap <= okay ? 1 : 0;
    // Meme marmite qu'au depart (une recette cachee se retrouve par ses ingredients).
    const res = resolvePot(store, user, { pot: s.needs });
    if (res.error) { store.update('Users', user.id, { CookSession: '' }); return res.error; }
    const c = cookDish(store, user, res.r, res.needs, q, { CookSession: '' });
    const list = [...dishesOf(store, user).good, c.dish];
    // Chaudron : double portion.
    const cauldron = Number(toolsOf(user).cauldron) || 0;
    let twice = false;
    if (res.r && cauldron > 1 && list.length < setting(store, 'CookDishMax') && Math.random() < [0, 0.15, 0.3][cauldron - 1]) { list.push({ ...c.dish, id: c.dish.id + 'b' }); twice = true; }
    c.fields.Dishes = saveDishes(list);
    user = store.update('Users', user.id, c.fields);
    return ok({ ...view(store, user), ...cookedJson(store, user, res, c, null), quality: { q, label: (qualities(store)[q] || {}).label, ms, target: s.target, twice } });
  }

  if (action === 'eat' || action === 'deliver' || action === 'discard') {
    const { good } = dishesOf(store, user);
    const dish = good.find((d) => d.id === String(body.dishId));
    if (!dish) return fail('no_dish', 400, view(store, user));
    const rest = good.filter((d) => d !== dish);
    const fq = freshness(store, user, dish);
    if (action === 'discard') return ok({ ...view(store, store.update('Users', user.id, { Dishes: saveDishes(rest) })), discarded: true });
    if (action === 'eat') {
      const e = eatFields(store, user, { ...dish, q: fq }, { Dishes: saveDishes(rest) });
      if (e.error) return e.error;
      user = store.update('Users', user.id, e.fields);
      return ok({ ...view(store, user), eaten: { label: e.label, icon: e.icon, effect: e.effect, effectText: e.text, hours: Math.round(e.hours * 100) / 100, meal: e.meal, q: fq } });
    }
    // Livraison d'une commande du jour.
    const recipes = recipesFor(store, user);
    const orders = ordersOf(store, user, recipes);
    const o = orders.list.find((x) => x.id === Number(body.order));
    if (!o || o.done) return fail('no_order', 400, view(store, user));
    if (o.recipe !== dish.key) return fail('wrong_dish', 400, view(store, user));
    if (fq < o.min) return fail('not_good_enough', 400, { min: o.min, ...view(store, user) });
    o.done = true;
    const rw = orderReward(store, o);
    const fields = { Dishes: saveDishes(rest), StardustCount: (Number(user.StardustCount) || 0) + rw.dust, CookXP: xpOf(user) + rw.xp };
    const notices = [];
    const client = clientsOf(user).find((c) => c.key === o.who);
    if (client && client.pet) {
      const all = parseJson(user.PetLove, {}) || {};
      const p = all[client.key] || {};
      all[client.key] = { ...p, v: Math.min(100, loveOf(store, user, client.key, t) + rw.love), at: t };
      fields.PetLove = JSON.stringify(all);
    }
    let rare = null;
    if (Math.random() < setting(store, 'CookOrderRareChance')) {
      const k = ['truffle', 'rarefish', 'spice', 'flower', 'egg'][Math.floor(Math.random() * 5)];
      Object.assign(fields, pantryFields(user, { [k]: 1 }, fields));
      rare = { key: k, label: INGREDIENTS[k].one, icon: INGREDIENTS[k].icon };
    }
    // Toutes livrees aujourd'hui : la serie avance.
    if (orders.list.every((x) => x.done) && orders.lastDay !== orders.day) {
      orders.streak = orders.lastDay === parisDay(-1) ? orders.streak + 1 : 1;
      orders.lastDay = orders.day;
      notices.push({ icon: '🛎️', text: `Toutes les commandes du jour livrées ! Série : ${orders.streak} jour${orders.streak > 1 ? 's' : ''}.` });
      if (orders.streak >= 7 && grantCosmetic(store, user.id, 'title-aubergiste', { type: 'title', label: 'Aubergiste du village' })) notices.push({ icon: '🏅', text: '7 jours de commandes : titre « Aubergiste du village » !' });
    }
    fields.CookOrders = JSON.stringify(orders);
    const lvBefore = cookLevel(store, user).level;
    user = store.update('Users', user.id, fields);
    const lvAfter = cookLevel(store, user).level;
    return ok({ ...view(store, user), delivered: { order: o.id, who: client ? client.label : '', dust: rw.dust, love: client && client.pet ? rw.love : 0, rare }, notices, ...(lvAfter > lvBefore ? { levelUp: lvAfter } : {}) });
  }

  if (action === 'buyTool') {
    const key = String(body.tool || '');
    if (!TOOLS[key]) return fail('unknown_tool');
    const lv = cookLevel(store, user).level;
    if (lv < TOOL_LEVEL[key]) return fail('needs_level', 400, { level: TOOL_LEVEL[key] });
    const tools = toolsOf(user);
    const level = Number(tools[key]) || 0;
    const next = (setting(store, 'CookTools')[key] || [])[level];
    if (!next || level >= 3) return fail('max_level');
    const dust = indexed(store, next[0]), parts = Number(next[1]) || 0;
    if ((Number(user.StardustCount) || 0) < dust) return fail('not_enough_dust');
    if ((Number(user.SpareParts) || 0) < parts) return fail('not_enough_parts');
    tools[key] = level + 1;
    user = store.update('Users', user.id, { CookTools: JSON.stringify(tools), StardustCount: (Number(user.StardustCount) || 0) - dust, SpareParts: (Number(user.SpareParts) || 0) - parts });
    return ok({ ...view(store, user), bought: { tool: key, level: level + 1, dust, parts } });
  }

  // Moulin : sel de roche (Calcaire du sac de mineraux) ou epices (herbes).
  if (action === 'mill') {
    const lv = Number(toolsOf(user).mill) || 0;
    if (!lv) return fail('needs_tool', 400, { tool: 'mill', label: TOOLS.mill.label });
    const kind = body.kind === 'spice' ? 'spice' : 'salt';
    const n = Math.max(1, Math.min(50, Math.floor(Number(body.n) || 1)));
    const per = [3, 2, 1][lv - 1];
    if (kind === 'salt') {
      const m = { ...mineralsOf(user) };
      if ((Number(m.calcaire) || 0) < per * n) return fail('not_enough_minerals');
      m.calcaire -= per * n;
      user = store.update('Users', user.id, { Minerals: JSON.stringify(m), ...pantryFields(user, { salt: n }) });
    } else {
      if (stockOf(user).herb < per * n) return fail('missing_ingredients', 400, { missing: ['herb'] });
      user = store.update('Users', user.id, pantryFields(user, { herb: -per * n, spice: n }));
    }
    return ok({ ...view(store, user), milled: { kind, n, label: INGREDIENTS[kind].label, icon: INGREDIENTS[kind].icon } });
  }
  return fail('unknown_action');
}

function cookedJson(store, user, res, c, eaten) {
  const r = res.r;
  const base = { key: r ? r.key : DUBIOUS.key, label: r ? r.label : DUBIOUS.label, icon: r ? r.icon : DUBIOUS.icon, effect: r ? r.effect : 'random', effectText: effectText(store, r ? r.effect : 'random'), hours: r ? r.hours : DUBIOUS.hours };
  const out = { cooked: { ...base, dishId: c.dish.id, q: c.dish.q, discovered: c.discovered, xp: c.xp, keeps: c.dish.keeps }, notices: c.notices };
  if (!r) {
    out.cooked.line = DUBIOUS_LINES[Math.floor(Math.random() * DUBIOUS_LINES.length)];
    out.cooked.desc = DUBIOUS.desc;
  }
  if (!r) { const h = hintFor(store, user, res.needs); if (h) out.hint = h; }
  if (eaten) out.eaten = { label: eaten.label, icon: eaten.icon, effect: eaten.effect, effectText: eaten.text, hours: Math.round(eaten.hours * 100) / 100, meal: eaten.meal };
  if (c.levelUp) out.levelUp = c.levelUp;
  return out;
}

// ------------------------------------------------------------------ autres jeux
// Ingredients trouves ailleurs (evenements des jeux, activity.js) : truffes
// a la fouille, fleurs au jardin, poissons rares a la peche, oeufs des dinos,
// et l'ingredient de la saison en cours.
const RARE_FISH = new Set(['rare', 'epique', 'legendaire', 'mythique']);
export function onEvents(store, events) {
  const out = [];
  if (!setting(store, 'CookEnabled')) return out;
  const season = currentSeason(store);
  const seasonal = season && SEASON_INGREDIENT[season.key];
  for (const e of events) {
    const add = {};
    if (e.type === 'dig' && Math.random() < setting(store, 'CookTruffleChance')) add.truffle = 1;
    if (e.type === 'harvest' && Math.random() < 1 - Math.pow(1 - setting(store, 'CookFlowerChance'), Math.min(10, e.n || 1))) add.flower = 1;
    if (e.type.startsWith('fishCatch:') && RARE_FISH.has(e.meta && e.meta.tier) && Math.random() < setting(store, 'CookRareFishChance')) add.rarefish = 1;
    if (e.type === 'dinoCollect' && Math.random() < setting(store, 'CookEggChance')) add.egg = 1 + (Math.random() < 0.3 ? 1 : 0);
    if (seasonal && ['dig', 'harvest', 'fish', 'walk'].includes(e.type) && Math.random() < setting(store, 'CookSeasonDropChance')) add[seasonal] = 1;
    if (!Object.keys(add).length) continue;
    const user = store.get('Users', e.userId);
    if (!user) continue;
    store.update('Users', user.id, pantryFields(user, add));
    for (const [k, n] of Object.entries(add)) out.push({ userId: user.id, kind: 'cook', icon: INGREDIENTS[k].icon, label: `Pour la cuisine : +${n} ${INGREDIENTS[k].label.toLowerCase()} !` });
  }
  return out;
}

// Effets lus apres les workflows : mineral en plus a la fouille, retour plus
// rapide de l'expedition, finition en plus a l'ouverture d'un booster.
export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  const body = request.body || {};
  const json = response.json;
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  if (path === 'dig' && body.action === 'dig' && json.dug && !json.mineral && buffOn(user, 'dig') && Math.random() < pctOn(store, user, 'dig', 'CookDigPct')) {
    const cfg = parseJson(body.depthCfg, {}) || {};
    const tier = 1 + Math.floor(Math.random() * Math.min(5, Math.max(1, Number(cfg.mineralMax) || 1)));
    const pool = MINERALS.filter((m) => m.tier === tier);
    const m = pool[Math.floor(Math.random() * pool.length)];
    const owned = { ...mineralsOf(user) };
    owned[m.key] = (Number(owned[m.key]) || 0) + 1;
    store.update('Users', user.id, { Minerals: JSON.stringify(owned) });
    json.mineral = { key: m.key, name: m.name, tier: m.tier, img: 'Fouille/' + m.img, cooked: true };
    json.notices = [...(json.notices || []), { kind: 'cook', icon: '⛏️', label: `Bon repas : un minéral en plus (${m.name}) !` }];
    return;
  }
  if (path === 'expedition' && body.action === 'start' && json.expedition && json.expedition.active && buffOn(user, 'expedition')) {
    const until = Number(user.ExpeditionUntil) || 0;
    const cut = Math.floor(Math.max(0, until - now()) * Math.min(0.8, pctOn(store, user, 'expedition', 'CookExpeditionPct')));
    if (cut > 0) {
      store.update('Users', user.id, { ExpeditionUntil: until - cut });
      json.expedition.until = until - cut;
      json.expedition.secondsLeft = Math.max(0, (json.expedition.secondsLeft || 0) - cut);
      json.expedition.shortenedBy = (json.expedition.shortenedBy || 0) + cut;
      json.notices = [...(json.notices || []), { kind: 'cook', icon: '🧭', label: `Bon repas : Milo partira ${Math.round(cut / 60)} min de moins !` }];
    }
    return;
  }
  if (path === 'open-pack' && !body.dryRun && Array.isArray(json.cards) && json.cards.length && luckOf(user) > 0) {
    const ORDER = ['normal', 'holo', 'gold', 'ghost', 'diamond'];
    const cand = json.cards.filter((c) => ORDER.indexOf(c.finish || 'normal') >= 0 && ORDER.indexOf(c.finish || 'normal') < ORDER.length - 1)
      .sort((a, b) => ((b.rarity && b.rarity.sortOrder) || 0) - ((a.rarity && a.rarity.sortOrder) || 0));
    const c = cand[0];
    if (!c) return;
    const pull = store.getAll('Pulls').find((p) => p.BatchId === json.batchId && refId(p.User) === user.id && refId(p.Card) === c.cardId && p.SerialNumber === c.serialNumber);
    if (!pull) return;
    const to = ORDER[ORDER.indexOf(c.finish || 'normal') + 1];
    store.update('Pulls', pull.id, { Finish: to });
    c.finish = to;
    c.cookLuck = true;
    const buffs = buffsOf(user);
    buffs.luck = Math.max(0, luckOf(user) - 1);
    store.update('Users', user.id, { Buffs: JSON.stringify(buffs) });
    json.notices = [...(json.notices || []), { kind: 'cook', icon: '🍀', label: `Plat porte-bonheur : ${c.name} passe en ${to === 'holo' ? 'holographique' : to === 'gold' ? 'doré' : to === 'ghost' ? 'Ghost' : 'Diamant'} !` }];
  }
}

export const routes = { 'POST cook': handle };
