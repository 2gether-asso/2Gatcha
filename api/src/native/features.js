// Fonctionnalites et pages ouvertes selon le mode de jeu (2026-10-14).
// Une matrice { fonctionnalite: [modes ou elle est fermee] } choisie dans
// Admin > Economie. Quand une fonctionnalite est fermee dans le mode en cours :
//  - le site masque ses onglets, widgets et liens (hide) et affiche un
//    message a la place des pages fermees (page) ;
//  - l'API refuse ses ECRITURES (lectures permises : les widgets ne cassent
//    pas) avec { error: 'feature_disabled' } ;
//  - "Que faire maintenant ?" ne la suggere plus (urls, nudges).
// Bingo (refonte 2026-11) : dans la liste, ouvert partout par defaut.
//   POST /webhook/admin-mode-features { discordId, action: 'status' | 'set', matrix? }

import { ok, fail, isAdmin, now } from './common.js';
import { currentMode, MODE_KEYS } from './presets.js';
import { chaosRule } from './modeextras.js';
import { stormClosed, stormState } from './moderules.js';

const MODES = MODE_KEYS;
const KEY = 'modeFeatures';

// group : titre de la colonne dans l'admin. off : modes fermes par defaut
// (Medium = reference, tout ouvert).
export const FEATURES = [
  // Pages entieres
  { key: 'shop', group: 'Pages', icon: '🛍️', label: 'Boutique (page)', page: 'boutique.html', paths: ['shop', 'booster-shop', 'sunday-market'], hide: ['a[href^="boutique.html"]'], urls: ['boutique.html'], off: [] },
  { key: 'vault', group: 'Pages', icon: '🔒', label: 'Coffre-fort perso (page)', page: 'coffre.html', paths: ['personal-vault'], hide: ['a[href^="coffre.html"]'], urls: ['coffre.html'], off: [] },
  { key: 'trade', group: 'Pages', icon: '🔄', label: 'Échanges (page)', page: 'trade.html', paths: ['trade', 'trade-matches'], hide: ['a[href^="trade.html"]'], urls: ['trade.html'], off: [] },
  // Jeux
  { key: 'dig', group: 'Jeux', icon: '⛏️', label: 'Fouille', paths: ['dig', 'community-dig'], hide: ['#tab-dig-btn'], urls: ['jeux.html#fouille'], nudges: ['dig', 'dig-some'], off: [] },
  { key: 'guess', group: 'Jeux', icon: '❓', label: 'Devine la carte', paths: ['guess-card'], hide: ['#tab-guess-btn'], urls: ['jeux.html#devine'], nudges: ['guess'], off: [] },
  { key: 'expedition', group: 'Jeux', icon: '🧭', label: 'Expédition', paths: ['expedition'], hide: ['#tab-expedition-btn'], urls: ['jeux.html#expedition'], nudges: ['expedition', 'expedition-start'], off: [] },
  { key: 'fishing', group: 'Jeux', icon: '🎣', label: 'Pêche', paths: ['fishing', 'fishing-tournament'], hide: ['#tab-fish-btn'], urls: ['jeux.html#peche'], nudges: ['fishing'], off: [] },
  { key: 'archeo', group: 'Jeux', icon: '🏺', label: 'Archéologie', paths: ['archeo'], hide: ['#tab-archeo-btn'], urls: ['jeux.html#archeologie'], off: [] },
  { key: 'bingo', group: 'Jeux', icon: '🎱', label: 'Bingo du mois', paths: ['bingo'], hide: ['#tab-bingo-btn'], urls: ['jeux.html#bingo'], off: [] },
  { key: 'dinos', group: 'Jeux', icon: '🦖', label: 'Dinos de compagnie', paths: ['dino'], hide: ['#tab-dino-btn'], urls: ['jeux.html#dinos'], nudges: ['dino-hungry', 'dino-poop', 'dino-skull'], off: [] },
  { key: 'garden', group: 'Jeux', icon: '🌱', label: 'Jardin', paths: ['garden'], hide: ['#tab-garden-btn'], urls: ['jeux.html#jardin'], nudges: ['garden', 'garden-plant'], off: [] },
  // Communaute
  { key: 'boss', group: 'Communauté', icon: '💀', label: 'Boss commun', paths: ['community-boss', 'boss-attack'], hide: ['#tab-boss-btn'], urls: ['communaute.html#boss'], off: [] },
  { key: 'guildChest', group: 'Communauté', icon: '🎁', label: 'Coffre de guilde', paths: ['guild-chest'], hide: ['#tab-chest-btn'], urls: ['communaute.html#coffre'], off: [] },
  { key: 'blackMarket', group: 'Communauté', icon: '🌑', label: 'Marché noir', paths: ['black-market'], hide: ['#tab-market-btn'], urls: ['communaute.html#marche'], off: ['cool'] },
  { key: 'auctions', group: 'Communauté', icon: '🔨', label: 'Enchères', paths: ['auctions'], hide: ['#tab-auctions-btn'], urls: ['communaute.html#encheres'], nudges: ['outbid'], off: ['cool', 'chill'] },
  { key: 'machine', group: 'Communauté', icon: '⚙️', label: 'Salle des machines', paths: ['machine-room'], hide: ['#tab-machine-btn'], urls: ['communaute.html#machines'], off: [] },
  { key: 'teams', group: 'Communauté', icon: '🏳️', label: 'Guerre des équipes', paths: ['teams'], hide: ['#tab-teams-btn'], urls: ['communaute.html#equipes'], off: [] },
  { key: 'lottery', group: 'Communauté', icon: '🎟️', label: 'Loterie du dimanche', paths: ['lottery'], hide: ['#board-lottery'], off: [] },
  { key: 'wanted', group: 'Communauté', icon: '📜', label: 'Avis de recherche', paths: ['wanted'], hide: ['#board-wanted'], off: [] },
  { key: 'duo', group: 'Jeux', icon: '👯', label: 'Expédition en duo', paths: ['duo-expedition'], hide: ['#duo-expedition'], off: [] },
  { key: 'seasonal', group: 'Quotidien', icon: '🎃', label: 'Cadeau saisonnier du jour', paths: ['seasonal'], hide: ['#seasonal-treat'], off: [] },
  // Collection
  { key: 'altar', group: 'Collection', icon: '🔥', label: 'Autel des sacrifices', paths: ['altar-sacrifice'], hide: ['.coll-mode[data-mode="altar"]'], off: [] },
  { key: 'finish', group: 'Collection', icon: '🌈', label: 'Finitions (amélioration, relance)', paths: ['foil-upgrade', 'finish-reroll'], hide: ['.coll-mode[data-mode="finish"]'], off: [] },
  { key: 'quality', group: 'Collection', icon: '🧽', label: 'Restauration de qualité', paths: ['card-quality-repair'], hide: ['.coll-mode[data-mode="quality"]'], off: [] },
  // Rendez-vous quotidiens et boutique
  { key: 'wheel', group: 'Quotidien', icon: '🎡', label: 'Roue du jour', paths: ['daily-wheel'], hide: ['#wheel-panel'], nudges: ['wheel'], off: [] },
  { key: 'dailyBox', group: 'Quotidien', icon: '📦', label: 'Boîte du jour', paths: ['daily-box'], hide: ['#today-box'], nudges: ['box'], off: [] },
  { key: 'dailyDice', group: 'Quotidien', icon: '🎲', label: 'Dé du jour', paths: ['daily-dice'], hide: ['#today-dice'], nudges: ['dice'], off: [] },
  { key: 'evening', group: 'Quotidien', icon: '🌙', label: 'Missions du soir', paths: ['evening'], hide: ['#evening-block'], nudges: ['evening', 'evening-claim'], off: [] },
  { key: 'welcomeBack', group: 'Quotidien', icon: '🎁', label: 'Colis de retour', paths: ['welcome-back'], hide: [], nudges: ['welcome'], off: ['hard'] },
  { key: 'boosterShop', group: 'Quotidien', icon: '🃏', label: 'Jetons booster de la semaine (achat)', paths: ['booster-shop'], hide: ['#offres'], off: ['hard'] },
  { key: 'sundayMarket', group: 'Quotidien', icon: '☀️', label: 'Marché du dimanche', paths: ['sunday-market'], hide: ['#dimanche'], off: ['hard'] },
  { key: 'playerGift', group: 'Quotidien', icon: '💌', label: 'Cadeaux entre joueurs', paths: ['player-gift'], hide: [], off: [] }
];
const READ_ACTIONS = new Set(['status', 'list', 'get']);

function storedMatrix(store) {
  if (!store.tables.has('AppSettings')) return null;
  const row = store.getAll('AppSettings').find((r) => r.Key === KEY);
  try { return row ? JSON.parse(row.Value) : null; } catch (e) { return null; }
}
// { fonctionnalite: [modes fermes] } : valeurs enregistrees, sinon par defaut.
export function matrix(store) {
  const saved = storedMatrix(store) || {};
  return Object.fromEntries(FEATURES.map((f) => [f.key, Array.isArray(saved[f.key]) ? saved[f.key].filter((m) => MODES.includes(m)) : f.off]));
}

let cache = { at: 0, store: null, mode: null, off: null };
// Fonctionnalites fermees dans le mode en cours (cache 30 s, vide apres un 'set'),
// plus celles fermees par la regle du jour en mode Chaos.
export function disabled(store) {
  const t = Date.now();
  const rule = chaosRule(store);
  const storm = stormClosed(store);
  const mode = currentMode(store).key + (rule ? ':' + rule.key : '') + (storm.length ? ':storm-' + storm.join() : '');
  if (cache.store === store && cache.mode === mode && t - cache.at < 30000) return cache.off;
  const m = matrix(store);
  const ruleOff = new Set(rule && rule.off ? rule.off : []);
  const off = FEATURES.filter((f) => (m[f.key] || []).includes(currentMode(store).key) || ruleOff.has(f.key) || storm.includes(f.key));
  cache = { at: t, store, mode, off };
  return off;
}

// Vue publique (event-status -> gameMode.off) : de quoi masquer cote site.
export function publicView(store) {
  return disabled(store).map((f) => ({ key: f.key, label: f.label, icon: f.icon, page: f.page || null, hide: f.hide }));
}

// Suggestion de "Que faire maintenant ?" vers une fonctionnalite fermee ?
export function nudgeOff(store, item) {
  return disabled(store).some((f) => (f.nudges || []).includes(item.key) || (f.urls || []).some((u) => String(item.url || '').startsWith(u)));
}

// Quetes (2026-10-25) : un objectif n'est propose (defis de la semaine,
// missions du soir, quetes de saison, bingo du mois suivant) que s'il est
// realisable maintenant : fonctionnalite ouverte dans le mode en cours, boss
// commun en vie pour les objectifs de boss.
const QUEST_FEATURE = {
  fish: 'fishing', 'fishCatch:chest': 'fishing', 'fishCatch:part': 'fishing', dig: 'dig', board: 'dig', treasure: 'dig',
  harvest: 'garden', guess: 'guess', expedition: 'expedition', wheel: 'wheel', tradeDone: 'trade', tradeProposed: 'trade',
  bossAttack: 'boss', repair: 'quality', fusion: 'finish', lotteryTicket: 'lottery', wantedDonate: 'wanted', duoDone: 'duo',
  machineDone: 'machine', vaultRow: 'vault', tablet: 'archeo'
};
export function questTypeOpen(store, type) {
  if (type === 'bossAttack' && !(store.tables.has('CommunityBoss') && store.getAll('CommunityBoss').some((b) => b.Active && (Number(b.CurrentHp) || 0) > 0))) return false;
  const key = QUEST_FEATURE[type];
  return !key || !disabled(store).some((f) => f.key === key);
}

// Ecriture vers une fonctionnalite fermee : la reponse de refus, sinon null.
export function gate(store, method, path, body = {}) {
  if (method === 'GET' || READ_ACTIONS.has(body.action) || body.discordId) return null;
  const f = disabled(store).find((x) => x.paths.includes(path));
  if (!f) return null;
  const mode = currentMode(store);
  const storm = stormState(store);
  if (storm && storm.active && storm.feature === f.key) return fail('feature_disabled', 403, { feature: f.key, label: f.label, mode: mode.key, storm: true, message: `⛈️ Tempête : ${storm.label} est fermée jusqu’à ${storm.to} h.` });
  return fail('feature_disabled', 403, { feature: f.key, label: f.label, mode: mode.key, message: `Fermé en mode ${mode.label} : ${f.label.replace(/\s*\(.*\)$/, '')}.` });
}
export function beforeWorkflow({ store, path, request }) {
  return gate(store, 'POST', path, request.body || {});
}

function status(store) {
  const m = matrix(store);
  return {
    modes: MODES, current: currentMode(store).key, saved: !!storedMatrix(store),
    features: FEATURES.map((f) => ({ key: f.key, group: f.group, icon: f.icon, label: f.label, page: !!f.page, off: m[f.key], defaultOff: f.off }))
  };
}

function handleAdmin({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const action = body.action || 'status';
  if (action === 'status') return ok(status(store));
  if (action === 'reset' || action === 'set') {
    const row = store.getAll('AppSettings').find((r) => r.Key === KEY);
    if (action === 'reset') { if (row) store.delete('AppSettings', row.id); }
    else {
      const input = body.matrix && typeof body.matrix === 'object' ? body.matrix : null;
      if (!input) return fail('invalid_matrix');
      const clean = Object.fromEntries(FEATURES.map((f) => [f.key, Array.isArray(input[f.key]) ? [...new Set(input[f.key].filter((x) => MODES.includes(x)))] : matrix(store)[f.key]]));
      const value = JSON.stringify({ ...clean, _at: now(), _by: String(body.discordId) });
      if (row) store.update('AppSettings', row.id, { Value: value }); else store.create('AppSettings', { Key: KEY, Value: value });
    }
    cache = { at: 0, store: null, mode: null, off: null };
    return ok(status(store));
  }
  return fail('unknown_action');
}

export function _reset() { cache = { at: 0, store: null, mode: null, off: null }; }
export const routes = { 'POST admin-mode-features': handleAdmin };
