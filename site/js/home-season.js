// Evenement saisonnier sur l'accueil (2026-10-15) : carte du cadeau du jour
// (bonbon ou sort a Halloween, calendrier de l'Avent a Noel...).
// Donnees : api/src/native/seasonal.js ; theme pose par shell.js.

(function () {
  const esc = escHtml;
  const until = (t) => new Date(t * 1000).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  function render(st) {
    const box = document.getElementById("seasonal-treat");
    if (!box) return;
    const s = st && st.season;
    if (!s) { box.hidden = true; return; }
    box.hidden = false;
    box.dataset.season = s.key;
    box.innerHTML = `
      <span class="season-icon" aria-hidden="true">${s.icon}</span>
      <div class="season-text">
        <strong>${esc(s.label)}</strong>
        <small>Jusqu'au ${esc(until(s.endsAt - 60))} : édition limitée ${esc((EDITIONS[s.edition] || {}).label || "")} dans les boosters, ${esc(s.drop.name)} à trouver en jouant${s.boss ? `, et ${esc(s.boss)} à affronter` : ""}.</small>
      </div>
      <button type="button" class="btn season-claim" data-season-claim ${st.claimedToday ? "disabled" : ""}>${st.claimedToday ? "Reviens demain" : esc(s.treat)}</button>`;
  }

  async function load() {
    if (!Session.isLoggedIn() || !API.seasonal) return;
    try { render(await API.seasonal(Session.userId)); } catch (e) { /* facultatif */ }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const box = document.getElementById("seasonal-treat");
    if (!box) return;
    load();
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-season-claim]");
      if (!b) return;
      b.disabled = true;
      try {
        const r = await API.seasonal(Session.userId, "claim");
        render(r);
        (r.reward.kind === "trick" ? Toast.error : Toast.success)(esc(r.reward.label));
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) {
        b.disabled = false;
        Toast.error(err.code === "already_claimed" ? "Déjà récupéré aujourd'hui." : "Erreur. (" + err.message + ")");
      }
    });
  });
})();
