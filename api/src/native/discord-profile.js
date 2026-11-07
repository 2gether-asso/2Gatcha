// Photo et nom Discord a jour (2026-11-06). Avant, ils n'etaient relus qu'a
// la connexion : avec un jeton de 60 jours, une nouvelle photo de profil ne
// remontait jamais (et l'ancienne adresse du CDN finit par ne plus repondre).
//
// A la connexion, le workflow discord-login ajoute a sa reponse le jeton de
// rafraichissement OAuth (discordRefresh) : il est retire de la reponse et
// garde dans DiscordLinks (jamais renvoye par l'API). Une passe toutes les
// 10 minutes reprend les joueurs venus depuis 3 jours dont la derniere
// lecture date de plus de DiscordProfileRefreshHours : nouveau jeton, puis
// /users/@me, et Users.DiscordAvatar / DiscordUsername mis a jour.
// Le jeton refuse (acces retire dans Discord) : le lien est oublie, la
// photo sera relue a la prochaine connexion.
// booster-status renvoie la photo enregistree : le site corrige sa session.

import fs from 'node:fs';
import path from 'node:path';
import { refId, now } from './common.js';
import { setting } from './settings.js';
import { config } from '../config.js';

export const schema = {
  DiscordLinks: { User: { type: 'Ref:Users' }, Refresh: { type: 'Text' }, CheckedAt: { type: 'Numeric' } }
};

// Meme calcul que le workflow discord-login (avatar par defaut sinon).
export function avatarUrl(u) {
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`;
  const i = Number(BigInt(u.id) >> 22n) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${i}.png`;
}

const linkOf = (store, userId) => store.getAll('DiscordLinks').find((l) => refId(l.User) === userId);

function saveLink(store, userId, refresh) {
  const cur = linkOf(store, userId);
  if (cur) store.update('DiscordLinks', cur.id, { Refresh: refresh, CheckedAt: now() });
  else store.create('DiscordLinks', { User: userId, Refresh: refresh, CheckedAt: now() });
}

export function afterWorkflow({ store, path: p, request = {}, response }) {
  const json = response.json;
  if (!json || typeof json !== 'object') return;
  if (p === 'discord-login') {
    const refresh = json.discordRefresh;
    delete json.discordRefresh;
    if (response.status === 200 && json.userId && refresh) saveLink(store, Number(json.userId), String(refresh));
    return;
  }
  const id = Number((request.query || {}).userId);
  if (p === 'booster-status' && response.status === 200 && id) {
    const user = store.get('Users', id);
    if (user && user.DiscordId) json.discordAvatar = user.DiscordAvatar || '';
  }
}

// Identifiants de l'application Discord : variables d'hebergement, sinon le
// "Set Config" du workflow (le secret n'y est qu'un exemple).
function credentials(workflowsDir) {
  let id = config.overrides.clientId || '';
  if (!id && workflowsDir) {
    try {
      const wf = fs.readFileSync(path.join(workflowsDir, 'discord-login.json'), 'utf8');
      id = (wf.match(/clientId: '(\d+)'/) || [])[1] || '';
    } catch (e) { /* workflow absent */ }
  }
  const secret = config.overrides.clientSecret || '';
  return id && secret && !secret.startsWith('CHANGE-MOI') ? { id, secret } : null;
}

// Sous le verrou : les liens a relire (au plus `max` par passe).
export function due(store, max = 20) {
  const t = now();
  const every = setting(store, 'DiscordProfileRefreshHours') * 3600;
  const recent = new Set(store.getAll('Users').filter((u) => u.DiscordId && t - (Number(u.LastSeenAt) || 0) < 3 * 86400).map((u) => u.id));
  return store.getAll('DiscordLinks')
    .filter((l) => recent.has(refId(l.User)) && t - (Number(l.CheckedAt) || 0) >= every)
    .sort((a, b) => (Number(a.CheckedAt) || 0) - (Number(b.CheckedAt) || 0))
    .slice(0, max)
    .map((l) => ({ linkId: l.id, userId: refId(l.User), refresh: l.Refresh }));
}

// Hors verrou : interroge Discord. Renvoie { linkId, userId, refresh?, profile?, revoked? }.
export async function fetchProfiles(jobs, creds, fetchImpl = fetch) {
  const out = [];
  for (const j of jobs) {
    try {
      const tok = await fetchImpl('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: creds.id, client_secret: creds.secret, grant_type: 'refresh_token', refresh_token: j.refresh }).toString()
      });
      const tj = await tok.json().catch(() => ({}));
      if (!tok.ok) { out.push({ ...j, revoked: tj.error === 'invalid_grant' }); continue; }
      const me = await fetchImpl('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tj.access_token}` } });
      const mj = me.ok ? await me.json().catch(() => null) : null;
      out.push({ ...j, refresh: tj.refresh_token || j.refresh, profile: mj && mj.id ? mj : null });
    } catch (e) { out.push({ ...j, error: true }); }
  }
  return out;
}

// Sous le verrou : enregistre les reponses.
export function apply(store, results) {
  let changed = 0;
  for (const r of results) {
    const link = store.get('DiscordLinks', r.linkId);
    if (!link) continue;
    if (r.revoked) { store.delete('DiscordLinks', r.linkId); continue; }
    // Erreur passagere (Discord indisponible) : on reessaiera a la passe suivante.
    if (r.error) continue;
    store.update('DiscordLinks', r.linkId, { Refresh: r.refresh, CheckedAt: now() });
    const user = store.get('Users', r.userId);
    if (!r.profile || !user || String(user.DiscordId) !== String(r.profile.id)) continue;
    const fields = {};
    const av = avatarUrl(r.profile);
    const name = r.profile.global_name || r.profile.username;
    if (av !== user.DiscordAvatar) fields.DiscordAvatar = av;
    if (name && name !== user.DiscordUsername) fields.DiscordUsername = name;
    if (Object.keys(fields).length) { store.update('Users', r.userId, fields); changed++; }
  }
  return changed;
}

// Planificateur (index.js) : une passe toutes les 10 minutes.
export function startRefresh({ store, withLock, captureError, workflowsDir }) {
  const creds = credentials(workflowsDir);
  if (!creds) return false;
  const tick = async () => {
    try {
      const jobs = await withLock(() => due(store));
      if (!jobs.length) return;
      const results = await fetchProfiles(jobs, creds);
      await withLock(() => apply(store, results));
    } catch (e) { console.error(e); captureError(e, { job: 'discord-profile' }); }
  };
  setInterval(tick, 10 * 60 * 1000).unref();
  setTimeout(tick, 15000).unref();
  return true;
}
