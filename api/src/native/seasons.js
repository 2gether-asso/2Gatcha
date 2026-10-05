// Saisons mensuelles : chaque mois (fuseau Paris), un pass de paliers repart
// de zero. L'XP de saison = XP gagnee depuis le debut du mois (instantane de
// Users.XP pris a la premiere action du joueur dans le mois, avant celle-ci).
// Chaque palier a sa recompense ; le dernier donne en plus la carte
// exclusive de la saison si l'admin l'a choisie (carte promo conseillee,
// pour qu'elle ne sorte pas des boosters).
//   POST /webhook/season        { userId, action: 'status' | 'claim' }
//   POST /webhook/admin-season  { discordId, action: 'get' | 'setCard', season?, cardId? }

import { refId, now, ok, fail, userById, isAdmin, firstAttachment, cardSummary } from './common.js';
import { uniqueRarity } from './unique.js';
import { grantCosmetic } from './cosmetics.js';
import { setting } from './settings.js';

export const schema = {
  SeasonProgress: {
    BonusClaimed: { type: 'Numeric' }, User: { type: 'Ref:Users' }, Season: { type: 'Text' }, StartXP: { type: 'Numeric' }, ClaimedTier: { type: 'Numeric' } },
  SeasonCards: { Season: { type: 'Text' }, Card: { type: 'Ref:Cards' } }
};

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function seasonId(at = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(new Date(at));
}
export function seasonLabel(id) {
  const [y, m] = id.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
// Fin de saison : 1er du mois suivant, minuit heure de Paris (epoch secondes).
export function seasonEnd(id) {
  const [y, m] = id.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  // Minuit Paris = 22h ou 23h UTC la veille : on cherche l'heure UTC exacte.
  for (const h of [22, 23, 0, 1]) {
    const t = Date.UTC(ny, nm - 1, h >= 22 ? 0 : 1, h);
    if (new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }) === '00' && seasonId(t) === `${ny}-${String(nm).padStart(2, '0')}`) return Math.floor(t / 1000);
  }
  return Math.floor(Date.UTC(ny, nm - 1, 1) / 1000);
}

function progressRow(store, userId, season) {
  return store.getAll('SeasonProgress').find((r) => refId(r.User) === Number(userId) && r.Season === season) || null;
}

// Appele AVANT chaque action d'un joueur : prend l'instantane d'XP du mois.
export function ensureProgress(store, userId) {
  if (!setting(store, 'SeasonEnabled')) return;
  const season = seasonId();
  if (progressRow(store, userId, season)) return;
  const user = store.get('Users', Number(userId));
  if (!user) return;
  store.create('SeasonProgress', { User: user.id, Season: season, StartXP: Number(user.XP) || 0, ClaimedTier: 0 });
}

function seasonCard(store, season) {
  const row = store.getAll('SeasonCards').find((r) => r.Season === season);
  const card = row && refId(row.Card) ? store.get('Cards', refId(row.Card)) : null;
  return card ? cardSummary(store, card) : null;
}

function statusOf(store, user) {
  const season = seasonId();
  const enabled = !!setting(store, 'SeasonEnabled');
  const tiersCount = setting(store, 'SeasonTiers');
  const perTier = setting(store, 'SeasonXpPerTier');
  const rewards = setting(store, 'SeasonRewards');
  const row = progressRow(store, user.id, season);
  const xp = row ? Math.max(0, (Number(user.XP) || 0) - (Number(row.StartXP) || 0)) : 0;
  const claimed = row ? Number(row.ClaimedTier) || 0 : 0;
  const reached = Math.min(tiersCount, Math.floor(xp / perTier));
  const card = seasonCard(store, season);
  // Paliers bonus (2026-10-05) : au-dela du dernier palier, chaque tranche de
  // SeasonXpPerTier XP rapporte SeasonBonusTierDust poussieres.
  const bonusReached = xp > tiersCount * perTier ? Math.floor((xp - tiersCount * perTier) / perTier) : 0;
  const bonusClaimed = row ? Number(row.BonusClaimed) || 0 : 0;
  const bonus = { reached: bonusReached, claimed: bonusClaimed, dustPerTier: setting(store, 'SeasonBonusTierDust'), nextXp: (tiersCount + bonusReached + 1) * perTier, title: `Champion de saison ${seasonLabel(season)}` };
  const tiers = Array.from({ length: tiersCount }, (_, i) => ({
    tier: i + 1,
    xp: (i + 1) * perTier,
    reward: rewards[i] || {},
    card: i === tiersCount - 1 && card ? card : null,
    reached: i + 1 <= reached,
    claimed: i + 1 <= claimed
  }));
  return { enabled, season, label: seasonLabel(season), endsAt: seasonEnd(season), xp, xpPerTier: perTier, reached, claimed, claimable: Math.max(0, reached - claimed) + Math.max(0, bonusReached - bonusClaimed), tiers, card, bonus };
}

function grant(store, user, reward) {
  return store.update('Users', user.id, {
    StardustCount: (Number(user.StardustCount) || 0) + (Number(reward.dust) || 0),
    BoosterCount: (Number(user.BoosterCount) || 0) + (Number(reward.boosters) || 0),
    ChestCount: (Number(user.ChestCount) || 0) + (Number(reward.chests) || 0),
    KeyCount: (Number(user.KeyCount) || 0) + (Number(reward.keys) || 0)
  });
}

function giveCard(store, user, cardId, season) {
  const used = new Set(store.getAll('Pulls').filter((p) => refId(p.Card) === cardId).map((p) => p.SerialNumber));
  let serial = 1;
  while (used.has(serial)) serial++;
  store.create('Pulls', { User: user.id, Card: cardId, ObtainedAt: now(), BatchId: `season-${season}-${user.id}`, SerialNumber: serial, Finish: 'normal', Quality: 'mint' });
  return serial;
}

function handleSeason({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  ensureProgress(store, user.id);
  const st = statusOf(store, user);
  if (body.action !== 'claim') return ok(st);
  if (!st.enabled) return fail('season_disabled');
  if (!st.claimable) return fail('nothing_to_claim', 400, st);
  const row = progressRow(store, user.id, st.season);
  const total = { dust: 0, boosters: 0, chests: 0, keys: 0 };
  let card = null;
  for (const t of st.tiers.slice(st.claimed, st.reached)) {
    for (const k of Object.keys(total)) total[k] += Number(t.reward[k]) || 0;
    if (t.card) card = { ...t.card, serialNumber: giveCard(store, user, t.card.cardId, st.season) };
  }
  // Dernier palier : titre exclusif de la saison.
  let title = null;
  if (st.reached === st.tiers.length && st.claimed < st.tiers.length && grantCosmetic(store, user.id, `season-${st.season}`, { type: 'title', label: st.bonus.title })) title = st.bonus.title;
  const bonusTiers = Math.max(0, st.bonus.reached - st.bonus.claimed);
  total.dust += bonusTiers * st.bonus.dustPerTier;
  user = grant(store, user, total);
  store.update('SeasonProgress', row.id, { ClaimedTier: st.reached, BonusClaimed: st.bonus.reached });
  return ok({ claimedTiers: st.reached - st.claimed, bonusTiers, title, reward: total, card, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount, ...statusOf(store, user) });
}

function handleAdmin({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  if (body.action === 'setCard') {
    const season = /^\d{4}-\d{2}$/.test(body.season || '') ? body.season : seasonId();
    const cardId = Number(body.cardId) || 0;
    if (cardId && !store.get('Cards', cardId)) return fail('card_not_found');
    // Les cartes Unique ne s'obtiennent qu'au coffre-fort perso.
    const picked = cardId ? store.get('Cards', cardId) : null;
    const unique = uniqueRarity(store);
    if (picked && unique && refId(picked.Rarity) === unique.id) return fail('unique_card_not_allowed');
    const row = store.getAll('SeasonCards').find((r) => r.Season === season);
    if (row) store.update('SeasonCards', row.id, { Card: cardId });
    else store.create('SeasonCards', { Season: season, Card: cardId });
  }
  const current = seasonId();
  const next = seasonId((seasonEnd(current) + 3600) * 1000);
  return ok({
    seasons: [current, next].map((s) => ({ season: s, label: seasonLabel(s), card: seasonCard(store, s) })),
    participants: store.getAll('SeasonProgress').filter((r) => r.Season === current).length
  });
}

export const routes = {
  'POST season': handleSeason,
  'POST admin-season': handleAdmin
};
