// Stockage de l'API 2Gatcha : remplace Grist.
//
// Les donnees gardent EXACTEMENT la forme que renvoyait l'API Grist (et donc
// le noeud Grist de n8n) : une ligne = { id, ...colonnes }, References en
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

// Conversion des valeurs ecrites, comme le fait Grist a la reception
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
      if (Number.isNaN(n)) return value; // Grist garde la valeur invalide telle quelle
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
      this.tables.set(name, { name, columns: JSON.parse(columns), rows: new Map(), maxId: 0, snapshot: null });
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

  // Grist refuse les colonnes inconnues et les colonnes formules : meme
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
      if (col.isFormula) {
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

  // Une piece jointe peut exister SANS contenu (data NULL) : image connue
  // (nom d'origine, cartes qui l'utilisent) mais perdue cote Grist a
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
  }

  putAttachment(id, fileName, mime, data) {
    this.stmt.putAttachment.run(Number(id), fileName, mime, data);
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

  stats() {
    return Object.fromEntries([...this.tables.values()].map((t) => [t.name, t.rows.size]));
  }
}

// Valeur par defaut d'une colonne a la creation d'une ligne. Les "trigger
// formulas" Grist les plus courantes (NOW(), date du jour) sont imitees ; les
// autres formules Python ne peuvent pas etre executees ici.
function defaultFor(col) {
  const f = String(col.formula || '').trim();
  if (!col.isFormula && /^NOW\(\)$/i.test(f)) return Math.floor(Date.now() / 1000);
  if (!col.isFormula && /^TODAY\(\)$/i.test(f)) { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return Math.floor(d / 1000); }
  return DEFAULT_BY_TYPE[baseType(col.type)] ?? null;
}
