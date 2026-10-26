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
// Cosmetiques secrets (2026-10-29) : tous ceux qui se gagnent hors boutique
// (codes secrets, secrets du site, salle interdite, prestige, modes, jeux...)
// se modifient aussi dans l'editeur : nom (renomme aussi chez ceux qui l'ont),
// description et style. Enregistres dans CosmeticsCatalog avec secret: true :
// jamais en vente, mais leur style s'applique et les dons peuvent les offrir.
//   POST /webhook/cosmetics { userId, action: 'status' | 'buy' | 'equip', key?, type? }
//   POST /webhook/admin-cosmetics { discordId, action: 'list' | 'save' | 'delete' | 'grant', item?, key?, userId? }

import { refId, now, ok, fail, userById, isAdmin } from './common.js';
import { setting, setSettings, REGISTRY } from './settings.js';
import { namesHiddenPet } from './starter.js';

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
// En vente : sans les objets retires (hidden) ni les secrets.
export const catalog = (store) => allCatalog(store).filter((c) => !c.hidden && !c.secret);

// Cosmetiques gagnes hors boutique, avec leur origine (nom par defaut tel
// qu'il est donne en jeu). Les codes secrets (SecretCodes) et les objets deja
// gagnes par des joueurs (titres de saison, d'equipe...) s'y ajoutent.
const SECRETS = [
  { key: 'title-insomniaque', type: 'title', label: 'Insomniaque', source: 'Secret : l’ombre de 3 h du matin' },
  { key: 'frame-shadow', type: 'frame', label: 'Ombre', source: 'Secret : l’ombre de 3 h du matin' },
  { key: 'title-maitre-temps', type: 'title', label: 'Maître du temps', source: 'Secret : la roue de 22 h 22' },
  { key: 'frame-forbidden', type: 'frame', label: 'Joueur interdit', source: 'Salle interdite : les 7 combinaisons de base' },
  { key: 'title-flambeur', type: 'title', label: 'Flambeur', source: 'Casino : comptoir des lots' },
  { key: 'title-highroller', type: 'title', label: 'High roller', source: 'Casino : comptoir des lots' },
  { key: 'frame-casino', type: 'frame', label: 'Cadre néon du casino', source: 'Casino : comptoir des lots' },
  { key: 'color-casino', type: 'color', label: 'Pseudo or du casino', source: 'Casino : comptoir des lots' },
  { key: 'frame-prestige', type: 'frame', label: 'Cadre Prestige', source: 'Prestige du compte (1re étoile)' },
  { key: 'machine-chief', type: 'title', label: 'Chef mécanicien ⚙️', source: 'Salle des machines : meilleur du mois' },
  { key: 'frame-gears', type: 'frame', label: 'Cadre engrenage', source: 'Salle des machines : meilleur du mois' },
  { key: 'title-ironman', type: 'title', label: 'Ironman 🛡️', source: 'Défi Ironman' },
  { key: 'frame-iron', type: 'frame', label: 'Cadre d’acier', source: 'Défi Ironman' },
  { key: 'frame-inferno', type: 'frame', label: 'Cadre Infernal', source: 'Mode Hard : 7 jours de survie' },
  { key: 'frame-seasons', type: 'frame', label: 'Cadre Toutes saisons', source: '5 jours dans chaque mode' },
  { key: 'title-survivor', type: 'title', label: 'Survivant 🔥', source: 'Mode Hard : légendaire en survie' },
  { key: 'title-adventurer', type: 'title', label: 'Aventurier', source: 'Quête en chaîne terminée' },
  { key: 'mode-contract', type: 'title', label: 'Contractuel', source: 'Contrat de mode rempli' },
  { key: 'paleontologist', type: 'title', label: 'Paléontologue 🦖', source: 'Dinos : palier du dinodex' },
  { key: 'tourney-win', type: 'title', label: 'Roi de la pêche', source: 'Tournoi de pêche gagné' },
  { key: 'title-astronome', type: 'title', label: 'Astronome', source: 'Arbre céleste terminé' },
  { key: 'story-hero', type: 'title', label: 'Héros de 2Gatcha', source: 'Quêtes d’histoire terminées' },
  { key: 'title-rage-slayer', type: 'title', label: 'Tueur de boss enragé', source: 'Boss enragé vaincu' }
];
const TYPE_OF = (key) => (/^frame-/.test(key) ? 'frame' : /^color-/.test(key) ? 'color' : 'title');
// Liste des secrets : registre, codes secrets, objets deja gagnes ; avec les
// modifications de l'admin (objets secret: true du catalogue) par-dessus.
export function secretList(store) {
  const shop = new Set(allCatalog(store).filter((c) => !c.secret).map((c) => c.key));
  const out = new Map();
  const add = (x) => { if (x && x.key && !shop.has(x.key) && !out.has(x.key)) out.set(x.key, { key: x.key, type: TYPES[x.type] ? x.type : TYPE_OF(x.key), label: x.label || x.key, source: x.source || 'Gagné en jeu' }); };
  SECRETS.forEach(add);
  for (const c of setting(store, 'SecretCodes') || []) for (const type of ['title', 'frame', 'color']) if (c && c[type] && c[type].key) add({ key: c[type].key, type, label: c[type].label, source: `Code secret ${c.code || ''}`.trim() });
  if (store.tables.has('UserCosmetics')) for (const r of store.getAll('UserCosmetics')) add({ key: r.Key, type: r.Type, label: r.Label });
  for (const c of allCatalog(store).filter((x) => x.secret)) {
    const base = out.get(c.key) || { key: c.key, type: c.type, label: c.label, source: 'Créé dans l’admin' };
    out.set(c.key, { ...base, ...c, source: base.source, defaultLabel: base.label, edited: true });
  }
  return [...out.values()];
}
// Ce qu'un don peut offrir : la boutique et les secrets.
export const giftable = (store) => [...catalog(store), ...secretList(store)];
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
  // Nom change dans l'editeur (cosmetique secret) : celui-la est donne.
  const edited = allCatalog(store).find((c) => c.secret && c.key === key);
  if (edited && edited.label) label = edited.label;
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
  // Un titre qui nomme un compagnon pas encore adopte reste cache (surprise).
  const shop = catalog(store).filter((c) => ownedKeys.has(c.key) || !namesHiddenPet(store, user, c.label + ' ' + (c.desc || ''))).map((c) => ({ ...c, owned: ownedKeys.has(c.key) }));
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
function cleanItem(it, known = null) {
  const key = String(it.key || '').trim().toLowerCase();
  const type = String(it.type || '');
  // Secret deja existant (gagne en jeu) : sa cle et son type restent ceux du jeu.
  if (known) { if (key !== known.key) return { error: 'invalid_key' }; }
  else {
    if (!/^(title|frame|color)-[a-z0-9-]{2,40}$/.test(key)) return { error: 'invalid_key' };
    if (!TYPES[type] || !key.startsWith(type + '-')) return { error: 'invalid_type' };
  }
  const label = String(it.label || '').trim().slice(0, 60);
  if (!label) return { error: 'invalid_label' };
  const out = { key, type: known ? known.type : type, label, price: it.secret ? 0 : Math.max(0, Math.min(1000000, Math.round(Number(it.price) || 0))) };
  if (it.secret) out.secret = true;
  if (it.desc) out.desc = String(it.desc).slice(0, 160);
  if (it.tag) out.tag = String(it.tag).slice(0, 20);
  if (it.hidden) out.hidden = true;
  if (out.type !== 'title' && it.style && typeof it.style === 'object') {
    const st = it.style;
    if (!isColor(st.c1)) return { error: 'invalid_style' };
    out.style = { c1: st.c1.toLowerCase(), ...(isColor(st.c2) ? { c2: st.c2.toLowerCase() } : {}), glow: Math.max(0, Math.min(40, Math.round(Number(st.glow) || 0))), anim: ANIMS.includes(st.anim) ? st.anim : 'none' };
  }
  return { item: out };
}
function adminList(store) {
  const counts = {};
  if (store.tables.has('UserCosmetics')) for (const r of store.getAll('UserCosmetics')) counts[r.Key] = (counts[r.Key] || 0) + 1;
  return { items: allCatalog(store).filter((c) => !c.secret).map((c) => ({ ...c, owners: counts[c.key] || 0 })), secrets: secretList(store).map((c) => ({ ...c, owners: counts[c.key] || 0 })), anims: ANIMS };
}
function handleAdmin({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const action = body.action || 'list';
  const list = storedCatalog(store).slice();
  if (action === 'save') {
    const it = body.item || {};
    const known = it.secret ? secretList(store).find((c) => c.key === String(it.key || '').trim().toLowerCase()) || null : null;
    // Une cle de la boutique ne devient pas secrete (et inversement) par erreur.
    const clash = list.find((c) => c && c.key === String(it.key || '').trim().toLowerCase() && !!c.secret !== !!it.secret);
    if (clash) return fail('key_taken');
    const r = cleanItem(it, known);
    if (r.error) return fail(r.error);
    const i = list.findIndex((c) => c && c.key === r.item.key);
    if (i >= 0) list[i] = r.item; else list.push(r.item);
    const errors = setSettings(store, { CosmeticsCatalog: list });
    if (errors.length) return fail('invalid_catalog', 400, { errors });
    // Secret renomme : le nouveau nom aussi chez ceux qui l'ont deja.
    if (r.item.secret && store.tables.has('UserCosmetics')) for (const row of store.getAll('UserCosmetics')) if (row.Key === r.item.key && row.Label !== r.item.label) store.update('UserCosmetics', row.id, { Label: r.item.label });
    return ok({ ...adminList(store), saved: r.item.key });
  }
  if (action === 'delete') {
    const key = String(body.key || '');
    // Secret : on retire seulement les modifications (nom et style du jeu).
    const sec = list.find((c) => c && c.key === key && c.secret);
    if (sec) {
      const known = SECRETS.find((x) => x.key === key) || null;
      const errors = setSettings(store, { CosmeticsCatalog: list.filter((c) => c !== sec) });
      if (errors.length) return fail('invalid_catalog', 400, { errors });
      if (known && store.tables.has('UserCosmetics')) for (const row of store.getAll('UserCosmetics')) if (row.Key === key && row.Label !== known.label) store.update('UserCosmetics', row.id, { Label: known.label });
      return ok({ ...adminList(store), deleted: key, reset: true });
    }
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
    const item = allCatalog(store).find((c) => c.key === String(body.key || '')) || secretList(store).find((c) => c.key === String(body.key || ''));
    const target = userById(store, body.targetUserId ?? body.userId);
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
