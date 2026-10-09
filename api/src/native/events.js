// Week-ends evenement : l'admin active un bonus temporaire (poussieres xN,
// finitions plus frequentes a l'ouverture des boosters), affiche en bandeau
// sur tout le site. Les bonus s'appliquent APRES les workflows existants
// (decraft, fouille, expedition, ouverture de booster) : aucun workflow n'a
// besoin d'etre modifie.
//   GET  /webhook/event-status
//   POST /webhook/admin-event  { discordId, action: 'get' | 'set', active, label, dustMultiplier, finishMultiplier, fishingRare, wormsMultiplier, endsAt }
// Tableau de bord des evenements (2026-10-09) : evenements planifies a
// l'avance (table ScheduledEvents), appliques tout seuls entre StartAt et
// EndAt. L'evenement manuel (Config) reste prioritaire quand il est actif.
//   POST /webhook/admin-events { discordId, action: 'list' | 'save' | 'delete', event?, id? }

import { refId, now, ok, fail, configRow, isAdmin } from './common.js';
import { setting } from './settings.js';

export const schema = {
  ScheduledEvents: {
    Label: { type: 'Text' }, StartAt: { type: 'Numeric' }, EndAt: { type: 'Numeric' }, Enabled: { type: 'Bool' },
    DustMultiplier: { type: 'Numeric' }, FinishMultiplier: { type: 'Numeric' }, FishingRare: { type: 'Numeric' }, WormsMultiplier: { type: 'Numeric' }
  },
  Config: {
    EventActive: { type: 'Bool' }, EventLabel: { type: 'Text' }, EventDustMultiplier: { type: 'Numeric' },
    EventFinishMultiplier: { type: 'Numeric' }, EventEndsAt: { type: 'Numeric' },
    EventFishingRare: { type: 'Numeric' }, EventWormsMultiplier: { type: 'Numeric' }
  }
};


const m = (v) => Math.max(1, Number(v) || 1);
export function scheduledNow(store, t = now()) {
  if (!store.tables.has('ScheduledEvents')) return null;
  return store.getAll('ScheduledEvents').filter((e) => e.Enabled !== false && (Number(e.StartAt) || 0) <= t && (Number(e.EndAt) || 0) > t)
    .sort((a, b) => (Number(a.EndAt) || 0) - (Number(b.EndAt) || 0))[0] || null;
}

export function eventState(store) {
  const cfg = configRow(store);
  const endsAt = Number(cfg.EventEndsAt) || 0;
  const active = !!cfg.EventActive && (!endsAt || endsAt > now());
  const sch = active ? null : scheduledNow(store);
  if (sch) return {
    active: true, scheduled: true, id: sch.id, label: sch.Label || 'Événement',
    dustMultiplier: m(sch.DustMultiplier), finishMultiplier: m(sch.FinishMultiplier),
    fishingRare: m(sch.FishingRare), wormsMultiplier: m(sch.WormsMultiplier), endsAt: Number(sch.EndAt) || null
  };
  return {
    active,
    label: cfg.EventLabel || 'Événement',
    dustMultiplier: Math.max(1, Number(cfg.EventDustMultiplier) || 1),
    finishMultiplier: Math.max(1, Number(cfg.EventFinishMultiplier) || 1),
    // Semaine de la peche / chasse aux vers (2026-10-05).
    fishingRare: Math.max(1, Number(cfg.EventFishingRare) || 1),
    wormsMultiplier: Math.max(1, Number(cfg.EventWormsMultiplier) || 1),
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
      EventFishingRare: Math.min(5, Math.max(1, Number(body.fishingRare) || 1)),
      EventWormsMultiplier: Math.min(5, Math.max(1, Number(body.wormsMultiplier) || 1)),
      EventEndsAt: Number(body.endsAt) || 0
    };
    if (cfg) store.update('Config', cfg.id, fields); else store.create('Config', fields);
  }
  return ok(eventState(store));
}

const clampM = (v) => Math.min(5, Math.max(1, Number(v) || 1));
function eventView(e, t = now()) {
  const start = Number(e.StartAt) || 0, end = Number(e.EndAt) || 0;
  return {
    id: e.id, label: e.Label || '', startAt: start, endAt: end, enabled: e.Enabled !== false,
    dustMultiplier: m(e.DustMultiplier), finishMultiplier: m(e.FinishMultiplier), fishingRare: m(e.FishingRare), wormsMultiplier: m(e.WormsMultiplier),
    status: e.Enabled === false ? 'off' : end <= t ? 'past' : start <= t ? 'live' : 'upcoming'
  };
}

function handleSchedule({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const action = body.action || 'list';
  if (action === 'save') {
    const e = body.event || {};
    const start = Number(e.startAt) || 0, end = Number(e.endAt) || 0;
    if (!start || !end || end <= start) return fail('invalid_dates');
    const fields = {
      Label: String(e.label || 'Événement').slice(0, 80), StartAt: start, EndAt: end, Enabled: e.enabled !== false,
      DustMultiplier: clampM(e.dustMultiplier), FinishMultiplier: clampM(e.finishMultiplier), FishingRare: clampM(e.fishingRare), WormsMultiplier: clampM(e.wormsMultiplier)
    };
    const id = Number(e.id) || 0;
    if (id && store.get('ScheduledEvents', id)) store.update('ScheduledEvents', id, fields); else store.create('ScheduledEvents', fields);
  } else if (action === 'delete') {
    const id = Number(body.id) || 0;
    if (id && store.get('ScheduledEvents', id)) store.delete('ScheduledEvents', id);
  } else if (action !== 'list') return fail('unknown_action');
  const t = now();
  const events = store.getAll('ScheduledEvents').map((e) => eventView(e, t))
    .filter((e) => e.status !== 'past' || e.endAt > t - 30 * 86400)
    .sort((a, b) => a.startAt - b.startAt);
  return ok({ now: t, current: eventState(store), events });
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
  // Chance de base (reglage SpecialFinishChance, lu aussi par open-pack) x bonus.
  const extra = Math.min(0.9, setting(store, 'SpecialFinishChance') * (ev.finishMultiplier - 1));
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
  'POST admin-event': handleAdmin, 'POST admin-events': handleSchedule
};
