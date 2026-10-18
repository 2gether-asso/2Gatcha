// Murissoir du distributeur (2026-10-18, remplace le « booster muri » qui
// recompensait les jours SANS ouvrir de booster). Au moment de retirer sa
// selection, on peut l'ouvrir tout de suite ou la laisser murir : on choisit
// la duree (RipenStages : Mur 6 h, Bien mur 24 h, Dore 72 h), les jetons de la
// selection sont mis de cote et le lot reste verrouille avec son minuteur.
// Une fois mur, on le reprend gratuitement dans le distributeur et on l'ouvre :
// chacun de ses boosters a le bonus de finition du stade (boosts.js,
// request._ripe) et, au dernier stade, une finition speciale garantie.
// Lots en meme temps : emplacements debloques par le niveau (RipenSlotLevels),
// plafonnes par difficulte (RipenMaxPoints).
//   POST /webhook/ripen { userId, action: 'status' | 'store' | 'claim' | 'cancel', items?, stage?, lotId? }

import { ok, fail, userById, now, parseJson, levelForXp, refId } from './common.js';
import { setting } from './settings.js';

export const schema = { Users: { RipenLots: { type: 'Text' }, RipeReady: { type: 'Text' } } };

const lotsOf = (user) => { const s = parseJson(user.RipenLots, []); return Array.isArray(s) ? s.filter((l) => l && l.id) : []; };
const readyOf = (user) => { const r = parseJson(user.RipeReady, null); return r && Number(r.remaining) > 0 ? r : null; };

function slotsOf(store, user) {
  const level = levelForXp(Number(user.XP) || 0);
  const levels = setting(store, 'RipenSlotLevels').slice(0, Math.max(0, setting(store, 'RipenMaxPoints')));
  return { total: levels.length, open: levels.filter((l) => level >= (Number(l) || 1)).length, nextLevel: levels.find((l) => level < (Number(l) || 1)) || null };
}

export function view(store, user) {
  const t = now();
  const stages = setting(store, 'RipenStages');
  const lots = lotsOf(user).map((l) => { const s = stages[l.stage] || stages[0]; return { ...l, label: s.label, icon: s.icon || '🍎', finish: Number(s.finish) || 0, special: !!s.special, ready: t >= l.readyAt }; });
  return { enabled: !!setting(store, 'RipenEnabled'), stages, slots: slotsOf(store, user), lots, ready: readyOf(user), tokens: Number(user.BoosterCount) || 0 };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(view(store, user));
  if (!setting(store, 'RipenEnabled')) return fail('ripen_disabled');
  const v = view(store, user);
  const lots = lotsOf(user);
  if (action === 'store') {
    const stage = Math.floor(Number(body.stage));
    const s = v.stages[stage];
    if (!s) return fail('invalid_stage');
    if (lots.length >= v.slots.open) return fail('no_slot', 400, { ...v, level: v.slots.nextLevel });
    const items = {};
    for (const [k, n] of Object.entries(body.items || {})) { const q = Math.floor(Number(n)); if (q > 0) items[k] = q; }
    const count = Object.values(items).reduce((a, b) => a + b, 0);
    if (!count) return fail('empty_selection');
    if ((Number(user.BoosterCount) || 0) < count) return fail('no_boosters', 400, v);
    const t = now();
    lots.push({ id: `${t}-${Math.floor(Math.random() * 1e6)}`, items, count, stage, at: t, readyAt: t + Math.round(Number(s.hours) * 3600) });
    user = store.update('Users', user.id, { BoosterCount: (Number(user.BoosterCount) || 0) - count, RipenLots: JSON.stringify(lots) });
    return ok({ ...view(store, user), stored: count, newBoosterCount: user.BoosterCount });
  }
  const lot = lots.find((l) => l.id === body.lotId);
  if (!lot) return fail('unknown_lot', 400, v);
  const rest = lots.filter((l) => l.id !== lot.id);
  if (action === 'cancel') {
    if (now() >= lot.readyAt) return fail('lot_ready', 400, v);
    user = store.update('Users', user.id, { BoosterCount: (Number(user.BoosterCount) || 0) + lot.count, RipenLots: JSON.stringify(rest) });
    return ok({ ...view(store, user), cancelled: lot.id, newBoosterCount: user.BoosterCount });
  }
  if (action === 'claim') {
    if (now() < lot.readyAt) return fail('lot_not_ready', 400, v);
    if (readyOf(user)) return fail('ripe_waiting', 400, v);
    const s = v.stages[lot.stage] || v.stages[0];
    const ripe = { lotId: lot.id, label: s.label, icon: s.icon || '🍎', finish: Number(s.finish) || 0, special: !!s.special, remaining: lot.count };
    // Les jetons reviennent, marques murs : le lot s'ouvre avec le panier du distributeur.
    user = store.update('Users', user.id, { BoosterCount: (Number(user.BoosterCount) || 0) + lot.count, RipenLots: JSON.stringify(rest), RipeReady: JSON.stringify(ripe) });
    return ok({ ...view(store, user), claimed: lot, ripe, newBoosterCount: user.BoosterCount });
  }
  return fail('unknown_action');
}

// Ouverture : tant qu'il reste des boosters murs, chacun a le bonus du stade.
export function beforeWorkflow({ store, path, request }) {
  const body = request.body || {};
  if (path !== 'open-pack' || body.dryRun) return null;
  const user = store.get('Users', Number(body.userId));
  const ripe = user && readyOf(user);
  if (ripe) { request._ripe = ripe.finish; request._ripeInfo = ripe; }
  return null;
}

export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'open-pack' || response.status !== 200 || !response.json || !Array.isArray(response.json.cards) || !request._ripeInfo) return;
  const json = response.json;
  const userId = Number((request.body || {}).userId);
  const info = request._ripeInfo;
  const remaining = Math.max(0, Number(info.remaining) - 1);
  store.update('Users', userId, { RipeReady: remaining ? JSON.stringify({ ...info, remaining }) : '' });
  let guaranteed = false;
  // Dernier stade : une finition speciale garantie (sur la carte la plus rare) si aucune n'est sortie.
  if (info.special && json.cards.length && !json.cards.some((c) => (c.finish || 'normal') !== 'normal')) {
    const finishes = store.tables.has('Finishes') ? store.getAll('Finishes').filter((f) => f.Key !== 'normal' && (f.DropWeight || 0) > 0) : [];
    const total = finishes.reduce((s, f) => s + (f.DropWeight || 0), 0);
    if (total) {
      let roll = Math.random() * total, key = finishes[finishes.length - 1].Key;
      for (const f of finishes) { roll -= f.DropWeight || 0; if (roll <= 0) { key = f.Key; break; } }
      const order = (c) => (c.rarity && c.rarity.sortOrder != null ? c.rarity.sortOrder : 0);
      const card = [...json.cards].sort((a, b) => order(b) - order(a))[0];
      const pull = store.getAll('Pulls').find((p) => p.BatchId === json.batchId && refId(p.Card) === card.cardId && p.SerialNumber === card.serialNumber);
      if (pull) { store.update('Pulls', pull.id, { Finish: key }); card.finish = key; card.boosted = true; guaranteed = true; }
    }
  }
  json.ripened = { label: info.label, icon: info.icon, finish: info.finish, special: info.special, guaranteed, remaining };
}

export const routes = { 'POST ripen': handle };
