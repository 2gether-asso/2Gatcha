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
        <button type="button" class="btn-secondary recap-share" id="recap-share">&#128228; Partager</button>
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
        <span class="recap-card" style="--r:${esc(c.rarity?.colorHex || "#888")}">${c.imageId ? `<img src="${API.imageUrl(c.imageId)}" alt="" loading="lazy" decoding="async" />` : ""}<span><strong>${esc(c.name)}</strong><small>${esc(c.rarity?.name || "")}${c.finish !== "normal" ? " · " + (FINISH[c.finish] || c.finish) : ""}</small></span></span>`).join("")}</div>` : ""}`;
    document.getElementById("recap-share").addEventListener("click", () => share(r, from));
    document.getElementById("recap-close").addEventListener("click", () => {
      try { localStorage.setItem(KEY, r.week); } catch (e) { /* stockage indisponible */ }
      box.hidden = true;
    });
  }

  // Carte du recap a partager (2026-10-18) : image 1080 x 1080 dessinee aux
  // couleurs du site, partagee (telephone) ou telechargee.
  async function share(r, from) {
    const c = document.createElement("canvas");
    c.width = 1080; c.height = 1080;
    const g = c.getContext("2d");
    const css = getComputedStyle(document.documentElement);
    const v = (n, d) => css.getPropertyValue(n).trim() || d;
    const bg = v("--bg-void", "#0b0b18"), a1 = v("--accent", "#7c3aed"), a2 = v("--accent-2", "#22d3ee"), text = v("--text", "#ffffff"), dim = v("--text-dim", "#a5a5c0");
    const grad = g.createLinearGradient(0, 0, 1080, 1080);
    grad.addColorStop(0, a1); grad.addColorStop(1, a2);
    g.fillStyle = bg; g.fillRect(0, 0, 1080, 1080);
    g.globalAlpha = 0.35; g.fillStyle = grad; g.fillRect(0, 0, 1080, 1080); g.globalAlpha = 1;
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(60, 60, 960, 960);
    g.fillStyle = text; g.textAlign = "center";
    g.font = "800 64px Inter, system-ui, sans-serif"; g.fillText("2Gatcha", 540, 170);
    g.font = "600 40px Inter, system-ui, sans-serif"; g.fillStyle = dim; g.fillText("Ma semaine du " + from, 540, 235);
    g.fillStyle = text; g.font = "800 54px Inter, system-ui, sans-serif";
    g.fillText((r.pseudo || Session.pseudo || "") + (r.prestigeStars ? "  " + "★".repeat(Math.min(5, r.prestigeStars)) : ""), 540, 320);
    g.font = "500 34px Inter, system-ui, sans-serif"; g.fillStyle = dim; g.fillText("Niveau " + (r.level || 1), 540, 370);
    const pct = r.collection.total ? Math.round((r.collection.after / r.collection.total) * 100) : 0;
    const pl = (n, one, many) => (Number(n) > 1 ? many : one);
    const tiles = [[r.newCards, pl(r.newCards, "nouvelle carte", "nouvelles cartes")], [r.boosters, pl(r.boosters, "booster ouvert", "boosters ouverts")], [pct + " %", "de la collection"], [r.aquarium || 0, pl(r.aquarium, "espèce pêchée", "espèces pêchées")], [(r.museum ? r.museum.pct : 0) + " %", "du musée"], [r.place ? r.place + (r.place === 1 ? "er" : "e") : "–", "sur le serveur"]];
    tiles.forEach(([n, label], i) => {
      const x = 120 + (i % 3) * 300, y = 430 + Math.floor(i / 3) * 210;
      g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(x, y, 260, 180);
      g.fillStyle = text; g.font = "800 64px Inter, system-ui, sans-serif"; g.fillText(String(n), x + 130, y + 92);
      g.fillStyle = dim; g.font = "500 26px Inter, system-ui, sans-serif"; g.fillText(label, x + 130, y + 142);
    });
    if (r.best && r.best.length) {
      g.fillStyle = text; g.font = "700 32px Inter, system-ui, sans-serif"; g.fillText("Plus belles prises", 540, 900);
      g.fillStyle = dim; g.font = "500 28px Inter, system-ui, sans-serif"; g.fillText(r.best.map((b) => b.name).join(" · ").slice(0, 70), 540, 950);
    }
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    if (!blob) { Toast.error("Image impossible à créer."); return; }
    const file = new File([blob], "2gatcha-semaine.png", { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Ma semaine sur 2Gatcha" }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "2gatcha-semaine.png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    Toast.success("&#128228; Image de ta semaine téléchargée : partage-la où tu veux !");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("weekly-recap") || !API.getWeeklyRecap) return;
    API.getWeeklyRecap(Session.userId).then(render).catch(() => {});
  });
})();
