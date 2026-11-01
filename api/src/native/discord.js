// Annonces Discord (2026-10-26) : un seul endroit pour l'adresse du webhook et
// les messages que le jeu poste sur le serveur Discord.
//  - Adresse : reglee dans Admin > Discord (AppSettings 'discordWebhook'),
//    sinon la variable DISCORD_WEBHOOK_URL. L'adresse des anciens workflows
//    n'est jamais prise d'office (les tests posteraient sur le vrai serveur) :
//    un bouton de la page la reprend (action 'useLegacy').
//  - Modeles : un par annonce (nouveau code, carte Unique, carte partagee),
//    activables, avec titre, texte, couleur et variables {pseudo}, {code}...
//  - Message libre : envoye tout de suite depuis l'admin (apercu, test).
//  - Images : toutes les annonces partent en image du studio de partage (2026-11-01).
//   POST /webhook/discord-image { id, image, userId | discordId }
//   POST /webhook/admin-discord { discordId, action: 'status' | 'delivery' | 'save' | 'useLegacy' | 'test' | 'send', webhook?, templates?, message? }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, fail, isAdmin, refId, firstAttachment, cardSummary } from './common.js';
import { currentContext } from './context.js';
import { captureError } from '../monitoring.js';

// Annonces et variables disponibles (l'admin modifie les textes, pas la liste).
export const TEMPLATES = {
  code: {
    label: 'Nouveau code événement', when: 'À la création d’un code avec « Annoncer sur le serveur » coché, ou avec le bouton 📣 de la liste des codes.',
    vars: { code: 'le code', label: 'la note (titre de l’événement)', rewards: 'les récompenses, une par ligne', dates: 'la période de validité', quota: 'le nombre de joueurs max (vide si illimité)' },
    def: { enabled: true, title: '🎁 Nouveau code : {code}', text: '**{label}**\n{rewards}\n\n⏳ {dates}{quota}\nÀ réclamer sur le site, page « Réclamer un code » !', color: '#f59e0b' }
  },
  unique: {
    label: 'Carte Unique obtenue', when: 'Quand un joueur échange un Ticket Unique au comptoir.',
    vars: { pseudo: 'le joueur', card: 'la carte', serial: 'son numéro', first: '« premier exemplaire du serveur ! » si c’est le cas' },
    def: { enabled: true, title: '🍀 Carte Unique obtenue !', text: '**{pseudo}** a échangé un Ticket Unique contre **{card}** (#{serial}){first}', color: '#22c55e' }
  },
  cardShare: {
    label: 'Carte partagée par un joueur', when: 'Bouton « Publier sur Discord » du studio de partage (l’image de la carte est jointe).',
    vars: { pseudo: 'le joueur', card: 'la carte', details: 'rareté, finition, état, édition, numéro' },
    def: { enabled: true, title: '🎴 {card}', text: '**{pseudo}** partage sa carte : {details}', color: '#8b5cf6' }
  }
};

const here = path.dirname(fileURLToPath(import.meta.url));
let legacyUrl;
function workflowUrl() {
  if (legacyUrl !== undefined) return legacyUrl;
  legacyUrl = null;
  try {
    const raw = fs.readFileSync(path.join(here, '..', '..', 'workflows', 'admin-codes.json'), 'utf8');
    const m = /https:\/\/discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9_/-]+/.exec(raw);
    if (m) legacyUrl = m[0];
  } catch (e) { /* pas de workflow : pas d'adresse de secours */ }
  return legacyUrl;
}
const appGet = (store, key) => { if (!store.tables.has('AppSettings')) return null; const r = store.getAll('AppSettings').find((x) => x.Key === key); return r ? r.Value : null; };
function appSet(store, key, value) {
  const r = store.getAll('AppSettings').find((x) => x.Key === key);
  if (r) store.update('AppSettings', r.id, { Value: value }); else store.create('AppSettings', { Key: key, Value: value });
}
export function webhookUrl(store) {
  const own = store && appGet(store, 'discordWebhook');
  return own || process.env.DISCORD_WEBHOOK_URL || null;
}
const urlSource = (store) => (appGet(store, 'discordWebhook') ? 'admin' : process.env.DISCORD_WEBHOOK_URL ? 'env' : 'none');
const mask = (u) => (u ? u.replace(/(webhooks\/\d+\/).+$/, '$1••••••') : '');
const isWebhook = (u) => /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(String(u || ''));

export function templatesOf(store) {
  let saved = {};
  try { saved = JSON.parse(appGet(store, 'discordTemplates') || '{}') || {}; } catch (e) { saved = {}; }
  return Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, { ...t.def, ...(saved[k] || {}) }]));
}
const fill = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const colorInt = (c) => parseInt(String(c || '#8b5cf6').replace('#', ''), 16) || 0x8b5cf6;
// Message Discord d'un modele (null si desactive).
export function render(store, kind, vars = {}) {
  const t = templatesOf(store)[kind];
  if (!t || t.enabled === false) return null;
  return { title: fill(t.title, vars).slice(0, 256), description: fill(t.text, vars).slice(0, 4000), color: colorInt(t.color) };
}
// Suivi des envois (2026-11-01) : tout passe par discordFetch, workflows compris
// (server.js). Un refus de Discord ou une panne reseau ne bloque pas le jeu, mais
// se voit : Admin > Discord, journaux du serveur et GlitchTip.
const isDiscordUrl = (u) => /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\//.test(String(u));
const delivery = { count: 0, last: null };
function noteDelivery(result) {
  delivery.count++;
  delivery.last = { at: new Date().toISOString(), ...result };
  if (result.ok) return;
  const text = `Discord : envoi refuse (${result.status || 'reseau'}) ${result.detail}`.trim();
  console.error('[discord] ' + text);
  captureError(new Error(text), { hook: 'discord' });
}
// Annonces en image (2026-11-01) : le serveur ne sait pas dessiner, le studio de
// partage tourne dans le navigateur. Une annonce attend donc l'image du navigateur
// a l'origine de l'action (reponse : discordPending -> POST discord-image), et part
// en texte au bout de IMAGE_WAIT si elle n'arrive pas (page fermee, dessin en echec).
const pending = new Map();
let IMAGE_WAIT = 20000;
export const _setImageWait = (ms) => { IMAGE_WAIT = ms; };
const hexOf = (n) => '#' + (Number(n) || 0x8b5cf6).toString(16).padStart(6, '0');
function cardOfEmbed(store, embed, cardId) {
  if (!store.tables.has('Cards')) return null;
  const imageId = Number((/[?&]id=(\d+)/.exec((embed.image && embed.image.url) || '') || [])[1]) || 0;
  const card = cardId ? store.get('Cards', cardId) : imageId ? store.getAll('Cards').find((c) => firstAttachment(c.Image) === imageId) : null;
  if (!card) return null;
  // Le dernier exemplaire du joueur : l'image montre sa finition, son etat, son numero.
  const userId = currentContext().userId;
  const pull = userId && store.tables.has('Pulls') ? store.rowsBy('Pulls', 'User', userId).filter((p) => refId(p.Card) === card.id).pop() : null;
  return { card: cardSummary(store, card), finish: (pull && pull.Finish) || 'normal', quality: (pull && pull.Quality) || null, edition: (pull && pull.Edition) || null, serial: (pull && pull.SerialNumber) || null };
}
function jsonPost(url, payload) {
  return deliver(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}
// Hors requete d'un navigateur : envoi direct, en texte.
function queueAnnounce(store, url, payload, { cardId = 0 } = {}) {
  const ctx = currentContext();
  const embed = payload.embeds && payload.embeds[0];
  if (!embed || !ctx.actor) { setTimeout(() => { jsonPost(url, payload).catch(() => {}); }, 0); return; }
  const id = crypto.randomUUID();
  const timer = setTimeout(() => { pending.delete(id); jsonPost(url, payload).catch(() => {}); }, IMAGE_WAIT);
  if (timer.unref) timer.unref();
  pending.set(id, { url, payload, owner: ctx.actor, timer, cardId });
  const pseudoOf = (discordId) => (store.getAll('Users').find((u) => String(u.DiscordId) === discordId) || {}).Pseudo || 'Un joueur';
  const headline = String(payload.content || '').replace(/<@!?(\d+)>/g, (m, d) => pseudoOf(d));
  (ctx.discordPending = ctx.discordPending || []).push({ id, headline, title: embed.title || '', text: embed.description || '', color: hexOf(embed.color), picture: (embed.image && embed.image.url) || '', ...cardOfEmbed(store, embed, cardId) });
}
// Reponse d'une action : les annonces qui attendent leur image.
export function attachPending(response) {
  const ctx = currentContext();
  if (!ctx.discordPending || !ctx.discordPending.length) return;
  if (response && response.json && typeof response.json === 'object' && !Array.isArray(response.json)) response.json.discordPending = ctx.discordPending;
  ctx.discordPending = null;
}
function handleImage({ body }) {
  const p = pending.get(String(body.id));
  if (!p) return fail('announce_expired', 410);
  if (p.owner !== currentContext().actor) return fail('forbidden', 403);
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
  if (!m || m[2].length > 8 * 1024 * 1024) return fail('invalid_image');
  clearTimeout(p.timer);
  pending.delete(String(body.id));
  const name = `annonce.${m[1] === 'png' ? 'png' : 'jpg'}`;
  const [first, ...others] = p.payload.embeds;
  // L'image porte le texte : l'embed garde le titre (code a copier, noms des cartes).
  const main = { ...(first.title ? { title: first.title } : {}), color: first.color, image: { url: `attachment://${name}` } };
  // Image libre de l'admin hors studio : gardee a part.
  const extra = first.image && !p.cardId && !/[?&]id=\d+/.test(first.image.url || '') ? [{ color: first.color, image: first.image }] : [];
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ ...p.payload, embeds: [main, ...extra, ...others] }));
  form.append('files[0]', new Blob([Buffer.from(m[2], 'base64')], { type: `image/${m[1]}` }), name);
  setTimeout(() => { deliver(p.url, { method: 'POST', body: form }).catch(() => {}); }, 0);
  return ok({ posted: true });
}

// Pour les workflows (store fourni, server.js) : leurs annonces (tirages, codes)
// attendent l'image comme les autres.
export async function discordFetch(url, options = {}, store = null) {
  if (store && isDiscordUrl(url) && typeof options.body === 'string' && currentContext().actor) {
    let payload = null;
    try { payload = JSON.parse(options.body); } catch (e) { payload = null; }
    if (payload && Array.isArray(payload.embeds) && payload.embeds.length) {
      queueAnnounce(store, url, payload);
      return new Response(null, { status: 204 });
    }
  }
  return deliver(url, options);
}
async function deliver(url, options = {}) {
  if (!isDiscordUrl(url)) return fetch(url, options);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...options });
    const detail = res.ok ? '' : (await res.clone().text().catch(() => '')).slice(0, 200);
    noteDelivery({ ok: res.ok, status: res.status, detail });
    return res;
  } catch (e) {
    noteDelivery({ ok: false, status: null, detail: String((e.cause && e.cause.code) || e.name || 'erreur') });
    throw e;
  }
}
// Envoi sans attendre (un echec ne bloque jamais le jeu). Renvoie true si parti.
export function postEmbed(store, embed, { url = webhookUrl(store), extra = {} } = {}) {
  if (!url || !embed || typeof fetch !== 'function') return false;
  setTimeout(() => { jsonPost(url, { embeds: [embed], ...extra }).catch(() => {}); }, 0);
  return true;
}
// Annonce en image (studio de partage du navigateur), en texte a defaut.
export function announce(store, kind, vars, { cardId = 0 } = {}) {
  const url = webhookUrl(store);
  const embed = render(store, kind, vars);
  if (!url || !embed) return false;
  queueAnnounce(store, url, { embeds: [embed] }, { cardId });
  return true;
}

function status(store) {
  const url = webhookUrl(store);
  return { webhook: { configured: !!url, masked: mask(url), source: urlSource(store), legacy: workflowUrl() ? mask(workflowUrl()) : null, delivery }, templates: Object.entries(TEMPLATES).map(([k, t]) => ({ key: k, label: t.label, when: t.when, vars: t.vars, def: t.def, ...templatesOf(store)[k] })) };
}
function clean(t, def) {
  return {
    enabled: t.enabled !== false, title: String(t.title ?? def.title).slice(0, 256), text: String(t.text ?? def.text).slice(0, 4000),
    color: /^#[0-9a-f]{6}$/i.test(String(t.color || '')) ? t.color : def.color
  };
}
function handle({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const action = body.action || 'status';
  if (action === 'status') return ok(status(store));
  // Resultat du dernier envoi (la page attend la reponse de Discord apres un test).
  if (action === 'delivery') return ok({ delivery });
  if (action === 'save') {
    if (body.webhook != null) {
      const w = String(body.webhook).trim();
      if (w && !isWebhook(w)) return fail('invalid_webhook');
      appSet(store, 'discordWebhook', w);
    }
    if (body.templates && typeof body.templates === 'object') {
      const out = {};
      for (const [k, t] of Object.entries(body.templates)) if (TEMPLATES[k] && t && typeof t === 'object') out[k] = clean(t, TEMPLATES[k].def);
      appSet(store, 'discordTemplates', JSON.stringify({ ...JSON.parse(appGet(store, 'discordTemplates') || '{}'), ...out }));
    }
    return ok(status(store));
  }
  if (action === 'useLegacy') {
    if (!workflowUrl()) return fail('no_legacy_webhook', 404);
    appSet(store, 'discordWebhook', workflowUrl());
    return ok(status(store));
  }
  if (action === 'test' || action === 'send') {
    const url = webhookUrl(store);
    if (!url) return fail('discord_unavailable', 503);
    const m = body.message || {};
    const embed = action === 'test'
      ? { title: '✅ Test du webhook', description: 'Les annonces de 2Gatcha arrivent bien ici.', color: 0x22c55e }
      : { title: String(m.title || '').slice(0, 256), description: String(m.text || '').slice(0, 4000), color: colorInt(m.color), ...(/^https:\/\//.test(String(m.image || '')) ? { image: { url: m.image } } : {}) };
    if (action === 'send' && !embed.title && !embed.description) return fail('empty_message');
    // Envoi sans attendre : les routes tournent sous le verrou du serveur,
    // on ne bloque pas les autres joueurs le temps que Discord reponde.
    // Le test reste en texte : il verifie le webhook, pas le dessin.
    if (action === 'send') queueAnnounce(store, url, { embeds: [embed] });
    else postEmbed(store, embed, { url });
    return ok({ sent: true, ...status(store) });
  }
  return fail('unknown_action');
}

export const routes = { 'POST admin-discord': handle, 'POST discord-image': handleImage };
export const _legacyUrl = workflowUrl;
