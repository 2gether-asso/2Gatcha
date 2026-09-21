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

let allCardsCache = [];
let ownedMap = new Map();
let activeFilter = "all";

function renderFilters(rarities) {
  const el = document.getElementById("rarity-filters");
  const buttons = ["all", ...rarities].map((key) => {
    const label = key === "all" ? "Toutes" : key;
    return `<button data-filter="${key}" class="btn-secondary ${key === activeFilter ? "active" : ""}">${label}</button>`;
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
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".card-modal-close").addEventListener("click", close);
  document.body.appendChild(overlay);
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
  const color = card.rarity?.colorHex || "#9aa0b4";
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  return `
    <div class="collection-card ${locked ? "locked" : ""}" data-rarity="${card.rarity?.key || "commune"}" data-card-id="${card.cardId}">
      ${isNew ? '<span class="new-badge">New</span>' : ""}
      <img src="${imgSrc}" alt="${locked ? "Carte non decouverte" : card.name}" />
      <div class="card-info">
        <div class="card-name">${locked ? "???" : card.name}${!locked && card.isPromo ? '<span class="promo-badge">Promo</span>' : ""}</div>
        <span class="rarity-badge" style="background:${color}22;color:${color};border:1px solid ${color};">
          ${card.rarity?.name || "Commune"}
        </span>
        ${owned ? `<div class="count-badge">x${owned.count}</div>` : ""}
      </div>
    </div>
  `;
}

function renderGrid() {
  const container = document.getElementById("collection-grid");
  const now = Math.floor(Date.now() / 1000);
  const cards = allCardsCache.filter(
    (c) => activeFilter === "all" || c.rarity?.key === activeFilter
  );

  if (!cards.length) {
    container.innerHTML = `<div class="empty-state">Aucune carte dans cette categorie.</div>`;
    return;
  }

  // Tri : extension (SortOrder) puis rarete (SortOrder, du moins rare au plus rare).
  const sorted = [...cards].sort((a, b) => {
    const extA = a.extension?.sortOrder ?? 999;
    const extB = b.extension?.sortOrder ?? 999;
    if (extA !== extB) return extA - extB;
    const rarA = a.rarity?.sortOrder ?? 999;
    const rarB = b.rarity?.sortOrder ?? 999;
    if (rarA !== rarB) return rarA - rarB;
    return (a.name || "").localeCompare(b.name || "");
  });

  // Regroupe par extension en conservant l'ordre de tri.
  const groups = [];
  let current = null;
  for (const card of sorted) {
    const extKey = card.extension?.key || "__none__";
    if (!current || current.key !== extKey) {
      current = { key: extKey, name: card.extension?.name || "Sans extension", cards: [] };
      groups.push(current);
    }
    current.cards.push(card);
  }

  const showHeadings = groups.length > 1;
  container.innerHTML = groups.map((group) => `
    ${showHeadings ? `<h2 class="collection-extension-heading">${group.name}</h2>` : ""}
    <div class="collection-grid">${group.cards.map((c) => cardTileHtml(c, now)).join("")}</div>
  `).join("");

  container.querySelectorAll(".collection-card:not(.locked)").forEach((el) => {
    attachTilt(el);
    el.addEventListener("click", () => {
      const cardId = Number(el.dataset.cardId);
      const card = allCardsCache.find((c) => c.cardId === cardId);
      if (card) showCardModal(card, ownedMap.get(cardId));
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

    const rarityKeys = [...new Set(allCardsCache.map((c) => c.rarity?.key).filter(Boolean))];
    renderFilters(rarityKeys);
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
});
