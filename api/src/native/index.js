// Fonctionnalites natives de l'API (2026-10-04), a cote des workflows n8n :
//   sets.js     recompense de set complet + sets sur le profil public
//   matches.js  correspondances d'echange (doublons x wishlists)
//   streak.js   serie de connexion (7 jours)
//   events.js   week-ends evenement (bonus apres les workflows existants)
//   boss.js     classement du boss + bonus du coup final
//   economy.js  tableau de bord de l'economie (admin)
//   push.js     notifications push
//   chests.js   coffres (achat, coffres/clefs de niveau, ouverture)
// Chaque module expose `routes` ({ 'METHODE chemin': handler }) et, au
// besoin, `schema` (tables/colonnes creees au demarrage) et `afterWorkflow`.
// Un handler recoit { store, body, query } et renvoie { status, json }.

import { ensureSchema } from './common.js';
import * as sets from './sets.js';
import * as matches from './matches.js';
import * as streak from './streak.js';
import * as events from './events.js';
import * as boss from './boss.js';
import * as economy from './economy.js';
import * as push from './push.js';
import * as chests from './chests.js';

const MODULES = [sets, matches, streak, events, boss, economy, push, chests];

export function createNative({ store, withLock, captureError = () => {} }) {
  const routes = new Map();
  for (const m of MODULES) for (const [k, h] of Object.entries(m.routes || {})) routes.set(k, h);

  // Tables / colonnes manquantes creees une fois pour toutes.
  const spec = {};
  for (const m of MODULES) for (const [t, cols] of Object.entries(m.schema || {})) spec[t] = { ...(spec[t] || {}), ...cols };
  const created = ensureSchema(store, spec);
  if (created.length) console.log('Schema complete :', created.join(', '));

  return {
    has: (method, path) => routes.has(`${method} ${path}`),
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
