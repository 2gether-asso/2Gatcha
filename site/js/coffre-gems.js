// Ecrin du coffre-fort (2026-11-16, api/src/native/personal-vault.js gemCase) :
// une place par mineral pour une carte sertie de cette pierre. N'apparait
// que si le serveur l'envoie (porte de la salle ouverte ou carte sertie :
// secret des joueurs). Rendu appele par pvRender (coffre.js).
const CoffreGems = (() => {
  const esc = (s) => escHtml(s);
  const FIN = { normal: "Normale", holo: "Holo", gold: "Dorée", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const OPEN_KEY = "2gatcha_pv_gems_open";
  let busy = false;

  function host() {
    let box = document.getElementById("pv-gems");
    if (!box) {
      box = document.createElement("details");
      box.id = "pv-gems";
      box.className = "pv-gems";
      const anchor = document.getElementById("pv-tabs");
      anchor.parentNode.insertBefore(box, anchor);
      let open = false;
      try { open = localStorage.getItem(OPEN_KEY) === "1"; } catch (e) { /* stockage indisponible */ }
      box.open = open;
      box.addEventListener("toggle", () => { try { localStorage.setItem(OPEN_KEY, box.open ? "1" : "0"); } catch (e) { /* idem */ } });
      box.addEventListener("click", onClick);
    }
    return box;
  }

  function slotHtml(s) {
    const art = `<img class="pv-gem-stone" src="assets/${encodeURI(s.img)}" alt="" loading="lazy" />`;
    if (s.stored) {
      const c = s.stored;
      return `<div class="pv-gem-slot filled tier-${s.tier}" title="${esc(s.name)} : ${esc(c.name)}">
        <div class="pv-gem-card">${c.imageId ? `<img src="${API.imageUrl(c.imageId)}" alt="" loading="lazy" />` : ""}${art}</div>
        <strong>${esc(s.name)}</strong><small>${esc(c.name)} · ${FIN[c.finish] || c.finish}</small>
        <button type="button" class="btn-ghost pv-gem-btn" data-gem-withdraw="${c.pullId}">Retirer</button>
      </div>`;
    }
    const best = s.candidates[0];
    return `<div class="pv-gem-slot ${best ? "ready" : "empty"} tier-${s.tier}">
      <div class="pv-gem-card empty">${art}</div>
      <strong>${esc(s.name)}</strong>
      ${best
        ? `<small>${s.candidates.length} carte${s.candidates.length > 1 ? "s" : ""} sertie${s.candidates.length > 1 ? "s" : ""} prête${s.candidates.length > 1 ? "s" : ""}</small>
           ${s.candidates.length > 1
             ? `<select class="pv-gem-pick" data-gem-pick="${s.key}" aria-label="Carte à ranger">${s.candidates.map((c) => `<option value="${c.pullId}">${esc(c.name)} · ${FIN[c.finish] || c.finish}</option>`).join("")}</select>`
             : `<small class="muted">${esc(best.name)} · ${FIN[best.finish] || best.finish}</small>`}
           <button type="button" class="btn pv-gem-btn" data-gem-store="${s.key}" data-pull="${best.pullId}">Ranger (+${s.xp} prestige)</button>`
        : `<small class="muted">Sertis cette pierre sur une carte Interdite <a href="salamandre.html#sertissage">dans la salle</a></small>`}
    </div>`;
  }

  function render(data) {
    const g = data && data.gemCase;
    const old = document.getElementById("pv-gems");
    if (!g) { if (old) old.remove(); return; }
    const box = host();
    // Ouvert d'office quand une carte sertie attend sa place (tant que le joueur n'a rien choisi).
    try { if (g.ready && localStorage.getItem(OPEN_KEY) == null) box.open = true; } catch (e) { /* stockage indisponible */ }
    const tiers = g.tiers.map((t) => `<li class="${t.filled === t.total ? "done" : ""}"><span>${esc(t.name)}</span><b>${t.filled}/${t.total}</b><small>${t.claimed ? "✓ récompense reçue" : `${t.reward.boosters ? `+${t.reward.boosters} booster${t.reward.boosters > 1 ? "s" : ""} · ` : ""}+${fmtNum(t.reward.dust)} ✨`}</small></li>`).join("");
    box.innerHTML = `
      <summary><span>💎 Écrin des pierres</span><small>${g.filled}/${g.total} pierres · +${fmtNum(g.xp)} prestige${g.ready ? ` · <b class="pv-gems-ready">${g.ready} à ranger</b>` : ""}</small></summary>
      <div class="pv-gems-body">
        <p class="pv-gems-help">Chaque <strong>minéral</strong> de la fouille a sa place dans l'écrin. Une carte de l'édition <strong>Interdite</strong> sertie d'une pierre (<a href="salamandre.html#sertissage">sertissage, dans la salle</a>) (${g.gemCost} minéraux de ce type) peut y être rangée : elle garde sa pierre, rapporte <strong>${g.perTier} points de prestige × le palier du minéral</strong> (1 pour un Commun, 5 pour un Légendaire) et quitte ta collection active tant qu'elle y est. Toutes les pierres d'un palier réunies : une récompense, une seule fois. L'écrin complet donne le titre « Joaillier ».</p>
        <ul class="pv-gems-tiers">${tiers}</ul>
        ${g.tiers.map((t) => `<h3 class="pv-gems-tier-title">${esc(t.name)} <small>${t.filled}/${t.total}</small></h3>
          <div class="pv-gems-grid">${g.slots.filter((s) => s.tier === t.tier).map(slotHtml).join("")}</div>`).join("")}
      </div>`;
  }

  async function act(action, pullId, btn) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try {
      const res = await API.post("personalVault", { userId: Session.userId, action, pullId });
      if (typeof pvRender === "function") pvRender(res);
      if (res.gemStored) Toast.success(`💎 ${esc(res.gemStored.name)} rejoint l'écrin : +${res.gemStored.xp} points de prestige.`);
      if (action === "withdrawGem") Toast.info("Carte retirée de l'écrin : elle revient dans ta collection, avec sa pierre.");
      if (res.gemReward) {
        const r = res.gemReward;
        Toast.success(`💎 Palier${r.tiers.length > 1 ? "s" : ""} ${r.tiers.map((t) => esc(t.name)).join(", ")} de l'écrin complet${r.tiers.length > 1 ? "s" : ""} ! +${r.boosters} booster${r.boosters > 1 ? "s" : ""}, +${fmtNum(r.dust)} ✨${r.title ? ` et le titre « ${esc(r.title)} »` : ""}`);
        if (typeof confetti === "function") confetti({ particleCount: 160, spread: 110, origin: { y: 0.5 }, colors: ["#a78bfa", "#f0abfc", "#67e8f9", "#ffffff"] });
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      }
    } catch (e) {
      if (btn) btn.disabled = false;
      Toast.error({ slot_filled: "Cette pierre a déjà sa carte dans l'écrin.", not_gem_set: "Seule une carte Interdite sertie va dans l'écrin.", already_stored: "Cette carte est déjà au coffre.", protected_copy: "Carte assurée : retire l'assurance d'abord." }[e.code] || friendlyError(e));
    } finally { busy = false; }
  }

  function onClick(e) {
    const s = e.target.closest("[data-gem-store]");
    if (s) {
      const pick = document.querySelector(`[data-gem-pick="${s.dataset.gemStore}"]`);
      return act("storeGem", Number(pick ? pick.value : s.dataset.pull), s);
    }
    const w = e.target.closest("[data-gem-withdraw]");
    if (w) return act("withdrawGem", Number(w.dataset.gemWithdraw), w);
  }

  return { render };
})();
window.CoffreGems = CoffreGems;
