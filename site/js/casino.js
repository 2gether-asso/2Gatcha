// Casino de la Salle Interdite (2026-10-25), salamandre.html. Tout est tire
// par le serveur (api/src/native/casino.js) : ici on anime le resultat.
// Jetons = mises (caisse), tickets = lots.
// 2026-10-26 : la machine a sous reste l'attraction de la piece ; sous elle,
// des portes ouvrent les autres salles EN PLEIN ECRAN, construites comme la
// page Jeux (onglets, titre, texte d'intro, boutons du site), habillees en
// casino (ampoules, neons). Le niveau de la machine ouvre les salles une a une
// (cadenas sinon) ; les jetons peuvent aussi payer la machine (js/forbidden.js).

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const fmt = fmtNum;
  const ERR = {
    not_enough_chips: "Pas assez de jetons : passe à la caisse.", not_enough_dust: "Pas assez de poussières.", not_enough_tickets: "Pas assez de tickets.",
    invalid_bet: "Mise impossible.", daily_limit: "Plus de parties aujourd'hui pour ce jeu.", already_claimed: "Déjà récupéré aujourd'hui.",
    hand_in_progress: "Une main est déjà en cours.", game_in_progress: "Une partie est déjà en cours.", ticket_pending: "Gratte d'abord ton ticket en cours.",
    already_owned: "Tu l'as déjà.", casino_closed: "Le casino est fermé pour le moment.", locked: "La porte est encore fermée.", game_locked: "Cette salle ouvre avec un niveau de machine plus haut."
  };
  // Ordre des salles = ordre d'ouverture (niveau de la machine : GAME_LEVEL de slots.js).
  const GAMES = [
    { key: "scratch", icon: "🎫", label: "Grattage", lead: "Un ticket gratuit chaque jour, d'autres contre des jetons. Gratte la surface argentée : trois symboles identiques et le lot est à toi." },
    { key: "lots", icon: "🎁", label: "Comptoir des lots", lead: "Les tickets gagnés dans les salles s'échangent ici : jetons booster, clés, ressources, une carte Interdite, et des cosmétiques qu'on ne trouve nulle part ailleurs." },
    { key: "blackjack", icon: "🃏", label: "Blackjack", lead: "Approche-toi le plus possible de 21 sans le dépasser. La banque tire jusqu'à 17 ; un blackjack paie 3 pour 2." },
    { key: "cans", icon: "🥫", label: "Chamboule-tout", lead: "Dix boîtes aux couleurs des raretés, trois balles. Attrape la balle, tire-la vers l'arrière et lâche : le sens vise, la longueur donne la force. Tout par terre = points doublés." },
    { key: "plinko", icon: "🔻", label: "Plinko", lead: "Lâche la bille en haut du plateau : elle rebondit sur les clous et tombe dans un bac. Les bords paient gros, le milieu presque rien." },
    { key: "cups", icon: "🎩", label: "Bonneteau", lead: "Une mascotte cache un booster sous un chapeau et mélange. Suis-le des yeux et pointe le bon : plus c'est rapide, plus ça paie." },
    { key: "claw", icon: "🕹️", label: "Machine à pinces", lead: "Promène la pince au-dessus d'une capsule et lâche-la. Capsules dorées : un jeton booster ; les autres : des cosmétiques de profil, et des peluches exclusives." },
    { key: "roulette", icon: "🎡", label: "Roulette", lead: "Place tes mises sur le tapis : une couleur, la parité, une moitié, une douzaine ou un numéro plein (×36), puis lance la bille." }
  ];
  // Ce que paie chaque salle (2026-10-27) : memes chiffres que le serveur (api/src/native/casino.js).
  // [ce qu'on fait, ce qu'on recoit] ; la mise est toujours comprise dans le gain affiche.
  const PAY = {
    scratch: [["Ticket du jour", "gratuit (perdant : 5 🪙 de consolation)"], ["Ticket en plus", "15 🪙"], ["3 symboles identiques", "le lot de la table à droite"]],
    lots: [["Tickets 🎟️", "gagnés dans les salles, échangés ici contre des lots"]],
    blackjack: [["Gagné", "×2 la mise (+1 🎟️)"], ["Blackjack (21 en 2 cartes)", "×2,5 la mise (+3 🎟️)"], ["Égalité", "mise rendue"], ["Perdu / sauté", "mise perdue"], ["Doubler", "mise ×2, une seule carte de plus"]],
    cans: [["Partie (3 balles)", "5 🪙"], ["Points des boîtes", "commune 1 · rare 2 · épique 3 · légendaire 5 · mythique 8"], ["Tout par terre", "points ×2"], ["Gain", "2 ✨ par point + 1 🎟️ pour 4 points"]],
    plinko: [["Bords", "×9 la mise (+3 🎟️)"], ["À côté des bords", "×2,5 (+1 🎟️)"], ["Puis", "×1,2 · ×0,7"], ["Milieu", "×0,4"]],
    cups: [["🐢 Tranquille", "×1,8 la mise (+1 🎟️)"], ["🐇 Rapide", "×2,4 la mise (+2 🎟️)"], ["⚡ Éclair", "×3,2 la mise (+3 🎟️)"], ["Rapide ou éclair, mise ≥ 20 🪙", "+1 jeton booster (1 par jour)"], ["Raté", "mise perdue"]],
    claw: [["Essai", "8 🪙"], ["Capsule dorée", "1 jeton booster"], ["Capsule violette / bleue", "cosmétique de profil (rare / courant)"], ["Peluche rose", "peluche exclusive"], ["Déjà tout possédé", "10 🎟️"]],
    roulette: [["Numéro plein", "×36 la mise (+5 🎟️)"], ["Douzaine", "×3"], ["Rouge, noir, pair, impair, 1-18, 19-36", "×2 (le 0 fait perdre)"], ["Partie gagnante", "+1 🎟️"]]
  };
  let sess = null; // jetons et tickets a l'entree dans les salles (bilan de la visite)
  let games = []; // [{ key, level, open }] (serveur)
  let machineLv = 1;
  const RAR_COLOR = { commune: "#9aa0b4", rare: "#3b82f6", epique: "#a855f7", legendaire: "#f59e0b", mythique: "#ef4444" };
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 60) : ms));
  const tone = (f, d = 0.08, type = "square", g = 0.03) => { if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(f, 0, d, type, g); };
  let W = null, game = null;
  let busy = false, bet = 10;

  const call = (g, action, extra = {}) => API.post("casino", { userId: Session.userId, game: g, action, ...extra });
  function takeWallet(res) {
    if (res && res.games) { games = res.games; machineLv = res.machineLevel || machineLv; renderDoors(); renderTabs(); }
    if (res && res.wallet) { W = res.wallet; if (!sess && !$("cz-room")?.hidden) sess = { chips: W.chips, tickets: W.tickets }; renderWallet(); renderTally(); }
    return res;
  }
  const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${fmt(Math.abs(n))}`;
  // Bilan de la visite (depuis l'entree dans les salles).
  function renderTally() {
    const el = $("cz-tally");
    if (!el || !W || !sess) return;
    const dc = W.chips - sess.chips, dt = W.tickets - sess.tickets;
    el.innerHTML = `<small>Cette visite</small> <b class="${dc > 0 ? "up" : dc < 0 ? "down" : ""}">${signed(dc)} 🪙</b>${dt ? ` <b class="up">+${fmt(dt)} 🎟️</b>` : ""}`;
  }
  // Bandeau de resultat d'une partie : mise -> gain = net, plus les extras.
  function outcome({ stake = 0, win = 0, tickets = 0, extra = "", label = "" }) {
    const el = $("cz-outcome");
    if (!el) return;
    const net = win - stake;
    const good = net > 0 || (!stake && (win || tickets || extra));
    el.hidden = false;
    el.className = `cz-outcome ${good ? "win" : net < 0 ? "lose" : "even"}`;
    el.innerHTML = `${label ? `<strong class="cz-out-label">${label}</strong>` : ""}
      <span class="cz-out-math">${stake ? `Mise <b>${fmt(stake)} 🪙</b> → ` : ""}${win ? `Gain <b>${fmt(win)} 🪙</b>` : stake ? "Gain <b>0 🪙</b>" : ""}${stake ? ` <span class="cz-out-net">= ${signed(net)} 🪙</span>` : ""}${tickets ? ` <b class="cz-out-extra">+${fmt(tickets)} 🎟️</b>` : ""}${extra ? ` <b class="cz-out-extra">${extra}</b>` : ""}</span>`;
    el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
  }
  function renderPay(key) {
    const el = $("cz-pay");
    const rows = PAY[key] || [];
    el.hidden = !rows.length;
    let openPref = true;
    try { openPref = localStorage.getItem("2gatcha_cz_pay") !== "0"; } catch (e) { /* stockage indisponible */ }
    el.open = openPref;
    el.innerHTML = `<summary>💰 Ce que ça rapporte</summary><table>${rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join("")}</table>`;
  }
  function errToast(e) { Toast.error(ERR[e.code] || friendlyError(e)); if (e.data && e.data.wallet) takeWallet(e.data); }
  async function run(fn) { if (busy) return; busy = true; try { await fn(); } catch (e) { errToast(e); } finally { busy = false; } }
  const lockOf = (key) => games.find((g) => g.key === key) || { open: true, level: 1 };
  const bulbs = (n = 22) => `<span class="cz-bulbs" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</span>`;

  // ------------------------------------------------------------------ hall (autour de la machine)
  function renderShell() {
    const z = $("casino-zone");
    z.hidden = false;
    z.innerHTML = `
      <div class="cz-hall">
        <div class="cz-sign" aria-label="Salle interdite"><span>Salle</span><strong>Interdite</strong></div>
        <div class="cz-wallet" id="cz-wallet"></div>
      </div>
      <div class="cz-cashier" id="cz-cashier" hidden></div>`;
    // Les portes des autres salles, sous la machine.
    let doors = $("cz-doors");
    if (!doors) {
      doors = document.createElement("section");
      doors.id = "cz-doors";
      doors.className = "cz-doors";
      $("fd-machine-zone").insertAdjacentElement("afterend", doors);
    }
    doors.addEventListener("click", (e) => { const b = e.target.closest("[data-room]"); if (b) open(b.dataset.room); });
    // La salle plein ecran.
    let room = $("cz-room");
    if (!room) {
      room = document.createElement("div");
      room.id = "cz-room";
      room.className = "cz-room";
      room.hidden = true;
      room.setAttribute("role", "dialog");
      room.setAttribute("aria-modal", "true");
      room.innerHTML = `
        ${bulbs(40)}
        <div class="cz-room-inner panel">
          <header class="cz-room-head">
            <button type="button" class="btn-ghost" id="cz-room-close">← Retour à la machine</button>
            <div class="cz-tally" id="cz-tally" title="Jetons et tickets gagnés ou perdus depuis que tu es entré dans les salles"></div>
            <div class="cz-wallet" id="cz-room-wallet"></div>
          </header>
          <nav class="tabs tabs-scroll cz-room-tabs" id="cz-room-tabs" role="tablist" aria-label="Salles du casino"></nav>
          <div class="cz-pane">
            <h2 id="cz-room-title"></h2>
            <p class="lead" id="cz-room-lead" style="font-size:0.85rem;"></p>
            <details class="cz-pay" id="cz-pay"></details>
            <div class="cz-outcome" id="cz-outcome" hidden aria-live="polite"></div>
            <div class="cz-game" id="cz-game"></div>
          </div>
        </div>`;
      document.body.appendChild(room);
      $("cz-room-close").onclick = close;
      $("cz-pay").addEventListener("toggle", () => { try { localStorage.setItem("2gatcha_cz_pay", $("cz-pay").open ? "1" : "0"); } catch (e) { /* stockage indisponible */ } });
      $("cz-room-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-room]"); if (b && !busy) open(b.dataset.room); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !room.hidden && !document.querySelector(".confirm-overlay, .modal-overlay")) close(); });
      window.addEventListener("popstate", () => { if (!room.hidden && !location.hash.startsWith("#salle-")) close(true); });
    }
  }
  function renderDoors() {
    const doors = $("cz-doors");
    if (!doors) return;
    const next = games.filter((g) => !g.open).sort((a, b) => a.level - b.level)[0];
    doors.innerHTML = `
      ${bulbs(30)}
      <h2 class="cz-doors-title">Les autres salles</h2>
      <div class="cz-door-grid">${GAMES.map((g) => {
        const l = lockOf(g.key);
        return `<button type="button" class="cz-door ${l.open ? "" : "locked"}" data-room="${g.key}" ${l.open ? "" : `aria-disabled="true" title="Ouvre au niveau ${l.level} de la machine"`}>
          <span class="cz-door-ico" aria-hidden="true">${l.open ? g.icon : "❔"}</span>
          <strong>${l.open ? g.label : "Porte close"}</strong>
          <small>${l.open ? "Entrer" : `Machine niv. ${l.level}`}</small>
        </button>`;
      }).join("")}</div>
      ${next ? `<p class="cz-next">Prochaine salle au niveau ${next.level} de la machine (tu es niveau ${machineLv}).</p>` : ""}`;
  }
  function renderTabs() {
    const nav = $("cz-room-tabs");
    if (!nav) return;
    nav.innerHTML = GAMES.map((g) => {
      const l = lockOf(g.key);
      return `<button type="button" role="tab" class="tab ${game === g.key ? "active" : ""}" data-room="${g.key}" aria-selected="${game === g.key}" ${l.open ? "" : "disabled"} title="${l.open ? "" : `Ouvre au niveau ${l.level} de la machine`}">${l.open ? g.icon : "🔒"} ${g.label}</button>`;
    }).join("");
  }
  function walletHtml() {
    const v = W.vip;
    const pct = v.next ? Math.round(((v.xp - v.prev) / Math.max(1, v.next - v.prev)) * 100) : 100;
    return `
      <span class="cz-chip" title="Poussières">✨ <strong>${fmt(W.stardust)}</strong></span>
      <span class="cz-chip gold" title="Jetons : mises des salles et de la machine">🪙 <strong>${fmt(W.chips)}</strong></span>
      <span class="cz-chip" title="Tickets : comptoir des lots">🎟️ <strong>${fmt(W.tickets)}</strong></span>
      <span class="cz-chip" title="Niveau VIP : il monte avec les jetons misés et donne des jetons chaque jour">VIP ${v.level}<span class="cz-vip-bar"><span style="width:${pct}%"></span></span></span>
      <button type="button" class="btn-secondary" data-cash>💰 Caisse${W.dailyChips ? " <span class='cz-dot'></span>" : ""}</button>`;
  }
  function renderWallet() {
    if (!W) return;
    ["cz-wallet", "cz-room-wallet"].forEach((id) => { const el = $(id); if (el) el.innerHTML = walletHtml(); });
    document.querySelectorAll("[data-cash]").forEach((b) => { b.onclick = () => { const c = $("cz-cashier"); c.hidden = !c.hidden; if (!c.hidden) { renderCashier(); if (!$("cz-room").hidden) close(); c.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }; });
    if (!$("cz-cashier").hidden) renderCashier();
  }
  function open(key) {
    const l = lockOf(key);
    if (!l.open) { Toast.info(`🔒 Cette salle ouvre au niveau ${l.level} de la machine interdite (tu es niveau ${machineLv}).`); tone(180, 0.08); return; }
    const g = GAMES.find((x) => x.key === key);
    if (!g) return;
    game = key;
    try { localStorage.setItem("2gatcha_casino_game", key); } catch (e) { /* stockage indisponible */ }
    const room = $("cz-room");
    const wasHidden = room.hidden;
    room.hidden = false;
    document.documentElement.classList.add("cz-room-open");
    if (wasHidden) history.pushState(null, "", "#salle-" + key); else history.replaceState(null, "", "#salle-" + key);
    $("cz-room-title").textContent = `${g.icon} ${g.label}`;
    $("cz-room-lead").textContent = g.lead;
    if (wasHidden) sess = W ? { chips: W.chips, tickets: W.tickets } : null;
    renderPay(key);
    $("cz-outcome").hidden = true;
    renderTally();
    renderTabs();
    renderWallet();
    $("cz-game").innerHTML = '<p class="muted">Chargement…</p>';
    tone(660, 0.06, "triangle", 0.03);
    ({ blackjack, roulette, cans, claw, plinko, cups, scratch, lots })[key]();
    if (wasHidden) $("cz-room-close").focus();
  }
  function close(fromHistory) {
    const room = $("cz-room");
    if (!room || room.hidden) return;
    room.hidden = true;
    document.documentElement.classList.remove("cz-room-open");
    $("cz-game").innerHTML = "";
    if (!fromHistory && location.hash.startsWith("#salle-")) history.back();
  }
  function renderCashier() {
    $("cz-cashier").innerHTML = `
      <div class="cz-cash-row"><strong>Acheter des jetons</strong> <small>1 🪙 = ${fmt(W.chipPrice)} ✨ · tu as ${fmt(W.stardust)} ✨</small></div>
      <div class="cz-cash-row">${[10, 50, 200, 1000].map((n) => `<button type="button" class="btn-secondary" data-buy="${n}" ${W.stardust < n * W.chipPrice ? "disabled" : ""}>${n} 🪙 · ${fmt(n * W.chipPrice)} ✨</button>`).join("")}</div>
      <div class="cz-cash-row"><strong>Revendre</strong> <small>${Math.round(W.cashoutRate * 100)} % du prix</small> ${[50, 200].map((n) => `<button type="button" class="btn-ghost" data-cashout="${n}" ${W.chips < n ? "disabled" : ""}>${n} 🪙 → ${fmt(Math.floor(n * W.chipPrice * W.cashoutRate))} ✨</button>`).join("")}${W.chips ? `<button type="button" class="btn-ghost" data-cashout="${W.chips}">Tout (${fmt(W.chips)} 🪙)</button>` : ""}</div>
      <div class="cz-cash-row"><strong>Jetons VIP du jour</strong> ${W.dailyChips ? `<button type="button" class="btn" id="cz-daily">Récupérer ${W.dailyChips} 🪙</button>` : "<small>déjà récupérés, reviens demain</small>"}</div>`;
    $("cz-cashier").onclick = (e) => {
      const b = e.target.closest("[data-buy]"), c = e.target.closest("[data-cashout]"), d = e.target.closest("#cz-daily");
      if (b) run(async () => { takeWallet(await call("cashier", "buy", { count: Number(b.dataset.buy) })); Toast.success(`🪙 +${b.dataset.buy} jetons`); document.dispatchEvent(new CustomEvent("casino:chips")); if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); });
      if (c) run(async () => { const r = takeWallet(await call("cashier", "cashout", { count: Number(c.dataset.cashout) })); Toast.success(`💰 +${fmt(r.dust)} poussières`); document.dispatchEvent(new CustomEvent("casino:chips")); if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); });
      if (d) run(async () => { const r = takeWallet(await call("cashier", "daily")); Toast.success(`🪙 +${r.dailyGiven} jetons VIP`); document.dispatchEvent(new CustomEvent("casino:chips")); });
    };
  }
  // Choix de la mise : des onglets, comme les choix de la page Jeux.
  function betBar(id, max = W ? W.maxBet : 100) {
    const steps = [5, 10, 25, 50, 100].filter((x) => x <= max);
    if (!steps.includes(bet)) bet = steps[Math.min(1, steps.length - 1)];
    return `<div class="cz-choice" id="${id}"><span>Mise</span><div class="tabs" role="radiogroup">${steps.map((s) => `<button type="button" role="radio" class="tab ${s === bet ? "active" : ""}" data-bet="${s}" aria-checked="${s === bet}">${s} 🪙</button>`).join("")}</div></div>`;
  }
  function bindBets(root) { root.querySelectorAll("[data-bet]").forEach((b) => b.addEventListener("click", () => { bet = Number(b.dataset.bet); root.querySelectorAll("[data-bet]").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-checked", String(x === b)); }); tone(400 + bet * 4, 0.04); })); }

  // ------------------------------------------------------------------ blackjack
  // Cartes dessinees (coins + couleur au centre), distribution animee ; en fin
  // de main, la carte cachee de la banque se retourne puis ses cartes
  // arrivent une a une. Raccourcis : T tirer, R rester, D doubler.
  const RED_SUITS = new Set(["♥", "♦"]);
  const cardHtml = (c, i = 0, fresh = false) => c.r === "?"
    ? `<span class="bj-card back ${fresh ? "deal" : ""}" style="--i:${i}"><span class="bj-back"></span></span>`
    : `<span class="bj-card ${RED_SUITS.has(c.s) ? "red" : ""} ${fresh ? "deal" : ""}" style="--i:${i}"><span class="bj-corner">${c.r}<br>${c.s}</span><span class="bj-pip">${c.s}</span><span class="bj-corner br">${c.r}<br>${c.s}</span></span>`;
  // Total affiche : « 7 / 17 » quand un as compte encore pour 11.
  function softTotal(cards) {
    let v = 0, aces = 0;
    for (const c of cards) { if (c.r === "?") continue; if (c.r === "A") { aces++; v += 11; } else v += ["J", "Q", "K"].includes(c.r) ? 10 : Number(c.r); }
    while (v > 21 && aces) { v -= 10; aces--; }
    return aces && v < 21 ? `${v - 10} / ${v}` : String(v);
  }
  let bjShown = { player: 0, dealer: 0 };
  const bjHistory = [];
  function bjRender(bj, { dealerCount, flip } = {}) {
    const box = $("cz-game");
    const live = bj && !bj.done;
    const RES = { blackjack: ["🂡 Blackjack !", "win"], win: ["Gagné !", "win"], push: ["Égalité", "push"], lose: ["La banque gagne", "lose"], bust: ["Tu sautes !", "lose"] };
    const dealer = bj ? bj.dealer.slice(0, dealerCount == null ? bj.dealer.length : dealerCount) : [];
    const showResult = bj && bj.done && (dealerCount == null || dealerCount >= bj.dealer.length);
    box.innerHTML = `
      <div class="bj-table">
        <div class="bj-felt-text" aria-hidden="true">BLACKJACK PAIE 3 POUR 2 · LA BANQUE TIRE JUSQU'À 17</div>
        <div class="bj-row dealer">
          <div class="bj-hand">${dealer.map((c, i) => cardHtml(c, i, i >= bjShown.dealer || (flip && i === 1))).join("")}</div>
          ${bj ? `<span class="bj-total">${dealer.some((c) => c.r === "?") ? softTotal(dealer) + " + ?" : softTotal(dealer)}</span>` : ""}
          <small>Banque</small>
        </div>
        <div class="bj-center">
          ${showResult ? `<div class="bj-banner ${RES[bj.result][1]}">${RES[bj.result][0]}${bj.payout ? `<small>+${fmt(bj.payout)} 🪙</small>` : ""}</div>`
            : live ? `<div class="bj-turn">À toi de jouer</div>` : bj ? "" : `<div class="bj-turn">Place ta mise et distribue</div>`}
          <div class="bj-spot ${bj && bj.bet ? "on" : ""}" title="Mise">${bj && bj.bet ? `<span class="bj-chips">${chipStack(bj.bet)}</span><b>${bj.bet}</b>` : `<b>${bet}</b>`}</div>
        </div>
        <div class="bj-row player">
          <small>Toi</small>
          ${bj ? `<span class="bj-total ${bj.playerValue > 21 ? "bust" : bj.playerValue === 21 ? "best" : ""}">${softTotal(bj.player)}</span>` : ""}
          <div class="bj-hand">${bj ? bj.player.map((c, i) => cardHtml(c, i, i >= bjShown.player)).join("") : ""}</div>
        </div>
      </div>
      ${live ? `<div class="cz-actions"><button type="button" class="btn" data-bj="hit">🂠 Tirer <kbd>T</kbd></button><button type="button" class="btn-secondary" data-bj="stand">✋ Rester <kbd>R</kbd></button>${bj.canDouble ? `<button type="button" class="btn-ghost" data-bj="double">×2 Doubler (+${bj.bet} 🪙) <kbd>D</kbd></button>` : ""}</div>`
        : `${betBar("bj-bets")}<div class="cz-actions"><button type="button" class="btn" data-bj="deal">🃏 Distribuer</button></div>`}
      ${bjHistory.length ? `<p class="cz-history">Dernières mains : ${bjHistory.map((h) => `<span class="${h}">${{ win: "G", lose: "P", push: "=" }[h]}</span>`).join("")}</p>` : ""}`;
    bindBets(box);
    box.querySelectorAll("[data-bj]").forEach((b) => b.addEventListener("click", () => bjAct(b.dataset.bj)));
    bjShown = { player: bj ? bj.player.length : 0, dealer: dealer.length };
  }
  function chipStack(n) {
    const out = [];
    let left = n;
    for (const [v, c] of [[100, "#111827"], [25, "#16a34a"], [10, "#2563eb"], [5, "#dc2626"], [1, "#e5e7eb"]]) { while (left >= v && out.length < 8) { out.push(c); left -= v; } }
    return out.map((c, i) => `<i style="--c:${c};--k:${i}"></i>`).join("");
  }
  function bjAct(action) {
    run(async () => {
      const r = takeWallet(await call("blackjack", action, action === "deal" ? { bet } : {}));
      const bj = r.blackjack;
      tone(action === "hit" ? 620 : 520, 0.05);
      if (action === "deal") bjShown = { player: 0, dealer: 0 };
      if (bj.done && bj.dealer.length >= 2) {
        // Retourne la carte cachee, puis les cartes de la banque une a une.
        bjRender(bj, { dealerCount: 2, flip: true });
        tone(400, 0.05);
        for (let n = 3; n <= bj.dealer.length; n++) { await wait(560); bjRender(bj, { dealerCount: n }); tone(560, 0.04); }
        await wait(380);
        bjRender(bj);
        bjHistory.unshift(bj.payout > bj.bet ? "win" : bj.result === "push" ? "push" : "lose");
        bjHistory.length = Math.min(bjHistory.length, 8);
        bjRender(bj);
        if (bj.payout > bj.bet) { tone(880, 0.25, "triangle", 0.05); if (bj.result === "blackjack" && typeof confetti === "function") confetti({ particleCount: 60, spread: 70, origin: { y: 0.5 } }); }
        outcome({ stake: bj.bet, win: bj.payout, tickets: r.tickets, label: ({ blackjack: "🃏 Blackjack !", win: "🃏 Gagné", push: "🃏 Égalité", lose: "🃏 Perdu", bust: "🃏 Sauté (plus de 21)" })[bj.result] || "" });
      } else bjRender(bj);
    });
  }
  async function blackjack() {
    let bj = null;
    try { bj = (await call("blackjack", "status")).blackjack; } catch (e) { bj = null; }
    bjShown = { player: bj ? bj.player.length : 0, dealer: bj ? bj.dealer.length : 0 };
    bjRender(bj && !bj.done ? bj : bj && bj.done ? bj : null);
  }
  document.addEventListener("keydown", (e) => {
    if (game !== "blackjack" || $("cz-room").hidden || e.target.closest("input, textarea")) return;
    const k = e.key.toLowerCase();
    const map = { t: "hit", r: "stand", d: "double" };
    if (map[k] && document.querySelector(`[data-bj="${map[k]}"]`)) { e.preventDefault(); bjAct(map[k]); }
  });

  // ------------------------------------------------------------------ roulette
  // Roue europeenne numerotee (SVG) et bille qui tourne a contre-sens avant
  // de tomber dans la case ; tapis 3 x 12 ; jetons poses sur les cases.
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const numColor = (n) => (n === 0 ? "green" : REDS.has(n) ? "red" : "black");
  let rBets = [], rLast = [], wheelTurn = 0;
  const rHistory = (() => { try { return JSON.parse(localStorage.getItem("2gatcha_rl_hist") || "[]"); } catch (e) { return []; } })();
  const OUTSIDE = [["low", "1-18", 2], ["even", "Pair", 2], ["red", "Rouge", 2], ["black", "Noir", 2], ["odd", "Impair", 2], ["high", "19-36", 2]];
  const DOZENS = [["dozen1", "1re douzaine", 3], ["dozen2", "2e douzaine", 3], ["dozen3", "3e douzaine", 3]];
  function wheelSvg() {
    const seg = 360 / 37;
    const pockets = WHEEL.map((n, i) => {
      const a0 = (i * seg - 90 - seg / 2) * Math.PI / 180, a1 = ((i + 1) * seg - 90 - seg / 2) * Math.PI / 180;
      const p = (r, a) => `${50 + r * Math.cos(a)},${50 + r * Math.sin(a)}`;
      const am = (i * seg - 90) * Math.PI / 180;
      const fill = n === 0 ? "#15803d" : REDS.has(n) ? "#b91c1c" : "#111827";
      return `<path d="M${p(30, a0)} L${p(47, a0)} A47,47 0 0 1 ${p(47, a1)} L${p(30, a1)} A30,30 0 0 0 ${p(30, a0)}Z" fill="${fill}" stroke="#d4a94a" stroke-width="0.25"/>
        <text x="${50 + 41 * Math.cos(am)}" y="${50 + 41 * Math.sin(am)}" transform="rotate(${i * seg} ${50 + 41 * Math.cos(am)} ${50 + 41 * Math.sin(am)})" class="rl-n">${n}</text>`;
    }).join("");
    return `<svg viewBox="0 0 100 100" class="rl-svg"><circle cx="50" cy="50" r="49" fill="#5b3a17" stroke="#d4a94a" stroke-width="1.2"/>${pockets}<circle cx="50" cy="50" r="30" fill="#3b240e" stroke="#d4a94a" stroke-width="0.6"/><circle cx="50" cy="50" r="7" fill="#d4a94a"/><path d="M50 36 L52 50 L50 64 L48 50Z M36 50 L50 48 L64 50 L50 52Z" fill="#f5d98a"/></svg>`;
  }
  const betKey = (b) => (b.type === "number" ? "n" + b.n : b.type);
  function chipOn(key) {
    const b = rBets.find((x) => betKey(x) === key);
    return b ? `<span class="rl-chip">${b.amount}</span>` : "";
  }
  function roulette() {
    const box = $("cz-game");
    const total = rBets.reduce((s, b) => s + b.amount, 0);
    const cell = (n) => `<button type="button" class="rl-num ${numColor(n)}" data-rn="${n}">${n}${chipOn("n" + n)}</button>`;
    // Tapis : 3 rangees (3, 6, 9... en haut), 12 colonnes.
    const rows = [3, 2, 1].map((r) => Array.from({ length: 12 }, (_, c) => cell(c * 3 + r)).join("")).join("");
    box.innerHTML = `
      <div class="rl-layout">
        <div class="rl-wheel-wrap">
          <div class="rl-wheel" id="rl-wheel" style="transform:rotate(${wheelTurn}deg)">${wheelSvg()}</div>
          <div class="rl-ball-track" id="rl-track"><span class="rl-ball"></span></div>
          <div class="rl-pointer" aria-hidden="true">▼</div>
          <div class="rl-center" id="rl-center" aria-live="polite"></div>
        </div>
        <div class="rl-side">
          <div class="rl-hist">${rHistory.length ? rHistory.map((n) => `<span class="${numColor(n)}">${n}</span>`).join("") : '<small class="muted">Derniers numéros</small>'}</div>
          ${betBar("rl-bets")}
          <p class="rl-placed">${rBets.length ? `${rBets.length} mise${rBets.length > 1 ? "s" : ""} · <strong>${total} 🪙</strong> sur le tapis` : "Clique sur le tapis pour poser tes jetons."}</p>
          <div class="cz-actions">
            <button type="button" class="btn" id="rl-spin" ${rBets.length ? "" : "disabled"}>🎡 Lancer la bille</button>
            <button type="button" class="btn-ghost" id="rl-undo" ${rBets.length ? "" : "disabled"}>↶ Annuler</button>
            <button type="button" class="btn-ghost" id="rl-clear" ${rBets.length ? "" : "disabled"}>Effacer</button>
            ${!rBets.length && rLast.length ? `<button type="button" class="btn-secondary" id="rl-again">↻ Même mise</button>` : ""}
          </div>
        </div>
      </div>
      <div class="rl-felt">
        <div class="rl-grid">
          <button type="button" class="rl-num green rl-zero" data-rn="0">0${chipOn("n0")}</button>
          ${rows}
        </div>
        <div class="rl-dozens">${DOZENS.map(([k, l, m]) => `<button type="button" class="rl-spot" data-rl="${k}">${l} <small>×${m}</small>${chipOn(k)}</button>`).join("")}</div>
        <div class="rl-outside">${OUTSIDE.map(([k, l, m]) => `<button type="button" class="rl-spot ${k}" data-rl="${k}">${k === "red" ? '<i class="rl-diamond red"></i>' : k === "black" ? '<i class="rl-diamond black"></i>' : l} <small>×${m}</small>${chipOn(k)}</button>`).join("")}</div>
      </div>
      <p class="muted cz-help">Un numéro plein paie ×36, une douzaine ×3, les chances simples ×2 (le 0 les fait perdre).</p>`;
    bindBets(box);
    const add = (type, n) => {
      const ex = rBets.find((b) => b.type === type && (type !== "number" || b.n === n));
      if (ex) ex.amount += bet; else rBets.push({ type, n, amount: bet });
      rBets.order = [...(rBets.order || []), type === "number" ? "n" + n : type];
      tone(760, 0.03); roulette();
    };
    box.querySelectorAll("[data-rl]").forEach((b) => b.addEventListener("click", () => add(b.dataset.rl)));
    box.querySelectorAll("[data-rn]").forEach((b) => b.addEventListener("click", () => add("number", Number(b.dataset.rn))));
    $("rl-clear").onclick = () => { rBets = []; roulette(); };
    $("rl-undo").onclick = () => {
      const k = (rBets.order || []).pop();
      const b = rBets.find((x) => betKey(x) === k);
      if (b) { b.amount -= bet; if (b.amount <= 0) rBets.splice(rBets.indexOf(b), 1); }
      roulette();
    };
    const again = $("rl-again");
    if (again) again.onclick = () => { rBets = rLast.map((b) => ({ ...b })); roulette(); };
    $("rl-spin").onclick = () => run(async () => {
      const r = takeWallet(await call("roulette", "spin", { bets: rBets }));
      box.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      const idx = WHEEL.indexOf(r.roulette.n);
      const slice = 360 / 37;
      wheelTurn = wheelTurn - (wheelTurn % 360) + 360 * 5 + (360 - idx * slice);
      const wheel = $("rl-wheel"), track = $("rl-track");
      const dur = reduced() ? 0 : 4200;
      wheel.style.transition = `transform ${dur}ms cubic-bezier(.12,.6,.12,1)`;
      wheel.style.transform = `rotate(${wheelTurn}deg)`;
      track.style.transition = `transform ${dur}ms cubic-bezier(.2,.5,.2,1)`;
      track.classList.add("spin");
      track.style.transform = `rotate(${-360 * 7}deg)`;
      for (let i = 0; i < 18; i++) setTimeout(() => tone(1100 - i * 40, 0.015, "square", 0.02), i * (dur / 22) * (1 + i / 18));
      await wait(dur + 150);
      track.style.transition = "none"; track.style.transform = "rotate(0deg)"; track.classList.remove("spin"); track.classList.add("landed");
      const c = $("rl-center");
      c.textContent = r.roulette.n;
      c.className = `rl-center show ${r.roulette.color}`;
      rHistory.unshift(r.roulette.n); rHistory.length = Math.min(rHistory.length, 12);
      try { localStorage.setItem("2gatcha_rl_hist", JSON.stringify(rHistory)); } catch (e) { /* stockage indisponible */ }
      const net = r.roulette.payout - r.roulette.total;
      if (net > 0) tone(880, 0.25, "triangle", 0.05);
      outcome({ stake: r.roulette.total, win: r.roulette.payout, tickets: r.tickets, label: `🎡 ${r.roulette.n} ${r.roulette.color === "red" ? "rouge" : r.roulette.color === "black" ? "noir" : "vert"}` });
      rLast = rBets.map((b) => ({ type: b.type, n: b.n, amount: b.amount }));
      rBets = [];
      await wait(1400);
      roulette();
      const c2 = $("rl-center"); if (c2) { c2.textContent = r.roulette.n; c2.className = `rl-center show ${r.roulette.color}`; }
    });
  }

  // ------------------------------------------------------------------ chamboule-tout
  // Lance-pierre (2026-10-26) : on attrape la balle, on tire en arriere puis
  // on lache. Le sens donne la visee, la longueur la force (douce = bas de la
  // pyramide, forte = haut). Le viseur montre ou elle ira.
  let canState = null, canCost = 5;
  const CAN_PTS = { commune: 1, rare: 2, epique: 3, legendaire: 5, mythique: 8 };
  const canRow = (p) => (p > 0.97 || p < 0.08 ? null : p < 0.35 ? 0 : p < 0.6 ? 1 : p < 0.82 ? 2 : 3);
  function cansHtml(c) {
    return c.rows.map((row, r) => `<div class="cn-row" style="--r:${r}">${row.map((can, i) => `<span class="cn-can ${can.down ? "down" : ""}" data-can="${r}-${i}" style="--c:${RAR_COLOR[can.rar]}" title="${can.rar} · ${CAN_PTS[can.rar]} pt"><i>${CAN_PTS[can.rar]}</i></span>`).join("")}</div>`).reverse().join("");
  }
  async function cans(state) {
    const box = $("cz-game");
    let st = state;
    if (st === undefined) { try { st = await call("cans", "status"); } catch (e) { box.innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; return; } }
    canState = st.cans;
    if (st && st.canCost) canCost = st.canCost;
    const c = canState;
    const live = c && !c.done;
    const demo = { rows: [["commune", "commune", "rare", "rare"], ["rare", "epique", "rare"], ["epique", "legendaire"], ["mythique"]].map((r) => r.map((rar) => ({ rar, down: false }))) };
    box.innerHTML = `
      <div class="cz-table cn-table">
        <div class="cn-stage" id="cn-stage">
          <div class="cn-shelf"></div>
          <div class="cn-pyramid" id="cn-pyr">${cansHtml(c || demo)}</div>
          <div class="cn-aim" id="cn-aim" hidden></div>
          <svg class="cn-band" id="cn-band" aria-hidden="true"><line id="cn-line" x1="0" y1="0" x2="0" y2="0" /></svg>
          <div class="cn-ball ${live ? "ready" : ""}" id="cn-ball"></div>
          ${live ? `<div class="cn-balls">${"⚾".repeat(c.balls)}</div><div class="cn-power" id="cn-power" hidden><span></span></div>` : ""}
        </div>
        <div class="cn-legend">${Object.entries(CAN_PTS).map(([k, v]) => `<span style="--c:${RAR_COLOR[k]}"><i></i>${v} pt${v > 1 ? "s" : ""}</span>`).join("")} · tout par terre = ×2</div>
        ${live ? `<p class="cz-help">Attrape la balle, tire-la vers l'arrière et lâche : le sens vise, la longueur donne la force.</p>`
          : `${c && c.done && c.result ? `<p class="cz-result">${c.result.strike ? "💥 STRIKE ! " : ""}${c.result.score} points : +${c.result.tickets} 🎟️ et +${c.result.dust} ✨</p>` : ""}<div class="cz-actions"><button type="button" class="btn" id="cn-start">Nouvelle partie · ${st && st.canCost ? st.canCost : 5} 🪙</button></div>`}
      </div>`;
    if (!live) { $("cn-start").onclick = () => run(async () => { const r = takeWallet(await call("cans", "start")); tone(520, 0.06); cans(r); }); return; }
    const stage = $("cn-stage"), ball = $("cn-ball"), aim = $("cn-aim"), line = $("cn-line"), pow = $("cn-power");
    let drag = null;
    const geo = () => {
      const sr = stage.getBoundingClientRect(), br = ball.getBoundingClientRect(), pr = $("cn-pyr").getBoundingClientRect();
      return { sr, bx: br.left + br.width / 2, by: br.top + br.height / 2, pr };
    };
    // Visee a partir du tir : x (0 a 1 sur la largeur de la pyramide) et p (force).
    const shot = (e) => {
      const g = geo();
      const dx = g.bx - e.clientX, dy = g.by - e.clientY; // vecteur de tir (oppose a la traction)
      const len = Math.min(g.sr.height * 0.55, Math.hypot(dx, dy));
      const p = Math.max(0, Math.min(1, len / (g.sr.height * 0.5)));
      const tx = g.bx + (dx / Math.max(1, -dy)) * (g.by - g.pr.top) * 0.9;
      const x = Math.max(0, Math.min(1, (tx - g.pr.left) / g.pr.width));
      return { x, p, g, pull: { x: e.clientX, y: e.clientY } };
    };
    const show = (sh) => {
      const g = sh.g;
      line.setAttribute("x1", g.bx - g.sr.left); line.setAttribute("y1", g.by - g.sr.top);
      line.setAttribute("x2", sh.pull.x - g.sr.left); line.setAttribute("y2", sh.pull.y - g.sr.top);
      ball.style.transform = `translate(${sh.pull.x - g.bx}px, ${sh.pull.y - g.by}px)`;
      const row = canRow(sh.p);
      aim.hidden = false;
      const rowEl = row == null ? null : $("cn-pyr").querySelector(`.cn-row[style*="--r:${row}"]`);
      const ty = rowEl ? rowEl.getBoundingClientRect().top + rowEl.offsetHeight / 2 : g.pr.top - 30;
      aim.style.left = `${g.pr.left - g.sr.left + sh.x * g.pr.width}px`;
      aim.style.top = `${ty - g.sr.top}px`;
      aim.classList.toggle("miss", row == null);
      pow.hidden = false;
      pow.firstElementChild.style.width = `${Math.round(sh.p * 100)}%`;
      pow.classList.toggle("over", sh.p > 0.97);
    };
    ball.addEventListener("pointerdown", (e) => { if (busy) return; e.preventDefault(); ball.setPointerCapture(e.pointerId); drag = true; ball.classList.add("held"); tone(300, 0.03); });
    ball.addEventListener("pointermove", (e) => { if (!drag) return; drag = shot(e); show(drag); });
    ball.addEventListener("pointerup", () => {
      const sh = drag;
      drag = null;
      ball.classList.remove("held");
      line.setAttribute("x2", line.getAttribute("x1")); line.setAttribute("y2", line.getAttribute("y1"));
      pow.hidden = true;
      if (!sh || sh === true || sh.p < 0.05) { ball.style.transform = ""; aim.hidden = true; return; }
      run(async () => {
        const r = takeWallet(await call("cans", "throw", { x: sh.x, p: sh.p }));
        const g = geo();
        const row = r.shot.row;
        const rowEl = row == null ? null : $("cn-pyr").querySelector(`.cn-row[style*="--r:${row}"]`);
        const tx = g.pr.left + r.shot.wx * g.pr.width;
        const ty = rowEl ? rowEl.getBoundingClientRect().top + rowEl.offsetHeight / 2 : g.sr.top - 20;
        // Trajectoire en cloche : la balle monte, retombe sur sa cible et rapetisse (elle s'eloigne).
        tone(260, 0.12, "sawtooth", 0.02);
        ball.style.transition = "none";
        await new Promise((res) => {
          if (reduced()) { ball.style.transform = `translate(${tx - g.bx}px, ${ty - g.by}px) scale(0.5)`; res(); return; }
          const t0 = performance.now(), dur = 520, dx = tx - g.bx, dy = ty - g.by, peak = Math.max(40, g.sr.height * 0.25);
          const frame = (t) => {
            const k = Math.min(1, (t - t0) / dur);
            ball.style.transform = `translate(${dx * k}px, ${dy * k - Math.sin(k * Math.PI) * peak}px) scale(${1 - 0.5 * k}) rotate(${k * 540}deg)`;
            if (k < 1) requestAnimationFrame(frame); else res();
          };
          requestAnimationFrame(frame);
        });
        aim.hidden = true;
        r.shot.hit.forEach(([rr, i], k) => setTimeout(() => {
          const el = $("cn-pyr").querySelector(`[data-can="${rr}-${i}"]`);
          if (!el) return;
          el.style.setProperty("--spin", `${(Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 100)}deg`);
          el.style.setProperty("--fx", `${(Math.random() - 0.5) * 80}px`);
          el.classList.add("down", "hit");
          tone(200 + k * 50, 0.07, "square", 0.04);
        }, k * 90));
        if (!r.shot.hit.length) Toast.info(row == null ? "Raté : trop fort ou trop mou !" : "Dans le vide…");
        await wait(500 + r.shot.hit.length * 90);
        await cans(r);
        if (r.reward) { if (r.reward.strike && typeof confetti === "function") confetti({ particleCount: 90, spread: 80, origin: { y: 0.6 } }); outcome({ stake: canCost, tickets: r.reward.tickets, extra: r.reward.dust ? `+${fmt(r.reward.dust)} ✨` : "", label: `🥫 ${r.reward.strike ? "STRIKE ! " : ""}${r.reward.score} point${r.reward.score > 1 ? "s" : ""}` }); if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); }
      });
    });
  }

  // ------------------------------------------------------------------ machine a pinces
  // Vue de cote (2026-10-26) : la pince suit la souris (ou le doigt, ou les
  // fleches) au-dessus du bac ; un clic la lache. Elle descend sur la
  // capsule la plus haute sous elle, serre, remonte... et la lache parfois.
  const CAP = { gold: ["#fbbf24", "Jeton booster"], purple: ["#a855f7", "Cosmétique rare"], blue: ["#38bdf8", "Cosmétique"], pink: ["#f472b6", "Peluche"] };
  async function claw(state) {
    const box = $("cz-game");
    let st = state;
    if (!st) { try { st = await call("claw", "status"); } catch (e) { box.innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; return; } }
    const caps = st.claw.capsules;
    box.innerHTML = `
      <div class="cz-table cl-table">
        <div class="cl-machine">
          <div class="cl-marquee">✦ ATTRAPE-TOUT ✦</div>
          <div class="cl-glass" id="cl-glass" tabindex="0" aria-label="Bac de la machine à pinces : déplace la pince puis clique pour la lâcher">
            <div class="cl-rail"></div>
            <div class="cl-claw" id="cl-claw" style="--x:0.5"><span class="cl-rope" id="cl-rope"></span><span class="cl-head"><i class="l"></i><i class="r"></i></span></div>
            <div class="cl-shadow" id="cl-shadow" style="--x:0.5"></div>
            ${caps.slice().sort((a, b) => b.y - a.y).map((c) => `<span class="cl-cap ${c.kind}" data-cap="${c.id}" style="left:${c.x * 100}%;top:${c.y * 100}%;--c:${CAP[c.kind][0]}" title="${CAP[c.kind][1]}">${c.kind === "pink" ? "🧸" : c.kind === "gold" ? "🃏" : ""}</span>`).join("")}
            <div class="cl-chute">PRIX</div>
          </div>
          <div class="cl-panel">
            <div class="cl-legend">${Object.entries(CAP).map(([k, [c, l]]) => `<span style="--c:${c}"><i></i>${l}</span>`).join("")}</div>
            <button type="button" class="btn" id="cl-drop">⬇️ Lâcher la pince · ${st.claw.cost} 🪙</button>
          </div>
        </div>
        <p class="cz-help">Promène la pince au-dessus d'une capsule (souris, doigt ou flèches ← →) et clique pour la lâcher. Bien centrée, elle tient mieux.</p>
      </div>`;
    const glass = $("cl-glass"), clawEl = $("cl-claw"), shadow = $("cl-shadow"), rope = $("cl-rope");
    let x = 0.5, dropping = false;
    const set = () => { clawEl.style.setProperty("--x", x); shadow.style.setProperty("--x", x); };
    const follow = (e) => { if (dropping) return; const r = glass.getBoundingClientRect(); x = Math.max(0.05, Math.min(0.95, (e.clientX - r.left) / r.width)); set(); };
    glass.addEventListener("pointermove", follow);
    glass.addEventListener("pointerdown", follow);
    glass.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); x = Math.max(0.05, Math.min(0.95, x + (e.key === "ArrowLeft" ? -0.03 : 0.03))); set(); } if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drop(); } });
    glass.addEventListener("click", (e) => { if (e.target.closest(".cl-chute")) return; drop(); });
    $("cl-drop").onclick = drop;
    function drop() {
      if (dropping || busy) return;
      dropping = true;
      run(async () => {
        try {
          const r = takeWallet(await call("claw", "grab", { x }));
          const gh = glass.getBoundingClientRect().height;
          x = r.grab.x; set();
          const depth = Math.max(10, r.grab.y * gh - 26);
          rope.style.transition = reduced() ? "none" : "height 0.9s ease-in";
          rope.style.height = `${depth}px`;
          tone(220, 0.5, "sine", 0.025);
          await wait(950);
          clawEl.classList.add("closed");
          tone(500, 0.05);
          await wait(300);
          const cap = r.grab.target != null ? glass.querySelector(`[data-cap="${r.grab.target}"]`) : null;
          const held = cap && (r.grab.outcome === "won" || r.grab.outcome === "dropped");
          if (held) { cap.classList.add("held"); cap.style.transition = reduced() ? "none" : "top 0.9s ease-out"; cap.style.top = "14%"; }
          rope.style.transition = reduced() ? "none" : "height 0.9s ease-out";
          rope.style.height = "8px";
          if (r.grab.outcome === "dropped" && cap) setTimeout(() => { cap.style.transition = "top 0.5s ease-in"; cap.style.top = "70%"; clawEl.classList.remove("closed"); tone(160, 0.2); }, 450);
          await wait(950);
          if (r.grab.outcome === "won" && cap) {
            clawEl.style.transition = "left 0.7s ease-in-out"; x = 0.92; set();
            cap.style.transition = "left 0.7s ease-in-out"; cap.style.left = "92%";
            await wait(750);
            clawEl.classList.remove("closed");
            cap.style.transition = "top 0.4s ease-in, opacity 0.4s"; cap.style.top = "100%"; cap.style.opacity = "0";
            await wait(450);
            tone(880, 0.3, "triangle", 0.05);
            outcome({ stake: st.claw.cost, extra: `${r.grab.prize.icon} ${esc(r.grab.prize.label)}`, label: "🕹️ Attrapé !" });
            if (typeof confetti === "function") confetti({ particleCount: 60, spread: 60, origin: { y: 0.5 } });
            if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
          } else {
            clawEl.classList.remove("closed");
            outcome({ stake: st.claw.cost, label: { dropped: "🕹️ Retombée en route !", slipped: "🕹️ La pince a glissé…", miss: "🕹️ Rien sous la pince" }[r.grab.outcome] });
          }
          await wait(400);
          claw(r);
        } finally { dropping = false; }
      });
    }
  }

  // ------------------------------------------------------------------ plinko
  // Plateau de 8 rangees : la rangee r a r + 3 clous ; apres la rangee r la
  // bille est dans l'intervalle path[r] (0 a r + 1). Elle tombe sur un clou,
  // rebondit d'un cote ou de l'autre (animation pas a pas), puis dans un bac.
  const PL_MULTS = [9, 2.5, 1.2, 0.7, 0.4, 0.7, 1.2, 2.5, 9];
  const PL_S = 10, PL_TOP = 14, PL_ROW = 9.2; // espacement (en %), haut, hauteur de rangee
  const plX = (g, r) => 50 + (g - (r + 1) / 2) * PL_S;
  const plY = (r) => PL_TOP + r * PL_ROW;
  const plHistory = [];
  let plDropX = 0.5;
  function plinko() {
    const box = $("cz-game");
    const pegs = [];
    for (let r = 0; r < 8; r++) for (let i = 0; i <= r + 2; i++) pegs.push(`<span class="pk-peg" data-peg="${r}-${i}" style="left:${50 + (i - (r + 2) / 2) * PL_S}%;top:${plY(r)}%"></span>`);
    const binColor = (m) => (m >= 9 ? "#f59e0b" : m >= 2.5 ? "#f97316" : m >= 1.2 ? "#ec4899" : m >= 0.7 ? "#8b5cf6" : "#475569");
    box.innerHTML = `
      ${betBar("pk-bets")}
      <div class="pk-board" id="pk-board">
        <div class="pk-drop" id="pk-drop" title="Clique pour lâcher la bille"><span class="pk-aim" id="pk-aim" style="left:${plDropX * 100}%">▼</span></div>
        ${pegs.join("")}
        <div class="pk-bins">${PL_MULTS.map((m, i) => `<span class="pk-bin" data-bin="${i}" style="--c:${binColor(m)}">×${String(m).replace(".", ",")}</span>`).join("")}</div>
      </div>
      <div class="cz-actions"><button type="button" class="btn" id="pk-one">🔻 Lâcher une bille</button><button type="button" class="btn-secondary" id="pk-five">🔻×5 Cinq billes</button></div>
      ${plHistory.length ? `<p class="cz-history">Derniers bacs : ${plHistory.map((m) => `<span style="background:${binColor(m)}">${String(m).replace(".", ",")}</span>`).join("")}</p>` : ""}`;
    bindBets(box);
    const board = $("pk-board"), drop = $("pk-drop");
    drop.addEventListener("pointermove", (e) => { const r = board.getBoundingClientRect(); plDropX = Math.max(0.2, Math.min(0.8, (e.clientX - r.left) / r.width)); $("pk-aim").style.left = `${plDropX * 100}%`; });
    const one = async () => {
      const r = takeWallet(await call("plinko", "drop", { bet, x: plDropX }));
      await plAnimate(board, r.plinko);
      plHistory.unshift(r.plinko.mult); plHistory.length = Math.min(plHistory.length, 10);
      if (r.plinko.payout > r.plinko.bet) tone(880, 0.2, "triangle", 0.05);
      outcome({ stake: r.plinko.bet, win: r.plinko.payout, tickets: r.tickets, label: `🔻 Bac ×${String(r.plinko.mult).replace(".", ",")}` });
      return r;
    };
    drop.addEventListener("click", () => run(async () => { await one(); plinko(); }));
    $("pk-one").onclick = () => run(async () => { await one(); plinko(); });
    $("pk-five").onclick = () => run(async () => {
      let total = 0, paid = 0, tix = 0, n = 0;
      for (let k = 0; k < 5; k++) { const r = await one(); total += r.plinko.payout; paid += r.plinko.bet; tix += r.tickets || 0; n++; if (W && W.chips < bet) break; }
      outcome({ stake: paid, win: total, tickets: tix, label: `🔻 ${n} bille${n > 1 ? "s" : ""}` });
      plinko();
    });
  }
  // Une bille : chute sur chaque clou, petit rebond, puis le bac.
  function plAnimate(board, res) {
    return new Promise((resolve) => {
      const ball = document.createElement("span");
      ball.className = "pk-ball";
      board.appendChild(ball);
      const pts = [{ x: 50 + (res.x - 0.5) * PL_S * 0.6, y: 4 }];
      let prev = 0; // intervalle avant la rangee 0 : la bille tombe sur le clou du milieu
      for (let r = 0; r < 8; r++) {
        const pegX = r === 0 ? 50 : plX(prev, r - 1);
        pts.push({ x: pegX, y: plY(r) - 3.2, peg: `${r}-${prev + 1}` });
        prev = res.path[r];
        pts.push({ x: plX(prev, r), y: plY(r) + 2.6, arc: true });
      }
      pts.push({ x: plX(res.bin, 7), y: 93 });
      if (reduced()) { ball.remove(); resolve(); return; }
      let i = 0;
      const step = () => {
        if (i >= pts.length - 1) {
          const bin = board.querySelector(`[data-bin="${res.bin}"]`);
          if (bin) { bin.classList.add("lit"); setTimeout(() => bin.classList.remove("lit"), 900); }
          setTimeout(() => ball.remove(), 500);
          resolve();
          return;
        }
        const a = pts[i], b = pts[i + 1];
        const dur = b.arc ? 120 : i === 0 ? 220 : 110;
        const t0 = performance.now();
        const frame = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          const e = b.arc ? k : k * k;
          const lift = b.arc ? Math.sin(k * Math.PI) * 1.6 : 0;
          ball.style.left = `${a.x + (b.x - a.x) * e}%`;
          ball.style.top = `${a.y + (b.y - a.y) * e - lift}%`;
          if (k < 1) return requestAnimationFrame(frame);
          if (b.peg) { const pg = board.querySelector(`[data-peg="${b.peg}"]`); if (pg) { pg.classList.remove("hit"); void pg.offsetWidth; pg.classList.add("hit"); } tone(700 + Math.random() * 300, 0.02, "triangle", 0.02); }
          i++;
          step();
        };
        requestAnimationFrame(frame);
      };
      step();
    });
  }

  // ------------------------------------------------------------------ bonneteau
  // Chapeaux dessines ; a chaque echange, les deux chapeaux se croisent en
  // arc (l'un passe devant, l'autre derriere). Le booster n'est visible qu'au debut.
  let cupSpeed = 1;
  const hatHtml = (i) => `<button type="button" class="cp-cup" data-cup="${i}" style="--slot:${i}" disabled aria-label="Chapeau ${i + 1}"><span class="cp-prize"><img src="assets/JetonBooster.png" alt="" /></span><span class="cp-hat"><i class="crown"></i><i class="band"></i><i class="brim"></i></span><span class="cp-shadow"></span></button>`;
  async function cups() {
    const box = $("cz-game");
    let st;
    try { st = (await call("cups", "status")).cups; } catch (e) { box.innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; return; }
    box.innerHTML = `
      <div class="cp-stage" id="cp-stage">
        <div class="cp-host"><span class="cp-mascot" id="cp-mascot">🐈</span><span class="cp-bubble" id="cp-bubble">Mise, choisis ta vitesse… et garde l'œil sur le booster !</span></div>
        <div class="cp-cups">${[0, 1, 2].map(hatHtml).join("")}</div>
      </div>
      ${betBar("cp-bets")}
      <div class="cz-choice"><span>Vitesse</span><div class="tabs" role="radiogroup">${[1, 2, 3].map((s) => `<button type="button" role="radio" class="tab ${s === cupSpeed ? "active" : ""}" data-speed="${s}">${["", "🐢 Tranquille ×", "🐇 Rapide ×", "⚡ Éclair ×"][s]}${String(st.mults[s]).replace(".", ",")}</button>`).join("")}</div></div>
      <div class="cz-actions"><button type="button" class="btn" id="cp-go" ${st.playsLeft ? "" : "disabled"}>🎩 Mélanger !</button></div>
      <p class="muted cz-help">${st.playsLeft} partie${st.playsLeft > 1 ? "s" : ""} aujourd'hui. En vitesse 2 ou 3 avec une mise d'au moins ${st.boosterBet} 🪙, retrouver le booster le fait gagner pour de vrai${st.boosterLeft ? "" : " (déjà gagné aujourd'hui)"}.</p>`;
    bindBets(box);
    box.querySelectorAll("[data-speed]").forEach((b) => b.addEventListener("click", () => { cupSpeed = Number(b.dataset.speed); box.querySelectorAll("[data-speed]").forEach((x) => x.classList.toggle("active", x === b)); }));
    const say = (t) => { const b = $("cp-bubble"); if (b) { b.textContent = t; b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); } };
    $("cp-go").onclick = () => run(async () => {
      const r = takeWallet(await call("cups", "start", { bet, speed: cupSpeed }));
      const c = r.cups;
      $("cp-mascot").textContent = c.mascot.icon;
      box.querySelectorAll(".tabs button, #cp-go").forEach((b) => { b.disabled = true; });
      const els = [...box.querySelectorAll(".cp-cup")];
      const slotOf = [0, 1, 2];
      els[c.start].classList.add("lift", "has");
      say(`${c.mascot.name} : « Le booster est ici… regarde bien ! »`);
      await wait(1200);
      els[c.start].classList.remove("lift");
      await wait(380);
      els[c.start].classList.remove("has");
      say(`${c.mascot.name} mélange !`);
      const cupsBox = box.querySelector(".cp-cups");
      cupsBox.style.setProperty("--ms", `${c.swapMs}ms`);
      for (const [a, b] of c.swaps) {
        const ia = slotOf.indexOf(a), ib = slotOf.indexOf(b);
        slotOf[ia] = b; slotOf[ib] = a;
        // L'un passe devant (plus haut, plus grand), l'autre derriere.
        els[ia].classList.add("front"); els[ib].classList.add("back");
        els.forEach((el, i) => el.style.setProperty("--slot", slotOf[i]));
        tone(300 + Math.random() * 200, 0.03, "sine", 0.02);
        await wait(c.swapMs + 30);
        els[ia].classList.remove("front"); els[ib].classList.remove("back");
      }
      say("Alors, il est où ?");
      els.forEach((el) => { el.disabled = false; });
      busy = false;
      const picked = await new Promise((res) => els.forEach((el, i) => el.addEventListener("click", () => res(slotOf[i]), { once: true })));
      busy = true;
      els.forEach((el) => { el.disabled = true; });
      const p = takeWallet(await call("cups", "pick", { cup: picked }));
      const winner = els[slotOf.indexOf(p.cups.final)];
      const mine = els[slotOf.indexOf(picked)];
      mine.classList.add("lift", mine === winner ? "has" : "empty");
      await wait(450);
      if (mine !== winner) { winner.classList.add("lift", "has"); }
      outcome({ stake: c.bet, win: p.cups.payout, tickets: p.tickets, extra: p.cups.booster ? "+1 jeton booster 🃏" : "", label: p.cups.win ? "🎩 Bien vu !" : "🎩 Raté" });
      if (p.cups.win) { say("Bien vu !"); tone(880, 0.3, "triangle", 0.05); if (p.cups.booster && typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); if (typeof confetti === "function") confetti({ particleCount: 50, spread: 60, origin: { y: 0.5 } }); }
      else { say("Raté ! Il était là."); tone(200, 0.2, "sawtooth", 0.03); }
      await wait(1800);
      busy = false;
      cups();
    });
  }

  // ------------------------------------------------------------------ ticket a gratter
  async function scratch(state) {
    const box = $("cz-game");
    let st = state;
    if (!st) { try { st = (await call("scratch", "status")).scratch; } catch (e) { box.innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; return; } }
    const t = st.ticket;
    // Symbole gagnant (trois fois sur le ticket) pour le mettre en valeur.
    const counts = {};
    if (t) t.symbols.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
    const winSym = t && t.win ? Object.keys(counts).find((k) => counts[k] >= 3) : null;
    box.innerHTML = `
      <div class="sc-wrap">
        ${t ? `<div class="sc-ticket ${t.free ? "free" : ""}">
            <div class="sct-title"><span>LUCKY 2GATCHA</span><small>${t.free ? "Ticket du jour · offert" : "Ticket à gratter"} · 3 symboles identiques = gagné</small></div>
            <div class="sc-area" id="sc-area"><div class="sc-grid">${t.symbols.map((s) => `<span class="${s === winSym ? "win" : ""}">${s}</span>`).join("")}</div><canvas class="sc-foil" id="sc-foil" aria-label="Surface à gratter"></canvas></div>
            <div class="sc-foot" id="sc-foot"><span>Gratte la surface argentée…</span><button type="button" class="btn-ghost" id="sc-all">Tout gratter</button></div>
          </div>` : `<div class="sc-ticket sc-empty-ticket">
            <div class="sct-title"><span>LUCKY 2GATCHA</span><small>${st.freeToday ? "Ton ticket gratuit du jour t'attend !" : "Ticket du jour déjà gratté."}</small></div>
            <div class="sc-empty"><button type="button" class="btn" id="sc-new" ${st.freeToday || st.extraLeft ? "" : "disabled"}>${st.freeToday ? "🎫 Prendre mon ticket gratuit" : `🎫 Un ticket de plus · ${st.cost} 🪙`}</button>${!st.freeToday ? `<small>${st.extraLeft} ticket${st.extraLeft > 1 ? "s" : ""} en plus possible${st.extraLeft > 1 ? "s" : ""} aujourd'hui</small>` : ""}</div>
          </div>`}
        <aside class="sc-prizes"><h4>Table des lots</h4><ul>${st.prizes.map((p) => `<li><span class="sc-trio">${p.icon}${p.icon}${p.icon}</span> ${esc(p.label)}</li>`).join("")}</ul></aside>
      </div>`;
    if (!t) { $("sc-new").onclick = () => run(async () => { const r = takeWallet(await call("scratch", "new")); tone(600, 0.06); scratch(r.scratch); }); return; }
    const cv = $("sc-foil"), ctx = cv.getContext("2d");
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr);
    ctx.scale(dpr, dpr);
    const W2 = rect.width, H2 = rect.height;
    const g = ctx.createLinearGradient(0, 0, W2, H2);
    g.addColorStop(0, "#9ca3af"); g.addColorStop(0.35, "#e5e7eb"); g.addColorStop(0.5, "#f9fafb"); g.addColorStop(0.65, "#d1d5db"); g.addColorStop(1, "#6b7280");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W2, H2);
    // Motif de la pellicule.
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let y = 0; y < H2; y += 14) for (let x = (y / 14) % 2 ? 7 : 0; x < W2; x += 14) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "rgba(55,65,81,0.6)"; ctx.font = "800 18px Bungee, Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("✦ GRATTE ICI ✦", W2 / 2, H2 / 2);
    ctx.globalCompositeOperation = "destination-out";
    let down = false, done = false, last = null, moves = 0;
    const spark = (x, y) => {
      if (reduced() || Math.random() > 0.35) return;
      const r = cv.getBoundingClientRect();
      const d = document.createElement("span");
      d.className = "sc-flake";
      d.style.left = `${r.left + x}px`; d.style.top = `${r.top + y}px`;
      d.style.setProperty("--dx", `${Math.random() * 40 - 20}px`); d.style.setProperty("--dy", `${10 + Math.random() * 30}px`);
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 600);
    };
    const scrape = (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      ctx.lineWidth = 34; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(last ? last.x : x, last ? last.y : y); ctx.lineTo(x, y); ctx.stroke();
      last = { x, y };
      spark(x, y);
      if (Math.random() < 0.1) tone(1600 + Math.random() * 500, 0.01, "sawtooth", 0.008);
      if (++moves % 12 === 0) check();
    };
    const check = () => {
      if (done) return;
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let clear = 0;
      for (let i = 3; i < data.length; i += 64) if (data[i] === 0) clear++;
      if (clear / (data.length / 64) > 0.55) reveal();
    };
    const reveal = () => {
      if (done) return;
      done = true;
      cv.style.transition = "opacity 0.5s"; cv.style.opacity = "0";
      $("sc-area").classList.add("revealed");
      $("sc-foot").innerHTML = t.win ? `<strong class="sc-won">🎉 Gagné : ${esc(t.prize)} !</strong> <button type="button" class="btn" id="sc-claim">Récupérer</button>` : `<span>Pas de chance cette fois…</span> <button type="button" class="btn-secondary" id="sc-claim">${t.free ? "Prendre ma consolation" : "OK"}</button>`;
      if (t.win) { tone(880, 0.3, "triangle", 0.05); if (typeof confetti === "function") confetti({ particleCount: 80, spread: 70, origin: { y: 0.55 } }); }
      $("sc-claim").onclick = () => run(async () => { const r = takeWallet(await call("scratch", "claim")); outcome({ stake: t.free ? 0 : st.cost, extra: r.scratch.claimed.win || t.free ? esc(r.scratch.claimed.label) : "", label: r.scratch.claimed.win ? "🎫 Gagné !" : "🎫 Perdu" }); if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); scratch(r.scratch); });
    };
    $("sc-all").onclick = reveal;
    cv.addEventListener("pointerdown", (e) => { down = true; last = null; cv.setPointerCapture(e.pointerId); scrape(e); });
    cv.addEventListener("pointermove", (e) => { if (down) scrape(e); });
    cv.addEventListener("pointerup", () => { down = false; last = null; check(); });
  }

  // ------------------------------------------------------------------ comptoir des lots
  async function lots() {
    const box = $("cz-game");
    let st;
    try { st = takeWallet(await call("lots", "status")); } catch (e) { box.innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; return; }
    const have = W.tickets;
    box.innerHTML = `<div class="lt-head"><span class="lt-wallet">🎟️ <strong>${fmt(have)}</strong> ticket${have > 1 ? "s" : ""}</span><small class="muted">Gagnés dans les salles. Les cosmétiques du casino n'existent nulle part ailleurs.</small></div>
      <div class="lt-grid">${st.lots.map((l) => {
        const can = have >= l.price && !l.owned;
        const pct = Math.min(100, Math.round((have / l.price) * 100));
        return `<article class="lt-item ${l.owned ? "owned" : can ? "can" : ""}">
          <span class="lt-icon">${l.icon}</span><strong>${esc(l.label)}</strong>
          ${l.owned ? `<span class="lt-owned">✔ Déjà à toi</span>` : `<div class="lt-bar" aria-hidden="true"><span style="width:${pct}%"></span></div><small>${can ? "Disponible !" : `Il te manque ${fmt(l.price - have)} 🎟️`}</small>`}
          <button type="button" class="btn${can ? "" : "-secondary"}" data-lot="${l.key}" ${can ? "" : "disabled"}>${l.owned ? "—" : `${l.price} 🎟️`}</button>
        </article>`;
      }).join("")}</div>`;
    box.querySelectorAll("[data-lot]").forEach((b) => b.addEventListener("click", () => run(async () => {
      const lot = st.lots.find((x) => x.key === b.dataset.lot);
      if (lot && lot.price >= 60 && !(await Confirm.show(`Échanger ${lot.price} tickets contre « ${esc(lot.label)} » ?`, { title: "Comptoir des lots", confirmText: "Échanger" }))) return;
      const r = takeWallet(await call("lots", "buy", { key: b.dataset.lot }));
      Toast.success(r.card ? `⛓️ ${esc(r.card.name)} (${esc(r.card.rarity)}, édition Interdite) !` : "🎁 Lot échangé !");
      tone(880, 0.2, "triangle", 0.05);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      lots();
    })));
  }

  // ------------------------------------------------------------------ demarrage
  async function refreshHall() { try { takeWallet(await call("cashier", "status")); } catch (e) { /* porte fermee */ } }
  document.addEventListener("casino:refresh", refreshHall);
  document.addEventListener("DOMContentLoaded", async () => {
    if (!$("casino-zone") || !Session.isLoggedIn()) return;
    let res;
    try { res = await call("cashier", "status"); } catch (e) { return; } // porte fermee : rien
    renderShell();
    takeWallet(res);
    const m = location.hash.match(/^#salle-([a-z]+)/);
    if (m && GAMES.some((g) => g.key === m[1])) { history.replaceState(null, "", location.pathname); open(m[1]); }
  });
})();
