// Logique de la page d'échanges.
// Contrat n8n "trade" (POST { userId, action, ... }) :
// - action=create { toPseudo, offeredCardId, requestedCardId } -> { tradeId, status }
// - action=list -> { trades: [{ tradeId, direction, fromPseudo, toPseudo,
//     offeredCard: {id,name}, requestedCard: {id,name}, status, createdAt, respondedAt }] }
// - action=respond { tradeId, accept } -> { tradeId, status }
// - action=cancel { tradeId } -> { tradeId, status }

const TRADE_ERROR_MESSAGES = {
  user_not_found: "Aucun joueur ne porte ce pseudo.",
  cannot_trade_self: "Tu ne peux pas t'echanger une carte avec toi-meme.",
  card_not_owned: "Tu ne possèdes pas cette carte.",
  trade_not_found: "Échange introuvable.",
  not_your_trade: "Cet échange ne te concerne pas.",
  trade_not_pending: "Cet échange n'est plus en attente.",
  cards_no_longer_available: "Une des deux cartes n'est plus disponible (deja echangee ailleurs).",
  promo_not_tradeable: "Les cartes promo ne sont pas echangeables."
};

const STATUS_LABELS = {
  pending: "En attente",
  accepted: "Accepte",
  declined: "Refuse",
  cancelled: "Annule"
};

let myOwnedCards = [];
let allCards = [];
let allTradesCache = [];
let historySearch = "";
let bulkCancelMode = false;
let bulkCancelSelected = new Set();
let activeTradeTab = "incoming";

function setActiveTradeTab(tab) {
  activeTradeTab = tab;
  document.getElementById("tab-incoming-btn").classList.toggle("active", tab === "incoming");
  document.getElementById("tab-incoming-btn").setAttribute("aria-selected", String(tab === "incoming"));
  document.getElementById("tab-outgoing-btn").classList.toggle("active", tab === "outgoing");
  document.getElementById("tab-outgoing-btn").setAttribute("aria-selected", String(tab === "outgoing"));
  document.getElementById("incoming-pane").style.display = tab === "incoming" ? "block" : "none";
  document.getElementById("outgoing-pane").style.display = tab === "outgoing" ? "block" : "none";
}

async function loadFormOptions() {
  const [collection, cardsRes, usersRes] = await Promise.all([
    API.getCollection(Session.userId),
    API.getCards(),
    API.listUsers()
  ]);

  const ownedMap = new Map((collection.owned || []).map((o) => [o.cardId, o]));
  allCards = (cardsRes.cards || []).filter((c) => !c.isPromo);
  myOwnedCards = allCards.filter((c) => ownedMap.has(c.cardId));

  const offeredSelect = document.getElementById("offered-card-select");
  offeredSelect.innerHTML = myOwnedCards
    .map((c) => `<option value="${c.cardId}">${c.name} (x${ownedMap.get(c.cardId).count})</option>`)
    .join("") || `<option value="">Aucune carte possédée</option>`;

  const requestedSelect = document.getElementById("requested-card-select");
  requestedSelect.innerHTML = `<option value="">Aucune (don)</option>` + allCards
    .map((c) => `<option value="${c.cardId}">${c.name}</option>`)
    .join("");

  const targetSelect = document.getElementById("target-select");
  const users = (usersRes.users || []).filter((u) => String(u.userId) !== String(Session.userId));
  targetSelect.innerHTML = users
    .map((u) => `<option value="${u.pseudo}">${u.pseudo}</option>`)
    .join("") || `<option value="">Aucun autre joueur</option>`;

  updateCardPreview("offered-card-select", "offered-card-preview");
  updateCardPreview("requested-card-select", "requested-card-preview");
}

function updateCardPreview(selectId, previewId) {
  const select = document.getElementById(selectId);
  const preview = document.getElementById(previewId);
  if (!select || !preview) return;
  const card = allCards.find((c) => String(c.cardId) === select.value);
  preview.src = (card && API.imageUrl(card.imageId)) || PLACEHOLDER_IMG;
}

function renderTradeCard(trade) {
  const el = document.createElement("div");
  el.className = "trade-card";
  el.dataset.status = trade.status;
  const statusClass = "trade-status-" + trade.status;

  const canBulkCancel = bulkCancelMode && trade.direction === "outgoing" && trade.status === "pending";
  let actions = "";
  if (trade.status === "pending") {
    if (trade.direction === "incoming") {
      actions = `
        <button class="btn-secondary accept-btn" data-id="${trade.tradeId}">Accepter</button>
        <button class="btn-ghost decline-btn" data-id="${trade.tradeId}">Refuser</button>
      `;
    } else if (!bulkCancelMode) {
      actions = `<button class="btn-ghost cancel-btn" data-id="${trade.tradeId}">Annuler</button>`;
    }
  }

  const requestPart = trade.requestedCard
    ? `contre <strong>${trade.requestedCard.name}</strong> a <strong>${trade.toPseudo}</strong>`
    : `en cadeau a <strong>${trade.toPseudo}</strong> (aucune contrepartie)`;
  el.innerHTML = `
    ${canBulkCancel ? `<label class="bulk-checkbox" style="position:static;"><input type="checkbox" data-bulk-trade-id="${trade.tradeId}" ${bulkCancelSelected.has(trade.tradeId) ? "checked" : ""} /></label>` : ""}
    <div class="trade-info">
      <div><strong>${trade.fromPseudo}</strong> offre <strong>${trade.offeredCard.name}</strong> ${requestPart}</div>
      <span class="trade-status ${statusClass}">${STATUS_LABELS[trade.status] || trade.status}</span>
    </div>
    <div class="trade-actions">${actions}</div>
  `;

  el.querySelectorAll(".accept-btn").forEach((b) => b.addEventListener("click", () => respond(b.dataset.id, true)));
  el.querySelectorAll(".decline-btn").forEach((b) => b.addEventListener("click", () => respond(b.dataset.id, false)));
  el.querySelectorAll(".cancel-btn").forEach((b) => b.addEventListener("click", () => cancel(b.dataset.id)));
  el.querySelectorAll("[data-bulk-trade-id]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = Number(cb.dataset.bulkTradeId);
      if (e.target.checked) bulkCancelSelected.add(id); else bulkCancelSelected.delete(id);
      updateBulkCancelBar();
    });
  });

  return el;
}

// Affiche une liste d'échanges dans un conteneur, en separant "en attente"
// (action possible) de "termine" (historique en lecture seule). Filtrable
// par pseudo de l'autre joueur (voir #trade-history-search).
function renderTradeGroup(container, trades, emptyLabel) {
  container.innerHTML = "";
  const filtered = historySearch
    ? trades.filter((t) => {
        const other = t.direction === "incoming" ? t.fromPseudo : t.toPseudo;
        return (other || "").toLowerCase().includes(historySearch.toLowerCase());
      })
    : trades;
  if (!filtered.length) {
    container.append(Object.assign(document.createElement("div"), { className: "empty-state", textContent: historySearch ? "Aucun échange avec ce joueur." : emptyLabel }));
    return;
  }
  const pending = filtered.filter((t) => t.status === "pending");
  const done = filtered.filter((t) => t.status !== "pending");
  if (pending.length) {
    container.append(...pending.map((t) => renderTradeCard(t)));
  }
  if (done.length) {
    const heading = document.createElement("h2");
    heading.textContent = "Termine";
    heading.style.fontSize = "0.95rem";
    heading.style.margin = "14px 0 6px";
    heading.style.color = "var(--text-dim)";
    container.append(heading, ...done.map((t) => renderTradeCard(t)));
  }
}

function renderAllTrades() {
  const incoming = document.getElementById("incoming-trades");
  const outgoing = document.getElementById("outgoing-trades");
  const incomingTrades = allTradesCache.filter((t) => t.direction === "incoming");
  const outgoingTrades = allTradesCache.filter((t) => t.direction === "outgoing");
  renderTradeGroup(incoming, incomingTrades, "Aucun échange recu.");
  renderTradeGroup(outgoing, outgoingTrades, "Aucun échange envoye.");

  // Le compteur sur "Recus" met en avant les demandes EN ATTENTE (celles qui
  // demandent une action), pas le total de l'historique.
  const incomingPending = incomingTrades.filter((t) => t.status === "pending").length;
  const incomingCountEl = document.getElementById("incoming-count");
  incomingCountEl.textContent = incomingPending ? String(incomingPending) : "";
  incomingCountEl.classList.toggle("tab-count-alert", incomingPending > 0);
  document.getElementById("outgoing-count").textContent = outgoingTrades.length ? String(outgoingTrades.length) : "";

  updateBulkCancelBar();
}

function updateBulkCancelBar() {
  const bar = document.getElementById("bulk-cancel-bar");
  if (!bar) return;
  if (!bulkCancelMode || bulkCancelSelected.size === 0) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "flex";
  document.getElementById("bulk-cancel-summary").textContent =
    `${bulkCancelSelected.size} échange${bulkCancelSelected.size > 1 ? "s" : ""} sélectionné${bulkCancelSelected.size > 1 ? "s" : ""}`;
}

// Notifie quand un envoi passe de "en attente" a "accepte"/"refuse" depuis
// la derniere visite (l'inverse - une nouvelle demande RECUE - est deja
// gere globalement dans main.js/loadNavBadges).
const TRADE_STATUS_SEEN_KEY = "2gatcha_trade_status_seen";
function checkOutgoingStatusChanges(trades) {
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(TRADE_STATUS_SEEN_KEY) || "{}"); } catch (e) {}
  trades.filter((t) => t.direction === "outgoing").forEach((t) => {
    const prev = seen[t.tradeId];
    if (prev === "pending" && (t.status === "accepted" || t.status === "declined")) {
      Toast.info(`${t.toPseudo} a ${t.status === "accepted" ? "accepté" : "refusé"} ton échange de ${t.offeredCard.name}.`);
    }
    seen[t.tradeId] = t.status;
  });
  try { localStorage.setItem(TRADE_STATUS_SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
}

async function loadTrades() {
  const loading = document.getElementById("trades-loading");
  if (loading) loading.style.display = "flex";
  try {
    const res = await API.listTrades(Session.userId);
    allTradesCache = res.trades || [];
    checkOutgoingStatusChanges(allTradesCache);
    renderAllTrades();
  } catch (e) {
    Toast.error("Impossible de charger les échanges. (" + e.message + ")");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

async function respond(tradeId, accept) {
  try {
    await API.respondTrade(Session.userId, Number(tradeId), accept);
    Toast.success(accept ? "Échange accepte !" : "Échange refuse.");
    loadTrades();
  } catch (e) {
    Toast.error(TRADE_ERROR_MESSAGES[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

async function cancel(tradeId) {
  try {
    await API.cancelTrade(Session.userId, Number(tradeId));
    Toast.info("Échange annule.");
    loadTrades();
  } catch (e) {
    Toast.error(TRADE_ERROR_MESSAGES[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

async function bulkCancel() {
  const ids = [...bulkCancelSelected];
  if (!ids.length) return;
  const ok = await Confirm.show(`Annuler ces <strong>${ids.length} échanges</strong> en attente ?`, {
    title: "Annuler la sélection ?",
    confirmText: "Tout annuler",
    dangerous: true
  });
  if (!ok) return;
  let successCount = 0;
  for (const id of ids) {
    try {
      await API.cancelTrade(Session.userId, id);
      successCount++;
    } catch (e) { /* on continue avec les suivants */ }
  }
  Toast.info(`${successCount} échange${successCount > 1 ? "s" : ""} annulé${successCount > 1 ? "s" : ""}.`);
  bulkCancelSelected.clear();
  bulkCancelMode = false;
  document.getElementById("bulk-cancel-toggle").classList.remove("active");
  loadTrades();
}

// Suggestions d'échange : parmi les autres joueurs, qui possède en double
// une carte qu'on n'a pas du tout ? Verification bornee (au plus 15 autres
// joueurs) pour ne pas multiplier les requetes sur une grosse asso.
async function loadTradeSuggestions() {
  const zone = document.getElementById("trade-suggestions");
  if (!zone) return;
  try {
    const [usersRes, myCollection] = await Promise.all([
      API.listUsers(),
      API.getCollection(Session.userId)
    ]);
    const myOwnedIds = new Set((myCollection.owned || []).map((o) => o.cardId));
    const others = (usersRes.users || [])
      .filter((u) => String(u.userId) !== String(Session.userId) && u.pseudo)
      .slice(0, 15);
    if (!others.length) { zone.style.display = "none"; return; }

    const profiles = await Promise.all(
      others.map((u) => API.getPublicProfile(u.pseudo).then((p) => ({ pseudo: u.pseudo, profile: p })).catch(() => null))
    );

    const suggestions = [];
    profiles.filter(Boolean).forEach(({ pseudo, profile }) => {
      (profile.cards || []).forEach((c) => {
        if (c.count > 1 && !c.isPromo && !myOwnedIds.has(c.cardId)) {
          suggestions.push({ pseudo, cardName: c.name, colorHex: c.rarity?.colorHex });
        }
      });
    });

    if (!suggestions.length) { zone.style.display = "none"; return; }
    zone.style.display = "block";
    document.getElementById("trade-suggestions-list").innerHTML = suggestions.slice(0, 8).map((s) => `
      <div class="suggestion-row">
        <span>&#128161; <strong>${s.pseudo}</strong> a un doublon de <strong style="color:${s.colorHex || "inherit"};">${s.cardName}</strong> que tu n'as pas.</span>
        <a class="btn-ghost" href="profile.html?pseudo=${encodeURIComponent(s.pseudo)}">Voir son profil</a>
      </div>
    `).join("");
  } catch (e) {
    zone.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("trade-zone").style.display = "block";

  try {
    await loadFormOptions();
  } catch (e) {
    Toast.error("Impossible de charger tes cartes. (" + e.message + ")");
  }
  loadTrades();

  document.getElementById("offered-card-select").addEventListener("change", () => updateCardPreview("offered-card-select", "offered-card-preview"));
  document.getElementById("requested-card-select").addEventListener("change", () => updateCardPreview("requested-card-select", "requested-card-preview"));
  enhanceSelect(document.getElementById("offered-card-select"));
  enhanceSelect(document.getElementById("requested-card-select"));
  enhanceSelect(document.getElementById("target-select"));

  document.getElementById("tab-incoming-btn").addEventListener("click", () => setActiveTradeTab("incoming"));
  document.getElementById("tab-outgoing-btn").addEventListener("click", () => setActiveTradeTab("outgoing"));

  document.getElementById("create-trade-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const offeredCardId = Number(document.getElementById("offered-card-select").value);
    const requestedRaw = document.getElementById("requested-card-select").value;
    const requestedCardId = requestedRaw ? Number(requestedRaw) : null;
    const toPseudo = document.getElementById("target-select").value;
    if (!offeredCardId || !toPseudo) return;

    try {
      await API.createTrade(Session.userId, toPseudo, offeredCardId, requestedCardId);
      Toast.success("Échange propose !");
      loadTrades();
    } catch (err) {
      Toast.error(TRADE_ERROR_MESSAGES[err.code] || ("Erreur. (" + err.message + ")"));
    }
  });

  let historyTimer = null;
  document.getElementById("trade-history-search").addEventListener("input", (e) => {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => { historySearch = e.target.value; renderAllTrades(); }, 150);
  });

  document.getElementById("bulk-cancel-toggle").addEventListener("click", (e) => {
    bulkCancelMode = !bulkCancelMode;
    bulkCancelSelected.clear();
    e.target.classList.toggle("active", bulkCancelMode);
    renderAllTrades();
  });
  document.getElementById("bulk-cancel-btn").addEventListener("click", bulkCancel);

  loadTradeSuggestions();
});
