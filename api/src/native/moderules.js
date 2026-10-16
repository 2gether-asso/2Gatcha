// Regles par difficulte (2026-10-16) : TOUTES les regles propres a un mode de
// jeu (bonus, malus et fonctionnalites exclusives) dans un seul registre, avec
// un interrupteur par regle (page Admin > Difficultes). Une regle ne joue que
// dans son mode ET si elle n'est pas desactivee.
//   ruleOn(store, 'cool.wishbox')  -> vrai si le mode Cool est en cours et la
//   regle active. Les modules concernes l'interrogent a la place de modeIs.
// Stockage : AppSettings 'mode-rules' = { off: [cles desactivees] }.
//   POST /webhook/admin-mode-rules { discordId, action: 'status' | 'set' | 'mode', key?, on?, mode? }
//   GET  /webhook/mode-rules ?userId=   (regles actives du mode en cours, pour le site)
//
// Aussi ici, car partages par plusieurs modules : heure joyeuse (Chill),
// tempetes (Hard).

import { ok, fail, isAdmin, parisDay, parisHour, parseJson } from './common.js';
import { currentMode, PRESETS, PRESET_INFO } from './presets.js';
import { REGISTRY } from './settings.js';

const KEY = 'mode-rules';
export const MODES = ['cool', 'chill', 'medium', 'hard', 'chaos'];

// kind : 'bonus' (avantage), 'malus' (contrainte), 'extra' (fonctionnalite exclusive).
export const RULES = [
  // ------------------------------------------------------------------ Cool
  { key: 'cool.hug', mode: 'cool', kind: 'bonus', icon: '🎁', label: 'Câlin du jour', desc: 'Un petit cadeau à la première connexion du jour (vers, poussières ou fragments).' },
  { key: 'cool.fishNoEmpty', mode: 'cool', kind: 'bonus', icon: '🎣', label: 'Pêche sans prise vide', desc: 'Plus aucune prise vide à la pêche.' },
  { key: 'cool.decraftUndo', mode: 'cool', kind: 'bonus', icon: '↩️', label: 'Décraft annulable', desc: 'Un décraft peut être annulé pendant 24 h (en rendant les poussières).' },
  { key: 'cool.dogTwice', mode: 'cool', kind: 'bonus', icon: '🐕', label: 'Chien généreux', desc: 'Le chien rapporte 2 trouvailles par jour au lieu d’une.' },
  { key: 'cool.magicGarden', mode: 'cool', kind: 'bonus', icon: '🌱', label: 'Jardin magique', desc: 'Les plantes ne fanent plus et une récolte sur cinq est rare.' },
  { key: 'cool.noTax', mode: 'cool', kind: 'bonus', icon: '🤝', label: 'Échanges sans taxe', desc: 'Aucune taxe sur les échanges et les enchères.' },
  { key: 'cool.edition', mode: 'cool', kind: 'bonus', icon: '❄️', label: 'Édition Givrée', desc: 'Les cartes des boosters peuvent sortir en édition limitée Givrée.' },
  { key: 'cool.wishbox', mode: 'cool', kind: 'extra', icon: '🎀', label: 'Boîte à souhaits', desc: 'Une fois par semaine, choisir une carte de sa liste de souhaits : elle tombe forcément dans un des 10 prochains boosters.', isNew: true },
  { key: 'cool.freeRepair', mode: 'cool', kind: 'extra', icon: '🧰', label: 'Atelier gratuit', desc: 'Une restauration par jour : un exemplaire gagne un cran d’état, sans poussières ni exemplaire sacrifié.', isNew: true },
  { key: 'cool.secondChance', mode: 'cool', kind: 'extra', icon: '🔁', label: 'Seconde chance', desc: 'Une fois par jour, relancer une carte du dernier booster ouvert (même rareté, même finition).', isNew: true },
  { key: 'cool.dinoHoliday', mode: 'cool', kind: 'extra', icon: '🏖️', label: 'Vacances des dinos', desc: 'Les dinos ne perdent ni faim ni humeur, et pondent deux fois plus vite.', isNew: true },
  // ------------------------------------------------------------------ Chill
  { key: 'chill.luckyHours', mode: 'chill', kind: 'bonus', icon: '🍀', label: 'Deux heures de chance', desc: 'Deux heures de chance par jour au lieu d’une.' },
  { key: 'chill.weekendPity', mode: 'chill', kind: 'bonus', icon: '🎯', label: 'Pity du week-end', desc: 'Le pity avance deux fois plus vite le samedi et le dimanche.' },
  { key: 'chill.wednesdayMarket', mode: 'chill', kind: 'bonus', icon: '☀️', label: 'Marché du mercredi', desc: 'Le marché du dimanche ouvre aussi le mercredi.' },
  { key: 'chill.fourthChallenge', mode: 'chill', kind: 'bonus', icon: '🎯', label: '4e défi', desc: 'Un 4e défi de la semaine, et des fragments de booster en plus.' },
  { key: 'chill.luckyDupe', mode: 'chill', kind: 'bonus', icon: '🍀', label: 'Doublon porte-bonheur', desc: 'Un doublon sur dix devient une carte qui te manque.' },
  { key: 'chill.edition', mode: 'chill', kind: 'bonus', icon: '🌺', label: 'Édition Tropicale', desc: 'Les cartes des boosters peuvent sortir en édition limitée Tropicale.' },
  { key: 'chill.happyHour', mode: 'chill', kind: 'extra', icon: '🍹', label: 'Happy hour', desc: 'Chaque jour de 18 h à 19 h : boutique et boosters de la boutique à -30 %.', isNew: true },
  { key: 'chill.sharedGarden', mode: 'chill', kind: 'extra', icon: '🌻', label: 'Jardin partagé', desc: 'Une parcelle commune que tout le monde arrose ; à maturité, la récolte est partagée selon la participation.', isNew: true },
  { key: 'chill.dinoWalk', mode: 'chill', kind: 'extra', icon: '🦕', label: 'Balade du dino', desc: 'Une fois par jour et par dino : une promenade d’une heure qui rapporte des trouvailles et de la bonne humeur.', isNew: true },
  // ------------------------------------------------------------------ Medium
  { key: 'medium.bet', mode: 'medium', kind: 'extra', icon: '🎲', label: 'Pari du booster', desc: 'Miser des poussières à l’ouverture : triplées si une épique (ou mieux) sort.' },
  { key: 'medium.contract', mode: 'medium', kind: 'extra', icon: '📜', label: 'Contrat de la semaine', desc: 'Un objectif personnel par semaine, un booster à la clé.' },
  { key: 'medium.edge', mode: 'medium', kind: 'extra', icon: '⚔️', label: 'Booster à double tranchant', desc: '3 cartes seulement, mais une rare ou mieux garantie.' },
  { key: 'medium.luckyOpen', mode: 'medium', kind: 'bonus', icon: '🍀', label: 'Coup de chance du jour', desc: 'Un booster par jour, au hasard, a ses chances de finition doublées.' },
  { key: 'medium.edition', mode: 'medium', kind: 'bonus', icon: '🔷', label: 'Édition Prismatique', desc: 'Les cartes des boosters peuvent sortir en édition limitée Prismatique.' },
  { key: 'medium.stock', mode: 'medium', kind: 'extra', icon: '📊', label: 'Bourse des cartes', desc: 'Le prix de décraft et de craft d’une carte suit sa rareté réelle sur le serveur : moins il y en a, plus elle vaut (de ×0,7 à ×1,6).', isNew: true },
  { key: 'medium.draft', mode: 'medium', kind: 'extra', icon: '🃏', label: 'Draft', desc: 'Jusqu’à 4 joueurs misent un booster chacun ; les cartes sont étalées au centre et chacun pioche à son tour.', isNew: true },
  { key: 'medium.questChain', mode: 'medium', kind: 'extra', icon: '🗺️', label: 'Quête en chaîne', desc: 'Une petite histoire par semaine en 5 étapes à travers les jeux ; chaque étape récompense, la dernière beaucoup.', isNew: true },
  // ------------------------------------------------------------------ Hard
  { key: 'hard.wear', mode: 'hard', kind: 'malus', icon: '🧽', label: 'Usure des doublons', desc: 'Un doublon peut perdre un cran d’état chaque jour (sauf sous un parapluie).' },
  { key: 'hard.forge', mode: 'hard', kind: 'malus', icon: '🔥', label: 'Finitions forgées', desc: 'Une finition spéciale sur quatre retombe en normale, mais les arc-en-ciel sont « forgées dans les flammes ».' },
  { key: 'hard.bossEnraged', mode: 'hard', kind: 'malus', icon: '👹', label: 'Boss enragé', desc: 'Boss 2× plus résistant, récompense ×3.' },
  { key: 'hard.blackMarket', mode: 'hard', kind: 'malus', icon: '🌋', label: 'Marché noir brûlant', desc: 'Offres du marché noir plus rares et plus courtes.' },
  { key: 'hard.luxuryTax', mode: 'hard', kind: 'malus', icon: '💸', label: 'Taxe de luxe', desc: 'Les plus riches paient plus de taxe, redistribuée chaque lundi aux joueurs actifs.' },
  { key: 'hard.survival', mode: 'hard', kind: 'bonus', icon: '🏆', label: 'Succès de survie', desc: 'Titre et cadres exclusifs (légendaire en Hard, 7 jours en Hard).' },
  { key: 'hard.leaderboard', mode: 'hard', kind: 'bonus', icon: '🥇', label: 'Classement Hard', desc: 'Points gagnés seulement pendant la période Hard, remis à zéro à chaque passage.' },
  { key: 'hard.edition', mode: 'hard', kind: 'bonus', icon: '🔥', label: 'Édition Braise', desc: 'Les cartes des boosters peuvent sortir en édition limitée Braise.' },
  { key: 'hard.ironman', mode: 'hard', kind: 'extra', icon: '🛡️', label: 'Ironman', desc: 'S’engager (dans les 48 premières heures) à ne rien décrafter de toute la période Hard : titre, cadre et 5 boosters si l’on tient.', isNew: true },
  { key: 'hard.bounty', mode: 'hard', kind: 'extra', icon: '💰', label: 'Primes de chasse', desc: 'Une prime sur une carte épique ou mieux : le premier qui en livre un exemplaire remporte 4 boosters et 500 poussières.', isNew: true },
  { key: 'hard.cursed', mode: 'hard', kind: 'malus', icon: '🕯️', label: 'Cartes maudites', desc: '5 % des cartes tirées sont maudites : les purifier sous 48 h (poussières), sinon elles perdent un cran d’état.', isNew: true },
  { key: 'hard.theft', mode: 'hard', kind: 'extra', icon: '🦹', label: 'Larcin', desc: 'Une clé pour tenter (35 %) de voler un doublon non protégé à un joueur ; 3 tentatives par jour. Assurance, coffre, ★ et éditions protègent.', isNew: true },
  { key: 'hard.storms', mode: 'hard', kind: 'malus', icon: '⛈️', label: 'Tempêtes', desc: 'Certains jours, une tempête ferme la pêche ou la fouille pendant 3 h (annoncée 2 h avant).', isNew: true },
  // ------------------------------------------------------------------ Chaos
  { key: 'chaos.dailyRule', mode: 'chaos', kind: 'extra', icon: '👾', label: 'Règle du jour', desc: 'Chaque jour une règle surprise (pêche à moitié prix, doublons ×2, marché noir fermé…).' },
  { key: 'chaos.edition', mode: 'chaos', kind: 'bonus', icon: '👾', label: 'Édition Glitch', desc: 'Les cartes des boosters peuvent sortir en édition limitée Glitch.' },
  { key: 'chaos.vote', mode: 'chaos', kind: 'extra', icon: '🗳️', label: 'Règle votée', desc: 'Les joueurs votent la règle de demain parmi 3 tirées au hasard (sinon le hasard décide).', isNew: true },
  { key: 'chaos.mutants', mode: 'chaos', kind: 'extra', icon: '🧬', label: 'Cartes mutantes', desc: '10 % des cartes tirées muteront dans les 24 h : finition ou état qui change, en mieux ou en pire.', isNew: true },
  { key: 'chaos.glitchPack', mode: 'chaos', kind: 'extra', icon: '📦', label: 'Boosters glitchés', desc: 'Un booster sur cinq bugue : une carte hors-série en plus, de n’importe quelle extension, en édition Glitch.', isNew: true },
  { key: 'chaos.unstable', mode: 'chaos', kind: 'extra', icon: '🌀', label: 'Carte instable', desc: 'Une carte Glitch offerte par période Chaos, dont l’image et la finition changent chaque jour (figée à la fin du Chaos).', isNew: true },
  { key: 'chaos.bugs', mode: 'chaos', kind: 'extra', icon: '🐛', label: 'Chasse aux bugs', desc: 'Des « bugs » volontaires se cachent dans l’interface (bouton qui fuit, texte à l’envers…) : les trouver rapporte des poussières.', isNew: true }
];
export const RULE = Object.fromEntries(RULES.map((r) => [r.key, r]));

// ------------------------------------------------------------------ etat
let cache = { store: null, at: 0, off: null };
function offSet(store) {
  const t = Date.now();
  if (cache.store === store && t - cache.at < 30000 && cache.off) return cache.off;
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === KEY) : null;
  const off = new Set((parseJson(row && row.Value, {}).off || []).filter((k) => RULE[k]));
  cache = { store, at: t, off };
  return off;
}
function saveOff(store, off) {
  const value = JSON.stringify({ off: [...off].sort() });
  const row = store.getAll('AppSettings').find((r) => r.Key === KEY);
  if (row) store.update('AppSettings', row.id, { Value: value }); else store.create('AppSettings', { Key: KEY, Value: value });
  cache = { store: null, at: 0, off: null };
}
export const modeKeyOf = (store) => (currentMode(store) || {}).key || 'medium';
export const ruleEnabled = (store, key) => !!RULE[key] && !offSet(store).has(key);
// La regle joue maintenant : son mode est en cours et elle est active.
export function ruleOn(store, key) {
  const r = RULE[key];
  return !!r && modeKeyOf(store) === r.mode && !offSet(store).has(key);
}
// Libelles des regles actives d'un mode (annonce du changement de mode).
export function modePerks(store, mode) {
  const off = offSet(store);
  return RULES.filter((r) => r.mode === mode && !off.has(r.key)).map((r) => `${r.icon} ${r.label}`);
}

// ------------------------------------------------------------------ heure joyeuse (Chill)
export const HAPPY_FROM = 18, HAPPY_TO = 19, HAPPY_DISCOUNT = 0.3;
export const happyHourNow = (store) => ruleOn(store, 'chill.happyHour') && parisHour() >= HAPPY_FROM && parisHour() < HAPPY_TO;
export const happyFactor = (store) => (happyHourNow(store) ? 1 - HAPPY_DISCOUNT : 1);

// ------------------------------------------------------------------ tempetes (Hard)
// Une chance sur deux par jour ; fenetre de 3 h entre 9 h et 21 h ; pêche ou fouille.
function hashOf(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; }
export function stormOf(day = parisDay(0)) {
  const h = hashOf('storm:' + day);
  if (h % 2) return null;
  const from = 9 + ((h >> 3) % 10);
  return { day, from, to: from + 3, feature: (h >> 7) % 2 ? 'fishing' : 'dig', label: (h >> 7) % 2 ? 'la pêche' : 'la fouille' };
}
// Tempete du jour si la regle joue : { ..., active, soon }.
export function stormState(store) {
  if (!ruleOn(store, 'hard.storms')) return null;
  const s = stormOf();
  if (!s) return null;
  const h = parisHour();
  return { ...s, active: h >= s.from && h < s.to, soon: h >= s.from - 2 && h < s.from, over: h >= s.to };
}
// Fonctionnalites fermees par une tempete en cours (features.js).
export function stormClosed(store) {
  const s = stormState(store);
  return s && s.active ? [s.feature] : [];
}

// ------------------------------------------------------------------ vues
// Reglages chiffres du mode (presets.js), avec les libelles du registre.
function presetSummary(mode) {
  const v = (PRESETS[mode] && PRESETS[mode].values) || {};
  return Object.entries(v).filter(([, val]) => typeof val !== 'object').map(([k, val]) => ({ key: k, label: (REGISTRY[k] && REGISTRY[k].label) || k, value: val }));
}

function adminStatus(store, features) {
  const off = offSet(store);
  const current = modeKeyOf(store);
  const matrix = features ? features.matrix(store) : {};
  return {
    current,
    modes: MODES.map((m) => ({
      key: m, label: PRESET_INFO[m]?.label || m, icon: PRESET_INFO[m]?.icon || '', desc: PRESETS[m]?.desc || '', current: m === current,
      presets: presetSummary(m),
      closed: features ? features.FEATURES.filter((f) => (matrix[f.key] || []).includes(m)).map((f) => ({ key: f.key, icon: f.icon, label: f.label })) : [],
      rules: RULES.filter((r) => r.mode === m).map((r) => ({ ...r, on: !off.has(r.key) }))
    }))
  };
}

let featuresMod = null;
export function useFeatures(mod) { featuresMod = mod; }

function handleAdmin({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const action = body.action || 'status';
  if (action === 'set') {
    if (!RULE[body.key]) return fail('unknown_rule');
    const off = new Set(offSet(store));
    if (body.on) off.delete(body.key); else off.add(body.key);
    saveOff(store, off);
  } else if (action === 'mode') {
    if (!MODES.includes(body.mode)) return fail('unknown_mode');
    const off = new Set(offSet(store));
    RULES.filter((r) => r.mode === body.mode && (!body.onlyNew || r.isNew)).forEach((r) => (body.on ? off.delete(r.key) : off.add(r.key)));
    saveOff(store, off);
  } else if (action === 'reset') {
    saveOff(store, new Set());
  } else if (action !== 'status') return fail('unknown_action');
  return ok(adminStatus(store, featuresMod));
}

// Pour le site : regles actives du mode en cours + infos en direct.
export function publicRules(store) {
  const mode = modeKeyOf(store);
  const off = offSet(store);
  const rules = RULES.filter((r) => r.mode === mode && !off.has(r.key)).map((r) => ({ key: r.key, kind: r.kind, icon: r.icon, label: r.label, desc: r.desc, isNew: !!r.isNew }));
  const out = { mode, label: PRESET_INFO[mode]?.label || mode, icon: PRESET_INFO[mode]?.icon || '', rules, on: rules.map((r) => r.key) };
  if (ruleOn(store, 'chill.happyHour')) out.happyHour = { from: HAPPY_FROM, to: HAPPY_TO, discount: HAPPY_DISCOUNT, active: happyHourNow(store) };
  const storm = stormState(store);
  if (storm) out.storm = storm;
  return out;
}

export const routes = {
  'POST admin-mode-rules': handleAdmin,
  'GET mode-rules': ({ store }) => ok(publicRules(store))
};
