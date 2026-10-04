// Week-ends evenement : l'admin active un bonus temporaire (poussieres xN,
// finitions plus frequentes a l'ouverture des boosters), affiche en bandeau
// sur tout le site. Les bonus s'appliquent APRES les workflows existants
// (decraft, fouille, expedition, ouverture de booster) : aucun workflow n'a
// besoin d'etre modifie.
//   GET  /webhook/event-status
//   POST /webhook/admin-event  { discordId, action: 'get' | 'set', active, label, dustMultiplier, finishMultiplier, endsAt }

import { refId, now, ok, fail, configRow, isAdmin } from './common.js';

export const schema = {
  Config: {
    EventActive: { type: 'Bool' }, EventLabel: { type: 'Text' }, EventDustMultiplier: { type: 'Numeric' },
    EventFinishMultiplier: { type: 'Numeric' }, EventEndsAt: { type: 'Numeric' }
  }
};

// Chance de base d'une finition speciale a l'ouverture (open-pack.json,
// SPECIAL_FINISH_CHANCE) : le bonus d'evenement la multiplie.
const BASE_SPECIAL_FINISH_CHANCE = 0.10;

export function eventState(store) {
  const cfg = configRow(store);
  const endsAt = Number(cfg.EventEndsAt) || 0;
  const active = !!cfg.EventActive && (!endsAt || endsAt > now());
  return {
    active,
    label: cfg.EventLabel || 'Événement',
    dustMultiplier: Math.max(1, Number(cfg.EventDustMultiplier) || 1),
    finishMultiplier: Math.max(1, Number(cfg.EventFinishMultiplier) || 1),
    endsAt: endsAt || null
  };
}

function handleStatus({ store }) {
  return ok(eventState(store));
}

function handleAdmin({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  if (body.action === 'set') {
    const cfg = store.getAll('Config')[0];
    const fields = {
      EventActive: !!body.active,
      EventLabel: String(body.label || '').slice(0, 80),
      EventDustMultiplier: Math.min(5, Math.max(1, Number(body.dustMultiplier) || 1)),
      EventFinishMultiplier: Math.min(5, Math.max(1, Number(body.finishMultiplier) || 1)),
      EventEndsAt: Number(body.endsAt) || 0
    };
    if (cfg) store.update('Config', cfg.id, fields); else store.create('Config', fields);
  }
  return ok(eventState(store));
}

function grantDust(store, userId, bonus) {
  const u = store.get('Users', Number(userId));
  if (!u) return null;
  return store.update('Users', u.id, { StardustCount: (u.StardustCount || 0) + bonus }).StardustCount;
}

// Bonus de poussieres sur une reponse { dustGained, newStardust? }.
function boostDust(store, ev, userId, json, gained) {
  if (!(gained > 0) || ev.dustMultiplier <= 1) return;
  const bonus = Math.round(gained * (ev.dustMultiplier - 1));
  if (!bonus) return;
  const newStardust = grantDust(store, userId, bonus);
  if (newStardust == null) return;
  json.eventBonus = { dust: bonus, label: ev.label };
  if ('newStardust' in json) json.newStardust = newStardust;
  return bonus;
}

function boostFinishes(store, ev, json) {
  if (ev.finishMultiplier <= 1 || !Array.isArray(json.cards) || !json.batchId) return;
  const extra = Math.min(0.9, BASE_SPECIAL_FINISH_CHANCE * (ev.finishMultiplier - 1));
  const finishes = store.tables.has('Finishes') ? store.getAll('Finishes').filter((f) => f.Key !== 'normal' && (f.DropWeight || 0) > 0) : [];
  const total = finishes.reduce((s, f) => s + (f.DropWeight || 0), 0);
  if (!total) return;
  const pulls = store.getAll('Pulls').filter((p) => p.BatchId === json.batchId);
  let upgraded = 0;
  for (const card of json.cards) {
    if ((card.finish || 'normal') !== 'normal' || Math.random() >= extra) continue;
    let roll = Math.random() * total;
    let key = finishes[finishes.length - 1].Key;
    for (const f of finishes) { roll -= f.DropWeight || 0; if (roll <= 0) { key = f.Key; break; } }
    const pull = pulls.find((p) => refId(p.Card) === card.cardId && p.SerialNumber === card.serialNumber && (p.Finish || 'normal') === 'normal');
    if (!pull) continue;
    store.update('Pulls', pull.id, { Finish: key });
    pull.Finish = key;
    card.finish = key;
    card.eventBoosted = true;
    upgraded++;
  }
  if (upgraded) json.eventBonus = { finishes: upgraded, label: ev.label };
}

// Appele apres chaque workflow (sous le verrou) : applique les bonus actifs.
export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || response.raw) return;
  const ev = eventState(store);
  if (!ev.active) return;
  const body = request.body || {};
  const json = response.json;
  if (path === 'disenchant') boostDust(store, ev, body.userId, json, json.dustGained);
  else if (path === 'dig' && body.action === 'dig') boostDust(store, ev, body.userId, json, json.dustGained);
  else if (path === 'expedition' && body.action === 'claim' && json.reward) {
    const bonus = boostDust(store, ev, body.userId, json, json.reward.dust);
    if (bonus) json.reward.dust += bonus;
  } else if (path === 'open-pack' && !body.dryRun) boostFinishes(store, ev, json);
}

export const routes = {
  'GET event-status': handleStatus,
  'POST admin-event': handleAdmin
};
