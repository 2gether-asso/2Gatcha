// Socle commun a toutes les pages (ex-main.js, decoupe 2026-10-04).
// Themes de couleur, paliers de deblocage par niveau (FEATURE_UNLOCK_LEVEL...),
// niveau connu du joueur et Session (joueur connecte, stocke en localStorage).
// Ordre de chargement dans chaque page : config.js, api.js, core.js, ui.js,
// shell.js, shell-extras.js, puis le script de la page.

// ---------------------------------------------------------------------------
// Scripts charges a la demande (2026-10-20, js/lazy/...) : une seule fois par
// page, avec le meme suffixe de version (?v=) que core.js, pose a chaque
// deploiement par .github/workflows/static.yml (sinon un ancien module
// pourrait rester en cache avec un nouveau site).
// ---------------------------------------------------------------------------
const LazyJs = {
  version: (() => { const s = document.currentScript; const m = s && (s.getAttribute("src") || "").match(/\?v=[^&#]+/); return m ? m[0] : ""; })(),
  pending: new Map(),
  load(path) {
    if (!this.pending.has(path)) {
      this.pending.set(path, new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = path + this.version;
        s.onload = resolve;
        s.onerror = () => { this.pending.delete(path); s.remove(); reject(new Error("Chargement impossible : " + path)); };
        document.head.appendChild(s);
      }));
    }
    return this.pending.get(path);
  }
};

// ---------------------------------------------------------------------------
// Themes de couleur : purement cosmetique, debloques par niveau de profil
// (voir Users.XP). Applique via [data-theme] sur <html>, qui redefinit les
// variables de :root (voir style.css) - aucune regle ailleurs dans la
// feuille de style n'a besoin d'etre touchee, tout passe deja par var(...).
// Sauvegarde/lecture en localStorage uniquement (preference d'affichage
// pure, jamais lue par le serveur).
// ---------------------------------------------------------------------------
// Echappement HTML commun a tout le site (texte insere dans innerHTML,
// apostrophe comprise : sur aussi dans un attribut entre apostrophes).
// Message d'erreur lisible pour le joueur (2026-10-15) : codes courants de
// l'API traduits, panne reseau ou serveur expliquee, sinon le code entre
// parentheses (utile pour un signalement). Les pages gardent leurs messages
// propres en priorite : MESSAGES[e.code] || friendlyError(e).
const COMMON_ERRORS = {
  test_account_isolated: "Impossible avec le compte test : il est isolé des autres joueurs.",
  edition_kept: "Annulé : ton exemplaire en édition limitée est conservé.",
  ironman_pledged: "Serment Ironman : aucun décraft tant que dure le mode Hard (tu peux renoncer depuis la page du mode).",
  wrong_mode: "Pas disponible dans le mode de jeu actuel.",
  already_used: "Déjà utilisé aujourd'hui : reviens demain !",
  already_set: "Déjà choisie cette semaine.",
  not_in_wishlist: "Cette carte n'est pas dans ta liste de souhaits.",
  not_last_booster: "Seulement une carte de ton dernier booster (moins de 24 h).",
  too_soon: "Trop tôt : patiente un peu avant de recommencer.",
  bounty_taken: "Trop tard : la prime vient d'être remportée.",
  theft_limit: "Trois tentatives par jour maximum.",
  no_key: "Il te faut une clé.",
  unknown_target: "Joueur introuvable.",
  target_protected: "Ce joueur s'est déjà fait voler deux fois aujourd'hui.",
  nothing_to_steal: "Ce joueur n'a aucun doublon à voler.",
  already_in_draft: "Tu participes déjà à un draft.",
  draft_full: "Ce draft est complet.",
  not_in_draft: "Tu ne participes pas à ce draft.",
  draft_started: "Ce draft a déjà commencé : impossible de le quitter.",
  not_host: "Seul l'hôte du salon peut lancer le draft.",
  draft_not_running: "Ce draft n'est pas en cours (terminé ou pas encore lancé).",
  draft_closed: "Ce draft a déjà commencé.",
  need_two_players: "Il faut au moins 2 joueurs pour lancer le draft.",
  not_your_turn: "Ce n'est pas ton tour.",
  card_taken: "Cette carte vient d'être prise.",
  walked_today: "Ce dino s'est déjà promené aujourd'hui.",
  already_walking: "Ce dino est déjà en balade.",
  still_walking: "Il n'est pas encore rentré de balade.",
  cannot_pledge: "Le serment ne se prête que dans les 48 premières heures du mode Hard.",
  edition_copy: "Cet exemplaire est en édition limitée : confirme pour le sacrifier.",
  not_enough_dust: "Pas assez de poussières d'étoile.",
  not_enough_boosters: "Pas assez de boosters.", no_boosters: "Tu n'as plus de booster.",
  not_enough_keys: "Il te faut une clé.", no_key: "Il te faut une clé.",
  not_enough_worms: "Plus de vers de terre : termine une grille de fouille ou récolte au jardin.",
  nothing_to_claim: "Rien à récupérer : c'est déjà fait.", already_claimed: "Déjà récupéré.",
  already_owned: "Tu l'as déjà.", already_voted: "Tu as déjà voté.", already_rerolled: "Déjà relancé aujourd'hui.",
  already_busy: "Une action est déjà en cours, patiente un instant.", slow_down: "Doucement ! Réessaie dans quelques secondes.",
  rate_limited: "Trop d'actions d'un coup : patiente une minute.",
  weekly_cap: "Limite de la semaine atteinte.", daily_limit: "Limite du jour atteinte : reviens demain !",
  no_energy: "Plus assez d'énergie : elle se recharge avec le temps.", energy_full: "Ton énergie est déjà pleine.",
  forbidden: "Action réservée.", unauthorized: "Ta session a expiré : reconnecte-toi.", invalid_token: "Ta session a expiré : reconnecte-toi.",
  unknown_user: "Compte introuvable : reconnecte-toi.",
  copy_not_owned: "Tu ne possèdes plus cet exemplaire.", card_not_owned: "Tu ne possèdes pas cette carte.", pull_not_owned: "Tu ne possèdes plus cet exemplaire.",
  not_owned: "Tu ne le possèdes pas.", insured_copy: "Cet exemplaire est assuré : retire l'assurance d'abord.", copy_in_vault: "Cet exemplaire est rangé dans ton coffre-fort.",
  unique_card_not_allowed: "Impossible avec une carte Unique.", card_not_found: "Carte introuvable.", unknown_card: "Carte introuvable.", not_found: "Introuvable.",
  maintenance: "Le jeu est en maintenance : reviens dans un instant."
};
function friendlyError(e) {
  const code = e && (e.code || (e.data && e.data.error));
  if (e && e.data && (e.data.error === "feature_disabled" || e.data.error === "level_locked") && e.data.message) return e.data.message;
  if (code && COMMON_ERRORS[code]) return COMMON_ERRORS[code];
  const msg = String((e && e.message) || "");
  // Panne : serveur injoignable ou erreur 5xx.
  if (/Failed to fetch|NetworkError|Load failed|Erreur API \([^)]*\): 5\d\d/.test(msg)) return "Le serveur ne répond pas : réessaie dans un instant.";
  return "Erreur. (" + (code || msg || "inconnue") + ")";
}

// Icones des ressources (2026-10-18) : les visuels du jeu (remplacables dans
// Admin > Visuels) a la place des emoji.
const RES_ART = { worm: "Pêche/Vers.png", part: "PieceDetachee.PNG", bone: "Os.PNG", key: "clés.PNG", skey: "cléSpeciale.png", bait: "Pêche/Vers.png", potion: "ElixirDePeche.PNG", coin: "PièceKraken.PNG", chest: "Coffres/1.PNG", skull: "CraneDeDino.png", token: "JetonBooster.png", fish: "Pêche/Poisson_12.png", seaweed: "Pêche/Algues.png", shrimp: "Pêche/crevette.png" };
// Ressources dorees (2026-10-19) : meme image qu'une autre, avec un filtre
// dore (l'appat dore = des vers dores).
const RES_GOLD = new Set(["bait"]);
// Engrais de dino et engrais dore (meme emoji, filtre dore pour le second).
const POOP = '<span class="emo-poop" aria-hidden="true">&#128169;</span>';
const GOLD_POOP = '<span class="emo-poop ico-gold" aria-hidden="true">&#128169;</span>';
function resIcon(kind, alt = "") {
  const f = RES_ART[kind];
  return f ? `<img class="ico-token${RES_GOLD.has(kind) ? " ico-gold" : ""}" src="assets/${encodeURI(f)}" alt="${alt}" />` : "";
}
// Vibrations (2026-10-18) : legeres, sur mobile, desactivables (menu du joueur).
const Haptics = {
  KEY: "2gatcha_haptics",
  get on() { try { return localStorage.getItem(this.KEY) !== "off"; } catch (e) { return true; } },
  set(on) { try { if (on) localStorage.removeItem(this.KEY); else localStorage.setItem(this.KEY, "off"); } catch (e) { /* stockage indisponible */ } },
  buzz(pattern) { if (!this.on) return; try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* non supporte */ } }
};

// A quoi sert chaque ressource et ou en trouver (infobulles, shell.js).
const RES_INFO = {
  worm: { name: "Vers de terre", use: "Un ou plusieurs par lancer de pêche (selon la zone).", where: "Terre restante d'une grille de fouille, jardin, expédition en forêt, boutique." },
  part: { name: "Pièce détachée", use: "Remplace un exemplaire dans une fusion ou une restauration.", where: "Pêche, expéditions (côte, port), boutique, comptoir des minéraux." },
  bone: { name: "Os", use: "Envoie Milo creuser pour toi pendant 2 h ; ramène un dino à la vie.", where: "Pêche, expédition en forêt, autel (sacrifice raté), boutique." },
  key: { name: "Clé", use: "Ouvre les coffres du gatchapon et les cadenas du grand coffre-fort, prend une carte au coffre de guilde, relance la roue de la fortune.", where: "Fouille, pêche, expédition aux ruines, roue, niveaux, boutique." },
  potion: { name: "Potion de savoir", use: "XP ×2 pendant 1 heure (compte, pêche, fouille, expédition, jardin).", where: "Boutique (rayon bonus)." },
  bait: { name: "Appât doré", use: "Un lancer sans prise vide, et prises rares ×2,5.", where: "Jardin, pêche, expédition sur la côte, boutique." },
  coin: { name: "Pièce de gatchapon", use: "Une boule au gatchapon, avec un coffre dedans (à ouvrir avec une clé).", where: "Niveaux, saison, pêche, expédition au port, boutique." },
  chest: { name: "Coffre", use: "S'ouvre avec une clé : poussières, jetons booster, cartes.", where: "Gatchapon, coffre de saison." },
  skull: { name: "Crâne de dinosaure", use: "Avec assez d'os, un dino revient à la vie.", where: "Milo en mode excité, expédition aux ruines." },
  token: { name: "Jeton booster", use: "1 jeton = 1 booster de 5 cartes au distributeur.", where: "Niveaux, quêtes, fouille, parcours, saisons, codes événement." },
  fish: { name: "Poisson", use: "Nourrit tes dinos et Moka le chat.", where: "Pêche, expédition sur la côte." },
  seaweed: { name: "Algues", use: "Nourriture des dinos.", where: "Pêche." },
  shrimp: { name: "Crevette", use: "Nourriture des dinos (rend leurs engrais plus précieux).", where: "Pêche." }
};
// Type de ressource d'une image (par son fichier).
function resKindOf(img) {
  let src = "";
  try { src = decodeURIComponent(img.getAttribute("src") || ""); } catch (e) { src = img.getAttribute("src") || ""; }
  if (img.classList.contains("ico-gold")) return Object.keys(RES_ART).find((k) => RES_GOLD.has(k) && src.endsWith("assets/" + RES_ART[k])) || null;
  return Object.keys(RES_ART).find((k) => !RES_GOLD.has(k) && src.endsWith("assets/" + RES_ART[k])) || null;
}

// Icone envoyee par le serveur (catalogue de la boutique, couts de la salle
// des machines...) : l'image de la ressource si on la connait, sinon l'emoji.
const EMOJI_RES = { "🪱": "worm", "🔩": "part", "🦴": "bone", "🔑": "key", "🗝️": "key", "🗝": "key", "🪝": "bait", "🪙": "coin", "🃏": "token", "💀": "skull", "📘": "potion" };
const iconOf = (emoji) => (EMOJI_RES[emoji] ? resIcon(EMOJI_RES[emoji]) : emoji || "");

// Petits formats partages (2026-10-18) : avant, recopies a l'identique dans
// une dizaine de fichiers.
const fmtNum = (n) => Number(n || 0).toLocaleString("fr-FR");
const fmtSerial = (n) => (n != null ? "#" + String(n).padStart(3, "0") : "");
// Texte en minuscules sans accents (recherches).
const normText = (str) => String(str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Page d'un artiste (artistes.html, 2026-10-30) a partir du champ Artiste
// d'une carte : meme slug que l'API (api/src/native/artists.js slugOf).
function artistHref(name) {
  const slug = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return slug ? "artistes.html?a=" + encodeURIComponent(slug) : "artistes.html";
}

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// Editions limitees (api/src/native/editions.js) : une "finition" posee
// par-dessus la finition classique, une par mode de jeu et par evenement.
const EDITIONS = {
  frost: { label: "Givrée", icon: "❄️" }, tropical: { label: "Tropicale", icon: "🌺" }, prism: { label: "Prismatique", icon: "🔷" },
  ember: { label: "Braise", icon: "🔥" }, glitch: { label: "Glitch", icon: "👾" },
  firework: { label: "Feu d'artifice", icon: "🎆" }, heart: { label: "Coup de cœur", icon: "💘" }, pastel: { label: "Pastel", icon: "🐣" },
  prank: { label: "Farceuse", icon: "🐟" }, solar: { label: "Solaire", icon: "☀️" }, cursed: { label: "Maudite", icon: "🎃" },
  snow: { label: "Enneigée", icon: "🎄" }, phantom: { label: "Fantôme", icon: "👻" }, forbidden: { label: "Interdite", icon: "⛓️" }
};
// Plus bel exemplaire de chaque carte d'une collection (API.getCollection,
// coffre compris) : finition (emeraude en tete), edition, etat. Sert la ou
// seule la carte est connue (vitrine du profil, images a partager), pour la
// montrer avec tout ce qu'elle a. 2026-10-26.
const CardBest = (() => {
  const FINISH_ORDER = ["normal", "holo", "gold", "ghost", "diamond", "rainbow", "emerald"], QUALITY_ORDER = ["damaged", "worn", "good", "mint"];
  const score = (v) => FINISH_ORDER.indexOf(v.finish || "normal") * 100 + (v.edition ? 10 : 0) + QUALITY_ORDER.indexOf(v.quality || "damaged");
  function of(collection) {
    const eds = (collection && collection.editionPulls) || {};
    const out = new Map();
    const add = (cardId, c, quality) => {
      const v = { finish: c.finish || "normal", quality: quality || c.quality || "damaged", edition: eds[c.pullId] || "", serial: c.serialNumber ?? null, pullId: c.pullId };
      const cur = out.get(cardId);
      if (!cur || score(v) > score(cur)) out.set(cardId, v);
    };
    ((collection && collection.owned) || []).forEach((o) => (o.copies || []).forEach((c) => add(o.cardId, c)));
    // Le coffre ne garde que des exemplaires en parfait etat.
    ((collection && collection.protectedCards) || []).forEach((o) => (o.copies || []).forEach((c) => add(o.cardId, c, "mint")));
    return out;
  }
  return { of, score, FINISH_ORDER };
})();
// Calendrier des evenements saisonniers (memes dates que api/src/native/seasonal.js) :
// calcule cote site, pour le calendrier et l'annonce du prochain evenement.
const SeasonCalendar = (() => {
  const DAY = 86400;
  // Minuit a Paris du jour 'AAAA-MM-JJ' (heure d'ete comprise).
  function parisMidnight(day) {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
    for (const h of [22, 23, 0, 1]) {
      const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) - (h >= 22 ? 1 : 0), h);
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      if (`${p.year}-${p.month}-${p.day}` === day && Number(p.hour) % 24 === 0) return Math.floor(t / 1000);
    }
    return Math.floor(Date.parse(day + "T00:00:00Z") / 1000);
  }
  function easter(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }
  const iso = (d) => d.toISOString().slice(0, 10);
  const shift = (d, n) => new Date(d.getTime() + n * DAY * 1000);
  const SEASONS = [
    { key: "newyear", label: "Nouvel an", icon: "🎆", edition: "firework", range: (y) => [`${y}-12-31`, `${y + 1}-01-02`], treat: "le feu d'artifice du jour" },
    { key: "valentine", label: "Saint-Valentin", icon: "💘", edition: "heart", range: (y) => [`${y}-02-10`, `${y}-02-15`], treat: "le billet doux du jour" },
    { key: "easter", label: "Pâques", icon: "🐣", edition: "pastel", range: (y) => { const e = easter(y); return [iso(shift(e, -3)), iso(shift(e, 1))]; }, treat: "la chasse aux œufs du jour" },
    { key: "aprilfools", label: "Poisson d'avril", icon: "🐟", edition: "prank", range: (y) => [`${y}-04-01`, `${y}-04-01`], treat: "la farce du jour (gare aux sorts !)" },
    { key: "summer", label: "Fête de la musique", icon: "🎶", edition: "solar", range: (y) => [`${y}-06-19`, `${y}-06-23`], treat: "le concert du jour" },
    { key: "halloween", label: "Halloween", icon: "🎃", edition: "cursed", range: (y) => [`${y}-10-24`, `${y}-11-01`], treat: "« Un bonbon ou un sort ? »", boss: "le Roi Citrouille" },
    { key: "christmas", label: "Noël", icon: "🎄", edition: "snow", range: (y) => [`${y}-12-18`, `${y}-12-30`], treat: "le calendrier de l'Avent (booster garanti les 24 et 25)", boss: "le Bonhomme de neige géant" }
  ];
  // Evenements pas encore termines et commencant avant horizon (epoch s), du plus proche au plus lointain.
  function upcoming(horizon = Date.now() / 1000 + 366 * DAY) {
    const now = Date.now() / 1000, y0 = new Date().getUTCFullYear(), out = [];
    for (let y = y0 - 1; y <= y0 + 1; y++) for (const s of SEASONS) {
      const [a, b] = s.range(y);
      const start = parisMidnight(a), end = parisMidnight(b) + DAY;
      if (end > now && start <= horizon) out.push({ ...s, start, end });
    }
    return out.sort((x, y) => x.start - y.start);
  }
  return { parisMidnight, upcoming };
})();

// Filtre par edition (2026-10-15) : options d'un <select> et test d'un filtre.
// "" = toutes, "any" = avec edition, "none" = sans edition, sinon une cle.
function editionFilterOptions(allLabel = "Toutes les éditions") {
  return `<option value="">${allLabel}</option><option value="any">✨ Avec une édition</option><option value="none">Sans édition</option>`
    + Object.entries(EDITIONS).map(([k, e]) => `<option value="${k}">${e.icon} ${escHtml(e.label)}</option>`).join("");
}
function editionMatches(filter, editions) {
  if (!filter) return true;
  const list = Array.isArray(editions) ? editions : [editions];
  if (filter === "any") return list.some(Boolean);
  if (filter === "none") return list.some((e) => !e);
  return list.includes(filter);
}
// Rang d'une edition pour les tris (ordre du catalogue ; sans edition en dernier).
const EDITION_RANK = Object.fromEntries(Object.keys(EDITIONS).map((k, i) => [k, i + 1]));
const editionRank = (key) => (key && EDITION_RANK[key]) || 99;

function editionBadge(key) {
  const e = EDITIONS[key];
  return e ? `<span class="edition-badge" data-edition="${key}" title="Édition limitée ${escHtml(e.label)}">${e.icon}<span class="eb-label"> ${escHtml(e.label)}</span></span>` : "";
}

const THEME_ORDER = ["default", "monochrome", "sepia", "cyberpunk"];
const THEME_LABELS = { default: "Nébuleuse (défaut)", monochrome: "Monochrome", sepia: "Sépia", cyberpunk: "Cyberpunk" };
// Valeurs par defaut (utilisees tant que loadUnlockConfig() n'a pas encore
// repondu, ou si l'admin n'a jamais touche a la config) - mutees en place
// (Object.assign, jamais reassignees) par loadUnlockConfig() une fois la
// vraie config recuperee, pour que toute reference existante (cycleTheme,
// craft.js, collection.js, trade.js) voie automatiquement la mise a jour.
const THEME_UNLOCK_LEVEL = { default: 1, monochrome: 3, sepia: 5, cyberpunk: 8 };
let knownProfileLevel = 1;

// ---------------------------------------------------------------------------
// Progression par niveaux : au-dela du simple booster bonus, les premiers
// niveaux debloquent de nouveaux systemes de jeu, un a la fois, plutot que
// de tout donner d'un coup a l'inscription (aide aussi a l'onboarding - un
// nouveau joueur n'est pas noye sous 6 pages/onglets des le premier jour).
// Decraft reste toujours disponible (c'est la porte d'entree vers Craft).
// ---------------------------------------------------------------------------
const FEATURE_UNLOCK_LEVEL = { craft: 2, trade: 3, altar: 4, quality: 4, finish: 5, showcase: 6 };
const FEATURE_LABELS = { craft: "Crafter des cartes", trade: "Les échanges", altar: "L'autel de sacrifice", quality: "La restauration de cartes usées", finish: "Les finitions (fusion de cartes)", showcase: "La vitrine de profil" };
// Pochettes de cartes (collection.html) : mêmes valeurs par défaut que les
// data-level historiquement poses en dur sur les .sleeve-swatch - centralisees
// ici pour pouvoir aussi etre pilotees par loadUnlockConfig()/l'admin.
const SLEEVE_UNLOCK_LEVEL = { default: 1, neon: 4, vintage: 6, carbone: 10 };

// Recupere les seuils de deblocage configures par l'admin (endpoint public,
// sans auth - lu sur CHAQUE page comme le bandeau du site) et les fusionne
// DANS les objets ci-dessus (jamais de reassignation) pour que toute
// verification deja ecrite ailleurs (cycleTheme, craft.js, collection.js,
// trade.js) profite automatiquement de la config a jour, sans se soucier de
// l'ordre de chargement. Echec silencieux : les valeurs par defaut ci-dessus
// restent alors en vigueur (jamais un joueur bloque a cause d'un reseau coupe).
let unlockConfigLoaded = null;
function loadUnlockConfig() {
  if (!unlockConfigLoaded) {
    unlockConfigLoaded = API.getUnlockConfig()
      .then((res) => {
        if (res.themes) Object.assign(THEME_UNLOCK_LEVEL, res.themes);
        if (res.features) Object.assign(FEATURE_UNLOCK_LEVEL, res.features);
        if (res.sleeves) Object.assign(SLEEVE_UNLOCK_LEVEL, res.sleeves);
      })
      .catch(() => {});
  }
  return unlockConfigLoaded;
}

// Toujours une requete fraiche (pas le cache de knownProfileLevel, qui peut
// etre perime/pas encore charge selon la page et l'ordre d'execution) :
// c'est un appel leger deja utilise partout (booster-status), pas cher a
// refaire au chargement d'une page qui a besoin de verifier un niveau.
async function fetchMyLevel() {
  try {
    const res = await API.getBoosterStatus(Session.userId);
    knownProfileLevel = res.xp?.level || 1;
  } catch (e) { /* reste sur la derniere valeur connue */ }
  return knownProfileLevel;
}

// Message plein-panneau reutilisable pour une page/section entiere
// verrouillee (contrairement a un simple toast, pour un onglet individuel -
// voir craft.js/collection.js).
function renderFeatureLockedMessage(container, featureKey, level) {
  const required = FEATURE_UNLOCK_LEVEL[featureKey] || 1;
  container.innerHTML = `
    <div class="empty-state feature-locked">
      &#128274; <strong>${FEATURE_LABELS[featureKey] || "Cette fonctionnalité"}</strong> se débloque au niveau ${required}.
      Tu es actuellement niveau ${level}. Continue à ouvrir des boosters, crafter et échanger pour monter de niveau !
    </div>
  `;
}

function applyTheme(theme) {
  if (theme === "default") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("2gatcha_theme", theme); } catch (e) {}
}

// Applique immediatement le theme sauvegarde, avant meme DOMContentLoaded,
// pour limiter le flash du theme par defaut au chargement.
(function initTheme() {
  try {
    const saved = localStorage.getItem("2gatcha_theme");
    if (saved && saved !== "default") document.documentElement.setAttribute("data-theme", saved);
  } catch (e) {}
})();

// Un simple bouton qui fait defiler les themes debloques (pas de picker
// dedie) : plus rapide a decouvrir, et le niveau requis est annonce des
// qu'on tombe sur un theme encore verrouille.
function cycleTheme() {
  let current = "default";
  try { current = localStorage.getItem("2gatcha_theme") || "default"; } catch (e) {}
  let idx = THEME_ORDER.indexOf(current);
  for (let i = 0; i < THEME_ORDER.length; i++) {
    idx = (idx + 1) % THEME_ORDER.length;
    const candidate = THEME_ORDER[idx];
    if (THEME_UNLOCK_LEVEL[candidate] <= knownProfileLevel) {
      applyTheme(candidate);
      Toast.info(`Thème : ${THEME_LABELS[candidate]}`);
      return;
    }
  }
  Toast.info(`Prochain thème débloqué au niveau ${Math.min(...Object.values(THEME_UNLOCK_LEVEL).filter((l) => l > knownProfileLevel))}.`);
}

// Image grise affichee quand une carte n'a pas (encore) d'image en piece jointe.
const PLACEHOLDER_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="100%" height="100%" fill="#1f2247"/><text x="50%" y="50%" fill="#a7a9c9" font-family="sans-serif" font-size="18" text-anchor="middle">Pas d\'image</text></svg>'
  );

// Session basee sur la connexion Discord, partagee entre les pages.
const Session = {
  KEY_USER_ID: "2gatcha_userId",
  KEY_PSEUDO: "2gatcha_pseudo",
  KEY_DISCORD_ID: "2gatcha_discordId",
  KEY_DISCORD_USERNAME: "2gatcha_discordUsername",
  KEY_DISCORD_AVATAR: "2gatcha_discordAvatar",
  // Jeton signe remis par l'API a la connexion Discord (envoye a chaque requete).
  KEY_TOKEN: "2gatcha_token",

  get userId() {
    return localStorage.getItem(this.KEY_USER_ID);
  },
  get pseudo() {
    return localStorage.getItem(this.KEY_PSEUDO);
  },
  get discordId() {
    return localStorage.getItem(this.KEY_DISCORD_ID);
  },
  get discordUsername() {
    return localStorage.getItem(this.KEY_DISCORD_USERNAME);
  },
  get discordAvatar() {
    return localStorage.getItem(this.KEY_DISCORD_AVATAR);
  },
  get token() {
    try { return localStorage.getItem(this.KEY_TOKEN); } catch (e) { return null; }
  },
  set(data) {
    localStorage.setItem(this.KEY_USER_ID, data.userId);
    localStorage.setItem(this.KEY_PSEUDO, data.pseudo || "");
    localStorage.setItem(this.KEY_DISCORD_ID, data.discordId || "");
    localStorage.setItem(this.KEY_DISCORD_USERNAME, data.discordUsername || "");
    localStorage.setItem(this.KEY_DISCORD_AVATAR, data.discordAvatar || "");
    if (data.token) localStorage.setItem(this.KEY_TOKEN, data.token);
  },
  setPseudo(pseudo) {
    localStorage.setItem(this.KEY_PSEUDO, pseudo);
    document.dispatchEvent(new CustomEvent("session:pseudo", { detail: pseudo }));
  },
  // Pseudo absent du stockage local (stockage partiellement vide, ancienne
  // session) : on le reprend dans la liste des joueurs au lieu d'afficher
  // « null » (2026-10-19).
  async ensurePseudo() {
    if (this.pseudo || !this.userId || typeof API === "undefined") return this.pseudo;
    try {
      const res = await API.listUsers();
      const me = (res.users || []).find((u) => String(u.userId) === String(this.userId));
      if (me && me.pseudo) this.setPseudo(me.pseudo);
    } catch (e) { /* on reessaiera a la prochaine page */ }
    return this.pseudo;
  },
  clear() {
    localStorage.removeItem(this.KEY_USER_ID);
    localStorage.removeItem(this.KEY_PSEUDO);
    localStorage.removeItem(this.KEY_DISCORD_ID);
    localStorage.removeItem(this.KEY_DISCORD_USERNAME);
    localStorage.removeItem(this.KEY_DISCORD_AVATAR);
    localStorage.removeItem(this.KEY_TOKEN);
  },
  isLoggedIn() {
    return !!this.userId;
  },
  isAdmin() {
    return (window.APP_CONFIG.adminDiscordIds || []).includes(this.discordId);
  }
};

// Preference des cinematiques (2026-10-16), propre a chaque appareil :
// 'always' (defaut) = toujours affichees ; 'first' = la premiere fois
// seulement (une fois par signature : rarete a l'ouverture, mode de jeu,
// metier, niveau du compte, ressource decouverte) ; 'never' = jamais (un
// court message les remplace). La page de test des animations passe outre.
const CinePref = {
  KEY: "2gatcha_cine_pref",
  SEEN: "2gatcha_cine_seen",
  ORDER: ["always", "first", "never"],
  LABELS: { always: "Toujours affichées", first: "Affichées la première fois", never: "Jamais affichées" },
  get() {
    try { const v = localStorage.getItem(this.KEY); return this.ORDER.includes(v) ? v : "always"; } catch (e) { return "always"; }
  },
  set(v) {
    try { localStorage.setItem(this.KEY, this.ORDER.includes(v) ? v : "always"); } catch (e) { /* stockage indisponible */ }
  },
  next() { const n = this.ORDER[(this.ORDER.indexOf(this.get()) + 1) % this.ORDER.length]; this.set(n); return n; },
  // Vrai si la cinematique doit jouer ; en mode 'first', la signature est retenue.
  allow(kind, key = "") {
    const pref = this.get();
    if (pref === "never") return false;
    if (pref === "always") return true;
    const sig = kind + ":" + key;
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem(this.SEEN) || "{}") || {}; } catch (e) { seen = {}; }
    if (seen[sig]) return false;
    seen[sig] = 1;
    try { localStorage.setItem(this.SEEN, JSON.stringify(seen)); } catch (e) { /* stockage indisponible */ }
    return true;
  },
  // Oublie les signatures d'un type (ex. "Revoir les decouvertes").
  forget(kind) {
    try {
      const seen = JSON.parse(localStorage.getItem(this.SEEN) || "{}") || {};
      Object.keys(seen).forEach((k) => { if (k.startsWith(kind + ":")) delete seen[k]; });
      localStorage.setItem(this.SEEN, JSON.stringify(seen));
    } catch (e) { /* stockage indisponible */ }
  }
};
window.CinePref = CinePref;

// ---------------------------------------------------------------------------
// Visuels modifiables (Admin > Visuels, 2026-10-18) : une image "assets/..."
// remplacee dans l'admin est substituee partout, y compris dans le HTML
// genere plus tard (observateur du DOM). Les remplacements sont gardes en
// cache local pour s'afficher des le chargement suivant.
// ---------------------------------------------------------------------------
const Visuals = {
  o: {},
  keyOf(src) {
    const i = String(src || "").indexOf("assets/");
    if (i < 0) return null;
    try { return decodeURIComponent(String(src).slice(i + 7).split("?")[0]); } catch (e) { return null; }
  },
  apply(rootEl) {
    if (!Object.keys(this.o).length) return;
    const imgs = rootEl && rootEl.tagName === "IMG" ? [rootEl] : (rootEl || document).querySelectorAll ? (rootEl || document).querySelectorAll("img") : [];
    imgs.forEach((img) => {
      if (img.dataset.novis) return;
      const key = img.dataset.vis || this.keyOf(img.getAttribute("src"));
      if (!key) return;
      const o = this.o[key];
      if (!img.dataset.vis) img.dataset.vis = key;
      const want = o && o.imageId && typeof API !== "undefined" ? API.imageUrl(o.imageId) : null;
      if (want && img.getAttribute("src") !== want) img.setAttribute("src", want);
    });
  },
  set(o) {
    this.o = o || {};
    try { localStorage.setItem("2gatcha_visuals", JSON.stringify(this.o)); } catch (e) { /* stockage indisponible */ }
    this.apply(document);
  },
  init() {
    try { this.o = JSON.parse(localStorage.getItem("2gatcha_visuals") || "{}") || {}; } catch (e) { this.o = {}; }
    const watch = () => {
      this.apply(document);
      new MutationObserver((muts) => { if (!Object.keys(this.o).length) return; muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) this.apply(n); })); }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) watch(); else document.addEventListener("DOMContentLoaded", watch);
    if (typeof API !== "undefined" && API.visuals) API.visuals().then((r) => this.set(r.overrides)).catch(() => {});
  }
};
Visuals.init();

// ---------------------------------------------------------------------------
// Images de cartes (2026-10-20) : un fond "chargement" teinte par la rarete
// (refonte.css) tant que l'illustration n'est pas arrivee ; la classe
// is-loaded le retire. Ecoute en phase de capture (load ne remonte pas).
// ---------------------------------------------------------------------------
(function () {
  const SEL = ".card-art img, .album-slot img, .mu-item img";
  const done = (e) => { const t = e.target; if (t && t.tagName === "IMG" && t.closest(SEL.replace(/ img/g, ""))) t.classList.add("is-loaded"); };
  document.addEventListener("load", done, true);
  document.addEventListener("error", done, true);
})();

// ---------------------------------------------------------------------------
// Confettis (2026-10-21) : la bibliotheque est chargee en defer ; ses tirs
// passent par un seul canevas anime dans un worker (le fil principal reste
// libre pendant les cinematiques) et sont reduits sur mobile ou en effets
// alleges (html[data-fx="light"], shell.js FxLevel).
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const lib = window.confetti;
  if (typeof lib !== "function" || !lib.create) return;
  let shoot = null, canvas = null;
  const wrapped = (opts = {}) => {
    if (!shoot) {
      canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none";
      document.body.appendChild(canvas);
      try { shoot = lib.create(canvas, { resize: true, useWorker: true, disableForReducedMotion: true }); } catch (e) { canvas.remove(); shoot = lib; }
    }
    const light = document.documentElement.dataset.fx === "light";
    const coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    const k = light ? 0.35 : coarse ? 0.6 : 1;
    const o = Object.assign({}, opts, { particleCount: Math.max(12, Math.round((opts.particleCount || 50) * k)) });
    if (canvas && shoot !== lib) canvas.style.zIndex = String(o.zIndex || 100);
    return shoot(o);
  };
  wrapped.reset = () => shoot && shoot.reset && shoot.reset();
  wrapped.create = lib.create;
  window.confetti = wrapped;
});
