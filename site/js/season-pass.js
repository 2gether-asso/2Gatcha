// Pass de saison V2 (2026-11-15, api/src/native/seasons.js + seasonquests.js) :
// 100 paliers sur le mois, XP de jeu plafonnee par jour + 3 missions du jour.
// Un seul rendu pour l'accueil (data-mode="compact" : les paliers autour de
// toi) et la page Progression (data-mode="full" : les 100 paliers).
//   SeasonPass.mount(el) ; SeasonPass.reload()
(function () {
  if (typeof Session === "undefined" || !Session.isLoggedIn()) return;
  const esc = escHtml;
  const uid = () => Session.userId;
  const hosts = new Set();
  let st = null, sq = null, busy = false;

  const label = (r) => [r.boosters ? `${r.boosters} booster${r.boosters > 1 ? "s" : ""}` : "", r.chests ? `${r.chests} coffre${r.chests > 1 ? "s" : ""}` : "",
    r.keys ? `${r.keys} clé${r.keys > 1 ? "s" : ""}` : "", r.dust ? `${r.dust} poussières` : ""].filter(Boolean).join(" + ");
  const icon = (r) => (r.boosters ? resIcon("token") || "&#127183;" : r.chests ? resIcon("coin") : r.keys ? resIcon("key") : "&#10024;");
  const dateFr = (d) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(d);

  async function reload() {
    const [a, b] = await Promise.all([API.getSeason(uid()).catch(() => null), API.post("seasonQuests", { userId: uid(), action: "status" }).catch(() => null)]);
    st = a; sq = b;
    renderAll();
  }
  function renderAll() { hosts.forEach((h) => render(h)); }

  // Rythme : ou en est le joueur par rapport aux 28 jours vises.
  function paceHtml() {
    const p = st.pace;
    // Mois de bascule : l'ancien pass finit ce mois-ci, le V2 commence au 1er.
    if (p && p.legacy) {
      const next = new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(new Date((st.endsAt + 3600) * 1000));
      return `<p class="sp-pace sp-transition">&#10024; Ce mois-ci se termine avec le pass actuel (${st.tiers.length} paliers). Le <strong>nouveau pass de 100 paliers</strong> commence le 1er ${next} : un peu chaque jour, avec les missions du jour, pour le finir en 28 jours. Les missions comptent déjà ce mois-ci.</p>`;
    }
    if (!p || !p.perDay) return "";
    const left = Math.max(0, p.total - st.xp);
    if (!left) return "";
    const daysNeeded = Math.ceil(left / p.perDay);
    const now = Date.now() / 1000;
    const daysLeft = Math.max(1, Math.ceil((st.endsAt - now) / 86400));
    const finish = new Date(Date.now() + (daysNeeded - 1) * 86400000);
    return `<p class="sp-pace">&#9201;&#65039; Au plus ${p.perDay} XP de saison par jour (${st.xpPerDay} en jouant + ${p.perDay - st.xpPerDay} avec les missions).
      ${daysNeeded <= daysLeft ? `En faisant tes missions chaque jour, le pass est fini le <strong>${dateFr(finish)}</strong>.` : `Il faudrait encore ${daysNeeded} jours de jeu, il en reste ${daysLeft} : chaque mission compte.`}</p>`;
  }

  function tierHtml(t) {
    const cls = t.claimed ? "claimed" : t.reached ? "reached" : "";
    const big = t.tier % 10 === 0 || t.card;
    return `<li class="sp-tier ${cls} ${big ? "big" : ""}" title="Palier ${t.tier} (${t.xp} XP) : ${esc(label(t.reward))}${t.card ? " + la carte " + esc(t.card.name) + " et le titre de la saison" : ""}">
      <span class="sp-tier-n">${t.tier}</span>
      ${t.card ? `<img class="sp-tier-card" src="${API.imageUrl(t.card.imageId) || ""}" alt="" />` : `<span class="sp-tier-ico" aria-hidden="true">${t.claimed ? "&#10003;" : icon(t.reward)}</span>`}
    </li>`;
  }

  function missionsHtml() {
    if (!sq || !sq.enabled) return "";
    const done = sq.quests.filter((q) => q.claimed).length;
    return `<div class="sp-missions">
      <div class="sp-sub"><h3>&#127919; Missions du jour</h3><small>${done}/${sq.quests.length} · nouvelles missions à minuit</small></div>
      <ul>${sq.quests.map((q) => `<li class="${q.claimed ? "done" : q.complete ? "ready" : ""}">
        <span class="sp-m-ico" aria-hidden="true">${q.icon}</span>
        <span class="sp-m-txt">${esc(q.label)}<span class="sp-m-bar"><span style="width:${Math.round((Math.min(q.progress, q.target) / q.target) * 100)}%"></span></span><small>${q.progress} / ${q.target}</small></span>
        ${q.claimed ? `<span class="sp-m-ok">&#10004; +${q.xp}</span>` : `<button type="button" class="btn-secondary" data-sq-claim="${q.key}" ${q.complete && !busy ? "" : "disabled"}>+${q.xp} XP</button>`}
      </li>`).join("")}</ul>
      ${sq.allBonus ? `<p class="sp-m-bonus">Les 3 missions réussies : <strong>+${sq.allBonus} XP</strong> en plus${sq.allClaimed ? " &#10004;" : ""}.</p>` : ""}
    </div>`;
  }

  function chestHtml() {
    const c = st.chest;
    if (!c) return "";
    const prev = c.previous;
    if (prev && prev.claimable) return `<div class="sp-chest ready"><span aria-hidden="true">${resIcon("chest")}</span><div><strong>Coffre de la saison ${esc(prev.label)} prêt !</strong><small>${esc(label(prev.contents))}</small></div><button type="button" class="btn" data-sp-chest>Ouvrir</button></div>`;
    return `<div class="sp-chest"><span aria-hidden="true">${resIcon("chest")}</span><div><strong>Coffre de saison</strong><small>Contient déjà : ${esc(label(c.current.contents) || "rien pour l'instant")} · s'ouvre à la fin du mois</small></div></div>`;
  }

  function render(host) {
    const panel = host.closest(".panel");
    if (!st || !st.enabled) { if (panel && panel.id === "season-panel") panel.style.display = "none"; host.innerHTML = ""; return; }
    if (panel && panel.id === "season-panel") panel.style.display = "block";
    const full = host.dataset.mode === "full";
    const total = st.tiers.length;
    const reached = st.reached;
    const next = st.tiers.find((t) => !t.reached);
    const pct = Math.min(100, (Math.max(st.xp, reached * st.xpPerTier) / (total * st.xpPerTier)) * 100);
    const left = Math.max(0, st.endsAt - Date.now() / 1000);
    const ends = Math.floor(left / 86400) ? `fin dans ${Math.floor(left / 86400)} j` : `fin dans ${Math.max(1, Math.floor(left / 3600))} h`;
    // Compact : 2 paliers derriere, 8 devant ; complet : les 100.
    const from = full ? 0 : Math.max(0, Math.min(total - 10, reached - 2));
    const list = full ? st.tiers : st.tiers.slice(from, from + 10);
    const tierN = st.tierClaimable || 0, bonusN = (st.bonus && st.bonus.claimable) || 0;
    host.innerHTML = `
      <div class="sp-head">
        <div><span class="sp-eyebrow">Saison ${esc(st.label)} · ${ends}</span>
          <div class="sp-big"><b>Palier ${reached}</b><span>/ ${total}</span></div></div>
        <button type="button" class="btn" id="season-claim-btn" ${st.claimable && !busy ? "" : "hidden"}>${tierN ? `Récupérer ${tierN} palier${tierN > 1 ? "s" : ""}${bonusN ? " + bonus" : ""}` : `Bonus de fin de saison (+${bonusN * st.bonus.dustPerTier} &#10024;)`}</button>
      </div>
      <div class="sp-bar" role="img" aria-label="${Math.round(pct)} % du pass"><span style="width:${pct}%"></span></div>
      <p class="sp-xp"><strong>${fmtNum(st.xp)} XP de saison</strong>${next ? ` · palier ${next.tier} dans ${fmtNum(next.xp - st.xp)} XP` : " · pass terminé !"}${st.xpReserve > 0 ? ` · <span class="sp-reserve">&#128274; ${fmtNum(st.xpReserve)} XP de jeu en réserve, libérée ${st.xpPerDay} par jour</span>` : ""}</p>
      ${paceHtml()}
      <ol class="sp-tiers ${full ? "full" : ""}" start="${from + 1}">${list.map(tierHtml).join("")}</ol>
      ${full || total <= 10 ? "" : `<p class="sp-more"><a href="progression.html#saison">Voir les ${total} paliers &#8594;</a></p>`}
      ${missionsHtml()}
      ${chestHtml()}`;
    document.dispatchEvent(new CustomEvent("season:render"));
  }

  async function claim(btn) {
    busy = true; btn.disabled = true;
    try {
      const res = await API.claimSeason(uid());
      const parts = label(res.reward);
      Toast.success(res.claimedTiers ? `&#127942; ${res.claimedTiers} palier${res.claimedTiers > 1 ? "s" : ""} : ${parts || "récompense"}${res.card ? " + la carte " + esc(res.card.name) + " !" : ""}` : `&#127942; Bonus de fin de saison : ${parts} !`);
      if (res.title) setTimeout(() => Toast.success(`&#128081; Nouveau titre : « ${esc(res.title)} »`), 900);
      if (typeof confetti === "function") confetti({ particleCount: res.card ? 220 : 90, spread: 100, origin: { y: 0.6 } });
      st = res;
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      if (typeof loadNavBadges === "function") loadNavBadges();
    } catch (e) { Toast.error(friendlyError(e)); }
    busy = false; renderAll();
  }
  async function claimMission(btn) {
    busy = true; btn.disabled = true;
    try {
      const r = await API.post("seasonQuests", { userId: uid(), action: "claim", key: btn.dataset.sqClaim });
      Toast.success(`&#127919; +${r.seasonXp} XP de saison${r.allBonus ? " (bonus des 3 missions compris)" : ""} !`);
      busy = false;
      await reload();
      return;
    } catch (e) { Toast.error(friendlyError(e)); }
    busy = false; reload();
  }
  async function openChest(btn) {
    busy = true; btn.disabled = true;
    try {
      const res = await API.claimSeasonChest(uid());
      Toast.success(`${resIcon("chest")} Coffre de saison : ${label(res.reward)} !`);
      if (typeof confetti === "function") confetti({ particleCount: 140, spread: 100, origin: { y: 0.6 } });
      st = res;
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (e) { Toast.error(friendlyError(e)); }
    busy = false; renderAll();
  }

  document.addEventListener("click", (e) => {
    const host = e.target.closest("[data-season-pass]");
    if (!host) return;
    const c = e.target.closest("#season-claim-btn");
    if (c && !c.disabled) { claim(c); return; }
    const m = e.target.closest("[data-sq-claim]");
    if (m && !m.disabled) { claimMission(m); return; }
    const ch = e.target.closest("[data-sp-chest]");
    if (ch && !ch.disabled) openChest(ch);
  });

  function mount(el) {
    if (!el) return;
    el.setAttribute("data-season-pass", "");
    hosts.add(el);
    if (st) render(el); else reload();
  }
  document.addEventListener("DOMContentLoaded", () => document.querySelectorAll("[data-season-pass]").forEach(mount));
  window.addEventListener("api:claimed", () => setTimeout(reload, 600));
  window.SeasonPass = { mount, reload };
  window.reloadSeason = reload;
})();
