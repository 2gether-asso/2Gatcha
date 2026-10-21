// Module charge a la demande : boutons [data-wishlist-open] (menu du compte,
// collection, echanges), via shell-extras.js.
// Ma liste de souhaits (2026-10-21) : toutes les cartes souhaitees au meme
// endroit, avec pour chacune ou l'obtenir maintenant (doublon d'un joueur,
// marche noir, coffre de guilde : GET wishlist-alerts), si elle se crafte
// avec les poussieres actuelles, si elle est deja obtenue, et un bouton pour
// la retirer. Routes existantes : wishlist (list / remove), wishlist-alerts,
// cards, collection, booster-status. Une carte deja obtenue est retiree
// (WishlistSync, shell-extras.js).

const WishlistView = (function () {
  const esc = escHtml;
  let overlay = null;

  function rowHtml(c, d) {
    const color = (c.rarity && c.rarity.colorHex) || "#9aa0b4";
    const where = d.where.get(c.cardId) || [];
    const owned = d.owned.has(c.cardId);
    const cost = c.rarity && c.rarity.craftCost;
    const craftable = !owned && !c.isPromo && cost != null && d.dust >= cost;
    const chips = [];
    if (owned) chips.push('<span class="wl-chip wl-ok">&#10003; Déjà dans ta collection</span>');
    where.forEach((w) => chips.push(`<a class="wl-chip wl-go" href="${esc(w.url)}">${w.kind === "player" ? "&#8644;" : w.kind === "market" ? "&#127761;" : "&#127873;"} ${esc(w.label)}</a>`));
    if (craftable) chips.push(`<a class="wl-chip wl-go" href="collection.html#craft">&#10024; À crafter : ${cost.toLocaleString("fr-FR")} poussières</a>`);
    else if (!owned && cost != null && !c.isPromo) chips.push(`<span class="wl-chip">&#10024; Craft : ${cost.toLocaleString("fr-FR")} poussières (il t'en manque ${(cost - d.dust).toLocaleString("fr-FR")})</span>`);
    if (!owned && !where.length) chips.push('<span class="wl-chip wl-wait">&#9203; Personne ne l\'a en double pour l\'instant : tu seras prévenu</span>');
    return `<li class="wl-row ${where.length ? "wl-available" : ""}" style="--r:${esc(color)}">
      <img src="${API.imageUrl(c.imageId) || PLACEHOLDER_IMG}" alt="" loading="lazy" decoding="async" />
      <div class="wl-body"><strong>${esc(c.name)}</strong><small style="color:${rarityTextColor(color)}">${esc((c.rarity && c.rarity.name) || "")}${c.extension ? " · " + esc(c.extension.name) : ""}</small>
        <div class="wl-chips">${chips.join("")}</div></div>
      <button type="button" class="wl-remove" data-wl-remove="${c.cardId}" title="Retirer de ma liste de souhaits" aria-label="Retirer ${esc(c.name)} de ma liste de souhaits">&#9829;</button>
    </li>`;
  }

  async function render() {
    const body = overlay.querySelector(".wl-list-host");
    const uid = Session.userId;
    const settle = (p) => p.then((v) => v, () => null);
    const [list, alerts, cards, col, status] = await Promise.all([
      API.listWishlist(uid), settle(API.wishlistAlerts(uid)), settle(API.getCards()), settle(API.getCollection(uid)), settle(API.getBoosterStatus(uid))
    ]);
    const catalog = new Map(((cards && cards.cards) || []).map((c) => [c.cardId, c]));
    const ids = ((list && list.wishlist) || []).map((w) => w.cardId);
    const d = {
      where: new Map(((alerts && alerts.items) || []).map((it) => [it.card.cardId, it.where])),
      owned: new Set(((col && col.owned) || []).map((o) => o.cardId)),
      dust: (status && status.stardust) || 0
    };
    let wl = ((list && list.wishlist) || []).map((w) => ({ ...w, ...(catalog.get(w.cardId) || {}) }));
    // Deja obtenues : retirees de la liste (shell-extras.js WishlistSync).
    const got = new Map(wl.filter((c) => d.owned.has(c.cardId)).map((c) => [c.cardId, c.name || ""]));
    if (got.size && typeof WishlistSync !== "undefined") {
      const done = await WishlistSync.remove(got).catch(() => []);
      wl = wl.filter((c) => !done.includes(c.cardId));
      ids.splice(0, ids.length, ...wl.map((c) => c.cardId));
    }
    // Disponibles d'abord, puis rarete decroissante.
    wl.sort((a, b) => ((d.where.has(b.cardId) ? 1 : 0) - (d.where.has(a.cardId) ? 1 : 0)) || ((b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0)));
    const avail = wl.filter((c) => d.where.has(c.cardId)).length;
    overlay.querySelector(".wl-count").textContent = ids.length ? `${ids.length} carte${ids.length > 1 ? "s" : ""}${avail ? ` · ${avail} disponible${avail > 1 ? "s" : ""} maintenant` : ""}` : "";
    body.innerHTML = wl.length
      ? `<ul class="wl-list">${wl.map((c) => rowHtml(c, d)).join("")}</ul>`
      : `<div class="wl-empty"><span aria-hidden="true">&#9825;</span><p>Ta liste est vide.</p><p class="muted">Dans ta collection, chaque carte qui te manque a un bouton <strong>« &#9825; Souhaiter »</strong>. Ajoute celles que tu cherches : le site te préviendra dès qu'un joueur en a une en double.</p>
          <a class="btn" href="collection.html#classeur" data-wl-missing>Voir mes cartes manquantes</a></div>`;
  }

  async function open() {
    if (!Session.isLoggedIn()) { Toast.info("Connecte-toi pour gérer ta liste de souhaits."); return; }
    overlay = document.createElement("div");
    overlay.className = "card-modal-overlay contract-overlay wl-overlay";
    overlay.innerHTML = `<div class="contract-modal wl-modal" role="dialog" aria-modal="true" aria-labelledby="wl-title">
      <header class="contract-modal-head"><div><strong id="wl-title">&#9829; Ma liste de souhaits</strong><small class="wl-count"></small></div>
        <button type="button" class="card-modal-close" data-wl-close aria-label="Fermer">&times;</button></header>
      <details class="wl-help"><summary>À quoi elle sert ?</summary>
        <ul>
          <li>Tu es <strong>prévenu</strong> (cloche, pastille sur Échanges) dès qu'une carte souhaitée est disponible : un joueur l'a en double, elle est au marché noir ou au coffre de guilde.</li>
          <li>Les autres joueurs la voient sur ton profil (« Recherche activement ») et dans leurs propositions d'échange.</li>
          <li>Le recyclage et l'autel peuvent la protéger, et certains modes de jeu te laissent en choisir une à recevoir.</li>
          <li>Ajoute une carte depuis ta collection : bouton <strong>« &#9825; Souhaiter »</strong> sur une carte manquante.</li>
          <li>Dès que tu obtiens une carte souhaitée (booster, craft, échange, coffre…), elle sort toute seule de la liste.</li>
        </ul>
      </details>
      <div class="wl-list-host"><div class="loading-row"><div class="spinner"></div></div></div>
    </div>`;
    document.body.appendChild(overlay);
    if (typeof syncScrollLock === "function") syncScrollLock();
    const close = () => { overlay.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); };
    overlay.addEventListener("click", async (e) => {
      if (e.target === overlay || e.target.closest("[data-wl-close]")) { close(); return; }
      if (e.target.closest("[data-wl-missing]")) { try { localStorage.setItem("2gatcha_coll_missing_hint", "1"); } catch (err) { /* stockage indisponible */ } return; }
      const rm = e.target.closest("[data-wl-remove]");
      if (!rm) return;
      rm.disabled = true;
      try {
        await API.removeFromWishlist(Session.userId, Number(rm.dataset.wlRemove));
        rm.closest(".wl-row").remove();
        Toast.info("Retirée de ta liste de souhaits.");
        document.dispatchEvent(new CustomEvent("wishlist:change", { detail: { cardId: Number(rm.dataset.wlRemove), on: false } }));
        if (!overlay.querySelector(".wl-row")) render();
      } catch (err) { rm.disabled = false; Toast.error(typeof friendlyError === "function" ? friendlyError(err) : err.message); }
    });
    overlay.querySelector("[data-wl-close]").focus();
    try { await render(); } catch (e) { overlay.querySelector(".wl-list-host").innerHTML = '<p class="cmp-empty">Liste indisponible pour le moment.</p>'; }
  }

  return { open };
})();
