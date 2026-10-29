// Avis des joueurs (2026-10-29) : bouton « Donner un avis » du site. Le
// message part dans GlitchTip comme un evenement de niveau « Information »
// (pas une erreur), avec le joueur, la page et le type d'avis en tags.
//   POST /webhook/feedback { userId?, kind: 'idea'|'bug'|'other', message, page?, mood?, context? }
// context : { ua, screen, theme... } (navigateur du joueur, utile pour un bug).
// Garde-fous : 5 a 2000 caracteres, 5 avis par heure et par joueur ; les
// visiteurs non connectes partagent un meme quota de 5 par heure.

import { ok, fail } from './common.js';
import { captureMessage } from '../monitoring.js';

const KINDS = { idea: 'Idée', bug: 'Bug', other: 'Autre' };
const MOODS = { love: '😍', ok: '🙂', meh: '😕' };
const PER_HOUR = 5;
const recent = new Map(); // cle -> horodatages (ms) de la derniere heure

function handleFeedback({ store, body }) {
  const message = String(body.message || '').trim();
  if (message.length < 5) return fail('message_too_short');
  if (message.length > 2000) return fail('message_too_long');
  const kind = KINDS[body.kind] ? body.kind : 'other';
  const userId = Number(body.userId) || 0;
  const key = userId ? 'u' + userId : 'anon';
  const t = Date.now();
  const list = (recent.get(key) || []).filter((x) => t - x < 3600 * 1000);
  if (list.length >= PER_HOUR) return fail('feedback_rate_limited', 429);
  list.push(t);
  recent.set(key, list);
  const user = userId ? store.get('Users', userId) : null;
  const pseudo = user ? user.Pseudo || '' : '';
  const page = String(body.page || '').slice(0, 120);
  const mood = MOODS[body.mood] || '';
  const first = message.split('\n')[0].slice(0, 90);
  const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context)
    ? Object.fromEntries(Object.entries(body.context).slice(0, 12).map(([k, v]) => [String(k).slice(0, 30), String(v).slice(0, 300)]))
    : null;
  const sent = captureMessage(`[Avis · ${KINDS[kind]}] ${mood ? mood + ' ' : ''}${first}`, 'info', { feedback: kind, page, userId: userId || null, pseudo, mood: body.mood || null }, { message, context });
  console.log(`Avis (${kind}) de ${pseudo || 'visiteur'} sur ${page || '?'} : ${first}`);
  return ok({ sent: true, tracked: sent });
}

export const routes = { 'POST feedback': handleFeedback };
