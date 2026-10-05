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
//   personal-vault.js coffre-fort perso (lignes de finitions, pieces detachees)
//   levels.js   niveaux de peche et de fouille
//   unique.js   rarete Unique (seulement en completant une ligne du coffre-fort perso)
//   activity.js bus d'activite (defis, objectif commun, succes caches)
//   challenges.js defis de la semaine + objectif commun
//   achievements.js succes caches + collections thematiques
//   cosmetics.js boutique de titres, cadres, couleurs
//   rules.js    taxe d'echange, prix de l'os, marche noir auto, relances
//   social.js   fiche carte, alertes de liste de souhaits, mur de profil
//   garden.js   jardin (appats dores pour la peche)
//   community-dig.js grande fouille commune de la semaine
//   simulator.js simulateur d'ouverture de boosters (admins, sans ecriture)
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
import * as personalVault from './personal-vault.js';
import * as levels from './levels.js';
import * as activity from './activity.js';
import * as challenges from './challenges.js';
import * as achievements from './achievements.js';
import * as cosmetics from './cosmetics.js';
import * as rules from './rules.js';
import * as social from './social.js';
import * as garden from './garden.js';
import * as communityDig from './community-dig.js';
import * as simulator from './simulator.js';

const MODULES = [settings, auth, sets, matches, streak, events, boss, economy, push, chests, duplicates, seasons, fishing, unique, personalVault, levels,
  challenges, achievements, cosmetics, rules, social, garden, communityDig, simulator];
// Abonnes du bus d'activite (voir activity.js).
const SUBSCRIBERS = [challenges, achievements];

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
  fishing.init({ store });

  // Contexte de la requete en cours : source du journal de l'economie et
  // annonces a renvoyer au joueur (defis accomplis, succes debloques...).
  const ctx = { source: null, userId: 0, notices: [] };
  // Journal de l'economie : toute variation de boosters / poussieres / vers
  // d'un joueur, quel que soit le module ou le workflow qui l'ecrit.
  const rawUpdate = store.update.bind(store);
  store.update = (name, id, fields) => {
    if (name !== 'Users' || !fields || !('BoosterCount' in fields || 'StardustCount' in fields || 'Worms' in fields)) return rawUpdate(name, id, fields);
    const before = store.get('Users', id);
    const row = rawUpdate(name, id, fields);
    try {
      economy.record(store, ctx.source, before, row);
      if ('StardustCount' in fields) ctx.notices.push(...achievements.onBalance(store, row));
    } catch (e) { console.error(e); captureError(e, { hook: 'ledger' }); }
    return row;
  };
  // Evenements d'une action -> abonnes ; annonces du joueur dans la reponse.
  const observe = (path, body, response) => {
    try {
      const events = activity.eventsFrom(store, path, body, response);
      ctx.notices.push(...activity.dispatch(store, SUBSCRIBERS, events));
    } catch (e) { console.error(e); captureError(e, { hook: 'activity:' + path }); }
    const mine = ctx.notices.filter((n) => n && n.userId === ctx.userId);
    if (mine.length && response && response.json && typeof response.json === 'object' && !Array.isArray(response.json)) {
      response.json.notices = [...(response.json.notices || []), ...mine.map(({ kind, icon, label }) => ({ kind, icon, label }))];
    }
    ctx.notices = [];
  };

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
    beforeRequest(body = {}, query = {}, path = null) {
      ctx.source = path || 'autre';
      ctx.userId = Number(body.userId || query.userId) || 0;
      ctx.notices = [];
      for (const m of [unique, rules, fishing]) {
        try { m.beforeRequest({ store }); } catch (e) { console.error(e); captureError(e, { hook: 'beforeRequest' }); }
      }
      const userId = Number(body.userId || query.userId) || 0;
      if (!userId) return;
      try { seasons.ensureProgress(store, userId); } catch (e) { console.error(e); captureError(e, { hook: 'season' }); }
    },
    // Regles verifiees avant un workflow : null = OK, sinon la reponse.
    beforeWorkflow(path, request) {
      try { return rules.beforeWorkflow({ store, path, request }); } catch (e) { console.error(e); captureError(e, { hook: 'beforeWorkflow' }); return null; }
    },
    // Fin de la requete : le journal n'attribue plus rien a cette source.
    endRequest() { ctx.source = null; ctx.userId = 0; ctx.notices = []; },
    // A appeler sous le verrou.
    run(method, path, { body = {}, query = {} } = {}) {
      const response = routes.get(`${method} ${path}`)({ store, body, query });
      if (method === 'POST') observe(path, body, response);
      return response;
    },
    // Bonus appliques apres un workflow (sous le verrou).
    afterWorkflow(path, request, response) {
      for (const m of MODULES) {
        if (!m.afterWorkflow) continue;
        try { m.afterWorkflow({ store, path, request, response }); } catch (e) { console.error(e); captureError(e, { hook: path }); }
      }
      observe(path, request.body || {}, response);
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
