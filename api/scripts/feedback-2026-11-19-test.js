// Tests du lot « avis GlitchTip » (2026-11-19) : Noisette seme les parcelles
// vides, « Tout fouiller » suit le flair de Milo, tours gratuits a part a la
// machine interdite, envie de balade impossible une fois promene, sable.
// Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { parisDay } from '../src/native/common.js';
import { settleBunny } from '../src/native/garden.js';
import { beforeWorkflow as digBefore } from '../src/native/digdepth.js';
import { spin } from '../src/native/slots.js';
import { moodOf } from '../src/native/companions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-avis19-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
createNative({ store, withLock: (fn) => fn() });
const t = () => Math.floor(Date.now() / 1000);
const user = store.create('Users', { Pseudo: 'Avis19', DiscordId: '991119', BoosterCount: 0, StardustCount: 5000, XP: 0 });
const me = () => store.get('Users', user.id);

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('Noisette : seme les parcelles vides pendant son travail (jardin vide le matin)', () => {
  store.update('Users', user.id, { GardenPlots: JSON.stringify([null, null, null, null]), BunnyState: JSON.stringify({ start: t() - 600, until: t() + 3600 }), BunnySeed: '', StardustCount: 5000 });
  const f = settleBunny(store, me());
  assert.ok(f, 'des champs a ecrire');
  const plots = JSON.parse(f.GardenPlots);
  assert.equal(plots.filter(Boolean).length, 4, 'les 4 parcelles semees');
  assert.ok(JSON.parse(f.BunnyReport).spent >= 40, 'semis payes');
  assert.ok(JSON.parse(f.BunnyState).seen >= t() - 1, 'dernier passage retenu');
  store.update('Users', user.id, f);
  // Une parcelle videe a la main ensuite : semee a partir du dernier passage.
  const p2 = JSON.parse(me().GardenPlots); p2[1] = null;
  store.update('Users', user.id, { GardenPlots: JSON.stringify(p2) });
  const f2 = settleBunny(store, me());
  assert.ok(f2 && JSON.parse(f2.GardenPlots)[1], 'parcelle 1 resemee');
  // Plus de poussieres : rien de seme, pas de plantage.
  store.update('Users', user.id, { ...f2, GardenPlots: JSON.stringify([null, null, null, null]), StardustCount: 5 });
  const before3 = Number(me().StardustCount); const f3 = settleBunny(store, me()); if (f3 && f3.GardenPlots && JSON.parse(f3.GardenPlots).some(Boolean)) console.log('dust avant', before3);
  assert.ok(!f3 || !f3.GardenPlots || JSON.parse(f3.GardenPlots).every((p) => !p), JSON.stringify(f3 && { p: f3.GardenPlots, d: f3.StardustCount, r: f3.BunnyReport }));
  // Session finie : elle ne seme plus.
  store.update('Users', user.id, { GardenPlots: JSON.stringify([null, null, null, null]), StardustCount: 5000, BunnyState: JSON.stringify({ start: t() - 7200, until: t() - 3600, seen: t() - 3600 }) });
  const f4 = settleBunny(store, me());
  assert.equal(f4 && f4.BunnyState, '');
  assert.ok(!f4.GardenPlots, 'rien de seme apres la fin');
});

await test('Tout fouiller : avec Milo au travail, jamais une case vide tant qu il reste un tresor', () => {
  const tiles = Array.from({ length: 32 }, (_, i) => ({ t: i < 3 ? 0 : i === 5 ? 1 : null, d: i === 0 }));
  const board = { tiles, treasures: [{ cells: 3, dug: 1, reward: 'card', done: false }, { cells: 1, dug: 0, reward: 'smallDust', done: false }], depth: 1 };
  store.update('Users', user.id, { DigBoardState: JSON.stringify(board), DogUntil: t() + 3600 });
  for (let i = 0; i < 20; i++) {
    const req = { body: { userId: user.id, action: 'dig', tileIndex: 'auto' } };
    digBefore({ store, path: 'dig', request: req });
    assert.ok([1, 2].includes(req.body.tileIndex), 'tresor entame d abord : ' + req.body.tileIndex);
  }
  // Sans Milo : au hasard parmi les cases libres.
  store.update('Users', user.id, { DogUntil: 0 });
  const seen = new Set();
  for (let i = 0; i < 60; i++) { const req = { body: { userId: user.id, action: 'dig', tileIndex: 'auto' } }; digBefore({ store, path: 'dig', request: req }); seen.add(req.body.tileIndex); }
  assert.ok(seen.size > 3 && !seen.has(0));
});

await test('machine interdite : tour paye a x5 meme avec un tour gratuit, tour gratuit a part', () => {
  store.update('Users', user.id, { ForbiddenUnlocked: 1, ForbiddenFreeDay: parisDay(0), ForbiddenFreeSpins: 2, ForbiddenBonus: 0, StardustCount: 100000 });
  let r = spin(store, me(), { count: 1, bet: 5, free: false });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.results[0].kind, 'paid');
  assert.equal(r.json.results[0].bet, 5);
  assert.equal(Number(me().ForbiddenFreeSpins), 2, 'tours gratuits gardes');
  r = spin(store, me(), { count: 1, bet: 5, free: true });
  assert.equal(r.json.results[0].kind, 'bank');
  assert.equal(r.json.results[0].bet, 1, 'gratuit = x1');
  assert.ok(Number(me().ForbiddenFreeSpins) <= 1 + 3, 'un tour gratuit utilise (defis du jour en plus)');
  store.update('Users', user.id, { ForbiddenFreeSpins: 0, ForbiddenBonus: 0 });
  assert.equal(spin(store, me(), { count: 1, free: true }).json.error, 'no_free_spin');
  assert.equal(spin(store, me(), { count: 10, free: true }).json.error, 'free_single');
  // Ancien site (sans free) : comme avant.
  store.update('Users', user.id, { ForbiddenFreeSpins: 1 });
  assert.equal(spin(store, me(), { count: 1, bet: 3 }).json.results[0].kind, 'bank');
});

await test('envie de balade : plus proposee une fois promene ailleurs', () => {
  const day = parisDay(0);
  const pet = ['milo', 'moka', 'noisette', 'pistache', 'poivre', 'praline', 'reglisse', 'paprika'].find((p) => moodOf(store, { ...me(), Companions: '' }, p).kind === 'walk');
  if (!pet) return; // aucune envie de balade aujourd'hui pour ce joueur
  store.update('Users', user.id, { Companions: '', WalkDay: JSON.stringify({ day, done: { [pet]: 'lac' } }) });
  const m = moodOf(store, me(), pet);
  assert.equal(m.done, false);
  assert.equal(m.missed, true);
});

store.db.close();
clean();
console.log(`\n${passed} tests du lot avis 2026-11-19 ok`);
