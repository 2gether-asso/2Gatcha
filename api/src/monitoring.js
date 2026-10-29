// Suivi des erreurs dans GlitchTip (compatible Sentry) : SENTRY_DSN dans
// l'environnement. Sans DSN, ou si le paquet @sentry/node est absent, tout
// reste inactif : l'API fonctionne exactement pareil.

let Sentry = null;

export async function initMonitoring({ dsn, environment, release }) {
  if (!dsn) return false;
  try {
    Sentry = await import('@sentry/node');
  } catch (e) {
    console.warn('SENTRY_DSN configure mais @sentry/node est absent : suivi des erreurs desactive.');
    return false;
  }
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: 0.01, // 1 % des requetes
    autoSessionTracking: false // GlitchTip ne gere pas les sessions
  });
  return true;
}

// context : { workflow, node, method, path, ... } - visible dans GlitchTip.
export function captureError(err, context = {}) {
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(context)) if (v != null) scope.setTag(k, String(v).slice(0, 200));
    Sentry.captureException(err);
  });
}

// Message sans exception (avis des joueurs, feedback.js) : level 'info' =
// "Information" dans GlitchTip. false si le suivi est inactif.
export function captureMessage(message, level = 'info', tags = {}, extra = {}) {
  if (!Sentry) return false;
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(tags)) if (v != null && v !== '') scope.setTag(k, String(v).slice(0, 200));
    for (const [k, v] of Object.entries(extra)) if (v != null) scope.setExtra(k, v);
    if (tags.userId) scope.setUser({ id: String(tags.userId), username: tags.pseudo || undefined });
    Sentry.captureMessage(message, level);
  });
  return true;
}

// Envoie les evenements en attente avant l'arret du conteneur.
export async function flushMonitoring(timeoutMs = 2000) {
  if (Sentry) await Sentry.flush(timeoutMs).catch(() => {});
}
