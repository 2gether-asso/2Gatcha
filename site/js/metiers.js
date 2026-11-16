// Carnet des metiers (2026-11-16, api/src/native/metiers.js) : contrats de la
// semaine (bronze, argent, or), legende de la semaine et Comptoir des maitres.
//  - Village : le carnet complet (#metiers-panel, ajoute au bas du village).
//  - Fouille, peche, jardin, archeologie, cuisine : un bandeau repliable en
//    tete de l'onglet avec les contrats et la legende de ce metier.
// Les paliers atteints sont annonces par le serveur (notices) ; on relit le
// carnet un peu apres chaque action d'un des 5 jeux.
(function () {
  if (typeof API === "undefined") return;
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const PANES = { dig: "dig-pane", fish: "fish-pane", garden: "garden-pane", archeo: "archeo-pane", cook: "cook-pane" };
  const PATHS = new Set(["dig", "fishing", "garden", "archeo", "cook"]);
  const OPEN_KEY = "2gatcha_metier_strip";
  let data = null, loading = null, timer = null;

  const load = () => {
    if (!Session.isLoggedIn()) return Promise.resolve(null);
    if (!loading) loading = API.post("metiers", { userId: Session.userId, action: "status" }).then((r) => { data = r; render(); return r; }).catch(() => null).finally(() => { loading = null; });
    return loading;
  };

  const stageIcons = (c) => c.stages.map((s) => `<span class="mt-medal ${s.reached ? "on" : ""}" title="${s.label} : ${s.target} (+${s.dust} ✨, +${s.tokens} jeton${s.tokens > 1 ? "s" : ""}${s.extra ? `, ${esc(s.extra)}` : ""})">${s.icon}</span>`).join("");
  function contractHtml(c) {
    const pct = c.done ? 100 : Math.round((c.n / Math.max(1, c.target)) * 100);
    return `<div class="mt-contract ${c.done ? "done" : ""}">
      <div class="mt-contract-head"><span>${esc(c.label)}</span><span class="mt-medals">${stageIcons(c)}</span></div>
      <div class="mt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${c.target}" aria-valuenow="${Math.min(c.n, c.target)}"><span style="width:${pct}%"></span></div>
      <small>${c.done ? "Contrat rempli : or !" : `${c.n} / ${c.target}`}</small>
    </div>`;
  }
  function legendHtml(m) {
    const l = m.legend;
    return `<div class="mt-legend ${l.found ? "found" : ""}">
      <span class="mt-legend-ico" aria-hidden="true">${l.found ? "🌟" : "❔"}</span>
      <div><strong>${l.found ? esc(l.name) : "Légende de la semaine"}</strong>
      <small>${l.found ? "Trouvée cette semaine !" : `Cachée quelque part : chaque ${esc(l.what)} peut la révéler (garantie au bout de ${l.pity}, ${l.tries} déjà).`}${l.total ? ` · ${l.total} au cabinet` : ""}</small></div>
    </div>`;
  }
  const endsIn = () => { const h = Math.max(0, Math.round((data.endsAt - Date.now() / 1000) / 3600)); return h >= 48 ? `${Math.round(h / 24)} jours` : `${h} h`; };

  // Bandeau d'un jeu.
  function renderStrip(key) {
    const pane = $(PANES[key]);
    if (!pane || !data) return;
    const m = data.metiers.find((x) => x.key === key);
    if (!m) return;
    let box = pane.querySelector(".mt-strip");
    if (!box) {
      box = document.createElement("details");
      box.className = "mt-strip";
      const lead = pane.querySelector(":scope > .lead");
      if (lead) lead.after(box); else pane.prepend(box);
      // Ouvert par defaut sur ordinateur, replie sur telephone (place comptee).
      let open = window.innerWidth > 640;
      try { const v = localStorage.getItem(OPEN_KEY); if (v != null) open = v !== "0"; } catch (e) { /* stockage indisponible */ }
      box.open = open;
      box.addEventListener("toggle", () => { try { localStorage.setItem(OPEN_KEY, box.open ? "1" : "0"); } catch (e) { /* idem */ } });
    }
    const gold = m.contracts.filter((c) => c.done).length;
    box.innerHTML = `<summary>📒 Carnet ${esc(m.label)} <small>${gold}/${m.contracts.length} contrats en or · ${m.legend.found ? "légende trouvée 🌟" : "légende à trouver"} · 🎖️ ${data.tokens} jeton${data.tokens > 1 ? "s" : ""}</small></summary>
      <div class="mt-strip-body">${m.contracts.map(contractHtml).join("")}${legendHtml(m)}</div>
      <a class="mt-more" href="jeux.html#village" data-mt-village>Tout le carnet et le Comptoir des maîtres →</a>`;
  }

  // Carnet complet (village).
  function renderPanel() {
    const host = $("village-pane");
    if (!host || !data) return;
    let box = $("metiers-panel");
    if (!box) { box = document.createElement("section"); box.id = "metiers-panel"; box.className = "mt-panel"; host.appendChild(box); }
    const shop = data.shop.map((s) => `<button type="button" class="mt-shop-item ${s.owned ? "owned" : ""}" data-mt-buy="${s.key}" ${s.owned || data.tokens < s.price ? "disabled" : ""}>
        <span aria-hidden="true">${s.key === "goldkey" ? GOLD_KEY : s.icon}</span><span>${esc(s.label)}</span><b>${s.owned ? "Possédé" : `${s.price} 🎖️`}</b></button>`).join("");
    box.innerHTML = `
      <header class="mt-head">
        <h2>📒 Carnet des métiers</h2>
        <span class="mt-tokens" title="Jetons de maître">🎖️ <strong>${data.tokens}</strong> jeton${data.tokens > 1 ? "s" : ""} de maître</span>
        <span class="muted">Nouveaux contrats dans ${endsIn()} · ${data.gold}/${data.totalContracts} en or${data.slam ? " · 🏆 grand chelem !" : ` · grand chelem : +${data.slamTokens} jetons`}</span>
      </header>
      <p class="lead mt-lead">Chaque semaine, 2 contrats par métier (bronze, argent, or : poussières et jetons à chaque palier) et une <strong>légende</strong> cachée à débusquer. Les jetons s'échangent au Comptoir des maîtres.</p>
      <div class="mt-grid">${data.metiers.map((m) => `
        <article class="mt-card">
          <h3><a href="${m.url}">${m.icon} ${esc(m.label)}</a></h3>
          ${m.contracts.map(contractHtml).join("")}
          ${legendHtml(m)}
        </article>`).join("")}</div>
      <details class="mt-shop-wrap" ${data.tokens >= 3 ? "open" : ""}>
        <summary>🎖️ Comptoir des maîtres</summary>
        <div class="mt-shop">${shop}</div>
      </details>
      ${data.legends.length ? `<details class="mt-cabinet"><summary>🏛️ Cabinet des légendes <small>${data.legendsTotal}</small></summary>
        <ul>${data.legends.map((l) => `<li>${l.icon} <strong>${esc(l.name)}</strong> <small class="muted">${esc(l.metierLabel)} · semaine du ${new Date(l.week + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</small></li>`).join("")}</ul></details>` : ""}`;
  }

  function render() {
    if (!data) return;
    renderPanel();
    Object.keys(PANES).forEach(renderStrip);
  }

  // Relecture apres une action d'un des 5 jeux (les paliers sont annonces par le serveur).
  const post = API.post.bind(API);
  API.post = function (name, body) {
    const p = post(name, body);
    if (PATHS.has(name) && body && body.action && body.action !== "status") p.then(() => { clearTimeout(timer); timer = setTimeout(load, 1200); }, () => {});
    return p;
  };

  document.addEventListener("click", async (e) => {
    const buy = e.target.closest("[data-mt-buy]");
    if (buy) {
      buy.disabled = true;
      try {
        data = await API.post("metiers", { userId: Session.userId, action: "buy", key: buy.dataset.mtBuy });
        render();
        Toast.success(`🎖️ Comptoir des maîtres : ${esc(data.label || "acheté")} !`);
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) {
        buy.disabled = false;
        Toast.error({ not_enough_tokens: "Pas assez de jetons de maître : remplis des contrats !", already_owned: "Déjà possédé." }[err.code] || friendlyError(err));
      }
      return;
    }
    if (e.target.closest("[data-mt-village]") && typeof setActiveTab === "function") {
      e.preventDefault();
      setActiveTab("village");
      setTimeout(() => $("metiers-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    if (!Session.isLoggedIn() || !$("village-pane")) return;
    setTimeout(load, 600);
  });
  window.Metiers = { load };
})();
