// Boss communautaire :
//   POST /webhook/boss-attack  { userId, pullIds: [...] }   attaque en salve
//   GET  /webhook/boss-leaderboard?userId=...                classement + regles
//
// Attaque (refonte 2026-10-04) : le joueur choisit les exemplaires PRECIS
// qu'il sacrifie (pullId), jusqu'a 10 a la fois. Chaque carte a sa propre
// force : valeur de base de sa rarete (DisenchantValue) x multiplicateur de
// finition x multiplicateur d'etat ; la salve entiere est multipliee par un
// bonus qui grandit avec le nombre de cartes engagees. Les regles sont
// renvoyees au site, qui affiche les degats exacts AVANT de valider.
// L'ancienne attaque du workflow community-boss (une carte, exemplaire au
// hasard) reste disponible ; le bonus du coup final s'y applique aussi.

import { refId, now, ok, fail, userById } from './common.js';
import { setting } from './settings.js';

export const schema = {
  CommunityBoss: { Finisher: { type: 'Ref:Users' } },
  // Colonnes lues/ecrites par l'attaque (le schema les marquait 'a ajouter si absentes').
  BossContributions: { User: { type: 'Ref:Users' }, Boss: { type: 'Ref:CommunityBoss' }, Damage: { type: 'Numeric' }, Timestamp: { type: 'Numeric' } }
};

// Regles reglables dans l'admin (groupe "Boss").
export function bossRules(store) {
  return {
    finish: setting(store, 'BossFinishMultipliers'),
    quality: setting(store, 'BossQualityMultipliers'),
    volleyStep: setting(store, 'BossVolleyStep'),
    maxCards: setting(store, 'BossMaxCards')
  };
}
export const volleyMultiplier = (n, rules) => Math.round((1 + rules.volleyStep * Math.max(0, Math.min(n, rules.maxCards) - 1)) * 100) / 100;

const finisherBoosters = (store) => Math.max(0, setting(store, 'BossFinisherBoosters'));

function activeBoss(store) {
  return store.tables.has('CommunityBoss') ? store.getAll('CommunityBoss').find((b) => b.Active) : null;
}

// Fin du boss : recompense commune a chaque participant + bonus du coup final.
function defeatBoss(store, boss, finisherId) {
  store.update('CommunityBoss', boss.id, { Active: false, CurrentHp: 0, Finisher: finisherId });
  const reward = Number(boss.RewardBoosters) || 0;
  const contributors = new Set(store.getAll('BossContributions').filter((c) => refId(c.Boss) === boss.id).map((c) => refId(c.User)));
  if (reward > 0) {
    for (const uid of contributors) {
      const u = store.get('Users', uid);
      if (u) store.update('Users', uid, { BoosterCount: (Number(u.BoosterCount) || 0) + reward });
    }
  }
  const bonus = finisherBoosters(store);
  let finisher = store.get('Users', finisherId);
  if (bonus > 0 && finisher) finisher = store.update('Users', finisherId, { BoosterCount: (Number(finisher.BoosterCount) || 0) + bonus });
  return { rewardBoosters: reward, participants: contributors.size, finisherBonus: bonus > 0 ? { boosters: bonus, newBoosterCount: finisher ? finisher.BoosterCount : null } : null };
}

function handleAttack({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const boss = activeBoss(store);
  if (!boss) return fail('no_active_boss');
  const ids = [...new Set((Array.isArray(body.pullIds) ? body.pullIds : []).map(Number).filter(Boolean))];
  if (!ids.length) return fail('no_cards');
  const rules = bossRules(store);
  if (ids.length > rules.maxCards) return fail('too_many_cards', 400, { maxCards: rules.maxCards });

  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  const volley = volleyMultiplier(ids.length, rules);
  const details = [];
  for (const pullId of ids) {
    const pull = store.get('Pulls', pullId);
    if (!pull || refId(pull.User) !== user.id || pull.InVault) return fail('card_not_owned', 400, { pullId });
    const card = store.get('Cards', refId(pull.Card));
    if (!card) return fail('card_not_found', 400, { pullId });
    if (card.IsPromo) return fail('promo_not_donatable', 400, { pullId });
    if (pull.Insured || pull.Starred) return fail('insured_copy', 400, { pullId });
    const rarity = rarities.get(refId(card.Rarity));
    const base = Math.max(1, Number(rarity && rarity.DisenchantValue) || 0);
    const finish = pull.Finish || 'normal', quality = pull.Quality || 'damaged';
    const multiplier = (rules.finish[finish] || 1) * (rules.quality[quality] || 1);
    details.push({ pullId, cardId: card.id, name: card.Name, serialNumber: pull.SerialNumber ?? null, finish, quality, rarity: rarity ? rarity.Name : '', base, multiplier, damage: Math.round(base * multiplier * volley) });
  }

  const total = details.reduce((s, d) => s + d.damage, 0);
  const t = now();
  for (const d of details) {
    store.delete('Pulls', d.pullId);
    store.create('BossContributions', { User: user.id, Boss: boss.id, Damage: d.damage, Timestamp: t });
  }
  const newHp = Math.max(0, (Number(boss.CurrentHp) || 0) - total);
  let outcome = { rewardBoosters: 0, finisherBonus: null };
  if (newHp <= 0) outcome = defeatBoss(store, boss, user.id);
  else store.update('CommunityBoss', boss.id, { CurrentHp: newHp });

  const myTotal = store.getAll('BossContributions').filter((c) => refId(c.Boss) === boss.id && refId(c.User) === user.id).reduce((s, c) => s + (Number(c.Damage) || 0), 0);
  return ok({
    attacked: true, damage: total, volleyMultiplier: volley, cards: details,
    bossName: boss.BossName, newCurrentHp: newHp, maxHp: boss.MaxHp, defeated: newHp <= 0,
    rewardBoosters: newHp <= 0 ? outcome.rewardBoosters : undefined,
    finisherBonus: outcome.finisherBonus || undefined,
    myContribution: myTotal
  });
}

function handleLeaderboard({ store, query }) {
  const rules = { ...bossRules(store), finisherBonus: finisherBoosters(store) };
  if (!store.tables.has('CommunityBoss') || !store.tables.has('BossContributions')) return ok({ boss: null, top: [], rules });
  const bosses = store.getAll('CommunityBoss');
  const boss = bosses.find((b) => b.Active) || bosses.sort((a, b) => b.id - a.id)[0];
  if (!boss) return ok({ boss: null, top: [], rules });
  const pseudo = new Map(store.getAll('Users').map((u) => [u.id, u.Pseudo]));
  const agg = new Map();
  for (const c of store.getAll('BossContributions')) {
    if (refId(c.Boss) !== boss.id) continue;
    const uid = refId(c.User);
    const e = agg.get(uid) || { userId: uid, pseudo: pseudo.get(uid) || '?', damage: 0, hits: 0 };
    e.damage += Number(c.Damage) || 0;
    e.hits++;
    agg.set(uid, e);
  }
  const ranking = [...agg.values()].sort((a, b) => b.damage - a.damage || a.hits - b.hits);
  ranking.forEach((e, i) => { e.rank = i + 1; });
  const me = query.userId ? ranking.find((e) => e.userId === Number(query.userId)) || null : null;
  const finisherId = refId(boss.Finisher);
  return ok({
    boss: { bossId: boss.id, bossName: boss.BossName, active: !!boss.Active, maxHp: boss.MaxHp, currentHp: boss.CurrentHp, finisher: finisherId ? pseudo.get(finisherId) || null : null },
    top: ranking.slice(0, 10),
    me,
    participants: ranking.length,
    finisherBonus: rules.finisherBonus,
    rules
  });
}

// Ancienne attaque (workflow community-boss, action attack) : bonus du coup final.
export function afterWorkflow({ store, path, request, response }) {
  const body = request.body || {};
  if (path !== 'community-boss' || body.action !== 'attack' || response.status !== 200 || !response.json || !response.json.defeated) return;
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  const bonus = finisherBoosters(store);
  const boss = store.getAll('CommunityBoss').filter((b) => !b.Active).sort((a, b) => b.id - a.id)[0];
  if (boss && !refId(boss.Finisher)) store.update('CommunityBoss', boss.id, { Finisher: user.id });
  if (bonus > 0) {
    const updated = store.update('Users', user.id, { BoosterCount: (user.BoosterCount || 0) + bonus });
    response.json.finisherBonus = { boosters: bonus, newBoosterCount: updated.BoosterCount };
  }
}

export const routes = {
  'POST boss-attack': handleAttack,
  'GET boss-leaderboard': handleLeaderboard
};
