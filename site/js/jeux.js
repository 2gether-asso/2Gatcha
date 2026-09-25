// Logique de la page Jeux : Mini-jeu de fouille + Bingo de collection.

let digTimer = null;

function setActiveTab(tab) {
  ["dig", "bingo"].forEach((key) => {
    document.getElementById(`tab-${key}-btn`).classList.toggle("active", tab === key);
    document.getElementById(`tab-${key}-btn`).setAttribute("aria-selected", String(tab === key));
    document.getElementById(`${key}-pane`).style.display = tab === key ? "block" : "none";
  });
  if (tab === "bingo") loadBingo();
}

function formatDuration(seconds) {
  const m = Math.ceil(seconds / 60);
  return m <= 1 ? "moins d'une minute" : `${m} min`;
}

// -----------------------------------------------------------------------
// Fouille
// -----------------------------------------------------------------------
async function loadDig() {
  try {
    const res = await API.getDigStatus(Session.userId);
    renderDigEnergy(res.energy, res.maxEnergy, res.secondsUntilNext);
  } catch (e) {
    document.getElementById("dig-status-text").textContent = "Impossible de charger l'énergie.";
  }
}

function renderDigEnergy(energy, maxEnergy, secondsUntilNext) {
  document.getElementById("dig-energy-bar").innerHTML = Array.from({ length: maxEnergy }, (_, i) => `
    <span class="dig-pip ${i < energy ? "filled" : ""}"></span>
  `).join("");
  const statusText = document.getElementById("dig-status-text");
  const digBtn = document.getElementById("dig-btn");
  if (energy > 0) {
    statusText.textContent = `${energy} / ${maxEnergy} énergie`;
    digBtn.style.display = "inline-flex";
  } else {
    statusText.textContent = `Énergie épuisée — prochaine dans ${formatDuration(secondsUntilNext || 1800)}`;
    digBtn.style.display = "none";
  }
}

async function doDig() {
  const digBtn = document.getElementById("dig-btn");
  digBtn.disabled = true;
  try {
    const res = await API.dig(Session.userId);
    const resultEl = document.getElementById("dig-result");
    resultEl.style.display = "block";
    if (res.outcome === "nothing") {
      resultEl.innerHTML = `&#128269; Rien trouvé cette fois.`;
    } else if (res.outcome === "dust") {
      resultEl.innerHTML = `&#10024; +${res.dustGained} poussières d'étoile !`;
    } else if (res.outcome === "booster") {
      resultEl.innerHTML = `&#127183; +1 booster !`;
      if (typeof confetti === "function") confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 } });
    } else if (res.outcome === "card") {
      resultEl.innerHTML = `&#127942; Tu as trouvé <strong>${res.card.name}</strong> !`;
      if (typeof confetti === "function") confetti({ particleCount: 150, spread: 100, origin: { y: 0.5 } });
    }
    await loadDig();
  } catch (e) {
    Toast.error(e.code === "no_energy" ? "Plus assez d'énergie." : ("Erreur. (" + e.message + ")"));
  } finally {
    digBtn.disabled = false;
  }
}

// -----------------------------------------------------------------------
// Bingo
// -----------------------------------------------------------------------
async function loadBingo() {
  try {
    const res = await API.getBingoStatus(Session.userId);
    if (!res.hasGrid) {
      document.getElementById("bingo-no-grid").style.display = "block";
      document.getElementById("bingo-zone").style.display = "none";
      return;
    }
    document.getElementById("bingo-no-grid").style.display = "none";
    document.getElementById("bingo-zone").style.display = "block";
    document.getElementById("bingo-grid").innerHTML = (res.cells || []).map((c) => {
      const color = c.rarity?.colorHex || "#9aa0b4";
      const imgSrc = API.imageUrl(c.imageId) || PLACEHOLDER_IMG;
      return `
        <div class="bingo-cell ${c.owned ? "owned" : ""}" style="border-color:${c.owned ? color : "transparent"};">
          <img src="${imgSrc}" alt="${c.name}" loading="lazy" />
          <div class="bingo-cell-name">${c.name}</div>
          ${c.owned ? `<span class="bingo-cell-check">&#9989;</span>` : ""}
        </div>
      `;
    }).join("");
    const claimBtn = document.getElementById("bingo-claim-btn");
    const claimedLabel = document.getElementById("bingo-claimed-label");
    if (res.claimed) {
      claimBtn.style.display = "none";
      claimedLabel.style.display = "inline-flex";
    } else if (res.allOwned) {
      claimBtn.style.display = "inline-flex";
      claimedLabel.style.display = "none";
    } else {
      claimBtn.style.display = "none";
      claimedLabel.style.display = "none";
    }
  } catch (e) {
    document.getElementById("bingo-no-grid").style.display = "block";
    document.getElementById("bingo-no-grid").textContent = "Impossible de charger le bingo.";
  }
}

async function claimBingo() {
  try {
    const res = await API.claimBingo(Session.userId);
    Toast.success(`Bingo complet ! +${res.rewardBoosters} boosters !`);
    if (typeof confetti === "function") confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } });
    await loadBingo();
  } catch (e) {
    Toast.error(e.code === "already_claimed" ? "Déjà réclamé ce mois-ci." : ("Erreur. (" + e.message + ")"));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("tab-dig-btn").addEventListener("click", () => setActiveTab("dig"));
  document.getElementById("tab-bingo-btn").addEventListener("click", () => setActiveTab("bingo"));
  document.getElementById("dig-btn").addEventListener("click", doDig);
  document.getElementById("bingo-claim-btn").addEventListener("click", claimBingo);
  document.getElementById("dig-pane").style.display = "block";
  loadDig();
});
