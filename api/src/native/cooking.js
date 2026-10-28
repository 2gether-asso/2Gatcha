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
//   POST /webhook/cook { userId, action: 'status' | 'cook', recipe? }
// Users.Pantry = { veg, herb, berry, mush, honey } ; Users.Buffs = { garden: fin, fish: fin, ... } (secondes)

import { ok, fail, userById, now, parseJson } from './common.js';
import { setting } from './settings.js';

export const schema = { Users: { Pantry: { type: 'Text' }, Buffs: { type: 'Text' }, CookCount: { type: 'Numeric' } } };

// Ingredients : cle, libelle, icone, et colonne quand ce n'est pas le garde-manger.
export const INGREDIENTS = {
  veg: { label: 'Légumes', one: 'légume', icon: '🥬' },
  herb: { label: 'Herbes', one: 'herbe', icon: '🌿' },
  berry: { label: 'Baies', one: 'baie', icon: '🫐' },
  mush: { label: 'Champignons', one: 'champignon', icon: '🍄' },
  honey: { label: 'Miel', one: 'pot de miel', icon: '🍯' },
  fish: { label: 'Poissons', one: 'poisson', icon: '🐟', field: 'CatFish' },
  carrot: { label: 'Carottes', one: 'carotte', icon: '🥕', field: 'Carrots' }
};
export const EFFECTS = {
  garden: { label: 'Jardin', icon: '🌱' },
  fish: { label: 'Pêche', icon: '🎣' },
  archeo: { label: 'Archéologie', icon: '🏺' },
  pets: { label: 'Compagnons', icon: '🐾' }
};
const EFFECT_KEYS = [...Object.keys(EFFECTS), 'all'];

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
// Facteurs lus par les jeux (1 = sans effet).
export const gardenBuff = (store, user) => (buffOn(user, 'garden') ? 1 - Math.min(80, setting(store, 'CookGardenPct')) / 100 : 1);
export const fishBuff = (store, user) => (buffOn(user, 'fish') ? 1 + setting(store, 'CookFishPct') / 100 : 1);
export const archeoBuff = (store, user) => (buffOn(user, 'archeo') ? 1 + setting(store, 'CookArcheoPct') / 100 : 1);

// Recettes reglees, bornees ; une recette mal formee est ignoree.
function recipesOf(store) {
  const rows = setting(store, 'CookRecipes');
  return (Array.isArray(rows) ? rows : []).filter((r) => r && r.key && EFFECT_KEYS.includes(r.effect) && r.active !== false).map((r) => {
    const needs = {};
    for (const [k, n] of Object.entries(r.needs || {})) if (INGREDIENTS[k] && Math.floor(Number(n)) > 0) needs[k] = Math.min(50, Math.floor(Number(n)));
    return { key: String(r.key).slice(0, 30), label: String(r.label || r.key).slice(0, 40), icon: String(r.icon || '🍲').slice(0, 8), desc: String(r.desc || '').slice(0, 160), effect: r.effect, hours: Math.max(0.25, Math.min(24, Number(r.hours) || 1)), needs };
  }).filter((r) => Object.keys(r.needs).length);
}

function effectText(store, effect) {
  if (effect === 'garden') return `Jardin : pousse ${setting(store, 'CookGardenPct')} % plus rapide`;
  if (effect === 'fish') return `Pêche : prises rares +${setting(store, 'CookFishPct')} %`;
  if (effect === 'archeo') return `Archéologie : endurance +${setting(store, 'CookArcheoPct')} % sur les tablettes ouvertes`;
  if (effect === 'pets') return 'Compagnons : ils travaillent comme s’ils t’adoraient';
  return 'Tous les bonus à la fois';
}

function view(store, user) {
  const t = now();
  const stock = stockOf(user);
  return {
    enabled: !!setting(store, 'CookEnabled'),
    ingredients: Object.entries(INGREDIENTS).map(([key, i]) => ({ key, label: i.label, icon: i.icon, n: stock[key] })),
    recipes: recipesOf(store).map((r) => ({ ...r, effectText: effectText(store, r.effect), can: Object.entries(r.needs).every(([k, n]) => stock[k] >= n), needs: Object.entries(r.needs).map(([k, n]) => ({ key: k, label: INGREDIENTS[k].label, one: INGREDIENTS[k].one, icon: INGREDIENTS[k].icon, n, have: stock[k] })) })),
    buffs: Object.entries(EFFECTS).map(([key, e]) => ({ key, label: e.label, icon: e.icon, text: effectText(store, key), until: buffUntil(user, key, t) || null })),
    maxHours: setting(store, 'CookMaxHours'), cookCount: Number(user.CookCount) || 0
  };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(view(store, user));
  if (action !== 'cook') return fail('unknown_action');
  if (!setting(store, 'CookEnabled')) return fail('cook_closed');
  const r = recipesOf(store).find((x) => x.key === String(body.recipe || ''));
  if (!r) return fail('unknown_recipe');
  const stock = stockOf(user);
  const missing = Object.entries(r.needs).filter(([k, n]) => stock[k] < n).map(([k]) => k);
  if (missing.length) return fail('missing_ingredients', 400, { missing, ...view(store, user) });
  const t = now();
  const buffs = buffsOf(user);
  const cap = t + setting(store, 'CookMaxHours') * 3600;
  const keys = r.effect === 'all' ? Object.keys(EFFECTS) : [r.effect];
  for (const k of keys) buffs[k] = Math.min(cap, Math.max(t, Number(buffs[k]) || 0) + Math.round(r.hours * 3600));
  // Ancien bonus « tous » : reporte sur chaque effet, puis retire.
  if (buffs.all) { for (const k of Object.keys(EFFECTS)) buffs[k] = Math.max(Number(buffs[k]) || 0, Number(buffs.all) || 0); delete buffs.all; }
  const fields = pantryFields(user, Object.fromEntries(Object.entries(r.needs).map(([k, n]) => [k, -n])));
  user = store.update('Users', user.id, { ...fields, Buffs: JSON.stringify(buffs), CookCount: (Number(user.CookCount) || 0) + 1 });
  return ok({ ...view(store, user), cooked: { key: r.key, label: r.label, icon: r.icon, effect: r.effect, effectText: effectText(store, r.effect), hours: r.hours } });
}

export const routes = { 'POST cook': handle };
