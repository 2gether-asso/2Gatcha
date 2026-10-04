// Serie de connexion : un cadeau par jour (fuseau Paris), sur un cycle de 7
// jours de plus en plus genereux. Manquer un jour fait repartir au jour 1.
//   POST /webhook/login-streak  { userId, action: 'status' | 'claim' }

import { ok, fail, userById, parisDay } from './common.js';

export const schema = {
  Users: { LoginStreak: { type: 'Numeric' }, LoginStreakDay: { type: 'Text' } }
};

export const STREAK_REWARDS = [
  { dust: 20 }, { dust: 30 }, { dust: 40 }, { boosters: 1 },
  { dust: 60 }, { dust: 80 }, { boosters: 2, dust: 150 }
];

export function streakState(user, at = Date.now()) {
  const today = parisDay(0, at), yesterday = parisDay(-1, at);
  const last = user.LoginStreakDay || '';
  const streak = Number(user.LoginStreak) || 0;
  const claimedToday = last === today;
  // Jour du cycle (1..7) a reclamer aujourd'hui (ou deja reclame).
  const day = claimedToday ? streak : (last === yesterday ? (streak % 7) + 1 : 1);
  const broken = !claimedToday && last !== yesterday && streak > 0;
  return {
    today, claimedToday, canClaim: !claimedToday, day, broken,
    days: STREAK_REWARDS.map((reward, i) => ({
      day: i + 1, reward,
      state: i + 1 < day || (i + 1 === day && claimedToday) ? 'claimed' : i + 1 === day ? 'today' : 'upcoming'
    }))
  };
}

function handleStreak({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const state = streakState(user);
  if (body.action !== 'claim') return ok(state);
  if (state.claimedToday) return fail('already_claimed', 400, state);
  const reward = STREAK_REWARDS[state.day - 1];
  const updated = store.update('Users', user.id, {
    LoginStreak: state.day,
    LoginStreakDay: state.today,
    StardustCount: (user.StardustCount || 0) + (reward.dust || 0),
    BoosterCount: (user.BoosterCount || 0) + (reward.boosters || 0)
  });
  return ok({ claimed: true, reward, newStardust: updated.StardustCount, newBoosterCount: updated.BoosterCount, ...streakState(updated) });
}

export const routes = { 'POST login-streak': handleStreak };
