// Accueil (2026-10-07) : rendez-vous du jour (action du jour, heure de
// chance, boite et de du jour, missions du soir, bonus de retour), liste
// "Que faire maintenant ?" et fil du serveur en direct.
// Voir api/src/native/daily.js, insights.js, feed.js.

(function () {
  if (!Session.isLoggedIn()) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const hhmm = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const DICE_GLYPH = ["", "&#9856;", "&#9857;", "&#9858;", "&#9859;", "&#9860;", "&#9861;"];
  let today = null;
  let luckyTimer = null;

  function renderLucky(l) {
    const box = $("today-lucky");
    clearInterval(luckyTimer);
    const draw = () => {
      const t = Date.now() / 1000;
      if (l.active && l.window && t < l.window.end) {
        const m = Math.max(0, Math.ceil((l.window.end - t) / 60));
        box.className = "today-lucky active";
        box.innerHTML = `<span class="today-lucky-icon" aria-hidden="true">&#127808;</span><div><strong>Heure de chance en cours !</strong><small>Encore ${m} min : +${Math.round(l.finishBonus * 100)} pts de finition spéciale, +${Math.round(l.dustBonus * 100)} % de poussières.</small></div><a class="btn" href="ouverture.html">Ouvrir</a>`;
      } else if (l.next) {
        box.className = "today-lucky";
        box.innerHTML = `<span class="today-lucky-icon" aria-hidden="true">&#127808;</span><div><strong>Prochaine heure de chance</strong><small>${new Date(l.next.start * 1000).toDateString() === new Date().toDateString() ? "Aujourd’hui" : "Demain"} de ${hhmm(l.next.start)} à ${hhmm(l.next.end)} : garde tes boosters pour ce moment-là.</small></div>`;
      }
    };
    draw();
    luckyTimer = setInterval(draw, 30000);
  }

  function renderEvening(ev) {
    const block = $("evening-block");
    block.hidden = false;
    $("evening-when").textContent = ev.open ? "jusqu’à minuit" : `dès ${ev.startsAt} h`;
    $("evening-list").innerHTML = ev.missions.map((m) => `
      <li class="evening-mission ${m.done ? "done" : ""} ${m.claimed ? "claimed" : ""} ${ev.open ? "" : "locked"}">
        <span aria-hidden="true">${m.icon}</span>
        <a href="${m.url}">${esc(m.label)}</a>
        <span class="evening-progress">${m.claimed ? "&#10003;" : `${m.progress}/${m.target}`}</span>
      </li>`).join("") + `<li class="evening-reward">${ev.dust} &#10024; par mission, +${ev.bonusDust} &#10024; si les 3 sont faites${ev.bonusClaimed ? " (reçu)" : ""}</li>`;
    $("evening-claim").hidden = !ev.claimable;
  }

  function renderToday(t) {
    today = t;
    $("today-panel").hidden = false;
    $("today-house").innerHTML = `<a href="${t.house.url}" class="today-house-link"><span class="today-house-icon" aria-hidden="true">${t.house.icon}</span><span><small>Action du jour</small><strong>${esc(t.house.label)}</strong></span><span class="today-house-mult">XP ×${t.house.multiplier}</span></a>`;
    renderLucky(t.lucky);
    $("today-box").hidden = !t.box.available;
    const dice = $("today-dice");
    dice.hidden = false;
    dice.disabled = t.dice.rolled;
    $("today-dice-face").innerHTML = t.dice.rolled ? DICE_GLYPH[t.dice.face] : "&#127922;";
    $("today-dice-label").textContent = t.dice.rolled ? `Dé du jour : ${t.dice.face}` : "Lancer le dé du jour";
    const eff = $("today-dice-effect");
    eff.hidden = !t.dice.rolled;
    if (t.dice.rolled && t.dice.effect) eff.innerHTML = `${t.dice.effect.icon} ${esc(t.dice.effect.label)}`;
    renderEvening(t.evening);
    if (t.welcome && t.welcome.pending) showWelcome(t.welcome);
  }

  function showWelcome(w) {
    if (document.getElementById("welcome-dialog")) return;
    const d = document.createElement("dialog");
    d.id = "welcome-dialog";
    d.className = "welcome-dialog";
    d.innerHTML = `
      <h2>&#128075; Bon retour parmi nous !</h2>
      <p>Tu étais absent depuis <strong>${w.days} jours</strong>. Voici un petit colis pour reprendre :</p>
      <div class="welcome-gift"><span>&#127183; ${w.gift.boosters} booster${w.gift.boosters > 1 ? "s" : ""}</span><span>&#10024; ${w.gift.dust} poussières</span></div>
      ${w.news.length ? `<h3>Ce qui a changé</h3><ul class="welcome-news">${w.news.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      ${w.newCards ? `<p class="welcome-cards">&#127381; ${w.newCards} nouvelle${w.newCards > 1 ? "s" : ""} carte${w.newCards > 1 ? "s" : ""} à découvrir.</p>` : ""}
      <div class="actions"><button type="button" class="btn" id="welcome-claim">Récupérer mon colis</button></div>`;
    document.body.appendChild(d);
    try { d.showModal(); } catch (e) { d.setAttribute("open", ""); }
    d.querySelector("#welcome-claim").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        await API.welcomeBack(Session.userId, "claim");
        Toast.success(`&#127873; Colis récupéré : +${w.gift.boosters} booster${w.gift.boosters > 1 ? "s" : ""} et +${w.gift.dust} poussières !`);
        if (typeof confetti === "function") confetti({ particleCount: 120, spread: 100, origin: { y: 0.4 } });
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) { Toast.error("Erreur. (" + err.message + ")"); }
      d.close();
      d.remove();
    });
  }

  async function openBox(btn) {
    btn.disabled = true;
    btn.classList.add("opening");
    try {
      const [res] = await Promise.all([API.dailyBox(Session.userId, "open"), new Promise((r) => setTimeout(r, 900))]);
      btn.classList.remove("opening");
      btn.classList.add("opened");
      btn.querySelector(".today-box-lid").innerHTML = res.item.icon;
      btn.querySelector(".today-box-label").textContent = res.item.label;
      Toast.success(`&#127873; Boîte du jour : ${esc(res.item.label)} !`);
      if (["booster", "chest", "cosmetic"].includes(res.item.type) && typeof confetti === "function") confetti({ particleCount: 90, spread: 80, origin: { y: 0.5 } });
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      setTimeout(() => { btn.hidden = true; }, 4000);
      loadWhatNow();
    } catch (err) { btn.classList.remove("opening"); btn.disabled = false; Toast.error("Erreur. (" + err.message + ")"); }
  }

  async function rollDice(btn) {
    btn.disabled = true;
    const face = $("today-dice-face");
    let n = 0;
    const spin = setInterval(() => { face.innerHTML = DICE_GLYPH[1 + (n++ % 6)]; }, 70);
    btn.classList.add("rolling");
    try {
      const [res] = await Promise.all([API.dailyDice(Session.userId, "roll"), new Promise((r) => setTimeout(r, 1100))]);
      clearInterval(spin);
      btn.classList.remove("rolling");
      face.innerHTML = DICE_GLYPH[res.face];
      $("today-dice-label").textContent = `Dé du jour : ${res.face}`;
      const eff = $("today-dice-effect");
      eff.hidden = false;
      eff.innerHTML = `${res.effect.icon} ${esc(res.effect.label)}`;
      Toast.success(`&#127922; ${res.face} : ${esc(res.effect.label)}`);
      loadWhatNow();
    } catch (err) { clearInterval(spin); btn.classList.remove("rolling"); btn.disabled = false; Toast.error("Erreur. (" + err.message + ")"); }
  }

  async function loadWhatNow() {
    try {
      const res = await API.getWhatNow(Session.userId);
      $("whatnow-panel").hidden = false;
      $("whatnow-list").innerHTML = res.items.length
        ? res.items.slice(0, 9).map((it) => `<li class="whatnow-item ${it.priority >= 80 ? "hot" : ""}"><a href="${it.url}"><span class="whatnow-icon" aria-hidden="true">${it.icon}</span><span>${esc(it.label)}</span><span class="whatnow-go" aria-hidden="true">&#8250;</span></a></li>`).join("")
        : `<li class="whatnow-empty">Tout est fait pour l’instant. Reviens plus tard !</li>`;
    } catch (e) { $("whatnow-panel").hidden = true; }
  }

  // --- fil du serveur ----------------------------------------------------------
  let lastFeedId = 0;
  const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - t); return s < 60 ? "à l’instant" : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : s < 86400 ? `il y a ${Math.floor(s / 3600)} h` : `il y a ${Math.floor(s / 86400)} j`; };
  async function loadFeed() {
    try {
      const res = await API.getServerFeed(lastFeedId);
      const list = $("live-feed");
      if (!res.items.length && !lastFeedId) return;
      $("live-feed-panel").hidden = false;
      const html = res.items.map((it) => `<li class="live-item ${lastFeedId ? "fresh" : ""}">
        <span class="live-icon" aria-hidden="true">${it.icon}</span>
        ${it.card && it.card.imageId ? `<img src="${API.imageUrl(it.card.imageId)}" alt="" loading="lazy" />` : ""}
        <span class="live-text">${it.pseudo ? `<a href="profile.html?pseudo=${encodeURIComponent(it.pseudo)}" class="player-link">${esc(it.pseudo)}</a> ` : ""}${esc(it.text)}</span>
        <time datetime="${new Date(it.at * 1000).toISOString()}">${ago(it.at)}</time></li>`).join("");
      list.insertAdjacentHTML("afterbegin", html);
      while (list.children.length > 12) list.lastElementChild.remove();
      if (res.items.length) lastFeedId = Math.max(lastFeedId, ...res.items.map((x) => x.id));
    } catch (e) { /* fil indisponible */ }
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Connecte : bandeau d'accueil compact (le texte de presentation est pour les visiteurs).
    document.querySelector(".hero-panel")?.classList.add("compact");
    API.getToday(Session.userId).then(renderToday).catch(() => {});
    loadWhatNow();
    loadFeed();
    API.getLeaderboard().then((lb) => {
      if (!lb.topCollectors || !lb.topCollectors.length) return;
      $("live-feed-panel").hidden = false;
      $("top-collectors").hidden = false;
      $("top-collectors-list").innerHTML = lb.topCollectors.slice(0, 5).map((c) => `<li><span class="tc-rank" title="${esc(c.rank.label)}">${c.rank.icon}</span><a href="profile.html?pseudo=${encodeURIComponent(c.pseudo)}" class="player-link">${esc(c.pseudo)}</a><span class="tc-value">${Number(c.value).toLocaleString("fr-FR")} &#10024;</span></li>`).join("");
    }).catch(() => {});
    setInterval(() => { if (!document.hidden) loadFeed(); }, 20000);
    $("today-box").addEventListener("click", (e) => openBox(e.currentTarget));
    $("today-dice").addEventListener("click", (e) => rollDice(e.currentTarget));
    $("evening-claim").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await API.evening(Session.userId, "claim");
        Toast.success(`&#127769; Missions du soir : +${res.claimedDust} poussières !`);
        renderEvening(res);
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) { Toast.error("Erreur. (" + err.message + ")"); }
      btn.disabled = false;
    });
    window.addEventListener("api:claimed", () => setTimeout(loadWhatNow, 500));
  });
})();
