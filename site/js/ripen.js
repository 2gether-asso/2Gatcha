// Murissoir du distributeur (2026-10-18, api/src/native/ripen.js) : au retrait
// de la selection, « Laisser murir » met le lot de cote le temps choisi (le
// panier, js/opening-cart.js, propose les durees) ; les lots attendent sous
// le monnayeur avec leur minuteur, puis se reprennent gratuitement et
// s'ouvrent avec le panier, chaque booster avec le bonus du stade.

(function () {
  const esc = escHtml;
  let st = null, tick = null;
  const left = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d} j ${h} h` : h ? `${h} h ${String(m).padStart(2, "0")}` : `${Math.max(1, m)} min`; };
  const name = (k) => (window.BoosterCart && BoosterCart.nameOf ? BoosterCart.nameOf(k) : k);
  const contents = (items) => Object.entries(items).map(([k, n]) => `${esc(name(k))} ×${n}`).join(" · ");

  function render() {
    const box = document.getElementById("vend-lots");
    if (!box) return;
    if (!st || !st.enabled || (!st.lots.length && !st.ready)) { box.innerHTML = ""; return; }
    const t = Math.floor(Date.now() / 1000);
    box.innerHTML = `
      ${st.ready ? `<p class="lot-ripe-now">${st.ready.icon} ${st.ready.remaining} booster${st.ready.remaining > 1 ? "s" : ""} ${esc(st.ready.label.toLowerCase())}${st.ready.remaining > 1 ? "s" : ""} à ouvrir : ils profitent du bonus</p>` : ""}
      ${st.lots.map((l) => `
        <div class="vend-lot ${l.ready ? "ready" : "locked"}" data-lot="${esc(l.id)}">
          <span class="vend-lot-ico" aria-hidden="true">${l.ready ? l.icon : "&#128274;"}</span>
          <div class="vend-lot-body">
            <strong>Lot ${esc(l.label.toLowerCase())} · ${l.count} booster${l.count > 1 ? "s" : ""}</strong>
            <small>${contents(l.items)}</small>
            <small>+${l.finish} pts de finition par booster${l.special ? " · une finition spéciale garantie chacun" : ""}</small>
          </div>
          ${l.ready
            ? `<button type="button" class="btn" data-lot-claim="${esc(l.id)}">&#127873; Ouvrir le lot (gratuit)</button>`
            : `<div class="vend-lot-side"><span class="vend-lot-timer">${left(l.readyAt - t)}</span><button type="button" class="btn-ghost" data-lot-cancel="${esc(l.id)}" title="Rend les jetons, sans bonus">Annuler</button></div>`}
        </div>`).join("")}`;
  }

  async function load() {
    if (!Session.isLoggedIn()) return;
    try { st = await API.post("ripen", { userId: Session.userId, action: "status" }); } catch (e) { st = null; }
    render();
    if (window.BoosterCart) BoosterCart.render();
    clearInterval(tick);
    tick = setInterval(() => {
      const t = Math.floor(Date.now() / 1000);
      if (st && st.lots.some((l) => !l.ready && l.readyAt <= t)) load(); else render();
    }, 30000);
  }

  // Mettre la selection a murir (appele par le panier).
  async function store(items, stage) {
    try {
      st = await API.post("ripen", { userId: Session.userId, action: "store", items, stage });
      const s = st.stages[stage];
      Toast.success(`${s.icon || "🍏"} Lot mis à mûrir : prêt dans ${s.hours} h.`);
      if (typeof refreshStatus === "function") await refreshStatus();
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      render();
      return true;
    } catch (err) {
      Toast.error({ no_slot: `Plus de place au mûrissoir${err.data && err.data.level ? ` (un lot de plus au niveau ${err.data.level})` : ""}.`, no_boosters: "Pas assez de jetons.", empty_selection: "Sélection vide." }[err.code] || friendlyError(err));
      return false;
    }
  }

  document.addEventListener("click", async (e) => {
    const claim = e.target.closest("[data-lot-claim]");
    const cancel = e.target.closest("[data-lot-cancel]");
    if (!claim && !cancel) return;
    const btn = claim || cancel;
    btn.disabled = true;
    try {
      const lotId = claim ? claim.dataset.lotClaim : cancel.dataset.lotCancel;
      if (cancel) {
        st = await API.post("ripen", { userId: Session.userId, action: "cancel", lotId });
        Toast.info("Lot annulé : jetons rendus.");
        if (typeof refreshStatus === "function") await refreshStatus();
        render();
        return;
      }
      st = await API.post("ripen", { userId: Session.userId, action: "claim", lotId });
      render();
      if (typeof refreshStatus === "function") await refreshStatus();
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      // Le lot remplit le panier et s'ouvre aussitot.
      if (window.BoosterCart) { BoosterCart.fill(st.claimed.items); BoosterCart.openFirst(); }
    } catch (err) {
      btn.disabled = false;
      Toast.error({ ripe_waiting: "Ouvre d'abord les boosters mûrs déjà repris.", lot_not_ready: "Ce lot n'a pas fini de mûrir.", lot_ready: "Ce lot est déjà mûr : ouvre-le !" }[err.code] || friendlyError(err));
      load();
    }
  });
  document.addEventListener("ripen:refresh", load);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
  window.Ripen = { load, store, render, get state() { return st; } };
})();
