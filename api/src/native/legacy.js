// Heritage des comptes supprimes (2026-11-11) : ce qu'il reste d'un joueur qui
// n'existe plus (ligne Users supprimee) est reparti en butin entre tous les
// autres joueurs (sauf le compte test), puis ses traces sont nettoyees.
//  - Exemplaires (Pulls) : distribues un par un, les plus rares d'abord, a
//    tour de role dans un ordre tire au hasard (chacun en recoit au plus un de
//    plus qu'un autre). Coffre, etoile, assurance et bain de soleil remis a
//    zero ; finition, etat, edition, numero et gemme gardes.
//  - Ressources (champs Users du catalogue des dons : jetons booster,
//    poussieres, cles, vers, tablettes...) : divisees a parts egales, le reste
//    donne 1 par 1 a des joueurs tires au hasard. Lues dans la ligne supprimee
//    (suppression depuis Admin > Tout voir, ou retrouvee dans le journal de
//    l'equipe) ; inconnues si le compte a ete supprime ailleurs.
//  - Chaque heritier voit un message a sa prochaine visite (modefun.inbox), le
//    defunt n'est pas nomme.
//  - Traces : lignes « a lui » (colonne User, Profile, Author, From, To,
//    Host, Seller...) supprimees ; ailleurs (Cards.FirstObtainedBy, boss,
//    artistes...) la reference est videe ; retire des listes RefList:Users.
//    Journaux gardes tels quels (EconomyLog, PullHistory, AdminAudit...).
//    Encheres non touchees : elles se reglent seules (un exemplaire invendu
//    qui revient au compte supprime est reparti au passage suivant).
//  - Declenchement : tout de suite a la suppression depuis Tout voir, et une
//    passe par heure (+ au demarrage) pour les comptes supprimes autrement.
//    Une trace par compte dans Inheritances (ressources donnees une seule fois).

import { refId, now } from './common.js';
import { RESOURCES, grant } from './rewards.js';
import { inbox } from './modefun.js';
import { stockOf } from './archeo.js';
import { testAccountId } from './testuser.js';
import { captureError } from '../monitoring.js';

export const schema = {
  Inheritances: { UserId: { type: 'Numeric' }, Pseudo: { type: 'Text' }, At: { type: 'Numeric' }, Heirs: { type: 'Numeric' }, Cards: { type: 'Numeric' }, Resources: { type: 'Text' }, Cleaned: { type: 'Numeric' } }
};

// Journaux et tables reglees ailleurs : jamais touches, jamais pris pour un signe d'orphelin.
const UNTOUCHED = new Set(['Users', 'Inheritances', 'EconomyLog', 'EconomyDaily', 'PullHistory', 'AdminAudit', 'Auctions']);
// Lignes partagees : la reference est seulement videe.
const SHARED = new Set(['Cards', 'Artists', 'CommunityBoss', 'Extensions', 'CommunityGoals', 'GuildWorks', 'CommunityDig', 'ScheduledEvents', 'PlannerRules']);
// Colonnes qui designent le proprietaire de la ligne.
const OWNER_COLS = new Set(['User', 'Profile', 'Author', 'From', 'To', 'Host', 'Seller', 'Owner', 'Player', 'Sender', 'Recipient', 'FromUser', 'ToUser', 'Proposer', 'Receiver', 'Offerer', 'Initiator']);
// Colonnes sans type de reference (heritage de l'ancienne base) qui contiennent un id de joueur.
const UNTYPED_USER_COLS = new Set(['User', 'FirstObtainedBy', 'ClaimedBy', 'Finisher', 'FromUser', 'ToUser']);
// Garde-fou : au-dela, la passe automatique s'abstient (base mal chargee ?).
const MAX_ORPHANS_PER_SWEEP = 10;
const PULL_RESET = { InVault: false, Starred: false, Insured: false, SunbathUntil: 0 };

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const base = (type) => String(type || 'Any').split(':')[0];

// Colonnes qui pointent vers un joueur : { col, list }.
function userColumns(store, name) {
  const t = store.tables.get(name);
  if (!t) return [];
  return Object.entries(t.columns).filter(([, c]) => !(c.isFormula && String(c.formula || '').trim())).flatMap(([col, c]) => {
    if (c.type === 'RefList:Users') return [{ col, list: true }];
    if (c.type === 'Ref:Users' || (UNTYPED_USER_COLS.has(col) && ['Any', 'Numeric', 'Int'].includes(base(c.type)))) return [{ col, list: false }];
    return [];
  });
}
const listIds = (v) => (Array.isArray(v) ? v.slice(v[0] === 'L' ? 1 : 0).map(Number) : []);

// Ids de joueurs references mais absents de Users.
export function orphanIds(store) {
  if (!store.tables.has('Users')) return [];
  const alive = new Set(store.getAll('Users').map((u) => u.id));
  if (!alive.size) return [];
  const found = new Set();
  for (const name of store.tables.keys()) {
    if (UNTOUCHED.has(name)) continue;
    const cols = userColumns(store, name);
    if (!cols.length) continue;
    for (const r of store.getAll(name)) {
      for (const { col, list } of cols) {
        for (const id of list ? listIds(r[col]) : [Number(refId(r[col])) || 0]) if (id > 0 && !alive.has(id)) found.add(id);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

// Ligne Users supprimee retrouvee dans le journal de l'equipe (audit.js).
function deletedRowFromAudit(store, userId) {
  if (!store.tables.has('AdminAudit')) return null;
  for (const a of store.getAll('AdminAudit').sort((x, y) => y.id - x.id)) {
    if (!String(a.Ops || '').includes('"Users"')) continue;
    let ops = [];
    try { ops = JSON.parse(a.Ops); } catch (e) { continue; }
    const op = ops.find((o) => o.op === 'delete' && o.table === 'Users' && Number(o.id) === userId && o.row);
    if (op) return op.row;
  }
  return null;
}

// Ressources du defunt : [{ key, n }].
function resourcesOf(row) {
  if (!row) return [];
  const out = [];
  for (const [key, r] of Object.entries(RESOURCES)) {
    if (r.minutes) continue;
    const n = r.tablet ? stockOf(row)[r.tablet] || 0 : Math.max(0, Math.floor(Number(row[r.field]) || 0));
    if (n > 0) out.push({ key, n });
  }
  return out;
}

function rarityRank(store) {
  const rank = new Map();
  if (store.tables.has('Rarities')) store.getAll('Rarities').forEach((r) => rank.set(r.id, Number(r.SortOrder) || 0));
  return (pull) => { const c = store.get('Cards', refId(pull.Card)); return c ? rank.get(refId(c.Rarity)) || 0 : 0; };
}

// Repartit puis nettoie. row = ligne Users supprimee (ou null : cherchee dans le journal).
export function inherit(store, userId, row = null, { dryRun = false } = {}) {
  userId = Number(userId);
  if (!(userId > 0) || store.get('Users', userId)) return { skipped: 'alive' };
  const testId = testAccountId(store);
  const heirs = shuffle(store.getAll('Users').filter((u) => u.id !== testId).map((u) => u.id));
  if (!heirs.length) return { skipped: 'no_heirs' };
  const past = store.tables.has('Inheritances') ? store.getAll('Inheritances').find((x) => Number(x.UserId) === userId) : null;
  const dead = row || deletedRowFromAudit(store, userId);
  const resources = past ? [] : resourcesOf(dead);

  // Lots par heritier.
  const lots = new Map(heirs.map((id) => [id, { pulls: [], rewards: [] }]));
  const rank = rarityRank(store);
  const pulls = store.tables.has('Pulls') ? shuffle(store.getAll('Pulls').filter((p) => Number(refId(p.User)) === userId)).sort((a, b) => rank(b) - rank(a)) : [];
  const offset = Math.floor(Math.random() * heirs.length);
  pulls.forEach((p, i) => lots.get(heirs[(i + offset) % heirs.length]).pulls.push(p));
  for (const { key, n } of resources) {
    const each = Math.floor(n / heirs.length);
    const extra = new Set(shuffle(heirs.slice()).slice(0, n % heirs.length));
    for (const id of heirs) { const k = each + (extra.has(id) ? 1 : 0); if (k > 0) lots.get(id).rewards.push({ type: 'resource', key, n: k }); }
  }

  // Traces a nettoyer.
  const clean = [];
  for (const name of store.tables.keys()) {
    if (UNTOUCHED.has(name) || name === 'Pulls') continue;
    const cols = userColumns(store, name);
    if (!cols.length) continue;
    for (const r of store.getAll(name)) {
      const hits = cols.filter(({ col, list }) => (list ? listIds(r[col]).includes(userId) : Number(refId(r[col])) === userId));
      if (!hits.length) continue;
      if (!SHARED.has(name) && hits.some((h) => !h.list && OWNER_COLS.has(h.col))) { clean.push({ table: name, id: r.id, op: 'delete' }); continue; }
      const fields = {};
      for (const { col, list } of hits) fields[col] = list ? ['L', ...listIds(r[col]).filter((x) => x !== userId)] : 0;
      clean.push({ table: name, id: r.id, op: 'update', fields });
    }
  }

  const summary = {
    userId, pseudo: dead ? String(dead.Pseudo || '') : '', heirs: heirs.length, cards: pulls.length,
    resources: Object.fromEntries(resources.map((r) => [r.key, r.n])), cleaned: clean.length,
    byTable: clean.reduce((m, c) => ((m[c.table] = (m[c.table] || 0) + 1), m), {})
  };
  if (dryRun) return summary;

  const t = now();
  for (const [heir, lot] of lots) {
    if (!lot.pulls.length && !lot.rewards.length) continue;
    for (const p of lot.pulls) store.update('Pulls', p.id, { User: heir, ObtainedAt: t, ...PULL_RESET });
    const got = lot.rewards.length ? grant(store, heir, lot.rewards, `legacy-${userId}-${heir}`).rewards.map((l) => `${l.icon} ${l.label}`) : [];
    const names = lot.pulls.slice(0, 3).map((p) => (store.get('Cards', refId(p.Card)) || {}).Name).filter(Boolean);
    const cards = lot.pulls.length ? `🎴 ${lot.pulls.length} carte${lot.pulls.length > 1 ? 's' : ''}${names.length ? ` (${names.join(', ')}${lot.pulls.length > names.length ? '…' : ''})` : ''}` : '';
    inbox(store, heir, '🕯️', `Un joueur a quitté 2Gatcha et sa collection a été partagée. Tu hérites de : ${[cards, ...got].filter(Boolean).join(', ')}.`);
  }
  for (const c of clean) {
    if (c.op === 'delete') store.delete(c.table, c.id);
    else store.update(c.table, c.id, c.fields);
  }
  if (store.tables.has('Inheritances')) {
    const fields = { At: t, Heirs: heirs.length, Cards: (Number(past && past.Cards) || 0) + pulls.length, Cleaned: (Number(past && past.Cleaned) || 0) + clean.length };
    if (past) store.update('Inheritances', past.id, fields);
    else store.create('Inheritances', { UserId: userId, Pseudo: summary.pseudo, Resources: JSON.stringify(summary.resources), ...fields });
  }
  return summary;
}

// Passe periodique : comptes supprimes autrement que par Tout voir.
export function sweep(store) {
  const ids = orphanIds(store);
  if (!ids.length) return [];
  if (ids.length > MAX_ORPHANS_PER_SWEEP) {
    captureError(new Error(`legacy: ${ids.length} comptes orphelins, passe automatique annulee`), { job: 'legacy', ids: ids.slice(0, 30) });
    return [];
  }
  const done = [];
  for (const id of ids) {
    try { done.push(store.transaction(() => inherit(store, id))); } catch (e) { console.error(e); captureError(e, { job: 'legacy', userId: id }); }
  }
  return done;
}
