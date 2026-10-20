// Dinos de compagnie (page Jeux, onglet "Dinos", 2026-10-15).
// Enclos commun anime, oeufs, fiche de chaque dino (soins, talent, plat
// prefere, accessoire, vedette, compagnon, ponte), tas d'os, boutique du dino
// et Dinodex. Dessin : dino-art.js. Serveur : api/src/native/dino.js.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  let state = null;
  let timer = null;
  let playTimer = null;

  const art = (d, opts) => DinoArt.svg(d, { season: state && state.season ? state.season.key : null, ...opts });
  const bar = (label, v, cls) => `<div class="dino-stat ${cls}"><span>${label}</span><div class="dino-bar" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}"><div style="width:${v}%"></div></div><small>${v}</small></div>`;
  const dur = (s) => { const m = Math.max(1, Math.ceil(s / 60)); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`; };
  const foodIcon = (k) => (state.foods.find((f) => f.key === k) || {}).icon || "?";

  // --- Enclos commun : tous les dinos vivants s'y promenent.
  const DECOR_SPOTS = { rock: "left:6%;bottom:10%", nest: "left:24%;bottom:6%", pond: "left:44%;bottom:2%", palm: "right:6%;bottom:12%", hut: "right:24%;bottom:14%" };
  function scene(st) {
    const alive = st.dinos.filter((d) => !d.dead);
    const decor = st.decor.filter((x) => x.owned).map((x) => `<span class="dino-decor dino-decor-${x.key}" style="${DECOR_SPOTS[x.key] || ""}" title="${esc(x.label)}">${x.icon}</span>`).join("");
    const walkers = alive.map((d, i) => {
      const x = 8 + ((i * 71 + d.id * 37) % 78);
      return `<button type="button" class="dino-walker ${d.sleeping ? "asleep" : ""}" data-dino-pet="${d.id}" style="--x:${x}%;--dur:${14 + (d.id % 5) * 3}s;--delay:-${(d.id * 3) % 11}s" aria-label="Caresser ${esc(d.name)}" title="${esc(d.name)} : caresse-le !">${art(d, { scale: d.stage === "bebe" ? 0.6 : d.stage === "jeune" ? 0.75 : 0.9 })}</button>`;
    }).join("");
    const bones = st.dinos.filter((d) => d.dead).map((d, i) => `<span class="dino-scene-bones" style="left:${60 + i * 9}%" title="Tas d'os de ${esc(d.name)}">🦴</span>`).join("");
    return `<div class="dino-scene ${st.sleeping ? "night" : ""}" aria-label="Enclos des dinos">
      <span class="dino-scene-sky" aria-hidden="true">${st.sleeping ? "🌙" : "☀️"}</span>
      ${decor}${bones}${walkers}
      ${alive.length ? "" : '<p class="dino-scene-empty">L’enclos est vide…</p>'}
      ${st.sleeping && alive.length ? '<p class="dino-scene-note">Chut, ils dorment (23 h - 7 h)</p>' : ""}
    </div>`;
  }
  // Deux dinos eveilles jouent ensemble de temps en temps.
  function startPlaytime() {
    clearInterval(playTimer);
    playTimer = setInterval(() => {
      const w = [...document.querySelectorAll(".dino-walker:not(.asleep)")];
      if (w.length < 2 || document.hidden) return;
      const a = w[Math.floor(Math.random() * w.length)];
      const b = w.filter((x) => x !== a)[Math.floor(Math.random() * (w.length - 1))];
      [a, b].forEach((x) => { x.classList.add("playmate"); setTimeout(() => x.classList.remove("playmate"), 1800); });
    }, 7000);
  }

  function eggsHtml(st) {
    if (!st.eggs.length) return "";
    const t = Date.now() / 1000;
    return `<div class="dino-eggs">${st.eggs.map((e) => `<div class="dino-egg ${e.ready ? "ready" : ""}">
      <span class="dino-egg-icon" aria-hidden="true">🥚</span>
      <small>${e.parents.length ? `De ${esc(e.parents.join(" et "))}` : "Œuf"}</small>
      ${e.ready ? `<button type="button" class="btn" data-dino-egg="${e.id}">Faire éclore</button>` : `<small class="muted">Éclot dans ${dur(e.hatchAt - t)}</small>`}
    </div>`).join("")}</div>`;
  }

  function deadCard(d, st) {
    return `<article class="dino-card dead" data-dino="${d.id}">
      <div class="dino-pen">${DinoArt.bones()}</div>
      <div class="dino-info">
        <div class="dino-name"><strong>${esc(d.name)}</strong></div>
        <p class="dino-dead-text">Sans nourriture ni affection, ${esc(d.name)} n’a pas survécu. Il ne reste qu’un tas d’os.</p>
        <button type="button" class="btn-secondary" data-dino-bury="${d.id}">${resIcon("bone")} Récupérer les os (+${st.hatchBones}) et libérer la place</button>
      </div>
    </article>`;
  }

  // Balade (mode Chill) : partir, ou rentrer avec les trouvailles.
  function walkButton(d, st, t) {
    if (d.walkUntil) return d.walkUntil > t
      ? `<span class="dino-walk-chip">🦕 En balade, retour dans ${dur(d.walkUntil - t)}</span>`
      : `<button type="button" class="btn" data-dino-walkback="${d.id}">🦕 Le récupérer de balade</button>`;
    if (!st.walkOn) return "";
    return `<button type="button" class="btn-ghost" data-dino-walk="${d.id}" ${d.walkedToday || d.sleeping ? "disabled" : ""} title="Une heure de promenade, une fois par jour : trouvailles et bonne humeur">🦕 ${d.walkedToday ? "Déjà promené" : "Balade (1 h)"}</button>`;
  }

  function card(d, st) {
    if (d.dead) return deadCard(d, st);
    const t = Date.now() / 1000;
    const playLeft = Math.max(0, Math.round(d.canPlayAt - t));
    const pct = d.nextStageXp ? Math.min(100, Math.round((d.xp / d.nextStageXp) * 100)) : 100;
    const owned = st.accessories.filter((a) => a.owned);
    const foods = st.foods.map((f) => {
      const n = st.food[f.key] || 0;
      return `<button type="button" class="dino-food ${d.fav === f.key ? "fav" : ""}" data-dino-feed="${d.id}" data-food="${f.key}" ${n < 1 || d.food >= 95 ? "disabled" : ""} title="${esc(f.label)} : +${f.food} satiété${f.happy ? `, +${f.happy} bonheur` : ""}${d.fav === f.key ? " (son plat préféré !)" : ""}">${f.icon}<small>${n}</small></button>`;
    }).join("");
    const tags = [
      d.shiny ? '<span class="dino-tag rainbow">✨ Chromatique</span>' : "",
      d.colorLabel && d.color !== "chroma" ? `<span class="dino-tag rare">💎 ${esc(d.colorLabel)}</span>` : "",
      ["galaxy", "zigzag"].includes(d.pattern) ? `<span class="dino-tag rare">🌀 ${esc(d.patternLabel)}</span>` : "",
      st.star === d.id ? '<span class="dino-tag">⭐ Vedette</span>' : "",
      st.companion === d.id ? '<span class="dino-tag">🧭 Compagnon</span>' : ""
    ].join("");
    const adult = d.stage === "adulte";
    return `<article class="dino-card ${d.shiny ? "shiny" : ""}" data-dino="${d.id}">
      <div class="dino-pen">
        <span class="dino-mood ${d.mood.key === "dying" ? "danger" : ""}" title="${esc(d.mood.label)}">${d.mood.icon} ${esc(d.mood.label)}</span>
        ${art(d)}
        <div class="dino-poops" aria-label="${d.poops} caca${d.poops > 1 ? "s" : ""}">${"<span>💩</span>".repeat(Math.min(d.poops, 8))}${'<span class="gold">💩</span>'.repeat(Math.min(d.goldPoops, 3))}</div>
      </div>
      <div class="dino-info">
        <div class="dino-name"><strong>${esc(d.name)}</strong> <button type="button" class="dino-rename" data-dino-rename="${d.id}" aria-label="Renommer ${esc(d.name)}">✏️</button></div>
        ${tags ? `<div class="dino-tags">${tags}</div>` : ""}
        <small class="dino-sub">${esc(d.speciesLabel)} · ${esc(d.stageLabel)}${d.nextStageXp ? ` · ${d.xp} / ${d.nextStageXp} XP` : ""}</small>
        ${d.nextStageXp ? `<div class="dino-xp"><div style="width:${pct}%"></div></div>` : ""}
        <small class="dino-talent" title="Actif quand il est content (satiété 25+, bonheur 40+)">🎖️ ${esc(d.talent)}</small>
        <small class="dino-fav">Plat préféré : ${d.fav ? `${foodIcon(d.fav)} <strong>trouvé !</strong>` : "<em>à découvrir</em>"}</small>
        ${bar("Satiété", d.food, "food")}${bar("Bonheur", d.happy, "happy")}${bar("Propreté", d.clean, "clean")}
        <div class="dino-foods" role="group" aria-label="Nourrir ${esc(d.name)}">${foods}</div>
        <div class="dino-actions">
          <button type="button" class="btn-secondary" data-dino-play="${d.id}" ${playLeft || d.sleeping ? "disabled" : ""}>🎾 ${d.sleeping ? "Il dort" : playLeft ? "Jouer dans " + dur(playLeft) : "Jouer"}</button>
          <button type="button" class="btn-ghost" data-dino-clean="${d.id}" ${d.poops + d.goldPoops ? "" : "disabled"}>🧹 Ramasser${d.poops + d.goldPoops ? ` (${d.poops + d.goldPoops})` : ""}</button>
          ${walkButton(d, st, t)}
        </div>
        <small class="dino-dig">${adult ? (d.digging ? `⛏️ Fouille pour toi${d.finds ? ` : <strong>${d.finds} trouvaille${d.finds > 1 ? "s" : ""}</strong>` : ""}` : "⛏️ Trop affamé ou triste pour fouiller") : "⛏️ Fouillera pour toi une fois adulte"}</small>
        <div class="dino-more">
          <button type="button" class="btn-ghost" data-dino-star="${d.id}" aria-pressed="${st.star === d.id}">⭐ ${st.star === d.id ? "Retirer du profil" : "Mettre en vedette"}</button>
          <button type="button" class="btn-ghost" data-dino-companion="${d.id}" aria-pressed="${st.companion === d.id}" title="Accompagne l’explorateur : jusqu’à +30 % de poussières selon son bonheur, mais il revient affamé">🧭 ${st.companion === d.id ? "Rester à l’enclos" : "Compagnon d’expédition"}</button>
          ${owned.length ? `<label class="dino-acc">🎀 <select data-dino-acc="${d.id}" aria-label="Accessoire de ${esc(d.name)}"><option value="">Aucun accessoire</option>${owned.map((a) => `<option value="${a.key}" ${d.acc === a.key ? "selected" : ""}>${a.icon} ${esc(a.label)}</option>`).join("")}</select></label>` : ""}
          ${adult ? `<button type="button" class="btn-ghost" data-dino-breed="${d.id}" ${d.canBreedAt > t ? "disabled" : ""}>🥚 ${d.canBreedAt > t ? "Pondre dans " + dur(d.canBreedAt - t) : "Pondre un œuf"}</button>` : ""}
          <button type="button" class="btn-ghost dino-release" data-dino-release="${d.id}" ${d.walkUntil ? "disabled" : ""} title="Il part pour de bon et libère sa place dans l’enclos">🌿 Relâcher dans la nature</button>
        </div>
        ${d.nextPoopAt && !d.poops ? `<small class="muted">Prochain caca dans ${dur(Math.max(0, Math.round(d.nextPoopAt - t)))}</small>` : ""}
      </div>
    </article>`;
  }

  function shopHtml(st) {
    const item = (x, kind) => `<div class="dino-shop-item ${x.owned ? "owned" : ""}"><span aria-hidden="true">${x.icon}</span><strong>${esc(x.label)}</strong>${x.owned ? '<small class="muted">Possédé</small>' : `<button type="button" class="btn-ghost" data-dino-buy="${kind}" data-key="${x.key}" ${st.stardust < x.price ? "disabled" : ""}>${x.price} ✨</button>`}</div>`;
    return `<details class="dino-box" id="dino-shop-box"><summary>🛍️ Boutique du dino</summary>
      <h4>Accessoires <small class="muted">(un par dino, à changer quand tu veux)</small></h4>
      <div class="dino-shop">${st.accessories.map((x) => item(x, "acc")).join("")}</div>
      <h4>Décorations de l’enclos <small class="muted">(chacune : bonheur 6 % moins vite, ${st.decorBonus} % actuellement)</small></h4>
      <div class="dino-shop">${st.decor.map((x) => item(x, "decor")).join("")}</div>
    </details>`;
  }
  function dexHtml(st) {
    const dx = st.dex;
    const cell = (x) => `<li class="${x.found ? "found" : ""}">${x.found ? esc(x.label) : "???"}</li>`;
    return `<details class="dino-box" id="dino-dex-box"><summary>📖 Dinodex <small>${dx.count} / ${dx.total}</small></summary>
      <div class="dino-dex-bar"><div style="width:${Math.round((dx.count / dx.total) * 100)}%"></div></div>
      <ul class="dino-dex-tiers">${dx.tiers.map((x) => `<li class="${x.claimed ? "done" : ""}">${x.claimed ? "✅" : "🔒"} ${x.n} entrées : ${esc(x.label)}</li>`).join("")}</ul>
      <div class="dino-dex-grid">
        <section><h4>Espèces</h4><ul>${dx.species.map(cell).join("")}</ul></section>
        <section><h4>Motifs</h4><ul>${dx.patterns.map(cell).join("")}</ul></section>
        <section><h4>Couleurs rares</h4><ul>${dx.colors.map(cell).join("")}</ul></section>
        <section><h4>Stades</h4><ul>${dx.stages.map(cell).join("")}</ul></section>
      </div>
      <p class="muted dino-dex-note">Les talents : ${st.species.map((s) => `<strong>${esc(s.label)}</strong> ${esc(s.talent)}${s.seasonal ? " (pendant les événements)" : ""}`).join(" · ")}.</p>
    </details>`;
  }

  function render(st) {
    // Garde l'etat ouvert des panneaux repliables.
    const open = { shop: $("dino-shop-box")?.open, dex: $("dino-dex-box")?.open };
    state = st;
    const used = st.dinos.length;
    const canHatch = st.skulls > 0 && st.bones >= st.hatchBones && used < st.max;
    const finds = st.dinos.reduce((s, d) => s + (d.finds || 0), 0);
    $("dino-meta").innerHTML = `<span title="Crânes de dinosaure"><img class="ico-art" src="assets/CraneDeDino.png" alt="" /> <strong>${st.skulls}</strong> crâne${st.skulls > 1 ? "s" : ""}</span>
      <span title="Os (pêche, Milo le chien de fouille)">${resIcon("bone")} <strong>${st.bones}</strong> os</span>
      <span title="Cacas ramassés : engrais pour le jardin">${POOP} <strong>${st.poop}</strong> engrais${st.goldPoop ? ` · ${GOLD_POOP} <strong class="gold">${st.goldPoop}</strong> doré${st.goldPoop > 1 ? "s" : ""}` : ""}</span>
      <span title="Nourriture pêchée">${resIcon("fish")} ${st.food.fish} · ${resIcon("seaweed")} ${st.food.seaweed} · ${resIcon("shrimp")} ${st.food.shrimp} · ${resIcon("worm")} ${st.food.worm}</span>
      <span>🦖 ${used} / ${st.max}</span>
      ${st.holiday ? '<span class="dino-holiday-note">🏖️ Vacances des dinos (mode Cool) : ni faim ni tristesse, et ils pondent deux fois plus vite.</span>' : ""}
      ${st.season && st.season.ptero ? `<span class="dino-season">${st.season.icon} ${esc(st.season.label)} : costumes, et le <strong>${esc(st.season.ptero)}</strong> peut éclore !</span>` : ""}`;
    const hatch = $("dino-hatch-btn");
    hatch.hidden = !st.skulls || used >= st.max;
    hatch.disabled = !canHatch;
    hatch.innerHTML = `<img class="ico-art" src="assets/CraneDeDino.png" alt="" /> Ramener un dino à la vie (1 crâne + ${st.hatchBones} os)`;
    const collect = $("dino-collect-btn");
    collect.hidden = !finds;
    collect.innerHTML = `⛏️ Récupérer les trouvailles de tes dinos (${finds})`;
    $("dino-clean-all-btn").hidden = st.dinos.reduce((s, d) => s + d.poops + d.goldPoops, 0) < 2;
    $("dino-scene-box").innerHTML = st.dinos.length ? scene(st) : "";
    $("dino-eggs").innerHTML = eggsHtml(st);
    $("dino-list").innerHTML = st.dinos.length
      ? st.dinos.map((d) => card(d, st)).join("")
      : `<div class="dino-empty"><span aria-hidden="true"><img class="dino-empty-skull" src="assets/CraneDeDino.png" alt="" /></span><p>${st.skulls
        ? `Tu as un crâne de dinosaure ! Avec <strong>${st.hatchBones} os</strong> (pêche, ou achetés au chenil de la fouille), ramène-le à la vie.`
        : `Pas encore de dino. En creusant dans la <a href="jeux.html#fouille">fouille</a>, tu as une chance <strong>extrêmement rare</strong> de déterrer un <strong>crâne de dinosaure</strong>. Avec ${st.hatchBones} os en plus, il revient à la vie : couleur au hasard, 5 dinos au maximum.`}</p></div>`;
    $("dino-extra").innerHTML = shopHtml(st) + dexHtml(st);
    if (open.shop) $("dino-shop-box").open = true;
    if (open.dex) $("dino-dex-box").open = true;
    startPlaytime();
    clearInterval(timer);
    if (st.dinos.length || st.eggs.length) timer = setInterval(() => { if ($("dino-pane").style.display !== "none") load(); else clearInterval(timer); }, 60000);
  }

  async function load() {
    try {
      const res = await API.dino(Session.userId);
      render(res);
      dexToasts(res);
    } catch (e) { $("dino-meta").textContent = "Impossible de charger les dinos."; }
  }
  function dexToasts(res) {
    (res.dexRewards || []).forEach((r, i) => setTimeout(() => Toast.success(`📖 Dinodex : ${r.n} entrées ! Récompense : ${esc(r.label)}`), 400 + i * 500));
  }

  const ERRORS = {
    no_skull: "Il te faut un crâne de dinosaure (fouille).", not_enough_bones: "Pas assez d'os.", get max_dinos() { return `Ton enclos est plein (${state && state.max ? state.max + " places" : "plus de place"}, tas d'os compris). Tu peux relâcher un dino dans la nature pour libérer une place.`; }, already_walking: "Il est en balade : attends son retour.",
    no_food: "Plus de cette nourriture : va pêcher !", not_hungry: "Il n'a plus faim.", play_cooldown: "Il se repose, reviens plus tard.", sleeping: "Chut, il dort (23 h - 7 h).",
    nothing_to_clean: "Rien à ramasser.", invalid_name: "Nom invalide.", nothing_to_collect: "Pas encore de trouvaille.", max_eggs: "Déjà 3 œufs en attente.",
    not_adult: "Il faut deux adultes.", not_happy_enough: "Les deux parents doivent être heureux (bonheur 70+) et nourris (satiété 40+).", breed_cooldown: "Ils se reposent avant une nouvelle ponte.",
    egg_not_ready: "L'œuf n'est pas encore prêt.", not_enough_dust: "Pas assez de poussières.", already_owned: "Déjà possédé.", dino_dead: "Il n'y a plus qu'un tas d'os…"
  };
  const pop = (id, txt) => {
    const targets = [document.querySelector(`.dino-card[data-dino="${id}"] .dino-pen`), document.querySelector(`.dino-walker[data-dino-pet="${id}"]`)].filter(Boolean);
    targets.forEach((p) => { p.insertAdjacentHTML("beforeend", `<span class="dino-pop">${txt}</span>`); setTimeout(() => p.querySelector(".dino-pop")?.remove(), 1200); });
  };
  async function act(action, extra, el) {
    if (el) el.disabled = true;
    try {
      const res = await API.dino(Session.userId, action, extra);
      render(res);
      dexToasts(res);
      if (res.hatched) {
        const h = res.hatched;
        const special = h.shiny ? " Il est CHROMATIQUE !" : h.colorLabel ? ` Couleur rare : ${esc(h.colorLabel)} !` : "";
        Toast.success(`${res.fromEgg ? "🐣" : "💀"} ${esc(h.name)} le ${esc(h.speciesLabel)} ${res.fromEgg ? "est sorti de son œuf" : "est revenu à la vie"} !${special}`);
        if (typeof confetti === "function") confetti({ particleCount: h.shiny || h.colorLabel ? 240 : 120, spread: 110, origin: { y: 0.55 } });
      }
      if (res.fed) {
        pop(res.fed.dino, `${foodIcon(res.fed.food)} ${res.fed.fav ? "❤️ miam miam !" : "miam !"}`);
        if (res.fed.favFound) Toast.success(`❤️ C'est son plat préféré : ${foodIcon(res.fed.food)} ! Il le rend bien plus heureux.`);
      }
      if (res.played) pop(res.played, "🎾 ❤️");
      if (res.walking) pop(res.walking, "🦕 en route !");
      if (res.walked) {
        const w = res.walked;
        pop(w.dino, "🦕 ❤️");
        Toast.success(`🦕 Retour de balade : +${w.dust} ✨, +${w.worms} ver${w.worms > 1 ? "s" : ""}, +${w.food.n} ${w.food.icon} ${esc(w.food.label.toLowerCase())}${w.bone ? " et un os !" : ""}`);
      }
      if (res.petted) pop(res.petted, res.quiet ? "💗" : "💗 +bonheur");
      if (res.released) {
        const r = res.released, l = r.loot || {};
        const bits = [l.dust ? `+${l.dust} ✨` : "", l.worms ? `+${l.worms} vers` : "", l.bones ? `+${l.bones} os` : "", l.fish ? `+${l.fish} poisson${l.fish > 1 ? "s" : ""}` : "", l.skulls ? "un crâne !" : "", r.poop ? `+${r.poop} engrais` : "", r.goldPoop ? `+${r.goldPoop} engrais doré` : ""].filter(Boolean);
        Toast.success(`🌿 ${esc(r.name)} est reparti dans la nature. Une place se libère dans l’enclos.${bits.length ? ` Il t’a laissé : ${bits.join(", ")}.` : ""}`);
      }
      if (res.collected || res.collectedGold) Toast.success(`🧹 +${res.collected} engrais${res.collectedGold ? ` et +${res.collectedGold} engrais DORÉ${res.collectedGold > 1 ? "S" : ""} ${GOLD_POOP}` : ""} ! Utilise-les au <a href="jeux.html#jardin">jardin</a>.`);
      if (res.loot) {
        const l = res.loot;
        Toast.success(`⛏️ Trouvailles de tes dinos : +${l.dust} ✨${l.worms ? `, +${l.worms} vers` : ""}${l.bones ? `, +${l.bones} os` : ""}${l.fish ? `, +${l.fish} poisson${l.fish > 1 ? "s" : ""}` : ""}${l.skulls ? " et un CRÂNE DE DINOSAURE !" : ""}`);
        if (l.skulls && typeof confetti === "function") confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } });
      }
      if (res.laid) Toast.success("🥚 Un œuf ! Il éclora dans 12 heures.");
      if (res.buried) Toast.info(`${resIcon("bone")} Tu récupères ${res.buried.bones} os. Repose en paix, ${esc(res.buried.name)}…`);
      if (res.grown) { Toast.success(`🌟 Ton dino grandit : stade ${esc(res.grown.stage)} !`); if (res.grown.stage === "Adulte") Toast.info("⛏️ Adulte : il fouille maintenant pour toi quand il est content."); }
      if (res.bought) Toast.success("🛍️ Acheté !");
    } catch (e) {
      Toast.error(ERRORS[e.code] || friendlyError(e));
      if (el) el.disabled = false;
    }
  }

  // Champ dans une boite de confirmation (Confirm n'a pas de saisie) : la
  // valeur est suivie au fil de la saisie.
  async function ask(html, opts, id) {
    let value = null;
    const track = (ev) => { if (ev.target.id === id) value = ev.target.value; };
    document.addEventListener("input", track);
    document.addEventListener("change", track);
    setTimeout(() => { const el = document.getElementById(id); if (el) { value = el.value; if (el.select) el.select(); } }, 50);
    const okd = await Confirm.show(html, opts);
    document.removeEventListener("input", track);
    document.removeEventListener("change", track);
    return okd ? value : null;
  }

  document.addEventListener("change", (e) => {
    const s = e.target.closest("[data-dino-acc]");
    if (s) act("equip", { dino: Number(s.dataset.dinoAcc), key: s.value || null }, s);
  });
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#dino-pane")) return;
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "dino-hatch-btn") return act("hatch", {}, b);
    if (b.id === "dino-collect-btn") return act("collect", {}, b);
    if (b.id === "dino-clean-all-btn") return act("clean", {}, b);
    if (b.dataset.dinoPet) return act("pet", { dino: Number(b.dataset.dinoPet) });
    if (b.dataset.dinoFeed) return act("feed", { dino: Number(b.dataset.dinoFeed), food: b.dataset.food }, b);
    if (b.dataset.dinoPlay) return act("play", { dino: Number(b.dataset.dinoPlay) }, b);
    if (b.dataset.dinoWalk) return act("walk", { dino: Number(b.dataset.dinoWalk) }, b);
    if (b.dataset.dinoWalkback) return act("walk-back", { dino: Number(b.dataset.dinoWalkback) }, b);
    if (b.dataset.dinoClean) return act("clean", { dino: Number(b.dataset.dinoClean) }, b);
    if (b.dataset.dinoEgg) return act("hatchEgg", { egg: Number(b.dataset.dinoEgg) }, b);
    if (b.dataset.dinoBury) return act("bury", { dino: Number(b.dataset.dinoBury) }, b);
    // Relacher (2026-10-20) : definitif, donc confirme ; ses trouvailles et cacas murs sont ramasses au passage.
    if (b.dataset.dinoRelease) {
      const d = state.dinos.find((x) => x.id === Number(b.dataset.dinoRelease));
      if (!d) return;
      const ok = await Confirm.show(`Relâcher <strong>${esc(d.name)}</strong> dans la nature ? Il part pour de bon et libère sa place dans l’enclos. Ce qu’il a déjà trouvé et ses cacas sont ramassés pour toi ; il reste dans ton Dinodex.`, { title: "Relâcher dans la nature", confirmText: "Relâcher", dangerous: true });
      if (ok) act("release", { dino: d.id }, b);
      return;
    }
    if (b.dataset.dinoStar) return act("star", { dino: Number(b.dataset.dinoStar) }, b);
    if (b.dataset.dinoCompanion) return act("companion", { dino: Number(b.dataset.dinoCompanion) }, b);
    if (b.dataset.dinoBuy) return act(b.dataset.dinoBuy === "acc" ? "buyAcc" : "buyDecor", { key: b.dataset.key }, b);
    if (b.dataset.dinoRename) {
      const d = state.dinos.find((x) => x.id === Number(b.dataset.dinoRename));
      const name = await ask(`<label class="dino-rename-label">Nouveau nom<input id="dino-rename-input" type="text" maxlength="20" value="${esc(d.name)}" /></label>`, { title: `Renommer ${esc(d.name)}`, confirmText: "Renommer" }, "dino-rename-input");
      if (name && name.trim() && name.trim() !== d.name) act("rename", { dino: d.id, name: name.trim() });
    }
    if (b.dataset.dinoBreed) {
      const a = state.dinos.find((x) => x.id === Number(b.dataset.dinoBreed));
      const t = Date.now() / 1000;
      const partners = state.dinos.filter((x) => x.id !== a.id && !x.dead && x.stage === "adulte" && x.canBreedAt <= t);
      if (!partners.length) return Toast.info("Il faut un deuxième dino adulte, reposé, pour pondre un œuf.");
      const pick = await ask(`<label class="dino-rename-label">Avec qui ${esc(a.name)} pond-il un œuf ?<select id="dino-breed-select">${partners.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.speciesLabel)}, bonheur ${p.happy})</option>`).join("")}</select></label><p class="muted" style="margin:8px 0 0;font-size:.8rem;">Les deux parents doivent être heureux (70+) et nourris (40+). Le petit hérite d’un mélange de leurs couleurs. L’œuf éclot en 12 h.</p>`, { title: "Pondre un œuf", confirmText: "Pondre" }, "dino-breed-select");
      if (pick) act("breed", { a: a.id, b: Number(pick) });
    }
  });

  window.loadDinos = load;
})();
