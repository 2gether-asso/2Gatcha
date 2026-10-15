// Communaute (2026-10-15) : onglet "Tableau d'affichage" (loterie du
// dimanche, avis de recherche, carte fantome du mois, classement Hard, livre
// d'or des premieres) et onglet "Equipes" (guerre des equipes mensuelle).
// Donnees : api/src/native/lottery.js, wanted.js, phantom.js, modeextras.js,
// halloffame.js, teams.js.

(function () {
  const esc = escHtml;
  const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
  const date = (t) => new Date(t * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  const when = (t) => new Date(t * 1000).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const img = (c) => (c && c.imageId ? API.imageUrl(c.imageId) : "");
  const settle = (p) => p.then((v) => v, () => null);
  const untilLabel = (t) => { const s = t - Date.now() / 1000; if (s <= 0) return "imminent"; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return d ? `dans ${d} j ${h} h` : `dans ${h} h ${Math.ceil((s % 3600) / 60)} min`; };

  // ------------------------------------------------------------------ tableau d'affichage
  function lotteryHtml(l) {
    if (!l || !l.enabled) return "";
    const left = Math.max(0, l.cap - l.tickets);
    return `
      <article class="board-card board-lottery" id="board-lottery">
        <header><span class="board-icon" aria-hidden="true">&#127903;&#65039;</span><div><h3>Loterie du dimanche</h3><small>Tirage ${esc(when(l.drawAt))} · ${esc(untilLabel(l.drawAt))}</small></div></header>
        <p class="board-pot"><span>Cagnotte</span><strong>${fmt(l.pot)} &#10024;</strong></p>
        <p class="board-meta">${l.totalTickets} ticket${l.totalTickets > 1 ? "s" : ""} vendu${l.totalTickets > 1 ? "s" : ""} · ${l.players} joueur${l.players > 1 ? "s" : ""}${l.tickets ? ` · <strong>tes tickets : ${l.tickets}</strong> (${l.chance} % de chances)` : ""}</p>
        <div class="board-actions">
          <button type="button" class="btn" data-lottery="1" ${left ? "" : "disabled"}>1 ticket · ${fmt(l.price)} &#10024;</button>
          <button type="button" class="btn-ghost" data-lottery="5" ${left >= 5 ? "" : "disabled"}>5 tickets · ${fmt(l.price * 5)} &#10024;</button>
          ${Math.min(left, Math.floor((l.stardust || 0) / l.price)) > 5 ? `<button type="button" class="btn-ghost" data-lottery="${Math.min(left, Math.floor((l.stardust || 0) / l.price))}">Max (${Math.min(left, Math.floor((l.stardust || 0) / l.price))})</button>` : ""}
        </div>
        <small class="board-note">${left ? `Encore ${left} ticket${left > 1 ? "s" : ""} possible${left > 1 ? "s" : ""} cette semaine.` : "Plafond de la semaine atteint."} Une partie de chaque ticket est détruite, le reste va dans la cagnotte.</small>
        ${l.last ? `<p class="board-last">Dernier gagnant : <strong>${esc(l.last.pseudo)}</strong>, ${fmt(l.last.pot)} &#10024; (${l.last.tickets} ticket${l.last.tickets > 1 ? "s" : ""} sur ${l.last.totalTickets})</p>` : ""}
      </article>`;
  }
  function wantedHtml(w) {
    if (!w || !w.enabled || !w.card) return "";
    const full = w.donors.length >= w.slots;
    return `
      <article class="board-card board-wanted" id="board-wanted">
        <header><span class="board-icon" aria-hidden="true">&#128220;</span><div><h3>Avis de recherche</h3><small>Le serveur réclame cette carte cette semaine</small></div></header>
        <div class="wanted-body">
          <div class="wanted-poster"><span>RECHERCHÉE</span><img src="${img(w.card)}" alt="" loading="lazy" /><strong>${esc(w.card.name)}</strong></div>
          <div class="wanted-info">
            <p>Les <strong>${w.slots} premiers</strong> à en donner un doublon gagnent <strong>${fmt(w.reward)} &#10024;</strong> (le tout premier : une &#128273; en plus). La carte rejoint le coffre de guilde.</p>
            <ol class="wanted-slots">${Array.from({ length: w.slots }, (_, i) => `<li class="${w.donors[i] ? "taken" : ""}">${w.donors[i] ? esc(w.donors[i].pseudo) : "libre"}</li>`).join("")}</ol>
            ${w.donated ? '<p class="board-ok">&#10004; Merci pour ton don !</p>' : full ? '<p class="board-note">Toutes les places sont prises. Nouvel avis lundi.</p>'
              : `<button type="button" class="btn" data-wanted ${w.canDonate ? "" : "disabled"}>${w.canDonate ? "Donner un doublon" : w.myCopies ? "Il te faut un doublon" : "Tu ne l'as pas encore"}</button>`}
          </div>
        </div>
      </article>`;
  }
  function phantomHtml(p) {
    if (!p || !p.enabled) return "";
    const found = p.fragments.filter((f) => f.found).length;
    return `
      <article class="board-card board-phantom" id="board-phantom">
        <header><span class="board-icon" aria-hidden="true">&#128123;</span><div><h3>Carte fantôme du mois</h3><small>${found}/5 fragments${p.hint && p.hint.rarity && !p.done ? ` · une carte ${esc(p.hint.rarity)}` : ""}</small></div></header>
        <div class="phantom-body">
          <div class="phantom-card ${p.done ? "revealed" : ""}">${p.done && p.card ? `<img src="${img(p.card)}" alt="" /><strong>${esc(p.card.name)}</strong>` : '<span aria-hidden="true">?</span>'}</div>
          <ul class="phantom-frags">${p.fragments.map((f) => `<li class="${f.found ? "found" : ""}" title="${esc(f.label)}${f.sure ? " : fragment garanti" : " : au hasard en jouant"}"><span aria-hidden="true">${f.icon}</span>${esc(f.label)}${f.found ? " &#10004;" : ""}</li>`).join("")}</ul>
        </div>
        <small class="board-note">${p.done ? "Reconstituée ! Elle est dans ta collection, en édition Fantôme." : "Pêche, fouille et jardin : un fragment de temps en temps. Boss et salle des machines : fragment garanti."}</small>
      </article>`;
  }
  function hardHtml(h) {
    if (!h || (!h.active && !h.top.length)) return "";
    return `
      <article class="board-card board-hard" id="board-hard">
        <header><span class="board-icon" aria-hidden="true">&#128293;</span><div><h3>Classement Hard</h3><small>${h.active ? "Points gagnés depuis le passage en Hard" : "Dernière période Hard"}</small></div></header>
        <ol class="board-rank">${h.top.map((r) => `<li><span>${r.rank}.</span> ${esc(r.pseudo)} <strong>${fmt(r.score)} pts</strong></li>`).join("") || "<li>Personne pour l'instant.</li>"}</ol>
        ${h.me ? `<p class="board-meta">Toi : ${h.me.rank}e avec ${fmt(h.me.score)} points.</p>` : ""}
      </article>`;
  }
  function hallHtml(f) {
    if (!f) return "";
    const rows = (list) => list.map((e) => `<li><span class="hall-icon" aria-hidden="true">${e.icon}</span><span class="hall-label">${esc(e.label)}</span><strong>${esc(e.pseudo)}</strong><small>${date(e.at)}</small></li>`).join("");
    const empty = !f.mythics.length && !f.finishes.length && !f.editions.length && !(f.dinos || []).length;
    return `
      <article class="board-card board-hall" id="board-hall">
        <header><span class="board-icon" aria-hidden="true">&#128214;</span><div><h3>Livre d'or des premières</h3><small>Les premiers du serveur, gravés pour toujours</small></div></header>
        ${empty ? '<p class="board-note">Encore aucune première. À toi de jouer !</p>' : `
        <div class="hall-cols">${[["🌟 Mythiques", f.mythics], ["✨ Finitions & maîtres", f.finishes], ["💠 Éditions limitées", f.editions], ...((f.dinos || []).length ? [["🦖 Dinos", f.dinos]] : [])].map(([title, list]) => `
          <section class="hall-col"><h4>${title} <small>(${list.length})</small></h4>${list.length ? `<ul class="hall-list">${rows(list)}</ul>` : '<p class="board-note">Pas encore de première.</p>'}</section>`).join("")}</div>`}
      </article>`;
  }

  async function loadBoard() {
    const box = document.getElementById("board-zone");
    if (!box || !Session.isLoggedIn()) return;
    const uid = Session.userId;
    const [l, w, p, h, f] = await Promise.all([settle(API.lottery(uid)), settle(API.wanted(uid)), settle(API.phantom(uid)), settle(API.hardLeaderboard(uid)), settle(API.hallOfFame())]);
    box.innerHTML = [lotteryHtml(l), wantedHtml(w), phantomHtml(p), hardHtml(h), hallHtml(f)].join("") || '<p class="empty-state">Rien d\'affiché pour le moment.</p>';
  }
  window.loadBoard = loadBoard;

  // ------------------------------------------------------------------ equipes
  async function loadTeams() {
    const box = document.getElementById("teams-zone");
    if (!box || !Session.isLoggedIn()) return;
    let t;
    try { t = await API.teams(Session.userId); } catch (e) { box.innerHTML = '<p class="empty-state">Impossible de charger les équipes.</p>'; return; }
    if (!t.enabled) { box.innerHTML = '<p class="empty-state">La guerre des équipes est en pause.</p>'; return; }
    const max = Math.max(1, ...t.teams.map((x) => x.points));
    const mine = t.teams.find((x) => x.key === t.myTeam);
    box.innerHTML = `
      <div class="teams-head">
        <div><h2>Guerre des équipes : ${esc(t.monthLabel)}</h2>
        <p class="lead">Toute activité (boosters, pêche, fouille, jardin, boss, échanges…) rapporte des points à ton équipe. Fin le ${esc(when(t.endsAt - 60))} : les membres de l'équipe gagnante reçoivent un titre de champion.</p></div>
        ${mine ? `<div class="teams-mine" style="--team:${mine.color}"><span aria-hidden="true">${mine.icon}</span><div><small>Ton équipe</small><strong>${esc(mine.label)}</strong><small>${fmt(t.myPoints)} pts apportés</small></div></div>` : ""}
      </div>
      <div class="teams-grid">${t.teams.map((x, i) => `
        <article class="team-card ${x.key === t.myTeam ? "mine" : ""}" style="--team:${x.color}">
          <header><span class="team-rank">${i + 1}</span><span aria-hidden="true">${x.icon}</span><strong>${esc(x.label)}</strong><small>${x.members} membre${x.members > 1 ? "s" : ""}</small></header>
          <div class="team-bar"><span style="width:${Math.round((x.points / max) * 100)}%"></span></div>
          <p class="team-points">${fmt(x.points)} pts</p>
          <ol class="team-top">${x.top.map((m) => `<li>${esc(m.pseudo)} <small>${fmt(m.points)}</small></li>`).join("") || "<li><small>Pas encore de points</small></li>"}</ol>
        </article>`).join("")}</div>
      ${t.last && t.last.winner ? `<p class="board-last">Mois dernier : victoire de l'équipe <strong>${esc((t.last.teams.find((x) => x.key === t.last.winner) || {}).label || t.last.winner)}</strong>.</p>` : ""}
      <details class="teams-points"><summary>Barème des points</summary><p>${Object.entries({ boosterOpened: "booster ouvert", fish: "lancer de pêche", board: "grille de fouille", harvest: "récolte", bossAttack: "carte envoyée au boss", expedition: "expédition", tradeDone: "échange", guess: "carte devinée", craft: "craft", chestOpened: "coffre", communityDig: "fouille commune", wheel: "roue", vaultRow: "ligne du coffre-fort" }).map(([k, v]) => `${esc(v)} : ${t.points[k] || 0}`).join(" · ")}</p></details>`;
  }
  window.loadTeams = loadTeams;

  // ------------------------------------------------------------------ actions
  document.addEventListener("click", async (e) => {
    const lot = e.target.closest && e.target.closest("[data-lottery]");
    const wan = e.target.closest && e.target.closest("[data-wanted]");
    if (!lot && !wan) return;
    const btn = lot || wan;
    if (wan && !(await Confirm.show("Donner un doublon de la carte recherchée ? Il rejoint le coffre de guilde.", { title: "Avis de recherche", confirmText: "Donner" }))) return;
    btn.disabled = true;
    try {
      if (lot) {
        const n = Number(lot.dataset.lottery);
        if (n > 5 && !(await Confirm.show(`Acheter ${n} tickets d'un coup ?`, { title: "Loterie", confirmText: "Acheter" }))) { btn.disabled = false; return; }
        const r = await API.lottery(Session.userId, "buy", n);
        Toast.success(`&#127903;&#65039; ${r.bought} ticket${r.bought > 1 ? "s" : ""} acheté${r.bought > 1 ? "s" : ""} ! Cagnotte : ${fmt(r.pot)} ✨`);
      } else {
        const r = await API.wanted(Session.userId, "donate");
        Toast.success(`&#128220; Merci ! +${fmt(r.reward.dust)} ✨${r.reward.key ? " et 1 🔑" : ""}`);
      }
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      loadBoard();
    } catch (err) {
      btn.disabled = false;
      Toast.error({ not_enough_dust: "Pas assez de poussières.", weekly_cap: "Plafond de tickets de la semaine atteint.", need_duplicate: "Il te faut un doublon de cette carte.", slots_full: "Toutes les places sont prises.", already_donated: "Tu as déjà donné cette semaine." }[err.code] || friendlyError(err));
    }
  });
})();
