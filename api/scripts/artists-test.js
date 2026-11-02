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

await test('fiche tenue par l artiste : reliee par l admin, champs limites, images', () => {
  const post = (p, body) => { native.beforeRequest(body, {}, p); const res = native.run('POST', p, { body, query: {} }); native.endRequest(); return res; };
  const stranger = store.create('Users', { Pseudo: 'Curieux', DiscordId: '990102', BoosterCount: 0, StardustCount: 0, XP: 0 });
  const row = store.getAll('Artists').find((x) => x.Name === 'Léa Martin');
  assert.equal(post('artist-profile', { userId: player.id }).json.error, 'not_linked');
  assert.equal(get('artist', { slug: 'lea-martin', userId: player.id }).json.editable, false);
  store.update('Artists', row.id, { User: player.id });
  assert.equal(get('artist', { slug: 'lea-martin', userId: player.id }).json.editable, true);
  assert.equal(get('artist', { slug: 'lea-martin', userId: stranger.id }).json.editable, false);
  assert.equal(get('artist', { slug: 'lea-martin' }).json.editable, false);
  assert.equal(get('artists', { userId: player.id }).json.mine, 'lea-martin');
  assert.equal(get('artists', { userId: stranger.id }).json.mine, null);
  assert.equal(post('artist-profile', { userId: stranger.id }).json.error, 'not_linked');
  const st = post('artist-profile', { userId: player.id, action: 'status' }).json.profile;
  assert.equal(st.slug, 'lea-martin');
  assert.equal(st.cards.length, 3);
  // Le nom et la visibilite ne bougent pas, meme envoyes.
  const saved = post('artist-profile', { userId: player.id, action: 'save', fields: { tagline: 'Chats et aquarelle', bio: 'Bonjour', links: 'https://bsky.app/profile/lea', color: '#ff00aa', featuredCard: a2.id, name: 'Pirate', Active: false } }).json;
  assert.equal(saved.saved, true);
  const after = store.get('Artists', row.id);
  assert.equal(after.Name, 'Léa Martin');
  assert.notEqual(after.Active, false);
  assert.equal(after.Tagline, 'Chats et aquarelle');
  assert.equal(get('artist', { slug: 'lea-martin' }).json.artist.cover.cardId, a2.id);
  assert.equal(post('artist-profile', { userId: player.id, action: 'save', fields: { color: 'red' } }).json.error, 'invalid_color');
  assert.equal(post('artist-profile', { userId: player.id, action: 'save', fields: { featuredCard: 99999 } }).json.error, 'not_your_card');
  // Images : petite image acceptee, autre format refuse.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const im = post('artist-profile', { userId: player.id, action: 'image', column: 'Avatar', image: png }).json.profile;
  assert.ok(im.avatarId && store.getAttachment(im.avatarId));
  assert.equal(post('artist-profile', { userId: player.id, action: 'image', column: 'Avatar', image: 'data:image/svg+xml;base64,PHN2Zz4=' }).json.error, 'invalid_image');
  assert.equal(post('artist-profile', { userId: player.id, action: 'image', column: 'Bio', image: png }).json.error, 'invalid_column');
  store.update('Artists', row.id, { User: 0 });
  assert.equal(post('artist-profile', { userId: player.id }).json.error, 'not_linked', 'lien retire');
});

store.db.close();
clean();
console.log(`${passed} tests artistes ok`);
