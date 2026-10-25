// Archeologie (2026-10-25 ; grattage libre en deux etapes depuis le
// 2026-10-26). Jeu lie a la fouille : en terminant des grilles de fouille
// (toi ou Milo) on trouve parfois une TABLETTE ANCIENNE (Users.Tablets).
//  1. EXTRACTION : on gratte librement la terre de la tablette (plus de cases
//     a l'ecran). Le serveur garde une carte de profondeur de 24 x 16 et le
//     plan des trouvailles ; le site envoie les points du geste (x, y de 0 a
//     1, outil, vitesse). Une trouvaille presque entierement a nu (92 %) est
//     EXTRAITE : un bloc brut, sans savoir ce qu'il contient
//     (Users.ArcheoFinds). L'endurance du geste est limitee (ArcheoStrokes).
//  2. NETTOYAGE : meme geste sur la gangue d'un bloc brut (carte de 16 x 16
//     posee sur la trouvaille) ; elle se decouvre au fil du grattage et est
//     LIBEREE quand son coeur est a nu a 80 %.
// Outils : pinceau (large, doux), grattoir (fin, precis), pioche (gros
// eclats, coute 3). PRESSION = durete de l'outil x vitesse du geste : au-dela
// de 1 sur une partie deja a nu d'une trouvaille, elle s'abime (rayee, puis
// fissuree a 6, cassee a 12 ; seuil de pression 1,3). La pioche sert a degrossir.
// Trouvailles : mineraux de la fouille (Users.Minerals), tessons
// (poussieres), crane de dino, relique (jeton booster ou cle).
// 2026-10-27 : TROIS SORTES DE TABLETTES (Users.TabletStock, Users.Tablets =
// total) : argile (commune), pierre gravee (rare : veines de roche dure que le
// pinceau entame a peine, plus de trouvailles, meilleurs paliers), tablette
// doree (legendaire : pieces fragiles qui s'abiment plus vite, reliques bien
// plus frequentes). Plus on fouille profond, plus les belles tablettes sont
// frequentes. NIVEAU D'ARCHEOLOGUE (Users.ArcheoXP, 10 niveaux) : endurance,
// loupe, pinceau fin, oeil exerce (pieces fragiles reperees), burin doux,
// moins de casse, soufflet, bonus de maitre ; voir ARCH_PERKS.
//   POST /webhook/archeo { userId, action: 'status' | 'start' | 'scrape' | 'finish' | 'clean' | 'cleanStatus', pts?: [{ x, y, t, s }], findId? }
// Users.ArcheoState = { v: 3, w, h, depth[], items[{ kind, key?, tier?, cells[], damage }], energy, max, at }
// Users.ArcheoFinds = [{ id, kind, key?, tier?, size, damage, g, depth[], mask[] }]

import { ok, fail, userById, now, parseJson } from './common.js';
import { setting } from './settings.js';
import { MINERALS, mineralsOf, currentDepth } from './digdepth.js';

export const schema = { Users: { Tablets: { type: 'Numeric' }, TabletStock: { type: 'Text' }, ArcheoXP: { type: 'Numeric' }, ArcheoState: { type: 'Text' }, ArcheoDone: { type: 'Numeric' }, ArcheoStarter: { type: 'Bool' }, ArcheoFinds: { type: 'Text' }, ArcheoFreed: { type: 'Numeric' } } };

const W = 24, H = 16; // carte de la tablette
const G = 16; // carte de la gangue d'un bloc
const MAX_FINDS = 30;
const BARE = 0.05; // profondeur consideree a nu
// r : rayon (en cases), dig : profondeur retiree au centre, hard : durete,
// rock : efficacite sur la roche dure, cost : endurance, level : niveau d'archeologue requis.
export const TOOLS = {
  brush: { r: 1.5, dig: 0.3, hard: 0.35, rock: 0.2, cost: 1, level: 1 },
  scraper: { r: 0.85, dig: 0.7, hard: 1, rock: 0.75, cost: 1, level: 1 },
  pick: { r: 2.1, dig: 1.25, hard: 2.4, rock: 1.3, cost: 3, level: 1 },
  fine: { r: 0.6, dig: 0.5, hard: 0.15, rock: 0.35, cost: 1, level: 4 },
  air: { r: 2.8, dig: 0.13, hard: 0, rock: 0, cost: 1, level: 8 }
};
export const TABLETS = {
  clay: { label: 'Tablette d’argile', icon: '🟫', rarity: 'commune', items: [3, 4], tierBonus: 0, depth: [0.8, 2.2], hard: 0, fragile: 0.05, relic: 1, energy: 1, perfect: 1, xp: 1, hint: '3 ou 4 trouvailles, terre tendre' },
  stone: { label: 'Pierre gravée', icon: '🪨', rarity: 'rare', items: [4, 5], tierBonus: 1, depth: [1, 2.6], hard: 0.35, fragile: 0.15, relic: 2, energy: 1.25, perfect: 2, xp: 1.5, hint: '4 ou 5 trouvailles, meilleurs paliers, veines de roche dure' },
  gold: { label: 'Tablette dorée', icon: '🟨', rarity: 'legendaire', items: [5, 6], tierBonus: 2, depth: [1.2, 2.8], hard: 0.38, fragile: 0.35, relic: 4, energy: 1.5, perfect: 3, xp: 2, hint: '5 ou 6 trouvailles, reliques fréquentes, pièces fragiles' }
};
const TABLET_KEYS = Object.keys(TABLETS);
// Niveau d'archeologue : seuils d'XP et avantages.
const ARCH_LEVELS = [0, 25, 60, 110, 180, 270, 380, 520, 690, 900];
export const ARCH_PERKS = {
  2: 'Endurance +10 %',
  3: 'Loupe : les reflets apparaissent plus tôt sous la terre',
  4: 'Nouvel outil : pinceau fin (précis, ne casse jamais)',
  5: 'Œil exercé : les trouvailles fragiles se repèrent (contour rouge) · endurance +20 %',
  6: 'Burin doux : la pioche abîme moins',
  7: 'Main sûre : 30 % de chocs en moins',
  8: 'Nouvel outil : soufflet (balaie large et sans risque)',
  9: 'Endurance +30 %',
  10: 'Maître archéologue : +1 minéral pour chaque trouvaille intacte'
};
export function archLevel(user) {
  const xp = Number(user && user.ArcheoXP) || 0;
  let level = 1;
  ARCH_LEVELS.forEach((t, i) => { if (xp >= t) level = i + 1; });
  return { level, xp, prev: ARCH_LEVELS[level - 1], next: ARCH_LEVELS[level] ?? null };
}
function perksOf(user) {
  const lv = archLevel(user).level;
  return {
    level: lv,
    energy: lv >= 9 ? 1.3 : lv >= 5 ? 1.2 : lv >= 2 ? 1.1 : 1,
    glint: lv >= 3 ? 1.2 : 0.7,
    fragileSight: lv >= 5,
    damage: lv >= 7 ? 0.7 : 1,
    master: lv >= 10
  };
}
// Outils du joueur (selon son niveau ; burin doux au niveau 6).
function toolsFor(user) {
  const lv = archLevel(user).level;
  const out = {};
  for (const [k, t] of Object.entries(TOOLS)) if (lv >= t.level) out[k] = k === 'pick' && lv >= 6 ? { ...t, hard: 1.7 } : t;
  return out;
}
// Reserve de tablettes par sorte ; Users.Tablets reste le total (les tablettes
// donnees ailleurs, par Tablets + n, comptent comme de l'argile).
function stockOf(user) {
  const st = parseJson(user && user.TabletStock, {}) || {};
  const out = Object.fromEntries(TABLET_KEYS.map((k) => [k, Math.max(0, Math.floor(Number(st[k]) || 0))]));
  const total = TABLET_KEYS.reduce((a, k) => a + out[k], 0);
  const want = Math.max(0, Math.floor(Number(user && user.Tablets) || 0));
  if (want > total) out.clay += want - total;
  else if (want < total) { let left = total - want; for (const k of TABLET_KEYS) { const t = Math.min(out[k], left); out[k] -= t; left -= t; } }
  return out;
}
const stockFields = (stock) => ({ TabletStock: JSON.stringify(stock), Tablets: TABLET_KEYS.reduce((a, k) => a + stock[k], 0) });
// Ajoute des tablettes d'une sorte (fouille, casino) ; renvoie les champs a ecrire.
export function addTabletsFields(user, kind, n = 1) {
  const st = stockOf(user);
  st[TABLETS[kind] ? kind : 'clay'] += n;
  return stockFields(st);
}
// Sorte d'une tablette trouvee : plus belle en profondeur.
function rollKind(store, user) {
  const d = Math.max(0, currentDepth(store, user) - 1);
  const w = { clay: 75, stone: 20 + d * 4, gold: 5 + d * 1.5 };
  let r = Math.random() * (w.clay + w.stone + w.gold);
  for (const k of TABLET_KEYS) { r -= w[k]; if (r <= 0) return k; }
  return 'clay';
}
const RELICS = [
  { key: 'booster', label: 'Relique : sceau du collectionneur', icon: '🏺', field: 'BoosterCount', n: 1, reward: '1 jeton booster' },
  { key: 'key', label: 'Relique : clé de bronze', icon: '🗝️', field: 'KeyCount', n: 1, reward: '1 clé' }
];
// 2026-10-26 (2) : seuils doubles, extraction a 75 %, nettoyage a 80 % du coeur.
const CRACKED = 6, BROKEN = 12;
const EXTRACT_SHARE = 0.75, FREE_SHARE = 0.8;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const r2 = (v) => Math.round(v * 100) / 100;
const stateOf = (user) => { const s = parseJson(user && user.ArcheoState, null); return s && s.v === 3 && Array.isArray(s.depth) && s.depth.length === W * H ? s : null; };
const findsOf = (user) => { const f = parseJson(user && user.ArcheoFinds, []); return Array.isArray(f) ? f : []; };
const stateLabel = (d) => (d >= BROKEN ? 'broken' : d >= CRACKED ? 'cracked' : d >= 1 ? 'scratched' : 'intact');

// Palier max des mineraux d'une tablette : celui de la profondeur de fouille, +1.
function maxTier(store, user) {
  const depth = currentDepth(store, user);
  const cfg = setting(store, 'DigDepths')[depth - 1] || {};
  return Math.min(5, Math.max(1, Number(cfg.mineralMax) || 1) + 1);
}
// Bruit lisse (moyenne des voisines) de min a max.
function smoothNoise(w, h, min, max) {
  const raw = Array.from({ length: w * h }, () => Math.random());
  return raw.map((_, i) => {
    const x = i % w, y = Math.floor(i / w);
    let s = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += raw[yy * w + xx]; n++; } }
    return r2(min + (max - min) * Math.min(1, Math.max(0, (s / n - 0.3) / 0.4)));
  });
}
// Cases d'une ellipse (cx, cy, rx, ry) dans une carte w x h.
function ellipseCells(w, h, cx, cy, rx, ry, wobble = 0.25) {
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
    if (d <= 1 + (Math.random() - 0.5) * wobble) out.push(y * w + x);
  }
  return out;
}

function generate(store, user, kind = 'clay') {
  const T = TABLETS[kind] || TABLETS.clay;
  const depth = smoothNoise(W, H, T.depth[0], T.depth[1]);
  // Veines de roche dure (pierre gravee ~15 % des cases, tablette doree ~20 %).
  const hardNoise = smoothNoise(W, H, 0, 1);
  const hard = hardNoise.map((v) => (T.hard && v > 1 - T.hard ? 1 : 0));
  const used = new Set();
  const items = [];
  const top = Math.min(5, maxTier(store, user) + T.tierBonus);
  const count = rnd(T.items[0], T.items[1]);
  for (let tries = 0; items.length < count && tries < 300; tries++) {
    const rx = 1.2 + Math.random() * 1.6, ry = 1 + Math.random() * 1.2;
    const cx = rx + 0.5 + Math.random() * (W - 2 * rx - 1), cy = ry + 0.5 + Math.random() * (H - 2 * ry - 1);
    const cells = ellipseCells(W, H, cx, cy, rx, ry);
    if (cells.length < 3 || cells.some((c) => used.has(c))) continue;
    // Un peu de marge entre deux trouvailles.
    ellipseCells(W, H, cx, cy, rx + 1, ry + 1, 0).forEach((c) => used.add(c));
    const r = Math.random();
    let item;
    const relic = Math.min(0.4, setting(store, 'ArcheoRelicChance') * T.relic);
    if (r < relic) item = { kind: 'relic', key: pick(RELICS).key };
    else if (r < relic + 0.05) item = { kind: 'skull' };
    else if (r < 0.32) item = { kind: 'shard', tier: rnd(1, top) };
    else {
      // Palier : souvent bas, parfois le maximum de la profondeur.
      const tier = Math.max(1, Math.min(top, top - Math.floor(Math.random() * Math.random() * top)));
      item = { kind: 'mineral', key: pick(MINERALS.filter((m) => m.tier === tier)).key, tier };
    }
    // Plus enfouie au milieu : la trouvaille ne sort pas d'un seul coup de pinceau.
    cells.forEach((c) => { depth[c] = r2(Math.max(depth[c], 1.2 + Math.random() * 0.6)); });
    items.push({ ...item, cells, damage: 0, ...(Math.random() < T.fragile ? { fragile: true } : {}) });
  }
  const max = Math.round(setting(store, 'ArcheoStrokes') * T.energy * perksOf(user).energy);
  return { v: 3, kind, w: W, h: H, depth, hard, items, energy: max, max, at: now() };
}

// Applique les points d'un geste a une carte de profondeur. itemAt(c) : la
// trouvaille sous la case (ou null). Renvoie l'endurance depensee et les chocs.
export function scrapeGrid(depth, w, h, pts, itemAt, budget = Infinity, { tools = TOOLS, hard = null, damageMult = 1 } = {}) {
  let spent = 0, hurt = 0;
  for (const p of pts) {
    const tool = tools[p.t] || tools.brush;
    if (spent + tool.cost > budget) break;
    spent += tool.cost;
    const cx = Math.max(0, Math.min(1, Number(p.x) || 0)) * w, cy = Math.max(0, Math.min(1, Number(p.y) || 0)) * h;
    const pressure = tool.hard * Math.max(0.2, Math.min(3, Number(p.s) || 0));
    const r = tool.r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.floor(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.floor(cx + r)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const c = y * w + x, f = 1 - d / (r + 0.35);
        const before = depth[c];
        // Roche dure : seuls les outils solides l'entament vraiment.
        const k = hard && hard[c] ? tool.rock : 1;
        depth[c] = r2(Math.max(0, before - tool.dig * f * k));
        // Trop brusque sur une partie deja a nu : la trouvaille s'abime.
        // Seuil 1,3 (0,8 pour une piece fragile) : le pinceau ne casse jamais.
        if (before <= BARE) {
          const it = itemAt(c);
          const limit = it && it.fragile ? 0.8 : 1.3;
          if (it && pressure > limit) { const dmg = (pressure - limit) * f * 0.4 * (it.fragile ? 1.5 : 1) * damageMult; it.damage = r2((it.damage || 0) + dmg); hurt += dmg; }
        }
      }
    }
  }
  return { spent, hurt: r2(hurt) };
}
const cleanPts = (raw, tools = TOOLS) => (Array.isArray(raw) ? raw : []).slice(0, 240).map((p) => ({ x: Number(p && p.x), y: Number(p && p.y), t: tools[p && p.t] ? p.t : 'brush', s: Number(p && p.s) || 0 })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
const exposedShare = (depth, cells) => cells.filter((c) => depth[c] <= BARE).length / Math.max(1, cells.length);
const isExtracted = (s, it) => exposedShare(s.depth, it.cells) >= EXTRACT_SHARE;

// Bloc brut extrait : gangue de 16 x 16, la trouvaille au milieu.
function newFind(it) {
  // Coeur de la trouvaille (au milieu de son image) : c'est lui qu'il faut degager.
  const mask = ellipseCells(G, G, 8, 8, 3.3 + (it.cells.length >= 9 ? 0.4 : 0), 3.3, 0.15);
  const inMask = new Set(mask);
  const depth = smoothNoise(G, G, 0.5, 1.2).map((d, i) => (inMask.has(i) ? r2(d + 0.3) : d));
  return { v: 2, id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, kind: it.kind, key: it.key, tier: it.tier, size: it.cells.length >= 9 ? 3 : it.cells.length >= 5 ? 2 : 1, damage: r2(it.damage || 0), g: G, depth, mask, ...(it.fragile ? { fragile: true } : {}), from: it.from || 'clay' };
}
// Blocs d'avant le 26/10 (gangue 8 x 8) : nouvelle gangue, meme trouvaille et meme etat.
function upgradeFind(f) {
  if (f.g === G && Array.isArray(f.depth) && f.v === 2) return f;
  // Nouvelle gangue (plus fine, coeur plus petit), meme trouvaille ; les chocs de l'ancienne regle sont oublies.
  const fresh = newFind({ kind: f.kind, key: f.key, tier: f.tier, cells: Array.from({ length: (f.size || 1) * 4 }), damage: 0 });
  return { ...fresh, id: f.id };
}

// Ce que montre un bloc dans l'atelier : forme et poids seulement.
const findTeaser = (f) => ({ id: f.id, size: f.size, shiny: (f.tier || 0) >= 4 || f.kind === 'relic', fragile: !!f.fragile, from: f.from || 'clay', state: stateLabel(f.damage), progress: Math.min(100, Math.round((exposedShare(f.depth, f.mask) / FREE_SHARE) * 100)) });
function identity(f) {
  if (f.kind === 'mineral') { const m = MINERALS.find((x) => x.key === f.key) || MINERALS[0]; return { kind: 'mineral', key: m.key, name: m.name, tier: m.tier, img: 'Fouille/' + m.img }; }
  if (f.kind === 'relic') { const r = RELICS.find((x) => x.key === f.key) || RELICS[0]; return { kind: 'relic', name: r.label, icon: r.icon, reward: r.reward }; }
  if (f.kind === 'skull') return { kind: 'skull', name: 'Crâne de dinosaure', img: 'CraneDeDino.png' };
  return { kind: 'shard', name: 'Tesson gravé', icon: '🏺', tier: f.tier };
}
// Au nettoyage : la gangue, la forme de la trouvaille (pour la pression) et son image cachee dessous.
const findWork = (f) => ({ ...findTeaser(f), g: f.g, depth: f.depth, mask: f.mask, damage: r2(f.damage), art: (({ img, icon }) => ({ img: img || null, icon: icon || null }))(identity(f)) });

function view(store, user) {
  const s = stateOf(user);
  const perks = perksOf(user);
  const stock = stockOf(user);
  const lv = archLevel(user);
  return {
    enabled: !!setting(store, 'ArcheoEnabled'),
    tablets: Number(user.Tablets) || 0, done: Number(user.ArcheoDone) || 0, freedTotal: Number(user.ArcheoFreed) || 0, maxTablets: setting(store, 'ArcheoMaxTablets'),
    stock: TABLET_KEYS.map((k) => ({ kind: k, ...TABLETS[k], count: stock[k], maxTier: Math.min(5, maxTier(store, user) + TABLETS[k].tierBonus) })),
    level: { ...lv, perks: ARCH_PERKS, max: ARCH_LEVELS.length, nextPerk: ARCH_PERKS[lv.level + 1] || null },
    finds: findsOf(user).map(upgradeFind).map(findTeaser),
    tools: toolsFor(user), bare: BARE, damageMult: perks.damage,
    tablet: s ? {
      kind: s.kind || 'clay', label: (TABLETS[s.kind] || TABLETS.clay).label,
      w: s.w, h: s.h, depth: s.depth, hard: s.hard || null, energy: s.energy, max: s.max, total: s.items.length,
      // Parties a nu des trouvailles (un bloc de pierre qui affleure) et reflets juste au-dessus (la loupe les montre plus tot).
      peek: s.items.flatMap((it) => it.cells.filter((c) => s.depth[c] <= BARE)),
      glints: s.items.flatMap((it) => it.cells.filter((c) => s.depth[c] > BARE && s.depth[c] <= perks.glint)),
      // Oeil exerce : les parties a nu des pieces fragiles.
      fragile: perks.fragileSight ? s.items.filter((it) => it.fragile).flatMap((it) => it.cells.filter((c) => s.depth[c] <= BARE)) : [],
      extracted: s.items.filter((it) => isExtracted(s, it)).map((it) => ({ cells: it.cells, state: stateLabel(it.damage) }))
    } : null
  };
}
// XP d'archeologue : renvoie les champs et le passage de niveau eventuel.
function gainXp(user, n, fields = {}) {
  const before = archLevel(user).level;
  const xp = (Number(user.ArcheoXP) || 0) + Math.round(n);
  const after = archLevel({ ArcheoXP: xp }).level;
  return { fields: { ...fields, ArcheoXP: xp }, levelUp: after > before ? { level: after, perk: ARCH_PERKS[after] || null } : null };
}

// Fin d'extraction : chaque trouvaille degagee devient un bloc brut.
function finish(store, user, s) {
  const T = TABLETS[s.kind] || TABLETS.clay;
  const extracted = s.items.filter((it) => isExtracted(s, it));
  const fresh = extracted.map((it) => newFind({ ...it, from: s.kind || 'clay' }));
  const kept = [...findsOf(user), ...fresh].slice(-MAX_FINDS);
  const perfect = s.items.length > 0 && extracted.length === s.items.length && s.items.every((it) => (it.damage || 0) < 0.5);
  const bonus = perfect ? setting(store, 'ArcheoPerfectDust') * T.perfect : 0;
  const xp = (extracted.length * 3 + (perfect ? 5 : 0)) * T.xp;
  const g = gainXp(user, xp, { ArcheoState: '', ArcheoFinds: JSON.stringify(kept), ArcheoDone: (Number(user.ArcheoDone) || 0) + 1, DigXP: (Number(user.DigXP) || 0) + extracted.length });
  if (bonus) g.fields.StardustCount = (Number(user.StardustCount) || 0) + bonus;
  const updated = store.update('Users', user.id, g.fields);
  return { user: updated, result: { kind: s.kind || 'clay', label: T.label, extracted: fresh.map(findTeaser), lost: s.items.length - extracted.length, perfect, bonus, xp: Math.round(xp), levelUp: g.levelUp, total: s.items.length } };
}

// Recompense d'une trouvaille liberee selon son etat.
function liberate(store, user, f) {
  const fields = {};
  const add = (k, v) => { fields[k] = (fields[k] ?? (Number(user[k]) || 0)) + v; };
  const st = stateLabel(f.damage);
  const shard = setting(store, 'ArcheoShardDust');
  const out = { ...identity(f), state: st };
  if (f.kind === 'mineral') {
    if (st === 'broken') { out.dust = Math.round(shard * (f.tier || 1) / 2); add('StardustCount', out.dust); }
    else {
      // Grande trouvaille intacte : 2 exemplaires ; sinon 1 (+1 intact au niveau 10).
      out.amount = (st === 'intact' && f.size >= 3 ? 2 : 1) + (st === 'intact' && perksOf(user).master ? 1 : 0);
      const m = { ...mineralsOf(user) };
      m[f.key] = (Number(m[f.key]) || 0) + out.amount;
      fields.Minerals = JSON.stringify(m);
    }
  } else if (f.kind === 'shard') {
    out.dust = Math.round(shard * (f.tier || 1) * (st === 'broken' ? 0.3 : st === 'cracked' ? 0.6 : 1));
    add('StardustCount', out.dust);
  } else if (f.kind === 'skull') {
    if (st === 'broken') { out.dust = shard * 2; add('StardustCount', out.dust); } else { out.amount = 1; add('DinoSkulls', 1); }
  } else if (f.kind === 'relic') {
    const r = RELICS.find((x) => x.key === f.key) || RELICS[0];
    if (st === 'broken') { out.dust = shard * 3; add('StardustCount', out.dust); } else { out.amount = r.n; add(r.field, r.n); }
  }
  add('DigXP', 1);
  add('ArcheoFreed', 1);
  const g = gainXp(user, ({ intact: 5, scratched: 4, cracked: 2, broken: 1 })[st] * ((TABLETS[f.from] || TABLETS.clay).xp), fields);
  return { fields: g.fields, result: { ...out, xp: g.fields.ArcheoXP - (Number(user.ArcheoXP) || 0), levelUp: g.levelUp } };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  // Decouverte du jeu : tablettes offertes une fois.
  if (!user.ArcheoStarter && setting(store, 'ArcheoEnabled')) user = store.update('Users', user.id, { ArcheoStarter: true, ...addTabletsFields(user, 'clay', setting(store, 'ArcheoStarterTablets')) });
  // Tablette ouverte avec l'ancienne version (cases) : rendue.
  const old = parseJson(user.ArcheoState, null);
  if (old && old.v !== 3) user = store.update('Users', user.id, { ArcheoState: '', ...addTabletsFields(user, 'clay', 1) });
  const action = body.action || 'status';
  if (action === 'status') return ok(view(store, user));
  if (!setting(store, 'ArcheoEnabled')) return fail('archeo_closed');

  // ---------------------------------------------------------- nettoyage
  if (action === 'clean' || action === 'cleanStatus') {
    const finds = findsOf(user).map(upgradeFind);
    const f = finds.find((x) => x.id === String(body.findId || ''));
    if (!f) return fail('no_find', 404, view(store, user));
    if (action === 'cleanStatus') { user = store.update('Users', user.id, { ArcheoFinds: JSON.stringify(finds) }); return ok({ ...view(store, user), work: findWork(f) }); }
    const tools = toolsFor(user);
    const pts = cleanPts(body.pts, tools);
    if (!pts.length) return fail('no_points');
    const mask = new Set(f.mask);
    const r = scrapeGrid(f.depth, f.g, f.g, pts, (c) => (mask.has(c) ? f : null), Infinity, { tools, damageMult: perksOf(user).damage });
    if (exposedShare(f.depth, f.mask) >= FREE_SHARE) {
      const lib = liberate(store, user, f);
      user = store.update('Users', user.id, { ...lib.fields, ArcheoFinds: JSON.stringify(finds.filter((x) => x !== f)) });
      return ok({ ...view(store, user), freed: lib.result, hurt: r.hurt, lastWork: findWork(f) });
    }
    user = store.update('Users', user.id, { ArcheoFinds: JSON.stringify(finds) });
    return ok({ ...view(store, user), work: findWork(f), hurt: r.hurt });
  }

  // ---------------------------------------------------------- extraction
  if (action === 'start') {
    if (stateOf(user)) return fail('tablet_in_progress', 400, view(store, user));
    const stock = stockOf(user);
    const kind = TABLETS[body.kind] ? String(body.kind) : TABLET_KEYS.find((k) => stock[k] > 0);
    if (!kind || stock[kind] < 1) return fail('no_tablet', 400, view(store, user));
    stock[kind]--;
    user = store.update('Users', user.id, { ...stockFields(stock), ArcheoState: JSON.stringify(generate(store, user, kind)) });
    return ok({ ...view(store, user), started: true });
  }
  const s = stateOf(user);
  if (!s) return fail('no_tablet_open', 400, view(store, user));
  if (action === 'scrape') {
    const tools = toolsFor(user);
    const pts = cleanPts(body.pts, tools);
    if (!pts.length) return fail('no_points');
    const before = new Set(s.items.filter((it) => isExtracted(s, it)));
    const cellItem = new Map();
    s.items.forEach((it) => it.cells.forEach((c) => cellItem.set(c, it)));
    const r = scrapeGrid(s.depth, W, H, pts, (c) => cellItem.get(c) || null, s.energy, { tools, hard: s.hard, damageMult: perksOf(user).damage });
    s.energy = Math.max(0, s.energy - r.spent);
    const fresh = s.items.filter((it) => isExtracted(s, it) && !before.has(it)).length;
    if (s.energy <= 0 || s.items.every((it) => isExtracted(s, it))) {
      const f = finish(store, user, s);
      return ok({ ...view(store, f.user), finished: f.result, hurt: r.hurt, auto: s.energy <= 0 ? 'no_energy' : 'all_found' });
    }
    user = store.update('Users', user.id, { ArcheoState: JSON.stringify(s) });
    return ok({ ...view(store, user), hurt: r.hurt, fresh });
  }
  if (action === 'finish') {
    const f = finish(store, user, s);
    return ok({ ...view(store, f.user), finished: f.result, auto: 'stopped' });
  }
  return fail('unknown_action');
}

// Tablettes trouvees en fouille : grille terminee (toi ou Milo), et un peu
// de chance a chaque tresor degage.
export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'dig' || response.status !== 200 || !response.json || !setting(store, 'ArcheoEnabled')) return;
  const json = response.json;
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user) return;
  const chance = setting(store, 'ArcheoTabletChance');
  let n = 0;
  if (json.boardCleared && Math.random() < chance) n++;
  if (json.revealed && Math.random() < chance / 8) n++;
  const dogBoards = json.dogReport ? Number(json.dogReport.boards) || 0 : 0;
  for (let i = 0; i < dogBoards; i++) if (Math.random() < chance / 2) n++;
  if (!n) return;
  const have = Number(user.Tablets) || 0;
  const room = Math.max(0, setting(store, 'ArcheoMaxTablets') - have);
  n = Math.min(n, room);
  if (!n) return;
  let u = user;
  const kinds = [];
  for (let i = 0; i < n; i++) { const k = rollKind(store, u); kinds.push(k); u = store.update('Users', u.id, addTabletsFields(u, k, 1)); }
  json.tabletsFound = n;
  json.tabletKinds = kinds.map((k) => ({ kind: k, label: TABLETS[k].label, icon: TABLETS[k].icon, rarity: TABLETS[k].rarity }));
  if (json.dogReport && dogBoards && !json.boardCleared) json.dogReport.tablets = n;
}

export const routes = { 'POST archeo': handle };
