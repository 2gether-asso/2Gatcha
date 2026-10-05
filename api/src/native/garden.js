// Jardin (2026-10-05) : deuxieme metier de recolte, relie a la peche.
// 4 parcelles : on plante (GardenPlantCost poussieres), ca pousse
// GardenGrowHours heures, puis on recolte : vers de terre et, avec un peu de
// chance, un APPAT DORE (Users.GoldBait). Un appat dore utilise a la peche
// supprime les prises vides et multiplie les prises rares pour ce lancer.
//   POST /webhook/garden { userId, action: 'status' | 'plant' | 'harvest', plot? }

import { ok, fail, userById, now } from './common.js';
import { setting } from './settings.js';

export const PLOTS = 4;

export const schema = {
  Users: { GardenPlots: { type: 'Text' }, GoldBait: { type: 'Numeric' } }
};

const plotsOf = (user) => {
  let p = [];
  try { p = JSON.parse(user.GardenPlots || '[]'); } catch (e) { p = []; }
  return Array.from({ length: PLOTS }, (_, i) => (p[i] && p[i].plantedAt ? p[i] : null));
};

function state(store, user) {
  const grow = setting(store, 'GardenGrowHours') * 3600;
  const t = now();
  const plots = plotsOf(user).map((p, i) => (p
    ? { plot: i, planted: true, plantedAt: p.plantedAt, readyAt: p.plantedAt + grow, ready: p.plantedAt + grow <= t, progress: Math.min(1, (t - p.plantedAt) / grow) }
    : { plot: i, planted: false }));
  return {
    plots, growHours: setting(store, 'GardenGrowHours'), plantCost: setting(store, 'GardenPlantCost'),
    baitChance: setting(store, 'GardenBaitChance'), stardust: Number(user.StardustCount) || 0,
    goldBait: Number(user.GoldBait) || 0, worms: Number(user.Worms) || 0,
    readyCount: plots.filter((p) => p.ready).length
  };
}

function handleGarden({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  const plots = plotsOf(user);
  if (action === 'plant') {
    const targets = body.plot == null ? plots.map((p, i) => (p ? null : i)).filter((i) => i != null) : [Number(body.plot)];
    const free = targets.filter((i) => i >= 0 && i < PLOTS && !plots[i]);
    if (!free.length) return fail('no_free_plot');
    const cost = setting(store, 'GardenPlantCost');
    const affordable = cost > 0 ? Math.min(free.length, Math.floor((Number(user.StardustCount) || 0) / cost)) : free.length;
    if (!affordable) return fail('not_enough_dust');
    free.slice(0, affordable).forEach((i) => { plots[i] = { plantedAt: now() }; });
    user = store.update('Users', user.id, { GardenPlots: JSON.stringify(plots), StardustCount: (Number(user.StardustCount) || 0) - cost * affordable });
    return ok({ ...state(store, user), planted: affordable });
  }
  if (action === 'harvest') {
    const grow = setting(store, 'GardenGrowHours') * 3600;
    const ready = plots.map((p, i) => (p && p.plantedAt + grow <= now() ? i : null)).filter((i) => i != null);
    if (!ready.length) return fail('nothing_ready');
    let worms = 0, bait = 0, dust = 0;
    const items = [];
    for (const i of ready) {
      const w = 1 + Math.floor(Math.random() * 2);
      worms += w;
      const item = { plot: i, worms: w, bait: 0, dust: 0 };
      if (Math.random() < setting(store, 'GardenBaitChance')) { bait++; item.bait = 1; }
      if (Math.random() < 0.15) { const d = 15 + Math.floor(Math.random() * 26); dust += d; item.dust = d; }
      items.push(item);
      plots[i] = null;
    }
    user = store.update('Users', user.id, {
      GardenPlots: JSON.stringify(plots), Worms: (Number(user.Worms) || 0) + worms,
      GoldBait: (Number(user.GoldBait) || 0) + bait, StardustCount: (Number(user.StardustCount) || 0) + dust
    });
    return ok({ ...state(store, user), harvested: ready.length, items, gained: { worms, bait, dust } });
  }
  if (action !== 'status') return fail('unknown_action');
  return ok(state(store, user));
}

export const routes = { 'POST garden': handleGarden };
