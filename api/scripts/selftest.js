// Test de fumee du moteur : base d'essai en memoire (jeu de donnees minimal)
// + appel des principaux endpoints, sans reseau. Verifie que chaque workflow
// s'execute jusqu'a sa reponse sans erreur de moteur.
//
//   npm test
//
// La validation complete se fait sur une copie des vraies donnees (voir
// README : "Verifier avant la bascule").

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { WorkflowRunner } from '../src/runtime.js';
import { config } from '../src/config.js';

// KEEP_DB=chemin : garde la base d'essai (pour lancer le serveur dessus).
const tmp = process.env.KEEP_DB || path.join(os.tmpdir(), `2gatcha-selftest-${process.pid}.sqlite`);
if (process.env.KEEP_DB) for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true });
const store = new Store(tmp, { lenient: true });
const now = Math.floor(Date.now() / 1000);

function seed(table, rows) {
  const cols = {};
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (k !== 'id') cols[k] = { type: 'Any', isFormula: false }; }));
  store.defineTable(table, cols);
  const t = store.table(table);
  rows.forEach((r, i) => { const id = r.id || i + 1; store.write(t, id, { ...r, id }); t.maxId = Math.max(t.maxId, id); });
}

seed('Rarities', [
  { Name: 'Commune', Key: 'commune', DropWeight: 70, Weight: 70, ColorHex: '#9aa0b4', SortOrder: 1, DisenchantValue: 5, CraftCost: 40 },
  { Name: 'Rare', Key: 'rare', DropWeight: 22, Weight: 22, ColorHex: '#3b82f6', SortOrder: 2, DisenchantValue: 20, CraftCost: 100 },
  { Name: 'Epique', Key: 'epique', DropWeight: 6, Weight: 6, ColorHex: '#a855f7', SortOrder: 3, DisenchantValue: 50, CraftCost: 400 },
  { Name: 'Legendaire', Key: 'legendaire', DropWeight: 2, Weight: 2, ColorHex: '#f59e0b', SortOrder: 4, DisenchantValue: 200, CraftCost: 1600 }
]);
seed('Finishes', [
  { Key: 'normal', Name: 'Normal', DropWeight: 900, DisenchantMultiplier: 1 },
  { Key: 'holo', Name: 'Holo', DropWeight: 60, DisenchantMultiplier: 2 },
  { Key: 'gold', Name: 'Dore', DropWeight: 25, DisenchantMultiplier: 3 },
  { Key: 'rainbow', Name: 'Arc-en-ciel', DropWeight: 5, DisenchantMultiplier: 10 }
]);
seed('Qualities', [
  { Key: 'damaged', Name: 'Abime', DropWeight: 50, DisenchantMultiplier: 1 },
  { Key: 'worn', Name: 'Use', DropWeight: 30, DisenchantMultiplier: 1 },
  { Key: 'good', Name: 'Bon', DropWeight: 15, DisenchantMultiplier: 1 },
  { Key: 'mint', Name: 'Parfait', DropWeight: 5, DisenchantMultiplier: 2 }
]);
seed('Extensions', [{ Name: 'Base', Key: 'base', Active: true, SortOrder: 1 }]);
const cards = [];
for (let i = 1; i <= 12; i++) cards.push({ Name: `Carte ${i}`, Artist: 'Artiste', Rarity: 1 + (i % 4), Extension: 1, Active: true, Image: ['L', i], IsPromo: false, IsSecret: false, MaxSerial: 0 });
cards.push({ Name: 'Pepper', Artist: 'Asso', Rarity: 4, Extension: 1, Active: true, Image: ['L', 99], IsPromo: true, IsVault: true });
seed('Cards', cards);
seed('Users', [
  { Pseudo: 'Helldwin', DiscordId: '785223211730075709', BoosterCount: 5, StardustCount: 1000, XP: 120, KeyCount: 1, CreatedAt: now - 86400, TotalPulls: 3, PullsSinceTopRarity: 0, DigEnergy: 5, BoneCount: 1 },
  { Pseudo: 'Autre', DiscordId: '111', BoosterCount: 1, StardustCount: 10, XP: 0, CreatedAt: now }
]);
seed('Pulls', [
  { User: 1, Card: 1, ObtainedAt: now - 500, SerialNumber: 1, Finish: 'normal', Quality: 'mint', BatchId: 'b1' },
  { User: 1, Card: 1, ObtainedAt: now - 400, SerialNumber: 2, Finish: 'normal', Quality: 'worn', BatchId: 'b1' },
  { User: 1, Card: 2, ObtainedAt: now - 300, SerialNumber: 1, Finish: 'holo', Quality: 'good', BatchId: 'b1' },
  { User: 2, Card: 3, ObtainedAt: now - 200, SerialNumber: 1, Finish: 'normal', Quality: 'damaged', BatchId: 'b2' }
]);
seed('Config', [{ PityThreshold: 50, DigMaxEnergy: 5, DigRegenSeconds: 60 }]);
for (const t of ['EventCodes', 'CodeRedemptions', 'Trades', 'DailyQuests', 'WeeklyQuests', 'BoosterInventory', 'BadgeCatalog', 'UserBadges', 'BingoGrids', 'BingoClaims', 'BlackMarketOffers', 'CommunityBoss', 'BossContributions', 'Wishlist', 'ProfileShowcase', 'GuildChestDeposits', 'GuildChestClaims', 'LevelRewards', 'VaultRewards']) seed(t, []);

const runner = new WorkflowRunner({ store, overrides: config.overrides, log: { error: (m) => lastErrors.push(m) } });
let lastErrors = [];
const workflows = new Map();
for (const f of fs.readdirSync(config.workflowsDir).filter((x) => x.endsWith('.json'))) {
  const wf = JSON.parse(fs.readFileSync(path.join(config.workflowsDir, f), 'utf8'));
  const hook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  workflows.set(hook.parameters.path, wf);
}

async function call(hookPath, { body = {}, query = {} } = {}) {
  lastErrors = [];
  const wf = workflows.get(hookPath);
  const t = Date.now();
  const { responded, done } = runner.run(wf, { headers: {}, params: {}, query, body, webhookUrl: '', executionMode: 'production' });
  const resp = await responded;
  await done;
  return { ...resp, ms: Date.now() - t, errors: lastErrors };
}

const CASES = [
  ['cards', { query: {} }],
  ['extensions', { query: {} }],
  ['collection', { query: { userId: '1' } }],
  ['booster-status', { query: { userId: '1' } }],
  ['recent-pulls', { query: {} }],
  ['leaderboard', { query: {} }],
  ['public-profile', { query: { pseudo: 'Helldwin' } }],
  ['pull-log', { query: { userId: '1' } }],
  ['achievements', { query: { userId: '1' } }],
  ['users', { query: {} }],
  ['site-banner', { query: {} }],
  ['unlock-config', { query: {} }],
  ['event-calendar', { query: {} }],
  ['daily-wheel', { body: { userId: 1, action: 'status' } }],
  ['daily-wheel', { body: { userId: 1, action: 'spin' } }],
  ['daily-wheel', { body: { userId: 1, action: 'spin' } }],
  ['dig', { body: { userId: 1, action: 'status' } }],
  ['dig', { body: { userId: 1, action: 'dig', tileIndex: 0 } }],
  ['dig', { body: { userId: 1, action: 'useBone' } }],
  ['guess-card', { body: { userId: 1, action: 'status' } }],
  ['expedition', { body: { userId: 1, action: 'start', hours: 2, cardId: 1 } }],
  ['expedition', { body: { userId: 1, action: 'claim' } }],
  ['open-pack', { body: { userId: 1, extensionId: 1, discordId: '785223211730075709', dryRun: true } }],
  ['open-pack', { body: { userId: 1, extensionId: 1 } }],
  ['quests', { body: { userId: 1, action: 'status' } }],
  ['quests', { body: { userId: 1, action: 'status' } }],
  ['weekly-quests', { body: { userId: 1, action: 'status' } }],
  ['level-rewards', { body: { userId: 1, action: 'status' } }],
  ['craft', { body: { userId: 1, cardId: 5 } }],
  ['disenchant', { body: { userId: 1, cardId: 1, finish: 'normal', quality: 'worn' } }],
  ['trade', { body: { userId: 1, action: 'create', fromUserId: 1, toPseudo: 'Autre', offeredCardId: 2, offeredPullId: 3, requestedCardId: 3 } }],
  ['trade', { body: { userId: 2, action: 'list' } }],
  ['wishlist', { body: { userId: 1, action: 'list' } }],
  ['showcase', { body: { userId: 1, action: 'get' } }],
  ['badges', { body: { userId: 1, action: 'list' } }],
  ['bingo', { body: { userId: 1, action: 'status' } }],
  ['guild-chest', { body: { userId: 1, action: 'status' } }],
  ['black-market', { body: { userId: 1, action: 'list' } }],
  ['community-boss', { body: { userId: 1, action: 'status' } }],
  ['vault', { body: { userId: 1, action: 'status' } }],
  ['update-pseudo', { body: { userId: 1, pseudo: 'Helldwin2' } }],
  ['redeem-code', { body: { userId: 1, code: 'NOPE' } }]
];

let failures = 0;
for (const [p, args] of CASES) {
  const r = await call(p, args);
  const engineError = r.errors.length > 0 || (r.status === 500);
  if (engineError) failures++;
  const preview = r.raw ? `<binaire ${r.raw.length} o>` : JSON.stringify(r.json).slice(0, 110);
  console.log(`${engineError ? 'FAIL' : ' ok '} ${p.padEnd(16)} ${String(r.status).padEnd(4)} ${String(r.ms).padStart(4)}ms ${preview}`);
  r.errors.forEach((e) => console.log('       ' + e.split('\n').slice(0, 3).join('\n       ')));
}
const u = store.get('Users', 1);
console.log(`\nUtilisateur 1 apres les tests : boosters=${u.BoosterCount} poussieres=${u.StardustCount} XP=${u.XP} pseudo=${u.Pseudo}`);
console.log(`Pulls : ${store.getAll('Pulls').length} lignes`);
if (process.env.KEEP_DB) {
  // Une petite image de test pour /webhook/image?id=1.
  store.putAttachment(1, 'carte.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"><rect width="30" height="40" fill="#8b5cf6"/></svg>'));
}
store.db.close();
if (!process.env.KEEP_DB) for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true });
console.log(failures ? `\n${failures} echec(s).` : '\nTout est passe.');
process.exit(failures ? 1 : 0);
