// Encheres (communaute.html#encheres, 2026-10-07) : ventes de 24 h en
// poussieres, sequestre de l'exemplaire, surenchere remboursee, taxe a la
// vente, prolongation de 5 min si une enchere arrive a la fin.
// Voir api/src/native/market.js.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const FINISH = { normal: "", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const QUALITY = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };
  const serial = (n) => (n != null ? "#" + String(n).padStart(3, "0") : "");
  let data = null;
  let copies = [];
  let selectedPull = null;
  const RANK = { holo: 1, gold: 2, ghost: 3, diamond: 4, rainbow: 5 };
  const QRANK = { damaged: 0, worn: 1, good: 2, mint: 3 };
  let timer = null;

  function left(t) {
    const s = Math.max(0, t - Date.now() / 1000);
    if (s < 60) return "moins d’une minute";
    if (s < 3600) return `${Math.floor(s / 60)} min`;
    return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  }

  function variant(a) { return [FINISH[a.finish], QUALITY[a.quality], serial(a.serialNumber)].filter(Boolean).join(" · "); }

  function render() {
    if (!data) return;
    $("auctions-lead").innerHTML = `Mets un exemplaire en vente (${data.hours} h, ${data.maxActive} ventes en même temps max), ou enchéris sur ceux des autres. Une enchère surpassée est remboursée aussitôt. Taxe à la vente : <strong>${Math.round(data.taxPct * 100)} %</strong>. Solde : <strong>${data.stardust.toLocaleString("fr-FR")} &#10024;</strong>.`;
    $("auction-list").innerHTML = data.open.length ? data.open.map((a) => `
      <article class="auction ${a.mine ? "mine" : ""} ${a.leading ? "leading" : ""} ${a.starred ? "starred" : ""}" data-rarity="${esc(a.card?.rarity?.key || "commune")}">
        <img src="${API.imageUrl(a.card?.imageId) || ""}" alt="" loading="lazy" />
        <div class="auction-body">
          <strong>${esc(a.card?.name || "?")}${a.starred ? ' <span class="star-badge" style="position:static;">&#9733;</span>' : ""}</strong>
          <small>${esc(a.card?.rarity?.name || "")}${variant(a) ? " · " + esc(variant(a)) : ""}</small>
          <small>Vendu par ${esc(a.seller)} · fin dans <span data-ends="${a.endsAt}">${left(a.endsAt)}</span></small>
          <div class="auction-price">${a.currentBid ? `<strong>${a.currentBid.toLocaleString("fr-FR")} &#10024;</strong> <small>${a.bids} enchère${a.bids > 1 ? "s" : ""}${a.leading ? " · tu mènes !" : a.bidder ? " · " + esc(a.bidder) : ""}</small>` : `<strong>${a.startPrice.toLocaleString("fr-FR")} &#10024;</strong> <small>prix de départ</small>`}</div>
        </div>
        <div class="auction-act">
          ${a.mine ? (a.bids ? '<span class="auction-tag">Ta vente</span>' : `<button type="button" class="btn-ghost" data-cancel="${a.id}">Retirer</button>`)
            : a.leading ? '<span class="auction-tag lead">Meilleure offre</span>'
            : `<input type="number" min="${a.minNext}" step="5" value="${a.minNext}" aria-label="Montant de l'enchère" data-amount="${a.id}" /><button type="button" class="btn" data-bid="${a.id}">Enchérir</button>`}
        </div>
      </article>`).join("") : `<div class="empty-state">Aucune vente en cours. Sois le premier à mettre une carte aux enchères !</div>`;
    $("auction-history").innerHTML = data.history.length ? data.history.map((a) => `<li>${a.status === "sold" ? (a.mine ? "&#128176; Vendu" : "&#127942; Acheté") : a.status === "unsold" ? "&#8617;&#65039; Invendu (rendu)" : "&#10006; Retiré"} : ${esc(a.card?.name || "?")} ${esc(variant(a))}${a.status === "sold" ? ` pour <strong>${a.currentBid} &#10024;</strong>` : ""}</li>`).join("") : "<li class=\"muted\">Rien pour l’instant.</li>";
  }

  // Selecteur visuel (2026-10-07) : vignettes cliquables, filtres, prix conseille.
  async function loadCopies() {
    try {
      const [col, cat] = await Promise.all([API.getCollection(Session.userId), API.getCards()]);
      const cards = new Map((cat.cards || []).map((c) => [c.cardId, c]));
      const fm = cat.finishMultipliers || {}, qm = cat.qualityMultipliers || {};
      const insured = new Set(col.insuredPullIds || []);
      const rarities = new Map();
      copies = [];
      (col.owned || []).forEach((o) => (o.copies || []).forEach((c) => {
        const card = cards.get(o.cardId);
        if (!card || card.isPromo || insured.has(c.pullId)) return;
        const finish = c.finish || "normal", quality = c.quality || "damaged";
        if (card.rarity) rarities.set(card.rarity.key, card.rarity);
        const value = Math.round((card.rarity?.disenchantValue || 0) * (fm[finish] ?? 1) * (qm[quality] ?? 1));
        copies.push({
          pullId: c.pullId, card, finish, quality, serialNumber: c.serialNumber, count: o.count, value,
          label: `${card.name} · ${card.rarity?.name || ""}${finish !== "normal" ? " · " + FINISH[finish] : ""} · ${QUALITY[quality]} ${serial(c.serialNumber)}`
        });
      }));
      // Les plus belles d'abord : rarete, finition, etat, puis nom.
      copies.sort((a, b) => ((b.card.rarity?.sortOrder || 0) - (a.card.rarity?.sortOrder || 0)) || ((RANK[b.finish] || 0) - (RANK[a.finish] || 0)) || (QRANK[b.quality] - QRANK[a.quality]) || a.card.name.localeCompare(b.card.name, "fr"));
      $("auction-rarity").innerHTML = '<option value="">Toutes raretés</option>' + [...rarities.values()].sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0)).map((r) => `<option value="${r.key}">${esc(r.name)}</option>`).join("");
      renderCopies();
    } catch (e) { /* collection indisponible */ }
  }
  function renderCopies() {
    const q = ($("auction-search").value || "").toLowerCase();
    const rarity = $("auction-rarity").value;
    const dupes = $("auction-dupes").checked;
    const list = copies.filter((c) => (!q || c.card.name.toLowerCase().includes(q)) && (!rarity || c.card.rarity?.key === rarity) && (!dupes || c.count > 1));
    $("auction-pull").innerHTML = list.length ? list.slice(0, 120).map((c) => `
      <button type="button" class="auction-pick-card ${selectedPull === c.pullId ? "selected" : ""}" data-pull="${c.pullId}" data-rarity="${esc(c.card.rarity?.key || "commune")}" data-finish="${c.finish}" role="option" aria-selected="${selectedPull === c.pullId}" title="${esc(c.label)}">
        <span class="apc-art">
          <img src="${API.imageUrl(c.card.imageId) || ""}" alt="" loading="lazy" />
          ${c.finish !== "normal" ? `<span class="finish-indicator" data-finish="${c.finish}">${FINISH[c.finish]}</span>` : ""}
          <span class="quality-indicator" data-quality="${c.quality}">${QUALITY[c.quality]}</span>
          ${c.count > 1 ? `<span class="apc-count">×${c.count}</span>` : ""}
        </span>
        <span class="apc-name">${esc(c.card.name)}</span>
        <span class="apc-meta">${serial(c.serialNumber) || "&nbsp;"}</span>
      </button>`).join("") + (list.length > 120 ? `<p class="muted apc-more">${list.length - 120} autres : affine la recherche.</p>` : "")
      : `<p class="muted apc-empty">${dupes ? "Aucun doublon ne correspond. Décoche « Doublons seulement » pour voir toutes tes cartes." : "Aucun exemplaire ne correspond."}</p>`;
  }
  function selectCopy(pullId) {
    selectedPull = pullId;
    const c = copies.find((x) => x.pullId === pullId);
    document.querySelectorAll(".auction-pick-card").forEach((b) => { const on = Number(b.dataset.pull) === pullId; b.classList.toggle("selected", on); b.setAttribute("aria-selected", String(on)); });
    $("auction-submit").disabled = !c;
    if (!c) { $("auction-sell-preview").innerHTML = '<span class="muted">Choisis un exemplaire ci-dessus.</span>'; return; }
    const suggested = Math.max(10, Math.round((c.value * 1.5) / 10) * 10);
    $("auction-price").value = suggested;
    $("auction-sell-preview").innerHTML = `
      <img src="${API.imageUrl(c.card.imageId) || ""}" alt="" style="--r:${esc(c.card.rarity?.colorHex || "#888")}" />
      <span><strong>${esc(c.card.name)}</strong><small>${esc(c.card.rarity?.name || "")}${c.finish !== "normal" ? " · " + FINISH[c.finish] : ""} · ${QUALITY[c.quality]} ${serial(c.serialNumber)}</small><small>Décraft ≈ ${c.value} &#10024; · prix conseillé ${suggested} &#10024;</small></span>`;
  }

  window.loadAuctions = async function () {
    if (!Session.isLoggedIn()) return;
    try { data = await API.auctions(Session.userId, "list"); render(); } catch (e) { $("auction-list").innerHTML = `<div class="empty-state">Enchères indisponibles.</div>`; }
    if (!copies.length) loadCopies();
    clearInterval(timer);
    timer = setInterval(() => {
      if (document.hidden || $("auctions-pane").style.display === "none") return;
      document.querySelectorAll("[data-ends]").forEach((el) => { el.textContent = left(Number(el.dataset.ends)); });
    }, 15000);
  };

  const ERR = { bid_too_low: "Enchère trop basse.", not_enough_dust: "Pas assez de poussières.", own_auction: "C'est ta propre vente.", auction_closed: "Cette vente est terminée.", already_leading: "Tu as déjà la meilleure offre.", too_many_auctions: "Tu as déjà trop de ventes en cours.", insured_copy: "Cet exemplaire est assuré : retire l'assurance d'abord.", invalid_price: "Prix de départ invalide (10 minimum).", has_bids: "Il y a déjà des enchères : impossible de retirer." };

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("auction-list")) return;
    $("auction-search").addEventListener("input", renderCopies);
    $("auction-rarity").addEventListener("change", renderCopies);
    $("auction-dupes").addEventListener("change", renderCopies);
    $("auction-pull").addEventListener("click", (e) => { const b = e.target.closest("[data-pull]"); if (b) selectCopy(Number(b.dataset.pull)); });
    $("auction-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pullId = selectedPull;
      const startPrice = Number($("auction-price").value);
      if (!pullId) { Toast.error("Choisis un exemplaire."); return; }
      const label = copies.find((c) => c.pullId === pullId)?.label || "cet exemplaire";
      const okSell = await Confirm.show(`Mettre <strong>${esc(label)}</strong> aux enchères à partir de <strong>${startPrice} poussières</strong> ? Il quitte ta collection pendant la vente (rendu s'il ne trouve pas preneur).`, { title: "Mettre en vente ?", confirmText: "Mettre en vente" });
      if (!okSell) return;
      try {
        data = await API.auctions(Session.userId, "create", { pullId, startPrice });
        render();
        copies = copies.filter((c) => c.pullId !== pullId);
        selectCopy(null);
        renderCopies();
        Toast.success("&#128296; Ta carte est aux enchères !");
      } catch (err) { Toast.error(ERR[err.code] || "Erreur. (" + err.message + ")"); }
    });
    $("auction-list").addEventListener("click", async (e) => {
      const bid = e.target.closest("[data-bid]");
      const cancel = e.target.closest("[data-cancel]");
      if (bid) {
        const id = Number(bid.dataset.bid);
        const amount = Number(document.querySelector(`[data-amount="${id}"]`).value);
        bid.disabled = true;
        try {
          data = await API.auctions(Session.userId, "bid", { auctionId: id, amount });
          render();
          Toast.success(`&#128296; Enchère de ${amount} poussières placée !`);
          if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
        } catch (err) { bid.disabled = false; Toast.error(ERR[err.code] ? ERR[err.code] + (err.data && err.data.minNext ? ` (minimum ${err.data.minNext})` : "") : "Erreur. (" + err.message + ")"); }
      } else if (cancel) {
        try { data = await API.auctions(Session.userId, "cancel", { auctionId: Number(cancel.dataset.cancel) }); render(); copies = []; loadCopies(); Toast.success("Vente retirée, la carte est revenue."); } catch (err) { Toast.error(ERR[err.code] || "Erreur. (" + err.message + ")"); }
      }
    });
  });
})();
