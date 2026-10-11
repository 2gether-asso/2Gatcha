// Accueil (2026-10-11) : recapitulatif de la semaine passee (nouvelles
// cartes, meilleurs tirages, boosters ouverts, progression de la collection,
// place sur le serveur). Affiche jusqu'a ce que le joueur le ferme, puis
// revient le lundi suivant. Donnees : api/src/native/rendezvous.js.

(function () {
  if (typeof Session === "undefined" || !Session.isLoggedIn()) return;
  const esc = escHtml;
  const KEY = "2gatcha_recap_seen";
  const FINISH = { holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };

  function render(r) {
    const box = document.getElementById("weekly-recap");
    if (!box) return;
    let seen = null;
    try { seen = localStorage.getItem(KEY); } catch (e) { /* stockage indisponible */ }
    if (seen === r.week || (!r.copies && !r.newCards)) { box.hidden = true; return; }
    const pct = (n) => (r.collection.total ? Math.round((n / r.collection.total) * 100) : 0);
    const gain = pct(r.collection.after) - pct(r.collection.before);
    const from = new Date(r.start * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
    box.hidden = false;
    box.innerHTML = `
      <div class="recap-head">
        <h2>&#128197; Ta semaine du ${from}</h2>
        <button type="button" class="card-modal-close" id="recap-close" aria-label="Fermer le récapitulatif">&times;</button>
      </div>
      <div class="recap-tiles">
        <div class="recap-tile"><strong>${r.newCards}</strong><span>nouvelle${r.newCards > 1 ? "s" : ""} carte${r.newCards > 1 ? "s" : ""}</span></div>
        <div class="recap-tile"><strong>${r.boosters}</strong><span>booster${r.boosters > 1 ? "s" : ""} ouvert${r.boosters > 1 ? "s" : ""}</span></div>
        <div class="recap-tile"><strong>${pct(r.collection.after)} %</strong><span>de la collection${gain > 0 ? ` <b>(+${gain} %)</b>` : ""}</span></div>
        ${r.place ? `<div class="recap-tile"><strong>${r.place}<sup>${r.place === 1 ? "er" : "e"}</sup></strong><span>sur ${r.players} pour les nouvelles cartes</span></div>` : ""}
      </div>
      ${r.rarities.length ? `<p class="recap-rarities">${r.rarities.map((x) => `<span style="--r:${esc(x.colorHex || "#888")}">${x.count} ${esc(x.name)}</span>`).join("")}</p>` : ""}
      ${r.best.length ? `<div class="recap-best"><span class="recap-best-k">Tes plus belles prises</span>${r.best.map((c) => `
        <span class="recap-card" style="--r:${esc(c.rarity?.colorHex || "#888")}">${c.imageId ? `<img src="${API.imageUrl(c.imageId)}" alt="" loading="lazy" />` : ""}<span><strong>${esc(c.name)}</strong><small>${esc(c.rarity?.name || "")}${c.finish !== "normal" ? " · " + (FINISH[c.finish] || c.finish) : ""}</small></span></span>`).join("")}</div>` : ""}`;
    document.getElementById("recap-close").addEventListener("click", () => {
      try { localStorage.setItem(KEY, r.week); } catch (e) { /* stockage indisponible */ }
      box.hidden = true;
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("weekly-recap") || !API.getWeeklyRecap) return;
    API.getWeeklyRecap(Session.userId).then(render).catch(() => {});
  });
})();
