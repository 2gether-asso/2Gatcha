// Coffre de guilde v2 (2026-10-18, remplace le workflow guild-chest) : une
// bourse d'echange commune avec des credits de guilde.
//  - Deposer : jusqu'a GuildChestDepositsPerDay doublons par jour (on garde
//    toujours au moins 1 exemplaire de la carte ; jamais une promo, une
//    edition limitee, un exemplaire ★, assure ou du coffre). Chaque depot
//    rapporte des credits selon la rarete (GuildChestValues), la finition et
//    l'etat.
//  - Prendre : tout le contenu est visible ; on prend la carte de son choix
//    contre des credits (valeur x GuildChestTakeMult) ou une cle, jusqu'a
//    GuildChestTakesPerDay fois par jour. Jamais son propre depot.
//  - Pioche gratuite du jour : une carte au hasard, une fois par jour.
//  - Classement des donateurs de la semaine.
// Memes tables qu'avant (GuildChestDeposits : avis de recherche, fiche des cartes).
//   POST /webhook/guild-chest { userId, action: 'status' | 'deposit' | 'take' | 'free', pullIds?, depositId?, pay?: 'credits' | 'key' }

import { ok, fail, userById, now, refId, parisDay, firstAttachment } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';

export const schema = {
  GuildChestDeposits: { ClaimedBy: { type: 'Numeric' }, ClaimedAt: { type: 'Numeric' } },
  Users: { GuildCredits: { type: 'Numeric' }, GCDay: { type: 'Text' }, GCDeposits: { type: 'Numeric' }, GCTakes: { type: 'Numeric' }, GCFreeDay: { type: 'Text' } }
};

const FINISH_MULT = { normal: 1, holo: 1.5, gold: 2, ghost: 3, diamond: 4, rainbow: 6 };
const QUALITY_MULT = { damaged: 1, worn: 1, good: 1.2, mint: 1.5 };
const weekStart = (w) => Math.floor(new Date(w + 'T00:00:00+02:00').getTime() / 1000);

function rarityMap(store) { return new Map(store.getAll('Rarities').map((r) => [r.id, r])); }
function valueOf(store, card, finish, quality, rarities = rarityMap(store)) {
  const r = card ? rarities.get(refId(card.Rarity)) : null;
  const base = Number(setting(store, 'GuildChestValues')[r ? r.Key : 'commune']) || 1;
  return Math.max(1, Math.round(base * (FINISH_MULT[finish || 'normal'] || 1) * (QUALITY_MULT[quality || 'damaged'] || 1)));
}
const takeCost = (store, value) => Math.max(1, Math.ceil(value * setting(store, 'GuildChestTakeMult')));
function today(user) {
  const day = parisDay(0);
  return user.GCDay === day ? { deposits: Number(user.GCDeposits) || 0, takes: Number(user.GCTakes) || 0 } : { deposits: 0, takes: 0 };
}
const FINISH_RANK = { normal: 0, holo: 1, gold: 2, ghost: 3, diamond: 4, rainbow: 5 };
const QUALITY_RANK = { damaged: 0, worn: 1, good: 2, mint: 3 };
const protectedPull = (p) => p.InVault || p.Starred || p.Insured || p.Edition;

function cardView(card, rarities) {
  const r = rarities.get(refId(card.Rarity));
  return { cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image), rarity: r ? { key: r.Key, name: r.Name, colorHex: r.ColorHex, sortOrder: r.SortOrder || 0 } : null };
}

function view(store, user) {
  const rarities = rarityMap(store);
  const cards = new Map(store.getAll('Cards').map((c) => [c.id, c]));
  const myPulls = store.getAll('Pulls').filter((p) => refId(p.User) === user.id);
  const ownedCount = new Map();
  myPulls.forEach((p) => ownedCount.set(refId(p.Card), (ownedCount.get(refId(p.Card)) || 0) + 1));
  const deposits = store.getAll('GuildChestDeposits');
  const t = today(user);
  const pool = deposits.filter((d) => !d.Claimed).map((d) => {
    const card = cards.get(refId(d.CardId));
    if (!card) return null;
    const value = valueOf(store, card, d.Finish, d.Quality, rarities);
    return { depositId: d.id, ...cardView(card, rarities), serialNumber: d.SerialNumber, finish: d.Finish || 'normal', quality: d.Quality || 'damaged', value, cost: takeCost(store, value), mine: refId(d.User) === user.id, owned: ownedCount.get(card.id) || 0 };
  }).filter(Boolean).sort((a, b) => (b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0) || a.name.localeCompare(b.name));
  // Exemplaire garde d'office par carte (2026-10-18) : un exemplaire protege ou
  // un #001 suffit ; sinon le meilleur (finition, puis etat, puis plus petit
  // numero). Tout le reste est deposable sans conflit entre groupes : avant,
  // chaque groupe autorisait "exemplaires - 1" et une selection multiple sur
  // deux finitions de la meme carte finissait en last_copy.
  const keep = new Set();
  const byCard = new Map();
  myPulls.forEach((p) => { const k = refId(p.Card); if (!byCard.has(k)) byCard.set(k, []); byCard.get(k).push(p); });
  for (const list of byCard.values()) {
    if (list.some((p) => protectedPull(p) || p.SerialNumber === 1)) continue;
    const best = [...list].sort((a, b) => (FINISH_RANK[b.Finish] || 0) - (FINISH_RANK[a.Finish] || 0) || (QUALITY_RANK[b.Quality] || 0) - (QUALITY_RANK[a.Quality] || 0) || (Number(a.SerialNumber) || 1e9) - (Number(b.SerialNumber) || 1e9))[0];
    keep.add(best.id);
  }
  // Doublons deposables, par carte + finition + etat.
  const groups = new Map();
  myPulls.forEach((p) => {
    const card = cards.get(refId(p.Card));
    if (!card || card.IsPromo || protectedPull(p) || keep.has(p.id)) return;
    const k = `${card.id}|${p.Finish || 'normal'}|${p.Quality || 'damaged'}`;
    if (!groups.has(k)) groups.set(k, { ...cardView(card, rarities), finish: p.Finish || 'normal', quality: p.Quality || 'damaged', pullIds: [], value: valueOf(store, card, p.Finish, p.Quality, rarities) });
    groups.get(k).pullIds.push({ id: p.id, serial: p.SerialNumber });
  });
  const donatable = [...groups.values()].map((g) => {
    // Jamais un #001 (l'exemplaire garde est deja exclu ci-dessus).
    const sorted = g.pullIds.sort((a, b) => (b.serial || 0) - (a.serial || 0)).filter((x) => x.serial !== 1);
    return sorted.length ? { ...g, pullIds: sorted.map((x) => x.id), count: sorted.length } : null;
  }).filter(Boolean).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const since = weekStart(weekKey());
  const users = new Map(store.getAll('Users').map((u) => [u.id, u]));
  const donors = new Map();
  deposits.filter((d) => (Number(d.DepositedAt) || 0) >= since).forEach((d) => donors.set(refId(d.User), (donors.get(refId(d.User)) || 0) + 1));
  return {
    credits: Number(user.GuildCredits) || 0, keys: Number(user.KeyCount) || 0,
    depositsLeft: Math.max(0, setting(store, 'GuildChestDepositsPerDay') - t.deposits), takesLeft: Math.max(0, setting(store, 'GuildChestTakesPerDay') - t.takes),
    depositsPerDay: setting(store, 'GuildChestDepositsPerDay'), takesPerDay: setting(store, 'GuildChestTakesPerDay'),
    freeAvailable: user.GCFreeDay !== parisDay(0) && pool.some((p) => !p.mine),
    pool, donatable,
    donors: [...donors].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ pseudo: users.get(id)?.Pseudo || '?', n }))
  };
}

function giveCard(store, user, d, tag) {
  store.create('Pulls', { User: user.id, Card: refId(d.CardId), SerialNumber: d.SerialNumber, Finish: d.Finish || 'normal', Quality: d.Quality || 'damaged', ObtainedAt: now(), BatchId: `guildchest-${tag}-${user.id}-${Date.now()}` });
  store.update('GuildChestDeposits', d.id, { Claimed: true, ClaimedBy: user.id, ClaimedAt: now() });
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(view(store, user));
  const day = parisDay(0);
  const t = today(user);
  const rarities = rarityMap(store);
  const cards = new Map(store.getAll('Cards').map((c) => [c.id, c]));

  if (action === 'deposit') {
    const ids = [...new Set((Array.isArray(body.pullIds) ? body.pullIds : [body.pullId]).map(Number).filter(Boolean))];
    if (!ids.length) return fail('nothing_selected');
    const left = setting(store, 'GuildChestDepositsPerDay') - t.deposits;
    if (left <= 0) return fail('deposit_limit', 400, view(store, user));
    if (ids.length > left) return fail('deposit_limit', 400, { ...view(store, user), max: left });
    const mine = store.getAll('Pulls').filter((p) => refId(p.User) === user.id);
    const byId = new Map(mine.map((p) => [p.id, p]));
    const pulls = ids.map((id) => byId.get(id));
    if (pulls.some((p) => !p)) return fail('card_not_owned', 400, view(store, user));
    const count = new Map();
    mine.forEach((p) => count.set(refId(p.Card), (count.get(refId(p.Card)) || 0) + 1));
    for (const p of pulls) {
      const card = cards.get(refId(p.Card));
      if (!card || card.IsPromo) return fail('promo_not_donatable', 400, view(store, user));
      if (protectedPull(p)) return fail('protected_copy', 400, view(store, user));
      count.set(card.id, count.get(card.id) - 1);
      if (count.get(card.id) < 1) return fail('last_copy', 400, view(store, user));
    }
    let credits = 0;
    for (const p of pulls) {
      const card = cards.get(refId(p.Card));
      credits += valueOf(store, card, p.Finish, p.Quality, rarities);
      store.create('GuildChestDeposits', { User: user.id, CardId: card.id, SerialNumber: p.SerialNumber, Finish: p.Finish || 'normal', Quality: p.Quality || 'damaged', DepositedAt: now(), Claimed: false });
      store.delete('Pulls', p.id);
    }
    user = store.update('Users', user.id, { GuildCredits: (Number(user.GuildCredits) || 0) + credits, GCDay: day, GCDeposits: t.deposits + pulls.length, GCTakes: t.takes });
    return ok({ ...view(store, user), deposited: pulls.length, creditsGained: credits });
  }

  if (action === 'take') {
    const d = store.get('GuildChestDeposits', Number(body.depositId));
    if (!d || d.Claimed) return fail('deposit_unavailable', 400, view(store, user));
    if (refId(d.User) === user.id) return fail('own_deposit', 400, view(store, user));
    if (setting(store, 'GuildChestTakesPerDay') - t.takes <= 0) return fail('take_limit', 400, view(store, user));
    const card = cards.get(refId(d.CardId));
    const cost = takeCost(store, valueOf(store, card, d.Finish, d.Quality, rarities));
    const fields = { GCDay: day, GCDeposits: t.deposits, GCTakes: t.takes + 1 };
    if (body.pay === 'key') {
      if ((Number(user.KeyCount) || 0) < 1) return fail('no_key', 400, view(store, user));
      fields.KeyCount = Number(user.KeyCount) - 1;
    } else {
      if ((Number(user.GuildCredits) || 0) < cost) return fail('not_enough_credits', 400, { ...view(store, user), cost });
      fields.GuildCredits = Number(user.GuildCredits) - cost;
    }
    giveCard(store, user, d, body.pay === 'key' ? 'key' : 'credits');
    user = store.update('Users', user.id, fields);
    return ok({ ...view(store, user), taken: { ...cardView(card, rarities), serialNumber: d.SerialNumber, finish: d.Finish || 'normal', quality: d.Quality || 'damaged', paid: body.pay === 'key' ? 'key' : cost } });
  }

  if (action === 'free') {
    if (user.GCFreeDay === day) return fail('already_drawn_today', 400, view(store, user));
    const pool = store.getAll('GuildChestDeposits').filter((x) => !x.Claimed && refId(x.User) !== user.id);
    if (!pool.length) return fail('chest_empty', 400, view(store, user));
    const d = pool[Math.floor(Math.random() * pool.length)];
    giveCard(store, user, d, 'free');
    user = store.update('Users', user.id, { GCFreeDay: day });
    const card = cards.get(refId(d.CardId));
    return ok({ ...view(store, user), taken: { ...cardView(card, rarities), serialNumber: d.SerialNumber, finish: d.Finish || 'normal', quality: d.Quality || 'damaged', paid: 'free' } });
  }
  return fail('unknown_action');
}

export const routes = { 'POST guild-chest': handle };
