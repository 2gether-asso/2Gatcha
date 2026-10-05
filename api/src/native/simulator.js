// Simulateur d'ouverture de boosters (admins, 2026-10-05) : reproduit le
// tirage du workflow open-pack (rarete ponderee, pity, finition, etat, booster
// shiny, carte bonus) avec des modificateurs, SANS AUCUNE ECRITURE : pas de
// carte ajoutee, pas d'XP, pas de booster consomme, pas d'annonce.
//   POST /webhook/admin-simulate { discordId, action: 'config' | 'run' | 'pack', extensionId, boosters?, modifiers? }
// modifiers : { rarityMultipliers: { cle: x }, specialFinishChance, shinyChance,
//               bonusCardChance, pity (bool), startPity, applyEvent (bool) }

import { refId, ok, fail, isAdmin, configRow, cardSummary } from './common.js';
import { eventState } from './events.js';

const BOOSTER_SIZE = 5;
const MAX_BOOSTERS = 5000;
const FINISH_RANK = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'];
const QUALITY_RANK = ['damaged', 'worn', 'good', 'mint'];

const cfgNum = (cfg, k, def) => (Number(cfg[k]) > 0 ? Number(cfg[k]) : def);
const clamp01 = (v, def) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(1, n) : def; };

function context(store, extensionId, modifiers = {}) {
  const cfg = configRow(store);
  const rarities = store.getAll('Rarities').filter((r) => r.Key !== 'unique');
  const cards = store.getAll('Cards').filter((c) => c.Active && refId(c.Extension) === extensionId && !c.IsPromo);
  const finishes = store.tables.has('Finishes') ? store.getAll('Finishes') : [];
  const qualities = store.tables.has('Qualities') ? store.getAll('Qualities') : [];
  const mult = modifiers.rarityMultipliers || {};
  const weights = new Map(rarities.map((r) => [r.id, Math.max(0, (Number(r.Weight) || 0) * (Number(mult[r.Key]) >= 0 && mult[r.Key] !== '' && mult[r.Key] != null ? Number(mult[r.Key]) : 1))]));
  const ev = eventState(store);
  const baseFinish = cfgNum(cfg, 'SpecialFinishChance', 0.10);
  let specialFinishChance = clamp01(modifiers.specialFinishChance, baseFinish);
  if (modifiers.applyEvent && ev.active) specialFinishChance = Math.min(1, specialFinishChance * ev.finishMultiplier);
  return {
    cfg, rarities, cards, weights,
    cardsByRarity: cards.reduce((m, c) => { const k = refId(c.Rarity); (m[k] = m[k] || []).push(c); return m; }, {}),
    specialFinishes: finishes.filter((f) => f.Key !== 'normal' && (f.DropWeight || 0) > 0),
    qualities: qualities.filter((q) => (q.DropWeight || 0) > 0),
    specialFinishChance,
    shinyChance: clamp01(modifiers.shinyChance, cfgNum(cfg, 'ShinyPackChance', 0.001)),
    bonusCardChance: clamp01(modifiers.bonusCardChance, cfgNum(cfg, 'BonusCardChance', 0.10)),
    pityThreshold: modifiers.pity === false ? Infinity : (Number(cfg.PityThreshold) || Infinity),
    topRarityId: refId(cfg.TopRarity) || null,
    lowest: [...rarities].sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0))[0]
  };
}

function weighted(list, w) {
  const total = list.reduce((s, x) => s + w(x), 0);
  if (total <= 0) return list[list.length - 1];
  let r = Math.random() * total;
  for (const x of list) { r -= w(x); if (r <= 0) return x; }
  return list[list.length - 1];
}

// Un booster : meme logique que open-pack.json (Draw Cards).
function drawBooster(ctx, state) {
  const shiny = Math.random() < ctx.shinyChance;
  const bonus = shiny || Math.random() < ctx.bonusCardChance;
  const count = BOOSTER_SIZE + (bonus ? 1 : 0);
  const rollFinish = (boost) => {
    if (!ctx.specialFinishes.length) return 'normal';
    if (!(boost && Math.random() < 0.5) && Math.random() >= ctx.specialFinishChance) return 'normal';
    return weighted(ctx.specialFinishes, (f) => f.DropWeight || 0).Key;
  };
  const rollQuality = () => (ctx.qualities.length ? weighted(ctx.qualities, (q) => q.DropWeight || 0).Key : 'good');
  const out = [];
  for (let i = 0; i < count; i++) {
    state.pity++;
    let rarity;
    let pityHit = false;
    if (state.pity >= ctx.pityThreshold && ctx.topRarityId) {
      rarity = ctx.rarities.find((r) => r.id === ctx.topRarityId);
      pityHit = true;
    }
    if (!rarity) {
      const pool = shiny ? ctx.rarities.filter((r) => !ctx.lowest || r.id !== ctx.lowest.id) : ctx.rarities;
      rarity = weighted(pool.length ? pool : ctx.rarities, (r) => ctx.weights.get(r.id) || 0);
    }
    if (rarity.id === ctx.topRarityId) state.pity = 0;
    const pool = (ctx.cardsByRarity[rarity.id] && ctx.cardsByRarity[rarity.id].length) ? ctx.cardsByRarity[rarity.id] : ctx.cards;
    const card = pool[Math.floor(Math.random() * pool.length)];
    let quality = rollQuality();
    if (shiny) { const b = rollQuality(); if (QUALITY_RANK.indexOf(b) > QUALITY_RANK.indexOf(quality)) quality = b; }
    out.push({ card, finish: rollFinish(shiny), quality, shiny, bonus: bonus && i === count - 1, pityHit });
  }
  return { cards: out, shiny, bonus };
}

function handle({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const action = body.action || 'config';
  if (action === 'config') {
    const cfg = configRow(store);
    const top = store.get('Rarities', refId(cfg.TopRarity));
    const rarities = store.getAll('Rarities').filter((r) => r.Key !== 'unique').sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
    const total = rarities.reduce((s, r) => s + (Number(r.Weight) || 0), 0) || 1;
    return ok({
      extensions: (store.tables.has('Extensions') ? store.getAll('Extensions') : []).filter((e) => e.Active !== false).map((e) => ({ id: e.id, name: e.Name })),
      rarities: rarities.map((r) => ({ key: r.Key, name: r.Name, colorHex: r.ColorHex, weight: Number(r.Weight) || 0, pct: Math.round(((Number(r.Weight) || 0) / total) * 1000) / 10 })),
      defaults: {
        specialFinishChance: cfgNum(cfg, 'SpecialFinishChance', 0.10), shinyChance: cfgNum(cfg, 'ShinyPackChance', 0.001),
        bonusCardChance: cfgNum(cfg, 'BonusCardChance', 0.10), pityThreshold: Number(cfg.PityThreshold) || null, topRarity: top ? top.Name : null
      },
      maxBoosters: MAX_BOOSTERS
    });
  }
  const extensionId = Number(body.extensionId);
  const ctx = context(store, extensionId, body.modifiers || {});
  if (!ctx.cards.length) return fail('no_cards');
  const state = { pity: Math.max(0, Number((body.modifiers || {}).startPity) || 0) };
  const rarityById = new Map(ctx.rarities.map((r) => [r.id, r]));
  const topStatId = ctx.topRarityId || [...ctx.rarities].sort((a, b) => (b.SortOrder || 0) - (a.SortOrder || 0))[0]?.id;
  const view = (d) => {
    const s = cardSummary(store, d.card);
    return { ...s, artist: d.card.Artist || "", serialNumber: null, finish: d.finish, quality: d.quality, isShinyPack: d.shiny, isBonusCard: d.bonus, simulated: true, isNewToPlayer: false };
  };

  // Un booster simule, au format de open-pack (pour l'animation d'ouverture).
  if (action === 'pack') {
    const b = drawBooster(ctx, state);
    return ok({ simulated: true, cards: b.cards.map(view), pack: { shiny: b.shiny, bonusCard: b.bonus }, batchId: null });
  }
  if (action !== 'run') return fail('unknown_action');

  const n = Math.min(MAX_BOOSTERS, Math.max(1, Number(body.boosters) || 100));
  const byRarity = new Map(), byFinish = new Map(), byQuality = new Map(), byCard = new Map();
  let cards = 0, shinyPacks = 0, bonusCards = 0, pityHits = 0, dust = 0, topCount = 0;
  const best = [];
  const finishMult = new Map((store.tables.has('Finishes') ? store.getAll('Finishes') : []).map((f) => [f.Key, Number(f.DisenchantMultiplier) || 1]));
  const qualityMult = new Map((store.tables.has('Qualities') ? store.getAll('Qualities') : []).map((q) => [q.Key, Number(q.DisenchantMultiplier) || 1]));
  for (let i = 0; i < n; i++) {
    const b = drawBooster(ctx, state);
    if (b.shiny) shinyPacks++;
    if (b.bonus) bonusCards++;
    for (const d of b.cards) {
      cards++;
      const r = rarityById.get(refId(d.card.Rarity));
      const key = r ? r.Key : '?';
      byRarity.set(key, (byRarity.get(key) || 0) + 1);
      byFinish.set(d.finish, (byFinish.get(d.finish) || 0) + 1);
      byQuality.set(d.quality, (byQuality.get(d.quality) || 0) + 1);
      byCard.set(d.card.id, (byCard.get(d.card.id) || 0) + 1);
      if (d.pityHit) pityHits++;
      if (r && r.id === topStatId) topCount++;
      dust += Math.round((Number(r && r.DisenchantValue) || 0) * (finishMult.get(d.finish) || 1) * (qualityMult.get(d.quality) || 1));
      const score = (r ? r.SortOrder || 0 : 0) * 100 + FINISH_RANK.indexOf(d.finish) * 10 + QUALITY_RANK.indexOf(d.quality);
      if (best.length < 12 || score > best[best.length - 1].score) {
        best.push({ score, d });
        best.sort((a, b2) => b2.score - a.score);
        if (best.length > 12) best.pop();
      }
    }
  }
  const totalWeight = ctx.rarities.reduce((s, r) => s + (ctx.weights.get(r.id) || 0), 0) || 1;
  const pct = (x) => Math.round((x / Math.max(1, cards)) * 1000) / 10;
  const me = store.getAll('Users').find((u) => String(u.DiscordId || '') === String(body.discordId));
  const owned = me ? new Set(store.getAll('Pulls').filter((p) => refId(p.User) === me.id).map((p) => refId(p.Card))) : new Set();
  return ok({
    simulated: true, boosters: n, cards, shinyPacks, bonusCards, pityHits,
    distinctCards: byCard.size, poolSize: ctx.cards.length,
    newForMe: [...byCard.keys()].filter((id) => !owned.has(id)).length,
    estimatedDust: dust,
    boostersPerTopRarity: topCount ? Math.round((n / topCount) * 10) / 10 : null,
    applied: { specialFinishChance: ctx.specialFinishChance, shinyChance: ctx.shinyChance, bonusCardChance: ctx.bonusCardChance, pity: ctx.pityThreshold !== Infinity },
    rarities: [...ctx.rarities].sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0)).map((r) => ({
      key: r.Key, name: r.Name, colorHex: r.ColorHex, count: byRarity.get(r.Key) || 0, pct: pct(byRarity.get(r.Key) || 0),
      expected: Math.round(((ctx.weights.get(r.id) || 0) / totalWeight) * 1000) / 10
    })),
    finishes: FINISH_RANK.map((k) => ({ key: k, count: byFinish.get(k) || 0, pct: pct(byFinish.get(k) || 0) })),
    qualities: QUALITY_RANK.map((k) => ({ key: k, count: byQuality.get(k) || 0, pct: pct(byQuality.get(k) || 0) })),
    best: best.map(({ d }) => view(d))
  });
}

export const routes = { 'POST admin-simulate': handle };
