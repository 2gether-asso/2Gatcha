// Module charge a la demande par shell.js (ouverture de la cloche).
// Centre de notifications (2026-10-21) : tout au meme endroit, avec des
// actions directes sans changer de page.
// - A faire : echanges recus (accepter, en choisissant l'exemplaire donne,
//   ou refuser), recompenses a recuperer (une par une ou toutes),
//   minuteurs prets (recolter le jardin, accueillir l'explorateur, sinon
//   lien), cartes souhaitees disponibles, notes de mise a jour non lues.
// - Bientot : les minuteurs en cours (GET timers).
// - Historique : les messages des 3 derniers jours (NotificationHistory,
//   ui.js), non lus mis en avant, filtrables par type.
// Routes existantes uniquement (trade, timers, wishlistAlerts, patchNotes,
// RewardsCenter de shell.js).

const NotifCenter = (function () {
  const esc = escHtml;
  const FINISH = { holo: "Holo", gold: "Dorée", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const QUALITY = { damaged: "Usé", worn: "Abîmé", good: "Bon état", mint: "Parfait état" };
  const FILTERS = [["all", "Tout"], ["todo", "À faire"], ["trades", "Échanges"], ["timers", "Minuteurs"], ["history", "Historique"]];
  let root = null, filter = "all", data = null, lastSeen = 0, busy = false;

  const left = (s) => { const m = Math.ceil(s / 60); if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return h < 24 ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${Math.round(h / 24)} j`; };
  const timerIcon = (k) => (k === "pick" ? '<img class="ico-token" src="assets/Fouille/Pioche_01.PNG" alt="" />' : RES_ART[k] ? resIcon(k) : esc(k));

  async function load() {
    const uid = Session.userId;
    const settle = (p) => p.then((v) => v, () => null);
    const [trades, rewards, timers, wish, notes] = await Promise.all([
      settle(API.listTrades(uid)),
      settle(RewardsCenter.collect()),
      settle(API.get("timers", { userId: uid })),
      settle(API.wishlistAlerts(uid)),
      settle(API.get("patchNotes"))
    ]);
    let notesSeen = "";
    try { notesSeen = localStorage.getItem("2gatcha_notes_seen") || ""; } catch (e) { /* stockage indisponible */ }
    const t = timers ? timers.now : Date.now() / 1000;
    const allTrades = (trades && trades.trades) || [];
    data = {
      trades: allTrades.filter((x) => x.direction === "incoming" && x.status === "pending"),
      committed: new Set(allTrades.filter((x) => x.direction === "outgoing" && x.status === "pending" && x.offeredPullId).map((x) => x.offeredPullId)),
      rewards: (rewards && rewards.items) || [],
      deadlines: (rewards && rewards.deadlines) || [],
      ready: ((timers && timers.items) || []).filter((i) => i.ready && i.key !== "day"),
      soon: ((timers && timers.items) || []).filter((i) => !i.ready).map((i) => ({ ...i, inS: i.at - t })),
      wish: (wish && wish.items) || [],
      notes: notes && notes.latest && notes.latest > notesSeen ? notes.latest : null,
      history: NotificationHistory.getAll()
    };
    NotificationHistory.todo = data.trades.length + data.rewards.length;
    renderNotifDot();
  }

  // ------------------------------------------------------------ rendu
  function tradeItem(x) {
    const want = x.requestedCard ? `contre ta carte <strong>${esc(x.requestedCard.name)}</strong>` : "<em>en cadeau</em>";
    return `<li class="nc-item nc-todo" data-kind="trades" data-trade="${x.tradeId}">
      <span class="nc-ico" aria-hidden="true">&#8644;</span>
      <span class="nc-body"><span class="nc-msg"><strong>${esc(x.fromPseudo)}</strong> te propose <strong>${esc(x.offeredCard ? x.offeredCard.name : "?")}</strong> ${want}</span>
        <span class="nc-actions"><button type="button" class="nc-btn nc-ok" data-nc="accept">Accepter</button><button type="button" class="nc-btn" data-nc="decline">Refuser</button><a class="nc-link" href="trade.html">Voir</a></span>
        <span class="nc-pick" hidden></span></span>
    </li>`;
  }
  function rewardItem(it, i) {
    return `<li class="nc-item nc-todo" data-kind="todo" data-reward="${i}"><span class="nc-ico" aria-hidden="true">${it.icon}</span>
      <span class="nc-body"><span class="nc-msg">${it.label}</span><span class="nc-actions"><button type="button" class="nc-btn nc-ok" data-nc="claim">Récupérer</button></span></span></li>`;
  }
  function readyItem(it, i) {
    const act = it.key === "garden" || it.key === "garden-all" ? "Récolter" : it.key === "expedition" ? "Accueillir" : "";
    return `<li class="nc-item nc-todo" data-kind="timers" data-ready="${i}"><span class="nc-ico" aria-hidden="true">${timerIcon(it.icon)}</span>
      <span class="nc-body"><span class="nc-msg">${esc(it.label)} <b class="nc-ready">prêt !</b></span><span class="nc-actions">${act ? `<button type="button" class="nc-btn nc-ok" data-nc="timer">${act}</button>` : ""}<a class="nc-link" href="${esc(it.url)}">Y aller</a></span></span></li>`;
  }
  function historyItem(n) {
    const icons = { success: "&#10003;", error: "&#9888;", info: "&#10024;" };
    return `<li class="nc-item nc-h-${n.type} ${n.ts > lastSeen ? "nc-unread" : ""}" data-kind="history"><span class="nc-ico" aria-hidden="true">${icons[n.type] || icons.info}</span>
      <span class="nc-body"><span class="nc-msg">${n.message}</span><span class="nc-time">${relativeTime(n.ts)}</span></span></li>`;
  }

  function render() {
    if (!root || !data) return;
    const d = data;
    const todoN = d.trades.length + d.rewards.length + d.ready.length + (d.wish.length ? 1 : 0) + (d.notes ? 1 : 0);
    const counts = { all: todoN + d.history.length, todo: todoN, trades: d.trades.length, timers: d.ready.length + d.soon.length, history: d.history.length };
    const show = (k) => filter === "all" || filter === k || (filter === "todo" && ["trades", "todo"].includes(k));
    const sec = (title, body, extra = "") => (body ? `<section class="nc-sec"><h3>${title}${extra}</h3><ul>${body}</ul></section>` : "");
    let html = "";
    if (filter === "all" || filter === "todo" || filter === "trades") html += sec("&#8644; Échanges reçus", d.trades.map(tradeItem).join(""));
    if (show("todo")) {
      html += sec("&#127873; À récupérer", d.rewards.map(rewardItem).join(""), d.rewards.length > 1 ? ` <button type="button" class="nc-btn nc-ok nc-all" data-nc="claim-all">Tout récupérer (${d.rewards.length})</button>` : "");
      const misc = [];
      if (d.wish.length) misc.push(`<li class="nc-item nc-todo" data-kind="todo"><span class="nc-ico" aria-hidden="true">&#11088;</span><span class="nc-body"><span class="nc-msg">${d.wish.length} carte${d.wish.length > 1 ? "s" : ""} de ta liste de souhaits ${d.wish.length > 1 ? "sont disponibles" : "est disponible"} : ${d.wish.slice(0, 3).map((w) => `<strong>${esc(w.card.name)}</strong>`).join(", ")}</span><span class="nc-actions"><a class="nc-link" href="trade.html">Voir où</a></span></span></li>`);
      if (d.notes) misc.push(`<li class="nc-item nc-todo" data-kind="todo"><span class="nc-ico" aria-hidden="true">&#128240;</span><span class="nc-body"><span class="nc-msg">Nouveautés : la mise à jour du ${esc(new Date(d.notes + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" }))} est sortie</span><span class="nc-actions"><a class="nc-link" href="nouveautes.html">Lire</a></span></span></li>`);
      d.deadlines.forEach((x) => misc.push(`<li class="nc-item" data-kind="todo"><span class="nc-ico" aria-hidden="true">${x.icon}</span><span class="nc-body"><span class="nc-msg">${x.label}</span><span class="nc-actions"><a class="nc-link" href="${esc(x.url)}">Y aller</a></span></span></li>`));
      html += sec("&#128204; À voir", misc.join(""));
    }
    if (show("timers")) {
      html += sec("&#9989; Prêt", d.ready.map(readyItem).join(""));
      html += sec("&#9201;&#65039; Bientôt", d.soon.slice(0, 6).map((it) => `<li class="nc-item nc-soon" data-kind="timers"><span class="nc-ico" aria-hidden="true">${timerIcon(it.icon)}</span><span class="nc-body"><span class="nc-msg"><a href="${esc(it.url)}">${esc(it.label)}</a></span><span class="nc-time">dans ${left(it.inS)}</span></span></li>`).join(""), ' <button type="button" class="nc-btn" data-reminders>&#9200; Me prévenir</button>');
    }
    if (show("history")) {
      const unread = d.history.filter((n) => n.ts > lastSeen).length;
      html += sec(`&#128339; Historique${unread ? ` <small class="nc-new">${unread} nouveau${unread > 1 ? "x" : ""}</small>` : ""}`, d.history.map(historyItem).join(""), d.history.length ? ' <button type="button" class="nc-btn" data-nc="clear">Effacer</button>' : "");
    }
    root.innerHTML = `
      <div class="notif-bell-header nc-head"><span>Notifications</span>${todoN ? `<span class="nc-count">${todoN} à faire</span>` : ""}</div>
      <div class="nc-filters" role="tablist" aria-label="Filtrer">${FILTERS.map(([k, label]) => `<button type="button" role="tab" aria-selected="${filter === k}" data-nc-filter="${k}">${label}${counts[k] ? ` <b>${counts[k] > 99 ? "99+" : counts[k]}</b>` : ""}</button>`).join("")}</div>
      <div class="nc-list">${html || `<div class="notif-empty">${filter === "all" ? "Rien de nouveau pour l'instant." : "Rien dans cette catégorie."}</div>`}</div>
      <div id="push-toggle-row"></div>`;
    if (typeof PushNotifs !== "undefined") PushNotifs.renderRow(document.getElementById("push-toggle-row"));
  }

  // ------------------------------------------------------------ actions
  async function refresh() {
    await load();
    render();
    if (typeof loadNavBadges === "function") { API.invalidate && API.invalidate(); loadNavBadges(); }
  }
  async function run(btn, fn, okMsg) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    const label = btn.textContent;
    btn.innerHTML = '<span class="spinner qs-spin"></span>';
    try {
      const res = await fn();
      if (okMsg) Toast.success(typeof okMsg === "function" ? okMsg(res) : okMsg);
      busy = false;
      await refresh();
    } catch (e) {
      busy = false;
      btn.disabled = false;
      btn.textContent = label;
      Toast.error(typeof friendlyError === "function" ? friendlyError(e) : e.message);
    }
  }
  function copyLabel(c) {
    const ed = c.edition && EDITIONS[c.edition] ? `${EDITIONS[c.edition].icon} ${EDITIONS[c.edition].label}` : "";
    return [c.serialNumber != null ? "#" + String(c.serialNumber).padStart(3, "0") : "?", ed, FINISH[c.finish] || "", QUALITY[c.quality] || ""].filter(Boolean).join(" · ");
  }
  // Accepter un echange qui demande une de mes cartes : choisir l'exemplaire
  // donne (les plus precieux en dernier, jamais un exemplaire deja propose).
  async function pickCopy(li, trade) {
    const box = li.querySelector(".nc-pick");
    box.hidden = false;
    box.innerHTML = '<span class="spinner qs-spin"></span>';
    let copies = [];
    try {
      const col = await API.getCollection(Session.userId);
      const owned = (col.owned || []).find((o) => o.cardId === trade.requestedCard.id);
      const ed = col.editionPulls || {};
      copies = ((owned && owned.copies) || []).filter((c) => !data.committed.has(c.pullId)).map((c) => ({ ...c, edition: ed[c.pullId] || null }));
      const rank = (c) => (c.edition ? 4 : 0) + (c.serialNumber === 1 ? 2 : 0) + (c.finish && c.finish !== "normal" ? 1 : 0);
      copies.sort((a, b) => rank(a) - rank(b));
    } catch (e) { /* liste vide */ }
    if (!copies.length) { box.innerHTML = '<span class="nc-warn">Aucun exemplaire disponible (ou tous déjà proposés ailleurs).</span>'; return; }
    box.innerHTML = `<label>Exemplaire donné <select data-nc-copy>${copies.map((c) => `<option value="${c.pullId}">${esc(copyLabel(c))}</option>`).join("")}</select></label><button type="button" class="nc-btn nc-ok" data-nc="accept-go">Confirmer</button>`;
    box.querySelector("select").focus();
  }

  function onClick(e) {
    // Le contenu est redessine apres chaque action : le clic ne doit pas
    // remonter jusqu'au « clic en dehors » qui refermerait la cloche.
    if (e.target.closest("[data-reminders]")) return; // shell-extras.js s'en charge (document)
    e.stopPropagation();
    const f = e.target.closest("[data-nc-filter]");
    if (f) { filter = f.dataset.ncFilter; render(); return; }
    const btn = e.target.closest("[data-nc]");
    if (!btn) return;
    const act = btn.dataset.nc;
    const li = btn.closest(".nc-item");
    const uid = Session.userId;
    if (act === "clear") { NotificationHistory.clear(); data.history = []; render(); return; }
    if (act === "claim-all") {
      run(btn, () => RewardsCenter.claimAll(data.rewards), (r) => `&#127873; ${r.done.length} récompense${r.done.length > 1 ? "s" : ""} récupérée${r.done.length > 1 ? "s" : ""}${r.failed.length ? ` (${r.failed.length} en échec)` : ""}.`);
      return;
    }
    if (act === "claim") {
      const it = data.rewards[Number(li.dataset.reward)];
      if (it) run(btn, () => it.claim(), (r) => `${it.icon} ${it.label}${it.describe && it.describe(r || {}) ? " : " + it.describe(r || {}) : ""}`);
      return;
    }
    if (act === "timer") {
      const it = data.ready[Number(li.dataset.ready)];
      if (!it) return;
      if (it.key === "expedition") run(btn, () => API.expedition(uid, "claim"), "&#129517; L'explorateur est de retour : récompense récupérée !");
      else run(btn, () => API.garden(uid, "harvest"), (r) => { const g = (r && r.gained) || {}; return `&#129530; Jardin récolté${g.worms ? ` : +${g.worms} vers` : ""}.`; });
      return;
    }
    const trade = li && data.trades.find((x) => String(x.tradeId) === li.dataset.trade);
    if (!trade) return;
    if (act === "decline") { run(btn, () => API.respondTrade(uid, Number(trade.tradeId), false, null), "Échange refusé."); return; }
    if (act === "accept") {
      if (trade.requestedCard) { pickCopy(li, trade); return; }
      run(btn, () => API.respondTrade(uid, Number(trade.tradeId), true, null), "&#129309; Échange accepté !");
      return;
    }
    if (act === "accept-go") {
      const pull = Number(li.querySelector("[data-nc-copy]").value);
      if (pull) run(btn, () => API.respondTrade(uid, Number(trade.tradeId), true, pull), "&#129309; Échange accepté !");
    }
  }

  async function open(el, seen) {
    if (!el || !Session.isLoggedIn()) return;
    root = el;
    lastSeen = seen || 0;
    root.classList.add("nc-root");
    if (!root._nc) { root._nc = true; root.addEventListener("click", onClick); }
    if (data) render();
    try { await load(); } catch (e) { return; }
    render();
  }

  return { open };
})();
