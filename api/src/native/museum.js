// Musee du coffre-fort (2026-10-18) : vitrines de tout ce qui se collectionne
// hors cartes (poissons de l'aquarium, mineraux, objets decouverts, dinos).
// Une piece est "exposee" des qu'on l'a eue une fois : Users.MuseumSeen garde
// les mineraux et objets deja vus (meme depenses ensuite, et meme si le joueur
// remet ses animations de decouverte a zero). Note a la fin de chaque requete
// du joueur (index.js, comme les decouvertes).
//   GET/POST /webhook/museum { userId }

import { ok, fail, userById, parseJson } from './common.js';
import { SPECIES, aquariumOf, speciesName } from './aquarium.js';
import { MINERALS, mineralsOf } from './digdepth.js';
import { RESOURCES } from './discoveries.js';
import { DINO_SPECIES } from './dino.js';
import { visualLabel } from './visuals.js';
import { grantCosmetic } from './cosmetics.js';

// Badges (titres) : une vitrine complete, puis tout le musee.
export const BADGES = { fish: { label: 'Ichtyologue', icon: '🐟' }, minerals: { label: 'Géologue', icon: '💎' }, items: { label: 'Grand collectionneur', icon: '🧺' }, dinos: { label: 'Paléontologue', icon: '🦖' }, all: { label: 'Conservateur du musée', icon: '🏛️' } };

export const schema = { Users: { MuseumSeen: { type: 'Text' } } };

// Images des objets (memes fichiers que le site).
const ITEM_IMG = { key: 'clés.PNG', bone: 'Os.PNG', worm: 'Pêche/Vers.png', bait: 'ElixirDePeche.PNG', part: 'PieceDetachee.PNG', chest: 'PièceKraken.PNG', skull: 'CraneDeDino.png', fish: 'Pêche/Poisson_12.png', seaweed: 'Pêche/Algues.png', shrimp: 'Pêche/crevette.png', shard: 'JetonBooster.png' };

const seenOf = (user) => { const s = parseJson(user && user.MuseumSeen, {}) || {}; return { minerals: s.minerals || [], items: s.items || [] }; };

// Ajoute ce que le joueur possede maintenant (rien a ecrire si deja vu).
export function note(store, userId) {
  const user = userId && store.tables.has('Users') ? store.get('Users', Number(userId)) : null;
  if (!user) return;
  const s = seenOf(user);
  const minerals = new Set(s.minerals), items = new Set(s.items);
  const before = minerals.size + items.size;
  for (const [k, n] of Object.entries(mineralsOf(user))) if (Number(n) > 0) minerals.add(k);
  for (const r of RESOURCES) if (r.has(user) > 0) items.add(r.key);
  for (const k of parseJson(user.Discoveries, [])) items.add(k);
  if (minerals.size + items.size !== before) store.update('Users', user.id, { MuseumSeen: JSON.stringify({ minerals: [...minerals], items: [...items] }) });
}

function view(store, user) {
  note(store, user.id);
  user = store.get('Users', user.id);
  const s = seenOf(user);
  const aq = aquariumOf(user);
  const owned = mineralsOf(user);
  const dex = parseJson(user.DinoDex, {}) || {};
  const sections = [
    {
      key: 'fish', icon: '🐟', title: 'Poissons', hint: 'Pêchés au moins une fois (aquarium).',
      items: SPECIES.map((sp) => { const f = aq.fish[sp.key]; return { key: sp.key, name: speciesName(store, sp), icon: sp.icon, img: sp.img || null, rarity: sp.rarity, seen: !!(f && f.count), detail: f && f.count ? `${f.count} pêché${f.count > 1 ? 's' : ''} · record ${f.best} cm` : sp.zone === 'deep' ? 'Eaux profondes' : 'Rivage' }; })
    },
    {
      key: 'minerals', icon: '💎', title: 'Minéraux', hint: 'Trouvés en fouille ou en expédition.',
      items: MINERALS.map((m) => ({ key: m.key, name: visualLabel(store, 'Fouille/' + m.img, m.name), img: 'Fouille/' + m.img, tier: m.tier, seen: s.minerals.includes(m.key), detail: Number(owned[m.key]) > 0 ? `${owned[m.key]} dans ton sac` : `palier ${m.tier}` }))
    },
    {
      key: 'items', icon: '🧺', title: 'Objets', hint: 'Toutes les ressources du jeu, au moins une fois en poche.',
      items: RESOURCES.map((r) => ({ key: r.key, name: r.name, icon: r.icon, img: ITEM_IMG[r.key] || null, seen: s.items.includes(r.key), detail: s.items.includes(r.key) ? r.riddle : '' }))
    },
    {
      key: 'dinos', icon: '🦖', title: 'Dinos', hint: 'Espèces déjà élevées (dinodex).',
      items: Object.entries(DINO_SPECIES).map(([k, d]) => ({ key: k, name: d.label, icon: '🦖', seen: !!(dex.species && dex.species[k]), detail: d.talent || '' }))
    }
  ];
  sections.forEach((sec) => { sec.seen = sec.items.filter((i) => i.seen).length; sec.total = sec.items.length; });
  const seen = sections.reduce((n, x) => n + x.seen, 0), total = sections.reduce((n, x) => n + x.total, 0);
  const done = { ...Object.fromEntries(sections.map((x) => [x.key, x.total > 0 && x.seen === x.total])), all: total > 0 && seen === total };
  const fresh = [];
  const badges = Object.entries(BADGES).map(([k, b]) => {
    if (done[k] && grantCosmetic(store, user.id, 'museum-' + k, { type: 'title', label: b.label })) fresh.push(b.label);
    return { key: k, ...b, earned: !!done[k] };
  });
  return { sections, seen, total, pct: total ? Math.round((100 * seen) / total) : 0, badges, newBadges: fresh };
}

function handle({ store, body, query }) {
  const input = { ...(query || {}), ...(body || {}) };
  const user = userById(store, input.userId);
  if (!user) return fail('unknown_user', 404);
  return ok(view(store, user));
}

// Profil public : badges du musee deja obtenus (titres museum-*).
export function afterWorkflow({ store, path, request, response }) {
  if (path !== 'public-profile' || response.status !== 200 || !response.json || !store.tables.has('UserCosmetics')) return;
  const pseudo = String((request.query || {}).pseudo || (request.body || {}).pseudo || '').toLowerCase();
  const user = pseudo && store.getAll('Users').find((u) => String(u.Pseudo || '').toLowerCase() === pseudo);
  if (!user) return;
  const keys = new Set(store.getAll('UserCosmetics').filter((r) => Number(Array.isArray(r.User) ? r.User[1] : r.User) === user.id && String(r.Key || '').startsWith('museum-')).map((r) => r.Key.slice(7)));
  response.json.museumBadges = Object.entries(BADGES).filter(([k]) => keys.has(k)).map(([k, b]) => ({ key: k, ...b }));
}

// Progression (recap de la semaine).
export function progressOf(store, user) { const v = view(store, user); return { seen: v.seen, total: v.total, pct: v.pct }; }
export const routes = { 'GET museum': handle, 'POST museum': handle };
