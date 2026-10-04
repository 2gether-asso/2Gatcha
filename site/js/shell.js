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
  el.innerHTML = visibleNavItems().map((item) => `
    <a href="${item.href}" class="${item.href === page ? "active" : ""}" data-badge-key="${item.badgeKey || ""}" aria-label="${item.label}">
      <span class="bn-icon">${item.icon}</span>
      <span class="sr-only">${item.label}</span>
    </a>
  `).join("");
}

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
  document.querySelectorAll('[data-badge-key="trade"]').forEach((a) => {
    a.querySelectorAll(".nav-dot").forEach((d) => d.remove());
    if (pendingCount > 0) {
      const dot = document.createElement("span");
      dot.className = "nav-dot";
      dot.textContent = pendingCount > 9 ? "9+" : String(pendingCount);
      (a.querySelector(".bn-icon") || a).appendChild(dot);
    }
  });

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
    const [quests, weekly, levelRewards] = await Promise.all([
      API.getQuestStatus(Session.userId).catch(() => null),
      API.getWeeklyQuestStatus(Session.userId).catch(() => null),
      API.getLevelRewardsStatus(Session.userId).catch(() => null)
    ]);
    const rewardsCount = [quests?.canClaim, weekly?.canClaim, levelRewards?.hasPending].filter(Boolean).length;
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
          <div class="header-stats" title="Tes ressources">
            <span id="header-booster-badge" class="stat-chip" title="Boosters disponibles">
              <span class="icon">&#127183;</span><span class="count">...</span>
            </span>
            <span class="stat-divider" aria-hidden="true"></span>
            <span id="header-stardust-badge" class="stat-chip" title="Poussières d'étoile (craft/décraft)">
              <span class="icon">&#10024;</span><span class="count">...</span>
            </span>
            <span id="header-key-divider" class="stat-divider" aria-hidden="true" style="display:none;"></span>
            <span id="header-key-badge" class="stat-chip" title="Clefs secrètes (fouilles)" style="display:none;">
              <span class="icon">&#128273;</span><span class="count">0</span>
            </span>
          </div>
          <div class="global-search" id="global-search">
            <button type="button" class="global-search-trigger" id="global-search-trigger" aria-label="Recherche" title="Rechercher un joueur, une carte...">&#128269;</button>
            <div class="global-search-panel" id="global-search-panel">
              <input type="text" id="global-search-input" placeholder="Joueur, carte, page..." autocomplete="off" />
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
              <button id="edit-pseudo-btn" type="button">&#9998; Modifier le pseudo</button>
              <a id="view-profile-link" href="profile.html?pseudo=${encodeURIComponent(Session.pseudo || "")}">&#128100; Voir mon profil</a>
              <button id="copy-profile-link-btn" type="button">&#128279; Copier le lien de mon profil</button>
              <button id="mute-toggle-btn" type="button">${Sfx.muted ? "&#128264; Son coupe" : "&#128266; Son actif"}</button>
              <button id="theme-cycle-btn" type="button">&#127912; Changer de thème</button>
              <div class="menu-sep"></div>
              <button id="logout-btn" type="button">&#10162; Déconnexion</button>
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

    async function ensureSearchData() {
      if (searchDataLoaded) return;
      searchDataLoaded = true;
      try {
        const [usersRes, cardsRes] = await Promise.all([API.listUsers(), API.getCards()]);
        searchUsers = usersRes.users || [];
        searchCards = cardsRes.cards || [];
      } catch (e) { /* recherche degradee (pages seulement) si hors-ligne */ }
    }

    function renderSearchResults(query) {
      const q = query.trim().toLowerCase();
      if (!q) { searchResults.innerHTML = `<div class="global-search-hint">Tape un pseudo, un nom de carte...</div>`; return; }
      const players = searchUsers.filter((u) => (u.pseudo || "").toLowerCase().includes(q)).slice(0, 5);
      const cards = searchCards.filter((c) => (c.name || "").toLowerCase().includes(q)).slice(0, 5);
      const pages = visibleNavItems().filter((i) => i.label.toLowerCase().includes(q));
      const sections = [];
      if (players.length) {
        sections.push(`<div class="global-search-group">Joueurs</div>` + players.map((u) =>
          `<a class="global-search-item" href="profile.html?pseudo=${encodeURIComponent(u.pseudo)}">&#128100; ${u.pseudo}</a>`
        ).join(""));
      }
      if (cards.length) {
        sections.push(`<div class="global-search-group">Cartes</div>` + cards.map((c) =>
          `<a class="global-search-item" href="collection.html?cardId=${c.cardId}">&#127183; ${c.name}</a>`
        ).join(""));
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
    searchInput.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", (e) => {
      if (!searchEl.contains(e.target)) searchEl.classList.remove("open");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") searchEl.classList.remove("open");
    });
    document.getElementById("mute-toggle-btn").addEventListener("click", (e) => {
      Sfx.setMuted(!Sfx.muted);
      e.target.innerHTML = Sfx.muted ? "&#128264; Son coupe" : "&#128266; Son actif";
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
    let countEl = badge.querySelector(".count");
    if (!countEl) {
      badge.innerHTML = `<span class="icon">&#127183;</span><span class="count">...</span>`;
      countEl = badge.querySelector(".count");
    }
    bumpNumber(countEl, status.count);

    if (dustBadge) {
      let dustEl = dustBadge.querySelector(".count");
      if (!dustEl) {
        dustBadge.innerHTML = `<span class="icon">&#10024;</span><span class="count">...</span>`;
        dustEl = dustBadge.querySelector(".count");
      }
      bumpNumber(dustEl, status.stardust || 0);
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
// cartes (+ visuels d'extension), depuis la page d'accueil : le workflow n8n
// "get-image" renvoie desormais un Cache-Control longue duree (voir
// get-image.json), donc une image deja vue ici est servie par le cache du
// navigateur, sans nouvel appel n8n, quand l'utilisateur arrive ensuite sur
// la collection/l'ouverture/le journal. Petits lots + requestIdleCallback
// pour rester en arriere-plan : ne rivalise ni avec le chargement de la page
// ni avec les vrais appels n8n de l'utilisateur.
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
  const calls = [{ name: "siteBanner" }, { name: "unlockConfig" }];
  if (Session.isLoggedIn()) {
    const userId = Session.userId;
    const read = (name, action = "status") => ({ name, body: { userId, action } });
    calls.push(
      { name: "boosterStatus", query: { userId } },
      read("trade", "list"), read("quests"), read("weeklyQuests"), read("levelRewards"),
      read("vault"), read("bingo"), read("guessCard"), read("expedition"),
      { name: "eventCalendar" }, read("communityBoss"), read("guildChest"), read("blackMarket", "list")
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
