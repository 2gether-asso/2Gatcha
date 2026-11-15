// Communaute V2 (2026-11-15) : « En ce moment », en tete de la page. Ce qui se
// passe maintenant, une pastille par sujet (un clic ouvre l'onglet), et les
// dernieres nouvelles du serveur (fil de feed.js). Lectures habituelles des
// onglets, partagees avec eux par le cache de l'API.
(function () {
  if (typeof Session === "undefined" || !Session.isLoggedIn()) return;
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const uid = () => Session.userId;
  const settled = (p) => (p && p.then ? p.then((v) => v, () => null) : Promise.resolve(null));
  const now = () => Date.now() / 1000;
  // Onglet ferme (fonction coupee, verrou du debutant : style en ligne ou regle du gabarit) ;
  // les onglets des autres rubriques (.cm-out) comptent comme ouverts.
  const shown = (tab) => { const b = $(`tab-${tab}-btn`); if (!b || b.style.display === "none") return false; if (b.classList.contains("cm-out")) return true; return getComputedStyle(b).display !== "none"; };
  const leftTxt = (s) => { s = Math.max(0, Math.round(s)); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d} j ${h} h` : h ? `${h} h ${String(m).padStart(2, "0")}` : `${Math.max(1, m)} min`; };
  const ago = (at) => { const s = Math.max(0, now() - at); return s < 3600 ? `il y a ${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `il y a ${Math.round(s / 3600)} h` : `il y a ${Math.round(s / 86400)} j`; };

  async function load() {
    const u = uid();
    const [boss, goal, machine, auctions, market, trades, feed] = await Promise.all([
      settled(API.getBossStatus(u)), settled(API.communityGoal(u)), settled(API.machineRoom(u)), settled(API.auctions(u, "list")),
      settled(API.listBlackMarket(u)), settled(API.listTrades(u)), settled(API.getServerFeed(0))
    ]);
    const chips = [];
    const chip = (tab, icon, html, hot, href) => {
      if (tab && !shown(tab)) return;
      chips.push(href ? `<a class="cm-chip ${hot ? "hot" : ""}" href="${href}"><span aria-hidden="true">${icon}</span><span>${html}</span></a>`
        : `<button type="button" class="cm-chip ${hot ? "hot" : ""}" data-cm-tab="${tab}"><span aria-hidden="true">${icon}</span><span>${html}</span></button>`);
    };
    if (boss && boss.active) {
      const pct = boss.maxHp ? Math.max(0, Math.round((boss.currentHp / boss.maxHp) * 100)) : 0;
      chip("boss", "&#128128;", `<b>${esc(boss.bossName || "Boss")}</b> : encore ${pct} % de PV${boss.myContribution ? ` · tes dégâts ${fmtNum(boss.myContribution)}` : " · frappe-le !"}`, !boss.myContribution);
    }
    if (goal && goal.target) chip("together", goal.icon || "&#129309;", `<b>${esc(goal.label)}</b> : ${fmtNum(goal.progress)} / ${fmtNum(goal.target)}${goal.endsAt ? ` · fin dans ${leftTxt(goal.endsAt - now())}` : ""}${goal.claimable ? " · <b>part à récupérer</b>" : ""}`, !!goal.claimable);
    if (machine && machine.open) chip("machine", "&#9881;&#65039;", machine.vote ? "Salle des machines : ton vote est enregistré" : `<b>Vote ouvert</b> : choisis le mode du mois prochain${machine.voteClosesAt ? ` · ${leftTxt(machine.voteClosesAt - now())}` : ""}`, !machine.vote);
    const open = (auctions && auctions.open) || [];
    if (open.length) {
      const next = open.map((a) => a.endsAt).filter(Boolean).sort((a, b) => a - b)[0];
      const leading = open.filter((a) => a.leading && !a.mine).length;
      chip("auctions", "&#128296;", `${open.length} enchère${open.length > 1 ? "s" : ""} en cours${next ? ` · la prochaine finit dans ${leftTxt(next - now())}` : ""}${leading ? ` · tu mènes sur ${leading}` : ""}`, false);
    }
    const offers = ((market && market.offers) || []).filter((o) => o.remaining > 0 && (!o.expiresAt || o.expiresAt > now()));
    if (offers.length) chip("market", "&#127761;", `${offers.length} offre${offers.length > 1 ? "s" : ""} au marché noir`, false);
    const incoming = ((trades && trades.trades) || []).filter((t) => t.direction === "incoming" && t.status === "pending").length;
    if (incoming) chip(null, "&#128260;", `<b>${incoming} échange${incoming > 1 ? "s" : ""}</b> à traiter`, true, "trade.html");
    const cnt = $("cm-trades-count");
    if (cnt) { cnt.hidden = !incoming; cnt.textContent = incoming ? String(incoming) : ""; }

    const items = ((feed && feed.items) || []).slice(0, 3);
    const box = $("cm-now");
    if (!box) return;
    box.hidden = !chips.length && !items.length;
    box.innerHTML = `
      <div class="cm-now-head"><h2>En ce moment</h2></div>
      ${chips.length ? `<div class="cm-chips">${chips.join("")}</div>` : ""}
      ${items.length ? `<ul class="cm-live" aria-label="En direct sur le serveur">${items.map((it) => `<li><span aria-hidden="true">${it.icon || "&#128225;"}</span><span>${it.pseudo ? `<a href="profile.html?pseudo=${encodeURIComponent(it.pseudo)}" class="player-link">${esc(it.pseudo)}</a> ` : ""}${esc(it.text)}</span><time datetime="${new Date(it.at * 1000).toISOString()}">${ago(it.at)}</time></li>`).join("")}</ul>` : ""}`;
  }

  document.addEventListener("click", (e) => {
    const c = e.target.closest("#cm-now [data-cm-tab]");
    if (!c) return;
    if (typeof setActiveTab === "function") setActiveTab(c.dataset.cmTab);
    document.querySelector(".cm-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("cm-now")) return;
    // Apres les onglets (communaute.js masque ceux qui sont fermes).
    setTimeout(load, 300);
    let t = null;
    window.addEventListener("api:claimed", () => { clearTimeout(t); t = setTimeout(load, 800); });
    setInterval(() => { if (!document.hidden) load(); }, 120000);
  });
})();
