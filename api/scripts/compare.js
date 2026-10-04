// Compare les reponses de l'API locale (apres import) avec n8n en production,
// sur des appels en LECTURE SEULE uniquement. A lancer juste apres
// `npm run import`, avant de basculer le site.
//
//   API_URL=http://localhost:8080 USER_ID=2 npm run compare
//
// Les champs qui bougent tout seuls (horodatages, comptes a rebours, tirages
// aleatoires du jour...) sont ignores.

const N8N = (process.env.N8N_URL || 'https://n8n.matiboux.com').replace(/\/$/, '');
const API = (process.env.API_URL || 'http://localhost:8080').replace(/\/$/, '');
const USER = process.env.USER_ID || '2';

const CALLS = [
  ['GET', 'cards'], ['GET', 'extensions'], ['GET', 'users'], ['GET', 'site-banner'], ['GET', 'unlock-config'],
  ['GET', 'event-calendar'], ['GET', 'leaderboard'], ['GET', 'recent-pulls'],
  ['GET', 'collection', { userId: USER }], ['GET', 'booster-status', { userId: USER }],
  ['GET', 'pull-log', { userId: USER }], ['GET', 'achievements', { userId: USER }],
  ['POST', 'vault', { userId: Number(USER), action: 'status' }],
  ['POST', 'personal-vault', { userId: Number(USER), action: 'status' }],
  ['POST', 'guess-card', { userId: Number(USER), action: 'status' }],
  ['POST', 'expedition', { userId: Number(USER), action: 'status' }],
  ['POST', 'trade', { userId: Number(USER), action: 'list' }],
  ['POST', 'wishlist', { userId: Number(USER), action: 'list' }]
];
const VOLATILE = new Set(['now', 'secondsLeft', 'secondsUntilNext', 'dogSecondsLeft', 'ts', 'generatedAt', 'serverTime']);

function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) if (!VOLATILE.has(k)) out[k] = normalize(v[k]);
    return out;
  }
  return v;
}

function firstDiff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return `${path || '/'}: n8n=${JSON.stringify(a)?.slice(0, 80)} api=${JSON.stringify(b)?.slice(0, 80)}`;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return `${path}: longueur n8n=${a.length} api=${b.length}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = firstDiff(a[k], b[k], `${path}/${k}`);
    if (d) return d;
  }
  return null;
}

async function call(base, method, name, args) {
  const url = new URL(`${base}/webhook/${name}`);
  if (method === 'GET' && args) for (const [k, v] of Object.entries(args)) url.searchParams.set(k, v);
  const t = Date.now();
  const res = await fetch(url, method === 'POST' ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) } : {});
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json, ms: Date.now() - t };
}

let diffs = 0;
for (const [method, name, args] of CALLS) {
  const [a, b] = await Promise.all([call(N8N, method, name, args), call(API, method, name, args)]);
  const d = a.status !== b.status ? `statut n8n=${a.status} api=${b.status}` : firstDiff(normalize(a.json), normalize(b.json));
  if (d) diffs++;
  console.log(`${d ? 'DIFF' : ' == '} ${name.padEnd(15)} n8n ${String(a.ms).padStart(6)}ms | api ${String(b.ms).padStart(4)}ms ${d ? ' -> ' + d : ''}`);
}
console.log(diffs ? `\n${diffs} difference(s) : a examiner (une action d'un joueur entre l'import et la comparaison suffit a en creer).` : '\nReponses identiques.');
