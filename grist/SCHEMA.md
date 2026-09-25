# Schema Grist - 2Gatcha

Un seul document Grist avec 12 tables de base, plus plusieurs tables
ajoutees au fil de l'eau (voir plus bas : `Finishes`, `DailyQuests`,
`WeeklyQuests`...). Cree-les dans cet ordre (les references ont besoin que
la table ciblee existe deja) :
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
(action `updateRarity`) - pas besoin d'ouvrir Grist pour un simple
ajustement de taux/cout.

**Important** : ces poids ne s'expriment que sur les cartes qui existent
reellement dans l'extension ouverte. S'il n'y a aucune carte d'une rarete
donnee dans une extension, un tirage qui obtient cette rarete retombe sur une
carte au hasard de l'extension (`open-pack.json`) : verifie que chaque
extension a au moins une carte par rarete utilisee, sinon la ponderation n'a
plus d'effet visible.

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

Valeurs de depart suggerees, ajustables directement dans Grist OU depuis
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
une valeur figee : modifie les `DropWeight` dans Grist pour retunner sans
redeployer de workflow. Ce tirage ne s'applique qu'aux boosters reels
(`open-pack.json`) - pas a `craft.json` (toujours `normal`), ni aux codes
d'evenement, ni a l'autel.

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
| IsSecret    | Bool                  | sous-ensemble des cartes promo, reservees a l'easter egg Konami code (voir "Cartes secretes" plus bas). Doit toujours etre pose avec `IsPromo=true` en meme temps : les cartes secretes profitent de l'exclusion tirage/craft/echange deja geree par `IsPromo`, `IsSecret` ne fait que les rendre eligibles a `unlock-secret.json` |
| Image       | Attachments            | l'image de la carte, uploadee dans Grist    |
| Active      | Bool                   | si `false`, la carte n'est plus tirable     |
| FirstObtainedBy | Reference -> Users | vide tant que personne ne l'a obtenue ; rempli une seule fois, par le premier tirage/reclamation qui la sort (`open-pack.json`, `redeem-code.json`) |
| FirstObtainedAt | DateTime           | date du premier obtention (epoch secondes) |
| MaxSerial   | Numeric               | limite d'exemplaires "dans la nature" pour cette carte, tous joueurs confondus (defaut 100 si vide/0, applique cote code par `card.MaxSerial \|\| 100`). Une fois la limite atteinte, la carte n'est plus obtenable par aucun moyen (booster, craft, code, autel) : chaque workflow qui cree une ligne `Pulls` l'exclut de son pool de tirage et renvoie l'erreur `sold_out` si on tente quand meme de l'obtenir |

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
| XP                    | Numeric   | defaut 0, experience cumulee (niveaux de profil, voir plus bas) |
| SelectedBadge         | Text      | vide par defaut ; `Key` du badge cosmetique affiche sur le profil (voir "Badges" plus bas) - doit correspondre a un badge que le joueur possede (`UserBadges`) |
| DigEnergy             | Numeric   | defaut 5 (plein), energie du mini-jeu de fouille (voir "Mini-jeu de fouille" plus bas) |
| LastDigEnergyAt       | DateTime  | epoch secondes, dernier instant ou l'energie de fouille a ete lue/consommee - sert de base au calcul de regeneration (+1/minute) |
| DigBoardState         | Text      | vide par defaut ; **nouvelle colonne a creer** - JSON du plateau de tuiles courant du mini-jeu de fouille (voir "Mini-jeu de fouille" plus bas) |

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
**pour chacune des deux parties**, `trade.json`).

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
| SerialNumber | Numeric               | numero de l'exemplaire pour cette carte, tous joueurs confondus (1er exemplaire jamais tire = 1, etc.) ; calcule au moment de la creation de la ligne comme `(nombre de lignes Pulls existantes pour cette carte) + 1`, jamais recalcule ensuite. Sert a l'affichage "#004/100" cote front et a la limite `Cards.MaxSerial` |
| Finish       | Text                   | finition de cet exemplaire precis : `normal` (ou vide - traite comme `normal` partout, voir plus bas), `holo`, `gold`, `ghost`, `diamond`, `rainbow`, dans cet ordre croissant de prestige. Cosmetique, mais influence la valeur de decraft (voir `Finishes` plus haut et "Craft / decraft" plus bas). Voir "Finitions" plus bas |
| Quality      | Text                   | qualite de cet exemplaire precis : `damaged` (ou vide - traite comme `damaged` partout), `worn`, `good`, `mint`, dans cet ordre croissant. Purement cosmetique, aucun effet sur le gameplay. Voir "Restauration de cartes usees" plus bas |

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
superieure, avec un nouveau `SerialNumber` (meme compteur global que les
tirages/craft normaux - une carte fusionnee "consomme" donc une place sous
`Cards.MaxSerial` comme n'importe quel autre nouvel exemplaire). Une carte
promo ne peut pas etre fusionnee (`promo_not_upgradable`). Le front
(`craft.html`, onglet "Finitions") liste directement toutes les fusions
possibles pour le joueur (aucun palier de rarete a choisir, contrairement a
l'autel : n'importe lesquels des 5 exemplaires identiques font l'affaire).

Une finition speciale peut aussi sortir **naturellement** d'un booster reel
(pas seulement via fusion) : voir "Tirage a deux niveaux" dans la section
`Finishes` plus haut.

## Restauration de cartes usees (Qualite)

`card-quality-repair.json` (POST `/card-quality-repair` `{ userId, cardId,
fromQuality }`) : meme principe que les Finitions, mais sur l'echelle
`Pulls.Quality` et avec un ratio plus court. Fusionne **3 exemplaires
identiques** (meme carte, meme `Quality`) en **1 seul** exemplaire de la
qualite immediatement superieure, selon l'echelle fixe `damaged -> worn ->
good -> mint` (definie cote code dans `card-quality-repair.json`, a
dupliquer cote front si un onglet "Qualite" est ajoute a `craft.html`, sur
le modele de l'onglet "Finitions"). Deterministe, pas de hasard. Les 3
exemplaires consommes sont supprimes de `Pulls` ; un nouvel exemplaire est
cree a la qualite superieure avec un nouveau `SerialNumber` (meme compteur
global, meme limite `Cards.MaxSerial`). Une carte promo ne peut pas etre
restauree (`promo_not_repairable`). Contrairement aux Finitions, la Qualite
n'a **pas** de tirage naturel a l'ouverture d'un booster - toutes les cartes
sont tirees `damaged` par defaut, seule la fusion de doublons fait progresser
la qualite.

**Limite d'exemplaires (`Cards.MaxSerial`)** : chaque workflow qui cree une
ligne `Pulls` (`open-pack.json`, `craft.json`, `redeem-code.json`,
`altar-sacrifice.json`) compte d'abord le nombre de lignes `Pulls`
existantes pour la carte visee (tous joueurs), exclut du pool de tirage
toute carte qui a deja atteint sa limite, et renvoie l'erreur `sold_out`
(ou, pour l'autel, retire simplement la carte du pool de la rarete
superieure - `no_target_card` si plus aucune carte n'y est disponible)
si la carte demandee explicitement (craft, code) est epuisee.

## 6. Config

Une seule ligne, parametres globaux du gacha (communs a toutes les
extensions ; seul le compteur de progression vers la pity est par extension,
voir `BoosterInventory`). Editable depuis `admin.html` (section "Équilibrage
du jeu"), pas seulement a la main dans Grist - voir `admin-config.json`.

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

Toutes les colonnes `Numeric` ci-dessus tolerent une cellule vide dans Grist
(chaque workflow qui les lit retombe sur la valeur par defaut listee) - pas
besoin de remplir la ligne existante avant de deployer, seulement d'ajouter
les colonnes.

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
| MaxRedemptions   | Numeric                 | nb max d'utilisateurs differents pouvant reclamer ce code ; 0 ou vide = illimite. Un meme utilisateur ne peut de toute facon reclamer un code qu'une seule fois (voir `CodeRedemptions`) |
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
completer 2 sur 4 accorde automatiquement 1 booster gratuit (une seule fois
par jour, voir `RewardClaimed`). Cree/mise a jour par `quests.json` (quete
"se connecter", au premier chargement de la page qui consulte les quetes du
jour) et par une branche additionnelle dans `craft.json` (crafter une
carte), `trade.json` (proposer un echange) et `open-pack.json` (ouvrir un
booster reel, pas en mode test admin).

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
compteur atteint 5) accorde automatiquement 5 boosters gratuits (une seule
fois par semaine, voir `RewardClaimed`). Semaine = lundi-dimanche, fuseau
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
| LastLoginCountedDate  | Text                  | `AAAA-MM-JJ` (Europe/Paris) du dernier jour ou `LoginCount` a ete incremente - empeche de compter 5 fois la meme journee en rafraichissant la page |
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
  `Users.StardustCount` de `Rarities.DisenchantValue * Finishes.DisenchantMultiplier`
  (arrondi) de sa rarete/finition. Si le joueur possede plusieurs exemplaires
  de finitions differentes pour la meme carte, l'exemplaire `normal` (ou le
  moins prestigieux disponible) est **toujours** decrafte en premier - jamais
  un holo/gold/... par erreur tant qu'il reste un exemplaire moins special.
- `craft.json` (POST `/craft` `{ userId, cardId }`) : verifie que la carte
  est active et non-promo, que `Users.StardustCount >= Rarities.CraftCost`
  de sa rarete, debite le cout et **cree une ligne `Pulls`** (comme un
  tirage normal, `BatchId` prefixe `craft-`).

Une carte promo n'est ni decraftable ni craftable : elle reste exclusivement
obtenable via un code d'evenement (`EventCodes`, `RewardType=card`).

---

## Roue de la fortune quotidienne

`daily-wheel.json` (POST `/daily-wheel` `{ userId, action: 'status'|'spin' }`).
Un seul tirage par jour et par joueur, base sur `Users.LastWheelSpinDate`
(fuseau Paris, meme logique que `DailyQuests`). Lots ("mix prudent", pas de
carte directe pour ne jamais court-circuiter les raretes fortes) :
- 70% : petite quantite de poussieres d'etoile (10-25)
- 20% : grosse quantite de poussieres d'etoile (50-100)
- 10% : 1 booster generique

## Cartes secretes (easter egg Konami code)

`unlock-secret.json` (POST `/unlock-secret` `{ userId }`), declenche par un
listener Konami-code site-wide dans `main.js`. Tire une carte au hasard
parmi celles marquees `Cards.IsSecret = true` (qui doivent aussi avoir
`IsPromo = true` - voir plus haut) et non epuisees (`MaxSerial`), cree une
ligne `Pulls` (`BatchId` prefixe `secret-`) exactement comme un tirage
normal. Repond `{ error: 'no_secret_available' }` (400) si aucune carte
`IsSecret` n'existe encore ou si toutes sont epuisees - **il faut qu'un
admin cree/flague au moins une carte `IsSecret=true` + `IsPromo=true` dans
Grist pour que l'easter egg puisse jamais donner quelque chose**.

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
**Le joueur doit ajouter des lignes `BadgeCatalog` a la main dans Grist** -
le workflow ne fait que lire/vendre un catalogue existant, il ne peut pas en
inventer le contenu.

## Boss communautaire (fusion Donations + Boss)

Feature fusionnee sur demande explicite : au lieu d'un simple compteur de
dons ("Donations au Grand 2GETHER") ET d'un boss separe ("Boss
communautaire"), **une seule mecanique** - donner une carte, c'est attaquer
le boss commun. `CommunityChest` (ancienne table de dons) est **desormais
superflue/inutilisee** par ce design ; laisse en l'etat dans Grist (pas
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
| GuildChestDeposits  | SerialNumber | Numeric                | **colonne a ajouter si absente** - le numero de serie ORIGINAL de l'exemplaire depose, restaure a l'identique quand quelqu'un le pioche (sinon la pioche creerait un nouvel exemplaire au-dela de `Cards.MaxSerial`, ce qui gonflerait artificiellement le compteur mondial) |
| GuildChestDeposits  | DepositedAt  | DateTime               | |
| GuildChestDeposits  | Claimed      | Bool                   | passe a `true` des qu'un autre joueur le pioche |
| GuildChestClaims    | User         | Reference -> Users     | |
| GuildChestClaims    | Date         | Text                   | `AAAA-MM-JJ` (fuseau Paris) - un seul tirage par jour et par joueur, meme logique que `DailyQuests.Date` |

`guild-chest.json` (POST `/guild-chest` `{ userId, action, cardId? }`) :
- `status` : `poolSize` (depots non reclames d'AUTRES joueurs) +
  `alreadyDrawnToday`.
- `deposit` : donne une carte non-promo possedee - **supprime la ligne
  `Pulls`** (comme un decraft, irreversible) et cree une ligne
  `GuildChestDeposits` (`Claimed: false`).
- `draw` : refuse si deja tire aujourd'hui (`already_drawn_today`) ou si le
  pot est vide/uniquement rempli par le joueur lui-meme (`chest_empty`).
  Choisit un depot au hasard parmi ceux d'AUTRES joueurs, le marque
  `Claimed: true`, **recree une ligne `Pulls`** pour le tireur avec le MEME
  `SerialNumber` que l'exemplaire depose (voir note colonne ci-dessus).

## Marche noir ephemere

Offres limitees dans le temps, en nombre d'exemplaires, contre poussieres
d'etoile.

| Table             | Colonne       | Type                | Notes |
|--------------------|---------------|----------------------|-------|
| BlackMarketOffers  | CardId        | Reference -> Cards   | |
| BlackMarketOffers  | Cost          | Numeric               | en poussieres d'etoile |
| BlackMarketOffers  | ExpiresAt     | DateTime              | epoch secondes |
| BlackMarketOffers  | Active        | Bool                  | |
| BlackMarketOffers  | MaxPurchases  | Numeric               | 0/vide = illimite (dans la limite de `Cards.MaxSerial`) |

`black-market.json` (POST `/black-market` `{ userId, action, offerId?,
discordId?, cardId?, cost?, expiresInHours?, maxPurchases? }`) :
- `list` : offres actives, non expirees et pas epuisees. Le nombre deja
  achete est compte via le prefixe `Pulls.BatchId` = `market-<offerId>-...`
  (pas de colonne compteur separee - meme principe que `open-pack.json`).
- `buy` : debite `Cost`, cree une ligne `Pulls` (respecte aussi
  `Cards.MaxSerial` comme n'importe quel autre gain de carte).
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
tresor, son etat `done`/`remaining`) pour ne jamais reveler a l'avance quelles
tuiles caches encore quelque chose.

Repartition des tresors sur le plateau de 16 tuiles a chaque generation
(le reste, 5 tuiles, ne cache rien) :

| Tuiles necessaires | Recompense | Quantite de tresors |
|---------------------|------------|----------------------|
| 4                   | 1 carte de la rarete la plus commune | 1 |
| 2                   | 1 booster generique | 1 |
| 2                   | grosse poussiere (25-50) | 1 |
| 1                   | petite poussiere (5-15) | 3 |

`dig.json` (POST `/dig` `{ userId, action: 'status'|'dig', tileIndex? }`) -
base sur `Users.DigEnergy`/`Users.LastDigEnergyAt` (voir table `Users` plus
haut) : regeneration **+1 toutes les minutes, plafond 5**, calculee a la
volee a chaque appel (pas de tache planifiee). `dig` coute 1 energie, exige
une `tileIndex` (0-15) pas encore creusee, et renvoie soit `nothing` (tuile
vide), soit `partial` (tuile liee a un tresor pas encore complet - le nombre
de tuiles restantes est renvoye, mais pas leur position), soit le
resultat final (`dust`/`booster`/`card`) quand la derniere tuile d'un tresor
est creusee. Carte du tresor "4 tuiles" toujours de la rarete la plus
commune (jamais un jackpot - "un vieux doublon retrouve", pas une carte
rare) ; si aucune carte commune n'est disponible (toutes epuisees), degrade
silencieusement vers de la poussiere plutot que d'echouer l'action (les 4
tuiles restent liberees).

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

## Images (pieces jointes)

Une cellule `Attachments` renvoie une liste d'ids de pieces jointes. Les
workflows qui en ont besoin prennent le premier id de la liste (une carte,
un packet ou un dos de carte = une image) et le renvoient au site sous les
noms `imageId` (cartes), `packImageId` et `cardBackImageId` (extensions,
via `get-extensions.json`).

Important : l'API de telechargement de Grist exige une authentification, donc
**pas d'URL publique directe**. Le site n'affiche jamais une URL Grist : il
appelle `{n8nBaseUrl}/image?id={imageId}`, un workflow n8n dedie
(`get-image.json`) qui telecharge l'image avec la cle API et la retransmet.
Ce workflow marche pour n'importe quelle piece jointe du document (l'id est
unique au niveau du document, pas de la table), donc il sert aussi bien pour
`Cards.Image` que pour `Extensions.PackImage`/`CardBackImage`. Voir "Pourquoi
un workflow image a part" dans `/n8n/README.md`.

## Colonnes DateTime (important pour tout code custom)

L'API Grist represente les colonnes `Date`/`DateTime` comme un **nombre de
secondes depuis epoch Unix** (pas une chaine ISO), aussi bien en lecture
qu'en ecriture. Tous les workflows n8n de ce projet utilisent donc
`Math.floor(Date.now() / 1000)` plutot que `new Date().toISOString()`. Si tu
ajoutes un nouveau champ DateTime, fais pareil.

## Colonnes liste (Attachments / Reference List)

Grist encode les colonnes de type liste sous la forme `["L", id1, id2, ...]`
: `"L"` est un marqueur, pas une valeur. Toutes les fonctions `refId`/
`firstAttachment` des workflows de ce projet gèrent deja ce cas ; reprends
le meme code si tu ajoutes un node qui lit ce genre de colonne.

## Chainer des appels Grist dans un workflow (piege n8n)

Un node Grist "classique" (type `getAll`) s'execute **une fois par item recu
en entree**. Si tu chaines deux nodes Grist getAll directement (A -> B), et
que A produit plusieurs lignes, B va s'executer plusieurs fois et dupliquer
ses resultats (bug reel rencontre et corrige dans ce projet : voir les nodes
"Sync X -> Y" intercales dans les workflows). Regle a suivre pour tout
nouveau node Grist ajoute a un workflow existant : ne jamais faire pointer un
node Grist `getAll` directement sur la sortie d'un autre node Grist
`getAll` ; intercale toujours un node Code (`mode: runOnceForAllItems`,
`return [{ json: {} }];`) entre les deux pour ramener a un seul item.

## Cle API Grist

Dans Grist: Profil -> "Parametres du compte" -> "Cles API" -> creer une cle.
Cette cle sert d'identifiant Bearer pour toutes les requetes HTTP faites par
n8n (voir `/n8n/README.md`).
