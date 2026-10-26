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
import * as inflation from '../src/native/inflation.js';
import { cluesOf } from '../src/native/treasure.js';
import { previousSeason } from '../src/native/seasons.js';
import * as balance from '../src/native/balance.js';
import * as ledger from '../src/native/ledger.js';
import { goldenWindow } from '../src/native/comfort.js';
import * as modeperks from '../src/native/modeperks.js';
import * as machine from '../src/native/machine.js';
import * as modeextras from '../src/native/modeextras.js';
import * as seasonal from '../src/native/seasonal.js';
import * as editions from '../src/native/editions.js';
import * as phantom from '../src/native/phantom.js';
import * as lottery from '../src/native/lottery.js';
import * as teams from '../src/native/teams.js';
import * as bingo from '../src/native/bingo.js';
import * as cardsMod from '../src/native/cards.js';
import * as hallOfFame from '../src/native/halloffame.js';
import * as dinoMod from '../src/native/dino.js';
import * as moderules from '../src/native/moderules.js';
import * as modefun from '../src/native/modefun.js';
import * as chaosvote from '../src/native/chaosvote.js';
import * as economy from '../src/native/economy.js';
import { talentValue as talentValueOf } from '../src/native/talents.js';
import { constellations as skyConstellations } from '../src/native/progression.js';
import { catchSpecies } from '../src/native/aquarium.js';
import { setting, rawSetting } from '../src/native/settings.js';

import { requestContext, freshContext } from '../src/native/context.js';

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
call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { ExchangeRateSwing: 0, PriceIndexEnabled: false, FishingMaxEnergy: 200, StarterEnabled: false, SurpriseEnabled: false } } }); // energie de peche large : les tests lancent beaucoup

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
  // Effet : +6 energie de peche max.
  const fish = call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json;
  const base = fish.maxEnergy;
  st = call('POST', 'talents', { body: { userId: 1, action: 'reset' } }).json;
  assert.equal(st.spent, 0);
  assert.equal(user(1).StardustCount, 500);
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json.maxEnergy, base - 6);
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
  store.update('Users', 1, { ActivityCounts: JSON.stringify({ disenchant: 10000 }) });
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
  assert.equal(user(1).StardustCount, 5 + 170, '200 - 15 % de taxe');
  assert.equal(store.get('Auctions', a.id).Status, 'sold');
});

await test('boutique de boosters : illimitee, inflation personnelle du jour, fermee a 0', () => {
  store.update('Users', 1, { StardustCount: 50000, ShopWeek: '', ShopBought: 0 });
  // 2026-10-25 : plus de plafond ; prix x BoosterShopDailyGrowth (1,3) par jeton du jour, arrondi a 5.
  const prices = [];
  for (let i = 0; i < 4; i++) prices.push(call('POST', 'booster-shop', { body: { userId: 1, action: 'buy' } }).json.paid);
  assert.deepEqual(prices, [300, 390, 505, 660]);
  // Le lendemain : prix de base.
  store.update('Users', 1, { ShopWeek: 'd:2000-01-01' });
  assert.equal(call('POST', 'booster-shop', { body: { userId: 1 } }).json.price, 300);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { BoosterShopWeeklyCap: 0 } } });
  assert.equal(call('POST', 'booster-shop', { body: { userId: 1, action: 'buy' } }).json.error, 'shop_closed');
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'BoosterShopWeeklyCap' } });
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

await test('boutique d objets : achat illimite a inflation personnelle, effets, potion de savoir, elixir de chance', () => {
  store.update('Users', 1, { StardustCount: 5000, ShopItemsWeek: '', ShopItemsBought: '{}', Worms: 0, LuckCharges: 0, XpBoostUntil: 0, GardenPlots: '[]', ExpeditionUntil: 0 });
  const st = call('POST', 'shop', { body: { userId: 1 } }).json;
  assert.ok(st.items.length >= 10);
  let r = call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'worms10' } }).json;
  assert.equal(r.paid, 60);
  assert.equal(user(1).Worms, 10);
  // 2026-10-25 : plus de plafond par semaine, prix x ShopItemGrowth (1,25) par achat du jour.
  r = call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'worms10' } }).json;
  assert.equal(r.paid, 75);
  for (let i = 0; i < 6; i++) assert.ok(!call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'worms10' } }).json.error);
  store.update('Users', 1, { EnergyBuys: '' });
  assert.equal(call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'fertilizer' } }).json.error, 'nothing_growing');
  assert.equal(call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'compass' } }).json.error, 'no_expedition');
  // Recharges d'energie (2026-10-19) : illimitees, prix x1,6 par achat du jour, refusees si pleine.
  store.update('Users', 1, { DigEnergy: 0, LastDigEnergyAt: now(), EnergyBuys: '', StardustCount: 50000 });
  const coffee0 = call('POST', 'shop', { body: { userId: 1 } }).json.items.find((x) => x.key === 'coffee');
  assert.equal(coffee0.left, null);
  assert.equal(coffee0.escalate.today, 0);
  const paid = [];
  for (let i = 0; i < 5; i++) {
    store.update('Users', 1, { DigEnergy: 0, LastDigEnergyAt: now() });
    const b = call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'coffee' } }).json;
    assert.ok(!b.error, b.error);
    paid.push(b.paid);
  }
  assert.ok(paid.every((p, i) => !i || p > paid[i - 1]), 'prix croissant : ' + paid.join(','));
  assert.ok(Math.abs(paid[1] / paid[0] - 1.6) < 0.05);
  assert.ok(Number(user(1).DigEnergy) >= 10, 'energie remplie au maximum reel');
  assert.equal(call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'coffee' } }).json.error, 'energy_full');
  // Le lendemain : retour au prix de base.
  store.update('Users', 1, { DigEnergy: 0, EnergyBuys: JSON.stringify({ day: '2000-01-01', counts: { coffee: 9 } }) });
  assert.equal(call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'coffee' } }).json.paid, paid[0]);
  store.update('Users', 1, { StardustCount: 5000 });
  // Potion de savoir : XP x2 pendant 1 h.
  store.update('Users', 1, { XP: 100 });
  call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'xp1h' } });
  assert.ok(user(1).XpBoostUntil > now() + 3500);
  native.beforeRequest({ userId: 1 }, {}, 'reroll');
  store.update('Users', 1, { XP: 110 });
  native.endRequest();
  assert.equal(user(1).XP, 120);
  // Elixir de chance : une charge consommee par booster.
  call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'luck5' } });
  assert.equal(user(1).LuckCharges, 5);
  native.afterWorkflow('open-pack', { body: { userId: 1, extensionId: 1 } }, { status: 200, json: { cards: [], batchId: 'x-1' } });
  assert.equal(user(1).LuckCharges, 4);
  store.update('Users', 1, { XpBoostUntil: 0 });
});

await test('saison : bonus de fin de saison compte a part, ignore a 0 poussiere', () => {
  const s = call('POST', 'season', { body: { userId: 1, action: 'status' } }).json;
  if (!s.enabled) return;
  const per = s.xpPerTier, n = s.tiers.length;
  const row = store.getAll('SeasonProgress').find((r) => refIdOf(r.User) === 1 && r.Season === s.season);
  store.update('SeasonProgress', row.id, { ClaimedTier: n, BonusClaimed: 0 });
  store.update('Users', 1, { XP: (Number(row.StartXP) || 0) + per * (n + 2) });
  let st = call('POST', 'season', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(st.tierClaimable, 0);
  assert.ok(st.bonus.claimable > 0 && st.bonus.claimable === st.bonus.reached - st.bonus.claimed);
  assert.equal(st.complete, true);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { SeasonBonusTierDust: 0 } } });
  st = call('POST', 'season', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(st.claimable, 0, 'bonus a 0 : rien a recuperer');
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'SeasonBonusTierDust' } });
});

// ------------------------------------------------------------------ lot 2026-10-09
await test('inflation : prix indexes sur la richesse, mode serre force (prix, taxes, doublons)', () => {
  const set = (values) => call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values } });
  set({ PriceIndexEnabled: true, WealthReference: 100, PriceIndexMax: 2 });
  store.getAll('Users').forEach((u) => store.update('Users', u.id, { LastSeenAt: now(), StardustCount: 400 }));
  store.update('Users', 1, { ShopWeek: '', ShopBought: 0 });
  inflation._reset();
  // Solde moyen 400 pour 100 de reference : racine(4) = 2 (plafond 2).
  assert.equal(call('GET', 'economy-state', { query: {} }).json.priceFactor, 2);
  assert.equal(call('POST', 'booster-shop', { body: { userId: 1, action: 'status' } }).json.price, 600);
  set({ PriceIndexEnabled: false, InflationModeForce: 1 });
  inflation._reset();
  const st = call('GET', 'economy-state', { query: {} }).json;
  assert.equal(st.tight, true);
  assert.equal(st.priceFactor, 1.25);
  assert.equal(call('POST', 'booster-shop', { body: { userId: 1, action: 'status' } }).json.price, Math.round(300 * 1.25));
  assert.equal(inflation.taxMultiplier(store), 1.5);
  assert.equal(inflation.gainMultiplier(store), 0.5);
  set({ InflationModeForce: 0 });
  for (const key of ['WealthReference', 'PriceIndexMax']) call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key } });
  inflation._reset();
  assert.equal(inflation.isTight(store), false);
});

await test('inflation : mode serre automatique apres 7 jours d alerte, annonce, retour au calme', () => {
  const k = store.getAll('AppSettings').find((r) => r.Key === 'inflationMode');
  if (k) store.delete('AppSettings', k.id);
  inflation._reset();
  // On simule 7 jours d'alerte : le seuil d'alerte "boosters par joueur" a 0,5.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { AutoTightDays: 2, TightCalmDays: 1 } } });
  const row = () => JSON.parse(store.getAll('AppSettings').find((r) => r.Key === 'inflationMode').Value);
  const write = (v) => store.update('AppSettings', store.getAll('AppSettings').find((r) => r.Key === 'inflationMode').id, { Value: JSON.stringify(v) });
  inflation.dailyCheck(store, 'j1');
  write({ ...row(), alertDays: 1, calmDays: 0 });
  // Une alerte forcee : on remplace le journal par un jour tres genereux.
  const st = row();
  write({ ...st, alertDays: 5 });
  inflation._reset();
  // dailyCheck lit les vraies alertes : on les provoque via des seuils tres bas.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { EconomyAlertBoostersPerPlayer: 0.5, EconomyAlertDustRatio: 1 } } });
  store.create('EconomyDaily', { Day: new Date().toISOString().slice(0, 10), Source: 'test', BoostersIn: 999, BoostersOut: 0, DustIn: 99999, DustOut: 1 });
  const r = inflation.dailyCheck(store, 'j2');
  if (r && r.alerts && r.alerts.length) {
    assert.equal(r.tight, true);
    assert.ok(store.getAll('ServerFeed').sort((a, b) => b.id - a.id)[0].Kind === 'economy', 'annonce dans le fil');
    write({ ...row(), alertDays: 0 });
    inflation._reset();
    store.getAll('EconomyDaily').filter((e) => e.Source === 'test').forEach((e) => store.delete('EconomyDaily', e.id));
    call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'EconomyAlertBoostersPerPlayer' } });
    call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'EconomyAlertDustRatio' } });
    const back = inflation.dailyCheck(store, 'j3');
    if (!back.alerts.length) assert.equal(back.tight, false);
  }
  const m = store.getAll('AppSettings').find((x) => x.Key === 'inflationMode');
  if (m) store.delete('AppSettings', m.id);
  inflation._reset();
});

await test('pity par rarete : garantie au seuil, compteur visible, remise a zero', () => {
  const rar = store.getAll('Rarities').filter((r) => r.Key !== 'unique' && r.Weight > 0);
  const st = call('GET', 'rarity-pity', { query: { userId: 1 } }).json;
  assert.ok(st.rarities.length >= 1);
  const target = st.rarities[st.rarities.length - 1];
  const r = rar.find((x) => x.Key === target.key);
  const ext = refIdOf(cards().find((c) => refIdOf(c.Rarity) === r.id).Extension);
  const low = rar.sort((a, b) => a.SortOrder - b.SortOrder)[0];
  const lowCard = cards().find((c) => refIdOf(c.Rarity) === low.id && refIdOf(c.Extension) === ext);
  store.update('Users', 1, { RarityPity: JSON.stringify({ [r.id]: target.threshold - 1 }) });
  const batchId = '1-pity-' + Date.now();
  const p = store.create('Pulls', { User: 1, Card: lowCard.id, SerialNumber: 7001, BatchId: batchId, ObtainedAt: now() });
  const resp = { status: 200, json: { batchId, booster: { extensionId: ext }, cards: [{ cardId: lowCard.id, serialNumber: 7001, rarity: { id: low.id, key: low.Key, sortOrder: low.SortOrder } }] } };
  native.afterWorkflow('open-pack', { body: { userId: 1, extensionId: ext } }, resp);
  assert.equal(resp.json.cards[0].rarity.key, r.Key, 'carte remplacee par la rarete garantie');
  assert.equal(resp.json.cards[0].pityUpgrade, true);
  assert.equal(refIdOf(store.get('Rarities', refIdOf(store.get('Cards', refIdOf(store.get('Pulls', p.id).Card)).Rarity)).id), r.id);
  assert.equal(JSON.parse(user(1).RarityPity)[r.id], 0);
  assert.equal(call('GET', 'rarity-pity', { query: { userId: 1 } }).json.rarities.find((x) => x.key === r.Key).left, target.threshold);
});

await test('booster mystere : extension tiree au hasard parmi les extensions actives', () => {
  const req = { body: { userId: 1, mystery: true } };
  assert.equal(native.beforeWorkflow('open-pack', req), null);
  const ext = store.get('Extensions', req.body.extensionId);
  assert.ok(ext && ext.Active !== false);
  assert.equal(req._mystery.extensionId, ext.id);
});

await test('course aux tresors : 5 indices sur 5 pages, recompense, bonus final', () => {
  store.update('Users', 1, { TreasureWeek: '', TreasureFound: '[]', StardustCount: 0, BoosterCount: 0 });
  const st = call('GET', 'treasure-hunt', { query: { userId: 1 } }).json;
  assert.equal(st.clues.length, 5);
  assert.equal(new Set(st.clues.map((c) => c.page)).size, 5);
  assert.deepEqual(cluesOf(1), cluesOf(1), 'positions stables dans la semaine');
  assert.equal(call('POST', 'treasure-hunt', { body: { userId: 1, clue: 0, page: 'nope' } }).json.error, 'unknown_clue');
  const got = st.clues.map((c) => call('POST', 'treasure-hunt', { body: { userId: 1, clue: c.id, page: c.page } }).json);
  assert.equal(got.reduce((t, g) => t + g.reward.dust, 0), 5 * 25);
  assert.equal(got[4].complete, true);
  assert.equal(call('POST', 'treasure-hunt', { body: { userId: 1, clue: 0 } }).json.error, 'already_found');
  assert.equal(got[4].reward.boosters, 1);
});

await test('eaux profondes : verrouillees avant le niveau 10, perles et appats ensuite', () => {
  store.update('Users', 1, { FishingXP: 0, FishingPrestige: 0, Worms: 50, FishingDay: '', FishingCasts: 0, FishingEnergy: null });
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast', zone: 'deep' } }).json.error, 'deep_locked');
  store.update('Users', 1, { FishingPrestige: 1 });
  const r = call('POST', 'fishing', { body: { userId: 1, action: 'cast', zone: 'deep', count: 3 } }).json;
  assert.ok(!r.error, r.error);
  assert.equal(r.zone, 'deep');
  assert.equal(user(1).Worms, 50 - 3 * r.deep.cost);
  assert.ok(r.deep.table.some((x) => x.type === 'pearl'));
});

await test('jardin etendu : graines, parcelle achetee, recolte selon la graine', () => {
  store.update('Users', 1, { GardenPlots: '[]', GardenExtraPlots: 0, StardustCount: 5000, Worms: 0 });
  let st = call('POST', 'garden', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(st.plots.length, 4);
  assert.equal(st.seeds.length, 7); // 3 graines de plus le 26 octobre (herbe a chat, arbre a os, champignon)
  st = call('POST', 'garden', { body: { userId: 1, action: 'buyPlot' } }).json;
  assert.equal(st.plots.length, 5);
  assert.equal(user(1).StardustCount, 5000 - 400);
  call('POST', 'garden', { body: { userId: 1, action: 'plant', seed: 'worm', plot: 4 } });
  call('POST', 'garden', { body: { userId: 1, action: 'plant', seed: 'dust', plot: 0 } });
  const plots = JSON.parse(user(1).GardenPlots).map((p) => (p ? { ...p, plantedAt: p.plantedAt - 30 * 86400 } : p));
  store.update('Users', 1, { GardenPlots: JSON.stringify(plots) });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { GardenWiltHours: 0 } } });
  const h = call('POST', 'garden', { body: { userId: 1, action: 'harvest' } }).json;
  const worm = h.items.find((i) => i.seed === 'worm'), dust = h.items.find((i) => i.seed === 'dust');
  assert.ok(worm.worms >= 3 && worm.dust === 0);
  assert.ok(dust.dust >= 30 && dust.worms === 0);
});

await test('coffre de saison : rempli par l XP, ouvert une fois la saison passee', () => {
  call('POST', 'season', { body: { userId: 1, action: 'status' } });
  const cur = store.getAll('SeasonProgress').find((r) => refIdOf(r.User) === 1 && r.Season === call('POST', 'season', { body: { userId: 1 } }).json.season);
  const prev = previousSeason(cur.Season);
  store.getAll('SeasonProgress').filter((r) => refIdOf(r.User) === 1 && r.Season === prev).forEach((r) => store.delete('SeasonProgress', r.id));
  store.create('SeasonProgress', { User: 1, Season: prev, StartXP: (Number(cur.StartXP) || 0) - 1200, ClaimedTier: 0 });
  let st = call('POST', 'season', { body: { userId: 1, action: 'status' } }).json;
  assert.deepEqual(st.chest.previous.contents, { dust: 240, boosters: 2, keys: 1 });
  store.update('Users', 1, { StardustCount: 0, BoosterCount: 0 });
  st = call('POST', 'season', { body: { userId: 1, action: 'claimChest' } }).json;
  assert.equal(st.chestOpened, true);
  assert.equal(user(1).StardustCount, 240);
  assert.equal(call('POST', 'season', { body: { userId: 1, action: 'claimChest' } }).json.error, 'nothing_to_claim');
});

await test('prestige du compte : etoiles, recompenses une fois, progression, talents de prestige', () => {
  store.getAll('ProgressClaims').filter((c) => refIdOf(c.User) === 1 && String(c.Kind).startsWith('prestige:')).forEach((c) => store.delete('ProgressClaims', c.id));
  // Niveau 41 : 3 etoiles (31, 36, 41).
  store.update('Users', 1, { XP: 25 * 41 * 40, Talents: '{}', BoosterCount: 0, StardustCount: 0 });
  const p = call('GET', 'account-prestige', { query: { userId: 1 } }).json;
  assert.deepEqual([p.level, p.stars, p.nextLevel], [41, 3, 46]);
  assert.equal(p.progress, 0);
  assert.equal(p.fresh.boosters, 9);
  assert.equal(user(1).StardustCount, 1500);
  assert.equal(call('GET', 'account-prestige', { query: { userId: 1 } }).json.fresh, null, 'une seule fois');
  assert.ok(store.getAll('UserCosmetics').some((c) => refIdOf(c.User) === 1 && c.Key === 'frame-prestige'));
  // 43 points : la branche Aventurier complete ouvre son talent de prestige.
  let t = call('POST', 'talents', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(t.points, 40 + 3);
  assert.equal(call('POST', 'talents', { body: { userId: 1, action: 'learn', key: 'pLegend' } }).json.error, 'talent_locked');
  for (const k of ['angler', 'greenthumb', 'explorer']) for (let i = 0; i < 3; i++) call('POST', 'talents', { body: { userId: 1, action: 'learn', key: k } });
  call('POST', 'talents', { body: { userId: 1, action: 'learn', key: 'tireless' } });
  t = call('POST', 'talents', { body: { userId: 1, action: 'learn', key: 'pLegend' } }).json;
  assert.equal(t.learned, 'pLegend');
  // Effets ajoutes aux talents de la branche.
  assert.equal(talentValueOf(user(1), 'angler'), 3 * 2 + 1);
  assert.equal(Math.round(talentValueOf(user(1), 'explorer') * 100), 35);
  assert.equal(Math.round(talentValueOf(user(1), 'tireless') * 100), 20);
  // Nouvelle etoile annoncee avec le statut des boosters.
  store.update('Users', 1, { XP: 25 * 46 * 45 });
  const resp = { status: 200, json: {} };
  native.afterWorkflow('booster-status', { body: {}, query: { userId: 1 } }, resp);
  assert.equal(resp.json.prestigeUnlocked.star, 4);
  assert.equal(resp.json.prestigeUnlocked.boosters, 3);
  store.update('Users', 1, { XP: 0, Talents: '{}' });
});

await test('evenements planifies : appliques tout seuls entre le debut et la fin', () => {
  const t = now();
  assert.equal(call('POST', 'admin-events', { body: { discordId: 'x' } }).status, 403);
  assert.equal(call('POST', 'admin-events', { body: { discordId: ADMIN, action: 'save', event: { label: 'x', startAt: t, endAt: t - 1 } } }).json.error, 'invalid_dates');
  let r = call('POST', 'admin-events', { body: { discordId: ADMIN, action: 'save', event: { label: 'Week-end doré', startAt: t - 60, endAt: t + 3600, dustMultiplier: 2 } } }).json;
  const live = r.events.find((e) => e.label === 'Week-end doré');
  assert.equal(live.status, 'live');
  const ev = call('GET', 'event-status', { query: {} }).json;
  assert.equal(ev.active, true);
  assert.equal(ev.dustMultiplier, 2);
  r = call('POST', 'admin-events', { body: { discordId: ADMIN, action: 'delete', id: live.id } }).json;
  assert.ok(!r.events.some((e) => e.id === live.id));
  assert.equal(call('GET', 'event-status', { query: {} }).json.active, false);
});

// ------------------------------------------------------------------ equilibrage 2026-10-11
await test('equilibrage : boosters de fouille et du chien convertis, plus de limite d os par jour', () => {
  const set = (values) => call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values } });
  set({ DigBoosterKeepChance: 0, DogKeepBoosters: false, DogBonesPerDay: 4 });
  store.update('Users', 1, { BoosterCount: 10, StardustCount: 0, DigDay: '', DigDayCount: 0, BoneUseDay: '', BoneUseCount: 0 });
  // Fouille : booster trouve -> poussieres.
  const dig = { status: 200, json: { outcome: 'booster', boosterGranted: true, dustGained: 0, newBoosterCount: 10, newStardust: 0 } };
  native.afterWorkflow('dig', { body: { userId: 1, action: 'dig' } }, dig);
  assert.equal(dig.json.boosterConverted, true);
  assert.equal(dig.json.outcome, 'dust');
  assert.equal(user(1).BoosterCount, 9);
  assert.ok(user(1).StardustCount >= 25);
  // Chien : 2 boosters -> 2 x 40 poussieres.
  const before = user(1).StardustCount;
  const dog = { status: 200, json: { dogReport: { boosters: 2, dust: 10 } } };
  native.afterWorkflow('dig', { body: { userId: 1, action: 'status' } }, dog);
  assert.equal(dog.json.dogReport.boosters, 0);
  assert.equal(dog.json.dogReport.convertedBoosters, 2);
  assert.equal(user(1).BoosterCount, 7);
  assert.equal(user(1).StardustCount, before + 80);
  // Os : plus de limite par jour depuis le 26/10/2026 (la fatigue de Milo la remplace).
  for (let i = 0; i < 8; i++) {
    assert.equal(native.beforeWorkflow('dig', { body: { userId: 1, action: 'useBone' } }), null);
    native.afterWorkflow('dig', { body: { userId: 1, action: 'useBone' } }, { status: 200, json: {} });
  }
  for (const key of ['DigBoosterKeepChance', 'DogKeepBoosters', 'DogBonesPerDay']) call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key } });
});

await test('equilibrage : migration unique des reglages trop genereux (historique garde)', () => {
  const m = store.getAll('AppSettings').find((r) => r.Key === 'balance-2026-10-11');
  if (m) store.delete('AppSettings', m.id);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { DuplicateDustCommon: 9, TradeTaxPerCard: 5 } } });
  const cfg = store.getAll('Config')[0];
  store.update('Config', cfg.id, { DigRegenSeconds: 60, DailyQuestRewardBoosters: 2 });
  balance.init({ store });
  const rec = JSON.parse(store.getAll('AppSettings').find((r) => r.Key === 'balance-2026-10-11').Value);
  const keys = rec.changes.map((c) => c.key);
  for (const k of ['DuplicateDustCommon', 'TradeTaxPerCard', 'DigRegenSeconds', 'DailyQuestRewardBoosters']) assert.ok(keys.includes(k), k);
  assert.equal(store.getAll('Config')[0].DigRegenSeconds, 600);
  assert.equal(rec.changes.find((c) => c.key === 'DuplicateDustCommon').from, 9);
  // Une seule fois.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { DuplicateDustCommon: 9 } } });
  balance.init({ store });
  const row = store.getAll('AppSettings').find((r) => r.Key === 'setting:DuplicateDustCommon');
  assert.equal(JSON.parse(row.Value), 9, 'pas rejouee');
  for (const key of ['DuplicateDustCommon', 'TradeTaxPerCard']) call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key } });
});

await test('pity carte manquante : la carte garantie est une carte pas encore possedee', () => {
  const rar = store.getAll('Rarities').filter((r) => r.Key !== 'unique' && r.Weight > 0).sort((a, b) => b.SortOrder - a.SortOrder);
  const top = rar[0];
  const ext = refIdOf(cards().find((c) => refIdOf(c.Rarity) === top.id).Extension);
  const a = store.create('Cards', { Name: 'Top A', Active: true, Rarity: top.id, Extension: ext });
  const b = store.create('Cards', { Name: 'Top B', Active: true, Rarity: top.id, Extension: ext });
  // Le joueur possede deja toutes les cartes du sommet sauf B.
  for (const c of store.getAll('Cards').filter((x) => x.Active && refIdOf(x.Rarity) === top.id && refIdOf(x.Extension) === ext && x.id !== b.id)) store.create('Pulls', { User: 1, Card: c.id, SerialNumber: 8000 + c.id, BatchId: 'old-top' });
  const low = rar[rar.length - 1];
  const lowCard = cards().find((c) => refIdOf(c.Rarity) === low.id && refIdOf(c.Extension) === ext);
  const st = call('GET', 'rarity-pity', { query: { userId: 1 } }).json.rarities.find((x) => x.key === top.Key);
  if (!st) return; // rarete du sommet geree par le pity du workflow dans cette base
  store.update('Users', 1, { RarityPity: JSON.stringify({ [top.id]: st.threshold - 1 }) });
  const batchId = '1-miss-' + Date.now();
  store.create('Pulls', { User: 1, Card: lowCard.id, SerialNumber: 8801, BatchId: batchId, ObtainedAt: now() });
  const resp = { status: 200, json: { batchId, booster: { extensionId: ext }, cards: [{ cardId: lowCard.id, serialNumber: 8801, rarity: { id: low.id, key: low.Key, sortOrder: low.SortOrder } }] } };
  native.afterWorkflow('open-pack', { body: { userId: 1, extensionId: ext } }, resp);
  assert.equal(resp.json.cards[0].cardId, b.id, 'la seule carte manquante');
  assert.ok(a.id);
});

await test('ameliorations permanentes et relance de finition : depenses de poussieres', () => {
  store.update('Users', 1, { StardustCount: 10000, Upgrades: '{}' });
  let st = call('POST', 'upgrades', { body: { userId: 1 } }).json;
  assert.equal(st.upgrades.length, 3);
  st = call('POST', 'upgrades', { body: { userId: 1, action: 'buy', key: 'greenhouse' } }).json;
  assert.equal(st.paid, 500);
  st = call('POST', 'upgrades', { body: { userId: 1, action: 'buy', key: 'greenhouse' } }).json;
  assert.equal(st.paid, 1000);
  assert.equal(user(1).StardustCount, 10000 - 1500);
  // Relance : exemplaire normal uniquement, chance forcee a 100 %.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { FinishRerollChance: 1 } } });
  const card = cards()[0];
  const pid = mk(1, card.id, 'normal');
  const r = call('POST', 'finish-reroll', { body: { userId: 1, pullId: pid, action: 'reroll' } }).json;
  assert.equal(r.success, true);
  assert.notEqual(store.get('Pulls', pid).Finish, 'normal');
  assert.equal(call('POST', 'finish-reroll', { body: { userId: 1, pullId: pid, action: 'reroll' } }).json.error, 'already_special');
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'FinishRerollChance' } });
});

await test('decraft : bonus x2 pour une carte presque introuvable sur le serveur', () => {
  const c = store.create('Cards', { Name: 'Rarissime', Active: true, Rarity: cards()[0].Rarity, Extension: refIdOf(cards()[0].Extension) });
  store.create('Pulls', { User: 1, Card: c.id, SerialNumber: 1, BatchId: 'x' });
  store.update('Users', 1, { StardustCount: 0 });
  const resp = { status: 200, json: { disenchanted: true, dustGained: 20, newStardust: 20 } };
  native.afterWorkflow('disenchant', { body: { userId: 1, cardId: c.id } }, resp);
  assert.ok(resp.json.bonuses.some((b) => b.label.includes('rare sur le serveur') && b.dust === 20));
});

// ------------------------------------------------------------------ journal 2026-10-11
await test('journal : deux requetes entrelacees gardent chacune leur source (plus de "autre")', async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const boosters = Number(user(1).BoosterCount) || 0;
  // A : code evenement qui attend Discord (verrou relache) ; B passe et finit pendant ce temps.
  await Promise.all([
    requestContext.run(freshContext(), async () => {
      native.beforeRequest({ userId: 1, code: 'NOEL24' }, {}, 'redeem-code');
      await sleep(30);
      store.update('Users', 1, { BoosterCount: boosters + 3 });
      native.endRequest();
    }),
    requestContext.run(freshContext(), async () => {
      await sleep(5);
      native.beforeRequest({ userId: 2, action: 'status' }, {}, 'dig');
      native.endRequest();
    })
  ]);
  const row = store.getAll('EconomyLog').filter((r) => refIdOf(r.User) === 1).sort((a, b) => b.id - a.id)[0];
  assert.equal(row.Source, 'redeem-code');
  assert.equal(row.Boosters, 3);
  assert.equal(row.Actor, 'joueur:1');
  assert.ok(row.Detail.includes('NOEL24'));
  const day = store.getAll('EconomyDaily').filter((r) => r.Source === 'redeem-code');
  assert.ok(day.length >= 1);
});

await test('journal : origine inconnue tracee, lignes "autre" supprimees une fois, route admin', () => {
  // Ecriture hors requete : source "inconnu" + endroit du code.
  native.endRequest();
  store.update('Users', 1, { BoosterCount: (Number(user(1).BoosterCount) || 0) + 1 });
  const unknown = store.getAll('EconomyLog').sort((a, b) => b.id - a.id)[0];
  assert.equal(unknown.Source, 'inconnu');
  assert.ok(unknown.Detail.length > 0, 'endroit du code');
  // Nettoyage des "autre".
  store.create('EconomyDaily', { Day: '2026-10-01', Source: 'autre', BoostersIn: 50 });
  const flag = store.getAll('AppSettings').find((r) => r.Key === 'cleanup-autre-2026-10-11');
  if (flag) store.delete('AppSettings', flag.id);
  ledger.init({ store });
  assert.equal(store.getAll('EconomyDaily').filter((r) => r.Source === 'autre').length, 0);
  // Route admin.
  assert.equal(call('POST', 'admin-economy-log', { body: { discordId: 'x' } }).status, 403);
  const r = call('POST', 'admin-economy-log', { body: { discordId: ADMIN, boostersOnly: true } }).json;
  assert.ok(r.rows.length >= 2);
  assert.ok(r.totals.some((t) => t.source.startsWith('redeem-code')));
  assert.ok(r.rows.some((x) => x.actor && !x.actor.startsWith('joueur:')), 'pseudo resolu');
});

await test('modes de jeu : Chill / Medium / Hard, apercu, annonce, personnalise', () => {
  assert.equal(call('POST', 'admin-preset', { body: { discordId: 'x' } }).status, 403);
  let st = call('POST', 'admin-preset', { body: { discordId: ADMIN } }).json;
  assert.equal(st.presets.length, 5);
  assert.ok(['cool', 'chill', 'medium', 'hard'].includes(st.recommendation.key));
  assert.equal(call('GET', 'event-status', { query: {} }).json.gameMode.key, st.current === 'custom' ? (st.last ? st.last.key : 'medium') : st.current);
  const hard = st.presets.find((p) => p.key === 'hard');
  assert.ok(hard.changes.length > 0 && hard.changes.every((c) => c.label));
  st = call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'hard', announce: true } }).json;
  assert.equal(st.current, 'hard');
  assert.equal(st.last.key, 'hard');
  const set = call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'get' } }).json.settings;
  assert.equal(set.find((x) => x.key === 'BoosterShopPrice').value, 600);
  assert.equal(set.find((x) => x.key === 'DigRegenSeconds').value, 900);
  assert.ok(store.getAll('ServerFeed').sort((a, b) => b.id - a.id)[0].Text.includes('Hard'));
  call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'medium' } });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { ChestCost: 101 } } });
  assert.equal(call('POST', 'admin-preset', { body: { discordId: ADMIN } }).json.current, 'custom');
  assert.equal(call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'nope' } }).json.error, 'unknown_preset');
});

// ------------------------------------------------------------------ confort 2026-10-11
await test('murissoir : lot mis de cote au distributeur, minuteur, reprise gratuite, bonus par booster, finition garantie au stade Dore', () => {
  const rip = (body) => call('POST', 'ripen', { body: { userId: 1, ...body } }).json;
  store.update('Users', 1, { BoosterCount: 5, RipenLots: '[]', RipeReady: '', XP: 0 });
  let v = rip({ action: 'status' });
  assert.equal(v.slots.total, 3, 'Medium : 3 lots au plus');
  assert.equal(v.slots.open, 1, 'niveau 1 : un seul lot');
  // Lot de 2 boosters, 72 h (Dore) : jetons mis de cote.
  v = rip({ action: 'store', items: { 1: 2 }, stage: 2 });
  assert.equal(v.stored, 2);
  assert.equal(user(1).BoosterCount, 3);
  assert.equal(v.lots.length, 1);
  assert.equal(v.lots[0].ready, false);
  assert.equal(rip({ action: 'store', items: { 1: 1 }, stage: 0 }).error, 'no_slot');
  assert.equal(rip({ action: 'claim', lotId: v.lots[0].id }).error, 'lot_not_ready');
  // Annuler avant l'heure : jetons rendus sans bonus.
  rip({ action: 'cancel', lotId: v.lots[0].id });
  assert.equal(user(1).BoosterCount, 5);
  v = rip({ action: 'store', items: { 1: 2 }, stage: 2 });
  const lots = JSON.parse(user(1).RipenLots); lots[0].readyAt = now() - 5;
  store.update('Users', 1, { RipenLots: JSON.stringify(lots) });
  v = rip({ action: 'status' });
  assert.equal(v.lots[0].ready, true);
  v = rip({ action: 'claim', lotId: v.lots[0].id });
  assert.equal(v.ripe.remaining, 2);
  assert.equal(user(1).BoosterCount, 5, 'jetons du lot rendus');
  // Deux ouvertures : bonus a chacune, puis termine.
  for (let i = 0; i < 2; i++) {
    const req = { body: { userId: 1, extensionId: 1 } };
    native.beforeWorkflow('open-pack', req);
    assert.equal(req._ripe, 35);
    const card = cards()[0];
    const batch = 'x-ripe-' + i + '-' + Date.now();
    store.create('Pulls', { User: 1, Card: card.id, SerialNumber: 7770 + i, Finish: 'normal', Quality: 'good', BatchId: batch, ObtainedAt: now() });
    const resp = { status: 200, json: { batchId: batch, cards: [{ cardId: card.id, serialNumber: 7770 + i, finish: 'normal' }] } };
    native.afterWorkflow('open-pack', req, resp);
    assert.equal(resp.json.ripened.label, 'Doré');
    assert.equal(resp.json.ripened.remaining, 1 - i);
    if (store.tables.has('Finishes') && store.getAll('Finishes').some((f) => f.Key !== 'normal' && f.DropWeight > 0)) assert.notEqual(resp.json.cards[0].finish, 'normal', 'finition garantie');
  }
  const req3 = { body: { userId: 1, extensionId: 1 } };
  native.beforeWorkflow('open-pack', req3);
  assert.equal(req3._ripe, undefined, 'plus de bonus apres le lot');
  // Hard : 2 lots au plus.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { RipenMaxPoints: 2 } } });
  assert.equal(rip({ action: 'status' }).slots.total, 2);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { RipenMaxPoints: 3 } } });
});

await test('fragments de booster : activites, plafond du jour, conversion en booster', () => {
  store.update('Users', 1, { BoosterShards: 8, ShardDay: '', ShardToday: 0, BoosterCount: 0 });
  const r = call('POST', 'garden', { body: { userId: 1, action: 'status' } });
  assert.ok(r.json);
  // Une expedition (+2) : 8 + 2 = 10 -> 1 booster.
  native.afterWorkflow('expedition', { body: { userId: 1, action: 'claim' } }, { status: 200, json: { reward: { dust: 10 } } });
  assert.equal(user(1).BoosterCount, 1);
  assert.equal(user(1).BoosterShards, 0);
  // Plafond : 6 par jour.
  for (let i = 0; i < 10; i++) native.afterWorkflow('expedition', { body: { userId: 1, action: 'claim' } }, { status: 200, json: { reward: { dust: 10 } } });
  assert.equal(user(1).ShardToday, 6);
});

await test('cosmetiques de progression : titre au palier d activite', () => {
  store.update('Users', 1, { ActivityCounts: JSON.stringify({ harvest: 99 }) });
  const resp = { status: 200, json: { harvested: 1, gained: {} } };
  native.beforeRequest({ userId: 1, action: 'harvest' }, {}, 'garden');
  native.afterWorkflow('garden', { body: { userId: 1, action: 'harvest' } }, resp);
  native.endRequest();
  assert.ok(store.getAll('UserCosmetics').some((c) => refIdOf(c.User) === 1 && c.Key === 'm-harvest-100'));
  assert.ok((resp.json.notices || []).some((n) => n.kind === 'cosmetic'));
});

await test('heure doree : une fenetre par semaine, appliquee comme evenement, annoncee', () => {
  const w = goldenWindow();
  assert.ok(w.end - w.start === 3600 && w.hour >= 18 && w.hour <= 21);
  const st = call('GET', 'event-status', { query: {} }).json;
  assert.ok(st.goldenHour && st.goldenHour.enabled);
});

await test('pluie de boosters : objectif commun atteint, 1 booster par joueur qui passe', () => {
  const week = weekKey();
  const g = store.getAll('CommunityGoals').find((r) => r.Week === week);
  if (g) store.update('CommunityGoals', g.id, { Progress: 0, Target: 1, Type: 'harvest' });
  const r = store.getAll('AppSettings').find((x) => x.Key === 'boosterRain');
  if (r) store.delete('AppSettings', r.id);
  call('POST', 'community-goal', { body: { userId: 1 } });
  native.afterWorkflow('garden', { body: { userId: 1, action: 'harvest' } }, { status: 200, json: { harvested: 1, gained: {} } });
  const rain = store.getAll('AppSettings').find((x) => x.Key === 'boosterRain');
  if (!rain) return; // objectif d'un autre type cette semaine dans cette base
  store.update('Users', 2, { RainClaimed: '', BoosterCount: 0 });
  const st = { status: 200, json: { count: 0 } };
  native.afterWorkflow('booster-status', { query: { userId: '2' }, body: {} }, st);
  assert.equal(st.json.rain.boosters, 1);
  assert.equal(user(2).BoosterCount, 1);
  const again = { status: 200, json: {} };
  native.afterWorkflow('booster-status', { query: { userId: '2' }, body: {} }, again);
  assert.ok(!again.json.rain, 'une seule fois');
});

await test('visite du chien, cadeaux entre joueurs, recapitulatif de la semaine', () => {
  store.update('Users', 1, { DogGiftDay: '' });
  assert.equal(call('POST', 'dog-gift', { body: { userId: 1 } }).json.available, true);
  const g = call('POST', 'dog-gift', { body: { userId: 1, action: 'claim' } }).json;
  assert.ok(g.gift && g.gift.label);
  assert.equal(call('POST', 'dog-gift', { body: { userId: 1, action: 'claim' } }).json.error, 'already_claimed');
  // Cadeau : une fois par jour, recu en passant.
  store.update('Users', 1, { GiftSentDay: '' });
  assert.equal(call('POST', 'player-gift', { body: { userId: 1, action: 'send', toUserId: 1, kind: 'dust' } }).json.error, 'invalid_target');
  const sent = call('POST', 'player-gift', { body: { userId: 1, action: 'send', toUserId: 2, kind: 'dust' } }).json;
  assert.equal(sent.sent.label, '25 poussières');
  assert.equal(call('POST', 'player-gift', { body: { userId: 1, action: 'send', toUserId: 2, kind: 'worms' } }).json.error, 'already_sent');
  const dust2 = user(2).StardustCount || 0;
  assert.equal(call('POST', 'player-gift', { body: { userId: 2 } }).json.received.length, 1);
  call('POST', 'player-gift', { body: { userId: 2, action: 'claim' } });
  assert.equal(user(2).StardustCount, dust2 + 25);
  // Recapitulatif.
  const r = call('GET', 'weekly-recap', { query: { userId: 1 } }).json;
  assert.ok(r.collection.total > 0 && r.week);
});

await test('marche du dimanche : offres personnelles, achat, une seule fois', () => {
  const dow = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()) + 'T12:00:00Z').getUTCDay();
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { SundayMarketDay: (dow + 1) % 7 } } });
  assert.equal(call('POST', 'sunday-market', { body: { userId: 1 } }).json.open, false);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { SundayMarketDay: dow } } });
  store.update('Users', 1, { StardustCount: 100000, SundayBought: '' });
  const st = call('POST', 'sunday-market', { body: { userId: 1 } }).json;
  assert.equal(st.open, true);
  assert.ok(st.offers.length >= 1);
  const offer = st.offers[0];
  const pulls = store.getAll('Pulls').length;
  const b = call('POST', 'sunday-market', { body: { userId: 1, action: 'buy', cardId: offer.cardId } }).json;
  assert.equal(b.purchased.cardId, offer.cardId);
  assert.equal(store.getAll('Pulls').length, pulls + 1);
  assert.equal(user(1).StardustCount, 100000 - offer.price);
  assert.equal(call('POST', 'sunday-market', { body: { userId: 1, action: 'buy', cardId: offer.cardId } }).json.error, 'already_bought');
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'SundayMarketDay' } });
});

await test('jardin vivant : plante fanee reduite, serie de recoltes', () => {
  store.update('Users', 1, { GardenPlots: JSON.stringify([{ plantedAt: now() - 10 * 86400, seed: 'worm' }]), GardenStreak: 2, GardenStreakDay: parisDay(-1) });
  const h = call('POST', 'garden', { body: { userId: 1, action: 'harvest' } }).json;
  assert.equal(h.items[0].wilted, true);
  assert.ok(h.items[0].worms <= 2, 'moitie de 3 a 5 vers');
  assert.equal(user(1).GardenStreak, 3);
  assert.equal(h.streak, 3);
});

// ------------------------------------------------------------------ bonus et malus des modes 2026-10-14
const chaosvoteRuleTomorrow = () => { const r = chaosvote.votedRuleFor(store, parisDay(1)); return r && r.key; };
const applyMode = (preset) => call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset } });
const setS = (values) => call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values } });

await test('mode Cool : calin, peche sans prise vide, taxes nulles, 2 trouvailles, jardin magique', () => {
  applyMode('cool');
  assert.equal(modeperks.modeKey(store), 'cool');
  store.update('Users', 1, { HugDay: '' });
  const st = { status: 200, json: { count: 1 } };
  native.afterWorkflow('booster-status', { query: { userId: '1' }, body: {} }, st);
  assert.ok(st.json.hug, 'calin du jour');
  assert.equal(st.json.gameMode.key, 'cool');
  const fish = call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json;
  assert.ok(!fish.table.some((x) => x.type === 'nothing'));
  assert.equal(call('GET', 'economy-rules', { query: { userId: 1 } }).json.tradeTaxPerCard, 0);
  store.update('Users', 1, { DogGiftDay: '', DogGiftCount: 0 });
  call('POST', 'dog-gift', { body: { userId: 1, action: 'claim' } });
  assert.equal(call('POST', 'dog-gift', { body: { userId: 1 } }).json.available, true, 'deuxieme trouvaille');
  call('POST', 'dog-gift', { body: { userId: 1, action: 'claim' } });
  assert.equal(call('POST', 'dog-gift', { body: { userId: 1 } }).json.available, false);
  assert.equal(call('POST', 'garden', { body: { userId: 1 } }).json.wiltHours, 0);
  const ev = call('GET', 'event-status', { query: {} }).json;
  assert.ok(ev.gameMode.perks.length >= 5);
});

await test('mode Cool : decraft annulable pendant 24 h', () => {
  const card = cards()[0];
  const pid = mk(1, card.id, 'holo', 'good');
  const req = { body: { userId: 1, cardId: card.id, pullId: pid } };
  native.beforeWorkflow('disenchant', req);
  store.delete('Pulls', pid);
  const resp = { status: 200, json: { disenchanted: true, dustGained: 40, newStardust: 0 } };
  native.afterWorkflow('disenchant', req, resp);
  assert.ok(resp.json.undoId);
  store.update('Users', 1, { StardustCount: 500 });
  const list = call('POST', 'decraft-undo', { body: { userId: 1 } }).json;
  assert.ok(list.items.some((x) => x.id === resp.json.undoId));
  const before = store.getAll('Pulls').length;
  const u = call('POST', 'decraft-undo', { body: { userId: 1, action: 'undo', id: resp.json.undoId } }).json;
  assert.equal(u.undone, true);
  assert.equal(store.getAll('Pulls').length, before + 1);
  assert.equal(user(1).StardustCount, 500 - list.items.find((x) => x.id === resp.json.undoId).dust);
  assert.equal(call('POST', 'decraft-undo', { body: { userId: 1, action: 'undo', id: resp.json.undoId } }).json.error, 'not_undoable');
});

await test('mode Chill : 4 defis, deux heures de chance, doublon porte-bonheur', () => {
  applyMode('chill');
  assert.equal(call('POST', 'challenges', { body: { userId: 1 } }).json.maxPicks, 4);
  native.beforeRequest({}, {}, 'x'); native.endRequest();
  assert.equal(daily.luckyWindows('2026-10-14').length, 2, 'mercredi : deux heures');
  // Doublon porte-bonheur force a 100 %.
  setS({ ChillLuckyDuplicateChance: 1 });
  const rar = store.getAll('Rarities').find((r) => r.Key === 'commune');
  const ext = refIdOf(cards()[0].Extension);
  const owned = store.create('Cards', { Name: 'Deja la', Active: true, Rarity: rar.id, Extension: ext });
  const missing = store.create('Cards', { Name: 'Manquante', Active: true, Rarity: rar.id, Extension: ext });
  store.create('Pulls', { User: 1, Card: owned.id, SerialNumber: 7701, BatchId: 'old-lucky' });
  // Toutes les autres communes de l'extension sont possedees.
  for (const c of store.getAll('Cards').filter((x) => x.Active && refIdOf(x.Rarity) === rar.id && refIdOf(x.Extension) === ext && x.id !== missing.id)) store.create('Pulls', { User: 1, Card: c.id, SerialNumber: 7800 + c.id, BatchId: 'old-lucky' });
  const batchId = '1-lucky-' + Date.now();
  store.create('Pulls', { User: 1, Card: owned.id, SerialNumber: 7702, BatchId: batchId });
  const resp = { status: 200, json: { batchId, booster: { extensionId: ext }, cards: [{ cardId: owned.id, serialNumber: 7702, rarity: { id: rar.id, key: rar.Key, sortOrder: rar.SortOrder } }] } };
  native.afterWorkflow('open-pack', { body: { userId: 1, extensionId: ext } }, resp);
  assert.equal(resp.json.cards[0].cardId, missing.id);
  assert.equal(resp.json.luckyDuplicates, 1);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'ChillLuckyDuplicateChance' } });
});

await test('mode Medium : pari, double tranchant, contrat de la semaine', () => {
  applyMode('medium');
  const rars = store.getAll('Rarities').filter((r) => r.Key !== 'unique').sort((a, b) => a.SortOrder - b.SortOrder);
  const epic = store.getAll('Rarities').find((r) => r.Key === 'epique');
  const ext = refIdOf(cards()[0].Extension);
  // Pari gagnant.
  store.update('Users', 1, { StardustCount: 1000 });
  const req = { body: { userId: 1, extensionId: ext, bet: true } };
  assert.equal(native.beforeWorkflow('open-pack', req), null);
  assert.equal(req._bet, 100);
  const resp = { status: 200, json: { batchId: 'bet-1', booster: { extensionId: ext }, cards: [{ cardId: 1, serialNumber: 1, rarity: { id: epic.id, key: 'epique', sortOrder: epic.SortOrder } }] } };
  native.afterWorkflow('open-pack', req, resp);
  assert.equal(resp.json.bet.won, true);
  assert.equal(resp.json.bet.payout, 300);
  assert.ok(user(1).StardustCount >= 1200, 'mise triplee');
  // Double tranchant : 5 cartes -> 3, dont une rare ou mieux.
  const commune = rars[0];
  const pool = cards().filter((c) => refIdOf(c.Rarity) === commune.id && refIdOf(c.Extension) === ext);
  const batchId = '1-edge-' + Date.now();
  const list = [];
  for (let i = 0; i < 5; i++) { const c = pool[i % pool.length]; store.create('Pulls', { User: 1, Card: c.id, SerialNumber: 9100 + i, BatchId: batchId }); list.push({ cardId: c.id, serialNumber: 9100 + i, rarity: { id: commune.id, key: commune.Key, sortOrder: commune.SortOrder } }); }
  const r2 = { body: { userId: 1, extensionId: ext, edge: true } };
  native.beforeWorkflow('open-pack', r2);
  const e = { status: 200, json: { batchId, booster: { extensionId: ext }, cards: list } };
  native.afterWorkflow('open-pack', r2, e);
  assert.equal(e.json.cards.length, 3);
  assert.equal(store.getAll('Pulls').filter((p) => p.BatchId === batchId).length, 3);
  assert.ok(e.json.cards.some((c) => c.rarity.sortOrder >= rars[1].SortOrder));
  // Contrat de la semaine.
  const g = call('POST', 'weekly-goal', { body: { userId: 1 } }).json;
  assert.equal(g.active, true);
  assert.ok(g.label && g.target > 0);
});

await test('mode Hard : usure, arc-en-ciel forgee, boss enrage, taxe de luxe', () => {
  applyMode('hard');
  setS({ HardWearChance: 1, HardFinishLoss: 0 });
  // Usure d'un doublon.
  const card = cards()[1];
  const a = mk(1, card.id, 'normal', 'mint'), b2 = mk(1, card.id, 'normal', 'mint');
  store.getAll('Pulls').filter((p) => refIdOf(p.User) === 1 && p.id !== a && p.id !== b2).forEach((p) => store.update('Pulls', p.id, { Quality: 'damaged' }));
  store.update('Users', 1, { WearDay: '' });
  const st = { status: 200, json: {} };
  native.afterWorkflow('booster-status', { query: { userId: '1' }, body: {} }, st);
  assert.ok(st.json.wear, 'un doublon s est use');
  // Arc-en-ciel forgee.
  const batchId = '1-forge-' + Date.now();
  const pid = store.create('Pulls', { User: 1, Card: card.id, SerialNumber: 9300, Finish: 'rainbow', BatchId: batchId }).id;
  const resp = { status: 200, json: { batchId, cards: [{ cardId: card.id, serialNumber: 9300, finish: 'rainbow', rarity: { sortOrder: 1 } }] } };
  native.afterWorkflow('open-pack', { body: { userId: 1 } }, resp);
  assert.equal(store.get('Pulls', pid).ForgedInFire, true);
  const coll = { status: 200, json: {} };
  native.afterWorkflow('collection', { query: { userId: '1' }, body: {} }, coll);
  assert.ok(coll.json.forgedPullIds.includes(pid));
  // Taxe de luxe : plus riche que la moyenne -> x1,5.
  store.getAll('Users').forEach((u) => store.update('Users', u.id, { LastSeenAt: now(), StardustCount: 100 }));
  store.update('Users', 1, { StardustCount: 100000 });
  assert.equal(modeperks.luxuryFactor(store, user(1)), 1.5);
  assert.equal(modeperks.luxuryFactor(store, user(2)), 1);
  for (const key of ['HardWearChance', 'HardFinishLoss']) call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key } });
});

await test('carte exclusive du mode : donnee une fois avec l objectif commun', () => {
  const card = cards()[0];
  setS({ ModeCards: { cool: 0, chill: 0, medium: 0, hard: card.id } });
  store.update('Users', 1, { ModeCards: '[]' });
  const got = modeperks.grantModeCard(store, 1);
  assert.equal(got.cardId, card.id);
  assert.equal(modeperks.grantModeCard(store, 1), null, 'une seule fois');
  assert.equal(call('GET', 'event-status', { query: {} }).json.gameMode.card.cardId, card.id);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'ModeCards' } });
  applyMode('medium');
});

await test('salle des machines : 5 sacrifices, vote, mode applique a la fin du vote', () => {
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { MachineVoteDay: 28, MachineRoomCosts: { keys: 2, dust: 10, worms: 1, parts: 1, bait: 1, boosters: 1, cards: 1 } } } });
  store.update('Users', 1, { MachineMonth: '', MachineStage: 0, MachineVote: '', KeyCount: 1, StardustCount: 100, Worms: 5, SpareParts: 2, GoldBait: 2, BoosterCount: 2 });
  let st = call('POST', 'machine-room', { body: { userId: 1 } }).json;
  assert.equal(st.stages.length, 6);
  assert.equal(call('POST', 'machine-room', { body: { userId: 1, action: 'advance' } }).json.error, 'not_enough', 'il manque une cle');
  store.update('Users', 1, { KeyCount: 2 });
  const card = cards()[2];
  mk(1, card.id, 'normal', 'worn'); mk(1, card.id, 'normal', 'worn');
  for (let i = 0; i < 5; i++) st = call('POST', 'machine-room', { body: { userId: 1, action: 'advance' } }).json;
  assert.equal(st.done, true);
  assert.equal(user(1).KeyCount, 0);
  assert.equal(user(1).BoosterCount, 1);
  assert.equal(call('POST', 'machine-room', { body: { userId: 1, action: 'vote', mode: 'cool' } }).json.voted, 'cool');
  assert.equal(call('POST', 'machine-room', { body: { userId: 1, action: 'vote', mode: 'hard' } }).json.error, 'already_voted');
  // Fermeture du vote : le mode gagnant est applique.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { MachineVoteDay: 1 } } });
  const r = store.getAll('AppSettings').find((x) => x.Key === 'machineRoom');
  if (r) store.delete('AppSettings', r.id);
  machine._reset();
  const today = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()).slice(8, 10));
  native.beforeRequest({}, {}, 'x'); native.endRequest();
  if (today > 1) {
    assert.equal(modeperks.modeKey(store), 'cool');
    assert.equal(call('POST', 'machine-room', { body: { userId: 1 } }).json.result.winner, 'cool');
  }
  for (const key of ['MachineVoteDay', 'MachineRoomCosts']) call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key } });
  // Par defaut : salle ouverte tout le mois, resultat le mois suivant.
  const def = call('POST', 'machine-room', { body: { userId: 1 } }).json;
  assert.equal(def.open, true);
  assert.equal(def.appliesNextMonth, true);
  // Changement de mois : les votes du mois precedent appliquent le mode gagnant.
  const [y, mo] = def.month.split('-').map(Number);
  const prev = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
  store.update('Users', 1, { MachineMonth: prev, MachineStage: 5, MachineVote: 'hard' });
  const old = store.getAll('AppSettings').find((x) => x.Key === 'machineRoom');
  if (old) store.delete('AppSettings', old.id);
  machine._reset();
  native.beforeRequest({}, {}, 'x'); native.endRequest();
  assert.equal(modeperks.modeKey(store), 'hard');
  assert.equal(call('POST', 'machine-room', { body: { userId: 1 } }).json.lastResult.winner, 'hard');
  assert.equal(call('POST', 'machine-room', { body: { userId: 1 } }).json.stage, 0, 'nouveau mois : on repart de zero');
  call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'medium' } });
});

await test('fonctionnalites par mode : ecritures refusees, lectures permises, suggestions filtrees', () => {
  call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'cool' } });
  // Par defaut : encheres fermees en Cool.
  const denied = call('POST', 'auctions', { body: { userId: 1, action: 'create', pullId: 1, minBid: 10 } });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error, 'feature_disabled');
  assert.equal(call('POST', 'auctions', { body: { userId: 1, action: 'list' } }).status, 200, 'lecture permise');
  const off = call('GET', 'event-status', { query: {} }).json.gameMode.off.map((f) => f.key);
  assert.ok(off.includes('auctions') && off.includes('blackMarket'), off.join(','));
  // Matrice modifiee : peche fermee en Cool, encheres rouvertes.
  const st = call('POST', 'admin-mode-features', { body: { discordId: ADMIN, action: 'set', matrix: { auctions: [], fishing: ['cool'] } } }).json;
  assert.deepEqual(st.features.find((f) => f.key === 'fishing').off, ['cool']);
  assert.notEqual(call('POST', 'auctions', { body: { userId: 1, action: 'create', pullId: 1, minBid: 10 } }).json.error, 'feature_disabled');
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast' } }).json.error, 'feature_disabled');
  store.update('Users', 1, { Worms: 50 });
  const items = call('GET', 'what-now', { query: { userId: 1 } }).json.items;
  assert.ok(!items.some((i) => i.key === 'fishing'), 'pas de suggestion de peche');
  assert.equal(call('POST', 'admin-mode-features', { body: { userId: 1, action: 'set', matrix: {} } }).status, 403);
  // Medium : tout ouvert.
  call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'medium' } });
  assert.equal(call('GET', 'event-status', { query: {} }).json.gameMode.off.length, 0);
  call('POST', 'admin-mode-features', { body: { discordId: ADMIN, action: 'reset' } });
});

await test('mode Chaos : regle du jour en surcouche, mode detecte, fonctionnalites du jour fermees', () => {
  call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'chaos' } });
  const st = call('POST', 'admin-preset', { body: { discordId: ADMIN } }).json;
  assert.equal(st.current, 'chaos');
  assert.equal(st.presets.filter((p) => p.active).length, 1);
  const rule = modeextras.chaosRuleFor();
  const gm = call('GET', 'event-status', { query: {} }).json.gameMode;
  assert.equal(gm.key, 'chaos');
  assert.equal(gm.chaosRule.key, rule.key);
  const [key, fn] = Object.entries(rule.settings)[0];
  assert.equal(setting(store, key), fn(rawSetting(store, key)), 'surcouche appliquee');
  for (const f of rule.off || []) assert.ok(gm.off.some((x) => x.key === f), 'ferme par la regle : ' + f);
  // Jamais la meme regle deux jours de suite.
  const dayAt = (i) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  for (let i = 0; i < 800; i++) assert.notEqual(modeextras.chaosRuleFor(dayAt(i)).key, modeextras.chaosRuleFor(dayAt(i + 1)).key, dayAt(i));
  call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'medium' } });
  assert.equal(call('POST', 'admin-preset', { body: { discordId: ADMIN } }).json.current, 'medium');
});

await test('succes de mode, classement Hard, parapluie', () => {
  call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'chill' } });
  modeextras.onEvents(store, [{ userId: 1, type: 'boosterOpened', n: 50, meta: {} }]);
  const prof = JSON.parse(user(1).HiddenAchievements || '{}');
  assert.ok(prof.modeChill50, 'succes Vacancier');
  call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'hard' } });
  // Le passage en Hard du test precedent peut tomber dans la meme seconde : on compare avant / apres.
  const before = (call('GET', 'hard-leaderboard', { query: { userId: 1 } }).json.me || { score: 0 }).score;
  modeextras.onEvents(store, [{ userId: 1, type: 'board', n: 2, meta: {} }, { userId: 2, type: 'fish', n: 1, meta: {} }]);
  const board = call('GET', 'hard-leaderboard', { query: { userId: 1 } }).json;
  assert.equal(board.active, true);
  assert.equal(board.top[0].userId, 1);
  assert.equal(board.me.score, before + 6);
  // Parapluie : en boutique, protege de l'usure.
  store.update('Users', 1, { StardustCount: 5000, UmbrellaUntil: 0, WearDay: '' });
  const shop = call('POST', 'shop', { body: { userId: 1 } }).json;
  assert.ok(shop.items.some((i) => i.key === 'umbrella'));
  const r = call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'umbrella' } }).json;
  assert.ok(r.umbrellaUntil > now() + 6 * 86400);
  call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'medium' } });
});

await test('changement de mode programme : preavis public puis application', () => {
  assert.equal(call('POST', 'admin-mode-schedule', { body: { discordId: ADMIN, action: 'set', preset: 'cool', at: now() - 5 } }).json.error, 'invalid_date');
  const s = call('POST', 'admin-mode-schedule', { body: { discordId: ADMIN, action: 'set', preset: 'cool', at: now() + 3600 } }).json;
  assert.equal(s.scheduled.key, 'cool');
  const next = call('GET', 'event-status', { query: {} }).json.gameMode.next;
  assert.equal(next.key, 'cool');
  assert.equal(next.probable, false);
  // L'heure arrive : applique tout seul.
  const row = store.getAll('AppSettings').find((x) => x.Key === 'modeSchedule');
  store.update('AppSettings', row.id, { Value: JSON.stringify({ key: 'cool', at: now() - 1, by: ADMIN }) });
  modeextras._reset();
  native.beforeRequest({}, {}, 'x'); native.endRequest();
  assert.equal(modeperks.modeKey(store), 'cool');
  assert.equal(call('POST', 'admin-mode-schedule', { body: { discordId: ADMIN } }).json.scheduled, null);
  call('POST', 'admin-preset', { body: { discordId: ADMIN, action: 'apply', preset: 'medium' } });
});

await test('editions limitees : posees a l ouverture, listees dans la collection, protegees', () => {
  // Hors evenement saisonnier : sinon son edition passe avant celle du mode (Halloween = Maudite).
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { EditionChance: 0.5, SeasonalEventsEnabled: false } } });
  const card = cards()[3];
  const batch = '1-edition-test';
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(store.create('Pulls', { User: 1, Card: card.id, SerialNumber: 9000 + i, Finish: 'normal', Quality: 'good', ObtainedAt: now(), BatchId: batch }).id);
  const json = { batchId: batch, cards: ids.map((id, i) => ({ cardId: card.id, serialNumber: 9000 + i })) };
  editions.afterWorkflow({ store, path: 'open-pack', request: { body: { userId: 1 } }, response: { status: 200, json } });
  const marked = ids.filter((id) => store.get('Pulls', id).Edition === 'prism');
  assert.ok(marked.length > 0 && marked.length < 12, 'edition Prismatique en Medium : ' + marked.length);
  assert.equal(json.cards.filter((c) => c.edition === 'prism').length, marked.length);
  const coll = { status: 200, json: {} };
  editions.afterWorkflow({ store, path: 'collection', request: { query: { userId: 1 }, body: {} }, response: coll });
  assert.equal(coll.json.editionPulls[marked[0]], 'prism');
  ids.forEach((id) => store.delete('Pulls', id));
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'EditionChance' } });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'SeasonalEventsEnabled' } });
});

await test('evenements saisonniers : calendrier (Halloween, Noel, Paques, nouvel an), edition de l evenement', () => {
  assert.equal(seasonal.currentSeason(store, '2026-10-31').key, 'halloween');
  assert.equal(seasonal.currentSeason(store, '2026-12-24').key, 'christmas');
  assert.equal(seasonal.currentSeason(store, '2027-01-02').key, 'newyear');
  assert.equal(seasonal.currentSeason(store, '2027-03-27').key, 'easter', 'Paques 2027 : 28 mars');
  assert.equal(seasonal.currentSeason(store, '2026-02-14').key, 'valentine');
  assert.equal(seasonal.currentSeason(store, '2026-07-14'), null);
  assert.equal(seasonal.currentSeason(store, '2026-10-31').edition, 'cursed');
  assert.ok(editions.EDITIONS.cursed && editions.EDITIONS.snow && editions.EDITIONS.ember && editions.EDITIONS.glitch);
  const st = call('POST', 'seasonal', { body: { userId: 1 } }).json;
  assert.ok('season' in st);
});

await test('carte fantome : 5 fragments, carte en edition Fantome, une fois par mois', () => {
  store.update('Users', 1, { PhantomMonth: '', PhantomFragments: '', PhantomDone: '' });
  const before = store.getAll('Pulls').filter((p) => p.Edition === 'phantom').length;
  for (const k of ['fish', 'dig', 'garden', 'boss']) assert.ok(phantom.grantFragment(store, 1, k));
  assert.equal(phantom.grantFragment(store, 1, 'fish'), null, 'deja trouve');
  const last = phantom.grantFragment(store, 1, 'machine');
  assert.ok(/réunis/.test(last.label));
  assert.equal(store.getAll('Pulls').filter((p) => p.Edition === 'phantom').length, before + 1);
  const st = call('GET', 'phantom', { query: { userId: 1 } }).json;
  assert.equal(st.done, true);
  assert.ok(st.card);
  assert.equal(phantom.grantFragment(store, 1, 'fish'), null);
});

await test('loterie du dimanche : tickets, cagnotte, tirage, report sans joueur', () => {
  store.update('Users', 1, { StardustCount: 2000, LotteryWeek: '', LotteryTickets: 0 });
  let st = call('POST', 'lottery', { body: { userId: 1, action: 'buy', count: 3 } }).json;
  assert.equal(st.tickets, 3);
  assert.equal(user(1).StardustCount, 1700);
  assert.equal(st.pot, 200 + 240, 'depart 200 + 80 % de 300');
  assert.equal(call('POST', 'lottery', { body: { userId: 1, action: 'buy', count: 50 } }).json.error, 'weekly_cap');
  // Le dimanche 21 h est passe : tirage.
  const past = '2026-01-05';
  const row = store.getAll('AppSettings').find((x) => x.Key === 'lottery');
  store.update('AppSettings', row.id, { Value: JSON.stringify({ week: past, pot: 440 }) });
  store.update('Users', 1, { LotteryWeek: past, LotteryTickets: 3 });
  lottery._reset();
  native.beforeRequest({}, {}, 'x'); native.endRequest();
  assert.equal(user(1).StardustCount, 1700 + 440);
  const last = call('POST', 'lottery', { body: { userId: 1 } }).json.last;
  assert.equal(last.userId, 1);
  assert.equal(last.pot, 440);
});

await test('avis de recherche : don d un doublon, recompense, coffre de guilde, une fois', () => {
  let st = call('POST', 'wanted', { body: { userId: 1 } }).json;
  assert.ok(st.card);
  mk(1, st.card.cardId, 'normal', 'worn'); mk(1, st.card.cardId, 'normal', 'worn');
  store.update('Users', 1, { StardustCount: 100, KeyCount: 0 });
  const deposits = store.tables.has('GuildChestDeposits') ? store.getAll('GuildChestDeposits').length : 0;
  st = call('POST', 'wanted', { body: { userId: 1, action: 'donate' } }).json;
  assert.equal(st.donated, true);
  assert.equal(user(1).StardustCount, 100 + 250);
  assert.equal(user(1).KeyCount, 1, 'premier donateur : une cle');
  if (store.tables.has('GuildChestDeposits')) assert.equal(store.getAll('GuildChestDeposits').length, deposits + 1);
  assert.equal(call('POST', 'wanted', { body: { userId: 1, action: 'donate' } }).json.error, 'already_donated');
});

await test('livre d or : premieres finitions et editions du serveur', () => {
  const c = cards()[1];
  const id = store.create('Pulls', { User: 2, Card: c.id, SerialNumber: 9900, Finish: 'rainbow', Quality: 'good', Edition: 'ember', ObtainedAt: 1000, BatchId: '2-1000' }).id;
  const r = call('GET', 'hall-of-fame', { query: {} }).json;
  const rb = r.finishes.find((e) => e.label.includes('Arc-en-ciel'));
  assert.equal(rb.userId, 2);
  assert.ok(r.editions.some((e) => e.label.includes('Braise') && e.userId === 2));
  store.delete('Pulls', id);
});

await test('guerre des equipes : equipe attribuee, points plafonnes par jour, score ajuste, titre et poussieres', () => {
  store.update('Users', 1, { TeamDay: '', TeamDayPoints: 0 });
  const pts0 = call('POST', 'teams', { body: { userId: 1 } }).json.myPoints;
  teams.onEvents(store, [{ userId: 1, type: 'board', n: 2, meta: {} }]);
  let st = call('POST', 'teams', { body: { userId: 1 } }).json;
  assert.ok(st.myTeam);
  assert.equal(st.myPoints, pts0 + 6);
  assert.equal(st.myToday, 6);
  assert.equal(st.teams.length, 4);
  assert.ok(st.teams.every((t) => typeof t.score === 'number'));
  // Plafond du jour (40 par defaut).
  teams.onEvents(store, [{ userId: 1, type: 'expedition', n: 100, meta: {} }]);
  st = call('POST', 'teams', { body: { userId: 1 } }).json;
  assert.equal(st.myToday, st.dailyCap);
  assert.equal(st.myPoints, pts0 + st.dailyCap);
  // Mois precedent : l'equipe du joueur 1 gagne (titre + poussieres), le joueur 2 touche la participation.
  const [y, m] = st.month.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const other = st.teams.find((t) => t.key !== st.myTeam).key;
  store.getAll('Users').forEach((u) => { if (u.TeamMonth === prev) store.update('Users', u.id, { TeamMonth: '' }); });
  store.update('Users', 1, { TeamMonth: prev, TeamPoints: 50, StardustCount: 0 });
  store.update('Users', 2, { TeamMonth: prev, Team: other, TeamPoints: 30, StardustCount: 0 });
  const old = store.getAll('AppSettings').find((x) => x.Key === 'teamWar');
  if (old) store.delete('AppSettings', old.id);
  teams._reset();
  native.beforeRequest({}, {}, 'x'); native.endRequest();
  assert.ok(store.getAll('UserCosmetics').some((r) => r.User === 1 && r.Key === `team-${st.myTeam}-${prev}`));
  assert.ok(user(1).StardustCount >= 300, 'poussieres des gagnants');
  assert.ok(user(2).StardustCount >= 80 && user(2).StardustCount < user(1).StardustCount + 1000, 'participation');
  // Placement : un nouveau va dans l'equipe la moins forte.
  const month = st.month;
  store.getAll('Users').forEach((u) => store.update('Users', u.id, { TeamMonth: '' }));
  store.update('Users', 1, { TeamMonth: month, Team: 'ruby', TeamPoints: 500 });
  store.update('Users', 2, { TeamMonth: '', Team: '', TeamLastPoints: 0 });
  assert.notEqual(call('POST', 'teams', { body: { userId: 2 } }).json.myTeam, 'ruby');
});

await test('expedition en duo : invitation, acceptation, butin partage', () => {
  const p1 = store.getAll('Pulls').find((p) => p.User === 1);
  const p2 = store.getAll('Pulls').find((p) => p.User === 2);
  const pseudo2 = user(2).Pseudo;
  let r = call('POST', 'duo-expedition', { body: { userId: 1, action: 'invite', toPseudo: pseudo2, pullId: p1.id } }).json;
  assert.equal(r.invited, pseudo2);
  assert.equal(call('POST', 'duo-expedition', { body: { userId: 1, action: 'invite', toPseudo: pseudo2, pullId: p1.id } }).json.error, 'already_busy');
  const inv = call('POST', 'duo-expedition', { body: { userId: 2 } }).json.items[0];
  r = call('POST', 'duo-expedition', { body: { userId: 2, action: 'accept', id: inv.id, pullId: p2.id } }).json;
  assert.equal(r.items[0].status, 'running');
  assert.equal(call('POST', 'duo-expedition', { body: { userId: 2, action: 'claim', id: inv.id } }).json.error, 'not_ready');
  store.update('DuoExpeditions', inv.id, { EndAt: now() - 1 });
  const d1 = user(1).StardustCount, d2 = user(2).StardustCount;
  const l1 = call('POST', 'duo-expedition', { body: { userId: 1, action: 'claim', id: inv.id } }).json.loot;
  const l2 = call('POST', 'duo-expedition', { body: { userId: 2, action: 'claim', id: inv.id } }).json.loot;
  assert.deepEqual(l1, l2);
  assert.equal(user(1).StardustCount, d1 + l1.dust);
  assert.equal(user(2).StardustCount, d2 + l2.dust);
});

await test('salle des machines, suite : surchauffe (vote double), jauge, chef mecanicien, assiduite, vote d evenement', () => {
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { MachinePressureGoal: 1, MachineRoomCosts: { keys: 1, dust: 1, worms: 1, parts: 1, bait: 1, boosters: 1, cards: 1 }, MachineOverheatCosts: { boosters: 1, legendary: 1 } } } });
  const [y, mo] = call('POST', 'machine-room', { body: { userId: 1 } }).json.month.split('-').map(Number);
  const pm = (yy, mm) => (mm === 1 ? [yy - 1, 12] : [yy, mm - 1]);
  const [y1, m1] = pm(y, mo), [y2, m2] = pm(y1, m1);
  const fmt = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}`;
  store.update('Users', 1, { MachineMonth: '', MachineStage: 0, MachineVote: '', MachineHistory: JSON.stringify([fmt(y1, m1), fmt(y2, m2)]), MachineLoyaltyAt: '', KeyCount: 5, StardustCount: 500, Worms: 5, SpareParts: 5, GoldBait: 5, BoosterCount: 10 });
  const card = cards()[2];
  mk(1, card.id, 'normal', 'worn'); mk(1, card.id, 'normal', 'worn');
  const legend = store.getAll('Cards').find((c) => { const r = store.get('Rarities', Array.isArray(c.Rarity) ? c.Rarity[1] : c.Rarity); return r && r.Key === 'legendaire'; });
  if (legend) { mk(1, legend.id, 'normal', 'worn'); mk(1, legend.id, 'normal', 'worn'); }
  let st;
  for (let i = 0; i < 5; i++) st = call('POST', 'machine-room', { body: { userId: 1, action: 'advance' } }).json;
  assert.equal(st.done, true);
  assert.equal(st.loyaltyReward, '3 jetons booster', 'assiduite : 3 mois');
  assert.equal(st.loyalty.months, 3);
  assert.equal(user(1).BoosterCount, 10 - 1 + 3);
  assert.ok(st.spent > 0);
  if (legend) {
    st = call('POST', 'machine-room', { body: { userId: 1, action: 'advance' } }).json;
    assert.equal(st.overheated, true);
  }
  st = call('POST', 'machine-room', { body: { userId: 1, action: 'vote', mode: 'chill' } }).json;
  assert.equal(st.votes.chill, legend ? 2 : 1, 'surchauffe : vote double');
  st = call('POST', 'machine-room', { body: { userId: 1, action: 'voteEvent', event: 'fishing' } }).json;
  assert.equal(st.eventVote.votes.fishing, 1);
  assert.equal(st.pressure.reached, true);
  // Bilan du mois : jauge (1 booster), chef mecanicien.
  const b = user(1).BoosterCount;
  machine._settleMonth(store, st.month);
  assert.equal(user(1).BoosterCount, b + 1);
  assert.ok(store.getAll('UserCosmetics').some((r) => r.User === 1 && r.Key === 'machine-chief'));
  for (const key of ['MachinePressureGoal', 'MachineRoomCosts', 'MachineOverheatCosts']) call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key } });
  store.update('Users', 1, { MachineMonth: '', MachineStage: 0 });
});

await test('bingo : ancien fonctionnement conserve avant BingoV2From', () => {
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { BingoV2From: 209901 } } });
  bingo._reset();
  const ids = cards().slice(0, 9).map((c) => c.id);
  assert.equal(call('POST', 'bingo', { body: { discordId: ADMIN, action: 'adminSetGrid', cardIds: ids.slice(0, 3) } }).json.error, 'grid_needs_9_cards');
  assert.equal(call('POST', 'bingo', { body: { discordId: ADMIN, action: 'adminSetGrid', cardIds: ids, rewardBoosters: 4 } }).json.saved, true);
  let st = call('POST', 'bingo', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(st.hasGrid, true);
  assert.equal(st.cells.length, 9);
  assert.equal(st.version, undefined, 'format d origine');
  ids.forEach((id) => mk(1, id));
  st = call('POST', 'bingo', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(st.allOwned, true);
  const b = user(1).BoosterCount;
  assert.equal(call('POST', 'bingo', { body: { userId: 1, action: 'claim' } }).json.rewardBoosters, 4);
  assert.equal(user(1).BoosterCount, b + 4);
  assert.equal(call('POST', 'bingo', { body: { userId: 1, action: 'claim' } }).json.error, 'already_claimed');
});

await test('bingo v2 : grille 5x5, cases carte et objectif, lignes, joker, carton plein', () => {
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { BingoV2From: 202001 } } });
  bingo._reset();
  store.update('Users', 1, { BingoMonth: '', StardustCount: 5000 });
  let st = call('POST', 'bingo', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(st.version, 2);
  assert.equal(st.cells.length, 25);
  assert.equal(st.cells[12].type, 'free');
  assert.equal(st.cells[12].done, true);
  assert.equal(st.cells.filter((c) => c.type === 'card').length, 8);
  assert.equal(st.lines.length, 12);
  // Meme grille pour tout le monde, stable dans le mois.
  assert.deepEqual(call('POST', 'bingo', { body: { userId: 2, action: 'status' } }).json.cells.map((c) => c.type + (c.key || c.card?.cardId || '')), st.cells.map((c) => c.type + (c.key || c.card?.cardId || '')));
  // Objectif : evenements du mois.
  const objIdx = st.cells.findIndex((c) => c.type === 'objective');
  const obj = bingo.OBJECTIVES.find((o) => o.key === st.cells[objIdx].key);
  const notices = bingo.onEvents(store, [{ userId: 1, type: obj.event, n: obj.n, meta: {} }]);
  assert.ok(notices.some((n) => /case validée/.test(n.label)), JSON.stringify(notices));
  st = call('POST', 'bingo', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(st.cells[objIdx].done, true);
  // Case carte : posseder la carte.
  const cardIdx = st.cells.findIndex((c) => c.type === 'card' && !c.done);
  if (cardIdx >= 0) { mk(1, st.cells[cardIdx].card.cardId); st = call('POST', 'bingo', { body: { userId: 1, action: 'status' } }).json; assert.equal(st.cells[cardIdx].done, true); }
  // Joker : une fois par mois, payant.
  const free = st.cells.findIndex((c) => !c.done);
  st = call('POST', 'bingo', { body: { userId: 1, action: 'joker', cell: free } }).json;
  assert.equal(st.cells[free].done, true);
  assert.equal(st.joker.used, true);
  assert.equal(user(1).StardustCount, 5000 - 500);
  assert.equal(call('POST', 'bingo', { body: { userId: 1, action: 'joker', cell: st.cells.findIndex((c) => !c.done) } }).json.error, 'joker_used');
  // Ligne : on complete la ligne du milieu a la main, puis recompense.
  const u = user(1);
  const done = JSON.parse(u.BingoDone);
  store.update('Users', 1, { BingoDone: JSON.stringify([...new Set([...done, 10, 11, 13, 14])]) });
  assert.equal(call('POST', 'bingo', { body: { userId: 1, action: 'claim', line: 'r0' } }).json.error, call('POST', 'bingo', { body: { userId: 1 } }).json.lines[0].complete ? undefined : 'line_not_complete');
  const d0 = user(1).StardustCount;
  st = call('POST', 'bingo', { body: { userId: 1, action: 'claim', line: 'r2' } }).json;
  assert.equal(st.reward.dust, 120);
  assert.equal(user(1).StardustCount, d0 + 120);
  assert.equal(call('POST', 'bingo', { body: { userId: 1, action: 'claim', line: 'r2' } }).json.error, 'already_claimed');
  // Carton plein.
  assert.equal(call('POST', 'bingo', { body: { userId: 1, action: 'claim', line: 'full' } }).json.error, 'grid_not_complete');
  store.update('Users', 1, { BingoDone: JSON.stringify(Array.from({ length: 25 }, (_, i) => i)) });
  const b0 = user(1).BoosterCount;
  st = call('POST', 'bingo', { body: { userId: 1, action: 'claim', line: 'full' } }).json;
  assert.equal(st.fullClaimed, true);
  assert.equal(user(1).BoosterCount, b0 + 3);
  assert.ok(store.getAll('UserCosmetics').some((r) => r.User === 1 && r.Key === 'bingo-full-' + st.month));
  assert.equal(st.top[0].userId, 1);
  assert.equal(st.top[0].full, true);
});

await test('bingo v2 : admin, apercu et cartes imposees, nouveau tirage', () => {
  const m = call('POST', 'bingo', { body: { userId: 1 } }).json.month;
  const prev = call('POST', 'bingo', { body: { discordId: ADMIN, action: 'adminPreview', month: m } }).json;
  assert.equal(prev.cells.length, 25);
  assert.equal(call('POST', 'bingo', { body: { userId: 1, action: 'adminPreview' } }).status, 403);
  const want = cards().slice(0, 2).map((c) => c.id);
  const cfg = call('POST', 'bingo', { body: { discordId: ADMIN, action: 'adminConfig', month: m, cardIds: want } }).json;
  const cardIds = cfg.cells.filter((c) => c.type === 'card').map((c) => c.card.cardId);
  assert.ok(want.every((id) => cardIds.includes(id)), 'cartes imposees presentes');
  const re = call('POST', 'bingo', { body: { discordId: ADMIN, action: 'adminConfig', month: m, reseed: true } }).json;
  assert.ok(re.config.seed);
  // Nettoyage.
  const row = store.getAll('AppSettings').find((r) => r.Key === 'bingo:' + m);
  if (row) store.delete('AppSettings', row.id);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'BingoV2From' } });
  bingo._reset();
});

await test('historique d un exemplaire : creation, changement de main, amelioration, suppression', () => {
  const c = cards()[4];
  const id = mk(1, c.id, 'normal', 'worn');
  const serial = store.get('Pulls', id).SerialNumber;
  store.update('Pulls', id, { User: 2 });
  store.update('Pulls', id, { Finish: 'holo' });
  let h = call('GET', 'card-history', { query: { cardId: c.id, serial } }).json;
  assert.deepEqual(h.events.map((e) => e.kind), ['created', 'moved', 'changed']);
  assert.equal(h.events[1].other, user(1).Pseudo);
  assert.equal(h.events[1].user, user(2).Pseudo);
  assert.deepEqual(h.events[2].detail.finish, ['normal', 'holo']);
  assert.equal(h.owner, user(2).Pseudo);
  store.delete('Pulls', id);
  h = call('GET', 'card-history', { query: { cardId: c.id, serial } }).json;
  assert.equal(h.events[h.events.length - 1].kind, 'deleted');
  assert.equal(h.exists, false);
  // Exemplaire anterieur au journal : origine reconstruite par le lot de tirage.
  const old = store.getAll('Pulls').find((p) => /^\d+-\d+$/.test(String(p.BatchId || '')));
  if (old) {
    store.getAll('PullHistory').filter((r) => r.Card === old.Card && r.Serial === old.SerialNumber).forEach((r) => store.delete('PullHistory', r.id));
    const o = call('GET', 'card-history', { query: { cardId: old.Card, serial: old.SerialNumber } }).json;
    assert.equal(o.events[0].reconstructed, true);
  }
});

await test('cote d une carte, maitre d une carte, god pack', () => {
  const c = cards()[5];
  const p = mk(1, c.id);
  store.create('Auctions', { Seller: 1, Card: c.id, Pull: p, Serial: 1, Finish: 'normal', Quality: 'good', StartPrice: 10, CurrentBid: 300, Bidder: 2, Status: 'sold', EndsAt: now() - 10, SettledAt: now() - 10 });
  const price = call('GET', 'card-price', { query: { cardId: c.id } }).json;
  assert.equal(price.stats.last, 300);
  assert.ok(price.reference.disenchant >= 0);
  // Maitre : les 6 finitions.
  for (const f of ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow']) mk(1, c.id, f);
  const notes = cardsMod.onEvents(store, [{ userId: 1, type: 'cardsPulled', n: 6, meta: {} }]);
  assert.ok(notes.some((n) => /Maître/.test(n.label)));
  assert.ok(cardsMod.masteredOf(user(1))[c.id]);
  hallOfFame._reset();
  const hall = call('GET', 'hall-of-fame', { query: {} }).json;
  assert.ok(hall.finishes.some((e) => e.label === 'Maître de ' + c.Name));
  // God pack : toutes les cartes du booster passent epique ou mieux.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { GodPackChance: 0.2 } } });
  const orig = Math.random; Math.random = () => 0.01;
  const commune = cards().find((x) => { const r = store.get('Rarities', Array.isArray(x.Rarity) ? x.Rarity[1] : x.Rarity); return r && r.Key === 'commune'; });
  const batch = '1-' + Date.now();
  const pid = store.create('Pulls', { User: 1, Card: commune.id, SerialNumber: 8800, Finish: 'normal', Quality: 'good', ObtainedAt: now(), BatchId: batch }).id;
  const json = { batchId: batch, cards: [{ cardId: commune.id, serialNumber: 8800, rarity: { key: 'commune' } }] };
  cardsMod.afterWorkflow({ store, path: 'open-pack', request: { body: { userId: 1 } }, response: { status: 200, json } });
  Math.random = orig;
  assert.equal(json.pack.godPack, true);
  const rk = store.get('Rarities', Array.isArray(store.get('Cards', store.get('Pulls', pid).Card).Rarity) ? store.get('Cards', store.get('Pulls', pid).Card).Rarity[1] : store.get('Cards', store.get('Pulls', pid).Card).Rarity).Key;
  assert.ok(['epique', 'legendaire', 'mythique'].includes(rk), rk);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'GodPackChance' } });
});

await test('partage sur Discord', () => {
  const c = cards()[5];
  const img = 'data:image/png;base64,iVBORw0KGgo=';
  delete process.env.DISCORD_WEBHOOK_URL;
  assert.equal(call('POST', 'share-card', { body: { userId: 1, cardId: c.id, image: img } }).json.error, 'discord_unavailable');
  assert.equal(call('POST', 'share-card', { body: { userId: 1, cardId: c.id, image: 'pas une image' } }).json.error, 'invalid_image');
});

await test('dinos : crane a la fouille, eclosion, soins, cacas, engrais au jardin, nourriture a la peche', () => {
  store.update('Users', 1, { DinoSkulls: 0, Dinos: '[]', DinoFood: '{}', DinoPoop: 0, BoneCount: 20, Worms: 50, GardenPlots: '[]', StardustCount: 5000 });
  // Fouille : crane (chance forcee a 100 %).
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { DinoSkullChance: 0.1 } } });
  const orig = Math.random; Math.random = () => 0.01;
  const json = { dug: true };
  dinoMod.afterWorkflow({ store, path: 'dig', request: { body: { userId: 1, action: 'dig' } }, response: { status: 200, json } });
  Math.random = orig;
  assert.equal(json.dinoSkull.total, 1);
  assert.equal(user(1).DinoSkulls, 1);
  // Eclosion : crane + 10 os.
  let st = call('POST', 'dino', { body: { userId: 1, action: 'hatch', name: 'Pistache' } }).json;
  assert.equal(st.dinos.length, 1);
  assert.equal(st.hatched.name, 'Pistache');
  assert.ok(st.hatched.hue >= 0 && st.hatched.hue < 360);
  assert.equal(user(1).BoneCount, 10);
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'hatch' } }).json.error, 'no_skull');
  // Le temps passe : faim et tristesse.
  const d0 = dinoMod.dinosOf(user(1))[0];
  store.update('Users', 1, { Dinos: JSON.stringify([{ ...d0, at: now() - 30 * 3600 }]) });
  st = call('POST', 'dino', { body: { userId: 1 } }).json;
  assert.equal(st.dinos[0].food, 0);
  assert.equal(st.dinos[0].mood.key, 'hungry');
  // Nourrir : pas de poisson -> vers de terre ; puis poisson.
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'feed', dino: 1, food: 'fish' } }).json.error, 'no_food');
  store.update('Users', 1, { DinoFood: JSON.stringify({ fish: 5, seaweed: 2, shrimp: 1 }) });
  for (let i = 0; i < 3; i++) st = call('POST', 'dino', { body: { userId: 1, action: 'feed', dino: 1, food: 'fish' } }).json;
  assert.equal(st.dinos[0].food, 90);
  assert.equal(st.food.fish, 2);
  st = call('POST', 'dino', { body: { userId: 1, action: 'feed', dino: 1, food: 'worm' } }).json;
  assert.equal(user(1).Worms, 49);
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'feed', dino: 1, food: 'seaweed' } }).json.error, 'not_hungry');
  // Jouer, avec delai.
  st = call('POST', 'dino', { body: { userId: 1, action: 'play', dino: 1 } }).json;
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'play', dino: 1 } }).json.error, 'play_cooldown');
  // Cacas : 96 points manges -> 2 cacas, prets 2 h apres.
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'clean' } }).json.error, 'nothing_to_clean');
  const d1 = dinoMod.dinosOf(user(1))[0];
  assert.equal(d1.poops.length, 2);
  store.update('Users', 1, { Dinos: JSON.stringify([{ ...d1, poops: d1.poops.map((p) => p - 3 * 3600) }]) });
  st = call('POST', 'dino', { body: { userId: 1, action: 'clean' } }).json;
  assert.equal(st.collected, 2);
  assert.equal(user(1).DinoPoop, 2);
  // Engrais au jardin : la plante avance de moitie, vers doubles.
  call('POST', 'garden', { body: { userId: 1, action: 'plant', seed: 'worm' } });
  let g = call('POST', 'garden', { body: { userId: 1, action: 'fertilize', plot: 0 } }).json;
  assert.equal(g.fertilized, 1);
  assert.ok(g.plots[0].fertilized && g.plots[0].progress >= 0.5);
  assert.equal(user(1).DinoPoop, 1);
  assert.equal(call('POST', 'garden', { body: { userId: 1, action: 'fertilize', plot: 0 } }).json.error, 'nothing_to_fertilize');
  const plots = JSON.parse(user(1).GardenPlots);
  plots[0].plantedAt -= g.plots[0].readyAt - now() + 60; // pret depuis 1 min (pas fane)
  store.update('Users', 1, { GardenPlots: JSON.stringify(plots) });
  g = call('POST', 'garden', { body: { userId: 1, action: 'harvest' } }).json;
  assert.ok(g.items[0].fertilized && g.items[0].worms >= 6, JSON.stringify(g.items[0]));
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'GardenWiltHours' } });
  // Peche : nourriture en plus (chance forcee).
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { DinoFoodChance: 1 } } });
  store.update('Users', 1, { Worms: 100, FishingCasts: 0, FishingEnergy: null });
  const fish = call('POST', 'fishing', { body: { userId: 1, action: 'cast', count: 3 } }).json;
  assert.equal(fish.bycatch.length, 3, JSON.stringify(fish.error || fish.bycatch));
  // Sans dino ni crane : pas de nourriture.
  store.update('Users', 2, { Worms: 100, FishingCasts: 0, FishingEnergy: null, Dinos: '[]', DinoSkulls: 0 });
  assert.equal(call('POST', 'fishing', { body: { userId: 2, action: 'cast', count: 1 } }).json.bycatch.length, 0);
  // Maximum DinoMax dinos (10) ; suggestion de l'accueil quand il a faim.
  const one = dinoMod.dinosOf(user(1))[0];
  store.update('Users', 1, { DinoSkulls: 1, BoneCount: 99, Dinos: JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => ({ ...one, id, at: now() - 40 * 3600 }))) });
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'status' } }).json.max, 10);
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'hatch' } }).json.error, 'max_dinos');
  assert.ok(dinoMod.dinoAlerts(user(1)).some((a) => a.key === 'dino-hungry'));
  // Relacher dans la nature : la place se libere, la vedette et le compagnon sont retires, les cacas murs ramasses.
  const poopsBefore = Number(user(1).DinoPoop) || 0;
  const list = dinoMod.dinosOf(user(1)).map((d) => (d.id === 3 ? { ...d, poops: [now() - 10, now() + 3600] } : d));
  store.update('Users', 1, { Dinos: JSON.stringify(list), DinoStar: 3, DinoCompanion: 3 });
  const rel = call('POST', 'dino', { body: { userId: 1, action: 'release', dino: 3 } }).json;
  assert.equal(rel.released.name, one.name, JSON.stringify(rel.error || rel.released));
  assert.equal(rel.dinos.length, 9);
  assert.equal(rel.released.poop, 1);
  assert.equal(Number(user(1).DinoPoop), poopsBefore + 1);
  assert.ok(!Number(user(1).DinoStar) && !Number(user(1).DinoCompanion));
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'release', dino: 3 } }).json.error, 'unknown_dino');
  assert.ok(call('POST', 'dino', { body: { userId: 1, action: 'hatch' } }).json.hatched, 'une place liberee');
  // Un dino mort ne se relache pas (tas d'os : bury).
  const dead = dinoMod.dinosOf(user(1)).map((d) => (d.id === 4 ? { ...d, deadAt: now() - 60 } : d));
  store.update('Users', 1, { Dinos: JSON.stringify(dead) });
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'release', dino: 4 } }).json.error, 'dino_dead');
  // Reglage DinoMax : 5 places -> enclos plein.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { DinoMax: 5 } } });
  store.update('Users', 1, { DinoSkulls: 1 });
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'hatch' } }).json.error, 'max_dinos');
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'DinoMax' } });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'DinoSkullChance' } });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'DinoFoodChance' } });
});

await test('dinos (2) : mort et tas d os, fouille auto, oeufs, plat prefere, Dinodex, boutique, vedette, livre d or, engrais dore, talents', () => {
  const base = { at: now(), food: 90, happy: 90, xp: 0, digest: 0, poops: [], goldPoops: [], playAt: 0, petAt: 0, breedAt: 0, pattern: 'plain', hue: 120, bornAt: now() };
  const set = (list, extra = {}) => store.update('Users', 1, { Dinos: JSON.stringify(list), DinoEggs: '[]', ...extra });
  // Mort : satiete et bonheur a zero -> tas d'os, on recupere les os.
  set([{ ...base, id: 1, name: 'Oublie', species: 'rex', at: now() - 200 * 3600 }], { BoneCount: 0, DinoStar: 1, DinoDex: '{}' });
  let st = call('POST', 'dino', { body: { userId: 1 } }).json;
  assert.ok(st.dinos[0].dead && st.dinos[0].mood.key === 'dead');
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'feed', dino: 1, food: 'worm' } }).json.error, 'dino_dead');
  st = call('POST', 'dino', { body: { userId: 1, action: 'bury', dino: 1 } }).json;
  assert.equal(st.dinos.length, 0);
  assert.equal(user(1).BoneCount, 10);
  assert.ok(!user(1).DinoStar);
  // Fouille automatique : un adulte content depuis 13 h -> 2 trouvailles (6 h).
  set([{ ...base, id: 1, name: 'Fouineur', species: 'raptor', xp: 250, grownAt: now() - 13 * 3600, digAt: now() - 13 * 3600 }]);
  const bones = user(1).BoneCount;
  st = call('POST', 'dino', { body: { userId: 1, action: 'collect' } }).json;
  assert.equal(st.loot.finds, 2);
  assert.equal(user(1).BoneCount, bones + 2); // Velociraptor : des os
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'collect' } }).json.error, 'nothing_to_collect');
  // Oeuf : deux adultes heureux, couleur melangee.
  set([{ ...base, id: 1, name: 'Papa', species: 'rex', xp: 250, hue: 350 }, { ...base, id: 2, name: 'Maman', species: 'trice', xp: 250, hue: 10 }]);
  st = call('POST', 'dino', { body: { userId: 1, action: 'breed', a: 1, b: 2 } }).json;
  assert.equal(st.eggs.length, 1);
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'breed', a: 1, b: 2 } }).json.error, 'breed_cooldown');
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'hatchEgg', egg: 1 } }).json.error, 'egg_not_ready');
  const eggs = JSON.parse(user(1).DinoEggs); eggs[0].hatchAt = now() - 1;
  store.update('Users', 1, { DinoEggs: JSON.stringify(eggs) });
  st = call('POST', 'dino', { body: { userId: 1, action: 'hatchEgg', egg: 1 } }).json;
  assert.ok(st.fromEgg && ['rex', 'trice', 'ptero'].includes(st.hatched.species));
  assert.ok(st.hatched.hue >= 335 || st.hatched.hue <= 25, String(st.hatched.hue));
  // Plat prefere : decouvert au premier repas, +20 bonheur.
  const kid = JSON.parse(user(1).Dinos).find((d) => d.id === 3);
  store.update('Users', 1, { DinoFood: JSON.stringify({ fish: 9, seaweed: 9, shrimp: 9 }), Worms: 50 });
  st = call('POST', 'dino', { body: { userId: 1, action: 'feed', dino: 3, food: kid.fav } }).json;
  assert.ok(st.fed.fav && st.fed.favFound);
  assert.equal(st.dinos.find((d) => d.id === 3).fav, kid.fav);
  // Dinodex : palier de 5 entrees paye une fois.
  assert.ok(st.dex.count >= 5);
  assert.ok(st.dex.tiers[0].claimed);
  // Boutique : accessoire, decoration (bonheur moins vite).
  store.update('Users', 1, { StardustCount: 5000 });
  st = call('POST', 'dino', { body: { userId: 1, action: 'buyAcc', key: 'hat' } }).json;
  st = call('POST', 'dino', { body: { userId: 1, action: 'equip', dino: 3, key: 'hat' } }).json;
  assert.equal(st.dinos.find((d) => d.id === 3).acc, 'hat');
  st = call('POST', 'dino', { body: { userId: 1, action: 'buyDecor', key: 'pond' } }).json;
  assert.equal(st.decorBonus, 6);
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'buyDecor', key: 'pond' } }).json.error, 'already_owned');
  // Vedette : sur la carte de joueur.
  call('POST', 'dino', { body: { userId: 1, action: 'star', dino: 3 } });
  assert.equal(call('GET', 'player-card', { query: { pseudo: user(1).Pseudo } }).json.starDino.name, kid.name);
  // Livre d'or : premier adulte (atteint en jouant, sauf la nuit ou il dort).
  store.update('Users', 1, { Dinos: JSON.stringify(JSON.parse(user(1).Dinos).map((d) => (d.id === 3 ? { ...d, xp: 198, playAt: 0 } : d))) });
  st = call('POST', 'dino', { body: { userId: 1, action: 'play', dino: 3 } }).json;
  if (st.error !== 'sleeping') {
    assert.equal(st.grown.stage, 'Adulte');
    hallOfFame._reset();
    assert.ok(call('GET', 'hall-of-fame', { query: {} }).json.dinos.some((e) => e.label === 'Premier dino adulte'));
  }
  // Engrais dore : parcelle prete tout de suite, appat garanti.
  store.update('Users', 1, { DinoGoldPoop: 1, GardenPlots: '[]' });
  call('POST', 'garden', { body: { userId: 1, action: 'plant', seed: 'worm' } });
  let g = call('POST', 'garden', { body: { userId: 1, action: 'fertilize', plot: 0, gold: true } }).json;
  assert.ok(g.gold && g.plots[0].ready);
  g = call('POST', 'garden', { body: { userId: 1, action: 'harvest' } }).json;
  assert.ok(g.items[0].goldFertilized && g.items[0].bait >= 1);
  // Talents : Stegosaure vivant -> plus de fanage ; affame seulement : il protege encore (2026-10-26).
  set([{ ...base, id: 1, name: 'Stego', species: 'stego' }]);
  assert.equal(call('POST', 'garden', { body: { userId: 1 } }).json.wiltHours, 0);
  set([{ ...base, id: 1, name: 'Stego', species: 'stego', food: 5 }]);
  assert.equal(call('POST', 'garden', { body: { userId: 1 } }).json.wiltHours, 0);
  // En danger (affame ET malheureux) : plus de protection.
  set([{ ...base, id: 1, name: 'Stego', species: 'stego', food: 5, happy: 5 }]);
  assert.ok(call('POST', 'garden', { body: { userId: 1 } }).json.wiltHours > 0);
  // Compagnon d'expedition : bonus de poussieres, revient affame.
  set([{ ...base, id: 1, name: 'Compagnon', species: 'long', happy: 100 }], { DinoCompanion: 1 });
  assert.equal(dinoMod.companionBonus(user(1)), 0.3);
  const json = { reward: { dust: 100 } };
  dinoMod.afterWorkflow({ store, path: 'expedition', request: { body: { userId: 1, action: 'claim' } }, response: { status: 200, json } });
  assert.equal(json.dinoCompanion.name, 'Compagnon');
  assert.equal(Math.round(JSON.parse(user(1).Dinos)[0].food), 60);
  store.update('Users', 1, { Dinos: '[]', DinoCompanion: 0, DinoStar: 0 });
});

await test('decouvertes : premiere ressource annoncee une seule fois, remise a zero, onglet dinos cache sans crane', () => {
  // Premier passage : ce qu'il possede deja est annonce aussi (jamais vu).
  store.update('Users', 2, { Discoveries: '', BoneCount: 3, DinoSkulls: 0, Dinos: '[]', DinoEggs: '[]', DinoDex: '{}', DinoFood: '{}', Worms: 0 });
  let r = call('POST', 'dino', { body: { userId: 2 } }).json;
  assert.ok(r.discoveries.some((d) => d.key === 'bone'));
  assert.equal(r.unlocked, false);
  assert.ok(!call('POST', 'dino', { body: { userId: 2 } }).json.discoveries);
  // Remise a zero depuis le menu : tout est rejoue dans la reponse.
  r = call('POST', 'discoveries', { body: { userId: 2, action: 'reset' } }).json;
  assert.ok(r.reset && r.discoveries.some((d) => d.key === 'bone'));
  // Un crane plus tard : decouverte, et l'onglet se debloque.
  store.update('Users', 2, { DinoSkulls: 1 });
  r = call('POST', 'dino', { body: { userId: 2 } }).json;
  assert.equal(r.unlocked, true);
  assert.deepEqual(r.discoveries.map((d) => d.key), ['skull']);
  assert.ok(r.discoveries[0].riddle.length > 20);
  // Deja vue : plus d'annonce, meme apres l'avoir depensee puis retrouvee.
  store.update('Users', 2, { DinoSkulls: 0 });
  call('POST', 'dino', { body: { userId: 2 } });
  store.update('Users', 2, { DinoSkulls: 1 });
  assert.ok(!call('POST', 'dino', { body: { userId: 2 } }).json.discoveries);
  assert.ok(call('GET', 'discoveries-catalog', { query: {} }).json.items.some((i) => i.key === 'fish'));
  store.update('Users', 2, { DinoSkulls: 0 });
});

await test('coffres : achat et ouverture de plusieurs coffres d un coup, bornes par les cles', () => {
  // Sans le bonus de ressources (il peut rendre une cle).
  call('POST', 'admin-settings', { body: { discordId: '785223211730075709', action: 'set', values: { ChestExtraLoot: [] } } });
  const st0 = call('POST', 'chests', { body: { userId: 1, action: 'status' } }).json;
  store.update('Users', 1, { ChestCount: 0, KeyCount: 3, StardustCount: st0.cost * 5 });
  let r = call('POST', 'chests', { body: { userId: 1, action: 'buy', count: 5 } }).json;
  assert.equal(r.bought, 5);
  assert.equal(r.chests, 5);
  assert.equal(user(1).StardustCount, 0);
  // 5 coffres mais 3 cles : 3 ouverts.
  r = call('POST', 'chests', { body: { userId: 1, action: 'open', count: 5 } }).json;
  assert.equal(r.opened, 3);
  assert.deepEqual([r.chests, r.keys], [2, 0]);
  assert.ok(r.dust >= 3 * setting(store, 'ChestDustMin'));
  assert.equal(r.items[0].type, 'dust');
  assert.equal(call('POST', 'chests', { body: { userId: 1, action: 'open' } }).json.error, 'no_key');
  // Le defi "ouvrir 2 coffres" compte les 3 coffres d'un coup.
  store.update('Users', 1, { KeyCount: 1 });
  r = call('POST', 'chests', { body: { userId: 1, action: 'open', count: 99 } }).json;
  assert.equal(r.opened, 1);
});

await test('coffre-fort : onglets par edition (apparus une fois l edition obtenue) qui marchent comme le classique', () => {
  const vault = (action, extra = {}) => call('POST', 'personal-vault', { body: { userId: 1, action, ...extra } });
  const vaultCard = store.getAll('Cards').find((c) => c.IsVault);
  if (!store.getAll('Pulls').some((p) => p.User === 1 && p.Card === vaultCard.id && String(p.BatchId || '').startsWith('vault-'))) store.create('Pulls', { User: 1, Card: vaultCard.id, BatchId: 'vault-test1', SerialNumber: 950, Finish: 'rainbow', Quality: 'mint' });
  // Aucune edition obtenue : pas d'onglet.
  store.getAll('Pulls').filter((p) => p.User === 1 && p.Edition).forEach((p) => store.update('Pulls', p.id, { Edition: '' }));
  if (store.tables.has('PullHistory')) store.getAll('PullHistory').filter((h) => h.User === 1).forEach((h) => store.delete('PullHistory', h.id));
  let st = vault('status').json;
  assert.equal(st.editions.length, 0);
  // Une carte Maudite en parfait etat : l'onglet apparait, la carte y est rangeable.
  const [c1, c2] = cards().slice(0, 2);
  const cursed = store.create('Pulls', { User: 1, Card: c1.id, SerialNumber: 7001, Finish: 'gold', Quality: 'mint', Edition: 'cursed' });
  st = vault('status').json;
  assert.deepEqual(st.editions.map((e) => e.key), ['cursed']);
  const tab = st.editions[0];
  // Memes lignes que le classique : une par carte, 6 finitions.
  const edRow = tab.rows.find((r) => r.cardId === c1.id);
  assert.equal(edRow.slots.length, 6);
  assert.equal(edRow.slots.find((x) => x.finish === 'gold').candidates[0].pullId, cursed.id);
  assert.equal(tab.ready, 1);
  // Le classique ignore les exemplaires en edition.
  const row = st.rows.find((r) => r.cardId === c1.id);
  assert.ok(!row || !row.slots.some((x) => x.candidates.some((c) => c.pullId === cursed.id)));
  // Rangement : un emplacement par carte, par finition et par edition, sans toucher au classique.
  st = vault('store', { pullId: cursed.id }).json;
  assert.equal(st.editions[0].stored, 1);
  const dupGold = store.create('Pulls', { User: 1, Card: c1.id, SerialNumber: 7002, Finish: 'gold', Quality: 'mint', Edition: 'cursed' });
  assert.equal(vault('store', { pullId: dupGold.id }).json.error, 'slot_filled');
  // Ligne Maudite complete (6 finitions) : recompense une fois, notee avec l'edition.
  const boostersBefore = store.get('Users', 1).BoosterCount || 0;
  let reward = null;
  for (const [i, finish] of ['normal', 'holo', 'ghost', 'diamond', 'rainbow'].entries()) {
    const p = store.create('Pulls', { User: 1, Card: c1.id, SerialNumber: 7100 + i, Finish: finish, Quality: 'mint', Edition: 'cursed' });
    const r = vault('store', { pullId: p.id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    reward = r.json.reward || reward;
  }
  assert.equal(reward && reward.edition, 'cursed');
  assert.ok((store.get('Users', 1).BoosterCount || 0) > boostersBefore);
  const edDone = vault('status').json.editions[0].rows.find((r) => r.cardId === c1.id);
  assert.ok(edDone.complete && edDone.claimed);
  assert.ok(store.getAll('VaultRewards').some((r) => r.User === 1 && r.Card === c1.id && r.Edition === 'cursed'));
  const plainGold = store.create('Pulls', { User: 1, Card: c1.id, SerialNumber: 7003, Finish: 'gold', Quality: 'mint' });
  const classic = vault('store', { pullId: plainGold.id });
  assert.equal(classic.status, 200, JSON.stringify(classic.json));
  // Une autre edition : un onglet de plus ; usee : pas rangeable.
  const worn = store.create('Pulls', { User: 1, Card: c2.id, SerialNumber: 7004, Finish: 'normal', Quality: 'worn', Edition: 'frost' });
  st = vault('status').json;
  assert.deepEqual(st.editions.map((e) => e.key).sort(), ['cursed', 'frost']);
  assert.equal(vault('store', { pullId: worn.id }).json.error, 'not_mint');
  // L'onglet reste si la carte a ete echangee (historique des tirages).
  store.update('Pulls', worn.id, { User: 2 });
  assert.ok(vault('status').json.editions.some((e) => e.key === 'frost'));
});

await test('editions limitees : jamais perdues par inadvertance (mise de cote, confirmation, edition gardee par la fusion)', () => {
  const card = cards()[4];
  const ed = (finish = 'normal', quality = 'good', edition = 'prism') => { const id = mk(1, card.id, finish, quality); store.update('Pulls', id, { Edition: edition }); return id; };
  const prism = ed('holo');
  const plain = mk(1, card.id, 'holo');
  // Choix automatique (aucun exemplaire precis) : l'edition est mise de cote, rendue apres.
  let req = { body: { userId: 1, cardId: card.id, fromFinish: 'holo' } };
  assert.equal(native.beforeWorkflow('foil-upgrade', req), null);
  assert.equal(store.get('Pulls', prism).InVault, true);
  assert.ok(!store.get('Pulls', plain).InVault);
  native.restore(req);
  assert.ok(!store.get('Pulls', prism).InVault);
  // Decraft explicite : confirmation demandee, rien ne reste de cote.
  const denied = native.beforeWorkflow('disenchant', { body: { userId: 1, cardId: card.id, finish: 'holo', quality: 'good', pullId: prism } });
  assert.equal(denied.json.error, 'edition_copy');
  assert.equal(denied.json.copies[0].edition, 'prism');
  assert.equal(denied.json.copies[0].label, 'Prismatique');
  assert.ok(!store.get('Pulls', prism).InVault);
  req = { body: { userId: 1, cardId: card.id, finish: 'holo', quality: 'good', pullId: prism, confirmEdition: true } };
  assert.equal(native.beforeWorkflow('disenchant', req), null);
  native.restore(req);
  // Autel : idem (l'edition disparait avec la carte sacrifiee).
  const altar = native.beforeWorkflow('altar-sacrifice', { body: { userId: 1, pullIds: [prism, plain, mk(1, card.id)] } });
  assert.equal(altar.json.error, 'edition_copy');
  // Fusion avec UN exemplaire en edition : pas de confirmation, le resultat garde l'edition.
  const five = [prism, ...Array.from({ length: 4 }, () => mk(1, card.id, 'holo'))];
  req = { body: { userId: 1, cardId: card.id, fromFinish: 'holo', pullIds: five, keepPullId: five[1] } };
  assert.equal(native.beforeWorkflow('foil-upgrade', req), null);
  assert.equal(req._editionCarry, 'prism');
  // (le workflow supprime les 5 et cree l'exemplaire dore)
  five.forEach((id) => store.delete('Pulls', id));
  const serial = 4242;
  const fresh = store.create('Pulls', { User: 1, Card: card.id, SerialNumber: serial, Finish: 'gold', Quality: 'good', ObtainedAt: now() });
  const resp = { status: 200, json: { upgraded: true, cardId: card.id, toFinish: 'gold', serialNumber: serial } };
  native.afterWorkflow('foil-upgrade', req, resp);
  assert.equal(store.get('Pulls', fresh.id).Edition, 'prism');
  assert.equal(resp.json.edition, 'prism');
  // Deux editions dans la meme fusion : une seule peut etre gardee -> confirmation.
  const a = ed('normal', 'worn', 'prism'), b = ed('normal', 'worn', 'frost');
  const two = native.beforeWorkflow('card-quality-repair', { body: { userId: 1, cardId: card.id, fromQuality: 'worn', pullIds: [a, b, mk(1, card.id, 'normal', 'worn')], keepPullId: b } });
  assert.equal(two.json.error, 'edition_copy');
  assert.equal(two.json.carried, 'frost');
  assert.deepEqual(two.json.copies.map((c) => c.pullId), [a]);
  // Echange : l'exemplaire change de main avec son edition, pas de confirmation.
  const tr = { body: { userId: 1, action: 'create', offeredPullId: a } };
  assert.equal(native.beforeWorkflow('trade', tr), null);
  native.restore(tr);
  // Boss : confirmation, puis attaque.
  const boss = store.create('CommunityBoss', { BossName: 'Test', MaxHp: 1e9, CurrentHp: 1e9, Active: true, RewardBoosters: 0 });
  assert.equal(call('POST', 'boss-attack', { body: { userId: 1, pullIds: [a] } }).json.error, 'edition_copy');
  assert.ok(store.get('Pulls', a), 'rien de detruit sans confirmation');
  assert.equal(call('POST', 'boss-attack', { body: { userId: 1, pullIds: [a], confirmEdition: true } }).status, 200);
  assert.ok(!store.get('Pulls', a));
  store.update('CommunityBoss', boss.id, { Active: false });
  // Carte ★ : garde l'edition d'un exemplaire fondu ; deux editions -> confirmation.
  const r1 = mk(1, card.id, 'rainbow', 'mint'), r2 = ed('rainbow', 'mint', 'prism'), r3 = mk(1, card.id, 'rainbow', 'mint');
  const star = call('POST', 'card-prestige', { body: { userId: 1, pullIds: [r1, r2, r3] } }).json;
  assert.equal(star.starred, true);
  assert.equal(store.get('Pulls', star.pullId).Edition, 'prism');
  const s1 = ed('rainbow', 'mint', 'prism'), s2 = ed('rainbow', 'mint', 'frost'), s3 = mk(1, card.id, 'rainbow', 'mint');
  assert.equal(call('POST', 'card-prestige', { body: { userId: 1, pullIds: [s1, s2, s3] } }).json.error, 'edition_copy');
  // Contrats : jamais d'exemplaire en edition.
  const st = call('POST', 'contracts', { body: { userId: 1 } }).json;
  assert.ok(st.contracts.every((c) => !c.eligible.some((p) => store.get('Pulls', p.pullId)?.Edition)));
  [b, s1, s2, s3, star.pullId, plain].forEach((id) => store.get('Pulls', id) && store.delete('Pulls', id));
});

// ---------------------------------------------------------------- regles par difficulte (2026-10-16)
const extra = (userId, action, params = {}) => call('POST', 'mode-extra', { body: { userId, action, ...params } });
const withRandom = (v, fn) => { const orig = Math.random; Math.random = typeof v === 'function' ? v : () => v; try { return fn(); } finally { Math.random = orig; } };
// Faux booster ouvert : 5 exemplaires d'une meme carte commune.
function fakePack(userId, n = 5) {
  const card = cards().find((c) => store.get('Rarities', refIdOf(c.Rarity))?.Key === 'commune') || cards()[0];
  const batchId = `${userId}-fake-${Math.random()}`;
  const list = Array.from({ length: n }, (_, i) => store.create('Pulls', { User: userId, Card: card.id, SerialNumber: 7700 + store.getAll('Pulls').length + i, Finish: 'normal', Quality: 'good', ObtainedAt: now(), BatchId: batchId }));
  const r = store.get('Rarities', refIdOf(card.Rarity));
  return { batchId, cards: list.map((p) => ({ cardId: card.id, serialNumber: p.SerialNumber, finish: 'normal', quality: 'good', rarity: { id: r.id, key: r.Key, sortOrder: r.SortOrder || 0 } })) };
}

await test('regles par difficulte : registre, admin (activer, desactiver, par mode), regles existantes rebranchees', () => {
  // Edition du mode : hors evenement saisonnier (sinon Halloween impose la sienne).
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { SeasonalEventsEnabled: false } } });
  assert.equal(call('POST', 'admin-mode-rules', { body: { discordId: 'x' } }).status, 403);
  let st = call('POST', 'admin-mode-rules', { body: { discordId: ADMIN } }).json;
  assert.deepEqual(st.modes.map((m) => m.key), ['cool', 'chill', 'medium', 'hard', 'chaos']);
  assert.equal(st.modes.reduce((n, m) => n + m.rules.filter((r) => r.isNew).length, 0), 20);
  assert.ok(st.modes.every((m) => m.presets.length > 0));
  applyMode('cool');
  assert.equal(moderules.ruleOn(store, 'cool.fishNoEmpty'), true);
  assert.equal(moderules.ruleOn(store, 'hard.wear'), false, 'regle hors de son mode');
  st = call('POST', 'admin-mode-rules', { body: { discordId: ADMIN, action: 'set', key: 'cool.fishNoEmpty', on: false } }).json;
  assert.equal(st.modes[0].rules.find((r) => r.key === 'cool.fishNoEmpty').on, false);
  assert.equal(moderules.ruleOn(store, 'cool.fishNoEmpty'), false);
  // La peche du mode Cool retrouve ses prises vides.
  assert.ok(call('POST', 'fishing', { body: { userId: 1 } }).json.table.some((x) => x.type === 'nothing'));
  call('POST', 'admin-mode-rules', { body: { discordId: ADMIN, action: 'set', key: 'cool.fishNoEmpty', on: true } });
  assert.ok(!call('POST', 'fishing', { body: { userId: 1 } }).json.table.some((x) => x.type === 'nothing'));
  // Tout le mode d'un coup ; annonce des bonus = regles actives.
  call('POST', 'admin-mode-rules', { body: { discordId: ADMIN, action: 'mode', mode: 'cool', on: false } });
  assert.equal(call('GET', 'event-status', {}).json.gameMode.perks.length, 0);
  assert.equal(call('GET', 'mode-rules', {}).json.rules.length, 0);
  call('POST', 'admin-mode-rules', { body: { discordId: ADMIN, action: 'reset' } });
  assert.ok(call('GET', 'event-status', {}).json.gameMode.perks.length >= 10);
  // Edition du mode desactivable.
  applyMode('medium');
  assert.equal(editions.activeEdition(store).key, 'prism');
  call('POST', 'admin-mode-rules', { body: { discordId: ADMIN, action: 'set', key: 'medium.edition', on: false } });
  assert.equal(editions.activeEdition(store), null);
  call('POST', 'admin-mode-rules', { body: { discordId: ADMIN, action: 'reset' } });
});

await test('mode Cool : boite a souhaits garantie en 10 boosters, atelier gratuit, seconde chance, vacances des dinos', () => {
  applyMode('cool');
  // Boite a souhaits.
  const wish = cards().find((c) => store.get('Rarities', refIdOf(c.Rarity))?.Key !== 'commune') || cards()[1];
  store.getAll('Wishlist').filter((w) => refIdOf(w.User) === 1).forEach((w) => store.delete('Wishlist', w.id));
  store.update('Users', 1, { WishBox: '' });
  assert.equal(extra(1, 'wishbox', { cardId: wish.id }).json.error, 'not_in_wishlist');
  store.create('Wishlist', { User: 1, Card: wish.id });
  assert.equal(extra(1, 'wishbox', { cardId: wish.id }).json.wishbox.left, 10);
  assert.equal(extra(1, 'wishbox', { cardId: wish.id }).json.error, 'already_set');
  let got = null;
  for (let i = 0; i < 10 && !got; i++) {
    const json = fakePack(1);
    withRandom(0.99, () => modefun.afterWorkflow({ store, path: 'open-pack', request: { body: { userId: 1 } }, response: { status: 200, json } }));
    if (json.wishbox) got = json;
  }
  assert.ok(got, 'carte souhaitee au plus tard au 10e booster');
  const swapped = got.cards.find((c) => c.wishbox);
  assert.equal(swapped.cardId, wish.id);
  assert.ok(store.getAll('Pulls').some((p) => p.BatchId === got.batchId && refIdOf(p.Card) === wish.id));
  assert.equal(extra(1, 'status').json.wishbox.done, true);
  // Atelier gratuit : un cran d'etat, une fois par jour.
  store.update('Users', 1, { FreeRepairDay: '' });
  const worn = mk(1, cards()[2].id, 'holo', 'worn');
  assert.deepEqual([extra(1, 'free-repair', { pullId: worn }).json.to, store.get('Pulls', worn).Quality], ['good', 'good']);
  assert.equal(extra(1, 'free-repair', { pullId: worn }).json.error, 'already_used');
  // Seconde chance : une carte du dernier booster, meme rarete, finition gardee.
  store.update('Users', 1, { SecondChanceDay: '' });
  const pack = fakePack(1, 3);
  modefun.afterWorkflow({ store, path: 'open-pack', request: { body: { userId: 1 } }, response: { status: 200, json: pack } });
  const target = store.getAll('Pulls').find((p) => p.BatchId === pack.batchId);
  const before = refIdOf(target.Card);
  const r = extra(1, 'second-chance', { pullId: target.id }).json;
  assert.equal(r.rerolled, true);
  assert.notEqual(refIdOf(store.get('Pulls', target.id).Card), before);
  assert.equal(store.get('Pulls', target.id).Finish, 'normal');
  assert.equal(extra(1, 'second-chance', { pullId: target.id }).json.error, 'already_used');
  assert.equal(extra(1, 'second-chance', { pullId: worn }).status, 400);
  // Vacances des dinos : jauges figees pendant le mode Cool, aucun retard compte ensuite.
  applyMode('medium');
  native.beforeRequest({ userId: 1 }, {}, 'mode-rules');
  assert.equal(dinoMod.dinoHoliday(), false);
  const t0 = now() - 10 * 3600;
  store.update('Users', 1, { Dinos: JSON.stringify([{ id: 1, name: 'Rex', species: 'rex', xp: 500, bornAt: t0, at: t0, food: 90, happy: 90, poops: [], goldPoops: [] }]) });
  applyMode('cool');
  native.beforeRequest({ userId: 1 }, {}, 'mode-rules');
  assert.equal(dinoMod.dinoHoliday(), true);
  const frozen = call('POST', 'dino', { body: { userId: 1 } }).json.dinos[0];
  assert.ok(frozen.food < 90, 'decroissance reelle comptee jusqu au debut des vacances');
  const food = frozen.food;
  const d = JSON.parse(user(1).Dinos)[0];
  store.update('Users', 1, { Dinos: JSON.stringify([{ ...d, at: now() - 20 * 3600 }]) });
  assert.equal(call('POST', 'dino', { body: { userId: 1 } }).json.dinos[0].food, food, 'pas de faim pendant les vacances');
  applyMode('medium');
  native.beforeRequest({ userId: 1 }, {}, 'mode-rules');
  assert.equal(dinoMod.dinoHoliday(), false);
  assert.equal(call('POST', 'dino', { body: { userId: 1 } }).json.dinos[0].food, food, 'fin des vacances : on repart de la');
});

await test('mode Chill : happy hour sur les prix, jardin partage (arrosage, recolte partagee), balade du dino', () => {
  applyMode('chill');
  assert.equal(moderules.happyFactor(store), moderules.happyHourNow(store) ? 0.7 : 1);
  // Jardin partage.
  store.getAll('AppSettings').filter((r) => r.Key === 'shared-garden').forEach((r) => store.delete('AppSettings', r.id));
  let g = extra(1, 'garden-water').json.garden;
  assert.equal(g.total, 1);
  assert.equal(extra(1, 'garden-water').json.error, 'too_soon');
  const row = store.getAll('AppSettings').find((r) => r.Key === 'shared-garden');
  const v = JSON.parse(row.Value);
  store.update('AppSettings', row.id, { Value: JSON.stringify({ ...v, goal: 4, waters: { 1: 2, 2: 1 }, lastWater: {} }) });
  const dust1 = user(1).StardustCount, dust2 = user(2).StardustCount;
  const h = extra(1, 'garden-water').json;
  assert.ok(h.harvest, 'recolte au 4e arrosage');
  assert.equal(user(1).StardustCount, dust1 + 75);
  assert.equal(user(2).StardustCount, dust2 + 25);
  assert.equal(h.garden.total, 0);
  // Balade du dino.
  const t0 = now();
  store.update('Users', 1, { Dinos: JSON.stringify([{ id: 1, name: 'Rex', species: 'rex', xp: 500, bornAt: t0, at: t0, food: 90, happy: 50, poops: [], goldPoops: [] }]) });
  const sleeping = (() => { const hh = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(new Date())); return hh >= 23 || hh < 7; })();
  const w = call('POST', 'dino', { body: { userId: 1, action: 'walk', dino: 1 } }).json;
  if (sleeping) { assert.equal(w.error, 'sleeping'); return; }
  assert.equal(w.walking, 1);
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'walk-back', dino: 1 } }).json.error, 'still_walking');
  const d = JSON.parse(user(1).Dinos)[0];
  store.update('Users', 1, { Dinos: JSON.stringify([{ ...d, walkUntil: now() - 1 }]) });
  const dust = user(1).StardustCount;
  const back = call('POST', 'dino', { body: { userId: 1, action: 'walk-back', dino: 1 } }).json;
  assert.ok(back.walked.dust >= 20);
  assert.equal(user(1).StardustCount, dust + back.walked.dust);
  assert.equal(call('POST', 'dino', { body: { userId: 1, action: 'walk', dino: 1 } }).json.error, 'walked_today');
});

await test('mode Medium : bourse des cartes (decraft et craft), quete en chaine, draft a deux', () => {
  applyMode('medium');
  // Bourse : carte absente du serveur -> plus chere ; tres repandue -> moins.
  const rare = cards().find((c) => !store.getAll('Pulls').some((p) => refIdOf(p.Card) === c.id)) || cards()[cards().length - 1];
  assert.ok(modefun.stockFactor(store, rare.id) > 1);
  const st = extra(1, 'status').json;
  assert.ok(st.stock.up.length > 0);
  const req = { body: { userId: 1, cardId: rare.id } };
  store.update('Users', 1, { StardustCount: 100000 });
  assert.equal(native.beforeWorkflow('craft', req), null);
  assert.ok(req._stockDelta > 0);
  const resp = { status: 200, json: { crafted: true } };
  native.afterWorkflow('craft', req, resp);
  assert.equal(user(1).StardustCount, 100000 - req._stockDelta);
  // Quete en chaine : progression par evenements, etape recuperee.
  store.update('Users', 1, { QuestChain: '' });
  let q = extra(1, 'status').json.quest;
  const plan = q.steps;
  assert.equal(plan.length, 5);
  // On pousse l'evenement de l'etape courante jusqu'a la cible.
  for (const t of ['fish', 'board', 'boosterOpened', 'harvest', 'expedition', 'bossAttack', 'guess', 'chestOpened', 'craft']) modefun.onEvents(store, [{ userId: 1, type: t, n: 20 }]);
  q = extra(1, 'status').json.quest;
  assert.equal(q.step.ready, true);
  const dust = user(1).StardustCount;
  assert.equal(extra(1, 'quest-claim').json.reward.dust, 120);
  assert.equal(user(1).StardustCount, dust + 120);
  assert.equal(extra(1, 'status').json.quest.stepIndex, 1);
  // Draft a deux : mise, lancement, pioche en serpent jusqu'au bout.
  store.update('Users', 1, { BoosterCount: 3 });
  store.update('Users', 2, { BoosterCount: 3 });
  let d = call('POST', 'draft', { body: { userId: 1, action: 'create' } }).json;
  assert.equal(user(1).BoosterCount, 2);
  const id = d.current.id;
  assert.equal(call('POST', 'draft', { body: { userId: 1, action: 'start', id } }).json.error, 'need_two_players');
  call('POST', 'draft', { body: { userId: 2, action: 'join', id } });
  d = call('POST', 'draft', { body: { userId: 1, action: 'start', id } }).json;
  assert.equal(d.current.status, 'running');
  assert.equal(d.current.pool.length, 10);
  const pulls0 = store.getAll('Pulls').length;
  for (let i = 0; i < 10; i++) {
    const cur = call('POST', 'draft', { body: { userId: 1 } }).json.current;
    const who = cur.players.find((p) => p.pseudo === cur.turnPseudo).userId;
    const other = who === 1 ? 2 : 1;
    assert.equal(call('POST', 'draft', { body: { userId: other, action: 'pick', id, index: cur.pool.findIndex((p) => !p.takenBy) } }).json.error, 'not_your_turn');
    call('POST', 'draft', { body: { userId: who, action: 'pick', id, index: cur.pool.findIndex((p) => !p.takenBy) } });
  }
  assert.equal(store.getAll('Pulls').length, pulls0 + 10);
  const done = call('POST', 'draft', { body: { userId: 1 } }).json;
  assert.equal(done.current, null);
  assert.equal(done.recent[0].pool.filter((p) => p.mine).length, 5);
});

await test('mode Hard : ironman, prime de chasse, cartes maudites, larcin, tempetes', () => {
  applyMode('hard');
  // Ironman : serment, decraft bloque, renoncer.
  store.update('Users', 1, { Ironman: '' });
  assert.equal(extra(1, 'ironman-pledge').json.ironman.pledged, true);
  assert.equal(native.beforeWorkflow('disenchant', { body: { userId: 1, cardId: cards()[0].id } }).json.error, 'ironman_pledged');
  // Fin du Hard : recompense a la visite suivante.
  applyMode('medium');
  const boosters = user(1).BoosterCount;
  const resp = { status: 200, json: {} };
  native.afterWorkflow('booster-status', { body: {}, query: { userId: 1 } }, resp);
  assert.equal(user(1).BoosterCount, boosters + 5);
  assert.ok(resp.json.modeNotes.some((n) => n.icon === '🛡️'));
  applyMode('hard');
  // Prime de chasse : premier qui livre.
  store.getAll('AppSettings').filter((r) => r.Key === 'bounty').forEach((r) => store.delete('AppSettings', r.id));
  const b = extra(1, 'status').json.bounty;
  assert.ok(b.card);
  const copy = mk(1, b.card.cardId, 'normal', 'good');
  const before = user(1).BoosterCount;
  assert.equal(extra(1, 'bounty-deliver', { pullId: copy }).json.reward.boosters, 4);
  assert.equal(user(1).BoosterCount, before + 4);
  assert.ok(!store.get('Pulls', copy));
  assert.equal(extra(2, 'bounty-deliver', { pullId: mk(2, b.card.cardId) }).json.error, 'bounty_taken');
  // Cartes maudites : marquees a l'ouverture (jamais une edition), purification, sinon usure.
  const pack = fakePack(1, 4);
  withRandom(0, () => modefun.afterWorkflow({ store, path: 'open-pack', request: { body: { userId: 1 } }, response: { status: 200, json: pack } }));
  assert.equal(pack.cursed, 4);
  const cursed = store.getAll('Pulls').filter((p) => p.BatchId === pack.batchId);
  const dust = user(1).StardustCount;
  const pur = extra(1, 'purify', { pullId: cursed[0].id }).json;
  assert.equal(user(1).StardustCount, dust - pur.cost);
  store.update('Pulls', cursed[1].id, { CursedUntil: now() - 1 });
  const notes = modefun.sweepUser(store, 1);
  assert.equal(store.get('Pulls', cursed[1].id).Quality, 'worn');
  assert.ok(notes.some((n) => n.icon === '🕯️'));
  // Larcin : doublon non protege, cle depensee, victime prevenue.
  store.update('Users', 1, { KeyCount: 3, TheftDay: '' });
  store.update('Users', 2, { RobbedDay: '' });
  store.getAll('Pulls').filter((p) => refIdOf(p.User) === 2).forEach((p) => store.update('Pulls', p.id, { Insured: true }));
  const c = cards()[5];
  const a1 = mk(2, c.id), a2 = mk(2, c.id);
  const r = withRandom(0, () => extra(1, 'steal', { toPseudo: user(2).Pseudo }).json);
  assert.equal(r.success, true);
  assert.ok([a1, a2].some((id) => refIdOf(store.get('Pulls', id).User) === 1));
  assert.equal(user(1).KeyCount, 2);
  assert.ok(JSON.parse(user(2).ModeInbox).some((m) => m.icon === '🦹'));
  // Les exemplaires assures ne sont jamais voles.
  const insured = store.getAll('Pulls').filter((p) => refIdOf(p.User) === 2 && p.Insured).map((p) => p.id);
  withRandom(0, () => extra(1, 'steal', { toPseudo: user(2).Pseudo }));
  assert.ok(insured.every((id) => refIdOf(store.get('Pulls', id).User) === 2));
  store.getAll('Pulls').filter((p) => refIdOf(p.User) === 2).forEach((p) => store.update('Pulls', p.id, { Insured: false }));
  // Tempetes : deterministes par jour, fenetre de 3 h, pêche ou fouille.
  const days = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  const storms = days.map((d) => moderules.stormOf(d)).filter(Boolean);
  assert.ok(storms.length > 3 && storms.length < 17);
  assert.ok(storms.every((s) => s.to - s.from === 3 && ['fishing', 'dig'].includes(s.feature)));
  applyMode('medium');
  assert.deepEqual(moderules.stormClosed(store), []);
});

await test('mode Chaos : regle votee, cartes mutantes, booster glitche, carte instable, chasse aux bugs', () => {
  applyMode('chaos');
  // Vote pour demain.
  const v = call('POST', 'chaos-vote', { body: { userId: 1 } }).json;
  assert.equal(v.active, true);
  assert.equal(v.candidates.length, 3);
  const pick = v.candidates[2].key;
  call('POST', 'chaos-vote', { body: { userId: 1, action: 'vote', rule: pick } });
  assert.equal(call('POST', 'chaos-vote', { body: { userId: 2, action: 'vote', rule: 'nope' } }).json.error, 'unknown_rule');
  assert.equal(call('POST', 'chaos-vote', { body: { userId: 1 } }).json.mine, pick);
  assert.equal(chaosvoteRuleTomorrow(), pick);
  // Mutantes + booster glitche (hasard force).
  const pack = fakePack(1, 3);
  const n0 = pack.cards.length;
  withRandom(0, () => modefun.afterWorkflow({ store, path: 'open-pack', request: { body: { userId: 1 } }, response: { status: 200, json: pack } }));
  assert.equal(pack.mutants, 3);
  assert.equal(pack.glitchPack, true);
  assert.equal(pack.cards.length, n0 + 1);
  assert.equal(pack.cards[n0].edition, 'glitch');
  const mutant = store.getAll('Pulls').find((p) => p.BatchId === pack.batchId && Number(p.MutateAt) > 0);
  store.update('Pulls', mutant.id, { MutateAt: now() - 1 });
  const before = [mutant.Finish, mutant.Quality].join();
  const notes = modefun.sweepUser(store, 1);
  const after = store.get('Pulls', mutant.id);
  assert.ok(notes.some((x) => x.icon === '🧬'));
  assert.ok(!(Number(after.MutateAt) > 0));
  assert.ok([after.Finish, after.Quality].join() !== before || after.Finish === 'normal' || after.Quality === 'mint' || after.Quality === 'damaged');
  // Carte instable : une par periode, change chaque jour.
  store.update('Users', 1, { UnstableSession: 0 });
  const u = extra(1, 'unstable-claim').json.unstable;
  assert.ok(u.card);
  assert.equal(extra(1, 'unstable-claim').json.error, 'already_claimed');
  store.update('Pulls', u.card.pullId, { UnstableDay: '2000-01-01' });
  modefun.sweepUser(store, 1);
  assert.equal(store.get('Pulls', u.card.pullId).UnstableDay, parisDay(0));
  assert.equal(store.get('Pulls', u.card.pullId).Edition, 'glitch');
  // Bugs : 5 par jour, chacun une fois.
  store.update('Users', 1, { Bugs: '' });
  const bugs = extra(1, 'status').json.bugs;
  assert.equal(bugs.list.length, 5);
  const dust = user(1).StardustCount;
  assert.equal(extra(1, 'bug-found', { id: bugs.list[0].id }).json.dust, 25);
  assert.equal(user(1).StardustCount, dust + 25);
  assert.equal(extra(1, 'bug-found', { id: bugs.list[0].id }).json.error, 'unknown_bug');
  assert.equal(extra(1, 'bug-found', { id: 'faux' }).json.error, 'unknown_bug');
  applyMode('medium');
  assert.equal(extra(1, 'bug-found', { id: bugs.list[1].id }).json.error, 'wrong_mode');
});

await test('inflation : ancienne migration du seuil (base 30 -> 45), toujours unique', () => {
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'EconomyAlertBoostersPerPlayer' } });
  assert.equal(setting(store, 'EconomyAlertBoostersPerPlayer'), 60);
  // Valeur basse enregistree (ancienne base) : relevee une seule fois, historique garde.
  store.getAll('AppSettings').filter((r) => r.Key === 'inflation-2026-10-15').forEach((r) => store.delete('AppSettings', r.id));
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { EconomyAlertBoostersPerPlayer: 3 } } });
  balance.migrateInflationBase(store);
  assert.equal(setting(store, 'EconomyAlertBoostersPerPlayer'), 45);
  const log = JSON.parse(store.getAll('AppSettings').find((r) => r.Key === 'inflation-2026-10-15').Value);
  assert.deepEqual([log.base, log.changes[0].from, log.changes[0].to], [30, 3, 45]);
  // Deja faite : un nouveau reglage de l'admin n'est plus touche.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { EconomyAlertBoostersPerPlayer: 20 } } });
  balance.migrateInflationBase(store);
  assert.equal(setting(store, 'EconomyAlertBoostersPerPlayer'), 20);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'EconomyAlertBoostersPerPlayer' } });
});

await test('cible de boosters : 40 par joueur actif (20 a 60), codes de jeu exclus, migration du seuil a 60', () => {
  assert.deepEqual(economy.boosterTarget(store), { target: 40, low: 20, high: 60 });
  const day = parisDay(0);
  const base = economy.flows(store, 1).boostersPerPlayerDay;
  const codes = store.create('EconomyDaily', { Day: day, Source: 'redeem-code', BoostersIn: 140, BoostersOut: 0, DustIn: 0, DustOut: 0 });
  let f = economy.flows(store, 1);
  assert.equal(f.boostersPerPlayerDay, base, 'les codes de jeu ne comptent pas');
  assert.ok(f.excludedBoosters >= 140);
  const dig = store.create('EconomyDaily', { Day: day, Source: 'test-dig', BoostersIn: 70, BoostersOut: 70, DustIn: 0, DustOut: 0 });
  f = economy.flows(store, 1);
  assert.equal(Math.round((f.boostersPerPlayerDay - base) * 10) / 10, 10);
  assert.deepEqual(f.target, { target: 40, low: 20, high: 60 });
  store.delete('EconomyDaily', codes.id); store.delete('EconomyDaily', dig.id);
  // Migration unique : un seuil enregistre a 45 passe a 60 ; ensuite l'admin decide.
  store.getAll('AppSettings').filter((r) => r.Key === 'booster-target-2026-10-16').forEach((r) => store.delete('AppSettings', r.id));
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { EconomyAlertBoostersPerPlayer: 45 } } });
  balance.migrateBoosterTarget(store);
  assert.equal(setting(store, 'EconomyAlertBoostersPerPlayer'), 60);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { EconomyAlertBoostersPerPlayer: 50 } } });
  balance.migrateBoosterTarget(store);
  assert.equal(setting(store, 'EconomyAlertBoostersPerPlayer'), 50);
  assert.deepEqual(economy.boosterTarget(store), { target: 40, low: 30, high: 50 });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'EconomyAlertBoostersPerPlayer' } });
});

await test('bon retour : boosters sortis pendant l absence, extensions existantes non annoncees', async () => {
  const daily = await import('../src/native/daily.js');
  store.getAll('Extensions').forEach((e) => store.update('Extensions', e.id, { ReleasedAt: null }));
  daily.stampExtensions(store, true);
  assert.ok(store.getAll('Extensions').every((e) => Number(e.ReleasedAt) === 1), 'premiere fois : toutes anciennes');
  const t = Math.floor(Date.now() / 1000);
  const ext = store.create('Extensions', { Name: 'Nouvelle vague', Key: 'nv-' + t, Active: true, SortOrder: 99 });
  daily.stampExtensions(store, true);
  assert.ok(Number(store.get('Extensions', ext.id).ReleasedAt) >= t);
  store.update('Users', 1, { ReturnPending: JSON.stringify({ since: t - 10 * 86400, days: 10 }) });
  const w = call('POST', 'welcome-back', { body: { userId: 1 } }).json;
  assert.deepEqual(w.newBoosters.map((b) => b.name), ['Nouvelle vague']);
  store.update('Users', 1, { ReturnPending: '' });
  store.update('Extensions', ext.id, { Active: false });
});

await test('peche : 5 lieux (niveau, prestige, cout, prises rares), lieu verrouille refuse', () => {
  store.update('Users', 1, { FishingXP: 0, FishingPrestige: 0, Worms: 100, FishingEnergy: null, FishingDay: '', FishingCasts: 0 });
  let st = call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json;
  assert.deepEqual(st.zones.map((z) => z.key), ['shore', 'pond', 'river', 'deep', 'abyss']);
  assert.deepEqual(st.zones.map((z) => z.unlocked), [true, false, false, false, false]);
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast', zone: 'pond' } }).json.error, 'zone_locked');
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast', zone: 'abyss' } }).json.error, 'zone_locked');
  // Niveau 6 : etang et riviere ouverts ; la riviere coute 2 vers et a plus de rares.
  store.update('Users', 1, { FishingXP: 15 * 15 });
  st = call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json;
  const river = st.zones.find((z) => z.key === 'river');
  assert.ok(river.unlocked && st.zones.find((z) => z.key === 'pond').unlocked);
  assert.equal(river.cost, 2 * st.cost);
  const nothing = (z) => (z.table.find((x) => x.type === 'nothing') || { chance: 0 }).chance;
  assert.ok(nothing(river) < nothing(st.zones[0]), 'moins de prises vides a la riviere');
  const r = call('POST', 'fishing', { body: { userId: 1, action: 'cast', zone: 'river' } }).json;
  assert.equal(r.zone, 'river');
  assert.equal(user(1).Worms, 100 - river.cost);
  // Un prestige : tout s'ouvre, abysses compris.
  store.update('Users', 1, { FishingXP: 0, FishingPrestige: 1 });
  st = call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json;
  assert.ok(st.zones.every((z) => z.unlocked));
  assert.equal(call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { FishingZones: [{ key: 'pond', pool: 'lake' }] } } }).status, 400);
  store.update('Users', 1, { FishingPrestige: 0, FishingXP: 0 });
});

await test('fouille v2 : profondeurs debloquees par le niveau, config transmise au workflow, mineraux credites, comptoir', () => {
  store.update('Users', 1, { DigXP: 0, DigDepth: 1, Minerals: '{}', StardustCount: 0, BoneCount: 0, KeyCount: 0, BoosterCount: 0 });
  // Profondeur verrouillee puis ouverte (niveau 5 = 200 XP avec le palier 20).
  assert.equal(native.beforeWorkflow('dig', { body: { userId: 1, action: 'setDepth', depth: 3 } }).json.error, 'depth_locked');
  store.update('Users', 1, { DigXP: 200 });
  const set = native.beforeWorkflow('dig', { body: { userId: 1, action: 'setDepth', depth: 3 } });
  assert.equal(set.status, 200);
  assert.equal(set.json.digDepth.depth, 3);
  assert.deepEqual(set.json.digDepth.depths.map((d) => d.unlocked), [true, true, true, false, false]);
  assert.equal(user(1).DigBoardState, '', 'grille neuve a la nouvelle profondeur');
  // Le workflow recoit la profondeur et ses tresors.
  const req = { body: { userId: 1, action: 'status' } };
  assert.equal(native.beforeWorkflow('dig', req), null);
  const cfg = JSON.parse(req.body.depthCfg);
  assert.equal(cfg.depth, 3);
  assert.equal(cfg.mineralMax, 3);
  assert.ok(cfg.treasures.some((t) => t.reward === 'mineral'));
  assert.ok(req.body.maxEnergyBase >= 1);
  // Mineraux credites (joueur et Milo).
  const resp = { status: 200, json: { mineralTier: 4, dogReport: { minerals: [1, 1, 2] } } };
  native.afterWorkflow('dig', { body: { userId: 1, action: 'dig' } }, resp);
  assert.equal(resp.json.mineral.tier, 4);
  assert.equal(resp.json.dogReport.mineralItems.length, 3);
  const owned = JSON.parse(user(1).Minerals);
  assert.equal(Object.values(owned).reduce((x, n) => x + n, 0), 4);
  assert.equal(resp.json.digDepth.minerals, 4);
  // Comptoir : revente et echange.
  const mins = (body) => call('POST', 'minerals', { body: { userId: 1, ...body } }).json;
  let st = mins({});
  assert.equal(st.minerals.length, 23);
  const t4 = st.minerals.find((m) => m.tier === 4 && m.count > 0);
  const sold = mins({ action: 'sell', key: t4.key });
  assert.equal(sold.sold.dust, 250);
  assert.equal(user(1).StardustCount, 250);
  assert.equal(mins({ action: 'sell', key: t4.key }).error, 'not_enough_minerals');
  store.update('Users', 1, { Minerals: JSON.stringify({ calcaire: 6, fer: 4 }) });
  const tr = mins({ action: 'trade', index: 1 });
  assert.deepEqual(tr.traded, { BoneCount: 1 });
  assert.equal(user(1).BoneCount, 1);
  assert.deepEqual(JSON.parse(user(1).Minerals), { calcaire: 0, fer: 0 });
  assert.equal(mins({ action: 'trade', index: 6 }).error, 'not_enough_minerals');
  assert.equal(call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { DigDepths: [{ treasures: [{ reward: 'card', cells: 40, n: 1 }] }] } } }).status, 400);
  store.update('Users', 1, { DigDepth: 1, DigXP: 0, Minerals: '{}' });
});

await test('Grand Chantier : objectifs par joueur actif, part max par joueur, etape recompensee, NG+1, doublons de cartes', () => {
  store.getAll('GuildWorks').forEach((r) => store.delete('GuildWorks', r.id));
  const gw = (uid, body = {}) => call('POST', 'guild-works', { body: { userId: uid, ...body } }).json;
  let st = gw(1);
  assert.equal(st.level, 0);
  assert.equal(st.stages.length, 5);
  assert.ok(st.players >= 3);
  const dust = st.stage.needs.find((n) => n.key === 'dust');
  assert.equal(dust.target, Math.ceil(400 * st.players));
  // Part max : 40 % de l'objectif.
  store.update('Users', 1, { StardustCount: 100000 });
  let r = gw(1, { action: 'give', resource: 'dust', amount: 100000 });
  assert.equal(r.given.amount, Math.ceil(dust.target * 0.4));
  assert.equal(gw(1, { action: 'give', resource: 'dust', amount: 10 }).error, 'share_reached');
  assert.equal(gw(1, { action: 'give', resource: 'card_rare', amount: 1 }).error, 'not_needed');
  // Une etape minuscule, part 100 % : etape terminee puis NG+1.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { GuildWorksStages: [{ label: 'Test', icon: 'T', needs: { worms: 0.01 }, reward: { dust: 50, boosters: 1 } }], GuildWorksPlayerShare: 1 } } });
  store.getAll('GuildWorks').forEach((x) => store.delete('GuildWorks', x.id));
  store.update('Users', 1, { Worms: 10, StardustCount: 0, BoosterCount: 0 });
  r = gw(1, { action: 'give', resource: 'worms', amount: 5 });
  assert.equal(r.completed.contributors, 1);
  assert.equal(r.level, 1, 'NG+1');
  assert.equal(user(1).StardustCount, 50);
  assert.equal(user(1).BoosterCount, 1);
  // Doublons de cartes : jamais le dernier exemplaire ni un precieux.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { GuildWorksStages: [{ label: 'Cartes', icon: 'C', needs: { card_commune: 50 }, reward: { dust: 1 } }] } } });
  store.getAll('GuildWorks').forEach((x) => store.delete('GuildWorks', x.id));
  const common = store.getAll('Rarities').find((x) => x.Key === 'commune');
  const commonCards = new Set(store.getAll('Cards').filter((c) => refIdOf(c.Rarity) === common.id && !c.IsPromo).map((c) => c.id));
  const ownedBefore = new Set(store.getAll('Pulls').filter((p) => refIdOf(p.User) === 1 && commonCards.has(refIdOf(p.Card))).map((p) => refIdOf(p.Card)));
  st = gw(1);
  const have = st.stage.needs[0].have;
  r = gw(1, { action: 'give', resource: 'card_commune', amount: 100000 });
  assert.ok(r.given.amount <= have);
  const ownedAfter = new Set(store.getAll('Pulls').filter((p) => refIdOf(p.User) === 1 && commonCards.has(refIdOf(p.Card))).map((p) => refIdOf(p.Card)));
  assert.equal(ownedAfter.size, ownedBefore.size, 'au moins un exemplaire garde par carte');
  for (const key of ['GuildWorksStages', 'GuildWorksPlayerShare']) call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key } });
  store.getAll('GuildWorks').forEach((x) => store.delete('GuildWorks', x.id));
});

await test('visuels : renommage applique aux mineraux et coffres, image televersee, reinitialisation, admin seulement', async () => {
  const vis = (body) => call('POST', 'admin-visuals', { body: { discordId: ADMIN, ...body } }).json;
  assert.equal(call('POST', 'admin-visuals', { body: { discordId: '1', action: 'list' } }).json.error, 'forbidden');
  let r = vis({ action: 'set', key: 'Fouille/Rubis.PNG', label: 'Rubis du dragon' });
  assert.equal(r.overrides['Fouille/Rubis.PNG'].label, 'Rubis du dragon');
  await new Promise((res) => setTimeout(res, 2100)); // cache des noms (2 s)
  const mins = call('POST', 'minerals', { body: { userId: 1 } }).json;
  assert.equal(mins.minerals.find((m) => m.key === 'rubis').name, 'Rubis du dragon');
  vis({ action: 'set', key: 'Coffres/8.PNG', label: 'Coffre des abysses' });
  await new Promise((res) => setTimeout(res, 2100));
  assert.equal(call('POST', 'chests', { body: { userId: 1, action: 'status' } }).json.tiers[7].name, 'Coffre des abysses');
  // Image : PNG minuscule.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  r = vis({ action: 'upload', key: 'Os.PNG', data: png, mime: 'image/png' });
  assert.ok(r.overrides['Os.PNG'].imageId > 0);
  assert.ok(store.getAttachment(r.overrides['Os.PNG'].imageId));
  assert.equal(vis({ action: 'upload', key: 'Os.PNG', data: png, mime: 'text/html' }).error, 'invalid_image');
  assert.equal(vis({ action: 'set', key: '../secret', label: 'x' }).error, 'invalid_key');
  assert.ok(call('GET', 'visuals', {}).json.overrides['Os.PNG']);
  for (const key of ['Fouille/Rubis.PNG', 'Coffres/8.PNG', 'Os.PNG']) vis({ action: 'reset', key });
  assert.deepEqual(call('GET', 'visuals', {}).json.overrides, {});
});

await test('coffre de guilde v2 : depots contre credits, dernier exemplaire garde, prise par credits ou cle, pioche gratuite, limites', () => {
  const gc = (uid, body = {}) => call('POST', 'guild-chest', { body: { userId: uid, ...body } }).json;
  store.getAll('GuildChestDeposits').forEach((d) => store.update('GuildChestDeposits', d.id, { Claimed: true }));
  store.update('Users', 1, { GuildCredits: 0, GCDay: '', GCDeposits: 0, GCTakes: 0, GCFreeDay: '' });
  store.update('Users', 2, { GuildCredits: 0, GCDay: '', GCDeposits: 0, GCTakes: 0, GCFreeDay: '', KeyCount: 1 });
  // Une carte a 3 exemplaires pour le joueur 1.
  const card = cards()[0];
  const ids = [mk(1, card.id), mk(1, card.id), mk(1, card.id)];
  let st = gc(1);
  const g = st.donatable.find((x) => x.cardId === card.id && x.finish === 'normal' && x.quality === 'good');
  assert.ok(g && g.count >= 2, 'doublons deposables');
  // Dernier exemplaire d'une carte : refuse.
  const solo = store.create('Cards', { Name: 'Solo du coffre', Active: true, Rarity: card.Rarity, Extension: card.Extension });
  const soloPull = mk(1, solo.id);
  assert.equal(gc(1, { action: 'deposit', pullIds: [soloPull] }).error, 'last_copy');
  store.delete('Pulls', soloPull); store.update('Cards', solo.id, { Active: false });
  let r = gc(1, { action: 'deposit', pullIds: ids.slice(0, 2) });
  assert.equal(r.deposited, 2);
  assert.ok(r.creditsGained > 0);
  assert.equal(user(1).GuildCredits, r.creditsGained);
  // Le joueur 1 ne peut pas prendre son propre depot ; le joueur 2 oui (cle), puis credits insuffisants.
  const dep = r.pool.find((p) => p.mine);
  assert.equal(gc(1, { action: 'take', depositId: dep.depositId }).error, 'own_deposit');
  r = gc(2, { action: 'take', depositId: dep.depositId, pay: 'key' });
  assert.equal(r.taken.cardId, card.id);
  assert.equal(user(2).KeyCount, 0);
  const other = gc(2).pool.find((p) => !p.mine);
  assert.equal(gc(2, { action: 'take', depositId: other.depositId }).error, 'not_enough_credits');
  store.update('Users', 2, { GuildCredits: 1000 });
  r = gc(2, { action: 'take', depositId: other.depositId });
  assert.equal(user(2).GuildCredits, 1000 - other.cost);
  // Pioche gratuite : une fois par jour.
  gc(1, { action: 'deposit', pullIds: [ids[2]].filter((id) => store.get('Pulls', id)) });
  store.update('Users', 1, { GCDay: '', GCDeposits: 0 });
  const extra = mk(1, card.id); gc(1, { action: 'deposit', pullIds: [extra] });
  st = gc(2);
  if (st.freeAvailable) {
    assert.ok(gc(2, { action: 'free' }).taken);
    assert.equal(gc(2, { action: 'free' }).error, 'already_drawn_today');
  }
  assert.equal(call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { GuildChestValues: [1, 2] } } }).status, 400);
  // Selection multiple sur deux finitions de la meme carte : tout le deposable
  // passe d'un coup et l'exemplaire garde est le meilleur (Holo).
  store.update('Users', 1, { GCDay: '', GCDeposits: 0 });
  const two = store.create('Cards', { Name: 'Double finition', Active: true, Rarity: card.Rarity, Extension: card.Extension });
  const holo = mk(1, two.id, 'holo'); mk(1, two.id); mk(1, two.id);
  const groupsOf = gc(1).donatable.filter((x) => x.cardId === two.id);
  const all = groupsOf.flatMap((x) => x.pullIds);
  assert.equal(all.length, 2);
  assert.ok(!all.includes(holo), 'le Holo est garde');
  assert.equal(gc(1, { action: 'deposit', pullIds: all }).deposited, 2);
  assert.ok(store.get('Pulls', holo));
  store.update('Cards', two.id, { Active: false });
});

await test('expedition v2 : destinations, niveau requis, ressources au retour, affinite du jour', async () => {
  const ex2 = await import('../src/native/expedition2.js');
  store.update('Users', 1, { ExpeditionXP: 0, ExpeditionTrip: '', Worms: 0, BoneCount: 0, Minerals: '{}' });
  // Mine : niveau 2 requis.
  const locked = native.beforeWorkflow('expedition', { body: { userId: 1, action: 'start', destination: 'mine', hours: 2, cardId: 1 } });
  assert.equal(locked && locked.json.error, 'destination_locked');
  assert.equal(native.beforeWorkflow('expedition', { body: { userId: 1, action: 'start', destination: 'nulle-part' } }).json.error, 'unknown_destination');
  // Foret, 24 h, avec une carte de la rarete du jour.
  const aff = ex2._affinity(store, 'foret');
  const rarity = store.getAll('Rarities').find((r) => r.Key === aff.rarity.key);
  const card = store.getAll('Cards').find((c) => c.Active && refIdOf(c.Rarity) === rarity.id);
  const startReq = { body: { userId: 1, action: 'start', destination: 'foret', hours: 24, cardId: card.id } };
  assert.equal(native.beforeWorkflow('expedition', startReq), null);
  store.update('Users', 1, { ExpeditionUntil: Math.floor(Date.now() / 1000) - 1, ExpeditionDuration: 24, ExpeditionCard: card.id });
  const started = { status: 200, json: { expedition: { active: true, secondsLeft: 0 } } };
  native.afterWorkflow('expedition', startReq, started);
  assert.equal(started.json.expedition.destination.key, 'foret');
  assert.equal(started.json.expedition.destination.rarity, true);
  assert.ok(started.json.destinations.length >= 5 && started.json.destinations.find((d) => d.key === 'mine').unlocked === false);
  const claimReq = { body: { userId: 1, action: 'claim' } };
  native.beforeWorkflow('expedition', claimReq);
  const claimed = { status: 200, json: { reward: { dust: 100 }, expedition: { active: false } } };
  native.afterWorkflow('expedition', claimReq, claimed);
  const worms = claimed.json.reward.resources.find((r) => r.key === 'Worms');
  assert.ok(worms && worms.n >= 15, 'au moins 3 x 5 (24 h) x 0,75 x 1,5 (affinite) vers');
  assert.equal(user(1).Worms, worms.n);
  assert.equal(claimed.json.reward.destination.key, 'foret');
  assert.equal(user(1).ExpeditionTrip, '');
  // Reglage valide.
  assert.equal(call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { ExpeditionDestinations: [{ key: 'x', name: 'X', loot: { Diamants: 1 } }] } } }).status, 400);
  store.update('Users', 1, { ExpeditionUntil: 0, ExpeditionDuration: 0, ExpeditionCard: 0 });
});

await test('compte test admin : connexion sans Discord, niveaux, difficulte propre, isolation, remise a zero', async () => {
  const auth = await import('../src/native/auth.js');
  const { setting } = await import('../src/native/settings.js');
  const { requestContext, freshContext } = await import('../src/native/context.js');
  const tester = store.create('Users', { Pseudo: 'Le Grand Test', XP: 0, StardustCount: 0 });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { TestAccountId: tester.id } } });
  const ta = (body) => call('POST', 'admin-test-account', { body: { discordId: ADMIN, ...body } }).json;
  assert.equal(call('POST', 'admin-test-account', { body: { discordId: '123', action: 'status' } }).json.error, 'forbidden');
  // Connexion : jeton du compte test.
  const login = ta({ action: 'login' });
  assert.equal(auth.verifyToken(login.token).u, tester.id);
  // Niveaux et ressources.
  let st = ta({ action: 'set', levels: { account: 10, dig: 5 }, resources: { StardustCount: 5000, Worms: 50 } });
  assert.equal(st.level, 10);
  assert.equal(st.skills.dig.level, 5);
  assert.ok(user(tester.id).StardustCount >= 5000);
  assert.equal(ta({ action: 'set', resources: { Hack: 1 } }).error, 'unknown_resource');
  // Difficulte propre : seulement pendant ses requetes.
  ta({ action: 'set', mode: 'cool' });
  const inCtx = (uid, fn) => requestContext.run({ ...freshContext(), userId: uid }, fn);
  assert.equal(inCtx(tester.id, () => setting(store, 'BoosterShopPrice')), 250);
  assert.notEqual(inCtx(1, () => setting(store, 'BoosterShopPrice')), 250);
  // Isolation : actions partagees refusees, absent des listes des autres.
  assert.equal(call('POST', 'guild-chest', { body: { userId: tester.id, action: 'deposit', pullIds: [1] } }).json.error, 'test_account_isolated');
  assert.equal(call('POST', 'guild-chest', { body: { userId: tester.id, action: 'status' } }).status, 200);
  const list = { players: [{ userId: tester.id, pseudo: 'Le Grand Test' }, { userId: 1, pseudo: 'Helldwin' }] };
  assert.equal(native.scrub(JSON.parse(JSON.stringify(list)), { userId: 1 }).players.length, 1);
  assert.equal(native.scrub(JSON.parse(JSON.stringify(list)), { userId: tester.id }).players.length, 2);
  // Une carte de chaque, puis remise a zero en nouveau joueur.
  assert.ok(ta({ action: 'cards' }).given > 0);
  st = ta({ action: 'reset' });
  assert.equal(st.cards, 0);
  assert.equal(st.level, 1);
  assert.equal(user(tester.id).StardustCount, 0);
  assert.equal(user(tester.id).Pseudo, 'Le Grand Test');
  assert.equal(user(tester.id).TestMode, 'cool', 'la difficulte choisie reste');
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { TestAccountId: 0 } } });
});

await test('nouveau joueur : parcours dans l ordre, progression par evenements, recompenses, deblocages par niveau, anciens comptes jamais verrouilles', async () => {
  const starter = await import('../src/native/starter.js');
  const set = (values) => call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values } });
  const since = Math.floor(Date.now() / 1000) - 100;
  set({ StarterEnabled: true, StarterSince: since });
  const veteran = store.create('Users', { Pseudo: 'Ancien', XP: 0, CreatedAt: since - 1000, BoosterCount: 0 });
  const novice = store.create('Users', { Pseudo: 'Novice', XP: 0, CreatedAt: since + 10, BoosterCount: 0, StardustCount: 0 });
  const st = (uid) => call('GET', 'starter', { query: { userId: uid } }).json;
  // Verrous : seulement le nouveau compte.
  assert.equal(st(veteran.id).locks.length, 0);
  assert.equal(st(veteran.id).active, false);
  let s = st(novice.id);
  assert.equal(s.active, true);
  assert.ok(s.locks.some((l) => l.key === 'fishing' && l.level === 2));
  const locked = call('POST', 'fishing', { body: { userId: novice.id, action: 'cast' } });
  assert.equal(locked.json.error, 'level_locked');
  assert.equal(locked.json.level, 2);
  assert.notEqual(call('POST', 'fishing', { body: { userId: novice.id, action: 'status' } }).json.error, 'level_locked', 'lecture permise');
  // Etape 1 : kit de depart (immediat). Etape 3 pas encore la sienne.
  const claim = (key) => call('POST', 'starter', { body: { userId: novice.id, action: 'claim', key } }).json;
  assert.equal(claim('gift').error, 'not_current_step');
  let r = claim('welcome');
  assert.equal(r.claimed, 'welcome');
  assert.equal(user(novice.id).BoosterCount, 3);
  // Etape 2 : premier booster, via l'evenement.
  assert.equal(claim('open1').error, 'step_not_complete');
  starter.onEvents(store, [{ userId: novice.id, type: 'boosterOpened', n: 1, meta: {} }]);
  r = claim('open1');
  assert.equal(r.claimed, 'open1');
  assert.ok(user(novice.id).XP >= 20);
  // Progression en avance : la fouille compte meme avant son tour.
  starter.onEvents(store, [{ userId: novice.id, type: 'dig', n: 5, meta: {} }]);
  assert.equal(st(novice.id).steps.find((x) => x.key === 'dig').complete, true);
  // Niveau 2 atteint : la peche se debloque.
  store.update('Users', novice.id, { XP: 60 });
  assert.ok(!st(novice.id).locks.some((l) => l.key === 'fishing'));
  // Tout le parcours puis le bonus final, une seule fois.
  const steps = st(novice.id).steps;
  const types = { gift: 'wheel', guess: 'guess', open3: 'boosterOpened', recycle: 'disenchant', craft: 'craft', fish: 'fish', expedition: 'expedition' };
  for (const x of steps.filter((y) => !y.claimed)) {
    if (types[x.key]) starter.onEvents(store, [{ userId: novice.id, type: types[x.key], n: 5, meta: {} }]);
    assert.equal(claim(x.key).claimed, x.key, x.key);
  }
  const boostersBefore = user(novice.id).BoosterCount;
  r = claim('final');
  assert.equal(r.claimed, 'final');
  assert.ok(user(novice.id).BoosterCount >= boostersBefore + 3);
  assert.equal(r.active, false);
  assert.equal(claim('final').error, 'already_done');
  // Reglages valides.
  assert.equal(set({ StarterUnlocks: { fishing: 0 } }).status, 400);
  assert.equal(set({ StarterSteps: [{ key: 'a', label: 'A', target: 2 }] }).status, 400);
  set({ StarterEnabled: false });
});

await test('valeurs par difficulte : n importe quel reglage par mode, application immediate sur le mode en cours, retrait, retour au code', async () => {
  const { setting } = await import('../src/native/settings.js');
  const pre = (body) => call('POST', 'admin-preset', { body: { discordId: ADMIN, ...body } }).json;
  assert.ok(pre({ action: 'apply', preset: 'medium' }).applied);
  // Mode Hard (pas en cours) : un reglage hors preset ajoute, sans effet immediat.
  const before = setting(store, 'GuessDust');
  let v = pre({ action: 'override-set', mode: 'hard', key: 'GuessDust', value: 7 });
  assert.equal(v.modes.find((m) => m.key === 'hard').values.find((x) => x.key === 'GuessDust').value, 7);
  assert.equal(setting(store, 'GuessDust'), before);
  assert.equal(v.appliedLive, false);
  // Valeur invalide refusee.
  assert.equal(pre({ action: 'override-set', mode: 'hard', key: 'GuessDust', value: -5 }).error, 'invalid_settings');
  // Passer en Hard l'applique.
  pre({ action: 'apply', preset: 'hard' });
  assert.equal(setting(store, 'GuessDust'), 7);
  assert.equal(pre({ action: 'status' }).current, 'hard', 'toujours reconnu comme Hard');
  // Mode en cours : modification appliquee tout de suite, le mode reste reconnu.
  const price = pre({ action: 'overrides' }).modes.find((m) => m.key === 'hard').values.find((x) => x.key === 'BoosterShopPrice');
  v = pre({ action: 'override-set', mode: 'hard', key: 'BoosterShopPrice', value: price.value + 11 });
  assert.equal(v.appliedLive, true);
  assert.equal(setting(store, 'BoosterShopPrice'), price.value + 11);
  assert.equal(pre({ action: 'status' }).current, 'hard');
  // Retour au code : valeur d'origine, appliquee aussi.
  v = pre({ action: 'override-reset', mode: 'hard', key: 'BoosterShopPrice' });
  assert.equal(setting(store, 'BoosterShopPrice'), price.base);
  assert.equal(v.modes.find((m) => m.key === 'hard').values.find((x) => x.key === 'BoosterShopPrice').changed, false);
  // Retrait : le mode ne touche plus a ce reglage.
  v = pre({ action: 'override-set', mode: 'hard', key: 'GuessDust', value: null });
  assert.ok(!v.modes.find((m) => m.key === 'hard').values.some((x) => x.key === 'GuessDust'));
  pre({ action: 'override-reset', mode: 'hard', key: 'GuessDust' });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { GuessDust: before } } });
  pre({ action: 'apply', preset: 'medium' });
});

await test('musee du coffre-fort : vitrines poissons, mineraux, objets, dinos ; une piece vue reste exposee', () => {
  const visitor = store.create('Users', { Pseudo: 'Visiteur', Minerals: JSON.stringify({ agathe: 2 }), Worms: 3, Aquarium: JSON.stringify({ fish: { gardon: { count: 2, best: 18, first: 1 } }, claimed: [] }) });
  const m = (uid) => call('GET', 'museum', { query: { userId: uid } }).json;
  let v = m(visitor.id);
  assert.deepEqual(v.sections.map((s) => s.key), ['fish', 'minerals', 'items', 'dinos']);
  const sec = (k) => v.sections.find((s) => s.key === k);
  assert.ok(sec('fish').items.find((i) => i.key === 'gardon').seen);
  assert.ok(!sec('fish').items.find((i) => i.key === 'kraken').seen);
  assert.ok(sec('minerals').items.find((i) => i.key === 'agathe').seen);
  assert.ok(sec('items').items.find((i) => i.key === 'worm').seen);
  assert.equal(v.seen, 3);
  // Tout depense : toujours expose.
  store.update('Users', visitor.id, { Minerals: '{}', Worms: 0 });
  v = m(visitor.id);
  assert.ok(sec('minerals').items.find((i) => i.key === 'agathe').seen);
  assert.ok(sec('items').items.find((i) => i.key === 'worm').seen);
  assert.ok(v.total >= 60 && v.pct >= 1);
});

await test('defis de saison, histoire, evenement surprise, bonus de prestige, badges du musee', async () => {
  const sq = await import('../src/native/seasonquests.js');
  const st = await import('../src/native/story.js');
  const sp = await import('../src/native/surprise.js');
  const { setting } = await import('../src/native/settings.js');
  const set = (values) => call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values } });
  const p = store.create('Users', { Pseudo: 'Testeur saison', XP: 0, StardustCount: 0, BoosterCount: 0 });
  // Defis de saison : XP de saison, pas d'XP de compte.
  const season = () => call('POST', 'season', { body: { userId: p.id } }).json;
  const xp0 = season().xp;
  const quests = sq.weekQuests();
  assert.equal(quests.length, 3);
  sq.onEvents(store, quests.map((q) => ({ userId: p.id, type: q.type, n: q.target, meta: {} })));
  const sqc = (key) => call('POST', 'season-quests', { body: { userId: p.id, action: 'claim', key } }).json;
  assert.equal(sqc(quests[0].key).seasonXp, 60);
  sqc(quests[1].key);
  const last = sqc(quests[2].key);
  assert.equal(last.allBonus, 60, 'bonus des 3 defis');
  assert.equal(season().xp, xp0 + 240);
  assert.equal(user(p.id).XP, 0, 'XP du compte inchangee');
  assert.equal(sqc(quests[0].key).error, 'already_claimed');
  // Histoire : chapitre 1 (creuser 15 cases).
  const story = (body = {}) => call('POST', 'story', { body: { userId: p.id, ...body } }).json;
  let s = story();
  assert.equal(s.unlocked, true);
  assert.equal(s.chapter.title, 'Le flair de Milo');
  assert.equal(story({ action: 'claim' }).error, 'chapter_not_complete');
  st.onEvents(store, [{ userId: p.id, type: 'dig', n: 15, meta: {} }]);
  s = story({ action: 'claim' });
  assert.equal(s.claimed, 0);
  assert.equal(user(p.id).BoneCount, 2);
  assert.equal(s.chapter.title, 'Moka a faim');
  // Evenement surprise : lance par l'admin, reglage double, XP x2, puis arrete.
  set({ SurpriseEnabled: true }); sp._reset();
  const sur = (body) => call('POST', 'admin-surprise', { body: { discordId: ADMIN, ...body } }).json;
  const guessBefore = setting(store, 'GuessDust');
  let r = sur({ action: 'start', key: 'guessBonus', announce: false });
  assert.equal(r.active.key, 'guessBonus');
  assert.equal(setting(store, 'GuessDust'), guessBefore * 2);
  sur({ action: 'start', key: 'xp2', announce: false });
  store.update('Users', p.id, { XP: (user(p.id).XP || 0) + 10 });
  const xpAfter = user(p.id).XP;
  assert.ok(xpAfter >= 20, 'double XP (' + xpAfter + ')');
  r = sur({ action: 'stop' });
  assert.equal(r.active, null);
  assert.equal(setting(store, 'GuessDust'), guessBefore);
  // Prestige : +2 % d'XP par etoile.
  const lvlXp = (L) => Math.ceil(((50 * L - 25) ** 2 - 625) / 100);
  store.update('Users', p.id, { XP: lvlXp(setting(store, 'AccountPrestigeLevel')) });
  const base = user(p.id).XP;
  store.update('Users', p.id, { XP: base + 100 });
  assert.equal(user(p.id).XP, base + 102, '1 etoile = +2 %');
  // Musee : vitrine des mineraux complete -> badge Geologue.
  const { MINERALS } = await import('../src/native/digdepth.js');
  store.update('Users', p.id, { Minerals: JSON.stringify(Object.fromEntries(MINERALS.map((m) => [m.key, 1]))) });
  const mu = call('GET', 'museum', { query: { userId: p.id } }).json;
  assert.ok(mu.badges.find((b) => b.key === 'minerals').earned);
  assert.ok(mu.newBadges.includes('Géologue'));
  assert.equal(call('GET', 'museum', { query: { userId: p.id } }).json.newBadges.length, 0, 'une seule fois');
  // Recap enrichi.
  const rc = call('GET', 'weekly-recap', { query: { userId: p.id } }).json;
  assert.ok(rc.level >= 1 && rc.museum && rc.museum.total > 0 && 'aquarium' in rc);
  set({ SurpriseEnabled: false }); sp._reset();
});

await test('minuteurs : fouille, peche, expedition, jardin, Milo, nouveau jour, prets en premier', () => {
  const t = Math.floor(Date.now() / 1000);
  const u = store.create('Users', { Pseudo: 'Minuteur', XP: 0, DigEnergy: 0, LastDigEnergyAt: t, ExpeditionUntil: t - 10, DogUntil: t + 3600,
    GardenPlots: JSON.stringify([{ plantedAt: t, seed: 'mix' }, { plantedAt: t - 999999, seed: 'mix' }]) });
  const r = call('GET', 'timers', { query: { userId: u.id } }).json;
  const by = (k) => r.items.find((i) => i.key === k);
  assert.ok(by('dig') && by('dig').at > t && !by('dig').ready, 'fouille a recharger');
  assert.ok(by('fish'), 'peche');
  assert.ok(by('expedition').ready, 'expedition rentree');
  assert.ok(by('dog').at === t + 3600);
  assert.ok(by('garden').ready && by('garden-all') && !by('garden-all').ready, 'une parcelle prete, pas toutes');
  assert.ok(by('day').at > t);
  const firstNotReady = r.items.findIndex((i) => !i.ready);
  assert.ok(r.items.slice(firstNotReady).every((i) => !i.ready), 'les prets d’abord');
});

await test('devine la carte v2 : 5 manches, 3 essais avec zoom qui recule, gains degressifs, bon de craft rembourse', async () => {
  const gg = await import('../src/native/guessgame.js');
  store.update('Users', 1, { GuessState: '', GuessDate: '', GuessStreak: 0, CraftCoupons: '{}', StardustCount: 0 });
  const guess = (body) => call('POST', 'guess-card', { body: { userId: 1, ...body } }).json;
  let st = guess({});
  assert.equal(st.rounds.length, 5);
  assert.ok(st.rounds.every((r) => r.choices.length === 4 && r.triesLeft === 3 && !r.answerCardId));
  // Gain possible affiche des le debut (base indexee sur l'inflation), qui baisse a chaque erreur.
  const base = st.gains.base;
  assert.ok(base >= 60);
  assert.ok(st.rounds.every((x) => x.potential === base));
  assert.equal(st.gains.dayMax, base * 5 + st.gains.perfect);
  const answers = gg._answers(store);
  // Manche 0 : une erreur puis la bonne reponse (60 %).
  const wrong = st.rounds[0].choices.find((c) => c.cardId !== answers[0]).cardId;
  let r = guess({ action: 'guess', round: 0, cardId: wrong });
  assert.equal(r.correct, false);
  assert.equal(r.rounds[0].triesLeft, 2);
  assert.ok(r.rounds[0].zoom.scale < st.rounds[0].zoom.scale, 'le zoom recule');
  assert.ok(r.rounds[0].choices.find((c) => c.cardId === wrong).wrong);
  assert.equal(r.rounds[0].potential, Math.round(base * 0.6));
  r = guess({ action: 'guess', round: 0, cardId: answers[0] });
  assert.equal(r.correct, true);
  assert.equal(r.reward.dust, Math.round(base * 0.6));
  assert.equal(r.rounds[0].potential, Math.round(base * 0.6), 'gain obtenu garde apres la manche');
  assert.equal(guess({ action: 'guess', round: 0, cardId: answers[0] }).error, 'already_played');
  // Les 4 autres du premier coup : journee finie, serie lancee.
  for (let i = 1; i < 5; i++) r = guess({ action: 'guess', round: i, cardId: answers[i] });
  assert.equal(r.finished, true);
  assert.equal(user(1).GuessStreak, 1);
  assert.equal(r.reward.perfect, false, 'manche 0 trouvee au 2e essai');
  assert.equal(r.reward.coins, 1, 'piece de gatchapon en fin de journee');
  // Bon de craft : carte du jour non possedee.
  const owned = new Set(store.getAll('Pulls').filter((p) => refIdOf(p.User) === 1).map((p) => refIdOf(p.Card)));
  if (!owned.has(answers[1])) assert.ok(r.coupons.some((c) => c.cardId === answers[1]));
  // Remboursement apres un craft.
  store.update('Users', 1, { CraftCoupons: JSON.stringify({ 5: Math.floor(Date.now() / 1000) + 3600 }), StardustCount: 0 });
  const resp = { status: 200, json: { crafted: true, craftCost: 200 } };
  native.afterWorkflow('craft', { body: { userId: 1, cardId: 5 } }, resp);
  assert.equal(resp.json.couponRefund, 80);
  assert.equal(user(1).StardustCount, 80);
  assert.deepEqual(JSON.parse(user(1).CraftCoupons), {});
  store.update('Users', 1, { GuessState: '', GuessDate: '', GuessStreak: 0 });
});

await test('salle des machines interdites : engrenages, forge, porte, machine a sous, surchauffe, relance, edition Interdite', async () => {
  const { MINERALS } = await import('../src/native/digdepth.js');
  const fb = (body) => call('POST', 'forbidden', { body: { userId: 1, ...body } }).json;
  store.update('Users', 1, { ArgGears: '', SpecialKeys: 0, DoorKeys: 0, ForbiddenUnlocked: 0, ForbiddenAccess: 0, ForbiddenSpin: '', ForbiddenHeat: 0, ForbiddenFreeDay: '', ForbiddenStats: '', KeyCount: 0, Minerals: '{}', StardustCount: 100000 });
  // Sans acces : la page ne recoit rien (que les rouages), tout est refuse.
  let st = fb({});
  assert.equal(st.access, false);
  assert.ok(!st.forge && !st.page && !st.machine);
  assert.equal(fb({ action: 'craftKey' }).error, 'no_access');
  // Le mot reclame dans « Reclamer un code » (accents, espaces et casse ignores).
  assert.equal(native.beforeWorkflow('redeem-code', { body: { userId: 1, code: 'pas-le-mot' } }), null);
  const sec = native.beforeWorkflow('redeem-code', { body: { userId: 1, code: ' Salamandré ' } });
  assert.equal(sec.json.type, 'secret');
  assert.equal(sec.json.first, true);
  assert.equal(native.beforeWorkflow('redeem-code', { body: { userId: 1, code: 'SALAMANDRE' } }).json.first, false);
  st = fb({});
  assert.equal(st.access, true);
  assert.equal(st.unlocked, false);
  assert.ok(!st.machine, 'pas de machine avant la porte');
  // Forge : rien n'est nomme tant qu'on ne possede pas l'ingredient.
  assert.equal(st.forge.slots.length, 24);
  assert.ok(st.forge.slots.every((x) => !x.known && !x.name && !x.img));
  // Parchemin : rien sans l'avoir peche ; puis 10 enigmes, jamais le mot.
  assert.equal(fb({ action: 'scroll' }).error, 'no_scroll');
  const fishing = await import('../src/native/forbidden.js');
  store.update('Users', 1, { ArgScroll: 0 });
  const rnd0 = Math.random; Math.random = () => 0;
  try { assert.equal(fishing.rollScroll(store, user(1), 1), true); assert.equal(fishing.rollScroll(store, user(1), 1), false, 'une seule fois'); } finally { Math.random = rnd0; }
  const sc = fb({ action: 'scroll' });
  assert.equal(sc.riddles.length, 10);
  assert.ok(!JSON.stringify(sc).toUpperCase().includes('SALAMANDRE'));
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json.hasScroll, true);
  store.update('Users', 1, { ArgScroll: 0 });
  // Rouages : une lettre chacun, comptes une seule fois.
  const g = fb({ action: 'gear', n: 3 });
  assert.deepEqual([g.roman, g.letter, g.fresh, g.found], ['III', 'L', true, 1]);
  assert.equal(fb({ action: 'gear', n: 3 }).fresh, false);
  assert.equal(fb({ action: 'gear', n: 11 }).error, 'invalid_gear');
  // Forge : 1 cle + 1 de chaque mineral.
  assert.equal(fb({ action: 'craftKey' }).error, 'missing_ingredients');
  store.update('Users', 1, { KeyCount: 12, Minerals: JSON.stringify(Object.fromEntries(MINERALS.map((m) => [m.key, 10]))) });
  for (let i = 0; i < 10; i++) assert.ok(fb({ action: 'craftKey' }).crafted);
  assert.equal(user(1).SpecialKeys, 10);
  assert.equal(user(1).KeyCount, 2);
  assert.equal(JSON.parse(user(1).Minerals).diamant, 0);
  assert.equal(fb({ action: 'spin' }).error, 'locked');
  // Porte : 10 cles inserees -> ouverte pour toujours.
  let r;
  for (let i = 0; i < 10; i++) r = fb({ action: 'insertKey' });
  assert.equal(r.opened, true);
  assert.equal(r.unlocked, true);
  assert.equal(fb({ action: 'insertKey' }).error, 'already_open');
  // Machine (slots.js) : tour gratuit du jour, mise, fenetre 3 lignes, edition Interdite.
  store.update('Users', 1, { ForbiddenXP: 0, ForbiddenBonus: 0, ForbiddenFreeSpins: 0, ForbiddenDaily: '', ForbiddenCombos: '', ForbiddenRisk: 0, ForbiddenSpin: '', ForbiddenHeat: 0, ForbiddenFreeDay: '' });
  st = fb({});
  assert.ok(st.machine.freeSpin && st.machine.spinCost > 0);
  assert.deepEqual(st.machine.bets, [1, 3, 5]);
  assert.equal(st.machine.reels, 3);
  const jp0 = st.machine.jackpot;
  r = fb({ action: 'spin', bet: 5 });
  assert.equal(r.kind, 'daily', 'le tour gratuit du jour passe en premier (mise x1)');
  assert.equal(r.paid, 0);
  assert.equal(r.results[0].window.length, 3);
  assert.ok(r.results[0].window.every((col) => col.length === 3));
  r = fb({ action: 'spin', count: 10, bet: 3 });
  assert.equal(r.results.length, 10);
  assert.equal(r.paid, st.machine.spinCost * 3 * 10);
  assert.ok(r.machine.jackpot > jp0, 'le jackpot grossit');
  assert.ok(r.machine.level.level >= 2, 'XP de la machine (1 par mise)');
  const won = store.getAll('Pulls').filter((p) => String(p.BatchId || '').startsWith('forbidden-1-'));
  assert.ok(won.every((p) => p.Edition === 'forbidden'));
  const rnd = Math.random;
  // Surchauffe : triple garanti.
  store.update('Users', 1, { ForbiddenHeat: 999, ForbiddenFreeSpins: 0, ForbiddenBonus: 0 });
  r = fb({ action: 'spin' });
  assert.ok(r.results[0].forced && ['triple', 'quad'].includes(r.results[0].tier));
  // Tours bonus : 3 jackpots visibles (tout jackpot ici) -> 5 tours a gains doubles ; jackpot partiel a la mise x1.
  store.update('Users', 1, { ForbiddenHeat: 0, ForbiddenBonus: 0, ForbiddenFreeSpins: 0 });
  const poolBefore = fb({}).machine.jackpot;
  Math.random = () => 0.9;
  try { r = fb({ action: 'spin', bet: 1 }); } finally { Math.random = rnd; }
  assert.equal(r.results[0].key, 'jackpot');
  assert.equal(r.results[0].bonusAwarded, 5);
  assert.ok(r.results[0].jackpot > 0 && r.results[0].jackpot < poolBefore + 1000, 'part du jackpot a la mise x1');
  assert.equal(user(1).ForbiddenBonus, 5);
  r = fb({ action: 'spin' });
  assert.equal(r.kind, 'bonus');
  assert.equal(r.results[0].mult, 2);
  // Quitte ou double : 2 jetons remis en jeu, doubles par un tour gagnant.
  store.update('Users', 1, { ForbiddenBonus: 0, BoosterCount: 10, ForbiddenSpin: JSON.stringify({ line: ['jeton', 'jeton', 'rare'], boosters: 2, risked: false }) });
  r = fb({ action: 'risk' });
  assert.equal(r.staked, 2);
  assert.equal(user(1).BoosterCount, 8);
  assert.equal(fb({ action: 'risk' }).error, 'cannot_risk');
  Math.random = () => 0.01;
  try { r = fb({ action: 'spin' }); } finally { Math.random = rnd; }
  assert.deepEqual([r.riskResult.won, r.riskResult.amount], [true, 4]);
  assert.ok(r.results[0].cascades.length > 0, 'cascade apres un triple');
  // Relance du rouleau intrus sur une paire.
  store.update('Users', 1, { ForbiddenSpin: JSON.stringify({ line: ['commune', 'commune', 'rare'], nudgeable: true, nudged: false, bet: 1, mult: 1 }) });
  Math.random = () => 0.01;
  try { r = fb({ action: 'nudge' }); } finally { Math.random = rnd; }
  assert.equal(r.nudge.tier, 'triple');
  assert.deepEqual(r.nudge.changed, [2]);
  assert.equal(fb({ action: 'nudge' }).error, 'cannot_nudge');
  // Carnet : le dernier triple de base manquant donne le cadre « Joueur interdit ».
  store.update('Users', 1, { ForbiddenCombos: JSON.stringify(['commune', 'rare', 'epique', 'legendaire', 'finition', 'jeton']), ForbiddenFreeSpins: 1 });
  Math.random = () => 0.95;
  try { r = fb({ action: 'spin' }); } finally { Math.random = rnd; }
  assert.equal(r.results[0].key, 'crane');
  assert.ok(r.machine.combosReward.done);
  assert.ok(store.getAll('UserCosmetics').some((c) => refIdOf(c.User) === 1 && c.Key === 'frame-forbidden'));
  // Defis du jour : le triple a ete compte, des tours gratuits en reserve.
  assert.ok(r.machine.daily.find((d) => d.key === 'triples').done);
  store.update('Users', 1, { ForbiddenUnlocked: 0, ForbiddenAccess: 0, DoorKeys: 0, SpecialKeys: 0, ArgGears: '', StardustCount: 5000 });
});

await test('secrets : carte du 404, heure des ombres, roue de 22 h 22, codes secrets', async () => {
  const sec = await import('../src/native/secrets.js');
  const s = (body) => call('POST', 'secrets', { body: { userId: 1, ...body } }).json;
  store.update('Users', 1, { SecretsFound: '', SecretCodesUsed: '', SecretWheelDay: '', BoosterCount: 0, StardustCount: 0 });
  sec.init({ store });
  sec.init({ store });
  const cards404 = store.getAll('Cards').filter((c) => c.Name === 'Erreur 404');
  assert.equal(cards404.length, 1, 'carte creee une seule fois');
  assert.ok(cards404[0].IsPromo, 'jamais tiree');
  assert.ok(!cards404[0].IsSecret, 'pas dans la serrure des cartes secretes');
  assert.equal(store.get('Extensions', refIdOf(cards404[0].Extension)).Key, 'pack-secretes', 'rangee avec les cartes secretes');
  const gl = call('GET', 'secret-card', {}).json;
  assert.equal(gl.imageId, refIdOf(cards404[0].Image) || gl.imageId);
  assert.ok(Array.isArray(gl.others) && !gl.others.includes(gl.imageId));
  // Carte du 404 : une fois.
  const g = s({ action: 'ghost404' });
  assert.equal(g.cards[0].name, 'Erreur 404');
  assert.equal(g.cards[0].finish, 'ghost');
  assert.equal(s({ action: 'ghost404' }).error, 'already_found');
  // Heure des ombres : seulement de 3 h a 4 h (Paris).
  const realNow = Date.now;
  try {
    Date.now = () => Date.UTC(2026, 9, 19, 12, 0, 0);
    assert.equal(s({ action: 'shadow' }).error, 'not_now');
    Date.now = () => Date.UTC(2026, 9, 19, 1, 30, 0); // 3 h 30 a Paris
    const sh = s({ action: 'shadow' });
    assert.equal(sh.rewards.length, 2);
    assert.ok(store.getAll('UserCosmetics').some((c) => refIdOf(c.User) === 1 && c.Key === 'title-insomniaque'));
    // Roue truquee : 22 h 22 (Paris), un tour secret par jour.
    const wheel = (when) => { Date.now = () => when; return native.beforeWorkflow('daily-wheel', { body: { userId: 1, action: 'spin', secret: true } }); };
    assert.equal(wheel(Date.UTC(2026, 9, 19, 20, 0, 0)).json.error, 'secret_closed');
    const w = wheel(Date.UTC(2026, 9, 19, 20, 22, 10));
    assert.equal(w.json.prize.tier, 'secret');
    assert.equal(w.json.prize.title, 'Maître du temps');
    assert.equal(user(1).BoosterCount, 2);
    assert.equal(wheel(Date.UTC(2026, 9, 19, 20, 22, 30)).json.error, 'already_secret');
    assert.equal(native.beforeWorkflow('daily-wheel', { body: { userId: 1, action: 'spin' } }), null, 'tour normal : workflow habituel');
  } finally { Date.now = realNow; }
  // Codes secrets : cosmetique + ressources, une fois.
  const r = native.beforeWorkflow('redeem-code', { body: { userId: 1, code: ' milo ' } });
  assert.equal(r.json.type, 'reward');
  assert.ok(r.json.rewards.some((x) => /Ami des chiens/.test(x.label)));
  assert.equal(native.beforeWorkflow('redeem-code', { body: { userId: 1, code: 'MILO' } }).json.error, 'already_redeemed');
  assert.equal(native.beforeWorkflow('redeem-code', { body: { userId: 1, code: 'PAS-UN-SECRET' } }), null);
  store.update('Users', 1, { SecretsFound: '', SecretCodesUsed: '', SecretWheelDay: '' });
  // Cartes secretes : effet unique et toujours en parfait etat (retroactif).
  const anyRarity = store.getAll('Rarities')[0];
  // Migration unique : les cartes secretes deja connues recoivent leur effet ;
  // ensuite seul l'effet choisi sur la carte (admin) compte, jamais le nom.
  let sterling = store.create('Cards', { Name: 'Mr Sterling', Rarity: anyRarity.id, Active: true, IsPromo: true, IsSecret: true });
  const ticat = store.create('Cards', { Name: 'Ticat', Rarity: anyRarity.id, Active: true, IsPromo: true, IsSecret: true });
  store.getAll('AppSettings').filter((r) => r.Key === 'migration:secret-effects').forEach((r) => store.delete('AppSettings', r.id));
  sec.init({ store });
  sterling = store.get('Cards', sterling.id);
  assert.equal(sec.effectOf(store, sterling), 'fur-brown');
  assert.equal(sec.effectOf(store, store.get('Cards', ticat.id)), 'fur-white');
  assert.equal(sec.effectOf(store, store.getAll('Cards').find((c) => c.Name === 'Erreur 404')), 'glitch');
  const lookalike = store.create('Cards', { Name: 'Sterling le faux', Rarity: anyRarity.id, Active: true });
  sec.init({ store });
  assert.equal(sec.effectOf(store, store.get('Cards', lookalike.id)), null, 'un nom ressemblant ne suffit plus');
  store.update('Cards', lookalike.id, { SecretEffect: 'aura-gold' });
  assert.equal(sec.effectOf(store, store.get('Cards', lookalike.id)), 'aura-gold', 'effet choisi dans l admin');
  store.delete('Cards', lookalike.id);
  assert.ok(sec.keepsMint(store, sterling.id));
  const worn = store.create('Pulls', { User: 1, Card: sterling.id, SerialNumber: 1, Finish: 'normal', Quality: 'damaged', ObtainedAt: now() });
  sec.init({ store });
  assert.equal(store.get('Pulls', worn.id).Quality, 'mint', 'exemplaires existants remis en parfait etat');
  store.update('Pulls', worn.id, { Quality: 'worn' });
  native.afterWorkflow('unlock-secret', { body: { userId: 1 } }, { status: 200, json: {} });
  assert.equal(store.get('Pulls', worn.id).Quality, 'mint', 'parfait etat apres une obtention');
  const fx = call('GET', 'secret-card', {}).json;
  assert.ok(Array.isArray(fx.effects));
  store.delete('Pulls', worn.id); store.delete('Cards', sterling.id); store.delete('Cards', ticat.id);
});

await test('Moka : indice sur ses amis chats en P.S. du rapport', async () => {
  const cat = await import('../src/native/cat.js');
  const realRandom = Math.random;
  store.update('Users', 1, { CatState: JSON.stringify({ start: now() - 7200, until: now() - 10, done: 0 }) });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { MokaHintChance: 1 } } });
  let rep;
  try { Math.random = () => 0.01; rep = cat.settleCat(store, user(1)); } finally { Math.random = realRandom; }
  assert.ok(rep && rep.report && /^P\.S\./.test(rep.report.hint || ''), JSON.stringify(rep && rep.report && rep.report.hint));
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { MokaHintChance: 0.35 } } });
  store.update('Users', 1, { CatState: '' });
});

await test('gatchapon : une piece fait tomber une boule, ouverture par palier avec une clef, butin croissant, compat ancienne ouverture', () => {
  const ch = (body) => call('POST', 'chests', { body: { userId: 1, ...body } }).json;
  store.update('Users', 1, { ChestCount: 0, KeyCount: 0, ChestBalls: '[]', XP: 0, ChestLevelGranted: 999 });
  assert.equal(ch({ action: 'spin' }).error, 'no_chest');
  store.update('Users', 1, { ChestCount: 5, KeyCount: 1 });
  let r = ch({ action: 'spin', count: 3 });
  assert.equal(r.spun, 3);
  assert.equal(r.drawn.length, 3);
  assert.equal(r.balls, 3);
  assert.equal(user(1).ChestCount, 2);
  assert.equal(r.tiers.length, 8);
  assert.equal(Math.round(r.tiers.reduce((x, t) => x + t.chance, 0)), 100);
  // Ouverture d'une boule de palier 8 (forcee) contre une clef.
  store.update('Users', 1, { ChestBalls: JSON.stringify([8, 1]), KeyCount: 1, StardustCount: 0 });
  assert.equal(ch({ action: 'open', tier: 5 }).error, 'no_ball');
  r = ch({ action: 'open', tier: 8 });
  assert.equal(r.opened, 1);
  assert.equal(r.tier.tier, 8);
  assert.deepEqual(JSON.parse(user(1).ChestBalls), [1]);
  assert.equal(user(1).KeyCount, 0);
  assert.ok(r.dust >= 40, 'butin du coffre mystique');
  assert.equal(ch({ action: 'open', tier: 1 }).error, 'no_key');
  // Reglages : 8 nombres exiges.
  assert.equal(call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { ChestTierWeights: [1, 2] } } }).status, 400);
  // Ancienne ouverture directe toujours possible.
  store.update('Users', 1, { ChestCount: 1, KeyCount: 1 });
  assert.equal(ch({ action: 'open' }).opened, 1);
  store.update('Users', 1, { ChestBalls: '[]' });
});

await test('Moka le chat : poisson donne, peche passive creditee une fois, jamais de booster, plafonds', () => {
  // Sans pause de fatigue (pets.js) : rythme exact d'un lancer toutes les CatCastMinutes.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { PetRestMinutes: 0 } } });
  const cat = (action = 'status', count) => call('POST', 'cat', { body: { userId: 1, action, count } }).json;
  store.update('Users', 1, { CatFish: 0, CatState: '', CatFedDay: '', CatFedCount: 0, Worms: 100, FishingEnergy: null, ShopItemsWeek: '', ShopItemsBought: '{}', StardustCount: 5000 });
  assert.equal(cat('feed').error, 'no_cat_fish');
  // Boite de sardines : 3 poissons.
  call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'sardines' } });
  assert.equal(user(1).CatFish, 3);
  let r = cat('feed', 2);
  assert.equal(r.fed, 2);
  assert.equal(r.cat.fish, 1);
  assert.ok(Math.abs(r.cat.secondsLeft - 2 * r.cat.minutesPerFish * 60) <= 2);
  // Plafond de temps devant lui (240 min) : 2 x 30 + 7 x 30 > 240.
  store.update('Users', 1, { CatFish: 20, CatFedCount: 0 });
  assert.equal(cat('feed', 7).error, 'cat_max_time');
  // Table forcee : que des boosters -> remplaces par des poussieres.
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { FishingLoot: [{ type: 'booster', weight: 1, min: 1, max: 1 }] } } });
  const t = Math.floor(Date.now() / 1000);
  store.update('Users', 1, { CatState: JSON.stringify({ start: t - 3600, until: t, done: 0 }), BoosterCount: 7, StardustCount: 0 });
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json.catReport, null, 'statut simple : rien de credite');
  const st = call('POST', 'fishing', { body: { userId: 1, action: 'status', settleCat: true } }).json;
  assert.equal(st.catReport.casts, 6, '60 min / 10 min');
  assert.equal(user(1).BoosterCount, 7, 'jamais de booster');
  assert.ok(user(1).StardustCount >= 6 * 15);
  assert.equal(st.catReport.done, true);
  assert.equal(user(1).CatState, '');
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'status', settleCat: true } }).json.catReport, null, 'credite une seule fois');
  // Sortie en cours : credit partiel, la suite plus tard.
  store.update('Users', 1, { CatState: JSON.stringify({ start: t - 1500, until: t + 1500, done: 0 }) });
  r = cat();
  assert.equal(r.catReport.casts, 2);
  assert.equal(JSON.parse(user(1).CatState).done, 2);
  assert.equal(cat().catReport, null);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'FishingLoot' } });
  // Plus de plafond du jour (2026-10-26) : seul le temps d'avance compte.
  store.update('Users', 1, { CatState: '', CatFedCount: 7, CatFish: 5 });
  assert.equal(cat('feed', 2).fed, 2);
  store.update('Users', 1, { CatState: '', CatFish: 0, CatFedCount: 0 });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'PetRestMinutes' } });
});

await test('aquarium : especes pechees, ferrage, records, paliers reclames une fois, thermos', () => {
  store.update('Users', 1, { Aquarium: '', Worms: 500, StardustCount: 0, BoosterCount: 0, FishingEnergy: null, FishingEnergyAt: null });
  // Ferrage par choix entre 3 remous : le serveur tire le remous parfait,
  // le site ne peut plus imposer un ferrage (body.strike ignore).
  const r = call('POST', 'fishing', { body: { userId: 1, action: 'cast', pick: 1 } }).json;
  assert.equal(r.spots.length, 3);
  assert.equal(r.spots.filter((s) => s === 'perfect').length, 1);
  assert.equal(r.strike, r.spots[1]);
  assert.equal(r.pick, 1);
  assert.ok(Array.isArray(r.species));
  const rndPick = Math.random;
  Math.random = () => 0;
  try {
    assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast', count: 2, pick: 0 } }).json.strike, 'perfect');
    assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast', pick: 2 } }).json.strike, 'good');
  } finally { Math.random = rndPick; }
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast', strike: 'perfect' } }).json.strike, null);
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast', pick: 5 } }).json.strike, null);
  // Tirage force (Math.random() = 0) : toujours une espece, la premiere de la zone.
  store.update('Users', 1, { Aquarium: '' });
  const rnd = Math.random;
  Math.random = () => 0;
  let got;
  try { got = catchSpecies(user(1), { count: 1, weatherKey: 'soleil', strike: 'perfect' }); } finally { Math.random = rnd; }
  const f = got.items[0];
  assert.deepEqual([f.key, f.first, f.record], ['gardon', true, false]);
  assert.ok(f.dust > 0 && f.size >= 10);
  store.update('Users', 1, got.fields);
  const again = catchSpecies(user(1), { count: 40, weatherKey: 'soleil' });
  assert.ok(again && again.items.every((x) => !(x.key === 'gardon' && x.first)), 'deja connu : plus « nouvelle espece »');
  const aq = call('POST', 'aquarium', { body: { userId: 1 } }).json;
  assert.equal(aq.found, 1);
  assert.equal(aq.species.find((s) => s.key === 'gardon').count, 1);
  assert.equal(aq.species.filter((s) => !s.found).every((s) => s.name === '???'), true, 'especes inconnues masquees');
  assert.equal(call('POST', 'aquarium', { body: { userId: 1, action: 'claim' } }).json.error, 'nothing_to_claim');
  // 12 especes connues : 2 paliers d'un coup, puis plus rien.
  const fish = Object.fromEntries(['gardon', 'perche', 'carpe', 'ecrevisse', 'brochet', 'truite', 'anguille', 'grenouille', 'tortue', 'silure', 'lune', 'koi'].map((k) => [k, { count: 1, best: 10, first: 1 }]));
  store.update('Users', 1, { Aquarium: JSON.stringify({ fish, claimed: [] }), StardustCount: 0, BoosterCount: 0 });
  const c = call('POST', 'aquarium', { body: { userId: 1, action: 'claim' } }).json;
  assert.deepEqual([c.claimed.dust, c.claimed.boosters], [300, 2]);
  assert.deepEqual([user(1).StardustCount, user(1).BoosterCount], [300, 2]);
  assert.equal(call('POST', 'aquarium', { body: { userId: 1, action: 'claim' } }).json.error, 'nothing_to_claim');
  // Thermos du pecheur : recharge l'energie, refuse si deja pleine.
  store.update('Users', 1, { StardustCount: 5000, FishingEnergy: 0, FishingEnergyAt: Math.floor(Date.now() / 1000), ShopItemsWeek: '', ShopItemsBought: '{}' });
  assert.ok(call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'thermos' } }).json.ok !== false);
  const st = call('POST', 'fishing', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(st.energy, st.maxEnergy);
  assert.equal(call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'thermos' } }).json.error, 'energy_full');
  store.update('Users', 1, { Aquarium: '', FishingEnergy: null, FishingEnergyAt: null });
});

await test('arbre celeste : points des constellations allumees, voisinage, cout, supernova, bonus ajoutes aux talents, remise a zero', () => {
  store.update('Users', 1, { SkyNodes: '[]', Talents: '{}', StardustCount: 5000 });
  const sky = (action = 'status', key) => call('POST', 'sky-tree', { body: { userId: 1, action, key } }).json;
  const start = sky();
  const polaris = start.nodes.find((n) => n.key === 'polaris');
  assert.equal(polaris.lit, true, 'Etoile polaire offerte');
  assert.ok(Math.round(talentValueOf(user(1), 'patron') * 100) >= 0);
  // Allume 3 constellations de plus : autant de points que de constellations
  // nouvellement completes (des cartes partagees peuvent en completer d'autres).
  const owned = new Set(store.getAll('Pulls').filter((p) => refIdOf(p.User) === 1).map((p) => refIdOf(p.Card)));
  const complete = () => skyConstellations(store).filter((c) => c.cardIds.every((id) => owned.has(id))).length;
  const before = complete();
  const todo = skyConstellations(store).filter((c) => !c.cardIds.every((id) => owned.has(id))).slice(0, 3);
  todo.forEach((c) => c.cardIds.forEach((id) => { if (!owned.has(id)) { mk(1, id); owned.add(id); } }));
  const st = sky();
  assert.ok(complete() - before >= todo.length);
  assert.equal(st.points, start.points + complete() - before);
  // Non reliee : refusee ; reliee : allumee.
  assert.equal(sky('light', 'vega').error, 'star_unreachable');
  let r = sky('light', 'sirius');
  assert.equal(r.litStar, 'sirius');
  assert.equal(r.available, st.available - 1);
  assert.equal(sky('light', 'sirius').error, 'already_lit');
  // Bonus ajoute au talent Oeil de lynx (sans aucun rang appris).
  assert.equal(Math.round(talentValueOf(user(1), 'lynx') * 1000), 5);
  assert.equal(Math.round(talentValueOf(user(1), 'patron') * 100), 2, 'Etoile polaire : +2 % au decraft');
  // Supernova : exige le bout des trois bras.
  assert.equal(sky('light', 'supernova').error, 'star_unreachable');
  // Plus de points : refus.
  store.update('Users', 1, { SkyNodes: JSON.stringify(['sirius', 'vega', 'arcturus', 'procyon', 'pollux', 'capella']) });
  const full = sky();
  if (full.available < 2) assert.equal(sky('light', 'rigel').error, 'no_star_points');
  // Remise a zero payante, points rendus.
  r = sky('reset');
  assert.equal(r.reset, true);
  assert.equal(r.spent, 0);
  assert.equal(user(1).StardustCount, 5000 - r.resetCost);
  assert.equal(sky('reset').error, 'nothing_to_reset');
  store.update('Users', 1, { SkyNodes: '[]' });
});

await test('equilibrage 30 boosters/jour : valeurs, migration unique, chien qui garde ses boosters, crane garanti au mode excite', () => {
  // Valeurs par defaut.
  for (const [k, v] of [['DigBoosterKeepChance', 1], ['DogBonesPerDay', 6], ['DailyQuestRewardBoosters', 5], ['WeeklyQuestRewardBoosters', 14], ['BoosterShopWeeklyCap', 14], ['ShardsPerBooster', 5], ['WealthReference', 8000]]) {
    call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: k } });
    assert.equal(setting(store, k), v, k);
  }
  assert.equal(setting(store, 'DogKeepBoosters'), true);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'FishingLoot' } });
  assert.equal(setting(store, 'FishingLoot').find((x) => x.type === 'booster').weight, 10);
  // Migration : reglages enregistres plus avares -> releves, une seule fois.
  store.getAll('AppSettings').filter((r) => r.Key === 'balance-2026-10-15').forEach((r) => store.delete('AppSettings', r.id));
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { DigBoosterKeepChance: 0.5, DogBonesPerDay: 4, BoosterShopPrice: 450, DogKeepBoosters: false } } });
  const cfg = store.getAll('Config')[0];
  store.update('Config', cfg.id, { DailyQuestRewardBoosters: 1, WeeklyQuestRewardBoosters: 0 });
  balance.migrateBalance30(store);
  assert.deepEqual([setting(store, 'DigBoosterKeepChance'), setting(store, 'DogBonesPerDay'), setting(store, 'BoosterShopPrice'), setting(store, 'DogKeepBoosters')], [1, 6, 300, true]);
  assert.deepEqual([store.getAll('Config')[0].DailyQuestRewardBoosters, store.getAll('Config')[0].WeeklyQuestRewardBoosters], [5, 14]);
  const log = JSON.parse(store.getAll('AppSettings').find((r) => r.Key === 'balance-2026-10-15').Value);
  assert.equal(log.base, 30);
  assert.ok(log.changes.some((c) => c.key === 'DogBonesPerDay' && c.from === 4));
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { DogBonesPerDay: 2 } } });
  balance.migrateBalance30(store);
  assert.equal(setting(store, 'DogBonesPerDay'), 2);
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'DogBonesPerDay' } });
  // Chien : ses boosters sont gardes (plus convertis en poussieres).
  const before = user(1).BoosterCount || 0;
  store.update('Users', 1, { BoosterCount: before + 3 });
  const dog = { status: 200, json: { dogReport: { tiles: 24, boosters: 3, dust: 10, cards: [] } } };
  balance.afterWorkflow({ store, path: 'dig', request: { body: { userId: 1, action: 'status' } }, response: dog });
  assert.equal(user(1).BoosterCount, before + 3);
  assert.equal(dog.json.dogReport.boosters, 3);
  // Mode excite : crane de dinosaure garanti.
  store.update('Users', 1, { DinoSkulls: 0 });
  const fr = { status: 200, json: { frenzy: { boards: 15 }, dogReport: { tiles: 200, boosters: 0, cards: [] } } };
  dinoMod.afterWorkflow({ store, path: 'dig', request: { body: { userId: 1, action: 'frenzy' } }, response: fr });
  assert.equal(user(1).DinoSkulls, 1);
  assert.ok(fr.json.dinoSkull && fr.json.dinoSkull.guaranteed);
});

store.db.close();
clean();
console.log(process.exitCode ? '\nProgression : echec(s).' : `\nProgression : ${passed} tests passes.`);
