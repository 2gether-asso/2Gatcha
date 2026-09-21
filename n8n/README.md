# Workflows n8n - 2Gatcha

11 workflows a importer dans n8n, un par fichier JSON dans `workflows/`. Chacun
expose un webhook qui sert d'API pour le site (`/site`). Ils utilisent le
**node natif Grist** de n8n (pas de bricolage HTTP manuel) pour lire/ecrire
les tables, et un node HTTP Request dedie uniquement pour servir les images
(voir plus bas, "Pourquoi un workflow image a part").

| Fichier                   | Methode | Chemin webhook            | Role                                      |
|----------------------------|---------|-----------------------------|---------------------------------------------|
| `discord-login.json`       | POST    | `/webhook/discord-login`     | echange le code OAuth Discord, cree/retrouve le compte |
| `update-pseudo.json`       | POST    | `/webhook/update-pseudo`     | modifie le pseudo affiche d'un utilisateur |
| `list-users.json`          | GET     | `/webhook/users`             | liste minimale (userId, pseudo) pour le selecteur d'echange |
| `get-cards.json`           | GET     | `/webhook/cards`             | catalogue complet des cartes actives       |
| `open-pack.json`           | POST    | `/webhook/open-pack`         | ouvre 1 booster (5 cartes), decremente le solde |
| `get-collection.json`      | GET     | `/webhook/collection`        | collection d'un utilisateur + progression  |
| `get-image.json`           | GET     | `/webhook/image?id=...`      | sert l'image d'une carte (proxy vers Grist)|
| `get-booster-status.json`  | GET     | `/webhook/booster-status`    | solde de boosters actuel                   |
| `redeem-code.json`         | POST    | `/webhook/redeem-code`       | reclame un code d'evenement (boosters ou carte precise) |
| `admin-codes.json`         | POST    | `/webhook/admin-codes`       | creation/liste/revocation des codes (reserve aux admins) |
| `trade.json`               | POST    | `/webhook/trade`             | echanges cibles entre deux joueurs         |

Ces chemins correspondent a ceux deja configures dans `site/js/config.js`.

## 1. Creer la credential Grist (une seule fois)

Dans n8n : **Credentials -> Add Credential -> Grist API**
- **API Key** : dans Grist, icone profil -> Parametres du compte -> Cles API.
- **Grist URL** : l'URL de ton instance (ex: `https://docs.getgrist.com`, ou
  celle de ton self-host).
- Sauvegarde sous le nom **"Grist account"**.

Utilisee par tous les nodes Grist natifs de tous les workflows, ainsi que par
le node HTTP Request "Download Attachment" de `get-image.json`.

**Particularite de `get-image.json`** : le node "Download Attachment" est un
HTTP Request generique (pas un node Grist natif) car il doit recuperer une
reponse binaire. Selectionner la credential "Grist account" dessus (type
`predefinedCredentialType` / `gristApi`) ne suffit pas toujours a injecter
l'en-tete d'authentification sur ce type de node : le workflow ajoute donc
en plus, en dur dans ses parametres, un header `Authorization: Bearer
TA_CLE_API_GRIST` (la meme cle que la credential). Remplace le placeholder
`CHANGE-MOI-GRIST-API-KEY` par ta vraie cle API Grist directement dans le
node (pas de credential supplementaire a creer).

## 2. Creer l'application Discord (une seule fois)

1. Va sur https://discord.com/developers/applications -> **New Application**.
2. Dans **OAuth2 -> General** :
   - note le **Client ID** (public, sans risque de le mettre dans le site) ;
   - genere/note le **Client Secret** (a garder uniquement dans le workflow
     n8n, jamais dans le site) ;
   - ajoute une **Redirect URL** correspondant exactement a
     `https://ton-site/auth-callback.html` (le protocole, le domaine et le
     chemin doivent matcher a l'identique cote Discord et cote
     `discord-login.json`).
3. Recupere l'**ID du serveur Discord de l'asso** (active le mode
   developpeur dans Discord, clic droit sur le serveur -> "Copier l'ID du
   serveur"). C'est ce serveur qui sert de "carte de membre" : seuls ses
   membres pourront se connecter au site.
4. Recupere ton propre **ID Discord** (clic droit sur ton profil -> "Copier
   l'ID utilisateur") pour la liste des administrateurs (etape 4 ci-dessous).

Aucun bot n'est necessaire : la verification d'appartenance au serveur se
fait via le scope OAuth `guilds` (le site demande a Discord "quels serveurs
cet utilisateur a autorises", pas besoin d'ajouter de bot dessus).

## 3. Importer chaque workflow

Pour chacun des 11 fichiers dans `n8n/workflows/` :
1. **Workflows -> Add workflow -> Import from File**.
2. Ouvre le node **"Set Config"** (juste apres le Webhook) : `docId` et
   (pour `get-image.json`) `gristBaseUrl` sont deja renseignes avec les
   vraies valeurs de l'instance de l'asso, rien a changer. Il reste juste a
   remplacer les placeholders encore presents :
   - `clientId` / `clientSecret` / `redirectUri` / `guildId` : uniquement
     dans `discord-login.json` (voir etape 2 ci-dessus).
   - `adminDiscordIds` : uniquement dans `admin-codes.json` (tableau de
     chaines, un ID Discord par administrateur autorise a creer des codes).
   - la cle API Grist en dur sur le node "Download Attachment" de
     `get-image.json` (voir etape 1).
3. Sur chaque node Grist (icone Grist), verifie que la credential
   **"Grist account"** est bien selectionnee (elle devrait l'etre
   automatiquement, les fichiers reference deja son ID reel).
4. Active le workflow (toggle "Active" en haut a droite).

Fais ca pour les 11 workflows.

**Important** : toutes les tables de `/grist/SCHEMA.md` doivent deja exister
avec exactement les colonnes decrites (`Users` a notamment besoin de
`DiscordId`, `DiscordUsername`, `DiscordAvatar`, `BoosterCount` ; les
nouvelles tables `EventCodes`, `CodeRedemptions` et `Trades` sont
indispensables aux nouveaux workflows).

## 4. Brancher le site

Dans [`site/js/config.js`](../site/js/config.js) :
```js
n8nBaseUrl: "https://ton-n8n.fr/webhook",
discordClientId: "LE-CLIENT-ID-DE-L-ETAPE-2",
adminDiscordIds: ["TON-ID-DISCORD", "..."], // meme liste que adminDiscordIds cote n8n
```
`discordRedirectUri` est calcule automatiquement a partir de l'URL du site
(il doit pointer vers `auth-callback.html`) ; verifie juste qu'il correspond
bien a la Redirect URL enregistree sur l'application Discord.

## 5. Tester dans l'ordre

Le login Discord ne peut pas se tester avec `curl` seul (il faut passer par
le navigateur pour obtenir un `code` OAuth) : ouvre le site, clique sur "Se
connecter avec Discord", verifie que tu arrives bien sur `index.html` connecte.
Une fois connecte, note ton `userId` (visible dans le localStorage du
navigateur, cle `2gatcha_userId`) pour la suite.

```bash
# 1. Lister les cartes
curl https://ton-n8n.fr/webhook/cards
# -> cartes avec un "imageId" (pas une URL directe, voir plus bas)

# 2. Voir une image dans le navigateur
# https://ton-n8n.fr/webhook/image?id=<imageId recupere ci-dessus>

# 3. Creer un code de test (remplace TON-ID-DISCORD par un ID present dans
#    adminDiscordIds)
curl -X POST https://ton-n8n.fr/webhook/admin-codes \
  -H "Content-Type: application/json" \
  -d '{"discordId":"TON-ID-DISCORD","action":"create","rewardType":"booster","quantity":3,"expiresInHours":4}'
# -> {"code":"XXXXXXXX", ...}

# 4. Reclamer ce code (remplace USER_ID par le userId note plus haut)
curl -X POST https://ton-n8n.fr/webhook/redeem-code \
  -H "Content-Type: application/json" -d '{"userId":USER_ID,"code":"XXXXXXXX"}'

# 5. Ouvrir un booster
curl -X POST https://ton-n8n.fr/webhook/open-pack \
  -H "Content-Type: application/json" -d '{"userId":USER_ID}'

# 6. Voir la collection
curl "https://ton-n8n.fr/webhook/collection?userId=USER_ID"

# 7. Lister les codes crees (admin)
curl -X POST https://ton-n8n.fr/webhook/admin-codes \
  -H "Content-Type: application/json" -d '{"discordId":"TON-ID-DISCORD","action":"list"}'
```

Si une etape echoue : **404** = workflow pas actif, **401/403** = credential
Grist mal configuree/cle API invalide (ou, pour `admin-codes`, ID Discord
absent de `adminDiscordIds`), **erreur dans un node "Code"** = verifie que
les tables Grist ont des donnees et que les noms de colonnes correspondent
exactement a `/grist/SCHEMA.md`.

## Pourquoi un workflow image a part

Les pieces jointes Grist ne sont **pas accessibles publiquement** : l'API de
telechargement exige un header `Authorization: Bearer <cle API>`. Un simple
`<img src="https://grist/.../download">` depuis le navigateur ne fonctionnerait
donc jamais (401).

`get-image.json` sert de proxy : n8n telecharge l'image avec sa propre cle
API (jamais exposee au navigateur) et la retransmet telle quelle. C'est pour
ca que les workflows renvoient un `imageId` (l'identifiant de la piece
jointe) plutot qu'une URL Grist directe ; le site construit lui-meme l'URL
finale via `API.imageUrl(imageId)` -> `{n8nBaseUrl}/image?id=...`.

## Economie des boosters et codes d'evenement

Il n'y a plus de recharge horaire ni de plafond : `BoosterCount` est un
simple solde qui ne bouge que via deux mecanismes :
- `redeem-code.json` (+N boosters quand un utilisateur reclame un code
  d'evenement de type `booster`) ;
- `open-pack.json` (-1 a chaque ouverture, qui tire toujours 5 cartes ;
  repond `{"error":"no_boosters","count":0}` si le solde est a 0).

Le seul moyen d'obtenir des boosters (ou une carte precise hors tirage) est
donc de reclamer un code cree par un admin via `admin-codes.json` / la page
`admin.html`. Voir `grist/SCHEMA.md`, tables `EventCodes` et
`CodeRedemptions`, pour le detail des champs et des regles (1 reclamation
par utilisateur et par code, expiration, plafond global optionnel).

## Logique de tirage (open-pack)

- Chaque rarete a un `Weight` (table `Rarities`), le tirage est pondere.
- Un compteur de pity par utilisateur (`PullsSinceTopRarity`) garantit la
  rarete definie dans `Config.TopRarity` au bout de `Config.PityThreshold`
  tirages sans l'avoir obtenue.
- Le node "Draw Cards" produit un item par carte tiree ; le node Grist
  "Insert Pulls" s'execute donc automatiquement une fois par carte (c'est le
  comportement normal des nodes n8n : ils tournent une fois par item recu).

## Echanges (trade.json)

Un echange est toujours cible : `FromUser` propose sa carte contre celle de
`ToUser` (identifie par pseudo au moment de la creation), qui accepte ou
refuse. A l'acceptation, le workflow ne cree pas de nouvelles cartes : il
reassigne le champ `User` d'une ligne `Pulls` existante de chaque cote (un
exemplaire change juste de proprietaire). Si l'une des deux cartes n'est
plus disponible au moment de l'acceptation (deja echangee ailleurs entre
temps), l'echange reste `pending` et l'erreur `cards_no_longer_available`
est renvoyee ; l'utilisateur peut reessayer ou l'initiateur peut annuler.

## Limites connues / a adapter

- Le filtre integre du node Grist (`Additional Options -> Filter`) a un bug
  connu sur les colonnes texte (n8n#21323) : les workflows evitent donc
  volontairement ce filtre et recuperent toutes les lignes (`Return All`),
  puis filtrent dans un node Code. Sans consequence pour un usage d'asso
  (quelques dizaines/centaines de lignes), mais a garder en tete si le volume
  de donnees grossit beaucoup.
- Les pseudos ne sont pas garantis uniques (le champ `Pseudo` est librement
  modifiable). Pour les echanges, `trade.json` prend le premier utilisateur
  dont le pseudo correspond : en cas d'homonymie, le mauvais destinataire
  pourrait etre choisi. Negligeable pour un usage d'asso a petite echelle,
  mais a garder en tete.
- La liste `adminDiscordIds` (droit de creer/revoquer des codes) est codee en
  dur dans `admin-codes.json` et dupliquee cote site (`config.js`, juste pour
  l'affichage du lien "Admin"). Toute modification demande d'editer les deux.
- Les webhooks n8n sont publics par defaut (n'importe qui connaissant l'URL
  peut les appeler). L'admin est protege par verification d'ID Discord ; les
  autres endpoints n'ont pas de protection supplementaire au-dela de ce que
  chaque workflow verifie deja (appartenance au serveur Discord pour se
  connecter, propriete des cartes/echanges pour les actions qui les
  modifient).
- Interet potentiel a explorer plus tard : integrer le site comme une
  **Discord Activity** (app embarquee dans un salon vocal via l'Embedded App
  SDK). Faisable, mais implique un mapping d'URL via le proxy Discord pour
  les appels a n8n et un flux d'authentification different (SDK plutot que
  redirection classique) : a traiter comme une evolution separee, une fois
  le login Discord classique valide en production.
