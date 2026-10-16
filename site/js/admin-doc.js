// Admin > Documentation (2026-10-16) : toutes les fonctionnalites et regles
// metier du jeu. Les chiffres viennent des reglages en direct ({{Cle}} ->
// valeur actuelle de settings.js), les regles par difficulte du registre
// (moderules.js) et les fonctionnalites fermees de la matrice (features.js) :
// la doc reste juste quand on change un reglage.
// A TENIR A JOUR : tout ajout, modification ou suppression d'une fonctionnalite
// ou d'une regle doit etre reporte ici dans le meme changement.

(function () {
  const esc = escHtml;
  const UPDATED = "16 octobre 2026";

  // ---------------------------------------------------------------- contenu
  // {{Cle}} : valeur actuelle du reglage ; {{RULES}}, {{CLOSED}}, {{SETTINGS}} : blocs generes.
  const DOC = [
    { id: "principes", icon: "🧭", title: "Principes généraux", body: `
      <p>2Gatcha est un jeu de collection de cartes à gacha pour l'association. Chaque joueur se connecte avec son compte <strong>Discord</strong> (réservé aux membres du serveur) ; son pseudo reste modifiable.</p>
      <ul>
        <li><strong>Boosters</strong> : la monnaie de tirage. Un booster ouvert donne des cartes d'une extension.</li>
        <li><strong>Poussières d'étoile (✨)</strong> : la monnaie du jeu (craft, boutique, restaurations, taxes…). On en gagne surtout en décraftant, en jouant et avec les doublons.</li>
        <li><strong>Ressources des mini-jeux</strong> : vers de terre (pêche), os (pour Milo, le chien de fouille), clés et coffres, pièces détachées, appâts dorés, engrais, crânes de dinosaure, nourriture des dinos.</li>
        <li><strong>XP et niveau de compte</strong> : chaque action donne de l'XP ; chaque niveau débloque des fonctionnalités et des récompenses.</li>
        <li><strong>Mode de jeu</strong> : le serveur tourne dans une difficulté (Cool, Chill, Medium, Hard ou Chaos) qui change les prix, les gains et active des règles exclusives (voir « Modes de jeu »).</li>
      </ul>
      <p>Toute écriture passe par l'API (une seule requête à la fois, verrou), qui applique les règles : le site n'est qu'un affichage. Les réglages chiffrés sont modifiables dans Réglages &rarr; Réglages avancés ; les valeurs citées dans cette page sont les valeurs <strong>actuelles</strong>.</p>` },

    { id: "cartes", icon: "🃏", title: "Les cartes", body: `
      <h3>Rareté</h3>
      <p>Commune, Rare, Épique, Légendaire, Mythique, plus la rareté <strong>Unique</strong> (verte), qui ne se tire jamais : elle s'obtient au Comptoir Unique (coffre-fort perso). Les poids de tirage, valeurs de décraft et coûts de craft se règlent dans Réglages &rarr; Taux de tirage.</p>
      <h3>Finition</h3>
      <p>Six finitions, de la plus commune à la plus prestigieuse : <strong>Normale, Holo, Dorée, Ghost, Diamant, Arc-en-ciel</strong>. À l'ouverture, chaque carte a {{SpecialFinishChance}} de chance d'avoir une finition spéciale (bonus possibles : heure de chance, maîtrise, talents, booster mûri, coup de chance…). Une finition multiplie la valeur de décraft.</p>
      <h3>État (qualité)</h3>
      <p>Quatre états : <strong>Usé, Abîmé, Bon état, Parfait état</strong>. Il multiplie aussi la valeur de décraft ; le coffre-fort perso n'accepte que le parfait état.</p>
      <h3>Éditions limitées</h3>
      <p>Une « finition » posée <em>par-dessus</em> la finition classique (une carte peut être Arc-en-ciel <em>et</em> Prismatique). À l'ouverture d'un booster, chaque carte a {{EditionChance}} de chance de porter l'édition du mode en cours (❄️ Givrée en Cool, 🌺 Tropicale en Chill, 🔷 Prismatique en Medium, 🔥 Braise en Hard, 👾 Glitch en Chaos), ou {{SeasonalEditionChance}} pendant un événement saisonnier (Feu d'artifice, Coup de cœur, Pastel, Farceuse, Solaire, Maudite, Enneigée). L'édition 👻 Fantôme est réservée à la carte fantôme du mois. Une édition n'est jamais usée (mode Hard) ni consommée sans confirmation (voir « Protection des exemplaires »). L'édition du mode peut être coupée dans Admin &rarr; Difficultés.</p>
      <h3>Numéros de série et cartes spéciales</h3>
      <ul>
        <li>Chaque exemplaire a un numéro unique par carte (#001, #002…). Un numéro libéré (décraft) est réattribué au prochain exemplaire. Le <strong>#001</strong> n'est jamais dépensé en premier.</li>
        <li><strong>Carte promo</strong> : distribuée par code ou par l'admin ; ne se décrafte pas, ne va ni au coffre ni au boss.</li>
        <li><strong>Carte ★</strong> : 3 exemplaires Arc-en-ciel parfait état d'une carte fusionnés (le plus petit numéro est gardé). Décraft ×{{StarDecraftMultiplier}}. Une carte ★ garde l'édition d'un exemplaire fondu.</li>
        <li><strong>God pack</strong> : {{GodPackChance}} de chance qu'un booster ne contienne que des épiques ou mieux. <strong>Booster brillant</strong> : {{ShinyPackChance}}. <strong>Carte bonus</strong> : {{BonusCardChance}} par booster.</li>
        <li><strong>Maître d'une carte</strong> : posséder ses 6 finitions (badge, livre d'or).</li>
        <li><strong>Forgée dans les flammes 🔥</strong> : une carte qui sort <em>Arc-en-ciel</em> d'un booster pendant le mode <strong>Hard</strong> (règle « Finitions forgées »), après avoir survécu au malus qui fait retomber une finition spéciale sur quatre ({{HardFinishLoss}}) en normale. Seule l'ouverture de booster compte : une arc-en-ciel obtenue par fusion, craft, coffre, draft ou relance n'est jamais forgée. Badge 🔥 dans la collection ; jamais prise par la salle des machines ni l'avis de recherche ; pas de bonus chiffré (marque de prestige).</li>
        <li><strong>Cartes secrètes</strong> : une clé (2 % de chance par case de fouille, aussi pour Milo) permet d'ouvrir la serrure cachée de la page Code (5 clics sur le cadeau pour la révéler) ; la clé est consommée, qu'une carte secrète tombe ou non.</li>
        <li><strong>Carte du grand coffre-fort</strong> : une carte promo marquée par l'admin (Cards.IsVault), visible mais enfermée tant qu'on n'a pas <strong>6 clés</strong> ; l'ouvrir débloque aussi le coffre-fort perso.</li>
        <li><strong>Cartes exclusives</strong> : carte du mode de jeu (donnée à la récupération de l'objectif commun, une fois par joueur et par carte), carte de la saison mensuelle (dernier palier), carte fantôme du mois, cartes Unique du Comptoir.</li>
      </ul>` },

    { id: "boosters", icon: "🎁", title: "Obtenir et ouvrir des boosters", body: `
      <h3>D'où viennent les boosters</h3>
      <ul>
        <li>Quêtes du jour ({{DailyQuestRewardBoosters}} boosters) et de la semaine ({{WeeklyQuestRewardBoosters}}).</li>
        <li>Fouille (booster gardé avec une probabilité de {{DigBoosterKeepChance}}, jamais au-delà du plein rendement du jour), coffres, pêche, expéditions, niveaux, sets complets, objectif commun, défis, saison…</li>
        <li>Boutique de boosters : {{BoosterShopPrice}} ✨ le premier de la semaine, +{{BoosterShopIncrease}} à chaque achat suivant, {{BoosterShopWeeklyCap}} par semaine au maximum.</li>
        <li>Fragments de booster gagnés en jouant : {{ShardsPerBooster}} fragments = 1 booster ({{ShardsDailyCap}} fragments par jour au maximum).</li>
        <li>Codes événement (Admin &rarr; Codes & dons).</li>
      </ul>
      <h3>À l'ouverture</h3>
      <ul>
        <li><strong>Pity par rareté</strong> : au-delà d'un nombre de tirages sans une rareté, elle est garantie (multiplicateur {{RarityPityMultiplier}}), en donnant d'abord une carte qui te <em>manque</em>. Le pity historique se règle dans Réglages &rarr; Règles de base.</li>
        <li>Selon le mode : pari du booster et booster à double tranchant (Medium), finitions brûlées / forgées (Hard), doublon porte-bonheur (Chill), boîte à souhaits (Cool), cartes maudites (Hard), mutantes et booster glitché (Chaos), édition limitée du mode : voir « Modes de jeu ».</li>
        <li><strong>Doublons</strong> : chaque doublon rapporte des poussières ({{DuplicateDustCommon}} pour une commune, {{DuplicateDustOther}} au-delà), jusqu'à {{DuplicateDustCapCopies}} exemplaires.</li>
        <li><strong>Booster mûri</strong> : +1 point de finition par jour sans ouverture ({{RipenMaxPoints}} au plus). <strong>Booster mystère</strong> : extension tirée au hasard, +{{MysteryFinishBonus}} de finition.</li>
        <li>+{{XpPerBoosterOpen}} XP par booster ouvert ; les ouvertures remarquables vont dans le fil du serveur, et les tirages Épique, Légendaire et Mythique sont annoncés automatiquement sur Discord une fois la révélation terminée.</li>
        <li>Cinématique selon la rareté (sans fermeture automatique) ; on peut rouvrir parmi trois boosters.</li>
      </ul>` },

    { id: "atelier", icon: "🛠️", title: "Collection et atelier", body: `
      <ul>
        <li><strong>Craft</strong> : créer une carte contre son coût en poussières (par rareté ; en Medium, la Bourse des cartes peut le moduler).</li>
        <li><strong>Décraft</strong> : détruire un exemplaire contre sa valeur (rareté × finition × état), modulée par le <strong>cours du décraft</strong> de la semaine (±{{ExchangeRateSwing}} selon l'offre et la demande de la semaine passée), le bonus « carte rare sur le serveur » (moins de {{RareOnServerCopies}} exemplaires : +{{RareOnServerDecraftBonus}}), les talents, le dé, l'heure de chance… En mode Cool, un décraft s'annule pendant 24 h.</li>
        <li><strong>Fusion de finition</strong> : 5 exemplaires identiques (même carte, même finition) &rarr; 1 exemplaire de la finition suivante. Une pièce détachée remplace un exemplaire. La meilleure qualité sacrifiée est gardée, ainsi que le numéro choisi.</li>
        <li><strong>Restauration</strong> : 3 exemplaires du même état &rarr; 1 de l'état suivant ; un exemplaire manquant peut se payer {{RepairDustPerCopy}} ✨ ; chaque restauration répétée sur la même carte dans la semaine coûte +{{RepairEscalationDust}} ✨.</li>
        <li><strong>Relance de finition</strong> : sur un exemplaire normal, {{FinishRerollChance}} de chance d'obtenir une finition spéciale contre des poussières.</li>
        <li><strong>Autel de sacrifice</strong> : 3 exemplaires &rarr; une carte au hasard de la rareté supérieure.</li>
        <li><strong>Recyclage automatique</strong> : décraft en masse selon des règles (raretés, exemplaires gardés, finitions et états protégés, liste de souhaits) ; ne touche jamais aux #001, ★, assurés, rangés ni éditions.</li>
        <li><strong>Assurance</strong> : {{InsuranceCostPerTier}} ✨ par palier de rareté ; l'exemplaire ne peut plus être décrafté, fusionné, sacrifié, déposé ni échangé. Retirable gratuitement.</li>
        <li>Favoris, vitrine de profil (6 cartes, aussi les cartes protégées), liste de souhaits (alertes quand une carte souhaitée apparaît chez un joueur ou en vente), filtres et tri par rareté, finition, état et <strong>édition</strong> partout (collection, enchères, échanges).</li>
        <li><strong>Améliorations permanentes</strong> (Boutique) : chenil (poussières rapportées par Milo), serre (pousse du jardin), canne (poussières et perles pêchées) ; 5 niveaux chacune, prix doublé à chaque niveau ({{UpgradeBasePrice}} ✨ au départ, indexé sur la richesse moyenne) ; aucune ne crée de booster.</li>
        <li><strong>Fiche d'une carte</strong> : historique de chaque exemplaire (créations, changements de propriétaire, fusions), cote (ventes aux enchères, références décraft / craft), exemplaires en circulation et propriétaires, où l'obtenir, qui la souhaite ; partage d'une image de la carte sur Discord (une fois toutes les {{ShareCardCooldown}} s).</li>
        <li><strong>Journal des tirages</strong> (page dédiée) : chaque carte obtenue et sa source (booster, fouille, coffre, craft, fusion, échange, code…). <strong>Correspondances d'échange</strong> : doublons des autres joueurs qui sont dans ta liste de souhaits, et inversement.</li>
      </ul>
      <p>Les fusions et restaurations demandent de cocher les exemplaires exacts : les exemplaires précieux (#001, arc-en-ciel, parfait état, éditions) ne sont jamais cochés d'office.</p>` },

    { id: "protection", icon: "🛡️", title: "Protection des exemplaires", body: `
      <p>Plusieurs protections se cumulent ; un exemplaire protégé n'est jamais pris par un choix automatique (décraft, fusion, autel, dépôt, boss, échange, contrats, machines…).</p>
      <ul>
        <li><strong>Coffre-fort perso</strong> : l'exemplaire rangé quitte la collection active.</li>
        <li><strong>Assurance</strong> : refusé même choisi à la main.</li>
        <li><strong>Carte ★</strong> : mise de côté sauf choix explicite.</li>
        <li><strong>Édition limitée</strong> : mise de côté sauf choix explicite. Choisie à la main, l'API demande une <strong>confirmation</strong> dès que l'édition va disparaître (décraft, autel, boss, prime, deux éditions fondues ensemble…). Une fusion de finition, une restauration ou une carte ★ <strong>garde l'édition</strong> sur le nouvel exemplaire (celle de l'exemplaire dont le numéro est gardé, sinon la première). Un échange transmet l'exemplaire avec son édition.</li>
        <li><strong>#001</strong> : toujours dépensé en dernier ; jamais usé en Hard ni volé.</li>
      </ul>` },

    { id: "coffre", icon: "🔒", title: "Coffre-fort perso et Comptoir Unique", body: `
      <p>Débloqué en ouvrant le grand coffre-fort (page Jeux). Onglet <strong>Classique</strong> pour les cartes sans édition, et un onglet par <strong>édition limitée</strong> déjà obtenue (il n'apparaît qu'après avoir obtenu une carte de cette édition). Chaque onglet fonctionne pareil : une ligne par carte, 6 emplacements (un par finition), parfait état uniquement.</p>
      <p>Ligne complète : <strong>{{VaultBoostersPerRow}} boosters + {{VaultDustPerRow}} ✨ + 1 Ticket Unique</strong>, une seule fois par carte <em>et par édition</em>. Les cartes promo ne vont pas au coffre. Un exemplaire rangé peut être retiré à tout moment.</p>
      <p><strong>Comptoir Unique</strong> : un Ticket Unique s'échange contre la carte Unique de son choix.</p>` },

    { id: "echanges", icon: "🔄", title: "Échanges et marchés", body: `
      <ul>
        <li><strong>Échanges ciblés</strong> : proposer un exemplaire précis contre une carte à un joueur ; contre-proposition possible. Taxe de {{TradeTaxPerCard}} ✨ par carte (0 en Cool). L'exemplaire proposé par défaut n'est jamais une édition.</li>
        <li><strong>Enchères</strong> : {{AuctionMaxActive}} ventes à la fois, {{AuctionHours}} h, taxe de {{AuctionTaxPct}} sur le prix (0 en Cool, ×1,5 pour les riches en Hard).</li>
        <li><strong>Marché noir</strong> : {{MarketAutoOffers}} offres automatiques par semaine (prix ×{{MarketPriceMultiplier}} du craft, coup de cœur ×{{MarketDealMultiplier}}, {{MarketMaxPurchases}} achats par offre).</li>
        <li><strong>Marché du dimanche</strong> : 4 cartes personnelles à -{{SundayMarketDiscount}} (aussi le mercredi en Chill).</li>
        <li><strong>Coffre de guilde</strong> : dépôt de doublons, pioche gratuite ou avec une clé.</li>
        <li><strong>Avis de recherche</strong> : une carte commune à rare par semaine ; les {{WantedSlots}} premiers donateurs gagnent {{WantedRewardDust}} ✨.</li>
        <li><strong>Contrats de collection</strong> : {{ContractsPerWeek}} contrats par semaine (livrer des exemplaires précis contre des récompenses ; jamais d'édition).</li>
        <li><strong>Cadeaux entre joueurs</strong> : un par jour.</li>
      </ul>` },

    { id: "jeux", icon: "🎮", title: "Les mini-jeux", body: `
      <h3>⛏️ Fouille et Milo, le chien</h3>
      <p>Grilles à creuser avec de l'énergie (1 point toutes les {{DigRegenSeconds}} s) ; plein rendement pour les {{DigFullRewardsPerDay}} premières cases du jour. Trésors : poussières, boosters, vers (terre restante : {{WormsPerLeftoverTile}} par case), très rarement un crâne de dinosaure ({{DinoSkullChance}} par case). <strong>Milo</strong>, le chien de fouille, creuse à ta place avec des os ({{DogBonesPerDay}} par jour, os à {{DogBoneCost}} ✨, prix qui monte de {{BoneWeeklyIncrease}} par semaine). <strong>Mode excité</strong> : {{DogFrenzyBones}} os d'un coup &rarr; {{DogFrenzyBoards}} grilles et un crâne garanti, puis {{DogFrenzyRestHours}} h de repos. Trouvaille quotidienne de Milo.</p>
      <h3>🎣 Pêche</h3>
      <p>{{FishingCost}} ver par lancer, {{FishingDailyCasts}} lancers par jour (+ niveau), plein rendement pour {{FishingFullRewardsPerDay}} lancers. Météo du jour (relançable {{WeatherRerollCost}} ✨), appât doré (aucune prise vide, rares ×2,5), carnet de pêche, tournoi du week-end, eaux profondes au niveau {{DeepFishingLevel}} (coût ×{{DeepFishingCostMult}}). « Tout pêcher » lance jusqu'à 50 fois d'un coup. Prises possibles : rien, poussières, os, clé, booster, coffre, pièce détachée (remplace un exemplaire dans une fusion ou une restauration), appât doré, et en eaux profondes des perles noires. Niveau de pêche (1 à 10 : lancers en plus, moins de prises vides, plus de rares), prestige de pêche, classement de la semaine, prix du tournoi pour les premiers. Avec un dino ou un crâne : {{DinoFoodChance}} de chance par lancer de ramener poisson, algues ou crevette (regroupés à l'affichage).</p>
      <h3>🌱 Jardin</h3>
      <p>Graines à {{GardenPlantCost}} ✨, récolte en {{GardenGrowHours}} h, les plantes fanent après {{GardenWiltHours}} h. Parcelles à {{GardenPlotPrice}} ✨ ({{GardenMaxPlots}} max). Récoltes : vers, appâts dorés ({{GardenBaitChance}}), poussières ; engrais de dino ({{DinoFertilizerBoost}}).</p>
      <h3>🧭 Expéditions</h3>
      <p>Partir quelques heures, revenir avec des poussières et parfois un booster ; accélérer coûte {{ExpeditionRushCost}} ✨. <strong>Expédition en duo</strong> : {{DuoExpeditionHours}} h à deux, butin partagé ({{DuoExpeditionDust}} ✨).</p>
      <h3>🦖 Dinos de compagnie</h3>
      <p>Un crâne + {{DinoHatchBones}} os = un dino (5 au maximum, espèce, couleur et motif au hasard). Satiété, bonheur et propreté baissent avec le temps ; nourris-le (poisson, algues, crevette, vers), joue, caresse, ramasse les cacas (engrais, caca doré {{DinoGoldPoopChance}}). Satiété et bonheur à zéro : il meurt (on récupère ses os). Adulte et content, il fouille pour toi toutes les {{DinoDigHours}} h. Talents par espèce (Tyrannosaure : +25 % de poussières de fouille ; Tricératops : fouille auto 2× plus rapide ; Diplodocus : +1 ver par parcelle ; Stégosaure : plantes qui ne fanent plus ; Vélociraptor : rapporte des os ; Ptérodactyle : rapporte du poisson), œufs (deux adultes heureux, couleurs mélangées, éclosion en 12 h), plat préféré à découvrir, Dinodex (titre « Paléontologue »), couleurs nommées ultra-rares et 3 % de chromatiques, Ptérodactyle saisonnier ({{DinoSeasonalChance}} pendant un événement), accessoires et décorations (bonheur qui baisse moins vite), compagnon d'expédition (jusqu'à +30 % de poussières), dino vedette sur le profil, premières au livre d'or, sommeil la nuit (23 h – 7 h). En Cool : vacances (rien ne baisse, ponte ×2). En Chill : balade d'une heure par jour.</p>
      <h3>🧰 Coffres et clés</h3>
      <p>Un coffre s'achète {{ChestCost}} ✨ (ou se gagne : 1 tous les {{ChestEveryLevels}} niveaux, pêche, boutique…) et s'ouvre avec une clé. Il donne {{ChestDustMin}} à {{ChestDustMax}} ✨, une carte avec {{ChestCardChance}} de chance (une deuxième : {{ChestSecondCardChance}}, finition spéciale : {{ChestSpecialFinishChance}}), un booster avec {{ChestBoosterChance}} (deux : {{ChestDoubleBoosterChance}}). Les clés (2 % par case de fouille, 1 tous les {{KeyEveryLevels}} niveaux, pêche, boutique) servent aussi aux cartes secrètes, au grand coffre-fort (6 clés), à la relance de la roue, au coffre de guilde et au larcin (Hard).</p>
      <h3>Et aussi</h3>
      <ul>
        <li><strong>Roue du jour</strong> : un tirage gratuit par jour (50 % : 10 à 25 ✨ ; 20 % : 50 à 100 ✨ ; 15 % : 1 booster ; 15 % : jackpot 2 boosters + 100 ✨), jamais de carte ; relance contre une clé.</li>
        <li><strong>Devine la carte</strong> : chaque jour, le même zoom sur l'illustration d'une carte pour tout le monde, 4 propositions, un seul essai ; bonne réponse = poussières et série, un booster tous les 7 jours de série.</li>
        <li><strong>Grand coffre-fort</strong> : 6 clés pour libérer sa carte promo ; débloque le coffre-fort perso. <strong>Course aux trésors</strong> : 5 indices cachés sur 5 pages du site (positions propres à chaque joueur), {{TreasureClueDust}} ✨ chacun et un bonus pour les 5.</li>
        <li><strong>Bingo du mois</strong> : grille 5 × 5 commune (case centrale offerte, {{BingoCardCells}} cases cartes, le reste en objectifs), 12 lignes et un carton plein à récupérer, joker à {{BingoJokerPrice}} ✨.</li>
        <li><strong>Découvertes</strong> : la première fois qu'on possède une ressource, une animation la présente (rejouable depuis le menu joueur).</li>
      </ul>` },

    { id: "progression", icon: "📈", title: "Progression", body: `
      <ul>
        <li><strong>Niveau de compte</strong> : 1 coffre tous les {{ChestEveryLevels}} niveaux, 1 clé tous les {{KeyEveryLevels}} ; déblocages par niveau (craft, échanges, autel, restauration, finitions, vitrine, thèmes) dans Réglages &rarr; Règles de base.</li>
        <li><strong>Talents</strong> : 1 point par niveau, 3 branches et des talents ultimes ; remise à zéro {{TalentResetCost}} ✨. <strong>Prestige du compte</strong> à partir du niveau {{AccountPrestigeLevel}} (étoile tous les {{AccountPrestigeStep}} niveaux).</li>
        <li><strong>Métiers</strong> : niveaux de pêche, fouille, expédition et jardin (1 à 10, bonus à chaque niveau), prestige de métier, classement de la semaine.</li>
        <li><strong>Maîtrise des extensions</strong> (3 couches, +{{MasteryFinishBonusPerLevel}} de finition par niveau), <strong>constellations</strong> ({{ConstellationDust}} ✨ chacune), rang de compte.</li>
        <li><strong>Succès</strong> (dont secrets, {{HiddenAchievementDust}} ✨), maîtrises I/II/III, <strong>collections thématiques</strong> ({{ThemeRewardDust}} ✨ + titre), <strong>sets complets</strong> ({{SetRewardBoosters}} boosters + {{SetRewardDust}} ✨).</li>
        <li><strong>Saison mensuelle</strong> : {{SeasonTiers}} paliers de {{SeasonXpPerTier}} XP, carte exclusive au dernier palier, coffre de saison ouvert le mois suivant.</li>
        <li><strong>Série de connexion</strong> (cycle de 7 jours, gel de série à {{StreakFreezeCost}} ✨), cosmétiques (titres, cadres, couleurs de pseudo), livre d'or des premières.</li>
        <li><strong>Récompenses par niveau</strong> : un tableau réglable dans l'admin (poussières, boosters, carte) ; passer du niveau n au niveau n+1 coûte 50 × n XP ; +1 booster bonus par niveau franchi.</li>
        <li><strong>Badges</strong> : achetés et affichés à côté du pseudo. <strong>Titres et cadres de progression</strong> gagnés en jouant (paliers d'activité), titres de mode, de saison et d'événements.</li>
        <li><strong>Profil public</strong> (vitrine, dino vedette, succès, mur de messages), <strong>carte de joueur</strong> au survol d'un pseudo, <strong>statistiques perso</strong> (grand livre des poussières, tirages, activité), classements (collection, métiers, Hard, bingo…).</li>
      </ul>` },

    { id: "quotidien", icon: "📅", title: "Rendez-vous quotidiens", body: `
      <ul>
        <li>Boîte du jour, dé du jour, quêtes du jour et de la semaine, défis de la semaine (5 proposés, 3 choisis, +{{ChallengeBonusBoosters}} booster en bonus).</li>
        <li><strong>Action du jour</strong> : XP ×{{HouseXpMultiplier}} sur une activité. <strong>Heure de chance</strong> : +{{LuckyHourDustBonus}} de poussières et +{{LuckyHourFinishBonus}} de finition pendant une heure (deux en Chill).</li>
        <li>Missions du soir ({{EveningMissionDust}} ✨), bonus de retour après {{ReturnerMinDays}} jours d'absence, récapitulatif de la semaine, « Que faire maintenant ? ».</li>
      </ul>` },

    { id: "communaute", icon: "🌍", title: "Communauté", body: `
      <ul>
        <li><strong>Boss commun</strong> : on sacrifie jusqu'à {{BossMaxCards}} exemplaires précis en salve (+{{BossVolleyStep}} de multiplicateur par carte, finition et état comptent) ; le coup final rapporte {{BossFinisherBoosters}} boosters, tout le monde partage la récompense.</li>
        <li><strong>Objectif commun</strong> : un objectif collectif ; atteint, chacun reçoit {{CommunityGoalDust}} ✨ et la pluie de boosters tombe.</li>
        <li><strong>Grande fouille commune</strong> : {{CommunityDigPerDay}} cases par jour, grand trésor partagé ({{GrandTreasureDust}} ✨, {{GrandTreasureBoosters}} booster).</li>
        <li><strong>Guerre des équipes</strong> : chaque mois, 4 équipes équilibrées marquent des points par activité ; titre de champion à l'équipe gagnante le 1er du mois.</li>
        <li><strong>Loterie du dimanche</strong> : ticket {{LotteryTicketPrice}} ✨, {{LotteryWeeklyCap}} par semaine, {{LotteryBurnPct}} de la mise détruite (anti-inflation), cagnotte tirée le dimanche à 21 h, reportée s'il n'y a pas de joueur.</li>
        <li><strong>Salle des machines</strong> (une fois par mois) : 5 sacrifices successifs (clés, poussières + vers, pièces + appâts, boosters, doublons — jamais un #001, un assuré, une ★, une édition, une forgée, une arc-en-ciel ni un parfait état), puis un vote pour le mode du mois suivant (Chaos compris), appliqué automatiquement. Étape 6 « Surchauffe » facultative (vote double), jauge commune ({{MachinePressureGoal}} salles terminées = 1 booster par participant), titre et cadre de chef mécanicien jusqu'au mois suivant, assiduité (3 mois d'affilée = une carte ou 3 boosters), second vote pour l'événement du 2e week-end du mois suivant.</li>
        <li>Fil du serveur en direct, profils et murs.</li>
      </ul>` },

    { id: "economie", icon: "💰", title: "Économie et inflation", body: `
      <ul>
        <li><strong>Cible</strong> : {{BoosterTargetPerDay}} boosters créés par joueur actif et par jour, <strong>codes de jeu exclus</strong> (un code offre souvent 20 boosters d'un coup). Fourchette jusqu'à {{EconomyAlertBoostersPerPlayer}} (seuil d'alerte), et autant en dessous de la cible (20 à 60 par défaut). Alerte aussi si les poussières gagnées dépassent {{EconomyAlertDustRatio}} fois les poussières dépensées. La recommandation de mode suit cette fourchette (au-dessus : Hard ; en dessous : Chill, très en dessous : Cool).</li>
        <li><strong>Index des prix</strong> : les prix en poussières suivent le solde moyen des joueurs actifs (référence {{WealthReference}} ✨, ×{{PriceIndexMax}} au plus).</li>
        <li><strong>Mode anti-inflation</strong> automatique après {{AutoTightDays}} jours d'alerte (doublons ÷2, prix +25 %, taxes ×1,5, décraft -10 %), levé après {{TightCalmDays}} jours calmes.</li>
        <li>Taxes d'échange et d'enchère (redistribuées en Hard via la taxe de luxe), journal détaillé et tableau de bord dans Admin &rarr; Économie.</li>
        <li><strong>Boutique d'objets</strong> (catalogue réglable, plafonds par semaine, prix indexés) : vers, appât doré, os, coffre, clé, pièce détachée, élixir de chance (finitions), potion d'XP, café du fouilleur, engrais, boussole d'expédition, parapluie (Hard) ; boutique de cosmétiques (titres, cadres, couleurs de pseudo) et de badges.</li>
      </ul>` },

    { id: "modes", icon: "🎲", title: "Modes de jeu (difficultés)", body: `
      <p>Cinq difficultés : <strong>😎 Cool</strong> (détente, beaucoup de boosters), <strong>🌴 Chill</strong> (généreux), <strong>⚖️ Medium</strong> (équilibré, valeurs par défaut), <strong>🔥 Hard</strong> (serré, contre l'inflation) et <strong>👾 Chaos</strong> (base Medium + une règle surprise par jour). Passer dans un mode applique d'un coup ses réglages chiffrés (Admin &rarr; Économie ou Difficultés). Changement programmable avec préavis ({{ModeNoticeHours}} h), ou voté chaque mois dans la salle des machines. Chaque mode a sa carte exclusive (objectif commun) et ses succès.</p>
      <p><strong>Skin du site</strong> : chaque difficulté a son habillage complet (palette, police des titres, arrondis, fond animé, panneaux), appliqué automatiquement à tous les joueurs selon le mode en cours. Medium garde le skin d'origine ; 😎 Cool : glacier (bleu givré, flocons, verre dépoli, police Fredoka) ; 🌴 Chill : lagon au coucher du soleil (turquoise et ambre, lucioles, police Righteous) ; 🔥 Hard : volcan (rouge braise, cendres qui montent, coins vifs, police Black Ops One) ; 👾 Chaos : glitch néon (magenta et cyan, lignes de balayage, titres décalés, police Silkscreen). Un joueur qui a choisi un thème cosmétique (Monochrome, Sépia, Cyberpunk) le garde. Les couleurs de rareté, de finition et d'édition des cartes ne changent jamais.</p>
      <p><strong>Cinématique de changement de mode</strong> : à sa première visite après un changement de difficulté, chaque joueur connecté voit l'écran partir de la couleur de l'ancien mode, puis le nouveau skin s'ouvrir en cercle avec ses particules (flocons, lucioles, étoiles, braises ou pixels). Ensuite apparaissent le nom du mode lettre par lettre dans sa police et ses couleurs, une phrase d'accroche et ses principales règles actives (6 au plus, puis « + N autres »), ainsi que la carte exclusive du mode s'il y en a une. Elle propose « Voir le mode du moment » et « C'est parti ! ». Un clic accélère l'intro, un second ferme ; jamais de fermeture automatique, et elle n'est jouée qu'une fois par changement. Prévisualisable dans Admin &rarr; Prévisualiser les animations.</p>
      <p>Chaque règle ci-dessous ne joue que dans son mode et peut être coupée dans <strong>Admin &rarr; Difficultés</strong> (✅ active, ⛔ désactivée). Toutes les exclusivités interactives sont regroupées pour les joueurs sur la page <strong>Mode du moment</strong>.</p>
      {{RULES}}
      <h3>Détails des règles historiques</h3>
      <ul>
        <li><strong>Câlin du jour</strong> (Cool) : à la première visite du jour, 40 % : 3 vers ; 35 % : 30 ✨ ; 25 % : 2 fragments de booster.</li>
        <li><strong>Décraft annulable</strong> (Cool) : pendant 24 h, rendre les poussières reçues récupère l'exemplaire (même numéro s'il est libre).</li>
        <li><strong>Pêche sans prise vide, Milo généreux (2 trouvailles par jour), jardin magique</strong> (plus de fanaison, 20 % de récoltes rares), <strong>échanges et enchères sans taxe</strong> (Cool).</li>
        <li><strong>Deux heures de chance</strong>, <strong>pity ×2 le samedi et le dimanche</strong>, <strong>marché aussi le mercredi</strong>, <strong>4e défi</strong> (et 2 fragments par défi récupéré), <strong>doublon porte-bonheur</strong> ({{ChillLuckyDuplicateChance}} d'un doublon remplacé par une carte manquante de même rareté) (Chill).</li>
        <li><strong>Pari du booster</strong> (Medium) : miser {{BoosterBetStake}} ✨ à l'ouverture ; une épique ou mieux = mise triplée, sinon perdue. <strong>Contrat de la semaine</strong> : un objectif personnel (épiques, boosters, grilles, récoltes, pêche, échanges), 1 booster et le titre « Contractuel ». <strong>Double tranchant</strong> : 3 cartes au lieu de 5, une rare ou mieux garantie. <strong>Coup de chance</strong> : le n-ième booster du jour (n entre 1 et 4, propre à chaque joueur) a ses chances de finition doublées.</li>
        <li><strong>Usure des doublons</strong> (Hard) : une fois par jour, {{HardWearChance}} de chance qu'un doublon perde un cran d'état (jamais un #001, un assuré, une ★, un rangé ni une édition) ; le <strong>parapluie</strong> de la boutique ({{UmbrellaPrice}} ✨) protège {{UmbrellaDays}} jours.</li>
        <li><strong>Finitions forgées</strong> (Hard) : {{HardFinishLoss}} des finitions spéciales tirées retombent en normale ; les arc-en-ciel restantes sont « forgées dans les flammes » (voir « Les cartes »).</li>
        <li><strong>Boss enragé</strong> (Hard) : dégâts divisés par 2, récompense ×3. <strong>Marché noir brûlant</strong> : offres de 3 jours au plus, 1 achat pour le coup de cœur et 2 pour les autres.</li>
        <li><strong>Taxe de luxe</strong> (Hard) : un joueur plus riche que la moyenne des actifs paie ses taxes ×{{LuxuryTaxMultiplier}} ; la cagnotte est redistribuée chaque lundi à parts égales aux joueurs actifs de la semaine.</li>
        <li><strong>Succès de survie</strong> (Hard) : titre « Survivant 🔥 » pour une légendaire (ou mieux) tirée en Hard, Cadre infernal après 7 jours joués en Hard. <strong>Classement Hard</strong> : points par action (grille 3, expédition 3, booster 2, boss 2, échange 2, coffre 2, pêche, récolte, devinette et craft 1), remis à zéro à chaque passage en Hard.</li>
        <li><strong>Règle du jour</strong> (Chaos) : chaque jour à minuit (heure de Paris), une règle parmi les 9 ci-dessous s'applique à tout le serveur, jamais deux jours de suite la même (tirée au hasard, ou votée la veille si la « Règle votée » est active). Elle modifie temporairement des réglages et peut fermer des fonctionnalités ; elle est annoncée dans le bandeau en haut du site.
          <ul>
            <li>🎣 <strong>Frénésie de pêche</strong> : lancer à moitié prix, deux fois plus de lancers à plein rendement ; le jardin est fermé.</li>
            <li>✨ <strong>Pluie d'étoiles</strong> : les doublons rapportent deux fois plus de poussières.</li>
            <li>🤝 <strong>Marché libre</strong> : aucune taxe d'échange ni d'enchère ; le marché noir est fermé.</li>
            <li>🧩 <strong>Tempête de fragments</strong> : un booster coûte deux fois moins de fragments (2 au minimum), plafond de fragments par jour doublé.</li>
            <li>🧰 <strong>Soldes des coffres</strong> : coffres à moitié prix, mais boosters de la boutique deux fois plus chers.</li>
            <li>🍀 <strong>Fête de la chance</strong> : la rareté garantie par le pity arrive deux fois plus vite ; la boutique de boosters est fermée.</li>
            <li>⚡ <strong>Heure de pointe</strong> : accélérer une expédition et changer la météo sont gratuits, os de Milo à moitié prix.</li>
            <li>🔒 <strong>Nuit des secrets</strong> : les succès secrets rapportent trois fois plus de poussières.</li>
            <li>🌑 <strong>Panne générale</strong> : fouille et pêche fermées, mais doublons ×1,5 en poussières.</li>
          </ul>
        </li>
        <li><strong>Pour tous les modes</strong> : carte exclusive du mode, succès de mode (« Zen absolu » 7 jours en Cool, « Vacancier » 50 boosters en Chill, « Survivant de l'enfer » 7 jours en Hard, « Tueur de géants » boss avec 10 cartes en Hard, « Agent du chaos » 5 règles différentes), Cadre « Toutes saisons » après 5 jours joués en Cool, Chill, Medium et Hard, annonce du changement de mode, recommandation de mode dans l'admin (selon la cible de boosters et l'inflation).</li>
      </ul>
      <h3>Détails des exclusivités</h3>
      <ul>
        <li><strong>Boîte à souhaits</strong> (Cool) : une carte de la liste de souhaits par semaine, remplace la carte la moins rare d'un des 10 boosters suivants (chance 1/n restant, garantie au 10e).</li>
        <li><strong>Atelier gratuit / Seconde chance</strong> (Cool) : une fois par jour chacun ; la seconde chance ne vise qu'une carte du dernier booster de moins de 24 h et garde finition, état et édition.</li>
        <li><strong>Vacances des dinos</strong> (Cool) : jauges figées, délai de ponte et d'éclosion divisés par 2 ; au début et à la fin, tous les dinos sont « figés » pour ne rien compter en retard.</li>
        <li><strong>Happy hour</strong> (Chill) : -30 % de 18 h à 19 h sur la boutique d'objets et la boutique de boosters.</li>
        <li><strong>Jardin partagé</strong> (Chill) : un arrosage toutes les 2 h par joueur ; objectif = 4 × joueurs actifs (20 à 80) ; récolte : 25 ✨ par arrosage (300 max) et 1 booster dès 3 arrosages.</li>
        <li><strong>Balade du dino</strong> (Chill) : 1 h, une fois par jour et par dino (pas la nuit) : 20 à 60 ✨, 1 à 3 vers, de la nourriture, 8 % d'os, +15 bonheur.</li>
        <li><strong>Bourse des cartes</strong> (Medium) : coefficient = racine(moyenne des exemplaires par carte / exemplaires de la carte), borné entre ×0,7 et ×1,6, appliqué au décraft et au craft.</li>
        <li><strong>Draft</strong> (Medium) : 2 à 4 joueurs, 1 booster misé chacun (rendu si annulé avant le départ), 5 cartes par booster misé, pioche en serpent, pioche automatique de la plus rare après 10 min.</li>
        <li><strong>Quête en chaîne</strong> (Medium) : 5 étapes par semaine tirées parmi pêche, fouille, boosters, jardin, expédition, boss, devinettes, coffre, craft ; 120 ✨ par étape, 2 boosters + titre « Aventurier » à la fin.</li>
        <li><strong>Ironman</strong> (Hard) : serment possible dans les 48 premières heures ; décraft refusé tant qu'il court ; récompense (5 boosters, titre, Cadre d'acier) à la première visite après la fin du Hard ; renoncer est possible, sans récompense.</li>
        <li><strong>Prime de chasse</strong> (Hard) : une carte épique ou mieux pendant 3 jours ; le premier qui en livre un exemplaire non protégé gagne 4 boosters et 500 ✨ ; une nouvelle prime 1 h après.</li>
        <li><strong>Cartes maudites</strong> (Hard) : 5 % des cartes tirées (jamais une édition) ; purification = 2 × valeur de décraft (30 ✨ min) ; sinon -1 cran d'état à l'échéance de 48 h.</li>
        <li><strong>Larcin</strong> (Hard) : 1 clé par tentative, 35 % de réussite, 3 tentatives par jour, une cible volée 2 fois par jour au plus ; seulement un doublon (≥ 2 exemplaires) non assuré, hors coffre, non ★, sans édition, pas le #001. Victime prévenue ; un raté lui rapporte 20 ✨.</li>
        <li><strong>Tempêtes</strong> (Hard) : un jour sur deux environ, 3 h entre 9 h et 21 h, la pêche ou la fouille est fermée (annonce 2 h avant).</li>
        <li><strong>Règle votée</strong> (Chaos) : 3 règles proposées pour demain (jamais celle d'aujourd'hui) ; la plus votée gagne, sinon le hasard.</li>
        <li><strong>Cartes mutantes</strong> (Chaos) : 10 % des cartes tirées mutent dans 1 à 24 h (finition ou état ±1, 55 % en mieux).</li>
        <li><strong>Boosters glitchés</strong> (Chaos) : 20 % des ouvertures ajoutent une carte de n'importe quelle extension, en édition Glitch.</li>
        <li><strong>Carte instable</strong> (Chaos) : une par période Chaos (rare ou mieux, édition Glitch) ; change chaque jour de carte (même rareté) et de finition, se fige à la fin du Chaos ; ni volable ni comptée dans les protections automatiques.</li>
        <li><strong>Chasse aux bugs</strong> (Chaos) : 5 bugs par joueur et par jour cachés dans les pages, 25 ✨ chacun.</li>
      </ul>
      <h3>Fonctionnalités fermées selon le mode</h3>
      <p>Matrice modifiable dans Admin &rarr; Économie. Fermée = masquée sur le site et refusée par l'API.</p>
      {{CLOSED}}` },

    { id: "evenements", icon: "🎉", title: "Événements et saisons", body: `
      <ul>
        <li><strong>Week-ends événement</strong> : poussières ×N et finitions ×N (Admin &rarr; Événements), événements planifiés.</li>
        <li><strong>Heure dorée</strong> hebdomadaire : finitions ×{{GoldenHourFinishMultiplier}}, annoncée la veille. <strong>Pluie de boosters</strong> : {{BoosterRainBoosters}} booster par joueur quand l'objectif commun est atteint.</li>
        <li><strong>Événements saisonniers</strong> (Nouvel an, Saint-Valentin, Pâques, Poisson d'avril, Fête de la musique, Halloween, Noël) : thème du site, cadeau du jour (avec un « sort » possible), trouvailles en jouant ({{SeasonalDropChance}} par action), boss d'Halloween et de Noël créé tout seul, édition saisonnière, costumes des dinos et Ptérodactyle.</li>
        <li><strong>Carte fantôme du mois</strong> : 5 fragments ({{PhantomDropChance}} par action dans 5 activités) &rarr; la carte en Ghost et édition Fantôme.</li>
        <li>Calendrier des événements dans Communauté.</li>
      </ul>` },

    { id: "admin", icon: "🛠️", title: "Administration et sécurité", body: `
      <ul>
        <li>Admins : comptes Discord listés côté serveur (ADMIN_DISCORD_IDS) ; jeton admin du serveur pour la base de données.</li>
        <li>Jeton de session signé ({{AuthTokenDays}} jours) ; limite de {{RateLimitWritesPerMinute}} écritures et {{RateLimitReadsPerMinute}} lectures par minute et par joueur.</li>
        <li>Pages : codes & dons, économie (mode de jeu, matrice des fonctionnalités, journal), difficultés, événements, contenu (cartes, saisons, bingo, boss), réglages (taux, règles de base, réglages avancés), site (maintenance, sauvegardes).</li>
        <li>Notifications push (silence de {{PushQuietStart}} h à {{PushQuietEnd}} h).</li>
        <li>Outils : codes événement (boosters ou carte, expiration, nombre d'utilisations), dons directs à un joueur, remise à zéro d'un compte, extensions et cartes, récompenses par niveau, saison et carte du mois, boss, bingo, simulateur d'ouverture (calcul pur, sans écriture), bandeau du site et mode maintenance (les non-admins sont redirigés), prévisualisation des cartes et des animations.</li>
        <li><strong>Cette documentation doit être mise à jour à chaque ajout, modification ou suppression d'une fonctionnalité ou d'une règle.</strong></li>
      </ul>` },

    { id: "reglages", icon: "⚙️", title: "Annexe : tous les réglages", body: `<p>Valeurs actuelles, par thème (modifiables dans Réglages &rarr; Réglages avancés).</p>{{SETTINGS}}` }
  ];

  // ---------------------------------------------------------------- rendu
  let settings = new Map(), rules = null;
  function fmt(s) {
    if (!s) return "?";
    const v = s.value;
    if (typeof v === "boolean") return v ? "oui" : "non";
    if (typeof v !== "number") return Array.isArray(v) ? v.length + " éléments" : "…";
    if (/probabilit/.test(s.unit || "") || (v > 0 && v < 1 && !/Multiplier|Mult$|Swing|Step/.test(s.key))) return (Math.round(v * 1000) / 10).toLocaleString("fr-FR") + " %";
    return v.toLocaleString("fr-FR");
  }
  const value = (key) => `<span class="adoc-val" title="${esc(key)}${settings.get(key)?.custom ? " (modifié)" : ""}">${fmt(settings.get(key))}</span>`;

  function rulesBlock() {
    if (!rules) return "<p class=\"muted\">Règles indisponibles.</p>";
    return rules.modes.map((m) => `<h3>${m.icon} ${esc(m.label)}${m.current ? " <small>(mode en cours)</small>" : ""}</h3>
      <ul class="adoc-rules">${m.rules.map((r) => `<li class="${r.on ? "" : "is-off"}">${r.on ? "✅" : "⛔"} ${r.icon} <strong>${esc(r.label)}</strong>${r.isNew ? " <em>(exclusivité)</em>" : ""} : ${esc(r.desc)}</li>`).join("")}</ul>`).join("");
  }
  function closedBlock() {
    if (!rules) return "";
    return `<div class="table-scroll"><table class="admin-table"><tbody>${rules.modes.map((m) => `<tr><th>${m.icon} ${esc(m.label)}</th><td>${m.closed.length ? m.closed.map((f) => `${f.icon} ${esc(f.label)}`).join(", ") : "tout est ouvert"}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function settingsBlock() {
    const groups = new Map();
    settings.forEach((s) => { if (!groups.has(s.group)) groups.set(s.group, []); groups.get(s.group).push(s); });
    return [...groups.entries()].map(([g, list]) => `<details class="adoc-settings"><summary>${esc(g)} (${list.length})</summary><div class="table-scroll"><table class="admin-table"><tbody>${list.map((s) => `<tr><td>${esc(s.label)}${s.help ? `<br><small class="muted">${esc(s.help)}</small>` : ""}</td><td class="num">${fmt(s)}${s.custom ? " ✎" : ""}</td></tr>`).join("")}</tbody></table></div></details>`).join("");
  }
  function fill(html) {
    return html.replace(/\{\{RULES\}\}/g, rulesBlock).replace(/\{\{CLOSED\}\}/g, closedBlock).replace(/\{\{SETTINGS\}\}/g, settingsBlock).replace(/\{\{(\w+)\}\}/g, (_, k) => value(k));
  }

  function render(filter = "") {
    const box = document.getElementById("doc-zone");
    if (!box) return;
    box.classList.remove("empty-state");
    const q = filter.trim().toLowerCase();
    const sections = DOC.map((s) => ({ ...s, html: fill(s.body) }));
    const shown = q ? sections.filter((s) => (s.title + " " + s.html.replace(/<[^>]+>/g, " ")).toLowerCase().includes(q)) : sections;
    box.innerHTML = `
      <div class="adoc-tools">
        <input type="search" id="doc-search" placeholder="Chercher dans la documentation (ex. édition, pity, larcin…)" value="${esc(filter)}" aria-label="Chercher dans la documentation" />
        <span class="muted">Mise à jour : ${UPDATED} · valeurs en direct</span>
      </div>
      <nav class="adoc-toc" aria-label="Sommaire">${shown.map((s) => `<a href="#doc-${s.id}" data-doc-jump="${s.id}">${s.icon} ${esc(s.title)}</a>`).join("")}</nav>
      ${shown.map((s) => `<section class="adoc-section" id="doc-${s.id}"><h2>${s.icon} ${esc(s.title)}</h2>${s.html}</section>`).join("") || '<p class="muted">Rien ne correspond à cette recherche.</p>'}`;
    const input = document.getElementById("doc-search");
    input.addEventListener("input", () => { const pos = input.selectionStart; render(input.value); const again = document.getElementById("doc-search"); again.focus(); again.setSelectionRange(pos, pos); });
  }

  async function load() {
    try {
      const [st, mr] = await Promise.all([
        API.post("adminSettings", { discordId: Session.discordId, action: "get" }),
        API.post("adminModeRules", { discordId: Session.discordId, action: "status" }).catch(() => null)
      ]);
      settings = new Map((st.settings || []).map((s) => [s.key, s]));
      rules = mr;
      render();
    } catch (err) {
      const box = document.getElementById("doc-zone");
      if (box) box.innerHTML = `<p class="error-box">Documentation indisponible : ${esc(friendlyError(err))}</p>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const box = document.getElementById("doc-zone");
    if (!box) return;
    if (typeof AdminNav !== "undefined" && AdminNav.onFirstShow) AdminNav.onFirstShow("doc", load); else load();
    box.addEventListener("click", (e) => {
      const a = e.target.closest("[data-doc-jump]");
      if (!a) return;
      e.preventDefault();
      document.getElementById("doc-" + a.dataset.docJump)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
})();
