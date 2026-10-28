// Reglages du jeu modifiables depuis l'admin (site/admin.html, "Reglages
// avances").
//
// Un registre unique decrit chaque reglage : libelle, groupe, type, defaut,
// bornes et aide. Deux stockages :
//   - 'app'    : table AppSettings (cle -> valeur JSON). "Jamais regle" et
//                "regle a 0" se distinguent : pour les fonctionnalites natives.
//   - 'config' : colonne de la ligne Config, pour les reglages LUS PAR LES
//                WORKFLOWS (vide ou 0 = defaut, convention des workflows).
//   GET/POST /webhook/admin-settings  { discordId, action: 'get' | 'set' | 'reset', values?, key? }

import { ok, fail, isAdmin, configRow } from './common.js';

const pct = (label, def, group, help) => ({ label, type: 'number', def, min: 0, max: 1, step: 0.001, group, help, unit: 'probabilité (0 à 1)' });
const int = (label, def, group, help, min = 0, max = 100000) => ({ label, type: 'number', def, min, max, step: 1, group, help });
const num = (label, def, group, help, min = 0, max = 100) => ({ label, type: 'number', def, min, max, step: 0.05, group, help });

export const REGISTRY = {
  // --- Securite
  RateLimitWritesPerMinute: { ...int('Actions par minute et par joueur', 60, 'Sécurité', "Au-delà, l'API répond « trop de requêtes » jusqu'à la minute suivante.", 5, 1000), storage: 'app' },
  RateLimitReadsPerMinute: { ...int('Lectures par minute et par joueur', 400, 'Sécurité', 'Consultations (statuts, listes).', 20, 10000), storage: 'app' },
  AuthTokenDays: { ...int('Durée de connexion (jours)', 60, 'Sécurité', 'Après ce délai, le joueur doit se reconnecter avec Discord.', 1, 365), storage: 'app' },

  // --- Boosters (lus par le workflow open-pack)
  SpecialFinishChance: { ...pct('Chance de finition spéciale', 0.10, 'Boosters', 'Holo, doré, ghost… par carte tirée.'), storage: 'config' },
  ShinyPackChance: { ...pct('Chance de booster shiny', 0.001, 'Boosters', 'Booster aux cartes meilleures que d’habitude.'), storage: 'config' },
  BonusCardChance: { ...pct('Chance de carte bonus', 0.10, 'Boosters', 'Une 6e carte dans le booster.'), storage: 'config' },
  XpPerBoosterOpen: { ...int('XP par booster ouvert', 10, 'Boosters', ''), storage: 'config' },
  DuplicateDustCommon: { ...int('Poussières par doublon commun', 3, 'Boosters', 'Gagnées automatiquement à l’ouverture.'), storage: 'app' },
  DuplicateDustOther: { ...int('Poussières par doublon (rare et plus)', 6, 'Boosters', ''), storage: 'app' },

  // --- Coffres
  ChestCost: { ...int('Prix d’un coffre (poussières)', 100, 'Coffres', '', 1), storage: 'app' },
  ChestEveryLevels: { ...int('Un coffre offert tous les N niveaux', 5, 'Coffres', '0 = jamais.'), storage: 'app' },
  KeyEveryLevels: { ...int('Une clé offerte tous les N niveaux', 10, 'Coffres', '0 = jamais.'), storage: 'app' },
  ChestDustMin: { ...int('Poussières minimum', 50, 'Coffres', ''), storage: 'app' },
  ChestDustMax: { ...int('Poussières maximum', 150, 'Coffres', ''), storage: 'app' },
  ChestCardChance: { ...pct('Chance d’une carte', 0.7, 'Coffres', ''), storage: 'app' },
  ChestSecondCardChance: { ...pct('Chance d’une 2e carte', 0.2, 'Coffres', ''), storage: 'app' },
  ChestBoosterChance: { ...pct('Chance d’un jeton booster', 0.6, 'Coffres', ''), storage: 'app' },
  ChestDoubleBoosterChance: { ...pct('Chance de 2 jetons booster', 0.15, 'Coffres', ''), storage: 'app' },
  ChestTierWeights: { label: 'Gatchapon : poids des 8 coffres', type: 'json', group: 'Coffres', storage: 'app', help: 'Liste de 8 poids, du coffre en bois (1) au coffre mystique (8) : chance de tomber sur chaque boule.', def: [40, 25, 15, 9, 6, 3, 1.5, 0.5] },
  ChestTierMults: { label: 'Gatchapon : multiplicateur de butin des 8 coffres', type: 'json', group: 'Coffres', storage: 'app', help: 'Liste de 8 multiplicateurs (poussières, chances de jetons et de cartes, finitions ; les gros paliers penchent aussi vers les raretés hautes). Divisés par la moyenne pondérée : l’économie moyenne ne change pas.', def: [0.7, 0.9, 1.1, 1.4, 1.8, 2.5, 3.5, 5] },
  GardenSeeds: {
    label: 'Jardin : les graines', type: 'json', group: 'Jardin', storage: 'app',
    help: 'Une ligne par graine (key : ne pas changer). label : nom ; cost : prix (× prix d’une plantation) ; grow : temps de pousse (× temps de base) ; level : niveau de jardinage requis ; active : false pour la retirer (le Mélange reste toujours). Ce que donne chaque graine reste celui du jeu.',
    def: [
      { key: 'mix', label: 'Mélange', cost: 1, grow: 1, level: 1, active: true }, { key: 'worm', label: 'Terreau à vers', cost: 1, grow: 1, level: 1, active: true },
      { key: 'bait', label: 'Fleur dorée', cost: 3, grow: 1.5, level: 1, active: true }, { key: 'dust', label: 'Étoile filante', cost: 4, grow: 2, level: 1, active: true },
      { key: 'catnip', label: 'Herbe à chat', cost: 2, grow: 1.2, level: 2, active: true }, { key: 'bone', label: 'Arbre à os', cost: 3, grow: 1.5, level: 4, active: true },
      { key: 'mushroom', label: 'Champignon lumineux', cost: 4, grow: 2, level: 6, active: true }
    ]
  },
  ChestExtraLoot: {
    label: 'Gatchapon : bonus des coffres', type: 'json', group: 'Coffres', storage: 'app',
    help: 'En plus des poussières, boosters et cartes : chaque coffre tente chaque ligne. key : ressource (worms, bait, bone, catFish, part, luck, key, chest, skull, fertilizer, goldFertilizer, tabletClay, tabletStone, tabletGold, shards, uniqueTicket, xpBoost…) ; chance : 0 à 1 ; min / max : quantité. Les gros paliers du gatchapon multiplient la chance (et un peu la quantité) comme le reste du butin.',
    def: [
      { key: 'worms', chance: 0.45, min: 3, max: 8 }, { key: 'catFish', chance: 0.25, min: 1, max: 3 }, { key: 'bone', chance: 0.25, min: 1, max: 2 },
      { key: 'bait', chance: 0.18, min: 1, max: 2 }, { key: 'part', chance: 0.15, min: 1, max: 1 }, { key: 'fertilizer', chance: 0.12, min: 1, max: 2 },
      { key: 'luck', chance: 0.08, min: 1, max: 2 }, { key: 'key', chance: 0.07, min: 1, max: 1 }, { key: 'tabletClay', chance: 0.06, min: 1, max: 1 },
      { key: 'skull', chance: 0.03, min: 1, max: 1 }, { key: 'tabletStone', chance: 0.02, min: 1, max: 1 }
    ]
  },
  ChestSpecialFinishChance: { ...pct('Chance de finition spéciale (cartes du coffre)', 0.15, 'Coffres', ''), storage: 'app' },

  // --- Peche
  FishingCost: { ...int('Vers de terre par lancer', 1, 'Pêche', 'Les vers se trouvent dans la terre restante à la fin d’une fouille.', 1), storage: 'app' },
  WormsPerBoard: { ...int('Vers par grille de fouille terminée', 2, 'Pêche', 'Gagnés quand tous les trésors d’une grille sont trouvés (joueur ou Milo).'), storage: 'app' },
  WormsPerLeftoverTile: { ...int('Vers par case de terre restante', 2, 'Pêche', 'En plus, pour chaque case jamais creusée à la fin de la grille.'), storage: 'app' },
  StarterWorms: { ...int('Vers offerts au lancement', 5, 'Pêche', 'Donnés une seule fois à chaque joueur existant, pour pouvoir pêcher tout de suite.'), storage: 'app' },
  FishingMaxEnergy: { ...int('Pêche : énergie max', 12, 'Pêche', '1 énergie par lancer. +1 par niveau de pêche au-dessus du 1, plus le talent Pêcheur assidu et l’arbre céleste.', 1, 200), storage: 'app' },
  CatMinutesPerFish: { ...int('Moka le chat : minutes de pêche par poisson donné', 30, 'Pêche', 'Moka pêche à ta place sans ver ni énergie.', 5, 600), storage: 'app' },
  ArcheoEnabled: { label: 'Archéologie (tablettes anciennes)', type: 'bool', def: true, group: 'Fouille', storage: 'app', help: 'Jeu de la page Jeux : des tablettes trouvées en fouille, à dégager au pinceau.' },
  ArcheoTablets: {
    label: 'Archéologie : les 3 sortes de tablettes', type: 'json', group: 'Fouille', storage: 'app',
    help: 'Une ligne par sorte (key : clay, stone, gold ; ne pas changer). itemsMin / itemsMax : trouvailles par tablette ; tierBonus : paliers en plus de la profondeur ; depthMin / depthMax : épaisseur de terre ; hard : part de roche dure (0 à 0,6) ; fragile : chance qu’une pièce soit fragile ; relic : multiplicateur de la chance de relique ; energy : multiplicateur d’endurance ; perfect : multiplicateur du bonus de tablette parfaite ; xp : multiplicateur d’XP ; weight + weightPerDepth : fréquence quand on trouve une tablette (plus profond = plus de belles tablettes).',
    def: [
      { key: 'clay', label: 'Tablette d’argile', icon: '🟫', rarity: 'commune', hint: '3 ou 4 trouvailles, terre tendre', itemsMin: 3, itemsMax: 4, tierBonus: 0, depthMin: 0.8, depthMax: 2.2, hard: 0, fragile: 0.05, relic: 1, energy: 1, perfect: 1, xp: 1, weight: 75, weightPerDepth: 0 },
      { key: 'stone', label: 'Pierre gravée', icon: '🪨', rarity: 'rare', hint: '4 ou 5 trouvailles, meilleurs paliers, veines de roche dure', itemsMin: 4, itemsMax: 5, tierBonus: 1, depthMin: 1, depthMax: 2.6, hard: 0.35, fragile: 0.15, relic: 2, energy: 1.25, perfect: 2, xp: 1.5, weight: 20, weightPerDepth: 4 },
      { key: 'gold', label: 'Tablette dorée', icon: '🟨', rarity: 'legendaire', hint: '5 ou 6 trouvailles, reliques fréquentes, pièces fragiles', itemsMin: 5, itemsMax: 6, tierBonus: 2, depthMin: 1.2, depthMax: 2.8, hard: 0.38, fragile: 0.35, relic: 4, energy: 1.5, perfect: 3, xp: 2, weight: 5, weightPerDepth: 1.5 }
    ]
  },
  ArcheoStrokes: { ...int('Archéologie : endurance du geste par tablette', 450, 'Fouille', 'Grattage libre : chaque point du geste (environ une demi-case de déplacement) coûte 1 au pinceau et au grattoir, 3 à la pioche.', 50, 5000), storage: 'app' },
  ArcheoTabletChance: { ...pct('Archéologie : chance d’une tablette par grille de fouille terminée', 0.4, 'Fouille', 'Moitié moins par grille terminée par Milo, 8 fois moins par trésor dégagé.'), storage: 'app' },
  ArcheoMaxTablets: { ...int('Archéologie : tablettes en réserve au maximum', 20, 'Fouille', '', 1, 500), storage: 'app' },
  ArcheoRelicChance: { ...pct('Archéologie : chance qu’une trouvaille soit une relique', 0.05, 'Fouille', 'Relique = 1 jeton booster ou 1 clé (poussières si elle est fissurée).'), storage: 'app' },
  ArcheoShardDust: { ...int('Archéologie : poussières d’un tesson (par palier)', 25, 'Fouille', 'Moitié si le tesson est fissuré.', 0, 10000), storage: 'app' },
  ArcheoPerfectDust: { ...int('Archéologie : bonus d’une tablette déchiffrée', 80, 'Fouille', 'Toutes les trouvailles dégagées sans aucune fissure.', 0, 100000), storage: 'app' },
  ArcheoStarterTablets: { ...int('Archéologie : tablettes offertes pour découvrir le jeu', 2, 'Fouille', 'Une seule fois par joueur.', 0, 20), storage: 'app' },
  PetLoveEnabled: { label: 'Tendresse pour Milo et Moka', type: 'bool', def: true, group: 'Animaux', storage: 'app', help: 'Jauge d’affection (caresse, jeu, friandise) qui rend Milo et Moka plus rapides et plus généreux.' },
  PetLoveDecayPerHour: { ...num('Tendresse : points d’affection perdus par heure', 2, 'Animaux', '2 = une jauge pleine se vide en un peu plus de 2 jours sans attention.', 0, 50), storage: 'app' },
  PetCuddleLove: { ...int('Tendresse : affection d’une caresse', 8, 'Animaux', '', 0, 100), storage: 'app' },
  PetCuddleMinutes: { ...int('Tendresse : minutes entre deux caresses', 60, 'Animaux', '', 1, 1440), storage: 'app' },
  PetPlayLove: { ...int('Tendresse : affection d’une partie de jeu', 20, 'Animaux', '', 0, 100), storage: 'app' },
  PetPlayHours: { ...int('Tendresse : heures entre deux parties de jeu', 4, 'Animaux', '', 1, 48), storage: 'app' },
  PetTreatLove: { ...int('Tendresse : affection d’une friandise', 15, 'Animaux', '', 0, 100), storage: 'app' },
  PetTreatPrice: { ...int('Tendresse : prix d’une friandise (poussières)', 60, 'Animaux', '', 0, 100000), storage: 'app' },
  PetTreatsPerDay: { ...int('Tendresse : friandises par jour et par animal', 3, 'Animaux', '', 0, 50), storage: 'app' },
  PetWorkMinutes: { ...int('Fatigue : minutes de travail de Milo et Moka avant une pause', 45, 'Animaux', 'Ils travaillent par cycles : travail puis petite pause.', 5, 600), storage: 'app' },
  PetRestMinutes: { ...int('Fatigue : minutes de pause', 15, 'Animaux', 'Jusqu’à 50 % plus courte quand ils t’adorent. 0 = jamais de pause.', 0, 600), storage: 'app' },
  PetMaxSpeedPct: { ...int('Tendresse : temps gagné à 100 d’affection (%)', 30, 'Animaux', 'Milo creuse et Moka lance plus souvent : jusqu’à ce pourcentage de temps en moins entre deux actions.', 0, 80), storage: 'app' },
  PetMaxLootPct: { ...int('Tendresse : poussières en plus à 100 d’affection (%)', 40, 'Animaux', 'Sur les poussières rapportées par Milo et Moka.', 0, 300), storage: 'app' },
  PetGiftChance: { ...pct('Tendresse : chance d’un petit cadeau (80 d’affection et plus)', 0.15, 'Animaux', 'Par retour de Milo (rapport du chien) et par passage de Moka : os, vers, clé / poisson, appât doré, pièce détachée.'), storage: 'app' },
  // --- Noisette (jardin) et Pistache (archeologie), 2026-10-30
  BunnyMinutesPerCarrot: { ...int('Noisette la lapine : minutes de travail par carotte', 180, 'Animaux', 'Elle récolte les parcelles prêtes du jardin et replante la même graine (payée en poussières).', 10, 1440), storage: 'app' },
  BunnyMaxMinutes: { ...int('Noisette la lapine : minutes de travail au maximum devant elle', 1440, 'Animaux', '', 30, 4320), storage: 'app' },
  MoleMinutesPerGrub: { ...int('Pistache le hérisson : minutes de travail par ver blanc', 60, 'Animaux', '', 5, 1440), storage: 'app' },
  MoleMaxMinutes: { ...int('Pistache le hérisson : minutes de travail au maximum devant lui', 480, 'Animaux', '', 10, 2880), storage: 'app' },
  MoleJobMinutes: { ...int('Pistache le hérisson : minutes par tâche', 40, 'Animaux', 'Une tâche = nettoyer un bloc brut de l’atelier, sinon gratter une tablette de ta réserve. La tendresse rend les tâches plus courtes.', 5, 600), storage: 'app' },
  MoleExtractChance: { ...pct('Pistache le hérisson : chance d’extraire chaque trouvaille d’une tablette', 0.6, 'Animaux', 'Ce qu’il rate reste dans la terre (perdu). La tendresse ajoute jusqu’à 25 points.'), storage: 'app' },
  CarrotDigChance: { ...pct('Carottes sauvages : chance par trésor dégagé à la fouille', 0.06, 'Animaux', 'Une grille terminée en donne une à coup sûr. Aussi en promenade (prairie) et à la boutique.'), storage: 'app' },
  GrubGardenChance: { ...pct('Vers blancs : chance par parcelle récoltée', 0.25, 'Animaux', 'Doublée avec le terreau à vers. Aussi en promenade (ruines) et à la boutique.'), storage: 'app' },
  WalkEnabled: { label: 'Promenade des compagnons', type: 'bool', def: true, group: 'Animaux', storage: 'app', help: 'Une balade par jour et par compagnon adopté, dans un lieu au choix : une trouvaille selon le lieu et de l’affection.' },
  WalkLove: { ...int('Promenade : affection gagnée', 12, 'Animaux', '×1,5 dans son lieu préféré.', 0, 100), storage: 'app' },
  WalkFavMult: { ...num('Promenade : trouvailles dans le lieu préféré (×)', 2, 'Animaux', '', 1, 5), storage: 'app' },
  WalkNightStart: { ...int('Promenade : la clairière aux lucioles ouvre à (heure)', 21, 'Animaux', 'Heure de Paris. Elle ne se visite que la nuit.', 0, 23), storage: 'app' },
  WalkNightEnd: { ...int('Promenade : la clairière aux lucioles ferme à (heure)', 6, 'Animaux', '', 0, 23), storage: 'app' },
  CookEnabled: { label: 'Cuisine du village', type: 'bool', def: true, group: 'Cuisine', storage: 'app', help: 'Des plats à base d’ingrédients (jardin, promenade, pêche) qui donnent un bonus temporaire.' },
  CookGardenPct: { ...int('Cuisine : pousse du jardin plus rapide (%)', 25, 'Cuisine', 'Effet « garden ».', 0, 80), storage: 'app' },
  CookFishPct: { ...int('Cuisine : prises rares de la pêche en plus (%)', 30, 'Cuisine', 'Effet « fish » (Moka compris).', 0, 300), storage: 'app' },
  CookArcheoPct: { ...int('Cuisine : endurance d’archéologie en plus (%)', 25, 'Cuisine', 'Effet « archeo », sur les tablettes ouvertes pendant le bonus.', 0, 300), storage: 'app' },
  CookMaxHours: { ...int('Cuisine : heures de bonus au maximum devant soi', 12, 'Cuisine', 'Recuisiner un plat prolonge son bonus, jusqu’à ce plafond.', 1, 72), storage: 'app' },
  CookRecipes: {
    label: 'Cuisine : les recettes', type: 'json', group: 'Cuisine', storage: 'app',
    help: 'Liste : key (unique), label, icon, desc, effect (garden, fish, archeo, pets ou all), hours (durée du bonus), needs { veg, herb, berry, mush, honey, fish, carrot : quantité }, active (false = retirée).',
    def: [
      { key: 'soupe', label: 'Soupe du potager', icon: '🍲', desc: 'Une grande marmite qui sent bon le jardin.', effect: 'garden', hours: 4, needs: { veg: 3, herb: 1 } },
      { key: 'grillade', label: 'Poisson grillé aux herbes', icon: '🐟', desc: 'Grillé au feu de bois, sur le ponton.', effect: 'fish', hours: 3, needs: { fish: 2, herb: 1 } },
      { key: 'ragout', label: 'Ragoût du fouilleur', icon: '🥘', desc: 'De quoi tenir toute une journée sous la terre.', effect: 'archeo', hours: 4, needs: { veg: 2, mush: 2, carrot: 1 } },
      { key: 'tarte', label: 'Tarte aux baies', icon: '🥧', desc: 'Tes compagnons en raffolent.', effect: 'pets', hours: 6, needs: { berry: 3, honey: 1 } },
      { key: 'festin', label: 'Festin du village', icon: '🎉', desc: 'Un peu de tout, pour tout le monde.', effect: 'all', hours: 3, needs: { veg: 2, herb: 1, berry: 2, mush: 1, honey: 1, fish: 1 } }
    ]
  },
  CatCastMinutes: { ...int('Moka le chat : minutes entre deux lancers', 10, 'Pêche', 'Table du rivage avec tes bonus, jamais de booster (remplacé par des poussières).', 1, 120), storage: 'app' },
  CatMaxMinutes: { ...int('Moka le chat : minutes de pêche au maximum devant lui', 240, 'Pêche', '', 10, 1440), storage: 'app' },
  CatDailyFish: { ...int('Moka le chat : poissons par jour (plus utilisé)', 8, 'Pêche', 'Ignoré depuis le 26/10/2026 : la fatigue (Animaux) remplace la limite par jour.', 0, 100), storage: 'app' },
  FishingRegenSeconds: { ...int('Pêche : secondes pour regagner 1 énergie', 600, 'Pêche', 'Réduit de 5 % par niveau de pêche.', 30, 86400), storage: 'app' },
  FishingTourneyPrizes: { label: 'Tournoi de pêche : poussières des premiers', type: 'json', group: 'Pêche', storage: 'app', help: 'Liste : poussières du 1er, du 2e, du 3e… Le 1er reçoit aussi le titre « Roi de la pêche ».', def: [500, 300, 150] },
  GardenGrowHours: { ...int('Jardin : heures de pousse', 4, 'Pêche', '', 1, 48), storage: 'app' },
  GardenPlantCost: { ...int('Jardin : prix d’une plantation (poussières)', 10, 'Pêche', ''), storage: 'app' },
  GardenBaitChance: { ...pct('Jardin : chance d’un appât doré par récolte', 0.5, 'Pêche', 'Un appât doré supprime les prises vides et multiplie les prises rares pour un lancer.'), storage: 'app' },
  FishingLevelXpStep: { ...int('XP pour le niveau 2 de pêche', 15, 'Pêche', 'Chaque niveau suivant demande ce palier en plus (15, 45, 90…). 1 XP par lancer, plus selon la prise.', 1), storage: 'app' },
  FishingZones: { label: 'Pêche : les 5 lieux', type: 'json', group: 'Pêche', storage: 'app', help: 'Liste de lieux : key, label, icon, level (niveau requis), prestige (prestige requis, facultatif), cost (× vers par lancer), rare (× prises rares), empty (× prises vides), pool (shore = table FishingLoot et espèces du rivage, deep = DeepFishingLoot et espèces des profondeurs). Les eaux profondes (key deep) gardent DeepFishingLevel et DeepFishingCostMult.', def: [
    { key: 'shore', label: 'Rivage', icon: '🏖️', level: 1, cost: 1, rare: 1, empty: 1, pool: 'shore' },
    { key: 'pond', label: 'Étang', icon: '🪷', level: 3, cost: 1, rare: 1.25, empty: 0.9, pool: 'shore' },
    { key: 'river', label: 'Rivière', icon: '🏞️', level: 6, cost: 2, rare: 1.5, empty: 0.8, pool: 'shore' },
    { key: 'deep', label: 'Eaux profondes', icon: '🌊', level: 10, cost: 2, rare: 1, empty: 1, pool: 'deep' },
    { key: 'abyss', label: 'Abysses', icon: '🦑', level: 1, prestige: 1, cost: 3, rare: 1.6, empty: 0.7, pool: 'deep' }
  ] },
  DeepFishingLevel: { ...int('Eaux profondes : niveau de pêche requis', 10, 'Pêche', 'Un prestige de pêche les débloque aussi.', 1, 10), storage: 'app' },
  DeepFishingCostMult: { ...int('Eaux profondes : vers par lancer (× le coût normal)', 2, 'Pêche', '', 1, 10), storage: 'app' },
  DeepFishingLoot: {
    label: 'Table des prises (eaux profondes)', type: 'json', group: 'Pêche', storage: 'app',
    help: 'Comme la table normale, avec deux prises en plus : pearl (perle noire = poussières) et bait (appât doré).',
    def: [
      { type: 'nothing', weight: 14, label: 'Une ancre rouillée' },
      { type: 'dust', weight: 24, min: 30, max: 70 },
      { type: 'pearl', weight: 6, min: 80, max: 180, label: 'Perle noire' },
      { type: 'bait', weight: 12, min: 1, max: 1, label: 'Appât doré' },
      { type: 'bone', weight: 6, min: 1, max: 2 },
      { type: 'booster', weight: 12, min: 1, max: 1 },
      { type: 'chest', weight: 9, min: 1, max: 1 },
      { type: 'key', weight: 7, min: 1, max: 1 },
      { type: 'part', weight: 7, min: 1, max: 1, label: 'Pièce détachée' }
    ]
  },
  GardenPlotPrice: { ...int('Jardin : prix d’une parcelle en plus (poussières)', 400, 'Pêche', 'La n-ième parcelle achetée coûte n × ce prix (indexé sur la richesse moyenne).', 1), storage: 'app' },
  GardenMaxPlots: { ...int('Jardin : parcelles au maximum', 28, 'Pêche', '4 offertes, les autres à acheter. Jusqu’à 4 lignes de 7.', 4, 28), storage: 'app' },
  FishingLoot: {
    label: 'Table des prises', type: 'json', group: 'Pêche', storage: 'app',
    help: 'Liste de prises : type (nothing, dust, bone, key, booster, chest, part = pièce détachée, remplace un exemplaire en Finitions / Qualité), poids (chance relative), min/max (quantité).',
    def: [
      { type: 'nothing', weight: 28, label: 'Une vieille botte' },
      { type: 'dust', weight: 30, min: 10, max: 45 },
      { type: 'bone', weight: 8, min: 1, max: 1 },
      { type: 'booster', weight: 10, min: 1, max: 1 },
      { type: 'chest', weight: 8, min: 1, max: 1 },
      { type: 'key', weight: 5, min: 1, max: 1 },
      { type: 'part', weight: 3, min: 1, max: 1, label: 'Pièce détachée' }
    ]
  },

  // --- Saison
  SeasonEnabled: { label: 'Saisons activées', type: 'bool', def: true, group: 'Saison', storage: 'app', help: '' },
  SeasonTiers: { ...int('Nombre de paliers', 10, 'Saison', '', 1, 50), storage: 'app' },
  SeasonXpPerTier: { ...int('XP par palier', 120, 'Saison', 'XP gagnée pendant le mois.', 1), storage: 'app' },
  SeasonRewards: {
    label: 'Récompenses des paliers', type: 'json', group: 'Saison', storage: 'app',
    help: 'Un objet par palier (dans l’ordre) : dust, boosters, chests, keys. Le dernier palier donne aussi la carte de la saison si elle est choisie.',
    def: [
      { dust: 50 }, { dust: 70 }, { boosters: 1 }, { dust: 100 }, { chests: 1 },
      { dust: 150 }, { boosters: 1 }, { keys: 1 }, { dust: 200 }, { chests: 1, boosters: 1 }
    ]
  },

  SeasonBonusTierDust: { ...int('Poussières par palier bonus', 50, 'Saison', 'Après le dernier palier, chaque tranche d’XP supplémentaire rapporte ces poussières (à répétition).'), storage: 'app' },

  // --- Defis, objectif commun, succes, collections (2026-10-05)
  ChallengeBonusBoosters: { ...int('Défis : jetons booster si les 3 défis sont accomplis', 1, 'Défis et objectifs', ''), storage: 'app' },
  CommunityGoalScale: { ...num('Objectif commun : difficulté', 1, 'Défis et objectifs', '1 = normal, 2 = deux fois plus dur (l’objectif s’adapte aussi au nombre de joueurs).', 0.2, 10), storage: 'app' },
  CommunityGoalDust: { ...int('Objectif commun : poussières par participant', 250, 'Défis et objectifs', ''), storage: 'app' },
  CommunityGoalWorms: { ...int('Objectif commun : vers par participant', 5, 'Défis et objectifs', ''), storage: 'app' },
  HiddenAchievementDust: { ...int('Succès secret : poussières', 50, 'Défis et objectifs', 'Gagnées à chaque succès secret débloqué.'), storage: 'app' },
  ThemeRewardDust: { ...int('Collection thématique : poussières', 300, 'Défis et objectifs', 'En plus du titre, à chaque collection thématique réclamée.'), storage: 'app' },
  CommunityDigPerDay: { ...int('Grande fouille : coups de pioche par jour', 5, 'Défis et objectifs', ''), storage: 'app' },
  GrandTreasureDust: { ...int('Grande fouille : poussières du grand trésor (par participant)', 150, 'Défis et objectifs', ''), storage: 'app' },
  GrandTreasureBoosters: { ...int('Grande fouille : jetons booster du grand trésor (par participant)', 1, 'Défis et objectifs', 'Le découvreur en reçoit un de plus.'), storage: 'app' },

  // --- Boutique de cosmetiques
  CosmeticsCatalog: {
    label: 'Catalogue de la boutique', type: 'json', group: 'Boutique', storage: 'app',
    help: 'Liste d’objets : key (unique), type (title, frame, color), label, price (poussières). Pour un cadre ou une couleur, la key doit correspondre à un style existant (frame-bronze, frame-silver, frame-gold, frame-neon, color-emerald, color-gold, color-rainbow).',
    def: [
      { key: 'title-dimanche', type: 'title', label: 'Pêcheur du dimanche', price: 300 },
      { key: 'title-fouineur', type: 'title', label: 'Fouineur', price: 300 },
      { key: 'title-collection', type: 'title', label: 'Collectionneur', price: 600 },
      { key: 'title-mecene', type: 'title', label: 'Mécène', price: 1000 },
      { key: 'title-legende', type: 'title', label: 'Légende de 2gether', price: 3000 },
      { key: 'frame-bronze', type: 'frame', label: 'Cadre bronze', price: 500 },
      { key: 'frame-silver', type: 'frame', label: 'Cadre argent', price: 1200 },
      { key: 'frame-gold', type: 'frame', label: 'Cadre or', price: 2500 },
      { key: 'frame-neon', type: 'frame', label: 'Cadre néon', price: 2000 },
      { key: 'color-emerald', type: 'color', label: 'Pseudo émeraude', price: 800 },
      { key: 'color-gold', type: 'color', label: 'Pseudo or', price: 1500 },
      { key: 'color-rainbow', type: 'color', label: 'Pseudo arc-en-ciel', price: 4000 },
      // Ajouts 2026-10-07
      { key: 'title-tresors', type: 'title', label: 'Chasseur de trésors', price: 400 },
      { key: 'title-decraft', type: 'title', label: 'Roi du décraft', price: 700 },
      { key: 'title-encheres', type: 'title', label: 'Maître des enchères', price: 800 },
      { key: 'title-fantome', type: 'title', label: 'Fantôme du serveur', price: 900 },
      { key: 'title-ame', type: 'title', label: 'Âme de collectionneur', price: 1200 },
      { key: 'title-astre', type: 'title', label: 'Astre de 2gether', price: 2500 },
      { key: 'title-diamant', type: 'title', label: 'Main de diamant', price: 3500 },
      { key: 'title-mythe', type: 'title', label: 'Mythe vivant', price: 6000 },
      { key: 'frame-ruby', type: 'frame', label: 'Cadre rubis', price: 1500 },
      { key: 'frame-emerald', type: 'frame', label: 'Cadre émeraude', price: 1500 },
      { key: 'frame-fire', type: 'frame', label: 'Cadre de feu', price: 3000 },
      { key: 'frame-cosmic', type: 'frame', label: 'Cadre cosmique', price: 3500 },
      { key: 'frame-rainbow', type: 'frame', label: 'Cadre arc-en-ciel', price: 6000 },
      { key: 'color-ruby', type: 'color', label: 'Pseudo rubis', price: 1000 },
      { key: 'color-ice', type: 'color', label: 'Pseudo glacé', price: 1000 },
      { key: 'color-sunset', type: 'color', label: 'Pseudo coucher de soleil', price: 2200 },
      { key: 'color-fire', type: 'color', label: 'Pseudo de feu', price: 2500 },
      { key: 'color-galaxy', type: 'color', label: 'Pseudo galaxie', price: 3500 },
      // Ajouts 2026-10-25 (styles par donnees, modifiables dans l'editeur)
      { key: 'frame-aurore', type: 'frame', label: 'Cadre aurore', price: 2800, tag: 'nouveau', desc: 'Les lumières du nord autour de ton avatar.', style: { c1: '#34d399', c2: '#a78bfa', glow: 18, anim: 'pulse' } },
      { key: 'frame-citrouille', type: 'frame', label: 'Cadre citrouille', price: 1300, tag: 'saison', desc: 'Pour les nuits d’Halloween.', style: { c1: '#f97316', c2: '#581c87', glow: 14, anim: 'pulse' } },
      { key: 'frame-ocean', type: 'frame', label: 'Cadre océan', price: 1700, tag: 'nouveau', style: { c1: '#0ea5e9', c2: '#1e3a8a', glow: 12, anim: 'none' } },
      { key: 'color-aurore', type: 'color', label: 'Pseudo aurore', price: 2600, tag: 'nouveau', style: { c1: '#34d399', c2: '#a78bfa', glow: 6, anim: 'shine' } },
      { key: 'color-menthe', type: 'color', label: 'Pseudo menthe', price: 700, tag: 'nouveau', style: { c1: '#6ee7b7', glow: 0, anim: 'none' } },
      { key: 'title-pinceau', type: 'title', label: 'Pinceau d’or', price: 900, tag: 'nouveau', desc: 'Pour qui dégage les tablettes anciennes sans rien fissurer.' },
      { key: 'title-maitre-chien', type: 'title', label: 'Meilleur ami de Milo', price: 600, tag: 'nouveau' },
      { key: 'title-emeraude', type: 'title', label: 'Maître émeraude', price: 5000, tag: 'nouveau', desc: 'Le titre de ceux qui collectionnent les cartes émeraude.' }
    ]
  },

  // --- Boutique d'objets (2026-10-07)
  ShopCatalog: {
    label: 'Boutique : objets et bonus', type: 'json', group: 'Boutique', storage: 'app',
    help: 'Liste d’objets : key (unique), group (resources ou boosts), pages (liste des pages où l’objet s’affiche aussi : fouille, peche, jardin, archeo, expedition, ouverture, collection ; vide = seulement la boutique), label, icon, desc, price (poussières), weekly (achats max par semaine, 0 = illimité) et soit give { Worms, GoldBait, BoneCount, ChestCount, KeyCount, SpareParts, LuckCharges, CatFish, Carrots, Grubs: quantité }, soit effect (xpBoost avec hours, digEnergy, fishEnergy, gardenRipe, expeditionNow).',
    def: [
      { key: 'worms10', group: 'resources', label: 'Sac de 10 vers', icon: '🪱', desc: 'De quoi lancer ta ligne 10 fois.', price: 60, weekly: 5, give: { Worms: 10 } },
      { key: 'bait', group: 'resources', label: 'Appât doré', icon: '🪝', desc: 'Aucune prise vide et prises rares ×2,5 pour un lancer.', price: 150, weekly: 5, give: { GoldBait: 1 } },
      { key: 'bone', group: 'resources', label: 'Os pour Milo', icon: '🦴', desc: 'Envoie Milo, le chien, creuser pour toi pendant 2 h.', price: 180, weekly: 3, give: { BoneCount: 1 } },
      { key: 'chest', group: 'resources', label: 'Pièce de gatchapon', icon: '🪙', desc: 'Une boule au gatchapon, avec un coffre dedans (à ouvrir avec une clé).', price: 130, weekly: 5, give: { ChestCount: 1 } },
      { key: 'key', group: 'resources', label: 'Clé de coffre', icon: '🔑', desc: 'Ouvre un coffre (ou pioche au choix dans le coffre de guilde).', price: 400, weekly: 2, give: { KeyCount: 1 } },
      { key: 'part', group: 'resources', label: 'Pièce détachée', icon: '🔩', desc: 'Remplace un exemplaire dans une fusion ou une restauration.', price: 350, weekly: 2, give: { SpareParts: 1 } },
      { key: 'luck5', group: 'boosts', label: 'Élixir de chance', icon: '🧪', desc: '+5 points de chance de finition spéciale sur tes 5 prochains boosters.', price: 500, weekly: 2, give: { LuckCharges: 5 } },
      { key: 'xp1h', group: 'boosts', label: 'Potion de savoir', icon: '📘', desc: 'XP ×2 pendant 1 heure : compte, pêche, fouille, expédition, jardin.', price: 400, weekly: 2, effect: 'xpBoost', hours: 1 },
      { key: 'coffee', group: 'boosts', label: 'Café du fouilleur', icon: '☕', desc: 'Recharge complète de ton énergie de fouille. Sans limite, mais plus cher à chaque achat du jour.', price: 200, escalate: true, effect: 'digEnergy' },
      { key: 'thermos', group: 'boosts', label: 'Thermos du pêcheur', icon: '🫖', desc: 'Recharge complète de ton énergie de pêche. Sans limite, mais plus cher à chaque achat du jour.', price: 200, escalate: true, effect: 'fishEnergy' },
      { key: 'fertilizer', group: 'boosts', label: 'Engrais express', icon: '🌿', desc: 'Toutes tes plantations en cours sont prêtes tout de suite.', price: 180, weekly: 3, effect: 'gardenRipe' },
      { key: 'compass', group: 'boosts', label: 'Boussole dorée', icon: '🧭', desc: 'Ton expédition en cours rentre immédiatement.', price: 300, weekly: 2, effect: 'expeditionNow' }
    ]
  },

  // --- Economie
  TradeTaxPerCard: { ...int('Taxe d’échange (poussières par carte)', 15, 'Économie', 'Payée par celui qui propose l’échange. 0 = pas de taxe.'), storage: 'app' },
  ShopItemGrowth: { ...num('Boutique : multiplicateur du prix par achat du jour d’un objet', 1.25, 'Boutique', 'Plus de plafond par semaine : chaque achat du jour d’un objet coûte ce multiple du précédent pour ce joueur (1,25 = 100, 125, 155, 195…), remis à zéro à minuit. Les recharges d’énergie suivent leur propre multiplicateur.', 1, 5), storage: 'app' },
  EnergyRefillGrowth: { ...num('Recharges d’énergie : multiplicateur du prix par achat du jour', 1.6, 'Boutique', 'Café du fouilleur et thermos du pêcheur sont illimités : chaque achat du jour coûte ce multiple du précédent (1,6 = 200, 320, 510, 820…), remis à zéro chaque jour.', 1, 5), storage: 'app' },
  BoneWeeklyIncrease: { ...num('Hausse du prix de l’os par achat dans la semaine', 0.25, 'Économie', '0,25 = +25 % par os acheté, remis à zéro le lundi.', 0, 5), storage: 'app' },
  DuplicateDustCapCopies: { ...int('Doublons : exemplaires avant plafond', 5, 'Économie', 'À partir de ce nombre d’exemplaires, un doublon ne rapporte plus que 1 poussière. 0 = pas de plafond.'), storage: 'app' },
  FishingFullRewardsPerDay: { ...int('Pêche : lancers à plein rendement par jour', 15, 'Économie', 'Au-delà, poussières divisées par 2 et objets moins fréquents. 0 = désactivé.'), storage: 'app' },
  DigFullRewardsPerDay: { ...int('Fouille : cases à plein rendement par jour', 40, 'Économie', 'Au-delà, poussières trouvées divisées par 2. 0 = désactivé.'), storage: 'app' },
  WeatherRerollCost: { ...int('Relance de la météo de pêche (poussières)', 80, 'Économie', 'Une fois par jour.'), storage: 'app' },
  ExpeditionRushCost: { ...int('Retour accéléré d’expédition (poussières)', 120, 'Économie', 'Divise le temps restant par 2, une fois par jour.'), storage: 'app' },
  RepairDustPerCopy: { ...int('Restauration : poussières par exemplaire manquant', 60, 'Économie', 'Dans l’atelier Qualité, des exemplaires manquants peuvent être payés en poussières (au moins une vraie carte).', 1), storage: 'config' },
  MarketAutoEnabled: { label: 'Marché noir automatique', type: 'bool', def: true, group: 'Économie', storage: 'app', help: 'Chaque lundi, des offres sont générées automatiquement (comme le bingo du mois).' },
  MarketAutoRestock: { label: 'Marché noir : nouvel arrivage dès que tout est vendu', type: 'bool', def: true, group: 'Économie', storage: 'app', help: 'Quand toutes les offres automatiques de la semaine sont épuisées (ou expirées), un nouvel arrivage est généré aussitôt.' },
  MarketAutoOffers: { ...int('Marché noir : offres par semaine', 4, 'Économie', '', 1, 12), storage: 'app' },
  MarketPriceMultiplier: { ...num('Marché noir : prix (× coût de craft)', 1.5, 'Économie', '', 0.2, 10), storage: 'app' },
  MarketDealMultiplier: { ...num('Marché noir : prix du coup de cœur (× coût de craft)', 0.8, 'Économie', '', 0.1, 10), storage: 'app' },
  MarketMaxPurchases: { ...int('Marché noir : achats max par offre', 3, 'Économie', '', 1, 50), storage: 'app' },
  // Cible (2026-10-16) : ~40 boosters crees par joueur actif et par jour, a
  // plus ou moins 20 (20 a 60), codes de jeu exclus du calcul (souvent 20
  // boosters offerts d'un coup). Le seuil d'alerte est le haut de la fourchette ;
  // 7 jours d'alerte d'affilee activent le mode anti-inflation.
  BoosterTargetPerDay: { ...num('Cible : boosters créés par joueur actif et par jour', 40, 'Économie', 'Hors codes de jeu. La fourchette va de la cible moins l’écart (seuil d’alerte − cible) au seuil d’alerte : 20 à 60 par défaut.', 1, 500), storage: 'app' },
  EconomyAlertBoostersPerPlayer: { ...num('Alerte : boosters créés par joueur actif et par jour', 60, 'Économie', 'Haut de la fourchette (cible 40 + 20 par défaut), codes de jeu exclus. Au-delà, alerte dans le tableau de bord de l’économie ; 7 jours d’alerte d’affilée activent le mode anti-inflation.', 0.5, 500), storage: 'app' },
  EconomyAlertDustRatio: { ...num('Alerte : poussières gagnées pour 1 dépensée', 3, 'Économie', '', 1, 100), storage: 'app' },

  // --- Serie de connexion
  LoginStreakRewards: {
    label: 'Cadeaux des 7 jours', type: 'json', group: 'Série de connexion', storage: 'app',
    help: '7 objets : dust et/ou boosters.',
    def: [{ dust: 20 }, { dust: 30 }, { dust: 40 }, { boosters: 1 }, { dust: 60 }, { dust: 80 }, { boosters: 2, dust: 150 }]
  },

  // --- Sets complets
  SetRewardBoosters: { ...int('Boosters par set complet', 3, 'Sets complets', ''), storage: 'app' },
  SetRewardDust: { ...int('Poussières par set complet', 300, 'Sets complets', ''), storage: 'app' },

  // --- Boss
  BossFinisherBoosters: { ...int('Boosters bonus du coup final', 2, 'Boss', '0 = pas de bonus.'), storage: 'app' },
  BossVolleyStep: { label: 'Bonus de salve par carte en plus', type: 'number', def: 0.1, min: 0, max: 1, step: 0.01, group: 'Boss', storage: 'app', help: '0,1 = +10 % par carte.' },
  BossMaxCards: { ...int('Cartes max par salve', 10, 'Boss', '', 1, 50), storage: 'app' },
  BossFinishMultipliers: { label: 'Multiplicateurs de finition', type: 'json', group: 'Boss', storage: 'app', help: '', def: { normal: 1, holo: 1.5, gold: 2, ghost: 2.5, diamond: 3, rainbow: 5 } },
  BossQualityMultipliers: { label: 'Multiplicateurs d’état', type: 'json', group: 'Boss', storage: 'app', help: '', def: { damaged: 0.75, worn: 1, good: 1.25, mint: 1.5 } },

  // --- Fouille / coffre-fort perso (lus par les workflows)
  DogBoneCost: { ...int('Prix d’un os (poussières)', 250, 'Fouille', 'Envoie Milo creuser 2 h.', 1), storage: 'config' },
  DigMaxEnergy: { ...int('Fouille : énergie max', 10, 'Fouille', '+1 tous les 2 niveaux de fouille. Une grille fait 32 cases (4 × 8).', 1, 200), storage: 'config' },
  DigDepths: { label: 'Fouille : les 5 profondeurs', type: 'json', group: 'Fouille', storage: 'app', help: 'Liste de profondeurs : label, icon, level (niveau de fouille requis), cardShift (paliers de rareté en plus pour les cartes : 0 = commune et rare), mineralMax (palier de minéral le plus haut, 1 à 5), treasures (liste { reward : card, rareCard, booster, bigDust, smallDust ou mineral ; cells : cases par trésor ; n : nombre } ; 32 cases au total par grille).', def: [{"label":"Surface","icon":"🌱","level":1,"cardShift":0,"mineralMax":1,"treasures":[{"reward":"card","cells":4,"n":1},{"reward":"rareCard","cells":3,"n":1},{"reward":"booster","cells":2,"n":2},{"reward":"bigDust","cells":2,"n":2},{"reward":"smallDust","cells":1,"n":4},{"reward":"mineral","cells":1,"n":2}]},{"label":"Galeries","icon":"🕳️","level":3,"cardShift":0,"mineralMax":2,"treasures":[{"reward":"card","cells":4,"n":1},{"reward":"rareCard","cells":3,"n":1},{"reward":"booster","cells":2,"n":2},{"reward":"bigDust","cells":2,"n":2},{"reward":"smallDust","cells":1,"n":2},{"reward":"mineral","cells":1,"n":3}]},{"label":"Cavernes","icon":"🦇","level":5,"cardShift":1,"mineralMax":3,"treasures":[{"reward":"card","cells":4,"n":1},{"reward":"rareCard","cells":3,"n":1},{"reward":"booster","cells":2,"n":2},{"reward":"bigDust","cells":2,"n":2},{"reward":"mineral","cells":2,"n":3}]},{"label":"Gouffre","icon":"🌋","level":7,"cardShift":1,"mineralMax":4,"treasures":[{"reward":"card","cells":4,"n":1},{"reward":"rareCard","cells":4,"n":1},{"reward":"booster","cells":3,"n":2},{"reward":"bigDust","cells":3,"n":1},{"reward":"mineral","cells":2,"n":3}]},{"label":"Noyau","icon":"💎","level":9,"cardShift":2,"mineralMax":5,"treasures":[{"reward":"card","cells":4,"n":1},{"reward":"rareCard","cells":4,"n":1},{"reward":"booster","cells":3,"n":2},{"reward":"bigDust","cells":3,"n":1},{"reward":"mineral","cells":3,"n":3}]}] },
  MineralValues: { label: 'Minéraux : poussières par minéral (paliers 1 à 5)', type: 'json', group: 'Fouille', storage: 'app', help: 'Prix de revente au comptoir du marché noir, du palier commun au légendaire.', def: [15, 40, 100, 250, 700] },
  MineralTrades: { label: 'Minéraux : échanges du comptoir', type: 'json', group: 'Fouille', storage: 'app', help: 'Liste { tier : palier, n : minéraux de ce palier, give : { BoneCount, KeyCount, ChestCount, BoosterCount, Worms, GoldBait, SpareParts : quantité } }.', def: [{"tier":1,"n":6,"give":{"Worms":5}},{"tier":1,"n":10,"give":{"BoneCount":1}},{"tier":2,"n":5,"give":{"KeyCount":1}},{"tier":3,"n":3,"give":{"ChestCount":1}},{"tier":3,"n":4,"give":{"SpareParts":1}},{"tier":4,"n":2,"give":{"GoldBait":3}},{"tier":5,"n":1,"give":{"BoosterCount":2}}] },
  DigRegenSeconds: { ...int('Fouille : secondes pour regagner 1 énergie', 600, 'Fouille', 'Réduit de 5 % par niveau de fouille.', 30, 86400), storage: 'config' },
  DigBoosterKeepChance: { ...pct('Fouille : chance de garder un jeton booster trouvé', 1, 'Fouille', 'Sinon il devient 25 à 50 poussières. Au-delà du plein rendement du jour, jamais de booster.'), storage: 'app' },
  DogBonesPerDay: { ...int('Milo (chien) : os par jour (plus utilisé)', 6, 'Fouille', 'Ignoré depuis le 26/10/2026 : la fatigue (Animaux) remplace la limite par jour.', 0, 24), storage: 'app' },
  DogKeepBoosters: { label: 'Milo (chien) : il rapporte les jetons booster trouvés', type: 'bool', def: true, group: 'Fouille', storage: 'app', help: 'Désactivé : chaque booster trouvé par Milo devient des poussières (réglage ci-dessous).' },
  DogFrenzyBones: { ...int('Milo excité : os donnés d’un coup', 50, 'Fouille', 'Milo creuse aussitôt plusieurs grilles entières (poussières ×2), puis il est fatigué. Hors limite d’os du jour.', 2, 1000), storage: 'app' },
  DogFrenzyBoards: { ...int('Milo excité : grilles creusées d’un coup', 15, 'Fouille', '', 1, 100), storage: 'app' },
  DogFrenzyRestHours: { ...int('Milo excité : heures de fatigue ensuite', 24, 'Fouille', 'Ni os ni mode excité pendant ce temps.', 0, 336), storage: 'app' },
  DogBoosterDust: { ...int('Milo (chien) : poussières à la place d’un jeton booster', 40, 'Fouille', 'Seulement si « Milo rapporte les boosters » est désactivé.'), storage: 'app' },
  DailyQuestRewardBoosters: { ...int('Quêtes du jour : jetons booster', 5, 'Boosters', '', 1, 20), storage: 'config' },
  WeeklyQuestRewardBoosters: { ...int('Quêtes de la semaine : jetons booster', 14, 'Boosters', '', 1, 50), storage: 'config' },
  DigLevelXpStep: { ...int('XP pour le niveau 2 de fouille', 20, 'Fouille', 'Chaque niveau suivant demande ce palier en plus (20, 60, 120…). 1 XP par case, +5 par trésor.', 1), storage: 'config' },
  VaultBoostersPerRow: { ...int('Coffre-fort : jetons booster par ligne complète', 6, 'Coffre-fort perso', ''), storage: 'config' },
  VaultDustPerRow: { ...int('Coffre-fort : poussières par ligne complète', 200, 'Coffre-fort perso', ''), storage: 'config' },

  // --- Progression longue (2026-10-07)
  MasteryFinishBonusPerLevel: { label: 'Maîtrise : finition spéciale en plus par niveau', type: 'number', def: 0.005, min: 0, max: 0.05, step: 0.001, group: 'Progression', storage: 'app', help: '0,005 = +0,5 point de chance de finition spéciale par niveau de maîtrise au-dessus du 1, sur les boosters de cette extension.' },
  MasteryLevelDust: { ...int('Maîtrise : poussières par niveau atteint', 40, 'Progression', 'Récompense du niveau N = N × cette valeur.'), storage: 'app' },
  MasteryLayerRewards: { label: 'Maîtrise : récompenses des 3 couches complètes', type: 'json', group: 'Progression', storage: 'app', help: 'cards (toutes les cartes), qualities (tous les états de chaque carte), finishes (toutes les finitions de chaque carte) : dust, boosters.', def: { cards: { dust: 300, boosters: 1 }, qualities: { dust: 800, boosters: 2 }, finishes: { dust: 1500, boosters: 3 } } },
  TalentResetCost: { ...int('Talents : prix de la remise à zéro (poussières)', 500, 'Progression', ''), storage: 'app' },
  SkyResetCost: { ...int('Arbre céleste : prix de la remise à zéro (poussières)', 300, 'Progression', 'Les points d’étoile sont rendus.'), storage: 'app' },
  ConstellationDust: { ...int('Constellations : poussières par étoile allumée', 150, 'Progression', ''), storage: 'app' },
  ConstellationSkyBoosters: { ...int('Constellations : jetons booster du ciel complet', 10, 'Progression', 'Donnés une fois quand les 40 étoiles sont allumées (avec un titre).'), storage: 'app' },
  StarDecraftMultiplier: { ...num('Carte ★ : multiplicateur de décraft', 3, 'Progression', 'Une carte ★ (3 arc-en-ciel parfait état fusionnées) vaut ce multiple au décraft.', 1, 20), storage: 'app' },
  RankThresholds: { label: 'Rangs de compte (valeur de collection)', type: 'json', group: 'Progression', storage: 'app', help: 'Liste croissante : key, label, icon, min (valeur de collection = somme des valeurs de décraft de tous les exemplaires).', def: [
    { key: 'bronze', label: 'Bronze', icon: '🥉', min: 0 }, { key: 'argent', label: 'Argent', icon: '🥈', min: 3000 },
    { key: 'or', label: 'Or', icon: '🥇', min: 12000 }, { key: 'platine', label: 'Platine', icon: '💠', min: 40000 },
    { key: 'legende', label: 'Légende', icon: '👑', min: 120000 }] },
  TierRewardDust: { label: 'Maîtrises de succès : poussières des paliers I, II, III', type: 'json', group: 'Progression', storage: 'app', help: 'Le palier III donne aussi un titre.', def: [100, 300, 900] },
  ExpeditionLevelXpStep: { ...int('XP pour le niveau 2 d’expédition', 10, 'Progression', '2 XP par balade, 5 par expédition, 12 par grande aventure.', 1), storage: 'app' },
  GardenLevelXpStep: { ...int('XP pour le niveau 2 de jardinage', 8, 'Progression', '2 XP par parcelle récoltée.', 1), storage: 'app' },

  // --- Rendez-vous quotidiens (2026-10-07)
  DailyBoxLoot: { label: 'Boîte du jour : contenu', type: 'json', group: 'Quotidien', storage: 'app', help: 'type (dust, worms, bait, key, part, booster, chest, cosmetic), weight, min, max. Un cosmétique déjà possédé devient des poussières.', def: [
    { type: 'dust', weight: 40, min: 20, max: 70 }, { type: 'worms', weight: 20, min: 2, max: 5 }, { type: 'bait', weight: 10, min: 1, max: 1 },
    { type: 'key', weight: 6, min: 1, max: 1 }, { type: 'part', weight: 6, min: 1, max: 1 }, { type: 'booster', weight: 9, min: 1, max: 1 },
    { type: 'chest', weight: 5, min: 1, max: 1 }, { type: 'cosmetic', weight: 4, min: 1, max: 1 }] },
  LuckyHourFinishBonus: { ...pct('Heure de chance : finition spéciale en plus', 0.08, 'Quotidien', 'Ajoutée à la chance de finition spéciale pendant l’heure de chance.'), storage: 'app' },
  LuckyHourDustBonus: { ...num('Heure de chance : poussières en plus', 0.25, 'Quotidien', '0,25 = +25 % au décraft, à la fouille et en expédition.', 0, 5), storage: 'app' },
  HouseXpMultiplier: { ...num('Action du jour : multiplicateur d’XP', 2, 'Quotidien', '', 1, 10), storage: 'app' },
  StreakFreezeCost: { ...int('Série : prix d’un gel (poussières)', 150, 'Quotidien', 'Un gel pardonne un jour manqué. Un seul achat par semaine, 2 gels max en réserve.'), storage: 'app' },
  ReturnerMinDays: { ...int('Bonus de retour : jours d’absence', 7, 'Quotidien', '', 2, 365), storage: 'app' },
  EveningMissionDust: { ...int('Missions du soir : poussières par mission', 30, 'Quotidien', 'Disponibles de 18 h à minuit.'), storage: 'app' },
  EveningBonusDust: { ...int('Missions du soir : bonus si les 3 sont faites', 60, 'Quotidien', ''), storage: 'app' },

  // --- Marche et economie (2026-10-07)
  ContractsPerWeek: { ...int('Contrats de collection par semaine', 4, 'Économie', '', 1, 8), storage: 'app' },
  AuctionTaxPct: { ...pct('Enchères : taxe sur la vente', 0.15, 'Économie', 'Prélevée sur le prix final (détruite).'), storage: 'app' },
  AuctionMaxActive: { ...int('Enchères : ventes en cours max par joueur', 3, 'Économie', '', 1, 20), storage: 'app' },
  AuctionHours: { ...int('Enchères : durée (heures)', 24, 'Économie', '', 1, 168), storage: 'app' },
  ExchangeRateSwing: { ...num('Cours du décraft : variation max', 0.3, 'Économie', '0,30 = la valeur de décraft d’une rareté varie de −30 % à +30 % selon l’offre et la demande de la semaine passée (une rareté très décraftée perd de la valeur).', 0, 0.5), storage: 'app' },
  InsuranceCostPerTier: { ...int('Assurance : prix par rang de rareté', 40, 'Économie', 'Commune = 1 rang, rare = 2… Payé une fois.'), storage: 'app' },
  BoosterShopPrice: { ...int('Boutique : prix d’un jeton booster (poussières)', 300, 'Économie', '', 1), storage: 'app' },
  BoosterShopIncrease: { ...num('Boutique : hausse par jeton booster acheté dans la semaine', 0.35, 'Économie', '', 0, 5), storage: 'app' },
  BoosterShopWeeklyCap: { ...int('Boutique : jetons booster ouverts (0 = fermée)', 14, 'Économie', 'Depuis le 25/10/2026 il n’y a plus de plafond : 0 ferme la vente, toute autre valeur l’ouvre (illimitée, inflation personnelle du jour).'), storage: 'app' },
  BoosterShopDailyGrowth: { ...num('Boutique : multiplicateur du prix par jeton booster acheté dans la journée', 1.3, 'Économie', 'Inflation personnelle : 1,3 = 300, 390, 505, 660… ; remise à zéro à minuit.', 1, 5), storage: 'app' },
  // --- Pity par rarete et booster mystere (pity.js)
  RarityPityMultiplier: { ...num('Pity par rareté : tirages garantis (× la moyenne)', 2.5, 'Boosters', 'Chaque rareté qui sort dans moins de 15 % des tirages est garantie après ce multiple du nombre moyen de tirages pour l’obtenir (2,5 × 17 = 43 pour une rareté à 6 %). 0 = désactivé.', 0, 20), storage: 'app' },
  MysteryFinishBonus: { ...pct('Booster mystère : bonus de finition spéciale', 0.03, 'Boosters', '0,03 = +3 points de chance de finition spéciale par carte.'), storage: 'app' },

  // --- Course aux tresors, coffre de saison, prestige du compte (2026-10-09)
  TreasureHuntEnabled: { label: 'Course aux trésors hebdo', type: 'bool', def: true, group: 'Progression', storage: 'app', help: '5 indices cachés chaque semaine sur 5 pages du site.' },
  TreasureClueDust: { ...int('Course aux trésors : poussières par indice', 25, 'Progression', ''), storage: 'app' },
  TreasureHuntBonus: { label: 'Course aux trésors : bonus des 5 indices', type: 'json', group: 'Progression', storage: 'app', help: 'Objet : boosters, keys, dust.', def: { boosters: 1, keys: 1, dust: 0 } },
  SeasonChestDustPerXp: { ...num('Coffre de saison : poussières par XP de saison', 0.2, 'Saison', '', 0, 10), storage: 'app' },
  SeasonChestMaxDust: { ...int('Coffre de saison : poussières max', 400, 'Saison', ''), storage: 'app' },
  SeasonChestXpPerBooster: { ...int('Coffre de saison : XP par jeton booster', 600, 'Saison', 'Une clé tous les 2 × cette XP (2 max).', 1), storage: 'app' },
  SeasonChestMaxBoosters: { ...int('Coffre de saison : jetons booster max', 3, 'Saison', '', 0, 20), storage: 'app' },
  AccountPrestigeLevel: { ...int('Prestige du compte : niveau de la 1re étoile', 31, 'Progression', 'Niveau où tous les talents sont débloqués.', 2, 500), storage: 'app' },
  AccountPrestigeStep: { ...int('Prestige du compte : niveaux par étoile suivante', 5, 'Progression', 'Chaque étoile : +1 point de talent de prestige, un titre et les récompenses ci-dessous.', 1, 100), storage: 'app' },
  AccountPrestigeBoosters: { ...int('Prestige du compte : jetons booster par étoile', 3, 'Progression', 'Donnés une fois à chaque nouvelle étoile.', 0, 100), storage: 'app' },
  AccountPrestigeDust: { ...int('Prestige du compte : poussières par étoile', 500, 'Progression', 'Données une fois à chaque nouvelle étoile.', 0, 100000), storage: 'app' },

  // --- Depenses durables (upgrades.js, 2026-10-11)
  UpgradeBasePrice: { ...int('Améliorations : prix du niveau 1 (poussières)', 500, 'Économie', 'Chaque niveau coûte le double du précédent (500, 1000, 2000, 4000, 8000), indexé sur la richesse moyenne.', 1), storage: 'app' },
  FinishRerollChance: { ...pct('Relance de finition : chance de finition spéciale', 0.25, 'Économie', 'Sur un exemplaire en finition normale.'), storage: 'app' },
  FinishRerollCost: { label: 'Relance de finition : prix par rareté', type: 'json', group: 'Économie', storage: 'app', help: 'Objet { cleRarete: poussières, default: … }.', def: { commune: 300, rare: 500, epique: 800, legendaire: 1200, mythique: 1500, default: 800 } },
  RareOnServerCopies: { ...int('Décraft : carte rare sur le serveur (moins de N exemplaires)', 3, 'Économie', 'En dessous, le décraft rapporte le bonus ci-dessous. 0 = désactivé.'), storage: 'app' },
  RareOnServerDecraftBonus: { ...num('Décraft : bonus d’une carte rare sur le serveur', 1, 'Économie', '1 = ×2.', 0, 5), storage: 'app' },

  // --- Confort et rendez-vous (comfort.js, rendezvous.js, 2026-10-11)
  RipenEnabled: { label: 'Mûrissoir à boosters', type: 'bool', def: true, group: 'Boosters', storage: 'app', help: 'Au distributeur, la sélection peut mûrir au lieu d’être ouverte : ses jetons sont mis de côté le temps choisi, puis le lot s’ouvre gratuitement avec un bonus de finition par booster (et une finition spéciale garantie au dernier stade).' },
  RipenStages: { label: 'Mûrissoir : stades', type: 'json', group: 'Boosters', storage: 'app', help: 'Durées proposées au moment de laisser mûrir : liste ordonnée { hours : heures, label, icon, finish : points de chance de finition spéciale par booster, special : true = une finition spéciale garantie par booster }.', def: [{ hours: 6, label: 'Mûr', icon: '🍏', finish: 10 }, { hours: 24, label: 'Bien mûr', icon: '🍎', finish: 20 }, { hours: 72, label: 'Doré', icon: '🌟', finish: 35, special: true }] },
  RipenSlotLevels: { label: 'Mûrissoir : niveau de compte de chaque lot', type: 'json', group: 'Boosters', storage: 'app', help: 'Liste de niveaux, un par lot en train de mûrir en même temps (plafonné par « Mûrissoir : lots au maximum », propre à chaque difficulté).', def: [1, 8, 15, 25, 40] },
  RipenMaxPoints: { ...int('Mûrissoir : lots au maximum', 3, 'Boosters', 'Lots de boosters qui mûrissent en même temps au plus (selon la difficulté), débloqués par le niveau de compte.', 0, 10), storage: 'app' },
  ShardsPerBooster: { ...int('Fragments : nombre pour 1 jeton booster', 5, 'Boosters', 'Gagnés en jouant (grilles de fouille, récoltes, prises vides, expéditions…). 0 = désactivé.', 0, 100), storage: 'app' },
  ShardsDailyCap: { ...int('Fragments : maximum par jour', 10, 'Boosters', '0 = illimité.', 0, 100), storage: 'app' },
  GoldenHourEnabled: { label: 'Heure dorée hebdomadaire', type: 'bool', def: true, group: 'Événements', storage: 'app', help: 'Une heure par semaine (vendredi à dimanche, 18 h à 22 h), annoncée la veille.' },
  GoldenHourFinishMultiplier: { ...num('Heure dorée : finitions spéciales (×)', 2, 'Événements', '', 1, 5), storage: 'app' },
  BoosterRainEnabled: { label: 'Pluie de boosters (objectif commun)', type: 'bool', def: true, group: 'Événements', storage: 'app', help: 'Objectif commun atteint : chaque joueur qui passe dans les 24 h reçoit des boosters.' },
  BoosterRainBoosters: { ...int('Pluie de boosters : jetons booster par joueur', 1, 'Événements', '', 1, 10), storage: 'app' },
  DogGiftEnabled: { label: 'Visite de Milo (trouvaille du jour)', type: 'bool', def: true, group: 'Fouille', storage: 'app', help: '' },
  GardenWiltHours: { ...int('Jardin : heures avant qu’une plante prête fane', 24, 'Pêche', 'Fanée : récolte divisée par deux, sans appât ni poussières. 0 = jamais.', 0, 168), storage: 'app' },
  GardenRareChancePerDay: { ...pct('Jardin : chance de récolte rare par jour de série (dès 3 jours)', 0.1, 'Pêche', '0,1 = 10 % à 3 jours, 20 % à 4 jours… (50 % au plus).'), storage: 'app' },
  SundayMarketEnabled: { label: 'Marché du dimanche', type: 'bool', def: true, group: 'Économie', storage: 'app', help: '4 cartes par joueur (manquantes d’abord) à prix réduit, une journée.' },
  SundayMarketDay: { ...int('Marché du dimanche : jour (0 = dimanche … 6 = samedi)', 0, 'Économie', '', 0, 6), storage: 'app' },
  SundayMarketDiscount: { ...num('Marché du dimanche : prix (× le coût de craft)', 0.6, 'Économie', '0,6 = 40 % moins cher que le craft.', 0.1, 1), storage: 'app' },

  // --- Bonus et malus des modes (modeperks.js, 2026-10-14)
  BoosterBetStake: { ...int('Medium : mise du pari du booster (poussières)', 100, 'Modes de jeu', 'Triplée si le booster contient une épique ou mieux.', 1), storage: 'app' },
  ChillLuckyDuplicateChance: { ...pct('Chill : chance qu’un doublon devienne une carte manquante', 0.1, 'Modes de jeu', ''), storage: 'app' },
  HardWearChance: { ...pct('Hard : chance d’usure d’un doublon par jour', 0.25, 'Modes de jeu', 'Jamais un #001, un exemplaire assuré, ★ ou au coffre.'), storage: 'app' },
  HardFinishLoss: { ...pct('Hard : part des finitions spéciales perdues à l’ouverture', 0.25, 'Modes de jeu', ''), storage: 'app' },
  LuxuryTaxMultiplier: { ...num('Hard : taxe de luxe (× pour les plus riches que la moyenne)', 1.5, 'Modes de jeu', 'Le surplus est redistribué chaque lundi aux joueurs actifs.', 1, 5), storage: 'app' },
  ModeCards: { label: 'Carte exclusive de chaque mode', type: 'json', group: 'Modes de jeu', storage: 'app', help: 'Objet { cool, chill, medium, hard } : id de la carte (promo conseillée) donnée avec l’objectif commun pendant ce mode. 0 = aucune.', def: { cool: 0, chill: 0, medium: 0, hard: 0 } },

  // --- Salle des machines (machine.js, 2026-10-14)
  MachineRoomEnabled: { label: 'Salle des machines (vote mensuel de la difficulté)', type: 'bool', def: true, group: 'Modes de jeu', storage: 'app', help: 'Une fois par mois, les joueurs sacrifient des ressources pour voter le mode de jeu, appliqué jusqu’à la fin du mois.' },
  MachineVoteDay: { ...int('Salle des machines : dernier jour du vote', 0, 'Modes de jeu', '0 = vote ouvert tout le mois, le mode gagnant s’applique le 1er du mois suivant. 1 à 28 = le vote se ferme à la fin de ce jour et le mode gagnant s’applique aussitôt jusqu’à la fin du mois.', 0, 28), storage: 'app' },
  MachineRoomCosts: { label: 'Salle des machines : sacrifices', type: 'json', group: 'Modes de jeu', storage: 'app', help: 'Objet : keys, dust, worms, parts, bait, boosters, cards (doublons).', def: { keys: 20, dust: 500, worms: 30, parts: 5, bait: 3, boosters: 3, cards: 10 } },

  // --- Cartes et ouverture (cards.js, 2026-10-15)
  GodPackChance: { ...num('God pack : chance par booster', 0.002, 'Ouverture', 'Booster ne contenant que des épiques ou mieux (0,002 = 1 sur 500).', 0, 0.2), storage: 'app' },
  ShareCardCooldown: { ...int('Partage de carte sur Discord : délai entre deux partages (s)', 120, 'Ouverture', '', 10, 86400), storage: 'app' },

  // --- Dinos de compagnie (dino.js, 2026-10-15)
  DinoSkullChance: { ...num('Dinos : chance de crâne par tuile creusée', 0.001, 'Dinos', 'Crâne de dinosaure trouvé en creusant (0,001 = 1 tuile sur 1 000).', 0, 0.1), storage: 'app' },
  DinoHatchBones: { ...int('Dinos : os pour ramener un dino à la vie', 10, 'Dinos', 'En plus d’un crâne. Nombre de places : DinoMax.', 0, 500), storage: 'app' },
  DinoMax: { ...int('Dinos : places dans l’enclos', 10, 'Dinos', 'Dinos par joueur, tas d’os compris (5 jusqu’au 20 octobre 2026). Un joueur peut relâcher un dino dans la nature pour libérer une place.', 1, 20), storage: 'app' },
  DinoFoodChance: { ...pct('Dinos : chance de nourriture par lancer de pêche', 0.5, 'Dinos', 'Poisson, algues ou crevette en plus de la prise, seulement pour les joueurs qui ont un dino ou un crâne.'), storage: 'app' },
  DinoDigHours: { ...int('Dinos : heures entre deux trouvailles de la fouille automatique', 6, 'Dinos', 'Dinos adultes et contents seulement (Tricératops 2 fois plus vite). 4 trouvailles en attente au plus.', 1, 48), storage: 'app' },
  DinoAutoSkullChance: { ...num('Dinos : chance de crâne par trouvaille automatique', 0.003, 'Dinos', '', 0, 0.1), storage: 'app' },
  DinoGoldPoopChance: { ...pct('Dinos : chance de caca doré par crevette mangée', 0.3, 'Dinos', 'Engrais doré : parcelle prête tout de suite, appât doré garanti.'), storage: 'app' },
  DinoSeasonalChance: { ...pct('Dinos : chance de Ptérodactyle saisonnier à l’éclosion', 0.3, 'Dinos', 'Seulement pendant un événement saisonnier.'), storage: 'app' },
  DinoFertilizerBoost: { ...pct('Dinos : avance donnée par un engrais', 0.5, 'Dinos', 'Part du temps de pousse sautée quand on met un caca de dino sur une parcelle (la récolte de vers est aussi doublée).'), storage: 'app' },

  // --- Bingo du mois, version 2 (bingo.js)
  BingoV2From: { ...int('Bingo : premier mois de la nouvelle version (AAAAMM)', 202611, 'Bingo', 'Avant ce mois, l’ancien bingo (9 cartes) continue tel quel ; à partir de ce mois, grille 5 × 5 avec lignes et carton plein.', 202001, 209912), storage: 'app' },
  BingoCardCells: { ...int('Bingo : nombre de cases « carte »', 8, 'Bingo', 'Les autres cases sont des objectifs du mois (boosters, fouille, pêche…).', 0, 12), storage: 'app' },
  BingoLineReward: { label: 'Bingo : récompense d’une ligne', type: 'json', group: 'Bingo', storage: 'app', help: 'Objet : dust, shards (fragments de booster), boosters. 12 lignes possibles par mois.', def: { dust: 120, shards: 2, boosters: 0 } },
  BingoFullReward: { label: 'Bingo : récompense du carton plein', type: 'json', group: 'Bingo', storage: 'app', help: 'Objet : boosters, dust. Le carton plein donne aussi le titre « Roi du bingo » du mois.', def: { boosters: 3, dust: 500 } },
  BingoJokerPrice: { ...int('Bingo : prix du joker (poussières)', 500, 'Bingo', 'Un joker par mois : valide la case de son choix.', 0, 100000), storage: 'app' },

  // --- Salle des machines, suite (machine.js, 2026-10-15)
  MachinePressureGoal: { ...int('Salle des machines : objectif de la jauge commune', 15, 'Modes de jeu', 'Nombre de salles terminées dans le mois pour que chaque participant reçoive 1 booster le 1er du mois suivant (0 = désactivé).', 0, 1000), storage: 'app' },
  MachineOverheatCosts: { label: 'Salle des machines : surchauffe (étape 6)', type: 'json', group: 'Modes de jeu', storage: 'app', help: 'Étape facultative qui fait compter le vote double. Objet : boosters, legendary (doublons légendaires ou mieux).', def: { boosters: 3, legendary: 1 } },
  MachineLoyaltyCard: { ...int('Salle des machines : carte promo d’assiduité (id)', 0, 'Modes de jeu', 'Carte donnée après 3 mois d’affilée à terminer la salle. 0 = 3 boosters à la place.', 0, 1000000), storage: 'app' },
  MachineEventVote: { label: 'Salle des machines : vote de l’événement du mois prochain', type: 'bool', def: true, group: 'Modes de jeu', storage: 'app', help: 'Second vote : l’événement gagnant est planifié tout seul le 2e week-end du mois suivant.' },
  // --- Modes de jeu, suite (modeextras.js, 2026-10-15)
  ModeNoticeHours: { ...int('Préavis de changement de mode (heures)', 24, 'Modes de jeu', 'Bandeau affiché avant un changement de mode programmé ou la fin du vote de la salle des machines.', 0, 168), storage: 'app' },
  UmbrellaPrice: { ...int('Parapluie (boutique) : prix en poussières', 350, 'Modes de jeu', 'Protège de toute usure du mode Hard pendant UmbrellaDays jours.', 1, 100000), storage: 'app' },
  UmbrellaDays: { ...int('Parapluie : durée (jours)', 7, 'Modes de jeu', '', 1, 60), storage: 'app' },
  // --- Communauté (2026-10-15)
  SeasonSkinEnabled: { label: 'Skins saisonniers du site', type: 'bool', def: true, group: 'Saison', storage: 'app', help: 'Pendant un événement du calendrier (Halloween, Noël, Nouvel an, Saint-Valentin, Pâques, Poisson d’avril, Fête de la musique), tout le site prend son habillage (couleurs, police, décor animé). Chaque joueur peut le désactiver pour lui.' },
  PatchNotesExtra: { label: 'Notes de mise à jour : entrées ajoutées', type: 'json', group: 'Site', storage: 'app', help: 'Liste { date : AAAA-MM-JJ, title, items : [texte, …] } affichée en plus de l’historique, page Nouveautés (seulement ce qui est utile aux joueurs).', def: [] },
  StoryEnabled: { label: 'Quêtes d’histoire', type: 'bool', def: true, group: 'Progression', storage: 'app', help: 'Une histoire en chapitres (Milo, Moka, Pepper…) sur l’accueil, après le parcours du débutant.' },
  StoryChapters: { label: 'Quêtes d’histoire : chapitres', type: 'json', group: 'Progression', storage: 'app', help: 'Liste ordonnée { title, who, icon, text, steps : [{ label, type : événement, target }], reward : { BoosterCount, StardustCount, Worms, KeyCount, BoneCount, GoldBait, SpareParts, ChestCount, XP } }. Le dernier donne aussi la carte exclusive et le titre « Héros de 2Gatcha ».', def: [{"title":"Le flair de Milo","who":"Milo","icon":"🐕","text":"Wouf ! Milo gratte le sol en remuant la queue : il a senti quelque chose sous la surface. Aide-le à creuser !","steps":[{"label":"Creuser 15 cases","type":"dig","target":15}],"reward":{"BoneCount":2,"XP":30}},{"title":"Moka a faim","who":"Moka","icon":"🐈","text":"Moka te fixe avec ses grands yeux ronds. Une seule solution : aller pêcher… et partager.","steps":[{"label":"Lancer 5 fois ta ligne","type":"fish","target":5}],"reward":{"Worms":10,"XP":30}},{"title":"Les graines du vieux jardinier","who":"Le jardinier","icon":"👨‍🌾","text":"Un vieux jardinier te confie un sachet de graines : « Ce qui pousse ici nourrit tout le reste, tu verras. »","steps":[{"label":"Récolter 3 plantes","type":"harvest","target":3}],"reward":{"GoldBait":2,"XP":40}},{"title":"L’appel du large","who":"L’explorateur","icon":"🧭","text":"Une vieille carte au trésor, à moitié effacée… Envoie tes cartes explorer les environs pour en retrouver les morceaux.","steps":[{"label":"Revenir de 2 expéditions","type":"expedition","target":2}],"reward":{"KeyCount":1,"XP":40}},{"title":"La machine à boules","who":"Le marchand","icon":"🪙","text":"Un marchand installe une drôle de machine au coin de la rue : « Une pièce, une boule, un coffre. Qui sait ce qu’il y a dedans ? »","steps":[{"label":"Ouvrir 2 coffres du gatchapon","type":"chestOpened","target":2}],"reward":{"ChestCount":2,"XP":40}},{"title":"L’atelier","who":"L’artisane","icon":"🛠️","text":"L’artisane sourit : « Une carte, ça se travaille. Recycle tes doublons, crafte ce qui te manque, et ta collection brillera. »","steps":[{"label":"Recycler 5 doublons","type":"disenchant","target":5},{"label":"Crafter 1 carte","type":"craft","target":1}],"reward":{"SpareParts":1,"StardustCount":200,"XP":50}},{"title":"Les cadenas de Pepper","who":"Pepper","icon":"🔒","text":"Derrière six cadenas, Pepper attend. Chaque booster ouvert te rapproche des clés qui la libéreront.","steps":[{"label":"Ouvrir 10 boosters","type":"boosterOpened","target":10}],"reward":{"KeyCount":2,"XP":60}},{"title":"Le grand 2GETHER","who":"Toute la guilde","icon":"🤝","text":"Toute la guilde se retrouve : il est temps de montrer tout ce que tu as appris. Milo, Moka et Pepper comptent sur toi !","steps":[{"label":"Creuser 20 cases","type":"dig","target":20},{"label":"Lancer 5 fois ta ligne","type":"fish","target":5},{"label":"Revenir d’une expédition","type":"expedition","target":1}],"reward":{"BoosterCount":5,"StardustCount":300,"XP":80}}] },
  StoryCardId: { ...int('Quêtes d’histoire : carte exclusive du dernier chapitre (id)', 0, 'Progression', 'Id d’une carte (promo conseillée, pour qu’elle ne sorte pas des boosters). 0 = seulement le titre.', 0, 1000000), storage: 'app' },
  SeasonQuestXp: { ...int('Défis de saison : XP de saison par défi', 60, 'Saison', '3 défis par semaine (les mêmes pour tous) ; l’XP compte pour les paliers et le coffre du mois, pas pour le niveau du compte. 0 = pas de défis.', 0, 10000), storage: 'app' },
  SeasonQuestAllXp: { ...int('Défis de saison : bonus si les 3 sont réussis', 60, 'Saison', '', 0, 10000), storage: 'app' },
  SurpriseEnabled: { label: 'Événements surprises', type: 'bool', def: true, group: 'Événements', storage: 'app', help: 'De petits événements de quelques heures, jamais annoncés (double XP, frénésie de pêche, soldes du gatchapon…).' },
  SurpriseEventsPerWeek: { ...num('Événements surprises : nombre moyen par semaine', 3, 'Événements', 'Tirage quotidien : chaque jour a cette chance divisée par 7 d’en avoir un.', 0, 7), storage: 'app' },
  SurpriseHours: { ...num('Événements surprises : durée (heures)', 2, 'Événements', '', 0.5, 12), storage: 'app' },
  SurpriseFromHour: { ...int('Événements surprises : début au plus tôt (heure)', 10, 'Événements', '', 0, 23), storage: 'app' },
  SurpriseToHour: { ...int('Événements surprises : début au plus tard (heure)', 21, 'Événements', '', 0, 23), storage: 'app' },
  AccountPrestigeXpPct: { ...num('Prestige du compte : bonus d’XP par étoile (%)', 2, 'Progression', 'Bonus permanent sur toute l’XP gagnée (compte et métiers), plafonné à 10 étoiles.', 0, 20), storage: 'app' },
  StarterEnabled: { label: 'Parcours du débutant et déblocages par niveau', type: 'bool', def: true, group: 'Progression', storage: 'app', help: 'Nouveaux comptes : étapes guidées sur l’accueil (accueil simplifié tant qu’il n’est pas fini) et jeux / pages débloqués par niveau.' },
  StarterSteps: { label: 'Parcours du débutant : étapes', type: 'json', group: 'Progression', storage: 'app', help: 'Liste ordonnée { key, label, icon, type : événement (ou liste), target : nombre (0 = immédiat), url, hint, feature : fonctionnalité qui doit être débloquée, level : niveau requis, reward : { BoosterCount, StardustCount, Worms, KeyCount, BoneCount, XP } }. Événements : boosterOpened, dig, guess, disenchant, craft, fish, expedition, wheel, login, harvest, chestOpened, board, fusion, repair, tradeDone…', def: [{"key":"welcome","label":"Récupère ton kit de départ","icon":"🎁","target":0,"hint":"De quoi ouvrir tes premiers boosters.","reward":{"BoosterCount":3,"StardustCount":100}},{"key":"open1","label":"Ouvre ton premier booster","icon":"🃏","type":"boosterOpened","target":1,"url":"ouverture.html","hint":"1 jeton = 1 booster de 5 cartes, au distributeur.","reward":{"BoosterCount":1,"XP":20}},{"key":"gift","label":"Récupère un cadeau du jour","icon":"🎡","type":["wheel","login"],"target":1,"url":"index.html#rewards-center","hint":"La roue ou le cadeau de connexion, dans « À récupérer ».","reward":{"StardustCount":100}},{"key":"dig","label":"Creuse 5 cases dans la Fouille","icon":"⛏️","type":"dig","target":5,"url":"jeux.html#fouille","feature":"dig","hint":"L’énergie se recharge toute seule.","reward":{"Worms":5,"XP":30}},{"key":"guess","label":"Joue à Devine la carte","icon":"❓","type":"guess","target":1,"url":"jeux.html#devine","feature":"guess","hint":"5 cartes à reconnaître chaque jour.","reward":{"StardustCount":60,"XP":20}},{"key":"open3","label":"Ouvre 3 boosters de plus","icon":"🎴","type":"boosterOpened","target":3,"url":"ouverture.html","reward":{"BoosterCount":2,"XP":30}},{"key":"recycle","label":"Recycle un doublon en poussières","icon":"♻️","type":"disenchant","target":1,"url":"collection.html#decrafter","hint":"Les poussières servent à crafter les cartes qui te manquent.","reward":{"StardustCount":80,"XP":20}},{"key":"craft","label":"Crafte une carte qui te manque","icon":"✨","type":"craft","target":1,"url":"collection.html#crafter","level":2,"reward":{"BoosterCount":1,"XP":40}},{"key":"fish","label":"Pêche une fois","icon":"🎣","type":"fish","target":1,"url":"jeux.html#peche","feature":"fishing","hint":"Les vers se trouvent en creusant.","reward":{"Worms":5,"XP":30}},{"key":"expedition","label":"Envoie une carte en expédition et récupère son butin","icon":"🧭","type":"expedition","target":1,"url":"jeux.html#expedition","feature":"expedition","hint":"La balade de 2 h suffit.","reward":{"BoosterCount":1,"XP":40}}] },
  StarterFinalReward: { label: 'Parcours du débutant : bonus final', type: 'json', group: 'Progression', storage: 'app', help: 'Récompense une fois toutes les étapes faites : { BoosterCount, StardustCount, Worms, KeyCount, BoneCount, XP }.', def: { BoosterCount: 3, StardustCount: 200 } },
  StarterUnlocks: { label: 'Déblocages par niveau (nouveaux comptes)', type: 'json', group: 'Progression', storage: 'app', help: 'Objet { fonctionnalité : niveau de compte } (clés de la liste Admin > Difficultés : shop, vault, trade, dig, guess, expedition, fishing, bingo, dinos, garden, boss, guildChest, blackMarket, auctions, machine, teams, lottery, wanted, duo, evening…). Absente = ouverte dès le niveau 1. Les comptes créés avant la mise en ligne ne sont jamais verrouillés.', def: {"shop":2,"expedition":2,"fishing":2,"garden":3,"bingo":3,"boss":3,"wanted":3,"evening":3,"trade":3,"vault":4,"dinos":4,"guildChest":4,"teams":4,"lottery":4,"duo":5,"blackMarket":5,"machine":5,"auctions":6} },
  StarterSince: { ...int('Déblocages par niveau : comptes concernés à partir de (horodatage)', 0, 'Progression', 'Posé automatiquement au premier démarrage : seuls les comptes créés après sont verrouillés. 0 = reposé au prochain démarrage.', 0, 99999999999), storage: 'app' },
  TestAccountId: { ...int('Compte test admin : id du joueur', 9, 'Administration', 'Compte sur lequel un admin bascule sans Discord (Admin > Compte test) : niveaux, ressources et difficulté propres, isolé des autres joueurs. 0 = désactivé.', 0, 1000000), storage: 'app' },
  ExpeditionDestinations: { label: 'Expédition : destinations', type: 'json', group: 'Jeux', storage: 'app', help: 'Liste { key, name, icon, level : niveau d’expédition requis, desc, loot : { ressource : quantité pour 2 h } }. Ressources : Worms, BoneCount, GoldBait, SpareParts, CatFish, KeyCount, DinoSkulls, ChestCount, minerals. ×2,5 pour 8 h, ×5 pour 24 h ; la partie décimale est une chance.', def: [{"key":"foret","name":"Forêt enchantée","icon":"🌲","level":1,"desc":"Des vers pour la pêche et quelques os pour Milo.","loot":{"Worms":3,"BoneCount":0.4}},{"key":"cote","name":"Côte sauvage","icon":"🏖️","level":1,"desc":"Du poisson pour Moka, des appâts dorés et parfois une pièce détachée.","loot":{"CatFish":2,"GoldBait":0.4,"SpareParts":0.3}},{"key":"mine","name":"Mine abandonnée","icon":"⛏️","level":2,"desc":"Des minéraux pour le comptoir (plus rares si l’expédition est longue).","loot":{"minerals":2}},{"key":"ruines","name":"Ruines antiques","icon":"🏛️","level":3,"desc":"Des clés pour le coffre-fort et des crânes pour les dinos.","loot":{"KeyCount":0.3,"DinoSkulls":0.3}},{"key":"port","name":"Port des pirates","icon":"🏴‍☠️","level":5,"desc":"Des pièces de gatchapon et des pièces détachées.","loot":{"ChestCount":0.35,"SpareParts":0.2}}] },
  ExpeditionUniqueDustPct: { ...int('Expédition : poussières en plus avec une carte Unique (%)', 80, 'Jeux', 'Un explorateur de rareté Unique rapporte ce % de poussières en plus (les autres raretés ont leur propre bonus, de +10 % à +50 %).', 0, 500), storage: 'app' },
  ExpeditionUniqueLootPct: { ...int('Expédition : ressources en plus avec une carte Unique (%)', 60, 'Jeux', 'Ressources de la destination (vers, os, clés, minéraux…) en plus pour un explorateur Unique ; cumulable avec l’affinité du jour.', 0, 500), storage: 'app' },
  ExpeditionUniqueBoosterChance: { ...int('Expédition : chance d’un jeton booster en plus avec une carte Unique (%)', 25, 'Jeux', 'Au retour d’un explorateur Unique, chance d’un jeton booster en plus de ceux de l’expédition.', 0, 100), storage: 'app' },
  ExpeditionAffinityPct: { ...int('Expédition : bonus d’affinité (%)', 50, 'Jeux', 'Chaque jour, chaque destination a une rareté et une extension favorites : un explorateur qui correspond rapporte ce % de ressources en plus (cumulable : rareté + extension).', 0, 500), storage: 'app' },
  MokaHints: {
    label: 'Moka : indices sur ses amis chats (cartes secrètes)', type: 'json', group: 'Salle interdite', storage: 'app',
    help: 'Liste de phrases : Moka en glisse une, au hasard, en P.S. de son rapport de pêche (chance : MokaHintChance).',
    def: [
      'P.S. Pepper ? La dernière fois que je l’ai vu, il était en cage. Six cadenas… et autant de clés à trouver.',
      'P.S. Il paraît qu’une serrure attend là où l’on réclame les codes. Derrière, des amis à moi font la sieste.',
      'P.S. Mr Sterling a le poil brun et adore l’eau. Pour le revoir, il faut d’abord trouver la bonne serrure.',
      'P.S. Ticat est tout blanc : impossible de le voir dans la neige. Il ne se montre qu’aux joueurs qui ont fait du chemin… on dit qu’il arrive tout seul au niveau 10.',
      'P.S. Mes amis ne s’abîment jamais : un chat retombe toujours sur ses pattes.',
      'P.S. Si tu croises un chat que personne n’a jamais vu, ne fais pas de bruit. Il est peut-être secret.'
    ]
  },
  MokaHintChance: { ...pct('Moka : chance d’un indice dans son rapport', 0.35, 'Salle interdite', 'Un P.S. sur ses amis chats en fin de carte postale.'), storage: 'app' },
  SecretCodes: {
    label: 'Codes secrets (Réclamer un code)', type: 'json', group: 'Salle interdite', storage: 'app',
    help: 'Liste { code, label, title?: { key, label }, frame?: { key, label }, color?: { key, label }, give?: { BoosterCount, StardustCount (× indice des prix), KeyCount, ChestCount, BoneCount, CatFish, SpareParts, LuckCharges, Worms, GoldBait }, card?: clé de rareté }. Une fois par joueur, avec une cinématique. Cadres et couleurs : frame-retro, frame-shadow, frame-forbidden, color-pepper, color-ember (en plus de ceux de la boutique).',
    def: [
      { code: '2GETHER', label: 'Le clan', title: { key: 'title-clan', label: 'Membre du clan' }, give: { BoosterCount: 2 } },
      { code: 'KONAMI', label: 'Les anciens', frame: { key: 'frame-retro', label: 'Rétro' }, give: { ChestCount: 3 } },
      { code: 'MILO', label: 'Le chenil', title: { key: 'title-milo', label: 'Ami des chiens' }, give: { BoneCount: 5 } },
      { code: 'MOKA', label: 'Le panier', title: { key: 'title-moka', label: 'Ami des chats' }, give: { CatFish: 5 } },
      { code: 'PEPPER', label: 'La cage', color: { key: 'color-pepper', label: 'Pepper' }, give: { StardustCount: 300 } },
      { code: 'GATCHA', label: 'Le distributeur', give: { BoosterCount: 3 } },
      { code: 'LEGENDE', label: 'La légende', card: 'legendaire' },
      { code: 'MINUIT', label: 'Minuit', title: { key: 'title-noctambule', label: 'Noctambule' }, give: { KeyCount: 2 } },
      { code: 'CHANCE', label: 'Le trèfle', give: { LuckCharges: 5 } },
      { code: 'FORGE', label: 'La forge', color: { key: 'color-ember', label: 'Braise' }, give: { SpareParts: 3 } }
    ]
  },
  ArgScrollChance: { ...pct('Pêche : chance de remonter le parchemin (par lancer)', 0.02, 'Salle interdite', 'Une seule fois par joueur. Le parchemin donne en énigmes l’emplacement des 10 rouages.'), storage: 'app' },
  ForbiddenKeysNeeded: { ...int('Porte interdite : clés spéciales à insérer', 10, 'Salle interdite', 'Une clé spéciale se forge avec 1 clé + 1 de chaque minéral.', 1, 50), storage: 'app' },
  CasinoEnabled: { label: 'Casino de la salle interdite', type: 'bool', def: true, group: 'Salle interdite', storage: 'app', help: 'Blackjack, roulette, chamboule-tout, machine à pinces, Plinko, bonneteau et ticket à gratter, après la porte.' },
  CasinoChipPrice: { ...int('Casino : prix d’un jeton (poussières)', 10, 'Salle interdite', 'Multiplié par l’indice des prix.', 1, 10000), storage: 'app' },
  CasinoCashoutRate: { ...pct('Casino : part rendue quand on revend des jetons', 0.8, 'Salle interdite', '0,8 = un jeton revendu rapporte 80 % de son prix.'), storage: 'app' },
  CasinoMaxBet: { ...int('Casino : mise maximale (jetons)', 100, 'Salle interdite', 'Blackjack, Plinko, bonneteau ; la roulette accepte 5 fois plus au total.', 1, 100000), storage: 'app' },
  CasinoDailyChipsPerLevel: { ...int('Casino : jetons offerts par jour et par niveau VIP', 10, 'Salle interdite', 'Le niveau VIP monte avec les jetons misés.', 0, 10000), storage: 'app' },
  CasinoLots: {
    label: 'Salle interdite : lots du comptoir', type: 'json', group: 'Salle interdite', storage: 'app',
    help: 'Une ligne par lot (key : ne pas changer). label : nom affiché ; price : prix en tickets ; active : false pour le retirer du comptoir. Le contenu de chaque lot (jeton booster, clé, tablette, carte, cosmétique…) reste celui du jeu.',
    def: [
      { key: 'booster', label: 'Jeton booster', price: 40, active: true }, { key: 'key', label: 'Clé de coffre', price: 25, active: true }, { key: 'bait', label: '2 appâts dorés', price: 15, active: true },
      { key: 'part', label: 'Pièce détachée', price: 30, active: true }, { key: 'bone', label: '2 os pour Milo', price: 18, active: true }, { key: 'tablet', label: 'Pierre gravée (tablette rare)', price: 20, active: true },
      { key: 'card', label: 'Carte Interdite (épique ou mieux)', price: 90, active: true }, { key: 'title-flambeur', label: 'Titre « Flambeur »', price: 120, active: true },
      { key: 'title-highroller', label: 'Titre « High roller »', price: 300, active: true }, { key: 'frame-casino', label: 'Cadre « Néon du casino »', price: 220, active: true },
      { key: 'color-casino', label: 'Pseudo « Or du casino »', price: 180, active: true }
    ]
  },
  CasinoFeedThreshold: { ...int('Casino : gain annoncé dans le fil à partir de (jetons)', 500, 'Salle interdite', '', 1, 1000000), storage: 'app' },
  CasinoCanCost: { ...int('Chamboule-tout : prix d’une partie (jetons)', 5, 'Salle interdite', '3 balles.', 1, 10000), storage: 'app' },
  CasinoCanDustPerPoint: { ...int('Chamboule-tout : poussières par point', 2, 'Salle interdite', 'Points : commune 1, rare 2, épique 3, légendaire 5, mythique 8 ; tout par terre = ×2. Tickets : 1 pour 4 points.', 0, 1000), storage: 'app' },
  CasinoClawCost: { ...int('Machine à pinces : prix d’un essai (jetons)', 8, 'Salle interdite', '', 1, 10000), storage: 'app' },
  CasinoClawGrip: { ...pct('Machine à pinces : force de la pince', 0.55, 'Salle interdite', 'Chance d’attraper une capsule pile en dessous (moins si on vise à côté) ; elle peut encore tomber en route.'), storage: 'app' },
  CasinoCupsDaily: { ...int('Bonneteau : parties par jour', 20, 'Salle interdite', '', 1, 1000), storage: 'app' },
  CasinoCupsBoosterBet: { ...int('Bonneteau : mise minimale pour gagner le booster rare', 20, 'Salle interdite', 'Vitesse 2 ou 3, un booster par jour au plus.', 1, 100000), storage: 'app' },
  CasinoScratchCost: { ...int('Ticket à gratter : prix d’un ticket en plus (jetons)', 15, 'Salle interdite', 'Le premier ticket du jour est gratuit.', 1, 10000), storage: 'app' },
  CasinoScratchExtra: { ...int('Ticket à gratter : tickets en plus par jour', 5, 'Salle interdite', '', 0, 100), storage: 'app' },
  ForbiddenSpinCost: { ...int('Machine interdite : prix d’un tour (poussières)', 120, 'Salle interdite', 'Multiplié par l’indice des prix. Un tour gratuit par jour. 120 depuis le 28 octobre (40 avant : la machine rendait plus qu’elle ne coûtait).', 1, 100000), storage: 'app' },
  ForbiddenBoosterDailyCap: { ...int('Machine interdite : jetons booster gagnés par jour au maximum', 15, 'Salle interdite', 'Au-delà, chaque jeton d’un triple 🃏 est payé en poussières (comme une paire de jetons). Le quitte ou double n’est pas compté. 0 = aucun jeton.', 0, 1000), storage: 'app' },
  ForbiddenDecraftMult: { ...num('Machine interdite : valeur de décraft des cartes Interdites', 0.25, 'Salle interdite', '0,25 = une carte en édition Interdite se décrafte pour 25 % de la valeur normale (bonus compris).', 0, 1), storage: 'app' },
  ForbiddenNudgeCost: { ...int('Machine interdite : relancer le rouleau intrus (poussières)', 30, 'Salle interdite', 'Proposé sur une paire ; s’il complète le triple, le gain du triple s’ajoute. Multiplié par l’indice des prix.', 1, 100000), storage: 'app' },
  ForbiddenJackpotSeed: { ...int('Machine interdite : jackpot de départ (poussières)', 2000, 'Salle interdite', 'Montant après chaque jackpot gagné. Multiplié par l’indice des prix.', 0, 1000000), storage: 'app' },
  ForbiddenJackpotShare: { ...num('Machine interdite : part de chaque tour versée au jackpot', 0.25, 'Salle interdite', '0,25 = 25 % du prix de chaque tour payant grossit le jackpot commun à tout le serveur.', 0, 1), storage: 'app' },
  ForbiddenHeatMax: { ...int('Machine interdite : surchauffe (tours sans triple)', 12, 'Salle interdite', 'Après ce nombre de tours sans triple, le suivant est un triple garanti (hors jackpot). 0 = jamais.', 0, 200), storage: 'app' },
  GuessRoundsPerDay: { ...int('Devine la carte : cartes par jour', 5, 'Jeux', 'Mêmes cartes pour tout le monde ; 3 essais par carte, le zoom recule à chaque erreur.', 1, 20), storage: 'app' },
  GuessDust: { ...int('Devine la carte : poussières par carte trouvée', 60, 'Jeux', '100 % au 1er essai, 60 % au 2e, 30 % au 3e (15 % de consolation si ratée). Multiplié par l’indice des prix (inflation), comme la boutique.', 0, 1000), storage: 'app' },
  GuessPerfectDust: { ...int('Devine la carte : bonus de journée parfaite', 200, 'Jeux', 'Toutes les cartes trouvées du premier coup.', 0, 10000), storage: 'app' },
  GuessFinishCoins: { ...int('Devine la carte : pièces de gatchapon en fin de journée', 1, 'Jeux', 'Données quand toutes les cartes du jour sont jouées en gardant la série (assez de bonnes réponses). 0 = aucune.', 0, 20), storage: 'app' },
  GuessStreakMin: { ...int('Devine la carte : bonnes réponses pour garder la série', 3, 'Jeux', 'Tous les 7 jours de série, un jeton booster.', 1, 20), storage: 'app' },
  GuessCouponPct: { ...int('Devine la carte : réduction du bon de craft (%)', 40, 'Jeux', 'Trouver une carte qu’on ne possède pas donne un bon de craft sur cette carte (remboursé après le craft). 0 = pas de bon.', 0, 100), storage: 'app' },
  GuessCouponDays: { ...int('Devine la carte : durée du bon de craft (jours)', 3, 'Jeux', '', 1, 60), storage: 'app' },
  GuildChestDepositsPerDay: { ...int('Coffre de guilde : dépôts par jour', 10, 'Communauté', 'Doublons déposables par joueur et par jour (on garde toujours au moins 1 exemplaire).', 1, 100), storage: 'app' },
  GuildChestTakesPerDay: { ...int('Coffre de guilde : cartes prises par jour', 5, 'Communauté', 'Contre des crédits ou une clé ; la pioche gratuite du jour est en plus.', 1, 100), storage: 'app' },
  GuildChestValues: { label: 'Coffre de guilde : crédits par rareté', type: 'json', group: 'Communauté', storage: 'app', help: 'Crédits gagnés en déposant une carte, par rareté (multipliés par la finition : holo ×1,5, dorée ×2, ghost ×3, diamant ×4, arc-en-ciel ×6, et l’état : bon ×1,2, parfait ×1,5).', def: { commune: 2, rare: 5, epique: 12, legendaire: 30, mythique: 80 } },
  GuildChestTakeMult: { ...num('Coffre de guilde : prix d’une carte (× sa valeur)', 1.2, 'Communauté', 'Prendre une carte coûte sa valeur en crédits × ce nombre.', 0.1, 10), storage: 'app' },
  GuildWorksEnabled: { label: 'Grand Chantier (jeu commun de la semaine)', type: 'bool', def: true, group: 'Communauté', storage: 'app', help: 'Onglet Ensemble : tout le serveur construit un phare en 5 étapes avec des ressources des autres jeux ; NG+1 s’il est fini avant la fin de la semaine, remise à zéro le lundi.' },
  GuildWorksStages: { label: 'Grand Chantier : les étapes', type: 'json', group: 'Communauté', storage: 'app', help: 'Liste d’étapes : label, icon, story, needs { ressource : quantité PAR joueur actif } (dust, worms, bone, part, bait, mineral1 à mineral5, card_commune, card_rare, card_epique, card_legendaire), reward { dust, boosters } pour chaque contributeur de l’étape.', def: [{"label":"Fondations","icon":"🧱","story":"Poser les fondations du phare sur la falaise.","needs":{"dust":400,"mineral1":4,"worms":6},"reward":{"dust":80}},{"label":"La tour","icon":"🏗️","story":"Monter la tour pierre après pierre.","needs":{"dust":500,"bone":1,"card_commune":3},"reward":{"dust":120}},{"label":"L’escalier","icon":"🪜","story":"Un escalier en colimaçon jusqu’au sommet.","needs":{"mineral2":3,"card_rare":2,"worms":8},"reward":{"dust":160}},{"label":"La lanterne","icon":"🏮","story":"Assembler la lanterne et ses lentilles.","needs":{"mineral3":2,"part":0.5,"dust":600},"reward":{"dust":220}},{"label":"La lumière","icon":"🗼","story":"Allumer le phare pour tout le serveur.","needs":{"card_epique":1,"bait":1,"dust":800},"reward":{"dust":300,"boosters":1}}] },
  GuildWorksPlayerShare: { ...num('Grand Chantier : part max d’un joueur par ressource', 0.4, 'Communauté', 'Un joueur apporte au plus cette part de chaque ressource d’une étape (0,4 = 40 %).', 0.05, 1), storage: 'app' },
  GuildWorksGrowth: { ...num('Grand Chantier : objectifs × par niveau NG+', 1.5, 'Communauté', 'Les récompenses augmentent de 25 % par niveau.', 1, 5), storage: 'app' },
  TeamPointsTable: { label: 'Équipes : barème des points', type: 'json', group: 'Communauté', storage: 'app', help: 'Points par action : boosterOpened, fish, board, harvest, bossAttack, expedition, tradeDone, guess, craft, chestOpened, communityDig, wheel, vaultRow.', def: {"boosterOpened":1,"fish":1,"board":3,"harvest":1,"bossAttack":2,"expedition":3,"tradeDone":2,"guess":2,"craft":1,"chestOpened":1,"communityDig":1,"wheel":1,"vaultRow":2} },
  TeamDailyCap: { ...int('Équipes : points max par joueur et par jour', 40, 'Communauté', 'Un seul gros joueur ne peut plus porter son équipe. 0 = sans plafond.', 0, 1000), storage: 'app' },
  TeamMinPoints: { ...int('Équipes : points minimum pour une récompense', 20, 'Communauté', 'Points à apporter dans le mois pour toucher le prix (gagnants) ou la participation.', 1, 10000), storage: 'app' },
  TeamWinDust: { ...int('Équipes : poussières des gagnants', 300, 'Communauté', 'En plus du titre de champion, pour chaque membre actif de l’équipe gagnante.', 0, 100000), storage: 'app' },
  TeamParticipationDust: { ...int('Équipes : poussières de participation', 80, 'Communauté', 'Pour chaque membre actif des autres équipes.', 0, 100000), storage: 'app' },
  TeamWarEnabled: { label: 'Guerre des équipes mensuelle', type: 'bool', def: true, group: 'Communauté', storage: 'app', help: '4 équipes tirées au hasard chaque mois ; toute activité rapporte des points ; l’équipe gagnante reçoit un titre.' },
  LotteryEnabled: { label: 'Loterie du dimanche', type: 'bool', def: true, group: 'Communauté', storage: 'app', help: 'Tickets en poussières, cagnotte tirée le dimanche à 21 h.' },
  LotteryTicketPrice: { ...int('Loterie : prix du ticket', 100, 'Communauté', '', 1, 100000), storage: 'app' },
  LotteryWeeklyCap: { ...int('Loterie : tickets max par joueur et par semaine', 20, 'Communauté', '', 1, 1000), storage: 'app' },
  LotteryBurnPct: { ...num('Loterie : part détruite de chaque ticket', 0.2, 'Communauté', 'Le reste va dans la cagnotte (0,2 = 20 % détruits).', 0, 0.9), storage: 'app' },
  LotterySeed: { ...int('Loterie : cagnotte de départ', 200, 'Communauté', '', 0, 100000), storage: 'app' },
  WantedEnabled: { label: 'Avis de recherche hebdomadaire', type: 'bool', def: true, group: 'Communauté', storage: 'app', help: 'Une carte réclamée par le serveur chaque semaine ; les premiers donateurs sont récompensés et la carte rejoint le coffre de guilde.' },
  WantedSlots: { ...int('Avis de recherche : donateurs récompensés', 5, 'Communauté', '', 1, 100), storage: 'app' },
  WantedRewardDust: { ...int('Avis de recherche : poussières par don', 250, 'Communauté', '', 0, 100000), storage: 'app' },
  DuoExpeditionEnabled: { label: 'Expédition en duo', type: 'bool', def: true, group: 'Communauté', storage: 'app', help: 'Deux joueurs envoient chacun une carte ; plus long, butin partagé plus gros.' },
  DuoExpeditionHours: { ...int('Expédition en duo : durée (heures)', 12, 'Communauté', '', 1, 72), storage: 'app' },
  DuoExpeditionDust: { ...int('Expédition en duo : poussières de base par joueur', 250, 'Communauté', 'Augmentées selon la rareté des deux cartes.', 0, 100000), storage: 'app' },
  // --- Saisons et éditions (seasonal.js, editions.js, phantom.js, 2026-10-15)
  SeasonalEventsEnabled: { label: 'Événements saisonniers (Halloween, Noël…)', type: 'bool', def: true, group: 'Saisons et éditions', storage: 'app', help: 'Thème du site, cadeau du jour, trouvailles saisonnières, boss d’Halloween et de Noël, édition limitée.' },
  EditionChance: { ...num('Édition limitée : chance par carte (mode de jeu)', 0.03, 'Saisons et éditions', 'Chance qu’une carte tirée porte l’édition du mode en cours (Givrée, Tropicale, Prismatique, Braise, Glitch).', 0, 0.5), storage: 'app' },
  SeasonalEditionChance: { ...num('Édition limitée : chance par carte (événement saisonnier)', 0.06, 'Saisons et éditions', 'Pendant un événement saisonnier, l’édition de l’événement remplace celle du mode.', 0, 0.5), storage: 'app' },
  SeasonalDropChance: { ...num('Trouvaille saisonnière : chance par action', 0.25, 'Saisons et éditions', 'Récolte, pêche, fouille : citrouille, flocon, cœur…', 0, 1), storage: 'app' },
  PhantomEnabled: { label: 'Carte fantôme du mois', type: 'bool', def: true, group: 'Saisons et éditions', storage: 'app', help: '5 fragments (pêche, fouille, jardin, boss, salle des machines) reconstituent une carte en édition Fantôme.' },
  PhantomDropChance: { ...num('Carte fantôme : chance de fragment par action', 0.12, 'Saisons et éditions', 'Boss et salle des machines : fragment garanti.', 0, 1), storage: 'app' },
  PhantomCardId: { ...int('Carte fantôme : carte imposée (id)', 0, 'Saisons et éditions', '0 = une carte épique ou mieux tirée au sort chaque mois.', 0, 1000000), storage: 'app' },

  // --- Pilotage de l'inflation (inflation.js)
  PriceIndexEnabled: { label: 'Prix indexés sur la richesse moyenne', type: 'bool', def: true, group: 'Inflation', storage: 'app', help: 'Boutique, os, relances, coffres : les prix suivent le solde moyen des joueurs actifs (14 jours).' },
  WealthReference: { ...int('Richesse de référence (poussières)', 8000, 'Inflation', 'Tant que le solde moyen reste sous ce montant, les prix ne bougent pas. Au-dessus, ils montent (racine carrée du rapport).', 100), storage: 'app' },
  PriceIndexMax: { ...num('Hausse maximale des prix (×)', 2.5, 'Inflation', '2,5 = les prix indexés ne dépassent jamais 2,5 fois leur valeur de base.', 1, 10), storage: 'app' },
  AutoTightDays: { ...int('Mode anti-inflation : jours d’alerte avant activation', 7, 'Inflation', 'Jours d’affilée avec une alerte dans le tableau de l’économie.', 1, 60), storage: 'app' },
  TightCalmDays: { ...int('Mode anti-inflation : jours calmes avant retour à la normale', 3, 'Inflation', '', 1, 60), storage: 'app' },
  InflationModeForce: { ...int('Mode anti-inflation : forçage', 0, 'Inflation', '0 = automatique, 1 = toujours actif, 2 = désactivé. Actif : doublons ÷2, prix +25 %, taxes ×1,5, décraft −10 %.', 0, 2), storage: 'app' },
  RepairEscalationDust: { ...int('Restauration : supplément par restauration de la même carte (semaine)', 25, 'Économie', 'La n-ième restauration d’une même carte dans la semaine coûte (n−1) × ce supplément.'), storage: 'app' },

  // --- Notifications
  PushQuietStart: { ...int('Pas de notification à partir de (heure)', 22, 'Notifications', 'Heure de Paris.', 0, 23), storage: 'app' },
  PushQuietEnd: { ...int('Reprise des notifications à (heure)', 9, 'Notifications', '', 0, 23), storage: 'app' }
};

// Colonnes Config a creer pour les reglages lus par les workflows.
export const schema = {
  AppSettings: { Key: { type: 'Text' }, Value: { type: 'Text' } },
  Config: Object.fromEntries(Object.entries(REGISTRY).filter(([, r]) => r.storage === 'config').map(([k]) => [k, { type: 'Numeric' }]))
};

function appRow(store, key) {
  return store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === 'setting:' + key) : null;
}

// Surcouche temporaire des reglages (mode Chaos, modeextras.js) :
// fn(store, key, raw) -> valeur, ou undefined pour garder la valeur reglee.
// Plusieurs surcouches possibles (Chaos, compte test) : la premiere qui repond gagne.
const overlays = []; let inOverlay = false;
export function setOverlay(fn) { overlays.push(fn); }

// Valeur effective d'un reglage (defaut si jamais regle), surcouche comprise.
export function setting(store, key) {
  if (overlays.length && !inOverlay) {
    inOverlay = true;
    try { for (const fn of overlays) { const o = fn(store, key, () => rawSetting(store, key)); if (o !== undefined) return o; } } finally { inOverlay = false; }
  }
  return rawSetting(store, key);
}

// Valeur reglee, sans surcouche (admin, detection du mode en cours).
export function rawSetting(store, key) {
  const r = REGISTRY[key];
  if (!r) throw new Error('Reglage inconnu : ' + key);
  if (r.storage === 'config') {
    const v = configRow(store)[key];
    return v == null || v === '' || Number(v) === 0 ? r.def : Number(v);
  }
  const row = appRow(store, key);
  if (!row) return r.def;
  try { return JSON.parse(row.Value); } catch (e) { return r.def; }
}

// Validation seule (valeurs par difficulte, presets.js).
export function validateSetting(key, raw) {
  if (!REGISTRY[key]) throw new Error(`Réglage inconnu : ${key}`);
  return validate(key, raw);
}

function validate(key, raw) {
  const r = REGISTRY[key];
  if (r.type === 'bool') return !!raw;
  if (r.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${r.label} : nombre attendu`);
    if (r.min != null && n < r.min) throw new Error(`${r.label} : minimum ${r.min}`);
    if (r.max != null && n > r.max) throw new Error(`${r.label} : maximum ${r.max}`);
    return n;
  }
  if (r.type === 'json') {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(r.def) !== Array.isArray(v) || typeof v !== 'object' || v === null) throw new Error(`${r.label} : format attendu ${Array.isArray(r.def) ? 'liste [...]' : 'objet {...}'}`);
    if (key === 'FishingZones' && (!v.length || v.some((z) => !z || !z.key || !['shore', 'deep'].includes(z.pool || 'shore')) || !v.some((z) => z.key === 'shore') || new Set(v.map((z) => z.key)).size !== v.length)) throw new Error(`${r.label} : chaque lieu a une key unique et un pool shore ou deep, et le rivage (shore) doit exister`);
    if (key === 'DigDepths' && (!v.length || v.length > 8 || v.some((d) => !d || !Array.isArray(d.treasures) || !d.treasures.length || d.treasures.some((t) => !['card', 'rareCard', 'booster', 'bigDust', 'smallDust', 'mineral'].includes(t.reward) || !(Number(t.cells) >= 1) || !(Number(t.n) >= 1)) || d.treasures.reduce((s, t) => s + Number(t.cells) * Number(t.n), 0) > 32))) throw new Error(`${r.label} : chaque profondeur a des trésors connus (reward, cells, n) qui tiennent dans 32 cases`);
    if (key === 'RipenStages' && (!v.length || v.some((s, i) => !s || !s.label || !(Number(s.hours) > 0) || !(Number(s.finish) >= 0) || (i > 0 && Number(s.hours) <= Number(v[i - 1].hours))))) throw new Error(`${r.label} : chaque stade a un label, des heures croissantes et des points de finition`);
    if (key === 'ChestExtraLoot' && v.some((l) => !l || !l.key || !(Number(l.chance) >= 0 && Number(l.chance) <= 1) || !(Number(l.min) >= 1) || !(Number(l.max) >= Number(l.min)))) throw new Error(`${r.label} : chaque ligne { key, chance (0 à 1), min, max (≥ min) }`);
    if (key === 'RipenSlotLevels' && (!v.length || v.some((x) => !(Number(x) >= 1)))) throw new Error(`${r.label} : une liste de niveaux (au moins 1)`);
    if (key === 'PatchNotesExtra' && v.some((n) => !n || !/^\d{4}-\d{2}-\d{2}$/.test(String(n.date || '')) || !n.title || !Array.isArray(n.items) || !n.items.length)) throw new Error(`${r.label} : chaque entrée a une date AAAA-MM-JJ, un titre et une liste de textes`);
    if (key === 'StoryChapters' && v.some((c) => !c || !c.title || !Array.isArray(c.steps) || !c.steps.length || c.steps.some((s) => !s || !s.type || !(Number(s.target) >= 1)) || (c.reward && Object.keys(c.reward).some((k) => !['BoosterCount', 'StardustCount', 'Worms', 'KeyCount', 'BoneCount', 'GoldBait', 'SpareParts', 'ChestCount', 'XP'].includes(k))))) throw new Error(`${r.label} : chaque chapitre a un titre, des objectifs (type, target ≥ 1) et des récompenses connues`);
    if (key === 'StarterSteps' && (v.some((s) => !s || !s.key || !s.label || !(Number(s.target || 0) >= 0) || (Number(s.target) > 0 && !s.type) || (s.reward && Object.keys(s.reward).some((k) => !['BoosterCount', 'StardustCount', 'Worms', 'KeyCount', 'BoneCount', 'XP'].includes(k)))) || new Set(v.map((s) => s.key)).size !== v.length || v.some((s) => s.key === 'final'))) throw new Error(`${r.label} : chaque étape a une key unique (pas « final »), un label, un événement si target > 0 et des récompenses connues`);
    if (key === 'StarterFinalReward' && (Array.isArray(v) || Object.keys(v).some((k) => !['BoosterCount', 'StardustCount', 'Worms', 'KeyCount', 'BoneCount', 'XP'].includes(k)))) throw new Error(`${r.label} : un objet de récompenses connues`);
    if (key === 'StarterUnlocks' && (Array.isArray(v) || Object.values(v).some((x) => !(Number(x) >= 1 && Number(x) <= 200)))) throw new Error(`${r.label} : un objet { fonctionnalité : niveau entre 1 et 200 }`);
    if (key === 'ExpeditionDestinations' && (!v.length || v.some((d) => !d || !d.key || !d.name || !d.loot || !Object.keys(d.loot).length || Object.entries(d.loot).some(([k, n]) => !['Worms', 'BoneCount', 'GoldBait', 'SpareParts', 'CatFish', 'KeyCount', 'DinoSkulls', 'ChestCount', 'minerals'].includes(k) || !(Number(n) >= 0))) || new Set(v.map((d) => d.key)).size !== v.length)) throw new Error(`${r.label} : chaque destination a une key unique, un nom et un butin de ressources connues`);
    if (key === 'MineralValues' && (v.length !== 5 || v.some((x) => !(Number(x) >= 0)))) throw new Error(`${r.label} : il faut 5 nombres positifs`);
    if (key === 'MineralTrades' && v.some((t) => !t || !(Number(t.tier) >= 1 && Number(t.tier) <= 5) || !(Number(t.n) >= 1) || !t.give || !Object.keys(t.give).every((k) => ['BoneCount', 'KeyCount', 'ChestCount', 'BoosterCount', 'Worms', 'GoldBait', 'SpareParts'].includes(k)))) throw new Error(`${r.label} : chaque échange a un palier (1 à 5), un nombre et des ressources connues`);
    if (key === 'TeamPointsTable' && (Array.isArray(v) || Object.values(v).some((x) => !(Number(x) >= 0)))) throw new Error(`${r.label} : un objet { action : points } avec des nombres positifs`);
    if (key === 'GuildWorksStages' && (!v.length || v.some((st) => !st || !st.label || !st.needs || !Object.keys(st.needs).length || Object.entries(st.needs).some(([k, n]) => !/^(dust|worms|bone|part|bait|mineral[1-5]|card_(commune|rare|epique|legendaire))$/.test(k) || !(Number(n) > 0))))) throw new Error(`${r.label} : chaque étape a un label et des besoins connus (quantités positives)`);
    if (key === 'GuildChestValues' && (Array.isArray(v) || Object.values(v).some((x) => !(Number(x) >= 0)))) throw new Error(`${r.label} : un objet { rareté : crédits } avec des nombres positifs`);
    if (key === 'LoginStreakRewards' && v.length !== 7) throw new Error(`${r.label} : il faut exactement 7 jours`);
    if ((key === 'ChestTierWeights' || key === 'ChestTierMults') && (v.length !== 8 || v.some((x) => !(Number(x) >= 0)) || (key === 'ChestTierWeights' && !v.some((x) => Number(x) > 0)))) throw new Error(`${r.label} : il faut 8 nombres positifs (coffre 1 à 8)`);
    if (key === 'ShopCatalog' && (v.some((x) => !x || !x.key || !(Number(x.price) > 0) || (!x.give && !['xpBoost', 'digEnergy', 'fishEnergy', 'gardenRipe', 'expeditionNow'].includes(x.effect))) || new Set(v.map((x) => x.key)).size !== v.length)) throw new Error(`${r.label} : chaque objet a une key unique, un prix > 0 et un give ou un effect connu`);
    if (key === 'DailyBoxLoot' && (!v.length || v.some((x) => !x || !['dust', 'worms', 'bait', 'key', 'part', 'booster', 'chest', 'cosmetic'].includes(x.type) || !(Number(x.weight) > 0)))) throw new Error(`${r.label} : chaque objet a un type connu et un poids > 0`);
    if ((key === 'FishingLoot' || key === 'DeepFishingLoot') && (!v.length || v.some((x) => !x || !['nothing', 'dust', 'bone', 'key', 'booster', 'chest', 'part', 'pearl', 'bait'].includes(x.type) || !(Number(x.weight) > 0)))) throw new Error(`${r.label} : chaque prise a un type connu et un poids > 0`);
    return v;
  }
  return String(raw);
}

function writeSetting(store, key, value) {
  const r = REGISTRY[key];
  if (r.storage === 'config') {
    const cfg = store.getAll('Config')[0];
    if (cfg) store.update('Config', cfg.id, { [key]: value }); else store.create('Config', { [key]: value });
    return;
  }
  const row = appRow(store, key);
  if (row) store.update('AppSettings', row.id, { Value: JSON.stringify(value) });
  else store.create('AppSettings', { Key: 'setting:' + key, Value: JSON.stringify(value) });
}

function listSettings(store) {
  return Object.entries(REGISTRY).map(([key, r]) => {
    const custom = r.storage === 'config' ? (() => { const v = configRow(store)[key]; return !(v == null || v === '' || Number(v) === 0); })() : !!appRow(store, key);
    return { key, label: r.label, group: r.group, type: r.type, help: r.help || '', unit: r.unit || '', min: r.min, max: r.max, step: r.step, def: r.def, value: rawSetting(store, key), custom };
  });
}

// Ecrit plusieurs reglages d'un coup (presets de jeu, presets.js) : tout ou rien.
export function setSettings(store, values) {
  const errors = [];
  const clean = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (!REGISTRY[k]) { errors.push(`Réglage inconnu : ${k}`); continue; }
    try { clean[k] = validate(k, v); } catch (e) { errors.push(e.message); }
  }
  if (!errors.length) for (const [k, v] of Object.entries(clean)) writeSetting(store, k, v);
  return errors;
}

function handleSettings({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  if (body.action === 'set') {
    const values = body.values || {};
    const errors = [];
    const clean = {};
    for (const [k, v] of Object.entries(values)) {
      if (!REGISTRY[k]) { errors.push(`Réglage inconnu : ${k}`); continue; }
      try { clean[k] = validate(k, v); } catch (e) { errors.push(e.message); }
    }
    if (errors.length) return fail('invalid_settings', 400, { errors });
    for (const [k, v] of Object.entries(clean)) writeSetting(store, k, v);
  } else if (body.action === 'reset' && REGISTRY[body.key]) {
    const r = REGISTRY[body.key];
    if (r.storage === 'config') writeSetting(store, body.key, 0);
    else { const row = appRow(store, body.key); if (row) store.delete('AppSettings', row.id); }
  }
  return ok({ settings: listSettings(store) });
}

export const routes = { 'POST admin-settings': handleSettings };
