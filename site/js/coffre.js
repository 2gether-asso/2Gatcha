// Coffre-fort perso (coffre.html, 2026-10-02) - voir personal-vault.json.
// Une ligne = une carte, 6 emplacements (un par finition), parfait etat
// uniquement. Ligne complete = recompense unique (boosters + poussieres +
// une carte de rarete Unique, voir api/src/native/unique.js). Cartes promo
// exclues (une seule finition possible).

const PV_FINISHES = ["normal", "holo", "gold", "ghost", "diamond", "rainbow"];
const PV_FINISH_LABELS = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
const PV_ERRORS = {
  vault_locked: "Ton coffre-fort perso n'est pas encore débloqué.",
  not_mint: "Seules les cartes en parfait état peuvent être rangées.",
  slot_filled: "Cet emplacement est déjà occupé.",
  already_stored: "Cette carte est déjà au coffre.",
  not_stored: "Cette carte n'est pas au coffre.",
  pull_not_owned: "Cet exemplaire ne t'appartient plus.",
  promo_not_storable: "Les cartes promo ne vont pas au coffre-fort (une seule finition possible)."
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
    <div class="pv-reward-note">Ligne complète (6 finitions en parfait état) : <strong>${data.boostersPerRow} boosters + ${data.dustPerRow} poussières</strong>${pvUniqueNote(data.unique)}, une seule fois par carte. Les cartes promo ne vont pas au coffre.</div>
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
        // Meme rendu que les vignettes de la collection (.collection-card +
        // data-finish/data-quality) : on recupere les effets de finition et
        // les etiquettes existants.
        return `<div class="pv-slot filled" data-finish="${f}">
          <div class="collection-card pv-mini" data-rarity="${r.rarity?.key || "commune"}" data-finish="${f}" data-quality="mint">
            <div class="card-art">
              <img src="${img}" alt="${r.name}" loading="lazy" />
              ${f !== "normal" ? `<span class="finish-indicator" data-finish="${f}">${PV_FINISH_LABELS[f]}</span>` : ""}
              <span class="quality-indicator" data-quality="mint">Parfait état</span>
              ${slot.stored.serialNumber === 1 ? `<span class="serial-one-badge" title="Premier exemplaire en circulation">#001</span>` : ""}
            </div>
          </div>
          <div class="pv-slot-foot">
            <span class="pv-slot-label">${PV_FINISH_LABELS[f]} ${pvSerial(slot.stored.serialNumber)}</span>
            <button type="button" class="pv-withdraw" data-pull-id="${slot.stored.pullId}" title="Retirer du coffre">Retirer</button>
          </div>
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

// Carte Unique (verte) offerte a chaque ligne completee, tant qu'il en reste
// que le joueur n'a pas.
function pvUniqueNote(u) {
  if (!u) return "";
  const waiting = u.owed ? ` · ${u.owed} carte${u.owed > 1 ? "s" : ""} Unique en attente (dès qu'une nouvelle sortira)` : "";
  if (!u.total) return waiting;
  return (u.remaining
    ? ` <span class="pv-unique-note">+ 1 carte Unique &#127808;</span> (${u.remaining} sur ${u.total} encore à gagner)`
    : ` <span class="pv-unique-note">(toutes les cartes Unique obtenues &#127808;)</span>`) + waiting;
}

// Revele les cartes une par une (la suivante a la fermeture de la precedente).
function pvRevealUnique(card, queue = [], label = "Carte Unique obtenue !") {
  const overlay = document.createElement("div");
  overlay.className = "unique-reveal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Carte Unique obtenue");
  overlay.innerHTML = `
    <div class="unique-reveal">
      <div class="unique-reveal-eyebrow">&#127808; ${label}</div>
      <div class="unique-reveal-card" data-rarity="unique">
        <img src="${API.imageUrl(card.imageId) || ""}" alt="${card.name}" />
        <div class="card-info">
          <div class="card-name">${card.name}</div>
          <span class="rarity-badge" style="background:#22c55e22;color:var(--rarity-unique);border:1px solid var(--rarity-unique);">Unique ${pvSerial(card.serialNumber)}</span>
        </div>
      </div>
      <div class="unique-reveal-sub">${card.isFirstEver ? "&#127942; Premier exemplaire du serveur ! " : ""}Elle ne s'obtient qu'au coffre-fort. Touche pour continuer.</div>
    </div>`;
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    if (queue.length) pvRevealUnique(queue[0], queue.slice(1), label);
  };
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  if (typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal("unique");
  if (typeof confetti === "function") confetti({ particleCount: 200, spread: 130, origin: { y: 0.55 }, colors: ["#22c55e", "#86efac", "#bbf7d0", "#ffffff"] });
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
      Toast.success(`Ligne ${data.reward.cardName} complète ! +${data.reward.boosters} boosters et +${data.reward.dust} poussières${data.reward.uniqueCard ? ` et la carte Unique ${data.reward.uniqueCard.name}` : ""}.`);
      if (typeof loadNavBadges === "function") loadNavBadges();
    }
    // Carte de la ligne du jour, puis rattrapage des lignes deja completees.
    const today = data.reward && data.reward.uniqueCard ? [data.reward.uniqueCard] : [];
    const catchUp = data.uniqueGrants || [];
    if (catchUp.length) Toast.success(`Rattrapage : ${catchUp.length} carte${catchUp.length > 1 ? "s" : ""} Unique pour tes lignes déjà complétées !`);
    const reveals = [...today, ...catchUp];
    if (reveals.length) pvRevealUnique(reveals[0], reveals.slice(1), today.length ? "Carte Unique obtenue !" : "Rattrapage : carte Unique !");
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
