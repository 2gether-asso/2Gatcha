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

  const links = `<nav class="nav">${visibleNavItems().map((i) => `<a href="${i.href}" data-badge-key="${i.badgeKey || ""}">${i.label}</a>`).join("")}</nav>`;

  if (Session.isLoggedIn()) {
    const avatar = Session.discordAvatar
      ? `<img class="avatar" src="${Session.discordAvatar}" alt="" />`
      : "";
    el.innerHTML = `
      <div class="header-inner">
        <span class="brand">2Gatcha</span>
        ${links}
        <div class="user-box">
          ${avatar}
          <span id="header-booster-badge" class="booster-badge">
            <span class="icon">&#127183;</span><span>...</span>
          </span>
          <span id="header-stardust-badge" class="booster-badge stardust-badge">
            <span class="icon">&#10024;</span><span>...</span>
          </span>
          <span id="header-pseudo">${Session.pseudo}</span>
          <button id="edit-pseudo-btn" class="btn-ghost">Modifier</button>
          <button id="logout-btn" class="btn-ghost">Deconnexion</button>
        </div>
      </div>
    `;
    document.getElementById("logout-btn").addEventListener("click", () => {
      Session.clear();
      window.location.href = "index.html";
    });
    document.getElementById("edit-pseudo-btn").addEventListener("click", async () => {
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

document.addEventListener("DOMContentLoaded", renderHeader);
