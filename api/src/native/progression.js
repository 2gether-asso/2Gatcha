// Progression longue (2026-10-07) : des objectifs qui durent des mois.
//
//  - Maitrise par extension (niveaux 1 a 10) sur 3 couches : cartes,
//    finitions (les 6 de chaque carte), etats (les 4 de chaque carte). Chaque
//    niveau donne un petit bonus de finition speciale sur les boosters de
//    l'extension ; le niveau 10 demande TOUT, arc-en-ciel compris. Chaque
//    couche complete se reclame (MasteryLayerRewards).
//      POST /webhook/mastery { userId, action: 'status' | 'claim', extensionId? }
//  - Rang de compte (Bronze -> Legende) d'apres la valeur de la collection
//    (somme des valeurs de decraft), affiche a cote du pseudo.
//  - Constellations : 40 etoiles de 5 cartes d'extensions differentes ; le
//    ciel complet est l'objectif ultime (boosters + titre).
//      POST /webhook/constellations { userId, action: 'status' | 'claim', key? }
//  - Carte ★ : 3 exemplaires arc-en-ciel en parfait etat d'une meme carte
//    fusionnes en un seul exemplaire ★ (cadre anime, decraft x3).
//      POST /webhook/card-prestige { userId, pullIds: [a, b, c] }
//  - Maitrises de succes : paliers I, II, III sur les grands compteurs du jeu
//    (cartes, echanges, peche...), le III donne un titre.
//      POST /webhook/achievement-tiers { userId, action: 'status' | 'claim', key? }

import { refId, now, ok, fail, userById, cardSummary } from './common.js';
import { setting } from './settings.js';
import { grantCosmetic } from './cosmetics.js';
import { addFeed } from './feed.js';

export const schema = {
  Pulls: { Starred: { type: 'Bool' }, Insured: { type: 'Bool' } },
  Users: { RankKey: { type: 'Text' }, ActivityCounts: { type: 'Text' } },
  ProgressClaims: { User: { type: 'Ref:Users' }, Ext: { type: 'Numeric' }, Kind: { type: 'Text' }, At: { type: 'Numeric' } }
};

const FINISHES = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'];
const QUALITIES = ['damaged', 'worn', 'good', 'mint'];
const parse = (v, def) => { try { const x = JSON.parse(v || ''); return x == null ? def : x; } catch (e) { return def; } };

const claims = (store, userId) => (store.tables.has('ProgressClaims') ? store.getAll('ProgressClaims').filter((c) => refId(c.User) === userId) : []);
const claimed = (list, ext, kind) => list.some((c) => (Number(c.Ext) || 0) === ext && c.Kind === kind);
const addClaim = (store, userId, ext, kind) => store.create('ProgressClaims', { User: userId, Ext: ext, Kind: kind, At: now() });

function grant(store, userId, { dust = 0, boosters = 0 } = {}) {
  const u = store.get('Users', userId);
  return store.update('Users', userId, { StardustCount: (Number(u.StardustCount) || 0) + dust, BoosterCount: (Number(u.BoosterCount) || 0) + boosters });
}

// Extensions "normales" (hors extension technique des cartes Unique).
function extensionsWithCards(store) {
  const exts = store.tables.has('Extensions') ? store.getAll('Extensions').filter((e) => e.Key !== 'uniques') : [];
  const cards = store.getAll('Cards').filter((c) => c.Active && !c.IsPromo);
  return exts.map((e) => ({ ext: e, cards: cards.filter((c) => refId(c.Extension) === e.id) })).filter((x) => x.cards.length)
    .sort((a, b) => (a.ext.SortOrder || 0) - (b.ext.SortOrder || 0));
}

// --- maitrise ---------------------------------------------------------------
function masteryFor(cards, pulls) {
  const ids = new Set(cards.map((c) => c.id));
  const finishes = new Map(), qualities = new Map();
  for (const p of pulls) {
    const cid = refId(p.Card);
    if (!ids.has(cid)) continue;
    if (!finishes.has(cid)) { finishes.set(cid, new Set()); qualities.set(cid, new Set()); }
    finishes.get(cid).add(p.Finish || 'normal');
    qualities.get(cid).add(p.Quality || 'damaged');
  }
  const n = cards.length;
  const layer = (owned, total) => ({ owned, total, pct: total ? owned / total : 0 });
  const layers = {
    cards: layer(finishes.size, n),
    finishes: layer([...finishes.values()].reduce((s, f) => s + [...f].filter((k) => FINISHES.includes(k)).length, 0), n * FINISHES.length),
    qualities: layer([...qualities.values()].reduce((s, q) => s + [...q].filter((k) => QUALITIES.includes(k)).length, 0), n * QUALITIES.length)
  };
  const score = 0.4 * layers.cards.pct + 0.35 * layers.finishes.pct + 0.25 * layers.qualities.pct;
  const complete = layers.cards.pct >= 1 && layers.finishes.pct >= 1 && layers.qualities.pct >= 1;
  return { layers, score, level: complete ? 10 : Math.min(9, 1 + Math.floor(score * 9)) };
}

export function masteryLevel(store, userId, extensionId) {
  const x = extensionsWithCards(store).find((e) => e.ext.id === Number(extensionId));
  if (!x) return 1;
  return masteryFor(x.cards, store.getAll('Pulls').filter((p) => refId(p.User) === userId)).level;
}

export function masteryFinishBonus(store, userId, extensionId) {
  return (masteryLevel(store, userId, extensionId) - 1) * setting(store, 'MasteryFinishBonusPerLevel');
}

function masteryState(store, user) {
  const pulls = store.getAll('Pulls').filter((p) => refId(p.User) === user.id);
  const mine = claims(store, user.id);
  const layerRewards = setting(store, 'MasteryLayerRewards');
  const perLevel = setting(store, 'MasteryLevelDust');
  const extensions = extensionsWithCards(store).map(({ ext, cards }) => {
    const m = masteryFor(cards, pulls);
    const pending = [];
    for (let l = 2; l <= m.level; l++) if (!claimed(mine, ext.id, 'level:' + l)) pending.push({ kind: 'level:' + l, label: `Niveau ${l}`, dust: l * perLevel, boosters: 0 });
    for (const k of ['cards', 'qualities', 'finishes']) {
      if (m.layers[k].pct >= 1 && !claimed(mine, ext.id, 'layer:' + k)) pending.push({ kind: 'layer:' + k, label: { cards: 'Toutes les cartes', qualities: 'Tous les états', finishes: 'Toutes les finitions' }[k], dust: Number(layerRewards[k]?.dust) || 0, boosters: Number(layerRewards[k]?.boosters) || 0 });
    }
    return {
      extensionId: ext.id, name: ext.Name, level: m.level, score: Math.round(m.score * 1000) / 10, layers: m.layers,
      finishBonus: (m.level - 1) * setting(store, 'MasteryFinishBonusPerLevel'), pending,
      layerRewards
    };
  });
  return { extensions, claimable: extensions.reduce((s, e) => s + e.pending.length, 0) };
}

function handleMastery({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const st = masteryState(store, user);
  if ((body.action || 'status') === 'status') return ok(st);
  if (body.action !== 'claim') return fail('unknown_action');
  const targets = st.extensions.filter((e) => !body.extensionId || e.extensionId === Number(body.extensionId));
  let dust = 0, boosters = 0, count = 0;
  for (const e of targets) for (const p of e.pending) { addClaim(store, user.id, e.extensionId, p.kind); dust += p.dust; boosters += p.boosters; count++; }
  if (!count) return fail('nothing_to_claim', 400, st);
  const after = grant(store, user.id, { dust, boosters });
  targets.filter((e) => e.level === 10 && e.pending.some((p) => p.kind === 'level:10')).forEach((e) => addFeed(store, { userId: user.id, kind: 'mastery', icon: '🏅', text: `a atteint la maîtrise 10 de l’extension ${e.name} !` }));
  return ok({ ...masteryState(store, after), claimed: { count, dust, boosters }, newStardust: after.StardustCount, newBoosterCount: after.BoosterCount });
}

// --- valeur de collection et rang ------------------------------------------
export function valueMaps(store) {
  return {
    rarity: new Map(store.getAll('Rarities').map((r) => [r.id, Number(r.DisenchantValue) || 0])),
    cardRarity: new Map(store.getAll('Cards').map((c) => [c.id, refId(c.Rarity)])),
    finish: new Map((store.tables.has('Finishes') ? store.getAll('Finishes') : []).map((f) => [f.Key, Number(f.DisenchantMultiplier) || 1])),
    quality: new Map((store.tables.has('Qualities') ? store.getAll('Qualities') : []).map((q) => [q.Key, Number(q.DisenchantMultiplier) || 1])),
    star: setting(store, 'StarDecraftMultiplier')
  };
}

export function pullValue(maps, p) {
  const base = maps.rarity.get(maps.cardRarity.get(refId(p.Card))) || 0;
  return base * (maps.finish.get(p.Finish || 'normal') || 1) * (maps.quality.get(p.Quality || 'damaged') || 1) * (p.Starred ? maps.star : 1);
}

export function collectionValues(store) {
  const maps = valueMaps(store);
  const out = new Map();
  for (const p of store.getAll('Pulls')) {
    const u = refId(p.User);
    if (!u) continue;
    out.set(u, (out.get(u) || 0) + pullValue(maps, p));
  }
  return out;
}

export function rankFor(store, value) {
  const list = [...setting(store, 'RankThresholds')].filter((r) => r && r.key).sort((a, b) => (a.min || 0) - (b.min || 0));
  let idx = 0;
  list.forEach((r, i) => { if (value >= (r.min || 0)) idx = i; });
  const r = list[idx] || { key: 'bronze', label: 'Bronze', icon: '🥉', min: 0 };
  const next = list[idx + 1] || null;
  return { key: r.key, label: r.label, icon: r.icon, min: r.min || 0, value: Math.round(value), next: next ? { key: next.key, label: next.label, icon: next.icon, min: next.min } : null, tier: idx };
}

export function ranksFor(store, userIds) {
  const values = collectionValues(store);
  const out = {};
  userIds.forEach((id) => { out[id] = rankFor(store, values.get(Number(id)) || 0); });
  return out;
}

// Rang du joueur, avec annonce (et fil du serveur) quand il monte.
export function rankOf(store, user) {
  const r = ranksFor(store, [user.id])[user.id];
  if (user.RankKey !== r.key) {
    const list = [...setting(store, 'RankThresholds')].sort((a, b) => (a.min || 0) - (b.min || 0));
    const before = list.findIndex((x) => x.key === user.RankKey);
    store.update('Users', user.id, { RankKey: r.key });
    if (user.RankKey && r.tier > before) {
      addFeed(store, { userId: user.id, kind: 'rank', icon: r.icon, text: `passe au rang ${r.label} !` });
      r.promoted = true;
    }
  }
  return r;
}

// --- constellations ---------------------------------------------------------
const STAR_NAMES = ['Andromède', 'Bélier', 'Cassiopée', 'Céphée', 'Cygne', 'Dragon', 'Grande Ourse', 'Petite Ourse', 'Lyre', 'Orion',
  'Pégase', 'Persée', 'Phénix', 'Licorne', 'Hydre', 'Lion', 'Lynx', 'Aigle', 'Dauphin', 'Couronne boréale',
  'Hercule', 'Bouvier', 'Cocher', 'Gémeaux', 'Cancer', 'Vierge', 'Balance', 'Scorpion', 'Sagittaire', 'Capricorne',
  'Verseau', 'Poissons', 'Taureau', 'Centaure', 'Paon', 'Toucan', 'Caméléon', 'Colombe', 'Grue', 'Flèche'];

function seeded(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000000) / 1000000; };
}

function appGet(store, key) { const r = store.getAll('AppSettings').find((x) => x.Key === key); return r ? parse(r.Value, null) : null; }
function appSet(store, key, value) {
  const r = store.getAll('AppSettings').find((x) => x.Key === key);
  if (r) store.update('AppSettings', r.id, { Value: JSON.stringify(value) }); else store.create('AppSettings', { Key: key, Value: JSON.stringify(value) });
}

// 40 etoiles, tirees une fois pour toutes (gardees en base) des qu'il y a
// assez de cartes ; chaque etoile reunit 5 cartes d'extensions differentes
// autant que possible.
export function constellations(store) {
  const saved = appGet(store, 'constellations');
  if (Array.isArray(saved) && saved.length) return saved;
  const groups = extensionsWithCards(store).map((g) => g.cards.map((c) => c.id));
  const all = groups.flat();
  if (all.length < 10) return [];
  const rnd = seeded('constellations-v1:' + all.length);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const stars = STAR_NAMES.map((name, i) => {
    const ids = new Set();
    const order = [...groups].sort(() => rnd() - 0.5);
    for (const g of order) { if (ids.size >= 5) break; ids.add(pick(g)); }
    let guard = 0;
    while (ids.size < 5 && guard++ < 50) ids.add(pick(all));
    return { key: 'star-' + (i + 1), name, cardIds: [...ids] };
  });
  appSet(store, 'constellations', stars);
  return stars;
}

function constellationState(store, user) {
  const owned = new Set(store.getAll('Pulls').filter((p) => refId(p.User) === user.id).map((p) => refId(p.Card)));
  const mine = claims(store, user.id);
  const stars = constellations(store).map((s) => {
    const cards = s.cardIds.map((id) => store.get('Cards', id)).filter(Boolean).map((c) => ({ ...cardSummary(store, c), owned: owned.has(c.id) }));
    const lit = cards.length > 0 && cards.every((c) => c.owned);
    return { key: s.key, name: s.name, cards, owned: cards.filter((c) => c.owned).length, lit, claimed: claimed(mine, 0, s.key) };
  });
  const litCount = stars.filter((s) => s.lit).length;
  return {
    stars, lit: litCount, total: stars.length,
    dustPerStar: setting(store, 'ConstellationDust'), skyBoosters: setting(store, 'ConstellationSkyBoosters'),
    skyComplete: stars.length > 0 && litCount === stars.length, skyClaimed: claimed(mine, 0, 'sky'),
    claimable: stars.filter((s) => s.lit && !s.claimed).length + (stars.length > 0 && litCount === stars.length && !claimed(mine, 0, 'sky') ? 1 : 0)
  };
}

function handleConstellations({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const st = constellationState(store, user);
  if ((body.action || 'status') === 'status') return ok(st);
  if (body.action !== 'claim') return fail('unknown_action');
  let dust = 0, boosters = 0, count = 0;
  for (const s of st.stars) if (s.lit && !s.claimed && (!body.key || body.key === s.key)) { addClaim(store, user.id, 0, s.key); dust += st.dustPerStar; count++; }
  if (st.skyComplete && !st.skyClaimed && (!body.key || body.key === 'sky')) {
    addClaim(store, user.id, 0, 'sky');
    boosters += st.skyBoosters; count++;
    grantCosmetic(store, user.id, 'title-astronome', { type: 'title', label: 'Astronome' });
    addFeed(store, { userId: user.id, kind: 'sky', icon: '🌌', text: 'a allumé les 40 étoiles du ciel !' });
  }
  if (!count) return fail('nothing_to_claim', 400, st);
  const after = grant(store, user.id, { dust, boosters });
  return ok({ ...constellationState(store, after), claimed: { count, dust, boosters }, newStardust: after.StardustCount, newBoosterCount: after.BoosterCount });
}

// --- carte ★ ----------------------------------------------------------------
function handleCardPrestige({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const ids = [...new Set((Array.isArray(body.pullIds) ? body.pullIds : []).map(Number))];
  if (ids.length !== 3) return fail('need_three_copies');
  const pulls = ids.map((id) => store.get('Pulls', id));
  if (pulls.some((p) => !p || refId(p.User) !== user.id)) return fail('copy_not_owned');
  if (pulls.some((p) => p.InVault)) return fail('copy_in_vault');
  if (pulls.some((p) => p.Insured)) return fail('insured_copy');
  if (pulls.some((p) => p.Starred)) return fail('already_starred');
  const cardId = refId(pulls[0].Card);
  if (pulls.some((p) => refId(p.Card) !== cardId)) return fail('different_cards');
  if (pulls.some((p) => p.Finish !== 'rainbow' || p.Quality !== 'mint')) return fail('need_rainbow_mint');
  const keep = [...pulls].sort((a, b) => (a.SerialNumber || 1e9) - (b.SerialNumber || 1e9))[0];
  pulls.filter((p) => p.id !== keep.id).forEach((p) => store.delete('Pulls', p.id));
  store.update('Pulls', keep.id, { Starred: true });
  const card = store.get('Cards', cardId);
  addFeed(store, { userId: user.id, kind: 'star', icon: '⭐', text: `a forgé une carte ★ : ${card ? card.Name : '?'} #${keep.SerialNumber || '?'}`, cardId });
  return ok({ starred: true, pullId: keep.id, serialNumber: keep.SerialNumber || null, card: card ? cardSummary(store, card) : null });
}

// --- maitrises de succes (paliers I, II, III) ------------------------------
export const TIER_FAMILIES = [
  { key: 'collector', label: 'Collectionneur', icon: '📚', title: 'Grand collectionneur', unit: 'cartes différentes', targets: [25, 75, 150] },
  { key: 'puller', label: 'Ouvreur de boosters', icon: '🎴', title: 'Déchireur de boosters', unit: 'cartes tirées', targets: [250, 1000, 5000] },
  { key: 'legends', label: 'Chasseur de légendes', icon: '🌟', title: 'Seigneur des légendes', unit: 'légendaires ou mythiques différentes', targets: [5, 15, 40] },
  { key: 'trader', label: 'Négociant', icon: '🤝', title: 'Magnat de 2gether', unit: 'échanges conclus', targets: [10, 50, 150] },
  { key: 'artisan', label: 'Artisan', icon: '⚒️', title: 'Maître forgeron', unit: 'crafts, fusions et restaurations', targets: [10, 60, 250] },
  { key: 'recycler', label: 'Recycleur', icon: '♻️', title: 'Alchimiste des étoiles', unit: 'cartes décraftées', targets: [50, 300, 1500] },
  { key: 'fisher', label: 'Pêcheur', icon: '🎣', title: 'Seigneur des océans', unit: 'lancers', targets: [100, 500, 2000] },
  { key: 'digger', label: 'Fouilleur', icon: '⛏️', title: 'Roi des taupes', unit: 'grilles terminées', targets: [25, 100, 400] },
  { key: 'gardener', label: 'Jardinier', icon: '🌻', title: 'Druide', unit: 'récoltes', targets: [20, 100, 400] },
  { key: 'explorer', label: 'Explorateur', icon: '🧭', title: 'Grand aventurier', unit: 'expéditions', targets: [10, 50, 200] },
  { key: 'slayer', label: 'Pourfendeur', icon: '🗡️', title: 'Fléau des boss', unit: 'cartes envoyées aux boss', targets: [50, 250, 1000] }
];

export const counts = (user) => parse(user && user.ActivityCounts, {});

function familyValues(store, user) {
  const pulls = store.getAll('Pulls').filter((p) => refId(p.User) === user.id);
  const cards = new Map(store.getAll('Cards').map((c) => [c.id, c]));
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  const distinct = new Set(pulls.map((p) => refId(p.Card)));
  const legends = [...distinct].filter((id) => ['legendaire', 'mythique'].includes(rarities.get(refId(cards.get(id)?.Rarity))?.Key)).length;
  const trades = store.tables.has('Trades') ? store.getAll('Trades').filter((t) => t.Status === 'accepted' && (refId(t.FromUser) === user.id || refId(t.ToUser) === user.id)).length : 0;
  const hidden = parse(user.HiddenStats, {});
  const c = counts(user);
  const crafted = pulls.filter((p) => String(p.BatchId || '').startsWith('craft-')).length;
  return {
    collector: distinct.size, puller: Number(user.TotalPulls) || 0, legends, trader: trades,
    artisan: Math.max(crafted, 0) + (c.fusion || 0) + (c.repair || 0) + Math.max(0, (c.craft || 0) - crafted),
    recycler: c.disenchant || 0, fisher: hidden.fish || 0, digger: hidden.boards || 0, gardener: hidden.harvests || 0,
    explorer: c.expedition || 0, slayer: hidden.boss || 0
  };
}

export function tierState(store, user) {
  const values = familyValues(store, user);
  const mine = claims(store, user.id);
  const dust = setting(store, 'TierRewardDust');
  const families = TIER_FAMILIES.map((f) => {
    const value = values[f.key] || 0;
    const tiers = f.targets.map((target, i) => ({ tier: i + 1, target, reached: value >= target, claimed: claimed(mine, 0, `tier:${f.key}:${i + 1}`), dust: Number(dust[i]) || 0 }));
    const next = tiers.find((t) => !t.reached);
    return { ...f, value, tiers, level: tiers.filter((t) => t.reached).length, next: next ? next.target : null };
  });
  return { families, claimable: families.reduce((s, f) => s + f.tiers.filter((t) => t.reached && !t.claimed).length, 0) };
}

function handleTiers({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const st = tierState(store, user);
  if ((body.action || 'status') === 'status') return ok(st);
  if (body.action !== 'claim') return fail('unknown_action');
  let dust = 0, count = 0;
  const titles = [];
  for (const f of st.families) {
    if (body.key && body.key !== f.key) continue;
    for (const t of f.tiers) {
      if (!t.reached || t.claimed) continue;
      addClaim(store, user.id, 0, `tier:${f.key}:${t.tier}`);
      dust += t.dust; count++;
      if (t.tier === 3 && grantCosmetic(store, user.id, 'title-tier-' + f.key, { type: 'title', label: f.title })) titles.push(f.title);
    }
  }
  if (!count) return fail('nothing_to_claim', 400, st);
  const after = grant(store, user.id, { dust });
  return ok({ ...tierState(store, after), claimed: { count, dust, titles }, newStardust: after.StardustCount });
}

// Compteurs d'activite (statistiques perso, maitrises) : abonne du bus.
const COUNTED = new Set(['boosterOpened', 'cardsPulled', 'craft', 'disenchant', 'fusion', 'repair', 'tradeProposed', 'tradeDone', 'dig', 'treasure', 'board', 'expedition', 'guess', 'wheel', 'fish', 'chestOpened', 'bossAttack', 'vaultRow', 'harvest', 'communityDig']);
export function onEvents(store, events) {
  const byUser = new Map();
  for (const e of events) {
    if (!COUNTED.has(e.type)) continue;
    if (!byUser.has(e.userId)) byUser.set(e.userId, {});
    const m = byUser.get(e.userId);
    m[e.type] = (m[e.type] || 0) + (Number(e.n) || 1);
  }
  for (const [uid, add] of byUser) {
    const user = store.get('Users', uid);
    if (!user) continue;
    const c = counts(user);
    for (const [k, v] of Object.entries(add)) c[k] = (c[k] || 0) + v;
    store.update('Users', uid, { ActivityCounts: JSON.stringify(c) });
  }
  return [];
}

export const routes = {
  'POST mastery': handleMastery,
  'POST constellations': handleConstellations,
  'POST card-prestige': handleCardPrestige,
  'POST achievement-tiers': handleTiers
};

// Rang affiche avec le statut des boosters (en-tete), le profil public et
// la collection (cartes ou le joueur a ete le premier du serveur).
export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || typeof response.json !== 'object' || Array.isArray(response.json)) return;
  if (path === 'booster-status') {
    const user = store.get('Users', Number((request.query || {}).userId));
    if (user) response.json.rank = rankOf(store, user);
  } else if (path === 'collection') {
    const id = Number((request.query || {}).userId);
    if (!id) return;
    response.json.firstObtained = store.getAll('Cards').filter((c) => refId(c.FirstObtainedBy) === id).map((c) => ({ cardId: c.id, at: Number(c.FirstObtainedAt) || null }));
    response.json.starredPullIds = store.getAll('Pulls').filter((p) => refId(p.User) === id && p.Starred).map((p) => p.id);
    response.json.insuredPullIds = store.getAll('Pulls').filter((p) => refId(p.User) === id && p.Insured).map((p) => p.id);
  } else if (path === 'leaderboard') {
    // Rang a cote des pseudos + classement des plus belles collections.
    const users = store.getAll('Users');
    const byPseudo = new Map(users.map((u) => [String(u.Pseudo || ''), u]));
    const values = collectionValues(store);
    const short = (v) => { const r = rankFor(store, v); return { key: r.key, label: r.label, icon: r.icon }; };
    for (const list of [response.json.topPullers, response.json.topLegendaries]) {
      if (Array.isArray(list)) list.forEach((row) => { const u = byPseudo.get(String(row.pseudo || '')); if (u) row.rank = short(values.get(u.id) || 0); });
    }
    response.json.topCollectors = users.map((u) => ({ u, v: values.get(u.id) || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 10)
      .map((x) => ({ pseudo: x.u.Pseudo || '?', value: Math.round(x.v), rank: short(x.v) }));
  }
}
