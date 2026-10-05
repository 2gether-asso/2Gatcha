// Cosmetiques (2026-10-05) : titres, cadres d'avatar et couleurs de pseudo,
// achetes avec des poussieres (nouvelle depense, sans effet sur le jeu) ou
// gagnes (saison, collections thematiques, tournoi de peche).
// Catalogue reglable dans l'admin (CosmeticsCatalog).
//   POST /webhook/cosmetics { userId, action: 'status' | 'buy' | 'equip', key?, type? }

import { refId, now, ok, fail, userById } from './common.js';
import { setting } from './settings.js';

export const TYPES = { title: 'EquippedTitle', frame: 'EquippedFrame', color: 'EquippedColor' };

export const schema = {
  UserCosmetics: { User: { type: 'Ref:Users' }, Key: { type: 'Text' }, Type: { type: 'Text' }, Label: { type: 'Text' }, At: { type: 'Numeric' } },
  Users: { EquippedTitle: { type: 'Text' }, EquippedFrame: { type: 'Text' }, EquippedColor: { type: 'Text' } }
};

const catalog = (store) => setting(store, 'CosmeticsCatalog').filter((c) => c && c.key && TYPES[c.type]);
const owned = (store, userId) => store.getAll('UserCosmetics').filter((r) => refId(r.User) === userId);

// Donne un cosmetique gagne (titre de saison, de collection...). Idempotent.
export function grantCosmetic(store, userId, key, { type = 'title', label = key } = {}) {
  if (!store.tables.has('UserCosmetics')) return false;
  if (owned(store, userId).some((r) => r.Key === key)) return false;
  store.create('UserCosmetics', { User: userId, Key: key, Type: type, Label: label, At: now() });
  return true;
}

// Decorations affichees (profil, en-tete, classements) pour des joueurs.
export function decorations(store, userIds) {
  const want = new Set(userIds.map(Number));
  const labels = new Map();
  catalog(store).forEach((c) => labels.set(c.key, c.label));
  store.getAll('UserCosmetics').forEach((r) => { if (want.has(refId(r.User))) labels.set(`${refId(r.User)}|${r.Key}`, r.Label); });
  const out = {};
  for (const u of store.getAll('Users')) {
    if (!want.has(u.id)) continue;
    const title = u.EquippedTitle ? labels.get(`${u.id}|${u.EquippedTitle}`) || labels.get(u.EquippedTitle) || null : null;
    out[u.id] = { title, frame: u.EquippedFrame || null, color: u.EquippedColor || null };
  }
  return out;
}

function state(store, user) {
  const mine = owned(store, user.id);
  const ownedKeys = new Set(mine.map((r) => r.Key));
  const shop = catalog(store).map((c) => ({ ...c, owned: ownedKeys.has(c.key) }));
  const earned = mine.filter((r) => !catalog(store).some((c) => c.key === r.Key)).map((r) => ({ key: r.Key, type: r.Type, label: r.Label, price: 0, owned: true, earned: true }));
  return {
    stardust: Number(user.StardustCount) || 0,
    shop, earned,
    equipped: { title: user.EquippedTitle || null, frame: user.EquippedFrame || null, color: user.EquippedColor || null },
    decor: decorations(store, [user.id])[user.id]
  };
}

function handleCosmetics({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'buy') {
    const item = catalog(store).find((c) => c.key === String(body.key));
    if (!item) return fail('unknown_item');
    if (owned(store, user.id).some((r) => r.Key === item.key)) return fail('already_owned');
    const price = Number(item.price) || 0;
    if ((Number(user.StardustCount) || 0) < price) return fail('not_enough_dust');
    store.update('Users', user.id, { StardustCount: (Number(user.StardustCount) || 0) - price });
    store.create('UserCosmetics', { User: user.id, Key: item.key, Type: item.type, Label: item.label, At: now() });
    user = store.get('Users', user.id);
    return ok({ ...state(store, user), bought: item.key });
  }
  if (action === 'equip') {
    const type = String(body.type || '');
    if (!TYPES[type]) return fail('invalid_type');
    const key = body.key ? String(body.key) : '';
    if (key) {
      const mine = owned(store, user.id).find((r) => r.Key === key);
      if (!mine || mine.Type !== type) return fail('not_owned');
    }
    user = store.update('Users', user.id, { [TYPES[type]]: key });
    return ok(state(store, user));
  }
  if (action !== 'status') return fail('unknown_action');
  return ok(state(store, user));
}

export const routes = { 'POST cosmetics': handleCosmetics };

// Decorations du joueur connecte avec le statut des boosters (en-tete).
export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json) return;
  if (path === 'booster-status') {
    const id = Number((request.query || {}).userId);
    if (id) response.json.decor = decorations(store, [id])[id] || null;
  }
}
