// Jeux V2 « Le village » (2026-11-15) : l'ecran d'entree de la page Jeux.
//  - Tournee : tout ce qui est pret (jardin, trouvailles et cacas des dinos,
//    dinos rentres de balade, expedition, trouvaille de Milo, rapports de
//    Noisette et Pistache) se recupere d'un bouton, avec un bilan unique.
//  - Lieux : l'etat de chaque jeu (pret, en cours, a faire) et un acces direct.
//  - Compagnons : Milo, Moka, Noisette et Pistache au meme endroit, avec leur
//    travail restant sur 24 h et de quoi les remettre au travail.
//  - Sac : les ressources des jeux, a quoi elles servent et ou en trouver.
// Rien de nouveau cote serveur : la tournee enchaine les actions habituelles
// (memes regles, memes annonces) ; les lectures passent par le lot du gabarit.
(function () {
  if (typeof Session === "undefined" || !Session.isLoggedIn()) return;
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const uid = () => Session.userId;
  const settled = (p) => (p && p.then ? p.then((v) => v, () => null) : Promise.resolve(null));
  const now = () => Date.now() / 1000;
  const plural = (n, one, many) => `${fmtNum(n)} ${n > 1 ? many : one}`;
  const left = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, "0")}` : `${Math.max(1, m)} min`; };
  const hoursTxt = (min) => (min >= 60 ? `${String(Math.round((min / 60) * 10) / 10).replace(".", ",")} h` : `${min} min`);
  const tabShown = (tab) => { const b = $(`tab-${tab}-btn`); return !!b && getComputedStyle(b).display !== "none"; };
  const go = (tab) => { if (typeof setActiveTab === "function") setActiveTab(tab); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const mask = (t) => (window.PetText ? PetText.mask(t) : t);
  const adopted = (pet) => !(typeof StarterLocks !== "undefined" && StarterLocks.pets && StarterLocks.pets[pet] === false);

  let d = {}, busy = false, loading = null;

  // ------------------------------------------------------------ donnees
  async function fetchAll() {
    const u = uid();
    const [dig, garden, fish, archeo, dino, expe, dogGift, walk, cook, guess, pets] = await Promise.all([
      settled(API.getDigStatus(u)), settled(API.garden(u)), settled(API.fishing(u, "status")), settled(API.archeo(u)),
      settled(API.dino(u)), settled(API.expedition(u, "status")), settled(API.dogGift(u)), settled(API.walk(u)),
      settled(API.cook(u)), settled(API.guessCard(u, "status")), settled(API.pets(u))
    ]);
    return { dig, garden, fish, archeo, dino, expe, dogGift, walk, cook, guess, pets };
  }
  function load() {
    if (loading) return loading;
    loading = fetchAll().then((x) => { d = x; render(); }).finally(() => { loading = null; });
    return loading;
  }

  // ------------------------------------------------------------ tournee
  // Ce qui se recupere tout seul (une ligne par action, dans l'ordre).
  function tourTasks() {
    const t = [];
    const living = (d.dino && d.dino.unlocked && d.dino.dinos ? d.dino.dinos : []).filter((x) => !x.dead);
    if (d.garden && d.garden.readyCount > 0) t.push({ key: "garden", icon: "&#127803;", label: `Récolter ${plural(d.garden.readyCount, "parcelle", "parcelles")}`, run: () => API.garden(uid(), "harvest") });
    const finds = living.reduce((s, x) => s + (x.finds || 0), 0);
    if (finds) t.push({ key: "dinoFinds", icon: "&#129430;", label: `Trouvailles des dinos (${finds})`, run: () => API.dino(uid(), "collect") });
    const poops = living.reduce((s, x) => s + (x.poops || 0) + (x.goldPoops || 0), 0);
    if (poops) t.push({ key: "dinoPoop", icon: "&#129529;", label: `Ramasser ${plural(poops, "caca", "cacas")} de dino`, run: () => API.dino(uid(), "clean") });
    living.filter((x) => x.walkUntil && x.walkUntil <= now()).forEach((x) => t.push({ key: "dinoWalk", icon: "&#129429;", label: `${esc(x.name)} rentre de balade`, run: () => API.dino(uid(), "walk-back", { dino: x.id }) }));
    const ex = d.expe && d.expe.expedition;
    if (ex && ex.active && ex.ready) t.push({ key: "expe", icon: "&#129517;", label: "L'explorateur est rentré", run: () => API.expedition(uid(), "claim") });
    if (d.dogGift && d.dogGift.available && adopted("milo")) t.push({ key: "dogGift", icon: "&#128021;", label: "Trouvaille du jour de Milo", run: () => API.dogGift(uid(), "claim") });
    if (d.garden && d.garden.bunny && d.garden.bunny.pending && adopted("noisette")) t.push({ key: "bunny", icon: "&#128007;", label: mask("Rapport de Noisette"), run: () => API.garden(uid(), "status", { takeReport: true }) });
    t.push({ key: "mole", silent: true, icon: "&#129428;", label: mask("Rapport de Pistache"), run: () => API.archeo(uid(), "status", { takeReport: true }) });
    return t;
  }

  // Gains lisibles (cles des reponses des jeux).
  const GAIN = {
    dust: ["&#10024;", "poussière", "poussières"], boosters: [resIcon("token") || "&#127183;", "jeton booster", "jetons booster"], keys: [resIcon("key"), "clé", "clés"],
    worms: [resIcon("worm"), "ver", "vers"], bait: [resIcon("bait"), "appât doré", "appâts dorés"], bones: [resIcon("bone"), "os", "os"], bone: [resIcon("bone"), "os", "os"],
    skulls: [resIcon("skull"), "crâne", "crânes"], parts: [resIcon("part"), "pièce détachée", "pièces détachées"], catFish: ["&#128031;", "poisson pour Moka", "poissons pour Moka"],
    fish: ["&#128031;", "poisson", "poissons"], grubs: ["&#128027;", "ver blanc", "vers blancs"], veg: ["&#129388;", "légume", "légumes"], herb: ["&#127807;", "herbe", "herbes"],
    mush: ["&#127812;", "champignon", "champignons"], fruit: ["&#129389;", "fruit exotique", "fruits exotiques"], honey: ["&#127855;", "pot de miel", "pots de miel"],
    coins: [resIcon("coin"), "pièce de gatchapon", "pièces de gatchapon"], xp: ["&#11088;", "XP", "XP"]
  };
  const gainBits = (o) => Object.entries(o || {}).filter(([k, n]) => GAIN[k] && Number(n) > 0).map(([k, n]) => `${GAIN[k][0]} +${mask(plural(Number(n), GAIN[k][1], GAIN[k][2]))}`);

  // Une ligne de bilan par reponse.
  function lineOf(task, r) {
    if (!r) return null;
    if (task.key === "garden") return gainBits(r.gained).join(" · ") || "Récolte faite";
    if (task.key === "dinoFinds") return gainBits(r.loot).join(" · ") || "Trouvailles ramassées";
    if (task.key === "dinoPoop") return `${POOP} +${r.collected || 0} engrais${r.collectedGold ? ` · ${GOLD_POOP} +${r.collectedGold} doré${r.collectedGold > 1 ? "s" : ""}` : ""}`;
    if (task.key === "dinoWalk") { const w = r.walked || {}; return [...gainBits({ dust: w.dust, worms: w.worms, bones: w.bone }), w.food ? `${w.food.icon} +${w.food.n} ${esc(w.food.label.toLowerCase())}` : ""].filter(Boolean).join(" · "); }
    if (task.key === "expe") { const rw = r.reward || {}; return gainBits(rw).join(" · ") || "Récompense récupérée"; }
    if (task.key === "dogGift") return r.gift ? `${r.gift.icon || ""} ${esc(r.gift.label)}` : "Trouvaille récupérée";
    if (task.key === "bunny") { const b = r.bunnyReport; return b ? `${plural(b.harvests || 0, "parcelle récoltée", "parcelles récoltées")}${b.replanted ? `, ${b.replanted} replantée${b.replanted > 1 ? "s" : ""}` : ""}${gainBits(b.gained).length ? " · " + gainBits(b.gained).join(" · ") : ""}` : null; }
    if (task.key === "mole") { const m = r.moleReport; return m && m.jobs ? `${plural(m.jobs, "tâche", "tâches")}${(m.freed || []).length ? ` · ${plural(m.freed.length, "trouvaille libérée", "trouvailles libérées")}` : ""}${(m.dug || []).length ? ` · ${plural(m.dug.length, "tablette grattée", "tablettes grattées")}` : ""}` : null; }
    return null;
  }

  async function runTour(btn) {
    if (busy) return;
    const tasks = tourTasks();
    if (!tasks.some((t) => !t.silent)) { Toast.info("Rien à récupérer pour l'instant : tout pousse et tout le monde travaille."); return; }
    busy = true;
    btn.disabled = true;
    const lines = [];
    let i = 0;
    for (const task of tasks) {
      i++;
      btn.innerHTML = `<span class="spinner qs-spin"></span> Tournée… ${i}/${tasks.length}`;
      try {
        const r = await task.run();
        const line = lineOf(task, r);
        if (line) lines.push({ icon: task.icon, label: task.label, line });
        if (r && r.levelUp && typeof LevelUpModal !== "undefined" && task.key === "garden") LevelUpModal.show({ icon: "&#127793;", name: "Jardin", level: r.levelUp, perks: [] });
      } catch (e) {
        // Deja recupere ailleurs (Noisette, autre onglet) : on passe, sans erreur.
        if (!task.silent) lines.push({ icon: task.icon, label: task.label, line: `<span class="muted">${esc(friendlyError(e))}</span>`, miss: true });
      }
    }
    busy = false;
    bilan(lines);
    if (typeof refreshStatus === "function") refreshStatus();
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    window.dispatchEvent(new CustomEvent("api:claimed", { detail: { name: "village" } }));
    await load();
  }

  function bilan(lines) {
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay vg-bilan-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Bilan de la tournée");
    overlay.innerHTML = `
      <div class="vg-bilan">
        <div class="vg-bilan-head"><span aria-hidden="true">&#127969;</span><div><strong>Tournée terminée</strong><small>${lines.filter((l) => !l.miss).length ? "Tout est rangé dans ton sac." : "Rien de neuf cette fois."}</small></div></div>
        <ul>${lines.map((l) => `<li class="${l.miss ? "miss" : ""}"><span class="vg-bilan-ico" aria-hidden="true">${l.icon}</span><div><b>${l.label}</b><span>${l.line}</span></div></li>`).join("")}</ul>
        <button type="button" class="btn" data-vg-close>Parfait !</button>
      </div>`;
    const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest("[data-vg-close]")) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    overlay.querySelector("[data-vg-close]").focus();
    if (lines.some((l) => !l.miss) && typeof confetti === "function" && !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) confetti({ particleCount: 70, spread: 80, origin: { y: 0.6 } });
  }

  // ------------------------------------------------------------ lieux
  // Etat de chaque jeu : { tab, icon, name, text, hot, wait (secondes) }.
  function places() {
    const out = [];
    const add = (tab, icon, name, text, hot = false, wait = 0) => { if (tabShown(tab)) out.push({ tab, icon, name, text, hot, wait }); };
    const g = d.dig;
    if (g) add("dig", "&#9935;&#65039;", "Fouille", `Énergie ${g.energy}/${g.maxEnergy}`, g.energy >= g.maxEnergy, g.energy < g.maxEnergy ? g.secondsUntilNext || 0 : 0);
    const f = d.fish;
    if (f) add("fish", "&#127907;", "Pêche", f.energy == null ? `${f.worms} vers` : `Énergie ${f.energy}/${f.maxEnergy} · ${f.worms} vers`, f.energy > 0 && f.worms >= (f.cost || 1));
    const ga = d.garden;
    if (ga) {
      const empty = ga.plots.filter((p) => !p.planted).length;
      const next = ga.plots.filter((p) => p.planted && !p.ready).map((p) => p.readyAt - now()).sort((a, b) => a - b)[0];
      add("garden", "&#127793;", "Jardin", ga.readyCount ? `${plural(ga.readyCount, "parcelle prête", "parcelles prêtes")}` : empty ? `${plural(empty, "parcelle vide", "parcelles vides")}` : "Ça pousse", !!ga.readyCount || !!empty, ga.readyCount ? 0 : next || 0);
    }
    const a = d.archeo;
    if (a) {
      const blocks = (a.finds || []).length, tabs = (a.stock || []).reduce((s, k) => s + (k.count || 0), 0);
      add("archeo", "&#127994;", "Archéologie", a.tablet ? "Une tablette est ouverte" : blocks ? `${plural(blocks, "bloc à nettoyer", "blocs à nettoyer")}` : tabs ? `${plural(tabs, "tablette", "tablettes")} en réserve` : "Rien à gratter", !!(a.tablet || blocks || tabs));
    }
    const c = d.cook;
    if (c && c.enabled) {
      const can = (c.recipes || []).filter((r) => r.can).length;
      const orders = ((c.orders && c.orders.list) || []).filter((o) => !o.done).length;
      add("cook", "&#127858;", "Cuisine", orders ? `${plural(orders, "commande", "commandes")} du jour` : can ? `${plural(can, "plat possible", "plats possibles")}` : "Garde-manger à remplir", !!(orders && can));
    }
    const di = d.dino;
    if (di && di.unlocked) {
      const living = (di.dinos || []).filter((x) => !x.dead);
      const hungry = living.filter((x) => x.food < 40).length;
      add("dino", "&#129430;", "Dinos", hungry ? `${plural(hungry, "dino a faim", "dinos ont faim")}` : `${plural(living.length, "dino", "dinos")} en forme`, !!hungry);
    }
    const w = d.walk;
    if (w && w.enabled && (w.pets || []).length) add("walk", "&#128062;", "Promenade", w.left ? `${plural(w.left, "balade à faire", "balades à faire")}` : "À demain", !!w.left);
    const ex = d.expe && d.expe.expedition;
    if (ex) add("expedition", "&#129517;", "Expédition", ex.active ? (ex.ready ? "L'explorateur est rentré" : "En route") : "Explorateur disponible", !ex.active || !!ex.ready, ex.active && !ex.ready ? ex.secondsLeft || 0 : 0);
    if (d.guess) add("guess", "&#10067;", "Devine la carte", d.guess.played ? "Jouée aujourd'hui" : "Devinette du jour", !d.guess.played);
    add("bingo", "&#127922;", "Bingo", "Grille du mois");
    add("vault", "&#128274;", "Cage de Pepper", "Cadenas à ouvrir");
    return out;
  }

  // ------------------------------------------------------------ compagnons
  // Travail restant sur 24 h (plafond du serveur), nourriture, geste rapide.
  function pets() {
    const love = Object.fromEntries(((d.pets && d.pets.pets) || []).map((p) => [p.pet, p]));
    const list = [];
    if (d.dig && adopted("milo")) {
      const g = d.dig;
      list.push({ pet: "milo", icon: "&#128021;", name: "Milo", job: "creuse à la fouille", tab: "dig", secs: g.dogSecondsLeft || 0, max: 24 * 3600, food: g.bones || 0, foodIcon: resIcon("bone"), foodName: ["os", "os"], per: 120,
        tired: g.dogTiredSecondsLeft || 0, room: Math.floor((24 * 3600 - (g.dogSecondsLeft || 0)) / 7200) });
    }
    const cat = d.fish && d.fish.cat;
    if (cat && adopted("moka")) {
      const byDay = cat.dailyFish > 0 ? cat.dailyFish - cat.fedToday : Infinity;
      list.push({ pet: "moka", icon: "&#128008;", name: "Moka", job: "pêche à ta place", tab: "fish", secs: cat.secondsLeft || 0, max: (cat.maxMinutes || 240) * 60, food: cat.fish || 0, foodIcon: "&#128031;", foodName: ["poisson", "poissons"], per: cat.minutesPerFish || 30,
        room: Math.min(byDay, Math.floor(((cat.maxMinutes || 240) * 60 - (cat.secondsLeft || 0)) / ((cat.minutesPerFish || 30) * 60))) });
    }
    const b = d.garden && d.garden.bunny;
    if (b && adopted("noisette")) list.push({ pet: "noisette", icon: "&#128007;", name: "Noisette", job: "récolte et replante le jardin", tab: "garden", secs: b.secondsLeft || 0, max: (b.maxMinutes || 1440) * 60, food: b.carrots || 0, foodIcon: "&#129365;", foodName: ["carotte", "carottes"], per: b.minutesPerCarrot || 60,
      room: Math.floor(((b.maxMinutes || 1440) * 60 - (b.secondsLeft || 0)) / ((b.minutesPerCarrot || 60) * 60)) });
    const m = d.archeo && d.archeo.mole;
    if (m && adopted("pistache")) list.push({ pet: "pistache", icon: "&#129428;", name: "Pistache", job: "nettoie les blocs de l'atelier", tab: "archeo", secs: m.secondsLeft || 0, max: (m.maxMinutes || 1440) * 60, food: m.grubs || 0, foodIcon: "&#128027;", foodName: ["ver blanc", "vers blancs"], per: m.minutesPerGrub || 60,
      room: Math.floor(((m.maxMinutes || 1440) * 60 - (m.secondsLeft || 0)) / ((m.minutesPerGrub || 60) * 60)) });
    list.forEach((p) => { p.love = love[p.pet] || null; p.can = Math.max(0, Math.min(p.food, p.room)); });
    return list;
  }
  const FEED = {
    milo: async (n) => { for (let i = 0; i < n; i++) await API.useBone(uid()); },
    moka: (n) => API.catFeed(uid(), n),
    noisette: (n) => API.garden(uid(), "bunnyFeed", { count: n }),
    pistache: (n) => API.archeo(uid(), "moleFeed", { count: n })
  };
  const FEED_ERR = {
    no_bone: "Il te faut un os.", dog_max_time: "Milo a déjà assez de travail.", dog_tired: "Milo se repose.", no_cat_fish: "Plus de poisson pour Moka.", cat_max_time: "Moka a déjà assez de travail.",
    no_carrot: "Plus de carottes.", bunny_max_time: "Noisette a déjà assez de travail.", no_grub: "Plus de vers blancs.", mole_max_time: "Pistache a déjà assez de travail."
  };
  async function feed(pet, n, btn) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      await FEED[pet](n);
      const p = pets().find((x) => x.pet === pet);
      Toast.success(mask(`${p ? p.icon + " " + p.name : ""} se met au travail : +${hoursTxt(n * (p ? p.per : 60))} !`));
    } catch (e) {
      Toast.error(FEED_ERR[e.code] || friendlyError(e));
    }
    busy = false;
    await load();
  }

  // ------------------------------------------------------------ sac
  const BAG_INFO = {
    carrot: { name: "Carottes", use: "Font travailler Noisette au jardin.", where: "Fouille, promenade dans la prairie, boutique." },
    grub: { name: "Vers blancs", use: "Font travailler Pistache à l'atelier d'archéologie.", where: "Jardin, promenade dans les ruines, boutique." },
    catFish: { name: "Poissons pour Moka", use: "Font pêcher Moka à ta place.", where: "Pêche (espèces de l'aquarium), jardin (herbe à chat), boutique." },
    poop: { name: "Engrais", use: "Au jardin : pousse plus rapide et récolte doublée.", where: "Les cacas de tes dinos." }
  };
  function bag() {
    const g = d.garden || {}, dino = d.dino || {}, food = dino.food || {}, cat = (d.fish && d.fish.cat) || {};
    const items = [
      ["worm", resIcon("worm"), g.worms ?? (d.fish && d.fish.worms)], ["bait", resIcon("bait"), g.goldBait], ["bone", resIcon("bone"), d.dig && d.dig.bones],
      ["carrot", "&#129365;", g.bunny && g.bunny.carrots], ["grub", "&#128027;", g.grubs ?? (d.archeo && d.archeo.mole && d.archeo.mole.grubs)], ["catFish", "&#128031;", cat.fish],
      ["poop", POOP, g.fertilizer], ["skull", resIcon("skull"), dino.unlocked ? dino.skulls : null],
      ["fish", resIcon("fish"), dino.unlocked ? food.fish : null], ["seaweed", resIcon("seaweed"), dino.unlocked ? food.seaweed : null], ["shrimp", resIcon("shrimp"), dino.unlocked ? food.shrimp : null]
    ].filter(([, , n]) => n != null);
    return items.map(([k, icon, n]) => { const info = BAG_INFO[k] || RES_INFO[k] || {}; return { k, icon, n: Number(n) || 0, name: mask(info.name || k), use: mask(info.use || ""), where: mask(info.where || "") }; });
  }

  // ------------------------------------------------------------ rendu
  function render() {
    const pane = $("village-pane");
    if (!pane) return;
    const tasks = tourTasks().filter((t) => !t.silent);
    const tour = $("vg-tour");
    tour.innerHTML = `
      <div class="vg-tour-text"><h2>&#127969; Ma tournée</h2>
        <p>${tasks.length ? `${plural(tasks.length, "chose t'attend", "choses t'attendent")} dans le village.` : "Rien à récupérer pour l'instant : tout pousse et tout le monde travaille."}</p>
        ${tasks.length ? `<ul class="vg-tour-list">${tasks.slice(0, 6).map((t) => `<li><span aria-hidden="true">${t.icon}</span> ${t.label}</li>`).join("")}${tasks.length > 6 ? `<li class="muted">et ${tasks.length - 6} de plus</li>` : ""}</ul>` : ""}
      </div>
      <button type="button" class="btn vg-tour-btn" id="vg-tour-btn" ${tasks.length && !busy ? "" : "disabled"}>${tasks.length ? `Faire ma tournée (${tasks.length})` : "Tout est fait"}</button>`;
    tour.classList.toggle("ready", !!tasks.length);

    const pl = places();
    $("vg-places").innerHTML = `<h2 class="vg-h">Les lieux</h2><div class="vg-grid">${pl.map((p) => `
      <button type="button" class="vg-place ${p.hot ? "hot" : ""}" data-vg-go="${p.tab}">
        <span class="vg-place-ico" aria-hidden="true">${p.icon}</span>
        <span class="vg-place-txt"><b>${esc(p.name)}</b><small>${p.text}</small>${p.wait > 0 ? `<em data-countdown-to="${Math.round(now() + p.wait)}" data-countdown-done="prêt"></em>` : ""}</span>
        ${p.hot ? `<span class="vg-dot" aria-label="À faire"></span>` : ""}
      </button>`).join("")}</div>`;

    const pe = pets();
    $("vg-pets").innerHTML = pe.length ? `<h2 class="vg-h">Les compagnons <small>24 h de travail au plus</small></h2><div class="vg-pets">${pe.map((p) => {
      const pct = Math.min(100, Math.round((p.secs / p.max) * 100));
      const state = p.tired > 0 ? `Se repose encore ${left(p.tired)}` : p.secs > 0 ? `Travaille encore ${left(p.secs)}` : "Au repos";
      return `<div class="vg-pet ${p.secs > 0 ? "working" : ""}">
        <button type="button" class="vg-pet-pic" data-vg-go="${p.tab}" title="Aller voir ${esc(p.name)}" aria-label="Aller voir ${esc(p.name)}">${p.icon}${p.love ? `<span class="vg-pet-mood" title="${esc(p.love.mood.label)} (${p.love.love}/100)">${p.love.mood.icon}</span>` : ""}</button>
        <div class="vg-pet-body">
          <div class="vg-pet-top"><b>${esc(mask(p.name))}</b><small>${esc(mask(p.job))}</small></div>
          <div class="vg-gauge" role="img" aria-label="${pct} % de 24 h"><span style="width:${pct}%"></span></div>
          <small class="vg-pet-state">${state} · ${p.foodIcon} ${p.food}</small>
          <div class="vg-pet-acts">
            <button type="button" class="btn-secondary" data-vg-feed="${p.pet}" data-n="1" ${p.can >= 1 && !p.tired ? "" : "disabled"}>+${hoursTxt(p.per)}</button>
            ${p.can >= 2 && !p.tired ? `<button type="button" class="btn-ghost" data-vg-feed="${p.pet}" data-n="${p.can}">Remplir (+${hoursTxt(p.can * p.per)})</button>` : ""}
          </div>
        </div>
      </div>`;
    }).join("")}</div>` : "";

    const items = bag();
    $("vg-bag").innerHTML = items.length ? `<h2 class="vg-h">Mon sac</h2><div class="vg-bag">${items.map((it) => `
      <details class="vg-item ${it.n ? "" : "empty"}"><summary><span class="vg-item-ico" aria-hidden="true">${it.icon}</span><b>${fmtNum(it.n)}</b><span>${esc(it.name)}</span></summary>
        <p>${esc(it.use)}${it.where ? `<br><span class="muted">Où en trouver : ${esc(it.where)}</span>` : ""}</p></details>`).join("")}</div>` : "";
  }

  // ------------------------------------------------------------ evenements
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#village-pane")) {
      const back = e.target.closest("[data-vg-back]");
      if (back) go("village");
      return;
    }
    const t = e.target.closest("#vg-tour-btn");
    if (t && !t.disabled) { runTour(t); return; }
    const f = e.target.closest("[data-vg-feed]");
    if (f && !f.disabled) { feed(f.dataset.vgFeed, Number(f.dataset.n) || 1, f); return; }
    const g = e.target.closest("[data-vg-go]");
    if (g) go(g.dataset.vgGo);
  });
  // Intro d'un jeu repliee sur telephone (css/village.css) : un tap la deplie.
  document.addEventListener("click", (e) => {
    const lead = e.target.closest("[id$='-pane'] > p.lead");
    if (lead && document.body.classList.contains("jeux-in-game") && !e.target.closest("a, button")) lead.classList.toggle("open");
  });
  // « ← Village » en tete de chaque jeu.
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("#main-content [id$='-pane']").forEach((p) => {
      if (p.id === "village-pane" || p.querySelector(":scope > .vg-back")) return;
      p.insertAdjacentHTML("afterbegin", `<button type="button" class="vg-back" data-vg-back>&#8592; Village</button>`);
    });
  });
  // A jour apres une action ailleurs sur la page, et toutes les 2 minutes.
  window.addEventListener("api:claimed", (e) => { if (e.detail && e.detail.name === "village") return; if ($("village-pane") && $("village-pane").style.display !== "none") setTimeout(load, 600); });
  setInterval(() => { if (!document.hidden && $("village-pane") && $("village-pane").style.display !== "none" && !busy) load(); }, 120000);

  // « plus » seulement quand l'intro repliee est vraiment coupee.
  function markLeads() {
    document.querySelectorAll("#main-content [id$='-pane'] > p.lead").forEach((p) => { if (!p.classList.contains("open")) p.classList.toggle("clamp-more", p.scrollHeight > p.clientHeight + 2); });
  }
  window.addEventListener("resize", () => requestAnimationFrame(markLeads));

  window.Village = { load, markLeads };
})();
