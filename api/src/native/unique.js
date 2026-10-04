// Rarete "Unique" (verte) : ses cartes ne s'obtiennent QU'EN completant une
// ligne du coffre-fort perso (workflow personal-vault). Jamais dans les
// boosters, coffres, fouille, autel, craft, echanges...
//
// - La rarete est creee au demarrage si elle manque (poids 0 : jamais tiree).
// - Toute carte de rarete Unique est marquee IsPromo : tous les tirages, le
//   craft, les echanges et les dons excluent deja les cartes promo. Verifie au
//   demarrage puis regulierement (une carte peut etre creee dans admin-db).
// - Ligne completee : une carte Unique que le joueur n'a pas encore, en
//   parfait etat, ajoutee a la recompense (`reward.uniqueCard`). Les lignes
//   deja completees sans carte sont rattrapees a la visite suivante du
//   coffre-fort (`uniqueGrants`).
// - Les cartes promo ne vont plus au coffre-fort (une seule finition
//   possible) : celles qui y etaient rangees retournent dans la collection.

import { refId, now, cardSummary } from './common.js';

export const UNIQUE_KEY = 'unique';
const UNIQUE_COLOR = '#22c55e';
let lastSync = 0;

export function uniqueRarity(store) {
  return store.tables.has('Rarities') ? store.getAll('Rarities').find((r) => r.Key === UNIQUE_KEY) || null : null;
}

function ensureRarity(store) {
  if (!store.tables.has('Rarities') || uniqueRarity(store)) return false;
  const rarities = store.getAll('Rarities');
  const cols = store.table('Rarities').columns;
  const fields = {
    Name: 'Unique', Key: UNIQUE_KEY, ColorHex: UNIQUE_COLOR,
    SortOrder: Math.max(0, ...rarities.map((r) => Number(r.SortOrder) || 0)) + 1,
    Weight: 0, DropWeight: 0, DisenchantValue: 0, CraftCost: 0
  };
  store.create('Rarities', Object.fromEntries(Object.entries(fields).filter(([k]) => cols[k])));
  return true;
}

// Cartes Unique -> IsPromo ; cartes promo rangees au coffre-fort -> collection.
export function syncUniqueCards(store) {
  const rarity = uniqueRarity(store);
  let promoted = 0, released = 0;
  if (rarity && store.tables.has('Cards') && store.table('Cards').columns.IsPromo) {
    for (const c of store.getAll('Cards')) {
      if (refId(c.Rarity) === rarity.id && !c.IsPromo) { store.update('Cards', c.id, { IsPromo: true }); promoted++; }
    }
  }
  if (store.tables.has('Pulls') && store.table('Pulls').columns.InVault) {
    const promo = new Set(store.getAll('Cards').filter((c) => c.IsPromo).map((c) => c.id));
    for (const p of store.getAll('Pulls')) {
      if (p.InVault && promo.has(refId(p.Card))) { store.update('Pulls', p.id, { InVault: false }); released++; }
    }
  }
  lastSync = Date.now();
  return { promoted, released };
}

export function init({ store }) {
  const created = ensureRarity(store);
  const { promoted, released } = syncUniqueCards(store);
  if (created || promoted || released) console.log(`Rarete Unique : ${created ? 'creee, ' : ''}${promoted} carte(s) passee(s) en promo, ${released} carte(s) promo sortie(s) du coffre-fort`);
}

// Avant chaque action (sous le verrou), au plus toutes les 30 s.
export function beforeRequest({ store }) {
  if (Date.now() - lastSync > 30000) syncUniqueCards(store);
}

// Cartes Unique que le joueur n'a pas encore.
function missingUniqueCards(store, userId) {
  const rarity = uniqueRarity(store);
  if (!rarity) return { all: [], missing: [] };
  const all = store.getAll('Cards').filter((c) => refId(c.Rarity) === rarity.id && c.Active !== false);
  const owned = new Set(store.getAll('Pulls').filter((p) => refId(p.User) === userId).map((p) => refId(p.Card)));
  return { all, missing: all.filter((c) => !owned.has(c.id)) };
}

function giveUniqueCard(store, user, card) {
  const used = new Set(store.getAll('Pulls').filter((p) => refId(p.Card) === card.id).map((p) => p.SerialNumber));
  let serial = 1;
  while (used.has(serial)) serial++;
  const isFirstEver = !store.getAll('Pulls').some((p) => refId(p.Card) === card.id);
  store.create('Pulls', { User: user.id, Card: card.id, ObtainedAt: now(), BatchId: `unique-${user.id}-${now()}`, SerialNumber: serial, Finish: 'normal', Quality: 'mint' });
  if (isFirstEver && store.table('Cards').columns.FirstObtainedBy && !refId(card.FirstObtainedBy)) store.update('Cards', card.id, { FirstObtainedBy: user.id });
  return { ...cardSummary(store, card), serialNumber: serial, finish: 'normal', quality: 'mint', isFirstEver };
}

// Lignes completees (VaultRewards) moins cartes Unique deja recues au coffre
// (BatchId unique-*) = cartes dues. Couvre le rattrapage des lignes
// completees avant la rarete Unique, et les lignes completees quand il ne
// restait plus de carte a gagner (donnee des qu'une nouvelle carte existe).
function owedCount(store, userId) {
  const completed = store.tables.has('VaultRewards') ? store.getAll('VaultRewards').filter((r) => refId(r.User) === userId).length : 0;
  const received = store.getAll('Pulls').filter((p) => refId(p.User) === userId && String(p.BatchId || '').startsWith('unique-')).length;
  return Math.max(0, completed - received);
}

export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'personal-vault' || response.status !== 200 || !response.json || !response.json.unlocked) return;
  const userId = Number((request.body || {}).userId);
  const user = store.get('Users', userId);
  if (!user) return;
  const json = response.json;
  let { all, missing } = missingUniqueCards(store, userId);
  const grants = [];
  let owed = owedCount(store, userId);
  while (owed > 0 && missing.length) {
    const card = missing[Math.floor(Math.random() * missing.length)];
    grants.push(giveUniqueCard(store, user, card));
    missing = missing.filter((c) => c.id !== card.id);
    owed--;
  }
  // La ligne qui vient d'etre completee prend la premiere carte ; les autres
  // sont du rattrapage.
  if (json.reward) json.reward.uniqueCard = grants.length ? grants[0] : null;
  json.uniqueGrants = json.reward ? grants.slice(1) : grants;
  // Pour l'affichage : combien de cartes Unique restent a gagner / sont dues.
  json.unique = { total: all.length, remaining: missing.length, owed };
}
