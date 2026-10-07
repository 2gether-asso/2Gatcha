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

  async function loadCopies() {
    try {
      const [col, cat] = await Promise.all([API.getCollection(Session.userId), API.getCards()]);
      const cards = new Map((cat.cards || []).map((c) => [c.cardId, c]));
      copies = [];
      (col.owned || []).forEach((o) => (o.copies || []).forEach((c) => {
        const card = cards.get(o.cardId);
        if (!card || card.isPromo || (col.insuredPullIds || []).includes(c.pullId)) return;
        copies.push({ pullId: c.pullId, name: card.name, label: `${card.name} · ${card.rarity?.name || ""}${c.finish && c.finish !== "normal" ? " · " + FINISH[c.finish] : ""} · ${QUALITY[c.quality || "damaged"]} ${serial(c.serialNumber)}${o.count > 1 ? ` (×${o.count})` : ""}` });
      }));
      copies.sort((a, b) => a.label.localeCompare(b.label, "fr"));
      renderCopies();
    } catch (e) { /* collection indisponible */ }
  }
  function renderCopies() {
    const q = ($("auction-search").value || "").toLowerCase();
    const list = copies.filter((c) => !q || c.label.toLowerCase().includes(q)).slice(0, 200);
    $("auction-pull").innerHTML = list.length ? list.map((c) => `<label class="auction-pick-item"><input type="radio" name="auction-pull" value="${c.pullId}" /> <span>${esc(c.label)}</span></label>`).join("") : '<p class="muted">Aucun exemplaire.</p>';
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
    $("auction-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pullId = Number((document.querySelector('input[name="auction-pull"]:checked') || {}).value);
      const startPrice = Number($("auction-price").value);
      if (!pullId) { Toast.error("Choisis un exemplaire."); return; }
      const label = copies.find((c) => c.pullId === pullId)?.label || "cet exemplaire";
      const okSell = await Confirm.show(`Mettre <strong>${esc(label)}</strong> aux enchères à partir de <strong>${startPrice} poussières</strong> ? Il quitte ta collection pendant la vente (rendu s'il ne trouve pas preneur).`, { title: "Mettre en vente ?", confirmText: "Mettre en vente" });
      if (!okSell) return;
      try {
        data = await API.auctions(Session.userId, "create", { pullId, startPrice });
        render();
        copies = copies.filter((c) => c.pullId !== pullId);
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
