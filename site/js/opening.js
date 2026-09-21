// Logique de la page d'ouverture de booster.
// Contrat attendu du webhook n8n "open-pack" (POST { userId }):
// {
//   "cards": [ { cardId, name, artist, description, imageId,
//                rarity: { id, name, key, colorHex } } ],
//   "pity": { pullsSinceTop },
//   "booster": { count }
// }
// ou, si le stock est a 0 :
// { "error": "no_boosters", "count": 0 }

let isBusy = false;
let currentCount = 0;

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
    setTimeout(() => confetti({ particleCount: 100, spread: 140, origin: { y: 0.4 } }), 250);
  } else if (key === "epique") {
    confetti({ particleCount: 70, spread: 80, origin: { y: 0.5 }, colors: ["#a855f7", "#d8b4fe"] });
  }
}

function renderStock(count) {
  currentCount = count;
  const labelEl = document.getElementById("stock-label");
  const hintEl = document.getElementById("booster-hint");
  labelEl.textContent = count > 0
    ? `${count} booster${count > 1 ? "s" : ""} disponible${count > 1 ? "s" : ""}`
    : "Aucun booster disponible";

  const pack = document.getElementById("booster-pack");
  pack.classList.toggle("locked", count < 1);
  hintEl.innerHTML = count > 0
    ? "Clique sur le booster pour l'ouvrir"
    : `Reclame un code d'evenement pour recevoir des boosters (page <a href="redeem.html">Reclamer un code</a>)`;
}

async function refreshStatus() {
  try {
    const status = await API.getBoosterStatus(Session.userId);
    renderStock(status.count);
  } catch (e) {
    showError("Impossible de recuperer ton stock de boosters. (" + e.message + ")");
  }
}

async function openBooster() {
  if (isBusy || currentCount < 1) return;
  isBusy = true;
  clearError();

  const pack = document.getElementById("booster-pack");
  const flash = document.getElementById("burst-flash");
  const grid = document.getElementById("reveal-grid");
  grid.innerHTML = "";

  pack.classList.add("charging");

  try {
    const res = await API.openPack(Session.userId);

    if (res.error === "no_boosters") {
      pack.classList.remove("charging");
      renderStock(res.count || 0);
      loadHeaderBoosterBadge();
      showError("Plus de booster disponible pour l'instant.");
      isBusy = false;
      return;
    }

    await new Promise((r) => setTimeout(r, 500));
    pack.classList.remove("charging");
    pack.classList.add("bursting");
    flash.classList.add("flash-active");

    await new Promise((r) => setTimeout(r, 480));

    const cards = res.cards || [];
    cards.forEach((card, i) => {
      const el = buildCardEl(card, i);
      grid.appendChild(el);
      setTimeout(() => {
        el.classList.add("revealed");
        celebrateRarity(card.rarity?.key);
      }, 550 + i * 220);
    });

    setTimeout(() => {
      flash.classList.remove("flash-active");
      pack.classList.remove("bursting");
      if (res.booster) renderStock(res.booster.count);
      loadHeaderBoosterBadge();
      isBusy = false;
    }, 550 + cards.length * 220 + 300);
  } catch (e) {
    pack.classList.remove("charging", "bursting");
    showError("Erreur lors de l'ouverture du booster. (" + e.message + ")");
    isBusy = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("booster-zone").style.display = "flex";
  document.getElementById("booster-pack").addEventListener("click", openBooster);
  refreshStatus();
});
