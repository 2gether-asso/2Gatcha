// Compte test admin (2026-10-18) : un compte (TestAccountId, 9 = "Le Grand
// 2GETHER") sur lequel un admin bascule SANS Discord pour tester la
// progression, les niveaux et les autres difficultes sans toucher aux autres.
//  - Connexion : un admin (jeton Discord valide) recoit un jeton du compte test.
//  - Outils : niveaux (compte + fouille / peche / expedition / jardin),
//    ressources, difficulte PROPRE au compte (Users.TestMode : surcouche des
//    reglages et du mode, seulement pendant ses requetes), remise a zero en
//    nouveau joueur, une carte de chaque.
//  - Isolation : actions partagees refusees (echanges, dons, encheres, coffre
//    de guilde, chantier, boss, equipes, loterie, codes evenement, marche
//    noir...), pas de fil d'actu ni d'objectif commun, et le compte disparait
//    des listes vues par les autres joueurs (classements, joueurs...).
//   POST /webhook/admin-test-account { discordId, action: 'status' | 'login' | 'set' | 'reset' | 'cards', levels?, resources?, mode? }

import { ok, fail, isAdmin, now, refId, levelForXp } from './common.js';
import { setting, setOverlay } from './settings.js';
import { issueToken } from './auth.js';
import { PRESETS, currentMode, setModeHook } from './presets.js';
import { levelInfo, threshold, MAX_LEVEL } from './levels.js';
import { testAccountId, isTestUser, inTestRequest } from './testuser.js';
import { currentContext } from './context.js';

export const schema = { Users: { TestMode: { type: 'Text' } } };

const SKILLS = {
  dig: { xp: 'DigXP', step: 'DigLevelXpStep', label: 'Fouille' },
  fishing: { xp: 'FishingXP', step: 'FishingLevelXpStep', label: 'Pêche' },
  expedition: { xp: 'ExpeditionXP', step: 'ExpeditionLevelXpStep', label: 'Expédition' },
  garden: { xp: 'GardenXP', step: 'GardenLevelXpStep', label: 'Jardin' }
};
export const RESOURCES = {
  StardustCount: 'Poussières', BoosterCount: 'Jetons booster', KeyCount: 'Clés', BoneCount: 'Os', Worms: 'Vers',
  GoldBait: 'Appâts dorés', SpareParts: 'Pièces détachées', ChestCount: 'Pièces de gatchapon', CatFish: 'Poissons pour Moka',
  DinoSkulls: 'Crânes de dino', GuildCredits: 'Crédits de guilde'
};
// Routes (et actions) qui touchent aux autres joueurs : refusees au compte test.
const BLOCKED = {
  trade: null, auctions: null, contracts: null, 'player-gift': null, 'dog-gift': null, 'duo-expedition': null,
  'guild-chest': ['deposit', 'take', 'free'], 'guild-works': null, 'boss-attack': null, 'community-boss': null, 'community-dig': null,
  teams: ['join', 'leave', 'switch'], wanted: null, lottery: null, 'chaos-vote': null, 'redeem-code': null, 'black-market': ['buy'],
  'profile-wall': null, 'sunday-market': null, 'machine-room': ['vote', 'event-vote'],
  // Registre public des Unique et annonces Discord.
  'unique-counter': ['redeem'], 'share-card': null
};
// Annonce automatique d'un beau tirage sur Discord : ignoree sans erreur.
const SILENT = { 'notify-reveal': { notified: false, skipped: 'test_account' } };
const READS = new Set(['status', 'list', 'view', '']);

// Account XP minimal pour un niveau (inverse de levelForXp).
const accountXpFor = (level) => Math.max(0, Math.ceil(((50 * level - 25) ** 2 - 625) / 100));

function testUser(store) {
  const id = testAccountId(store);
  return id ? store.get('Users', id) : null;
}

function view(store, user) {
  return {
    userId: user.id, pseudo: user.Pseudo, mode: user.TestMode || null, globalMode: currentMode(store).key,
    modes: Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label, icon: p.icon })),
    level: levelForXp(Number(user.XP) || 0), xp: Number(user.XP) || 0,
    skills: Object.fromEntries(Object.entries(SKILLS).map(([k, s]) => [k, { label: s.label, ...levelInfo(user[s.xp], setting(store, s.step)) }])),
    resources: Object.entries(RESOURCES).map(([key, label]) => ({ key, label, value: Number(user[key]) || 0 })),
    cards: store.getAll('Pulls').filter((p) => refId(p.User) === user.id).length
  };
}

// Nouveau joueur : toutes les lignes du compte supprimees, colonnes remises a vide.
function resetUser(store, user) {
  const refs = ['User', 'FromUser', 'ToUser', 'Owner', 'Player'];
  for (const name of store.tables.keys()) {
    if (name === 'Users') continue;
    const cols = store.table(name).columns || {};
    const keys = refs.filter((k) => k in cols);
    if (!keys.length) continue;
    store.getAll(name).filter((r) => keys.some((k) => Number(refId(r[k])) === user.id)).forEach((r) => store.delete(name, r.id));
  }
  const keep = new Set(['id', 'Pseudo', 'DiscordId', 'DiscordUsername', 'DiscordAvatar', 'TestMode']);
  const fields = {};
  const BY_TYPE = { Numeric: 0, Int: 0, Text: '', Bool: false, Choice: '', Ref: 0 };
  for (const [col, def] of Object.entries(store.table('Users').columns || {})) {
    if (keep.has(col)) continue;
    const type = String((def && def.type) || 'Any').split(':')[0];
    // Colonne sans type (Any) : selon la valeur actuelle.
    const cur = user[col];
    fields[col] = type in BY_TYPE ? BY_TYPE[type] : typeof cur === 'number' ? 0 : typeof cur === 'boolean' ? false : typeof cur === 'string' ? '' : null;
  }
  Object.assign(fields, { CreatedAt: now(), BoosterCount: 0, TotalPulls: 0, PullsSinceTopRarity: 0 });
  return store.update('Users', user.id, fields);
}

function handle({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  let user = testUser(store);
  if (!user) return fail('test_account_missing', 404, { id: testAccountId(store) });
  const action = body.action || 'status';
  if (action === 'status') return ok(view(store, user));
  if (action === 'login') return ok({ ...view(store, user), token: issueToken(store, user) });
  if (action === 'reset') { user = resetUser(store, user); return ok({ ...view(store, user), reset: true }); }
  if (action === 'cards') {
    const owned = new Set(store.getAll('Pulls').filter((p) => refId(p.User) === user.id).map((p) => refId(p.Card)));
    const cards = store.getAll('Cards').filter((c) => c.Active && !c.IsSecret && !c.IsPromo && !owned.has(c.id));
    cards.forEach((c) => store.create('Pulls', { User: user.id, Card: c.id, SerialNumber: 0, Finish: 'normal', Quality: 'good', ObtainedAt: now(), BatchId: `test-account-${Date.now()}` }));
    return ok({ ...view(store, user), given: cards.length });
  }
  if (action !== 'set') return fail('unknown_action');
  const fields = {};
  const lv = body.levels || {};
  if (lv.account != null) fields.XP = accountXpFor(Math.max(1, Math.min(200, Math.floor(Number(lv.account)) || 1)));
  for (const [k, s] of Object.entries(SKILLS)) {
    if (lv[k] == null) continue;
    const L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(lv[k])) || 1));
    fields[s.xp] = threshold(L, setting(store, s.step));
  }
  for (const [k, v] of Object.entries(body.resources || {})) {
    if (!(k in RESOURCES)) return fail('unknown_resource', 400, { key: k });
    fields[k] = Math.max(0, Math.floor(Number(v)) || 0);
  }
  if (body.mode !== undefined) {
    if (body.mode && !PRESETS[body.mode]) return fail('unknown_preset');
    fields.TestMode = body.mode || '';
  }
  user = store.update('Users', user.id, fields);
  return ok(view(store, user));
}

// Difficulte propre au compte test : valeurs du preset choisi, seulement
// pendant ses requetes (les autres joueurs gardent le mode global).
const testMode = (store) => {
  if (!inTestRequest(store)) return null;
  const u = store.get('Users', currentContext().userId);
  return u && u.TestMode && PRESETS[u.TestMode] ? u.TestMode : null;
};
setOverlay((store, key) => {
  const m = testMode(store);
  if (!m) return undefined;
  const v = PRESETS[m].values[key];
  return v !== undefined ? v : undefined;
});
export const modeOverride = (store) => { const m = testMode(store); return m ? { key: m, label: PRESETS[m].label, icon: PRESETS[m].icon, custom: false, test: true } : null; };
setModeHook(modeOverride);

// Actions partagees refusees au compte test.
export function denied(store, path, body = {}) {
  if (!isTestUser(store, body.userId || body.fromUserId)) return null;
  if (SILENT[path]) return ok(SILENT[path]);
  if (!(path in BLOCKED)) return null;
  const actions = BLOCKED[path];
  const act = String(body.action || '');
  if (actions ? actions.includes(act) : !READS.has(act)) return fail('test_account_isolated', 403);
  return null;
}
export function beforeWorkflow({ store, path, request }) { return denied(store, path, request.body || {}); }

// Listes vues par les autres : on retire les entrees du compte test.
export function scrub(store, json, requesterId) {
  const id = testAccountId(store);
  if (!id || Number(requesterId) === id || !json || typeof json !== 'object') return json;
  const u = store.get('Users', id);
  const pseudo = u && u.Pseudo;
  const isTest = (o) => o && typeof o === 'object' && !Array.isArray(o) && (Number(o.userId) === id || (o.user != null && Number(o.user) === id) || (pseudo && (o.pseudo === pseudo || o.Pseudo === pseudo) && (o.userId == null || Number(o.userId) === id)));
  const walk = (v, depth) => {
    if (depth > 6 || !v || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      const out = v.filter((x) => !isTest(x));
      for (const x of out) walk(x, depth + 1);
      if (out.length !== v.length) { v.length = 0; v.push(...out); }
      return v;
    }
    for (const k of Object.keys(v)) walk(v[k], depth + 1);
    return v;
  };
  return walk(json, 0);
}

export const routes = { 'POST admin-test-account': handle };
