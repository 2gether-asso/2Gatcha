// Boutique (2026-10-07) : porte-monnaie, boosters de la semaine, objets et
// bonus, contrats de collection (selecteur visuel avec compteur).
// Voir api/src/native/shop.js et market.js.

(function () {
  if (!Session.isLoggedIn()) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
  const FINISH = { normal: "", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const QUALITY = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };
  const serial = (n) => (n != null ? "#" + String(n).padStart(3, "0") : "");
  const rewardLabel = (r) => [r.boosters ? `${r.boosters} &#127183;` : "", r.chests ? `${r.chests} coffre${r.chests > 1 ? "s" : ""}` : "", r.keys ? `${r.keys} clé${r.keys > 1 ? "s" : ""}` : "", r.dust ? `${r.dust} &#10024;` : "", r.worms ? `${r.worms} vers` : ""].filter(Boolean).join(" + ");
  const ERR = { weekly_cap: "Stock épuisé pour cette semaine.", not_enough_dust: "Pas assez de poussières.", nothing_growing: "Rien ne pousse au jardin en ce moment.", no_expedition: "Aucune expédition en cours.", copy_not_matching: "Un des exemplaires ne correspond pas au contrat.", wrong_count: "Mauvais nombre d'exemplaires.", already_claimed: "Contrat déjà rempli cette semaine." };
  let shop = null, contracts = null, boosterSt = null, eco = null;

  // --- porte-monnaie ------------------------------------------------------------
  function renderWallet() {
    const st = shop || {};
    const left = st.xpBoostUntil ? Math.max(1, Math.ceil((st.xpBoostUntil - Date.now() / 1000) / 60)) : 0;
    $("shop-wallet").innerHTML = `
      <span class="wallet-dust"><span aria-hidden="true">&#10024;</span><strong>${fmt(st.stardust ?? boosterSt?.stardust ?? 0)}</strong><small>poussières</small></span>
      ${st.luckCharges ? `<span class="wallet-boost" title="Élixir de chance actif">&#129514; ${st.luckCharges} booster${st.luckCharges > 1 ? "s" : ""} chanceux</span>` : ""}
      ${left ? `<span class="wallet-boost" title="Potion de savoir active">&#128216; XP ×2 encore ${left} min</span>` : ""}
      ${eco && (eco.tight || eco.priceFactor > 1) ? `<span class="wallet-eco ${eco.tight ? "tight" : ""}" title="${eco.tight ? "Mode anti-inflation : prix +25 %, taxes ×1,5, doublons moins rentables, le temps que l'économie se calme." : "Les prix suivent la richesse moyenne des joueurs actifs."}">&#127974; ${eco.tight ? "Anti-inflation · " : ""}prix ×${String(eco.priceFactor).replace(".", ",")}</span>` : ""}`;
  }
  window.refreshShopWallet = () => API.shop(Session.userId).then((s) => { shop = s; renderWallet(); renderItems(); }).catch(() => {});

  // --- boosters de la semaine --------------------------------------------------------
  function renderBoosters(st) {
    boosterSt = st;
    $("booster-shop-body").innerHTML = st.cap
      ? `<div class="offer-card">
          <div class="offer-art" aria-hidden="true"><span>&#127183;</span></div>
          <div class="offer-body">
            <strong>Booster</strong>
            <small>5 cartes de l'extension de ton choix. Le prix monte à chaque achat de la semaine.</small>
            <div class="offer-stock">${Array.from({ length: st.cap }, (_, i) => `<span class="${i < st.bought ? "used" : ""}"></span>`).join("")}<em>${st.left}/${st.cap} cette semaine</em></div>
          </div>
          <button type="button" class="btn offer-buy" id="booster-buy" ${st.left && st.stardust >= st.price ? "" : "disabled"}>${st.left ? `${fmt(st.price)} &#10024;` : "Épuisé"}</button>
        </div>`
      : `<p class="muted">La boutique de boosters est fermée pour l'instant.</p>`;
  }

  // --- objets et bonus -----------------------------------------------------------
  function itemCard(it) {
    const out = it.left === 0;
    const poor = (shop.stardust || 0) < it.price;
    return `<article class="shop-thing ${out ? "out" : ""}" data-group="${esc(it.group)}">
      <div class="thing-icon" aria-hidden="true">${it.icon}</div>
      <div class="thing-body"><strong>${esc(it.label)}</strong><small>${esc(it.desc)}</small></div>
      <div class="thing-foot">
        ${it.weekly ? `<span class="thing-stock">${it.left}/${it.weekly} cette semaine</span>` : `<span class="thing-stock">Illimité</span>`}
        <button type="button" class="btn${poor || out ? "-secondary" : ""} thing-buy" data-item="${esc(it.key)}" ${out || poor ? "disabled" : ""}>${out ? "Épuisé" : `${fmt(it.price)} &#10024;`}</button>
      </div>
    </article>`;
  }
  function renderItems() {
    if (!shop) return;
    const by = (g) => shop.items.filter((i) => i.group === g);
    $("shop-resources").innerHTML = by("resources").map(itemCard).join("") || '<p class="muted">Rien pour l’instant.</p>';
    $("shop-boosts").innerHTML = by("boosts").map(itemCard).join("") || '<p class="muted">Rien pour l’instant.</p>';
  }

  // --- contrats --------------------------------------------------------------------
  function renderContracts(st) {
    contracts = st;
    const days = Math.max(0, Math.ceil((st.endsAt - Date.now() / 1000) / 86400));
    $("contracts-grid").innerHTML = st.contracts.map((c) => `
      <article class="contract ${c.done ? "done" : ""} ${c.ready ? "ready" : ""}">
        <header><span class="contract-icon" aria-hidden="true">${c.icon}</span><strong>${esc(c.label)}</strong></header>
        <div class="contract-reward"><span>Récompense</span>${rewardLabel(c.reward)}</div>
        <div class="contract-progress"><span style="width:${Math.min(100, Math.round((c.available / c.count) * 100))}%"></span></div>
        <small>${c.done ? "&#10004; Rempli cette semaine" : `${Math.min(c.available, c.count)}/${c.count} exemplaire${c.count > 1 ? "s" : ""} possible${c.count > 1 ? "s" : ""} · fin dans ${days} j`}</small>
        ${c.done ? "" : `<button type="button" class="btn${c.ready ? "" : "-secondary"}" data-contract="${c.key}" ${c.ready ? "" : "disabled"}>${c.ready ? "Choisir les cartes" : "Pas assez de cartes"}</button>`}
      </article>`).join("");
  }

  // Selecteur : exactement N exemplaires, compteur, plus de case a decocher
  // avant d'en cocher une autre (le plus ancien choix est remplace).
  function openContract(key) {
    const c = contracts.contracts.find((x) => x.key === key);
    if (!c) return;
    let picked = (c.suggested || c.eligible.slice(0, c.count).map((e) => e.pullId)).slice(0, c.count);
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay contract-overlay";
    overlay.innerHTML = `
      <div class="contract-modal" role="dialog" aria-modal="true" aria-label="${esc(c.label)}">
        <header class="contract-modal-head">
          <div><span aria-hidden="true">${c.icon}</span> <strong>${esc(c.label)}</strong><small>Récompense : ${rewardLabel(c.reward)}</small></div>
          <button type="button" class="card-modal-close" data-close aria-label="Fermer">&times;</button>
        </header>
        <p class="contract-modal-help">Choisis <strong>${c.count}</strong> exemplaire${c.count > 1 ? "s" : ""}. Tes doublons sont présélectionnés ; touche une carte pour la choisir ou la retirer.</p>
        <div class="contract-pick" id="contract-pick"></div>
        <footer class="contract-modal-foot">
          <span class="contract-count" id="contract-count"></span>
          <button type="button" class="btn-ghost" data-close>Annuler</button>
          <button type="button" class="btn" id="contract-confirm">Donner ces cartes</button>
        </footer>
      </div>`;
    document.body.appendChild(overlay);
    if (typeof syncScrollLock === "function") syncScrollLock();
    const close = () => { overlay.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); };
    const draw = () => {
      overlay.querySelector("#contract-pick").innerHTML = c.eligible.map((e) => `
        <button type="button" class="auction-pick-card ${picked.includes(e.pullId) ? "selected" : ""}" data-pull="${e.pullId}" data-rarity="${esc(e.card.rarity?.key || "commune")}" aria-pressed="${picked.includes(e.pullId)}">
          <span class="apc-art"><img src="${API.imageUrl(e.card.imageId) || ""}" alt="" loading="lazy" />
            ${e.finish !== "normal" ? `<span class="finish-indicator" data-finish="${e.finish}">${FINISH[e.finish]}</span>` : ""}
            <span class="quality-indicator" data-quality="${e.quality}">${QUALITY[e.quality]}</span>
            <span class="apc-count" title="Exemplaires de cette carte">×${e.copies}</span>
          </span>
          <span class="apc-name">${esc(e.card.name || "?")}</span>
          <span class="apc-meta">${serial(e.serialNumber) || "&nbsp;"}${e.copies <= 1 ? " · dernier" : ""}</span>
        </button>`).join("");
      const n = picked.length;
      overlay.querySelector("#contract-count").innerHTML = `<strong>${n}</strong> / ${c.count} choisie${c.count > 1 ? "s" : ""}`;
      overlay.querySelector("#contract-count").classList.toggle("ok", n === c.count);
      overlay.querySelector("#contract-confirm").disabled = n !== c.count;
    };
    draw();
    overlay.addEventListener("click", async (ev) => {
      if (ev.target === overlay || ev.target.closest("[data-close]")) { close(); return; }
      const card = ev.target.closest("[data-pull]");
      if (card) {
        const id = Number(card.dataset.pull);
        if (picked.includes(id)) picked = picked.filter((x) => x !== id);
        else { picked.push(id); if (picked.length > c.count) picked.shift(); }
        draw();
        return;
      }
      if (ev.target.closest("#contract-confirm")) {
        const btn = ev.target.closest("#contract-confirm");
        btn.disabled = true;
        try {
          const res = await API.contracts(Session.userId, "fulfill", { key, pullIds: picked });
          close();
          Toast.success(`&#128221; Contrat rempli : ${rewardLabel(res.reward)} !`);
          if (typeof confetti === "function") confetti({ particleCount: 90, spread: 80, origin: { y: 0.5 } });
          renderContracts(res);
          window.refreshShopWallet();
          if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
        } catch (err) { btn.disabled = false; Toast.error(ERR[err.code] || "Erreur. (" + err.message + ")"); }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("shop-wallet")) return;
    API.shop(Session.userId).then((s) => { shop = s; renderWallet(); renderItems(); }).catch(() => { $("ressources").hidden = true; $("bonus").hidden = true; });
    API.boosterShop(Session.userId).then((s) => { renderBoosters(s); renderWallet(); }).catch(() => { $("offres").hidden = true; });
    if (API.getEconomyState) API.getEconomyState().then((e) => { eco = e; renderWallet(); }).catch(() => {});
    API.contracts(Session.userId).then(renderContracts).catch(() => { $("contrats").hidden = true; });
    setInterval(renderWallet, 30000);
    $("shop-zone").addEventListener("click", async (e) => {
      const thing = e.target.closest("[data-item]");
      const booster = e.target.closest("#booster-buy");
      const contract = e.target.closest("[data-contract]");
      if (contract) { openContract(contract.dataset.contract); return; }
      if (booster) {
        booster.disabled = true;
        try {
          const res = await API.boosterShop(Session.userId, "buy");
          Toast.success(`&#127183; Booster acheté pour ${fmt(res.paid)} poussières !`);
          renderBoosters(res);
          window.refreshShopWallet();
          if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
        } catch (err) { booster.disabled = false; Toast.error(ERR[err.code] || "Erreur. (" + err.message + ")"); }
        return;
      }
      if (thing) {
        const it = shop.items.find((x) => x.key === thing.dataset.item);
        if (!it) return;
        thing.disabled = true;
        try {
          shop = await API.shop(Session.userId, "buy", it.key);
          renderWallet(); renderItems();
          Toast.success(`${it.icon} ${esc(it.label)} acheté !`);
          if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
        } catch (err) { thing.disabled = false; Toast.error(ERR[err.code] || "Erreur. (" + err.message + ")"); }
      }
    });
  });
})();
