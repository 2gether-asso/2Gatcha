// Evenement saisonnier sur l'accueil (2026-10-15) : carte du cadeau du jour
// (bonbon ou sort a Halloween, calendrier de l'Avent a Noel...).
// Donnees : api/src/native/seasonal.js ; theme pose par shell.js.

(function () {
  const esc = escHtml;
  const until = (t) => new Date(t * 1000).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  // Pas d'evenement en cours (ou API pas encore a jour) : annonce du prochain, s'il arrive dans le mois.
  function teaser(box) {
    const now = Date.now() / 1000;
    const next = SeasonCalendar.upcoming(now + 31 * 86400)[0];
    if (!next) { box.hidden = true; return; }
    const live = next.start <= now;
    const days = Math.ceil((next.start - now) / 86400);
    const d = (t) => new Date(t * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
    box.hidden = false;
    box.dataset.season = next.key;
    box.classList.add("teaser");
    box.innerHTML = `
      <span class="season-icon" aria-hidden="true">${next.icon}</span>
      <div class="season-text">
        <strong>${live ? esc(next.label) + " a commencé !" : `Prochain événement : ${esc(next.label)} ${days <= 1 ? "demain" : "dans " + days + " jours"}`}</strong>
        <small>Du ${d(next.start)} au ${d(next.end - 60)} : édition limitée ${esc((EDITIONS[next.edition] || {}).label || "")}, cadeau du jour${next.boss ? `, ${esc(next.boss)} au boss commun` : ""}.</small>
      </div>
      <a class="btn-ghost season-claim" href="communaute.html#calendrier">Voir le calendrier</a>`;
  }

  function render(st) {
    const box = document.getElementById("seasonal-treat");
    if (!box) return;
    const s = st && st.season;
    if (!s) { teaser(box); return; }
    box.classList.remove("teaser");
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
    if (!Session.isLoggedIn()) return;
    try { render(API.seasonal ? await API.seasonal(Session.userId) : null); } catch (e) { render(null); }
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
