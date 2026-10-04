// Coffre-fort perso (coffre.html, 2026-10-02) - voir personal-vault.json.
// Une ligne = une carte, 6 emplacements (un par finition), parfait etat
// uniquement. Ligne complete = recompense unique (boosters + poussieres +
// un Ticket Unique a echanger au comptoir, voir api/src/native/unique.js). Cartes promo
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
  no_spare_part: "Tu n'as pas de pièce détachée (elles se pêchent).",
  joker_limit: "Plus de pièce détachée possible sur cette ligne.",
  jokers_disabled: "Les pièces détachées sont désactivées.",
  promo_not_storable: "Les cartes promo ne vont pas au coffre-fort (une seule finition possible)."
};
let pvBusy = false;
let pvJokers = { parts: 0, perRow: 0 };

function pvSerial(n) {
  return n != null ? `#${String(n).padStart(3, "0")}` : "";
}

function pvRender(data) {
  const rows = data.rows || [];
  pvJokers = { parts: data.spareParts || 0, perRow: data.jokersPerRow || 0 };
  const complete = rows.filter((r) => r.complete).length;
  document.getElementById("pv-summary").innerHTML = `
    <div class="stat-tile"><div class="stat-value">${rows.reduce((n, r) => n + r.filled, 0)}</div><div class="stat-label">Cartes protégées</div></div>
    <div class="stat-tile"><div class="stat-value">${complete}</div><div class="stat-label">Lignes complètes</div></div>
    <div class="stat-tile pv-parts-tile" title="Pièces détachées : pêchées, elles remplissent un emplacement vide comme un joker"><div class="stat-value">&#128297; ${data.spareParts || 0}</div><div class="stat-label">Pièces détachées</div></div>
    <div class="pv-reward-note">Ligne complète (6 finitions en parfait état) : <strong>${data.boostersPerRow} boosters + ${data.dustPerRow} poussières</strong>${pvUniqueNote(data.unique)}, une seule fois par carte. Les cartes promo ne vont pas au coffre.${data.jokersPerRow ? ` Une <strong>pièce détachée</strong> &#128297; (pêche) remplit un emplacement vide, ${data.jokersPerRow} max par ligne ; ranger plus tard la vraie carte te la rend.` : ""}</div>
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
      if (slot.joker) {
        const realOne = slot.candidates.slice().sort((a, b) => (a.serialNumber || 0) - (b.serialNumber || 0))[0];
        return `<div class="pv-slot filled joker" data-finish="${f}">
          <div class="pv-joker-art" aria-hidden="true">&#128297;</div>
          <div class="pv-slot-foot">
            <span class="pv-slot-label">${PV_FINISH_LABELS[f]} · pièce</span>
            ${realOne ? `<button type="button" class="pv-store" data-pull-id="${realOne.pullId}" title="Ranger la vraie carte : la pièce te revient">Ranger ${pvSerial(realOne.serialNumber)}</button>` : ""}
          </div>
        </div>`;
      }
      const canJoker = !slot.candidates.length && pvJokers.perRow && pvJokers.parts > 0 && r.jokers < pvJokers.perRow;
      const best = slot.candidates.slice().sort((a, b) => (b.serialNumber === 1) - (a.serialNumber === 1) || (a.serialNumber || 0) - (b.serialNumber || 0))[0];
      return `<div class="pv-slot empty ${best ? "available" : ""}" data-finish="${f}">
        <span class="pv-slot-label">${PV_FINISH_LABELS[f]}</span>
        ${best ? `<button type="button" class="pv-store" data-pull-id="${best.pullId}" title="Ranger ${pvSerial(best.serialNumber)}">Ranger ${pvSerial(best.serialNumber)}</button>` : canJoker ? `<button type="button" class="pv-joker" data-card-id="${r.cardId}" data-finish="${f}" title="Remplir avec une pièce détachée">&#128297; Pièce</button>` : `<span class="pv-slot-missing">&mdash;</span>`}
      </div>`;
    }).join("");
    return `<div class="pv-row ${r.complete ? "complete" : ""}">
      <div class="pv-row-head">
        <span class="pv-row-name">${r.name}</span>
        <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">${r.rarity?.name || ""}</span>
        <span class="pv-row-progress">${r.filled}/6${r.jokers ? ` (dont ${r.jokers} &#128297;)` : ""} ${r.claimed ? "&#10004; récompense reçue" : ""}</span>
      </div>
      <div class="pv-slots">${slots}</div>
    </div>`;
  }).join("");
}

// Carte Unique (verte) offerte a chaque ligne completee, tant qu'il en reste
// que le joueur n'a pas.
function pvUniqueNote(u) {
  return u ? ` <span class="pv-unique-note">+ 1 Ticket Unique &#127915;</span>` : "";
}

// ---------------------------------------------------------------- comptoir
// Comptoir Unique (api/src/native/unique.js) : 1 ticket = 1 carte Unique au
// choix parmi celles qu'on n'a pas encore.
let pvCounter = null;
let pvCounterScrolled = false;

function pvRenderCounter(st, fresh) {
  pvCounter = st;
  const section = document.getElementById("comptoir");
  section.hidden = !st.cards.length && !st.tickets;
  document.getElementById("pv-ticket-stub").innerHTML = `
    <span class="pv-ticket ${fresh ? "printing" : ""} ${st.tickets ? "" : "empty"}">
      <span class="pv-ticket-icon" aria-hidden="true">&#127915;</span>
      <span class="pv-ticket-count">${st.tickets}</span>
      <span class="pv-ticket-label">ticket${st.tickets > 1 ? "s" : ""}</span>
    </span>`;
  const grid = document.getElementById("pv-counter-grid");
  if (!st.cards.length) {
    grid.innerHTML = `<p class="muted">Aucune carte Unique pour l'instant. Garde tes tickets : ils serviront dès que les premières arriveront.</p>`;
    return;
  }
  grid.innerHTML = st.cards.map((c) => {
    const img = API.imageUrl(c.imageId) || "";
    return `<div class="pv-counter-card ${c.owned ? "owned" : "missing"}">
      <div class="collection-card" data-rarity="unique">
        <div class="card-art"><img src="${img}" alt="${c.owned ? c.name : "Carte Unique à obtenir : " + c.name}" loading="lazy" /></div>
        <div class="card-info"><div class="card-name">${c.name}</div></div>
      </div>
      ${c.owned
        ? `<span class="pv-counter-owned">&#10004; Obtenue ${pvSerial(c.serialNumber)}</span>`
        : `<button type="button" class="btn pv-redeem" data-card-id="${c.cardId}" ${st.tickets ? "" : "disabled"}>Échanger 1 &#127915;</button>`}
    </div>`;
  }).join("");
}

async function pvLoadCounter(fresh) {
  try {
    pvRenderCounter(await API.uniqueCounter(Session.userId, "status"), fresh);
    // Lien de l'en-tete (coffre.html#comptoir) : la section n'existe qu'apres ce rendu.
    if (location.hash === "#comptoir" && !pvCounterScrolled) { pvCounterScrolled = true; document.getElementById("comptoir").scrollIntoView({ block: "start" }); }
  }
  catch (e) { /* comptoir indisponible (ancienne API) : la page reste utilisable */ }
}

async function pvRedeem(cardId) {
  if (pvBusy) return;
  const card = pvCounter && pvCounter.cards.find((c) => c.cardId === cardId);
  if (!card) return;
  const okGo = await Confirm.show(`1 Ticket Unique contre la carte « ${card.name} ». Ce choix est définitif.`, { title: "Échanger un ticket ?", confirmText: "Échanger" });
  if (!okGo) return;
  pvBusy = true;
  try {
    const res = await API.uniqueCounter(Session.userId, "redeem", cardId);
    pvRenderCounter(res);
    pvRevealUnique(res.card);
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error({ no_ticket: "Tu n'as pas de Ticket Unique.", already_owned: "Tu as déjà cette carte.", not_unique_card: "Cette carte n'est pas au comptoir." }[e.code] || ("Erreur. (" + e.message + ")"));
    pvLoadCounter();
  } finally {
    pvBusy = false;
  }
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

async function pvLoad(action, pullId, extra = {}) {
  if (pvBusy) return;
  pvBusy = true;
  try {
    const data = await API.personalVault(Session.userId, action || "status", pullId, extra);
    if (!data.unlocked) {
      document.getElementById("pv-locked").style.display = "block";
      document.getElementById("pv-zone").style.display = "none";
      return;
    }
    document.getElementById("pv-zone").style.display = "block";
    pvRender(data);
    if (action === "store") Toast.success(data.jokerRefunded ? "Carte rangée : la pièce détachée te revient." : "Carte rangée au coffre : elle est protégée.");
    if (action === "joker") Toast.success("Pièce détachée posée.");
    if (action === "withdraw") Toast.info("Carte retirée du coffre : elle revient dans ta collection.");
    if (data.reward) {
      Toast.success(`Ligne ${data.reward.cardName} complète ! +${data.reward.boosters} boosters, +${data.reward.dust} poussières${data.reward.ticket ? " et un Ticket Unique 🎫" : ""}.`);
      if (typeof loadNavBadges === "function") loadNavBadges();
    }
    pvLoadCounter(data.reward && data.reward.ticket ? "new" : null);
    if (data.reward && typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
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
    const joker = e.target.closest(".pv-joker");
    if (joker) {
      Confirm.show("Poser une pièce détachée sur cet emplacement ? Elle ne se retire pas, mais ranger plus tard la vraie carte te la rendra.", { title: "Pièce détachée", confirmText: "Poser" })
        .then((go) => { if (go) pvLoad("joker", null, { cardId: Number(joker.dataset.cardId), finish: joker.dataset.finish }); });
      return;
    }
    if (store) pvLoad("store", Number(store.dataset.pullId));
    else if (withdraw) pvLoad("withdraw", Number(withdraw.dataset.pullId));
  });
  document.getElementById("pv-counter-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".pv-redeem");
    if (btn) pvRedeem(Number(btn.dataset.cardId));
  });
  pvLoad("status");
});
