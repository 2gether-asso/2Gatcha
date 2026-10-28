// Artistes a l'honneur (2026-10-30) : une fiche par artiste de l'asso (photo,
// presentation, reseaux sociaux) et toutes ses cartes du jeu. Les cartes sont
// rattachees par le champ texte Cards.Artist (meme nom que la fiche, ou un de
// ses autres noms). Un nom d'artiste present sur des cartes sans fiche a quand
// meme sa page (sans presentation) : l'equipe cree la fiche depuis l'admin
// (Base de donnees -> Artistes). Cartes montrees : actives, pas secretes, d'une
// extension visible ; la reponse dit lesquelles le joueur possede.
//   GET /webhook/artists [?userId=]          -> { artists }
//   GET /webhook/artist ?slug= [&userId=]    -> { artist, cards, extensions, stats }

import { ok, fail, refId, firstAttachment, userById, cardSummary } from './common.js';

export const schema = {
  Artists: {
    Name: { type: 'Text' }, Slug: { type: 'Text' }, Aliases: { type: 'Text' }, Tagline: { type: 'Text' }, Bio: { type: 'Text' },
    Avatar: { type: 'Attachments' }, Banner: { type: 'Attachments' }, Links: { type: 'Text' }, FeaturedCard: { type: 'Ref:Cards' },
    Color: { type: 'Text' }, SortOrder: { type: 'Numeric' }, Active: { type: 'Bool' }
  }
};

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
export const slugOf = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// Reseaux reconnus a partir de l'adresse (le reste : nom de domaine + 🔗).
const NETWORKS = [
  [/(^|\.)instagram\.com$/, 'instagram', 'Instagram', '📸'], [/(^|\.)(x|twitter)\.com$/, 'x', 'X', '✖️'],
  [/(^|\.)bsky\.(app|social)$/, 'bluesky', 'Bluesky', '🦋'], [/(^|\.)threads\.(net|com)$/, 'threads', 'Threads', '🧵'],
  [/(^|\.)tiktok\.com$/, 'tiktok', 'TikTok', '🎵'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube', 'YouTube', '▶️'],
  [/(^|\.)twitch\.tv$/, 'twitch', 'Twitch', '🎮'], [/(^|\.)artstation\.com$/, 'artstation', 'ArtStation', '🎨'],
  [/(^|\.)deviantart\.com$/, 'deviantart', 'DeviantArt', '🖌️'], [/(^|\.)behance\.net$/, 'behance', 'Behance', '🅱️'],
  [/(^|\.)pixiv\.net$/, 'pixiv', 'pixiv', '🖼️'], [/(^|\.)cara\.app$/, 'cara', 'Cara', '🎨'], [/(^|\.)tumblr\.com$/, 'tumblr', 'Tumblr', '📓'],
  [/(^|\.)(ko-fi\.com)$/, 'kofi', 'Ko-fi', '☕'], [/(^|\.)patreon\.com$/, 'patreon', 'Patreon', '🧡'], [/(^|\.)(tipeee\.com)$/, 'tipeee', 'Tipeee', '🧡'],
  [/(^|\.)(linktr\.ee|beacons\.ai|carrd\.co)$/, 'links', 'Tous ses liens', '🌳'], [/(^|\.)(discord\.gg|discord\.com)$/, 'discord', 'Discord', '💬'],
  [/(^|\.)(etsy\.com|redbubble\.com|inprnt\.com)$/, 'shop', 'Boutique', '🛍️']
];

// Une adresse par ligne, ou « Libelle | adresse ». Seulement http(s).
export function parseLinks(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bar = line.lastIndexOf('|');
    const label = bar > 0 ? line.slice(0, bar).trim() : '';
    let href = (bar > 0 ? line.slice(bar + 1) : line).trim();
    if (!/^https?:\/\//i.test(href)) href = 'https://' + href.replace(/^\/+/, '');
    let url;
    try { url = new URL(href); } catch (e) { continue; }
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) continue;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const net = NETWORKS.find(([re]) => re.test(host));
    const handle = net && !['links', 'shop', 'discord'].includes(net[1]) ? (url.pathname.split('/').filter(Boolean)[0] || '') : '';
    out.push({ network: net ? net[1] : 'web', label: label || (net ? net[2] : host), icon: net ? net[3] : '🔗', url: url.href, handle: handle && !/^(channel|c|user)$/.test(handle) ? decodeURIComponent(handle).replace(/^@?/, '@').slice(0, 40) : '' });
    if (out.length >= 12) break;
  }
  return out;
}

const visibleExtensions = (store) => new Map(store.getAll('Extensions').filter((e) => e.Active !== false).map((e) => [e.id, e]));
const showable = (store) => { const ext = visibleExtensions(store); return { ext, cards: store.getAll('Cards').filter((c) => c.Active && !c.IsSecret && ext.has(refId(c.Extension)) && norm(c.Artist)) }; };

// Fiches + noms trouves sur les cartes, rattaches par nom normalise. Une
// fiche masquee garde ses noms : l'artiste (et ses cartes) n'apparait plus du
// tout, sans page automatique a sa place.
function directory(store) {
  const rows = store.tables.has('Artists') ? store.getAll('Artists').filter((a) => norm(a.Name)) : [];
  const byName = new Map();
  const list = rows.map((r) => ({ row: r, hidden: r.Active === false || r.Active === 0, name: String(r.Name).trim(), slug: slugOf(r.Slug || r.Name) || 'artiste-' + r.id, cards: [] }));
  for (const a of list) for (const n of [a.name, ...String(a.row.Aliases || '').split(/[,;\n]/)]) if (norm(n) && !byName.has(norm(n))) byName.set(norm(n), a);
  const { ext, cards } = showable(store);
  for (const c of cards) {
    let a = byName.get(norm(c.Artist));
    if (!a) { a = { row: null, name: String(c.Artist).trim(), slug: slugOf(c.Artist), cards: [] }; list.push(a); byName.set(norm(c.Artist), a); }
    a.cards.push(c);
  }
  // Deux fiches au meme slug : la seconde prend son numero.
  const seen = new Set();
  for (const a of list) { if (seen.has(a.slug)) a.slug += '-' + (a.row ? a.row.id : seen.size); seen.add(a.slug); }
  return { list: list.filter((a) => !a.hidden), ext };
}

const raritySort = (store) => { const m = new Map(store.getAll('Rarities').map((r) => [r.id, Number(r.SortOrder) || 0])); return (c) => m.get(refId(c.Rarity)) || 0; };
const ownedSet = (store, userId) => {
  const id = Number(userId);
  return id ? new Set(store.getAll('Pulls').filter((p) => refId(p.User) === id).map((p) => refId(p.Card))) : null;
};

function cover(store, a) {
  const feat = a.row && refId(a.row.FeaturedCard);
  const rank = raritySort(store);
  const pick = (feat && a.cards.find((c) => c.id === feat)) || [...a.cards].filter((c) => firstAttachment(c.Image)).sort((x, y) => rank(y) - rank(x) || x.id - y.id)[0];
  return pick ? cardSummary(store, pick) : null;
}

function header(store, a, owned) {
  const r = a.row || {};
  return {
    slug: a.slug, name: a.name, hasProfile: !!a.row, tagline: r.Tagline || '', bio: r.Bio || '',
    avatarId: firstAttachment(r.Avatar), bannerId: firstAttachment(r.Banner), color: /^#[0-9a-f]{3,8}$/i.test(String(r.Color || '').trim()) ? String(r.Color).trim() : '',
    links: parseLinks(r.Links), cardCount: a.cards.length, owned: owned ? a.cards.filter((c) => owned.has(c.id)).length : null, cover: cover(store, a)
  };
}

function listHandler({ store, query }) {
  const { list } = directory(store);
  const owned = ownedSet(store, query && query.userId);
  const artists = list.filter((a) => a.row || a.cards.length)
    .sort((x, y) => (!!y.row - !!x.row) || (Number(x.row && x.row.SortOrder) || 0) - (Number(y.row && y.row.SortOrder) || 0) || y.cards.length - x.cards.length || x.name.localeCompare(y.name, 'fr'))
    .map((a) => header(store, a, owned));
  return ok({ artists });
}

function artistHandler({ store, query }) {
  const slug = slugOf((query && query.slug) || '');
  const { list, ext } = directory(store);
  // Lien fait depuis un autre nom (champ Artiste d'une carte, alias) : meme page.
  const a = slug && (list.find((x) => x.slug === slug) || list.find((x) => x.cards.some((c) => slugOf(c.Artist) === slug) || (x.row && String(x.row.Aliases || '').split(/[,;\n]/).some((n) => slugOf(n) === slug))));
  if (!a) return fail('unknown_artist', 404);
  const userId = query && query.userId;
  const owned = userId && userById(store, userId) ? ownedSet(store, userId) : null;
  // Exemplaires dans les collections et collectionneurs, carte par carte.
  const ids = new Set(a.cards.map((c) => c.id));
  const copies = new Map(), holders = new Set();
  for (const p of store.getAll('Pulls')) {
    const cid = refId(p.Card), uid = refId(p.User);
    if (!ids.has(cid) || !uid) continue;
    copies.set(cid, (copies.get(cid) || 0) + 1);
    holders.add(uid);
  }
  const rank = raritySort(store);
  const cards = [...a.cards]
    .sort((x, y) => refId(x.Extension) - refId(y.Extension) || (Number(x.SortOrder) || 0) - (Number(y.SortOrder) || 0) || rank(x) - rank(y) || x.id - y.id)
    .map((c) => ({ ...cardSummary(store, c), extensionId: refId(c.Extension), description: c.Description || '', isPromo: !!c.IsPromo, copies: copies.get(c.id) || 0, ...(owned ? { owned: owned.has(c.id) } : {}) }));
  const extensions = [...new Set(cards.map((c) => c.extensionId))].map((id) => ext.get(id)).filter(Boolean)
    .sort((x, y) => (Number(x.SortOrder) || 0) - (Number(y.SortOrder) || 0) || x.id - y.id)
    .map((e) => ({ id: e.id, name: e.Name, count: cards.filter((c) => c.extensionId === e.id).length }));
  const byRarity = {};
  for (const c of cards) if (c.rarity) byRarity[c.rarity.key] = (byRarity[c.rarity.key] || 0) + 1;
  return ok({
    artist: header(store, a, owned),
    cards, extensions,
    stats: { cards: cards.length, extensions: extensions.length, copies: [...copies.values()].reduce((n, v) => n + v, 0), collectors: holders.size, byRarity }
  });
}

export const routes = { 'GET artists': listHandler, 'GET artist': artistHandler };
