// Social (2026-10-05) :
//  - fiche carte enrichie : exemplaires en circulation, proprietaires, ou
//    l'obtenir, qui la cherche (liste de souhaits) ;
//      GET  /webhook/card-info ?cardId=&userId=
//  - alertes de liste de souhaits : cartes souhaitees disponibles au marche
//    noir, au coffre de guilde ou en double chez un autre joueur ;
//      POST /webhook/wishlist-alerts { userId }
//  - profil public plus vivant : statistiques, decorations, succes, mur de
//    messages.
//      GET  /webhook/profile-wall ?profileId=
//      POST /webhook/profile-wall { userId, action: 'post' | 'delete', profileId?, text?, messageId? }

import { refId, now, ok, fail, userById, cardSummary } from './common.js';
import { setting } from './settings.js';
import { decorations } from './cosmetics.js';
import { levelInfo, expeditionLevel, gardenLevel } from './levels.js';
import { ranksFor, tierState } from './progression.js';
import { hiddenList, themesState } from './achievements.js';
import { uniqueRarity } from './unique.js';

export const schema = {
  ProfileWall: { Profile: { type: 'Ref:Users' }, Author: { type: 'Ref:Users' }, Text: { type: 'Text' }, At: { type: 'Numeric' } }
};

const usersById = (store) => new Map(store.getAll('Users').map((u) => [u.id, u]));
const wishlistRows = (store) => (store.tables.has('Wishlist') ? store.getAll('Wishlist') : []);

function sourcesOf(store, card) {
  const rarity = card.Rarity ? store.get('Rarities', refId(card.Rarity)) : null;
  const unique = uniqueRarity(store);
  if (unique && refId(card.Rarity) === unique.id) return ['Comptoir Unique : un Ticket Unique (ligne complète du coffre-fort)'];
  if (card.IsSecret) return ['Page secrète (clés secrètes)'];
  if (card.IsVault) return ['Grand coffre-fort de l’association (6 clés)'];
  if (card.IsPromo) return ['Codes d’événement et cadeaux de l’asso'];
  const out = [];
  const ext = card.Extension && store.tables.has('Extensions') ? store.get('Extensions', refId(card.Extension)) : null;
  if (ext && ext.Active !== false) out.push(`Boosters « ${ext.Name} »`);
  if (rarity && Number(rarity.CraftCost) > 0) out.push(`Craft : ${rarity.CraftCost} poussières`);
  const sorted = store.getAll('Rarities').filter((r) => r.SortOrder != null).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  const idx = rarity ? sorted.findIndex((r) => r.id === rarity.id) : -1;
  if (idx === 0 || idx === 1) out.push('Fouille (trésors)');
  if (idx > 0 && rarity.Key !== 'unique') out.push('Autel (sacrifice de cartes de la rareté inférieure)');
  out.push('Coffres', 'Échanges entre joueurs');
  const t = now();
  if (store.tables.has('BlackMarketOffers') && store.getAll('BlackMarketOffers').some((o) => o.Active && Number(o.CardId) === card.id && (!o.ExpiresAt || o.ExpiresAt > t))) out.push('Marché noir : en vente cette semaine !');
  if (store.tables.has('GuildChestDeposits') && store.getAll('GuildChestDeposits').some((d) => !d.Claimed && Number(d.CardId) === card.id)) out.push('Coffre de guilde : un exemplaire attend !');
  return out;
}

function handleCardInfo({ store, query }) {
  const card = store.get('Cards', Number(query.cardId));
  if (!card) return fail('card_not_found', 404);
  const me = Number(query.userId) || 0;
  const users = usersById(store);
  const pulls = store.getAll('Pulls').filter((p) => refId(p.Card) === card.id);
  const counts = new Map();
  pulls.forEach((p) => counts.set(refId(p.User), (counts.get(refId(p.User)) || 0) + 1));
  const owners = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, n]) => ({ userId: id, pseudo: users.get(id)?.Pseudo || '?', avatar: users.get(id)?.DiscordAvatar || null, count: n }));
  const wishers = wishlistRows(store).filter((w) => refId(w.Card) === card.id && refId(w.User) !== me)
    .map((w) => users.get(refId(w.User))).filter(Boolean).map((u) => ({ userId: u.id, pseudo: u.Pseudo }));
  const first = refId(card.FirstObtainedBy);
  return ok({
    card: cardSummary(store, card),
    copies: pulls.length, ownersCount: counts.size, owners,
    firstObtainedBy: first ? users.get(first)?.Pseudo || null : null,
    firstObtainedById: first || null, firstObtainedAt: Number(card.FirstObtainedAt) || null,
    wishedBy: wishers, sources: sourcesOf(store, card),
    mine: me ? counts.get(me) || 0 : null
  });
}

function handleWishAlerts({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const users = usersById(store);
  const wished = new Set(wishlistRows(store).filter((w) => refId(w.User) === user.id).map((w) => refId(w.Card)));
  const t = now();
  const items = [];
  const counts = new Map();
  store.getAll('Pulls').forEach((p) => {
    if (p.InVault) return;
    const k = `${refId(p.User)}|${refId(p.Card)}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  for (const cardId of wished) {
    const card = store.get('Cards', cardId);
    if (!card) continue;
    const where = [];
    const offer = store.tables.has('BlackMarketOffers') && store.getAll('BlackMarketOffers').find((o) => o.Active && Number(o.CardId) === cardId && (!o.ExpiresAt || o.ExpiresAt > t));
    if (offer) where.push({ kind: 'market', label: `Marché noir (${offer.Cost} ✨)`, url: 'communaute.html#marche' });
    if (store.tables.has('GuildChestDeposits') && store.getAll('GuildChestDeposits').some((d) => !d.Claimed && Number(d.CardId) === cardId)) where.push({ kind: 'guild', label: 'Coffre de guilde', url: 'communaute.html#coffre' });
    for (const [k, n] of counts) {
      const [uid, cid] = k.split('|').map(Number);
      if (cid === cardId && uid !== user.id && n >= 2 && !card.IsPromo) where.push({ kind: 'player', label: `${users.get(uid)?.Pseudo || '?'} l’a en double`, pseudo: users.get(uid)?.Pseudo, url: `trade.html?to=${encodeURIComponent(users.get(uid)?.Pseudo || '')}&request=${cardId}` });
    }
    if (where.length) items.push({ card: cardSummary(store, card), where });
  }
  return ok({ items, count: items.length });
}

// --- profil -----------------------------------------------------------------
export function profileExtras(store, user) {
  const fish = levelInfo(user.FishingXP, setting(store, 'FishingLevelXpStep'));
  const dig = levelInfo(user.DigXP, setting(store, 'DigLevelXpStep'));
  const hidden = hiddenList(store, user).filter((h) => h.unlocked).map(({ key, label, icon, desc }) => ({ key, label, icon, desc }));
  const themes = themesState(store, user.id).themes.filter((t) => t.claimed).map(({ key, label, icon, title }) => ({ key, label, icon, title }));
  const unique = uniqueRarity(store);
  const uniqueCount = unique ? new Set(store.getAll('Pulls').filter((p) => refId(p.User) === user.id && refId(store.get('Cards', refId(p.Card))?.Rarity) === unique.id).map((p) => refId(p.Card))).size : 0;
  let records = {};
  try { records = JSON.parse(user.FishingRecords || '{}') || {}; } catch (e) { records = {}; }
  const fishCaught = Object.values(records).reduce((s, r) => s + (r.count || 0), 0);
  return {
    userId: user.id,
    decor: decorations(store, [user.id])[user.id] || null,
    skills: {
      fishing: { level: fish.level, prestige: Number(user.FishingPrestige) || 0, caught: fishCaught },
      dig: { level: dig.level, prestige: Number(user.DigPrestige) || 0 },
      expedition: { level: expeditionLevel(store, user).level, prestige: Number(user.ExpeditionPrestige) || 0 },
      garden: { level: gardenLevel(store, user).level, prestige: Number(user.GardenPrestige) || 0 }
    },
    rank: ranksFor(store, [user.id])[user.id],
    tiers: tierState(store, user).families.filter((f) => f.level > 0).map(({ key, label, icon, level }) => ({ key, label, icon, level })),
    hidden, themes, uniqueCount
  };
}

function wallFor(store, profileId) {
  const users = usersById(store);
  return store.getAll('ProfileWall').filter((m) => refId(m.Profile) === profileId)
    .sort((a, b) => (b.At || 0) - (a.At || 0)).slice(0, 30)
    .map((m) => { const a = users.get(refId(m.Author)); return { id: m.id, authorId: a?.id || null, pseudo: a?.Pseudo || '?', avatar: a?.DiscordAvatar || null, text: m.Text, at: m.At }; });
}

function handleWallGet({ store, query }) {
  const profileId = Number(query.profileId);
  if (!store.get('Users', profileId)) return fail('unknown_user', 404);
  return ok({ messages: wallFor(store, profileId) });
}

function handleWallPost({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if (body.action === 'delete') {
    const m = store.get('ProfileWall', Number(body.messageId));
    if (!m) return fail('not_found', 404);
    if (refId(m.Author) !== user.id && refId(m.Profile) !== user.id) return fail('forbidden', 403);
    store.delete('ProfileWall', m.id);
    return ok({ messages: wallFor(store, refId(m.Profile)) });
  }
  if (body.action !== 'post') return fail('unknown_action');
  const profileId = Number(body.profileId);
  if (!store.get('Users', profileId)) return fail('unknown_user', 404);
  // eslint-disable-next-line no-control-regex
  const text = String(body.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 280);
  if (!text) return fail('empty_message');
  const mine = store.getAll('ProfileWall').filter((m) => refId(m.Author) === user.id);
  if (mine.some((m) => (m.At || 0) > now() - 30)) return fail('slow_down');
  store.create('ProfileWall', { Profile: profileId, Author: user.id, Text: text, At: now() });
  // On ne garde que les 50 derniers messages par profil.
  store.getAll('ProfileWall').filter((m) => refId(m.Profile) === profileId).sort((a, b) => (b.At || 0) - (a.At || 0)).slice(50).forEach((m) => store.delete('ProfileWall', m.id));
  return ok({ messages: wallFor(store, profileId) });
}

export const routes = {
  'GET card-info': handleCardInfo,
  'POST wishlist-alerts': handleWishAlerts,
  'GET profile-wall': handleWallGet,
  'POST profile-wall': handleWallPost
};

// Profil public : statistiques et decorations en plus.
export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'public-profile' || response.status !== 200 || !response.json) return;
  const pseudo = String((request.query || {}).pseudo || (request.body || {}).pseudo || '').trim().toLowerCase();
  const user = store.getAll('Users').find((u) => String(u.Pseudo || '').trim().toLowerCase() === pseudo) || (response.json.userId ? store.get('Users', Number(response.json.userId)) : null);
  if (user) response.json.extras = profileExtras(store, user);
}

