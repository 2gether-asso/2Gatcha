// Logique de la page d'echanges.
// Contrat n8n "trade" (POST { userId, action, ... }) :
// - action=create { toPseudo, offeredCardId, requestedCardId } -> { tradeId, status }
// - action=list -> { trades: [{ tradeId, direction, fromPseudo, toPseudo,
//     offeredCard: {id,name}, requestedCard: {id,name}, status, createdAt, respondedAt }] }
// - action=respond { tradeId, accept } -> { tradeId, status }
// - action=cancel { tradeId } -> { tradeId, status }

const TRADE_ERROR_MESSAGES = {
  user_not_found: "Aucun joueur ne porte ce pseudo.",
  cannot_trade_self: "Tu ne peux pas t'echanger une carte avec toi-meme.",
  card_not_owned: "Tu ne possedes pas cette carte.",
  trade_not_found: "Echange introuvable.",
  not_your_trade: "Cet echange ne te concerne pas.",
  trade_not_pending: "Cet echange n'est plus en attente.",
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
    .join("") || `<option value="">Aucune carte possedee</option>`;

  const requestedSelect = document.getElementById("requested-card-select");
  requestedSelect.innerHTML = allCards
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

function renderTradeCard(trade, mine) {
  const el = document.createElement("div");
  el.className = "trade-card";
  const statusClass = "trade-status-" + trade.status;

  let actions = "";
  if (trade.status === "pending") {
    if (trade.direction === "incoming") {
      actions = `
        <button class="btn-secondary accept-btn" data-id="${trade.tradeId}">Accepter</button>
        <button class="btn-ghost decline-btn" data-id="${trade.tradeId}">Refuser</button>
      `;
    } else {
      actions = `<button class="btn-ghost cancel-btn" data-id="${trade.tradeId}">Annuler</button>`;
    }
  }

  el.innerHTML = `
    <div class="trade-info">
      <div><strong>${trade.fromPseudo}</strong> offre <strong>${trade.offeredCard.name}</strong>
        contre <strong>${trade.requestedCard.name}</strong> a <strong>${trade.toPseudo}</strong></div>
      <span class="trade-status ${statusClass}">${STATUS_LABELS[trade.status] || trade.status}</span>
    </div>
    <div class="trade-actions">${actions}</div>
  `;

  el.querySelectorAll(".accept-btn").forEach((b) => b.addEventListener("click", () => respond(b.dataset.id, true)));
  el.querySelectorAll(".decline-btn").forEach((b) => b.addEventListener("click", () => respond(b.dataset.id, false)));
  el.querySelectorAll(".cancel-btn").forEach((b) => b.addEventListener("click", () => cancel(b.dataset.id)));

  return el;
}

async function loadTrades() {
  const loading = document.getElementById("trades-loading");
  if (loading) loading.style.display = "flex";
  try {
    const res = await API.listTrades(Session.userId);
    const trades = res.trades || [];
    const incoming = document.getElementById("incoming-trades");
    const outgoing = document.getElementById("outgoing-trades");

    const inList = trades.filter((t) => t.direction === "incoming");
    const outList = trades.filter((t) => t.direction === "outgoing");

    incoming.innerHTML = "";
    incoming.append(...(inList.length ? inList.map((t) => renderTradeCard(t)) : [Object.assign(document.createElement("div"), { className: "empty-state", textContent: "Aucun echange recu." })]));

    outgoing.innerHTML = "";
    outgoing.append(...(outList.length ? outList.map((t) => renderTradeCard(t)) : [Object.assign(document.createElement("div"), { className: "empty-state", textContent: "Aucun echange envoye." })]));
  } catch (e) {
    Toast.error("Impossible de charger les echanges. (" + e.message + ")");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

async function respond(tradeId, accept) {
  try {
    await API.respondTrade(Session.userId, Number(tradeId), accept);
    Toast.success(accept ? "Echange accepte !" : "Echange refuse.");
    loadTrades();
  } catch (e) {
    Toast.error(TRADE_ERROR_MESSAGES[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

async function cancel(tradeId) {
  try {
    await API.cancelTrade(Session.userId, Number(tradeId));
    Toast.info("Echange annule.");
    loadTrades();
  } catch (e) {
    Toast.error(TRADE_ERROR_MESSAGES[e.code] || ("Erreur. (" + e.message + ")"));
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

  document.getElementById("create-trade-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const offeredCardId = Number(document.getElementById("offered-card-select").value);
    const requestedCardId = Number(document.getElementById("requested-card-select").value);
    const toPseudo = document.getElementById("target-select").value;
    if (!offeredCardId || !requestedCardId || !toPseudo) return;

    try {
      await API.createTrade(Session.userId, toPseudo, offeredCardId, requestedCardId);
      Toast.success("Echange propose !");
      loadTrades();
    } catch (err) {
      Toast.error(TRADE_ERROR_MESSAGES[err.code] || ("Erreur. (" + err.message + ")"));
    }
  });
});
