// Boutique (2026-10-07) : boosters de la semaine (prix croissant, plafond) et
// contrats de collection (doublons contre recompenses).
// Voir api/src/native/market.js.

(function () {
  if (!Session.isLoggedIn()) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const FINISH = { normal: "Normale", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const QUALITY = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };
  const rewardLabel = (r) => [r.boosters ? `${r.boosters} &#127183;` : "", r.chests ? `${r.chests} coffre${r.chests > 1 ? "s" : ""}` : "", r.keys ? `${r.keys} clé${r.keys > 1 ? "s" : ""}` : "", r.dust ? `${r.dust} &#10024;` : "", r.worms ? `${r.worms} vers` : ""].filter(Boolean).join(" + ");
  let contracts = null;

  function renderShop(st) {
    $("booster-shop-body").innerHTML = st.cap
      ? `<div class="booster-shop-row">
          <span class="booster-shop-pack" aria-hidden="true">&#127183;</span>
          <div><strong>${st.price.toLocaleString("fr-FR")} &#10024;</strong><small>${st.left}/${st.cap} restant${st.left > 1 ? "s" : ""} cette semaine · le prix monte à chaque achat</small></div>
          <button type="button" class="btn" id="booster-buy" ${st.left && st.stardust >= st.price ? "" : "disabled"}>Acheter</button>
        </div>`
      : `<p class="muted">La boutique de boosters est fermée pour l’instant.</p>`;
  }

  function renderContracts(st) {
    contracts = st;
    const days = Math.max(0, Math.ceil((st.endsAt - Date.now() / 1000) / 86400));
    $("contracts-grid").innerHTML = st.contracts.map((c) => `
      <article class="contract ${c.done ? "done" : ""} ${c.ready ? "ready" : ""}">
        <header><span aria-hidden="true">${c.icon}</span><strong>${esc(c.label)}</strong></header>
        <div class="contract-reward">&#127873; ${rewardLabel(c.reward)}</div>
        <small>${c.done ? "&#10004; Rempli cette semaine" : `${c.available} exemplaire${c.available > 1 ? "s" : ""} possible${c.available > 1 ? "s" : ""} · fin dans ${days} j`}</small>
        ${c.done ? "" : `<button type="button" class="btn-secondary" data-contract="${c.key}" ${c.ready ? "" : "disabled"}>${c.ready ? "Remplir" : "Pas assez de cartes"}</button>`}
      </article>`).join("");
  }

  // Choix des exemplaires : la suggestion (doublons) cochee par defaut.
  async function fulfill(key) {
    const c = contracts.contracts.find((x) => x.key === key);
    if (!c) return;
    const pre = new Set(c.suggested || c.eligible.slice(0, c.count).map((e) => e.pullId));
    const list = c.eligible.map((e) => `<label class="contract-copy"><input type="checkbox" value="${e.pullId}" ${pre.has(e.pullId) ? "checked" : ""} /> ${esc(e.card.name || "?")} · ${FINISH[e.finish]} · ${QUALITY[e.quality]} ${e.serialNumber != null ? "#" + String(e.serialNumber).padStart(3, "0") : ""} <small>(${e.copies} exemplaire${e.copies > 1 ? "s" : ""})</small></label>`).join("");
    const asked = Confirm.show(`<p>Choisis <strong>${c.count}</strong> exemplaire${c.count > 1 ? "s" : ""} à donner pour <strong>${rewardLabel(c.reward)}</strong>. Tes doublons sont cochés en premier.</p><div class="contract-picker" id="contract-picker">${list}</div>`, { title: esc(c.label), confirmText: "Donner ces cartes" });
    // La boite est retiree avant la reponse : on suit les cases pendant qu'elle est ouverte.
    const chosen = new Set(pre);
    document.getElementById("contract-picker")?.addEventListener("change", (ev) => {
      const v = Number(ev.target.value);
      if (ev.target.checked) chosen.add(v); else chosen.delete(v);
    });
    if (!(await asked)) return;
    const picked = [...chosen];
    if (picked.length !== c.count) { Toast.error(`Il faut exactement ${c.count} exemplaire${c.count > 1 ? "s" : ""}.`); return; }
    try {
      const res = await API.contracts(Session.userId, "fulfill", { key, pullIds: picked });
      Toast.success(`&#128221; Contrat rempli : ${rewardLabel(res.reward)} !`);
      if (typeof confetti === "function") confetti({ particleCount: 90, spread: 80, origin: { y: 0.5 } });
      renderContracts(res);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (err) { Toast.error({ copy_not_matching: "Un des exemplaires ne correspond pas au contrat.", wrong_count: "Mauvais nombre d'exemplaires.", already_claimed: "Contrat déjà rempli cette semaine." }[err.code] || "Erreur. (" + err.message + ")"); }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("booster-shop")) return;
    API.boosterShop(Session.userId).then(renderShop).catch(() => { $("booster-shop").hidden = true; });
    API.contracts(Session.userId).then(renderContracts).catch(() => { $("contracts").hidden = true; });
    $("booster-shop").addEventListener("click", async (e) => {
      if (!e.target.closest("#booster-buy")) return;
      e.target.disabled = true;
      try {
        const res = await API.boosterShop(Session.userId, "buy");
        Toast.success(`&#127183; Booster acheté pour ${res.paid} poussières !`);
        renderShop(res);
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) { e.target.disabled = false; Toast.error({ weekly_cap: "Plus de booster en vente cette semaine.", not_enough_dust: "Pas assez de poussières." }[err.code] || "Erreur. (" + err.message + ")"); }
    });
    $("contracts-grid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-contract]");
      if (btn) fulfill(btn.dataset.contract);
    });
  });
})();
