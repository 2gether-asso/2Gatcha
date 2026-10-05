// Poussiere passive sur les doublons : a l'ouverture d'un booster, chaque
// carte deja possedee (y compris au coffre-fort, ou deja sortie plus tot dans
// le meme booster) rapporte quelques poussieres, sans rien faire.
// Montants reglables dans l'admin (DuplicateDustCommon, DuplicateDustOther).
// S'applique apres le workflow open-pack : chaque carte doublon recoit
// `duplicateDust`, la reponse `duplicateDust: { total, cards }`.

import { refId } from './common.js';
import { setting } from './settings.js';

export function afterWorkflow({ store, path, request, response }) {
  const body = request.body || {};
  if (path !== 'open-pack' || body.dryRun || response.status !== 200 || !response.json || !Array.isArray(response.json.cards) || !response.json.batchId) return;
  const json = response.json;
  const userId = Number(body.userId);
  const user = store.get('Users', userId);
  if (!user) return;
  const common = setting(store, 'DuplicateDustCommon');
  const other = setting(store, 'DuplicateDustOther');
  // Cartes possedees AVANT ce booster (ses propres exemplaires ont son BatchId).
  const mine = store.getAll('Pulls').filter((p) => refId(p.User) === userId && p.BatchId !== json.batchId);
  const owned = new Set(mine.map((p) => refId(p.Card)));
  // Au-dela de DuplicateDustCapCopies exemplaires d'une meme carte, un doublon
  // ne rapporte plus que 1 poussiere (2026-10-05).
  const copies = new Map();
  mine.forEach((p) => copies.set(refId(p.Card), (copies.get(refId(p.Card)) || 0) + 1));
  const cap = setting(store, 'DuplicateDustCapCopies');
  let total = 0, count = 0;
  for (const card of json.cards) {
    if (owned.has(card.cardId)) {
      const n = copies.get(card.cardId) || 0;
      copies.set(card.cardId, n + 1);
      const dust = cap > 0 && n >= cap ? 1 : (card.rarity && card.rarity.key === 'commune') ? common : other;
      card.duplicateDust = dust;
      total += dust;
      count++;
    } else {
      owned.add(card.cardId);
      copies.set(card.cardId, 1);
    }
  }
  if (!total) return;
  const updated = store.update('Users', userId, { StardustCount: (Number(user.StardustCount) || 0) + total });
  json.duplicateDust = { total, cards: count, newStardust: updated.StardustCount };
}
