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
// Fouille : grille de 16 tuiles a creuser. Certains tresors sont etales sur
// plusieurs tuiles (voir grist/SCHEMA.md) - une tuile "partielle" le signale
// discretement (une fissure de plus, pas la position exacte des autres
// tuiles du meme tresor) sans jamais reveler ce qui est cache ailleurs.
// -----------------------------------------------------------------------
let digEnergy = 0;
let digMaxEnergy = 5;
let digBusy = false;

const DIG_REWARD_ICON = { smallDust: "&#10024;", bigDust: "&#128142;", booster: "&#127183;", card: "&#127942;" };

async function loadDig() {
  try {
    const res = await API.getDigStatus(Session.userId);
    digEnergy = res.energy;
    digMaxEnergy = res.maxEnergy || 5;
    renderDigEnergy(res.energy, digMaxEnergy, res.secondsUntilNext);
    renderDigBoard(res.tiles || []);
    const regenSeconds = res.regenSeconds || 60;
    const regenLabel = regenSeconds < 60 ? `${regenSeconds}s` : regenSeconds === 60 ? "minute" : `${Math.round(regenSeconds / 60)} min`;
    document.getElementById("dig-intro").textContent =
      `Creuse les tuiles pour trouver des trésors cachés — certains sont étalés sur plusieurs tuiles, il faut toutes les creuser pour libérer l'objet. Chaque tuile coûte 1 point d'énergie (régénère +1 chaque ${regenLabel}, jusqu'à ${digMaxEnergy}).`;
  } catch (e) {
    document.getElementById("dig-status-text").textContent = "Impossible de charger l'énergie.";
  }
}

function renderDigEnergy(energy, maxEnergy, secondsUntilNext) {
  document.getElementById("dig-energy-bar").innerHTML = Array.from({ length: maxEnergy }, (_, i) => `
    <span class="dig-pip ${i < energy ? "filled" : ""}"></span>
  `).join("");
  const statusText = document.getElementById("dig-status-text");
  if (energy > 0) {
    statusText.textContent = `${energy} / ${maxEnergy} énergie — chaque tuile en coûte 1`;
  } else {
    statusText.textContent = `Énergie épuisée — prochaine dans ${formatDuration(secondsUntilNext || 60)}`;
  }
}

function digTileContent(tile) {
  if (!tile.dug) return { cls: "", html: "" };
  if (!tile.treasure) return { cls: "dug empty", html: "" };
  if (tile.treasure.done) return { cls: "dug revealed", html: DIG_REWARD_ICON[tile.treasure.reward] || "&#10024;" };
  return { cls: "dug partial", html: `<span class="dig-crack">&#9889;</span><span class="dig-remaining">-${tile.treasure.remaining}</span>` };
}

function renderDigBoard(tiles) {
  const board = document.getElementById("dig-board");
  board.innerHTML = tiles.map((t, i) => {
    const { cls, html } = digTileContent(t);
    const disabled = t.dug || digEnergy < 1 || digBusy;
    return `<button type="button" class="dig-tile ${cls}" data-tile-index="${i}" ${disabled ? "disabled" : ""} aria-label="${t.dug ? "Tuile creusée" : "Creuser cette tuile"}">${html}</button>`;
  }).join("");
  board.querySelectorAll(".dig-tile:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => doDig(Number(btn.dataset.tileIndex)));
  });
}

async function doDig(tileIndex) {
  if (digBusy || digEnergy < 1) return;
  digBusy = true;
  const resultEl = document.getElementById("dig-result");
  try {
    const res = await API.dig(Session.userId, tileIndex);
    digEnergy = res.newEnergy;
    renderDigEnergy(res.newEnergy, digMaxEnergy, null);
    renderDigBoard(res.tiles || []);

    resultEl.style.display = "block";
    if (res.outcome === "partial") {
      resultEl.innerHTML = `&#9889; Un objet se cache ici, mais il faut creuser encore <strong>${res.remaining}</strong> tuile${res.remaining > 1 ? "s" : ""} pour le libérer.`;
    } else if (res.outcome === "nothing") {
      resultEl.innerHTML = `&#128269; Rien trouvé sous cette tuile.`;
    } else if (res.outcome === "dust") {
      resultEl.innerHTML = `&#10024; Trésor libéré : +${res.dustGained} poussières d'étoile !`;
    } else if (res.outcome === "booster") {
      resultEl.innerHTML = `&#127183; Trésor libéré : +1 booster !`;
      if (typeof confetti === "function") confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 } });
    } else if (res.outcome === "card") {
      resultEl.innerHTML = `&#127942; Trésor libéré : tu as trouvé <strong>${res.card.name}</strong> !`;
      if (typeof confetti === "function") confetti({ particleCount: 150, spread: 100, origin: { y: 0.5 } });
    }

    if (res.boardCleared) {
      setTimeout(() => {
        Toast.info("Plateau entièrement fouillé — un nouveau vient d'apparaître !");
        loadDig();
      }, 1400);
    }
  } catch (e) {
    Toast.error(e.code === "no_energy" ? "Plus assez d'énergie." : e.code === "tile_already_dug" ? "Cette tuile est déjà creusée." : ("Erreur. (" + e.message + ")"));
  } finally {
    digBusy = false;
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
  document.getElementById("bingo-claim-btn").addEventListener("click", claimBingo);
  document.getElementById("dig-pane").style.display = "block";
  loadDig();
});
