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
  cannot_trade_self: "Tu ne peux pas t'échanger une carte avec toi-même.",
  card_not_owned: "Tu ne possèdes pas cette carte.",
  trade_not_found: "Échange introuvable.",
  not_your_trade: "Cet échange ne te concerne pas.",
  trade_not_pending: "Cet échange n'est plus en attente.",
  cards_no_longer_available: "Une des deux cartes n'est plus disponible (déjà échangée ailleurs).",
  promo_not_tradeable: "Les cartes promo ne sont pas echangeables.",
  pull_not_chosen: "Choisis quel exemplaire tu veux donner.",
  offer_no_longer_available: "L'exemplaire proposé a déjà changé de main : cet échange a été annulé automatiquement.",
  pull_not_owned: "Tu ne possèdes plus cet exemplaire - la liste vient d'être rafraîchie, réessaie."
};
// Erreurs qui signifient "l'etat affiche est perime" : on recharge alors
// cartes possedees + liste d'echanges plutot que de laisser l'utilisateur
// re-cliquer sur un bouton qui echouera a nouveau.
const STALE_STATE_ERRORS = new Set(["offer_no_longer_available", "pull_not_owned", "cards_no_longer_available", "trade_not_pending", "trade_not_found"]);

// Memes echelles que collection.js/craft.js (voir grist/SCHEMA.md) : la
// carte OFFERTE est un exemplaire precis (deja choisi via OfferedPull), donc
// son finish/quality reels sont connus et affichables - indispensable pour
// juger si un echange est equitable (demande explicite : "plus de details").
const FINISH_LABELS = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
const QUALITY_LABELS = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };

const STATUS_LABELS = {
  pending: "En attente",
  accepted: "Accepte",
  declined: "Refuse",
  cancelled: "Annule",
  countered: "Remplace par une contre-proposition"
};

function formatSerial(serial) {
  if (serial == null) return "";
  return ` (#${String(serial).padStart(3, "0")})`;
}

// Libelle d'un exemplaire precis : numero + finition/etat, pour choisir en
// connaissance de cause QUEL exemplaire on donne (jusqu'ici seul le numero
// etait affiche - impossible de distinguer un Holo d'un normal).
function copyLabel(c) {
  const parts = [c.serialNumber != null ? "#" + String(c.serialNumber).padStart(3, "0") : "?"];
  if (c.finish && c.finish !== "normal") parts.push(FINISH_LABELS[c.finish] || c.finish);
  if (c.quality) parts.push(QUALITY_LABELS[c.quality] || c.quality);
  return parts.join(" · ");
}

// Exemplaires deja engages comme "carte offerte" dans un de MES echanges
// encore en attente : les redonner ailleurs ferait echouer cet autre echange.
function committedPullIds() {
  return new Set(allTradesCache
    .filter((t) => t.direction === "outgoing" && t.status === "pending" && t.offeredPullId)
    .map((t) => t.offeredPullId));
}

// Un clic = une requete : les appels n8n prennent plusieurs secondes, un
// double-clic declenchait jusqu'ici un second appel (erreur "n'est plus en
// attente", voire XP comptee deux fois si les deux passaient en meme temps).
const inFlightTrades = new Set();
function setTradeBusy(tradeId, busy) {
  if (busy) inFlightTrades.add(String(tradeId)); else inFlightTrades.delete(String(tradeId));
  document.querySelectorAll(`.trade-card button[data-id="${tradeId}"]`).forEach((b) => { b.disabled = busy; });
}

async function refreshAfterMutation() {
  try { await loadFormOptions(); } catch (e) { /* la liste reste exploitable */ }
  await loadTrades();
}

let myOwnedCards = [];
let allCards = [];
let cardById = new Map();
let myOwnedCountByCard = new Map();
let ownedCopiesByCard = new Map();
let allTradesCache = [];
let historySearch = "";
// Filtre par statut (QoL 2026-09-30), en plus du filtre par pseudo deja en
// place - utile a mesure que l'historique d'echanges s'allonge.
let statusFilter = "all";
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

// Filtre "doublons uniquement" (QoL 2026-09-30) : evite de proposer par
// erreur son dernier exemplaire d'une carte - ne montre que celles possedees
// en x2 ou plus quand la case est cochee.
// Cartes possedees par le joueur cible (rempli au choix de la cible, voir
// updateRequestedCardOptionsForTarget) : sert a reperer, parmi MES cartes,
// celles qu'il n'a pas encore - les plus susceptibles de l'interesser.
let targetOwnedIds = null;

function renderOfferedCardOptions() {
  const duplicatesOnly = document.getElementById("offer-duplicates-only")?.checked;
  const missingOnly = document.getElementById("offer-missing-only")?.checked && targetOwnedIds;
  const previous = document.getElementById("offered-card-select").value;
  let options = duplicatesOnly ? myOwnedCards.filter((c) => (myOwnedCountByCard.get(c.cardId) || 0) >= 2) : myOwnedCards;
  if (missingOnly) options = options.filter((c) => !targetOwnedIds.has(c.cardId));
  const offeredSelect = document.getElementById("offered-card-select");
  const emptyLabel = missingOnly ? "Il possède déjà toutes tes cartes" : duplicatesOnly ? "Aucun doublon" : "Aucune carte possédée";
  offeredSelect.innerHTML = options
    .map((c) => {
      const missing = targetOwnedIds && !targetOwnedIds.has(c.cardId);
      return `<option value="${c.cardId}" ${String(c.cardId) === previous ? "selected" : ""}>${c.name} (x${myOwnedCountByCard.get(c.cardId)})${missing ? " ✦ il ne l'a pas" : ""}</option>`;
    })
    .join("") || `<option value="">${emptyLabel}</option>`;
  if (offeredSelect._fancyRefresh) offeredSelect._fancyRefresh();
  updateCardPreview("offered-card-select", "offered-card-preview");
  updateOfferedPullOptions();
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

  allCards = (cardsRes.cards || []).filter((c) => !c.isPromo);
  myOwnedCards = allCards.filter((c) => myOwnedCountByCard.has(c.cardId));
  // Utilise pour retrouver l'image/rarete d'une carte dans l'historique des
  // echanges (l'API ne renvoie que {id, name} par carte impliquee).
  cardById = new Map((cardsRes.cards || []).map((c) => [c.cardId, c]));

  renderOfferedCardOptions();

  const targetSelect = document.getElementById("target-select");
  const users = (usersRes.users || []).filter((u) => String(u.userId) !== String(Session.userId));
  targetSelect.innerHTML = users
    .map((u) => `<option value="${u.pseudo}">${u.pseudo}</option>`)
    .join("") || `<option value="">Aucun autre joueur</option>`;

  await updateRequestedCardOptionsForTarget(targetSelect.value);
}

// La carte demandee ne peut porter que sur ce que le joueur cible possede
// reellement (pas de sens de demander une carte qu'il n'a pas) : le combo
// est repeuple a chaque changement de cible via son profil public.
async function updateRequestedCardOptionsForTarget(pseudo) {
  const select = document.getElementById("requested-card-select");
  if (!select) return;
  if (!pseudo) {
    targetOwnedIds = null;
    renderOfferedCardOptions();
    select.innerHTML = `<option value="">Choisis d'abord un joueur cible</option>`;
    if (select._fancyRefresh) select._fancyRefresh();
    updateCardPreview("requested-card-select", "requested-card-preview");
    return;
  }
  select.innerHTML = `<option value="">Chargement...</option>`;
  if (select._fancyRefresh) select._fancyRefresh();
  try {
    const profile = await API.getPublicProfile(pseudo);
    targetOwnedIds = new Set((profile.cards || []).map((c) => c.cardId));
    const options = (profile.cards || []).filter((c) => !c.isPromo);
    select.innerHTML = `<option value="">Aucune (don)</option>` + options
      .map((c) => `<option value="${c.cardId}">${c.name} (x${c.count})${myOwnedCountByCard.has(c.cardId) ? "" : " ✦ tu ne l'as pas"}</option>`)
      .join("");
  } catch (e) {
    targetOwnedIds = null;
    select.innerHTML = `<option value="">Aucune (don)</option>`;
  }
  renderOfferedCardOptions();
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
  const committed = committedPullIds();
  select.innerHTML = copies.length
    ? copies.map((c) => `<option value="${c.pullId}">${copyLabel(c)}${committed.has(c.pullId) ? " (déjà proposé ailleurs)" : ""}</option>`).join("")
    : `<option value="">Aucun exemplaire</option>`;
  if (select._fancyRefresh) select._fancyRefresh();
}

function updateCardPreview(selectId, previewId) {
  const select = document.getElementById(selectId);
  const preview = document.getElementById(previewId);
  if (!select || !preview) return;
  const card = allCards.find((c) => String(c.cardId) === select.value);
  const frame = preview.closest(".trade-side-card");
  // Cadre vide (dashed + "?") tant qu'aucune carte n'est choisie, plutot que
  // le placeholder "pas d'image" ecrase a 44px (illisible, on dirait une
  // image cassee) de l'ancien formulaire.
  if (!card) {
    preview.style.visibility = "hidden";
    if (frame) { frame.classList.add("empty"); frame.style.removeProperty("--frame-color"); }
    return;
  }
  preview.style.visibility = "visible";
  const src = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  preview.src = src;
  if (frame) {
    frame.classList.remove("empty");
    frame.style.setProperty("--frame-color", card.rarity?.colorHex || "#9aa0b4");
  }
  // Clic = modale de detail (rarete, numero de serie, qualite...), pas
  // juste un zoom brut : juger si un echange est equitable passe par voir
  // ces infos sans quitter la page (demande explicite).
  preview.style.cursor = "zoom-in";
  preview.onclick = () => {
    // Cote "carte a offrir", l'exemplaire precis est deja choisi (voir
    // offered-pull-select) : on peut donc afficher son vrai finish/quality/
    // numero. Cote "carte demandee", aucun exemplaire precis n'est connu
    // avant acceptation, la modale reste generique.
    let pull = null;
    if (selectId === "offered-card-select") {
      const pullId = Number(document.getElementById("offered-pull-select")?.value);
      pull = (ownedCopiesByCard.get(card.cardId) || []).find((c) => c.pullId === pullId) || null;
    }
    openTradeCardModal(card, pull ? { finish: pull.finish, quality: pull.quality, serialNumber: pull.serialNumber } : {});
  };
}

// Modale de detail au clic sur une vignette de carte (formulaire de
// creation ou historique des echanges) : image en grand, rarete, numero de
// serie et qualite/finition quand un exemplaire precis est connu, sinon
// juste les infos generiques de la carte.
function openTradeCardModal(card, opts) {
  if (!card) return;
  opts = opts || {};
  const color = card.rarity?.colorHex || "#9aa0b4";
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  const finish = opts.finish && opts.finish !== "normal" ? opts.finish : null;
  const quality = opts.quality || null;
  const overlay = document.createElement("div");
  overlay.className = "card-modal-overlay";
  overlay.innerHTML = `
    <div class="card-modal" data-rarity="${card.rarity?.key || "commune"}" ${finish ? `data-finish="${finish}"` : ""} ${quality ? `data-quality="${quality}"` : ""}>
      <button class="card-modal-close" aria-label="Fermer">&times;</button>
      <div class="card-art"><img src="${imgSrc}" alt="${card.name}" /></div>
      <div class="card-modal-body">
        <div class="card-modal-name">${card.name}${card.isPromo ? '<span class="promo-badge">Promo</span>' : ""}</div>
        <div class="card-modal-artist">${card.artist || ""}${card.extension ? " &middot; " + card.extension.name : ""}</div>
        <div class="card-modal-badges">
          <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">
            ${card.rarity?.name || "Commune"}
          </span>
          ${finish ? `<span class="finish-indicator" data-finish="${finish}" style="position:static;">${FINISH_LABELS[finish]}</span>` : ""}
          ${quality ? `<span class="quality-indicator" data-quality="${quality}" style="position:static;">${QUALITY_LABELS[quality]}</span>` : ""}
        </div>
        ${opts.serialNumber != null ? `<div class="card-modal-stats"><span>Exemplaire #${String(opts.serialNumber).padStart(3, "0")}</span></div>` : ""}
        ${card.description ? `<p class="card-modal-description">${card.description}</p>` : ""}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); syncScrollLock(); };
  overlay.querySelector(".card-modal-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  syncScrollLock();
}

function renderTradeCard(trade) {
  const el = document.createElement("div");
  el.className = "trade-card";
  el.dataset.status = trade.status;
  const statusClass = "trade-status-" + trade.status;

  const canBulkCancel = bulkCancelMode && trade.direction === "outgoing" && trade.status === "pending";
  let actions = "";
  const busy = inFlightTrades.has(String(trade.tradeId)) ? "disabled" : "";
  if (trade.status === "pending") {
    if (trade.direction === "incoming") {
      // Exemplaire offert parti ailleurs entre-temps : "Accepter" echouerait
      // forcement - seul le refus reste propose.
      actions = trade.offerUnavailable
        ? `<button class="btn-ghost decline-btn" data-id="${trade.tradeId}" ${busy}>Refuser</button>`
        : `
        <button class="btn-secondary accept-btn" data-id="${trade.tradeId}" ${busy}>Accepter</button>
        <button class="btn-ghost counter-btn" data-id="${trade.tradeId}" ${busy}>Contre-proposer</button>
        <button class="btn-ghost decline-btn" data-id="${trade.tradeId}" ${busy}>Refuser</button>
      `;
    } else if (!bulkCancelMode) {
      actions = `<button class="btn-ghost cancel-btn" data-id="${trade.tradeId}" ${busy}>Annuler</button>`;
    }
  }
  const unavailableTag = trade.status === "pending" && trade.offerUnavailable
    ? `<div class="trade-unavailable-tag">&#9888; ${trade.direction === "incoming" ? "L'exemplaire proposé n'est plus disponible" : "Ton exemplaire n'est plus disponible (échangé ailleurs)"}</div>`
    : "";

  const requestPart = trade.requestedCard
    ? `contre <strong>${trade.requestedCard.name}</strong>${formatSerial(trade.requestedSerial)} a <strong>${trade.toPseudo}</strong>`
    : `en cadeau a <strong>${trade.toPseudo}</strong> (aucune contrepartie)`;

  // Petites vignettes des cartes concernees, avec le detail rarete/etat/
  // finition sous chacune - un mur de texte pur ne rendait pas justice au
  // cote "jeu de cartes" du site, et ne disait rien sur l'equite de
  // l'echange (demande explicite : "plus de details"). Le clic ouvre la
  // modale de detail complete (image en grand, rarete, numero, qualite).
  function thumbBlock(cardRef, isGift, isOffered) {
    if (isGift) return `<div class="trade-card-block"><div class="trade-card-thumb gift" title="Don, sans contrepartie">&#127873;</div></div>`;
    const card = cardRef ? cardById.get(cardRef.id) : null;
    const color = card?.rarity?.colorHex || "#9aa0b4";
    const src = card ? (API.imageUrl(card.imageId) || PLACEHOLDER_IMG) : PLACEHOLDER_IMG;
    // Le finish/quality ne sont connus (et donc affiches) que pour la carte
    // OFFERTE (exemplaire precis) - la carte demandee reste abstraite tant
        // que l'echange n'est pas accepte (voir trade.json "Build Trade List").
    const finish = isOffered ? (cardRef?.finish || "normal") : null;
    const quality = isOffered ? (cardRef?.quality || "damaged") : null;
    return `
      <div class="trade-card-block">
        <div class="trade-card-thumb" style="border-color:${color};cursor:zoom-in;" data-modal-card-id="${card ? card.cardId : ""}" data-modal-finish="${finish || ""}" data-modal-quality="${quality || ""}" data-modal-serial="${isOffered && cardRef?.serialNumber != null ? cardRef.serialNumber : ""}">
          <img src="${src}" alt="${cardRef?.name || ""}" loading="lazy" />
        </div>
        ${card ? `
          <div class="trade-card-tags">
            <span class="rarity-tag" style="color:${color};border-color:${color};">${card.rarity?.name || "Commune"}</span>
            ${finish && finish !== "normal" ? `<span class="finish-tag" data-finish="${finish}">${FINISH_LABELS[finish]}</span>` : ""}
            ${quality ? `<span class="quality-tag" data-quality="${quality}">${QUALITY_LABELS[quality]}</span>` : ""}
          </div>
        ` : ""}
      </div>
    `;
  }

  el.innerHTML = `
    ${canBulkCancel ? `<label class="bulk-checkbox" style="position:static;"><input type="checkbox" data-bulk-trade-id="${trade.tradeId}" ${bulkCancelSelected.has(trade.tradeId) ? "checked" : ""} /></label>` : ""}
    <div class="trade-visual">
      ${thumbBlock(trade.offeredCard, false, true)}
      <span class="trade-arrow" aria-hidden="true">&#8594;</span>
      ${thumbBlock(trade.requestedCard, !trade.requestedCard, false)}
    </div>
    <div class="trade-info">
      ${trade.counterOfTradeId ? `<div class="trade-counter-tag">&#128260; Contre-proposition (échange #${trade.counterOfTradeId})</div>` : ""}
      ${unavailableTag}
      <div><strong>${trade.fromPseudo}</strong> offre <strong>${trade.offeredCard.name}</strong>${formatSerial(trade.offeredSerial)} ${requestPart}</div>
      <span class="trade-status ${statusClass}">${STATUS_LABELS[trade.status] || trade.status}</span>
    </div>
    <div class="trade-actions">${actions}</div>
  `;

  el.querySelectorAll("[data-modal-card-id]").forEach((t) => {
    t.addEventListener("click", () => {
      const card = cardById.get(Number(t.dataset.modalCardId));
      if (!card) return;
      const opts = {};
      if (t.dataset.modalFinish) opts.finish = t.dataset.modalFinish;
      if (t.dataset.modalQuality) opts.quality = t.dataset.modalQuality;
      if (t.dataset.modalSerial) opts.serialNumber = Number(t.dataset.modalSerial);
      openTradeCardModal(card, opts);
    });
  });
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
  let filtered = historySearch
    ? trades.filter((t) => {
        const other = t.direction === "incoming" ? t.fromPseudo : t.toPseudo;
        return (other || "").toLowerCase().includes(historySearch.toLowerCase());
      })
    : trades;
  if (statusFilter !== "all") filtered = filtered.filter((t) => t.status === statusFilter);
  if (!filtered.length) {
    const filterActive = historySearch || statusFilter !== "all";
    container.append(Object.assign(document.createElement("div"), { className: "empty-state", textContent: filterActive ? "Aucun échange ne correspond à ce filtre." : emptyLabel }));
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
  renderTradeGroup(incoming, incomingTrades, "Aucun échange reçu.");
  renderTradeGroup(outgoing, outgoingTrades, "Aucun échange envoyé.");

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
// gere globalement dans shell.js/loadNavBadges).
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
    // Exclut les exemplaires deja engages dans un de mes echanges en attente
    // (les donner ici ferait echouer l'autre echange plus tard).
    const committed = committedPullIds();
    const copies = (ownedCopiesByCard.get(trade.requestedCard.id) || []).filter((c) => !committed.has(c.pullId));
    const options = copies
      .map((c) => `<option value="${c.pullId}">${copyLabel(c)}</option>`)
      .join("");
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-title">Accepter l'échange ?</div>
        <div class="confirm-message">
          Tu vas donner <strong>${trade.requestedCard.name}</strong> a <strong>${trade.fromPseudo}</strong>.<br />
          Choisis quel exemplaire donner :
        </div>
        <select id="accept-pull-select" style="width:100%;margin:10px 0;">${options || `<option value="">Aucun exemplaire disponible (ou tous déjà proposés ailleurs)</option>`}</select>
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
    pullSelect.innerHTML = copies.length
      ? copies.map((c) => `<option value="${c.pullId}">${copyLabel(c)}</option>`).join("")
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

function handleTradeError(e) {
  Toast.error(TRADE_ERROR_MESSAGES[e.code] || ("Erreur. (" + e.message + ")"));
  if (STALE_STATE_ERRORS.has(e.code)) refreshAfterMutation();
}

async function respond(tradeId, accept) {
  if (inFlightTrades.has(String(tradeId))) return;
  const trade = allTradesCache.find((t) => String(t.tradeId) === String(tradeId));
  let requestedPullId = null;
  if (accept && trade && trade.requestedCard) {
    requestedPullId = await openAcceptModal(trade);
    if (!requestedPullId) return;
  }
  setTradeBusy(tradeId, true);
  try {
    await API.respondTrade(Session.userId, Number(tradeId), accept, requestedPullId);
    Toast.success(accept ? "Échange accepté !" : "Échange refusé.");
    // Un echange accepte accorde de l'XP (niveaux de profil) aux deux
    // parties : rafraichit le badge de niveau dans le header. Confettis
    // (embellissement 2026-09-30) : un echange accepte etait jusque-la la
    // seule action de gain du site sans aucune petite fete visuelle.
    if (accept) {
      loadHeaderBoosterBadge();
      if (typeof confetti === "function") confetti({ particleCount: 120, spread: 100, origin: { y: 0.5 } });
    }
    setTradeBusy(tradeId, false);
    await refreshAfterMutation();
  } catch (e) {
    setTradeBusy(tradeId, false);
    handleTradeError(e);
  }
}

async function counterPropose(tradeId) {
  if (inFlightTrades.has(String(tradeId))) return;
  const trade = allTradesCache.find((t) => String(t.tradeId) === String(tradeId));
  if (!trade) return;
  const result = await openCounterModal(trade);
  if (!result) return;
  setTradeBusy(tradeId, true);
  try {
    await API.counterTrade(Session.userId, Number(tradeId), result.offeredCardId, result.offeredPullId, result.requestedCardId);
    Toast.success("Contre-proposition envoyée !");
    setTradeBusy(tradeId, false);
    await refreshAfterMutation();
  } catch (e) {
    setTradeBusy(tradeId, false);
    handleTradeError(e);
  }
}

async function cancel(tradeId) {
  if (inFlightTrades.has(String(tradeId))) return;
  setTradeBusy(tradeId, true);
  try {
    await API.cancelTrade(Session.userId, Number(tradeId));
    Toast.info("Échange annulé.");
    setTradeBusy(tradeId, false);
    await refreshAfterMutation();
  } catch (e) {
    setTradeBusy(tradeId, false);
    handleTradeError(e);
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
  await refreshAfterMutation();
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

  const level = await fetchMyLevel();
  if (level < FEATURE_UNLOCK_LEVEL.trade) {
    const zone = document.getElementById("trade-zone");
    zone.style.display = "block";
    renderFeatureLockedMessage(zone, "trade", level);
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
  document.getElementById("offer-duplicates-only").addEventListener("change", renderOfferedCardOptions);
  document.getElementById("offer-missing-only").addEventListener("change", renderOfferedCardOptions);
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
      Toast.success("Échange proposé !");
      await refreshAfterMutation();
    } catch (err) {
      Toast.error(TRADE_ERROR_MESSAGES[err.code] || ("Erreur. (" + err.message + ")"));
    }
  });

  let historyTimer = null;
  document.getElementById("trade-history-search").addEventListener("input", (e) => {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => { historySearch = e.target.value; renderAllTrades(); }, 150);
  });
  document.getElementById("trade-status-filter").addEventListener("change", (e) => {
    statusFilter = e.target.value;
    renderAllTrades();
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
