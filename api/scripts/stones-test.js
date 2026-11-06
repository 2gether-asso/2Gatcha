// Tests des pierres de la salle interdite (2026-11-06) : incrustations des
// rouleaux, joker, geode, forge interdite, sertissage, Coeur de la salle.
// Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { MINERALS } from '../src/native/digdepth.js';
import * as stones from '../src/native/stones.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2gatcha-stones-'));
const tmp = path.join(dir, 'base.sqlite');
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const call = (method, p, body = {}) => { native.beforeRequest(body, {}, p); const r = native.run(method, p, { body, query: {} }); native.endRequest(); return r; };
const fb = (body, userId = u1.id) => call('POST', 'forbidden', { userId, ...body });
const user = (id) => store.get('Users', id);
const [u1, u2] = store.getAll('Users');
const minerals = (id) => JSON.parse(user(id).Minerals || '{}');
const giveAll = (id, n) => store.update('Users', id, { Minerals: JSON.stringify(Object.fromEntries(MINERALS.map((m) => [m.key, n]))) });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

store.update('Users', u1.id, { ForbiddenAccess: 1, ForbiddenUnlocked: 1, StardustCount: 1e7, ForbiddenFreeDay: 'x' });
giveAll(u1.id, 50);

await test('porte fermee : les actions des pierres sont refusees', () => {
  store.update('Users', u2.id, { ForbiddenAccess: 1 });
  for (const action of ['atelier', 'feed', 'inlay', 'forge']) assert.equal(fb({ action, key: 'fer', reel: 0 }, u2.id).json.error, 'locked', action);
});

await test('incrustation : sertir, cumuler, remplacer, charges usees par les tours', () => {
  let r = fb({ action: 'inlay', reel: 0, key: 'agathe', count: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.inlaid.spins, 30, '2 x 15 tours');
  assert.equal(minerals(u1.id).agathe, 48);
  r = fb({ action: 'inlay', reel: 0, key: 'agathe', count: 1 });
  assert.equal(r.json.inlaid.left, 45, 'le meme mineral s ajoute');
  r = fb({ action: 'inlay', reel: 0, key: 'fer', count: 1 });
  assert.equal(r.json.inlaid.replaced, 'Agathe');
  assert.equal(r.json.machine.inlays[0].key, 'fer');
  assert.equal(fb({ action: 'inlay', reel: 7, key: 'fer' }).json.error, 'invalid_reel');
  assert.equal(fb({ action: 'inlay', reel: 1, key: 'fer', count: 999 }).json.error, 'not_enough_minerals');
  r = fb({ action: 'spin', count: 10 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.machine.inlays[0].left, 5, '10 charges usees');
  r = fb({ action: 'spin', count: 10 });
  assert.equal(r.json.machine.inlays[0], null, 'epuisee');
  assert.ok(r.json.notices.some((n) => /épuisée/.test(n.text)));
});

await test('obsidienne : relance gratuite ; rubis : jokers sur le rouleau', () => {
  let r = fb({ action: 'inlay', reel: 1, key: 'obsidienne', count: 1 });
  assert.equal(r.json.machine.nudgeCost, 0);
  r = fb({ action: 'inlay', reel: 2, key: 'rubis', count: 3 });
  assert.ok(r.json.machine.symbols.some((s) => s.key === 'joker'));
  let jokers = 0;
  for (let i = 0; i < 15; i++) {
    r = fb({ action: 'spin', count: 10 });
    for (const x of r.json.results) {
      if (x.window[0].includes('joker') || x.window[1].includes('joker')) assert.fail('joker hors du rouleau serti');
      if (x.line[2] === 'joker') { jokers++; assert.notEqual(x.tier, 'none', 'un joker sur la ligne fait au moins une paire : ' + x.line.join(',')); }
    }
  }
  assert.ok(jokers > 0, 'au moins un joker en 150 tours');
});

await test('Coeur : points, paliers, recompenses', () => {
  store.update('Users', u1.id, { ForbiddenInlays: '[]' });
  let r = fb({ action: 'heart' });
  assert.equal(r.json.heart.level, 0);
  const spins = user(u1.id).ForbiddenFreeSpins || 0;
  r = fb({ action: 'feed', key: 'rubis', count: 2 });
  assert.equal(r.json.fed.points, 120);
  assert.equal(r.json.heart.level, 1);
  assert.equal(user(u1.id).ForbiddenFreeSpins, spins + 3);
  assert.ok(store.getAll('UserCosmetics').some((c) => c.Key === 'title-coeur-pierre' && c.User === u1.id));
  assert.equal(fb({ action: 'feed', key: 'rubis', count: 999 }).json.error, 'not_enough_minerals');
  // Palier 2 : incrustations +50 %.
  r = fb({ action: 'feed', key: 'diamant', count: 'all' });
  assert.equal(minerals(u1.id).diamant, 0);
  assert.ok(r.json.heart.level >= 3, 'palier ' + r.json.heart.level);
  r = fb({ action: 'inlay', reel: 0, key: 'agathe', count: 1 });
  assert.equal(r.json.inlaid.spins, 23, '15 x 1,5');
  // Palier 3 : la geode apparait sur la machine.
  assert.ok(fb({ action: 'status' }).json.machine.symbols.some((s) => s.key === 'geode'));
});

await test('geode : des mineraux credites', () => {
  const before = Object.values(minerals(u1.id)).reduce((s, n) => s + n, 0);
  let got = 0;
  for (let i = 0; i < 150 && !got; i++) {
    const r = fb({ action: 'spin', count: 10 });
    got += r.json.results.flatMap((x) => [x, ...x.cascades]).reduce((s, x) => s + x.minerals.reduce((a, m) => a + m.n, 0), 0);
  }
  assert.ok(got > 0, 'au moins une geode en 1500 tours');
  const after = Object.values(minerals(u1.id)).reduce((s, n) => s + n, 0);
  assert.ok(after >= before + got - 1, `mineraux credites (${before} -> ${after}, +${got})`);
});

await test('forge interdite : echec = fissure, reussite = edition Interdite au decraft normal', () => {
  giveAll(u1.id, 200);
  store.update('Users', u1.id, { ForbiddenHeart: 0 });
  let at = fb({ action: 'atelier' }).json;
  const g = at.forge.cards[0];
  assert.ok(g && g.cost >= 3, JSON.stringify(g));
  // Chance nulle : echec garanti.
  call('POST', 'admin-settings', { discordId: '785223211730075709', action: 'set', values: { ForbiddenForgeChance: [0, 0, 0, 0, 0], ForbiddenForgeCrackBonus: 0 } });
  const heartBonus = at.forge.heartBonus;
  let r = fb({ action: 'forge', pullId: g.pullId, tier: 1 });
  assert.equal(heartBonus, 0);
  assert.equal(r.json.result.success, false);
  assert.equal(store.get('Pulls', g.pullId).ForgeCracks, 1);
  call('POST', 'admin-settings', { discordId: '785223211730075709', action: 'set', values: { ForbiddenForgeChance: [1, 1, 1, 1, 1] } });
  const p = store.getAll('Pulls').find((x) => x.User === u1.id && !x.Edition && !x.InVault);
  const t1 = MINERALS.filter((m) => m.tier === 1).reduce((s, m) => s + minerals(u1.id)[m.key], 0);
  r = fb({ action: 'forge', pullId: p.id, tier: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.result.success, true);
  assert.equal(store.get('Pulls', p.id).Edition, 'forbidden');
  assert.equal(store.get('Pulls', p.id).ForbiddenForged, 1);
  assert.equal(MINERALS.filter((m) => m.tier === 1).reduce((s, m) => s + minerals(u1.id)[m.key], 0), t1 - r.json.result.cost);
  assert.equal(fb({ action: 'forge', pullId: p.id, tier: 1 }).json.error, 'not_forgeable', 'deja en edition');
  const other = store.getAll('Pulls').find((x) => x.User === u2.id);
  if (other) assert.equal(fb({ action: 'forge', pullId: other.id, tier: 1 }).json.error, 'not_forgeable', 'carte d un autre');
  // Collection : la carte forgee est signalee.
  const res = { status: 200, json: {} };
  stones.afterWorkflow({ store, path: 'collection', request: { query: { userId: u1.id } }, response: res });
  assert.ok(res.json.forgedForbiddenPullIds.includes(p.id));
});

await test('sertissage : seulement sur une Interdite, meme pierre refusee, badge dans la collection', () => {
  const p = store.getAll('Pulls').find((x) => x.User === u1.id && x.Edition === 'forbidden');
  const plain = store.getAll('Pulls').find((x) => x.User === u1.id && !x.Edition);
  assert.equal(fb({ action: 'gem', pullId: plain.id, key: 'rubis' }).json.error, 'not_forbidden_copy');
  const before = minerals(u1.id).saphir;
  let r = fb({ action: 'gem', pullId: p.id, key: 'saphir' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(store.get('Pulls', p.id).Gem, 'saphir');
  assert.equal(minerals(u1.id).saphir, before - 3);
  assert.equal(fb({ action: 'gem', pullId: p.id, key: 'saphir' }).json.error, 'same_gem');
  r = fb({ action: 'gem', pullId: p.id, key: 'grenat' });
  assert.equal(r.json.set.replaced, 'saphir');
  const at = fb({ action: 'atelier' }).json;
  assert.ok(at.gems.cards.some((c) => c.gem === 'grenat'));
  const res = { status: 200, json: {} };
  stones.afterWorkflow({ store, path: 'collection', request: { query: { userId: u1.id } }, response: res });
  assert.equal(res.json.gemPulls[p.id], 'grenat');
  assert.equal(res.json.gemInfo.grenat.name, 'Grenat');
});

await test('transmutation : Or -> Dore, Diamant -> Diamant, meme exemplaire', () => {
  giveAll(u1.id, 100);
  const rar = (p) => store.get('Rarities', store.get('Cards', p.Card).Rarity);
  const p = store.getAll('Pulls').find((x) => x.User === u1.id && (x.Finish || 'normal') === 'normal' && !x.InVault && rar(x).Key !== 'unique' && !store.get('Cards', x.Card).IsPromo);
  const before = { serial: p.SerialNumber, quality: p.Quality };
  let r = fb({ action: 'transmute', pullId: p.id, to: 'gold' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const cost = r.json.transmuted.cost;
  assert.equal(store.get('Pulls', p.id).Finish, 'gold');
  assert.equal(store.get('Pulls', p.id).SerialNumber, before.serial);
  assert.equal(store.get('Pulls', p.id).Quality, before.quality);
  assert.equal(minerals(u1.id).or, 100 - cost);
  assert.equal(fb({ action: 'transmute', pullId: p.id, to: 'gold' }).json.error, 'not_lower_finish');
  r = fb({ action: 'transmute', pullId: p.id, to: 'diamond' });
  assert.equal(store.get('Pulls', p.id).Finish, 'diamond');
  assert.equal(fb({ action: 'transmute', pullId: p.id, to: 'rainbow' }).json.error, 'invalid_finish');
  store.update('Users', u1.id, { Minerals: JSON.stringify({ or: 0 }) });
  const q = store.getAll('Pulls').find((x) => x.User === u1.id && (x.Finish || 'normal') === 'normal' && !x.InVault && rar(x).Key !== 'unique' && !store.get('Cards', x.Card).IsPromo);
  assert.equal(fb({ action: 'transmute', pullId: q.id, to: 'gold' }).json.error, 'not_enough_minerals');
  // Collection : prix seulement porte ouverte.
  const res = { status: 200, json: {} };
  stones.afterWorkflow({ store, path: 'collection', request: { query: { userId: u1.id } }, response: res });
  assert.ok(res.json.transmute && res.json.transmute.gold.costs);
  const res2 = { status: 200, json: {} };
  stones.afterWorkflow({ store, path: 'collection', request: { query: { userId: u2.id } }, response: res2 });
  assert.equal(res2.json.transmute, undefined, 'rien sans la porte');
  assert.equal(fb({ action: 'transmute', pullId: q.id, to: 'gold' }, u2.id).json.error, 'locked');
});

await test('reglages : validation', () => {
  const bad = call('POST', 'admin-settings', { discordId: '785223211730075709', action: 'set', values: { ForbiddenHeartSteps: [100, 50, 800, 2000, 5000, 12000] } });
  assert.notEqual(bad.status, 200, 'paliers non croissants refuses');
});

console.log(`\n${passed} tests ok`);
