// Collections thematiques (collection.html, 2026-10-05) : objectifs
// transverses (5 dorees, une carte de chaque artiste...), voir
// api/src/native/achievements.js.

(function () {
  if (!Session.isLoggedIn()) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function render(st) {
    const panel = document.getElementById("themes-panel");
    if (!panel || !st) return;
    panel.hidden = false;
    const done = st.themes.filter((t) => t.claimed).length;
    document.getElementById("themes-count").innerHTML = `${done}/${st.themes.length}${st.claimable ? ` · <strong>${st.claimable} à réclamer !</strong>` : ""}`;
    if (st.claimable) panel.open = true;
    document.getElementById("themes-grid").innerHTML = st.themes.map((t) => {
      const pct = Math.round((t.have / t.need) * 100);
      return `<div class="theme-card ${t.done ? "done" : ""} ${t.claimed ? "claimed" : ""}">
        <span class="theme-icon" aria-hidden="true">${t.icon}</span>
        <div class="theme-body">
          <div class="theme-label">${esc(t.label)}</div>
          <div class="theme-desc">${esc(t.desc)}</div>
          <div class="challenge-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
          <div class="theme-meta">${t.have} / ${t.need} · titre « ${esc(t.title)} »${t.claimed ? " · obtenu" : ""}</div>
        </div>
        ${t.done && !t.claimed ? `<button type="button" class="btn" data-theme="${t.key}">Réclamer</button>` : ""}
      </div>`;
    }).join("");
  }

  document.addEventListener("DOMContentLoaded", () => {
    API.themes(Session.userId).then(render).catch(() => {});
    document.getElementById("themes-grid")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-theme]");
      if (!btn) return;
      btn.disabled = true;
      try {
        const res = await API.themes(Session.userId, "claim", btn.dataset.theme);
        render(res);
        Toast.success(`&#127912; Collection terminée : +${res.dust} poussières et le titre « ${res.claimedNow.map((c) => c.title).join(", ")} » !`);
        if (typeof confetti === "function") confetti({ particleCount: 140, spread: 100, origin: { y: 0.5 } });
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) { btn.disabled = false; Toast.error("Erreur. (" + err.message + ")"); }
    });
  });
})();
