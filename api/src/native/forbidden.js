// Salle des Machines Interdites (2026-10-19) : la porte cachee et sa machine.
//  - ARG : 10 engrenages graves caches sur le site (action 'gear', n de 1 a
//    10) ; chacun donne une lettre. Les lettres dans l'ordre forment le nom de
//    la page cachee (NE PAS l'ecrire dans la doc publique ni dans les notes de
//    mise a jour : c'est la solution). La page 404 montre les lettres deja
//    trouvees a leur place.
//  - Acces : la premiere fois, il faut reclamer le mot (le nom de la page)
//    dans « Reclamer un code » (beforeWorkflow redeem-code) ; sans acces,
//    la page ne recoit que les rouages trouves (Users.ForbiddenAccess).
//  - Porte : ForbiddenKeysNeeded cles speciales a inserer (Users.DoorKeys).
//    Une cle speciale se forge avec 1 cle (KeyCount) + 1 de chaque mineral
//    (digdepth.js). Ouverture definitive (Users.ForbiddenUnlocked).
//  - Machine a sous : voir slots.js (actions spin, nudge, risk).
//  - Parchemin (2026-10-19) : rare prise de peche (ArgScrollChance par
//    lancer, une seule fois ; Users.ArgScroll). Il se relit (action
//    'scroll') et donne en enigmes l'emplacement des 10 rouages, jamais le mot.
//  - Solution (admins seulement, ce fichier n'est pas servi aux joueurs) :
//    mot SALAMANDRE, page site/salamandre.html. Engrenages (shell.js, Gears.SPOTS) :
//    I S notes de mise a jour (bas de la plus ancienne) · II A Musee du
//    coffre-fort · III L fouille, profondeur 5 · IV A peche, eaux profondes ·
//    V M page 404 · VI A page Mode du moment · VII N aquarium ouvert ·
//    VIII D code Konami sur l'accueil (ou glisses du doigt sur mobile) ·
//    IX R salle des machines (Communaute) · X E dinodex ouvert. Indice de depart : note de mise a jour du 19/10.
//   POST /webhook/forbidden { userId, action: 'status' | 'gear' | 'scroll' | 'craftKey' | 'insertKey' | 'spin' | 'nudge' | 'risk', n?, count?, bet? }

import { ok, fail, userById, now, parseJson } from './common.js';
import { setting } from './settings.js';
import { MINERALS, mineralsOf } from './digdepth.js';
import { addFeed } from './feed.js';
import { machineView, spin, nudge, risk } from './slots.js';

export const schema = {
  Users: {
    ArgGears: { type: 'Text' }, SpecialKeys: { type: 'Numeric' }, DoorKeys: { type: 'Numeric' }, ForbiddenUnlocked: { type: 'Numeric' }, ForbiddenAccess: { type: 'Numeric' }, ArgScroll: { type: 'Numeric' }
  }
};

// Le mot des rouages (10 lettres) : nom de la page cachee. Rien a voir avec
// les machines a premiere vue (impossible a deviner) ; la salamandre est
// pourtant la creature qui vit dans le feu de la forge.
const WORD = 'SALAMANDRE';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const PAGE = 'salamandre.html';
// Le parchemin : une enigme par rouage (dans l'ordre des chiffres romains).
const RIDDLES = [
  'Là où l’on raconte ce qui a changé, descends jusqu’au tout premier jour : je dors sous les fondations.',
  'Derrière les cadenas de ton coffre, il est une salle où l’on expose ce que l’on ne vend jamais.',
  'Creuse jusqu’au cœur, là où la terre cesse d’être terre et devient cristal.',
  'Jette ta ligne là où l’eau devient trop noire pour le rivage.',
  'Cherche ce qui n’existe pas. La page perdue garde l’un de nous… et la mémoire de tous les autres.',
  'Chaque règle a son temps. Lis celles du moment jusqu’à la dernière ligne.',
  'Soulève la vitre où nagent tes plus belles prises.',
  'Sur le seuil, joue l’air des anciennes consoles : deux fois vers le ciel, deux fois vers la terre, gauche, droite, gauche, droite… puis deux lettres. Sans clavier, le doigt suffit à le jouer : quatre glissés, quatre glissés, puis deux touchers.',
  'Là où l’on nourrit des machines affamées avec des cartes sacrifiées.',
  'Feuillette le livre des bêtes qui vivaient avant les hommes.'
];
// Code saisi : sans accents, espaces ni ponctuation, en majuscules.
const normCode = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

const gearsOf = (user) => (parseJson(user.ArgGears, []) || []).filter((n) => n >= 1 && n <= 10);
const isUnlocked = (user) => (Number(user.ForbiddenUnlocked) || 0) > 0;
const hasAccess = (user) => (Number(user.ForbiddenAccess) || 0) > 0 || isUnlocked(user);

function recipe(store, user) {
  const m = mineralsOf(user);
  return {
    keys: 1, ownKeys: Number(user.KeyCount) || 0,
    minerals: MINERALS.map((x) => ({ key: x.key, name: x.name, tier: x.tier, img: 'Fouille/' + x.img, own: Number(m[x.key]) || 0 }))
  };
}
const canCraft = (r) => r.ownKeys >= r.keys && r.minerals.every((x) => x.own >= 1);
// Ce que la page montre de la forge : rien n'est nomme tant que le joueur
// ne possede pas l'ingredient (pas de recette « cle en main », meme en
// lisant les reponses de l'API).
function forgeView(r) {
  const slot = (own, img, name) => (own ? { known: true, img, name } : { known: false });
  return {
    slots: [slot(r.ownKeys >= 1, "clés.PNG", "Clé"), ...r.minerals.map((m) => slot(m.own >= 1, m.img, m.name))],
    ready: canCraft(r)
  };
}

function view(store, user) {
  const gears = gearsOf(user).sort((a, b) => a - b).map((n) => ({ n, roman: ROMAN[n - 1], letter: WORD[n - 1] }));
  // Sans acces : rien d'autre que les rouages trouves (tableau de la page 404).
  if (!hasAccess(user)) return { access: false, gears, gearsTotal: 10 };
  const r = recipe(store, user);
  const base = {
    access: true, page: PAGE,
    gears, gearsTotal: 10,
    specialKeys: Number(user.SpecialKeys) || 0, doorKeys: Number(user.DoorKeys) || 0, keysNeeded: setting(store, 'ForbiddenKeysNeeded'),
    unlocked: isUnlocked(user), forge: forgeView(r)
  };
  if (!base.unlocked) return base;
  return { ...base, machine: machineView(store, user) };
}

function handle({ store, body }) {
  let user = userById(store, body.userId);
  if (!user) return fail('unknown_user', 404);
  const action = body.action || 'status';
  if (action === 'status') return ok(view(store, user));

  if (action === 'gear') {
    const n = Math.floor(Number(body.n));
    if (!(n >= 1 && n <= 10)) return fail('invalid_gear');
    const gears = gearsOf(user);
    const fresh = !gears.includes(n);
    if (fresh) user = store.update('Users', user.id, { ArgGears: JSON.stringify([...gears, n]) });
    return ok({ n, roman: ROMAN[n - 1], letter: WORD[n - 1], fresh, found: gearsOf(user).length, total: 10 });
  }

  if (action === 'scroll') {
    if (!(Number(user.ArgScroll) > 0)) return fail('no_scroll', 404);
    return ok({ title: 'Dix rouages dorment dans la maison.', riddles: RIDDLES.map((text, i) => ({ roman: ROMAN[i], text, found: gearsOf(user).includes(i + 1) })), outro: 'Leurs lettres, dans l’ordre, forment un nom. Ce nom se réclame.' });
  }

  if (!hasAccess(user)) return fail('no_access', 403, view(store, user));

  if (action === 'craftKey') {
    const r = recipe(store, user);
    if (!canCraft(r)) return fail('missing_ingredients', 400, view(store, user));
    const m = mineralsOf(user);
    MINERALS.forEach((x) => { m[x.key] = (Number(m[x.key]) || 0) - 1; });
    user = store.update('Users', user.id, { Minerals: JSON.stringify(m), KeyCount: (Number(user.KeyCount) || 0) - 1, SpecialKeys: (Number(user.SpecialKeys) || 0) + 1 });
    return ok({ ...view(store, user), crafted: true });
  }

  if (action === 'insertKey') {
    if (isUnlocked(user)) return fail('already_open', 400, view(store, user));
    if ((Number(user.SpecialKeys) || 0) < 1) return fail('no_special_key', 400, view(store, user));
    const need = setting(store, 'ForbiddenKeysNeeded');
    const door = (Number(user.DoorKeys) || 0) + 1;
    const fields = { SpecialKeys: (Number(user.SpecialKeys) || 0) - 1, DoorKeys: door };
    const opened = door >= need;
    if (opened) fields.ForbiddenUnlocked = now();
    user = store.update('Users', user.id, fields);
    if (opened) addFeed(store, { userId: user.id, kind: 'forbidden', icon: '🚪', text: 'a ouvert une porte que personne n’avait jamais vue…' });
    return ok({ ...view(store, user), inserted: door, opened });
  }

  if (action === 'spin' || action === 'nudge' || action === 'risk') {
    if (!isUnlocked(user)) return fail('locked', 403);
    const r = action === 'spin' ? spin(store, user, body) : action === 'nudge' ? nudge(store, user) : risk(store, user);
    if (r.json && r.json.machine) r.json = { ...view(store, store.get('Users', user.id)), ...r.json };
    return r;
  }
  return fail('unknown_action');
}

// Peche : le parchemin, une seule fois par joueur. Renvoie true s'il vient
// d'etre pris (le champ est ecrit ici).
export function rollScroll(store, user, casts = 1) {
  if (!user || Number(user.ArgScroll) > 0) return false;
  const p = Math.min(1, Math.max(0, setting(store, 'ArgScrollChance')));
  if (!(Math.random() < 1 - Math.pow(1 - p, Math.max(1, casts)))) return false;
  store.update('Users', user.id, { ArgScroll: now() });
  return true;
}

// « Reclamer un code » : le mot ouvre l'acces a la page (premiere fois).
export function beforeWorkflow({ store, path, request }) {
  if (path !== 'redeem-code') return null;
  const body = (request && request.body) || {};
  if (normCode(body.code) !== WORD) return null;
  const user = userById(store, body.userId);
  if (!user) return null;
  const first = !hasAccess(user);
  if (first) store.update('Users', user.id, { ForbiddenAccess: now() });
  return ok({ type: 'secret', page: PAGE, first, message: first ? 'Le mot résonne dans les murs. Quelque part, une porte vient d’apparaître.' : 'La porte te connaît déjà.' });
}

export const routes = { 'POST forbidden': handle };
