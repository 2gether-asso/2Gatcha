// Logique de la page craft/decraft.
// Contrat n8n "disenchant" (POST { userId, cardId }) :
//   { disenchanted, cardName, dustGained, newStardust }
// Contrat n8n "craft" (POST { userId, cardId }) :
//   { crafted, card: { cardId, name, artist, imageId, rarity }, craftCost, newStardust }

const DISENCHANT_ERRORS = {
  card_not_found: "Carte introuvable.",
  promo_not_disenchantable: "Cette carte promo ne peut pas etre decraftee.",
  card_not_owned: "Tu ne possèdes pas cette carte."
};
const CRAFT_ERRORS = {
  card_not_found: "Carte introuvable.",
  promo_not_craftable: "Cette carte promo ne peut pas etre craftee.",
  card_inactive: "Cette carte n'est plus disponible.",
  insufficient_dust: "Pas assez de poussières d'etoile."
};

let stardust = 0;
let ownedMap = new Map();
let allCards = [];
let bulkSelectMode = false;
let bulkSelected = new Set();
let activeTab = "disenchant";
let craftSearchQuery = "";
let craftRarityFilter = "all";
let hideOwned = false;

function normalize(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function renderCraftFilters() {
  const el = document.getElementById("craft-rarity-filters");
  const rarityByKey = new Map();
  allCards.forEach((c) => {
    if (c.rarity?.key && !rarityByKey.has(c.rarity.key)) {
      rarityByKey.set(c.rarity.key, { key: c.rarity.key, name: c.rarity.name || c.rarity.key, sortOrder: c.rarity.sortOrder ?? 999 });
    }
  });
  const rarities = [...rarityByKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  const items = [{ key: "all", name: "Toutes" }, ...rarities];
  el.innerHTML = items.map(({ key, name }) =>
    `<button type="button" data-filter="${key}" class="btn-secondary ${key === craftRarityFilter ? "active" : ""}">${name}</button>`
  ).join("");
  el.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      craftRarityFilter = btn.dataset.filter;
      el.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      renderDisenchantGrid();
      renderCraftGrid();
    });
  });
}

function setActiveTab(tab) {
  activeTab = tab;
  document.getElementById("tab-disenchant-btn").classList.toggle("active", tab === "disenchant");
  document.getElementById("tab-disenchant-btn").setAttribute("aria-selected", String(tab === "disenchant"));
  document.getElementById("tab-craft-btn").classList.toggle("active", tab === "craft");
  document.getElementById("tab-craft-btn").setAttribute("aria-selected", String(tab === "craft"));
  document.getElementById("disenchant-pane").style.display = tab === "disenchant" ? "block" : "none";
  document.getElementById("craft-pane").style.display = tab === "craft" ? "block" : "none";
  document.getElementById("hide-owned-label").style.display = tab === "craft" ? "flex" : "none";
  document.getElementById("craft-search-input").placeholder =
    tab === "disenchant" ? "Rechercher parmi mes cartes..." : "Rechercher une carte à crafter...";
}

function craftCardTile(card, mode) {
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  if (mode === "disenchant") {
    const owned = ownedMap.get(card.cardId);
    const dust = card.rarity?.disenchantValue || 0;
    const checked = bulkSelected.has(card.cardId);
    return `
      <div class="craft-card ${bulkSelectMode ? "bulk-mode" : ""} ${checked ? "selected" : ""}" data-card-id="${card.cardId}">
        ${bulkSelectMode ? `<label class="bulk-checkbox"><input type="checkbox" data-bulk-id="${card.cardId}" ${checked ? "checked" : ""} /></label>` : ""}
        <img src="${imgSrc}" alt="${card.name}" loading="lazy" />
        <div class="card-info">
          <div class="card-name">${card.name}</div>
          <div class="owned-count">Possède x${owned.count}</div>
          <div class="craft-cost">+${dust} poussières</div>
          <button class="disenchant-btn" data-card-id="${card.cardId}" ${bulkSelectMode ? "disabled" : ""}>Decrafter</button>
        </div>
      </div>
    `;
  }
  const cost = card.rarity?.craftCost || 0;
  const canAfford = stardust >= cost;
  return `
    <div class="craft-card ${canAfford ? "" : "unavailable"}" data-card-id="${card.cardId}">
      <img src="${imgSrc}" alt="${card.name}" loading="lazy" />
      <div class="card-info">
        <div class="card-name">${card.name}</div>
        <div class="craft-cost">${cost} poussières</div>
        <button class="craft-btn" data-card-id="${card.cardId}" ${canAfford ? "" : "disabled"}>Crafter</button>
      </div>
    </div>
  `;
}

// Suivi via ?cardId=... (lien direct depuis la collection) : met la carte
// en evidence et scrolle jusqu'a elle une fois la grille rendue.
function highlightCardFromQuery() {
  const cardId = new URLSearchParams(window.location.search).get("cardId");
  if (!cardId) return;
  const el = document.querySelector(`.craft-card[data-card-id="${cardId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("highlighted");
  setTimeout(() => el.classList.remove("highlighted"), 2200);
}

// Signale discretement qu'il y a assez de poussieres pour crafter au moins
// une carte manquante, plutot que de laisser un solde dormir sans le savoir.
function renderUnusedDustReminder() {
  const el = document.getElementById("unused-dust-reminder");
  if (!el) return;
  const cheapestMissing = allCards
    .filter((c) => !c.isPromo && !ownedMap.has(c.cardId) && c.rarity?.craftCost != null)
    .sort((a, b) => a.rarity.craftCost - b.rarity.craftCost)[0];
  if (cheapestMissing && stardust >= cheapestMissing.rarity.craftCost) {
    el.style.display = "flex";
    el.innerHTML = `&#10024; Tu as assez de poussières pour crafter au moins une carte manquante (dès ${cheapestMissing.rarity.craftCost}).`;
  } else {
    el.style.display = "none";
  }
}

function renderDisenchantGrid() {
  const grid = document.getElementById("disenchant-grid");
  let disenchantable = allCards.filter((c) => !c.isPromo && ownedMap.has(c.cardId));
  if (craftRarityFilter !== "all") disenchantable = disenchantable.filter((c) => c.rarity?.key === craftRarityFilter);
  if (craftSearchQuery) {
    const q = normalize(craftSearchQuery);
    disenchantable = disenchantable.filter((c) => normalize(c.name).includes(q));
  }
  // Les plus rentables a decrafter en premier : ca aide a decider par ou
  // commencer quand on a beaucoup de doublons a ecouler.
  disenchantable = [...disenchantable].sort((a, b) => (b.rarity?.disenchantValue || 0) - (a.rarity?.disenchantValue || 0));
  grid.innerHTML = disenchantable.length
    ? disenchantable.map((c) => craftCardTile(c, "disenchant")).join("")
    : `<div class="empty-state">Aucune carte decraftable ne correspond.</div>`;
  grid.querySelectorAll(".disenchant-btn").forEach((btn) => {
    btn.addEventListener("click", () => disenchant(Number(btn.dataset.cardId)));
  });
  grid.querySelectorAll("[data-bulk-id]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = Number(cb.dataset.bulkId);
      if (e.target.checked) bulkSelected.add(id); else bulkSelected.delete(id);
      cb.closest(".craft-card").classList.toggle("selected", e.target.checked);
      updateBulkBar();
    });
  });
}

function updateBulkBar() {
  const bar = document.getElementById("bulk-disenchant-bar");
  if (!bulkSelectMode || bulkSelected.size === 0) {
    bar.style.display = "none";
    return;
  }
  const dust = [...bulkSelected].reduce((sum, id) => {
    const card = allCards.find((c) => c.cardId === id);
    return sum + (card?.rarity?.disenchantValue || 0);
  }, 0);
  bar.style.display = "flex";
  document.getElementById("bulk-disenchant-summary").textContent =
    `${bulkSelected.size} carte${bulkSelected.size > 1 ? "s" : ""} sélectionnée${bulkSelected.size > 1 ? "s" : ""} · +${dust} poussières`;
}

async function bulkDisenchant() {
  const ids = [...bulkSelected];
  if (!ids.length) return;
  const dust = ids.reduce((sum, id) => sum + (allCards.find((c) => c.cardId === id)?.rarity?.disenchantValue || 0), 0);
  const ok = await Confirm.show(
    `Décrafter ces <strong>${ids.length} cartes</strong> pour <strong>+${dust} poussières d'étoile</strong> ? ` +
    `Solde : ${stardust} &rarr; <strong>${stardust + dust}</strong>. Cette action est irréversible.`,
    { title: "Décrafter la sélection ?", confirmText: "Décrafter tout", dangerous: true }
  );
  if (!ok) return;
  let successCount = 0;
  for (const id of ids) {
    try {
      await API.disenchantCard(Session.userId, id);
      successCount++;
    } catch (e) { /* on continue avec les suivantes */ }
  }
  Toast.success(`${successCount} carte${successCount > 1 ? "s" : ""} décraftée${successCount > 1 ? "s" : ""}.`);
  bulkSelected.clear();
  bulkSelectMode = false;
  document.getElementById("bulk-select-toggle").classList.remove("active");
  await reload();
}

function renderCraftGrid() {
  const grid = document.getElementById("craft-grid");
  let craftable = allCards.filter((c) => !c.isPromo);
  if (hideOwned) craftable = craftable.filter((c) => !ownedMap.has(c.cardId));
  if (craftRarityFilter !== "all") craftable = craftable.filter((c) => c.rarity?.key === craftRarityFilter);
  if (craftSearchQuery) {
    const q = normalize(craftSearchQuery);
    craftable = craftable.filter((c) => normalize(c.name).includes(q));
  }
  // Ce qu'on peut déjà se permettre en premier, puis par cout croissant :
  // priorise les cartes les plus a portee de main plutot qu'un ordre brut.
  craftable = [...craftable].sort((a, b) => {
    const affordA = stardust >= (a.rarity?.craftCost || 0) ? 0 : 1;
    const affordB = stardust >= (b.rarity?.craftCost || 0) ? 0 : 1;
    if (affordA !== affordB) return affordA - affordB;
    return (a.rarity?.craftCost || 0) - (b.rarity?.craftCost || 0);
  });
  grid.innerHTML = craftable.length
    ? craftable.map((c) => craftCardTile(c, "craft")).join("")
    : `<div class="empty-state">Aucune carte craftable ne correspond.</div>`;
  grid.querySelectorAll(".craft-btn").forEach((btn) => {
    btn.addEventListener("click", () => craftCard(Number(btn.dataset.cardId)));
  });
}

async function disenchant(cardId) {
  const card = allCards.find((c) => c.cardId === cardId);
  const dust = card?.rarity?.disenchantValue || 0;
  const ok = await Confirm.show(
    `Décrafter <strong>${card?.name || "cette carte"}</strong> contre <strong>${dust} poussières d'étoile</strong> ? ` +
    `Solde : ${stardust} &rarr; <strong>${stardust + dust}</strong>. Cette action est irréversible : l'exemplaire sera définitivement détruit.`,
    { title: "Décrafter cette carte ?", confirmText: "Décrafter", dangerous: true }
  );
  if (!ok) return;
  try {
    const res = await API.disenchantCard(Session.userId, cardId);
    Toast.success(`+${res.dustGained} poussières (${res.cardName})`);
    await reload();
  } catch (e) {
    Toast.error(DISENCHANT_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

async function craftCard(cardId) {
  const card = allCards.find((c) => c.cardId === cardId);
  const cost = card?.rarity?.craftCost || 0;
  const ok = await Confirm.show(
    `Crafter <strong>${card?.name || "cette carte"}</strong> pour <strong>${cost} poussières d'étoile</strong> ? ` +
    `Solde : ${stardust} &rarr; <strong>${stardust - cost}</strong>.`,
    { title: "Crafter cette carte ?", confirmText: "Crafter" }
  );
  if (!ok) return;
  try {
    const res = await API.craftCard(Session.userId, cardId);
    Toast.success(`${res.card.name} craftee !`);
    if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
    await reload();
  } catch (e) {
    Toast.error(CRAFT_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

async function reload() {
  document.getElementById("disenchant-loading").style.display = "flex";
  document.getElementById("craft-loading").style.display = "flex";
  try {
    const [status, cardsRes, collectionRes] = await Promise.all([
      API.getBoosterStatus(Session.userId),
      API.getCards(),
      API.getCollection(Session.userId)
    ]);
    stardust = status.stardust || 0;
    document.getElementById("stardust-amount").textContent = stardust;
    allCards = cardsRes.cards || [];
    ownedMap = new Map((collectionRes.owned || []).map((o) => [o.cardId, o]));

    renderCraftFilters();
    renderDisenchantGrid();
    renderCraftGrid();
    renderUnusedDustReminder();
    highlightCardFromQuery();
  } catch (e) {
    Toast.error("Impossible de charger le craft. (" + e.message + ")");
  } finally {
    document.getElementById("disenchant-loading").style.display = "none";
    document.getElementById("craft-loading").style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("craft-zone").style.display = "block";
  setActiveTab("disenchant");
  reload();

  document.getElementById("tab-disenchant-btn").addEventListener("click", () => setActiveTab("disenchant"));
  document.getElementById("tab-craft-btn").addEventListener("click", () => setActiveTab("craft"));

  let craftSearchTimer = null;
  document.getElementById("craft-search-input").addEventListener("input", (e) => {
    clearTimeout(craftSearchTimer);
    craftSearchTimer = setTimeout(() => {
      craftSearchQuery = e.target.value;
      renderDisenchantGrid();
      renderCraftGrid();
    }, 150);
  });
  document.getElementById("hide-owned-toggle").addEventListener("change", (e) => {
    hideOwned = e.target.checked;
    renderCraftGrid();
  });

  document.getElementById("bulk-select-toggle").addEventListener("click", (e) => {
    bulkSelectMode = !bulkSelectMode;
    bulkSelected.clear();
    e.target.classList.toggle("active", bulkSelectMode);
    updateBulkBar();
    renderDisenchantGrid();
  });
  document.getElementById("bulk-disenchant-btn").addEventListener("click", bulkDisenchant);
});
