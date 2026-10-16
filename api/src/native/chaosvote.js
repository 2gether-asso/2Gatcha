// Regle votee (mode Chaos, 2026-10-16) : les joueurs votent la regle de
// DEMAIN parmi 3 tirees au hasard. A minuit, la plus votee devient la regle du
// jour (egalite : la premiere des 3) ; sans aucun vote, le hasard habituel.
// Jamais deux fois la meme regle de suite.
//   POST /webhook/chaos-vote { userId, action: 'status' | 'vote', rule? }

import { ok, fail, userById, parisDay, parseJson } from './common.js';
import { ruleOn, ruleEnabled } from './moderules.js';
import { CHAOS_RULES, chaosRuleFor } from './modeextras.js';

const KEY = 'chaos-votes';
function hashOf(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; }
const dayAfter = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function load(store) {
  const row = store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === KEY) : null;
  return { row, votes: parseJson(row && row.Value, {}) };
}
function save(store, votes) {
  const keep = Object.fromEntries(Object.entries(votes).sort().slice(-4));
  const { row } = load(store);
  if (row) store.update('AppSettings', row.id, { Value: JSON.stringify(keep) }); else store.create('AppSettings', { Key: KEY, Value: JSON.stringify(keep) });
}

// Regle effective d'un jour passe ou present (sans le reglage d'activation du Chaos).
function effectiveRule(store, day, depth = 0) {
  return (depth < 2 && votedRule(store, day, depth)) || chaosRuleFor(day);
}
// Les 3 regles proposees pour un jour : jamais celle de la veille.
export function candidatesFor(store, day, depth = 0) {
  const prev = depth < 2 ? effectiveRule(store, dayAfter(day, -1), depth + 1).key : null;
  const pool = CHAOS_RULES.filter((r) => r.key !== prev);
  const out = [];
  let h = hashOf('vote:' + day);
  while (out.length < 3 && pool.length) { out.push(pool.splice(h % pool.length, 1)[0]); h = hashOf(String(h)); }
  return out;
}
function tally(store, day) {
  const counts = {};
  Object.values(load(store).votes[day] || {}).forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  return counts;
}
const cache = new Map();
function votedRule(store, day, depth = 0) {
  const ck = day;
  if (day <= parisDay(0) && cache.has(ck)) return cache.get(ck);
  const counts = tally(store, day);
  let best = null;
  if (Object.keys(counts).length) {
    const cands = candidatesFor(store, day, depth + 1);
    best = cands.reduce((b, r) => ((counts[r.key] || 0) > (b ? counts[b.key] || 0 : 0) ? r : b), null);
  }
  if (day <= parisDay(0)) cache.set(ck, best);
  return best;
}
// Regle du jour issue du vote (null : pas de vote ou vote desactive).
export function votedRuleFor(store, day = parisDay(0)) {
  return ruleEnabled(store, 'chaos.vote') ? votedRule(store, day) : null;
}

function handle({ store, body }) {
  const user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const active = ruleOn(store, 'chaos.vote');
  const tomorrow = parisDay(1);
  const view = () => {
    const counts = tally(store, tomorrow);
    const mine = (load(store).votes[tomorrow] || {})[user.id] || null;
    return { active, day: tomorrow, mine, total: Object.values(counts).reduce((s, n) => s + n, 0), candidates: candidatesFor(store, tomorrow).map((r) => ({ key: r.key, icon: r.icon, label: r.label, votes: counts[r.key] || 0 })) };
  };
  if ((body.action || 'status') === 'status') return ok(view());
  if (body.action !== 'vote') return fail('unknown_action');
  if (!active) return fail('wrong_mode');
  if (!candidatesFor(store, tomorrow).some((r) => r.key === body.rule)) return fail('unknown_rule');
  const votes = load(store).votes;
  votes[tomorrow] = { ...(votes[tomorrow] || {}), [user.id]: body.rule };
  save(store, votes);
  return ok({ ...view(), voted: body.rule });
}

export const routes = { 'POST chaos-vote': handle };
