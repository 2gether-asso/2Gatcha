// Decouvertes (2026-10-15) : la premiere fois qu'un joueur possede une
// ressource (os, cle, crane de dinosaure, poisson...), la reponse porte
// `discoveries` et le site joue une animation facon carte legendaire, avec
// une description enigmatique. Verifie a la fin de chaque requete du joueur
// (index.js, observe) : peu importe d'ou vient la ressource (fouille, peche,
// echange, cadeau...). Users.Discoveries garde les cles deja vues. Personne
// n'a encore vu ces animations : au premier passage, chaque ressource deja
// possedee est annoncee aussi (une fois). Le joueur peut tout remettre a zero
// depuis son menu (POST discoveries { action: 'reset' }) pour les revoir.
// Les achats volontaires (elixir, gel de serie) ne sont pas des decouvertes.

import { parseJson, ok, fail, userById } from './common.js';

export const schema = { Users: { Discoveries: { type: 'Text' } } };

const num = (field) => (u) => Number(u[field]) || 0;
const food = (key) => (u) => Number(parseJson(u.DinoFood, {})[key]) || 0;
const len = (field) => (u) => { const v = parseJson(u[field], []); return Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0; };

export const RESOURCES = [
  { key: 'key', icon: '🔑', name: 'Clé', has: num('KeyCount'), riddle: 'Une clé ancienne, froide au toucher. Quelque part, une serrure attend patiemment… et peut-être plusieurs.' },
  { key: 'bone', icon: '🦴', name: 'Os', has: num('BoneCount'), riddle: 'Un os bien rongé. Quelqu’un, quelque part, en raffole… et il a du flair. À moins qu’il serve à rebâtir quelque chose de bien plus grand ?' },
  { key: 'worm', icon: '🪱', name: 'Ver de terre', has: num('Worms'), riddle: 'Il se tortille, il gigote. Il ne paie pas de mine, mais ceux qui vivent sous l’eau ne voient pas les choses du même œil.' },
  { key: 'bait', icon: '🌼', name: 'Appât doré', has: num('GoldBait'), riddle: 'Il luit d’une lueur étrange. Ce qui mord à ça ne repart jamais les mains vides.' },
  { key: 'part', icon: '🔩', name: 'Pièce détachée', has: num('SpareParts'), riddle: 'Un rouage oublié. Glissé au bon endroit, il pourrait remplacer bien plus que lui-même.' },
  { key: 'chest', icon: '🪙', name: 'Pièce de gatchapon', has: num('ChestCount'), riddle: 'Une drôle de pièce frappée d’un kraken. Quelque part, une machine à boules n’attend qu’elle.' },
  { key: 'shard', icon: '💠', name: 'Éclat de booster', has: num('BoosterShards'), riddle: 'Un fragment scintillant. Seul, il ne vaut pas grand-chose. Mais rassemblés…' },
  { key: 'ticket', icon: '🎟️', name: 'Ticket de loterie', has: num('LotteryTickets'), riddle: 'Un bout de papier plein de promesses. Le dimanche dira s’il valait quelque chose.' },
  { key: 'uticket', icon: '🎫', name: 'Ticket Unique', has: num('UniqueTickets'), riddle: 'Un ticket marqué d’un sceau rare. On dit qu’il ouvre la porte à ce qui n’existe qu’en un seul exemplaire.' },
  { key: 'skull', icon: '💀', name: 'Crâne de dinosaure', has: num('DinoSkulls'), riddle: 'Un crâne immense, vieux de millions d’années. Avec assez d’os… non, ce serait fou. Et pourtant.' },
  { key: 'fish', icon: '🐟', name: 'Poisson', has: food('fish'), riddle: 'Frais pêché. Pas vraiment pour toi… mais quelqu’un de très, très grand pourrait l’apprécier.' },
  { key: 'seaweed', icon: '🌿', name: 'Algues', has: food('seaweed'), riddle: 'Gluantes et salées. Le régime idéal pour un appétit… préhistorique ?' },
  { key: 'shrimp', icon: '🦐', name: 'Crevette', has: food('shrimp'), riddle: 'Une friandise rose. Ce qui la mange en ressort parfois… plus précieux qu’avant.' },
  { key: 'egg', icon: '🥚', name: 'Œuf', has: len('DinoEggs'), riddle: 'Il est tiède. Et parfois, il bouge.' },
  { key: 'poop', icon: '💩', name: 'Engrais', has: num('DinoPoop'), riddle: 'Ça sent… fort. Mais ce qui pousse dessus pousse étonnamment vite.' },
  { key: 'goldpoop', icon: '✨', name: 'Engrais doré', has: num('DinoGoldPoop'), riddle: 'Un trésor que personne n’ose toucher. La terre, elle, ne fera pas la difficile.' },
  { key: 'fragment', icon: '👻', name: 'Fragment fantôme', has: len('PhantomFragments'), riddle: 'Un morceau de carte translucide. Il en manque d’autres, éparpillés là où tu passes tes journées.' }
];

// Nouvelles ressources du joueur (et note les cles). null si rien de neuf.
export function check(store, userId) {
  const user = userId && store.tables.has('Users') ? store.get('Users', Number(userId)) : null;
  if (!user) return null;
  const seen = new Set(parseJson(user.Discoveries, []));
  const fresh = RESOURCES.filter((r) => !seen.has(r.key) && r.has(user) > 0);
  if (!fresh.length) return null;
  fresh.forEach((r) => seen.add(r.key));
  store.update('Users', user.id, { Discoveries: JSON.stringify([...seen]) });
  return fresh.map(({ key, icon, name, riddle }) => ({ key, icon, name, riddle }));
}

// Catalogue (page Admin : previsualisation des animations).
// Remise a zero (menu du joueur) : la reponse de cette meme requete porte
// deja toutes les decouvertes a revoir (check() passe a la fin, dans index.js).
function handleDiscoveries({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  if (body.action !== 'reset') return ok({ seen: parseJson(user.Discoveries, []) });
  store.update('Users', user.id, { Discoveries: '[]' });
  return ok({ reset: true });
}

export const routes = {
  'GET discoveries-catalog': () => ({ status: 200, json: { items: RESOURCES.map(({ key, icon, name, riddle }) => ({ key, icon, name, riddle })) } }),
  'POST discoveries': handleDiscoveries
};
