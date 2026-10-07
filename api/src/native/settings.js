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
  DuplicateDustCommon: { ...int('Poussières par doublon commun', 5, 'Boosters', 'Gagnées automatiquement à l’ouverture.'), storage: 'app' },
  DuplicateDustOther: { ...int('Poussières par doublon (rare et plus)', 10, 'Boosters', ''), storage: 'app' },

  // --- Coffres
  ChestCost: { ...int('Prix d’un coffre (poussières)', 100, 'Coffres', '', 1), storage: 'app' },
  ChestEveryLevels: { ...int('Un coffre offert tous les N niveaux', 5, 'Coffres', '0 = jamais.'), storage: 'app' },
  KeyEveryLevels: { ...int('Une clé offerte tous les N niveaux', 10, 'Coffres', '0 = jamais.'), storage: 'app' },
  ChestDustMin: { ...int('Poussières minimum', 40, 'Coffres', ''), storage: 'app' },
  ChestDustMax: { ...int('Poussières maximum', 120, 'Coffres', ''), storage: 'app' },
  ChestCardChance: { ...pct('Chance d’une carte', 0.7, 'Coffres', ''), storage: 'app' },
  ChestSecondCardChance: { ...pct('Chance d’une 2e carte', 0.2, 'Coffres', ''), storage: 'app' },
  ChestBoosterChance: { ...pct('Chance d’un booster', 0.35, 'Coffres', ''), storage: 'app' },
  ChestDoubleBoosterChance: { ...pct('Chance de 2 boosters', 0.08, 'Coffres', ''), storage: 'app' },
  ChestSpecialFinishChance: { ...pct('Chance de finition spéciale (cartes du coffre)', 0.15, 'Coffres', ''), storage: 'app' },

  // --- Peche
  FishingCost: { ...int('Vers de terre par lancer', 1, 'Pêche', 'Les vers se trouvent dans la terre restante à la fin d’une fouille.', 1), storage: 'app' },
  WormsPerBoard: { ...int('Vers par grille de fouille terminée', 2, 'Pêche', 'Gagnés quand tous les trésors d’une grille sont trouvés (joueur ou chien).'), storage: 'app' },
  WormsPerLeftoverTile: { ...int('Vers par case de terre restante', 2, 'Pêche', 'En plus, pour chaque case jamais creusée à la fin de la grille.'), storage: 'app' },
  StarterWorms: { ...int('Vers offerts au lancement', 5, 'Pêche', 'Donnés une seule fois à chaque joueur existant, pour pouvoir pêcher tout de suite.'), storage: 'app' },
  FishingDailyCasts: { ...int('Lancers par jour', 20, 'Pêche', '0 = illimité. +2 par niveau de pêche au-dessus du 1.'), storage: 'app' },
  FishingTourneyPrizes: { label: 'Tournoi de pêche : poussières des premiers', type: 'json', group: 'Pêche', storage: 'app', help: 'Liste : poussières du 1er, du 2e, du 3e… Le 1er reçoit aussi le titre « Roi de la pêche ».', def: [500, 300, 150] },
  GardenGrowHours: { ...int('Jardin : heures de pousse', 4, 'Pêche', '', 1, 48), storage: 'app' },
  GardenPlantCost: { ...int('Jardin : prix d’une plantation (poussières)', 10, 'Pêche', ''), storage: 'app' },
  GardenBaitChance: { ...pct('Jardin : chance d’un appât doré par récolte', 0.5, 'Pêche', 'Un appât doré supprime les prises vides et multiplie les prises rares pour un lancer.'), storage: 'app' },
  FishingLevelXpStep: { ...int('XP pour le niveau 2 de pêche', 15, 'Pêche', 'Chaque niveau suivant demande ce palier en plus (15, 45, 90…). 1 XP par lancer, plus selon la prise.', 1), storage: 'app' },
  FishingLoot: {
    label: 'Table des prises', type: 'json', group: 'Pêche', storage: 'app',
    help: 'Liste de prises : type (nothing, dust, bone, key, booster, chest, part = pièce détachée, remplace un exemplaire en Finitions / Qualité), poids (chance relative), min/max (quantité).',
    def: [
      { type: 'nothing', weight: 28, label: 'Une vieille botte' },
      { type: 'dust', weight: 30, min: 10, max: 45 },
      { type: 'bone', weight: 18, min: 1, max: 1 },
      { type: 'booster', weight: 11, min: 1, max: 1 },
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
  ChallengeBonusBoosters: { ...int('Défis : boosters si les 3 défis sont accomplis', 1, 'Défis et objectifs', ''), storage: 'app' },
  CommunityGoalScale: { ...num('Objectif commun : difficulté', 1, 'Défis et objectifs', '1 = normal, 2 = deux fois plus dur (l’objectif s’adapte aussi au nombre de joueurs).', 0.2, 10), storage: 'app' },
  CommunityGoalDust: { ...int('Objectif commun : poussières par participant', 250, 'Défis et objectifs', ''), storage: 'app' },
  CommunityGoalWorms: { ...int('Objectif commun : vers par participant', 5, 'Défis et objectifs', ''), storage: 'app' },
  HiddenAchievementDust: { ...int('Succès secret : poussières', 50, 'Défis et objectifs', 'Gagnées à chaque succès secret débloqué.'), storage: 'app' },
  ThemeRewardDust: { ...int('Collection thématique : poussières', 300, 'Défis et objectifs', 'En plus du titre, à chaque collection thématique réclamée.'), storage: 'app' },
  CommunityDigPerDay: { ...int('Grande fouille : coups de pioche par jour', 5, 'Défis et objectifs', ''), storage: 'app' },
  GrandTreasureDust: { ...int('Grande fouille : poussières du grand trésor (par participant)', 150, 'Défis et objectifs', ''), storage: 'app' },
  GrandTreasureBoosters: { ...int('Grande fouille : boosters du grand trésor (par participant)', 1, 'Défis et objectifs', 'Le découvreur en reçoit un de plus.'), storage: 'app' },

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
      { key: 'color-rainbow', type: 'color', label: 'Pseudo arc-en-ciel', price: 4000 }
    ]
  },

  // --- Economie
  TradeTaxPerCard: { ...int('Taxe d’échange (poussières par carte)', 10, 'Économie', 'Payée par celui qui propose l’échange. 0 = pas de taxe.'), storage: 'app' },
  BoneWeeklyIncrease: { ...num('Hausse du prix de l’os par achat dans la semaine', 0.25, 'Économie', '0,25 = +25 % par os acheté, remis à zéro le lundi.', 0, 5), storage: 'app' },
  DuplicateDustCapCopies: { ...int('Doublons : exemplaires avant plafond', 10, 'Économie', 'À partir de ce nombre d’exemplaires, un doublon ne rapporte plus que 1 poussière. 0 = pas de plafond.'), storage: 'app' },
  FishingFullRewardsPerDay: { ...int('Pêche : lancers à plein rendement par jour', 15, 'Économie', 'Au-delà, poussières divisées par 2 et objets moins fréquents. 0 = désactivé.'), storage: 'app' },
  DigFullRewardsPerDay: { ...int('Fouille : cases à plein rendement par jour', 40, 'Économie', 'Au-delà, poussières trouvées divisées par 2. 0 = désactivé.'), storage: 'app' },
  WeatherRerollCost: { ...int('Relance de la météo de pêche (poussières)', 80, 'Économie', 'Une fois par jour.'), storage: 'app' },
  ExpeditionRushCost: { ...int('Retour accéléré d’expédition (poussières)', 120, 'Économie', 'Divise le temps restant par 2, une fois par jour.'), storage: 'app' },
  RepairDustPerCopy: { ...int('Restauration : poussières par exemplaire manquant', 60, 'Économie', 'Dans l’atelier Qualité, des exemplaires manquants peuvent être payés en poussières (au moins une vraie carte).', 1), storage: 'config' },
  MarketAutoEnabled: { label: 'Marché noir automatique', type: 'bool', def: true, group: 'Économie', storage: 'app', help: 'Chaque lundi, des offres sont générées automatiquement (comme le bingo du mois).' },
  MarketAutoOffers: { ...int('Marché noir : offres par semaine', 4, 'Économie', '', 1, 12), storage: 'app' },
  MarketPriceMultiplier: { ...num('Marché noir : prix (× coût de craft)', 1.5, 'Économie', '', 0.2, 10), storage: 'app' },
  MarketDealMultiplier: { ...num('Marché noir : prix du coup de cœur (× coût de craft)', 0.8, 'Économie', '', 0.1, 10), storage: 'app' },
  MarketMaxPurchases: { ...int('Marché noir : achats max par offre', 3, 'Économie', '', 1, 50), storage: 'app' },
  EconomyAlertBoostersPerPlayer: { ...num('Alerte : boosters créés par joueur actif et par jour', 3, 'Économie', 'Au-delà, alerte dans le tableau de bord de l’économie.', 0.5, 100), storage: 'app' },
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
  DogBoneCost: { ...int('Prix d’un os (poussières)', 150, 'Fouille', 'Envoie le chien creuser 2 h.', 1), storage: 'config' },
  DigLevelXpStep: { ...int('XP pour le niveau 2 de fouille', 20, 'Fouille', 'Chaque niveau suivant demande ce palier en plus (20, 60, 120…). 1 XP par case, +5 par trésor.', 1), storage: 'config' },
  VaultBoostersPerRow: { ...int('Coffre-fort : boosters par ligne complète', 6, 'Coffre-fort perso', ''), storage: 'config' },
  VaultDustPerRow: { ...int('Coffre-fort : poussières par ligne complète', 200, 'Coffre-fort perso', ''), storage: 'config' },

  // --- Progression longue (2026-10-07)
  MasteryFinishBonusPerLevel: { label: 'Maîtrise : finition spéciale en plus par niveau', type: 'number', def: 0.005, min: 0, max: 0.05, step: 0.001, group: 'Progression', storage: 'app', help: '0,005 = +0,5 point de chance de finition spéciale par niveau de maîtrise au-dessus du 1, sur les boosters de cette extension.' },
  MasteryLevelDust: { ...int('Maîtrise : poussières par niveau atteint', 40, 'Progression', 'Récompense du niveau N = N × cette valeur.'), storage: 'app' },
  MasteryLayerRewards: { label: 'Maîtrise : récompenses des 3 couches complètes', type: 'json', group: 'Progression', storage: 'app', help: 'cards (toutes les cartes), qualities (tous les états de chaque carte), finishes (toutes les finitions de chaque carte) : dust, boosters.', def: { cards: { dust: 300, boosters: 1 }, qualities: { dust: 800, boosters: 2 }, finishes: { dust: 1500, boosters: 3 } } },
  TalentResetCost: { ...int('Talents : prix de la remise à zéro (poussières)', 500, 'Progression', ''), storage: 'app' },
  ConstellationDust: { ...int('Constellations : poussières par étoile allumée', 150, 'Progression', ''), storage: 'app' },
  ConstellationSkyBoosters: { ...int('Constellations : boosters du ciel complet', 10, 'Progression', 'Donnés une fois quand les 40 étoiles sont allumées (avec un titre).'), storage: 'app' },
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
  AuctionTaxPct: { ...pct('Enchères : taxe sur la vente', 0.1, 'Économie', 'Prélevée sur le prix final (détruite).'), storage: 'app' },
  AuctionMaxActive: { ...int('Enchères : ventes en cours max par joueur', 3, 'Économie', '', 1, 20), storage: 'app' },
  AuctionHours: { ...int('Enchères : durée (heures)', 24, 'Économie', '', 1, 168), storage: 'app' },
  ExchangeRateSwing: { ...num('Cours du décraft : variation max', 0.15, 'Économie', '0,15 = la valeur de décraft d’une rareté varie de −15 % à +15 % selon l’offre et la demande de la semaine passée.', 0, 0.5), storage: 'app' },
  InsuranceCostPerTier: { ...int('Assurance : prix par rang de rareté', 40, 'Économie', 'Commune = 1 rang, rare = 2… Payé une fois.'), storage: 'app' },
  BoosterShopPrice: { ...int('Boutique : prix d’un booster (poussières)', 300, 'Économie', '', 1), storage: 'app' },
  BoosterShopIncrease: { ...num('Boutique : hausse par booster acheté dans la semaine', 0.2, 'Économie', '', 0, 5), storage: 'app' },
  BoosterShopWeeklyCap: { ...int('Boutique : boosters max par semaine', 3, 'Économie', '0 = boutique fermée.'), storage: 'app' },
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

// Valeur effective d'un reglage (defaut si jamais regle).
export function setting(store, key) {
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
    if (key === 'LoginStreakRewards' && v.length !== 7) throw new Error(`${r.label} : il faut exactement 7 jours`);
    if (key === 'DailyBoxLoot' && (!v.length || v.some((x) => !x || !['dust', 'worms', 'bait', 'key', 'part', 'booster', 'chest', 'cosmetic'].includes(x.type) || !(Number(x.weight) > 0)))) throw new Error(`${r.label} : chaque objet a un type connu et un poids > 0`);
    if (key === 'FishingLoot' && (!v.length || v.some((x) => !x || !['nothing', 'dust', 'bone', 'key', 'booster', 'chest', 'part'].includes(x.type) || !(Number(x.weight) > 0)))) throw new Error(`${r.label} : chaque prise a un type connu et un poids > 0`);
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
    return { key, label: r.label, group: r.group, type: r.type, help: r.help || '', unit: r.unit || '', min: r.min, max: r.max, step: r.step, def: r.def, value: setting(store, key), custom };
  });
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
