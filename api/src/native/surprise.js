// Evenements surprises (2026-10-18) : de petits evenements de quelques heures,
// jamais annonces a l'avance. Chaque jour, un tirage (le meme pour tout le
// serveur, seme par la date) decide s'il y en a un (SurpriseEventsPerWeek / 7),
// son heure de debut (entre SurpriseFromHour et SurpriseToHour) et son type ;
// il dure SurpriseHours. L'admin peut aussi en lancer un tout de suite ou
// l'arreter. Effets : XP x2 (index.js), ou surcouche de reglages lus par
// l'API (recharge de peche, prix de la piece de gatchapon, gains de la
// devinette, affinite d'expedition, pousse du jardin).
//   POST /webhook/admin-surprise { discordId, action: 'status' | 'start' | 'stop', key? }
//   public : event-status -> surprise { key, label, icon, desc, until }

import { ok, fail, isAdmin, now, parisDay } from './common.js';
import { setting, rawSetting, setOverlay } from './settings.js';
import { parisEpoch } from './daily.js';
import { addFeed } from './feed.js';

export const TYPES = [
  { key: 'xp2', label: 'Double XP', icon: '⭐', desc: 'Toute l’XP gagnée est doublée (compte et métiers).', xp: 2 },
  { key: 'fishRush', label: 'Frénésie de pêche', icon: '🎣', desc: 'L’énergie de pêche se recharge 3 fois plus vite.', settings: { FishingRegenSeconds: (v) => Math.max(10, Math.round(v / 3)) } },
  { key: 'coinSale', label: 'Soldes du gatchapon', icon: '🪙', desc: 'Les pièces de gatchapon sont à moitié prix.', settings: { ChestCost: (v) => Math.max(1, Math.round(v / 2)) } },
  { key: 'guessBonus', label: 'Devinettes en or', icon: '❓', desc: 'Devine la carte rapporte deux fois plus de poussières.', settings: { GuessDust: (v) => v * 2 } },
  { key: 'explorer', label: 'Vent d’aventure', icon: '🧭', desc: 'Le bonus d’affinité des expéditions est doublé.', settings: { ExpeditionAffinityPct: (v) => v * 2 } },
  { key: 'gardenRush', label: 'Pluie miraculeuse', icon: '🌧️', desc: 'Les plantes du jardin poussent deux fois plus vite.', settings: { GardenGrowHours: (v) => Math.max(0.25, v / 2) } }
];
const BY_KEY = new Map(TYPES.map((t) => [t.key, t]));
const FORCED_KEY = 'surpriseForced';

function seeded(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } let a = h >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Evenement tire pour un jour (ou null).
export function scheduled(store, day = parisDay(0)) {
  const rnd = seeded('surprise-' + day);
  if (rnd() >= Math.min(1, setting(store, 'SurpriseEventsPerWeek') / 7)) return null;
  const from = setting(store, 'SurpriseFromHour'), to = Math.max(from, setting(store, 'SurpriseToHour'));
  const hour = from + Math.floor(rnd() * (to - from + 1));
  const type = TYPES[Math.floor(rnd() * TYPES.length)];
  const start = parisEpoch(day, hour);
  return { ...type, start, until: start + Math.round(setting(store, 'SurpriseHours') * 3600) };
}

function forced(store) {
  if (!store.tables.has('AppSettings')) return null;
  const row = store.getAll('AppSettings').find((r) => r.Key === FORCED_KEY);
  try { const v = row ? JSON.parse(row.Value) : null; return v && v.until > now() ? v : null; } catch (e) { return null; }
}

// Evenement en cours (ou null). Cache court : appele a chaque lecture de reglage.
let cache = { at: 0, store: null, value: null };
export function activeSurprise(store) {
  const t = Date.now();
  if (cache.store === store && t - cache.at < 15000) return cache.value;
  let value = null;
  try {
    if (rawSetting(store, 'SurpriseEnabled')) {
      const f = forced(store);
      if (f && f.stopped) value = null;
      else if (f && BY_KEY.get(f.key)) value = { ...BY_KEY.get(f.key), start: f.start, until: f.until };
      else {
        const n = now();
        // Celui d'aujourd'hui, ou celui d'hier qui deborderait apres minuit.
        value = [scheduled(store, parisDay(0)), scheduled(store, parisDay(-1))].find((s) => s && s.start <= n && n < s.until) || null;
      }
    }
  } catch (e) { value = null; }
  cache = { at: t, store, value };
  return value;
}
export const publicSurprise = (store) => { const s = activeSurprise(store); return s ? { key: s.key, label: s.label, icon: s.icon, desc: s.desc, start: s.start, until: s.until } : null; };
export const surpriseXpMult = (store) => { const s = activeSurprise(store); return s && s.xp ? s.xp : 1; };

setOverlay((store, key, raw) => {
  const s = activeSurprise(store);
  const fn = s && s.settings && s.settings[key];
  return fn ? fn(raw()) : undefined;
});

function handleAdmin({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const row = store.getAll('AppSettings').find((r) => r.Key === FORCED_KEY);
  const save = (v) => { if (row) store.update('AppSettings', row.id, { Value: JSON.stringify(v) }); else store.create('AppSettings', { Key: FORCED_KEY, Value: JSON.stringify(v) }); cache = { at: 0, store: null, value: null }; };
  if (body.action === 'start') {
    const type = BY_KEY.get(body.key) || TYPES[Math.floor(Math.random() * TYPES.length)];
    const start = now();
    save({ key: type.key, start, until: start + Math.round(setting(store, 'SurpriseHours') * 3600), by: String(body.discordId) });
    if (body.announce !== false) addFeed(store, { kind: 'event', icon: type.icon, text: `Événement surprise : ${type.label} ! ${type.desc}` });
  } else if (body.action === 'stop') {
    const cur = activeSurprise(store);
    save({ key: cur ? cur.key : '', start: now(), until: cur ? cur.until : now() + 60, stopped: true });
  }
  const today = scheduled(store, parisDay(0));
  return ok({ active: publicSurprise(store), today: today ? { key: today.key, label: today.label, icon: today.icon, start: today.start, until: today.until } : null, types: TYPES.map(({ key, label, icon, desc }) => ({ key, label, icon, desc })) });
}

export function _reset() { cache = { at: 0, store: null, value: null }; }
export const routes = { 'POST admin-surprise': handleAdmin };
