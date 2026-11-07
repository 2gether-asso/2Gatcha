// Collection V2 (2026-11-07).
//
// 1) PAGES D'ALBUM : les cartes actives (hors promo) de chaque extension,
//    dans l'ordre du catalogue (Cards.SortOrder > 0 d'abord, puis rarete,
//    puis creation : le meme ordre que les numeros #001 du site), sont
//    rangees par pages de AlbumPageSize cartes. Une page dont toutes les
//    cartes sont decouvertes (en collection OU au coffre-fort) rapporte une
//    fois AlbumPageBoosters jetons + AlbumPageDust poussieres.
//      POST /webhook/album-pages { userId, action: 'status' | 'claim' | 'claimAll', extensionId?, page? }
//    Les recompenses sont retenues par (extension, numero de page) : changer
//    la taille des pages ne redonne pas les pages deja payees.
//
// 2) ORDRE DE LA VITRINE : le workflow showcase ne sait qu'ajouter / retirer
//    (ordre d'ajout). L'action 'order' { cardIds: [...] } est traitee ici
//    (beforeWorkflow) : SortOrder reecrit dans l'ordre demande, les cartes
//    non citees gardent leur ordre a la suite. Reponse au format du workflow
//    ({ showcase: [...] }) + ordered: true (un ancien serveur repondrait la
//    liste sans ce drapeau : le site retombe alors sur retirer / remettre).

import { refId, now, ok, fail, userById, userPulls, firstAttachment } from './common.js';
import { setting } from './settings.js';

export const schema = {
  AlbumPageClaims: { User: { type: 'Ref:Users' }, Extension: { type: 'Ref:Extensions' }, Page: { type: 'Numeric' }, ClaimedAt: { type: 'Numeric' }, Boosters: { type: 'Numeric' }, Dust: { type: 'Numeric' } }
};

// ------------------------------------------------------------ pages d'album
export function albumPages(store, userId) {
  const size = Math.max(1, setting(store, 'AlbumPageSize'));
  const reward = { boosters: setting(store, 'AlbumPageBoosters'), dust: setting(store, 'AlbumPageDust') };
  const found = new Set(userPulls(store, userId).map((p) => refId(p.Card)));
  const claims = new Set(store.getAll('AlbumPageClaims').filter((r) => refId(r.User) === userId).map((r) => `${refId(r.Extension)}:${r.Page}`));
  const rarityOrder = new Map(store.getAll('Rarities').map((r) => [r.id, r.SortOrder ?? 999]));
  const byExt = new Map();
  for (const c of store.getAll('Cards')) {
    if (!c.Active || c.IsPromo) continue;
    const ext = refId(c.Extension);
    if (!ext) continue;
    if (!byExt.has(ext)) byExt.set(ext, []);
    byExt.get(ext).push(c);
  }
  const order = (c) => (Number(c.SortOrder) > 0 ? Number(c.SortOrder) : 1e9);
  const extensions = [];
  for (const ext of store.getAll('Extensions')) {
    const cards = (byExt.get(ext.id) || []).sort((a, b) => order(a) - order(b) || (rarityOrder.get(refId(a.Rarity)) ?? 999) - (rarityOrder.get(refId(b.Rarity)) ?? 999) || a.id - b.id);
    if (!cards.length) continue;
    const pages = [];
    for (let i = 0; i < cards.length; i += size) {
      const ids = cards.slice(i, i + size).map((c) => c.id);
      const page = pages.length + 1;
      const owned = ids.filter((id) => found.has(id)).length;
      pages.push({ page, cardIds: ids, owned, total: ids.length, complete: owned === ids.length, claimed: claims.has(`${ext.id}:${page}`) });
    }
    extensions.push({ extensionId: ext.id, name: ext.Name, key: ext.Key, sortOrder: Number(ext.SortOrder) || 0, pages, claimable: pages.filter((p) => p.complete && !p.claimed).length });
  }
  extensions.sort((a, b) => a.sortOrder - b.sortOrder || a.extensionId - b.extensionId);
  return { size, reward, extensions, claimable: extensions.reduce((n, e) => n + e.claimable, 0) };
}

function payPages(store, userId, list) {
  const st = albumPages(store, userId);
  const { boosters, dust } = st.reward;
  for (const { extensionId, page } of list) store.create('AlbumPageClaims', { User: userId, Extension: extensionId, Page: page, ClaimedAt: now(), Boosters: boosters, Dust: dust });
  const u = store.get('Users', userId);
  store.update('Users', userId, { BoosterCount: (Number(u.BoosterCount) || 0) + boosters * list.length, StardustCount: (Number(u.StardustCount) || 0) + dust * list.length });
  return { pages: list.length, boosters: boosters * list.length, dust: dust * list.length };
}

function handleAlbum({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = String(body.action || 'status');
  const st = albumPages(store, user.id);
  if (action === 'status') return ok(st);
  if (action === 'claim') {
    const ext = st.extensions.find((e) => e.extensionId === Number(body.extensionId));
    const page = ext && ext.pages.find((p) => p.page === Number(body.page));
    if (!page) return fail('unknown_page');
    if (!page.complete) return fail('page_incomplete', 400, { owned: page.owned, total: page.total });
    if (page.claimed) return fail('already_claimed');
    const gained = payPages(store, user.id, [{ extensionId: ext.extensionId, page: page.page }]);
    return ok({ claimed: gained, extensionName: ext.name, page: page.page, ...albumPages(store, user.id) });
  }
  if (action === 'claimAll') {
    const list = st.extensions.flatMap((e) => e.pages.filter((p) => p.complete && !p.claimed).map((p) => ({ extensionId: e.extensionId, page: p.page })));
    if (!list.length) return fail('nothing_to_claim');
    const gained = payPages(store, user.id, list);
    return ok({ claimed: gained, ...albumPages(store, user.id) });
  }
  return fail('unknown_action');
}

// ------------------------------------------------------------ vitrine : ordre
function showcaseList(store, userId) {
  const cards = new Map(store.getAll('Cards').map((c) => [c.id, c]));
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  return store.getAll('ProfileShowcase').filter((r) => refId(r.User) === userId).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0) || a.id - b.id).map((r) => {
    const card = cards.get(refId(r.Card));
    if (!card) return null;
    const rarity = rarities.get(refId(card.Rarity));
    return { cardId: card.id, name: card.Name, artist: card.Artist, imageId: firstAttachment(card.Image), rarity: rarity ? { key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex } : null };
  }).filter(Boolean);
}

export function beforeWorkflow({ store, path, request }) {
  if (path !== 'showcase') return null;
  const body = (request && request.body) || {};
  if (body.action !== 'order') return null;
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if (!store.tables.has('ProfileShowcase')) return ok({ showcase: [], ordered: true });
  const wanted = (Array.isArray(body.cardIds) ? body.cardIds : []).map(Number).filter(Number.isFinite);
  const mine = store.getAll('ProfileShowcase').filter((r) => refId(r.User) === user.id).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0) || a.id - b.id);
  const rank = (r) => { const i = wanted.indexOf(refId(r.Card)); return i < 0 ? 1000 : i; };
  const next = mine.slice().sort((a, b) => rank(a) - rank(b) || mine.indexOf(a) - mine.indexOf(b));
  next.forEach((r, i) => { if ((r.SortOrder || 0) !== i) store.update('ProfileShowcase', r.id, { SortOrder: i }); });
  return ok({ showcase: showcaseList(store, user.id), ordered: true });
}

export const routes = { 'POST album-pages': handleAlbum };
