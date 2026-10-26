// Admin > Tout voir (2026-10-29) : toutes les tables de la base, lues et
// modifiees depuis la page Admin avec le compte Discord admin (sans le jeton
// de la page Base de donnees). Lignes paginees, recherche (texte libre ou
// « Colonne=valeur »), tri, references vers les autres tables avec leur nom,
// edition champ par champ (le store convertit selon le type de la colonne),
// creation, duplication et suppression de ligne. Les ecritures passent par
// store.update / create / delete : journal de l'economie et historique des
// exemplaires compris, comme les autres outils de l'equipe.
//   POST /webhook/admin-explorer { discordId, action: 'tables' | 'rows' | 'row' | 'set' | 'create' | 'delete', table?, id?, q?, offset?, limit?, sort?, desc?, fields? }

import { ok, fail, isAdmin } from './common.js';

const LABEL_COLS = ['Pseudo', 'Name', 'Label', 'Title', 'Key', 'Code', 'Nom'];
const JSON_TYPES = new Set(['RefList', 'Attachments', 'ChoiceList', 'Any']);
const PREVIEW = 140;
const baseType = (type) => String(type || 'Any').split(':')[0];
const refTarget = (type) => (/^Ref(List)?:/.test(String(type || '')) ? String(type).split(':')[1] : null);

function columnsOf(store, name) {
  const t = store.tables.get(name);
  // Sans type de reference (colonne Any, Numeric) : User -> Users, Card -> Cards...
  const guess = (id, c) => refTarget(c.type) || (['Any', 'Numeric', 'Int'].includes(baseType(c.type)) && store.tables.has(id + 's') ? id + 's' : null);
  return Object.entries(t.columns).map(([id, c]) => ({ id, type: c.type || 'Any', base: baseType(c.type), ref: guess(id, c), formula: !!(c.isFormula && String(c.formula || '').trim()) }));
}
// Nom lisible d'une ligne (pseudo, nom, libelle...), sinon « #id ».
function labelOf(row) {
  if (!row) return null;
  for (const c of LABEL_COLS) if (row[c] != null && row[c] !== '') return String(row[c]).slice(0, 60);
  return '#' + row.id;
}
const preview = (v) => {
  if (v == null) return v;
  if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > PREVIEW ? s.slice(0, PREVIEW) + '…' : v; }
  if (typeof v === 'string' && v.length > PREVIEW) return v.slice(0, PREVIEW) + '…';
  return v;
};
// Libelles des lignes referencees (seulement celles de la page affichee).
function refLabels(store, cols, rows) {
  const out = {};
  for (const c of cols) {
    if (!c.ref || !store.tables.has(c.ref)) continue;
    const ids = new Set();
    for (const r of rows) {
      const v = r[c.id];
      if (Array.isArray(v)) v.slice(v[0] === 'L' ? 1 : 0).forEach((x) => ids.add(Number(x)));
      else if (Number(v) > 0) ids.add(Number(v));
    }
    const m = out[c.ref] || (out[c.ref] = {});
    for (const id of ids) if (!(id in m)) m[id] = labelOf(store.get(c.ref, id));
  }
  return out;
}
// Champs envoyes par la page : textes JSON relus pour les colonnes de listes.
function parseFields(cols, fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    const c = cols.find((x) => x.id === k);
    if (!c) throw Object.assign(new Error('unknown_column'), { column: k });
    if (c.formula) throw Object.assign(new Error('formula_column'), { column: k });
    if (JSON_TYPES.has(c.base) && typeof v === 'string' && /^\s*[[{"\d-]|^\s*(true|false|null)\s*$/.test(v)) {
      try { out[k] = JSON.parse(v); continue; } catch (e) { if (c.base !== 'Any') throw Object.assign(new Error('invalid_json'), { column: k }); }
    }
    out[k] = v;
  }
  return out;
}
function match(row, q) {
  if (!q) return true;
  const m = /^\s*([A-Za-z_][\w]*)\s*(=|~|>|<)\s*(.*)$/.exec(q);
  if (m && (m[1] in row || m[1] === 'id')) {
    const v = row[m[1]], want = m[3].trim();
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (m[2] === '=') return s === want || (Array.isArray(v) && v.map(String).includes(want));
    if (m[2] === '~') return s.toLowerCase().includes(want.toLowerCase());
    if (m[2] === '>') return Number(v) > Number(want);
    return Number(v) < Number(want);
  }
  return JSON.stringify(row).toLowerCase().includes(q.toLowerCase());
}

function handle({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const action = body.action || 'tables';
  if (action === 'tables') {
    const tables = [...store.tables.values()].map((t) => ({ name: t.name, rows: t.rows.size, columns: Object.keys(t.columns).length })).sort((a, b) => a.name.localeCompare(b.name));
    return ok({ tables });
  }
  const name = String(body.table || '');
  if (!store.tables.has(name)) return fail('unknown_table', 404);
  const cols = columnsOf(store, name);
  if (action === 'rows') {
    const q = String(body.q || '').trim();
    let rows = store.getAll(name).filter((r) => match(r, q));
    const sort = body.sort && (body.sort === 'id' || cols.some((c) => c.id === body.sort)) ? body.sort : 'id';
    const dir = body.desc ? -1 : 1;
    rows.sort((a, b) => {
      const x = a[sort], y = b[sort];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x ?? '').localeCompare(String(y ?? ''), 'fr', { numeric: true }) * dir;
    });
    const total = rows.length;
    const limit = Math.max(1, Math.min(200, Number(body.limit) || 50));
    const offset = Math.max(0, Number(body.offset) || 0);
    rows = rows.slice(offset, offset + limit);
    return ok({ table: name, columns: cols, total, offset, limit, sort, desc: !!body.desc, refs: refLabels(store, cols, rows), rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, preview(v)]))) });
  }
  const id = Number(body.id) || 0;
  if (action === 'row') {
    const row = store.get(name, id);
    if (!row) return fail('unknown_row', 404);
    return ok({ table: name, columns: cols, row, refs: refLabels(store, cols, [row]) });
  }
  let fields;
  try { fields = parseFields(cols, body.fields); } catch (e) { return fail(e.message, 400, { column: e.column }); }
  if (action === 'set') {
    if (!store.get(name, id)) return fail('unknown_row', 404);
    if (!Object.keys(fields).length) return fail('nothing_to_change');
    try { return ok({ row: store.update(name, id, fields) }); } catch (e) { return fail('write_failed', 400, { message: e.message }); }
  }
  if (action === 'create') {
    try { return ok({ row: store.create(name, fields) }); } catch (e) { return fail('write_failed', 400, { message: e.message }); }
  }
  if (action === 'delete') {
    if (!store.delete(name, id)) return fail('unknown_row', 404);
    return ok({ deleted: id });
  }
  return fail('unknown_action');
}

export const routes = { 'POST admin-explorer': handle };
