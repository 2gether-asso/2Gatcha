// Accueil (2026-10-05) : centre de recompenses ("Tout recuperer", rappels de
// fin de delai) et defis de la semaine (5 proposes, 3 a choisir).
// Voir RewardsCenter (shell.js) et api/src/native/challenges.js.

(function () {
  if (!Session.isLoggedIn()) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let current = null;

  async function renderCenter() {
    const box = $("rewards-center");
    if (!box) return;
    try {
      current = await RewardsCenter.collect();
    } catch (e) { return; }
    const { items, deadlines } = current;
    box.hidden = !items.length && !deadlines.length;
    $("rc-items").innerHTML = items.length
      ? items.map((it) => `<li class="rc-item"><span class="rc-icon" aria-hidden="true">${it.icon}</span><span class="rc-label">${esc(it.label)}</span><button type="button" class="btn-secondary rc-claim" data-rc="${esc(it.key)}">Récupérer</button></li>`).join("")
      : `<li class="rc-empty">Rien à récupérer pour l'instant.</li>`;
    $("rc-claim-all").hidden = items.length < 2;
    $("rc-deadlines").innerHTML = deadlines.map((d) => `<li><a href="${d.url}"><span aria-hidden="true">${d.icon}</span> ${esc(d.label)}</a></li>`).join("");
    renderChallenges(current.challenges);
  }

  let centerClaiming = false;
  async function claim(list, btn) {
    if (btn) btn.disabled = true;
    centerClaiming = true;
    const { done, failed } = await RewardsCenter.claimAll(list);
    if (done.length) {
      Toast.success(`&#127873; ${done.length} récompense${done.length > 1 ? "s" : ""} récupérée${done.length > 1 ? "s" : ""} !`);
      if (typeof confetti === "function") confetti({ particleCount: 90 + done.length * 20, spread: 100, origin: { y: 0.4 } });
    }
    if (failed.length) Toast.error(`${failed.length} récompense${failed.length > 1 ? "s n'ont" : " n'a"} pas pu être récupérée${failed.length > 1 ? "s" : ""}.`);
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    if (typeof loadNavBadges === "function") loadNavBadges();
    // Les autres panneaux de l'accueil (serie, saison, quetes...) gardaient
    // leurs anciens boutons "Recuperer" -> "Nothing to claim" au clic.
    if (done.length) { centerClaiming = false; setTimeout(() => location.reload(), 1300); return; }
    centerClaiming = false;
    await renderCenter();
  }

  // --- defis de la semaine ---------------------------------------------------
  function renderChallenges(st) {
    const panel = $("challenges-panel");
    if (!panel || !st) return;
    panel.style.display = "";
    const days = Math.max(0, Math.ceil((st.endsAt - Date.now() / 1000) / 86400));
    $("challenges-sub").innerHTML = st.picksLeft
      ? `Choisis encore <strong>${st.picksLeft}</strong> défi${st.picksLeft > 1 ? "s" : ""} parmi les ${st.offered.length} proposés. Fin dans ${days} j.`
      : `Tes 3 défis de la semaine : fin dans ${days} j. Les 3 accomplis = +${st.bonus.boosters} booster${st.bonus.boosters > 1 ? "s" : ""} bonus${st.bonus.claimed ? " (reçu)" : ""}.`;
    $("challenges-list").innerHTML = st.offered.filter((c) => st.picksLeft || c.picked).map((c) => {
      const pct = Math.round((c.progress / c.target) * 100);
      return `<li class="challenge ${c.picked ? "picked" : ""} ${c.done ? "done" : ""} ${c.claimed ? "claimed" : ""}">
        <span class="challenge-icon" aria-hidden="true">${c.icon}</span>
        <div class="challenge-body">
          <div class="challenge-label">${esc(c.label)}</div>
          ${c.picked ? `<div class="challenge-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div><div class="challenge-meta">${c.progress} / ${c.target} · ${c.dust} &#10024;${c.claimed ? " · reçu" : c.done ? " · à récupérer !" : ""}</div>` : `<div class="challenge-meta">${c.target} à faire · ${c.dust} &#10024;</div>`}
        </div>
        ${!c.picked && st.picksLeft ? `<button type="button" class="btn-secondary challenge-pick" data-pick="${c.key}">Choisir</button>` : ""}
      </li>`;
    }).join("");
    $("challenges-claim").hidden = !st.claimable;
  }

  // Recuperation faite depuis un autre panneau : le centre se met a jour.
  let refreshTimer = null;
  window.addEventListener("api:claimed", () => {
    if (centerClaiming) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(renderCenter, 400);
  });

  document.addEventListener("DOMContentLoaded", () => {
    renderCenter();
    $("rc-claim-all")?.addEventListener("click", (e) => current && claim(current.items, e.currentTarget));
    $("rc-items")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-rc]");
      if (!btn || !current) return;
      const it = current.items.find((x) => x.key === btn.dataset.rc);
      if (it) claim([it], btn);
    });
    $("challenges-list")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-pick]");
      if (!btn) return;
      btn.disabled = true;
      try { renderChallenges(await API.challenges(Session.userId, "pick", { keys: [btn.dataset.pick] })); Toast.success("Défi choisi !"); }
      catch (err) { btn.disabled = false; Toast.error(err.code === "too_many_picks" ? "Tu as déjà choisi 3 défis." : "Erreur. (" + err.message + ")"); }
    });
    $("challenges-claim")?.addEventListener("click", async (e) => {
      // e.currentTarget vaut null apres le premier await (GlitchTip #17) :
      // on garde le bouton dans une variable.
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await API.challenges(Session.userId, "claim");
        Toast.success(`&#127919; Défis : +${res.reward.dust} poussières${res.reward.boosters ? ` et +${res.reward.boosters} booster` : ""} !`);
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) {
        // Deja recupere (ex. via "Tout recuperer") : message doux (API.BENIGN_ERRORS).
        Toast.error("Erreur. (" + err.message + ")");
      }
      btn.disabled = false;
      // Dans tous les cas, le panneau se remet a jour (bouton masque si plus rien).
      renderCenter();
    });
  });
})();
