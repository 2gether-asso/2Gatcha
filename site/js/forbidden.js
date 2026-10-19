// La porte cachee et la Salle des Machines Interdites (api/src/native/forbidden.js,
// 2026-10-19). Page sans lien : on y arrive par les rouages caches (shell.js, Gears).
//  - Porte : 10 serrures en cercle ; forge des cles speciales (1 cle + 1 de
//    chaque mineral) ; chaque cle inseree allume une serrure ; la derniere
//    ouvre la porte (cinematique), pour toujours.
//  - Machine a sous : 3 rouleaux, tirage par le serveur ; les rouleaux
//    s'arretent un a un sur le resultat. Relance du rouleau intrus sur une
//    paire, x10, tour gratuit du jour, jauge de surchauffe, jackpot commun.
(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = fmtNum; // core.js
  const esc = escHtml;
  let state = null;
  let busy = false;
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const skeyImg = (cls = "ico-token") => `<img class="${cls}" src="assets/${encodeURI("cléSpeciale.png")}" alt="clé spéciale" />`;
  const ERR = { missing_ingredients: "Il manque des ingrédients.", no_special_key: "Il te faut une clé spéciale.", not_enough_dust: "Pas assez de poussières.", cannot_nudge: "Plus de relance possible pour ce tour.", cannot_risk: "Rien à remettre en jeu.", not_enough_boosters: "Tu n'as plus ces jetons.", locked: "La porte est fermée.", already_open: "La porte est déjà ouverte." };
  const errText = (e) => ERR[e.code] || friendlyError(e);

  // Pas d'acces (mot pas encore reclame, ou visiteur) : la page reste une
  // 404 parfaitement ordinaire (contenu de 404.html deja en place).
  function renderDenied() {
    try { localStorage.removeItem("2gatcha_forbidden"); } catch (e) { /* stockage indisponible */ }
  }
  // Acces confirme : la 404 laisse place a la salle.
  function revealRoom() {
    $("fd-fake404")?.remove();
    $("fd-room").hidden = false;
    document.body.classList.add("forbidden-page");
    document.title = "Salle interdite - 2Gatcha";
  }

  // ---------------------------------------------------------------- la porte
  // Aucune recette ecrite : des emplacements vides qui ne se revelent qu'une
  // fois l'ingredient en poche (le serveur ne nomme rien d'autre).
  const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
  function renderDoor(st) {
    $("fd-door-zone").hidden = false;
    $("fd-machine-zone").hidden = true;
    const need = st.keysNeeded;
    $("fd-locks").innerHTML = Array.from({ length: need }, (_, i) => `<span class="fd-lock ${i < st.doorKeys ? "on" : ""}" style="--i:${i};--n:${need}"><span class="fd-hole"></span></span>`).join("");
    $("fd-door-status").innerHTML = st.doorKeys ? `<span class="fd-roman">${ROMAN[st.doorKeys] || st.doorKeys} · ${ROMAN[need] || need}</span>` : "";
    const f = st.forge;
    $("fd-forge").innerHTML = `
      <p class="fd-anvil-text">Une enclume froide, couverte de cendres. Des creux attendent quelque chose.</p>
      <div class="fd-sockets">${f.slots.map((x, i) => x.known
        ? `<span class="fd-socket known ${i === 0 ? "is-key" : ""}" title="${esc(x.name)}"><img src="assets/${encodeURI(x.img)}" alt="${esc(x.name)}" /></span>`
        : `<span class="fd-socket" aria-label="Creux vide">?</span>`).join("")}</div>
      <div class="fd-forge-actions">
        <button type="button" class="fd-anvil ${f.ready ? "hot" : ""}" id="fd-craft">&#128296; Frapper l'enclume</button>
        ${st.specialKeys > 0 ? `<button type="button" class="fd-approach" id="fd-insert">${skeyImg("fd-skey-img")} <span>×${st.specialKeys}</span> Approcher de la porte</button>` : ""}
      </div>`;
    $("fd-craft").addEventListener("click", () => (f.ready ? craftKey() : coldAnvil()));
    $("fd-insert")?.addEventListener("click", insertKey);
    // La porte elle-meme accepte une cle qu'on lui presente.
    $("fd-door").onclick = () => (st.specialKeys > 0 ? insertKey() : murmur());
  }
  const MURMURS = ["La porte ne bouge pas.", "Dix bouches de fer, et aucune ne parle.", "Il faudrait quelque chose de forgé.", "Un souffle froid passe sous la porte."];
  function murmur() { Toast.info(MURMURS[Math.floor(Math.random() * MURMURS.length)]); }
  function coldAnvil() {
    if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(140, 0, 0.12, "square", 0.05);
    const c = $("fd-craft"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
    Toast.info("L'enclume reste froide. Il manque encore des pierres… et peut-être autre chose.");
  }

  async function craftKey() {
    if (busy) return; busy = true;
    try {
      const res = await API.post("forbidden", { userId: Session.userId, action: "craftKey" });
      state = res;
      if (typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal("epique");
      if (typeof Haptics !== "undefined") Haptics.buzz([20, 40, 60]);
      Toast.success(`${skeyImg()} Quelque chose sort de la forge, encore brûlant.`);
      renderDoor(res);
    } catch (e) { if (e.code === "missing_ingredients") coldAnvil(); else Toast.error(errText(e)); if (e.data && e.data.forge) renderDoor(e.data); } finally { busy = false; }
  }

  async function insertKey() {
    if (busy) return; busy = true;
    try {
      const res = await API.post("forbidden", { userId: Session.userId, action: "insertKey" });
      state = res;
      renderDoor(res);
      const lock = document.querySelectorAll(".fd-lock")[res.inserted - 1];
      if (lock) { lock.classList.add("just"); }
      if (typeof Sfx !== "undefined" && Sfx._tone) { Sfx._tone(180, 0, 0.18, "square", 0.06); Sfx._tone(90, 0.12, 0.25, "sawtooth", 0.05); }
      if (typeof Haptics !== "undefined") Haptics.buzz(60);
      if (res.opened) await openDoor(res);
    } catch (e) { Toast.error(errText(e)); } finally { busy = false; }
  }

  // Cinematique d'ouverture : la roue tourne, les verrous claquent, la porte pivote.
  async function openDoor(res) {
    const door = $("fd-door");
    door.classList.add("fd-unlocking");
    if (typeof Sfx !== "undefined" && Sfx._tone) for (let i = 0; i < 6; i++) Sfx._tone(120 + i * 30, i * 0.25, 0.2, "square", 0.05);
    await sleep(reduced() ? 300 : 1800);
    door.classList.add("fd-opening");
    document.querySelector(".fd-stage").classList.add("fd-open");
    if (typeof Haptics !== "undefined") Haptics.buzz([80, 60, 200]);
    if (typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal("legendaire");
    await sleep(reduced() ? 400 : 2200);
    rememberRoom();
    renderMachine(res);
    if (typeof confetti === "function") confetti({ particleCount: 160, spread: 100, origin: { y: 0.4 }, colors: ["#f87171", "#fbbf24", "#fde68a"] });
    Toast.success("La porte s'ouvre. Derrière, des machines qui n'auraient jamais dû exister…");
  }

  // Lien du menu « Jouer » (le nom de la page n'est ecrit que par elle-meme).
  function rememberRoom() {
    try { localStorage.setItem("2gatcha_forbidden", location.pathname.split("/").pop() || ""); } catch (e) { /* stockage indisponible */ }
  }

  // -------------------------------------------------------------- la machine
  // (api/src/native/slots.js) : fenetre de 3 lignes donnee par le serveur,
  // la ligne du milieu paie. Mise, cascades, tours bonus, reserve, niveau,
  // defis, carnet, quitte ou double, jackpot vivant, tableau des chanceux.
  let bet = (() => { try { return Number(localStorage.getItem("2gatcha_fm_bet")) || 1; } catch (e) { return 1; } })();
  let jackpotTimer = null;
  const M = () => state.machine;
  const symIcon = (k) => ((M().symbols.find((s) => s.key === k) || {}).icon) || "❔";
  const symHtml = (k, extra = "") => `<div class="fm-sym ${extra}" data-k="${k}">${symIcon(k)}</div>`;
  const randSym = () => { const s = M().symbols; return s[Math.floor(Math.random() * s.length)].key; };

  function renderMachine(st) {
    state = st;
    $("fd-door-zone").hidden = true;
    const z = $("fd-machine-zone");
    z.hidden = false;
    const m = M();
    if (!m.bets.includes(bet)) bet = 1;
    z.innerHTML = `
      <div class="fm-layout">
        <div class="fm-cabinet" id="fm-cabinet">
          <div class="fm-top">
            <div class="fm-title">Machine interdite</div>
            <div class="fm-jackpot" title="Jackpot commun à tout le serveur : il grossit à chaque tour payant. Complet à la mise ×5.">
              <small>Jackpot</small><strong id="fm-jackpot">${fmt(m.jackpot)}</strong> &#10024;
            </div>
          </div>
          <div class="fm-level" id="fm-level"></div>
          <div class="fm-banner" id="fm-banner" hidden></div>
          <div class="fm-window" id="fm-window" style="--reels:${m.reels}">
            ${Array.from({ length: m.reels }, (_, i) => `<div class="fm-reel" data-reel="${i}"><div class="fm-strip">${[randSym(), randSym(), randSym()].map((k) => symHtml(k)).join("")}</div></div>`).join("")}
            <div class="fm-payline" aria-hidden="true"></div>
          </div>
          <div class="fm-heat" title="Surchauffe : à fond, le prochain tour est un triple garanti">
            <span>&#128293;</span><div class="fm-heat-bar"><div id="fm-heat-fill"></div></div><small id="fm-heat-n"></small>
          </div>
          <div class="fm-bets" role="radiogroup" aria-label="Mise">${m.bets.map((b) => `<button type="button" role="radio" class="fm-bet" data-bet="${b}">×${b}</button>`).join("")}</div>
          <div class="fm-controls">
            <button type="button" class="fm-lever" id="fm-spin"></button>
            <button type="button" class="btn btn-secondary" id="fm-spin10"></button>
          </div>
          <div class="fm-free" id="fm-free"></div>
          <div class="fm-result" id="fm-result" aria-live="polite"></div>
        </div>
        <aside class="fm-side">
          <section class="fm-panel"><h3>&#127919; Défis du jour</h3><div id="fm-daily"></div></section>
          <section class="fm-panel"><h3>&#128214; Carnet des combinaisons</h3><div id="fm-combos"></div></section>
          <section class="fm-panel"><h3>&#127942; Les chanceux de la semaine</h3><div id="fm-week"></div></section>
          <details class="fm-panel fm-help">
            <summary>Comment ça marche ?</summary>
            <ul>
              <li><strong>La ligne du milieu paie.</strong> Paire : une carte de la rareté (de commune à &#128160; mythique), une finition spéciale, un fantôme, un jeton ou une clé. Triple : plusieurs cartes, 5 jetons, des clés… Trois &#128128; : un vrai crâne de dino.</li>
              <li><strong>Cascade</strong> : après un triple, la ligne retombe ; chaque nouvelle combinaison paie ×2, ×3, ×4.</li>
              <li><strong>Mise ×3 ou ×5</strong> : tout est multiplié, et le jackpot n'est complet qu'à ×5.</li>
              <li><strong>3 &#127920; visibles n'importe où</strong> : 5 tours bonus à gains doublés.</li>
              <li><strong>Surchauffe</strong> : à fond, triple garanti. <strong>Paire</strong> : relance le rouleau intrus.</li>
              <li><strong>Quitte ou double</strong> : remets les jetons gagnés en jeu ; le tour suivant gagnant les double.</li>
              <li>La machine prend des niveaux : nouveaux symboles, puis un 4e rouleau. Une heure par semaine, elle s'emballe et paie double.</li>
              <li>Toutes les cartes gagnées ici sont en édition <strong>&#9939;&#65039; Interdite</strong>.</li>
            </ul>
          </details>
        </aside>
      </div>`;
    z.querySelectorAll(".fm-bet").forEach((b) => b.addEventListener("click", () => { bet = Number(b.dataset.bet); try { localStorage.setItem("2gatcha_fm_bet", String(bet)); } catch (e) { /* stockage indisponible */ } refresh(); if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(500 + bet * 80, 0, 0.05, "square", 0.03); }));
    $("fm-spin").addEventListener("click", () => spin(1));
    $("fm-spin10").addEventListener("click", () => spin(10));
    refresh();
    clearInterval(jackpotTimer);
    jackpotTimer = setInterval(liveJackpot, 6000);
  }

  // Tout ce qui depend de l'etat (boutons, jauges, panneaux).
  function refresh() {
    const m = M();
    document.querySelectorAll(".fm-bet").forEach((b) => { const on = Number(b.dataset.bet) === bet; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
    const kind = m.bonusSpins > 0 ? "bonus" : m.freeSpin ? "daily" : m.freeSpins > 0 ? "bank" : "paid";
    $("fm-spin").innerHTML = kind === "bonus" ? `Tour bonus ×2 <small>(${m.bonusSpins})</small>` : kind === "daily" ? "Tour gratuit du jour" : kind === "bank" ? `Tour gratuit <small>(${m.freeSpins})</small>` : `Tirer · ${fmt(m.spinCost * bet)} &#10024;`;
    $("fm-spin").classList.toggle("bonus", kind === "bonus");
    $("fm-spin10").innerHTML = `×10 · ${fmt(m.spinCost * bet * 10)} &#10024;`;
    setJackpot(m.jackpot);
    $("fm-heat-fill").style.width = `${Math.round((m.heat / Math.max(1, m.heatMax)) * 100)}%`;
    $("fm-heat-n").textContent = `${m.heat} / ${m.heatMax}`;
    document.querySelector(".fm-heat").classList.toggle("hot", m.heat >= m.heatMax - 2);
    const lv = m.level;
    const pct = lv.next ? Math.round(((lv.xp - lv.prev) / Math.max(1, lv.next - lv.prev)) * 100) : 100;
    $("fm-level").innerHTML = `<span class="fm-lv">Niv. ${lv.level}</span><div class="fm-lv-bar"><div style="width:${pct}%"></div></div><small>${lv.next ? `${lv.xp - lv.prev} / ${lv.next - lv.prev} XP` : "Niveau max"}</small>`;
    $("fm-free").innerHTML = [m.freeSpins ? `&#127903;&#65039; ${m.freeSpins} tour${m.freeSpins > 1 ? "s" : ""} gratuit${m.freeSpins > 1 ? "s" : ""} en réserve` : "", m.bonusSpins ? `&#127920; ${m.bonusSpins} tour${m.bonusSpins > 1 ? "s" : ""} bonus ×2` : "", m.risk ? `&#127183; ${m.risk} jeton${m.risk > 1 ? "s" : ""} en jeu (quitte ou double)` : ""].filter(Boolean).join(" · ");
    const banner = $("fm-banner");
    banner.hidden = !(m.frenzy || m.bonusSpins);
    banner.innerHTML = m.frenzy ? "&#127744; Heure de folie : gains doublés !" : m.bonusSpins ? `&#127920; Tours bonus : ${m.bonusSpins} restant${m.bonusSpins > 1 ? "s" : ""}, gains ×2` : "";
    banner.className = "fm-banner" + (m.frenzy ? " frenzy" : " bonus");
    $("fm-daily").innerHTML = m.daily.map((d) => `<div class="fm-ch ${d.done ? "done" : ""}"><span>${d.done ? "&#10004;" : "&#9675;"} ${esc(d.label)}</span><div class="fm-ch-bar"><div style="width:${Math.round((d.progress / d.target) * 100)}%"></div></div><small>${d.progress}/${d.target} · +${d.reward} &#127903;&#65039;</small></div>`).join("");
    $("fm-combos").innerHTML = `<div class="fm-combo-grid">${m.combos.map((c) => `<span class="fm-combo ${c.done ? "done" : ""} ${c.locked ? "locked" : ""} ${c.base ? "" : "bonus"}" title="${esc(c.label)}${c.locked ? " (niveau supérieur)" : ""}">${c.locked ? "&#128274;" : c.icon}</span>`).join("")}</div><p class="fm-combo-reward ${m.combosReward.done ? "done" : ""}">${m.combosReward.done ? "&#10004; " : ""}Un triple de chaque symbole de base : ${esc(m.combosReward.label)}</p>`;
    const w = m.week;
    $("fm-week").innerHTML = (w.top.length ? `<ol class="fm-top5">${w.top.map((t) => `<li><strong>${esc(t.pseudo)}</strong> <span>${esc(t.label)}</span> <small>${t.cards ? `${t.cards} carte${t.cards > 1 ? "s" : ""}` : ""}${t.dust ? ` · ${fmt(t.dust)} &#10024;` : ""}</small></li>`).join("")}</ol>` : `<p class="fm-empty">Personne encore cette semaine.</p>`)
      + (w.rarest ? `<p class="fm-rarest">Plus belle carte : <strong style="color:${esc(w.rarest.colorHex || "#fff")}">${esc(w.rarest.card)}</strong> (${esc(w.rarest.rarity)}${w.rarest.finish !== "normal" ? ", " + esc(w.rarest.finish) : ""}) par ${esc(w.rarest.pseudo)}</p>` : "")
      + (m.lastJackpots && m.lastJackpots.length ? `<p class="fm-rarest">Derniers jackpots : ${m.lastJackpots.map((j) => `${esc(j.pseudo)} (${fmt(j.amount)} &#10024;)`).join(" · ")}</p>` : "");
  }

  // Jackpot qui monte en direct (compteur anime).
  let shownJackpot = 0;
  function setJackpot(v) {
    const el = $("fm-jackpot");
    if (!el) return;
    const from = shownJackpot || v;
    shownJackpot = v;
    if (from === v || reduced()) { el.textContent = fmt(v); return; }
    const t0 = performance.now();
    const step = (t) => { const p = Math.min(1, (t - t0) / 900); el.textContent = fmt(Math.round(from + (v - from) * p)); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    if (v > from) el.parentElement.classList.add("tick"), setTimeout(() => el.parentElement.classList.remove("tick"), 600);
  }
  async function liveJackpot() {
    if (busy || document.hidden || !$("fm-jackpot")) return;
    try { const st = await API.post("forbidden", { userId: Session.userId, action: "status" }); if (st.machine) { state.machine.jackpot = st.machine.jackpot; setJackpot(st.machine.jackpot); } } catch (e) { /* plus tard */ }
  }

  // Un rouleau : bande de symboles au hasard puis la colonne finale (haut, ligne, bas).
  const symH = (reel) => reel.clientHeight / 3;
  function animateReel(i, col, duration, heat) {
    return new Promise((resolve) => {
      const reel = document.querySelector(`.fm-reel[data-reel="${i}"]`);
      const strip = reel.querySelector(".fm-strip");
      if (reduced()) { strip.style.transition = "none"; strip.style.transform = "none"; strip.innerHTML = col.map((k) => symHtml(k)).join(""); setTimeout(resolve, 120); return; }
      const filler = 14 + i * 3;
      const current = [...strip.querySelectorAll(".fm-sym")].slice(-3).map((e) => e.dataset.k);
      strip.style.transition = "none";
      strip.innerHTML = [...current, ...Array.from({ length: filler }, randSym), ...col].map((k) => symHtml(k)).join("");
      strip.style.transform = "translateY(0)";
      void strip.offsetWidth;
      const h = symH(reel);
      strip.style.transition = `transform ${duration}ms cubic-bezier(.15,.7,.2,1.02)`;
      strip.style.transform = `translateY(${-(filler + 3) * h}px)`;
      let ticks = 0;
      const tick = setInterval(() => { ticks++; if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(850 + (heat || 0) * 25 + (ticks % 3) * 110, 0, 0.02, "square", 0.018); }, 85);
      setTimeout(() => {
        clearInterval(tick);
        // Bande remise a plat sur la colonne finale (plus de long DOM).
        strip.style.transition = "none";
        strip.innerHTML = col.map((k) => symHtml(k)).join("");
        strip.style.transform = "none";
        reel.classList.remove("stop"); void reel.offsetWidth; reel.classList.add("stop");
        if (typeof Haptics !== "undefined") Haptics.buzz(12);
        if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(220, 0, 0.06, "triangle", 0.05);
        resolve();
      }, duration);
    });
  }

  function cardTile(c) {
    return `<div class="fm-card" data-card-id="${c.cardId}" style="--rc:${esc(c.rarity && c.rarity.colorHex || "#888")}" title="${esc(c.name)} #${c.serialNumber}${c.finish && c.finish !== "normal" ? " · " + esc(c.finish) : ""}">
      ${c.imageId ? `<img src="${API.imageUrl(c.imageId)}" alt="" loading="lazy" />` : `<div class="fm-card-ph">?</div>`}
      <span class="fm-card-ed">&#9939;&#65039;</span>${c.finish && c.finish !== "normal" ? `<span class="fm-card-fin">&#10024;</span>` : ""}
      <small>${esc(c.name)}</small><em>${esc(c.rarity ? c.rarity.name : "")}</em></div>`;
  }
  function gainsHtml(g) {
    const bits = [];
    if (g.dust) bits.push(`+${fmt(g.dust)} &#10024;`);
    if (g.boosters) bits.push(`+${g.boosters} ${resIcon("token")}`);
    if (g.keys) bits.push(`+${g.keys} ${resIcon("key")}`);
    if (g.coins) bits.push(`+${g.coins} ${resIcon("coin")}`);
    if (g.skulls) bits.push(`+${g.skulls} ${resIcon("skull")}`);
    return `${bits.length ? `<div class="fm-gains">${bits.join(" · ")}</div>` : ""}${g.cards && g.cards.length ? `<div class="fm-cards">${g.cards.map(cardTile).join("")}</div>` : ""}`;
  }
  const sumGains = (list) => list.reduce((a, x) => ({ dust: a.dust + (x.dust || 0), boosters: a.boosters + (x.boosters || 0), keys: a.keys + (x.keys || 0), coins: a.coins + (x.coins || 0), skulls: a.skulls + (x.skulls || 0), cards: [...a.cards, ...(x.cards || [])] }), { dust: 0, boosters: 0, keys: 0, coins: 0, skulls: 0, cards: [] });
  function highlightLine(line, cls) {
    const counts = {}; line.forEach((k) => (counts[k] = (counts[k] || 0) + 1));
    const top = Object.keys(counts).find((k) => counts[k] >= 2);
    document.querySelectorAll(".fm-reel").forEach((reel, i) => {
      const mid = reel.querySelectorAll(".fm-sym")[1];
      reel.classList.remove("win", "odd");
      if (top) reel.classList.add(line[i] === top ? "win" : "odd");
      if (mid && cls && line[i] === top) mid.classList.add(cls);
    });
  }
  const celebrate = (r) => {
    const rk = (r.cards || []).map((c) => c.rarity && c.rarity.key).find((k) => k === "legendaire" || k === "unique") || (r.cards && r.cards[0] && r.cards[0].rarity && r.cards[0].rarity.key);
    if (typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal(r.jackpot ? "mythique" : rk || (r.tier === "pair" ? "rare" : "epique"));
    if ((r.tier === "triple" || r.tier === "quad") && typeof confetti === "function") confetti({ particleCount: r.jackpot ? 260 : 90, spread: 90, origin: { y: 0.45 } });
    if (typeof Haptics !== "undefined" && r.tier !== "none") Haptics.buzz(r.tier === "pair" ? 30 : [40, 50, 90]);
  };

  async function spin(count) {
    if (busy || !state || !M()) return;
    busy = true;
    const btns = [$("fm-spin"), $("fm-spin10")];
    btns.forEach((b) => (b.disabled = true));
    const out = $("fm-result");
    out.className = "fm-result";
    out.innerHTML = "";
    document.querySelectorAll(".fm-reel").forEach((r) => r.classList.remove("win", "odd"));
    $("fm-spin").classList.add("pulled");
    const cab = $("fm-cabinet");
    try {
      const res = await API.post("forbidden", { userId: Session.userId, action: "spin", count, bet });
      const heat = M().heat;
      state = res;
      if (M().reels !== document.querySelectorAll(".fm-reel").length) { renderMachine(res); }
      if (count === 1) {
        const r = res.results[0];
        // Presque ! : les rouleaux d'avant s'accordent, le dernier fait durer.
        const line = r.line;
        const tense = line.length >= 3 && line.slice(0, -1).every((k) => k === line[0]);
        const base = 1100;
        const durations = r.window.map((_, i) => base + i * 420 + (tense && i === r.window.length - 1 ? 2200 : 0));
        const anims = r.window.map((col, i) => animateReel(i, col, durations[i], heat));
        if (tense) setTimeout(() => { cab.classList.add("tense"); heartbeat(durations[durations.length - 1] - durations[durations.length - 2]); }, durations[durations.length - 2]);
        await Promise.all(anims);
        cab.classList.remove("tense");
        await showSpin(r, res);
      } else {
        const last = res.results[res.results.length - 1];
        await Promise.all(last.window.map((col, i) => animateReel(i, col, 700 + i * 150, heat)));
        const wins = res.results.filter((r) => r.tier !== "none" || r.dust);
        const all = sumGains(res.results.flatMap((r) => [r, ...(r.cascades || [])]));
        out.className = "fm-result " + (wins.length ? "win" : "");
        out.innerHTML = `<div class="fm-label">10 tours : ${wins.length} gagnant${wins.length > 1 ? "s" : ""}</div>
          <div class="fm-ten">${res.results.map((r) => `<span class="fm-ten-row ${r.tier}">${r.line.map(symIcon).join("")}${r.label ? ` <small>${esc(r.label)}${r.cascades && r.cascades.length ? ` +${r.cascades.length} cascade${r.cascades.length > 1 ? "s" : ""}` : ""}</small>` : ""}</span>`).join("")}</div>
          ${gainsHtml(all)}`;
        if (res.results.some((r) => r.jackpot)) jackpotFx();
        if (wins.length) celebrate({ tier: "triple", cards: all.cards });
      }
      if (res.riskResult) Toast[res.riskResult.won ? "success" : "info"](res.riskResult.won ? `Quitte ou double : gagné ! +${res.riskResult.amount} jetons` : `Quitte ou double : perdu (${res.riskResult.staked} jeton${res.riskResult.staked > 1 ? "s" : ""})`);
      (res.notices || []).forEach((n, i) => setTimeout(() => Toast.success(`${n.icon} ${esc(n.text)}`), 400 + i * 700));
      refresh();
      if (typeof refreshStatus === "function") refreshStatus();
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (e) {
      Toast.error(errText(e));
      if (e.data && e.data.machine) { state.machine = e.data.machine; refresh(); }
    } finally {
      $("fm-spin").classList.remove("pulled");
      btns.forEach((b) => (b.disabled = false));
      busy = false;
    }
  }

  function heartbeat(ms) {
    if (typeof Sfx === "undefined" || !Sfx._tone) return;
    for (let t = 0; t < ms / 1000; t += 0.6) { Sfx._tone(60, t, 0.12, "sine", 0.09); Sfx._tone(55, t + 0.18, 0.1, "sine", 0.07); }
    if (typeof Haptics !== "undefined") Haptics.buzz([30, 150, 30, 400, 30, 150, 30]);
  }

  async function showSpin(r, res) {
    const out = $("fm-result");
    // Tours bonus : les jackpots visibles s'allument.
    if (r.bonusAwarded) document.querySelectorAll('.fm-sym[data-k="jackpot"]').forEach((e) => e.classList.add("lit"));
    highlightLine(r.line);
    const tag = r.kind === "bonus" ? `<div class="fm-forced">&#127920; Tour bonus ×2</div>` : r.kind === "daily" || r.kind === "bank" ? `<div class="fm-kind">Tour gratuit</div>` : r.bet > 1 ? `<div class="fm-kind">Mise ×${r.bet}</div>` : "";
    out.className = `fm-result ${r.tier !== "none" ? "win" : ""} ${r.tier}`;
    out.innerHTML = `${r.forced ? `<div class="fm-forced">&#128293; Surchauffe ! Triple garanti</div>` : ""}${tag}
      <div class="fm-label">${r.label ? esc(r.label) : "Rien cette fois…"}</div>${gainsHtml(r)}`;
    celebrate(r);
    if (r.jackpot) jackpotFx();
    // Cascades : la ligne explose et retombe.
    for (const c of r.cascades || []) {
      await sleep(reduced() ? 300 : 1300);
      document.querySelectorAll(".fm-reel.win .fm-sym:nth-child(2)").forEach((e) => e.classList.add("boom"));
      if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(120, 0, 0.3, "sawtooth", 0.05);
      await sleep(reduced() ? 100 : 420);
      document.querySelectorAll(".fm-reel").forEach((reel, i) => {
        const mid = reel.querySelectorAll(".fm-sym")[1];
        if (mid) mid.outerHTML = symHtml(c.line[i], "drop");
      });
      highlightLine(c.line);
      out.insertAdjacentHTML("beforeend", `<div class="fm-cascade"><div class="fm-label">Cascade ×${c.mult} : ${esc(c.label)}</div>${gainsHtml(c)}</div>`);
      celebrate(c);
      if (c.jackpot) jackpotFx();
    }
    if (r.bonusAwarded) {
      await sleep(reduced() ? 200 : 700);
      out.insertAdjacentHTML("afterbegin", `<div class="fm-bonus-hit">&#127920;&#127920;&#127920; ${r.bonusAwarded} TOURS BONUS ×2 !</div>`);
      if (typeof confetti === "function") confetti({ particleCount: 160, spread: 120, origin: { y: 0.4 }, colors: ["#fbbf24", "#ef4444", "#fde68a"] });
    }
    // Actions apres le tour : relance du rouleau intrus, quitte ou double.
    const acts = [];
    if (M().canNudge) acts.push(`<button type="button" class="btn fm-nudge" id="fm-nudge">&#128260; Relancer le rouleau intrus · ${fmt(M().nudgeCost)} &#10024;</button>`);
    if (M().canRisk) acts.push(`<button type="button" class="btn btn-secondary fm-risk" id="fm-risk">&#127922; Quitte ou double (${M().lastBoosters} ${resIcon("token")})</button>`);
    if (acts.length) out.insertAdjacentHTML("beforeend", `<div class="fm-acts">${acts.join("")}</div>`);
    $("fm-nudge")?.addEventListener("click", nudge);
    $("fm-risk")?.addEventListener("click", riskIt);
  }

  async function nudge() {
    if (busy) return; busy = true;
    const nb = $("fm-nudge"); if (nb) nb.disabled = true;
    try {
      const res = await API.post("forbidden", { userId: Session.userId, action: "nudge" });
      state = res;
      const n = res.nudge;
      await Promise.all(n.changed.map((i) => {
        const reel = document.querySelectorAll(".fm-reel")[i];
        const syms = [...reel.querySelectorAll(".fm-sym")].map((e) => e.dataset.k);
        return animateReel(i, [syms[0], n.line[i], syms[2]], 900, M().heat);
      }));
      const out = $("fm-result");
      out.querySelector(".fm-acts")?.remove();
      if (n.tier === "triple" || n.tier === "quad") {
        highlightLine(n.line);
        out.className = "fm-result win triple";
        out.insertAdjacentHTML("beforeend", `<div class="fm-cascade"><div class="fm-label">Relance réussie : ${esc(n.label)} !</div>${gainsHtml(n)}</div>`);
        celebrate(n);
        if (n.jackpot) jackpotFx();
      } else {
        out.insertAdjacentHTML("beforeend", `<div class="fm-miss">Raté, de si peu…</div>`);
      }
      (res.notices || []).forEach((x, i) => setTimeout(() => Toast.success(`${x.icon} ${esc(x.text)}`), 300 + i * 700));
      refresh();
      if (typeof refreshStatus === "function") refreshStatus();
    } catch (e) { Toast.error(errText(e)); } finally { busy = false; }
  }

  async function riskIt() {
    if (busy) return; busy = true;
    try {
      const res = await API.post("forbidden", { userId: Session.userId, action: "risk" });
      state = res;
      $("fm-risk")?.remove();
      Toast.info(`&#127922; ${res.staked} jeton${res.staked > 1 ? "s" : ""} en jeu : le prochain tour gagnant les double !`);
      refresh();
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (e) { Toast.error(errText(e)); } finally { busy = false; }
  }

  function jackpotFx() {
    const c = $("fm-cabinet");
    c.classList.remove("fm-jackpot-hit"); void c.offsetWidth; c.classList.add("fm-jackpot-hit");
    if (typeof Haptics !== "undefined") Haptics.buzz([80, 40, 80, 40, 240]);
  }

  // ---------------------------------------------------------------- demarrage
  document.addEventListener("DOMContentLoaded", async () => {
    if (!Session.isLoggedIn()) { renderDenied(); return; }
    try {
      state = await API.post("forbidden", { userId: Session.userId, action: "status" });
    } catch (e) { return; }
    if (!state.access) { renderDenied(); return; }
    revealRoom();
    rememberRoom();
    let arrival = false;
    try { arrival = sessionStorage.getItem("2gatcha_fd_arrival") === "1"; sessionStorage.removeItem("2gatcha_fd_arrival"); } catch (e) { arrival = false; }
    if (arrival) document.body.classList.add("fd-arrival");
    if (state.unlocked) renderMachine(state); else renderDoor(state);
  });
})();
