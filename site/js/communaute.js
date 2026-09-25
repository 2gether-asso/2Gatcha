// Logique de la page Communauté : Calendrier, Boss commun, Coffre de guilde,
// Marché noir. Les onglets Boss/Coffre partagent le meme chargement de
// collection (allCards/ownedMap), comme craft.js.

const BOSS_ERRORS = {
  no_active_boss: "Aucun boss actif pour l'instant.",
  card_not_found: "Carte introuvable.",
  promo_not_donatable: "Cette carte promo ne peut pas être donnée.",
  card_not_owned: "Tu ne possèdes pas cette carte."
};
const CHEST_ERRORS = {
  card_not_found: "Carte introuvable.",
  promo_not_donatable: "Cette carte promo ne peut pas être donnée.",
  card_not_owned: "Tu ne possèdes pas cette carte.",
  already_drawn_today: "Tu as déjà pioché aujourd'hui, reviens demain.",
  chest_empty: "Le coffre est vide pour l'instant, reviens plus tard."
};
const MARKET_ERRORS = {
  offer_not_found: "Offre introuvable.",
  offer_inactive: "Cette offre n'est plus active.",
  offer_expired: "Cette offre a expiré.",
  offer_exhausted: "Cette offre est épuisée.",
  insufficient_dust: "Pas assez de poussières d'étoile.",
  sold_out: "Tous les exemplaires de cette carte ont déjà été distribués."
};

let allCards = [];
let ownedMap = new Map();
let activeTab = "calendar";
let bossSearchQuery = "";
let chestSearchQuery = "";

function normalize(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function setActiveTab(tab) {
  activeTab = tab;
  ["calendar", "boss", "chest", "market"].forEach((key) => {
    document.getElementById(`tab-${key}-btn`).classList.toggle("active", tab === key);
    document.getElementById(`tab-${key}-btn`).setAttribute("aria-selected", String(tab === key));
    document.getElementById(`${key}-pane`).style.display = tab === key ? "block" : "none";
  });
  if (tab === "boss") loadBoss();
  if (tab === "chest") loadChest();
  if (tab === "market") loadMarket();
}

async function loadCalendar() {
  const loading = document.getElementById("calendar-loading");
  const list = document.getElementById("calendar-list");
  try {
    const res = await API.getEventCalendar();
    const events = res.events || [];
    list.innerHTML = events.length ? events.map((e) => {
      const when = e.startsAt ? new Date(e.startsAt * 1000).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : null;
      return `
        <div class="quest-row ${e.isLive ? "done" : ""}">
          <span class="quest-icon">${e.isLive ? "&#128994;" : "&#128197;"}</span>
          <span class="quest-label">${e.label}${when ? ` — ${e.isLive ? "en cours" : `dès le ${when}`}` : ""}</span>
        </div>
      `;
    }).join("") : `<div class="empty-state">Aucun évènement prévu pour l'instant.</div>`;
  } catch (e) {
    list.innerHTML = `<div class="empty-state">Impossible de charger le calendrier.</div>`;
  } finally {
    loading.style.display = "none";
  }
}

async function ensureCollectionLoaded() {
  if (allCards.length) return;
  const [cardsRes, collectionRes] = await Promise.all([API.getCards(), API.getCollection(Session.userId)]);
  allCards = cardsRes.cards || [];
  ownedMap = new Map((collectionRes.owned || []).map((o) => [o.cardId, o]));
}

function donatableCardTile(card, actionLabel, actionClass) {
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  const owned = ownedMap.get(card.cardId);
  return `
    <div class="craft-card" data-card-id="${card.cardId}" data-rarity="${card.rarity?.key || "commune"}">
      <img src="${imgSrc}" alt="${card.name}" loading="lazy" />
      <div class="card-info">
        <div class="card-name">${card.name}</div>
        <div class="owned-count">Possède x${owned.count}</div>
        <button class="${actionClass}" data-card-id="${card.cardId}">${actionLabel}</button>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------
// Boss communautaire
// -----------------------------------------------------------------------
async function loadBoss() {
  if (!Session.isLoggedIn()) {
    document.getElementById("boss-guest-warning").style.display = "block";
    return;
  }
  document.getElementById("boss-zone").style.display = "block";
  try {
    await ensureCollectionLoaded();
    const res = await API.getBossStatus(Session.userId);
    if (!res.active) {
      document.getElementById("boss-no-active").style.display = "block";
      document.getElementById("boss-active-zone").style.display = "none";
      return;
    }
    document.getElementById("boss-no-active").style.display = "none";
    document.getElementById("boss-active-zone").style.display = "block";
    document.getElementById("boss-name").textContent = `${res.bossName}`;
    document.getElementById("boss-my-contribution").textContent = `Tes dégâts : ${res.myContribution || 0}`;
    const pct = res.maxHp ? Math.max(0, Math.round((res.currentHp / res.maxHp) * 100)) : 0;
    document.getElementById("boss-hp-fill").style.width = pct + "%";
    document.getElementById("boss-hp-label").textContent = `${res.currentHp} / ${res.maxHp} PV`;
    renderBossGrid();
  } catch (e) {
    Toast.error("Impossible de charger le boss.");
  }
}

function renderBossGrid() {
  const grid = document.getElementById("boss-card-grid");
  let donatable = allCards.filter((c) => !c.isPromo && ownedMap.has(c.cardId));
  if (bossSearchQuery) {
    const q = normalize(bossSearchQuery);
    donatable = donatable.filter((c) => normalize(c.name).includes(q));
  }
  grid.innerHTML = donatable.length
    ? donatable.map((c) => donatableCardTile(c, "Attaquer", "btn-danger boss-attack-btn")).join("")
    : `<div class="empty-state">Aucune carte à donner ne correspond.</div>`;
  grid.querySelectorAll(".boss-attack-btn").forEach((btn) => {
    btn.addEventListener("click", () => attackBoss(Number(btn.dataset.cardId)));
  });
}

async function attackBoss(cardId) {
  const card = allCards.find((c) => c.cardId === cardId);
  const ok = await Confirm.show(
    `Donner <strong>${card?.name || "cette carte"}</strong> pour attaquer le boss ? L'exemplaire sera définitivement détruit.`,
    { title: "Attaquer le boss ?", confirmText: "Attaquer", dangerous: true }
  );
  if (!ok) return;
  try {
    const res = await API.attackBoss(Session.userId, cardId);
    if (res.defeated) {
      Toast.success(`Boss vaincu ! +${res.rewardBoosters} boosters pour tous les participants !`);
      if (typeof confetti === "function") confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } });
    } else {
      Toast.success(`-${res.damage} PV (${card?.name})`);
    }
    await loadBoss();
  } catch (e) {
    Toast.error(BOSS_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

// -----------------------------------------------------------------------
// Coffre de guilde
// -----------------------------------------------------------------------
async function loadChest() {
  if (!Session.isLoggedIn()) {
    document.getElementById("chest-guest-warning").style.display = "block";
    return;
  }
  document.getElementById("chest-zone").style.display = "block";
  try {
    await ensureCollectionLoaded();
    const res = await API.getGuildChestStatus(Session.userId);
    const statusText = document.getElementById("chest-status-text");
    const drawBtn = document.getElementById("chest-draw-btn");
    statusText.textContent = `${res.poolSize} carte${res.poolSize > 1 ? "s" : ""} disponible${res.poolSize > 1 ? "s" : ""} dans le pot commun.`;
    if (res.alreadyDrawnToday) {
      drawBtn.style.display = "none";
      statusText.textContent += " Tu as déjà pioché aujourd'hui.";
    } else {
      drawBtn.style.display = res.poolSize > 0 ? "inline-flex" : "none";
    }
    renderChestGrid();
  } catch (e) {
    Toast.error("Impossible de charger le coffre.");
  }
}

function renderChestGrid() {
  const grid = document.getElementById("chest-card-grid");
  let donatable = allCards.filter((c) => !c.isPromo && ownedMap.has(c.cardId));
  if (chestSearchQuery) {
    const q = normalize(chestSearchQuery);
    donatable = donatable.filter((c) => normalize(c.name).includes(q));
  }
  grid.innerHTML = donatable.length
    ? donatable.map((c) => donatableCardTile(c, "Déposer", "btn-secondary chest-deposit-btn")).join("")
    : `<div class="empty-state">Aucune carte à déposer ne correspond.</div>`;
  grid.querySelectorAll(".chest-deposit-btn").forEach((btn) => {
    btn.addEventListener("click", () => depositChest(Number(btn.dataset.cardId)));
  });
}

async function depositChest(cardId) {
  const card = allCards.find((c) => c.cardId === cardId);
  const ok = await Confirm.show(
    `Déposer <strong>${card?.name || "cette carte"}</strong> dans le pot commun ? L'exemplaire quitte définitivement ta collection (un autre joueur pourra le piocher).`,
    { title: "Déposer cette carte ?", confirmText: "Déposer", dangerous: true }
  );
  if (!ok) return;
  try {
    await API.depositGuildChest(Session.userId, cardId);
    Toast.success(`${card?.name || "Carte"} déposée dans le coffre.`);
    allCards = [];
    await loadChest();
  } catch (e) {
    Toast.error(CHEST_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

document.addEventListener("click", async (e) => {
  if (e.target && e.target.id === "chest-draw-btn") {
    try {
      const res = await API.drawGuildChest(Session.userId);
      Toast.success(`Tu as pioché : ${res.card?.name || "une carte"} !`);
      if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
      allCards = [];
      await loadChest();
    } catch (err) {
      Toast.error(CHEST_ERRORS[err.code] || ("Erreur. (" + err.message + ")"));
    }
  }
});

// -----------------------------------------------------------------------
// Marché noir
// -----------------------------------------------------------------------
async function loadMarket() {
  if (!Session.isLoggedIn()) {
    document.getElementById("market-guest-warning").style.display = "block";
    return;
  }
  document.getElementById("market-zone").style.display = "block";
  const loading = document.getElementById("market-loading");
  const grid = document.getElementById("market-grid");
  try {
    const res = await API.listBlackMarket(Session.userId);
    const offers = res.offers || [];
    grid.innerHTML = offers.length ? offers.map((o) => {
      const imgSrc = API.imageUrl(o.card.imageId) || PLACEHOLDER_IMG;
      return `
        <div class="craft-card" data-rarity="${o.card.rarity?.key || "commune"}">
          <img src="${imgSrc}" alt="${o.card.name}" loading="lazy" />
          <div class="card-info">
            <div class="card-name">${o.card.name}</div>
            <div class="craft-cost">${o.cost} poussières${o.remaining != null ? ` · ${o.remaining} restant${o.remaining > 1 ? "s" : ""}` : ""}</div>
            <button class="btn-secondary market-buy-btn" data-offer-id="${o.offerId}">Acheter</button>
          </div>
        </div>
      `;
    }).join("") : `<div class="empty-state">Aucune offre active pour l'instant.</div>`;
    grid.querySelectorAll(".market-buy-btn").forEach((btn) => {
      btn.addEventListener("click", () => buyMarket(Number(btn.dataset.offerId)));
    });
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">Impossible de charger le marché noir.</div>`;
  } finally {
    loading.style.display = "none";
  }
}

async function buyMarket(offerId) {
  const ok = await Confirm.show(`Acheter cette offre du marché noir ?`, { title: "Confirmer l'achat", confirmText: "Acheter" });
  if (!ok) return;
  try {
    const res = await API.buyBlackMarket(Session.userId, offerId);
    Toast.success(`${res.cardName || "Carte"} achetée !`);
    if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
    await loadMarket();
  } catch (e) {
    Toast.error(MARKET_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadCalendar();

  document.getElementById("tab-calendar-btn").addEventListener("click", () => setActiveTab("calendar"));
  document.getElementById("tab-boss-btn").addEventListener("click", () => setActiveTab("boss"));
  document.getElementById("tab-chest-btn").addEventListener("click", () => setActiveTab("chest"));
  document.getElementById("tab-market-btn").addEventListener("click", () => setActiveTab("market"));

  let bossSearchTimer = null;
  document.getElementById("boss-search-input").addEventListener("input", (e) => {
    clearTimeout(bossSearchTimer);
    bossSearchTimer = setTimeout(() => { bossSearchQuery = e.target.value; renderBossGrid(); }, 200);
  });
  let chestSearchTimer = null;
  document.getElementById("chest-search-input").addEventListener("input", (e) => {
    clearTimeout(chestSearchTimer);
    chestSearchTimer = setTimeout(() => { chestSearchQuery = e.target.value; renderChestGrid(); }, 200);
  });
});
