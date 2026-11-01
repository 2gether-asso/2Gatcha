// Tests de la sauvegarde JSON (2026-11-01) : telechargement, refus, import complet
// puis redemarrage. Lance le vrai serveur HTTP sur une base de selftest.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2gatcha-save-'));
const tmp = path.join(dir, 'base.sqlite');
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const PORT = 19000 + (process.pid % 1000);
const base = `http://localhost:${PORT}`;
let server;
async function start() {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: tmp, AUTH_MODE: 'off', ADMIN_TOKEN: 'test', LOG_REQUESTS: '0', SENTRY_DSN: '', AZURE_BACKUP_SAS_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('serveur pas demarre')), 15000);
    server.stdout.on('data', (d) => { if (String(d).includes('sur le port')) { clearTimeout(timer); resolve(); } });
  });
}
const auth = { Authorization: 'Bearer test' };
const post = (part, body, headers = { 'Content-Type': 'application/json' }) => fetch(`${base}/admin/api/import/${part}`, { method: 'POST', headers: { ...auth, ...headers }, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
const download = async (images) => { const r = await fetch(`${base}/admin/api/export?images=${images}`, { headers: auth }); assert.equal(r.status, 200); return r.json(); };

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

try {
  await start();
  const png = Buffer.from('iVBORw0KGgo=', 'base64');
  assert.equal((await fetch(`${base}/admin/api/images/9001`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'image/png' }, body: png })).status, 200);
  let save;

  await test('telechargement : mot de passe exige, tables et images dans le fichier', async () => {
    assert.equal((await fetch(`${base}/admin/api/export`)).status, 401);
    save = await download(1);
    assert.equal(save.format, '2gatcha-save');
    assert.ok(save.tables.Users.rows.length > 0 && save.tables.Users.columns.Pseudo);
    assert.ok(save.images.some((i) => i.id === 9001 && i.data === png.toString('base64')));
    assert.deepEqual((await download(0)).images, []);
  });

  await test('import : refuse sans copie de securite, sans confirmation ou si le fichier est mauvais', async () => {
    assert.equal((await post('commit', { ...save, confirm: 'IMPORTER' })).status, 409);
    const begin = await (await post('begin', '{}')).json();
    assert.ok(fs.existsSync(path.join(dir, begin.safety)));
    assert.equal((await post('commit', save)).status, 400);
    assert.equal((await post('commit', { format: 'autre', tables: {}, confirm: 'IMPORTER' })).status, 400);
    assert.equal((await post('commit', { ...save, tables: { Users: save.tables.Users }, confirm: 'IMPORTER' })).status, 400);
    const broken = { ...save.tables.Users, rows: [{ Pseudo: 'sans id' }] };
    assert.equal((await post('commit', { ...save, tables: { ...save.tables, Users: broken }, confirm: 'IMPORTER' })).status, 400);
    assert.ok((await download(0)).tables.Users.rows.length > 0, 'rien de change');
  });

  await test('import : tables et images remplacees, redemarrage, donnees intactes ensuite', async () => {
    const changed = structuredClone(save);
    changed.tables.Users.rows[0].Pseudo = 'Restaure';
    const removedId = changed.tables.Users.rows.pop().id;
    const exited = new Promise((r) => server.on('exit', r));
    const img = await post('images', { images: [{ id: 9002, fileName: 'x.png', mime: 'image/png', data: png.toString('base64') }] });
    assert.equal((await img.json()).imported, 1);
    const gz = zlib.gzipSync(JSON.stringify({ ...changed, images: undefined, confirm: 'IMPORTER' }));
    const r = await post('commit', gz, { 'Content-Type': 'application/gzip' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).restarting, true);
    assert.equal(await exited, 0, 'le serveur s\'arrete pour etre relance');
    await start();
    const after = await download(1);
    assert.equal(after.tables.Users.rows[0].Pseudo, 'Restaure');
    assert.ok(!after.tables.Users.rows.some((u) => u.id === removedId));
    assert.equal(Object.keys(after.tables).length >= Object.keys(save.tables).length, true);
    assert.ok(after.images.some((i) => i.id === 9001), 'images existantes gardees');
    assert.ok(after.images.some((i) => i.id === 9002));
  });
} finally {
  if (server) server.kill();
}
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(`${passed} tests sauvegarde JSON OK`);
process.exit(process.exitCode || 0);
