// Routes d'administration de la base (/admin/api/...), utilisees par
// site/admin-db.html : edition des tables (lignes, colonnes, tables) et
// import des images.
//
// Protection : mot de passe ADMIN_TOKEN (variable d'environnement), envoye
// dans l'en-tete "Authorization: Bearer <token>". Sans ADMIN_TOKEN configure,
// l'administration est desactivee. Toutes les ecritures passent par le meme
// verrou que les workflows : jamais d'ecriture concurrente avec une action
// de joueur.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { issueToken } from './native/auth.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const raw = (await readRaw(req, 2 * 1024 * 1024)).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

// Ids de pieces jointes references par une ligne (colonnes Attachments).
function attachmentIds(row, columns) {
  const ids = [];
  for (const [col, def] of Object.entries(columns)) {
    if (String(def.type).split(':')[0] !== 'Attachments') continue;
    const v = row[col];
    if (Array.isArray(v)) v.slice(v[0] === 'L' ? 1 : 0).forEach((id) => ids.push({ id: Number(id), col }));
  }
  return ids;
}

// Noms des workflows dont le JSON mentionne cet identifiant (mot entier).
// Indicatif : un nom de colonne courant ("Name") peut apparaitre ailleurs.
function workflowUsage(dir, ident) {
  if (!dir || !ident) return [];
  const re = new RegExp(`\\b${String(ident).replace(/[^A-Za-z0-9_]/g, '')}\\b`);
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && re.test(fs.readFileSync(path.join(dir, f), 'utf8'))).map((f) => f.replace(/\.json$/, '')).sort();
  } catch (e) {
    return [];
  }
}

// Sauvegarde JSON (2026-11-01) : un corps d'import peut arriver compresse par le navigateur.
const gunzip = promisify(zlib.gunzip);
const SAVE_FORMAT = '2gatcha-save';
const SAVE_REQUIRED = ['Users', 'Cards', 'AppSettings'];
async function readSaveBody(req, limit) {
  const raw = await readRaw(req, limit);
  const gz = String(req.headers['content-type'] || '').startsWith('application/gzip');
  try {
    return JSON.parse((gz ? await gunzip(raw, { maxOutputLength: 500 * 1024 * 1024 }) : raw).toString('utf8'));
  } catch (e) { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}
function saveError(save) {
  if (!save || save.format !== SAVE_FORMAT || !save.tables || typeof save.tables !== 'object') return 'not_a_save';
  for (const name of SAVE_REQUIRED) if (!save.tables[name]) return `table_manquante:${name}`;
  for (const [name, t] of Object.entries(save.tables)) {
    if (!t || !t.columns || typeof t.columns !== 'object' || !Array.isArray(t.rows)) return `table_invalide:${name}`;
    if (t.rows.some((r) => !r || !Number.isInteger(r.id) || r.id < 1)) return `ligne_invalide:${name}`;
  }
  return null;
}
// Copie de securite avant import, a cote de la base (les 3 dernieres).
function safetyCopy(store, dbPath) {
  const dir = path.dirname(path.resolve(dbPath));
  const prefix = `${path.basename(dbPath)}.avant-import-`;
  const name = prefix + new Date().toISOString().replace(/[:.]/g, '-');
  store.snapshotTo(path.join(dir, name));
  fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort().slice(0, -3).forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
  return name;
}
// Telechargement : ecrit au fil de l'eau, les images ne tiennent pas en une seule chaine.
async function streamSave(req, res, { store, withLock, corsHeaders, withImages }) {
  // Lecture des tables sous verrou : une copie coherente, sans bloquer l'envoi.
  const tables = await withLock(() => [...store.tables.values()].map((t) => [t.name, JSON.stringify(t.columns), store.getAllJson(t.name)]));
  const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  res.writeHead(200, { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
  const out = gz ? zlib.createGzip({ level: 6 }) : res;
  if (gz) out.pipe(res);
  const write = async (text) => { if (!out.write(text)) await new Promise((r) => { out.once('drain', r); res.once('close', r); }); };
  await write(`{"format":${JSON.stringify(SAVE_FORMAT)},"version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"tables":{`);
  for (let i = 0; i < tables.length; i++) {
    const [name, columns, rows] = tables[i];
    await write(`${i ? ',' : ''}${JSON.stringify(name)}:{"columns":${columns},"rows":${rows}}`);
  }
  await write('},"images":[');
  const ids = withImages ? store.listAttachments().filter((a) => !a.missing).map((a) => a.id) : [];
  let first = true;
  for (const id of ids) {
    if (res.destroyed) break;
    const a = store.getAttachment(id);
    if (!a) continue;
    await write((first ? '' : ',') + JSON.stringify({ id, fileName: a.file_name, mime: a.mime, data: Buffer.from(a.data).toString('base64') }));
    first = false;
  }
  await write(`],"withImages":${withImages}}`);
  out.end();
}

export function createAdmin({ store, withLock, token, sendJson, corsHeaders = () => ({}), dbPath = '', restart = async () => {}, backups = null, workflowsDir = null }) {
  let importSafety = null; // copie de securite de l'import en cours
  return async function handleAdmin(req, res, url) {
    if (!token) return sendJson(res, req, 503, { error: 'admin_disabled', message: 'ADMIN_TOKEN non configure sur le serveur.' });
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!auth || !safeEqual(auth, token)) return sendJson(res, req, 401, { error: 'unauthorized' });

    const parts = url.pathname.replace(/^\/admin\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const [section, a, b, c] = parts;
    const method = req.method;

    // POST /admin/api/dev-token { userId } : jeton de session d'un joueur, pour
    // la connexion de test (site/dev-login.html). Rien de plus que ce que le
    // jeton admin permet deja (acces complet a la base).
    if (section === 'dev-token' && method === 'POST') {
      const { userId } = await readJson(req);
      const user = store.tables.has('Users') ? store.get('Users', Number(userId)) : null;
      if (!user) return sendJson(res, req, 404, { error: 'unknown_user' });
      return sendJson(res, req, 200, { token: issueToken(store, user), userId: user.id, pseudo: user.Pseudo || '', discordId: user.DiscordId || '', discordAvatar: user.DiscordAvatar || '' });
    }

    // GET /admin/api/tables
    if (section === 'tables' && !a && method === 'GET') {
      const tables = [...store.tables.values()].map((t) => ({ name: t.name, columns: t.columns, rows: t.rows.size })).sort((x, y) => x.name.localeCompare(y.name));
      return sendJson(res, req, 200, { tables });
    }

    if (section === 'tables' && a) {
      const t = store.table(a);
      // GET /admin/api/tables/:t/rows?offset=&limit=&q=
      if (b === 'rows' && !c && method === 'GET') {
        const q = (url.searchParams.get('q') || '').toLowerCase().trim();
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        let rows = store.getAll(a);
        if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
        rows.sort((x, y) => y.id - x.id);
        return sendJson(res, req, 200, { total: rows.length, offset, limit, rows: rows.slice(offset, offset + limit), columns: t.columns });
      }
      // POST /admin/api/tables/:t/rows  { fields }
      if (b === 'rows' && !c && method === 'POST') {
        const { fields } = await readJson(req);
        const row = await withLock(() => store.create(a, fields || {}));
        return sendJson(res, req, 200, { row });
      }
      // PATCH /admin/api/tables/:t/rows/:id  { fields }
      if (b === 'rows' && c && method === 'PATCH') {
        const { fields } = await readJson(req);
        const row = await withLock(() => store.update(a, c, fields || {}));
        return sendJson(res, req, 200, { row });
      }
      // DELETE /admin/api/tables/:t/rows/:id
      if (b === 'rows' && c && method === 'DELETE') {
        const ok = await withLock(() => store.delete(a, c));
        return sendJson(res, req, ok ? 200 : 404, { deleted: ok });
      }
      // POST /admin/api/tables/:t/columns  { id, type }
      if (b === 'columns' && !c && method === 'POST') {
        const { id, type } = await readJson(req);
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id || '')) return sendJson(res, req, 400, { error: 'invalid_column_id' });
        if (t.columns[id]) return sendJson(res, req, 409, { error: `La colonne "${id}" existe deja.` });
        await withLock(() => store.addColumn(a, id, type || 'Any'));
        return sendJson(res, req, 200, { columns: store.table(a).columns });
      }
      // PATCH /admin/api/tables/:t/columns/:col  { id?, type?, formula?: false }
      if (b === 'columns' && c && method === 'PATCH') {
        const changes = await readJson(req);
        await withLock(() => store.updateColumn(a, c, changes));
        return sendJson(res, req, 200, { columns: store.table(a).columns });
      }
      // DELETE /admin/api/tables/:t/columns/:col
      if (b === 'columns' && c && method === 'DELETE') {
        await withLock(() => store.dropColumn(a, c));
        return sendJson(res, req, 200, { columns: store.table(a).columns });
      }
      // GET /admin/api/tables/:t/usage?column=  : workflows qui mentionnent
      // cette table / colonne (avertissement avant renommage ou suppression).
      if (b === 'usage' && method === 'GET') {
        return sendJson(res, req, 200, { workflows: workflowUsage(workflowsDir, url.searchParams.get('column') || a) });
      }
      // PATCH /admin/api/tables/:t  { name }  : renommer la table
      if (!b && method === 'PATCH') {
        const { name } = await readJson(req);
        await withLock(() => store.renameTable(a, name));
        return sendJson(res, req, 200, { name });
      }
      // DELETE /admin/api/tables/:t?confirm=<nom de la table>
      if (!b && method === 'DELETE') {
        if (url.searchParams.get('confirm') !== a) return sendJson(res, req, 400, { error: 'confirm_required' });
        await withLock(() => store.dropTable(a));
        return sendJson(res, req, 200, { deleted: a });
      }
    }

    // POST /admin/api/tables  { name, columns?: { colId: { type } } }
    if (section === 'tables' && !a && method === 'POST') {
      const { name, columns } = await readJson(req);
      await withLock(() => store.createTable(name, columns || {}));
      return sendJson(res, req, 200, { name, columns: store.table(name).columns });
    }

    // GET /admin/api/images : toutes les pieces jointes + qui les utilise.
    if (section === 'images' && !a && method === 'GET') {
      const usage = new Map();
      for (const t of store.tables.values()) {
        const hasAtt = Object.values(t.columns).some((d) => String(d.type).startsWith('Attachments'));
        if (!hasAtt) continue;
        for (const row of store.getAll(t.name)) {
          for (const { id, col } of attachmentIds(row, t.columns)) {
            if (!usage.has(id)) usage.set(id, []);
            usage.get(id).push({ table: t.name, rowId: row.id, column: col, label: row.Name || row.Key || row.Pseudo || `#${row.id}`, extension: row.Extension || (t.name === 'Extensions' ? row.id : null) });
          }
        }
      }
      const images = store.listAttachments().map((img) => ({ ...img, usedBy: usage.get(img.id) || [] }));
      // Images referencees mais totalement inconnues de la base.
      for (const [id, used] of usage) if (!images.some((i) => i.id === id)) images.push({ id, fileName: null, mime: null, size: null, missing: true, usedBy: used });
      images.sort((x, y) => x.id - y.id);
      return sendJson(res, req, 200, { images, extensions: store.getAll('Extensions').map((e) => ({ id: e.id, name: e.Name, key: e.Key })) });
    }

    // PUT /admin/api/images/:id  (corps = image binaire, deja convertie en
    // WebP par la page admin) : remplace le contenu de cette piece jointe ;
    // toutes les lignes qui la referencent affichent la nouvelle image.
    // POST /admin/api/images?table=&rowId=&column=  : cree une NOUVELLE
    // piece jointe et l'associe a la ligne (changer l'image d'une carte sans
    // toucher a l'ancienne, gardee en cache par les navigateurs).
    if (section === 'images' && (method === 'PUT' || method === 'POST')) {
      const mime = String(req.headers['content-type'] || '').split(';')[0];
      if (!/^image\/(webp|png|jpeg|gif|svg\+xml)$/.test(mime)) return sendJson(res, req, 415, { error: 'unsupported_type' });
      const data = await readRaw(req, MAX_IMAGE_BYTES);
      if (!data.length) return sendJson(res, req, 400, { error: 'empty_file' });
      let fileName = 'image.webp';
      try { fileName = decodeURIComponent(String(req.headers['x-file-name'] || fileName)).slice(0, 120); } catch (e) { /* nom illisible : defaut */ }
      const result = await withLock(() => {
        if (method === 'PUT') {
          if (!a) throw Object.assign(new Error('missing_id'), { status: 400 });
          const oldId = Number(a);
          // Image manquante : on la remplit sur place (aucun navigateur ne l'a
          // en cache). Image existante : les navigateurs gardent l'ancienne en
          // cache un an (immutable) -> nouvelle piece jointe, et toutes les
          // lignes qui pointaient vers l'ancienne sont redirigees.
          if (!store.getAttachment(oldId)) {
            store.putAttachment(oldId, fileName, mime, data);
            return { id: oldId, replaced: false };
          }
          const id = store.nextAttachmentId();
          store.putAttachment(id, fileName, mime, data);
          let rowsUpdated = 0;
          for (const t of store.tables.values()) {
            const attCols = Object.entries(t.columns).filter(([, d]) => String(d.type).startsWith('Attachments')).map(([col]) => col);
            if (!attCols.length) continue;
            for (const row of store.getAll(t.name)) {
              const fields = {};
              for (const col of attCols) {
                const v = row[col];
                if (Array.isArray(v) && v.slice(1).map(Number).includes(oldId)) fields[col] = v.map((x, i) => (i > 0 && Number(x) === oldId ? id : x));
              }
              if (Object.keys(fields).length) { store.update(t.name, row.id, fields); rowsUpdated++; }
            }
          }
          return { id, replaced: true, previousId: oldId, rowsUpdated };
        }
        const table = url.searchParams.get('table'), rowId = url.searchParams.get('rowId'), column = url.searchParams.get('column');
        const id = store.nextAttachmentId();
        store.putAttachment(id, fileName, mime, data);
        if (table && rowId && column) store.update(table, rowId, { [column]: ['L', id] });
        return { id };
      });
      return sendJson(res, req, 200, { ...result, size: data.length, mime });
    }

    // GET /admin/api/export?images=0|1 : sauvegarde JSON complete, a telecharger.
    if (section === 'export' && method === 'GET') {
      return streamSave(req, res, { store, withLock, corsHeaders, withImages: url.searchParams.get('images') !== '0' });
    }
    // Import d'une sauvegarde JSON, en 3 temps :
    //   POST /admin/api/import/begin                        copie de securite de la base
    //   POST /admin/api/import/images { images: [...] }     par paquets (limite d'envoi du proxy)
    //   POST /admin/api/import/commit { ...sauvegarde, confirm: 'IMPORTER' }  puis redemarrage
    if (section === 'import' && method === 'POST') {
      if (a === 'begin') {
        importSafety = await withLock(() => safetyCopy(store, dbPath));
        return sendJson(res, req, 200, { safety: importSafety });
      }
      if (!importSafety) return sendJson(res, req, 409, { error: 'begin_required' });
      if (a === 'images') {
        const { images } = await readSaveBody(req, 64 * 1024 * 1024);
        if (!Array.isArray(images) || images.some((i) => !i || !Number.isInteger(i.id) || i.id < 1 || typeof i.data !== 'string' || !/^image\//.test(String(i.mime)))) return sendJson(res, req, 400, { error: 'invalid_images' });
        await withLock(() => images.forEach((i) => store.putAttachment(i.id, String(i.fileName || 'image').slice(0, 120), i.mime, Buffer.from(i.data, 'base64'))));
        return sendJson(res, req, 200, { imported: images.length });
      }
      if (a === 'commit') {
        const save = await readSaveBody(req, 200 * 1024 * 1024);
        if (save.confirm !== 'IMPORTER') return sendJson(res, req, 400, { error: 'confirm_required' });
        const error = saveError(save);
        if (error) return sendJson(res, req, 400, { error });
        return withLock(async () => {
          store.replaceAll(save.tables);
          sendJson(res, req, 200, { imported: true, safety: importSafety, tables: Object.keys(save.tables).length, restarting: true });
          importSafety = null;
          await restart();
        });
      }
    }

    // GET /admin/api/backups : liste + etat ; POST : sauvegarder maintenant.
    if (section === 'backups') {
      if (!backups) return sendJson(res, req, 503, { error: 'backups_disabled', message: 'AZURE_BACKUP_SAS_URL non configure sur le serveur.' });
      if (method === 'POST') {
        const status = await backups.run(true);
        if (status.lastError && (!status.lastBackup || status.lastError.at > status.lastBackup.at)) return sendJson(res, req, 502, { error: 'backup_failed', message: status.lastError.message });
        return sendJson(res, req, 200, { status });
      }
      if (method === 'GET') {
        const list = await backups.backup.list();
        return sendJson(res, req, 200, { status: backups.status, backups: list.slice(0, 100) });
      }
    }

    return sendJson(res, req, 404, { error: 'not_found' });
  };
}
