// La salle des machines (Communaute, 2026-10-14) : une fois par mois, un
// parcours de sacrifices (cles, poussieres, vers, pieces, appats, boosters,
// doublons) qui mene au vote de la difficulte du mois. Suite (2026-10-15) :
// jauge commune, surchauffe (vote double), chef mecanicien, assiduite, vote
// de l'evenement du mois prochain. Donnees : api/src/native/machine.js.

(function () {
  const esc = escHtml;
  const MODE_ICON = { cool: "😎", chill: "🌴", medium: "⚖️", hard: "🔥", chaos: "👾" };
  const MODE_NAME = { cool: "Cool", chill: "Chill", medium: "Medium", hard: "Hard", chaos: "Chaos" };
  const name = (k) => MODE_NAME[k] || k;
  const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
  const when = (t) => new Date(t * 1000).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  function stageHtml(st, s, i) {
    const affordable = s.cost.every((c) => c.have >= c.need);
    const missing = s.cost.filter((c) => c.have < c.need).map((c) => `${fmt(c.need - c.have)} ${c.icon} ${esc(c.label)}`);
    const playable = s.current && st.open;
    return `<li class="mr-stage ${s.done ? "done" : s.current ? "current" : "locked"} ${s.optional ? "optional" : ""}">
      <span class="mr-num" aria-hidden="true">${s.done ? "&#10004;" : s.icon}</span>
      <div class="mr-body">
        <strong>${s.optional ? "Bonus" : i + 1 + "."} ${esc(s.label)}</strong>
        <small>${esc(s.story)}</small>
        ${playable && !affordable ? `<p class="mr-missing">Il te manque encore ${missing.join(" et ")}.</p>` : ""}
        <div class="mr-costs">${s.cost.map((c) => `<span class="mr-cost ${s.done ? "" : c.have >= c.need ? "ok" : "short"}">${c.icon} ${fmt(c.need)} ${esc(c.label)}${s.done ? "" : ` <em>(tu as ${fmt(c.have)})</em>`}</span>`).join("")}</div>
      </div>
      ${playable ? `<button type="button" class="${affordable ? "btn" : "btn-ghost"} mr-go" data-mr-advance data-optional="${s.optional ? 1 : 0}" data-missing="${affordable ? "" : missing.join(" et ")}">${affordable ? (s.optional ? "Surchauffer" : "Sacrifier") : "Pas assez"}</button>` : ""}
    </li>`;
  }

  function render(st) {
    const box = document.getElementById("machine-room");
    if (!box) return;
    const main = st.stages.filter((s) => !s.optional);
    const doneCount = main.filter((s) => s.done).length;
    const power = Math.round((doneCount / main.length) * 100);
    const total = Math.max(1, Object.values(st.votes).reduce((a, b) => a + b, 0));
    const p = st.pressure || { goal: 0 };
    const head = `
      <div class="mr-head">
        <div class="mr-gears ${doneCount ? "spin" : ""}" aria-hidden="true"><span class="g1">&#9881;&#65039;</span><span class="g2">&#9881;&#65039;</span><span class="g3">&#9881;&#65039;</span></div>
        <div>
          <h2>La salle des machines</h2>
          <p class="mr-sub">${st.open
            ? `Une fois par mois : remets la machine en marche en sacrifiant tes ressources, puis vote pour la difficulté du jeu${st.appliesNextMonth ? " du mois prochain" : ""}. Vote ouvert jusqu'au <strong>${when(st.voteClosesAt - 60)}</strong>.${st.lastResult && st.lastResult.winner ? ` <small>Mois dernier, la machine a choisi ${MODE_ICON[st.lastResult.winner] || ""} ${esc(name(st.lastResult.winner))}.</small>` : ""}`
            : st.result ? `La machine a parlé pour ce mois : <strong>${MODE_ICON[st.result.winner] || ""} ${esc(st.result.winner ? name(st.result.winner) : "aucun vote")}</strong> jusqu'au ${when(st.monthEndsAt)}. Elle se rallume le mois prochain.`
            : "La salle est fermée pour ce mois. Elle rouvre le 1er."}</p>
        </div>
        <div class="mr-power" title="Puissance de ta machine"><span style="--p:${power}%"></span><b>${power} %</b></div>
      </div>`;
    const extras = `
      <div class="mr-extras">
        ${p.goal ? `<div class="mr-extra mr-pressure ${p.reached ? "reached" : ""}">
          <strong>&#128202; Pression collective</strong>
          <div class="mr-gauge"><span style="width:${Math.min(100, Math.round((p.finished / p.goal) * 100))}%"></span></div>
          <small>${p.finished}/${p.goal} salles terminées ce mois-ci. ${p.reached ? "Objectif atteint : 1 booster pour chaque participant le 1er du mois !" : "Si l'objectif est atteint, chaque participant reçoit 1 booster le 1er du mois."}</small>
        </div>` : ""}
        <div class="mr-extra">
          <strong>&#128119; Chef mécanicien</strong>
          <small>${st.chief.holder ? `Titre actuel : <b>${esc(st.chief.holder.pseudo)}</b>.` : "Pas encore de chef."} Le plus gros sacrifice du mois gagne le titre et le cadre engrenage jusqu'au mois suivant.</small>
          ${st.chief.top.length ? `<ol class="mr-top">${st.chief.top.map((x) => `<li>${esc(x.pseudo)} <small>${fmt(x.spent)} pts</small></li>`).join("")}</ol>` : ""}
          ${st.spent ? `<small>Toi : ${fmt(st.spent)} points sacrifiés.</small>` : ""}
        </div>
        <div class="mr-extra">
          <strong>&#128197; Assiduité</strong>
          <div class="mr-dots">${Array.from({ length: st.loyalty.needed }, (_, i) => `<span class="${i < st.loyalty.months ? "on" : ""}"></span>`).join("")}</div>
          <small>Termine la salle 3 mois d'affilée pour gagner ${st.loyalty.card ? "une carte promo exclusive" : "3 boosters"}.</small>
        </div>
      </div>`;
    // Total des ressources qu'il manque encore pour les etapes principales restantes.
    const need = new Map();
    st.stages.filter((s) => !s.done && !s.optional).forEach((s) => s.cost.forEach((c) => {
      const k = c.icon + " " + c.label;
      const cur = need.get(k) || { need: 0, have: c.have };
      need.set(k, { need: cur.need + c.need, have: c.have });
    }));
    const short = [...need].filter(([, v]) => v.have < v.need).map(([k, v]) => `${fmt(v.need - v.have)} ${esc(k)}`);
    const summary = st.open && !st.done && need.size ? `<p class="mr-summary">${short.length ? `&#129520; Pour finir la salle, il te manque encore au total : <strong>${short.join(", ")}</strong>.` : "&#9989; Tu as tout ce qu'il faut pour finir la salle d'un coup !"}</p>` : "";
    const path = summary + `<ol class="mr-path">${st.stages.map((s, i) => stageHtml(st, s, i)).join("")}</ol>`;
    const canVote = st.done && !st.vote && st.open;
    const vote = `
      <section class="mr-vote ${st.done ? "" : "locked"}">
        <h3>&#128499;&#65039; Vote : la difficulté ${st.appliesNextMonth ? "du mois prochain" : "du mois"}</h3>
        <p class="mr-sub">${st.done
          ? st.vote ? `Tu as voté <strong>${MODE_ICON[st.vote]} ${esc(name(st.vote))}</strong>${st.overheated ? " (vote double grâce à la surchauffe)" : ""}. Résultat à la fermeture du vote.` : `La machine tourne : choisis le mode de jeu ${st.appliesNextMonth ? "du mois prochain" : "pour le reste du mois"}.${st.overheated ? " Ton vote compte double !" : ""}`
          : "Termine les 5 étapes pour débloquer ton vote."} ${st.voters} joueur${st.voters > 1 ? "s ont" : " a"} voté.</p>
        <div class="mr-modes">${st.modes.map((m) => {
          const v = st.votes[m.key] || 0;
          return `<button type="button" class="mr-mode mode-${m.key} ${st.vote === m.key ? "picked" : ""}" data-mr-vote="${m.key}" ${canVote ? "" : "disabled"}>
            <span class="mr-mode-icon" aria-hidden="true">${MODE_ICON[m.key] || "🎮"}</span><strong>${esc(name(m.key))}</strong>
            <span class="mr-bar"><span style="width:${Math.round((v / total) * 100)}%"></span></span><small>${v} voix</small>
          </button>`;
        }).join("")}</div>
        ${st.eventVote ? `
        <h3 class="mr-event-title">&#127881; Bonus : l'événement du mois prochain</h3>
        <p class="mr-sub">${st.eventVote.mine ? "Merci pour ton vote ! L'événement gagnant sera planifié le 2e week-end du mois." : st.done ? "Choisis l'événement du 2e week-end du mois prochain." : "Se débloque avec le vote."}</p>
        <div class="mr-events">${st.eventVote.options.map((o) => `<button type="button" class="mr-event ${st.eventVote.mine === o.key ? "picked" : ""}" data-mr-event="${o.key}" ${st.done && !st.eventVote.mine && st.open ? "" : "disabled"}><span aria-hidden="true">${o.icon}</span> ${esc(o.label)} <small>${st.eventVote.votes[o.key] || 0}</small></button>`).join("")}</div>` : ""}
        <p class="mr-note">Mode actuel : ${MODE_ICON[st.current] || ""} ${esc(name(st.current))}. En cas d'égalité, le mode le plus équilibré l'emporte.</p>
      </section>`;
    box.innerHTML = head + extras + path + vote;
  }

  async function load() {
    if (!Session.isLoggedIn() || !API.machineRoom) return;
    try { render(await API.machineRoom(Session.userId)); }
    catch (e) { const box = document.getElementById("machine-room"); if (box) box.innerHTML = '<p class="empty-state">Impossible de charger la salle des machines.</p>'; }
  }
  window.loadMachineRoom = load;

  document.addEventListener("DOMContentLoaded", () => {
    const box = document.getElementById("machine-room");
    if (!box) return;
    box.addEventListener("click", async (e) => {
      const adv = e.target.closest("[data-mr-advance]");
      const vote = e.target.closest("[data-mr-vote]");
      const evt = e.target.closest("[data-mr-event]");
      if (!adv && !vote && !evt) return;
      const btn = adv || vote || evt;
      if (adv && adv.dataset.missing) { Toast.error("Il te manque encore " + adv.dataset.missing + " pour cette étape."); return; }
      if (adv) {
        const msg = adv.dataset.optional === "1" ? "Pousser la machine en surchauffe ? Les ressources sont détruites, et ton vote comptera double." : "Sacrifier les ressources de cette étape ? Elles sont détruites pour de bon.";
        if (!(await Confirm.show(msg, { title: "Sacrifice", confirmText: adv.dataset.optional === "1" ? "Surchauffer" : "Sacrifier" }))) return;
      }
      if (vote && !(await Confirm.show(`Voter pour le mode <strong>${MODE_ICON[vote.dataset.mrVote]} ${esc(name(vote.dataset.mrVote))}</strong> ? Un seul vote par mois, définitif.`, { title: "Voter", confirmText: "Voter" }))) return;
      btn.disabled = true;
      try {
        const st = adv ? await API.machineRoom(Session.userId, "advance")
          : vote ? await API.machineRoom(Session.userId, "vote", vote.dataset.mrVote)
          : await API.machineRoom(Session.userId, "voteEvent", null, evt.dataset.mrEvent);
        render(st);
        if (adv) {
          box.querySelector(".mr-gears")?.classList.add("burst");
          Toast.success(st.advanced === "overheat" ? "&#127755; Surchauffe ! Ton vote comptera double." : st.advanced === "calibrate" ? "&#9881;&#65039; La machine tourne à plein régime : tu peux voter !" : "&#9881;&#65039; Sacrifice accepté, la machine gronde…");
          if (st.loyaltyReward) Toast.success(`&#128197; Assiduité : 3 mois d'affilée, tu gagnes ${esc(st.loyaltyReward)} !`);
          if (st.phantom) Toast.info("&#128123; " + esc(st.phantom));
          if (st.advanced === "calibrate" && typeof confetti === "function") confetti({ particleCount: 140, spread: 100, origin: { y: 0.5 } });
        } else Toast.success("&#128499;&#65039; Vote enregistré !");
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) {
        btn.disabled = false;
        Toast.error({ not_enough: "Il te manque des ressources pour cette étape.", room_closed: "La salle est fermée pour ce mois.", already_voted: "Tu as déjà voté ce mois-ci." }[err.code] || friendlyError(err));
      }
    });
  });
})();
