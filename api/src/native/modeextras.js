// Modes de jeu, suite (2026-10-15) :
//  - mode Chaos : chaque jour une regle tiree au hasard (surcouche des
//    reglages, rien n'est ecrit en base ; fonctionnalites fermees du jour
//    via features.js) ;
//  - succes de mode (achievements.js, visibles sur le profil) ;
//  - changement de mode programme + preavis (bandeau ModeNoticeHours avant) ;
//  - classement Hard : points gagnes uniquement pendant une periode Hard,
//    remis a zero a chaque passage en Hard ;
//  - parapluie (boutique) : protege de l'usure du mode Hard (modeperks.js).
//   POST /webhook/admin-mode-schedule { discordId, action: 'status' | 'set' | 'clear', preset?, at? }
//   GET  /webhook/hard-leaderboard ?userId=

import { refId, now, ok, fail, isAdmin, parisDay, parseJson } from './common.js';
import { setting, setOverlay } from './settings.js';
import { currentMode, applyPreset, lastPreset, PRESET_INFO } from './presets.js';
import { unlockAchievement } from './achievements.js';
import { addFeed } from './feed.js';

export const schema = {
  Users: {
    ModeStreak: { type: 'Text' }, ModeStats: { type: 'Text' }, ChaosSeen: { type: 'Text' },
    HardSession: { type: 'Numeric' }, HardScore: { type: 'Numeric' }, UmbrellaUntil: { type: 'Numeric' }
  }
};

// ------------------------------------------------------------------ mode Chaos
const half = (v) => Math.max(1, Math.round(v / 2));
const times = (k) => (v) => Math.round(v * k * 100) / 100;
export const CHAOS_RULES = [
  { key: 'fishFrenzy', icon: '🎣', label: 'Frénésie de pêche : pêche à moitié prix et deux fois plus de prises récompensées, mais le jardin est fermé', settings: { FishingCost: half, FishingFullRewardsPerDay: times(2) }, off: ['garden'] },
  { key: 'dustRain', icon: '✨', label: 'Pluie d’étoiles : les doublons rapportent deux fois plus de poussières', settings: { DuplicateDustCommon: times(2), DuplicateDustOther: times(2) } },
  { key: 'freeMarket', icon: '🤝', label: 'Marché libre : aucune taxe d’échange ni d’enchère, mais le marché noir est fermé', settings: { TradeTaxPerCard: () => 0, AuctionTaxPct: () => 0 }, off: ['blackMarket'] },
  { key: 'shardStorm', icon: '🧩', label: 'Tempête de fragments : un booster coûte deux fois moins de fragments', settings: { ShardsPerBooster: (v) => Math.max(2, Math.round(v / 2)), ShardsDailyCap: times(2) } },
  { key: 'chestSale', icon: '🧰', label: 'Soldes des coffres : coffres à moitié prix, mais boosters de la boutique deux fois plus chers', settings: { ChestCost: half, BoosterShopPrice: times(2) } },
  { key: 'pityParty', icon: '🍀', label: 'Fête de la chance : pity doublée, mais la boutique de boosters est fermée', settings: { RarityPityMultiplier: times(2) }, off: ['boosterShop'] },
  { key: 'rushHour', icon: '⚡', label: 'Heure de pointe : expéditions accélérées, météo et os du chien gratuits', settings: { ExpeditionRushCost: () => 0, WeatherRerollCost: () => 0, DogBoneCost: half } },
  { key: 'secrets', icon: '🔒', label: 'Nuit des secrets : succès secrets triplés en poussières', settings: { HiddenAchievementDust: times(3) } },
  { key: 'blackout', icon: '🌑', label: 'Panne générale : fouille et pêche fermées, mais doublons ×1,5', settings: { DuplicateDustCommon: times(1.5), DuplicateDustOther: times(1.5) }, off: ['dig', 'fishing'] }
];
// Regle du jour : tiree par le jour (la meme pour tout le monde), jamais deux fois de suite.
function ruleIndex(day) {
  let h = 0;
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % CHAOS_RULES.length;
}
export function chaosRuleFor(day = parisDay(0)) {
  let i = ruleIndex(day);
  if (i === ruleIndex(parisDay(-1, Date.parse(day + 'T12:00:00Z')))) i = (i + 1) % CHAOS_RULES.length;
  return CHAOS_RULES[i];
}
export function chaosRule(store) {
  return currentMode(store).key === 'chaos' ? chaosRuleFor() : null;
}
// Surcouche des reglages : seulement en Chaos, seulement les cles de la regle.
setOverlay((store, key, raw) => {
  const rule = chaosRule(store);
  const fn = rule && rule.settings[key];
  return fn ? fn(raw()) : undefined;
});

// ------------------------------------------------------------------ succes de mode
const today = () => parisDay(0);
function bumpStat(store, user, key, n = 1) {
  const stats = parseJson(user.ModeStats, {});
  stats[key] = (Number(stats[key]) || 0) + n;
  store.update('Users', user.id, { ModeStats: JSON.stringify(stats) });
  return stats[key];
}
// Serie de jours joues dans le meme mode (Cool, Hard...).
function touchStreak(store, user, mode) {
  const s = parseJson(user.ModeStreak, {});
  if (s.day === today()) return s.mode === mode ? s.n : 0;
  const n = s.mode === mode && s.day === parisDay(-1) ? (Number(s.n) || 0) + 1 : 1;
  store.update('Users', user.id, { ModeStreak: JSON.stringify({ mode, day: today(), n }) });
  return n;
}

// Points du classement Hard par evenement.
const HARD_POINTS = { boosterOpened: 2, fish: 1, board: 3, harvest: 1, bossAttack: 2, expedition: 3, tradeDone: 2, guess: 1, craft: 1, chestOpened: 2 };
function hardSession(store) {
  const last = lastPreset(store);
  return last && last.key === 'hard' ? Number(last.at) || 1 : 1;
}

export function onEvents(store, events) {
  const notices = [];
  const mode = currentMode(store).key;
  const push = (n) => { if (n) notices.push(n); };
  const seen = new Set();
  for (const e of events) {
    let user = store.get('Users', e.userId);
    if (!user) continue;
    // Une fois par joueur et par requete : series et regle du Chaos.
    if (!seen.has(e.userId)) {
      seen.add(e.userId);
      const n = touchStreak(store, user, mode);
      if (mode === 'cool' && n >= 7) push(unlockAchievement(store, user.id, 'modeCool7'));
      if (mode === 'hard' && n >= 7) push(unlockAchievement(store, user.id, 'modeHard7'));
      if (mode === 'chaos') {
        user = store.get('Users', e.userId);
        const list = parseJson(user.ChaosSeen, []);
        const rule = chaosRuleFor().key;
        if (!list.includes(rule)) { list.push(rule); store.update('Users', user.id, { ChaosSeen: JSON.stringify(list) }); }
        if (list.length >= 5) push(unlockAchievement(store, user.id, 'modeChaos5'));
      }
    }
    user = store.get('Users', e.userId);
    if (mode === 'chill' && e.type === 'boosterOpened' && bumpStat(store, user, 'chillOpen', e.n) >= 50) push(unlockAchievement(store, user.id, 'modeChill50'));
    if (mode === 'hard' && e.type === 'bossAttack' && bumpStat(store, store.get('Users', e.userId), 'hardBoss', e.n) >= 10) push(unlockAchievement(store, user.id, 'modeHardBoss'));
    // Classement Hard.
    if (mode === 'hard' && HARD_POINTS[e.type]) {
      user = store.get('Users', e.userId);
      const session = hardSession(store);
      const score = (Number(user.HardSession) === session ? Number(user.HardScore) || 0 : 0) + HARD_POINTS[e.type] * (Number(e.n) || 1);
      store.update('Users', user.id, { HardSession: session, HardScore: score });
    }
  }
  return notices;
}

// Medium : paris gagnes (reponse de l'ouverture de booster).
export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'open-pack' || response.status !== 200 || !response.json || !response.json.bet || !response.json.bet.won) return;
  const user = store.get('Users', Number((request.body || {}).userId));
  if (!user || currentMode(store).key !== 'medium') return;
  if (bumpStat(store, user, 'mediumBets') >= 5) {
    const n = unlockAchievement(store, user.id, 'modeMedium5');
    if (n) response.json.notices = [...(response.json.notices || []), { kind: n.kind, icon: n.icon, label: n.label }];
  }
}

function hardBoard(store, userId) {
  const session = hardSession(store);
  const active = currentMode(store).key === 'hard';
  const rows = store.getAll('Users').filter((u) => Number(u.HardSession) === session && (Number(u.HardScore) || 0) > 0)
    .sort((a, b) => (Number(b.HardScore) || 0) - (Number(a.HardScore) || 0));
  const rank = rows.findIndex((u) => u.id === Number(userId));
  return {
    active, since: session > 1 ? session : null,
    top: rows.slice(0, 10).map((u, i) => ({ rank: i + 1, userId: u.id, pseudo: u.Pseudo, score: Number(u.HardScore) || 0 })),
    me: rank >= 0 ? { rank: rank + 1, score: Number(rows[rank].HardScore) || 0 } : null,
    points: HARD_POINTS
  };
}

// ------------------------------------------------------------------ changement de mode programme
const SCHEDULE = 'modeSchedule';
function scheduleRow(store) {
  return store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === SCHEDULE) : null;
}
export function scheduled(store) {
  const row = scheduleRow(store);
  const v = row ? parseJson(row.Value, null) : null;
  return v && PRESET_INFO[v.key] ? v : null;
}
// Prochain changement connu dans les ModeNoticeHours : programme, ou fin du vote de la salle des machines.
let machineLeader = null;
export function setMachineLeader(fn) { machineLeader = fn; }
export function nextMode(store) {
  const hours = setting(store, 'ModeNoticeHours');
  if (!hours) return null;
  const t = now(), horizon = t + hours * 3600;
  const cur = currentMode(store).key;
  const s = scheduled(store);
  if (s && s.at <= horizon && s.key !== cur) return { key: s.key, ...PRESET_INFO[s.key], at: s.at, probable: false, source: 'admin' };
  const lead = machineLeader ? machineLeader(store) : null;
  if (lead && lead.winner && lead.closeAt <= horizon && lead.winner !== cur) return { key: lead.winner, ...PRESET_INFO[lead.winner], at: lead.closeAt, probable: true, source: 'machine' };
  return null;
}

let checked = 0;
export function beforeRequest({ store }) {
  const t = now();
  if (t - checked < 30 || !store.tables.has('AppSettings')) return;
  checked = t;
  const s = scheduled(store);
  if (!s || s.at > t) return;
  const row = scheduleRow(store);
  if (row) store.delete('AppSettings', row.id);
  if (currentMode(store).key === s.key) return;
  if (!applyPreset(store, s.key, s.by || 'programme').length) {
    addFeed(store, { kind: 'economy', icon: PRESET_INFO[s.key].icon, text: `Le jeu passe en mode ${PRESET_INFO[s.key].label} (changement programmé).` });
  }
}

function handleSchedule({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const action = body.action || 'status';
  const row = scheduleRow(store);
  if (action === 'set') {
    const at = Number(body.at) || 0;
    if (!PRESET_INFO[body.preset]) return fail('unknown_preset');
    if (at <= now()) return fail('invalid_date');
    const value = JSON.stringify({ key: body.preset, at, by: String(body.discordId) });
    if (row) store.update('AppSettings', row.id, { Value: value }); else store.create('AppSettings', { Key: SCHEDULE, Value: value });
  } else if (action === 'clear') { if (row) store.delete('AppSettings', row.id); }
  else if (action !== 'status') return fail('unknown_action');
  return ok({ scheduled: scheduled(store), next: nextMode(store) });
}

function handleHard({ store, query }) {
  return ok(hardBoard(store, query.userId));
}

export function _reset() { checked = 0; }
export const routes = { 'POST admin-mode-schedule': handleSchedule, 'GET hard-leaderboard': handleHard };
