// Accueil (2026-10-11) : quetes du jour, quetes de la semaine, defis et
// missions du soir regroupes dans un seul panneau a onglets. Les panneaux
// existants sont deplaces tels quels (leurs scripts continuent de les
// remplir) ; un onglet n'apparait que si son contenu est charge, porte une
// pastille quand il y a quelque chose a recuperer, et l'onglet choisi est
// celui qui a une recompense en attente, sinon le dernier consulte.

(function () {
  if (typeof Session === "undefined" || !Session.isLoggedIn()) return;
  const KEY = "2gatcha_obj_tab";
  const PANES = [
    { id: "quests-panel", label: "Du jour", icon: "&#9989;", claim: (el) => [...el.querySelectorAll("button")].some((b) => /récupérer|reclamer|réclamer/i.test(b.textContent) && !b.disabled && !b.hidden && b.style.display !== "none") },
    { id: "challenges-panel", label: "Défis", icon: "&#127919;", claim: () => { const b = document.getElementById("challenges-claim"); return !!b && !b.hidden; } },
    { id: "weekly-quests-panel", label: "Semaine", icon: "&#128197;", claim: (el) => [...el.querySelectorAll("button")].some((b) => /récupérer|réclamer/i.test(b.textContent) && !b.disabled && !b.hidden && b.style.display !== "none") },
    { id: "evening-block", label: "Ce soir", icon: "&#127769;", claim: () => { const b = document.getElementById("evening-claim"); return !!b && !b.hidden; } }
  ];
  let active = null;
  try { active = localStorage.getItem(KEY); } catch (e) { /* stockage indisponible */ }

  const loaded = (el) => el && !el.hidden && el.style.display !== "none";

  function render() {
    const panel = document.getElementById("objectives-panel");
    const tabs = document.getElementById("obj-tabs");
    if (!panel || !tabs) return;
    const list = PANES.map((p) => ({ ...p, el: document.getElementById(p.id) })).filter((p) => loaded(p.el));
    panel.hidden = !list.length;
    if (!list.length) return;
    const withClaim = list.filter((p) => p.claim(p.el));
    if (!list.some((p) => p.id === active)) active = (withClaim[0] || list[0]).id;
    tabs.innerHTML = list.map((p) => `
      <button type="button" role="tab" class="obj-tab ${p.id === active ? "active" : ""}" aria-selected="${p.id === active}" data-obj="${p.id}">
        <span aria-hidden="true">${p.icon}</span> ${p.label}${withClaim.includes(p) ? '<span class="obj-dot" title="À récupérer"></span>' : ""}
      </button>`).join("");
    PANES.forEach((p) => { const el = document.getElementById(p.id); if (el) el.classList.toggle("obj-inactive", p.id !== active); });
  }

  let pending = null;
  const schedule = () => { clearTimeout(pending); pending = setTimeout(render, 60); };

  document.addEventListener("DOMContentLoaded", () => {
    const body = document.getElementById("obj-body");
    if (!body) return;
    for (const p of PANES) {
      const el = document.getElementById(p.id);
      if (!el) continue;
      el.classList.add("obj-pane");
      el.setAttribute("role", "tabpanel");
      body.appendChild(el);
      new MutationObserver(schedule).observe(el, { attributes: true, attributeFilter: ["style", "hidden", "class"], childList: true, subtree: true });
    }
    document.getElementById("obj-tabs").addEventListener("click", (e) => {
      const t = e.target.closest("[data-obj]");
      if (!t) return;
      active = t.dataset.obj;
      try { localStorage.setItem(KEY, active); } catch (err) { /* stockage indisponible */ }
      render();
    });
    if (location.hash === "#defis") active = "challenges-panel";
    render();
  });
})();
