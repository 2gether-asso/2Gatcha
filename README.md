# 2Gatcha

Site d'ouverture de packs et de collection permettant aux membres de l'asso
de collectionner les creations artistiques (art) produites par l'asso, sous
forme de cartes a tirer aleatoirement (mecanique type gacha).

## Architecture

```
site (HTML/CSS/JS statique)
   |  fetch (webhooks)
   v
n8n  (logique de tirage, "API")
   |  API REST Grist
   v
Grist (tables Cards/Rarities/Users/Pulls/Config, images en pieces jointes)
```

- **`/site`** : le site statique (pas de build, ouvrable directement dans un
  navigateur ou servable par n'importe quel serveur de fichiers statiques).
- **`/n8n`** : les workflows n8n a importer, qui font office d'API entre le
  site et Grist.
- **`/grist`** : le schema des tables Grist a creer, et comment y stocker les
  images des cartes en pieces jointes.

## Demarrage rapide

1. **Grist** : cree un document et les 5 tables decrites dans
   [`grist/SCHEMA.md`](grist/SCHEMA.md), ajoute quelques cartes (avec image en
   piece jointe) et les raretes.
2. **n8n** : importe et configure les 6 workflows dans
   [`n8n/workflows`](n8n/workflows) en suivant [`n8n/README.md`](n8n/README.md).
3. **Site** : ouvre [`site/js/config.js`](site/js/config.js) et remplace
   `n8nBaseUrl` par l'URL de tes webhooks n8n.
4. Ouvre `site/index.html` dans un navigateur (ou heberge le dossier `site`
   sur un serveur statique / pages de l'asso).

## Parcours utilisateur

1. Choix d'un pseudo sur la page d'accueil (pas de mot de passe, cree/retrouve
   l'utilisateur via `register-user`).
2. Ouverture de pack (1 ou 5 cartes) sur `ouverture.html`, avec animation de
   reveal et couleur selon la rarete.
3. Consultation de la collection sur `collection.html` : progression globale,
   filtres par rarete, cartes non decouvertes affichees en silhouette.

## Etat actuel / prochaines etapes possibles

- Le tirage gere un systeme de pity (garantie de la rarete la plus haute
  au bout d'un certain nombre de tirages), configurable dans la table
  `Config`.
- Pas d'authentification forte : adapte a un usage interne d'asso. Voir la
  section "Limites connues" de [`n8n/README.md`](n8n/README.md) si le site
  doit etre expose publiquement.
- Idees d'evolution : classement des membres par nombre de cartes,
  echange de cartes entre membres, limite de tirages par jour.
