# 2Gatcha

Jeu de cartes à collectionner de l'association 2gether : les créations des
membres deviennent des cartes à obtenir en ouvrant des boosters (mécanique
type gacha), à collectionner, échanger, améliorer et utiliser dans des
mini-jeux.

- Site : <https://gatcha.2gether-asso.fr>
- API : <https://gatcha-api.2gether-asso.fr>

## Architecture

```
site/  (HTML/CSS/JS statique, GitHub Pages)
   |  fetch  /webhook/<chemin>
   v
api/   (Node.js, conteneur Docker)
   |  workflows/*.json  +  src/native/*.js
   v
SQLite  (data/2gatcha.sqlite : tables, joueurs, images)
   |  toutes les 6 h
   v
Azure Blob  (sauvegardes)
```

| Dossier | Contenu |
| --- | --- |
| [`site/`](site) | le site, sans build : HTML, `css/style.css`, `js/` |
| [`api/`](api) | le serveur : moteur de workflows, base, fonctionnalités natives, administration ([README](api/README.md)) |
| [`api/workflows/`](api/workflows) | la logique métier des actions du jeu (un fichier JSON par route) |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | les tables de la base et leurs règles métier |

### Le site

- `js/config.js` : adresse de l'API (`apiBaseUrl`), application Discord, admins,
  suivi des erreurs (GlitchTip).
- `js/api.js` : accès à l'API (lectures fusionnées et mises en cache quelques
  secondes, lots via `/webhook/batch`).
- `js/core.js`, `js/ui.js`, `js/shell.js` : socle commun chargé par toutes les
  pages (session et niveaux, composants d'interface, en-tête et menu).
- Un script par page : `collection-*.js`, `opening.js`, `trade.js`,
  `communaute.js`, `jeux.js`, `admin.js`, `admin-db.js`…
- `sw.js` : service worker des notifications push.

Connexion par Discord (OAuth, réservée aux membres du serveur de l'asso).

## Développer

```bash
cd api && npm install && npm test          # tests de l'API
SITE_DIR=../site npm start                 # API + site sur http://localhost:8080
```

Le site servi par l'API locale lui parle automatiquement. Les pages se testent
dans un navigateur ; aucun build n'est nécessaire.

## Déployer

Un push sur `main` suffit :

- **site** : GitHub Pages ([`.github/workflows/static.yml`](.github/workflows/static.yml)),
  avec la version du commit ajoutée aux JS/CSS pour que les navigateurs
  rechargent les bons fichiers ;
- **API** : image Docker publiée sur ghcr.io
  ([`.github/workflows/api-image.yml`](.github/workflows/api-image.yml)), puis
  sur le serveur `docker compose pull && docker compose up -d`.

Détails (Docker, sauvegardes, variables d'environnement) :
[`api/README.md`](api/README.md).

## Administrer

- [`site/admin.html`](site/admin.html) : codes événement, dons, équilibrage,
  extensions, boss, marché noir, bingo, récompenses de niveau, événements,
  économie, bandeau et maintenance (réservé aux comptes Discord admins).
- [`site/admin-db.html`](site/admin-db.html) : édition directe des tables et
  de leur structure, import des images, sauvegardes (mot de passe
  `ADMIN_TOKEN`).
