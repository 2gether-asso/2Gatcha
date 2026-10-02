// Coffre-fort perso (coffre.html, 2026-10-02) - voir personal-vault.json.
// Une ligne = une carte, 6 emplacements (un par finition), parfait etat
// uniquement. Ligne complete = recompense unique (boosters + poussieres).

const PV_FINISHES = ["normal", "holo", "gold", "ghost", "diamond", "rainbow"];
const PV_FINISH_LABELS = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
const PV_ERRORS = {
  vault_locked: "Ton coffre-fort perso n'est pas encore débloqué.",
  not_mint: "Seules les cartes en parfait état peuvent être rangées.",
  slot_filled: "Cet emplacement est déjà occupé.",
  already_stored: "Cette carte est déjà au coffre.",
  not_stored: "Cette carte n'est pas au coffre.",
  pull_not_owned: "Cet exemplaire ne t'appartient plus."
};
let pvBusy = false;

function pvSerial(n) {
  return n != null ? `#${String(n).padStart(3, "0")}` : "";
}

function pvRender(data) {
  const rows = data.rows || [];
  const complete = rows.filter((r) => r.complete).length;
  document.getElementById("pv-summary").innerHTML = `
    <div class="stat-tile"><div class="stat-value">${rows.reduce((n, r) => n + r.filled, 0)}</div><div class="stat-label">Cartes protégées</div></div>
    <div class="stat-tile"><div class="stat-value">${complete}</div><div class="stat-label">Lignes complètes</div></div>
    <div class="pv-reward-note">Ligne complète (6 finitions en parfait état) : <strong>${data.boostersPerRow} boosters + ${data.dustPerRow} poussières</strong>, une seule fois par carte.</div>
  `;
  const box = document.getElementById("pv-rows");
  if (!rows.length) {
    box.innerHTML = `<p class="muted">Aucune carte en parfait état pour l'instant. Restaure tes cartes (Craft &rarr; Qualité) pour pouvoir les ranger ici.</p>`;
    return;
  }
  box.innerHTML = rows.map((r) => {
    const color = r.rarity?.colorHex || "#9aa0b4";
    const img = API.imageUrl(r.imageId) || "";
    const slots = PV_FINISHES.map((f) => {
      const slot = r.slots.find((s) => s.finish === f) || { candidates: [] };
      if (slot.stored) {
        return `<div class="pv-slot filled" data-finish="${f}">
          <img src="${img}" alt="" loading="lazy" />
          <span class="pv-slot-label">${PV_FINISH_LABELS[f]} ${pvSerial(slot.stored.serialNumber)}</span>
          <button type="button" class="pv-withdraw" data-pull-id="${slot.stored.pullId}" title="Retirer du coffre">Retirer</button>
        </div>`;
      }
      const best = slot.candidates.slice().sort((a, b) => (b.serialNumber === 1) - (a.serialNumber === 1) || (a.serialNumber || 0) - (b.serialNumber || 0))[0];
      return `<div class="pv-slot empty ${best ? "available" : ""}" data-finish="${f}">
        <span class="pv-slot-label">${PV_FINISH_LABELS[f]}</span>
        ${best ? `<button type="button" class="pv-store" data-pull-id="${best.pullId}" title="Ranger ${pvSerial(best.serialNumber)}">Ranger ${pvSerial(best.serialNumber)}</button>` : `<span class="pv-slot-missing">&mdash;</span>`}
      </div>`;
    }).join("");
    return `<div class="pv-row ${r.complete ? "complete" : ""}">
      <div class="pv-row-head">
        <span class="pv-row-name">${r.name}</span>
        <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">${r.rarity?.name || ""}</span>
        <span class="pv-row-progress">${r.filled}/6 ${r.claimed ? "&#10004; récompense reçue" : ""}</span>
      </div>
      <div class="pv-slots">${slots}</div>
    </div>`;
  }).join("");
}

async function pvLoad(action, pullId) {
  if (pvBusy) return;
  pvBusy = true;
  try {
    const data = await API.personalVault(Session.userId, action || "status", pullId);
    if (!data.unlocked) {
      document.getElementById("pv-locked").style.display = "block";
      document.getElementById("pv-zone").style.display = "none";
      return;
    }
    document.getElementById("pv-zone").style.display = "block";
    pvRender(data);
    if (action === "store") Toast.success("Carte rangée au coffre : elle est protégée.");
    if (action === "withdraw") Toast.info("Carte retirée du coffre : elle revient dans ta collection.");
    if (data.reward) {
      Toast.success(`Ligne ${data.reward.cardName} complète ! +${data.reward.boosters} boosters et +${data.reward.dust} poussières.`);
      if (typeof loadNavBadges === "function") loadNavBadges();
    }
  } catch (e) {
    Toast.error(PV_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  } finally {
    pvBusy = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("pv-guest").style.display = "block";
    return;
  }
  document.getElementById("pv-rows").addEventListener("click", (e) => {
    const store = e.target.closest(".pv-store");
    const withdraw = e.target.closest(".pv-withdraw");
    if (store) pvLoad("store", Number(store.dataset.pullId));
    else if (withdraw) pvLoad("withdraw", Number(withdraw.dataset.pullId));
  });
  pvLoad("status");
});
