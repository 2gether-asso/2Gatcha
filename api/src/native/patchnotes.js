// Notes de mise a jour (2026-10-18) : tout ce qui a change pour les joueurs
// depuis la creation de 2Gatcha (pas les correctifs techniques ni l'admin).
// Page nouveautes.html ; le colis de retour (daily.js) en tire ses nouvelles.
// L'admin peut en ajouter (setting PatchNotesExtra), affichees en premier.
//   GET /webhook/patch-notes -> { notes: [{ date, title, items }], latest }

import { ok } from './common.js';
import { setting } from './settings.js';

export const PATCH_NOTES = [
  { date: '2026-11-16', title: 'Compagnons V2', items: [
    'Une page Compagnons (menu Monde) : fiches, missions, souvenirs, amitiés et concours',
    'Tes compagnons ont un niveau (1 à 30) : ils gagnent de l’XP en travaillant, en se promenant, en mission et avec tes câlins, et deviennent plus rapides et plus généreux',
    'Au niveau 15, chacun choisit une voie (changeable contre des poussières) avec 3 compétences, dont une compétence active au niveau 30',
    'Chaque jour, chaque compagnon a une envie : devine-la pour doubler l’affection gagnée',
    'Missions de 2, 4 ou 8 h, seul ou en duo : butin, fragments d’équipement, souvenirs, parfois un coffre. Pendant la mission, il ne travaille pas dans son jeu (sa session reprend à son retour)',
    'Équipement : collier, outil et porte-bonheur, en 3 paliers',
    'Album de souvenirs par lieu, amitiés entre compagnons et concours de la semaine (titre « Ami des bêtes »)',
    'Deux nouvelles compagnes à apprivoiser : Praline la tortue (coffre-fort) et Réglisse la chouette (ouverture de boosters, la nuit)',
    'Poivre le rat s’installe aux fourneaux : donne-lui du fromage et il cuisine pour toi avec les ingrédients du garde-manger (les commandes du jour d’abord)',
    'Une barre du compagnon identique dans chaque jeu : niveau, affection, envie du jour, gestes et compétence active'
  ] },
  { date: '2026-11-16', title: 'Coffres V2', items: [
    'Chaque coffre du gatchapon a maintenant une famille : Collectionneur (des cartes, et des cartes que tu n’as pas encore), Explorateur (minéraux, tablettes), Nature (jardin et cuisine), Compagnons (friandises de tes compagnons) et Fortune (poussières et jetons)',
    'Les pièces de couleur font tomber une boule de la famille de ton choix',
    'Trois clés : la clé ordinaire ouvre jusqu’au coffre du voyageur, la clé d’or tous les coffres avec un bonus. Le serrurier les fabrique : clé ordinaire = 150 poussières, une pièce détachée et 3 minéraux communs ; clé d’or = 500 poussières, 3 clés ordinaires et un Or',
    'Une nouvelle ouverture : le coffre tremble, la clé tourne, les objets sortent un par un, le meilleur en dernier, et plusieurs coffres s’ouvrent en cascade',
    'Collection de coffres : chaque famille et chaque palier ouverts pour la première fois rapportent un bonus, et les 40 un titre',
    'Des coffres ailleurs : coffres enfouis de la fouille profonde, expéditions longues, pourboires de la cuisine, boss vaincus, légendes et grand chelem du carnet des métiers, Comptoir des maîtres et coffre-fort'
  ] },
  { date: '2026-11-16', title: 'Progression : 100 talents, la branche Gardien', items: [
    'L’arbre de talents compte maintenant 100 points : chaque branche gagne un deuxième palier (10 points) et un grand ultime (19 points)',
    'Nouvelle branche 🛡️ Gardien : intérêts du coffre-fort, dinos, distributeur de l’enclos et Milo. Son grand ultime, l’Ange gardien, empêche tes dinos de mourir',
    'Six nouvelles améliorations permanentes : Coffre blindé, Pioche affûtée, Pinceau d’archéologue, Four de chef, Trémie du distributeur et Boussole',
    'Coffre-fort perso : le rendement des intérêts s’améliore (talents Banquier et Protecteur, Coffre blindé), et avec le talent Épargnant les jours non récupérés s’accumulent',
    'Tes talents déjà appris sont gardés : les nouveaux points t’attendent',
    'Le niveau maximum du coffre-fort suit maintenant le nombre de cartes du jeu : le dernier niveau demande toute la collection rangée dans ses 6 finitions, et recule à chaque nouvelle extension. Les récompenses de palier déjà prises restent acquises',
    'Le coffre-fort monte maintenant jusqu’au niveau 100 : Coffre de fer I à X, Coffre renforcé I à X… jusqu’au Trésor légendaire. Des poussières à chaque niveau, des boosters tous les 5 niveaux et des intérêts qui grimpent jusqu’à 120 ✨ par jour'
  ] },
  { date: '2026-11-16', title: 'Coffre-fort : un écrin', items: [
    'Ceux qui savent sertir des pierres sur leurs cartes trouveront un écrin dans leur coffre-fort : une place par minéral, des points de prestige et des récompenses'
  ] },
  { date: '2026-11-16', title: 'Distributeur automatique pour l’enclos', items: [
    'Installe un distributeur dans l’enclos de tes dinos et remplis-le avec ta nourriture : il nourrit tout seul un dino qui a faim, même quand tu n’es pas là',
    'Tant qu’il reste des portions, aucun dino ne meurt de faim. Trois niveaux : plus de place, plat préféré d’abord, puis un peu de bonheur à chaque repas',
    'L’accueil te prévient quand il est presque vide'
  ] },
  { date: '2026-11-16', title: 'Le carnet des métiers', items: [
    'Chaque semaine, 2 contrats par métier (fouille, pêche, jardin, archéologie, cuisine) en trois paliers bronze, argent et or : poussières, ressources et jetons de maître',
    'Une légende cachée par métier et par semaine : un fossile, un poisson, une plante, une tablette, un plat… à débusquer en jouant, garantie si tu insistes',
    'Les 10 contrats en or : grand chelem et un titre',
    'Le Comptoir des maîtres échange tes jetons contre des appâts dorés, des tablettes, des pièces détachées, un crâne de dinosaure…',
    'Le carnet est au village, et chaque métier rappelle ses contrats en haut de son onglet'
  ] },
  { date: '2026-11-16', title: 'Atelier : un mode rapide plus malin', items: [
    'Options du rapide : compléter une fusion avec une pièce détachée, une restauration avec des poussières (dans la limite que tu choisis)',
    'Avec la porte de la salle ouverte, « Tout en rapide » peut aussi transmuter en Doré ou en Diamant les cartes qui n’ont pas encore cette finition, sans toucher tes exemplaires précieux'
  ] },
  { date: '2026-11-16', title: 'Ouverture des boosters : finitions', items: [
    'Les titres de rareté, le bilan et ses compteurs retrouvent la police du jeu',
    'Les boutons du bilan ont tous la même taille et ne recouvrent plus les cartes'
  ] },
  { date: '2026-11-15', title: 'Le pass de saison se réinvente', items: [
    'Dès décembre, le pass compte 100 paliers, avec une récompense à chaque palier : poussières, un coffre tous les 5, un booster et une clé tous les 10, et toujours la carte et le titre de la saison au bout',
    'Chaque jour, 3 missions du jour courtes (ouvrir 3 boosters, creuser 10 cases, récolter 3 plantes…) donnent de l’XP de saison, en plus de l’XP gagnée en jouant',
    'Le pass se joue sur tout le mois : en faisant tes missions chaque jour, tu le finis en 28 jours. Un jour manqué se rattrape en partie avec l’XP de jeu mise en réserve',
    'Novembre se termine avec le pass actuel ; les missions du jour comptent déjà',
    'Progression : le pass complet et tes métiers (niveau de chaque jeu) ont leur onglet'
  ] },
  { date: '2026-11-15', title: 'Mes chiffres', items: [
    'Tes statistiques et ton journal d’ouvertures sont réunis dans « Mes chiffres » (menu du compte) : un onglet Résumé, un onglet Ouvertures',
    'La boutique ne garde que ce qui s’achète : les améliorations permanentes sont dans Progression, avec les talents'
  ] },
  { date: '2026-11-15', title: 'Communauté : trois espaces', items: [
    '« En ce moment » en haut de la Communauté : boss, objectif commun, vote de la salle des machines, enchères, marché noir et échanges à traiter, d’un coup d’œil, et les dernières nouvelles du serveur',
    'Trois espaces : Événements (calendrier, boss, ensemble, salle des machines), Commerce (enchères, marché noir, coffre de guilde et tes échanges) et Entre joueurs (équipes, classements, tableau d’affichage)',
    'Les échanges se rejoignent depuis le Commerce, avec le nombre d’échanges qui t’attendent, et la page Échanges ramène au Commerce'
  ] },
  { date: '2026-11-15', title: 'Accueil : ma journée', items: [
    'En haut de l’accueil, ta journée en trois tuiles : tes récompenses (tout récupérer d’un geste), ce qui est prêt au village (direction la tournée) et tes boosters à ouvrir',
    '« À faire maintenant » passe en premier : la prochaine chose utile, d’un coup d’œil',
    'Mes objectifs regroupe tout : quêtes du jour et de la semaine, défis, contrat, missions du soir, saison et série de connexion, avec une pastille là où une récompense t’attend',
    'Aujourd’hui (boîte, dé, heures de chance) et la roue passent sur le côté ; succès, activité et direct restent repliés en bas'
  ] },
  { date: '2026-11-15', title: 'Jeux : bienvenue au village', items: [
    'La page Jeux s’ouvre sur le village : la carte, et l’état de chaque lieu (prêt, en cours, à faire) d’un coup d’œil',
    '« Faire ma tournée » : récolte du jardin, trouvailles et cacas des dinos, dinos rentrés de balade, expédition, trouvaille de Milo et rapports de Noisette et Pistache, tout d’un bouton, avec un bilan',
    'Tes compagnons au même endroit : le travail qu’il leur reste sur 24 h, et de quoi les remettre au travail en un geste',
    'Ton sac : toutes les ressources des jeux, à quoi elles servent et où en trouver',
    'Dans chaque jeu, un bouton « ← Village » pour revenir (toujours visible sur téléphone)',
    'Le jeu passe avant le reste : la grille, la scène de pêche ou le jardin s’affichent tout de suite, le niveau, la boutique et le compagnon en dessous',
    'Sur téléphone, les jeux s’ouvrent en plein écran : boutons principaux à portée de pouce, grille de fouille entière à l’écran'
  ] },
  { date: '2026-11-15', title: 'Vos avis, appliqués', items: [
    'Compagnons : Milo, Moka, Noisette et Pistache peuvent tous avoir 24 h de travail devant eux, de quoi les laisser travailler toute la nuit',
    'Dinos : « Tout nourrir » (le plat préféré s’il est connu, sinon ce dont il te reste le plus, sans vider tes réserves), « Jouer avec tous » et, en mode Chill, « Tous en balade »',
    'Légendaire garantie : un seul compteur pour toutes les extensions, booster mystère compris, comme pour les autres raretés',
    'Miel : nouvelle graine « Fleurs mellifères » au jardin (niveau 3), et bien plus de miel en promenade dans la prairie et la clairière',
    'Fruits exotiques : la graine tropicale en donne 2 ou 3, et la promenade à la plage en rapporte plus souvent',
    'Machine interdite : une paire de crânes rapporte maintenant deux os',
    'Fouille : le bouton « Tout fouiller » est toujours visible, même avec un seul point d’énergie',
    'Cuisine : la marmite te dit ce qui manque et où le trouver avant de lancer la cuisson'
  ] },
  { date: '2026-11-13', title: 'Ouverture de boosters, nouvelle version', items: [
    'Les boosters s’ouvrent un par un : chaque booster se déchire, ses cartes jaillissent et se posent face cachée, tu les retournes dans l’ordre que tu veux',
    'Une belle carte passe au centre de l’écran en grand ; une légendaire ou mieux a toujours sa cinématique',
    'Le booster résiste quand il cache quelque chose de bien… et la meilleure carte se fait attendre',
    'La jauge de légendaire garantie avance en direct pendant l’ouverture',
    'Un bilan à la fin : ta meilleure carte (à partager), tes nouvelles cartes, tes poussières et la progression de tes extensions',
    'Pressé ? « Tout révéler », « Passer au bilan » ou le mode « Auto » pour les gros lots',
    'Collection : sur ordinateur, la fiche d’une carte s’ouvre maintenant au centre de l’écran'
  ] },
  { date: '2026-11-07', title: 'Collection et coffre-fort, nouvelle version', items: [
    'Collection : un bandeau plus court, le Classeur pour regarder tes cartes et l’Atelier pour les transformer, avec ce que tu peux faire tout de suite sous chaque outil',
    'Une vignette par carte : ses autres exemplaires sont dans sa fiche, qui s’ouvre sur le côté avec le tableau de toutes ses finitions et états',
    'Étoiles de maîtrise sur chaque carte, et une colonne des extensions pour sauter de l’une à l’autre',
    'Pages d’album : chaque page complétée rapporte une récompense, à récupérer dans l’album',
    'Coffre-fort : il monte de niveau quand tu ranges des cartes, chaque palier rapporte une récompense et des intérêts en poussières chaque jour',
    'Ranger devient simple : le coffre te montre tout ce qui peut y aller et ce que ça rapporte, tu coches et c’est rangé',
    'Le coffre s’ouvre sur un tiroir par extension, et l’onglet Vitrine permet de choisir l’ordre des 6 cartes de ton profil',
    'Le site répond plus vite : les pages chargent leurs informations bien plus rapidement'
  ] },
  { date: '2026-11-02', title: 'Les vacances s’installent partout', items: [
    'Les activités du mode Chill sont maintenant là où tu joues : la plage et ton château de sable dans la Fouille, le lagon dans la Pêche, la sieste sur l’accueil, les cartes postales depuis la fenêtre d’une carte…',
    'Marées : à marée haute les poissons rares mordent plus, à marée basse le lagon rend des coquillages',
    'Château de sable : bâtis le tien avec le sable de la plage, et participe au château commun du serveur',
    'La bibliothèque engloutie : 12 fragments d’une histoire à retrouver au lagon, sur la plage et en promenade',
    'Nouvelle promenade à la plage, préférée de Moka',
    'Amis, titres de vacances et carnet exotique (poissons, coquillages, fragments) sur ton profil',
    'La carte exclusive du mode explique enfin comment l’obtenir : participe à l’objectif commun, puis récupère ta part',
    '« Tout récupérer » prend aussi les défis de saison et les vacances ; chaque notification t’emmène au bon endroit',
    'Recherche : les artistes et les onglets du jeu ; cinématiques possibles seulement pour les épiques et plus',
    'Le résumé d’ouverture met en avant ta meilleure carte',
    'Le site se met à jour tout seul quand quelqu’un t’envoie quelque chose, et ta collection reste consultable hors ligne',
    'Pages de jeu et collection plus légères à charger',
    'Kiosque de la plage sur ton profil : cadres, couleurs et titres de vacances à garder toute l’année'
  ] },
  { date: '2026-11-02', title: 'Les artistes tiennent leur fiche', items: [
    'Artistes de l’asso : relié à ton compte par l’équipe, tu modifies toi-même ta présentation, tes réseaux, ta photo, ta bannière et ta carte phare'
  ] },
  { date: '2026-11-01', title: 'Un pass pour tout le mois', items: [
    'Le pass de saison se joue maintenant sur tout le mois : plus de paliers à gravir, et ce que tu gagnes en plus d’un jour reste en réserve pour les jours suivants',
    'Un jour sans jouer se rattrape : rien n’est perdu'
  ] },
  { date: '2026-11-01', title: 'Vacances en mode Chill', items: [
    'Sieste au hamac : ne fais rien pendant 2 h et réveille-toi avec des vers et des poussières',
    'Coucher de soleil : chaque soir vers 21 h, le ciel se réchauffe un quart d’heure, avec un cadeau à la clé',
    'Carte postale : envoie une carte à un ami, il reçoit un petit cadeau',
    'Pêche sans appât et fouille de plage : une partie par jour, poissons exotiques et coffre de pirate',
    'Graine tropicale et bar de plage : fais pousser des fruits exotiques, prépare des cocktails à la cuisine',
    'Transat des compagnons : affection doublée et photo souvenir',
    'Apéro du serveur : quand assez de joueurs passent dans la même heure, c’est la tournée',
    'Passeport de vacances : collectionne les tampons pour gagner un titre et un cadre exclusifs',
    'Doublons au soleil : un doublon qui bronze peut gagner un cran d’état'
  ] },
  { date: '2026-11-01', title: 'Remise à l’heure', items: [
    'Salle des machines : le mode voté s’applique bien le 1er du mois (celui d’octobre était resté bloqué)',
    'Halloween se termine maintenant le 31 octobre au soir : décor, édition Maudite et cadeau du jour compris',
    'Les annonces de tirages sur Discord retrouvent l’image de la carte',
    'Discord : les annonces de tirages, de codes et de cartes Unique arrivent maintenant en belle image du studio',
    'Mode Chill : le bandeau de l’happy hour n’annonce plus de réduction quand la boutique est fermée',
    'Noisette : choisis la graine qu’elle replante, même pendant qu’elle travaille (merci pour le signalement !)',
    'Sur téléphone : les cartes postales des compagnons tiennent dans l’écran, leur bouton reste toujours à portée de doigt'
  ] },
  { date: '2026-10-31', title: 'D’un seul coup', items: [
    'Fouille : nouveau bouton « Tout fouiller » pour dépenser toute ton énergie d’un coup, avec le bilan de tes trouvailles (merci pour l’idée !)',
    'Recycler, sacrifier, décrafter ou fusionner beaucoup de cartes se fait maintenant d’une traite, et bien plus vite',
    'Les succès, découvertes et bonus gagnés pendant une action en lot s’affichent enfin',
    'Dinos : le bouton « Récupérer les trouvailles » restait bloqué quand de nouvelles trouvailles arrivaient pendant ta visite (merci pour le signalement !)'
  ] },
  { date: '2026-10-30', title: 'Plus rapide, et à ton écoute', items: [
    'Nouveau bouton « Donner un avis » dans ton menu de joueur : une idée, un bug, un coup de cœur ? Écris-le, il arrive directement à l’équipe',
    'Les pages se chargent plus vite : tout ce qu’elles affichent arrive maintenant d’un seul coup',
    'Ranger plusieurs cartes au coffre, annuler plusieurs échanges ou réordonner ta vitrine se fait d’une traite',
    'Corrigé : le menu des notifications affichait un instant une ancienne version avant de se mettre en forme',
    'Corrigé : sur la page Communauté, tous les onglets apparaissaient un instant avant d’être rangés par rubrique',
    'Sur téléphone : la page ne saute plus quand une carte ou une cinématique s’ouvre ou se ferme',
    'Chamboule-tout : le viseur suit enfin ton doigt sans trembler, et la balle part bien d’où tu la lâches',
    'Blackjack : les cartes ne sautent plus à chaque carte tirée, et la table ne change plus de taille',
    'Plinko : touche le haut du plateau pour viser au doigt',
    'Le pack et les cartes révélées s’inclinent en douceur avec ton téléphone',
    'Accueil : une fois l’histoire terminée ou les défis de saison récupérés, une croix permet de masquer le bloc jusqu’à la prochaine nouveauté',
    'Nouveaux joueurs : chaque activité se découvre en jouant (un premier ver ouvre la pêche, un premier crâne les dinos, une première carte brillante le coffre-fort…), au lieu d’attendre un niveau',
    'Des coins du monde restent à découvrir : continue d’explorer…'
  ] },
  { date: '2026-10-30', title: 'Balades, cuisine et nouveaux compagnons', items: [
    'Deux nouveaux compagnons à adopter : Noisette la lapine récolte et replante ton jardin contre des carottes, Pistache le hérisson gratte tes tablettes et nettoie tes blocs contre des vers blancs',
    'Nouvel onglet Promenade : chaque jour, emmène chacun de tes compagnons en balade dans la forêt, au bord du lac, dans la prairie ou dans les ruines… et la nuit, dans la clairière aux lucioles',
    'Nouvel onglet Cuisine : légumes, herbes, baies, champignons, miel et poissons se cuisinent en plats qui boostent ton jardin, ta pêche, ton archéologie ou tes compagnons',
    'Nouvelle graine Potager au jardin, des carottes sauvages en fouillant et des vers blancs à la récolte',
    'La carte du monde vit au rythme de ta journée : aube, plein jour, crépuscule et nuit étoilée, avec les fenêtres et les réverbères qui s’allument le soir',
    'Carte plus lisible : chaque lieu est un repère posé au-dessus de son bâtiment, et les boutons ne cachent plus aucun lieu'
  ] },
  { date: '2026-10-30', title: 'Les artistes à l’honneur', items: [
    'Nouvelle page « Les artistes » (menu Collection) : chaque artiste de l’asso a sa page, avec sa présentation, ses réseaux sociaux à suivre et toutes ses cartes du jeu',
    'Sur la page d’un artiste, retrouve les cartes que tu as déjà et celles qui te manquent, et ouvre chaque illustration en grand',
    'Dans la fenêtre d’une carte, le nom de l’artiste mène maintenant à sa page',
    'Archéologie plus exigeante : les blocs doivent être dégagés presque entièrement, les trouvailles sont plus enfouies, l’endurance est plus courte et les gestes brusques abîment plus vite',
    'Corrigé : en archéologie, le grattage continuait parfois tout seul sans cliquer',
    'Nouveau bouton « Ouvrir tous les coffres » : toutes tes boules du gatchapon en une seule ouverture, les plus beaux coffres d’abord s’il te manque des clés',
    'Boosters de plusieurs extensions : choisis « Tout ouvrir d’un coup » pour tout révéler en une fois, ou « Une extension à la fois » comme avant'
  ] },
  { date: '2026-10-29', title: 'Un monde, deux régions', items: [
    'Une seule carte du monde pour tout le jeu : la nature et ses jeux (avec les ruines de l’archéologie), puis le village et la communauté. Elle s’affiche aussi en haut de la page Communauté',
    'Menus rangés : chaque page n’apparaît plus qu’à un seul endroit ; ta progression, tes statistiques et tes cosmétiques sont dans ton menu de joueur',
    'Nouveaux joueurs : chaque découverte se fait par surprise, avec sa cinématique… et deux compagnons attendent quelque part de t’adopter',
    'L’onglet Coffre-fort des jeux s’appelle maintenant Cage de Pepper, et Métiers devient Classements',
    'Corrigé : le chrono de la fouille et de la pêche qui repartait de zéro, avec une énergie qui ne remontait plus',
    'Nouvelle fenêtre Préférences dans ton menu : thème, texte, effets, son, vibrations, cinématiques, rappels et notifications au même endroit',
    'Bilan de ta session dans l’inventaire : ce que tu as gagné depuis ton arrivée',
    'Un bouton « ❔ Règles » sur chaque jeu et chaque onglet de la communauté',
    'Échanges : tes souhaits marqués d’un ♥, des filtres pour les trouver, et une contre-offre rapide en un clic',
    'Les codes en cours s’affichent avec leur temps restant, en direct, sur la page « Réclamer un code »'
  ] },
  { date: '2026-10-28', title: 'Salle des trésors', items: [
    'Coffre-fort : nouvel onglet Présentoir, tes plus belles cartes exposées sous les projecteurs, les émeraudes en tête ; touche une carte pour la voir en grand, et partage l’image de ta salle des trésors',
    'Une carte du coffre peut maintenant aller dans la vitrine de ton profil ; la vitrine pleine te propose de choisir laquelle remplacer, et tu peux changer l’ordre des cartes',
    'La vitrine du profil et les images à partager montrent enfin chaque carte en entier : rareté, finition, état et édition',
    'Nouvel effet pour la carte émeraude, taillée comme une vraie pierre',
    'Archéologie relookée : terre en relief, couches qui apparaissent en creusant, tablettes gravées, quadrillage de fouille, curseur à la taille de l’outil, touches 1 à 5 et bouton « Bloc suivant »',
    'Crafter : le bon de craft gagné à Devine la carte s’affiche et se déduit du prix, et les baisses de la Bourse comptent enfin',
    'Collection : les filtres actifs en pastilles, une barre qui suit quand tu descends, et sur téléphone les filtres avancés repliés',
    'Expéditions : une carte Unique en exploratrice rapporte plus de poussières, plus de ressources, et parfois un jeton booster',
    'Codes événement : un même code peut maintenant donner plusieurs choses à la fois',
    'Jardin tout neuf : sachets de graines, un vrai champ avec son épouvantail, et trois nouvelles graines à débloquer (herbe à chat pour Moka, arbre à os pour Milo, champignon lumineux)',
    'Nouveau bouton « Mettre du caca partout » au jardin : un engrais de dino sur toutes les parcelles d’un coup',
    'Les coffres du gatchapon sont mieux garnis : plus de poussières et des ressources en bonus (vers, os, appâts, tablettes…), encore plus dans les gros coffres'
  ] },
  { date: '2026-10-27', title: 'Pierre gravée et maître archéologue', items: [
    'Trois sortes de tablettes : l’argile commune, la pierre gravée (rare, veines de roche dure) et la tablette dorée (légendaire, pièces fragiles mais reliques fréquentes). Plus tu fouilles profond, plus les belles sont fréquentes',
    'Nouveau niveau d’archéologue : il monte en dégageant et débloque la loupe, le pinceau fin, le burin doux, le soufflet et d’autres avantages',
    'Derrière une certaine porte, on sait enfin exactement ce qu’on gagne'
  ] },
  { date: '2026-10-26', title: 'Gratter, souffler, se reposer', items: [
    'Archéologie revue : on gratte librement la terre au pinceau, au grattoir ou à la pioche, puis on nettoie chaque bloc à l’atelier pour découvrir ce qu’il cache. Attention à la pression : trop brusque, la trouvaille se fissure',
    'Milo et Moka n’ont plus de limite par jour : ils travaillent, se fatiguent et font de petites pauses avant de s’y remettre',
    'Chenil et coin de Moka plus clairs, rangés de la même façon ; la tendresse s’affiche discrètement',
    'Archéologie plus juste : un bloc est extrait aux trois quarts dégagé, seul le cœur de la trouvaille compte au nettoyage, et le pinceau ne casse jamais',
    'Les pouvoirs des dinos marchent tant qu’ils ne sont pas en danger : le Stégosaure protège vraiment le jardin',
    'Derrière une certaine porte, les lumières clignotent plus fort…'
  ] },
  { date: '2026-10-25', title: 'Tablettes, tendresse et émeraudes', items: [
    'Nouveau jeu : l’Archéologie. Des tablettes anciennes dorment sous tes grilles de fouille ; dégage-les au pinceau (ou à la truelle, attention à ne rien fissurer)',
    'Milo et Moka adorent la tendresse : caresses, jeux et friandises les rendent plus rapides et plus généreux',
    'Coffre-fort perso rangé par extension, et une carte émeraude pour chaque carte aux 6 finitions : la preuve de ta maîtrise',
    'Boutique : tout est en vente illimitée, mais chaque achat du jour fait monter le prix pour toi jusqu’à minuit',
    'Les améliorations permanentes rejoignent les talents, et l’arbre céleste gagne des nébuleuses à améliorer sans fin',
    'Nouveaux cosmétiques en boutique, à essayer avant d’acheter',
    'Corrigé : les bonus des événements (calcul et activités oubliées), l’annonce du gain de la loterie, le cadeau « Un bonbon ou un sort ? » et des quêtes impossibles',
    'Derrière une certaine porte, on entend désormais des cartes qu’on bat et des billes qui rebondissent…'
  ] },
  { date: '2026-10-20', title: 'Plus de place pour tes dinos', items: [
    'L’enclos accueille maintenant jusqu’à 10 dinos',
    'Tu peux relâcher un dino dans la nature pour libérer une place : il te laisse ses trouvailles et ses cacas avant de partir',
    'Draft du mode Medium : la page se met à jour toute seule (arrivée des joueurs, départ, ton tour)',
    'Les cadres des cartes légendaires, mythiques et uniques sont de retour, et l’effet glitch s’affiche aussi en plein écran',
    'Nouvelle interface : inspecteur de carte, carte du monde des jeux, session rapide, rappels, transitions et mode hors ligne'
  ] },
  { date: '2026-10-19', title: 'Codes, chats et mystères', items: [
    'Réclamer un code devient une petite cérémonie : chaque déblocage a sa cinématique',
    'Certains mots, bien choisis, débloquent des titres, des cadres et des couleurs…',
    'Les cartes secrètes ont chacune un effet unique et restent toujours en parfait état',
    'Moka a des choses à raconter sur ses amis chats : lis bien ses cartes postales'
  ] },
  { date: '2026-10-19', title: 'Énergie, devinettes et finitions', items: [
    'Café du fouilleur et thermos du pêcheur sans limite : un peu plus chers à chaque achat de la journée, prix de base le lendemain',
    'Devine la carte rapporte bien plus, avec une pièce de gatchapon pour chaque journée terminée ; le gain possible s’affiche et fond à chaque erreur',
    'Chaque profondeur de fouille a son décor : herbe, galeries, cavernes de cristal, gouffre de lave, noyau irisé',
    'Une seule clé, une seule image ; l’appât doré devient un ver doré et la potion de savoir reprend la fiole',
    'Milo et Moka portent un médaillon qui change avec ton niveau de fouille et de pêche, et Moka pêche enfin dans le bon sens',
    'Sur mobile : onglets qui défilent, en-tête plus net, boutons plus faciles à toucher',
    'Devine la carte fait peau neuve : cadre doré, loupe, réponses A, B, C, D',
    'L’engrais doré brille enfin comme un appât doré',
    'Coffre-fort : seules les éditions où tu as quelque chose à ranger ont leur onglet',
    'Quelque chose grince sous le site, comme un rouage mal huilé… et des pêcheurs jurent avoir remonté un drôle de papier. ⚙️'
  ] },
  { date: '2026-10-18', title: 'Plus rapide et plus pratique', items: [
    'Les pages se chargent plus vite : beaucoup moins de requêtes et des images plus légères',
    'Le titre de l’onglet affiche le nombre de récompenses à récupérer',
    'Taille du texte réglable dans ton menu (normale, grande, très grande)',
    'Sur ordinateur : raccourcis clavier (« ? » pour la liste, « / » pour chercher, « g » puis une lettre pour changer de page)'
  ] },
  { date: '2026-10-18', title: 'Pêche plus simple et corrections', items: [
    'Pêche : plus de jauge à viser, choisis l’un des trois remous, l’un d’eux cache une prise parfaite',
    'Craft : le prix affiché tient compte de la Bourse en mode Medium (les mythiques étaient refusées alors qu’on pensait avoir assez)',
    'Ouverture de coffre : la clé s’affiche avec sa vraie image'
  ] },
  { date: '2026-10-18', title: 'Une roue de la fortune de cinéma', items: [
    'La roue de la fortune devient une vraie scène : roue dorée, ampoules qui défilent, pointeur qui claque sur chaque picot',
    'Le lot gagné apparaît en grand, avec flash et pluie de pièces au jackpot'
  ] },
  { date: '2026-10-18', title: 'Le mûrissoir', items: [
    'Au distributeur, ta sélection peut mûrir au lieu d’être ouverte : choisis 6 h, 24 h ou 72 h, le lot reste de côté avec son minuteur',
    'Une fois mûr, le lot s’ouvre gratuitement : chaque booster a plus de chances de finition spéciale, et une finition garantie au stade Doré',
    'Plusieurs lots peuvent mûrir en même temps, de plus en plus avec ton niveau (remplace l’ancien booster mûri)'
  ] },
  { date: '2026-10-18', title: 'Petits conforts', items: [
    'Minuteurs dans l’inventaire : quand ta fouille et ta pêche seront pleines, le retour de l’expédition, le jardin, Milo et le prochain jour',
    'Recyclage et sacrifices par lots : ta plus belle finition et ton meilleur état de chaque carte sont toujours gardés',
    'Tire la page vers le bas pour la rafraîchir sur mobile',
    'Vibrations légères au ferrage, aux trésors et aux belles cartes (désactivables dans ton menu)',
    'Touche ou survole une ressource pour savoir à quoi elle sert et où en trouver'
  ] },
  { date: '2026-10-18', title: 'Saisons, histoire et surprises', items: [
    'Défis de saison : 3 défis chaque semaine qui font avancer ta saison plus vite',
    'Quêtes d’histoire : 8 chapitres avec Milo, Moka, Pepper et les autres, et une récompense exclusive à la fin',
    'Événements surprises : double XP, frénésie de pêche, soldes du gatchapon… quelques heures, sans prévenir',
    'Prestige : chaque étoile donne maintenant un bonus d’XP permanent, et les étoiles s’affichent dans les classements et sur la carte joueur',
    'Récap de la semaine à partager en image',
    'Mode compact sur mobile, avec les actions principales en bas de l’accueil',
    'Badges du musée pour chaque vitrine complétée',
    'Cette page de notes de mise à jour'
  ] },
  { date: '2026-10-18', title: 'Musée, boutique et décors de fête', items: [
    'Musée du coffre-fort : poissons, minéraux, objets et dinos exposés pour toujours',
    'La boutique s’invite dans chaque jeu : vers et appâts à la pêche, café et os à la fouille, engrais au jardin…',
    'Skins saisonniers : tout le site change de décor à Halloween, Noël, Pâques… (désactivable), avec une cinématique d’entrée',
    'Les vraies images des ressources partout (vers, os, clés, pièces détachées…)',
    'Les quêtes encore verrouillées par le niveau s’affichent comme telles'
  ] },
  { date: '2026-10-18', title: 'Nouveaux joueurs et nouvelles versions', items: [
    'Parcours du débutant : 10 étapes guidées avec leurs récompenses, et un accueil plus simple au début',
    'Les jeux se débloquent petit à petit avec le niveau',
    'Devine la carte : 5 cartes par jour, 3 essais avec le zoom qui recule, et un bon de craft sur les cartes qui te manquent',
    'Expédition : 5 destinations qui ramènent des ressources pour les autres jeux, et une affinité du jour',
    'Coffre de guilde refait : dépose tes doublons contre des crédits, prends la carte de ton choix',
    'Grand Chantier : un nouveau jeu commun de la semaine'
  ] },
  { date: '2026-10-17', title: 'Distributeur, gatchapon et fouille profonde', items: [
    'Distributeur à boosters : des jetons, et un panier pour choisir plusieurs boosters d’un coup',
    'Gatchapon de coffres : une pièce, une boule, du coffre en bois au coffre mystique',
    'Fouille sur 32 cases et 5 profondeurs, avec des minéraux à échanger au comptoir',
    'Pêche revue : énergie qui se recharge, ferrage, 5 zones, aquarium de 24 espèces',
    'Moka le chat pêche pour toi si tu lui donnes du poisson',
    'Jardin jusqu’à 28 parcelles ; marché noir réapprovisionné automatiquement',
    'Collection : recyclage et sacrifices par lots, Finitions et Qualité plus pratiques',
    'Coffre-fort : six cadenas à ouvrir pour libérer Pepper'
  ] },
  { date: '2026-10-16', title: 'Les modes de jeu prennent vie', items: [
    'Page « Mode du moment » : règles, bonus et quêtes du mode en cours',
    'Chaque difficulté a son skin complet et sa cinématique',
    'Draft, vote du Chaos et règles propres à chaque mode',
    'Nouvelles cinématiques de passage de niveau ; réglage des cinématiques dans ton menu'
  ] },
  { date: '2026-10-15', title: 'Dinos et calendrier', items: [
    'Dinos de compagnie : œufs, nourriture, accessoires et dinodex',
    'Calendrier des événements saisonniers (Halloween, Noël…)',
    'Bingo du mois refait',
    'Découvertes : une animation la première fois que tu obtiens une ressource',
    'Historique de chaque exemplaire de carte'
  ] },
  { date: '2026-10-14', title: 'Modes de jeu et vie communautaire', items: [
    'Modes de jeu Cool, Chill, Medium, Hard et Chaos',
    'Salle des machines, guerre des équipes, loterie du dimanche, avis de recherche',
    'Expédition en duo et éditions limitées dans les boosters',
    'Tableau d’affichage de la communauté, panthéon et cartes fantômes',
    'Annuler un décraft juste après l’avoir fait'
  ] },
  { date: '2026-10-11', title: 'Équilibrage et confort', items: [
    'Économie rééquilibrée : plus de boosters gagnés en jouant',
    'Récap de ta semaine sur l’accueil',
    'Améliorations permanentes à la boutique',
    'Objectifs du jour regroupés et résumé des jeux'
  ] },
  { date: '2026-10-08', title: 'Nouveau menu', items: [
    'Menu réorganisé, inventaire de tes ressources depuis l’en-tête'
  ] },
  { date: '2026-10-07', title: 'Maîtrises et rendez-vous quotidiens', items: [
    'Maîtrise des extensions, talents, constellations, cartes ★ et rangs de compte',
    'Boîte du jour, dé du jour, heures de chance et missions du soir',
    'Enchères et contrats de collection',
    'Page « Mes statistiques »'
  ] },
  { date: '2026-10-05', title: 'Pêche, jardin et succès', items: [
    'Pêche aux vers de terre, niveaux de pêche et de fouille',
    'Jardin, grande fouille commune, défis de la semaine et objectif commun',
    'Succès, boutique de cosmétiques (titres, cadres, couleurs)',
    'Cartes Unique, à choisir au Comptoir Unique'
  ] },
  { date: '2026-10-04', title: 'Une grosse vague de jeux', items: [
    'Milo le chien creuse pour toi',
    'Expédition et Devine la carte',
    'Saisons mensuelles à paliers et coffres',
    'Collection et atelier réunis (craft, décraft, finitions, qualité, autel)',
    'Notifications push'
  ] },
  { date: '2026-10-02', title: 'Le coffre-fort', items: [
    'Grand coffre-fort à ouvrir avec des clés, et coffre-fort perso pour ranger tes plus belles cartes',
    'Roue de la fortune revue, décraft amélioré'
  ] },
  { date: '2026-09-30', title: 'Petites améliorations', items: [
    'Fouille et accueil revus, coffre de guilde amélioré'
  ] },
  { date: '2026-09-26', title: 'Fiche de carte', items: [
    'Nouvelle fiche de carte en grand, avec ses détails'
  ] },
  { date: '2026-09-25', title: 'Jeux et communauté', items: [
    'Page Jeux, avec la Fouille',
    'Page Communauté : boss commun, coffre de guilde et marché noir'
  ] },
  { date: '2026-09-23', title: 'Journal d’ouvertures', items: [
    'Journal de toutes tes ouvertures de boosters',
    'Raretés garanties au bout d’un certain nombre de tirages'
  ] },
  { date: '2026-09-22', title: 'Liste de souhaits', items: [
    'Liste de souhaits pour suivre les cartes qui te manquent',
    'Pages refaites et plus lisibles'
  ] },
  { date: '2026-09-21', title: 'Lancement de 2Gatcha', items: [
    'Connexion avec Discord',
    'Ouverture de boosters de 5 cartes et collection',
    'Craft avec les poussières d’étoile, échanges entre joueurs',
    'Codes événement à réclamer, quêtes du jour et profil'
  ] }
];

export function allNotes(store) {
  let extra = [];
  try { extra = setting(store, 'PatchNotesExtra') || []; } catch (e) { extra = []; }
  return [...extra, ...PATCH_NOTES].filter((n) => n && n.date && Array.isArray(n.items)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function handle({ store }) {
  const notes = allNotes(store);
  return ok({ notes, latest: notes.length ? notes[0].date : null });
}

export const routes = { 'GET patch-notes': handle };
