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

function showError(msg) {
  document.getElementById("error-zone").innerHTML = `<div class="error-box">${msg}</div>`;
}
function showCreateError(msg) {
  document.getElementById("create-error-zone").innerHTML = `<div class="error-box">${msg}</div>`;
}
function clearCreateError() {
  document.getElementById("create-error-zone").innerHTML = "";
}

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
      : `${c.quantity} booster${c.quantity > 1 ? "s" : ""}`;
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
  const res = await API.adminListCodes(Session.discordId);
  renderCodesTable(res.codes || []);
}

async function revokeCode(code) {
  if (!window.confirm(`Revoquer le code ${code} ?`)) return;
  try {
    await API.adminRevokeCode(Session.discordId, code);
    loadCodes();
  } catch (e) {
    showError("Impossible de revoquer ce code. (" + e.message + ")");
  }
}

function updateCardFieldVisibility() {
  const isCard = document.getElementById("reward-type-select").value === "card";
  document.getElementById("card-select-label").style.display = isCard ? "block" : "none";
}

async function loadCardOptions() {
  const res = await API.getCards();
  cardsCatalog = res.cards || [];
  document.getElementById("card-select").innerHTML = cardsCatalog
    .map((c) => `<option value="${c.cardId}">${c.name}</option>`)
    .join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }

  try {
    await loadCardOptions();
    await loadCodes();
    document.getElementById("admin-zone").style.display = "block";
  } catch (e) {
    if (e.code === "forbidden") {
      document.getElementById("denied-warning").style.display = "block";
    } else {
      showError("Erreur lors du chargement de la page admin. (" + e.message + ")");
    }
    return;
  }

  document.getElementById("reward-type-select").addEventListener("change", updateCardFieldVisibility);
  updateCardFieldVisibility();

  document.getElementById("create-code-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearCreateError();
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
      document.getElementById("create-code-form").reset();
      updateCardFieldVisibility();
      loadCodes();
    } catch (err) {
      showCreateError("Impossible de creer le code. (" + err.message + ")");
    }
  });
});
