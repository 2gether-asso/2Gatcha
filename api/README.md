# API 2Gatcha

Serveur autonome qui remplace **n8n + Grist**. Il expose exactement les mêmes
adresses que les webhooks n8n (`/webhook/<chemin>`), avec les mêmes formats de
requête et de réponse : côté site, la bascule se résume à changer une URL.

- **Node.js 24, aucune dépendance** : SQLite intégré à Node (`node:sqlite`).
- **Données en mémoire + SQLite** : plus aucune relecture réseau de tables
  entières à chaque clic. Une action prend quelques millisecondes, contre
  plusieurs secondes (parfois plusieurs minutes) sur n8n.
- **Actions sérialisées** : une seule action modifie les données à la fois.
  Deux clics simultanés ne peuvent plus dépenser deux fois le même booster.
- **Logique métier inchangée** : les workflows de `n8n/workflows/*.json` sont
  exécutés par un petit moteur compatible (`src/runtime.js`). Modifier un
  workflow = modifier son JSON, puis redémarrer l'API.

## Lancer en local

```bash
cd api
npm test                                   # test du moteur sur une base d'essai
GRIST_API_KEY=... npm run import           # copie des données Grist -> data/2gatcha.sqlite
SITE_DIR=../site npm start                 # http://localhost:8080 (API + site)
```

## Héberger avec Docker

```bash
cd api
cp .env.example .env          # puis remplir les secrets Discord et la clé Grist
docker compose up -d --build
```

La base vit dans `api/data/2gatcha.sqlite` (volume). Pour la sauvegarder, il
suffit de copier ce fichier, idéalement API arrêtée, ou avec
`sqlite3 2gatcha.sqlite ".backup save.sqlite"`.

**Un seul conteneur pour tout** : il sert l'API (`/webhook/...`), la page
d'administration et le site, derrière ton reverse proxy habituel (Caddy,
Traefik, nginx) qui gère le HTTPS.

- `site/` et `n8n/workflows/` sont **montés en lecture seule** depuis le dépôt.
  Après un `git pull`, le site est à jour immédiatement ; pour une
  modification de workflow, il faut un `docker compose restart`.
- Le site servi par le conteneur parle automatiquement à l'API : le serveur
  réécrit à la volée `n8nBaseUrl` en `/webhook/` dans `js/config.js` (réglable
  avec `SITE_API_BASE`). Le fichier du dépôt n'a donc pas besoin d'être modifié.
- `dev-login.html`, `js/dev-login.js` et les fichiers cachés (`.git`, `.env`…)
  ne sont **jamais servis**, même s'ils sont présents dans le dossier monté.

## Bascule depuis n8n

1. **Maintenance** : active le mode maintenance du site (bandeau admin), pour
   qu'aucune action ne se perde entre l'import et la bascule.
2. **Import** : `docker compose run --rm api npm run import`. Lecture seule
   côté Grist. Le script liste les colonnes formules : leurs valeurs sont
   figées, l'API ne les recalcule pas.
3. **Vérification** : `docker compose run --rm -e API_URL=http://api:8080 api npm run compare`
   (ou en local, `API_URL=http://localhost:8080 npm run compare`). Compare les
   réponses en lecture seule de n8n et de l'API.
4. **Bascule** : fais pointer `gatcha.2gether-asso.fr` (DNS ou reverse proxy)
   vers le conteneur. Le site qu'il sert utilise déjà l'API : rien à modifier
   dans le code. L'URL de redirection Discord reste valable tant que le domaine
   ne change pas.
5. **Fin de maintenance**, puis désactive les workflows dans n8n (garde-les
   quelques jours en secours, sans les réactiver : les données divergeraient).

## Page d'administration de la base

`site/admin-db.html` (lien depuis la page Admin) parle directement à l'API,
protégée par le mot de passe `ADMIN_TOKEN`. Elle reste accessible pendant une
maintenance.

- **Images** : import groupé par extension. Chaque fichier est associé à
  l'image d'origine du même nom (`17.png` → la carte dont l'image s'appelait
  `17.png`), puis redimensionné (900 px par défaut) et converti en WebP
  **dans le navigateur** avant l'envoi. Remplacer une image existante crée une
  nouvelle pièce jointe et redirige les cartes vers elle (les navigateurs
  gardent les images en cache un an).
- **Tables** : édition directe des cellules, ajout et suppression de lignes,
  ajout de colonnes. C'est ce qui remplace l'édition dans Grist.

## Configuration (`.env`)

| Variable | Rôle |
| --- | --- |
| `PORT` / `API_PORT` | port interne / port exposé |
| `DB_PATH` | fichier SQLite (défaut `data/2gatcha.sqlite`) |
| `SITE_DIR` | dossier du site à servir (vide = API seule) |
| `SITE_API_BASE` | adresse de l'API injectée dans le `js/config.js` servi (défaut `/webhook/`) |
| `ALLOWED_ORIGINS` | origines CORS autorisées (`*` par défaut) |
| `ADMIN_TOKEN` | mot de passe de `admin-db.html` (vide = administration désactivée) |
| `DISCORD_CLIENT_SECRET`, `DISCORD_WEBHOOK_URL` | secrets injectés dans les nœuds « Set Config » à la place des `CHANGE-MOI` |
| `GRIST_URL`, `GRIST_DOC`, `GRIST_API_KEY` | import initial uniquement |

## Limites connues

- **Images** : si le stockage des pièces jointes Grist est indisponible pendant l'import, les images manquantes sont listées ; `IMAGES_ONLY=1 npm run import` les rapatrie plus tard sans toucher aux données.
- **Colonnes formules Grist** : figées à l'import (voir le rapport de
  `npm run import`).
