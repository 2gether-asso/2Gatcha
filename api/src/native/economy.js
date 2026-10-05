// Tableau de bord de l'economie (page admin) : monnaies en circulation,
// activite des 30 derniers jours, sources des cartes, cartes les plus
// repandues / jamais sorties, joueurs les plus riches.
//   POST /webhook/admin-economy  { discordId }
// Note : les exemplaires decraftes / sacrifies disparaissent de Pulls ; les
// courbes comptent donc les cartes ENCORE en circulation obtenues ce jour-la.

import { refId, now, ok, fail, isAdmin, parisDay } from './common.js';
import { setting } from './settings.js';

// Journal de l'economie (2026-10-05) : chaque variation de BoosterCount /
// StardustCount / Worms d'un joueur est cumulee par jour et par source (le
// chemin de la requete en cours). Alimente par index.js (store.update).
export const schema = {
  EconomyDaily: {
    Day: { type: 'Text' }, Source: { type: 'Text' },
    BoostersIn: { type: 'Numeric' }, BoostersOut: { type: 'Numeric' },
    DustIn: { type: 'Numeric' }, DustOut: { type: 'Numeric' },
    WormsIn: { type: 'Numeric' }, WormsOut: { type: 'Numeric' }
  }
};

const LEDGER = [['BoosterCount', 'Boosters'], ['StardustCount', 'Dust'], ['Worms', 'Worms']];
const ledgerIndexes = new WeakMap(); // store -> ("jour|source" -> id)

export function record(store, source, before, after) {
  if (!before || !after || !store.tables.has('EconomyDaily')) return;
  const deltas = {};
  for (const [col, name] of LEDGER) {
    const d = (Number(after[col]) || 0) - (Number(before[col]) || 0);
    if (d > 0) deltas[name + 'In'] = d;
    else if (d < 0) deltas[name + 'Out'] = -d;
  }
  if (!Object.keys(deltas).length) return;
  const day = parisDay(0);
  const key = `${day}|${source || 'autre'}`;
  let ledgerIndex = ledgerIndexes.get(store);
  if (!ledgerIndex) {
    ledgerIndex = new Map(store.getAll('EconomyDaily').map((r) => [`${r.Day}|${r.Source}`, r.id]));
    ledgerIndexes.set(store, ledgerIndex);
  }
  const id = ledgerIndex.get(key);
  const row = id ? store.get('EconomyDaily', id) : null;
  if (!row) {
    const created = store.create('EconomyDaily', { Day: day, Source: source || 'autre', ...deltas });
    ledgerIndex.set(key, created.id);
  } else {
    const fields = {};
    for (const [k, v] of Object.entries(deltas)) fields[k] = (Number(row[k]) || 0) + v;
    store.update('EconomyDaily', row.id, fields);
  }
}

function flows(store, activePlayers) {
  if (!store.tables.has('EconomyDaily')) return null;
  const rows = store.getAll('EconomyDaily');
  const days = Array.from({ length: 14 }, (_, i) => parisDay(-13 + i));
  const sum = (list, k) => list.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const daily = days.map((day) => {
    const list = rows.filter((r) => r.Day === day);
    return { day, boostersIn: sum(list, 'BoostersIn'), boostersOut: sum(list, 'BoostersOut'), dustIn: sum(list, 'DustIn'), dustOut: sum(list, 'DustOut'), wormsIn: sum(list, 'WormsIn'), wormsOut: sum(list, 'WormsOut') };
  });
  const week = rows.filter((r) => days.slice(-7).includes(r.Day));
  const bySource = new Map();
  week.forEach((r) => {
    const x = bySource.get(r.Source) || { source: r.Source, boostersIn: 0, boostersOut: 0, dustIn: 0, dustOut: 0 };
    x.boostersIn += Number(r.BoostersIn) || 0; x.boostersOut += Number(r.BoostersOut) || 0;
    x.dustIn += Number(r.DustIn) || 0; x.dustOut += Number(r.DustOut) || 0;
    bySource.set(r.Source, x);
  });
  const w = daily.slice(-7);
  const boostersPerPlayerDay = sum(w, 'boostersIn') / 7 / Math.max(1, activePlayers);
  const dustRatio = sum(w, 'dustIn') / Math.max(1, sum(w, 'dustOut'));
  const alerts = [];
  const maxB = setting(store, 'EconomyAlertBoostersPerPlayer');
  if (boostersPerPlayerDay > maxB) alerts.push(`Inflation de boosters : ${boostersPerPlayerDay.toFixed(1)} créés par joueur actif et par jour (seuil ${maxB}).`);
  const maxR = setting(store, 'EconomyAlertDustRatio');
  if (dustRatio > maxR) alerts.push(`Les poussières s'accumulent : ${dustRatio.toFixed(1)} gagnées pour 1 dépensée cette semaine (seuil ${maxR}).`);
  if (sum(w, 'boostersIn') > 0 && sum(w, 'boostersOut') < sum(w, 'boostersIn') / 3) alerts.push('Les boosters gagnés sont peu ouverts : les réserves des joueurs grossissent.');
  return {
    daily, sources: [...bySource.values()].sort((a, b) => (b.boostersIn + b.dustIn / 100) - (a.boostersIn + a.dustIn / 100)),
    boostersPerPlayerDay: Math.round(boostersPerPlayerDay * 10) / 10, dustRatio: Math.round(dustRatio * 10) / 10, alerts
  };
}

// Source d'un exemplaire d'apres son BatchId (voir les workflows).
function sourceOf(batchId) {
  const b = String(batchId || '');
  if (/^\d+-\d+$/.test(b)) return 'booster';
  const prefix = b.split('-')[0];
  return { code: 'code', craft: 'craft', foil: 'fusion', quality: 'restauration', levelup: 'niveau', market: 'marché noir', secret: 'secrète', vault: 'coffre', set: 'set', admin: 'don admin', dig: 'fouille', altar: 'autel', chest: 'coffre de guilde', guild: 'coffre de guilde', wheel: 'roue', expedition: 'expédition', dog: 'fouille', lootchest: 'coffre à clé' }[prefix] || prefix || 'autre';
}

function handleEconomy({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const t = now();
  const users = store.getAll('Users');
  const pulls = store.getAll('Pulls');
  const cards = new Map(store.getAll('Cards').map((c) => [c.id, c]));
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  const fm = new Map((store.tables.has('Finishes') ? store.getAll('Finishes') : []).map((f) => [f.Key, Number(f.DisenchantMultiplier) || 1]));
  const qm = new Map((store.tables.has('Qualities') ? store.getAll('Qualities') : []).map((q) => [q.Key, Number(q.DisenchantMultiplier) || 1]));

  const activeSince = (sec) => new Set(pulls.filter((p) => (p.ObtainedAt || 0) >= t - sec).map((p) => refId(p.User))).size;
  let collectionValue = 0;
  for (const p of pulls) {
    const c = cards.get(refId(p.Card));
    if (!c || c.IsPromo) continue;
    const r = rarities.get(refId(c.Rarity));
    collectionValue += Math.round((r ? Number(r.DisenchantValue) || 0 : 0) * (fm.get(p.Finish || 'normal') || 1) * (qm.get(p.Quality || 'damaged') || 1));
  }

  // 30 derniers jours (fuseau Paris).
  const days = [];
  const index = new Map();
  for (let i = 29; i >= 0; i--) {
    const d = parisDay(-i);
    index.set(d, days.length);
    days.push({ day: d, boosters: 0, cards: 0, newPlayers: 0, activePlayers: 0 });
  }
  const packBatches = new Map();
  const activeByDay = new Map();
  const sources = {};
  for (const p of pulls) {
    if (!p.ObtainedAt || p.ObtainedAt < t - 31 * 86400) continue;
    const d = parisDay(0, p.ObtainedAt * 1000);
    const i = index.get(d);
    if (i == null) continue;
    days[i].cards++;
    const src = sourceOf(p.BatchId);
    sources[src] = (sources[src] || 0) + 1;
    if (src === 'booster') {
      if (!packBatches.has(d)) packBatches.set(d, new Set());
      packBatches.get(d).add(p.BatchId);
    }
    if (!activeByDay.has(d)) activeByDay.set(d, new Set());
    activeByDay.get(d).add(refId(p.User));
  }
  packBatches.forEach((set, d) => { days[index.get(d)].boosters = set.size; });
  activeByDay.forEach((set, d) => { days[index.get(d)].activePlayers = set.size; });
  for (const u of users) {
    if (!u.CreatedAt) continue;
    const i = index.get(parisDay(0, u.CreatedAt * 1000));
    if (i != null) days[i].newPlayers++;
  }

  const copies = new Map();
  pulls.forEach((p) => copies.set(refId(p.Card), (copies.get(refId(p.Card)) || 0) + 1));
  const playable = [...cards.values()].filter((c) => c.Active && !c.IsPromo);
  const cardRow = (c) => ({ cardId: c.id, name: c.Name, copies: copies.get(c.id) || 0, rarity: (rarities.get(refId(c.Rarity)) || {}).Name || '' });
  const sum = (k) => users.reduce((s, u) => s + (Number(u[k]) || 0), 0);
  const top = (k) => [...users].sort((a, b) => (Number(b[k]) || 0) - (Number(a[k]) || 0)).slice(0, 5).map((u) => ({ pseudo: u.Pseudo, value: Number(u[k]) || 0 }));

  return ok({
    totals: {
      players: users.length,
      active1d: activeSince(86400), active7d: activeSince(7 * 86400), active30d: activeSince(30 * 86400),
      stardust: sum('StardustCount'), boostersUnopened: sum('BoosterCount'), keys: sum('KeyCount'),
      copies: pulls.length, collectionValue,
      cardsNeverObtained: playable.filter((c) => !copies.get(c.id)).length, playableCards: playable.length
    },
    days,
    sources: Object.entries(sources).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    richest: top('StardustCount'),
    boosterHoarders: top('BoosterCount'),
    mostCommonCards: playable.map(cardRow).sort((a, b) => b.copies - a.copies).slice(0, 8),
    rarestCards: playable.map(cardRow).filter((c) => c.copies > 0).sort((a, b) => a.copies - b.copies).slice(0, 8),
    flows: flows(store, activeSince(7 * 86400))
  });
}

export const routes = { 'POST admin-economy': handleEconomy };
