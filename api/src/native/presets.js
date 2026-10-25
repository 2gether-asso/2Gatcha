// Mode Cool (2026-10-14) : le plus genereux, pour jouer sans aucune
// frustration. Le mode en cours est public (event-status -> gameMode) : le
// site colore la barre de menu et anime le logo selon le mode.
// Modes de jeu (2026-10-11) : trois presets Chill / Medium / Hard qui
// reglent d'un coup tout ce qui cree ou detruit des boosters et des
// poussieres. Medium = valeurs par defaut actuelles. L'admin choisit selon
// l'inflation (recommandation calculee a partir du journal de l'economie).
// Un reglage modifie a la main ensuite -> mode "personnalise".
//   POST /webhook/admin-preset { discordId, action: 'status' | 'apply', preset?, announce? }

import { ok, fail, isAdmin, now } from './common.js';
import { rawSetting as setting, setSettings, REGISTRY, validateSetting } from './settings.js';
import { flows, boosterTarget } from './economy.js';
import { isTight, priceMultiplier } from './inflation.js';
import { addFeed } from './feed.js';

const KEY = 'gamePreset';

// Tables de peche : celle par defaut avec d'autres poids de boosters et d'os.
const loot = (key, weights) => REGISTRY[key].def.map((x) => (weights[x.type] != null ? { ...x, weight: weights[x.type] } : x));

const PRESETS = {
  cool: {
    label: 'Cool', icon: '😎', desc: 'Détente totale : beaucoup de boosters, tout est moins cher, aucune frustration. Pour les vacances, les fêtes ou relancer le serveur.',
    values: {
      DigBoosterKeepChance: 1, DigRegenSeconds: 180, DigFullRewardsPerDay: 100, DogBonesPerDay: 10, DogBoosterDust: 80, DogBoneCost: 150,
      FishingLoot: loot('FishingLoot', { booster: 9, bone: 16 }), DeepFishingLoot: loot('DeepFishingLoot', { booster: 8, bone: 10 }), FishingFullRewardsPerDay: 30,
      DailyQuestRewardBoosters: 2, WeeklyQuestRewardBoosters: 6,
      DuplicateDustCommon: 5, DuplicateDustOther: 10, DuplicateDustCapCopies: 10, ExchangeRateSwing: 0.1,
      BoosterShopPrice: 250, BoosterShopIncrease: 0.15, BoosterShopWeeklyCap: 6, BoosterShopDailyGrowth: 1.2, ShopItemGrowth: 1.15,
      TradeTaxPerCard: 5, AuctionTaxPct: 0.05, ChestCost: 60, WeatherRerollCost: 40, ExpeditionRushCost: 60,
      RarityPityMultiplier: 1.5, PriceIndexMax: 1.5, AutoTightDays: 14,
      ShardsPerBooster: 6, ShardsDailyCap: 10, RipenMaxPoints: 5, GardenWiltHours: 72
    }
  },
  chill: {
    label: 'Chill', icon: '🌴', desc: 'Généreux : plus de boosters, prix et taxes plus doux. Pour relancer l’activité ou fêter un événement.',
    values: {
      DigBoosterKeepChance: 0.8, DigRegenSeconds: 300, DigFullRewardsPerDay: 60, DogBonesPerDay: 6, DogBoosterDust: 60, DogBoneCost: 200,
      FishingLoot: loot('FishingLoot', { booster: 6, bone: 12 }), DeepFishingLoot: loot('DeepFishingLoot', { booster: 6, bone: 8 }), FishingFullRewardsPerDay: 20,
      DailyQuestRewardBoosters: 2, WeeklyQuestRewardBoosters: 5,
      DuplicateDustCommon: 4, DuplicateDustOther: 8, DuplicateDustCapCopies: 8, ExchangeRateSwing: 0.2,
      BoosterShopPrice: 350, BoosterShopIncrease: 0.25, BoosterShopWeeklyCap: 4, BoosterShopDailyGrowth: 1.25, ShopItemGrowth: 1.2,
      TradeTaxPerCard: 10, AuctionTaxPct: 0.1, ChestCost: 80, WeatherRerollCost: 60, ExpeditionRushCost: 90,
      RarityPityMultiplier: 2, PriceIndexMax: 2, AutoTightDays: 10,
      ShardsPerBooster: 8, ShardsDailyCap: 8, RipenMaxPoints: 4, GardenWiltHours: 36
    }
  },
  medium: {
    label: 'Medium', icon: '⚖️', desc: 'Équilibré : environ 5 boosters par jour pour un joueur actif, la complétion demande plusieurs mois.',
    values: {
      DigBoosterKeepChance: 0.5, DigRegenSeconds: 600, DigFullRewardsPerDay: 40, DogBonesPerDay: 4, DogBoosterDust: 40, DogBoneCost: 250,
      FishingLoot: loot('FishingLoot', { booster: 3, bone: 8 }), DeepFishingLoot: loot('DeepFishingLoot', { booster: 4, bone: 6 }), FishingFullRewardsPerDay: 15,
      DailyQuestRewardBoosters: 1, WeeklyQuestRewardBoosters: 3,
      DuplicateDustCommon: 3, DuplicateDustOther: 6, DuplicateDustCapCopies: 5, ExchangeRateSwing: 0.3,
      BoosterShopPrice: 450, BoosterShopIncrease: 0.35, BoosterShopWeeklyCap: 3, BoosterShopDailyGrowth: 1.3, ShopItemGrowth: 1.25,
      TradeTaxPerCard: 15, AuctionTaxPct: 0.15, ChestCost: 100, WeatherRerollCost: 80, ExpeditionRushCost: 120,
      RarityPityMultiplier: 2.5, PriceIndexMax: 2.5, AutoTightDays: 7,
      ShardsPerBooster: 10, ShardsDailyCap: 6, RipenMaxPoints: 3, GardenWiltHours: 24
    }
  },
  hard: {
    label: 'Hard', icon: '🔥', desc: 'Serré : peu de boosters, prix et taxes élevés. Pour casser une inflation qui s’installe.',
    values: {
      DigBoosterKeepChance: 0.3, DigRegenSeconds: 900, DigFullRewardsPerDay: 30, DogBonesPerDay: 2, DogBoosterDust: 30, DogBoneCost: 320,
      FishingLoot: loot('FishingLoot', { booster: 2, bone: 6 }), DeepFishingLoot: loot('DeepFishingLoot', { booster: 3, bone: 4 }), FishingFullRewardsPerDay: 10,
      DailyQuestRewardBoosters: 1, WeeklyQuestRewardBoosters: 2,
      DuplicateDustCommon: 2, DuplicateDustOther: 4, DuplicateDustCapCopies: 3, ExchangeRateSwing: 0.4,
      BoosterShopPrice: 600, BoosterShopIncrease: 0.5, BoosterShopWeeklyCap: 2, BoosterShopDailyGrowth: 1.45, ShopItemGrowth: 1.35,
      TradeTaxPerCard: 20, AuctionTaxPct: 0.2, ChestCost: 140, WeatherRerollCost: 110, ExpeditionRushCost: 160,
      RarityPityMultiplier: 3, PriceIndexMax: 3, AutoTightDays: 5,
      ShardsPerBooster: 12, ShardsDailyCap: 4, RipenMaxPoints: 2, GardenWiltHours: 18
    }
  }
};

// Chaos (2026-10-15) : reglages du Medium + une regle tiree chaque jour (modeextras.js).
PRESETS.chaos = {
  label: 'Chaos', icon: '👾', desc: 'Imprévisible : base Medium, mais chaque jour une règle tirée au hasard change le jeu (pêche à moitié prix, doublons ×2, marché noir fermé…).',
  values: { ...PRESETS.medium.values }
};
// Valeurs par difficulte modifiables dans l'admin (2026-10-18) : AppSettings
// 'presetOverrides' = { mode : { reglage : valeur | null } } fusionne sur les
// valeurs du code (null = le mode ne touche plus a ce reglage). Les valeurs
// effectives sont ecrites DANS PRESETS[mode].values : tout le code qui lit les
// presets (application d'un mode, detection du mode en cours, compte test,
// Admin > Difficultes) voit les memes valeurs.
const OVERRIDES_KEY = 'presetOverrides';
const BASE = Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, JSON.parse(JSON.stringify(p.values))]));
export function overridesOf(store) {
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === OVERRIDES_KEY) : null;
  try { const v = row ? JSON.parse(row.Value) : {}; return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}
export function refreshOverrides(store) {
  const o = overridesOf(store);
  for (const [mode, p] of Object.entries(PRESETS)) {
    const values = JSON.parse(JSON.stringify(BASE[mode]));
    for (const [k, v] of Object.entries(o[mode] || {})) { if (!REGISTRY[k]) continue; if (v === null) delete values[k]; else values[k] = v; }
    p.values = values;
  }
  modeCache = { at: 0, store: null, value: null };
}
function saveOverrides(store, o) {
  const row = store.getAll('AppSettings').find((r) => r.Key === OVERRIDES_KEY);
  const value = JSON.stringify(o);
  if (row) store.update('AppSettings', row.id, { Value: value }); else store.create('AppSettings', { Key: OVERRIDES_KEY, Value: value });
  refreshOverrides(store);
}
function overridesView(store) {
  const o = overridesOf(store);
  const cur = status(store).current;
  return {
    current: cur,
    modes: Object.entries(PRESETS).map(([key, p]) => ({
      key, label: p.label, icon: p.icon, current: key === cur,
      values: Object.entries(p.values).map(([k, v]) => ({ key: k, label: REGISTRY[k].label, group: REGISTRY[k].group, type: REGISTRY[k].type, min: REGISTRY[k].min, max: REGISTRY[k].max, step: REGISTRY[k].step, value: v, base: k in BASE[key] ? BASE[key][k] : null, inBase: k in BASE[key], changed: o[key] && k in o[key] })),
      dropped: Object.entries((o[key] || {})).filter(([, v]) => v === null).map(([k]) => ({ key: k, label: REGISTRY[k] ? REGISTRY[k].label : k }))
    })),
    available: Object.entries(REGISTRY).filter(([, r]) => r.storage !== 'internal').map(([k, r]) => ({ key: k, label: r.label, group: r.group, type: r.type, min: r.min, max: r.max, step: r.step, value: setting(store, k) }))
  };
}
// { mode, key, value } : valeur du mode (null = ne plus y toucher) ; reset : retour au code.
function setOverride(store, body) {
  const mode = body.mode;
  if (!PRESETS[mode]) return fail('unknown_preset');
  if (!REGISTRY[body.key]) return fail('unknown_setting');
  const wasCurrent = status(store).current === mode;
  const o = overridesOf(store);
  o[mode] = o[mode] || {};
  let live;
  if (body.action === 'override-reset') {
    delete o[mode][body.key];
    if (body.key in BASE[mode]) live = BASE[mode][body.key];
  } else if (body.value === null) {
    o[mode][body.key] = null;
  } else {
    try { live = validateSetting(body.key, body.value); } catch (e) { return fail('invalid_settings', 400, { errors: [e.message] }); }
    o[mode][body.key] = live;
  }
  if (!Object.keys(o[mode]).length) delete o[mode];
  saveOverrides(store, o);
  // Mode en cours : la nouvelle valeur s'applique tout de suite.
  if (wasCurrent && live !== undefined) {
    const errors = setSettings(store, { [body.key]: live });
    if (errors.length) return fail('invalid_settings', 400, { errors });
  }
  return ok({ ...overridesView(store), appliedLive: wasCurrent && live !== undefined });
}
export function init({ store }) { refreshOverrides(store); }

// Libelles et icones (machine.js, features.js, modeextras.js).
export const PRESET_INFO = Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, { label: p.label, icon: p.icon }]));
export const MODE_KEYS = Object.keys(PRESETS);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Valeur lisible (tables de peche : poids des boosters et des os).
function show(v) {
  if (Array.isArray(v)) { const w = (t) => (v.find((x) => x.type === t) || {}).weight ?? '–'; return `booster ${w('booster')} · os ${w('bone')}`; }
  return typeof v === 'number' && !Number.isInteger(v) ? String(v).replace('.', ',') : v;
}

function recommendation(store) {
  const since = now() - 7 * 86400;
  const active = store.getAll('Users').filter((u) => (Number(u.LastSeenAt) || 0) >= since).length;
  const f = flows(store, active);
  const perDay = f ? f.boostersPerPlayerDay : 0;
  // Fourchette visee (economy.js) : 40 boosters par joueur actif et par jour, +/- 20, hors codes.
  const goal = boosterTarget(store);
  const ratio = f ? f.dustRatio : 0;
  const tight = isTight(store);
  const factor = Math.round(priceMultiplier(store) * 100) / 100;
  const reasons = [];
  let key = 'medium';
  if (!perDay && !ratio && !tight) {
    reasons.push('pas encore assez de données sur 7 jours (journal de l’économie vide)');
  } else if (tight || perDay > goal.high || ratio > 4) {
    key = 'hard';
    if (tight) reasons.push('le mode anti-inflation est actif');
    if (perDay > goal.high) reasons.push(`${perDay} boosters créés par joueur actif et par jour hors codes (cible ${goal.target}, ${goal.low} à ${goal.high})`);
    if (ratio > 4) reasons.push(`${ratio} poussières gagnées pour 1 dépensée`);
  } else if (perDay < goal.low / 2 && ratio < 1 && factor <= 1) {
    key = 'cool';
    reasons.push(`à peine ${perDay} booster par joueur actif et par jour`, 'économie très calme : les joueurs peuvent souffler');
  } else if (perDay < goal.low && ratio < 1.5 && factor <= 1) {
    key = 'chill';
    reasons.push(`seulement ${perDay} booster(s) par joueur actif et par jour`, 'poussières peu accumulées, prix non indexés');
  } else reasons.push(`${perDay} boosters par joueur actif et par jour, ${ratio} poussières gagnées pour 1 dépensée`);
  return { key, reasons, perDay, ratio, tight, priceFactor: factor, activePlayers: active, target: goal };
}

function status(store) {
  const row = store.getAll('AppSettings').find((r) => r.Key === KEY);
  let last = null; try { last = row ? JSON.parse(row.Value) : null; } catch (e) { last = null; }
  const presets = Object.entries(PRESETS).map(([key, p]) => {
    const changes = Object.entries(p.values).filter(([k, v]) => !same(setting(store, k), v))
      .map(([k, v]) => ({ key: k, label: REGISTRY[k].label, current: show(setting(store, k)), target: show(v) }));
    return { key, label: p.label, icon: p.icon, desc: p.desc, active: !changes.length, changes, settings: Object.keys(p.values).length };
  });
  // Deux modes aux memes reglages (Medium et Chaos) : le dernier applique l'emporte.
  const actives = presets.filter((p) => p.active);
  const current = (actives.find((p) => last && p.key === last.key) || actives[0] || {}).key || 'custom';
  presets.forEach((p) => { p.active = p.key === current; });
  return { presets, current, last, recommendation: recommendation(store) };
}

// Dernier mode applique { key, at, by } (ou null).
export function lastPreset(store) {
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === KEY) : null;
  try { return row ? JSON.parse(row.Value) : null; } catch (e) { return null; }
}

// Applique un mode (admin, ou vote de la salle des machines). Renvoie les erreurs.
export function applyPreset(store, key, by) {
  const p = PRESETS[key];
  if (!p) return ['unknown_preset'];
  const errors = setSettings(store, p.values);
  if (errors.length) return errors;
  const value = JSON.stringify({ key, at: now(), by: String(by) });
  const row = store.getAll('AppSettings').find((r) => r.Key === KEY);
  if (row) store.update('AppSettings', row.id, { Value: value }); else store.create('AppSettings', { Key: KEY, Value: value });
  modeCache = { at: 0, store: null, value: null };
  return [];
}

function handlePreset({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  if ((body.action || 'status') === 'status') return ok(status(store));
  if (body.action === 'overrides') return ok(overridesView(store));
  if (body.action === 'override-set' || body.action === 'override-reset') return setOverride(store, body);
  if (body.action !== 'apply') return fail('unknown_action');
  const p = PRESETS[body.preset];
  if (!p) return fail('unknown_preset');
  const errors = applyPreset(store, body.preset, body.discordId);
  if (errors.length) return fail('invalid_settings', 400, { errors });
  if (body.announce) addFeed(store, { kind: 'economy', icon: p.icon, text: `Le jeu passe en mode ${p.label} : ${p.desc}` });
  return ok({ ...status(store), applied: body.preset });
}

// Mode affiche aux joueurs (couleurs du menu, animation du logo) : le mode
// exact, sinon le dernier applique (reglages retouches a la main ensuite).
let modeCache = { at: 0, store: null, value: null };
// Mode propre au compte test (testaccount.js), seulement pendant ses requetes.
let modeHook = null;
export const setModeHook = (fn) => { modeHook = fn; };
export function currentMode(store) {
  const o = modeHook && modeHook(store);
  if (o) return o;
  const t = Date.now();
  if (modeCache.store === store && t - modeCache.at < 30000) return modeCache.value;
  const st = status(store);
  const key = st.current !== 'custom' ? st.current : (st.last && PRESETS[st.last.key] ? st.last.key : 'medium');
  const p = PRESETS[key];
  const value = { key, label: p.label, icon: p.icon, custom: st.current === 'custom' };
  modeCache = { at: t, store, value };
  return value;
}

export const routes = { 'POST admin-preset': handlePreset };
export { PRESETS };
