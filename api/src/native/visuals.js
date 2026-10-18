// Visuels modifiables (2026-10-18) : chaque image du dossier site/assets est
// un "emplacement" (cle = chemin d'origine, ex. "Fouille/Rubis.PNG") que
// l'admin peut renommer (nom affiche) et remplacer par une image televersee
// (piece jointe en base, servie par /webhook/image?id=). Stocke dans
// AppSettings 'visuals' = { cle: { label?, imageId? } }.
//   GET  /webhook/visuals                        -> { overrides } (public, pour le site)
//   POST /webhook/admin-visuals { discordId, action: 'list' | 'set' | 'reset' | 'upload', key?, label?, data?, mime?, fileName? }
// visualLabel(store, cle, defaut) : nom affiche (mineraux, coffres, especes...).

import { ok, fail, isAdmin } from './common.js';

const KEY = 'visuals';
const VALID = /^[\p{L}0-9 _.\-/]{1,120}$/u;
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function row(store) { return store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === KEY) : null; }
export function overrides(store) {
  const r = row(store);
  if (!r) return {};
  try { const v = JSON.parse(r.Value); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}
function save(store, v) {
  const r = row(store);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(v) });
  else store.create('AppSettings', { Key: KEY, Value: JSON.stringify(v) });
}
// Cache par requete : les vues des modules appellent ceci souvent.
let cache = { at: 0, v: {} };
export function visualLabel(store, key, def) {
  if (Date.now() - cache.at > 2000) cache = { at: Date.now(), v: overrides(store) };
  const o = cache.v[key];
  return o && o.label ? o.label : def;
}

function handlePublic({ store }) { return ok({ overrides: overrides(store) }); }

function handleAdmin({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const v = overrides(store);
  const action = body.action || 'list';
  if (action === 'list') return ok({ overrides: v });
  const key = String(body.key || '');
  if (!VALID.test(key) || key.includes('..')) return fail('invalid_key');
  if (action === 'set') {
    const label = String(body.label ?? '').trim().slice(0, 60);
    v[key] = { ...(v[key] || {}), label: label || undefined };
    if (!v[key].label && !v[key].imageId) delete v[key];
  } else if (action === 'reset') {
    delete v[key];
  } else if (action === 'upload') {
    const mime = String(body.mime || '');
    if (!MIMES.has(mime)) return fail('invalid_image');
    const data = Buffer.from(String(body.data || ''), 'base64');
    if (!data.length || data.length > 3 * 1024 * 1024) return fail('invalid_image');
    const id = store.nextAttachmentId();
    store.putAttachment(id, String(body.fileName || key.split('/').pop()).slice(0, 120), mime, data);
    v[key] = { ...(v[key] || {}), imageId: id };
  } else return fail('unknown_action');
  save(store, v);
  cache = { at: 0, v: {} };
  return ok({ overrides: v });
}

export const routes = { 'GET visuals': handlePublic, 'POST admin-visuals': handleAdmin };
