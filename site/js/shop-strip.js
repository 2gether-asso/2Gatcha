// Boutique eclatee (2026-10-18) : chaque page affiche les objets de la
// boutique qui la concernent (colonne « pages » du catalogue, Admin >
// Reglages > Boutique). Un bandeau par element [data-shop-strip="page"] :
// fouille, peche, jardin, expedition, ouverture, collection. Apres un achat,
// l'evenement "shop:bought" { key } permet a la page de se rafraichir.

(function () {
  const LINK = { fouille: "bonus", peche: "ressources", jardin: "bonus", expedition: "bonus", ouverture: "ressources", collection: "ressources" };
  const ERR = { energy_full: "Ton énergie est déjà pleine.", weekly_cap: "Limite de la semaine atteinte.", not_enough_dust: "Pas assez de poussières.", no_expedition: "Aucune expédition en cours.", nothing_growing: "Rien ne pousse en ce moment." };
  let state = null;

  function render() {
    document.querySelectorAll("[data-shop-strip]").forEach((el) => {
      const page = el.dataset.shopStrip;
      const items = state ? state.items.filter((it) => (it.pages || []).includes(page)) : [];
      el.classList.add("dig-shop");
      el.innerHTML = items.length ? `<span class="dig-shop-label">Boutique :</span>${items.map((it) => `<button type="button" class="btn-ghost dig-shop-btn" data-shop-buy="${it.key}" ${it.left === 0 || state.stardust < it.price ? "disabled" : ""} title="${escHtml(it.desc)}${it.escalate && it.escalate.today ? ` · ${it.escalate.today} acheté(s) aujourd’hui, prix de base à minuit` : ""}">${iconOf(it.icon)} ${escHtml(it.label)} <small>${it.price} &#10024;</small></button>`).join("")}<a class="dig-shop-more" href="boutique.html#${LINK[page] || "ressources"}">Tout voir</a>` : "";
    });
  }

  async function load() {
    if (!document.querySelector("[data-shop-strip]") || !Session.isLoggedIn()) return;
    try { state = await API.shop(Session.userId); } catch (e) { state = null; }
    render();
  }

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-shop-strip] [data-shop-buy]");
    if (!b) return;
    b.disabled = true;
    try {
      state = await API.shop(Session.userId, "buy", b.dataset.shopBuy);
      Toast.success("&#128722; Acheté !");
      render();
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      document.dispatchEvent(new CustomEvent("shop:bought", { detail: { key: b.dataset.shopBuy } }));
    } catch (err) {
      b.disabled = false;
      Toast.error(ERR[err.code] || friendlyError(err));
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
  window.ShopStrip = { load, render };
})();
