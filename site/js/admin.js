// Page admin : creation/gestion des codes d'événement.
// Protection reelle cote n8n (admin-codes.json verifie Session.discordId
// contre une liste codee en dur) ; cote site on se contente de cacher le
// formulaire si l'appel renvoie "forbidden".

const STATUS_LABELS = {
  active: "Actif",
  expired: "Expire",
  exhausted: "Épuisé",
  disabled: "Désactivé"
};

let cardsCatalog = [];
let codesCache = [];
let calendarView = false;

function formatExpiry(epochSeconds) {
  if (!epochSeconds) return "-";
  return new Date(epochSeconds * 1000).toLocaleString("fr-FR");
}

function renderCodesTable(codes) {
  const tbody = document.getElementById("codes-tbody");
  if (!codes.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Aucun code créé pour l'instant.</td></tr>`;
    return;
  }
  tbody.innerHTML = codes.map((c) => {
    const reward = c.rewardType === "card"
      ? `Carte #${c.cardId} x${c.quantity}`
      : `${c.quantity} booster${c.quantity > 1 ? "s" : ""} (générique)`;
    const used = c.maxRedemptions ? `${c.used} / ${c.maxRedemptions}` : `${c.used} / illimite`;
    const canRevoke = c.active;
    return `
      <tr data-status="${c.status}">
        <td><code>${c.code}</code>${c.label ? `<div class="table-sub">${c.label}</div>` : ""}</td>
        <td>${c.label || "-"}</td>
        <td>${reward}</td>
        <td>${used}</td>
        <td>${formatExpiry(c.expiresAt)}</td>
        <td><span class="trade-status">${STATUS_LABELS[c.status] || c.status}</span></td>
        <td>${canRevoke ? `<button class="btn-ghost revoke-btn" data-code="${c.code}">Revoquer</button>` : ""}</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".revoke-btn").forEach((btn) => {
    btn.addEventListener("click", () => revokeCode(btn.dataset.code));
  });
}

function renderCodesCalendar(codes) {
  const el = document.getElementById("codes-calendar");
  if (!el) return;
  if (!codes.length) {
    el.innerHTML = `<div class="empty-state">Aucun code créé pour l'instant.</div>`;
    return;
  }
  const byDay = new Map();
  codes.forEach((c) => {
    const day = c.expiresAt ? new Date(c.expiresAt * 1000).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "Sans expiration";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(c);
  });
  el.innerHTML = [...byDay.entries()].map(([day, dayCodes]) => `
    <div class="codes-calendar-day">
      <div class="day-label">${day}</div>
      <div class="day-codes">
        ${dayCodes.map((c) => `
          <div class="day-code-row">
            <span><code>${c.code}</code> ${c.label ? "&middot; " + c.label : ""}</span>
            <span class="trade-status">${STATUS_LABELS[c.status] || c.status}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");
}

function renderCodes() {
  renderCodesTable(codesCache);
  renderCodesCalendar(codesCache);
  document.getElementById("codes-table").style.display = calendarView ? "none" : "table";
  document.getElementById("codes-calendar").style.display = calendarView ? "flex" : "none";
}

async function loadCodes() {
  const loading = document.getElementById("codes-loading");
  if (loading) loading.style.display = "flex";
  try {
    const res = await API.adminListCodes(Session.discordId);
    codesCache = res.codes || [];
    renderCodes();
  } finally {
    if (loading) loading.style.display = "none";
  }
}

async function revokeCode(code) {
  const ok = await Confirm.show(`Le code <strong>${code}</strong> ne pourra plus être réclamé par personne.`, {
    title: "Révoquer ce code ?",
    confirmText: "Révoquer",
    dangerous: true
  });
  if (!ok) return;
  try {
    await API.adminRevokeCode(Session.discordId, code);
    Toast.info(`Code ${code} révoqué.`);
    loadCodes();
  } catch (e) {
    Toast.error("Impossible de révoquer ce code. (" + e.message + ")");
  }
}

function updateCardFieldVisibility() {
  const isCard = document.getElementById("reward-type-select").value === "card";
  document.getElementById("card-select-label").style.display = isCard ? "block" : "none";
  if (isCard) updateCardPreview();
}

function updateCardPreview() {
  const preview = document.getElementById("card-select-preview");
  const select = document.getElementById("card-select");
  if (!preview || !select) return;
  const card = cardsCatalog.find((c) => String(c.cardId) === select.value);
  const src = card && API.imageUrl(card.imageId);
  preview.src = src || PLACEHOLDER_IMG;
  preview.style.display = "block";
}

async function loadCardOptions() {
  const res = await API.getCards();
  cardsCatalog = res.cards || [];
  document.getElementById("card-select").innerHTML = cardsCatalog
    .map((c) => `<option value="${c.cardId}">${c.name}${c.isPromo ? " (promo)" : ""}</option>`)
    .join("");
}

// Genere un QR code pointant vers redeem.html avec le code pre-rempli
// (scan -> arrivee directe sur la page de reclamation).
function renderCodeQr(code) {
  const zone = document.getElementById("created-zone");
  if (typeof QRCode === "undefined" || !zone) return;
  const url = window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "redeem.html?code=" + encodeURIComponent(code);
  const box = document.createElement("div");
  box.className = "qr-box";
  const canvas = document.createElement("canvas");
  box.appendChild(canvas);
  const caption = document.createElement("span");
  caption.className = "qr-caption";
  caption.textContent = code;
  box.appendChild(caption);
  zone.appendChild(box);
  QRCode.toCanvas(canvas, url, { width: 160, margin: 1 }, (err) => {
    if (err) box.remove();
  });
}

function renderRarityChart(rarities) {
  const el = document.getElementById("rarity-chart");
  if (!el) return;
  if (!rarities || !rarities.length) {
    el.innerHTML = `<div class="empty-state">Pas encore de tirage.</div>`;
    return;
  }
  const max = Math.max(1, ...rarities.map((r) => r.count));
  el.innerHTML = rarities.map((r) => `
    <div class="bar-col">
      <span class="bar-value">${r.count}</span>
      <div class="bar-fill" style="height:${(r.count / max) * 100}%;background:${r.colorHex || "#9aa0b4"};"></div>
      <span class="bar-label" style="color:${r.colorHex || "#9aa0b4"};">${r.name}</span>
    </div>
  `).join("");
}

function renderRetentionStats(retention) {
  const el = document.getElementById("retention-stats");
  if (!el) return;
  if (!retention) { el.innerHTML = `<div class="empty-state">Pas encore de données.</div>`; return; }
  el.innerHTML = `
    <div class="stat-tile"><div class="stat-value">${retention.totalUsers}</div><div class="stat-label">Comptes créés</div></div>
    <div class="stat-tile"><div class="stat-value">${retention.active7}</div><div class="stat-label">Actifs sur 7 jours</div></div>
    <div class="stat-tile"><div class="stat-value">${retention.active30}</div><div class="stat-label">Actifs sur 30 jours</div></div>
  `;
}

async function loadStats() {
  try {
    const res = await API.adminGetStats(Session.discordId);
    renderRarityChart(res.rarities || []);
    renderRetentionStats(res.retention);
  } catch (e) {
    // Non bloquant : le graphique est secondaire par rapport a la gestion des codes.
  }
}

// Aperçu de la banniere de recompense telle qu'elle apparaitra une fois le
// code créé, mise a jour en direct pendant la saisie du formulaire.
function updateRewardPreview() {
  const preview = document.getElementById("reward-preview");
  if (!preview) return;
  const rewardType = document.getElementById("reward-type-select").value;
  const quantity = Number(document.getElementById("quantity-input").value) || 1;
  let text;
  if (rewardType === "card") {
    const card = cardsCatalog.find((c) => String(c.cardId) === document.getElementById("card-select").value);
    text = `+${quantity} exemplaire${quantity > 1 ? "s" : ""} de ${card ? card.name : "..."}`;
  } else {
    text = `+${quantity} booster${quantity > 1 ? "s" : ""}`;
  }
  preview.style.display = "block";
  preview.textContent = `Aperçu : ${text}`;
}

// --- Équilibrage du jeu (pity, raretés, finitions, quêtes, fouille) ---
let balanceRaritiesCache = [];
let balanceFinishesCache = [];
let balanceQualitiesCache = [];

async function loadConfig() {
  const res = await API.adminGetConfig(Session.discordId);
  const raritySelect = document.getElementById("top-rarity-select");
  raritySelect.innerHTML = (res.rarities || [])
    .map((r) => `<option value="${r.key}" ${res.topRarity && res.topRarity.key === r.key ? "selected" : ""}>${r.name}</option>`)
    .join("");
  document.getElementById("pity-threshold-input").value = res.pityThreshold || "";
  document.getElementById("dig-max-energy-input").value = res.digMaxEnergy || 5;
  document.getElementById("dig-regen-seconds-input").value = res.digRegenSeconds || 60;
  document.getElementById("daily-threshold-input").value = res.dailyQuestThreshold || 2;
  document.getElementById("daily-reward-input").value = res.dailyQuestRewardBoosters != null ? res.dailyQuestRewardBoosters : 2;
  document.getElementById("weekly-threshold-input").value = res.weeklyQuestThreshold || 3;
  document.getElementById("weekly-reward-input").value = res.weeklyQuestRewardBoosters != null ? res.weeklyQuestRewardBoosters : 5;
  document.getElementById("weekly-target-input").value = res.weeklyQuestTarget || 5;
  document.getElementById("quality-repair-cost-input").value = res.qualityRepairCost || 3;
  document.getElementById("banner-enabled-input").checked = !!res.bannerEnabled;
  document.getElementById("banner-type-select").value = res.bannerType || "info";
  document.getElementById("banner-message-input").value = res.bannerMessage || "";

  balanceRaritiesCache = res.rarities || [];
  balanceFinishesCache = res.finishes || [];
  balanceQualitiesCache = res.qualities || [];
  renderBalanceRarities();
  renderBalanceFinishes();
  renderBalanceQualities();
}

function renderBalanceRarities() {
  const el = document.getElementById("balance-rarities-table");
  el.innerHTML = `
    <div class="balance-row balance-head">
      <span>Rareté</span><span>Poids de tirage</span><span>Décraft (poussières)</span><span>Craft (poussières)</span><span></span>
    </div>
  ` + balanceRaritiesCache.map((r) => `
    <div class="balance-row" data-rarity-id="${r.id}">
      <span class="balance-row-label">${r.name}</span>
      <input type="number" min="0" step="0.1" data-field="weight" value="${r.weight}" />
      <input type="number" min="0" data-field="disenchantValue" value="${r.disenchantValue}" />
      <input type="number" min="0" data-field="craftCost" value="${r.craftCost}" />
      <button type="button" class="btn-ghost balance-save-btn" data-id="${r.id}">Enregistrer</button>
    </div>
  `).join("");
}

function renderBalanceFinishes() {
  const el = document.getElementById("balance-finishes-table");
  el.innerHTML = `
    <div class="balance-row balance-head">
      <span>Finition</span><span>Poids (parmi les spéciales)</span><span>Multiplicateur décraft</span><span></span>
    </div>
  ` + balanceFinishesCache.filter((f) => f.key !== "normal").map((f) => `
    <div class="balance-row" data-finish-id="${f.id}">
      <span class="balance-row-label">${f.name}</span>
      <input type="number" min="0" step="0.1" data-field="dropWeight" value="${f.dropWeight}" />
      <input type="number" min="0" step="0.1" data-field="disenchantMultiplier" value="${f.disenchantMultiplier}" />
      <button type="button" class="btn-ghost balance-save-btn" data-id="${f.id}">Enregistrer</button>
    </div>
  `).join("");
}

function renderBalanceQualities() {
  const el = document.getElementById("balance-qualities-table");
  el.innerHTML = `
    <div class="balance-row balance-head">
      <span>Qualité</span><span>Poids de tirage</span><span>Multiplicateur décraft</span><span></span>
    </div>
  ` + balanceQualitiesCache.map((q) => `
    <div class="balance-row" data-quality-id="${q.id}">
      <span class="balance-row-label">${q.name}</span>
      <input type="number" min="0" step="0.1" data-field="dropWeight" value="${q.dropWeight}" />
      <input type="number" min="0" step="0.1" data-field="disenchantMultiplier" value="${q.disenchantMultiplier}" />
      <button type="button" class="btn-ghost balance-save-btn" data-id="${q.id}">Enregistrer</button>
    </div>
  `).join("");
}

// --- Gestion des extensions ---
async function loadExtensionsAdmin() {
  const res = await API.getExtensions();
  const extensions = (res.extensions || []).sort((a, b) => a.sortOrder - b.sortOrder);
  const el = document.getElementById("extensions-list");
  if (!extensions.length) {
    el.innerHTML = `<div class="empty-state">Aucune extension pour l'instant.</div>`;
    return;
  }
  el.innerHTML = extensions.map((ext) => `
    <div class="codes-calendar-day">
      <div class="day-label">${ext.name} <span style="color:var(--text-dim);font-weight:500;">(${ext.key})</span></div>
      <div class="day-codes">
        <div class="day-code-row">
          <span>Ordre : ${ext.sortOrder}</span>
          <button type="button" class="btn-ghost ext-toggle-btn" data-ext-id="${ext.id}" data-active="${ext.active}">
            ${ext.active ? "Désactiver" : "Activer"}
          </button>
        </div>
      </div>
    </div>
  `).join("");
  el.querySelectorAll(".ext-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const extensionId = Number(btn.dataset.extId);
      const nextActive = btn.dataset.active !== "true";
      try {
        await API.adminUpdateExtension(Session.discordId, { extensionId, active: nextActive });
        Toast.success(nextActive ? "Extension activee." : "Extension désactivée.");
        API._cacheSet("2gatcha_cache_extensions", null);
        loadExtensionsAdmin();
      } catch (e) {
        Toast.error("Impossible de modifier l'extension. (" + e.message + ")");
      }
    });
  });
}

// -----------------------------------------------------------------------
// Boss communautaire
// -----------------------------------------------------------------------
async function loadBossAdmin() {
  const el = document.getElementById("boss-admin-current");
  try {
    const res = await API.getBossStatus(Session.userId);
    el.innerHTML = res.active
      ? `<strong>${res.bossName}</strong> — ${res.currentHp} / ${res.maxHp} PV (récompense : ${res.rewardBoosters} boosters)`
      : `Aucun boss actif pour l'instant.`;
  } catch (e) {
    el.textContent = "Impossible de charger l'état du boss.";
  }
}

// -----------------------------------------------------------------------
// Marché noir
// -----------------------------------------------------------------------
function populateMarketCardSelect() {
  const select = document.getElementById("market-card-select");
  select.innerHTML = cardsCatalog
    .map((c) => `<option value="${c.cardId}">${c.name}${c.isPromo ? " (promo)" : ""}</option>`)
    .join("");
}

function updateMarketCardPreview() {
  const preview = document.getElementById("market-card-preview");
  const select = document.getElementById("market-card-select");
  const card = cardsCatalog.find((c) => String(c.cardId) === select.value);
  preview.src = (card && API.imageUrl(card.imageId)) || PLACEHOLDER_IMG;
  preview.style.display = "block";
}

async function loadMarketAdmin() {
  const el = document.getElementById("market-admin-list");
  try {
    const res = await API.listBlackMarket(Session.userId);
    const offers = res.offers || [];
    el.innerHTML = offers.length ? offers.map((o) => `
      <div class="codes-calendar-day">
        <div class="day-label">${o.card.name}</div>
        <div class="day-codes">
          <div class="day-code-row">
            <span>${o.cost} poussières · ${o.remaining != null ? `${o.remaining} restant(s)` : "illimité"}</span>
          </div>
        </div>
      </div>
    `).join("") : `<div class="empty-state">Aucune offre active pour l'instant.</div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Impossible de charger les offres.</div>`;
  }
}

// -----------------------------------------------------------------------
// Bingo
// -----------------------------------------------------------------------
function populateBingoCardSelects() {
  const container = document.getElementById("bingo-card-selects");
  const options = cardsCatalog.map((c) => `<option value="${c.cardId}">${c.name}</option>`).join("");
  container.innerHTML = Array.from({ length: 9 }, (_, i) => `
    <label>
      Case ${i + 1}
      <select class="bingo-cell-select" data-index="${i}">${options}</select>
    </label>
  `).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }

  try {
    await loadCardOptions();
    await loadCodes();
    loadStats();
    loadConfig();
    loadExtensionsAdmin();
    loadBossAdmin();
    populateMarketCardSelect();
    updateMarketCardPreview();
    loadMarketAdmin();
    populateBingoCardSelects();
    document.getElementById("admin-zone").style.display = "block";
  } catch (e) {
    if (e.code === "forbidden") {
      document.getElementById("denied-warning").style.display = "block";
    } else {
      Toast.error("Erreur lors du chargement de la page admin. (" + e.message + ")");
    }
    return;
  }

  document.getElementById("config-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await API.adminSetConfig(Session.discordId, {
        pityThreshold: Number(document.getElementById("pity-threshold-input").value) || undefined,
        topRarityKey: document.getElementById("top-rarity-select").value,
        digMaxEnergy: Number(document.getElementById("dig-max-energy-input").value) || undefined,
        digRegenSeconds: Number(document.getElementById("dig-regen-seconds-input").value) || undefined,
        dailyQuestThreshold: Number(document.getElementById("daily-threshold-input").value) || undefined,
        dailyQuestRewardBoosters: document.getElementById("daily-reward-input").value,
        weeklyQuestThreshold: Number(document.getElementById("weekly-threshold-input").value) || undefined,
        weeklyQuestRewardBoosters: document.getElementById("weekly-reward-input").value,
        weeklyQuestTarget: Number(document.getElementById("weekly-target-input").value) || undefined,
        qualityRepairCost: Number(document.getElementById("quality-repair-cost-input").value) || undefined
      });
      Toast.success("Paramètres enregistrés.");
    } catch (e) {
      Toast.error("Impossible d'enregistrer. (" + e.message + ")");
    }
  });

  document.getElementById("banner-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await API.adminSetConfig(Session.discordId, {
        bannerEnabled: document.getElementById("banner-enabled-input").checked,
        bannerType: document.getElementById("banner-type-select").value,
        bannerMessage: document.getElementById("banner-message-input").value.trim()
      });
      Toast.success("Bandeau enregistré.");
    } catch (err) {
      Toast.error("Impossible d'enregistrer le bandeau. (" + err.message + ")");
    }
  });

  const resetScopeUser = document.getElementById("reset-scope-user");
  const resetTargetPseudo = document.getElementById("reset-target-pseudo");
  document.querySelectorAll('input[name="reset-scope"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      resetTargetPseudo.style.display = resetScopeUser.checked ? "block" : "none";
    });
  });

  document.getElementById("balance-rarities-table").addEventListener("click", async (e) => {
    const btn = e.target.closest(".balance-save-btn");
    if (!btn) return;
    const row = btn.closest(".balance-row");
    const rarityId = Number(btn.dataset.id);
    btn.disabled = true;
    try {
      await API.adminUpdateRarity(Session.discordId, rarityId, {
        weight: row.querySelector('[data-field="weight"]').value,
        disenchantValue: row.querySelector('[data-field="disenchantValue"]').value,
        craftCost: row.querySelector('[data-field="craftCost"]').value
      });
      Toast.success("Rareté mise à jour.");
    } catch (err) {
      Toast.error("Impossible d'enregistrer. (" + err.message + ")");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("balance-finishes-table").addEventListener("click", async (e) => {
    const btn = e.target.closest(".balance-save-btn");
    if (!btn) return;
    const row = btn.closest(".balance-row");
    const finishId = Number(btn.dataset.id);
    btn.disabled = true;
    try {
      await API.adminUpdateFinish(Session.discordId, finishId, {
        dropWeight: row.querySelector('[data-field="dropWeight"]').value,
        disenchantMultiplier: row.querySelector('[data-field="disenchantMultiplier"]').value
      });
      Toast.success("Finition mise à jour.");
    } catch (err) {
      Toast.error("Impossible d'enregistrer. (" + err.message + ")");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("balance-qualities-table").addEventListener("click", async (e) => {
    const btn = e.target.closest(".balance-save-btn");
    if (!btn) return;
    const row = btn.closest(".balance-row");
    const qualityId = Number(btn.dataset.id);
    btn.disabled = true;
    try {
      await API.adminUpdateQuality(Session.discordId, qualityId, {
        dropWeight: row.querySelector('[data-field="dropWeight"]').value,
        disenchantMultiplier: row.querySelector('[data-field="disenchantMultiplier"]').value
      });
      Toast.success("Qualité mise à jour.");
    } catch (err) {
      Toast.error("Impossible d'enregistrer. (" + err.message + ")");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("create-extension-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await API.adminCreateExtension(Session.discordId, {
        name: document.getElementById("ext-name-input").value.trim(),
        key: document.getElementById("ext-key-input").value.trim(),
        sortOrder: Number(document.getElementById("ext-sort-input").value) || 0,
        active: true
      });
      Toast.success("Extension créée ! Ajoute son visuel dans Grist pour la rendre jolie.");
      document.getElementById("create-extension-form").reset();
      API._cacheSet("2gatcha_cache_extensions", null);
      loadExtensionsAdmin();
    } catch (e) {
      Toast.error("Impossible de créer l'extension. (" + e.message + ")");
    }
  });

  document.getElementById("reward-type-select").addEventListener("change", () => { updateCardFieldVisibility(); updateRewardPreview(); });
  document.getElementById("card-select").addEventListener("change", () => { updateCardPreview(); updateRewardPreview(); });
  document.getElementById("quantity-input").addEventListener("input", updateRewardPreview);
  updateCardFieldVisibility();
  updateRewardPreview();

  document.getElementById("view-table-btn").addEventListener("click", (e) => {
    calendarView = false;
    e.target.classList.add("active");
    document.getElementById("view-calendar-btn").classList.remove("active");
    renderCodes();
  });
  document.getElementById("view-calendar-btn").addEventListener("click", (e) => {
    calendarView = true;
    e.target.classList.add("active");
    document.getElementById("view-table-btn").classList.remove("active");
    renderCodes();
  });

  document.getElementById("create-code-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    document.getElementById("created-zone").innerHTML = "";

    const rewardType = document.getElementById("reward-type-select").value;
    const params = {
      code: document.getElementById("code-input").value.trim() || undefined,
      label: document.getElementById("label-input").value.trim(),
      rewardType,
      quantity: Number(document.getElementById("quantity-input").value) || 1,
      cardId: rewardType === "card" ? Number(document.getElementById("card-select").value) : undefined,
      expiresInHours: Number(document.getElementById("expires-input").value) || 4,
      maxRedemptions: Number(document.getElementById("max-redemptions-input").value) || 0,
      notifyDiscord: document.getElementById("notify-discord-checkbox").checked
    };

    try {
      const created = await API.adminCreateCode(Session.discordId, params);
      document.getElementById("created-zone").innerHTML =
        `<div class="reward-banner">Code créé : <code>${created.code}</code></div>`;
      renderCodeQr(created.code);
      document.getElementById("create-code-form").reset();
      updateCardFieldVisibility();
      updateRewardPreview();
      Toast.success(`Code ${created.code} créé !`);
      loadCodes();
    } catch (err) {
      Toast.error("Impossible de créer le code. (" + err.message + ")");
    }
  });

  document.getElementById("market-card-select").addEventListener("change", updateMarketCardPreview);

  document.getElementById("create-boss-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await API.adminCreateBoss(Session.discordId, {
        bossName: document.getElementById("boss-name-input").value.trim(),
        maxHp: Number(document.getElementById("boss-maxhp-input").value) || 0,
        rewardBoosters: Number(document.getElementById("boss-reward-input").value) || 0
      });
      Toast.success("Boss lancé !");
      document.getElementById("create-boss-form").reset();
      loadBossAdmin();
    } catch (err) {
      Toast.error("Impossible de lancer le boss. (" + err.message + ")");
    }
  });

  document.getElementById("create-market-offer-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await API.adminCreateMarketOffer(Session.discordId, {
        cardId: Number(document.getElementById("market-card-select").value),
        cost: Number(document.getElementById("market-cost-input").value) || 0,
        expiresInHours: Number(document.getElementById("market-expires-input").value) || 24,
        maxPurchases: Number(document.getElementById("market-max-purchases-input").value) || 0
      });
      Toast.success("Offre créée !");
      loadMarketAdmin();
    } catch (err) {
      Toast.error("Impossible de créer l'offre. (" + err.message + ")");
    }
  });

  document.getElementById("create-bingo-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cardIds = [...document.querySelectorAll(".bingo-cell-select")].map((s) => Number(s.value));
    if (new Set(cardIds).size !== 9) {
      Toast.error("Choisis 9 cartes différentes.");
      return;
    }
    try {
      await API.adminSetBingoGrid(Session.discordId, {
        month: document.getElementById("bingo-month-input").value.trim() || undefined,
        cardIds,
        rewardBoosters: Number(document.getElementById("bingo-reward-input").value) || 0
      });
      Toast.success("Grille de bingo enregistrée !");
    } catch (err) {
      Toast.error("Impossible d'enregistrer la grille. (" + err.message + ")");
    }
  });

  document.getElementById("reset-v1-btn").addEventListener("click", resetV1);
});

// Reinitialisation de fin de beta (ou d'un seul joueur) : double
// confirmation deliberement lourde (dialogue + saisie exacte du mot-cle)
// pour une action irreversible et potentiellement a gros rayon d'action -
// un simple clic ne doit jamais suffire a la declencher.
async function resetV1() {
  const isUserScoped = document.getElementById("reset-scope-user").checked;
  const targetPseudo = document.getElementById("reset-target-pseudo").value.trim();
  if (isUserScoped && !targetPseudo) {
    Toast.error("Indique le pseudo du joueur à réinitialiser.");
    return;
  }

  const ok = await Confirm.show(
    isUserScoped
      ? `Ceci va <strong>supprimer definitivement</strong> les tirages, échanges, quêtes et redemptions ` +
        `de <strong>${targetPseudo}</strong> uniquement, et remettre a zero son solde de boosters/poussières ` +
        `et son compteur de pity. Les autres joueurs ne sont pas affectés.<br><br>Cette action est irréversible.`
      : "Ceci va <strong>supprimer definitivement</strong> les tirages, échanges, " +
        "quêtes et redemptions de codes de <strong>TOUS les joueurs</strong>, et remettre a zero le solde de " +
        "boosters/poussières et le compteur de pity de chacun. Les comptes Discord et le catalogue de cartes restent intacts.<br><br>" +
        "Cette action est irréversible.",
    { title: isUserScoped ? `Réinitialiser ${targetPseudo} ?` : "Réinitialiser pour la V1 ?", confirmText: "Continuer", dangerous: true }
  );
  if (!ok) return;

  const typed = window.prompt('Tape exactement RESET-V1 pour confirmer definitivement :');
  if (typed !== "RESET-V1") {
    if (typed !== null) Toast.error("Confirmation incorrecte, réinitialisation annulée.");
    return;
  }

  const btn = document.getElementById("reset-v1-btn");
  btn.disabled = true;
  btn.textContent = "Réinitialisation en cours...";
  try {
    const res = await API.adminResetV1(Session.discordId, typed, isUserScoped ? targetPseudo : undefined);
    const c = res.counts || {};
    Toast.success(
      `Réinitialisé${res.scope === "user" ? " (" + res.targetPseudo + ")" : ""} : ${c.pulls || 0} tirages, ${c.trades || 0} échanges, ` +
      `${c.quests || 0} quêtes du jour, ${c.weeklyQuests || 0} quêtes de la semaine, ` +
      `${c.redemptions || 0} redemptions, ${c.boosterInventory || 0} compteurs de pity, ` +
      `${c.users || 0} compte(s) remis a zéro.`
    );
  } catch (e) {
    Toast.error(e.code === "user_not_found" ? "Pseudo introuvable." : "Échec de la réinitialisation. (" + e.message + ")");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "&#128465;&#65039; Réinitialiser";
  }
}
