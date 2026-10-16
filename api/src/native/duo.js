// Expedition en duo (2026-10-15) : un joueur invite un autre joueur en
// choisissant une de ses cartes ; l'invite accepte avec une des siennes.
// L'expedition dure DuoExpeditionHours ; au retour, chacun recupere le meme
// butin (poussieres selon la rarete des deux cartes, XP d'expedition, une
// chance de booster). Les cartes ne sont pas consommees. Une expedition en
// duo a la fois par joueur ; invitation valable 48 h.
//   POST /webhook/duo-expedition { userId, action: 'status' | 'invite' | 'accept' | 'decline' | 'cancel' | 'claim', toPseudo?, pullId?, id? }

import { refId, now, ok, fail, userById, parseJson, cardSummary } from './common.js';
import { setting } from './settings.js';
import { addFeed } from './feed.js';

export const schema = {
  DuoExpeditions: {
    From: { type: 'Ref:Users' }, To: { type: 'Ref:Users' }, FromPull: { type: 'Numeric' }, ToPull: { type: 'Numeric' },
    FromCard: { type: 'Ref:Cards' }, ToCard: { type: 'Ref:Cards' }, Status: { type: 'Text' },
    CreatedAt: { type: 'Numeric' }, StartAt: { type: 'Numeric' }, EndAt: { type: 'Numeric' },
    FromClaimed: { type: 'Bool' }, ToClaimed: { type: 'Bool' }, Loot: { type: 'Text' }
  }
};

const INVITE_TTL = 48 * 3600;
const rows = (store) => (store.tables.has('DuoExpeditions') ? store.getAll('DuoExpeditions') : []);
const expired = (d, t = now()) => d.Status === 'invited' && (Number(d.CreatedAt) || 0) + INVITE_TTL < t;
const role = (d, uid) => (refId(d.From) === uid ? 'from' : refId(d.To) === uid ? 'to' : null);
// Encore en cours pour ce joueur (invitation envoyee, expedition, butin pas recupere).
function busy(d, uid) {
  const r = role(d, uid);
  if (!r || expired(d) || ['declined', 'cancelled'].includes(d.Status)) return false;
  if (d.Status === 'invited') return r === 'from';
  return d.Status === 'running' && !(r === 'from' ? d.FromClaimed : d.ToClaimed);
}

function ownPull(store, uid, pullId) {
  const p = store.get('Pulls', Number(pullId));
  return p && refId(p.User) === uid ? p : null;
}
function sortOfCard(store, cardId) {
  const c = store.get('Cards', cardId);
  const r = c ? store.get('Rarities', refId(c.Rarity)) : null;
  return r ? Number(r.SortOrder) || 0 : 0;
}

function view(store, d, uid) {
  const users = (id) => (store.get('Users', refId(id)) || {}).Pseudo || '?';
  const card = (id) => { const c = id ? store.get('Cards', refId(id)) : null; return c ? cardSummary(store, c) : null; };
  const r = role(d, uid);
  const t = now();
  return {
    id: d.id, role: r, status: expired(d) ? 'expired' : d.Status,
    from: users(d.From), to: users(d.To), fromCard: card(d.FromCard), toCard: card(d.ToCard),
    createdAt: d.CreatedAt, startAt: d.StartAt || null, endAt: d.EndAt || null,
    ready: d.Status === 'running' && t >= (Number(d.EndAt) || 0),
    claimed: r === 'from' ? !!d.FromClaimed : !!d.ToClaimed,
    loot: d.Status === 'running' ? parseJson(d.Loot, null) : null
  };
}

function stateOf(store, uid) {
  const mine = rows(store).filter((d) => role(d, uid) && !expired(d) && !['declined', 'cancelled'].includes(d.Status) && !(d.Status === 'running' && (role(d, uid) === 'from' ? d.FromClaimed : d.ToClaimed)))
    .sort((a, b) => b.id - a.id);
  return { enabled: !!setting(store, 'DuoExpeditionEnabled'), hours: setting(store, 'DuoExpeditionHours'), busy: rows(store).some((d) => busy(d, uid)), items: mine.map((d) => view(store, d, uid)) };
}

function handleDuo({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const uid = user.id;
  const action = body.action || 'status';
  if (action === 'status') return ok(stateOf(store, uid));
  if (!setting(store, 'DuoExpeditionEnabled')) return fail('duo_closed');
  const t = now();
  if (action === 'invite') {
    if (rows(store).some((d) => busy(d, uid))) return fail('already_busy', 400, stateOf(store, uid));
    const to = store.getAll('Users').find((u) => String(u.Pseudo || '').toLowerCase() === String(body.toPseudo || '').trim().toLowerCase());
    if (!to || to.id === uid) return fail('unknown_partner');
    const pull = ownPull(store, uid, body.pullId);
    if (!pull) return fail('invalid_card');
    store.create('DuoExpeditions', { From: uid, To: to.id, FromPull: pull.id, FromCard: refId(pull.Card), Status: 'invited', CreatedAt: t, FromClaimed: false, ToClaimed: false });
    return ok({ ...stateOf(store, uid), invited: to.Pseudo });
  }
  const d = store.tables.has('DuoExpeditions') ? store.get('DuoExpeditions', Number(body.id)) : null;
  if (!d || !role(d, uid)) return fail('unknown_duo', 404);
  if (action === 'accept') {
    if (role(d, uid) !== 'to' || d.Status !== 'invited' || expired(d)) return fail('not_pending', 400, stateOf(store, uid));
    if (rows(store).some((x) => x.id !== d.id && busy(x, uid))) return fail('already_busy', 400, stateOf(store, uid));
    const pull = ownPull(store, uid, body.pullId);
    if (!pull) return fail('invalid_card');
    // L'inviteur a-t-il encore sa carte ?
    const fromPull = store.get('Pulls', Number(d.FromPull));
    const fromCard = fromPull && refId(fromPull.User) === refId(d.From) ? refId(fromPull.Card) : refId(d.FromCard);
    const power = sortOfCard(store, fromCard) + sortOfCard(store, refId(pull.Card));
    const loot = {
      dust: Math.round(setting(store, 'DuoExpeditionDust') * (1 + power / 8)),
      xp: 40 + power * 5,
      booster: Math.random() < Math.min(0.6, 0.2 + power * 0.03) ? 1 : 0
    };
    const hours = setting(store, 'DuoExpeditionHours');
    store.update('DuoExpeditions', d.id, { To: uid, ToPull: pull.id, ToCard: refId(pull.Card), Status: 'running', StartAt: t, EndAt: t + hours * 3600, Loot: JSON.stringify(loot) });
    addFeed(store, { userId: uid, kind: 'duo', icon: '👯', text: `part en expédition en duo avec ${(store.get('Users', refId(d.From)) || {}).Pseudo || '?'} !` });
    return ok({ ...stateOf(store, uid), accepted: d.id });
  }
  if (action === 'decline' || action === 'cancel') {
    if (d.Status !== 'invited') return fail('not_pending', 400, stateOf(store, uid));
    if (action === 'decline' && role(d, uid) !== 'to') return fail('forbidden', 403);
    if (action === 'cancel' && role(d, uid) !== 'from') return fail('forbidden', 403);
    store.update('DuoExpeditions', d.id, { Status: action === 'decline' ? 'declined' : 'cancelled' });
    return ok(stateOf(store, uid));
  }
  if (action === 'claim') {
    const r = role(d, uid);
    if (d.Status !== 'running' || t < (Number(d.EndAt) || 0)) return fail('not_ready', 400, stateOf(store, uid));
    if (r === 'from' ? d.FromClaimed : d.ToClaimed) return fail('already_claimed', 400, stateOf(store, uid));
    const loot = parseJson(d.Loot, { dust: 0, xp: 0, booster: 0 });
    const u = store.get('Users', uid);
    store.update('Users', uid, {
      StardustCount: (Number(u.StardustCount) || 0) + loot.dust,
      ExpeditionXP: (Number(u.ExpeditionXP) || 0) + loot.xp,
      ...(loot.booster ? { BoosterCount: (Number(u.BoosterCount) || 0) + loot.booster } : {})
    });
    store.update('DuoExpeditions', d.id, r === 'from' ? { FromClaimed: true } : { ToClaimed: true });
    return ok({ ...stateOf(store, uid), loot });
  }
  return fail('unknown_action');
}

export const routes = { 'POST duo-expedition': handleDuo };
