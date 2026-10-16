// Avis de recherche (2026-10-15) : chaque semaine, le serveur reclame une
// carte (commune a rare, la meme pour tous). Les WantedSlots premiers
// joueurs qui en donnent un doublon gagnent WantedRewardDust poussieres
// (le tout premier, une cle en plus) ; la carte rejoint le coffre de guilde.
//   POST /webhook/wanted { userId, action: 'status' | 'donate' }

import { refId, now, ok, fail, userById, parseJson, cardSummary } from './common.js';
import { setting } from './settings.js';
import { weekKey } from './levels.js';
import { addFeed } from './feed.js';

const KEY = 'wanted';
const QUALITY = ['damaged', 'worn', 'good', 'mint'];

function row(store) { return store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === KEY) : null; }
function state(store, week) {
  const r = row(store);
  const v = r ? parseJson(r.Value, null) : null;
  return v && v.week === week ? v : { week, donors: [] };
}
function save(store, value) {
  const r = row(store);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: KEY, Value: JSON.stringify(value) });
}

// Carte de la semaine : commune a rare, tiree par la semaine.
export function wantedCard(store, week = weekKey()) {
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  const rare = [...rarities.values()].find((r) => r.Key === 'rare');
  const max = rare ? Number(rare.SortOrder) || 0 : Infinity;
  const pool = store.getAll('Cards').filter((c) => c.Active !== false && !c.IsPromo && (Number((rarities.get(refId(c.Rarity)) || {}).SortOrder) || 0) <= max).sort((a, b) => a.id - b.id);
  if (!pool.length) return null;
  let h = 7;
  for (const ch of week) h = (h * 37 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

// Exemplaire donnable : un doublon (jamais le dernier), le moins precieux.
function donatable(store, userId, cardId) {
  const mine = store.getAll('Pulls').filter((p) => refId(p.User) === userId && refId(p.Card) === cardId);
  if (mine.length < 2) return null;
  return mine.filter((p) => p.SerialNumber !== 1 && !p.Insured && !p.Starred && !p.InVault && !p.Edition && !p.ForgedInFire && (p.Finish || 'normal') === 'normal')
    .sort((a, b) => QUALITY.indexOf(a.Quality || 'damaged') - QUALITY.indexOf(b.Quality || 'damaged') || (b.SerialNumber || 0) - (a.SerialNumber || 0))[0] || null;
}

function stateOf(store, user) {
  const week = weekKey();
  const card = wantedCard(store, week);
  const st = state(store, week);
  const users = new Map(store.getAll('Users').map((u) => [u.id, u]));
  const copies = card ? store.getAll('Pulls').filter((p) => refId(p.User) === user.id && refId(p.Card) === card.id).length : 0;
  return {
    enabled: !!setting(store, 'WantedEnabled'), week, card: card ? cardSummary(store, card) : null,
    slots: setting(store, 'WantedSlots'), reward: setting(store, 'WantedRewardDust'),
    donors: st.donors.map((d) => ({ userId: d.userId, pseudo: (users.get(d.userId) || {}).Pseudo || '?', at: d.at })),
    myCopies: copies, canDonate: !!card && !!donatable(store, user.id, card.id), donated: st.donors.some((d) => d.userId === user.id)
  };
}

function handleWanted({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(stateOf(store, user));
  if (action !== 'donate') return fail('unknown_action');
  const week = weekKey();
  const card = wantedCard(store, week);
  if (!card) return fail('no_card');
  const st = state(store, week);
  if (st.donors.some((d) => d.userId === user.id)) return fail('already_donated', 400, stateOf(store, user));
  if (st.donors.length >= setting(store, 'WantedSlots')) return fail('slots_full', 400, stateOf(store, user));
  const pull = donatable(store, user.id, card.id);
  if (!pull) return fail('need_duplicate', 400, stateOf(store, user));
  store.delete('Pulls', pull.id);
  if (store.tables.has('GuildChestDeposits')) {
    store.create('GuildChestDeposits', { User: user.id, CardId: card.id, SerialNumber: pull.SerialNumber, Finish: pull.Finish || 'normal', Quality: pull.Quality || 'good', DepositedAt: now(), Claimed: false });
  }
  const first = !st.donors.length;
  const reward = setting(store, 'WantedRewardDust');
  user = store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) + reward, ...(first ? { KeyCount: (Number(user.KeyCount) || 0) + 1 } : {}) });
  save(store, { week, donors: [...st.donors, { userId: user.id, at: now() }] });
  if (first) addFeed(store, { userId: user.id, kind: 'wanted', icon: '📜', text: `répond le premier à l’avis de recherche (${card.Name}) !`, cardId: card.id });
  return ok({ ...stateOf(store, user), reward: { dust: reward, key: first ? 1 : 0 } });
}

export const routes = { 'POST wanted': handleWanted };
