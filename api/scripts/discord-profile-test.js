// Tests de la photo Discord a jour (2026-11-06) : jeton de rafraichissement
// garde a la connexion (jamais renvoye), relecture en arriere-plan, lien
// oublie si Discord refuse, photo renvoyee par booster-status.
// Base de selftest, Discord simule.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import * as dp from '../src/native/discord-profile.js';
import { now } from '../src/native/common.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2gatcha-dprofile-'));
const tmp = path.join(dir, 'base.sqlite');
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const [u1, u2] = store.getAll('Users');
store.update('Users', u1.id, { DiscordId: '785223211730075709', DiscordAvatar: 'https://cdn.discordapp.com/avatars/785223211730075709/old.png?size=128', DiscordUsername: 'Ancien', LastSeenAt: now() });
store.update('Users', u2.id, { DiscordId: '111111111111111111', LastSeenAt: now() - 10 * 86400 });
const links = () => store.getAll('DiscordLinks');
const login = (userId, refresh) => {
  const response = { status: 200, json: { userId, pseudo: 'x', discordRefresh: refresh } };
  native.afterWorkflow('discord-login', { body: {}, query: {} }, response);
  return response;
};

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

// Discord simule : refresh -> nouveau jeton, @me -> nouvelle photo.
function fakeDiscord({ refuse = false, avatar = 'newhash', name = 'Nouveau' } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push(url);
    if (url.endsWith('/oauth2/token')) {
      const sent = new URLSearchParams(opts.body);
      assert.equal(sent.get('grant_type'), 'refresh_token');
      if (refuse) return { ok: false, json: async () => ({ error: 'invalid_grant' }) };
      return { ok: true, json: async () => ({ access_token: 'acc', refresh_token: sent.get('refresh_token') + '-2' }) };
    }
    return { ok: true, json: async () => ({ id: '785223211730075709', avatar, global_name: name, username: 'u' }) };
  };
  fn.calls = calls;
  return fn;
}
const creds = { id: '1', secret: 's' };

await test('connexion : le jeton est garde et retire de la reponse', () => {
  const r = login(u1.id, 'ref-1');
  assert.equal('discordRefresh' in r.json, false);
  assert.equal(links().length, 1);
  assert.equal(links()[0].Refresh, 'ref-1');
  login(u1.id, 'ref-1b');
  assert.equal(links().length, 1, 'un seul lien par joueur');
  assert.equal(links()[0].Refresh, 'ref-1b');
  login(u2.id, 'ref-u2');
  assert.equal(links().length, 2);
});

await test('relecture : rien avant le delai, puis seulement les joueurs venus recemment', () => {
  assert.equal(dp.due(store).length, 0, 'lu a la connexion');
  for (const l of links()) store.update('DiscordLinks', l.id, { CheckedAt: now() - 25 * 3600 });
  const jobs = dp.due(store);
  assert.deepEqual(jobs.map((j) => j.userId), [u1.id], 'u2 absent depuis 10 jours');
});

await test('relecture : nouvelle photo et nouveau nom enregistres, jeton tourne', async () => {
  const fetchImpl = fakeDiscord();
  const results = await dp.fetchProfiles(dp.due(store), creds, fetchImpl);
  assert.equal(dp.apply(store, results), 1);
  const u = store.get('Users', u1.id);
  assert.equal(u.DiscordAvatar, 'https://cdn.discordapp.com/avatars/785223211730075709/newhash.png?size=128');
  assert.equal(u.DiscordUsername, 'Nouveau');
  const l = links().find((x) => x.User === u1.id || Number(x.User) === u1.id);
  assert.equal(l.Refresh, 'ref-1b-2');
  assert.equal(dp.due(store).length, 0, 'relu');
});

await test('photo retiree dans Discord : avatar par defaut', async () => {
  for (const l of links()) store.update('DiscordLinks', l.id, { CheckedAt: 0 });
  await dp.fetchProfiles(dp.due(store), creds, fakeDiscord({ avatar: null })).then((r) => dp.apply(store, r));
  assert.match(store.get('Users', u1.id).DiscordAvatar, /embed\/avatars\/\d\.png$/);
});

await test('acces retire : le lien est oublie, erreur passagere : garde', async () => {
  store.update('DiscordLinks', links().find((x) => Number(x.User) === u1.id).id, { CheckedAt: 0 });
  const down = async () => { throw new Error('reseau'); };
  dp.apply(store, await dp.fetchProfiles(dp.due(store), creds, down));
  assert.equal(links().some((x) => Number(x.User) === u1.id), true, 'garde apres une panne');
  dp.apply(store, await dp.fetchProfiles(dp.due(store), creds, fakeDiscord({ refuse: true })));
  assert.equal(links().some((x) => Number(x.User) === u1.id), false, 'oublie');
});

await test('booster-status renvoie la photo enregistree', () => {
  const response = { status: 200, json: {} };
  native.afterWorkflow('booster-status', { body: {}, query: { userId: String(u1.id) } }, response);
  assert.equal(response.json.discordAvatar, store.get('Users', u1.id).DiscordAvatar);
});

console.log(`\n${passed} tests ok`);
