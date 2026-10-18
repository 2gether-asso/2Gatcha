// Arbre celeste (2026-10-17) : chaque constellation allumee (ses 5 cartes
// possedees, ou deja recuperee) donne 1 point d'etoile, a depenser pour
// allumer les etoiles d'une carte du ciel. On part de l'Etoile polaire (au
// centre, offerte) et on ne peut allumer qu'une etoile reliee a une etoile
// deja allumee. Trois bras (Collection, Artisanat, Aventure) et une
// Supernova qui demande le bout des trois bras. Les bonus s'ajoutent aux
// talents (talents.js talentValue, champ adds) : ils jouent partout.
// Remise a zero payante (SkyResetCost), points rendus.
//   POST /webhook/sky-tree { userId, action: 'status' | 'light' | 'reset', key? }

import { ok, fail, userById, parseJson } from './common.js';
import { setting } from './settings.js';
import { litConstellations } from './progression.js';

// x, y : position sur la carte (0 a 100). links : etoiles reliees (dans les deux sens).
export const SKY_NODES = [
  { key: 'polaris', label: 'Étoile polaire', icon: '✦', cost: 0, x: 50, y: 52, free: true, adds: { patron: 0.02 }, desc: '+2 % de poussières au décraft. Le point de départ de ton ciel.' },
  // Bras Collection (haut gauche)
  { key: 'sirius', arm: 'collection', label: 'Sirius', icon: '✧', cost: 1, x: 37, y: 38, links: ['polaris'], adds: { lynx: 0.005 }, desc: '+0,5 point de chance de finition spéciale à l’ouverture.' },
  { key: 'vega', arm: 'collection', label: 'Véga', icon: '✧', cost: 1, x: 26, y: 27, links: ['sirius'], adds: { recycler: 0.1 }, desc: '+10 % de poussières de doublons.' },
  { key: 'rigel', arm: 'collection', label: 'Rigel', icon: '✧', cost: 2, x: 15, y: 40, links: ['vega'], adds: { patron: 0.05 }, desc: '+5 % de poussières au décraft.' },
  { key: 'altair', arm: 'collection', label: 'Altaïr', icon: '✧', cost: 2, x: 22, y: 13, links: ['vega'], adds: { born: 0.01 }, desc: '+1 % de chance qu’une carte tirée gagne un état.' },
  { key: 'deneb', arm: 'collection', label: 'Deneb', icon: '✧', cost: 2, x: 36, y: 8, links: ['altair'], adds: { lynx: 0.005 }, desc: '+0,5 point de chance de finition spéciale.' },
  // Bras Artisanat (bas)
  { key: 'arcturus', arm: 'artisan', label: 'Arcturus', icon: '✧', cost: 1, x: 50, y: 68, links: ['polaris'], adds: { thrifty: 0.03 }, desc: '−3 % sur le coût de craft.' },
  { key: 'capella', arm: 'artisan', label: 'Capella', icon: '✧', cost: 1, x: 40, y: 80, links: ['arcturus'], adds: { restorer: 0.25 }, desc: '−25 % sur le supplément des restaurations répétées.' },
  { key: 'antares', arm: 'artisan', label: 'Antarès', icon: '✧', cost: 2, x: 27, y: 86, links: ['capella'], adds: { thrifty: 0.03 }, desc: '−3 % sur le coût de craft.' },
  { key: 'aldebaran', arm: 'artisan', label: 'Aldébaran', icon: '✧', cost: 2, x: 60, y: 84, links: ['arcturus'], adds: { founder: 0.05 }, desc: '+5 % de chance de récupérer des poussières après une fusion ou une restauration.' },
  { key: 'spica', arm: 'artisan', label: 'Spica', icon: '✧', cost: 2, x: 72, y: 92, links: ['aldebaran'], adds: { master: 0.1 }, desc: '−10 % sur les taxes d’échange et d’enchère.' },
  // Bras Aventure (haut droite)
  { key: 'procyon', arm: 'adventure', label: 'Procyon', icon: '✧', cost: 1, x: 63, y: 38, links: ['polaris'], adds: { angler: 1 }, desc: '+1 énergie de pêche max.' },
  { key: 'pollux', arm: 'adventure', label: 'Pollux', icon: '✧', cost: 1, x: 74, y: 27, links: ['procyon'], adds: { greenthumb: 0.05 }, desc: 'Le jardin pousse 5 % plus vite.' },
  { key: 'mira', arm: 'adventure', label: 'Mira', icon: '✧', cost: 2, x: 85, y: 40, links: ['pollux'], adds: { angler: 1 }, desc: '+1 énergie de pêche max.' },
  { key: 'castor', arm: 'adventure', label: 'Castor', icon: '✧', cost: 2, x: 78, y: 13, links: ['pollux'], adds: { explorer: 0.05 }, desc: '+5 % de poussières rapportées d’expédition.' },
  { key: 'bellatrix', arm: 'adventure', label: 'Bellatrix', icon: '✧', cost: 2, x: 64, y: 8, links: ['castor'], adds: { tireless: 0.05 }, desc: '+5 % de poussières trouvées à la fouille.' },
  // Supernova : le bout des trois bras.
  { key: 'supernova', label: 'Supernova', icon: '✺', cost: 5, x: 88, y: 76, requires: ['deneb', 'spica', 'bellatrix'], adds: { lynx: 0.01, patron: 0.05, explorer: 0.05, tireless: 0.05 }, desc: '+1 point de finition spéciale, +5 % au décraft, +5 % de poussières d’expédition et de fouille. Demande Deneb, Spica et Bellatrix.' }
];
const BY_KEY = new Map(SKY_NODES.map((n) => [n.key, n]));
export const ARMS = { collection: { label: 'Collection', icon: '🎴' }, artisan: { label: 'Artisanat', icon: '⚒️' }, adventure: { label: 'Aventure', icon: '🧭' } };

export const schema = { Users: { SkyNodes: { type: 'Text' } } };

export function skyNodesOf(user) {
  const list = parseJson(user && user.SkyNodes, []);
  return new Set((Array.isArray(list) ? list : []).filter((k) => BY_KEY.has(k)).concat(['polaris']));
}
// Bonus de l'arbre ajoutes a un talent (talents.js).
export function skyAdd(user, key) {
  if (!user || !user.SkyNodes) return 0;
  let v = 0;
  for (const k of skyNodesOf(user)) { const n = BY_KEY.get(k); if (n && n.adds && n.adds[key]) v += n.adds[key]; }
  return v;
}
// Voisines d'une etoile (liens dans les deux sens).
const neighbors = (key) => SKY_NODES.filter((n) => (n.links || []).includes(key) || (BY_KEY.get(key).links || []).includes(n.key)).map((n) => n.key);

function state(store, user) {
  const lit = skyNodesOf(user);
  const points = litConstellations(store, user);
  const spent = [...lit].reduce((s, k) => s + (BY_KEY.get(k)?.cost || 0), 0);
  const available = points - spent;
  const nodes = SKY_NODES.map((n) => {
    const on = lit.has(n.key);
    const reachable = n.requires ? n.requires.every((k) => lit.has(k)) : neighbors(n.key).some((k) => lit.has(k));
    return { ...n, lit: on, reachable: !on && reachable, canLight: !on && reachable && available >= n.cost };
  });
  // Bonus cumules de l'arbre, par effet.
  const totals = {};
  for (const k of lit) for (const [e, v] of Object.entries(BY_KEY.get(k)?.adds || {})) totals[e] = Math.round(((totals[e] || 0) + v) * 1000) / 1000;
  return { points, spent, available, nodes, totals, arms: ARMS, resetCost: setting(store, 'SkyResetCost'), stardust: Number(user.StardustCount) || 0, totalCost: SKY_NODES.reduce((s, n) => s + n.cost, 0) };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(state(store, user));
  if (action === 'light') {
    const st = state(store, user);
    const n = st.nodes.find((x) => x.key === String(body.key));
    if (!n) return fail('unknown_star');
    if (n.lit) return fail('already_lit');
    if (!n.reachable) return fail('star_unreachable');
    if (st.available < n.cost) return fail('no_star_points', 400, { cost: n.cost, available: st.available });
    const list = [...skyNodesOf(user)].filter((k) => k !== 'polaris').concat(n.key);
    user = store.update('Users', user.id, { SkyNodes: JSON.stringify(list) });
    return ok({ ...state(store, user), litStar: n.key });
  }
  if (action === 'reset') {
    const cost = setting(store, 'SkyResetCost');
    if (skyNodesOf(user).size <= 1) return fail('nothing_to_reset');
    if ((Number(user.StardustCount) || 0) < cost) return fail('not_enough_dust', 400, { cost });
    user = store.update('Users', user.id, { SkyNodes: '[]', StardustCount: (Number(user.StardustCount) || 0) - cost });
    return ok({ ...state(store, user), reset: true });
  }
  return fail('unknown_action');
}

export const routes = { 'POST sky-tree': handle };
