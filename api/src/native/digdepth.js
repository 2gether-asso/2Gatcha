// Fouille v2 (2026-10-18) : grilles 4x8, 5 profondeurs, mineraux.
//  - Profondeurs (reglage DigDepths) : debloquees par le niveau de fouille ;
//    plus on descend, plus les tresors sont epars (grille plus dure), mais les
//    cartes sont plus rares (cardShift) et les mineraux plus precieux
//    (mineralMax). Le choix est garde dans Users.DigDepth ; changer de
//    profondeur repart sur une grille neuve. Le workflow dig recoit la
//    profondeur et ses tresors (body.depthCfg) et renvoie mineralTier /
//    dogReport.minerals ; ce module credite les mineraux (Users.Minerals).
//  - Mineraux : 23, en 5 paliers (images site/assets/Fouille). Comptoir du
//    marche noir : revente en poussieres (MineralValues) ou echanges contre
//    des ressources (MineralTrades).
//   POST /webhook/dig { action: 'setDepth', depth }      (court-circuite le workflow)
//   POST /webhook/minerals { userId, action: 'status' | 'sell' | 'trade', key?, count?, index? }

import { ok, fail, userById, parseJson, now } from './common.js';
import { setting, rawSetting, setSettings } from './settings.js';
import { levelInfo } from './levels.js';
import { visualLabel } from './visuals.js';

export const schema = { Users: { DigDepth: { type: 'Numeric' }, Minerals: { type: 'Text' } } };

export const MINERALS = [
  { key: 'calcaire', name: 'Calcaire', tier: 1, img: 'Calcaire.PNG' },
  { key: 'bronze', name: 'Bronze', tier: 1, img: 'Bronze.png' },
  { key: 'etain', name: 'Étain', tier: 1, img: 'Etain.png' },
  { key: 'fer', name: 'Fer', tier: 1, img: 'Fer.PNG' },
  { key: 'agathe', name: 'Agathe', tier: 1, img: 'Agathe.PNG' },
  { key: 'ambre', name: 'Ambre', tier: 2, img: 'Ambre.PNG' },
  { key: 'fluorite', name: 'Fluorite', tier: 2, img: 'Fluorite.PNG' },
  { key: 'turquoise', name: 'Turquoise', tier: 2, img: 'Turquoise.PNG' },
  { key: 'azurite', name: 'Azurite', tier: 2, img: 'Azurite.PNG' },
  { key: 'amazonite', name: 'Amazonite', tier: 2, img: 'Amazonite.png' },
  { key: 'amethyste', name: 'Améthyste', tier: 3, img: 'Ametyste.png' },
  { key: 'grenat', name: 'Grenat', tier: 3, img: 'Grenat.png' },
  { key: 'lapis', name: 'Lapis-lazuli', tier: 3, img: 'Lapis.png' },
  { key: 'celestite', name: 'Célestite', tier: 3, img: 'Célestite.PNG' },
  { key: 'titane', name: 'Titane', tier: 3, img: 'Titane.png' },
  { key: 'or', name: 'Or', tier: 4, img: 'Or.PNG' },
  { key: 'obsidienne', name: 'Obsidienne', tier: 4, img: 'Obsidienne.png' },
  { key: 'emeraude', name: 'Émeraude', tier: 4, img: 'Emeraude.PNG' },
  { key: 'tanzanite', name: 'Tanzanite', tier: 4, img: 'Tanzanite.png' },
  { key: 'rubis', name: 'Rubis', tier: 5, img: 'Rubis.PNG' },
  { key: 'saphir', name: 'Saphir', tier: 5, img: 'Saphir.png' },
  { key: 'diamant', name: 'Diamant', tier: 5, img: 'Diamant.png' },
  { key: 'infernite', name: 'Infernite', tier: 5, img: 'Infernite.png' }
];
const BY_KEY = new Map(MINERALS.map((m) => [m.key, m]));
export const TIER_NAMES = ['Commun', 'Peu commun', 'Rare', 'Précieux', 'Légendaire'];
// Ressources qu'un echange peut donner (liste blanche).
const TRADE_FIELDS = { BoneCount: ['os', 'os'], KeyCount: ['clé', 'clés'], ChestCount: ['pièce de gatchapon', 'pièces de gatchapon'], BoosterCount: ['jeton booster', 'jetons booster'], Worms: ['ver', 'vers'], GoldBait: ['appât doré', 'appâts dorés'], SpareParts: ['pièce détachée', 'pièces détachées'] };
const tradeLabel = (k, v) => `${v} ${TRADE_FIELDS[k] ? TRADE_FIELDS[k][v > 1 ? 1 : 0] : k}`;

const digLevelOf = (store, user) => levelInfo(user.DigXP, setting(store, 'DigLevelXpStep')).level;
export const mineralsOf = (user) => parseJson(user && user.Minerals, {}) || {};

export function depthsOf(store, user) {
  const lvl = digLevelOf(store, user);
  return setting(store, 'DigDepths').map((d, i) => ({ depth: i + 1, label: d.label, icon: d.icon || '⛏️', level: Math.max(1, Number(d.level) || 1), unlocked: lvl >= (Number(d.level) || 1) }));
}
export function currentDepth(store, user) {
  const depths = depthsOf(store, user);
  const want = Math.max(1, Math.floor(Number(user.DigDepth) || 1));
  const ok_ = depths.filter((d) => d.unlocked);
  return (ok_.find((d) => d.depth === want) || ok_[ok_.length - 1] || depths[0] || { depth: 1 }).depth;
}

function pickMineral(tier) {
  const pool = MINERALS.filter((m) => m.tier === tier);
  return pool[Math.floor(Math.random() * pool.length)] || MINERALS[0];
}
let labelStore = null;
const view = (m) => ({ key: m.key, name: labelStore ? visualLabel(labelStore, 'Fouille/' + m.img, m.name) : m.name, tier: m.tier, img: 'Fouille/' + m.img });

function depthState(store, user) {
  const depth = currentDepth(store, user);
  const owned = mineralsOf(user);
  return { depth, depths: depthsOf(store, user), minerals: Object.values(owned).reduce((s, n) => s + (Number(n) || 0), 0) };
}

export function beforeWorkflow({ store, path, request }) {
  labelStore = store;
  if (path !== 'dig') return null;
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user) return null;
  if (body.action === 'setDepth') {
    const want = Math.floor(Number(body.depth));
    const d = depthsOf(store, user).find((x) => x.depth === want);
    if (!d) return { status: 400, json: { error: 'unknown_depth' } };
    if (!d.unlocked) return { status: 400, json: { error: 'depth_locked', level: d.level } };
    const fresh = store.update('Users', user.id, { DigDepth: want, DigBoardState: '' });
    return { status: 200, json: { ok: true, digDepth: depthState(store, fresh) } };
  }
  const depth = currentDepth(store, user);
  const cfg = setting(store, 'DigDepths')[depth - 1] || {};
  request.body = { ...request.body, depthCfg: JSON.stringify({ depth, treasures: cfg.treasures || [], cardShift: Number(cfg.cardShift) || 0, mineralMax: Math.min(5, Math.max(1, Number(cfg.mineralMax) || 1)) }), maxEnergyBase: setting(store, 'DigMaxEnergy') };
  return null;
}

export function afterWorkflow({ store, path, request, response }) {
  labelStore = store;
  if (path !== 'dig' || response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  const body = request.body || {};
  if (body.action === 'setDepth') return;
  let user = store.get('Users', Number(body.userId));
  if (!user) return;
  const json = response.json;
  const owned = mineralsOf(user);
  const add = (tier) => { const m = pickMineral(Math.min(5, Math.max(1, Number(tier) || 1))); owned[m.key] = (Number(owned[m.key]) || 0) + 1; return view(m); };
  let changed = false;
  if (json.mineralTier) { json.mineral = add(json.mineralTier); changed = true; }
  if (json.dogReport && Array.isArray(json.dogReport.minerals) && json.dogReport.minerals.length) {
    json.dogReport.mineralItems = json.dogReport.minerals.map(add);
    changed = true;
  }
  if (changed) user = store.update('Users', user.id, { Minerals: JSON.stringify(owned) });
  json.digDepth = depthState(store, user);
}

function mineralsView(store, user) {
  const owned = mineralsOf(user);
  const values = setting(store, 'MineralValues');
  return {
    minerals: MINERALS.map((m) => ({ ...view(m), count: Number(owned[m.key]) || 0, value: Number(values[m.tier - 1]) || 0 })),
    tiers: TIER_NAMES.map((name, i) => ({ tier: i + 1, name, value: Number(values[i]) || 0, owned: MINERALS.filter((m) => m.tier === i + 1).reduce((s, m) => s + (Number(owned[m.key]) || 0), 0) })),
    trades: setting(store, 'MineralTrades').map((t, i) => ({ index: i, tier: Number(t.tier), n: Number(t.n), give: t.give, label: Object.entries(t.give || {}).map(([k, v]) => tradeLabel(k, Number(v))).join(' + ') })),
    stardust: Number(user.StardustCount) || 0
  };
}

// Retire n mineraux d'un palier (les plus nombreux d'abord).
function takeTier(owned, tier, n) {
  const pool = MINERALS.filter((m) => m.tier === tier).map((m) => m.key).sort((a, b) => (Number(owned[b]) || 0) - (Number(owned[a]) || 0));
  let left = n;
  for (const k of pool) { const take = Math.min(left, Number(owned[k]) || 0); owned[k] = (Number(owned[k]) || 0) - take; left -= take; if (!left) break; }
  return left === 0;
}

function handleMinerals({ store, body }) {
  labelStore = store;
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(mineralsView(store, user));
  const owned = mineralsOf(user);
  if (action === 'sell') {
    const m = BY_KEY.get(String(body.key));
    if (!m) return fail('unknown_mineral');
    const n = Math.max(1, Math.floor(Number(body.count) || 1));
    if ((Number(owned[m.key]) || 0) < n) return fail('not_enough_minerals', 400, mineralsView(store, user));
    const gain = n * (Number(setting(store, 'MineralValues')[m.tier - 1]) || 0);
    owned[m.key] -= n;
    user = store.update('Users', user.id, { Minerals: JSON.stringify(owned), StardustCount: (Number(user.StardustCount) || 0) + gain });
    return ok({ ...mineralsView(store, user), sold: { key: m.key, name: m.name, count: n, dust: gain }, newStardust: user.StardustCount });
  }
  if (action === 'trade') {
    const t = setting(store, 'MineralTrades')[Math.floor(Number(body.index))];
    if (!t) return fail('unknown_trade');
    if (!takeTier(owned, Number(t.tier), Number(t.n))) return fail('not_enough_minerals', 400, mineralsView(store, user));
    const fields = { Minerals: JSON.stringify(owned) };
    for (const [k, v] of Object.entries(t.give || {})) if (TRADE_FIELDS[k] && Number(v) > 0) fields[k] = (Number(user[k]) || 0) + Number(v);
    user = store.update('Users', user.id, fields);
    return ok({ ...mineralsView(store, user), traded: t.give, newBoosterCount: user.BoosterCount });
  }
  return fail('unknown_action');
}

// Une seule fois : energie de fouille 5 -> 10 et Milo excite 15 -> 8 grilles
// (grilles deux fois plus grandes), seulement si les valeurs etaient celles d'origine.
export function init({ store }) {
  if (!store.tables.has('AppSettings') || store.getAll('AppSettings').some((r) => r.Key === 'dig-v2-2026-10-18')) return;
  const values = {};
  if (Number(rawSetting(store, 'DigMaxEnergy')) === 5) values.DigMaxEnergy = 10;
  if (Number(rawSetting(store, 'DogFrenzyBoards')) === 15) values.DogFrenzyBoards = 8;
  if (Object.keys(values).length) setSettings(store, values);
  store.create('AppSettings', { Key: 'dig-v2-2026-10-18', Value: JSON.stringify({ at: now(), values }) });
}

export const routes = { 'POST minerals': handleMinerals };
