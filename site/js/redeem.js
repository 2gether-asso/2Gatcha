// Logique de la page de reclamation de code d'événement.
// Contrat attendu du webhook n8n "redeem-code" (POST { userId, code }):
// { "type": "booster", "quantity": 3, "newBoosterCount": 5 }
// ou
// { "type": "card", "cards": [ { cardId, name, artist, description, imageId,
//                                 rarity: { id, name, key, colorHex } } ] }

const ERROR_MESSAGES = {
  invalid_code: "Ce code n'existe pas.",
  code_inactive: "Ce code a ete désactivé.",
  code_expired: "Ce code a expire.",
  already_redeemed: "Tu as deja réclame ce code.",
  code_exhausted: "Ce code a atteint son nombre maximum d'utilisations.",
  unknown_user: "Utilisateur introuvable, reconnecte-toi.",
  code_misconfigured: "Ce code est mal configure, previens un admin.",
  sold_out: "Tous les exemplaires de cette carte ont déjà été distribués."
};

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
          <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">
            ${card.rarity?.name || "Commune"}
          </span>
        </div>
      </div>
    </div>
  `;
  return wrap;
}

// A partir d'epique (pas seulement legendaire) : le flash plein ecran suit
// desormais la VRAIE couleur de la rarete (hexToRgba, main.js) et son
// intensite grandit avec le palier - jamais fige sur l'orange legendaire.
const RARITY_FLASH_TIERS = {
  epique: { alpha: 0.4, duration: "0.7s", brightness: 1.6, className: "tier-epique" },
  legendaire: { alpha: 0.55, duration: "0.9s", brightness: 2, className: "tier-legendaire" },
  mythique: { alpha: 0.7, duration: "1.2s", brightness: 2.6, className: "tier-mythique" }
};
const RARITY_FLASH_TOASTS = { legendaire: "Légendaire !", mythique: "Mythique !" };
function celebrateRarity(key, cardEl, colorHex) {
  // Particules proportionnelles a la rareté (spawnRarityBurst, main.js),
  // toujours au-dessus de tout (z-index:420).
  spawnRarityBurst(key, colorHex, cardEl);
  const tier = RARITY_FLASH_TIERS[key];
  if (tier) {
    // Pas de transform sur un ancetre des cartes (voir opening.js) : on
    // isole l'effet a un flash plein écran + un filtre sur la carte.
    const flash = document.getElementById("legendary-flash");
    if (flash) {
      flash.style.setProperty("--flash-color", hexToRgba(colorHex, tier.alpha));
      flash.style.setProperty("--flash-duration", tier.duration);
      flash.className = "legendary-flash " + tier.className;
      void flash.offsetWidth;
      flash.classList.add("active");
    }
    if (cardEl) {
      cardEl.style.setProperty("--flash-duration", tier.duration);
      cardEl.style.setProperty("--flash-brightness", tier.brightness);
      cardEl.classList.remove("legendary-hit");
      void cardEl.offsetWidth;
      cardEl.classList.add("legendary-hit");
    }
    if (RARITY_FLASH_TOASTS[key]) Toast.success(RARITY_FLASH_TOASTS[key]);
  }
}

async function refreshBoosterStat() {
  const grid = document.getElementById("redeem-stats-grid");
  if (!grid) return;
  try {
    const status = await API.getBoosterStatus(Session.userId);
    grid.innerHTML = `
      <div class="stat-tile">
        <div class="stat-value">&#127183; ${status.count ?? 0}</div>
        <div class="stat-label">Booster${status.count > 1 ? "s" : ""} en stock</div>
      </div>
    `;
  } catch (e) { /* pas bloquant : le formulaire reste utilisable sans ce chiffre */ }
}

async function redeem() {
  const input = document.getElementById("code-input");
  const btn = document.getElementById("redeem-btn");
  const code = input.value.trim();
  if (!code) return;

  document.getElementById("reward-zone").innerHTML = "";
  document.getElementById("reveal-grid").innerHTML = "";
  btn.disabled = true;

  try {
    const res = await API.redeemCode(Session.userId, code);

    if (res.type === "booster") {
      document.getElementById("reward-zone").innerHTML =
        `<div class="reward-banner">+${res.quantity} booster${res.quantity > 1 ? "s" : ""} ! Tu en as maintenant ${res.newBoosterCount}.</div>`;
      if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
      Toast.success(`+${res.quantity} booster${res.quantity > 1 ? "s" : ""} !`);
      refreshBoosterStat();
    } else if (res.type === "card") {
      document.getElementById("reward-zone").innerHTML = `<div class="reward-banner">Carte reçue !</div>`;
      const grid = document.getElementById("reveal-grid");
      res.cards.forEach((card, i) => {
        const el = buildCardEl(card, i);
        grid.appendChild(el);
        setTimeout(() => {
          el.classList.add("revealed");
          Sfx.flip();
          setTimeout(() => Sfx.reveal(card.rarity?.key), 260);
          celebrateRarity(card.rarity?.key, el, card.rarity?.colorHex);
        }, 300 + i * 220);
      });
    }

    input.value = "";
    loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error(ERROR_MESSAGES[e.code] || ("Erreur lors de la reclamation. (" + e.message + ")"));
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
  document.getElementById("redeem-info-panel").style.display = "block";
  refreshBoosterStat();
  document.getElementById("redeem-btn").addEventListener("click", redeem);
  document.getElementById("code-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") redeem();
  });

  // Prefill depuis un QR code génère par l'admin (redeem.html?code=XXXX).
  const prefill = new URLSearchParams(window.location.search).get("code");
  if (prefill) {
    document.getElementById("code-input").value = prefill.toUpperCase();
  }
});
