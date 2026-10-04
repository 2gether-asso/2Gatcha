// API 2Gatcha : remplace n8n + Grist.
//
// Memes adresses que les webhooks n8n (/webhook/<chemin>) et memes formats de
// requete/reponse : cote site, seule l'URL de base change (js/config.js,
// n8nBaseUrl). Les executions sont serialisees : une seule action a la fois
// modifie les donnees, ce qui supprime les doubles depenses que n8n
// permettait (deux clics rapides lisaient le meme solde).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { Store } from './store.js';
import { WorkflowRunner } from './runtime.js';
import { createAdmin } from './admin.js';
import { AzureBackup, startBackupSchedule } from './backup.js';

const store = new Store(config.dbPath);
const runner = new WorkflowRunner({ store, overrides: config.overrides });

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
  // Le site servi par l'API parle a l'API elle-meme : n8nBaseUrl est reecrit
  // a la volee en "/webhook/" (le fichier du depot garde l'adresse n8n tant
  // que l'ancien hebergement est utilise).
  if (path.relative(root, file).split(path.sep).join('/') === 'js/config.js' && fs.existsSync(file)) {
    const js = fs.readFileSync(file, 'utf8').replace(/n8nBaseUrl:\s*"[^"]*"/, `n8nBaseUrl: "${config.siteApiBase}"`);
    send(res, req, 200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' }, js);
    return true;
  }
  if (!fs.existsSync(file)) return send404(req, res, root);
  const ext = path.extname(file).toLowerCase();
  send(res, req, 200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' }, fs.readFileSync(file));
  return true;
}

// Images des cartes : servies directement depuis la base (remplace le
// workflow get-image qui telechargeait la piece jointe depuis Grist).
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

const handleAdmin = createAdmin({ store, withLock, token: config.adminToken, sendJson, backups });

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'OPTIONS') return send(res, req, 204, {}, '');
    if (url.pathname.startsWith('/admin/api/')) return await handleAdmin(req, res, url);
    if (url.pathname === '/health') return sendJson(res, req, 200, { ok: true, workflows: routes.size, tables: store.stats(), backups: backups ? { enabled: true, lastBackupAt: backups.status.lastBackup?.at || null, lastError: backups.status.lastError } : { enabled: false } });

    const m = url.pathname.match(/^\/webhook\/(.+?)\/?$/);
    if (m) {
      const hookPath = m[1];
      if (req.method === 'GET' && hookPath === 'image') return serveImage(req, res, url);
      const route = routes.get(`${req.method} ${hookPath}`);
      if (!route) return sendJson(res, req, 404, { code: 404, message: `The requested webhook "${req.method} ${hookPath}" is not registered.` });
      const body = req.method === 'POST' ? await readBody(req) : {};
      const request = {
        headers: req.headers,
        params: {},
        query: Object.fromEntries(url.searchParams),
        body,
        webhookUrl: `${url.origin}${url.pathname}`,
        executionMode: 'production'
      };
      const response = await withLock(async () => {
        const { responded, done } = runner.run(route.wf, request, { unlocked });
        const resp = await responded;
        // L'execution continue apres la reponse (ex. quetes du jour mises a
        // jour apres l'ouverture d'un booster) : on la laisse finir avant de
        // passer a la requete suivante.
        done.then(() => {}, () => {});
        await done;
        return resp;
      });
      if (response.raw) send(res, req, response.status, response.headers || {}, response.raw);
      else sendJson(res, req, response.status, response.json, response.headers || {});
      if (process.env.LOG_REQUESTS !== '0') console.log(`${req.method} /webhook/${hookPath} ${response.status} ${Date.now() - started}ms`);
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, url.pathname)) return;
    sendJson(res, req, 404, { error: 'not_found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, req, err.status || 500, { error: err.message });
  }
});

server.listen(config.port, () => {
  const tables = store.stats();
  console.log(`2Gatcha API sur le port ${config.port} - ${routes.size} workflows, ${Object.keys(tables).length} tables (${config.dbPath})`);
  if (!Object.keys(tables).length) console.warn('Base vide : lance d\'abord `npm run import` (voir README).');
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });

export { server, store, routes };
