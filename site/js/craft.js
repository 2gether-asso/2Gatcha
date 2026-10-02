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
const QUALITY_ERRORS = {
  card_not_found: "Carte introuvable.",
  promo_not_repairable: "Cette carte promo ne peut pas être restaurée.",
  card_inactive: "Cette carte n'est plus disponible.",
  invalid_quality: "Cette qualité ne peut pas être restaurée davantage.",
  not_enough_duplicates: "Il te faut 3 exemplaires identiques pour restaurer.",
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

// Echelle de qualite, du plus abime au plus parfait (voir grist/SCHEMA.md et
// card-quality-repair.json - meme ordre des deux cotes).
const QUALITY_ORDER = ["damaged", "worn", "good", "mint"];
const QUALITY_LABELS = {
  damaged: "Abîmé",
  worn: "Usé",
  good: "Bon état",
  mint: "Parfait état"
};

// La vignette de decraft agrege tous les exemplaires d'une carte (contrairement
// a la collection, qui affiche desormais une pile distincte par variante) :
// elle doit donc montrer la variante que le decraft consommera VRAIMENT en
// premier si aucune variante n'est precisee (voir disenchant.json), c'est a
// dire la moins prestigieuse - finition la plus basse en priorite, qualite la
// plus basse ensuite.
function worstFinish(finishCounts) {
  if (!finishCounts) return "normal";
  for (let i = 0; i < FINISH_ORDER.length; i++) {
    if (finishCounts[FINISH_ORDER[i]] > 0) return FINISH_ORDER[i];
  }
  return "normal";
}
// Le pire etat possede en priorite (comme collection.js) : une vignette de
// decraft doit signaler une carte abimee, pas la cacher derriere un
// exemplaire plus propre du meme doublon.
function worstQuality(qualityCounts) {
  if (!qualityCounts) return "mint";
  for (let i = 0; i < QUALITY_ORDER.length; i++) {
    if (qualityCounts[QUALITY_ORDER[i]] > 0) return QUALITY_ORDER[i];
  }
  return "mint";
}

// { finishKey: multiplier } / { qualityKey: multiplier }, renvoyes par
// get-cards.json - le vrai montant applique par disenchant.json est TOUJOURS
// la valeur de base de la rarete multipliee par ces deux facteurs (voir meme
// commentaire dans collection.js).
let finishMultipliers = {};
let qualityMultipliers = {};
function estimateDust(baseValue, finish, quality) {
  const fm = finishMultipliers[finish] != null ? finishMultipliers[finish] : 1;
  const qm = qualityMultipliers[quality] != null ? qualityMultipliers[quality] : 1;
  return Math.round((baseValue || 0) * fm * qm);
}

let stardust = 0;
let ownedMap = new Map();
let allCards = [];
let bulkSelectMode = false;
let bulkSelected = new Set();
let craftBulkSelectMode = false;
let craftBulkSelected = new Set();
let disenchantQty = new Map();
let craftQty = new Map();
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

// Onglets qui debloquent progressivement avec le niveau (voir main.js,
// FEATURE_UNLOCK_LEVEL) : Decraft reste toujours disponible, c'est la porte
// d'entree vers Craft.
function applyFeatureLocks() {
  ["craft", "altar", "finish", "quality"].forEach((key) => {
    const btn = document.getElementById(`tab-${key}-btn`);
    if (!btn) return;
    const locked = knownProfileLevel < FEATURE_UNLOCK_LEVEL[key];
    btn.classList.toggle("locked", locked);
    btn.title = locked ? `Débloqué au niveau ${FEATURE_UNLOCK_LEVEL[key]}` : "";
  });
}

// Memorise le dernier onglet visite (QoL 2026-09-30). Ne restaure jamais un
// onglet devenu verrouille entre-temps (ex: admin qui relève un palier) -
// getInitialTab() revalide contre knownProfileLevel avant d'utiliser la
// valeur memorisee, plutot que de laisser setActiveTab la rejeter en
// silence au tout premier appel (aucun onglet ne serait alors affiche).
const LAST_TAB_KEY = "2gatcha_last_tab_craft";
function getInitialTab() {
  let tab = "disenchant";
  try { tab = localStorage.getItem(LAST_TAB_KEY) || "disenchant"; } catch (e) {}
  if (FEATURE_UNLOCK_LEVEL[tab] && knownProfileLevel < FEATURE_UNLOCK_LEVEL[tab]) return "disenchant";
  return tab;
}

function setActiveTab(tab) {
  if (FEATURE_UNLOCK_LEVEL[tab] && knownProfileLevel < FEATURE_UNLOCK_LEVEL[tab]) {
    Toast.info(`${FEATURE_LABELS[tab]} se débloque au niveau ${FEATURE_UNLOCK_LEVEL[tab]} (tu es niveau ${knownProfileLevel}).`);
    return;
  }
  try { localStorage.setItem(LAST_TAB_KEY, tab); } catch (e) {}
  activeTab = tab;
  document.getElementById("tab-disenchant-btn").classList.toggle("active", tab === "disenchant");
  document.getElementById("tab-disenchant-btn").setAttribute("aria-selected", String(tab === "disenchant"));
  document.getElementById("tab-craft-btn").classList.toggle("active", tab === "craft");
  document.getElementById("tab-craft-btn").setAttribute("aria-selected", String(tab === "craft"));
  document.getElementById("tab-altar-btn").classList.toggle("active", tab === "altar");
  document.getElementById("tab-altar-btn").setAttribute("aria-selected", String(tab === "altar"));
  document.getElementById("tab-finish-btn").classList.toggle("active", tab === "finish");
  document.getElementById("tab-finish-btn").setAttribute("aria-selected", String(tab === "finish"));
  document.getElementById("tab-quality-btn").classList.toggle("active", tab === "quality");
  document.getElementById("tab-quality-btn").setAttribute("aria-selected", String(tab === "quality"));
  document.getElementById("disenchant-pane").style.display = tab === "disenchant" ? "block" : "none";
  document.getElementById("craft-pane").style.display = tab === "craft" ? "block" : "none";
  document.getElementById("altar-pane").style.display = tab === "altar" ? "block" : "none";
  document.getElementById("finish-pane").style.display = tab === "finish" ? "block" : "none";
  document.getElementById("quality-pane").style.display = tab === "quality" ? "block" : "none";
  document.getElementById("hide-owned-label").style.display = tab === "craft" ? "flex" : "none";
  // La barre de recherche/filtres ne concerne ni l'autel ni les finitions/
  // qualite (pas des grilles de cartes a trier, juste des paliers/fusions).
  document.querySelector(".craft-toolbar").style.display = (tab === "altar" || tab === "finish" || tab === "quality") ? "none" : "flex";
  document.getElementById("craft-search-input").placeholder =
    tab === "disenchant" ? "Rechercher parmi mes cartes..." : "Rechercher une carte à crafter...";
  if (tab === "altar") renderAltarTiers();
  if (tab === "finish") renderFinishTiers();
  if (tab === "quality") renderQualityTiers();
}

// Autel de sacrifice : le joueur choisit lui-meme, parmi ses doublons (au
// moins 2 exemplaires, un seul jamais sacrifiable), les 3 cartes a offrir
// pour tenter (50%) d'obtenir une carte aleatoire de la rarete superieure.
// Autel (refonte 2026-10-02) : 3 slots remplis a la main avec des exemplaires
// PRECIS (pullId) - jamais une #001 ou une arc-en-ciel sacrifiee par hasard.
let altarSlots = [null, null, null];
let altarSearch = "";

const ALTAR_FINISH_RANK = ["normal", "holo", "gold", "ghost", "diamond", "rainbow"];
const ALTAR_QUALITY_RANK = ["damaged", "worn", "good", "mint"];

// Tous les exemplaires "posables" : cartes non-promo, possedees en 2+
// exemplaires (on garde toujours au moins 1 exemplaire de chaque carte), et
// dont la rarete a un palier au-dessus.
function altarCopies() {
  const sortOrders = allCards.filter((c) => !c.isPromo && c.rarity).map((c) => c.rarity.sortOrder ?? 0);
  const maxOrder = sortOrders.length ? Math.max(...sortOrders) : 0;
  const list = [];
  allCards.forEach((card) => {
    if (card.isPromo || !card.rarity || (card.rarity.sortOrder ?? 0) >= maxOrder) return;
    const owned = ownedMap.get(card.cardId);
    if (!owned || owned.count < 2) return;
    (owned.copies || []).forEach((c) => list.push({ ...c, card, ownedCount: owned.count }));
  });
  return list.sort((a, b) =>
    ((a.card.rarity.sortOrder ?? 0) - (b.card.rarity.sortOrder ?? 0)) ||
    a.card.name.localeCompare(b.card.name) ||
    (ALTAR_FINISH_RANK.indexOf(a.finish || "normal") - ALTAR_FINISH_RANK.indexOf(b.finish || "normal")) ||
    (ALTAR_QUALITY_RANK.indexOf(a.quality || "damaged") - ALTAR_QUALITY_RANK.indexOf(b.quality || "damaged")) ||
    ((b.serialNumber || 0) - (a.serialNumber || 0)));
}

function altarCopyLabel(c) {
  const parts = [];
  if ((c.finish || "normal") !== "normal") parts.push(FINISH_LABELS[c.finish]);
  parts.push(QUALITY_LABELS[c.quality || "damaged"]);
  return parts.join(" · ");
}
function altarIsPrecious(c) { return c.serialNumber === 1 || c.finish === "rainbow" || c.quality === "mint"; }

function renderAltarTiers() {
  const root = document.getElementById("altar-tiers");
  const copies = altarCopies();
  const byPull = new Map(copies.map((c) => [c.pullId, c]));
  altarSlots = altarSlots.map((id) => (id != null && byPull.has(id) ? id : null));
  const slotted = altarSlots.filter((id) => id != null).map((id) => byPull.get(id));
  const lockedRarity = slotted.length ? slotted[0].card.rarity.key : null;
  const slottedPerCard = new Map();
  slotted.forEach((c) => slottedPerCard.set(c.card.cardId, (slottedPerCard.get(c.card.cardId) || 0) + 1));
  const nextRarity = (() => {
    if (!lockedRarity) return null;
    const order = slotted[0].card.rarity.sortOrder ?? 0;
    const higher = allCards.filter((c) => c.rarity && !c.isPromo && (c.rarity.sortOrder ?? 0) > order)
      .sort((a, b) => (a.rarity.sortOrder ?? 0) - (b.rarity.sortOrder ?? 0))[0];
    return higher ? higher.rarity : null;
  })();
  const precious = slotted.filter(altarIsPrecious);
  const q = normalize(altarSearch);

  const slotHtml = altarSlots.map((id, i) => {
    const c = id != null ? byPull.get(id) : null;
    if (!c) return `<div class="altar-slot empty"><span>Emplacement ${i + 1}</span></div>`;
    const imgSrc = API.imageUrl(c.card.imageId) || PLACEHOLDER_IMG;
    return `
      <button type="button" class="altar-slot filled" data-slot="${i}" title="Retirer de l'autel" style="--slot-color:${c.card.rarity.colorHex || "#9aa0b4"};">
        <img src="${imgSrc}" alt="" />
        <span class="altar-slot-name">${c.card.name}</span>
        <span class="altar-slot-meta">#${String(c.serialNumber ?? "?").padStart(3, "0")} · ${altarCopyLabel(c)}</span>
        <span class="altar-slot-remove" aria-hidden="true">&times;</span>
      </button>`;
  }).join("");

  const visible = copies.filter((c) => !altarSlots.includes(c.pullId) && (!q || normalize(c.card.name).includes(q)));
  const gridHtml = visible.length ? visible.map((c) => {
    const keepsOne = c.ownedCount - (slottedPerCard.get(c.card.cardId) || 0) > 1;
    const sameRarity = !lockedRarity || c.card.rarity.key === lockedRarity;
    const full = slotted.length >= 3;
    const disabled = !keepsOne || !sameRarity || full;
    const reason = !sameRarity ? "Autre rareté que les cartes déjà posées" : !keepsOne ? "Tu dois garder au moins 1 exemplaire de cette carte" : full ? "L'autel est plein" : "Poser sur l'autel";
    const imgSrc = API.imageUrl(c.card.imageId) || PLACEHOLDER_IMG;
    return `
      <button type="button" class="altar-copy ${disabled ? "disabled" : ""}" data-pull="${c.pullId}" ${disabled ? "disabled" : ""} title="${reason}" data-rarity="${c.card.rarity.key}">
        <img src="${imgSrc}" alt="" loading="lazy" />
        <span class="altar-copy-name">${c.card.name}</span>
        <span class="altar-copy-meta">#${String(c.serialNumber ?? "?").padStart(3, "0")} · ${altarCopyLabel(c)}</span>
        ${altarIsPrecious(c) ? '<span class="altar-copy-precious">précieux</span>' : ""}
      </button>`;
  }).join("") : `<div class="empty-state">${copies.length ? "Aucun exemplaire ne correspond." : "Aucun doublon sacrifiable pour l'instant (il faut 2 exemplaires d'une carte, hors rareté maximale)."}</div>`;

  root.innerHTML = `
    <div class="altar-board">
      <div class="altar-slots">${slotHtml}</div>
      <div class="altar-odds">
        ${lockedRarity
          ? `<strong>${slotted[0].card.rarity.name}</strong> &rarr; <strong>${nextRarity ? nextRarity.name : "?"}</strong> · 50% de réussite · échec : un os &#129460;`
          : "Pose 3 exemplaires d'une même rareté. 50% de réussite · échec : un os &#129460;"}
      </div>
      ${precious.length ? `<div class="altar-warning">&#9888; Tu poses des exemplaires précieux : ${precious.map((c) => "#" + String(c.serialNumber ?? "?").padStart(3, "0") + " " + c.card.name).join(", ")}</div>` : ""}
      <div class="altar-actions">
        <button type="button" class="btn-ghost altar-clear-btn" ${slotted.length ? "" : "disabled"}>Vider l'autel</button>
        <button type="button" class="btn-danger altar-confirm-btn" ${slotted.length === 3 ? "" : "disabled"}>&#128293; Sacrifier</button>
      </div>
    </div>
    <div class="craft-toolbar">
      <input type="text" id="altar-search" placeholder="Rechercher un exemplaire..." autocomplete="off" value="${altarSearch.replace(/"/g, "&quot;")}" />
    </div>
    <div class="altar-copy-grid">${gridHtml}</div>
  `;

  root.querySelectorAll(".altar-slot.filled").forEach((btn) => btn.addEventListener("click", () => {
    altarSlots[Number(btn.dataset.slot)] = null;
    renderAltarTiers();
  }));
  root.querySelectorAll(".altar-copy:not(.disabled)").forEach((btn) => btn.addEventListener("click", () => {
    const free = altarSlots.indexOf(null);
    if (free < 0) return;
    altarSlots[free] = Number(btn.dataset.pull);
    renderAltarTiers();
  }));
  root.querySelector(".altar-clear-btn").addEventListener("click", () => { altarSlots = [null, null, null]; renderAltarTiers(); });
  root.querySelector(".altar-confirm-btn").addEventListener("click", sacrificeAtAltar);
  const search = root.querySelector("#altar-search");
  search.addEventListener("input", () => {
    altarSearch = search.value;
    const pos = search.selectionStart;
    renderAltarTiers();
    const again = document.getElementById("altar-search");
    again.focus();
    again.setSelectionRange(pos, pos);
  });
}

async function sacrificeAtAltar() {
  const pullIds = altarSlots.filter((id) => id != null);
  if (pullIds.length !== 3) return;
  const byPull = new Map(altarCopies().map((c) => [c.pullId, c]));
  const names = pullIds.map((id) => {
    const c = byPull.get(id);
    return c ? `${c.card.name} (#${String(c.serialNumber ?? "?").padStart(3, "0")})` : "?";
  }).join(", ");
  const ok = await Confirm.show(
    `Sacrifier <strong>${names}</strong> pour tenter d'obtenir une carte aléatoire de la rareté supérieure ?` +
    `<br><br>50% de réussite. En cas d'échec, ces 3 cartes sont perdues (l'autel te laisse un os &#129460;).`,
    { title: "Sacrifice à l'autel ?", confirmText: "Sacrifier", dangerous: true }
  );
  if (!ok) return;
  const btn = document.querySelector(".altar-confirm-btn");
  if (btn) btn.disabled = true;
  try {
    const res = await API.altarSacrifice(Session.userId, pullIds);
    altarSlots = [null, null, null];
    await reload();
    setActiveTab("altar");
    showAltarResultModal(res);
  } catch (e) {
    if (btn) btn.disabled = false;
    const messages = {
      not_enough_duplicates: "Tu dois garder au moins 1 exemplaire de chaque carte.",
      mixed_rarity: "Les 3 cartes doivent être de la même rareté.",
      invalid_selection: "Sélection invalide (un exemplaire n'est plus disponible ?).",
      no_target_card: "Toutes les cartes de la rareté supérieure sont épuisées.",
      no_higher_tier: "Cette rareté est déjà la plus haute."
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
      <div class="confirm-message">Les 3 cartes sacrifiées sont perdues.${res.boneGained ? `<br><br><span class="altar-bone-gain">&#129460; L'autel te laisse un <strong>os</strong>${res.newBoneCount ? ` (tu en as ${res.newBoneCount})` : ""}. Un chien saura quoi en faire dans la Fouille...</span>` : ""}</div>
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
  const copies = ((ownedMap.get(cardId) || {}).copies || []).filter((c) => (c.finish || "normal") === fromFinish);
  const selection = await FusionPicker.open({
    title: "Fusionner en " + FINISH_LABELS[toFinish],
    intro: `Choisis les <strong>5 exemplaires ${FINISH_LABELS[fromFinish]}</strong> de <strong>${card?.name || "cette carte"}</strong> à sacrifier, et le numéro que gardera le nouvel exemplaire <strong>${FINISH_LABELS[toFinish]}</strong>. La meilleure qualité sacrifiée est conservée.`,
    copies,
    required: 5,
    otherRank: (c) => FUSION_QUALITY_RANK.indexOf(c.quality || "damaged")
  });
  if (!selection) return;
  try {
    const res = await API.foilUpgrade(Session.userId, cardId, fromFinish, selection);
    Toast.success(`${card?.name || "Carte"} passe en ${FINISH_LABELS[res.toFinish]} !`);
    if (typeof confetti === "function") confetti({ particleCount: 130, spread: 100, origin: { y: 0.5 } });
    await reload();
    setActiveTab("finish");
  } catch (e) {
    Toast.error(FINISH_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

function renderQualityTiers() {
  const el = document.getElementById("quality-tiers");
  const repairs = [];
  ownedMap.forEach((owned, cardId) => {
    const card = allCards.find((c) => c.cardId === cardId);
    if (!card || card.isPromo) return;
    const counts = owned.qualityCounts || {};
    for (let i = 0; i < QUALITY_ORDER.length - 1; i++) {
      const from = QUALITY_ORDER[i];
      if ((counts[from] || 0) >= 3) {
        repairs.push({ card, fromQuality: from, toQuality: QUALITY_ORDER[i + 1], available: counts[from] });
      }
    }
  });

  if (!repairs.length) {
    el.innerHTML = `<div class="empty-state">Aucune restauration possible pour l'instant : il te faut 3 exemplaires identiques (même carte, même qualité) d'un coup.</div>`;
    return;
  }

  el.innerHTML = repairs.map((u) => {
    const imgSrc = API.imageUrl(u.card.imageId) || PLACEHOLDER_IMG;
    return `
      <div class="finish-upgrade-row">
        <img src="${imgSrc}" alt="${u.card.name}" loading="lazy" />
        <div class="finish-upgrade-info">
          <div class="finish-upgrade-name">${u.card.name}</div>
          <div class="finish-upgrade-path">
            <span class="quality-tag" data-quality="${u.fromQuality}">${QUALITY_LABELS[u.fromQuality]}</span>
            <span aria-hidden="true">&#8594;</span>
            <span class="quality-tag" data-quality="${u.toQuality}">${QUALITY_LABELS[u.toQuality]}</span>
          </div>
          <div class="finish-upgrade-count">${u.available} exemplaires disponibles (3 requis)</div>
        </div>
        <button type="button" class="btn-secondary quality-repair-btn" data-card-id="${u.card.cardId}" data-from-quality="${u.fromQuality}">Restaurer</button>
      </div>
    `;
  }).join("");

  el.querySelectorAll(".quality-repair-btn").forEach((btn) => {
    btn.addEventListener("click", () => repairQuality(Number(btn.dataset.cardId), btn.dataset.fromQuality));
  });
}

async function repairQuality(cardId, fromQuality) {
  const card = allCards.find((c) => c.cardId === cardId);
  const toQuality = QUALITY_ORDER[QUALITY_ORDER.indexOf(fromQuality) + 1];
  const copies = ((ownedMap.get(cardId) || {}).copies || []).filter((c) => (c.quality || "damaged") === fromQuality);
  const selection = await FusionPicker.open({
    title: "Restaurer en " + QUALITY_LABELS[toQuality],
    intro: `Choisis les <strong>3 exemplaires ${QUALITY_LABELS[fromQuality]}</strong> de <strong>${card?.name || "cette carte"}</strong> à consommer, et le numéro que gardera le nouvel exemplaire <strong>${QUALITY_LABELS[toQuality]}</strong>. La meilleure finition consommée est conservée.`,
    copies,
    required: 3,
    otherRank: (c) => FUSION_FINISH_RANK.indexOf(c.finish || "normal"),
    confirmText: "Restaurer"
  });
  if (!selection) return;
  try {
    const res = await API.repairCardQuality(Session.userId, cardId, fromQuality, selection);
    Toast.success(`${card?.name || "Carte"} passe en ${QUALITY_LABELS[res.toQuality]} !`);
    if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
    await reload();
    setActiveTab("quality");
  } catch (e) {
    Toast.error(QUALITY_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

// Variantes possedees d'une carte (meme logique que collection.js) : une
// pile distincte par finition + qualite, pour decrafter EXACTEMENT
// l'exemplaire voulu au lieu de laisser le serveur choisir "le moins
// prestigieux" (refonte 2026-10-01, alignee sur le decraft de la collection).
function buildVariants(owned) {
  if (!owned || !owned.copies || !owned.copies.length) return [];
  const map = new Map();
  owned.copies.forEach((c) => {
    const finish = c.finish || "normal";
    const quality = c.quality || "damaged";
    const key = finish + "::" + quality;
    if (!map.has(key)) map.set(key, { finish, quality, count: 0, serialNumbers: [] });
    const v = map.get(key);
    v.count++;
    if (c.serialNumber != null) v.serialNumbers.push(c.serialNumber);
  });
  return [...map.values()].sort((a, b) =>
    (FINISH_ORDER.indexOf(a.finish) - FINISH_ORDER.indexOf(b.finish)) ||
    (QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality))
  );
}

function variantKey(cardId, finish, quality) { return cardId + "::" + finish + "::" + quality; }
function parseVariantKey(key) {
  const [cardId, finish, quality] = key.split("::");
  return { cardId: Number(cardId), finish, quality };
}
// Tous les exemplaires possedes, par variante : { key -> { card, variant } }.
let disenchantVariants = new Map();

function disenchantTile(card, variant) {
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  const { finish, quality, count } = variant;
  const key = variantKey(card.cardId, finish, quality);
  const checked = bulkSelected.has(key);
  const qty = Math.min(Math.max(disenchantQty.get(key) || 1, 1), count);
  const dustEach = estimateDust(card.rarity?.disenchantValue || 0, finish, quality);
  const reward = card.isSecret ? `+${qty} booster${qty > 1 ? "s" : ""}` : `+${dustEach * qty} poussières`;
  const hasFirst = (variant.serialNumbers || []).includes(1);
  // Carte secrete : contrepartie en boosters (voir disenchant.json), exclue de
  // la selection multiple dont le total est exprime en poussieres.
  const bulkCheckable = bulkSelectMode && !card.isSecret;
  return `
    <div class="craft-card ${bulkSelectMode ? "bulk-mode" : ""} ${checked ? "selected" : ""}" data-card-id="${card.cardId}" data-variant-key="${key}" data-rarity="${card.rarity?.key || "commune"}" data-finish="${finish}" data-quality="${quality}">
      ${bulkCheckable ? `<label class="bulk-checkbox"><input type="checkbox" data-bulk-id="${key}" ${checked ? "checked" : ""} /></label>` : ""}
      <div class="card-art">
        <img src="${imgSrc}" alt="${card.name}" loading="lazy" />
        ${finish !== "normal" ? `<span class="finish-indicator" data-finish="${finish}">${FINISH_LABELS[finish]}</span>` : ""}
        <span class="quality-indicator" data-quality="${quality}">${QUALITY_LABELS[quality]}</span>
        ${hasFirst ? `<span class="serial-one-badge" title="Premier exemplaire en circulation">#001</span>` : ""}
      </div>
      <div class="card-info">
        <div class="card-name">${card.name}</div>
        <div class="owned-count">Possède x${count}${hasFirst ? " · dont le #001" : ""}</div>
        <div class="craft-cost" data-reward-display="${key}">${reward}</div>
        ${count > 1 ? `
          <div class="qty-stepper">
            <button type="button" class="qty-btn" data-dqty="minus" data-key="${key}" ${qty <= 1 ? "disabled" : ""}>&minus;</button>
            <span class="qty-value" data-dqty-display="${key}">${qty}</span>
            <button type="button" class="qty-btn" data-dqty="plus" data-key="${key}" ${qty >= count ? "disabled" : ""}>+</button>
          </div>
        ` : ""}
        <button class="disenchant-btn" data-key="${key}" ${bulkSelectMode ? "disabled" : ""}>${qty > 1 ? `Décrafter x${qty}` : "Décrafter"}</button>
      </div>
    </div>
  `;
}

function adjustDisenchantQty(key, delta) {
  const entry = disenchantVariants.get(key);
  if (!entry) return;
  const max = Math.max(entry.variant.count, 1);
  const next = Math.min(Math.max((disenchantQty.get(key) || 1) + delta, 1), max);
  disenchantQty.set(key, next);
  const tile = document.querySelector(`.craft-card[data-variant-key="${key}"]`);
  if (!tile) return;
  const { card, variant } = entry;
  tile.querySelector(`[data-dqty-display="${key}"]`).textContent = next;
  tile.querySelector(".disenchant-btn").textContent = next > 1 ? `Décrafter x${next}` : "Décrafter";
  tile.querySelector('[data-dqty="minus"]').disabled = next <= 1;
  tile.querySelector('[data-dqty="plus"]').disabled = next >= max;
  const dustEach = estimateDust(card.rarity?.disenchantValue || 0, variant.finish, variant.quality);
  tile.querySelector(`[data-reward-display="${key}"]`).textContent = card.isSecret ? `+${next} booster${next > 1 ? "s" : ""}` : `+${dustEach * next} poussières`;
  if (bulkSelected.has(key)) updateBulkBar();
}

function craftCardTile(card, mode) {
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  const cost = card.rarity?.craftCost || 0;
  const canAfford = stardust >= cost;
  const craftChecked = craftBulkSelected.has(card.cardId);
  const maxCraftQty = cost > 0 ? Math.floor(stardust / cost) : 1;
  const craftQtyVal = Math.min(Math.max(craftQty.get(card.cardId) || 1, 1), Math.max(maxCraftQty, 1));
  const showCraftStepper = !craftBulkSelectMode && canAfford && maxCraftQty > 1;
  return `
    <div class="craft-card ${canAfford ? "" : "unavailable"} ${craftBulkSelectMode ? "bulk-mode" : ""} ${craftChecked ? "selected" : ""}" data-card-id="${card.cardId}" data-rarity="${card.rarity?.key || "commune"}">
      ${craftBulkSelectMode ? `<label class="bulk-checkbox"><input type="checkbox" data-craft-bulk-id="${card.cardId}" ${craftChecked ? "checked" : ""} ${canAfford ? "" : "disabled"} /></label>` : ""}
      <img src="${imgSrc}" alt="${card.name}" loading="lazy" />
      <div class="card-info">
        <div class="card-name">${card.name}</div>
        <div class="craft-cost">${cost} poussières</div>
        ${!canAfford ? `<div class="craft-missing">Il te manque ${cost - stardust} poussières</div>` : ""}
        ${showCraftStepper ? `
          <div class="qty-stepper">
            <button type="button" class="qty-btn" data-qty-action="minus" data-mode="craft" data-card-id="${card.cardId}" ${craftQtyVal <= 1 ? "disabled" : ""}>&minus;</button>
            <span class="qty-value" data-qty-display="craft" data-card-id="${card.cardId}">${craftQtyVal}</span>
            <button type="button" class="qty-btn" data-qty-action="plus" data-mode="craft" data-card-id="${card.cardId}" ${craftQtyVal >= maxCraftQty ? "disabled" : ""}>+</button>
          </div>
        ` : ""}
        <button class="craft-btn" data-card-id="${card.cardId}" ${canAfford && !craftBulkSelectMode ? "" : "disabled"}>${craftQtyVal > 1 ? `Crafter x${craftQtyVal}` : "Crafter"}</button>
      </div>
    </div>
  `;
}

function adjustQty(mode, cardId, delta) {
  const map = mode === "craft" ? craftQty : disenchantQty;
  const card = allCards.find((c) => c.cardId === cardId);
  let max = 1;
  if (mode === "craft") {
    const cost = card?.rarity?.craftCost || 0;
    max = cost > 0 ? Math.floor(stardust / cost) : 1;
  } else {
    max = ownedMap.get(cardId)?.count || 1;
  }
  max = Math.max(max, 1);
  const current = map.get(cardId) || 1;
  const next = Math.min(Math.max(current + delta, 1), max);
  map.set(cardId, next);
  const tile = document.querySelector(`.craft-card[data-card-id="${cardId}"]`);
  if (!tile) return;
  const span = tile.querySelector(`[data-qty-display="${mode}"]`);
  if (span) span.textContent = next;
  const actionBtn = tile.querySelector(mode === "craft" ? ".craft-btn" : ".disenchant-btn");
  if (actionBtn) actionBtn.textContent = next > 1 ? `${mode === "craft" ? "Crafter" : "Decrafter"} x${next}` : (mode === "craft" ? "Crafter" : "Decrafter");
  const minusBtn = tile.querySelector(`[data-qty-action="minus"][data-mode="${mode}"]`);
  const plusBtn = tile.querySelector(`[data-qty-action="plus"][data-mode="${mode}"]`);
  if (minusBtn) minusBtn.disabled = next <= 1;
  if (plusBtn) plusBtn.disabled = next >= max;
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

// Meme effet de bascule 3D + reflet suivant le curseur que collection.js
// (attachTilt) - duplique ici plutot qu'importe (pas de module partage sur
// ce site statique, voir grist/SCHEMA.md convention). Rend enfin les
// finitions holo/diamant/arc-en-ciel du Décrafter aussi vivantes que dans
// la collection, ou elles beneficiaient deja de ce reflet interactif.
function attachTilt(el) {
  const update = (clientX, clientY) => {
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width - 0.5;
    const py = (clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--ry", `${px * 16}deg`);
    el.style.setProperty("--rx", `${py * -16}deg`);
    el.style.setProperty("--shine-x", `${(px + 0.5) * 100}%`);
    el.style.setProperty("--shine-y", `${(py + 0.5) * 100}%`);
  };
  const reset = () => {
    el.style.setProperty("--rx", `0deg`);
    el.style.setProperty("--ry", `0deg`);
    el.style.setProperty("--shine-x", `50%`);
    el.style.setProperty("--shine-y", `50%`);
    el.style.willChange = "auto";
  };
  el.addEventListener("mouseenter", () => { el.style.willChange = "transform"; });
  el.addEventListener("mousemove", (e) => update(e.clientX, e.clientY));
  el.addEventListener("mouseleave", reset);
}

function renderDisenchantGrid() {
  const grid = document.getElementById("disenchant-grid");
  // Exception (2026-09-30) : une carte secrete reste promo mais PEUT etre
  // decraftee (contre un booster plutot que des poussieres, voir
  // disenchant.json) - toutes les AUTRES cartes promo restent exclues.
  let disenchantable = allCards.filter((c) => (!c.isPromo || c.isSecret) && ownedMap.has(c.cardId));
  if (craftRarityFilter !== "all") disenchantable = disenchantable.filter((c) => c.rarity?.key === craftRarityFilter);
  if (craftSearchQuery) {
    const q = normalize(craftSearchQuery);
    disenchantable = disenchantable.filter((c) => normalize(c.name).includes(q));
  }
  disenchantVariants = new Map();
  const entries = [];
  disenchantable.forEach((card) => {
    const owned = ownedMap.get(card.cardId);
    buildVariants(owned).forEach((variant) => {
      const key = variantKey(card.cardId, variant.finish, variant.quality);
      const entry = { card, variant, totalOwned: owned.count || 0 };
      disenchantVariants.set(key, entry);
      entries.push(entry);
    });
  });
  // Les plus gros doublons d'abord (le plus a ecouler), puis les plus
  // rentables, puis par nom - les variantes d'une meme carte restent
  // regroupees (de la moins a la plus prestigieuse, voir buildVariants).
  entries.sort((a, b) =>
    (b.totalOwned - a.totalOwned) ||
    ((b.card.rarity?.disenchantValue || 0) - (a.card.rarity?.disenchantValue || 0)) ||
    a.card.name.localeCompare(b.card.name) ||
    (a.card.cardId - b.card.cardId)
  );
  // Des cles disparues (carte entierement decraftee) ne doivent plus
  // compter dans la selection.
  [...bulkSelected].forEach((k) => { if (!disenchantVariants.has(k)) bulkSelected.delete(k); });
  grid.innerHTML = entries.length
    ? entries.map((e) => disenchantTile(e.card, e.variant)).join("")
    : `<div class="empty-state">Aucune carte décraftable ne correspond.</div>`;
  grid.querySelectorAll(".craft-card").forEach(attachTilt);
  grid.querySelectorAll(".disenchant-btn").forEach((btn) => {
    btn.addEventListener("click", () => disenchant(btn.dataset.key, btn));
  });
  grid.querySelectorAll("[data-dqty]").forEach((btn) => {
    btn.addEventListener("click", () => adjustDisenchantQty(btn.dataset.key, btn.dataset.dqty === "plus" ? 1 : -1));
  });
  grid.querySelectorAll("[data-bulk-id]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const key = cb.dataset.bulkId;
      if (e.target.checked) bulkSelected.add(key); else bulkSelected.delete(key);
      cb.closest(".craft-card").classList.toggle("selected", e.target.checked);
      updateBulkBar();
    });
  });
  updateBulkBar();
}

// Selection multiple : chaque variante cochee est decraftee a hauteur de la
// quantite choisie sur SA tuile (1 par defaut) - total exact, puisque la
// finition/qualite de chaque exemplaire est connue.
function bulkPlan() {
  return [...bulkSelected].map((key) => {
    const entry = disenchantVariants.get(key);
    if (!entry) return null;
    const qty = Math.min(Math.max(disenchantQty.get(key) || 1, 1), entry.variant.count);
    const dust = estimateDust(entry.card.rarity?.disenchantValue || 0, entry.variant.finish, entry.variant.quality) * qty;
    return { key, ...entry, qty, dust };
  }).filter(Boolean);
}

function updateBulkBar() {
  const bar = document.getElementById("bulk-disenchant-bar");
  if (!bulkSelectMode || bulkSelected.size === 0) {
    bar.style.display = "none";
    return;
  }
  const plan = bulkPlan();
  const copies = plan.reduce((s, p) => s + p.qty, 0);
  const dust = plan.reduce((s, p) => s + p.dust, 0);
  bar.style.display = "flex";
  document.getElementById("bulk-disenchant-summary").textContent =
    `${copies} exemplaire${copies > 1 ? "s" : ""} (${plan.length} variante${plan.length > 1 ? "s" : ""}) · +${dust} poussières`;
}

async function bulkDisenchant() {
  const plan = bulkPlan();
  if (!plan.length) return;
  const copies = plan.reduce((s, p) => s + p.qty, 0);
  const totalDust = plan.reduce((s, p) => s + p.dust, 0);
  const lines = plan.slice(0, 8).map((p) =>
    `<li>${p.qty > 1 ? p.qty + "x " : ""}${p.card.name} — ${p.variant.finish !== "normal" ? FINISH_LABELS[p.variant.finish] + ", " : ""}${QUALITY_LABELS[p.variant.quality]}</li>`).join("");
  const ok = await Confirm.show(
    `Décrafter <strong>${copies} exemplaire${copies > 1 ? "s" : ""}</strong> pour <strong>+${totalDust} poussières d'étoile</strong> ?` +
    `<ul style="text-align:left;margin:8px 0;font-size:0.85rem;">${lines}${plan.length > 8 ? `<li>… et ${plan.length - 8} autre(s)</li>` : ""}</ul>` +
    `Solde : ${stardust} &rarr; <strong>${stardust + totalDust}</strong>. Cette action est irréversible.`,
    { title: "Décrafter la sélection ?", confirmText: "Décrafter tout", dangerous: true }
  );
  if (!ok) return;
  const btn = document.getElementById("bulk-disenchant-btn");
  btn.disabled = true;
  let successCount = 0;
  let totalDustGained = 0;
  for (const p of plan) {
    for (let i = 0; i < p.qty; i++) {
      try {
        const res = await API.disenchantCard(Session.userId, p.card.cardId, p.variant.finish, p.variant.quality);
        totalDustGained += res.dustGained || 0;
        successCount++;
      } catch (e) { break; /* variante epuisee ou erreur : on passe a la suivante */ }
    }
  }
  btn.disabled = false;
  Toast.success(`${successCount} exemplaire${successCount > 1 ? "s" : ""} décrafté${successCount > 1 ? "s" : ""} (+${totalDustGained} poussières).`);
  bulkSelected.clear();
  disenchantQty.clear();
  bulkSelectMode = false;
  document.getElementById("bulk-select-toggle").classList.remove("active");
  document.getElementById("select-all-disenchant-btn").style.display = "none";
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
  grid.querySelectorAll('[data-qty-action][data-mode="craft"]').forEach((btn) => {
    btn.addEventListener("click", () => adjustQty("craft", Number(btn.dataset.cardId), btn.dataset.qtyAction === "plus" ? 1 : -1));
  });
  grid.querySelectorAll("[data-craft-bulk-id]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = Number(cb.dataset.craftBulkId);
      if (e.target.checked) craftBulkSelected.add(id); else craftBulkSelected.delete(id);
      cb.closest(".craft-card").classList.toggle("selected", e.target.checked);
      updateBulkCraftBar();
    });
  });
}

function updateBulkCraftBar() {
  const bar = document.getElementById("bulk-craft-bar");
  if (!craftBulkSelectMode || craftBulkSelected.size === 0) {
    bar.style.display = "none";
    return;
  }
  const cost = [...craftBulkSelected].reduce((sum, id) => {
    const card = allCards.find((c) => c.cardId === id);
    return sum + (card?.rarity?.craftCost || 0);
  }, 0);
  bar.style.display = "flex";
  const canAffordAll = cost <= stardust;
  document.getElementById("bulk-craft-summary").textContent =
    `${craftBulkSelected.size} carte${craftBulkSelected.size > 1 ? "s" : ""} sélectionnée${craftBulkSelected.size > 1 ? "s" : ""} · ${cost} poussières` +
    (canAffordAll ? "" : ` (solde insuffisant : ${stardust})`);
  const btn = document.getElementById("bulk-craft-btn");
  btn.disabled = !canAffordAll;
}

async function bulkCraft() {
  const ids = [...craftBulkSelected];
  if (!ids.length) return;
  const cost = ids.reduce((sum, id) => sum + (allCards.find((c) => c.cardId === id)?.rarity?.craftCost || 0), 0);
  if (cost > stardust) return;
  const ok = await Confirm.show(
    `Crafter ces <strong>${ids.length} cartes</strong> pour <strong>${cost} poussières d'étoile</strong> au total ? ` +
    `Solde : ${stardust} &rarr; <strong>${stardust - cost}</strong>.`,
    { title: "Crafter la sélection ?", confirmText: "Crafter tout" }
  );
  if (!ok) return;
  let successCount = 0;
  for (const id of ids) {
    try {
      await API.craftCard(Session.userId, id);
      successCount++;
    } catch (e) { /* on continue avec les suivantes */ }
  }
  if (typeof confetti === "function" && successCount) confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
  Toast.success(`${successCount} carte${successCount > 1 ? "s" : ""} craftée${successCount > 1 ? "s" : ""}.`);
  craftBulkSelected.clear();
  craftBulkSelectMode = false;
  document.getElementById("craft-bulk-select-toggle").classList.remove("active");
  await reload();
}

async function disenchant(key, btn) {
  const entry = disenchantVariants.get(key);
  if (!entry) return;
  const { card, variant } = entry;
  const qty = Math.min(Math.max(disenchantQty.get(key) || 1, 1), variant.count);
  const variantLabel = `${variant.finish !== "normal" ? FINISH_LABELS[variant.finish] + ", " : ""}${QUALITY_LABELS[variant.quality]}`;
  const totalDust = estimateDust(card.rarity?.disenchantValue || 0, variant.finish, variant.quality) * qty;
  // Carte secrete : contrepartie fixe de 1 booster par exemplaire (voir
  // disenchant.json), jamais de poussieres.
  const ok = await Confirm.show(
    card.isSecret
      ? `Décrafter <strong>${qty > 1 ? `${qty}x ` : ""}${card.name}</strong> (${variantLabel}) contre <strong>${qty} booster${qty > 1 ? "s" : ""}</strong> ? Cette action est irréversible.`
      : `Décrafter <strong>${qty > 1 ? `${qty}x ` : ""}${card.name}</strong> (${variantLabel}) contre <strong>+${totalDust} poussières d'étoile</strong> ? ` +
        `Solde : ${stardust} &rarr; <strong>${stardust + totalDust}</strong>. Cette action est irréversible.`,
    { title: "Décrafter cette carte ?", confirmText: qty > 1 ? `Décrafter x${qty}` : "Décrafter", dangerous: true }
  );
  if (!ok) return;
  if (btn) btn.disabled = true;
  let successCount = 0;
  let totalDustGained = 0;
  let totalBoostersGained = 0;
  let lastError = null;
  for (let i = 0; i < qty; i++) {
    try {
      const res = await API.disenchantCard(Session.userId, card.cardId, variant.finish, variant.quality);
      totalDustGained += res.dustGained || 0;
      if (res.boosterGranted) totalBoostersGained++;
      successCount++;
    } catch (e) {
      lastError = e;
      break;
    }
  }
  if (successCount === 0) {
    if (btn) btn.disabled = false;
    Toast.error(DISENCHANT_ERRORS[lastError?.code] || ("Erreur. (" + lastError?.message + ")"));
    return;
  }
  if (totalBoostersGained > 0) {
    Toast.success(`+${totalBoostersGained} booster${totalBoostersGained > 1 ? "s" : ""} (${card.name})`);
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } else {
    Toast.success(successCount > 1 ? `+${totalDustGained} poussières (${successCount}x ${card.name})` : `+${totalDustGained} poussières (${card.name})`);
  }
  disenchantQty.delete(key);
  await playDustDissolve(btn ? btn.closest(".craft-card") : null);
  await reload();
}

async function craftCard(cardId) {
  const card = allCards.find((c) => c.cardId === cardId);
  const cost = card?.rarity?.craftCost || 0;
  const maxAffordable = cost > 0 ? Math.floor(stardust / cost) : 1;
  const qty = Math.min(Math.max(craftQty.get(cardId) || 1, 1), Math.max(maxAffordable, 1));
  const totalCost = cost * qty;
  const ok = await Confirm.show(
    qty > 1
      ? `Crafter <strong>${qty}x ${card?.name || "cette carte"}</strong> pour <strong>${totalCost} poussières d'étoile</strong> au total ? ` +
        `Solde : ${stardust} &rarr; <strong>${stardust - totalCost}</strong>.`
      : `Crafter <strong>${card?.name || "cette carte"}</strong> pour <strong>${totalCost} poussières d'étoile</strong> ? ` +
        `Solde : ${stardust} &rarr; <strong>${stardust - totalCost}</strong>.`,
    { title: "Crafter cette carte ?", confirmText: qty > 1 ? `Crafter x${qty}` : "Crafter" }
  );
  if (!ok) return;
  let successCount = 0;
  let lastError = null;
  let lastCardName = card?.name;
  for (let i = 0; i < qty; i++) {
    try {
      const res = await API.craftCard(Session.userId, cardId);
      lastCardName = res.card.name;
      successCount++;
    } catch (e) {
      lastError = e;
      break;
    }
  }
  if (successCount === 0) {
    Toast.error(CRAFT_ERRORS[lastError?.code] || ("Erreur. (" + lastError?.message + ")"));
    return;
  }
  Toast.success(successCount > 1 ? `${successCount}x ${lastCardName} craftées !` : `${lastCardName} craftee !`);
  if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
  craftQty.delete(cardId);
  await reload();
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
    finishMultipliers = cardsRes.finishMultipliers || {};
    qualityMultipliers = cardsRes.qualityMultipliers || {};
    ownedMap = new Map((collectionRes.owned || []).map((o) => [o.cardId, o]));
    // Craft/decraft/autel accordent de l'XP (niveaux de profil) : rafraichit
    // le badge de niveau dans le header, et deverrouille immediatement un
    // onglet si ce craft/decraft vient de faire passer un palier de niveau.
    loadHeaderBoosterBadge();
    if (status.xp) knownProfileLevel = status.xp.level;
    applyFeatureLocks();

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

document.addEventListener("DOMContentLoaded", async () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("craft-zone").style.display = "block";
  await fetchMyLevel();
  applyFeatureLocks();
  setActiveTab(getInitialTab());
  reload();

  document.getElementById("tab-disenchant-btn").addEventListener("click", () => setActiveTab("disenchant"));
  document.getElementById("tab-craft-btn").addEventListener("click", () => setActiveTab("craft"));
  document.getElementById("tab-altar-btn").addEventListener("click", () => setActiveTab("altar"));
  document.getElementById("tab-finish-btn").addEventListener("click", () => setActiveTab("finish"));
  document.getElementById("tab-quality-btn").addEventListener("click", () => setActiveTab("quality"));

  document.getElementById("craft-bulk-select-toggle").addEventListener("click", (e) => {
    craftBulkSelectMode = !craftBulkSelectMode;
    craftBulkSelected.clear();
    e.target.classList.toggle("active", craftBulkSelectMode);
    document.getElementById("select-all-craft-btn").style.display = craftBulkSelectMode ? "" : "none";
    updateBulkCraftBar();
    renderCraftGrid();
  });
  document.getElementById("bulk-craft-btn").addEventListener("click", bulkCraft);
  // Coche chaque case visible plutot que de recalculer la liste filtree :
  // reutilise le listener "change" deja pose par renderCraftGrid (met a
  // jour craftBulkSelected + la barre de resume), respecte donc deja
  // automatiquement la recherche/le filtre en cours.
  document.getElementById("select-all-craft-btn").addEventListener("click", () => {
    document.querySelectorAll("#craft-grid [data-craft-bulk-id]:not(:disabled)").forEach((cb) => {
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change")); }
    });
  });

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
    document.getElementById("select-all-disenchant-btn").style.display = bulkSelectMode ? "" : "none";
    updateBulkBar();
    renderDisenchantGrid();
  });
  document.getElementById("bulk-disenchant-btn").addEventListener("click", bulkDisenchant);
  document.getElementById("select-all-disenchant-btn").addEventListener("click", () => {
    document.querySelectorAll("#disenchant-grid [data-bulk-id]").forEach((cb) => {
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change")); }
    });
  });
});
