// Tests du lot du 25 octobre 2026 : bonus d'evenement sur le gain net,
// loterie (annonce du gain), quetes realisables, coffre-fort (extension +
// carte emeraude), boutique illimitee a inflation personnelle, nebuleuses de
// l'arbre celeste, tendresse de Milo et Moka, archeologie, casino.
// Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { now, parisDay } from '../src/native/common.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-b1025-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const call = (method, p, args) => { native.beforeRequest(args.body || {}, args.query || {}, p); const r = native.run(method, p, args); native.endRequest(); return r; };
const post = (p, body) => call('POST', p, { body });
const ADMIN = '785223211730075709';
const user = (id) => store.get('Users', id);
const refIdOf = (v) => (Array.isArray(v) ? v[1] : v);
post('admin-settings', { discordId: ADMIN, action: 'set', values: { StarterEnabled: false, SurpriseEnabled: false, PriceIndexEnabled: false } });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('evenement : bonus sur le gain net, pas sur un achat ni sur un tirage pose avant', () => {
  post('admin-event', { discordId: ADMIN, action: 'set', active: true, label: 'Test', dustMultiplier: 3, wormsMultiplier: 2 });
  const u0 = user(1).StardustCount;
  native.beforeRequest({ userId: 1 }, {}, 'fishing');
  store.update('Users', 1, { StardustCount: u0 + 10, Worms: (user(1).Worms || 0) + 4 });
  const resp = { status: 200, json: { newStardust: u0 + 10 } };
  native.afterWorkflow('fishing', { body: { userId: 1 } }, resp);
  native.endRequest();
  assert.equal(resp.json.eventBonus.dust, 20);
  assert.equal(resp.json.eventBonus.worms, 4);
  assert.equal(user(1).StardustCount, u0 + 30);
  post('admin-event', { discordId: ADMIN, action: 'set', active: false });
});

await test('loterie : le gain reste affiche jusqu au ack et arrive en annonce une seule fois', () => {
  store.update('Users', 1, { LotteryWon: JSON.stringify({ week: '2026-10-19', pot: 1234, tickets: 2, totalTickets: 5 }) });
  let st = post('lottery', { userId: 1 }).json;
  assert.equal(st.won.pot, 1234);
  assert.ok((st.notices || []).some((n) => n.kind === 'lottery'), 'annonce');
  st = post('lottery', { userId: 1 }).json;
  assert.equal(st.won.pot, 1234, 'toujours la apres un 2e status');
  assert.ok(!(st.notices || []).some((n) => n.kind === 'lottery'), 'annonce une seule fois');
  st = post('lottery', { userId: 1, action: 'ack' }).json;
  assert.equal(st.won, null);
});

await test('quetes : pas d objectif de boss sans boss en vie', () => {
  for (const b of store.getAll('CommunityBoss')) store.update('CommunityBoss', b.id, { Active: false });
  store.getAll('WeeklyChallenges').forEach((r) => store.delete('WeeklyChallenges', r.id));
  for (const r of store.getAll('AppSettings').filter((x) => x.Key === 'seasonQuestsWeek' || x.Key === 'eveningMissionsDay')) store.delete('AppSettings', r.id);
  for (let id = 1; id <= 2; id++) {
    const ch = post('challenges', { userId: id }).json;
    assert.ok(!ch.offered.some((c) => c.key === 'boss5'));
  }
  const sq = post('season-quests', { userId: 1 }).json;
  if (sq.quests) assert.ok(!sq.quests.some((q) => q.type === 'bossAttack'));
});

await test('coffre-fort : lignes par extension, carte emeraude verrouillee a la ligne complete', () => {
  const vaultCard = store.getAll('Cards').find((c) => c.IsVault) || store.create('Cards', { Name: 'Coffre', IsVault: true, Active: false });
  if (!store.getAll('Pulls').some((p) => refIdOf(p.User) === 1 && refIdOf(p.Card) === vaultCard.id)) store.create('Pulls', { User: 1, Card: vaultCard.id, SerialNumber: 1, BatchId: 'vault-1' });
  const card = store.getAll('Cards').find((c) => c.Active && !c.IsPromo && !c.IsVault && refIdOf(c.Extension));
  const ids = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'].map((f, i) => store.create('Pulls', { User: 1, Card: card.id, SerialNumber: 7000 + i, Finish: f, Quality: 'mint' }).id);
  let st = post('personal-vault', { userId: 1 }).json;
  const row = st.rows.find((r) => r.cardId === card.id);
  assert.ok(row.extension && row.extension.id, 'extension');
  let last;
  for (const id of ids) last = post('personal-vault', { userId: 1, action: 'store', pullId: id }).json;
  assert.ok(last.reward && last.reward.emerald, 'emeraude donnee');
  const em = store.get('Pulls', last.reward.emerald.pullId);
  assert.equal(em.Finish, 'emerald');
  assert.equal(em.InVault, true);
  assert.equal(post('personal-vault', { userId: 1, action: 'withdraw', pullId: em.id }).json.error, 'emerald_locked');
  st = post('personal-vault', { userId: 1 }).json;
  assert.ok(st.rows.find((r) => r.cardId === card.id).emerald);
  // Rattrapage : une ligne deja recompensee sans emeraude en recoit une.
  store.delete('Pulls', em.id);
  st = post('personal-vault', { userId: 1 }).json;
  assert.equal(st.emeraldGrants.length, 1);
});

await test('boutique : plus de plafond, prix qui monte a chaque achat du jour', () => {
  store.update('Users', 1, { StardustCount: 100000, EnergyBuys: '', ShopItemsBought: '{}' });
  const st0 = post('shop', { userId: 1 }).json;
  const it = st0.items.find((x) => x.key === 'worms10');
  const p1 = post('shop', { userId: 1, action: 'buy', key: 'worms10' }).json;
  const after = p1.items.find((x) => x.key === 'worms10');
  assert.ok(after.price > it.price, 'prix en hausse');
  for (let i = 0; i < 8; i++) assert.ok(!post('shop', { userId: 1, action: 'buy', key: 'worms10' }).json.error, 'achat ' + i);
  const b0 = post('booster-shop', { userId: 1 }).json;
  assert.equal(b0.unlimited, true);
  for (let i = 0; i < 20; i++) assert.ok(post('booster-shop', { userId: 1, action: 'buy' }).json.bought, 'jeton ' + i);
  assert.ok(post('booster-shop', { userId: 1 }).json.price > b0.price * 10);
});

await test('arbre celeste : nebuleuses a rangs illimites, points des cartes emeraude', () => {
  store.update('Users', 1, { SkyNodes: JSON.stringify(['sirius', 'vega', 'rigel']), SkyNebulae: '{}' });
  let st = post('sky-tree', { userId: 1 }).json;
  assert.ok(st.fromEmeralds >= 1);
  const neb = st.nebulae.find((n) => n.key === 'nebDust');
  assert.equal(neb.open, true);
  if (st.available >= 1) {
    st = post('sky-tree', { userId: 1, action: 'nebula', key: 'nebDust' }).json;
    assert.equal(st.nebulae.find((n) => n.key === 'nebDust').rank, 1);
    assert.ok(st.totals.patron > 0);
  }
  assert.equal(post('sky-tree', { userId: 1, action: 'nebula', key: 'nebGold' }).json.error, 'star_unreachable');
});

await test('tendresse : caresse, delai, friandise payante, vitesse de Milo avant la fouille', () => {
  store.update('Users', 1, { PetLove: '', StardustCount: 5000 });
  let st = post('pets', { userId: 1, action: 'play', pet: 'milo' }).json;
  assert.equal(st.pets.find((p) => p.pet === 'milo').love, 20);
  assert.equal(post('pets', { userId: 1, action: 'play', pet: 'milo' }).json.error, 'pet_cooldown');
  st = post('pets', { userId: 1, action: 'treat', pet: 'milo' }).json;
  assert.equal(st.pets.find((p) => p.pet === 'milo').love, 35);
  assert.equal(user(1).StardustCount, 5000 - 60);
  // La fouille lit Users.MiloSpeed : ecrit juste avant le workflow.
  native.beforeWorkflow('dig', { body: { userId: 1, action: 'status' } });
  assert.ok(user(1).MiloSpeed > 0);
});

await test('archeologie : grattage libre, extraction en blocs bruts, nettoyage et liberation, casse si brusque', () => {
  store.update('Users', 1, { ArcheoStarter: false, Tablets: 0, ArcheoState: '', ArcheoFinds: '[]' });
  let st = post('archeo', { userId: 1 }).json;
  assert.equal(st.tablets, 2);
  st = post('archeo', { userId: 1, action: 'start' }).json;
  assert.equal(st.tablets, 1);
  assert.equal(st.tablet.depth.length, 24 * 16);
  const before = st.tablet.depth.reduce((a, b) => a + b, 0);
  st = post('archeo', { userId: 1, action: 'scrape', pts: [{ x: 0.5, y: 0.5, t: 'brush', s: 0.5 }, { x: 0.52, y: 0.5, t: 'pick', s: 0.5 }] }).json;
  assert.equal(st.tablet.energy, st.tablet.max - 4);
  assert.ok(st.tablet.depth.reduce((a, b) => a + b, 0) < before);
  // Tout gratter doucement au pinceau, rangee par rangee.
  let guard = 0;
  while (!st.finished && guard++ < 60) {
    const pts = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x += 2) pts.push({ x: (x + 0.5) / 24, y: (y + 0.5) / 16, t: 'brush', s: 0.4 });
    st = post('archeo', { userId: 1, action: 'scrape', pts: pts.slice(0, 200) }).json;
    if (!st.finished) st = post('archeo', { userId: 1, action: 'scrape', pts: pts.slice(200) }).json;
  }
  assert.ok(st.finished, 'tablette terminee');
  assert.equal(user(1).ArcheoDone, 1);
  // Nettoyage : un bloc fabrique a coup sur, gratte doucement : libere intact.
  const finds = JSON.parse(user(1).ArcheoFinds || '[]');
  if (!finds.length) return;
  const f = finds[0];
  let w = post('archeo', { userId: 1, action: 'cleanStatus', findId: f.id }).json.work;
  assert.equal(w.depth.length, 256);
  let r;
  for (let k = 0; k < 40; k++) {
    const pts = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) pts.push({ x: (x + 0.5) / 16, y: (y + 0.5) / 16, t: 'brush', s: 0.3 });
    r = post('archeo', { userId: 1, action: 'clean', findId: f.id, pts: pts.slice(0, 240) }).json;
    if (r.freed) break;
    r = post('archeo', { userId: 1, action: 'clean', findId: f.id, pts: pts.slice(240) }).json;
    if (r.freed) break;
  }
  assert.ok(r.freed, 'trouvaille liberee');
  assert.equal(user(1).ArcheoFreed, 1);
  // Pioche en force sur une trouvaille deja a nu : elle s'abime.
  const blk = { v: 2, id: 'test', kind: 'mineral', key: 'fer', tier: 1, size: 1, damage: 0, g: 16, depth: Array(256).fill(0), mask: [119, 120, 135, 136, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
  for (let c = 0; c < 10; c++) blk.depth[c] = 1; // coeur pas encore a nu : pas de liberation
  store.update('Users', 1, { ArcheoFinds: JSON.stringify([blk]) });
  r = post('archeo', { userId: 1, action: 'clean', findId: 'test', pts: [{ x: 0.47, y: 0.47, t: 'pick', s: 3 }] }).json;
  assert.ok(r.hurt > 0);
  assert.ok(r.work.damage > 0);
});

await test('archeologie : sortes de tablettes (stock, roche dure, fragile) et niveau d archeologue', () => {
  // Ancien compteur seul : tout passe en argile ; le total reste dans Tablets.
  store.update('Users', 1, { ArcheoState: '', ArcheoFinds: '[]', Tablets: 3, TabletStock: '', ArcheoXP: 0 });
  let st = post('archeo', { userId: 1 }).json;
  assert.deepEqual(st.stock.map((k) => k.count), [3, 0, 0]);
  assert.equal(st.level.level, 1);
  assert.ok(!st.tools.fine && !st.tools.air, 'outils de niveau caches');
  // Une pierre gravee : roche dure, plus de trouvailles, endurance x1,25.
  store.update('Users', 1, { TabletStock: JSON.stringify({ clay: 3, stone: 1, gold: 0 }), Tablets: 4 });
  assert.equal(post('archeo', { userId: 1, action: 'start', kind: 'gold' }).status, 400);
  st = post('archeo', { userId: 1, action: 'start', kind: 'stone' }).json;
  assert.equal(st.tablet.kind, 'stone');
  assert.equal(st.tablets, 3);
  assert.ok(st.tablet.total >= 4);
  assert.ok(st.tablet.hard.some(Boolean), 'veines de roche dure');
  assert.ok(st.tablet.max > 700);
  // Le pinceau entame a peine la roche dure.
  const c = st.tablet.hard.indexOf(1), x = (c % 24 + 0.5) / 24, y = (Math.floor(c / 24) + 0.5) / 16;
  const d0 = st.tablet.depth[c];
  st = post('archeo', { userId: 1, action: 'scrape', pts: [{ x, y, t: 'brush', s: 0.4 }] }).json;
  assert.ok(d0 - st.tablet.depth[c] <= 0.3 * 0.2 + 0.01);
  // Outil de niveau refuse (rabattu sur le pinceau) tant que le niveau manque.
  const e0 = st.tablet.energy;
  st = post('archeo', { userId: 1, action: 'scrape', pts: [{ x: 0.1, y: 0.1, t: 'air', s: 0.4 }] }).json;
  assert.equal(st.tablet.energy, e0 - 1);
  // Fin : XP d'archeologue x1,5.
  const fin = post('archeo', { userId: 1, action: 'finish' }).json.finished;
  assert.equal(fin.kind, 'stone');
  assert.equal(fin.xp, Math.round(fin.extracted.length * 3 * 1.5));
  // Niveau 8 : pinceau fin + soufflet, oeil exerce, endurance +20 %.
  store.update('Users', 1, { ArcheoXP: 520, ArcheoState: '' });
  st = post('archeo', { userId: 1 }).json;
  assert.equal(st.level.level, 8);
  assert.ok(st.tools.fine && st.tools.air);
  assert.equal(st.tools.pick.hard, 1.7);
  assert.equal(st.damageMult, 0.7);
  // Piece fragile deja a nu : casse des 0,8 de pression (grattoir rapide).
  const blk = { v: 2, id: 'frag', kind: 'mineral', key: 'fer', tier: 1, size: 1, damage: 0, g: 16, depth: Array(256).fill(0), mask: [119, 120, 135, 136, 0, 1, 2], fragile: true };
  for (let k = 0; k < 3; k++) blk.depth[k] = 1;
  store.update('Users', 1, { ArcheoFinds: JSON.stringify([blk]) });
  const r = post('archeo', { userId: 1, action: 'clean', findId: 'frag', pts: [{ x: 0.47, y: 0.47, t: 'scraper', s: 1.1 }] }).json;
  assert.ok(r.hurt > 0, 'fragile abimee a 1,1 de pression');
  assert.equal(r.work.fragile, true);
  store.update('Users', 1, { TabletStock: JSON.stringify({ clay: 0, stone: 0, gold: 0 }), Tablets: 0 });
});

await test('dinos : le Stegosaure protege le jardin tant qu il n est pas en danger, sans fanaison retroactive', () => {
  const t = now(), H = 3600;
  const dino = (food, happy, at = t) => ({ id: 1, name: 'Steg', species: 'stego', hue: 0, pattern: 'plain', bornAt: t - 100 * H, at, food, happy, xp: 9999, digest: 0, poops: [], goldPoops: [] });
  const plot = { plantedAt: t - 60 * H, seed: 'mix' }; // prete depuis longtemps
  // Un peu faim (pas content) mais pas en danger : le pouvoir marche, rien ne fane.
  store.update('Users', 1, { Dinos: JSON.stringify([dino(20, 60)]), GardenPlots: JSON.stringify([plot]) });
  let g = post('garden', { userId: 1 }).json;
  assert.equal(g.plots[0].wilted, false, 'protegee');
  assert.equal(g.wiltHours, 0);
  const dv = post('dino', { userId: 1 }).json.dinos[0];
  assert.equal(dv.talentState.on, true);
  // En danger depuis peu : la fanaison ne compte qu'a partir de la fin de la protection.
  store.update('Users', 1, { Dinos: JSON.stringify([dino(30, 30, t - 6 * H)]), GardenPlots: JSON.stringify([plot]) });
  g = post('garden', { userId: 1 }).json;
  assert.equal(g.plots[0].wilted, false, 'pas de fanaison retroactive');
  assert.equal(post('dino', { userId: 1 }).json.dinos[0].talentState.on, false);
  store.update('Users', 1, { Dinos: '[]', GardenPlots: '[]' });
});

await test('casino : ferme sans la porte, caisse, blackjack, roulette, chamboule, pinces, plinko, bonneteau, ticket, lots', () => {
  store.update('Users', 1, { ForbiddenUnlocked: 0, CasinoChips: 0, CasinoTickets: 0, StardustCount: 100000, CasinoState: '', CasinoDaily: '' });
  assert.equal(post('casino', { userId: 1, game: 'cashier' }).status, 403);
  store.update('Users', 1, { ForbiddenUnlocked: now(), ForbiddenXP: 0 });
  // Salles ouvertes par le niveau de la machine : niveau 1 = caisse, lots, grattage.
  assert.equal(post('casino', { userId: 1, game: 'blackjack' }).json.error, 'game_locked');
  store.update('Users', 1, { ForbiddenXP: 2000 });
  let r = post('casino', { userId: 1, game: 'cashier', action: 'buy', count: 1000 }).json;
  assert.equal(r.wallet.chips, 1000);
  r = post('casino', { userId: 1, game: 'cashier', action: 'daily' }).json;
  assert.ok(r.dailyGiven > 0);
  // Blackjack jusqu'a la fin de la main.
  r = post('casino', { userId: 1, game: 'blackjack', action: 'deal', bet: 10 }).json;
  if (!r.blackjack.done) r = post('casino', { userId: 1, game: 'blackjack', action: 'stand' }).json;
  assert.ok(r.blackjack.done && r.blackjack.result);
  assert.ok(r.blackjack.dealer.every((c) => c.r !== '?'));
  r = post('casino', { userId: 1, game: 'roulette', action: 'spin', bets: [{ type: 'red', amount: 10 }, { type: 'number', n: 7, amount: 5 }] }).json;
  assert.ok(r.roulette.n >= 0 && r.roulette.n <= 36);
  r = post('casino', { userId: 1, game: 'cans', action: 'start' }).json;
  for (let i = 0; i < 3 && !r.reward; i++) r = post('casino', { userId: 1, game: 'cans', action: 'throw', x: 0.5, p: 0.2 }).json;
  assert.ok(r.reward && r.reward.score >= 0);
  r = post('casino', { userId: 1, game: 'claw' }).json;
  const cap = r.claw.capsules[0];
  r = post('casino', { userId: 1, game: 'claw', action: 'grab', x: cap.x, y: cap.y }).json;
  assert.ok(['won', 'dropped', 'slipped', 'miss'].includes(r.grab.outcome));
  r = post('casino', { userId: 1, game: 'plinko', action: 'drop', bet: 10, x: 0.5 }).json;
  assert.equal(r.plinko.path.length, 8);
  r = post('casino', { userId: 1, game: 'cups', action: 'start', bet: 20, speed: 2 }).json;
  let pos = r.cups.start; for (const [a, b] of r.cups.swaps) { if (pos === a) pos = b; else if (pos === b) pos = a; }
  r = post('casino', { userId: 1, game: 'cups', action: 'pick', cup: pos }).json;
  assert.equal(r.cups.win, true);
  assert.equal(r.cups.booster, true);
  r = post('casino', { userId: 1, game: 'scratch', action: 'new' }).json;
  assert.equal(r.scratch.ticket.free, true);
  r = post('casino', { userId: 1, game: 'scratch', action: 'claim' }).json;
  assert.ok(r.scratch.claimed);
  store.update('Users', 1, { CasinoTickets: 500 });
  r = post('casino', { userId: 1, game: 'lots', action: 'buy', key: 'card' }).json;
  assert.ok(r.card && r.card.cardId);
  assert.equal(store.getAll('Pulls').filter((p) => p.Edition === 'forbidden' && refIdOf(p.User) === 1).length >= 1, true);
  r = post('casino', { userId: 1, game: 'lots', action: 'buy', key: 'title-flambeur' }).json;
  assert.equal(post('casino', { userId: 1, game: 'lots', action: 'buy', key: 'title-flambeur' }).json.error, 'already_owned');
  const cash = post('casino', { userId: 1, game: 'cashier', action: 'cashout', count: 100 }).json;
  assert.equal(cash.dust, 800);
  // Un tour de machine paye en jetons : aucune poussiere debitee.
  store.update('Users', 1, { ForbiddenFreeDay: parisDay(0), ForbiddenBonus: 0, ForbiddenFreeSpins: 0 });
  const chipsBefore = user(1).CasinoChips;
  const sp = post('forbidden', { userId: 1, action: 'spin', currency: 'chips' }).json;
  assert.equal(sp.paid, 0);
  assert.ok(sp.paidChips > 0);
  assert.equal(user(1).CasinoChips, chipsBefore - sp.paidChips);
});

console.log(`\n${passed} test(s) OK`);
store.db.close();
clean();
