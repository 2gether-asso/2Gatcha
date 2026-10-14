// Mode Cool (2026-10-14) : les decrafts des dernieres 24 h peuvent etre
// annules (la carte revient, les poussieres repartent). Panneau affiche en
// haut du mode Decrafter, seulement en mode Cool. Donnees : modeperks.js.

(function () {
  if (typeof Session === "undefined" || !Session.isLoggedIn()) return;
  const esc = escHtml;
  const FINISH = { holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const QUALITY = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };

  async function load() {
    const box = document.getElementById("undo-panel");
    if (!box || !API.decraftUndo) return;
    let r;
    try { r = await API.decraftUndo(Session.userId); } catch (e) { return; }
    if (!r.active || !r.items.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `
      <div class="undo-head"><strong>&#8617;&#65039; Décrafts annulables</strong><small>Mode Cool : tu as 24 h pour changer d'avis.</small></div>
      <ul class="undo-list">${r.items.map((x) => {
        const h = Math.max(1, Math.round((x.until - Date.now() / 1000) / 3600));
        return `<li><span class="undo-name">${esc(x.card ? x.card.name : "?")}<small>${x.finish !== "normal" ? (FINISH[x.finish] || x.finish) + " · " : ""}${QUALITY[x.quality] || x.quality} · encore ${h} h</small></span>
          <button type="button" class="btn-ghost" data-undo="${x.id}">Annuler (−${x.dust} &#10024;)</button></li>`;
      }).join("")}</ul>`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const box = document.getElementById("undo-panel");
    if (!box) return;
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-undo]");
      if (!b) return;
      b.disabled = true;
      try {
        await API.decraftUndo(Session.userId, "undo", Number(b.dataset.undo));
        Toast.success("&#8617;&#65039; Décraft annulé : la carte est de retour.");
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
        await Coll.refresh();
        load();
      } catch (err) {
        b.disabled = false;
        Toast.error({ not_enough_dust: "Pas assez de poussières pour annuler.", not_undoable: "Ce décraft ne peut plus être annulé." }[err.code] || "Erreur. (" + err.message + ")");
      }
    });
    load();
    // Nouveau decraft : la liste se met a jour.
    setInterval(() => { if (!document.hidden && Coll.mode === "disenchant") load(); }, 8000);
  });
})();
