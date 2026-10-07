// Collection (2026-10-07) : maitrise des extensions (3 couches, niveaux 1 a
// 10), constellations (40 etoiles de 5 cartes) et cours du decraft de la
// semaine dans le mode Decrafter.
// Voir api/src/native/progression.js et market.js.

(function () {
  if (!Session.isLoggedIn()) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = (x) => Math.round((x || 0) * 100);
  const LAYERS = [["cards", "Cartes", "&#127183;"], ["qualities", "États", "&#128142;"], ["finishes", "Finitions", "&#127752;"]];

  function renderMastery(st) {
    const panel = $("mastery-panel");
    if (!st.extensions.length) return;
    panel.hidden = false;
    $("mastery-count").textContent = st.claimable ? `${st.claimable} à récupérer` : `${st.extensions.filter((e) => e.level === 10).length}/${st.extensions.length} au niveau 10`;
    $("mastery-count").classList.toggle("has-claim", !!st.claimable);
    $("mastery-grid").innerHTML = st.extensions.map((e) => `
      <article class="mastery-card lvl-${e.level}">
        <header>
          <span class="mastery-level" title="Niveau de maîtrise">${e.level}</span>
          <div><strong>${esc(e.name)}</strong><small>+${(e.finishBonus * 100).toFixed(1)} pt de finition spéciale · ${e.score} %</small></div>
        </header>
        ${LAYERS.map(([k, label, icon]) => `
          <div class="mastery-layer ${e.layers[k].pct >= 1 ? "full" : ""}">
            <span class="mastery-layer-label">${icon} ${label}</span>
            <span class="mastery-bar" role="progressbar" aria-valuenow="${pct(e.layers[k].pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct(e.layers[k].pct)}%"></span></span>
            <span class="mastery-layer-num">${e.layers[k].owned}/${e.layers[k].total}</span>
          </div>`).join("")}
        ${e.pending.length ? `<button type="button" class="btn mastery-claim" data-ext="${e.extensionId}" title="${e.pending.map((p) => esc(p.label)).join(", ")}">Récupérer ${e.pending.length} récompense${e.pending.length > 1 ? "s" : ""} (${e.pending.reduce((s, p) => s + p.dust, 0)} &#10024;${e.pending.reduce((s, p) => s + p.boosters, 0) ? ` + ${e.pending.reduce((s, p) => s + p.boosters, 0)} &#127183;` : ""})</button>` : ""}
      </article>`).join("");
  }

  function renderSky(st) {
    if (!st.total) return;
    $("sky-panel").hidden = false;
    $("sky-count").textContent = st.claimable ? `${st.claimable} à récupérer` : `${st.lit}/${st.total} étoiles`;
    $("sky-count").classList.toggle("has-claim", !!st.claimable);
    $("sky-grid").innerHTML = `
      <div class="sky-summary">
        <span>&#10024; ${st.dustPerStar} poussières par étoile · ciel complet : ${st.skyBoosters} boosters et le titre « Astronome »</span>
        ${st.skyComplete && !st.skyClaimed ? `<button type="button" class="btn" data-sky="sky">Récupérer le ciel complet</button>` : ""}
      </div>` + st.stars.map((s) => `
      <article class="sky-star ${s.lit ? "lit" : ""} ${s.claimed ? "claimed" : ""}" title="${esc(s.name)} : ${s.owned}/${s.cards.length}">
        <header><span class="sky-icon" aria-hidden="true">${s.lit ? "&#11088;" : "&#9734;"}</span><strong>${esc(s.name)}</strong><small>${s.owned}/${s.cards.length}</small></header>
        <div class="sky-cards">${s.cards.map((c) => `<span class="sky-card ${c.owned ? "owned" : ""}" style="--r:${esc(c.rarity?.colorHex || "#888")}" title="${esc(c.name)}">${c.owned && c.imageId ? `<img src="${API.imageUrl(c.imageId)}" alt="" loading="lazy" />` : "?"}</span>`).join("")}</div>
        ${s.lit && !s.claimed ? `<button type="button" class="btn-secondary sky-claim" data-sky="${s.key}">Allumer (+${st.dustPerStar} &#10024;)</button>` : ""}
      </article>`).join("");
  }

  async function renderRates() {
    try {
      const r = await API.getExchangeRates();
      if (!r.swing) return;
      const strip = $("rates-strip");
      strip.hidden = false;
      strip.innerHTML = `<span class="rates-title">&#128200; Cours du décraft cette semaine</span>` + r.rates.map((x) => `<span class="rate ${x.factor > 1 ? "up" : x.factor < 1 ? "down" : ""}" style="--r:${esc(x.colorHex || "#888")}" title="Valeur de base ${x.base}, ×${x.factor.toFixed(2)} selon l'offre et la demande de la semaine passée">${esc(x.name)} <strong>${x.value}</strong> ${x.factor > 1 ? "&#9650;" : x.factor < 1 ? "&#9660;" : "="}</span>`).join("");
    } catch (e) { /* cours indisponible */ }
  }

  const load = () => {
    API.mastery(Session.userId).then(renderMastery).catch(() => {});
    API.constellations(Session.userId).then(renderSky).catch(() => {});
  };

  document.addEventListener("DOMContentLoaded", () => {
    load();
    renderRates();
    $("mastery-grid").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-ext]");
      if (!btn) return;
      btn.disabled = true;
      try {
        const res = await API.mastery(Session.userId, "claim", Number(btn.dataset.ext));
        Toast.success(`&#127941; Maîtrise : +${res.claimed.dust} poussières${res.claimed.boosters ? ` et +${res.claimed.boosters} booster${res.claimed.boosters > 1 ? "s" : ""}` : ""} !`);
        if (typeof confetti === "function") confetti({ particleCount: 80, spread: 80, origin: { y: 0.5 } });
        renderMastery(res);
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) { btn.disabled = false; Toast.error("Erreur. (" + err.message + ")"); }
    });
    $("sky-grid").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-sky]");
      if (!btn) return;
      btn.disabled = true;
      try {
        const res = await API.constellations(Session.userId, "claim", btn.dataset.sky);
        Toast.success(btn.dataset.sky === "sky" ? `&#127756; Le ciel est complet : +${res.claimed.boosters} boosters et le titre « Astronome » !` : `&#11088; Étoile allumée : +${res.claimed.dust} poussières !`);
        if (typeof confetti === "function") confetti({ particleCount: 60, spread: 70, colors: ["#ffd76e", "#ffffff", "#7dd3fc"], origin: { y: 0.4 } });
        renderSky(res);
      } catch (err) { btn.disabled = false; Toast.error("Erreur. (" + err.message + ")"); }
    });
  });
})();
