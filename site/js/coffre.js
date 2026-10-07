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
  promo_not_storable: "Les cartes promo ne vont pas au coffre-fort (une seule finition possible)."
};
let pvBusy = false;

function pvSerial(n) {
  return n != null ? `#${String(n).padStart(3, "0")}` : "";
}

// Tri / filtre des lignes (memorises dans le navigateur).
const PV_VIEW_KEY = "2gatcha_pv_view";
function pvView() {
  try { return { sort: "progress", filter: "all", ...JSON.parse(localStorage.getItem(PV_VIEW_KEY) || "{}") }; } catch (e) { return { sort: "progress", filter: "all" }; }
}
function pvApplyView(rows) {
  const v = pvView();
  const keep = { all: () => true, almost: (r) => !r.complete && r.filled >= 4, open: (r) => !r.complete, done: (r) => r.complete }[v.filter] || (() => true);
  const sorters = {
    progress: (a, b) => (b.filled - a.filled) || ((b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0)) || a.name.localeCompare(b.name),
    rarity: (a, b) => ((b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0)) || (b.filled - a.filled) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name)
  };
  const q = (document.getElementById("pv-search")?.value || "").trim().toLowerCase();
  return rows.filter(keep).filter((r) => !q || r.name.toLowerCase().includes(q)).sort(sorters[v.sort] || sorters.progress);
}
let pvLastData = null;

function pvRender(data) {
  pvLastData = data;
  const allRows = data.rows || [];
  const rows = pvApplyView(allRows);
  const complete = allRows.filter((r) => r.complete).length;
  document.getElementById("pv-summary").innerHTML = `
    <div class="pv-kpi"><strong>${allRows.reduce((n, r) => n + r.filled, 0)}</strong><span>cartes protégées</span></div>
    <div class="pv-kpi"><strong>${complete}</strong><span>ligne${complete > 1 ? "s" : ""} complète${complete > 1 ? "s" : ""}</span></div>
    <div class="pv-reward-note">Ligne complète (6 finitions en parfait état) : <strong>${data.boostersPerRow} boosters + ${data.dustPerRow} poussières</strong>${pvUniqueNote(data.unique)}, une seule fois par carte. Les cartes promo ne vont pas au coffre.</div>
  `;
  const box = document.getElementById("pv-rows");
  document.getElementById("pv-toolbar").hidden = allRows.length < 2;
  if (!rows.length) {
    box.innerHTML = allRows.length
      ? `<p class="muted">Aucune ligne ne correspond à ce filtre.</p>`
      : `<p class="muted">Aucune carte en parfait état pour l'instant. Restaure tes cartes (Craft &rarr; Qualité) pour pouvoir les ranger ici.</p>`;
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
    const missing = PV_FINISHES.filter((f) => !(r.slots.find((s) => s.finish === f) || {}).stored).map((f) => PV_FINISH_LABELS[f]);
    const preview = !r.claimed && r.filled >= 4 && r.filled < 6
      ? `<div class="pv-row-preview">Plus que <strong>${missing.join(" et ")}</strong> : ${data.boostersPerRow} boosters + ${data.dustPerRow} &#10024; + 1 &#127915;</div>`
      : "";
    return `<div class="pv-row ${r.complete ? "complete" : ""}" data-card-id="${r.cardId}" style="--r:${color}">
      <div class="pv-row-head">
        ${img ? `<img class="pv-row-thumb" src="${img}" alt="" loading="lazy" />` : ""}
        <span class="pv-row-name">${r.name}</span>
        <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">${r.rarity?.name || ""}</span>
        <span class="pv-row-progress">${r.filled}/6 ${r.claimed ? "&#10004; récompense reçue" : ""}</span>
        <span class="pv-row-bar" aria-hidden="true"><span style="width:${Math.round((r.filled / 6) * 100)}%"></span></span>
      </div>
      ${preview}
      <div class="pv-slots">${slots}</div>
    </div>`;
  }).join("");
}

// Ligne qui se scelle : les 6 emplacements se verrouillent un par un.
function pvSealRow(cardId) {
  const row = document.querySelector(`.pv-row[data-card-id="${cardId}"]`);
  if (!row) return;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.add("sealing");
  row.querySelectorAll(".pv-slot").forEach((slot, i) => {
    slot.style.setProperty("--seal-delay", `${i * 140}ms`);
    setTimeout(() => { if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(320 + i * 60, 0, 0.12, "square", 0.05); }, i * 140);
  });
  setTimeout(() => row.classList.remove("sealing"), 1800);
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
    // Ancienne API (sans registre) : on n'affiche rien plutot que "personne".
    const owners = c.owners || [];
    const hasRegistry = Array.isArray(c.owners);
    const shown = owners.slice(0, 5);
    const ownersHtml = owners.length
      ? `<div class="pv-owners" title="${owners.map((o, i) => `${i + 1}. ${o.pseudo}`).join(" · ")}">
          ${shown.map((o, i) => `<span class="pv-owner ${i === 0 ? "first" : ""}">${o.discordAvatar ? `<img src="${o.discordAvatar}" alt="" />` : `<span>${(o.pseudo || "?").slice(0, 1)}</span>`}</span>`).join("")}
          ${owners.length > 5 ? `<span class="pv-owner more">+${owners.length - 5}</span>` : ""}
          <span class="pv-owners-label">1er : ${owners[0].pseudo}${owners.length > 1 ? ` · ${owners.length} propriétaires` : ""}</span>
        </div>`
      : hasRegistry ? `<div class="pv-owners empty">Personne ne l'a encore.</div>` : "";
    return `<div class="pv-counter-card ${c.owned ? "owned" : "missing"}">
      <div class="pv-dome">
        <div class="collection-card" data-rarity="unique">
          <div class="card-art"><img src="${img}" alt="${c.owned ? c.name : "Carte Unique à obtenir : " + c.name}" loading="lazy" /></div>
          <div class="card-info"><div class="card-name">${c.name}</div></div>
        </div>
        <span class="pv-dome-glass" aria-hidden="true"></span>
      </div>
      ${ownersHtml}
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
    await pvTearTicket();
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

// Ticket qui se dechire le long des pointilles.
function pvTearTicket() {
  return new Promise((resolve) => {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { resolve(); return; }
    const overlay = document.createElement("div");
    overlay.className = "ticket-tear-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `<div class="ticket-tear"><span class="ticket-half left">&#127915; TICKET</span><span class="ticket-half right">UNIQUE</span></div>`;
    document.body.appendChild(overlay);
    if (typeof Sfx !== "undefined" && Sfx._tone) setTimeout(() => Sfx._tone(180, 0, 0.18, "sawtooth", 0.04), 380);
    setTimeout(() => { overlay.remove(); resolve(); }, 950);
  });
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
      pvSealRow(data.reward.cardId);
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
    if (store) pvLoad("store", Number(store.dataset.pullId));
    else if (withdraw) pvLoad("withdraw", Number(withdraw.dataset.pullId));
  });
  const view = pvView();
  document.getElementById("pv-sort").value = view.sort;
  document.getElementById("pv-filter").value = view.filter;
  document.getElementById("pv-search").addEventListener("input", () => { if (pvLastData) pvRender(pvLastData); });
  ["pv-sort", "pv-filter"].forEach((id) => document.getElementById(id).addEventListener("change", () => {
    try { localStorage.setItem(PV_VIEW_KEY, JSON.stringify({ sort: document.getElementById("pv-sort").value, filter: document.getElementById("pv-filter").value })); } catch (e) {}
    if (pvLastData) pvRender(pvLastData);
  }));
  document.getElementById("pv-counter-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".pv-redeem");
    if (btn) pvRedeem(Number(btn.dataset.cardId));
  });
  pvLoad("status");
});
