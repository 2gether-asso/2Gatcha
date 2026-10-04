// Coffre-fort perso (coffre.html) - remplace le workflow personal-vault.json.
//   POST /webhook/personal-vault { userId, action: 'status' | 'store' | 'withdraw' | 'joker', pullId?, cardId?, finish? }
//
// Une fois la carte du coffre (Cards.IsVault) debloquee, chaque joueur peut y
// mettre ses cartes precieuses a l'abri. Une LIGNE = une carte, 6 emplacements
// (un par finition), parfait etat uniquement. Une carte rangee reste a son
// proprietaire (Pulls.InVault, numero conserve) mais quitte la collection
// active jusqu'a ce qu'il la retire. Cartes promo exclues (une seule
// finition possible).
//
// Piece detachee (Users.SpareParts, gagnee a la peche) : joker qui remplit un
// emplacement vide (finition manquante, ou carte pas en parfait etat), au
// plus VaultJokersPerRow par ligne. Definitive : elle ne se retire pas, mais
// ranger plus tard la vraie carte a cet emplacement la rembourse.
//
// Ligne complete = recompense UNE seule fois (VaultRewards) : boosters +
// poussieres (VaultBoostersPerRow / VaultDustPerRow) + un Ticket Unique.

import { refId, now, ok, fail, userById, firstAttachment } from './common.js';
import { setting } from './settings.js';
import { addTicket, vaultSummary } from './unique.js';

export const FINISHES = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'];

export const schema = {
  Pulls: { InVault: { type: 'Bool' } },
  VaultRewards: { User: { type: 'Ref:Users' }, Card: { type: 'Ref:Cards' }, ClaimedAt: { type: 'Numeric' } },
  VaultJokers: { User: { type: 'Ref:Users' }, Card: { type: 'Ref:Cards' }, Finish: { type: 'Text' }, PlacedAt: { type: 'Numeric' } },
  Users: { SpareParts: { type: 'Numeric' } }
};

const finishOf = (p) => p.Finish || 'normal';
const qualityOf = (p) => p.Quality || 'damaged';

function isUnlocked(store, userId) {
  const vaultCard = store.getAll('Cards').find((c) => !!c.IsVault);
  return !!vaultCard && store.getAll('Pulls').some((p) => refId(p.User) === userId && refId(p.Card) === vaultCard.id && String(p.BatchId || '').startsWith('vault-'));
}

function buildRows(store, userId) {
  const cards = store.getAll('Cards');
  const myPulls = store.getAll('Pulls').filter((p) => refId(p.User) === userId);
  const jokers = store.getAll('VaultJokers').filter((j) => refId(j.User) === userId);
  const claimed = new Set(store.getAll('VaultRewards').filter((r) => refId(r.User) === userId).map((r) => refId(r.Card)));
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  return cards.filter((c) => !c.IsPromo).map((card) => {
    const mine = myPulls.filter((p) => refId(p.Card) === card.id && qualityOf(p) === 'mint');
    const cardJokers = jokers.filter((j) => refId(j.Card) === card.id);
    if (!mine.length && !claimed.has(card.id) && !cardJokers.length) return null;
    const slots = FINISHES.map((f) => {
      const stored = mine.find((p) => p.InVault && finishOf(p) === f);
      const joker = !stored && cardJokers.some((j) => (j.Finish || 'normal') === f);
      const candidates = mine.filter((p) => !p.InVault && finishOf(p) === f).map((p) => ({ pullId: p.id, serialNumber: p.SerialNumber }));
      return { finish: f, stored: stored ? { pullId: stored.id, serialNumber: stored.SerialNumber } : null, joker, candidates };
    });
    const rarity = rarities.get(refId(card.Rarity));
    const filled = slots.filter((s) => s.stored || s.joker).length;
    return {
      cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image),
      rarity: rarity ? { key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex, sortOrder: rarity.SortOrder || 0 } : null,
      slots, filled, jokers: slots.filter((s) => s.joker).length,
      complete: filled === FINISHES.length, claimed: claimed.has(card.id)
    };
  }).filter(Boolean).sort((a, b) => (b.filled - a.filled) || ((b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0)) || a.name.localeCompare(b.name));
}

// Ligne de cette carte devenue complete (et jamais recompensee) : recompense.
function maybeReward(store, user, cardId) {
  const row = buildRows(store, user.id).find((r) => r.cardId === cardId);
  if (!row || !row.complete || row.claimed) return null;
  const boosters = setting(store, 'VaultBoostersPerRow');
  const dust = setting(store, 'VaultDustPerRow');
  const u = store.get('Users', user.id);
  store.update('Users', user.id, { BoosterCount: (Number(u.BoosterCount) || 0) + boosters, StardustCount: (Number(u.StardustCount) || 0) + dust });
  store.create('VaultRewards', { User: user.id, Card: cardId, ClaimedAt: now() });
  addTicket(store, user.id);
  return { cardId, cardName: row.name, boosters, dust, ticket: 1 };
}

function payload(store, userId, reward = null) {
  const user = store.get('Users', userId);
  return {
    unlocked: true,
    rows: buildRows(store, userId),
    boostersPerRow: setting(store, 'VaultBoostersPerRow'),
    dustPerRow: setting(store, 'VaultDustPerRow'),
    jokersPerRow: setting(store, 'VaultJokersPerRow'),
    spareParts: Number(user.SpareParts) || 0,
    unique: vaultSummary(store, userId),
    reward
  };
}

function handleVault({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = (body.action || 'status').toString();
  if (!isUnlocked(store, user.id)) return action === 'status' ? ok({ unlocked: false }) : fail('vault_locked');
  if (action === 'status') return ok(payload(store, user.id));

  if (action === 'store' || action === 'withdraw') {
    const target = store.getAll('Pulls').find((p) => p.id === Number(body.pullId) && refId(p.User) === user.id);
    if (!target) return fail('pull_not_owned');
    const cardId = refId(target.Card);
    if (action === 'withdraw') {
      if (!target.InVault) return fail('not_stored');
      store.update('Pulls', target.id, { InVault: false });
      return ok(payload(store, user.id));
    }
    if (target.InVault) return fail('already_stored');
    const card = store.get('Cards', cardId);
    if (!card || card.IsPromo) return fail('promo_not_storable');
    if (qualityOf(target) !== 'mint') return fail('not_mint');
    const mine = store.getAll('Pulls').filter((p) => refId(p.User) === user.id && refId(p.Card) === cardId);
    if (mine.some((p) => p.InVault && finishOf(p) === finishOf(target))) return fail('slot_filled');
    store.update('Pulls', target.id, { InVault: true });
    // La vraie carte remplace une piece detachee : piece remboursee.
    let refunded = false;
    const joker = store.getAll('VaultJokers').find((j) => refId(j.User) === user.id && refId(j.Card) === cardId && (j.Finish || 'normal') === finishOf(target));
    if (joker) {
      store.delete('VaultJokers', joker.id);
      store.update('Users', user.id, { SpareParts: (Number(store.get('Users', user.id).SpareParts) || 0) + 1 });
      refunded = true;
    }
    const res = payload(store, user.id, maybeReward(store, user, cardId));
    if (refunded) res.jokerRefunded = true;
    return ok(res);
  }

  if (action === 'joker') {
    const max = setting(store, 'VaultJokersPerRow');
    if (max <= 0) return fail('jokers_disabled');
    if ((Number(user.SpareParts) || 0) < 1) return fail('no_spare_part');
    const cardId = Number(body.cardId);
    const finish = String(body.finish || '');
    if (!FINISHES.includes(finish)) return fail('invalid_finish');
    const row = buildRows(store, user.id).find((r) => r.cardId === cardId);
    if (!row) return fail('row_not_found');
    const slot = row.slots.find((s) => s.finish === finish);
    if (slot.stored || slot.joker) return fail('slot_filled');
    if (row.jokers >= max) return fail('joker_limit', 400, { max });
    store.create('VaultJokers', { User: user.id, Card: cardId, Finish: finish, PlacedAt: now() });
    store.update('Users', user.id, { SpareParts: (Number(user.SpareParts) || 0) - 1 });
    return ok(payload(store, user.id, maybeReward(store, user, cardId)));
  }
  return fail('unknown_action');
}

export const routes = { 'POST personal-vault': handleVault };
