// Admin > Bingo, version 2 (2026-11) : apercu de la grille d'un mois, cartes
// imposees (facultatif, le reste est tire au sort), nouveau tirage.
// Donnees : api/src/native/bingo.js (adminPreview / adminConfig).

(function () {
  const esc = escHtml;
  const nextMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

  function render(r) {
    const box = document.getElementById("bingo2-admin-preview");
    if (!box) return;
    box.innerHTML = `
      <p class="b2a-state">${r.v2 ? "✅ Ce mois utilise la nouvelle version." : "⏳ Ce mois utilise encore l'ancienne version (réglage BingoV2From)."} ${r.config.cardIds && r.config.cardIds.length ? `${r.config.cardIds.length} carte(s) imposée(s).` : "Cartes tirées au sort."}</p>
      <div class="b2a-grid">${r.cells.map((c) => `<div class="b2a-cell type-${c.type}" title="${esc(c.label)}">${c.type === "card" && c.card ? `<img src="${API.imageUrl(c.card.imageId) || ""}" alt="" />` : `<span>${c.icon || "⭐"}</span>`}<small>${esc(c.label)}</small></div>`).join("")}</div>`;
    const sel = document.getElementById("bingo2-cards");
    if (sel && typeof pickableCards === "function") {
      const chosen = new Set((r.config.cardIds || []).map(Number));
      sel.innerHTML = pickableCards().map((c) => `<option value="${c.cardId}" ${chosen.has(c.cardId) ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    }
  }
  async function call(action, extra = {}) {
    const month = document.getElementById("bingo2-month").value.trim() || nextMonth();
    try { render(await API.post("bingo", { discordId: Session.discordId, action, month, ...extra })); if (action === "adminConfig") Toast.success("Grille du bingo enregistrée."); }
    catch (err) { Toast.error("Bingo : " + err.message); }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const month = document.getElementById("bingo2-month");
    if (!month) return;
    month.value = nextMonth();
    document.getElementById("bingo2-preview-btn").addEventListener("click", () => call("adminPreview"));
    document.getElementById("bingo2-reseed-btn").addEventListener("click", () => call("adminConfig", { reseed: true }));
    document.getElementById("bingo2-save-btn").addEventListener("click", () => {
      const ids = [...document.getElementById("bingo2-cards").selectedOptions].map((o) => Number(o.value));
      if (ids.length > 12) { Toast.error("12 cartes au maximum."); return; }
      call("adminConfig", { cardIds: ids });
    });
    document.getElementById("bingo2-clear-btn").addEventListener("click", () => call("adminConfig", { cardIds: [] }));
    // Apercu a l'ouverture du bloc (le catalogue des cartes est charge par admin.js).
    const fold = month.closest("details");
    if (fold) fold.addEventListener("toggle", () => { if (fold.open) call("adminPreview"); });
  });
})();
