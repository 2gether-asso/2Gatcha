// Tests de l'heritage des comptes supprimes (2026-11-11) : suppression depuis
// Tout voir -> cartes et ressources reparties, traces nettoyees, message aux
// heritiers, annulation ; passe periodique pour un compte supprime ailleurs.
// Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { now, refId } from '../src/native/common.js';
import * as legacy from '../src/native/legacy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-legacy-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const call = (method, p, args) => { native.beforeRequest(args.body || {}, args.query || {}, p); const r = native.run(method, p, args); native.endRequest(); return r; };
const post = (p, body) => call('POST', p, { body });
const ADMIN = '785223211730075709';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

const card = store.getAll('Cards').find((c) => c.Active);
const mkUser = (pseudo, extra = {}) => store.create('Users', { Pseudo: pseudo, DiscordId: String(880000 + Math.floor(Math.random() * 9999)), BoosterCount: 0, StardustCount: 0, XP: 0, CreatedAt: now(), ...extra });
const mkPulls = (u, n) => Array.from({ length: n }, (_, i) => store.create('Pulls', { User: u.id, Card: card.id, SerialNumber: 9000 + i, Finish: 'holo', Quality: 'mint', ObtainedAt: now() - 100, InVault: i === 0, Starred: true }));
const total = (field) => store.getAll('Users').reduce((s, u) => s + (Number(u[field]) || 0), 0);
const mine = (id) => store.getAll('Pulls').filter((p) => refId(p.User) === id);

test('suppression depuis Tout voir : cartes et ressources reparties', () => {
  const dead = mkUser('Partant', { BoosterCount: 7, StardustCount: 1001, KeyCount: 3 });
  const pulls = mkPulls(dead, 5);
  const wish = store.tables.has('Wishlist') ? store.create('Wishlist', { User: dead.id, Card: card.id }) : null;
  store.update('Cards', card.id, { FirstObtainedBy: dead.id });
  const heirsCount = store.getAll('Users').length - 1;
  const boosters = total('BoosterCount'), dust = total('StardustCount'), keys = total('KeyCount');
  const r = post('admin-explorer', { discordId: ADMIN, action: 'delete', table: 'Users', id: dead.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const inh = r.json.inheritance;
  assert.equal(inh.cards, 5);
  assert.equal(inh.heirs, heirsCount);
  assert.deepEqual(inh.resources, { booster: 7, dust: 1001, key: 3 });
  assert.equal(mine(dead.id).length, 0, 'plus aucun exemplaire au defunt');
  // Rien de perdu : ce qu'il avait est maintenant chez les autres.
  assert.equal(total('BoosterCount'), boosters, 'jetons booster conserves');
  assert.equal(total('StardustCount'), dust);
  assert.equal(total('KeyCount'), keys);
  for (const p of pulls) {
    const q = store.get('Pulls', p.id);
    assert.ok(store.get('Users', refId(q.User)), 'exemplaire chez un joueur vivant');
    assert.equal(q.InVault, false); assert.equal(q.Starred, false);
    assert.equal(q.Finish, 'holo'); assert.equal(q.SerialNumber, p.SerialNumber);
  }
  const owners = new Map();
  pulls.forEach((p) => { const o = refId(store.get('Pulls', p.id).User); owners.set(o, (owners.get(o) || 0) + 1); });
  assert.ok(Math.max(...owners.values()) - Math.min(...owners.values()) <= 1 || owners.size === Math.min(5, heirsCount), 'reparti a tour de role');
  if (wish) assert.equal(store.get('Wishlist', wish.id), null, 'souhait du defunt supprime');
  assert.equal(refId(store.get('Cards', card.id).FirstObtainedBy) || 0, 0, 'reference videe dans Cards, carte gardee');
  assert.deepEqual(legacy.orphanIds(store), [], 'plus aucune trace');
  const heir = refId(store.get('Pulls', pulls[0].id).User);
  assert.ok(String(store.get('Users', heir).ModeInbox).includes('hérites'), 'message a l heritier');
  assert.ok(!String(store.get('Users', heir).ModeInbox).includes('Partant'), 'defunt pas nomme');
  const log = store.getAll('Inheritances').find((x) => x.UserId === dead.id);
  assert.ok(log && log.Cards === 5);
});

test('annulation depuis le journal : compte et possessions rendus', () => {
  const dead = mkUser('Revenant', { BoosterCount: 4 });
  mkPulls(dead, 2);
  post('admin-explorer', { discordId: ADMIN, action: 'delete', table: 'Users', id: dead.id });
  assert.equal(mine(dead.id).length, 0);
  const entry = store.getAll('AdminAudit').sort((a, b) => b.id - a.id)[0];
  const r = post('admin-audit', { discordId: ADMIN, action: 'undo', id: entry.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(store.get('Users', dead.id), 'compte recree');
  assert.equal(store.get('Users', dead.id).BoosterCount, 4);
  assert.equal(mine(dead.id).length, 2, 'exemplaires rendus');
});

test('passe periodique : compte supprime ailleurs, ressources lues dans le journal sinon perdues', () => {
  const dead = mkUser('Fantome', { BoosterCount: 50 });
  mkPulls(dead, 3);
  store.delete('Users', dead.id); // comme la page Base de donnees : pas de journal
  assert.deepEqual(legacy.orphanIds(store), [dead.id]);
  const boosters = total('BoosterCount');
  const done = legacy.sweep(store);
  assert.equal(done.length, 1);
  assert.equal(done[0].cards, 3);
  assert.deepEqual(done[0].resources, {}, 'ligne introuvable : seulement les cartes');
  assert.equal(total('BoosterCount'), boosters);
  assert.equal(mine(dead.id).length, 0);
  assert.deepEqual(legacy.sweep(store), [], 'rien a refaire');
});

test('passe periodique : retrouve la ligne supprimee dans le journal de l equipe', () => {
  const dead = mkUser('Journalise', { StardustCount: 300 });
  mkPulls(dead, 1);
  // Suppression journalisee puis exemplaire ramene au compte (enchere invendue).
  post('admin-explorer', { discordId: ADMIN, action: 'delete', table: 'Users', id: dead.id });
  const p = mkPulls({ id: dead.id }, 1)[0];
  const dust = total('StardustCount');
  const done = legacy.sweep(store);
  assert.equal(done.length, 1);
  assert.equal(done[0].cards, 1);
  assert.deepEqual(done[0].resources, {}, 'ressources deja donnees une fois');
  assert.equal(total('StardustCount'), dust);
  assert.ok(store.get('Users', refId(store.get('Pulls', p.id).User)));
});

test('compte test exclu des heritiers, garde-fou si trop d orphelins', () => {
  const testId = Number((store.getAll('AppSettings').find((r) => r.Key === 'TestAccountId') || {}).Value) || 0;
  const dead = mkUser('SansTest');
  const pulls = mkPulls(dead, 30);
  store.delete('Users', dead.id);
  legacy.sweep(store);
  if (testId) assert.ok(pulls.every((p) => refId(store.get('Pulls', p.id).User) !== testId));
  for (let i = 0; i < 11; i++) store.create('Pulls', { User: 70000 + i, Card: card.id, SerialNumber: 1 });
  assert.deepEqual(legacy.sweep(store), [], 'passe annulee');
  assert.equal(store.getAll('Pulls').filter((p) => refId(p.User) >= 70000).length, 11, 'rien touche');
});

store.db.close();
clean();
console.log(`${passed} test(s) ok`);
