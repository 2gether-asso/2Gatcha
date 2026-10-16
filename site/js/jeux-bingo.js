// Bingo du mois, version 2 (Jeux > Bingo, 2026-11) : grille 5 x 5 commune,
// cases "carte" et "objectif", lignes a recuperer, joker, carton plein.
// Tant que l'API repond l'ancien format (avant BingoV2From), l'ancien
// affichage de jeux.js (9 cartes) est garde. Donnees : api/src/native/bingo.js.

(function () {
  const esc = escHtml;
  const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
  let state = null, picking = false, selected = null;

  const rewardText = (r) => [r.dust ? `${fmt(r.dust)} ✨` : "", r.shards ? `${r.shards} 🧩` : "", r.boosters ? `${r.boosters} booster${r.boosters > 1 ? "s" : ""}` : ""].filter(Boolean).join(" + ");
  const left = (t) => { const s = Math.max(0, t - Date.now() / 1000); const d = Math.floor(s / 86400); return d ? `${d} j ${Math.floor((s % 86400) / 3600)} h` : `${Math.floor(s / 3600)} h ${Math.ceil((s % 3600) / 60)} min`; };

  function cellHtml(c, glow) {
    const pct = c.type === "objective" ? Math.round((c.progress / Math.max(1, c.target)) * 100) : 0;
    const inner = c.type === "free" ? `<span class="b2-free" aria-hidden="true">⭐</span><span class="b2-label">Offerte</span>`
      : c.type === "card" ? `<img src="${c.card ? API.imageUrl(c.card.imageId) || PLACEHOLDER_IMG : PLACEHOLDER_IMG}" alt="" loading="lazy" /><span class="b2-label">${esc(c.label)}</span>`
      : `<span class="b2-icon" aria-hidden="true">${c.icon}</span><span class="b2-label">${esc(c.label)}</span>${c.done ? "" : `<span class="b2-progress"><span style="width:${pct}%"></span></span><span class="b2-count">${c.progress}/${c.target}</span>`}`;
    const color = c.type === "card" && c.card && c.card.rarity ? c.card.rarity.colorHex : "";
    return `<button type="button" class="b2-cell type-${c.type} ${c.done ? "done" : ""} ${glow ? "glow" : ""} ${c.joker ? "joker" : ""} ${selected === c.index ? "selected" : ""}" data-b2-cell="${c.index}" ${color ? `style="--r:${color}"` : ""} aria-label="${esc(c.label)}${c.done ? " (validée)" : ""}">
      ${inner}${c.done && c.type !== "free" ? `<span class="b2-stamp" aria-hidden="true">${c.joker ? "🃏" : ""}</span>` : ""}
    </button>`;
  }

  function detailHtml(c) {
    if (!c) return `<p class="b2-hint">Touche une case pour voir son objectif.${state.joker.used ? "" : " Ton joker peut valider la case de ton choix."}</p>`;
    const what = c.type === "free" ? "Case offerte : elle est validée pour tout le monde."
      : c.type === "card" ? (c.done ? "Carte possédée : case validée." : `Obtiens la carte <strong>${esc(c.label)}</strong>${c.card && c.card.rarity ? ` (${esc(c.card.rarity.name)})` : ""} : booster, échange, craft…`)
      : c.done ? `Objectif rempli : ${esc(c.label)}.` : `${esc(c.label)} avant la fin du mois. Progression : <strong>${c.progress}/${c.target}</strong>.`;
    const canJoker = !state.joker.used && !c.done && c.type !== "free";
    return `<p class="b2-detail-text">${c.icon || "🎴"} ${what}</p>${canJoker ? `<button type="button" class="btn-ghost" data-b2-joker="${c.index}">🃏 Joker sur cette case (${fmt(state.joker.price)} ✨)</button>` : ""}`;
  }

  function render() {
    const box = document.getElementById("bingo2-zone");
    if (!box || !state) return;
    const st = state;
    const glowCells = new Set(st.lines.filter((l) => l.complete && !l.claimed).flatMap((l) => l.cells));
    const doneCount = st.cells.filter((c) => c.done).length;
    const lines = st.lines.filter((l) => l.complete);
    const toClaim = st.lines.filter((l) => l.complete && !l.claimed);
    box.innerHTML = `
      <div class="b2-head">
        <div><h2>&#127921; Bingo de ${esc(st.monthLabel)}</h2>
          <p class="lead">Une grille commune pour tout le serveur. Valide les cases en jouant ; chaque ligne, colonne ou diagonale complète rapporte <strong>${esc(rewardText(st.rewards.line))}</strong>, et le carton plein <strong>${esc(rewardText(st.rewards.full))}</strong> + le titre « Roi du bingo ».</p></div>
        <div class="b2-stats"><span><b>${doneCount}</b>/25 cases</span><span><b>${lines.length}</b>/12 lignes</span><span>⏳ ${left(st.endsAt)}</span></div>
      </div>
      <div class="b2-layout">
        <div>
          <div class="b2-card ${picking ? "picking" : ""}">
            <div class="b2-letters" aria-hidden="true"><span>B</span><span>I</span><span>N</span><span>G</span><span>O</span></div>
            <div class="b2-grid" role="grid">${st.cells.map((c) => cellHtml(c, glowCells.has(c.index))).join("")}</div>
          </div>
          <div class="b2-detail" aria-live="polite">${picking ? `<p class="b2-hint">🃏 Choisis la case à valider avec ton joker… <button type="button" class="btn-ghost" data-b2-cancel>Annuler</button></p>` : detailHtml(st.cells[selected] || null)}</div>
        </div>
        <aside class="b2-side">
          ${st.full ? `<div class="b2-full ${st.fullClaimed ? "claimed" : ""}"><strong>🎉 CARTON PLEIN !</strong>${st.fullClaimed ? "<small>Récompense récupérée. Bravo !</small>" : `<button type="button" class="btn" data-b2-claim="full">Récupérer ${esc(rewardText(st.rewards.full))}</button>`}</div>` : ""}
          <section class="b2-box">
            <h3>Lignes à récupérer</h3>
            ${toClaim.length ? `<ul class="b2-claims">${toClaim.map((l) => `<li><span>${esc(l.label)}</span><button type="button" class="btn" data-b2-claim="${l.key}">${esc(rewardText(st.rewards.line))}</button></li>`).join("")}</ul>
              ${toClaim.length > 1 ? `<button type="button" class="btn-ghost b2-all" data-b2-claim-all>Tout récupérer (${toClaim.length})</button>` : ""}`
              : `<p class="b2-hint">${lines.length ? "Tout est récupéré pour l'instant." : "Complète une ligne, une colonne ou une diagonale."}</p>`}
          </section>
          <section class="b2-box">
            <h3>🃏 Joker du mois</h3>
            <p class="b2-hint">${st.joker.used ? "Joker utilisé ce mois-ci." : `Valide la case de ton choix pour ${fmt(st.joker.price)} ✨ (une fois par mois).`}</p>
            ${st.joker.used ? "" : `<button type="button" class="btn-ghost" data-b2-pick ${st.stardust >= st.joker.price ? "" : "disabled"}>${st.stardust >= st.joker.price ? "Choisir une case" : "Pas assez de poussières"}</button>`}
          </section>
          <section class="b2-box">
            <h3>🏆 Classement du mois</h3>
            ${st.top.length ? `<ol class="b2-top">${st.top.map((r) => `<li class="${String(r.userId) === String(Session.userId) ? "me" : ""}"><span>${esc(r.pseudo)}</span><small>${r.full ? "🎉 carton plein" : `${r.lines} ligne${r.lines > 1 ? "s" : ""} · ${r.cells}/25`}</small></li>`).join("")}</ol>` : '<p class="b2-hint">Personne pour l\'instant : à toi de jouer !</p>'}
          </section>
        </aside>
      </div>`;
  }

  async function load() {
    const legacyZone = document.getElementById("bingo-zone");
    const noGrid = document.getElementById("bingo-no-grid");
    const lead = document.querySelector("#bingo-pane > .lead");
    let res;
    try { res = await API.getBingoStatus(Session.userId); } catch (e) { return window.loadBingoLegacy && window.loadBingoLegacy(); }
    if (!res || res.version !== 2) return window.loadBingoLegacy && window.loadBingoLegacy();
    if (legacyZone) legacyZone.style.display = "none";
    if (noGrid) noGrid.style.display = "none";
    if (lead) lead.hidden = true;
    let box = document.getElementById("bingo2-zone");
    if (!box) { box = document.createElement("div"); box.id = "bingo2-zone"; box.className = "bingo2"; document.getElementById("bingo-pane").appendChild(box); }
    state = res;
    render();
  }
  window.loadBingoFull = load;

  async function claim(line) {
    const r = await API.post("bingo", { userId: Session.userId, action: "claim", line });
    state = r;
    return r.reward || {};
  }

  document.addEventListener("click", async (e) => {
    const box = document.getElementById("bingo2-zone");
    if (!box || !box.contains(e.target) || !state) return;
    const cell = e.target.closest("[data-b2-cell]");
    const one = e.target.closest("[data-b2-claim]");
    const all = e.target.closest("[data-b2-claim-all]");
    const pick = e.target.closest("[data-b2-pick]");
    const cancel = e.target.closest("[data-b2-cancel]");
    const jok = e.target.closest("[data-b2-joker]");
    if (pick) { picking = true; selected = null; render(); return; }
    if (cancel) { picking = false; render(); return; }
    if (cell && !picking) { selected = Number(cell.dataset.b2Cell); render(); return; }
    const jokerCell = jok ? Number(jok.dataset.b2Joker) : cell && picking ? Number(cell.dataset.b2Cell) : null;
    if (jokerCell != null) {
      const c = state.cells[jokerCell];
      if (c.done || c.type === "free") { Toast.info("Cette case est déjà validée."); return; }
      if (!(await Confirm.show(`Utiliser ton joker du mois sur <strong>${esc(c.label)}</strong> pour ${fmt(state.joker.price)} ✨ ?`, { title: "Joker", confirmText: "Valider la case" }))) return;
      try {
        state = await API.post("bingo", { userId: Session.userId, action: "joker", cell: jokerCell });
        picking = false; selected = jokerCell;
        render();
        Toast.success("🃏 Case validée par ton joker !");
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) { Toast.error({ not_enough_dust: "Pas assez de poussières.", joker_used: "Joker déjà utilisé ce mois-ci." }[err.code] || friendlyError(err)); }
      return;
    }
    if (one || all) {
      const keys = all ? state.lines.filter((l) => l.complete && !l.claimed).map((l) => l.key) : [one.dataset.b2Claim];
      (one || all).disabled = true;
      const total = { dust: 0, shards: 0, boosters: 0 };
      try {
        for (const k of keys) { const r = await claim(k); total.dust += r.dust || 0; total.shards += r.shards || 0; total.boosters += r.boosters || 0; }
        render();
        Toast.success(`🎱 ${keys.includes("full") ? "CARTON PLEIN" : keys.length > 1 ? keys.length + " lignes" : "Ligne"} récupéré${keys.length > 1 ? "es" : ""} : +${rewardText(total)}`);
        if (typeof confetti === "function") confetti({ particleCount: keys.includes("full") ? 260 : 90, spread: keys.includes("full") ? 160 : 80, origin: { y: 0.55 } });
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) {
        Toast.error({ already_claimed: "Déjà récupéré.", line_not_complete: "Cette ligne n'est pas encore complète." }[err.code] || friendlyError(err));
        load();
      }
    }
  });
  // Comptes a rebours et progression a jour si la page reste ouverte.
  setInterval(() => { if (!document.hidden && state && document.getElementById("bingo2-zone")?.offsetParent) load(); }, 120000);
})();
