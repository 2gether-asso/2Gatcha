// Mesures du serveur pour Admin > Sante (2026-11-02) : temps de reponse par
// route sur la derniere heure, erreurs depuis le demarrage, et ce que les
// autres modules veulent montrer (provide). En memoire seulement.

const WINDOW = 3600 * 1000;
const MAX_SAMPLES = 20000;
const samples = []; // { at, path, ms, status }
const errors = [];
let errorCount = 0;
export const startedAt = Date.now();
const providers = new Map();

export function recordRequest(path, ms, status) {
  samples.push({ at: Date.now(), path, ms, status });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}
export function recordError(err, context = {}) {
  errorCount++;
  errors.push({ at: new Date().toISOString(), message: String((err && err.message) || err).slice(0, 200), where: String(context.path || context.workflow || context.hook || context.kind || '').slice(0, 80) });
  if (errors.length > 20) errors.shift();
}
export function provide(name, fn) { providers.set(name, fn); }

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
export function snapshot() {
  const since = Date.now() - WINDOW;
  while (samples.length && samples[0].at < since) samples.shift();
  const byPath = new Map();
  for (const s of samples) { if (!byPath.has(s.path)) byPath.set(s.path, []); byPath.get(s.path).push(s); }
  const routes = [...byPath.entries()].map(([path, list]) => {
    const ms = list.map((s) => s.ms).sort((a, b) => a - b);
    return { path, count: list.length, p50: pct(ms, 0.5), p95: pct(ms, 0.95), max: ms[ms.length - 1], failed: list.filter((s) => s.status >= 500).length };
  });
  const all = samples.map((s) => s.ms).sort((a, b) => a - b);
  const extra = {};
  for (const [name, fn] of providers) { try { extra[name] = fn(); } catch (e) { extra[name] = { error: e.message }; } }
  return {
    startedAt: new Date(startedAt).toISOString(), uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    requests: { lastHour: samples.length, p50: pct(all, 0.5), p95: pct(all, 0.95), failed: samples.filter((s) => s.status >= 500).length, slowest: routes.sort((a, b) => b.p95 - a.p95).slice(0, 8), busiest: [...routes].sort((a, b) => b.count - a.count).slice(0, 8) },
    errors: { sinceStart: errorCount, recent: [...errors].reverse() },
    ...extra
  };
}
