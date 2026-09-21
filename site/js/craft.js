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

function craftCardTile(card, mode) {
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  if (mode === "disenchant") {
    const owned = ownedMap.get(card.cardId);
    const dust = card.rarity?.disenchantValue || 0;
    return `
      <div class="craft-card">
        <img src="${imgSrc}" alt="${card.name}" />
        <div class="card-info">
          <div class="card-name">${card.name}</div>
          <div class="owned-count">Possède x${owned.count}</div>
          <div class="craft-cost">+${dust} poussières</div>
          <button class="disenchant-btn" data-card-id="${card.cardId}">Decrafter</button>
        </div>
      </div>
    `;
  }
  const cost = card.rarity?.craftCost || 0;
  const canAfford = stardust >= cost;
  return `
    <div class="craft-card ${canAfford ? "" : "unavailable"}">
      <img src="${imgSrc}" alt="${card.name}" />
      <div class="card-info">
        <div class="card-name">${card.name}</div>
        <div class="craft-cost">${cost} poussières</div>
        <button class="craft-btn" data-card-id="${card.cardId}" ${canAfford ? "" : "disabled"}>Crafter</button>
      </div>
    </div>
  `;
}

function renderDisenchantGrid() {
  const grid = document.getElementById("disenchant-grid");
  const disenchantable = allCards.filter((c) => !c.isPromo && ownedMap.has(c.cardId));
  grid.innerHTML = disenchantable.length
    ? disenchantable.map((c) => craftCardTile(c, "disenchant")).join("")
    : `<div class="empty-state">Aucune carte decraftable pour l'instant.</div>`;
  grid.querySelectorAll(".disenchant-btn").forEach((btn) => {
    btn.addEventListener("click", () => disenchant(Number(btn.dataset.cardId)));
  });
}

function renderCraftGrid() {
  const grid = document.getElementById("craft-grid");
  const craftable = allCards.filter((c) => !c.isPromo);
  grid.innerHTML = craftable.length
    ? craftable.map((c) => craftCardTile(c, "craft")).join("")
    : `<div class="empty-state">Aucune carte craftable pour l'instant.</div>`;
  grid.querySelectorAll(".craft-btn").forEach((btn) => {
    btn.addEventListener("click", () => craftCard(Number(btn.dataset.cardId)));
  });
}

async function disenchant(cardId) {
  try {
    const res = await API.disenchantCard(Session.userId, cardId);
    Toast.success(`+${res.dustGained} poussières (${res.cardName})`);
    await reload();
  } catch (e) {
    Toast.error(DISENCHANT_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

async function craftCard(cardId) {
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

    renderDisenchantGrid();
    renderCraftGrid();
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
  reload();
});
