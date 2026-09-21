// Logique de la page collection.
// Contrat attendu du webhook n8n "collection" (GET ?userId=...):
// {
//   "cards": [ { cardId, name, artist, imageId, rarity: { id, name, key, colorHex } } ],
//   "owned": [ { cardId, count } ],
//   "stats": { "owned": 12, "total": 40 }
// }

let allCardsCache = [];
let ownedMap = new Map();
let activeFilter = "all";

function showError(msg) {
  document.getElementById("error-zone").innerHTML = `<div class="error-box">${msg}</div>`;
}

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

function renderGrid() {
  const grid = document.getElementById("collection-grid");
  const cards = allCardsCache.filter(
    (c) => activeFilter === "all" || c.rarity?.key === activeFilter
  );

  if (!cards.length) {
    grid.innerHTML = `<div class="empty-state">Aucune carte dans cette categorie.</div>`;
    return;
  }

  grid.innerHTML = cards
    .map((card) => {
      const owned = ownedMap.get(card.cardId);
      const locked = !owned;
      const color = card.rarity?.colorHex || "#9aa0b4";
      const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
      return `
        <div class="collection-card ${locked ? "locked" : ""}">
          <img src="${imgSrc}" alt="${locked ? "Carte non decouverte" : card.name}" />
          <div class="card-info">
            <div class="card-name">${locked ? "???" : card.name}</div>
            <span class="rarity-badge" style="background:${color}22;color:${color};border:1px solid ${color};">
              ${card.rarity?.name || "Commune"}
            </span>
            ${owned ? `<div class="count-badge">x${owned.count}</div>` : ""}
          </div>
        </div>
      `;
    })
    .join("");
}

async function loadCollection() {
  try {
    const res = await API.getCollection(Session.userId);
    allCardsCache = res.cards || [];
    ownedMap = new Map((res.owned || []).map((o) => [o.cardId, o]));

    const stats = res.stats || { owned: ownedMap.size, total: allCardsCache.length };
    document.getElementById("progress-label").textContent =
      `${stats.owned} / ${stats.total} cartes decouvertes`;
    const pct = stats.total ? Math.round((stats.owned / stats.total) * 100) : 0;
    document.getElementById("progress-fill").style.width = pct + "%";

    const rarityKeys = [...new Set(allCardsCache.map((c) => c.rarity?.key).filter(Boolean))];
    renderFilters(rarityKeys);
    renderGrid();

    document.getElementById("collection-zone").style.display = "block";
  } catch (e) {
    showError(
      "Erreur lors du chargement de la collection. Verifie que le workflow n8n 'collection' est actif. (" +
      e.message + ")"
    );
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  loadCollection();
});
