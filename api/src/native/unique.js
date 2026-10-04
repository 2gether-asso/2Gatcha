// Rarete "Unique" (verte) : ses cartes ne s'obtiennent QU'AVEC un Ticket
// Unique, gagne en completant une ligne du coffre-fort perso (workflow
// personal-vault). Jamais dans les boosters, coffres, fouille, autel, craft,
// echanges...
//
//   POST /webhook/unique-counter { userId, action: 'status' | 'redeem', cardId? }
//     -> { tickets, cards: [{ ...carte, owned, serialNumber }] }
//
// - La rarete et l'extension "Uniques" (inactive : pas de booster) sont
//   creees au demarrage si elles manquent. Les cartes Unique sans extension y
//   sont rangees : elles ne comptent dans la completion d'aucune autre
//   extension.
// - Toute carte de rarete Unique est marquee IsPromo : tous les tirages, le
//   craft, les echanges et les dons excluent deja les cartes promo. Verifie au
//   demarrage puis regulierement (une carte peut etre creee dans admin-db).
// - Ligne completee : +1 ticket (Users.UniqueTickets), a echanger au
//   "Comptoir Unique" contre la carte Unique de son choix (pas deja possedee).
// - Migration (une fois) : les lignes completees qui n'ont pas encore donne
//   de carte Unique deviennent des tickets.
// - Registre : chaque carte de la vitrine liste ses proprietaires dans l'ordre
//   d'obtention ; un echange est annonce sur Discord (DISCORD_WEBHOOK_URL).
// - Les cartes promo ne vont plus au coffre-fort (une seule finition
//   possible) : celles qui y etaient rangees retournent dans la collection.

import { refId, now, ok, fail, userById, cardSummary } from './common.js';

export const UNIQUE_KEY = 'unique';
export const UNIQUE_EXTENSION_KEY = 'uniques';
const UNIQUE_COLOR = '#22c55e';
const MIGRATION_KEY = 'uniqueTicketsMigrated';
let lastSync = 0;

export const schema = {
  Users: { UniqueTickets: { type: 'Numeric' } }
};

const onlyColumns = (store, table, fields) => Object.fromEntries(Object.entries(fields).filter(([k]) => store.table(table).columns[k]));

export function uniqueRarity(store) {
  return store.tables.has('Rarities') ? store.getAll('Rarities').find((r) => r.Key === UNIQUE_KEY) || null : null;
}

function uniqueExtension(store) {
  return store.tables.has('Extensions') ? store.getAll('Extensions').find((e) => e.Key === UNIQUE_EXTENSION_KEY) || null : null;
}

function ensureRarity(store) {
  if (!store.tables.has('Rarities') || uniqueRarity(store)) return false;
  const rarities = store.getAll('Rarities');
  store.create('Rarities', onlyColumns(store, 'Rarities', {
    Name: 'Unique', Key: UNIQUE_KEY, ColorHex: UNIQUE_COLOR,
    SortOrder: Math.max(0, ...rarities.map((r) => Number(r.SortOrder) || 0)) + 1,
    Weight: 0, DropWeight: 0, DisenchantValue: 0, CraftCost: 0
  }));
  return true;
}

// Extension inactive : absente du choix des boosters, visible en collection.
function ensureExtension(store) {
  if (!store.tables.has('Extensions') || uniqueExtension(store)) return false;
  const exts = store.getAll('Extensions');
  store.create('Extensions', onlyColumns(store, 'Extensions', {
    Name: 'Uniques', Key: UNIQUE_EXTENSION_KEY, Active: false,
    SortOrder: Math.max(0, ...exts.map((e) => Number(e.SortOrder) || 0)) + 1
  }));
  return true;
}

// Cartes Unique -> IsPromo (+ extension Uniques si aucune) ; cartes promo
// rangees au coffre-fort -> collection.
export function syncUniqueCards(store) {
  const rarity = uniqueRarity(store);
  const ext = uniqueExtension(store);
  let promoted = 0, released = 0;
  if (rarity && store.tables.has('Cards')) {
    const cols = store.table('Cards').columns;
    for (const c of store.getAll('Cards')) {
      if (refId(c.Rarity) !== rarity.id) continue;
      const fix = {};
      if (cols.IsPromo && !c.IsPromo) fix.IsPromo = true;
      if (cols.Extension && ext && !refId(c.Extension)) fix.Extension = ext.id;
      // Premier obtenteur jamais note (carte obtenue avant le registre, ou
      // donnee par un admin) : le plus ancien exemplaire.
      if (cols.FirstObtainedBy && !refId(c.FirstObtainedBy) && store.tables.has('Pulls')) {
        const first = store.getAll('Pulls').filter((p) => refId(p.Card) === c.id).sort((a, b) => (a.ObtainedAt || 0) - (b.ObtainedAt || 0) || (a.SerialNumber || 0) - (b.SerialNumber || 0))[0];
        if (first && refId(first.User)) fix.FirstObtainedBy = refId(first.User);
      }
      if (Object.keys(fix).length) { store.update('Cards', c.id, fix); promoted++; }
    }
  }
  if (store.tables.has('Pulls') && store.tables.has('Cards') && store.table('Pulls').columns.InVault) {
    const promo = new Set(store.getAll('Cards').filter((c) => c.IsPromo).map((c) => c.id));
    for (const p of store.getAll('Pulls')) {
      if (p.InVault && promo.has(refId(p.Card))) { store.update('Pulls', p.id, { InVault: false }); released++; }
    }
  }
  lastSync = Date.now();
  return { promoted, released };
}

// Une seule fois : lignes completees sans carte Unique recue -> tickets.
function migrateTickets(store) {
  if (!store.tables.has('AppSettings') || store.getAll('AppSettings').some((r) => r.Key === MIGRATION_KEY)) return 0;
  let total = 0;
  if (store.tables.has('VaultRewards')) {
    const completed = new Map();
    for (const r of store.getAll('VaultRewards')) completed.set(refId(r.User), (completed.get(refId(r.User)) || 0) + 1);
    const received = new Map();
    for (const p of (store.tables.has('Pulls') ? store.getAll('Pulls') : [])) if (String(p.BatchId || '').startsWith('unique-')) received.set(refId(p.User), (received.get(refId(p.User)) || 0) + 1);
    for (const [userId, n] of completed) {
      const owed = Math.max(0, n - (received.get(userId) || 0));
      const user = store.get('Users', userId);
      if (!owed || !user) continue;
      store.update('Users', userId, { UniqueTickets: (Number(user.UniqueTickets) || 0) + owed });
      total += owed;
    }
  }
  store.create('AppSettings', { Key: MIGRATION_KEY, Value: JSON.stringify({ at: now(), tickets: total }) });
  return total;
}

export function init({ store }) {
  const rarityCreated = ensureRarity(store);
  const extCreated = ensureExtension(store);
  const { promoted, released } = syncUniqueCards(store);
  const migrated = migrateTickets(store);
  if (rarityCreated || extCreated || promoted || released || migrated) {
    console.log(`Rarete Unique : ${rarityCreated ? 'rarete creee, ' : ''}${extCreated ? 'extension creee, ' : ''}${promoted} carte(s) corrigee(s), ${released} carte(s) promo sortie(s) du coffre-fort, ${migrated} ticket(s) de rattrapage`);
  }
}

// Avant chaque action (sous le verrou), au plus toutes les 30 s.
export function beforeRequest({ store }) {
  if (Date.now() - lastSync > 30000) syncUniqueCards(store);
}

function uniqueCards(store) {
  const rarity = uniqueRarity(store);
  if (!rarity || !store.tables.has('Cards')) return [];
  return store.getAll('Cards').filter((c) => refId(c.Rarity) === rarity.id && c.Active !== false);
}

function giveUniqueCard(store, user, card) {
  const pulls = store.getAll('Pulls').filter((p) => refId(p.Card) === card.id);
  const used = new Set(pulls.map((p) => p.SerialNumber));
  let serial = 1;
  while (used.has(serial)) serial++;
  const isFirstEver = !pulls.length;
  store.create('Pulls', { User: user.id, Card: card.id, ObtainedAt: now(), BatchId: `unique-${user.id}-${now()}`, SerialNumber: serial, Finish: 'normal', Quality: 'mint' });
  if (isFirstEver && store.table('Cards').columns.FirstObtainedBy && !refId(card.FirstObtainedBy)) store.update('Cards', card.id, { FirstObtainedBy: user.id });
  return { ...cardSummary(store, card), serialNumber: serial, finish: 'normal', quality: 'mint', isFirstEver };
}

// Vitrine du comptoir : toutes les cartes Unique, possedees ou non.
function counterState(store, user) {
  const mine = new Map();
  for (const p of store.getAll('Pulls')) {
    if (refId(p.User) !== user.id) continue;
    const id = refId(p.Card);
    if (!mine.has(id) || (p.SerialNumber || 0) < mine.get(id)) mine.set(id, p.SerialNumber || 0);
  }
  const users = new Map(store.getAll('Users').map((u) => [u.id, u]));
  const ownersOf = (cardId) => store.getAll('Pulls')
    .filter((p) => refId(p.Card) === cardId)
    .sort((a, b) => (a.ObtainedAt || 0) - (b.ObtainedAt || 0) || (a.SerialNumber || 0) - (b.SerialNumber || 0))
    .map((p) => users.get(refId(p.User)))
    .filter((u, i, arr) => u && arr.findIndex((x) => x && x.id === u.id) === i)
    .map((u) => ({ userId: u.id, pseudo: u.Pseudo, discordId: u.DiscordId || null, discordAvatar: u.DiscordAvatar || null }));
  const cards = uniqueCards(store)
    .map((c) => ({ ...cardSummary(store, c), owned: mine.has(c.id), serialNumber: mine.has(c.id) ? mine.get(c.id) : null, owners: ownersOf(c.id) }))
    .sort((a, b) => (a.owned - b.owned) || a.name.localeCompare(b.name));
  return { tickets: Number(user.UniqueTickets) || 0, cards, remaining: cards.filter((c) => !c.owned).length };
}

function handleCounter({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if ((body.action || 'status') === 'status') return ok(counterState(store, user));
  if (body.action !== 'redeem') return fail('unknown_action');
  if ((Number(user.UniqueTickets) || 0) < 1) return fail('no_ticket');
  const card = uniqueCards(store).find((c) => c.id === Number(body.cardId));
  if (!card) return fail('not_unique_card');
  if (store.getAll('Pulls').some((p) => refId(p.User) === user.id && refId(p.Card) === card.id)) return fail('already_owned');
  store.update('Users', user.id, { UniqueTickets: (Number(user.UniqueTickets) || 0) - 1 });
  const granted = giveUniqueCard(store, user, card);
  announce(user, granted);
  return ok({ redeemed: true, card: granted, ...counterState(store, store.get('Users', user.id)) });
}

// Annonce Discord (hors verrou, sans attendre : un echec ne bloque rien).
function announce(user, card) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url || typeof fetch !== 'function') return;
  const body = {
    embeds: [{
      title: '🍀 Carte Unique obtenue !',
      description: `**${user.Pseudo || 'Un joueur'}** a échangé un Ticket Unique contre **${card.name}** (#${String(card.serialNumber).padStart(3, '0')})${card.isFirstEver ? ' : premier exemplaire du serveur !' : '.'}`,
      color: 0x22c55e
    }]
  };
  setTimeout(() => {
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  }, 0);
}

export const routes = {
  'POST unique-counter': handleCounter
};

// Ligne du coffre-fort perso completee (personal-vault.js) : +1 ticket.
export function addTicket(store, userId) {
  const user = store.get('Users', userId);
  if (user) store.update('Users', userId, { UniqueTickets: (Number(user.UniqueTickets) || 0) + 1 });
}

// Resume pour la page du coffre-fort.
export function vaultSummary(store, userId) {
  const user = store.get('Users', userId);
  if (!user) return null;
  const st = counterState(store, user);
  return { total: st.cards.length, remaining: st.remaining, tickets: st.tickets };
}

// Compteur de tickets dans l'en-tete (a cote des clefs).
export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'booster-status' || response.status !== 200 || !response.json) return;
  const user = store.get('Users', Number((request.query || {}).userId));
  if (user) response.json.uniqueTickets = Number(user.UniqueTickets) || 0;
}
