# Schema Grist - 2Gatcha

Un seul document Grist avec 11 tables. Cree-les dans cet ordre (les references
ont besoin que la table ciblee existe deja) :
`Rarities` -> `Extensions` -> `Cards` -> `Users` -> `Pulls` -> `Config` ->
`EventCodes` -> `CodeRedemptions` -> `Trades` -> `BoosterInventory` ->
`Wishlist`.

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

**Important** : ces poids ne s'expriment que sur les cartes qui existent
reellement dans l'extension ouverte. S'il n'y a aucune carte d'une rarete
donnee dans une extension, un tirage qui obtient cette rarete retombe sur une
carte au hasard de l'extension (`open-pack.json`) : verifie que chaque
extension a au moins une carte par rarete utilisee, sinon la ponderation n'a
plus d'effet visible.

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
| Image       | Attachments            | l'image de la carte, uploadee dans Grist    |
| Active      | Bool                   | si `false`, la carte n'est plus tirable     |
| FirstObtainedBy | Reference -> Users | vide tant que personne ne l'a obtenue ; rempli une seule fois, par le premier tirage/reclamation qui la sort (`open-pack.json`, `redeem-code.json`) |
| FirstObtainedAt | DateTime           | date du premier obtention (epoch secondes) |

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

La "collection" d'un utilisateur = toutes les lignes `Pulls` ou `User` = lui,
regroupees par `Card` pour avoir un compteur (x2, x3...). C'est deja ce que
fait `get-collection.json` (`cards` = catalogue, `owned` = compteur par
carte) ; le front (`collection.js`) affiche un badge `xN`, pas une carte
repetee N fois. L'extension et la rarete d'une carte se retrouvent via
`Cards`, pas la peine de les dupliquer sur `Pulls`.

## 6. Config

Une seule ligne, parametres globaux du gacha (communs a toutes les
extensions ; seul le compteur de progression vers la pity est par extension,
voir `BoosterInventory`).

| Colonne         | Type                  | Notes                                  |
|------------------|------------------------|------------------------------------------|
| PityThreshold    | Numeric                 | nb de tirages sans legendaire avant garantie (ex: 40) |
| TopRarity        | Reference -> Rarities   | la rarete garantie par la pity (ex: Legendaire) |

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

## Wishlist

Cartes qu'un utilisateur recherche activement, pour faciliter les echanges
avec les autres membres (visible sur le profil/dans l'outil d'echange).

| Colonne | Type                | Notes |
|---------|----------------------|-------|
| User    | Reference -> Users   | |
| Card    | Reference -> Cards   | |

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
`OfferedCard` contre la carte `RequestedCard` de `ToUser`. `ToUser` accepte
ou refuse. Une carte promo (`Cards.IsPromo = true`) ne peut etre ni proposee
ni demandee : `trade.json` refuse la creation avec l'erreur
`promo_not_tradeable`.

| Colonne         | Type                  | Notes                                  |
|------------------|------------------------|------------------------------------------|
| FromUser         | Reference -> Users      | initiateur de l'echange                 |
| ToUser           | Reference -> Users      | destinataire, doit accepter/refuser     |
| OfferedCard      | Reference -> Cards      | carte proposee par `FromUser`           |
| RequestedCard    | Reference -> Cards      | carte demandee en retour a `ToUser`     |
| Status           | Text                    | `pending`, `accepted`, `declined`, `cancelled` |
| CreatedAt        | DateTime                | |
| RespondedAt      | DateTime                | rempli quand `ToUser` repond ou que `FromUser` annule |

A l'acceptation (`trade.json`, action `respond`), le workflow revalide que
les deux parties possedent toujours la carte concernee (le stock peut avoir
change depuis la creation de l'offre), puis reassigne le champ `User` d'une
ligne `Pulls` de chaque cote (pas de creation/suppression de ligne : un
exemplaire change juste de proprietaire).

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
  `Users.StardustCount` de `Rarities.DisenchantValue` de sa rarete.
- `craft.json` (POST `/craft` `{ userId, cardId }`) : verifie que la carte
  est active et non-promo, que `Users.StardustCount >= Rarities.CraftCost`
  de sa rarete, debite le cout et **cree une ligne `Pulls`** (comme un
  tirage normal, `BatchId` prefixe `craft-`).

Une carte promo n'est ni decraftable ni craftable : elle reste exclusivement
obtenable via un code d'evenement (`EventCodes`, `RewardType=card`).

---

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
