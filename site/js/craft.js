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
  insufficient_dust: "Pas assez de poussières d'etoile.",
  sold_out: "Tous les exemplaires de cette carte ont déjà été distribués."
};
const FINISH_ERRORS = {
  card_not_found: "Carte introuvable.",
  promo_not_upgradable: "Cette carte promo ne peut pas être fusionnée.",
  card_inactive: "Cette carte n'est plus disponible.",
  invalid_finish: "Cette finition ne peut pas être fusionnée davantage.",
  not_enough_duplicates: "Il te faut 5 exemplaires identiques pour fusionner.",
  sold_out: "Tous les exemplaires de cette carte ont déjà été distribués."
};

// Echelle de finitions, du plus commun au plus prestigieux (voir
// grist/SCHEMA.md et foil-upgrade.json - meme ordre des deux cotes).
const FINISH_ORDER = ["normal", "holo", "gold", "ghost", "diamond", "rainbow"];
const FINISH_LABELS = {
  normal: "Normal",
  holo: "Holographique",
  gold: "Doré",
  ghost: "Ghost Rare",
  diamond: "Diamant",
  rainbow: "Arc-en-ciel"
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
  return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
  document.getElementById("tab-altar-btn").classList.toggle("active", tab === "altar");
  document.getElementById("tab-altar-btn").setAttribute("aria-selected", String(tab === "altar"));
  document.getElementById("tab-finish-btn").classList.toggle("active", tab === "finish");
  document.getElementById("tab-finish-btn").setAttribute("aria-selected", String(tab === "finish"));
  document.getElementById("disenchant-pane").style.display = tab === "disenchant" ? "block" : "none";
  document.getElementById("craft-pane").style.display = tab === "craft" ? "block" : "none";
  document.getElementById("altar-pane").style.display = tab === "altar" ? "block" : "none";
  document.getElementById("finish-pane").style.display = tab === "finish" ? "block" : "none";
  document.getElementById("hide-owned-label").style.display = tab === "craft" ? "flex" : "none";
  // La barre de recherche/filtres ne concerne ni l'autel ni les finitions
  // (pas des grilles de cartes a trier, juste des paliers/fusions).
  document.querySelector(".craft-toolbar").style.display = (tab === "altar" || tab === "finish") ? "none" : "flex";
  document.getElementById("craft-search-input").placeholder =
    tab === "disenchant" ? "Rechercher parmi mes cartes..." : "Rechercher une carte à crafter...";
  if (tab === "altar") renderAltarTiers();
  if (tab === "finish") renderFinishTiers();
}

// Autel de sacrifice : le joueur choisit lui-meme, parmi ses doublons (au
// moins 2 exemplaires, un seul jamais sacrifiable), les 3 cartes a offrir
// pour tenter (50%) d'obtenir une carte aleatoire de la rarete superieure.
let altarSelection = new Map(); // cardId -> nombre d'exemplaires selectionnes
let altarActiveTier = null; // cle de rarete dont le picker est ouvert

function renderAltarTiers() {
  const el = document.getElementById("altar-tiers");
  const rarityByKey = new Map();
  allCards.forEach((c) => {
    if (c.isPromo || !c.rarity?.key) return;
    if (!rarityByKey.has(c.rarity.key)) {
      rarityByKey.set(c.rarity.key, { key: c.rarity.key, name: c.rarity.name || c.rarity.key, colorHex: c.rarity.colorHex, sortOrder: c.rarity.sortOrder ?? 999 });
    }
  });
  const rarities = [...rarityByKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  el.innerHTML = rarities.map((r, i) => {
    const next = rarities[i + 1];
    if (!next) {
      return `
        <div class="altar-tier">
          <div class="altar-tier-path">
            <span class="altar-tier-badge" style="border-color:${r.colorHex};color:${rarityTextColor(r.colorHex)};">${r.name}</span>
            <span class="altar-tier-maxed">Rareté maximale</span>
          </div>
        </div>
      `;
    }

    const duplicates = allCards.filter((c) => !c.isPromo && c.rarity?.key === r.key && (ownedMap.get(c.cardId)?.count || 0) >= 2);
    const isOpen = altarActiveTier === r.key;
    const selectedTotal = isOpen ? [...altarSelection.values()].reduce((a, b) => a + b, 0) : 0;

    return `
      <div class="altar-tier">
        <div class="altar-tier-path">
          <span class="altar-tier-badge" style="border-color:${r.colorHex};color:${rarityTextColor(r.colorHex)};">${r.name}</span>
          <span class="altar-tier-arrow" aria-hidden="true">&#8594;</span>
          <span class="altar-tier-badge" style="border-color:${next.colorHex};color:${rarityTextColor(next.colorHex)};">${next.name}</span>
        </div>
        ${!duplicates.length ? `
          <div class="altar-tier-info">Pas encore de doublon de ${r.name.toLowerCase()} à sacrifier (garde toujours au moins 1 exemplaire de chaque carte).</div>
        ` : !isOpen ? `
          <button type="button" class="btn-secondary altar-open-btn" data-rarity-key="${r.key}">Choisir mes cartes à sacrifier</button>
        ` : `
          <div class="altar-picker">
            <div class="altar-picker-list">
              ${duplicates.map((c) => {
                const owned = ownedMap.get(c.cardId);
                const max = owned.count - 1;
                const picked = altarSelection.get(c.cardId) || 0;
                const imgSrc = API.imageUrl(c.imageId) || PLACEHOLDER_IMG;
                return `
                  <div class="altar-picker-row">
                    <img src="${imgSrc}" alt="" loading="lazy" />
                    <div class="altar-picker-name">${c.name} <span class="altar-picker-owned">×${owned.count}</span></div>
                    <div class="altar-picker-stepper">
                      <button type="button" class="altar-step-btn" data-card-id="${c.cardId}" data-delta="-1" ${picked <= 0 ? "disabled" : ""} aria-label="Retirer un exemplaire">&minus;</button>
                      <span class="altar-step-count">${picked}</span>
                      <button type="button" class="altar-step-btn" data-card-id="${c.cardId}" data-delta="1" ${picked >= max ? "disabled" : ""} aria-label="Ajouter un exemplaire">+</button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
            <div class="altar-picker-footer">
              <span>${selectedTotal} / 3 sélectionnée${selectedTotal > 1 ? "s" : ""}</span>
              <button type="button" class="btn-ghost altar-cancel-btn">Annuler</button>
              <button type="button" class="btn-danger altar-confirm-btn" ${selectedTotal === 3 ? "" : "disabled"}>&#128293; Sacrifier</button>
            </div>
          </div>
        `}
      </div>
    `;
  }).join("");

  el.querySelectorAll(".altar-open-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      altarSelection = new Map();
      altarActiveTier = btn.dataset.rarityKey;
      renderAltarTiers();
    });
  });
  el.querySelectorAll(".altar-cancel-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      altarActiveTier = null;
      altarSelection = new Map();
      renderAltarTiers();
    });
  });
  el.querySelectorAll(".altar-step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cardId = Number(btn.dataset.cardId);
      const next = (altarSelection.get(cardId) || 0) + Number(btn.dataset.delta);
      if (next <= 0) altarSelection.delete(cardId); else altarSelection.set(cardId, next);
      renderAltarTiers();
    });
  });
  el.querySelectorAll(".altar-confirm-btn").forEach((btn) => {
    btn.addEventListener("click", sacrificeAtAltar);
  });
}

async function sacrificeAtAltar() {
  const cardIds = [];
  altarSelection.forEach((count, cardId) => { for (let i = 0; i < count; i++) cardIds.push(cardId); });
  if (cardIds.length !== 3) return;

  const names = cardIds.map((id) => allCards.find((c) => c.cardId === id)?.name || "?").join(", ");
  const ok = await Confirm.show(
    `Sacrifier <strong>${names}</strong> pour tenter d'obtenir une carte aléatoire de la rareté supérieure ? ` +
    `<br><br>50% de réussite. En cas d'échec, ces 3 cartes sont perdues définitivement.`,
    { title: "Sacrifice à l'autel ?", confirmText: "Sacrifier", dangerous: true }
  );
  if (!ok) return;

  try {
    const res = await API.altarSacrifice(Session.userId, cardIds);
    altarActiveTier = null;
    altarSelection = new Map();
    await reload();
    setActiveTab("altar");
    showAltarResultModal(res);
  } catch (e) {
    const messages = {
      not_enough_duplicates: "Plus assez de doublons pour cette sélection.",
      mixed_rarity: "Les 3 cartes doivent être de la même rareté.",
      invalid_selection: "Sélection invalide.",
      no_target_card: "Toutes les cartes de la rareté supérieure sont épuisées."
    };
    Toast.error(messages[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

// Resultat du sacrifice en modale plutot qu'en toast : le joueur doit
// cliquer explicitement pour la fermer, jamais de disparition automatique
// (meme principe que la roue de la fortune).
function showAltarResultModal(res) {
  const overlay = document.createElement("div");
  overlay.className = "card-modal-overlay confirm-overlay";
  document.body.appendChild(overlay);

  let bodyHtml;
  if (res.success) {
    const card = res.card;
    const color = card.rarity?.colorHex || "#9aa0b4";
    const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
    bodyHtml = `
      <div class="confirm-title">&#128293; Sacrifice réussi !</div>
      <img src="${imgSrc}" alt="${card.name}" class="altar-result-img" style="box-shadow:0 0 24px ${color}88;" />
      <div class="confirm-message">
        <strong>${card.name}</strong> obtenue !<br />
        <span class="rarity-badge" style="margin-top:8px;background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">${card.rarity?.name || "Commune"}</span>
        ${res.isFirstEver ? `<div class="first-obtainer-badge" style="margin-top:10px;">&#127942; Première obtention du serveur !</div>` : ""}
      </div>
    `;
  } else {
    bodyHtml = `
      <div class="confirm-title">&#128165; Sacrifice échoué</div>
      <div class="confirm-message">Les 3 cartes sacrifiées sont perdues définitivement. Retente ta chance quand tu veux.</div>
    `;
  }

  overlay.innerHTML = `
    <div class="confirm-box">
      ${bodyHtml}
      <div class="confirm-actions">
        <button type="button" class="altar-result-close-btn">Fermer</button>
      </div>
    </div>
  `;

  function close() { overlay.remove(); syncScrollLock(); }
  overlay.querySelector(".altar-result-close-btn").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  syncScrollLock();

  if (res.success) {
    if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
    Sfx.reveal(res.card.rarity?.key);
  }
}

// Finitions : fusionner 5 exemplaires identiques (meme carte, meme
// finition) en 1 exemplaire de la finition superieure. Deterministe (pas de
// hasard, contrairement a l'autel) - on liste directement toutes les
// fusions possibles plutot qu'un picker, puisqu'il n'y a rien a choisir
// (n'importe lesquels des 5 exemplaires identiques font l'affaire).
function renderFinishTiers() {
  const el = document.getElementById("finish-tiers");
  const upgrades = [];
  ownedMap.forEach((owned, cardId) => {
    const card = allCards.find((c) => c.cardId === cardId);
    if (!card || card.isPromo) return;
    const counts = owned.finishCounts || {};
    for (let i = 0; i < FINISH_ORDER.length - 1; i++) {
      const from = FINISH_ORDER[i];
      if ((counts[from] || 0) >= 5) {
        upgrades.push({ card, fromFinish: from, toFinish: FINISH_ORDER[i + 1], available: counts[from] });
      }
    }
  });

  if (!upgrades.length) {
    el.innerHTML = `<div class="empty-state">Aucune fusion possible pour l'instant : il te faut 5 exemplaires identiques (même carte, même finition) d'un coup.</div>`;
    return;
  }

  el.innerHTML = upgrades.map((u) => {
    const imgSrc = API.imageUrl(u.card.imageId) || PLACEHOLDER_IMG;
    return `
      <div class="finish-upgrade-row">
        <img src="${imgSrc}" alt="${u.card.name}" loading="lazy" />
        <div class="finish-upgrade-info">
          <div class="finish-upgrade-name">${u.card.name}</div>
          <div class="finish-upgrade-path">
            <span class="finish-tag" data-finish="${u.fromFinish}">${FINISH_LABELS[u.fromFinish]}</span>
            <span aria-hidden="true">&#8594;</span>
            <span class="finish-tag" data-finish="${u.toFinish}">${FINISH_LABELS[u.toFinish]}</span>
          </div>
          <div class="finish-upgrade-count">${u.available} exemplaires disponibles (5 requis)</div>
        </div>
        <button type="button" class="btn-secondary finish-upgrade-btn" data-card-id="${u.card.cardId}" data-from-finish="${u.fromFinish}">Fusionner</button>
      </div>
    `;
  }).join("");

  el.querySelectorAll(".finish-upgrade-btn").forEach((btn) => {
    btn.addEventListener("click", () => upgradeFinish(Number(btn.dataset.cardId), btn.dataset.fromFinish));
  });
}

async function upgradeFinish(cardId, fromFinish) {
  const card = allCards.find((c) => c.cardId === cardId);
  const toFinish = FINISH_ORDER[FINISH_ORDER.indexOf(fromFinish) + 1];
  const ok = await Confirm.show(
    `Fusionner 5 exemplaires <strong>${FINISH_LABELS[fromFinish]}</strong> de <strong>${card?.name || "cette carte"}</strong> en 1 exemplaire <strong>${FINISH_LABELS[toFinish]}</strong> ? ` +
    `Les 5 exemplaires sacrifiés sont perdus définitivement.`,
    { title: "Fusionner ces cartes ?", confirmText: "Fusionner", dangerous: true }
  );
  if (!ok) return;
  try {
    const res = await API.foilUpgrade(Session.userId, cardId, fromFinish);
    Toast.success(`${card?.name || "Carte"} passe en ${FINISH_LABELS[res.toFinish]} !`);
    if (typeof confetti === "function") confetti({ particleCount: 130, spread: 100, origin: { y: 0.5 } });
    await reload();
    setActiveTab("finish");
  } catch (e) {
    Toast.error(FINISH_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

function craftCardTile(card, mode) {
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  if (mode === "disenchant") {
    const owned = ownedMap.get(card.cardId);
    const dust = card.rarity?.disenchantValue || 0;
    const checked = bulkSelected.has(card.cardId);
    return `
      <div class="craft-card ${bulkSelectMode ? "bulk-mode" : ""} ${checked ? "selected" : ""}" data-card-id="${card.cardId}" data-rarity="${card.rarity?.key || "commune"}">
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
    <div class="craft-card ${canAfford ? "" : "unavailable"}" data-card-id="${card.cardId}" data-rarity="${card.rarity?.key || "commune"}">
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
    // Craft/decraft/autel accordent de l'XP (niveaux de profil) : rafraichit
    // le badge de niveau dans le header, pas seulement le solde de cette page.
    loadHeaderBoosterBadge();

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
  document.getElementById("tab-altar-btn").addEventListener("click", () => setActiveTab("altar"));
  document.getElementById("tab-finish-btn").addEventListener("click", () => setActiveTab("finish"));

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
