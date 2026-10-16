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
//   talents.js  arbre de talents (1 point par niveau de compte)
//   feed.js     fil du serveur en direct
//   progression.js maitrise des extensions, rangs, constellations, cartes etoile, paliers de succes
//   daily.js    boite et de du jour, action du jour, heures de chance, retour, missions du soir
//   market.js   contrats, encheres, cours du decraft, assurance, boutique de boosters
//   boosts.js   bonus personnels appliques apres les workflows
//   insights.js que faire maintenant, statistiques perso, carte de joueur
//   shop.js     boutique d'objets et de bonus (poussieres)
// Chaque module expose `routes` ({ 'METHODE chemin': handler }) et, au
// besoin, `schema` (tables/colonnes creees au demarrage) et `afterWorkflow`.
// Un handler recoit { store, body, query } et renvoie { status, json }.

import { ensureSchema, levelForXp } from './common.js';
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
import * as talents from './talents.js';
import * as feed from './feed.js';
import * as progression from './progression.js';
import * as daily from './daily.js';
import * as market from './market.js';
import * as boosts from './boosts.js';
import * as insights from './insights.js';
import * as shop from './shop.js';
import * as inflation from './inflation.js';
import * as pity from './pity.js';
import * as balance from './balance.js';
import * as upgrades from './upgrades.js';
import * as ledger from './ledger.js';
import * as presets from './presets.js';
import * as comfort from './comfort.js';
import * as rendezvous from './rendezvous.js';
import * as modeperks from './modeperks.js';
import * as machine from './machine.js';
import * as features from './features.js';
import * as modeextras from './modeextras.js';
import * as seasonal from './seasonal.js';
import * as editions from './editions.js';
import * as phantom from './phantom.js';
import * as lottery from './lottery.js';
import * as wanted from './wanted.js';
import * as halloffame from './halloffame.js';
import * as teams from './teams.js';
import * as duo from './duo.js';
import * as bingo from './bingo.js';
import * as cards from './cards.js';
import * as dino from './dino.js';
import * as discoveries from './discoveries.js';
import * as moderules from './moderules.js';
import * as chaosvote from './chaosvote.js';
import * as modefun from './modefun.js';
import * as draft from './draft.js';
import { currentContext } from './context.js';
import * as treasure from './treasure.js';
import * as accountPrestige from './account-prestige.js';
import { setting } from './settings.js';

const MODULES = [settings, auth, pity, sets, matches, streak, events, boss, economy, push, chests, duplicates, seasons, fishing, unique, personalVault, levels,
  challenges, achievements, cosmetics, rules, social, garden, communityDig, simulator,
  talents, feed, progression, daily, market, boosts, insights, shop, inflation, treasure, accountPrestige, balance, upgrades, ledger, presets, comfort, rendezvous, modeperks, machine, features, modeextras, seasonal, editions, modefun, moderules, chaosvote, draft, phantom, lottery, wanted, halloffame, teams, duo, bingo, cards, dino, discoveries];
// Abonnes du bus d'activite (voir activity.js).
const SUBSCRIBERS = [challenges, achievements, progression, daily, comfort, modeperks, modeextras, seasonal, phantom, teams, bingo, cards, modefun];
// La page Admin > Difficultes affiche aussi les fonctionnalites fermees par mode.
moderules.useFeatures(features);
// XP doublee pendant l'action du jour (daily.js).
const XP_FIELDS = ['XP', 'FishingXP', 'DigXP', 'ExpeditionXP', 'GardenXP'];

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
  currentContext().source = 'démarrage';
  currentContext().actor = 'serveur';
  auth.init({ store });
  unique.init({ store });
  fishing.init({ store });
  balance.init({ store });
  ledger.init({ store });
  Object.assign(currentContext(), { source: null, actor: null });

  // Contexte de la requete en cours (propre a chaque requete, voir
  // context.js) : source du journal de l'economie et annonces a renvoyer au
  // joueur (defis accomplis, succes debloques...).
  // Journal de l'economie : toute variation de boosters / poussieres / vers
  // d'un joueur, quel que soit le module ou le workflow qui l'ecrit.
  const rawUpdate = store.update.bind(store);
  store.update = (name, id, fields) => {
    if (name !== 'Users' || !fields) return rawUpdate(name, id, fields);
    const xpWrite = XP_FIELDS.some((f) => f in fields);
    if (!xpWrite && !('BoosterCount' in fields || 'StardustCount' in fields || 'Worms' in fields)) return rawUpdate(name, id, fields);
    const before = store.get('Users', id);
    // XP doublee : action du jour (daily.js) et potion de savoir (shop.js).
    const boosted = xpWrite && before && (Number(before.XpBoostUntil) || 0) > Math.floor(Date.now() / 1000);
    const ctx = currentContext();
    const house = xpWrite && before && ctx.source && daily.isHouseSource(ctx.source);
    if (house || boosted) {
      try {
        fields = { ...fields };
        const mult = (house ? setting(store, 'HouseXpMultiplier') : 1) * (boosted ? 2 : 1);
        for (const f of XP_FIELDS) {
          if (!(f in fields)) continue;
          const delta = (Number(fields[f]) || 0) - (Number(before[f]) || 0);
          if (delta <= 0) continue;
          fields[f] = (Number(before[f]) || 0) + Math.round(delta * mult);
          // Niveaux de compte franchis en plus grace au bonus : +1 booster chacun (comme les workflows).
          if (f === 'XP') {
            const extra = levelForXp(fields.XP) - levelForXp((Number(before.XP) || 0) + delta);
            if (extra > 0) fields.BoosterCount = (Number('BoosterCount' in fields ? fields.BoosterCount : before.BoosterCount) || 0) + extra;
          }
        }
      } catch (e) { console.error(e); captureError(e, { hook: 'house-xp' }); }
    }
    if ('StardustCount' in fields && before) {
      const dustLedger = insights.ledgerFields(before, fields, ctx.source);
      if (dustLedger) fields = { ...fields, DustLedger: dustLedger };
    }
    const row = rawUpdate(name, id, fields);
    if (!('BoosterCount' in fields || 'StardustCount' in fields || 'Worms' in fields)) return row;
    try {
      economy.record(store, ctx.source || 'inconnu', before, row);
      ledger.log(store, ctx, before, row);
      if ('StardustCount' in fields) ctx.notices.push(...achievements.onBalance(store, row));
    } catch (e) { console.error(e); captureError(e, { hook: 'ledger' }); }
    return row;
  };
  // Historique de chaque exemplaire (cards.js) : creations, echanges, changements.
  cards.installHistory(store, captureError);
  // Evenements d'une action -> abonnes ; annonces du joueur dans la reponse.
  const observe = (path, body, response) => {
    const ctx = currentContext();
    try {
      const events = activity.eventsFrom(store, path, body, response);
      ctx.notices.push(...activity.dispatch(store, SUBSCRIBERS, events));
    } catch (e) { console.error(e); captureError(e, { hook: 'activity:' + path }); }
    // Premiere fois qu'une ressource est obtenue (discoveries.js).
    if (ctx.userId && response && response.status === 200 && response.json && typeof response.json === 'object' && !Array.isArray(response.json)) {
      try { const found = discoveries.check(store, ctx.userId); if (found) response.json.discoveries = found; } catch (e) { console.error(e); captureError(e, { hook: 'discoveries' }); }
    }
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
      const ctx = currentContext();
      ctx.source = path || 'requête';
      ctx.action = String(body.action || query.action || '');
      ctx.userId = Number(body.userId || query.userId) || 0;
      // Qui declenche : un admin (discordId) ou le joueur de la session.
      ctx.actor = body.discordId ? 'admin:' + body.discordId : ctx.userId ? 'joueur:' + ctx.userId : 'anonyme';
      ctx.detail = ledger.summarizeBody(body);
      ctx.notices = [];
      for (const m of [unique, rules, fishing, market, inflation, modeextras, modeperks, machine, seasonal, lottery, teams, modefun]) {
        try { m.beforeRequest({ store }); } catch (e) { console.error(e); captureError(e, { hook: 'beforeRequest' }); }
      }
      const userId = Number(body.userId || query.userId) || 0;
      if (!userId) return;
      try { seasons.ensureProgress(store, userId); } catch (e) { console.error(e); captureError(e, { hook: 'season' }); }
      try { daily.touch(store, userId); } catch (e) { console.error(e); captureError(e, { hook: 'touch' }); }
    },
    // Regles verifiees avant un workflow : null = OK, sinon la reponse.
    beforeWorkflow(path, request) {
      for (const m of [features, modeperks, pity, balance, comfort, rules, levels, market, modefun]) {
        try {
          const denied = m.beforeWorkflow({ store, path, request });
          if (denied) { market.restoreHidden(store, request); return denied; }
        } catch (e) { console.error(e); captureError(e, { hook: 'beforeWorkflow' }); }
      }
      return null;
    },
    // Remet en place les exemplaires assures si le workflow a echoue.
    restore(request) { try { market.restoreHidden(store, request); } catch (e) { console.error(e); } },
    // Fin de la requete : le journal n'attribue plus rien a cette source.
    endRequest() { Object.assign(currentContext(), { source: null, action: null, userId: 0, actor: null, detail: null, notices: [] }); },
    // A appeler sous le verrou.
    run(method, path, { body = {}, query = {} } = {}) {
      // Fonctionnalite fermee dans le mode en cours (features.js) : ecriture refusee.
      const closed = features.gate(store, method, path, body);
      if (closed) return closed;
      const response = routes.get(`${method} ${path}`)({ store, body, query });
      if (method === 'POST') observe(path, body, response);
      return response;
    },
    // Bonus appliques apres un workflow (sous le verrou).
    afterWorkflow(path, request, response) {
      // Exemplaires assures remis en place avant tout le reste (market.js).
      try { market.restoreHidden(store, request); } catch (e) { console.error(e); captureError(e, { hook: 'restore' }); }
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
