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
let stardustBalance = 0;
let activeFilter = "all";
let searchQuery = "";
// Tri/vue memorises d'une visite a l'autre : pas de raison de refaire le
// meme reglage a chaque fois qu'on revient sur la page.
let sortMode = prefs.sortMode || "extension";
let missingOnly = !!prefs.missingOnly;
let favoritesOnly = false;
let artistFilter = "";

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

// Effet de bascule 3D qui suit le curseur ou le doigt.
function attachTilt(el) {
  const update = (clientX, clientY) => {
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width - 0.5;
    const py = (clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--ry", `${px * 16}deg`);
    el.style.setProperty("--rx", `${py * -16}deg`);
  };
  const reset = () => {
    el.style.setProperty("--rx", `0deg`);
    el.style.setProperty("--ry", `0deg`);
    el.style.willChange = "auto";
  };
  // will-change seulement pendant l'interaction : le poser en permanence en
  // CSS sur toute la grille forcerait un calque GPU par carte (saccades sur
  // une grande collection).
  el.addEventListener("mouseenter", () => { el.style.willChange = "transform"; });
  el.addEventListener("mousemove", (e) => update(e.clientX, e.clientY));
  el.addEventListener("mouseleave", reset);
  el.addEventListener("touchstart", () => { el.style.willChange = "transform"; }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (e.touches[0]) update(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  el.addEventListener("touchend", reset);
}

// navList = tableau ordonne des cardId actuellement affiches (dans l'ordre
// visible de la grille) : permet de naviguer a la carte precedente/suivante
// sans fermer la modale, au clavier (fleches) ou au doigt (swipe).
function showCardModal(cardId, navList) {
  const overlay = document.createElement("div");
  overlay.className = "card-modal-overlay";
  document.body.appendChild(overlay);

  let index = Math.max(0, navList.indexOf(cardId));

  function renderAt(newIndex, direction) {
    index = newIndex;
    const card = allCardsCache.find((c) => c.cardId === navList[index]);
    if (!card) return;
    const owned = ownedMap.get(card.cardId);
    const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
    const color = card.rarity?.colorHex || "#9aa0b4";
    overlay.innerHTML = `
      <div class="card-modal ${direction ? "slide-" + direction : ""}">
        <button class="card-modal-close" aria-label="Fermer">&times;</button>
        ${navList.length > 1 ? `<button class="card-modal-nav prev" aria-label="Carte precedente">&#10094;</button>` : ""}
        ${navList.length > 1 ? `<button class="card-modal-nav next" aria-label="Carte suivante">&#10095;</button>` : ""}
        <img src="${imgSrc}" alt="${card.name}" loading="lazy" />
        <div class="card-modal-body">
          <div class="card-modal-name">${card.name}${card.isPromo ? '<span class="promo-badge">Promo</span>' : ""}</div>
          <div class="card-modal-artist">${card.artist || ""}${card.extension ? " &middot; " + card.extension.name : ""}</div>
          <span class="rarity-badge" style="background:${color}22;color:${color};border:1px solid ${color};">
            ${card.rarity?.name || "Commune"}
          </span>
          ${owned ? `<div class="count-badge" style="margin-top:8px;">Possédée x${owned.count}</div>` : ""}
        </div>
      </div>
    `;
    overlay.querySelector(".card-modal-close").addEventListener("click", close);
    const prevBtn = overlay.querySelector(".card-modal-nav.prev");
    const nextBtn = overlay.querySelector(".card-modal-nav.next");
    if (prevBtn) prevBtn.addEventListener("click", () => go(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => go(1));
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

function renderExtensionProgress() {
  const el = document.getElementById("extension-progress");
  if (!el) return;
  const byExt = new Map();
  allCardsCache.forEach((c) => {
    const key = c.extension?.key || "__none__";
    if (!byExt.has(key)) {
      byExt.set(key, { name: c.extension?.name || "Sans extension", sortOrder: c.extension?.sortOrder ?? 999, total: 0, owned: 0 });
    }
    const entry = byExt.get(key);
    entry.total++;
    if (ownedMap.has(c.cardId)) entry.owned++;
  });
  const rows = [...byExt.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  if (rows.length < 2) { el.innerHTML = ""; return; }
  el.innerHTML = rows.map((r) => {
    const pct = r.total ? Math.round((r.owned / r.total) * 100) : 0;
    return `
      <div class="rarity-progress-row">
        <span class="rp-label">${r.name}</span>
        <span class="rp-track"><span class="rp-fill" style="width:${pct}%;background:var(--accent-2);"></span></span>
        <span class="rp-count">${r.owned}/${r.total}</span>
      </div>
    `;
  }).join("");
}

function cardTileHtml(card, now) {
  const owned = ownedMap.get(card.cardId);
  const locked = !owned;
  const isNew = !!(owned && owned.lastObtainedAt && (now - owned.lastObtainedAt) < NEW_BADGE_WINDOW_SECONDS && !seenCards.has(card.cardId));
  const isFav = favorites.has(card.cardId);
  const color = card.rarity?.colorHex || "#9aa0b4";
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;

  // Carte manquante mais a portee de poussieres : le signaler directement
  // sur la vignette, avec un lien vers craft.html plutot que de laisser le
  // joueur decouvrir ca par hasard en changeant de page.
  const craftCost = craftCostByCard.get(card.cardId);
  const craftable = locked && !card.isPromo && craftCost != null && stardustBalance >= craftCost;

  return `
    <div class="collection-card ${locked ? "locked" : ""}" data-rarity="${card.rarity?.key || "commune"}" data-card-id="${card.cardId}" data-promo="${!locked && card.isPromo ? "1" : "0"}" ${!locked ? 'tabindex="0" role="button" aria-label="Voir la carte ' + card.name.replace(/"/g, "&quot;") + '"' : ""}>
      ${isNew ? '<span class="new-badge">New</span>' : ""}
      ${!locked ? `<button type="button" class="fav-btn ${isFav ? "active" : ""}" data-fav-id="${card.cardId}" title="Favori" aria-label="Marquer comme favori">&#9733;</button>` : ""}
      <img src="${imgSrc}" alt="${locked ? "Carte non découverte" : card.name}" loading="lazy" />
      <div class="card-info">
        <div class="card-name">${locked ? "???" : card.name}${!locked && card.isPromo ? '<span class="promo-badge">Promo</span>' : ""}</div>
        <span class="rarity-badge" style="background:${color}22;color:${color};border:1px solid ${color};">
          ${rarityIcon(card.rarity?.key)} ${card.rarity?.name || "Commune"}
        </span>
        ${owned ? `<div class="count-badge">x${owned.count}</div>` : ""}
        ${craftable ? `<a href="craft.html?cardId=${card.cardId}" class="craftable-link" onclick="event.stopPropagation();">&#9879; Craftable (${craftCost})</a>` : ""}
      </div>
    </div>
  `;
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
  container.classList.toggle("dense", document.body.classList.contains("dense-view"));
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

  const showHeadings = groups.length > 1;
  container.innerHTML = groups.map((group) => `
    ${showHeadings ? `<h2 class="collection-extension-heading">${group.name}</h2>` : ""}
    <div class="collection-grid">${group.cards.map((c) => cardTileHtml(c, now)).join("")}</div>
  `).join("");

  const visibleOwnedIds = [...container.querySelectorAll(".collection-card:not(.locked)")].map((el) => Number(el.dataset.cardId));
  container.querySelectorAll(".collection-card:not(.locked)").forEach((el) => {
    attachTilt(el);
    el.addEventListener("click", (e) => {
      if (e.target.closest(".fav-btn")) return;
      const cardId = Number(el.dataset.cardId);
      showCardModal(cardId, visibleOwnedIds);
    });
    // Cartes cliquables au clavier (tabindex+role="button" poses dans
    // cardTileHtml) : Entree/Espace equivalent au clic, pour ne pas
    // reserver la collection aux seuls utilisateurs de souris/tactile.
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      showCardModal(Number(el.dataset.cardId), visibleOwnedIds);
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
}

async function loadCollection() {
  const zone = document.getElementById("collection-zone");
  document.getElementById("loading-zone").style.display = "grid";
  zone.style.display = "none";

  const OFFLINE_CACHE_KEY = "2gatcha_offline_collection_" + Session.userId;
  let res, statusRes, cardsRes, isOffline = false;
  try {
    [res, statusRes, cardsRes] = await Promise.all([
      API.getCollection(Session.userId),
      API.getBoosterStatus(Session.userId).catch(() => ({ stardust: 0 })),
      API.getCards().catch(() => ({ cards: [] }))
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
    stardustBalance = statusRes.stardust || 0;
    craftCostByCard = new Map((cardsRes.cards || []).map((c) => [c.cardId, c.rarity?.craftCost]));

    const stats = res.stats || { owned: ownedMap.size, total: allCardsCache.length };
    document.getElementById("progress-label").textContent =
      `${stats.owned} / ${stats.total} cartes découvertes` + (isOffline ? " (hors-ligne)" : "");
    const pct = stats.total ? Math.round((stats.owned / stats.total) * 100) : 0;
    document.getElementById("progress-fill").style.width = pct + "%";

    renderRarityProgress();
    renderExtensionProgress();
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
  document.getElementById("reset-filters-btn").addEventListener("click", () => {
    searchQuery = "";
    activeFilter = "all";
    sortMode = "extension";
    missingOnly = false;
    favoritesOnly = false;
    artistFilter = "";
    document.body.classList.remove("dense-view", "cinema-mode");
    savePrefs({ sortMode, missingOnly, denseView: false });

    document.getElementById("search-input").value = "";
    document.getElementById("sort-select").value = sortMode;
    document.getElementById("artist-filter").value = "";
    missingBtn.classList.remove("active");
    favoritesBtn.classList.remove("active");
    denseBtn.classList.remove("active");
    document.getElementById("cinema-toggle").classList.remove("active");
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
});
