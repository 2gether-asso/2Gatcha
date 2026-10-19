// Musee du coffre-fort (2026-10-18, api/src/native/museum.js) : onglet de la
// page Coffre-fort. Vitrines poissons / mineraux / objets / dinos ; une piece
// jamais eue s'affiche en silhouette.

(function () {
  const esc = escHtml;
  let loaded = false;
  const RARITY = { commune: "Commune", rare: "Rare", epique: "Épique", legendaire: "Légendaire", mythique: "Mythique" };
  const art = (it) => (it.img ? `<img src="assets/${encodeURI(it.img)}"${it.gold ? ' class="ico-gold"' : ""} alt="" loading="lazy" decoding="async" />` : `<span class="mu-emoji" aria-hidden="true">${it.icon || "?"}</span>`);

  function render(v) {
    const box = document.getElementById("museum-zone");
    box.innerHTML = `
      <div class="mu-head">
        <strong>${v.seen} / ${v.total} pièces exposées</strong><span class="muted">${v.pct} %</span>
        <div class="st-progress"><span style="width:${v.pct}%"></span></div>
      </div>
      ${v.badges ? `<div class="mu-badges">${v.badges.map((b) => `<span class="mu-badge ${b.earned ? "earned" : ""}" title="${b.earned ? "Badge obtenu (titre à équiper dans ta boutique)" : "Complète la vitrine pour l'obtenir"}">${b.icon} ${esc(b.label)}</span>`).join("")}</div>` : ""}
      ${v.sections.map((s) => `
        <section class="mu-section">
          <h2>${s.icon} ${esc(s.title)} <small>${s.seen} / ${s.total}</small></h2>
          <p class="muted mu-hint">${esc(s.hint)}</p>
          <div class="mu-grid">${s.items.map((it) => `
            <figure class="mu-item ${it.seen ? "" : "unseen"}" ${it.rarity ? `data-rarity="${it.rarity}"` : ""} ${it.tier ? `data-tier="${it.tier}"` : ""} title="${esc(it.seen ? it.detail : "Pas encore trouvé")}">
              <div class="mu-art">${art(it)}</div>
              <figcaption><strong>${it.seen ? esc(it.name) : "?"}</strong>${it.seen ? `<small>${esc(it.rarity ? RARITY[it.rarity] || "" : it.tier ? "Palier " + it.tier : "")}</small>` : ""}</figcaption>
            </figure>`).join("")}</div>
        </section>`).join("")}`;
  }

  async function load() {
    if (loaded || !Session.isLoggedIn()) return;
    const box = document.getElementById("museum-zone");
    try {
      const v = await API.post("museum", { userId: Session.userId });
      render(v); loaded = true;
      (v.newBadges || []).forEach((t, i) => setTimeout(() => Toast.success(`&#127963;&#65039; Badge du musée : « ${esc(t)} » !`), 400 + i * 700));
    }
    catch (e) { box.innerHTML = `<p class="empty-state">Musée indisponible pour le moment.</p>`; }
  }

  function show(view) {
    const museum = view === "museum";
    document.getElementById("vault-view").hidden = museum;
    document.getElementById("museum-view").hidden = !museum;
    document.querySelectorAll("[data-coffre-view]").forEach((b) => { const on = b.dataset.coffreView === view; b.classList.toggle("active", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    if (museum) load();
    try { history.replaceState(null, "", museum ? "#musee" : location.pathname); } catch (e) { /* adresse inchangee */ }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const nav = document.getElementById("coffre-switch");
    if (!nav) return;
    if (!Session.isLoggedIn()) { nav.hidden = true; return; }
    nav.addEventListener("click", (e) => { const b = e.target.closest("[data-coffre-view]"); if (b) show(b.dataset.coffreView); });
    if (location.hash === "#musee") show("museum");
  });
})();
