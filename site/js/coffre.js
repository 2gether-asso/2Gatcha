// Coffre-fort perso (coffre.html, 2026-10-02) - voir api/src/native/personal-vault.js.
// 2026-10-25 : lignes groupees par extension ; carte emeraude (7e case) pour
// chaque ligne complete, verrouillee dans le coffre.
// 2026-10-26 : bouton vitrine par ligne (une carte du coffre peut aller en
// vitrine du profil), zoom sur chaque carte rangee (inspecteur) et vue
// "Presentoir" : toutes les cartes du coffre exposees comme des tresors.
// Une ligne = une carte, 6 emplacements (un par finition), parfait etat
// uniquement. Ligne complete = recompense unique (boosters + poussieres +
// un Ticket Unique a echanger au comptoir, voir api/src/native/unique.js). Cartes promo
// exclues (une seule finition possible).

const PV_FINISHES = ["normal", "holo", "gold", "ghost", "diamond", "rainbow"];
const PV_FINISH_LABELS = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel", emerald: "Émeraude" };
const PV_ERRORS = {
  vault_locked: "Ton coffre-fort perso n'est pas encore débloqué.",
  not_mint: "Seules les cartes en parfait état peuvent être rangées.",
  slot_filled: "Cet emplacement est déjà occupé.",
  already_stored: "Cette carte est déjà au coffre.",
  not_stored: "Cette carte n'est pas au coffre.",
  pull_not_owned: "Cet exemplaire ne t'appartient plus.",
  promo_not_storable: "Les cartes promo ne vont pas au coffre-fort (une seule finition possible).",
  emerald_locked: "Une carte émeraude ne quitte jamais le coffre : elle atteste ta maîtrise de la carte.",
  showcase_full: "Ta vitrine est déjà pleine (6 cartes max) : retire-en une avant d'en ajouter une nouvelle.",
  card_not_owned: "Cette carte n'est plus à toi."
};
let pvBusy = false;

function pvSerial(n) {
  return n != null ? `#${String(n).padStart(3, "0")}` : "";
}

// Tri / filtre des lignes (memorises dans le navigateur).
const PV_VIEW_KEY = "2gatcha_pv_view";
function pvView() {
  try { return { sort: "progress", filter: "all", ext: "all", ...JSON.parse(localStorage.getItem(PV_VIEW_KEY) || "{}") }; } catch (e) { return { sort: "progress", filter: "all", ext: "all" }; }
}
// Exemplaires rangeables tout de suite (case vide + exemplaire en parfait etat possede).
function pvStorable(r) {
  return PV_FINISHES.map((f) => {
    const slot = r.slots.find((s) => s.finish === f) || { candidates: [] };
    if (slot.stored || !slot.candidates.length) return null;
    return slot.candidates.slice().sort((a, b) => (b.serialNumber === 1) - (a.serialNumber === 1) || (a.serialNumber || 0) - (b.serialNumber || 0))[0].pullId;
  }).filter(Boolean);
}
function pvApplyView(rows) {
  const v = pvView();
  const keep = { all: () => true, ready: (r) => pvStorable(r).length > 0, almost: (r) => !r.complete && r.filled >= 4, open: (r) => !r.complete, done: (r) => r.complete }[v.filter] || (() => true);
  const sorters = {
    progress: (a, b) => (b.filled - a.filled) || ((b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0)) || a.name.localeCompare(b.name),
    rarity: (a, b) => ((b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0)) || (b.filled - a.filled) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name)
  };
  const q = (document.getElementById("pv-search")?.value || "").trim().toLowerCase();
  // Rangement par extension (2026-10-25), puis dans chaque extension : les
  // lignes ou l'on peut ranger quelque chose en tete (d'abord celles qu'on
  // peut terminer d'un coup), puis le tri choisi.
  const sorter = sorters[v.sort] || sorters.progress;
  const rank = (r) => { const n = pvStorable(r).length; return !n ? 0 : r.filled + n >= 6 ? 2 : 1; };
  const extOrder = (r) => (r.extension ? r.extension.sortOrder : 1e9);
  return rows.filter(keep).filter((r) => v.ext === "all" || String(pvExtId(r)) === String(v.ext)).filter((r) => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => (extOrder(a) - extOrder(b)) || (pvExtId(a) - pvExtId(b)) || (rank(b) - rank(a)) || sorter(a, b));
}
let pvLastData = null;
const pvExtId = (r) => (r.extension ? r.extension.id : 0);
// Liste des extensions presentes dans l'onglet (menu "Extension").
function pvRenderExtSelect(rows) {
  const sel = document.getElementById("pv-ext");
  if (!sel) return;
  const exts = new Map();
  rows.forEach((r) => { const id = pvExtId(r); const e = exts.get(id) || { id, name: r.extension ? r.extension.name : "Hors extension", order: r.extension ? r.extension.sortOrder : 1e9, n: 0, done: 0 }; e.n++; if (r.complete) e.done++; exts.set(id, e); });
  const list = [...exts.values()].sort((a, b) => a.order - b.order || a.id - b.id);
  const v = pvView();
  const html = `<option value="all">Toutes (${list.length})</option>` + list.map((e) => `<option value="${e.id}">${escHtml(e.name)} · ${e.done}/${e.n}</option>`).join("");
  if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
  sel.value = list.some((e) => String(e.id) === String(v.ext)) ? String(v.ext) : "all";
  if (sel._fancyRefresh) sel._fancyRefresh();
  sel.closest("label").hidden = list.length < 2;
}
// Carte emeraude : 7e case de la ligne, verrouillee dans le coffre.
function pvEmeraldSlot(r, img, tab) {
  if (r.emerald) return `<div class="pv-emerald has" title="Carte émeraude : atteste ta maîtrise de ${escHtml(r.name)}. Elle ne quitte jamais le coffre.">
      <div class="collection-card pv-mini" data-rarity="${r.rarity?.key || "commune"}" data-finish="emerald" data-quality="mint"${tab ? ` data-edition="${tab.key}"` : ""} data-zoom="${r.cardId}" data-zoom-finish="emerald" role="button" tabindex="0" aria-label="Voir ${escHtml(r.name)} émeraude en grand">
        <div class="card-art"><img src="${img}" alt="${escHtml(r.name)} émeraude" loading="lazy" decoding="async" />${tab ? editionBadge(tab.key) : ""}</div>
      </div>
      <span class="pv-slot-label">💚 Émeraude ${pvSerial(r.emerald.serialNumber)}</span>
      <span class="pv-emerald-lock">🔒 Maîtrise</span>
    </div>`;
  return `<div class="pv-emerald" title="Complète les 6 finitions pour obtenir la carte émeraude, preuve de maîtrise (elle reste au coffre).">
      <span class="pv-emerald-gem" aria-hidden="true">💚</span>
      <span class="pv-slot-label">Émeraude</span>
      <small>${r.claimed ? "bientôt" : `encore ${6 - r.filled} finition${6 - r.filled > 1 ? "s" : ""}`}</small>
    </div>`;
}

// ------------------------------------------------------- onglets par edition
// "Classique" = cartes sans edition. Un onglet par edition deja obtenue, qui
// marche comme le Classique : une ligne par carte, 6 finitions, recompense.
const PV_TAB_KEY = "2gatcha_pv_tab";
let pvTab = (() => { try { return localStorage.getItem(PV_TAB_KEY) || "classic"; } catch (e) { return "classic"; } })();
const pvEditionTab = () => (pvTab !== "classic" && pvLastData ? pvVisibleTabs(pvLastData).find((t) => t.key === pvTab) : null);
// Lignes de l'onglet affiche.
function pvCurrentRows() {
  if (!pvLastData) return [];
  const tab = pvEditionTab();
  return tab ? tab.rows || [] : pvLastData.rows || [];
}

// Onglet d'edition affiche seulement s'il a au moins une carte rangee ou a
// ranger (2026-10-19 : avant, toute edition deja obtenue avait son onglet vide).
const pvVisibleTabs = (data) => (data.editions || []).filter((t) => (t.stored || 0) > 0 || (t.ready || 0) > 0);
function pvRenderTabs(data) {
  const tabs = pvVisibleTabs(data);
  const bar = document.getElementById("pv-tabs");
  if (pvTab !== "classic" && !tabs.some((t) => t.key === pvTab)) pvTab = "classic";
  bar.hidden = !tabs.length;
  const classicStored = (data.rows || []).reduce((n, r) => n + r.filled, 0);
  const classicReady = (data.rows || []).flatMap(pvStorable).length;
  const btn = (key, html, ready) => `<button type="button" role="tab" class="pv-tab ${pvTab === key ? "active" : ""}" data-pv-tab="${key}" aria-selected="${pvTab === key}">${html}${ready ? `<span class="pv-tab-dot" title="${ready} à ranger">${ready}</span>` : ""}</button>`;
  bar.innerHTML = btn("classic", `🗃️ Classique <small>${classicStored}</small>`, classicReady)
    + tabs.map((t) => btn(t.key, `${t.icon} ${escHtml(t.label)} <small>${t.stored}</small>`, t.ready)).join("");
}

function pvRender(data) {
  pvLastData = data;
  pvRenderTabs(data);
  const tab = pvEditionTab();
  const allRows = pvCurrentRows();
  pvRenderExtSelect(allRows);
  const rows = pvApplyView(allRows);
  const complete = allRows.filter((r) => r.complete).length;
  document.getElementById("pv-summary").innerHTML = `
    ${tab ? `<div class="pv-kpi pv-kpi-edition" data-edition="${tab.key}"><strong>${tab.icon}</strong><span>Édition ${escHtml(tab.label)}</span></div>` : ""}
    <div class="pv-kpi"><strong>${allRows.reduce((n, r) => n + r.filled, 0)}</strong><span>cartes protégées</span></div>
    <div class="pv-kpi"><strong>${complete}</strong><span>ligne${complete > 1 ? "s" : ""} complète${complete > 1 ? "s" : ""}</span></div>
    <div class="pv-reward-note">Ligne complète (6 finitions en parfait état${tab ? `, toutes en édition ${escHtml(tab.label)}` : ", sans édition"}) : <strong>${data.boostersPerRow} boosters + ${data.dustPerRow} poussières</strong>${pvUniqueNote(data.unique)}, une seule fois par carte${tab ? " et par édition" : ""}. Les cartes promo ne vont pas au coffre.</div>
  `;
  const box = document.getElementById("pv-rows");
  document.getElementById("pv-toolbar").hidden = allRows.length < 2;
  const allStorable = allRows.flatMap(pvStorable);
  const storeAll = document.getElementById("pv-store-all");
  if (storeAll) { storeAll.hidden = !allStorable.length; storeAll.textContent = `📥 Tout ranger (${allStorable.length})`; storeAll.disabled = false; }
  // Positions avant le rendu, pour faire glisser les lignes qui changent de place.
  const before = new Map([...box.querySelectorAll(".pv-row")].map((el) => [el.dataset.cardId, el.getBoundingClientRect().top]));
  if (!rows.length) {
    box.innerHTML = allRows.length
      ? `<p class="muted">Aucune ligne ne correspond à ce filtre.</p>`
      : tab
        ? `<p class="muted">Aucune carte en édition ${escHtml(tab.label)} en parfait état pour l'instant.</p>`
        : `<p class="muted">Aucune carte en parfait état pour l'instant. Restaure tes cartes (Craft &rarr; Qualité) pour pouvoir les ranger ici.</p>`;
    return;
  }
  // Un titre par extension (lignes completes / total de l'extension dans l'onglet).
  const extStats = new Map();
  allRows.forEach((r) => { const id = pvExtId(r); const e = extStats.get(id) || { n: 0, done: 0, emerald: 0 }; e.n++; if (r.complete) e.done++; if (r.emerald) e.emerald++; extStats.set(id, e); });
  box.innerHTML = rows.map((r, i) => {
    const ready = pvStorable(r);
    const st = extStats.get(pvExtId(r)) || { n: 0, done: 0, emerald: 0 };
    const heading = i === 0 || pvExtId(rows[i - 1]) !== pvExtId(r)
      ? `<h3 class="pv-group pv-ext-group"><span>📦 ${escHtml(r.extension ? r.extension.name : "Hors extension")}</span><small>${st.done}/${st.n} ligne${st.n > 1 ? "s" : ""} complète${st.done > 1 ? "s" : ""}${st.emerald ? ` · 💚 ${st.emerald}` : ""}</small><span class="pv-ext-bar" aria-hidden="true"><span style="width:${st.n ? Math.round((st.done / st.n) * 100) : 0}%"></span></span></h3>` : "";
    const color = r.rarity?.colorHex || "#9aa0b4";
    const img = API.imageUrl(r.imageId) || "";
    const slots = PV_FINISHES.map((f) => {
      const slot = r.slots.find((s) => s.finish === f) || { candidates: [] };
      if (slot.stored) {
        // Meme rendu que les vignettes de la collection (.collection-card +
        // data-finish/data-quality) : on recupere les effets de finition et
        // les etiquettes existants.
        return `<div class="pv-slot filled" data-finish="${f}">
          <div class="collection-card pv-mini" data-rarity="${r.rarity?.key || "commune"}" data-finish="${f}" data-quality="mint"${tab ? ` data-edition="${tab.key}"` : ""} data-zoom="${r.cardId}" data-zoom-finish="${f}" role="button" tabindex="0" aria-label="Voir ${escHtml(r.name)} ${PV_FINISH_LABELS[f]} en grand">
            <div class="card-art">
              <img src="${img}" alt="${r.name}" loading="lazy" decoding="async" />
              ${f !== "normal" ? `<span class="finish-indicator" data-finish="${f}">${PV_FINISH_LABELS[f]}</span>` : ""}
              <span class="quality-indicator" data-quality="mint">Parfait état</span>
              ${tab ? editionBadge(tab.key) : ""}
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
    return heading + `<div class="pv-row ${r.complete ? "complete" : ""} ${ready.length ? "can-store" : ""}" data-card-id="${r.cardId}" style="--r:${color}">
      <div class="pv-row-head">
        ${img ? `<img class="pv-row-thumb" src="${img}" alt="" loading="lazy" decoding="async" />` : ""}
        <span class="pv-row-name">${r.name}</span>
        <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">${r.rarity?.name || ""}</span>
        <span class="pv-row-progress">${r.filled}/6 ${r.claimed ? "&#10004; récompense reçue" : ""}</span>
        <span class="pv-row-bar" aria-hidden="true"><span style="width:${Math.round((r.filled / 6) * 100)}%"></span></span>
        ${r.filled || r.emerald ? pvShowcaseBtn(r.cardId) : ""}
        ${ready.length ? `<span class="pv-ready-badge">📥 ${ready.length} à ranger${r.filled + ready.length >= 6 && !r.claimed ? " · ligne complète !" : ""}</span>${ready.length > 1 ? `<button type="button" class="pv-store-row" data-pull-ids="${ready.join(",")}">Tout ranger</button>` : ""}` : ""}
      </div>
      ${preview}
      <div class="pv-row-body"><div class="pv-slots">${slots}</div>${pvEmeraldSlot(r, img, tab)}</div>
    </div>`;
  }).join("");
  if (pvGalleryOpen()) pvRenderGallery();
  // Animation FLIP : chaque ligne glisse de son ancienne place vers la nouvelle.
  if (before.size && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    box.querySelectorAll(".pv-row").forEach((el) => {
      const was = before.get(el.dataset.cardId);
      if (was == null) return;
      const dy = was - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 2) return;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 450, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
  }
}

// Range plusieurs exemplaires d'affilee (bouton d'une ligne ou "Tout ranger").
async function pvStoreMany(pullIds) {
  if (pvBusy || !pullIds.length) return;
  pvBusy = true;
  let data = null, stored = 0;
  const rewards = [];
  try {
    for (const id of pullIds) {
      try { data = await API.personalVault(Session.userId, "store", id); stored++; if (data.reward) rewards.push(data.reward); }
      catch (e) { if (!["pull_not_owned", "slot_filled", "already_stored", "not_mint"].includes(e.code)) throw e; }
    }
  } catch (e) {
    Toast.error(PV_ERRORS[e.code] || friendlyError(e));
  } finally {
    pvBusy = false;
  }
  if (data) pvRender(data);
  if (stored) Toast.success(`📥 ${stored} carte${stored > 1 ? "s" : ""} rangée${stored > 1 ? "s" : ""} au coffre.`);
  rewards.forEach((r) => {
    pvSealRow(r.cardId);
    Toast.success(`Ligne ${r.cardName}${r.edition && EDITIONS[r.edition] ? " " + EDITIONS[r.edition].label : ""} complète ! +${r.boosters} boosters, +${r.dust} poussières${r.ticket ? ", un Ticket Unique 🎫" : ""}${r.emerald ? " et la carte émeraude 💚" : ""}.`);
  });
  if (rewards.length) {
    if (typeof loadNavBadges === "function") loadNavBadges();
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    pvLoadCounter(rewards.some((r) => r.ticket) ? "new" : null);
  }
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
          <div class="card-art"><img src="${img}" alt="${c.owned ? c.name : "Carte Unique à obtenir : " + c.name}" loading="lazy" decoding="async" /></div>
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
    Toast.error({ no_ticket: "Tu n'as pas de Ticket Unique.", already_owned: "Tu as déjà cette carte.", not_unique_card: "Cette carte n'est pas au comptoir." }[e.code] || friendlyError(e));
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
    // Cartes emeraude des lignes completees avant leur arrivee (rattrapage).
    if (data.emeraldGrants && data.emeraldGrants.length) {
      const n = data.emeraldGrants.length;
      Toast.success(`💚 ${n} carte${n > 1 ? "s" : ""} émeraude ajoutée${n > 1 ? "s" : ""} au coffre pour tes lignes déjà complètes : ${data.emeraldGrants.slice(0, 4).map((g) => escHtml(g.cardName)).join(", ")}${n > 4 ? "…" : ""}`);
    }
    if (action === "store") Toast.success("Carte rangée au coffre : elle est protégée.");
    if (action === "withdraw") Toast.info("Carte retirée du coffre : elle revient dans ta collection.");
    if (data.reward) {
      pvSealRow(data.reward.cardId);
      Toast.success(`Ligne ${data.reward.cardName}${data.reward.edition && EDITIONS[data.reward.edition] ? " " + EDITIONS[data.reward.edition].label : ""} complète ! +${data.reward.boosters} boosters, +${data.reward.dust} poussières${data.reward.ticket ? ", un Ticket Unique 🎫" : ""}${data.reward.emerald ? " et la carte émeraude 💚" : ""}.`);
      if (typeof loadNavBadges === "function") loadNavBadges();
    }
    pvLoadCounter(data.reward && data.reward.ticket ? "new" : null);
    if (data.reward && typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error(PV_ERRORS[e.code] || friendlyError(e));
  } finally {
    pvBusy = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("pv-guest").style.display = "block";
    return;
  }
  document.getElementById("pv-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pv-tab]");
    if (!b || b.dataset.pvTab === pvTab) return;
    pvTab = b.dataset.pvTab;
    try { localStorage.setItem(PV_TAB_KEY, pvTab); } catch (err) { /* stockage indisponible */ }
    if (pvLastData) pvRender(pvLastData);
  });
  document.getElementById("pv-rows").addEventListener("click", (e) => {
    if (pvCardClick(e)) return;
    const store = e.target.closest(".pv-store");
    const withdraw = e.target.closest(".pv-withdraw");
    const row = e.target.closest(".pv-store-row");
    if (row) { row.disabled = true; pvStoreMany(row.dataset.pullIds.split(",").map(Number)); return; }
    if (store) pvLoad("store", Number(store.dataset.pullId));
    else if (withdraw) pvLoad("withdraw", Number(withdraw.dataset.pullId));
  });
  const view = pvView();
  document.getElementById("pv-sort").value = view.sort;
  document.getElementById("pv-filter").value = view.filter;
  // Menus stylises comme sur le reste du site (2026-10-21).
  enhanceSelect(document.getElementById("pv-sort"));
  enhanceSelect(document.getElementById("pv-filter"));
  enhanceSelect(document.getElementById("pv-ext"));
  document.getElementById("pv-search").addEventListener("input", () => { if (pvLastData) pvRender(pvLastData); });
  ["pv-sort", "pv-filter", "pv-ext"].forEach((id) => document.getElementById(id).addEventListener("change", () => {
    try { localStorage.setItem(PV_VIEW_KEY, JSON.stringify({ sort: document.getElementById("pv-sort").value, filter: document.getElementById("pv-filter").value, ext: document.getElementById("pv-ext").value })); } catch (e) {}
    if (pvLastData) pvRender(pvLastData);
  }));
  document.getElementById("pv-store-all").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const ids = pvCurrentRows().flatMap(pvStorable);
    if (!ids.length) return;
    if (ids.length > 3 && !(await Confirm.show(`Ranger d'un coup les ${ids.length} cartes en parfait état qui ont une place libre au coffre ? Elles y seront protégées (tu peux les retirer quand tu veux).`, { title: "Tout ranger", confirmText: "Tout ranger" }))) return;
    btn.disabled = true;
    pvStoreMany(ids);
  });
  document.getElementById("pv-counter-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".pv-redeem");
    if (btn) pvRedeem(Number(btn.dataset.cardId));
  });
  document.getElementById("pv-rows").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-zoom]")) { e.preventDefault(); pvCardClick(e); } });
  const gal = document.getElementById("pv-gallery");
  if (gal) {
    gal.addEventListener("click", (e) => {
      if (pvCardClick(e)) return;
      const chip = e.target.closest("[data-gal-finish]");
      if (chip) { pvGallery.finish = chip.dataset.galFinish; pvRenderGallery(); return; }
      if (e.target.closest("[data-gal-order]")) { pvOrderShowcase(); return; }
      const sh = e.target.closest("[data-gal-share]");
      if (sh) { sh.disabled = true; LazyJs.load("js/lazy/share-studio.js").then(() => ShareStudio.vault(pvGalleryShare())).catch(() => Toast.error("Partage indisponible pour le moment.")).finally(() => { sh.disabled = false; }); }
    });
    gal.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-zoom]")) { e.preventDefault(); pvCardClick(e); } });
    gal.addEventListener("change", (e) => { if (e.target.id === "gal-sort") { pvGallery.sort = e.target.value; pvRenderGallery(); } });
  }
  API.listShowcase(Session.userId).then((r) => { pvShowcase = new Set((r.showcase || []).map((s) => s.cardId)); pvSyncShowcaseBtns(); }).catch(() => {});
  pvLoad("status");
});

// ------------------------------------------------------------------ vitrine du profil
// La vitrine ne garde que la carte (pas l'exemplaire) ; le serveur compte les
// exemplaires du coffre comme possedes, une carte rangee peut donc y aller.
let pvShowcase = new Set();
function pvShowcaseBtn(cardId) {
  const on = pvShowcase.has(cardId);
  return `<button type="button" class="pv-showcase-btn ${on ? "on" : ""}" data-showcase="${cardId}" aria-pressed="${on}" title="${on ? "Retirer de la vitrine de ton profil" : "Mettre en vitrine sur ton profil"}">&#128444;&#65039; ${on ? "En vitrine" : "Vitrine"}</button>`;
}
function pvSyncShowcaseBtns() {
  document.querySelectorAll("[data-showcase]").forEach((b) => {
    const on = pvShowcase.has(Number(b.dataset.showcase));
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
    b.title = on ? "Retirer de la vitrine de ton profil" : "Mettre en vitrine sur ton profil";
    if (!b.classList.contains("icon-only")) b.innerHTML = `&#128444;&#65039; ${on ? "En vitrine" : "Vitrine"}`;
  });
  const k = document.getElementById("gal-showcase-n");
  if (k) k.textContent = pvShowcase.size;
}
async function pvToggleShowcase(cardId, btn) {
  const was = pvShowcase.has(cardId);
  btn.disabled = true;
  try {
    if (was) { await API.removeFromShowcase(Session.userId, cardId); pvShowcase.delete(cardId); Toast.info("Retirée de ta vitrine."); }
    else if (pvShowcase.size >= 6) {
      // Vitrine pleine : on choisit la carte a remplacer (js/lazy/showcase.js).
      await LazyJs.load("js/lazy/showcase.js");
      const row = pvCopiesOf(cardId).row;
      const r = await ShowcaseKit.add(cardId, row && row.name);
      if (!r) return;
      pvShowcase = new Set(r.items.map((c) => c.cardId));
      Toast.success("Ajoutée à ta vitrine à la place d'une autre.");
    } else { await API.addToShowcase(Session.userId, cardId); pvShowcase.add(cardId); Toast.success(`Ajoutée à ta vitrine (${pvShowcase.size}/6) : elle s'affiche sur ton profil avec sa plus belle finition.`); }
    pvSyncShowcaseBtns();
  } catch (e) {
    Toast.error(PV_ERRORS[e.code] || friendlyError(e));
  } finally { btn.disabled = false; }
}

async function pvOrderShowcase() {
  try {
    await LazyJs.load("js/lazy/showcase.js");
    const items = await ShowcaseKit.list();
    if (items.length < 2) { Toast.info(items.length ? "Une seule carte en vitrine : rien à ordonner." : "Ta vitrine est vide : 🖼️ sur une carte pour l'y mettre."); return; }
    const fresh = await ShowcaseKit.editOrder(items);
    if (fresh) pvShowcase = new Set(fresh.map((c) => c.cardId));
  } catch (e) { Toast.error(friendlyError(e)); }
}
// Donnees de l'image "Salle des tresors" (share-studio.js).
function pvGalleryShare() {
  const items = pvGalleryItems().sort((a, b) => PV_PRESTIGE.indexOf(b.finish) - PV_PRESTIGE.indexOf(a.finish) || (b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0));
  return {
    pseudo: Session.pseudo || "",
    total: items.length,
    emeralds: items.filter((it) => it.finish === "emerald").length,
    firsts: items.filter((it) => it.serial === 1).length,
    lines: pvLastData ? [pvLastData.rows || [], ...(pvLastData.editions || []).map((t) => t.rows || [])].flat().filter((r) => r.complete).length : 0,
    cards: items.slice(0, 9).map((it) => ({ cardId: it.cardId, name: it.name, imageId: it.imageId, rarity: it.rarity, extension: it.extension, finish: it.finish, quality: "mint", edition: it.edition, serial: it.serial }))
  };
}

// ------------------------------------------------------------------ zoom
// Toutes les cartes rangees d'une carte (onglets d'edition compris).
function pvCopiesOf(cardId) {
  if (!pvLastData) return { row: null, list: [] };
  let row = null;
  const list = [];
  const scan = (rows, edition) => (rows || []).forEach((r) => {
    if (r.cardId !== cardId) return;
    row = row || r;
    r.slots.forEach((s) => { if (s.stored) list.push({ finish: s.finish, quality: "mint", edition, serial: s.stored.serialNumber, count: 1 }); });
    if (r.emerald) list.push({ finish: "emerald", quality: "mint", edition, serial: r.emerald.serialNumber, count: 1 });
  });
  scan(pvLastData.rows, "");
  (pvLastData.editions || []).forEach((t) => scan(t.rows, t.key));
  return { row, list };
}
function pvCardClick(e) {
  const sc = e.target.closest("[data-showcase]");
  if (sc) { pvToggleShowcase(Number(sc.dataset.showcase), sc); return true; }
  const z = e.target.closest("[data-zoom]");
  if (!z) return false;
  const cardId = Number(z.dataset.zoom);
  const { row, list } = pvCopiesOf(cardId);
  if (!row) return true;
  LazyJs.load("js/lazy/card-inspector.js")
    .then(() => CardInspector.open({ card: { cardId, name: row.name, imageId: row.imageId, rarity: row.rarity }, finish: z.dataset.zoomFinish || "normal", quality: "mint", edition: z.dataset.edition || "", variants: list }))
    .catch(() => Toast.error("Inspecteur indisponible pour le moment."));
  return true;
}

// ------------------------------------------------------------------ presentoir
// Vue "Presentoir" : chaque carte rangee sur son socle, sous un projecteur,
// les emeraudes (maitrises) en tete dans leur propre vitrine.
const PV_PRESTIGE = ["normal", "holo", "gold", "ghost", "diamond", "rainbow", "emerald"];
const pvGallery = { finish: "all", sort: "prestige" };
const pvGalleryOpen = () => { const v = document.getElementById("gallery-view"); return !!v && !v.hidden; };
function pvGalleryItems() {
  if (!pvLastData) return [];
  const items = [];
  const scan = (rows, tab) => (rows || []).forEach((r) => {
    const base = { cardId: r.cardId, name: r.name, imageId: r.imageId, rarity: r.rarity, extension: r.extension, edition: tab ? tab.key : "" };
    r.slots.forEach((s) => { if (s.stored) items.push({ ...base, finish: s.finish, serial: s.stored.serialNumber }); });
    if (r.emerald) items.push({ ...base, finish: "emerald", serial: r.emerald.serialNumber });
  });
  scan(pvLastData.rows, null);
  (pvLastData.editions || []).forEach((t) => scan(t.rows, t));
  return items;
}
function pvPedestal(it, big) {
  const color = it.rarity?.colorHex || "#9aa0b4";
  const img = API.imageUrl(it.imageId) || "";
  const ed = it.edition && EDITIONS[it.edition];
  const on = pvShowcase.has(it.cardId);
  return `<figure class="gal-item ${big ? "big" : ""}" data-finish="${it.finish}" style="--r:${color}">
    <span class="gal-spot" aria-hidden="true"></span>
    <div class="collection-card gal-card" data-rarity="${it.rarity?.key || "commune"}" data-finish="${it.finish}" data-quality="mint"${it.edition ? ` data-edition="${it.edition}"` : ""} data-zoom="${it.cardId}" data-zoom-finish="${it.finish}" role="button" tabindex="0" aria-label="Voir ${escHtml(it.name)} ${PV_FINISH_LABELS[it.finish]} en grand">
      <div class="card-art">
        <img src="${img}" alt="" loading="lazy" decoding="async" />
        ${it.finish !== "normal" ? `<span class="finish-indicator" data-finish="${it.finish}">${PV_FINISH_LABELS[it.finish]}</span>` : ""}
        ${it.edition ? editionBadge(it.edition) : ""}
        ${it.serial === 1 ? `<span class="serial-one-badge" title="Premier exemplaire en circulation">#001</span>` : ""}
      </div>
    </div>
    <span class="gal-base" aria-hidden="true"></span>
    <figcaption class="gal-plaque">
      <strong>${escHtml(it.name)}</strong>
      <small><span style="color:${rarityTextColor(color)}">${escHtml(it.rarity?.name || "")}</span> · ${PV_FINISH_LABELS[it.finish]} ${pvSerial(it.serial)}${ed ? ` · ${ed.icon} ${escHtml(ed.label)}` : ""}</small>
      <button type="button" class="pv-showcase-btn icon-only ${on ? "on" : ""}" data-showcase="${it.cardId}" aria-pressed="${on}" title="${on ? "Retirer de la vitrine de ton profil" : "Mettre en vitrine sur ton profil"}">&#128444;&#65039;</button>
    </figcaption>
  </figure>`;
}
function pvRenderGallery() {
  const box = document.getElementById("pv-gallery");
  if (!box) return;
  if (!pvLastData) { box.innerHTML = `<p class="muted">Chargement…</p>`; return; }
  const all = pvGalleryItems();
  if (!all.length) { box.innerHTML = `<div class="gal-empty"><span aria-hidden="true">&#128142;</span><p>Le présentoir est vide. Range des cartes en parfait état au coffre-fort : elles seront exposées ici.</p></div>`; return; }
  const count = (f) => all.filter((it) => it.finish === f).length;
  const finishes = PV_PRESTIGE.slice().reverse().filter((f) => count(f));
  if (pvGallery.finish !== "all" && !count(pvGallery.finish)) pvGallery.finish = "all";
  const rank = (it) => PV_PRESTIGE.indexOf(it.finish);
  const sorters = {
    prestige: (a, b) => rank(b) - rank(a) || (b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0) || a.name.localeCompare(b.name),
    rarity: (a, b) => (b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0) || rank(b) - rank(a) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name) || rank(b) - rank(a)
  };
  const list = all.filter((it) => pvGallery.finish === "all" || it.finish === pvGallery.finish).sort(sorters[pvGallery.sort] || sorters.prestige);
  const emeralds = pvGallery.finish === "all" ? list.filter((it) => it.finish === "emerald") : [];
  const rest = pvGallery.finish === "all" ? list.filter((it) => it.finish !== "emerald") : list;
  const firsts = all.filter((it) => it.serial === 1).length;
  const nEm = count("emerald");
  box.innerHTML = `
    <div class="gal-hall">
      <header class="gal-head">
        <div><h2>&#128142; Salle des trésors</h2><p class="muted">Tes cartes les plus précieuses, à l'abri derrière la vitre. Touche une carte pour l'examiner de près ; &#128444;&#65039; la met en vitrine sur ton profil.</p></div>
        <div class="gal-kpis">
          <span><strong>${all.length}</strong> carte${all.length > 1 ? "s" : ""}</span>
          <span><strong>${nEm}</strong> maîtrise${nEm > 1 ? "s" : ""} &#128154;</span>
          ${firsts ? `<span><strong>${firsts}</strong> #001</span>` : ""}
          <button type="button" class="gal-kpi-btn" data-gal-order title="Ordonner la vitrine de ton profil"><strong id="gal-showcase-n">${pvShowcase.size}</strong>/6 en vitrine · ↕️</button>
          <button type="button" class="gal-kpi-btn" data-gal-share title="Image de ta salle des trésors à partager">&#128228; Partager</button>
        </div>
      </header>
      <div class="gal-bar">
        <div class="gal-chips" role="group" aria-label="Finition">
          <button type="button" class="gal-chip ${pvGallery.finish === "all" ? "on" : ""}" data-gal-finish="all" aria-pressed="${pvGallery.finish === "all"}">Tout <b>${all.length}</b></button>
          ${finishes.map((f) => `<button type="button" class="gal-chip ${pvGallery.finish === f ? "on" : ""}" data-gal-finish="${f}" data-finish="${f}" aria-pressed="${pvGallery.finish === f}">${PV_FINISH_LABELS[f]} <b>${count(f)}</b></button>`).join("")}
        </div>
        <label class="gal-sort">Trier <select id="gal-sort">
          <option value="prestige" ${pvGallery.sort === "prestige" ? "selected" : ""}>Prestige</option>
          <option value="rarity" ${pvGallery.sort === "rarity" ? "selected" : ""}>Rareté</option>
          <option value="name" ${pvGallery.sort === "name" ? "selected" : ""}>Nom</option>
        </select></label>
      </div>
      ${emeralds.length ? `<section class="gal-case gal-emeralds" aria-label="Maîtrises"><h3>&#128154; Maîtrises <small>six finitions réunies : la preuve qu'on a dompté la carte</small></h3><div class="gal-shelf">${emeralds.map((it) => pvPedestal(it, true)).join("")}</div></section>` : ""}
      ${rest.length ? `<section class="gal-case" aria-label="Vitrine"><div class="gal-shelf">${rest.map((it) => pvPedestal(it, false)).join("")}</div></section>` : ""}
    </div>`;
  if (window.CardTilt) box.querySelectorAll(".gal-card").forEach((c) => CardTilt.attach(c));
}
window.pvRenderGallery = pvRenderGallery;
