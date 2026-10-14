// Evenements saisonniers (2026-10-15) : Halloween, Noel, Nouvel an,
// Saint-Valentin, Paques, Poisson d'avril, Fete de la musique. Pendant
// chacun : theme du site (html[data-season]), edition limitee de
// l'evenement (editions.js), cadeau du jour (avec un "sort" possible a
// Halloween et le 1er avril), trouvailles saisonnieres en jouant (recolte,
// peche, grille de fouille) et, a Halloween et Noel, un boss commun.
//   POST /webhook/seasonal { userId, action: 'status' | 'claim' }

import { now, ok, fail, userById, parisDay } from './common.js';
import { setting } from './settings.js';
import { parisEpoch } from './daily.js';
import { addFeed } from './feed.js';
import { addShards } from './comfort.js';

export const schema = {
  Users: { SeasonTreatDay: { type: 'Text' }, SeasonDropDay: { type: 'Text' }, SeasonDropCount: { type: 'Numeric' } }
};

// Paques (calendrier gregorien) : 'MM-JJ'.
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
const md = (d) => d.toISOString().slice(5, 10);
const shift = (d, days) => new Date(d.getTime() + days * 86400000);

// windows(year) : plages [debut, fin] en 'MM-JJ' (fin incluse).
export const SEASONS = [
  { key: 'newyear', label: 'Nouvel an', icon: '🎆', edition: 'firework', windows: () => [['12-31', '12-31'], ['01-01', '01-02']],
    drop: { icon: '🎆', name: 'un pétard porte-bonheur' }, treat: 'Le feu d’artifice du jour' },
  { key: 'valentine', label: 'Saint-Valentin', icon: '💘', edition: 'heart', windows: () => [['02-10', '02-15']],
    drop: { icon: '💌', name: 'une lettre d’amour' }, treat: 'Le billet doux du jour' },
  { key: 'easter', label: 'Pâques', icon: '🐣', edition: 'pastel', windows: (y) => { const e = easter(y); return [[md(shift(e, -3)), md(shift(e, 1))]]; },
    drop: { icon: '🥚', name: 'un œuf en chocolat' }, treat: 'La chasse aux œufs du jour' },
  { key: 'aprilfools', label: 'Poisson d’avril', icon: '🐟', edition: 'prank', windows: () => [['04-01', '04-01']], trick: 0.3,
    drop: { icon: '🐟', name: 'un poisson en papier' }, treat: 'La farce du jour' },
  { key: 'summer', label: 'Fête de la musique', icon: '🎶', edition: 'solar', windows: () => [['06-19', '06-23']],
    drop: { icon: '🎵', name: 'une note de musique' }, treat: 'Le concert du jour' },
  { key: 'halloween', label: 'Halloween', icon: '🎃', edition: 'cursed', windows: () => [['10-24', '11-01']], trick: 0.2,
    drop: { icon: '🎃', name: 'une citrouille' }, treat: 'Un bonbon ou un sort ?',
    boss: { name: 'Le Roi Citrouille 🎃', hp: 600, reward: 2 } },
  { key: 'christmas', label: 'Noël', icon: '🎄', edition: 'snow', windows: () => [['12-18', '12-30']],
    drop: { icon: '❄️', name: 'un flocon magique' }, treat: 'La case du calendrier de l’Avent',
    boss: { name: 'Le Bonhomme de neige géant ☃️', hp: 800, reward: 3 } }
];

function windowAt(season, day) {
  const year = Number(day.slice(0, 4)), mmdd = day.slice(5);
  for (const [from, to] of season.windows(year)) if (mmdd >= from && mmdd <= to) return { year, to };
  return null;
}
// Evenement saisonnier en cours (ou null).
export function currentSeason(store, day = parisDay(0)) {
  if (!setting(store, 'SeasonalEventsEnabled')) return null;
  for (const s of SEASONS) {
    const w = windowAt(s, day);
    if (w) return { ...s, year: w.year, id: `${s.key}-${w.year}`, endsAt: parisEpoch(`${w.year}-${w.to}`, 0) + 86400 };
  }
  return null;
}
export function publicSeason(store) {
  const s = currentSeason(store);
  return s ? { key: s.key, label: s.label, icon: s.icon, edition: s.edition, endsAt: s.endsAt, treat: s.treat, drop: s.drop, boss: s.boss ? s.boss.name : null } : null;
}

// ------------------------------------------------------------------ cadeau du jour
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function draw(season, day) {
  // Noel : un booster garanti le 24 et le 25 decembre.
  if (season.key === 'christmas' && (day.endsWith('12-24') || day.endsWith('12-25'))) return { kind: 'booster', n: 1, label: '🎁 1 booster sous le sapin' };
  if (season.trick && Math.random() < season.trick) { const n = rnd(20, 50); return { kind: 'trick', n, label: `🙀 Un sort ! Tu perds ${n} ✨` }; }
  const r = Math.random();
  if (r < 0.05) return { kind: 'booster', n: 1, label: '🎴 1 booster' };
  if (r < 0.15) return { kind: 'key', n: 1, label: '🔑 1 clé' };
  if (r < 0.35) return { kind: 'shards', n: 2, label: '🧩 2 fragments de booster' };
  const n = rnd(40, 120);
  return { kind: 'dust', n, label: `✨ ${n} poussières` };
}

function stateOf(store, user) {
  const s = publicSeason(store);
  return { season: s, claimedToday: !!s && user.SeasonTreatDay === `${s.key}:${parisDay(0)}` };
}

function handleSeasonal({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(stateOf(store, user));
  if (action !== 'claim') return fail('unknown_action');
  const season = currentSeason(store);
  if (!season) return fail('no_season');
  const day = parisDay(0);
  if (user.SeasonTreatDay === `${season.key}:${day}`) return fail('already_claimed', 400, stateOf(store, user));
  const reward = draw(season, day);
  const fields = { SeasonTreatDay: `${season.key}:${day}` };
  if (reward.kind === 'dust') fields.StardustCount = (Number(user.StardustCount) || 0) + reward.n;
  if (reward.kind === 'trick') fields.StardustCount = Math.max(0, (Number(user.StardustCount) || 0) - reward.n);
  if (reward.kind === 'key') fields.KeyCount = (Number(user.KeyCount) || 0) + reward.n;
  if (reward.kind === 'booster') fields.BoosterCount = (Number(user.BoosterCount) || 0) + reward.n;
  user = store.update('Users', user.id, fields);
  if (reward.kind === 'shards') addShards(store, user.id, reward.n);
  return ok({ ...stateOf(store, store.get('Users', user.id)), reward });
}

// ------------------------------------------------------------------ trouvailles en jouant
const DROP_EVENTS = new Set(['harvest', 'fish', 'board']);
const DROPS_PER_DAY = 3;
export function onEvents(store, events) {
  const season = currentSeason(store);
  if (!season) return [];
  const notices = [];
  const chance = setting(store, 'SeasonalDropChance');
  const done = new Set();
  for (const e of events) {
    if (!DROP_EVENTS.has(e.type) || done.has(e.userId) || Math.random() >= chance) continue;
    done.add(e.userId);
    const user = store.get('Users', e.userId);
    if (!user) continue;
    const day = parisDay(0);
    const count = user.SeasonDropDay === day ? Number(user.SeasonDropCount) || 0 : 0;
    if (count >= DROPS_PER_DAY) continue;
    const n = rnd(20, 60);
    store.update('Users', user.id, { SeasonDropDay: day, SeasonDropCount: count + 1, StardustCount: (Number(user.StardustCount) || 0) + n });
    notices.push({ userId: user.id, kind: 'season', icon: season.drop.icon, label: `${season.label} : tu trouves ${season.drop.name} ! +${n} ✨` });
  }
  return notices;
}

// ------------------------------------------------------------------ boss saisonnier
const BOSS_KEY = 'seasonBoss';
let checked = null;
export function beforeRequest({ store }) {
  const day = parisDay(0);
  if (checked === day || !store.tables.has('AppSettings') || !store.tables.has('CommunityBoss')) return;
  checked = day;
  const season = currentSeason(store);
  if (!season || !season.boss) return;
  const row = store.getAll('AppSettings').find((r) => r.Key === BOSS_KEY);
  if (row && row.Value === season.id) return;
  if (store.getAll('CommunityBoss').some((b) => b.Active)) return;
  store.create('CommunityBoss', { BossName: season.boss.name, MaxHp: season.boss.hp, CurrentHp: season.boss.hp, RewardBoosters: season.boss.reward, Active: true });
  if (row) store.update('AppSettings', row.id, { Value: season.id }); else store.create('AppSettings', { Key: BOSS_KEY, Value: season.id });
  addFeed(store, { kind: 'boss', icon: season.icon, text: `${season.label} : ${season.boss.name} attaque ! Rendez-vous dans Communauté > Boss.` });
}

export function _reset() { checked = null; }
export const routes = { 'POST seasonal': handleSeasonal };
