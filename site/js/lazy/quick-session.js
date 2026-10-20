// Module charge a la demande par shell-extras.js (boutons [data-quick-session]).
// Session rapide (2026-10-20) : tout ce qui se fait sans choisir, en un clic.
// Les recompenses de "Tout recuperer" (RewardsCenter, shell.js) + les actions
// gratuites des jeux qui ne demandent aucune decision : recolter le jardin,
// accueillir l'explorateur rentre, pioche gratuite du coffre de guilde.
// Le joueur voit la liste, decoche ce qu'il veut garder pour plus tard, puis
// suit chaque etape en direct et finit sur un recapitulatif.

const QuickSession = (function () {
  const esc = escHtml;

  // Actions de jeu gratuites, lues sur les statuts existants (aucun nouvel endpoint).
  async function gameSteps(uid) {
    const settled = (p) => p.then((v) => v, () => null);
    const [garden, expe, chest] = await Promise.all([
      settled(API.garden(uid)),
      settled(API.expedition(uid, "status")),
      settled(API.guildChestV2 ? API.guildChestV2(uid, "status") : Promise.reject())
    ]);
    const steps = [];
    if (garden && garden.readyCount) {
      steps.push({ key: "garden", icon: "&#129530;", label: `Récolter le jardin (${garden.readyCount} parcelle${garden.readyCount > 1 ? "s" : ""})`,
        claim: () => API.garden(uid, "harvest"),
        describe: (r) => { const g = (r && r.gained) || {}; return [`+${g.worms || 0} vers`, g.bait ? `+${g.bait} appât${g.bait > 1 ? "s" : ""} doré${g.bait > 1 ? "s" : ""}` : "", g.dust ? `+${g.dust} &#10024;` : "", g.rare ? `${g.rare.icon} ${esc(g.rare.label)}` : ""].filter(Boolean).join(" · "); } });
    }
    const ex = expe && expe.expedition;
    if (ex && ex.active && ex.ready) {
      steps.push({ key: "expedition", icon: "&#129517;", label: "Accueillir l'explorateur rentré",
        claim: () => API.expedition(uid, "claim"),
        describe: (r) => { const w = (r && r.reward) || {}; return [`+${w.dust || 0} poussières`, w.boosters ? `+${w.boosters} jeton${w.boosters > 1 ? "s" : ""} booster` : "", ...(w.resources || []).map((x) => `+${x.n} ${esc(x.label)}`)].filter(Boolean).join(" · "); } });
    }
    if (chest && chest.freeAvailable) {
      steps.push({ key: "guild-free", icon: "&#127873;", label: "Pioche gratuite du coffre de guilde",
        claim: () => API.guildChestV2(uid, "free"),
        describe: (r) => (r && r.taken ? `${esc(r.taken.name)} rejoint ta collection` : "") });
    }
    return steps;
  }

  function overlayHtml(list) {
    return `
      <div class="contract-modal qs-modal" role="dialog" aria-modal="true" aria-labelledby="qs-title">
        <header class="contract-modal-head"><div><span aria-hidden="true">&#9889;</span> <strong id="qs-title">Session rapide</strong></div>
          <button type="button" class="card-modal-close" data-qs-close aria-label="Fermer">&times;</button></header>
        <p class="qs-lead">${list.length ? "Tout ce qui se fait sans choisir, d'un coup. Décoche ce que tu veux garder pour plus tard." : "Rien à faire pour l'instant : tout est récupéré, récolté et pioché. Reviens un peu plus tard !"}</p>
        <ul class="qs-list">${list.map((s, i) => `
          <li class="qs-step" data-i="${i}">
            <label><input type="checkbox" checked data-qs-pick="${i}" /> <span class="rc-icon" aria-hidden="true">${s.icon}</span> <span class="qs-label">${esc(s.label)}</span></label>
            <span class="qs-state" aria-live="polite"></span>
          </li>`).join("")}</ul>
        <footer class="contract-modal-foot">${list.length ? `<button type="button" class="btn" data-qs-go>&#9889; Tout lancer (${list.length})</button>` : '<button type="button" class="btn" data-qs-close>OK</button>'}</footer>
      </div>`;
  }

  async function open() {
    if (!Session.isLoggedIn()) { Toast.info("Connecte-toi pour lancer une session rapide."); return; }
    const uid = Session.userId;
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay contract-overlay qs-overlay";
    overlay.innerHTML = '<div class="contract-modal qs-modal" role="dialog" aria-modal="true" aria-label="Session rapide"><div class="loading-row"><div class="spinner"></div></div><p class="qs-lead" style="text-align:center">On regarde ce qui t\'attend…</p></div>';
    document.body.appendChild(overlay);
    if (typeof syncScrollLock === "function") syncScrollLock();
    let changed = false;
    const close = () => { overlay.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); if (changed) location.reload(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest("[data-qs-close]")) close(); });

    let rewards = { items: [] };
    try { rewards = await RewardsCenter.collect(); } catch (e) { /* on continue avec les jeux */ }
    const list = [...rewards.items, ...(await gameSteps(uid))];
    if (!overlay.isConnected) return;
    overlay.innerHTML = overlayHtml(list);
    overlay.querySelector("[data-qs-go], [data-qs-close]")?.focus();
    const go = overlay.querySelector("[data-qs-go]");
    overlay.addEventListener("change", (e) => {
      if (!e.target.matches("[data-qs-pick]") || !go) return;
      const n = overlay.querySelectorAll("[data-qs-pick]:checked").length;
      go.disabled = !n;
      go.innerHTML = `&#9889; Tout lancer (${n})`;
    });
    go?.addEventListener("click", async () => {
      go.disabled = true;
      overlay.querySelectorAll("[data-qs-pick]").forEach((c) => { c.disabled = true; });
      const picked = [...overlay.querySelectorAll("[data-qs-pick]:checked")].map((c) => Number(c.dataset.qsPick));
      let ok = 0, ko = 0;
      for (const i of picked) {
        const s = list[i];
        const row = overlay.querySelector(`.qs-step[data-i="${i}"]`);
        const state = row.querySelector(".qs-state");
        row.classList.add("running");
        state.innerHTML = '<span class="spinner qs-spin" aria-hidden="true"></span> en cours';
        try {
          const res = await s.claim();
          ok++; changed = true;
          row.classList.add("done");
          state.innerHTML = `&#10004;&#65039; ${s.describe ? s.describe(res || {}) || "fait" : "fait"}`;
        } catch (e) {
          ko++;
          row.classList.add("failed");
          state.textContent = "✖ " + (typeof friendlyError === "function" ? friendlyError(e) : "impossible");
        }
        row.classList.remove("running");
      }
      if (ok && typeof confetti === "function") confetti({ particleCount: 80 + ok * 20, spread: 100, origin: { y: 0.4 } });
      if (typeof Haptics !== "undefined" && ok) Haptics.buzz([20, 40, 20]);
      overlay.querySelector(".qs-lead").textContent = `${ok} action${ok > 1 ? "s" : ""} faite${ok > 1 ? "s" : ""}${ko ? `, ${ko} impossible${ko > 1 ? "s" : ""}` : ""}. La page se met à jour à la fermeture.`;
      overlay.querySelector(".contract-modal-foot").innerHTML = '<button type="button" class="btn" data-qs-close>Super !</button>';
      overlay.querySelector("[data-qs-close]").focus();
    });
  }
  return { open };
})();
window.QuickSession = QuickSession;
