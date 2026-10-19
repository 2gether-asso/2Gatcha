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
const NAV_ITEMS = [
  { href: "index.html", label: "Accueil", icon: "&#127968;", auth: false, badgeKey: "rewards" },
  { href: "ouverture.html", label: "Ouvrir un booster", icon: "&#127873;", auth: false, badgeKey: "boosters", group: "jouer", groupLabel: "Jouer" },
  { href: "redeem.html", label: "Réclamer un code", icon: "&#127915;", auth: true, group: "jouer" },
  { href: "mode.html", label: "Mode du moment", icon: "&#127922;", auth: true, group: "jouer" },
  { href: "nouveautes.html", label: "Nouveautés", icon: "&#128240;", auth: false, group: "jouer" },
  { href: "collection.html", label: "Ma collection", icon: "&#128218;", auth: false, group: "collection", groupLabel: "Collection" },
  // Craft / decraft : modes de la page collection depuis la fusion (2026-10-04).
  { href: "collection.html#decrafter", label: "Craft & décraft", icon: "&#10024;", auth: true, group: "collection" },
  { href: "coffre.html", label: "Coffre-fort perso", icon: "&#128274;", auth: true, group: "collection" },
  { href: "boutique.html", label: "Boutique", icon: "&#128717;&#65039;", auth: true, group: "collection" },
  { href: "progression.html", label: "Progression", icon: "&#127775;", auth: true, group: "collection" },
  { href: "stats.html", label: "Mes statistiques", icon: "&#128202;", auth: true, group: "collection" },
  { href: "communaute.html", label: "Communauté", icon: "&#127758;", auth: true, badgeKey: "communaute" },
  { href: "jeux.html", label: "Jeux", icon: "&#127918;", auth: true, badgeKey: "jeux" },
  { href: "trade.html", label: "Échanges", icon: "&#128260;", auth: true, badgeKey: "trade" },
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
  setNavDot("trade", pendingCount ? navCount(pendingCount) : wishCount ? "★" : "", {
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
              <a href="boutique.html#cosmetiques"><span class="mi">&#127912;</span> Titres, cadres, couleurs</a>
              <a href="nouveautes.html" id="notes-link"><span class="mi">&#128240;</span> Nouveautés</a>
              <div class="menu-sep"></div>
              <button id="edit-pseudo-btn" type="button"><span class="mi">&#9998;</span> Modifier le pseudo</button>
              <button id="copy-profile-link-btn" type="button"><span class="mi">&#128279;</span> Copier le lien de mon profil</button>
              <button id="mute-toggle-btn" type="button">${Sfx.muted ? '<span class="mi">&#128264;</span> Son coupé' : '<span class="mi">&#128266;</span> Son actif'}</button>
              <button id="theme-cycle-btn" type="button"><span class="mi">&#127763;</span> Changer de thème</button>
              <button id="haptics-toggle-btn" type="button" title="Vibrations légères sur mobile (ferrage, trésors, belles cartes)"><span class="mi">&#128243;</span> Vibrations : <span data-haptics-label>${Haptics.on ? "activées" : "désactivées"}</span></button>
              <button id="compact-toggle-btn" type="button" title="Sur mobile : interface resserrée et actions principales en bas de l'accueil"><span class="mi">&#128241;</span> Mode compact : <span data-compact-label>${document.documentElement.dataset.compact === "1" ? "activé" : "désactivé"}</span></button>
              <button id="text-size-btn" type="button" title="Agrandit tout le texte du site sur cet appareil"><span class="mi">&#128269;</span> Taille du texte : <span data-text-size-label>${TextSize.LABELS[TextSize.get()]}</span></button>
              <button id="cine-pref-btn" type="button" title="Cinématiques d'ouverture, de découverte, de niveau et de changement de mode"><span class="mi">&#127916;</span> Cinématiques : <span data-cine-label>${CinePref.LABELS[CinePref.get()].toLowerCase()}</span></button>
              <button id="kbd-help-btn" type="button" class="only-fine-pointer" title="Raccourcis clavier (touche ?)"><span class="mi">&#9000;</span> Raccourcis clavier</button>
              <button id="discoveries-reset-btn" type="button" title="Rejoue l'animation de chaque ressource que tu possèdes"><span class="mi">&#128270;</span> Revoir les découvertes</button>
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
        renderNotifDropdown();
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
          return `<a class="global-search-item gs-card" href="collection.html?cardId=${c.cardId}">${c.imageId ? `<img src="${API.imageUrl(c.imageId)}" alt="" loading="lazy" />` : "&#127183;"}<span>${c.name}</span><small style="color:${c.rarity?.colorHex || "inherit"}">${c.rarity?.name || ""}</small>${Session.isLoggedIn() ? `<small class="gs-own">${o ? "×" + o.count : "manquante"}</small>` : ""}</a>`;
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
    document.getElementById("mute-toggle-btn").addEventListener("click", (e) => {
      Sfx.setMuted(!Sfx.muted);
      e.currentTarget.innerHTML = Sfx.muted ? '<span class="mi">&#128264;</span> Son coupé' : '<span class="mi">&#128266;</span> Son actif';
      if (!Sfx.muted) Sfx.click();
    });
    document.getElementById("theme-cycle-btn").addEventListener("click", cycleTheme);
    document.getElementById("haptics-toggle-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const on = !Haptics.on;
      Haptics.set(on);
      e.currentTarget.querySelector("[data-haptics-label]").textContent = on ? "activées" : "désactivées";
      if (on) Haptics.buzz(30);
      Toast.info(on ? "📳 Vibrations activées." : "📳 Vibrations désactivées.");
    });
    document.getElementById("compact-toggle-btn").addEventListener("click", (e) => {
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
    document.getElementById("kbd-help-btn").addEventListener("click", (e) => { e.stopPropagation(); Shortcuts.help(); });
    document.getElementById("text-size-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const v = TextSize.next();
      e.currentTarget.querySelector("[data-text-size-label]").textContent = TextSize.LABELS[v];
    });
    document.getElementById("cine-pref-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const v = CinePref.next();
      e.currentTarget.querySelector("[data-cine-label]").textContent = CinePref.LABELS[v].toLowerCase();
      Toast.info({ always: "🎬 Cinématiques toujours affichées.", first: "🎬 Chaque cinématique ne s'affichera qu'une fois (par rareté, mode, métier…).", never: "🎬 Cinématiques désactivées : un court message les remplace." }[v]);
    });
    document.getElementById("discoveries-reset-btn").addEventListener("click", async () => {
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
  next() {
    const v = this.ORDER[(this.ORDER.indexOf(this.get()) + 1) % this.ORDER.length];
    try { if (v === "normal") localStorage.removeItem(this.KEY); else localStorage.setItem(this.KEY, v); } catch (e) { /* stockage indisponible */ }
    this.apply(v);
    return v;
  }
};
TextSize.apply(TextSize.get());

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

// Week-end evenement (api/src/native/events.js) : bandeau festif tant qu'il dure.
async function loadEventBanner() {
  const el = document.getElementById("site-header");
  if (!el) return;
  try {
    const ev = await API.getEventStatus();
    if (ev && ev.gameMode) applyGameMode(ev.gameMode);
    if (ev) applySeason(ev.season);
    if (ev) applySurprise(el, ev.surprise);
    if (ev && ev.gameMode) modeBanners(el, ev.gameMode);
    if (!ev || !ev.active) return;
    const perks = [];
    if (ev.dustMultiplier > 1) perks.push(`poussières x${ev.dustMultiplier}`);
    if (ev.finishMultiplier > 1) perks.push(`finitions x${ev.finishMultiplier}`);
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
    // Jeux et pages debloques (nouveaux comptes, starter.js).
    (typeof StarterLocks !== "undefined" ? StarterLocks.unlocks : []).forEach((u) => { if (u.level === l) perks.push(`🔓 ${u.icon} ${u.label}`); });
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

async function loadHeaderBoosterBadge() {
  const badge = document.getElementById("header-booster-badge");
  const dustBadge = document.getElementById("header-stardust-badge");
  const levelBadge = document.getElementById("header-level-badge");
  if (!badge) return;
  try {
    const status = await API.getBoosterStatus(Session.userId);
    window.__hdrStatus = status;
    // Bonus et malus du mode (modeperks.js).
    if (typeof Toast !== "undefined") {
      if (status.hug) Toast.success(`&#128526; Câlin du jour (mode Cool) : ${status.hug} !`);
      if (status.wear) Toast.info(`&#129533; Usure (mode Hard) : un doublon de <strong>${escHtml(status.wear.card)}</strong> s'est usé.`);
      if (status.modeUnlock) Toast.success(`&#127942; Débloqué : ${escHtml(status.modeUnlock)} !`);
      // Nouvelle etoile de prestige du compte (account-prestige.js).
      const pu = status.prestigeUnlocked;
      if (pu && typeof LevelFx !== "undefined") {
        LevelFx.show({ kind: "prestige", icon: "&#11088;", name: "Prestige du compte", level: `${"★".repeat(Math.min(pu.star || pu.stars, 5))} Étoile ${pu.star || pu.stars}`,
          perks: [pu.boosters ? `🎁 +${pu.boosters} jetons booster` : "", pu.dust ? `✨ +${pu.dust.toLocaleString("fr-FR")} poussières` : "", `🌳 +${pu.gained || 1} point${(pu.gained || 1) > 1 ? "s" : ""} de talent de prestige`, ...(pu.titles || []).map((t) => `🏷️ ${escHtml(t)}`)].filter(Boolean) });
        if (typeof loadHeaderBoosterBadge === "function" && pu.boosters) setTimeout(loadHeaderBoosterBadge, 500);
      }
      // Malediction, mutation, larcin subi, serment tenu… (modefun.js).
      (status.modeNotes || []).forEach((n) => Toast.info(`${n.icon} ${escHtml(n.text)}`));
    }
    // Pluie de boosters (objectif commun atteint) : annonce une seule fois.
    if (status.rain && typeof Toast !== "undefined") {
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

// ---------------------------------------------------------------------------
// Heure de chance (2026-10-07) : bandeau sur toutes les pages pendant
// l'heure de chance. Les fenetres du jour sont gardees en session (elles ne
// changent pas dans la journee) : aucune requete en plus par page.
// ---------------------------------------------------------------------------
const LuckyHour = {
  KEY: "2gatcha_lucky",
  today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }); },
  read() { try { const v = JSON.parse(sessionStorage.getItem(this.KEY) || "null"); return v && v.day === this.today() ? v : null; } catch (e) { return null; } },
  async windows() {
    const cached = this.read();
    if (cached) return cached.windows;
    const t = await API.getToday(Session.userId);
    const windows = t.lucky.windows || [t.lucky.window, t.lucky.next].filter(Boolean);
    try { sessionStorage.setItem(this.KEY, JSON.stringify({ day: this.today(), windows })); } catch (e) { /* stockage indisponible */ }
    return windows;
  },
  async init() {
    if (!Session.isLoggedIn() || document.getElementById("lucky-banner")) return;
    let windows = [];
    try { windows = await this.windows(); } catch (e) { return; }
    const draw = () => {
      const now = Date.now() / 1000;
      const w = windows.find((x) => x.start <= now && now < x.end);
      let el = document.getElementById("lucky-banner");
      if (!w) { if (el) { el.remove(); if (typeof syncHeaderOffset === "function") syncHeaderOffset(); } return; }
      if (!el) {
        el = document.createElement("a");
        el.id = "lucky-banner";
        el.className = "lucky-banner";
        el.href = "ouverture.html";
        document.getElementById("site-header")?.appendChild(el); if (typeof syncHeaderOffset === "function") syncHeaderOffset();
      }
      const m = Math.max(1, Math.ceil((w.end - now) / 60));
      el.innerHTML = `&#127808; <strong>Heure de chance</strong> : finitions et poussières boostées encore ${m} min`;
    };
    draw();
    setInterval(draw, 30000);
  }
};

// ---------------------------------------------------------------------------
// Carte de joueur au survol d'un pseudo (2026-10-07) : rang, titre, niveau
// et vitrine (6 cartes), sur ordinateur seulement.
// ---------------------------------------------------------------------------
const PlayerCard = {
  cache: new Map(),
  el: null,
  timer: null,
  init() {
    if (!window.matchMedia || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    document.addEventListener("mouseover", (e) => {
      const a = e.target.closest && e.target.closest('a[href*="profile.html?pseudo="]');
      if (!a || a.closest(".player-card-pop")) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.show(a), 380);
    });
    document.addEventListener("mouseout", (e) => {
      const a = e.target.closest && e.target.closest('a[href*="profile.html?pseudo="]');
      if (a && !a.contains(e.relatedTarget)) { clearTimeout(this.timer); this.hideSoon(); }
    });
  },
  hideSoon() { setTimeout(() => { if (this.el && !this.el.matches(":hover")) this.el.remove(); }, 200); },
  async show(a) {
    const pseudo = new URL(a.href, location.href).searchParams.get("pseudo");
    if (!pseudo) return;
    let data = this.cache.get(pseudo);
    if (!data) { try { data = await API.getPlayerCard(pseudo); this.cache.set(pseudo, data); } catch (e) { return; } }
    if (!a.matches(":hover")) return;
    const esc = escHtml;
    if (this.el) this.el.remove();
    const el = document.createElement("div");
    el.className = "player-card-pop";
    el.innerHTML = `
      <div class="pcp-head">
        ${data.avatar ? `<img class="pcp-avatar ${data.decor && data.decor.frame ? "decor-" + data.decor.frame : ""}" src="${data.avatar}" alt="" />` : ""}
        <div><strong class="${data.decor && data.decor.color ? "decor-" + data.decor.color : ""}">${esc(data.pseudo)}</strong>
          ${data.decor && data.decor.title ? `<small class="decor-title">${esc(data.decor.title)}</small>` : ""}
          <small>Niv. ${data.level}${data.prestigeStars > 0 ? ` <span class="header-prestige" title="Prestige du compte">★${data.prestigeStars > 1 ? data.prestigeStars : ""}</span>` : ""} · ${data.rank.icon} ${esc(data.rank.label)} · &#127907; ${data.skills.fishing} · &#9935;&#65039; ${data.skills.dig}</small></div>
      </div>
      ${data.starDino ? `<div class="pcp-dino" data-pcp-dino>${window.DinoArt ? DinoArt.svg(data.starDino, { scale: 1 }) : ""}<small>&#129430; ${esc(data.starDino.name)} · ${esc(data.starDino.speciesLabel)}</small></div>` : ""}
      ${data.showcase.length ? `<div class="pcp-showcase">${data.showcase.map((c) => `<img src="${API.imageUrl(c.imageId)}" alt="${esc(c.name)}" title="${esc(c.name)}" style="--r:${esc(c.rarity?.colorHex || "#888")}" loading="lazy" />`).join("")}</div>` : '<small class="muted">Vitrine vide</small>'}`;
    document.body.appendChild(el);
    if (data.starDino && !window.DinoArt) {
      const s = document.createElement("script");
      s.src = "js/dino-art.js";
      s.onload = () => { const box = el.querySelector("[data-pcp-dino]"); if (box && window.DinoArt) box.insertAdjacentHTML("afterbegin", DinoArt.svg(data.starDino, { scale: 1 })); };
      document.head.appendChild(s);
    }
    const r = a.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + "px";
    el.style.top = (r.bottom + h + 12 > window.innerHeight ? r.top - h - 8 : r.bottom + 8) + "px";
    el.addEventListener("mouseleave", () => el.remove());
    this.el = el;
  }
};

document.addEventListener("DOMContentLoaded", () => {
  LuckyHour.init();
  PlayerCard.init();
});


// ---------------------------------------------------------------------------
// Inventaire (2026-10-08) : la barre de ressources de l'en-tete ouvre un
// panneau qui nomme chaque ressource, dit a quoi elle sert et ou l'utiliser.
// Les compteurs viennent du statut deja charge (booster-status) ; coffres,
// appats et os sont lus a l'ouverture (et ignores si indisponibles).
// ---------------------------------------------------------------------------
const Inventory = {
  extra: null,
  isOpen() { const p = document.getElementById("inventory-panel"); return !!p && !p.hidden; },
  async loadExtra() {
    const uid = Session.userId;
    const [chests, garden, dig, shop, timers] = await Promise.allSettled([API.chests(uid, "status"), API.garden(uid), API.getDigStatus(uid), API.shop ? API.shop(uid) : Promise.reject(), API.get("timers", { userId: uid })]);
    const v = (r) => (r.status === "fulfilled" ? r.value : null);
    const d = v(dig);
    this.extra = {
      chests: v(chests)?.chests, goldBait: v(garden)?.goldBait,
      bones: d ? (d.bones ?? d.dog?.bones ?? d.kennel?.bones) : undefined,
      luck: v(shop)?.luckCharges, xpUntil: v(shop)?.xpBoostUntil,
      timers: v(timers), timersAt: Date.now()
    };
    if (this.isOpen()) this.render();
  },
  render() {
    const st = window.__hdrStatus || {};
    const x = this.extra || {};
    const n = (v) => (v == null ? null : Number(v) || 0);
    const items = [
      { icon: '<img class="ico-token" src="assets/JetonBooster.png" alt="" />', name: "Jetons booster", count: n(st.count), desc: "1 jeton = 1 booster (5 cartes) de l'extension de ton choix, au distributeur.", url: "ouverture.html", cta: "Ouvrir" },
      { icon: "&#10024;", name: "Poussières d'étoile", count: n(st.stardust), desc: "Crafter des cartes, la boutique, les enchères.", url: "boutique.html", cta: "Dépenser" },
      { icon: resIcon("key"), name: "Clés", count: n(st.keys), desc: "Ouvrent les coffres du gatchapon et le grand coffre-fort.", url: "ouverture.html", cta: "Utiliser" },
      { icon: resIcon("coin"), name: "Pièces de gatchapon", count: n(x.chests), desc: "Une pièce = une boule au gatchapon, avec un coffre dedans (à ouvrir avec une clé).", url: "ouverture.html", cta: "Gatchapon" },
      { icon: resIcon("worm"), name: "Vers de terre", count: n(st.worms), desc: "Un par lancer de pêche.", url: "jeux.html#peche", cta: "Pêcher" },
      { icon: resIcon("bait"), name: "Appâts dorés", count: n(x.goldBait), desc: "Aucune prise vide et prises rares ×2,5.", url: "jeux.html#peche", cta: "Pêcher" },
      { icon: resIcon("bone"), name: "Os", count: n(x.bones), desc: "Envoient Milo, le chien, creuser pour toi.", url: "jeux.html#fouille", cta: "Chenil" },
      { icon: resIcon("part"), name: "Pièces détachées", count: n(st.spareParts), desc: "Remplacent un exemplaire dans une fusion ou une restauration.", url: "collection.html#finitions", cta: "Atelier" },
      { icon: "&#127915;", name: "Tickets Unique", count: n(st.uniqueTickets), desc: "Une carte Unique au choix au Comptoir.", url: "coffre.html#comptoir", cta: "Comptoir" },
      { icon: "&#129514;", name: "Élixir de chance", count: n(x.luck), desc: "Boosters restants avec +5 pts de finition spéciale.", url: "ouverture.html", cta: "Ouvrir" },
      { icon: "&#129513;", name: "Fragments de booster", count: st.shards ? n(st.shards.count) : null, desc: st.shards ? `${st.shards.per} fragments = 1 booster. Gagnés en jouant (fouille, jardin, pêche, expéditions…).` : "", url: "jeux.html", cta: "Jouer" }
    ];
    const boost = x.xpUntil && x.xpUntil > Date.now() / 1000 ? Math.ceil((x.xpUntil - Date.now() / 1000) / 60) : 0;
    const shown = items.filter((i) => i.count == null ? false : i.count > 0 || ["Boosters", "Poussières d'étoile"].includes(i.name));
    const empty = items.filter((i) => i.count === 0 && !["Boosters", "Poussières d'étoile"].includes(i.name));
    const fmt = (c) => Number(c).toLocaleString("fr-FR");
    document.getElementById("inventory-panel").innerHTML = `
      <div class="inv-head"><strong>&#127890; Inventaire</strong><a href="boutique.html" class="inv-shop">&#128717;&#65039; Boutique</a></div>
      ${boost ? `<div class="inv-boost">&#128216; XP ×2 encore ${boost} min</div>` : ""}
      ${this.timersHtml()}
      <ul class="inv-list">${shown.map((i) => `<li><a href="${i.url}"><span class="inv-icon" aria-hidden="true">${i.icon}</span><span class="inv-body"><strong>${i.name}</strong><small>${i.desc}</small></span><span class="inv-count">${fmt(i.count)}</span><span class="inv-cta">${i.cta} &#8250;</span></a></li>`).join("")}</ul>
      ${empty.length ? `<p class="inv-empty">Pas encore : ${empty.map((i) => `<span title="${i.desc}">${i.icon} ${i.name}</span>`).join(" · ")}</p>` : ""}
      ${Treasure.state && Treasure.state.enabled ? `<p class="inv-treasure"><img class="ico-token" src="assets/Boussole.PNG" alt="" /> Course aux trésors : <strong>${Treasure.state.found}/${Treasure.state.total}</strong> indices cette semaine${Treasure.state.found < Treasure.state.total ? ` · cachés sur : ${Treasure.state.clues.filter((c) => !c.found).map((c) => c.label).join(", ")}` : " · bravo !"}</p>` : ""}
      ${this.extra ? "" : '<p class="inv-empty">Chargement des coffres, appâts et os…</p>'}`;
    // Minuteurs : decompte en direct tant que le panneau est ouvert.
    clearInterval(this.tick);
    if (this.extra && this.extra.timers) this.tick = setInterval(() => { if (!this.isOpen()) { clearInterval(this.tick); return; } const box = document.getElementById("inv-timers"); if (box) box.outerHTML = this.timersHtml(); }, 1000);
  },
  // Minuteurs (2026-10-18, api/src/native/timers.js) : ce qui sera pret, et quand.
  timersHtml() {
    const tm = this.extra && this.extra.timers;
    if (!tm || !tm.items || !tm.items.length) return "";
    const nowS = tm.now + Math.floor((Date.now() - this.extra.timersAt) / 1000);
    const left = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h} h ${String(m).padStart(2, "0")}` : m ? `${m} min ${String(sec).padStart(2, "0")}` : `${sec} s`; };
    const icon = (k) => (k === "pick" ? '<img class="ico-token" src="assets/Fouille/Pioche_01.PNG" alt="" />' : RES_ART[k] ? resIcon(k) : k);
    return `<div class="inv-timers" id="inv-timers"><strong>&#9201;&#65039; Minuteurs</strong><ul>${tm.items.map((i) => { const s = i.at - nowS; return `<li class="${s <= 0 ? "ready" : ""}"><a href="${i.url}"><span class="inv-timer-ico" aria-hidden="true">${icon(i.icon)}</span><span class="inv-timer-label">${escHtml(i.label)}</span><span class="inv-timer-left">${s <= 0 ? "prêt !" : "dans " + left(s)}</span></a></li>`; }).join("")}</ul></div>`;
  },
  toggle(force) {
    const panel = document.getElementById("inventory-panel");
    const btn = document.getElementById("inventory-trigger");
    if (!panel || !btn) return;
    const open = force != null ? force : panel.hidden;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    document.getElementById("inventory")?.classList.toggle("open", open);
    if (open) { this.render(); this.loadExtra(); }
  },
  init() {
    const btn = document.getElementById("inventory-trigger");
    if (!btn) return;
    btn.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    document.addEventListener("click", (e) => { if (this.isOpen() && !document.getElementById("inventory").contains(e.target)) this.toggle(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.isOpen()) { this.toggle(false); btn.focus(); } });
  }
};
document.addEventListener("DOMContentLoaded", () => Inventory.init());


// ---------------------------------------------------------------------------
// Course aux tresors hebdo (2026-10-09, api/src/native/treasure.js) : 5
// indices caches sur 5 pages ; sur la page concernee, une petite icone
// discrete est glissee dans le contenu. Un clic la ramasse.
// ---------------------------------------------------------------------------
const Treasure = {
  state: null,
  page() {
    const name = (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "");
    return name || "index";
  },
  async load() {
    if (typeof Session === "undefined" || !Session.isLoggedIn() || !API.getTreasureHunt) return;
    try { this.state = await API.getTreasureHunt(Session.userId); } catch (e) { return; }
    if (!this.state.enabled) return;
    const clue = this.state.clues.find((c) => c.page === this.page() && !c.found);
    if (clue) setTimeout(() => this.place(clue), 1200);
  },
  place(clue) {
    const host = document.querySelector("main") || document.body;
    if (!host || document.getElementById("treasure-clue")) return;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const b = document.createElement("button");
    b.type = "button";
    b.id = "treasure-clue";
    b.className = "treasure-clue";
    b.setAttribute("aria-label", "Indice de la course aux trésors");
    b.title = "Un indice ?";
    b.innerHTML = '<img src="assets/CarteAuTresors.PNG" alt="" />';
    b.style.left = clue.x + "%";
    b.style.top = clue.y + "%";
    b.addEventListener("click", () => this.find(clue, b));
    host.appendChild(b);
  },
  async find(clue, el) {
    el.disabled = true;
    try {
      const r = await API.findTreasure(Session.userId, clue.id, clue.page);
      this.state = r;
      el.classList.add("found");
      setTimeout(() => el.remove(), 700);
      if (typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal("rare");
      const left = r.total - r.found;
      Toast.success(r.complete
        ? `&#129517; Les 5 indices trouvés ! +${r.reward.dust} poussières${r.reward.boosters ? `, +${r.reward.boosters} booster` : ""}${r.reward.keys ? `, +${r.reward.keys} clé` : ""}`
        : `&#129517; Indice trouvé (+${r.reward.dust} poussières) ! Encore ${left} à dénicher cette semaine.`);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (e) {
      el.disabled = false;
      if (e.code === "already_found") el.remove(); else Toast.error("Indice introuvable. (" + e.message + ")");
    }
  }
};
document.addEventListener("DOMContentLoaded", () => Treasure.load());

// Compte test admin (2026-10-18) : outils et bandeau charges seulement
// pendant une partie avec le compte test (js/testaccount.js).
document.addEventListener("DOMContentLoaded", () => {
  try {
    if (!localStorage.getItem("2gatcha_test_backup") || window.TestAccount) return;
    const s = document.createElement("script");
    s.src = "js/testaccount.js";
    document.head.appendChild(s);
  } catch (e) { /* stockage indisponible */ }
});

// Deblocages par niveau des nouveaux comptes (2026-10-18, api/src/native/
// starter.js) : onglets et liens verrouilles gardes visibles avec un cadenas
// (clic -> message), widgets masques, page verrouillee remplacee par un
// message ; accueil simplifie tant que le parcours du debutant n'est pas fini.
const StarterLocks = {
  KEY: "2gatcha_starter_" + (Session.userId || ""),
  locks: [],
  unlocks: [],
  // Onglets, liens et modes de collection : cadenas. Le reste (panneaux) : masque.
  isTeaser: (sel) => /^(#tab-|a\[|\.coll-mode)/.test(sel),
  apply(view) {
    const locks = (view && view.locks) || [];
    this.locks = locks;
    if (view && view.unlocks) this.unlocks = view.unlocks;
    document.documentElement.classList.toggle("starter-simple", !!(view && view.active));
    let style = document.getElementById("starter-locks-style");
    if (!style) { style = document.createElement("style"); style.id = "starter-locks-style"; document.head.appendChild(style); }
    style.textContent = locks.map((l) => {
      const teaser = (l.hide || []).filter(this.isTeaser), hidden = (l.hide || []).filter((s) => !this.isTeaser(s));
      return (teaser.length ? `${teaser.join(",")} { opacity: 0.5; filter: grayscale(0.7); }\n${teaser.map((s) => s + "::after").join(",")} { content: " \\1F512 ${l.level}"; font-size: 0.72em; margin-left: 4px; white-space: nowrap; }\n` : "") +
        (hidden.length ? `${hidden.join(",")} { display: none !important; }\n` : "");
    }).join("");
    const run = () => {
      const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
      const lock = locks.find((l) => l.page && l.page === page);
      const main = document.querySelector("main");
      if (lock && main && !main.querySelector(".feature-closed")) {
        [...main.children].forEach((el) => { el.hidden = true; });
        main.insertAdjacentHTML("afterbegin", `<section class="feature-closed"><span class="feature-closed-icon" aria-hidden="true">${lock.icon}</span>
          <h1>${escHtml(lock.label)}</h1>
          <p>Se débloque au <strong>niveau ${lock.level}</strong>. Continue le parcours du débutant et joue un peu : chaque booster ouvert et chaque jeu rapportent de l'XP.</p>
          <a class="btn" href="index.html">Retour à l'accueil</a></section>`);
      }
      // Onglet verrouille ouvert par un lien #ancre ou un script de page
      // (meme plus tard) : on repart sur le premier onglet ouvert.
      document.querySelectorAll('[role="tab"][aria-selected="true"]').forEach((t) => this.leave(t));
      if (!this.observer) {
        this.observer = new MutationObserver((list) => list.forEach((m) => { if (m.target.getAttribute("aria-selected") === "true") this.leave(m.target); }));
        this.observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
      }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(run, 0)); else run();
  },
  lockOf(el) {
    return this.locks.find((l) => (l.hide || []).some((s) => this.isTeaser(s) && el.closest(s)));
  },
  leave(tab) {
    if (tab.getAttribute("role") !== "tab" || !tab.parentElement || !this.lockOf(tab)) return;
    const next = [...tab.parentElement.querySelectorAll('[role="tab"]')].find((x) => !this.lockOf(x) && x.offsetParent !== null);
    if (next) setTimeout(() => next.click(), 0);
  },
  async refresh() {
    if (typeof Session === "undefined" || !Session.isLoggedIn()) return null;
    try {
      const v = await API.post("starter", { userId: Session.userId, action: "status" });
      try { localStorage.setItem(this.KEY, JSON.stringify({ locks: v.locks, active: v.active, unlocks: v.unlocks })); } catch (e) { /* stockage indisponible */ }
      this.apply(v);
      return v;
    } catch (e) { return null; }
  }
};
// Clic sur un element verrouille : message au lieu de l'action.
document.addEventListener("click", (e) => {
  if (!StarterLocks.locks.length || !(e.target instanceof Element)) return;
  const l = StarterLocks.lockOf(e.target);
  if (!l) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (typeof Toast !== "undefined") Toast.info(`${l.icon} ${escHtml(l.label)} se débloque au niveau ${l.level}.`);
}, true);
try { const c = JSON.parse(localStorage.getItem(StarterLocks.KEY) || "null"); if (c && Session.isLoggedIn()) StarterLocks.apply(c); } catch (e) { /* stockage indisponible */ }
document.addEventListener("DOMContentLoaded", () => StarterLocks.refresh());

// Infobulles des ressources (2026-10-18) : survol (ordinateur) ou appui
// (mobile) sur une icone de ressource : a quoi elle sert, ou en trouver.
// Dans un bouton ou un lien, seule l'infobulle du navigateur (title) s'affiche.
document.addEventListener("mouseover", (e) => {
  const img = e.target instanceof Element ? e.target.closest("img.ico-token") : null;
  if (!img || img.title || typeof resKindOf !== "function") return;
  const info = RES_INFO[resKindOf(img)];
  if (info) img.title = info.name + " : " + info.use + " Où en trouver : " + info.where;
});
document.addEventListener("click", (e) => {
  const img = e.target instanceof Element ? e.target.closest("img.ico-token") : null;
  const old = document.querySelector(".res-pop");
  if (old && !(e.target instanceof Element && e.target.closest(".res-pop"))) old.remove();
  if (!img || img.closest("button, a, label, select, .inv-icon, [data-shop-buy]") || typeof resKindOf !== "function") return;
  const info = RES_INFO[resKindOf(img)];
  if (!info) return;
  const pop = document.createElement("div");
  pop.className = "res-pop";
  pop.setAttribute("role", "tooltip");
  pop.innerHTML = `<strong>${escHtml(info.name)}</strong><span>${escHtml(info.use)}</span><small>Où en trouver : ${escHtml(info.where)}</small>`;
  document.body.appendChild(pop);
  const r = img.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
  pop.style.top = (r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8) + "px";
  setTimeout(() => pop.remove(), 6000);
});

// Tirer pour rafraichir (2026-10-18) : sur ecran tactile, en haut de la page,
// tirer vers le bas recharge la page (le geste natif d'Android est coupe en CSS
// pour avoir le meme partout). Jamais dans une fenetre ouverte ni un jeu en cours.
(function () {
  if (!("ontouchstart" in window)) return;
  let startY = null, dy = 0, ind = null;
  const blocked = (el) => !!(el && el.closest && el.closest(".card-modal-overlay, .ta-modal, .season-cine, .cine-overlay, .user-menu-dropdown.open, .inventory-panel, .fish-scene, .dig-board, input, textarea, select, [data-no-ptr]"));
  document.addEventListener("touchstart", (e) => {
    if (window.scrollY > 0 || e.touches.length !== 1 || blocked(e.target) || document.querySelector(".card-modal-overlay:not([hidden]), .ta-modal, .season-cine")) { startY = null; return; }
    startY = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { if (ind) ind.style.opacity = "0"; return; }
    if (!ind) { ind = document.createElement("div"); ind.className = "ptr-indicator"; ind.setAttribute("aria-hidden", "true"); document.body.appendChild(ind); }
    const p = Math.min(1, dy / 110);
    ind.style.opacity = String(p);
    ind.style.transform = `translate(-50%, ${Math.min(70, dy / 2)}px) rotate(${Math.round(p * 270)}deg)`;
    ind.classList.toggle("armed", dy > 110);
    ind.textContent = "↻";
  }, { passive: true });
  document.addEventListener("touchend", () => {
    if (startY == null) return;
    const go = dy > 110 && window.scrollY <= 0;
    startY = null;
    if (go) { if (ind) ind.classList.add("loading"); if (typeof Haptics !== "undefined") Haptics.buzz(15); setTimeout(() => location.reload(), 150); }
    else if (ind) { ind.style.opacity = "0"; }
  });
})();

// ---------------------------------------------------------------------------
// Raccourcis clavier (2026-10-18, ordinateur) : « / » ouvre la recherche,
// « g » puis une lettre change de page, « ? » affiche l'aide. Ignores pendant
// la saisie, avec Ctrl/Alt/Cmd, ou quand une fenetre est ouverte.
// ---------------------------------------------------------------------------
const Shortcuts = {
  GO: { a: ["index.html", "Accueil"], o: ["ouverture.html", "Ouvrir des boosters"], c: ["collection.html", "Collection"], j: ["jeux.html", "Jeux"], m: ["communaute.html", "Communauté"], b: ["boutique.html", "Boutique"], e: ["trade.html", "Échanges"], p: ["progression.html", "Progression"], f: ["coffre.html", "Coffre-fort"] },
  pending: 0,
  busy(e) {
    const t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey) return true;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return true;
    return !!document.querySelector(".card-modal-overlay, .wf-overlay, .fish-pick, [role='dialog']:not([hidden])");
  },
  help() {
    const rows = [["/", "Rechercher un joueur, une carte…"], ["?", "Cette aide"], ...Object.entries(this.GO).map(([k, [, label]]) => [`g puis ${k}`, label])];
    Confirm.show(`<table class="kbd-help">${rows.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join("")}</table>`, { title: "Raccourcis clavier", confirmText: "OK", cancelText: "Fermer" });
  },
  init() {
    document.addEventListener("keydown", (e) => {
      if (this.busy(e)) { this.pending = 0; return; }
      const k = e.key;
      if (this.pending && Date.now() - this.pending < 1200) {
        this.pending = 0;
        const go = this.GO[k.toLowerCase()];
        if (go) { e.preventDefault(); location.href = go[0]; }
        return;
      }
      this.pending = 0;
      if (k === "g") this.pending = Date.now();
      else if (k === "/") { const b = document.getElementById("global-search-trigger"); if (b) { e.preventDefault(); b.click(); } }
      else if (k === "?") { e.preventDefault(); this.help(); }
    });
  }
};
if (!window.matchMedia || !matchMedia("(pointer: coarse)").matches) Shortcuts.init();
// Tout bouton [data-open-search] ouvre la recherche de l'en-tete.
document.addEventListener("click", (e) => {
  if (!e.target.closest || !e.target.closest("[data-open-search]")) return;
  document.getElementById("global-search-trigger")?.click();
});

// ---------------------------------------------------------------------------
// Une seule cle dans le jeu (2026-10-19) : les emojis de cle encore presents
// dans des textes venus de l'API (« 🔑 1 clé », couts, recompenses) sont
// remplaces a l'affichage par l'image de la cle (clés.PNG), partout.
// ---------------------------------------------------------------------------
const KeyArt = {
  RE: /\u{1F511}|\u{1F5DD}\u{FE0F}?/u,
  SPLIT: /(\u{1F511}|\u{1F5DD}\u{FE0F}?)/u,
  SKIP: new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "OPTION", "SELECT", "TITLE", "svg", "text"]),
  // Garde-fou : un element qui remet sans cesse son emoji (rendu en boucle)
  // n'est plus touche apres quelques remplacements.
  hits: new WeakMap(),
  swaps: 0,
  queue: new Set(),
  scheduled: false,
  swapText(node) {
    const parent = node.parentNode;
    if (!parent || parent.nodeType !== 1 || this.SKIP.has(parent.nodeName) || parent.closest("svg, select, [contenteditable='true']")) return;
    const n = (this.hits.get(parent) || 0) + 1;
    if (n > 3) return;
    this.hits.set(parent, n);
    const parts = node.nodeValue.split(this.SPLIT);
    if (parts.length < 2) return;
    const frag = document.createDocumentFragment();
    parts.forEach((p, i) => {
      if (i % 2) { const img = document.createElement("img"); img.className = "ico-token"; img.src = "assets/" + encodeURI(RES_ART.key); img.alt = "clé"; frag.appendChild(img); }
      else if (p) frag.appendChild(document.createTextNode(p));
    });
    this.swaps++;
    parent.replaceChild(frag, node);
  },
  scan(root) {
    if (!root || !root.isConnected) return;
    if (root.nodeType === 3) { if (this.RE.test(root.nodeValue)) this.swapText(root); return; }
    if (root.nodeType !== 1 || this.SKIP.has(root.nodeName) || !this.RE.test(root.textContent || "")) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found = [];
    while (walker.nextNode()) if (this.RE.test(walker.currentNode.nodeValue)) found.push(walker.currentNode);
    found.forEach((t) => this.swapText(t));
  },
  // Traitement groupe a chaque image (pas dans le rappel de l'observateur).
  enqueue(node) {
    this.queue.add(node);
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      const list = [...this.queue];
      this.queue.clear();
      list.forEach((n) => this.scan(n));
    });
  },
  init() {
    this.scan(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") { if (this.RE.test(m.target.nodeValue || "")) this.enqueue(m.target); }
        else m.addedNodes.forEach((n) => { if ((n.nodeType === 3 || n.nodeType === 1) && this.RE.test(n.textContent || "")) this.enqueue(n); });
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => KeyArt.init()); else KeyArt.init();

// Salle interdite dans « Jouer » : le serveur dit si le joueur y a acces (et
// son adresse) ; le lien est ajoute au menu deja affiche et garde en cache.
async function syncForbiddenNav() {
  if (!Session.isLoggedIn()) return;
  let st;
  try { st = await API.post("forbidden", { userId: Session.userId, action: "status" }); } catch (e) { return; }
  try { if (st.access && st.page) localStorage.setItem("2gatcha_forbidden", st.page); else localStorage.removeItem("2gatcha_forbidden"); } catch (e) { /* stockage indisponible */ }
  const item = forbiddenNavItem();
  const drop = document.querySelector("#nav-group-jouer .nav-group-dropdown");
  if (item && drop && !drop.querySelector(`a[href="${item.href}"]`)) { const ouv = drop.querySelector('a[href="ouverture.html"]'); const html = `<a href="${item.href}" class="${item.href === currentPage() ? "active" : ""}" data-badge-key="">${item.label}</a>`; if (ouv) ouv.insertAdjacentHTML("afterend", html); else drop.insertAdjacentHTML("beforeend", html); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(syncForbiddenNav, 400)); else setTimeout(syncForbiddenNav, 400);

// ---------------------------------------------------------------------------
// Rouages (2026-10-19) : dix petits rouages graves sont caches sur le
// site. Chacun porte une lettre (donnee par le serveur au clic). Rien ne dit
// ou ils menent… sauf peut-etre les pages perdues.
// ---------------------------------------------------------------------------
const Gears = {
  SPOTS: [
    { n: 1, page: "nouveautes.html", sel: "#patch-notes > :last-child" },
    { n: 2, page: "coffre.html", sel: "#museum-zone" },
    { n: 3, page: "jeux.html", sel: ".dig-site[data-depth='5']" },
    { n: 4, page: "jeux.html", sel: "#fish-scene[data-spot='deep']" },
    { n: 5, page: "404.html", sel: "#arg-board-host" },
    { n: 6, page: "mode.html", sel: "#main-content > .panel" },
    { n: 7, page: "jeux.html", sel: "#fish-aquarium-wrap[open]" },
    { n: 9, page: "communaute.html", sel: "#machine-room" },
    { n: 10, page: "jeux.html", sel: "#dino-dex-box[open]" }
  ],
  ROMAN: ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"],
  page() { return currentPage() === "" ? "index.html" : (document.getElementById("arg-board-host") ? "404.html" : currentPage()); },
  make(n) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "arg-gear";
    b.dataset.gear = String(n);
    b.setAttribute("aria-label", "Un rouage gravé");
    b.innerHTML = `<span class="arg-gear-ico" aria-hidden="true">&#9881;&#65039;</span><span class="arg-gear-n">${this.ROMAN[n - 1]}</span>`;
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this.take(n, b); });
    return b;
  },
  async take(n, el) {
    if (!Session.isLoggedIn()) { Toast.info("Un rouage gravé… mais il faut être connecté pour le garder."); return; }
    try {
      const r = await API.post("forbidden", { userId: Session.userId, action: "gear", n });
      el.classList.add("taken");
      if (typeof Sfx !== "undefined" && Sfx._tone) { Sfx._tone(520, 0, 0.08, "square", 0.04); Sfx._tone(780, 0.08, 0.12, "square", 0.04); }
      if (typeof Haptics !== "undefined") Haptics.buzz([15, 30, 15]);
      Toast.success(`&#9881;&#65039; Rouage gravé <strong>${r.roman}</strong> : la lettre <strong>« ${r.letter} »</strong>. (${r.found} / ${r.total})`);
      if (r.fresh && r.found === 1) setTimeout(() => Toast.info("Dix rouages, dix lettres. Les pages perdues savent les assembler…"), 1600);
      if (r.found === r.total && r.fresh) setTimeout(() => Toast.info("Les dix rouages tournent ensemble. Le mot qu’ils forment se réclame."), 1600);
    } catch (e) { /* rouage muet */ }
  },
  place() {
    const page = this.page();
    for (const s of this.SPOTS) {
      if (s.page !== page) continue;
      const host = document.querySelector(s.sel);
      if (!host || host.querySelector(".arg-gear")) continue;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.appendChild(this.make(s.n));
    }
  },
  // Code Konami sur l'accueil : un rouage tombe du ciel. Au clavier, ou au
  // doigt sur mobile (glisses haut, haut, bas, bas, gauche, droite, gauche,
  // droite, puis deux touchers).
  konami() {
    const SEQ = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    let i = 0;
    const drop = () => {
      if (document.querySelector(".arg-gear-fall")) return;
      const g = this.make(8);
      g.classList.add("arg-gear-fall");
      document.body.appendChild(g);
    };
    document.addEventListener("keydown", (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      i = k === SEQ[i] ? i + 1 : (k === SEQ[0] ? 1 : 0);
      if (i < SEQ.length) return;
      i = 0;
      drop();
    });
    const SWIPES = ["up", "up", "down", "down", "left", "right", "left", "right", "tap", "tap"];
    let j = 0, sx = 0, sy = 0, st = 0;
    document.addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
    document.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy, ad = Math.max(Math.abs(dx), Math.abs(dy));
      if (Date.now() - st > 900) { j = 0; return; }
      const g = ad < 12 ? "tap" : ad < 40 ? null : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      if (!g) return;
      j = g === SWIPES[j] ? j + 1 : (g === SWIPES[0] ? 1 : 0);
      if (j < SWIPES.length) return;
      j = 0;
      drop();
    }, { passive: true });
  },
  // Page 404 : le tableau ou les lettres trouvees prennent leur place.
  async board() {
    const host = document.getElementById("arg-board-host");
    if (!host || !Session.isLoggedIn()) return;
    let st;
    try { st = await API.post("forbidden", { userId: Session.userId, action: "status" }); } catch (e) { return; }
    if (!st.gears || !st.gears.length) return;
    const by = new Map(st.gears.map((g) => [g.n, g.letter]));
    host.insertAdjacentHTML("afterbegin", `<div class="arg-board"><p>Dix rouages, dix lettres. Le mot qu'ils forment est le nom d'une page qu'aucun menu ne montre.</p>
      <div class="arg-slots">${this.ROMAN.map((r, i) => `<span class="arg-slot ${by.has(i + 1) ? "on" : ""}"><b>${by.get(i + 1) || "?"}</b><small>${r}</small></span>`).join("")}</div></div>`);
  },
  init() {
    if (this.page() === "index.html") this.konami();
    this.board();
    if (!this.SPOTS.some((s) => s.page === this.page())) return;
    this.place();
    // Contenus charges plus tard (onglets, details ouverts, profondeur…).
    setInterval(() => this.place(), 1500);
  }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => Gears.init()); else Gears.init();

// ---------------------------------------------------------------------------
// Petits secrets du site (2026-10-19, api/src/native/secrets.js).
// ---------------------------------------------------------------------------
const SiteSecrets = {
  parisHour() { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).format(new Date())) % 24; },
  // Page 404 : une carte qui n'existe pas…
  ghost404() {
    const host = document.getElementById("arg-board-host");
    const hi = host && host.closest(".panel") ? host.closest(".panel").querySelector(".hero-highlight") : null;
    if (!hi) return;
    let n = 0, last = 0;
    hi.addEventListener("click", async () => {
      const t = Date.now();
      n = t - last < 1500 ? n + 1 : 1;
      last = t;
      hi.classList.remove("sx-blip"); void hi.offsetWidth; hi.classList.add("sx-blip");
      if (n < 7) return;
      n = 0;
      if (!Session.isLoggedIn()) return;
      try {
        const r = await API.post("secrets", { userId: Session.userId, action: "ghost404" });
        UnlockFx.show({ title: r.title, subtitle: "Elle n'aurait jamais dû exister.", cards: r.cards, tone: "ghost" });
      } catch (e) { if (e.code === "already_found") Toast.info("La page se souvient de toi."); }
    });
  },
  // De 3 h a 4 h : le site se deforme, une ombre traverse l'accueil.
  shadow() {
    if (this.parisHour() !== 3) return;
    document.documentElement.dataset.shadowHour = "1";
    if (currentPage() !== "index.html" || !Session.isLoggedIn()) return;
    const sh = document.createElement("button");
    sh.type = "button";
    sh.className = "sx-shadow";
    sh.setAttribute("aria-label", "Une ombre");
    sh.innerHTML = '<span class="sx-eye"></span><span class="sx-eye"></span>';
    document.body.appendChild(sh);
    sh.addEventListener("click", async () => {
      sh.disabled = true;
      try {
        const r = await API.post("secrets", { userId: Session.userId, action: "shadow" });
        sh.classList.add("caught");
        setTimeout(() => sh.remove(), 900);
        UnlockFx.show({ title: r.title, subtitle: "Il est tard. Tu aurais dû dormir.", rewards: r.rewards, tone: "shadow" });
      } catch (e) { sh.classList.add("caught"); setTimeout(() => sh.remove(), 900); }
    });
  },
  init() { this.ghost404(); this.shadow(); }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => SiteSecrets.init()); else SiteSecrets.init();

// ---------------------------------------------------------------------------
// La carte « Erreur 404 » glitche partout ou elle apparait (2026-10-19) : par
// moments, des eclats d'autres illustrations (tirees au hasard a chaque
// glitch) traversent la carte. Images fournies par GET /webhook/secret-card.
// ---------------------------------------------------------------------------
const GlitchCard = {
  data: null,
  KEY: "2gatcha_glitch404",
  async load() {
    try { const c = JSON.parse(sessionStorage.getItem(this.KEY) || "null"); if (c && Date.now() - c.at < 10 * 60000) { this.data = c.data; return; } } catch (e) { /* stockage indisponible */ }
    try { this.data = await API.get("secretCard"); } catch (e) { this.data = null; return; }
    try { sessionStorage.setItem(this.KEY, JSON.stringify({ at: Date.now(), data: this.data })); } catch (e) { /* stockage indisponible */ }
  },
  // Effet de l'image (cartes secretes, reglage SecretCardEffects) ou null.
  effectOf(img) {
    const effects = this.data.effects || [];
    const holder = img.closest("[data-card-id]");
    if (holder) { const e = effects.find((x) => String(x.cardId) === holder.dataset.cardId); return e ? e.effect : null; }
    let id = null;
    try { id = new URL(img.src, location.href).searchParams.get("id"); } catch (e) { return null; }
    if (!id) return null;
    // Sans identifiant de carte : l'image ne compte que si elle n'appartient qu'a cette carte.
    const e = effects.find((x) => x.uniqueImage && String(x.imageId) === id);
    return e ? e.effect : null;
  },
  scan() {
    if (!this.data) return;
    document.querySelectorAll('img[src*="id="]').forEach((img) => {
      if (img.dataset.gl404) return;
      const effect = this.effectOf(img);
      if (!effect) return;
      img.dataset.gl404 = "1";
      const host = img.parentElement;
      if (!host) return;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      if (effect !== "glitch") {
        // Fourrure (fur-brown, fur-black, fur-white) ou contour unique.
        host.classList.add("sfx-host", "sfx-" + effect.replace(/[^a-z0-9-]/g, ""));
        const layer = document.createElement("div");
        layer.className = "sfx-layer";
        layer.setAttribute("aria-hidden", "true");
        host.appendChild(layer);
        return;
      }
      host.classList.add("gl404-host");
      const fx = document.createElement("div");
      fx.className = "gl404";
      fx.setAttribute("aria-hidden", "true");
      fx.innerHTML = "<span></span><span></span><span></span>";
      host.appendChild(fx);
      this.loop(host, fx);
    });
  },
  loop(host, fx) {
    const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const others = (this.data.others || []).map((id) => API.imageUrl(id)).filter(Boolean);
    const tick = () => {
      if (!host.isConnected) return;
      if (others.length) {
        fx.querySelectorAll("span").forEach((s) => {
          const top = Math.random() * 80, h = 6 + Math.random() * 22;
          s.style.backgroundImage = `url("${others[Math.floor(Math.random() * others.length)]}")`;
          s.style.top = top + "%";
          s.style.height = h + "%";
          s.style.backgroundPosition = `${Math.random() * 100}% ${top}%`;
          s.style.transform = `translateX(${(Math.random() - 0.5) * 18}%)`;
        });
      }
      host.classList.add("gl404-on");
      setTimeout(() => host.classList.remove("gl404-on"), 140 + Math.random() * 260);
      setTimeout(tick, (reduced ? 4000 : 1100) + Math.random() * 2600);
    };
    setTimeout(tick, 400 + Math.random() * 1200);
  },
  async init() {
    await this.load();
    if (!this.data || (!this.data.imageId && !(this.data.effects || []).length)) return;
    this.scan();
    setInterval(() => this.scan(), 1500);
  }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => GlitchCard.init()); else GlitchCard.init();
