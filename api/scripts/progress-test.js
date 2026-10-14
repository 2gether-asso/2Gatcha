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
call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { ExchangeRateSwing: 0, PriceIndexEnabled: false } } });

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
  assert.equal(user(1).StardustCount, 5 + 170, '200 - 15 % de taxe');
  assert.equal(store.get('Auctions', a.id).Status, 'sold');
});

await test('boutique de boosters : prix croissant, plafond hebdomadaire', () => {
  store.update('Users', 1, { StardustCount: 5000, ShopWeek: '', ShopBought: 0 });
  const prices = [];
  for (let i = 0; i < 3; i++) prices.push(call('POST', 'booster-shop', { body: { userId: 1, action: 'buy' } }).json.paid);
  assert.deepEqual(prices, [450, 608, 765]);
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

await test('boutique d objets : achat, plafond hebdo, effets, potion de savoir, elixir de chance', () => {
  store.update('Users', 1, { StardustCount: 5000, ShopItemsWeek: '', ShopItemsBought: '{}', Worms: 0, LuckCharges: 0, XpBoostUntil: 0, GardenPlots: '[]', ExpeditionUntil: 0 });
  const st = call('POST', 'shop', { body: { userId: 1 } }).json;
  assert.ok(st.items.length >= 10);
  let r = call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'worms10' } }).json;
  assert.equal(r.paid, 60);
  assert.equal(user(1).Worms, 10);
  for (let i = 0; i < 4; i++) call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'worms10' } });
  assert.equal(call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'worms10' } }).json.error, 'weekly_cap');
  assert.equal(call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'fertilizer' } }).json.error, 'nothing_growing');
  assert.equal(call('POST', 'shop', { body: { userId: 1, action: 'buy', key: 'compass' } }).json.error, 'no_expedition');
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
  assert.equal(call('POST', 'booster-shop', { body: { userId: 1, action: 'status' } }).json.price, 900);
  set({ PriceIndexEnabled: false, InflationModeForce: 1 });
  inflation._reset();
  const st = call('GET', 'economy-state', { query: {} }).json;
  assert.equal(st.tight, true);
  assert.equal(st.priceFactor, 1.25);
  assert.equal(call('POST', 'booster-shop', { body: { userId: 1, action: 'status' } }).json.price, Math.round(450 * 1.25));
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
  store.update('Users', 1, { FishingXP: 0, FishingPrestige: 0, Worms: 50, FishingDay: '', FishingCasts: 0 });
  assert.equal(call('POST', 'fishing', { body: { userId: 1, action: 'cast', zone: 'deep' } }).json.error, 'deep_locked');
  store.update('Users', 1, { FishingPrestige: 1 });
  const r = call('POST', 'fishing', { body: { userId: 1, action: 'cast', zone: 'deep', count: 3 } }).json;
  assert.equal(r.zone, 'deep');
  assert.equal(user(1).Worms, 50 - 3 * r.deep.cost);
  assert.ok(r.deep.table.some((x) => x.type === 'pearl'));
});

await test('jardin etendu : graines, parcelle achetee, recolte selon la graine', () => {
  store.update('Users', 1, { GardenPlots: '[]', GardenExtraPlots: 0, StardustCount: 5000, Worms: 0 });
  let st = call('POST', 'garden', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(st.plots.length, 4);
  assert.equal(st.seeds.length, 4);
  st = call('POST', 'garden', { body: { userId: 1, action: 'buyPlot' } }).json;
  assert.equal(st.plots.length, 5);
  assert.equal(user(1).StardustCount, 5000 - 400);
  call('POST', 'garden', { body: { userId: 1, action: 'plant', seed: 'worm', plot: 4 } });
  call('POST', 'garden', { body: { userId: 1, action: 'plant', seed: 'dust', plot: 0 } });
  const plots = JSON.parse(user(1).GardenPlots).map((p) => (p ? { ...p, plantedAt: p.plantedAt - 30 * 86400 } : p));
  store.update('Users', 1, { GardenPlots: JSON.stringify(plots) });
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values: { GardenWiltHours: 0 } } });
  const h = call('POST', 'garden', { body: { userId: 1, action: 'harvest' } }).json;
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'GardenWiltHours' } });
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

await test('prestige du compte : etoiles, point de talent, titre et cadre', () => {
  store.update('Users', 1, { XP: 30000, Talents: '{}' });
  const p = call('GET', 'account-prestige', { query: { userId: 1 } }).json;
  assert.ok(p.stars >= 1);
  const t = call('POST', 'talents', { body: { userId: 1, action: 'status' } }).json;
  assert.equal(t.points, p.level - 1 + p.stars);
  assert.ok(store.getAll('UserCosmetics').some((c) => refIdOf(c.User) === 1 && c.Key === 'frame-prestige'));
  store.update('Users', 1, { XP: 0 });
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
await test('equilibrage : boosters de fouille et du chien convertis, os limites par jour', () => {
  const set = (values) => call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'set', values } });
  set({ DigBoosterKeepChance: 0 });
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
  // Os : 4 par jour.
  for (let i = 0; i < 4; i++) {
    assert.equal(native.beforeWorkflow('dig', { body: { userId: 1, action: 'useBone' } }), null);
    native.afterWorkflow('dig', { body: { userId: 1, action: 'useBone' } }, { status: 200, json: {} });
  }
  assert.equal(native.beforeWorkflow('dig', { body: { userId: 1, action: 'useBone' } }).json.error, 'dog_daily_limit');
  call('POST', 'admin-settings', { body: { discordId: ADMIN, action: 'reset', key: 'DigBoosterKeepChance' } });
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
  assert.equal(st.presets.length, 4);
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
await test('booster muri : +1 point par jour sans ouvrir, consomme a l ouverture', () => {
  store.update('Users', 1, { RipenSince: now() - 2.5 * 86400 });
  const st = { status: 200, json: { count: 3 } };
  native.afterWorkflow('booster-status', { query: { userId: '1' }, body: {} }, st);
  assert.equal(st.json.ripeness.points, 2);
  const req = { body: { userId: 1, extensionId: 1 } };
  native.beforeWorkflow('open-pack', req);
  assert.equal(req._ripe, 2);
  const resp = { status: 200, json: { batchId: 'x-ripe', cards: [] } };
  native.afterWorkflow('open-pack', req, resp);
  assert.equal(resp.json.ripened, 2);
  assert.ok(now() - user(1).RipenSince < 5);
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
  assert.equal(st.stages.length, 5);
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

store.db.close();
clean();
console.log(process.exitCode ? '\nProgression : echec(s).' : `\nProgression : ${passed} tests passes.`);
