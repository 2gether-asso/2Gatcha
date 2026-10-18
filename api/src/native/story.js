// Quetes d'histoire (2026-10-18) : une petite histoire en chapitres
// (setting StoryChapters) racontee par les personnages du jeu (Milo, Moka,
// Pepper...). Chaque chapitre a ses objectifs (evenements d'activite, comptes
// a partir de son ouverture) et sa recompense ; le dernier donne la carte
// exclusive StoryCardId (sinon le titre « Héros de 2Gatcha »). S'affiche
// apres le parcours du debutant.
//   GET/POST /webhook/story { userId, action: 'status' | 'claim' }

import { ok, fail, userById, parseJson, now, refId, levelForXp } from './common.js';
import { setting } from './settings.js';
import { grantCosmetic } from './cosmetics.js';
import { isNewcomer } from './starter.js';

export const schema = { Users: { StoryState: { type: 'Text' } } };

export const REWARD_FIELDS = ['BoosterCount', 'StardustCount', 'Worms', 'KeyCount', 'BoneCount', 'GoldBait', 'SpareParts', 'ChestCount', 'XP'];
const stateOf = (user) => { const s = parseJson(user.StoryState, null); return s && typeof s === 'object' ? { chapter: Number(s.chapter) || 0, counts: s.counts || {}, done: !!s.done } : { chapter: 0, counts: {}, done: false }; };

function view(store, user) {
  const chapters = setting(store, 'StoryChapters');
  const st = stateOf(user);
  const starter = parseJson(user.StarterState, {}) || {};
  // Apres le parcours du debutant (les anciens comptes y ont acces tout de suite).
  const unlocked = !setting(store, 'StarterEnabled') || !isNewcomer(store, user) || !!starter.done;
  const ch = chapters[st.chapter] || null;
  const card = setting(store, 'StoryCardId') ? store.get('Cards', setting(store, 'StoryCardId')) : null;
  return {
    enabled: !!setting(store, 'StoryEnabled') && chapters.length > 0, unlocked, done: st.done, index: st.chapter, total: chapters.length,
    chapters: chapters.map((c, i) => ({ index: i, title: c.title, who: c.who, icon: c.icon, done: st.done || i < st.chapter, current: !st.done && i === st.chapter })),
    chapter: ch && !st.done ? {
      ...ch, steps: (ch.steps || []).map((s, i) => { const n = Math.min(Number(s.target) || 1, Number(st.counts[i]) || 0); return { ...s, index: i, progress: n, complete: n >= (Number(s.target) || 1) }; }),
      last: st.chapter === chapters.length - 1, finalCard: st.chapter === chapters.length - 1 && card ? { cardId: card.id, name: card.Name } : null
    } : null
  };
}

function handle({ store, body, query }) {
  const input = { ...(query || {}), ...(body || {}) };
  let user = userById(store, input.userId);
  if (!user) return fail('unknown_user', 404);
  const v = view(store, user);
  if ((input.action || 'status') === 'status') return ok(v);
  if (input.action !== 'claim') return fail('unknown_action');
  if (!v.enabled || !v.unlocked) return fail('story_locked', 400, v);
  if (!v.chapter) return fail('story_done', 400, v);
  if (!v.chapter.steps.every((s) => s.complete)) return fail('chapter_not_complete', 400, v);
  const reward = v.chapter.reward || {};
  const fields = {};
  for (const k of REWARD_FIELDS) if (Number(reward[k]) > 0) fields[k] = (Number(user[k]) || 0) + Math.floor(Number(reward[k]));
  if (fields.XP) { const g = levelForXp(fields.XP) - levelForXp(Number(user.XP) || 0); if (g > 0) fields.BoosterCount = (fields.BoosterCount != null ? fields.BoosterCount : Number(user.BoosterCount) || 0) + g; }
  let finale = null;
  if (v.chapter.last) {
    const cardId = setting(store, 'StoryCardId');
    const card = cardId ? store.get('Cards', cardId) : null;
    if (card) {
      const used = new Set(store.getAll('Pulls').filter((p) => refId(p.Card) === card.id).map((p) => p.SerialNumber));
      let serial = 1; while (used.has(serial)) serial++;
      store.create('Pulls', { User: user.id, Card: card.id, ObtainedAt: now(), BatchId: `story-${user.id}`, SerialNumber: serial, Finish: 'normal', Quality: 'mint' });
      finale = { card: { cardId: card.id, name: card.Name, serialNumber: serial } };
    }
    if (grantCosmetic(store, user.id, 'story-hero', { type: 'title', label: 'Héros de 2Gatcha' })) finale = { ...(finale || {}), title: 'Héros de 2Gatcha' };
  }
  const next = v.index + 1;
  user = store.update('Users', user.id, { ...fields, StoryState: JSON.stringify({ chapter: next, counts: {}, done: next >= v.total }) });
  return ok({ ...view(store, user), claimed: v.index, reward, finale, newStardust: user.StardustCount, newBoosterCount: user.BoosterCount });
}

// Progression du chapitre en cours.
export function onEvents(store, events) {
  if (!setting(store, 'StoryEnabled')) return [];
  const chapters = setting(store, 'StoryChapters');
  const notices = [];
  const byUser = new Map();
  for (const e of events) { if (!byUser.has(e.userId)) byUser.set(e.userId, []); byUser.get(e.userId).push(e); }
  for (const [uid, evs] of byUser) {
    const user = store.get('Users', Number(uid));
    if (!user) continue;
    const st = stateOf(user);
    const ch = chapters[st.chapter];
    if (st.done || !ch) continue;
    let changed = false;
    (ch.steps || []).forEach((s, i) => {
      const target = Number(s.target) || 1;
      const before = Number(st.counts[i]) || 0;
      if (before >= target) return;
      const types = Array.isArray(s.type) ? s.type : [s.type];
      const n = evs.filter((e) => types.includes(e.type)).reduce((sum, e) => sum + (Number(e.n) || 1), 0);
      if (!n) return;
      st.counts[i] = Math.min(target, before + n);
      changed = true;
    });
    if (changed) {
      store.update('Users', user.id, { StoryState: JSON.stringify(st) });
      if ((ch.steps || []).every((s, i) => (Number(st.counts[i]) || 0) >= (Number(s.target) || 1))) notices.push({ userId: user.id, kind: 'story', icon: ch.icon || '📖', label: `Histoire : chapitre « ${ch.title} » terminé, viens lire la suite !` });
    }
  }
  return notices;
}

export const routes = { 'GET story': handle, 'POST story': handle };
