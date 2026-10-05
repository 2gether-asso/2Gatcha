// Boutique (boutique.html, 2026-10-05) : titres, cadres d'avatar et couleurs
// de pseudo, achetes en poussieres ou gagnes. Voir api/src/native/cosmetics.js.

(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let state = null;

  function preview(st) {
    const d = st.decor || {};
    const avatar = Session.discordAvatar ? `<img src="${Session.discordAvatar}" alt="" />` : `<span>${esc((Session.pseudo || "?").slice(0, 1))}</span>`;
    document.getElementById("shop-preview").innerHTML = `
      <span class="decor-avatar ${d.frame ? "decor-" + d.frame : ""}">${avatar}</span>
      <div><div class="decor-pseudo ${d.color ? "decor-" + d.color : ""}">${esc(Session.pseudo || "")}</div>
      ${d.title ? `<div class="decor-title">${esc(d.title)}</div>` : `<div class="decor-title muted">Aucun titre équipé</div>`}</div>
      <div class="shop-balance">&#10024; <strong>${st.stardust}</strong> poussières</div>`;
  }

  function itemHtml(it, st) {
    const equipped = st.equipped[it.type] === it.key;
    const sample = it.type === "frame"
      ? `<span class="decor-avatar small decor-${esc(it.key)}"><span>${esc((Session.pseudo || "?").slice(0, 1))}</span></span>`
      : it.type === "color" ? `<span class="decor-pseudo decor-${esc(it.key)}">${esc(Session.pseudo || "Pseudo")}</span>`
      : `<span class="decor-title">${esc(it.label)}</span>`;
    let action;
    if (equipped) action = `<button type="button" class="btn-ghost" data-unequip="${it.type}">Retirer</button>`;
    else if (it.owned) action = `<button type="button" class="btn-secondary" data-equip="${esc(it.key)}" data-type="${it.type}">Équiper</button>`;
    else action = `<button type="button" class="btn" data-buy="${esc(it.key)}" ${st.stardust < it.price ? "disabled" : ""}>${it.price} &#10024;</button>`;
    return `<div class="shop-item ${it.owned ? "owned" : ""} ${equipped ? "equipped" : ""}">
      <div class="shop-sample">${sample}</div>
      <div class="shop-name">${esc(it.label)}${it.earned ? ' <span class="shop-earned">gagné</span>' : ""}</div>
      ${action}
    </div>`;
  }

  function render(st) {
    state = st;
    preview(st);
    const all = [...st.shop, ...st.earned];
    for (const type of ["title", "frame", "color"]) {
      const list = all.filter((i) => i.type === type);
      document.getElementById("shop-" + type).innerHTML = list.length ? list.map((i) => itemHtml(i, st)).join("") : `<p class="muted">Rien pour l'instant.</p>`;
    }
  }

  async function act(fn, ok) {
    try {
      render(await fn());
      if (ok) Toast.success(ok);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (e) {
      Toast.error({ not_enough_dust: "Pas assez de poussières.", already_owned: "Tu l'as déjà.", not_owned: "Tu ne possèdes pas cet objet." }[e.code] || "Erreur. (" + e.message + ")");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!Session.isLoggedIn()) { document.getElementById("shop-guest").style.display = "block"; return; }
    document.getElementById("shop-zone").style.display = "block";
    API.cosmetics(Session.userId).then(render).catch(() => Toast.error("Impossible de charger la boutique."));
    document.getElementById("shop-zone").addEventListener("click", async (e) => {
      const buy = e.target.closest("[data-buy]"), equip = e.target.closest("[data-equip]"), unequip = e.target.closest("[data-unequip]");
      if (buy) {
        const it = state.shop.find((x) => x.key === buy.dataset.buy);
        if (!it || !(await Confirm.show(`Acheter « ${esc(it.label)} » pour ${it.price} poussières ?`, { title: "Boutique", confirmText: "Acheter" }))) return;
        await act(() => API.cosmetics(Session.userId, "buy", { key: it.key }), `&#128717;&#65039; « ${it.label} » acheté !`);
        if (typeof confetti === "function") confetti({ particleCount: 60, spread: 70, origin: { y: 0.4 } });
      } else if (equip) {
        await act(() => API.cosmetics(Session.userId, "equip", { type: equip.dataset.type, key: equip.dataset.equip }), "Équipé !");
      } else if (unequip) {
        await act(() => API.cosmetics(Session.userId, "equip", { type: unequip.dataset.unequip, key: "" }), "Retiré.");
      }
    });
  });
})();
