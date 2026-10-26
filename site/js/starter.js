// Parcours du debutant (2026-10-18, api/src/native/starter.js) : carte en haut
// de l'accueil. L'etape en cours est mise en avant (aller faire l'action, ou
// recuperer sa recompense), les suivantes restent en apercu ; puis le bonus
// final, et ce qui se debloque aux prochains niveaux.

(function () {
  const esc = escHtml;
  const REWARD = { BoosterCount: ["jeton booster", "jetons booster", "assets/JetonBooster.png"], StardustCount: ["poussière", "poussières", null, "&#10024;"], Worms: ["ver", "vers", "assets/P%C3%AAche/Vers.png"], KeyCount: ["clé", "clés", "assets/cl%C3%A9s.PNG"], BoneCount: ["os", "os", "assets/Os.PNG"], XP: ["XP", "XP", null, "&#11088;"] };
  const rewardChips = (r) => Object.entries(r || {}).filter(([k, v]) => REWARD[k] && v > 0).map(([k, v]) => {
    const d = REWARD[k];
    return `<span class="st-chip">${d[2] ? `<img class="ico-token" src="${d[2]}" alt="" />` : d[3]} +${v} ${d[v > 1 ? 1 : 0]}</span>`;
  }).join("");
  let busy = false;

  function render(v) {
    const box = document.getElementById("starter-panel");
    if (!box) return;
    if (!v || !v.active) { box.hidden = true; return; }
    box.hidden = false;
    const pct = Math.round((100 * v.claimedCount) / Math.max(1, v.total));
    const cur = v.steps.find((s) => s.current);
    // Prochain deblocage : seulement le palier, jamais ce qu'il ouvre (surprise).
    const nextLevel = v.nextUnlockLevel || null;
    let main;
    if (cur) {
      const action = cur.complete || !cur.target
        ? `<button type="button" class="btn" data-st-claim="${cur.key}">Récupérer</button>`
        : cur.needLevel
          ? `<span class="st-need">&#10067; Niveau ${cur.needLevel} requis : continue à jouer pour monter de niveau.</span>`
          : cur.url ? `<a class="btn" href="${esc(cur.url)}">Y aller &rarr;</a>` : "";
      main = `
        <div class="st-current">
          <span class="st-icon" aria-hidden="true">${cur.icon}</span>
          <div class="st-body">
            <strong>${esc(cur.label)}</strong>
            ${cur.hint ? `<small>${esc(cur.hint)}</small>` : ""}
            ${cur.target > 1 ? `<div class="st-bar"><span style="width:${Math.round((100 * cur.progress) / cur.target)}%"></span></div><small>${cur.progress} / ${cur.target}</small>` : ""}
            <div class="st-chips">${rewardChips(cur.reward)}</div>
          </div>
          <div class="st-action">${action}</div>
        </div>`;
    } else {
      main = `
        <div class="st-current st-final">
          <span class="st-icon" aria-hidden="true">&#127942;</span>
          <div class="st-body"><strong>Parcours terminé, bravo !</strong><small>Récupère ton bonus final : tout le jeu s'ouvre à toi petit à petit.</small><div class="st-chips">${rewardChips(v.finalReward)}</div></div>
          <div class="st-action"><button type="button" class="btn" data-st-claim="final">Récupérer le bonus</button></div>
        </div>`;
    }
    box.innerHTML = `
      <div class="st-head">
        <h2>&#129517; Parcours du débutant</h2>
        <span class="st-count">${v.claimedCount} / ${v.total}</span>
      </div>
      <div class="st-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      ${main}
      <ol class="st-steps">${v.steps.map((s) => `<li class="${s.claimed ? "done" : s.current ? "current" : ""}${s.secret ? " secret" : ""}" title="${esc(s.label)}"><span aria-hidden="true">${s.claimed ? "&#10004;" : s.icon}</span><span class="st-step-label">${esc(s.label)}</span></li>`).join("")}</ol>
      ${nextLevel ? `<p class="st-soon">&#127873; Une surprise t'attend au <strong>niveau ${nextLevel}</strong>…</p>` : ""}`;
  }

  async function claim(key) {
    if (busy) return;
    busy = true;
    try {
      const v = await API.post("starter", { userId: Session.userId, action: "claim", key });
      const chips = Object.entries(v.reward || {}).filter(([k, n]) => REWARD[k] && n > 0).map(([k, n]) => `+${n} ${REWARD[k][n > 1 ? 1 : 0]}`).join(", ");
      Toast.success(key === "final" ? `&#127942; Parcours du débutant terminé ! ${chips}` : `Étape réussie : ${chips}`);
      if (key === "final" && typeof confetti === "function") confetti({ particleCount: 180, spread: 90, origin: { y: 0.4 } });
      render(v);
      if (typeof StarterLocks !== "undefined") StarterLocks.apply(v);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (e) {
      Toast.error({ step_not_complete: "Étape pas encore terminée.", not_current_step: "Termine d'abord l'étape en cours." }[e.code] || friendlyError(e));
      load();
    } finally { busy = false; }
  }

  async function load() {
    if (!Session.isLoggedIn()) return;
    const v = typeof StarterLocks !== "undefined" ? await StarterLocks.refresh() : await API.post("starter", { userId: Session.userId, action: "status" }).catch(() => null);
    render(v);
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-st-claim]");
    if (b) claim(b.dataset.stClaim);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
  window.StarterPath = { load };
})();
