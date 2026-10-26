// Annonces Discord (2026-10-26) : un seul endroit pour l'adresse du webhook et
// les messages que le jeu poste sur le serveur Discord.
//  - Adresse : reglee dans Admin > Discord (AppSettings 'discordWebhook'),
//    sinon la variable DISCORD_WEBHOOK_URL. L'adresse des anciens workflows
//    n'est jamais prise d'office (les tests posteraient sur le vrai serveur) :
//    un bouton de la page la reprend (action 'useLegacy').
//  - Modeles : un par annonce (nouveau code, carte Unique, carte partagee),
//    activables, avec titre, texte, couleur et variables {pseudo}, {code}...
//  - Message libre : envoye tout de suite depuis l'admin (apercu, test).
//   POST /webhook/admin-discord { discordId, action: 'status' | 'save' | 'useLegacy' | 'test' | 'send', webhook?, templates?, message? }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, fail, isAdmin } from './common.js';

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
// Envoi sans attendre (un echec ne bloque jamais le jeu). Renvoie true si parti.
export function postEmbed(store, embed, { url = webhookUrl(store), extra = {} } = {}) {
  if (!url || !embed || typeof fetch !== 'function') return false;
  setTimeout(() => { fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed], ...extra }) }).catch(() => {}); }, 0);
  return true;
}
export const announce = (store, kind, vars) => postEmbed(store, render(store, kind, vars));

function status(store) {
  const url = webhookUrl(store);
  return { webhook: { configured: !!url, masked: mask(url), source: urlSource(store), legacy: workflowUrl() ? mask(workflowUrl()) : null }, templates: Object.entries(TEMPLATES).map(([k, t]) => ({ key: k, label: t.label, when: t.when, vars: t.vars, def: t.def, ...templatesOf(store)[k] })) };
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
    postEmbed(store, embed, { url });
    return ok({ sent: true, ...status(store) });
  }
  return fail('unknown_action');
}

export const routes = { 'POST admin-discord': handle };
export const _legacyUrl = workflowUrl;
