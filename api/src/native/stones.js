// Les pierres de la salle interdite (2026-11-06) : ce que deviennent les
// mineraux une fois la porte ouverte (appele par forbidden.js). Les
// incrustations des rouleaux sont dans slots.js.
//  - Forge interdite : un exemplaire sans edition + ForbiddenForgeCost[rarete]
//    mineraux d'un meme palier -> chance ForbiddenForgeChance[palier] de le
//    passer en edition Interdite (Pulls.ForbiddenForged : decraft normal,
//    market.js). Echec : les mineraux sont perdus et la carte se fissure
//    (Pulls.ForgeCracks), chaque fissure ajoutant ForbiddenForgeCrackBonus a
//    la chance suivante. Ni coffre-fort, ni carte secrete.
//  - Sertissage : une pierre sur un exemplaire Interdit (Pulls.Gem) pour
//    ForbiddenGemCost mineraux du meme type. Purement visuel (badge de la
//    collection), remplacable ; perdu dans une fusion (nouvel exemplaire).
//  - Coeur de la salle : on le nourrit de mineraux (ForbiddenHeartPoints par
//    palier ; Users.ForbiddenHeart). Paliers ForbiddenHeartSteps, avantages
//    HEART_PERKS (lus par slots.js : heartOf).
//  - Transmutation (2026-11-06, onglet Finitions de la collection) : des Or
//    passent un exemplaire de finition inferieure (normale, holo) en Dore,
//    des Diamants un exemplaire sous le Diamant (normale a Ghost) en Diamant.
//    Prix par rarete (ForbiddenGoldCost, ForbiddenDiamondCost). Le meme
//    exemplaire change de finition : numero, etat, edition et pierre gardes.
//    Ni promo, ni Unique, ni coffre-fort. La route collection donne
//    json.transmute (prix, Or et Diamants du sac) seulement porte ouverte.
//   POST /webhook/forbidden { userId, action: 'atelier' | 'forge' | 'gem' | 'heart' | 'feed' | 'transmute', pullId?, tier?, key?, count?, to? }

import { ok, fail, refId, firstAttachment } from './common.js';
import { setting } from './settings.js';
import { MINERALS, TIER_NAMES, mineralsOf } from './digdepth.js';
import { addFeed } from './feed.js';
import { grantCosmetic } from './cosmetics.js';
import { onEvents as masteryEvents } from './cards.js';

export const schema = {
  Users: { ForbiddenHeart: { type: 'Numeric' } },
  Pulls: { Gem: { type: 'Text' }, ForgeCracks: { type: 'Numeric' }, ForbiddenForged: { type: 'Numeric' } }
};

const BY_KEY = new Map(MINERALS.map((m) => [m.key, m]));
const mineralView = (m, own = 0) => ({ key: m.key, name: m.name, tier: m.tier, img: 'Fouille/' + m.img, own });
const tierOwned = (owned, tier) => MINERALS.filter((m) => m.tier === tier).reduce((s, m) => s + (Number(owned[m.key]) || 0), 0);
// Prend n mineraux d'un palier, en commencant par les plus nombreux.
function takeTier(owned, tier, n) {
  let left = n;
  MINERALS.filter((m) => m.tier === tier).sort((a, b) => (Number(owned[b.key]) || 0) - (Number(owned[a.key]) || 0)).forEach((m) => {
    const take = Math.min(left, Number(owned[m.key]) || 0);
    owned[m.key] = (Number(owned[m.key]) || 0) - take;
    left -= take;
  });
  return owned;
}

// ------------------------------------------------------------ coeur de la salle
export const HEART_PERKS = [
  'Titre « Cœur de pierre » et 3 tours gratuits',
  'Incrustations : +50 % de tours',
  'Nouveau symbole sur la machine : 💎 Géode (des minéraux)',
  'Forge interdite : +15 % de réussite',
  'Surchauffe : 3 tours de moins',
  'Cadre « Cœur de la salle » et titre « Gardien du cœur »'
];
export function heartOf(store, user) {
  const points = Number(user && user.ForbiddenHeart) || 0;
  const steps = setting(store, 'ForbiddenHeartSteps');
  const level = steps.filter((t) => points >= t).length;
  return { points, level, next: steps[level] ?? null, prev: steps[level - 1] || 0, steps: steps.map((t, i) => ({ at: t, label: HEART_PERKS[i] || '', done: points >= t })) };
}
function heartView(store, user) {
  const owned = mineralsOf(user);
  const pts = setting(store, 'ForbiddenHeartPoints');
  return { ...heartOf(store, user), pointsPerTier: pts, minerals: MINERALS.map((m) => ({ ...mineralView(m, Number(owned[m.key]) || 0), points: pts[m.tier - 1] || 0 })).filter((m) => m.own > 0) };
}

function feed(store, user, body) {
  const m = BY_KEY.get(String(body.key || ''));
  if (!m) return fail('unknown_mineral');
  const owned = mineralsOf(user);
  const have = Number(owned[m.key]) || 0;
  const count = body.count === 'all' ? have : Math.floor(Number(body.count) || 1);
  if (!(count >= 1) || have < count) return fail('not_enough_minerals', 400, { heart: heartView(store, user) });
  const before = heartOf(store, user);
  const gained = count * (setting(store, 'ForbiddenHeartPoints')[m.tier - 1] || 0);
  owned[m.key] = have - count;
  const fields = { Minerals: JSON.stringify(owned), ForbiddenHeart: before.points + gained };
  const after = heartOf(store, { ForbiddenHeart: fields.ForbiddenHeart });
  const notices = [];
  for (let lv = before.level + 1; lv <= after.level; lv++) {
    notices.push({ icon: '❤️‍🔥', text: `Le Cœur de la salle bat plus fort (palier ${lv}) : ${HEART_PERKS[lv - 1] || ''}` });
    if (lv === 1) {
      fields.ForbiddenFreeSpins = (Number(user.ForbiddenFreeSpins) || 0) + 3;
      grantCosmetic(store, user.id, 'title-coeur-pierre', { type: 'title', label: 'Cœur de pierre' });
    }
    if (lv === 6) {
      grantCosmetic(store, user.id, 'frame-heart', { type: 'frame', label: 'Cœur de la salle' });
      grantCosmetic(store, user.id, 'title-gardien-coeur', { type: 'title', label: 'Gardien du cœur' });
      addFeed(store, { userId: user.id, kind: 'forbidden', icon: '❤️‍🔥', text: 'a réveillé le Cœur de la salle interdite.' });
    }
  }
  const updated = store.update('Users', user.id, fields);
  return ok({ heart: heartView(store, updated), fed: { key: m.key, name: m.name, count, points: gained }, notices });
}

// ------------------------------------------------------------ forge et sertissage
const sortedRarities = (store) => store.getAll('Rarities').sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
function rarityInfo(store, card, rarities) {
  const i = Math.max(0, rarities.findIndex((r) => r.id === refId(card.Rarity)));
  const r = rarities[i] || {};
  return { index: i, key: r.Key || '', name: r.Name || '', colorHex: r.ColorHex || '#888', sortOrder: r.SortOrder || 0 };
}
const forgeCost = (store, rarityIndex) => { const c = setting(store, 'ForbiddenForgeCost'); return Math.max(1, Number(c[Math.min(c.length - 1, rarityIndex)]) || 1); };
function forgeChance(store, user, tier, cracks) {
  const base = Number(setting(store, 'ForbiddenForgeChance')[tier - 1]) || 0;
  const heart = heartOf(store, user).level >= 4 ? 0.15 : 0;
  return Math.min(0.95, base + (Number(cracks) || 0) * setting(store, 'ForbiddenForgeCrackBonus') + heart);
}
const forgeable = (p, card) => card && !p.Edition && !p.InVault && !card.IsSecret;

// Exemplaires du joueur regroupes (carte, finition, etat[, pierre]) : un
// representant par groupe (le plus fissure pour la forge).
function groups(store, user, filter, keyOf) {
  const rarities = sortedRarities(store);
  const out = new Map();
  for (const p of store.rowsBy('Pulls', 'User', user.id)) {
    const card = store.get('Cards', refId(p.Card));
    if (!filter(p, card)) continue;
    const k = `${card.id}|${p.Finish || 'normal'}|${p.Quality || 'good'}|${keyOf(p)}`;
    const cur = out.get(k);
    if (cur) { cur.count++; if ((Number(p.ForgeCracks) || 0) > cur.cracks) { cur.pullId = p.id; cur.cracks = Number(p.ForgeCracks) || 0; } continue; }
    out.set(k, { pullId: p.id, cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image), finish: p.Finish || 'normal', quality: p.Quality || 'good', count: 1, cracks: Number(p.ForgeCracks) || 0, gem: p.Gem || null, rarity: rarityInfo(store, card, rarities) });
  }
  return [...out.values()].sort((a, b) => b.rarity.sortOrder - a.rarity.sortOrder || a.name.localeCompare(b.name));
}

function atelier(store, user) {
  const owned = mineralsOf(user);
  const forge = groups(store, user, forgeable, () => '').map((g) => ({ ...g, cost: forgeCost(store, g.rarity.index) }));
  const gems = groups(store, user, (p, card) => card && p.Edition === 'forbidden', (p) => p.Gem || '');
  return {
    forge: {
      tiers: TIER_NAMES.map((name, i) => ({ tier: i + 1, name, owned: tierOwned(owned, i + 1), chance: forgeChance(store, user, i + 1, 0) })),
      crackBonus: setting(store, 'ForbiddenForgeCrackBonus'), heartBonus: heartOf(store, user).level >= 4 ? 0.15 : 0,
      cards: forge
    },
    gems: { cost: setting(store, 'ForbiddenGemCost'), minerals: MINERALS.map((m) => mineralView(m, Number(owned[m.key]) || 0)), cards: gems }
  };
}

function forge(store, user, body) {
  const p = store.get('Pulls', Number(body.pullId));
  const card = p && refId(p.User) === user.id ? store.get('Cards', refId(p.Card)) : null;
  if (!card || !forgeable(p, card)) return fail('not_forgeable', 400, atelier(store, user));
  const tier = Math.floor(Number(body.tier));
  if (!(tier >= 1 && tier <= 5)) return fail('invalid_tier');
  const ri = rarityInfo(store, card, sortedRarities(store));
  const cost = forgeCost(store, ri.index);
  const owned = mineralsOf(user);
  if (tierOwned(owned, tier) < cost) return fail('not_enough_minerals', 400, atelier(store, user));
  const chance = forgeChance(store, user, tier, p.ForgeCracks);
  const success = Math.random() < chance;
  store.update('Users', user.id, { Minerals: JSON.stringify(takeTier(owned, tier, cost)) });
  if (success) {
    store.update('Pulls', p.id, { Edition: 'forbidden', ForbiddenForged: 1 });
    if (ri.index >= 3) addFeed(store, { userId: user.id, kind: 'forbidden', icon: '⛓️', text: `a forgé ${card.Name} dans les flammes interdites.` });
  } else store.update('Pulls', p.id, { ForgeCracks: (Number(p.ForgeCracks) || 0) + 1 });
  const fresh = store.get('Users', user.id);
  return ok({ ...atelier(store, fresh), result: { success, chance, cost, tier, cardName: card.Name, pullId: p.id, cracks: success ? 0 : (Number(p.ForgeCracks) || 0) + 1 } });
}

function gem(store, user, body) {
  const p = store.get('Pulls', Number(body.pullId));
  if (!p || refId(p.User) !== user.id || p.Edition !== 'forbidden') return fail('not_forbidden_copy', 400, atelier(store, user));
  const m = BY_KEY.get(String(body.key || ''));
  if (!m) return fail('unknown_mineral');
  if (p.Gem === m.key) return fail('same_gem', 400, atelier(store, user));
  const cost = setting(store, 'ForbiddenGemCost');
  const owned = mineralsOf(user);
  if ((Number(owned[m.key]) || 0) < cost) return fail('not_enough_minerals', 400, atelier(store, user));
  owned[m.key] -= cost;
  const fresh = store.update('Users', user.id, { Minerals: JSON.stringify(owned) });
  store.update('Pulls', p.id, { Gem: m.key });
  return ok({ ...atelier(store, fresh), set: { pullId: p.id, key: m.key, name: m.name, img: 'Fouille/' + m.img, replaced: p.Gem || null } });
}

// ------------------------------------------------------------ transmutation
const FINISH_ORDER = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow', 'emerald'];
export const TRANSMUTE = { gold: { mineral: 'or', setting: 'ForbiddenGoldCost', label: 'Doré' }, diamond: { mineral: 'diamant', setting: 'ForbiddenDiamondCost', label: 'Diamant' } };
function transmuteCost(store, to, rarityKey) {
  const t = setting(store, TRANSMUTE[to].setting);
  return Math.max(1, Math.round(Number(t[rarityKey]) || Number(t.default) || 10));
}
export function transmuteView(store, user) {
  const owned = mineralsOf(user);
  const keys = sortedRarities(store).map((r) => r.Key).filter(Boolean);
  return Object.fromEntries(Object.entries(TRANSMUTE).map(([to, t]) => {
    const m = BY_KEY.get(t.mineral);
    return [to, { label: t.label, mineral: { key: m.key, name: m.name, img: 'Fouille/' + m.img }, own: Number(owned[m.key]) || 0, costs: Object.fromEntries(keys.map((k) => [k, transmuteCost(store, to, k)])) }];
  }));
}
function transmute(store, user, body) {
  const to = String(body.to || '');
  if (!TRANSMUTE[to]) return fail('invalid_finish');
  const p = store.get('Pulls', Number(body.pullId));
  const card = p && refId(p.User) === user.id ? store.get('Cards', refId(p.Card)) : null;
  const rarity = card ? store.get('Rarities', refId(card.Rarity)) : null;
  if (!card || !rarity || card.IsPromo || rarity.Key === 'unique' || p.InVault) return fail('not_transmutable');
  const from = p.Finish || 'normal';
  if (!(FINISH_ORDER.indexOf(from) < FINISH_ORDER.indexOf(to))) return fail('not_lower_finish');
  const t = TRANSMUTE[to];
  const cost = transmuteCost(store, to, rarity.Key);
  const owned = mineralsOf(user);
  if ((Number(owned[t.mineral]) || 0) < cost) return fail('not_enough_minerals', 400, { transmute: transmuteView(store, user) });
  owned[t.mineral] -= cost;
  const fresh = store.update('Users', user.id, { Minerals: JSON.stringify(owned) });
  store.update('Pulls', p.id, { Finish: to });
  const notices = masteryEvents(store, [{ type: 'fusion', userId: user.id }]);
  if (to === 'diamond' && (rarity.SortOrder || 0) >= 4) addFeed(store, { userId: user.id, kind: 'forbidden', icon: '💎', text: `change ${card.Name} en diamant.`, cardId: card.id });
  return ok({ transmuted: { pullId: p.id, cardId: card.id, name: card.Name, from, to, cost, mineral: BY_KEY.get(t.mineral).name }, transmute: transmuteView(store, fresh), notices });
}

export function stonesAction(store, user, body) {
  const a = body.action;
  if (a === 'atelier') return ok(atelier(store, user));
  if (a === 'forge') return forge(store, user, body);
  if (a === 'gem') return gem(store, user, body);
  if (a === 'heart') return ok({ heart: heartView(store, user) });
  if (a === 'feed') return feed(store, user, body);
  if (a === 'transmute') return transmute(store, user, body);
  return null;
}
export const STONE_ACTIONS = new Set(['atelier', 'forge', 'gem', 'heart', 'feed', 'transmute']);

// Collection : pierres serties (badge) et cartes forgees (decraft normal).
export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'collection' || response.status !== 200 || !response.json || typeof response.json !== 'object') return;
  const body = request.body || {};
  const userId = Number((request.query || {}).userId || body.userId);
  const gems = {}, info = {}, forged = [];
  for (const p of store.rowsBy('Pulls', 'User', userId)) {
    if (p.Gem && BY_KEY.has(p.Gem)) { gems[p.id] = p.Gem; const m = BY_KEY.get(p.Gem); info[m.key] = { name: m.name, img: 'Fouille/' + m.img, tier: m.tier }; }
    if (p.ForbiddenForged && p.Edition === 'forbidden') forged.push(p.id);
  }
  response.json.gemPulls = gems;
  response.json.gemInfo = info;
  response.json.forgedForbiddenPullIds = forged;
  // Transmutation : rien n'est dit tant que la porte est fermee (salle secrete).
  const user = store.get('Users', userId);
  if (user && Number(user.ForbiddenUnlocked) > 0) response.json.transmute = transmuteView(store, user);
}
