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
import * as push from '../src/native/push.js';
import { parisDay } from '../src/native/common.js';
import { setting } from '../src/native/settings.js';
import * as auth from '../src/native/auth.js';
import * as unique from '../src/native/unique.js';

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
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); process.exitCode = 1; }
}
const user = (id) => store.get('Users', id);

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
  assert.ok(list.length > 30 && list.find((x) => x.key === 'FishingCost').value === 30);
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
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { FishingCost: 10, FishingDailyCasts: 6, FishingLoot: [{ type: 'key', weight: 1, min: 1, max: 1 }] } } });
  store.update('Users', 1, { StardustCount: 100, KeyCount: 0, FishingDay: '', FishingCasts: 0 });
  const r = call('POST', 'fishing', { body: { userId: 1, action: 'cast', count: 5 } }).json;
  assert.equal(r.catches.length, 5);
  assert.equal(user(1).StardustCount, 50);
  assert.equal(user(1).KeyCount, 5);
  assert.equal(r.castsLeft, 1);
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast', count: 2 } }).json.error, 'daily_limit');
  store.update('Users', 1, { StardustCount: 5 });
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast' } }).json.error, 'not_enough_dust');
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json.table[0].chance, 100);
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

await test('unique : rarete creee, cartes forcees promo, sorties du coffre, une carte a chaque ligne, rattrapage', () => {
  const rarity = store.getAll('Rarities').find((r) => r.Key === 'unique');
  assert.ok(rarity, 'rarete creee au demarrage');
  assert.equal(Number(rarity.Weight) || 0, 0);
  assert.ok(rarity.SortOrder > Math.max(...store.getAll('Rarities').filter((r) => r.Key !== 'unique').map((r) => r.SortOrder || 0)));
  // Deux cartes Unique creees "a la main" (sans IsPromo) + une carte promo rangee au coffre.
  const a = store.create('Cards', { Name: 'Unique A', Rarity: rarity.id, Active: true });
  const b = store.create('Cards', { Name: 'Unique B', Rarity: rarity.id, Active: true });
  const promo = store.create('Cards', { Name: 'Promo', Rarity: 1, Active: true, IsPromo: true });
  const stuck = store.create('Pulls', { User: 1, Card: promo.id, SerialNumber: 1, Finish: 'normal', Quality: 'mint', InVault: true });
  const r0 = unique.syncUniqueCards(store);
  assert.deepEqual([r0.promoted, r0.released], [2, 1]);
  assert.ok(store.get('Cards', a.id).IsPromo && store.get('Cards', b.id).IsPromo);
  assert.equal(!!store.get('Pulls', stuck.id).InVault, false);
  const vault = (reward) => { const r = { status: 200, json: { unlocked: true, rows: [], reward } }; native.afterWorkflow('personal-vault', { body: { userId: 1 } }, r); return r.json; };
  const completeRow = () => store.create('VaultRewards', { User: 1, Card: 1, ClaimedAt: 1 });
  // Aucune ligne completee : rien n'est du.
  let j = vault(null);
  assert.deepEqual([j.uniqueGrants.length, j.unique.total, j.unique.remaining, j.unique.owed], [0, 2, 2, 0]);
  // Rattrapage : 3 lignes completees avant la rarete, 2 cartes Unique -> 2 donnees, 1 encore due.
  completeRow(); completeRow(); completeRow();
  j = vault(null);
  assert.deepEqual(j.uniqueGrants.map((c) => c.cardId).sort(), [a.id, b.id].sort());
  assert.equal(j.uniqueGrants[0].rarity.key, 'unique');
  assert.equal(j.uniqueGrants[0].quality, 'mint');
  assert.deepEqual([j.unique.remaining, j.unique.owed], [0, 1]);
  assert.equal(vault(null).uniqueGrants.length, 0, 'rien de plus tant qu il n y a pas de nouvelle carte');
  // Nouvelle carte Unique creee : la carte due arrive a la visite suivante.
  const c = store.create('Cards', { Name: 'Unique C', Rarity: rarity.id, Active: true });
  unique.syncUniqueCards(store);
  j = vault(null);
  assert.deepEqual([j.uniqueGrants.length, j.uniqueGrants[0].cardId, j.unique.owed], [1, c.id, 0]);
  // Ligne completee maintenant, plus aucune carte a gagner : due pour plus tard.
  completeRow();
  j = vault({ cardId: 1, boosters: 6, dust: 200 });
  assert.deepEqual([j.reward.uniqueCard, j.uniqueGrants.length, j.unique.owed], [null, 0, 1]);
  // Une nouvelle carte + une nouvelle ligne : la ligne du jour prend une carte, l'autre reste due.
  const d = store.create('Cards', { Name: 'Unique D', Rarity: rarity.id, Active: true, IsPromo: true });
  completeRow();
  j = vault({ cardId: 1, boosters: 6, dust: 200 });
  assert.deepEqual([j.reward.uniqueCard.cardId, j.uniqueGrants.length, j.unique.owed], [d.id, 0, 1]);
  assert.equal(store.getAll('Pulls').filter((p) => p.User === 1 && String(p.BatchId).startsWith('unique-')).length, 4);
  // Jamais comme carte de saison.
  assert.equal(call('POST', 'admin-season', { body: { discordId: ADMIN, action: 'setCard', season: '2026-10', cardId: a.id } }).json.error, 'unique_card_not_allowed');
});

store.db.close();
clean();
console.log(process.exitCode ? '\nNatif : echec(s).' : `\nNatif : ${passed} tests passes.`);
