// Progression d'un nouveau joueur (2026-10-18).
//  - Parcours du debutant (setting StarterSteps) : etapes guidees a valider
//    dans l'ordre, chacune avec sa recompense (de quoi faire l'etape suivante),
//    puis un bonus final (StarterFinalReward). La progression compte des que
//    l'action est faite (meme en avance) ; on reclame dans l'ordre.
//  - Deblocages par niveau (StarterUnlocks : { fonctionnalite de features.js :
//    niveau }) : jeux et pages verrouilles tant que le niveau de compte n'est
//    pas atteint. Seulement pour les comptes crees apres la mise en ligne
//    (StarterSince, pose au premier demarrage) : les joueurs deja la ne
//    perdent rien. Le site garde les onglets visibles avec un cadenas ; l'API
//    refuse les ecritures ({ error: 'level_locked', level }).
//  - Tant que le parcours n'est pas fini, l'accueil est simplifie (site).
//  - Surprises (2026-10-29) : rien de ce qui est encore verrouille n'est
//    montre ni nomme (onglets et liens masques, etapes futures « mystere »).
//    Chaque deblocage arrive avec une cinematique (checkUnlocks, renvoye
//    dans « discoveries » de la reponse, comme une decouverte).
//  - Milo et Moka (2026-10-29) : un nouveau compte n'a pas d'animaux ; Milo
//    l'adopte au premier os, Moka au premier poisson (Users.PetsAdopted).
//  - Decouvertes (2026-10-30) : meme principe pour des pans entiers du site
//    (FIND_UNLOCKS : archeologie, promenade, cuisine, aquarium, musee). Rien
//    n'est montre avant la premiere trouvaille (tablette, compagnon,
//    ingredient...), puis cinematique « Nouvelle découverte ! » et le bout du
//    site apparait (Users.StarterFound). Ecritures refusees avant (not_discovered).
//  - Activites en decouverte (2026-10-30, demande explicite) : les
//    fonctionnalites de StarterUnlocks s'ouvrent elles aussi par une
//    trouvaille (FEATURE_FINDS : premier ver -> peche, premier crane -> dinos,
//    premiere carte brillante -> coffre-fort...). Le niveau de StarterUnlocks
//    n'est plus qu'un filet de securite : « au plus tard » a ce niveau.
//   GET  /webhook/starter?userId=
//   POST /webhook/starter { userId, action: 'status' | 'claim', key? }

import { ok, fail, userById, levelForXp, parseJson, now } from './common.js';
import { setting, rawSetting, setSettings } from './settings.js';
import { FEATURES } from './features.js';
import { captureError } from '../monitoring.js';

export const schema = { Users: { StarterState: { type: 'Text' }, StarterSeen: { type: 'Text' }, PetsAdopted: { type: 'Text' }, StarterFound: { type: 'Text' } } };

// Compagnons a adopter : premiere fois que le joueur a la ressource (ou deja
// utilise l'animal avant cette regle). hide : ce que le site masque avant.
export const PET_UNLOCKS = [
  { key: 'milo', icon: '🐕', label: 'Milo', url: 'jeux.html#fouille', hide: ['#dig-kennel'],
    had: (u) => Number(u.BoneCount) > 0 || Number(u.DogUntil) > 0 || Number(u.DogTiredUntil) > 0,
    text: 'Un chien errant a flairé ton os… et ne te quitte plus d’une semelle. Il s’appelle Milo : donne-lui un os et il creuse la fouille à ta place.' },
  { key: 'moka', icon: '🐈', label: 'Moka', url: 'jeux.html#peche', hide: ['#fish-cat'],
    had: (u) => Number(u.CatFish) > 0 || !!u.CatState,
    text: 'Une odeur de poisson frais… Un chat curieux s’installe sur ton ponton. C’est Moka : nourris-le de poisson et il pêche pour toi.' },
  // 2026-10-30 : jardin et archeologie.
  { key: 'noisette', icon: '🐇', label: 'Noisette', url: 'jeux.html#jardin', hide: ['#garden-bunny'],
    had: (u) => Number(u.Carrots) > 0 || !!u.BunnyState,
    text: 'Une petite lapine a suivi l’odeur de ta carotte jusqu’au potager… Elle s’appelle Noisette : donne-lui des carottes et elle récolte et replante le jardin à ta place.' },
  { key: 'pistache', icon: '🦔', label: 'Pistache', url: 'jeux.html#archeologie', hide: ['#archeo-mole'],
    had: (u) => Number(u.Grubs) > 0 || !!u.MoleState,
    text: 'Un hérisson renifle tes vers blancs et refuse de partir. C’est Pistache : nourris-le et il gratte tes tablettes et nettoie tes blocs bruts pour toi.' }
];
// Pans du site a decouvrir (nouveaux comptes) : had(user, adopted) = la
// premiere trouvaille est faite. Chaque declencheur vient d'une activite deja
// visible (la fouille donne les tablettes, la peche les poissons...).
// paths : routes dont les ecritures sont refusees avant la decouverte.
const json = (v) => { const o = parseJson(v, null); return o && typeof o === 'object' ? o : {}; };
const anyPositive = (o) => Object.values(o || {}).some((n) => Number(n) > 0);
export const FIND_UNLOCKS = [
  { key: 'archeo', icon: '🏺', label: 'Archéologie', url: 'jeux.html#archeologie', hide: ['#tab-archeo-btn'], paths: ['archeo'],
    had: (u) => Number(u.Tablets) > 0 || Number(u.ArcheoXP) > 0 || Number(u.ArcheoDone) > 0 || !!u.ArcheoStarter,
    text: 'Ta pioche a heurté une plaque d’argile gravée… Une tablette ancienne ! Dans les ruines, dégage-la grain de terre après grain de terre.' },
  { key: 'walk', icon: '🐾', label: 'Promenade', url: 'jeux.html#promenade', hide: ['#tab-walk-btn'], paths: ['walk'],
    had: (u, adopted) => Object.keys(adopted).length > 0 || Number(u.WalkCount) > 0,
    text: 'Ton compagnon tire sur sa laisse : il veut sortir ! Chaque jour, emmène-le se promener et rapporter ce qu’il trouve.' },
  { key: 'cook', icon: '🍲', label: 'Cuisine', url: 'jeux.html#cuisine', hide: ['#tab-cook-btn'], paths: ['cook'],
    had: (u) => anyPositive(json(u.Pantry)) || Number(u.CookCount) > 0,
    text: 'Un premier ingrédient dans ton garde-manger… et une bonne odeur qui vient du village. La cuisine t’ouvre ses fourneaux.' },
  { key: 'aquarium', icon: '🐠', label: 'Aquarium', url: 'jeux.html#peche', hide: ['#fish-aquarium-wrap'], paths: ['aquarium'],
    had: (u) => anyPositive(json(u.Aquarium).fish),
    text: 'Ce poisson-là, tu ne l’avais jamais vu ! Il rejoint ton aquarium : à toi de compléter la collection.' },
  { key: 'museum', icon: '🏛️', label: 'Musée', url: 'coffre.html', hide: ['[data-coffre-view="museum"]'], paths: [],
    had: (u) => { const m = json(u.MuseumSeen); return (m.minerals || []).length > 0 || (m.items || []).length > 0; },
    text: 'Ta première pièce rare ! Elle est exposée pour toujours dans ton musée, au coffre-fort.' }
];
const foundOf = (user) => json(user && user.StarterFound);
// Pan du site decouvert (toujours vrai pour les anciens comptes).
export function found(store, user, key) {
  if (!isNewcomer(store, user)) return true;
  return !!foundOf(user)[key];
}

// Activites de StarterUnlocks ouvertes par une trouvaille (sinon au plus tard
// a leur niveau). had(user) lit l'etat du joueur : compteurs d'activite
// (ActivityCounts), statistiques de tirage (PullStats), ressources. Chaque
// declencheur vient d'une activite deja ouverte (boosters, fouille, devinette,
// roue, quetes) ou d'une activite decouverte avant elle.
const act = (u) => json(u.ActivityCounts);
const pulls = (u) => json(u.PullStats);
const shiny = (u) => Object.entries(pulls(u).finish || {}).some(([k, n]) => k !== 'normal' && Number(n) > 0);
const total = (u) => Object.values(act(u)).reduce((s, n) => s + (Number(n) || 0), 0);
export const FEATURE_FINDS = {
  fishing: { had: (u) => Number(u.Worms) > 0 || Number(act(u).fish) > 0, text: 'Un ver de terre se tortille au bout de ta pelle… Juste ce qu’il faut pour amorcer une ligne : le lac t’attend.' },
  shop: { had: (u) => Number(act(u).disenchant) > 0 || Number(act(u).craft) > 0 || Number(u.StardustCount) >= 300, text: 'Tes poches tintent de poussières d’étoile. Une échoppe vient d’ouvrir ses volets : ressources et bonus contre tes poussières.' },
  expedition: { had: (u) => Number(act(u).boosterOpened) >= 4 || Number(act(u).expedition) > 0, text: 'Tes cartes s’agitent dans le classeur : elles veulent voir du pays ! Envoie-les explorer et rapporter un butin.' },
  garden: { had: (u) => Number(act(u).board) >= 3 || Number(act(u).harvest) > 0, text: 'Au fond de ta dernière grille, une petite graine. Il lui faut un lopin de terre… le tien.' },
  trade: { had: (u) => Number(pulls(u).cards) >= 30 || Number(act(u).cardsPulled) >= 30, text: 'Tes doublons s’empilent. D’autres joueurs les cherchent peut-être : les échanges s’ouvrent à toi.' },
  vault: { had: (u) => shiny(u), text: 'Une carte qui brille de mille feux ! Elle mérite un coffre-fort rien qu’à toi, à l’abri de tout.' },
  dinos: { had: (u) => Number(u.DinoSkulls) > 0 || Object.keys(json(u.Dinos)).length > 0, text: 'Un crâne immense, vieux de millions d’années… Avec assez d’os, qui sait ce qui pourrait revenir à la vie ?' },
  bingo: { had: (u) => Number(act(u).cardsPulled) >= 60, text: 'Ta collection prend forme. Une grille de cartes à réunir t’attend pour tout le mois.' },
  boss: { had: (u) => Number(act(u).boosterOpened) >= 15, text: 'Un grondement fait trembler le village : un boss menace la guilde, et chaque carte compte pour l’abattre.' },
  wanted: { had: (u) => Number(act(u).cardsPulled) >= 45, text: 'Des avis de recherche sont placardés au village : certaines de tes cartes sont demandées.' },
  evening: { had: (u) => total(u) >= 60, text: 'Le soleil se couche sur 2Gatcha… et de nouvelles missions apparaissent chaque soir.' },
  guildChest: { had: (u) => Number(act(u).cardsPulled) >= 90 || Number(act(u).disenchant) >= 10, text: 'Tant de doublons… Le coffre de la guilde accepte les dons, et chacun peut y piocher.' },
  teams: { had: (u) => total(u) >= 150, text: 'Deux bannières flottent sur la place du village. Choisis ton camp : la guerre des équipes commence.' },
  lottery: { had: (u) => Number(u.LotteryTickets) > 0 || total(u) >= 200, text: 'Un ticket froissé au fond de ta poche… Chaque dimanche, un tirage.' },
  duo: { had: (u) => Number(act(u).expedition) >= 3, text: 'Les expéditions, c’est encore mieux à deux. Pars à l’aventure avec un ami.' },
  blackMarket: { had: (u) => Number(act(u).chestOpened) >= 5 || Number(u.KeyCount) >= 10, text: 'Psst… Quelqu’un t’a vu ouvrir des coffres. Un marchand de l’ombre a des offres pour toi.' },
  machine: { had: (u) => Number(u.SpareParts) > 0 || Number(act(u).fusion) > 0, text: 'Un rouage oublié brille au creux de ta main. Il vient de la salle des machines, qui tourne pour toute la communauté.' },
  auctions: { had: (u) => Number(act(u).cardsPulled) >= 200 || Number((pulls(u).rarity || {}).legendaire) > 0, text: 'Une carte légendaire attire tous les regards. La salle des enchères ouvre : surenchéris !' },
  // Ateliers de la collection (avant : niveaux fixes de FEATURE_UNLOCK_LEVEL cote site).
  craft: { had: (u) => Number(act(u).disenchant) > 0 || Number(act(u).craft) > 0, text: 'Tes doublons recyclés ont laissé de la poussière d’étoile… Assez pour fabriquer la carte qui te manque !' },
  altar: { had: (u) => Number(act(u).cardsPulled) >= 25, text: 'Trois doublons de trop… Un autel ancien s’allume : sacrifie-les pour une carte plus rare.' },
  quality: { had: (u) => Number(act(u).cardsPulled) >= 35 || Number(act(u).repair) > 0, text: 'Cette carte a souffert. Avec un peu de soin et quelques doublons, elle peut retrouver son éclat.' },
  finish: { had: (u) => Number(act(u).fusion) > 0 || (shiny(u) && Number(act(u).cardsPulled) >= 40), text: 'Cinq exemplaires identiques qui se mettent à briller ensemble… Fusionne-les en une finition supérieure.' }
};

// Phrase d'accroche de la cinematique de deblocage.
const PITCH = {
  shop: 'La boutique ouvre ses portes : ressources et bonus contre tes poussières.',
  vault: 'Un coffre-fort rien qu’à toi pour mettre tes plus belles cartes à l’abri.',
  trade: 'Tu peux maintenant échanger tes cartes avec les autres joueurs.',
  dig: 'Prends ta pioche : des trésors dorment sous la terre.',
  guess: 'Cinq cartes à reconnaître chaque jour : à toi de jouer !',
  expedition: 'Envoie tes cartes explorer le monde et rapporter un butin.',
  fishing: 'Le lac t’attend : lance ta ligne et vois ce qui mord.',
  archeo: 'Des tablettes anciennes à dégager, grain de terre après grain de terre.',
  bingo: 'Une grille d’objectifs pour tout le mois.',
  dinos: 'Des os, un crâne… et un dino de compagnie qui revient à la vie !',
  garden: 'Un lopin de terre rien qu’à toi : plante, attends, récolte.',
  boss: 'Un boss menace toute la guilde : attaque-le avec les autres.',
  guildChest: 'Le coffre commun de la guilde : on donne, on partage.',
  blackMarket: 'Psst… Un marchand de l’ombre a des offres pour toi.',
  auctions: 'La salle des enchères est ouverte : surenchéris !',
  machine: 'La salle des machines tourne pour toute la communauté.',
  teams: 'Choisis ton camp : la guerre des équipes commence.',
  lottery: 'Un ticket, un tirage chaque dimanche.',
  wanted: 'Des avis de recherche : trouve les cartes demandées.',
  duo: 'Pars en expédition à deux avec un ami.',
  evening: 'Chaque soir, de nouvelles missions.'
};

export const REWARD_FIELDS = { BoosterCount: ['jeton booster', 'jetons booster'], StardustCount: ['poussière', 'poussières'], Worms: ['ver', 'vers'], KeyCount: ['clé', 'clés'], BoneCount: ['os', 'os'], XP: ['XP', 'XP'] };
const READ_ACTIONS = new Set(['status', 'list', 'get', '']);

const stateOf = (user) => { const s = parseJson(user.StarterState, null); return s && typeof s === 'object' ? { counts: s.counts || {}, claimed: s.claimed || [], done: !!s.done } : { counts: {}, claimed: [], done: false }; };

// Compte concerne par les deblocages (cree apres la mise en ligne).
export function isNewcomer(store, user) {
  if (!user || !setting(store, 'StarterEnabled')) return false;
  const since = Number(rawSetting(store, 'StarterSince')) || 0;
  return since > 0 && (Number(user.CreatedAt) || 0) >= since;
}

const adoptedOf = (user) => { const a = parseJson(user && user.PetsAdopted, null); return a && typeof a === 'object' ? a : {}; };
// Animal adopte (toujours vrai pour les anciens comptes).
export function petAdopted(store, user, pet) {
  if (!isNewcomer(store, user)) return true;
  return !!adoptedOf(user)[pet];
}

// Textes qui nomment un compagnon pas encore adopte (boutique, histoire,
// lots...) : le nom disparait. « Os pour Milo » -> « Os », « Le flair de
// Milo » -> « Le flair du chien », « Moka te fixe » -> « Le chat te fixe ».
// Nom commun et article de chaque compagnon (« la lapine » : de la, à la).
const PET_WORD = { milo: ['chien', 'le'], moka: ['chat', 'le'], noisette: ['lapine', 'la'], pistache: ['hérisson', 'le'] };
export function petMask(store, user) {
  const hide = PET_UNLOCKS.filter((p) => !petAdopted(store, user, p.key));
  if (!hide.length) return (s) => s;
  return (s) => {
    if (typeof s !== 'string' || !s) return s;
    let out = s;
    for (const p of hide) {
      const n = p.label, [w, art] = PET_WORD[p.key];
      const fem = art === 'la';
      out = out
        .replace(new RegExp(`\\s+pour ${n}( ${art} ${w})?\\b`, 'g'), '')
        .replace(new RegExp(`\\b${n},? ${art} ${w},?`, 'g'), n)
        .replace(new RegExp(`\\bde ${n}\\b`, 'g'), fem ? `de la ${w}` : `du ${w}`)
        // « à » n'est pas une lettre pour \b : on regarde le caractere d'avant.
        .replace(new RegExp(`(^|[\\s(«])à ${n}\\b`, 'g'), fem ? `$1à la ${w}` : `$1au ${w}`)
        .replace(new RegExp(`\\b${n}\\b`, 'g'), (m, at, str) => (!str.slice(0, at).trim() || /[.!?…:«]\s*$/.test(str.slice(0, at)) ? `${fem ? 'La' : 'Le'} ${w}` : `${art} ${w}`));
    }
    return out;
  };
}
// Le texte nomme-t-il un compagnon pas encore adopte ?
export function namesHiddenPet(store, user, s) {
  return PET_UNLOCKS.some((p) => !petAdopted(store, user, p.key) && new RegExp(`\\b${p.label}\\b`).test(String(s || '')));
}

// Fonctionnalites encore verrouillees pour ce joueur : [{ feature, level }].
export function lockedFor(store, user) {
  if (!isNewcomer(store, user)) return [];
  const level = levelForXp(Number(user.XP) || 0);
  const unlocks = setting(store, 'StarterUnlocks') || {};
  const foundMap = foundOf(user);
  return FEATURES.filter((f) => Number(unlocks[f.key]) > level && !foundMap[f.key]).map((f) => ({ feature: f, level: Number(unlocks[f.key]) }));
}

function view(store, user) {
  const st = stateOf(user);
  const steps = setting(store, 'StarterSteps');
  const level = levelForXp(Number(user.XP) || 0);
  const unlocks = setting(store, 'StarterUnlocks') || {};
  const newcomer = isNewcomer(store, user);
  const lockedKeys = new Set(lockedFor(store, user).map((l) => l.feature.key));
  const list = steps.map((s, i) => {
    const target = Number(s.target) || 0;
    const progress = target ? Math.min(target, Number(st.counts[s.key]) || 0) : 0;
    // Niveau requis : deblocage de la fonctionnalite (nouveaux comptes) ou niveau propre de l'etape (craft...).
    // Fonctionnalite deja decouverte : son niveau « au plus tard » ne compte plus.
    const featLevel = newcomer && s.feature && lockedKeys.has(s.feature) ? Number(unlocks[s.feature]) || 0 : 0;
    const req = Math.max(featLevel, Number(s.level) || 0);
    const needLevel = req > level ? req : 0;
    // Etape vers une fonctionnalite pas encore debloquee : rien n'est devoile.
    const secret = !!s.feature && lockedKeys.has(s.feature);
    return { key: s.key, label: secret ? 'Étape mystère' : s.label, icon: secret ? '❔' : s.icon || '⭐', url: secret ? null : s.url || null, hint: secret ? 'Elle se révélera en montant de niveau.' : s.hint || '', secret, target, progress, complete: progress >= target, claimed: st.claimed.includes(s.key), current: false, needLevel, reward: s.reward || {} };
  });
  const cur = list.find((s) => !s.claimed);
  if (cur) cur.current = true;
  const finished = st.done || !list.length || list.every((s) => s.claimed);
  const future = newcomer ? FEATURES.filter((f) => lockedKeys.has(f.key)).map((f) => Number(unlocks[f.key])) : [];
  const adopted = adoptedOf(user);
  return {
    enabled: !!setting(store, 'StarterEnabled'), active: !!setting(store, 'StarterEnabled') && newcomer && !st.done,
    // Compte soumis aux decouvertes : le site s'en remet a ces verrous (core.js featureNeed).
    newcomer,
    steps: list, claimedCount: list.filter((s) => s.claimed).length, total: list.length, finished, done: st.done,
    finalReward: setting(store, 'StarterFinalReward'), level,
    // Seulement ce qui est deja ouvert (les surprises restent secretes) et le prochain palier.
    unlocks: newcomer ? FEATURES.filter((f) => Number(unlocks[f.key]) > 1 && !lockedKeys.has(f.key)).map((f) => ({ key: f.key, label: f.label.replace(/\s*\(.*\)$/, ''), icon: f.icon, level: Number(unlocks[f.key]) })).sort((a, b) => a.level - b.level) : [],
    nextUnlockLevel: future.length ? Math.min(...future) : null,
    pets: Object.fromEntries(PET_UNLOCKS.map((p) => [p.key, !newcomer || !!adopted[p.key]])),
    found: Object.fromEntries(FIND_UNLOCKS.map((f) => [f.key, !newcomer || !!foundOf(user)[f.key]])),
    locks: [
      ...lockedFor(store, user).map(({ feature: f, level: l }) => ({ key: f.key, level: l, page: f.page || null, hide: f.hide })),
      ...(newcomer ? PET_UNLOCKS.filter((p) => !adopted[p.key]).map((p) => ({ key: p.key, pet: true, level: null, page: null, hide: p.hide })) : []),
      ...(newcomer ? FIND_UNLOCKS.filter((f) => !foundOf(user)[f.key]).map((f) => ({ key: f.key, find: true, level: null, page: null, hide: f.hide })) : [])
    ]
  };
}

// Cinematique de deblocage : ce qui s'est ouvert depuis la derniere requete
// (niveau de compte atteint, animal adopte). Premier appel : on note ce qui est
// deja ouvert sans rien rejouer (sauf les adoptions de cet appel).
export function checkUnlocks(store, userId) {
  let user = userId && store.tables.has('Users') ? store.get('Users', Number(userId)) : null;
  if (!user || !isNewcomer(store, user)) return null;
  const adopted = adoptedOf(user);
  const t = now();
  const fresh = PET_UNLOCKS.filter((p) => !adopted[p.key] && p.had(user));
  fresh.forEach((p) => { adopted[p.key] = t; });
  // Decouvertes (apres les adoptions : un premier compagnon ouvre la promenade).
  const foundMap = foundOf(user);
  const finds = FIND_UNLOCKS.filter((f) => !foundMap[f.key] && f.had(user, adopted));
  finds.forEach((f) => { foundMap[f.key] = t; });
  const level = levelForXp(Number(user.XP) || 0);
  const unlocks = setting(store, 'StarterUnlocks') || {};
  // Activites trouvees avant leur niveau « au plus tard » (FEATURE_FINDS).
  const featFinds = FEATURES.filter((f) => FEATURE_FINDS[f.key] && Number(unlocks[f.key]) > level && !foundMap[f.key] && FEATURE_FINDS[f.key].had(user));
  featFinds.forEach((f) => { foundMap[f.key] = t; });
  const viaFind = new Set(featFinds.map((f) => f.key));
  const open = FEATURES.filter((f) => Number(unlocks[f.key]) > 1 && (Number(unlocks[f.key]) <= level || foundMap[f.key]));
  const seenRaw = parseJson(user.StarterSeen, null);
  const seen = Array.isArray(seenRaw) ? seenRaw : open.map((f) => f.key);
  const newFeatures = open.filter((f) => !seen.includes(f.key));
  if (!fresh.length && !finds.length && !featFinds.length && !newFeatures.length && Array.isArray(seenRaw)) return null;
  user = store.update('Users', user.id, {
    ...(fresh.length ? { PetsAdopted: JSON.stringify(adopted) } : {}),
    ...(finds.length || featFinds.length ? { StarterFound: JSON.stringify(foundMap) } : {}),
    StarterSeen: JSON.stringify([...seen, ...newFeatures.map((f) => f.key)])
  });
  const items = [
    ...newFeatures.map((f) => (viaFind.has(f.key)
      ? { key: 'unlock-' + f.key, unlock: true, kicker: 'Nouvelle découverte !', icon: f.icon, name: f.label.replace(/\s*\(.*\)$/, ''), riddle: FEATURE_FINDS[f.key].text, url: (f.urls || [])[0] || f.page || null, color: '#38bdf8' }
      : { key: 'unlock-' + f.key, unlock: true, kicker: 'Nouveau : débloqué !', icon: f.icon, name: f.label.replace(/\s*\(.*\)$/, ''), riddle: PITCH[f.key] || 'Une nouvelle activité s’ouvre à toi.', url: (f.urls || [])[0] || f.page || null, color: '#facc15' })),
    ...fresh.map((p) => ({ key: 'adopt-' + p.key, unlock: true, kicker: 'Nouveau compagnon !', icon: p.icon, name: p.label, riddle: p.text, url: p.url, color: '#f472b6' })),
    ...finds.map((f) => ({ key: 'find-' + f.key, unlock: true, kicker: 'Nouvelle découverte !', icon: f.icon, name: f.label, riddle: f.text, url: f.url, color: '#38bdf8' }))
  ];
  return items.length ? items : null;
}

// Recompense : champs connus + 1 jeton par niveau de compte gagne (comme les workflows).
function grant(store, user, reward) {
  const fields = {};
  for (const [k, v] of Object.entries(reward || {})) if (REWARD_FIELDS[k] && Number(v) > 0) fields[k] = (Number(user[k]) || 0) + Math.floor(Number(v));
  if (fields.XP) {
    const gained = levelForXp(fields.XP) - levelForXp(Number(user.XP) || 0);
    if (gained > 0) fields.BoosterCount = (fields.BoosterCount != null ? fields.BoosterCount : Number(user.BoosterCount) || 0) + gained;
  }
  return fields;
}

function handle({ store, body, query }) {
  const input = { ...(query || {}), ...(body || {}) };
  let user = userById(store, input.userId);
  if (!user) return fail('unknown_user', 404);
  const action = input.action || 'status';
  if (action === 'status') return ok(view(store, user));
  if (action !== 'claim') return fail('unknown_action');
  if (!setting(store, 'StarterEnabled')) return fail('starter_disabled');
  const st = stateOf(user);
  const steps = setting(store, 'StarterSteps');
  if (st.done) return fail('already_done', 400, view(store, user));
  // Bonus final.
  if (input.key === 'final') {
    if (!steps.every((s) => st.claimed.includes(s.key))) return fail('not_finished', 400, view(store, user));
    const fields = grant(store, user, setting(store, 'StarterFinalReward'));
    user = store.update('Users', user.id, { ...fields, StarterState: JSON.stringify({ ...st, done: true, doneAt: now() }) });
    return ok({ ...view(store, user), claimed: 'final', reward: setting(store, 'StarterFinalReward'), newStardust: user.StardustCount, newBoosterCount: user.BoosterCount });
  }
  const i = steps.findIndex((s) => !st.claimed.includes(s.key));
  const step = steps[i];
  if (!step || step.key !== input.key) return fail('not_current_step', 400, view(store, user));
  const target = Number(step.target) || 0;
  if (target && (Number(st.counts[step.key]) || 0) < target) return fail('step_not_complete', 400, view(store, user));
  const fields = grant(store, user, step.reward);
  user = store.update('Users', user.id, { ...fields, StarterState: JSON.stringify({ ...st, claimed: [...st.claimed, step.key] }) });
  return ok({ ...view(store, user), claimed: step.key, reward: step.reward || {}, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount });
}

// Progression des etapes a partir des evenements d'activite (activity.js).
export function onEvents(store, events) {
  if (!setting(store, 'StarterEnabled')) return [];
  const steps = setting(store, 'StarterSteps');
  const notices = [];
  const byUser = new Map();
  for (const e of events) { if (!byUser.has(e.userId)) byUser.set(e.userId, []); byUser.get(e.userId).push(e); }
  for (const [userId, evs] of byUser) {
    const user = store.get('Users', Number(userId));
    if (!user) continue;
    const st = stateOf(user);
    if (st.done) continue;
    let changed = false;
    for (const s of steps) {
      const target = Number(s.target) || 0;
      if (!target || st.claimed.includes(s.key)) continue;
      const types = Array.isArray(s.type) ? s.type : [s.type];
      const before = Number(st.counts[s.key]) || 0;
      if (before >= target) continue;
      const n = evs.filter((e) => types.includes(e.type)).reduce((sum, e) => sum + (Number(e.n) || 1), 0);
      if (!n) continue;
      st.counts[s.key] = Math.min(target, before + n);
      changed = true;
      if (st.counts[s.key] >= target) notices.push({ userId: user.id, kind: 'starter', icon: s.icon || '⭐', label: `Parcours du débutant : « ${s.label} » réussi, viens récupérer ta récompense !` });
    }
    if (changed) store.update('Users', user.id, { StarterState: JSON.stringify(st) });
  }
  return notices;
}

// Ecriture vers une fonctionnalite pas encore debloquee : refus.
export function gate(store, method, path, body = {}) {
  if (method === 'GET' || READ_ACTIONS.has(String(body.action || '')) || body.discordId) return null;
  const uid = Number(body.userId || body.fromUserId) || 0;
  if (!uid) return null;
  const user = store.get('Users', uid);
  // Compagnon pas encore adopte : ni gestes, ni travail.
  const act = String(body.action || '');
  const pet = path === 'pets' || path === 'walk' ? String(body.pet || '') : path === 'cat' ? 'moka' : path === 'dog-gift' ? 'milo' : path === 'dig' && ['useBone', 'frenzy'].includes(act) ? 'milo'
    : path === 'garden' && act === 'bunnyFeed' ? 'noisette' : path === 'archeo' && act === 'moleFeed' ? 'pistache' : '';
  if (pet && PET_UNLOCKS.some((p) => p.key === pet) && !petAdopted(store, user, pet)) return fail('pet_not_adopted', 403, { pet, message: 'Tu n’as pas encore de compagnon ici.' });
  const hidden = FIND_UNLOCKS.find((f) => f.paths.includes(path) && !found(store, user, f.key));
  if (hidden) return fail('not_discovered', 403, { find: hidden.key, message: 'Pas encore découvert.' });
  const lock = lockedFor(store, user).find((l) => l.feature.paths.includes(path));
  if (!lock) return null;
  const label = lock.feature.label.replace(/\s*\(.*\)$/, '');
  return fail('level_locked', 403, { feature: lock.feature.key, label, level: lock.level, message: `${label} se débloque au niveau ${lock.level}.` });
}
export function beforeWorkflow({ store, path, request }) { return gate(store, 'POST', path, request.body || {}); }

// Date de mise en ligne : les comptes plus anciens ne sont jamais verrouilles.
export function init({ store }) {
  try { if (!(Number(rawSetting(store, 'StarterSince')) > 0)) setSettings(store, { StarterSince: now() }); } catch (e) { console.error(e); captureError(e, { hook: 'starter-since' }); }
}

export const routes = { 'GET starter': handle, 'POST starter': handle };
