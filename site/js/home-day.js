// Accueil V2 « Ma journee » (2026-11-15) : en tete de l'accueil connecte, la
// date et trois tuiles d'action, dans l'ordre ou on s'en sert :
//  - Recompenses : le compte du centre de recompenses ; la tuile lance
//    « Tout recuperer » (meme bouton, shell.js RewardsCenter) ;
//  - Village : ce qui est pret au village (memes regles que la tournee de
//    js/village.js) ; la tuile mene a la tournee ;
//  - Boosters : le solde de jetons ; la tuile mene a l'ouverture.
// Les lectures passent par le lot du gabarit (shell.js, PAGE_READS.index).
(function () {
  if (typeof Session === "undefined" || !Session.isLoggedIn()) return;
  const $ = (id) => document.getElementById(id);
  const uid = () => Session.userId;
  const settled = (p) => (p && p.then ? p.then((v) => v, () => null) : Promise.resolve(null));
  const adopted = (pet) => !(typeof StarterLocks !== "undefined" && StarterLocks.pets && StarterLocks.pets[pet] === false);
  const st = { rewards: null, village: null, boosters: null };

  // Pret au village : meme liste que tourTasks() de js/village.js (a garder alignee).
  async function loadVillage() {
    const u = uid();
    const [garden, dino, expe, dogGift] = await Promise.all([settled(API.garden(u)), settled(API.dino(u)), settled(API.expedition(u, "status")), settled(API.dogGift(u))]);
    let n = 0;
    if (garden && garden.readyCount > 0) n++;
    const living = dino && dino.unlocked ? (dino.dinos || []).filter((x) => !x.dead) : [];
    if (living.some((x) => x.finds > 0)) n++;
    if (living.some((x) => (x.poops || 0) + (x.goldPoops || 0) > 0)) n++;
    n += living.filter((x) => x.walkUntil && x.walkUntil <= Date.now() / 1000).length;
    const ex = expe && expe.expedition;
    if (ex && ex.active && ex.ready) n++;
    if (dogGift && dogGift.available && adopted("milo")) n++;
    if (garden && garden.bunny && garden.bunny.pending && adopted("noisette")) n++;
    st.village = n;
  }
  async function loadBoosters() {
    const s = await settled(API.getBoosterStatus(uid()));
    st.boosters = s ? Number(s.count) || 0 : null;
  }
  // Compte du centre de recompenses : lu sur son bouton « Tout recuperer (7) ».
  function readRewards() {
    const b = $("rc-claim-all");
    if (!b || b.hidden || b.disabled) { st.rewards = 0; return; }
    const m = /\((\d+)\)/.exec(b.textContent);
    st.rewards = m ? Number(m[1]) : 1;
  }

  const DATE = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  function render() {
    const band = $("day-band");
    if (!band) return;
    const r = st.rewards, v = st.village, b = st.boosters;
    const tile = (key, icon, n, unit, cta, hot, href) => {
      const inner = `<span class="day-tile-ico" aria-hidden="true">${icon}</span>
        <span class="day-tile-txt"><b>${n == null ? "…" : fmtNum(n)}</b> <span>${unit}</span></span>
        <em class="day-tile-cta">${cta}</em>`;
      return href ? `<a class="day-tile ${hot ? "hot" : ""}" href="${href}" data-day="${key}">${inner}</a>` : `<button type="button" class="day-tile ${hot ? "hot" : ""}" data-day="${key}" ${hot ? "" : "disabled"}>${inner}</button>`;
    };
    band.hidden = false;
    band.innerHTML = `
      <div class="day-head"><span class="day-eyebrow">Ma journée</span><span class="day-date">${DATE.format(new Date())}</span></div>
      <div class="day-tiles">
        ${tile("rewards", "&#127873;", r, r === 1 ? "récompense" : "récompenses", r ? "Tout récupérer" : "Rien à récupérer", !!r)}
        ${tile("village", "&#127969;", v, v === 1 ? "chose prête au village" : "choses prêtes au village", v ? "Faire ma tournée" : "Aller au village", !!v, "jeux.html#village")}
        ${tile("boosters", "&#127183;", b, b === 1 ? "booster à ouvrir" : "boosters à ouvrir", b ? "Ouvrir" : "En gagner", !!b, b ? "ouverture.html" : "jeux.html#village")}
      </div>`;
    document.querySelector(".hero-panel")?.classList.add("has-day-band");
  }

  async function refresh() {
    readRewards();
    render();
    await Promise.all([loadVillage(), loadBoosters()]);
    readRewards();
    render();
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("#day-band [data-day='rewards']");
    if (!t || t.disabled) return;
    const b = $("rc-claim-all");
    if (b && !b.hidden && !b.disabled) b.click();
  });
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("day-band")) return;
    refresh();
    // Le centre de recompenses se met a jour seul : la tuile suit son bouton.
    const rc = $("rc-claim-all");
    if (rc) new MutationObserver(() => { readRewards(); render(); }).observe(rc, { attributes: true, childList: true, characterData: true, subtree: true });
    let t = null;
    window.addEventListener("api:claimed", () => { clearTimeout(t); t = setTimeout(refresh, 800); });
  });
})();
