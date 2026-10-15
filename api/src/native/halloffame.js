// Livre d'or des premieres (2026-10-15) : le premier joueur du serveur a
// avoir tire chaque mythique (ou mieux), chaque finition rare et chaque
// edition limitee. Calcule a partir des Pulls (le tireur d'origine est lu
// dans le BatchId "<userId>-..." quand il existe : une carte echangee
// ensuite reste au nom de celui qui l'a tiree).
//   GET /webhook/hall-of-fame

import { refId, ok, cardSummary } from './common.js';
import { EDITIONS } from './editions.js';

const FINISHES = { holo: 'Holo', gold: 'Dorée', ghost: 'Ghost', diamond: 'Diamant', rainbow: 'Arc-en-ciel' };
const FINISH_ICON = { holo: '💿', gold: '🥇', ghost: '👻', diamond: '💎', rainbow: '🌈' };

function puller(p) {
  const m = /^(\d+)-/.exec(String(p.BatchId || ''));
  return m ? Number(m[1]) : refId(p.User);
}

let cache = { at: 0, store: null, value: null };
function compute(store) {
  const users = new Map(store.getAll('Users').map((u) => [u.id, u]));
  const cards = new Map(store.getAll('Cards').map((c) => [c.id, c]));
  const rarities = store.getAll('Rarities');
  const mythic = rarities.find((r) => r.Key === 'mythique');
  const min = mythic ? Number(mythic.SortOrder) || 0 : Infinity;
  const rank = new Map(rarities.map((r) => [r.id, Number(r.SortOrder) || 0]));
  const pulls = store.getAll('Pulls').filter((p) => p.ObtainedAt).sort((a, b) => (a.ObtainedAt || 0) - (b.ObtainedAt || 0) || a.id - b.id);
  const firsts = new Map();
  const entry = (key, p, extra) => {
    if (firsts.has(key)) return;
    const uid = puller(p);
    const card = cards.get(refId(p.Card));
    if (!card || !users.get(uid)) return;
    firsts.set(key, { at: p.ObtainedAt, userId: uid, pseudo: users.get(uid).Pseudo, card: cardSummary(store, card), ...extra });
  };
  for (const p of pulls) {
    const card = cards.get(refId(p.Card));
    if (!card) continue;
    if ((rank.get(refId(card.Rarity)) || 0) >= min) entry('card:' + card.id, p, { kind: 'mythic', label: card.Name, icon: '🌟' });
    if (FINISHES[p.Finish]) entry('finish:' + p.Finish, p, { kind: 'finish', label: `Première carte ${FINISHES[p.Finish]}`, icon: FINISH_ICON[p.Finish] });
    if (p.Edition && EDITIONS[p.Edition]) entry('edition:' + p.Edition, p, { kind: 'edition', label: `Première édition ${EDITIONS[p.Edition].label}`, icon: EDITIONS[p.Edition].icon });
  }
  // Premier maitre de chaque carte (les 6 finitions, cards.js).
  const masters = new Map();
  store.getAll('Users').forEach((u) => {
    let m = {}; try { m = JSON.parse(u.MasteredCards || '{}') || {}; } catch (e) { m = {}; }
    for (const [cid, at] of Object.entries(m)) { const prev = masters.get(cid); if (!prev || at < prev.at) masters.set(cid, { at, userId: u.id }); }
  });
  for (const [cid, v] of masters) {
    const card = cards.get(Number(cid));
    if (card && users.get(v.userId)) firsts.set('master:' + cid, { at: v.at, userId: v.userId, pseudo: users.get(v.userId).Pseudo, card: cardSummary(store, card), kind: 'finish', label: `Maître de ${card.Name}`, icon: '👑' });
  }
  // Premieres des dinos de compagnie (enregistrees par dino.js).
  const dinoRow = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === 'dinoFirsts') : null;
  let dinoFirsts = {};
  try { dinoFirsts = JSON.parse((dinoRow && dinoRow.Value) || '{}') || {}; } catch (e) { dinoFirsts = {}; }
  const dinos = Object.values(dinoFirsts).filter((e) => e && users.get(e.userId)).map((e) => ({ ...e, pseudo: users.get(e.userId).Pseudo, kind: 'dino' })).sort((a, b) => a.at - b.at);
  const list = [...firsts.values()];
  return {
    dinos,
    mythics: list.filter((e) => e.kind === 'mythic').sort((a, b) => a.at - b.at),
    finishes: list.filter((e) => e.kind === 'finish').sort((a, b) => a.at - b.at),
    editions: list.filter((e) => e.kind === 'edition').sort((a, b) => a.at - b.at)
  };
}

function handleHall({ store }) {
  const t = Date.now();
  if (cache.store !== store || t - cache.at > 300000) cache = { at: t, store, value: compute(store) };
  return ok(cache.value);
}

export function _reset() { cache = { at: 0, store: null, value: null }; }
export const routes = { 'GET hall-of-fame': handleHall };
