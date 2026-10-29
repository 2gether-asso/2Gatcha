// Accueil (2026-10-18) : quetes d'histoire (api/src/native/story.js), defis de
// saison (seasonquests.js) et barre d'actions du mode compact mobile.

(function () {
  if (typeof Session === "undefined" || !Session.isLoggedIn()) return;
  const esc = escHtml;
  const REWARD = { BoosterCount: ["jeton booster", "jetons booster", "token"], StardustCount: ["poussière", "poussières", null, "&#10024;"], Worms: ["ver", "vers", "worm"], KeyCount: ["clé", "clés", "key"], BoneCount: ["os", "os", "bone"], GoldBait: ["appât doré", "appâts dorés", "bait"], SpareParts: ["pièce détachée", "pièces détachées", "part"], ChestCount: ["pièce de gatchapon", "pièces de gatchapon", "coin"], XP: ["XP", "XP", null, "&#11088;"] };
  const chips = (r) => Object.entries(r || {}).filter(([k, v]) => REWARD[k] && v > 0).map(([k, v]) => `<span class="st-chip">${REWARD[k][2] ? resIcon(REWARD[k][2]) : REWARD[k][3]} +${v} ${REWARD[k][v > 1 ? 1 : 0]}</span>`).join("");

  // ------------------------------------------------------------ blocs termines
  // (2026-10-30) Un bloc qui n'a plus rien a faire (histoire finie, defis de la
  // semaine tous recuperes) prend de la place pour rien : bouton « Masquer ».
  // Le choix est garde avec une signature (semaine, chapitre...) : le bloc
  // revient tout seul quand il y a du nouveau.
  const DONE_KEY = "2gatcha_done_blocks_" + Session.userId;
  const doneMap = () => { try { return JSON.parse(localStorage.getItem(DONE_KEY) || "{}") || {}; } catch (e) { return {}; } };
  // true = bloc masque (deja ecarte pour cette signature).
  function doneBlock(box, key, sig) {
    if (doneMap()[key] === sig) { box.hidden = true; return true; }
    const head = box.querySelector(".story-head, h2, h3");
    if (head && !box.querySelector("[data-done-hide]")) head.insertAdjacentHTML("beforeend", ` <button type="button" class="btn-ghost done-hide" data-done-hide title="Masquer ce bloc terminé (il reviendra s'il y a du nouveau)" aria-label="Masquer ce bloc terminé">&#10005;</button>`);
    box.querySelector("[data-done-hide]").onclick = () => {
      const m = doneMap(); m[key] = sig;
      try { localStorage.setItem(DONE_KEY, JSON.stringify(m)); } catch (e) { /* stockage indisponible */ }
      box.hidden = true;
      Toast.info("Bloc masqué : il reviendra s'il y a du nouveau.");
    };
    return false;
  }

  // ------------------------------------------------------------ histoire
  function renderStory(v) {
    const box = document.getElementById("story-panel");
    if (!box) return;
    if (!v || !v.enabled || !v.unlocked) { box.hidden = true; return; }
    box.hidden = false;
    if (v.done) {
      box.innerHTML = `<div class="story-head"><h2>&#128214; Histoire</h2><span class="st-count">${v.total} / ${v.total}</span></div><p class="muted">Tu as terminé l'histoire de 2Gatcha. Bravo, héros !</p>`;
      // Signature = nombre de chapitres : un nouveau chapitre fait revenir le bloc.
      doneBlock(box, "story", "fin-" + v.total);
      return;
    }
    const c = v.chapter;
    const ready = c.steps.every((s) => s.complete);
    box.innerHTML = `
      <div class="story-head"><h2>&#128214; Histoire : chapitre ${v.index + 1}</h2><span class="st-count">${v.index} / ${v.total}</span></div>
      <div class="story-scene">
        <span class="story-who" aria-hidden="true">${c.icon || "&#128214;"}</span>
        <div class="story-bubble"><strong>${esc(c.title)}</strong><small>${esc(c.who || "")}</small><p>${esc(c.text || "")}</p></div>
      </div>
      <ul class="story-steps">${c.steps.map((s) => `<li class="${s.complete ? "done" : ""}"><span>${s.complete ? "&#10004;" : "&#9675;"}</span> ${esc(s.label)} <small>${s.progress} / ${s.target}</small></li>`).join("")}</ul>
      <div class="story-foot"><div class="st-chips">${chips(c.reward)}${c.last ? `<span class="st-chip">&#127942; Titre « Héros de 2Gatcha »</span>${c.finalCard ? `<span class="st-chip">&#127183; ${esc(c.finalCard.name)}</span>` : ""}` : ""}</div>
        <button type="button" class="btn" data-story-claim ${ready ? "" : "disabled"}>${ready ? (c.last ? "Terminer l'histoire" : "Lire la suite") : "En cours…"}</button></div>`;
  }
  async function loadStory() { try { renderStory(await API.post("story", { userId: Session.userId, action: "status" })); } catch (e) { /* histoire indisponible */ } }

  // ------------------------------------------------------------ defis de saison
  function renderQuests(v) {
    const box = document.getElementById("season-quests");
    if (!box) return;
    if (!v || !v.enabled) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<h3>&#127919; Défis de saison de la semaine</h3>
      <ul class="sq-list">${v.quests.map((q) => `<li class="${q.claimed ? "done" : q.complete ? "ready" : ""}"><span aria-hidden="true">${q.icon}</span><span class="sq-label">${esc(q.label)} <small>${q.progress} / ${q.target}</small></span>
        ${q.claimed ? `<span class="sq-ok">&#10004; +${q.xp} XP</span>` : `<button type="button" class="btn-secondary" data-sq-claim="${q.key}" ${q.complete ? "" : "disabled"}>+${q.xp} XP de saison</button>`}</li>`).join("")}</ul>
      ${v.allBonus ? `<p class="muted sq-bonus">Les 3 défis réussis : +${v.allBonus} XP de saison en plus${v.allClaimed ? " (obtenu)" : ""}.</p>` : ""}`;
    // Tout recupere cette semaine : masquable jusqu'aux defis de la semaine suivante.
    if (v.quests.length && v.quests.every((q) => q.claimed) && (!v.allBonus || v.allClaimed)) doneBlock(box, "season-quests", String(v.week || v.quests.map((q) => q.key).join(",")));
  }
  async function loadQuests() { try { renderQuests(await API.post("seasonQuests", { userId: Session.userId, action: "status" })); } catch (e) { /* defis indisponibles */ } }

  // ------------------------------------------------------------ mode compact
  function compactBar() {
    if (document.documentElement.dataset.compact !== "1" || document.getElementById("compact-bar")) return;
    const bar = document.createElement("nav");
    bar.id = "compact-bar";
    bar.className = "compact-bar";
    bar.setAttribute("aria-label", "Actions rapides");
    bar.innerHTML = `<button type="button" data-cb="claim">&#127873; Tout récupérer</button><a href="ouverture.html">&#127183; Ouvrir</a><a href="jeux.html">&#127918; Jouer</a>`;
    document.body.appendChild(bar);
    bar.querySelector('[data-cb="claim"]').addEventListener("click", () => { const b = document.getElementById("rc-claim-all"); if (b && !b.disabled && b.offsetParent !== null) b.click(); else Toast.info("Rien à récupérer pour l'instant."); });
  }

  document.addEventListener("click", async (e) => {
    const sc = e.target.closest("[data-story-claim]");
    if (sc) {
      sc.disabled = true;
      try {
        const r = await API.post("story", { userId: Session.userId, action: "claim" });
        renderStory(r);
        Toast.success(r.finale ? `&#127942; Histoire terminée !${r.finale.card ? ` Carte exclusive : ${esc(r.finale.card.name)}.` : ""}${r.finale.title ? ` Titre « ${esc(r.finale.title)} ».` : ""}` : "&#128214; Chapitre terminé : la suite t'attend !");
        if (r.finale && typeof confetti === "function") confetti({ particleCount: 200, spread: 100, origin: { y: 0.4 } });
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) { Toast.error(friendlyError(err)); loadStory(); }
      return;
    }
    const q = e.target.closest("[data-sq-claim]");
    if (q) {
      q.disabled = true;
      try {
        const r = await API.post("seasonQuests", { userId: Session.userId, action: "claim", key: q.dataset.sqClaim });
        renderQuests(r);
        Toast.success(`&#127919; +${r.seasonXp} XP de saison${r.allBonus ? " (bonus des 3 défis compris)" : ""} !`);
        if (typeof window.reloadSeason === "function") window.reloadSeason();
      } catch (err) { Toast.error(friendlyError(err)); loadQuests(); }
    }
  });

  document.addEventListener("DOMContentLoaded", () => { loadStory(); loadQuests(); compactBar(); });
  document.addEventListener("compact:change", compactBar);
  window.HomeMore = { loadStory, loadQuests };
})();
