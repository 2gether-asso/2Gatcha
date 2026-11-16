// Tests du lot « avis des joueurs » (2026-11-15) : soins groupes des dinos,
// legendaire garantie commune a toutes les extensions, graine de miel,
// compagnons a 24 h. Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { parisHour } from '../src/native/common.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-avis-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const post = (p, body) => { native.beforeRequest(body, {}, p); const r = native.run('POST', p, { body, query: {} }); native.endRequest(); return r; };
const get = (p, query) => { native.beforeRequest({}, query, p); const r = native.run('GET', p, { body: {}, query }); native.endRequest(); return r; };
const t = () => Math.floor(Date.now() / 1000);
const user = store.create('Users', { Pseudo: 'Avis', DiscordId: '991115', BoosterCount: 0, StardustCount: 5000, XP: 0 });
const me = () => store.get('Users', user.id);
const night = () => { const h = parisHour(); return h >= 23 || h < 7; };

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

const dino = (id, extra = {}) => ({ id, name: 'Dino' + id, species: 'rex', hue: 100, pattern: 'plain', bornAt: t() - 86400, at: t(), food: 30, happy: 60, xp: 0, digest: 0, poops: [], goldPoops: [], playAt: 0, petAt: 0, breedAt: 0, ...extra });

await test('dinos : tout nourrir vise ~90 sans vider les reserves ni les vers', () => {
  store.update('Users', user.id, { Dinos: JSON.stringify([dino(1), dino(2), dino(3, { food: 85 })]), DinoFood: JSON.stringify({ fish: 3, seaweed: 10, shrimp: 2 }), Worms: 25 });
  const r = post('dino', { userId: user.id, action: 'feedAll' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.fedAll.length, 2, 'le dino deja rassasie est laisse');
  const stock = JSON.parse(me().DinoFood);
  assert.ok(stock.fish >= 2 && stock.seaweed >= 2 && stock.shrimp >= 2, 'reserve de 2 gardee : ' + me().DinoFood);
  assert.equal(Number(me().Worms), 25, 'vers de terre gardes sous 30');
  const fed = JSON.parse(me().Dinos).filter((d) => d.id !== 3);
  fed.forEach((d) => assert.ok(d.food > 30, 'repas servi'));
  // Plus rien d'utilisable : refus clair.
  store.update('Users', user.id, { Dinos: JSON.stringify([dino(1), dino(2)]), DinoFood: JSON.stringify({ fish: 2, seaweed: 2, shrimp: 2 }), Worms: 10 });
  assert.equal(post('dino', { userId: user.id, action: 'feedAll' }).json.error, 'nothing_to_feed');
});

await test('dinos : jouer avec tous (hors nuit), puis repos', () => {
  store.update('Users', user.id, { Dinos: JSON.stringify([dino(1), dino(2), dino(3, { playAt: t() })]) });
  const r = post('dino', { userId: user.id, action: 'playAll' });
  if (night()) { assert.equal(r.json.error, 'sleeping'); return; }
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.playedAll, 2);
  assert.equal(post('dino', { userId: user.id, action: 'playAll' }).json.error, 'play_cooldown');
});

await test('dinos : tous en balade seulement en mode Chill', () => {
  store.update('Users', user.id, { Dinos: JSON.stringify([dino(1), dino(2)]) });
  const r = post('dino', { userId: user.id, action: 'walkAll' });
  assert.ok(['wrong_mode', 'sleeping'].includes(r.json.error) || r.json.walkingAll === 2, JSON.stringify(r.json));
});

await test('jardin : fleurs melliferes -> miel au garde-manger', () => {
  store.update('Users', user.id, { GardenXP: 100000, GardenPlots: JSON.stringify([{ plantedAt: t(), seed: 'honey' }, null, null, null]), Pantry: '{}' });
  // Juste murie (pas fanee) : on recule la plantation de son temps de pousse.
  const p0 = post('garden', { userId: user.id, action: 'status' }).json.plots[0];
  store.update('Users', user.id, { GardenPlots: JSON.stringify([{ plantedAt: t() - (p0.readyAt - p0.plantedAt) - 5, seed: 'honey' }, null, null, null]) });
  const st = post('garden', { userId: user.id, action: 'status' }).json;
  assert.ok(st.seeds.some((s) => s.key === 'honey'), 'graine proposee');
  const r = post('garden', { userId: user.id, action: 'harvest' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.gained.honey >= 1, JSON.stringify(r.json.gained));
  assert.ok(JSON.parse(me().Pantry).honey >= 1);
});

await test('legendaire garantie : un compteur commun a toutes les extensions', () => {
  const cfg = store.getAll('Config')[0];
  const top = store.getAll('Rarities').sort((a, b) => (b.SortOrder || 0) - (a.SortOrder || 0))[0];
  store.update('Config', cfg.id, { PityThreshold: 50, TopRarity: top.id });
  const exts = store.getAll('Extensions').slice(0, 2).map((e) => e.id);
  if (exts.length < 2) exts.push(store.create('Extensions', { Name: 'Ext B', Active: true }).id);
  const [a, b] = exts;
  const rowA = store.create('BoosterInventory', { User: user.id, Extension: a, PullsSinceTopRarity: 30 });
  const rowB = store.create('BoosterInventory', { User: user.id, Extension: b, PullsSinceTopRarity: 4 });
  store.update('Users', user.id, { RarityPity: '' });
  // Ouverture sur B : la ligne recoit le compteur commun (le plus avance, 30).
  const request = { body: { userId: user.id, extensionId: b } };
  native.beforeWorkflow('open-pack', request);
  assert.equal(Number(store.get('BoosterInventory', rowB.id).PullsSinceTopRarity), 30);
  // Le workflow tire 5 cartes sans legendaire.
  store.update('BoosterInventory', rowB.id, { PullsSinceTopRarity: 35 });
  const response = { status: 200, json: { cards: [], batchId: `${user.id}-test`, booster: { extensionId: b }, pity: { pullsSinceTop: 35 } } };
  native.afterWorkflow('open-pack', request, response);
  assert.equal(Number(store.get('BoosterInventory', rowA.id).PullsSinceTopRarity), 35, 'extension A realignee');
  assert.equal(JSON.parse(me().RarityPity).top, 35);
  const s = get('rarity-pity', { userId: user.id });
  const leg = s.json.rarities.find((r) => r.key === top.Key);
  assert.ok(leg && !leg.perExtension && leg.left === 15, JSON.stringify(s.json.rarities));
});

await test('compagnons : 24 h de travail au plus par defaut', () => {
  const st = post('garden', { userId: user.id, action: 'status' }).json;
  assert.equal(st.bunny.maxMinutes, 1440);
  const a = post('archeo', { userId: user.id, action: 'status' }).json;
  assert.equal(a.mole && a.mole.maxMinutes, 1440, JSON.stringify(a.mole));
});

await test('pass de saison V2 : missions du jour, 100 paliers', () => {
  const call = (p, body) => post(p, body).json;
  const sq = call('season-quests', { userId: user.id, action: 'status' });
  assert.equal(sq.day.length, 10, 'missions du jour (cle = date)');
  assert.equal(sq.quests.length, 3);
  const s = call('season', { userId: user.id, action: 'status' });
  assert.equal(s.tiers.length, 100);
  assert.equal(s.pace.perDay, 360);
});

await test('pass de saison V2 : migration des reglages et des paliers deja recuperes', () => {
  const app = (key) => store.getAll('AppSettings').find((r) => r.Key === key);
  const setApp = (key, value) => { const r = app('setting:' + key); if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: 'setting:' + key, Value: JSON.stringify(value) }); };
  // Etat d'avant : 10 paliers de 700 XP, 250 XP par jour, recompenses sur mesure.
  setApp('SeasonTiers', 10); setApp('SeasonXpPerTier', 700); setApp('SeasonXpPerDay', 250); setApp('SeasonRewards', [{ dust: 50 }]);
  const marker = app('season-v2-2026-11-15');
  if (marker) store.delete('AppSettings', marker.id);
  const season = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(new Date());
  const u = store.create('Users', { Pseudo: 'Saison V2', XP: 0, StardustCount: 0, BoosterCount: 0 });
  const row = store.create('SeasonProgress', { User: u.id, Season: season, StartXP: 0, ClaimedTier: 4, BonusClaimed: 0 });
  const done = store.create('Users', { Pseudo: 'Saison finie', XP: 0 });
  const row2 = store.create('SeasonProgress', { User: done.id, Season: season, StartXP: 0, ClaimedTier: 10, BonusClaimed: 6 });
  createNative({ store, withLock: (fn) => fn() });
  assert.equal(JSON.parse(app('setting:SeasonTiers').Value), 100);
  assert.equal(JSON.parse(app('setting:SeasonXpPerTier').Value), 100);
  assert.equal(JSON.parse(app('setting:SeasonXpPerDay').Value), 120);
  assert.equal(app('setting:SeasonRewards'), undefined, 'anciennes recompenses retirees : table par defaut');
  // Saison deja commencee : elle finit avec l'ancien pass (rien de converti).
  const trace = JSON.parse(app('season-v2-2026-11-15').Value);
  assert.equal(trace.legacy.season, season);
  assert.deepEqual([trace.legacy.tiers, trace.legacy.perTier, trace.legacy.perDay], [10, 700, 250]);
  assert.deepEqual(trace.legacy.rewards, [{ dust: 50 }]);
  assert.equal(Number(store.get('SeasonProgress', row.id).ClaimedTier), 4, 'paliers recuperes intacts');
  const n2 = createNative({ store, withLock: (fn) => fn() });
  const st = n2.run('POST', 'season', { body: { userId: u.id, action: 'status' }, query: {} }).json;
  assert.equal(st.tiers.length, 10, 'ancien pass jusqu a la fin du mois');
  assert.equal(st.xpPerTier, 700);
  assert.equal(st.pace.legacy, true);
  assert.equal(st.tiers[0].reward.dust, 50);
  assert.deepEqual(st.tiers[1].reward, {}, 'ancien pass : pas de recompense par defaut');
  // Une seule fois.
  store.update('SeasonProgress', row.id, { ClaimedTier: 3 });
  createNative({ store, withLock: (fn) => fn() });
  assert.equal(Number(store.get('SeasonProgress', row.id).ClaimedTier), 3);
  // Le mois suivant, la V2 s'applique (trace pour un autre mois).
  const tr = app('season-v2-2026-11-15');
  store.update('AppSettings', tr.id, { Value: JSON.stringify({ ...trace, legacy: { ...trace.legacy, season: '2000-01' } }) });
  const st2 = n2.run('POST', 'season', { body: { userId: u.id, action: 'status' }, query: {} }).json;
  assert.equal(st2.tiers.length, 100);
  assert.equal(st2.pace.perDay, 360);
  store.update('AppSettings', tr.id, { Value: JSON.stringify(trace) });
});

store.db.close();
clean();
console.log(`\n${passed} test(s) avis joueurs ok`);
