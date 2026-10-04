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
| `fishing.js` | `POST fishing` | pêche : chaque lancer coûte des poussières (os, clés, boosters, coffres…) |
| `unique.js` | `POST unique-counter` | rareté Unique (verte) : 1 Ticket Unique par ligne complète du coffre-fort, échangé au Comptoir contre la carte de son choix |
| `personal-vault.js` | `POST personal-vault` | coffre-fort perso : lignes de 6 finitions, pièces détachées (joker), récompense + ticket |
| `levels.js` | — (après `dig`) | niveaux de pêche et de fouille (1 à 10) |
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

**Saisons** : chaque mois (heure de Paris) repart de zéro. L'XP de départ est
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
