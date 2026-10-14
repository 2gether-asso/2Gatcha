// La salle des machines (Communaute, 2026-10-14) : une fois par mois, un
// parcours de sacrifices (cles, poussieres, vers, pieces, appats, boosters,
// doublons) qui mene au vote de la difficulte du mois. Donnees :
// api/src/native/machine.js.

(function () {
  const esc = escHtml;
  const MODE_ICON = { cool: "😎", chill: "🌴", medium: "⚖️", hard: "🔥" };
  const MODE_NAME = { cool: "Cool", chill: "Chill", medium: "Medium", hard: "Hard" };
  const name = (k) => MODE_NAME[k] || k;
  const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
  const when = (t) => new Date(t * 1000).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  function render(st) {
    const box = document.getElementById("machine-room");
    if (!box) return;
    const doneCount = st.stages.filter((s) => s.done).length;
    const power = Math.round((doneCount / st.stages.length) * 100);
    const total = Math.max(1, st.voters);
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
    const path = `<ol class="mr-path">${st.stages.map((s, i) => {
      const affordable = s.cost.every((c) => c.have >= c.need);
      const missing = s.cost.filter((c) => c.have < c.need).map((c) => `${fmt(c.need - c.have)} ${c.icon} ${esc(c.label)}`);
      return `<li class="mr-stage ${s.done ? "done" : s.current ? "current" : "locked"}">
        <span class="mr-num" aria-hidden="true">${s.done ? "&#10004;" : s.icon}</span>
        <div class="mr-body">
          <strong>${i + 1}. ${esc(s.label)}</strong>
          <small>${esc(s.story)}</small>
          ${s.current && st.open && !affordable ? `<p class="mr-missing">Il te manque encore ${missing.join(" et ")}.</p>` : ""}
          <div class="mr-costs">${s.cost.map((c) => `<span class="mr-cost ${s.done ? "" : c.have >= c.need ? "ok" : "short"}">${c.icon} ${fmt(c.need)} ${esc(c.label)}${s.done ? "" : ` <em>(tu as ${fmt(c.have)})</em>`}</span>`).join("")}</div>
        </div>
        ${s.current && st.open ? `<button type="button" class="${affordable ? "btn" : "btn-ghost"} mr-go" data-mr-advance data-missing="${affordable ? "" : missing.join(" et ")}">${affordable ? "Sacrifier" : "Pas assez"}</button>` : ""}
      </li>`;
    }).join("")}</ol>`;
    const vote = `
      <section class="mr-vote ${st.done ? "" : "locked"}">
        <h3>&#128499;&#65039; Vote : la difficulté ${st.appliesNextMonth ? "du mois prochain" : "du mois"}</h3>
        <p class="mr-sub">${st.done
          ? st.vote ? `Tu as voté <strong>${MODE_ICON[st.vote]} ${esc(name(st.vote))}</strong>. Résultat à la fermeture du vote.` : `La machine tourne : choisis le mode de jeu ${st.appliesNextMonth ? "du mois prochain" : "pour le reste du mois"}.`
          : "Termine les 5 étapes pour débloquer ton vote."} ${st.voters} joueur${st.voters > 1 ? "s ont" : " a"} voté.</p>
        <div class="mr-modes">${st.modes.map((m) => {
          const pct = Math.round(((st.votes[m.key] || 0) / total) * 100);
          return `<button type="button" class="mr-mode mode-${m.key} ${st.vote === m.key ? "picked" : ""}" data-mr-vote="${m.key}" ${st.done && !st.vote && st.open ? "" : "disabled"}>
            <span class="mr-mode-icon" aria-hidden="true">${MODE_ICON[m.key]}</span><strong>${esc(m.label.replace(/^\S+\s/, ""))}</strong>
            <span class="mr-bar"><span style="width:${pct}%"></span></span><small>${st.votes[m.key] || 0} vote${(st.votes[m.key] || 0) > 1 ? "s" : ""}</small>
          </button>`;
        }).join("")}</div>
        <p class="mr-note">Mode actuel : ${MODE_ICON[st.current] || ""} ${esc(name(st.current))}. En cas d'égalité, le mode le plus équilibré l'emporte.</p>
      </section>`;
    box.innerHTML = head + path + vote;
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
      if (!adv && !vote) return;
      const btn = adv || vote;
      if (adv && adv.dataset.missing) { Toast.error("Il te manque encore " + adv.dataset.missing + " pour cette étape."); return; }
      if (adv) {
        const ok = await Confirm.show("Sacrifier les ressources de cette étape ? Elles sont détruites pour de bon.", { title: "Sacrifice", confirmText: "Sacrifier" });
        if (!ok) return;
      }
      if (vote) {
        const ok = await Confirm.show(`Voter pour le mode <strong>${MODE_ICON[vote.dataset.mrVote]} ${esc(name(vote.dataset.mrVote))}</strong> ? Un seul vote par mois, définitif.`, { title: "Voter", confirmText: "Voter" });
        if (!ok) return;
      }
      btn.disabled = true;
      try {
        const st = adv ? await API.machineRoom(Session.userId, "advance") : await API.machineRoom(Session.userId, "vote", vote.dataset.mrVote);
        render(st);
        if (adv) {
          box.querySelector(".mr-gears")?.classList.add("burst");
          Toast.success(st.done ? "&#9881;&#65039; La machine tourne à plein régime : tu peux voter !" : "&#9881;&#65039; Sacrifice accepté, la machine gronde…");
          if (st.done && typeof confetti === "function") confetti({ particleCount: 140, spread: 100, origin: { y: 0.5 } });
        } else Toast.success("&#128499;&#65039; Vote enregistré !");
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (err) {
        btn.disabled = false;
        Toast.error({ not_enough: "Il te manque des ressources pour cette étape.", room_closed: "La salle est fermée pour ce mois.", already_voted: "Tu as déjà voté ce mois-ci." }[err.code] || "Erreur. (" + err.message + ")");
      }
    });
  });
})();
