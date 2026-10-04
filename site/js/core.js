// Socle commun a toutes les pages (ex-main.js, decoupe 2026-10-04).
// Themes de couleur, paliers de deblocage par niveau (FEATURE_UNLOCK_LEVEL...),
// niveau connu du joueur et Session (joueur connecte, stocke en localStorage).
// Ordre de chargement dans chaque page : config.js, api.js, core.js, ui.js,
// shell.js, puis le script de la page.

// ---------------------------------------------------------------------------
// Themes de couleur : purement cosmetique, debloques par niveau de profil
// (voir Users.XP). Applique via [data-theme] sur <html>, qui redefinit les
// variables de :root (voir style.css) - aucune regle ailleurs dans la
// feuille de style n'a besoin d'etre touchee, tout passe deja par var(...).
// Sauvegarde/lecture en localStorage uniquement (preference d'affichage
// pure, jamais lue par le serveur).
// ---------------------------------------------------------------------------
const THEME_ORDER = ["default", "monochrome", "sepia", "cyberpunk"];
const THEME_LABELS = { default: "Nébuleuse (défaut)", monochrome: "Monochrome", sepia: "Sépia", cyberpunk: "Cyberpunk" };
// Valeurs par defaut (utilisees tant que loadUnlockConfig() n'a pas encore
// repondu, ou si l'admin n'a jamais touche a la config) - mutees en place
// (Object.assign, jamais reassignees) par loadUnlockConfig() une fois la
// vraie config recuperee, pour que toute reference existante (cycleTheme,
// craft.js, collection.js, trade.js) voie automatiquement la mise a jour.
const THEME_UNLOCK_LEVEL = { default: 1, monochrome: 3, sepia: 5, cyberpunk: 8 };
let knownProfileLevel = 1;

// ---------------------------------------------------------------------------
// Progression par niveaux : au-dela du simple booster bonus, les premiers
// niveaux debloquent de nouveaux systemes de jeu, un a la fois, plutot que
// de tout donner d'un coup a l'inscription (aide aussi a l'onboarding - un
// nouveau joueur n'est pas noye sous 6 pages/onglets des le premier jour).
// Decraft reste toujours disponible (c'est la porte d'entree vers Craft).
// ---------------------------------------------------------------------------
const FEATURE_UNLOCK_LEVEL = { craft: 2, trade: 3, altar: 4, quality: 4, finish: 5, showcase: 6 };
const FEATURE_LABELS = { craft: "Crafter des cartes", trade: "Les échanges", altar: "L'autel de sacrifice", quality: "La restauration de cartes usées", finish: "Les finitions (fusion de cartes)", showcase: "La vitrine de profil" };
// Pochettes de cartes (collection.html) : mêmes valeurs par défaut que les
// data-level historiquement poses en dur sur les .sleeve-swatch - centralisees
// ici pour pouvoir aussi etre pilotees par loadUnlockConfig()/l'admin.
const SLEEVE_UNLOCK_LEVEL = { default: 1, neon: 4, vintage: 6, carbone: 10 };

// Recupere les seuils de deblocage configures par l'admin (endpoint public,
// sans auth - lu sur CHAQUE page comme le bandeau du site) et les fusionne
// DANS les objets ci-dessus (jamais de reassignation) pour que toute
// verification deja ecrite ailleurs (cycleTheme, craft.js, collection.js,
// trade.js) profite automatiquement de la config a jour, sans se soucier de
// l'ordre de chargement. Echec silencieux : les valeurs par defaut ci-dessus
// restent alors en vigueur (jamais un joueur bloque a cause d'un reseau coupe).
let unlockConfigLoaded = null;
function loadUnlockConfig() {
  if (!unlockConfigLoaded) {
    unlockConfigLoaded = API.getUnlockConfig()
      .then((res) => {
        if (res.themes) Object.assign(THEME_UNLOCK_LEVEL, res.themes);
        if (res.features) Object.assign(FEATURE_UNLOCK_LEVEL, res.features);
        if (res.sleeves) Object.assign(SLEEVE_UNLOCK_LEVEL, res.sleeves);
      })
      .catch(() => {});
  }
  return unlockConfigLoaded;
}

// Toujours une requete fraiche (pas le cache de knownProfileLevel, qui peut
// etre perime/pas encore charge selon la page et l'ordre d'execution) :
// c'est un appel leger deja utilise partout (booster-status), pas cher a
// refaire au chargement d'une page qui a besoin de verifier un niveau.
async function fetchMyLevel() {
  try {
    const res = await API.getBoosterStatus(Session.userId);
    knownProfileLevel = res.xp?.level || 1;
  } catch (e) { /* reste sur la derniere valeur connue */ }
  return knownProfileLevel;
}

// Message plein-panneau reutilisable pour une page/section entiere
// verrouillee (contrairement a un simple toast, pour un onglet individuel -
// voir craft.js/collection.js).
function renderFeatureLockedMessage(container, featureKey, level) {
  const required = FEATURE_UNLOCK_LEVEL[featureKey] || 1;
  container.innerHTML = `
    <div class="empty-state feature-locked">
      &#128274; <strong>${FEATURE_LABELS[featureKey] || "Cette fonctionnalité"}</strong> se débloque au niveau ${required}.
      Tu es actuellement niveau ${level}. Continue à ouvrir des boosters, crafter et échanger pour monter de niveau !
    </div>
  `;
}

function applyTheme(theme) {
  if (theme === "default") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("2gatcha_theme", theme); } catch (e) {}
}

// Applique immediatement le theme sauvegarde, avant meme DOMContentLoaded,
// pour limiter le flash du theme par defaut au chargement.
(function initTheme() {
  try {
    const saved = localStorage.getItem("2gatcha_theme");
    if (saved && saved !== "default") document.documentElement.setAttribute("data-theme", saved);
  } catch (e) {}
})();

// Un simple bouton qui fait defiler les themes debloques (pas de picker
// dedie) : plus rapide a decouvrir, et le niveau requis est annonce des
// qu'on tombe sur un theme encore verrouille.
function cycleTheme() {
  let current = "default";
  try { current = localStorage.getItem("2gatcha_theme") || "default"; } catch (e) {}
  let idx = THEME_ORDER.indexOf(current);
  for (let i = 0; i < THEME_ORDER.length; i++) {
    idx = (idx + 1) % THEME_ORDER.length;
    const candidate = THEME_ORDER[idx];
    if (THEME_UNLOCK_LEVEL[candidate] <= knownProfileLevel) {
      applyTheme(candidate);
      Toast.info(`Thème : ${THEME_LABELS[candidate]}`);
      return;
    }
  }
  Toast.info(`Prochain thème débloqué au niveau ${Math.min(...Object.values(THEME_UNLOCK_LEVEL).filter((l) => l > knownProfileLevel))}.`);
}

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
  // Jeton signe remis par l'API a la connexion Discord (envoye a chaque requete).
  KEY_TOKEN: "2gatcha_token",

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
  get token() {
    try { return localStorage.getItem(this.KEY_TOKEN); } catch (e) { return null; }
  },
  set(data) {
    localStorage.setItem(this.KEY_USER_ID, data.userId);
    localStorage.setItem(this.KEY_PSEUDO, data.pseudo || "");
    localStorage.setItem(this.KEY_DISCORD_ID, data.discordId || "");
    localStorage.setItem(this.KEY_DISCORD_USERNAME, data.discordUsername || "");
    localStorage.setItem(this.KEY_DISCORD_AVATAR, data.discordAvatar || "");
    if (data.token) localStorage.setItem(this.KEY_TOKEN, data.token);
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
    localStorage.removeItem(this.KEY_TOKEN);
  },
  isLoggedIn() {
    return !!this.userId;
  },
  isAdmin() {
    return (window.APP_CONFIG.adminDiscordIds || []).includes(this.discordId);
  }
};
