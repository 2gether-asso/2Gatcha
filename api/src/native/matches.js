// Correspondances d'echange : croise les doublons des joueurs avec les
// wishlists. "Untel a en double une carte de ta wishlist, et toi un doublon
// de la sienne." Sans wishlist, on retombe sur ses doublons que tu n'as pas
// du tout. Un seul appel au lieu de telecharger 15 profils publics.
//   POST /webhook/trade-matches  { userId, action: 'list' }

import { refId, ok, fail, userById, cardSummary } from './common.js';

function handleMatches({ store, body }) {
  const me = userById(store, body.userId);
  if (!me) return fail('unknown_user', 404);
  const cards = new Map(store.getAll('Cards').filter((c) => c.Active && !c.IsPromo).map((c) => [c.id, c]));

  // Exemplaires echangeables (hors coffre-fort) par joueur et par carte.
  const counts = new Map();
  for (const p of store.getAll('Pulls')) {
    if (p.InVault) continue;
    const cid = refId(p.Card);
    if (!cards.has(cid)) continue;
    const uid = refId(p.User);
    if (!counts.has(uid)) counts.set(uid, new Map());
    const m = counts.get(uid);
    m.set(cid, (m.get(cid) || 0) + 1);
  }
  const wish = new Map();
  if (store.tables.has('Wishlist')) {
    for (const w of store.getAll('Wishlist')) {
      const uid = refId(w.User);
      if (!wish.has(uid)) wish.set(uid, new Set());
      wish.get(uid).add(refId(w.Card));
    }
  }
  const mine = counts.get(me.id) || new Map();
  const myWish = wish.get(me.id) || new Set();
  const myDupes = [...mine].filter(([, n]) => n >= 2).map(([cid]) => cid);

  const matches = [];
  for (const u of store.getAll('Users')) {
    if (u.id === me.id || !u.Pseudo) continue;
    const theirs = counts.get(u.id) || new Map();
    const theirWish = wish.get(u.id) || new Set();
    const theirDupes = [...theirs].filter(([, n]) => n >= 2).map(([cid]) => cid);
    // Ce qu'il peut me donner : ses doublons dans ma wishlist (sinon ses
    // doublons que je n'ai pas du tout).
    const fromWish = theirDupes.filter((cid) => myWish.has(cid));
    const theyHave = fromWish.length ? fromWish : theirDupes.filter((cid) => !mine.has(cid));
    // Ce que je peux lui donner : mes doublons dans sa wishlist.
    const iHave = myDupes.filter((cid) => theirWish.has(cid));
    if (!theyHave.length && !iHave.length) continue;
    const mutual = theyHave.length > 0 && iHave.length > 0;
    matches.push({
      userId: u.id, pseudo: u.Pseudo, mutual, wishlistMatch: fromWish.length > 0,
      theyHave: theyHave.slice(0, 6).map((cid) => cardSummary(store, cards.get(cid))),
      iHave: iHave.slice(0, 6).map((cid) => cardSummary(store, cards.get(cid))),
      score: (mutual ? 100 : 0) + fromWish.length * 10 + iHave.length * 5 + theyHave.length
    });
  }
  matches.sort((a, b) => b.score - a.score || a.pseudo.localeCompare(b.pseudo));
  return ok({ matches: matches.slice(0, 10).map(({ score, ...m }) => m), wishlistSize: myWish.size });
}

export const routes = { 'POST trade-matches': handleMatches };
