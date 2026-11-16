// Tests des compagnons V2 (2026-11-16) : niveaux et XP du travail, envie du
// jour, voies et competence active, equipement, missions (travail mis en
// pause, rappel, duo), adoption de Praline / Reglisse / Paprika, concours.
// Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { compOf, xpForLevel, perksOf } from '../src/native/companion-core.js';
import { moodOf, settleContest } from '../src/native/companions.js';
import { settleCat } from '../src/native/cat.js';
import { setSettings } from '../src/native/settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-comp2-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const post = (p, body) => { native.beforeRequest(body, {}, p); const r = native.run('POST', p, { body, query: {} }); native.endRequest(); return r; };
const t = () => Math.floor(Date.now() / 1000);
const user = store.create('Users', { Pseudo: 'Comp2', DiscordId: '991117', BoosterCount: 0, StardustCount: 100000, XP: 25 * 60 * 59, SpareParts: 40, PetFrags: 40, Minerals: JSON.stringify({ calcaire: 20, bronze: 20, ambre: 20, fluorite: 20, grenat: 20, or: 5, rubis: 2 }) });
const me = () => store.get('Users', user.id);
const comp = () => compOf(me());
const setComp = (fn) => { const c = comp(); fn(c); store.update('Users', user.id, { Companions: JSON.stringify(c) }); };

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('statut : 5 compagnons, quetes de Praline et Reglisse, Paprika cache', () => {
  const r = post('companions', { userId: user.id, action: 'status' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.pets.map((p) => p.pet), ['milo', 'moka', 'noisette', 'pistache', 'poivre']);
  assert.deepEqual(r.json.adopt.map((p) => p.pet), ['praline', 'reglisse']);
  assert.equal(r.json.pets[0].level, 1);
  assert.ok(r.json.souvenirs.length >= 5);
});

await test('travail : XP de Moka par lancer, rien pendant une mission', () => {
  const start = t() - 3600;
  store.update('Users', user.id, { CatState: JSON.stringify({ start, until: t() + 3600, done: 0 }) });
  const s = settleCat(store, me());
  assert.ok(s && s.report.casts > 0);
  store.update('Users', user.id, s.fields);
  assert.ok((comp().xp.moka || 0) > 0, 'XP gagnee');
  // Mission de 2 h : la session est decalee, rien n'est credite.
  const before = JSON.parse(me().CatState);
  let r = post('companions', { userId: user.id, action: 'mission', pet: 'moka', place: 'lac', hours: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const after = JSON.parse(me().CatState);
  assert.equal(after.start - before.start, 7200);
  assert.equal(settleCat(store, me()), null, 'pas de lancer pendant la mission');
  assert.equal(post('cat', { userId: user.id, action: 'feed', count: 1 }).json.error, 'pet_on_mission');
  assert.equal(post('walk', { userId: user.id, action: 'go', pet: 'moka', place: 'lac' }).json.error, 'pet_on_mission');
  // Rappel : decalage annule.
  r = post('companions', { userId: user.id, action: 'recall', pet: 'moka' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Math.abs(JSON.parse(me().CatState).start - before.start) <= 2);
  assert.equal(r.json.pets.find((p) => p.pet === 'moka').mission, null);
});

await test('mission en duo : butin, fragments, XP, amitie', () => {
  let r = post('companions', { userId: user.id, action: 'mission', pet: 'milo', duo: 'noisette', place: 'foret', hours: 4 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(post('companions', { userId: user.id, action: 'mission', pet: 'noisette', place: 'foret', hours: 2 }).json.error, 'pet_on_mission');
  assert.equal(post('companions', { userId: user.id, action: 'claim', pet: 'milo' }).json.error, 'mission_running');
  // Fin de mission avancee.
  setComp((c) => { c.mission.milo.end = t() - 1; c.mission.noisette.end = t() - 1; });
  const f0 = Number(me().PetFrags) || 0;
  r = post('companions', { userId: user.id, action: 'claim', pet: 'noisette' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.mission.items.length > 0);
  assert.equal(r.json.mission.duo, 'noisette');
  assert.ok(Number(me().PetFrags) >= f0 + 2, 'fragments (4 h + duo)');
  assert.ok(comp().xp.milo >= 80 && comp().xp.noisette >= 80);
  assert.equal(comp().friend['milo+noisette'], 40);
  assert.ok(!comp().mission.milo && !comp().mission.noisette);
  assert.equal(post('companions', { userId: user.id, action: 'mission', pet: 'milo', place: 'foret', hours: 8 }).json.error, 'level_too_low');
});

await test('envie du jour : affection doublee et XP en plus', () => {
  const pet = ['milo', 'moka', 'noisette', 'pistache'].find((p) => moodOf(store, me(), p).kind !== 'walk');
  const m = moodOf(store, me(), pet);
  store.update('Users', user.id, { PetLove: JSON.stringify({ [pet]: { v: 0, at: t() } }) });
  const xp0 = comp().xp[pet] || 0;
  const r = post('pets', { userId: user.id, action: m.kind, pet });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.moodHit, true);
  assert.ok(comp().xp[pet] - xp0 >= 30);
  assert.ok(moodOf(store, me(), pet).done);
});

await test('voie au niveau 15, competences, rachat ; active au niveau 30', () => {
  assert.equal(post('companions', { userId: user.id, action: 'path', pet: 'noisette', path: 'gardener' }).json.error, 'level_too_low');
  setComp((c) => { c.xp.noisette = xpForLevel(store, 30); });
  let r = post('companions', { userId: user.id, action: 'path', pet: 'noisette', path: 'gardener' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = perksOf(store, me(), 'noisette');
  assert.ok(p.speed >= 0.1 + 30 * 0.004 - 1e-9 && p.extras.length === 1);
  // Pluie de printemps : parcelles pretes.
  store.update('Users', user.id, { GardenPlots: JSON.stringify([{ seed: 'mix', plantedAt: t() }]) });
  r = post('companions', { userId: user.id, action: 'active', pet: 'noisette' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.activeUsed.label, 'Pluie de printemps');
  assert.ok(JSON.parse(me().GardenPlots)[0].plantedAt < t() - 60);
  assert.equal(post('companions', { userId: user.id, action: 'active', pet: 'noisette' }).json.error, 'already_used_today');
  const d0 = me().StardustCount;
  r = post('companions', { userId: user.id, action: 'respec', pet: 'noisette' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(me().StardustCount, d0 - 2000);
  assert.equal(comp().path.noisette, undefined);
});

await test('equipement : 3 paliers, cout paye, effets ; pierre sertie seulement porte ouverte', () => {
  let r = post('companions', { userId: user.id, action: 'gear', pet: 'milo', slot: 'collar' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = post('companions', { userId: user.id, action: 'gear', pet: 'milo', slot: 'collar' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(comp().gear.milo.collar, 2);
  assert.ok(perksOf(store, me(), 'milo').decay >= 0.3);
  post('companions', { userId: user.id, action: 'gear', pet: 'milo', slot: 'charm' });
  assert.equal(post('companions', { userId: user.id, action: 'socket', pet: 'milo', mineral: 'rubis' }).json.error, 'unknown_action');
  store.update('Users', user.id, { ForbiddenUnlocked: 1 });
  r = post('companions', { userId: user.id, action: 'socket', pet: 'milo', mineral: 'rubis' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(comp().gear.milo.gem, 'rubis');
});

await test('adoption : Praline (coffre-fort), Reglisse (boosters la nuit), Paprika (salle)', () => {
  assert.equal(post('companions', { userId: user.id, action: 'adopt', pet: 'reglisse' }).json.error, 'quest_not_done');
  setComp((c) => { c.owl = 20; c.parrot = 30; });
  let r = post('companions', { userId: user.id, action: 'adopt', pet: 'reglisse' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = post('companions', { userId: user.id, action: 'adopt', pet: 'paprika' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.pets.some((p) => p.pet === 'paprika'));
  // Gestes possibles une fois adoptes.
  assert.equal(post('pets', { userId: user.id, action: 'cuddle', pet: 'reglisse' }).status, 200);
  assert.equal(post('pets', { userId: user.id, action: 'cuddle', pet: 'praline' }).json.error, 'unknown_pet');
  // Paprika : tours gratuits a la premiere visite du jour de la salle.
  store.update('Users', user.id, { PetLove: JSON.stringify({ paprika: { v: 90, at: t() } }), ForbiddenFreeSpins: 0 });
  post('forbidden', { userId: user.id, action: 'status' });
  assert.ok(Number(me().ForbiddenFreeSpins) >= 1, 'tour gratuit de Paprika');
});

await test('concours de la semaine : recompense de la semaine finie', () => {
  setComp((c) => { c.week = { w: '2000-01-03', xp: 500 }; });
  const rows = store.getAll('AppSettings').filter((x) => x.Key === 'CompanionContest');
  for (const x of rows) store.delete('AppSettings', x.id);
  store.create('AppSettings', { Key: 'CompanionContest', Value: JSON.stringify({ week: '2000-01-03' }) });
  const d0 = me().StardustCount;
  const st = settleContest(store);
  assert.equal(st.last.winners[0].userId, user.id);
  assert.equal(me().StardustCount, d0 + 800);
  const v = post('companions', { userId: 1, action: 'visit', targetId: user.id });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.ok(v.json.visit.pets.length >= 4 && !v.json.visit.pets.some((p) => p.pet === 'paprika'));
});

await test('Poivre le rat : fromage, plats cuisines avec le garde-manger, mission', () => {
  const pantry = { veg: 30, herb: 30, berry: 30, mush: 30, honey: 30, fruit: 30 };
  store.update('Users', user.id, { Cheese: 2, Pantry: JSON.stringify(pantry), CatFish: 30, Carrots: 30, Dishes: '[]', RatState: '', RatReport: '' });
  let r = post('cook', { userId: user.id, action: 'ratFeed', count: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(me().Cheese, 0);
  assert.ok(r.json.rat.secondsLeft > 0);
  // Session commencee il y a 3 h : des plats sont prets.
  const s = JSON.parse(me().RatState);
  store.update('Users', user.id, { RatState: JSON.stringify({ ...s, start: t() - 3 * 3600, until: t() + 3600 }) });
  r = post('cook', { userId: user.id, action: 'status' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.ratReport && r.json.ratReport.cooked.length >= 2, JSON.stringify(r.json.ratReport));
  assert.ok(JSON.parse(me().Dishes).length >= 2);
  const left = JSON.parse(me().Pantry);
  assert.ok(Object.keys(pantry).some((k) => (left[k] || 0) < pantry[k]) || Number(me().CatFish) < 30 || Number(me().Carrots) < 30, 'ingredients consommes');
  assert.ok((comp().xp.poivre || 0) > 0, 'XP de Poivre');
  // Mission : session decalee, pas de fromage en plus.
  store.update('Users', user.id, { Cheese: 1 });
  r = post('companions', { userId: user.id, action: 'mission', pet: 'poivre', place: 'foret', hours: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(post('cook', { userId: user.id, action: 'ratFeed', count: 1 }).json.error, 'pet_on_mission');
  post('companions', { userId: user.id, action: 'recall', pet: 'poivre' });
});

await test('reglage : compagnons fermes', () => {
  setSettings(store, { CompanionsEnabled: false });
  assert.equal(post('companions', { userId: user.id, action: 'mission', pet: 'milo', place: 'foret', hours: 2 }).json.error, 'companions_closed');
  setSettings(store, { CompanionsEnabled: true });
});

console.log(`\n${passed} tests passes.`);
store.db.close();
clean();
