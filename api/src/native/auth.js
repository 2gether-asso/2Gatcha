// Authentification et limite de debit.
//
// Jeton signe : a la connexion Discord (workflow discord-login), l'API ajoute
// a la reponse un jeton `token` = base64url(payload).signature, signature
// HMAC-SHA256 avec une cle secrete (AUTH_SECRET, sinon generee au premier
// demarrage et gardee en base). Payload : { u: id du joueur, d: id Discord,
// exp: expiration }. Le site l'envoie dans "Authorization: Bearer <jeton>".
//
// Regle unique, valable pour toutes les routes (workflows, natives, batch) :
// une requete qui parle au nom d'un joueur (userId / fromUserId) ou d'un
// admin (discordId) doit porter un jeton valide de CE joueur / CET admin.
// Les routes sans identite (catalogue, classement, profil public...) restent
// ouvertes. AUTH_MODE=off desactive la verification (developpement local).
//
// Limite de debit : fenetre d'une minute par joueur (ou par adresse IP sans
// jeton), lectures et actions comptees a part (reglages admin).

import crypto from 'node:crypto';
import { now } from './common.js';
import { setting } from './settings.js';

const MODE = (process.env.AUTH_MODE || 'enforce').toLowerCase();
let secret = null;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function init({ store }) {
  secret = process.env.AUTH_SECRET || null;
  if (secret) return;
  const row = store.getAll('AppSettings').find((r) => r.Key === 'authSecret');
  if (row) { secret = row.Value; return; }
  secret = crypto.randomBytes(32).toString('hex');
  store.create('AppSettings', { Key: 'authSecret', Value: secret });
}

function sign(data) {
  return b64url(crypto.createHmac('sha256', secret).update(data).digest());
}

export function issueToken(store, user) {
  const days = setting(store, 'AuthTokenDays');
  const payload = b64url(JSON.stringify({ u: user.id, d: String(user.DiscordId || ''), exp: now() + days * 86400 }));
  return payload + '.' + sign(payload);
}

export function verifyToken(token) {
  if (!token || !secret) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(fromB64url(payload).toString('utf8'));
    if (!data.exp || data.exp < now()) return null;
    return data;
  } catch (e) { return null; }
}

// Identites revendiquees par une requete.
function claims(body = {}, query = {}) {
  const users = [body.userId, query.userId, body.fromUserId].filter((v) => v != null && v !== '').map(Number);
  const admins = [body.discordId, query.discordId].filter((v) => v != null && v !== '').map(String);
  return { users, admins };
}

// null si la requete est autorisee, sinon { status, json }.
export function authorize({ token, body, query }) {
  if (MODE === 'off') return null;
  const { users, admins } = claims(body, query);
  if (!users.length && !admins.length) return null;
  const t = verifyToken(token);
  if (!t) return { status: 401, json: { error: token ? 'auth_invalid' : 'auth_required' } };
  if (users.some((u) => u !== Number(t.u))) return { status: 403, json: { error: 'auth_forbidden' } };
  if (admins.some((d) => d !== String(t.d))) return { status: 403, json: { error: 'auth_forbidden' } };
  return null;
}

// --- limite de debit ---------------------------------------------------
const windows = new Map(); // cle -> { minute, reads, writes }
let lastSweep = 0;

export function rateLimit(store, key, isWrite) {
  const minute = Math.floor(Date.now() / 60000);
  if (minute !== lastSweep) {
    lastSweep = minute;
    for (const [k, w] of windows) if (w.minute < minute - 1) windows.delete(k);
  }
  let w = windows.get(key);
  if (!w || w.minute !== minute) { w = { minute, reads: 0, writes: 0 }; windows.set(key, w); }
  const limit = isWrite ? setting(store, 'RateLimitWritesPerMinute') : setting(store, 'RateLimitReadsPerMinute');
  const count = isWrite ? ++w.writes : ++w.reads;
  if (count <= limit) return null;
  const retryAfter = 60 - Math.floor((Date.now() / 1000) % 60);
  return { status: 429, json: { error: 'rate_limited', retryAfter }, headers: { 'Retry-After': String(retryAfter) } };
}

export function _resetRateLimits() { windows.clear(); }

// Jeton remis a la connexion Discord.
export function afterWorkflow({ store, path, response }) {
  if (path !== 'discord-login' || response.status !== 200 || !response.json || !response.json.userId) return;
  const user = store.get('Users', Number(response.json.userId));
  if (user) response.json.token = issueToken(store, user);
}
