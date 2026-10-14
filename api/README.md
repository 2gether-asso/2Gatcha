# API 2Gatcha

Le serveur du jeu : il stocke toutes les données et exécute chaque action
(ouvrir un booster, décrafter, échanger…). Le site ne lui parle que par des
routes `/webhook/<chemin>`.

- **Node.js 24, base SQLite intégrée** (`node:sqlite`) : toutes les tables
  vivent en mémoire et chaque écriture est répercutée immédiatement sur le
  disque. Une action prend quelques millisecondes.
- **Une action à la fois** : un verrou global sérialise les écritures. Deux
  clics simultanés ne peuvent pas dépenser deux fois le même booster.
- **Logique métier dans des workflows** (`workflows/*.json`) exécutés par un
  petit moteur (`src/runtime.js`). Modifier une règle = modifier le JSON du
  workflow, puis redémarrer l'API.
- **Fonctionnalités natives** (`src/native/`) écrites directement en JS pour
  les ajouts récents (voir plus bas).
- **Dépendances** : `@sentry/node` (suivi des erreurs, inactif sans DSN) et
  `web-push` (notifications). Le reste ne dépend que de Node.

## Organisation

```
api/
  src/
    server.js      serveur HTTP : routes, verrou, CORS, site statique, /health
    runtime.js     moteur des workflows (webhook, code, if, table, httpRequest, respond)
    store.js       base : tables en mémoire + SQLite, conversion des types
    admin.js       routes /admin/api/... de site/admin-db.html (ADMIN_TOKEN)
    backup.js      sauvegardes Azure Blob
    monitoring.js  GlitchTip / Sentry
    native/        fonctionnalités natives + création automatique du schéma
  workflows/       46 workflows (format JSON : nœuds + connexions)
  scripts/         tests (schema-test, native-test, selftest), backup, restore
```

Le schéma des tables et leurs règles métier sont décrits dans
[`docs/SCHEMA.md`](../docs/SCHEMA.md).

## Lancer en local

```bash
cd api
npm install
npm test                                  # tests : schéma, natif, 46 workflows
SITE_DIR=../site npm start                # http://localhost:8080 (API + site)
AUTH_MODE=off SITE_DIR=../site npm start  # sans vérification des jetons (dev-login.html)
```

Sans base existante, l'API démarre sur une base vide ; pour travailler sur
de vraies données, copie une sauvegarde (voir « Sauvegardes ») dans
`data/2gatcha.sqlite`.

## Héberger avec Docker (image ghcr.io)

À chaque push sur `main` qui touche `api/` ou `site/`, GitHub Actions
([.github/workflows/api-image.yml](../.github/workflows/api-image.yml)) lance
les tests, construit l'image, vérifie qu'elle démarre, puis la publie sur
**`ghcr.io/2gether-asso/2gatcha-api`** (`latest`, `sha-<commit>`, et `1.2.3`
pour un tag git `v1.2.3`). Image amd64 et arm64.

Sur le serveur, seuls `docker-compose.yml` et `.env` sont nécessaires :

```bash
mkdir 2gatcha && cd 2gatcha                 # y copier docker-compose.yml et .env.example
cp .env.example .env                        # puis remplir
docker compose pull && docker compose up -d
```

**Mise à jour après un push** : `docker compose pull && docker compose up -d`.
Pour revenir à une version précise : `API_TAG=sha-abc1234` dans `.env`.

**Accès à l'image** : un paquet ghcr d'organisation est privé par défaut :
rends-le public (organisation 2gether-asso > Packages > 2gatcha-api >
Package settings > Change visibility), ou connecte le serveur avec un jeton
GitHub ayant `read:packages` (`docker login ghcr.io -u <pseudo>`).

La base vit dans `data/2gatcha.sqlite` (volume) : tables, comptes joueurs **et
images**, tout est dans ce seul fichier.

**Un seul conteneur pour tout** : il sert l'API (`/webhook/...`), la page
d'administration et le site, derrière ton reverse proxy (Caddy, Traefik,
nginx) qui gère le HTTPS.

- Le site et les workflows sont **embarqués dans l'image**. Option : si le
  dépôt est cloné sur le serveur, les lignes commentées du `docker-compose.yml`
  montent `site/` et `workflows/` du dépôt à la place.
- Le site servi par le conteneur parle automatiquement à l'API : `apiBaseUrl`
  est réécrit à la volée en `/webhook/` dans `js/config.js` (réglable avec
  `SITE_API_BASE`). Le site publié sur GitHub Pages, lui, utilise l'adresse
  publique écrite dans `site/js/config.js`.
- `dev-login.html`, `js/dev-login.js` et les fichiers cachés (`.git`, `.env`…)
  ne sont **jamais servis**.

## Sauvegardes Azure Blob (recommandé)

Avec `AZURE_BACKUP_SAS_URL` renseigné, l'API envoie toutes les 6 h
(`BACKUP_INTERVAL_HOURS`) une copie cohérente et compressée de la base vers un
conteneur Azure Blob : `backups/2gatcha-<date>.sqlite.gz`. Un créneau est
sauté si rien n'a changé. Les sauvegardes de plus de 30 jours
(`BACKUP_RETENTION_DAYS`) sont supprimées, mais les 3 plus récentes sont
toujours gardées.

1. Dans le portail Azure, crée un conteneur **privé** (ex. `2gatcha-backups`).
2. Sur ce conteneur, génère un **SAS** avec les droits *Read, Add, Create,
   Write, Delete, List* et une expiration lointaine (à renouveler). Copie
   l'« URL SAS d'objet blob » dans `AZURE_BACKUP_SAS_URL`.

```bash
docker compose run --rm api npm run backup             # sauvegarde immédiate
docker compose run --rm api npm run backup -- --list   # liste des sauvegardes
docker compose stop api                                # restauration :
docker compose run --rm api npm run restore -- latest  #   (ou le nom d'une sauvegarde)
docker compose start api
```

La restauration vérifie le fichier avant de l'utiliser et ne supprime jamais
la base actuelle (renommée en `2gatcha.sqlite.avant-restauration-<date>`).
L'onglet **Sauvegardes** de `admin-db.html` liste les sauvegardes et en lance
une à la main ; `/health` indique la date de la dernière.

## Schéma créé automatiquement

Au démarrage, l'API crée ce qui manque, sans rien supprimer :

- les tables et colonnes des fonctionnalités natives ;
- **toute colonne écrite par un workflow** mais absente de la base (type
  déduit du nom : nombre pour `…At`, `…Count`, `…Level`…, libre sinon). Une
  colonne oubliée ne donne donc plus d'erreur 500 au premier clic.

Le journal de démarrage liste ce qui a été créé.

## Fonctionnalités natives (`src/native/`)

Écrites directement en JS contre la base, avec les mêmes adresses
`/webhook/<chemin>` et le même verrou que les workflows. Certaines
s'appliquent **après** un workflow (bonus d'événement, poussière des
doublons, coup final au boss) sans le modifier.

| Module | Routes | Rôle |
| --- | --- | --- |
| `sets.js` | `POST set-rewards`, `GET set-completions` | récompense unique par set complet (coffre-fort compris) |
| `matches.js` | `POST trade-matches` | doublons des joueurs × wishlists |
| `streak.js` | `POST login-streak` | cadeau quotidien sur un cycle de 7 jours |
| `events.js` | `GET event-status`, `POST admin-event` | week-ends événement (poussières ×N, finitions ×N) |
| `boss.js` | `POST boss-attack`, `GET boss-leaderboard` | attaque en salve sur des exemplaires précis, multiplicateurs, classement, coup final |
| `economy.js` | `POST admin-economy` | tableau de bord de l'économie (admin) |
| `chests.js` | `POST chests` | coffres (achat, 1 coffre / 5 niveaux, 1 clé / 10 niveaux, ouverture avec une clé) |
| `duplicates.js` | — (après `open-pack`) | poussière passive pour chaque doublon à l'ouverture |
| `push.js` | `GET push-config`, `POST push` | notifications push (Web Push) |
| `seasons.js` | `POST season`, `POST admin-season` | saison mensuelle : paliers d'XP du mois, carte exclusive au dernier palier |
| `fishing.js` | `POST fishing`, `GET fishing-tournament` (+ après `dig`) | pêche : 1 ver par lancer, météo (relançable), carnet, appât doré, tournoi du week-end, rendements décroissants |
| `unique.js` | `POST unique-counter` | rareté Unique (verte) : 1 Ticket Unique par ligne complète du coffre-fort, échangé au Comptoir contre la carte de son choix |
| `personal-vault.js` | `POST personal-vault` | coffre-fort perso : lignes de 6 finitions, récompense + Ticket Unique |
| `levels.js` | `GET skills-leaderboard`, `POST prestige` (+ après `dig`) | niveaux de pêche et de fouille (1 à 10, chenil compris), prestige, classement de la semaine, rendements décroissants de la fouille |
| `activity.js` | — | bus d'activité : chaque action devient des événements (défis, objectif commun, succès secrets) ; annonces renvoyées dans `notices` |
| `challenges.js` | `POST challenges`, `POST community-goal` | défis de la semaine (5 proposés, 3 choisis) et objectif commun |
| `achievements.js` | `POST themes`, `GET achievements-hidden` | collections thématiques (titres) et succès secrets |
| `cosmetics.js` | `POST cosmetics` | boutique : titres, cadres d'avatar, couleurs de pseudo |
| `rules.js` | `POST reroll`, `GET economy-rules` | taxe d'échange, prix de l'os qui monte, marché noir automatique, relances payantes (météo, expédition) |
| `social.js` | `GET card-info`, `POST wishlist-alerts`, `GET`/`POST profile-wall` | fiche carte enrichie, alertes de liste de souhaits, mur et stats du profil |
| `garden.js` | `POST garden` | jardin : graines (mélange, vers, appâts, poussières), parcelles à acheter, vers et appâts dorés pour la pêche |
| `community-dig.js` | `POST community-dig` | grande fouille commune de la semaine (grand trésor partagé) |
| `simulator.js` | `POST admin-simulate` | simulateur d'ouverture de boosters pour les admins (modificateurs de rareté, finition, shiny, carte bonus, pity) : pur calcul, aucune écriture |
| `talents.js` | `POST talents` | arbre de talents : 1 point par niveau de compte, 3 branches, talents ultimes, remise à zéro payante |
| `feed.js` | `GET server-feed` | fil du serveur en direct (tirages remarquables ajoutés après la révélation, rangs, cartes ★, enchères…) |
| `progression.js` | `POST mastery`, `POST constellations`, `POST card-prestige`, `POST achievement-tiers` | maîtrise des extensions (3 couches, niveaux 1 à 10), rang de compte, 40 constellations, cartes ★, maîtrises de succès I/II/III |
| `daily.js` | `POST daily-box`, `POST daily-dice`, `POST welcome-back`, `POST evening`, `GET today` | boîte et dé du jour, action du jour (XP ×2), heures de chance, coup de chance de la semaine, bonus de retour, missions du soir |
| `market.js` | `POST contracts`, `POST auctions`, `GET exchange-rates`, `POST insurance`, `POST booster-shop` | contrats de collection, enchères, cours du décraft, assurance des exemplaires, boutique de boosters, restaurations répétées plus chères |
| `boosts.js` | – | bonus personnels appliqués après les workflows (heure de chance, dé, talents, maîtrise, cours du décraft, cartes ★, niveau d'expédition) |
| `insights.js` | `GET what-now`, `GET my-stats`, `GET player-card` | « que faire maintenant ? », statistiques perso (grand livre des poussières), carte de joueur au survol |
| `shop.js` | `POST shop` | boutique d'objets et de bonus (vers, appâts, os, coffres, clés, pièces, élixir de chance, potion d'XP, café du fouilleur, engrais, boussole), plafonds par semaine, catalogue `ShopCatalog` réglable |
| `inflation.js` | `GET economy-state` | pilotage de l'inflation : prix en poussières indexés sur le solde moyen des joueurs actifs, mode anti-inflation automatique (7 jours d'alerte → doublons ÷2, prix +25 %, taxes ×1,5, décraft −10 %, annonce dans le fil ; retour après 3 jours calmes) |
| `pity.js` | `GET rarity-pity` | pity par rareté (« Épique garantie dans N tirages ») et booster mystère (`open-pack { mystery: true }` : extension tirée au hasard, bonus de finition) |
| `treasure.js` | `GET`/`POST treasure-hunt` | course aux trésors hebdo : 5 indices cachés sur 5 pages du site (positions propres à chaque joueur) |
| `account-prestige.js` | `GET account-prestige` | prestige du compte : étoiles au-delà des talents complets (+1 point de talent, titre, cadre) |
| `balance.js` | — | équilibrage des boosters (2026-10-11) : booster de fouille gardé une fois sur deux et jamais au-delà du plein rendement du jour, chien sans boosters (poussières à la place), 4 os par jour ; migration unique `balance-2026-10-11` qui ramène aux nouvelles valeurs les réglages plus généreux (anciennes valeurs gardées dans AppSettings) |
| `upgrades.js` | `POST upgrades`, `POST finish-reroll` | dépenses durables : améliorations permanentes (chenil, serre, canne) et relance de finition payante |
| `ledger.js`, `context.js` | `POST admin-economy-log` | journal détaillé de l'économie : chaque mouvement de boosters (et de 200 poussières ou plus), avec le joueur, la route, l'action, qui l'a déclenché et le détail ; contexte propre à chaque requête (AsyncLocalStorage), conservé pendant les appels externes des workflows ; modifications de la page d'admin de la base notées `admin-db` |
| `presets.js` | `POST admin-preset` | modes de jeu Cool / Chill / Medium / Hard : 30 réglages d'économie changés d'un coup depuis Admin > Économie, avec aperçu des changements, recommandation selon l'inflation et annonce optionnelle aux joueurs ; Medium = valeurs par défaut ; le mode en cours est public (`event-status` → `gameMode`) et colore la barre de menu et le logo du site |
| `comfort.js` | — (hooks et bus d'activité) | confort malgré moins de boosters : booster mûri (+1 pt de finition par jour sans ouverture, 3 max), fragments de booster gagnés en jouant (10 = 1 booster, 6/jour), titres et cadres de progression, heure dorée hebdomadaire (finitions ×2, annoncée la veille), pluie de boosters quand l'objectif commun est atteint |
| `rendezvous.js` | `POST dog-gift`, `POST sunday-market`, `POST player-gift`, `GET weekly-recap` | trouvaille quotidienne du chien, marché du dimanche (4 cartes perso à prix réduit), cadeaux entre joueurs (1/jour), récapitulatif de la semaine passée |
| `modeperks.js` | `POST decraft-undo`, `POST weekly-goal` | bonus et malus propres à chaque mode de jeu. Cool : pas de prise vide, plantes qui ne fanent pas, decraft annulable 24 h, taxes à 0, câlin du chien. Chill : 4 choix de défi, doublon porte-bonheur, marché le mercredi, contrat de la semaine. Medium : pari sur booster, double tranchant. Hard : usure des cartes, cartes forgées dans le feu, taxe de luxe, boss plus dur mais mieux payé. Plus une carte exclusive par mode (jours joués dans le mode) |
| `machine.js` | `POST machine-room` | salle des machines (Communauté) : une fois par mois, 5 sacrifices (clés, poussières + vers, pièces + appâts, boosters, doublons) puis un vote pour le mode de jeu (Chaos compris) ; par défaut (MachineVoteDay = 0) le vote dure tout le mois et le mode gagnant s'applique le 1er du mois suivant. Suite : étape 6 « Surchauffe » facultative (vote double), jauge commune (MachinePressureGoal salles → 1 booster par participant), chef mécanicien (titre + cadre jusqu'au mois suivant), assiduité (3 mois d'affilée → MachineLoyaltyCard ou 3 boosters), second vote pour l'événement du 2e week-end du mois suivant (ScheduledEvents) |
| `features.js` | `POST admin-mode-features` | fonctionnalités et pages ouvertes selon le mode de jeu : matrice fonctionnalité × mode modifiable dans Admin > Économie (pages Boutique, Coffre-fort, Échanges ; jeux ; onglets Communauté ; modes de la collection ; rendez-vous quotidiens). Fermée = masquée sur le site, page remplacée par un message, écritures refusées par l'API (`feature_disabled`), plus suggérée dans « Que faire maintenant ? ». Par défaut : Medium tout ouvert ; Cool ferme marché noir et enchères ; Chill ferme les enchères ; Hard ferme l'achat de boosters, le marché du dimanche et le colis de retour. Le bingo n'est pas concerné |
| `modeextras.js` | `POST admin-mode-schedule`, `GET hard-leaderboard` | mode Chaos (une règle tirée chaque jour : surcouche des réglages lus côté natif, fonctionnalités fermées du jour), succès de mode (achievements.js, profil), changement de mode programmé avec bandeau de préavis (ModeNoticeHours, aussi pour la fin du vote de la salle des machines), classement Hard (points gagnés pendant une période Hard), parapluie de la boutique (UmbrellaUntil : pas d'usure) |
| `editions.js` | — (hooks) | éditions limitées : Pulls.Edition posée par-dessus la finition classique à l'ouverture (EditionChance, SeasonalEditionChance) ; une par mode (Givrée, Tropicale, Prismatique, Braise, Glitch), une par événement saisonnier, Fantôme pour la carte du mois ; jamais usées ni sacrifiées automatiquement |
| `seasonal.js` | `POST seasonal` | événements saisonniers (Nouvel an, Saint-Valentin, Pâques, Poisson d'avril, Fête de la musique, Halloween, Noël) : thème du site, cadeau du jour (avec un « sort » possible), trouvailles en jouant, boss d'Halloween et de Noël créé tout seul |
| `phantom.js` | `GET phantom` | carte fantôme du mois : 5 fragments (pêche, fouille, jardin, boss, salle des machines), carte en finition Ghost et édition Fantôme |
| `lottery.js` | `POST lottery` | loterie du dimanche : tickets en poussières (LotteryBurnPct détruit), cagnotte tirée le dimanche à 21 h, reportée sans joueur |
| `wanted.js` | `POST wanted` | avis de recherche hebdomadaire : une carte commune à rare, les WantedSlots premiers donateurs d'un doublon sont récompensés, la carte rejoint le coffre de guilde |
| `halloffame.js` | `GET hall-of-fame` | livre d'or : premier joueur à avoir tiré chaque mythique, chaque finition rare et chaque édition limitée |
| `teams.js` | `POST teams` | guerre des équipes mensuelle : 4 équipes équilibrées, points par activité, titre de champion à l'équipe gagnante le 1er du mois |
| `duo.js` | `POST duo-expedition` | expédition en duo : invitation, acceptation, butin partagé (poussières, XP d'expédition, chance de booster) |
| `settings.js` | `POST admin-settings` | réglages du jeu modifiables depuis la page Admin |
| `auth.js` | — (avant chaque requête) | jeton signé et limite de débit |
| `workflow-schema.js` | — | colonnes des workflows créées au démarrage |

Les admins des routes natives sont ceux de `ADMIN_DISCORD_IDS` (par défaut
les deux mêmes que les workflows).

**Réglages** (`settings.js`) : une quarantaine de paramètres (sécurité,
boosters, coffres, pêche, saison, série de connexion, sets, boss, fouille,
coffre-fort perso, notifications), modifiables dans Admin > « Réglages
avancés », avec bornes vérifiées côté serveur. Un réglage jamais modifié
garde sa valeur par défaut. Ceux lus par les workflows sont des colonnes de
la ligne `Config` ; les autres sont gardés dans `AppSettings`.

**Journal de l'économie** : toute variation de boosters, poussières ou vers d'un joueur est cumulée par jour et par source (table `EconomyDaily`, voir `index.js`) ; le tableau de bord de l'admin affiche les flux et des alertes d'inflation.

**Événements planifiés** (`events.js`, `POST admin-events`) : table `ScheduledEvents`, appliqués tout seuls entre leur début et leur fin ; l'événement manuel reste prioritaire. Admin > « Tableau de bord des événements ».

**Pêche en eaux profondes** (`fishing.js`, `zone: 'deep'`) : débloquée au niveau `DeepFishingLevel` (ou après un prestige de pêche), table `DeepFishingLoot` (perles noires, appâts dorés).

**Saisons** : chaque mois (heure de Paris) repart de zéro. Le coffre de saison se remplit avec l'XP du mois et s'ouvre le mois suivant (`action: 'claimChest'`). L'XP de départ est
notée à la première action du joueur dans le mois ; chaque palier
(`SeasonXpPerTier`) se réclame une fois. La carte exclusive du mois se
choisit dans Admin > « Saison mensuelle » (table `SeasonCards`) ; sans
carte, le dernier palier donne seulement sa récompense.

## Authentification et limite de débit

À la connexion Discord, l'API renvoie un **jeton signé** (HMAC-SHA256,
valable `AuthTokenDays` jours) que le site envoie dans
`Authorization: Bearer …`. Toute requête qui porte une identité
(`userId`, `fromUserId`, `discordId`) doit avoir le jeton de ce même
joueur : sinon 401 (absent ou invalide, le site déconnecte et propose de se
reconnecter) ou 403 (jeton d'un autre joueur). Les lectures publiques
(catalogue, images, classement…) restent ouvertes.

- `AUTH_SECRET` : clé de signature. Vide = générée au premier démarrage et
  gardée en base (`AppSettings`). La changer déconnecte tout le monde.
- `AUTH_MODE=off` : désactive la vérification (développement local).

Chaque joueur (ou adresse IP sans identité) est limité par minute à
`RateLimitWritesPerMinute` actions (60) et `RateLimitReadsPerMinute`
lectures (400) ; au-delà : 429 avec `Retry-After`.

**Notifications push** : clés VAPID générées au premier démarrage et gardées
en base (table `AppSettings`) ; `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
permettent de les imposer. Envoi chaque minute, jamais entre 22 h et 9 h, une
seule fois par événement. Sur iPhone, le site doit être ajouté à l'écran
d'accueil pour recevoir des notifications.

## Lectures groupées (`/webhook/batch`)

`POST /webhook/batch` avec `{ "calls": [{ "path": "quests", "method": "POST", "body": { "userId": 1, "action": "status" } }, { "path": "site-banner" }] }`
exécute jusqu'à 24 **lectures** en une seule requête et renvoie
`{ "results": [{ "status", "json" }] }`, dans l'ordre. Les écritures sont
refusées : seuls les `GET` et les `POST` dont l'action est `status`, `list`
ou `get` sont acceptés. Le site s'en sert pour tout ce qui est commun aux
pages (en-tête, pastilles du menu, bandeau) : une requête au lieu d'une
vingtaine.

## Page d'administration de la base

`site/admin-db.html` (lien depuis la page Admin) parle directement à l'API,
protégée par le mot de passe `ADMIN_TOKEN`. Elle reste accessible pendant une
maintenance.

- **Images** : import groupé par extension (chaque fichier est associé à
  l'image d'origine du même nom), redimensionné (900 px) et converti en WebP
  **dans le navigateur** avant l'envoi. Remplacer une image crée une nouvelle
  pièce jointe et redirige les cartes vers elle (cache navigateur d'un an).
- **Tables** : édition directe des cellules, ajout et suppression de lignes.
- **Structure** (bouton « Structure » ou clic sur un en-tête de colonne) :
  ajouter, renommer, changer le type (valeurs reconverties) et supprimer des
  colonnes ; créer, renommer et supprimer des tables. Avant un renommage ou
  une suppression, la page liste les workflows qui mentionnent ce nom.
- **Sauvegardes** : liste et sauvegarde immédiate.

## Configuration (`.env`)

| Variable | Rôle |
| --- | --- |
| `PORT` / `API_PORT` | port interne / port exposé |
| `DB_PATH` | fichier SQLite (défaut `data/2gatcha.sqlite`) |
| `SITE_DIR` | dossier du site à servir (vide = API seule) |
| `SITE_API_BASE` | adresse de l'API injectée dans le `js/config.js` servi (défaut `/webhook/`) |
| `WORKFLOWS_DIR` | dossier des workflows (défaut `workflows/`) |
| `ALLOWED_ORIGINS` | origines CORS autorisées (`*` par défaut) |
| `ADMIN_TOKEN` | mot de passe de `admin-db.html` (vide = administration désactivée) |
| `ADMIN_DISCORD_IDS` | admins des routes natives (défaut : les deux admins du jeu) |
| `AUTH_SECRET` | clé de signature des jetons de connexion (vide = générée et gardée en base) |
| `AUTH_MODE` | `off` pour désactiver la vérification des jetons (local uniquement) |
| `SENTRY_DSN` | suivi des erreurs GlitchTip : DSN complet du projet API (`https://<clé>@glitchtip.matiboux.com/2`), vide = désactivé |
| `DISCORD_CLIENT_SECRET`, `DISCORD_WEBHOOK_URL` | secrets injectés dans les nœuds « Set Config » des workflows à la place des `CHANGE-MOI` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | clés des notifications push (générées automatiquement si absentes) |
| `AZURE_BACKUP_SAS_URL` | URL SAS du conteneur Azure Blob des sauvegardes (vide = désactivées) |
| `BACKUP_PREFIX`, `BACKUP_INTERVAL_HOURS`, `BACKUP_RETENTION_DAYS` | dossier, fréquence (h) et conservation (jours) des sauvegardes |
| `LOG_REQUESTS` | `0` pour couper le journal des requêtes |

## Écrire ou modifier un workflow

Voir la fin de [`docs/SCHEMA.md`](../docs/SCHEMA.md) (« Ecrire un workflow : regles du moteur »). Après modification : `npm test`, puis commit ; la
CI publie la nouvelle image.
