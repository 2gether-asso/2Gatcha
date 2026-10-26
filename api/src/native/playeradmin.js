// Admin > Joueurs (2026-10-26) : fiche d'un joueur pour reparer apres un bug.
// Ressources, XP et prestiges des metiers, energies, serie, tablettes par
// sorte ; et chaque exemplaire de carte (finition, etat, edition, coffre,
// suppression). Seuls les champs de la liste blanche se modifient ici (le
// reste : page Base de donnees) ; chaque modification passe par le journal
// de l'economie comme les autres actions de l'equipe.
//   POST /webhook/admin-player { discordId, action: 'get' | 'set' | 'pull', targetUserId, fields?, tablets?, pullId?, changes?, remove? }

import { refId, ok, fail, isAdmin, levelForXp, firstAttachment } from './common.js';
import { setting } from './settings.js';
import { levelInfo, digLevel, expeditionLevel, gardenLevel } from './levels.js';
import { EDITIONS } from './editions.js';
import { RESOURCES } from './rewards.js';
import { TABLETS } from './archeo.js';

// Champs modifiables : ressources (meme catalogue que Codes & dons), puis
// XP, prestiges, energies et serie.
const FIELDS = [
  ...Object.values(RESOURCES).filter((r) => r.field).map((r) => ({ key: r.field, label: r.many.charAt(0).toUpperCase() + r.many.slice(1), icon: r.icon, group: 'Ressources' })),
  { key: 'XP', label: 'XP du profil', icon: '⭐', group: 'Niveaux et XP' },
  { key: 'DigXP', label: 'XP de fouille', icon: '⛏️', group: 'Niveaux et XP' },
  { key: 'FishingXP', label: 'XP de pêche', icon: '🎣', group: 'Niveaux et XP' },
  { key: 'ExpeditionXP', label: 'XP d’expédition', icon: '🧭', group: 'Niveaux et XP' },
  { key: 'GardenXP', label: 'XP du jardin', icon: '🌱', group: 'Niveaux et XP' },
  { key: 'ArcheoXP', label: 'XP d’archéologue', icon: '🏺', group: 'Niveaux et XP' },
  { key: 'CasinoXP', label: 'XP du casino', icon: '🎰', group: 'Niveaux et XP' },
  { key: 'ForbiddenXP', label: 'XP de la machine interdite', icon: '⛓️', group: 'Niveaux et XP' },
  { key: 'DigPrestige', label: 'Prestige de fouille', icon: '🌟', group: 'Niveaux et XP', max: 50 },
  { key: 'FishingPrestige', label: 'Prestige de pêche', icon: '🌟', group: 'Niveaux et XP', max: 50 },
  { key: 'ExpeditionPrestige', label: 'Prestige d’expédition', icon: '🌟', group: 'Niveaux et XP', max: 50 },
  { key: 'GardenPrestige', label: 'Prestige du jardin', icon: '🌟', group: 'Niveaux et XP', max: 50 },
  { key: 'DigEnergy', label: 'Énergie de fouille', icon: '⚡', group: 'Énergies et série', max: 1000 },
  { key: 'FishingEnergy', label: 'Énergie de pêche', icon: '⚡', group: 'Énergies et série', max: 1000 },
  { key: 'LoginStreak', label: 'Série de connexion (jours)', icon: '🔥', group: 'Énergies et série', max: 10000 },
  { key: 'StreakFreezes', label: 'Gels de série', icon: '❄️', group: 'Énergies et série', max: 100 }
];
const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));
const FINISHES = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow', 'emerald'];
const QUALITIES = ['damaged', 'worn', 'good', 'mint'];
const MAX_VALUE = 100000000;

function tabletsOf(user) {
  let st = {};
  try { st = JSON.parse(user.TabletStock || '{}') || {}; } catch (e) { st = {}; }
  const out = Object.fromEntries(Object.keys(TABLETS).map((k) => [k, Math.max(0, Math.floor(Number(st[k]) || 0))]));
  const total = Object.values(out).reduce((a, n) => a + n, 0);
  const want = Math.max(0, Math.floor(Number(user.Tablets) || 0));
  if (want > total) out.clay += want - total;
  return out;
}
function sheet(store, user) {
  const rar = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  const pulls = store.getAll('Pulls').filter((p) => refId(p.User) === user.id).map((p) => {
    const c = store.get('Cards', refId(p.Card));
    const r = c && rar.get(refId(c.Rarity));
    return {
      pullId: p.id, cardId: refId(p.Card), name: c ? c.Name : '?', imageId: c ? firstAttachment(c.Image) : null,
      rarity: r ? { key: r.Key, name: r.Name, colorHex: r.ColorHex, sortOrder: r.SortOrder || 0 } : null,
      finish: p.Finish || 'normal', quality: p.Quality || 'damaged', edition: p.Edition || '', serial: p.SerialNumber ?? null,
      inVault: !!p.InVault, locked: !!p.VaultLocked, starred: !!p.Starred, insured: !!p.Insured, obtainedAt: Number(p.ObtainedAt) || null
    };
  }).sort((a, b) => (b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0) || a.name.localeCompare(b.name) || (a.serial || 0) - (b.serial || 0));
  const fishStep = setting(store, 'FishingLevelXpStep');
  return {
    user: { userId: user.id, pseudo: user.Pseudo || '', discordId: user.DiscordId || '', createdAt: Number(user.CreatedAt) || null, lastSeenAt: Number(user.LastSeenAt) || null },
    fields: FIELDS.map((f) => ({ ...f, value: Number(user[f.key]) || 0 })),
    tablets: tabletsOf(user), tabletKinds: Object.entries(TABLETS).map(([k, t]) => ({ key: k, label: t.label, icon: t.icon })),
    levels: {
      profile: levelForXp(Number(user.XP) || 0), dig: digLevel(store, user).level, expedition: expeditionLevel(store, user).level, garden: gardenLevel(store, user).level,
      ...(fishStep ? { fishing: levelInfo(user.FishingXP, fishStep).level } : {})
    },
    pulls,
    options: { finishes: FINISHES, qualities: QUALITIES, editions: Object.entries(EDITIONS).map(([key, e]) => ({ key, label: e.label, icon: e.icon })) }
  };
}

function setFields(store, user, body) {
  const fields = {};
  for (const [k, v] of Object.entries(body.fields || {})) {
    const f = BY_KEY.get(k);
    if (!f) return fail('field_not_editable', 400, { field: k });
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > (f.max || MAX_VALUE)) return fail('invalid_value', 400, { field: k, max: f.max || MAX_VALUE });
    fields[k] = n;
  }
  if (body.tablets && typeof body.tablets === 'object') {
    const st = tabletsOf(user);
    for (const [k, v] of Object.entries(body.tablets)) {
      if (!TABLETS[k]) return fail('field_not_editable', 400, { field: 'tablet:' + k });
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 1000) return fail('invalid_value', 400, { field: 'tablet:' + k, max: 1000 });
      st[k] = n;
    }
    fields.TabletStock = JSON.stringify(st);
    fields.Tablets = Object.values(st).reduce((a, n) => a + n, 0);
  }
  if (!Object.keys(fields).length) return fail('nothing_to_change');
  store.update('Users', user.id, fields);
  return ok({ ...sheet(store, store.get('Users', user.id)), changed: Object.keys(fields) });
}

function editPull(store, user, body) {
  const p = store.get('Pulls', Number(body.pullId));
  if (!p || refId(p.User) !== user.id) return fail('pull_not_found', 404);
  if (body.remove) { store.delete('Pulls', p.id); return ok({ ...sheet(store, user), removed: p.id }); }
  const c = body.changes || {};
  const fields = {};
  if (c.finish != null) { if (!FINISHES.includes(c.finish)) return fail('invalid_value', 400, { field: 'finish' }); fields.Finish = c.finish; }
  if (c.quality != null) { if (!QUALITIES.includes(c.quality)) return fail('invalid_value', 400, { field: 'quality' }); fields.Quality = c.quality; }
  if (c.edition != null) { if (c.edition && !EDITIONS[c.edition]) return fail('invalid_value', 400, { field: 'edition' }); fields.Edition = c.edition || ''; }
  if (c.inVault != null) { fields.InVault = !!c.inVault; if (!c.inVault) fields.VaultLocked = false; }
  if (c.starred != null) fields.Starred = !!c.starred;
  if (c.insured != null) fields.Insured = !!c.insured;
  if (!Object.keys(fields).length) return fail('nothing_to_change');
  store.update('Pulls', p.id, fields);
  return ok({ ...sheet(store, user), changedPull: p.id });
}

function handle({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  // Le joueur vise passe par targetUserId : userId est reserve au joueur
  // connecte (verifie par le jeton, auth_forbidden sinon).
  const user = store.get('Users', Number(body.targetUserId ?? body.userId));
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'get';
  if (action === 'get') return ok(sheet(store, user));
  if (action === 'set') return setFields(store, user, body);
  if (action === 'pull') return editPull(store, user, body);
  return fail('unknown_action');
}

export const routes = { 'POST admin-player': handle };
