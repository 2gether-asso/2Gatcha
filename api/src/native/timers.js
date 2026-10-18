// Minuteurs (2026-10-18) : tout ce qui sera pret plus tard, au meme endroit
// (inventaire de l'en-tete) : energie de fouille et de peche pleines, retour
// de l'expedition, jardin, Milo, et le prochain jour (boite, de, roue,
// devinette). Memes formules que les jeux (dig.json, fishing.js, garden.js).
//   GET /webhook/timers?userId= -> { now, items: [{ key, icon, label, at, ready, url }] }

import { ok, fail, userById, now, parisDay, configRow, parseJson } from './common.js';
import { levelInfo } from './levels.js';
import { fishEnergy } from './fishing.js';
import { growSeconds, PLOTS, seedMult } from './garden.js';
import { parisEpoch } from './daily.js';
import { view as ripenView } from './ripen.js';

function digTimer(store, user, t) {
  const cfg = configRow(store);
  const lvl = levelInfo(user.DigXP, Number(cfg.DigLevelXpStep) || 20).level;
  const max = (Number(cfg.DigMaxEnergy) || 10) + Math.floor(lvl / 2);
  const regen = Math.round((Number(cfg.DigRegenSeconds) || 600) * (1 - 0.05 * (lvl - 1)));
  const stored = user.DigEnergy != null && user.DigEnergy !== '' ? Number(user.DigEnergy) : max;
  const last = Number(user.LastDigEnergyAt) || t;
  if (stored >= max) return { energy: max, max, at: t };
  const elapsed = Math.max(0, t - last);
  const energy = Math.min(max, stored + Math.floor(elapsed / regen));
  return { energy, max, at: energy >= max ? t : last + (max - stored) * regen };
}

function handle({ store, query }) {
  const user = userById(store, (query || {}).userId);
  if (!user) return fail('unknown_user', 404);
  const t = now();
  const items = [];
  const add = (key, icon, label, at, url) => items.push({ key, icon, label, at, ready: at <= t, url });
  const dig = digTimer(store, user, t);
  add('dig', 'pick', `Énergie de fouille pleine (${dig.energy}/${dig.max})`, dig.at, 'jeux.html#fouille');
  try {
    const f = fishEnergy(store, user);
    const atFull = f.energy >= f.max ? t : t + (f.secondsUntilNext || 0) + Math.max(0, f.max - f.energy - 1) * (f.regen || 0);
    add('fish', 'worm', `Énergie de pêche pleine (${f.energy}/${f.max})`, atFull, 'jeux.html#peche');
  } catch (e) { /* peche indisponible */ }
  const exp = Number(user.ExpeditionUntil) || 0;
  if (exp) add('expedition', '🧭', 'Retour de l’expédition', exp, 'jeux.html#expedition');
  let plots = parseJson(user.GardenPlots, []);
  if (!Array.isArray(plots)) plots = [];
  const grow = growSeconds(store, user);
  const readyAt = plots.slice(0, PLOTS + (Number(user.GardenExtraPlots) || 0)).filter((p) => p && p.plantedAt).map((p) => p.plantedAt + Math.round(grow * seedMult(p)));
  if (readyAt.length) {
    const first = Math.min(...readyAt), all = Math.max(...readyAt);
    add('garden', '🌱', readyAt.length > 1 ? `Jardin : première récolte (${readyAt.length} parcelles)` : 'Jardin : récolte prête', first, 'jeux.html#jardin');
    if (all > first) add('garden-all', '🌻', 'Jardin : tout est prêt', all, 'jeux.html#jardin');
  }
  const dog = Number(user.DogUntil) || 0;
  if (dog > t) add('dog', 'bone', 'Milo rentre de sa fouille', dog, 'jeux.html#fouille');
  const tired = Number(user.DogTiredUntil) || 0;
  if (tired > t) add('dog-rest', '💤', 'Milo a fini de se reposer', tired, 'jeux.html#fouille');
  try {
    for (const l of ripenView(store, user).lots) add('ripen-' + l.id, l.icon, `Lot ${l.label.toLowerCase()} : ${l.count} booster${l.count > 1 ? 's' : ''}`, l.readyAt, 'ouverture.html');
  } catch (e) { /* murissoir indisponible */ }
  add('day', '🎁', 'Nouveau jour : boîte, dé, roue et devinette', parisEpoch(parisDay(1), 0), 'index.html');
  items.sort((a, b) => (a.ready === b.ready ? a.at - b.at : a.ready ? -1 : 1));
  return ok({ now: t, items });
}

export const routes = { 'GET timers': handle };
