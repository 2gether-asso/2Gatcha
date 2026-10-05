// Succes caches et collections thematiques (2026-10-05).
//
// Succes caches : actions surprenantes (pecher 10 bottes, finir une grille en
// laissant 3 cases, pecher la nuit...). Invisibles ("???") tant qu'ils ne
// sont pas debloques ; chacun rapporte HiddenAchievementDust poussieres.
// Compteurs et dates dans Users.HiddenStats / Users.HiddenAchievements (JSON).
//
// Collections thematiques : objectifs transverses aux extensions (une carte
// de chaque rarete, 5 cartes dorees, une carte de chaque artiste...). Une
// fois complete, la collection se reclame : poussieres + titre (cosmetics.js).
//   POST /webhook/themes { userId, action: 'status' | 'claim', key? }
//   GET  /webhook/achievements-hidden ?userId= (public : profil)

import { refId, now, ok, fail, userById } from './common.js';
import { setting } from './settings.js';
import { grantCosmetic } from './cosmetics.js';

export const HIDDEN = [
  { key: 'boots10', label: 'Collectionneur de bottes', desc: 'Pêcher 10 vieilles bottes.', icon: '🥾', stat: 'boots', target: 10 },
  { key: 'stormPart', label: 'Dans l’œil du cyclone', desc: 'Pêcher une pièce détachée pendant l’orage.', icon: '⛈️' },
  { key: 'nightFisher', label: 'Pêcheur de nuit', desc: 'Pêcher entre minuit et 5 h.', icon: '🌙' },
  { key: 'cleanBoard', label: 'Travail soigné', desc: 'Terminer une grille de fouille en laissant 3 cases intactes.', icon: '🧹' },
  { key: 'lucky', label: 'Coup de filet', desc: '3 prises rares ou mieux dans un même lancer.', icon: '🍀' },
  { key: 'fish100', label: 'Vieux loup de mer', desc: 'Lancer sa ligne 100 fois.', icon: '⚓', stat: 'fish', target: 100 },
  { key: 'board25', label: 'Taupe professionnelle', desc: 'Terminer 25 grilles de fouille.', icon: '🦫', stat: 'boards', target: 25 },
  { key: 'trader10', label: 'Marchand de 2gether', desc: 'Réaliser 10 échanges.', icon: '🤝', stat: 'trades', target: 10 },
  { key: 'gardener20', label: 'Main verte', desc: 'Récolter 20 fois au jardin.', icon: '🌻', stat: 'harvests', target: 20 },
  { key: 'unique', label: 'Pièce de musée', desc: 'Obtenir une carte Unique.', icon: '🍀' },
  { key: 'prestige', label: 'Recommencer pour mieux briller', desc: 'Passer un métier en prestige.', icon: '🌟' },
  { key: 'boss50', label: 'Fléau des boss', desc: 'Envoyer 50 cartes aux boss.', icon: '🗡️', stat: 'boss', target: 50 },
  { key: 'broke', label: 'Fauché', desc: 'Tomber à 0 poussière.', icon: '🕳️' },
  { key: 'rich', label: 'Tas d’étoiles', desc: 'Avoir 5 000 poussières en même temps.', icon: '💰' }
];

export const THEMES = [
  { key: 'rarities', label: 'Arc des raretés', desc: 'Une carte de chaque rareté (Commune à Mythique).', icon: '🌈', title: 'Gardien des raretés' },
  { key: 'gold5', label: 'Doré sur tranche', desc: '5 cartes différentes en finition dorée.', icon: '🥇', title: 'Doré sur tranche', target: 5 },
  { key: 'rainbow3', label: 'Au bout de l’arc-en-ciel', desc: '3 cartes différentes en arc-en-ciel.', icon: '🌈', title: 'Chasseur d’arcs-en-ciel', target: 3 },
  { key: 'mint20', label: 'Comme neuves', desc: '20 cartes différentes en parfait état.', icon: '💎', title: 'Perfectionniste', target: 20 },
  { key: 'serial3', label: 'Les pionniers', desc: '3 cartes portant le numéro #001.', icon: '🏆', title: 'Pionnier', target: 3 },
  { key: 'artists', label: 'Galerie des artistes', desc: 'Une carte de chaque artiste.', icon: '🎨', title: 'Mécène des arts' },
  { key: 'sixFinishes', label: 'Toutes les couleurs', desc: 'Une même carte dans les 6 finitions.', icon: '✨', title: 'Alchimiste' },
  { key: 'extensions', label: 'Grand voyageur', desc: 'Au moins une carte de chaque extension.', icon: '🗺️', title: 'Grand voyageur' }
];

export const schema = {
  Users: { HiddenStats: { type: 'Text' }, HiddenAchievements: { type: 'Text' } },
  ThemeClaims: { User: { type: 'Ref:Users' }, Theme: { type: 'Text' }, ClaimedAt: { type: 'Numeric' } }
};

const parse = (v, def) => { try { const x = JSON.parse(v || ''); return x == null ? def : x; } catch (e) { return def; } };

// Debloque un succes cache (une seule fois) ; renvoie l'annonce ou null.
export function unlockHidden(store, userId, key) {
  const user = store.get('Users', userId);
  const def = HIDDEN.find((h) => h.key === key);
  if (!user || !def) return null;
  const got = parse(user.HiddenAchievements, {});
  if (got[key]) return null;
  got[key] = now();
  store.update('Users', userId, { HiddenAchievements: JSON.stringify(got), StardustCount: (Number(user.StardustCount) || 0) + setting(store, 'HiddenAchievementDust') });
  return { userId, kind: 'achievement', icon: def.icon, label: `Succès secret débloqué : ${def.label} (+${setting(store, 'HiddenAchievementDust')} ✨)` };
}

const STAT_OF = { 'fishCatch:nothing': 'boots', fish: 'fish', board: 'boards', tradeDone: 'trades', harvest: 'harvests', bossAttack: 'boss' };

export function onEvents(store, events) {
  const notices = [];
  for (const e of events) {
    const push = (n) => { if (n) notices.push(n); };
    const stat = STAT_OF[e.type];
    if (stat) {
      const user = store.get('Users', e.userId);
      if (!user) continue;
      const stats = parse(user.HiddenStats, {});
      stats[stat] = (stats[stat] || 0) + e.n;
      store.update('Users', e.userId, { HiddenStats: JSON.stringify(stats) });
      for (const h of HIDDEN) if (h.stat === stat && stats[stat] >= h.target) push(unlockHidden(store, e.userId, h.key));
    }
    if (e.type === 'fishCatch:part' && e.meta.weather === 'orage') push(unlockHidden(store, e.userId, 'stormPart'));
    if (e.type === 'fish' && e.meta.hour != null && e.meta.hour < 5) push(unlockHidden(store, e.userId, 'nightFisher'));
    if (e.type === 'board' && !e.meta.dog && e.meta.leftover >= 3) push(unlockHidden(store, e.userId, 'cleanBoard'));
    if (e.type === 'fishLucky') push(unlockHidden(store, e.userId, 'lucky'));
    if (e.type === 'unique') push(unlockHidden(store, e.userId, 'unique'));
    if (e.type === 'prestige') push(unlockHidden(store, e.userId, 'prestige'));
  }
  return notices;
}

// Appele par le journal de l'economie a chaque changement de solde.
export function onBalance(store, user) {
  const out = [];
  const dust = Number(user.StardustCount) || 0;
  if (dust === 0) out.push(unlockHidden(store, user.id, 'broke'));
  if (dust >= 5000) out.push(unlockHidden(store, user.id, 'rich'));
  return out.filter(Boolean);
}

export function hiddenList(store, user) {
  const got = parse(user.HiddenAchievements, {});
  const stats = parse(user.HiddenStats, {});
  return HIDDEN.map((h) => got[h.key]
    ? { key: h.key, unlocked: true, label: h.label, desc: h.desc, icon: h.icon, at: got[h.key] }
    : { key: h.key, unlocked: false, label: '???', desc: h.target ? `Progression : ${Math.min(stats[h.stat] || 0, h.target)} / ?` : 'Un succès secret…', icon: '❔' });
}

function handleHidden({ store, query }) {
  const user = store.get('Users', Number(query.userId));
  if (!user) return fail('unknown_user', 404);
  const list = hiddenList(store, user);
  return ok({ achievements: list, unlocked: list.filter((a) => a.unlocked).length, total: list.length });
}

// --- collections thematiques ----------------------------------------------
function themeProgress(store, userId) {
  const cards = new Map(store.getAll('Cards').map((c) => [c.id, c]));
  const rarities = store.getAll('Rarities');
  const pulls = store.getAll('Pulls').filter((p) => refId(p.User) === userId);
  const ownedIds = new Set(pulls.map((p) => refId(p.Card)));
  const distinct = (pred) => new Set(pulls.filter(pred).map((p) => refId(p.Card))).size;
  const playable = [...cards.values()].filter((c) => c.Active !== false && !c.IsPromo);
  const rarityKeys = rarities.filter((r) => ['commune', 'rare', 'epique', 'legendaire', 'mythique'].includes(r.Key) && playable.some((c) => refId(c.Rarity) === r.id));
  const ownedRarities = rarityKeys.filter((r) => [...ownedIds].some((id) => refId(cards.get(id)?.Rarity) === r.id)).length;
  const artists = [...new Set(playable.map((c) => (c.Artist || '').trim()).filter(Boolean))];
  const ownedArtists = artists.filter((a) => [...ownedIds].some((id) => (cards.get(id)?.Artist || '').trim() === a)).length;
  const finishesByCard = new Map();
  pulls.forEach((p) => { const id = refId(p.Card); if (!finishesByCard.has(id)) finishesByCard.set(id, new Set()); finishesByCard.get(id).add(p.Finish || 'normal'); });
  const bestFinishes = Math.max(0, ...[...finishesByCard.values()].map((s) => s.size));
  const exts = store.tables.has('Extensions') ? store.getAll('Extensions').filter((e) => e.Active !== false && playable.some((c) => refId(c.Extension) === e.id)) : [];
  const ownedExts = exts.filter((e) => [...ownedIds].some((id) => refId(cards.get(id)?.Extension) === e.id)).length;
  return {
    rarities: [ownedRarities, rarityKeys.length || 1],
    gold5: [distinct((p) => p.Finish === 'gold'), 5],
    rainbow3: [distinct((p) => p.Finish === 'rainbow'), 3],
    mint20: [distinct((p) => p.Quality === 'mint'), 20],
    serial3: [pulls.filter((p) => p.SerialNumber === 1).length, 3],
    artists: [ownedArtists, artists.length || 1],
    sixFinishes: [bestFinishes, 6],
    extensions: [ownedExts, exts.length || 1]
  };
}

export function themesState(store, userId) {
  const prog = themeProgress(store, userId);
  const claimed = new Set(store.getAll('ThemeClaims').filter((r) => refId(r.User) === userId).map((r) => r.Theme));
  const themes = THEMES.map((t) => {
    const [have, need] = prog[t.key];
    return { key: t.key, label: t.label, desc: t.desc, icon: t.icon, title: t.title, have: Math.min(have, need), need, done: have >= need, claimed: claimed.has(t.key) };
  });
  return { themes, reward: { dust: setting(store, 'ThemeRewardDust') }, claimable: themes.filter((t) => t.done && !t.claimed).length };
}

function handleThemes({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if ((body.action || 'status') === 'claim') {
    const st = themesState(store, user.id);
    const todo = st.themes.filter((t) => t.done && !t.claimed && (!body.key || t.key === body.key));
    if (!todo.length) return fail('nothing_to_claim');
    const dust = st.reward.dust * todo.length;
    for (const t of todo) {
      store.create('ThemeClaims', { User: user.id, Theme: t.key, ClaimedAt: now() });
      grantCosmetic(store, user.id, `theme-${t.key}`, { type: 'title', label: t.title });
    }
    const u = store.get('Users', user.id);
    store.update('Users', user.id, { StardustCount: (Number(u.StardustCount) || 0) + dust });
    return ok({ ...themesState(store, user.id), claimedNow: todo.map((t) => ({ key: t.key, title: t.title })), dust });
  }
  return ok(themesState(store, user.id));
}

export const routes = {
  'POST themes': handleThemes,
  'GET achievements-hidden': handleHidden
};

