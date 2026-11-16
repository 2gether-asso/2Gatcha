// Mon profil (2026-10-07) : arbre de talents et maitrises de succes (paliers
// I, II, III a reclamer). Affiche seulement sur son propre profil.
// Voir api/src/native/talents.js et progression.js.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const ROMAN = ["I", "II", "III"];

  // Prestige du compte (2026-10-09, revu 2026-10-17) : etoiles au-dela des
  // talents complets, progression vers la prochaine, recompenses de chaque etoile.
  function prestigeBlock(p) {
    if (!p) return "";
    const toNext = Math.max(0, p.nextLevel - p.level);
    const r = p.reward || {};
    const gives = [`+1 point de talent de prestige`, r.boosters ? `${r.boosters} jeton${r.boosters > 1 ? "s" : ""} booster` : "", r.dust ? `${r.dust.toLocaleString("fr-FR")} ✨` : "", "un titre « Prestige »"].filter(Boolean).join(" · ");
    return `<div class="account-prestige ${p.stars ? "has-stars" : ""}">
      <span class="ap-stars" aria-hidden="true">${p.stars ? "★".repeat(Math.min(p.stars, 5)) + (p.stars > 5 ? " ×" + p.stars : "") : "☆"}</span>
      <div class="ap-body">
        <strong>${p.stars ? `Prestige du compte : ${p.stars} étoile${p.stars > 1 ? "s" : ""}` : "Prestige du compte"}</strong>
        <small>${p.stars ? `Étoile suivante au niveau ${p.nextLevel} (encore ${toNext} niveau${toNext > 1 ? "x" : ""}), puis tous les ${p.step} niveaux.` : `Première étoile au niveau ${p.startLevel}${toNext ? ` (encore ${toNext} niveau${toNext > 1 ? "x" : ""})` : ""}, puis une tous les ${p.step} niveaux, sans remise à zéro.`}</small>
        <div class="ap-progress" title="${p.progress || 0} % vers l'étoile suivante"><span style="width:${Math.min(100, p.progress || 0)}%"></span></div>
        <small class="ap-gives">Chaque étoile : ${gives}${p.stars ? "" : ", et le Cadre Prestige à la première"}.</small>
      </div>
    </div>`;
  }
  let prestige = null;

  function renderTalents(st) {
    window.__talents = st.talents;
    const box = $("talents-panel");
    box.innerHTML = prestigeBlock(prestige) + `
      <div class="talents-head">
        <h2>&#127795; Talents</h2>
        <span class="talents-points ${st.available ? "has-points" : ""}">${st.available} point${st.available > 1 ? "s" : ""} à dépenser · ${st.spent}/${st.points}</span>
        ${st.spent ? `<button type="button" class="btn-ghost" id="talents-reset">Tout réinitialiser (${st.resetCost} &#10024;)</button>` : ""}
      </div>
      <p class="lead" style="font-size:0.85rem;">Un point par niveau de compte (et un par étoile de prestige) : l'arbre complet en compte <strong>${st.treeTotal || 100}</strong>. Chaque branche monte par paliers : un talent ultime à 6 points, un deuxième palier à 10, un grand ultime à 19, et un <strong>talent de prestige</strong> qui renforce toute la branche.</p>
      <div class="talent-total" aria-hidden="true"><span style="width:${Math.min(100, Math.round((st.spent / (st.treeTotal || 100)) * 100))}%"></span></div>
      <div class="talent-tree">${st.branches.map((b) => {
        const mine = st.talents.filter((t) => t.branch === b.key);
        const max = mine.reduce((n, t) => n + t.max, 0);
        // Paliers (2026-11-16) : base, ultime (6), palier 2 (10), grand ultime (19), prestige.
        const tiers = [
          ["Palier 1", mine.filter((t) => !t.req)],
          ["Ultime · 6 points", mine.filter((t) => !t.prestige && t.req === 6)],
          ["Palier 2 · 10 points", mine.filter((t) => !t.prestige && t.req === 10)],
          ["Grand ultime · 19 points", mine.filter((t) => !t.prestige && t.req === 19)],
          ["Prestige · 10 points", mine.filter((t) => t.prestige)]
        ].filter(([, l]) => l.length);
        return `
        <div class="talent-branch">
          <h3>${b.icon} ${esc(b.label)} <small>${b.spent} / ${max} pts</small></h3>
          <div class="talent-branch-bar" aria-hidden="true"><span style="width:${Math.round((b.spent / Math.max(1, max)) * 100)}%"></span></div>
          ${tiers.map(([label, list]) => `<div class="talent-tier-label">${label}</div>` + list.map((t) => `
            <button type="button" class="talent ${t.rank ? "learned" : ""} ${t.rank >= t.max ? "maxed" : ""} ${t.locked ? "locked" : ""} ${t.prestige ? "prestige" : t.req ? "ultimate" : ""} ${t.req === 10 && !t.prestige ? "tier2" : ""}" data-talent="${t.key}" ${t.canLearn ? "" : "aria-disabled=\"true\""} title="${esc(t.desc)}">
              <span class="talent-icon" aria-hidden="true">${t.icon}</span>
              <span class="talent-body"><strong>${esc(t.label)}</strong><small>${esc(t.desc)}</small></span>
              <span class="talent-rank">${t.locked ? `&#128274; ${t.req} pts` : `${t.rank}/${t.max}`}${t.prestige ? '<em class="talent-tag">prestige</em>' : ""}</span>
            </button>`).join("")).join("")}
        </div>`;
      }).join("")}</div>`;
  }

  function renderTiers(st) {
    const box = $("tiers-panel");
    box.innerHTML = `
      <div class="talents-head">
        <h2>&#127941; Maîtrises de succès</h2>
        ${st.claimable ? `<button type="button" class="btn" id="tiers-claim-all">Tout récupérer (${st.claimable})</button>` : ""}
      </div>
      <p class="lead" style="font-size:0.85rem;">Trois paliers par grand compteur du jeu, pensés pour durer des mois. Le palier III donne un titre à équiper dans la boutique. (La maîtrise des extensions est dans ta collection.)</p>
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
      } catch (err) {
        t.disabled = false;
        const tal = (window.__talents || []).find((x) => x.key === t.dataset.talent);
        const def = tal && tal.req ? `Il faut d'abord ${tal.req} points dans cette branche.` : "Talent verrouillé.";
        Toast.error({ no_points: "Plus de point à dépenser : monte de niveau (ou gagne une étoile de prestige) !", talent_locked: def }[err.code] || friendlyError(err));
      }
      return;
    }
    if (e.target.closest("#talents-reset")) {
      const okReset = await Confirm.show("Réinitialiser tous tes talents ? Tes points te seront rendus pour les répartir autrement.", { title: "Réinitialiser les talents ?", confirmText: "Réinitialiser" });
      if (!okReset) return;
      try { renderTalents(await API.talents(Session.userId, "reset")); Toast.success("Talents réinitialisés."); } catch (err) { Toast.error(err.code === "not_enough_dust" ? "Pas assez de poussières." : friendlyError(err)); }
      return;
    }
    if (e.target.closest("#tiers-claim-all")) {
      try {
        const res = await API.achievementTiers(Session.userId, "claim");
        Toast.success(`&#127941; Maîtrises : +${res.claimed.dust} poussières${res.claimed.titles.length ? ` et le titre « ${res.claimed.titles.map(esc).join(" », « ")} »` : ""} !`);
        if (typeof confetti === "function") confetti({ particleCount: 90, spread: 90, origin: { y: 0.4 } });
        renderTiers(res);
      } catch (err) { Toast.error(friendlyError(err)); }
    }
  });
})();
