// Notifications push (Web Push standard, sans service tiers) : expedition
// rentree, chien qui a fini, quiz du jour, serie de connexion en danger,
// echange recu, nouveau boss, evenement lance.
//   GET  /webhook/push-config  -> { enabled, publicKey }
//   POST /webhook/push  { userId, action: 'status'|'subscribe'|'unsubscribe'|'test', subscription? }
// Les cles VAPID sont generees au premier demarrage et gardees en base
// (table AppSettings) : rien a configurer. Un planificateur verifie chaque
// minute ce qu'il y a a annoncer ; chaque evenement n'est envoye qu'une fois
// (NotificationLog), jamais entre 22 h et 9 h (heure de Paris).

import { refId, now, ok, fail, userById, parisDay, parisHour } from './common.js';
import { eventState } from './events.js';
import { setting } from './settings.js';
import { seasonId, seasonEnd } from './seasons.js';
import { challengeState, goalState } from './challenges.js';
import { tourneyKey } from './fishing.js';

export const schema = {
  AppSettings: { Key: { type: 'Text' }, Value: { type: 'Text' } },
  PushSubscriptions: { User: { type: 'Ref:Users' }, Endpoint: { type: 'Text' }, P256dh: { type: 'Text' }, Auth: { type: 'Text' }, CreatedAt: { type: 'Numeric' } },
  NotificationLog: { User: { type: 'Ref:Users' }, Kind: { type: 'Text' }, RefKey: { type: 'Text' }, SentAt: { type: 'Numeric' } }
};

let webpush = null;
let vapid = null;

function vapidSetting(store, key) {
  const row = store.getAll('AppSettings').find((r) => r.Key === key);
  return row ? row.Value : null;
}
function setSetting(store, key, value) {
  const row = store.getAll('AppSettings').find((r) => r.Key === key);
  if (row) store.update('AppSettings', row.id, { Value: value }); else store.create('AppSettings', { Key: key, Value: value });
}

// Charge web-push et les cles VAPID (generees une seule fois).
export async function init({ store }) {
  try { webpush = (await import('web-push')).default; } catch (e) { console.warn('web-push absent : notifications push desactivees.'); return false; }
  let pub = process.env.VAPID_PUBLIC_KEY || vapidSetting(store, 'vapidPublicKey');
  let priv = process.env.VAPID_PRIVATE_KEY || vapidSetting(store, 'vapidPrivateKey');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey; priv = keys.privateKey;
    setSetting(store, 'vapidPublicKey', pub);
    setSetting(store, 'vapidPrivateKey', priv);
  }
  vapid = { pub, priv };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://gatcha.2gether-asso.fr', pub, priv);
  return true;
}

function handleConfig() {
  return ok({ enabled: !!vapid, publicKey: vapid ? vapid.pub : null });
}

function handlePush({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const subs = () => store.getAll('PushSubscriptions').filter((s) => refId(s.User) === user.id);
  const endpoint = body.subscription && body.subscription.endpoint;
  if (body.action === 'subscribe') {
    if (!vapid) return fail('push_disabled', 503);
    const keys = (body.subscription && body.subscription.keys) || {};
    if (!/^https:\/\//.test(endpoint || '') || !keys.p256dh || !keys.auth) return fail('invalid_subscription');
    // Un appareil = un abonnement (l'endpoint est unique) ; il peut changer de joueur.
    store.getAll('PushSubscriptions').filter((s) => s.Endpoint === endpoint).forEach((s) => store.delete('PushSubscriptions', s.id));
    store.create('PushSubscriptions', { User: user.id, Endpoint: endpoint, P256dh: keys.p256dh, Auth: keys.auth, CreatedAt: now() });
  } else if (body.action === 'unsubscribe') {
    subs().filter((s) => !endpoint || s.Endpoint === endpoint).forEach((s) => store.delete('PushSubscriptions', s.id));
  } else if (body.action === 'test') {
    if (!subs().length) return fail('not_subscribed');
    pendingTests.push({ userId: user.id, title: '🔔 Notifications activées', body: 'Tu seras prévenu ici quand il se passe quelque chose sur 2Gatcha.', url: 'index.html' });
  }
  return ok({ enabled: !!vapid, devices: subs().length, subscribed: !!endpoint && subs().some((s) => s.Endpoint === endpoint) });
}

const pendingTests = [];

// Ce qu'il faut annoncer a un joueur maintenant : [{ kind, key, title, body, url }].
function dueFor(store, user, sinceSub, ctx) {
  const t = now(), out = [];
  const until = Number(user.ExpeditionUntil) || 0;
  if (until && until <= t && until > t - 12 * 3600) out.push({ kind: 'expedition', key: String(until), title: '🧭 Expédition terminée', body: 'Ton explorateur est rentré : viens récupérer son butin !', url: 'jeux.html' });
  const dog = Number(user.DogUntil) || 0;
  if (dog && dog <= t && dog > t - 12 * 3600) out.push({ kind: 'dog', key: String(dog), title: '🐕 Le chien a fini de creuser', body: 'Viens voir ce qu’il a déterré pour toi.', url: 'jeux.html' });
  if (ctx.hour >= 10 && user.GuessDate !== ctx.today) out.push({ kind: 'guess', key: ctx.today, title: '🔍 Nouvelle carte à deviner', body: 'Le quiz du jour t’attend dans Jeux.', url: 'jeux.html' });
  const streak = Number(user.LoginStreak) || 0;
  if (ctx.hour >= 19 && streak > 0 && user.LoginStreakDay === ctx.yesterday) out.push({ kind: 'streak', key: ctx.today, title: '🔥 Ta série de connexion', body: `Récupère ton cadeau du jour pour garder ta série (jour ${(streak % 7) + 1}/7).`, url: 'index.html' });
  for (const tr of ctx.trades) {
    if (refId(tr.ToUser) === user.id && tr.Status === 'pending' && (tr.CreatedAt || 0) >= sinceSub) {
      out.push({ kind: 'trade', key: String(tr.id), title: '🔄 Nouvelle proposition d’échange', body: `${ctx.pseudo.get(refId(tr.FromUser)) || 'Un joueur'} te propose un échange.`, url: 'trade.html' });
    }
  }
  // Rappels de fin de delai (2026-10-05).
  if (ctx.seasonEndsIn > 0 && ctx.seasonEndsIn < 48 * 3600 && ctx.seasonPlayers.has(user.id)) {
    out.push({ kind: 'season-end', key: ctx.season, title: '🏆 La saison se termine bientôt', body: 'Moins de 2 jours pour finir tes paliers et récupérer tes récompenses de saison.', url: 'index.html' });
  }
  if (ctx.dow === 0 && ctx.hour >= 18) {
    try {
      const ch = challengeState(store, user);
      const open = ch.offered.filter((c) => c.picked && !c.claimed);
      if (open.length) out.push({ kind: 'challenges-end', key: ch.week, title: '🎯 Derniers jours pour tes défis', body: ch.claimable ? 'Des défis accomplis t’attendent : récupère-les avant ce soir minuit.' : `Plus que quelques heures pour finir tes ${open.length} défi(s) de la semaine.`, url: 'index.html' });
    } catch (e) { /* defis indisponibles */ }
  }
  try {
    const goal = goalState(store, user.id);
    if (goal.claimable) out.push({ kind: 'goal', key: goal.week, title: '🤝 Objectif commun atteint !', body: 'La communauté a réussi : viens récupérer ta part.', url: 'communaute.html#ensemble' });
  } catch (e) { /* objectif indisponible */ }
  if (ctx.tourney && ctx.hour >= 10) out.push({ kind: 'tourney', key: ctx.tourney, title: '🎣 Tournoi de pêche ce week-end', body: 'Tes 10 premiers lancers du week-end comptent : vise les prises rares !', url: 'jeux.html#peche' });
  if (ctx.boss) out.push({ kind: 'boss', key: String(ctx.boss.id), title: `💀 ${ctx.boss.BossName || 'Un boss'} attaque !`, body: 'Un nouveau boss communautaire est apparu : donne des cartes pour l’abattre.', url: 'communaute.html' });
  if (ctx.event) out.push({ kind: 'event', key: `${ctx.event.label}:${ctx.event.endsAt || ''}`, title: `🎉 ${ctx.event.label}`, body: ctx.eventText, url: 'index.html' });
  return out;
}

// Prepare les envois (sous le verrou) ; l'envoi reseau se fait apres.
export function collect({ store, hour: forcedHour } = {}) {
  if (!vapid) return [];
  const subs = store.getAll('PushSubscriptions');
  const jobs = pendingTests.splice(0).flatMap((n) => subs.filter((s) => refId(s.User) === n.userId).map((s) => ({ sub: s, payload: n })));
  if (!subs.length) return jobs;
  const hour = forcedHour != null ? forcedHour : parisHour();
  const qs = setting(store, 'PushQuietStart'), qe = setting(store, 'PushQuietEnd');
  const quiet = qs === qe ? false : (qs > qe ? (hour >= qs || hour < qe) : (hour >= qs && hour < qe));
  if (quiet) return jobs;
  const log = store.getAll('NotificationLog');
  const sent = new Set(log.map((l) => `${refId(l.User)}|${l.Kind}|${l.RefKey}`));
  const ev = eventState(store);
  const evParts = [];
  if (ev.dustMultiplier > 1) evParts.push(`poussières x${ev.dustMultiplier}`);
  if (ev.finishMultiplier > 1) evParts.push(`finitions x${ev.finishMultiplier}`);
  const season = seasonId();
  const ctx = {
    hour, today: parisDay(0), yesterday: parisDay(-1),
    dow: new Date(parisDay(0) + 'T12:00:00Z').getUTCDay(),
    season, seasonEndsIn: seasonEnd(season) - now(),
    seasonPlayers: new Set(store.tables.has('SeasonProgress') ? store.getAll('SeasonProgress').filter((r) => r.Season === season).map((r) => refId(r.User)) : []),
    tourney: tourneyKey(),
    trades: store.tables.has('Trades') ? store.getAll('Trades').filter((tr) => tr.Status === 'pending') : [],
    pseudo: new Map(store.getAll('Users').map((u) => [u.id, u.Pseudo])),
    boss: store.tables.has('CommunityBoss') ? store.getAll('CommunityBoss').find((b) => b.Active) : null,
    event: ev.active ? ev : null,
    eventText: evParts.length ? `En ce moment : ${evParts.join(', ')} !` : 'Un événement est en cours sur 2Gatcha.'
  };
  const byUser = new Map();
  subs.forEach((s) => { const u = refId(s.User); if (!byUser.has(u)) byUser.set(u, []); byUser.get(u).push(s); });
  for (const [uid, userSubs] of byUser) {
    const user = store.get('Users', uid);
    if (!user) continue;
    const since = Math.min(...userSubs.map((s) => s.CreatedAt || 0));
    const due = dueFor(store, user, since, ctx).filter((n) => !sent.has(`${uid}|${n.kind}|${n.key}`)).slice(0, 3);
    for (const n of due) {
      store.create('NotificationLog', { User: uid, Kind: n.kind, RefKey: n.key, SentAt: now() });
      userSubs.forEach((s) => jobs.push({ sub: s, payload: n }));
    }
  }
  // Journal : on oublie au bout de 30 jours.
  log.filter((l) => (l.SentAt || 0) < now() - 30 * 86400).forEach((l) => store.delete('NotificationLog', l.id));
  return jobs;
}

// Envoi reseau (hors verrou). Renvoie les abonnements expires a supprimer.
export async function send(jobs) {
  const expired = [];
  await Promise.all(jobs.map(async ({ sub, payload }) => {
    try {
      await webpush.sendNotification({ endpoint: sub.Endpoint, keys: { p256dh: sub.P256dh, auth: sub.Auth } },
        JSON.stringify({ title: payload.title, body: payload.body, url: payload.url, tag: `${payload.kind || 'info'}` }), { TTL: 6 * 3600 });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) expired.push(sub.id);
      else console.warn('push:', e.statusCode || e.message);
    }
  }));
  return expired;
}

export const routes = {
  'GET push-config': handleConfig,
  'POST push': handlePush
};
