// Admin V2, contenu des onglets (2026-11-07, retour : « trop complexe a gerer »).
// Une meme grammaire pour toutes les rubriques, sans toucher aux formulaires
// (memes identifiants, memes appels) :
//  - en-tete de rubrique : a quoi elle sert, en une phrase ;
//  - sommaire de sections sur TOUTES les rubriques a plusieurs cartes
//    (admin-sections.js, avant : Codes, Evenements, Contenu seulement) ;
//  - descriptions des cartes repliees sur une ligne (clic = tout lire) ;
//  - Economie : le long tableau (mode, programmation, circulation,
//    inflation, journal...) range en onglets ;
//  - Difficultes : un mode a la fois (onglets), au lieu des 5 modes empiles ;
//  - tableaux a "Enregistrer" par ligne (taux de tirage, saisons) : les
//    boutons ne s'affichent que sur les lignes modifiees, et une barre en bas
//    enregistre tout d'un coup (ou annule).

const AdminUI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const LEADS = {
    accueil: "Tout ce qui se passe sur le serveur en un coup d'œil, et ce qui attend une action.",
    planning: "Ce qui se lance tout seul : boss, week-ends, codes, annonces.",
    sante: "Vitesse du serveur, erreurs, sauvegardes et Discord.",
    joueurs: "Retrouver un joueur et corriger son compte (ressources, niveaux, cartes).",
    codes: "Donner quelque chose : un code pour tout le monde, ou un don direct.",
    test: "Un compte pour essayer le jeu sans toucher aux vrais joueurs.",
    evenements: "Bonus temporaires : maintenant, à une date, ou par surprise.",
    contenu: "Ce que contiennent le jeu et ses rendez-vous : extensions, boss, saison, bingo, cosmétiques…",
    modes: "Ce que chaque difficulté ajoute ou retire. Un mode à la fois.",
    visuels: "Renommer et remplacer les images du jeu.",
    reglages: "Les chiffres du jeu : taux de tirage, règles de base, puis tous les réglages par thème.",
    economie: "Le mode de jeu, l'argent en circulation et d'où il vient.",
    discord: "Ce que le jeu publie sur Discord, et un message libre.",
    site: "Bandeau, maintenance et actions irréversibles.",
    tout: "Chaque table de la base, et le journal de ce que l'équipe a modifié.",
    doc: "Les règles du jeu avec les valeurs en direct : clique une valeur pour la changer."
  };
  const ICONS = { accueil: "📊", planning: "📆", sante: "🩺", joueurs: "👤", codes: "🎫", test: "🧪", evenements: "🎉", contenu: "🃏", modes: "🎲", visuels: "🎨", reglages: "⚙️", economie: "💰", discord: "📢", site: "🛠️", tout: "🔍", doc: "📖" };

  // ------------------------------------------------------------ en-tetes et descriptions
  function paneHeads() {
    document.querySelectorAll(".adm-pane").forEach((pane) => {
      const key = pane.id.replace("pane-", "");
      // Deja titree (Sante) : rien a ajouter.
      if (pane.querySelector(":scope > .adm-pane-head, :scope > .adm-card-head")) return;
      const head = document.createElement("header");
      head.className = "adm-pane-head";
      head.innerHTML = `<h2><span aria-hidden="true">${ICONS[key] || "•"}</span> ${esc(pane.dataset.title || key)}</h2>${LEADS[key] ? `<p>${esc(LEADS[key])}</p>` : ""}`;
      pane.insertBefore(head, pane.firstChild);
    });
  }
  // Une ligne visible ; clic sur la description = tout lire.
  function clampDescriptions(root = document) {
    root.querySelectorAll(".adm-card-head > p:not(.adm-desc)").forEach((p) => {
      p.classList.add("adm-desc");
      p.title = "Cliquer pour tout lire";
    });
  }

  // ------------------------------------------------------------ onglets internes
  // Regroupe les enfants directs de zone : un groupe commence a chaque titre
  // (selector). Refait a chaque nouveau rendu de la zone ; garde l'onglet choisi.
  // pre : groupes nommes pour les blocs places avant le premier titre
  // ([{ title, sel }], le dernier prend le reste).
  function innerTabs(zone, { selector = ":scope > h3", key, first = null, pre = [] } = {}) {
    if (!zone) return;
    const KEY = "2gatcha_admin_tabs_" + key;
    const build = () => {
      if (zone.querySelector(":scope > .ait-bar")) return;
      const heads = [...zone.querySelectorAll(selector)];
      if (heads.length < 2) return;
      const kids = [...zone.children];
      const groups = [];
      let cur = null;
      // Ce qui precede le premier titre reste visible au-dessus des onglets.
      kids.forEach((el) => {
        if (heads.includes(el)) { cur = { title: el.textContent.trim().replace(/\s+/g, " "), els: [el] }; groups.push(cur); }
        else if (cur) cur.els.push(el);
        else if (pre.length) {
          const p = pre.find((x) => el.matches(x.sel)) || pre[pre.length - 1];
          let g = groups.find((x) => x.title === p.title);
          if (!g) { g = { title: p.title, els: [] }; groups.push(g); }
          g.els.push(el);
        }
      });
      const bar = document.createElement("nav");
      bar.className = "ait-bar";
      bar.setAttribute("aria-label", "Parties");
      const panels = groups.map((g, i) => {
        const panel = document.createElement("div");
        panel.className = "ait-panel";
        panel.dataset.i = i;
        g.els.forEach((el) => panel.appendChild(el));
        return panel;
      });
      bar.innerHTML = groups.map((g, i) => `<button type="button" class="ait-tab" data-ait="${i}">${esc(g.title.length > 40 ? g.title.slice(0, 38) + "…" : g.title)}</button>`).join("");
      zone.appendChild(bar);
      panels.forEach((p) => zone.appendChild(p));
      let saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) { /* stockage indisponible */ }
      const pick = (title) => {
        const i = Math.max(0, groups.findIndex((g) => g.title === title));
        panels.forEach((p, j) => { p.hidden = j !== i; });
        bar.querySelectorAll(".ait-tab").forEach((b, j) => { b.classList.toggle("on", j === i); b.setAttribute("aria-pressed", String(j === i)); });
        try { localStorage.setItem(KEY, groups[i].title); } catch (e) { /* idem */ }
      };
      bar.addEventListener("click", (e) => { const b = e.target.closest("[data-ait]"); if (b) pick(groups[Number(b.dataset.ait)].title); });
      pick(saved && groups.some((g) => g.title === saved) ? saved : first && groups.find((g) => g.title.includes(first)) ? groups.find((g) => g.title.includes(first)).title : groups[0].title);
    };
    let t = 0;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(build, 30); }).observe(zone, { childList: true });
    build();
  }

  // Difficultes : un mode a la fois.
  function modeTabs() {
    const pane = $("pane-modes");
    if (!pane) return;
    const KEY = "2gatcha_admin_mode_tab";
    const apply = () => {
      const blocks = [...pane.querySelectorAll(".amr-mode[data-mode]")];
      if (blocks.length < 2) return;
      const host = blocks[0].parentElement;
      let bar = host.querySelector(":scope > .ait-bar.amr-tabs");
      let saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) { /* stockage indisponible */ }
      const current = (blocks.find((b) => b.classList.contains("is-current")) || blocks[0]).dataset.mode;
      const sel = bar && bar.dataset.sel ? bar.dataset.sel : saved && blocks.some((b) => b.dataset.mode === saved) ? saved : current;
      if (!bar) {
        bar = document.createElement("nav");
        bar.className = "ait-bar amr-tabs";
        host.insertBefore(bar, blocks[0]);
        bar.addEventListener("click", (e) => { const b = e.target.closest("[data-mtab]"); if (!b) return; bar.dataset.sel = b.dataset.mtab; try { localStorage.setItem(KEY, b.dataset.mtab); } catch (err) { /* idem */ } apply(); });
      }
      bar.dataset.sel = sel;
      bar.innerHTML = blocks.map((b) => {
        const name = (b.querySelector("strong, h3") || b).textContent.trim().split("\n")[0].slice(0, 24);
        return `<button type="button" class="ait-tab ${b.dataset.mode === sel ? "on" : ""}" data-mtab="${b.dataset.mode}">${esc(name)}${b.classList.contains("is-current") ? " <small>(en cours)</small>" : ""}</button>`;
      }).join("");
      blocks.forEach((b) => { b.hidden = b.dataset.mode !== sel; });
    };
    let t = 0;
    new MutationObserver((list) => { if (list.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.(".amr-mode") || n.querySelector?.(".amr-mode"))))) { clearTimeout(t); t = setTimeout(apply, 30); } }).observe(pane, { childList: true, subtree: true });
    apply();
  }

  // ------------------------------------------------------------ enregistrer tout
  const SAVE_BTN = ".balance-save-btn, [data-season-save]";
  const dirty = new Set();
  let bar = null;
  function rowOf(el) { const btn = el.closest("tr, .balance-row, .season-row, li")?.querySelector(SAVE_BTN); return btn ? btn.closest("tr, .balance-row, .season-row, li") : null; }
  function paintBar() {
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "adm-savebar";
      bar.hidden = true;
      bar.innerHTML = `<span class="adm-savebar-n"></span><button type="button" class="btn-ghost" data-savebar="cancel">Annuler</button><button type="button" class="btn" data-savebar="save">Tout enregistrer</button>`;
      document.body.appendChild(bar);
      bar.addEventListener("click", (e) => { const b = e.target.closest("[data-savebar]"); if (b) (b.dataset.savebar === "save" ? saveAll(b) : cancelAll()); });
    }
    [...dirty].forEach((r) => { if (!r.isConnected) dirty.delete(r); });
    bar.hidden = !dirty.size;
    bar.querySelector(".adm-savebar-n").textContent = `${dirty.size} ligne${dirty.size > 1 ? "s" : ""} modifiée${dirty.size > 1 ? "s" : ""}, pas encore enregistrée${dirty.size > 1 ? "s" : ""}`;
  }
  async function saveAll(btn) {
    btn.disabled = true;
    for (const row of [...dirty]) {
      const b = row.querySelector(SAVE_BTN);
      if (!b) continue;
      b.click();
      // Le gestionnaire de la ligne desactive son bouton le temps de l'appel.
      for (let i = 0; i < 40 && b.disabled; i++) await new Promise((r) => setTimeout(r, 100));
      row.classList.remove("adm-dirty");
      row.querySelectorAll("input, select, textarea").forEach((f) => { delete f.dataset.initial; });
      dirty.delete(row);
    }
    btn.disabled = false;
    paintBar();
  }
  function cancelAll() {
    dirty.forEach((row) => {
      row.querySelectorAll("input, select, textarea").forEach((f) => { if (f.dataset.initial != null) { if (f.type === "checkbox") f.checked = f.dataset.initial === "1"; else f.value = f.dataset.initial; delete f.dataset.initial; } });
      row.classList.remove("adm-dirty");
    });
    dirty.clear();
    paintBar();
  }
  function trackEdits(root) {
    if (!root) return;
    root.classList.add("adm-batch");
    root.addEventListener("focusin", (e) => { const f = e.target; if (f.matches("input, select, textarea") && rowOf(f) && f.dataset.initial == null) f.dataset.initial = f.type === "checkbox" ? (f.checked ? "1" : "0") : f.value; });
    root.addEventListener("input", (e) => { const row = rowOf(e.target); if (!row) return; row.classList.add("adm-dirty"); dirty.add(row); paintBar(); });
    root.addEventListener("click", (e) => { const b = e.target.closest(SAVE_BTN); if (!b) return; const row = rowOf(b); if (row) { setTimeout(() => { row.classList.remove("adm-dirty"); dirty.delete(row); paintBar(); }, 0); } });
    window.addEventListener("beforeunload", (e) => { if (dirty.size) { e.preventDefault(); e.returnValue = ""; } });
  }

  function init() {
    if (!$("admin-zone")) return;
    paneHeads();
    clampDescriptions();
    document.addEventListener("click", (e) => { const p = e.target.closest(".adm-desc"); if (p) p.classList.toggle("open"); });
    // Les cartes rendues plus tard (onglets charges a la demande).
    let raf = 0;
    new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; clampDescriptions(); }); }).observe($("admin-zone"), { childList: true, subtree: true });
    innerTabs($("economy-zone"), { key: "economie", first: "Mode de jeu", pre: [{ title: "🎮 Mode de jeu", sel: ".preset-zone" }, { title: "🔒 Fonctionnalités par mode", sel: ".mf-zone" }, { title: "📊 En circulation", sel: "*" }] });
    modeTabs();
    trackEdits($("pane-reglages"));
    trackEdits($("pane-contenu"));
  }
  document.addEventListener("DOMContentLoaded", init);
  return { innerTabs };
})();
window.AdminUI = AdminUI;
