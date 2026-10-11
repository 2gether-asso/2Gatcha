// Confort malgre moins de boosters (2026-10-11).
//  - Booster muri : chaque jour sans ouvrir de booster ajoute +1 point de
//    chance de finition speciale au prochain (RipenMaxPoints au plus). Le
//    bonus est consomme par l'ouverture suivante (boosts.js).
//  - Fragments de booster : les activites du quotidien (grille de fouille,
//    recolte, prise vide a la peche, expedition, devinette, coffre, echange)
//    donnent des fragments ; ShardsPerBooster fragments = 1 booster.
//    ShardsDailyCap fragments par jour au plus.
//  - Cosmetiques de progression : titres et cadres gagnes a force de jouer
//    (compteurs d'activite de progression.js).
//  - Heure doree : une heure par semaine (vendredi a dimanche, 18 h - 22 h),
//    annoncee la veille, finitions speciales x GoldenHourFinishMultiplier
//    (appliquee comme un evenement, events.js).
//  - Pluie de boosters : objectif commun de la semaine atteint -> chaque
//    joueur qui passe dans les 24 h recoit BoosterRainBoosters booster(s).

import { now, parisDay } from './common.js';
import { setting } from './settings.js';
import { counts } from './progression.js';
import { grantCosmetic } from './cosmetics.js';
import { weekKey } from './levels.js';
import { parisEpoch } from './daily.js';
import { addFeed } from './feed.js';

export const schema = {
  Users: { RipenSince: { type: 'Numeric' }, BoosterShards: { type: 'Numeric' }, ShardDay: { type: 'Text' }, ShardToday: { type: 'Numeric' }, RainClaimed: { type: 'Text' } }
};

const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// ------------------------------------------------------------------ booster muri
export function ripeness(store, user) {
  const since = Number(user && user.RipenSince) || 0;
  if (!since) return 0;
  return Math.min(setting(store, 'RipenMaxPoints'), Math.floor((now() - since) / 86400));
}

export function beforeWorkflow({ store, path, request }) {
  const body = request.body || {};
  if (path !== 'open-pack' || body.dryRun) return null;
  const user = store.get('Users', Number(body.userId));
  if (user) request._ripe = ripeness(store, user);
  return null;
}

// ------------------------------------------------------------------ heure doree
export function goldenWindow(at = Date.now()) {
  const monday = weekKey(at);
  const h = hash('golden:' + monday);
  const day = addDays(monday, 4 + (h % 3));
  const hour = 18 + ((h >>> 4) % 4);
  const start = parisEpoch(day, hour);
  return { day, hour, start, end: start + 3600 };
}
export function goldenState(store, at = now()) {
  if (!setting(store, 'GoldenHourEnabled')) return { enabled: false };
  let w = goldenWindow(at * 1000);
  if (w.end <= at) w = goldenWindow((at + 7 * 86400) * 1000);
  return { enabled: true, ...w, active: w.start <= at && at < w.end, multiplier: setting(store, 'GoldenHourFinishMultiplier') };
}

// ------------------------------------------------------------------ pluie de boosters
const RAIN = 'boosterRain';
function rainState(store) {
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === RAIN) : null;
  try { return row ? JSON.parse(row.Value) : null; } catch (e) { return null; }
}
// Appele quand l'objectif commun de la semaine est atteint (challenges.js).
export function startRain(store, id) {
  if (!setting(store, 'BoosterRainEnabled') || !store.tables.has('AppSettings')) return;
  const cur = rainState(store);
  if (cur && cur.id === id) return;
  const value = JSON.stringify({ id, at: now(), until: now() + 24 * 3600 });
  const row = store.getAll('AppSettings').find((r) => r.Key === RAIN);
  if (row) store.update('AppSettings', row.id, { Value: value }); else store.create('AppSettings', { Key: RAIN, Value: value });
  const n = setting(store, 'BoosterRainBoosters');
  addFeed(store, { kind: 'rain', icon: '🌧️', text: `Pluie de boosters ! L’objectif commun est atteint : passe sur le site dans les 24 h pour recevoir ${n} booster${n > 1 ? 's' : ''}.` });
}

// ------------------------------------------------------------------ fragments et cosmetiques
const SHARD_RULES = {
  board: (e) => (e.meta && e.meta.dog ? 0 : e.n), harvest: () => 1, 'fishCatch:nothing': (e) => e.n, expedition: () => 2,
  guess: () => 1, chestOpened: () => 1, tradeDone: () => 1, communityDig: () => 1
};
const MILESTONES = [
  { type: 'boosterOpened', n: 100, key: 'm-open-100', cos: 'title', label: 'Ouvreur compulsif' },
  { type: 'boosterOpened', n: 500, key: 'frame-opener', cos: 'frame', label: 'Cadre Déchireur' },
  { type: 'fish', n: 200, key: 'm-fish-200', cos: 'title', label: 'Loup de mer' },
  { type: 'fish', n: 1000, key: 'frame-sea', cos: 'frame', label: 'Cadre des abysses' },
  { type: 'board', n: 50, key: 'm-board-50', cos: 'title', label: 'Archéologue' },
  { type: 'board', n: 250, key: 'frame-dig', cos: 'frame', label: 'Cadre d’explorateur' },
  { type: 'harvest', n: 100, key: 'm-harvest-100', cos: 'title', label: 'Main verte' },
  { type: 'tradeDone', n: 25, key: 'm-trade-25', cos: 'title', label: 'Négociant' },
  { type: 'craft', n: 50, key: 'm-craft-50', cos: 'title', label: 'Artisan' },
  { type: 'disenchant', n: 200, key: 'm-decraft-200', cos: 'title', label: 'Recycleur' },
  { type: 'expedition', n: 30, key: 'm-expedition-30', cos: 'title', label: 'Explorateur aguerri' }
];
export const milestones = () => MILESTONES;

// Abonne du bus d'activite (apres progression.js, qui tient les compteurs).
export function onEvents(store, events) {
  const notices = [];
  const shards = new Map();
  for (const e of events) {
    const rule = SHARD_RULES[e.type];
    const n = rule ? rule(e) : 0;
    if (n > 0) shards.set(e.userId, (shards.get(e.userId) || 0) + n);
  }
  const today = parisDay(0);
  const per = setting(store, 'ShardsPerBooster');
  const cap = setting(store, 'ShardsDailyCap');
  for (const [uid, gainRaw] of shards) {
    const user = store.get('Users', uid);
    if (!user || !(per > 0)) continue;
    const done = user.ShardDay === today ? Number(user.ShardToday) || 0 : 0;
    const gain = cap > 0 ? Math.min(gainRaw, Math.max(0, cap - done)) : gainRaw;
    if (!gain) continue;
    let total = (Number(user.BoosterShards) || 0) + gain;
    const boosters = Math.floor(total / per);
    total -= boosters * per;
    store.update('Users', uid, { BoosterShards: total, ShardDay: today, ShardToday: done + gain, ...(boosters ? { BoosterCount: (Number(user.BoosterCount) || 0) + boosters } : {}) });
    notices.push(boosters
      ? { userId: uid, kind: 'shard', icon: '🧩', label: `${per} fragments réunis : +${boosters} booster !` }
      : { userId: uid, kind: 'shard', icon: '🧩', label: `+${gain} fragment${gain > 1 ? 's' : ''} de booster (${total}/${per})` });
  }
  // Cosmetiques de progression.
  const touched = new Set(events.map((e) => e.userId));
  for (const uid of touched) {
    const user = store.get('Users', uid);
    if (!user) continue;
    const c = counts(user);
    for (const m of MILESTONES) {
      if ((Number(c[m.type]) || 0) < m.n) continue;
      if (grantCosmetic(store, uid, m.key, { type: m.cos, label: m.label })) notices.push({ userId: uid, kind: 'cosmetic', icon: '🎨', label: `Nouveau ${m.cos === 'frame' ? 'cadre' : 'titre'} : « ${m.label} » (à équiper dans la boutique)` });
    }
  }
  return notices;
}

// ------------------------------------------------------------------ apres les workflows
export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  const json = response.json;
  if (path === 'open-pack') {
    const body = request.body || {};
    if (body.dryRun || !Array.isArray(json.cards)) return;
    if (request._ripe) json.ripened = request._ripe;
    store.update('Users', Number(body.userId), { RipenSince: now() });
    return;
  }
  if (path !== 'booster-status') return;
  let user = store.get('Users', Number((request.query || {}).userId));
  if (!user) return;
  if (!user.RipenSince) user = store.update('Users', user.id, { RipenSince: now() });
  const pts = ripeness(store, user);
  json.ripeness = { points: pts, max: setting(store, 'RipenMaxPoints'), nextAt: pts < setting(store, 'RipenMaxPoints') ? (Number(user.RipenSince) || now()) + (pts + 1) * 86400 : null };
  json.shards = { count: Number(user.BoosterShards) || 0, per: setting(store, 'ShardsPerBooster') };
  json.golden = goldenState(store);
  // Pluie de boosters : une fois par pluie et par joueur.
  const rain = rainState(store);
  if (rain && now() < rain.until && user.RainClaimed !== String(rain.id) && setting(store, 'BoosterRainEnabled')) {
    const n = setting(store, 'BoosterRainBoosters');
    user = store.update('Users', user.id, { RainClaimed: String(rain.id), BoosterCount: (Number(user.BoosterCount) || 0) + n });
    json.rain = { boosters: n };
    if ('count' in json) json.count = user.BoosterCount;
  }
}
