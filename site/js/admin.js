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
let extensionsCatalog = [];

function formatExpiry(epochSeconds) {
  if (!epochSeconds) return "-";
  return new Date(epochSeconds * 1000).toLocaleString("fr-FR");
}

function extensionName(extensionId) {
  const ext = extensionsCatalog.find((e) => e.id === extensionId);
  return ext ? ext.name : null;
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
      : `${c.quantity} booster${c.quantity > 1 ? "s" : ""} (${extensionName(c.extensionId) || "extension ?"})`;
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

async function loadCodes() {
  const loading = document.getElementById("codes-loading");
  if (loading) loading.style.display = "flex";
  try {
    const res = await API.adminListCodes(Session.discordId);
    renderCodesTable(res.codes || []);
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
  document.getElementById("extension-select-label").style.display = isCard ? "none" : "block";
}

async function loadCardOptions() {
  const res = await API.getCards();
  cardsCatalog = res.cards || [];
  document.getElementById("card-select").innerHTML = cardsCatalog
    .map((c) => `<option value="${c.cardId}">${c.name}${c.isPromo ? " (promo)" : ""}</option>`)
    .join("");
}

async function loadExtensionOptions() {
  const res = await API.getExtensions();
  extensionsCatalog = res.extensions || [];
  document.getElementById("extension-select").innerHTML = extensionsCatalog
    .map((e) => `<option value="${e.id}">${e.name}</option>`)
    .join("") || `<option value="">Aucune extension</option>`;
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

document.addEventListener("DOMContentLoaded", async () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }

  try {
    await loadExtensionOptions();
    await loadCardOptions();
    await loadCodes();
    loadStats();
    document.getElementById("admin-zone").style.display = "block";
  } catch (e) {
    if (e.code === "forbidden") {
      document.getElementById("denied-warning").style.display = "block";
    } else {
      Toast.error("Erreur lors du chargement de la page admin. (" + e.message + ")");
    }
    return;
  }

  document.getElementById("reward-type-select").addEventListener("change", updateCardFieldVisibility);
  updateCardFieldVisibility();

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
      extension: rewardType === "booster" ? Number(document.getElementById("extension-select").value) : undefined,
      expiresInHours: Number(document.getElementById("expires-input").value) || 4,
      maxRedemptions: Number(document.getElementById("max-redemptions-input").value) || 0
    };

    try {
      const created = await API.adminCreateCode(Session.discordId, params);
      document.getElementById("created-zone").innerHTML =
        `<div class="reward-banner">Code cree : <code>${created.code}</code></div>`;
      document.getElementById("create-code-form").reset();
      updateCardFieldVisibility();
      Toast.success(`Code ${created.code} cree !`);
      loadCodes();
    } catch (err) {
      Toast.error("Impossible de creer le code. (" + err.message + ")");
    }
  });
});
