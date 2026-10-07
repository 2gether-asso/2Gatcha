# Schema de la base - 2Gatcha

Toutes les donnees du jeu vivent dans la base SQLite de l'API (`api/`), une
table par entite. Les tables et colonnes manquantes sont creees
automatiquement au demarrage (voir "Colonnes : creees automatiquement" en bas
de ce document) ; la structure se modifie depuis `site/admin-db.html`.
Ce document decrit chaque table et ses regles metier. Tables de base, dans
l'ordre de leurs references :
`Rarities` -> `Finishes` -> `Extensions` -> `Cards` -> `Users` -> `Pulls` ->
`Config` -> `EventCodes` -> `CodeRedemptions` -> `Trades` ->
`BoosterInventory` -> `Wishlist` -> `ProfileShowcase`.

## 1. Rarities

| Colonne          | Type              | Notes                                             |
|-------------------|-------------------|------------------------------------------------------|
| Name              | Text              | ex: "Commune", "Rare", "Epique", "Legendaire"      |
| Key               | Text              | slug utilise par le front: `commune`, `rare`, `epique`, `legendaire` |
| Weight            | Numeric           | poids relatif de tirage (plus c'est haut, plus c'est frequent) |
| ColorHex          | Text              | couleur d'UI, ex `#f59e0b`                          |
| SortOrder         | Numeric           | ordre d'affichage / du plus commun au plus rare     |
| DisenchantValue   | Numeric           | poussieres d'etoile obtenues en decraftant une carte de cette rarete |
| CraftCost         | Numeric           | poussieres d'etoile necessaires pour crafter une carte de cette rarete |

Exemple de valeurs de depart (les couts de craft/decraft suivent la logique
Hearthstone : crafter coute nettement plus cher que ce que rapporte un
decraft, pour que la conversion directe ne soit jamais interessante) :

| Name        | Key         | Weight | ColorHex | SortOrder | DisenchantValue | CraftCost |
|-------------|-------------|--------|----------|-----------|-----------------|-----------|
| Commune     | commune     | 70     | #9aa0b4  | 1         | 5               | 40        |
| Rare        | rare        | 22     | #3b82f6  | 2         | 20              | 100       |
| Epique      | epique      | 7      | #a855f7  | 3         | 100             | 400       |
| Legendaire  | legendaire  | 1      | #f59e0b  | 4         | 400             | 1600      |

`Weight`/`DisenchantValue`/`CraftCost` sont editables depuis `admin.html`
(section "Équilibrage du jeu", tableau "Raretés") via `admin-config.json`
(action `updateRarity`) - pas besoin d'ouvrir admin-db.html pour un simple
ajustement de taux/cout.

**Important** : ces poids ne s'expriment que sur les cartes qui existent
reellement dans l'extension ouverte. S'il n'y a aucune carte d'une rarete
donnee dans une extension, un tirage qui obtient cette rarete retombe sur une
carte au hasard de l'extension (`open-pack.json`) : verifie que chaque
extension a au moins une carte par rarete utilisee, sinon la ponderation n'a
plus d'effet visible.

### Rarete Unique (verte, creee automatiquement)

Au demarrage, l'API cree la rarete `unique` ("Unique", `#22c55e`, poids 0,
au-dessus de toutes les autres) et l'extension `uniques` (inactive : pas de
booster) si elles manquent (`api/src/native/unique.js`). Il suffit de creer
des cartes avec cette rarete dans admin-db : elles sont automatiquement
marquees `IsPromo` (jamais tirees, craftees, echangees ni donnees) et rangees
dans l'extension Uniques si aucune n'est choisie (elles ne pesent ainsi sur
la completion d'aucune autre extension). Elles ne s'obtiennent qu'au
**Comptoir Unique** (page coffre-fort) contre un **Ticket Unique**
(`Users.UniqueTickets`), gagne a chaque ligne complete du coffre-fort perso.
L'autel ne vise jamais cette rarete.

### Coffre-fort perso, pieces detachees, niveaux

- `VaultRewards` : une ligne par carte dont la ligne de 6 finitions a ete
  recompensee. Les cartes promo ne vont pas au coffre.
- `Users.SpareParts` : pieces detachees (pechees). Dans l'atelier Finitions
  ou Qualite, une piece remplace UN des exemplaires a consommer (5 -> 4, 3 -> 2).
- `Users.Worms` : vers de terre, cout d'un lancer de peche ; gagnes a la fin
  d'une grille de fouille (joueur ou chien) : `WormsPerBoard` + `WormsPerLeftoverTile`
  par case jamais creusee. Stock de depart offert une fois (`StarterWorms`).
- Lot 2026-10-05 (tout est cree au demarrage) : `EconomyDaily` (journal de
  l'economie), `WeeklyChallenges`, `CommunityGoals`, `ThemeClaims`,
  `UserCosmetics`, `ProfileWall`, `CommunityDig` ; colonnes `Users` :
  HiddenStats/HiddenAchievements (JSON), EquippedTitle/Frame/Color, GoldBait,
  GardenPlots (JSON), CDigDay/CDigCount, BoneWeek/BonesBoughtWeek,
  WeatherDay/WeatherKey, RushDay, DigDay/DigDayCount, DigPrestige,
  FishingPrestige, TourneyKey/TourneyCasts/TourneyScore ; `SeasonProgress.BonusClaimed` ;
  `BlackMarketOffers.Label/Auto/Week` (offres automatiques).
- `Users.FishingXP` / `Users.DigXP` : niveaux de peche et de fouille (1 a 10,
  `api/src/native/levels.js`) ; `FishingWeek`/`FishingWeekXP`, `DigWeek`/`DigWeekXP` :
  XP de la semaine (classement des metiers) ; `FishingRecords` : carnet de peche (JSON).

### Nouvelle rarete : Mythique (au-dessus de Legendaire)

**Cote code, tout est deja pret** - `Rarities` est lue dynamiquement partout
(ponderation de tirage, badges, filtres, disenchant/craft) via `Key`/
`SortOrder`, aucun code ne code "en dur" la liste des raretes possibles.
Le front (CSS/JS) a deja tout le traitement visuel prepare pour
`Key = "mythique"` (rouge, `--rarity-mythique: #ef4444`) : bordure dans la
collection/la modale/le reveal de pack, degrade sous l'image, texte en
degrade anime, icone 🔥, flash + particules au reveal (voir plus bas). **Il
ne reste qu'a ajouter la ligne (admin-db.html)** :

| Name       | Key       | Weight | ColorHex  | SortOrder | DisenchantValue | CraftCost |
|------------|-----------|--------|-----------|-----------|-----------------|-----------|
| Mythique   | mythique  | *a definir (tres bas, ex: 0.2)* | #ef4444 | 5 (au-dessus de Legendaire) | *a definir (ex: 800)* | *a definir (ex: 3200)* |

Une fois la ligne ajoutee (et au moins une carte de cette rarete active dans
une extension), tout fonctionne sans redeploiement : filtres de la
collection, tirage, craft/decraft, badges. Point non couvert par cette
preparation (choix de design a faire separement si voulu) : la roue de la
fortune, la charge du booster et les badges de succes referencent encore
`legendaire` en dur comme "rarete la plus haute" a certains endroits
cosmetiques (`main.js`/`style.css`) - a etendre a `mythique` si elle doit
aussi y apparaitre.

### Flash + particules au reveal : desormais des l'Epique

`spawnRarityBurst`/`celebrateRarity` (main.js, opening.js, redeem.js)
declenchent maintenant un flash plein ecran + une salve de particules des
qu'une carte Epique ou mieux est revelee (avant : Legendaire uniquement),
avec une couleur ET une intensite (opacite du flash, taille/nombre des
particules, brightness du "hit") qui suivent la VRAIE couleur/le palier de
la carte plutot qu'un orange fige - Mythique est le palier le plus fort.

## Finishes

Table de reference pour les finitions cosmetiques (voir "Finitions" plus
bas) - orthogonale a la rarete : n'importe quelle carte, de n'importe quelle
rarete, peut sortir avec n'importe quelle finition. Utilisee par
`open-pack.json` (tirage naturel) et `disenchant.json` (valeur de decraft).

| Colonne              | Type    | Notes                                                     |
|-----------------------|---------|-------------------------------------------------------------|
| Key                   | Text    | `normal`, `holo`, `gold`, `ghost`, `diamond`, `rainbow` (meme echelle que `Pulls.Finish`) |
| Name                  | Text    | libelle affiche, ex "Holographique"                         |
| DropWeight            | Numeric | poids relatif **parmi les finitions speciales uniquement** (ignore pour `normal` - voir le tirage a deux niveaux ci-dessous) |
| DisenchantMultiplier  | Numeric | multiplie `Rarities.DisenchantValue` quand on decrafte un exemplaire de cette finition (`normal` = 1) |

Valeurs de depart suggerees, ajustables directement dans admin-db.html OU depuis
`admin.html` (section "Équilibrage du jeu", tableau "Finitions") via
`admin-config.json` (action `updateFinish`) - sans toucher au code :

| Key      | Name            | DropWeight | DisenchantMultiplier |
|----------|-----------------|------------|------------------------|
| normal   | Normal          | -          | 1                      |
| holo     | Holographique   | 50         | 1.5                    |
| gold     | Dore            | 25         | 2                      |
| ghost    | Ghost Rare      | 13         | 3                      |
| diamond  | Diamant         | 8          | 5                      |
| rainbow  | Arc-en-ciel     | 4          | 8                      |

**Tirage a deux niveaux** (`open-pack.json`, fonction `rollFinish()` dans le
node `Draw Cards`) : une fois la carte tiree (rarete puis carte precise,
logique inchangee), un **second tirage independant** decide sa finition -
"le jeu a decide qu'on avait tire telle carte, puis il retire pour savoir si
elle a un modificateur". 90% de chance de rester `normal` ; les 10% restants
se repartissent entre les finitions speciales au prorata de leur
`DropWeight` (holo la plus commune des speciales, rainbow la plus rare -
coherent avec l'echelle de fusion `FINISH_ORDER` de `foil-upgrade.json`/
`craft.js`). Les 10%/poids ci-dessus sont un point de depart raisonnable, pas
une valeur figee : modifie les `DropWeight` (admin-db.html ou admin.html) pour retunner sans
redeployer de workflow. Ce tirage ne s'applique qu'aux boosters reels
(`open-pack.json`) - pas a `craft.json` (toujours `normal`), ni aux codes
d'evenement, ni a l'autel.

## Qualities

**Nouvelle table.** Contrairement a `Finishes` (tirage a DEUX niveaux : 90%
`normal` fixe, puis un second tirage pondere parmi les speciales), Qualities
utilise un tirage a **UN SEUL niveau, pondere sur les 4 paliers** - il n'y a
pas de palier "par defaut" fixe cote code, c'est la repartition des
`DropWeight` qui decide. La configuration suggeree ci-dessous fait de
`good` le palier dominant (la plupart des cartes sortent en "Bon etat"),
avec une chance de mieux tomber (`mint`) et un risque de moins bien tomber
(`worn`/`damaged`) - a l'inverse de l'ancienne version ou `damaged` etait
le palier dominant.

| Colonne              | Type    | Notes                                                     |
|-----------------------|---------|-------------------------------------------------------------|
| Key                   | Text    | `damaged`, `worn`, `good`, `mint` (meme echelle que `Pulls.Quality`) |
| Name                  | Text    | libelle affiche, ex "Usé"                                    |
| DropWeight            | Numeric | poids relatif de tirage **sur les 4 paliers cette fois (y compris `damaged`)** |
| DisenchantMultiplier  | Numeric | multiplie `Rarities.DisenchantValue` (et se cumule avec `Finishes.DisenchantMultiplier` si l'exemplaire a aussi une finition speciale) quand on decrafte un exemplaire de cette qualite (`damaged` = 1) |

Valeurs de depart suggerees (`good` largement majoritaire), ajustables
directement dans admin-db.html OU depuis `admin.html` (section "Équilibrage du
jeu", tableau "Qualités") via `admin-config.json` (action `updateQuality`) :

| Key      | Name          | DropWeight | DisenchantMultiplier |
|----------|---------------|------------|------------------------|
| damaged  | Abîmé         | 8          | 1                      |
| worn     | Usé           | 17         | 1.2                    |
| good     | Bon état      | 65         | 1.5                    |
| mint     | Parfait état  | 10         | 2                      |

**Tirage** (`open-pack.json`, fonction `rollQuality()` dans le node `Draw
Cards`) : un seul tirage pondere sur les 4 lignes de `Qualities` dont le
`DropWeight` est renseigne (retombe sur `good` si la table est vide/mal
configuree). Ce tirage ne s'applique qu'aux boosters reels. `craft.json`
ecrit desormais explicitement `Quality: 'good'` sur le node `Create Pull`
(demande explicite - un exemplaire crafte doit toujours sortir en bon etat,
jamais abime par defaut) ; codes/autel/restauration produisent encore
`damaged` par omission du champ (`Finish` y reste egalement toujours
`normal` partout) - a etendre de la meme façon si le meme constat s'applique
un jour a ces autres sources.

**Traitement visuel par palier** (`style.css`) : `good` est le palier neutre
(aucun filtre, c'est la reference visuelle) ; `damaged`/`worn` gardent leurs
rayures "verre fissure" existantes (juste durcies) ; `mint` a desormais son
propre traitement DISTINCT au lieu de "juste l'absence de defaut" (le
probleme signale : "je ne vois pas la difference entre bon et parfait
etat") - filtre plus vif/lumineux, reflet brillant anime qui balaie l'image,
et un fin liseret clair (`outline`, n'entre pas en conflit avec le
border-color de la finition/la rarete). Applique partout ou une carte
possedee s'affiche : collection, modale, decraft (craft.html), profil
public, reveal de pack.

## 2. Extensions

Un "set" de boosters (ex: "Saison 1", "Halloween 2026"). Chaque extension a
son propre pool de cartes, son propre stock de boosters par utilisateur et
son propre compteur de pity.

| Colonne        | Type        | Notes                                        |
|-----------------|-------------|-------------------------------------------------|
| Name            | Text        | ex: "Saison 1"                                  |
| Key             | Text        | slug, ex: "saison-1"                            |
| Active          | Bool        | si `false`, plus ouvrable (les cartes deja obtenues restent visibles) |
| SortOrder       | Numeric     | ordre d'affichage                               |
| PackImage       | Attachments | visuel du packet de boosters pour cette extension |
| CardBackImage   | Attachments | visuel du dos de carte pendant le reveal, specifique a l'extension |

## 3. Cards

| Colonne     | Type                  | Notes                                      |
|-------------|-----------------------|---------------------------------------------|
| Name        | Text                  | nom de l'oeuvre                             |
| Artist      | Text                  | membre de l'asso qui a cree l'oeuvre        |
| Description | Text (multiline)      | optionnel                                   |
| Rarity      | Reference -> Rarities | quelle rarete                               |
| Extension   | Reference -> Extensions | a quelle extension appartient la carte (utilisee pour le tirage normal) |
| IsPromo     | Bool                  | si `true`, exclue du tirage normal des boosters : obtenable uniquement via un code d'evenement (`EventCodes`, `RewardType=card`). Une carte promo n'est **ni decraftable, ni craftable, ni echangeable** (`disenchant.json`, `craft.json` et `trade.json` la refusent) |
| IsSecret    | Bool                  | sous-ensemble des cartes promo, reservees a l'easter egg clef + serrure cachee (voir "Cartes secretes" plus bas). Doit toujours etre pose avec `IsPromo=true` en meme temps : les cartes secretes profitent de l'exclusion tirage/craft/echange deja geree par `IsPromo`, `IsSecret` ne fait que les rendre eligibles a `unlock-secret.json` |
| Image       | Attachments            | l'image de la carte (onglet Images d'admin-db.html) |
| Active      | Bool                   | si `false`, la carte n'est plus tirable     |
| FirstObtainedBy | Reference -> Users | vide tant que personne ne l'a obtenue ; rempli une seule fois, par le premier tirage/reclamation qui la sort (`open-pack.json`, `redeem-code.json`) |
| FirstObtainedAt | DateTime           | date du premier obtention (epoch secondes) |
| MaxSerial   | Numeric               | **vestige, plus lu par aucun workflow (2026-09-28)** - servait a plafonner le nombre d'exemplaires "dans la nature" par carte ; retire suite a la demande "plus de quota, juste qu'un numero deja tire ne peut plus etre obtenu". Peut etre supprimee sans impact (bouton Structure d'admin-db.html). Voir "Numeros de serie - plus de quota" plus bas |

## 4. Users

| Colonne             | Type      | Notes                                   |
|----------------------|-----------|------------------------------------------|
| DiscordId            | Text      | ID Discord de l'utilisateur, **cle de connexion** (unique) |
| DiscordUsername      | Text      | pseudo/nom global Discord, rafraichi a chaque connexion |
| DiscordAvatar        | Text      | hash d'avatar Discord (ou URL CDN complete), rafraichi a chaque connexion |
| Pseudo               | Text      | nom d'affichage modifiable par l'utilisateur (pre-rempli avec son nom Discord a la creation) |
| CreatedAt             | DateTime  | rempli a la creation                     |
| TotalPulls            | Numeric   | defaut 0, compteur global (toutes extensions confondues) |
| StardustCount         | Numeric   | defaut 0, monnaie de craft/decraft (voir plus bas), globale (pas par extension) |
| BoosterCount          | Numeric   | defaut 0, solde **generique** de boosters (voir "Economie des boosters" plus bas) |
| LastWheelSpinDate     | Text      | vide par defaut ; `AAAA-MM-JJ` (fuseau Paris) du dernier tirage a la roue de la fortune quotidienne (`daily-wheel.json`) - permet un seul tirage par jour |
| GuessDate             | Text      | **nouvelle colonne (2026-10-04)** - vide par defaut ; `AAAA-MM-JJ` (fuseau Paris) de la derniere partie de "Devine la carte" (`guess-card.json`) - un seul essai par jour |
| GuessStreak           | Numeric   | **nouvelle colonne (2026-10-04)** - defaut 0 ; serie de bonnes reponses consecutives a "Devine la carte" (0 = rate le dernier jour joue) ; tous les 7 jours de serie = +1 booster |
| ExpeditionUntil       | Numeric   | **nouvelle colonne (2026-10-04)** - defaut 0 ; epoch secondes du retour de l'expedition en cours (`expedition.json`), 0 = aucune expedition |
| ExpeditionDuration    | Numeric   | **nouvelle colonne (2026-10-04)** - defaut 0 ; duree en heures de l'expedition en cours (2, 8 ou 24) |
| ExpeditionCard        | Numeric   | **nouvelle colonne (2026-10-04)** - defaut 0 ; id (`Cards.id`) de la carte envoyee en expedition (simple nombre, pas une reference ; la carte n'est pas bloquee) |
| XP                    | Numeric   | defaut 0, experience cumulee (niveaux de profil, voir plus bas) |
| SelectedBadge         | Text      | vide par defaut ; `Key` du badge cosmetique affiche sur le profil (voir "Badges" plus bas) - doit correspondre a un badge que le joueur possede (`UserBadges`) |
| DigEnergy             | Numeric   | defaut 5 (plein), energie du mini-jeu de fouille (voir "Mini-jeu de fouille" plus bas) |
| LastDigEnergyAt       | DateTime  | epoch secondes, dernier instant ou l'energie de fouille a ete lue/consommee - sert de base au calcul de regeneration (+1/minute) |
| DigBoardState         | Text      | vide par defaut ; **nouvelle colonne a creer** - JSON du plateau de tuiles courant du mini-jeu de fouille (voir "Mini-jeu de fouille" plus bas) |
| KeyCount              | Numeric   | defaut 0, **nouvelle colonne a creer** - nombre de clefs secretes possedees (voir "Cartes secretes" plus bas). Affichee dans le header uniquement si `> 0` |

**Niveaux de profil** : purement cosmetique/motivant, base sur `Users.XP`
(cumulatif, jamais retire). Le niveau n'est **pas** stocke - il se calcule a
la volee partout ou il est affiche/utilise. Palier **croissant** : passer du
niveau `n` au niveau `n+1` coute `50*n` XP (50 pour le niveau 1, 100 pour le
niveau 2, 150 pour le niveau 3, etc. - `niveau n+1 = niveau n + 50`), donc le
cumul d'XP pour ETRE au niveau `L` vaut `25*L*(L-1)`. Formule inverse
utilisee partout (racine positive de `25*L^2 - 25*L - XP = 0`) :
`niveau = floor((25 + sqrt(625 + 100*XP)) / 50)`. Chaque franchissement de
niveau accorde automatiquement **+1 booster generique** (`Users.BoosterCount`),
calcule en comparant le niveau avant/apres le gain d'XP au moment de l'action
(peut accorder plusieurs boosters d'un coup si un gros gain d'XP fait sauter
plusieurs paliers). Sources d'XP actuelles : ouvrir un booster (+10,
`open-pack.json`), crafter une carte (+5, `craft.json`), tourner la roue
quotidienne (+5, `daily-wheel.json`), tenter un sacrifice a l'autel (+5,
que ca reussisse ou non, `altar-sacrifice.json`), conclure un echange (+5
**pour chacune des deux parties**, `trade.json`), restaurer une carte usee
(+5, `card-quality-repair.json`), fusionner une finition (+5,
`foil-upgrade.json`) et decrafter une carte (+5, `disenchant.json`) - ces
trois derniers ajoutes le 2026-09-29 (auparavant ces actions ne
rapportaient aucune XP, contrairement a toutes les autres actions "de
fond" du jeu).

`BoosterCount` est un stock unique, commun a toutes les extensions : un code
d'evenement de type `booster` ajoute des points generiques (`+N`, sans
preciser d'extension), et c'est l'utilisateur qui choisit lui-meme, au
moment d'ouvrir un booster, quelle extension il consomme avec ces points
(`open-pack.json` prend `{ userId, extensionId }`). Seul le compteur de pity
reste par extension, voir `BoosterInventory`.

**Connexion** : geree par `discord-login.json`. Le compte est identifie par
`DiscordId` ; `Pseudo` reste un champ libre que l'utilisateur peut modifier
ensuite via `update-pseudo.json`, il ne sert plus a la connexion.

## 5. Pulls

Historique / inventaire de chaque tirage individuel. C'est aussi la table qui
represente la possession reelle d'un exemplaire : un echange (`Trades`)
fonctionne en reassignant le champ `User` d'une ligne existante plutot qu'en
creant/detruisant des exemplaires.

| Colonne     | Type                 | Notes                                    |
|-------------|-----------------------|--------------------------------------------|
| User        | Reference -> Users     |                                             |
| Card        | Reference -> Cards     |                                             |
| ObtainedAt  | DateTime               |                                             |
| BatchId     | Text                   | regroupe les cartes d'un meme pack ouvert ou d'un meme code reclame |
| SerialNumber | Numeric               | numero de l'exemplaire pour cette carte, tous joueurs confondus (1er exemplaire jamais tire = 1, etc.), **unique parmi les exemplaires actuellement en circulation** de cette carte, sans plafond. Attribue au moment de la creation de la ligne comme le plus petit numero (1, 2, 3, ...) qui n'est PAS deja porte par une ligne `Pulls` existante de cette carte (jamais un simple compteur incremental) - un exemplaire decrafte/consomme/defausse (donc sa ligne `Pulls` supprimee) libere reellement son numero pour un futur tirage/craft/code/restauration/fouille. Sert a l'affichage "#004" cote front (voir "Numeros de serie - plus de quota" plus bas) |
| Finish       | Text                   | finition de cet exemplaire precis : `normal` (ou vide - traite comme `normal` partout, voir plus bas), `holo`, `gold`, `ghost`, `diamond`, `rainbow`, dans cet ordre croissant de prestige. Cosmetique, mais influence la valeur de decraft (voir `Finishes` plus haut et "Craft / decraft" plus bas). Voir "Finitions" plus bas |
| Quality      | Text                   | qualite de cet exemplaire precis : `damaged` (ou vide - traite comme `damaged` partout), `worn`, `good`, `mint`, dans cet ordre croissant. Meme principe que `Finish` : tirage naturel possible a l'ouverture ET influence la valeur de decraft (voir `Qualities` plus haut et "Restauration de cartes usees" plus bas) |

La "collection" d'un utilisateur = toutes les lignes `Pulls` ou `User` = lui,
regroupees par `Card` pour avoir un compteur (x2, x3...). C'est deja ce que
fait `get-collection.json` (`cards` = catalogue, `owned` = compteur par
carte, avec `owned[].serialNumbers` = la liste des numeros de serie possedes
et `owned[].finishCounts` = le nombre d'exemplaires par finition, ex.
`{normal: 3, holo: 1}`) ; le front (`collection.js`) affiche un badge `xN`
(et les numeros de serie), pas une carte repetee N fois. L'extension et la
rarete d'une carte se retrouvent via `Cards`, pas la peine de les dupliquer
sur `Pulls`.

## Finitions (foil upgrade)

`foil-upgrade.json` (POST `/foil-upgrade` `{ userId, cardId, fromFinish }`) :
fusionne **5 exemplaires identiques** (meme carte, meme `Finish`) en **1
seul** exemplaire de la finition immediatement superieure, selon l'echelle
fixe `normal -> holo -> gold -> ghost -> diamond -> rainbow` (definie cote
code dans `foil-upgrade.json` et dupliquee dans `craft.js`/`collection.js` -
si tu changes l'ordre, il faut le changer aux trois endroits). Contrairement
a l'autel de sacrifice, **deterministe** : pas de hasard, la fusion reussit
toujours si les 5 exemplaires sont reunis. Les 5 exemplaires sacrifies sont
supprimes de `Pulls` ; un nouvel exemplaire est cree a la finition
superieure, avec un nouveau `SerialNumber` (meme suivi de numeros que les
tirages/craft normaux - voir "Numeros de serie" ci-dessous). Une carte
promo ne peut pas etre fusionnee (`promo_not_upgradable`). Le front
(`craft.html`, onglet "Finitions") liste directement toutes les fusions
possibles pour le joueur (aucun palier de rarete a choisir, contrairement a
l'autel : n'importe lesquels des 5 exemplaires identiques font l'affaire).

Une finition speciale peut aussi sortir **naturellement** d'un booster reel
(pas seulement via fusion) : voir "Tirage a deux niveaux" dans la section
`Finishes` plus haut.

## Restauration de cartes usees (Qualite)

`card-quality-repair.json` (POST `/card-quality-repair` `{ userId, cardId,
fromQuality }`) : meme principe que les Finitions, sur l'echelle
`Pulls.Quality`. Fusionne **`Config.QualityRepairCost` exemplaires
identiques** (meme carte, meme `Quality`, defaut **3** si la colonne est
vide - reglable dans `admin.html` -> "Équilibrage du jeu", plus besoin de
toucher au code) en **1 seul** exemplaire de la qualite immediatement
superieure, selon l'echelle fixe `damaged -> worn -> good -> mint` (fixe
cote code, ce n'est QUE le nombre d'exemplaires requis qui est reglable).
Deterministe, pas de hasard. Les exemplaires consommes sont supprimes de
`Pulls` ; un nouvel exemplaire est cree a la qualite superieure avec un
nouveau `SerialNumber` (voir "Numeros de serie" ci-dessous). Une carte
promo ne peut pas etre restauree (`promo_not_repairable`).

**Bug reel trouve et corrige (2026-09-29)** : le filtre des exemplaires
consommables ne matche que sur `Quality` (pas sur `Finish`), donc les 3
(ou N) exemplaires reunis peuvent avoir des finitions differentes - or la
ligne recreee n'ecrivait JAMAIS de `Finish` du tout, ce qui la laissait
vide (= `normal` partout ailleurs dans le code) : restaurer la qualite
effacait silencieusement la finition de la carte (un exemplaire Holo
redescendait en Normal). Desormais la carte recreee reprend la finition
la PLUS PRESTIGIEUSE parmi les exemplaires consommes (jamais une perte de
valeur pour le joueur).

Comme les Finitions, la Qualite a maintenant un tirage naturel a
l'ouverture d'un booster (voir `Qualities` plus haut) - la restauration par
fusion reste le seul moyen de progresser en dehors des boosters (craft/
codes/autel produisent toujours `damaged`, jamais un tirage naturel).

**Numeros de serie - plus de quota (2026-09-28)** : chaque workflow qui
cree une ligne `Pulls` (`open-pack.json`, `craft.json`, `redeem-code.json`,
`altar-sacrifice.json`, `card-quality-repair.json`, `black-market.json`,
`unlock-secret.json`, le tresor "carte" de `dig.json`) suit precisement
QUELS numeros de serie sont deja utilises pour la carte visee (tous
joueurs, `Set` construit depuis `Pulls.SerialNumber`) - jamais un simple
compteur de lignes. Le nouvel exemplaire recoit le plus PETIT numero libre
(1, 2, 3, ... sans plafond) : si un exemplaire est decrafte/consomme
(fusion de finition ou de qualite)/sacrifie a l'autel/perdu au coffre de
guilde, son numero redevient immediatement disponible pour un futur tirage
plutot que de rester "brule" derriere un compteur qui ne redescend jamais.
**Il n'y a plus de limite globale par carte** (l'ancienne colonne
`Cards.MaxSerial` et l'erreur `sold_out` associee ont ete retirees de tout
le code cote API) : une carte reste obtenable indefiniment, seule la
REUTILISATION d'un numero deja en circulation est interdite. La colonne
`Cards.MaxSerial` peut rester dans la base (vestige, plus lue par aucun
workflow) ou etre supprimee, au choix.

## 6. Config

Une seule ligne, parametres globaux du gacha (communs a toutes les
extensions ; seul le compteur de progression vers la pity est par extension,
voir `BoosterInventory`). Editable depuis `admin.html` (section "Équilibrage
du jeu"), pas seulement a la main dans admin-db.html - voir `admin-config.json`.

| Colonne                     | Type                  | Notes                                  |
|------------------------------|------------------------|------------------------------------------|
| PityThreshold                | Numeric                | nb de tirages sans legendaire avant garantie (ex: 40) |
| TopRarity                    | Reference -> Rarities  | la rarete garantie par la pity (ex: Legendaire) |
| DigMaxEnergy                 | Numeric                | **nouvelle colonne** - defaut 5 si vide ; energie max du mini-jeu de fouille |
| DigRegenSeconds              | Numeric                | **nouvelle colonne** - defaut 60 si vide ; secondes pour regagner 1 point d'energie de fouille |
| DailyQuestThreshold          | Numeric                | **nouvelle colonne** - defaut 2 si vide ; nb de quetes du jour (sur 4) a completer pour la recompense |
| DailyQuestRewardBoosters     | Numeric                | **nouvelle colonne** - defaut 2 si vide ; boosters gagnes en completant les quetes du jour |
| WeeklyQuestThreshold         | Numeric                | **nouvelle colonne** - defaut 3 si vide ; nb de quetes de la semaine (sur 4) a completer pour la recompense |
| WeeklyQuestRewardBoosters    | Numeric                | **nouvelle colonne** - defaut 5 si vide ; boosters gagnes en completant les quetes de la semaine |
| WeeklyQuestTarget            | Numeric                | **nouvelle colonne** - defaut 5 si vide ; occurrences requises par quete de la semaine (ex: 5 connexions) |
| QualityRepairCost            | Numeric                | **nouvelle colonne** - defaut 3 si vide ; nombre d'exemplaires identiques requis par palier de restauration de qualite (voir "Restauration de cartes usees" plus bas) |
| BannerEnabled                | Bool                    | **nouvelle colonne** - defaut false/vide ; affiche ou non le bandeau du site (voir "Bandeau du site" plus bas) |
| BannerType                   | Text                    | **nouvelle colonne** - `info` ou `maintenance` (defaut `info` si vide) ; change juste la couleur/l'icone cote front |
| BannerMessage                | Text                    | **nouvelle colonne** - texte affiche dans le bandeau ; bandeau invisible si vide meme si `BannerEnabled` est coche |
| MaintenanceMode               | Bool                    | **nouvelle colonne a creer (2026-09-29)** - defaut false/vide ; separe du bandeau cosmetique ci-dessus : quand actif, redirige tout le trafic NON-ADMIN vers `maintenance.html` (verification cote client dans `main.js` via `Session.isAdmin()`, purement UX - pas une barriere de securite, les endpoints restent joignables). Colonne creee automatiquement au demarrage de l'API si elle manque. |
| ThemeUnlockMonochrome         | Numeric                 | **nouvelle colonne** - defaut 3 si vide ; niveau de deblocage du theme Monochrome |
| ThemeUnlockSepia              | Numeric                 | **nouvelle colonne** - defaut 5 si vide ; niveau de deblocage du theme Sépia |
| ThemeUnlockCyberpunk          | Numeric                 | **nouvelle colonne** - defaut 8 si vide ; niveau de deblocage du theme Cyberpunk |
| FeatureUnlockCraft            | Numeric                 | **nouvelle colonne** - defaut 2 si vide ; niveau de deblocage de l'onglet Crafter |
| FeatureUnlockTrade            | Numeric                 | **nouvelle colonne** - defaut 3 si vide ; niveau de deblocage des echanges (trade.html) |
| FeatureUnlockAltar            | Numeric                 | **nouvelle colonne** - defaut 4 si vide ; niveau de deblocage de l'autel de sacrifice |
| FeatureUnlockQuality          | Numeric                 | **nouvelle colonne** - defaut 4 si vide ; niveau de deblocage de la restauration de cartes usees |
| FeatureUnlockFinish           | Numeric                 | **nouvelle colonne** - defaut 5 si vide ; niveau de deblocage des fusions de finition |
| FeatureUnlockShowcase         | Numeric                 | **nouvelle colonne** - defaut 6 si vide ; niveau de deblocage de la vitrine de profil |
| SleeveUnlockNeon              | Numeric                 | **nouvelle colonne** - defaut 4 si vide ; niveau de deblocage de la pochette Neon |
| SleeveUnlockVintage           | Numeric                 | **nouvelle colonne** - defaut 6 si vide ; niveau de deblocage de la pochette Vintage |
| SleeveUnlockCarbone           | Numeric                 | **nouvelle colonne** - defaut 10 si vide ; niveau de deblocage de la pochette Carbone |

Toutes les colonnes `Numeric` ci-dessus tolerent une cellule vide (chaque
workflow qui les lit retombe sur la valeur par defaut listee). Les colonnes
elles-memes sont creees automatiquement au demarrage de l'API si elles
manquent (voir "Colonnes : creees automatiquement" en bas de ce document).

## Déblocages par niveau de profil

Meme pattern que le bandeau : jusqu'ici les niveaux de deblocage (themes,
onglets craft/echanges/autel/restauration/finitions/vitrine, pochettes de
carte) etaient des nombres codes en dur dans `main.js`
(`THEME_UNLOCK_LEVEL`/`FEATURE_UNLOCK_LEVEL`) et dans `collection.html`
(`data-level` sur chaque `.sleeve-swatch`) - aucune des deux sources n'etait
pilotable depuis l'admin. Desormais :
- `get-unlock-config.json` (GET `/unlock-config`, public, sans auth - lu sur
  CHAQUE page comme le bandeau) renvoie `{ themes, features, sleeves }`
  depuis `Config` (colonnes ci-dessus) et fusionne ces valeurs DANS les
  objets JS existants (`main.js`, `loadUnlockConfig()`) au lieu de les
  remplacer - toute verification deja ecrite ailleurs (craft.js,
  collection.js, trade.js, `cycleTheme()`) en profite automatiquement.
- `admin-config.json` (action `get`/`set`, section "Déblocages par niveau de
  profil" de `admin.html`) permet a l'admin d'editer ces 12 valeurs sans
  toucher la base directement.
- La page d'accueil (`index.html`) affiche desormais la liste complete
  "Niveau X -> debloque Y", triee par niveau croissant, depuis ce meme
  endpoint public - toujours a jour avec ce que l'admin a configure.

## Bandeau du site

Remplace l'ancien bandeau "Version bêta" fige en dur dans `main.js` : lu
depuis `Config` (voir ci-dessus), editable dans `admin.html` (section
"Bandeau du site") via `admin-config.json` (memes actions `get`/`set` que le
reste de l'equilibrage - pas un workflow separe pour l'edition). **Une seule
petite difference** : la LECTURE publique (executee sur CHAQUE page, par
tous les visiteurs y compris non connectes) passe par un workflow dedie et
tres leger, `get-site-banner.json` (GET `/site-banner`, sans authentification
- ne renvoie que `{ enabled, type, message }`, jamais le reste de `Config`)
plutot que par `admin-config.json` qui est gate admin. `main.js`
(`loadSiteBanner()`) l'appelle a chaque chargement de page et insere le
bandeau seulement si `enabled` est vrai ET `message` non vide.

**Mode maintenance (2026-09-29)** : bouton separe dans la meme section
admin.html ("Activer le mode maintenance"), pilote par `Config.MaintenanceMode`
(colonne a creer, voir tableau `Config` plus haut) - contrairement au bandeau
qui est purement cosmetique, ce mode REDIRIGE reellement. `get-site-banner.json`
renvoie aussi `maintenanceMode` dans sa reponse ; `main.js`
(`checkMaintenanceMode()`, appelee en tout premier dans le handler
`DOMContentLoaded`, avant meme `renderHeader()`) redirige vers
`maintenance.html` (nouvelle page statique, sans header/nav) des que
`maintenanceMode` est vrai, **sauf pour les admins** (`Session.isAdmin()`,
meme liste `adminDiscordIds` que partout ailleurs cote front). Purement une
verification cote client par confort UX - les routes de l'API restent toutes
joignables pendant la maintenance, ce n'est pas une barriere de securite.
`maintenance.html` s'auto-rafraichit toutes les 20s (`get-site-banner`) pour
revenir automatiquement sur `index.html` des que la maintenance est levee,
sans que le joueur ait besoin de rafraichir lui-meme.

## 7. EventCodes

Un code cree par un admin pour un evenement, distribue oralement/a l'ecran
aux participants pendant sa duree de validite.

| Colonne         | Type                   | Notes                                   |
|------------------|------------------------|-------------------------------------------|
| Code             | Text                    | code a saisir sur le site (unique, genere ou choisi par l'admin) |
| Label            | Text                    | note interne optionnelle, ex "Soiree jeux 20/09" |
| RewardType       | Text                    | `booster` (ajoute des boosters generiques, toutes extensions) ou `card` (donne directement des exemplaires d'une carte precise, y compris une carte promo) |
| Quantity         | Numeric                 | nb de boosters, ou nb d'exemplaires de la carte |
| CardId           | Reference -> Cards      | rempli seulement si `RewardType = card` |
| MaxRedemptions   | Numeric                 | nb max d'utilisateurs differents pouvant reclamer ce code ; 0 ou vide = illimite. Un meme utilisateur ne peut de toute facon reclamer un code qu'une seule fois (voir `CodeRedemptions`). **`redeem-code.json` revalide cette limite apres-coup (2026-09-30)** en cas de reclamations simultanees (le cas reel : un code annonce en direct pendant un evenement) - voir "Securite en cas d'acces concurrent" plus bas |
| ExpiresAt        | DateTime                | epoch secondes ; passe cette date, le code n'est plus utilisable |
| Active           | Bool                    | permet a l'admin de desactiver un code avant son expiration |
| CreatedAt        | DateTime                | |
| CreatedBy        | Text                    | DiscordId de l'admin qui a cree le code |
| StartsAt         | DateTime                | epoch secondes, optionnel ; vide = deja visible/actif des sa creation. Sert uniquement au calendrier public (voir "Calendrier evenementiel" plus bas) - n'empeche PAS la reclamation du code avant cette date, c'est juste une info d'affichage |

## Calendrier evenementiel

`get-event-calendar.json` (GET `/event-calendar`, public, sans authentification) :
expose les evenements `EventCodes` actifs et pas encore expires, **jamais le
`Code` lui-meme** (reste secret, distribue oralement/a l'ecran) - seulement
`{label, startsAt, expiresAt, isLive}` (`isLive` = vrai si `startsAt` est
deja passe ou vide). Sert a afficher "prochainement" / "en cours" sur une
page publique, sans jamais reveler comment reclamer la recompense.

## Wishlist

Cartes qu'un utilisateur recherche activement, pour faciliter les echanges
avec les autres membres (visible sur le profil/dans l'outil d'echange).

| Colonne | Type                | Notes |
|---------|----------------------|-------|
| User    | Reference -> Users   | |
| Card    | Reference -> Cards   | |

## ProfileShowcase

Jusqu'a 5 cartes qu'un joueur choisit de mettre en avant sur son profil
public (`profile.html`) - purement cosmetique, aucun effet sur le gameplay.
Gere par `showcase.json` (POST `/showcase` `{ userId, action: 'add'|'remove'|'list', cardId }`),
expose publiquement via `get-public-profile.json` (`showcase: [...]`, dans
l'ordre `SortOrder`). Ajouter une carte non possedee echoue avec
`card_not_owned` ; ajouter une 6e carte echoue avec `showcase_full` ; ajouter
une carte deja presente ou retirer une carte absente est un no-op (comme
`Wishlist`). Une carte affichee qui est ensuite echangee/perdue disparait de
l'affichage public (mais reste dans la table) sans que le joueur ait besoin
de nettoyer sa vitrine lui-meme.

| Colonne   | Type                | Notes                                       |
|-----------|----------------------|----------------------------------------------|
| User      | Reference -> Users   |                                                |
| Card      | Reference -> Cards   |                                                |
| SortOrder | Numeric              | ordre d'affichage (ordre d'ajout : le premier ajoute a `SortOrder = 0`, etc.) |

## DailyQuests

Une ligne par couple (User, jour). 4 quetes quotidiennes fixes ; en
completer 2 sur 4 debloque 1 booster gratuit, **reclame via un bouton
"Réclamer" cote joueur (2026-09-30) plutot qu'accorde automatiquement a la
simple consultation** (voir `RewardClaimed`). Cree/mise a jour par
`quests.json` (quete "se connecter", au premier chargement de la page qui
consulte les quetes du jour) et par une branche additionnelle dans
`craft.json` (crafter une carte), `trade.json` (proposer un echange) et
`open-pack.json` (ouvrir un booster reel, pas en mode test admin).

`quests.json` distingue desormais `action: 'status'` (lecture seule - coche
les quetes/la serie de connexion mais N'ACCORDE JAMAIS le gain) de
`action: 'claim'` (n'accorde le gain que si le seuil est atteint et pas deja
reclame ce jour-la). La reponse inclut `canClaim` (true des que le seuil est
atteint et non reclame - sert au front a afficher le bouton) en plus de
`rewardClaimed`/`justClaimedReward` (true seulement sur l'appel qui vient de
reclamer avec succes). La serie de connexion (streak, bonus tous les 3/7/14/
30 jours) reste, elle, automatique des la premiere consultation du jour -
seul le gain des 4 quetes est desormais manuel.

| Colonne          | Type                | Notes                                    |
|-------------------|----------------------|---------------------------------------------|
| User              | Reference -> Users   |                                              |
| Date              | Text                  | jour au format `AAAA-MM-JJ` (UTC), pas un DateTime : on compare des jours calendaires, pas des instants |
| LoginDone         | Bool                  | vrai des que le joueur consulte ses quetes du jour |
| CraftDone         | Bool                  | vrai apres un craft reussi ce jour-la       |
| TradeDone         | Bool                  | vrai apres la creation d'une proposition d'echange |
| OpenBoosterDone   | Bool                  | vrai apres l'ouverture d'un booster reel    |
| RewardClaimed     | Bool                  | passe a `true` des que 2 quetes sur 4 sont vraies le meme jour ; `Users.BoosterCount` recoit alors +1 automatiquement |

## WeeklyQuests

Une ligne par couple (User, semaine). 4 quetes hebdomadaires fixes, mais
**a base de compteurs (0-5), pas de simples cases a cocher** comme
`DailyQuests` - chaque quete demande **5 occurrences** de l'action dans la
semaine (5 connexions un jour different, 5 crafts, 5 echanges proposes, 5
boosters ouverts), pas juste une seule fois. En completer 3 des 4 (chaque
compteur atteint 5) debloque 5 boosters gratuits, **reclames via un bouton
"Réclamer" (2026-09-30, meme principe que `DailyQuests` ci-dessus - `action:
'status'` vs `'claim'`, reponse avec `canClaim`) plutot qu'accordes
automatiquement**. Semaine = lundi-dimanche, fuseau
Europe/Paris (`WeekStart` = date du lundi, format `AAAA-MM-JJ`). Cree/mise a
jour par `weekly-quests.json` (increment de connexion, au premier
chargement de la page qui consulte les quetes de la semaine CE JOUR-LA
uniquement - voir `LastLoginCountedDate`) et par les memes branches
additionnelles que `DailyQuests` dans `craft.json`, `trade.json` et
`open-pack.json` (chacune incremente son propre compteur EN PLUS de cocher
la quete du jour correspondante, dans la meme requete).

| Colonne              | Type                | Notes                                    |
|-----------------------|----------------------|---------------------------------------------|
| User                  | Reference -> Users   |                                              |
| WeekStart             | Text                  | lundi de la semaine, format `AAAA-MM-JJ` (Europe/Paris) - pas un DateTime, meme logique que `DailyQuests.Date` |
| LoginCount            | Numeric               | nombre de JOURS DIFFERENTS ou les quetes de la semaine ont ete consultees (voir `LastLoginCountedDate` pour le garde-fou anti-doublon), objectif 5 |
| CraftCount            | Numeric               | nombre de crafts reussis cette semaine, objectif 5 (chaque craft compte, pas de limite a 1/jour) |
| TradeCount            | Numeric               | nombre de propositions d'echange creees cette semaine, objectif 5 |
| OpenBoosterCount      | Numeric               | nombre de boosters reels ouverts cette semaine, objectif 5 |
| LastLoginCountedDate  | Text                  | `AAAA-MM-JJ` (Europe/Paris) du dernier jour ou `LoginCount` a ete incremente - empeche de compter 5 fois la meme journee en rafraichissant la page. **Bug reel trouve et corrige (2026-09-29)** : L'ancienne base stockait cette colonne en Date/DateTime plutot que Text (meme piege que `Bingo.Month`), donc la lecture renvoyait un nombre d'epoch-secondes au lieu de la chaine ecrite - la comparaison `string !== number` etait alors TOUJOURS vraie et `LoginCount` s'incrementait a CHAQUE appel (donc a chaque rafraichissement de page) au lieu d'une fois par jour. `weekly-quests.json` normalise desormais la valeur lue avant de comparer (`dateKey()`), quel que soit le type reel de la colonne - verifier/corriger quand meme le type de la colonne (admin-db.html) est recommande mais plus strictement necessaire |
| RewardClaimed         | Bool                  | passe a `true` des que 3 des 4 compteurs ci-dessus atteignent 5 la meme semaine ; `Users.BoosterCount` recoit alors +5 automatiquement |

## 8. CodeRedemptions

Une ligne par reclamation reussie. Sert a bloquer la double reclamation d'un
meme code par un meme utilisateur et a compter les usages face a
`MaxRedemptions`.

| Colonne     | Type                    | Notes |
|-------------|--------------------------|-------|
| Code        | Reference -> EventCodes  | |
| User        | Reference -> Users       | |
| RedeemedAt  | DateTime                 | |

## 9. Trades

Un echange cible entre deux utilisateurs : `FromUser` propose sa carte
`OfferedCard` contre la carte `RequestedCard` de `ToUser`. `ToUser` accepte,
refuse, ou repond par une contre-proposition. Une carte promo
(`Cards.IsPromo = true`) ne peut etre ni proposee ni demandee : `trade.json`
refuse la creation avec l'erreur `promo_not_tradeable`.

| Colonne         | Type                  | Notes                                  |
|------------------|------------------------|------------------------------------------|
| FromUser         | Reference -> Users      | initiateur de l'echange                 |
| ToUser           | Reference -> Users      | destinataire, doit accepter/refuser     |
| OfferedCard      | Reference -> Cards      | carte proposee par `FromUser`           |
| OfferedPull      | Reference -> Pulls      | exemplaire PRECIS (numero de serie) que `FromUser` met dans l'echange, choisi des la creation - plus un exemplaire pris au hasard parmi ses doublons |
| RequestedCard    | Reference -> Cards      | carte demandee en retour a `ToUser` (vide = don, sans contrepartie) |
| RequestedPull    | Reference -> Pulls      | exemplaire PRECIS que `ToUser` donne en retour, choisi seulement au moment ou il accepte (vide tant que l'echange est `pending`, et pour un don) |
| CounterOf        | Reference -> Trades     | rempli seulement si cet echange est une contre-proposition : pointe vers l'echange d'origine que `ToUser` a refuse en l'etat |
| Status           | Text                    | `pending`, `accepted`, `declined`, `cancelled`, `countered` (l'echange d'origine passe a `countered` des qu'une contre-proposition est envoyee - il n'est plus actionnable, seule la contre-proposition l'est) |
| CreatedAt        | DateTime                | |
| RespondedAt      | DateTime                | rempli quand `ToUser` repond, que `FromUser` annule, ou que l'echange est remplace par une contre-proposition |

A la creation (`trade.json`, action `create` ou `counter`), le proposeur
choisit lui-meme quel exemplaire precis de sa carte il met dans l'echange
(`offeredPullId` dans la requete, valide contre ses propres `Pulls`) - stocke
dans `OfferedPull`. A l'acceptation (action `respond`, `accept: true`), le
workflow revalide que `OfferedPull` appartient toujours a `FromUser` (il a pu
partir dans un AUTRE echange accepte entre-temps), et `ToUser` choisit a son
tour quel exemplaire precis il donne en retour (`requestedPullId` dans la
requete, obligatoire des qu'il y a une contrepartie - erreur
`pull_not_chosen` sinon) ; le workflow reassigne alors le champ `User` de ces
deux lignes `Pulls` (pas de creation/suppression de ligne : un exemplaire
change juste de proprietaire).

**Contre-proposition** (action `counter`, meme forme que `create` mais avec
`originalTradeId` a la place de `toPseudo` - la cible est deduite de
l'echange d'origine) : reserve a `ToUser` de l'echange d'origine, seulement
si celui-ci est encore `pending`. Cree un nouvel echange (roles inverses,
`CounterOf` renseigne) et bascule l'echange d'origine sur `Status =
'countered'` dans la meme operation.

## 10. BoosterInventory

**Uniquement le compteur de pity**, par extension (le solde de boosters,
lui, est generique : voir `Users.BoosterCount`). Une ligne par couple (User,
Extension), creee la premiere fois qu'un utilisateur ouvre un booster de
cette extension (`open-pack.json`).

| Colonne              | Type                    | Notes                              |
|-----------------------|--------------------------|---------------------------------------|
| User                  | Reference -> Users        | |
| Extension             | Reference -> Extensions   | |
| PullsSinceTopRarity   | Numeric                   | compteur de pity, independant par extension |

**Economie des boosters** : plus de recharge automatique ni de plafond.
`Users.BoosterCount` (le stock, generique) ne bouge que via deux mecanismes :
- +N quand un utilisateur reclame un code d'evenement de type `booster`
  (`redeem-code.json`) ;
- -1 quand un utilisateur ouvre un booster, **quelle que soit l'extension
  choisie** (`open-pack.json`, qui tire toujours 5 cartes d'un coup,
  exclusivement parmi les cartes actives et non-promo de l'extension
  choisie). Seule la progression vers la pity (`BoosterInventory.PullsSinceTopRarity`)
  est propre a l'extension ouverte.

## Craft / decraft (poussieres d'etoile)

Systeme a la Hearthstone, base sur les colonnes `Users.StardustCount`
(le solde, global) et `Rarities.DisenchantValue`/`Rarities.CraftCost` (les
montants, par rarete). Pas de nouvelle table : juste deux nouveaux
workflows.

- `disenchant.json` (POST `/disenchant` `{ userId, cardId }`) : verifie que
  l'utilisateur possede au moins un exemplaire de la carte (`Pulls`) et
  qu'elle n'est **pas** promo, **supprime une ligne `Pulls`** correspondante
  (l'exemplaire est detruit, pas reassigne comme pour un echange) et credite
  `Users.StardustCount` de `Rarities.DisenchantValue * Finishes.DisenchantMultiplier
  * Qualities.DisenchantMultiplier` (arrondi) de sa rarete/finition/qualite.
  Si le joueur possede plusieurs exemplaires pour la meme carte, l'exemplaire
  le moins prestigieux est **toujours** decrafte en premier - trie d'abord
  par finition (jamais un holo/gold/... par erreur tant qu'il reste un
  exemplaire `normal`), puis par qualite parmi les doublons de meme finition
  (jamais un `mint` par erreur tant qu'il reste un exemplaire moins abime).
- `craft.json` (POST `/craft` `{ userId, cardId }`) : verifie que la carte
  est active et non-promo, que `Users.StardustCount >= Rarities.CraftCost`
  de sa rarete, debite le cout et **cree une ligne `Pulls`** (comme un
  tirage normal, `BatchId` prefixe `craft-`).

Une carte promo n'est ni decraftable ni craftable : elle reste exclusivement
obtenable via un code d'evenement (`EventCodes`, `RewardType=card`).

**Exception (2026-09-30)** : une carte `IsSecret` reste promo (toujours
exclue du craft, de l'echange, du coffre de guilde...) mais **PEUT** etre
decraftee - contre **1 booster fixe**, jamais des poussieres (une carte
secrete n'a pas de valeur de decraft coherente en poussieres). Reponse de
`disenchant.json` enrichie d'un `boosterGranted` (bool) pour que le front
sache afficher "+1 booster" plutot que "+X poussières".

---

## Roue de la fortune quotidienne

`daily-wheel.json` (POST `/daily-wheel` `{ userId, action: 'status'|'spin' }`).
Un seul tirage par jour et par joueur, base sur `Users.LastWheelSpinDate`
(fuseau Paris, meme logique que `DailyQuests`). Lots ("mix prudent", pas de
carte directe pour ne jamais court-circuiter les raretes fortes) - table
enrichie le 2026-09-30 (2 nouveaux paliers, une clef secrete et un jackpot
rare) :
- 50% : petite quantite de poussieres d'etoile (10-25)
- 20% : grosse quantite de poussieres d'etoile (50-100)
- 15% : 1 booster generique
- 10% : 1 clef secrete (`Users.KeyCount`, voir "Cartes secretes" plus bas et
  "Coffre-fort" ci-dessous - meme monnaie que ces deux fonctionnalites)
- 5% : jackpot - 2 boosters ET 100 poussieres d'etoile d'un coup

Le SVG de la roue (`index.html`) a ete redessine en 12 secteurs (au lieu de
8) pour representer visuellement les 5 paliers ; comme avant, le NOMBRE de
secteurs par type est purement cosmetique (variete visuelle de la case sur
laquelle on peut s'arreter), la vraie probabilite est entierement decidee
par le tirage serveur ci-dessus avant meme que le front ne fasse tourner la
roue.

## Coffre-fort (autre utilite des clefs secretes)

Deuxieme debouche pour `Users.KeyCount` (2026-09-30, en plus de la serrure
cachee ci-dessous) : une page "Coffre-fort" (nouvel onglet de `jeux.html`,
a cote de Fouille/Bingo) montre EN PERMANENCE une carte precise - visible,
mais enfermee derriere des barreaux tant que le joueur n'a pas **6 clefs
secretes**. Deverrouillage **definitif, une seule fois par joueur** (pas
repetable) : une fois ouvert, le joueur garde la carte pour toujours et la
page affiche juste un message de felicitations a la place.

**`Cards.IsVault`** (Bool, **nouvelle colonne a creer**) : marque LA carte
qui vit dans le coffre-fort. A poser sur UNE seule carte, en plus de
`IsPromo=true` (c'est une carte promo, comme les cartes secretes) ; mettre
aussi son `Finish` de reference sur "rainbow" (admin-db.html) si tu veux qu'elle
s'affiche deja arc-en-ciel ailleurs, meme si `vault.json` force de toute
facon `Finish=rainbow` sur la ligne `Pulls` creee a l'ouverture.

`vault.json` (POST `/vault` `{ userId, action: 'status'|'open' }`) :
- `status` : trouve la carte marquee `IsVault`, retourne
  `{ card: {cardId,name,artist,imageId}, keysRequired: 6, userKeys,
  alreadyOpened }`. Repond `{ error: 'vault_not_configured' }` si aucune
  carte n'a encore `IsVault=true`.
- `open` : refuse si `alreadyOpened` (`error: 'already_opened'`) ou si
  `Users.KeyCount < 6` (`error: 'not_enough_keys'`) ; sinon decremente
  `KeyCount` de 6 et cree une ligne `Pulls` (`Finish: 'rainbow'`, numero de
  serie via le suivi habituel "plus petit numero libre", `BatchId` prefixe
  `vault-`). **Pas de colonne d'etat dediee** : comme `craft-`/`secret-`/
  `dig-`, on sait qu'un joueur a deja ouvert le coffre s'il possede une
  ligne `Pulls` de la carte du coffre avec un `BatchId` commencant par
  `vault-` - meme convention que partout ailleurs dans le projet.

## Cartes secretes (clef + serrure cachee, remplace l'ancien Konami code)

**`Users.KeyCount`** (Numeric, colonne a CREER si absente) : nombre de clefs
secretes possedees par le joueur. Affichee dans le header (a cote des
poussieres d'etoile) uniquement quand elle est `> 0` (voir
`get-booster-status.json`'s champ `keys` et `main.js`'s `#header-key-badge`).

**Obtention d'une clef** : `dig.json`'s action `dig` fait un tirage
INDEPENDANT de 2% de chance a chaque case creusee (que la case contienne
deja un tresor ou non) - voir `foundKey`/`newKeyCount` dans `Dispatch
Action` et le champ `KeyCount` ajoute a `Update User`. Le front (`jeux.js`)
affiche un toast + confettis quand `res.foundKey` est vrai.

**Depense d'une clef** : `unlock-secret.json` (POST `/unlock-secret`
`{ userId }`) exige desormais `Users.KeyCount >= 1` (sinon `{ error: 'no_key'
}`, 400) et decremente la clef que le tirage reussisse ou non. Tire une
carte au hasard parmi celles marquees `Cards.IsSecret = true` (qui doivent
aussi avoir `IsPromo = true` - voir plus haut), cree une ligne `Pulls`
(`BatchId` prefixe `secret-`) exactement comme un tirage normal (numero de
serie attribue par le meme suivi "plus petit numero libre", voir "Numeros de
serie - plus de quota" plus haut). Repond `{ error: 'no_secret_available' }`
(400) si aucune carte `IsSecret` n'existe encore (la clef est quand meme
consommee) - **il faut qu'un admin cree/flague au moins une carte
`IsSecret=true` + `IsPromo=true` (admin-db.html) pour que l'easter egg puisse
jamais donner quelque chose**.

**Serrure cachee** : sur `redeem.html` (page "Code"), cliquer 5 fois sur
l'icone cadeau (`#redeem-gift-icon`) la decale sur le cote et revele une
serrure (`#redeem-lock-icon`, purement cote client, voir `redeem.js`) ;
cliquer la serrure appelle `/unlock-secret`. L'ancien listener Konami-code
site-wide (`main.js`) a ete retire - ce mecanisme est desormais le seul
chemin vers les cartes secretes.

**Invisibilite en collection (extension `pack-secretes`, 2026-09-30)** :
les cartes dont `Extension.Key = 'pack-secretes'` n'apparaissent PAS dans
`get-collection.json` tant qu'elles n'ont pas ete obtenues - ni la carte
(pas meme une case "???" verrouillee, contrairement a toute autre carte non
possedee) ni la categorie/extension elle-meme (le regroupement par
extension de `collection.js` n'affiche naturellement aucun groupe vide,
puisque le filtre est fait cote backend). Des qu'un exemplaire est trouve,
la carte ET la categorie apparaissent - les AUTRES cartes secretes encore
non trouvees restent, elles, invisibles individuellement. Filtre applique
uniquement dans `get-collection.json` (jamais dans `get-cards.json`,
toujours utilise tel quel par l'admin pour le don de cartes - voir plus
haut "le don à un joueur via admin doit pouvoir donner... les secrètes").
`Cards.IsSecret` est desormais aussi expose par `get-collection.json` (en
plus de `get-cards.json` deja avant) pour permettre au front de distinguer
une carte secrete d'une carte promo normale (voir decraft ci-dessous).

**Decraftable en exception (2026-09-30)** : voir "Craft / decraft" plus
haut - une carte secrete reste promo mais peut etre decraftee contre 1
booster fixe (jamais de poussieres).

## Récompenses de niveau (100 paliers)

Table en plus du +1 booster/niveau fixe deja existant (voir "4. Users" plus
haut) : un admin peut configurer, pour chaque niveau de 1 a 100, une
combinaison de poussieres d'etoile / boosters / une carte precise a donner
EN PLUS quand le joueur atteint ce niveau.

**Nouvelle table `LevelRewards`** (a creer) :

| Colonne      | Type                   | Description |
|--------------|------------------------|-------------|
| Level        | Numeric                | 1 a 100, un seul row par niveau |
| DustReward   | Numeric                | defaut 0, poussieres d'etoile donnees a ce palier |
| BoosterReward| Numeric                | defaut 0, boosters donnes a ce palier |
| CardReward   | Reference -> Cards     | optionnel (vide = pas de carte a ce palier) |

Un palier sans ligne du tout, ou une ligne a 0/0/vide, ne donne simplement
rien - l'admin n'a pas besoin de remplir les 100 lignes pour que la
fonctionnalite marche (voir `admin.html`, section "Récompenses de niveau").

**`Users.LastRewardedLevel`** (Numeric, defaut 0, **nouvelle colonne a
creer**) : plus haut niveau dont les recompenses de palier ont deja ete
reclamees, empeche de re-donner les memes recompenses a chaque appel.

`level-rewards.json` (POST `/level-rewards`), dispatch sur `action` :
- `status` `{ userId }` (public) : calcule le niveau actuel depuis `Users.XP`
  (meme formule que partout ailleurs) et compare a `LastRewardedLevel` ;
  retourne `{ currentLevel, lastRewardedLevel, hasPending, pendingLevels }`.
- `claim` `{ userId }` (public) : recalcule les paliers en attente
  server-side (ne fait jamais confiance a un niveau envoye par le client),
  somme les `DustReward`/`BoosterReward` de tous les paliers entre
  `LastRewardedLevel+1` et le niveau actuel, cree une ligne `Pulls` par
  palier ayant une `CardReward` (numero de serie via le suivi habituel
  "plus petit numero libre", `BatchId` prefixe `levelup-`), puis met a jour
  `Users.StardustCount`/`BoosterCount`/`LastRewardedLevel` en un seul appel.
  Repond `{ claimed, fromLevel, toLevel, dustGained, boostersGained, cards,
  newStardust, newBoosterCount }`.
- `adminList`/`adminSet` `{ discordId, rows? }` (memes `adminDiscordIds`
  hardcodes que partout ailleurs) : `adminList` retourne les 100 paliers
  (ceux sans ligne remontent a 0/0/vide) avec le `rowId` de
  chaque ligne existante (`null` si le palier n'a pas encore de ligne) ;
  `adminSet` recoit les 100 lignes d'un coup et fait, pour chacune, une
  creation ou une mise a jour selon que `rowId` est fourni ou non
  (voir `admin.html`, bouton "Enregistrer les 100 paliers" - un seul appel
  qui met a jour tout d'un coup, pas 100 requetes separees).

Front : `index.html` affiche un bandeau "Réclamer" dans le panneau
Progression des qu'un palier est en attente (`#level-claim-banner`), a cote
du +1 booster/niveau fixe qui reste, lui, automatique et non affiche ici.

## Autel de sacrifice

`altar-sacrifice.json` (POST `/altar-sacrifice` `{ userId, rarityKey }`).
Sacrifie 3 cartes non-promo de la rarete choisie (n'importe lesquelles,
supprimees definitivement des `Pulls` du joueur) pour tenter d'obtenir une
carte aleatoire non-promo de la rarete immediatement superieure (par
`Rarities.SortOrder`). 50% de reussite quel que soit le palier ; en cas
d'echec, les 3 cartes sont perdues sans contrepartie. Indisponible depuis la
rarete la plus haute (pas de palier au-dessus).

---

## Badges

Cosmetique pur, achete avec des poussieres d'etoile (meme monnaie que
craft/decraft), affiche sur le profil (public et prive).

| Table         | Colonne     | Type                    | Notes |
|----------------|-------------|--------------------------|-------|
| BadgeCatalog   | Key         | Text                     | slug unique, ex `pionnier` |
| BadgeCatalog   | Name        | Text                     | libelle affiche |
| BadgeCatalog   | Description | Text                     | phrase courte |
| BadgeCatalog   | Icon        | Text                     | emoji ou code Unicode affiche a cote du pseudo |
| BadgeCatalog   | DustCost    | Numeric                  | cout d'achat en poussieres d'etoile |
| UserBadges     | User        | Reference -> Users       | |
| UserBadges     | BadgeKey    | Text                     | `Key` du badge debloque (pas une Reference - simple correspondance par slug, comme `Pulls.Finish`) |
| UserBadges     | UnlockedAt  | DateTime                 | |

`badges.json` (POST `/badges` `{ userId, action: 'list'|'buy'|'select', badgeKey? }`) :
- `buy` : debite `DustCost`, cree une ligne `UserBadges` ; **idempotent** si
  deja possede (pas de recharge, repond simplement le succes).
- `select` : pose `Users.SelectedBadge` - echoue avec `badge_not_owned` si le
  joueur ne possede pas ce badge.
- `list` : catalogue complet avec `owned`/`selected` par badge.
Le badge selectionne est expose publiquement par `get-public-profile.json`
(`selectedBadge: { key, name, icon } | null`), a afficher a cote du pseudo
partout ou il apparait (comme `level`).
**L'admin ajoute les lignes `BadgeCatalog` a la main (admin-db.html)** -
le workflow ne fait que lire/vendre un catalogue existant, il ne peut pas en
inventer le contenu.

## Boss communautaire (fusion Donations + Boss)

Feature fusionnee sur demande explicite : au lieu d'un simple compteur de
dons ("Donations au Grand 2GETHER") ET d'un boss separe ("Boss
communautaire"), **une seule mecanique** - donner une carte, c'est attaquer
le boss commun. `CommunityChest` (ancienne table de dons) est **desormais
superflue/inutilisee** par ce design ; laisse en l'etat dans la base (pas
supprimee automatiquement), a nettoyer a la main si tu veux.

| Table              | Colonne         | Type                       | Notes |
|---------------------|-----------------|-----------------------------|-------|
| CommunityBoss       | BossName        | Text                       | |
| CommunityBoss       | MaxHp           | Numeric                    | |
| CommunityBoss       | CurrentHp       | Numeric                    | decrementee a chaque attaque |
| CommunityBoss       | RewardBoosters  | Numeric                    | boosters accordes a CHAQUE contributeur quand le boss tombe a 0 |
| CommunityBoss       | Active          | Bool                       | un seul boss actif a la fois ; passe a `false` des qu'il est vaincu |
| BossContributions   | User            | Reference -> Users         | |
| BossContributions   | Boss            | Reference -> CommunityBoss | **colonne a ajouter si absente** - indispensable pour ne recompenser que les contributeurs du bon cycle de boss, pas ceux d'un boss precedent |
| BossContributions   | Damage          | Numeric                    | degats infliges par cette attaque (= `Rarities.DisenchantValue` de la carte donnee, reutilise comme proxy de valeur - pas de nouvelle colonne) |
| BossContributions   | Timestamp       | DateTime                   | |

`community-boss.json` (POST `/community-boss` `{ userId, action, cardId?,
discordId?, bossName?, maxHp?, rewardBoosters? }`) :
- `status` : etat du boss actif (`active`, `bossName`, `maxHp`, `currentHp`,
  `rewardBoosters`) + `myContribution` (degats cumules du joueur sur ce
  cycle). `{ active: false }` si aucun boss actif.
- `attack` : donne UNE carte non-promo possedee (`cardId`) - **supprime la
  ligne `Pulls` correspondante** (irreversible, comme un decraft), inflige
  `Rarities.DisenchantValue` de degats. Si `CurrentHp` tombe a 0 : `Active`
  passe a `false` et **chaque contributeur distinct de ce cycle** (table
  `BossContributions` filtree par `Boss`) recoit `+RewardBoosters` sur son
  `Users.BoosterCount` (boucle, meme pattern que `altar-sacrifice.json`).
- `adminCreate` (reserve aux `adminDiscordIds` codes en dur, meme liste que
  `admin-codes.json`) : desactive tout boss encore actif puis en cree un
  nouveau (`CurrentHp = MaxHp`, `Active = true`).

## Coffre de guilde mystere

Un doublon donne rejoint un pot commun ; n'importe quel autre joueur peut en
piocher un au hasard, une fois par jour.

| Table              | Colonne      | Type                  | Notes |
|---------------------|--------------|------------------------|-------|
| GuildChestDeposits  | User         | Reference -> Users     | qui a depose |
| GuildChestDeposits  | CardId       | Reference -> Cards     | |
| GuildChestDeposits  | SerialNumber | Numeric                | **colonne a ajouter si absente** - le numero de serie ORIGINAL de l'exemplaire depose, restaure a l'identique quand quelqu'un le pioche (sinon la pioche creerait un nouvel exemplaire avec un numero different, ce qui ferait perdre son identite a la carte deposee) |
| GuildChestDeposits  | Finish       | Text                    | **colonne a CREER (2026-09-29), sinon le depot echoue completement** - meme principe que `SerialNumber` : avant, la finition/qualite de l'exemplaire depose etaient silencieusement PERDUES (jamais ecrites du tout), donc une carte Holo redevenait Normale des qu'elle passait par le coffre. Desormais conservee et restauree a l'identique a la pioche |
| GuildChestDeposits  | Quality      | Text                    | **colonne a CREER (2026-09-29), sinon le depot echoue completement** - meme chose que `Finish` ci-dessus, pour la qualite |
| GuildChestDeposits  | DepositedAt  | DateTime               | |
| GuildChestDeposits  | Claimed      | Bool                   | passe a `true` des qu'un autre joueur le pioche |
| GuildChestClaims    | User         | Reference -> Users     | |
| GuildChestClaims    | Date         | Text                   | `AAAA-MM-JJ` (fuseau Paris) - un seul tirage par jour et par joueur, meme logique que `DailyQuests.Date` |
| GuildChestClaims    | DepositRowId | Reference -> GuildChestDeposits | **colonne a CREER (2026-09-30)** - quel depot precis cette reclamation a pioche. Necessaire pour detecter que deux joueurs ont pioche le MEME depot au meme instant (voir "Securite en cas d'acces concurrent" plus bas) ; sans elle, deux tirages simultanes pourraient dupliquer la meme carte donnee |

`guild-chest.json` (POST `/guild-chest` `{ userId, action, cardId?, finish?, quality? }`) :
- `status` : `poolSize` (depots non reclames d'AUTRES joueurs) +
  `alreadyDrawnToday`.
- `deposit` : donne une carte non-promo possedee - **supprime la ligne
  `Pulls`** (comme un decraft, irreversible) et cree une ligne
  `GuildChestDeposits` (`Claimed: false`). **`finish`/`quality` (2026-09-29,
  optionnels mais toujours envoyes par le front)** ciblent l'exemplaire EXACT
  a deposer (meme convention que `disenchant.json` : `config.finish`/
  `config.quality`) - BUG REEL corrige ici : sans ca, le serveur prenait le
  PREMIER exemplaire trouve, potentiellement le plus prestigieux (Holo/
  Parfait etat) du joueur, sans qu'il ait pu choisir. Le front
  (`communaute.js` `chestCardTile`) affiche desormais une ligne par variante
  reellement possedee (comme la collection), chacune avec son propre bouton
  "Déposer" cible.
- `draw` : refuse si deja tire aujourd'hui (`already_drawn_today`) ou si le
  pot est vide/uniquement rempli par le joueur lui-meme (`chest_empty`).
  Choisit un depot au hasard parmi ceux d'AUTRES joueurs, le marque
  `Claimed: true`, **recree une ligne `Pulls`** pour le tireur avec le MEME
  `SerialNumber`/`Finish`/`Quality` que l'exemplaire depose (voir notes
  colonnes ci-dessus). **Verifie apres-coup (2026-09-30)** qu'aucun autre
  joueur n'a pioche le MEME depot au meme instant - voir "Securite en cas
  d'acces concurrent" plus bas.

## Marche noir ephemere

Offres limitees dans le temps, en nombre d'exemplaires, contre poussieres
d'etoile.

| Table             | Colonne       | Type                | Notes |
|--------------------|---------------|----------------------|-------|
| BlackMarketOffers  | CardId        | Reference -> Cards   | |
| BlackMarketOffers  | Cost          | Numeric               | en poussieres d'etoile |
| BlackMarketOffers  | ExpiresAt     | DateTime              | epoch secondes |
| BlackMarketOffers  | Active        | Bool                  | |
| BlackMarketOffers  | MaxPurchases  | Numeric               | 0/vide = illimite - limite propre a CETTE offre, independante de toute limite globale sur la carte (il n'y en a plus, voir "Numeros de serie - plus de quota") |

`black-market.json` (POST `/black-market` `{ userId, action, offerId?,
discordId?, cardId?, cost?, expiresInHours?, maxPurchases? }`) :
- `list` : offres actives, non expirees et pas epuisees. Le nombre deja
  achete est compte via le prefixe `Pulls.BatchId` = `market-<offerId>-...`
  (pas de colonne compteur separee - meme principe que `open-pack.json`).
- `buy` : debite `Cost`, cree une ligne `Pulls` avec le plus petit numero de
  serie libre (meme suivi que partout ailleurs, voir "Numeros de serie -
  plus de quota"). **Revalide `MaxPurchases` apres-coup (2026-09-30)** en
  cas d'achats simultanes - voir "Securite en cas d'acces concurrent" plus
  bas.
- `adminCreate` (reserve admin, meme liste `adminDiscordIds`) : cree une
  offre.

## Mini-jeu de fouille

Vrai mini-jeu de tuiles a creuser (pas un simple tirage a l'aveugle) : une
grille de 16 tuiles caches des tresors invisibles, certains etales sur
plusieurs tuiles - il faut alors creuser TOUTES ses tuiles pour liberer
l'objet (ex: la carte, la recompense la plus rare, est repartie sur 4
tuiles). Energie qui se regenere seule, 1 tuile creusee par point d'energie.

`Users.DigBoardState` (Text, **nouvelle colonne a creer**) : JSON serialise
de l'etat du plateau courant du joueur -
`{ tiles: [{ t: <index tresor|null>, d: <bool creusee> }, ...16], treasures:
[{ cells, dug, reward, done }, ...] }`. Genere a la premiere visite (ou si
l'etat est absent/corrompu) et regenere automatiquement des que les 16
tuiles sont creusees. Jamais renvoye tel quel au client : `dig.json` n'expose
que la projection publique (tuile creusee ou non ; si creusee et liee a un
tresor, son `reward` + son etat `done`/`remaining`) pour ne jamais reveler
a l'avance quelles tuiles cachent encore quelque chose.

**Icone partagee des la premiere tuile creusee (2026-09-29)** : le `reward`
d'un tresor est desormais expose meme quand il n'est PAS encore complet
(`done:false`), pas seulement une fois termine - le front (`jeux.js`)
affiche alors la VRAIE icone de la recompense (attenuee) plutot qu'une
fissure generique, ce qui permet de relier visuellement deux tuiles deja
creusees appartenant au MEME tresor (meme icone), meme quand deux tresors
differents sont en cours simultanement et afficheraient sinon le meme
compteur "-1" ambigu. Ca ne revele toujours rien sur les tuiles NON
creusees - uniquement un lien entre des tuiles deja fouillees.

Repartition des tresors sur le plateau de 16 tuiles a chaque generation
(le reste, 3 tuiles, ne cache rien) - table enrichie le 2026-09-29 (ajout de
la carte Rare a la place d'une des poussieres simples) :

| Tuiles necessaires | Recompense | Quantite de tresors |
|---------------------|------------|----------------------|
| 4                   | 1 carte de la rarete la plus commune | 1 |
| 3                   | 1 carte de la rarete juste au-dessus (Rare) | 1 |
| 2                   | 1 booster generique | 1 |
| 2                   | grosse poussiere (25-50) | 1 |
| 1                   | petite poussiere (5-15) | 2 |

`dig.json` (POST `/dig` `{ userId, action: 'status'|'dig', tileIndex? }`) -
base sur `Users.DigEnergy`/`Users.LastDigEnergyAt` (voir table `Users` plus
haut) : regeneration **+1 toutes les minutes, plafond 5**, calculee a la
volee a chaque appel (pas de tache planifiee). `dig` coute 1 energie, exige
une `tileIndex` (0-15) pas encore creusee, et renvoie soit `nothing` (tuile
vide), soit `partial` (tuile liee a un tresor pas encore complet - le nombre
de tuiles restantes est renvoye, mais pas leur position), soit le
resultat final (`dust`/`booster`/`card`) quand la derniere tuile d'un tresor
est creusee. Le tresor "4 tuiles" tire toujours dans la rarete la PLUS BASSE
(SortOrder), le "3 tuiles" dans la rarete JUSTE AU-DESSUS (index 1 des
raretes triees) - avec les raretes par defaut (Commune/Rare/Epique/
Legendaire/Mythique) ca donne Commune puis Rare ; `card.rarity` est renvoye
avec la carte pour que le front distingue les deux. Si aucune carte de ce
palier n'est disponible (toutes epuisees ou aucune active), degrade
silencieusement vers de la poussiere (30 pour le palier Commune, 50 pour le
palier Rare) plutot que d'echouer l'action (les tuiles restent liberees).

## Bingo de collection

Une grille de 9 cartes par mois (definie par un admin), recompense unique
quand les 9 sont possedees.

| Table       | Colonne        | Type                    | Notes |
|--------------|----------------|--------------------------|-------|
| BingoGrids  | Month          | Text                    | `AAAA-MM` (fuseau Paris) |
| BingoGrids  | CardIds        | Reference List -> Cards | exactement 9 cartes |
| BingoGrids  | RewardBoosters | Numeric                  | |
| BingoClaims | User           | Reference -> Users       | **nouvelle table, a creer** - evite de recompenser deux fois la meme grille |
| BingoClaims | Month          | Text                    | `AAAA-MM` |
| BingoClaims | ClaimedAt      | DateTime                | |

**Bug reel trouve et corrige (2026-09-26)** : si `Month` est cree comme un
type Date/DateTime au lieu de Text (piege facile pour une valeur qui
ressemble a une date), la base le
renvoie en LECTURE comme un epoch en secondes (nombre), jamais la chaine
`"AAAA-MM"` ecrite - une comparaison directe `===` echoue alors TOUJOURS,
et `bingo.json` semble "ne jamais avoir de grille" cote joueur ET cote admin
(`gridExists` echoue aussi -> chaque nouvel essai de l'admin cree une
nouvelle ligne en double au lieu de mettre a jour la precedente). Corrige
dans `Dispatch Action` par une fonction `monthKey()` qui normalise les deux
formats (texte ou epoch) avant de comparer - fonctionne desormais quel que
soit le type reel de la colonne. **Verifie quand meme que `Month` est bien
en type Text** (bouton Structure d'admin-db.html si besoin) pour eviter
la confusion a l'avenir.

**Second point a verifier a la main** : si une grille existante affiche des
cases vides malgre un `adminSetGrid` reussi, verifie que `CardIds` est bien
en type **Reference List -> Cards** et pas en Text/Any - une colonne du
mauvais type accepte l'ecriture `["L", id, ...]` sans erreur mais la
restitue en lecture comme le texte litteral `"[id, id, ...]"`, que le code
(qui attend un vrai tableau, voir `refIdList()`) ne sait pas parser. Une fois
le type de colonne corrige, resauvegarder la grille du mois via
`admin.html` regle le probleme sans changement de code.

`bingo.json` (POST `/bingo` `{ userId, action, discordId?, month?,
cardIds?, rewardBoosters? }`) :
- `status` : grille du mois courant + `owned` par case (calcule a la volee
  depuis `Pulls`, jamais persiste - meme principe que `get-achievements.json`) +
  `allOwned` + `claimed`. `{ hasGrid: false }` si aucune grille ce mois-ci.
- `claim` : refuse si grille incomplete (`grid_not_complete`) ou deja
  reclamee (`already_claimed`) ; sinon cree `BingoClaims` et accorde
  `RewardBoosters`.
- `adminSetGrid` (reserve admin, meme liste `adminDiscordIds`) : cree ou
  remplace la grille d'un mois (`cardIds` doit contenir exactement 9 ids).

## Progression longue, quotidien et marche (2026-10-07)

Tables et colonnes creees automatiquement au demarrage de l'API (rien a faire a la main).

| Table | Colonne | Type | Role |
|-------|---------|------|------|
| Users | Talents | Text | JSON { cleDuTalent: rang } (talents.js) |
| Users | RankKey | Text | dernier rang de compte connu (annonce de montee de rang) |
| Users | ActivityCounts | Text | JSON des compteurs d'activite (statistiques, maitrises de succes) |
| Users | BoxDay, DiceDay, DiceFace | Text, Text, Numeric | boite et de du jour |
| Users | LuckyHitWeek | Text | semaine du coup de chance (1re legendaire) deja recompense |
| Users | LastSeenAt, ReturnPending | Numeric, Text | derniere visite ; colis de retour en attente (JSON { since, days }) |
| Users | EveningDay, EveningProgress, EveningClaimed | Text | missions du soir du jour |
| Users | StreakFreezes, FreezeWeek | Numeric, Text | gels de serie en reserve, semaine du dernier achat |
| Users | ShopWeek, ShopBought | Text, Numeric | boosters achetes dans la semaine |
| Users | RepairWeek, RepairCounts | Text, Text | restaurations par carte dans la semaine (supplement) |
| Users | PullStats, DustLedger | Text | statistiques de tirage ; poussieres gagnees / depensees par source |
| Users | PushPrefs | Text | JSON des categories de notifications coupees |
| Users | ExpeditionXP, ExpeditionPrestige, GardenXP, GardenPrestige | Numeric | metiers d'expedition et de jardin |
| Pulls | Starred | Bool | exemplaire ★ (3 arc-en-ciel parfait etat fusionnes) |
| Pulls | Insured | Bool | exemplaire assure (mis de cote pendant les decrafts, fusions, echanges...) |
| ProgressClaims | User, Ext, Kind, At | Ref:Users, Numeric, Text, Numeric | recompenses reclamees : maitrise (`level:N`, `layer:cards`), etoiles (`star-N`, `sky`), paliers (`tier:famille:N`) |
| ServerFeed | At, User, Kind, Icon, Text, Card | | fil du serveur (200 derniers) |
| ContractClaims | User, Week, Key, At | | contrats remplis |
| Auctions | Seller, Card, Pull, Serial, Finish, Quality, Starred, StartPrice, CurrentBid, Bidder, Bids, OutbidUser, OutbidAt, EndsAt, Status, CreatedAt, SettledAt, Tax | | encheres ; pendant la vente l'exemplaire n'a plus de proprietaire (Pulls.User vide) |

AppSettings : `constellations` (les 40 etoiles tirees une fois), `rateStats:<semaine>` (decrafts / crafts par rarete, pour le cours du decraft).

## Images (pieces jointes)

Les images sont stockees dans la base de l'API elle-meme (table
`attachments`). Une cellule `Attachments` contient une liste d'ids
(`["L", id]`) ; les workflows prennent le premier id (une carte, un packet ou
un dos de carte = une image) et le renvoient au site sous les noms `imageId`
(cartes), `packImageId` et `cardBackImageId` (extensions, via
`get-extensions.json`).

Le site affiche une image par `{apiBaseUrl}/image?id={imageId}`, route servie
directement par l'API (cache navigateur longue duree). Import et
remplacement : onglet **Images** de `site/admin-db.html` (conversion WebP et
redimensionnement dans le navigateur). Remplacer une image existante cree
une nouvelle piece jointe et redirige les lignes qui l'utilisaient (les
navigateurs gardent l'ancienne en cache).

## Colonnes DateTime (important pour tout code custom)

Les colonnes `Date`/`DateTime` contiennent un **nombre de secondes depuis
epoch Unix** (pas une chaine ISO). Tous les workflows utilisent donc
`Math.floor(Date.now() / 1000)` plutot que `new Date().toISOString()`. Si tu
ajoutes un nouveau champ DateTime, fais pareil.

## Colonnes liste (Attachments / Reference List)

Les colonnes de type liste sont encodees `["L", id1, id2, ...]` : `"L"` est
un marqueur, pas une valeur. Les fonctions `refId`/`firstAttachment` des
workflows gerent deja ce cas ; reprends le meme code si tu ajoutes un node
qui lit ce genre de colonne. A l'ecriture, garde aussi le marqueur
(`['L', 4, 5, 6]`) plutot qu'un tableau brut.

## Colonnes booleennes (Toggle) : jamais de `=== true` / `!== true`

Une ancienne donnee importee peut contenir `1`/`0` plutot qu'un vrai booleen
JS (`1 === true` vaut `false`). **Toujours utiliser un test de verite**
(`!!valeur` pour "est vrai", `!valeur` pour "est faux/absent") plutot que
`=== true`/`!== true` sur une colonne lue telle quelle depuis une ligne.

## Acces concurrents

L'API execute **une seule action a la fois** (verrou global, voir
`api/src/server.js`) : deux clics simultanes ne peuvent plus lire le meme
solde ni depasser une limite (`MaxRedemptions`, `MaxPurchases`, depot de
coffre de guilde deja pioche...). Les workflows `redeem-code.json`,
`black-market.json` et `guild-chest.json` contiennent encore un ancien
mecanisme "verifier apres coup, annuler si conflit" (avec une courte
attente) : devenu inutile mais sans danger, il peut etre retire plus tard.

## Ecrire un workflow : regles du moteur

Le moteur (`api/src/runtime.js`) execute les workflows avec la semantique de
leur format d'origine :

1. **Un noeud de table `getAll` s'execute une fois par item recu en
   entree.** Ne jamais chainer deux `getAll` directement (A -> B) : si A
   produit plusieurs lignes, B tournerait plusieurs fois et dupliquerait ses
   resultats. Intercale un node Code (`mode: runOnceForAllItems`,
   `return [{ json: {} }];`), comme les nodes "Sync X -> Y" existants.
2. **Ne jamais lire `$('Noeud')` d'un noeud qui peut ne pas avoir tourne**
   selon la branche prise : le moteur leve une erreur ("Referenced node is
   unexecuted") au lieu de renvoyer une liste vide. Determine la branche via
   un noeud present sur tous les chemins (`Dispatch Action`,
   `Validate & Prepare`...).
3. **Une branche qui peut ne produire aucun item doit quand meme mener a une
   reponse** : sinon le workflow ne repond pas (erreur 500 "Workflow did not
   respond"). Utiliser `alwaysOutputData` + un noeud If (voir
   `level-rewards.json`, "If Has Card Rewards").

## Colonnes : creees automatiquement

Plus besoin de creer des colonnes a la main avant un deploiement : au
demarrage, l'API cree les colonnes ecrites par les workflows qui manquent
encore (type deduit du nom) ainsi que les tables/colonnes des fonctionnalites
natives (`api/src/native`). Pour modifier la structure a la main (renommer,
changer de type, supprimer, creer une table) : bouton **Structure** de
`site/admin-db.html`.
