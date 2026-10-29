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
  // Niveau « au plus tard » de la peche (reglage StarterUnlocks), sans ver trouve avant.
  const fishLevel = Number(status(fresh.id).locks.find((l) => l.key === 'fishing').level);
  store.update('Users', fresh.id, { XP: xpForLevel(fishLevel) });
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

await test('decouvertes : archeologie, promenade, cuisine, aquarium, musee caches jusqu a la premiere trouvaille', () => {
  const u = store.create('Users', { Pseudo: 'Explorateur', DiscordId: '990003', BoosterCount: 0, StardustCount: 0, XP: 0, CreatedAt: since + 20 });
  const keys = ['archeo', 'walk', 'cook', 'aquarium', 'museum'];
  let v = status(u.id);
  for (const k of keys) {
    assert.equal(v.found[k], false, k);
    assert.ok(v.locks.some((l) => l.find && l.key === k && l.hide.length), 'masque : ' + k);
  }
  // Pas de tablettes offertes avant la decouverte, ecritures refusees.
  post('archeo', { userId: u.id, action: 'status' });
  assert.equal(Number(user(u.id).Tablets) || 0, 0);
  assert.equal(post('archeo', { userId: u.id, action: 'open', kind: 'clay' }).json.error, 'not_discovered');
  assert.equal(post('cook', { userId: u.id, action: 'cook', dish: 'soup' }).json.error, 'not_discovered');
  // Premiere tablette (fouille) : cinematique, puis le cadeau de depart.
  store.update('Users', u.id, { Tablets: 1, TabletStock: JSON.stringify({ clay: 1 }) });
  const items = post('starter', { userId: u.id, action: 'status' }).json.discoveries || [];
  const a = items.find((d) => d.key === 'find-archeo');
  assert.ok(a && a.unlock && a.kicker === 'Nouvelle découverte !' && a.url);
  assert.ok(!items.some((d) => d.key === 'find-walk'), 'pas de promenade sans compagnon');
  v = status(u.id);
  assert.equal(v.found.archeo, true);
  assert.ok(!v.locks.some((l) => l.key === 'archeo'));
  post('archeo', { userId: u.id, action: 'status' });
  assert.ok(Number(user(u.id).Tablets) > 1, 'tablettes offertes apres la decouverte');
  assert.ok(!(post('starter', { userId: u.id, action: 'status' }).json.discoveries || []).some((d) => d.key === 'find-archeo'), 'une seule fois');
  // Premier compagnon : adoption ET promenade dans la meme reponse.
  store.update('Users', u.id, { BoneCount: 1 });
  const both = (post('starter', { userId: u.id, action: 'status' }).json.discoveries || []).map((d) => d.key);
  assert.ok(both.includes('adopt-milo') && both.includes('find-walk'), both.join(','));
  // Ingredient, poisson rare, piece de musee.
  store.update('Users', u.id, { Pantry: JSON.stringify({ veg: 2 }), Aquarium: JSON.stringify({ fish: { carp: 1 } }), MuseumSeen: JSON.stringify({ minerals: ['quartz'], items: [] }) });
  const rest = (post('starter', { userId: u.id, action: 'status' }).json.discoveries || []).map((d) => d.key);
  for (const k of ['find-cook', 'find-aquarium', 'find-museum']) assert.ok(rest.includes(k), k + ' dans ' + rest.join(','));
  v = status(u.id);
  for (const k of keys) assert.equal(v.found[k], true, k);
  assert.ok(!v.locks.some((l) => l.find));
  assert.notEqual(post('cook', { userId: u.id, action: 'cook', dish: 'soup' }).json.error, 'not_discovered');
  // Ancien compte : jamais rien de cache.
  const o = status(old.id);
  for (const k of keys) assert.equal(o.found[k], true, 'ancien ' + k);
});

await test('activites en decouverte : premier ver -> peche, crane -> dinos, carte brillante -> coffre-fort, avant leur niveau', () => {
  const u = store.create('Users', { Pseudo: 'Curieux', DiscordId: '990004', BoosterCount: 0, StardustCount: 0, XP: 0, CreatedAt: since + 30 });
  let v = status(u.id);
  for (const k of ['fishing', 'dinos', 'vault', 'shop', 'expedition']) assert.ok(v.locks.some((l) => l.key === k && !l.find), 'verrouille : ' + k);
  assert.equal(post('fishing', { userId: u.id, action: 'cast' }).json.error, 'level_locked');
  store.update('Users', u.id, { Worms: 3, DinoSkulls: 1, PullStats: JSON.stringify({ cards: 5, finish: { normal: 4, holo: 1 } }) });
  const items = post('starter', { userId: u.id, action: 'status' }).json.discoveries || [];
  for (const k of ['fishing', 'dinos', 'vault']) {
    const d = items.find((x) => x.key === 'unlock-' + k);
    assert.ok(d && d.kicker === 'Nouvelle découverte !' && d.riddle, k + ' : ' + JSON.stringify(items.map((x) => x.key)));
  }
  assert.ok(!items.some((x) => x.key === 'unlock-shop'), 'la boutique attend sa trouvaille');
  v = status(u.id);
  assert.equal(v.level, 1);
  for (const k of ['fishing', 'dinos', 'vault']) { assert.ok(!v.locks.some((l) => l.key === k), 'ouvert : ' + k); assert.ok(v.unlocks.some((x) => x.key === k)); }
  assert.ok(v.locks.some((l) => l.key === 'shop'));
  assert.notEqual(post('fishing', { userId: u.id, action: 'cast' }).json.error, 'level_locked');
  // Une seule cinematique par activite.
  assert.ok(!(post('starter', { userId: u.id, action: 'status' }).json.discoveries || []).some((x) => x.key === 'unlock-fishing'));
  // Filet de securite : le niveau ouvre le reste, avec la cinematique classique.
  const shopLevel = Number(v.locks.find((l) => l.key === 'shop').level);
  store.update('Users', u.id, { XP: xpForLevel(shopLevel) });
  const lvl = (post('starter', { userId: u.id, action: 'status' }).json.discoveries || []).find((x) => x.key === 'unlock-shop');
  assert.ok(lvl && lvl.kicker === 'Nouveau : débloqué !');
});

store.db.close();
clean();
console.log(`${passed} test(s) ok`);
