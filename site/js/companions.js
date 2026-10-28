// Compagnons du jardin et de l'archeologie, promenade et cuisine (2026-10-30).
//  - Noisette la lapine (jardin, api garden.js) : contre des carottes, elle
//    recolte et replante les parcelles pretes ; coin #garden-bunny.
//  - Pistache le herisson (archeologie, api archeo.js) : contre des vers
//    blancs, il nettoie les blocs bruts et gratte les tablettes ; #archeo-mole.
//    Leurs rapports arrivent en carte postale a la visite (takeReport).
//  - Promenade (api walk.js) : onglet #walk-pane, une balade par jour et par compagnon.
//  - Cuisine du village (api cooking.js) : onglet #cook-pane, plats a bonus.
// jeux.js appelle Companions.garden(etat) a chaque rendu du jardin et
// archeo.js Companions.archeo(etat) ; les onglets appellent loadWalk / loadCook.

(function () {
  const esc = escHtml;
  const uid = () => Session.userId;
  const reduced = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const hours = (min) => String(Math.round((min / 60) * 10) / 10).replace(".", ",");
  const left = (s) => { const t = Math.ceil(s / 60), h = Math.floor(t / 60), m = t % 60; return `${h ? h + " h " : ""}${String(m).padStart(h ? 2 : 1, "0")} min`; };
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const bump = () => { if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); };
  const petsReload = () => { if (window.PetLove) PetLove.load(); };

  // ---------------------------------------------------------- carte postale
  function postcard({ pic, stamp = "&#128062;", title, intro, lines, empty, sign, ps, btn }) {
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay dog-postcard-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", title);
    overlay.innerHTML = `
      <div class="dog-postcard pet-postcard">
        <div class="dog-postcard-stamp" aria-hidden="true">${stamp}</div>
        <div class="dog-postcard-pic" aria-hidden="true">${pic}</div>
        <div class="dog-postcard-text">
          <div class="dog-postcard-title">${title}</div>
          <p>${intro}</p>
          ${lines.length ? `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>` : `<p>${empty}</p>`}
          <div class="dog-postcard-sign">${sign}</div>
          ${ps ? `<p class="cat-postcard-ps">${ps}</p>` : ""}
        </div>
        <button type="button" class="btn dog-postcard-close">${btn}</button>
      </div>`;
    const close = () => { overlay.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest(".dog-postcard-close")) close(); });
    document.body.appendChild(overlay);
    if (typeof syncScrollLock === "function") syncScrollLock();
    overlay.querySelector(".dog-postcard-close").focus();
    bump();
  }

  const GAIN = {
    worms: ["&#129713;", "ver", "vers"], bait: ["&#10024;", "appât doré", "appâts dorés"], dust: ["&#10024;", "poussière", "poussières"],
    catFish: ["&#128031;", "poisson pour Moka", "poissons pour Moka"], bones: ["&#129460;", "os", "os"], skulls: ["&#128128;", "crâne de dino", "crânes de dino"],
    parts: ["&#128297;", "pièce détachée", "pièces détachées"], grubs: ["&#128027;", "ver blanc", "vers blancs"],
    veg: ["&#129388;", "légume", "légumes"], herb: ["&#127807;", "herbe", "herbes"], mush: ["&#127812;", "champignon", "champignons"]
  };
  const gainLines = (g) => Object.entries(g || {}).filter(([k, n]) => GAIN[k] && n > 0).map(([k, n]) => `${GAIN[k][0]} ${PetText.mask(plural(n, GAIN[k][1], GAIN[k][2]))}`);

  function bunnyPostcard(r) {
    if (!r || !r.harvests) return;
    const lines = gainLines(r.gained);
    if (r.loveGift) lines.push(`${r.loveGift.icon} un petit cadeau pour toi : ${esc(r.loveGift.label)} ❤️`);
    postcard({
      pic: "&#128007;&#127793;", stamp: "&#129365;", title: "Des nouvelles du potager !",
      intro: `Pendant ton absence, j'ai récolté <strong>${plural(r.harvests, "parcelle", "parcelles")}</strong>${r.replanted ? ` et replanté ${plural(r.replanted, "fois", "fois")} (${r.spent} &#10024; de graines)` : ""}${r.done ? ", et j'ai fini mes carottes" : ""}.`,
      lines, empty: "Rien de bien gros… mais tout est propre !", sign: "Ta lapine, Noisette &#128062;",
      ps: r.wilted ? `P.S. ${plural(r.wilted, "plante avait", "plantes avaient")} déjà fané avant mon arrivée.` : "", btn: "Merci Noisette !"
    });
  }
  const STATE_TXT = { intact: "intacte", scratched: "rayée", cracked: "fissurée", broken: "cassée" };
  function molePostcard(r) {
    if (!r || !r.jobs) return;
    const lines = [];
    (r.dug || []).forEach((d) => lines.push(`${d.icon} ${esc(d.label)} grattée : ${d.found}/${d.total} trouvaille${d.total > 1 ? "s" : ""} extraite${d.found > 1 ? "s" : ""}`));
    (r.freed || []).forEach((f) => lines.push(`${f.img ? `<img class="ico-token" src="assets/${esc(f.img)}" alt="" />` : f.icon || "&#127994;"} ${esc(f.name)} (${STATE_TXT[f.state] || f.state})${f.amount ? ` ×${f.amount}` : ""}${f.dust ? ` · +${f.dust} &#10024;` : ""}`));
    if (r.loveGift) lines.push(`${r.loveGift.icon} un petit cadeau pour toi : ${esc(r.loveGift.label)} ❤️`);
    postcard({
      pic: "&#129428;&#127994;", stamp: "&#128027;", title: "Rapport du chantier !",
      intro: `J'ai travaillé <strong>${plural(r.jobs, "fois", "fois")}</strong>${r.done ? " et j'ai fini mes vers blancs" : ""}.`,
      lines, empty: "Je n'ai rien trouvé à gratter.", sign: "Ton hérisson, Pistache &#128062;",
      ps: r.idle ? `P.S. ${plural(r.idle, "fois", "fois")}, il n'y avait plus rien à gratter : rapporte-moi des tablettes !` : "", btn: "Merci Pistache !"
    });
  }

  // ---------------------------------------------------------- coins
  const CORNERS = {
    noisette: {
      box: "garden-bunny", food: "&#129365;", one: "carotte", many: "carottes", count: "carrots", per: "minutesPerCarrot",
      busy: "récolte tes parcelles prêtes et replante la même graine (payée en poussières)",
      idle: "1 carotte = {m} de travail : elle récolte tes parcelles dès qu'elles sont prêtes, et replante la même graine si tu as les poussières pour les graines.",
      none: "Noisette travaille contre des carottes : carottes sauvages de la fouille, promenade dans la prairie, ou botte de carottes à la boutique.",
      feed: (n) => API.garden(uid(), "bunnyFeed", { count: n }),
      after: (res) => { if (typeof renderGarden === "function") renderGarden(res); },
      reload: () => { if (typeof loadGarden === "function") loadGarden(); },
      err: { no_carrot: "Plus de carottes : fouille, promène-toi dans la prairie ou passe à la boutique.", bunny_max_time: "Noisette a déjà assez de travail devant elle." }
    },
    pistache: {
      box: "archeo-mole", food: "&#128027;", one: "ver blanc", many: "vers blancs", count: "grubs", per: "minutesPerGrub",
      busy: "nettoie tes blocs bruts, puis gratte les tablettes de ta réserve",
      idle: "1 ver blanc = {m} de travail : une tâche toutes les {j} min environ (nettoyer un bloc brut, sinon gratter une tablette). Il ne touche pas aux blocs que tu as commencés.",
      none: "Pistache travaille contre des vers blancs : on en trouve en récoltant le jardin, en promenade dans les ruines, ou en bocal à la boutique.",
      feed: (n) => API.archeo(uid(), "moleFeed", { count: n }),
      after: () => { if (window.loadArcheo) window.loadArcheo(); },
      reload: () => { if (window.loadArcheo) window.loadArcheo(); },
      err: { no_grub: "Plus de vers blancs : récolte le jardin, promène-toi dans les ruines ou passe à la boutique.", mole_max_time: "Pistache a déjà assez de travail devant lui." }
    }
  };
  const timers = {};
  function renderCorner(pet, v) {
    const c = CORNERS[pet];
    const box = document.getElementById(c.box);
    if (!box || !v) return;
    box.hidden = false;
    clearInterval(timers[pet]);
    const have = Number(v[c.count]) || 0;
    const per = Number(v[c.per]) || 60;
    const room = Math.floor((v.maxMinutes * 60 - v.secondsLeft) / (per * 60));
    const can = Math.max(0, Math.min(have, room));
    const active = v.secondsLeft > 0;
    box.dataset.working = active ? "1" : "0";
    box.querySelector("[data-pc-count]").textContent = have ? plural(have, c.one, c.many) : "";
    const b1 = box.querySelector("[data-pc-feed]");
    b1.disabled = can < 1;
    b1.innerHTML = active ? `${c.food} +${hours(per)} h de travail` : `${c.food} Mettre au travail (${hours(per)} h)`;
    const bm = box.querySelector("[data-pc-feedmax]");
    bm.hidden = can < 2;
    bm.dataset.count = String(can);
    bm.innerHTML = `+${hours(can * per)} h de travail (${plural(can, c.one, c.many)})`;
    const text = box.querySelector("[data-pc-text]");
    if (active) {
      let rem = v.secondsLeft;
      const draw = () => { text.innerHTML = `<strong class="pet-work">Travaille encore ${left(rem)}</strong> · ${c.busy}. Reviens voir ce qu'${pet === "noisette" ? "elle" : "il"} a fait 🐾`; };
      draw();
      timers[pet] = setInterval(() => { rem -= 30; if (rem <= 0) { clearInterval(timers[pet]); c.reload(); return; } draw(); }, 30000);
    } else {
      text.innerHTML = `<strong class="pet-work idle">Au repos</strong> · ${have ? c.idle.replace("{m}", `${hours(per)} h`).replace("{j}", v.jobMinutes || 40) : c.none}`;
    }
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-pc-feed], [data-pc-feedmax]");
    if (!b) return;
    const box = b.closest(".pet-corner");
    const pet = box && box.id === "garden-bunny" ? "noisette" : "pistache";
    const c = CORNERS[pet];
    const n = b.hasAttribute("data-pc-feedmax") ? Number(b.dataset.count) || 1 : 1;
    b.disabled = true;
    try {
      const res = await c.feed(n);
      Toast.success(`${pet === "noisette" ? "&#128007; Noisette" : "&#129428; Pistache"} se met au travail : +${hours(n * (pet === "noisette" ? res.bunny : res.mole)[c.per])} h !`);
      // Le rendu du jardin montre aussi le rapport (Companions.garden).
      c.after(res);
      bump();
    } catch (err) {
      b.disabled = false;
      Toast.error(c.err[err.code] || friendlyError(err));
    }
  });

  // ---------------------------------------------------------- promenade
  let walkSt = null, walkPet = null, walkBusy = false;
  async function loadWalk() {
    const zone = document.getElementById("walk-zone");
    if (!zone) return;
    try { walkSt = await API.walk(uid()); } catch (e) { zone.innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; return; }
    renderWalk();
  }
  function renderWalk(result) {
    const zone = document.getElementById("walk-zone");
    const st = walkSt;
    if (!zone || !st) return;
    if (!st.enabled) { zone.innerHTML = `<div class="empty-state">Les promenades sont en pause pour l'instant.</div>`; return; }
    if (!st.pets.length) { zone.innerHTML = `<div class="empty-state">&#128062; Tu n'as pas encore de compagnon à promener. Ils viendront à toi en jouant…</div>`; return; }
    const free = st.pets.filter((p) => !p.walked);
    if (!walkPet || !st.pets.some((p) => p.pet === walkPet && !p.walked)) walkPet = (free[0] || st.pets[0]).pet;
    const cur = st.pets.find((p) => p.pet === walkPet);
    const placeOf = (k) => st.places.find((p) => p.key === k);
    zone.innerHTML = `
      <div class="walk-sky ${st.night ? "night" : "day"}" aria-hidden="true"><span class="walk-orb"></span>${st.night ? "<i></i><i></i><i></i><i></i><i></i>" : ""}</div>
      <h3 class="walk-h">Qui vient se promener ? <small class="muted">${free.length ? `${plural(free.length, "balade", "balades")} encore aujourd'hui` : "tout le monde s'est promené aujourd'hui, à demain !"}</small></h3>
      <div class="walk-pets" role="radiogroup" aria-label="Compagnon">
        ${st.pets.map((p) => `<button type="button" role="radio" class="walk-pet ${p.pet === walkPet ? "on" : ""} ${p.walked ? "done" : ""}" data-walk-pet="${p.pet}" aria-checked="${p.pet === walkPet}">
          <span class="walk-pet-ico" aria-hidden="true">${p.icon}</span>
          <span class="walk-pet-body"><strong>${esc(p.label)}</strong><small>${p.walked ? `&#9989; ${esc((placeOf(p.walked) || {}).label || "promené")}` : `&#10084;&#65039; ${p.love}/100 · aime ${esc((placeOf(p.fav) || { label: "tout" }).label.replace(/^(La|Le|Les|L’) /, "").toLowerCase())}`}</small></span>
        </button>`).join("")}
      </div>
      ${result || ""}
      <h3 class="walk-h">Où aller ?</h3>
      <div class="walk-places">
        ${st.places.map((pl) => {
          const fav = cur && cur.fav === pl.key;
          const off = !pl.open || !cur || !!cur.walked || walkBusy;
          return `<div class="walk-place place-${pl.key} ${pl.open ? "" : "closed"} ${fav ? "fav" : ""}">
            <span class="walk-place-ico" aria-hidden="true">${pl.icon}</span>
            <strong>${esc(pl.label)}</strong>
            <small>${esc(pl.desc)}</small>
            ${fav ? `<span class="walk-fav">&#11088; Lieu préféré de ${esc(cur.label)} : ×${String(st.favMult).replace(".", ",")}</span>` : ""}
            ${pl.night ? `<span class="walk-night">${pl.open ? "&#127769; Ouverte cette nuit" : "&#127769; S'ouvre à la nuit tombée"}</span>` : ""}
            <button type="button" class="btn${fav ? "" : "-secondary"}" data-walk-go="${pl.key}" ${off ? "disabled" : ""}>${cur && cur.walked ? "Déjà promené" : pl.open ? "Partir en balade" : "Fermée"}</button>
          </div>`;
        }).join("")}
      </div>`;
  }
  async function goWalk(place) {
    if (walkBusy) return;
    walkBusy = true;
    renderWalk();
    const pet = walkSt.pets.find((p) => p.pet === walkPet);
    try {
      const res = await API.walk(uid(), "go", { pet: walkPet, place });
      walkSt = res;
      const w = res.walk;
      // Petite balade animee avant le resultat.
      const zone = document.getElementById("walk-zone");
      if (!reduced() && zone) {
        const trip = document.createElement("div");
        trip.className = `walk-trip place-${place}`;
        trip.innerHTML = `<span class="walk-trip-pet">${pet.icon}</span><span class="walk-trip-place">${w.placeIcon}</span>`;
        zone.prepend(trip);
        await new Promise((r) => setTimeout(r, 1700));
      }
      walkBusy = false;
      const items = w.items.map((it) => `<span class="walk-loot">${it.img ? `<img class="ico-token" src="assets/${esc(it.img)}" alt="" />` : it.icon} +${it.n} ${esc(it.label)}</span>`).join("");
      renderWalk(`<div class="walk-result" role="status">
        <div class="walk-result-title">${w.icon} ${esc(w.story)} ${w.placeIcon}</div>
        <div class="walk-result-loot">${items}</div>
        <small>&#10084;&#65039; +${w.love} d'affection${w.fav ? " · son lieu préféré : trouvailles doublées !" : ""}</small>
      </div>`);
      Toast.success(`${w.icon} ${esc(w.label)} rentre de promenade !`);
      petsReload();
      bump();
    } catch (e) {
      walkBusy = false;
      Toast.error({ already_walked: "Il s'est déjà promené aujourd'hui.", place_closed: "La clairière ne s'ouvre que la nuit.", walk_closed: "Les promenades sont en pause." }[e.code] || friendlyError(e));
      if (e.data && e.data.places) walkSt = e.data;
      renderWalk();
    }
  }

  // ---------------------------------------------------------- cuisine
  let cookSt = null, cookBusy = false;
  async function loadCook() {
    const zone = document.getElementById("cook-zone");
    if (!zone) return;
    try { cookSt = await API.cook(uid()); } catch (e) { zone.innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; return; }
    renderCook();
  }
  const WHERE = { veg: "graine Potager du jardin, prairie", herb: "Potager, prairie, forêt", berry: "forêt, clairière", mush: "forêt, clairière, champignon lumineux", honey: "prairie, clairière", fish: "pêche (aquarium), sardines", carrot: "fouille, prairie, boutique" };
  function renderCook() {
    const zone = document.getElementById("cook-zone");
    const st = cookSt;
    if (!zone || !st) return;
    if (!st.enabled) { zone.innerHTML = `<div class="empty-state">Les fourneaux sont éteints pour l'instant.</div>`; return; }
    const active = st.buffs.filter((b) => b.until);
    zone.innerHTML = `
      <div class="cook-pantry" aria-label="Garde-manger">
        <strong class="cook-h">&#129387; Garde-manger</strong>
        ${st.ingredients.map((i) => `<span class="cook-ing ${i.n ? "" : "empty"}" title="${esc(i.label)} : ${esc(PetText.mask(WHERE[i.key] || ""))}"><span aria-hidden="true">${i.icon}</span> <strong>${i.n}</strong> <small>${esc(i.label.toLowerCase())}</small></span>`).join("")}
      </div>
      <div class="cook-buffs">${active.length ? active.map((b) => `<span class="cook-buff">${b.icon} ${esc(b.text)} · <span data-countdown-to="${b.until}" data-countdown-done="terminé"></span></span>`).join("") : `<span class="muted">Aucun plat en cours : cuisine quelque chose pour un bonus !</span>`}</div>
      <div class="cook-stove ${cookBusy ? "cooking" : ""}" aria-hidden="true"><span class="cook-pot">&#127858;</span><span class="cook-steam"><i></i><i></i><i></i></span></div>
      <div class="cook-recipes">
        ${st.recipes.map((r) => `<div class="cook-recipe ${r.can ? "can" : ""}">
          <span class="cook-recipe-ico" aria-hidden="true">${r.icon}</span>
          <div class="cook-recipe-body">
            <strong>${esc(r.label)}</strong>
            <small>${esc(r.desc)}</small>
            <span class="cook-effect">${esc(r.effectText)} · ${String(r.hours).replace(".", ",")} h</span>
            <span class="cook-needs">${r.needs.map((n) => `<span class="cook-need ${n.have >= n.n ? "ok" : "miss"}" title="${esc(n.label)} : ${n.have}/${n.n}">${n.icon} ${n.have}/${n.n}</span>`).join("")}</span>
          </div>
          <button type="button" class="btn${r.can ? "" : "-secondary"}" data-cook="${esc(r.key)}" ${r.can && !cookBusy ? "" : "disabled"}>Cuisiner</button>
        </div>`).join("")}
      </div>
      <p class="muted cook-foot">Bonus au plus ${st.maxHours} h devant toi par effet. Les ingrédients viennent du jardin (graine Potager), des promenades et de la pêche.</p>`;
  }
  async function cook(key) {
    if (cookBusy) return;
    cookBusy = true;
    const r0 = cookSt.recipes.find((r) => r.key === key);
    renderCook();
    // Les ingredients tombent dans la marmite.
    const stove = document.querySelector("#cook-zone .cook-stove");
    if (stove && r0 && !reduced()) {
      r0.needs.forEach((n, k) => { const d = document.createElement("span"); d.className = "cook-drop"; d.textContent = n.icon; d.style.setProperty("--dx", `${(k - r0.needs.length / 2) * 22}px`); d.style.animationDelay = `${k * 140}ms`; stove.appendChild(d); });
    }
    try {
      const [res] = await Promise.all([API.cook(uid(), "cook", { recipe: key }), new Promise((r) => setTimeout(r, reduced() ? 0 : 1300))]);
      cookSt = res;
      cookBusy = false;
      renderCook();
      Toast.success(`${res.cooked.icon} ${esc(res.cooked.label)} : ${esc(res.cooked.effectText)} pendant ${String(res.cooked.hours).replace(".", ",")} h !`);
      if (typeof confetti === "function" && !reduced()) confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
      if (res.cooked.effect === "pets" || res.cooked.effect === "all") petsReload();
    } catch (e) {
      cookBusy = false;
      if (e.data && e.data.recipes) cookSt = e.data;
      renderCook();
      Toast.error({ missing_ingredients: "Il manque des ingrédients.", cook_closed: "Les fourneaux sont éteints." }[e.code] || friendlyError(e));
    }
  }

  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-walk-pet]");
    if (p) { walkPet = p.dataset.walkPet; renderWalk(); return; }
    const g = e.target.closest("[data-walk-go]");
    if (g && !g.disabled) { goWalk(g.dataset.walkGo); return; }
    const c = e.target.closest("[data-cook]");
    if (c && !c.disabled) cook(c.dataset.cook);
  });

  let lastBunny = null, lastMole = null;
  window.Companions = {
    garden(st) {
      if (!st) return;
      if (st.bunny) renderCorner("noisette", st.bunny);
      if (st.bunnyReport && st.bunnyReport !== lastBunny) { lastBunny = st.bunnyReport; bunnyPostcard(st.bunnyReport); }
    },
    archeo(st) {
      if (!st) return;
      if (st.mole) renderCorner("pistache", st.mole);
      if (st.moleReport && st.moleReport !== lastMole) { lastMole = st.moleReport; molePostcard(st.moleReport); }
    },
    loadWalk, loadCook
  };
})();
