// Modes de jeu (2026-10-11) : trois presets Chill / Medium / Hard qui
// reglent d'un coup tout ce qui cree ou detruit des boosters et des
// poussieres. Medium = valeurs par defaut actuelles. L'admin choisit selon
// l'inflation (recommandation calculee a partir du journal de l'economie).
// Un reglage modifie a la main ensuite -> mode "personnalise".
//   POST /webhook/admin-preset { discordId, action: 'status' | 'apply', preset?, announce? }

import { ok, fail, isAdmin, now } from './common.js';
import { setting, setSettings, REGISTRY } from './settings.js';
import { flows } from './economy.js';
import { isTight, priceMultiplier } from './inflation.js';
import { addFeed } from './feed.js';

const KEY = 'gamePreset';

// Tables de peche : celle par defaut avec d'autres poids de boosters et d'os.
const loot = (key, weights) => REGISTRY[key].def.map((x) => (weights[x.type] != null ? { ...x, weight: weights[x.type] } : x));

const PRESETS = {
  chill: {
    label: 'Chill', icon: '🌴', desc: 'Généreux : plus de boosters, prix et taxes plus doux. Pour relancer l’activité ou fêter un événement.',
    values: {
      DigBoosterKeepChance: 0.8, DigRegenSeconds: 300, DigFullRewardsPerDay: 60, DogBonesPerDay: 6, DogBoosterDust: 60, DogBoneCost: 200,
      FishingLoot: loot('FishingLoot', { booster: 6, bone: 12 }), DeepFishingLoot: loot('DeepFishingLoot', { booster: 6, bone: 8 }), FishingFullRewardsPerDay: 20,
      DailyQuestRewardBoosters: 2, WeeklyQuestRewardBoosters: 5,
      DuplicateDustCommon: 4, DuplicateDustOther: 8, DuplicateDustCapCopies: 8, ExchangeRateSwing: 0.2,
      BoosterShopPrice: 350, BoosterShopIncrease: 0.25, BoosterShopWeeklyCap: 4,
      TradeTaxPerCard: 10, AuctionTaxPct: 0.1, ChestCost: 80, WeatherRerollCost: 60, ExpeditionRushCost: 90,
      RarityPityMultiplier: 2, PriceIndexMax: 2, AutoTightDays: 10
    }
  },
  medium: {
    label: 'Medium', icon: '⚖️', desc: 'Équilibré : environ 5 boosters par jour pour un joueur actif, la complétion demande plusieurs mois.',
    values: {
      DigBoosterKeepChance: 0.5, DigRegenSeconds: 600, DigFullRewardsPerDay: 40, DogBonesPerDay: 4, DogBoosterDust: 40, DogBoneCost: 250,
      FishingLoot: loot('FishingLoot', { booster: 3, bone: 8 }), DeepFishingLoot: loot('DeepFishingLoot', { booster: 4, bone: 6 }), FishingFullRewardsPerDay: 15,
      DailyQuestRewardBoosters: 1, WeeklyQuestRewardBoosters: 3,
      DuplicateDustCommon: 3, DuplicateDustOther: 6, DuplicateDustCapCopies: 5, ExchangeRateSwing: 0.3,
      BoosterShopPrice: 450, BoosterShopIncrease: 0.35, BoosterShopWeeklyCap: 3,
      TradeTaxPerCard: 15, AuctionTaxPct: 0.15, ChestCost: 100, WeatherRerollCost: 80, ExpeditionRushCost: 120,
      RarityPityMultiplier: 2.5, PriceIndexMax: 2.5, AutoTightDays: 7
    }
  },
  hard: {
    label: 'Hard', icon: '🔥', desc: 'Serré : peu de boosters, prix et taxes élevés. Pour casser une inflation qui s’installe.',
    values: {
      DigBoosterKeepChance: 0.3, DigRegenSeconds: 900, DigFullRewardsPerDay: 30, DogBonesPerDay: 2, DogBoosterDust: 30, DogBoneCost: 320,
      FishingLoot: loot('FishingLoot', { booster: 2, bone: 6 }), DeepFishingLoot: loot('DeepFishingLoot', { booster: 3, bone: 4 }), FishingFullRewardsPerDay: 10,
      DailyQuestRewardBoosters: 1, WeeklyQuestRewardBoosters: 2,
      DuplicateDustCommon: 2, DuplicateDustOther: 4, DuplicateDustCapCopies: 3, ExchangeRateSwing: 0.4,
      BoosterShopPrice: 600, BoosterShopIncrease: 0.5, BoosterShopWeeklyCap: 2,
      TradeTaxPerCard: 20, AuctionTaxPct: 0.2, ChestCost: 140, WeatherRerollCost: 110, ExpeditionRushCost: 160,
      RarityPityMultiplier: 3, PriceIndexMax: 3, AutoTightDays: 5
    }
  }
};

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
  const ratio = f ? f.dustRatio : 0;
  const tight = isTight(store);
  const factor = Math.round(priceMultiplier(store) * 100) / 100;
  const reasons = [];
  let key = 'medium';
  if (!perDay && !ratio && !tight) {
    reasons.push('pas encore assez de données sur 7 jours (journal de l’économie vide)');
  } else if (tight || perDay > 8 || ratio > 4) {
    key = 'hard';
    if (tight) reasons.push('le mode anti-inflation est actif');
    if (perDay > 8) reasons.push(`${perDay} boosters créés par joueur actif et par jour (cible ~5)`);
    if (ratio > 4) reasons.push(`${ratio} poussières gagnées pour 1 dépensée`);
  } else if (perDay < 2 && ratio < 1.5 && factor <= 1) {
    key = 'chill';
    reasons.push(`seulement ${perDay} booster(s) par joueur actif et par jour`, 'poussières peu accumulées, prix non indexés');
  } else reasons.push(`${perDay} boosters par joueur actif et par jour, ${ratio} poussières gagnées pour 1 dépensée`);
  return { key, reasons, perDay, ratio, tight, priceFactor: factor, activePlayers: active };
}

function status(store) {
  const row = store.getAll('AppSettings').find((r) => r.Key === KEY);
  let last = null; try { last = row ? JSON.parse(row.Value) : null; } catch (e) { last = null; }
  const presets = Object.entries(PRESETS).map(([key, p]) => {
    const changes = Object.entries(p.values).filter(([k, v]) => !same(setting(store, k), v))
      .map(([k, v]) => ({ key: k, label: REGISTRY[k].label, current: show(setting(store, k)), target: show(v) }));
    return { key, label: p.label, icon: p.icon, desc: p.desc, active: !changes.length, changes, settings: Object.keys(p.values).length };
  });
  return { presets, current: (presets.find((p) => p.active) || {}).key || 'custom', last, recommendation: recommendation(store) };
}

function handlePreset({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  if ((body.action || 'status') === 'status') return ok(status(store));
  if (body.action !== 'apply') return fail('unknown_action');
  const p = PRESETS[body.preset];
  if (!p) return fail('unknown_preset');
  const errors = setSettings(store, p.values);
  if (errors.length) return fail('invalid_settings', 400, { errors });
  const value = JSON.stringify({ key: body.preset, at: now(), by: String(body.discordId) });
  const row = store.getAll('AppSettings').find((r) => r.Key === KEY);
  if (row) store.update('AppSettings', row.id, { Value: value }); else store.create('AppSettings', { Key: KEY, Value: value });
  if (body.announce) addFeed(store, { kind: 'economy', icon: p.icon, text: `Le jeu passe en mode ${p.label} : ${p.desc}` });
  return ok({ ...status(store), applied: body.preset });
}

export const routes = { 'POST admin-preset': handlePreset };
