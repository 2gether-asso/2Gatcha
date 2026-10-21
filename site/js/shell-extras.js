// Modules secondaires de l'en-tete, charges sur toutes les pages juste apres
// shell.js (decoupe 2026-10-20) : heure de chance, course aux tresors,
// deblocages des debutants, infobulles des ressources, tirer pour rafraichir,
// raccourcis clavier, image de la cle, effets des cartes secretes, pause des
// animations hors ecran. Les modules lourds et rares sont dans js/lazy/ et
// charges a la demande (LazyJs, core.js) : inventaire, carte de joueur,
// rouages et secrets.

// ---------------------------------------------------------------------------
// Heure de chance (2026-10-07) : bandeau sur toutes les pages pendant
// l'heure de chance. Les fenetres du jour sont gardees en session (elles ne
// changent pas dans la journee) : aucune requete en plus par page.
// ---------------------------------------------------------------------------
const LuckyHour = {
  KEY: "2gatcha_lucky",
  today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }); },
  read() { try { const v = JSON.parse(sessionStorage.getItem(this.KEY) || "null"); return v && v.day === this.today() ? v : null; } catch (e) { return null; } },
  async windows() {
    const cached = this.read();
    if (cached) return cached.windows;
    const t = await API.getToday(Session.userId);
    const windows = t.lucky.windows || [t.lucky.window, t.lucky.next].filter(Boolean);
    try { sessionStorage.setItem(this.KEY, JSON.stringify({ day: this.today(), windows })); } catch (e) { /* stockage indisponible */ }
    return windows;
  },
  async init() {
    if (!Session.isLoggedIn() || document.getElementById("lucky-banner")) return;
    let windows = [];
    try { windows = await this.windows(); } catch (e) { return; }
    const draw = () => {
      const now = Date.now() / 1000;
      const w = windows.find((x) => x.start <= now && now < x.end);
      let el = document.getElementById("lucky-banner");
      if (!w) { if (el) { el.remove(); if (typeof syncHeaderOffset === "function") syncHeaderOffset(); } return; }
      if (!el) {
        el = document.createElement("a");
        el.id = "lucky-banner";
        el.className = "lucky-banner";
        el.href = "ouverture.html";
        document.getElementById("site-header")?.appendChild(el); if (typeof syncHeaderOffset === "function") syncHeaderOffset();
      }
      const m = Math.max(1, Math.ceil((w.end - now) / 60));
      el.innerHTML = `&#127808; <strong>Heure de chance</strong> : finitions et poussières boostées encore ${m} min`;
    };
    draw();
    setInterval(draw, 30000);
  }
};

document.addEventListener("DOMContentLoaded", () => LuckyHour.init());

// Carte de joueur au survol (js/lazy/player-card.js) : chargee au premier
// survol d'un pseudo, sur ordinateur seulement.
(function () {
  if (!window.matchMedia || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const first = (e) => {
    const a = e.target.closest && e.target.closest('a[href*="profile.html?pseudo="]');
    if (!a) return;
    document.removeEventListener("mouseover", first);
    LazyJs.load("js/lazy/player-card.js").then(() => {
      PlayerCard.init();
      PlayerCard.timer = setTimeout(() => PlayerCard.show(a), 380);
    }).catch(() => {});
  };
  document.addEventListener("mouseover", first);
})();


// Inventaire (js/lazy/inventory.js) : charge au survol ou au premier clic sur
// la barre de ressources de l'en-tete, puis ouvert tout de suite.
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("inventory-trigger");
  if (!btn) return;
  const load = () => LazyJs.load("js/lazy/inventory.js");
  const warm = () => { load().catch(() => {}); };
  btn.addEventListener("pointerenter", warm, { once: true });
  btn.addEventListener("focus", warm, { once: true });
  let started = false;
  btn.addEventListener("click", function first(e) {
    e.stopPropagation();
    if (started) return;
    started = true;
    // Ensuite, Inventory.init() gere lui-meme les clics (ouvrir / fermer).
    load().then(() => { btn.removeEventListener("click", first); Inventory.init(); Inventory.toggle(true); })
      .catch(() => { started = false; if (typeof Toast !== "undefined") Toast.error("Inventaire indisponible pour le moment."); });
  });
});

// ---------------------------------------------------------------------------
// Course aux tresors hebdo (2026-10-09, api/src/native/treasure.js) : 5
// indices caches sur 5 pages ; sur la page concernee, une petite icone
// discrete est glissee dans le contenu. Un clic la ramasse.
// ---------------------------------------------------------------------------
const Treasure = {
  state: null,
  page() {
    const name = (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "");
    return name || "index";
  },
  async load() {
    if (typeof Session === "undefined" || !Session.isLoggedIn() || !API.getTreasureHunt) return;
    try { this.state = await API.getTreasureHunt(Session.userId); } catch (e) { return; }
    if (!this.state.enabled) return;
    const clue = this.state.clues.find((c) => c.page === this.page() && !c.found);
    if (clue) setTimeout(() => this.place(clue), 1200);
  },
  place(clue) {
    const host = document.querySelector("main") || document.body;
    if (!host || document.getElementById("treasure-clue")) return;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const b = document.createElement("button");
    b.type = "button";
    b.id = "treasure-clue";
    b.className = "treasure-clue";
    b.setAttribute("aria-label", "Indice de la course aux trésors");
    b.title = "Un indice ?";
    b.innerHTML = '<img src="assets/CarteAuTresors.PNG" alt="" />';
    b.style.left = clue.x + "%";
    b.style.top = clue.y + "%";
    b.addEventListener("click", () => this.find(clue, b));
    host.appendChild(b);
  },
  async find(clue, el) {
    el.disabled = true;
    try {
      const r = await API.findTreasure(Session.userId, clue.id, clue.page);
      this.state = r;
      el.classList.add("found");
      setTimeout(() => el.remove(), 700);
      if (typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal("rare");
      const left = r.total - r.found;
      Toast.success(r.complete
        ? `&#129517; Les 5 indices trouvés ! +${r.reward.dust} poussières${r.reward.boosters ? `, +${r.reward.boosters} booster` : ""}${r.reward.keys ? `, +${r.reward.keys} clé` : ""}`
        : `&#129517; Indice trouvé (+${r.reward.dust} poussières) ! Encore ${left} à dénicher cette semaine.`);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (e) {
      el.disabled = false;
      if (e.code === "already_found") el.remove(); else Toast.error("Indice introuvable. (" + e.message + ")");
    }
  }
};
document.addEventListener("DOMContentLoaded", () => Treasure.load());

// Compte test admin (2026-10-18) : outils et bandeau charges seulement
// pendant une partie avec le compte test (js/testaccount.js).
document.addEventListener("DOMContentLoaded", () => {
  try {
    if (!localStorage.getItem("2gatcha_test_backup") || window.TestAccount) return;
    LazyJs.load("js/testaccount.js").catch(() => {});
  } catch (e) { /* stockage indisponible */ }
});

// Deblocages par niveau des nouveaux comptes (2026-10-18, api/src/native/
// starter.js) : onglets et liens verrouilles gardes visibles avec un cadenas
// (clic -> message), widgets masques, page verrouillee remplacee par un
// message ; accueil simplifie tant que le parcours du debutant n'est pas fini.
const StarterLocks = {
  KEY: "2gatcha_starter_" + (Session.userId || ""),
  locks: [],
  unlocks: [],
  // Onglets, liens et modes de collection : cadenas. Le reste (panneaux) : masque.
  isTeaser: (sel) => /^(#tab-|a\[|\.coll-mode)/.test(sel),
  apply(view) {
    const locks = (view && view.locks) || [];
    this.locks = locks;
    if (view && view.unlocks) this.unlocks = view.unlocks;
    document.documentElement.classList.toggle("starter-simple", !!(view && view.active));
    let style = document.getElementById("starter-locks-style");
    if (!style) { style = document.createElement("style"); style.id = "starter-locks-style"; document.head.appendChild(style); }
    style.textContent = locks.map((l) => {
      const teaser = (l.hide || []).filter(this.isTeaser), hidden = (l.hide || []).filter((s) => !this.isTeaser(s));
      return (teaser.length ? `${teaser.join(",")} { opacity: 0.5; filter: grayscale(0.7); }\n${teaser.map((s) => s + "::after").join(",")} { content: " \\1F512 ${l.level}"; font-size: 0.72em; margin-left: 4px; white-space: nowrap; }\n` : "") +
        (hidden.length ? `${hidden.join(",")} { display: none !important; }\n` : "");
    }).join("");
    const run = () => {
      const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
      const lock = locks.find((l) => l.page && l.page === page);
      const main = document.querySelector("main");
      if (lock && main && !main.querySelector(".feature-closed")) {
        [...main.children].forEach((el) => { el.hidden = true; });
        main.insertAdjacentHTML("afterbegin", `<section class="feature-closed"><span class="feature-closed-icon" aria-hidden="true">${lock.icon}</span>
          <h1>${escHtml(lock.label)}</h1>
          <p>Se débloque au <strong>niveau ${lock.level}</strong>. Continue le parcours du débutant et joue un peu : chaque booster ouvert et chaque jeu rapportent de l'XP.</p>
          <a class="btn" href="index.html">Retour à l'accueil</a></section>`);
      }
      // Onglet verrouille ouvert par un lien #ancre ou un script de page
      // (meme plus tard) : on repart sur le premier onglet ouvert.
      document.querySelectorAll('[role="tab"][aria-selected="true"]').forEach((t) => this.leave(t));
      if (!this.observer) {
        this.observer = new MutationObserver((list) => list.forEach((m) => { if (m.target.getAttribute("aria-selected") === "true") this.leave(m.target); }));
        this.observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
      }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(run, 0)); else run();
  },
  lockOf(el) {
    return this.locks.find((l) => (l.hide || []).some((s) => this.isTeaser(s) && el.closest(s)));
  },
  leave(tab) {
    if (tab.getAttribute("role") !== "tab" || !tab.parentElement || !this.lockOf(tab)) return;
    const next = [...tab.parentElement.querySelectorAll('[role="tab"]')].find((x) => !this.lockOf(x) && x.offsetParent !== null);
    if (next) setTimeout(() => next.click(), 0);
  },
  async refresh() {
    if (typeof Session === "undefined" || !Session.isLoggedIn()) return null;
    try {
      const v = await API.post("starter", { userId: Session.userId, action: "status" });
      try { localStorage.setItem(this.KEY, JSON.stringify({ locks: v.locks, active: v.active, unlocks: v.unlocks })); } catch (e) { /* stockage indisponible */ }
      this.apply(v);
      return v;
    } catch (e) { return null; }
  }
};
// Clic sur un element verrouille : message au lieu de l'action.
document.addEventListener("click", (e) => {
  if (!StarterLocks.locks.length || !(e.target instanceof Element)) return;
  const l = StarterLocks.lockOf(e.target);
  if (!l) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (typeof Toast !== "undefined") Toast.info(`${l.icon} ${escHtml(l.label)} se débloque au niveau ${l.level}.`);
}, true);
try { const c = JSON.parse(localStorage.getItem(StarterLocks.KEY) || "null"); if (c && Session.isLoggedIn()) StarterLocks.apply(c); } catch (e) { /* stockage indisponible */ }
document.addEventListener("DOMContentLoaded", () => StarterLocks.refresh());

// Infobulles des ressources (2026-10-18) : survol (ordinateur) ou appui
// (mobile) sur une icone de ressource : a quoi elle sert, ou en trouver.
// Dans un bouton ou un lien, seule l'infobulle du navigateur (title) s'affiche.
document.addEventListener("mouseover", (e) => {
  const img = e.target instanceof Element ? e.target.closest("img.ico-token") : null;
  if (!img || img.title || typeof resKindOf !== "function") return;
  const info = RES_INFO[resKindOf(img)];
  if (info) img.title = info.name + " : " + info.use + " Où en trouver : " + info.where;
});
document.addEventListener("click", (e) => {
  const img = e.target instanceof Element ? e.target.closest("img.ico-token") : null;
  const old = document.querySelector(".res-pop");
  if (old && !(e.target instanceof Element && e.target.closest(".res-pop"))) old.remove();
  if (!img || img.closest("button, a, label, select, .inv-icon, [data-shop-buy]") || typeof resKindOf !== "function") return;
  const info = RES_INFO[resKindOf(img)];
  if (!info) return;
  const pop = document.createElement("div");
  pop.className = "res-pop";
  pop.setAttribute("role", "tooltip");
  pop.innerHTML = `<strong>${escHtml(info.name)}</strong><span>${escHtml(info.use)}</span><small>Où en trouver : ${escHtml(info.where)}</small>`;
  document.body.appendChild(pop);
  const r = img.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
  pop.style.top = (r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8) + "px";
  setTimeout(() => pop.remove(), 6000);
});

// Tirer pour rafraichir (2026-10-18) : sur ecran tactile, en haut de la page,
// tirer vers le bas recharge la page (le geste natif d'Android est coupe en CSS
// pour avoir le meme partout). Jamais dans une fenetre ouverte ni un jeu en cours.
(function () {
  if (!("ontouchstart" in window)) return;
  let startY = null, dy = 0, ind = null;
  const blocked = (el) => !!(el && el.closest && el.closest(".card-modal-overlay, .ta-modal, .season-cine, .cine-overlay, .user-menu-dropdown.open, .inventory-panel, .fish-scene, .dig-board, input, textarea, select, [data-no-ptr]"));
  document.addEventListener("touchstart", (e) => {
    if (window.scrollY > 0 || e.touches.length !== 1 || blocked(e.target) || document.querySelector(".card-modal-overlay:not([hidden]), .ta-modal, .season-cine")) { startY = null; return; }
    startY = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { if (ind) ind.style.opacity = "0"; return; }
    if (!ind) { ind = document.createElement("div"); ind.className = "ptr-indicator"; ind.setAttribute("aria-hidden", "true"); document.body.appendChild(ind); }
    const p = Math.min(1, dy / 110);
    ind.style.opacity = String(p);
    ind.style.transform = `translate(-50%, ${Math.min(70, dy / 2)}px) rotate(${Math.round(p * 270)}deg)`;
    ind.classList.toggle("armed", dy > 110);
    ind.textContent = "↻";
  }, { passive: true });
  document.addEventListener("touchend", () => {
    if (startY == null) return;
    const go = dy > 110 && window.scrollY <= 0;
    startY = null;
    if (go) { if (ind) ind.classList.add("loading"); if (typeof Haptics !== "undefined") Haptics.buzz(15); setTimeout(() => location.reload(), 150); }
    else if (ind) { ind.style.opacity = "0"; }
  });
})();

// ---------------------------------------------------------------------------
// Raccourcis clavier (2026-10-18, ordinateur) : « / » ouvre la recherche,
// « g » puis une lettre change de page, « ? » affiche l'aide. Ignores pendant
// la saisie, avec Ctrl/Alt/Cmd, ou quand une fenetre est ouverte.
// ---------------------------------------------------------------------------
const Shortcuts = {
  GO: { a: ["index.html", "Accueil"], o: ["ouverture.html", "Ouvrir des boosters"], c: ["collection.html", "Collection"], j: ["jeux.html", "Jeux"], m: ["communaute.html", "Communauté"], b: ["boutique.html", "Boutique"], e: ["trade.html", "Échanges"], p: ["progression.html", "Progression"], f: ["coffre.html", "Coffre-fort"] },
  pending: 0,
  busy(e) {
    const t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey) return true;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return true;
    return !!document.querySelector(".card-modal-overlay, .wf-overlay, .fish-pick, [role='dialog']:not([hidden])");
  },
  help() {
    const rows = [["/", "Rechercher un joueur, une carte…"], ["?", "Cette aide"], ...Object.entries(this.GO).map(([k, [, label]]) => [`g puis ${k}`, label])];
    Confirm.show(`<table class="kbd-help">${rows.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join("")}</table>`, { title: "Raccourcis clavier", confirmText: "OK", cancelText: "Fermer" });
  },
  init() {
    document.addEventListener("keydown", (e) => {
      if (this.busy(e)) { this.pending = 0; return; }
      const k = e.key;
      if (this.pending && Date.now() - this.pending < 1200) {
        this.pending = 0;
        const go = this.GO[k.toLowerCase()];
        if (go) { e.preventDefault(); location.href = go[0]; }
        return;
      }
      this.pending = 0;
      if (k === "g") this.pending = Date.now();
      else if (k === "/") { const b = document.getElementById("global-search-trigger"); if (b) { e.preventDefault(); b.click(); } }
      else if (k === "?") { e.preventDefault(); this.help(); }
    });
  }
};
if (!window.matchMedia || !matchMedia("(pointer: coarse)").matches) Shortcuts.init();
// Tout bouton [data-open-search] ouvre la recherche de l'en-tete.
document.addEventListener("click", (e) => {
  if (!e.target.closest || !e.target.closest("[data-open-search]")) return;
  document.getElementById("global-search-trigger")?.click();
});

// ---------------------------------------------------------------------------
// Une seule cle dans le jeu (2026-10-19) : les emojis de cle encore presents
// dans des textes venus de l'API (« 🔑 1 clé », couts, recompenses) sont
// remplaces a l'affichage par l'image de la cle (clés.PNG), partout.
// ---------------------------------------------------------------------------
const KeyArt = {
  RE: /\u{1F511}|\u{1F5DD}\u{FE0F}?/u,
  SPLIT: /(\u{1F511}|\u{1F5DD}\u{FE0F}?)/u,
  SKIP: new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "OPTION", "SELECT", "TITLE", "svg", "text"]),
  // Garde-fou : un element qui remet sans cesse son emoji (rendu en boucle)
  // n'est plus touche apres quelques remplacements.
  hits: new WeakMap(),
  swaps: 0,
  queue: new Set(),
  scheduled: false,
  swapText(node) {
    const parent = node.parentNode;
    if (!parent || parent.nodeType !== 1 || this.SKIP.has(parent.nodeName) || parent.closest("svg, select, [contenteditable='true']")) return;
    const n = (this.hits.get(parent) || 0) + 1;
    if (n > 3) return;
    this.hits.set(parent, n);
    const parts = node.nodeValue.split(this.SPLIT);
    if (parts.length < 2) return;
    const frag = document.createDocumentFragment();
    parts.forEach((p, i) => {
      if (i % 2) { const img = document.createElement("img"); img.className = "ico-token"; img.src = "assets/" + encodeURI(RES_ART.key); img.alt = "clé"; frag.appendChild(img); }
      else if (p) frag.appendChild(document.createTextNode(p));
    });
    this.swaps++;
    parent.replaceChild(frag, node);
  },
  scan(root) {
    if (!root || !root.isConnected) return;
    if (root.nodeType === 3) { if (this.RE.test(root.nodeValue)) this.swapText(root); return; }
    if (root.nodeType !== 1 || this.SKIP.has(root.nodeName) || !this.RE.test(root.textContent || "")) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found = [];
    while (walker.nextNode()) if (this.RE.test(walker.currentNode.nodeValue)) found.push(walker.currentNode);
    found.forEach((t) => this.swapText(t));
  },
  // Traitement groupe a chaque image (pas dans le rappel de l'observateur).
  enqueue(node) {
    this.queue.add(node);
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      const list = [...this.queue];
      this.queue.clear();
      list.forEach((n) => this.scan(n));
    });
  },
  init() {
    this.scan(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") { if (this.RE.test(m.target.nodeValue || "")) this.enqueue(m.target); }
        else m.addedNodes.forEach((n) => { if ((n.nodeType === 3 || n.nodeType === 1) && this.RE.test(n.textContent || "")) this.enqueue(n); });
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => KeyArt.init()); else KeyArt.init();

// Salle interdite dans « Jouer » : le serveur dit si le joueur y a acces (et
// son adresse) ; le lien est ajoute au menu deja affiche et garde en cache.
async function syncForbiddenNav() {
  if (!Session.isLoggedIn()) return;
  let st;
  try { st = await API.post("forbidden", { userId: Session.userId, action: "status" }); } catch (e) { return; }
  try { if (st.access && st.page) localStorage.setItem("2gatcha_forbidden", st.page); else localStorage.removeItem("2gatcha_forbidden"); } catch (e) { /* stockage indisponible */ }
  const item = forbiddenNavItem();
  const drop = document.querySelector("#nav-group-jouer .nav-group-dropdown");
  if (item && drop && !drop.querySelector(`a[href="${item.href}"]`)) { const ouv = drop.querySelector('a[href="ouverture.html"]'); const html = `<a href="${item.href}" class="${item.href === currentPage() ? "active" : ""}" data-badge-key="">${item.label}</a>`; if (ouv) ouv.insertAdjacentHTML("afterend", html); else drop.insertAdjacentHTML("beforeend", html); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(syncForbiddenNav, 400)); else setTimeout(syncForbiddenNav, 400);

// ---------------------------------------------------------------------------
// Onglet dans l'adresse (2026-10-20) : pour les pages qui ne le faisaient pas
// encore (jeux, communaute, collection, progression, admin et musee gerent
// deja leur #ancre) ; recharger, partager ou revenir garde l'onglet.
// ---------------------------------------------------------------------------
const TabHash = {
  PAGES: {
    "trade.html": { recus: "#tab-incoming-btn", envoyes: "#tab-outgoing-btn" },
    "admin-db.html": { extensions: "#adb-tab-content", images: "#adb-tab-images", tables: "#adb-tab-tables", sauvegardes: "#adb-tab-backups" }
  },
  init() {
    const map = this.PAGES[currentPage()];
    if (!map) return;
    Object.entries(map).forEach(([key, sel]) => {
      const tab = document.querySelector(sel);
      if (tab) tab.addEventListener("click", () => { if (location.hash !== "#" + key) history.replaceState(null, "", location.pathname + location.search + "#" + key); });
    });
    const open = () => { const sel = map[location.hash.slice(1)]; const tab = sel && document.querySelector(sel); if (tab && tab.getAttribute("aria-selected") !== "true") tab.click(); };
    window.addEventListener("hashchange", open);
    // Apres le script de la page (qui pose l'onglet par defaut).
    setTimeout(open, 0);
  }
};

// ---------------------------------------------------------------------------
// Fil d'Ariane (2026-10-20) : Accueil > groupe du menu > page > onglet ouvert,
// en tete du contenu des pages du menu (sauf l'accueil). L'onglet suit les
// changements (aria-selected).
// ---------------------------------------------------------------------------
const Breadcrumb = {
  tabLabel() {
    const main = document.querySelector("main");
    const list = main && [...main.querySelectorAll('[role="tablist"]')].find((l) => l.offsetParent !== null);
    const tab = list && list.querySelector('[role="tab"][aria-selected="true"]');
    if (!tab) return "";
    const copy = tab.cloneNode(true);
    copy.querySelectorAll("[class*='count'], [class*='dot'], [class*='badge'], .sr-only, [aria-hidden='true']").forEach((x) => x.remove());
    return copy.textContent.replace(/\s+/g, " ").trim();
  },
  render() {
    const nav = document.getElementById("breadcrumb");
    if (!nav) return;
    const tab = this.tabLabel();
    const last = nav.querySelector("[data-bc-tab]");
    if (last) { last.textContent = tab; last.hidden = !tab; last.previousElementSibling.hidden = !tab; }
  },
  init() {
    const page = currentPage();
    const item = NAV_ITEMS.find((i) => i.href === page);
    const main = document.querySelector("main");
    if (!item || page === "index.html" || !main || document.getElementById("breadcrumb")) return;
    const group = item.group ? NAV_ITEMS.find((i) => i.group === item.group && i.groupLabel) : null;
    const sep = '<span class="bc-sep" aria-hidden="true">›</span>';
    const nav = document.createElement("nav");
    nav.id = "breadcrumb";
    nav.className = "breadcrumb";
    nav.setAttribute("aria-label", "Fil d'Ariane");
    nav.innerHTML = `<a href="index.html">Accueil</a>${sep}${group ? `<span>${group.groupLabel}</span>${sep}` : ""}<a href="${page}" aria-current="page">${item.label}</a>${sep}<span data-bc-tab></span>`;
    main.prepend(nav);
    this.render();
    new MutationObserver(() => this.render()).observe(main, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
  }
};
document.addEventListener("DOMContentLoaded", () => { TabHash.init(); Breadcrumb.init(); });

// ---------------------------------------------------------------------------
// Accessibilite (2026-10-20), pour toutes les pages :
// - fenetres (role="dialog" aria-modal="true") : le focus y entre a
//   l'ouverture, reste dedans (Tab / Maj+Tab), et revient sur le bouton
//   d'origine a la fermeture ; le reste de la page devient inerte (inert)
//   pendant ce temps (clavier et lecteurs d'ecran) ;
// - onglets (role="tab") : fleches gauche / droite, Debut / Fin ;
// - page sans titre principal visible : un h1 lu par les lecteurs d'ecran.
// ---------------------------------------------------------------------------
const A11y = {
  FOCUSABLE: 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary',
  stack: [],
  visible: (el) => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
  dialogs() { return [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter((d) => this.visible(d)); },
  focusables(root) { return [...root.querySelectorAll(this.FOCUSABLE)].filter((el) => this.visible(el) && !el.closest("[inert]")); },
  sync() {
    const open = this.dialogs();
    // Nouvelles fenetres : on retient d'ou l'on vient et on y entre.
    open.forEach((d) => {
      if (this.stack.some((s) => s.dialog === d)) return;
      this.stack.push({ dialog: d, from: document.activeElement });
      requestAnimationFrame(() => {
        if (d.contains(document.activeElement)) return;
        if (!d.hasAttribute("tabindex")) d.setAttribute("tabindex", "-1");
        d.focus({ preventScroll: true });
      });
    });
    // Fenetres fermees : retour au bouton d'origine.
    this.stack = this.stack.filter((s) => {
      if (open.includes(s.dialog)) return true;
      if (s.from && s.from.isConnected && s.from.focus && !this.dialogs().some((d) => d.contains(document.activeElement))) setTimeout(() => s.from.focus({ preventScroll: true }), 0);
      return false;
    });
    // Le reste de la page inerte tant qu'une fenetre est ouverte (sauf si elle est dedans).
    // Seulement les grandes zones de la page (enfants directs de body), jamais
    // un element d'une fenetre (ex. son <footer>).
    const regions = [document.getElementById("site-header"), document.querySelector("body > main, main#main-content"), document.querySelector(".bottom-nav"), document.querySelector("body > footer")].filter((r) => r && !r.closest('[role="dialog"]'));
    regions.forEach((r) => { r.inert = open.length > 0 && !open.some((d) => r.contains(d)); });
  },
  trap(e) {
    if (e.key !== "Tab" || e.defaultPrevented) return;
    const open = this.dialogs();
    const top = open[open.length - 1];
    if (!top) return;
    const f = this.focusables(top);
    if (!f.length) { e.preventDefault(); top.focus(); return; }
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  },
  tabs(e) {
    if (e.defaultPrevented || !["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const tab = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
    const list = tab && tab.closest('[role="tablist"]');
    if (!list) return;
    const tabs = [...list.querySelectorAll('[role="tab"]')].filter((t) => this.visible(t) && !t.disabled);
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    const next = e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    e.preventDefault();
    next.focus();
    next.click();
  },
  heading() {
    const main = document.querySelector("main");
    if (!main || [...document.querySelectorAll("h1")].some((h) => this.visible(h))) return;
    const h = document.createElement("h1");
    h.className = "sr-only";
    h.textContent = document.title.replace(/^\(\d+\)\s*/, "");
    main.prepend(h);
  },
  init() {
    let queued = false;
    const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; this.sync(); }); };
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-modal", "open"] });
    document.addEventListener("keydown", (e) => this.trap(e));
    document.addEventListener("keydown", (e) => this.tabs(e));
    // Apres le rendu des pages (accueil connecte : le titre du visiteur est masque).
    setTimeout(() => this.heading(), 1500);
  }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => A11y.init()); else A11y.init();

// Rappels personnalises (2026-10-20, js/lazy/reminders.js) : charges sur
// chaque page seulement si le joueur les a actives ; bouton [data-reminders]
// (menu du compte, minuteurs de l'inventaire) pour les regler.
(function () {
  let on = false;
  try { on = !!(JSON.parse(localStorage.getItem("2gatcha_reminders") || "null") || {}).on; } catch (e) { /* stockage indisponible */ }
  const load = () => LazyJs.load("js/lazy/reminders.js");
  if (on && Session.isLoggedIn()) window.addEventListener("load", () => setTimeout(() => load().then(() => Reminders.start()).catch(() => {}), 2500));
  document.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest("[data-reminders]") : null;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    document.getElementById("user-menu")?.classList.remove("open");
    load().then(() => { Reminders.start(); Reminders.openSettings(); }).catch(() => Toast.error("Rappels indisponibles pour le moment."));
  });
})();

// Session rapide (2026-10-20, js/lazy/quick-session.js) : tout bouton
// [data-quick-session] (menu du compte, accueil, carte des jeux) l'ouvre.
document.addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest("[data-quick-session]") : null;
  if (!b) return;
  e.preventDefault();
  document.getElementById("user-menu")?.classList.remove("open");
  LazyJs.load("js/lazy/quick-session.js").then(() => QuickSession.open()).catch(() => Toast.error("Session rapide indisponible pour le moment."));
});

// ---------------------------------------------------------------------------
// Cache hors ligne (2026-10-20, sw.js) : service worker installe sur toutes
// les pages (avant, seulement a l'activation des notifications), une fois la
// page chargee pour ne rien ralentir. Pastille quand le reseau tombe.
// ---------------------------------------------------------------------------
(function () {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  window.addEventListener("load", () => {
    const go = () => navigator.serviceWorker.register("sw.js").catch(() => {});
    if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
  });
})();
(function () {
  const sync = () => {
    let pill = document.getElementById("offline-pill");
    if (navigator.onLine) { if (pill) pill.remove(); return; }
    if (pill) return;
    pill = document.createElement("div");
    pill.id = "offline-pill";
    pill.className = "offline-pill";
    pill.setAttribute("role", "status");
    pill.innerHTML = "&#128225; Hors ligne : les actions reprendront avec la connexion";
    document.body.appendChild(pill);
  };
  window.addEventListener("offline", sync);
  window.addEventListener("online", () => { sync(); if (typeof Toast !== "undefined") Toast.success("Connexion retrouvée."); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync); else sync();
})();

// Rouages et petits secrets (js/lazy/arg.js) : charges seulement sur les
// pages qui en cachent (et sur toutes de 3 h a 4 h, heure de Paris).
(function () {
  const PAGES = ["", "index.html", "nouveautes.html", "coffre.html", "jeux.html", "mode.html", "communaute.html", "404.html"];
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).format(new Date())) % 24;
  const go = () => {
    if (!PAGES.includes(currentPage()) && !document.getElementById("arg-board-host") && hour !== 3) return;
    LazyJs.load("js/lazy/arg.js").catch(() => {});
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
})();

// Changements du DOM (2026-10-21) : un seul observateur, regroupe a 250 ms au
// plus, remplace les sondages permanents (SecretFx toutes les 1,2 s,
// CardAnimGate toutes les secondes, meme sur une page immobile).
const DomChange = {
  subs: [],
  timer: 0,
  on(fn) {
    this.subs.push(fn);
    if (this.subs.length > 1) return;
    new MutationObserver(() => {
      if (this.timer) return;
      this.timer = setTimeout(() => { this.timer = 0; this.subs.forEach((f) => f()); }, 250);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-card-id"] });
  }
};

// ---------------------------------------------------------------------------
// Cartes secretes : effet unique de chaque carte (2026-10-19, choisi dans
// l'admin : Cards.SecretEffect ; GET /webhook/secret-card). Reperage par
// identifiant de carte (data-card-id) : une seule requete ciblee, jamais un
// balayage de toutes les images. Fourrure / contour : un anneau statique
// pose sur le bord de la carte. Glitch : une seule horloge pour toutes les
// cartes concernees, en pause quand l'onglet est cache.
// ---------------------------------------------------------------------------
const SecretFx = {
  data: null,
  KEY: "2gatcha_secretfx",
  selector: "",
  byId: new Map(),
  glitchHosts: new Set(),
  async load() {
    try { const c = JSON.parse(sessionStorage.getItem(this.KEY) || "null"); if (c && Date.now() - c.at < 10 * 60000) { this.data = c.data; return; } } catch (e) { /* stockage indisponible */ }
    try { this.data = await API.get("secretCard"); } catch (e) { this.data = null; return; }
    try { sessionStorage.setItem(this.KEY, JSON.stringify({ at: Date.now(), data: this.data })); } catch (e) { /* stockage indisponible */ }
  },
  // Element « carte » : celui qui porte data-card-id (collection, coffre,
  // fenetre de carte, machine, cinematiques).
  apply() {
    if (!this.selector) return;
    document.querySelectorAll(this.selector).forEach((card) => {
      if (card.dataset.sfx) return;
      const effect = this.byId.get(card.dataset.cardId);
      if (!effect) return;
      card.dataset.sfx = effect;
      if (effect === "glitch") {
        // Le glitch reste dans l'illustration.
        const img = card.querySelector("img");
        const host = img ? img.parentElement : null;
        if (!host) return;
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        host.classList.add("gl404-host");
        img.dataset.gl404 = "1";  // active le decalage de l'image (gl404Shift)
        const fx = document.createElement("div");
        fx.className = "gl404";
        fx.setAttribute("aria-hidden", "true");
        fx.innerHTML = "<span></span><span></span><span></span>";
        host.appendChild(fx);
        this.glitchHosts.add(host);
        return;
      }
      if (getComputedStyle(card).position === "static") card.style.position = "relative";
      const ring = document.createElement("i");
      ring.className = "sfx-ring";
      ring.setAttribute("aria-hidden", "true");
      card.appendChild(ring);
    });
  },
  // Une seule horloge : a chaque tic, une carte glitchee au hasard s'affole.
  glitchLoop() {
    const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const others = (this.data.others || []).map((id) => API.imageUrl(id)).filter(Boolean);
    const tick = () => {
      setTimeout(tick, (reduced ? 4000 : 1200) + Math.random() * 2400);
      if (document.hidden) return;
      for (const h of this.glitchHosts) if (!h.isConnected) this.glitchHosts.delete(h);
      this.glitchHosts.forEach((host) => {
        const r = host.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;  // hors ecran : rien
        if (others.length) host.querySelectorAll(".gl404 span").forEach((s) => {
          const top = Math.random() * 80;
          s.style.backgroundImage = `url("${others[Math.floor(Math.random() * others.length)]}")`;
          s.style.top = top + "%";
          s.style.height = 6 + Math.random() * 22 + "%";
          s.style.backgroundPosition = `${Math.random() * 100}% ${top}%`;
          s.style.transform = `translateX(${(Math.random() - 0.5) * 18}%)`;
        });
        host.classList.add("gl404-on");
        setTimeout(() => host.classList.remove("gl404-on"), 140 + Math.random() * 240);
      });
    };
    setTimeout(tick, 800);
  },
  async init() {
    await this.load();
    const effects = (this.data && this.data.effects) || [];
    if (!effects.length) return;
    effects.forEach((e) => this.byId.set(String(e.cardId), e.effect));
    this.selector = [...this.byId.keys()].map((id) => `[data-card-id="${id}"]`).join(",");
    this.apply();
    DomChange.on(() => this.apply());
    if ([...this.byId.values()].includes("glitch")) this.glitchLoop();
  }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => SecretFx.init()); else SecretFx.init();

// ---------------------------------------------------------------------------
// Fluidite (2026-10-19) : les animations des cartes (brillances, holo, lueurs,
// badges) s'arretent des qu'une carte sort de l'ecran. Une collection en
// faisait tourner environ 200 en permanence, meme hors de la vue.
// ---------------------------------------------------------------------------
const CardAnimGate = {
  SEL: ".collection-card, .craft-card, .card, .album-owned, .pv-mini, .fm-card, .ux-card",
  seen: typeof WeakSet !== "undefined" ? new WeakSet() : null,
  io: null,
  scan() {
    document.querySelectorAll(this.SEL).forEach((el) => {
      if (this.seen.has(el)) return;
      this.seen.add(el);
      this.io.observe(el);
    });
  },
  init() {
    if (!("IntersectionObserver" in window) || !this.seen) return;
    this.io = new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle("anim-off", !e.isIntersecting)), { rootMargin: "150px 0px" });
    this.scan();
    DomChange.on(() => this.scan());
  }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => CardAnimGate.init()); else CardAnimGate.init();
