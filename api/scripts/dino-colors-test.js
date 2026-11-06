// Tests 2026-11-06 : couleurs rares des dinos (garantie DinoColorPity,
// mutation des oeufs DinoEggMutation). Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-dinocolors-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const post = (p, body) => { native.beforeRequest(body, {}, p); const r = native.run('POST', p, { body, query: {} }); native.endRequest(); return r; };
const user = store.create('Users', { Pseudo: 'Dinos', DiscordId: '991106', BoosterCount: 0, StardustCount: 0, XP: 0 });
const get = () => store.get('Users', user.id);
const dex = () => JSON.parse(get().DinoDex || '{}');
// Toutes les couleurs sauf obsidienne et fossile deja trouvees (le cas du ticket).
const seed = () => store.update('Users', user.id, { Dinos: '[]', DinoColorPity: 0, DinoSkulls: 100, BoneCount: 10000,
  DinoDex: JSON.stringify({ species: {}, patterns: {}, colors: { albino: 1, gold: 1, chroma: 1 }, stages: {}, claimed: [] }) });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}
const realRandom = Math.random;

await test('garantie : au plus 15 eclosions de crane pour une couleur manquante', () => {
  seed();
  Math.random = () => 0.99; // aucun tirage chanceux : seule la garantie joue
  try {
    for (let i = 1; i <= 15; i++) {
      store.update('Users', user.id, { Dinos: '[]' });
      const r = post('dino', { userId: user.id, action: 'hatch' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      if (i < 15) assert.equal(get().DinoColorPity, i);
    }
  } finally { Math.random = realRandom; }
  const colors = dex().colors;
  assert.ok(colors.obsidian || colors.fossil, 'une couleur manquante obtenue');
  assert.equal(get().DinoColorPity, 0);
  const st = post('dino', { userId: user.id, action: 'status' });
  assert.equal(st.json.dex.colorPityLeft, 15, 'compteur repart pour la derniere couleur');
});

await test('mutation : un oeuf peut sortir d une couleur jamais obtenue', () => {
  seed();
  const egg = { id: 1, hatchAt: 0, genes: { species: 'rex', hue: 10, pattern: null, shiny: false, color: null, fromEgg: true } };
  store.update('Users', user.id, { DinoEggs: JSON.stringify([egg]) });
  Math.random = () => 0; // sous les 3 % de DinoEggMutation
  let r;
  try { r = post('dino', { userId: user.id, action: 'hatchEgg', egg: 1 }); } finally { Math.random = realRandom; }
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(['obsidian', 'fossil'].includes(r.json.hatched.color), 'couleur mutee : ' + r.json.hatched.color);
  assert.equal(get().DinoColorPity, 0, 'un oeuf ne touche pas au compteur');
});

store.db.close();
clean();
console.log(`${passed} test(s) ok`);
