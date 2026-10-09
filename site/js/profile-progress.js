// Mon profil (2026-10-07) : arbre de talents et maitrises de succes (paliers
// I, II, III a reclamer). Affiche seulement sur son propre profil.
// Voir api/src/native/talents.js et progression.js.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ROMAN = ["I", "II", "III"];

  // Prestige du compte (2026-10-09) : etoiles au-dela des talents complets.
  function prestigeBlock(p) {
    if (!p) return "";
    const toNext = Math.max(0, p.nextLevel - p.level);
    return `<div class="account-prestige ${p.stars ? "has-stars" : ""}">
      <span class="ap-stars" aria-hidden="true">${p.stars ? "★".repeat(Math.min(p.stars, 5)) + (p.stars > 5 ? " ×" + p.stars : "") : "☆"}</span>
      <div class="ap-body"><strong>${p.stars ? `Prestige du compte : ${p.stars} étoile${p.stars > 1 ? "s" : ""}` : "Prestige du compte"}</strong>
      <small>${p.stars ? `+${p.stars} point${p.stars > 1 ? "s" : ""} de talent, titres « Prestige » et cadre doré débloqués. ` : `Première étoile au niveau ${p.startLevel} : +1 point de talent, un titre et un cadre. `}Prochaine étoile au niveau ${p.nextLevel}${toNext ? ` (encore ${toNext} niveau${toNext > 1 ? "x" : ""})` : ""}, puis tous les ${p.step} niveaux.</small></div>
    </div>`;
  }
  let prestige = null;

  function renderTalents(st) {
    const box = $("talents-panel");
    box.innerHTML = prestigeBlock(prestige) + `
      <div class="talents-head">
        <h2>&#127795; Talents</h2>
        <span class="talents-points ${st.available ? "has-points" : ""}">${st.available} point${st.available > 1 ? "s" : ""} à dépenser · ${st.spent}/${st.points}</span>
        ${st.spent ? `<button type="button" class="btn-ghost" id="talents-reset">Tout réinitialiser (${st.resetCost} &#10024;)</button>` : ""}
      </div>
      <p class="lead" style="font-size:0.85rem;">Un point par niveau de compte (et un par étoile de prestige). Chaque branche a un talent ultime qui demande 6 points dans la branche : à toi de choisir ta spécialité.</p>
      <div class="talent-tree">${st.branches.map((b) => `
        <div class="talent-branch">
          <h3>${b.icon} ${esc(b.label)} <small>${b.spent} pt${b.spent > 1 ? "s" : ""}</small></h3>
          ${st.talents.filter((t) => t.branch === b.key).map((t) => `
            <button type="button" class="talent ${t.rank ? "learned" : ""} ${t.rank >= t.max ? "maxed" : ""} ${t.locked ? "locked" : ""} ${t.req ? "ultimate" : ""}" data-talent="${t.key}" ${t.canLearn ? "" : "aria-disabled=\"true\""} title="${esc(t.desc)}">
              <span class="talent-icon" aria-hidden="true">${t.icon}</span>
              <span class="talent-body"><strong>${esc(t.label)}</strong><small>${esc(t.desc)}</small></span>
              <span class="talent-rank">${t.locked ? `&#128274; ${t.req} pts` : `${t.rank}/${t.max}`}</span>
            </button>`).join("")}
        </div>`).join("")}</div>`;
  }

  function renderTiers(st) {
    const box = $("tiers-panel");
    box.innerHTML = `
      <div class="talents-head">
        <h2>&#127941; Maîtrises</h2>
        ${st.claimable ? `<button type="button" class="btn" id="tiers-claim-all">Tout récupérer (${st.claimable})</button>` : ""}
      </div>
      <p class="lead" style="font-size:0.85rem;">Trois paliers par grand compteur du jeu. Le palier III donne un titre à équiper dans la boutique.</p>
      <div class="tiers-grid">${st.families.map((f) => {
        const next = f.tiers.find((t) => !t.reached);
        const goal = next ? next.target : f.tiers[f.tiers.length - 1].target;
        const p = Math.min(100, Math.round((f.value / goal) * 100));
        return `
          <article class="tier-card lvl-${f.level}">
            <header><span aria-hidden="true">${f.icon}</span><strong>${esc(f.label)}</strong><span class="tier-roman">${f.level ? ROMAN[f.level - 1] : "–"}</span></header>
            <div class="tier-steps">${f.tiers.map((t) => `<span class="tier-step ${t.reached ? "reached" : ""} ${t.claimed ? "claimed" : ""}" title="Palier ${ROMAN[t.tier - 1]} : ${t.target.toLocaleString("fr-FR")} ${esc(f.unit)} · ${t.dust} &#10024;">${ROMAN[t.tier - 1]}</span>`).join("")}</div>
            <div class="mastery-bar"><span style="width:${p}%"></span></div>
            <small>${f.value.toLocaleString("fr-FR")} / ${goal.toLocaleString("fr-FR")} ${esc(f.unit)}${f.level === 3 ? ` · titre « ${esc(f.title)} »` : ""}</small>
          </article>`;
      }).join("")}</div>`;
  }

  async function load() {
    $("own-progress").hidden = false;
    try { prestige = await API.getAccountPrestige(Session.userId); } catch (e) { prestige = null; }
    try { renderTalents(await API.talents(Session.userId)); } catch (e) { $("talents-panel").innerHTML = ""; }
    try { renderTiers(await API.achievementTiers(Session.userId)); } catch (e) { $("tiers-panel").innerHTML = ""; }
    if (location.hash === "#talents") $("talents").scrollIntoView({ behavior: "smooth" });
  }

  window.renderOwnProgress = load;

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-talent]");
    if (t && !t.hasAttribute("aria-disabled")) {
      t.disabled = true;
      try {
        const st = await API.talents(Session.userId, "learn", t.dataset.talent);
        renderTalents(st);
        const def = st.talents.find((x) => x.key === st.learned);
        Toast.success(`&#127795; ${def ? esc(def.label) + " : rang " + def.rank : "Talent appris"} !`);
      } catch (err) { t.disabled = false; Toast.error({ no_points: "Plus de point à dépenser : monte de niveau !", talent_locked: "Il faut d'abord 6 points dans cette branche." }[err.code] || "Erreur. (" + err.message + ")"); }
      return;
    }
    if (e.target.closest("#talents-reset")) {
      const okReset = await Confirm.show("Réinitialiser tous tes talents ? Tes points te seront rendus pour les répartir autrement.", { title: "Réinitialiser les talents ?", confirmText: "Réinitialiser" });
      if (!okReset) return;
      try { renderTalents(await API.talents(Session.userId, "reset")); Toast.success("Talents réinitialisés."); } catch (err) { Toast.error(err.code === "not_enough_dust" ? "Pas assez de poussières." : "Erreur. (" + err.message + ")"); }
      return;
    }
    if (e.target.closest("#tiers-claim-all")) {
      try {
        const res = await API.achievementTiers(Session.userId, "claim");
        Toast.success(`&#127941; Maîtrises : +${res.claimed.dust} poussières${res.claimed.titles.length ? ` et le titre « ${res.claimed.titles.map(esc).join(" », « ")} »` : ""} !`);
        if (typeof confetti === "function") confetti({ particleCount: 90, spread: 90, origin: { y: 0.4 } });
        renderTiers(res);
      } catch (err) { Toast.error("Erreur. (" + err.message + ")"); }
    }
  });
})();
