// Tests de l'Admin V2 (2026-11-07) : tableau de bord, planificateur
// (boss, evenement, code, validation manuelle, boucle hebdomadaire).
// Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { tick, nextAfter } from '../src/native/admin-v2.js';
import { now } from '../src/native/common.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2gatcha-adm2-'));
const tmp = path.join(dir, 'base.sqlite');
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const call = (p, body = {}) => { native.beforeRequest(body, {}, p); const r = native.run('POST', p, { body, query: {} }); native.endRequest(); return r; };
const ADMIN = '785223211730075709';
const plan = (body) => call('admin-planner', { discordId: ADMIN, ...body });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('tableau de bord : reserve aux admins, indicateurs presents', () => {
  assert.equal(call('admin-dashboard', { discordId: '1' }).status, 403);
  const r = call('admin-dashboard', { discordId: ADMIN });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json;
  assert.ok(d.players.total >= 2);
  assert.equal(d.pulls.days.length, 7);
  assert.ok('boostersIn' in d.economy.today);
  assert.ok(Array.isArray(d.alerts));
  assert.ok(d.game.mode);
});

await test('planificateur : boss hebdomadaire lance a l heure, pas de doublon si un boss vit', () => {
  const t = now();
  let r = plan({ action: 'save', rule: { kind: 'boss', label: 'Boss du lundi', repeat: 'weekly', nextAt: t - 10, config: { names: 'Kraken, Golem', hp: 500, rewardBoosters: 2 } } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rule = r.json.rules.find((x) => x.label === 'Boss du lundi');
  assert.ok(rule.nextAt > t, 'date passee : prochain passage a venir');
  // Force l'echeance.
  store.update('PlannerRules', rule.id, { NextAt: t - 5 });
  (store.tables.has('CommunityBoss') ? store.getAll('CommunityBoss') : []).filter((b) => b.Active).forEach((b) => store.update('CommunityBoss', b.id, { Active: false }));
  tick(store, t);
  const boss = store.getAll('CommunityBoss').filter((b) => b.Active);
  assert.equal(boss.length, 1);
  assert.equal(boss[0].BossName, 'Kraken');
  assert.equal(boss[0].MaxHp, 500);
  const after = store.get('PlannerRules', rule.id);
  assert.equal(after.NextAt, nextAfter(t - 5, 'weekly'));
  assert.equal(after.Runs, 1);
  // Encore en vie : la prochaine passe ne cree rien.
  store.update('PlannerRules', rule.id, { NextAt: t - 1 });
  tick(store, t);
  assert.equal(store.getAll('CommunityBoss').filter((b) => b.Active).length, 1);
  assert.match(store.get('PlannerRules', rule.id).LastResult, /encore en vie/);
});

await test('planificateur : a valider -> en attente, puis lancer ou passer', () => {
  const t = now();
  let r = plan({ action: 'save', rule: { kind: 'event', label: 'Week-end x2', repeat: 'once', approval: true, nextAt: t + 3600, config: { label: 'Week-end x2', hours: 48, dust: 2 } } });
  const rule = r.json.rules.find((x) => x.label === 'Week-end x2');
  store.update('PlannerRules', rule.id, { NextAt: t - 1 });
  const before = store.getAll('ScheduledEvents').length;
  tick(store, t);
  assert.ok(store.get('PlannerRules', rule.id).PendingAt > 0, 'en attente');
  assert.equal(store.getAll('ScheduledEvents').length, before, 'rien lance sans validation');
  assert.ok(call('admin-dashboard', { discordId: ADMIN }).json.planner.pending.some((p) => p.id === rule.id));
  r = plan({ action: 'approve', id: rule.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(store.getAll('ScheduledEvents').length, before + 1);
  const ev = store.getAll('ScheduledEvents').pop();
  assert.equal(ev.DustMultiplier, 2);
  assert.equal(store.get('PlannerRules', rule.id).Active, false, 'une seule fois : desactivee');
});

await test('planificateur : code avec recompenses, refus des recompenses invalides', () => {
  const t = now();
  assert.ok(plan({ action: 'save', rule: { kind: 'code', nextAt: t, config: { rewards: [{ type: 'resource', key: 'nope', n: 3 }] } } }).json.error);
  const r = plan({ action: 'save', rule: { kind: 'code', label: 'Code du vendredi', repeat: 'weekly', nextAt: t + 60, config: { prefix: 'VENDREDI', hours: 24, rewards: [{ type: 'resource', key: 'booster', n: 3 }] } } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rule = r.json.rules.find((x) => x.label === 'Code du vendredi');
  const res = plan({ action: 'run', id: rule.id }).json.result;
  assert.match(res.code, /^VENDREDI-/);
  assert.ok(store.getAll('EventCodes').some((c) => c.Code === res.code && c.Active));
  assert.equal(plan({ action: 'skip', id: rule.id }).status, 200);
  assert.equal(plan({ action: 'delete', id: rule.id }).json.deleted, true);
  assert.equal(plan({ action: 'list' }).json.rules.some((x) => x.id === rule.id), false);
});

console.log(`\n${passed} test(s) admin V2 reussi(s)` + (process.exitCode ? ' — ECHECS' : ''));
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* fichier encore ouvert sous Windows */ }
