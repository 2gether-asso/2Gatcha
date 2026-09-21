// Page admin : creation/gestion des codes d'evenement.
// Protection reelle cote n8n (admin-codes.json verifie Session.discordId
// contre une liste codee en dur) ; cote site on se contente de cacher le
// formulaire si l'appel renvoie "forbidden".

const STATUS_LABELS = {
  active: "Actif",
  expired: "Expire",
  exhausted: "Epuise",
  disabled: "Desactive"
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
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Aucun code cree pour l'instant.</td></tr>`;
    return;
  }
  tbody.innerHTML = codes.map((c) => {
    const reward = c.rewardType === "card"
      ? `Carte #${c.cardId} x${c.quantity}`
      : `${c.quantity} booster${c.quantity > 1 ? "s" : ""} (generique)`;
    const used = c.maxRedemptions ? `${c.used} / ${c.maxRedemptions}` : `${c.used} / illimite`;
    const canRevoke = c.active;
    return `
      <tr>
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
    el.innerHTML = `<div class="empty-state">Aucun code cree pour l'instant.</div>`;
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
  if (!window.confirm(`Revoquer le code ${code} ?`)) return;
  try {
    await API.adminRevokeCode(Session.discordId, code);
    Toast.info(`Code ${code} revoque.`);
    loadCodes();
  } catch (e) {
    Toast.error("Impossible de revoquer ce code. (" + e.message + ")");
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

async function loadStats() {
  try {
    const res = await API.adminGetStats(Session.discordId);
    renderRarityChart(res.rarities || []);
  } catch (e) {
    // Non bloquant : le graphique est secondaire par rapport a la gestion des codes.
  }
}

// --- Parametres du gacha (pity/rarete garantie) ---
async function loadConfig() {
  const res = await API.adminGetConfig(Session.discordId);
  const raritySelect = document.getElementById("top-rarity-select");
  raritySelect.innerHTML = (res.rarities || [])
    .map((r) => `<option value="${r.key}" ${res.topRarity && res.topRarity.key === r.key ? "selected" : ""}>${r.name}</option>`)
    .join("");
  document.getElementById("pity-threshold-input").value = res.pityThreshold || "";
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
            ${ext.active ? "Desactiver" : "Activer"}
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
        Toast.success(nextActive ? "Extension activee." : "Extension desactivee.");
        API._cacheSet("2gatcha_cache_extensions", null);
        loadExtensionsAdmin();
      } catch (e) {
        Toast.error("Impossible de modifier l'extension. (" + e.message + ")");
      }
    });
  });
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
        topRarityKey: document.getElementById("top-rarity-select").value
      });
      Toast.success("Parametres enregistres.");
    } catch (e) {
      Toast.error("Impossible d'enregistrer. (" + e.message + ")");
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
      Toast.success("Extension creee ! Ajoute son visuel dans Grist pour la rendre jolie.");
      document.getElementById("create-extension-form").reset();
      API._cacheSet("2gatcha_cache_extensions", null);
      loadExtensionsAdmin();
    } catch (e) {
      Toast.error("Impossible de creer l'extension. (" + e.message + ")");
    }
  });

  document.getElementById("reward-type-select").addEventListener("change", updateCardFieldVisibility);
  document.getElementById("card-select").addEventListener("change", updateCardPreview);
  updateCardFieldVisibility();

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
      maxRedemptions: Number(document.getElementById("max-redemptions-input").value) || 0
    };

    try {
      const created = await API.adminCreateCode(Session.discordId, params);
      document.getElementById("created-zone").innerHTML =
        `<div class="reward-banner">Code cree : <code>${created.code}</code></div>`;
      renderCodeQr(created.code);
      document.getElementById("create-code-form").reset();
      updateCardFieldVisibility();
      Toast.success(`Code ${created.code} cree !`);
      loadCodes();
    } catch (err) {
      Toast.error("Impossible de creer le code. (" + err.message + ")");
    }
  });
});
