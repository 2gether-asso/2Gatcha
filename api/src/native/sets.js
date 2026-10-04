// Recompense de set complet : posseder (en collection OU au coffre-fort)
// toutes les cartes non promo d'une extension debloque une recompense
// unique (boosters + poussieres), et un badge "set complet" visible sur le
// profil public.
//   POST /webhook/set-rewards  { userId, action: 'status' | 'claim', extensionId? }
//   GET  /webhook/set-completions?pseudo=...   (profil public)

import { refId, now, ok, fail, configRow, userById, userPulls } from './common.js';

export const schema = {
  SetCompletions: { User: { type: 'Ref:Users' }, Extension: { type: 'Ref:Extensions' }, ClaimedAt: { type: 'Numeric' }, Boosters: { type: 'Numeric' }, Dust: { type: 'Numeric' } },
  Config: { SetRewardBoosters: { type: 'Numeric' }, SetRewardDust: { type: 'Numeric' } }
};

function rewardFor(store) {
  const cfg = configRow(store);
  return { boosters: cfg.SetRewardBoosters || 3, dust: cfg.SetRewardDust || 300 };
}

// Etat de chaque extension pour un joueur.
export function setStatus(store, userId) {
  const owned = new Set(userPulls(store, userId).map((p) => refId(p.Card)));
  const claimed = new Map(store.getAll('SetCompletions').filter((r) => refId(r.User) === Number(userId)).map((r) => [refId(r.Extension), r]));
  const byExt = new Map();
  for (const c of store.getAll('Cards')) {
    if (!c.Active || c.IsPromo) continue;
    const ext = refId(c.Extension);
    if (!ext) continue;
    if (!byExt.has(ext)) byExt.set(ext, []);
    byExt.get(ext).push(c.id);
  }
  const reward = rewardFor(store);
  const sets = [];
  for (const ext of store.getAll('Extensions')) {
    const cards = byExt.get(ext.id) || [];
    if (!cards.length) continue;
    const have = cards.filter((id) => owned.has(id)).length;
    const claim = claimed.get(ext.id);
    sets.push({
      extensionId: ext.id, name: ext.Name, key: ext.Key, sortOrder: ext.SortOrder || 0,
      owned: have, total: cards.length, complete: have === cards.length,
      claimed: !!claim, claimedAt: claim ? claim.ClaimedAt : null,
      reward
    });
  }
  sets.sort((a, b) => a.sortOrder - b.sortOrder || String(a.name).localeCompare(String(b.name)));
  return { sets, claimable: sets.filter((s) => s.complete && !s.claimed).length, reward };
}

function handleSetRewards({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const status = setStatus(store, user.id);
  if (body.action !== 'claim') return ok(status);

  const set = status.sets.find((s) => s.extensionId === Number(body.extensionId));
  if (!set) return fail('unknown_extension');
  if (!set.complete) return fail('set_incomplete', 400, { owned: set.owned, total: set.total });
  if (set.claimed) return fail('already_claimed');
  const { boosters, dust } = set.reward;
  store.create('SetCompletions', { User: user.id, Extension: set.extensionId, ClaimedAt: now(), Boosters: boosters, Dust: dust });
  const updated = store.update('Users', user.id, {
    BoosterCount: (user.BoosterCount || 0) + boosters,
    StardustCount: (user.StardustCount || 0) + dust
  });
  return ok({ claimed: true, extensionId: set.extensionId, name: set.name, boosters, dust, newBoosterCount: updated.BoosterCount, newStardust: updated.StardustCount, ...setStatus(store, user.id) });
}

function handleSetCompletions({ store, query }) {
  const pseudo = String(query.pseudo || '').trim().toLowerCase();
  const user = store.getAll('Users').find((u) => String(u.Pseudo || '').trim().toLowerCase() === pseudo);
  if (!user) return fail('user_not_found', 404);
  const exts = new Map(store.getAll('Extensions').map((e) => [e.id, e]));
  const sets = store.getAll('SetCompletions')
    .filter((r) => refId(r.User) === user.id && exts.has(refId(r.Extension)))
    .map((r) => ({ extensionId: refId(r.Extension), name: exts.get(refId(r.Extension)).Name, claimedAt: r.ClaimedAt }))
    .sort((a, b) => (a.claimedAt || 0) - (b.claimedAt || 0));
  return ok({ sets });
}

export const routes = {
  'POST set-rewards': handleSetRewards,
  'GET set-completions': handleSetCompletions
};
