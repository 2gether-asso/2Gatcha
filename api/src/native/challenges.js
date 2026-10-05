// Defis de la semaine et objectif commun (2026-10-05).
//
// Defis : chaque lundi, 5 defis tires au sort pour chaque joueur ; il en
// choisit 3. Chaque defi accompli rapporte des poussieres ; les 3 accomplis
// donnent un bonus (ChallengeBonusBoosters). Progression alimentee par le bus
// d'activite (activity.js), uniquement apres le choix.
//   POST /webhook/challenges { userId, action: 'status' | 'pick' | 'claim', keys?, key? }
//
// Objectif commun : un objectif par semaine pour toute la communaute
// (pecher, creuser, ouvrir...). Atteint : chaque participant recupere la
// recompense (CommunityGoalDust + CommunityGoalWorms).
//   POST /webhook/community-goal { userId, action: 'status' | 'claim' }

import { ok, fail, userById } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';

export const TEMPLATES = [
  { key: 'fish10', label: 'Pêcher 10 fois', type: 'fish', target: 10, dust: 120, icon: '🎣' },
  { key: 'fishChest', label: 'Pêcher 2 coffres', type: 'fishCatch:chest', target: 2, dust: 220, icon: '🧰' },
  { key: 'fishPart', label: 'Pêcher une pièce détachée', type: 'fishCatch:part', target: 1, dust: 200, icon: '🔩' },
  { key: 'board2', label: 'Terminer 2 grilles de fouille', type: 'board', target: 2, dust: 160, icon: '⛏️' },
  { key: 'treasure8', label: 'Dégager 8 trésors', type: 'treasure', target: 8, dust: 130, icon: '💎' },
  { key: 'open10', label: 'Ouvrir 10 boosters', type: 'boosterOpened', target: 10, dust: 100, icon: '🎁' },
  { key: 'repair1', label: 'Restaurer une carte', type: 'repair', target: 1, dust: 150, icon: '🛠️' },
  { key: 'fusion1', label: 'Fusionner une finition', type: 'fusion', target: 1, dust: 200, icon: '✨' },
  { key: 'craft2', label: 'Crafter 2 cartes', type: 'craft', target: 2, dust: 100, icon: '🔨' },
  { key: 'disenchant10', label: 'Décrafter 10 cartes', type: 'disenchant', target: 10, dust: 90, icon: '♻️' },
  { key: 'trade1', label: 'Réaliser un échange', type: 'tradeDone', target: 1, dust: 160, icon: '🔄' },
  { key: 'boss5', label: 'Envoyer 5 cartes au boss', type: 'bossAttack', target: 5, dust: 150, icon: '💀' },
  { key: 'chest2', label: 'Ouvrir 2 coffres', type: 'chestOpened', target: 2, dust: 130, icon: '🗝️' },
  { key: 'guess3', label: 'Trouver 3 cartes du jour', type: 'guess', target: 3, dust: 130, icon: '🔍' },
  { key: 'expedition2', label: 'Terminer 2 expéditions', type: 'expedition', target: 2, dust: 130, icon: '🧭' },
  { key: 'harvest4', label: 'Récolter 4 fois au jardin', type: 'harvest', target: 4, dust: 130, icon: '🌱' },
  { key: 'communityDig3', label: 'Donner 3 coups de pioche à la grande fouille', type: 'communityDig', target: 3, dust: 110, icon: '🏗️' }
];
const byKey = new Map(TEMPLATES.map((t) => [t.key, t]));

const GOALS = [
  { type: 'fish', label: 'Pêcher ensemble', unit: 'lancers', perPlayer: 15, icon: '🎣' },
  { type: 'dig', label: 'Creuser ensemble', unit: 'cases', perPlayer: 40, icon: '⛏️' },
  { type: 'boosterOpened', label: 'Ouvrir des boosters ensemble', unit: 'boosters', perPlayer: 12, icon: '🎁' },
  { type: 'treasure', label: 'Dégager des trésors ensemble', unit: 'trésors', perPlayer: 15, icon: '💎' },
  { type: 'harvest', label: 'Récolter ensemble', unit: 'récoltes', perPlayer: 8, icon: '🌱' }
];

export const schema = {
  WeeklyChallenges: {
    User: { type: 'Ref:Users' }, Week: { type: 'Text' }, Offered: { type: 'Text' }, Picked: { type: 'Text' },
    Progress: { type: 'Text' }, Claimed: { type: 'Text' }, BonusClaimed: { type: 'Bool' }
  },
  CommunityGoals: {
    Week: { type: 'Text' }, Type: { type: 'Text' }, Target: { type: 'Numeric' }, Progress: { type: 'Numeric' },
    Contrib: { type: 'Text' }, Claimed: { type: 'Text' }
  }
};

const parse = (v, def) => { try { const x = JSON.parse(v || ''); return x == null ? def : x; } catch (e) { return def; } };
function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }

// Fin de la semaine (dimanche 23:59:59, heure de Paris approximee par UTC+2).
function weekEndsAt(week) { return Math.floor(new Date(week + 'T00:00:00+02:00').getTime() / 1000) + 7 * 86400 - 1; }

function rowFor(store, userId, week = weekKey()) {
  let row = store.getAll('WeeklyChallenges').find((r) => r.User === userId && r.Week === week);
  if (!row) {
    const pool = [...TEMPLATES];
    const offered = [];
    let h = hash(`${userId}|${week}`);
    while (offered.length < 5 && pool.length) { offered.push(pool.splice(h % pool.length, 1)[0].key); h = hash(String(h)); }
    row = store.create('WeeklyChallenges', { User: userId, Week: week, Offered: JSON.stringify(offered), Picked: '[]', Progress: '{}', Claimed: '[]', BonusClaimed: false });
  }
  return row;
}

function challengeState(store, user) {
  const week = weekKey();
  const row = rowFor(store, user.id, week);
  const picked = parse(row.Picked, []), progress = parse(row.Progress, {}), claimed = parse(row.Claimed, []);
  const view = (key) => {
    const t = byKey.get(key);
    const p = Math.min(t.target, progress[key] || 0);
    return { key, label: t.label, icon: t.icon, target: t.target, progress: p, dust: t.dust, picked: picked.includes(key), done: p >= t.target, claimed: claimed.includes(key) };
  };
  const offered = parse(row.Offered, []).filter((k) => byKey.has(k)).map(view);
  const pickedViews = offered.filter((c) => c.picked);
  const allDone = pickedViews.length === 3 && pickedViews.every((c) => c.claimed);
  return {
    week, endsAt: weekEndsAt(week), offered, picksLeft: Math.max(0, 3 - picked.length),
    bonus: { boosters: setting(store, 'ChallengeBonusBoosters'), ready: allDone && !row.BonusClaimed, claimed: !!row.BonusClaimed },
    claimable: pickedViews.filter((c) => c.done && !c.claimed).length + (allDone && !row.BonusClaimed ? 1 : 0)
  };
}

function handleChallenges({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  const row = rowFor(store, user.id);
  if (action === 'pick') {
    const picked = parse(row.Picked, []);
    const offered = parse(row.Offered, []);
    const keys = (Array.isArray(body.keys) ? body.keys : [body.key]).map(String).filter((k) => offered.includes(k) && !picked.includes(k));
    if (!keys.length) return fail('invalid_pick');
    if (picked.length + keys.length > 3) return fail('too_many_picks');
    store.update('WeeklyChallenges', row.id, { Picked: JSON.stringify([...picked, ...keys]) });
  } else if (action === 'claim') {
    const st = challengeState(store, user);
    const claimed = parse(row.Claimed, []);
    let dust = 0, boosters = 0;
    for (const c of st.offered) if (c.picked && c.done && !c.claimed) { claimed.push(c.key); dust += c.dust; }
    const fields = { Claimed: JSON.stringify(claimed) };
    const pickedCount = st.offered.filter((c) => c.picked).length;
    if (pickedCount === 3 && st.offered.filter((c) => c.picked).every((c) => claimed.includes(c.key)) && !row.BonusClaimed) { fields.BonusClaimed = true; boosters = setting(store, 'ChallengeBonusBoosters'); }
    if (!dust && !boosters) return fail('nothing_to_claim');
    store.update('WeeklyChallenges', row.id, fields);
    const u = store.get('Users', user.id);
    store.update('Users', user.id, { StardustCount: (Number(u.StardustCount) || 0) + dust, BoosterCount: (Number(u.BoosterCount) || 0) + boosters });
    return ok({ ...challengeState(store, store.get('Users', user.id)), reward: { dust, boosters } });
  } else if (action !== 'status') return fail('unknown_action');
  return ok(challengeState(store, user));
}

// --- objectif commun -----------------------------------------------------
function goalFor(store, week = weekKey()) {
  let g = store.getAll('CommunityGoals').find((r) => r.Week === week);
  if (!g) {
    const tpl = GOALS[hash(week) % GOALS.length];
    const players = Math.max(3, store.getAll('Users').filter((u) => (Number(u.TotalPulls) || 0) > 0 || u.DiscordId).length);
    const target = Math.max(10, Math.round(tpl.perPlayer * players * setting(store, 'CommunityGoalScale') / 5) * 5);
    g = store.create('CommunityGoals', { Week: week, Type: tpl.type, Target: target, Progress: 0, Contrib: '{}', Claimed: '[]' });
  }
  return g;
}

function goalState(store, userId) {
  const g = goalFor(store);
  const tpl = GOALS.find((x) => x.type === g.Type) || GOALS[0];
  const contrib = parse(g.Contrib, {}), claimed = parse(g.Claimed, []);
  const users = new Map(store.getAll('Users').map((u) => [u.id, u]));
  const top = Object.entries(contrib).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, n]) => ({ userId: Number(id), pseudo: users.get(Number(id))?.Pseudo || '?', n }));
  const reached = (Number(g.Progress) || 0) >= (Number(g.Target) || 1);
  const mine = contrib[userId] || 0;
  return {
    week: g.Week, endsAt: weekEndsAt(g.Week), type: g.Type, label: tpl.label, unit: tpl.unit, icon: tpl.icon,
    target: Number(g.Target) || 0, progress: Math.min(Number(g.Progress) || 0, Number(g.Target) || 0), reached,
    participants: Object.keys(contrib).length, top, mine,
    reward: { dust: setting(store, 'CommunityGoalDust'), worms: setting(store, 'CommunityGoalWorms') },
    claimable: reached && mine > 0 && !claimed.includes(userId), claimed: claimed.includes(userId)
  };
}

function handleGoal({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if ((body.action || 'status') === 'claim') {
    const st = goalState(store, user.id);
    if (!st.claimable) return fail(st.reached ? 'nothing_to_claim' : 'goal_not_reached');
    const g = goalFor(store);
    store.update('CommunityGoals', g.id, { Claimed: JSON.stringify([...parse(g.Claimed, []), user.id]) });
    store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) + st.reward.dust, Worms: (Number(user.Worms) || 0) + st.reward.worms });
    return ok({ ...goalState(store, user.id), claimedNow: st.reward });
  }
  return ok(goalState(store, user.id));
}

export const routes = {
  'POST challenges': handleChallenges,
  'POST community-goal': handleGoal
};

// Abonne du bus d'activite.
export function onEvents(store, events) {
  const notices = [];
  const week = weekKey();
  const g = goalFor(store, week);
  let goalChanged = false;
  const contrib = parse(g.Contrib, {});
  const wasReached = (Number(g.Progress) || 0) >= (Number(g.Target) || 1);
  let progress = Number(g.Progress) || 0;
  for (const e of events) {
    if (e.type === g.Type) { progress += e.n; contrib[e.userId] = (contrib[e.userId] || 0) + e.n; goalChanged = true; }
    const row = store.getAll('WeeklyChallenges').find((r) => r.User === e.userId && r.Week === week);
    if (!row) continue;
    const picked = parse(row.Picked, []);
    const prog = parse(row.Progress, {});
    let changed = false;
    for (const key of picked) {
      const t = byKey.get(key);
      if (!t || t.type !== e.type || (prog[key] || 0) >= t.target) continue;
      prog[key] = Math.min(t.target, (prog[key] || 0) + e.n);
      changed = true;
      if (prog[key] >= t.target) notices.push({ userId: e.userId, kind: 'challenge', icon: t.icon, label: `Défi accompli : ${t.label}` });
    }
    if (changed) store.update('WeeklyChallenges', row.id, { Progress: JSON.stringify(prog) });
  }
  if (goalChanged) {
    store.update('CommunityGoals', g.id, { Progress: progress, Contrib: JSON.stringify(contrib) });
    if (!wasReached && progress >= (Number(g.Target) || 1)) {
      Object.keys(contrib).forEach((id) => notices.push({ userId: Number(id), kind: 'goal', icon: '🤝', label: 'Objectif commun atteint : viens récupérer ta récompense !' }));
    }
  }
  return notices;
}

export { challengeState, goalState, weekEndsAt };
