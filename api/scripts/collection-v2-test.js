// Tests de la Collection V2 et du Coffre-fort V2 (2026-11-07) : pages
// d'album recompensees, niveau du coffre (paliers + interets du jour), ordre
// de la vitrine du profil. Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { parisDay } from '../src/native/common.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2gatcha-cv2-'));
const tmp = path.join(dir, 'base.sqlite');
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const call = (method, p, body = {}) => { native.beforeRequest(body, {}, p); const r = native.run(method, p, { body, query: {} }); native.endRequest(); return r; };
const post = (p, body) => call('POST', p, body);
const ADMIN = '785223211730075709';
const refIdOf = (v) => (Array.isArray(v) ? v[1] : v);
const user = (id) => store.get('Users', id);
const [u1, u2] = store.getAll('Users');
post('admin-settings', { discordId: ADMIN, action: 'set', values: { StarterEnabled: false, SurpriseEnabled: false, PriceIndexEnabled: false } });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

// Extension de test : 5 cartes, pages de 3 -> 2 pages (3 + 2).
const ext = store.create('Extensions', { Name: 'Album test', Key: 'album-test', SortOrder: 999 });
const rarity = store.getAll('Rarities')[0];
const cards = [5, 0, 3, 0, 1].map((so, i) => store.create('Cards', { Name: `Page ${i}`, Active: true, Extension: ext.id, Rarity: rarity.id, SortOrder: so }));
// Ordre attendu : SortOrder 1, 3, 5, puis les deux sans ordre (creation).
const expected = [cards[4], cards[2], cards[0], cards[1], cards[3]].map((c) => c.id);
const give = (card, extra = {}) => store.create('Pulls', { User: u1.id, Card: card.id ?? card, SerialNumber: 9000 + Math.floor(Math.random() * 1e5), Quality: 'mint', ...extra });

await test('album : pages dans l ordre du catalogue, page complete payee une fois', () => {
  post('admin-settings', { discordId: ADMIN, action: 'set', values: { AlbumPageSize: 3, AlbumPageBoosters: 2, AlbumPageDust: 30 } });
  let st = post('album-pages', { userId: u1.id }).json;
  const e = st.extensions.find((x) => x.extensionId === ext.id);
  assert.deepEqual(e.pages.flatMap((p) => p.cardIds), expected);
  assert.equal(e.pages.length, 2);
  assert.equal(post('album-pages', { userId: u1.id, action: 'claim', extensionId: ext.id, page: 1 }).json.error, 'page_incomplete');
  give(cards[4]); give(cards[2]);
  // Une carte au coffre compte comme decouverte.
  give(cards[0], { InVault: true });
  st = post('album-pages', { userId: u1.id }).json;
  assert.equal(st.extensions.find((x) => x.extensionId === ext.id).pages[0].complete, true);
  const b0 = user(u1.id).BoosterCount || 0, d0 = user(u1.id).StardustCount || 0;
  const r = post('album-pages', { userId: u1.id, action: 'claim', extensionId: ext.id, page: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(user(u1.id).BoosterCount, b0 + 2);
  assert.equal(user(u1.id).StardustCount, d0 + 30);
  assert.equal(post('album-pages', { userId: u1.id, action: 'claim', extensionId: ext.id, page: 1 }).json.error, 'already_claimed');
  assert.equal(post('album-pages', { userId: u1.id, action: 'claim', extensionId: ext.id, page: 7 }).json.error, 'unknown_page');
});

await test('album : tout reclamer', () => {
  give(cards[1]); give(cards[3]);
  const r = post('album-pages', { userId: u1.id, action: 'claimAll' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.claimed.pages >= 1);
  assert.equal(r.json.extensions.find((x) => x.extensionId === ext.id).claimable, 0);
  assert.equal(post('album-pages', { userId: u1.id, action: 'claimAll' }).json.error, 'nothing_to_claim');
  // Un autre joueur n'a rien.
  assert.equal(post('album-pages', { userId: u2.id }).json.extensions.find((x) => x.extensionId === ext.id).pages[0].owned, 0);
});

await test('coffre : niveau, paliers reclames d un coup, interets une fois par jour', () => {
  const vaultCard = store.getAll('Cards').find((c) => c.IsVault) || store.create('Cards', { Name: 'Coffre', IsVault: true, Active: false });
  if (!store.getAll('Pulls').some((p) => refIdOf(p.User) === u1.id && refIdOf(p.Card) === vaultCard.id)) store.create('Pulls', { User: u1.id, Card: vaultCard.id, SerialNumber: 1, BatchId: 'vault-1' });
  post('admin-settings', { discordId: ADMIN, action: 'set', values: { VaultXpPerCard: 1, VaultXpPerRow: 10, VaultLevels: [
    { xp: 0, name: 'Fer', interest: 0 }, { xp: 2, name: 'Bronze', boosters: 1, dust: 10, interest: 5 }, { xp: 12, name: 'Or', boosters: 2, dust: 20, interest: 9 }, { xp: 500, name: 'Loin' }] } });
  let st = post('personal-vault', { userId: u1.id }).json;
  const startXp = st.level.xp;
  assert.equal(st.level.stored, store.getAll('Pulls').filter((p) => refIdOf(p.User) === u1.id && p.InVault && p.Finish !== 'emerald').length);
  // Une ligne complete : 6 finitions -> +6 cartes et +10 de ligne.
  const card = cards[3];
  const ids = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'].map((f) => give(card, { Finish: f }).id);
  for (const id of ids) post('personal-vault', { userId: u1.id, action: 'store', pullId: id });
  st = post('personal-vault', { userId: u1.id }).json;
  assert.equal(st.level.xp, startXp + 6 + 10);
  assert.equal(st.level.level, 3);
  assert.equal(st.level.pending.length, 2);
  const b0 = user(u1.id).BoosterCount, d0 = user(u1.id).StardustCount;
  const r = post('personal-vault', { userId: u1.id, action: 'claimLevel' }).json;
  assert.deepEqual(r.levelReward.levels, [2, 3]);
  assert.equal(user(u1.id).BoosterCount, b0 + 3);
  assert.equal(user(u1.id).StardustCount, d0 + 30);
  assert.equal(post('personal-vault', { userId: u1.id, action: 'claimLevel' }).json.error, 'nothing_to_claim');
  // Interets du niveau 3.
  assert.equal(r.level.interestReady, true);
  const i = post('personal-vault', { userId: u1.id, action: 'interest' }).json;
  assert.equal(i.interestGained, 9);
  assert.equal(user(u1.id).VaultInterestDay, parisDay());
  assert.equal(post('personal-vault', { userId: u1.id, action: 'interest' }).json.error, 'already_claimed_today');
  // Retirer des cartes fait redescendre le niveau sans redonner les paliers.
  for (const id of ids.slice(0, 5)) post('personal-vault', { userId: u1.id, action: 'withdraw', pullId: id });
  st = post('personal-vault', { userId: u1.id }).json;
  assert.equal(st.level.xp, startXp + 1 + 10);
  assert.equal(st.level.pending.length, 0);
  // Reglage invalide refuse.
  assert.ok(post('admin-settings', { discordId: ADMIN, action: 'set', values: { VaultLevels: [{ xp: 5 }] } }).json.error);
});

await test('vitrine : ordre reecrit, cartes non citees a la suite', () => {
  if (!store.tables.has('ProfileShowcase')) { console.log('     (pas de table ProfileShowcase dans la base de test)'); return; }
  store.getAll('ProfileShowcase').filter((r) => refIdOf(r.User) === u1.id).forEach((r) => store.delete('ProfileShowcase', r.id));
  [cards[0], cards[1], cards[2]].forEach((c, i) => store.create('ProfileShowcase', { User: u1.id, Card: c.id, SortOrder: i }));
  const r = native.beforeWorkflow('showcase', { body: { userId: u1.id, action: 'order', cardIds: [cards[2].id, cards[0].id] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ordered, true);
  assert.deepEqual(r.json.showcase.map((c) => c.cardId), [cards[2].id, cards[0].id, cards[1].id]);
});

console.log(`\n${passed} test(s) collection V2 reussi(s)` + (process.exitCode ? ' — ECHECS' : ''));
store.close?.();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* fichier encore ouvert sous Windows */ }
