// Outils partages par les fonctionnalites natives de l'API (api/src/native).
//
// Les fonctionnalites natives (2026-10-04) sont ecrites directement en JS
// contre le Store, au lieu de workflows JSON : plus simples a ecrire et
// a tester. Elles gardent les memes conventions que les workflows : memes
// adresses /webhook/<chemin>, memes formats de donnees (Ref entier, ["L", ...]),
// meme verrou global (aucune ecriture concurrente), memes erreurs { error }.

export const refId = (v) => (Array.isArray(v) ? v[1] : v);
export const now = () => Math.floor(Date.now() / 1000);

// Date du jour a Paris (AAAA-MM-JJ), comme LastWheelSpinDate / GuessDate.
export function parisDay(offsetDays = 0, at = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(at + offsetDays * 86400000));
}
export function parisHour(at = Date.now()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(new Date(at)));
}

export function levelForXp(xp) {
  return Math.floor((25 + Math.sqrt(625 + 100 * (xp || 0))) / 50);
}

export const ok = (json) => ({ status: 200, json });
export const fail = (error, status = 400, extra = {}) => ({ status, json: { error, ...extra } });

// Ligne unique de Config (parametres globaux), {} si absente.
export function configRow(store) {
  return store.tables.has('Config') ? (store.getAll('Config')[0] || {}) : {};
}

// Meme liste que les workflows admin (adminDiscordIds) et site/js/config.js.
// Surchargeable par ADMIN_DISCORD_IDS="id1,id2".
export const ADMIN_IDS = (process.env.ADMIN_DISCORD_IDS || '785223211730075709,184008667690041345').split(',').map((s) => s.trim()).filter(Boolean);
export const isAdmin = (discordId) => ADMIN_IDS.includes(String(discordId || ''));

export function userById(store, userId) {
  const id = Number(userId);
  return id ? store.get('Users', id) : null;
}

// Exemplaires d'un joueur. withVault : y compris ceux ranges au coffre-fort.
export function userPulls(store, userId, { withVault = true } = {}) {
  const id = Number(userId);
  return store.getAll('Pulls').filter((p) => refId(p.User) === id && (withVault || !p.InVault));
}

export function firstAttachment(v) {
  if (!Array.isArray(v) || !v.length) return null;
  const ids = v[0] === 'L' ? v.slice(1) : v;
  return ids.length ? ids[0] : null;
}

// Migrations idempotentes : creent les tables / colonnes manquantes au
// demarrage (plus besoin de les creer a la main avant un deploiement).
export function ensureSchema(store, spec) {
  const created = [];
  for (const [table, columns] of Object.entries(spec)) {
    if (!store.tables.has(table)) {
      store.createTable(table, columns);
      created.push(table);
      continue;
    }
    for (const [col, def] of Object.entries(columns)) {
      if (!store.table(table).columns[col]) { store.addColumn(table, col, def.type); created.push(`${table}.${col}`); }
    }
  }
  return created;
}

// Carte simplifiee pour les reponses (meme forme que les workflows).
export function cardSummary(store, card) {
  const rarity = card.Rarity ? store.get('Rarities', refId(card.Rarity)) : null;
  return {
    cardId: card.id,
    name: card.Name,
    imageId: firstAttachment(card.Image),
    rarity: rarity ? { id: rarity.id, key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex, sortOrder: rarity.SortOrder || 0 } : null
  };
}
