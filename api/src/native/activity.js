// Bus d'activite : chaque action d'un joueur (workflow ou route native) est
// traduite en evenements { userId, type, n, meta } qui alimentent les defis de
// la semaine, l'objectif commun, les succes caches... (abonnes : voir
// SUBSCRIBERS dans index.js). Les nouveautes debloquees reviennent dans la
// reponse (`notices`) pour que le site les annonce.

import { refId, parisHour } from './common.js';

const RARE_TIERS = new Set(['epique', 'legendaire', 'mythique']);

// Traduit une reponse en evenements. store : pour retrouver l'autre joueur
// d'un echange accepte.
export function eventsFrom(store, path, body = {}, response = {}) {
  const json = response.json || {};
  if (response.status && response.status !== 200) return [];
  const uid = Number(body.userId) || 0;
  if (!uid) return [];
  const ev = (type, n = 1, meta = {}) => ({ userId: uid, type, n, meta });
  const out = [];
  switch (path) {
    case 'open-pack':
      if (!body.dryRun && Array.isArray(json.cards)) out.push(ev('boosterOpened'), ev('cardsPulled', json.cards.length));
      break;
    case 'craft':
      if (json.crafted) out.push(ev('craft'));
      break;
    case 'disenchant':
      if (json.disenchanted) out.push(ev('disenchant'));
      break;
    case 'foil-upgrade':
      if (json.upgraded) out.push(ev('fusion'));
      break;
    case 'card-quality-repair':
      if (json.repaired) out.push(ev('repair'));
      break;
    case 'trade':
      if ((body.action === 'create' || body.action === 'counter') && !json.error) out.push(ev('tradeProposed'));
      if (body.action === 'respond' && (body.accept === true || body.accept === 'true') && !json.error) {
        out.push(ev('tradeDone'));
        const tr = store.tables.has('Trades') ? store.get('Trades', Number(body.tradeId)) : null;
        const other = tr ? refId(tr.FromUser) : null;
        if (other && other !== uid) out.push({ userId: other, type: 'tradeDone', n: 1, meta: {} });
      }
      break;
    case 'dig':
      if (body.action === 'dig' && json.dug) {
        out.push(ev('dig'));
        if (json.revealed) out.push(ev('treasure'));
        if (json.boardCleared) out.push(ev('board', 1, { leftover: Number(json.leftoverTiles) || 0 }));
      }
      if (json.dogReport && json.dogReport.boards) out.push(ev('board', json.dogReport.boards, { dog: true, leftover: 0 }));
      break;
    case 'expedition':
      if (body.action === 'claim' && json.reward) out.push(ev('expedition'));
      break;
    case 'guess-card':
      if (json.correct) out.push(ev('guess'));
      break;
    case 'daily-wheel':
      if (json.prize) out.push(ev('wheel'));
      break;
    case 'fishing':
      if (Array.isArray(json.catches)) {
        out.push(ev('fish', json.catches.length, { hour: parisHour(), weather: json.weather && json.weather.key }));
        json.catches.forEach((c) => out.push(ev('fishCatch:' + c.type, 1, { weather: json.weather && json.weather.key, tier: c.tier })));
        if (json.catches.filter((c) => RARE_TIERS.has(c.tier)).length >= 3) out.push(ev('fishLucky'));
      }
      break;
    case 'chests':
      if (body.action === 'open' && json.opened) out.push(ev('chestOpened'));
      break;
    case 'boss-attack':
      if (!json.error && Array.isArray(body.pullIds)) out.push(ev('bossAttack', body.pullIds.length));
      break;
    case 'personal-vault':
      if (json.reward) out.push(ev('vaultRow'));
      break;
    case 'unique-counter':
      if (json.redeemed) out.push(ev('unique'));
      break;
    case 'garden':
      if (body.action === 'harvest' && json.harvested) out.push(ev('harvest', Number(json.harvested) || 1));
      break;
    case 'community-dig':
      if (body.action === 'dig' && json.dug) out.push(ev('communityDig'), ...(json.found ? [ev('communityTreasure')] : []));
      break;
    case 'prestige':
      if (json.prestiged) out.push(ev('prestige', 1, { skill: body.skill }));
      break;
    case 'cosmetics':
      if (body.action === 'buy' && json.bought) out.push(ev('cosmeticBought'));
      break;
    default:
      break;
  }
  return out;
}

// Distribue les evenements aux abonnes ; renvoie les annonces par joueur.
export function dispatch(store, subscribers, events) {
  const notices = [];
  if (!events.length) return notices;
  for (const sub of subscribers) {
    try { notices.push(...(sub.onEvents(store, events) || [])); } catch (e) { console.error(e); }
  }
  return notices;
}
