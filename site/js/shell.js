// Gabarit des pages (ex-main.js, decoupe 2026-10-04).
// En-tete, menu (haut et bas), pastilles, bandeau, maintenance, passage de
// niveau, solde de l'en-tete, et chargement groupe des donnees communes
// (prefetchShellData : une seule requete pour tout le gabarit).
// Ordre de chargement dans chaque page : config.js, api.js, core.js, ui.js,
// shell.js, puis le script de la page.

// ---------------------------------------------------------------------------
// Signaux de la page Communaute (2026-10-02) : quels onglets ont quelque chose
// d'actif (evenement prevu, boss en cours, offre au marche noir, carte a
// piocher dans le coffre) et une "empreinte" de ce contenu. Une empreinte
// differente de la derniere vue = pastille de nouveaute, jusqu'a ce que le
// joueur ouvre l'onglet. Partage entre communaute.js (onglets) et
// loadNavBadges (pastille du menu), avec un cache court pour ne pas refaire
// 4 appels a chaque page.
// ---------------------------------------------------------------------------
const CommunauteSignals = {
  TABS: ["calendar", "boss", "chest", "market"],
  async fetch(force) {
    if (force) API.invalidate(["eventCalendar", "communityBoss", "guildChest", "blackMarket"]);
    const [cal, boss, chest, market] = await Promise.all([
      API.getEventCalendar().catch(() => null),
      API.getBossStatus(Session.userId).catch(() => null),
      API.getGuildChestStatus(Session.userId).catch(() => null),
      API.listBlackMarket(Session.userId).catch(() => null)
    ]);
    const events = (cal && cal.events) || [];
    const offers = (market && market.offers) || [];
    const today = new Date().toISOString().slice(0, 10);
    const canDraw = !!(chest && !chest.alreadyDrawnToday && chest.poolSize > 0);
    const signals = {
      // Toujours visible (saisons, rendez-vous) ; la pastille ne signale que les evenements de l'asso.
      calendar: { active: true, sig: events.map((e) => e.label + "@" + (e.startsAt || "")).join("|") },
      boss: { active: !!(boss && boss.active), sig: boss && boss.active ? "boss:" + boss.bossName + ":" + boss.maxHp : "" },
      // Le coffre de guilde reste toujours visible (on peut deposer a tout
      // moment) ; la pastille ne signale qu'une carte a piocher aujourd'hui.
      chest: { active: true, sig: canDraw ? "draw:" + today : "" },
      market: { active: offers.length > 0, sig: offers.map((o) => o.offerId || o.id).join("|") }
    };
    return signals;
  },
  seenKey(tab) { return "2gatcha_seen_communaute_" + tab; },
  isUnseen(tab, signal) {
    if (!signal || !signal.active || !signal.sig) return false;
    try { return localStorage.getItem(this.seenKey(tab)) !== signal.sig; } catch (e) { return false; }
  },
  markSeen(tab, signal) {
    if (!signal || !signal.sig) return;
    try { localStorage.setItem(this.seenKey(tab), signal.sig); } catch (e) {}
  },
  unseenCount(signals) { return this.TABS.filter((t) => this.isUnseen(t, signals[t])).length; }
};

// "group: 'more'" (2026-09-30) : la nav du haut debordait silencieusement
// (aucun retour a la ligne ni defilement) des qu'on descendait sous ~1150px
// de large - un vrai bug decouvert par capture d'ecran, pas juste une
// question de gout : Craft/Code/Échanges/Communauté/Jeux/Admin devenaient
// tous inaccessibles au clavier/souris sur un ecran de tablette/petit
// laptop. Regroupe les pages les moins consultees au quotidien sous un menu
// "Plus" (voir renderHeader) pour degager assez de place - premiere etape
// d'une reorganisation plus large, pas la fin de l'histoire.
// Refonte des menus (2026-10-29) : plus aucun doublon. Le menu du haut garde
// les lieux (Jouer, Monde = jeux + communaute sur la meme carte, Collection) ;
// le compte (profil, progression, statistiques, cosmetiques, nouveautes) vit
// seulement dans le menu du joueur. auth "guest" : visiteurs seulement (pas
// de menu du joueur pour eux).
const NAV_ITEMS = [
  { href: "index.html", label: "Accueil", icon: "&#127968;", auth: false, badgeKey: "rewards" },
  { href: "ouverture.html", label: "Ouvrir un booster", icon: "&#127873;", auth: false, badgeKey: "boosters", group: "jouer", groupLabel: "Jouer" },
  { href: "mode.html", label: "Mode du moment", icon: "&#127922;", auth: true, group: "jouer" },
  { href: "redeem.html", label: "Réclamer un code", icon: "&#127915;", auth: true, group: "jouer" },
  { href: "nouveautes.html", label: "Nouveautés", icon: "&#128240;", auth: "guest", group: "jouer" },
  { href: "jeux.html", label: "Jeux (la nature)", icon: "&#127918;", auth: true, badgeKey: "jeux", group: "monde", groupLabel: "Monde" },
  { href: "communaute.html", label: "Communauté (le village)", icon: "&#127758;", auth: true, badgeKey: "communaute", group: "monde" },
  { href: "collection.html", label: "Ma collection", icon: "&#128218;", auth: false, group: "collection", groupLabel: "Collection" },
  // Craft / decraft : modes de la page collection depuis la fusion (2026-10-04).
  { href: "collection.html#decrafter", label: "Craft & décraft", icon: "&#10024;", auth: true, group: "collection" },
  { href: "coffre.html", label: "Coffre-fort perso", icon: "&#128274;", auth: true, group: "collection" },
  { href: "trade.html", label: "Échanges", icon: "&#128260;", auth: true, badgeKey: "trade", group: "collection" },
  // Artistes a l'honneur (2026-10-30) : ouvert a tous, meme sans compte.
  { href: "artistes.html", label: "Les artistes", icon: "&#127912;", auth: false, group: "collection" },
  { href: "boutique.html", label: "Boutique", icon: "&#128717;&#65039;", auth: true },
  { href: "admin.html", label: "Admin", icon: "&#128736;", auth: "admin" }
];

function currentPage() {
  return (window.location.pathname.split("/").pop() || "index.html");
}

// Salle interdite : ajoutee au menu « Jouer » une fois la porte ouverte ;
// son adresse n'est connue que du navigateur qui l'a ouverte.
function forbiddenNavItem() {
  let href = "";
  try { href = localStorage.getItem("2gatcha_forbidden") || ""; } catch (e) { href = ""; }
  return /^[a-z0-9-]+\.html$/.test(href) ? { href, label: "Salle interdite", icon: "&#127920;", auth: true, group: "jouer" } : null;
}
function visibleNavItems() {
  const extra = Session.isLoggedIn() ? forbiddenNavItem() : null;
  // Juste sous « Ouvrir un booster ».
  const at = NAV_ITEMS.findIndex((i) => i.href === "ouverture.html") + 1;
  const items = extra ? [...NAV_ITEMS.slice(0, at), extra, ...NAV_ITEMS.slice(at)] : NAV_ITEMS;
  return items.filter((item) => {
    if (item.auth === "admin") return Session.isLoggedIn() && Session.isAdmin();
    if (item.auth === "guest") return !Session.isLoggedIn();
    if (item.auth === true) return Session.isLoggedIn();
    return true;
  });
}

function renderBottomNav() {
  let el = document.querySelector(".bottom-nav");
  if (!el) {
    el = document.createElement("nav");
    el.className = "bottom-nav";
    document.body.appendChild(el);
  }
  const page = currentPage();
  // Icones seules (label en sr-only) : avec 8-9 destinations possibles
  // (Communaute/Jeux ajoutes cette session), les libelles textuels se
  // chevauchaient sur mobile (chaque <a> ne pouvait pas retrecir sous la
  // largeur de son mot le plus long). Les icones emoji restent assez
  // parlantes seules, et aria-label garde le nom accessible.
  // 2026-10-05 : 12 icones serrees sur 390px -> 4 destinations principales
  // avec libelle + "Plus" qui ouvre un panneau avec le reste.
  const items = visibleNavItems();
  const PRIMARY = ["index.html", "ouverture.html", "collection.html", "jeux.html"];
  const main = items.filter((i) => PRIMARY.includes(i.href));
  const more = items.filter((i) => !PRIMARY.includes(i.href));
  const link = (item) => `
    <a href="${item.href}" class="${item.href === page ? "active" : ""}" data-badge-key="${item.badgeKey || ""}" aria-label="${item.label}">
      <span class="bn-icon">${item.icon}</span>
      <span class="bn-label">${BN_SHORT[item.href] || item.label}</span>
    </a>`;
  el.innerHTML = main.map(link).join("") + (more.length ? `
    <button type="button" class="bn-more ${more.some((i) => i.href === page) ? "active" : ""}" id="bn-more-btn" aria-expanded="false" aria-controls="bn-sheet">
      <span class="bn-icon">&#9776;</span><span class="bn-label">Plus</span>
    </button>
    <div class="bn-sheet" id="bn-sheet" hidden>${more.map(link).join("")}</div>` : "");
  const btn = el.querySelector("#bn-more-btn");
  const sheetEl = el.querySelector("#bn-sheet");
  if (sheetEl) new MutationObserver(syncBottomMoreDot).observe(sheetEl, { childList: true, subtree: true });
  if (btn) btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const sheet = el.querySelector("#bn-sheet");
    sheet.hidden = !sheet.hidden;
    btn.setAttribute("aria-expanded", String(!sheet.hidden));
  });
  document.addEventListener("click", (e) => {
    const sheet = el.querySelector("#bn-sheet");
    if (sheet && !sheet.hidden && !e.target.closest(".bn-sheet")) { sheet.hidden = true; btn?.setAttribute("aria-expanded", "false"); }
  });
}
const BN_SHORT = { "index.html": "Accueil", "ouverture.html": "Ouvrir", "collection.html": "Collection", "jeux.html": "Jeux", "communaute.html": "Communauté", "trade.html": "Échanges", "coffre.html": "Coffre-fort", "boutique.html": "Boutique", "redeem.html": "Code", "mode.html": "Mode", "progression.html": "Progression", "craft.html": "Atelier", "admin.html": "Admin", "stats.html": "Stats" };

// Pastille sur "Plus" quand un element du panneau en a une.
function syncBottomMoreDot() {
  const btn = document.getElementById("bn-more-btn");
  if (!btn) return;
  btn.querySelectorAll(".nav-dot").forEach((d) => d.remove());
  const dots = document.querySelectorAll("#bn-sheet .nav-dot");
  if (dots.length) {
    const d = document.createElement("span");
    d.className = "nav-dot";
    d.textContent = String(dots.length);
    btn.querySelector(".bn-icon").appendChild(d);
  }
}

// Nombres compacts pour l'en-tete : 12 395 -> 12,4k (valeur exacte en infobulle).
function compactNumber(n) {
  n = Number(n) || 0;
  if (n < 10000) return n;
  if (n < 1000000) return (n / 1000).toFixed(n < 100000 ? 1 : 0).replace(".", ",") + "k";
  return (n / 1000000).toFixed(1).replace(".", ",") + "M";
}
function setCount(el, n) {
  if (!el) return;
  const chip = el.closest(".stat-chip");
  if (chip) {
    if (!chip.dataset.label) chip.dataset.label = chip.title || "";
    chip.title = `${chip.dataset.label} : ${Number(n || 0).toLocaleString("fr-FR")}`;
  }
  const v = window.innerWidth < 1100 ? compactNumber(n) : Number(n) || 0;
  if (typeof v === "number") bumpNumber(el, v); else el.textContent = v;
}

// ---------------------------------------------------------------------------
// Centre de recompenses (2026-10-05) : tout ce qui se reclame, d'ou que ca
// vienne, avec un bouton "Tout recuperer". Partage par la pastille du menu
// (Accueil) et le panneau de la page d'accueil. Chaque entree : { key, icon,
// label, claim() }. "deadlines" : ce qui se termine bientot.
// ---------------------------------------------------------------------------
const RewardsCenter = {
  async collect() {
    const uid = Session.userId;
    const [quests, weekly, levelRewards, streak, sets, season, challenges, goal, themes, box, dice, wheel, dogGift, gifts, goalSt] = await Promise.all([
      API.getQuestStatus(uid).catch(() => null),
      API.getWeeklyQuestStatus(uid).catch(() => null),
      API.getLevelRewardsStatus(uid).catch(() => null),
      API.getLoginStreak(uid).catch(() => null),
      API.getSetRewards(uid).catch(() => null),
      API.getSeason(uid).catch(() => null),
      API.challenges(uid).catch(() => null),
      API.communityGoal(uid).catch(() => null),
      API.themes(uid).catch(() => null),
      API.dailyBox ? API.dailyBox(uid).catch(() => null) : null,
      API.dailyDice ? API.dailyDice(uid).catch(() => null) : null,
      API.getDailyWheelStatus(uid).catch(() => null),
      API.dogGift ? API.dogGift(uid).catch(() => null) : null,
      API.playerGift ? API.playerGift(uid).catch(() => null) : null,
      API.weeklyGoal ? API.weeklyGoal(uid).catch(() => null) : null
    ]);
    const items = [];
    // Rituels du jour (2026-10-11) : ouverts aussi par "Tout récupérer", avec un récapitulatif.
    if (box?.available) items.push({ key: "box", icon: "&#127873;", label: "Boîte du jour à ouvrir", claim: () => API.dailyBox(uid, "open"), describe: (r) => r.item ? `${r.item.icon} ${r.item.label}` : "" });
    if (dice && !dice.rolled) items.push({ key: "dice", icon: "&#127922;", label: "Dé du jour à lancer", claim: () => API.dailyDice(uid, "roll"), describe: (r) => r.effect ? `${r.effect.icon} ${r.effect.label}` : "" });
    if (goalSt?.active && goalSt.done && !goalSt.claimed) items.push({ key: "weekly-goal", icon: "&#128220;", label: `Contrat de la semaine rempli : ${goalSt.label}`, claim: () => API.weeklyGoal(uid, "claim"), describe: () => "&#127183; 1 booster + titre « Contractuel »" });
    if (dogGift?.available) items.push({ key: "dog-gift", icon: "&#128021;", label: "Milo t'a rapporté une trouvaille", claim: () => API.dogGift(uid, "claim"), describe: (r) => (r.gift ? `${r.gift.icon} ${r.gift.label}` : "") });
    if (gifts?.received?.length) items.push({ key: "player-gifts", icon: "&#127873;", label: `${gifts.received.length} cadeau${gifts.received.length > 1 ? "x" : ""} de ${[...new Set(gifts.received.map((g) => g.from))].slice(0, 3).join(", ")}`, claim: () => API.playerGift(uid, "claim"), describe: () => gifts.received.map((g) => `${g.icon} ${g.label} (${g.from})`).join(" · ") });
    if (wheel?.canSpin) items.push({ key: "wheel", icon: "&#127905;", label: "Roue de la fortune à tourner", claim: () => API.spinDailyWheel(uid), describe: (r) => { const p = r.prize || {}; return p.type === "stardust" ? `&#10024; ${p.amount} poussières` : p.type === "booster" ? "&#127183; 1 booster" : p.type === "key" ? resIcon("key") + " 1 clé" : p.type === "jackpot" ? `&#127881; Jackpot : ${p.amount} boosters + ${p.dust} poussières` : ""; } });
    if (streak?.canClaim) items.push({ key: "streak", icon: "&#128293;", label: `Cadeau de connexion (jour ${streak.day || ""})`, claim: () => API.claimLoginStreak(uid) });
    if (quests?.canClaim) items.push({ key: "quests", icon: "&#9989;", label: "Quêtes du jour terminées", claim: () => API.claimQuestReward(uid) });
    if (weekly?.canClaim) items.push({ key: "weekly", icon: "&#128197;", label: "Quêtes de la semaine terminées", claim: () => API.claimWeeklyQuestReward(uid) });
    if (levelRewards?.hasPending) items.push({ key: "level", icon: "&#11088;", label: "Récompenses de niveau", claim: () => API.claimLevelRewards(uid) });
    if (season?.claimable > 0) {
      const tierN = season.tierClaimable != null ? season.tierClaimable : season.claimable;
      items.push({ key: "season", icon: "&#127942;", label: tierN ? `Saison : ${tierN} palier${tierN > 1 ? "s" : ""} à récupérer` : `Saison terminée : bonus de ${season.claimable * (season.bonus?.dustPerTier || 0)} poussières`, claim: () => API.claimSeason(uid) });
    }
    if (season?.chest?.previous?.claimable) items.push({ key: "season-chest", icon: resIcon("chest"), label: `Coffre de la saison ${season.chest.previous.label} à ouvrir`, claim: () => API.claimSeasonChest(uid) });
    (sets?.sets || []).filter((x) => x.complete && !x.claimed).forEach((x) => items.push({ key: "set-" + x.extensionId, icon: "&#128218;", label: `Set complet : ${x.name}`, claim: () => API.claimSetReward(uid, x.extensionId) }));
    if (challenges?.claimable > 0) items.push({ key: "challenges", icon: "&#127919;", label: `Défis de la semaine : ${challenges.claimable} récompense${challenges.claimable > 1 ? "s" : ""}`, claim: () => API.challenges(uid, "claim") });
    if (goal?.claimable) items.push({ key: "goal", icon: "&#129309;", label: `Objectif commun réussi : ${goal.reward.dust} ✨ + ${goal.reward.worms} vers`, claim: () => API.communityGoal(uid, "claim") });
    if (themes?.claimable > 0) items.push({ key: "themes", icon: "&#127912;", label: `Collection thématique terminée (+ titre)`, claim: () => API.themes(uid, "claim") });
    const deadlines = [];
    const t = Math.floor(Date.now() / 1000);
    const left = (end) => { const h = Math.max(0, Math.round((end - t) / 3600)); return h >= 48 ? `${Math.round(h / 24)} j` : `${h} h`; };
    if (season?.enabled && season.endsAt - t < 3 * 86400) deadlines.push({ icon: "&#127942;", label: `La saison ${season.label} se termine dans ${left(season.endsAt)}`, url: "index.html#saison" });
    if (challenges && challenges.endsAt - t < 2 * 86400) {
      const open = challenges.offered.filter((c) => c.picked && !c.done).length;
      if (open || challenges.picksLeft) deadlines.push({ icon: "&#127919;", label: `Défis de la semaine : fin dans ${left(challenges.endsAt)}${open ? ` (${open} à finir)` : ""}`, url: "index.html#defis" });
    }
    if (goal && !goal.reached && goal.endsAt - t < 2 * 86400) deadlines.push({ icon: "&#129309;", label: `Objectif commun : ${goal.progress}/${goal.target} ${goal.unit}, fin dans ${left(goal.endsAt)}`, url: "communaute.html#ensemble" });
    return { items, deadlines, challenges, goal };
  },
  async claimAll(items) {
    const done = [], failed = [];
    for (const it of items) {
      try { const res = await it.claim(); done.push({ ...it, result: it.describe ? it.describe(res || {}) : "" }); } catch (e) { failed.push(it); }
    }
    return { done, failed };
  }
};

// En-tete compact (2026-10-05) : sur les ecrans moyens et petits, les
// ressources secondaires (clefs, vers, pieces, tickets) se rangent derriere un
// bouton sac a dos au lieu de faire deborder la barre.
function syncStatsMore() {
  const extra = document.getElementById("header-stats-extra");
  const btn = document.getElementById("stats-more-btn");
  if (!extra || !btn) return;
  const visible = [...extra.children].filter((c) => c.style.display !== "none").length;
  btn.hidden = !visible;
  document.getElementById("stats-more-count").textContent = visible ? String(visible) : "";
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest && e.target.closest("#stats-more-btn");
  const extra = document.getElementById("header-stats-extra");
  if (!extra) return;
  if (btn) {
    const open = !extra.classList.contains("open");
    extra.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
  } else if (!e.target.closest || !e.target.closest("#header-stats-extra")) {
    extra.classList.remove("open");
    document.getElementById("stats-more-btn")?.setAttribute("aria-expanded", "false");
  }
});

// Pastille d'un onglet du menu (nav du haut + nav du bas) : text vide ou 0 =
// pas de pastille.
function setNavDot(key, text, { cls = "", title = "" } = {}) {
  document.querySelectorAll(`[data-badge-key="${key}"]`).forEach((a) => {
    a.querySelectorAll(".nav-dot").forEach((d) => d.remove());
    if (!text) return;
    const dot = document.createElement("span");
    dot.className = "nav-dot" + (cls ? " " + cls : "");
    dot.textContent = String(text);
    if (title) dot.title = title;
    (a.querySelector(".bn-icon") || a).appendChild(dot);
  });
}
const navCount = (n) => (n > 9 ? "9+" : n > 0 ? String(n) : "");

// Titre de l'onglet du navigateur (2026-10-18) : « (3) Collection - 2Gatcha »
// tant qu'il y a des recompenses a recuperer ou des echanges en attente.
const TabTitle = {
  base: null,
  set(n) {
    if (this.base == null) this.base = document.title.replace(/^\(\d+\+?\)\s*/, "");
    document.title = n > 0 ? `(${n > 99 ? "99+" : n}) ${this.base}` : this.base;
    // Application installee (2026-10-21) : meme compteur sur son icone.
    try { if (navigator.setAppBadge) { if (n > 0) navigator.setAppBadge(n).catch(() => {}); else navigator.clearAppBadge().catch(() => {}); } } catch (e) { /* non pris en charge */ }
  }
};

// Petite pastille rouge sur l'onglet Échanges (nav du bas + nav du haut)
// quand au moins un échange entrant est en attente de reponse.
async function loadNavBadges() {
  if (!Session.isLoggedIn()) return;
  // Toutes les lectures ci-dessous partent en une seule requete
  // (prefetchShellData) : plus de cascade d'appels a chaque page.
  let pendingCount = 0;
  {
    try {
      const res = await API.listTrades(Session.userId);
      pendingCount = (res.trades || []).filter((t) => t.direction === "incoming" && t.status === "pending").length;

      // Notification en jeu : signale une nouvelle proposition recue depuis
      // la dernière visite, sauf sur la page d'échanges elle-meme (deja
      // sous les yeux de l'utilisateur).
      const lastSeenKey = "2gatcha_last_seen_pending_trades";
      const lastSeen = Number(localStorage.getItem(lastSeenKey) || 0);
      if (pendingCount > lastSeen && currentPage() !== "trade.html") {
        Toast.info(`Nouvelle proposition d'échange reçue ! (${pendingCount} en attente)`);
      }
      localStorage.setItem(lastSeenKey, String(pendingCount));
    } catch (e) {
      return;
    }
  }
  syncBottomMoreDot();
  // Liste de souhaits : une carte souhaitee est disponible quelque part.
  let wishCount = 0;
  try { wishCount = (await API.wishlistAlerts(Session.userId)).count || 0; } catch (e) { wishCount = 0; }
  setNavDot("trade", pendingCount ? navCount(pendingCount) : wishCount ? "♥" : "", {
    cls: pendingCount ? "" : "nav-dot-wish",
    title: pendingCount ? "Échanges en attente" : `${wishCount} carte${wishCount > 1 ? "s" : ""} de ta liste de souhaits disponible${wishCount > 1 ? "s" : ""}`
  });
  syncBottomMoreDot();

  // Meme principe pour le nombre de boosters disponibles : un rappel visuel
  // sur l'onglet, pas seulement le badge du header (moins visible sur
  // mobile, ou le header se replie).
  try {
    const status = await API.getBoosterStatus(Session.userId);
    setNavDot("boosters", navCount(status.count || 0));
  } catch (e) { /* pas grave, juste un rappel visuel */ }

  // Pastilles "quelque chose a reclamer" (2026-09-30) : jusqu'ici seuls les
  // echanges/boosters avaient un rappel sur la nav, une quete/un palier de
  // niveau termine ou un coffre-fort pret ne se decouvraient qu'en visitant
  // la page par hasard. Cache plus longtemps que trades/boosters (ces etats
  // bougent moins souvent) pour ne pas multiplier les requetes en arriere-
  // plan a chaque changement de page.
  try {
    const rewardsCount = (await RewardsCenter.collect()).items.length;
    setNavDot("rewards", rewardsCount || "");
    TabTitle.set(rewardsCount + pendingCount);
    // Cloche : nombre de choses a faire (centre de notifications, 2026-10-21).
    NotificationHistory.todo = rewardsCount + pendingCount;
    renderNotifDot();
  } catch (e) { /* pas grave, juste un rappel visuel */ }

  try {
    let jeuxCount;
    {
      const [vault, bingo, guess, expedition] = await Promise.all([
        API.getVaultStatus(Session.userId).catch(() => null),
        API.getBingoStatus(Session.userId).catch(() => null),
        API.guessCard(Session.userId, "status").catch(() => null),
        API.expedition(Session.userId, "status").catch(() => null)
      ]);
      // Rappels quotidiens (2026-10-04) : quiz du jour pas encore joue,
      // expedition rentree ou chien de fouille au repos... de quoi revenir.
      const guessReady = !!(guess && guess.choices && !guess.played);
      const expeditionReady = !!(expedition && expedition.expedition && expedition.expedition.active && expedition.expedition.ready);
      const vaultReady = !!(vault && !vault.alreadyOpened && vault.userKeys >= vault.keysRequired);
      const bingoReady = !!(bingo && bingo.hasGrid && bingo.allOwned && !bingo.claimed);
      jeuxCount = [vaultReady, bingoReady, guessReady, expeditionReady].filter(Boolean).length;
    }
    setNavDot("jeux", jeuxCount || "");

    try {
      const signals = await CommunauteSignals.fetch();
      setNavDot("communaute", CommunauteSignals.unseenCount(signals) || "");
    } catch (e) { /* rappel visuel facultatif */ }

    // "Ouvrir un booster" (badgeKey boosters) vit desormais sous le sous-menu
    // "Jouer" (voir NAV_ITEMS/buildNavNodes) : sans ca, sa pastille de rappel
    // resterait invisible tant qu'on n'a pas deplie le groupe. On reporte
    // donc un simple point sur CHAQUE declencheur de groupe des qu'au moins
    // un lien qu'il contient a lui-meme une pastille active.
    document.querySelectorAll(".nav-group").forEach((group) => {
      const trigger = group.querySelector(".nav-group-trigger");
      const hasChildDot = !!group.querySelector(".nav-group-dropdown .nav-dot");
      trigger.classList.toggle("has-dot", hasChildDot);
    });
  } catch (e) { /* pas grave, juste un rappel visuel */ }
}

function renderHeader() {
  renderBottomNav();

  const el = document.getElementById("site-header");
  if (!el) return;

  const page = currentPage();
  // Reorganisation du menu (2026-09-30, demande explicite) : plutot qu'une
  // liste plate de 9 destinations, les pages qui appartiennent au meme geste
  // sont regroupees sous un sous-menu nomme (voir NAV_ITEMS) - "Jouer"
  // (ouvrir un booster / reclamer un code) et "Collection" (consulter / faire
  // evoluer via craft) - le reste (Communaute, Jeux, Echanges, Admin) reste
  // en acces direct, deja assez distinct pour ne pas avoir besoin d'y etre
  // range. buildNavNodes() construit une liste ordonnee de noeuds - lien
  // simple ou groupe - en respectant l'ordre de declaration de NAV_ITEMS.
  function buildNavNodes(items) {
    const nodes = [];
    const groupIndex = {};
    items.forEach((item) => {
      if (item.group) {
        if (!(item.group in groupIndex)) {
          groupIndex[item.group] = nodes.length;
          nodes.push({ type: "group", key: item.group, label: item.groupLabel || item.group, items: [] });
        }
        nodes[groupIndex[item.group]].items.push(item);
      } else {
        nodes.push({ type: "link", item });
      }
    });
    return nodes;
  }
  const navLinkHtml = (i) => `<a href="${i.href}" class="${i.href === page ? "active" : ""}" data-badge-key="${i.badgeKey || ""}">${i.label}</a>`;
  const navHtml = buildNavNodes(visibleNavItems()).map((node) => {
    if (node.type === "link") return navLinkHtml(node.item);
    const activeInGroup = node.items.some((i) => i.href === page);
    return `
      <div class="nav-group" id="nav-group-${node.key}">
        <button type="button" class="nav-group-trigger ${activeInGroup ? "active" : ""}" aria-haspopup="true" aria-expanded="false">${node.label} <span class="nav-group-arrow">&#9662;</span></button>
        <div class="nav-group-dropdown">${node.items.map(navLinkHtml).join("")}</div>
      </div>
    `;
  }).join("");
  const links = `<nav class="nav">${navHtml}</nav>`;

  if (Session.isLoggedIn()) {
    const avatar = Session.discordAvatar
      ? `<img class="avatar" src="${Session.discordAvatar}" alt="" />`
      : "";
    el.innerHTML = `
      <div class="header-inner">
        <span class="brand" id="site-brand"><span class="brand-text">2Gatcha</span><span class="brand-fx" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></span>
        ${links}
        <div class="user-box">
          <div class="inventory" id="inventory">
          <button type="button" class="header-stats" id="inventory-trigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="inventory-panel" title="Ouvrir l'inventaire">
            <span id="header-booster-badge" class="stat-chip" title="Jetons booster (1 jeton = 1 booster au choix)">
              <span class="icon"><img class="ico-token" src="assets/JetonBooster.png" alt="" /></span><span class="count">...</span>
            </span>
            <span class="stat-divider" aria-hidden="true"></span>
            <span id="header-stardust-badge" class="stat-chip" title="Poussières d'étoile (craft/décraft)">
              <span class="icon">&#10024;</span><span class="count">...</span>
            </span>
            <span id="header-key-divider" class="stat-divider" aria-hidden="true" style="display:none;"></span>
            <span class="stats-extra" id="header-stats-extra">
            <span id="header-key-badge" class="stat-chip" title="Clés" style="display:none;">
              <span class="icon"><img class="ico-token" src="assets/clés.PNG" alt="" /></span><span class="count">0</span>
            </span>
            <span id="header-worm-badge" class="stat-chip stat-chip-worm" title="Vers de terre" style="display:none;">
              <span class="icon"><img class="ico-token" src="assets/P%C3%AAche/Vers.png" alt="" /></span><span class="count">0</span>
            </span>
            <span id="header-part-badge" class="stat-chip stat-chip-part" title="Pièces détachées" style="display:none;">
              <span class="icon"><img class="ico-token" src="assets/PieceDetachee.PNG" alt="" /></span><span class="count">0</span>
            </span>
            <span id="header-ticket-badge" class="stat-chip stat-chip-ticket" title="Tickets Unique" style="display:none;">
              <span class="icon">&#127915;</span><span class="count">0</span>
            </span>
            </span>
            <span class="inventory-caret" aria-hidden="true">&#9662;</span>
          </button>
          <div class="inventory-panel" id="inventory-panel" role="dialog" aria-label="Inventaire" hidden></div>
          </div>
          <div class="global-search" id="global-search">
            <button type="button" class="global-search-trigger" id="global-search-trigger" aria-label="Recherche" title="Rechercher un joueur, une carte...">&#128269;</button>
            <div class="global-search-panel" id="global-search-panel">
              <input type="text" id="global-search-input" placeholder="Joueur, carte, page…" autocomplete="off" />
              <div class="gs-filters" id="gs-filters">
                <select id="gs-rarity" aria-label="Rareté"><option value="">Toutes raretés</option></select>
                <select id="gs-finish" aria-label="Finition"><option value="">Toutes finitions</option><option value="normal">Normale</option><option value="holo">Holo</option><option value="gold">Doré</option><option value="ghost">Ghost</option><option value="diamond">Diamant</option><option value="rainbow">Arc-en-ciel</option></select>
                <select id="gs-quality" aria-label="État"><option value="">Tous états</option><option value="damaged">Usé</option><option value="worn">Abîmé</option><option value="good">Bon état</option><option value="mint">Parfait état</option></select>
                <select id="gs-owned" aria-label="Possession"><option value="">Possédées ou non</option><option value="owned">Possédées</option><option value="missing">Manquantes</option></select>
              </div>
              <div class="global-search-results" id="global-search-results"></div>
            </div>
          </div>
          <div class="notif-bell" id="notif-bell">
            <button type="button" class="notif-bell-trigger" id="notif-bell-trigger" aria-label="Notifications recentes" title="Notifications recentes">
              &#128276;<span id="notif-bell-dot" class="notif-bell-dot" style="display:none;"></span>
            </button>
            <div class="notif-bell-dropdown" id="notif-bell-dropdown"></div>
          </div>
          <div class="user-menu" id="user-menu">
            <button type="button" class="user-menu-trigger" id="user-menu-trigger">
              ${avatar}
              <span id="header-level-badge" class="level-badge" style="display:none;" title="Niveau de profil"></span>
              <span id="header-pseudo">${escHtml(Session.pseudo || "")}</span>
              <span class="caret">&#9660;</span>
            </button>
            <div class="user-menu-dropdown" id="user-menu-dropdown">
              <div class="menu-head">${avatar}<span><strong id="menu-pseudo">${escHtml(Session.pseudo || "")}</strong><small>Mon compte</small></span></div>
              <a id="view-profile-link" href="profile.html?pseudo=${encodeURIComponent(Session.pseudo || "")}"><span class="mi">&#128100;</span> Mon profil</a>
              <a href="progression.html"><span class="mi">&#127795;</span> Talents et maîtrises</a>
              <a href="stats.html"><span class="mi">&#128202;</span> Mes statistiques</a>
              <button type="button" data-wishlist-open title="Les cartes que tu cherches, et où les trouver maintenant"><span class="mi">&#9829;</span> Ma liste de souhaits</button>
              <a href="boutique.html#cosmetiques"><span class="mi">&#127912;</span> Titres, cadres, couleurs</a>
              <a href="nouveautes.html" id="notes-link"><span class="mi">&#128240;</span> Nouveautés</a>
              <button type="button" data-quick-session title="Récompenses, récolte, explorateur, pioche gratuite : tout ce qui se fait sans choisir"><span class="mi">&#9889;</span> Session rapide</button>
              <button type="button" data-reminders title="Être prévenu quand l'énergie, le jardin, l'expédition ou un lot est prêt"><span class="mi">&#9200;</span> Rappels : <span data-reminders-label>${(() => { try { return (JSON.parse(localStorage.getItem("2gatcha_reminders") || "null") || {}).on ? "activés" : "désactivés"; } catch (e) { return "désactivés"; } })()}</span></button>
              <button type="button" data-app-install hidden title="Plein écran, icône sur l'écran d'accueil, raccourcis Booster, Collection, Jeux"><span class="mi">&#128242;</span> Installer l'application</button>
              <div class="menu-sep"></div>
              <button id="edit-pseudo-btn" type="button"><span class="mi">&#9998;</span> Modifier le pseudo</button>
              <button id="copy-profile-link-btn" type="button"><span class="mi">&#128279;</span> Copier le lien de mon profil</button>
              <button type="button" data-prefs-open title="Thème, texte, effets, son, vibrations, cinématiques, rappels, notifications"><span class="mi">&#9881;&#65039;</span> Préférences</button>
              <div class="menu-sep"></div>
              <button id="logout-btn" type="button" class="menu-danger"><span class="mi">&#10162;</span> Déconnexion</button>
            </div>
          </div>
        </div>
      </div>
    `;
    const userMenu = document.getElementById("user-menu");
    document.getElementById("user-menu-trigger").addEventListener("click", (e) => {
      e.stopPropagation();
      userMenu.classList.toggle("open");
    });
    document.addEventListener("click", (e) => {
      if (!userMenu.contains(e.target)) userMenu.classList.remove("open");
    });
    const notifBell = document.getElementById("notif-bell");
    renderNotifDot();
    document.getElementById("notif-bell-trigger").addEventListener("click", (e) => {
      e.stopPropagation();
      const opening = !notifBell.classList.contains("open");
      notifBell.classList.toggle("open", opening);
      if (opening) {
        // Historique tout de suite, puis le centre de notifications complet
        // (js/lazy/notif-center.js : a faire, echanges, minuteurs, filtres).
        const lastSeen = NotificationHistory.lastSeen();
        renderNotifDropdown();
        LazyJs.load("js/lazy/notif-center.js").then(() => NotifCenter.open(document.getElementById("notif-bell-dropdown"), lastSeen)).catch(() => {});
        NotificationHistory.markAllSeen();
        renderNotifDot();
      }
    });
    document.addEventListener("click", (e) => {
      if (!notifBell.contains(e.target)) notifBell.classList.remove("open");
    });

    // Sous-menus de nav (Jouer/Collection, voir NAV_ITEMS/buildNavNodes) :
    // meme squelette ouverture/fermeture que .user-menu/.notif-bell, generique
    // pour fonctionner avec n'importe quel nombre de groupes simultanes -
    // ouvrir l'un referme automatiquement les autres.
    document.querySelectorAll(".nav-group").forEach((group) => {
      const trigger = group.querySelector(".nav-group-trigger");
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const opening = !group.classList.contains("open");
        document.querySelectorAll(".nav-group.open").forEach((g) => {
          if (g !== group) { g.classList.remove("open"); g.querySelector(".nav-group-trigger").setAttribute("aria-expanded", "false"); }
        });
        group.classList.toggle("open", opening);
        trigger.setAttribute("aria-expanded", opening ? "true" : "false");
      });
    });
    document.addEventListener("click", (e) => {
      document.querySelectorAll(".nav-group.open").forEach((group) => {
        if (!group.contains(e.target)) {
          group.classList.remove("open");
          group.querySelector(".nav-group-trigger").setAttribute("aria-expanded", "false");
        }
      });
    });

    // Recherche globale (QoL 2026-09-30, demande explicite : "les profils
    // sont peu accessibles") : trouve un joueur par pseudo (raccourci direct
    // vers son profil, jusque-la seulement atteignable en cliquant un pseudo
    // au hasard sur le classement/un echange), une carte, ou une page. Les
    // listes joueurs/cartes ne sont chargees qu'a la premiere ouverture (pas
    // sur chaque chargement de page), en reutilisant le cache existant de
    // API.listUsers()/getCards() si une autre page l'a deja rempli.
    const searchEl = document.getElementById("global-search");
    const searchInput = document.getElementById("global-search-input");
    const searchResults = document.getElementById("global-search-results");
    let searchDataLoaded = false;
    let searchUsers = [];
    let searchCards = [];
    // Filtres (2026-10-07) : rarete, finition, etat, possedees / manquantes.
    let searchOwned = new Map();
    const gsVal = (id) => (document.getElementById(id) || {}).value || "";
    const gsActive = () => ["gs-rarity", "gs-finish", "gs-quality", "gs-owned"].some((id) => gsVal(id));

    async function ensureSearchData() {
      if (searchDataLoaded) return;
      searchDataLoaded = true;
      try {
        const [usersRes, cardsRes, col] = await Promise.all([API.listUsers(), API.getCards(), Session.isLoggedIn() ? API.getCollection(Session.userId).catch(() => ({})) : Promise.resolve({})]);
        searchUsers = usersRes.users || [];
        searchCards = cardsRes.cards || [];
        searchOwned = new Map((col.owned || []).map((o) => [o.cardId, o]));
        const rarities = new Map();
        searchCards.forEach((c) => { if (c.rarity && !rarities.has(c.rarity.key)) rarities.set(c.rarity.key, c.rarity); });
        document.getElementById("gs-rarity").innerHTML = '<option value="">Toutes raretés</option>' + [...rarities.values()].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((r) => `<option value="${r.key}">${r.name}</option>`).join("");
        if (!Session.isLoggedIn()) document.getElementById("gs-owned").disabled = true;
      } catch (e) { /* recherche degradee (pages seulement) si hors-ligne */ }
    }

    function cardMatchesFilters(c) {
      const rarity = gsVal("gs-rarity"), finish = gsVal("gs-finish"), quality = gsVal("gs-quality"), own = gsVal("gs-owned");
      if (rarity && c.rarity?.key !== rarity) return false;
      const o = searchOwned.get(c.cardId);
      if (own === "owned" && !o) return false;
      if (own === "missing" && o) return false;
      if (finish || quality) {
        if (!o) return false;
        return (o.copies || []).some((cp) => (!finish || (cp.finish || "normal") === finish) && (!quality || (cp.quality || "damaged") === quality));
      }
      return true;
    }

    function renderSearchResults(query) {
      const q = query.trim().toLowerCase();
      const filtering = gsActive();
      if (!q && !filtering) { searchResults.innerHTML = `<div class="global-search-hint">Tape un pseudo, un nom de carte… ou choisis des filtres.</div>`; return; }
      const players = filtering ? [] : searchUsers.filter((u) => (u.pseudo || "").toLowerCase().includes(q)).slice(0, 5);
      const cardMatches = searchCards.filter((c) => (!q || (c.name || "").toLowerCase().includes(q)) && cardMatchesFilters(c));
      const cards = cardMatches.slice(0, filtering ? 12 : 5);
      const pages = filtering ? [] : visibleNavItems().filter((i) => i.label.toLowerCase().includes(q));
      const sections = [];
      if (players.length) {
        sections.push(`<div class="global-search-group">Joueurs</div>` + players.map((u) =>
          `<a class="global-search-item" href="profile.html?pseudo=${encodeURIComponent(u.pseudo)}">&#128100; ${u.pseudo}</a>`
        ).join(""));
      }
      if (cards.length) {
        sections.push(`<div class="global-search-group">Cartes${cardMatches.length > cards.length ? ` (${cards.length} sur ${cardMatches.length})` : ""}</div>` + cards.map((c) => {
          const o = searchOwned.get(c.cardId);
          return `<a class="global-search-item gs-card" href="collection.html?cardId=${c.cardId}">${c.imageId ? `<img src="${API.imageUrl(c.imageId)}" alt="" loading="lazy" decoding="async" />` : "&#127183;"}<span>${c.name}</span><small style="color:${c.rarity?.colorHex || "inherit"}">${c.rarity?.name || ""}</small>${Session.isLoggedIn() ? `<small class="gs-own">${o ? "×" + o.count : "manquante"}</small>` : ""}</a>`;
        }).join(""));
      }
      if (pages.length) {
        sections.push(`<div class="global-search-group">Pages</div>` + pages.map((i) =>
          `<a class="global-search-item" href="${i.href}">${i.icon} ${i.label}</a>`
        ).join(""));
      }
      searchResults.innerHTML = sections.length ? sections.join("") : `<div class="global-search-hint">Aucun résultat.</div>`;
    }

    document.getElementById("global-search-trigger").addEventListener("click", async (e) => {
      e.stopPropagation();
      const opening = !searchEl.classList.contains("open");
      searchEl.classList.toggle("open", opening);
      if (opening) {
        searchInput.value = "";
        renderSearchResults("");
        searchInput.focus();
        await ensureSearchData();
        renderSearchResults(searchInput.value);
      }
    });
    searchInput.addEventListener("input", () => renderSearchResults(searchInput.value));
    document.getElementById("gs-filters").addEventListener("change", () => renderSearchResults(searchInput.value));
    document.getElementById("gs-filters").addEventListener("click", (e) => e.stopPropagation());
    searchInput.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", (e) => {
      if (!searchEl.contains(e.target)) searchEl.classList.remove("open");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") searchEl.classList.remove("open");
    });
    document.getElementById("mute-toggle-btn")?.addEventListener("click", (e) => {
      Sfx.setMuted(!Sfx.muted);
      e.currentTarget.innerHTML = Sfx.muted ? '<span class="mi">&#128264;</span> Son coupé' : '<span class="mi">&#128266;</span> Son actif';
      if (!Sfx.muted) Sfx.click();
    });
    document.getElementById("theme-cycle-btn")?.addEventListener("click", cycleTheme);
    document.getElementById("haptics-toggle-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = !Haptics.on;
      Haptics.set(on);
      e.currentTarget.querySelector("[data-haptics-label]").textContent = on ? "activées" : "désactivées";
      if (on) Haptics.buzz(30);
      Toast.info(on ? "📳 Vibrations activées." : "📳 Vibrations désactivées.");
    });
    document.getElementById("compact-toggle-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = document.documentElement.dataset.compact !== "1";
      setCompact(on);
      e.currentTarget.querySelector("[data-compact-label]").textContent = on ? "activé" : "désactivé";
      Toast.info(on ? "📱 Mode compact activé (sur mobile)." : "📱 Mode compact désactivé.");
    });
    // Notes de mise a jour pas encore lues : pastille.
    API.get("patchNotes").then((r) => {
      let seen = ""; try { seen = localStorage.getItem("2gatcha_notes_seen") || ""; } catch (err) { /* stockage indisponible */ }
      const link = document.getElementById("notes-link");
      if (link && r.latest && r.latest > seen && !link.querySelector("[data-notes-dot]")) link.insertAdjacentHTML("beforeend", ' <span class="notes-dot" data-notes-dot>nouveau</span>');
    }).catch(() => {});
    document.getElementById("kbd-help-btn")?.addEventListener("click", (e) => { e.stopPropagation(); Shortcuts.help(); });
    document.getElementById("text-size-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const v = TextSize.next();
      e.currentTarget.querySelector("[data-text-size-label]").textContent = TextSize.LABELS[v];
    });
    document.getElementById("cine-pref-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const v = CinePref.next();
      e.currentTarget.querySelector("[data-cine-label]").textContent = CinePref.LABELS[v].toLowerCase();
      Toast.info({ always: "🎬 Cinématiques toujours affichées.", first: "🎬 Chaque cinématique ne s'affichera qu'une fois (par rareté, mode, métier…).", never: "🎬 Cinématiques désactivées : un court message les remplace." }[v]);
    });
    document.getElementById("fx-level-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const v = FxLevel.next();
      e.currentTarget.querySelector("[data-fx-label]").textContent = FxLevel.LABELS[v];
      Toast.info({ auto: `✨ Effets automatiques (actuellement ${FxLevel.resolve(v) === "light" ? "allégés" : "complets"}).`, full: "✨ Effets visuels complets.", light: "✨ Effets visuels allégés : fond fixe, sans flou ni brillances en boucle." }[v]);
    });
    document.getElementById("discoveries-reset-btn")?.addEventListener("click", async () => {
      CinePref.forget("discovery");
      const okReset = await Confirm.show("Rejouer l'animation de découverte de chaque ressource que tu possèdes ? Les nouvelles ressources seront aussi annoncées à nouveau.", { title: "Revoir les découvertes", confirmText: "Revoir" });
      if (!okReset) return;
      try {
        const res = await API.post("discoveries", { userId: Session.userId, action: "reset" });
        if (!res.discoveries || !res.discoveries.length) Toast.info("Rien à revoir pour l'instant : tu n'as encore aucune ressource à découvrir.");
      } catch (e) { Toast.error(friendlyError(e)); }
    });
    document.getElementById("copy-profile-link-btn").addEventListener("click", async () => {
      const url = window.location.origin + window.location.pathname.replace(/[^/]*$/, "") +
        "profile.html?pseudo=" + encodeURIComponent(Session.pseudo || "");
      try {
        await navigator.clipboard.writeText(url);
        Toast.success("Lien de profil copié !");
      } catch (e) {
        Toast.error("Impossible de copier le lien.");
      }
    });
    document.getElementById("logout-btn").addEventListener("click", () => {
      Session.clear();
      window.location.href = "index.html";
    });
    document.getElementById("edit-pseudo-btn").addEventListener("click", async () => {
      userMenu.classList.remove("open");
      const next = await Prompt.show("Ton pseudo est affiché dans les classements, les échanges et sur ton profil.", { title: "Changer de pseudo", value: Session.pseudo || "", maxLength: 24, confirmText: "Enregistrer" });
      if (!next || !next.trim() || next.trim() === Session.pseudo) return;
      try {
        const res = await API.updatePseudo(Session.userId, next.trim());
        Session.setPseudo(res.pseudo);
        Toast.success("Pseudo mis à jour !");
      } catch (e) {
        Toast.error(typeof friendlyError === "function" ? friendlyError(e) : "Impossible de changer le pseudo.");
      }
    });
    // Pseudo a jour partout (en-tete, menu, lien de profil, accueil).
    document.addEventListener("session:pseudo", (e) => {
      const p = e.detail || "";
      ["header-pseudo", "menu-pseudo", "pseudo-display"].forEach((id) => { const n = document.getElementById(id); if (n) n.textContent = p; });
      const link = document.getElementById("view-profile-link");
      if (link) link.href = "profile.html?pseudo=" + encodeURIComponent(p);
    });
    Session.ensurePseudo();
    loadHeaderBoosterBadge();
    loadNavBadges();
  } else {
    el.innerHTML = `
      <div class="header-inner">
        <span class="brand" id="site-brand"><span class="brand-text">2Gatcha</span><span class="brand-fx" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></span>
        ${links}
      </div>
    `;
  }

}

// Banniere du site : configurable depuis admin.html (activee/desactivee,
// type info/maintenance, message) au lieu d'etre figee dans le code -
// ajoutee en enfant du header (pas un element separe) pour que sa hauteur
// soit automatiquement comptee dans --header-h une fois syncHeaderOffset()
// rappele. Silencieusement absente si l'appel echoue ou si elle est
// desactivee : jamais bloquant pour le reste de la page.
// Mode maintenance : redirige tout le trafic non-admin vers maintenance.html
// tant que Config.MaintenanceMode est actif (voir admin.html "Bandeau du
// site" -> bouton "Activer le mode maintenance"). Les admins ne sont JAMAIS
// rediriges (Session.isAdmin(), meme liste que partout ailleurs) pour
// pouvoir verifier le site pendant la mise a jour. Purement cote client :
// ce n'est pas une barriere de securite (les endpoints restent joignables),
// juste un confort pour ne pas laisser les joueurs sur une page a moitie
// fonctionnelle pendant une maintenance.
async function checkMaintenanceMode() {
  // Pages exemptees (data-no-maintenance, ex. admin-db.html : protegee par
  // son propre mot de passe, indispensable PENDANT une maintenance).
  if (location.pathname.endsWith("maintenance.html") || document.body.hasAttribute("data-no-maintenance")) return;
  try {
    const res = await API.getSiteBanner();
    if (res.maintenanceMode && !Session.isAdmin()) {
      location.replace("maintenance.html");
    }
  } catch (e) {
    // Un echec ne doit jamais bloquer l'acces normal au site.
  }
}

// Mode de jeu (Cool / Chill / Medium / Hard, api/src/native/presets.js) :
// couleurs de la barre de menu et animation du logo. Garde en local pour
// s'appliquer des le chargement de la page suivante, sans clignotement.
const GAME_MODE_TITLES = { cool: "Mode Cool 😎 : détente, boosters faciles", chill: "Mode Chill 🌴 : généreux", medium: "Mode Medium ⚖️ : équilibré", hard: "Mode Hard 🔥 : boosters rares, prix élevés", chaos: "Mode Chaos 👾 : une règle surprise chaque jour" };
// Premiere visite apres un changement de mode : cinematique plein ecran
// (ui.js ModeFx : couleurs, police et resume du nouveau mode), sinon l'ancienne
// annonce simple.
function announceGameMode(mode, from) {
  if (typeof ModeFx !== "undefined") { ModeFx.play(mode, { from }); return; }
  const ICON = { cool: "😎", chill: "🌴", medium: "⚖️", hard: "🔥", chaos: "👾" };
  const overlay = document.createElement("div");
  overlay.className = "mode-announce mode-" + mode.key;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="mode-announce-card">
      <div class="mode-announce-icon" aria-hidden="true">${ICON[mode.key] || "🎮"}</div>
      <p class="mode-announce-k">Le jeu passe en mode</p>
      <h2>${escHtml(mode.label)}</h2>
      ${mode.perks && mode.perks.length ? `<ul>${mode.perks.map((p) => `<li>${escHtml(p)}</li>`).join("")}</ul>` : ""}
      ${mode.card ? `<p class="mode-announce-card-line">&#127183; Carte exclusive du mode : <strong>${escHtml(mode.card.name)}</strong>, avec l'objectif commun.</p>` : ""}
      <button type="button" class="btn" data-close>C'est parti !</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.classList.add("closing"); setTimeout(() => overlay.remove(), 250); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest("[data-close]")) close(); });
  overlay.querySelector("[data-close]").focus();
}
function applyGameMode(mode) {
  const key = mode && GAME_MODE_TITLES[mode.key] ? mode.key : null;
  if (!key) return;
  let seen = null;
  try { seen = localStorage.getItem("2gatcha_game_mode_seen"); localStorage.setItem("2gatcha_game_mode_seen", key); } catch (e) { /* stockage indisponible */ }
  document.documentElement.dataset.gameMode = key;
  if (seen && seen !== key && typeof Session !== "undefined" && Session.isLoggedIn()) announceGameMode(mode, seen);
  try { localStorage.setItem("2gatcha_game_mode", key); } catch (e) { /* stockage indisponible */ }
  const brand = document.getElementById("site-brand");
  if (brand) brand.title = GAME_MODE_TITLES[key];
  applyModeFeatures(mode.off || [], mode);
  try { localStorage.setItem("2gatcha_features_off", JSON.stringify(mode.off || [])); } catch (e) { /* stockage indisponible */ }
}

function leaveHiddenTab(tab) {
  if (tab.getAttribute("role") !== "tab" || tab.offsetParent !== null || !tab.parentElement || getComputedStyle(tab).display !== "none") return;
  const next = [...tab.parentElement.querySelectorAll('[role="tab"]')].find((t) => t !== tab && t.offsetParent !== null);
  if (next) setTimeout(() => next.click(), 0);
}

// Fonctionnalites fermees dans le mode en cours (api/src/native/features.js) :
// onglets, widgets et liens masques ; page fermee remplacee par un message ;
// onglet actif masque -> premier onglet ouvert.
function applyModeFeatures(off, mode) {
  let style = document.getElementById("mode-features-style");
  if (!style) { style = document.createElement("style"); style.id = "mode-features-style"; document.head.appendChild(style); }
  const selectors = off.flatMap((f) => f.hide || []);
  style.textContent = selectors.length ? selectors.join(",\n") + " { display: none !important; }" : "";
  const run = () => {
    const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const closed = off.find((f) => f.page && f.page === page);
    const main = document.querySelector("main");
    if (closed && main && !main.querySelector(".feature-closed")) {
      const label = mode && mode.label ? mode.label : "ce mode";
      // Contenu masque (pas supprime : les scripts de la page continuent de tourner).
      [...main.children].forEach((el) => { el.hidden = true; });
      main.insertAdjacentHTML("afterbegin", `<section class="feature-closed"><span class="feature-closed-icon" aria-hidden="true">${closed.icon}</span>
        <h1>${escHtml(closed.label.replace(/\s*\(page\)$/, ""))}</h1>
        <p>Fermé tant que le mode <strong>${escHtml(label)}</strong> est en cours. Ça rouvrira avec un autre mode de jeu.</p>
        <a class="btn" href="index.html">Retour à l'accueil</a></section>`);
    }
    document.querySelectorAll('[role="tab"][aria-selected="true"]').forEach(leaveHiddenTab);
    // Onglet masque choisi plus tard (lien #ancre, script de la page) : on repart.
    if (!applyModeFeatures.observer) {
      applyModeFeatures.observer = new MutationObserver((list) => list.forEach((m) => { if (m.target.getAttribute("aria-selected") === "true") leaveHiddenTab(m.target); }));
      applyModeFeatures.observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(run, 0)); else run();
}
try { const m = localStorage.getItem("2gatcha_game_mode"); if (m && GAME_MODE_TITLES[m]) document.documentElement.dataset.gameMode = m; } catch (e) { /* stockage indisponible */ }
// Mode compact mobile (2026-10-18) : html[data-compact] (CSS sous 640 px), choix de l'appareil.
function setCompact(on) {
  if (on) document.documentElement.dataset.compact = "1"; else delete document.documentElement.dataset.compact;
  try { if (on) localStorage.setItem("2gatcha_compact", "1"); else localStorage.removeItem("2gatcha_compact"); } catch (e) { /* stockage indisponible */ }
  if (!on) document.getElementById("compact-bar")?.remove();
  document.dispatchEvent(new CustomEvent("compact:change"));
}
try { if (localStorage.getItem("2gatcha_compact") === "1") document.documentElement.dataset.compact = "1"; } catch (e) { /* stockage indisponible */ }
// Taille du texte (2026-10-18) : html[data-text-size] agrandit la taille de
// base (le CSS est en rem), choix de l'appareil.
const TextSize = {
  KEY: "2gatcha_text_size",
  ORDER: ["normal", "large", "xlarge"],
  LABELS: { normal: "normale", large: "grande", xlarge: "très grande" },
  get() { try { const v = localStorage.getItem(this.KEY); return this.ORDER.includes(v) ? v : "normal"; } catch (e) { return "normal"; } },
  apply(v) { if (v === "normal") delete document.documentElement.dataset.textSize; else document.documentElement.dataset.textSize = v; },
  set(v) {
    if (!this.ORDER.includes(v)) v = "normal";
    try { if (v === "normal") localStorage.removeItem(this.KEY); else localStorage.setItem(this.KEY, v); } catch (e) { /* stockage indisponible */ }
    this.apply(v);
    return v;
  },
  next() { return this.set(this.ORDER[(this.ORDER.indexOf(this.get()) + 1) % this.ORDER.length]); }
};
TextSize.apply(TextSize.get());
// Effets visuels (2026-10-21) : html[data-fx="light"] coupe fond anime, flous
// et brillances en boucle (refonte.css) et reduit les confettis (core.js).
// « auto » : alleges si l'appareil le demande (mouvement reduit, economie de
// donnees, peu de memoire/coeurs) ou si une mesure de la fluidite (une fois
// par semaine, apres le chargement) tombe sous ~35 images/s.
const FxLevel = {
  KEY: "2gatcha_fx",
  PROBE: "2gatcha_fx_probe",
  ORDER: ["auto", "full", "light"],
  LABELS: { auto: "automatiques", full: "complets", light: "allégés" },
  get() { try { const v = localStorage.getItem(this.KEY); return this.ORDER.includes(v) ? v : "auto"; } catch (e) { return "auto"; } },
  weakDevice() {
    const n = navigator;
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    if (n.connection && n.connection.saveData) return true;
    return (n.deviceMemory && n.deviceMemory <= 2) || (n.hardwareConcurrency && n.hardwareConcurrency <= 2);
  },
  probed() { try { const p = JSON.parse(localStorage.getItem(this.PROBE) || "null"); return p && Date.now() - p.at < 7 * 86400000 ? p.v : null; } catch (e) { return null; } },
  resolve(v) { return v !== "auto" ? v : this.weakDevice() || this.probed() === "light" ? "light" : "full"; },
  apply(v) { if (this.resolve(v) === "light") document.documentElement.dataset.fx = "light"; else delete document.documentElement.dataset.fx; },
  set(v) {
    if (!this.ORDER.includes(v)) v = "auto";
    try { if (v === "auto") localStorage.removeItem(this.KEY); else localStorage.setItem(this.KEY, v); } catch (e) { /* stockage indisponible */ }
    this.apply(v);
    return v;
  },
  next() { return this.set(this.ORDER[(this.ORDER.indexOf(this.get()) + 1) % this.ORDER.length]); },
  // 90 images mesurees quand la page est au repos ; onglet cache = mesure
  // abandonnee. Seulement en « auto » : un choix du joueur n'est jamais modifie.
  probe() {
    if (this.get() !== "auto" || this.weakDevice() || this.probed()) return;
    const times = [];
    // Le choix du joueur prime : s'il en fait un pendant la mesure, elle s'arrete.
    const step = (t) => {
      if (document.hidden || this.get() !== "auto") return;
      times.push(t);
      if (times.length < 91) { requestAnimationFrame(step); return; }
      const avg = (times[90] - times[0]) / 90;
      const v = avg > 28 ? "light" : "full";
      try { localStorage.setItem(this.PROBE, JSON.stringify({ v, at: Date.now() })); } catch (e) { /* stockage indisponible */ }
      if (v === "light") { this.apply("auto"); Toast.info("✨ Effets visuels allégés pour plus de fluidité (Préférences du menu du compte pour changer)."); }
    };
    const start = () => setTimeout(() => { if (!document.hidden && this.get() === "auto") requestAnimationFrame(step); }, 2500);
    if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });
  }
};
FxLevel.apply(FxLevel.get());
FxLevel.probe();

// Evenement surprise (2026-10-18, api/src/native/surprise.js) : bandeau tant
// qu'il dure, et une courte cinematique la premiere fois qu'on le voit.
function applySurprise(el, s) {
  if (!s) return;
  const end = new Date(s.until * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  el.insertAdjacentHTML("afterbegin", `<div class="beta-banner banner-surprise">${s.icon} <strong>Événement surprise : ${escHtml(s.label)}</strong> · ${escHtml(s.desc)} Jusqu'à ${end}.</div>`);
  if (typeof syncHeaderOffset === "function") syncHeaderOffset();
  const occ = s.key + ":" + s.start;
  let seen = ""; try { seen = localStorage.getItem("2gatcha_surprise_seen") || ""; } catch (e) { /* stockage indisponible */ }
  if (seen === occ) return;
  try { localStorage.setItem("2gatcha_surprise_seen", occ); } catch (e) { /* stockage indisponible */ }
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || (typeof CinePref !== "undefined" && !CinePref.allow("surprise", occ)) || !document.body) { if (typeof Toast !== "undefined") Toast.info(`${s.icon} Événement surprise : ${escHtml(s.label)} jusqu'à ${end} !`); return; }
  const ov = document.createElement("div");
  ov.className = "season-cine surprise-cine";
  ov.setAttribute("role", "status");
  const cs = getComputedStyle(document.documentElement);
  ov.style.setProperty("--sc-bg", cs.getPropertyValue("--bg-void").trim() || "#07070f");
  ov.style.setProperty("--sc-a", cs.getPropertyValue("--accent").trim() || "#7c3aed");
  ov.innerHTML = `<div class="sc-burst" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => `<span style="--i:${i};--x:${Math.round(Math.cos((i / 14) * 6.283) * 36)}vmin;--y:${Math.round(Math.sin((i / 14) * 6.283) * 30)}vmin">${i % 2 ? s.icon : "✨"}</span>`).join("")}</div>
    <div class="sc-center"><div class="sc-icon" aria-hidden="true">${s.icon}</div><h2 class="sc-title">Événement surprise !</h2><p class="sc-sub"><strong>${escHtml(s.label)}</strong> : ${escHtml(s.desc)} Jusqu'à ${end}.</p></div>`;
  const run = () => {
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("sc-in"));
    let done = false;
    const close = () => { if (done) return; done = true; ov.classList.add("sc-out"); setTimeout(() => ov.remove(), 750); };
    const t = setTimeout(close, 2600);
    ov.addEventListener("click", () => { clearTimeout(t); close(); });
  };
  if (document.body) run(); else document.addEventListener("DOMContentLoaded", run);
}
try { const off = JSON.parse(localStorage.getItem("2gatcha_features_off") || "[]"); if (Array.isArray(off) && off.length) applyModeFeatures(off, null); } catch (e) { /* stockage indisponible */ }

// Evenement saisonnier (api/src/native/seasonal.js) : theme du site.
// Skin saisonnier (2026-10-18) : habillage complet pendant l'evenement, sauf
// si l'admin l'a coupe (season.skin) ou si le joueur l'a desactive. Apercu :
// ?skin=halloween (?skin=off pour arreter), garde le temps de la session.
const SEASON_SKINS = ["halloween", "christmas", "newyear", "valentine", "easter", "aprilfools", "summer"];
function seasonSkinPreview() {
  try {
    const q = new URLSearchParams(location.search).get("skin");
    if (q === "off") sessionStorage.removeItem("2gatcha_skin_preview");
    else if (q && SEASON_SKINS.includes(q)) sessionStorage.setItem("2gatcha_skin_preview", q);
    return sessionStorage.getItem("2gatcha_skin_preview");
  } catch (e) { return null; }
}
const seasonSkinOff = () => { try { return localStorage.getItem("2gatcha_season_skin") === "off"; } catch (e) { return false; } };
// Cinematique d'entree en saison (2026-10-18) : la premiere fois qu'un skin
// saisonnier arrive (une fois par evenement, ou a chaque nouvel apercu), le
// site se voile aux couleurs actuelles, l'icone et le titre de la saison
// apparaissent avec une gerbe de son decor, le skin se pose dessous, puis le
// voile s'ouvre en cercle. Clic pour passer ; reduit-mouvement ou preference
// « cinematiques : jamais » -> skin pose directement, petit message.
const SEASON_CINE = {
  halloween: { icon: "🎃", label: "Halloween", deco: ["🦇", "🎃", "👻", "🕸️"] },
  christmas: { icon: "🎄", label: "Noël", deco: ["❄️", "🎁", "⭐", "🎄"] },
  newyear: { icon: "🎆", label: "Nouvel an", deco: ["🎆", "✨", "🥂", "🎇"] },
  valentine: { icon: "💘", label: "Saint-Valentin", deco: ["💕", "💘", "🌹", "💌"] },
  easter: { icon: "🐣", label: "Pâques", deco: ["🥚", "🐰", "🌷", "🐣"] },
  aprilfools: { icon: "🐟", label: "Poisson d’avril", deco: ["🐟", "🐠", "🤡", "🎭"] },
  summer: { icon: "🎶", label: "Fête de la musique", deco: ["🎶", "🎸", "🎵", "☀️"] }
};
function playSeasonCine(key, season, apply) {
  const c = SEASON_CINE[key];
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const allowed = typeof CinePref === "undefined" || CinePref.allow("season", key);
  if (!c || reduced || !allowed || !document.body) {
    apply();
    if (c && typeof Toast !== "undefined") setTimeout(() => Toast.info(`${c.icon} ${c.label} commence : le site change de décor !`), 400);
    return;
  }
  const cs = getComputedStyle(document.documentElement);
  const old = { bg: cs.getPropertyValue("--bg-void").trim() || "#07070f", a: cs.getPropertyValue("--accent").trim() || "#7c3aed" };
  const until = season && season.endsAt ? new Date((season.endsAt - 60) * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "";
  const ov = document.createElement("div");
  ov.className = "season-cine";
  ov.setAttribute("role", "status");
  ov.style.setProperty("--sc-bg", old.bg);
  ov.style.setProperty("--sc-a", old.a);
  ov.innerHTML = `<div class="sc-burst" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<span style="--i:${i};--x:${Math.round(Math.cos((i / 18) * 6.283) * (34 + (i % 3) * 9))}vmin;--y:${Math.round(Math.sin((i / 18) * 6.283) * (30 + (i % 4) * 7))}vmin">${c.deco[i % c.deco.length]}</span>`).join("")}</div>
    <div class="sc-center"><div class="sc-icon" aria-hidden="true">${c.icon}</div><h2 class="sc-title">${escHtml(c.label)} commence !</h2><p class="sc-sub">${until ? `Le site se pare de ses couleurs jusqu'au ${escHtml(until)}.` : "Le site se pare de ses couleurs."}</p></div>`;
  document.body.appendChild(ov);
  let applied = false, done = false;
  const doApply = () => { if (applied) return; applied = true; apply(); const n = getComputedStyle(document.documentElement); ov.style.setProperty("--sc-bg2", n.getPropertyValue("--bg-void").trim()); ov.style.setProperty("--sc-a2", n.getPropertyValue("--accent").trim()); ov.classList.add("sc-new"); };
  const end = () => { if (done) return; done = true; doApply(); ov.classList.add("sc-out"); setTimeout(() => ov.remove(), 750); };
  requestAnimationFrame(() => ov.classList.add("sc-in"));
  const t1 = setTimeout(doApply, 1000);
  const t2 = setTimeout(end, 2300);
  ov.addEventListener("click", () => { clearTimeout(t1); clearTimeout(t2); end(); });
}
function applySeasonSkin(season) {
  const preview = seasonSkinPreview();
  const key = preview || (season && season.key && season.skin !== false && !seasonSkinOff() ? season.key : "");
  // Nouveau skin jamais vu pour cet evenement (ou nouvel apercu) : cinematique.
  const occ = key ? key + ":" + (preview ? "apercu" : (season && season.endsAt) || "") : "";
  let seenOcc = "";
  try { seenOcc = (preview ? sessionStorage : localStorage).getItem("2gatcha_season_cine") || ""; } catch (e) { /* stockage indisponible */ }
  if (key && SEASON_SKINS.includes(key) && occ !== seenOcc) {
    try { (preview ? sessionStorage : localStorage).setItem("2gatcha_season_cine", occ); } catch (e) { /* stockage indisponible */ }
    const run = () => playSeasonCine(key, season, () => { document.documentElement.dataset.seasonSkin = key; });
    if (document.body) run(); else document.addEventListener("DOMContentLoaded", run);
    try { if (!preview) localStorage.setItem("2gatcha_season_skin_key", key); } catch (e) { /* stockage indisponible */ }
    return;
  }
  if (key && SEASON_SKINS.includes(key)) document.documentElement.dataset.seasonSkin = key; else delete document.documentElement.dataset.seasonSkin;
  try { if (key && !preview) localStorage.setItem("2gatcha_season_skin_key", key); else if (!preview) localStorage.removeItem("2gatcha_season_skin_key"); } catch (e) { /* stockage indisponible */ }
}
window.toggleSeasonSkin = (on) => {
  try { if (on) localStorage.removeItem("2gatcha_season_skin"); else localStorage.setItem("2gatcha_season_skin", "off"); } catch (e) { /* stockage indisponible */ }
  applySeasonSkin(window.currentSeason);
};
function applySeason(season) {
  const key = season && season.key ? season.key : "";
  if (key) document.documentElement.dataset.season = key; else delete document.documentElement.dataset.season;
  try { if (key) localStorage.setItem("2gatcha_season", key); else localStorage.removeItem("2gatcha_season"); } catch (e) { /* stockage indisponible */ }
  applySeasonSkin(season);
  window.currentSeason = season || null;
  document.dispatchEvent(new CustomEvent("season:ready", { detail: season || null }));
}
try { const s = localStorage.getItem("2gatcha_season"); if (s) document.documentElement.dataset.season = s; } catch (e) { /* stockage indisponible */ }
// Avant la reponse du serveur : le dernier skin connu (ou l'apercu), sans clignotement.
// (Un apercu tout neuf attend sa cinematique : pas de pose anticipee.)
try {
  const pv = seasonSkinPreview();
  const k = pv ? (sessionStorage.getItem("2gatcha_season_cine") === pv + ":apercu" ? pv : "") : (!seasonSkinOff() && localStorage.getItem("2gatcha_season_skin_key"));
  if (k) document.documentElement.dataset.seasonSkin = k;
} catch (e) { /* stockage indisponible */ }

// Regle du jour (mode Chaos) et preavis de changement de mode (modeextras.js).
function modeBanners(el, mode) {
  const bits = [];
  if (mode.chaosRule) bits.push(`<div class="beta-banner banner-chaos">${mode.chaosRule.icon} <strong>Règle du Chaos du jour :</strong> ${escHtml(mode.chaosRule.label)}</div>`);
  // Regles par difficulte (moderules.js) : happy hour, tempete.
  const r = mode.rules || {};
  if (r.happyHour && r.happyHour.active) bits.push(`<a class="beta-banner banner-happy banner-link" href="boutique.html">🍹 <strong>Happy hour</strong> : boutique à -${Math.round(r.happyHour.discount * 100)} % jusqu'à ${r.happyHour.to} h !</a>`);
  if (r.storm && (r.storm.active || r.storm.soon)) bits.push(`<a class="beta-banner banner-storm banner-link" href="mode.html">⛈️ ${r.storm.active ? `<strong>Tempête</strong> : ${escHtml(r.storm.label)} est fermée jusqu'à ${r.storm.to} h.` : `Une tempête approche : ${escHtml(r.storm.label)} fermera de ${r.storm.from} h à ${r.storm.to} h.`}</a>`);
  if (r.on && r.on.includes("chaos.bugs") && typeof Session !== "undefined" && Session.isLoggedIn()) setTimeout(spawnModeBugs, 1500);
  const n = mode.next;
  if (n && n.key !== mode.key) {
    const when = new Date(n.at * 1000).toLocaleString("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" });
    const lead = n.probable ? `La salle des machines penche pour le mode <strong>${n.icon} ${escHtml(n.label)}</strong> (fin du vote ${when})` : `Changement de mode programmé : <strong>${n.icon} ${escHtml(n.label)}</strong> ${when}`;
    bits.push(`<a class="beta-banner banner-next-mode banner-link" href="communaute.html#calendrier">⏳ Dernières heures du mode ${escHtml(mode.label)} : profites-en ! ${lead}.</a>`);
  }
  if (bits.length) { el.insertAdjacentHTML("afterbegin", bits.join("")); syncHeaderOffset(); }
}

// Chasse aux bugs (mode Chaos, modefun.js) : les bugs du jour de cette page.
let modeBugsDone = false;
async function spawnModeBugs() {
  if (modeBugsDone) return;
  modeBugsDone = true;
  let st;
  try { st = await API.modeExtra(Session.userId, "status"); } catch (e) { return; }
  const page = (location.pathname.split("/").pop() || "index.html");
  const list = ((st && st.bugs && st.bugs.list) || []).filter((b) => b.page === page);
  const LOOK = { flee: "🐛", flip: "ʇnᗺ", pixel: "", shake: "🐞" };
  list.forEach((b) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "mode-bug mode-bug-" + b.kind;
    el.style.left = b.x + "vw";
    el.style.top = b.y + "vh";
    el.setAttribute("aria-label", "Un bug ! Clique pour le signaler");
    el.textContent = LOOK[b.kind] || "🐛";
    let flees = b.kind === "flee" ? 3 : 0;
    el.addEventListener("pointerenter", (e) => {
      if (!flees || e.pointerType === "touch") return;
      flees--;
      el.style.left = (5 + Math.random() * 85) + "vw";
      el.style.top = (15 + Math.random() * 70) + "vh";
    });
    el.addEventListener("click", async () => {
      el.disabled = true;
      try {
        const r = await API.modeExtra(Session.userId, "bug-found", { id: b.id });
        el.classList.add("is-squashed");
        setTimeout(() => el.remove(), 500);
        Toast.success(`🐛 Bug signalé ! +${r.dust} ✨ (${r.bugs.found} / ${r.bugs.total} aujourd'hui)`);
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } catch (e) { el.remove(); }
    });
    document.body.appendChild(el);
  });
}

// Cosmetiques a style (Admin > Contenu > Cosmetiques, 2026-10-25) : une regle
// .decor-<key> fabriquee a partir de { c1, c2, glow, anim }, utilisee comme
// les classes ecrites a la main (cadres d'avatar, couleurs de pseudo).
function cosmeticCss(key, st) {
  if (!/^[a-z0-9-]+$/.test(key) || !/^#[0-9a-f]{6}$/i.test(st.c1 || "")) return "";
  const c2 = /^#[0-9a-f]{6}$/i.test(st.c2 || "") ? st.c2 : null;
  const glow = Math.max(0, Math.min(40, Number(st.glow) || 0));
  const anim = { pulse: "decorPulse 2.4s ease-in-out infinite", spin: "decorHue 6s linear infinite", shine: "decorShine 3s linear infinite" }[st.anim] || "";
  if (st.type === "frame") return `.decor-${key}{box-shadow:0 0 0 3px ${st.c1}${c2 ? `,0 0 0 5px ${c2}` : ""}${glow ? `,0 0 ${glow}px ${st.c1}` : ""}${anim ? `;animation:${anim}` : ""}}`;
  if (c2) return `.decor-${key}{background:linear-gradient(90deg,${st.c1},${c2},${st.c1});background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent!important${glow ? `;filter:drop-shadow(0 0 ${Math.round(glow / 2)}px ${st.c1})` : ""}${anim ? `;animation:${anim}` : ""}}`;
  return `.decor-${key}{color:${st.c1}!important${glow ? `;text-shadow:0 0 ${glow}px ${st.c1}` : ""}${anim ? `;animation:${anim}` : ""}}`;
}
function applyCosmeticStyles(map) {
  let el = document.getElementById("cosmetic-styles");
  if (!el) { el = document.createElement("style"); el.id = "cosmetic-styles"; document.head.appendChild(el); }
  el.textContent = Object.entries(map || {}).map(([k, st]) => cosmeticCss(k, st)).join("\n");
}
window.cosmeticCss = cosmeticCss;
window.applyCosmeticStyles = applyCosmeticStyles;

// Week-end evenement (api/src/native/events.js) : bandeau festif tant qu'il dure.
async function loadEventBanner() {
  const el = document.getElementById("site-header");
  if (!el) return;
  try {
    const ev = await API.getEventStatus();
    if (ev && ev.cosmeticStyles) applyCosmeticStyles(ev.cosmeticStyles);
    if (ev && ev.gameMode) applyGameMode(ev.gameMode);
    if (ev) applySeason(ev.season);
    if (ev) applySurprise(el, ev.surprise);
    if (ev && ev.gameMode) modeBanners(el, ev.gameMode);
    if (!ev || !ev.active) return;
    const perks = [];
    if (ev.dustMultiplier > 1) perks.push(`poussières x${ev.dustMultiplier}`);
    if (ev.finishMultiplier > 1) perks.push(`finitions x${ev.finishMultiplier}`);
    if (ev.fishingRare > 1) perks.push(`prises rares x${ev.fishingRare}`);
    if (ev.wormsMultiplier > 1) perks.push(`vers x${ev.wormsMultiplier}`);
    const until = ev.endsAt ? " · jusqu'au " + new Date(ev.endsAt * 1000).toLocaleString("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" }) : "";
    const label = String(ev.label || "Événement").replace(/[<>&"]/g, "");
    el.insertAdjacentHTML("afterbegin", `<a class="beta-banner banner-event banner-link" href="communaute.html#calendrier" title="Voir le calendrier des événements">&#127881; <strong>${label}</strong>${perks.length ? " : " + perks.join(", ") : ""}${until}</a>`);
    syncHeaderOffset();
  } catch (e) { /* purement cosmetique */ }
}

// ---------------------------------------------------------------------------
// Notifications push sur cet appareil (sw.js + api/src/native/push.js) :
// interrupteur dans le menu des notifications de l'en-tete.
// ---------------------------------------------------------------------------
const PushNotifs = {
  supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
  },
  async registration() {
    return navigator.serviceWorker.register("sw.js");
  },
  async subscription() {
    if (!this.supported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  },
  keyBytes(base64) {
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  },
  async enable() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications bloquées dans les réglages du navigateur." : "Autorisation non accordée.");
    const config = await API.getPushConfig();
    if (!config.enabled || !config.publicKey) throw new Error("Notifications indisponibles sur le serveur.");
    const reg = await this.registration();
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: this.keyBytes(config.publicKey) });
    await API.pushAction(Session.userId, "subscribe", sub.toJSON());
    await API.pushAction(Session.userId, "test", sub.toJSON());
  },
  async disable() {
    const sub = await this.subscription();
    if (!sub) return;
    await API.pushAction(Session.userId, "unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  },
  // Ligne affichee en bas du menu des notifications.
  async renderRow(container) {
    if (!container || !Session.isLoggedIn()) return;
    if (!this.supported()) {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      container.innerHTML = `<div class="push-row push-row-muted">&#128242; ${ios ? "Sur iPhone, ajoute d'abord le site à l'écran d'accueil pour recevoir des notifications." : "Ce navigateur ne gère pas les notifications."}</div>`;
      return;
    }
    const sub = await this.subscription().catch(() => null);
    container.innerHTML = `
      <div class="push-row">
        <span>&#128242; Notifications sur cet appareil<small>Expédition rentrée, quiz du jour, échange reçu, boss, événements…</small></span>
        <button type="button" class="${sub ? "btn-ghost" : "btn-secondary"} push-toggle-btn">${sub ? "Désactiver" : "Activer"}</button>
      </div>
      ${sub ? '<details class="push-prefs" id="push-prefs"><summary>&#9881;&#65039; Choisir les notifications</summary><div class="push-prefs-list">Chargement…</div></details>' : ""}`;
    const prefs = container.querySelector("#push-prefs");
    if (prefs) {
      prefs.addEventListener("click", (e) => e.stopPropagation());
      prefs.addEventListener("toggle", async () => {
        if (!prefs.open || prefs.dataset.loaded) return;
        try {
          const st = await API.pushAction(Session.userId, "status", { endpoint: sub.endpoint });
          prefs.dataset.loaded = "1";
          prefs.querySelector(".push-prefs-list").innerHTML = (st.kinds || []).map((k) => `<label class="push-pref"><input type="checkbox" data-kind="${k.key}" ${k.on ? "checked" : ""} /> ${k.label}</label>`).join("");
        } catch (e) { prefs.querySelector(".push-prefs-list").textContent = "Indisponible."; }
      });
      prefs.addEventListener("change", async () => {
        const values = {};
        prefs.querySelectorAll("[data-kind]").forEach((i) => { values[i.dataset.kind] = i.checked; });
        try { await API.setPushPrefs(Session.userId, values); Toast.info("Préférences de notifications enregistrées."); } catch (e) { Toast.error(friendlyError(e)); }
      });
    }
    container.querySelector(".push-toggle-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (sub) { await this.disable(); Toast.info("Notifications désactivées sur cet appareil."); }
        else { await this.enable(); Toast.success("Notifications activées : une notification de test arrive dans la minute."); }
      } catch (err) {
        Toast.error(err.message || "Impossible d'activer les notifications.");
      }
      this.renderRow(container);
    });
  }
};

async function loadSiteBanner() {
  const el = document.getElementById("site-header");
  if (!el) return;
  try {
    const res = await API.getSiteBanner();
    if (!res.enabled || !res.message) return;
    const isMaintenance = res.type === "maintenance";
    const icon = isMaintenance ? "&#128679;" : "&#8505;&#65039;";
    el.insertAdjacentHTML("afterbegin", `
      <div class="beta-banner ${isMaintenance ? "banner-maintenance" : "banner-info"}">
        ${icon} ${res.message}
      </div>
    `);
    syncHeaderOffset();
  } catch (e) {
    // Purement cosmetique : un echec ne doit jamais empecher la navigation.
  }
}

// Detecte un passage de niveau depuis la derniere fois qu'on a affiche le
// badge (compare a la valeur vue precedemment, gardee par joueur car
// Session.userId peut changer sur le meme navigateur). Purement cosmetique :
// une detection ratee (cache efface, premiere visite) ne fait que sauter la
// petite fete, jamais une erreur visible.
const LEVEL_SEEN_KEY = "2gatcha_level_seen_" + Session.userId;
// Bandeau plein ecran (embellissement 2026-09-30) : cree dynamiquement (pas
// un <div> fige dans chaque page, contrairement a #legendary-flash qui
// n'existe que sur redeem.html/ouverture.html) puisque loadHeaderBoosterBadge
// tourne site-wide et peut declencher un passage de niveau depuis N'IMPORTE
// QUELLE page.
// Deblocages et bonus d'un passage de niveau (de prev+1 a newLevel).
function accountLevelPerks(prevLevel, newLevel) {
  const gained = Math.max(1, newLevel - (prevLevel || newLevel - 1));
  const perks = [`🎁 +${gained} jeton${gained > 1 ? "s" : ""} booster bonus`, `🌳 +${gained} point${gained > 1 ? "s" : ""} de talent`];
  for (let l = (prevLevel || newLevel - 1) + 1; l <= newLevel; l++) {
    Object.entries(typeof FEATURE_UNLOCK_LEVEL !== "undefined" ? FEATURE_UNLOCK_LEVEL : {}).forEach(([k, lvl]) => { if (lvl === l && FEATURE_LABELS[k]) perks.push(`🔓 ${FEATURE_LABELS[k]}`); });
    Object.entries(typeof SLEEVE_UNLOCK_LEVEL !== "undefined" ? SLEEVE_UNLOCK_LEVEL : {}).forEach(([k, lvl]) => { if (lvl === l && k !== "default") perks.push(`🎴 Pochette ${k.charAt(0).toUpperCase() + k.slice(1)}`); });
    // Jeux et pages debloques (nouveaux comptes) : cinematique a part (starter.js checkUnlocks).
  }
  return perks;
}
// Cinematique de montee de niveau (ui.js LevelFx) ; ancien bandeau en secours.
function showLevelUpBanner(newLevel, prevLevel = null) {
  if (typeof StarterLocks !== "undefined") StarterLocks.refresh().then(() => { if (window.StarterPath) StarterPath.load(); });
  if (typeof LevelFx !== "undefined") { LevelFx.show({ kind: "account", level: newLevel, from: prevLevel, perks: accountLevelPerks(prevLevel, newLevel) }); return; }
  let el = document.getElementById("level-up-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "level-up-banner";
    el.className = "level-up-banner";
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="level-up-banner-label">Niveau supérieur</span><span class="level-up-banner-number">${newLevel}</span>`;
  el.classList.remove("active");
  void el.offsetWidth;
  el.classList.add("active");
  setTimeout(() => el.classList.remove("active"), 2600);
}

function celebrateLevelUpIfNeeded(newLevel) {
  if (!newLevel) return;
  let prevLevel = null;
  try { prevLevel = Number(localStorage.getItem(LEVEL_SEEN_KEY)) || null; } catch (e) {}
  if (prevLevel && newLevel > prevLevel) showLevelUpBanner(newLevel, prevLevel);
  try { localStorage.setItem(LEVEL_SEEN_KEY, String(newLevel)); } catch (e) {}
}

// Bilan de session (2026-10-29) : soldes du premier statut de la session
// (une session s'arrete apres 30 min sans visite), compares au statut
// courant dans l'inventaire (« cette session : +3 200 ✨, 12 cartes… »).
const SessionRecap = {
  KEY: "2gatcha_session_" + (Session.userId || ""),
  IDLE: 30 * 60 * 1000,
  snap: (s) => ({ count: Number(s.count) || 0, stardust: Number(s.stardust) || 0, keys: Number(s.keys) || 0, worms: Number(s.worms) || 0, xp: s.xp ? Number(s.xp.total) || 0 : 0, level: s.xp ? Number(s.xp.level) || 0 : 0, pulls: Number(s.totalPulls) || 0 }),
  read() { try { return JSON.parse(localStorage.getItem(this.KEY) || "null"); } catch (e) { return null; } },
  note(status) {
    if (!status) return;
    const t = Date.now();
    let s = this.read();
    if (!s || t - (s.last || 0) > this.IDLE) s = { at: t, base: this.snap(status) };
    s.last = t;
    try { localStorage.setItem(this.KEY, JSON.stringify(s)); } catch (e) { /* stockage indisponible */ }
  },
  reset() { try { localStorage.removeItem(this.KEY); } catch (e) { /* stockage indisponible */ } if (window.__hdrStatus) this.note(window.__hdrStatus); },
  // Ecarts depuis le debut de la session (null si rien a dire).
  delta(status) {
    const s = this.read();
    if (!s || !status) return null;
    const now = this.snap(status), b = s.base;
    const d = Object.fromEntries(Object.keys(now).map((k) => [k, now[k] - (b[k] || 0)]));
    return { since: s.at, d, any: Object.values(d).some((v) => v !== 0) };
  }
};
window.SessionRecap = SessionRecap;

// Reponses de statut deja annoncees (voir loadHeaderBoosterBadge).
const announcedStatus = new WeakSet();
const PRESTIGE_SEEN_KEY = "2gatcha_prestige_seen";
async function loadHeaderBoosterBadge() {
  const badge = document.getElementById("header-booster-badge");
  const dustBadge = document.getElementById("header-stardust-badge");
  const levelBadge = document.getElementById("header-level-badge");
  if (!badge) return;
  try {
    const status = await API.getBoosterStatus(Session.userId);
    window.__hdrStatus = status;
    SessionRecap.note(status);
    // Annonces portees par le statut (une seule fois par reponse du serveur,
    // 2026-10-21) : la meme reponse est partagee quelques secondes entre tous
    // les appels de la page (API._shared), et chaque appel la rejouait
    // (prestige du compte affiche plusieurs fois, pluie de boosters...).
    const fresh = !announcedStatus.has(status);
    announcedStatus.add(status);
    // Bonus et malus du mode (modeperks.js).
    if (fresh && typeof Toast !== "undefined") {
      if (status.hug) Toast.success(`&#128526; Câlin du jour (mode Cool) : ${status.hug} !`);
      if (status.wear) Toast.info(`&#129533; Usure (mode Hard) : un doublon de <strong>${escHtml(status.wear.card)}</strong> s'est usé.`);
      if (status.modeUnlock) Toast.success(`&#127942; Débloqué : ${escHtml(status.modeUnlock)} !`);
      // Nouvelle etoile de prestige du compte (account-prestige.js).
      const pu = status.prestigeUnlocked;
      // Etoile deja annoncee (autre onglet, autre page) : pas de seconde cinematique.
      let seenStar = 0;
      try { seenStar = Number(localStorage.getItem(PRESTIGE_SEEN_KEY)) || 0; } catch (e) { /* stockage indisponible */ }
      const starN = pu ? Number(pu.star || pu.stars) || 0 : 0;
      if (pu && starN > seenStar) { try { localStorage.setItem(PRESTIGE_SEEN_KEY, String(starN)); } catch (e) { /* stockage indisponible */ } }
      if (pu && starN > seenStar && typeof LevelFx !== "undefined") {
        LevelFx.show({ kind: "prestige", icon: "&#11088;", name: "Prestige du compte", level: `${"★".repeat(Math.min(pu.star || pu.stars, 5))} Étoile ${pu.star || pu.stars}`,
          perks: [pu.boosters ? `🎁 +${pu.boosters} jetons booster` : "", pu.dust ? `✨ +${pu.dust.toLocaleString("fr-FR")} poussières` : "", `🌳 +${pu.gained || 1} point${(pu.gained || 1) > 1 ? "s" : ""} de talent de prestige`, ...(pu.titles || []).map((t) => `🏷️ ${escHtml(t)}`)].filter(Boolean) });
        if (pu.boosters) { API.invalidate && API.invalidate(["boosterStatus"]); setTimeout(loadHeaderBoosterBadge, 500); }
      }
      // Malediction, mutation, larcin subi, serment tenu… (modefun.js).
      (status.modeNotes || []).forEach((n) => Toast.info(`${n.icon} ${escHtml(n.text)}`));
    }
    // Pluie de boosters (objectif commun atteint) : annonce une seule fois.
    if (fresh && status.rain && typeof Toast !== "undefined") {
      Toast.success(`&#127783;&#65039; Pluie de boosters ! +${status.rain.boosters} jeton${status.rain.boosters > 1 ? "s" : ""} booster grâce à l'objectif commun.`);
      if (typeof confetti === "function") confetti({ particleCount: 120, spread: 100, origin: { y: 0.3 } });
      API.invalidate && API.invalidate(["boosterStatus"]);
    }
    if (typeof Inventory !== "undefined" && Inventory.isOpen()) Inventory.render();
    let countEl = badge.querySelector(".count");
    if (!countEl) {
      badge.innerHTML = `<span class="icon">&#127183;</span><span class="count">...</span>`;
      countEl = badge.querySelector(".count");
    }
    setCount(countEl, status.count);

    if (dustBadge) {
      let dustEl = dustBadge.querySelector(".count");
      if (!dustEl) {
        dustBadge.innerHTML = `<span class="icon">&#10024;</span><span class="count">...</span>`;
        dustEl = dustBadge.querySelector(".count");
      }
      setCount(dustEl, status.stardust || 0);
    }

    // Clefs secretes : uniquement visibles quand on en possede au moins une
    // (voir dig.json/unlock-secret.json) - masquees entierement a 0 plutot
    // que d'afficher un compteur vide en permanence.
    const keyBadge = document.getElementById("header-key-badge");
    const keyDivider = document.getElementById("header-key-divider");
    if (keyBadge) {
      const keys = status.keys || 0;
      if (keys > 0) {
        keyBadge.style.display = "flex";
        if (keyDivider) keyDivider.style.display = "block";
        // Progression vers le coffre-fort visible partout (QoL 2026-09-30) :
        // auparavant seule la page Jeux montrait "X/6", ailleurs on ne
        // voyait qu'un chiffre sans contexte. Cache (comme loadNavBadges) -
        // simple confort d'affichage, pas critique a la seconde pres. La
        // valeur finale (nombre brut ou "X/6") est decidee AVANT d'appeler
        // bumpNumber une seule fois - lui passer un format texte puis le
        // corriger juste apres ferait sauter l'anim au milieu (son propre
        // requestAnimationFrame ecraserait la correction sur l'image suivante).
        const vault = await API.getVaultStatus(Session.userId).catch(() => null);
        const keyEl = keyBadge.querySelector(".count");
        if (vault && !vault.alreadyOpened && vault.keysRequired) {
          keyBadge.title = `${keys} / ${vault.keysRequired} clés vers le coffre-fort`;
          keyEl.textContent = `${keys}/${vault.keysRequired}`;
        } else {
          keyBadge.title = "Clés";
          bumpNumber(keyEl, keys);
        }
      } else {
        keyBadge.style.display = "none";
        if (keyDivider) keyDivider.style.display = "none";
      }
    }

    // Vers de terre (fouille -> peche) : visibles seulement si > 0.
    const wormBadge = document.getElementById("header-worm-badge");
    if (wormBadge) {
      const worms = status.worms || 0;
      wormBadge.style.display = worms > 0 ? "flex" : "none";
      if (worms > 0) setCount(wormBadge.querySelector(".count"), worms);
    }
    // Decorations equipees (boutique) : couleur du pseudo, cadre de l'avatar, titre.
    if (status.decor) {
      const p = document.getElementById("header-pseudo");
      if (p) { p.className = status.decor.color ? "decor-" + status.decor.color : ""; p.title = status.decor.title || ""; }
      const av = document.querySelector("#user-menu-trigger .avatar");
      if (av) av.className = "avatar" + (status.decor.frame ? " decor-" + status.decor.frame : "");
    }
    // Prestige du compte (2026-10-09) : etoiles a cote du pseudo.
    {
      const p = document.getElementById("header-pseudo");
      let star = document.getElementById("header-prestige");
      if (status.prestigeStars > 0 && p) {
        if (!star) { star = document.createElement("span"); star.id = "header-prestige"; star.className = "header-prestige"; p.insertAdjacentElement("afterend", star); }
        star.textContent = "★" + (status.prestigeStars > 1 ? status.prestigeStars : "");
        star.title = `Prestige du compte : ${status.prestigeStars} étoile${status.prestigeStars > 1 ? "s" : ""} (+${status.prestigeStars} point${status.prestigeStars > 1 ? "s" : ""} de talent)`;
      } else if (star) star.remove();
    }
    // Rang de compte (valeur de la collection, 2026-10-07) a cote du pseudo.
    if (status.rank) {
      const p = document.getElementById("header-pseudo");
      let chip = document.getElementById("header-rank");
      if (!chip && p) { chip = document.createElement("span"); chip.id = "header-rank"; p.insertAdjacentElement("beforebegin", chip); }
      if (chip) { chip.className = "header-rank rank-" + status.rank.key; chip.textContent = status.rank.icon; chip.title = `Rang ${status.rank.label} (valeur de collection ${status.rank.value.toLocaleString("fr-FR")})`; }
      if (status.rank.promoted && typeof Toast !== "undefined") Toast.success(`${status.rank.icon} Tu passes au rang ${status.rank.label} !`);
    }
    // Pieces detachees (pechees) : visibles seulement si > 0.
    const partBadge = document.getElementById("header-part-badge");
    if (partBadge) {
      const parts = status.spareParts || 0;
      partBadge.style.display = parts > 0 ? "flex" : "none";
      if (parts > 0) setCount(partBadge.querySelector(".count"), parts);
    }
    // Tickets Unique (api/src/native/unique.js) : visibles seulement si > 0.
    const ticketBadge = document.getElementById("header-ticket-badge");
    if (ticketBadge) {
      const tickets = status.uniqueTickets || 0;
      ticketBadge.style.display = tickets > 0 ? "flex" : "none";
      if (tickets > 0) setCount(ticketBadge.querySelector(".count"), tickets);
    }

    syncStatsMore();
    if (status.xp) knownProfileLevel = status.xp.level;
    if (levelBadge && status.xp) {
      levelBadge.textContent = `Niv. ${status.xp.level}`;
      levelBadge.title = `Niveau ${status.xp.level} — ${status.xp.xpIntoLevel}/${status.xp.xpForNextLevel} XP vers le niveau suivant`;
      levelBadge.style.display = "inline-flex";
      celebrateLevelUpIfNeeded(status.xp.level);
    }
  } catch (e) {
    badge.innerHTML = `<span class="icon">&#127183;</span><span>?</span>`;
  }
}

// Header qui se tasse legerement au scroll vers le bas (et revient au
// scroll vers le haut) : recupere un peu de hauteur d'ecran sur les pages
// longues, sans jamais masquer completement la nav.
// Le header est en position:fixed (voir style.css) : il ne reserve plus
// d'espace dans le flux du document, donc <main> recoit sa hauteur reelle
// via la variable CSS --header-h. Mesuree au chargement/redimensionnement
// seulement, jamais au scroll (sinon on retombe dans le glitch qu'on evite :
// re-mesurer/reflow le contenu a chaque frame de scroll).
function syncHeaderOffset() {
  const header = document.getElementById("site-header");
  if (!header) return;
  document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
}

function initHeaderShrink() {
  const header = document.getElementById("site-header");
  if (!header) return;
  let lastY = window.scrollY;
  let ticking = false;
  // Le defilement (surtout au trackpad/mobile, avec inertie) n'est pas
  // strictement monotone : de minuscules sursauts dans l'autre sens
  // arrivent en continu meme pendant un scroll "vers le bas". Sans seuil
  // ni throttle, la classe "shrunk" s'activait/desactivait en rafale a
  // chaque frame, provoquant un scintillement visible du header.
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = Math.max(0, window.scrollY);
      const delta = y - lastY;
      if (Math.abs(delta) > 10) {
        header.classList.toggle("shrunk", y > 60 && delta > 0);
        lastY = y;
      }
      ticking = false;
    });
  }, { passive: true });
}

// Bouton flottant "retour en haut", utile sur les pages longues (collection,
// echanges avec beaucoup d'historique...). Apparait seulement apres un
// scroll significatif pour ne pas polluer l'ecran des le chargement.
function initBackToTop() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "back-to-top";
  btn.setAttribute("aria-label", "Retour en haut de la page");
  btn.innerHTML = "&#8593;";
  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  document.body.appendChild(btn);
  // Toucher l'onglet de la page en cours (nav du bas) : retour en haut (2026-10-19).
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest(".bottom-nav a.active");
    if (!a || window.scrollY < 80) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      btn.classList.toggle("visible", window.scrollY > 600);
      ticking = false;
    });
  }, { passive: true });
}

// Prechauffe en tache de fond le cache navigateur de toutes les images de
// cartes (+ visuels d'extension), depuis la page d'accueil : la route
// "get-image" renvoie desormais un Cache-Control longue duree (voir
// get-image.json), donc une image deja vue ici est servie par le cache du
// navigateur, sans nouvel appel, quand l'utilisateur arrive ensuite sur
// la collection/l'ouverture/le journal. Petits lots + requestIdleCallback
// pour rester en arriere-plan : ne rivalise ni avec le chargement de la page
// ni avec les vrais appels de l'utilisateur.
async function prefetchAllCardImages() {
  try {
    const [cardsRes, extRes] = await Promise.all([API.getCards(), API.getExtensions()]);
    const ids = new Set();
    (cardsRes.cards || []).forEach((c) => { if (c.imageId) ids.add(c.imageId); });
    (extRes.extensions || []).forEach((e) => {
      if (e.packImageId) ids.add(e.packImageId);
      if (e.cardBackImageId) ids.add(e.cardBackImageId);
    });
    const urls = [...ids].map((id) => API.imageUrl(id)).filter(Boolean);

    const BATCH_SIZE = 4;
    let i = 0;
    const scheduleNext = () => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(loadNextBatch, { timeout: 2000 });
      else setTimeout(loadNextBatch, 200);
    };
    function loadNextBatch() {
      urls.slice(i, i + BATCH_SIZE).forEach((src) => { const img = new Image(); img.src = src; });
      i += BATCH_SIZE;
      if (i < urls.length) scheduleNext();
    }
    scheduleNext();
  } catch (e) {
    // Optimisation de cache uniquement : un echec ne doit jamais gener la
    // navigation, on l'ignore silencieusement.
  }
}

// Lectures du gabarit commun a toutes les pages (maintenance, bandeau, paliers
// de niveau, en-tete, pastilles du menu) en UNE requete HTTP (API.batch) :
// avant la refonte du 2026-10-04, chaque page en lancait une vingtaine, en
// cascade et souvent en double. Les fonctions qui en ont besoin (en-tete,
// loadNavBadges...) gardent leurs appels habituels, servis par ce prefetch.
function prefetchShellData() {
  const calls = [{ name: "siteBanner" }, { name: "unlockConfig" }, { name: "eventStatus" }];
  if (Session.isLoggedIn()) {
    const userId = Session.userId;
    const read = (name, action = "status") => ({ name, body: { userId, action } });
    calls.push(
      { name: "boosterStatus", query: { userId } },
      read("trade", "list"), read("quests"), read("weeklyQuests"), read("levelRewards"),
      read("vault"), read("bingo"), read("guessCard"), read("expedition"),
      { name: "eventCalendar" }, read("communityBoss"), read("guildChest"), read("blackMarket", "list"),
      read("loginStreak"), read("setRewards"), read("season"),
      read("challenges"), read("communityGoal"), read("themes"), read("wishlistAlerts"),
      // 2026-10-18 : lectures que chaque page refaisait encore une par une
      // (centre des recompenses, parcours du debutant, chasse au tresor,
      // heure de chance, notes de mise a jour, visuels) : 12 requetes de moins.
      read("dailyBox"), read("dailyDice"), read("dailyWheel"), read("dogGift"), read("playerGift"), read("weeklyGoal"),
      read("starter"), read("forbidden"), { name: "today", query: { userId } }, { name: "treasureHunt", query: { userId } }
    );
    // Lectures propres a la page, servies par le meme lot (memes corps que
    // les appels de la page, sinon elles repartent simplement en individuel).
    const page = (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "") || "index";
    const coll = { name: "collection", query: { userId } };
    const PAGE_READS = {
      index: [read("story"), read("seasonQuests"), read("seasonal"), { name: "weeklyRecap", query: { userId } }, { name: "whatNow", query: { userId } }],
      jeux: [read("shop"), read("dig"), read("dino"), read("garden"), read("duoExpedition"), coll],
      ouverture: [read("shop"), read("ripen"), read("chests"), read("mastery"), coll, { name: "rarityPity", query: { userId } }],
      boutique: [read("cosmetics"), read("shop"), read("boosterShop"), read("upgrades"), read("sundayMarket"), read("contracts"), { name: "economyState" }],
      communaute: [read("machineRoom"), read("lottery"), read("teams")],
      progression: [read("mastery"), read("constellations"), read("skyTree"), read("talents"), read("achievementTiers"), { name: "exchangeRates" }, { name: "accountPrestige", query: { userId } }],
      mode: [read("modeExtra"), read("draft")],
      coffre: [read("personalVault"), read("uniqueCounter")],
      collection: [read("shop"), coll, { name: "economyRules", query: { userId } }, read("wishlist", "list"), read("showcase", "list"), { name: "exchangeRates" }, read("decraftUndo", "list")],
      trade: [coll, { name: "economyRules", query: { userId } }]
    };
    calls.push(...(PAGE_READS[page] || []));
  }
  calls.push({ name: "patchNotes" }, { name: "visuals" });
  return API.batch(calls);
}

// Des le chargement de shell.js (avant DOMContentLoaded) : les scripts de page
// qui lisent les memes donnees pendant l'analyse du HTML attendent ce lot.
prefetchShellData();

document.addEventListener("DOMContentLoaded", () => {
  checkMaintenanceMode();
  renderHeader();
  syncHeaderOffset();
  loadSiteBanner();
  loadEventBanner();
  loadUnlockConfig();
  initHeaderShrink();
  initBackToTop();

  let resizeTicking = false;
  const scheduleHeaderSync = () => {
    if (resizeTicking) return;
    resizeTicking = true;
    requestAnimationFrame(() => { syncHeaderOffset(); resizeTicking = false; });
  };
  window.addEventListener("resize", scheduleHeaderSync);
  window.addEventListener("orientationchange", scheduleHeaderSync);
  // Les polices web (Bungee/Inter) peuvent legerement changer la hauteur du
  // header une fois chargees : on recale une fois qu'elles sont pretes.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeaderOffset);

  // Rafraichissement periodique du header (QoL 2026-09-30) : un don admin ou
  // un gain recu pendant qu'on reste sur la meme page (booster, poussieres,
  // clefs) ne se voyait auparavant qu'au prochain rechargement manuel. Les
  // deux fonctions appelees ont deja leur propre cache (45-90s), donc cet
  // intervalle ne multiplie pas vraiment les requetes - il se contente de
  // les redeclencher regulierement. Pause quand l'onglet est en arriere-plan.
  if (Session.isLoggedIn()) {
    setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      API.invalidate();
      await prefetchShellData();
      loadHeaderBoosterBadge();
      loadNavBadges();
    }, 60000);
  }
});
