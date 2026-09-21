# Schema Grist - 2Gatcha

Un seul document Grist avec 8 tables. Cree-les dans cet ordre (les references
ont besoin que la table ciblee existe deja) :
`Rarities` -> `Cards` -> `Users` -> `Pulls` -> `Config` -> `EventCodes` ->
`CodeRedemptions` -> `Trades`.

## 1. Rarities

| Colonne   | Type              | Notes                                             |
|-----------|-------------------|----------------------------------------------------|
| Name      | Text              | ex: "Commune", "Rare", "Epique", "Legendaire"      |
| Key       | Text              | slug utilise par le front: `commune`, `rare`, `epique`, `legendaire` |
| Weight    | Numeric           | poids relatif de tirage (plus c'est haut, plus c'est frequent) |
| ColorHex  | Text              | couleur d'UI, ex `#f59e0b`                          |
| SortOrder | Numeric           | ordre d'affichage / du plus commun au plus rare     |

Exemple de valeurs de depart:

| Name        | Key         | Weight | ColorHex | SortOrder |
|-------------|-------------|--------|----------|-----------|
| Commune     | commune     | 70     | #9aa0b4  | 1         |
| Rare        | rare        | 22     | #3b82f6  | 2         |
| Epique      | epique      | 7      | #a855f7  | 3         |
| Legendaire  | legendaire  | 1      | #f59e0b  | 4         |

## 2. Cards

| Colonne     | Type                  | Notes                                      |
|-------------|-----------------------|---------------------------------------------|
| Name        | Text                  | nom de l'oeuvre                             |
| Artist      | Text                  | membre de l'asso qui a cree l'oeuvre        |
| Description | Text (multiline)      | optionnel                                   |
| Rarity      | Reference -> Rarities | quelle rarete                               |
| Image       | Attachments            | l'image de la carte, uploadee dans Grist    |
| Active      | Bool                   | si `false`, la carte n'est plus tirable     |

## 3. Users

| Colonne             | Type      | Notes                                   |
|----------------------|-----------|------------------------------------------|
| DiscordId            | Text      | ID Discord de l'utilisateur, **cle de connexion** (unique) |
| DiscordUsername      | Text      | pseudo/nom global Discord, rafraichi a chaque connexion |
| DiscordAvatar        | Text      | hash d'avatar Discord (ou URL CDN complete), rafraichi a chaque connexion |
| Pseudo               | Text      | nom d'affichage modifiable par l'utilisateur (pre-rempli avec son nom Discord a la creation) |
| CreatedAt             | DateTime  | rempli a la creation                     |
| PullsSinceTopRarity   | Numeric   | compteur pour la pity (defaut 0)         |
| TotalPulls            | Numeric   | defaut 0                                  |
| BoosterCount          | Numeric   | solde actuel de boosters (defaut 0)      |

**Economie des boosters** : il n'y a plus de recharge automatique ni de
plafond. `BoosterCount` n'est modifie que par deux mecanismes :
- +N quand un utilisateur reclame un code d'evenement de type `booster`
  (voir `EventCodes`, gere par `redeem-code.json`) ;
- -1 quand un utilisateur ouvre un booster (gere par `open-pack.json`, qui
  tire toujours 5 cartes d'un coup).

**Connexion** : geree par `discord-login.json` (remplace l'ancien
`register-user.json` par pseudo). Le compte est identifie par `DiscordId` ;
`Pseudo` reste un champ libre que l'utilisateur peut modifier ensuite via
`update-pseudo.json`, il ne sert plus a la connexion.

## 4. Pulls

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
repetee N fois.

## 5. Config

Une seule ligne, parametres globaux du gacha.

| Colonne         | Type                  | Notes                                  |
|------------------|------------------------|------------------------------------------|
| PityThreshold    | Numeric                 | nb de tirages sans legendaire avant garantie (ex: 40) |
| TopRarity        | Reference -> Rarities   | la rarete garantie par la pity (ex: Legendaire) |

## 6. EventCodes

Un code cree par un admin pour un evenement, distribue oralement/a l'ecran
aux participants pendant sa duree de validite.

| Colonne         | Type                   | Notes                                   |
|------------------|------------------------|-------------------------------------------|
| Code             | Text                    | code a saisir sur le site (unique, genere ou choisi par l'admin) |
| Label            | Text                    | note interne optionnelle, ex "Soiree jeux 20/09" |
| RewardType       | Text                    | `booster` (ajoute des boosters) ou `card` (donne directement des exemplaires d'une carte precise) |
| Quantity         | Numeric                 | nb de boosters, ou nb d'exemplaires de la carte |
| CardId           | Reference -> Cards      | rempli seulement si `RewardType = card` |
| MaxRedemptions   | Numeric                 | nb max d'utilisateurs differents pouvant reclamer ce code ; 0 ou vide = illimite. Un meme utilisateur ne peut de toute facon reclamer un code qu'une seule fois (voir `CodeRedemptions`) |
| ExpiresAt        | DateTime                | epoch secondes ; passe cette date, le code n'est plus utilisable |
| Active           | Bool                    | permet a l'admin de desactiver un code avant son expiration |
| CreatedAt        | DateTime                | |
| CreatedBy        | Text                    | DiscordId de l'admin qui a cree le code |

## 7. CodeRedemptions

Une ligne par reclamation reussie. Sert a bloquer la double reclamation d'un
meme code par un meme utilisateur et a compter les usages face a
`MaxRedemptions`.

| Colonne     | Type                    | Notes |
|-------------|--------------------------|-------|
| Code        | Reference -> EventCodes  | |
| User        | Reference -> Users       | |
| RedeemedAt  | DateTime                 | |

## 8. Trades

Un echange cible entre deux utilisateurs : `FromUser` propose sa carte
`OfferedCard` contre la carte `RequestedCard` de `ToUser`. `ToUser` accepte
ou refuse.

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

---

## Images (pieces jointes)

Une cellule `Attachments` renvoie une liste d'ids de pieces jointes. Les
workflows `get-cards`, `open-pack`, `get-collection` et `redeem-code`
prennent le premier id de la liste `Image` d'une carte (une carte = une
image) et le renvoient au site sous le nom `imageId`.

Important : l'API de telechargement de Grist exige une authentification, donc
**pas d'URL publique directe**. Le site n'affiche jamais une URL Grist : il
appelle `{n8nBaseUrl}/image?id={imageId}`, un workflow n8n dedie
(`get-image.json`) qui telecharge l'image avec la cle API et la retransmet.
Voir "Pourquoi un workflow image a part" dans `/n8n/README.md`.

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

## Cle API Grist

Dans Grist: Profil -> "Parametres du compte" -> "Cles API" -> creer une cle.
Cette cle sert d'identifiant Bearer pour toutes les requetes HTTP faites par
n8n (voir `/n8n/README.md`).
