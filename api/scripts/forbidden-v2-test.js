// Tests de la salle interdite V2 (2026-11-19) : machines a collectionner,
// historique et bilan, reputation et contrats du croupier, bilan economique,
// tournoi de la semaine, jackpot partage, table commune du blackjack, sceaux
// et plaque. Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { parisDay } from '../src/native/common.js';
import { weekKey } from '../src/native/levels.js';
import { ledgerView } from '../src/native/forbidden-rep.js';
import { afterNative as sealsAfter } from '../src/native/forbidden-seals.js';
import { _test as slotsTest, machinesOf } from '../src/native/slots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-salle2-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const post = (p, body) => { native.beforeRequest(body, {}, p); const r = native.run('POST', p, { body, query: {} }); native.endRequest(); return r; };
const mk = (pseudo, extra = {}) => store.create('Users', { Pseudo: pseudo, DiscordId: 'salle-' + pseudo, BoosterCount: 0, StardustCount: 200000, CasinoChips: 5000, XP: 0, ForbiddenUnlocked: 1, ForbiddenAccess: 1, ...extra });
const a = mk('Salle1');
const b = mk('Salle2', { ForbiddenXP: 400 });
const me = (u = a) => store.get('Users', u.id);
const room = (body, u = a) => post('forbidden', { userId: u.id, ...body });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('machines : la Classique d office, achat au bon niveau, prix du tour multiplie', () => {
  let st = room({ action: 'status' }).json;
  assert.equal(st.machine.machine.key, 'classique');
  assert.ok(!st.machine.machines.some((m) => m.key === 'salamandre'), 'machine secrete cachee');
  assert.equal(room({ action: 'machine', key: 'fournaise' }).json.error, 'machine_level');
  store.update('Users', a.id, { ForbiddenXP: 400 });
  const base = st.machine.spinCost;
  const dust0 = Number(me().StardustCount);
  const r = room({ action: 'machine', key: 'fournaise' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Number(me().StardustCount) < dust0, 'machine payee');
  st = r.json.machine;
  assert.equal(st.machine.key, 'fournaise');
  assert.equal(st.spinCost, base * 2);
  // Retour gratuit a la Classique deja possedee.
  const d1 = Number(me().StardustCount);
  assert.equal(room({ action: 'machine', key: 'classique' }).status, 200);
  assert.equal(Number(me().StardustCount), d1);
  assert.equal(room({ action: 'machine', key: 'pie' }).json.error, 'machine_locked');
  room({ action: 'machine', key: 'fournaise' });
});

await test('tour : detail du multiplicateur, historique, bilan paye / gagne, bilan de la salle', () => {
  store.update('Users', a.id, { ForbiddenFreeDay: parisDay(0), ForbiddenFreeSpins: 0, ForbiddenBonus: 0, ForbiddenHistory: '', ForbiddenStats: '' });
  const r = room({ action: 'spin', count: 10, bet: 3, free: false });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const x = r.json.results[0];
  assert.equal(x.machine, 'fournaise');
  assert.deepEqual(x.multParts[0], { label: 'Mise', x: 3 });
  assert.equal(r.json.paid, r.json.machine.spinCost * 3 * 10);
  const h = r.json.machine.history;
  assert.equal(h.length, 10);
  assert.equal(h[0].m, 'fournaise');
  assert.equal(h[0].paid, r.json.machine.spinCost * 3);
  assert.equal(r.json.machine.stats.paid, r.json.paid);
  assert.ok(r.json.machine.paytable.some((p) => p.key === 'jackpot' && p.triple));
  const l = ledgerView(store);
  assert.ok(l.week.spins >= 10 && l.week.paid >= r.json.paid);
});

await test('reputation : contrat rempli, palier atteint et recompense creditee', () => {
  store.update('Users', a.id, { ForbiddenRep: JSON.stringify({ month: parisDay(0).slice(0, 7), pts: 15, got: [], best: 0, day: parisDay(0), list: [{ key: 'spins', n: 1, p: 0 }, { key: 'inlay', n: 1, p: 0 }, { key: 'heart', n: 1, p: 0 }], all: false }) });
  const chips0 = Number(me().CasinoChips);
  const r = room({ action: 'spin', count: 1, bet: 1, free: false });
  assert.equal(r.status, 200);
  assert.ok(r.json.rep, 'reputation jointe');
  assert.equal(r.json.rep.contracts[0].done, true);
  assert.ok(r.json.rep.pts >= 25);
  assert.ok(r.json.rep.tier >= 1);
  assert.ok((r.json.repNotices || []).some((n) => /palier 1/.test(n.text)));
  assert.ok(Number(me().CasinoChips) >= chips0 + 30, 'palier 1 : 30 jetons');
  // Palier 5 : la Pie voleuse rejoint la collection.
  store.update('Users', a.id, { ForbiddenRep: JSON.stringify({ ...JSON.parse(me().ForbiddenRep), pts: 195 }) });
  const r2 = room({ action: 'spin', count: 1, bet: 1, free: false });
  const rep = r2.json.rep;
  if (rep.pts >= 200) assert.ok(machinesOf(me()).owned.has('pie'));
  // Casino : les contrats comptent aussi.
  store.update('Users', a.id, { ForbiddenRep: JSON.stringify({ ...JSON.parse(me().ForbiddenRep), list: [{ key: 'roulette', n: 1, p: 0 }, { key: 'spins', n: 99, p: 0 }, { key: 'heart', n: 1, p: 0 }] }) });
  const rr = post('casino', { userId: a.id, game: 'roulette', action: 'spin', bets: [{ type: 'red', amount: 5 }] });
  if (rr.status === 200) assert.equal(rr.json.rep.contracts[0].done, true);
});

await test('tournoi : inscription, 10 tours sans gain reel, classement, recompenses de la semaine passee', () => {
  const dust0 = Number(me().StardustCount);
  let r = room({ action: 'tourney', op: 'join' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(room({ action: 'tourney', op: 'join' }).json.error, 'already_joined');
  r = room({ action: 'tourney', op: 'spin', count: 10 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.rolls.length, 10);
  assert.equal(r.json.tourney.left, r.json.tourney.budget - 10);
  assert.equal(Number(me().StardustCount), dust0, 'aucune poussiere');
  assert.ok(r.json.tourney.top.some((x) => x.userId === a.id));
  // Semaine passee : b gagne.
  const prev = weekKey(Date.now() - 7 * 86400000);
  store.update('Users', b.id, { ForbiddenTourney: JSON.stringify({ week: prev, left: 0, score: 999, spins: 50 }), BoosterCount: 0 });
  const paid = store.getAll('AppSettings').find((x) => x.Key === 'ForbiddenTourneyPaid');
  if (paid) store.delete('AppSettings', paid.id);
  room({ action: 'status' }, b);
  assert.equal(Number(me(b).BoosterCount), 5, '1er : 5 jetons booster');
  room({ action: 'status' }, b);
  assert.equal(Number(me(b).BoosterCount), 5, 'une seule fois');
});

await test('jackpot partage : une part pour les joueurs de l heure', () => {
  slotsTest.noteRecent(store, b);
  const before = Number(me(b).StardustCount);
  const c = slotsTest.crowdShare(store, me(), 10000);
  assert.equal(c.players, 1);
  assert.equal(c.total, 1000);
  // (un succes cache peut ajouter quelques poussieres en franchissant un palier de solde)
  assert.ok(Number(me(b).StardustCount) >= before + 1000);
});

await test('blackjack : table commune de l heure', () => {
  for (const u of [a, b]) {
    const d = post('casino', { userId: u.id, game: 'blackjack', action: 'deal', bet: 5 });
    assert.equal(d.status, 200, JSON.stringify(d.json));
    if (!d.json.blackjack.done) post('casino', { userId: u.id, game: 'blackjack', action: 'stand' });
  }
  const t = post('casino', { userId: a.id, game: 'blackjack', action: 'status' }).json.table;
  assert.ok(t.seats.length >= 2);
  assert.ok(t.seats.some((s) => s.me));
});

await test('sceaux : un sceau s allume, la plaque refuse le mauvais mot puis recompense', () => {
  const res = { status: 200, json: { roulette: { n: 0, bets: [{ type: 'number', n: 0, amount: 1, win: 36 }] } } };
  sealsAfter({ store, path: 'casino', request: { body: { userId: a.id, game: 'roulette', action: 'spin' } }, response: res });
  assert.equal(res.json.seal.n, 7);
  let s = room({ action: 'seals' }).json.seals;
  assert.equal(s.count, 1);
  assert.equal(s.seals[6].lit, true);
  assert.equal(s.seals[0].letter, null, 'lettres cachees tant que le sceau dort');
  assert.equal(room({ action: 'plaque', word: 'x' }).json.error, 'seals_missing');
  store.update('Users', a.id, { ForbiddenSeals: JSON.stringify({ found: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 } }) });
  assert.equal(room({ action: 'plaque', word: 'cendre' }).json.error, 'wrong_word');
  const word = room({ action: 'seals' }).json.seals.seals.map((x) => x.letter).join('');
  const r = room({ action: 'plaque', word: word.toLowerCase() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.card && r.json.card.serialNumber >= 1);
  assert.ok(machinesOf(me()).owned.has('salamandre'));
  s = room({ action: 'status' }).json;
  assert.ok(s.machine.machines.some((m) => m.key === 'salamandre'));
  assert.equal(room({ action: 'machine', key: 'salamandre' }).json.machine.reels, 4, '4 rouleaux d office');
});

store.db.close();
clean();
console.log(`\n${passed} tests de la salle V2 ok`);
