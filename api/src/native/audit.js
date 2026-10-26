// Journal des actions de l'equipe, avec annulation (2026-10-29). Chaque
// ecriture faite par un admin depuis la page Admin (Tout voir, dons, codes,
// fiche joueur, cosmetiques, reglages) est enregistree avec l'etat d'avant
// de chaque ligne touchee (AdminAudit). « Annuler » rejoue a l'envers :
//  - quantite (ressource, XP...) : on retire seulement l'ecart ajoute par l'action (ce que
//    le joueur a gagne ou depense depuis est garde) ;
//  - autre champ : remis a l'ancienne valeur s'il n'a pas change depuis,
//    sinon laisse tel quel (signale « modifie depuis ») ;
//  - ligne creee : supprimee ; ligne supprimee : recreee avec le meme numero.
//   POST /webhook/admin-audit { discordId, action: 'list' | 'undo', id?, limit? }

import { ok, fail, isAdmin, now } from './common.js';

export const schema = {
  AdminAudit: { At: { type: 'Numeric' }, Actor: { type: 'Text' }, Route: { type: 'Text' }, Action: { type: 'Text' }, Summary: { type: 'Text' }, Ops: { type: 'Text' }, UndoneAt: { type: 'Numeric' }, UndoneBy: { type: 'Text' }, UndoNote: { type: 'Text' } }
};

// Routes et actions enregistrees (lectures exclues).
const AUDITED = {
  'admin-explorer': ['set', 'create', 'delete'],
  'admin-rewards': ['gift', 'createCode', 'updateCode'],
  'admin-player': ['set', 'pull'],
  'admin-cosmetics': ['save', 'delete', 'grant'],
  'admin-settings': ['set', 'reset']
};
const LABEL = {
  'admin-explorer': { set: 'Tout voir : ligne modifiée', create: 'Tout voir : ligne créée', delete: 'Tout voir : ligne supprimée' },
  'admin-rewards': { gift: 'Don', createCode: 'Code créé', updateCode: 'Code modifié' },
  'admin-player': { set: 'Fiche joueur : valeurs', pull: 'Fiche joueur : exemplaire' },
  'admin-cosmetics': { save: 'Cosmétique enregistré', delete: 'Cosmétique supprimé', grant: 'Cosmétique offert' },
  'admin-settings': { set: 'Réglages modifiés', reset: 'Réglage remis par défaut' }
};
const KEEP = 400;
const SKIP_TABLES = new Set(['AdminAudit', 'EconomyLog', 'NotificationLog', 'ServerFeed', 'PullHistory']);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Execute fn en notant chaque ligne touchee ; enregistre si l'action a reussi.
export function wrap(store, path, body, fn) {
  const acts = AUDITED[path];
  const action = String((body && body.action) || '');
  if (!acts || !acts.includes(action) || !isAdmin(body.discordId) || !store.tables.has('AdminAudit')) return fn();
  const ops = [];
  const { update, create, delete: del } = store;
  store.update = function (name, id, fields) {
    if (SKIP_TABLES.has(name)) return update.call(this, name, id, fields);
    const before = this.get(name, id);
    const row = update.call(this, name, id, fields);
    if (before) {
      const b = {}, a = {};
      for (const k of Object.keys(fields || {})) if (!same(before[k], row[k])) { b[k] = before[k] ?? null; a[k] = row[k] ?? null; }
      if (Object.keys(a).length) ops.push({ op: 'update', table: name, id: Number(id), before: b, after: a });
    }
    return row;
  };
  store.create = function (name, fields) {
    const row = create.call(this, name, fields);
    if (!SKIP_TABLES.has(name)) ops.push({ op: 'create', table: name, id: row.id });
    return row;
  };
  store.delete = function (name, id) {
    const row = SKIP_TABLES.has(name) ? null : this.get(name, id);
    const done = del.call(this, name, id);
    if (done && row) ops.push({ op: 'delete', table: name, id: Number(id), row });
    return done;
  };
  let res;
  try { res = fn(); } finally { Object.assign(store, { update, create, delete: del }); }
  if (res && res.status === 200 && ops.length) {
    try {
      store.create('AdminAudit', { At: now(), Actor: String(body.discordId), Route: path, Action: action, Summary: summarize(store, path, action, body, ops), Ops: JSON.stringify(ops) });
      const rows = store.getAll('AdminAudit');
      if (rows.length > KEEP) rows.sort((x, y) => x.id - y.id).slice(0, rows.length - KEEP).forEach((r) => store.delete('AdminAudit', r.id));
    } catch (e) { console.error(e); }
  }
  return res;
}

function pseudo(store, id) { const u = store.tables.has('Users') ? store.get('Users', id) : null; return u ? u.Pseudo || '#' + id : '#' + id; }
function summarize(store, path, action, body, ops) {
  const head = (LABEL[path] || {})[action] || `${path} ${action}`;
  const users = [...new Set(ops.filter((o) => o.table === 'Users').map((o) => o.id))];
  const bits = [];
  if (path === 'admin-explorer') bits.push(`${body.table} #${body.id || ops[0].id}`);
  if (path === 'admin-rewards' && body.code) bits.push(String(body.code));
  if (path === 'admin-settings') bits.push(Object.keys(body.values || {}).concat(body.key ? [body.key] : []).slice(0, 4).join(', '));
  if (path === 'admin-cosmetics') bits.push(String((body.item && body.item.key) || body.key || ''));
  if (users.length) bits.push(users.length > 3 ? `${users.length} joueurs` : users.map((id) => pseudo(store, id)).join(', '));
  const n = ops.length;
  return `${head}${bits.filter(Boolean).length ? ' : ' + bits.filter(Boolean).join(' · ') : ''} (${n} changement${n > 1 ? 's' : ''})`;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// Quantite (ressource, XP, compteur) : on retire l'ecart. Date, numero, reference : valeur exacte.
const isAmount = (table, key) => !/(At|Until|Since|Day|Week|Month|Time|Id|^id)$/.test(key) && !/^(User|Card|Rarity|Extension|Boss)$/.test(key);
function undoOps(store, ops) {
  const skipped = [];
  for (const o of ops.slice().reverse()) {
    if (!store.tables.has(o.table)) { skipped.push(`${o.table} : table disparue`); continue; }
    if (o.op === 'create') { store.delete(o.table, o.id); continue; }
    if (o.op === 'delete') {
      if (store.get(o.table, o.id)) { skipped.push(`${o.table} #${o.id} : existe déjà`); continue; }
      const t = store.table(o.table);
      store.write(t, o.id, o.row);
      if (o.id > t.maxId) t.maxId = o.id;
      continue;
    }
    const cur = store.get(o.table, o.id);
    if (!cur) { skipped.push(`${o.table} #${o.id} : ligne supprimée depuis`); continue; }
    const fields = {};
    for (const [k, before] of Object.entries(o.before)) {
      const after = o.after[k];
      if (isNum(before) && isNum(after) && isNum(cur[k]) && isAmount(o.table, k)) fields[k] = cur[k] - (after - before);
      else if (same(cur[k], after)) fields[k] = before;
      else skipped.push(`${o.table} #${o.id} ${k} : modifié depuis`);
    }
    if (Object.keys(fields).length) store.update(o.table, o.id, fields);
  }
  return skipped;
}

function view(store, r) {
  let ops = [];
  try { ops = JSON.parse(r.Ops || '[]'); } catch (e) { ops = []; }
  return {
    id: r.id, at: r.At, actor: r.Actor, route: r.Route, action: r.Action, summary: r.Summary, undoneAt: r.UndoneAt || null, undoNote: r.UndoNote || '',
    changes: ops.slice(0, 30).map((o) => ({ op: o.op, table: o.table, id: o.id, fields: o.op === 'update' ? Object.keys(o.after).map((k) => ({ key: k, before: o.before[k], after: o.after[k] })) : [] })),
    more: Math.max(0, ops.length - 30)
  };
}

function handle({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  if (!store.tables.has('AdminAudit')) return ok({ entries: [] });
  const action = body.action || 'list';
  if (action === 'list') {
    const limit = Math.max(1, Math.min(200, Number(body.limit) || 60));
    return ok({ entries: store.getAll('AdminAudit').sort((a, b) => b.id - a.id).slice(0, limit).map((r) => view(store, r)) });
  }
  if (action !== 'undo') return fail('unknown_action');
  const r = store.get('AdminAudit', Number(body.id));
  if (!r) return fail('unknown_entry', 404);
  if (r.UndoneAt) return fail('already_undone');
  let ops = [];
  try { ops = JSON.parse(r.Ops || '[]'); } catch (e) { return fail('unreadable_entry'); }
  const skipped = undoOps(store, ops);
  store.update('AdminAudit', r.id, { UndoneAt: now(), UndoneBy: String(body.discordId), UndoNote: skipped.join(' ; ').slice(0, 1000) });
  return ok({ undone: r.id, skipped, entry: view(store, store.get('AdminAudit', r.id)) });
}

export const routes = { 'POST admin-audit': handle };
