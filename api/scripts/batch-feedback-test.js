// Tests du lot 2026-10-29 (appels API) : lot de lectures a 64 appels, lecture
// en lot identique a l'appel seul (compte test retire), ecritures en lot
// (souhaits, echanges, vitrine, coffre), avis des joueurs (POST feedback).
// Lance le vrai serveur HTTP sur une base de selftest, aucun reseau externe.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-batchfb-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const PORT = 18000 + (process.pid % 1000);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, '..', 'src', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: tmp, AUTH_MODE: 'off', ADMIN_TOKEN: 'test', LOG_REQUESTS: '0', SENTRY_DSN: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('serveur pas demarre')), 15000);
  server.stdout.on('data', (d) => { if (String(d).includes('sur le port')) { clearTimeout(timer); resolve(); } });
  server.on('exit', (c) => reject(new Error('serveur arrete : ' + c)));
});
const base = `http://localhost:${PORT}/webhook/`;
const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
const get = async (p, q = {}) => { const r = await fetch(base + p + '?' + new URLSearchParams(q)); return { status: r.status, json: await r.json() }; };

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

try {
  const users = (await get('users')).json.users || [];
  const uid = String(users[0].userId);

  await test('lot de lectures : 64 appels acceptes, 65 refuses', async () => {
    const calls = Array.from({ length: 64 }, (_, i) => (i % 2 ? { path: 'site-banner', method: 'GET' } : { path: 'quests', method: 'POST', body: { userId: uid, action: 'status' } }));
    const r = await post('batch', { calls });
    assert.equal(r.status, 200);
    assert.equal(r.json.results.length, 64);
    assert.ok(r.json.results.every((x) => x.status === 200));
    assert.equal((await post('batch', { calls: [...calls, calls[0]] })).status, 400);
  });

  await test('lecture en lot = lecture seule (scrub compris)', async () => {
    for (const p of ['leaderboard', 'recent-pulls', 'users']) {
      const one = await get(p);
      const lot = await post('batch', { calls: [{ path: p, method: 'GET' }] });
      assert.deepEqual(lot.json.results[0].json, one.json, p);
    }
  });

  await test('lot de lectures : les ecritures restent refusees', async () => {
    const r = await post('batch', { calls: [{ path: 'daily-dice', method: 'POST', body: { userId: uid, action: 'roll' } }] });
    assert.equal(r.json.results[0].status, 400);
    assert.equal(r.json.results[0].json.error, 'read_only');
  });

  await test('ecritures en lot : souhaits ajoutes puis retires', async () => {
    const add = await post('batch-write', { path: 'wishlist', calls: [1, 2].map((cardId) => ({ userId: uid, action: 'add', cardId })) });
    assert.equal(add.status, 200);
    assert.equal(add.json.results.length, 2);
    const rm = await post('batch-write', { path: 'wishlist', calls: [1, 2].map((cardId) => ({ userId: uid, action: 'remove', cardId })) });
    assert.ok(rm.json.results.every((x) => x.status === 200), JSON.stringify(rm.json.results));
    const list = await post('wishlist', { userId: uid, action: 'list' });
    assert.ok(!(list.json.wishlist || []).some((c) => c.cardId === 1 || c.cardId === 2));
  });

  await test('ecritures en lot : echanges, vitrine et coffre acceptes', async () => {
    for (const [p, body] of [['trade', { userId: uid, action: 'cancel', tradeId: 999999 }], ['showcase', { userId: uid, action: 'remove', cardId: 999999 }], ['personal-vault', { userId: uid, action: 'store', pullId: 999999 }]]) {
      const r = await post('batch-write', { path: p, calls: [body] });
      assert.equal(r.status, 200, p);
      assert.equal(r.json.results.length, 1, p);
    }
    assert.equal((await post('batch-write', { path: 'open-pack', calls: [{ userId: uid }] })).status, 400);
  });

  await test("lot d'ecritures : limite a 2000, decraft refuse comme a l'unite si l'exemplaire n'existe plus", async () => {
    assert.equal((await post('batch-write', { path: 'disenchant', calls: Array(2001).fill({ userId: uid }) })).status, 400);
    const r = await post('batch-write', { path: 'disenchant', calls: Array(60).fill({ userId: uid, cardId: 1, finish: 'normal', quality: 'mint', pullId: 999999 }) });
    assert.equal(r.json.results.length, 60);
    assert.ok(r.json.results.every((x) => x.json.error === 'variant_not_owned'));
  });

  await test('tout fouiller : tuiles tirees par le serveur, energie debitee, autres actions refusees', async () => {
    const before = (await post('dig', { userId: uid, action: 'status' })).json;
    assert.ok(before.energy >= 3, 'energie ' + before.energy);
    const r = await post('batch-write', { path: 'dig', calls: Array(3).fill({ userId: uid, action: 'dig', tileIndex: 'auto' }) });
    assert.equal(r.status, 200);
    assert.ok(r.json.results.every((x) => x.status === 200 && x.json.dug), JSON.stringify(r.json.results[0]).slice(0, 200));
    assert.equal(r.json.results[2].json.newEnergy, before.energy - 3);
    const other = await post('batch-write', { path: 'dig', calls: [{ userId: uid, action: 'frenzy' }] });
    assert.equal(other.json.results[0].json.error, 'invalid_batch');
    assert.equal((await post('dig', { userId: uid, action: 'dig', tileIndex: 99 })).json.error, 'invalid_tile');
  });

  await test('index du store : suit creations, modifications, suppressions et annulations', () => {
    const file = tmp + '.index';
    const s = new Store(file, { lenient: true });
    try {
      const a = s.create('T', { User: ['R', 1], N: 1 });
      const b = s.create('T', { User: 1, N: 2 });
      assert.deepEqual(s.rowsBy('T', 'User', 1).map((x) => x.id), [a.id, b.id]);
      const c = s.create('T', { User: 1, N: 3 });
      assert.equal(s.countBy('T', 'User', 1), 3);
      s.update('T', b.id, { User: 2 });
      assert.deepEqual(s.rowsBy('T', 'User', 1).map((x) => x.id), [a.id, c.id]);
      assert.deepEqual(s.rowsBy('T', 'User', 2).map((x) => x.N), [2]);
      s.delete('T', a.id);
      assert.equal(s.countBy('T', 'User', 1), 1);
      assert.throws(() => s.transaction(() => { s.delete('T', c.id); throw new Error('annule'); }));
      assert.equal(s.countBy('T', 'User', 1), 1);
      s.rowsBy('T', 'User', 1)[0].N = 99;
      assert.equal(s.get('T', c.id).N, 3);
      s.updateColumn('T', 'N', { id: 'M' });
      assert.equal(s.rowsBy('T', 'M', 3).length, 1);
    } finally {
      s.db.close();
      for (const sfx of ['', '-wal', '-shm']) fs.rmSync(file + sfx, { force: true });
    }
  });

  await test('avis : validation, envoi, quota horaire', async () => {
    assert.equal((await post('feedback', { userId: uid, message: 'ab' })).json.error, 'message_too_short');
    assert.equal((await post('feedback', { userId: uid, message: 'x'.repeat(2001) })).json.error, 'message_too_long');
    const okR = await post('feedback', { userId: uid, kind: 'bug', mood: 'love', message: 'Un vrai message de test', page: 'index.html', context: { ua: 'test' } });
    assert.equal(okR.status, 200);
    assert.equal(okR.json.sent, true);
    assert.equal(okR.json.tracked, false); // pas de SENTRY_DSN dans ce test
    for (let i = 0; i < 4; i++) assert.equal((await post('feedback', { userId: uid, message: 'Message numero ' + i })).status, 200);
    const limited = await post('feedback', { userId: uid, message: 'Un message de trop' });
    assert.equal(limited.status, 429);
    assert.equal(limited.json.error, 'feedback_rate_limited');
  });

  await test('avis : envoye a GlitchTip comme un message titre, sans pile', async () => {
    const bodies = [];
    const fake = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        bodies.push((req.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(buf) : buf).toString('utf8'));
        res.end('{}');
      });
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    try {
      const mon = await import('../src/monitoring.js');
      assert.equal(await mon.initMonitoring({ dsn: `http://abc@127.0.0.1:${fake.address().port}/2`, environment: 'test', release: 'test' }), true);
      const title = '[Avis · Idée] Une vraie idee';
      assert.equal(mon.captureMessage(title, 'info', { feedback: 'idea', userId: 1, pseudo: 'Test' }, { message: 'Une vraie idee' }), true);
      await mon.flushMonitoring(3000);
      const event = bodies.join('\n').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j && j.message);
      assert.ok(event, 'evenement recu');
      assert.equal(event.message, title);
      assert.equal(event.level, 'info');
      assert.equal(event.exception, undefined); // sinon GlitchTip titre « ? »
      assert.equal(event.tags.feedback, 'idea');
      assert.equal(event.extra.message, 'Une vraie idee');
    } finally {
      fake.close();
    }
  });
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  clean();
}
console.log(`${passed} tests reussis`);
