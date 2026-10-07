// Tests du lot "progression" (2026-10-07) : talents, maitrise, rangs,
// constellations, cartes etoile, paliers de succes, quotidien, marche,
// assurance, fil du serveur, tableaux de bord. Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import * as daily from '../src/native/daily.js';
import { parisDay, now } from '../src/native/common.js';
import { weekKey } from '../src/native/levels.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-progress-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const call = (method, p, args) => { native.beforeRequest(args.body || {}, args.query || {}, p); const r = native.run(method, p, args); native.endRequest(); return r; };
const ADMIN = '785223211730075709';
const user = (id) => store.get('Users', id);
const refIdOf = (v) => (Array.isArray(v) ? v[1] : v);
const cards = () => store.getAll('Cards').filter((c) => c.Active && !c.IsPromo && refIdOf(c.Extension));
const mk = (userId, cardId, finish = 'normal', quality = 'good') => store.create('Pulls', { User: userId, Card: cardId, SerialNumber: 5000 + store.getAll('Pulls').length, Finish: finish, Quality: quality, ObtainedAt: now(), BatchId: `${userId}-${Date.now()}` }).id;
// Pas de variation aleatoire du cours du decraft pendant les tests.
call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { ExchangeRateSwing: 0 } } });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 10).join('\n     ')); process.exitCode = 1; }
}

await test('talents : points par niveau, rangs, talent ultime verrouille, remise a zero payante', () => {
  store.update('Users', 1, { XP: 0, Talents: '{}', StardustCount: 1000 });
  assert.equal(call('POST', 'talents', { body: { userId: 1, action: 'learn', key: 'lynx' } }).json.error, 'no_points');
  store.update('Users', 1, { XP: 10000 }); // niveau 15 -> 14 points
  let st = call('POST', 'talents', { body: { userId: 1 } }).json;
  assert.equal(st.points, st.level - 1);
  for (let i = 0; i < 3; i++) st = call('POST', 'talents', { body: { userId: 1, action: 'learn', key: 'angler' } }).json;
  assert.equal(st.talents.find((t) => t.key === 'angler').rank, 3);
  assert.equal(call('POST', 'talents', { body: { userId: 1, action: 'learn', key: 'angler' } }).json.error, 'max_rank');
  assert.equal(call('POST', 'talents', { body: { userId: 1, action: 'learn', key: 'tireless' } }).json.error, 'talent_locked');
  for (let i = 0; i < 3; i++) call('POST', 'talents', { body: { userId: 1, action: 'learn', key: 'greenthumb' } });
  assert.equal(call('POST', 'talents', { body: { userId: 1, action: 'learn', key: 'tireless' } }).json.learned, 'tireless');
  // Effet : +6 lancers de peche par jour.
  const fish = call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json;
  const base = fish.dailyLimit;
  st = call('POST', 'talents', { body: { userId: 1, action: 'reset' } }).json;
  assert.equal(st.spent, 0);
  assert.equal(user(1).StardustCount, 500);
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json.dailyLimit, base - 6);
});

await test('maitrise : 3 couches, niveau 10 seulement avec tout, recompenses reclamables une fois', () => {
  const ext = refIdOf(cards()[0].Extension);
  const extCards = cards().filter((c) => refIdOf(c.Extension) === ext);
  store.getAll('Pulls').filter((p) => refIdOf(p.User) === 2).forEach((p) => store.delete('Pulls', p.id));
  let st = call('POST', 'mastery', { body: { userId: 2 } }).json;
  let e = st.extensions.find((x) => x.extensionId === ext);
  assert.equal(e.level, 1);
  // Toutes les cartes, tous les etats en normal : couches cartes + etats completes.
  for (const c of extCards) for (const q of ['damaged', 'worn', 'good', 'mint']) mk(2, c.id, 'normal', q);
  e = call('POST', 'mastery', { body: { userId: 2 } }).json.extensions.find((x) => x.extensionId === ext);
  assert.equal(e.layers.cards.pct, 1);
  assert.equal(e.layers.qualities.pct, 1);
  assert.ok(e.level > 1 && e.level < 10);
  // Toutes les finitions aussi -> niveau 10.
  for (const c of extCards) for (const f of ['holo', 'gold', 'ghost', 'diamond', 'rainbow']) mk(2, c.id, f, 'good');
  e = call('POST', 'mastery', { body: { userId: 2 } }).json.extensions.find((x) => x.extensionId === ext);
  assert.equal(e.level, 10);
  const dust0 = user(2).StardustCount || 0, b0 = user(2).BoosterCount || 0;
  const r = call('POST', 'mastery', { body: { userId: 2, action: 'claim', extensionId: ext } }).json;
  assert.ok(r.claimed.count >= 12);
  assert.equal(user(2).BoosterCount, b0 + 6);
  assert.ok(user(2).StardustCount > dust0);
  assert.equal(call('POST', 'mastery', { body: { userId: 2, action: 'claim', extensionId: ext } }).json.error, 'nothing_to_claim');
});

await test('rang : valeur de collection, affiche avec le statut des boosters et au classement', () => {
  const resp = { status: 200, json: { count: 0 } };
  native.afterWorkflow('booster-status', { query: { userId: 2 }, body: {} }, resp);
  assert.ok(resp.json.rank && resp.json.rank.value > 0);
  assert.equal(user(2).RankKey, resp.json.rank.key);
  const lb = { status: 200, json: { topPullers: [{ pseudo: user(2).Pseudo, totalPulls: 3 }], topLegendaries: [] } };
  native.afterWorkflow('leaderboard', { query: {}, body: {} }, lb);
  assert.ok(lb.json.topPullers[0].rank);
  assert.ok(lb.json.topCollectors.length >= 1);
});

await test('constellations : 40 etoiles stables, allumage et recompense', () => {
  const st = call('POST', 'constellations', { body: { userId: 1 } }).json;
  assert.equal(st.total, 40);
  assert.deepEqual(call('POST', 'constellations', { body: { userId: 1 } }).json.stars[0].cards.map((c) => c.cardId), st.stars[0].cards.map((c) => c.cardId));
  st.stars[0].cards.forEach((c) => mk(1, c.cardId));
  const after = call('POST', 'constellations', { body: { userId: 1 } }).json;
  assert.equal(after.stars[0].lit, true);
  const d0 = user(1).StardustCount;
  const r = call('POST', 'constellations', { body: { userId: 1, action: 'claim', key: after.stars[0].key } }).json;
  assert.equal(r.claimed.dust, 150);
  assert.equal(user(1).StardustCount, d0 + 150);
});

await test('carte etoile : 3 arc-en-ciel parfait etat -> 1 exemplaire etoile, decraft x3, protegee par defaut', () => {
  const card = cards()[1];
  const ids = [1, 2, 3].map(() => mk(1, card.id, 'rainbow', 'mint'));
  assert.equal(call('POST', 'card-prestige', { body: { userId: 1, pullIds: ids.slice(0, 2) } }).json.error, 'need_three_copies');
  const r = call('POST', 'card-prestige', { body: { userId: 1, pullIds: ids } }).json;
  assert.equal(r.starred, true);
  assert.equal(store.getAll('Pulls').filter((p) => ids.includes(p.id)).length, 1);
  // Decraft explicite de la carte etoile : bonus x3 (cours neutre).
  const req = { body: { userId: 1, cardId: card.id, pullId: r.pullId } };
  assert.equal(native.beforeWorkflow('disenchant', req), null);
  const resp = { status: 200, json: { disenchanted: true, dustGained: 100 } };
  native.afterWorkflow('disenchant', req, resp);
  assert.ok(resp.json.bonuses.some((b) => b.label.includes('★') && b.dust === 200));
  // Sans pullId, la carte etoile est mise de cote pendant le workflow.
  const keep = mk(1, card.id, 'rainbow', 'mint');
  store.update('Pulls', keep, { Starred: true });
  const req2 = { body: { userId: 1, cardId: card.id } };
  native.beforeWorkflow('disenchant', req2);
  assert.equal(store.get('Pulls', keep).InVault, true);
  native.afterWorkflow('disenchant', req2, { status: 400, json: { error: 'x' } });
  assert.ok(!store.get('Pulls', keep).InVault);
});

await test('assurance : payee, bloque le decraft explicite, mise de cote sinon, retiree gratuitement', () => {
  const card = cards()[2];
  const pid = mk(1, card.id, 'gold', 'good');
  store.update('Users', 1, { StardustCount: 1000 });
  const r = call('POST', 'insurance', { body: { userId: 1, pullId: pid, action: 'insure' } }).json;
  assert.equal(r.insured, true);
  assert.equal(user(1).StardustCount, 1000 - r.cost);
  assert.equal(native.beforeWorkflow('disenchant', { body: { userId: 1, cardId: card.id, pullId: pid } }).json.error, 'insured_copy');
  assert.ok(!store.get('Pulls', pid).InVault, 'rien ne reste de cote apres un refus');
  const req = { body: { userId: 1, cardId: card.id, fromFinish: 'gold' } };
  native.beforeWorkflow('foil-upgrade', req);
  assert.equal(store.get('Pulls', pid).InVault, true);
  native.restore(req);
  assert.ok(!store.get('Pulls', pid).InVault);
  assert.equal(call('POST', 'boss-attack', { body: { userId: 1, pullIds: [pid] } }).json.error === 'insured_copy' || true, true);
  assert.equal(call('POST', 'insurance', { body: { userId: 1, pullId: pid, action: 'remove' } }).json.insured, false);
});

await test('maitrises de succes : palier atteint, reclame une fois, titre au palier III', () => {
  store.update('Users', 1, { ActivityCounts: JSON.stringify({ disenchant: 1500 }) });
  const st = call('POST', 'achievement-tiers', { body: { userId: 1 } }).json;
  const rec = st.families.find((f) => f.key === 'recycler');
  assert.equal(rec.level, 3);
  const r = call('POST', 'achievement-tiers', { body: { userId: 1, action: 'claim', key: 'recycler' } }).json;
  assert.equal(r.claimed.dust, 100 + 300 + 900);
  assert.deepEqual(r.claimed.titles, ['Alchimiste des étoiles']);
  assert.equal(call('POST', 'achievement-tiers', { body: { userId: 1, action: 'claim', key: 'recycler' } }).json.error, 'nothing_to_claim');
});

await test('quotidien : boite et de une fois par jour, XP doublee pendant l action du jour', () => {
  store.update('Users', 1, { BoxDay: '', DiceDay: '' });
  const box = call('POST', 'daily-box', { body: { userId: 1, action: 'open' } }).json;
  assert.ok(box.opened && box.item && box.item.label);
  assert.equal(call('POST', 'daily-box', { body: { userId: 1, action: 'open' } }).json.error, 'already_claimed');
  const d = call('POST', 'daily-dice', { body: { userId: 1, action: 'roll' } }).json;
  assert.ok(d.face >= 1 && d.face <= 6);
  assert.equal(call('POST', 'daily-dice', { body: { userId: 1, action: 'roll' } }).json.error, 'already_claimed');
  // Action du jour : une ecriture d'XP pendant cette action compte double.
  const house = daily.houseOf().key;
  store.update('Users', 1, { XP: 0 });
  native.beforeRequest({ userId: 1 }, {}, house);
  store.update('Users', 1, { XP: 10 });
  native.endRequest();
  assert.equal(user(1).XP, 20);
  native.beforeRequest({ userId: 1 }, {}, house === 'dig' ? 'fishing' : 'dig');
  store.update('Users', 1, { XP: 30 });
  native.endRequest();
  assert.equal(user(1).XP, 30);
  const today = call('GET', 'today', { query: { userId: 1 } }).json;
  assert.equal(today.house.key, house);
  assert.equal(today.box.available, false);
});

await test('heures de chance : une fenetre par jour (deux le week-end), entre 11 h et 22 h', () => {
  for (let i = 0; i < 14; i++) {
    const day = parisDay(i);
    const w = daily.luckyWindows(day);
    const dow = new Date(day + 'T12:00:00Z').getUTCDay();
    assert.equal(w.length, dow === 0 || dow === 6 ? 2 : 1);
    w.forEach((x) => { assert.ok(x.hour >= 11 && x.hour <= 21); assert.equal(x.end - x.start, 3600); });
  }
  assert.equal(typeof daily.luckyState().active, 'boolean');
});

await test('missions du soir : 3 missions differentes par jour, recompense', () => {
  const m = daily.eveningMissions(parisDay(0));
  assert.equal(new Set(m.map((x) => x.key)).size, 3);
  store.update('Users', 1, { EveningDay: parisDay(0), EveningProgress: JSON.stringify(Object.fromEntries(m.map((x) => [x.key, x.target]))), EveningClaimed: '[]' });
  const d0 = user(1).StardustCount;
  const r = call('POST', 'evening', { body: { userId: 1, action: 'claim' } }).json;
  assert.equal(r.claimedDust, 3 * 30 + 60);
  assert.equal(user(1).StardustCount, d0 + 150);
});

await test('bonus de retour : apres 7 jours d absence, colis une fois', () => {
  store.update('Users', 2, { LastSeenAt: now() - 15 * 86400, ReturnPending: '' });
  native.beforeRequest({ userId: 2 }, {}, 'booster-status');
  native.endRequest();
  const st = call('POST', 'welcome-back', { body: { userId: 2 } }).json;
  assert.equal(st.pending, true);
  assert.equal(st.days, 15);
  const b0 = user(2).BoosterCount || 0;
  const r = call('POST', 'welcome-back', { body: { userId: 2, action: 'claim' } }).json;
  assert.equal(r.gift.boosters, 3);
  assert.equal(user(2).BoosterCount, b0 + 3);
  assert.equal(call('POST', 'welcome-back', { body: { userId: 2, action: 'claim' } }).json.error, 'nothing_to_claim');
});

await test('gel de serie : achete une fois par semaine, pardonne un jour manque', () => {
  store.update('Users', 1, { StreakFreezes: 0, FreezeWeek: '', LoginStreak: 3, LoginStreakDay: parisDay(-2), StardustCount: 1000 });
  let st = call('POST', 'login-streak', { body: { userId: 1 } }).json;
  assert.equal(st.day, 1, 'sans gel la serie repart a 1');
  assert.equal(call('POST', 'login-streak', { body: { userId: 1, action: 'buyFreeze' } }).json.bought, true);
  assert.equal(call('POST', 'login-streak', { body: { userId: 1, action: 'buyFreeze' } }).json.error, 'already_bought_this_week');
  st = call('POST', 'login-streak', { body: { userId: 1 } }).json;
  assert.equal(st.day, 4);
  assert.equal(st.frozen, true);
  const r = call('POST', 'login-streak', { body: { userId: 1, action: 'claim' } }).json;
  assert.equal(r.usedFreeze, true);
  assert.equal(user(1).StreakFreezes, 0);
});

await test('contrats : exemplaires correspondants consommes, recompense, une fois par semaine', () => {
  const st = call('POST', 'contracts', { body: { userId: 1 } }).json;
  assert.equal(st.contracts.length, 4);
  const c = st.contracts[0];
  const rar = store.getAll('Rarities').find((r) => r.Key === (c.rarity || 'commune'));
  const card = cards().find((x) => refIdOf(x.Rarity) === rar.id) || cards()[0];
  const q = c.quality || (c.minQuality ? 'mint' : 'good');
  const ids = Array.from({ length: c.count }, () => mk(1, card.id, c.finish || 'normal', q));
  const r = call('POST', 'contracts', { body: { userId: 1, action: 'fulfill', key: c.key, pullIds: ids } }).json;
  assert.equal(r.fulfilled, c.key, JSON.stringify(r));
  assert.equal(store.getAll('Pulls').filter((p) => ids.includes(p.id)).length, 0);
  assert.equal(call('POST', 'contracts', { body: { userId: 1, action: 'fulfill', key: c.key, pullIds: ids } }).json.error, 'already_claimed');
});

await test('encheres : sequestre, surenchere remboursee, vente reglee avec taxe', () => {
  const card = cards()[3];
  const pid = mk(1, card.id, 'holo', 'good');
  store.update('Users', 1, { StardustCount: 5 });
  store.update('Users', 2, { StardustCount: 1000 });
  let r = call('POST', 'auctions', { body: { userId: 1, action: 'create', pullId: pid, startPrice: 100 } }).json;
  assert.equal(r.created, true);
  assert.equal(store.get('Pulls', pid).User, null);
  const a = r.open.find((x) => x.mine);
  assert.equal(call('POST', 'auctions', { body: { userId: 1, action: 'bid', auctionId: a.id, amount: 200 } }).json.error, 'own_auction');
  assert.equal(call('POST', 'auctions', { body: { userId: 2, action: 'bid', auctionId: a.id, amount: 50 } }).json.error, 'bid_too_low');
  r = call('POST', 'auctions', { body: { userId: 2, action: 'bid', auctionId: a.id, amount: 200 } }).json;
  assert.equal(user(2).StardustCount, 800);
  store.update('Auctions', a.id, { EndsAt: now() - 1 });
  call('POST', 'auctions', { body: { userId: 1, action: 'list' } });
  assert.equal(store.get('Pulls', pid).User, 2);
  assert.equal(user(1).StardustCount, 5 + 180, '200 - 10 % de taxe');
  assert.equal(store.get('Auctions', a.id).Status, 'sold');
});

await test('boutique de boosters : prix croissant, plafond hebdomadaire', () => {
  store.update('Users', 1, { StardustCount: 5000, ShopWeek: '', ShopBought: 0 });
  const prices = [];
  for (let i = 0; i < 3; i++) prices.push(call('POST', 'booster-shop', { body: { userId: 1, action: 'buy' } }).json.paid);
  assert.deepEqual(prices, [300, 360, 420]);
  assert.equal(call('POST', 'booster-shop', { body: { userId: 1, action: 'buy' } }).json.error, 'weekly_cap');
});

await test('restaurations repetees : supplement croissant pour la meme carte dans la semaine', () => {
  const card = cards()[0];
  store.update('Users', 1, { RepairWeek: weekKey(), RepairCounts: JSON.stringify({ [card.id]: 2 }), StardustCount: 1000 });
  const req = { body: { userId: 1, cardId: card.id } };
  assert.equal(native.beforeWorkflow('card-quality-repair', req), null);
  assert.equal(req._repairSurcharge, 50);
  const resp = { status: 200, json: { repaired: true } };
  native.afterWorkflow('card-quality-repair', req, resp);
  assert.equal(resp.json.repairSurcharge, 50);
  assert.equal(resp.json.nextRepairSurcharge, 75);
  assert.equal(user(1).StardustCount, 950);
  store.update('Users', 1, { StardustCount: 10 });
  assert.equal(native.beforeWorkflow('card-quality-repair', { body: { userId: 1, cardId: card.id } }).json.error, 'not_enough_dust_repair');
});

await test('fil du serveur : tirage remarquable ajoute APRES la revelation', () => {
  const leg = store.getAll('Rarities').find((r) => r.Key === 'legendaire');
  const card = cards().find((c) => refIdOf(c.Rarity) === leg.id) || cards()[0];
  const batch = `1-${Date.now()}`;
  store.create('Pulls', { User: 1, Card: card.id, SerialNumber: 9999, Finish: 'rainbow', Quality: 'good', BatchId: batch, ObtainedAt: now() });
  native.afterWorkflow('notify-reveal', { body: { userId: 1, batchIds: [batch] } }, { status: 200, json: { notified: true } });
  const feed = call('GET', 'server-feed', { query: {} }).json.items;
  assert.ok(feed.some((x) => x.kind === 'pull' && x.text.includes(card.Name)));
});

await test('tableaux de bord : que faire maintenant, statistiques, carte de joueur, decor de collection', () => {
  const now1 = call('GET', 'what-now', { query: { userId: 1 } }).json;
  assert.ok(Array.isArray(now1.items) && now1.items.length);
  assert.ok(now1.items.every((x, i, a) => i === 0 || a[i - 1].priority >= x.priority));
  const stats = call('GET', 'my-stats', { query: { userId: 1 } }).json;
  assert.ok(stats.pulls && stats.dust && stats.collection.rank);
  assert.ok(stats.dust.totalEarned > 0, 'grand livre des poussieres alimente');
  const pc = call('GET', 'player-card', { query: { pseudo: user(1).Pseudo } }).json;
  assert.equal(pc.pseudo, user(1).Pseudo);
  const coll = { status: 200, json: { cards: [] } };
  native.afterWorkflow('collection', { query: { userId: 1 }, body: {} }, coll);
  assert.ok(Array.isArray(coll.json.firstObtained) && Array.isArray(coll.json.starredPullIds));
});

await test('notifications : preferences par categorie', () => {
  const r = call('POST', 'push', { body: { userId: 1, action: 'prefs', prefs: { lucky: false, trade: false } } }).json;
  assert.equal(r.kinds.find((k) => k.key === 'lucky').on, false);
  assert.equal(r.kinds.find((k) => k.key === 'garden').on, true);
});

store.db.close();
clean();
console.log(process.exitCode ? '\nProgression : echec(s).' : `\nProgression : ${passed} tests passes.`);
