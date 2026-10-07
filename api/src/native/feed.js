// Fil du serveur en direct (2026-10-07) : les beaux moments des joueurs
// ("X vient de tirer une Mythique arc-en-ciel !"), affiches sur l'accueil.
// Les tirages de booster n'y entrent qu'APRES la revelation (notify-reveal,
// comme l'annonce Discord) : jamais de spoiler avant que le joueur ait vu sa
// carte. Les autres modules y ajoutent leurs evenements (addFeed).
//   GET /webhook/server-feed ?since=<id> -> { items: [{ id, at, pseudo, icon, text, cardId }] }

import { refId, now, ok, cardSummary } from './common.js';

export const schema = {
  ServerFeed: { At: { type: 'Numeric' }, User: { type: 'Ref:Users' }, Kind: { type: 'Text' }, Icon: { type: 'Text' }, Text: { type: 'Text' }, Card: { type: 'Ref:Cards' } }
};

const KEEP = 200;
const FINISH_LABEL = { holo: 'holo', gold: 'dorée', ghost: 'ghost', diamond: 'diamant', rainbow: 'arc-en-ciel' };

export function addFeed(store, { userId, kind, icon, text, cardId = null }) {
  if (!store.tables.has('ServerFeed')) return;
  store.create('ServerFeed', { At: now(), User: userId || null, Kind: kind, Icon: icon || '✨', Text: String(text).slice(0, 200), Card: cardId || null });
  const rows = store.getAll('ServerFeed');
  if (rows.length > KEEP + 20) rows.sort((a, b) => a.id - b.id).slice(0, rows.length - KEEP).forEach((r) => store.delete('ServerFeed', r.id));
}

function handleFeed({ store, query }) {
  const since = Number(query.since) || 0;
  const users = new Map(store.getAll('Users').map((u) => [u.id, u]));
  const items = store.getAll('ServerFeed').filter((r) => r.id > since).sort((a, b) => b.id - a.id).slice(0, 30).map((r) => {
    const u = users.get(refId(r.User));
    const card = r.Card ? store.get('Cards', refId(r.Card)) : null;
    return { id: r.id, at: r.At, kind: r.Kind, icon: r.Icon, text: r.Text, pseudo: u ? u.Pseudo : null, userId: u ? u.id : null, card: card ? cardSummary(store, card) : null };
  });
  return ok({ items });
}

export const routes = { 'GET server-feed': handleFeed };

// Tirages remarquables, une fois la revelation terminee cote joueur.
export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'notify-reveal' || response.status !== 200) return;
  const body = request.body || {};
  const userId = Number(body.userId);
  const user = store.get('Users', userId);
  const ids = new Set((Array.isArray(body.batchIds) ? body.batchIds : []).map(String));
  if (!user || !ids.size) return;
  const already = new Set(store.getAll('ServerFeed').filter((r) => r.Kind === 'pull').map((r) => r.Text));
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  for (const p of store.getAll('Pulls')) {
    if (refId(p.User) !== userId || !ids.has(String(p.BatchId))) continue;
    const card = store.get('Cards', refId(p.Card));
    const rarity = card ? rarities.get(refId(card.Rarity)) : null;
    if (!card || !rarity) continue;
    const top = ['legendaire', 'mythique'].includes(rarity.Key);
    const fancy = ['diamond', 'rainbow'].includes(p.Finish);
    if (!top && !fancy) continue;
    const finish = p.Finish && p.Finish !== 'normal' ? ' ' + FINISH_LABEL[p.Finish] : '';
    const text = `a tiré ${card.Name} (${rarity.Name}${finish}) #${p.SerialNumber || '?'}`;
    if (already.has(text)) continue;
    addFeed(store, { userId, kind: 'pull', icon: rarity.Key === 'mythique' || p.Finish === 'rainbow' ? '🌈' : '🌟', text, cardId: card.id });
  }
}
