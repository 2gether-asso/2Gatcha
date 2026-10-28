// Tests du lot 2026-10-30 (2) : Noisette (jardin), Pistache (archeologie),
// promenade et cuisine. Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-pets-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const post = (p, body) => { native.beforeRequest(body, {}, p); const r = native.run('POST', p, { body, query: {} }); native.endRequest(); return r; };
const t = () => Math.floor(Date.now() / 1000);
const user = store.create('Users', { Pseudo: 'Compagnons', DiscordId: '990302', BoosterCount: 0, StardustCount: 5000, XP: 0 });
const get = () => store.get('Users', user.id);

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('cuisine : ingredients manquants, puis soupe et pousse plus rapide', () => {
  assert.equal(post('cook', { userId: user.id, action: 'cook', recipe: 'soupe' }).json.error, 'missing_ingredients');
  store.update('Users', user.id, { Pantry: JSON.stringify({ veg: 3, herb: 1 }) });
  const r = post('cook', { userId: user.id, action: 'cook', recipe: 'soupe' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.cooked.effect, 'garden');
  assert.ok(r.json.buffs.find((b) => b.key === 'garden').until > t());
  assert.equal(JSON.parse(get().Pantry).veg, 0);
  const g = post('garden', { userId: user.id, action: 'plant', seed: 'veggie', plot: 0 });
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.ok(JSON.parse(get().GardenPlots)[0].fast < 1, 'plantation acceleree');
});

await test('potager : legumes au garde-manger', () => {
  const plots = JSON.parse(get().GardenPlots);
  plots[0].plantedAt = t() - 10 * 3600;
  store.update('Users', user.id, { GardenPlots: JSON.stringify(plots) });
  const r = post('garden', { userId: user.id, action: 'harvest' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.gained.veg >= 2);
  assert.ok(JSON.parse(get().Pantry).veg >= 2);
});

await test('Noisette : recolte et replante a ta place', () => {
  const old = t() - 10 * 3600;
  store.update('Users', user.id, { Carrots: 2, GardenPlots: JSON.stringify([{ plantedAt: old }, { plantedAt: old, seed: 'worm' }, null, null]) });
  const r = post('garden', { userId: user.id, action: 'bunnyFeed', count: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.bunnyReport.harvests, 2);
  assert.equal(r.json.bunnyReport.replanted, 2);
  assert.ok(r.json.bunny.secondsLeft > 0);
  const u = get();
  assert.equal(Number(u.Carrots), 1);
  const plots = JSON.parse(u.GardenPlots);
  assert.ok(plots[0] && plots[1] && plots[1].seed === 'worm', 'meme graine replantee');
  assert.equal(u.BunnyReport, '', 'rapport remis');
  assert.equal(post('garden', { userId: user.id, action: 'bunnyFeed', count: 50 }).json.error, 'no_carrot');
});

await test('Pistache : gratte une tablette puis nettoie les blocs', () => {
  store.update('Users', user.id, { Grubs: 3, Tablets: 1, TabletStock: JSON.stringify({ clay: 1, stone: 0, gold: 0 }), ArcheoFinds: '[]', ArcheoStarter: true });
  const r = post('archeo', { userId: user.id, action: 'moleFeed', count: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.mole.secondsLeft > 0);
  // 2 h ont passe : 3 taches de 40 min.
  const s = JSON.parse(get().MoleState);
  store.update('Users', user.id, { MoleState: JSON.stringify({ ...s, start: s.start - 7200, until: s.until - 7200 }) });
  const v = post('archeo', { userId: user.id, action: 'status', takeReport: true });
  const rep = v.json.moleReport;
  assert.ok(rep, 'rapport');
  assert.equal(rep.dug.length, 1);
  assert.equal(rep.jobs, 3);
  assert.equal(v.json.tablets, 0);
  assert.ok(rep.freed.length + rep.idle === 2);
  assert.equal(get().MoleState, '', 'travail fini');
});

await test('promenade : une fois par jour et par compagnon', () => {
  const st = post('walk', { userId: user.id, action: 'status' }).json;
  assert.ok(st.pets.length >= 4, 'ancien compte : tous les compagnons');
  const r = post('walk', { userId: user.id, action: 'go', pet: 'milo', place: 'foret' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.walk.fav, true);
  assert.ok(r.json.walk.items.length >= 1);
  assert.ok(JSON.parse(get().PetLove).milo.v >= 18);
  assert.equal(post('walk', { userId: user.id, action: 'go', pet: 'milo', place: 'lac' }).json.error, 'already_walked');
  const night = post('walk', { userId: user.id, action: 'go', pet: 'moka', place: 'clairiere' });
  assert.ok(st.night ? night.status === 200 : night.json.error === 'place_closed');
});

await test('tarte et grillade : compagnons a fond, peche boostee', () => {
  store.update('Users', user.id, { Pantry: JSON.stringify({ berry: 3, honey: 1, herb: 1 }), CatFish: 2 });
  assert.equal(post('cook', { userId: user.id, action: 'cook', recipe: 'tarte' }).status, 200);
  const pets = post('pets', { userId: user.id, action: 'status' }).json.pets;
  assert.ok(pets.every((p) => p.cooked));
  assert.equal(post('cook', { userId: user.id, action: 'cook', recipe: 'grillade' }).status, 200);
  assert.equal(post('fishing', { userId: user.id, action: 'status' }).json.cooked, true);
});

await test('nouveau compte : noms caches, pas de promenade sans compagnon', async () => {
  const { petMask, isNewcomer } = await import('../src/native/starter.js');
  const fresh = store.create('Users', { Pseudo: 'Nouveau', DiscordId: '990303', BoosterCount: 0, StardustCount: 0, XP: 0, CreatedAt: t() + 10 });
  assert.ok(isNewcomer(store, store.get('Users', fresh.id)));
  const m = petMask(store, store.get('Users', fresh.id));
  assert.equal(m('Donne une carotte à Noisette'), 'Donne une carotte à la lapine');
  assert.equal(m('Le flair de Pistache'), 'Le flair du hérisson');
  assert.equal(m('Donne un ver blanc à Pistache.'), 'Donne un ver blanc au hérisson.');
  assert.equal(m('Botte de carottes pour Noisette la lapine'), 'Botte de carottes');
  assert.equal(post('garden', { userId: fresh.id, action: 'bunnyFeed', count: 1 }).json.error, 'pet_not_adopted');
  assert.equal(post('walk', { userId: fresh.id, action: 'status' }).json.pets.length, 0);
  // Premiere carotte : Noisette adoptee (cinematique).
  store.update('Users', fresh.id, { Carrots: 1 });
  const r = post('garden', { userId: fresh.id, action: 'status' });
  assert.ok((r.json.discoveries || []).some((d) => d.key === 'adopt-noisette'));
});

store.db.close();
clean();
console.log(`${passed} test(s) ok`);
