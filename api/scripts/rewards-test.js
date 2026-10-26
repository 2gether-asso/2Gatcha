// Tests de Codes & dons V2 (rewards.js, 2026-10-26) : catalogue, codes a
// plusieurs recompenses avec date de debut et quota, reclamation, dons a
// plusieurs joueurs (ressources, cartes avec finition / etat / edition,
// tablettes, fragments, cosmetiques), validation, anciens codes intacts.
// Base de selftest, aucun reseau.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createNative } from '../src/native/index.js';
import { now } from '../src/native/common.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `2gatcha-rewards-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'selftest.js')], { env: { ...process.env, KEEP_DB: tmp }, stdio: 'ignore' });

const store = new Store(tmp, { lenient: true });
const native = createNative({ store, withLock: (fn) => fn() });
const call = (method, p, args) => { native.beforeRequest(args.body || {}, args.query || {}, p); const r = native.run(method, p, args); native.endRequest(); return r; };
const post = (p, body) => call('POST', p, { body });
const redeem = (userId, code) => { native.beforeRequest({ userId, code }, {}, 'redeem-code'); const r = native.beforeWorkflow('redeem-code', { body: { userId, code }, query: {} }); native.endRequest(); return r; };
const ADMIN = '785223211730075709';
const admin = (body) => post('admin-rewards', { discordId: ADMIN, ...body });
const user = (id) => store.get('Users', id);
const refIdOf = (v) => (Array.isArray(v) ? v[1] : v);
const pullsOf = (id) => store.getAll('Pulls').filter((p) => refIdOf(p.User) === id);
post('admin-settings', { discordId: ADMIN, action: 'set', values: { StarterEnabled: false, SurpriseEnabled: false, PriceIndexEnabled: false } });
while (store.getAll('Users').length < 3) store.create('Users', { Pseudo: 'Testeur' + store.getAll('Users').length, DiscordId: String(900000 + store.getAll('Users').length), BoosterCount: 0, StardustCount: 0 });
const ids = store.getAll('Users').map((u) => u.id).slice(0, 3);
const card = store.getAll('Cards').find((c) => c.Active && !c.IsPromo);
const rarity = store.get('Rarities', refIdOf(card.Rarity));

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; }
}

await test('admin seulement', () => {
  assert.equal(post('admin-rewards', { discordId: '1', action: 'catalog' }).status, 403);
  const c = admin({ action: 'catalog' });
  assert.equal(c.status, 200);
  assert.ok(c.json.resources.some((r) => r.key === 'tabletGold'));
  assert.ok(c.json.editions.some((e) => e.key === 'cursed'));
});

await test('validation des lignes', () => {
  assert.equal(admin({ action: 'preview', rewards: [] }).json.error, 'no_reward');
  assert.equal(admin({ action: 'preview', rewards: [{ type: 'resource', key: 'nope', n: 1 }] }).json.error, 'unknown_resource');
  assert.equal(admin({ action: 'preview', rewards: [{ type: 'resource', key: 'booster', n: 9999 }] }).json.error, 'invalid_amount');
  assert.equal(admin({ action: 'preview', rewards: [{ type: 'card', cardId: 999999 }] }).json.error, 'card_not_found');
  assert.equal(admin({ action: 'preview', rewards: [{ type: 'card', cardId: card.id, edition: 'zzz' }] }).json.error, 'unknown_edition');
  const ok = admin({ action: 'preview', rewards: [{ type: 'resource', key: 'worms', n: 5 }, { type: 'card', cardId: card.id, n: 2, finish: 'gold', quality: 'mint', edition: 'cursed' }] });
  assert.equal(ok.status, 200);
  assert.match(ok.json.lines[0].label, /\+5 vers/);
  assert.match(ok.json.lines[1].label, /2× .*dorée.*parfait état.*Maudite/);
});

await test('don a plusieurs joueurs : ressources, carte avec edition, tablettes, XP x2, fragments', () => {
  const before = ids.map((id) => ({ ...user(id) }));
  const pulls0 = ids.map((id) => pullsOf(id).length);
  const r = admin({ action: 'gift', userIds: ids, rewards: [
    { type: 'resource', key: 'dust', n: 100 }, { type: 'resource', key: 'key', n: 2 }, { type: 'resource', key: 'bone', n: 3 },
    { type: 'resource', key: 'tabletStone', n: 2 }, { type: 'resource', key: 'xpBoost', n: 30 },
    { type: 'card', cardId: card.id, n: 1, finish: 'holo', quality: 'mint', edition: 'frost' }
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.gifted, ids.length);
  ids.forEach((id, i) => {
    const u = user(id), b = before[i];
    assert.equal(u.StardustCount, (b.StardustCount || 0) + 100);
    assert.equal(u.KeyCount, (b.KeyCount || 0) + 2);
    assert.equal(u.BoneCount, (b.BoneCount || 0) + 3);
    assert.equal(JSON.parse(u.TabletStock).stone, (JSON.parse(b.TabletStock || '{}').stone || 0) + 2);
    assert.ok(u.XpBoostUntil >= now() + 29 * 60);
    const fresh = pullsOf(id).slice(pulls0[i]);
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0].Finish, 'holo'); assert.equal(fresh[0].Quality, 'mint'); assert.equal(fresh[0].Edition, 'frost');
    assert.match(fresh[0].BatchId, /^admin-gift-/);
  });
  // Fragments : convertis en booster quand le compte est rond.
  const per = 10;
  post('admin-settings', { discordId: ADMIN, action: 'set', values: { ShardsPerBooster: per } });
  const b0 = user(ids[0]).BoosterCount || 0;
  store.update('Users', ids[0], { BoosterShards: 0 });
  admin({ action: 'gift', userIds: [ids[0]], rewards: [{ type: 'resource', key: 'shards', n: 25 }] });
  assert.equal(user(ids[0]).BoosterCount, b0 + 2);
  assert.equal(user(ids[0]).BoosterShards, 5);
});

await test('don : carte au hasard d\'une rarete, refuse un joueur inconnu', () => {
  const n0 = pullsOf(ids[1]).length;
  const r = admin({ action: 'gift', userIds: [ids[1]], rewards: [{ type: 'randomCard', rarity: rarity.Key, n: 3, quality: 'good' }] });
  assert.equal(r.status, 200);
  const fresh = pullsOf(ids[1]).slice(n0);
  assert.equal(fresh.length, 3);
  fresh.forEach((p) => assert.equal(refIdOf(store.get('Cards', refIdOf(p.Card)).Rarity), rarity.id));
  assert.equal(admin({ action: 'gift', userIds: [ids[1], 999999], rewards: [{ type: 'resource', key: 'worms', n: 1 }] }).status, 404);
});

await test('code a plusieurs recompenses : creation, liste, reclamation, deja reclame, quota', () => {
  const t = now();
  const c = admin({ action: 'createCode', code: 'soiree-v2', label: 'Soirée V2', maxRedemptions: 2, expiresAt: t + 3600, rewards: [{ type: 'resource', key: 'booster', n: 2 }, { type: 'resource', key: 'worms', n: 10 }, { type: 'card', cardId: card.id, n: 1, finish: 'diamond', quality: 'mint' }] });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.created.code, 'SOIREE-V2');
  assert.equal(c.json.created.status, 'active');
  assert.equal(admin({ action: 'createCode', code: 'SOIREE-V2', rewards: [{ type: 'resource', key: 'booster', n: 1 }] }).json.error, 'code_taken');
  const b0 = user(ids[0]).BoosterCount || 0, w0 = user(ids[0]).Worms || 0, n0 = pullsOf(ids[0]).length;
  const r = redeem(ids[0], 'soiree-v2');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.type, 'reward');
  assert.equal(r.json.source, 'event');
  assert.equal(r.json.title, 'Soirée V2');
  assert.equal(r.json.cards.length, 1);
  assert.equal(r.json.cards[0].finish, 'diamond');
  assert.equal(user(ids[0]).BoosterCount, b0 + 2);
  assert.equal(user(ids[0]).Worms, w0 + 10);
  assert.equal(pullsOf(ids[0]).length, n0 + 1);
  assert.match(pullsOf(ids[0]).at(-1).BatchId, /^code-SOIREE-V2-/);
  assert.equal(redeem(ids[0], 'SOIREE-V2').json.error, 'already_redeemed');
  assert.equal(redeem(ids[1], 'SOIREE-V2').status, 200);
  assert.equal(redeem(ids[2], 'SOIREE-V2').json.error, 'code_exhausted');
  const list = admin({ action: 'codes' }).json.codes.find((x) => x.code === 'SOIREE-V2');
  assert.equal(list.used, 2);
  assert.equal(list.status, 'exhausted');
  assert.equal(admin({ action: 'redemptions', code: 'soiree-v2' }).json.redemptions.length, 2);
});

await test('date de debut, expiration, desactivation, modification', () => {
  const t = now();
  const c = admin({ action: 'createCode', code: 'PLUSTARD', startsAt: t + 7200, expiresAt: t + 10800, rewards: [{ type: 'resource', key: 'key', n: 1 }] });
  assert.equal(c.json.created.status, 'scheduled');
  const r = redeem(ids[2], 'PLUSTARD');
  assert.equal(r.json.error, 'code_not_started');
  assert.ok(r.json.startsAt > t);
  assert.equal(admin({ action: 'createCode', code: 'BADDATES', startsAt: t + 7200, expiresAt: t + 3600, rewards: [{ type: 'resource', key: 'key', n: 1 }] }).json.error, 'invalid_dates');
  admin({ action: 'updateCode', code: 'plustard', startsAt: 0 });
  assert.equal(redeem(ids[2], 'PLUSTARD').status, 200);
  admin({ action: 'createCode', code: 'COUPE', expiresAt: t + 600, rewards: [{ type: 'resource', key: 'key', n: 1 }] });
  admin({ action: 'updateCode', code: 'COUPE', active: false });
  assert.equal(redeem(ids[2], 'COUPE').json.error, 'code_inactive');
  admin({ action: 'updateCode', code: 'COUPE', active: true, expiresAt: t - 10 });
  assert.equal(redeem(ids[2], 'COUPE').json.error, 'code_expired');
  assert.equal(admin({ action: 'updateCode', code: 'COUPE', rewards: [{ type: 'resource', key: 'bone', n: 2 }] }).status, 200);
});

await test('anciens codes : laisses au workflow, date de debut respectee', () => {
  const t = now();
  const row = store.create('EventCodes', { Code: 'ANCIEN', Label: '', RewardType: 'booster', Quantity: 3, CardId: 0, MaxRedemptions: 0, ExpiresAt: t + 3600, CreatedAt: t, Active: true });
  assert.equal(redeem(ids[0], 'ANCIEN'), null, 'le workflow garde la main');
  store.update('EventCodes', row.id, { StartsAt: t + 600 });
  assert.equal(redeem(ids[0], 'ANCIEN').json.error, 'code_not_started');
  const v = admin({ action: 'codes' }).json.codes.find((x) => x.code === 'ANCIEN');
  assert.equal(v.kind, 'booster');
  assert.match(v.lines[0].label, /\+3 jetons booster/);
  assert.equal(redeem(ids[0], 'INCONNU'), null);
});

await test('expedition : une carte Unique rapporte poussieres, ressources et chance de booster en plus', () => {
  const uni = store.getAll('Rarities').find((r) => r.Key === 'unique');
  assert.ok(uni, 'rarete Unique');
  let ucard = store.getAll('Cards').find((c) => refIdOf(c.Rarity) === uni.id);
  if (!ucard) ucard = store.create('Cards', { Name: 'Unique test', Rarity: uni.id, Active: true, IsPromo: true });
  post('admin-settings', { discordId: ADMIN, action: 'set', values: { ExpeditionUniqueDustPct: 100, ExpeditionUniqueLootPct: 50, ExpeditionUniqueBoosterChance: 100, ExpeditionAffinityPct: 0 } });
  const id = ids[2];
  const run = (body, json) => { const req = { body: { userId: id, ...body }, query: {} }; native.beforeRequest(req.body, {}, 'expedition'); native.beforeWorkflow('expedition', req); const res = { status: 200, json }; native.afterWorkflow('expedition', req, res); native.endRequest(); return res.json; };
  const st = run({ action: 'start', hours: 2, cardId: ucard.id }, { expedition: { active: true } });
  const trip = JSON.parse(user(id).ExpeditionTrip);
  assert.equal(trip.unique, true);
  assert.equal(trip.bonus, 1.5);
  assert.equal(st.rarityBonus.unique, 2);
  assert.equal(st.uniqueBonus.lootPct, 50);
  store.update('Users', id, { ExpeditionDuration: 2 });
  const d0 = user(id).StardustCount || 0, b0 = user(id).BoosterCount || 0;
  const res = run({ action: 'claim' }, { reward: { dust: 30, boosters: 0 }, newStardust: d0, newBoosterCount: b0 });
  // D'autres bonus du jour (evenement, heure de chance...) peuvent toucher les
  // poussieres avant : a 100 %, le bonus Unique double ce qui arrive.
  const u = res.reward.unique.dust;
  assert.ok(u >= 30, `bonus Unique ${u}`);
  assert.equal(res.reward.dust, 2 * u);
  assert.equal(res.reward.boosters, 1);
  assert.ok(user(id).StardustCount >= d0 + u);
  assert.equal(user(id).BoosterCount, b0 + 1);
  assert.equal(res.newStardust, user(id).StardustCount);
  // Une carte d'une autre rarete : pas de bonus Unique.
  const other = store.getAll('Cards').find((c) => refIdOf(c.Rarity) !== uni.id);
  run({ action: 'start', hours: 2, cardId: other.id }, { expedition: { active: true } });
  assert.equal(JSON.parse(user(id).ExpeditionTrip).unique, undefined);
});

await test('fiche joueur : lecture, ressources, XP, tablettes, exemplaire modifie puis supprime', () => {
  const id = ids[1];
  assert.equal(post('admin-player', { discordId: '1', userId: id }).status, 403);
  const g = post('admin-player', { discordId: ADMIN, userId: id });
  assert.equal(g.status, 200);
  assert.ok(g.json.fields.some((f) => f.key === 'Worms'));
  assert.ok(g.json.pulls.length > 0);
  const s = post('admin-player', { discordId: ADMIN, userId: id, action: 'set', fields: { Worms: 42, XP: 1000, DigPrestige: 2 }, tablets: { gold: 3, clay: 0, stone: 1 } });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(user(id).Worms, 42);
  assert.equal(user(id).Tablets, 4);
  assert.equal(JSON.parse(user(id).TabletStock).gold, 3);
  assert.ok(s.json.levels.profile > 1);
  assert.equal(post('admin-player', { discordId: ADMIN, userId: id, action: 'set', fields: { Pseudo: 'x' } }).json.error, 'field_not_editable');
  assert.equal(post('admin-player', { discordId: ADMIN, userId: id, action: 'set', fields: { Worms: -3 } }).json.error, 'invalid_value');
  const pull = g.json.pulls[0];
  const e = post('admin-player', { discordId: ADMIN, userId: id, action: 'pull', pullId: pull.pullId, changes: { finish: 'rainbow', quality: 'mint', edition: 'snow' } });
  assert.equal(e.status, 200);
  const p = store.get('Pulls', pull.pullId);
  assert.equal(p.Finish, 'rainbow'); assert.equal(p.Quality, 'mint'); assert.equal(p.Edition, 'snow');
  assert.equal(post('admin-player', { discordId: ADMIN, userId: ids[0], action: 'pull', pullId: pull.pullId, remove: true }).json.error, 'pull_not_found');
  assert.equal(post('admin-player', { discordId: ADMIN, userId: id, action: 'pull', pullId: pull.pullId, remove: true }).status, 200);
  assert.equal(store.get('Pulls', pull.pullId), null);
});

await test('gatchapon : les coffres donnent aussi des ressources bonus (plus sur les gros paliers)', () => {
  const id = ids[0];
  post('admin-settings', { discordId: ADMIN, action: 'set', values: { ChestExtraLoot: [{ key: 'worms', chance: 1, min: 4, max: 4 }, { key: 'tabletStone', chance: 1, min: 1, max: 1 }, { key: 'bait', chance: 0, min: 1, max: 1 }] } });
  assert.equal(post('admin-settings', { discordId: ADMIN, action: 'set', values: { ChestExtraLoot: [{ key: 'worms', chance: 2, min: 1, max: 1 }] } }).status, 400);
  store.update('Users', id, { KeyCount: 10, ChestBalls: JSON.stringify([1, 8]), ChestCount: 3 });
  const w0 = user(id).Worms || 0, t0 = JSON.parse(user(id).TabletStock || '{}').stone || 0, b0 = user(id).GoldBait || 0;
  const r = post('chests', { userId: id, action: 'open', tier: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const worms = r.json.items.find((x) => x.type === 'resource' && x.key === 'worms');
  assert.ok(worms && worms.amount >= 4, JSON.stringify(r.json.items));
  assert.ok(worms.label && worms.icon);
  assert.equal(user(id).Worms, w0 + worms.amount);
  assert.equal(JSON.parse(user(id).TabletStock).stone, t0 + 1);
  assert.equal(user(id).GoldBait || 0, b0, 'chance 0 : rien');
  // Palier 8 : quantite multipliee par la racine du facteur du palier.
  const r8 = post('chests', { userId: id, action: 'open', tier: 8 });
  assert.ok(r8.json.items.find((x) => x.key === 'worms').amount > 4);
  // Ancienne ouverture directe.
  const rl = post('chests', { userId: id, action: 'open' });
  assert.ok(rl.json.extras.some((x) => x.key === 'worms'));
});

await test('jardin : nouvelles graines debloquees par niveau, recoltes, engrais partout, reglage des graines', () => {
  const id = ids[1];
  post('admin-settings', { discordId: ADMIN, action: 'set', values: { GardenWiltHours: 0 } });
  store.update('Users', id, { GardenPlots: '[]', GardenExtraPlots: 0, StardustCount: 100000, GardenXP: 0, CatFish: 0, BoneCount: 0, DinoPoop: 5 });
  let st = post('garden', { userId: id, action: 'status' }).json;
  const catnip = st.seeds.find((s) => s.key === 'catnip');
  assert.ok(catnip && catnip.locked && catnip.level === 2);
  assert.equal(post('garden', { userId: id, action: 'plant', seed: 'catnip' }).json.error, 'seed_locked');
  store.update('Users', id, { GardenXP: 100000 });
  st = post('garden', { userId: id, action: 'status' }).json;
  assert.ok(st.seeds.every((s) => !s.locked));
  post('garden', { userId: id, action: 'plant', seed: 'catnip', plot: 0 });
  post('garden', { userId: id, action: 'plant', seed: 'bone', plot: 1 });
  post('garden', { userId: id, action: 'plant', seed: 'mushroom', plot: 2 });
  // Caca partout : toutes les parcelles qui poussent.
  const f = post('garden', { userId: id, action: 'fertilize' });
  assert.equal(f.json.fertilized, 3);
  assert.equal(user(id).DinoPoop, 2);
  const plots = JSON.parse(user(id).GardenPlots).map((p) => (p ? { ...p, plantedAt: p.plantedAt - 30 * 86400 } : p));
  store.update('Users', id, { GardenPlots: JSON.stringify(plots) });
  const h = post('garden', { userId: id, action: 'harvest' }).json;
  const it = (seed) => h.items.find((x) => x.seed === seed);
  assert.ok(it('catnip').catFish >= 4, 'herbe a chat avec engrais : poissons doubles');
  assert.ok(it('bone').bones >= 2);
  assert.ok(it('mushroom').dust >= 40);
  assert.equal(user(id).CatFish, h.gained.catFish);
  assert.equal(user(id).BoneCount, h.gained.bones);
  // Reglage : prix et retrait.
  post('admin-settings', { discordId: ADMIN, action: 'set', values: { GardenSeeds: [{ key: 'bone', active: false }, { key: 'catnip', cost: 5 }] } });
  st = post('garden', { userId: id, action: 'status' }).json;
  assert.ok(!st.seeds.some((s) => s.key === 'bone'));
  assert.equal(st.seeds.find((s) => s.key === 'catnip').cost, 5 * st.plantCost);
  assert.ok(st.seeds.some((s) => s.key === 'mix'));
});

await test('outils admin : les requetes passent le controle du jeton (joueur vise en targetUserId)', async () => {
  const { issueToken, authorize } = await import('../src/native/auth.js');
  const me = store.getAll('Users').find((u) => String(u.DiscordId) === ADMIN);
  const other = store.getAll('Users').find((u) => u.id !== me.id);
  const token = issueToken(store, me);
  const pass = (body) => authorize({ token, body, query: {} });
  // Ce que le site envoie (admin-player.js, admin-cosmetics.js, admin-rewards.js).
  assert.equal(pass({ discordId: ADMIN, action: 'get', targetUserId: other.id }), null);
  assert.equal(pass({ discordId: ADMIN, action: 'grant', key: 'x', targetUserId: other.id }), null);
  assert.equal(pass({ discordId: ADMIN, action: 'gift', userIds: [other.id, me.id], rewards: [] }), null);
  // L'ancienne forme (userId d'un autre joueur) est bien refusee : d'ou l'erreur auth_forbidden.
  assert.equal(pass({ discordId: ADMIN, action: 'get', userId: other.id }).json.error, 'auth_forbidden');
  // Et la route lit bien targetUserId.
  const r = post('admin-player', { discordId: ADMIN, action: 'get', targetUserId: other.id });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.userId, other.id);
});

await test('discord : adresse et modeles reglables, code annonce sur le serveur et dans le calendrier', async () => {
  // Faux Discord : on capture ce qui partirait.
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 204 }; };
  const flush = () => new Promise((r) => setTimeout(r, 10));
  try {
    const d = (body) => post('admin-discord', { discordId: ADMIN, ...body });
    assert.equal(post('admin-discord', { discordId: '1' }).status, 403);
    assert.equal(d({ action: 'save', webhook: 'https://exemple.com/x' }).json.error, 'invalid_webhook');
    const hook = 'https://discord.com/api/webhooks/123456/abcDEF_-x';
    let st = d({ action: 'save', webhook: hook, templates: { code: { title: '📣 {code} pour {label}', text: '{rewards}', color: '#123456' } } }).json;
    assert.equal(st.webhook.source, 'admin');
    assert.ok(!st.webhook.masked.includes('abcDEF'), 'adresse masquee');
    assert.equal(st.templates.find((t) => t.key === 'code').title, '📣 {code} pour {label}');
    const t = now();
    const c = admin({ action: 'createCode', code: 'ANNONCE1', label: 'Soirée', announce: true, expiresAt: t + 3600, rewards: [{ type: 'resource', key: 'booster', n: 2 }] });
    assert.equal(c.status, 200);
    assert.equal(c.json.created.announced, true);
    await flush();
    const msg = sent.find((x) => x.url === hook);
    assert.ok(msg, 'message parti vers le webhook');
    assert.equal(msg.body.embeds[0].title, '📣 ANNONCE1 pour Soirée');
    assert.match(msg.body.embeds[0].description, /\+2 jetons booster/);
    assert.equal(msg.body.embeds[0].color, 0x123456);
    // Calendrier : le code annonce apparait avec son code, un autre sans.
    admin({ action: 'createCode', code: 'SECRET1', label: 'Discret', expiresAt: t + 3600, rewards: [{ type: 'resource', key: 'key', n: 1 }] });
    const res = { status: 200, json: { events: [] } };
    native.afterWorkflow('event-calendar', { body: {}, query: {} }, res);
    const ev = res.json.events.find((e) => e.label === 'Soirée'), hidden = res.json.events.find((e) => e.label === 'Discret');
    assert.equal(ev.code, 'ANNONCE1');
    assert.match(ev.rewards[0].label, /jetons booster/);
    assert.equal(hidden.code, undefined);
    // Annoncer apres coup, modele desactive : rien ne part mais le code est public.
    d({ action: 'save', templates: { code: { enabled: false } } });
    sent.length = 0;
    const u = admin({ action: 'updateCode', code: 'SECRET1', announce: true });
    assert.equal(u.json.posted, false);
    await flush();
    assert.equal(sent.length, 0);
    assert.equal(u.json.codes.find((x) => x.code === 'SECRET1').announced, true);
    // Message libre.
    d({ action: 'send', message: { title: 'Coucou', text: 'Soirée ce soir', color: '#ff0000' } });
    await flush();
    assert.equal(sent.at(-1).body.embeds[0].title, 'Coucou');
    assert.equal(d({ action: 'send', message: {} }).json.error, 'empty_message');
  } finally { globalThis.fetch = realFetch; }
});

console.log(`\n${passed} tests passes`);
store.db.close();
clean();
