// Fonctionnalites natives de l'API (2026-10-04), a cote des workflows (api/workflows) :
//   sets.js     recompense de set complet + sets sur le profil public
//   matches.js  correspondances d'echange (doublons x wishlists)
//   streak.js   serie de connexion (7 jours)
//   events.js   week-ends evenement (bonus apres les workflows existants)
//   boss.js     classement du boss + bonus du coup final
//   economy.js  tableau de bord de l'economie (admin)
//   push.js     notifications push
//   chests.js   coffres (achat, coffres/clefs de niveau, ouverture)
//   settings.js reglages du jeu modifiables depuis l'admin
//   auth.js     jeton signe a la connexion + limite de debit
//   seasons.js  saisons mensuelles (pass de paliers, carte exclusive)
//   fishing.js  jeu de peche
//   unique.js   rarete Unique (seulement en completant une ligne du coffre-fort perso)
//   duplicates.js poussiere passive sur les doublons a l'ouverture des boosters
// Chaque module expose `routes` ({ 'METHODE chemin': handler }) et, au
// besoin, `schema` (tables/colonnes creees au demarrage) et `afterWorkflow`.
// Un handler recoit { store, body, query } et renvoie { status, json }.

import { ensureSchema } from './common.js';
import { workflowSchemaSpec } from './workflow-schema.js';
import * as sets from './sets.js';
import * as matches from './matches.js';
import * as streak from './streak.js';
import * as events from './events.js';
import * as boss from './boss.js';
import * as economy from './economy.js';
import * as push from './push.js';
import * as chests from './chests.js';
import * as duplicates from './duplicates.js';
import * as settings from './settings.js';
import * as auth from './auth.js';
import * as seasons from './seasons.js';
import * as fishing from './fishing.js';
import * as unique from './unique.js';

const MODULES = [settings, auth, sets, matches, streak, events, boss, economy, push, chests, duplicates, seasons, fishing, unique];

export function createNative({ store, withLock, captureError = () => {}, workflowsDir = null }) {
  const routes = new Map();
  for (const m of MODULES) for (const [k, h] of Object.entries(m.routes || {})) routes.set(k, h);

  // Tables / colonnes manquantes creees une fois pour toutes.
  const spec = {};
  for (const m of MODULES) for (const [t, cols] of Object.entries(m.schema || {})) spec[t] = { ...(spec[t] || {}), ...cols };
  const created = ensureSchema(store, spec);
  if (created.length) console.log('Schema complete :', created.join(', '));
  // Colonnes ecrites par les workflows mais absentes de la base.
  const missing = ensureSchema(store, workflowSchemaSpec(store, workflowsDir));
  if (missing.length) console.log('Colonnes des workflows creees :', missing.join(', '));
  auth.init({ store });
  unique.init({ store });

  return {
    has: (method, path) => routes.has(`${method} ${path}`),
    // Authentification + limite de debit, avant toute execution. null = OK,
    // sinon { status, json, headers? } a renvoyer tel quel.
    gate({ token, ip, body = {}, query = {}, isWrite = false, rate = true }) {
      const denied = auth.authorize({ token, body, query });
      if (denied) return denied;
      if (!rate) return null;
      const t = auth.verifyToken(token);
      return auth.rateLimit(store, t ? 'u:' + t.u : 'ip:' + (ip || '?'), isWrite);
    },
    // Avant chaque action d'un joueur (sous le verrou) : instantane de saison.
    beforeRequest(body = {}, query = {}) {
      try { unique.beforeRequest({ store }); } catch (e) { console.error(e); captureError(e, { hook: 'unique' }); }
      const userId = Number(body.userId || query.userId) || 0;
      if (!userId) return;
      try { seasons.ensureProgress(store, userId); } catch (e) { console.error(e); captureError(e, { hook: 'season' }); }
    },
    // A appeler sous le verrou.
    run(method, path, { body = {}, query = {} } = {}) {
      return routes.get(`${method} ${path}`)({ store, body, query });
    },
    // Bonus appliques apres un workflow (sous le verrou).
    afterWorkflow(path, request, response) {
      for (const m of MODULES) {
        if (!m.afterWorkflow) continue;
        try { m.afterWorkflow({ store, path, request, response }); } catch (e) { console.error(e); captureError(e, { hook: path }); }
      }
    },
    async start() {
      if (!(await push.init({ store }))) return;
      // Planificateur des notifications : une passe par minute.
      const tick = async () => {
        try {
          const jobs = await withLock(() => push.collect({ store }));
          if (!jobs.length) return;
          const expired = await push.send(jobs);
          if (expired.length) await withLock(() => expired.forEach((id) => store.delete('PushSubscriptions', id)));
        } catch (e) { console.error(e); captureError(e, { job: 'push' }); }
      };
      setInterval(tick, 60 * 1000).unref();
      setTimeout(tick, 5000).unref();
    }
  };
}
