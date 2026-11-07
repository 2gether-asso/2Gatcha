// Admin V2 (2026-11-07).
//
// 1) TABLEAU DE BORD : tous les indicateurs utiles en une lecture.
//      POST /webhook/admin-dashboard { discordId }
//    Joueurs (actifs 24 h / 7 j, nouveaux, en direct), boosters ouverts
//    (aujourd'hui + 7 jours), flux de l'economie du jour (EconomyDaily),
//    sante du serveur (metrics.js), etat du jeu (mode, evenement, surprise,
//    boss, codes actifs), planificateur (prochains passages, a valider) et
//    points d'attention calcules ici.
//
// 2) PLANIFICATEUR SEMI-AUTOMATIQUE (table PlannerRules) : des regles qui
//    lancent toutes seules, a la date prevue, un boss, un evenement, un code
//    ou une annonce Discord, une fois ou en boucle (jour, semaine, mois).
//    Une regle "a valider" ne fait rien seule : a l'heure dite elle passe
//    "en attente" (tableau de bord) et attend « Lancer » ou « Passer ».
//      POST /webhook/admin-planner { discordId, action: 'list' | 'save' | 'delete' | 'run' | 'approve' | 'skip', rule?, id? }
//    Passage : tick() toutes les minutes (index.js start), sous le verrou.

import { ok, fail, isAdmin, now, parisDay, parseJson, configRow, refId } from './common.js';
import { snapshot } from '../metrics.js';
import { stats as liveStats } from '../live.js';
import { currentMode } from './presets.js';
import { eventState } from './events.js';
import { activeSurprise } from './surprise.js';
import { cleanRewards } from './rewards.js';
import { postEmbed } from './discord.js';
import { setting } from './settings.js';

export const schema = {
  PlannerRules: {
    Label: { type: 'Text' }, Kind: { type: 'Text' }, Config: { type: 'Text' }, Repeat: { type: 'Text' },
    NextAt: { type: 'Numeric' }, Approval: { type: 'Bool' }, Active: { type: 'Bool' }, PendingAt: { type: 'Numeric' },
    LastRunAt: { type: 'Numeric' }, LastResult: { type: 'Text' }, Runs: { type: 'Numeric' }, CreatedBy: { type: 'Text' }
  }
};

export const KINDS = {
  boss: { label: 'Boss communautaire', icon: '💀' },
  event: { label: 'Événement (bonus)', icon: '🎉' },
  code: { label: 'Code à distribuer', icon: '🎫' },
  discord: { label: 'Annonce Discord', icon: '📢' }
};
const REPEATS = ['once', 'daily', 'weekly', 'monthly'];
const DAY = 86400;

// ------------------------------------------------------------ dates
export function nextAfter(at, repeat) {
  if (repeat === 'daily') return at + DAY;
  if (repeat === 'weekly') return at + 7 * DAY;
  if (repeat === 'monthly') { const d = new Date(at * 1000); d.setUTCMonth(d.getUTCMonth() + 1); return Math.floor(d.getTime() / 1000); }
  return 0;
}
// Prochain passage a venir (une regle en retard ne rattrape pas chaque passage manque).
function upcoming(at, repeat, t = now()) {
  let n = at;
  if (repeat === 'once' || !n) return n;
  let guard = 0;
  while (n <= t && guard++ < 1000) n = nextAfter(n, repeat);
  return n;
}
function preview(rule, count = 5) {
  const out = [];
  let n = Number(rule.NextAt) || 0;
  for (let i = 0; i < count && n; i++) { out.push(n); if (rule.Repeat === 'once') break; n = nextAfter(n, rule.Repeat); }
  return out;
}

// ------------------------------------------------------------ actions
const activePlayers = (store, days = 7) => { const t = now() - days * DAY; return store.peekAll('Users').filter((u) => (Number(u.LastSeenAt) || 0) >= t).length; };
function pickName(cfg, runs) {
  const names = String(cfg.names || cfg.name || 'Boss').split(',').map((s) => s.trim()).filter(Boolean);
  return names.length ? names[runs % names.length] : 'Boss';
}

// Execute une regle ; renvoie un resume (texte du journal) ou leve une erreur.
export function execute(store, rule) {
  const cfg = parseJson(rule.Config, {}) || {};
  const runs = Number(rule.Runs) || 0;
  const t = now();
  if (rule.Kind === 'boss') {
    const bosses = store.tables.has('CommunityBoss') ? store.getAll('CommunityBoss') : [];
    const active = bosses.find((b) => b.Active);
    if (active && cfg.onlyIfNone !== false) return { skipped: true, text: `Boss « ${active.BossName} » encore en vie : pas de nouveau boss.` };
    if (active) store.update('CommunityBoss', active.id, { Active: false });
    const players = activePlayers(store);
    const hp = Math.max(Math.round(Number(cfg.hp) || 0), Math.round((Number(cfg.hpPerPlayer) || 0) * players), 100);
    const name = pickName(cfg, runs);
    store.create('CommunityBoss', { BossName: name, MaxHp: hp, CurrentHp: hp, RewardBoosters: Math.max(0, Math.round(Number(cfg.rewardBoosters) || 0)), Active: true });
    return { text: `Boss « ${name} » lancé : ${hp} PV (${players} joueur${players > 1 ? 's' : ''} actif${players > 1 ? 's' : ''}).` };
  }
  if (rule.Kind === 'event') {
    const hours = Math.max(1, Number(cfg.hours) || 48);
    const m = (v) => Math.max(1, Number(v) || 1);
    store.create('ScheduledEvents', { Label: String(cfg.label || rule.Label || 'Événement').slice(0, 80), StartAt: t, EndAt: t + hours * 3600, Enabled: true, DustMultiplier: m(cfg.dust), FinishMultiplier: m(cfg.finish), FishingRare: m(cfg.fishingRare), WormsMultiplier: m(cfg.worms) });
    return { text: `Événement « ${cfg.label || rule.Label} » pendant ${hours} h.` };
  }
  if (rule.Kind === 'code') {
    const r = cleanRewards(store, cfg.rewards || []);
    if (r.error) throw new Error('Récompenses invalides : ' + r.error);
    const base = String(cfg.prefix || 'CODE').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 14) || 'CODE';
    const taken = new Set((store.tables.has('EventCodes') ? store.getAll('EventCodes') : []).map((c) => String(c.Code || '').toUpperCase()));
    let code = base + '-' + parisDay().slice(5).replace('-', '');
    for (let i = 2; taken.has(code); i++) code = base + '-' + parisDay().slice(5).replace('-', '') + '-' + i;
    store.create('EventCodes', {
      Code: code, Label: String(cfg.label || rule.Label || '').slice(0, 60), RewardType: 'bundle', Quantity: 1, CardId: 0,
      MaxRedemptions: Math.max(0, Math.round(Number(cfg.maxRedemptions) || 0)), ExpiresAt: t + Math.max(1, Number(cfg.hours) || 24) * 3600, StartsAt: 0,
      CreatedAt: t, CreatedBy: 'planificateur', Active: true, Rewards: JSON.stringify(r.rewards), Announce: cfg.announce !== false
    });
    return { text: `Code ${code} créé (${Math.max(1, Number(cfg.hours) || 24)} h).`, code };
  }
  if (rule.Kind === 'discord') {
    const text = String(cfg.text || '').trim();
    if (!text) throw new Error('Message vide');
    // Hors verrou, sans attendre (comme les autres annonces natives).
    Promise.resolve().then(() => postEmbed(store, { title: String(cfg.title || '').slice(0, 200) || undefined, description: text.slice(0, 3500), color: 0x8b5cf6 })).catch(() => {});
    return { text: 'Annonce Discord envoyée.' };
  }
  throw new Error('Type inconnu : ' + rule.Kind);
}

function finish(store, rule, res, t = now()) {
  const next = rule.Repeat === 'once' ? 0 : upcoming(nextAfter(Number(rule.NextAt) || t, rule.Repeat), rule.Repeat, t);
  store.update('PlannerRules', rule.id, { LastRunAt: t, LastResult: String(res.text || '').slice(0, 300), Runs: (Number(rule.Runs) || 0) + (res.skipped ? 0 : 1), PendingAt: 0, NextAt: next, Active: rule.Repeat === 'once' ? false : rule.Active });
}
function runRule(store, rule) {
  let res;
  try { res = execute(store, rule); } catch (e) { res = { text: '⚠️ ' + e.message, error: true }; }
  finish(store, rule, res);
  return res;
}

// Une passe : regles dues -> lancees, ou en attente si elles demandent une validation.
export function tick(store, t = now()) {
  if (!store.tables.has('PlannerRules')) return [];
  const done = [];
  for (const rule of store.getAll('PlannerRules')) {
    if (!rule.Active || !(Number(rule.NextAt) > 0) || Number(rule.NextAt) > t || Number(rule.PendingAt) > 0) continue;
    if (rule.Approval) { store.update('PlannerRules', rule.id, { PendingAt: t }); done.push({ id: rule.id, pending: true }); continue; }
    done.push({ id: rule.id, ...runRule(store, rule) });
  }
  return done;
}

// ------------------------------------------------------------ route planificateur
function publicRule(r) {
  return {
    id: r.id, label: r.Label, kind: r.Kind, config: parseJson(r.Config, {}) || {}, repeat: r.Repeat || 'once', nextAt: Number(r.NextAt) || 0,
    approval: !!r.Approval, active: !!r.Active, pendingAt: Number(r.PendingAt) || 0, lastRunAt: Number(r.LastRunAt) || 0,
    lastResult: r.LastResult || '', runs: Number(r.Runs) || 0, preview: preview(r)
  };
}
const listRules = (store) => (store.tables.has('PlannerRules') ? store.getAll('PlannerRules') : []).map(publicRule)
  .sort((a, b) => (b.pendingAt > 0) - (a.pendingAt > 0) || (b.active - a.active) || (a.nextAt || 9e12) - (b.nextAt || 9e12));

function handlePlanner({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const action = String(body.action || 'list');
  const out = (extra = {}) => ok({ rules: listRules(store), kinds: KINDS, ...extra });
  if (action === 'list') return out();
  if (action === 'save') {
    const r = body.rule || {};
    if (!KINDS[r.kind]) return fail('invalid_kind');
    const repeat = REPEATS.includes(r.repeat) ? r.repeat : 'once';
    const nextAt = Math.round(Number(r.nextAt) || 0);
    if (!nextAt) return fail('invalid_date');
    const config = r.config && typeof r.config === 'object' ? r.config : {};
    if (r.kind === 'code') { const c = cleanRewards(store, config.rewards || []); if (c.error) return fail('invalid_rewards', 400, c); }
    if (r.kind === 'discord' && !String(config.text || '').trim()) return fail('empty_message');
    const fields = { Label: String(r.label || KINDS[r.kind].label).slice(0, 80), Kind: r.kind, Config: JSON.stringify(config), Repeat: repeat, NextAt: upcoming(nextAt, repeat), Approval: !!r.approval, Active: r.active !== false, PendingAt: 0 };
    const id = Number(r.id);
    if (id && store.get('PlannerRules', id)) store.update('PlannerRules', id, fields);
    else store.create('PlannerRules', { ...fields, Runs: 0, CreatedBy: String(body.discordId || '') });
    return out({ saved: true });
  }
  const rule = store.get('PlannerRules', Number(body.id));
  if (!rule) return fail('unknown_rule', 404);
  if (action === 'delete') { store.delete('PlannerRules', rule.id); return out({ deleted: true }); }
  // Lancer tout de suite (bouton « Lancer maintenant » ou validation d'une regle en attente).
  if (action === 'run' || action === 'approve') { const res = runRule(store, rule); return out({ result: res }); }
  if (action === 'skip') { finish(store, rule, { text: 'Passé à la main.', skipped: true }); return out({ skipped: true }); }
  return fail('unknown_action');
}

// ------------------------------------------------------------ tableau de bord
function dashboard(store) {
  const t = now();
  const users = store.peekAll('Users');
  const seen = (d) => users.filter((u) => (Number(u.LastSeenAt) || 0) >= t - d * DAY).length;
  // Boosters ouverts : exemplaires crees par jour (Paris), 7 jours.
  const days = Array.from({ length: 7 }, (_, i) => parisDay(i - 6));
  const perDay = new Map(days.map((d) => [d, 0]));
  const firstPull = new Map();
  for (const p of store.peekAll('Pulls')) {
    const at = Number(p.ObtainedAt) || 0;
    const u = refId(p.User);
    if (u && (!firstPull.has(u) || at < firstPull.get(u))) firstPull.set(u, at);
    if (at < t - 8 * DAY) continue;
    const d = parisDay(0, at * 1000);
    if (perDay.has(d)) perDay.set(d, perDay.get(d) + 1);
  }
  const newPlayers = [...firstPull.values()].filter((at) => at >= t - 7 * DAY).length;
  // Economie du jour / d'hier (EconomyDaily, par source).
  const eco = (day) => {
    const rows = store.tables.has('EconomyDaily') ? store.peekAll('EconomyDaily').filter((r) => r.Day === day) : [];
    const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const top = rows.map((r) => ({ source: r.Source, boosters: Number(r.BoostersIn) || 0, dust: Number(r.DustIn) || 0 })).sort((a, b) => b.boosters - a.boosters || b.dust - a.dust).slice(0, 5);
    return { boostersIn: sum('BoostersIn'), boostersOut: sum('BoostersOut'), dustIn: sum('DustIn'), dustOut: sum('DustOut'), top };
  };
  const wealth = users.reduce((s, u) => s + (Number(u.StardustCount) || 0), 0);
  const boostersHeld = users.reduce((s, u) => s + (Number(u.BoosterCount) || 0), 0);
  // Etat du jeu.
  const boss = (store.tables.has('CommunityBoss') ? store.peekAll('CommunityBoss') : []).filter((b) => b.Active).pop() || null;
  const ev = eventState(store);
  const surprise = activeSurprise(store);
  const codes = (store.tables.has('EventCodes') ? store.peekAll('EventCodes') : []).filter((c) => c.Active !== false && (!c.ExpiresAt || Number(c.ExpiresAt) > t));
  const nextEvents = (store.tables.has('ScheduledEvents') ? store.peekAll('ScheduledEvents') : []).filter((e) => e.Enabled !== false && Number(e.StartAt) > t).sort((a, b) => a.StartAt - b.StartAt).slice(0, 3)
    .map((e) => ({ label: e.Label, startAt: e.StartAt, endAt: e.EndAt }));
  const rules = listRules(store);
  const health = snapshot();
  const cfg = configRow(store) || {};
  // Points d'attention.
  const alerts = [];
  const pending = rules.filter((r) => r.pendingAt > 0);
  if (pending.length) alerts.push({ tone: 'warn', goto: 'planning', text: `${pending.length} action${pending.length > 1 ? 's' : ''} planifiée${pending.length > 1 ? 's' : ''} à valider.` });
  if (!boss && !rules.some((r) => r.active && r.kind === 'boss')) alerts.push({ tone: 'info', goto: 'planning', text: 'Aucun boss en cours ni planifié : un boss automatique chaque semaine se crée en 2 clics.' });
  if (!ev.active && !nextEvents.length && !rules.some((r) => r.active && r.kind === 'event')) alerts.push({ tone: 'info', goto: 'planning', text: 'Aucun événement en cours, prévu ou planifié.' });
  const req = health.requests || {};
  const slow = (req.slowest || []).filter((r) => (r.p50 || 0) > 1000);
  if (slow.length) alerts.push({ tone: 'warn', goto: 'sante', text: `Routes lentes (médiane > 1 s) : ${slow.slice(0, 3).map((r) => r.path).join(', ')}.` });
  if (req.failed > 0) alerts.push({ tone: 'bad', goto: 'sante', text: `Erreurs serveur sur la dernière heure : ${req.failed}.` });
  if (cfg.MaintenanceMode) alerts.push({ tone: 'bad', goto: 'site', text: 'Le mode maintenance est actif.' });
  rules.filter((r) => /^⚠️/.test(r.lastResult)).slice(0, 3).forEach((r) => alerts.push({ tone: 'bad', goto: 'planning', text: `Planificateur : « ${r.label} » a échoué (${r.lastResult.replace(/^⚠️\s*/, '')}).` }));
  return {
    at: t,
    players: { total: users.length, active24h: seen(1), active7d: seen(7), new7d: newPlayers, live: liveStats().players },
    pulls: { today: perDay.get(days[6]) || 0, days: days.map((d) => ({ day: d, n: perDay.get(d) || 0 })) },
    economy: { today: eco(days[6]), yesterday: eco(days[5]), dustHeld: wealth, boostersHeld, target: setting(store, 'BoosterTargetPerDay') },
    game: {
      mode: currentMode(store),
      event: ev.active ? { label: ev.label, endsAt: ev.endsAt } : null, nextEvents,
      surprise: surprise ? { label: surprise.label, icon: surprise.icon, until: surprise.until || null } : null,
      boss: boss ? { name: boss.BossName, hp: Number(boss.CurrentHp) || 0, maxHp: Number(boss.MaxHp) || 0 } : null,
      codes: codes.map((c) => ({ code: c.Code, label: c.Label, expiresAt: Number(c.ExpiresAt) || 0 })).slice(0, 8), codesCount: codes.length
    },
    planner: { next: rules.filter((r) => r.active && r.nextAt).slice(0, 6), pending },
    health: { uptimeSeconds: health.uptimeSeconds, requests: req.lastHour || 0, p50: req.p50 || 0, p95: req.p95 || 0, failed: req.failed || 0, errorsSinceStart: (health.errors && health.errors.sinceStart) || 0, memoryMb: health.memoryMb, slowest: (req.slowest || []).slice(0, 5) },
    alerts
  };
}
function handleDashboard({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  return ok(dashboard(store));
}

export const routes = { 'POST admin-dashboard': handleDashboard, 'POST admin-planner': handlePlanner };
