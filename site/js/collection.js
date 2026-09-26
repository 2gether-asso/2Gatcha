// Logique de la page collection.
// Contrat attendu du webhook n8n "collection" (GET ?userId=...):
// {
//   "cards": [ { cardId, name, artist, imageId,
//                rarity: { id, name, key, colorHex, sortOrder },
//                extension: { id, name, key, sortOrder } | null, isPromo } ],
//   "owned": [ { cardId, count, lastObtainedAt } ],
//   "stats": { "owned": 12, "total": 40 }
// }

const NEW_BADGE_WINDOW_SECONDS = 24 * 3600;
const FAVORITES_KEY = "2gatcha_favorites";

// Echelle de finitions (voir grist/SCHEMA.md, meme ordre que foil-upgrade.json
// et craft.js). Une vignette affiche toujours la MEILLEURE finition possedee
// pour cette carte (un collectionneur montre sa plus belle version).
const FINISH_ORDER = ["normal", "holo", "gold", "ghost", "diamond", "rainbow"];
const FINISH_LABELS = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
const QUALITY_ORDER = ["damaged", "worn", "good", "mint"];
const QUALITY_LABELS = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };
// Pochettes de cartes (sleeves) : verrouillees/deverrouillees selon le
// niveau de profil (Users.XP). Si la pochette choisie precedemment devient
// injoignable (ne devrait pas arriver, le niveau ne redescend jamais), on
// revient silencieusement au style par defaut plutot que de rester bloque
// sur un etat incoherent.
function refreshSleeveLocks(level) {
  const prefs = loadPrefs();
  let currentIsLocked = false;
  document.querySelectorAll(".sleeve-swatch").forEach((sw) => {
    const required = Number(sw.dataset.level) || 1;
    const locked = level < required;
    sw.classList.toggle("locked", locked);
    sw.title = locked ? `Débloqué au niveau ${required}` : "";
    if (locked && sw.dataset.sleeve === (prefs.sleeve || "")) currentIsLocked = true;
  });
  if (currentIsLocked) {
    delete document.body.dataset.sleeve;
    savePrefs({ sleeve: "" });
    document.querySelectorAll(".sleeve-swatch").forEach((s) => s.classList.toggle("active", !s.dataset.sleeve));
  }
}

// Applique la couleur d'accent choisie a --accent/--accent-2 (au lieu d'une
// variable a part que presque rien n'utilisait) : boutons actifs, barre de
// progression, halos au survol suivent tous var(--accent) deja partout dans
// la feuille de style, donc le changement se voit vraiment.
function applyBinderAccent(hex) {
  if (hex) {
    document.documentElement.style.setProperty("--accent", hex);
    document.documentElement.style.setProperty("--accent-2", lightenColor(hex, 0.35));
  } else {
    document.documentElement.style.removeProperty("--accent");
    document.documentElement.style.removeProperty("--accent-2");
  }
}

// Regroupe les exemplaires possedes d'une carte par VARIANTE EXACTE
// (finition + qualite) : une meme carte peut desormais afficher plusieurs
// vignettes distinctes au lieu d'une seule vignette agregee "meilleure
// finition / pire qualite" - necessaire pour que le decraft (voir
// disenchantCardQuick) cible precisement la bonne vignette au lieu de
// risquer de consommer une variante differente de celle affichee.
// Triees du MOINS prestigieux au PLUS prestigieux (meme ordre que le
// decraft automatique cote n8n quand aucune variante n'est precisee) : la
// 1ere vignette d'une carte est toujours celle qui partirait en premier.
function buildVariants(owned) {
  if (!owned || !owned.copies || !owned.copies.length) return [];
  const map = new Map();
  owned.copies.forEach((c) => {
    const finish = c.finish || "normal";
    const quality = c.quality || "damaged";
    const key = finish + "::" + quality;
    if (!map.has(key)) map.set(key, { finish, quality, count: 0, serialNumbers: [] });
    const v = map.get(key);
    v.count++;
    if (c.serialNumber != null) v.serialNumbers.push(c.serialNumber);
  });
  return [...map.values()].sort((a, b) =>
    (FINISH_ORDER.indexOf(a.finish) - FINISH_ORDER.indexOf(b.finish)) ||
    (QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality))
  );
}

// Messages d'erreur dupliques depuis craft.js/trade.js (meme convention que
// les branches n8n paralleles du projet : duplication ciblee plutot qu'un
// import partage, pour garder chaque page autonome).
const DISENCHANT_ERRORS_LOCAL = {
  card_not_found: "Carte introuvable.",
  promo_not_disenchantable: "Cette carte promo ne peut pas etre decraftee.",
  card_not_owned: "Tu ne possèdes pas cette carte."
};
const CRAFT_ERRORS_LOCAL = {
  card_not_found: "Carte introuvable.",
  promo_not_craftable: "Cette carte promo ne peut pas etre craftee.",
  card_inactive: "Cette carte n'est plus disponible.",
  insufficient_dust: "Pas assez de poussières d'etoile."
};
const TRADE_ERRORS_LOCAL = {
  user_not_found: "Aucun joueur ne porte ce pseudo.",
  cannot_trade_self: "Tu ne peux pas t'echanger une carte avec toi-meme.",
  card_not_owned: "Tu ne possèdes pas cette carte.",
  promo_not_tradeable: "Les cartes promo ne sont pas echangeables."
};

const COLLAPSED_EXT_KEY = "2gatcha_collapsed_extensions";
function loadCollapsedExtensions() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_EXT_KEY) || "[]")); }
  catch (e) { return new Set(); }
}
function saveCollapsedExtensions(set) {
  try { localStorage.setItem(COLLAPSED_EXT_KEY, JSON.stringify([...set])); } catch (e) {}
}
let collapsedExtensions = loadCollapsedExtensions();

const PREFS_KEY = "2gatcha_collection_prefs";
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); }
  catch (e) { return {}; }
}
function savePrefs(patch) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch })); } catch (e) {}
}
const prefs = loadPrefs();

let allCardsCache = [];
let ownedMap = new Map();
let craftCostByCard = new Map();
// { finishKey: multiplier } / { qualityKey: multiplier }, renvoyes par
// get-cards.json - necessaires pour afficher un montant de decraft CORRECT
// avant meme de cliquer (bouton/tooltip/confirmation), le vrai montant
// applique par disenchant.json etant TOUJOURS la valeur de base de la
// rarete multipliee par ces deux facteurs, jamais juste la valeur de base.
let finishMultipliers = {};
let qualityMultipliers = {};
function estimateDust(baseValue, finish, quality) {
  const fm = finishMultipliers[finish] != null ? finishMultipliers[finish] : 1;
  const qm = qualityMultipliers[quality] != null ? qualityMultipliers[quality] : 1;
  return Math.round((baseValue || 0) * fm * qm);
}
let stardustBalance = 0;
// Wishlist : cote serveur (visible sur le profil public, contrairement aux
// favoris qui restent purement locaux) - un Set d'ids pour verifier
// rapidement l'etat au rendu, tenu a jour de maniere optimiste apres chaque
// action (pas besoin d'attendre un aller-retour serveur pour se mettre a jour).
let wishlistSet = new Set();
// Vitrine (max 5 cartes possedees, affichees sur le profil public) et,
// pour chaque carte, la liste de ses exemplaires individuels (pullId +
// numero de serie) - necessaire pour choisir precisement quel exemplaire
// offrir dans l'echange rapide (openQuickTrade).
let showcaseSet = new Set();
let ownedCopiesByCard = new Map();
let currentPlayerLevel = 1;
let activeFilter = "all";
let searchQuery = "";
// Tri/vue memorises d'une visite a l'autre : pas de raison de refaire le
// meme reglage a chaque fois qu'on revient sur la page.
let sortMode = prefs.sortMode || "extension";
let missingOnly = !!prefs.missingOnly;
let favoritesOnly = false;
let artistFilter = "";
// Selection multiple pour decrafter en masse (meme pattern que craft.js) :
// un Set d'ids de cartes, actif seulement quand bulkSelectMode est vrai.
let bulkSelectMode = false;
let bulkSelected = new Set();

// Favoris : purement locaux (par appareil), pas de backend necessaire.
function loadFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]")); }
  catch (e) { return new Set(); }
}
function saveFavorites(set) {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set])); } catch (e) {}
}
let favorites = loadFavorites();

// "Vues" : independant de la fenetre de 24h du badge New, pour pouvoir les
// effacer explicitement d'un coup ("Tout marquer comme vu") sans attendre.
const SEEN_KEY = "2gatcha_seen_cards";
function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); }
  catch (e) { return new Set(); }
}
function saveSeen(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set])); } catch (e) {}
}
let seenCards = loadSeen();

function normalize(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function renderFilters(rarities) {
  const el = document.getElementById("rarity-filters");
  const items = [{ key: "all", name: "Toutes" }, ...rarities];
  const buttons = items.map(({ key, name }) => {
    return `<button data-filter="${key}" class="btn-secondary ${key === activeFilter ? "active" : ""}">${name}</button>`;
  });
  el.innerHTML = buttons.join("");

  el.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      renderGrid();
      el.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

// Effet de bascule 3D qui suit le curseur ou le doigt. Pose aussi --shine-x/
// --shine-y (position brute du curseur, en %) : utilise par les finitions
// holo/diamant/arc-en-ciel pour un reflet qui suit reellement la souris,
// pas juste l'inclinaison de la carte.
function attachTilt(el) {
  const update = (clientX, clientY) => {
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width - 0.5;
    const py = (clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--ry", `${px * 16}deg`);
    el.style.setProperty("--rx", `${py * -16}deg`);
    el.style.setProperty("--shine-x", `${(px + 0.5) * 100}%`);
    el.style.setProperty("--shine-y", `${(py + 0.5) * 100}%`);
  };
  const reset = () => {
    el.style.setProperty("--rx", `0deg`);
    el.style.setProperty("--ry", `0deg`);
    el.style.setProperty("--shine-x", `50%`);
    el.style.setProperty("--shine-y", `50%`);
    el.style.willChange = "auto";
  };
  // will-change seulement pendant l'interaction : le poser en permanence en
  // CSS sur toute la grille forcerait un calque GPU par carte (saccades sur
  // une grande collection).
  el.addEventListener("mouseenter", () => { el.style.willChange = "transform"; });
  el.addEventListener("mousemove", (e) => update(e.clientX, e.clientY));
  el.addEventListener("mouseleave", reset);
  // Pas de suivi tactile : sur mobile, chaque touchmove pendant un simple
  // scroll de la grille declenchait un recalcul de style par carte survolee
  // par le doigt, ce qui causait le lag observe sur portable.
}

// navList = tableau ordonne de cles de navigation ("cardId::finish::quality"
// pour une variante possedee, "cardId::" pour une carte non possedee)
// actuellement affichees dans l'ordre visible de la grille : permet de
// naviguer a la vignette precedente/suivante sans fermer la modale, au
// clavier (fleches) ou au doigt (swipe).
function parseNavKey(navKey) {
  const [cardIdStr, finish, quality] = navKey.split("::");
  return { cardId: Number(cardIdStr), finish: finish || null, quality: quality || null };
}
function copiesForVariant(owned, finish, quality) {
  return (owned?.copies || []).filter((c) => (c.finish || "normal") === finish && (c.quality || "damaged") === quality);
}
function showCardModal(navKey, navList) {
  const overlay = document.createElement("div");
  overlay.className = "card-modal-overlay";
  document.body.appendChild(overlay);

  let index = Math.max(0, navList.indexOf(navKey));

  function renderAt(newIndex, direction) {
    index = newIndex;
    const { cardId, finish: variantFinish, quality: variantQuality } = parseNavKey(navList[index]);
    const card = allCardsCache.find((c) => c.cardId === cardId);
    if (!card) return;
    const owned = ownedMap.get(card.cardId);
    const variantCopies = owned ? copiesForVariant(owned, variantFinish || "normal", variantQuality || "damaged") : [];
    const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
    const color = card.rarity?.colorHex || "#9aa0b4";
    // Actions rapides aussi ici : en vue dense, les boutons ne tiennent pas
    // sur la vignette (voir .collection-grid.dense), la modale reste donc le
    // seul chemin pour agir sur une carte dans ce mode.
    const disenchantValue = craftCostByCard.get(card.cardId)?.disenchantValue;
    const isFirstObtainer = card.firstObtainedBy && card.firstObtainedBy === Session.pseudo;
    const finish = owned ? (variantFinish || "normal") : "normal";
    const quality = owned ? (variantQuality || "damaged") : "mint";
    const serials = variantCopies.map((c) => c.serialNumber).filter((n) => n != null).sort((a, b) => a - b);
    overlay.innerHTML = `
      <div class="card-modal ${direction ? "slide-" + direction : ""}" data-rarity="${card.rarity?.key || "commune"}" data-finish="${finish}" data-quality="${quality}">
        <button class="card-modal-close" aria-label="Fermer">&times;</button>
        <div class="card-art">
          <img src="${imgSrc}" alt="${card.name}" />
          ${navList.length > 1 ? `<span class="card-modal-position">${index + 1} / ${navList.length}</span>` : ""}
          ${navList.length > 1 ? `<button class="card-modal-nav prev" aria-label="Carte precedente">&#10094;</button>` : ""}
          ${navList.length > 1 ? `<button class="card-modal-nav next" aria-label="Carte suivante">&#10095;</button>` : ""}
        </div>
        <div class="card-modal-body">
          <div class="card-modal-name">${card.name}${card.isPromo ? '<span class="promo-badge">Promo</span>' : ""}</div>
          <div class="card-modal-artist">${card.artist || ""}${card.extension ? " &middot; " + card.extension.name : ""}</div>
          <div class="card-modal-badges">
            <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">
              ${card.rarity?.name || "Commune"}
            </span>
            ${owned && finish !== "normal" ? `<span class="finish-indicator" data-finish="${finish}" style="position:static;">${FINISH_LABELS[finish]}</span>` : ""}
            ${owned && quality !== "mint" ? `<span class="quality-indicator" data-quality="${quality}" style="position:static;">${QUALITY_LABELS[quality]}</span>` : ""}
          </div>
          ${owned ? `
            <div class="card-modal-stats">
              <span>Possédée &times;${variantCopies.length}</span>
              ${serials.length ? `<span>${serials.map((n) => `#${String(n).padStart(3, "0")}`).join(", ")} / ${card.maxSerial || 100}</span>` : ""}
            </div>
          ` : ""}
          ${card.description ? `<p class="card-modal-description">${card.description}</p>` : ""}
          ${card.firstObtainedBy ? `
            <div class="first-obtainer-badge">
              &#127942; ${isFirstObtainer ? "C'est toi qui as" : `<strong>${card.firstObtainedBy}</strong> a`} obtenu cette carte en premier sur le serveur !
            </div>
          ` : ""}
          ${!card.isPromo ? `
            <div class="card-modal-actions">
              ${disenchantValue != null ? `<button type="button" class="btn-ghost modal-disenchant-btn">&#9851; Décrafter (+${estimateDust(disenchantValue, finish, quality)})</button>` : ""}
              <button type="button" class="btn-secondary modal-trade-btn">&#8644; Échanger</button>
            </div>
          ` : ""}
        </div>
      </div>
    `;
    overlay.querySelector(".card-modal-close").addEventListener("click", close);
    const prevBtn = overlay.querySelector(".card-modal-nav.prev");
    const nextBtn = overlay.querySelector(".card-modal-nav.next");
    if (prevBtn) prevBtn.addEventListener("click", () => go(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => go(1));
    const modalDisenchantBtn = overlay.querySelector(".modal-disenchant-btn");
    if (modalDisenchantBtn) modalDisenchantBtn.addEventListener("click", () => { close(); disenchantCardQuick(card.cardId, finish, quality); });
    const modalTradeBtn = overlay.querySelector(".modal-trade-btn");
    if (modalTradeBtn) modalTradeBtn.addEventListener("click", () => { close(); openQuickTrade(card.cardId); });
    if (finish !== "normal") attachTilt(overlay.querySelector(".card-modal"));
  }

  function go(delta) {
    const next = (index + delta + navList.length) % navList.length;
    renderAt(next, delta > 0 ? "left" : "right");
  }

  function close() { overlay.remove(); syncScrollLock(); document.removeEventListener("keydown", onKey); }
  // Echap est deja gere globalement par main.js (qui retire directement
  // l'overlay du DOM sans passer par close() ici) : ne pas le regerer ici
  // eviterait un double-handling, mais il faut quand meme nettoyer ce
  // listener flechage si la fermeture arrive par ce chemin-la plutot que
  // par close() - d'ou la verification de presence dans le DOM a chaque
  // frappe, qui s'auto-desinscrit si l'overlay a deja disparu.
  function onKey(e) {
    if (!document.body.contains(overlay)) { document.removeEventListener("keydown", onKey); return; }
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);

  // Swipe tactile.
  let touchStartX = null;
  overlay.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  overlay.addEventListener("touchend", (e) => {
    if (touchStartX == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    touchStartX = null;
  }, { passive: true });

  renderAt(index, null);
  syncScrollLock();
}

function renderRarityProgress() {
  const el = document.getElementById("rarity-progress");
  if (!el) return;
  const byRarity = new Map();
  allCardsCache.forEach((c) => {
    const key = c.rarity?.key || "commune";
    if (!byRarity.has(key)) {
      byRarity.set(key, { name: c.rarity?.name || key, colorHex: c.rarity?.colorHex || "#9aa0b4", sortOrder: c.rarity?.sortOrder || 0, total: 0, owned: 0 });
    }
    const entry = byRarity.get(key);
    entry.total++;
    if (ownedMap.has(c.cardId)) entry.owned++;
  });
  const rows = [...byRarity.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  el.innerHTML = rows.map((r) => {
    const pct = r.total ? Math.round((r.owned / r.total) * 100) : 0;
    return `
      <div class="rarity-progress-row">
        <span class="rp-label" style="color:${r.colorHex};">${r.name}</span>
        <span class="rp-track"><span class="rp-fill" style="width:${pct}%;background:${r.colorHex};"></span></span>
        <span class="rp-count">${r.owned}/${r.total}</span>
      </div>
    `;
  }).join("");
}

// Renvoie un TABLEAU de vignettes HTML : une seule vignette verrouillee pour
// une carte non possedee, sinon UNE VIGNETTE PAR VARIANTE (finition+qualite)
// reellement possedee (voir buildVariants) - une meme carte peut donc
// apparaitre plusieurs fois dans la grille si elle existe en plusieurs
// variantes distinctes, chacune avec son propre compteur xN et ses propres
// actions rapides (le decraft d'une vignette cible EXACTEMENT sa variante).
function cardTileHtml(card, now) {
  const owned = ownedMap.get(card.cardId);
  const color = card.rarity?.colorHex || "#9aa0b4";
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  const info = craftCostByCard.get(card.cardId);
  const craftCost = info?.craftCost;
  const disenchantValue = info?.disenchantValue;

  if (!owned) {
    // Carte manquante mais a portee de poussieres : le signaler directement
    // sur la vignette, avec une action de craft immediate (plus besoin de
    // changer de page pour la carte la plus courante : combler un trou de
    // collection depuis la collection elle-meme).
    const craftable = !card.isPromo && craftCost != null && stardustBalance >= craftCost;
    const inWishlist = wishlistSet.has(card.cardId);
    return [`
      <div class="collection-card locked" data-rarity="${card.rarity?.key || "commune"}" data-card-id="${card.cardId}" data-promo="0">
        <button type="button" class="wishlist-btn ${inWishlist ? "active" : ""}" data-wishlist-id="${card.cardId}" title="${inWishlist ? "Retirer de ma wishlist" : "Ajouter a ma wishlist"}" aria-label="${inWishlist ? "Retirer de ma wishlist" : "Ajouter a ma wishlist"}">&#9733;</button>
        <div class="card-art">
          <img src="${imgSrc}" alt="Carte non découverte" loading="lazy" />
        </div>
        <div class="card-info">
          <div class="card-name">???</div>
          <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">
            ${rarityIcon(card.rarity?.key)} ${card.rarity?.name || "Commune"}
          </span>
          ${craftable ? `<button type="button" class="card-quick-action quick-craft-btn" data-card-id="${card.cardId}">&#10024; Crafter (${craftCost})</button>` : ""}
        </div>
      </div>
    `];
  }

  const isFav = favorites.has(card.cardId);
  const inShowcase = showcaseSet.has(card.cardId);
  const canQuickAct = !card.isPromo;
  const bulkEligible = canQuickAct && disenchantValue != null;
  const isNew = !!(owned.lastObtainedAt && (now - owned.lastObtainedAt) < NEW_BADGE_WINDOW_SECONDS && !seenCards.has(card.cardId));
  const variants = buildVariants(owned);

  return variants.map((variant, i) => {
    const { finish, quality, count } = variant;
    const navKey = `${card.cardId}::${finish}::${quality}`;
    const bulkChecked = bulkEligible && bulkSelected.has(navKey);
    return `
      <div class="collection-card ${bulkSelectMode && bulkEligible ? "bulk-mode" : ""} ${bulkChecked ? "selected" : ""}" data-rarity="${card.rarity?.key || "commune"}" data-card-id="${card.cardId}" data-nav-key="${navKey}" data-promo="${card.isPromo ? "1" : "0"}" data-finish="${finish}" data-quality="${quality}" tabindex="0" role="button" aria-label="Voir la carte ${card.name.replace(/"/g, "&quot;")}">
        ${isNew && i === 0 ? '<span class="new-badge">New</span>' : ""}
        ${bulkSelectMode && bulkEligible ? `<label class="bulk-checkbox"><input type="checkbox" data-bulk-key="${navKey}" ${bulkChecked ? "checked" : ""} /></label>` : ""}
        ${!(bulkSelectMode && bulkEligible) ? `<button type="button" class="fav-btn ${isFav ? "active" : ""}" data-fav-id="${card.cardId}" title="Favori" aria-label="Marquer comme favori">&#9733;</button>` : ""}
        <div class="card-art">
          <img src="${imgSrc}" alt="${card.name}" loading="lazy" />
          ${finish !== "normal" ? `<span class="finish-indicator" data-finish="${finish}">${FINISH_LABELS[finish]}</span>` : ""}
          ${quality !== "mint" ? `<span class="quality-indicator" data-quality="${quality}">${QUALITY_LABELS[quality]}</span>` : ""}
        </div>
        <div class="card-info">
          <div class="card-name">${card.name}${card.isPromo ? '<span class="promo-badge">Promo</span>' : ""}</div>
          <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">
            ${rarityIcon(card.rarity?.key)} ${card.rarity?.name || "Commune"}
          </span>
          <div class="count-badge">x${count}</div>
          ${canQuickAct ? `
            <div class="quick-actions-row">
              ${disenchantValue != null ? `<button type="button" class="card-quick-action quick-disenchant-btn" data-card-id="${card.cardId}" data-finish="${finish}" data-quality="${quality}" title="Décrafter contre ${estimateDust(disenchantValue, finish, quality)} poussières" aria-label="Décrafter">&#9851;</button>` : ""}
              <button type="button" class="card-quick-action quick-trade-btn" data-card-id="${card.cardId}" title="Proposer un échange" aria-label="Proposer un échange">&#8644;</button>
              <button type="button" class="card-quick-action quick-showcase-btn ${inShowcase ? "active" : ""}" data-card-id="${card.cardId}" title="${inShowcase ? "Retirer de ma vitrine" : "Ajouter a ma vitrine"}" aria-label="${inShowcase ? "Retirer de ma vitrine" : "Ajouter a ma vitrine"}">&#128444;</button>
            </div>
          ` : ""}
        </div>
      </div>
    `;
  });
}

// Actions rapides directement depuis la collection : eviter d'avoir a
// changer de page pour un craft/decraft/echange ponctuel. Mettent a jour
// l'etat local (ownedMap/stardustBalance) et re-rendent juste la grille,
// plutot qu'un rechargement complet de la page.
async function craftCardQuick(cardId) {
  const card = allCardsCache.find((c) => c.cardId === cardId);
  const info = craftCostByCard.get(cardId);
  const cost = info?.craftCost || 0;
  const ok = await Confirm.show(
    `Crafter <strong>${card?.name || "cette carte"}</strong> pour <strong>${cost} poussières d'étoile</strong> ? ` +
    `Solde : ${stardustBalance} &rarr; <strong>${stardustBalance - cost}</strong>.`,
    { title: "Crafter cette carte ?", confirmText: "Crafter" }
  );
  if (!ok) return;
  try {
    const res = await API.craftCard(Session.userId, cardId);
    Toast.success(`${res.card.name} craftee !`);
    if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
    stardustBalance = res.newStardust ?? (stardustBalance - cost);
    const existing = ownedMap.get(cardId);
    if (existing) existing.count++;
    else ownedMap.set(cardId, { cardId, count: 1, lastObtainedAt: Math.floor(Date.now() / 1000) });
    renderStatsAndMilestone();
    renderGrid();
  } catch (e) {
    Toast.error(CRAFT_ERRORS_LOCAL[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

// finish/quality (optionnels) : precisent EXACTEMENT quelle variante
// decrafter (vignette cliquee), pour ne jamais consommer une variante
// differente de celle affichee - voir disenchant.json "Validate & Prepare".
// Sans ces parametres (appel depuis un contexte ne connaissant pas la
// variante), le backend retombe sur son choix par defaut (le moins
// prestigieux en premier).
async function disenchantCardQuick(cardId, finish, quality, btn) {
  const card = allCardsCache.find((c) => c.cardId === cardId);
  const info = craftCostByCard.get(cardId);
  const dust = estimateDust(info?.disenchantValue || 0, finish || "normal", quality || "damaged");
  const variantLabel = finish && finish !== "normal" ? ` (${FINISH_LABELS[finish]}${quality && quality !== "mint" ? ", " + QUALITY_LABELS[quality] : ""})` : "";
  const ok = await Confirm.show(
    `Décrafter <strong>${card?.name || "cette carte"}${variantLabel}</strong> contre <strong>${dust} poussières d'étoile</strong> ? ` +
    `Cette action est irréversible : l'exemplaire sera définitivement détruit.`,
    { title: "Décrafter cette carte ?", confirmText: "Décrafter", dangerous: true }
  );
  if (!ok) return;
  try {
    const res = await API.disenchantCard(Session.userId, cardId, finish, quality);
    Toast.success(`+${res.dustGained} poussières (${res.cardName})`);
    await playDustDissolve(btn ? btn.closest(".collection-card") : null);
    stardustBalance = res.newStardust ?? (stardustBalance + dust);
    const owned = ownedMap.get(cardId);
    if (owned) {
      const consumedFinish = res.finish || finish || "normal";
      const consumedQuality = res.quality || quality || "damaged";
      const copies = owned.copies || [];
      const idx = copies.findIndex((c) => (c.finish || "normal") === consumedFinish && (c.quality || "damaged") === consumedQuality);
      if (idx !== -1) copies.splice(idx, 1);
      if (owned.count > 1) owned.count--;
      else ownedMap.delete(cardId);
    }
    renderStatsAndMilestone();
    renderGrid();
  } catch (e) {
    Toast.error(DISENCHANT_ERRORS_LOCAL[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

async function openQuickTrade(cardId) {
  const card = allCardsCache.find((c) => c.cardId === cardId);
  if (!card) return;
  let usersRes;
  try {
    usersRes = await API.listUsers();
  } catch (e) {
    Toast.error("Impossible de charger la liste des joueurs.");
    return;
  }
  const others = (usersRes.users || []).filter((u) => String(u.userId) !== String(Session.userId));
  if (!others.length) { Toast.info("Aucun autre joueur a qui proposer un échange pour l'instant."); return; }

  const copies = ownedCopiesByCard.get(cardId) || [];
  const maxSerial = allCardsCache.find((c) => c.cardId === cardId)?.maxSerial || 100;
  const pullOptions = copies
    .map((c) => `<option value="${c.pullId}">${c.serialNumber != null ? "#" + String(c.serialNumber).padStart(3, "0") : "?"} / ${maxSerial}</option>`)
    .join("");

  const overlay = document.createElement("div");
  overlay.className = "card-modal-overlay confirm-overlay";
  overlay.innerHTML = `
    <div class="confirm-box quick-trade-box">
      <div class="confirm-title">Échanger ${card.name}</div>
      <div class="quick-trade-form">
        <label>Exemplaire a donner
          <select id="qt-pull">${pullOptions || `<option value="">Aucun exemplaire</option>`}</select>
        </label>
        <label>À qui ?
          <select id="qt-target"></select>
        </label>
        <label>Contre quelle carte ? (optionnel)
          <select id="qt-requested"><option value="">Choisis d'abord un joueur cible</option></select>
        </label>
      </div>
      <div class="confirm-actions">
        <button type="button" class="btn-ghost qt-cancel">Annuler</button>
        <button type="button" class="qt-submit">Proposer l'échange</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  syncScrollLock();

  const pullSelect = overlay.querySelector("#qt-pull");
  const targetSelect = overlay.querySelector("#qt-target");
  targetSelect.innerHTML = others.map((u) => `<option value="${u.pseudo}">${u.pseudo}</option>`).join("");
  const requestedSelect = overlay.querySelector("#qt-requested");

  // La carte demandee ne peut porter que sur ce que la cible possede
  // reellement (meme regle que le formulaire d'echange complet).
  async function refreshRequestedOptions() {
    const pseudo = targetSelect.value;
    if (!pseudo) { requestedSelect.innerHTML = `<option value="">Choisis d'abord un joueur cible</option>`; if (requestedSelect._fancyRefresh) requestedSelect._fancyRefresh(); return; }
    requestedSelect.innerHTML = `<option value="">Chargement...</option>`;
    if (requestedSelect._fancyRefresh) requestedSelect._fancyRefresh();
    try {
      const profile = await API.getPublicProfile(pseudo);
      const options = (profile.cards || []).filter((c) => !c.isPromo);
      requestedSelect.innerHTML = `<option value="">Aucune (don)</option>` + options.map((c) => `<option value="${c.cardId}">${c.name} (x${c.count})</option>`).join("");
    } catch (e) {
      requestedSelect.innerHTML = `<option value="">Aucune (don)</option>`;
    }
    if (requestedSelect._fancyRefresh) requestedSelect._fancyRefresh();
  }
  targetSelect.addEventListener("change", refreshRequestedOptions);
  refreshRequestedOptions();

  enhanceSelect(pullSelect);
  enhanceSelect(targetSelect);
  enhanceSelect(requestedSelect);

  function close() { overlay.remove(); syncScrollLock(); }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".qt-cancel").addEventListener("click", close);
  overlay.querySelector(".qt-submit").addEventListener("click", async () => {
    const toPseudo = targetSelect.value;
    const offeredPullId = Number(pullSelect.value);
    const requestedCardId = requestedSelect.value ? Number(requestedSelect.value) : null;
    if (!offeredPullId) { Toast.error("Aucun exemplaire disponible a offrir."); return; }
    try {
      await API.createTrade(Session.userId, toPseudo, cardId, offeredPullId, requestedCardId);
      Toast.success(`Échange proposé à ${toPseudo}.`);
      close();
    } catch (e) {
      Toast.error(TRADE_ERRORS_LOCAL[e.code] || ("Erreur. (" + e.message + ")"));
    }
  });
}

// Mise a jour optimiste (pas besoin d'attendre/faire confiance a la liste
// renvoyee par add/remove, qui reflete l'etat AVANT l'action cote workflow -
// le bouton et le Set local sont la seule source de verite immediate).
async function toggleWishlist(cardId, btn) {
  const wasIn = wishlistSet.has(cardId);
  try {
    if (wasIn) {
      await API.removeFromWishlist(Session.userId, cardId);
      wishlistSet.delete(cardId);
      Toast.info("Retiree de ta wishlist.");
    } else {
      await API.addToWishlist(Session.userId, cardId);
      wishlistSet.add(cardId);
      Toast.success("Ajoutee a ta wishlist !");
    }
    btn.classList.toggle("active", !wasIn);
    btn.title = !wasIn ? "Retirer de ma wishlist" : "Ajouter a ma wishlist";
    btn.setAttribute("aria-label", btn.title);
  } catch (e) {
    Toast.error("Erreur. (" + e.message + ")");
  }
}

const SHOWCASE_ERRORS_LOCAL = {
  card_not_owned: "Tu ne possèdes pas cette carte.",
  showcase_full: "Ta vitrine est déjà pleine (5 cartes max) : retire-en une avant d'en ajouter une nouvelle."
};

async function toggleShowcase(cardId, btn) {
  if (currentPlayerLevel < FEATURE_UNLOCK_LEVEL.showcase) {
    Toast.info(`${FEATURE_LABELS.showcase} se débloque au niveau ${FEATURE_UNLOCK_LEVEL.showcase} (tu es niveau ${currentPlayerLevel}).`);
    return;
  }
  const wasIn = showcaseSet.has(cardId);
  try {
    if (wasIn) {
      await API.removeFromShowcase(Session.userId, cardId);
      showcaseSet.delete(cardId);
      Toast.info("Retiree de ta vitrine.");
    } else {
      await API.addToShowcase(Session.userId, cardId);
      showcaseSet.add(cardId);
      Toast.success("Ajoutee a ta vitrine !");
    }
    btn.classList.toggle("active", !wasIn);
    btn.title = !wasIn ? "Retirer de ma vitrine" : "Ajouter a ma vitrine";
    btn.setAttribute("aria-label", btn.title);
  } catch (e) {
    Toast.error(SHOWCASE_ERRORS_LOCAL[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

function renderStatsAndMilestone() {
  const statsEl = document.getElementById("stats-grid");
  const milestoneEl = document.getElementById("milestone-banner");
  if (!statsEl) return;

  let totalCopies = 0;
  let bestRarity = null;
  const byRarity = new Map();
  allCardsCache.forEach((c) => {
    const key = c.rarity?.key || "commune";
    if (!byRarity.has(key)) {
      byRarity.set(key, { name: c.rarity?.name || key, colorHex: c.rarity?.colorHex || "#9aa0b4", sortOrder: c.rarity?.sortOrder || 0, total: 0, owned: 0 });
    }
    const entry = byRarity.get(key);
    entry.total++;
    const owned = ownedMap.get(c.cardId);
    if (owned) {
      entry.owned++;
      totalCopies += owned.count;
      if (!bestRarity || (c.rarity?.sortOrder || 0) > bestRarity.sortOrder) {
        bestRarity = { name: c.rarity?.name || "Commune", sortOrder: c.rarity?.sortOrder || 0, colorHex: c.rarity?.colorHex || "#9aa0b4" };
      }
    }
  });

  const legendaryEntry = [...byRarity.values()].find((r) => r.name && normalize(r.name) === "legendaire");
  const legendaryShare = totalCopies && legendaryEntry ? Math.round((legendaryEntry.owned / totalCopies) * 100) : 0;

  // Halo ambiant du panel (voir .panel::before) : reprend la couleur de la
  // carte la plus rare possédée, pour personnaliser le fond par joueur.
  const panelEl = document.querySelector(".panel");
  if (panelEl && bestRarity) panelEl.style.setProperty("--rarity-glow", bestRarity.colorHex);

  statsEl.innerHTML = `
    <div class="stat-tile"><div class="stat-value">${ownedMap.size}</div><div class="stat-label">Cartes uniques</div></div>
    <div class="stat-tile"><div class="stat-value">${totalCopies}</div><div class="stat-label">Exemplaires au total</div></div>
    <div class="stat-tile"><div class="stat-value" style="color:${bestRarity?.colorHex || "inherit"};">${bestRarity ? bestRarity.name : "-"}</div><div class="stat-label">Meilleur pull</div></div>
    <div class="stat-tile"><div class="stat-value">${legendaryShare}%</div><div class="stat-label">Part de legendaires</div></div>
  `;

  if (milestoneEl) {
    const candidates = [...byRarity.values()].filter((r) => r.owned < r.total);
    candidates.sort((a, b) => (a.total - a.owned) - (b.total - b.owned));
    const next = candidates[0];
    if (next) {
      const missing = next.total - next.owned;
      milestoneEl.style.display = "flex";
      milestoneEl.innerHTML = `&#127919; Encore <strong>${missing} carte${missing > 1 ? "s" : ""} ${next.name}</strong> pour completer cette rareté !`;
    } else {
      milestoneEl.style.display = "flex";
      milestoneEl.innerHTML = `&#127942; Collection complète, félicitations !`;
    }
  }
}

function renderGrid() {
  const container = document.getElementById("collection-grid");
  const now = Math.floor(Date.now() / 1000);
  let cards = allCardsCache.filter(
    (c) => activeFilter === "all" || c.rarity?.key === activeFilter
  );
  if (missingOnly) cards = cards.filter((c) => !ownedMap.has(c.cardId));
  if (favoritesOnly) cards = cards.filter((c) => favorites.has(c.cardId));
  if (artistFilter) cards = cards.filter((c) => (c.artist || "") === artistFilter);
  if (searchQuery) {
    const q = normalize(searchQuery);
    cards = cards.filter((c) => ownedMap.has(c.cardId) && normalize(c.name).includes(q));
  }

  if (!cards.length) {
    container.innerHTML = `<div class="empty-state">Aucune carte ne correspond.</div>`;
    return;
  }

  // Tri "extension" (par defaut) : par SortOrder d'extension, la rareté
  // restant geree par les boutons de filtre, pas par un tri automatique.
  let sorted;
  if (sortMode === "name") {
    sorted = [...cards].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  } else if (sortMode === "artist") {
    sorted = [...cards].sort((a, b) => (a.artist || "").localeCompare(b.artist || "") || (a.name || "").localeCompare(b.name || ""));
  } else if (sortMode === "recent") {
    sorted = [...cards].sort((a, b) => {
      const ta = ownedMap.get(a.cardId)?.lastObtainedAt || 0;
      const tb = ownedMap.get(b.cardId)?.lastObtainedAt || 0;
      return tb - ta;
    });
  } else {
    // Le regroupement plus bas suppose que toutes les cartes d'une meme
    // extension sont CONTIGUES apres ce tri. Trier uniquement par
    // sortOrder ne suffit pas : deux extensions peuvent partager le meme
    // sortOrder (ex: 0 par defaut), auquel cas le tri retombe sur le nom
    // de la carte et entrelace les extensions - la meme extension
    // reapparaissait alors comme plusieurs groupes separes. La cle
    // d'extension (unique) doit toujours departager avant le nom.
    sorted = [...cards].sort((a, b) => {
      const extA = a.extension?.sortOrder ?? 999;
      const extB = b.extension?.sortOrder ?? 999;
      if (extA !== extB) return extA - extB;
      const keyA = a.extension?.key || "";
      const keyB = b.extension?.key || "";
      if (keyA !== keyB) return keyA.localeCompare(keyB);
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  // Regroupe par extension uniquement en mode de tri "extension".
  let groups;
  if (sortMode === "extension") {
    groups = [];
    let current = null;
    for (const card of sorted) {
      const extKey = card.extension?.key || "__none__";
      if (!current || current.key !== extKey) {
        current = { key: extKey, name: card.extension?.name || "Sans extension", cards: [] };
        groups.push(current);
      }
      current.cards.push(card);
    }
  } else {
    groups = [{ key: "__flat__", name: "", cards: sorted }];
  }

  // Regroupement par extension repliable (plutot qu'une simple barre de
  // progression a part, qui n'aidait pas vraiment a naviguer) : le compteur
  // N/X vit directement dans le titre du groupe, et chaque groupe peut se
  // replier pour se concentrer sur les autres.
  const isDense = document.body.classList.contains("dense-view");
  const showHeadings = groups.length > 1;
  container.innerHTML = groups.map((group) => {
    const total = group.cards.length;
    const ownedCount = group.cards.filter((c) => ownedMap.has(c.cardId)).length;
    const isCollapsed = showHeadings && collapsedExtensions.has(group.key);
    return `
      <div class="collection-ext-group ${isCollapsed ? "collapsed" : ""}" data-ext-key="${group.key}">
        ${showHeadings ? `
          <h2 class="collection-extension-heading">
            <button type="button" class="ext-fold-toggle" aria-label="${isCollapsed ? "Déplier" : "Plier"} ${group.name}" aria-expanded="${!isCollapsed}">&#9662;</button>
            <span class="ext-heading-name">${group.name}</span>
            <span class="ext-heading-count">${ownedCount}/${total}</span>
          </h2>
        ` : ""}
        <div class="collection-grid ${isDense ? "dense" : ""}">${group.cards.flatMap((c) => cardTileHtml(c, now)).join("")}</div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".collection-extension-heading").forEach((heading) => {
    heading.addEventListener("click", () => {
      const groupEl = heading.closest(".collection-ext-group");
      const key = groupEl.dataset.extKey;
      const collapsed = groupEl.classList.toggle("collapsed");
      heading.querySelector(".ext-fold-toggle").setAttribute("aria-expanded", String(!collapsed));
      if (collapsed) collapsedExtensions.add(key); else collapsedExtensions.delete(key);
      saveCollapsedExtensions(collapsedExtensions);
    });
  });

  const visibleNavKeys = [...container.querySelectorAll(".collection-card:not(.locked)")].map((el) => el.dataset.navKey);
  container.querySelectorAll(".collection-card:not(.locked)").forEach((el) => {
    attachTilt(el);
    el.addEventListener("click", (e) => {
      if (e.target.closest(".fav-btn, .card-quick-action")) return;
      // En mode selection multiple, un clic n'importe ou sur la vignette
      // (pas seulement sur la case) bascule la selection au lieu d'ouvrir
      // la modale - plus pratique pour selectionner beaucoup de cartes vite.
      if (bulkSelectMode && el.classList.contains("bulk-mode")) {
        if (e.target.closest(".bulk-checkbox")) return;
        const cb = el.querySelector("[data-bulk-key]");
        if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
        return;
      }
      showCardModal(el.dataset.navKey, visibleNavKeys);
    });
    // Cartes cliquables au clavier (tabindex+role="button" poses dans
    // cardTileHtml) : Entree/Espace equivalent au clic, pour ne pas
    // reserver la collection aux seuls utilisateurs de souris/tactile.
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      showCardModal(el.dataset.navKey, visibleNavKeys);
    });
  });

  container.querySelectorAll(".fav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.favId);
      if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
      saveFavorites(favorites);
      btn.classList.toggle("active");
    });
  });
  container.querySelectorAll(".wishlist-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleWishlist(Number(btn.dataset.wishlistId), btn);
    });
  });
  container.querySelectorAll(".quick-craft-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); craftCardQuick(Number(btn.dataset.cardId)); });
  });
  container.querySelectorAll(".quick-disenchant-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); disenchantCardQuick(Number(btn.dataset.cardId), btn.dataset.finish, btn.dataset.quality, btn); });
  });
  container.querySelectorAll(".quick-trade-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); openQuickTrade(Number(btn.dataset.cardId)); });
  });
  container.querySelectorAll(".quick-showcase-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); toggleShowcase(Number(btn.dataset.cardId), btn); });
  });
  container.querySelectorAll("[data-bulk-key]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      const key = cb.dataset.bulkKey;
      if (e.target.checked) bulkSelected.add(key); else bulkSelected.delete(key);
      cb.closest(".collection-card").classList.toggle("selected", e.target.checked);
      updateBulkBar();
    });
    cb.addEventListener("click", (e) => e.stopPropagation());
  });
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById("bulk-disenchant-bar");
  if (!bar) return;
  if (!bulkSelectMode || bulkSelected.size === 0) {
    bar.style.display = "none";
    return;
  }
  const dust = [...bulkSelected].reduce((sum, key) => {
    const { cardId, finish, quality } = parseNavKey(key);
    return sum + estimateDust(craftCostByCard.get(cardId)?.disenchantValue || 0, finish, quality);
  }, 0);
  bar.style.display = "flex";
  document.getElementById("bulk-disenchant-summary").textContent =
    `${bulkSelected.size} carte${bulkSelected.size > 1 ? "s" : ""} sélectionnée${bulkSelected.size > 1 ? "s" : ""} · +${dust} poussières`;
}

async function bulkDisenchant() {
  const keys = [...bulkSelected];
  if (!keys.length) return;
  const totalDust = keys.reduce((sum, key) => {
    const { cardId, finish, quality } = parseNavKey(key);
    return sum + estimateDust(craftCostByCard.get(cardId)?.disenchantValue || 0, finish, quality);
  }, 0);
  const ok = await Confirm.show(
    `Décrafter ces <strong>${keys.length} cartes</strong> pour <strong>+${totalDust} poussières d'étoile</strong> ? ` +
    `Un seul exemplaire de chaque variante sélectionnée sera détruit. Cette action est irréversible.`,
    { title: "Décrafter la sélection ?", confirmText: "Décrafter tout", dangerous: true }
  );
  if (!ok) return;
  let successCount = 0;
  let totalDustGained = 0;
  for (const key of keys) {
    const { cardId, finish, quality } = parseNavKey(key);
    try {
      const res = await API.disenchantCard(Session.userId, cardId, finish, quality);
      totalDustGained += res.dustGained || 0;
      successCount++;
      const owned = ownedMap.get(cardId);
      if (owned) {
        const consumedFinish = res.finish || finish || "normal";
        const consumedQuality = res.quality || quality || "damaged";
        const copies = owned.copies || [];
        const idx = copies.findIndex((c) => (c.finish || "normal") === consumedFinish && (c.quality || "damaged") === consumedQuality);
        if (idx !== -1) copies.splice(idx, 1);
        if (owned.count > 1) owned.count--;
        else ownedMap.delete(cardId);
      }
    } catch (e) { /* on continue avec les suivantes */ }
  }
  stardustBalance += totalDustGained;
  Toast.success(`${successCount} carte${successCount > 1 ? "s" : ""} décraftée${successCount > 1 ? "s" : ""} (+${totalDustGained} poussières).`);
  bulkSelected.clear();
  bulkSelectMode = false;
  document.getElementById("bulk-select-toggle").classList.remove("active");
  renderStatsAndMilestone();
  renderGrid();
}

async function loadCollection() {
  const zone = document.getElementById("collection-zone");
  document.getElementById("loading-zone").style.display = "grid";
  zone.style.display = "none";

  const OFFLINE_CACHE_KEY = "2gatcha_offline_collection_" + Session.userId;
  let res, statusRes, cardsRes, wishlistRes, showcaseRes, isOffline = false;
  try {
    [res, statusRes, cardsRes, wishlistRes, showcaseRes] = await Promise.all([
      API.getCollection(Session.userId),
      API.getBoosterStatus(Session.userId).catch(() => ({ stardust: 0 })),
      API.getCards().catch(() => ({ cards: [] })),
      API.listWishlist(Session.userId).catch(() => ({ wishlist: [] })),
      API.listShowcase(Session.userId).catch(() => ({ showcase: [] }))
    ]);
    // Sauvegarde pour un affichage hors-ligne basique si le prochain
    // chargement echoue (reseau coupe) : mieux qu'un ecran d'erreur vide.
    try { localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(res)); } catch (e) {}
  } catch (e) {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(OFFLINE_CACHE_KEY) || "null"); } catch (e2) {}
    if (cached) {
      res = cached;
      statusRes = { stardust: 0 };
      cardsRes = { cards: [] };
      wishlistRes = { wishlist: [] };
      showcaseRes = { showcase: [] };
      isOffline = true;
      Toast.info("Mode hors-ligne : dernière collection connue affichée (peut-être obsolète).");
    } else {
      Toast.error("Impossible de charger la collection. (" + e.message + ")");
      document.getElementById("loading-zone").style.display = "none";
      return;
    }
  }

  try {
    allCardsCache = res.cards || [];
    ownedMap = new Map((res.owned || []).map((o) => [o.cardId, o]));
    ownedCopiesByCard = new Map((res.owned || []).map((o) => [o.cardId, o.copies || []]));
    stardustBalance = statusRes.stardust || 0;
    // Pochettes de cartes (sleeves) et vitrine : debloquees par niveau de
    // profil, on ne connait le vrai niveau qu'une fois booster-status
    // charge ici.
    currentPlayerLevel = statusRes.xp?.level || 1;
    knownProfileLevel = currentPlayerLevel;
    refreshSleeveLocks(currentPlayerLevel);
    craftCostByCard = new Map((cardsRes.cards || []).map((c) => [c.cardId, c.rarity]));
    finishMultipliers = cardsRes.finishMultipliers || {};
    qualityMultipliers = cardsRes.qualityMultipliers || {};
    wishlistSet = new Set((wishlistRes.wishlist || []).map((w) => w.cardId));
    showcaseSet = new Set((showcaseRes.showcase || []).map((s) => s.cardId));

    const stats = res.stats || { owned: ownedMap.size, total: allCardsCache.length };
    document.getElementById("progress-label").textContent =
      `${stats.owned} / ${stats.total} cartes découvertes` + (isOffline ? " (hors-ligne)" : "");
    const pct = stats.total ? Math.round((stats.owned / stats.total) * 100) : 0;
    document.getElementById("progress-fill").style.width = pct + "%";

    renderRarityProgress();
    renderStatsAndMilestone();

    const rarityByKey = new Map();
    allCardsCache.forEach((c) => {
      if (c.rarity?.key && !rarityByKey.has(c.rarity.key)) {
        rarityByKey.set(c.rarity.key, { key: c.rarity.key, name: c.rarity.name || c.rarity.key, sortOrder: c.rarity.sortOrder ?? 999 });
      }
    });
    const rarities = [...rarityByKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    renderFilters(rarities);

    const artistSelect = document.getElementById("artist-filter");
    const artists = [...new Set(allCardsCache.map((c) => c.artist).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    artistSelect.innerHTML = `<option value="">Tous les artistes</option>` +
      artists.map((a) => `<option value="${a}" ${a === artistFilter ? "selected" : ""}>${a}</option>`).join("");
    renderGrid();

    zone.style.display = "block";
  } catch (e) {
    Toast.error("Impossible de charger la collection. (" + e.message + ")");
  } finally {
    document.getElementById("loading-zone").style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }

  // Applique les preferences memorisees aux controles avant le premier
  // rendu (loadCollection appelle renderGrid, qui doit deja voir le bon
  // etat de missingOnly/sortMode/dense-view).
  document.getElementById("sort-select").value = sortMode;
  const missingBtn = document.getElementById("missing-toggle");
  missingBtn.classList.toggle("active", missingOnly);
  const denseBtn = document.getElementById("dense-toggle");
  if (prefs.denseView) {
    document.body.classList.add("dense-view");
    denseBtn.classList.add("active");
  }
  const statsToggleBtn = document.getElementById("stats-toggle");
  function applyStatsToggleLabel(hidden) {
    statsToggleBtn.innerHTML = hidden ? "&#128202; Afficher les stats" : "&#128202; Masquer les stats";
    statsToggleBtn.classList.toggle("active", hidden);
  }
  if (prefs.hideStats) {
    document.body.classList.add("hide-stats");
    applyStatsToggleLabel(true);
  }
  // Classeur personnalisable : la couleur choisie redefinit --accent/--accent-2
  // eux-memes (pas une variable a part peu utilisee) - ca retente vraiment
  // les boutons actifs, la barre de progression, les halos, partout sur
  // cette page. Un simple halo au survol etait invisible en pratique
  // (retour utilisateur), d'ou ce choix plus radical.
  if (prefs.binderAccent) {
    applyBinderAccent(prefs.binderAccent);
    document.querySelectorAll(".binder-swatch").forEach((sw) => {
      sw.classList.toggle("active", sw.dataset.accent === prefs.binderAccent);
    });
  }
  document.querySelectorAll(".binder-swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      const accent = sw.dataset.accent;
      applyBinderAccent(accent);
      savePrefs({ binderAccent: accent });
      document.querySelectorAll(".binder-swatch").forEach((s) => s.classList.toggle("active", s === sw));
    });
  });

  // Pochettes de cartes (sleeves) : appliquees tout de suite depuis le
  // cache local ; refreshSleeveLocks() (appele une fois le vrai niveau
  // connu, dans loadCollection) verrouille celles pas encore debloquees.
  if (prefs.sleeve) {
    document.body.dataset.sleeve = prefs.sleeve;
    document.querySelectorAll(".sleeve-swatch").forEach((s) => s.classList.toggle("active", s.dataset.sleeve === prefs.sleeve));
  }
  document.querySelectorAll(".sleeve-swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      if (sw.classList.contains("locked")) {
        Toast.info(`Pochette débloquée au niveau ${sw.dataset.level}.`);
        return;
      }
      const sleeve = sw.dataset.sleeve;
      if (sleeve) document.body.dataset.sleeve = sleeve;
      else delete document.body.dataset.sleeve;
      savePrefs({ sleeve });
      document.querySelectorAll(".sleeve-swatch").forEach((s) => s.classList.toggle("active", s === sw));
    });
  });

  loadCollection();

  let searchTimer = null;
  document.getElementById("search-input").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchQuery = e.target.value; renderGrid(); }, 150);
  });
  document.getElementById("sort-select").addEventListener("change", (e) => {
    sortMode = e.target.value;
    savePrefs({ sortMode });
    renderGrid();
  });
  missingBtn.addEventListener("click", (e) => {
    missingOnly = !missingOnly;
    savePrefs({ missingOnly });
    e.target.classList.toggle("active", missingOnly);
    renderGrid();
  });
  const favoritesBtn = document.getElementById("favorites-toggle");
  favoritesBtn.addEventListener("click", (e) => {
    favoritesOnly = !favoritesOnly;
    e.target.classList.toggle("active", favoritesOnly);
    renderGrid();
  });
  document.getElementById("artist-filter").addEventListener("change", (e) => {
    artistFilter = e.target.value;
    renderGrid();
  });
  document.getElementById("mark-seen-btn").addEventListener("click", () => {
    const now = Math.floor(Date.now() / 1000);
    let count = 0;
    ownedMap.forEach((owned, cardId) => {
      if (owned.lastObtainedAt && (now - owned.lastObtainedAt) < NEW_BADGE_WINDOW_SECONDS && !seenCards.has(cardId)) {
        seenCards.add(cardId);
        count++;
      }
    });
    saveSeen(seenCards);
    renderGrid();
    Toast.info(count ? `${count} carte${count > 1 ? "s" : ""} marquee${count > 1 ? "s" : ""} comme vue${count > 1 ? "s" : ""}.` : "Rien de nouveau a marquer.");
  });
  denseBtn.addEventListener("click", (e) => {
    document.body.classList.toggle("dense-view");
    const isDense = document.body.classList.contains("dense-view");
    savePrefs({ denseView: isDense });
    e.target.classList.toggle("active", isDense);
    renderGrid();
  });
  document.getElementById("cinema-toggle").addEventListener("click", (e) => {
    document.body.classList.toggle("cinema-mode");
    e.target.classList.toggle("active", document.body.classList.contains("cinema-mode"));
  });
  statsToggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("hide-stats");
    const hidden = document.body.classList.contains("hide-stats");
    savePrefs({ hideStats: hidden });
    applyStatsToggleLabel(hidden);
  });
  document.getElementById("reset-filters-btn").addEventListener("click", () => {
    searchQuery = "";
    activeFilter = "all";
    sortMode = "extension";
    missingOnly = false;
    favoritesOnly = false;
    artistFilter = "";
    document.body.classList.remove("dense-view", "cinema-mode", "hide-stats");
    applyBinderAccent(null);
    document.querySelectorAll(".binder-swatch").forEach((s) => s.classList.toggle("active", !s.dataset.accent));
    savePrefs({ sortMode, missingOnly, denseView: false, hideStats: false, binderAccent: "" });

    document.getElementById("search-input").value = "";
    document.getElementById("sort-select").value = sortMode;
    document.getElementById("artist-filter").value = "";
    missingBtn.classList.remove("active");
    favoritesBtn.classList.remove("active");
    denseBtn.classList.remove("active");
    document.getElementById("cinema-toggle").classList.remove("active");
    applyStatsToggleLabel(false);
    document.querySelectorAll("#rarity-filters button").forEach((b) => b.classList.toggle("active", b.dataset.filter === "all"));

    renderGrid();
    Toast.info("Filtres réinitialisés.");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("cinema-mode")) {
      document.body.classList.remove("cinema-mode");
      document.getElementById("cinema-toggle").classList.remove("active");
    }
  });
  document.getElementById("bulk-select-toggle").addEventListener("click", (e) => {
    bulkSelectMode = !bulkSelectMode;
    bulkSelected.clear();
    e.target.classList.toggle("active", bulkSelectMode);
    renderGrid();
  });
  document.getElementById("bulk-disenchant-btn").addEventListener("click", bulkDisenchant);
});
