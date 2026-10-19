// Secrets du site (2026-10-19). SOLUTIONS (fichier serveur, jamais servi aux
// joueurs ; ne pas les recopier dans la doc publique ni les notes) :
//  - Carte fantome du 404 : sur une page 404, 7 clics rapides sur « (encore) »
//    -> carte unique « Erreur 404 » (finition ghost), une fois par joueur.
//    La carte vit dans l'extension des cartes secretes (« pack-secretes »,
//    invisible dans la collection tant qu'on n'en possede aucune), marquee
//    promo (jamais tiree) mais PAS IsSecret (la serrure de « Reclamer un
//    code » ne doit pas pouvoir la donner).
//  - L'heure des ombres : de 3 h a 4 h (Paris), le site se deforme et une
//    ombre traverse l'accueil ; la toucher -> titre « Insomniaque » et cadre
//    « Ombre » (une fois).
//  - La roue truquee : a 22 h 22 (Paris), une case « ??? » apparait sur la
//    roue de l'accueil : un tour secret par jour, meme si la roue a deja
//    tourne (jetons + poussieres ; titre « Maitre du temps » la 1re fois).
//  - Codes secrets (« Reclamer un code », reglage SecretCodes) : cosmetiques
//    et ressources, une fois par joueur, avec une cinematique.
//  - Cartes secretes : chacune a un effet ou un contour unique (reglage
//    SecretCardEffects : un mot du nom -> effet ; fourrure brune, noire,
//    blanche, glitch...) et reste TOUJOURS en parfait etat (exemplaires remis
//    en parfait etat au demarrage et apres chaque obtention ; jamais uses,
//    maudits ni mutes : keepsMint, modefun.js / modeperks.js).
//   POST /webhook/secrets { userId, action: 'ghost404' | 'shadow' }
//   GET  /webhook/secret-card -> { imageId, others } (glitch de la carte 404)

import { ok, fail, userById, now, refId, parisDay, firstAttachment, parseJson, nextSerial } from './common.js';
import { setting } from './settings.js';
import { priceMultiplier } from './inflation.js';
import { grantCosmetic } from './cosmetics.js';

export const schema = { Users: { SecretsFound: { type: 'Text' }, SecretCodesUsed: { type: 'Text' }, SecretWheelDay: { type: 'Text' } } };

const CARD_NAME = 'Erreur 404';
const EXT_KEY = 'pack-secretes';   // meme extension que les cartes secretes (get-collection)
const OLD_EXT_KEY = 'secrets';
const foundOf = (user) => parseJson(user.SecretsFound, {}) || {};
const codesUsed = (user) => parseJson(user.SecretCodesUsed, []) || [];
const normCode = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const pm = (store) => Math.max(1, priceMultiplier(store));
// Heure de Paris « HH:MM ».
const parisHM = (at = Date.now()) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at));
const parisH = (at = Date.now()) => Number(parisHM(at).slice(0, 2));

// Illustration de la carte fantome (SVG genere, rien a importer).
const CARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 700"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#312e81"/></linearGradient><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.08 0"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs><rect width="500" height="700" fill="url(#b)"/><rect width="500" height="700" filter="url(#g)"/><g font-family="monospace" font-weight="900" text-anchor="middle"><text x="254" y="364" font-size="190" fill="#f43f5e" opacity="0.55">404</text><text x="246" y="358" font-size="190" fill="#22d3ee" opacity="0.55">404</text><text x="250" y="360" font-size="190" fill="#f8fafc">404</text><text x="250" y="450" font-size="32" fill="#c7d2fe" letter-spacing="6">CARTE INTROUVABLE</text></g></svg>`;

function secretCard(store) {
  if (!store.tables.has('Cards')) return null;
  return store.getAll('Cards').find((c) => c.Name === CARD_NAME && c.IsPromo) || null;
}

// Extension des cartes secretes (creee si absente, inactive : jamais en booster).
function secretExtension(store) {
  if (!store.tables.has('Extensions')) return null;
  const ext = store.getAll('Extensions').find((e) => e.Key === EXT_KEY);
  if (ext) return ext;
  const c = store.table('Extensions').columns;
  const exts = store.getAll('Extensions');
  return store.create('Extensions', Object.fromEntries(Object.entries({ Name: 'Secrètes', Key: EXT_KEY, Active: false, SortOrder: Math.max(0, ...exts.map((e) => Number(e.SortOrder) || 0)) + 1 }).filter(([k]) => c[k])));
}

// Cree (une fois) la carte « Erreur 404 » dans l'extension des cartes
// secretes ; la deplace si elle avait ete creee dans l'ancienne extension.
// Remet en parfait etat les exemplaires des cartes secretes.
export function init({ store }) {
  ensureCard(store);
  try { fixSecretQuality(store); } catch (e) { /* tables incompletes (tests) */ }
}
function ensureCard(store) {
  if (!store.tables.has('Cards') || !store.tables.has('Rarities')) return;
  const ext = secretExtension(store);
  const existing = secretCard(store);
  if (existing) {
    // Illustration regeneree (le dessin a evolue : plus de crane, seulement le texte).
    const img = firstAttachment(existing.Image);
    if (img != null && typeof store.putAttachment === 'function') {
      const cur = store.getAttachment(img);
      if (cur && cur.file_name === 'erreur-404.svg' && String(cur.data) !== CARD_SVG) store.putAttachment(img, 'erreur-404.svg', 'image/svg+xml', Buffer.from(CARD_SVG));
    }
    if (ext && refId(existing.Extension) !== ext.id && store.table('Cards').columns.Extension) store.update('Cards', existing.id, { Extension: ext.id });
    const old = store.tables.has('Extensions') ? store.getAll('Extensions').find((e) => e.Key === OLD_EXT_KEY) : null;
    if (old && !store.getAll('Cards').some((c) => refId(c.Extension) === old.id)) store.delete('Extensions', old.id);
    return;
  }
  const cols = store.table('Cards').columns;
  const only = (fields) => Object.fromEntries(Object.entries(fields).filter(([k]) => cols[k]));
  const rarities = store.getAll('Rarities').sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  const rarity = rarities.find((r) => String(r.Key || '').toLowerCase() === 'legendaire') || rarities[rarities.length - 1];
  let image = null;
  if (cols.Image && typeof store.nextAttachmentId === 'function') {
    const id = store.nextAttachmentId();
    store.putAttachment(id, 'erreur-404.svg', 'image/svg+xml', Buffer.from(CARD_SVG));
    image = ['L', id];
  }
  store.create('Cards', only({
    Name: CARD_NAME, Artist: '???', Description: 'Elle n’aurait jamais dû exister. Et pourtant, la voilà.',
    Image: image, Rarity: rarity ? rarity.id : null, Extension: ext ? ext.id : null, Active: true, IsPromo: true
  }));
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const found = foundOf(user);
  if (body.action === 'ghost404') {
    if (found.ghost404) return fail('already_found', 400);
    init({ store });
    const card = secretCard(store);
    if (!card) return fail('unavailable', 503);
    const serial = nextSerial(store, card.id);
    store.create('Pulls', { User: user.id, Card: card.id, ObtainedAt: now(), BatchId: `secret-404-${user.id}`, SerialNumber: serial, Finish: 'ghost', Quality: 'mint' });
    if (!refId(card.FirstObtainedBy)) store.update('Cards', card.id, { FirstObtainedBy: user.id, FirstObtainedAt: now() });
    store.update('Users', user.id, { SecretsFound: JSON.stringify({ ...found, ghost404: now() }) });
    const rarity = store.get('Rarities', refId(card.Rarity));
    return ok({ title: 'Une carte qui n’existe pas', cards: [{ cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image), serialNumber: serial, finish: 'ghost', quality: 'mint', rarity: rarity ? { key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex } : null }], rewards: [] });
  }
  if (body.action === 'shadow') {
    if (parisH() !== 3) return fail('not_now', 400);
    if (found.shadow) return fail('already_found', 400);
    grantCosmetic(store, user.id, 'title-insomniaque', { type: 'title', label: 'Insomniaque' });
    grantCosmetic(store, user.id, 'frame-shadow', { type: 'frame', label: 'Ombre' });
    store.update('Users', user.id, { SecretsFound: JSON.stringify({ ...found, shadow: now() }) });
    return ok({ title: 'L’ombre t’a laissé quelque chose', rewards: [{ icon: '🏷️', label: 'Titre « Insomniaque »' }, { icon: '🖼️', label: 'Cadre « Ombre »' }] });
  }
  return fail('unknown_action');
}

// Ressources qu'un code secret peut donner (liste blanche).
const GIVE = { BoosterCount: ['🃏', 'jeton booster', 'jetons booster'], StardustCount: ['✨', 'poussière', 'poussières'], KeyCount: ['🔑', 'clé', 'clés'], ChestCount: ['🪙', 'pièce de gatchapon', 'pièces de gatchapon'], BoneCount: ['🦴', 'os', 'os'], CatFish: ['🐟', 'poisson pour Moka', 'poissons pour Moka'], SpareParts: ['🔩', 'pièce détachée', 'pièces détachées'], LuckCharges: ['🧪', 'charge de chance', 'charges de chance'], Worms: ['🪱', 'ver', 'vers'], GoldBait: ['🪝', 'appât doré', 'appâts dorés'] };
const COSMETIC_ICON = { title: '🏷️', frame: '🖼️', color: '🎨' };
const COSMETIC_WORD = { title: 'Titre', frame: 'Cadre', color: 'Couleur' };

// Une carte de la rarete demandee (code secret « LEGENDE »...).
function grantRarityCard(store, user, rarityKey, batchId) {
  const rarity = store.getAll('Rarities').find((r) => String(r.Key || '').toLowerCase() === rarityKey);
  if (!rarity) return null;
  const pool = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo && !c.IsSecret && !c.IsVault && refId(c.Rarity) === rarity.id);
  if (!pool.length) return null;
  const card = pool[Math.floor(Math.random() * pool.length)];
  const serial = nextSerial(store, card.id);
  store.create('Pulls', { User: user.id, Card: card.id, ObtainedAt: now(), BatchId: batchId, SerialNumber: serial, Finish: 'normal', Quality: 'good' });
  return { cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image), serialNumber: serial, finish: 'normal', quality: 'good', rarity: { key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex } };
}

function redeemSecretCode(store, user, entry) {
  const rewards = [];
  const cards = [];
  const fields = {};
  for (const type of ['title', 'frame', 'color']) {
    const c = entry[type];
    if (c && c.key) { grantCosmetic(store, user.id, c.key, { type, label: c.label || c.key }); rewards.push({ icon: COSMETIC_ICON[type], label: `${COSMETIC_WORD[type]} « ${c.label || c.key} »` }); }
  }
  for (const [k, v] of Object.entries(entry.give || {})) {
    const n = Math.round(Number(v) * (k === 'StardustCount' ? pm(store) : 1));
    if (!GIVE[k] || !(n > 0)) continue;
    fields[k] = (Number(user[k]) || 0) + n;
    rewards.push({ icon: GIVE[k][0], label: `+${n} ${GIVE[k][n > 1 ? 2 : 1]}` });
  }
  if (entry.card) { const c = grantRarityCard(store, user, String(entry.card), `secret-code-${user.id}-${Date.now()}`); if (c) cards.push(c); }
  fields.SecretCodesUsed = JSON.stringify([...codesUsed(user), normCode(entry.code)]);
  store.update('Users', user.id, fields);
  return ok({ type: 'reward', source: 'secret', title: entry.label || 'Code secret', rewards, cards });
}

export function beforeWorkflow({ store, path, request }) {
  const body = (request && request.body) || {};
  // Codes secrets de « Reclamer un code ».
  if (path === 'redeem-code') {
    const code = normCode(body.code);
    const entry = (setting(store, 'SecretCodes') || []).find((e) => e && e.code && normCode(e.code) === code);
    if (!entry) return null;
    const user = userById(store, body.userId);
    if (!user) return null;
    if (codesUsed(user).includes(code)) return fail('already_redeemed', 400);
    return redeemSecretCode(store, user, entry);
  }
  // Roue truquee : un tour secret a 22 h 22.
  if (path === 'daily-wheel' && body.action === 'spin' && body.secret) {
    const user = userById(store, body.userId);
    if (!user) return fail('unknown_user', 404);
    const hm = parisHM();
    const sec = new Date(Date.now()).getSeconds();
    if (!(hm === '22:22' || (hm === '22:23' && sec < 20))) return fail('secret_closed', 400);
    const today = parisDay(0);
    if (user.SecretWheelDay === today) return fail('already_secret', 400);
    const dust = Math.round(222 * pm(store));
    const title = grantCosmetic(store, user.id, 'title-maitre-temps', { type: 'title', label: 'Maître du temps' });
    const updated = store.update('Users', user.id, { SecretWheelDay: today, BoosterCount: (Number(user.BoosterCount) || 0) + 2, StardustCount: (Number(user.StardustCount) || 0) + dust });
    return ok({ prize: { type: 'secret', tier: 'secret', amount: 2, dust, title: title ? 'Maître du temps' : null }, newKeyCount: updated.KeyCount, newBoosterCount: updated.BoosterCount, newStardust: updated.StardustCount });
  }
  return null;
}

// ------------------------------------------------- effets des cartes secretes
// Effet d'une carte (ou null) : premier mot du reglage contenu dans son nom.
export function effectOf(store, card) {
  if (!card || !card.Name) return null;
  const name = String(card.Name).toLowerCase();
  const rule = (setting(store, 'SecretCardEffects') || []).find((r) => r && r.match && name.includes(String(r.match).toLowerCase()));
  return rule ? String(rule.effect || '') || null : null;
}
const effectCards = (store) => (store.tables.has('Cards') ? store.getAll('Cards').filter((c) => effectOf(store, c)) : []);
// Une carte a effet reste en parfait etat (jamais usee, maudite ni mutee).
export function keepsMint(store, cardId) {
  const c = store.tables.has('Cards') ? store.get('Cards', Number(cardId)) : null;
  return !!(c && effectOf(store, c));
}
// Remet en parfait etat les exemplaires des cartes a effet (d'un joueur, ou de tous).
export function fixSecretQuality(store, userId = null) {
  if (!store.tables.has('Pulls')) return 0;
  const ids = new Set(effectCards(store).map((c) => c.id));
  if (!ids.size) return 0;
  let n = 0;
  for (const p of store.getAll('Pulls')) {
    if (!ids.has(refId(p.Card)) || p.Quality === 'mint' || (userId && refId(p.User) !== Number(userId))) continue;
    store.update('Pulls', p.id, { Quality: 'mint' });
    n++;
  }
  return n;
}
// Apres une obtention possible d'une carte secrete : parfait etat.
// level-rewards : Ticat, offert au niveau 10.
const MINT_PATHS = new Set(['unlock-secret', 'redeem-code', 'craft', 'trade', 'open-pack', 'level-rewards']);
export function afterWorkflow({ store, path, request, response }) {
  if (!MINT_PATHS.has(path) || !response || response.status !== 200) return;
  const body = (request && request.body) || {};
  const uid = Number(body.userId) || 0;
  if (uid) fixSecretQuality(store, uid);
  if (path === 'trade') fixSecretQuality(store);
}

// Effets des cartes secretes (et la carte qui glitche avec des bouts d'autres
// illustrations) : le site les applique partout ou ces images apparaissent.
function handleGlitch({ store }) {
  const imageUse = new Map();
  store.getAll('Cards').forEach((c) => { const id = firstAttachment(c.Image); if (id != null) imageUse.set(id, (imageUse.get(id) || 0) + 1); });
  const effects = effectCards(store).map((c) => { const imageId = firstAttachment(c.Image); return { cardId: c.id, imageId, uniqueImage: imageId != null && imageUse.get(imageId) === 1, effect: effectOf(store, c) }; });
  const card = secretCard(store);
  if (!card) return ok({ imageId: null, others: [], effects });
  const imageId = firstAttachment(card.Image);
  const others = store.getAll('Cards').filter((c) => c.id !== card.id && c.Active && !c.IsSecret).map((c) => firstAttachment(c.Image)).filter((id) => id != null && id !== imageId);
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  return ok({ imageId, others: [...new Set(others)].slice(0, 16), effects });
}

export const routes = { 'POST secrets': handle, 'GET secret-card': handleGlitch };
export const _parisHM = parisHM;
