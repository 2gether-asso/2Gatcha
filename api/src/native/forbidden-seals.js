// Salle interdite V2 (2026-11-19) : la deuxieme porte, sous la salle.
// FICHIER SERVEUR SEULEMENT : il contient la solution. Ne jamais recopier
// les conditions ni le mot dans la doc publique (admin-doc.js), les notes de
// mise a jour ou le site.
//  - Une plaque dans le hall montre 7 sceaux eteints et leurs 7 enigmes
//    (RIDDLES, envoyees au site). Chaque sceau s'embrase quand le joueur fait
//    la chose decrite (detectee apres coup, afterNative sur forbidden et
//    casino) et revele une lettre. Users.ForbiddenSeals = { found: { n: at }, solved }.
//  - Les 7 lettres, dans l'ordre des chiffres romains, forment le mot a
//    graver sur la plaque (action 'plaque' { word }) une fois les 7 sceaux
//    allumes. Recompense : la machine « La Salamandre » (slots.js), la carte
//    unique « L'Oeil des cendres » (extension des cartes secretes, contour
//    dore), le titre « Gardien des cendres » et le cadre « Cendres ardentes ».
//  - SOLUTION : mot BRASIER.
//    I   B : un triple de cranes 💀 sur La Fournaise.
//    II  R : une relance de rouleau qui donne un triple, sur L'Horloger.
//    III A : une main de blackjack gagnee avec 5 cartes ou plus.
//    IV  S : une bille de Plinko dans un bac du bord, entre 23 h et 5 h (Paris).
//    V   I : donner une Infernite au Coeur de la salle.
//    VI  E : un tour de surchauffe (triple force) entre 3 h et 4 h (Paris).
//    VII R : gagner a la roulette sur le numero plein 0.

import { ok, fail, now, parisHour, parseJson, nextSerial, firstAttachment } from './common.js';
import { grantCosmetic } from './cosmetics.js';
import { addFeed } from './feed.js';
import { machinesOf, grantMachineFields } from './slots.js';
import { secretExtension } from './secrets.js';

export const schema = { Users: { ForbiddenSeals: { type: 'Text' } } };

const WORD = 'BRASIER';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const GLYPHS = ['🜂', '🜁', '🜃', '🜄', '🜍', '🜔', '🜏'];
export const RIDDLES = [
  'Dans la gueule du four, aligne trois fois la mort.',
  'Chez celui qui compte les secondes, une seconde chance devient triomphe.',
  'À la table, l’emporter avec une main de cinq doigts au moins.',
  'Quand la lune est haute, laisse la bille mourir tout au bord.',
  'Nourris le cœur de ce qui brûle sous la terre.',
  'À l’heure des ombres, laisse la machine brûler jusqu’au bout.',
  'Mise sur le néant, et que le néant te réponde.'
];
const CARD_NAME = 'L’Œil des cendres';
const CARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 700"><defs><radialGradient id="f" cx="0.5" cy="0.62" r="0.7"><stop offset="0" stop-color="#fde68a"/><stop offset="0.35" stop-color="#f97316"/><stop offset="0.7" stop-color="#7f1d1d"/><stop offset="1" stop-color="#1c0a05"/></radialGradient><radialGradient id="e" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff7ed"/><stop offset="0.5" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/></radialGradient></defs><rect width="500" height="700" fill="url(#f)"/><g fill="#1c0a05" opacity="0.55"><path d="M60 700 C90 560 40 500 110 400 C130 520 170 540 150 700Z"/><path d="M380 700 C350 580 420 520 370 420 C440 500 470 560 450 700Z"/></g><ellipse cx="250" cy="330" rx="150" ry="80" fill="#1c0a05"/><ellipse cx="250" cy="330" rx="120" ry="62" fill="url(#e)"/><ellipse cx="250" cy="330" rx="16" ry="58" fill="#1c0a05"/><g font-family="serif" font-weight="700" text-anchor="middle" fill="#fde68a"><text x="250" y="560" font-size="40" letter-spacing="8">CENDRES</text></g></svg>`;

const sealsOf = (user) => { const v = parseJson(user && user.ForbiddenSeals, null) || {}; return { found: v.found && typeof v.found === 'object' ? v.found : {}, solved: Number(v.solved) || 0 }; };
export function sealsView(store, user) {
  const s = sealsOf(user);
  const n = Object.keys(s.found).length;
  return {
    total: 7, count: n, solved: !!s.solved, ready: n >= 7 && !s.solved,
    seals: ROMAN.map((roman, i) => { const at = s.found[i + 1]; return { n: i + 1, roman, riddle: RIDDLES[i], lit: !!at, glyph: at ? GLYPHS[i] : null, letter: at ? WORD[i] : null }; })
  };
}

// Sceaux allumes par une reponse (numeros 1 a 7).
function sealsHit(store, user, path, body, json) {
  const hits = [];
  const action = body.action || 'status';
  const h = parisHour();
  if (path === 'forbidden' && action === 'spin' && Array.isArray(json.results)) {
    for (const r of json.results) {
      if (r.machine === 'fournaise' && [r, ...(r.cascades || [])].some((x) => x.key === 'crane' && (x.tier === 'triple' || x.tier === 'quad'))) hits.push(1);
      if (r.forced && h === 3) hits.push(6);
    }
  }
  if (path === 'forbidden' && action === 'nudge' && json.nudge && (json.nudge.tier === 'triple' || json.nudge.tier === 'quad') && machinesOf(user).current === 'horloger') hits.push(2);
  if (path === 'forbidden' && action === 'feed' && String(body.key || '') === 'infernite') hits.push(5);
  if (path === 'casino') {
    const g = String(body.game || '');
    const bj = json.blackjack;
    if (g === 'blackjack' && bj && bj.done && ['win', 'blackjack'].includes(bj.result) && (bj.player || []).length >= 5) hits.push(3);
    const p = json.plinko;
    if (g === 'plinko' && p && p.bin != null && Array.isArray(p.mults) && (p.bin === 0 || p.bin === p.mults.length - 1) && (h >= 23 || h < 5)) hits.push(4);
    const rl = json.roulette;
    if (g === 'roulette' && rl && rl.n === 0 && (rl.bets || []).some((b) => b.type === 'number' && b.n === 0 && b.win > 0)) hits.push(7);
  }
  return [...new Set(hits)];
}

export function afterNative({ store, path, request, response }) {
  if (path !== 'forbidden' && path !== 'casino') return;
  const body = request.body || {};
  const user = store.get('Users', Number(body.userId));
  if (!user || !(Number(user.ForbiddenUnlocked) > 0)) return;
  const s = sealsOf(user);
  if (s.solved) return;
  const fresh = sealsHit(store, user, path, body, response.json).filter((n) => !s.found[n]);
  if (!fresh.length) return;
  for (const n of fresh) s.found[n] = now();
  store.update('Users', user.id, { ForbiddenSeals: JSON.stringify(s) });
  const n = fresh[0];
  // Le site joue la cinematique du sceau (un seul a la fois).
  response.json.seal = { n, roman: ROMAN[n - 1], glyph: GLYPHS[n - 1], letter: WORD[n - 1], count: Object.keys(s.found).length, total: 7 };
}

// Carte unique, creee une fois (comme la carte du 404, secrets.js).
function ensureCard(store) {
  if (!store.tables.has('Cards') || !store.tables.has('Rarities')) return null;
  const found = store.getAll('Cards').find((c) => c.Name === CARD_NAME);
  if (found) return found;
  const ext = secretExtension(store);
  const cols = store.table('Cards').columns;
  const only = (fields) => Object.fromEntries(Object.entries(fields).filter(([k]) => cols[k]));
  const rarities = store.getAll('Rarities').sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  const rarity = rarities.find((r) => String(r.Key || '').toLowerCase() === 'mythique') || rarities.find((r) => String(r.Key || '').toLowerCase() === 'legendaire') || rarities[rarities.length - 1];
  let image = null;
  if (cols.Image && typeof store.nextAttachmentId === 'function') {
    const id = store.nextAttachmentId();
    store.putAttachment(id, 'oeil-des-cendres.svg', 'image/svg+xml', Buffer.from(CARD_SVG));
    image = ['L', id];
  }
  return store.create('Cards', only({
    Name: CARD_NAME, Artist: '???', Description: 'Sous la salle, quelque chose a ouvert un œil.',
    Image: image, Rarity: rarity ? rarity.id : null, Extension: ext ? ext.id : null, Active: true, IsPromo: true, SecretEffect: 'aura-gold'
  }));
}

const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
export function plaque(store, user, body) {
  const s = sealsOf(user);
  if (s.solved) return fail('already_solved', 400, { seals: sealsView(store, user) });
  if (Object.keys(s.found).length < 7) return fail('seals_missing', 400, { seals: sealsView(store, user) });
  if (norm(body.word) !== WORD) return fail('wrong_word', 400, { seals: sealsView(store, user) });
  const fields = { ForbiddenSeals: JSON.stringify({ ...s, solved: now() }), ...(grantMachineFields(user, 'salamandre') || {}) };
  const card = ensureCard(store);
  let cardView = null;
  if (card) {
    const serial = nextSerial(store, card.id);
    store.create('Pulls', { User: user.id, Card: card.id, ObtainedAt: now(), BatchId: `secret-ash-${user.id}`, SerialNumber: serial, Finish: 'normal', Quality: 'mint', Edition: 'forbidden' });
    cardView = { cardId: card.id, name: card.Name, imageId: firstAttachment(card.Image), serialNumber: serial };
  }
  grantCosmetic(store, user.id, 'title-cendres', { type: 'title', label: 'Gardien des cendres' });
  grantCosmetic(store, user.id, 'frame-cendres', { type: 'frame', label: 'Cendres ardentes' });
  const updated = store.update('Users', user.id, fields);
  addFeed(store, { userId: user.id, kind: 'forbidden', icon: '👁️', text: 'a réveillé quelque chose, tout au fond de la salle interdite…' });
  return ok({ seals: sealsView(store, updated), solved: true, card: cardView, rewards: ['Une nouvelle machine dans la salle', 'Une carte unique', 'Le titre « Gardien des cendres »', 'Le cadre « Cendres ardentes »'] });
}
