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

let allCardsCache = [];
let ownedMap = new Map();
let activeFilter = "all";
let searchQuery = "";
let sortMode = "extension";
let missingOnly = false;

// Favoris : purement locaux (par appareil), pas de backend necessaire.
function loadFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]")); }
  catch (e) { return new Set(); }
}
function saveFavorites(set) {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set])); } catch (e) {}
}
let favorites = loadFavorites();

function normalize(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
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
  };
  el.addEventListener("mousemove", (e) => update(e.clientX, e.clientY));
  el.addEventListener("mouseleave", reset);
  el.addEventListener("touchmove", (e) => {
    if (e.touches[0]) update(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  el.addEventListener("touchend", reset);
}

function showCardModal(card, owned) {
  const overlay = document.createElement("div");
  overlay.className = "card-modal-overlay";
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  const color = card.rarity?.colorHex || "#9aa0b4";
  overlay.innerHTML = `
    <div class="card-modal">
      <button class="card-modal-close" aria-label="Fermer">&times;</button>
      <img src="${imgSrc}" alt="${card.name}" />
      <div class="card-modal-body">
        <div class="card-modal-name">${card.name}${card.isPromo ? '<span class="promo-badge">Promo</span>' : ""}</div>
        <div class="card-modal-artist">${card.artist || ""}${card.extension ? " &middot; " + card.extension.name : ""}</div>
        <span class="rarity-badge" style="background:${color}22;color:${color};border:1px solid ${color};">
          ${card.rarity?.name || "Commune"}
        </span>
        ${owned ? `<div class="count-badge" style="margin-top:8px;">Possedee x${owned.count}</div>` : ""}
      </div>
    </div>
  `;
  const close = () => { overlay.remove(); syncScrollLock(); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".card-modal-close").addEventListener("click", close);
  document.body.appendChild(overlay);
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

function cardTileHtml(card, now) {
  const owned = ownedMap.get(card.cardId);
  const locked = !owned;
  const isNew = !!(owned && owned.lastObtainedAt && (now - owned.lastObtainedAt) < NEW_BADGE_WINDOW_SECONDS);
  const isFav = favorites.has(card.cardId);
  const color = card.rarity?.colorHex || "#9aa0b4";
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  return `
    <div class="collection-card ${locked ? "locked" : ""}" data-rarity="${card.rarity?.key || "commune"}" data-card-id="${card.cardId}" data-promo="${!locked && card.isPromo ? "1" : "0"}">
      ${isNew ? '<span class="new-badge">New</span>' : ""}
      ${!locked ? `<button type="button" class="fav-btn ${isFav ? "active" : ""}" data-fav-id="${card.cardId}" title="Favori" aria-label="Marquer comme favori">&#9733;</button>` : ""}
      <img src="${imgSrc}" alt="${locked ? "Carte non decouverte" : card.name}" />
      <div class="card-info">
        <div class="card-name">${locked ? "???" : card.name}${!locked && card.isPromo ? '<span class="promo-badge">Promo</span>' : ""}</div>
        <span class="rarity-badge" style="background:${color}22;color:${color};border:1px solid ${color};">
          ${rarityIcon(card.rarity?.key)} ${card.rarity?.name || "Commune"}
        </span>
        ${owned ? `<div class="count-badge">x${owned.count}</div>` : ""}
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
      milestoneEl.innerHTML = `&#127919; Encore <strong>${missing} carte${missing > 1 ? "s" : ""} ${next.name}</strong> pour completer cette rarete !`;
    } else {
      milestoneEl.style.display = "flex";
      milestoneEl.innerHTML = `&#127942; Collection complete, felicitations !`;
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
  if (searchQuery) {
    const q = normalize(searchQuery);
    cards = cards.filter((c) => ownedMap.has(c.cardId) && normalize(c.name).includes(q));
  }

  if (!cards.length) {
    container.innerHTML = `<div class="empty-state">Aucune carte ne correspond.</div>`;
    return;
  }

  // Tri "extension" (par defaut) : par SortOrder d'extension, la rarete
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
    sorted = [...cards].sort((a, b) => {
      const extA = a.extension?.sortOrder ?? 999;
      const extB = b.extension?.sortOrder ?? 999;
      if (extA !== extB) return extA - extB;
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

  container.querySelectorAll(".collection-card:not(.locked)").forEach((el) => {
    attachTilt(el);
    el.addEventListener("click", (e) => {
      if (e.target.closest(".fav-btn")) return;
      const cardId = Number(el.dataset.cardId);
      const card = allCardsCache.find((c) => c.cardId === cardId);
      if (card) showCardModal(card, ownedMap.get(cardId));
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

  try {
    const res = await API.getCollection(Session.userId);
    allCardsCache = res.cards || [];
    ownedMap = new Map((res.owned || []).map((o) => [o.cardId, o]));

    const stats = res.stats || { owned: ownedMap.size, total: allCardsCache.length };
    document.getElementById("progress-label").textContent =
      `${stats.owned} / ${stats.total} cartes decouvertes`;
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
  loadCollection();

  let searchTimer = null;
  document.getElementById("search-input").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchQuery = e.target.value; renderGrid(); }, 150);
  });
  document.getElementById("sort-select").addEventListener("change", (e) => {
    sortMode = e.target.value;
    renderGrid();
  });
  document.getElementById("missing-toggle").addEventListener("click", (e) => {
    missingOnly = !missingOnly;
    e.target.classList.toggle("active", missingOnly);
    renderGrid();
  });
  document.getElementById("dense-toggle").addEventListener("click", (e) => {
    document.body.classList.toggle("dense-view");
    e.target.classList.toggle("active", document.body.classList.contains("dense-view"));
    renderGrid();
  });
  document.getElementById("cinema-toggle").addEventListener("click", (e) => {
    document.body.classList.toggle("cinema-mode");
    e.target.classList.toggle("active", document.body.classList.contains("cinema-mode"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("cinema-mode")) {
      document.body.classList.remove("cinema-mode");
      document.getElementById("cinema-toggle").classList.remove("active");
    }
  });
});
