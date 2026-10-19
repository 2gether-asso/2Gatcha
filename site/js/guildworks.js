// Grand Chantier (onglet Ensemble, 2026-10-18) : jeu commun de la semaine
// (api/src/native/guildworks.js). Tout le serveur construit un phare en 5
// etapes avec des ressources des autres jeux ; NG+1 s'il est fini avant la
// fin de la semaine, remise a zero le lundi.

(function () {
  const esc = escHtml;
  const fmt = fmtNum; // core.js
  let busy = false;

  function timeLeft(endsAt) {
    const s = Math.max(0, endsAt - Math.floor(Date.now() / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
    return d ? `${d} j ${h} h` : `${h} h ${Math.floor((s % 3600) / 60)} min`;
  }

  function render(st) {
    const box = document.getElementById("guildworks");
    if (!box) return;
    if (!st.enabled) { box.innerHTML = '<p class="empty-state">Le Grand Chantier est en pause.</p>'; return; }
    const cur = st.stage;
    box.innerHTML = `
      <div class="gw-head">
        <div>
          <h2 class="together-title">&#128508; Le Grand Chantier <span class="gw-level">${st.level ? `NG+${st.level}` : "Niveau 0"}</span></h2>
          <p class="lead" style="font-size:0.85rem;">Tout le serveur construit le phare avec les ressources des autres jeux. Chaque étape terminée récompense ses contributeurs ; phare fini avant la fin de la semaine = nouveau chantier <strong>NG+${st.level + 1}</strong>, plus exigeant et plus généreux. Lundi, tout repart de zéro.</p>
        </div>
        <div class="gw-clock"><small>Fin de la semaine</small><strong>${timeLeft(st.endsAt)}</strong><small>${st.players} joueurs actifs${st.completed ? ` · ${st.completed} phare${st.completed > 1 ? "s" : ""} cette semaine` : ""}</small></div>
      </div>
      <ol class="gw-track">${st.stages.map((s) => `<li class="${s.done ? "done" : s.current ? "current" : ""}"><span class="gw-step-icon" aria-hidden="true">${s.done ? "&#10004;" : s.icon}</span><span>${esc(s.label)}</span></li>`).join("")}</ol>
      ${cur ? `
      <section class="gw-stage">
        <header><span class="gw-stage-icon" aria-hidden="true">${cur.icon}</span><div><h3>Étape ${cur.index + 1} : ${esc(cur.label)}</h3><p>${esc(cur.story)}</p></div>
          <div class="gw-reward">Récompense par contributeur : <strong>${fmt(cur.reward.dust)} &#10024;${cur.reward.boosters ? ` + ${cur.reward.boosters} jeton${cur.reward.boosters > 1 ? "s" : ""} booster` : ""}</strong></div></header>
        <div class="gw-needs">${cur.needs.map((n) => {
          const pct = Math.min(100, Math.round((n.progress / n.target) * 100));
          const left = Math.max(0, n.target - n.progress);
          const canGive = Math.min(left, n.myCap - n.myGiven, n.have);
          const steps = [1, 10].filter((k) => k < canGive);
          return `<div class="gw-need ${n.done ? "done" : ""}">
            <div class="gw-need-top"><span class="gw-need-icon" aria-hidden="true">${n.icon}</span><strong>${esc(n.label)}</strong><span class="gw-need-count">${fmt(n.progress)} / ${fmt(n.target)}</span></div>
            <div class="gw-bar"><span style="width:${pct}%"></span></div>
            <div class="gw-need-foot"><small>Tu as ${fmt(n.have)} · ta part ${fmt(n.myGiven)} / ${fmt(n.myCap)} · ${fmt(n.points)} pt${n.points > 1 ? "s" : ""} l'unité</small>
              <span class="gw-give">${n.done ? '<span class="gw-ok">&#10004; complet</span>' : canGive > 0 ? `${steps.map((k) => `<button type="button" class="btn-ghost" data-gw-give="${n.key}" data-n="${k}">+${k}</button>`).join("")}<button type="button" class="btn" data-gw-give="${n.key}" data-n="${canGive}">Donner ${fmt(canGive)}</button>` : `<small class="muted">${n.myGiven >= n.myCap ? "Ta part est atteinte : aux autres de jouer !" : "Tu n'en as pas assez"}</small>`}</span></div>
          </div>`;
        }).join("")}</div>
      </section>` : ""}
      <div class="gw-side">
        <div><h3>Les bâtisseurs <small>toi : ${fmt(st.myPoints)} pts</small></h3><ol class="cdig-top">${st.top.map((t) => `<li>${esc(t.pseudo)} <strong>${fmt(t.points)}</strong></li>`).join("") || "<li>Personne pour l'instant.</li>"}</ol></div>
        <div><h3>Sur le chantier</h3><ul class="cdig-log">${st.log.map((l) => `<li>${esc(l.text)}</li>`).join("") || "<li>Le chantier attend ses premiers ouvriers.</li>"}</ul></div>
      </div>`;
  }

  async function load() {
    if (!Session.isLoggedIn()) return;
    try { render(await API.guildWorks(Session.userId)); }
    catch (e) { const box = document.getElementById("guildworks"); if (box) box.innerHTML = '<p class="empty-state">Impossible de charger le Grand Chantier.</p>'; }
  }

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-gw-give]");
    if (!b || busy) return;
    busy = true;
    b.disabled = true;
    try {
      const res = await API.guildWorks(Session.userId, "give", { resource: b.dataset.gwGive, amount: Number(b.dataset.n) || 1 });
      render(res);
      Toast.success(`&#128508; ${esc(res.given.label)} ×${fmt(res.given.amount)} apportés au chantier (+${fmt(res.given.points)} pts)`);
      if (res.completed) {
        Toast.success(`&#127881; Étape terminée ! ${res.completed.contributors} contributeur${res.completed.contributors > 1 ? "s" : ""} reçoivent ${fmt(res.completed.reward.dust)} ✨${res.completed.reward.boosters ? ` et ${res.completed.reward.boosters} jeton booster` : ""}.`);
        if (typeof confetti === "function") confetti({ particleCount: 180, spread: 120, origin: { y: 0.5 } });
      }
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (err) {
      Toast.error({ share_reached: "Ta part est atteinte pour cette ressource.", already_full: "Cette ressource est déjà complète.", not_enough: "Tu n'en as pas assez.", not_needed: "Cette ressource n'est plus demandée." }[err.code] || friendlyError(err));
      load();
    } finally { busy = false; }
  });

  window.GuildWorks = { load };
})();
