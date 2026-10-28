// Tests des artistes a l'honneur (2026-10-30) : fiches + noms trouves sur les
// cartes, autres noms, cartes cachees exclues, reseaux sociaux, possession.
// Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { parseLinks } from '../src/native/artists.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-artists-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const get = (p, query) => { native.beforeRequest({}, query, p); const r = native.run('GET', p, { query, body: {} }); native.endRequest(); return r; };

const ext = store.getAll('Extensions')[0];
const rarity = store.getAll('Rarities')[0];
const hidden = store.create('Extensions', { Name: 'Cachée', Key: 'cachee-test', Active: false });
const mk = (Name, Artist, extra = {}) => store.create('Cards', { Name, Artist, Rarity: rarity.id, Extension: ext.id, Active: true, ...extra });
const a1 = mk('Aube', 'Léa Martin');
const a2 = mk('Crépuscule', 'lea martin ');
const a3 = mk('Nuit', 'Léa M.');
mk('Secrète', 'Léa Martin', { IsSecret: true });
mk('Inactive', 'Léa Martin', { Active: false });
mk('Masquée', 'Léa Martin', { Extension: hidden.id });
mk('Solo', 'Tom Sans Fiche');
store.create('Artists', { Name: 'Léa Martin', Aliases: 'Léa M.', Bio: 'Dessine des chats.', Links: 'https://www.instagram.com/lea.dessine\nMon site | lea.example.org\njavascript:alert(1)', Active: true });
const player = store.create('Users', { Pseudo: 'Fan', DiscordId: '990101', BoosterCount: 0, StardustCount: 0, XP: 0 });
store.create('Pulls', { User: player.id, Card: a1.id, SerialNumber: 1 });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('liste : fiche et nom sans fiche', () => {
  const r = get('artists', {});
  assert.equal(r.status, 200);
  const lea = r.json.artists.find((a) => a.slug === 'lea-martin');
  assert.ok(lea && lea.hasProfile);
  assert.equal(lea.cardCount, 3);
  const tom = r.json.artists.find((a) => a.slug === 'tom-sans-fiche');
  assert.ok(tom && !tom.hasProfile && tom.cardCount === 1);
});

await test('page : cartes visibles seulement, possession', () => {
  const r = get('artist', { slug: 'lea-martin', userId: player.id });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.cards.map((c) => c.cardId).sort(), [a1.id, a2.id, a3.id].sort());
  assert.equal(r.json.cards.find((c) => c.cardId === a1.id).owned, true);
  assert.equal(r.json.cards.find((c) => c.cardId === a2.id).owned, false);
  assert.equal(r.json.artist.owned, 1);
  assert.equal(r.json.stats.copies, 1);
  assert.equal(r.json.stats.collectors, 1);
});

await test('reseaux : reconnus, pas de javascript:', () => {
  const links = get('artist', { slug: 'lea-martin' }).json.artist.links;
  assert.equal(links.length, 2);
  assert.equal(links[0].network, 'instagram');
  assert.equal(links[0].handle, '@lea.dessine');
  assert.equal(links[1].label, 'Mon site');
  assert.equal(links[1].url, 'https://lea.example.org/');
  assert.equal(parseLinks('https://bsky.app/profile/x.bsky.social')[0].network, 'bluesky');
});

await test('artiste inconnu', () => { assert.equal(get('artist', { slug: 'personne' }).status, 404); });

await test('lien depuis un autre nom', () => { assert.equal(get('artist', { slug: 'lea-m' }).json.artist.slug, 'lea-martin'); });

await test('fiche masquee : artiste absent, sans page automatique', () => {
  const row = store.getAll('Artists').find((r) => r.Name === 'Léa Martin');
  store.update('Artists', row.id, { Active: false });
  assert.ok(!get('artists', {}).json.artists.some((a) => /lea/.test(a.slug)));
  assert.equal(get('artist', { slug: 'lea-martin' }).status, 404);
  store.update('Artists', row.id, { Active: true });
});

store.db.close();
clean();
console.log(`${passed} tests artistes ok`);
