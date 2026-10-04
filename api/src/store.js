// Stockage de l'API 2Gatcha (SQLite + memoire).
//
// Format des lignes (celui qu'attendent les workflows) : une ligne =
// { id, ...colonnes }, References en
// entier (0 = vide), RefList/Attachments/ChoiceList en ["L", ...], dates en
// epoch secondes. C'est ce qui permet de reutiliser telle quelle toute la
// logique metier des workflows.
//
// Toutes les tables vivent en memoire (lectures instantanees, plus de
// relecture reseau de tables entieres a chaque clic) et chaque ecriture est
// repercutee immediatement dans un fichier SQLite (mode WAL).

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BY_TYPE = {
  Numeric: 0, Int: 0, Text: '', Bool: false, Choice: '', Ref: 0,
  RefList: null, ChoiceList: null, Attachments: null, Date: null, DateTime: null, Any: null
};

function baseType(type) {
  return String(type || 'Any').split(':')[0];
}

// Conversion des valeurs ecrites selon le type de la colonne
// (ex. "12" -> 12 dans une colonne Numeric, true -> true dans un Toggle).
export function coerce(type, value) {
  const t = baseType(type);
  if (value === undefined) return DEFAULT_BY_TYPE[t] ?? null;
  if (value === null) return t === 'Text' || t === 'Choice' ? '' : (t === 'Bool' ? false : (t === 'Ref' ? 0 : null));
  switch (t) {
    case 'Numeric':
    case 'Int':
    case 'Date':
    case 'DateTime': {
      if (value === '') return t === 'Date' || t === 'DateTime' ? null : 0;
      if (typeof value === 'boolean') return value ? 1 : 0;
      const n = Number(value);
      if (Number.isNaN(n)) return value; // valeur invalide gardee telle quelle
      return t === 'Int' ? Math.trunc(n) : n;
    }
    case 'Bool':
      if (typeof value === 'string') return value === 'true' || value === '1';
      return !!value;
    case 'Text':
    case 'Choice':
      return typeof value === 'string' ? value : (typeof value === 'object' ? JSON.stringify(value) : String(value));
    case 'Ref': {
      const n = Number(Array.isArray(value) ? value[1] : value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'RefList':
    case 'Attachments':
    case 'ChoiceList':
      if (Array.isArray(value)) return value[0] === 'L' ? value : ['L', ...value];
      if (value === '' ) return null;
      return ['L', value];
    default:
      return value;
  }
}

export class Store {
  // lenient : colonnes inconnues acceptees (creees a la volee) - reserve aux
  // tests sur une base d'essai, jamais en production.
  constructor(dbPath, { lenient = false } = {}) {
    this.lenient = lenient;
    // Compteur de modifications : permet aux sauvegardes de sauter un
    // creneau quand rien n'a change.
    this.changes = 0;
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS meta_tables (name TEXT PRIMARY KEY, columns TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rows (tbl TEXT NOT NULL, id INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tbl, id));
      CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY, file_name TEXT, mime TEXT, data BLOB);
    `);
    this.stmt = {
      upsertRow: this.db.prepare('INSERT INTO rows (tbl, id, data) VALUES (?, ?, ?) ON CONFLICT (tbl, id) DO UPDATE SET data = excluded.data'),
      deleteRow: this.db.prepare('DELETE FROM rows WHERE tbl = ? AND id = ?'),
      upsertTable: this.db.prepare('INSERT INTO meta_tables (name, columns) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET columns = excluded.columns'),
      getAttachment: this.db.prepare('SELECT file_name, mime, data FROM attachments WHERE id = ?'),
      putAttachment: this.db.prepare('INSERT INTO attachments (id, file_name, mime, data) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET file_name = excluded.file_name, mime = excluded.mime, data = excluded.data')
    };
    this.load();
  }

  // Charge toutes les tables en memoire.
  load() {
    this.tables = new Map();
    for (const { name, columns } of this.db.prepare('SELECT name, columns FROM meta_tables').all()) {
      const cols = JSON.parse(columns);
      // Une colonne "formule" a formule vide (heritage de l'ancienne base,
      // vide) : ce sont en fait des colonnes de donnees. Corrige une fois
      // pour toutes en base (bases importees avant ce correctif).
      let fixed = false;
      for (const def of Object.values(cols)) {
        if (def.isFormula && !String(def.formula || '').trim()) { def.isFormula = false; def.formula = ''; fixed = true; }
      }
      if (fixed) this.stmt.upsertTable.run(name, JSON.stringify(cols));
      this.tables.set(name, { name, columns: cols, rows: new Map(), maxId: 0, snapshot: null });
    }
    for (const { tbl, id, data } of this.db.prepare('SELECT tbl, id, data FROM rows ORDER BY tbl, id').all()) {
      const t = this.tables.get(tbl);
      if (!t) continue;
      t.rows.set(id, data);
      if (id > t.maxId) t.maxId = id;
    }
  }

  table(name) {
    const t = this.tables.get(name);
    if (!t && this.lenient) { this.defineTable(name, {}); return this.tables.get(name); }
    if (!t) {
      const err = new Error(`Table not found "${name}"`);
      err.httpCode = 404;
      throw err;
    }
    return t;
  }

  // Lecture complete d'une table : chaque appel renvoie des objets NEUFS (les
  // workflows modifient librement les lignes lues, sans effet sur le stock).
  // Le texte JSON de la table est mis en cache jusqu'a la prochaine ecriture.
  getAllJson(name) {
    const t = this.table(name);
    if (t.snapshot == null) t.snapshot = '[' + [...t.rows.values()].join(',') + ']';
    return t.snapshot;
  }

  getAll(name) {
    return JSON.parse(this.getAllJson(name));
  }

  get(name, id) {
    const raw = this.table(name).rows.get(Number(id));
    return raw ? JSON.parse(raw) : null;
  }

  // Colonnes inconnues et colonnes formules refusees :
  // comportement ici, pour reperer tout de suite une colonne manquante.
  prepareFields(t, fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if (k === 'id') continue;
      let col = t.columns[k];
      if (!col && this.lenient) { this.addColumn(t.name, k, 'Any'); col = t.columns[k]; }
      if (!col) {
        const err = new Error(`Invalid column "${k}" in table "${t.name}"`);
        err.httpCode = 400;
        throw err;
      }
      if (isRealFormula(col)) {
        const err = new Error(`Cannot write formula column "${k}" in table "${t.name}"`);
        err.httpCode = 400;
        throw err;
      }
      out[k] = coerce(col.type, v);
    }
    return out;
  }

  write(t, id, row) {
    const json = JSON.stringify(row);
    t.rows.set(id, json);
    t.snapshot = null;
    this.stmt.upsertRow.run(t.name, id, json);
    this.changes++;
  }

  create(name, fields) {
    const t = this.table(name);
    const values = this.prepareFields(t, fields);
    const id = t.maxId + 1;
    t.maxId = id;
    const row = { id };
    for (const [col, def] of Object.entries(t.columns)) {
      if (col in values) row[col] = values[col];
      else row[col] = defaultFor(def);
    }
    this.write(t, id, row);
    return row;
  }

  update(name, id, fields) {
    const t = this.table(name);
    id = Number(id);
    const raw = t.rows.get(id);
    if (!raw) {
      const err = new Error(`Invalid row id ${id} in table "${name}"`);
      err.httpCode = 400;
      throw err;
    }
    const row = { ...JSON.parse(raw), ...this.prepareFields(t, fields) };
    this.write(t, id, row);
    return row;
  }

  delete(name, id) {
    const t = this.table(name);
    id = Number(id);
    if (!t.rows.has(id)) return false;
    t.rows.delete(id);
    t.snapshot = null;
    this.stmt.deleteRow.run(name, id);
    this.changes++;
    return true;
  }

  // --- administration du schema (import, page admin) ----------------------
  defineTable(name, columns) {
    this.stmt.upsertTable.run(name, JSON.stringify(columns));
    const existing = this.tables.get(name);
    if (existing) existing.columns = columns;
    else this.tables.set(name, { name, columns, rows: new Map(), maxId: 0, snapshot: null });
  }

  addColumn(name, colId, type) {
    const t = this.table(name);
    if (t.columns[colId]) return;
    const columns = { ...t.columns, [colId]: { type, isFormula: false } };
    this.defineTable(name, columns);
    const def = defaultFor(columns[colId]);
    for (const [id, raw] of t.rows) this.write(t, id, { ...JSON.parse(raw), [colId]: def });
  }

  // Les operations ci-dessous (page admin) modifient le schema ET toutes les
  // lignes, dans une transaction : tout ou rien.
  createTable(name, columns = {}) {
    assertId(name, 'table');
    if (this.tables.has(name)) throw httpError(409, `Table "${name}" already exists`);
    for (const colId of Object.keys(columns)) assertId(colId, 'column');
    const cols = Object.fromEntries(Object.entries(columns).map(([k, d]) => [k, { type: (d && d.type) || 'Any', isFormula: false, formula: '' }]));
    this.transaction(() => this.defineTable(name, cols));
  }

  renameTable(name, newName) {
    const t = this.table(name);
    if (name === newName) return;
    assertId(newName, 'table');
    if (this.tables.has(newName)) throw httpError(409, `Table "${newName}" already exists`);
    this.transaction(() => {
      this.db.prepare('UPDATE rows SET tbl = ? WHERE tbl = ?').run(newName, name);
      this.db.prepare('UPDATE meta_tables SET name = ? WHERE name = ?').run(newName, name);
      this.tables.delete(name);
      t.name = newName;
      this.tables.set(newName, t);
      // Les colonnes Ref:/RefList: (de toutes les tables) suivent le nouveau nom.
      for (const other of this.tables.values()) {
        let changed = false;
        const cols = {};
        for (const [k, d] of Object.entries(other.columns)) {
          const m = /^(Ref|RefList):(.+)$/.exec(d.type || '');
          if (m && m[2] === name) { cols[k] = { ...d, type: `${m[1]}:${newName}` }; changed = true; } else cols[k] = d;
        }
        if (changed) this.defineTable(other.name, cols);
      }
      this.changes++;
    });
  }

  dropTable(name) {
    this.table(name);
    this.transaction(() => {
      this.db.prepare('DELETE FROM rows WHERE tbl = ?').run(name);
      this.db.prepare('DELETE FROM meta_tables WHERE name = ?').run(name);
      this.tables.delete(name);
      this.changes++;
    });
  }

  // changes : { id?: nouveau nom, type?: nouveau type, formula?: false pour
  // transformer une colonne formule en colonne de donnees }. Renommer garde
  // la position de la colonne ; changer le type reconvertit chaque valeur.
  updateColumn(name, colId, changes = {}) {
    const t = this.table(name);
    const old = t.columns[colId];
    if (!old) throw httpError(404, `Column "${colId}" not found in table "${name}"`);
    const newId = changes.id && changes.id !== colId ? changes.id : colId;
    if (newId !== colId) {
      assertId(newId, 'column');
      if (t.columns[newId]) throw httpError(409, `Column "${newId}" already exists in table "${name}"`);
    }
    const def = { ...old };
    const retype = !!changes.type && changes.type !== old.type;
    if (retype) def.type = changes.type;
    if (changes.formula === false) { def.isFormula = false; def.formula = ''; }
    const columns = {};
    for (const [k, d] of Object.entries(t.columns)) columns[k === colId ? newId : k] = k === colId ? def : d;
    this.transaction(() => {
      this.defineTable(name, columns);
      if (newId === colId && !retype) return;
      for (const [id, raw] of t.rows) {
        const row = JSON.parse(raw);
        const out = {};
        for (const [k, v] of Object.entries(row)) {
          if (k !== colId) { out[k] = v; continue; }
          out[newId] = retype ? convertValue(old.type, def.type, v) : v;
        }
        if (!(colId in row)) out[newId] = defaultFor(def);
        this.write(t, id, out);
      }
    });
  }

  dropColumn(name, colId) {
    const t = this.table(name);
    if (!t.columns[colId]) throw httpError(404, `Column "${colId}" not found in table "${name}"`);
    const columns = { ...t.columns };
    delete columns[colId];
    this.transaction(() => {
      this.defineTable(name, columns);
      for (const [id, raw] of t.rows) {
        const row = JSON.parse(raw);
        if (!(colId in row)) continue;
        delete row[colId];
        this.write(t, id, row);
      }
    });
  }

  // Une piece jointe peut exister SANS contenu (data NULL) : image connue
  // (nom d'origine, cartes qui l'utilisent) mais perdue lors de
  // l'import, a re-importer depuis la page d'administration.
  getAttachment(id) {
    const a = this.stmt.getAttachment.get(Number(id));
    return a && a.data ? a : null;
  }

  listAttachments() {
    return this.db.prepare('SELECT id, file_name AS fileName, mime, LENGTH(data) AS size FROM attachments ORDER BY id').all()
      .map((a) => ({ ...a, missing: a.size == null }));
  }

  deleteAttachment(id) {
    this.db.prepare('DELETE FROM attachments WHERE id = ?').run(Number(id));
    this.changes++;
  }

  putAttachment(id, fileName, mime, data) {
    this.stmt.putAttachment.run(Number(id), fileName, mime, data);
    this.changes++;
  }

  nextAttachmentId() {
    const r = this.db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM attachments').get();
    return r.n;
  }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      this.load();
      throw e;
    }
  }

  // Copie coherente de la base dans un fichier (SQLite VACUUM INTO) : sure
  // meme pendant que l'API tourne.
  snapshotTo(file) {
    this.db.exec("VACUUM INTO '" + String(file).replace(/'/g, "''") + "'");
  }

  stats() {
    return Object.fromEntries([...this.tables.values()].map((t) => [t.name, t.rows.size]));
  }
}

function httpError(code, message) {
  return Object.assign(new Error(message), { httpCode: code, status: code });
}

function assertId(id, what) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(String(id || ''))) throw httpError(400, `Invalid ${what} id "${id}"`);
}

// Vraie formule Python (non executable ici) : ecriture refusee. Une colonne
// "formule" a formule vide est une colonne de donnees.
function isRealFormula(col) {
  return !!col.isFormula && !!String(col.formula || '').trim();
}

// Conversion d'une valeur existante lors d'un changement de type de colonne.
export function convertValue(fromType, toType, v) {
  const from = baseType(fromType), to = baseType(toType);
  if (v == null) return coerce(toType, null);
  if (v === '') return coerce(toType, '');
  const listLike = (t) => t === 'RefList' || t === 'ChoiceList' || t === 'Attachments';
  if (listLike(from) && Array.isArray(v)) {
    const items = v[0] === 'L' ? v.slice(1) : v;
    if (listLike(to)) return ['L', ...items];
    if (to === 'Ref') return Number(items[0]) || 0;
    if (to === 'Text' || to === 'Choice') return items.join(', ');
    return items.length ? coerce(toType, items[0]) : coerce(toType, null);
  }
  if (from === 'Ref' && listLike(to)) return v ? ['L', v] : null;
  if (to === 'Ref' && typeof v === 'string' && !/^\d+$/.test(v.trim())) return 0;
  if ((to === 'Text' || to === 'Choice') && (from === 'Date' || from === 'DateTime') && typeof v === 'number') {
    return new Date(v * 1000).toISOString().slice(0, from === 'Date' ? 10 : 19).replace('T', ' ');
  }
  if ((to === 'Date' || to === 'DateTime') && typeof v === 'string' && !/^-?\d+(\.\d+)?$/.test(v.trim())) {
    const d = Date.parse(v);
    return Number.isNaN(d) ? v : Math.floor(d / 1000);
  }
  return coerce(toType, v);
}

// Valeur par defaut d'une colonne a la creation d'une ligne. Les "trigger
// formulas" les plus courantes (NOW(), date du jour) sont imitees ; les
// autres formules Python ne peuvent pas etre executees ici.
function defaultFor(col) {
  const f = String(col.formula || '').trim();
  if (!col.isFormula && /^NOW\(\)$/i.test(f)) return Math.floor(Date.now() / 1000);
  if (!col.isFormula && /^TODAY\(\)$/i.test(f)) { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return Math.floor(d / 1000); }
  return DEFAULT_BY_TYPE[baseType(col.type)] ?? null;
}
