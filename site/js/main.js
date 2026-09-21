// Image grise affichee quand une carte n'a pas (encore) d'image en piece jointe.
const PLACEHOLDER_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="100%" height="100%" fill="#1f2247"/><text x="50%" y="50%" fill="#a7a9c9" font-family="sans-serif" font-size="18" text-anchor="middle">Pas d\'image</text></svg>'
  );

// Session basee sur la connexion Discord, partagee entre les pages.
const Session = {
  KEY_USER_ID: "2gatcha_userId",
  KEY_PSEUDO: "2gatcha_pseudo",
  KEY_DISCORD_ID: "2gatcha_discordId",
  KEY_DISCORD_USERNAME: "2gatcha_discordUsername",
  KEY_DISCORD_AVATAR: "2gatcha_discordAvatar",

  get userId() {
    return localStorage.getItem(this.KEY_USER_ID);
  },
  get pseudo() {
    return localStorage.getItem(this.KEY_PSEUDO);
  },
  get discordId() {
    return localStorage.getItem(this.KEY_DISCORD_ID);
  },
  get discordUsername() {
    return localStorage.getItem(this.KEY_DISCORD_USERNAME);
  },
  get discordAvatar() {
    return localStorage.getItem(this.KEY_DISCORD_AVATAR);
  },
  set(data) {
    localStorage.setItem(this.KEY_USER_ID, data.userId);
    localStorage.setItem(this.KEY_PSEUDO, data.pseudo || "");
    localStorage.setItem(this.KEY_DISCORD_ID, data.discordId || "");
    localStorage.setItem(this.KEY_DISCORD_USERNAME, data.discordUsername || "");
    localStorage.setItem(this.KEY_DISCORD_AVATAR, data.discordAvatar || "");
  },
  setPseudo(pseudo) {
    localStorage.setItem(this.KEY_PSEUDO, pseudo);
  },
  clear() {
    localStorage.removeItem(this.KEY_USER_ID);
    localStorage.removeItem(this.KEY_PSEUDO);
    localStorage.removeItem(this.KEY_DISCORD_ID);
    localStorage.removeItem(this.KEY_DISCORD_USERNAME);
    localStorage.removeItem(this.KEY_DISCORD_AVATAR);
  },
  isLoggedIn() {
    return !!this.userId;
  },
  isAdmin() {
    return (window.APP_CONFIG.adminDiscordIds || []).includes(this.discordId);
  }
};

// ---------------------------------------------------------------------------
// Toasts : notifications courtes non-bloquantes (succes / erreur / info).
// ---------------------------------------------------------------------------
const Toast = {
  _stack() {
    let el = document.querySelector(".toast-stack");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast-stack";
      document.body.appendChild(el);
    }
    return el;
  },
  show(message, type = "info", duration = 3800) {
    const icons = { success: "&#10003;", error: "&#9888;", info: "&#10024;" };
    const stack = this._stack();
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add("hide");
      setTimeout(() => el.remove(), 250);
    }, duration);
  },
  success(msg) { this.show(msg, "success"); },
  error(msg) { this.show(msg, "error"); },
  info(msg) { this.show(msg, "info"); }
};

// Petite icone distinctive par rarete (en plus de la couleur, pour ne pas
// reposer uniquement sur la teinte).
const RARITY_ICONS = { commune: "&#9679;", rare: "&#9670;", epique: "&#9733;", legendaire: "&#128081;" };
function rarityIcon(key) {
  return RARITY_ICONS[key] || RARITY_ICONS.commune;
}

// ---------------------------------------------------------------------------
// Barre de chargement fine en haut de page, pilotee par API.get/post.
// ---------------------------------------------------------------------------
const TopLoadingBar = {
  _count: 0,
  _el() {
    let el = document.querySelector(".top-loading-bar");
    if (!el) {
      el = document.createElement("div");
      el.className = "top-loading-bar";
      document.body.appendChild(el);
    }
    return el;
  },
  start() {
    this._count++;
    const el = this._el();
    el.classList.remove("done");
    requestAnimationFrame(() => { el.style.width = "75%"; });
  },
  stop() {
    this._count = Math.max(0, this._count - 1);
    if (this._count > 0) return;
    const el = this._el();
    el.classList.add("done");
    setTimeout(() => { el.style.width = "0%"; }, 250);
  }
};

// ---------------------------------------------------------------------------
// Halo/curseur desktop : suit la souris avec un leger amorti (pointeur fin
// uniquement, jamais sur tactile).
// ---------------------------------------------------------------------------
function initCursorGlow() {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const el = document.createElement("div");
  el.className = "cursor-glow";
  document.body.appendChild(el);
  let tx = 0, ty = 0, cx = 0, cy = 0, active = false;
  document.addEventListener("mousemove", (e) => {
    tx = e.clientX; ty = e.clientY;
    if (!active) { active = true; el.classList.add("active"); cx = tx; cy = ty; }
  });
  document.addEventListener("mouseleave", () => { active = false; el.classList.remove("active"); });
  (function raf() {
    cx += (tx - cx) * 0.08;
    cy += (ty - cy) * 0.08;
    el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    requestAnimationFrame(raf);
  })();
}

function initGrainLayer() {
  const el = document.createElement("div");
  el.className = "grain-layer";
  document.body.appendChild(el);
}

// ---------------------------------------------------------------------------
// Effets de particules/energie a la revelation d'une carte, intensite
// proportionnelle a la rarete, couleur = celle de la rarete. Le calque dedie
// a un z-index superieur au modal plein ecran d'ouverture (400) et a son
// flash legendaire (410) : les effets doivent toujours passer PAR-DESSUS.
// ---------------------------------------------------------------------------
const RARITY_PARTICLE_COUNTS = { commune: 5, rare: 12, epique: 24, legendaire: 42 };
const RARITY_CONFETTI = {
  commune: { particleCount: 0, spread: 0 },
  rare: { particleCount: 45, spread: 65 },
  epique: { particleCount: 80, spread: 90 },
  legendaire: { particleCount: 150, spread: 120 }
};

function getParticleLayer() {
  let el = document.querySelector(".rarity-particle-layer");
  if (!el) {
    el = document.createElement("div");
    el.className = "rarity-particle-layer";
    document.body.appendChild(el);
  }
  return el;
}

function spawnRarityBurst(key, colorHex, originEl) {
  const rarityKey = key || "commune";
  const color = colorHex || "#9aa0b4";
  const count = RARITY_PARTICLE_COUNTS[rarityKey] ?? RARITY_PARTICLE_COUNTS.commune;
  const rect = originEl ? originEl.getBoundingClientRect() : null;
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const maxSize = rarityKey === "legendaire" ? 22 : rarityKey === "epique" ? 16 : rarityKey === "rare" ? 12 : 8;
  const maxDist = 70 + count * 2.2;

  const layer = getParticleLayer();
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = "rarity-particle";
    p.textContent = Math.random() > 0.5 ? "✦" : "✧";
    const angle = Math.random() * Math.PI * 2;
    const dist = maxDist * (0.5 + Math.random() * 0.5);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const size = 8 + Math.random() * maxSize;
    p.style.left = cx + "px";
    p.style.top = cy + "px";
    p.style.color = color;
    p.style.fontSize = size + "px";
    p.style.setProperty("--dx", dx + "px");
    p.style.setProperty("--dy", dy + "px");
    p.style.animationDuration = (0.6 + Math.random() * 0.5) + "s";
    p.style.animationDelay = (Math.random() * 0.15) + "s";
    layer.appendChild(p);
    setTimeout(() => p.remove(), 1400);
  }

  const conf = RARITY_CONFETTI[rarityKey] || RARITY_CONFETTI.commune;
  if (conf.particleCount && typeof confetti === "function") {
    const origin = { x: cx / window.innerWidth, y: cy / window.innerHeight };
    confetti({ particleCount: conf.particleCount, spread: conf.spread, origin, colors: [color, "#ffffff"] });
    if (rarityKey === "legendaire") {
      setTimeout(() => confetti({ particleCount: 90, spread: 140, origin: { x: origin.x, y: Math.max(0, origin.y - 0.1) }, colors: [color, "#ffd166", "#ffffff"] }), 220);
    }
  }
}

// Echap ferme la modal la plus recente ouverte (zoom carte, ouverture de
// booster si elle n'est pas en train de jouer une animation bloquante).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const cardModal = document.querySelector(".card-modal-overlay");
  if (cardModal) { cardModal.remove(); syncScrollLock(); return; }
  const packModal = document.getElementById("pack-modal-overlay");
  // `isBusy` est une variable globale declaree dans opening.js (script
  // classique, pas un module : partage le meme scope global). `typeof` sur
  // un identifiant jamais declare ne plante pas, contrairement a `isBusy`
  // en acces direct sur une page qui ne charge pas opening.js.
  if (packModal && !packModal.hidden && typeof isBusy !== "undefined" && !isBusy) {
    packModal.hidden = true;
    syncScrollLock();
  }
});

// ---------------------------------------------------------------------------
// Verrouillage du scroll de la page pendant qu'une modale plein ecran est
// ouverte (zoom de carte, ouverture de booster) : sans ca, la page derriere
// continue de defiler sous la modale, ce qui est deroutant. On resynchronise
// a chaque ouverture/fermeture plutot que de compter un simple booleen, pour
// rester correct meme si une modale est fermee par un autre chemin (Echap,
// clic sur l'overlay, fin d'animation...).
function syncScrollLock() {
  const cardModalOpen = !!document.querySelector(".card-modal-overlay");
  const packModal = document.getElementById("pack-modal-overlay");
  const packModalOpen = !!(packModal && !packModal.hidden);
  document.documentElement.classList.toggle("scroll-locked", cardModalOpen || packModalOpen);
}

// Anime un changement de valeur numerique (badge boosters, stats...) avec un
// petit "bump" au lieu d'un saut sec.
function bumpNumber(el, newValue) {
  const prev = el.textContent.trim();
  el.textContent = newValue;
  if (prev !== "" && prev !== String(newValue) && prev !== "...") {
    el.classList.remove("count-bump");
    void el.offsetWidth; // relance l'animation meme si la classe etait deja posee
    el.classList.add("count-bump");
  }
}

const NAV_ITEMS = [
  { href: "index.html", label: "Accueil", icon: "&#127968;", auth: false },
  { href: "ouverture.html", label: "Boosters", icon: "&#127873;", auth: false },
  { href: "collection.html", label: "Collection", icon: "&#128218;", auth: false },
  { href: "craft.html", label: "Craft", icon: "&#10024;", auth: true },
  { href: "redeem.html", label: "Code", icon: "&#127915;", auth: true },
  { href: "trade.html", label: "Echanges", icon: "&#128260;", auth: true, badgeKey: "trade" },
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
  el.innerHTML = visibleNavItems().map((item) => `
    <a href="${item.href}" class="${item.href === page ? "active" : ""}" data-badge-key="${item.badgeKey || ""}">
      <span class="bn-icon">${item.icon}</span>
      <span>${item.label}</span>
    </a>
  `).join("");
}

// Petite pastille rouge sur l'onglet Echanges (nav du bas + nav du haut)
// quand au moins un echange entrant est en attente de reponse.
async function loadNavBadges() {
  if (!Session.isLoggedIn()) return;
  const cached = API._cacheGet("2gatcha_cache_pending_trades", 45 * 1000);
  let pendingCount = cached;
  if (pendingCount == null) {
    try {
      const res = await API.listTrades(Session.userId);
      pendingCount = (res.trades || []).filter((t) => t.direction === "incoming" && t.status === "pending").length;
      API._cacheSet("2gatcha_cache_pending_trades", pendingCount);

      // Notification en jeu : signale une nouvelle proposition recue depuis
      // la derniere visite, sauf sur la page d'echanges elle-meme (deja
      // sous les yeux de l'utilisateur).
      const lastSeenKey = "2gatcha_last_seen_pending_trades";
      const lastSeen = Number(localStorage.getItem(lastSeenKey) || 0);
      if (pendingCount > lastSeen && currentPage() !== "trade.html") {
        Toast.info(`Nouvelle proposition d'echange recue ! (${pendingCount} en attente)`);
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
}

function renderHeader() {
  renderBottomNav();

  const el = document.getElementById("site-header");
  if (!el) return;

  const page = currentPage();
  const links = `<nav class="nav">${visibleNavItems().map((i) => `<a href="${i.href}" class="${i.href === page ? "active" : ""}" data-badge-key="${i.badgeKey || ""}">${i.label}</a>`).join("")}</nav>`;

  if (Session.isLoggedIn()) {
    const avatar = Session.discordAvatar
      ? `<img class="avatar" src="${Session.discordAvatar}" alt="" />`
      : "";
    el.innerHTML = `
      <div class="header-inner">
        <span class="brand">2Gatcha</span>
        ${links}
        <div class="user-box">
          <span id="header-booster-badge" class="booster-badge" title="Boosters disponibles">
            <span class="icon">&#127183;</span><span>...</span>
          </span>
          <span id="header-stardust-badge" class="booster-badge stardust-badge" title="Poussieres d'etoile (craft/decraft)">
            <span class="icon">&#10024;</span><span>...</span>
          </span>
          <div class="user-menu" id="user-menu">
            <button type="button" class="user-menu-trigger" id="user-menu-trigger">
              ${avatar}
              <span id="header-pseudo">${Session.pseudo}</span>
              <span class="caret">&#9660;</span>
            </button>
            <div class="user-menu-dropdown" id="user-menu-dropdown">
              <button id="edit-pseudo-btn" type="button">&#9998; Modifier le pseudo</button>
              <div class="menu-sep"></div>
              <button id="logout-btn" type="button">&#10162; Deconnexion</button>
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
        Toast.success("Pseudo mis a jour !");
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

async function loadHeaderBoosterBadge() {
  const badge = document.getElementById("header-booster-badge");
  const dustBadge = document.getElementById("header-stardust-badge");
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
  } catch (e) {
    badge.innerHTML = `<span class="icon">&#127183;</span><span>?</span>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderHeader();
  initGrainLayer();
  initCursorGlow();
});
