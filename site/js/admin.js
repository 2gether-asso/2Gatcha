// Page admin : codes, dons, economie, evenements, contenu, reglages, site.
// Navigation et chargement paresseux des rubriques : admin-nav.js. Vue
// d'ensemble : admin-home.js. Planning des evenements : admin-events.js.
// Protection reelle cote API (les routes verifient Session.discordId) ; cote
// site on se contente de cacher la page si l'appel renvoie "forbidden".

const STATUS_LABELS = {
  active: "Actif",
  expired: "Expire",
  exhausted: "Épuisé",
  disabled: "Désactivé"
};

let cardsCatalog = [];
// Cartes proposees dans les choix de recompense (codes, marche noir, niveaux,
// bingo, saison) : jamais les cartes Unique, reservees au coffre-fort perso.
const pickableCards = () => cardsCatalog.filter((c) => c.rarity?.key !== "unique");
let codesCache = [];
let calendarView = false;

function formatExpiry(epochSeconds) {
  if (!epochSeconds) return "-";
  return new Date(epochSeconds * 1000).toLocaleString("fr-FR");
}

function renderCodesTable(codes) {
  const tbody = document.getElementById("codes-tbody");
  if (!codes.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Aucun code créé pour l'instant.</td></tr>`;
    return;
  }
  tbody.innerHTML = codes.map((c) => {
    const reward = c.rewardType === "card"
      ? `Carte #${c.cardId} x${c.quantity}`
      : `${c.quantity} booster${c.quantity > 1 ? "s" : ""} (générique)`;
    const used = c.maxRedemptions ? `${c.used} / ${c.maxRedemptions}` : `${c.used} / illimite`;
    const canRevoke = c.active;
    return `
      <tr data-status="${c.status}">
        <td><code>${c.code}</code>${c.label ? `<div class="table-sub">${c.label}</div>` : ""}</td>
        <td>${c.label || "-"}</td>
        <td>${reward}</td>
        <td>${used}</td>
        <td>${formatExpiry(c.expiresAt)}</td>
        <td><span class="trade-status">${STATUS_LABELS[c.status] || c.status}</span></td>
        <td>${canRevoke ? `<button class="btn-ghost revoke-btn" data-code="${c.code}">Revoquer</button>` : ""}</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".revoke-btn").forEach((btn) => {
    btn.addEventListener("click", () => revokeCode(btn.dataset.code));
  });
}

function renderCodesCalendar(codes) {
  const el = document.getElementById("codes-calendar");
  if (!el) return;
  if (!codes.length) {
    el.innerHTML = `<div class="empty-state">Aucun code créé pour l'instant.</div>`;
    return;
  }
  const byDay = new Map();
  codes.forEach((c) => {
    const day = c.expiresAt ? new Date(c.expiresAt * 1000).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "Sans expiration";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(c);
  });
  el.innerHTML = [...byDay.entries()].map(([day, dayCodes]) => `
    <div class="codes-calendar-day">
      <div class="day-label">${day}</div>
      <div class="day-codes">
        ${dayCodes.map((c) => `
          <div class="day-code-row">
            <span><code>${c.code}</code> ${c.label ? "&middot; " + c.label : ""}</span>
            <span class="trade-status">${STATUS_LABELS[c.status] || c.status}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");
}

function renderCodes() {
  renderCodesTable(codesCache);
  renderCodesCalendar(codesCache);
  document.getElementById("codes-table").style.display = calendarView ? "none" : "";
  document.getElementById("codes-calendar").style.display = calendarView ? "flex" : "none";
}

async function loadCodes() {
  const loading = document.getElementById("codes-loading");
  if (loading) loading.style.display = "flex";
  try {
    const res = await API.adminListCodes(Session.discordId);
    codesCache = res.codes || [];
    renderCodes();
  } finally {
    if (loading) loading.style.display = "none";
  }
}

async function revokeCode(code) {
  const ok = await Confirm.show(`Le code <strong>${code}</strong> ne pourra plus être réclamé par personne.`, {
    title: "Révoquer ce code ?",
    confirmText: "Révoquer",
    dangerous: true
  });
  if (!ok) return;
  try {
    await API.adminRevokeCode(Session.discordId, code);
    Toast.info(`Code ${code} révoqué.`);
    loadCodes();
  } catch (e) {
    Toast.error("Impossible de révoquer ce code. (" + e.message + ")");
  }
}

function updateCardFieldVisibility() {
  const isCard = document.getElementById("reward-type-select").value === "card";
  document.getElementById("card-select-label").style.display = isCard ? "block" : "none";
  if (isCard) updateCardPreview();
}

function updateCardPreview() {
  const preview = document.getElementById("card-select-preview");
  const select = document.getElementById("card-select");
  if (!preview || !select) return;
  const card = cardsCatalog.find((c) => String(c.cardId) === select.value);
  const src = card && API.imageUrl(card.imageId);
  preview.src = src || PLACEHOLDER_IMG;
  preview.style.display = "block";
}

async function loadCardOptions() {
  const res = await API.getCards();
  cardsCatalog = res.cards || [];
  document.getElementById("card-select").innerHTML = pickableCards()
    .map((c) => `<option value="${c.cardId}">${c.name}${c.isPromo ? " (promo)" : ""}</option>`)
    .join("");
}

// -----------------------------------------------------------------------
// Don a un joueur : carte (avec finition/qualité choisies), booster(s) ou
// poussières - pratique pour compenser un bug ou recompenser un joueur sans
// devoir passer par un code d'evenement a usage generique.
// -----------------------------------------------------------------------
async function loadGiftUserOptions() {
  const select = document.getElementById("gift-user-select");
  try {
    const res = await API.listUsers();
    const users = (res.users || []).slice().sort((a, b) => (a.pseudo || "").localeCompare(b.pseudo || ""));
    select.innerHTML = users.map((u) => `<option value="${u.userId}">${u.pseudo}</option>`).join("") || `<option value="">Aucun joueur</option>`;
  } catch (e) {
    select.innerHTML = `<option value="">Impossible de charger les joueurs</option>`;
  }
}

function populateGiftCardSelect() {
  // Un don admin doit pouvoir cibler N'IMPORTE QUELLE carte, promo ou
  // secrete incluses (contrairement aux codes d'evenement/au craft normal
  // qui les excluent) : c'est justement l'outil a utiliser pour offrir une
  // carte secrete a un joueur sans lui faire chercher le Konami code.
  document.getElementById("gift-card-select").innerHTML = cardsCatalog
    .map((c) => `<option value="${c.cardId}">${c.name}${c.rarity?.key === "unique" ? " (unique)" : c.isSecret ? " (secrète)" : c.isPromo ? " (promo)" : ""}</option>`)
    .join("");
}

function updateGiftCardPreview() {
  const preview = document.getElementById("gift-card-preview");
  const select = document.getElementById("gift-card-select");
  const card = cardsCatalog.find((c) => String(c.cardId) === select.value);
  preview.src = (card && API.imageUrl(card.imageId)) || PLACEHOLDER_IMG;
  preview.style.display = "block";
}

function updateGiftFieldVisibility() {
  const isCard = document.getElementById("gift-type-select").value === "card";
  document.getElementById("gift-card-label").style.display = isCard ? "block" : "none";
  document.getElementById("gift-finish-label").style.display = isCard ? "block" : "none";
  document.getElementById("gift-quality-label").style.display = isCard ? "block" : "none";
  if (isCard) updateGiftCardPreview();
}

// Genere un QR code pointant vers redeem.html avec le code pre-rempli
// (scan -> arrivee directe sur la page de reclamation).
function renderCodeQr(code) {
  const zone = document.getElementById("created-zone");
  if (typeof QRCode === "undefined" || !zone) return;
  const url = window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "redeem.html?code=" + encodeURIComponent(code);
  const box = document.createElement("div");
  box.className = "qr-box";
  const canvas = document.createElement("canvas");
  box.appendChild(canvas);
  const caption = document.createElement("span");
  caption.className = "qr-caption";
  caption.textContent = code;
  box.appendChild(caption);
  zone.appendChild(box);
  QRCode.toCanvas(canvas, url, { width: 160, margin: 1 }, (err) => {
    if (err) box.remove();
  });
}

function renderRarityChart(rarities) {
  const el = document.getElementById("rarity-chart");
  if (!el) return;
  if (!rarities || !rarities.length) {
    el.innerHTML = `<div class="empty-state">Pas encore de tirage.</div>`;
    return;
  }
  const max = Math.max(1, ...rarities.map((r) => r.count));
  el.innerHTML = rarities.map((r) => `
    <div class="bar-col">
      <span class="bar-value">${r.count}</span>
      <div class="bar-fill" style="height:${(r.count / max) * 100}%;background:${r.colorHex || "#9aa0b4"};"></div>
      <span class="bar-label" style="color:${r.colorHex || "#9aa0b4"};">${r.name}</span>
    </div>
  `).join("");
}

function renderRetentionStats(retention) {
  const el = document.getElementById("retention-stats");
  if (!el) return;
  if (!retention) { el.innerHTML = `<div class="empty-state">Pas encore de données.</div>`; return; }
  el.innerHTML = `
    <div class="stat-tile"><div class="stat-value">${retention.totalUsers}</div><div class="stat-label">Comptes créés</div></div>
    <div class="stat-tile"><div class="stat-value">${retention.active7}</div><div class="stat-label">Actifs sur 7 jours</div></div>
    <div class="stat-tile"><div class="stat-value">${retention.active30}</div><div class="stat-label">Actifs sur 30 jours</div></div>
  `;
}

async function loadStats() {
  try {
    const res = await API.adminGetStats(Session.discordId);
    renderRarityChart(res.rarities || []);
    renderRetentionStats(res.retention);
  } catch (e) {
    // Non bloquant : le graphique est secondaire par rapport a la gestion des codes.
  }
}

// Aperçu de la banniere de recompense telle qu'elle apparaitra une fois le
// code créé, mise a jour en direct pendant la saisie du formulaire.
function updateRewardPreview() {
  const preview = document.getElementById("reward-preview");
  if (!preview) return;
  const rewardType = document.getElementById("reward-type-select").value;
  const quantity = Number(document.getElementById("quantity-input").value) || 1;
  let text;
  if (rewardType === "card") {
    const card = cardsCatalog.find((c) => String(c.cardId) === document.getElementById("card-select").value);
    text = `+${quantity} exemplaire${quantity > 1 ? "s" : ""} de ${card ? card.name : "..."}`;
  } else {
    text = `+${quantity} booster${quantity > 1 ? "s" : ""}`;
  }
  preview.style.display = "block";
  preview.textContent = `Aperçu : ${text}`;
}

// --- Équilibrage du jeu (pity, raretés, finitions, quêtes, fouille) ---
let balanceRaritiesCache = [];
let balanceFinishesCache = [];
let balanceQualitiesCache = [];

async function loadConfig() {
  const res = await API.adminGetConfig(Session.discordId);
  const raritySelect = document.getElementById("top-rarity-select");
  raritySelect.innerHTML = (res.rarities || [])
    .map((r) => `<option value="${r.key}" ${res.topRarity && res.topRarity.key === r.key ? "selected" : ""}>${r.name}</option>`)
    .join("");
  document.getElementById("pity-threshold-input").value = res.pityThreshold || "";
  document.getElementById("dig-max-energy-input").value = res.digMaxEnergy || 5;
  document.getElementById("daily-threshold-input").value = res.dailyQuestThreshold || 2;
  document.getElementById("weekly-threshold-input").value = res.weeklyQuestThreshold || 3;
  document.getElementById("weekly-target-input").value = res.weeklyQuestTarget || 5;
  document.getElementById("quality-repair-cost-input").value = res.qualityRepairCost || 3;
  document.getElementById("banner-enabled-input").checked = !!res.bannerEnabled;
  document.getElementById("banner-type-select").value = res.bannerType || "info";
  document.getElementById("banner-message-input").value = res.bannerMessage || "";
  document.getElementById("maintenance-enabled-input").checked = !!res.maintenanceMode;
  document.getElementById("unlock-craft-input").value = res.featureUnlockCraft || 2;
  document.getElementById("unlock-trade-input").value = res.featureUnlockTrade || 3;
  document.getElementById("unlock-altar-input").value = res.featureUnlockAltar || 4;
  document.getElementById("unlock-quality-input").value = res.featureUnlockQuality || 4;
  document.getElementById("unlock-finish-input").value = res.featureUnlockFinish || 5;
  document.getElementById("unlock-showcase-input").value = res.featureUnlockShowcase || 6;
  document.getElementById("unlock-theme-monochrome-input").value = res.themeUnlockMonochrome || 3;
  document.getElementById("unlock-theme-sepia-input").value = res.themeUnlockSepia || 5;
  document.getElementById("unlock-theme-cyberpunk-input").value = res.themeUnlockCyberpunk || 8;
  document.getElementById("unlock-sleeve-neon-input").value = res.sleeveUnlockNeon || 4;
  document.getElementById("unlock-sleeve-vintage-input").value = res.sleeveUnlockVintage || 6;
  document.getElementById("unlock-sleeve-carbone-input").value = res.sleeveUnlockCarbone || 10;

  balanceRaritiesCache = res.rarities || [];
  balanceFinishesCache = res.finishes || [];
  balanceQualitiesCache = res.qualities || [];
  renderBalanceRarities();
  renderBalanceFinishes();
  renderBalanceQualities();
}

function renderBalanceRarities() {
  const el = document.getElementById("balance-rarities-table");
  el.innerHTML = `
    <div class="balance-row balance-head">
      <span>Rareté</span><span>Poids de tirage</span><span>Décraft (poussières)</span><span>Craft (poussières)</span><span></span>
    </div>
  ` + balanceRaritiesCache.map((r) => `
    <div class="balance-row" data-rarity-id="${r.id}">
      <span class="balance-row-label">${r.name}</span>
      <input type="number" min="0" step="0.1" data-field="weight" value="${r.weight}" />
      <input type="number" min="0" data-field="disenchantValue" value="${r.disenchantValue}" />
      <input type="number" min="0" data-field="craftCost" value="${r.craftCost}" />
      <button type="button" class="btn-ghost balance-save-btn" data-id="${r.id}">Enregistrer</button>
    </div>
  `).join("");
}

function renderBalanceFinishes() {
  const el = document.getElementById("balance-finishes-table");
  el.innerHTML = `
    <div class="balance-row balance-head">
      <span>Finition</span><span>Poids (parmi les spéciales)</span><span>Multiplicateur décraft</span><span></span>
    </div>
  ` + balanceFinishesCache.filter((f) => f.key !== "normal").map((f) => `
    <div class="balance-row" data-finish-id="${f.id}">
      <span class="balance-row-label">${f.name}</span>
      <input type="number" min="0" step="0.1" data-field="dropWeight" value="${f.dropWeight}" />
      <input type="number" min="0" step="0.1" data-field="disenchantMultiplier" value="${f.disenchantMultiplier}" />
      <button type="button" class="btn-ghost balance-save-btn" data-id="${f.id}">Enregistrer</button>
    </div>
  `).join("");
}

function renderBalanceQualities() {
  const el = document.getElementById("balance-qualities-table");
  el.innerHTML = `
    <div class="balance-row balance-head">
      <span>Qualité</span><span>Poids de tirage</span><span>Multiplicateur décraft</span><span></span>
    </div>
  ` + balanceQualitiesCache.map((q) => `
    <div class="balance-row" data-quality-id="${q.id}">
      <span class="balance-row-label">${q.name}</span>
      <input type="number" min="0" step="0.1" data-field="dropWeight" value="${q.dropWeight}" />
      <input type="number" min="0" step="0.1" data-field="disenchantMultiplier" value="${q.disenchantMultiplier}" />
      <button type="button" class="btn-ghost balance-save-btn" data-id="${q.id}">Enregistrer</button>
    </div>
  `).join("");
}

// --- Gestion des extensions ---
async function loadExtensionsAdmin() {
  const res = await API.getExtensions();
  const extensions = (res.extensions || []).sort((a, b) => a.sortOrder - b.sortOrder);
  const el = document.getElementById("extensions-list");
  if (!extensions.length) {
    el.innerHTML = `<div class="empty-state">Aucune extension pour l'instant.</div>`;
    return;
  }
  el.innerHTML = extensions.map((ext) => `
    <div class="codes-calendar-day">
      <div class="day-label">${ext.name} <span style="color:var(--text-dim);font-weight:500;">(${ext.key})</span></div>
      <div class="day-codes">
        <div class="day-code-row">
          <span>Ordre : ${ext.sortOrder}</span>
          <button type="button" class="btn-ghost ext-toggle-btn" data-ext-id="${ext.id}" data-active="${ext.active}">
            ${ext.active ? "Désactiver" : "Activer"}
          </button>
        </div>
      </div>
    </div>
  `).join("");
  el.querySelectorAll(".ext-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const extensionId = Number(btn.dataset.extId);
      const nextActive = btn.dataset.active !== "true";
      try {
        await API.adminUpdateExtension(Session.discordId, { extensionId, active: nextActive });
        Toast.success(nextActive ? "Extension activee." : "Extension désactivée.");
        API._cacheSet("2gatcha_cache_extensions", null);
        loadExtensionsAdmin();
      } catch (e) {
        Toast.error("Impossible de modifier l'extension. (" + e.message + ")");
      }
    });
  });
}

// -----------------------------------------------------------------------
// Boss communautaire
// -----------------------------------------------------------------------
async function loadBossAdmin() {
  const el = document.getElementById("boss-admin-current");
  try {
    const res = await API.getBossStatus(Session.userId);
    el.innerHTML = res.active
      ? `<strong>${res.bossName}</strong> — ${res.currentHp} / ${res.maxHp} PV (récompense : ${res.rewardBoosters} boosters)`
      : `Aucun boss actif pour l'instant.`;
  } catch (e) {
    el.textContent = "Impossible de charger l'état du boss.";
  }
}

// -----------------------------------------------------------------------
// Marché noir
// -----------------------------------------------------------------------
function populateMarketCardSelect() {
  const select = document.getElementById("market-card-select");
  select.innerHTML = pickableCards()
    .map((c) => `<option value="${c.cardId}">${c.name}${c.isPromo ? " (promo)" : ""}</option>`)
    .join("");
}

function updateMarketCardPreview() {
  const preview = document.getElementById("market-card-preview");
  const select = document.getElementById("market-card-select");
  const card = cardsCatalog.find((c) => String(c.cardId) === select.value);
  preview.src = (card && API.imageUrl(card.imageId)) || PLACEHOLDER_IMG;
  preview.style.display = "block";
}

async function loadMarketAdmin() {
  const el = document.getElementById("market-admin-list");
  try {
    const res = await API.listBlackMarket(Session.userId);
    const offers = res.offers || [];
    el.innerHTML = offers.length ? offers.map((o) => `
      <div class="codes-calendar-day">
        <div class="day-label">${o.card.name}</div>
        <div class="day-codes">
          <div class="day-code-row">
            <span>${o.cost} poussières · ${o.remaining != null ? `${o.remaining} restant(s)` : "illimité"}</span>
          </div>
        </div>
      </div>
    `).join("") : `<div class="empty-state">Aucune offre active pour l'instant.</div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Impossible de charger les offres.</div>`;
  }
}

// -----------------------------------------------------------------------
// Bingo
// -----------------------------------------------------------------------
function populateBingoCardSelects() {
  const container = document.getElementById("bingo-card-selects");
  const options = pickableCards().map((c) => `<option value="${c.cardId}">${c.name}</option>`).join("");
  container.innerHTML = Array.from({ length: 9 }, (_, i) => `
    <label>
      Case ${i + 1}
      <select class="bingo-cell-select" data-index="${i}">${options}</select>
    </label>
  `).join("");
}

function monthKeyOffset(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Autogeneration (2026-10-01) : 9 cartes distinctes tirees au hasard, hors
// promo, secretes et mythiques (trop rares pour une grille a completer en un
// mois). Remplit SEULEMENT le formulaire, cible le mois PROCHAIN : la grille
// en cours, sur laquelle des joueurs progressent deja, n'est jamais touchee
// sans un enregistrement explicite (et confirme, voir le submit).
function autogenerateBingo() {
  const eligible = cardsCatalog.filter((c) => !c.isPromo && !c.isSecret && c.active !== false && (c.rarity?.key || "commune") !== "mythique");
  if (eligible.length < 9) {
    Toast.error(`Pas assez de cartes éligibles (${eligible.length}/9).`);
    return;
  }
  const pool = eligible.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  document.querySelectorAll(".bingo-cell-select").forEach((sel, i) => {
    sel.value = String(pool[i].cardId);
    if (sel._fancyRefresh) sel._fancyRefresh();
  });
  document.getElementById("bingo-month-input").value = monthKeyOffset(1);
  Toast.info("Grille générée pour le mois prochain — vérifie puis enregistre.");
}

// -----------------------------------------------------------------------
// Recompenses de niveau (100 paliers)
// -----------------------------------------------------------------------
async function loadLevelRewardsAdmin() {
  const tbody = document.getElementById("level-rewards-tbody");
  try {
    const res = await API.adminListLevelRewards(Session.discordId);
    const cardOptions = `<option value="">— aucune —</option>` +
      pickableCards().map((c) => `<option value="${c.cardId}">${c.name}</option>`).join("");
    tbody.innerHTML = res.rows.map((r) => `
      <tr data-level="${r.level}" data-row-id="${r.rowId || ""}">
        <td>${r.level}</td>
        <td><input type="number" min="0" class="lvl-dust-input" value="${r.dust || 0}" /></td>
        <td><input type="number" min="0" class="lvl-booster-input" value="${r.booster || 0}" /></td>
        <td><select class="lvl-card-select">${cardOptions}</select></td>
      </tr>
    `).join("");
    tbody.querySelectorAll("tr").forEach((tr) => {
      const level = Number(tr.dataset.level);
      const row = res.rows.find((r) => r.level === level);
      if (row && row.cardId) tr.querySelector(".lvl-card-select").value = String(row.cardId);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4">Erreur de chargement. (${e.message})</td></tr>`;
  }
}

// ---------------------------------------------------------------- reglages
// Reglages avances (api/src/native/settings.js) : formulaire genere depuis le
// registre du serveur, groupe par theme.
let settingsCache = [];
const settingsEscape = escHtml;
// Editeurs en tableaux des reglages JSON (js/json-table.js), par cle.
const settingsJson = {};

function settingInput(s) {
  const id = "setting-" + s.key;
  if (s.type === "bool") return `<label class="checkbox-inline"><input type="checkbox" id="${id}" data-setting="${s.key}" ${s.value ? "checked" : ""} /> activé</label>`;
  if (s.type === "json") return `<div id="${id}" class="json-setting" data-setting="${s.key}"></div>`;
  return `<input type="number" id="${id}" data-setting="${s.key}" value="${s.value}" ${s.min != null ? `min="${s.min}"` : ""} ${s.max != null ? `max="${s.max}"` : ""} step="${s.step || "any"}" />`;
}

function renderSettings(list) {
  settingsCache = list;
  const groups = [];
  list.forEach((s) => { let g = groups.find((x) => x.name === s.group); if (!g) groups.push(g = { name: s.group, items: [] }); g.items.push(s); });
  const zone = document.getElementById("settings-zone");
  zone.className = "";
  zone.innerHTML = groups.map((g) => `
    <div class="settings-group">
      <h3>${settingsEscape(g.name)}</h3>
      <div class="settings-grid">${g.items.map((s) => `
        <div class="setting-field ${s.custom ? "custom" : ""}">
          <label for="setting-${s.key}">${settingsEscape(s.label)}</label>
          ${settingInput(s)}
          <small>${settingsEscape(s.help)}${s.unit ? (s.help ? " · " : "") + settingsEscape(s.unit) : ""} Défaut : ${settingsEscape(s.type === "json" ? "voir « Défaut »" : String(s.def))}.</small>
          ${s.custom ? `<button type="button" class="btn-ghost setting-reset" data-reset-setting="${s.key}">Défaut</button>` : ""}
        </div>`).join("")}
      </div>
    </div>`).join("") + `
    <div class="settings-errors" id="settings-errors"></div>
    <div class="settings-actions"><button type="button" class="btn" id="settings-save-btn">Enregistrer les modifications</button></div>`;
  // Reglages JSON : tableaux editables (JSON brut en secours).
  list.filter((s) => s.type === "json").forEach((s) => {
    const el = document.getElementById("setting-" + s.key);
    if (el && typeof JsonTable !== "undefined") settingsJson[s.key] = JsonTable.mount(el, s.value, s.def);
    else if (el) el.innerHTML = `<textarea data-raw spellcheck="false">${settingsEscape(JSON.stringify(s.value, null, 2))}</textarea>`;
  });
}

async function loadSettings() {
  const zone = document.getElementById("settings-zone");
  try { renderSettings((await API.adminGetSettings(Session.discordId)).settings); }
  catch (e) { zone.className = "empty-state"; zone.textContent = e.code === "forbidden" ? "Accès réservé aux admins." : "Impossible de charger les réglages."; }
}

async function saveSettings() {
  const values = {};
  const errors = [];
  document.querySelectorAll("#settings-zone [data-setting]").forEach((el) => {
    const s = settingsCache.find((x) => x.key === el.dataset.setting);
    if (!s) return;
    let v;
    if (s.type === "bool") v = el.checked;
    else if (s.type === "json") {
      try { v = settingsJson[s.key] ? settingsJson[s.key].get() : JSON.parse(el.querySelector("[data-raw]").value); }
      catch (e) { errors.push(`${s.label} : ${e.message || "JSON invalide"}`); return; }
    }
    else v = Number(el.value);
    if (JSON.stringify(v) !== JSON.stringify(s.value)) values[s.key] = v;
  });
  const errBox = document.getElementById("settings-errors");
  if (errors.length) { errBox.innerHTML = errors.map(settingsEscape).join("<br>"); return; }
  if (!Object.keys(values).length) { Toast.info("Aucune modification."); return; }
  try {
    renderSettings((await API.adminSetSettings(Session.discordId, values)).settings);
    Toast.success(`${Object.keys(values).length} réglage${Object.keys(values).length > 1 ? "s" : ""} enregistré${Object.keys(values).length > 1 ? "s" : ""}.`);
  } catch (e) {
    errBox.innerHTML = ((e.data && e.data.errors) || [e.message]).map(settingsEscape).join("<br>");
    Toast.error("Réglages refusés : corrige les erreurs indiquées.");
  }
}

// ---------------------------------------------------------------- saison
async function loadSeasonAdmin(res) {
  const zone = document.getElementById("season-admin-zone");
  try {
    const data = res || await API.adminGetSeason(Session.discordId);
    const options = (selected) => `<option value="">— aucune (coffre + boosters au dernier palier) —</option>` + pickableCards()
      .map((c) => `<option value="${c.cardId}" ${c.cardId === selected ? "selected" : ""}>${settingsEscape(c.name)}${c.isPromo ? " (promo)" : ""}</option>`).join("");
    zone.className = "";
    zone.innerHTML = data.seasons.map((s, i) => `
      <div class="admin-form season-admin-row">
        <label>${i === 0 ? "Saison en cours" : "Saison suivante"} : ${settingsEscape(s.label)}
          <select data-season-card="${s.season}">${options(s.card ? s.card.cardId : null)}</select>
        </label>
        <button type="button" data-season-save="${s.season}">Enregistrer</button>
      </div>`).join("") + `<p class="lead" style="font-size:0.8rem;">${data.participants} joueur${data.participants > 1 ? "s" : ""} dans la saison en cours.</p>`;
  } catch (e) {
    zone.className = "empty-state";
    zone.textContent = "Impossible de charger la saison.";
  }
}

// ---------------------------------------------------------------- evenement
// Week-end evenement (api/src/native/events.js).
function renderEventAdmin(ev) {
  const el = document.getElementById("event-admin-current");
  const perks = [];
  if (ev.dustMultiplier > 1) perks.push(`poussières x${ev.dustMultiplier}`);
  if (ev.finishMultiplier > 1) perks.push(`finitions x${ev.finishMultiplier}`);
  if (ev.fishingRare > 1) perks.push(`pêche : prises rares x${ev.fishingRare}`);
  if (ev.wormsMultiplier > 1) perks.push(`vers x${ev.wormsMultiplier}`);
  el.className = ev.active ? "reward-banner" : "empty-state";
  el.innerHTML = ev.active
    ? `&#127881; <strong>${ev.label}</strong> en cours${perks.length ? " : " + perks.join(", ") : ""}${ev.endsAt ? " · fin le " + new Date(ev.endsAt * 1000).toLocaleString("fr-FR") : ""}`
    : "Aucun événement en cours.";
  document.getElementById("event-stop-btn").style.display = ev.active ? "" : "none";
}
// Modeles d'evenements (2026-10-05).
const EVENT_PRESETS = {
  stars: { label: "Week-end des étoiles", dust: 2, finish: 1, fishing: 1, worms: 1 },
  fishing: { label: "Semaine de la pêche", dust: 1, finish: 1, fishing: 1.5, worms: 2 },
  worms: { label: "Chasse aux vers", dust: 1, finish: 1, fishing: 1, worms: 3 }
};
function applyEventPreset(key) {
  const p = EVENT_PRESETS[key];
  if (!p) return;
  document.getElementById("event-label").value = p.label;
  document.getElementById("event-dust").value = p.dust;
  document.getElementById("event-finish").value = p.finish;
  document.getElementById("event-fishing").value = p.fishing;
  document.getElementById("event-worms").value = p.worms;
}
async function loadEventAdmin() {
  document.querySelectorAll("[data-event-preset]").forEach((b) => b.addEventListener("click", () => applyEventPreset(b.dataset.eventPreset)));
  try { renderEventAdmin(await API.adminGetEvent(Session.discordId)); } catch (e) { document.getElementById("event-admin-current").textContent = "Impossible de charger l'événement."; }
  // Par defaut : fin dimanche 23:59.
  const ends = document.getElementById("event-ends");
  if (!ends.value) {
    const d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    d.setHours(23, 59, 0, 0);
    ends.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
}

// ---------------------------------------------------------------- economie
// Tableau de bord (api/src/native/economy.js), charge a l'ouverture.
function econBars(days, key, label) {
  const max = Math.max(1, ...days.map((d) => d[key]));
  return `
    <div class="econ-chart">
      <div class="econ-chart-title">${label} <span>(max ${max})</span></div>
      <div class="econ-bars">${days.map((d) => `<span class="econ-bar" style="height:${Math.round((d[key] / max) * 100)}%" title="${new Date(d.day).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} : ${d[key]}"></span>`).join("")}</div>
      <div class="econ-axis"><span>${new Date(days[0].day).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span><span>aujourd'hui</span></div>
    </div>`;
}
// Sante de l'economie : d'ou viennent les boosters crees, par joueur actif et
// par jour, face a la cible (40 a +/- 20 par defaut, reglages BoosterTargetPerDay
// et EconomyAlertBoostersPerPlayer). Les codes de jeu sont exclus du calcul.
function econBoosterSources(f) {
  const excluded = new Set(f.excludedSources || []);
  const counted = f.sources.filter((x) => x.boostersIn > 0 && !excluded.has(x.source));
  const total = counted.reduce((s, x) => s + x.boostersIn, 0);
  if (!total && !f.excludedBoosters) return "";
  const perPlayer = f.boostersPerPlayerDay || 0;
  const t = f.target || { target: 40, low: 20, high: 60 };
  const rows = f.sources.filter((x) => x.boostersIn > 0).sort((a, b) => b.boostersIn - a.boostersIn);
  const max = rows[0].boostersIn;
  const verdict = perPlayer > t.high ? '<strong class="econ-hot">trop généreux</strong>' : perPlayer < t.low ? "(plutôt serré)" : "(dans la cible)";
  return `
    <h3 style="margin-top:20px;">&#129658; D'où viennent les boosters (7 j)</h3>
    <p class="lead" style="font-size:0.82rem;">${perPlayer.toLocaleString("fr-FR")} booster${perPlayer >= 2 ? "s" : ""} créé${perPlayer >= 2 ? "s" : ""} par joueur actif et par jour, hors codes de jeu · cible ${t.target} (${t.low} à ${t.high}) ${verdict}${f.excludedBoosters ? ` · ${f.excludedBoosters.toLocaleString("fr-FR")} booster${f.excludedBoosters > 1 ? "s" : ""} de codes de jeu non comptés` : ""}</p>
    <ul class="econ-sources">${rows.map((x) => {
      const out = excluded.has(x.source);
      const share = out || !total ? 0 : x.boostersIn / total;
      return `<li class="${out ? "es-excluded" : ""}"><span class="es-name">${x.source}</span><span class="es-bar"><span style="width:${Math.round((x.boostersIn / max) * 100)}%"></span></span><span class="es-val">${out ? `${x.boostersIn.toLocaleString("fr-FR")} · hors calcul` : `${Math.round(share * 100)} % · ${(perPlayer * share).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}/j`}</span></li>`;
    }).join("")}</ul>`;
}

// Journal de l'economie (inflation) : creations / depenses par jour et source.
function econFlows(f, fmt) {
  if (!f) return "";
  return econBoosterSources(f) + `
    <h3 style="margin-top:20px;">&#128200; Inflation : créations et dépenses</h3>
    ${f.alerts.length ? `<div class="econ-alerts">${f.alerts.map((a) => `<div class="econ-alert">&#9888;&#65039; ${a}</div>`).join("")}</div>` : '<div class="econ-ok">&#9989; Aucune alerte : l\'économie semble équilibrée.</div>'}
    <div class="stats-grid">
      <div class="stat-tile"><div class="stat-value">${f.boostersPerPlayerDay}</div><div class="stat-label">Boosters créés / joueur actif / jour (7 j, hors codes)</div></div>
      <div class="stat-tile"><div class="stat-value">${f.dustRatio}</div><div class="stat-label">Poussières gagnées pour 1 dépensée (7 j)</div></div>
    </div>
    <div class="econ-charts">
      ${econBars(f.daily, "boostersIn", "Boosters créés par jour")}
      ${econBars(f.daily, "boostersOut", "Boosters ouverts / dépensés par jour")}
      ${econBars(f.daily, "dustIn", "Poussières gagnées par jour")}
      ${econBars(f.daily, "dustOut", "Poussières dépensées par jour")}
    </div>
    <div class="table-scroll"><table class="econ-table">
      <thead><tr><th>Source (7 j)</th><th>Boosters +</th><th>Boosters −</th><th>Poussières +</th><th>Poussières −</th></tr></thead>
      <tbody>${f.sources.map((s) => `<tr><td>${s.source}</td><td>${fmt(s.boostersIn)}</td><td>${fmt(s.boostersOut)}</td><td>${fmt(s.dustIn)}</td><td>${fmt(s.dustOut)}</td></tr>`).join("") || '<tr><td colspan="5">Pas encore de données (le journal démarre avec cette version).</td></tr>'}</tbody>
    </table></div>`;
}

// Modes de jeu Chill / Medium / Hard (api/src/native/presets.js).
let presetState = null;
function renderPresets(st) {
  presetState = st;
  const box = document.getElementById("preset-zone");
  if (!box) return;
  const esc = escHtml;
  const rec = st.recommendation;
  const recLabel = st.presets.find((p) => p.key === rec.key);
  const currentLabel = st.current === "custom" ? "Personnalisé" : st.presets.find((p) => p.key === st.current).label;
  box.innerHTML = `
    <div class="preset-head">
      <h3>&#127918; Mode de jeu</h3>
      <span class="preset-current ${st.current}">Actuel : <strong>${esc(currentLabel)}</strong>${st.current === "custom" ? " (réglages modifiés à la main)" : ""}</span>
    </div>
    <p class="preset-rec">Recommandé selon l'inflation : <strong>${recLabel.icon} ${esc(recLabel.label)}</strong>. ${rec.reasons.map(esc).join(" · ")}${st.last ? ` <small>Dernier changement : ${esc((st.presets.find((p) => p.key === st.last.key) || {}).label || st.last.key)} le ${new Date(st.last.at * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>` : ""}</p>
    <div class="preset-grid">${st.presets.map((p) => `
      <article class="preset-card ${p.key} ${p.active ? "active" : ""} ${rec.key === p.key ? "recommended" : ""}">
        ${rec.key === p.key ? '<span class="preset-badge">Recommandé</span>' : ""}
        <div class="preset-title"><span aria-hidden="true">${p.icon}</span> <strong>${esc(p.label)}</strong></div>
        <p class="preset-desc">${esc(p.desc)}</p>
        <label class="preset-card-pick">&#127183; Carte exclusive du mode
          <select data-mode-card="${p.key}"><option value="0">— aucune —</option>${pickableCards().map((c) => `<option value="${c.cardId}" ${Number((st.modeCards || {})[p.key]) === c.cardId ? "selected" : ""}>${esc(c.name)}${c.isPromo ? " (promo)" : ""}</option>`).join("")}</select>
        </label>
        ${p.active ? '<p class="preset-state">&#10004; Mode actif</p>' : `<details class="preset-changes"><summary>${p.changes.length} réglage${p.changes.length > 1 ? "s" : ""} changer${p.changes.length > 1 ? "ont" : "a"}</summary>
          <ul>${p.changes.map((c) => `<li><span>${esc(c.label)}</span><span class="preset-diff">${esc(c.current)} &rarr; <strong>${esc(c.target)}</strong></span></li>`).join("")}</ul></details>
          <button type="button" class="btn preset-apply" data-preset="${p.key}">Passer en ${esc(p.label)}</button>`}
      </article>`).join("")}</div>
    <label class="checkbox-inline preset-announce"><input type="checkbox" id="preset-announce" checked /> Annoncer le changement aux joueurs (fil du serveur)</label>
    <div class="preset-schedule" id="preset-schedule"></div>`;
  loadModeSchedule();
}

// Changement de mode programme (api/src/native/modeextras.js) : bandeau de preavis avant.
async function loadModeSchedule() {
  const box = document.getElementById("preset-schedule");
  if (!box || !presetState) return;
  let st;
  try { st = await API.adminModeSchedule(Session.discordId); } catch (e) { box.innerHTML = ""; return; }
  const s = st.scheduled;
  const opt = presetState.presets.map((p) => `<option value="${p.key}">${p.icon} ${escHtml(p.label)}</option>`).join("");
  const def = new Date(Date.now() + 86400000); def.setMinutes(0, 0, 0);
  const local = new Date(def.getTime() - def.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  box.innerHTML = `
    <h4>&#9200; Programmer un changement de mode</h4>
    ${s ? `<p>Prévu : <strong>${escHtml((presetState.presets.find((p) => p.key === s.key) || {}).label || s.key)}</strong> le ${new Date(s.at * 1000).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. Les joueurs voient un bandeau de préavis avant. <button type="button" class="btn-ghost" id="schedule-clear">Annuler</button></p>` : "<p class=\"preset-rec\">Le mode change tout seul à la date choisie ; un bandeau prévient les joueurs avant (réglage ModeNoticeHours).</p>"}
    <div class="preset-schedule-row"><select id="schedule-preset">${opt}</select><input type="datetime-local" id="schedule-at" value="${local}" /><button type="button" class="btn" id="schedule-save">Programmer</button></div>`;
}
document.addEventListener("click", async (e) => {
  const save = e.target.closest && e.target.closest("#schedule-save");
  const clear = e.target.closest && e.target.closest("#schedule-clear");
  if (!save && !clear) return;
  try {
    if (clear) await API.adminModeSchedule(Session.discordId, "clear");
    else {
      const at = Math.floor(new Date(document.getElementById("schedule-at").value).getTime() / 1000);
      await API.adminModeSchedule(Session.discordId, "set", { preset: document.getElementById("schedule-preset").value, at });
    }
    Toast.success(clear ? "Changement annulé." : "Changement de mode programmé.");
    loadModeSchedule();
  } catch (err) { Toast.error(err.code === "invalid_date" ? "Choisis une date dans le futur." : "Impossible. (" + err.message + ")"); }
});
async function loadPresets() {
  try {
    const [st, set] = await Promise.all([API.adminPreset(Session.discordId), API.adminGetSettings(Session.discordId).catch(() => null)]);
    const mc = set && (set.settings || []).find((x) => x.key === "ModeCards");
    st.modeCards = mc ? mc.value : {};
    renderPresets(st);
  }
  catch (err) { const box = document.getElementById("preset-zone"); if (box) box.innerHTML = `<p class="empty-state">Modes de jeu indisponibles (${err.message}).</p>`; }
}
// Carte exclusive d'un mode : enregistree des qu'on la choisit.
document.addEventListener("change", async (e) => {
  const sel = e.target.closest && e.target.closest("[data-mode-card]");
  if (!sel || !presetState) return;
  const cards = { cool: 0, chill: 0, medium: 0, hard: 0, ...(presetState.modeCards || {}) };
  cards[sel.dataset.modeCard] = Number(sel.value) || 0;
  try { await API.adminSetSettings(Session.discordId, { ModeCards: cards }); presetState.modeCards = cards; Toast.success("Carte du mode enregistrée."); }
  catch (err) { Toast.error("Impossible d'enregistrer. (" + err.message + ")"); }
});
document.addEventListener("click", async (e) => {
  const btn = e.target.closest && e.target.closest("[data-preset]");
  if (!btn || !presetState) return;
  const p = presetState.presets.find((x) => x.key === btn.dataset.preset);
  const ok = await Confirm.show(`Passer le jeu en mode <strong>${p.icon} ${p.label}</strong> ? ${p.changes.length} réglage${p.changes.length > 1 ? "s" : ""} vont changer tout de suite (fouille, Milo, pêche, quêtes, doublons, boutique, taxes, pity…). Tu pourras revenir à un autre mode à tout moment.`, { title: "Changer de mode de jeu", confirmText: `Passer en ${p.label}` });
  if (!ok) return;
  btn.disabled = true;
  try {
    const res = await API.adminPreset(Session.discordId, "apply", { preset: p.key, announce: !!document.getElementById("preset-announce")?.checked });
    renderPresets(res);
    Toast.success(`${p.icon} Le jeu est en mode ${p.label}.`);
    if (typeof settingsCache !== "undefined") settingsCache.length = 0;
  } catch (err) { btn.disabled = false; Toast.error("Impossible de changer de mode. (" + (err.data && err.data.errors ? err.data.errors.join(", ") : err.message) + ")"); }
});

// Fonctionnalites ouvertes par mode (api/src/native/features.js) : la matrice
// est modifiee en local puis enregistree d'un coup.
let mfState = null, mfDraft = null;
const MF_MODE = { cool: "😎 Cool", chill: "🌴 Chill", medium: "⚖️ Medium", hard: "🔥 Hard", chaos: "👾 Chaos" };
function renderModeFeatures() {
  const box = document.getElementById("mode-features-zone");
  if (!box || !mfState) return;
  const esc = escHtml;
  const dirty = JSON.stringify(mfDraft) !== JSON.stringify(Object.fromEntries(mfState.features.map((f) => [f.key, f.off])));
  let group = null;
  const rows = mfState.features.map((f) => {
    const head = f.group !== group ? `<tr class="mf-group"><td colspan="${mfState.modes.length + 1}">${esc(f.group)}</td></tr>` : "";
    group = f.group;
    const defaults = f.defaultOff.length ? `fermé par défaut en ${f.defaultOff.map((m) => MF_MODE[m].split(" ")[1]).join(", ")}` : "";
    return head + `<tr><td>${f.icon} ${esc(f.label)}${defaults ? ` <span class="mf-default">(${defaults})</span>` : ""}</td>${mfState.modes.map((m) => {
      const off = mfDraft[f.key].includes(m);
      return `<td class="${m === mfState.current ? "current" : ""}"><button type="button" class="mf-toggle ${off ? "off" : ""}" data-mf="${f.key}" data-mf-mode="${m}" aria-pressed="${off}" title="${esc(f.label)} en ${MF_MODE[m]} : ${off ? "fermé" : "ouvert"}">${off ? "&#10005;" : "&#10003;"}</button></td>`;
    }).join("")}</tr>`;
  }).join("");
  box.innerHTML = `
    <div class="mf-head"><h3>&#128274; Fonctionnalités par mode</h3><small>Mode actuel : <strong>${MF_MODE[mfState.current]}</strong></small></div>
    <p class="mf-help">&#10003; = ouvert, &#10005; = fermé dans ce mode. Une fonctionnalité fermée disparaît du site (onglets, widgets, liens) ; une page fermée affiche un message ; l'API refuse ses actions (les lectures restent permises).</p>
    <div class="table-scroll"><table class="mf-table"><thead><tr><th>Fonctionnalité</th>${mfState.modes.map((m) => `<th class="${m === mfState.current ? "current" : ""}">${MF_MODE[m]}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="mf-actions"><button type="button" class="btn" id="mf-save" ${dirty ? "" : "disabled"}>Enregistrer</button><button type="button" class="btn-ghost" id="mf-reset">Revenir aux valeurs par défaut</button></div>`;
}
async function loadModeFeatures() {
  try {
    mfState = await API.adminModeFeatures(Session.discordId);
    mfDraft = Object.fromEntries(mfState.features.map((f) => [f.key, [...f.off]]));
    renderModeFeatures();
  } catch (err) { const box = document.getElementById("mode-features-zone"); if (box) box.innerHTML = `<p class="empty-state">Fonctionnalités par mode indisponibles (${err.message}).</p>`; }
}
document.addEventListener("click", async (e) => {
  const t = e.target.closest && e.target.closest("[data-mf], #mf-save, #mf-reset");
  if (!t || !mfState) return;
  if (t.dataset.mf) {
    const list = mfDraft[t.dataset.mf], m = t.dataset.mfMode;
    mfDraft[t.dataset.mf] = list.includes(m) ? list.filter((x) => x !== m) : [...list, m];
    return renderModeFeatures();
  }
  const reset = t.id === "mf-reset";
  if (reset && !(await Confirm.show("Remettre la matrice des fonctionnalités par mode aux valeurs par défaut ?", { title: "Valeurs par défaut", confirmText: "Remettre" }))) return;
  t.disabled = true;
  try {
    mfState = await API.adminModeFeatures(Session.discordId, reset ? "reset" : "set", reset ? undefined : mfDraft);
    mfDraft = Object.fromEntries(mfState.features.map((f) => [f.key, [...f.off]]));
    renderModeFeatures();
    Toast.success(reset ? "Valeurs par défaut remises." : "Fonctionnalités par mode enregistrées.");
  } catch (err) { t.disabled = false; Toast.error("Impossible d'enregistrer. (" + err.message + ")"); }
});

// Journal detaille (api/src/native/ledger.js).
async function loadEconomyLog() {
  const box = document.getElementById("econ-log");
  if (!box) return;
  const select = document.getElementById("econ-log-source");
  const params = { source: select.value || undefined, boostersOnly: document.getElementById("econ-log-boosters").checked };
  try {
    const r = await API.adminEconomyLog(Session.discordId, params);
    if (select.options.length <= 1) r.sources.forEach((s) => select.add(new Option(s, s)));
    const when = (t) => new Date(t * 1000).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const esc = escHtml;
    const sign = (n) => (n > 0 ? "+" + n : String(n));
    box.innerHTML = `
      ${r.totals.length ? `<p class="econ-log-totals"><strong>Boosters créés sur 7 jours :</strong> ${r.totals.slice(0, 12).map((t) => `${esc(t.source)} <b>${t.boosters}</b>`).join(" · ")}</p>` : ""}
      <div class="table-scroll"><table class="econ-table econ-log-table">
        <thead><tr><th>Quand</th><th>Joueur</th><th>Source · action</th><th>Par</th><th>Boosters</th><th>Poussières</th><th>Détail</th></tr></thead>
        <tbody>${r.rows.map((x) => `<tr class="${x.source === "inconnu" ? "econ-unknown" : ""}"><td>${when(x.at)}</td><td>${esc(x.pseudo)}</td><td>${esc(x.source)}${x.action ? " · " + esc(x.action) : ""}</td><td>${esc(x.actor)}</td><td class="num ${x.boosters > 0 ? "pos" : x.boosters < 0 ? "neg" : ""}">${x.boosters ? sign(x.boosters) : ""}</td><td class="num">${x.dust ? sign(x.dust) : ""}</td><td class="econ-detail">${esc(x.detail)}</td></tr>`).join("") || '<tr><td colspan="7">Rien pour l\'instant : le journal démarre avec cette version.</td></tr>'}</tbody>
      </table></div>`;
  } catch (err) { box.innerHTML = `<p class="empty-state">Journal indisponible (${err.message}).</p>`; }
}
document.addEventListener("change", (e) => { if (e.target && (e.target.id === "econ-log-source" || e.target.id === "econ-log-boosters")) loadEconomyLog(); });

async function loadEconomy() {
  const el = document.getElementById("economy-zone");
  el.className = "";
  el.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';
  try {
    const e = await API.adminGetEconomy(Session.discordId);
    const t = e.totals;
    const fmt = fmtNum; // core.js
    const list = (rows, fn) => rows.length ? `<ol class="econ-list">${rows.map(fn).join("")}</ol>` : '<p class="lead" style="font-size:0.8rem;">—</p>';
    el.innerHTML = `<div id="preset-zone" class="preset-zone"></div>
      <div id="mode-features-zone" class="mf-zone"></div>
      <div class="stats-grid">
        <div class="stat-tile"><div class="stat-value">${fmt(t.players)}</div><div class="stat-label">Joueurs</div></div>
        <div class="stat-tile"><div class="stat-value">${t.active1d} / ${t.active7d} / ${t.active30d}</div><div class="stat-label">Actifs 24 h / 7 j / 30 j</div></div>
        <div class="stat-tile"><div class="stat-value">${fmt(t.stardust)}</div><div class="stat-label">Poussières en circulation</div></div>
        <div class="stat-tile"><div class="stat-value">${fmt(t.boostersUnopened)}</div><div class="stat-label">Boosters non ouverts</div></div>
        <div class="stat-tile"><div class="stat-value">${fmt(t.keys)}</div><div class="stat-label">Clés en circulation</div></div>
        <div class="stat-tile"><div class="stat-value">${fmt(t.copies)}</div><div class="stat-label">Exemplaires en circulation</div></div>
        <div class="stat-tile"><div class="stat-value">${fmt(t.collectionValue)}</div><div class="stat-label">Valeur totale (décraft)</div></div>
        <div class="stat-tile"><div class="stat-value">${t.cardsNeverObtained} / ${t.playableCards}</div><div class="stat-label">Cartes jamais sorties</div></div>
      </div>
      <div class="econ-charts">
        ${econBars(e.days, "boosters", "Boosters ouverts par jour")}
        ${econBars(e.days, "cards", "Cartes obtenues par jour")}
        ${econBars(e.days, "activePlayers", "Joueurs actifs par jour")}
        ${econBars(e.days, "newPlayers", "Nouveaux joueurs par jour")}
      </div>
      <div class="econ-columns">
        <div><h3>Sources des cartes (30 j)</h3>${list(e.sources, (s) => `<li><span>${s.source}</span><strong>${fmt(s.count)}</strong></li>`)}</div>
        <div><h3>Plus riches en poussières</h3>${list(e.richest, (r) => `<li><span>${r.pseudo}</span><strong>${fmt(r.value)}</strong></li>`)}</div>
        <div><h3>Boosters en réserve</h3>${list(e.boosterHoarders, (r) => `<li><span>${r.pseudo}</span><strong>${fmt(r.value)}</strong></li>`)}</div>
        <div><h3>Cartes les plus répandues</h3>${list(e.mostCommonCards, (c) => `<li><span>${c.name} <small>${c.rarity}</small></span><strong>${c.copies}</strong></li>`)}</div>
        <div><h3>Cartes les plus rares</h3>${list(e.rarestCards, (c) => `<li><span>${c.name} <small>${c.rarity}</small></span><strong>${c.copies}</strong></li>`)}</div>
      </div>
      ${econFlows(e.flows, fmt)}
      <h3 style="margin-top:20px;">&#128269; Journal détaillé : d'où et de qui</h3>
      <p class="lead" style="font-size:0.82rem;">Chaque booster créé ou dépensé (et chaque mouvement d'au moins 200 poussières), un par un, avec la route, l'action, qui l'a déclenché et le détail (code utilisé, cible…). Gardé 45 jours.</p>
      <div class="econ-log-tools">
        <select id="econ-log-source" aria-label="Filtrer par source"><option value="">Toutes les sources</option></select>
        <label class="checkbox-inline"><input type="checkbox" id="econ-log-boosters" checked /> Boosters seulement</label>
      </div>
      <div id="econ-log"></div>`;
    loadPresets();
    if (typeof loadModeFeatures === "function") loadModeFeatures();
    loadEconomyLog();
  } catch (err) {
    el.className = "empty-state";
    el.textContent = err.code === "forbidden" ? "Accès réservé aux admins." : "Impossible de charger l'économie.";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    // Connexion directe depuis l'admin (2026-10-07) : retour ici apres Discord,
    // sans passer par l'accueil (redirige vers la page de maintenance).
    const link = document.getElementById("admin-login-link");
    if (link) link.addEventListener("click", (e) => { e.preventDefault(); try { sessionStorage.setItem("2gatcha_after_login", "admin.html"); } catch (err) { /* stockage indisponible */ } location.href = API.discordLoginUrl(); });
    return;
  }

  try {
    await loadCardOptions();
    await loadCodes();
    let configLoaded = false;
    const loadConfigOnce = () => { if (!configLoaded) { configLoaded = true; loadConfig().catch((err) => Toast.error("Réglages indisponibles. (" + err.message + ")")); } };
    AdminNav.onFirstShow("economie", () => { loadEconomy(); loadStats(); });
    AdminNav.onFirstShow("evenements", loadEventAdmin);
    AdminNav.onFirstShow("contenu", () => { loadExtensionsAdmin(); loadBossAdmin(); loadSeasonAdmin(); loadMarketAdmin(); });
    AdminNav.onFirstShow("reglages", () => { loadConfigOnce(); if (!settingsCache.length) loadSettings(); });
    AdminNav.onFirstShow("site", loadConfigOnce);
    document.getElementById("settings-zone").addEventListener("click", async (e) => {
      if (e.target.closest("#settings-save-btn")) { saveSettings(); return; }
      const reset = e.target.closest("[data-reset-setting]");
      if (reset) {
        try { renderSettings((await API.adminResetSetting(Session.discordId, reset.dataset.resetSetting)).settings); Toast.info("Valeur par défaut rétablie."); }
        catch (err) { Toast.error(friendlyError(err)); }
      }
    });
    document.getElementById("season-admin-zone").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-season-save]");
      if (!btn) return;
      const season = btn.dataset.seasonSave;
      const cardId = Number(document.querySelector(`[data-season-card="${season}"]`).value) || 0;
      try { await loadSeasonAdmin(await API.adminSetSeasonCard(Session.discordId, season, cardId)); Toast.success("Carte de saison enregistrée."); }
      catch (err) { Toast.error(friendlyError(err)); }
    });
    document.getElementById("event-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const endsAt = Math.floor(new Date(document.getElementById("event-ends").value).getTime() / 1000);
      if (!endsAt || endsAt * 1000 < Date.now()) { Toast.error("La date de fin doit être dans le futur."); return; }
      try {
        const ev = await API.adminSetEvent(Session.discordId, {
          active: true,
          label: document.getElementById("event-label").value.trim(),
          dustMultiplier: Number(document.getElementById("event-dust").value) || 1,
          finishMultiplier: Number(document.getElementById("event-finish").value) || 1,
          fishingRare: Number(document.getElementById("event-fishing").value) || 1,
          wormsMultiplier: Number(document.getElementById("event-worms").value) || 1,
          endsAt
        });
        renderEventAdmin(ev);
        Toast.success("Événement lancé !");
      } catch (err) { Toast.error(friendlyError(err)); }
    });
    document.getElementById("event-stop-btn").addEventListener("click", async () => {
      if (!(await Confirm.show("Arrêter l'événement en cours maintenant ?", { title: "Arrêter l'événement", confirmText: "Arrêter", dangerous: true }))) return;
      try { renderEventAdmin(await API.adminSetEvent(Session.discordId, { active: false })); Toast.info("Événement arrêté."); } catch (err) { Toast.error(friendlyError(err)); }
    });
    populateMarketCardSelect();
    updateMarketCardPreview();
    populateBingoCardSelects();
    loadLevelRewardsAdmin();
    loadGiftUserOptions();
    populateGiftCardSelect();
    updateGiftFieldVisibility();
    document.getElementById("admin-zone").style.display = "";
    AdminNav.start();
  } catch (e) {
    if (e.code === "forbidden") {
      document.getElementById("denied-warning").style.display = "block";
    } else {
      Toast.error("Erreur lors du chargement de la page admin. (" + e.message + ")");
    }
    return;
  }

  document.getElementById("config-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await API.adminSetConfig(Session.discordId, {
        pityThreshold: Number(document.getElementById("pity-threshold-input").value) || undefined,
        topRarityKey: document.getElementById("top-rarity-select").value,
        digMaxEnergy: Number(document.getElementById("dig-max-energy-input").value) || undefined,
        dailyQuestThreshold: Number(document.getElementById("daily-threshold-input").value) || undefined,
        weeklyQuestThreshold: Number(document.getElementById("weekly-threshold-input").value) || undefined,
        weeklyQuestTarget: Number(document.getElementById("weekly-target-input").value) || undefined,
        qualityRepairCost: Number(document.getElementById("quality-repair-cost-input").value) || undefined,
        featureUnlockCraft: Number(document.getElementById("unlock-craft-input").value) || undefined,
        featureUnlockTrade: Number(document.getElementById("unlock-trade-input").value) || undefined,
        featureUnlockAltar: Number(document.getElementById("unlock-altar-input").value) || undefined,
        featureUnlockQuality: Number(document.getElementById("unlock-quality-input").value) || undefined,
        featureUnlockFinish: Number(document.getElementById("unlock-finish-input").value) || undefined,
        featureUnlockShowcase: Number(document.getElementById("unlock-showcase-input").value) || undefined,
        themeUnlockMonochrome: Number(document.getElementById("unlock-theme-monochrome-input").value) || undefined,
        themeUnlockSepia: Number(document.getElementById("unlock-theme-sepia-input").value) || undefined,
        themeUnlockCyberpunk: Number(document.getElementById("unlock-theme-cyberpunk-input").value) || undefined,
        sleeveUnlockNeon: Number(document.getElementById("unlock-sleeve-neon-input").value) || undefined,
        sleeveUnlockVintage: Number(document.getElementById("unlock-sleeve-vintage-input").value) || undefined,
        sleeveUnlockCarbone: Number(document.getElementById("unlock-sleeve-carbone-input").value) || undefined
      });
      Toast.success("Paramètres enregistrés.");
    } catch (e) {
      Toast.error("Impossible d'enregistrer. (" + e.message + ")");
    }
  });

  document.getElementById("banner-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await API.adminSetConfig(Session.discordId, {
        bannerEnabled: document.getElementById("banner-enabled-input").checked,
        bannerType: document.getElementById("banner-type-select").value,
        bannerMessage: document.getElementById("banner-message-input").value.trim()
      });
      Toast.success("Bandeau enregistré.");
    } catch (err) {
      Toast.error("Impossible d'enregistrer le bandeau. (" + err.message + ")");
    }
  });

  document.getElementById("maintenance-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const enabled = document.getElementById("maintenance-enabled-input").checked;
    try {
      await API.adminSetConfig(Session.discordId, { maintenanceMode: enabled });
      Toast.success(enabled ? "Mode maintenance activé." : "Mode maintenance désactivé.");
    } catch (err) {
      Toast.error("Impossible de changer le mode maintenance. (" + err.message + ")");
    }
  });

  const resetScopeUser = document.getElementById("reset-scope-user");
  const resetTargetPseudo = document.getElementById("reset-target-pseudo");
  document.querySelectorAll('input[name="reset-scope"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      resetTargetPseudo.style.display = resetScopeUser.checked ? "block" : "none";
    });
  });

  document.getElementById("balance-rarities-table").addEventListener("click", async (e) => {
    const btn = e.target.closest(".balance-save-btn");
    if (!btn) return;
    const row = btn.closest(".balance-row");
    const rarityId = Number(btn.dataset.id);
    btn.disabled = true;
    try {
      await API.adminUpdateRarity(Session.discordId, rarityId, {
        weight: row.querySelector('[data-field="weight"]').value,
        disenchantValue: row.querySelector('[data-field="disenchantValue"]').value,
        craftCost: row.querySelector('[data-field="craftCost"]').value
      });
      Toast.success("Rareté mise à jour.");
    } catch (err) {
      Toast.error("Impossible d'enregistrer. (" + err.message + ")");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("balance-finishes-table").addEventListener("click", async (e) => {
    const btn = e.target.closest(".balance-save-btn");
    if (!btn) return;
    const row = btn.closest(".balance-row");
    const finishId = Number(btn.dataset.id);
    btn.disabled = true;
    try {
      await API.adminUpdateFinish(Session.discordId, finishId, {
        dropWeight: row.querySelector('[data-field="dropWeight"]').value,
        disenchantMultiplier: row.querySelector('[data-field="disenchantMultiplier"]').value
      });
      Toast.success("Finition mise à jour.");
    } catch (err) {
      Toast.error("Impossible d'enregistrer. (" + err.message + ")");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("balance-qualities-table").addEventListener("click", async (e) => {
    const btn = e.target.closest(".balance-save-btn");
    if (!btn) return;
    const row = btn.closest(".balance-row");
    const qualityId = Number(btn.dataset.id);
    btn.disabled = true;
    try {
      await API.adminUpdateQuality(Session.discordId, qualityId, {
        dropWeight: row.querySelector('[data-field="dropWeight"]').value,
        disenchantMultiplier: row.querySelector('[data-field="disenchantMultiplier"]').value
      });
      Toast.success("Qualité mise à jour.");
    } catch (err) {
      Toast.error("Impossible d'enregistrer. (" + err.message + ")");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("create-extension-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await API.adminCreateExtension(Session.discordId, {
        name: document.getElementById("ext-name-input").value.trim(),
        key: document.getElementById("ext-key-input").value.trim(),
        sortOrder: Number(document.getElementById("ext-sort-input").value) || 0,
        active: true
      });
      Toast.success("Extension créée ! Ajoute son visuel dans Admin > Base de données pour la rendre jolie.");
      document.getElementById("create-extension-form").reset();
      API._cacheSet("2gatcha_cache_extensions", null);
      loadExtensionsAdmin();
    } catch (e) {
      Toast.error("Impossible de créer l'extension. (" + e.message + ")");
    }
  });

  document.getElementById("reward-type-select").addEventListener("change", () => { updateCardFieldVisibility(); updateRewardPreview(); });
  document.getElementById("card-select").addEventListener("change", () => { updateCardPreview(); updateRewardPreview(); });
  document.getElementById("quantity-input").addEventListener("input", updateRewardPreview);
  updateCardFieldVisibility();
  updateRewardPreview();

  document.getElementById("view-table-btn").addEventListener("click", (e) => {
    calendarView = false;
    e.target.classList.add("active");
    document.getElementById("view-calendar-btn").classList.remove("active");
    renderCodes();
  });
  document.getElementById("view-calendar-btn").addEventListener("click", (e) => {
    calendarView = true;
    e.target.classList.add("active");
    document.getElementById("view-table-btn").classList.remove("active");
    renderCodes();
  });

  document.getElementById("create-code-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    document.getElementById("created-zone").innerHTML = "";

    const rewardType = document.getElementById("reward-type-select").value;
    const params = {
      code: document.getElementById("code-input").value.trim() || undefined,
      label: document.getElementById("label-input").value.trim(),
      rewardType,
      quantity: Number(document.getElementById("quantity-input").value) || 1,
      cardId: rewardType === "card" ? Number(document.getElementById("card-select").value) : undefined,
      expiresInHours: Number(document.getElementById("expires-input").value) || 4,
      maxRedemptions: Number(document.getElementById("max-redemptions-input").value) || 0,
      notifyDiscord: document.getElementById("notify-discord-checkbox").checked
    };

    try {
      const created = await API.adminCreateCode(Session.discordId, params);
      document.getElementById("created-zone").innerHTML =
        `<div class="reward-banner">Code créé : <code>${created.code}</code></div>`;
      renderCodeQr(created.code);
      document.getElementById("create-code-form").reset();
      updateCardFieldVisibility();
      updateRewardPreview();
      Toast.success(`Code ${created.code} créé !`);
      loadCodes();
    } catch (err) {
      Toast.error("Impossible de créer le code. (" + err.message + ")");
    }
  });

  document.getElementById("market-card-select").addEventListener("change", updateMarketCardPreview);

  document.getElementById("gift-type-select").addEventListener("change", updateGiftFieldVisibility);
  document.getElementById("gift-card-select").addEventListener("change", updateGiftCardPreview);
  document.getElementById("gift-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const giftType = document.getElementById("gift-type-select").value;
    const targetUserId = Number(document.getElementById("gift-user-select").value);
    const quantity = Number(document.getElementById("gift-quantity-input").value) || 1;
    if (!targetUserId) { Toast.error("Choisis un joueur."); return; }
    try {
      const res = await API.adminGift(Session.discordId, {
        targetUserId,
        giftType,
        quantity,
        cardId: giftType === "card" ? Number(document.getElementById("gift-card-select").value) : undefined,
        finish: giftType === "card" ? document.getElementById("gift-finish-select").value : undefined,
        quality: giftType === "card" ? document.getElementById("gift-quality-select").value : undefined
      });
      const label = res.giftType === "card" ? `${res.quantity}x ${res.cardName}` : res.giftType === "booster" ? `${res.quantity} booster(s)` : `${res.quantity} poussière(s)`;
      Toast.success(`Don envoyé : ${label} !`);
      document.getElementById("gift-quantity-input").value = "1";
    } catch (err) {
      Toast.error("Impossible d'envoyer le don. (" + err.message + ")");
    }
  });

  document.getElementById("create-boss-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await API.adminCreateBoss(Session.discordId, {
        bossName: document.getElementById("boss-name-input").value.trim(),
        maxHp: Number(document.getElementById("boss-maxhp-input").value) || 0,
        rewardBoosters: Number(document.getElementById("boss-reward-input").value) || 0
      });
      Toast.success("Boss lancé !");
      document.getElementById("create-boss-form").reset();
      loadBossAdmin();
    } catch (err) {
      Toast.error("Impossible de lancer le boss. (" + err.message + ")");
    }
  });

  document.getElementById("create-market-offer-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await API.adminCreateMarketOffer(Session.discordId, {
        cardId: Number(document.getElementById("market-card-select").value),
        cost: Number(document.getElementById("market-cost-input").value) || 0,
        expiresInHours: Number(document.getElementById("market-expires-input").value) || 24,
        maxPurchases: Number(document.getElementById("market-max-purchases-input").value) || 0
      });
      Toast.success("Offre créée !");
      loadMarketAdmin();
    } catch (err) {
      Toast.error("Impossible de créer l'offre. (" + err.message + ")");
    }
  });

  document.getElementById("bingo-autogen-btn").addEventListener("click", autogenerateBingo);
  document.getElementById("create-bingo-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cardIds = [...document.querySelectorAll(".bingo-cell-select")].map((s) => Number(s.value));
    if (new Set(cardIds).size !== 9) {
      Toast.error("Choisis 9 cartes différentes.");
      return;
    }
    // Garde-fou : remplacer la grille du mois EN COURS efface la progression
    // des joueurs qui la remplissent deja - confirmation explicite exigee.
    const monthValue = document.getElementById("bingo-month-input").value.trim();
    if (!monthValue || monthValue === monthKeyOffset(0)) {
      const ok = await Confirm.show("Tu vas <strong>remplacer la grille du mois en cours</strong>, sur laquelle des joueurs progressent peut-être déjà. Continuer ?", {
        title: "Remplacer la grille actuelle ?",
        confirmText: "Remplacer quand même",
        dangerous: true
      });
      if (!ok) return;
    }
    try {
      await API.adminSetBingoGrid(Session.discordId, {
        month: monthValue || undefined,
        cardIds,
        rewardBoosters: Number(document.getElementById("bingo-reward-input").value) || 0
      });
      Toast.success("Grille de bingo enregistrée !");
    } catch (err) {
      Toast.error("Impossible d'enregistrer la grille. (" + err.message + ")");
    }
  });

  document.getElementById("save-level-rewards-btn").addEventListener("click", async () => {
    const rows = [...document.querySelectorAll("#level-rewards-tbody tr[data-level]")].map((tr) => ({
      rowId: tr.dataset.rowId ? Number(tr.dataset.rowId) : null,
      level: Number(tr.dataset.level),
      dust: Number(tr.querySelector(".lvl-dust-input").value) || 0,
      booster: Number(tr.querySelector(".lvl-booster-input").value) || 0,
      cardId: tr.querySelector(".lvl-card-select").value ? Number(tr.querySelector(".lvl-card-select").value) : null
    }));
    try {
      await API.adminSetLevelRewards(Session.discordId, rows);
      Toast.success("Récompenses de niveau enregistrées.");
      loadLevelRewardsAdmin();
    } catch (err) {
      Toast.error("Impossible d'enregistrer. (" + err.message + ")");
    }
  });

  document.getElementById("reset-v1-btn").addEventListener("click", resetV1);
});

// Reinitialisation de fin de beta (ou d'un seul joueur) : double
// confirmation deliberement lourde (dialogue + saisie exacte du mot-cle)
// pour une action irreversible et potentiellement a gros rayon d'action -
// un simple clic ne doit jamais suffire a la declencher.
async function resetV1() {
  const isUserScoped = document.getElementById("reset-scope-user").checked;
  const targetPseudo = document.getElementById("reset-target-pseudo").value.trim();
  if (isUserScoped && !targetPseudo) {
    Toast.error("Indique le pseudo du joueur à réinitialiser.");
    return;
  }

  const ok = await Confirm.show(
    isUserScoped
      ? `Ceci va <strong>supprimer définitivement</strong> les tirages, échanges, quêtes et redemptions ` +
        `de <strong>${targetPseudo}</strong> uniquement, et remettre à zéro son solde de boosters/poussières ` +
        `et son compteur de pity. Les autres joueurs ne sont pas affectés.<br><br>Cette action est irréversible.`
      : "Ceci va <strong>supprimer définitivement</strong> les tirages, échanges, " +
        "quêtes et redemptions de codes de <strong>TOUS les joueurs</strong>, et remettre à zéro le solde de " +
        "boosters/poussières et le compteur de pity de chacun. Les comptes Discord et le catalogue de cartes restent intacts.<br><br>" +
        "Cette action est irréversible.",
    { title: isUserScoped ? `Réinitialiser ${targetPseudo} ?` : "Réinitialiser pour la V1 ?", confirmText: "Continuer", dangerous: true }
  );
  if (!ok) return;

  const typed = window.prompt('Tape exactement RESET-V1 pour confirmer définitivement :');
  if (typed !== "RESET-V1") {
    if (typed !== null) Toast.error("Confirmation incorrecte, réinitialisation annulée.");
    return;
  }

  const btn = document.getElementById("reset-v1-btn");
  btn.disabled = true;
  btn.textContent = "Réinitialisation en cours...";
  try {
    const res = await API.adminResetV1(Session.discordId, typed, isUserScoped ? targetPseudo : undefined);
    const c = res.counts || {};
    Toast.success(
      `Réinitialisé${res.scope === "user" ? " (" + res.targetPseudo + ")" : ""} : ${c.pulls || 0} tirages, ${c.trades || 0} échanges, ` +
      `${c.quests || 0} quêtes du jour, ${c.weeklyQuests || 0} quêtes de la semaine, ` +
      `${c.redemptions || 0} redemptions, ${c.boosterInventory || 0} compteurs de pity, ` +
      `${c.users || 0} compte(s) remis à zéro.`
    );
  } catch (e) {
    Toast.error(e.code === "user_not_found" ? "Pseudo introuvable." : "Échec de la réinitialisation. (" + e.message + ")");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "&#128465;&#65039; Réinitialiser";
  }
}
