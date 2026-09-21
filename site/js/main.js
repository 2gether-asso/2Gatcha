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

function renderHeader() {
  const el = document.getElementById("site-header");
  if (!el) return;

  const navLinks = [
    `<a href="index.html">Accueil</a>`,
    `<a href="ouverture.html">Ouvrir un booster</a>`,
    `<a href="collection.html">Ma collection</a>`
  ];

  if (Session.isLoggedIn()) {
    navLinks.push(`<a href="redeem.html">Reclamer un code</a>`);
    navLinks.push(`<a href="trade.html">Echanges</a>`);
    if (Session.isAdmin()) navLinks.push(`<a href="admin.html">Admin</a>`);
  }

  const links = `<nav class="nav">${navLinks.join("")}</nav>`;

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
      } catch (e) {
        window.alert("Impossible de changer le pseudo (" + e.message + ")");
      }
    });
    loadHeaderBoosterBadge();
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
  if (!badge) return;
  try {
    const status = await API.getBoosterStatus(Session.userId);
    badge.innerHTML = `<span class="icon">&#127183;</span><span>${status.count}</span>`;
  } catch (e) {
    badge.innerHTML = `<span class="icon">&#127183;</span><span>?</span>`;
  }
}

document.addEventListener("DOMContentLoaded", renderHeader);
