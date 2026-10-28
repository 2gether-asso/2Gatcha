// Tests du lot 2026-10-30 : « Ouvrir tous les coffres » (une ouverture, les
// plus beaux paliers d'abord si les clefs manquent) et migration de
// l'endurance d'archeologie. Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-1030-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

// Endurance personnalisee a 700 avant le demarrage : la migration la ramene a 450.
{
  const pre = new Store(tmp, { lenient: true });
  const row = pre.getAll('AppSettings').find((r) => r.Key === 'setting:ArcheoStrokes');
  if (row) pre.update('AppSettings', row.id, { Value: '700' }); else pre.create('AppSettings', { Key: 'setting:ArcheoStrokes', Value: '700' });
  for (const r of pre.getAll('AppSettings').filter((x) => x.Key === 'balance-archeo-2026-10-30')) pre.delete('AppSettings', r.id);
  pre.db.close();
}
const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const post = (p, body) => { native.beforeRequest(body, {}, p); const r = native.run('POST', p, { body, query: {} }); native.endRequest(); return r; };
const user = store.create('Users', { Pseudo: 'Coffres', DiscordId: '990301', BoosterCount: 0, StardustCount: 0, XP: 0, KeyCount: 4, ChestBalls: JSON.stringify([1, 1, 2, 8, 5, 7]) });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('ouvrir tous les coffres : une ouverture, meilleurs paliers d abord', () => {
  const r = post('chests', { userId: user.id, action: 'open', all: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.opened, 4);
  assert.deepEqual(r.json.openedTiers.map((t) => t.tier), [8, 7, 5, 2]);
  const u = store.get('Users', user.id);
  // 4 clefs depensees ; un bonus de coffre peut en rendre.
  const bonusKeys = (r.json.extras || []).filter((x) => x.key === 'key').reduce((a, x) => a + x.amount, 0);
  assert.equal(Number(u.KeyCount), bonusKeys);
  assert.deepEqual(JSON.parse(u.ChestBalls), [1, 1]);
  assert.ok(r.json.items.some((i) => i.type === 'dust'));
});

await test('ouvrir tous les coffres : sans clef ou sans boule', () => {
  store.update('Users', user.id, { KeyCount: 0 });
  assert.equal(post('chests', { userId: user.id, action: 'open', all: true }).json.error, 'no_key');
  store.update('Users', user.id, { KeyCount: 3, ChestBalls: '[]' });
  assert.equal(post('chests', { userId: user.id, action: 'open', all: true }).json.error, 'no_ball');
});

await test('archeologie : endurance personnalisee ramenee a 450, une seule fois', () => {
  const row = store.getAll('AppSettings').find((r) => r.Key === 'setting:ArcheoStrokes');
  assert.equal(JSON.parse(row.Value), 450);
  assert.ok(store.getAll('AppSettings').some((r) => r.Key === 'balance-archeo-2026-10-30'));
});

store.db.close();
clean();
console.log(`${passed} test(s) ok`);
