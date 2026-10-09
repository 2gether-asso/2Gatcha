// Tableaux de bord du joueur (2026-10-07) :
//  - "Que faire maintenant ?" : la liste triee de ce qui attend le joueur
//    (energie pleine, jardin pret, expedition rentree, boite du jour...).
//      GET /webhook/what-now ?userId=
//  - Statistiques perso : chance face a la moyenne, poussieres gagnees et
//    depensees par source, actions par activite, plus beaux tirages du mois.
//      GET /webhook/my-stats ?userId=
//  - Carte de joueur (survol d'un pseudo) : rang, titre, vitrine.
//      GET /webhook/player-card ?pseudo=

import { refId, now, ok, fail, userById, parisDay, parisHour, configRow, cardSummary, levelForXp } from './common.js';
import { setting } from './settings.js';
import { digLevel, levelInfo } from './levels.js';
import { decorations } from './cosmetics.js';
import { houseOf, luckyState, diceFace, eveningMissions, EVENING_START } from './daily.js';
import { rankOf, rankFor, collectionValues, valueMaps, pullValue, counts } from './progression.js';
import { talentRanks, TALENTS } from './talents.js';
import { growSeconds, PLOTS, seedMult } from './garden.js';

export const schema = { Users: { PullStats: { type: 'Text' }, DustLedger: { type: 'Text' } } };

const parse = (v, def) => { try { const x = JSON.parse(v || ''); return x == null ? def : x; } catch (e) { return def; } };
const hhmm = (t) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(t * 1000));

function digEnergy(store, user) {
  const cfg = configRow(store);
  const lvl = digLevel(store, user).level;
  const max = (Number(cfg.DigMaxEnergy) || 5) + Math.floor(lvl / 2);
  const regen = Math.round((Number(cfg.DigRegenSeconds) || 60) * (1 - 0.05 * (lvl - 1)));
  const stored = user.DigEnergy != null && user.DigEnergy !== '' ? Number(user.DigEnergy) : max;
  const elapsed = Math.max(0, now() - (Number(user.LastDigEnergyAt) || now()));
  return { energy: Math.min(max, stored + Math.floor(elapsed / regen)), max };
}

function whatNow(store, user) {
  const t = now(), today = parisDay(0), items = [];
  const add = (priority, key, icon, label, url) => items.push({ priority, key, icon, label, url });
  if (user.ReturnPending) add(100, 'welcome', '🎁', 'Bon retour ! Un colis de bienvenue t’attend', 'index.html#aujourdhui');
  const lucky = luckyState(t);
  if (lucky.active) add(98, 'lucky', '🍀', `Heure de chance jusqu’à ${hhmm(lucky.window.end)} : finitions et poussières boostées`, 'ouverture.html');
  if (user.LoginStreakDay !== today) add(95, 'streak', '🔥', 'Récupère le cadeau de ta série de connexion', 'index.html');
  if (user.BoxDay !== today) add(90, 'box', '🎁', 'Ouvre ta boîte du jour', 'index.html#aujourdhui');
  if (!diceFace(user)) add(85, 'dice', '🎲', 'Lance ton dé du jour', 'index.html#aujourdhui');
  const until = Number(user.ExpeditionUntil) || 0;
  if (until && until <= t) add(84, 'expedition', '🧭', 'Ton explorateur est rentré : récupère son butin', 'jeux.html#expedition');
  else if (!until) add(48, 'expedition-start', '🧭', 'Envoie une carte en expédition', 'jeux.html#expedition');
  let plots = [];
  try { plots = JSON.parse(user.GardenPlots || '[]'); } catch (e) { plots = []; }
  const grow = growSeconds(store, user);
  const planted = Array.from({ length: PLOTS + (Number(user.GardenExtraPlots) || 0) }, (_, i) => plots[i] && plots[i].plantedAt ? plots[i] : null);
  const ready = planted.filter((p) => p && p.plantedAt + Math.round(grow * seedMult(p)) <= t).length;
  const empty = planted.filter((p) => !p).length;
  if (ready) add(80, 'garden', '🌻', `${ready} parcelle${ready > 1 ? 's' : ''} prête${ready > 1 ? 's' : ''} à récolter`, 'jeux.html#jardin');
  else if (empty) add(44, 'garden-plant', '🌱', `${empty} parcelle${empty > 1 ? 's' : ''} vide${empty > 1 ? 's' : ''} au jardin`, 'jeux.html#jardin');
  const dig = digEnergy(store, user);
  if (dig.energy >= dig.max) add(76, 'dig', '⛏️', `Énergie de fouille pleine (${dig.max}/${dig.max})`, 'jeux.html#fouille');
  else if (dig.energy > 0) add(40, 'dig-some', '⛏️', `${dig.energy} coup${dig.energy > 1 ? 's' : ''} de pelle disponible${dig.energy > 1 ? 's' : ''}`, 'jeux.html#fouille');
  if ((Number(user.ChestCount) || 0) > 0 && (Number(user.KeyCount) || 0) > 0) add(72, 'chest', '🧰', 'Tu as un coffre et une clé : ouvre-le !', 'ouverture.html');
  const boosters = Number(user.BoosterCount) || 0;
  if (boosters > 0) add(lucky.active ? 97 : 70, 'boosters', '🎴', `${boosters} booster${boosters > 1 ? 's' : ''} à ouvrir`, 'ouverture.html');
  if (store.tables.has('Auctions') && store.getAll('Auctions').some((a) => a.Status === 'open' && refId(a.OutbidUser) === user.id && (a.OutbidAt || 0) > t - 86400 && refId(a.Bidder) !== user.id)) add(69, 'outbid', '🔨', 'On a surenchéri sur toi aux enchères', 'communaute.html#encheres');
  if (parisHour() >= EVENING_START) {
    const progress = user.EveningDay === today ? parse(user.EveningProgress, {}) : {};
    const claimedList = user.EveningDay === today ? parse(user.EveningClaimed, []) : [];
    const left = eveningMissions(today).filter((m) => (Number(progress[m.key]) || 0) < m.target).length;
    const claimable = eveningMissions(today).some((m) => (Number(progress[m.key]) || 0) >= m.target && !claimedList.includes(m.key));
    if (claimable) add(66, 'evening-claim', '🌙', 'Récupère tes missions du soir', 'index.html#aujourdhui');
    else if (left) add(62, 'evening', '🌙', `${left} mission${left > 1 ? 's' : ''} du soir à faire avant minuit`, 'index.html#aujourdhui');
  }
  if (user.GuessDate !== today) add(60, 'guess', '🔍', 'Devine la carte du jour', 'jeux.html#devine');
  if (user.LastWheelSpinDate !== today) add(59, 'wheel', '🎡', 'Fais tourner la roue du jour', 'jeux.html');
  const fishSt = { worms: Number(user.Worms) || 0, cost: setting(store, 'FishingCost') };
  if (fishSt.worms >= fishSt.cost) add(54, 'fishing', '🎣', `${fishSt.worms} ver${fishSt.worms > 1 ? 's' : ''} de terre : va pêcher`, 'jeux.html#peche');
  const level = levelForXp(user.XP);
  const spent = TALENTS.reduce((s, x) => s + Math.min(x.max, Number(talentRanks(user)[x.key]) || 0), 0);
  if (level - 1 > spent) add(52, 'talents', '🌳', `${level - 1 - spent} point${level - 1 - spent > 1 ? 's' : ''} de talent à dépenser`, 'profile.html#talents');
  const house = houseOf();
  add(50, 'house', house.icon, `Action du jour : ${house.label} (XP ×${setting(store, 'HouseXpMultiplier')})`, house.url);
  return items.sort((a, b) => b.priority - a.priority);
}

function handleWhatNow({ store, query }) {
  const user = userById(store, query.userId);
  if (!user) return fail('unknown_user', 404);
  return ok({ items: whatNow(store, user) });
}

// --- statistiques ---------------------------------------------------------------
const isBoosterBatch = (b) => /^\d+-\d+$/.test(String(b || ''));

function pullStatsOf(store, user) {
  const saved = parse(user.PullStats, null);
  if (saved && saved.cards >= 0) return saved;
  // Premiere fois : base reconstituee a partir des exemplaires de boosters encore possedes.
  const rarities = new Map(store.getAll('Rarities').map((r) => [r.id, r.Key]));
  const cards = new Map(store.getAll('Cards').map((c) => [c.id, refId(c.Rarity)]));
  const st = { cards: 0, packs: 0, rarity: {}, finish: {}, since: now(), rebuilt: true };
  const batches = new Set();
  for (const p of store.getAll('Pulls')) {
    if (refId(p.User) !== user.id || !isBoosterBatch(p.BatchId)) continue;
    batches.add(p.BatchId);
    st.cards++;
    const rk = rarities.get(cards.get(refId(p.Card))) || '?';
    st.rarity[rk] = (st.rarity[rk] || 0) + 1;
    st.finish[p.Finish || 'normal'] = (st.finish[p.Finish || 'normal'] || 0) + 1;
  }
  st.packs = batches.size;
  store.update('Users', user.id, { PullStats: JSON.stringify(st) });
  return st;
}

function handleMyStats({ store, query }) {
  const user = userById(store, query.userId);
  if (!user) return fail('unknown_user', 404);
  const ps = pullStatsOf(store, user);
  const rarities = store.getAll('Rarities').filter((r) => r.Key !== 'unique' && (Number(r.Weight) || 0) > 0).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  const totalW = rarities.reduce((s, r) => s + (Number(r.Weight) || 0), 0) || 1;
  const rarityRows = rarities.map((r) => ({ key: r.Key, name: r.Name, colorHex: r.ColorHex, count: ps.rarity[r.Key] || 0, pct: ps.cards ? Math.round(((ps.rarity[r.Key] || 0) / ps.cards) * 1000) / 10 : 0, expected: Math.round(((Number(r.Weight) || 0) / totalW) * 1000) / 10 }));
  const top = rarityRows.filter((r) => ['epique', 'legendaire', 'mythique'].includes(r.key));
  const expTop = top.reduce((s, r) => s + r.expected, 0), gotTop = top.reduce((s, r) => s + r.pct, 0);
  const special = ps.cards ? (ps.cards - (ps.finish.normal || 0)) / ps.cards : 0;
  const ledger = parse(user.DustLedger, { earned: {}, spent: {} });
  const maps = valueMaps(store);
  const monthStart = Math.floor(Date.parse(parisDay(0).slice(0, 8) + '01T00:00:00Z') / 1000);
  const best = store.getAll('Pulls').filter((p) => refId(p.User) === user.id && (Number(p.ObtainedAt) || 0) >= monthStart)
    .map((p) => ({ p, v: pullValue(maps, p) })).sort((a, b) => b.v - a.v).slice(0, 6)
    .map(({ p, v }) => ({ ...cardSummary(store, store.get('Cards', refId(p.Card)) || { id: refId(p.Card) }), serialNumber: p.SerialNumber || null, finish: p.Finish || 'normal', quality: p.Quality || 'damaged', starred: !!p.Starred, value: Math.round(v), obtainedAt: p.ObtainedAt || null }));
  const values = collectionValues(store);
  const all = [...values.values()].sort((a, b) => b - a);
  const mine = values.get(user.id) || 0;
  return ok({
    since: ps.since || null, rebuilt: !!ps.rebuilt,
    pulls: { cards: ps.cards, packs: ps.packs, rarities: rarityRows, luck: expTop ? Math.round((gotTop / expTop) * 100) : null, specialFinishPct: Math.round(special * 1000) / 10, specialFinishExpected: Math.round(setting(store, 'SpecialFinishChance') * 1000) / 10 },
    dust: { earned: ledger.earned || {}, spent: ledger.spent || {}, totalEarned: Object.values(ledger.earned || {}).reduce((s, n) => s + n, 0), totalSpent: Object.values(ledger.spent || {}).reduce((s, n) => s + n, 0) },
    activity: counts(user),
    collection: { value: Math.round(mine), rank: rankFor(store, mine), position: all.indexOf(mine) + 1, players: all.length },
    best
  });
}

// --- carte de joueur (survol) ---------------------------------------------------
function handlePlayerCard({ store, query }) {
  const pseudo = String(query.pseudo || '').trim().toLowerCase();
  const user = store.getAll('Users').find((u) => String(u.Pseudo || '').trim().toLowerCase() === pseudo);
  if (!user) return fail('unknown_user', 404);
  const showcase = store.tables.has('ProfileShowcase') ? store.getAll('ProfileShowcase').filter((r) => refId(r.User) === user.id).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0)).slice(0, 6)
    .map((r) => store.get('Cards', refId(r.Card))).filter(Boolean).map((c) => cardSummary(store, c)) : [];
  return ok({
    pseudo: user.Pseudo, avatar: user.DiscordAvatar || null, discordId: user.DiscordId || null, level: levelForXp(user.XP),
    rank: rankOf(store, user), decor: decorations(store, [user.id])[user.id] || null, showcase,
    skills: { fishing: levelInfo(user.FishingXP, setting(store, 'FishingLevelXpStep')).level, dig: digLevel(store, user).level }
  });
}

export const routes = { 'GET what-now': handleWhatNow, 'GET my-stats': handleMyStats, 'GET player-card': handlePlayerCard };

// Compteurs de tirage (statistiques) apres chaque booster, bonus compris.
export function afterWorkflow({ store, path, request, response }) {
  const body = request.body || {};
  if (path !== 'open-pack' || body.dryRun || response.status !== 200 || !response.json || !Array.isArray(response.json.cards) || !response.json.batchId) return;
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  const st = pullStatsOf(store, user);
  st.packs = (st.packs || 0) + 1;
  for (const c of response.json.cards) {
    st.cards = (st.cards || 0) + 1;
    const rk = c.rarity ? c.rarity.key : '?';
    st.rarity[rk] = (st.rarity[rk] || 0) + 1;
    st.finish[c.finish || 'normal'] = (st.finish[c.finish || 'normal'] || 0) + 1;
  }
  store.update('Users', user.id, { PullStats: JSON.stringify(st) });
}

// Grand livre des poussieres du joueur (appele par index.js a chaque variation).
export function ledgerFields(before, fields, source) {
  if (!('StardustCount' in fields) || !before) return null;
  const delta = (Number(fields.StardustCount) || 0) - (Number(before.StardustCount) || 0);
  if (!delta) return null;
  const l = parse(before.DustLedger, { earned: {}, spent: {} });
  l.earned = l.earned || {}; l.spent = l.spent || {};
  const k = source || 'autre';
  if (delta > 0) l.earned[k] = (l.earned[k] || 0) + delta; else l.spent[k] = (l.spent[k] || 0) - delta;
  return JSON.stringify(l);
}
