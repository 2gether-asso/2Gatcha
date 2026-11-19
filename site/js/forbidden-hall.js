// Salle interdite V2 (2026-11-19) : le plan de la salle et son hall.
//  - Plan : 4 espaces en onglets (le hall, les machines, le casino,
//    l'atelier des pierres) au lieu d'une longue page ; ancre #hall,
//    #machines, #casino ou #atelier, dernier espace retenu.
//  - Le hall : reputation du mois et contrats du croupier
//    (api/src/native/forbidden-rep.js), tournoi de la semaine
//    (forbidden-tourney.js), plaque aux sept sceaux (forbidden-seals.js).
//  - Toute reponse des routes forbidden et casino est lue au passage
//    (API.post enveloppe) : reputation a jour, contrats remplis, sceau allume.
// La machine (js/forbidden.js) previent avec les evenements forbidden:machine
// et forbidden:state ; le casino (js/casino.js) et les pierres
// (js/forbidden-stones.js) gardent leurs zones, ce script les range.
(() => {
  if (typeof API === "undefined") return;
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const fmt = fmtNum;
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TABS = [["hall", "🏛️", "Le hall"], ["machines", "🎰", "Les machines"], ["casino", "🃏", "Le casino"], ["atelier", "💎", "L'atelier"]];
  const TAB_KEY = "2gatcha_fh_tab";
  const ERR = { already_joined: "Tu es déjà inscrit au tournoi de la semaine.", not_joined: "Inscris-toi d'abord au tournoi.", tourney_done: "Plus de tours de tournoi cette semaine.", tourney_closed: "Le tournoi est fermé pour le moment.", seals_missing: "Tous les sceaux ne sont pas allumés.", already_solved: "La plaque a déjà parlé." };
  let st = { rep: null, tourney: null, seals: null };
  let built = false, busy = false;
  let tab = (() => { const h = location.hash.slice(1); if (TABS.some(([k]) => k === h)) return h; try { return localStorage.getItem(TAB_KEY) || "machines"; } catch (e) { return "machines"; } })();
  let lastRolls = [];

  // ------------------------------------------------------------ plan
  const zonesOf = (k) => ({
    hall: [$("fh-hall")],
    machines: [$("fd-machine-zone"), document.querySelector('[data-pet-home="paprika"]')],
    casino: [$("cz-doors")],
    atelier: [$("fs-zone")]
  })[k] || [];
  function build() {
    if (built) return;
    const machine = $("fd-machine-zone");
    if (!machine) return;
    built = true;
    const nav = document.createElement("nav");
    nav.id = "fh-nav";
    nav.className = "fh-nav";
    nav.setAttribute("aria-label", "Plan de la salle");
    nav.innerHTML = TABS.map(([k, icon, label]) => `<button type="button" class="fh-tab" data-fh-tab="${k}" aria-pressed="false"><span class="fh-ico" aria-hidden="true">${icon}</span><b>${label}</b><i class="fh-dot" hidden></i></button>`).join("");
    machine.insertAdjacentElement("beforebegin", nav);
    const hall = document.createElement("section");
    hall.id = "fh-hall";
    hall.className = "fh-hall";
    hall.innerHTML = `<div class="fh-col"><section class="fh-card" id="fh-rep"></section><section class="fh-card" id="fh-plaque"></section></div><div class="fh-col"><section class="fh-card" id="fh-tourney"></section></div>`;
    nav.insertAdjacentElement("afterend", hall);
    nav.addEventListener("click", (e) => { const b = e.target.closest("[data-fh-tab]"); if (b) show(b.dataset.fhTab, true); });
    hall.addEventListener("click", onHallClick);
    hall.addEventListener("submit", onPlaque);
    window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (TABS.some(([k]) => k === h)) show(h); });
    show(tab);
    // Le casino et l'atelier arrivent un peu apres : on les range des qu'ils sont la.
    let tries = 0;
    const settle = setInterval(() => { show(tab); if (++tries > 12 || ($("cz-doors") && $("fs-zone"))) clearInterval(settle); }, 500);
  }
  function show(k, user = false) {
    tab = TABS.some(([x]) => x === k) ? k : "machines";
    try { localStorage.setItem(TAB_KEY, tab); } catch (e) { /* stockage indisponible */ }
    if (user && location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
    for (const [x] of TABS) zonesOf(x).forEach((el) => el && el.classList.toggle("fh-off", x !== tab));
    document.querySelectorAll(".fh-tab").forEach((b) => { const on = b.dataset.fhTab === tab; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    if (user && typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(440, 0, 0.04, "triangle", 0.03);
  }
  function dots() {
    const hall = document.querySelector('.fh-tab[data-fh-tab="hall"] .fh-dot');
    if (!hall) return;
    // Pastille : tournoi a jouer, ou plaque prete a graver.
    const todo = (st.tourney && (!st.tourney.joined || st.tourney.left > 0) ? 1 : 0) + (st.seals && st.seals.ready ? 1 : 0);
    hall.hidden = !todo;
  }

  // ------------------------------------------------------------ reputation
  function renderRep() {
    const box = $("fh-rep");
    if (!box) return;
    const r = st.rep;
    if (!r) { box.hidden = true; return; }
    box.hidden = false;
    const pct = r.next ? Math.round(((r.pts - r.prev) / Math.max(1, r.next - r.prev)) * 100) : 100;
    const nextReward = r.tiers[r.tier] ? r.tiers[r.tier].label : null;
    const monthName = new Date(r.month + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "long" });
    box.innerHTML = `
      <h2 class="fh-h">⭐ Réputation de la salle <small>${esc(monthName)}</small></h2>
      <div class="fh-rep-top"><span class="fh-rep-tier">Palier <b>${r.tier}</b>/${r.max}</span><div class="fh-bar" role="img" aria-label="${pct} %"><span style="width:${pct}%"></span></div><small>${fmt(r.pts)}${r.next ? ` / ${fmt(r.next)}` : ""} pts</small></div>
      ${nextReward ? `<p class="fh-next">Prochain palier : <b>${esc(nextReward)}</b></p>` : `<p class="fh-next done">Tous les paliers du mois sont atteints. Bravo, pilier de la salle !</p>`}
      <h3 class="fh-sub">📜 Contrats du croupier <small>aujourd'hui · ${r.contractPoints} pts chacun, +${r.allBonus} les trois</small></h3>
      <ul class="fh-contracts">${r.contracts.map((c) => `<li class="${c.done ? "done" : ""}"><span>${c.done ? "✔" : "○"} ${esc(c.label)}</span><div class="fh-bar small"><span style="width:${Math.round((c.progress / Math.max(1, c.target)) * 100)}%"></span></div><small>${c.progress}/${c.target}</small></li>`).join("")}</ul>
      <p class="fh-muted">Un triple à la machine : +2 pts, un jackpot : +10. Remise à zéro le 1er du mois ; ce qui est gagné reste gagné.</p>
      <details class="fh-tiers"><summary>Les 10 paliers du mois</summary><ol>${r.tiers.map((t, i) => `<li class="${t.got ? "got" : i === r.tier ? "next" : ""}"><b>${fmt(t.at)}</b> ${esc(t.label)}${t.got ? " ✔" : ""}</li>`).join("")}</ol></details>`;
  }

  // ------------------------------------------------------------ tournoi
  const icon = (k) => { const m = window.FMachine && window.FMachine.state() && window.FMachine.state().machine; const s = m && m.symbols ? m.symbols.find((x) => x.key === k) : null; return s ? s.icon : ((st.tourney && st.tourney.table.find((x) => x.key === k)) || {}).icon || "❔"; };
  function renderTourney() {
    const box = $("fh-tourney");
    if (!box) return;
    const t = st.tourney;
    if (!t) { box.hidden = true; return; }
    box.hidden = false;
    const ends = new Date(t.week + "T00:00:00");
    ends.setDate(ends.getDate() + 7);
    const top = t.top.length ? `<ol class="fh-board">${t.top.map((x) => `<li class="${x.userId === Session.userId ? "me" : ""}"><span class="fh-rank">${x.rank}</span><b>${esc(x.pseudo)}</b><span>${fmt(x.score)} pts</span><small>${x.spins} tours</small></li>`).join("")}</ol>` : `<p class="fh-muted">Personne encore cette semaine : à toi l'honneur.</p>`;
    box.innerHTML = `
      <h2 class="fh-h">🏆 Tournoi de la semaine <small>jusqu'au ${ends.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</small></h2>
      <p class="fh-muted">Inscription gratuite. Chacun a <b>${t.budget} tours</b> sur une Classique neutre (sans incrustation ni niveau) : seul le hasard compte. Aucun gain pendant le tournoi, des points ; les récompenses tombent le lundi.</p>
      ${t.joined ? `
        <div class="fh-t-me"><div><small>Mes points</small><strong>${fmt(t.score)}</strong></div><div><small>Classement</small><strong>${t.rank ? `${t.rank}<sup>${t.rank === 1 ? "er" : "e"}</sup>` : "—"}</strong></div><div><small>Tours restants</small><strong>${t.left}</strong></div></div>
        ${t.best ? `<p class="fh-t-best">Meilleur tour : ${(t.best.line || []).map(icon).join("")} ${esc(t.best.label || "")} · ${t.best.points} pts</p>` : ""}
        <div class="fh-actions"><button type="button" class="btn" data-fh-t="spin" data-n="1" ${t.left > 0 ? "" : "disabled"}>Tirer</button><button type="button" class="btn btn-secondary" data-fh-t="spin" data-n="10" ${t.left > 0 ? "" : "disabled"}>10 tours</button></div>
        <div class="fh-rolls" id="fh-rolls">${rollsHtml()}</div>`
        : `<div class="fh-actions"><button type="button" class="btn" data-fh-t="join">S'inscrire au tournoi</button></div>`}
      <h3 class="fh-sub">Classement</h3>${top}
      <details class="fh-tiers"><summary>Points et récompenses</summary>
        <p>Paire : les points du symbole, triple ×5, puis cascades ×2, ×3, ×4.</p>
        <p class="fh-t-table">${t.table.map((x) => `<span>${x.icon} ${x.pts}</span>`).join("")}</p>
        <ol>${t.prizes.map((p) => `<li>${esc(p)}</li>`).join("")}<li>4e à 10e : ${t.topChips} jetons du casino</li><li>Les autres participants : ${t.partChips} jetons</li></ol>
      </details>
      ${t.last && t.last.winner ? `<p class="fh-muted">Semaine passée : ${esc(t.last.winner)} l'a emporté parmi ${t.last.players} joueur${t.last.players > 1 ? "s" : ""}.</p>` : ""}`;
  }
  const rollsHtml = () => lastRolls.length ? `<ul>${lastRolls.map((r) => `<li class="${r.tier}"><span>${r.line.map(icon).join("")}</span>${r.points ? `<b>+${r.points}</b>` : "<i>0</i>"}${r.label ? ` <small>${esc(r.label)}${r.cascades.length ? ` +${r.cascades.length} cascade${r.cascades.length > 1 ? "s" : ""}` : ""}</small>` : ""}</li>`).join("")}</ul>` : "";

  // ------------------------------------------------------------ plaque
  function renderPlaque() {
    const box = $("fh-plaque");
    if (!box) return;
    const s = st.seals;
    if (!s) { box.hidden = true; return; }
    box.hidden = false;
    box.classList.toggle("solved", s.solved);
    box.innerHTML = `
      <h2 class="fh-h">🜂 La plaque aux sept sceaux</h2>
      <p class="fh-plaque-txt">${s.solved ? "La plaque est tiède. Quelque chose, tout au fond, garde un œil ouvert." : "Une plaque de bronze scellée au mur, sous la poussière. Sept sceaux éteints, et des mots gravés autour."}</p>
      <ol class="fh-seals">${s.seals.map((x) => `<li class="${x.lit ? "lit" : ""}"><span class="fh-seal" aria-hidden="true">${x.lit ? x.glyph : ""}</span><div><b>${x.roman}</b>${x.lit ? ` <span class="fh-letter">${esc(x.letter)}</span>` : ""}<p>${esc(x.riddle)}</p></div></li>`).join("")}</ol>
      ${s.ready ? `<form class="fh-plaque-form" id="fh-plaque-form"><label for="fh-word">Les sept lettres s'allument. Grave le mot :</label><div><input id="fh-word" autocomplete="off" maxlength="20" required /><button type="submit" class="btn">Graver</button></div></form>` : s.solved ? "" : `<p class="fh-muted">${s.count}/${s.total} sceaux allumés.</p>`}`;
  }

  function renderAll() { renderRep(); renderTourney(); renderPlaque(); dots(); }

  // ------------------------------------------------------------ actions
  async function onHallClick(e) {
    const b = e.target.closest("[data-fh-t]");
    if (!b || busy) return;
    busy = true;
    b.disabled = true;
    try {
      const op = b.dataset.fhT;
      const res = await API.post("forbidden", { userId: Session.userId, action: "tourney", op, count: Number(b.dataset.n) || 1 });
      if (res.tourney) st.tourney = res.tourney;
      if (res.rolls) {
        lastRolls = [...res.rolls.slice().reverse(), ...lastRolls].slice(0, 12);
        const pts = res.rolls.reduce((s, r) => s + r.points, 0);
        if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(pts ? 760 : 300, 0, 0.08, "square", 0.04);
        if (res.rolls.some((r) => r.tier === "triple" || r.tier === "quad")) { if (typeof confetti === "function" && !reduced()) confetti({ particleCount: 60, spread: 70, origin: { y: 0.4 } }); }
      }
      if (res.joined) Toast.success(`🏆 Inscrit au tournoi : ${res.tourney.budget} tours t'attendent.`);
      renderTourney();
      dots();
    } catch (err) { Toast.error(ERR[err.code] || friendlyError(err)); if (err.data && err.data.tourney) { st.tourney = err.data.tourney; renderTourney(); } } finally { busy = false; }
  }
  async function onPlaque(e) {
    if (e.target.id !== "fh-plaque-form") return;
    e.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const res = await API.post("forbidden", { userId: Session.userId, action: "plaque", word: $("fh-word").value });
      st.seals = res.seals;
      renderPlaque();
      await awakening(res);
      if (window.FMachine) { const s = await API.post("forbidden", { userId: Session.userId, action: "status" }); window.FMachine.reload(s); }
    } catch (err) {
      if (err.code === "wrong_word") { Toast.miss("La plaque reste froide."); const f = $("fh-plaque-form"); if (f) { f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake"); } }
      else Toast.error(ERR[err.code] || friendlyError(err));
    } finally { busy = false; }
  }

  // ------------------------------------------------------------ cinematiques
  function overlay(html, cls, ms = 7000) {
    return new Promise((resolve) => {
      const o = document.createElement("div");
      o.className = `fh-cine ${cls}`;
      o.setAttribute("role", "dialog");
      o.setAttribute("aria-modal", "true");
      o.innerHTML = `<div class="fh-cine-box">${html}<small>(touche pour continuer)</small></div>`;
      const close = () => { o.classList.add("out"); setTimeout(() => o.remove(), 300); document.removeEventListener("keydown", onKey, true); resolve(); };
      const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); close(); } };
      o.addEventListener("click", close);
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(o);
      setTimeout(() => { if (o.isConnected) close(); }, ms);
    });
  }
  function sealCine(s) {
    if (typeof Sfx !== "undefined" && Sfx._tone) { Sfx._tone(90, 0, 0.6, "sawtooth", 0.05); Sfx._tone(180, 0.3, 0.5, "triangle", 0.05); Sfx._tone(360, 0.6, 0.6, "sine", 0.04); }
    if (typeof Haptics !== "undefined") Haptics.buzz([40, 80, 120]);
    return overlay(`<div class="fh-cine-glyph">${s.glyph}</div><p class="fh-cine-roman">Sceau ${esc(s.roman)}</p><div class="fh-cine-letter">${esc(s.letter)}</div><p>Quelque part dans la salle, un sceau s'embrase… (${s.count}/${s.total})</p>`, "seal");
  }
  function awakening(res) {
    if (typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal("mythique");
    if (typeof confetti === "function" && !reduced()) confetti({ particleCount: 200, spread: 120, origin: { y: 0.4 }, colors: ["#f97316", "#fbbf24", "#7f1d1d"] });
    return overlay(`<div class="fh-cine-eye" aria-hidden="true"></div><p class="fh-cine-roman">La plaque s'ouvre</p><p>Sous la salle, quelque chose ouvre un œil.</p><ul>${(res.rewards || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`, "wake", 12000);
  }

  // ------------------------------------------------------------ reponses
  let queue = Promise.resolve();
  function take(res) {
    if (!res || typeof res !== "object") return;
    let dirty = false;
    if (res.rep) { st.rep = res.rep; dirty = true; }
    if (res.tourney && !res.rolls) { st.tourney = res.tourney; dirty = true; }
    if (res.seals) { st.seals = res.seals; dirty = true; }
    (res.repNotices || []).forEach((n, i) => setTimeout(() => Toast.success(`${n.icon || "⭐"} ${esc(n.text)}`), 900 + i * 800));
    if (res.seal) {
      queue = queue.then(() => sealCine(res.seal)).then(async () => {
        try { const r = await API.post("forbidden", { userId: Session.userId, action: "seals" }); st.seals = r.seals; renderPlaque(); dots(); } catch (e) { /* plus tard */ }
      });
    }
    if (dirty && built) renderAll();
  }
  const rawPost = API.post.bind(API);
  API.post = async function (name, body) {
    const res = await rawPost(name, body);
    if (name === "forbidden" || name === "casino") { try { take(res); } catch (e) { /* jamais bloquant */ } }
    return res;
  };

  document.addEventListener("forbidden:state", (e) => {
    const s = e.detail || {};
    if (s.rep !== undefined) st.rep = s.rep;
    if (s.tourney !== undefined) st.tourney = s.tourney;
    if (s.seals !== undefined) st.seals = s.seals;
    build();
    renderAll();
  });
  document.addEventListener("forbidden:machine", build);
})();
