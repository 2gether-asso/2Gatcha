// Accueil plus court (2026-10-21) :
// - « A recuperer » compact : une ligne d'icones (home-extras.js #rc-summary),
//   le detail se deplie et le choix est garde sur l'appareil ;
// - chaque panneau du tableau de bord se replie depuis son titre ; les
//   panneaux secondaires (succes, activite, direct, progression, quetes de la
//   semaine, saison) sont replies par defaut. Choix garde sur l'appareil.

(function () {
  const KEY = "2gatcha_home_fold";
  const RC_KEY = "2gatcha_rc_open";
  const FOLDED_BY_DEFAULT = ["achievements-panel", "activity-panel", "live-feed-panel", "pass-panel", "weekly-quests-panel", "season-panel"];
  const SKIP = ["rewards-center", "weekly-recap", "whatnow-panel"];
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { prefs = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* stockage indisponible */ } };
  const folded = (id) => (id in prefs ? prefs[id] : FOLDED_BY_DEFAULT.includes(id));

  function setFolded(panel, on) {
    panel.classList.toggle("is-folded", on);
    const btn = panel.querySelector(":scope > .fold-head .fold-btn");
    if (btn) { btn.setAttribute("aria-expanded", String(!on)); btn.title = on ? "Déplier" : "Replier"; }
  }

  function wire(panel) {
    // Panneaux ranges dans un autre (onglets des objectifs) : pas de second repli.
    if (panel._fold || !panel.id || SKIP.includes(panel.id) || panel.parentElement.closest(".panel")) return;
    const h2 = panel.querySelector("h2");
    if (!h2) return;
    // En-tete = l'enfant direct du panneau qui contient le titre.
    let head = h2;
    while (head.parentElement && head.parentElement !== panel) head = head.parentElement;
    if (head.parentElement !== panel) return;
    panel._fold = true;
    head.classList.add("fold-head");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fold-btn";
    btn.setAttribute("aria-label", "Replier ou déplier : " + h2.textContent.trim());
    btn.innerHTML = '<span aria-hidden="true">&#9662;</span>';
    head.appendChild(btn);
    head.addEventListener("click", (e) => {
      // Les boutons et liens de l'en-tete gardent leur role.
      if (e.target.closest("a, button:not(.fold-btn), input, select, label")) return;
      const on = !panel.classList.contains("is-folded");
      setFolded(panel, on);
      prefs[panel.id] = on;
      save();
    });
    setFolded(panel, folded(panel.id));
  }

  function init() {
    document.querySelectorAll(".home-layout .panel, .home-wide .panel").forEach(wire);
    const rc = document.getElementById("rewards-center");
    if (rc) {
      let open = false;
      try { open = localStorage.getItem(RC_KEY) === "1"; } catch (e) { /* stockage indisponible */ }
      rc.classList.toggle("rc-open", open);
      rc.addEventListener("click", (e) => {
        const t = e.target.closest(".rc-toggle");
        if (!t) return;
        const on = rc.classList.toggle("rc-open");
        t.setAttribute("aria-expanded", String(on));
        try { localStorage.setItem(RC_KEY, on ? "1" : "0"); } catch (err) { /* stockage indisponible */ }
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
