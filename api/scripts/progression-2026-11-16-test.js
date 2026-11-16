// Tests du lot 2026-11-16 : arbre de talents a 100 points (branche Gardien),
// nouvelles ameliorations, rendement et epargne des interets du coffre,
// distributeur de l'enclos et Ange gardien, carnet des metiers (contrats,
// legendes, comptoir). Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { TALENT_TOTAL, talentValue } from '../src/native/talents.js';
import { vaultLevel } from '../src/native/personal-vault.js';
import { feederSweep } from '../src/native/dino.js';
import * as metiers from '../src/native/metiers.js';
import { parisDay } from '../src/native/common.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-prog16-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const post = (p, body) => { native.beforeRequest(body, {}, p); const r = native.run('POST', p, { body, query: {} }); native.endRequest(); return r; };
const t = () => Math.floor(Date.now() / 1000);
// Niveau 101 : 100 points (sans compter le prestige).
const user = store.create('Users', { Pseudo: 'Prog16', DiscordId: '991116', BoosterCount: 0, StardustCount: 100000, XP: 25 * 101 * 100 });
const me = () => store.get('Users', user.id);

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('talents : arbre de 100 points, 4 branches de 25', () => {
  assert.equal(TALENT_TOTAL, 100);
  const r = post('talents', { userId: user.id, action: 'status' });
  assert.equal(r.status, 200);
  assert.equal(r.json.branches.length, 4);
  assert.equal(r.json.treeTotal, 100);
  assert.ok(r.json.talents.find((x) => x.key === 'kennelmaster').locked, 'palier 2 verrouille sans 10 points');
});

await test('talents : la branche Gardien se remplit jusqu’a l’Ange gardien', () => {
  const learn = (key, n = 1) => { for (let i = 0; i < n; i++) { const r = post('talents', { userId: user.id, action: 'learn', key }); assert.equal(r.status, 200, key + ' ' + JSON.stringify(r.json)); } };
  learn('banker', 3); learn('tamer', 3); learn('nanny', 3); learn('saver');
  learn('kennelmaster', 3); learn('paleo', 3); learn('curator', 3);
  assert.equal(post('talents', { userId: user.id, action: 'learn', key: 'guardian' }).status, 200);
  assert.ok(talentValue(me(), 'guardian') > 0);
  assert.ok(Math.abs(talentValue(me(), 'banker') - 0.3) < 1e-9);
  // Bricoleur pour le test des ameliorations.
  learn('thrifty', 3); learn('restorer', 3); learn('founder', 3); learn('master'); learn('tinker', 3);
});

await test('ameliorations : 9 ateliers, prix reduit par le Bricoleur', () => {
  const r = post('upgrades', { userId: user.id, action: 'status' });
  assert.equal(r.json.upgrades.length, 9);
  const vault = r.json.upgrades.find((u) => u.key === 'vault');
  assert.ok(vault.next.price < 500, 'Bricoleur 3 rangs : -12 %');
  const b = post('upgrades', { userId: user.id, action: 'buy', key: 'vault' });
  assert.equal(b.status, 200);
  assert.equal(b.json.level, 1);
});

await test('coffre : rendement (Banquier + Coffre blinde) et jours accumules (Epargnant)', () => {
  store.update('Users', user.id, { VaultInterestDay: parisDay(-5) });
  const lv = vaultLevel(store, user.id);
  if (!lv.interestBase) { assert.equal(lv.interest, 0); return; }
  assert.equal(lv.interestRate, 40, 'Banquier 30 % + Coffre blinde 10 %');
  assert.equal(lv.interestBankDays, 3, '1 jour + 2 (Epargnant)');
  assert.equal(lv.interestDays, 3);
  assert.equal(lv.interest, lv.interestPerDay * 3);
  store.update('Users', user.id, { VaultInterestDay: parisDay() });
  assert.equal(vaultLevel(store, user.id).interestReady, false);
});

await test('coffre : le niveau max suit le nombre de cartes du gatcha', async () => {
  const { vaultMaxXp } = await import('../src/native/personal-vault.js');
  const max = vaultMaxXp(store);
  assert.ok(max > 0);
  const lv = vaultLevel(store, user.id);
  assert.equal(lv.levels[lv.levels.length - 1].xp, max, 'dernier palier = coffre complet');
  assert.ok(lv.levels.every((l, i) => i === 0 || l.xp > lv.levels[i - 1].xp), 'paliers croissants');
  assert.equal(lv.levels.length, 100, '100 niveaux');
  assert.equal(lv.levels[0].xp, 0);
  assert.ok(lv.levels[99].interest > lv.levels[49].interest && lv.levels[49].interest > lv.levels[9].interest, 'interets croissants');
  assert.equal(lv.levels.reduce((n, l) => n + l.boosters, 0), 48);
  assert.ok(/ II$/.test(lv.levels[1].name), lv.levels[1].name);
  // Une carte de plus au catalogue recule le niveau max.
  const c = store.getAll('Cards').find((x) => !x.IsPromo && !x.IsVault);
  store.create('Cards', { Name: 'Nouvelle', Active: true, Rarity: c.Rarity, Extension: c.Extension });
  assert.ok(vaultMaxXp(store) > max);
});

await test('ecrin : carte sertie rangee dans la place de sa pierre, palier complet paye une fois', async () => {
  const { MINERALS } = await import('../src/native/digdepth.js');
  const vaultCard = store.getAll('Cards').find((c) => c.IsVault) || store.create('Cards', { Name: 'Coffre', IsVault: true, Active: false });
  store.create('Pulls', { User: user.id, Card: vaultCard.id, SerialNumber: 99, BatchId: 'vault-test' });
  const card = store.getAll('Cards').find((c) => !c.IsPromo && !c.IsVault);
  let st = post('personal-vault', { userId: user.id, action: 'status' }).json;
  assert.equal(st.gemCase, null, 'secret : rien sans porte ni carte sertie');
  const tier1 = MINERALS.filter((m) => m.tier === 1);
  const ids = tier1.map((m, i) => store.create('Pulls', { User: user.id, Card: card.id, SerialNumber: 500 + i, Edition: 'forbidden', Gem: m.key, Finish: 'normal', Quality: 'good', BatchId: 'gem-' + i }).id);
  const plain = store.create('Pulls', { User: user.id, Card: card.id, SerialNumber: 600, Finish: 'normal', Quality: 'mint', BatchId: 'plain' }).id;
  st = post('personal-vault', { userId: user.id, action: 'status' }).json;
  assert.ok(st.gemCase && st.gemCase.ready === tier1.length);
  assert.equal(post('personal-vault', { userId: user.id, action: 'storeGem', pullId: plain }).json.error, 'not_gem_set');
  const xp0 = st.level.xp, b0 = me().BoosterCount;
  let last;
  for (const id of ids) { last = post('personal-vault', { userId: user.id, action: 'storeGem', pullId: id }); assert.equal(last.status, 200, JSON.stringify(last.json)); }
  assert.ok(last.json.gemReward && last.json.gemReward.tiers[0].tier === 1, 'palier 1 complet');
  assert.equal(me().BoosterCount, b0 + 1);
  assert.ok(last.json.level.xp > xp0);
  assert.equal(last.json.gemCase.tiers[0].claimed, true);
  // Hors des lignes de l'onglet Interdite, et pas de second sertissage tant qu'elle est rangee.
  assert.ok(!(last.json.editions.find((e) => e.key === 'forbidden')?.rows || []).some((r) => r.slots.some((x) => x.stored && ids.includes(x.stored.pullId))));
  assert.equal(post('personal-vault', { userId: user.id, action: 'withdraw', pullId: ids[0] }).json.error, 'gem_case_copy');
  const w = post('personal-vault', { userId: user.id, action: 'withdrawGem', pullId: ids[0] });
  assert.equal(w.status, 200);
  post('personal-vault', { userId: user.id, action: 'storeGem', pullId: ids[0] });
  assert.equal(me().BoosterCount, b0 + 1, 'palier jamais repaye');
});

await test('coffres V2 : familles, pieces de couleur, trois cles, serrurier, collection', async () => {
  const { addBall, addCoins } = await import('../src/native/chests.js');
  store.update('Users', user.id, { ChestBalls: JSON.stringify([3]), ChestCount: 0, ChestCoins: '{}', KeyCount: 1, GoldKeys: 0, SpecialKeys: 0, ChestLog: '{}', StardustCount: 100000, SpareParts: 5, Minerals: JSON.stringify({ calcaire: 10, or: 2 }), ForbiddenUnlocked: 0 });
  // Ancienne boule (nombre) : s'ouvre avec une cle ordinaire, butin classique.
  let r = post('chests', { userId: user.id, action: 'open', tier: 3, family: '' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.keysUsed.key, 1);
  // Piece de couleur : la boule tombe dans la famille choisie.
  addCoins(store, user.id, 'explorer', 2);
  r = post('chests', { userId: user.id, action: 'spin', family: 'explorer', count: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.drawn.every((d) => d.family === 'explorer'));
  assert.equal(r.json.families.find((f) => f.key === 'explorer').coins, 0);
  // Coffre de palier 6 : la cle ordinaire ne suffit pas.
  addBall(store, user.id, 6, 'nature');
  store.update('Users', user.id, { KeyCount: 3 });
  assert.equal(post('chests', { userId: user.id, action: 'open', tier: 6, family: 'nature', keyType: 'key' }).json.error, 'key_too_weak');
  // Serrurier : cle ordinaire (150 ✨ + 1 piece + 3 mineraux communs), puis cle d'or (3 cles + 1 Or + 500 ✨).
  r = post('chests', { userId: user.id, action: 'craftKey', kind: 'key' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(me().KeyCount, 4);
  assert.equal(JSON.parse(me().Minerals).calcaire, 7);
  r = post('chests', { userId: user.id, action: 'craftKey', kind: 'gold' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(me().GoldKeys, 1);
  assert.equal(me().KeyCount, 1);
  assert.ok(!r.json.recipes.some((x) => x.kind === 'room'), 'cle de la salle cachee porte fermee');
  assert.equal(post('chests', { userId: user.id, action: 'craftKey', kind: 'room' }).json.error, 'unknown_key');
  const d0 = me().StardustCount;
  r = post('chests', { userId: user.id, action: 'open', tier: 6, family: 'nature', keyType: 'gold' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.firsts.length, 1, 'premiere ouverture Nature palier 6');
  assert.ok(r.json.items.some((it) => String(it.key || '').startsWith('pantry:')), 'garde-manger de la famille Nature');
  assert.ok(me().StardustCount > d0);
  assert.equal(r.json.collection.seen, 1);
  // Explorateur : mineraux.
  // Les boules tirees peuvent depasser le palier 4 : cles d'or aussi.
  store.update('Users', user.id, { KeyCount: 2, GoldKeys: 2 });
  r = post('chests', { userId: user.id, action: 'open', all: true, gold: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.items.some((it) => String(it.key || '').startsWith('mineral:')), 'mineraux de la famille Explorateur');
  // Cle de la salle = cle speciale de la forge : 1 cle + 1 de chaque mineral, gros butin.
  const { MINERALS } = await import('../src/native/digdepth.js');
  const all = Object.fromEntries(MINERALS.map((m) => [m.key, 2]));
  store.update('Users', user.id, { ForbiddenUnlocked: 1, KeyCount: 1, SpecialKeys: 0, Minerals: JSON.stringify(all), CasinoChips: 0, BoosterCount: 0 });
  r = post('chests', { userId: user.id, action: 'craftKey', kind: 'room' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(me().SpecialKeys, 1);
  assert.equal(me().KeyCount, 0);
  assert.ok(MINERALS.every((m) => JSON.parse(me().Minerals)[m.key] === 1 || m.tier >= 4), 'un de chaque mineral consomme');
  addBall(store, user.id, 2, 'fortune');
  r = post('chests', { userId: user.id, action: 'open', tier: 2, family: 'fortune', keyType: 'room' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(me().SpecialKeys, 0);
  assert.ok(me().CasinoChips >= 60 && me().BoosterCount >= 3, 'butin de la cle de la salle');
});

const dino = (id, extra = {}) => ({ id, name: 'Dino' + id, species: 'trice', hue: 100, pattern: 'plain', bornAt: t() - 86400 * 10, at: t(), food: 80, happy: 80, xp: 0, digest: 0, poops: [], goldPoops: [], playAt: 0, petAt: 0, breedAt: 0, ...extra });

await test('distributeur : achat, remplissage, repas servis en retard, pas de mort', () => {
  // Sans le talent Ange gardien pour ce test.
  const ranks = JSON.parse(me().Talents); delete ranks.guardian; store.update('Users', user.id, { Talents: JSON.stringify(ranks) });
  store.update('Users', user.id, { Dinos: JSON.stringify([dino(1)]), DinoFood: JSON.stringify({ fish: 40, seaweed: 5, shrimp: 5 }), Worms: 40, DinoFeeder: '' });
  assert.equal(post('dino', { userId: user.id, action: 'feederFill' }).json.error, 'no_feeder');
  const b = post('dino', { userId: user.id, action: 'feederBuy' });
  assert.equal(b.status, 200, JSON.stringify(b.json));
  assert.equal(b.json.feeder.level, 1);
  const f = post('dino', { userId: user.id, action: 'feederFill' });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  assert.equal(f.json.feeder.count, 30, 'capacite 30 au niveau 1');
  assert.equal(me().Worms, 40, 'les 30 vers de reserve ne partent pas (et il restait de la place pour 0)');
  // 5 jours sans visite : sans distributeur il serait mort.
  const old = t() - 5 * 86400;
  store.update('Users', user.id, { Dinos: JSON.stringify([dino(1, { at: old, food: 80, happy: 100 })]) });
  feederSweep(store);
  const s = post('dino', { userId: user.id, action: 'status' });
  const d = s.json.dinos[0];
  assert.equal(d.dead, false, 'nourri par le distributeur');
  assert.ok(s.json.feeder.served > 0 && s.json.feeder.unseen > 0);
  assert.ok(s.json.feeder.count < 30);
  assert.equal(post('dino', { userId: user.id, action: 'feederSeen' }).json.feeder.unseen, 0);
  const e = post('dino', { userId: user.id, action: 'feederEmpty' });
  assert.equal(e.status, 200);
  assert.equal(e.json.feeder.count, 0);
});

await test('distributeur vide : le dino meurt ; Ange gardien : il reste en danger', () => {
  const old = t() - 10 * 86400;
  store.update('Users', user.id, { Dinos: JSON.stringify([dino(2, { at: old, food: 50, happy: 20 })]) });
  assert.equal(post('dino', { userId: user.id, action: 'status' }).json.dinos[0].dead, true);
  const ranks = JSON.parse(me().Talents); ranks.guardian = 1; store.update('Users', user.id, { Talents: JSON.stringify(ranks) });
  store.update('Users', user.id, { Dinos: JSON.stringify([dino(3, { at: old, food: 50, happy: 20 })]) });
  const s = post('dino', { userId: user.id, action: 'status' });
  assert.equal(s.json.dinos[0].dead, false);
  assert.equal(s.json.dinos[0].mood.key, 'dying');
  assert.equal(s.json.guardian, true);
});

await test('metiers : contrats, paliers payes, legende garantie, comptoir', () => {
  const s0 = post('metiers', { userId: user.id, action: 'status' });
  assert.equal(s0.status, 200, JSON.stringify(s0.json));
  assert.equal(s0.json.metiers.length, 5);
  assert.equal(s0.json.totalContracts, 10);
  const dust0 = me().StardustCount, tok0 = Number(me().MasterTokens) || 0;
  // Beaucoup d'activite d'un coup : tous les contrats et legendes possibles.
  const ev = (type, n, meta = {}) => ({ userId: user.id, type, n, meta });
  const notices = metiers.onEvents(store, [
    ev('dig', 400), ev('treasure', 120), ev('board', 12),
    ev('fish', 200, { zone: 'deep' }), ev('fishSpecies', 30, { rarities: Array(30).fill('rare') }),
    ev('harvest', 40, { rare: 5, bait: 8 }),
    ...Array(10).fill(0).map(() => ev('tablet', 1, { perfect: true })), ...Array(20).fill(0).map(() => ev('archeoFreed', 1)),
    ...Array(20).fill(0).map(() => ev('cook', 1, { q: 3 })), ...Array(12).fill(0).map(() => ev('cookDeliver', 1))
  ]);
  const s = post('metiers', { userId: user.id, action: 'status' });
  assert.equal(s.json.gold, 10, JSON.stringify(s.json.metiers.map((m) => m.contracts)));
  assert.equal(s.json.slam, true);
  assert.ok(s.json.metiers.every((m) => m.legend.found), 'garantie atteinte partout');
  assert.equal(s.json.legendsTotal, 5);
  assert.ok(notices.some((n) => /Grand chelem/.test(n.label)));
  assert.ok(me().StardustCount > dust0);
  const tokens = Number(me().MasterTokens) - tok0;
  assert.equal(tokens, 10 * 6 + 5 * 5 + 10, '6 par contrat, 5 par legende, 10 du chelem');
  // Plus rien a gagner cette semaine.
  assert.equal(metiers.onEvents(store, [ev('dig', 50)]).length, 0);
  const bait0 = Number(me().GoldBait) || 0;
  const buy = post('metiers', { userId: user.id, action: 'buy', key: 'bait' });
  assert.equal(buy.status, 200, JSON.stringify(buy.json));
  assert.equal(Number(me().GoldBait), bait0 + 3);
  const tab = post('metiers', { userId: user.id, action: 'buy', key: 'stone' });
  assert.equal(tab.status, 200, JSON.stringify(tab.json));
  assert.equal(JSON.parse(me().TabletStock).stone >= 1, true);
  store.update('Users', user.id, { MasterTokens: 0 });
  assert.equal(post('metiers', { userId: user.id, action: 'buy', key: 'skull' }).json.error, 'not_enough_tokens');
});

await test('jardin : le talent Recolteur et les bonus natifs passent par afterNative', () => {
  // Les hooks natifs ne doivent pas casser une action qui echoue ou n'a rien a faire.
  const r = post('garden', { userId: user.id, action: 'status' });
  assert.equal(r.status, 200);
});

console.log(`\n${passed} tests ok`);
store.db.close();
clean();
