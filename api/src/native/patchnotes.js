// Notes de mise a jour (2026-10-18) : tout ce qui a change pour les joueurs
// depuis la creation de 2Gatcha (pas les correctifs techniques ni l'admin).
// Page nouveautes.html ; le colis de retour (daily.js) en tire ses nouvelles.
// L'admin peut en ajouter (setting PatchNotesExtra), affichees en premier.
//   GET /webhook/patch-notes -> { notes: [{ date, title, items }], latest }

import { ok } from './common.js';
import { setting } from './settings.js';

export const PATCH_NOTES = [
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
