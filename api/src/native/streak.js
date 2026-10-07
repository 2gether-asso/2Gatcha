// Serie de connexion : un cadeau par jour (fuseau Paris), sur un cycle de 7
// jours de plus en plus genereux. Manquer un jour fait repartir au jour 1,
// sauf si le joueur a un GEL de serie (2026-10-07) : achete avec des
// poussieres (StreakFreezeCost, un achat par semaine, 2 en reserve max), il
// pardonne automatiquement un jour manque.
//   POST /webhook/login-streak  { userId, action: 'status' | 'claim' | 'buyFreeze' }

import { ok, fail, userById, parisDay } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';

export const schema = {
  Users: { LoginStreak: { type: 'Numeric' }, LoginStreakDay: { type: 'Text' }, StreakFreezes: { type: 'Numeric' }, FreezeWeek: { type: 'Text' } }
};

export const MAX_FREEZES = 2;

// Cadeaux des 7 jours : reglage LoginStreakRewards (admin).
export const rewardsOf = (store) => setting(store, 'LoginStreakRewards');

export function streakState(user, at = Date.now(), rewards) {
  const today = parisDay(0, at), yesterday = parisDay(-1, at), dayBefore = parisDay(-2, at);
  const last = user.LoginStreakDay || '';
  const streak = Number(user.LoginStreak) || 0;
  const freezes = Number(user.StreakFreezes) || 0;
  const claimedToday = last === today;
  // Un seul jour manque et un gel en reserve : la serie continue.
  const frozen = !claimedToday && last === dayBefore && streak > 0 && freezes > 0;
  const continues = last === yesterday || frozen;
  // Jour du cycle (1..7) a reclamer aujourd'hui (ou deja reclame).
  const day = claimedToday ? streak : (continues ? (streak % 7) + 1 : 1);
  const broken = !claimedToday && !continues && streak > 0;
  return {
    today, claimedToday, canClaim: !claimedToday, day, broken, frozen, freezes,
    days: rewards.map((reward, i) => ({
      day: i + 1, reward,
      state: i + 1 < day || (i + 1 === day && claimedToday) ? 'claimed' : i + 1 === day ? 'today' : 'upcoming'
    }))
  };
}

function withShop(store, user, state) {
  return { ...state, freezeCost: setting(store, 'StreakFreezeCost'), maxFreezes: MAX_FREEZES, canBuyFreeze: user.FreezeWeek !== weekKey() && (Number(user.StreakFreezes) || 0) < MAX_FREEZES };
}

function handleStreak({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const rewards = rewardsOf(store);
  const state = streakState(user, Date.now(), rewards);
  if (body.action === 'buyFreeze') {
    const cost = setting(store, 'StreakFreezeCost');
    if (user.FreezeWeek === weekKey()) return fail('already_bought_this_week', 400, withShop(store, user, state));
    if ((Number(user.StreakFreezes) || 0) >= MAX_FREEZES) return fail('max_freezes', 400, withShop(store, user, state));
    if ((Number(user.StardustCount) || 0) < cost) return fail('not_enough_dust', 400, withShop(store, user, state));
    const updated = store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) - cost, StreakFreezes: (Number(user.StreakFreezes) || 0) + 1, FreezeWeek: weekKey() });
    return ok({ bought: true, newStardust: updated.StardustCount, ...withShop(store, updated, streakState(updated, Date.now(), rewards)) });
  }
  if (body.action !== 'claim') return ok(withShop(store, user, state));
  if (state.claimedToday) return fail('already_claimed', 400, state);
  const reward = rewards[state.day - 1] || {};
  const updated = store.update('Users', user.id, {
    LoginStreak: state.day,
    LoginStreakDay: state.today,
    StardustCount: (user.StardustCount || 0) + (reward.dust || 0),
    BoosterCount: (user.BoosterCount || 0) + (reward.boosters || 0),
    ...(state.frozen ? { StreakFreezes: Math.max(0, (Number(user.StreakFreezes) || 0) - 1) } : {})
  });
  return ok({ claimed: true, reward, usedFreeze: state.frozen, newStardust: updated.StardustCount, newBoosterCount: updated.BoosterCount, ...withShop(store, updated, streakState(updated, Date.now(), rewards)) });
}

export const routes = { 'POST login-streak': handleStreak };
