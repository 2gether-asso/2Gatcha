// Module charge a la demande par shell-extras.js (LazyJs.load, core.js).
// Rouages caches et petits secrets du site (ARG).

// ---------------------------------------------------------------------------
// Rouages (2026-10-19) : dix petits rouages graves sont caches sur le
// site. Chacun porte une lettre (donnee par le serveur au clic). Rien ne dit
// ou ils menent… sauf peut-etre les pages perdues.
// ---------------------------------------------------------------------------
const Gears = {
  SPOTS: [
    { n: 1, page: "nouveautes.html", sel: "#patch-notes > :last-child" },
    { n: 2, page: "coffre.html", sel: "#museum-zone" },
    { n: 3, page: "jeux.html", sel: ".dig-site[data-depth='5']" },
    { n: 4, page: "jeux.html", sel: "#fish-scene[data-spot='deep']" },
    { n: 5, page: "404.html", sel: "#arg-board-host" },
    { n: 6, page: "mode.html", sel: "#main-content > .panel" },
    { n: 7, page: "jeux.html", sel: "#fish-aquarium-wrap[open]" },
    { n: 9, page: "communaute.html", sel: "#machine-room" },
    { n: 10, page: "jeux.html", sel: "#dino-dex-box[open]" }
  ],
  ROMAN: ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"],
  page() { return currentPage() === "" ? "index.html" : (document.getElementById("arg-board-host") ? "404.html" : currentPage()); },
  make(n) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "arg-gear";
    b.dataset.gear = String(n);
    b.setAttribute("aria-label", "Un rouage gravé");
    b.innerHTML = `<span class="arg-gear-ico" aria-hidden="true">&#9881;&#65039;</span><span class="arg-gear-n">${this.ROMAN[n - 1]}</span>`;
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this.take(n, b); });
    return b;
  },
  async take(n, el) {
    if (!Session.isLoggedIn()) { Toast.info("Un rouage gravé… mais il faut être connecté pour le garder."); return; }
    try {
      const r = await API.post("forbidden", { userId: Session.userId, action: "gear", n });
      el.classList.add("taken");
      if (typeof Sfx !== "undefined" && Sfx._tone) { Sfx._tone(520, 0, 0.08, "square", 0.04); Sfx._tone(780, 0.08, 0.12, "square", 0.04); }
      if (typeof Haptics !== "undefined") Haptics.buzz([15, 30, 15]);
      Toast.success(`&#9881;&#65039; Rouage gravé <strong>${r.roman}</strong> : la lettre <strong>« ${r.letter} »</strong>. (${r.found} / ${r.total})`);
      if (r.fresh && r.found === 1) setTimeout(() => Toast.info("Dix rouages, dix lettres. Les pages perdues savent les assembler…"), 1600);
      if (r.found === r.total && r.fresh) setTimeout(() => Toast.info("Les dix rouages tournent ensemble. Le mot qu’ils forment se réclame."), 1600);
    } catch (e) { /* rouage muet */ }
  },
  place() {
    const page = this.page();
    for (const s of this.SPOTS) {
      if (s.page !== page) continue;
      const host = document.querySelector(s.sel);
      if (!host || host.querySelector(".arg-gear")) continue;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.appendChild(this.make(s.n));
    }
  },
  // Code Konami sur l'accueil : un rouage tombe du ciel. Au clavier, ou au
  // doigt sur mobile (glisses haut, haut, bas, bas, gauche, droite, gauche,
  // droite, puis deux touchers).
  konami() {
    const SEQ = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    let i = 0;
    const drop = () => {
      if (document.querySelector(".arg-gear-fall")) return;
      const g = this.make(8);
      g.classList.add("arg-gear-fall");
      document.body.appendChild(g);
    };
    document.addEventListener("keydown", (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      i = k === SEQ[i] ? i + 1 : (k === SEQ[0] ? 1 : 0);
      if (i < SEQ.length) return;
      i = 0;
      drop();
    });
    const SWIPES = ["up", "up", "down", "down", "left", "right", "left", "right", "tap", "tap"];
    let j = 0, sx = 0, sy = 0, st = 0;
    document.addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
    document.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy, ad = Math.max(Math.abs(dx), Math.abs(dy));
      if (Date.now() - st > 900) { j = 0; return; }
      const g = ad < 12 ? "tap" : ad < 40 ? null : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      if (!g) return;
      j = g === SWIPES[j] ? j + 1 : (g === SWIPES[0] ? 1 : 0);
      if (j < SWIPES.length) return;
      j = 0;
      drop();
    }, { passive: true });
  },
  // Page 404 : le tableau ou les lettres trouvees prennent leur place.
  async board() {
    const host = document.getElementById("arg-board-host");
    if (!host || !Session.isLoggedIn()) return;
    let st;
    try { st = await API.post("forbidden", { userId: Session.userId, action: "status" }); } catch (e) { return; }
    if (!st.gears || !st.gears.length) return;
    const by = new Map(st.gears.map((g) => [g.n, g.letter]));
    host.insertAdjacentHTML("afterbegin", `<div class="arg-board"><p>Dix rouages, dix lettres. Le mot qu'ils forment est le nom d'une page qu'aucun menu ne montre.</p>
      <div class="arg-slots">${this.ROMAN.map((r, i) => `<span class="arg-slot ${by.has(i + 1) ? "on" : ""}"><b>${by.get(i + 1) || "?"}</b><small>${r}</small></span>`).join("")}</div></div>`);
  },
  init() {
    if (this.page() === "index.html") this.konami();
    this.board();
    if (!this.SPOTS.some((s) => s.page === this.page())) return;
    this.place();
    // Contenus charges plus tard (onglets, details ouverts, profondeur…).
    setInterval(() => this.place(), 1500);
  }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => Gears.init()); else Gears.init();

// ---------------------------------------------------------------------------
// Petits secrets du site (2026-10-19, api/src/native/secrets.js).
// ---------------------------------------------------------------------------
const SiteSecrets = {
  parisHour() { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).format(new Date())) % 24; },
  // Page 404 : une carte qui n'existe pas…
  ghost404() {
    const host = document.getElementById("arg-board-host");
    const hi = host && host.closest(".panel") ? host.closest(".panel").querySelector(".hero-highlight") : null;
    if (!hi) return;
    let n = 0, last = 0;
    hi.addEventListener("click", async () => {
      const t = Date.now();
      n = t - last < 1500 ? n + 1 : 1;
      last = t;
      hi.classList.remove("sx-blip"); void hi.offsetWidth; hi.classList.add("sx-blip");
      if (n < 7) return;
      n = 0;
      if (!Session.isLoggedIn()) return;
      try {
        const r = await API.post("secrets", { userId: Session.userId, action: "ghost404" });
        UnlockFx.show({ title: r.title, subtitle: "Elle n'aurait jamais dû exister.", cards: r.cards, tone: "ghost" });
      } catch (e) { if (e.code === "already_found") Toast.info("La page se souvient de toi."); }
    });
  },
  // De 3 h a 4 h : le site se deforme, une ombre traverse l'accueil.
  shadow() {
    if (this.parisHour() !== 3) return;
    document.documentElement.dataset.shadowHour = "1";
    if (currentPage() !== "index.html" || !Session.isLoggedIn()) return;
    const sh = document.createElement("button");
    sh.type = "button";
    sh.className = "sx-shadow";
    sh.setAttribute("aria-label", "Une ombre");
    sh.innerHTML = '<span class="sx-eye"></span><span class="sx-eye"></span>';
    document.body.appendChild(sh);
    sh.addEventListener("click", async () => {
      sh.disabled = true;
      try {
        const r = await API.post("secrets", { userId: Session.userId, action: "shadow" });
        sh.classList.add("caught");
        setTimeout(() => sh.remove(), 900);
        UnlockFx.show({ title: r.title, subtitle: "Il est tard. Tu aurais dû dormir.", rewards: r.rewards, tone: "shadow" });
      } catch (e) { sh.classList.add("caught"); setTimeout(() => sh.remove(), 900); }
    });
  },
  init() { this.ghost404(); this.shadow(); }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => SiteSecrets.init()); else SiteSecrets.init();
