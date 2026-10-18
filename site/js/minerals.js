// Comptoir des mineraux (onglet Marche noir de la page Communaute,
// 2026-10-18) : les mineraux trouves a la fouille se revendent en poussieres
// ou s'echangent contre des ressources (api/src/native/digdepth.js).

(function () {
  const esc = escHtml;
  const img = (p) => `assets/${encodeURI(p)}`;
  let state = null;

  function render() {
    const box = document.getElementById("mineral-counter");
    if (!box || !state) return;
    const owned = state.minerals.filter((m) => m.count > 0);
    const total = owned.reduce((s, m) => s + m.count, 0);
    box.innerHTML = `
      <h3>&#9935;&#65039; Comptoir des minéraux <small>${total} minér${total > 1 ? "aux" : "al"} dans ton sac</small></h3>
      <p class="lead" style="font-size:0.82rem;">Les minéraux se trouvent en fouillant, de plus en plus précieux avec la profondeur. Revends-les ou échange-les contre des ressources.</p>
      <div class="mineral-tiers">${state.tiers.map((t) => `<span class="mineral-tier tier-${t.tier}">${esc(t.name)} : <strong>${t.owned}</strong> · ${t.value} &#10024; pièce</span>`).join("")}</div>
      <h4>Échanges</h4>
      <div class="mineral-trades">${state.trades.map((t) => {
        const have = state.tiers[t.tier - 1]?.owned || 0;
        return `<button type="button" class="btn-secondary mineral-trade" data-trade="${t.index}" ${have < t.n ? "disabled" : ""}>${t.n} × ${esc(state.tiers[t.tier - 1]?.name || "")} &rarr; ${esc(t.label)}</button>`;
      }).join("")}</div>
      <h4>Revendre</h4>
      ${owned.length ? `<div class="mineral-grid">${owned.map((m) => `
        <div class="mineral-card tier-${m.tier}">
          <img src="${img(m.img)}" alt="" />
          <strong>${esc(m.name)}</strong><small>×${m.count} · ${m.value} &#10024;</small>
          <div class="mineral-actions">
            <button type="button" class="btn-ghost" data-sell="${m.key}" data-n="1">Vendre 1</button>
            ${m.count > 1 ? `<button type="button" class="btn-ghost" data-sell="${m.key}" data-n="${m.count}">Tout (${m.count * m.value} &#10024;)</button>` : ""}
          </div>
        </div>`).join("")}</div>` : `<p class="muted">Ton sac est vide : va fouiller !</p>`}`;
  }

  async function load() {
    try { state = await API.minerals(Session.userId); render(); } catch (e) { /* comptoir facultatif */ }
  }

  document.addEventListener("click", async (e) => {
    const sell = e.target.closest("#mineral-counter [data-sell]");
    const trade = e.target.closest("#mineral-counter [data-trade]");
    if (!sell && !trade) return;
    const btn = sell || trade;
    btn.disabled = true;
    try {
      if (sell) {
        const res = await API.minerals(Session.userId, "sell", { key: sell.dataset.sell, count: Number(sell.dataset.n) || 1 });
        state = res;
        Toast.success(`&#10024; ${res.sold.count} ${esc(res.sold.name)} vendu${res.sold.count > 1 ? "s" : ""} : +${res.sold.dust} poussières`);
      } else {
        const res = await API.minerals(Session.userId, "trade", { index: Number(trade.dataset.trade) });
        state = res;
        Toast.success("&#9935;&#65039; Échange conclu !");
      }
      render();
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (err) {
      btn.disabled = false;
      Toast.error(err.code === "not_enough_minerals" ? "Pas assez de minéraux." : friendlyError(err));
    }
  });

  window.MineralCounter = { load };
})();
