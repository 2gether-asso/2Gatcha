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
  const owned = new Set(store.getAll('Pulls').filter((p) => refId(p.User) === userId && p.BatchId !== json.batchId).map((p) => refId(p.Card)));
  let total = 0, count = 0;
  for (const card of json.cards) {
    if (owned.has(card.cardId)) {
      const dust = (card.rarity && card.rarity.key === 'commune') ? common : other;
      card.duplicateDust = dust;
      total += dust;
      count++;
    } else {
      owned.add(card.cardId);
    }
  }
  if (!total) return;
  const updated = store.update('Users', userId, { StardustCount: (Number(user.StardustCount) || 0) + total });
  json.duplicateDust = { total, cards: count, newStardust: updated.StardustCount };
}
