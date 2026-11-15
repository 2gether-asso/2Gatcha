// Jeux : branchements de la page (onglets, boutons) et parchemin de la peche.
// Decoupage de jeux.js (Jeux V2, 2026-11-15) : scripts classiques charges
// dans l'ordre par jeux.html ; leurs declarations restent partagees entre fichiers.

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("tab-village-btn").addEventListener("click", () => setActiveTab("village"));
  document.getElementById("tab-dig-btn").addEventListener("click", () => setActiveTab("dig"));
  document.getElementById("tab-guess-btn").addEventListener("click", () => setActiveTab("guess"));
  document.getElementById("tab-archeo-btn").addEventListener("click", () => setActiveTab("archeo"));
  document.getElementById("tab-expedition-btn").addEventListener("click", () => setActiveTab("expedition"));
  document.getElementById("tab-fish-btn").addEventListener("click", () => setActiveTab("fish"));
  // Lien de l'en-tete vers la peche alors qu'on est deja sur la page.
  window.addEventListener("hashchange", () => { const t = HASH_TAB[location.hash.slice(1)]; if (t) setActiveTab(t); });
  document.getElementById("tab-garden-btn").addEventListener("click", () => setActiveTab("garden"));
  document.getElementById("tab-walk-btn").addEventListener("click", () => setActiveTab("walk"));
  document.getElementById("tab-cook-btn").addEventListener("click", () => setActiveTab("cook"));
  document.getElementById("tab-dino-btn").addEventListener("click", () => setActiveTab("dino"));
  document.getElementById("garden-plots").addEventListener("click", (e) => {
    const b = e.target.closest("[data-fertilize]");
    if (b) { gardenAction("fertilize", { plot: Number(b.dataset.fertilize), ...(b.dataset.gold ? { gold: true } : {}) }); return; }
    const pl = e.target.closest("[data-plant-plot]");
    if (pl) { gardenAction("plant", { plot: Number(pl.dataset.plantPlot) }); return; }
    // Une parcelle prete : on recolte tout.
    if (e.target.closest(".garden-plot.ready")) gardenAction("harvest");
  });
  document.getElementById("garden-seeds").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seed]");
    if (!b || b.disabled) return;
    gardenSeed = b.dataset.seed;
    try { localStorage.setItem("2gatcha_garden_seed", gardenSeed); } catch (err) { /* stockage indisponible */ }
    renderGarden(gardenState);
  });
  document.getElementById("garden-poop-btn")?.addEventListener("click", () => gardenAction("fertilize"));
  document.getElementById("garden-plant-btn").addEventListener("click", () => gardenAction("plant"));
  document.getElementById("garden-harvest-btn").addEventListener("click", () => gardenAction("harvest"));
  document.getElementById("garden-buyplot-btn").addEventListener("click", () => gardenAction("buyPlot"));
  document.getElementById("fish-extras").addEventListener("click", (e) => { if (e.target.closest("#fish-reroll-btn")) rerollWeather(); });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-prestige]"); if (b) doPrestige(b.dataset.prestige); });
  document.getElementById("fish-cast-btn").addEventListener("click", () => castFishing(1));
  document.getElementById("fish-cat-feed1")?.addEventListener("click", (e) => feedCat(1, e.currentTarget));
  document.getElementById("fish-cat-feedmax")?.addEventListener("click", (e) => feedCat(Number(e.currentTarget.dataset.count) || 1, e.currentTarget));
  document.getElementById("fish-aquarium")?.addEventListener("click", async (e) => {
    const b = e.target.closest("#aq-claim");
    if (!b) return;
    b.disabled = true;
    try {
      const r = await API.aquarium(Session.userId, "claim");
      const c = r.claimed;
      Toast.success(`🐠 Aquarium : ${[c.dust ? `+${c.dust} ✨` : "", c.boosters ? `+${c.boosters} jetons booster` : "", c.chests ? `+${c.chests} coffre` : "", ...(c.titles || []).map((t) => `titre « ${escHtml(t)} »`)].filter(Boolean).join(", ")} !`);
      if (typeof confetti === "function") confetti({ particleCount: 90, spread: 90, origin: { y: 0.5 } });
      renderAquarium(r);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (err) { b.disabled = false; Toast.error(friendlyError(err)); }
  });
  document.getElementById("fish-cast5-btn").addEventListener("click", () => castFishing(5));
  document.getElementById("fish-castall-btn").addEventListener("click", (e) => { const n = Number(e.currentTarget.dataset.count) || 0; if (n > 0) castFishing(n); });
  document.getElementById("fish-extras").addEventListener("change", (e) => { if (e.target.id === "fish-bait" && fishState) renderFishing(fishState); });
  document.getElementById("tab-bingo-btn").addEventListener("click", () => setActiveTab("bingo"));
  document.getElementById("tab-vault-btn").addEventListener("click", () => setActiveTab("vault"));
  document.getElementById("bingo-claim-btn").addEventListener("click", claimBingo);
  document.getElementById("guess-pane").addEventListener("click", (e) => { const rb = e.target.closest("[data-guess-round]"); if (rb && guessData) { guessRound = Number(rb.dataset.guessRound); renderGuess(guessData); } });
  document.getElementById("guess-choices").addEventListener("click", (e) => {
    const btn = e.target.closest(".guess-choice");
    if (btn && !btn.disabled) submitGuess(Number(btn.dataset.cardId));
  });
  document.getElementById("vault-padlocks").addEventListener("click", (e) => { const b = e.target.closest(".vault-padlock.can"); if (b) popPadlock(b); });
  document.getElementById("dig-depths").addEventListener("click", (e) => { const b = e.target.closest(".dig-depth[data-depth]:not([disabled])"); if (b) setDigDepth(Number(b.dataset.depth)); });
  // Achat depuis un bandeau de la boutique : la partie concernee se rafraichit.
  document.addEventListener("shop:bought", (e) => {
    const k = e.detail && e.detail.key;
    if (k === "coffee" || k === "bone") loadDig();
    else if (k === "worms10" || k === "bait" || k === "thermos") loadFishing();
    else if (k === "fertilizer") loadGarden();
    else if (k === "compass") loadExpedition();
  });
  document.getElementById("dig-shop").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-shop-buy]");
    if (!b || window.ShopStrip) return;
    b.disabled = true;
    try { await API.shop(Session.userId, "buy", b.dataset.shopBuy); Toast.success("&#128722; Acheté !"); if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); await loadDig(); renderDigShop(); }
    catch (err) { b.disabled = false; Toast.error({ energy_full: "Ton énergie de fouille est déjà pleine.", weekly_cap: "Limite de la semaine atteinte.", not_enough_dust: "Pas assez de poussières." }[err.code] || friendlyError(err)); }
  });
  document.getElementById("dig-use-bone-btn").addEventListener("click", (e) => kennelAction("use", e.currentTarget));
  document.getElementById("dig-frenzy-btn").addEventListener("click", (e) => dogFrenzy(e.currentTarget));
  document.getElementById("dig-all-btn").addEventListener("click", (e) => digAll(e.currentTarget));
  // Onglet Coffre-fort cache tant que le joueur n'a jamais eu de clef : les
  // clefs et leurs usages se decouvrent en explorant, pas dans un menu.
  const initial = getInitialTab();
  setActiveTab(initial === "vault" || initial === "dino" ? "village" : initial);
  API.dino(Session.userId).then((res) => {
    if (!res.unlocked) return;
    document.getElementById("tab-dino-btn").style.display = "";
    if (initial === "dino") setActiveTab("dino");
  }).catch(() => {});
  API.getVaultStatus(Session.userId).then((res) => {
    if ((res.userKeys || 0) > 0 || res.alreadyOpened) {
      document.getElementById("tab-vault-btn").style.display = "";
      if (initial === "vault") setActiveTab("vault");
    }
  }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Le parchemin (2026-10-19, api/src/native/forbidden.js) : une prise de peche
// rare. Il se deroule dans une cinematique ; ses enigmes ne viennent que du
// serveur (et seulement pour qui l'a peche). On peut le relire depuis la peche.
// ---------------------------------------------------------------------------
function renderScrollBtn(st) {
  const host = document.querySelector(".fish-controls");
  if (!host) return;
  let b = document.getElementById("fish-scroll-btn");
  if (!st.hasScroll) { if (b) b.remove(); return; }
  if (b) return;
  b = document.createElement("button");
  b.type = "button";
  b.id = "fish-scroll-btn";
  b.className = "btn-ghost fish-scroll-btn";
  b.innerHTML = "&#128220; Le parchemin";
  b.title = "Relire le parchemin repêché";
  b.addEventListener("click", () => ScrollFx.open(false));
  host.appendChild(b);
}
const ScrollFx = {
  async open(fresh) {
    let data;
    try { data = await API.post("forbidden", { userId: Session.userId, action: "scroll" }); } catch (e) { return; }
    const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ov = document.createElement("div");
    ov.className = "scroll-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Le parchemin");
    ov.innerHTML = `
      ${fresh ? '<p class="scroll-catch">Ta ligne remonte… un parchemin détrempé, scellé de cire.</p>' : ""}
      <div class="scroll-paper">
        <div class="scroll-rod top" aria-hidden="true"></div>
        <div class="scroll-body">
          <span class="scroll-seal" aria-hidden="true">&#9881;&#65039;</span>
          <h2 class="scroll-title">${escHtml(data.title)}</h2>
          <ol class="scroll-riddles">${data.riddles.map((r, i) => `<li style="--d:${i}" class="${r.found ? "found" : ""}"><b>${r.roman}</b><span>${escHtml(r.text)}</span></li>`).join("")}</ol>
          <p class="scroll-outro">${escHtml(data.outro)}</p>
          <button type="button" class="btn scroll-close">Rouler le parchemin</button>
        </div>
        <div class="scroll-rod bottom" aria-hidden="true"></div>
      </div>`;
    document.body.appendChild(ov);
    if (typeof syncScrollLock === "function") syncScrollLock();
    if (typeof Sfx !== "undefined" && Sfx._tone) for (let i = 0; i < 6; i++) Sfx._tone(1800 + Math.random() * 900, i * 0.07, 0.04, "triangle", 0.012);
    if (typeof Haptics !== "undefined") Haptics.buzz([20, 40, 20]);
    requestAnimationFrame(() => ov.classList.add(reduced ? "open no-anim" : "open"));
    const close = () => {
      document.removeEventListener("keydown", onKey);
      ov.classList.add("closing");
      setTimeout(() => { ov.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); }, reduced ? 50 : 450);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    ov.querySelector(".scroll-close").addEventListener("click", close);
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    setTimeout(() => ov.querySelector(".scroll-close").focus({ preventScroll: true }), reduced ? 0 : 1800);
    if (fresh) setTimeout(() => { const b = document.getElementById("fish-scroll-btn"); if (!b && fishState) renderScrollBtn({ hasScroll: true }); }, 500);
  }
};

// Retour sur l'onglet (2026-10-21) : apres plus de 30 s ailleurs, ou si un
// point d'energie est arrive pendant ce temps, l'energie de fouille et de
// peche est relue tout de suite (les minuteries de l'onglet cache ont pu
// etre espacees par le navigateur).
const EnergySync = {
  hiddenAt: 0,
  init() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { this.hiddenAt = Date.now(); return; }
      const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
      const due = (digDeadline && Date.now() >= digDeadline) || (fishDeadline && Date.now() >= fishDeadline);
      if (away < 30000 && !due) return;
      if (API.invalidate) API.invalidate();
      if (digDeadline || away >= 30000) loadDig();
      if (typeof fishState !== "undefined" && fishState && !fishBusy) loadFishing();
    });
  }
};
EnergySync.init();
