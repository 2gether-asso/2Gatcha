// Simulateur d'ouverture (admins, 2026-10-05) : statistiques sur N boosters
// et ouverture "pour de faux" avec des modificateurs (rarete, finition,
// shiny, carte bonus, pity). Tout est calcule par /admin-simulate
// (api/src/native/simulator.js) sans aucune ecriture : pas de booster
// consomme, pas de carte, pas d'XP, pas d'annonce Discord.
// L'ouverture visuelle reutilise la scene d'opening.js via setSimMode().

(function () {
  if (!Session.isLoggedIn() || !Session.isAdmin()) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pctIn = (id) => { const v = $(id).value.trim(); return v === "" ? undefined : Number(v) / 100; };
  let conf = null;

  function modifiers() {
    const rarityMultipliers = {};
    document.querySelectorAll("#sim-mults input").forEach((i) => {
      if (i.value.trim() !== "") rarityMultipliers[i.dataset.key] = Number(i.value);
    });
    return {
      rarityMultipliers,
      specialFinishChance: pctIn("sim-finish"),
      shinyChance: pctIn("sim-shiny"),
      bonusCardChance: pctIn("sim-bonus"),
      pity: $("sim-pity").checked,
      startPity: Number($("sim-startpity").value) || 0,
      applyEvent: $("sim-event").checked
    };
  }

  function renderForm() {
    const d = conf.defaults;
    $("sim-ext").innerHTML = conf.extensions.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");
    $("sim-finish").placeholder = `${+(d.specialFinishChance * 100).toFixed(2)} (actuel)`;
    $("sim-shiny").placeholder = `${+(d.shinyChance * 100).toFixed(3)} (actuel)`;
    $("sim-bonus").placeholder = `${+(d.bonusCardChance * 100).toFixed(2)} (actuel)`;
    $("sim-boosters").max = conf.maxBoosters;
    $("sim-mults").innerHTML = conf.rarities.map((r) => `
      <label class="sim-mult" style="--r:${esc(r.colorHex || "#888")}">
        <span class="sim-mult-name">${esc(r.name)} <small>${r.pct} %</small></span>
        <input type="number" min="0" max="100" step="0.1" placeholder="1" data-key="${esc(r.key)}" />
      </label>`).join("");
    $("sim-pity").parentElement.title = d.pityThreshold ? `${d.topRarity || "Meilleure rareté"} garantie tous les ${d.pityThreshold} tirages` : "Aucune pity configurée";
  }

  const bar = (pct, color) => `<span class="sim-bar"><span style="width:${Math.min(100, pct)}%;background:${color}"></span></span>`;

  // Bilan economique : ce que rapportent les doublons d'un booster face a son prix.
  function ecoBlock(e) {
    if (!e) return "";
    const fr = (n) => Number(n).toLocaleString("fr-FR");
    const verdict = { generous: ["sim-eco-bad", "Trop généreux : les doublons remboursent un booster trop vite."], watch: ["sim-eco-warn", "À surveiller : un booster se rembourse assez vite."], ok: ["sim-eco-ok", "Équilibré : racheter un booster demande un vrai effort."] }[e.verdict] || ["", ""];
    return `<div class="sim-eco ${verdict[0]}">
      <strong>Bilan économique ${e.tight ? "(mode anti-inflation actif)" : ""}</strong>
      <p>Un joueur qui part de zéro gagne en moyenne <b>${fr(e.dustPerBooster)} poussières par booster</b> (${fr(e.duplicateDust)} en doublons + ${fr(e.decraftDuplicates)} s'il décrafte ses ${fr(e.duplicates)} doublons). Un booster coûte <b>${fr(e.shopPrice)}</b> en boutique : il faut <b>${e.boostersToBuyOne != null ? fr(e.boostersToBuyOne) : "—"} boosters</b> pour en racheter un.</p>
      <p class="sim-eco-verdict">${verdict[1]}</p></div>`;
  }

  function renderResults(r) {
    const tiles = [
      ["Boosters", r.boosters], ["Cartes", r.cards], ["Cartes distinctes", `${r.distinctCards} / ${r.poolSize}`],
      ["Nouvelles pour toi", r.newForMe], ["Boosters shiny", r.shinyPacks], ["Cartes bonus", r.bonusCards],
      ["Pity déclenchée", r.pityHits], ["Boosters par top rareté", r.boostersPerTopRarity ?? "—"],
      ["Poussières si tout décrafté", r.estimatedDust.toLocaleString("fr-FR")]
    ];
    const rows = (list, label) => list.filter((x) => x.count || x.expected).map((x) => `
      <tr><th scope="row">${esc(label(x))}</th><td class="num">${x.count.toLocaleString("fr-FR")}</td><td class="num">${x.pct} %</td>
      ${x.expected != null ? `<td class="num">${x.expected} %</td>` : ""}<td class="sim-bar-cell">${bar(x.pct, x.colorHex || "var(--accent)")}</td></tr>`).join("");
    const color = (c) => esc(c.rarity?.colorHex || "#888");
    $("sim-results").innerHTML = `
      <p class="sim-applied">Appliqué : finition spéciale ${+(r.applied.specialFinishChance * 100).toFixed(2)} % · shiny ${+(r.applied.shinyChance * 100).toFixed(3)} % · carte bonus ${+(r.applied.bonusCardChance * 100).toFixed(2)} % · pity ${r.applied.pity ? "active" : "désactivée"}</p>
      ${ecoBlock(r.economy)}
      <div class="sim-tiles">${tiles.map(([k, v]) => `<div class="sim-tile"><span>${k}</span><strong>${v}</strong></div>`).join("")}</div>
      <div class="sim-tables">
        <div class="sim-table-wrap"><table class="admin-table sim-table"><caption>Raretés</caption>
          <thead><tr><th scope="col">Rareté</th><th scope="col" class="num">Cartes</th><th scope="col" class="num">Obtenu</th><th scope="col" class="num">Attendu</th><th scope="col"><span class="sr-only">Barre</span></th></tr></thead>
          <tbody>${rows(r.rarities, (x) => x.name)}</tbody></table></div>
        <div class="sim-table-wrap"><table class="admin-table sim-table"><caption>Finitions</caption>
          <thead><tr><th scope="col">Finition</th><th scope="col" class="num">Cartes</th><th scope="col" class="num">%</th><th scope="col"><span class="sr-only">Barre</span></th></tr></thead>
          <tbody>${rows(r.finishes, (x) => FINISH_LABELS[x.key] || "Normale")}</tbody></table></div>
        <div class="sim-table-wrap"><table class="admin-table sim-table"><caption>États</caption>
          <thead><tr><th scope="col">État</th><th scope="col" class="num">Cartes</th><th scope="col" class="num">%</th><th scope="col"><span class="sr-only">Barre</span></th></tr></thead>
          <tbody>${rows(r.qualities, (x) => QUALITY_LABELS[x.key] || x.key)}</tbody></table></div>
      </div>
      ${r.best.length ? `<h3 class="sim-best-title">Meilleurs tirages</h3><ul class="sim-best">${r.best.map((c) => `
        <li style="--r:${color(c)}">${c.imageId ? `<img src="${API.imageUrl(c.imageId)}" alt="" loading="lazy" />` : ""}
          <span class="sim-best-name">${esc(c.name)}</span>
          <span class="sim-best-meta">${esc(c.rarity?.name || "")}${c.finish !== "normal" ? " · " + esc(FINISH_LABELS[c.finish] || c.finish) : ""} · ${esc(QUALITY_LABELS[c.quality] || c.quality)}${c.isShinyPack ? " · shiny" : ""}</span></li>`).join("")}</ul>` : ""}`;
  }

  async function run(e) {
    e.preventDefault();
    const btn = $("sim-run");
    btn.disabled = true;
    btn.textContent = "Simulation…";
    try {
      renderResults(await API.adminSimulate(Session.discordId, "run", { extensionId: Number($("sim-ext").value), boosters: Number($("sim-boosters").value) || 100, modifiers: modifiers() }));
    } catch (err) {
      Toast.error(err.code === "no_cards" ? "Aucune carte active dans cette extension." : "Simulation impossible. (" + err.message + ")");
    }
    btn.disabled = false;
    btn.textContent = "Lancer les statistiques";
  }

  function toggleVisual(on) {
    setSimMode(on ? modifiers() : null);
    $("sim-mode-banner").hidden = !on;
    if (on) $("extension-picker").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const panel = $("sim-panel");
    if (!panel) return;
    try { conf = await API.adminSimulate(Session.discordId, "config"); } catch (e) { return; }
    panel.hidden = false;
    renderForm();
    $("sim-form").addEventListener("submit", run);
    $("sim-visual").addEventListener("click", () => toggleVisual(true));
    $("sim-mode-off").addEventListener("click", () => toggleVisual(false));
    // Modificateurs changes pendant le mode visuel : pris en compte au prochain booster.
    $("sim-form").addEventListener("input", () => { if (simMode) setSimMode(modifiers()); });
    $("sim-reset").addEventListener("click", () => {
      $("sim-form").reset();
      if (simMode) setSimMode(modifiers());
      $("sim-results").innerHTML = "";
    });
  });
})();
