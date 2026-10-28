// Tests du lot 2026-10-29 : deblocages surprises des nouveaux comptes (rien
// de verrouille n'est nomme, cinematique a l'ouverture), adoption de Milo et
// Moka (premier os, premier poisson), ancre de recharge d'energie manquante.
// Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { now, levelForXp } from '../src/native/common.js';
const xpForLevel = (l) => { let x = 0; while (levelForXp(x) < l) x++; return x; };

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-unlocks-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const call = (method, p, args) => { native.beforeRequest(args.body || {}, args.query || {}, p); const r = native.run(method, p, args); native.endRequest(); return r; };
const post = (p, body) => call('POST', p, { body });
const ADMIN = '785223211730075709';
post('admin-settings', { discordId: ADMIN, action: 'set', values: { StarterEnabled: true, SurpriseEnabled: false } });
// Nouveau compte : cree apres la mise en ligne des deblocages.
const since = Number(store.getAll('AppSettings').find((r) => r.Key === 'StarterSince')?.Value) || now();
const fresh = store.create('Users', { Pseudo: 'Nouveau', DiscordId: '990001', BoosterCount: 0, StardustCount: 0, XP: 0, CreatedAt: since + 10 });
const old = store.create('Users', { Pseudo: 'Ancien', DiscordId: '990002', BoosterCount: 0, StardustCount: 0, XP: 0, CreatedAt: 1 });
const user = (id) => store.get('Users', id);
const status = (id) => post('starter', { userId: id, action: 'status' }).json;

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('rien de verrouille n est nomme', () => {
  const v = status(fresh.id);
  assert.ok(v.locks.length > 0);
  for (const l of v.locks) { assert.equal(l.label, undefined); assert.equal(l.icon, undefined); }
  assert.deepEqual(v.unlocks, []);
  assert.ok(v.nextUnlockLevel >= 2);
  const fish = v.steps.find((s) => s.key === 'fish');
  if (fish) { assert.equal(fish.secret, true); assert.equal(fish.label, 'Étape mystère'); assert.equal(fish.url, null); }
});

await test('pas d animaux au depart, refus des gestes', () => {
  const v = status(fresh.id);
  assert.deepEqual(v.pets, { milo: false, moka: false, noisette: false, pistache: false });
  assert.ok(v.locks.some((l) => l.pet && l.key === 'milo'));
  assert.equal(post('pets', { userId: fresh.id, action: 'cuddle', pet: 'milo' }).json.error, 'pet_not_adopted');
  assert.equal(post('cat', { userId: fresh.id, action: 'feed', count: 1 }).json.error, 'pet_not_adopted');
  assert.equal(post('dog-gift', { userId: fresh.id, action: 'status' }).json.available, false);
  // Les anciens comptes gardent leurs animaux.
  assert.deepEqual(status(old.id).pets, { milo: true, moka: true, noisette: true, pistache: true });
});

await test('premier os : Milo adopte, avec cinematique', () => {
  store.update('Users', fresh.id, { BoneCount: 1 });
  const r = post('starter', { userId: fresh.id, action: 'status' });
  const items = r.json.discoveries || [];
  const milo = items.find((d) => d.key === 'adopt-milo');
  assert.ok(milo && milo.unlock && milo.url);
  assert.equal(status(fresh.id).pets.milo, true);
  assert.ok(!(post('starter', { userId: fresh.id, action: 'status' }).json.discoveries || []).some((d) => d.key === 'adopt-milo'), 'une seule fois');
  assert.notEqual(post('pets', { userId: fresh.id, action: 'cuddle', pet: 'milo' }).json.error, 'pet_not_adopted');
});

await test('premier poisson : Moka adopte', () => {
  store.update('Users', fresh.id, { CatFish: 1 });
  const items = post('starter', { userId: fresh.id, action: 'status' }).json.discoveries || [];
  assert.ok(items.some((d) => d.key === 'adopt-moka'));
  assert.equal(status(fresh.id).pets.moka, true);
});

await test('niveau atteint : cinematique de deblocage, une fois', () => {
  status(fresh.id);
  store.update('Users', fresh.id, { XP: xpForLevel(2) });
  const items = post('starter', { userId: fresh.id, action: 'status' }).json.discoveries || [];
  const fishing = items.find((d) => d.key === 'unlock-fishing');
  assert.ok(fishing, JSON.stringify(items));
  assert.equal(fishing.url, 'jeux.html#peche');
  const v = status(fresh.id);
  assert.ok(v.unlocks.some((u) => u.key === 'fishing'));
  assert.ok(!v.locks.some((l) => l.key === 'fishing'));
  assert.ok(!(post('starter', { userId: fresh.id, action: 'status' }).json.discoveries || []).some((d) => d.key === 'unlock-fishing'));
});

await test('energie sans date de recharge : ancre posee, la jauge remonte', () => {
  store.update('Users', old.id, { DigEnergy: 0, LastDigEnergyAt: null, FishingEnergy: 0, FishingEnergyAt: null });
  post('starter', { userId: old.id, action: 'status' });
  const u = user(old.id);
  assert.ok(Number(u.LastDigEnergyAt) > 0);
  assert.ok(Number(u.FishingEnergyAt) > 0);
  const anchor = u.LastDigEnergyAt;
  post('starter', { userId: old.id, action: 'status' });
  assert.equal(user(old.id).LastDigEnergyAt, anchor, 'ancre stable');
});

const cosm = (body) => post('admin-cosmetics', { discordId: ADMIN, ...body });
await test('cosmetiques secrets : liste, renommage pour tous, retablissement', () => {
  const list = cosm({ action: 'list' }).json;
  const shadow = list.secrets.find((c) => c.key === 'frame-shadow');
  assert.ok(shadow && shadow.type === 'frame' && /ombre/.test(shadow.source));
  assert.ok(!list.items.some((c) => c.key === 'frame-shadow'), 'pas dans la boutique');
  assert.ok(list.secrets.some((c) => c.key === 'frame-retro' && /KONAMI/.test(c.source)), 'codes secrets inclus');
  post('admin-cosmetics', { discordId: ADMIN, action: 'grant', key: 'frame-shadow', targetUserId: old.id });
  const r = cosm({ action: 'save', item: { key: 'frame-shadow', type: 'frame', label: 'Ombre profonde', secret: true, style: { c1: '#111111', glow: 10, anim: 'pulse' } } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = store.getAll('UserCosmetics').find((x) => x.Key === 'frame-shadow');
  assert.equal(row.Label, 'Ombre profonde');
  assert.ok(r.json.secrets.find((c) => c.key === 'frame-shadow').edited);
  assert.ok(!post('cosmetics', { userId: fresh.id, action: 'status' }).json.shop.some((c) => c.key === 'frame-shadow'), 'jamais en vente');
  assert.equal(cosm({ action: 'save', item: { key: 'frame-shadow', type: 'title', label: 'X', secret: true } }).json.secrets.find((c) => c.key === 'frame-shadow').type, 'frame', 'type du jeu garde');
  assert.equal(cosm({ action: 'save', item: { key: 'title-dimanche', type: 'title', label: 'X', secret: true } }).json.error, 'key_taken');
  cosm({ action: 'delete', key: 'frame-shadow' });
  assert.equal(store.getAll('UserCosmetics').find((x) => x.Key === 'frame-shadow').Label, 'Ombre');
});

await test('compagnons pas encore adoptes : jamais nommes (boutique, histoire, masque)', async () => {
  const { petMask } = await import('../src/native/starter.js');
  const n = store.create('Users', { Pseudo: 'Novice', DiscordId: '990003', BoosterCount: 0, StardustCount: 0, XP: 0, CreatedAt: since + 20 });
  const m = petMask(store, user(n.id));
  assert.equal(m('Os pour Milo'), 'Os');
  assert.equal(m('Le flair de Milo'), 'Le flair du chien');
  assert.equal(m('Wouf ! Milo gratte le sol'), 'Wouf ! Le chien gratte le sol');
  assert.equal(m('Moka a faim'), 'Le chat a faim');
  assert.equal(m('Milo, Moka et Pepper comptent sur toi'), 'Le chien, le chat et Pepper comptent sur toi');
  assert.equal(petMask(store, user(old.id))('Os pour Milo'), 'Os pour Milo', 'ancien compte : inchange');
  const shop = post('shop', { userId: n.id, action: 'status' });
  assert.equal(shop.status, 200);
  {
    const txt = JSON.stringify(shop.json.items.map((i) => [i.label, i.desc]));
    assert.ok(!/Milo|Moka/.test(txt), txt);
  }
  const cos = post('cosmetics', { userId: n.id, action: 'status' }).json;
  assert.ok(!cos.shop.some((c) => /Milo|Moka/.test(c.label)));
  const story = post('story', { userId: n.id, action: 'status' });
  assert.equal(story.status, 200);
  assert.ok(!/Milo|Moka/.test(JSON.stringify(story.json)), JSON.stringify(story.json).slice(0, 300));
});

const ex = (body) => post('admin-explorer', { discordId: ADMIN, ...body });
await test('tout voir : tables, recherche, edition, creation, suppression', () => {
  assert.equal(post('admin-explorer', { discordId: '1', action: 'tables' }).status, 403);
  assert.ok(ex({ action: 'tables' }).json.tables.some((t) => t.name === 'Users'));
  const rows = ex({ action: 'rows', table: 'Users', q: `id=${old.id}` }).json;
  assert.equal(rows.total, 1);
  assert.equal(rows.rows[0].Pseudo, 'Ancien');
  const pulls = ex({ action: 'rows', table: 'Pulls', limit: 5 }).json;
  if (pulls.rows.length) assert.ok(pulls.refs.Users || pulls.refs.Cards, 'libelles des references');
  assert.equal(ex({ action: 'set', table: 'Users', id: old.id, fields: { StardustCount: '1234', SecretsFound: '{"a":1}' } }).status, 200);
  assert.equal(user(old.id).StardustCount, 1234);
  assert.equal(ex({ action: 'set', table: 'Users', id: old.id, fields: { Nope: 1 } }).json.error, 'unknown_column');
  const made = ex({ action: 'create', table: 'AppSettings', fields: { Key: 'explorerTest', Value: '1' } }).json.row;
  assert.ok(made.id);
  assert.equal(ex({ action: 'delete', table: 'AppSettings', id: made.id }).json.deleted, made.id);
});

const aud = (body) => post('admin-audit', { discordId: ADMIN, ...body });
await test('journal admin : don et edition annules, gains du joueur gardes', () => {
  const card = store.getAll('Cards').find((c) => c.Active && !c.IsPromo);
  const pullsBefore = store.getAll('Pulls').length;
  const d0 = user(old.id).StardustCount;
  const g = post('admin-rewards', { discordId: ADMIN, action: 'gift', userIds: [old.id], rewards: [{ type: 'resource', key: 'dust', n: 500 }, { type: 'card', cardId: card.id, n: 1, finish: 'normal', quality: 'good', edition: '' }] });
  assert.equal(g.status, 200, JSON.stringify(g.json));
  const gained = user(old.id).StardustCount - d0;
  assert.ok(gained > 0);
  store.update('Users', old.id, { StardustCount: user(old.id).StardustCount + 7 }); // le joueur gagne 7 entre-temps
  const list = aud({ action: 'list' }).json.entries;
  const e = list.find((x) => x.route === 'admin-rewards' && x.action === 'gift');
  assert.ok(e && /Don/.test(e.summary), JSON.stringify(list[0]));
  const u = aud({ action: 'undo', id: e.id });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.equal(user(old.id).StardustCount, d0 + 7, 'seul le don est retire');
  assert.equal(store.getAll('Pulls').length, pullsBefore, 'exemplaire donne retire');
  assert.equal(aud({ action: 'undo', id: e.id }).json.error, 'already_undone');
  // Tout voir : modification puis suppression, annulees.
  post('admin-explorer', { discordId: ADMIN, action: 'set', table: 'Users', id: old.id, fields: { Pseudo: 'Renomme' } });
  const s = aud({ action: 'list' }).json.entries[0];
  assert.equal(s.route, 'admin-explorer');
  aud({ action: 'undo', id: s.id });
  assert.equal(user(old.id).Pseudo, 'Ancien');
  const row = store.create('AppSettings', { Key: 'auditTest', Value: 'x' });
  post('admin-explorer', { discordId: ADMIN, action: 'delete', table: 'AppSettings', id: row.id });
  assert.equal(store.get('AppSettings', row.id), null);
  aud({ action: 'undo', id: aud({ action: 'list' }).json.entries[0].id });
  assert.equal(store.get('AppSettings', row.id).Value, 'x', 'ligne recreee avec son numero');
  // Lectures : rien au journal.
  const n = aud({ action: 'list' }).json.entries.length;
  post('admin-explorer', { discordId: ADMIN, action: 'rows', table: 'Users' });
  assert.equal(aud({ action: 'list' }).json.entries.length, n);
});

store.db.close();
clean();
console.log(`${passed} test(s) ok`);
