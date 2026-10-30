# Audit : opérations en lot (31 octobre 2026)

## Constat

- Le site découpait les lots : recyclage par 25, fusions par 25, autel par 10, requêtes attendues l'une après l'autre.
  Le décraft d'une sélection en mode classeur (`collection-binder.js`) faisait même un appel par carte.
- Le serveur limitait un lot à 50 écritures.
- Aucune attente réelle pendant un lot : le serveur enchaînait les appels sans rendre la main, donc **l'API était gelée
  pour tous les joueurs jusqu'à la fin du lot**.
- Chaque décraft reparsait 5 fois toute la table `Pulls` (44 142 lignes en prod), cartes des autres joueurs comprises.
- Les réponses en lot ne passaient pas par `API._announce` : succès, découvertes et bonus personnels n'étaient jamais
  affichés, et les cartes obtenues n'étaient pas retirées des souhaits.

## Mesures (poste de développement, base de test)

| Lot de décrafts | Exemplaires en base | Avant | Après |
|---|---|---|---|
| 50 | 2 000 | 1,0 s (20 ms par décraft) | non mesuré |
| 50 | 10 000 | 2,9 s (58 ms) | non mesuré |
| 50 | 30 000 | 8,0 s (161 ms) | non mesuré |
| 50 | 44 000 | non mesuré | 0,8 s (16 ms) |
| 2 000 | 30 000 | abandonné après 5 min | non mesuré |
| 2 000 | 44 000 | non mesuré | 23,6 s (12 ms) |

`/health` pendant le lot de 2 000 : 21 ms en médiane, 444 ms au pire, 476 réponses. Avant : aucune réponse tant que le
lot tournait.

Ces mesures ne couvrent que le décraft, sans cartes ★ dans la base. Craft, fusions, autel et fouille gagnent le rendu de
la main et les corrections du runner, mais leur durée sur une grosse base n'a pas été mesurée.

## Changements

### API
- `store.js` : `rowsBy` / `countBy`, index de colonne construits à la demande, tenus à jour par `write` et `delete`,
  remis à zéro à tout changement de schéma ou annulation de transaction.
- `market.js`, `boosts.js` : passent par ces index au lieu de relire `Pulls`. Un décraft d'exemplaire précis ne cache
  plus les ★ et éditions du joueur à chaque appel.
- `runtime.js` : plus de `JSON.parse` inutile après une lecture de table ni avant un nœud « Sync » (tous les workflows
  en profitent). Nouveau paramètre `rowHint` : lecture de la seule ligne utile, lecture complète si elle n'existe pas.
- `workflows/disenchant.json` : « Get Pulls » utilise `rowHint` avec `pullId`.
- `server.js` : `BATCH_WRITE_MAX` passe de 50 à 2000. `/batch` et `/batch-write` rendent la main entre deux appels.
  `dig` est accepté en lot, seulement pour l'action `dig`.
- `digdepth.js` : `tileIndex: 'auto'`, le serveur tire une tuile non creusée.
- `monitoring.js` : les avis partent sans pile d'appels (titre réel dans GlitchTip au lieu de « ? »).

### Site
- `api.js` : `batchWrite` envoie tout en une requête jusqu'à 2000 opérations et découpe seul au-delà. Si le serveur
  répond encore « limite 50 », il redescend à 50. `_announceBatch` : annonces cumulées et souhaits mis à jour.
- `collection-recycle.js`, `collection-altar-smart.js`, `collection-workshop.js` : plus de paquets ni de bouton Arrêter.
- `collection-binder.js` : un seul lot au lieu d'un appel par carte ; une édition limitée repasse par l'appel seul pour
  demander confirmation.
- `jeux.js`, `jeux.html`, `refonte.css` : bouton « Tout fouiller » et bilan unique.
- `jeux-dino.js` : « Récupérer les trouvailles » et « Tout ramasser » sont réactivés à chaque rendu.
- Inchangé : les fusions enchaînées font une requête par niveau, car le niveau suivant dépend du résultat du précédent.
  `coffre.js`, `trade.js`, `shell-extras.js`, `showcase.js` et le craft multiple passaient déjà par `batchWrite`.

## Tests

- `npm test` : toutes les suites passent sauf `progress-test.js`, qui a 2 échecs (« dinos » et « mode Chill »). Les
  mêmes 2 échecs apparaissent sur une copie propre de `HEAD`, lancée vers minuit : le premier vient d'un dino endormi
  (`sleeping` au lieu de `play_cooldown`). `npm test` s'arrête à cette suite, les suivantes ont été lancées à part.
- `batch-feedback-test.js` : ajout de la limite à 2000, du refus identique à l'unité, de « Tout fouiller », des index
  du store et de l'envoi GlitchTip.
- Navigateur (Chromium, serveur local) : bouton et bilan de fouille, 1 requête pour 4 coups, 120 décrafts en 1 requête,
  repli sur un serveur limité à 50, annonces cumulées, aucune erreur JavaScript.
- Dinos : testé en désactivant les boutons puis en relançant le rendu, pas avec de vraies trouvailles arrivant en cours
  de visite.

## Points d'attention

- **Ordre de déploiement : l'API d'abord.** Sur l'ancienne API, « Tout fouiller » échoue (le lot `dig` est refusé).
- **Délai du proxy :** 2 000 décrafts prennent environ 24 s ici. Si le proxy de prod coupe avant la fin, le joueur voit
  une erreur alors que le serveur termine le lot. Le délai réel du proxy n'a pas été vérifié.
- **Code d'erreur :** un `pullId` existant mais appartenant à un autre joueur ou rangé au coffre renvoie maintenant
  `card_not_owned`, même si le joueur possède d'autres exemplaires de la carte (`variant_not_owned` avant). Seul le
  message change.
- **Tout fouiller et Milo :** si le chien creuse la tuile tirée au même moment, ce coup est refusé sans coûter
  d'énergie. Le joueur garde alors 1 énergie.
