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
// n'apparait qu'une fois une carte de cette edition obtenue, et qui marche
// exactement comme le Classique : une ligne par carte, 6 emplacements (un par
// finition), parfait etat, recompense de ligne complete une fois par carte ET
// par edition (VaultRewards.Edition, vide = Classique).
//
// 2026-10-25 : lignes rangees PAR EXTENSION (row.extension, le site les
// groupe). Carte EMERAUDE : une ligne complete donne en plus (ticket compris)
// un exemplaire en finition emeraude de la carte, cree directement dans le
// coffre (Pulls.VaultLocked) : il ne peut pas en sortir (ni retrait, ni
// echange, ni decraft : InVault l'exclut de tout le reste) et atteste de la
// maitrise de la carte. Une par carte et par edition ; rattrapage pour les
// lignes completees avant (au premier passage sur le coffre).

import { refId, now, ok, fail, userById, firstAttachment, parseJson, nextSerial } from './common.js';
import { EDITIONS } from './editions.js';
import { setting } from './settings.js';
import { addTicket, vaultSummary } from './unique.js';

export const FINISHES = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'];

export const schema = {
  Pulls: { InVault: { type: 'Bool' }, VaultLocked: { type: 'Bool' } },
  VaultRewards: { User: { type: 'Ref:Users' }, Card: { type: 'Ref:Cards' }, ClaimedAt: { type: 'Numeric' }, Edition: { type: 'Text' } }
};

const finishOf = (p) => p.Finish || 'normal';
const qualityOf = (p) => p.Quality || 'damaged';

function isUnlocked(store, userId) {
  const vaultCard = store.getAll('Cards').find((c) => !!c.IsVault);
  return !!vaultCard && store.getAll('Pulls').some((p) => refId(p.User) === userId && refId(p.Card) === vaultCard.id && String(p.BatchId || '').startsWith('vault-'));
}

const editionOf = (p) => p.Edition || '';
export const EMERALD = 'emerald';
const isEmerald = (p) => p.Finish === EMERALD;
function buildRows(store, userId, edition = '') {
  const cards = store.getAll('Cards');
  const myPulls = store.getAll('Pulls').filter((p) => refId(p.User) === userId && editionOf(p) === edition);
  const claimed = new Set(store.getAll('VaultRewards').filter((r) => refId(r.User) === userId && (r.Edition || '') === edition).map((r) => refId(r.Card)));
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  const exts = new Map((store.tables.has('Extensions') ? store.getAll('Extensions') : []).map((e) => [e.id, e]));
  return cards.filter((c) => !c.IsPromo).map((card) => {
    const mine = myPulls.filter((p) => refId(p.Card) === card.id && qualityOf(p) === 'mint');
    if (!mine.length && !claimed.has(card.id)) return null;
    const slots = FINISHES.map((f) => {
      const stored = mine.find((p) => p.InVault && finishOf(p) === f);
      const candidates = mine.filter((p) => !p.InVault && finishOf(p) === f).map((p) => ({ pullId: p.id, serialNumber: p.SerialNumber }));
      return { finish: f, stored: stored ? { pullId: stored.id, serialNumber: stored.SerialNumber } : null, candidates };
    });
    const rarity = rarities.get(refId(card.Rarity));
    const filled = slots.filter((s) => s.stored).length;
    const ext = exts.get(refId(card.Extension));
    const emerald = myPulls.find((p) => refId(p.Card) === card.id && isEmerald(p));
    return {
      cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image),
      rarity: rarity ? { key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex, sortOrder: rarity.SortOrder || 0 } : null,
      extension: ext ? { id: ext.id, name: ext.Name || ext.Label || 'Extension', sortOrder: Number(ext.SortOrder) || ext.id } : { id: 0, name: 'Hors extension', sortOrder: 1e9 },
      slots, filled, emerald: emerald ? { pullId: emerald.id, serialNumber: emerald.SerialNumber } : null,
      complete: filled === FINISHES.length, claimed: claimed.has(card.id)
    };
  }).filter(Boolean).sort((a, b) => (a.extension.sortOrder - b.extension.sortOrder) || (b.filled - a.filled) || ((b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0)) || a.name.localeCompare(b.name));
}

// Exemplaire emeraude d'une carte maitrisee (ligne complete) : cree dans le
// coffre, verrouille. null s'il existe deja.
function grantEmerald(store, userId, cardId, edition = '') {
  const has = store.getAll('Pulls').some((p) => refId(p.User) === userId && refId(p.Card) === cardId && isEmerald(p) && editionOf(p) === edition);
  if (has || !store.get('Cards', cardId)) return null;
  const pull = store.create('Pulls', {
    User: userId, Card: cardId, SerialNumber: nextSerial(store, cardId), Finish: EMERALD, Quality: 'mint',
    InVault: true, VaultLocked: true, ObtainedAt: now(), BatchId: `emerald-${userId}-${cardId}-${Date.now()}`, ...(edition ? { Edition: edition } : {})
  });
  return { pullId: pull.id, cardId, serialNumber: pull.SerialNumber, edition: edition || null };
}
// Lignes completees avant l'arrivee de l'emeraude : rattrapage.
function emeraldCatchUp(store, userId) {
  const out = [];
  for (const r of store.getAll('VaultRewards').filter((x) => refId(x.User) === userId)) {
    const g = grantEmerald(store, userId, refId(r.Card), r.Edition || '');
    if (g) { const c = store.get('Cards', g.cardId); out.push({ ...g, cardName: c ? c.Name : '?' }); }
  }
  return out;
}

// Ligne de cette carte devenue complete (et jamais recompensee) : recompense.
function maybeReward(store, user, cardId, edition = '') {
  const row = buildRows(store, user.id, edition).find((r) => r.cardId === cardId);
  if (!row || !row.complete || row.claimed) return null;
  const boosters = setting(store, 'VaultBoostersPerRow');
  const dust = setting(store, 'VaultDustPerRow');
  const u = store.get('Users', user.id);
  store.update('Users', user.id, { BoosterCount: (Number(u.BoosterCount) || 0) + boosters, StardustCount: (Number(u.StardustCount) || 0) + dust });
  store.create('VaultRewards', { User: user.id, Card: cardId, ClaimedAt: now(), ...(edition ? { Edition: edition } : {}) });
  addTicket(store, user.id);
  const emerald = grantEmerald(store, user.id, cardId, edition);
  return { cardId, cardName: row.name, boosters, dust, ticket: 1, edition: edition || null, emerald };
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

// Un onglet par edition obtenue, avec les memes lignes que le Classique.
function buildEditionTabs(store, userId) {
  const myPulls = store.getAll('Pulls').filter((p) => refId(p.User) === userId);
  const seen = editionsSeen(store, userId, myPulls);
  return Object.entries(EDITIONS).filter(([key]) => seen.has(key)).map(([key, e]) => {
    const rows = buildRows(store, userId, key);
    return {
      key, label: e.label, icon: e.icon, rows,
      stored: rows.reduce((n, r) => n + r.filled, 0),
      ready: rows.reduce((n, r) => n + r.slots.filter((x) => !x.stored && x.candidates.length).length, 0),
      complete: rows.filter((r) => r.complete).length
    };
  });
}

function payload(store, userId, reward = null) {
  const emeraldGrants = emeraldCatchUp(store, userId);
  return {
    unlocked: true,
    emeraldGrants,
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
      if (target.VaultLocked || isEmerald(target)) return fail('emerald_locked');
      store.update('Pulls', target.id, { InVault: false });
      return ok(payload(store, user.id));
    }
    if (target.InVault) return fail('already_stored');
    const card = store.get('Cards', cardId);
    if (!card || card.IsPromo) return fail('promo_not_storable');
    if (qualityOf(target) !== 'mint') return fail('not_mint');
    const mine = store.getAll('Pulls').filter((p) => refId(p.User) === user.id && refId(p.Card) === cardId);
    const ed = editionOf(target);
    if (mine.some((p) => p.InVault && editionOf(p) === ed && finishOf(p) === finishOf(target))) return fail('slot_filled');
    store.update('Pulls', target.id, { InVault: true });
    return ok(payload(store, user.id, maybeReward(store, user, cardId, ed)));
  }

  return fail('unknown_action');
}

export const routes = { 'POST personal-vault': handleVault };
