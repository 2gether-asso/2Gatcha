// Page Progression (2026-10-17) : talents et prestige (profile-progress.js),
// constellations et arbre celeste (collection-progress.js + ici), maitrises.
// Arbre celeste : api/src/native/skytree.js (nebuleuses a rangs illimites
// depuis le 2026-10-25). Ameliorations permanentes (api/src/native/upgrades.js) :
// onglet Talents depuis le 2026-10-25 (avant : boutique).

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const TAB_KEY = "2gatcha_pg_tab";
  const EFFECTS = {
    lynx: (v) => `+${(v * 100).toLocaleString("fr-FR")} pt de finition spéciale`,
    born: (v) => `+${(v * 100).toLocaleString("fr-FR")} % qu'une carte gagne un état`,
    recycler: (v) => `+${Math.round(v * 100)} % de poussières de doublons`,
    patron: (v) => `+${Math.round(v * 100)} % de poussières au décraft`,
    thrifty: (v) => `−${Math.round(v * 100)} % sur le craft`,
    restorer: (v) => `−${Math.round(v * 100)} % de supplément de restauration`,
    founder: (v) => `+${Math.round(v * 100)} % de chance de poussières après une fusion`,
    master: (v) => `−${Math.round(v * 100)} % de taxes`,
    angler: (v) => `+${v} énergie de pêche max`,
    greenthumb: (v) => `jardin ${Math.round(v * 100)} % plus rapide`,
    explorer: (v) => `+${Math.round(v * 100)} % de poussières d'expédition`,
    tireless: (v) => `+${Math.round(v * 100)} % de poussières de fouille`
  };
  let sky = null;
  let selected = "polaris";

  // ---------------------------------------------------------------- onglets
  function showTab(key) {
    document.querySelectorAll("[data-pg]").forEach((b) => { const on = b.dataset.pg === key; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
    document.querySelectorAll(".pg-pane").forEach((p) => { p.hidden = p.id !== "pg-" + key; });
    try { localStorage.setItem(TAB_KEY, key); } catch (e) { /* stockage indisponible */ }
    if (location.hash !== "#" + key) history.replaceState(null, "", "#" + key);
  }

  // ---------------------------------------------------------------- resume
  async function renderSummary() {
    const [t, p, c] = await Promise.all([API.talents(Session.userId).catch(() => null), API.getAccountPrestige(Session.userId).catch(() => null), API.constellations(Session.userId).catch(() => null)]);
    const chip = (icon, label, value, hot = false) => `<div class="pg-chip ${hot ? "hot" : ""}"><span aria-hidden="true">${icon}</span><strong>${value}</strong><small>${label}</small></div>`;
    $("pg-summary").innerHTML = [
      t ? chip("🌟", "niveau de compte", t.level) : "",
      p ? chip("⭐", "étoiles de prestige", p.stars) : "",
      t ? chip("🌳", "points de talent à placer", t.available, t.available > 0) : "",
      c ? chip("🌌", "constellations allumées", `${c.lit}/${c.total}`) : "",
      sky ? chip("✨", "points d'étoile à dépenser", sky.available, sky.available > 0) : ""
    ].join("");
  }

  // ---------------------------------------------------------------- arbre celeste
  function renderSky() {
    const box = $("sky-tree");
    if (!sky) return;
    const byKey = new Map(sky.nodes.map((n) => [n.key, n]));
    const lines = [];
    sky.nodes.forEach((n) => (n.links || []).forEach((k) => { const m = byKey.get(k); if (m) lines.push(`<line x1="${m.x}" y1="${m.y}" x2="${n.x}" y2="${n.y}" class="sk-link ${n.lit && m.lit ? "on" : (n.lit || m.lit) ? "half" : ""}" />`); }));
    sky.nodes.filter((n) => n.requires).forEach((n) => n.requires.forEach((k) => { const m = byKey.get(k); if (m) lines.push(`<line x1="${m.x}" y1="${m.y}" x2="${n.x}" y2="${n.y}" class="sk-link req ${n.lit ? "on" : m.lit ? "half" : ""}" />`); }));
    const stars = sky.nodes.map((n) => {
      const cls = n.lit ? "lit" : n.canLight ? "can" : n.reachable ? "reach" : "off";
      const r = n.key === "polaris" ? 3.4 : n.key === "supernova" ? 4 : n.cost >= 2 ? 2.6 : 2.2;
      return `<g class="sk-star ${cls} ${selected === n.key ? "sel" : ""}" data-star="${n.key}" tabindex="0" role="button" aria-label="${esc(n.label)} : ${n.lit ? "allumée" : n.canLight ? "à allumer" : "verrouillée"}">
        <circle class="sk-halo" cx="${n.x}" cy="${n.y}" r="${r * 2.2}" />
        <circle class="sk-core" cx="${n.x}" cy="${n.y}" r="${r}" />
        <text x="${n.x}" y="${n.y + r + 3.6}" class="sk-label">${esc(n.label)}</text>
        ${!n.lit && n.cost ? `<text x="${n.x}" y="${n.y + 1}" class="sk-cost">${n.cost}</text>` : ""}
      </g>`;
    }).join("");
    const bg = Array.from({ length: 70 }, (_, i) => { const x = (i * 37.7) % 100, y = (i * 61.3) % 100; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.15 + (i % 4) * 0.08).toFixed(2)}" class="sk-dust" style="--d:${(i % 7) * 0.6}s" />`; }).join("");
    const n = byKey.get(selected) || byKey.get("polaris");
    const totals = Object.entries(sky.totals || {}).map(([k, v]) => (EFFECTS[k] ? EFFECTS[k](v) : "")).filter(Boolean);
    box.innerHTML = `
      <div class="sk-bar">
        <span class="sk-points ${sky.available > 0 ? "hot" : ""}">✨ <strong>${sky.available}</strong> point${sky.available > 1 ? "s" : ""} d'étoile à dépenser</span>
        <span class="muted">${sky.spent} dépensé${sky.spent > 1 ? "s" : ""} / ${sky.points} gagné${sky.points > 1 ? "s" : ""} · ${sky.totalCost} pour tout allumer</span>
        ${sky.nodes.filter((x) => x.lit).length > 1 || (sky.nebulae || []).some((x) => x.rank) ? `<button type="button" class="btn-ghost" id="sk-reset">Tout éteindre (${sky.resetCost} ✨)</button>` : ""}
      </div>
      <div class="sk-layout">
        <svg class="sk-map" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Carte du ciel">
          <defs><radialGradient id="skGlow"><stop offset="0" stop-color="#fff7cc" /><stop offset="0.5" stop-color="#fcd34d" /><stop offset="1" stop-color="#f59e0b" stop-opacity="0" /></radialGradient></defs>
          ${bg}${lines.join("")}${stars}
        </svg>
        <aside class="sk-detail">
          <div class="sk-detail-head"><span class="sk-detail-icon ${n.lit ? "lit" : ""}" aria-hidden="true">${n.icon}</span><div><strong>${esc(n.label)}</strong><small>${n.arm && sky.arms[n.arm] ? `${sky.arms[n.arm].icon} Bras ${esc(sky.arms[n.arm].label)}` : n.key === "supernova" ? "Étoile ultime" : "Centre du ciel"}</small></div></div>
          <p>${esc(n.desc)}</p>
          ${n.lit ? '<p class="sk-state on">✓ Allumée</p>' : n.canLight ? `<button type="button" class="btn" id="sk-light" data-key="${n.key}">✨ Allumer (${n.cost} point${n.cost > 1 ? "s" : ""})</button>` : n.reachable ? `<p class="sk-state">Il te faut ${n.cost} point${n.cost > 1 ? "s" : ""} d'étoile (tu en as ${sky.available}). Allume des constellations !</p>` : `<p class="sk-state">${n.requires ? `Allume d'abord ${n.requires.map((k) => esc(byKey.get(k)?.label || k)).join(", ")}.` : "Allume d'abord une étoile reliée à celle-ci."}</p>`}
          <div class="sk-totals"><h3>Bonus de ton ciel</h3>${totals.length ? `<ul>${totals.map((t) => `<li>${t}</li>`).join("")}</ul>` : '<p class="muted">Aucun pour l\'instant.</p>'}</div>
        </aside>
      </div>
      ${nebulaeHtml()}`;
  }
  // Nebuleuses : bonus a rangs illimites (rang N = N points d'etoile).
  function nebulaeHtml() {
    if (!sky.nebulae) return "";
    return `<div class="sk-nebulae">
      <h3>🌌 Nébuleuses <small>améliorables sans fin · rang suivant = rang actuel + 1 point${sky.fromEmeralds ? ` · dont ${sky.fromEmeralds} point${sky.fromEmeralds > 1 ? "s" : ""} grâce à tes cartes émeraude` : ""}</small></h3>
      <div class="sk-neb-grid">${sky.nebulae.map((n) => `
        <article class="sk-neb ${n.open ? "" : "locked"} ${n.rank ? "on" : ""}">
          <header><span aria-hidden="true">${n.icon}</span><strong>${esc(n.label)}</strong><span class="sk-neb-rank">rang ${n.rank}</span></header>
          <p>${n.effect ? esc(n.effect) : "Aucun bonus pour l'instant"}</p>
          ${n.open ? `<small>Rang suivant : ${esc(n.next)}</small>
            <button type="button" class="btn${n.canBuy ? "" : "-secondary"}" data-neb="${n.key}" ${n.canBuy ? "" : "disabled"}>✨ ${n.cost} point${n.cost > 1 ? "s" : ""}</button>`
            : `<small>S'ouvre en allumant ${esc(n.opensLabel)} (ou la Supernova).</small>`}
        </article>`).join("")}</div>
    </div>`;
  }

  // ---------------------------------------------------------------- ameliorations permanentes
  function renderUpgrades(st) {
    const grid = $("upgrade-grid");
    if (!grid) return;
    const fmt = fmtNum;
    grid.innerHTML = st.upgrades.map((u) => `
      <article class="upgrade-card ${u.next ? "" : "maxed"}">
        <div class="upgrade-head"><span class="upgrade-icon" aria-hidden="true">${u.icon}</span><strong>${esc(u.label)}</strong><span class="upgrade-level">niv. ${u.level}/${u.max}</span></div>
        <div class="upgrade-pips" aria-hidden="true">${Array.from({ length: u.max }, (_, i) => `<span class="${i < u.level ? "on" : ""}"></span>`).join("")}</div>
        <p class="upgrade-effect">${u.level ? esc(u.effect) : "Aucun bonus pour l'instant"}</p>
        ${u.next ? `<p class="upgrade-next">Niveau suivant : ${esc(u.next.effect)}</p>
          <button type="button" class="btn${st.stardust < u.next.price ? "-secondary" : ""} upgrade-buy" data-upgrade="${u.key}" ${st.stardust < u.next.price ? "disabled" : ""}>${fmt(u.next.price)} &#10024;</button>` : '<p class="upgrade-next">Niveau maximum atteint</p>'}
      </article>`).join("");
  }
  function loadUpgrades() {
    if (!API.upgrades) return;
    API.upgrades(Session.userId).then(renderUpgrades).catch(() => { const s = $("ameliorations"); if (s) s.hidden = true; });
  }
  async function loadSky() {
    try { sky = await API.skyTree(Session.userId); renderSky(); } catch (e) { $("sky-tree").innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!Session.isLoggedIn()) { $("pg-guest").style.display = "block"; document.querySelector(".pg-tabs").hidden = true; document.querySelectorAll(".pg-pane").forEach((p) => { p.hidden = true; }); return; }
    let tab = (location.hash || "").replace("#", "");
    if (!["talents", "ciel", "maitrises"].includes(tab)) { try { tab = localStorage.getItem(TAB_KEY) || "talents"; } catch (e) { tab = "talents"; } }
    showTab(["talents", "ciel", "maitrises"].includes(tab) ? tab : "talents");
    document.querySelector(".pg-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-pg]"); if (b) showTab(b.dataset.pg); });
    if (typeof window.renderOwnProgress === "function") window.renderOwnProgress();
    loadUpgrades();
    $("upgrade-grid").addEventListener("click", async (e) => {
      const up = e.target.closest("[data-upgrade]");
      if (!up) return;
      up.disabled = true;
      try {
        const res = await API.upgrades(Session.userId, "buy", up.dataset.upgrade);
        renderUpgrades(res);
        Toast.success(`&#128736;&#65039; Amélioration niveau ${res.level} !`);
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) { up.disabled = false; Toast.error(err.code === "not_enough_dust" ? "Pas assez de poussières." : friendlyError(err)); }
    });
    await loadSky();
    renderSummary();
    const tree = $("sky-tree");
    const pick = (e) => { const g = e.target.closest("[data-star]"); if (g) { selected = g.dataset.star; renderSky(); } };
    tree.addEventListener("click", async (e) => {
      if (e.target.closest("[data-star]")) return pick(e);
      if (e.target.closest("#sk-light")) {
        const key = e.target.closest("#sk-light").dataset.key;
        try {
          sky = await API.skyTree(Session.userId, "light", key);
          const n = sky.nodes.find((x) => x.key === key);
          Toast.success(`✨ ${esc(n ? n.label : "Étoile")} s'allume !`);
          if (typeof confetti === "function") confetti({ particleCount: 70, spread: 70, colors: ["#fde68a", "#ffffff", "#7dd3fc"], origin: { y: 0.45 } });
          renderSky(); renderSummary();
        } catch (err) { Toast.error({ no_star_points: "Pas assez de points d'étoile : allume des constellations !", star_unreachable: "Cette étoile n'est reliée à aucune étoile allumée." }[err.code] || friendlyError(err)); }
      }
      if (e.target.closest("[data-neb]")) {
        const key = e.target.closest("[data-neb]").dataset.neb;
        try {
          sky = await API.skyTree(Session.userId, "nebula", key);
          const n = sky.nebulae.find((x) => x.key === key);
          Toast.success(`🌌 ${esc(n ? n.label : "Nébuleuse")} : rang ${n ? n.rank : ""} !`);
          renderSky(); renderSummary();
        } catch (err) { Toast.error(err.code === "no_star_points" ? "Pas assez de points d'étoile." : friendlyError(err)); }
        return;
      }
      if (e.target.closest("#sk-reset")) {
        if (!(await Confirm.show(`Éteindre toutes les étoiles de ton ciel pour ${sky.resetCost} poussières ? Tes points d'étoile te seront rendus.`, { title: "Tout éteindre", confirmText: "Éteindre" }))) return;
        try { sky = await API.skyTree(Session.userId, "reset"); renderSky(); renderSummary(); Toast.success("Ciel éteint : tes points sont rendus."); } catch (err) { Toast.error(err.code === "not_enough_dust" ? "Pas assez de poussières." : friendlyError(err)); }
      }
    });
    tree.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-star]")) { e.preventDefault(); pick(e); } });
    // Une constellation recuperee peut donner un point d'etoile : on rafraichit l'arbre.
    $("sky-grid").addEventListener("click", (e) => { if (e.target.closest("[data-sky]")) setTimeout(() => { loadSky().then(renderSummary); }, 800); });
  });
})();
