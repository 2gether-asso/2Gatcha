// Cuisine du village, V2 (2026-11-06, api/src/native/cooking.js) : onglet
// #cook-pane de la page Jeux (appele par Companions.loadCook).
//  - Marmite libre : on y met des ingredients du garde-manger (3 sortes, 4
//    avec le chaudron) ; une combinaison exacte donne une recette, parfois
//    cachee (elle s'inscrit au carnet), sinon un ragout douteux et un indice.
//  - Cuisson a point : la jauge monte, on retire du feu dans la zone verte ;
//    le serveur mesure le temps et donne la qualite (0 a 3 etoiles).
//    Cuisson rapide : qualite « correct », mangee tout de suite.
//  - Onglets : menu, carnet, commandes du jour, plats gardes, ustensiles.
(() => {
  const esc = escHtml;
  const fmt = fmtNum;
  const $ = (id) => document.getElementById(id);
  const uid = () => Session.userId;
  const reduced = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const tone = (f, d, len, type = "triangle", v = 0.04) => { if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(f, d, len, type, v); };
  const stars = (q) => `<span class="ck-stars" aria-label="${q} étoile${q > 1 ? "s" : ""} sur 3">${"&#9733;".repeat(Math.max(0, q))}${"&#9734;".repeat(Math.max(0, 3 - q))}</span>`;
  const ago = (at) => { const h = Math.max(0, (Date.now() / 1000 - at) / 3600); return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${Math.floor(h)} h`; };
  const hours = (h) => (h >= 1 ? `${String(Math.round(h * 10) / 10).replace(".", ",")} h` : `${Math.round(h * 60)} min`);
  const WHERE = {
    veg: "graine Potager du jardin, prairie", herb: "Potager, prairie, forêt", berry: "forêt, clairière", mush: "forêt, clairière, champignon lumineux", honey: "prairie, clairière",
    fruit: "graine tropicale, mode Chill", fish: "pêche (aquarium), sardines", carrot: "fouille, prairie, boutique",
    egg: "butin des dinos", truffle: "coups de pelle à la fouille (rare)", salt: "moulin à épices (Calcaire)", spice: "moulin à épices (herbes)", rarefish: "prises rares à la pêche", flower: "récoltes du jardin",
    almond: "Nouvel an", cocoa: "Saint-Valentin et Pâques", coconut: "Fête de la musique", pumpkin: "Halloween", chestnut: "Noël"
  };
  const ERR = {
    missing_ingredients: "Il manque des ingrédients.", cook_closed: "Les fourneaux sont éteints.", pot_too_small: "Mets au moins deux ingrédients dans la marmite.",
    pot_too_many: "La marmite est pleine : pas plus de sortes d'ingrédients.", needs_level: "Tu n'as pas encore le savoir-faire pour ce plat.", needs_tool: "Il te faudrait un ustensile pour ça…",
    no_special_slot: "Tu as déjà assez de bonus spéciaux en cours : attends qu'un se termine.", dishes_full: "Ton garde-manger de plats est plein : mange ou livre un plat d'abord.",
    no_session: "La cuisson a refroidi : recommence.", wrong_dish: "Ce n'est pas le plat commandé.", not_good_enough: "Le client veut un plat mieux réussi.", no_order: "Commande déjà livrée.",
    not_enough_dust: "Pas assez de poussières.", not_enough_parts: "Pas assez de pièces détachées.", not_enough_minerals: "Pas assez de Calcaire.", max_level: "Ustensile déjà au maximum.", no_dish: "Ce plat n'est plus là."
  };
  const errText = (e) => ERR[e.code] || friendlyError(e);
  let st = null, busy = false, tab = "menu", result = null, game = null;
  const pot = new Map();

  async function load() {
    const zone = $("cook-zone");
    if (!zone) return;
    try { st = await API.cook(uid()); } catch (e) { zone.innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; return; }
    if (st.spoiled) Toast.info(`&#129314; ${st.spoiled} plat${st.spoiled > 1 ? "s se sont gâtés" : " s'est gâté"} dans le garde-manger.`);
    render();
  }
  const ing = (k) => st.ingredients.find((i) => i.key === k) || { key: k, icon: "❔", label: k, n: 0 };
  const potNeeds = () => Object.fromEntries([...pot].filter(([, n]) => n > 0));

  function render() {
    const zone = $("cook-zone");
    if (!zone || !st) return;
    if (!st.enabled) { zone.innerHTML = `<div class="empty-state">Les fourneaux sont éteints pour l'instant.</div>`; return; }
    const lv = st.level;
    const pct = lv.next ? Math.round(((lv.xp - lv.current) / Math.max(1, lv.next - lv.current)) * 100) : 100;
    const active = st.buffs.filter((b) => b.until);
    zone.innerHTML = `
      ${st.season ? `<div class="ck-season">${st.season.icon} ${esc(st.season.label)} : recettes de saison au menu, et ${st.season.ingredient.icon} ${esc(st.season.ingredient.label.toLowerCase())} à trouver en jouant.</div>` : ""}
      <div class="ck-top">
        <div class="ck-chef"><span class="ck-hat" aria-hidden="true">&#129489;&#8205;&#127859;</span><div><strong>Cuisinier niv. ${lv.level}</strong><div class="ck-bar"><div style="width:${pct}%"></div></div><small class="muted">${lv.next ? `${fmt(lv.xp - lv.current)} / ${fmt(lv.next - lv.current)} XP` : "Niveau max"}${lv.level < 10 && lv.perks[lv.level + 1] ? ` · prochain : ${esc(lv.perks[lv.level + 1])}` : ""}</small></div></div>
        <div class="ck-meal" title="Entrée, plat et dessert mangés dans l'heure : tous tes bonus en cours sont prolongés.">${st.meal.map((m) => `<span class="${m.at ? "on" : ""}">${m.at ? "&#10004;" : "&#9675;"} ${esc(m.label)}</span>`).join("")}</div>
      </div>
      <div class="cook-buffs">${active.length || st.luck ? [...active.map((b) => `<span class="cook-buff ${b.special ? "special" : ""}">${b.icon} ${esc(b.text)}${b.power && b.power !== 1 ? ` <b>×${String(b.power).replace(".", ",")}</b>` : ""} · <span data-countdown-to="${b.until}" data-countdown-done="terminé"></span></span>`), st.luck ? `<span class="cook-buff special">&#127808; ${st.luck} charge${st.luck > 1 ? "s" : ""} de chance</span>` : ""].join("") : `<span class="muted">Aucun plat en cours : cuisine quelque chose pour un bonus !</span>`}
        <small class="muted ck-slots">Bonus spéciaux : ${st.specialActive}/${st.specialSlots}</small></div>
      <div class="cook-pantry" aria-label="Garde-manger">
        <strong class="cook-h">&#129387; Garde-manger</strong>
        ${st.ingredients.map((i) => `<button type="button" class="cook-ing ${i.n ? "" : "empty"}" data-add="${i.key}" ${i.n ? "" : "disabled"} title="${esc(i.label)} : ${esc(PetText.mask(WHERE[i.key] || ""))}${i.n ? " · clique pour l'ajouter à la marmite" : ""}"><span aria-hidden="true">${i.icon}</span> <strong>${i.n}</strong> <small>${esc(i.label.toLowerCase())}</small></button>`).join("")}
      </div>
      <div class="ck-kitchen">
        <div class="ck-potzone">
          <div class="cook-stove ${busy ? "cooking" : ""}" id="ck-stove" aria-hidden="true"><span class="cook-pot">&#127858;</span><span class="cook-steam"><i></i><i></i><i></i></span><span class="ck-fire"></span></div>
          <div class="ck-pot" id="ck-pot">${potHtml()}</div>
          <div class="ck-game" id="ck-game" hidden></div>
          <div class="ck-result" id="ck-result" aria-live="polite">${result ? resultHtml() : ""}</div>
        </div>
      </div>
      <div class="ck-tabs" role="tablist">${[["menu", "&#128214; Menu"], ["book", "&#128221; Carnet"], ["orders", `&#128718;&#65039; Commandes${st.orders.list.filter((o) => !o.done).length ? ` <b>${st.orders.list.filter((o) => !o.done).length}</b>` : ""}`], ["dishes", `&#127857; Plats <b>${st.dishes.length}</b>`], ["tools", "&#129520; Ustensiles"]].map(([k, l]) => `<button type="button" role="tab" class="ck-tab ${tab === k ? "on" : ""}" aria-selected="${tab === k}" data-tab="${k}">${l}</button>`).join("")}</div>
      <div class="ck-pane" id="ck-pane">${paneHtml()}</div>
      <p class="muted cook-foot">Bonus au plus ${st.maxHours} h devant toi par effet. Mets des ingrédients dans la marmite au hasard : certaines combinaisons cachent des recettes.</p>`;
  }

  function potHtml() {
    const entries = [...pot].filter(([, n]) => n > 0);
    const slots = Array.from({ length: st.potKinds }, (_, i) => entries[i]);
    return `
      <div class="ck-slots-row">${slots.map((e) => e ? `<div class="ck-slot"><span class="ck-slot-ico">${ing(e[0]).icon}</span><div class="ck-qty"><button type="button" class="btn-ghost" data-minus="${e[0]}" aria-label="Moins">&minus;</button><b>${e[1]}</b><button type="button" class="btn-ghost" data-add="${e[0]}" aria-label="Plus" ${ing(e[0]).n > e[1] ? "" : "disabled"}>+</button></div><small>${esc(ing(e[0]).label)}</small></div>` : `<div class="ck-slot empty"><span>+</span><small>ingrédient</small></div>`).join("")}</div>
      <div class="ck-pot-acts">
        <button type="button" class="btn ck-fire-btn" data-pot="start" ${entries.length && !busy ? "" : "disabled"}>&#128293; Cuisiner à point</button>
        <button type="button" class="btn-secondary" data-pot="quick" ${entries.length && !busy ? "" : "disabled"} title="Qualité « correct », mangé tout de suite">&#9889; Cuisson rapide</button>
        ${entries.length ? `<button type="button" class="btn-ghost" data-pot="clear">Vider</button>` : ""}
      </div>`;
  }

  function resultHtml() {
    const r = result;
    const order = st.orders.list.find((o) => !o.done && o.recipe.key === r.key && r.q >= o.min);
    const stored = r.dishId && st.dishes.some((d) => d.id === r.dishId);
    return `<div class="ck-dish ${r.discovered ? "new" : ""} q${r.q}">
      ${r.discovered ? `<div class="ck-new">&#10024; Nouvelle recette au carnet !</div>` : ""}
      <span class="ck-dish-ico">${r.icon}</span>
      <div><strong>${esc(r.label)}</strong> ${r.qLabel ? `<span class="ck-q">${esc(r.qLabel)}</span>` : ""} ${stars(r.q)}${r.twice ? ` <span class="ck-q">&#129379; double portion</span>` : ""}
        <small>${esc(r.line || r.effectText || "")}</small>
        ${r.hint ? `<small class="ck-hint">${r.hint.icon} ${esc(r.hint.text)}</small>` : ""}
        ${r.eaten ? `<small class="ck-eaten">&#127869;&#65039; Mangé : ${esc(r.eaten.effectText)} pendant ${hours(r.eaten.hours)}${r.eaten.meal ? " · &#127881; menu complet !" : ""}</small>` : ""}
      </div>
      ${stored ? `<div class="ck-dish-acts"><button type="button" class="btn" data-eat="${esc(r.dishId)}">&#127869;&#65039; Manger</button>${order ? `<button type="button" class="btn-secondary" data-deliver="${esc(r.dishId)}" data-order="${order.id}">&#128718;&#65039; Livrer à ${esc(order.who.label)}</button>` : ""}<button type="button" class="btn-ghost" data-close-result>Le garder</button></div>` : `<button type="button" class="btn-ghost" data-close-result aria-label="Fermer">&#10005;</button>`}
    </div>`;
  }

  function paneHtml() {
    if (tab === "menu") {
      const byCourse = { entree: [], plat: [], dessert: [] };
      st.recipes.forEach((r) => (byCourse[r.course] || byCourse.plat).push(r));
      return Object.entries(byCourse).filter(([, l]) => l.length).map(([c, l]) => `<h4 class="ck-course">${{ entree: "Entrées", plat: "Plats", dessert: "Desserts" }[c]}</h4><div class="cook-recipes">${l.map((r) => `<div class="cook-recipe ${r.can ? "can" : ""} ${r.season ? "season" : ""}">
        <span class="cook-recipe-ico" aria-hidden="true">${r.icon}</span>
        <div class="cook-recipe-body">
          <strong>${esc(r.label)} ${r.stars ? stars(r.stars) : ""}</strong>
          <small>${esc(r.desc)}</small>
          <span class="cook-effect">${esc(r.effectText)}${r.hours ? ` · ${hours(r.hours)}` : ""}</span>
          <span class="cook-needs">${r.needs.map((n) => `<span class="cook-need ${n.have >= n.n ? "ok" : "miss"}" title="${esc(n.label)} : ${n.have}/${n.n}">${n.icon} ${n.have}/${n.n}</span>`).join("")}${r.tool ? `<span class="cook-need tool" title="Ustensile">${(st.tools.find((t) => t.key === r.tool) || {}).icon || ""} ${esc((st.tools.find((t) => t.key === r.tool) || {}).label || "")}</span>` : ""}${r.keeps ? `<span class="cook-need keeps" title="Se garde sans s'abîmer">&#129387; se garde</span>` : ""}${r.season ? `<span class="cook-need keeps">de saison</span>` : ""}</span>
        </div>
        <button type="button" class="btn${r.can ? "" : "-secondary"}" data-fill="${esc(r.key)}" ${busy ? "disabled" : ""}>Dans la marmite</button>
      </div>`).join("")}</div>`).join("");
    }
    if (tab === "book") {
      const b = st.book;
      return `<p class="muted">${b.known.length} recette${b.known.length > 1 ? "s" : ""} connue${b.known.length > 1 ? "s" : ""}, ${b.hidden} à découvrir. Toutes à 3 étoiles : cadre « Grand chef »${b.grandChef ? " &#10004;" : ""}.</p>
        <div class="ck-book">${b.known.map((r) => `<div class="ck-page ${r.stars >= 3 ? "gold" : ""}" title="${esc(r.label)}"><span>${r.icon}</span><small>${esc(r.label)}</small>${stars(r.stars)}</div>`).join("")}${Array.from({ length: b.hidden }, () => `<div class="ck-page hidden" title="Recette à découvrir"><span>?</span><small>???</small></div>`).join("")}</div>`;
    }
    if (tab === "orders") {
      const o = st.orders;
      return `<p class="muted">Chaque jour, des clients passent à l'auberge. Livre-leur le plat demandé, au moins aussi réussi. Toutes les commandes ${o.streakGoal} jours de suite : titre « Aubergiste du village ».</p>
        <div class="ck-streak"><span>Série : <b>${o.streak}</b> / ${o.streakGoal}</span><div class="ck-bar"><div style="width:${Math.min(100, Math.round((o.streak / o.streakGoal) * 100))}%"></div></div></div>
        ${o.list.length ? `<div class="ck-orders">${o.list.map((x) => {
          const dish = st.dishes.filter((d) => d.key === x.recipe.key && d.q >= x.min).sort((a, b) => a.q - b.q)[0];
          return `<div class="ck-order ${x.done ? "done" : ""}">
            <span class="ck-who">${x.who.icon}</span>
            <div><strong>${esc(x.who.label)}</strong><small>veut ${x.recipe.icon} ${esc(x.recipe.label)}, au moins ${esc(x.minLabel || "")} ${stars(x.min)}</small><small class="muted">+${fmt(x.reward.dust)} &#10024;${x.who.key in { milo: 1, moka: 1, noisette: 1, pistache: 1 } ? ` · +${x.reward.love} d'affection` : ""} · +${x.reward.xp} XP · parfois un ingrédient rare</small></div>
            ${x.done ? `<span class="ck-done">&#10004; Livré</span>` : dish ? `<button type="button" class="btn" data-deliver="${esc(dish.id)}" data-order="${x.id}">Livrer</button>` : `<button type="button" class="btn-secondary" data-fill="${esc(x.recipe.key)}">Préparer</button>`}
          </div>`;
        }).join("")}</div>` : `<p class="muted">Pas de commande aujourd'hui : découvre d'abord quelques recettes.</p>`}`;
    }
    if (tab === "dishes") {
      return `<p class="muted">${st.dishes.length} / ${st.dishMax} plats. Un plat frais perd une étoile chaque jour puis se gâte ; ceux qui se gardent (fumés, en bocal) ne bougent pas.</p>
        ${st.dishes.length ? `<div class="ck-dishes">${st.dishes.map((d) => `<div class="ck-stored"><span>${d.icon}</span><div><strong>${esc(d.label)}</strong> ${stars(d.q)}<small class="muted">${d.keeps ? "se garde" : `cuit il y a ${ago(d.at)}`}</small></div><button type="button" class="btn-secondary" data-eat="${esc(d.id)}">Manger</button><button type="button" class="btn-ghost" data-discard="${esc(d.id)}" aria-label="Jeter">&#128465;&#65039;</button></div>`).join("")}</div>` : `<p class="muted">Aucun plat gardé : une cuisson à point range le plat ici.</p>`}`;
    }
    // Ustensiles et moulin.
    return `<div class="ck-tools">${st.tools.map((t) => `<div class="ck-tool ${t.level ? "owned" : ""} ${t.open ? "" : "locked"}">
        <span class="ck-tool-ico">${t.icon}</span>
        <div><strong>${esc(t.label)}</strong> ${t.level ? `<span class="ck-q">niv. ${t.level}/${t.max}</span>` : ""}<small>${esc(t.text)}</small>${t.next ? `<small class="muted">${t.level ? "Suivant : " + esc(t.next.text) : ""}</small>` : ""}</div>
        ${!t.open ? `<span class="muted">&#128274; Cuisinier niv. ${t.unlockAt}</span>` : t.next ? `<button type="button" class="btn${t.level ? "-secondary" : ""}" data-tool="${t.key}">${t.level ? "Améliorer" : "Acheter"} · ${fmt(t.next.dust)} &#10024;${t.next.parts ? ` + ${t.next.parts} ${resIcon("part")}` : ""}</button>` : `<span class="ck-done">Maximum</span>`}
      </div>`).join("")}</div>
      ${st.mill ? `<h4 class="ck-course">&#9881;&#65039; Moulin à épices</h4><div class="ck-mill">
        <div><span>&#129474; Sel de roche : ${st.mill.salt} Calcaire <small class="muted">(tu en as ${st.mill.calcaire})</small></span><button type="button" class="btn-secondary" data-mill="salt" data-n="1" ${st.mill.calcaire >= st.mill.salt ? "" : "disabled"}>Moudre</button><button type="button" class="btn-ghost" data-mill="salt" data-n="5" ${st.mill.calcaire >= st.mill.salt * 5 ? "" : "disabled"}>×5</button></div>
        <div><span>&#127798;&#65039; Épices : ${st.mill.spice} herbes <small class="muted">(tu en as ${st.mill.herb})</small></span><button type="button" class="btn-secondary" data-mill="spice" data-n="1" ${st.mill.herb >= st.mill.spice ? "" : "disabled"}>Moudre</button><button type="button" class="btn-ghost" data-mill="spice" data-n="5" ${st.mill.herb >= st.mill.spice * 5 ? "" : "disabled"}>×5</button></div>
      </div>` : ""}`;
  }

  // ---------------------------------------------------------------- marmite
  function addToPot(k) {
    const have = ing(k).n;
    const cur = pot.get(k) || 0;
    if (!pot.has(k) && [...pot.values()].filter((n) => n > 0).length >= st.potKinds) { Toast.info(ERR.pot_too_many); return; }
    if (cur >= have) return;
    pot.set(k, cur + 1);
    tone(520 + cur * 40, 0, 0.05);
    const zone = $("ck-pot");
    if (zone) zone.innerHTML = potHtml();
    dropFx([ing(k).icon]);
  }
  function dropFx(icons) {
    const stove = $("ck-stove");
    if (!stove || reduced()) return;
    icons.forEach((icon, k) => { const d = document.createElement("span"); d.className = "cook-drop"; d.textContent = icon; d.style.setProperty("--dx", `${(k - icons.length / 2) * 22}px`); d.style.animationDelay = `${k * 140}ms`; stove.appendChild(d); setTimeout(() => d.remove(), 1200 + k * 140); });
  }
  function fill(key) {
    const r = st.recipes.find((x) => x.key === key);
    if (!r) return;
    pot.clear();
    r.needs.forEach((n) => pot.set(n.key, n.n));
    result = null;
    render();
    dropFx(r.needs.map((n) => n.icon));
    $("ck-pot")?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
  }

  function showResult(res, extra = {}) {
    const c = res.cooked;
    const q = extra.q ?? c.q;
    result = { ...c, q, qLabel: (st.qualities[q] || {}).label, hint: res.hint, eaten: res.eaten, twice: extra.twice };
    if (c.discovered) { if (typeof confetti === "function" && !reduced()) confetti({ particleCount: 120, spread: 90, origin: { y: 0.5 } }); tone(660, 0, 0.12); tone(880, 0.12, 0.16); tone(1320, 0.28, 0.2); }
    (res.notices || []).filter((n) => n && n.text).forEach((n, i) => setTimeout(() => Toast.success(`${n.icon || ""} ${esc(n.text)}`), 500 + i * 700));
    if (res.levelUp) LevelUpModal.show({ icon: "&#129489;&#8205;&#127859;", name: "Cuisine", level: res.levelUp, perks: [st.level.perks[res.levelUp]].filter(Boolean) });
  }

  async function quick() {
    if (busy) return;
    busy = true;
    const needs = potNeeds();
    render();
    try {
      const [res] = await Promise.all([API.cook(uid(), "cook", { pot: needs }), new Promise((r) => setTimeout(r, reduced() ? 0 : 1100))]);
      st = res; busy = false; pot.clear();
      showResult(res);
      render();
      if (res.eaten) Toast.success(`${res.eaten.icon} ${esc(res.eaten.label)} : ${esc(res.eaten.effectText)} pendant ${hours(res.eaten.hours)} !${res.eaten.meal ? " &#127881; Menu complet : tes bonus sont prolongés !" : ""}`);
      if (res.cooked && (res.cooked.effect === "pets" || res.cooked.effect === "all") && window.PetLove) PetLove.load();
    } catch (e) { busy = false; if (e.data && e.data.recipes) st = e.data; render(); Toast.error(errText(e)); }
  }

  // ------------------------------------------------------- cuisson a point
  async function start() {
    if (busy) return;
    busy = true;
    const needs = potNeeds();
    try {
      const res = await API.cook(uid(), "start", { pot: needs });
      const s = res.session;
      render();
      runGame(s);
    } catch (e) { busy = false; render(); Toast.error(errText(e)); }
  }
  function runGame(s) {
    const box = $("ck-game");
    const zone = (w) => `left:${Math.max(0, ((s.target - w) / s.total) * 100)}%;width:${Math.min(100, ((2 * w) / s.total) * 100)}%`;
    box.hidden = false;
    box.innerHTML = `
      <div class="ck-game-title">${s.icon} ${esc(s.label)} : retire du feu au bon moment !</div>
      <div class="ck-gauge"><span class="z z1" style="${zone(s.windows[2])}"></span><span class="z z2" style="${zone(s.windows[1])}"></span><span class="z z3" style="${zone(s.windows[0])}"></span><span class="ck-needle" id="ck-needle"></span></div>
      <div class="ck-gauge-legend"><span>cru</span><span>à point</span><span>brûlé</span></div>
      <button type="button" class="btn ck-take" id="ck-take">&#129508; Retirer du feu <small>(Espace)</small></button>`;
    $("ck-stove")?.classList.add("cooking", "hot");
    const t0 = performance.now();
    let done = false;
    const needle = $("ck-needle");
    let lastTick = 0;
    const step = (t) => {
      if (done) return;
      const ms = t - t0;
      const p = Math.min(1, ms / s.total);
      needle.style.left = `${p * 100}%`;
      if (ms - lastTick > 160) { lastTick = ms; tone(180 + p * 400, 0, 0.03, "square", 0.015); }
      if (ms >= s.total) { finish(s.total + 1); return; }
      requestAnimationFrame(step);
    };
    const finish = async (ms) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      $("ck-stove")?.classList.remove("hot");
      try {
        const res = await API.cook(uid(), "finish", { id: s.id, ms: Math.round(ms) });
        st = res; busy = false; pot.clear(); game = null;
        const q = res.quality.q;
        tone([140, 300, 520, 780][q], 0, 0.2, q ? "triangle" : "sawtooth", 0.05);
        if (q === 3) { tone(1040, 0.15, 0.2); if (typeof confetti === "function" && !reduced()) confetti({ particleCount: 70, spread: 70, origin: { y: 0.55 }, colors: ["#fde68a", "#fbbf24", "#f97316"] }); }
        showResult(res, { q, twice: res.quality.twice });
        render();
        Toast[q ? "success" : "info"](`${res.cooked.icon} ${esc(res.cooked.label)} : ${esc(res.quality.label)} ${"★".repeat(q)}${res.quality.twice ? " (double portion !)" : ""}`);
      } catch (e) { busy = false; render(); Toast.error(errText(e)); }
    };
    const onKey = (e) => { if (e.code === "Space" && !e.repeat) { e.preventDefault(); finish(performance.now() - t0); } };
    document.addEventListener("keydown", onKey);
    $("ck-take").addEventListener("click", () => finish(performance.now() - t0));
    game = { finish };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- plats
  async function act(action, extra, done) {
    if (busy) return;
    busy = true;
    try {
      const res = await API.cook(uid(), action, extra);
      st = res; busy = false;
      done && done(res);
      render();
    } catch (e) { busy = false; if (e.data && e.data.recipes) st = e.data; render(); Toast.error(errText(e)); }
  }
  const eat = (dishId) => act("eat", { dishId }, (res) => {
    const e = res.eaten;
    if (result && result.dishId === dishId) result = null;
    Toast.success(`${e.icon} ${esc(e.label)} : ${esc(e.effectText)} pendant ${hours(e.hours)} !${e.meal ? " &#127881; Menu complet : tes bonus sont prolongés !" : ""}`);
    if ((e.effect === "pets" || e.effect === "all") && window.PetLove) PetLove.load();
    if (typeof refreshStatus === "function") refreshStatus();
  });
  const deliver = (dishId, order) => act("deliver", { dishId, order }, (res) => {
    const d = res.delivered;
    if (result && result.dishId === dishId) result = null;
    tone(880, 0, 0.1); tone(1180, 0.1, 0.12);
    Toast.success(`&#128718;&#65039; Livré à ${esc(d.who)} : +${fmt(d.dust)} &#10024;${d.love ? ` · +${d.love} d'affection` : ""}${d.rare ? ` · ${d.rare.icon} ${esc(d.rare.label)} en pourboire !` : ""}`);
    (res.notices || []).filter((n) => n && n.text).forEach((n, i) => setTimeout(() => Toast.success(`${n.icon || ""} ${esc(n.text)}`), 600 + i * 700));
    if (res.levelUp) LevelUpModal.show({ icon: "&#129489;&#8205;&#127859;", name: "Cuisine", level: res.levelUp, perks: [st.level.perks[res.levelUp]].filter(Boolean) });
    if (typeof refreshStatus === "function") refreshStatus();
  });

  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#cook-zone")) return;
    const t = e.target;
    const add = t.closest("[data-add]");
    if (add && !add.disabled) { addToPot(add.dataset.add); return; }
    const minus = t.closest("[data-minus]");
    if (minus) { const k = minus.dataset.minus; const n = (pot.get(k) || 0) - 1; if (n > 0) pot.set(k, n); else pot.delete(k); $("ck-pot").innerHTML = potHtml(); return; }
    const p = t.closest("[data-pot]");
    if (p && !p.disabled) { if (p.dataset.pot === "start") start(); else if (p.dataset.pot === "quick") quick(); else { pot.clear(); $("ck-pot").innerHTML = potHtml(); } return; }
    const tb = t.closest("[data-tab]");
    if (tb) { tab = tb.dataset.tab; render(); return; }
    const f = t.closest("[data-fill]");
    if (f && !f.disabled) { fill(f.dataset.fill); return; }
    const ea = t.closest("[data-eat]");
    if (ea) { eat(ea.dataset.eat); return; }
    const dv = t.closest("[data-deliver]");
    if (dv) { deliver(dv.dataset.deliver, Number(dv.dataset.order)); return; }
    const dc = t.closest("[data-discard]");
    if (dc) { if (await Confirm.show("Jeter ce plat ?", { title: "Garde-manger", confirmText: "Jeter", dangerous: true })) act("discard", { dishId: dc.dataset.discard }); return; }
    if (t.closest("[data-close-result]")) { result = null; render(); return; }
    const tl = t.closest("[data-tool]");
    if (tl) {
      const tool = st.tools.find((x) => x.key === tl.dataset.tool);
      if (tool && tool.next && await Confirm.show(`${tool.level ? "Améliorer" : "Acheter"} ${esc(tool.label)} pour ${fmt(tool.next.dust)} poussières${tool.next.parts ? ` et ${tool.next.parts} pièce${tool.next.parts > 1 ? "s" : ""} détachée${tool.next.parts > 1 ? "s" : ""}` : ""} ?`, { title: "Ustensile", confirmText: tool.level ? "Améliorer" : "Acheter" })) {
        act("buyTool", { tool: tool.key }, () => { Toast.success(`${tool.icon} ${esc(tool.label)} : niveau ${(tool.level || 0) + 1} !`); if (typeof refreshStatus === "function") refreshStatus(); });
      }
      return;
    }
    const ml = t.closest("[data-mill]");
    if (ml && !ml.disabled) act("mill", { kind: ml.dataset.mill, n: Number(ml.dataset.n) || 1 }, (res) => { tone(300, 0, 0.2, "sawtooth", 0.03); Toast.success(`${res.milled.icon} +${res.milled.n} ${esc(res.milled.label.toLowerCase())}`); });
  });

  window.Kitchen = { load };
})();
