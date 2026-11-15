// Metiers du joueur en une lecture (Progression V2, 2026-11-15) : niveau de
// chaque jeu, XP vers le niveau suivant et etoiles de prestige. Lecture seule ;
// la machine de la porte interdite n'y figure pas (secret).
//   GET /webhook/skills ?userId= -> { skills: [{ key, label, icon, level, max, xp, current, next, prestige, url }] }

import { ok, fail, userById } from './common.js';
import { setting } from './settings.js';
import { levelInfo, digLevel, expeditionLevel, gardenLevel } from './levels.js';
import { archLevel } from './archeo.js';
import { cookLevel } from './cooking.js';

function handle({ store, query }) {
  const user = userById(store, query.userId);
  if (!user) return fail('unknown_user', 404);
  const row = (key, label, icon, url, info, prestige = 0) => ({ key, label, icon, url, level: info.level, max: info.max || 10, xp: info.xp, current: info.current ?? info.prev ?? 0, next: info.next ?? null, prestige });
  const fish = levelInfo(user.FishingXP, setting(store, 'FishingLevelXpStep'));
  const dig = digLevel(store, user), expe = expeditionLevel(store, user), garden = gardenLevel(store, user);
  const skills = [
    row('dig', 'Fouille', '⛏️', 'jeux.html#fouille', dig, dig.prestige),
    row('fishing', 'Pêche', '🎣', 'jeux.html#peche', fish, Number(user.FishingPrestige) || 0),
    row('garden', 'Jardin', '🌱', 'jeux.html#jardin', garden, garden.prestige),
    row('expedition', 'Expédition', '🧭', 'jeux.html#expedition', expe, expe.prestige),
    row('archeo', 'Archéologie', '🏺', 'jeux.html#archeologie', archLevel(user)),
    row('cook', 'Cuisine', '🧑‍🍳', 'jeux.html#cuisine', cookLevel(store, user))
  ];
  return ok({ skills });
}

export const routes = { 'GET skills': handle };
