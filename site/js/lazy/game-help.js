// Module charge a la demande (bouton « ❔ Règles » des pages Jeux et
// Communaute, shell-extras.js). Aide sur place (2026-10-29) : les regles de
// l'onglet ouvert, en clair pour le joueur. A garder en phase avec la
// documentation de l'admin (Admin > Documentation) a chaque changement de
// regle. Aucun nombre reglable ici (ils changent avec les reglages et le mode
// de jeu) et rien sur ce qui n'est pas encore debloque. Les compagnons pas
// encore adoptes ne sont pas nommes (PetText).

const GameHelp = {
  RULES: {
    dig: { icon: "⛏️", title: "Fouille", items: [
      "Chaque case creusée coûte 1 point d'énergie ; l'énergie revient toute seule avec le temps (le compteur indique le prochain point).",
      "Des trésors se cachent sous la grille : poussières, jetons booster, cartes, minéraux. Les plus gros sont étalés sur plusieurs cases : il faut toutes les creuser pour les libérer.",
      "Une fois tous les trésors trouvés, une nouvelle grille arrive ; les cases de terre jamais creusées donnent des vers pour la pêche.",
      "Monter de niveau de fouille donne plus d'énergie, une recharge plus rapide… et de nouvelles choses à découvrir.",
      "Les minéraux se vendent ou s'échangent au comptoir, sous la grille.",
      "Milo, le chien, creuse à ta place quand tu lui donnes un os ; il fait des pauses et travaille mieux quand tu t'occupes de lui (caresse, jeu, friandise)."
    ] },
    archeo: { icon: "🏺", title: "Archéologie", items: [
      "Les tablettes anciennes se trouvent en terminant des grilles de fouille.",
      "Choisis une tablette puis gratte la terre à la souris ou au doigt avec l'outil choisi (touches 1 à 5) : le cercle du curseur montre sa taille, sa couleur la pression.",
      "Gratter trop fort ou trop vite abîme les pièces : une pièce fissurée vaut moins, une pièce cassée est perdue.",
      "Dégage chaque bloc presque entièrement (90 %) pour l'extraire, puis nettoie-le de la même façon pour libérer la trouvaille. L'endurance est comptée : vise les reflets ✨.",
      "Ton niveau d'archéologue monte en dégageant des pièces et débloque des avantages.",
      "Pistache, le hérisson, travaille à ta place contre des vers blancs : il nettoie tes blocs bruts (jamais ceux que tu as commencés), sinon gratte une tablette de ta réserve. Il est moins soigneux que toi : certaines pièces sortent rayées ou cassées, et il en laisse dans la terre.",
      "Le ragoût du fouilleur (cuisine) donne plus d'endurance aux tablettes ouvertes pendant son bonus."
    ] },
    walk: { icon: "🐾", title: "Promenade", items: [
      "Une balade par jour et par compagnon adopté : choisis qui vient et où aller.",
      "Chaque lieu a ses trouvailles : la forêt (baies, champignons, os), le bord du lac (poissons, vers), la prairie (carottes, herbes, légumes, miel), les ruines (vers blancs, minéraux, tablettes).",
      "Dans son lieu préféré, un compagnon trouve deux fois plus et gagne plus d'affection.",
      "La clairière aux lucioles ne s'ouvre que la nuit, avec des trouvailles plus rares."
    ] },
    cook: { icon: "🍲", title: "Cuisine", items: [
      "Les ingrédients du garde-manger viennent du jardin (graine Potager, champignon lumineux), des promenades et de la pêche (poissons, carottes).",
      "Chaque plat donne un bonus temporaire : jardin plus rapide, prises rares à la pêche, endurance d'archéologie, ou compagnons qui travaillent comme s'ils t'adoraient. Le festin donne tout à la fois.",
      "Recuisiner un plat prolonge son bonus, dans une limite d'heures devant toi.",
      "La soupe accélère les plantations faites pendant son bonus (pas celles déjà en terre)."
    ] },
    guess: { icon: "❓", title: "Devine la carte", items: [
      "Chaque jour, les mêmes cartes zoomées pour tout le monde, à reconnaître parmi plusieurs propositions.",
      "Trois essais par carte : à chaque erreur, la mauvaise proposition disparaît et le zoom recule, mais le gain baisse.",
      "Trouver une carte que tu ne possèdes pas donne un bon de craft : une réduction sur cette carte pendant quelques jours.",
      "Une série de jours réussis rapporte des jetons booster ; une journée parfaite (tout du premier coup) un bonus de poussières."
    ] },
    expedition: { icon: "🧭", title: "Expédition", items: [
      "Envoie une de tes cartes explorer une destination, pour une durée au choix : plus c'est long, plus le butin est gros.",
      "Chaque destination rapporte ses propres ressources ; ton niveau d'expédition en ouvre de nouvelles.",
      "Une carte plus rare (surtout une Unique) rapporte davantage.",
      "Reviens quand le minuteur est fini pour récupérer le butin et renvoyer quelqu'un."
    ] },
    fish: { icon: "🎣", title: "Pêche", items: [
      "Un lancer coûte des vers et 1 point d'énergie de pêche (qui revient avec le temps). Les vers se trouvent en fouillant et au jardin.",
      "Quand ça mord, une aiguille va et vient : clique (ou Espace) dans la zone pour ferrer. Un ferrage parfait donne des prises plus rares et plus grosses.",
      "Chaque nouvelle espèce rejoint ton aquarium ; les appâts dorés évitent les prises vides et améliorent les prises rares.",
      "Ton niveau de pêche augmente l'énergie, accélère la recharge et ouvre d'autres coins de pêche.",
      "Moka, le chat, pêche à ta place contre du poisson ; il rapporte ses prises sur une carte postale."
    ] },
    garden: { icon: "🌱", title: "Jardin", items: [
      "Plante une graine sur une parcelle libre (elle coûte des poussières), attends qu'elle pousse, puis récolte.",
      "Chaque graine a sa durée et ses récoltes : vers, appâts dorés, poussières… Ton niveau de jardinage en fait découvrir d'autres.",
      "L'engrais des dinos fait pousser plus vite ; « Mettre du caca partout » en met sur toutes les parcelles d'un coup.",
      "Une plante oubliée trop longtemps peut faner.",
      "Noisette, la lapine, travaille à ta place contre des carottes : elle récolte chaque parcelle dès qu'elle est prête et replante la même graine (payée avec tes poussières).",
      "Les récoltes donnent parfois des vers blancs, la nourriture de Pistache le hérisson ; la graine Potager donne des légumes et des herbes pour la cuisine."
    ] },
    dino: { icon: "🦖", title: "Dinos", items: [
      "Un crâne de dinosaure et assez d'os ramènent un dino à la vie.",
      "Nourris-le et occupe-toi de lui : un dino content donne un pouvoir passif (tant qu'il n'est pas affamé ET malheureux).",
      "Ses cacas servent d'engrais au jardin ; les dorés valent plus.",
      "Tu peux relâcher un dino : il laisse ses trouvailles derrière lui."
    ] },
    bingo: { icon: "🎲", title: "Bingo du mois", items: [
      "Une grille de cartes à obtenir pendant le mois : chaque carte possédée coche sa case.",
      "Une ligne complète rapporte une récompense, la grille entière (carton plein) une plus grosse.",
      "Le joker remplace une case difficile. Nouvelle grille au début de chaque mois."
    ] },
    vault: { icon: "🔒", title: "Cage de Pepper", items: [
      "Une carte promo arc-en-ciel est enfermée derrière plusieurs cadenas.",
      "Chaque clé secrète (trouvée en fouillant, à la roue du jour…) ouvre un cadenas : clique un cadenas pour l'ouvrir.",
      "Tous les cadenas ouverts : la carte est à toi."
    ] },
    calendar: { icon: "📅", title: "Calendrier", items: [
      "Tout ce qui arrive : événements de saison, bonus, rendez-vous de la semaine et évènements de l'asso.",
      "Un code annoncé y apparaît avec son temps restant ; « Y aller » ouvre la page « Réclamer un code ».",
      "Le bouton « Agenda » ajoute un événement à ton téléphone."
    ] },
    board: { icon: "📌", title: "Tableau d'affichage", items: [
      "Les petites annonces de la communauté : loterie du dimanche, avis de recherche et autres rendez-vous.",
      "Un ticket de loterie te donne une chance au tirage du dimanche ; un avis de recherche récompense qui trouve la carte demandée."
    ] },
    boss: { icon: "💀", title: "Boss commun", items: [
      "Toute la guilde attaque le même boss en lui sacrifiant des exemplaires de cartes (jusqu'à 10 à la fois) : rareté, finition et état font la force de chaque carte, et une grosse salve frappe plus fort.",
      "Les dégâts exacts s'affichent avant de valider.",
      "Quand il tombe, chaque participant reçoit une récompense. Un boss enragé est plus dur… et récompense un titre."
    ] },
    together: { icon: "🤝", title: "Ensemble", items: [
      "Les objectifs de toute la communauté : chaque action de chacun fait avancer la jauge commune.",
      "Les paliers atteints donnent une récompense à tous ceux qui ont participé."
    ] },
    teams: { icon: "🏳️", title: "Guerre des équipes", items: [
      "Chaque mois, choisis une équipe : tes actions de jeu lui rapportent des points.",
      "À la fin du mois, les membres de l'équipe gagnante reçoivent un titre de champion."
    ] },
    machine: { icon: "⚙️", title: "Salle des machines", items: [
      "La communauté vote pour le mode de jeu du mois suivant et fait tourner la machine ensemble.",
      "Le mode le plus voté s'applique au début du mois suivant ; le meilleur mécanicien du mois gagne un titre."
    ] },
    skills: { icon: "🏆", title: "Classements", items: [
      "Les meilleurs pêcheurs et fouilleurs de la semaine (XP gagnée depuis lundi).",
      "Le premier de chaque métier porte la couronne jusqu'au lundi suivant."
    ] },
    market: { icon: "🌑", title: "Marché noir", items: [
      "Des cartes à acheter contre des poussières, pour un temps limité et en quantité limitée.",
      "De nouvelles offres arrivent chaque semaine : premier arrivé, premier servi."
    ] },
    auctions: { icon: "🔨", title: "Enchères", items: [
      "Mets une carte en vente ou surenchéris en poussières sur celles des autres.",
      "À la fin du minuteur, la meilleure offre l'emporte ; si quelqu'un te dépasse, tes poussières te sont rendues.",
      "Une enchère qui arrive dans les dernières minutes prolonge la vente."
    ] },
    chest: { icon: "🎁", title: "Coffre de guilde", items: [
      "Dépose une carte dans le coffre commun pour les autres joueurs.",
      "Chaque jour, une pioche gratuite te donne une carte du coffre au hasard."
    ] }
  },

  open(key) {
    const r = this.RULES[key];
    if (!r) { Toast.info("Pas encore de règles pour cet onglet."); return; }
    const mask = (s) => (typeof PetText !== "undefined" ? PetText.mask(s) : s);
    // Paragraphe sur un compagnon pas encore adopte : retire (surprise).
    const PETS = { milo: /Milo/, moka: /Moka/, noisette: /Noisette/, pistache: /Pistache/ };
    const items = r.items.filter((t) => !(typeof StarterLocks !== "undefined" && Object.entries(PETS).some(([k, re]) => re.test(t) && StarterLocks.pets[k] === false)));
    Confirm.show(`<ul class="gh-list">${items.map((t) => `<li>${escHtml(mask(t))}</li>`).join("")}</ul>`, { title: `${r.icon} ${r.title} : les règles`, confirmText: "Compris", cancelText: "Fermer" });
  }
};
window.GameHelp = GameHelp;
