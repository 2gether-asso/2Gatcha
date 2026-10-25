// Cartes (2026-10-15) : inclinaison 3D (souris et gyroscope), verso,
// historique de l'exemplaire, cote et partage sur Discord dans la fenetre
// detaillee. Donnees : api/src/native/cards.js.

// ------------------------------------------------------------------ inclinaison 3D
const CardTilt = (function () {
  const MAX = 14;
  let gyroTarget = null, gyroAsked = false;
  function set(el, px, py) {
    el.style.setProperty("--ry", `${(px - 0.5) * MAX * 2}deg`);
    el.style.setProperty("--rx", `${(py - 0.5) * -MAX * 2}deg`);
    el.style.setProperty("--shine-x", `${px * 100}%`);
    el.style.setProperty("--shine-y", `${py * 100}%`);
    el.style.setProperty("--glare-a", "0.28");
    el.classList.add("tilting");
  }
  function reset(el) {
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--shine-x", "50%");
    el.style.setProperty("--shine-y", "50%");
    el.style.setProperty("--glare-a", "0");
    el.classList.remove("tilting");
  }
  // Souris : sur l'element lui-meme. Gyroscope : l'element "au premier plan".
  function attach(el, { gyro = false } = {}) {
    if (!el || el._tilt) return;
    el._tilt = true;
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      // Une mise a jour par image au plus (souris a haute frequence).
      let raf = 0, mx = 0, my = 0;
      el.addEventListener("mousemove", (e) => {
        mx = e.clientX; my = e.clientY;
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; const r = el.getBoundingClientRect(); set(el, (mx - r.left) / r.width, (my - r.top) / r.height); });
      });
      el.addEventListener("mouseleave", () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } reset(el); });
    } else if (gyro) focus(el);
  }
  function focus(el) {
    gyroTarget = el;
    if (gyroAsked) return;
    gyroAsked = true;
    const start = () => window.addEventListener("deviceorientation", (e) => {
      if (!gyroTarget || !document.body.contains(gyroTarget) || e.gamma == null) return;
      const px = Math.max(0, Math.min(1, 0.5 + e.gamma / 50));
      const py = Math.max(0, Math.min(1, 0.5 + (e.beta - 45) / 50));
      set(gyroTarget, px, py);
    });
    // iOS : autorisation demandee au premier geste.
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      document.addEventListener("click", function ask() {
        document.removeEventListener("click", ask);
        DeviceOrientationEvent.requestPermission().then((s) => { if (s === "granted") start(); }).catch(() => {});
      });
    } else start();
  }
  return { attach, focus, reset };
})();

// Cartes revelees a l'ouverture : la carte active s'incline (souris ou gyroscope).
document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("reveal-grid");
  if (grid) {
    new MutationObserver(() => {
      grid.querySelectorAll(".card").forEach((c) => CardTilt.attach(c, { gyro: true }));
      const active = grid.querySelector('.card.revealed[data-active="true"]');
      if (active && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) CardTilt.focus(active);
    }).observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-active"] });
  }
  // Bouton son de la fenetre d'ouverture.
  const snd = document.getElementById("pack-sound-btn");
  if (snd && typeof Sfx !== "undefined") {
    const paint = () => { snd.innerHTML = Sfx.muted ? "&#128264;" : "&#128266;"; snd.title = Sfx.muted ? "Son coupé (activer)" : "Son actif (couper)"; snd.classList.toggle("on", !Sfx.muted); };
    paint();
    snd.addEventListener("click", (e) => { e.stopPropagation(); Sfx.setMuted(!Sfx.muted); paint(); if (!Sfx.muted) Sfx.pick(); });
  }
});

// ------------------------------------------------------------------ fenetre detaillee
const CardExtras = (function () {
  const esc = escHtml;
  const FINISH = { normal: "Normale", holo: "Holo", gold: "Dorée", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel", emerald: "Émeraude" };
  const QUALITY = { damaged: "Usé", worn: "Abîmé", good: "Bon état", mint: "Parfait état" };
  const SOURCE = {
    "open-pack": "tirée dans un booster", trade: "échangée", auctions: "vendue aux enchères", craft: "craftée", "guild-chest": "passée par le coffre de guilde",
    "admin-gift": "offerte par l'équipe", "redeem-code": "obtenue avec un code", disenchant: "décraftée", "foil-upgrade": "finition améliorée", "card-quality-repair": "restaurée",
    "altar-sacrifice": "sacrifiée à l'autel", "boss-attack": "envoyée au boss", "machine-room": "sacrifiée à la salle des machines", wanted: "donnée à l'avis de recherche",
    "personal-vault": "rangée au coffre-fort", "decraft-undo": "décraft annulé", "unique-counter": "échangée contre un Ticket Unique", "finish-reroll": "finition relancée",
    phantom: "carte fantôme reconstituée", machine: "récompense de la salle des machines", vault: "coffre-fort", chests: "trouvée dans un coffre", "booster-status": "usure du mode Hard"
  };
  const date = (t) => (t ? new Date(t * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "date inconnue");
  const serial = (n) => "#" + String(n || 0).padStart(3, "0");

  function eventLine(e) {
    const src = SOURCE[e.source] || (e.source ? e.source : "");
    if (e.kind === "created") return `<span class="ch-ico">&#127381;</span><span><strong>${esc(e.user || "?")}</strong> ${src ? esc(src) : "l'obtient"}${e.detail ? ` <small>(${[FINISH[e.detail.finish] || "", QUALITY[e.detail.quality] || "", e.detail.edition && EDITIONS[e.detail.edition] ? EDITIONS[e.detail.edition].label : ""].filter(Boolean).join(" · ")})</small>` : ""}${e.reconstructed ? ' <small class="muted">(retrouvé)</small>' : ""}</span>`;
    if (e.kind === "moved") return `<span class="ch-ico">&#128260;</span><span>${e.other ? `De <strong>${esc(e.other)}</strong> à ` : "Vers "}<strong>${esc(e.user || "personne")}</strong>${src ? ` <small>(${esc(src)})</small>` : ""}</span>`;
    if (e.kind === "changed") {
      const d = e.detail || {};
      const parts = [];
      if (d.finish) parts.push(`finition ${FINISH[d.finish[0]] || d.finish[0]} → <strong>${FINISH[d.finish[1]] || d.finish[1]}</strong>`);
      if (d.quality) parts.push(`état ${QUALITY[d.quality[0]] || d.quality[0]} → <strong>${QUALITY[d.quality[1]] || d.quality[1]}</strong>`);
      if (d.edition) parts.push(`édition <strong>${d.edition[1] && EDITIONS[d.edition[1]] ? EDITIONS[d.edition[1]].label : "retirée"}</strong>`);
      return `<span class="ch-ico">&#10024;</span><span>${parts.join(", ")}${src ? ` <small>(${esc(src)})</small>` : ""}</span>`;
    }
    if (e.kind === "deleted") return `<span class="ch-ico">&#128128;</span><span>${src ? esc(src.charAt(0).toUpperCase() + src.slice(1)) : "Disparue"}${e.user ? ` <small>(chez ${esc(e.user)})</small>` : ""}</span>`;
    return `<span class="ch-ico">&#8226;</span><span>${esc(e.kind)}</span>`;
  }

  async function loadHistory(box, cardId, serialNo) {
    box.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';
    try {
      const h = await API.get("cardHistory", { cardId, serial: serialNo });
      box.innerHTML = h.events.length ? `<ol class="card-history">${h.events.map((e) => `<li>${eventLine(e)}<time>${date(e.at)}</time></li>`).join("")}</ol>` : '<p class="muted">Aucun événement connu.</p>';
    } catch (e) { box.innerHTML = '<p class="muted">Historique indisponible.</p>'; }
  }

  function sparkline(sales) {
    if (sales.length < 2) return "";
    const w = 280, h = 70, pad = 6;
    const xs = sales.map((s) => s.at), ys = sales.map((s) => s.price);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = (t) => pad + ((t - x0) / Math.max(1, x1 - x0)) * (w - pad * 2);
    const Y = (p) => h - pad - ((p - y0) / Math.max(1, y1 - y0)) * (h - pad * 2);
    const pts = sales.map((s) => `${X(s.at).toFixed(1)},${Y(s.price).toFixed(1)}`).join(" ");
    return `<svg class="price-spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Évolution des prix de vente"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${sales.map((s) => `<circle cx="${X(s.at).toFixed(1)}" cy="${Y(s.price).toFixed(1)}" r="2.6" fill="currentColor"><title>${s.price} ✨ · ${date(s.at)}</title></circle>`).join("")}</svg>`;
  }
  async function loadPrice(box, cardId) {
    box.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';
    try {
      const p = await API.get("cardPrice", { cardId });
      const st = p.stats;
      const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("fr-FR") + " ✨");
      box.innerHTML = `
        <div class="price-grid">
          <div><small>Dernière vente</small><strong>${fmt(st.last)}</strong></div>
          <div><small>Moyenne 30 j</small><strong>${fmt(st.avg30)}</strong></div>
          <div><small>Plus bas / plus haut</small><strong>${st.count ? `${fmt(st.min)} / ${fmt(st.max)}` : "—"}</strong></div>
          <div><small>Décraft · craft</small><strong>${fmt(p.reference.disenchant)} · ${fmt(p.reference.craft)}</strong></div>
        </div>
        ${st.count >= 2 ? sparkline(p.sales) : `<p class="muted">${st.count ? "Une seule vente pour l'instant." : "Pas encore vendue aux enchères."} ${p.copies} exemplaire${p.copies > 1 ? "s" : ""} en circulation.</p>`}`;
    } catch (e) { box.innerHTML = '<p class="muted">Cote indisponible.</p>'; }
  }

  // ---------------------------------------------------------------- partage
  // Studio de partage (2026-10-21, js/lazy/share-studio.js) : image travaillee
  // en trois formats, partage, telechargement, copie et publication Discord.
  function share(o, btn) {
    btn.disabled = true;
    LazyJs.load("js/lazy/share-studio.js").then(() => ShareStudio.card(o)).catch(() => Toast.error("Partage indisponible pour le moment.")).finally(() => { btn.disabled = false; });
  }

  // ---------------------------------------------------------------- branchement sur la fenetre
  function attach(modal, o) {
    if (!modal || modal._extras) return;
    modal._extras = true;
    CardTilt.attach(modal, { gyro: true });
    const art = modal.querySelector(".card-art");
    const body = modal.querySelector(".card-modal-body");
    if (!art || !body) return;
    // Verso : dos de carte du joueur + fiche de la carte.
    const verso = document.createElement("div");
    verso.className = "card-verso cardback-default";
    const serials = (o.copies || []).map((c) => c.serialNumber).filter(Boolean);
    verso.innerHTML = `<div class="verso-sheet">
      <strong>${esc(o.card.name)}</strong>
      <small>${o.number ? "N° " + esc(String(o.number)) + " · " : ""}${esc(o.card.extension?.name || "")}</small>
      ${o.card.artist ? `<p class="verso-artist">Illustration : ${esc(o.card.artist)}</p>` : ""}
      ${o.card.description ? `<p class="verso-lore">« ${esc(o.card.description)} »</p>` : '<p class="verso-lore muted">Aucun texte d\'ambiance pour cette carte.</p>'}
      ${o.owned ? `<p class="verso-meta">${[FINISH[o.finish], QUALITY[o.quality], o.edition && EDITIONS[o.edition] ? "Édition " + EDITIONS[o.edition].label : ""].filter(Boolean).join(" · ")}${serials.length ? `<br>${serials.slice(0, 8).map(serial).join(", ")}${serials.length > 8 ? "…" : ""}` : ""}</p>` : ""}
    </div>`;
    art.appendChild(verso);
    // Barre d'actions + panneaux.
    const bar = document.createElement("div");
    bar.className = "card-extras-bar";
    bar.innerHTML = `
      <button type="button" class="btn-ghost" data-cx="inspect">&#128269; Inspecter</button>
      <button type="button" class="btn-ghost" data-cx="verso">&#128260; Verso</button>
      ${serials.length ? '<button type="button" class="btn-ghost" data-cx="history">&#128220; Historique</button>' : ""}
      <button type="button" class="btn-ghost" data-cx="price">&#128200; Cote</button>
      ${o.owned ? '<button type="button" class="btn-ghost" data-cx="share">&#128228; Partager</button>' : ""}`;
    const panel = document.createElement("div");
    panel.className = "card-extras-panel";
    panel.hidden = true;
    const badges = body.querySelector(".card-modal-badges");
    (badges || body.firstElementChild).after(bar);
    bar.after(panel);
    let open = null;
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cx]");
      if (!b) return;
      const what = b.dataset.cx;
      if (what === "verso") { modal.classList.toggle("show-verso"); b.classList.toggle("active", modal.classList.contains("show-verso")); return; }
      if (what === "share") { share({ ...o, serial: serials[0] || null }, b); return; }
      // Inspecteur plein ecran (js/lazy/card-inspector.js, charge au premier clic).
      if (what === "inspect") {
        b.disabled = true;
        LazyJs.load("js/lazy/card-inspector.js").then(() => CardInspector.open(o)).catch(() => Toast.error("Inspecteur indisponible pour le moment.")).finally(() => { b.disabled = false; });
        return;
      }
      bar.querySelectorAll("[data-cx]").forEach((x) => { if (x.dataset.cx !== "verso") x.classList.remove("active"); });
      if (open === what) { open = null; panel.hidden = true; return; }
      open = what;
      b.classList.add("active");
      panel.hidden = false;
      if (what === "history") {
        panel.innerHTML = `${serials.length > 1 ? `<label class="ch-pick">Exemplaire <select>${serials.map((s) => `<option value="${s}">${serial(s)}</option>`).join("")}</select></label>` : ""}<div class="ch-box"></div>`;
        const boxEl = panel.querySelector(".ch-box");
        const sel = panel.querySelector("select");
        loadHistory(boxEl, o.card.cardId, serials[0]);
        if (sel) sel.addEventListener("change", () => loadHistory(boxEl, o.card.cardId, Number(sel.value)));
      }
      if (what === "price") loadPrice(panel, o.card.cardId);
    });
  }
  return { attach };
})();
// Exposes sur window : les autres scripts testent leur presence (window.CardExtras).
window.CardTilt = CardTilt;
window.CardExtras = CardExtras;
