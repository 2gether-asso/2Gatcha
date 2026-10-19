// Devine la carte v2 (2026-10-18, remplace le workflow guess-card) :
//  - GuessRoundsPerDay cartes par jour (memes cartes, propositions et zoom
//    pour tout le monde, tirage seme par la date) ; 3 essais par carte : a
//    chaque erreur, la proposition fausse disparait et le zoom recule ; le
//    gain baisse (100 %, 60 %, 30 %).
//  - Serie (GuessStreak) : un jour compte s'il a au moins GuessStreakMin
//    bonnes reponses ; tous les 7 jours de serie, un jeton booster.
//    Journee parfaite (toutes trouvees du premier coup) : bonus de poussieres.
//  - Utile : trouver une carte qu'on ne possede pas donne un BON DE CRAFT
//    (-GuessCouponPct % sur cette carte pendant GuessCouponDays jours),
//    rembourse apres le craft (afterWorkflow craft).
//  - Gains (2026-10-19) : base relevee et indexee sur l'inflation des prix
//    (priceMultiplier, comme la boutique) ; journee terminee avec la serie
//    gardee = GuessFinishCoins pieces de gatchapon. Le site affiche le gain
//    possible de chaque carte (potential) des le debut, qui baisse a chaque
//    erreur.
//   POST /webhook/guess-card { userId, action: 'status' | 'guess', round?, cardId? }

import { ok, fail, userById, now, refId, parisDay, firstAttachment, parseJson, levelForXp } from './common.js';
import { setting } from './settings.js';
import { priceMultiplier } from './inflation.js';

export const schema = { Users: { GuessState: { type: 'Text' }, CraftCoupons: { type: 'Text' } } };

const MULT = [1, 0.6, 0.3];
const TRIES = 3;
const STREAK_BOOSTER_EVERY = 7;
const XP_PER_ROUND = 5;
const CONSOLATION = 0.15;
// Gain d'une carte trouvee au 1er essai, indexe sur l'inflation des prix.
const baseDust = (store) => Math.round(setting(store, 'GuessDust') * Math.max(1, priceMultiplier(store)));

function seeded(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } let a = h >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function poolOf(store) {
  return store.getAll('Cards').filter((c) => c.Active && !c.IsSecret && !c.IsPromo && !c.IsVault && firstAttachment(c.Image) != null).sort((a, b) => a.id - b.id);
}
// Les manches du jour (deterministes).
function roundsOf(store, day) {
  const pool = poolOf(store);
  if (pool.length < 4) return [];
  const n = Math.min(setting(store, 'GuessRoundsPerDay'), pool.length);
  const rnd = seeded('guess2-' + day);
  const answers = [];
  const left = [...pool];
  while (answers.length < n) answers.push(left.splice(Math.floor(rnd() * left.length), 1)[0]);
  return answers.map((answer) => {
    const others = pool.filter((c) => c.id !== answer.id);
    const picks = [answer];
    while (picks.length < 4) picks.push(others.splice(Math.floor(rnd() * others.length), 1)[0]);
    for (let i = picks.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [picks[i], picks[j]] = [picks[j], picks[i]]; }
    return { answer, picks, zoom: { scale: Math.round((2.8 + rnd() * 0.8) * 100) / 100, x: Math.round(20 + rnd() * 60), y: Math.round(20 + rnd() * 60) } };
  });
}

function stateOf(user, day) {
  const s = parseJson(user.GuessState, null);
  return s && s.day === day ? s : { day, rounds: [] };
}
const couponsOf = (user) => { const c = parseJson(user.CraftCoupons, {}) || {}; const t = now(); return Object.fromEntries(Object.entries(c).filter(([, until]) => Number(until) > t)); };

function view(store, user) {
  const day = parisDay(0);
  const rounds = roundsOf(store, day);
  const st = stateOf(user, day);
  const cards = new Map(store.getAll('Cards').map((c) => [c.id, c]));
  const coupons = couponsOf(user);
  const base = baseDust(store);
  const perfect = setting(store, 'GuessPerfectDust');
  return {
    gains: { base, mult: MULT, consolation: CONSOLATION, perfect, finishCoins: setting(store, 'GuessFinishCoins'), dayMax: base * rounds.length + perfect },
    day, streak: Number(user.GuessStreak) || 0, boosterEvery: STREAK_BOOSTER_EVERY, streakMin: setting(store, 'GuessStreakMin'),
    couponPct: setting(store, 'GuessCouponPct'), couponDays: setting(store, 'GuessCouponDays'),
    rounds: rounds.map((r, i) => {
      const s = st.rounds[i] || { tries: [], done: false, correct: false };
      const fails = s.tries.length - (s.correct ? 1 : 0);
      const scale = s.done ? 1 : Math.max(1.2, r.zoom.scale * Math.pow(0.7, fails));
      return {
        index: i, imageId: firstAttachment(r.answer.Image), zoom: { ...r.zoom, scale },
        choices: r.picks.map((c) => ({ cardId: c.id, name: c.Name, wrong: s.tries.includes(c.id) && c.id !== r.answer.id })),
        triesLeft: s.done ? 0 : TRIES - s.tries.length, done: s.done, correct: s.correct,
        // Gain possible tant que la carte n'est pas jouee, puis gain obtenu.
        potential: s.done ? Number(s.dust) || 0 : Math.round(base * MULT[Math.min(MULT.length - 1, fails)]),
        ...(s.done ? { answerCardId: r.answer.id, answerName: r.answer.Name } : {})
      };
    }),
    found: st.rounds.filter((x) => x && x.correct).length,
    finished: rounds.length > 0 && rounds.every((_, i) => st.rounds[i] && st.rounds[i].done),
    coupons: Object.entries(coupons).map(([id, until]) => ({ cardId: Number(id), name: cards.get(Number(id))?.Name || '?', until: Number(until) }))
  };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if ((body.action || 'status') === 'status') return ok(view(store, user));
  if (body.action !== 'guess') return fail('unknown_action');
  const day = parisDay(0);
  const rounds = roundsOf(store, day);
  if (!rounds.length) return fail('not_enough_cards');
  const i = Math.floor(Number(body.round) || 0);
  const r = rounds[i];
  if (!r) return fail('invalid_round');
  const st = stateOf(user, day);
  const s = st.rounds[i] || { tries: [], done: false, correct: false };
  if (s.done) return fail('already_played', 400, view(store, user));
  const cardId = Number(body.cardId);
  if (!r.picks.some((c) => c.id === cardId) || s.tries.includes(cardId)) return fail('invalid_choice', 400, view(store, user));
  s.tries.push(cardId);
  const correct = cardId === r.answer.id;
  const fields = {};
  let reward = { dust: 0, boosters: 0, coupon: null, perfect: false, streakUp: false };
  if (correct || s.tries.length >= TRIES) {
    s.done = true;
    s.correct = correct;
    const base = baseDust(store);
    reward.dust = correct ? Math.round(base * MULT[s.tries.length - 1]) : Math.round(base * CONSOLATION);
    s.dust = reward.dust;
    // Bon de craft : carte trouvee qu'on ne possede pas.
    const owns = store.getAll('Pulls').some((p) => refId(p.User) === user.id && refId(p.Card) === r.answer.id);
    if (correct && !owns && setting(store, 'GuessCouponPct') > 0) {
      const coupons = couponsOf(user);
      coupons[r.answer.id] = now() + setting(store, 'GuessCouponDays') * 86400;
      fields.CraftCoupons = JSON.stringify(coupons);
      reward.coupon = { cardId: r.answer.id, name: r.answer.Name, pct: setting(store, 'GuessCouponPct') };
    }
  }
  st.rounds[i] = s;
  const finished = rounds.every((_, k) => st.rounds[k] && st.rounds[k].done);
  if (finished && user.GuessDate !== day) {
    const found = st.rounds.filter((x) => x && x.correct).length;
    const yesterday = parisDay(-1);
    const cont = user.GuessDate === yesterday && (Number(user.GuessStreak) || 0) > 0;
    const newStreak = found >= setting(store, 'GuessStreakMin') ? (cont ? Number(user.GuessStreak) + 1 : 1) : 0;
    fields.GuessDate = day;
    fields.GuessStreak = newStreak;
    reward.streakUp = newStreak > 0;
    if (newStreak > 0 && newStreak % STREAK_BOOSTER_EVERY === 0) reward.boosters += 1;
    // Journee terminee en gardant la serie : pieces de gatchapon.
    const coins = setting(store, 'GuessFinishCoins');
    if (newStreak > 0 && coins > 0) { reward.coins = coins; fields.ChestCount = (Number(user.ChestCount) || 0) + coins; }
    if (st.rounds.every((x) => x && x.correct && x.tries.length === 1)) { reward.perfect = true; reward.dust += setting(store, 'GuessPerfectDust'); }
  }
  const newXp = (Number(user.XP) || 0) + (s.done ? XP_PER_ROUND : 0);
  const levels = levelForXp(newXp) - levelForXp(Number(user.XP) || 0);
  user = store.update('Users', user.id, {
    ...fields, GuessState: JSON.stringify(st), XP: newXp,
    StardustCount: (Number(user.StardustCount) || 0) + reward.dust,
    BoosterCount: (Number(user.BoosterCount) || 0) + reward.boosters + Math.max(0, levels)
  });
  return ok({ ...view(store, user), round: i, correct, done: s.done, reward, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount });
}

// Bon de craft : remboursement apres un craft reussi de la carte.
export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'craft' || response.status !== 200 || !response.json || !response.json.crafted) return;
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  const coupons = couponsOf(user);
  const cardId = Number(body.cardId);
  if (!coupons[cardId]) return;
  const refund = Math.round((Number(response.json.craftCost) || 0) * setting(store, 'GuessCouponPct') / 100);
  delete coupons[cardId];
  const fresh = store.get('Users', user.id);
  store.update('Users', user.id, { CraftCoupons: JSON.stringify(coupons), StardustCount: (Number(fresh.StardustCount) || 0) + refund });
  response.json.couponRefund = refund;
  response.json.newStardust = (Number(fresh.StardustCount) || 0) + refund;
}

// Pour les tests : bonnes reponses du jour.
export const _answers = (store, day = parisDay(0)) => roundsOf(store, day).map((r) => r.answer.id);
export const routes = { 'POST guess-card': handle };
