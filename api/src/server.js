// API 2Gatcha.
//
// Chaque action du jeu est une route /webhook/<chemin> : un workflow
// (api/workflows/*.json, execute par runtime.js) ou une fonctionnalite native
// (src/native). Le site ne connait que l'URL de base (js/config.js,
// apiBaseUrl). Les executions sont serialisees : une seule action a la fois
// modifie les donnees, ce qui empeche les doubles depenses (deux clics
// rapides lisant le meme solde).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { Store } from './store.js';
import { WorkflowRunner } from './runtime.js';
import { createAdmin } from './admin.js';
import { AzureBackup, startBackupSchedule } from './backup.js';
import { initMonitoring, captureError, flushMonitoring } from './monitoring.js';
import { createNative } from './native/index.js';

// Suivi des erreurs (GlitchTip) le plus tot possible.
await initMonitoring(config.monitoring);
process.on('uncaughtException', async (err) => {
  console.error(err);
  captureError(err, { kind: 'uncaughtException' });
  await flushMonitoring();
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error(err);
  captureError(err instanceof Error ? err : new Error(String(err)), { kind: 'unhandledRejection' });
});

const store = new Store(config.dbPath);
const runner = new WorkflowRunner({ store, overrides: config.overrides, onError: captureError });

// --------------------------------------------------------------- workflows
function loadWorkflows(dir) {
  const routes = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const wf = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const hook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
    if (!hook) continue;
    const method = (hook.parameters.httpMethod || 'GET').toUpperCase();
    routes.set(`${method} ${hook.parameters.path}`, { wf, file: f });
  }
  return routes;
}
const routes = loadWorkflows(config.workflowsDir);

// --------------------------------------------------------------- verrou
// File d'attente globale : une execution a la fois. Les appels HTTP externes
// (Discord) relachent le verrou le temps de la requete.
class Mutex {
  constructor() { this.locked = false; this.waiters = []; }
  acquire() {
    if (!this.locked) { this.locked = true; return Promise.resolve(); }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.locked = false;
  }
}
const mutex = new Mutex();
async function withLock(fn) {
  await mutex.acquire();
  try { return await fn(); } finally { mutex.release(); }
}
// Appel externe (Discord) : relache le verrou pendant l'attente reseau, avec
// un delai maximal pour qu'un Discord lent ne bloque jamais l'API.
const unlocked = async (fn) => {
  mutex.release();
  try { return await fn(); } finally { await mutex.acquire(); }
};

// --------------------------------------------------------------- HTTP
function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowAll = config.allowedOrigins.includes('*');
  const allowed = allowAll ? '*' : (origin && config.allowedOrigins.includes(origin) ? origin : config.allowedOrigins[0]);
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Name',
    'Access-Control-Max-Age': '86400',
    ...(allowAll ? {} : { Vary: 'Origin' })
  };
}

function send(res, req, status, headers, body) {
  res.writeHead(status, { ...corsHeaders(req), ...headers });
  res.end(body);
}

function sendJson(res, req, status, obj, headers = {}) {
  send(res, req, status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }, JSON.stringify(obj ?? null));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 15 * 1024 * 1024) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

// Fichiers jamais servis, meme presents dans le dossier du site monte :
// outils de test qui contournent la connexion Discord (dev-login), et
// fichiers caches (.git, .env...).
const BLOCKED_SITE_FILES = new Set(['dev-login.html', 'js/dev-login.js']);

function send404(req, res, root) {
  const notFound = path.join(root, '404.html');
  if (!fs.existsSync(notFound)) return false;
  send(res, req, 404, { 'Content-Type': MIME['.html'] }, fs.readFileSync(notFound));
  return true;
}

function serveStatic(req, res, pathname) {
  if (!config.siteDir) return false;
  const root = path.resolve(config.siteDir);
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return false; }
  let file = path.resolve(root, '.' + rel);
  if (file !== root && !file.startsWith(root + path.sep)) return false;
  const relPath = path.relative(root, file).split(path.sep).join('/');
  if (BLOCKED_SITE_FILES.has(relPath) || relPath.split('/').some((seg) => seg.startsWith('.'))) return send404(req, res, root);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  // Le site servi par l'API parle a l'API elle-meme : apiBaseUrl est reecrit
  // a la volee en "/webhook/" (le fichier du depot garde l'adresse publique,
  // utilisee par le site heberge sur GitHub Pages).
  if (path.relative(root, file).split(path.sep).join('/') === 'js/config.js' && fs.existsSync(file)) {
    const js = fs.readFileSync(file, 'utf8').replace(/apiBaseUrl:\s*"[^"]*"/, `apiBaseUrl: "${config.siteApiBase}"`);
    send(res, req, 200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' }, js);
    return true;
  }
  if (!fs.existsSync(file)) return send404(req, res, root);
  const ext = path.extname(file).toLowerCase();
  send(res, req, 200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' }, fs.readFileSync(file));
  return true;
}

// Images des cartes : servies directement depuis la base (remplace le
// ancien workflow get-image).
function serveImage(req, res, url) {
  const att = store.getAttachment(url.searchParams.get('id'));
  if (!att) return sendJson(res, req, 404, { error: 'not_found' });
  send(res, req, 200, { 'Content-Type': att.mime || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' }, Buffer.from(att.data));
}

// Sauvegardes automatiques (si AZURE_BACKUP_SAS_URL est configure).
let backups = null;
if (config.backup.sasUrl) {
  const backup = new AzureBackup({ sasUrl: config.backup.sasUrl, prefix: config.backup.prefix });
  backups = { backup, ...startBackupSchedule({ store, backup, hours: config.backup.hours, retentionDays: config.backup.retentionDays }) };
}

// Fonctionnalites natives (api/src/native) : routes ecrites directement en
// JS, bonus appliques apres certains workflows, notifications push.
const native = createNative({ store, withLock, captureError, workflowsDir: config.workflowsDir });
native.start();

// Execute un workflow sous le verrou et renvoie sa reponse HTTP. hookPath :
// chemin du webhook, pour les bonus natifs appliques apres coup.
async function runWorkflow(route, request, hookPath) {
  return withLock(async () => {
    native.beforeRequest(request.body, request.query, hookPath);
    // Regles natives verifiees AVANT le workflow (taxe d'echange, prix de l'os...).
    const blocked = hookPath ? native.beforeWorkflow(hookPath, request) : null;
    if (blocked) { native.endRequest(); return blocked; }
    const { responded, done } = runner.run(route.wf, request, { unlocked });
    const resp = await responded;
    // L'execution continue apres la reponse (ex. quetes du jour mises a
    // jour apres l'ouverture d'un booster) : on la laisse finir avant de
    // passer a la requete suivante.
    done.then(() => {}, () => {});
    await done;
    if (hookPath) native.afterWorkflow(hookPath, request, resp);
    native.endRequest();
    return resp;
  });
}

const READ_ACTIONS = new Set(['status', 'list', 'get']);

// Route native : meme verrou que les workflows.
async function runNative(method, hookPath, body, query) {
  return withLock(() => {
    native.beforeRequest(body, query, hookPath);
    try { return native.run(method, hookPath, { body, query }); } finally { native.endRequest(); }
  });
}

// Jeton "Authorization: Bearer ..." et adresse du client (derriere un reverse
// proxy : premiere adresse de X-Forwarded-For).
function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || null;
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
const isWriteRequest = (method, body) => method !== 'GET' && !READ_ACTIONS.has(body && body.action);
function sendGate(res, req, denied) {
  sendJson(res, req, denied.status, denied.json, denied.headers || {});
}

// --------------------------------------------------------------- batch
// POST /webhook/batch { calls: [{ path, method, query, body }] } : plusieurs
// LECTURES en une seule requete HTTP (pastilles du menu, en-tete...). Chaque
// appel donne exactement la meme reponse qu'en individuel. Ecritures
// refusees : GET, ou POST dont l'action est une lecture.
const BATCH_MAX = 24;
async function handleBatch(req, res, url) {
  const { calls } = await readBody(req);
  if (!Array.isArray(calls) || !calls.length || calls.length > BATCH_MAX) return sendJson(res, req, 400, { error: 'invalid_batch' });
  const token = bearer(req);
  // Le lot compte pour une seule lecture dans la limite de debit.
  const limited = native.gate({ token, ip: clientIp(req), isWrite: false });
  if (limited) return sendGate(res, req, limited);
  const results = [];
  for (const c of calls) {
    const method = String(c && c.method || 'GET').toUpperCase();
    const hookPath = String(c && c.path || '').replace(/^\/+|\/+$/g, '');
    const route = routes.get(`${method} ${hookPath}`);
    const isNative = native.has(method, hookPath);
    const body = c && c.body && typeof c.body === 'object' ? c.body : {};
    if (!route && !isNative) { results.push({ status: 404, json: { error: 'not_found' } }); continue; }
    if (method !== 'GET' && !READ_ACTIONS.has(body.action)) { results.push({ status: 400, json: { error: 'read_only' } }); continue; }
    const query = c.query && typeof c.query === 'object' ? Object.fromEntries(Object.entries(c.query).map(([k, v]) => [k, String(v)])) : {};
    const denied = native.gate({ token, body, query, rate: false });
    if (denied) { results.push({ status: denied.status, json: denied.json }); continue; }
    if (isNative) { results.push(await runNative(method, hookPath, body, query)); continue; }
    const resp = await runWorkflow(route, { headers: req.headers, params: {}, query, body, webhookUrl: `${url.origin}/webhook/${hookPath}`, executionMode: 'production' }, hookPath);
    results.push({ status: resp.status, json: resp.raw ? null : resp.json });
  }
  return sendJson(res, req, 200, { results });
}

const handleAdmin = createAdmin({ store, withLock, token: config.adminToken, sendJson, backups, workflowsDir: config.workflowsDir });

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'OPTIONS') return send(res, req, 204, {}, '');
    if (url.pathname.startsWith('/admin/api/')) return await handleAdmin(req, res, url);
    if (url.pathname === '/health') return sendJson(res, req, 200, { ok: true, workflows: routes.size, tables: store.stats(), backups: backups ? { enabled: true, lastBackupAt: backups.status.lastBackup?.at || null, lastError: backups.status.lastError } : { enabled: false } });

    if (url.pathname === '/webhook/batch' && req.method === 'POST') {
      await handleBatch(req, res, url);
      if (process.env.LOG_REQUESTS !== '0') console.log(`POST /webhook/batch ${Date.now() - started}ms`);
      return;
    }

    const m = url.pathname.match(/^\/webhook\/(.+?)\/?$/);
    if (m) {
      const hookPath = m[1];
      if (req.method === 'GET' && hookPath === 'image') return serveImage(req, res, url);
      const isNativeRoute = native.has(req.method, hookPath);
      const route = isNativeRoute ? null : routes.get(`${req.method} ${hookPath}`);
      if (!isNativeRoute && !route) return sendJson(res, req, 404, { code: 404, message: `The requested webhook "${req.method} ${hookPath}" is not registered.` });
      const body = req.method === 'POST' ? await readBody(req) : {};
      const query = Object.fromEntries(url.searchParams);
      const denied = native.gate({ token: bearer(req), ip: clientIp(req), body, query, isWrite: isWriteRequest(req.method, body) });
      if (denied) {
        sendGate(res, req, denied);
        if (process.env.LOG_REQUESTS !== '0') console.log(`${req.method} /webhook/${hookPath} ${denied.status} (${denied.json.error})`);
        return;
      }
      if (isNativeRoute) {
        const resp = await runNative(req.method, hookPath, body, query);
        sendJson(res, req, resp.status, resp.json);
        if (process.env.LOG_REQUESTS !== '0') console.log(`${req.method} /webhook/${hookPath} ${resp.status} ${Date.now() - started}ms (natif)`);
        return;
      }
      const request = {
        headers: req.headers,
        params: {},
        query,
        body,
        webhookUrl: `${url.origin}${url.pathname}`,
        executionMode: 'production'
      };
      const response = await runWorkflow(route, request, hookPath);
      if (response.raw) send(res, req, response.status, response.headers || {}, response.raw);
      else sendJson(res, req, response.status, response.json, response.headers || {});
      if (process.env.LOG_REQUESTS !== '0') console.log(`${req.method} /webhook/${hookPath} ${response.status} ${Date.now() - started}ms`);
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, url.pathname)) return;
    sendJson(res, req, 404, { error: 'not_found' });
  } catch (err) {
    console.error(err);
    const status = err.status || err.httpCode || 500;
    // Les 4xx sont des erreurs de saisie (colonne inconnue...), pas des pannes.
    if (status >= 500) captureError(err, { method: req.method, path: req.url && req.url.split('?')[0] });
    if (!res.headersSent) sendJson(res, req, status, { error: err.message });
  }
});

server.listen(config.port, () => {
  const tables = store.stats();
  console.log(`2Gatcha API sur le port ${config.port} - ${routes.size} workflows, ${Object.keys(tables).length} tables (${config.dbPath})`);
  if (!Object.keys(tables).length) console.warn('Base vide : restaure une sauvegarde (npm run restore, voir README).');
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });

export { server, store, routes };
