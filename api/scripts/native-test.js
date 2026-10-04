// Tests des fonctionnalites natives (api/src/native) sur la base d'essai du
// selftest : sets complets, correspondances d'echange, serie de connexion,
// evenements, boss, economie, notifications push.
//
//   node scripts/native-test.js   (lance aussi par npm test)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { WorkflowRunner } from '../src/runtime.js';
import * as push from '../src/native/push.js';
import { parisDay } from '../src/native/common.js';
import { setting } from '../src/native/settings.js';
import * as auth from '../src/native/auth.js';
import * as unique from '../src/native/unique.js';
import * as levels from '../src/native/levels.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-native-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const call = (method, p, args) => native.run(method, p, args);
const ADMIN = '785223211730075709';

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 10).join('\n     ')); process.exitCode = 1; }
}
const user = (id) => store.get('Users', id);
const refIdOf = (v) => (Array.isArray(v) ? v[1] : v);

await test('demarrage sur une base vide (test de l image Docker)', () => {
  const t0 = path.join(os.tmpdir(), `2gatcha-native-empty-${process.pid}.sqlite`);
  for (const sfx of ['', '-wal', '-shm']) fs.rmSync(t0 + sfx, { force: true });
  const s0 = new Store(t0, { lenient: true });
  const n0 = createNative({ store: s0, withLock: (fn) => fn() });
  n0.beforeRequest({ userId: 1 }, {});
  s0.db.close();
  for (const sfx of ['', '-wal', '-shm']) fs.rmSync(t0 + sfx, { force: true });
});

await test('schema : tables et colonnes creees au demarrage', () => {
  for (const t of ['SetCompletions', 'PushSubscriptions', 'NotificationLog', 'AppSettings']) assert.ok(store.tables.has(t), t);
  assert.ok(store.table('Users').columns.LoginStreak);
  assert.ok(store.table('Config').columns.EventDustMultiplier);
});

await test('serie de connexion : jour 1, deja reclame, reprise au jour 4', () => {
  let r = call('POST', 'login-streak', { body: { userId: 1, action: 'status' } });
  assert.equal(r.json.day, 1);
  const dust = user(1).StardustCount || 0;
  r = call('POST', 'login-streak', { body: { userId: 1, action: 'claim' } });
  assert.equal(r.json.claimed, true);
  assert.equal(user(1).StardustCount, dust + 20);
  assert.equal(call('POST', 'login-streak', { body: { userId: 1, action: 'claim' } }).json.error, 'already_claimed');
  store.update('Users', 1, { LoginStreak: 3, LoginStreakDay: parisDay(-1) });
  const boosters = user(1).BoosterCount || 0;
  r = call('POST', 'login-streak', { body: { userId: 1, action: 'claim' } });
  assert.equal(r.json.day, 4);
  assert.equal(user(1).BoosterCount, boosters + 1);
  store.update('Users', 1, { LoginStreak: 5, LoginStreakDay: parisDay(-3) });
  assert.equal(call('POST', 'login-streak', { body: { userId: 1, action: 'status' } }).json.day, 1);
});

await test('set complet : incomplet refuse, complet reclame une seule fois, visible sur le profil', () => {
  const st = call('POST', 'set-rewards', { body: { userId: 1, action: 'status' } }).json;
  const set = st.sets[0];
  assert.ok(set && set.total > 0);
  if (!set.complete) assert.equal(call('POST', 'set-rewards', { body: { userId: 1, action: 'claim', extensionId: set.extensionId } }).json.error, 'set_incomplete');
  // Complete le set (une carte rangee au coffre compte aussi).
  const owned = new Set(store.getAll('Pulls').filter((p) => p.User === 1).map((p) => p.Card));
  store.getAll('Cards').filter((c) => c.Active && !c.IsPromo && c.Extension === set.extensionId && !owned.has(c.id))
    .forEach((c, i) => store.create('Pulls', { User: 1, Card: c.id, SerialNumber: 900 + i, InVault: i === 0 }));
  const before = user(1);
  const r = call('POST', 'set-rewards', { body: { userId: 1, action: 'claim', extensionId: set.extensionId } }).json;
  assert.equal(r.claimed, true);
  assert.equal(user(1).BoosterCount, (before.BoosterCount || 0) + r.boosters);
  assert.equal(user(1).StardustCount, (before.StardustCount || 0) + r.dust);
  assert.equal(call('POST', 'set-rewards', { body: { userId: 1, action: 'claim', extensionId: set.extensionId } }).json.error, 'already_claimed');
  const pub = call('GET', 'set-completions', { query: { pseudo: user(1).Pseudo } }).json;
  assert.equal(pub.sets.length, 1);
});

await test('correspondances : doublon de sa wishlist contre doublon de la mienne = echange mutuel', () => {
  const other = store.getAll('Users').find((u) => u.id !== 1);
  const cards = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo);
  const [a, b] = [cards[cards.length - 1], cards[cards.length - 2]];
  for (let i = 0; i < 2; i++) { store.create('Pulls', { User: other.id, Card: a.id, SerialNumber: 950 + i }); store.create('Pulls', { User: 1, Card: b.id, SerialNumber: 960 + i }); }
  if (!store.tables.has('Wishlist')) store.createTable('Wishlist', { User: { type: 'Ref:Users' }, Card: { type: 'Ref:Cards' } });
  store.create('Wishlist', { User: 1, Card: a.id });
  store.create('Wishlist', { User: other.id, Card: b.id });
  const m = call('POST', 'trade-matches', { body: { userId: 1, action: 'list' } }).json.matches.find((x) => x.userId === other.id);
  assert.ok(m && m.mutual && m.wishlistMatch);
  assert.ok(m.theyHave.some((c) => c.cardId === a.id));
  assert.ok(m.iHave.some((c) => c.cardId === b.id));
});

await test('evenement : reserve aux admins, poussieres x2 et finitions apres les workflows', () => {
  assert.equal(call('POST', 'admin-event', { body: { discordId: '1', action: 'set', active: true } }).status, 403);
  const ev = call('POST', 'admin-event', { body: { discordId: ADMIN, action: 'set', active: true, label: 'Week-end x2', dustMultiplier: 2, finishMultiplier: 5, endsAt: Math.floor(Date.now() / 1000) + 3600 } }).json;
  assert.equal(ev.active, true);
  assert.equal(call('GET', 'event-status', {}).json.dustMultiplier, 2);
  const dust = user(1).StardustCount;
  const resp = { status: 200, json: { disenchanted: true, dustGained: 30, newStardust: dust } };
  native.afterWorkflow('disenchant', { body: { userId: 1 } }, resp);
  assert.equal(resp.json.eventBonus.dust, 30);
  assert.equal(user(1).StardustCount, dust + 30);
  // Finitions : un booster de 40 cartes normales, x5 => quelques ameliorations.
  const batchId = '1-123456';
  const cards = Array.from({ length: 40 }, (_, i) => {
    store.create('Pulls', { User: 1, Card: 1, SerialNumber: 2000 + i, BatchId: batchId, Finish: 'normal' });
    return { cardId: 1, serialNumber: 2000 + i, finish: 'normal' };
  });
  const pack = { status: 200, json: { cards, batchId } };
  native.afterWorkflow('open-pack', { body: { userId: 1 } }, pack);
  const boosted = pack.json.cards.filter((c) => c.eventBoosted);
  assert.ok(boosted.length > 0, 'au moins une finition amelioree');
  const rows = store.getAll('Pulls').filter((p) => p.BatchId === batchId && p.Finish !== 'normal');
  assert.equal(rows.length, boosted.length);
  call('POST', 'admin-event', { body: { discordId: ADMIN, action: 'set', active: false } });
  const resp2 = { status: 200, json: { dustGained: 30 } };
  native.afterWorkflow('disenchant', { body: { userId: 1 } }, resp2);
  assert.equal(resp2.json.eventBonus, undefined);
});

await test('boss : classement des degats et bonus du coup final', () => {
  if (!store.tables.has('BossContributions')) store.createTable('BossContributions', { User: { type: 'Ref:Users' }, Boss: { type: 'Ref:CommunityBoss' }, Damage: { type: 'Numeric' }, Timestamp: { type: 'Numeric' } });
  store.getAll('CommunityBoss').filter((b) => b.Active).forEach((b) => store.update('CommunityBoss', b.id, { Active: false }));
  const boss = store.create('CommunityBoss', { BossName: 'Test', MaxHp: 100, CurrentHp: 0, Active: false });
  store.getAll('BossContributions').filter((c) => c.Boss === boss.id).forEach((c) => store.delete('BossContributions', c.id));
  store.create('BossContributions', { User: 1, Boss: boss.id, Damage: 60 });
  store.create('BossContributions', { User: 2, Boss: boss.id, Damage: 40 });
  store.create('BossContributions', { User: 1, Boss: boss.id, Damage: 10 });
  const before = user(2).BoosterCount || 0;
  const resp = { status: 200, json: { defeated: true } };
  native.afterWorkflow('community-boss', { body: { userId: 2, action: 'attack' } }, resp);
  assert.equal(user(2).BoosterCount, before + 2);
  const lb = call('GET', 'boss-leaderboard', { query: { userId: 2 } }).json;
  assert.equal(lb.top[0].userId, 1);
  assert.equal(lb.top[0].damage, 70);
  assert.equal(lb.me.rank, 2);
  assert.equal(lb.boss.finisher, user(2).Pseudo);
});

await test('boss : attaque en salve sur des exemplaires precis, multiplicateurs, victoire', () => {
  store.getAll('CommunityBoss').filter((b) => b.Active).forEach((b) => store.update('CommunityBoss', b.id, { Active: false }));
  const boss = store.create('CommunityBoss', { BossName: 'Salve', MaxHp: 100000, CurrentHp: 100000, Active: true, RewardBoosters: 3 });
  const card = store.getAll('Cards').find((c) => c.Active && !c.IsPromo);
  const base = Math.max(1, store.get('Rarities', card.Rarity).DisenchantValue || 0);
  const a = store.create('Pulls', { User: 1, Card: card.id, SerialNumber: 3001, Finish: 'rainbow', Quality: 'mint' });
  const b = store.create('Pulls', { User: 1, Card: card.id, SerialNumber: 3002, Finish: 'normal', Quality: 'damaged' });
  const v = store.create('Pulls', { User: 1, Card: card.id, SerialNumber: 3003, InVault: true });
  assert.equal(call('POST', 'boss-attack', { body: { userId: 1, pullIds: [v.id] } }).json.error, 'card_not_owned');
  const r = call('POST', 'boss-attack', { body: { userId: 1, pullIds: [a.id, b.id] } }).json;
  assert.equal(r.volleyMultiplier, 1.1);
  assert.equal(r.cards[0].damage, Math.round(base * 5 * 1.5 * 1.1));
  assert.equal(r.cards[1].damage, Math.round(base * 1 * 0.75 * 1.1));
  assert.equal(r.damage, r.cards[0].damage + r.cards[1].damage);
  assert.equal(store.get('Pulls', a.id), null);
  assert.equal(store.get('CommunityBoss', boss.id).CurrentHp, 100000 - r.damage);
  // Victoire : recompense pour chaque participant + bonus du coup final.
  store.update('CommunityBoss', boss.id, { CurrentHp: 1 });
  const c2 = store.create('Pulls', { User: 2, Card: card.id, SerialNumber: 3004 });
  store.create('BossContributions', { User: 1, Boss: boss.id, Damage: 5 });
  const u1 = user(1).BoosterCount || 0, u2 = user(2).BoosterCount || 0;
  const w = call('POST', 'boss-attack', { body: { userId: 2, pullIds: [c2.id] } }).json;
  assert.equal(w.defeated, true);
  assert.equal(user(1).BoosterCount, u1 + 3);
  assert.equal(user(2).BoosterCount, u2 + 3 + 2);
  assert.equal(store.get('CommunityBoss', boss.id).Active, false);
  assert.equal(call('POST', 'boss-attack', { body: { userId: 1, pullIds: [b.id] } }).json.error, 'no_active_boss');
  assert.ok(call('GET', 'boss-leaderboard', {}).json.rules.finish.rainbow === 5);
});

await test('doublons : poussiere passive a l ouverture (5 commune, 10 au-dela)', () => {
  const cards = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo);
  const commune = cards.find((c) => store.get('Rarities', c.Rarity).Key === 'commune');
  const rare = cards.find((c) => store.get('Rarities', c.Rarity).Key !== 'commune');
  const fresh = store.create('Cards', { Name: 'Nouvelle', Active: true, Rarity: commune.Rarity, Extension: commune.Extension });
  store.create('Pulls', { User: 1, Card: commune.id, SerialNumber: 4001, BatchId: 'old' });
  store.create('Pulls', { User: 1, Card: rare.id, SerialNumber: 4002, BatchId: 'old' });
  const batchId = '1-999';
  const mk = (c, k) => ({ cardId: c.id, rarity: { key: k } });
  const resp = { status: 200, json: { batchId, cards: [mk(commune, 'commune'), mk(rare, 'rare'), mk(fresh, 'commune'), mk(fresh, 'commune')] } };
  const dust = user(1).StardustCount || 0;
  native.afterWorkflow('open-pack', { body: { userId: 1 } }, resp);
  assert.deepEqual(resp.json.cards.map((c) => c.duplicateDust || 0), [5, 10, 0, 5]);
  assert.equal(resp.json.duplicateDust.total, 20);
  assert.equal(user(1).StardustCount, dust + 20);
});

await test('reglages : defauts, modification validee, remise a zero, lus par les modules', () => {
  assert.equal(call('POST', 'admin-settings', { body: { discordId: 'x', action: 'get' } }).status, 403);
  const list = call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'get' } }).json.settings;
  assert.ok(list.length > 30 && list.find((x) => x.key === 'FishingCost').value === 1);
  const bad = call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { FishingCost: -5, LoginStreakRewards: [{ dust: 1 }] } } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.errors.length, 2);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { SetRewardDust: 777, SpecialFinishChance: 0.25, FishingDailyCasts: 0 } } });
  assert.equal(setting(store, 'SetRewardDust'), 777);
  assert.equal(setting(store, 'SpecialFinishChance'), 0.25);
  assert.equal(store.getAll('Config')[0].SpecialFinishChance, 0.25);
  assert.equal(setting(store, 'FishingDailyCasts'), 0);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'SetRewardDust' } });
  assert.equal(setting(store, 'SetRewardDust'), 300);
});

await test('auth : jeton signe, identite verifiee, jeton falsifie ou d un autre refuse', () => {
  const token = auth.issueToken(store, user(1));
  assert.equal(auth.verifyToken(token).u, 1);
  assert.equal(auth.authorize({ token: null, body: {}, query: {} }), null);
  assert.equal(auth.authorize({ token: null, body: { userId: 1 }, query: {} }).json.error, 'auth_required');
  assert.equal(auth.authorize({ token, body: { userId: 1, action: 'status' }, query: {} }), null);
  assert.equal(auth.authorize({ token, body: { userId: 2 }, query: {} }).status, 403);
  assert.equal(auth.authorize({ token, body: { fromUserId: 2 }, query: {} }).status, 403);
  assert.equal(auth.authorize({ token, body: {}, query: { userId: '1' } }), null);
  const forged = token.split('.')[0] + '.' + 'A'.repeat(43);
  assert.equal(auth.authorize({ token: forged, body: { userId: 1 }, query: {} }).json.error, 'auth_invalid');
  const other = auth.issueToken(store, user(2));
  assert.equal(auth.authorize({ token: other, body: { userId: 1 }, query: {} }).status, 403);
  store.update('Users', 1, { DiscordId: '785223211730075709' });
  const adminTok = auth.issueToken(store, user(1));
  assert.equal(auth.authorize({ token: adminTok, body: { discordId: '785223211730075709' }, query: {} }), null);
  assert.equal(auth.authorize({ token: other, body: { discordId: '785223211730075709' }, query: {} }).status, 403);
  // Jeton remis a la connexion
  const resp = { status: 200, json: { userId: 1, pseudo: 'x' } };
  native.afterWorkflow('discord-login', { body: {} }, resp);
  assert.equal(auth.verifyToken(resp.json.token).u, 1);
});

await test('limite de debit : actions et lectures comptees a part', () => {
  auth._resetRateLimits();
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { RateLimitWritesPerMinute: 5 } } });
  let blocked = null;
  for (let i = 0; i < 6; i++) blocked = auth.rateLimit(store, 'u:42', true) || blocked;
  assert.equal(blocked.status, 429);
  assert.equal(auth.rateLimit(store, 'u:42', false), null);
  assert.equal(auth.rateLimit(store, 'u:43', true), null);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'RateLimitWritesPerMinute' } });
  auth._resetRateLimits();
});

await test('saison : XP du mois, paliers reclames une fois, carte exclusive au dernier', () => {
  const card = store.getAll('Cards').find((c) => c.Active);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { SeasonTiers: 3, SeasonXpPerTier: 100, SeasonRewards: [{ dust: 10 }, { boosters: 1 }, { chests: 1, keys: 1 }] } } });
  assert.equal(call('POST', 'admin-season', { body: { discordId: ADMIN, action: 'setCard', cardId: card.id } }).json.seasons[0].card.cardId, card.id);
  store.update('Users', 1, { XP: 1000 });
  native.beforeRequest({ userId: 1 }, {});
  let st = call('POST', 'season', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(st.xp, 0);
  assert.equal(call('POST', 'season', { body: { userId: 1, action: 'claim' } }).json.error, 'nothing_to_claim');
  store.update('Users', 1, { XP: 1250 });
  st = call('POST', 'season', { body: { userId: 1, action: 'status' } }).json;
  assert.deepEqual([st.xp, st.reached, st.claimable], [250, 2, 2]);
  const u0 = user(1);
  const c = call('POST', 'season', { body: { userId: 1, action: 'claim' } }).json;
  assert.deepEqual(c.reward, { dust: 10, boosters: 1, chests: 0, keys: 0 });
  assert.equal(user(1).StardustCount, (u0.StardustCount || 0) + 10);
  store.update('Users', 1, { XP: 1400 });
  const pulls = store.getAll('Pulls').length;
  const last = call('POST', 'season', { body: { userId: 1, action: 'claim' } }).json;
  assert.equal(last.card.cardId, card.id);
  assert.equal(store.getAll('Pulls').length, pulls + 1);
  assert.equal(call('POST', 'season', { body: { userId: 1, action: 'claim' } }).json.error, 'nothing_to_claim');
});

await test('peche : cout, prises appliquees, limite par jour', () => {
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { FishingCost: 10, FishingDailyCasts: 6, FishingLevelXpStep: 100000, FishingLoot: [{ type: 'key', weight: 1, min: 1, max: 1 }] } } });
  store.update('Users', 1, { Worms: 100, KeyCount: 0, FishingDay: '', FishingCasts: 0, FishingXP: 0 });
  const r = call('POST', 'fishing', { body: { userId: 1, action: 'cast', count: 5 } }).json;
  assert.equal(r.catches.length, 5);
  assert.equal(user(1).Worms, 50, 'le lancer coute des vers');
  assert.equal(user(1).KeyCount, 5);
  assert.equal(r.castsLeft, 1);
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast', count: 2 } }).json.error, 'daily_limit');
  store.update('Users', 1, { Worms: 5 });
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast' } }).json.error, 'not_enough_worms');
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json.table[0].chance, 100);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'FishingLevelXpStep' } });
});

await test('economie : reserve aux admins, totaux coherents', () => {
  assert.equal(call('POST', 'admin-economy', { body: { discordId: 'x' } }).status, 403);
  const e = call('POST', 'admin-economy', { body: { discordId: ADMIN } }).json;
  assert.equal(e.totals.players, store.getAll('Users').length);
  assert.equal(e.totals.copies, store.getAll('Pulls').length);
  assert.equal(e.days.length, 30);
});

await test('notifications : abonnement, expedition rentree annoncee une seule fois, pas la nuit', async () => {
  assert.equal(await push.init({ store }), true);
  assert.ok(call('GET', 'push-config', {}).json.publicKey);
  const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
  assert.equal(call('POST', 'push', { body: { userId: 1, action: 'subscribe', subscription: sub } }).json.devices, 1);
  store.update('Users', 1, { ExpeditionUntil: Math.floor(Date.now() / 1000) - 60, GuessDate: parisDay(0) });
  assert.equal(push.collect({ store, hour: 23 }).length, 0, 'heures calmes');
  const jobs = push.collect({ store, hour: 12 });
  assert.ok(jobs.some((j) => j.payload.kind === 'expedition'));
  assert.equal(push.collect({ store, hour: 12 }).filter((j) => j.payload.kind === 'expedition').length, 0, 'pas deux fois');
  call('POST', 'push', { body: { userId: 1, action: 'unsubscribe', subscription: sub } });
  assert.equal(store.getAll('PushSubscriptions').length, 0);
});

await test('coffres : coffres/cles de niveau une seule fois, achat, ouverture avec cle', () => {
  store.update('Users', 1, { XP: 25 * 12 * 11, ChestLevelGranted: 0, ChestCount: 0, KeyCount: 0, StardustCount: 250 });
  let r = call('POST', 'chests', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(r.level, 12);
  assert.deepEqual([r.chests, r.keys], [2, 1]);
  assert.ok(r.levelGrant);
  r = call('POST', 'chests', { body: { userId: 1, action: 'status' } }).json;
  assert.deepEqual([r.chests, r.keys, r.levelGrant], [2, 1, undefined]);
  r = call('POST', 'chests', { body: { userId: 1, action: 'buy' } }).json;
  assert.deepEqual([r.chests, r.stardust], [3, 150]);
  const before = store.getAll('Pulls').length;
  r = call('POST', 'chests', { body: { userId: 1, action: 'open' } }).json;
  assert.equal(r.opened, true);
  assert.deepEqual([r.chests, r.keys], [2, 0]);
  assert.ok(r.items[0].type === 'dust' && r.items[0].amount >= 40);
  assert.equal(store.getAll('Pulls').length, before + r.items.filter((i) => i.type === 'card').length);
  assert.equal(call('POST', 'chests', { body: { userId: 1, action: 'open' } }).json.error, 'no_key');
  store.update('Users', 1, { StardustCount: 10 });
  assert.equal(call('POST', 'chests', { body: { userId: 1, action: 'buy' } }).json.error, 'not_enough_dust');
});

await test('unique : rarete + extension creees, cartes forcees promo, ticket par ligne, comptoir, migration', () => {
  const rarity = store.getAll('Rarities').find((r) => r.Key === 'unique');
  assert.ok(rarity, 'rarete creee au demarrage');
  assert.equal(Number(rarity.Weight) || 0, 0);
  assert.ok(rarity.SortOrder > Math.max(...store.getAll('Rarities').filter((r) => r.Key !== 'unique').map((r) => r.SortOrder || 0)));
  const ext = store.getAll('Extensions').find((e) => e.Key === 'uniques');
  assert.ok(ext && ext.Active === false, 'extension Uniques inactive');
  // Deux cartes Unique creees "a la main" (sans IsPromo ni extension) + une carte promo rangee au coffre.
  const a = store.create('Cards', { Name: 'Unique A', Rarity: rarity.id, Active: true });
  const b = store.create('Cards', { Name: 'Unique B', Rarity: rarity.id, Active: true, Extension: 1 });
  const promo = store.create('Cards', { Name: 'Promo', Rarity: 1, Active: true, IsPromo: true });
  const stuck = store.create('Pulls', { User: 1, Card: promo.id, SerialNumber: 1, Finish: 'normal', Quality: 'mint', InVault: true });
  const r0 = unique.syncUniqueCards(store);
  assert.deepEqual([r0.promoted, r0.released], [2, 1]);
  assert.ok(store.get('Cards', a.id).IsPromo && store.get('Cards', b.id).IsPromo);
  assert.equal(store.get('Cards', a.id).Extension, ext.id, 'sans extension -> Uniques');
  assert.equal(store.get('Cards', b.id).Extension, 1, 'extension choisie gardee');
  assert.equal(!!store.get('Pulls', stuck.id).InVault, false);

  const counter = (action, cardId) => call('POST', 'unique-counter', { body: { userId: 1, action, cardId } });
  store.update('Users', 1, { UniqueTickets: 0 });
  assert.deepEqual(unique.vaultSummary(store, 1), { total: 2, remaining: 2, tickets: 0 });
  assert.equal(counter('redeem', a.id).json.error, 'no_ticket');
  unique.addTicket(store, 1);
  assert.equal(unique.vaultSummary(store, 1).tickets, 1);
  // Comptoir : vitrine, echange au choix, deja possedee refusee, carte non Unique refusee.
  let c = counter('status').json;
  assert.deepEqual([c.tickets, c.cards.length, c.cards.every((x) => !x.owned)], [1, 2, true]);
  assert.equal(counter('redeem', promo.id).json.error, 'not_unique_card');
  c = counter('redeem', b.id).json;
  assert.equal(c.redeemed, true);
  assert.deepEqual([c.card.cardId, c.card.rarity.key, c.card.quality, c.card.serialNumber, c.tickets, c.remaining], [b.id, 'unique', 'mint', 1, 0, 1]);
  assert.ok(c.cards.find((x) => x.cardId === b.id).owned);
  unique.addTicket(store, 1);
  assert.equal(counter('redeem', b.id).json.error, 'already_owned');
  assert.equal(counter('redeem', a.id).json.tickets, 0);
  // En-tete : compteur de tickets ajoute au statut des boosters.
  const bs = { status: 200, json: { count: 1 } };
  native.afterWorkflow('booster-status', { query: { userId: '1' }, body: {} }, bs);
  assert.equal(bs.json.uniqueTickets, 0);
  // Jamais comme carte de saison.
  assert.equal(call('POST', 'admin-season', { body: { discordId: ADMIN, action: 'setCard', season: '2026-10', cardId: a.id } }).json.error, 'unique_card_not_allowed');
});

await test('coffre-fort perso : rangement, promo refusee, recompense + ticket, retrait', () => {
  const vaultCall = (action, extra = {}) => call('POST', 'personal-vault', { body: { userId: 2, action, ...extra } });
  assert.equal(vaultCall('status').json.unlocked, false);
  const vaultCard = store.getAll('Cards').find((c) => c.IsVault);
  store.create('Pulls', { User: 2, Card: vaultCard.id, BatchId: 'vault-test', SerialNumber: 900, Finish: 'rainbow', Quality: 'mint' });
  const card = store.getAll('Cards').find((c) => c.Active && !c.IsPromo && !c.IsVault);
  const pull = (finish, quality = 'mint') => store.create('Pulls', { User: 2, Card: card.id, SerialNumber: 800 + store.getAll('Pulls').length, Finish: finish, Quality: quality });
  const ids = ['normal', 'holo', 'gold', 'ghost', 'diamond'].map((f) => pull(f).id);
  const worn = pull('rainbow', 'worn');
  store.update('Users', 2, { UniqueTickets: 0 });
  for (const id of ids) assert.equal(vaultCall('store', { pullId: id }).status, 200);
  assert.equal(vaultCall('store', { pullId: worn.id }).json.error, 'not_mint');
  assert.equal(vaultCall('store', { pullId: ids[0] }).json.error, 'already_stored');
  let row = vaultCall('status').json.rows.find((r) => r.cardId === card.id);
  assert.deepEqual([row.filled, row.complete], [5, false]);
  const boosters = store.get('Users', 2).BoosterCount || 0;
  const j = vaultCall('store', { pullId: pull('rainbow').id }).json;
  row = j.rows.find((r) => r.cardId === card.id);
  assert.deepEqual([row.filled, row.complete, row.claimed], [6, true, true]);
  assert.deepEqual([j.reward.boosters, j.reward.dust, j.reward.ticket], [6, 200, 1]);
  assert.equal(store.get('Users', 2).BoosterCount, boosters + 6);
  assert.equal(j.unique.tickets, 1);
  // Retirer puis remettre : pas de 2e recompense.
  vaultCall('withdraw', { pullId: ids[0] });
  assert.equal(!!store.get('Pulls', ids[0]).InVault, false);
  assert.equal(vaultCall('store', { pullId: ids[0] }).json.reward, null);
  // Cartes promo : jamais au coffre.
  const promo = store.getAll('Cards').find((c) => c.IsPromo && !c.IsVault);
  if (promo) {
    const pp = store.create('Pulls', { User: 2, Card: promo.id, SerialNumber: 555, Finish: 'normal', Quality: 'mint' });
    assert.equal(vaultCall('store', { pullId: pp.id }).json.error, 'promo_not_storable');
    assert.ok(!vaultCall('status').json.rows.some((r) => r.cardId === promo.id));
  }
});

await test('piece detachee : remplace un exemplaire en Finitions (4 + 1) et en Qualite (2 + 1)', async () => {
  const runner = new WorkflowRunner({ store, overrides: {}, log: { error: () => {} } });
  const wfs = new Map();
  for (const f of ['foil-upgrade.json', 'card-quality-repair.json']) {
    const wf = JSON.parse(fs.readFileSync(path.join(here, '../workflows', f), 'utf8'));
    wfs.set(f, wf);
  }
  const run = async (f, body) => { const { responded, done } = runner.run(wfs.get(f), { headers: {}, params: {}, query: {}, body, webhookUrl: '', executionMode: 'production' }); const r = await responded; await done; return r; };
  const card = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo && !c.IsVault)[2];
  const mk = (finish, quality) => store.create('Pulls', { User: 1, Card: card.id, SerialNumber: 700 + store.getAll('Pulls').length, Finish: finish, Quality: quality }).id;
  // Finitions : 4 holo + 1 piece -> 1 dore.
  const holos = [1, 2, 3, 4].map(() => mk('holo', 'good'));
  store.update('Users', 1, { SpareParts: 0 });
  let r = await run('foil-upgrade.json', { userId: 1, cardId: card.id, fromFinish: 'holo', pullIds: holos, parts: 1 });
  assert.equal(r.json.error, 'no_spare_part');
  r = await run('foil-upgrade.json', { userId: 1, cardId: card.id, fromFinish: 'holo', pullIds: holos });
  assert.equal(r.json.error, 'not_enough_duplicates', 'sans piece il en faut 5');
  store.update('Users', 1, { SpareParts: 2 });
  r = await run('foil-upgrade.json', { userId: 1, cardId: card.id, fromFinish: 'holo', pullIds: holos, parts: 1 });
  assert.equal(r.json.upgraded, true);
  assert.deepEqual([r.json.toFinish, r.json.partsUsed, r.json.spareParts], ['gold', 1, 1]);
  assert.equal(store.get('Users', 1).SpareParts, 1);
  assert.ok(holos.every((id) => !store.get('Pulls', id)), 'les 4 exemplaires consommes');
  // Qualite : 2 uses + 1 piece -> 1 bon etat (cout par defaut 3).
  const worn = [1, 2].map(() => mk('normal', 'worn'));
  r = await run('card-quality-repair.json', { userId: 1, cardId: card.id, fromQuality: 'worn', pullIds: worn, parts: 1 });
  assert.equal(r.json.repaired, true);
  assert.deepEqual([r.json.toQuality, r.json.partsUsed, r.json.spareParts], ['good', 1, 0]);
  assert.equal(store.get('Users', 1).SpareParts, 0);
  // Sans piece, le compte normal reste exige.
  const worn2 = [1, 2].map(() => mk('normal', 'worn'));
  r = await run('card-quality-repair.json', { userId: 1, cardId: card.id, fromQuality: 'worn', pullIds: worn2 });
  assert.equal(r.json.error, 'not_enough_duplicates');
});

await test('niveaux : formule, peche (XP, lancers en plus, piece detachee), fouille (XP, bonus de poussieres, chenil)', () => {
  assert.deepEqual([levels.levelFor(0, 20), levels.levelFor(19, 20), levels.levelFor(20, 20), levels.levelFor(60, 20), levels.levelFor(99999, 20)], [1, 1, 2, 3, 10]);
  for (const key of ['FishingCost', 'FishingDailyCasts', 'FishingLoot', 'FishingLevelXpStep']) call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key } });
  // Peche : niveau 1 puis niveau 3 (FishingLevelXpStep 15 -> 45 XP).
  store.update('Users', 1, { FishingXP: 0, FishingDay: '', FishingCasts: 0, StardustCount: 5000, Worms: 5000 });
  let st = call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json;
  assert.deepEqual([st.level.level, st.dailyLimit], [1, 20]);
  assert.ok(st.table.some((x) => x.type === 'part'), 'piece detachee dans la table');
  const empty1 = st.table.find((x) => x.type === 'nothing').chance;
  store.update('Users', 1, { FishingXP: 45 });
  st = call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json;
  assert.deepEqual([st.level.level, st.dailyLimit], [3, 24]);
  assert.ok(st.table.find((x) => x.type === 'nothing').chance < empty1, 'moins de prises vides');
  const r = call('POST', 'fishing', { body: { userId: 1, action: 'cast', count: 5 } }).json;
  assert.ok(r.xpGained >= 5);
  assert.equal(store.get('Users', 1).FishingXP, 45 + r.xpGained);
  // Une piece detachee pechee arrive dans Users.SpareParts.
  setting(store, 'FishingLoot');
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { FishingLoot: [{ type: 'part', weight: 1, min: 1, max: 1 }] } } });
  const parts = store.get('Users', 1).SpareParts || 0;
  const r2 = call('POST', 'fishing', { body: { userId: 1, action: 'cast' } }).json;
  assert.equal(r2.catches[0].type, 'part');
  assert.equal(store.get('Users', 1).SpareParts, parts + 1);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'FishingLoot' } });
  // Fouille : XP par case et tresor, bonus de poussieres au niveau 3 (+20 %).
  store.update('Users', 1, { DigXP: 60 });
  const before = store.get('Users', 1).StardustCount;
  const resp = { status: 200, json: { dug: true, revealed: true, dustGained: 50 } };
  native.afterWorkflow('dig', { body: { userId: 1, action: 'dig' } }, resp);
  assert.deepEqual([resp.json.dustGained, resp.json.levelDustBonus], [60, 10]);
  assert.equal(store.get('Users', 1).StardustCount, before + 10);
  assert.equal(store.get('Users', 1).DigXP, 66);
  assert.equal(resp.json.digLevel.level, 3);
  store.update('Users', 1, { DigXP: 119 });
  const up = { status: 200, json: { dug: true, revealed: false, dustGained: 0 } };
  native.afterWorkflow('dig', { body: { userId: 1, action: 'dig' } }, up);
  assert.equal(up.json.levelUp, 4);
  const status = { status: 200, json: { energy: 5 } };
  native.afterWorkflow('dig', { body: { userId: 1, action: 'status' } }, status);
  assert.deepEqual([status.json.digLevel.level, status.json.digLevel.perks.energyBonus], [4, 2]);
  assert.ok(Math.abs(status.json.digLevel.perks.dogSpeed - 0.15) < 1e-9);
});

await test('embellissements : meteo, carnet de peche, classement des metiers, registre des cartes Unique', async () => {
  const { weatherOf } = await import('../src/native/fishing.js');
  assert.equal(weatherOf('2026-10-05').key, weatherOf('2026-10-05').key, 'meme meteo toute la journee');
  assert.ok(['soleil', 'pluie', 'brume', 'orage'].includes(weatherOf().key));
  for (const key of ['FishingCost', 'FishingDailyCasts', 'FishingLoot', 'FishingLevelXpStep']) call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key } });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { FishingLoot: [{ type: 'dust', weight: 1, min: 10, max: 10 }] } } });
  store.update('Users', 2, { FishingRecords: '', FishingWeek: '', FishingWeekXP: 0, FishingDay: '', FishingCasts: 0, StardustCount: 1000, Worms: 1000 });
  let r = call('POST', 'fishing', { body: { userId: 2, action: 'cast' } }).json;
  assert.equal(r.catches[0].first, true);
  assert.equal(r.weather.key, weatherOf().key);
  const dust = r.records.find((x) => x.type === 'dust');
  assert.equal(dust.count, 1);
  assert.ok(dust.first > 0 && dust.best >= 10);
  r = call('POST', 'fishing', { body: { userId: 2, action: 'cast', count: 2 } }).json;
  assert.equal(r.records.find((x) => x.type === 'dust').count, 3);
  assert.equal(r.catches[0].first, false);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'FishingLoot' } });
  // Classement de la semaine : peche (3 XP pour joueur 2) et fouille.
  store.update('Users', 1, { DigWeek: '', DigWeekXP: 0, FishingWeek: '', FishingWeekXP: 0 });
  native.afterWorkflow('dig', { body: { userId: 1, action: 'dig' } }, { status: 200, json: { dug: true, revealed: true, dustGained: 0 } });
  const lb = call('GET', 'skills-leaderboard', {}).json;
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(lb.week));
  assert.equal(new Date(lb.week + 'T12:00:00Z').getUTCDay(), 1, 'la semaine commence un lundi');
  assert.deepEqual([lb.fishing[0].userId, lb.fishing[0].weekXp, lb.fishing[0].rank], [2, 3, 1]);
  assert.deepEqual([lb.dig[0].userId, lb.dig[0].weekXp], [1, 6]);
  // Registre : proprietaires de la carte Unique dans l'ordre d'obtention.
  const c = call('POST', 'unique-counter', { body: { userId: 1, action: 'status' } }).json;
  const owned = c.cards.find((x) => x.owned);
  assert.ok(owned, 'au moins une carte Unique possedee');
  assert.ok(owned.owners.some((o) => o.userId === 1));
  assert.equal(new Set(owned.owners.map((o) => o.userId)).size, owned.owners.length, 'un joueur une seule fois');
  // Carte Unique obtenue avant le registre (ou donnee par un admin) : premier obtenteur retrouve.
  const rarityU = store.getAll('Rarities').find((x) => x.Key === 'unique');
  const old = store.create('Cards', { Name: 'Unique ancienne', Rarity: rarityU.id, Active: true, IsPromo: true });
  store.create('Pulls', { User: 2, Card: old.id, SerialNumber: 1, Finish: 'normal', Quality: 'mint', ObtainedAt: 100, BatchId: 'admin-gift' });
  unique.syncUniqueCards(store);
  assert.equal(refIdOf(store.get('Cards', old.id).FirstObtainedBy), 2);
  const reg = call('POST', 'unique-counter', { body: { userId: 1, action: 'status' } }).json.cards.find((x) => x.cardId === old.id);
  assert.deepEqual(reg.owners.map((o) => o.userId), [2]);
  assert.ok('pseudo' in owned.owners[0]);
});

await test('vers de terre : terre restante d une grille (joueur et chien), stock de depart une fois', () => {
  store.update('Users', 1, { Worms: 0 });
  const done = { status: 200, json: { dug: true, boardCleared: true, leftoverTiles: 2, dustGained: 0, dogReport: { tiles: 5, boards: 1, leftover: 1 } } };
  native.afterWorkflow('dig', { body: { userId: 1, action: 'dig' } }, done);
  assert.equal(done.json.wormsFound, 2 + 2 * 2, '2 par grille + 2 par case restante');
  assert.equal(done.json.dogReport.worms, 2 + 2 * 1, 'grille terminee par le chien');
  assert.equal(store.get('Users', 1).Worms, 10);
  const plain = { status: 200, json: { dug: true, boardCleared: false, dustGained: 0, dogReport: null } };
  native.afterWorkflow('dig', { body: { userId: 1, action: 'dig' } }, plain);
  assert.equal(plain.json.wormsFound, undefined);
  assert.equal(store.get('Users', 1).Worms, 10);
  const bs = { status: 200, json: { count: 1 } };
  native.afterWorkflow('booster-status', { query: { userId: '1' }, body: {} }, bs);
  assert.equal(bs.json.worms, 10);
  // Stock de depart : une seule fois.
  assert.ok(store.getAll('AppSettings').some((r) => r.Key === 'starterWormsGiven'));
  const before = store.get('Users', 2).Worms || 0;
  createNative({ store, withLock: (fn) => fn() });
  assert.equal(store.get('Users', 2).Worms || 0, before, 'pas de second cadeau');
});

await test('unique : migration une seule fois des lignes deja completees en tickets', () => {
  // Base neuve : joueur 2 avec 3 lignes completees et 1 carte Unique deja recue.
  const t2 = path.join(os.tmpdir(), `2gatcha-native-mig-${process.pid}.sqlite`);
  for (const sfx of ['', '-wal', '-shm']) fs.rmSync(t2 + sfx, { force: true });
  for (const sfx of ['', '-wal']) if (fs.existsSync(tmp + sfx)) fs.copyFileSync(tmp + sfx, t2 + sfx);
  const s2 = new Store(t2, { lenient: true });
  s2.getAll('AppSettings').filter((r) => r.Key === 'uniqueTicketsMigrated').forEach((r) => s2.delete('AppSettings', r.id));
  s2.update('Users', 2, { UniqueTickets: 0 });
  s2.getAll('VaultRewards').filter((r) => r.User === 2).forEach((r) => s2.delete('VaultRewards', r.id));
  for (let i = 0; i < 3; i++) s2.create('VaultRewards', { User: 2, Card: i + 1, ClaimedAt: 1 });
  s2.create('Pulls', { User: 2, Card: 1, BatchId: 'unique-2-1', SerialNumber: 999, Finish: 'normal', Quality: 'mint' });
  createNative({ store: s2, withLock: (fn) => fn() });
  assert.equal(s2.get('Users', 2).UniqueTickets, 2);
  createNative({ store: s2, withLock: (fn) => fn() });
  assert.equal(s2.get('Users', 2).UniqueTickets, 2, 'pas de double migration');
  s2.db.close();
  for (const sfx of ['', '-wal', '-shm']) fs.rmSync(t2 + sfx, { force: true });
});

store.db.close();
clean();
console.log(process.exitCode ? '\nNatif : echec(s).' : `\nNatif : ${passed} tests passes.`);
