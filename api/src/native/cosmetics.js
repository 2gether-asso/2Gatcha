// Cosmetiques (2026-10-05) : titres, cadres d'avatar et couleurs de pseudo,
// achetes avec des poussieres (nouvelle depense, sans effet sur le jeu) ou
// gagnes (saison, collections thematiques, tournoi de peche).
// Catalogue reglable dans l'admin (CosmeticsCatalog).
// Editeur (2026-10-25, Admin > Contenu > Cosmetiques) : un objet peut porter
// son propre style (style: { c1, c2, glow, anim }) au lieu d'une classe CSS
// du site ; le site fabrique la regle .decor-<key> a partir de
// event-status.cosmeticStyles. Un objet peut etre retire de la vente
// (hidden) sans rien enlever a ceux qui l'ont ; desc et tag (nouveau,
// limite, saison) s'affichent en boutique.
//   POST /webhook/cosmetics { userId, action: 'status' | 'buy' | 'equip', key?, type? }
//   POST /webhook/admin-cosmetics { discordId, action: 'list' | 'save' | 'delete' | 'grant', item?, key?, userId? }

import { refId, now, ok, fail, userById, isAdmin } from './common.js';
import { setting, setSettings, REGISTRY } from './settings.js';

const TYPES = { title: 'EquippedTitle', frame: 'EquippedFrame', color: 'EquippedColor' };

export const schema = {
  UserCosmetics: { User: { type: 'Ref:Users' }, Key: { type: 'Text' }, Type: { type: 'Text' }, Label: { type: 'Text' }, At: { type: 'Numeric' } },
  Users: { EquippedTitle: { type: 'Text' }, EquippedFrame: { type: 'Text' }, EquippedColor: { type: 'Text' } }
};

// Objets ajoutes par une mise a jour : montres meme si le catalogue a deja
// ete personnalise dans l'admin, sauf si l'admin les a supprimes depuis
// (AppSettings 'cosmeticsRemoved').
const ADDED_2026_10_25 = ['frame-aurore', 'frame-citrouille', 'frame-ocean', 'color-aurore', 'color-menthe', 'title-pinceau', 'title-maitre-chien', 'title-emeraude'];
function removedKeys(store) {
  const r = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((x) => x.Key === 'cosmeticsRemoved') : null;
  try { return new Set(r ? JSON.parse(r.Value) : []); } catch (e) { return new Set(); }
}
function storedCatalog(store) {
  const list = setting(store, 'CosmeticsCatalog').filter((c) => c && c.key);
  const have = new Set(list.map((c) => c.key));
  const removed = removedKeys(store);
  const added = REGISTRY.CosmeticsCatalog.def.filter((c) => ADDED_2026_10_25.includes(c.key) && !have.has(c.key) && !removed.has(c.key));
  return [...list, ...added];
}
const allCatalog = (store) => storedCatalog(store).filter((c) => TYPES[c.type]);
// En vente : sans les objets retires (hidden).
export const catalog = (store) => allCatalog(store).filter((c) => !c.hidden);
const ANIMS = ['none', 'pulse', 'spin', 'shine'];
const isColor = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));
// Styles des objets qui en ont un (meme retires : ceux qui les ont les gardent).
export function publicStyles(store) {
  const out = {};
  for (const c of allCatalog(store)) if (c.style && (c.type === 'frame' || c.type === 'color')) out[c.key] = { type: c.type, ...c.style };
  return out;
}
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

// --- editeur admin ------------------------------------------------------------
function cleanItem(it) {
  const key = String(it.key || '').trim().toLowerCase();
  if (!/^(title|frame|color)-[a-z0-9-]{2,40}$/.test(key)) return { error: 'invalid_key' };
  const type = String(it.type || '');
  if (!TYPES[type] || !key.startsWith(type + '-')) return { error: 'invalid_type' };
  const label = String(it.label || '').trim().slice(0, 60);
  if (!label) return { error: 'invalid_label' };
  const out = { key, type, label, price: Math.max(0, Math.min(1000000, Math.round(Number(it.price) || 0))) };
  if (it.desc) out.desc = String(it.desc).slice(0, 160);
  if (it.tag) out.tag = String(it.tag).slice(0, 20);
  if (it.hidden) out.hidden = true;
  if (type !== 'title' && it.style && typeof it.style === 'object') {
    const st = it.style;
    if (!isColor(st.c1)) return { error: 'invalid_style' };
    out.style = { c1: st.c1.toLowerCase(), ...(isColor(st.c2) ? { c2: st.c2.toLowerCase() } : {}), glow: Math.max(0, Math.min(40, Math.round(Number(st.glow) || 0))), anim: ANIMS.includes(st.anim) ? st.anim : 'none' };
  }
  return { item: out };
}
function adminList(store) {
  const counts = {};
  if (store.tables.has('UserCosmetics')) for (const r of store.getAll('UserCosmetics')) counts[r.Key] = (counts[r.Key] || 0) + 1;
  return { items: allCatalog(store).map((c) => ({ ...c, owners: counts[c.key] || 0 })), anims: ANIMS };
}
function handleAdmin({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const action = body.action || 'list';
  const list = storedCatalog(store).slice();
  if (action === 'save') {
    const r = cleanItem(body.item || {});
    if (r.error) return fail(r.error);
    const i = list.findIndex((c) => c && c.key === r.item.key);
    if (i >= 0) list[i] = r.item; else list.push(r.item);
    const errors = setSettings(store, { CosmeticsCatalog: list });
    if (errors.length) return fail('invalid_catalog', 400, { errors });
    return ok({ ...adminList(store), saved: r.item.key });
  }
  if (action === 'delete') {
    const key = String(body.key || '');
    const owners = store.tables.has('UserCosmetics') ? store.getAll('UserCosmetics').filter((r) => r.Key === key).length : 0;
    // Deja possede : retire de la vente seulement (les joueurs le gardent, style compris).
    const next = owners ? list.map((c) => (c && c.key === key ? { ...c, hidden: true } : c)) : list.filter((c) => !c || c.key !== key);
    const errors = setSettings(store, { CosmeticsCatalog: next });
    if (!owners && !errors.length) {
      const removed = [...removedKeys(store), key];
      const row = store.getAll('AppSettings').find((x) => x.Key === 'cosmeticsRemoved');
      if (row) store.update('AppSettings', row.id, { Value: JSON.stringify(removed) }); else store.create('AppSettings', { Key: 'cosmeticsRemoved', Value: JSON.stringify(removed) });
    }
    if (errors.length) return fail('invalid_catalog', 400, { errors });
    return ok({ ...adminList(store), deleted: key, hiddenOnly: owners > 0 });
  }
  if (action === 'grant') {
    const item = allCatalog(store).find((c) => c.key === String(body.key || ''));
    const target = userById(store, body.userId);
    if (!item || !target) return fail('not_found', 404);
    return ok({ ...adminList(store), granted: grantCosmetic(store, target.id, item.key, { type: item.type, label: item.label }) });
  }
  if (action !== 'list') return fail('unknown_action');
  return ok(adminList(store));
}

export const routes = { 'POST cosmetics': handleCosmetics, 'POST admin-cosmetics': handleAdmin };

// Decorations du joueur connecte avec le statut des boosters (en-tete).
export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json) return;
  if (path === 'booster-status') {
    const id = Number((request.query || {}).userId);
    if (id) response.json.decor = decorations(store, [id])[id] || null;
  }
}
