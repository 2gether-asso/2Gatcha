// Coffre de guilde v2 (onglet Communaute, 2026-10-18) : bourse d'echange avec
// des credits de guilde (api/src/native/guildchest.js). Deposer des doublons
// rapporte des credits ; prendre la carte de son choix coute des credits ou
// une cle ; une pioche gratuite au hasard par jour.

(function () {
  const esc = escHtml;
  const fmt = fmtNum; // core.js
  const FIN = { normal: "", holo: "Holo", gold: "Dorée", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const QUA = { damaged: "Usé", worn: "Abîmé", good: "Bon état", mint: "Parfait état" };
  let st = null;
  let tab = "take";
  let filter = "all";
  const picked = new Set();
  let busy = false;

  const serial = fmtSerial; // core.js
  const tags = (c) => [FIN[c.finish], QUA[c.quality]].filter(Boolean).map((t) => `<span class="gc-tag">${esc(t)}</span>`).join("");
  const img = (c) => `<img src="${API.imageUrl(c.imageId) || PLACEHOLDER_IMG}" alt="" loading="lazy" />`;

  function render() {
    const box = document.getElementById("guildchest");
    if (!box || !st) return;
    const rarities = [...new Map(st.pool.filter((p) => p.rarity).map((p) => [p.rarity.key, p.rarity])).values()].sort((a, b) => a.sortOrder - b.sortOrder);
    const pool = st.pool.filter((p) => filter === "all" || (filter === "missing" ? p.owned === 0 && !p.mine : p.rarity?.key === filter));
    const selValue = st.donatable.flatMap((g) => g.pullIds.filter((id) => picked.has(id)).map(() => g.value)).reduce((s, v) => s + v, 0);
    box.innerHTML = `
      <div class="gc-head">
        <div class="gc-wallet">
          <span class="gc-chip gc-credits" title="Crédits de guilde">&#129689; <strong>${fmt(st.credits)}</strong> crédits</span>
          <span class="gc-chip"><img class="ico-token" src="assets/cl%C3%A9s.PNG" alt="" /> ${fmt(st.keys)} clé${st.keys > 1 ? "s" : ""}</span>
          <span class="gc-chip">Dépôts : ${st.depositsLeft} / ${st.depositsPerDay}</span>
          <span class="gc-chip">Prises : ${st.takesLeft} / ${st.takesPerDay}</span>
        </div>
        <button type="button" class="btn" data-gc-free ${st.freeAvailable ? "" : "disabled"}>&#127873; ${st.freeAvailable ? "Pioche gratuite du jour" : "Pioche du jour faite"}</button>
      </div>
      <p class="lead" style="font-size:0.85rem;">Dépose tes doublons pour gagner des crédits de guilde (selon la rareté, la finition et l'état), puis prends les cartes de ton choix dans le coffre commun. Tu gardes toujours au moins un exemplaire de chaque carte.</p>
      <nav class="tabs gc-tabs" role="tablist">
        <button type="button" class="tab ${tab === "take" ? "active" : ""}" data-gc-tab="take" role="tab">Prendre <span class="tab-count">${st.pool.filter((p) => !p.mine).length}</span></button>
        <button type="button" class="tab ${tab === "give" ? "active" : ""}" data-gc-tab="give" role="tab">Déposer <span class="tab-count">${st.donatable.reduce((s, g) => s + g.count, 0)}</span></button>
      </nav>
      ${tab === "take" ? `
        <div class="gc-filters">
          <button type="button" class="fusion-chip ${filter === "all" ? "active" : ""}" data-gc-filter="all">Tout</button>
          <button type="button" class="fusion-chip ${filter === "missing" ? "active" : ""}" data-gc-filter="missing">&#10024; Il me manque <small>${st.pool.filter((p) => p.owned === 0 && !p.mine).length}</small></button>
          ${rarities.map((r) => `<button type="button" class="fusion-chip ${filter === r.key ? "active" : ""}" data-gc-filter="${r.key}" style="--r:${r.colorHex || "#888"}">${esc(r.name)}</button>`).join("")}
        </div>
        ${pool.length ? `<div class="gc-grid">${pool.map((p) => `
          <article class="gc-card ${p.mine ? "mine" : ""} ${p.owned === 0 && !p.mine ? "missing" : ""}" style="--r:${p.rarity?.colorHex || "#888"}">
            ${img(p)}
            <div class="gc-card-body">
              <strong>${esc(p.name)}</strong>
              <small>${esc(p.rarity?.name || "")} · ${serial(p.serialNumber)}</small>
              <div class="gc-tags">${tags(p)}${p.owned === 0 && !p.mine ? '<span class="gc-tag gc-new">Tu ne l\'as pas</span>' : p.owned ? `<span class="gc-tag">×${p.owned} chez toi</span>` : ""}</div>
              ${p.mine ? '<small class="muted">Ton dépôt</small>' : `<div class="gc-actions">
                <button type="button" class="btn-secondary" data-gc-take="${p.depositId}" ${st.takesLeft && st.credits >= p.cost ? "" : "disabled"}>${fmt(p.cost)} crédits</button>
                ${st.keys ? `<button type="button" class="btn-ghost" data-gc-take="${p.depositId}" data-pay="key" ${st.takesLeft ? "" : "disabled"} title="Prendre avec une clé">${resIcon("key")}</button>` : ""}
              </div>`}
            </div>
          </article>`).join("")}</div>` : `<p class="empty-state">${st.pool.length ? "Rien ne correspond à ce filtre." : "Le coffre est vide : dépose des doublons pour le remplir !"}</p>`}` : `
        <div class="gc-give-bar"><span>Sélection : <strong>${picked.size}</strong> / ${st.depositsLeft} · +${fmt(selValue)} crédits</span><button type="button" class="btn" data-gc-deposit ${picked.size ? "" : "disabled"}>Déposer la sélection</button></div>
        ${st.donatable.length ? `<div class="gc-grid">${st.donatable.map((g) => {
          const n = g.pullIds.filter((id) => picked.has(id)).length;
          return `<article class="gc-card" style="--r:${g.rarity?.colorHex || "#888"}">
            ${img(g)}
            <div class="gc-card-body">
              <strong>${esc(g.name)}</strong>
              <small>${esc(g.rarity?.name || "")} · ${fmt(g.value)} crédit${g.value > 1 ? "s" : ""} pièce</small>
              <div class="gc-tags">${tags(g)}<span class="gc-tag">${g.count} déposable${g.count > 1 ? "s" : ""}</span></div>
              <div class="gc-stepper"><button type="button" data-gc-step="${g.pullIds.join(",")}" data-d="-1" ${n ? "" : "disabled"}>−</button><b>${n}</b><button type="button" data-gc-step="${g.pullIds.join(",")}" data-d="1" ${n < g.count && picked.size < st.depositsLeft ? "" : "disabled"}>+</button></div>
            </div>
          </article>`;
        }).join("")}</div>` : '<p class="empty-state">Aucun doublon déposable pour l\'instant.</p>'}`}
      <div class="gc-donors"><h3>Donateurs de la semaine</h3><ol class="cdig-top">${st.donors.map((d) => `<li>${esc(d.pseudo)} <strong>${fmt(d.n)}</strong></li>`).join("") || "<li>Personne pour l'instant.</li>"}</ol></div>`;
  }

  async function load() {
    if (!Session.isLoggedIn()) {
      const w = document.getElementById("chest-guest-warning"); if (w) w.style.display = "block";
      const box = document.getElementById("guildchest"); if (box) box.innerHTML = "";
      return;
    }
    const old = document.getElementById("chest-zone");
    if (old) old.style.display = "none";
    try { st = await API.guildChestV2(Session.userId); picked.clear(); render(); }
    catch (e) { const box = document.getElementById("guildchest"); if (box) box.innerHTML = '<p class="empty-state">Impossible de charger le coffre de guilde.</p>'; }
  }

  const ERR = { deposit_limit: "Limite de dépôts du jour atteinte.", take_limit: "Limite de prises du jour atteinte.", not_enough_credits: "Pas assez de crédits.", no_key: "Il te faut une clé.", own_deposit: "C'est ton propre dépôt.", deposit_unavailable: "Quelqu'un vient de prendre cette carte.", last_copy: "Tu dois garder au moins un exemplaire.", protected_copy: "Exemplaire protégé (★, assuré, édition ou coffre).", already_drawn_today: "Pioche du jour déjà faite.", chest_empty: "Le coffre est vide." };

  document.addEventListener("click", async (e) => {
    const box = document.getElementById("guildchest");
    if (!box || !box.contains(e.target) || !st) return;
    const t = e.target;
    const tb = t.closest("[data-gc-tab]"); if (tb) { tab = tb.dataset.gcTab; render(); return; }
    const fl = t.closest("[data-gc-filter]"); if (fl) { filter = fl.dataset.gcFilter; render(); return; }
    const step = t.closest("[data-gc-step]");
    if (step) {
      const ids = step.dataset.gcStep.split(",").map(Number);
      if (Number(step.dataset.d) > 0) { const next = ids.find((id) => !picked.has(id)); if (next && picked.size < st.depositsLeft) picked.add(next); }
      else { const last = [...ids].reverse().find((id) => picked.has(id)); if (last) picked.delete(last); }
      render(); return;
    }
    const act = t.closest("[data-gc-free], [data-gc-take], [data-gc-deposit]");
    if (!act || busy) return;
    busy = true; act.disabled = true;
    try {
      let res;
      if (act.dataset.gcFree !== undefined) res = await API.guildChestV2(Session.userId, "free");
      else if (act.dataset.gcTake) res = await API.guildChestV2(Session.userId, "take", { depositId: Number(act.dataset.gcTake), pay: act.dataset.pay || "credits" });
      else res = await API.guildChestV2(Session.userId, "deposit", { pullIds: [...picked] });
      st = res; picked.clear();
      if (res.taken) {
        Toast.success(`&#127873; ${esc(res.taken.name)} ${serial(res.taken.serialNumber)} rejoint ta collection${res.taken.paid === "free" ? " (pioche gratuite)" : res.taken.paid === "key" ? " (une clé)" : ` (${fmt(res.taken.paid)} crédits)`} !`);
        if (typeof confetti === "function") confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 } });
      } else if (res.deposited) Toast.success(`&#129689; ${res.deposited} carte${res.deposited > 1 ? "s" : ""} déposée${res.deposited > 1 ? "s" : ""} : +${fmt(res.creditsGained)} crédits de guilde`);
      render();
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (err) {
      Toast.error(ERR[err.code] || friendlyError(err));
      load();
    } finally { busy = false; }
  });

  window.GuildChest = { load };
})();
