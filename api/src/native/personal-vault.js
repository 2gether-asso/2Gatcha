// Coffre-fort perso (coffre.html) - remplace le workflow personal-vault.json.
//   POST /webhook/personal-vault { userId, action: 'status' | 'store' | 'withdraw', pullId? }
//
// Une fois la carte du coffre (Cards.IsVault) debloquee, chaque joueur peut y
// mettre ses cartes precieuses a l'abri. Une LIGNE = une carte, 6 emplacements
// (un par finition), parfait etat uniquement. Une carte rangee reste a son
// proprietaire (Pulls.InVault, numero conserve) mais quitte la collection
// active jusqu'a ce qu'il la retire. Cartes promo exclues (une seule
// finition possible).
//
// Ligne complete = recompense UNE seule fois (VaultRewards) : boosters +
// poussieres (VaultBoostersPerRow / VaultDustPerRow) + un Ticket Unique.
//
// Onglets par edition (2026-10-15) : l'onglet "Classique" ne prend que les
// cartes sans edition. Chaque edition limitee (editions.js) a son onglet, qui
// n'apparait qu'une fois une carte de cette edition obtenue : les cartes y
// sont rangees par rarete, un emplacement par carte (finition libre),
// parfait etat uniquement. Pas de recompense de ligne pour les editions.

import { refId, now, ok, fail, userById, firstAttachment, parseJson } from './common.js';
import { EDITIONS } from './editions.js';
import { setting } from './settings.js';
import { addTicket, vaultSummary } from './unique.js';

export const FINISHES = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'];

export const schema = {
  Pulls: { InVault: { type: 'Bool' } },
  VaultRewards: { User: { type: 'Ref:Users' }, Card: { type: 'Ref:Cards' }, ClaimedAt: { type: 'Numeric' } }
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
  const claimed = new Set(store.getAll('VaultRewards').filter((r) => refId(r.User) === userId).map((r) => refId(r.Card)));
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  return cards.filter((c) => !c.IsPromo).map((card) => {
    const mine = myPulls.filter((p) => refId(p.Card) === card.id && qualityOf(p) === 'mint' && !p.Edition);
    if (!mine.length && !claimed.has(card.id)) return null;
    const slots = FINISHES.map((f) => {
      const stored = mine.find((p) => p.InVault && finishOf(p) === f);
      const candidates = mine.filter((p) => !p.InVault && finishOf(p) === f).map((p) => ({ pullId: p.id, serialNumber: p.SerialNumber }));
      return { finish: f, stored: stored ? { pullId: stored.id, serialNumber: stored.SerialNumber } : null, candidates };
    });
    const rarity = rarities.get(refId(card.Rarity));
    const filled = slots.filter((s) => s.stored).length;
    return {
      cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image),
      rarity: rarity ? { key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex, sortOrder: rarity.SortOrder || 0 } : null,
      slots, filled,
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

// Editions deja obtenues par le joueur : exemplaires actuels + historique
// des tirages (l'onglet reste meme si la carte a ete echangee depuis).
function editionsSeen(store, userId, myPulls) {
  const seen = new Set(myPulls.filter((p) => p.Edition).map((p) => p.Edition));
  if (store.tables.has('PullHistory')) {
    for (const h of store.getAll('PullHistory')) {
      if (refId(h.User) !== userId || (h.Kind !== 'created' && h.Kind !== 'changed')) continue;
      const d = parseJson(h.Detail, null);
      if (d && d.edition) seen.add(d.edition);
    }
  }
  return seen;
}

// Un onglet par edition obtenue : cartes groupees par rarete, un emplacement
// par carte (n'importe quelle finition, parfait etat).
function buildEditionTabs(store, userId) {
  const myPulls = store.getAll('Pulls').filter((p) => refId(p.User) === userId);
  const seen = editionsSeen(store, userId, myPulls);
  if (!seen.size) return [];
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  const cards = store.getAll('Cards').filter((c) => !c.IsPromo && !c.IsVault && c.Active !== false);
  return Object.entries(EDITIONS).filter(([key]) => seen.has(key)).map(([key, e]) => {
    const groups = new Map();
    let stored = 0, ready = 0;
    for (const card of cards) {
      const rarity = rarities.get(refId(card.Rarity));
      if (!rarity) continue;
      const mine = myPulls.filter((p) => refId(p.Card) === card.id && p.Edition === key && qualityOf(p) === 'mint');
      const kept = mine.find((p) => p.InVault);
      const candidates = mine.filter((p) => !p.InVault).map((p) => ({ pullId: p.id, serialNumber: p.SerialNumber, finish: finishOf(p) }));
      if (kept) stored++; else if (candidates.length) ready++;
      if (!groups.has(rarity.id)) groups.set(rarity.id, { rarity: { key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex, sortOrder: rarity.SortOrder || 0 }, slots: [] });
      groups.get(rarity.id).slots.push({
        cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image),
        stored: kept ? { pullId: kept.id, serialNumber: kept.SerialNumber, finish: finishOf(kept) } : null, candidates
      });
    }
    const sections = [...groups.values()].sort((a, b) => b.rarity.sortOrder - a.rarity.sortOrder).map((g) => ({
      ...g, slots: g.slots.sort((a, b) => a.name.localeCompare(b.name)), filled: g.slots.filter((x) => x.stored).length
    }));
    return { key, label: e.label, icon: e.icon, stored, ready, total: sections.reduce((n, g) => n + g.slots.length, 0), sections };
  });
}

function payload(store, userId, reward = null) {
  return {
    unlocked: true,
    rows: buildRows(store, userId),
    editions: buildEditionTabs(store, userId),
    boostersPerRow: setting(store, 'VaultBoostersPerRow'),
    dustPerRow: setting(store, 'VaultDustPerRow'),
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
    if (target.Edition) {
      if (mine.some((p) => p.InVault && p.Edition === target.Edition)) return fail('slot_filled');
      store.update('Pulls', target.id, { InVault: true });
      return ok(payload(store, user.id));
    }
    if (mine.some((p) => p.InVault && !p.Edition && finishOf(p) === finishOf(target))) return fail('slot_filled');
    store.update('Pulls', target.id, { InVault: true });
    return ok(payload(store, user.id, maybeReward(store, user, cardId)));
  }

  return fail('unknown_action');
}

export const routes = { 'POST personal-vault': handleVault };
