// Journal detaille de l'economie (2026-10-11) : chaque variation de boosters
// d'un joueur (et chaque variation d'au moins LEDGER_DUST_MIN poussieres) est
// notee une par une : quand, quel joueur, quelle route et quelle action, qui
// l'a declenchee (le joueur lui-meme, un admin, la page d'admin de la base,
// le demarrage du serveur), et un detail (code utilise, cible d'un don...).
// Origine inconnue : l'endroit du code qui a ecrit est note, pour la retrouver.
// Gardé 45 jours.
//   POST /webhook/admin-economy-log { discordId, source?, userId?, limit? }

import { refId, now, ok, fail, isAdmin } from './common.js';

export const schema = {
  EconomyLog: {
    At: { type: 'Numeric' }, User: { type: 'Ref:Users' }, Source: { type: 'Text' }, Action: { type: 'Text' },
    Actor: { type: 'Text' }, Boosters: { type: 'Numeric' }, Dust: { type: 'Numeric' }, Detail: { type: 'Text' }
  }
};

const DUST_MIN = 200;
const KEEP_DAYS = 45;
const SECRET_KEYS = new Set(['token', 'password', 'subscription', 'secret', 'clientSecret']);

// Resume du corps de la requete, sans secrets ni identifiants deja notes.
export function summarizeBody(body = {}) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (SECRET_KEYS.has(k) || k === 'userId' || k === 'discordId' || k === 'action' || v == null || v === '') continue;
    out[k] = typeof v === 'object' ? (Array.isArray(v) ? `[${v.length}]` : '{…}') : v;
  }
  const s = JSON.stringify(out);
  return s === '{}' ? '' : s.slice(0, 160);
}

// Endroit du code qui a ecrit (origine inconnue).
function callSite() {
  const lines = String(new Error().stack || '').split('\n').slice(2).map((l) => l.trim());
  const useful = lines.filter((l) => !/ledger\.js|native[\\/]index\.js|node:internal|store\.js/.test(l)).slice(0, 3);
  return useful.map((l) => l.replace(/^at\s+/, '').replace(/\(?file:\/\/\/?[^)]*[\\/](src[\\/][^)]*)\)?/, '$1')).join(' < ').slice(0, 240);
}

let lastPurge = 0;
export function log(store, ctx, before, after) {
  if (!store.tables.has('EconomyLog') || !before || !after) return;
  const boosters = (Number(after.BoosterCount) || 0) - (Number(before.BoosterCount) || 0);
  const dust = (Number(after.StardustCount) || 0) - (Number(before.StardustCount) || 0);
  if (!boosters && Math.abs(dust) < DUST_MIN) return;
  const known = !!ctx.source;
  store.create('EconomyLog', {
    At: now(), User: after.id, Source: ctx.source || 'inconnu', Action: ctx.action || '',
    Actor: ctx.actor || (known ? '' : 'aucune requête'), Boosters: boosters, Dust: dust,
    Detail: known ? (ctx.detail || '') : callSite()
  });
  const t = now();
  if (t - lastPurge > 3600) {
    lastPurge = t;
    const limit = t - KEEP_DAYS * 86400;
    store.getAll('EconomyLog').filter((r) => (Number(r.At) || 0) < limit).forEach((r) => store.delete('EconomyLog', r.id));
  }
}

// Une seule fois : supprime les lignes "autre" du journal quotidien, faussees
// par le bug de contexte partage (voir context.js).
const CLEANUP = 'cleanup-autre-2026-10-11';
export function init({ store }) {
  if (!store.tables.has('AppSettings') || !store.tables.has('EconomyDaily') || store.getAll('AppSettings').some((r) => r.Key === CLEANUP)) return;
  const rows = store.getAll('EconomyDaily').filter((r) => r.Source === 'autre');
  const removed = rows.reduce((s, r) => ({ boosters: s.boosters + (Number(r.BoostersIn) || 0), dust: s.dust + (Number(r.DustIn) || 0) }), { boosters: 0, dust: 0 });
  rows.forEach((r) => store.delete('EconomyDaily', r.id));
  store.create('AppSettings', { Key: CLEANUP, Value: JSON.stringify({ at: now(), rows: rows.length, ...removed }) });
  if (rows.length) console.log(`Journal de l'economie : ${rows.length} ligne(s) "autre" supprimee(s) (${removed.boosters} boosters, ${removed.dust} poussieres)`);
}

function handleLog({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const limit = Math.min(1000, Math.max(10, Number(body.limit) || 300));
  const users = new Map(store.getAll('Users').map((u) => [u.id, u]));
  const byDiscord = new Map(store.getAll('Users').filter((u) => u.DiscordId).map((u) => [String(u.DiscordId), u]));
  const actorLabel = (a) => {
    if (!a) return '';
    const m = /^admin:(.+)$/.exec(a);
    if (m) { const u = byDiscord.get(m[1]); return `Admin ${u ? u.Pseudo : m[1]}`; }
    const p = /^joueur:(\d+)$/.exec(a);
    if (p) { const u = users.get(Number(p[1])); return u ? u.Pseudo : `joueur #${p[1]}`; }
    return a;
  };
  let rows = store.tables.has('EconomyLog') ? store.getAll('EconomyLog') : [];
  const sources = [...new Set(rows.map((r) => r.Source))].sort();
  if (body.source) rows = rows.filter((r) => r.Source === body.source);
  if (Number(body.userId)) rows = rows.filter((r) => refId(r.User) === Number(body.userId));
  if (body.boostersOnly) rows = rows.filter((r) => Number(r.Boosters));
  // Totaux par source (7 derniers jours) pour les boosters crees.
  const since = now() - 7 * 86400;
  const totals = {};
  for (const r of store.tables.has('EconomyLog') ? store.getAll('EconomyLog') : []) {
    if ((Number(r.At) || 0) < since || !(Number(r.Boosters) > 0)) continue;
    const k = r.Source + (r.Action ? ` · ${r.Action}` : '');
    totals[k] = (totals[k] || 0) + Number(r.Boosters);
  }
  return ok({
    sources,
    totals: Object.entries(totals).map(([source, boosters]) => ({ source, boosters })).sort((a, b) => b.boosters - a.boosters),
    rows: rows.sort((a, b) => b.id - a.id).slice(0, limit).map((r) => {
      const u = users.get(refId(r.User));
      return { id: r.id, at: r.At, pseudo: u ? u.Pseudo : '?', userId: refId(r.User), source: r.Source, action: r.Action || '', actor: actorLabel(r.Actor), boosters: Number(r.Boosters) || 0, dust: Number(r.Dust) || 0, detail: r.Detail || '' };
    })
  });
}

export const routes = { 'POST admin-economy-log': handleLog };
