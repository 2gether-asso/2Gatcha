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
      calendar: { active: events.length > 0, sig: events.map((e) => e.label + "@" + (e.startsAt || "")).join("|") },
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
  { href: "collection.html", label: "Ma collection", icon: "&#128218;", auth: false, group: "collection", groupLabel: "Collection" },
  // Craft / decraft : modes de la page collection depuis la fusion (2026-10-04).
  { href: "collection.html#decrafter", label: "Craft & décraft", icon: "&#10024;", auth: true, group: "collection" },
  { href: "coffre.html", label: "Coffre-fort perso", icon: "&#128274;", auth: true, group: "collection" },
  { href: "boutique.html", label: "Boutique", icon: "&#128717;&#65039;", auth: true, group: "collection" },
  { href: "stats.html", label: "Mes statistiques", icon: "&#128202;", auth: true, group: "collection" },
  { href: "communaute.html", label: "Communauté", icon: "&#127758;", auth: true, badgeKey: "communaute" },
  { href: "jeux.html", label: "Jeux", icon: "&#127918;", auth: true, badgeKey: "jeux" },
  { href: "trade.html", label: "Échanges", icon: "&#128260;", auth: true, badgeKey: "trade" },
  { href: "admin.html", label: "Admin", icon: "&#128736;", auth: "admin" }
];

function currentPage() {
  return (window.location.pathname.split("/").pop() || "index.html");
}

function visibleNavItems() {
  return NAV_ITEMS.filter((item) => {
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
const BN_SHORT = { "index.html": "Accueil", "ouverture.html": "Ouvrir", "collection.html": "Collection", "jeux.html": "Jeux", "communaute.html": "Communauté", "trade.html": "Échanges", "coffre.html": "Coffre-fort", "boutique.html": "Boutique", "redeem.html": "Code", "craft.html": "Atelier", "admin.html": "Admin", "stats.html": "Stats" };

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
    const [quests, weekly, levelRewards, streak, sets, season, challenges, goal, themes] = await Promise.all([
      API.getQuestStatus(uid).catch(() => null),
      API.getWeeklyQuestStatus(uid).catch(() => null),
      API.getLevelRewardsStatus(uid).catch(() => null),
      API.getLoginStreak(uid).catch(() => null),
      API.getSetRewards(uid).catch(() => null),
      API.getSeason(uid).catch(() => null),
      API.challenges(uid).catch(() => null),
      API.communityGoal(uid).catch(() => null),
      API.themes(uid).catch(() => null)
    ]);
    const items = [];
    if (streak?.canClaim) items.push({ key: "streak", icon: "&#128293;", label: `Cadeau de connexion (jour ${streak.day || ""})`, claim: () => API.claimLoginStreak(uid) });
    if (quests?.canClaim) items.push({ key: "quests", icon: "&#9989;", label: "Quêtes du jour terminées", claim: () => API.claimQuestReward(uid) });
    if (weekly?.canClaim) items.push({ key: "weekly", icon: "&#128197;", label: "Quêtes de la semaine terminées", claim: () => API.claimWeeklyQuestReward(uid) });
    if (levelRewards?.hasPending) items.push({ key: "level", icon: "&#11088;", label: "Récompenses de niveau", claim: () => API.claimLevelRewards(uid) });
    if (season?.claimable > 0) {
      const tierN = season.tierClaimable != null ? season.tierClaimable : season.claimable;
      items.push({ key: "season", icon: "&#127942;", label: tierN ? `Saison : ${tierN} palier${tierN > 1 ? "s" : ""} à récupérer` : `Saison terminée : bonus de ${season.claimable * (season.bonus?.dustPerTier || 0)} poussières`, claim: () => API.claimSeason(uid) });
    }
    if (season?.chest?.previous?.claimable) items.push({ key: "season-chest", icon: "&#129520;", label: `Coffre de la saison ${season.chest.previous.label} à ouvrir`, claim: () => API.claimSeasonChest(uid) });
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
      try { await it.claim(); done.push(it); } catch (e) { failed.push(it); }
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
  document.querySelectorAll('[data-badge-key="trade"]').forEach((a) => {
    a.querySelectorAll(".nav-dot").forEach((d) => d.remove());
    if (pendingCount > 0 || wishCount > 0) {
      const dot = document.createElement("span");
      dot.className = "nav-dot" + (pendingCount ? "" : " nav-dot-wish");
      dot.textContent = pendingCount ? (pendingCount > 9 ? "9+" : String(pendingCount)) : "★";
      dot.title = pendingCount ? "Échanges en attente" : `${wishCount} carte${wishCount > 1 ? "s" : ""} de ta liste de souhaits disponible${wishCount > 1 ? "s" : ""}`;
      (a.querySelector(".bn-icon") || a).appendChild(dot);
    }
  });
  syncBottomMoreDot();

  // Meme principe pour le nombre de boosters disponibles : un rappel visuel
  // sur l'onglet, pas seulement le badge du header (moins visible sur
  // mobile, ou le header se replie).
  try {
    const status = await API.getBoosterStatus(Session.userId);
    const boosterCount = status.count || 0;
    document.querySelectorAll('[data-badge-key="boosters"]').forEach((a) => {
      a.querySelectorAll(".nav-dot").forEach((d) => d.remove());
      if (boosterCount > 0) {
        const dot = document.createElement("span");
        dot.className = "nav-dot";
        dot.textContent = boosterCount > 9 ? "9+" : String(boosterCount);
        (a.querySelector(".bn-icon") || a).appendChild(dot);
      }
    });
  } catch (e) { /* pas grave, juste un rappel visuel */ }

  // Pastilles "quelque chose a reclamer" (2026-09-30) : jusqu'ici seuls les
  // echanges/boosters avaient un rappel sur la nav, une quete/un palier de
  // niveau termine ou un coffre-fort pret ne se decouvraient qu'en visitant
  // la page par hasard. Cache plus longtemps que trades/boosters (ces etats
  // bougent moins souvent) pour ne pas multiplier les requetes en arriere-
  // plan a chaque changement de page.
  try {
    const rewardsCount = (await RewardsCenter.collect()).items.length;
    document.querySelectorAll('[data-badge-key="rewards"]').forEach((a) => {
      a.querySelectorAll(".nav-dot").forEach((d) => d.remove());
      if (rewardsCount > 0) {
        const dot = document.createElement("span");
        dot.className = "nav-dot";
        dot.textContent = String(rewardsCount);
        (a.querySelector(".bn-icon") || a).appendChild(dot);
      }
    });
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
    document.querySelectorAll('[data-badge-key="jeux"]').forEach((a) => {
      a.querySelectorAll(".nav-dot").forEach((d) => d.remove());
      if (jeuxCount > 0) {
        const dot = document.createElement("span");
        dot.className = "nav-dot";
        dot.textContent = String(jeuxCount);
        (a.querySelector(".bn-icon") || a).appendChild(dot);
      }
    });

    try {
      const signals = await CommunauteSignals.fetch();
      const unseen = CommunauteSignals.unseenCount(signals);
      document.querySelectorAll('[data-badge-key="communaute"]').forEach((a) => {
        a.querySelectorAll(".nav-dot").forEach((d) => d.remove());
        if (unseen > 0) {
          const dot = document.createElement("span");
          dot.className = "nav-dot";
          dot.textContent = String(unseen);
          (a.querySelector(".bn-icon") || a).appendChild(dot);
        }
      });
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
        <span class="brand">2Gatcha</span>
        ${links}
        <div class="user-box">
          <div class="inventory" id="inventory">
          <button type="button" class="header-stats" id="inventory-trigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="inventory-panel" title="Ouvrir l'inventaire">
            <span id="header-booster-badge" class="stat-chip" title="Boosters disponibles">
              <span class="icon">&#127183;</span><span class="count">...</span>
            </span>
            <span class="stat-divider" aria-hidden="true"></span>
            <span id="header-stardust-badge" class="stat-chip" title="Poussières d'étoile (craft/décraft)">
              <span class="icon">&#10024;</span><span class="count">...</span>
            </span>
            <span id="header-key-divider" class="stat-divider" aria-hidden="true" style="display:none;"></span>
            <span class="stats-extra" id="header-stats-extra">
            <span id="header-key-badge" class="stat-chip" title="Clefs secrètes (fouilles)" style="display:none;">
              <span class="icon">&#128273;</span><span class="count">0</span>
            </span>
            <span id="header-worm-badge" class="stat-chip stat-chip-worm" title="Vers de terre" style="display:none;">
              <span class="icon">&#129713;</span><span class="count">0</span>
            </span>
            <span id="header-part-badge" class="stat-chip stat-chip-part" title="Pièces détachées" style="display:none;">
              <span class="icon">&#128297;</span><span class="count">0</span>
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
              <input type="text" id="global-search-input" placeholder="Joueur, carte, page..." autocomplete="off" />
              <div class="gs-filters" id="gs-filters">
                <select id="gs-rarity" aria-label="Rareté"><option value="">Toutes raretés</option></select>
                <select id="gs-finish" aria-label="Finition"><option value="">Toutes finitions</option><option value="normal">Normale</option><option value="holo">Holo</option><option value="gold">Doré</option><option value="ghost">Ghost</option><option value="diamond">Diamant</option><option value="rainbow">Arc-en-ciel</option></select>
                <select id="gs-quality" aria-label="État"><option value="">Tous états</option><option value="damaged">Abîmé</option><option value="worn">Usé</option><option value="good">Bon état</option><option value="mint">Parfait état</option></select>
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
              <span id="header-pseudo">${Session.pseudo}</span>
              <span class="caret">&#9660;</span>
            </button>
            <div class="user-menu-dropdown" id="user-menu-dropdown">
              <div class="menu-head">${avatar}<span><strong>${Session.pseudo}</strong><small>Mon compte</small></span></div>
              <a id="view-profile-link" href="profile.html?pseudo=${encodeURIComponent(Session.pseudo || "")}"><span class="mi">&#128100;</span> Mon profil</a>
              <a href="profile.html?pseudo=${encodeURIComponent(Session.pseudo || "")}#talents"><span class="mi">&#127795;</span> Talents et maîtrises</a>
              <a href="stats.html"><span class="mi">&#128202;</span> Mes statistiques</a>
              <a href="boutique.html#cosmetiques"><span class="mi">&#127912;</span> Titres, cadres, couleurs</a>
              <div class="menu-sep"></div>
              <button id="edit-pseudo-btn" type="button"><span class="mi">&#9998;</span> Modifier le pseudo</button>
              <button id="copy-profile-link-btn" type="button"><span class="mi">&#128279;</span> Copier le lien de mon profil</button>
              <button id="mute-toggle-btn" type="button">${Sfx.muted ? '<span class="mi">&#128264;</span> Son coupé' : '<span class="mi">&#128266;</span> Son actif'}</button>
              <button id="theme-cycle-btn" type="button"><span class="mi">&#127763;</span> Changer de thème</button>
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
      const next = window.prompt("Nouveau pseudo :", Session.pseudo || "");
      if (!next || !next.trim() || next.trim() === Session.pseudo) return;
      try {
        const res = await API.updatePseudo(Session.userId, next.trim());
        Session.setPseudo(res.pseudo);
        document.getElementById("header-pseudo").textContent = res.pseudo;
        Toast.success("Pseudo mis à jour !");
      } catch (e) {
        Toast.error("Impossible de changer le pseudo (" + e.message + ")");
      }
    });
    loadHeaderBoosterBadge();
    loadNavBadges();
  } else {
    el.innerHTML = `
      <div class="header-inner">
        <span class="brand">2Gatcha</span>
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

// Week-end evenement (api/src/native/events.js) : bandeau festif tant qu'il dure.
async function loadEventBanner() {
  const el = document.getElementById("site-header");
  if (!el) return;
  try {
    const ev = await API.getEventStatus();
    if (!ev || !ev.active) return;
    const perks = [];
    if (ev.dustMultiplier > 1) perks.push(`poussières x${ev.dustMultiplier}`);
    if (ev.finishMultiplier > 1) perks.push(`finitions x${ev.finishMultiplier}`);
    const until = ev.endsAt ? " · jusqu'au " + new Date(ev.endsAt * 1000).toLocaleString("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" }) : "";
    const label = String(ev.label || "Événement").replace(/[<>&"]/g, "");
    el.insertAdjacentHTML("afterbegin", `<div class="beta-banner banner-event">&#127881; <strong>${label}</strong>${perks.length ? " : " + perks.join(", ") : ""}${until}</div>`);
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
        try { await API.setPushPrefs(Session.userId, values); Toast.info("Préférences de notifications enregistrées."); } catch (e) { Toast.error("Erreur. (" + e.message + ")"); }
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
function showLevelUpBanner(newLevel) {
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
  if (prevLevel && newLevel > prevLevel) {
    showLevelUpBanner(newLevel);
    if (typeof confetti === "function") confetti({ particleCount: 160, spread: 120, origin: { y: 0.3 } });
  }
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
          keyBadge.title = `${keys} / ${vault.keysRequired} clefs vers le coffre-fort`;
          keyEl.textContent = `${keys}/${vault.keysRequired}`;
        } else {
          keyBadge.title = "Clefs secrètes (fouilles)";
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
      read("challenges"), read("communityGoal"), read("themes"), read("wishlistAlerts")
    );
  }
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
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    if (this.el) this.el.remove();
    const el = document.createElement("div");
    el.className = "player-card-pop";
    el.innerHTML = `
      <div class="pcp-head">
        ${data.avatar ? `<img class="pcp-avatar ${data.decor && data.decor.frame ? "decor-" + data.decor.frame : ""}" src="${data.avatar}" alt="" />` : ""}
        <div><strong class="${data.decor && data.decor.color ? "decor-" + data.decor.color : ""}">${esc(data.pseudo)}</strong>
          ${data.decor && data.decor.title ? `<small class="decor-title">${esc(data.decor.title)}</small>` : ""}
          <small>Niv. ${data.level} · ${data.rank.icon} ${esc(data.rank.label)} · &#127907; ${data.skills.fishing} · &#9935;&#65039; ${data.skills.dig}</small></div>
      </div>
      ${data.showcase.length ? `<div class="pcp-showcase">${data.showcase.map((c) => `<img src="${API.imageUrl(c.imageId)}" alt="${esc(c.name)}" title="${esc(c.name)}" style="--r:${esc(c.rarity?.colorHex || "#888")}" loading="lazy" />`).join("")}</div>` : '<small class="muted">Vitrine vide</small>'}`;
    document.body.appendChild(el);
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
    const [chests, garden, dig, shop] = await Promise.allSettled([API.chests(uid, "status"), API.garden(uid), API.getDigStatus(uid), API.shop ? API.shop(uid) : Promise.reject()]);
    const v = (r) => (r.status === "fulfilled" ? r.value : null);
    const d = v(dig);
    this.extra = {
      chests: v(chests)?.chests, goldBait: v(garden)?.goldBait,
      bones: d ? (d.bones ?? d.dog?.bones ?? d.kennel?.bones) : undefined,
      luck: v(shop)?.luckCharges, xpUntil: v(shop)?.xpBoostUntil
    };
    if (this.isOpen()) this.render();
  },
  render() {
    const st = window.__hdrStatus || {};
    const x = this.extra || {};
    const n = (v) => (v == null ? null : Number(v) || 0);
    const items = [
      { icon: "&#127183;", name: "Boosters", count: n(st.count), desc: "5 cartes de l'extension de ton choix.", url: "ouverture.html", cta: "Ouvrir" },
      { icon: "&#10024;", name: "Poussières d'étoile", count: n(st.stardust), desc: "Crafter des cartes, la boutique, les enchères.", url: "boutique.html", cta: "Dépenser" },
      { icon: "&#128273;", name: "Clés", count: n(st.keys), desc: "Ouvrent les coffres et le grand coffre-fort.", url: "ouverture.html", cta: "Utiliser" },
      { icon: "&#129520;", name: "Coffres", count: n(x.chests), desc: "S'ouvrent avec une clé : poussières, cartes, boosters.", url: "ouverture.html", cta: "Ouvrir" },
      { icon: "&#129713;", name: "Vers de terre", count: n(st.worms), desc: "Un par lancer de pêche.", url: "jeux.html#peche", cta: "Pêcher" },
      { icon: "&#129693;", name: "Appâts dorés", count: n(x.goldBait), desc: "Aucune prise vide et prises rares ×2,5.", url: "jeux.html#peche", cta: "Pêcher" },
      { icon: "&#129460;", name: "Os", count: n(x.bones), desc: "Envoient le chien creuser pour toi.", url: "jeux.html#fouille", cta: "Chenil" },
      { icon: "&#128297;", name: "Pièces détachées", count: n(st.spareParts), desc: "Remplacent un exemplaire dans une fusion ou une restauration.", url: "collection.html#finitions", cta: "Atelier" },
      { icon: "&#127915;", name: "Tickets Unique", count: n(st.uniqueTickets), desc: "Une carte Unique au choix au Comptoir.", url: "coffre.html#comptoir", cta: "Comptoir" },
      { icon: "&#129514;", name: "Élixir de chance", count: n(x.luck), desc: "Boosters restants avec +5 pts de finition spéciale.", url: "ouverture.html", cta: "Ouvrir" }
    ];
    const boost = x.xpUntil && x.xpUntil > Date.now() / 1000 ? Math.ceil((x.xpUntil - Date.now() / 1000) / 60) : 0;
    const shown = items.filter((i) => i.count == null ? false : i.count > 0 || ["Boosters", "Poussières d'étoile"].includes(i.name));
    const empty = items.filter((i) => i.count === 0 && !["Boosters", "Poussières d'étoile"].includes(i.name));
    const fmt = (c) => Number(c).toLocaleString("fr-FR");
    document.getElementById("inventory-panel").innerHTML = `
      <div class="inv-head"><strong>&#127890; Inventaire</strong><a href="boutique.html" class="inv-shop">&#128717;&#65039; Boutique</a></div>
      ${boost ? `<div class="inv-boost">&#128216; XP ×2 encore ${boost} min</div>` : ""}
      <ul class="inv-list">${shown.map((i) => `<li><a href="${i.url}"><span class="inv-icon" aria-hidden="true">${i.icon}</span><span class="inv-body"><strong>${i.name}</strong><small>${i.desc}</small></span><span class="inv-count">${fmt(i.count)}</span><span class="inv-cta">${i.cta} &#8250;</span></a></li>`).join("")}</ul>
      ${empty.length ? `<p class="inv-empty">Pas encore : ${empty.map((i) => `<span title="${i.desc}">${i.icon} ${i.name}</span>`).join(" · ")}</p>` : ""}
      ${Treasure.state && Treasure.state.enabled ? `<p class="inv-treasure">&#129517; Course aux trésors : <strong>${Treasure.state.found}/${Treasure.state.total}</strong> indices cette semaine${Treasure.state.found < Treasure.state.total ? ` · cachés sur : ${Treasure.state.clues.filter((c) => !c.found).map((c) => c.label).join(", ")}` : " · bravo !"}</p>` : ""}
      ${this.extra ? "" : '<p class="inv-empty">Chargement des coffres, appâts et os…</p>'}`;
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
    b.innerHTML = "&#129517;";
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
