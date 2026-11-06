// Tests de la cuisine V2 (2026-11-06) : marmite et recettes cachees, cuisson a
// point, metier, commandes, ustensiles, plats gardes, nouveaux ingredients et
// effets, menu complet, recettes de saison. Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import * as cooking from '../src/native/cooking.js';
import { now } from '../src/native/common.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2gatcha-cook2-'));
const tmp = path.join(dir, 'base.sqlite');
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const call = (method, p, body = {}) => { native.beforeRequest(body, {}, p); const r = native.run(method, p, { body, query: {} }); native.endRequest(); return r; };
const ADMIN = '785223211730075709';
const cook = (body, userId = u1.id) => call('POST', 'cook', { userId, ...body });
const user = (id) => store.get('Users', id);
const [u1, u2] = store.getAll('Users');
const ALL = ['veg', 'herb', 'berry', 'mush', 'honey', 'fruit', 'egg', 'truffle', 'salt', 'spice', 'rarefish', 'flower', 'almond', 'cocoa', 'coconut', 'pumpkin', 'chestnut'];
const fill = (id, n = 30) => store.update('Users', id, { Pantry: JSON.stringify(Object.fromEntries(ALL.map((k) => [k, n]))), CatFish: n, Carrots: n });
const pantry = (id) => JSON.parse(user(id).Pantry || '{}');
const buffs = (id) => JSON.parse(user(id).Buffs || '{}');
const sleepMs = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* attente active : le serveur mesure le temps */ } };

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

fill(u1.id);
store.update('Users', u1.id, { StardustCount: 1e6, SpareParts: 50, Buffs: '{}', CookXP: 0, CookBook: '{}', CookTools: '{}', Dishes: '[]', CookOrders: '' });

await test('statut : menu, carnet avec recettes cachees, niveau, commandes', () => {
  const st = cook({ action: 'status' }).json;
  assert.ok(st.recipes.some((r) => r.key === 'soupe'));
  assert.ok(!st.recipes.some((r) => r.key === 'omelette'), 'recette cachee absente du menu');
  assert.ok(st.book.hidden >= 10, 'cases ? : ' + st.book.hidden);
  assert.equal(st.level.level, 1);
  assert.equal(st.potKinds, 3);
  assert.equal(st.orders.list.length, 3);
  assert.ok(!st.buffs.some((b) => b.key === 'casino'), 'casino cache sans la porte');
});

await test('marmite : recette cachee decouverte, ragout douteux avec indice', () => {
  let r = cook({ action: 'cook', pot: { egg: 2, herb: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.cooked.key, 'omelette');
  assert.equal(r.json.cooked.discovered, true);
  assert.ok(r.json.recipes.some((x) => x.key === 'omelette'), 'au menu');
  assert.equal(pantry(u1.id).egg, 28);
  // Une truffe de moins que le gratin : ragout douteux + indice (gratin cache, ustensile non requis pour l'indice).
  r = cook({ action: 'cook', pot: { mush: 1, berry: 1 } });
  assert.equal(r.json.cooked.key, 'douteux');
  r = cook({ action: 'cook', pot: { veg: 1, flower: 1 } });
  assert.equal(r.json.cooked.key, 'douteux');
  assert.ok(r.json.hint && /fleurs/.test(r.json.hint.text), 'indice : ' + JSON.stringify(r.json.hint));
  assert.equal(cook({ action: 'cook', pot: { veg: 1, herb: 1, berry: 1, mush: 1 } }).json.error, 'pot_too_many');
  assert.equal(cook({ action: 'cook', pot: { veg: 1 } }).json.error, 'pot_too_small');
  // Ustensile manquant : rien n'est consomme.
  const before = pantry(u1.id).honey;
  assert.equal(cook({ action: 'cook', pot: { carrot: 2, honey: 1 } }).json.error, 'needs_level');
  assert.equal(pantry(u1.id).honey, before);
});

await test('cuisson a point : qualite selon le temps, carnet en etoiles, plat garde', () => {
  let s = cook({ action: 'start', recipe: 'soupe' }).json.session;
  assert.ok(s && s.target >= 2200 && s.windows.length === 3, JSON.stringify(s));
  sleepMs(s.target);
  let r = cook({ action: 'finish', id: s.id, ms: s.target });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.quality.q, 3, 'parfait');
  assert.equal(r.json.recipes.find((x) => x.key === 'soupe').stars, 3);
  assert.ok(r.json.dishes.some((d) => d.key === 'soupe' && d.q === 3));
  // Trop tard (au-dela du temps total) : rate.
  s = cook({ action: 'start', recipe: 'soupe' }).json.session;
  r = cook({ action: 'finish', id: s.id, ms: 999999 });
  assert.equal(r.json.quality.q, 0);
  assert.equal(cook({ action: 'finish', id: s.id, ms: 1 }).json.error, 'no_session');
});

await test('manger : bonus avec force et duree selon la qualite ; menu complet', () => {
  const st = cook({ action: 'status' }).json;
  const perfect = st.dishes.find((d) => d.q === 3);
  let r = cook({ action: 'eat', dishId: perfect.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const b = buffs(u1.id);
  assert.ok(b.garden > now() + 4 * 3600 * 1.5, 'duree x1,6');
  assert.equal(b.power.garden, 1.3);
  assert.ok(cooking.gardenBuff(store, user(u1.id)) < 1 - 0.25, 'force x1,3');
  // Menu complet : entree (soupe) + plat + dessert.
  cook({ action: 'cook', recipe: 'grillade' });
  r = cook({ action: 'cook', recipe: 'tarte' });
  assert.equal(r.json.eaten.meal, true, 'menu complet');
});

await test('effets speciaux : places selon le niveau ; xp multipliee', () => {
  store.update('Users', u1.id, { Buffs: '{}' });
  let r = cook({ action: 'cook', recipe: 'omelette' });
  assert.ok(buffs(u1.id).xp > now());
  assert.ok(cooking.xpMult(store, user(u1.id)) > 1);
  r = cook({ action: 'cook', pot: { fruit: 2, berry: 1 } }); // sorbet : peche, pas special
  assert.equal(r.status, 200);
  // Deuxieme effet special au niveau 1 : refuse.
  r = cook({ action: 'cook', pot: { mush: 2, veg: 1, salt: 1 } });
  assert.equal(r.json.error, 'no_special_slot');
  // Prolonger le meme effet special : permis.
  assert.equal(cook({ action: 'cook', recipe: 'omelette' }).status, 200);
  // XP de compte multipliee.
  const xpBefore = Number(user(u1.id).XP) || 0;
  store.update('Users', u1.id, { XP: xpBefore + 100 });
  assert.equal(Number(user(u1.id).XP), xpBefore + 110, 'x1,1 avec un plat correct');
});

await test('metier : niveaux, ustensiles, chaudron a 4 ingredients, moulin', () => {
  store.update('Users', u1.id, { CookXP: 60 * 15 }); // niveau 6
  let st = cook({ action: 'status' }).json;
  assert.ok(st.level.level >= 5, 'niveau ' + st.level.level);
  assert.equal(cook({ action: 'buyTool', tool: 'cauldron' }).status, 200);
  assert.equal(cook({ action: 'buyTool', tool: 'mill' }).status, 200);
  assert.equal(cook({ action: 'buyTool', tool: 'oven' }).status, 200);
  assert.equal(cook({ action: 'buyTool', tool: 'smoker' }).status, 200);
  st = cook({ action: 'status' }).json;
  assert.equal(st.potKinds, 4);
  assert.equal(cook({ action: 'buyTool', tool: 'nope' }).json.error, 'unknown_tool');
  // Moulin : 3 Calcaire -> 1 sel.
  store.update('Users', u1.id, { Minerals: JSON.stringify({ calcaire: 6 }) });
  const salt = pantry(u1.id).salt;
  let r = cook({ action: 'mill', kind: 'salt', n: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(pantry(u1.id).salt, salt + 2);
  assert.equal(JSON.parse(user(u1.id).Minerals).calcaire, 0);
  assert.equal(cook({ action: 'mill', kind: 'salt', n: 1 }).json.error, 'not_enough_minerals');
  // Chaudron : pot-au-feu a 4 sortes.
  r = cook({ action: 'cook', pot: { veg: 2, carrot: 2, salt: 1, herb: 1 }, store: true });
  assert.equal(r.json.cooked.key, 'potaufeu');
  // Fumoir : le poisson fume se garde.
  r = cook({ action: 'cook', pot: { fish: 2, salt: 1 }, store: true });
  assert.equal(r.json.cooked.key, 'fume');
  assert.equal(r.json.cooked.keeps, true);
});

await test('plats gardes : un plat frais perd une qualite, se gate ; le fume reste', () => {
  const list = JSON.parse(user(u1.id).Dishes);
  const old = now() - 3 * 24 * 3600;
  list.forEach((d) => { d.at = old; });
  list.push({ id: 'vieux', key: 'soupe', q: 1, at: now() - 50 * 3600, keeps: false });
  store.update('Users', u1.id, { Dishes: JSON.stringify(list) });
  const st = cook({ action: 'status' }).json;
  assert.ok(st.dishes.some((d) => d.key === 'fume' && d.keeps), 'fume garde');
  assert.ok(!st.dishes.some((d) => d.id === 'vieux'), 'gate et retire');
  assert.ok(st.spoiled >= 1);
});

await test('commandes : livrer le bon plat, qualite minimale, recompenses', () => {
  store.update('Users', u1.id, { CookOrders: JSON.stringify({ day: '2000-01-01', list: [], streak: 6, lastDay: null }) });
  let st = cook({ action: 'status' }).json;
  const o = st.orders.list[0];
  assert.ok(o && o.recipe.key, JSON.stringify(st.orders));
  // Prepare le plat parfait de la commande.
  const s = cook({ action: 'start', recipe: o.recipe.key }).json.session;
  assert.ok(s, 'start ' + o.recipe.key);
  sleepMs(s.target);
  const fin = cook({ action: 'finish', id: s.id, ms: s.target }).json;
  const dish = fin.dishes.filter((d) => d.key === o.recipe.key).sort((a, b) => b.q - a.q)[0];
  const dust = Number(user(u1.id).StardustCount);
  const r = cook({ action: 'deliver', dishId: dish.id, order: o.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Number(user(u1.id).StardustCount) > dust);
  assert.equal(r.json.orders.list.find((x) => x.id === o.id).done, true);
  assert.equal(cook({ action: 'deliver', dishId: dish.id, order: o.id }).json.error, 'no_dish');
});

await test('nouveaux ingredients : truffe a la fouille, oeufs des dinos (evenements)', () => {
  call('POST', 'admin-settings', { discordId: ADMIN, action: 'set', values: { CookTruffleChance: 1, CookEggChance: 1 } });
  const t0 = pantry(u1.id).truffle || 0, e0 = pantry(u1.id).egg || 0;
  const notes = cooking.onEvents(store, [{ userId: u1.id, type: 'dig', n: 1, meta: {} }, { userId: u1.id, type: 'dinoCollect', n: 1, meta: {} }]);
  assert.equal(pantry(u1.id).truffle, t0 + 1);
  assert.ok(pantry(u1.id).egg > e0);
  assert.ok(notes.length >= 2 && notes[0].label);
});

await test('chance : une carte de l ouverture gagne une finition', () => {
  store.update('Users', u1.id, { Buffs: JSON.stringify({ luck: 1 }) });
  const p = store.getAll('Pulls').find((x) => x.User === u1.id && (x.Finish || 'normal') === 'normal');
  store.update('Pulls', p.id, { BatchId: 'luck-test' });
  const json = { batchId: 'luck-test', cards: [{ cardId: p.Card, serialNumber: p.SerialNumber, finish: 'normal', name: 'X', rarity: { sortOrder: 1 } }] };
  cooking.afterWorkflow({ store, path: 'open-pack', request: { body: { userId: u1.id } }, response: { status: 200, json } });
  assert.equal(store.get('Pulls', p.id).Finish, 'holo');
  assert.equal(json.cards[0].finish, 'holo');
  assert.equal(JSON.parse(user(u1.id).Buffs).luck, 0);
});

await test('casino : recette et bonus seulement porte ouverte', () => {
  store.update('Users', u1.id, { ForbiddenUnlocked: 1, Buffs: '{}' });
  const r = cook({ action: 'cook', pot: { fruit: 1, spice: 1, honey: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(r.json.cooked.key, 'croupier', JSON.stringify(r.json.cooked));
  assert.ok(cooking.casinoBuff(user(u1.id)));
  store.update('Users', u2.id, { ForbiddenUnlocked: 0 });
  fill(u2.id);
  cook({ action: 'status' }, u2.id);
  const r2 = cook({ action: 'cook', pot: { fruit: 1, spice: 1, honey: 1 } }, u2.id);
  assert.equal(r2.status, 200, JSON.stringify(r2.json).slice(0, 200));
  assert.equal(r2.json.cooked.key, 'douteux');
});

await test('saison : recette au menu seulement pendant l evenement', () => {
  const st = cook({ action: 'status' }).json;
  const seasonal = st.recipes.filter((r) => r.season);
  if (st.season) assert.ok(seasonal.every((r) => r.season === st.season.key));
  else assert.equal(seasonal.length, 0);
});

console.log(`\n${passed} tests ok`);
