// Carte fantome du mois (2026-10-15) : une carte invisible qui se
// reconstitue en 5 fragments, un par activite : peche, fouille (grille
// terminee), jardin (recolte), boss (attaque) et salle des machines (porte
// ouverte). Peche, fouille, jardin : PhantomDropChance par action ; boss et
// salle des machines : fragment garanti. Les 5 reunis : la carte, en finition
// Ghost et edition Fantome (editions.js). Une fois par mois.
//   GET /webhook/phantom ?userId=

import { refId, now, ok, fail, userById, parseJson, cardSummary, nextSerial } from './common.js';
import { setting } from './settings.js';
import { seasonId } from './seasons.js';
import { addFeed } from './feed.js';

export const schema = { Users: { PhantomMonth: { type: 'Text' }, PhantomFragments: { type: 'Text' }, PhantomDone: { type: 'Text' } } };

export const FRAGMENTS = [
  { key: 'fish', icon: '🎣', label: 'Pêche', event: 'fish' },
  { key: 'dig', icon: '⛏️', label: 'Fouille', event: 'board' },
  { key: 'garden', icon: '🌱', label: 'Jardin', event: 'harvest' },
  { key: 'boss', icon: '💀', label: 'Boss', event: 'bossAttack', sure: true },
  { key: 'machine', icon: '⚙️', label: 'Salle des machines', sure: true }
];

// Carte du mois : imposee (PhantomCardId) ou tiree parmi les epiques et mieux (la meme pour tous).
export function phantomCard(store, month = seasonId()) {
  const forced = Number(setting(store, 'PhantomCardId')) || 0;
  if (forced) { const c = store.get('Cards', forced); if (c) return c; }
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  const epic = (rarities.size ? [...rarities.values()].find((r) => r.Key === 'epique') : null);
  const min = epic ? Number(epic.SortOrder) || 0 : 0;
  const pool = store.getAll('Cards').filter((c) => c.Active !== false && !c.IsPromo && (Number((rarities.get(refId(c.Rarity)) || {}).SortOrder) || 0) >= min && (rarities.get(refId(c.Rarity)) || {}).Key !== 'unique')
    .sort((a, b) => a.id - b.id);
  if (!pool.length) return null;
  let h = 0;
  for (const ch of month) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

function progress(user, month = seasonId()) {
  return user.PhantomMonth === month ? { got: parseJson(user.PhantomFragments, []), done: user.PhantomDone === month } : { got: [], done: false };
}


// Donne un fragment (si pas deja obtenu ce mois) ; renvoie l'annonce ou null.
export function grantFragment(store, userId, key) {
  if (!setting(store, 'PhantomEnabled')) return null;
  const user = store.get('Users', userId);
  const frag = FRAGMENTS.find((f) => f.key === key);
  if (!user || !frag) return null;
  const month = seasonId();
  const p = progress(user, month);
  if (p.done || p.got.includes(key)) return null;
  const got = [...p.got, key];
  const fields = { PhantomMonth: month, PhantomFragments: JSON.stringify(got) };
  if (got.length < FRAGMENTS.length) {
    store.update('Users', userId, fields);
    return { userId, kind: 'phantom', icon: '👻', label: `Fragment fantôme trouvé (${frag.label}) : ${got.length}/${FRAGMENTS.length}` };
  }
  const card = phantomCard(store, month);
  fields.PhantomDone = month;
  store.update('Users', userId, fields);
  if (!card) return null;
  store.create('Pulls', { User: userId, Card: card.id, SerialNumber: nextSerial(store, card.id), Finish: 'ghost', Quality: 'mint', Edition: 'phantom', ObtainedAt: now(), BatchId: `phantom-${month}-${userId}` });
  addFeed(store, { userId, kind: 'phantom', icon: '👻', text: `reconstitue la carte fantôme du mois : ${card.Name} !`, cardId: card.id });
  return { userId, kind: 'phantom', icon: '👻', label: `Les 5 fragments sont réunis : ${card.Name} rejoint ta collection en édition Fantôme !` };
}

export function onEvents(store, events) {
  if (!setting(store, 'PhantomEnabled')) return [];
  const notices = [];
  const chance = setting(store, 'PhantomDropChance');
  for (const e of events) {
    const frag = FRAGMENTS.find((f) => f.event && f.event === e.type);
    if (!frag || (!frag.sure && Math.random() >= chance)) continue;
    const n = grantFragment(store, e.userId, frag.key);
    if (n) notices.push(n);
  }
  return notices;
}

function handlePhantom({ store, query }) {
  const user = userById(store, query.userId);
  if (!user) return fail('unknown_user', 404);
  const month = seasonId();
  const p = progress(user, month);
  const card = phantomCard(store, month);
  return ok({
    enabled: !!setting(store, 'PhantomEnabled'), month, done: p.done,
    fragments: FRAGMENTS.map((f) => ({ key: f.key, icon: f.icon, label: f.label, sure: !!f.sure, found: p.got.includes(f.key) })),
    // La carte reste cachee tant qu'elle n'est pas reconstituee.
    card: p.done && card ? cardSummary(store, card) : null,
    hint: card ? { rarity: (store.get('Rarities', refId(card.Rarity)) || {}).Name || null } : null
  });
}

export const routes = { 'GET phantom': handlePhantom };
