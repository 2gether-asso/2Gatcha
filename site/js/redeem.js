// Logique de la page de reclamation de code d'evenement.
// Contrat attendu du webhook n8n "redeem-code" (POST { userId, code }):
// { "type": "booster", "quantity": 3, "newBoosterCount": 5 }
// ou
// { "type": "card", "cards": [ { cardId, name, artist, description, imageId,
//                                 rarity: { id, name, key, colorHex } } ] }

const ERROR_MESSAGES = {
  invalid_code: "Ce code n'existe pas.",
  code_inactive: "Ce code a ete desactive.",
  code_expired: "Ce code a expire.",
  already_redeemed: "Tu as deja reclame ce code.",
  code_exhausted: "Ce code a atteint son nombre maximum d'utilisations.",
  unknown_user: "Utilisateur introuvable, reconnecte-toi.",
  code_misconfigured: "Ce code est mal configure, previens un admin."
};

function showError(msg) {
  document.getElementById("error-zone").innerHTML = `<div class="error-box">${msg}</div>`;
}

function clearError() {
  document.getElementById("error-zone").innerHTML = "";
}

function buildCardEl(card, index) {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.dataset.rarity = card.rarity?.key || "commune";
  wrap.style.animationDelay = `${index * 90}ms`;

  const color = card.rarity?.colorHex || "#9aa0b4";
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;

  wrap.innerHTML = `
    <div class="card-inner">
      <div class="card-face card-back">?</div>
      <div class="card-face card-front">
        <img src="${imgSrc}" alt="${card.name}" />
        <div class="card-info">
          <div class="card-name">${card.name}</div>
          <div class="card-artist">${card.artist || ""}</div>
          <span class="rarity-badge" style="background:${color}22;color:${color};border:1px solid ${color};">
            ${card.rarity?.name || "Commune"}
          </span>
        </div>
      </div>
    </div>
  `;
  return wrap;
}

function celebrateRarity(key) {
  if (typeof confetti !== "function") return;
  if (key === "legendaire") {
    confetti({ particleCount: 160, spread: 100, origin: { y: 0.5 }, colors: ["#f5a524", "#ffd166", "#ffffff"] });
  } else if (key === "epique") {
    confetti({ particleCount: 70, spread: 80, origin: { y: 0.5 }, colors: ["#a855f7", "#d8b4fe"] });
  }
}

async function redeem() {
  const input = document.getElementById("code-input");
  const btn = document.getElementById("redeem-btn");
  const code = input.value.trim();
  if (!code) return;

  clearError();
  document.getElementById("reward-zone").innerHTML = "";
  document.getElementById("reveal-grid").innerHTML = "";
  btn.disabled = true;

  try {
    const res = await API.redeemCode(Session.userId, code);

    if (res.type === "booster") {
      document.getElementById("reward-zone").innerHTML =
        `<div class="reward-banner">+${res.quantity} booster${res.quantity > 1 ? "s" : ""} ! Tu en as maintenant ${res.newBoosterCount}.</div>`;
      confetti && confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
    } else if (res.type === "card") {
      document.getElementById("reward-zone").innerHTML = `<div class="reward-banner">Carte reçue !</div>`;
      const grid = document.getElementById("reveal-grid");
      res.cards.forEach((card, i) => {
        const el = buildCardEl(card, i);
        grid.appendChild(el);
        setTimeout(() => {
          el.classList.add("revealed");
          celebrateRarity(card.rarity?.key);
        }, 300 + i * 220);
      });
    }

    input.value = "";
    loadHeaderBoosterBadge();
  } catch (e) {
    showError(ERROR_MESSAGES[e.code] || ("Erreur lors de la reclamation. (" + e.message + ")"));
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("redeem-zone").style.display = "block";
  document.getElementById("redeem-btn").addEventListener("click", redeem);
  document.getElementById("code-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") redeem();
  });
});
