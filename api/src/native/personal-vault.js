// Coffre-fort perso (coffre.html) - remplace le workflow personal-vault.json.
//   POST /webhook/personal-vault { userId, action: 'status' | 'store' | 'withdraw', pullId? }
//
// Une fois la carte du coffre (Cards.IsVault) debloquee, chaque joueur peut y
// mettre ses cartes precieuses a l'abri. Une LIGNE = une carte, 6 emplacements
// (un par finition), parfait etat uniquement. Une carte rangee reste a son
// proprietaire (Pulls.InVault, numero conserve) mais quitte la collection
// active jusqu'a ce qu'il la retire. Cartes promo exclues (une seule
// finition possible).
//
// Ligne complete = recompense UNE seule fois (VaultRewards) : boosters +
// poussieres (VaultBoostersPerRow / VaultDustPerRow) + un Ticket Unique.
//
// Onglets par edition (2026-10-15) : l'onglet "Classique" ne prend que les
// cartes sans edition. Chaque edition limitee (editions.js) a son onglet, qui
// n'apparait qu'une fois une carte de cette edition obtenue, et qui marche
// exactement comme le Classique : une ligne par carte, 6 emplacements (un par
// finition), parfait etat, recompense de ligne complete une fois par carte ET
// par edition (VaultRewards.Edition, vide = Classique).
//
// 2026-10-25 : lignes rangees PAR EXTENSION (row.extension, le site les
// groupe). Carte EMERAUDE : une ligne complete donne en plus (ticket compris)
// un exemplaire en finition emeraude de la carte, cree directement dans le
// coffre (Pulls.VaultLocked) : il ne peut pas en sortir (ni retrait, ni
// echange, ni decraft : InVault l'exclut de tout le reste) et atteste de la
// maitrise de la carte. Une par carte et par edition ; rattrapage pour les
// lignes completees avant (au premier passage sur le coffre).
//
// V2 (2026-11-07) : NIVEAU DU COFFRE. Points de prestige = exemplaires ranges
// (VaultXpPerCard, emeraudes exclues) + lignes recompensees (VaultXpPerRow,
// toutes editions). Les paliers (VaultLevels) donnent une recompense une fois
// (action 'claimLevel', tous les paliers en attente d'un coup, retenu dans
// Users.VaultLevelClaimed : retirer des cartes peut faire redescendre le
// niveau, jamais reprendre une recompense) et des interets en poussieres a
// recuperer une fois par jour (action 'interest', Users.VaultInterestDay).
// 2026-11-16 : RENDEMENT. Interets x (1 + talent Banquier + talent de
// prestige Protecteur + amelioration Coffre blinde + VaultInterestBonusPct).
// Epargne : des jours non recuperes s'accumulent (VaultInterestBankDays,
// + 2 avec le talent Epargnant). Talent Conservateur : points de prestige
// du coffre en plus. Niveau max calcule sur le nombre de cartes du gatcha
// ECRIN (2026-11-16) : une place par mineral pour une carte sertie de cette
// pierre (Pulls.Gem, edition Interdite, stones.js). Rangee : Pulls.InVault +
// Pulls.VaultGem (hors des lignes de l'onglet Interdite). Points de prestige :
// VaultGemXp x palier du mineral. Un palier de mineraux complet : recompense
// une fois (VaultGemTierRewards, Users.VaultGemClaims) ; l'ecrin complet donne
// le titre « Joaillier ». Visible seulement porte de la salle ouverte ou avec
// une carte sertie (secret des joueurs). Actions 'storeGem' / 'withdrawGem'.
// (VaultLevelsFromCards, VaultMaxLevelPct) et 100 niveaux generes a partir
// des paliers VaultLevels (VaultLevelCount) ; voir levelTable.

import { refId, now, ok, fail, userById, firstAttachment, parseJson, nextSerial, parisDay } from './common.js';
import { EDITIONS } from './editions.js';
import { setting } from './settings.js';
import { addTicket, vaultSummary } from './unique.js';
import { talentValue } from './talents.js';
import { upgradeValue } from './upgrades.js';
import { MINERALS, TIER_NAMES } from './digdepth.js';
import { grantCosmetic } from './cosmetics.js';
import { pralineBonus } from './companions.js';

export const FINISHES = ['normal', 'holo', 'gold', 'ghost', 'diamond', 'rainbow'];

export const schema = {
  Pulls: { InVault: { type: 'Bool' }, VaultLocked: { type: 'Bool' }, VaultGem: { type: 'Bool' } },
  Users: { VaultLevelClaimed: { type: 'Numeric' }, VaultInterestDay: { type: 'Text' }, VaultGemClaims: { type: 'Text' } },
  VaultRewards: { User: { type: 'Ref:Users' }, Card: { type: 'Ref:Cards' }, ClaimedAt: { type: 'Numeric' }, Edition: { type: 'Text' } }
};

const finishOf = (p) => p.Finish || 'normal';
const qualityOf = (p) => p.Quality || 'damaged';

function isUnlocked(store, userId) {
  const vaultCard = store.getAll('Cards').find((c) => !!c.IsVault);
  return !!vaultCard && store.peekBy('Pulls', 'User', userId).some((p) => refId(p.Card) === vaultCard.id && String(p.BatchId || '').startsWith('vault-'));
}

const editionOf = (p) => p.Edition || '';
export const EMERALD = 'emerald';
const isEmerald = (p) => p.Finish === EMERALD;
// Lectures seules (peekBy, 2026-11-07) : exemplaires du joueur par l'index,
// regroupes par carte une fois (avant : toute la table, puis cartes x exemplaires).
function buildRows(store, userId, edition = '') {
  const cards = store.getAll('Cards');
  const myPulls = store.peekBy('Pulls', 'User', userId).filter((p) => editionOf(p) === edition && !p.VaultGem);
  const byCard = new Map();
  for (const p of myPulls) { const k = refId(p.Card); if (!byCard.has(k)) byCard.set(k, []); byCard.get(k).push(p); }
  const claimed = new Set(store.peekBy('VaultRewards', 'User', userId).filter((r) => (r.Edition || '') === edition).map((r) => refId(r.Card)));
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r]));
  const exts = new Map((store.tables.has('Extensions') ? store.getAll('Extensions') : []).map((e) => [e.id, e]));
  return cards.filter((c) => !c.IsPromo).map((card) => {
    const mine = (byCard.get(card.id) || []).filter((p) => qualityOf(p) === 'mint');
    if (!mine.length && !claimed.has(card.id)) return null;
    const slots = FINISHES.map((f) => {
      const stored = mine.find((p) => p.InVault && finishOf(p) === f);
      const candidates = mine.filter((p) => !p.InVault && finishOf(p) === f).map((p) => ({ pullId: p.id, serialNumber: p.SerialNumber }));
      return { finish: f, stored: stored ? { pullId: stored.id, serialNumber: stored.SerialNumber } : null, candidates };
    });
    const rarity = rarities.get(refId(card.Rarity));
    const filled = slots.filter((s) => s.stored).length;
    const ext = exts.get(refId(card.Extension));
    const emerald = (byCard.get(card.id) || []).find(isEmerald);
    return {
      cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image),
      rarity: rarity ? { key: rarity.Key, name: rarity.Name, colorHex: rarity.ColorHex, sortOrder: rarity.SortOrder || 0 } : null,
      extension: ext ? { id: ext.id, name: ext.Name || ext.Label || 'Extension', sortOrder: Number(ext.SortOrder) || ext.id } : { id: 0, name: 'Hors extension', sortOrder: 1e9 },
      slots, filled, emerald: emerald ? { pullId: emerald.id, serialNumber: emerald.SerialNumber } : null,
      complete: filled === FINISHES.length, claimed: claimed.has(card.id)
    };
  }).filter(Boolean).sort((a, b) => (a.extension.sortOrder - b.extension.sortOrder) || (b.filled - a.filled) || ((b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0)) || a.name.localeCompare(b.name));
}

// Exemplaire emeraude d'une carte maitrisee (ligne complete) : cree dans le
// coffre, verrouille. null s'il existe deja.
function grantEmerald(store, userId, cardId, edition = '') {
  const has = store.peekBy('Pulls', 'User', userId).some((p) => refId(p.Card) === cardId && isEmerald(p) && editionOf(p) === edition);
  if (has || !store.get('Cards', cardId)) return null;
  const pull = store.create('Pulls', {
    User: userId, Card: cardId, SerialNumber: nextSerial(store, cardId), Finish: EMERALD, Quality: 'mint',
    InVault: true, VaultLocked: true, ObtainedAt: now(), BatchId: `emerald-${userId}-${cardId}-${Date.now()}`, ...(edition ? { Edition: edition } : {})
  });
  return { pullId: pull.id, cardId, serialNumber: pull.SerialNumber, edition: edition || null };
}
// Lignes completees avant l'arrivee de l'emeraude : rattrapage.
function emeraldCatchUp(store, userId) {
  const out = [];
  const rewards = store.peekBy('VaultRewards', 'User', userId);
  if (!rewards.length) return out;
  const emeralds = new Set(store.peekBy('Pulls', 'User', userId).filter(isEmerald).map((p) => refId(p.Card) + '|' + editionOf(p)));
  for (const r of rewards) {
    if (emeralds.has(refId(r.Card) + '|' + (r.Edition || ''))) continue;
    const g = grantEmerald(store, userId, refId(r.Card), r.Edition || '');
    if (g) { const c = store.get('Cards', g.cardId); out.push({ ...g, cardName: c ? c.Name : '?' }); }
  }
  return out;
}

// Ligne de cette carte devenue complete (et jamais recompensee) : recompense.
function maybeReward(store, user, cardId, edition = '') {
  const row = buildRows(store, user.id, edition).find((r) => r.cardId === cardId);
  if (!row || !row.complete || row.claimed) return null;
  const boosters = setting(store, 'VaultBoostersPerRow');
  const dust = setting(store, 'VaultDustPerRow');
  const u = store.get('Users', user.id);
  store.update('Users', user.id, { BoosterCount: (Number(u.BoosterCount) || 0) + boosters, StardustCount: (Number(u.StardustCount) || 0) + dust });
  store.create('VaultRewards', { User: user.id, Card: cardId, ClaimedAt: now(), ...(edition ? { Edition: edition } : {}) });
  addTicket(store, user.id);
  const emerald = grantEmerald(store, user.id, cardId, edition);
  return { cardId, cardName: row.name, boosters, dust, ticket: 1, edition: edition || null, emerald };
}

// Editions deja obtenues par le joueur : exemplaires actuels + historique
// des tirages (l'onglet reste meme si la carte a ete echangee depuis).
function editionsSeen(store, userId, myPulls) {
  const seen = new Set(myPulls.filter((p) => p.Edition).map((p) => p.Edition));
  if (store.tables.has('PullHistory')) {
    for (const h of store.peekBy('PullHistory', 'User', userId)) {
      if (h.Kind !== 'created' && h.Kind !== 'changed') continue;
      const d = parseJson(h.Detail, null);
      if (d && d.edition) seen.add(d.edition);
    }
  }
  return seen;
}

// Un onglet par edition obtenue, avec les memes lignes que le Classique.
function buildEditionTabs(store, userId) {
  const myPulls = store.peekBy('Pulls', 'User', userId);
  const seen = editionsSeen(store, userId, myPulls);
  return Object.entries(EDITIONS).filter(([key]) => seen.has(key)).map(([key, e]) => {
    const rows = buildRows(store, userId, key);
    return {
      key, label: e.label, icon: e.icon, rows,
      stored: rows.reduce((n, r) => n + r.filled, 0),
      ready: rows.reduce((n, r) => n + r.slots.filter((x) => !x.stored && x.candidates.length).length, 0),
      complete: rows.filter((r) => r.complete).length
    };
  });
}

// ------------------------------------------------------------ niveau du coffre
// Points de prestige d'un coffre complet (2026-11-16) : toutes les cartes
// rangeables du gatcha (ni promo, ni carte du coffre, ni Unique) dans leurs 6
// finitions, plus la recompense de chaque ligne (Classique seulement : les
// editions limitees restent du bonus).
export function vaultMaxXp(store) {
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r.Key]));
  const n = store.getAll('Cards').filter((c) => !c.IsPromo && !c.IsVault && c.Active !== false && rarities.get(refId(c.Rarity)) !== 'unique').length;
  return n * (FINISHES.length * setting(store, 'VaultXpPerCard') + setting(store, 'VaultXpPerRow')) + MINERALS.reduce((s, m) => s + m.tier, 0) * setting(store, 'VaultGemXp');
}
// --------------------------------------------------------------- ecrin
const GEM_BY_KEY = new Map(MINERALS.map((m) => [m.key, m]));
export function gemXp(store, userId) {
  return store.peekBy('Pulls', 'User', userId).filter((p) => p.VaultGem && p.InVault && GEM_BY_KEY.has(p.Gem)).reduce((s, p) => s + GEM_BY_KEY.get(p.Gem).tier, 0) * setting(store, 'VaultGemXp');
}
function gemRewards(store) {
  const v = setting(store, 'VaultGemTierRewards');
  return TIER_NAMES.map((_, i) => ({ dust: Math.max(0, Number(v && v[i] && v[i].dust) || 0), boosters: Math.max(0, Math.floor(Number(v && v[i] && v[i].boosters) || 0)) }));
}
const gemClaimsOf = (u) => { const v = parseJson(u && u.VaultGemClaims, []); return Array.isArray(v) ? v : []; };
function gemCase(store, userId) {
  const u = store.get('Users', userId) || {};
  const pulls = store.peekBy('Pulls', 'User', userId).filter((p) => p.Gem && GEM_BY_KEY.has(p.Gem) && p.Edition === 'forbidden');
  if (!(Number(u.ForbiddenUnlocked) > 0) && !pulls.length) return null;
  const cards = new Map();
  const cardOf = (p) => { const id = refId(p.Card); if (!cards.has(id)) cards.set(id, store.get('Cards', id)); return cards.get(id); };
  const brief = (p) => { const c = cardOf(p); return { pullId: p.id, cardId: c ? c.id : null, name: c ? c.Name : '?', imageId: c ? firstAttachment(c.Image) : null, finish: finishOf(p), quality: qualityOf(p), serialNumber: p.SerialNumber }; };
  const claims = gemClaimsOf(u);
  const rewards = gemRewards(store);
  const per = setting(store, 'VaultGemXp');
  const slots = MINERALS.map((m) => {
    const mine = pulls.filter((p) => p.Gem === m.key);
    const stored = mine.find((p) => p.VaultGem && p.InVault);
    return { key: m.key, name: m.name, tier: m.tier, tierName: TIER_NAMES[m.tier - 1], img: 'Fouille/' + m.img, xp: m.tier * per, stored: stored ? brief(stored) : null, candidates: mine.filter((p) => !p.InVault).map(brief) };
  });
  const tiers = TIER_NAMES.map((name, i) => {
    const list = slots.filter((s) => s.tier === i + 1);
    return { tier: i + 1, name, total: list.length, filled: list.filter((s) => s.stored).length, claimed: claims.includes(i + 1), reward: rewards[i] };
  });
  return {
    slots, tiers, filled: slots.filter((s) => s.stored).length, total: slots.length, xp: gemXp(store, userId), perTier: per,
    ready: slots.filter((s) => !s.stored && s.candidates.length).length, gemCost: setting(store, 'ForbiddenGemCost')
  };
}
// Paliers de l'ecrin completes : recompenses une fois (et titre de l'ecrin complet).
function gemTierRewards(store, userId) {
  const cur = gemCase(store, userId);
  if (!cur) return null;
  const u = store.get('Users', userId);
  const claims = gemClaimsOf(u);
  const fresh = cur.tiers.filter((t) => t.filled === t.total && !claims.includes(t.tier));
  if (!fresh.length) return null;
  const boosters = fresh.reduce((n, t) => n + t.reward.boosters, 0), dust = fresh.reduce((n, t) => n + t.reward.dust, 0);
  store.update('Users', userId, { VaultGemClaims: JSON.stringify([...claims, ...fresh.map((t) => t.tier)]), BoosterCount: (Number(u.BoosterCount) || 0) + boosters, StardustCount: (Number(u.StardustCount) || 0) + dust });
  const titled = cur.filled === cur.total && grantCosmetic(store, userId, 'gem-jeweller', { type: 'title', label: 'Joaillier' });
  return { tiers: fresh.map((t) => ({ tier: t.tier, name: t.name })), boosters, dust, title: titled ? 'Joaillier' : null };
}
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
function levelTable(store) {
  const raw = setting(store, 'VaultLevels');
  let list = (Array.isArray(raw) ? raw : []).map((l, i) => ({
    level: i + 1, xp: Math.max(0, Number(l && l.xp) || 0), name: String((l && l.name) || `Niveau ${i + 1}`),
    boosters: Math.max(0, Math.floor(Number(l && l.boosters) || 0)), dust: Math.max(0, Math.floor(Number(l && l.dust) || 0)), interest: Math.max(0, Math.floor(Number(l && l.interest) || 0))
  }));
  if (!list.length) return [{ level: 1, xp: 0, name: 'Coffre', boosters: 0, dust: 0, interest: 0 }];
  const last = list[list.length - 1].xp;
  // Niveau max calcule sur le gatcha (VaultLevelsFromCards) : le dernier palier
  // tombe a VaultMaxLevelPct % du coffre complet. Il suit le catalogue : une
  // nouvelle extension le recule.
  const computed = setting(store, 'VaultLevelsFromCards') ? Math.round(vaultMaxXp(store) * Math.max(1, setting(store, 'VaultMaxLevelPct')) / 100) : 0;
  const target = computed > 0 ? computed : last;
  const count = Math.max(2, setting(store, 'VaultLevelCount'));
  // 100 niveaux (2026-11-16) : les niveaux de VaultLevels deviennent des
  // PALIERS (Coffre de fer I a X, Coffre renforce I a X...), VaultLevelCount
  // niveaux en tout. Points sur une courbe (premiers niveaux rapides, puis de
  // plus en plus longs), interets interpoles entre les paliers et doubles au
  // sommet, boosters tous les 5 niveaux (plus tous les 10), poussieres a
  // chaque niveau.
  if (count > list.length) {
    const T = list.length;
    const at = (key, pos) => { const i = Math.min(T - 2, Math.floor(pos)); const k = pos - i; return T < 2 ? list[0][key] : list[i][key] * (1 - k) + list[i + 1][key] * k; };
    const out = [];
    let prev = 0;
    for (let i = 1; i <= count; i++) {
      const f = (i - 1) / (count - 1);
      const tier = Math.min(T - 1, Math.floor(((i - 1) * T) / count));
      const tierStart = Math.ceil((tier * count) / T) + 1;
      const sub = i - tierStart;
      const xp = i === 1 ? 0 : Math.max(prev + 1, Math.round(target * f ** 1.5));
      prev = xp;
      out.push({
        level: i, xp, tier: tier + 1,
        name: i === count ? list[T - 1].name : `${list[tier].name} ${ROMAN[sub] || sub + 1}`,
        boosters: i % 10 === 0 ? 2 + Math.floor(i / 25) : i % 5 === 0 ? 1 : 0,
        dust: i === 1 ? 0 : Math.round((20 + 3 * i) / 5) * 5,
        interest: Math.round(at('interest', f * (T - 1)) * (1 + f))
      });
    }
    return out;
  }
  if (target !== last && last > 0) {
    let prev = 0;
    list = list.map((l, i) => { const xp = i === 0 ? 0 : Math.max(prev + 1, Math.round((l.xp / last) * target)); prev = xp; return { ...l, xp }; });
  }
  return list;
}
export function vaultLevel(store, userId) {
  const u = store.get('Users', userId) || {};
  const table = levelTable(store);
  const stored = store.peekBy('Pulls', 'User', userId).filter((p) => p.InVault && !isEmerald(p) && !p.VaultGem).length;
  const rows = store.peekBy('VaultRewards', 'User', userId).length;
  const perCard = setting(store, 'VaultXpPerCard'), perRow = setting(store, 'VaultXpPerRow');
  const baseXp = stored * perCard + rows * perRow;
  const gems = gemXp(store, userId);
  const xp = Math.round((baseXp + gems) * (1 + Math.min(1, talentValue(u, 'curator')) + pralineBonus(store, u).vaultXp));
  let i = 0;
  while (i + 1 < table.length && xp >= table[i + 1].xp) i++;
  const cur = table[i], next = table[i + 1] || null;
  const claimed = Math.max(1, Number(u.VaultLevelClaimed) || 1);
  const pending = table.filter((l) => l.level > claimed && l.level <= cur.level && (l.boosters || l.dust));
  return {
    level: cur.level, name: cur.name, xp, stored, rows, perCard, perRow, gemXp: gems,
    floor: cur.xp, next: next ? { level: next.level, xp: next.xp, name: next.name, boosters: next.boosters, dust: next.dust, interest: next.interest } : null,
    ...interestOf(store, u, cur.interest),
    claimedLevel: claimed, pending, levels: table, maxXp: vaultMaxXp(store)
  };
}
// Interets du jour (rendement) et jours accumules (epargne).
const dayNum = (d) => Math.floor(Date.parse(d + 'T12:00:00Z') / 86400000);
function interestOf(store, u, base) {
  // Praline la tortue (compagnons V2) : interets et jours mis de cote.
  const pr = pralineBonus(store, u);
  const rate = Math.min(3, talentValue(u, 'banker') + upgradeValue(u, 'vault') + Math.max(0, setting(store, 'VaultInterestBonusPct')) / 100 + pr.rate);
  const perDay = Math.round(base * (1 + rate));
  const bank = Math.max(1, setting(store, 'VaultInterestBankDays') + Math.round(talentValue(u, 'saver')) + pr.bankDays);
  const today = parisDay();
  const last = u.VaultInterestDay ? dayNum(u.VaultInterestDay) : null;
  const days = last == null ? 1 : Math.max(0, Math.min(bank, dayNum(today) - last));
  return { interest: perDay * days, interestPerDay: perDay, interestBase: base, interestRate: Math.round(rate * 1000) / 10, interestDays: days, interestBankDays: bank, interestReady: base > 0 && days > 0 };
}
function grant(store, userId, boosters, dust) {
  const u = store.get('Users', userId);
  store.update('Users', userId, { BoosterCount: (Number(u.BoosterCount) || 0) + boosters, StardustCount: (Number(u.StardustCount) || 0) + dust });
}

function payload(store, userId, reward = null) {
  const emeraldGrants = emeraldCatchUp(store, userId);
  return {
    unlocked: true,
    emeraldGrants,
    rows: buildRows(store, userId),
    editions: buildEditionTabs(store, userId),
    boostersPerRow: setting(store, 'VaultBoostersPerRow'),
    dustPerRow: setting(store, 'VaultDustPerRow'),
    unique: vaultSummary(store, userId),
    level: vaultLevel(store, userId),
    gemCase: gemCase(store, userId),
    reward
  };
}

function handleVault({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = (body.action || 'status').toString();
  if (!isUnlocked(store, user.id)) return action === 'status' ? ok({ unlocked: false }) : fail('vault_locked');
  if (action === 'status') return ok(payload(store, user.id));

  // Recompenses des paliers atteints (toutes celles en attente d'un coup).
  if (action === 'claimLevel') {
    const lv = vaultLevel(store, user.id);
    if (lv.level <= lv.claimedLevel) return fail('nothing_to_claim');
    const boosters = lv.pending.reduce((n, l) => n + l.boosters, 0), dust = lv.pending.reduce((n, l) => n + l.dust, 0);
    grant(store, user.id, boosters, dust);
    // Coffres V2 : une piece de gatchapon tous les 10 niveaux du coffre.
    const coins = lv.levels.length > 10 ? lv.pending.filter((l) => l.level % 10 === 0).length : 0;
    if (coins) { const u1 = store.get('Users', user.id); store.update('Users', user.id, { ChestCount: (Number(u1.ChestCount) || 0) + coins }); }
    store.update('Users', user.id, { VaultLevelClaimed: lv.level });
    return ok({ ...payload(store, user.id), levelReward: { level: lv.level, name: lv.name, boosters, dust, coins, levels: lv.pending.map((l) => l.level) } });
  }
  // Interets du jour (une fois par jour, heure de Paris).
  if (action === 'interest') {
    const lv = vaultLevel(store, user.id);
    if (!lv.interestBase) return fail('no_interest');
    if (!lv.interestReady) return fail('already_claimed_today');
    grant(store, user.id, 0, lv.interest);
    store.update('Users', user.id, { VaultInterestDay: parisDay() });
    return ok({ ...payload(store, user.id), interestGained: lv.interest, interestDays: lv.interestDays });
  }

  // Ecrin : une carte sertie dans la place de sa pierre.
  if (action === 'storeGem' || action === 'withdrawGem') {
    const p = store.get('Pulls', Number(body.pullId));
    if (!p || refId(p.User) !== user.id) return fail('pull_not_owned');
    if (action === 'withdrawGem') {
      if (!p.VaultGem || !p.InVault) return fail('not_stored');
      store.update('Pulls', p.id, { InVault: false, VaultGem: false });
      return ok(payload(store, user.id));
    }
    if (p.Edition !== 'forbidden' || !GEM_BY_KEY.has(p.Gem)) return fail('not_gem_set');
    if (p.InVault) return fail('already_stored');
    if (p.Insured) return fail('protected_copy');
    if (store.peekBy('Pulls', 'User', user.id).some((x) => x.VaultGem && x.InVault && x.Gem === p.Gem)) return fail('slot_filled');
    store.update('Pulls', p.id, { InVault: true, VaultGem: true });
    const gemReward = gemTierRewards(store, user.id);
    const m = GEM_BY_KEY.get(p.Gem);
    return ok({ ...payload(store, user.id), gemStored: { key: m.key, name: m.name, tier: m.tier, xp: m.tier * setting(store, 'VaultGemXp') }, gemReward });
  }

  if (action === 'store' || action === 'withdraw') {
    const t0 = store.get('Pulls', Number(body.pullId));
    const target = t0 && refId(t0.User) === user.id ? t0 : null;
    if (!target) return fail('pull_not_owned');
    const cardId = refId(target.Card);
    if (action === 'withdraw') {
      if (!target.InVault) return fail('not_stored');
      if (target.VaultLocked || isEmerald(target)) return fail('emerald_locked');
    if (target.VaultGem) return fail('gem_case_copy');
      store.update('Pulls', target.id, { InVault: false });
      return ok(payload(store, user.id));
    }
    if (target.InVault) return fail('already_stored');
    const card = store.get('Cards', cardId);
    if (!card || card.IsPromo) return fail('promo_not_storable');
    if (qualityOf(target) !== 'mint') return fail('not_mint');
    const mine = store.peekBy('Pulls', 'User', user.id).filter((p) => refId(p.Card) === cardId);
    const ed = editionOf(target);
    if (mine.some((p) => p.InVault && editionOf(p) === ed && finishOf(p) === finishOf(target))) return fail('slot_filled');
    store.update('Pulls', target.id, { InVault: true });
    return ok(payload(store, user.id, maybeReward(store, user, cardId, ed)));
  }

  return fail('unknown_action');
}

export const routes = { 'POST personal-vault': handleVault };
