// Logique du journal d'ouvertures (historique complet, toutes sources).
// Contrat n8n "pull-log" (GET ?userId=...) :
//   { log: [{ cardId, cardName, imageId, rarity, extension, source, obtainedAt }], total }

const SOURCE_LABELS = {
  booster: { icon: "&#127183;", label: "Booster" },
  craft: { icon: "&#10024;", label: "Craft" },
  altar: { icon: "&#128293;", label: "Autel" },
  code: { icon: "&#127915;", label: "Code" }
};

let pullLogCache = [];
let pullLogSearch = "";
let pullLogRarityFilter = "all";
let pullLogSourceFilter = "";

function normalize(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function renderPullLogFilters() {
  const el = document.getElementById("pull-log-rarity-filters");
  const rarityByKey = new Map();
  pullLogCache.forEach((p) => {
    if (p.rarity?.key && !rarityByKey.has(p.rarity.key)) {
      rarityByKey.set(p.rarity.key, { key: p.rarity.key, name: p.rarity.name || p.rarity.key });
    }
  });
  const items = [{ key: "all", name: "Toutes" }, ...rarityByKey.values()];
  el.innerHTML = items.map(({ key, name }) =>
    `<button type="button" data-filter="${key}" class="btn-secondary ${key === pullLogRarityFilter ? "active" : ""}">${name}</button>`
  ).join("");
  el.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      pullLogRarityFilter = btn.dataset.filter;
      el.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      renderPullLog();
    });
  });
}

function renderPullLogStats() {
  const el = document.getElementById("pull-log-stats");
  const bySource = {};
  pullLogCache.forEach((p) => { bySource[p.source] = (bySource[p.source] || 0) + 1; });
  el.innerHTML = `
    <div class="stat-tile"><div class="stat-value">${pullLogCache.length}</div><div class="stat-label">Cartes obtenues au total</div></div>
    ${Object.entries(SOURCE_LABELS).map(([key, meta]) => `
      <div class="stat-tile"><div class="stat-value">${bySource[key] || 0}</div><div class="stat-label">${meta.icon.replace(/&#(\d+);/, (m, d) => String.fromCodePoint(Number(d)))} ${meta.label}</div></div>
    `).join("")}
  `;
}

// Barres du nombre de boosters ouverts par jour, 30 derniers jours (echelle
// unique, une seule serie -> pas de legende necessaire, l'infobulle native
// du navigateur (title) sert de "hover" sans construire un tooltip custom).
function renderPullTimeline() {
  const el = document.getElementById("pull-timeline-chart");
  const DAYS = 30;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const counts = new Map();
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    counts.set(d.toISOString().slice(0, 10), 0);
  }
  pullLogCache.filter((p) => p.source === "booster").forEach((p) => {
    const key = new Date(p.obtainedAt * 1000).toISOString().slice(0, 10);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  });
  const entries = [...counts.entries()].reverse();
  const max = Math.max(1, ...entries.map(([, c]) => c));
  el.innerHTML = entries.map(([date, count]) => {
    const heightPct = count ? Math.max(6, Math.round((count / max) * 100)) : 0;
    const label = new Date(date + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    return `
      <div class="timeline-bar-col" title="${label} : ${count} booster${count > 1 ? "s" : ""}">
        <div class="timeline-bar" style="height:${heightPct}%;"></div>
      </div>
    `;
  }).join("");
}

// Repartition reelle (boosters uniquement - craft/autel/codes ne sont pas
// aleatoires) comparee aux poids actuels de la config gacha. Un repere
// vertical sur la meme barre plutot qu'une deuxieme serie de couleur :
// evite un graphique a 8 couleurs pour une simple comparaison a 2 valeurs
// par rarete (voir dataviz : une seule echelle, la couleur suit l'entite -
// ici la rarete - pas la serie).
function renderPullLuckChart(rarityWeights) {
  const el = document.getElementById("pull-luck-chart");
  if (!rarityWeights || !rarityWeights.length) { el.innerHTML = ""; return; }
  const boosterPulls = pullLogCache.filter((p) => p.source === "booster" && p.rarity);
  if (!boosterPulls.length) {
    el.innerHTML = `<div class="empty-state">Ouvre au moins un booster pour voir cette comparaison.</div>`;
    return;
  }
  const totalWeight = rarityWeights.reduce((s, r) => s + (r.weight || 0), 0);
  const countByKey = {};
  boosterPulls.forEach((p) => { countByKey[p.rarity.key] = (countByKey[p.rarity.key] || 0) + 1; });

  el.innerHTML = rarityWeights.map((r) => {
    const count = countByKey[r.key] || 0;
    const actualPct = (count / boosterPulls.length) * 100;
    const expectedPct = totalWeight ? (r.weight / totalWeight) * 100 : 0;
    return `
      <div class="rarity-progress-row">
        <span class="rp-label" style="color:${rarityTextColor(r.colorHex)};">${r.name}</span>
        <span class="rp-track">
          <span class="rp-fill" style="width:${Math.min(actualPct, 100)}%;background:${r.colorHex};"></span>
          <span class="rp-target-tick" style="left:${Math.min(expectedPct, 100)}%;" title="Taux théorique actuel : ${expectedPct.toFixed(1)}%"></span>
        </span>
        <span class="rp-count">${actualPct.toFixed(1)}% (${count})</span>
      </div>
    `;
  }).join("");
}

function renderPullLog() {
  const listEl = document.getElementById("pull-log-list");
  let items = pullLogCache;
  if (pullLogRarityFilter !== "all") items = items.filter((p) => p.rarity?.key === pullLogRarityFilter);
  if (pullLogSourceFilter) items = items.filter((p) => p.source === pullLogSourceFilter);
  if (pullLogSearch) {
    const q = normalize(pullLogSearch);
    items = items.filter((p) => normalize(p.cardName).includes(q));
  }

  if (!items.length) {
    listEl.innerHTML = `<div class="empty-state">Aucun tirage ne correspond.</div>`;
    return;
  }

  listEl.innerHTML = items.map((p) => {
    const color = p.rarity?.colorHex || "#9aa0b4";
    const imgSrc = API.imageUrl(p.imageId) || PLACEHOLDER_IMG;
    const source = SOURCE_LABELS[p.source] || SOURCE_LABELS.booster;
    const when = p.obtainedAt ? new Date(p.obtainedAt * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return `
      <div class="pull-log-row" data-rarity="${p.rarity?.key || "commune"}">
        <img src="${imgSrc}" alt="" loading="lazy" style="border-color:${color};" />
        <div class="pull-log-info">
          <div class="pull-log-name">${p.cardName}</div>
          <div class="pull-log-meta">
            <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">${p.rarity?.name || "Commune"}</span>
            ${p.extension ? `<span class="activity-ext">${p.extension.name}</span>` : ""}
          </div>
        </div>
        <div class="pull-log-source" title="${source.label}">${source.icon}</div>
        <div class="pull-log-time">${when}</div>
      </div>
    `;
  }).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("pull-log-zone").style.display = "block";
  const loading = document.getElementById("pull-log-loading");

  try {
    const res = await API.getPullLog(Session.userId);
    pullLogCache = res.log || [];
    renderPullLogStats();
    renderPullTimeline();
    renderPullLuckChart(res.rarityWeights);
    renderPullLogFilters();
    renderPullLog();
  } catch (e) {
    document.getElementById("pull-log-list").innerHTML = `<div class="empty-state">Impossible de charger le journal. (${e.message})</div>`;
  } finally {
    loading.style.display = "none";
  }

  let searchTimer = null;
  document.getElementById("pull-log-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { pullLogSearch = e.target.value; renderPullLog(); }, 150);
  });
  document.getElementById("pull-log-source-filter").addEventListener("change", (e) => {
    pullLogSourceFilter = e.target.value;
    renderPullLog();
  });
  enhanceSelect(document.getElementById("pull-log-source-filter"));
});
