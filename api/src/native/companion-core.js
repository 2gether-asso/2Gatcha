// Compagnons V2 (2026-11-16) : le socle partage, sans dependance lourde
// (pets.js, personal-vault.js, cat.js, garden.js, archeo.js l'importent).
//   - Users.Companions = { xp: { milo: n }, path: { milo: 'tracker' },
//     gear: { milo: { collar: 1, tool: 0, charm: 2, gem: 'rubis' } },
//     mission: { milo: { place, hours, start, end, duo } | { lead, end } },
//     friend: { 'milo+moka': xp }, mood: { day, done: { milo: true } },
//     active: { milo: day }, souv: { key: 1 }, week: { w, xp }, log: [...],
//     adopt: { praline: at }, owl: n, parrot: n, parrotDay, owlDay: { day, n } }
//   - Users.PetFrags : fragments d'equipement.
// Niveaux 1 a 30 : il faut CompanionXpBase x (L-1) x L XP pour le niveau L.
// Chaque niveau : +0,4 % de vitesse, +1 % de butin ; niveau 5 : +3 % de
// chance de cadeau ; 10 : missions de 8 h ; 15 : choix de la voie ; 20 et 25 :
// competences ; 30 : competence active (une fois par jour).
import { parseJson } from './common.js';
import { setting } from './settings.js';

export const LEVEL_MAX = 30;
export const V2_PETS = ['praline', 'reglisse', 'paprika'];

export function compOf(user) {
  const c = parseJson(user && user.Companions, null);
  const o = c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  for (const k of ['xp', 'path', 'gear', 'mission', 'friend', 'active', 'souv', 'adopt', 'restUntil']) if (!o[k] || typeof o[k] !== 'object') o[k] = {};
  if (!Array.isArray(o.log)) o.log = [];
  return o;
}
export const compJson = (c) => JSON.stringify(c);

export const xpForLevel = (store, l) => Math.max(1, setting(store, 'CompanionXpBase')) * (l - 1) * l;
export function levelOf(store, xp) {
  let l = 1;
  while (l < LEVEL_MAX && (Number(xp) || 0) >= xpForLevel(store, l + 1)) l++;
  return l;
}
export const petLevel = (store, user, pet) => levelOf(store, compOf(user).xp[pet] || 0);

// Le compagnon est-il parti en mission (seul ou en duo) ?
// Mission enregistree (en cours, ou finie et pas encore recuperee).
export function missionRaw(user, pet, c = compOf(user)) {
  const m = c.mission[pet];
  return m && Number(m.end) > 0 ? m : null;
}
// En mission = absent : seulement jusqu'a la fin. Le compagnon rentre tout
// seul (avis #92, 2026-11-19) ; ses trouvailles l'attendent (« Récupérer »).
export function missionOf(user, pet, c = compOf(user), t = Math.floor(Date.now() / 1000)) {
  const m = missionRaw(user, pet, c);
  return m && t < Number(m.end) ? m : null;
}
export const onMission = (user, pet) => !!missionOf(user, pet);
// Pause au retour, avant de reprendre le travail : 20 min pour 2 h, 30 pour 4 h, 40 pour 8 h.
export const missionRest = (hours) => ({ 2: 20, 4: 30, 8: 40 }[hours] ?? Math.round(10 + hours * 4)) * 60;
// Encore en mission, ou dans sa pause du retour.
// m.back = fin + pause (missions parties depuis le 19/11/2026) ; une fois
// recuperee, la fin de la pause reste dans c.restUntil.
export function missionResting(user, pet, c = compOf(user), t = Math.floor(Date.now() / 1000)) {
  const m = missionRaw(user, pet, c);
  if (m && t < (Number(m.back) || Number(m.end))) return true;
  return Number(c.restUntil[pet]) > t;
}

// --- voies et competences ----------------------------------------------
// Effets passifs : speed, loot, gift, rest (pause raccourcie), decay
// (affection qui baisse moins vite), xp, interest, bankDays, vaultXp,
// night (jetons de nuit de Reglisse), nightCap, boosterDust, spins ;
// extra = { kind, chance par unite de travail, ... } (voir companions.js).
const S = (lvl, label, desc, fx = {}) => ({ lvl, label, desc, ...fx });
export const PATHS = {
  milo: [
    { key: 'tracker', label: 'Pisteur', icon: '🐾', desc: 'Il flaire les trésors : minéraux, coffres enfouis et poussières.', skills: [
      S(15, 'Truffe fine', '3 % de chance par case creusée de rapporter un minéral.', { extra: { kind: 'mineral', chance: 0.03, tiers: [1, 3] } }),
      S(20, 'Chercheur d’or', '+15 % de poussières.', { loot: 0.15 }),
      S(25, 'Coffre enfoui', '0,4 % de chance par case de déterrer une boule Explorateur.', { extra: { kind: 'ball', chance: 0.004, family: 'explorer', tiers: [2, 4] } }),
      S(30, 'Flair absolu', 'Une fois par jour : un minéral rare, 150 ✨ et 30 % de chance d’une boule Explorateur.', { active: true })] },
    { key: 'digger', label: 'Terrassier', icon: '⛏️', desc: 'Il creuse vite et longtemps.', skills: [
      S(15, 'Pattes solides', '+10 % de vitesse.', { speed: 0.1 }),
      S(20, 'Second souffle', 'Pauses 30 % plus courtes.', { rest: 0.3 }),
      S(25, 'Lombric', '15 % de chance par case de rapporter un ver de terre.', { extra: { kind: 'worm', chance: 0.15, n: 1 } }),
      S(30, 'Pelle infatigable', 'Une fois par jour : 3 h de fouille offertes, sans os.', { active: true })] }
  ],
  moka: [
    { key: 'deep', label: 'Pêcheuse de fond', icon: '🎣', desc: 'Elle vise les belles prises.', skills: [
      S(15, 'Appât doré', '2 % de chance par lancer de rapporter un appât doré.', { extra: { kind: 'bait', chance: 0.02, n: 1 } }),
      S(20, 'Grosses prises', '+15 % de poussières.', { loot: 0.15 }),
      S(25, 'Bouteille à la mer', '0,4 % de chance par lancer de repêcher une pièce de gatchapon Nature.', { extra: { kind: 'coin', chance: 0.004, family: 'nature' } }),
      S(30, 'Grande marée', 'Une fois par jour : 3 appâts dorés, 120 ✨ et 30 % de chance d’une boule Nature.', { active: true })] },
    { key: 'gourmet', label: 'Gourmande', icon: '🐟', desc: 'Elle remplit le garde-manger de l’enclos.', skills: [
      S(15, 'Garde-manger', '10 % de chance par lancer de garder un poisson pour les dinos.', { extra: { kind: 'dinofood', chance: 0.1, food: 'fish' } }),
      S(20, 'Sieste courte', 'Pauses 30 % plus courtes.', { rest: 0.3 }),
      S(25, 'Fruits de mer', '6 % de chance par lancer de rapporter crevettes ou algues.', { extra: { kind: 'dinofood', chance: 0.06, food: 'sea' } }),
      S(30, 'Festin', 'Une fois par jour : 15 poissons, 10 algues et 6 crevettes pour l’enclos.', { active: true })] }
  ],
  noisette: [
    { key: 'gardener', label: 'Jardinière', icon: '🌱', desc: 'Le potager pousse plus vite et donne plus.', skills: [
      S(15, 'Pouce vert', '+10 % de vitesse.', { speed: 0.1 }),
      S(20, 'Belles récoltes', '+15 % de poussières et de vers.', { loot: 0.15 }),
      S(25, 'Ver doré', '5 % de chance par récolte de rapporter un appât doré.', { extra: { kind: 'bait', chance: 0.05, n: 1 } }),
      S(30, 'Pluie de printemps', 'Une fois par jour : toutes les parcelles plantées sont prêtes.', { active: true })] },
    { key: 'picker', label: 'Cueilleuse', icon: '🧺', desc: 'Elle ramène de quoi cuisiner.', skills: [
      S(15, 'Panier', '15 % de chance par récolte de rapporter un ingrédient.', { extra: { kind: 'pantry', chance: 0.15 } }),
      S(20, 'Petits cadeaux', '+5 % de chance de cadeau.', { gift: 0.05 }),
      S(25, 'Carottes sauvages', '10 % de chance par récolte de trouver une carotte.', { extra: { kind: 'carrot', chance: 0.1, n: 1 } }),
      S(30, 'Panier garni', 'Une fois par jour : 2 de chaque ingrédient du jardin.', { active: true })] }
  ],
  pistache: [
    { key: 'restorer', label: 'Restaurateur', icon: '🖌️', desc: 'Des trouvailles plus propres.', skills: [
      S(15, 'Pattes délicates', '+10 % de butin.', { loot: 0.1 }),
      S(20, 'Travail soigné', '+10 % de vitesse.', { speed: 0.1 }),
      S(25, 'Os anciens', '10 % de chance par tâche de rapporter un os.', { extra: { kind: 'bone', chance: 0.1, n: 1 } }),
      S(30, 'Coup de pinceau', 'Une fois par jour : tous tes blocs en cours redeviennent intacts.', { active: true })] },
    { key: 'rummager', label: 'Fouineur', icon: '🔎', desc: 'Il déniche tablettes et crânes.', skills: [
      S(15, 'Nez fouineur', '4 % de chance par tâche de rapporter une tablette d’argile.', { extra: { kind: 'tablet', chance: 0.04 } }),
      S(20, 'Curieux', '+15 % d’XP.', { xp: 0.15 }),
      S(25, 'Crâne', '1 % de chance par tâche de rapporter un crâne de dinosaure.', { extra: { kind: 'skull', chance: 0.01, n: 1 } }),
      S(30, 'Grand déterrage', 'Une fois par jour : 3 tablettes (dont une pierre gravée) et un crâne.', { active: true })] }
  ],
  poivre: [
    { key: 'saucier', label: 'Chef de partie', icon: '👨‍🍳', desc: 'Des plats mieux réussis.', skills: [
      S(15, 'Palais fin', '+8 % de chance de plat parfait.', { quality: 0.08 }),
      S(20, 'Coup de poignet', '+10 % de vitesse.', { speed: 0.1 }),
      S(25, 'Toque blanche', '+8 % de chance de plat parfait.', { quality: 0.08 }),
      S(30, 'Coup de feu', 'Une fois par jour : 3 plats tout de suite, au moins réussis (avec ce qu’il y a au garde-manger).', { active: true })] },
    { key: 'econome', label: 'Économe', icon: '🧺', desc: 'Il fait durer le garde-manger.', skills: [
      S(15, 'Rien ne se perd', '10 % de chance par plat de ne consommer aucun ingrédient.', { save: 0.1 }),
      S(20, 'Jour de marché', '15 % de chance par plat de rapporter un ingrédient.', { extra: { kind: 'pantry', chance: 0.15 } }),
      S(25, 'Recette de grand-mère', '10 % de chance de plus de ne rien consommer.', { save: 0.1 }),
      S(30, 'Garde-manger plein', 'Une fois par jour : 3 de chaque ingrédient de base (légumes, herbes, baies, champignons, miel).', { active: true })] }
  ],
  praline: [
    { key: 'banker', label: 'Banquière', icon: '💰', desc: 'Les intérêts du coffre-fort grossissent.', skills: [
      S(15, 'Petit pécule', '+10 % d’intérêts.', { interest: 0.1 }),
      S(20, 'Épargne', '+2 jours d’intérêts mis de côté.', { bankDays: 2 }),
      S(25, 'Intérêts composés', '+10 % d’intérêts.', { interest: 0.1 }),
      S(30, 'Dividende', 'Une fois par jour : une journée d’intérêts en plus.', { active: true })] },
    { key: 'keeper', label: 'Collectionneuse', icon: '🗃️', desc: 'Le coffre-fort monte plus vite.', skills: [
      S(15, 'Œil expert', '+5 % d’XP du coffre-fort.', { vaultXp: 0.05 }),
      S(20, 'Inventaire', '+5 % d’XP du coffre-fort.', { vaultXp: 0.05 }),
      S(25, 'Patience', '+5 % de chance de cadeau.', { gift: 0.05 }),
      S(30, 'Trouvaille', 'Une fois par jour : 2 jetons booster.', { active: true })] }
  ],
  reglisse: [
    { key: 'night', label: 'Noctambule', icon: '🌙', desc: 'La nuit, des jetons en plus.', skills: [
      S(15, 'Vol de nuit', '+3 % de chance de jeton booster par booster ouvert la nuit.', { night: 0.03 }),
      S(20, 'Ailes silencieuses', '+3 % de chance de jeton la nuit.', { night: 0.03 }),
      S(25, 'Pleine lune', '+2 jetons de nuit au maximum par jour.', { nightCap: 2 }),
      S(30, 'Nuit étoilée', 'Une fois par jour : 3 jetons booster.', { active: true })] },
    { key: 'watch', label: 'Vigie', icon: '👁️', desc: 'Des poussières à chaque booster, de jour comme de nuit.', skills: [
      S(15, 'Regard perçant', 'Poussières de Réglisse ×1,5.', { boosterDust: 0.5 }),
      S(20, 'Plume', '1 % de chance par booster d’une pièce de gatchapon Collectionneur.', { extra: { kind: 'coin', chance: 0.01, family: 'collector' } }),
      S(25, 'Vue d’ensemble', 'Poussières de Réglisse ×1,5 encore.', { boosterDust: 0.5 }),
      S(30, 'Œil de lynx', 'Une fois par jour : une boule Collectionneur de palier 4 à 6.', { active: true })] }
  ],
  paprika: [
    { key: 'talker', label: 'Bavard', icon: '💬', desc: 'Plus de tours gratuits chaque jour.', skills: [
      S(15, 'Jacasse', '+1 tour gratuit par jour.', { spins: 1 }),
      S(20, 'Répète après moi', '+1 tour gratuit par jour.', { spins: 1 }),
      S(25, 'Écho', '+1 tour gratuit par jour.', { spins: 1 }),
      S(30, 'Coup de bec', 'Une fois par jour : 5 tours gratuits.', { active: true })] },
    { key: 'lucky', label: 'Porte-bonheur', icon: '🍀', desc: 'Il picore des jetons de la salle.', skills: [
      S(15, 'Picorer', '10 % de chance par tour de trouver 5 jetons de la salle.', { extra: { kind: 'chips', chance: 0.1, n: 5 } }),
      S(20, 'Plumes dorées', '+5 % de chance de cadeau.', { gift: 0.05 }),
      S(25, 'Trésor du pirate', '+10 % de chance encore de trouver 5 jetons.', { extra: { kind: 'chips', chance: 0.1, n: 5 } }),
      S(30, 'Butin du capitaine', 'Une fois par jour : 100 jetons de la salle.', { active: true })] }
  ]
};

// --- equipement ----------------------------------------------------------
export const GEAR = {
  collar: { label: 'Collier', icon: '📿', tiers: [
    { name: 'Collier de cuir', gift: 0.03, decay: 0.15 }, { name: 'Collier brodé', gift: 0.06, decay: 0.3 }, { name: 'Collier d’or', gift: 0.1, decay: 0.5 }] },
  tool: { label: 'Outil', icon: '🧰', tiers: [
    { name: 'Outil de bois', speed: 0.04, loot: 0.03 }, { name: 'Outil de fer', speed: 0.08, loot: 0.06 }, { name: 'Outil de maître', speed: 0.12, loot: 0.1 }] },
  charm: { label: 'Porte-bonheur', icon: '🍀', tiers: [
    { name: 'Trèfle', xp: 0.1 }, { name: 'Fer à cheval', xp: 0.2 }, { name: 'Étoile filante', xp: 0.35 }] }
};
export const GEAR_COST = [
  { dust: 300, parts: 2, frags: 2 },
  { dust: 900, parts: 4, frags: 6, tier: 2, minerals: 3 },
  { dust: 2500, parts: 8, frags: 15, tier: 3, minerals: 2, gold: 1 }
];

// Bonus cumules d'un compagnon (niveau + voie + equipement + pierre).
export function perksOf(store, user, pet) {
  const out = { speed: 0, loot: 0, gift: 0, rest: 0, decay: 0, xp: 0, quality: 0, save: 0, interest: 0, bankDays: 0, vaultXp: 0, night: 0, nightCap: 0, boosterDust: 0, spins: 0, extras: [], level: 1 };
  if (!setting(store, 'CompanionsEnabled')) return out;
  const c = compOf(user);
  const lvl = levelOf(store, c.xp[pet] || 0);
  out.level = lvl;
  out.speed += lvl * 0.004;
  out.loot += lvl * 0.01;
  if (lvl >= 5) out.gift += 0.03;
  const path = (PATHS[pet] || []).find((p) => p.key === c.path[pet]);
  if (path && lvl >= 15) for (const s of path.skills) {
    if (s.lvl > lvl || s.active) continue;
    for (const k of Object.keys(out)) if (typeof out[k] === 'number' && typeof s[k] === 'number' && k !== 'level') out[k] += s[k];
    if (s.extra) out.extras.push(s.extra);
  }
  const g = c.gear[pet] || {};
  for (const slot of Object.keys(GEAR)) {
    const t = GEAR[slot].tiers[(Number(g[slot]) || 0) - 1];
    if (t) for (const k of ['gift', 'decay', 'speed', 'loot', 'xp']) out[k] += t[k] || 0;
  }
  if (g.gem && Number(g.charm) > 0) {
    const tier = Number(g.gemTier) || 3;
    out.loot += 0.02 * tier; out.xp += 0.03 * tier;
  }
  out.decay = Math.min(0.8, out.decay);
  out.rest = Math.min(0.8, out.rest);
  return out;
}
