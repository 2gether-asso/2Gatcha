// Contexte propre a chaque requete (2026-10-11). Avant, la source du journal
// de l'economie etait un objet partage : pendant un appel externe d'un
// workflow (Discord), le verrou est relache, une autre requete passait et
// remettait la source a vide en finissant -> la suite du premier workflow
// etait journalisee en "autre" (92 % des boosters crees, surtout les codes
// evenement). AsyncLocalStorage suit chaque requete a travers ses await.

import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage();

// Contexte vide d'une nouvelle operation sous verrou.
export const freshContext = () => ({ source: null, action: null, userId: 0, actor: null, detail: null, notices: [] });

// Hors de toute requete (demarrage, taches de fond).
const idle = freshContext();
export const currentContext = () => requestContext.getStore() || idle;
