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

store.db.close();
clean();
console.log(process.exitCode ? '\nNatif : echec(s).' : `\nNatif : ${passed} tests passes.`);
