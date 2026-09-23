// Logique de la page d'échanges.
// Contrat n8n "trade" (POST { userId, action, ... }) :
// - action=create { toPseudo, offeredCardId, offeredPullId, requestedCardId } -> { tradeId, status }
// - action=counter { originalTradeId, offeredCardId, offeredPullId, requestedCardId } -> { tradeId, status }
// - action=list -> { trades: [{ tradeId, direction, fromPseudo, toPseudo,
//     offeredCard: {id,name}, offeredSerial, requestedCard: {id,name}, requestedSerial,
//     status, createdAt, respondedAt, counterOfTradeId }] }
// - action=respond { tradeId, accept, requestedPullId } -> { tradeId, status }
// - action=cancel { tradeId } -> { tradeId, status }

const TRADE_ERROR_MESSAGES = {
  user_not_found: "Aucun joueur ne porte ce pseudo.",
  cannot_trade_self: "Tu ne peux pas t'echanger une carte avec toi-meme.",
  card_not_owned: "Tu ne possèdes pas cette carte.",
  trade_not_found: "Échange introuvable.",
  not_your_trade: "Cet échange ne te concerne pas.",
  trade_not_pending: "Cet échange n'est plus en attente.",
  cards_no_longer_available: "Une des deux cartes n'est plus disponible (deja echangee ailleurs).",
  promo_not_tradeable: "Les cartes promo ne sont pas echangeables.",
  pull_not_chosen: "Choisis quel exemplaire tu veux donner."
};

const STATUS_LABELS = {
  pending: "En attente",
  accepted: "Accepte",
  declined: "Refuse",
  cancelled: "Annule",
  countered: "Remplace par une contre-proposition"
};

function formatSerial(serial, maxSerial) {
  if (serial == null) return "";
  return ` (#${String(serial).padStart(3, "0")}${maxSerial ? "/" + maxSerial : ""})`;
}

let myOwnedCards = [];
let allCards = [];
let cardById = new Map();
let myOwnedCountByCard = new Map();
let ownedCopiesByCard = new Map();
let maxSerialByCard = new Map();
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

  myOwnedCountByCard = new Map((collection.owned || []).map((o) => [o.cardId, o.count]));
  // Chaque exemplaire individuel (pullId + numero de serie) possede par le
  // joueur, pour choisir PRECISEMENT quelle carte donner (pas juste "une
  // carte au hasard parmi les doublons").
  ownedCopiesByCard = new Map((collection.owned || []).map((o) => [o.cardId, o.copies || []]));
  maxSerialByCard = new Map((collection.cards || []).map((c) => [c.cardId, c.maxSerial || 100]));

  allCards = (cardsRes.cards || []).filter((c) => !c.isPromo);
  myOwnedCards = allCards.filter((c) => myOwnedCountByCard.has(c.cardId));
  // Utilise pour retrouver l'image/rarete d'une carte dans l'historique des
  // echanges (l'API ne renvoie que {id, name} par carte impliquee).
  cardById = new Map((cardsRes.cards || []).map((c) => [c.cardId, c]));

  const offeredSelect = document.getElementById("offered-card-select");
  offeredSelect.innerHTML = myOwnedCards
    .map((c) => `<option value="${c.cardId}">${c.name} (x${myOwnedCountByCard.get(c.cardId)})</option>`)
    .join("") || `<option value="">Aucune carte possédée</option>`;

  const targetSelect = document.getElementById("target-select");
  const users = (usersRes.users || []).filter((u) => String(u.userId) !== String(Session.userId));
  targetSelect.innerHTML = users
    .map((u) => `<option value="${u.pseudo}">${u.pseudo}</option>`)
    .join("") || `<option value="">Aucun autre joueur</option>`;

  updateCardPreview("offered-card-select", "offered-card-preview");
  updateOfferedPullOptions();
  await updateRequestedCardOptionsForTarget(targetSelect.value);
}

// La carte demandee ne peut porter que sur ce que le joueur cible possede
// reellement (pas de sens de demander une carte qu'il n'a pas) : le combo
// est repeuple a chaque changement de cible via son profil public.
async function updateRequestedCardOptionsForTarget(pseudo) {
  const select = document.getElementById("requested-card-select");
  if (!select) return;
  if (!pseudo) {
    select.innerHTML = `<option value="">Choisis d'abord un joueur cible</option>`;
    if (select._fancyRefresh) select._fancyRefresh();
    updateCardPreview("requested-card-select", "requested-card-preview");
    return;
  }
  select.innerHTML = `<option value="">Chargement...</option>`;
  if (select._fancyRefresh) select._fancyRefresh();
  try {
    const profile = await API.getPublicProfile(pseudo);
    const options = (profile.cards || []).filter((c) => !c.isPromo);
    select.innerHTML = `<option value="">Aucune (don)</option>` + options
      .map((c) => `<option value="${c.cardId}">${c.name} (x${c.count})</option>`)
      .join("");
  } catch (e) {
    select.innerHTML = `<option value="">Aucune (don)</option>`;
  }
  if (select._fancyRefresh) select._fancyRefresh();
  updateCardPreview("requested-card-select", "requested-card-preview");
}

// Idem cote "carte a offrir" : une fois la carte choisie, il faut aussi
// choisir PRECISEMENT quel exemplaire (numero de serie) on met dans
// l'echange, plutot qu'un exemplaire pris au hasard parmi les doublons.
function updateOfferedPullOptions() {
  const select = document.getElementById("offered-pull-select");
  if (!select) return;
  const cardId = Number(document.getElementById("offered-card-select").value);
  const copies = ownedCopiesByCard.get(cardId) || [];
  const maxSerial = maxSerialByCard.get(cardId) || 100;
  select.innerHTML = copies.length
    ? copies.map((c) => `<option value="${c.pullId}">${c.serialNumber != null ? "#" + String(c.serialNumber).padStart(3, "0") : "?"} / ${maxSerial}</option>`).join("")
    : `<option value="">Aucun exemplaire</option>`;
  if (select._fancyRefresh) select._fancyRefresh();
}

function updateCardPreview(selectId, previewId) {
  const select = document.getElementById(selectId);
  const preview = document.getElementById(previewId);
  if (!select || !preview) return;
  const card = allCards.find((c) => String(c.cardId) === select.value);
  // Pas de select => pas de vignette du tout plutot que le placeholder
  // "pas d'image" ecrase a 44px (illisible, on dirait une image cassee).
  if (!card) { preview.style.visibility = "hidden"; return; }
  preview.style.visibility = "visible";
  preview.src = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
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
        <button class="btn-ghost counter-btn" data-id="${trade.tradeId}">Contre-proposer</button>
        <button class="btn-ghost decline-btn" data-id="${trade.tradeId}">Refuser</button>
      `;
    } else if (!bulkCancelMode) {
      actions = `<button class="btn-ghost cancel-btn" data-id="${trade.tradeId}">Annuler</button>`;
    }
  }

  const requestPart = trade.requestedCard
    ? `contre <strong>${trade.requestedCard.name}</strong>${formatSerial(trade.requestedSerial)} a <strong>${trade.toPseudo}</strong>`
    : `en cadeau a <strong>${trade.toPseudo}</strong> (aucune contrepartie)`;

  // Petites vignettes des cartes concernees : un mur de texte pur ne
  // rendait pas justice au cote "jeu de cartes" du site. L'API ne renvoie
  // que {id, name} par carte impliquee, on retrouve image/rarete via le
  // catalogue complet deja charge (cardById).
  function thumb(cardRef, isGift) {
    if (isGift) return `<div class="trade-card-thumb gift" title="Don, sans contrepartie">&#127873;</div>`;
    const card = cardRef ? cardById.get(cardRef.id) : null;
    const color = card?.rarity?.colorHex || "#9aa0b4";
    const src = card ? (API.imageUrl(card.imageId) || PLACEHOLDER_IMG) : PLACEHOLDER_IMG;
    return `<div class="trade-card-thumb" style="border-color:${color};"><img src="${src}" alt="${cardRef?.name || ""}" loading="lazy" /></div>`;
  }

  el.innerHTML = `
    ${canBulkCancel ? `<label class="bulk-checkbox" style="position:static;"><input type="checkbox" data-bulk-trade-id="${trade.tradeId}" ${bulkCancelSelected.has(trade.tradeId) ? "checked" : ""} /></label>` : ""}
    <div class="trade-visual">
      ${thumb(trade.offeredCard, false)}
      <span class="trade-arrow" aria-hidden="true">&#8594;</span>
      ${thumb(trade.requestedCard, !trade.requestedCard)}
    </div>
    <div class="trade-info">
      ${trade.counterOfTradeId ? `<div class="trade-counter-tag">&#128260; Contre-proposition (echange #${trade.counterOfTradeId})</div>` : ""}
      <div><strong>${trade.fromPseudo}</strong> offre <strong>${trade.offeredCard.name}</strong>${formatSerial(trade.offeredSerial)} ${requestPart}</div>
      <span class="trade-status ${statusClass}">${STATUS_LABELS[trade.status] || trade.status}</span>
    </div>
    <div class="trade-actions">${actions}</div>
  `;

  el.querySelectorAll(".accept-btn").forEach((b) => b.addEventListener("click", () => respond(b.dataset.id, true)));
  el.querySelectorAll(".decline-btn").forEach((b) => b.addEventListener("click", () => respond(b.dataset.id, false)));
  el.querySelectorAll(".counter-btn").forEach((b) => b.addEventListener("click", () => counterPropose(b.dataset.id)));
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

// Accepter un echange avec contrepartie ne se fait plus d'un simple clic :
// celui qui accepte doit choisir LUI-MEME quel exemplaire (numero de serie)
// de la carte demandee il donne en retour. Les dons (sans contrepartie)
// restent instantanes, il n'y a rien a choisir.
function openAcceptModal(trade) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay confirm-overlay";
    const copies = ownedCopiesByCard.get(trade.requestedCard.id) || [];
    const maxSerial = maxSerialByCard.get(trade.requestedCard.id) || 100;
    const options = copies
      .map((c) => `<option value="${c.pullId}">${c.serialNumber != null ? "#" + String(c.serialNumber).padStart(3, "0") : "?"} / ${maxSerial}</option>`)
      .join("");
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-title">Accepter l'échange ?</div>
        <div class="confirm-message">
          Tu vas donner <strong>${trade.requestedCard.name}</strong> a <strong>${trade.fromPseudo}</strong>.<br />
          Choisis quel exemplaire donner :
        </div>
        <select id="accept-pull-select" style="width:100%;margin:10px 0;">${options || `<option value="">Aucun exemplaire disponible</option>`}</select>
        <div class="confirm-actions">
          <button type="button" class="btn-ghost confirm-cancel">Annuler</button>
          <button type="button" class="confirm-ok" ${copies.length ? "" : "disabled"}>Confirmer</button>
        </div>
      </div>
    `;
    const finish = (result) => { overlay.remove(); syncScrollLock(); resolve(result); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(null); });
    overlay.querySelector(".confirm-cancel").addEventListener("click", () => finish(null));
    overlay.querySelector(".confirm-ok").addEventListener("click", () => {
      const pullId = Number(overlay.querySelector("#accept-pull-select").value);
      finish(pullId || null);
    });
    document.body.appendChild(overlay);
    syncScrollLock();
    enhanceSelect(overlay.querySelector("#accept-pull-select"));
  });
}

// Mini-formulaire de contre-proposition : reprend les memes choix que la
// creation d'un echange (ma carte + mon exemplaire + carte demandee, filtree
// aux cartes que l'autre joueur possede reellement), mais dans une modale et
// avec la cible fixee (le proposeur de l'echange d'origine).
async function openCounterModal(trade) {
  const overlay = document.createElement("div");
  overlay.className = "card-modal-overlay confirm-overlay";
  overlay.innerHTML = `
    <div class="confirm-box">
      <div class="confirm-title">Contre-proposition a ${trade.fromPseudo}</div>
      <div class="confirm-message" style="text-align:left;">
        <label style="display:block;margin-bottom:10px;">
          Ma carte a offrir
          <select id="counter-offered-card-select" style="width:100%;"></select>
        </label>
        <label style="display:block;margin-bottom:10px;">
          Exemplaire a donner
          <select id="counter-offered-pull-select" style="width:100%;"></select>
        </label>
        <label style="display:block;">
          Carte demandee a ${trade.fromPseudo} (laisse sur "Aucune" pour un don)
          <select id="counter-requested-card-select" style="width:100%;"><option value="">Chargement...</option></select>
        </label>
      </div>
      <div class="confirm-actions">
        <button type="button" class="btn-ghost confirm-cancel">Annuler</button>
        <button type="button" class="confirm-ok">Envoyer</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  syncScrollLock();

  const offeredSelect = overlay.querySelector("#counter-offered-card-select");
  const pullSelect = overlay.querySelector("#counter-offered-pull-select");
  const requestedSelect = overlay.querySelector("#counter-requested-card-select");

  offeredSelect.innerHTML = myOwnedCards
    .map((c) => `<option value="${c.cardId}" ${trade.requestedCard && c.cardId === trade.requestedCard.id ? "selected" : ""}>${c.name} (x${myOwnedCountByCard.get(c.cardId)})</option>`)
    .join("") || `<option value="">Aucune carte possédée</option>`;

  function refreshPullOptions() {
    const cardId = Number(offeredSelect.value);
    const copies = ownedCopiesByCard.get(cardId) || [];
    const maxSerial = maxSerialByCard.get(cardId) || 100;
    pullSelect.innerHTML = copies.length
      ? copies.map((c) => `<option value="${c.pullId}">${c.serialNumber != null ? "#" + String(c.serialNumber).padStart(3, "0") : "?"} / ${maxSerial}</option>`).join("")
      : `<option value="">Aucun exemplaire</option>`;
    if (pullSelect._fancyRefresh) pullSelect._fancyRefresh();
  }
  offeredSelect.addEventListener("change", refreshPullOptions);
  refreshPullOptions();

  API.getPublicProfile(trade.fromPseudo).then((profile) => {
    const options = (profile.cards || []).filter((c) => !c.isPromo);
    requestedSelect.innerHTML = `<option value="">Aucune (don)</option>` + options
      .map((c) => `<option value="${c.cardId}" ${c.cardId === trade.offeredCard.id ? "selected" : ""}>${c.name} (x${c.count})</option>`)
      .join("");
    if (requestedSelect._fancyRefresh) requestedSelect._fancyRefresh();
  }).catch(() => {
    requestedSelect.innerHTML = `<option value="">Aucune (don)</option>`;
    if (requestedSelect._fancyRefresh) requestedSelect._fancyRefresh();
  });

  enhanceSelect(offeredSelect);
  enhanceSelect(pullSelect);
  enhanceSelect(requestedSelect);

  return new Promise((resolve) => {
    const finish = (result) => { overlay.remove(); syncScrollLock(); resolve(result); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(null); });
    overlay.querySelector(".confirm-cancel").addEventListener("click", () => finish(null));
    overlay.querySelector(".confirm-ok").addEventListener("click", () => {
      const offeredCardId = Number(offeredSelect.value);
      const offeredPullId = Number(pullSelect.value);
      const requestedRaw = requestedSelect.value;
      if (!offeredCardId || !offeredPullId) { Toast.error("Choisis une carte et un exemplaire a offrir."); return; }
      finish({ offeredCardId, offeredPullId, requestedCardId: requestedRaw ? Number(requestedRaw) : null });
    });
  });
}

async function respond(tradeId, accept) {
  const trade = allTradesCache.find((t) => String(t.tradeId) === String(tradeId));
  let requestedPullId = null;
  if (accept && trade && trade.requestedCard) {
    requestedPullId = await openAcceptModal(trade);
    if (!requestedPullId) return;
  }
  try {
    await API.respondTrade(Session.userId, Number(tradeId), accept, requestedPullId);
    Toast.success(accept ? "Échange accepte !" : "Échange refuse.");
    // Un echange accepte accorde de l'XP (niveaux de profil) aux deux
    // parties : rafraichit le badge de niveau dans le header.
    if (accept) loadHeaderBoosterBadge();
    loadTrades();
  } catch (e) {
    Toast.error(TRADE_ERROR_MESSAGES[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

async function counterPropose(tradeId) {
  const trade = allTradesCache.find((t) => String(t.tradeId) === String(tradeId));
  if (!trade) return;
  const result = await openCounterModal(trade);
  if (!result) return;
  try {
    await API.counterTrade(Session.userId, Number(tradeId), result.offeredCardId, result.offeredPullId, result.requestedCardId);
    Toast.success("Contre-proposition envoyée !");
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

  document.getElementById("offered-card-select").addEventListener("change", () => {
    updateCardPreview("offered-card-select", "offered-card-preview");
    updateOfferedPullOptions();
  });
  document.getElementById("requested-card-select").addEventListener("change", () => updateCardPreview("requested-card-select", "requested-card-preview"));
  document.getElementById("target-select").addEventListener("change", (e) => updateRequestedCardOptionsForTarget(e.target.value));
  enhanceSelect(document.getElementById("offered-card-select"));
  enhanceSelect(document.getElementById("offered-pull-select"));
  enhanceSelect(document.getElementById("requested-card-select"));
  enhanceSelect(document.getElementById("target-select"));

  document.getElementById("tab-incoming-btn").addEventListener("click", () => setActiveTradeTab("incoming"));
  document.getElementById("tab-outgoing-btn").addEventListener("click", () => setActiveTradeTab("outgoing"));

  document.getElementById("create-trade-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const offeredCardId = Number(document.getElementById("offered-card-select").value);
    const offeredPullId = Number(document.getElementById("offered-pull-select").value);
    const requestedRaw = document.getElementById("requested-card-select").value;
    const requestedCardId = requestedRaw ? Number(requestedRaw) : null;
    const toPseudo = document.getElementById("target-select").value;
    if (!offeredCardId || !offeredPullId || !toPseudo) return;

    try {
      await API.createTrade(Session.userId, toPseudo, offeredCardId, offeredPullId, requestedCardId);
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
