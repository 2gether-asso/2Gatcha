// Carnet des metiers (2026-11-16) : de quoi continuer a jouer a la fouille,
// la peche, le jardin, l'archeologie et la cuisine une fois les niveaux
// atteints. Trois choses, renouvelees chaque lundi (weekKey) :
//  1. CONTRATS : 2 contrats par metier (tires au sort par joueur et par
//     semaine dans POOLS), chacun en 3 paliers (bronze, argent, or) sur le meme
//     compteur. Chaque palier atteint paie aussitot (poussieres
//     MetierContractDust, jetons de maitre, une ressource du metier a
//     l'argent). Les 10 contrats en or : GRAND CHELEM (MetierSlamTokens
//     jetons, titre « Maitre des cinq metiers » la premiere fois).
//  2. LEGENDES : une trouvaille legendaire par metier et par semaine (nom tire
//     de la semaine), chance a chaque action du metier et garantie au bout de
//     `pity` actions. Rapporte MetierLegendDust poussieres + jetons, s'inscrit
//     au Cabinet des legendes (Users.MetierLegends) et au fil d'actualite.
//  3. COMPTOIR DES MAITRES : les jetons (Users.MasterTokens) s'echangent
//     contre des ressources des metiers (appats dores, tablettes, os,
//     ingredients rares, crane de dino...) et des titres.
// Progression alimentee par le bus d'activite (activity.js, abonne dans index.js).
//   POST /webhook/metiers { userId, action: 'status' | 'buy', key? }

import { ok, fail, userById, parseJson, hash, now, weekEndsAt, refId } from './common.js';
import { weekKey } from './levels.js';
import { setting } from './settings.js';
import { addFeed } from './feed.js';
import { grantCosmetic } from './cosmetics.js';
import { addTabletsFields } from './archeo.js';
import { pantryFields } from './cooking.js';
import { foodOf } from './dino.js';
import { addCoins } from './chests.js';
// Coffres V2 : piece de couleur d'une legende, selon le metier.
const LEGEND_COIN = { dig: 'explorer', fish: 'pets', garden: 'nature', archeo: 'explorer', cook: 'nature' };

export const schema = { Users: { MasterTokens: { type: 'Numeric' }, MetierWeek: { type: 'Text' }, MetierLegends: { type: 'Text' } } };

const RARE_FISH = new Set(['rare', 'epique', 'legendaire', 'mythique']);
const sum = (evs, f = () => true, n = (e) => Number(e.n) || 1) => evs.filter(f).reduce((s, e) => s + n(e), 0);

export const METIERS = {
  dig: { label: 'Fouille', icon: '⛏️', url: 'jeux.html#fouille' },
  fish: { label: 'Pêche', icon: '🎣', url: 'jeux.html#peche' },
  garden: { label: 'Jardin', icon: '🌱', url: 'jeux.html#jardin' },
  archeo: { label: 'Archéologie', icon: '🏺', url: 'jeux.html#archeologie' },
  cook: { label: 'Cuisine', icon: '🍲', url: 'jeux.html#cuisine' }
};

// count(evenements du joueur) -> avancement de ce contrat.
const POOLS = {
  dig: [
    { key: 'dig', label: 'Creuser {n} case{s}', targets: [60, 150, 300], count: (e) => sum(e, (x) => x.type === 'dig') },
    { key: 'treasure', label: 'Dégager {n} trésor{s}', targets: [10, 25, 50], count: (e) => sum(e, (x) => x.type === 'treasure') },
    { key: 'board', label: 'Terminer {n} grille{s} de fouille', targets: [2, 5, 10], count: (e) => sum(e, (x) => x.type === 'board') }
  ],
  fish: [
    { key: 'cast', label: 'Lancer {n} fois la ligne', targets: [30, 80, 160], count: (e) => sum(e, (x) => x.type === 'fish') },
    { key: 'species', label: 'Remonter {n} poisson{s} de l’aquarium', targets: [5, 12, 25], count: (e) => sum(e, (x) => x.type === 'fishSpecies') },
    { key: 'rare', label: 'Remonter {n} poisson{s} rare{s} ou mieux', targets: [1, 3, 6], count: (e) => sum(e, (x) => x.type === 'fishSpecies', (x) => ((x.meta && x.meta.rarities) || []).filter((r) => RARE_FISH.has(r)).length) },
    { key: 'far', label: 'Lancer {n} fois loin du rivage', targets: [15, 40, 80], count: (e) => sum(e, (x) => x.type === 'fish' && x.meta && x.meta.zone && x.meta.zone !== 'shore') }
  ],
  garden: [
    { key: 'harvest', label: 'Récolter {n} parcelle{s}', targets: [6, 15, 30], count: (e) => sum(e, (x) => x.type === 'harvest') },
    { key: 'rare', label: 'Obtenir {n} récolte{s} rare{s}', targets: [1, 2, 4], count: (e) => sum(e, (x) => x.type === 'harvest', (x) => Number(x.meta && x.meta.rare) || 0) },
    { key: 'bait', label: 'Récolter {n} appât{s} doré{s}', targets: [1, 3, 6], count: (e) => sum(e, (x) => x.type === 'harvest', (x) => Number(x.meta && x.meta.bait) || 0) }
  ],
  archeo: [
    { key: 'tablet', label: 'Dégager {n} tablette{s}', targets: [1, 3, 6], count: (e) => sum(e, (x) => x.type === 'tablet') },
    { key: 'perfect', label: 'Réussir {n} tablette{s} parfaite{s}', targets: [1, 2, 4], count: (e) => sum(e, (x) => x.type === 'tablet' && x.meta && x.meta.perfect) },
    { key: 'freed', label: 'Nettoyer {n} trouvaille{s}', targets: [3, 8, 15], count: (e) => sum(e, (x) => x.type === 'archeoFreed') }
  ],
  cook: [
    { key: 'cook', label: 'Cuisiner {n} plat{s}', targets: [3, 8, 15], count: (e) => sum(e, (x) => x.type === 'cook') },
    { key: 'perfect', label: 'Réussir {n} cuisson{s} parfaite{s}', targets: [1, 3, 6], count: (e) => sum(e, (x) => x.type === 'cook' && x.meta && Number(x.meta.q) >= 3) },
    { key: 'deliver', label: 'Livrer {n} commande{s}', targets: [2, 5, 10], count: (e) => sum(e, (x) => x.type === 'cookDeliver') }
  ]
};
const STAGES = [{ key: 'bronze', label: 'Bronze', icon: '🥉', tokens: 1 }, { key: 'silver', label: 'Argent', icon: '🥈', tokens: 2 }, { key: 'gold', label: 'Or', icon: '🥇', tokens: 3 }];
// Ressource du metier donnee au palier Argent.
const SILVER = {
  dig: { label: '5 os', fields: (u) => ({ BoneCount: (Number(u.BoneCount) || 0) + 5 }) },
  fish: { label: '25 vers de terre', fields: (u) => ({ Worms: (Number(u.Worms) || 0) + 25 }) },
  garden: { label: '1 appât doré', fields: (u) => ({ GoldBait: (Number(u.GoldBait) || 0) + 1 }) },
  archeo: { label: '6 vers blancs', fields: (u) => ({ Grubs: (Number(u.Grubs) || 0) + 6 }) },
  cook: { label: '2 épices et 2 truffes', fields: (u) => pantryFields(u, { spice: 2, truffle: 2 }) }
};

// Legendes : action qui compte, chance par action, garantie (pity), noms de la semaine.
const LEGENDS = {
  dig: { what: 'trésor dégagé', chance: 0.02, pity: 80, count: (e) => sum(e, (x) => x.type === 'treasure'), names: ['Ammonite géante', 'Œuf de cristal', 'Trilobite doré', 'Dent de mégalodon', 'Géode royale', 'Ambre millénaire'] },
  fish: { what: 'lancer', chance: 0.012, pity: 150, count: (e) => sum(e, (x) => x.type === 'fish'), names: ['Léviathan d’argent', 'Carpe impériale', 'Brochet des brumes', 'Silure ancestral', 'Esturgeon de lune', 'Anguille d’opale'] },
  garden: { what: 'parcelle récoltée', chance: 0.04, pity: 40, count: (e) => sum(e, (x) => x.type === 'harvest'), names: ['Citrouille colossale', 'Tournesol d’or', 'Rose éternelle', 'Mandragore chantante', 'Chou titanesque', 'Lys de minuit'] },
  archeo: { what: 'tablette dégagée', chance: 0.15, pity: 8, count: (e) => sum(e, (x) => x.type === 'tablet'), names: ['Tablette du roi oublié', 'Sceau des anciens', 'Carte d’un monde perdu', 'Codex de bronze', 'Masque de jade', 'Astrolabe brisé'] },
  cook: { what: 'plat réussi', chance: 0.1, pity: 15, count: (e) => sum(e, (x) => x.type === 'cook' && x.meta && Number(x.meta.q) >= 2), names: ['l’étoile du critique', 'la toque d’or', 'le plat des rois', 'la recette de grand-mère', 'le banquet du siècle', 'la cuillère de cristal'] }
};
const legendName = (metier, week) => { const l = LEGENDS[metier].names; return l[hash(`${metier}|${week}`) % l.length]; };

// Comptoir des maitres : prix en jetons, ce que ca donne.
const SHOP = [
  { key: 'worms', label: '50 vers de terre', icon: '🪱', price: 3, fields: (u) => ({ Worms: (Number(u.Worms) || 0) + 50 }) },
  { key: 'bones', label: '15 os', icon: '🦴', price: 4, fields: (u) => ({ BoneCount: (Number(u.BoneCount) || 0) + 15 }) },
  { key: 'bait', label: '3 appâts dorés', icon: '🪝', price: 6, fields: (u) => ({ GoldBait: (Number(u.GoldBait) || 0) + 3 }) },
  { key: 'carrots', label: '10 carottes (Noisette)', icon: '🥕', price: 3, fields: (u) => ({ Carrots: (Number(u.Carrots) || 0) + 10 }) },
  { key: 'grubs', label: '10 vers blancs (Pistache)', icon: '🐛', price: 3, fields: (u) => ({ Grubs: (Number(u.Grubs) || 0) + 10 }) },
  { key: 'dinofood', label: 'Sac pour l’enclos (10 poissons, 5 crevettes)', icon: '🐟', price: 4, fields: (u) => { const f = foodOf(u); f.fish = (f.fish || 0) + 10; f.shrimp = (f.shrimp || 0) + 5; return { DinoFood: JSON.stringify(f) }; } },
  { key: 'basket', label: 'Panier du chef (2 truffes, 2 poissons rares, 2 fleurs, 2 épices)', icon: '🧺', price: 6, fields: (u) => pantryFields(u, { truffle: 2, rarefish: 2, flower: 2, spice: 2 }) },
  { key: 'stone', label: 'Tablette de pierre gravée', icon: '🪨', price: 8, fields: (u) => addTabletsFields(u, 'stone', 1) },
  { key: 'goldtab', label: 'Tablette dorée', icon: '🟨', price: 20, fields: (u) => addTabletsFields(u, 'gold', 1) },
  { key: 'parts', label: '3 pièces détachées', icon: '🔩', price: 10, fields: (u) => ({ SpareParts: (Number(u.SpareParts) || 0) + 3 }) },
  { key: 'coin-collector', label: 'Pièce de gatchapon Collectionneur', icon: '🎴', price: 5, coin: 'collector' },
  { key: 'coin-explorer', label: 'Pièce de gatchapon Explorateur', icon: '⛏️', price: 5, coin: 'explorer' },
  { key: 'coin-nature', label: 'Pièce de gatchapon Nature', icon: '🌱', price: 5, coin: 'nature' },
  { key: 'coin-pets', label: 'Pièce de gatchapon Compagnons', icon: '🐾', price: 5, coin: 'pets' },
  { key: 'coin-fortune', label: 'Pièce de gatchapon Fortune', icon: '✨', price: 6, coin: 'fortune' },
  { key: 'goldkey', label: 'Clé d’or (coffres de tout palier)', icon: '🔑', price: 15, fields: (u) => ({ GoldKeys: (Number(u.GoldKeys) || 0) + 1 }) },
  { key: 'skull', label: 'Crâne de dinosaure', icon: '💀', price: 60, fields: (u) => ({ DinoSkulls: (Number(u.DinoSkulls) || 0) + 1 }) },
  { key: 'title', label: 'Titre « Grand maître artisan »', icon: '🎖️', price: 120, cosmetic: { key: 'metier-grandmaster', type: 'title', label: 'Grand maître artisan' } }
];

function weekOf(user, week = weekKey()) {
  const w = parseJson(user && user.MetierWeek, null);
  if (w && w.week === week) return w;
  const contracts = {};
  for (const m of Object.keys(METIERS)) {
    const pool = [...POOLS[m]];
    let h = hash(`${user.id}|${week}|${m}`);
    const picked = [];
    while (picked.length < 2 && pool.length) { picked.push(pool.splice(h % pool.length, 1)[0].key); h = hash(String(h)); }
    contracts[m] = picked.map((key) => ({ key, n: 0, stage: 0 }));
  }
  const legends = {};
  for (const m of Object.keys(METIERS)) legends[m] = { tries: 0, found: false };
  return { week, contracts, legends, slam: false };
}
const legendsOf = (user) => { const l = parseJson(user && user.MetierLegends, null); return l && typeof l === 'object' ? { total: l.total || {}, list: Array.isArray(l.list) ? l.list : [] } : { total: {}, list: [] }; };
const label = (tpl, n) => tpl.label.replace('{n}', n).replace(/\{s\}/g, n > 1 ? 's' : '');

function contractDust(store, stage) {
  const v = setting(store, 'MetierContractDust');
  const list = Array.isArray(v) ? v : [80, 150, 250];
  return Math.max(0, Number(list[stage]) || 0);
}

// Abonne du bus d'activite.
export function onEvents(store, events) {
  const notices = [];
  const byUser = new Map();
  for (const e of events) { if (!byUser.has(e.userId)) byUser.set(e.userId, []); byUser.get(e.userId).push(e); }
  const week = weekKey();
  for (const [uid, evs] of byUser) {
    let user = store.get('Users', Number(uid));
    if (!user) continue;
    const w = weekOf(user, week);
    const coinsAfter = [];
    let changed = false;
    const fields = {};
    const num = (k) => (fields[k] ?? (Number(user[k]) || 0));
    const addFields = (f) => { for (const [k, v] of Object.entries(f)) fields[k] = v; user = { ...user, ...f }; };
    for (const [m, list] of Object.entries(w.contracts)) {
      for (const c of list) {
        const tpl = POOLS[m].find((x) => x.key === c.key);
        if (!tpl || c.stage >= 3) continue;
        const n = tpl.count(evs);
        if (!n) continue;
        c.n = Math.min(tpl.targets[2], c.n + n);
        changed = true;
        while (c.stage < 3 && c.n >= tpl.targets[c.stage]) {
          const st = STAGES[c.stage];
          const dust = contractDust(store, c.stage);
          fields.StardustCount = num('StardustCount') + dust;
          fields.MasterTokens = num('MasterTokens') + st.tokens;
          const extra = c.stage === 1 ? SILVER[m] : null;
          if (extra) addFields(extra.fields({ ...user, ...fields }));
          notices.push({ userId: user.id, kind: 'metier', icon: st.icon, label: `Contrat ${METIERS[m].label} ${st.label} : ${label(tpl, tpl.targets[c.stage])} (+${dust} ✨, +${st.tokens} jeton${st.tokens > 1 ? 's' : ''} de maître${extra ? `, ${extra.label}` : ''})` });
          c.stage++;
        }
      }
    }
    // Grand chelem : les 10 contrats en or.
    if (!w.slam && Object.values(w.contracts).every((l) => l.every((c) => c.stage >= 3))) {
      w.slam = true;
      const tokens = setting(store, 'MetierSlamTokens');
      fields.MasterTokens = num('MasterTokens') + tokens;
      fields.GoldKeys = num('GoldKeys') + 1;
      const titled = grantCosmetic(store, user.id, 'metier-slam', { type: 'title', label: 'Maître des cinq métiers' });
      notices.push({ userId: user.id, kind: 'achievement', icon: '🏆', label: `Grand chelem des métiers ! +${tokens} jetons de maître, une clé d’or${titled ? ' et le titre « Maître des cinq métiers »' : ''}` });
      addFeed(store, { userId: user.id, kind: 'metier', icon: '🏆', text: 'a rempli les 10 contrats des métiers de la semaine !' });
    }
    // Legendes de la semaine.
    for (const [m, L] of Object.entries(LEGENDS)) {
      const lg = w.legends[m] || (w.legends[m] = { tries: 0, found: false });
      if (lg.found) continue;
      const n = L.count(evs);
      if (!n) continue;
      changed = true;
      for (let i = 0; i < n && !lg.found; i++) {
        lg.tries++;
        if (Math.random() < L.chance || lg.tries >= L.pity) {
          lg.found = true;
          lg.at = now();
          const name = legendName(m, week);
          const dust = setting(store, 'MetierLegendDust'), tokens = setting(store, 'MetierLegendTokens');
          fields.StardustCount = num('StardustCount') + dust;
          fields.MasterTokens = num('MasterTokens') + tokens;
          const book = legendsOf(user);
          book.total[m] = (Number(book.total[m]) || 0) + 1;
          book.list = [{ week, metier: m, name, at: lg.at }, ...book.list].slice(0, 80);
          fields.MetierLegends = JSON.stringify(book);
          user = { ...user, MetierLegends: fields.MetierLegends };
          // La piece est donnee apres l'ecriture des champs (addCoins relit le joueur).
          coinsAfter.push(LEGEND_COIN[m]);
          notices.push({ userId: user.id, kind: 'achievement', icon: '🌟', label: `Légende de la semaine (${METIERS[m].label}) : ${name} ! +${dust} ✨, +${tokens} jetons de maître et une pièce de gatchapon` });
          addFeed(store, { userId: user.id, kind: 'metier', icon: METIERS[m].icon, text: `a trouvé la légende de la semaine : ${name} !` });
        }
      }
    }
    if (changed || Object.keys(fields).length) store.update('Users', user.id, { ...fields, MetierWeek: JSON.stringify(w) });
    for (const f of coinsAfter) addCoins(store, user.id, f, 1);
  }
  return notices;
}

function view(store, user) {
  const week = weekKey();
  const w = weekOf(user, week);
  const book = legendsOf(user);
  const metiers = Object.entries(METIERS).map(([key, m]) => ({
    key, ...m,
    contracts: w.contracts[key].map((c) => {
      const tpl = POOLS[key].find((x) => x.key === c.key);
      const target = tpl.targets[Math.min(2, c.stage)];
      return { key: c.key, label: label(tpl, target), n: c.n, stage: c.stage, target, targets: tpl.targets, done: c.stage >= 3,
        stages: STAGES.map((s, i) => ({ ...s, target: tpl.targets[i], dust: contractDust(store, i), reached: c.stage > i, extra: i === 1 ? SILVER[key].label : null })) };
    }),
    legend: { name: legendName(key, week), found: !!(w.legends[key] && w.legends[key].found), at: (w.legends[key] && w.legends[key].at) || null, tries: (w.legends[key] && w.legends[key].tries) || 0, pity: LEGENDS[key].pity, what: LEGENDS[key].what, total: Number(book.total[key]) || 0 }
  }));
  const gold = metiers.reduce((n, m) => n + m.contracts.filter((c) => c.done).length, 0);
  return {
    week, endsAt: weekEndsAt(week), tokens: Number(user.MasterTokens) || 0, metiers, gold, totalContracts: metiers.reduce((n, m) => n + m.contracts.length, 0), slam: !!w.slam,
    slamTokens: setting(store, 'MetierSlamTokens'), legendDust: setting(store, 'MetierLegendDust'), legendTokens: setting(store, 'MetierLegendTokens'),
    legends: book.list.slice(0, 30).map((l) => ({ ...l, icon: (METIERS[l.metier] || {}).icon || '🌟', metierLabel: (METIERS[l.metier] || {}).label || l.metier })),
    legendsTotal: Object.values(book.total).reduce((a, b) => a + (Number(b) || 0), 0),
    shop: SHOP.map((s) => ({ key: s.key, label: s.label, icon: s.icon, price: s.price, owned: s.cosmetic ? ownsCosmetic(store, user.id, s.cosmetic.key) : false }))
  };
}
function ownsCosmetic(store, userId, key) {
  if (!store.tables.has('UserCosmetics')) return false;
  return store.getAll('UserCosmetics').some((c) => refId(c.User) === userId && c.Key === key);
}

function handle({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(view(store, user));
  if (action === 'buy') {
    const item = SHOP.find((s) => s.key === String(body.key || ''));
    if (!item) return fail('unknown_item');
    const tokens = Number(user.MasterTokens) || 0;
    if (tokens < item.price) return fail('not_enough_tokens', 400, { price: item.price, tokens });
    if (item.cosmetic) {
      if (!grantCosmetic(store, user.id, item.cosmetic.key, { type: item.cosmetic.type, label: item.cosmetic.label })) return fail('already_owned');
      const u = store.update('Users', user.id, { MasterTokens: tokens - item.price });
      return ok({ ...view(store, u), bought: item.key, label: item.label });
    }
    if (item.coin) {
      const u0 = store.update('Users', user.id, { MasterTokens: tokens - item.price });
      addCoins(store, user.id, item.coin, 1);
      return ok({ ...view(store, store.get('Users', u0.id)), bought: item.key, label: item.label });
    }
    const u = store.update('Users', user.id, { ...item.fields(user), MasterTokens: tokens - item.price });
    return ok({ ...view(store, u), bought: item.key, label: item.label });
  }
  return fail('unknown_action');
}

export const routes = { 'POST metiers': handle };
