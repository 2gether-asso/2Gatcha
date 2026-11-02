// Tests du lot du 2026-11-02 : regles actives dans d'autres modes, nouveautes du
// mode Chill (marees, sable, chateaux, bibliotheque engloutie, promenade a la
// plage, amis, titres, carnet), carte du mode expliquee, sante, vignettes,
// sauvegardes JSON planifiees. Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import * as moderules from '../src/native/moderules.js';
import * as vacation from '../src/native/vacation.js';
import { createJsonBackups } from '../src/json-backup.js';
import { writeSave } from '../src/admin.js';
import { parisDay } from '../src/native/common.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2gatcha-chill-'));
const tmp = path.join(dir, 'base.sqlite');
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const call = (method, p, body = {}) => { native.beforeRequest(body, {}, p); const r = native.run(method, p, { body, query: {} }); native.endRequest(); return r; };
const ADMIN = '785223211730075709';
const mode = (preset) => call('POST', 'admin-preset', { discordId: ADMIN, action: 'apply', preset });
const vac = (action, more = {}, userId = 1) => call('POST', 'vacation', { userId, action, ...more }).json;
const user = (id) => store.get('Users', id);
const [u1, u2] = store.getAll('Users');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('regles : seulement dans leur mode, sauf ajout a la main (une, ou toutes en Chaos)', () => {
  mode('medium');
  assert.equal(moderules.ruleOn(store, 'chill.beachDig'), false);
  assert.equal(vac('beach-dig', { tile: 0 }, u1.id).error, 'wrong_mode');
  const rules = (body) => call('POST', 'admin-mode-rules', { discordId: ADMIN, ...body }).json;
  rules({ action: 'also', key: 'chill.beachDig', mode: 'medium', on: true });
  assert.equal(moderules.ruleOn(store, 'chill.beachDig'), true, 'ajoutee au Medium');
  assert.ok(moderules.publicRules(store).rules.some((r) => r.key === 'chill.beachDig' && r.from === 'chill'));
  rules({ action: 'also', key: 'chill.beachDig', mode: 'medium', on: false });
  assert.equal(moderules.ruleOn(store, 'chill.beachDig'), false);
  assert.equal(call('POST', 'admin-mode-rules', { discordId: ADMIN, action: 'also', key: 'chill.beachDig', mode: 'chill', on: true }).json.error, 'unknown_mode', 'deja son mode');
  // Chaos : toutes les regles de tous les modes.
  mode('chaos');
  assert.equal(moderules.ruleOn(store, 'hard.cursed'), false);
  rules({ action: 'everywhere', mode: 'chaos', on: true });
  for (const k of ['cool.wishbox', 'chill.tides', 'medium.stock', 'hard.cursed', 'chaos.vote']) assert.equal(moderules.ruleOn(store, k), true, k);
  const st = rules({ action: 'status' });
  assert.ok(st.modes.find((m) => m.key === 'chill').rules.every((r) => r.also.includes('chaos')));
  rules({ action: 'everywhere', mode: 'chaos', on: false });
  assert.equal(moderules.ruleOn(store, 'hard.cursed'), false);
  // Une regle desactivee ne joue nulle part.
  mode('chill');
  rules({ action: 'set', key: 'chill.tides', on: false });
  assert.equal(moderules.ruleOn(store, 'chill.tides'), false);
  rules({ action: 'set', key: 'chill.tides', on: true });
  assert.ok(moderules.RULE['chill.sandcastle'].url, 'chaque regle dit ou la jouer');
});

await test('plage : sable et coquillages, chateau personnel, chateau commun', () => {
  mode('chill');
  store.update('Users', u1.id, { BeachDig: JSON.stringify({ day: parisDay(0), chest: 15, dug: {}, left: 5, found: false }), Sand: 0, Shells: 0, Castle: '', KeyCount: 0 });
  vac('beach-dig', { tile: 0 }, u1.id);
  assert.ok(user(u1.id).Sand >= 2 && user(u1.id).Sand <= 5);
  vac('beach-dig', { tile: 15 }, u1.id);
  assert.ok(user(u1.id).Sand >= 12, 'le coffre donne 10 sable');
  assert.equal(JSON.parse(user(u1.id).VacStats).chests, 1);
  // Chateau : couts et recompenses par etage.
  store.update('Users', u1.id, { Sand: 300, Shells: 30, StardustCount: 0 });
  assert.equal(vac('status', {}, u1.id).castle.level, 0);
  for (let i = 0; i < 6; i++) assert.ok(vac('castle-build', {}, u1.id).toast);
  assert.equal(vac('castle-build', {}, u1.id).error, 'castle_done');
  assert.equal(user(u1.id).Sand, 300 - (10 + 20 + 30 + 45 + 60 + 80));
  assert.equal(user(u1.id).Shells, 30 - (2 + 4 + 6 + 10));
  assert.ok(store.getAll('UserCosmetics').some((c) => c.Key === 'batisseur-sable' && (Array.isArray(c.User) ? c.User[1] : c.User) === u1.id), 'titre du batisseur');
  store.update('Users', u1.id, { Sand: 0 });
  assert.equal(vac('castle-build', {}, u1.id).error, 'castle_done');
  // Chateau commun : un etage recompense tous les participants.
  store.getAll('AppSettings').filter((r) => r.Key === 'shared-castle').forEach((r) => store.delete('AppSettings', r.id));
  store.update('Users', u1.id, { Sand: 500, StardustCount: 0 });
  store.update('Users', u2.id, { Sand: 500, StardustCount: 0 });
  const goal = vac('status', {}, u1.id).sharedCastle.goal;
  vac('castle-donate', { n: 1 }, u2.id);
  const d2 = user(u2.id).StardustCount; // apres ses propres bonus de connexion
  assert.equal(vac('castle-donate', { n: 9999 }, u1.id).error, 'not_enough_sand');
  vac('castle-donate', { n: goal }, u1.id);
  assert.equal(vac('status', {}, u1.id).sharedCastle.floors, 1);
  assert.equal(user(u2.id).StardustCount, d2 + 40, 'le petit participant est recompense aussi');
});

await test('lagon : marees, poissons, coquillages a maree basse, fragments engloutis', () => {
  mode('chill');
  const tide = vacation.tideState(store);
  assert.ok(['high', 'low'].includes(tide.phase) && tide.changeIn > 0 && tide.changeIn <= 3 * 3600);
  store.update('Users', u1.id, { BeachFishDay: '', ShellBook: '{}', Shells: 0, SeaLore: '[]' });
  const r = vac('beach-fish', {}, u1.id);
  assert.equal(r.catches.length, 3);
  if (tide.phase === 'low') assert.equal(user(u1.id).Shells, r.shells.length);
  else assert.equal(r.shells.length, 0, 'pas de coquillage a maree haute');
  assert.equal(vac('beach-fish', {}, u1.id).error, 'already_used');
});

await test('carnet exotique : complet = recompense une fois ; titres de vacances', () => {
  mode('chill');
  const all = (list, n = 1) => JSON.stringify(Object.fromEntries(list.map((x) => [x.key, n])));
  store.update('Users', u1.id, { ExoticFish: JSON.stringify(Object.fromEntries(vacation.EXOTIC.map((f) => [f.key, { count: 1, best: 10 }]))), ShellBook: all(vacation.SHELLS), SeaLore: JSON.stringify(vacation.SEA_LORE.map((_, i) => i)), BookClaims: '[]', StardustCount: 0 });
  const book = vac('status', {}, u1.id).book;
  assert.ok(book.sections.every((s) => s.have === s.size && !s.claimed));
  for (const s of ['fish', 'shells', 'lore']) assert.ok(vac('book-claim', { section: s }, u1.id).toast, s);
  assert.equal(user(u1.id).StardustCount, 700);
  assert.equal(vac('book-claim', { section: 'fish' }, u1.id).error, 'already_claimed');
  store.update('Users', u2.id, { BookClaims: '[]', ExoticFish: '{}' });
  assert.equal(vac('book-claim', { section: 'fish' }, u2.id).error, 'book_incomplete');
  // Maitre du bar : 10 cocktails (evenement cook avec la recette).
  store.update('Users', u2.id, { VacStats: '{}' });
  for (let i = 0; i < 10; i++) vacation.onEvents(store, [{ userId: u2.id, type: 'cook', n: 1, meta: { recipe: 'mojito' } }]);
  vacation.onEvents(store, [{ userId: u2.id, type: 'cook', n: 1, meta: { recipe: 'soupe' } }]);
  assert.equal(JSON.parse(user(u2.id).VacStats).cocktails, 10, 'la soupe ne compte pas');
  assert.ok(store.getAll('UserCosmetics').some((c) => c.Key === 'maitre-bar'));
});

await test('promenade a la plage : seulement quand la regle joue', () => {
  mode('chill');
  const walk = (b = {}) => call('POST', 'walk', { userId: u1.id, ...b }).json;
  assert.ok(walk().places.some((p) => p.key === 'plage'));
  mode('medium');
  assert.ok(!walk().places.some((p) => p.key === 'plage'));
});

await test('amis : ajout, refus, retrait ; seulement en Chill', () => {
  mode('chill');
  const fr = (body, id = u1.id) => call('POST', 'friends', { userId: id, ...body }).json;
  store.update('Users', u1.id, { Friends: '[]' });
  assert.equal(fr({ action: 'add', pseudo: user(u1.id).Pseudo }).error, 'unknown_target');
  assert.equal(fr({ action: 'add', pseudo: user(u2.id).Pseudo.toUpperCase() }).friends[0].userId, u2.id);
  assert.equal(fr({ action: 'add', pseudo: user(u2.id).Pseudo }).error, 'already_friend');
  assert.equal(fr({ action: 'remove', friendId: u2.id }).friends.length, 0);
  mode('medium');
  assert.equal(fr({ action: 'status' }).enabled, false);
  assert.equal(fr({ action: 'add', pseudo: user(u2.id).Pseudo }).error, 'wrong_mode');
});

await test('carte du mode : le statut de l objectif commun dit comment l avoir', () => {
  mode('chill');
  const card = store.getAll('Cards').find((c) => c.Active);
  call('POST', 'admin-settings', { discordId: ADMIN, action: 'set', values: { ModeCards: { cool: 0, chill: card.id, medium: 0, hard: 0 } } });
  const g = call('POST', 'community-goal', { userId: u1.id }).json;
  assert.equal(g.modeCard.cardId, card.id);
  assert.equal(g.modeCard.owned, false);
  assert.ok('mine' in g && 'reached' in g && 'claimed' in g);
  call('POST', 'admin-settings', { discordId: ADMIN, action: 'reset', key: 'ModeCards' });
});

await test('sante : reservee aux admins, chiffres du serveur', () => {
  assert.equal(call('POST', 'admin-health', { discordId: 'x' }).status, 403);
  const h = call('POST', 'admin-health', { discordId: ADMIN }).json;
  assert.ok(h.requests && h.errors && h.discord && h.data.players > 0 && h.mode);
});

await test('vignettes : gardees a part, effacees si l image change', () => {
  const id = store.nextAttachmentId();
  store.putAttachment(id, 'a.png', 'image/png', Buffer.from('grande'));
  assert.equal(store.getThumb(id), null);
  assert.equal(store.putThumb(id, 'image/webp', Buffer.from('petite')), true);
  assert.equal(Buffer.from(store.getThumb(id).data).toString(), 'petite');
  assert.equal(store.listAttachments().find((a) => a.id === id).hasThumb, 1);
  store.putAttachment(id, 'a.png', 'image/png', Buffer.from('nouvelle'));
  assert.equal(store.getThumb(id), null, 'nouvelle image : vignette a refaire');
  assert.equal(store.putThumb(999999, 'image/webp', Buffer.from('x')), false);
});

await test('sauvegarde JSON planifiee : fichier complet, les plus anciens supprimes', async () => {
  const jb = createJsonBackups({ store, dbPath: tmp, withLock: (fn) => fn(), writeSave, days: () => 0, keep: () => 2, log: { log() {}, error() {} } });
  for (let i = 0; i < 3; i++) { await jb.run(); await new Promise((r) => setTimeout(r, 1100)); }
  const files = jb.list();
  assert.equal(files.length, 2);
  const zlib = await import('node:zlib');
  const save = JSON.parse(zlib.gunzipSync(fs.readFileSync(jb.fileOf(files[0].name))).toString());
  assert.equal(save.format, '2gatcha-save');
  assert.ok(save.tables.Users.rows.length > 0);
  assert.equal(jb.fileOf('../base.sqlite'), null, 'pas de chemin arbitraire');
});

await test('kiosque de la plage : en vente seulement quand la regle joue, citrouille retiree', () => {
  const shop = () => call('POST', 'cosmetics', { userId: u1.id }).json.shop;
  mode('chill');
  const items = shop().filter((c) => c.rule === 'chill.vacationShop');
  assert.equal(items.length, 10);
  assert.ok(!shop().some((c) => c.key === 'frame-citrouille'), 'Halloween fini');
  store.update('Users', u1.id, { StardustCount: 5000 });
  assert.equal(call('POST', 'cosmetics', { userId: u1.id, action: 'buy', key: 'title-sieste' }).json.bought, 'title-sieste');
  mode('medium');
  assert.ok(!shop().some((c) => c.rule), 'plus en vente hors Chill');
  assert.equal(call('POST', 'cosmetics', { userId: u1.id, action: 'buy', key: 'frame-lagon' }).json.error, 'unknown_item');
  assert.ok(call('POST', 'cosmetics', { userId: u1.id }).json.earned.some((c) => c.key === 'title-sieste'), 'garde ce qui est achete');
  // L'editeur garde la regle d'un objet modifie.
  const save = call('POST', 'admin-cosmetics', { discordId: ADMIN, action: 'save', item: { key: 'title-surfeur', type: 'title', label: 'Surfeur', price: 950 } }).json;
  assert.equal(save.items.find((c) => c.key === 'title-surfeur').rule, 'chill.vacationShop');
});

store.db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${passed} tests du lot Chill du 2 novembre ok`);
process.exit(process.exitCode || 0);
