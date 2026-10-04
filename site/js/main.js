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
      setTimeout(() => {
        el.remove();
        this._updateClearAll();
      }, 250);
    }, duration);
    this._updateClearAll();
  },
  // Plusieurs actions rapides peuvent empiler pas mal de toasts d'un coup
  // (ex: reveal d'un x5) : un bouton pour tout balayer plutot que d'attendre.
  _updateClearAll() {
    const stack = this._stack();
    let clearBtn = stack.querySelector(".toast-clear-all");
    const count = stack.querySelectorAll(".toast:not(.hide)").length;
    if (count >= 3) {
      if (!clearBtn) {
        clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "toast-clear-all";
        clearBtn.textContent = "Tout effacer";
        clearBtn.addEventListener("click", () => {
          stack.querySelectorAll(".toast").forEach((t) => t.remove());
          clearBtn.remove();
        });
        stack.prepend(clearBtn);
      }
    } else if (clearBtn) {
      clearBtn.remove();
    }
  },
  success(msg) { this.show(msg, "success"); NotificationHistory.add("success", msg); },
  error(msg) { this.show(msg, "error"); NotificationHistory.add("error", msg); },
  info(msg) { this.show(msg, "info"); NotificationHistory.add("info", msg); }
};

// ---------------------------------------------------------------------------
// Historique de notifications (embellissement/QoL 2026-09-30) : ce site est
// multi-pages (chaque navigation recharge completement le JS), donc un Toast
// manque en changeant de page est perdu pour toujours - la petite cloche
// dans le header garde une trace recente consultable a tout moment.
// sessionStorage (pas localStorage) : une trace par session de navigation,
// pas une notification qui ressurgirait des semaines plus tard.
// ---------------------------------------------------------------------------
const NotificationHistory = {
  KEY: "2gatcha_notif_history",
  LAST_SEEN_KEY: "2gatcha_notif_last_seen",
  MAX: 20,
  getAll() {
    try { return JSON.parse(sessionStorage.getItem(this.KEY) || "[]"); } catch (e) { return []; }
  },
  add(type, message) {
    if (!message) return;
    try {
      const list = this.getAll();
      list.unshift({ type, message, ts: Date.now() });
      sessionStorage.setItem(this.KEY, JSON.stringify(list.slice(0, this.MAX)));
    } catch (e) {}
  },
  unreadCount() {
    let lastSeen = 0;
    try { lastSeen = Number(sessionStorage.getItem(this.LAST_SEEN_KEY) || 0); } catch (e) {}
    return this.getAll().filter((n) => n.ts > lastSeen).length;
  },
  markAllSeen() {
    try { sessionStorage.setItem(this.LAST_SEEN_KEY, String(Date.now())); } catch (e) {}
  },
  clear() {
    try { sessionStorage.removeItem(this.KEY); } catch (e) {}
  }
};

function relativeTime(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

function renderNotifDot() {
  const dot = document.getElementById("notif-bell-dot");
  if (!dot) return;
  const count = NotificationHistory.unreadCount();
  dot.style.display = count > 0 ? "block" : "none";
}

function renderNotifDropdown() {
  const el = document.getElementById("notif-bell-dropdown");
  if (!el) return;
  const items = NotificationHistory.getAll();
  const icons = { success: "&#10003;", error: "&#9888;", info: "&#10024;" };
  const header = items.length
    ? `<div class="notif-bell-header"><span>Notifications</span><button type="button" class="notif-clear-btn" id="notif-clear-btn">Tout effacer</button></div>`
    : "";
  el.innerHTML = header + (items.length
    ? items.map((n) => `
        <div class="notif-item notif-item-${n.type}">
          <span class="notif-item-icon">${icons[n.type] || icons.info}</span>
          <span class="notif-item-body">
            <span class="notif-item-msg">${n.message}</span>
            <span class="notif-item-time">${relativeTime(n.ts)}</span>
          </span>
        </div>
      `).join("")
    : `<div class="notif-empty">Rien de nouveau pour l'instant.</div>`);
  const clearBtn = document.getElementById("notif-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      NotificationHistory.clear();
      renderNotifDropdown();
      renderNotifDot();
    });
  }
}

// ---------------------------------------------------------------------------
// Confirmation stylisee (remplace window.confirm, qui casse totalement le
// ton "jeu premium" du reste du site avec sa popup navigateur brute) -
// utilisee pour toute action destructive/irreversible (decraft, revocation
// de code...).
// ---------------------------------------------------------------------------
const Confirm = {
  show(message, { title = "Confirmer", confirmText = "Confirmer", cancelText = "Annuler", dangerous = false } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "card-modal-overlay confirm-overlay";
      overlay.innerHTML = `
        <div class="confirm-box">
          <div class="confirm-title">${title}</div>
          <div class="confirm-message">${message}</div>
          <div class="confirm-actions">
            <button type="button" class="btn-ghost confirm-cancel">${cancelText}</button>
            <button type="button" class="${dangerous ? "btn-danger" : ""} confirm-ok">${confirmText}</button>
          </div>
        </div>
      `;
      const finish = (result) => {
        overlay.remove();
        syncScrollLock();
        resolve(result);
      };
      overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(false); });
      overlay.querySelector(".confirm-cancel").addEventListener("click", () => finish(false));
      overlay.querySelector(".confirm-ok").addEventListener("click", () => finish(true));
      document.addEventListener("keydown", function onKey(e) {
        if (e.key === "Escape") { document.removeEventListener("keydown", onKey); finish(false); }
      });
      document.body.appendChild(overlay);
      syncScrollLock();
    });
  }
};

// ---------------------------------------------------------------------------
// Choix des exemplaires d'une fusion (finition / restauration d'etat,
// 2026-10-02) : le joueur coche EXACTEMENT les exemplaires sacrifies et
// choisit le numero de serie conserve sur le nouvel exemplaire - plus jamais
// de #001 ou d'arc-en-ciel consomme par accident. Preselection identique au
// defaut serveur (foil-upgrade.json / card-quality-repair.json) : d'abord les
// moins precieux sur l'autre axe, puis les numeros les plus hauts.
// copies : [{ pullId, serialNumber, finish, quality }] (deja filtrees sur la
// finition/qualite source). otherRank(copy) : valeur de l'autre axe.
// Resout { pullIds, keepPullId } ou null si annule.
// ---------------------------------------------------------------------------
const FusionPicker = {
  open({ title, intro, copies, required, otherRank, confirmText = "Fusionner" }) {
    return new Promise((resolve) => {
      const FIN = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
      const QUA = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };
      const sorted = [...copies].sort((a, b) => (a.serialNumber || 9999) - (b.serialNumber || 9999));
      const byDefault = [...copies].sort((a, b) => (otherRank(a) - otherRank(b)) || ((b.serialNumber || 0) - (a.serialNumber || 0)));
      const selected = new Set(byDefault.slice(0, required).map((c) => c.pullId));
      const lowestSelected = () => sorted.find((c) => selected.has(c.pullId)) || null;
      let keep = lowestSelected()?.pullId ?? null;
      const serial = (c) => (c.serialNumber != null ? "#" + String(c.serialNumber).padStart(3, "0") : "#?");
      const precious = (c) => c.serialNumber === 1 || c.finish === "rainbow" || c.quality === "mint";

      const overlay = document.createElement("div");
      overlay.className = "card-modal-overlay confirm-overlay";
      overlay.innerHTML = `
        <div class="confirm-box fusion-picker">
          <div class="confirm-title">${title}</div>
          <div class="confirm-message">${intro}</div>
          <div class="fusion-picker-list">
            ${sorted.map((c) => `
              <div class="fusion-row" data-pull="${c.pullId}">
                <label class="fusion-pick"><input type="checkbox" data-pick="${c.pullId}" /> <strong>${serial(c)}</strong> · ${FIN[c.finish || "normal"]} · ${QUA[c.quality || "damaged"]}${precious(c) ? ' <span class="fusion-precious">précieux</span>' : ""}</label>
                <label class="fusion-keep" title="Le nouvel exemplaire portera ce numéro"><input type="radio" name="fusion-keep" data-keep="${c.pullId}" /> garder ce n°</label>
              </div>`).join("")}
          </div>
          <div class="fusion-picker-count"></div>
          <div class="confirm-actions">
            <button type="button" class="btn-ghost confirm-cancel">Annuler</button>
            <button type="button" class="btn-danger confirm-ok">${confirmText}</button>
          </div>
        </div>
      `;
      const okBtn = overlay.querySelector(".confirm-ok");
      const refresh = () => {
        if (!selected.has(keep)) keep = lowestSelected()?.pullId ?? null;
        overlay.querySelectorAll(".fusion-row").forEach((row) => {
          const id = Number(row.dataset.pull);
          const on = selected.has(id);
          row.classList.toggle("selected", on);
          row.querySelector("[data-pick]").checked = on;
          const radio = row.querySelector("[data-keep]");
          radio.disabled = !on;
          radio.checked = on && id === keep;
        });
        const lost = [...selected].map((id) => copies.find((c) => c.pullId === id)).filter((c) => c && c.pullId !== keep && precious(c));
        overlay.querySelector(".fusion-picker-count").innerHTML =
          `${selected.size} / ${required} sélectionné${required > 1 ? "s" : ""}` +
          (lost.length ? ` · <span class="fusion-warning">&#9888; tu sacrifies ${lost.map(serial).join(", ")} (précieux)</span>` : "");
        okBtn.disabled = selected.size !== required;
      };
      overlay.querySelectorAll("[data-pick]").forEach((cb) => cb.addEventListener("change", () => {
        const id = Number(cb.dataset.pick);
        if (cb.checked) selected.add(id); else selected.delete(id);
        refresh();
      }));
      overlay.querySelectorAll("[data-keep]").forEach((r) => r.addEventListener("change", () => { keep = Number(r.dataset.keep); refresh(); }));
      const finish = (result) => { overlay.remove(); syncScrollLock(); resolve(result); };
      overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(null); });
      overlay.querySelector(".confirm-cancel").addEventListener("click", () => finish(null));
      okBtn.addEventListener("click", () => finish({ pullIds: [...selected], keepPullId: keep }));
      document.body.appendChild(overlay);
      syncScrollLock();
      refresh();
    });
  }
};
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
    if (!force) {
      const cached = API._cacheGet("2gatcha_cache_communaute_signals", 90 * 1000);
      if (cached) return cached;
    }
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
    API._cacheSet("2gatcha_cache_communaute_signals", signals);
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

const FUSION_QUALITY_RANK = ["damaged", "worn", "good", "mint"];
const FUSION_FINISH_RANK = ["normal", "holo", "gold", "ghost", "diamond", "rainbow"];

// ---------------------------------------------------------------------------
// Menu deroulant stylise a la place du <select> natif du navigateur (moche
// et non personnalisable). Le <select> d'origine reste dans le DOM comme
// source de verite (garde .value, continue a emettre "change") : tout code
// appelant qui lisait deja filterEl.value / ecoutait "change" continue de
// marcher sans modification. On le masque visuellement et on construit une
// interface custom par-dessus, synchronisee avec lui.
// ---------------------------------------------------------------------------
function enhanceSelect(selectEl) {
  if (!selectEl || selectEl._fancyEnhanced) return;
  selectEl._fancyEnhanced = true;

  const wrap = document.createElement("div");
  wrap.className = "fancy-select";
  // Le wrapper reprend les styles inline du select d'origine (margin,
  // display:none initial le temps qu'il soit pertinent...) : c'est lui qui
  // pilote desormais la mise en page a la place du select, devenu invisible.
  wrap.style.cssText = selectEl.style.cssText;
  selectEl.removeAttribute("style");
  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);
  selectEl.classList.add("fancy-select-native");
  selectEl.setAttribute("tabindex", "-1");
  selectEl.setAttribute("aria-hidden", "true");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "fancy-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `<span class="fancy-select-label"></span><span class="fancy-select-arrow" aria-hidden="true">&#9662;</span>`;
  wrap.appendChild(trigger);

  const menu = document.createElement("div");
  menu.className = "fancy-select-menu";
  menu.hidden = true;
  wrap.appendChild(menu);

  // Barre de recherche en tete du menu (position:sticky, reste visible
  // pendant que la liste en-dessous defile) : indispensable des qu'une liste
  // depasse une vingtaine d'options (cartes, joueurs...) - filtre par
  // sous-chaine insensible a la casse/aux accents sur le texte affiche.
  const search = document.createElement("input");
  search.type = "text";
  search.className = "fancy-select-search";
  search.placeholder = "Rechercher...";
  search.autocomplete = "off";
  menu.appendChild(search);

  const optionsList = document.createElement("div");
  optionsList.className = "fancy-select-options";
  optionsList.setAttribute("role", "listbox");
  menu.appendChild(optionsList);

  const label = trigger.querySelector(".fancy-select-label");
  let highlighted = -1;

  function renderLabel() {
    const opt = selectEl.options[selectEl.selectedIndex];
    label.textContent = opt ? opt.textContent : "";
  }

  function normalize(str) {
    return (str || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function renderOptions() {
    optionsList.innerHTML = "";
    highlighted = selectEl.selectedIndex;
    const query = normalize(search.value);
    [...selectEl.options].forEach((opt, i) => {
      if (query && !normalize(opt.textContent).includes(query)) return;
      const item = document.createElement("div");
      item.className = "fancy-select-option";
      item.setAttribute("role", "option");
      item.dataset.index = String(i);
      item.textContent = opt.textContent;
      if (i === selectEl.selectedIndex) item.setAttribute("aria-selected", "true");
      item.addEventListener("mouseenter", () => setHighlighted(i));
      item.addEventListener("click", () => choose(i));
      optionsList.appendChild(item);
    });
    if (!optionsList.children.length) {
      const empty = document.createElement("div");
      empty.className = "fancy-select-empty";
      empty.textContent = "Aucun résultat.";
      optionsList.appendChild(empty);
    }
  }

  // "highlighted" est une POSITION dans menu.children (la liste FILTREE
  // affichee), pas l'index d'origine dans selectEl.options - les deux
  // divergent des qu'une recherche masque des options. On ne revient a
  // l'index d'origine (via item.dataset.index) qu'au moment de choisir.
  function setHighlighted(pos) {
    highlighted = pos;
    [...optionsList.children].forEach((el, idx) => el.classList.toggle("highlighted", idx === pos));
  }

  function choose(i) {
    if (selectEl.selectedIndex !== i) {
      selectEl.selectedIndex = i;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    renderLabel();
    closeMenu();
  }

  function chooseHighlighted() {
    const el = optionsList.children[highlighted];
    if (el && el.dataset.index != null) choose(Number(el.dataset.index));
  }

  function openMenu() {
    search.value = "";
    renderOptions();
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    wrap.classList.add("open");
    const selectedPos = [...optionsList.children].findIndex((el) => Number(el.dataset.index) === selectEl.selectedIndex);
    setHighlighted(selectedPos >= 0 ? selectedPos : 0);
    document.addEventListener("click", onOutsideClick);
    search.focus();
  }
  function closeMenu() {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    wrap.classList.remove("open");
    document.removeEventListener("click", onOutsideClick);
  }
  function onOutsideClick(e) {
    if (!wrap.contains(e.target)) closeMenu();
  }

  search.addEventListener("input", () => {
    renderOptions();
    setHighlighted(optionsList.children.length && optionsList.children[0].dataset.index != null ? 0 : -1);
  });
  search.addEventListener("click", (e) => e.stopPropagation());
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeMenu(); trigger.focus(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const count = optionsList.children.length;
      if (!count) return;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setHighlighted((highlighted + dir + count) % count);
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); chooseHighlighted(); }
  });

  trigger.addEventListener("click", () => {
    if (menu.hidden) openMenu(); else closeMenu();
  });
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeMenu(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (menu.hidden) { openMenu(); return; }
      const count = optionsList.children.length;
      if (!count) return;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setHighlighted((highlighted + dir + count) % count);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (menu.hidden) openMenu();
      else if (highlighted >= 0) chooseHighlighted();
    }
  });

  // Si le code appelant ajoute des <option> apres coup (liste peuplee de
  // maniere asynchrone), il suffit d'appeler selectEl._fancyRefresh().
  selectEl._fancyRefresh = renderLabel;
  renderLabel();
}

// ---------------------------------------------------------------------------
// SFX minimalistes generes en WebAudio (pas de fichiers audio a heberger) :
// un tic au flip d'une carte, un carillon dont la richesse suit la rarete.
// Un jeu totalement silencieux se sent inacheve - ce n'est pas un habillage
// cosmetique de plus, c'est le retour manquant sur l'action principale.
// ---------------------------------------------------------------------------
const Sfx = {
  _ctx: null,
  _muted: localStorage.getItem("2gatcha_muted") === "1",
  get ctx() {
    if (!this._ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this._ctx = new AudioCtx();
    }
    return this._ctx;
  },
  get muted() { return this._muted; },
  setMuted(m) {
    this._muted = m;
    localStorage.setItem("2gatcha_muted", m ? "1" : "0");
  },
  _tone(freq, start, duration, type, gain) {
    if (this._muted) return;
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + start;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    } catch (e) { /* AudioContext indisponible ou bloque : silence, pas grave */ }
  },
  flip() {
    this._tone(320, 0, 0.09, "triangle", 0.12);
  },
  reveal(rarityKey) {
    const chords = {
      commune: [392],
      rare: [392, 523.25],
      epique: [392, 523.25, 659.25],
      legendaire: [392, 523.25, 659.25, 783.99, 987.77],
      // Bug reel corrige ici (2026-09-30) : manquait completement, donc tout
      // VRAI tirage mythique (craft/redeem/opening.js/etc.) retombait sur
      // l'accord le plus fade (commune) au lieu du plus impressionnant.
      mythique: [392, 523.25, 659.25, 783.99, 987.77, 1244.51]
    };
    const notes = chords[rarityKey] || chords.commune;
    notes.forEach((freq, i) => this._tone(freq, i * 0.055, 0.55, "sine", 0.085));
  },
  click() {
    this._tone(500, 0, 0.05, "square", 0.05);
  }
};

// Petite icone distinctive par rareté (en plus de la couleur, pour ne pas
// reposer uniquement sur la teinte).
const RARITY_ICONS = { commune: "&#9679;", rare: "&#9670;", epique: "&#9733;", legendaire: "&#128081;", mythique: "&#128293;" };
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

// Note : un halo qui suit le curseur et un calque de grain permanents ont
// ete retires - dans une passe de sobriete generale (trop d'effets
// decoratifs simultanes = rendu "demo CSS" plutot que site pro), ce sont
// les deux qui n'ajoutaient rien de fonctionnel (aucun lien avec une
// action du joueur, juste du mouvement en continu).

// ---------------------------------------------------------------------------
// Effets de particules/energie a la revelation d'une carte, intensite
// proportionnelle a la rareté, couleur = celle de la rareté. Le calque dedie
// a un z-index superieur au modal plein écran d'ouverture (400) et a son
// flash legendaire (410) : les effets doivent toujours passer PAR-DESSUS.
// ---------------------------------------------------------------------------
const RARITY_PARTICLE_COUNTS = { commune: 5, rare: 12, epique: 24, legendaire: 42, mythique: 64 };
const RARITY_CONFETTI = {
  commune: { particleCount: 0, spread: 0 },
  rare: { particleCount: 45, spread: 65 },
  epique: { particleCount: 80, spread: 90 },
  legendaire: { particleCount: 150, spread: 120 },
  mythique: { particleCount: 220, spread: 140 }
};

// Melange une couleur hex avec du blanc (0 = couleur intacte, 1 = blanc
// pur) : sert a obtenir une teinte plus claire de la meme couleur plutot
// que de retomber sur un blanc plat pour le 2e ton des confettis.
function lightenColor(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// Utilise par celebrateRarity (opening.js/redeem.js) pour poser --flash-color
// depuis la VRAIE couleur de la rarete (jamais figee sur l'orange legendaire).
function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(245,165,36,${alpha})`;
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Ratio de contraste WCAG entre deux couleurs hex (formule standard sRGB).
function contrastRatio(hex1, hex2) {
  function lum(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return 1;
    const num = parseInt(m[1], 16);
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  const l1 = lum(hex1), l2 = lum(hex2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// Les couleurs de rareté viennent de Grist et ne sont pas garanties d'avoir
// un contraste suffisant utilisees comme TEXTE sur fond sombre (le bleu
// "rare" par defaut, par exemple, echoue de justesse le seuil WCAG AA).
// Eclaircit progressivement jusqu'au seuil (4.5:1) sans jamais toucher a la
// couleur d'origine utilisee pour les fonds/bordures, purement decoratifs.
function rarityTextColor(hex, bg = "#1c1f42") {
  let color = hex || "#9aa0b4";
  let amount = 0;
  while (contrastRatio(color, bg) < 4.5 && amount < 0.9) {
    amount += 0.08;
    color = lightenColor(hex, amount);
  }
  return color;
}

// Zoom sur une vignette de carte (trade.js notamment) : un simple clic ouvre
// l'image en grand, sans devoir rouvrir toute la modale carte complete.
function openImageLightbox(imgSrc, altText) {
  if (!imgSrc) return;
  const overlay = document.createElement("div");
  overlay.className = "card-modal-overlay image-lightbox-overlay";
  overlay.innerHTML = `<img src="${imgSrc}" alt="${altText || ""}" class="image-lightbox-img" />`;
  overlay.addEventListener("click", () => overlay.remove());
  document.addEventListener("keydown", function onKey(e) {
    if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); }
  });
  document.body.appendChild(overlay);
}

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
  const maxSize = rarityKey === "mythique" ? 28 : rarityKey === "legendaire" ? 22 : rarityKey === "epique" ? 16 : rarityKey === "rare" ? 12 : 8;
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
    // zIndex par defaut de canvas-confetti = 100, largement en dessous du
    // modal plein écran d'ouverture (400) : sans le forcer ici, tous les
    // confettis se retrouvent invisibles derriere la modale.
    // Dégradé de la couleur de rareté (au lieu de couleur + blanc plat)
    // pour un rendu plus riche, coherent avec le badge/le halo de la carte.
    const tint = lightenColor(color, 0.55);
    confetti({ particleCount: conf.particleCount, spread: conf.spread, origin, colors: [color, tint], zIndex: 420 });
    if (rarityKey === "legendaire") {
      setTimeout(() => confetti({ particleCount: 90, spread: 140, origin: { x: origin.x, y: Math.max(0, origin.y - 0.1) }, colors: [color, "#ffd166", tint], zIndex: 420 }), 220);
    }
  }
}

// Dissolution "poussiere d'etoile" a la destruction d'une carte (decraft) :
// reutilise le meme systeme de particules que les reveals (spawnRarityBurst,
// teinte poussiere plutot que couleur de rarete), plus une brève animation
// de la vignette elle-meme (retrecit + se floute) avant que la grille ne se
// rafraichisse. Attend la fin de l'animation pour laisser le temps au joueur
// de la voir avant que reload() ne remplace le DOM.
function playDustDissolve(el) {
  return new Promise((resolve) => {
    if (!el) { resolve(); return; }
    spawnRarityBurst("rare", "#c9b8ff", el);
    el.classList.add("dust-dissolve");
    setTimeout(resolve, 380);
  });
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
  // en accès direct sur une page qui ne charge pas opening.js.
  if (packModal && !packModal.hidden && typeof isBusy !== "undefined" && !isBusy) {
    packModal.hidden = true;
    syncScrollLock();
  }
});

// ---------------------------------------------------------------------------
// Verrouillage du scroll de la page pendant qu'une modale plein écran est
// ouverte (zoom de carte, ouverture de booster) : sans ca, la page derriere
// continue de defiler sous la modale, ce qui est deroutant. On resynchronise
// a chaque ouverture/fermeture plutot que de compter un simple booleen, pour
// rester correct meme si une modale est fermee par un autre chemin (Echap,
// clic sur l'overlay, fin d'animation...).
//
// Technique "figer body en position:fixed" plutot qu'un simple
// overflow:hidden : cette dernière ne bloque pas fiablement le scroll
// tactile sur mobile et peut faire "sauter" la page a la fermeture. On
// mémorise le scroll courant, on fixe le body a cette position, puis on
// restaure exactement la meme position au deverrouillage.
let _scrollLockY = 0;
function syncScrollLock() {
  const cardModalOpen = !!document.querySelector(".card-modal-overlay");
  const packModal = document.getElementById("pack-modal-overlay");
  const packModalOpen = !!(packModal && !packModal.hidden);
  const shouldLock = cardModalOpen || packModalOpen;
  const isLocked = document.body.classList.contains("scroll-locked");

  if (shouldLock && !isLocked) {
    _scrollLockY = window.scrollY || window.pageYOffset || 0;
    document.body.classList.add("scroll-locked");
    document.body.style.top = `-${_scrollLockY}px`;
  } else if (!shouldLock && isLocked) {
    document.body.classList.remove("scroll-locked");
    document.body.style.top = "";
    window.scrollTo(0, _scrollLockY);
  }
}

// Anime un changement de valeur numerique (badge boosters, stats...) avec un
// petit "bump" au lieu d'un saut sec.
// Petit "+N" qui s'envole depuis un badge de monnaie (embellissement
// 2026-09-30), en plus du compteur qui defile deja plus bas. Position:fixed
// + append direct sur <body> (comme getParticleLayer) pour ne pas dependre
// du contexte de positionnement du badge appelant.
function spawnFloatingGain(el, delta) {
  const rect = el.getBoundingClientRect();
  const span = document.createElement("span");
  span.className = "count-gain-float";
  span.textContent = "+" + delta;
  span.style.left = (rect.left + rect.width / 2) + "px";
  span.style.top = rect.top + "px";
  document.body.appendChild(span);
  setTimeout(() => span.remove(), 900);
}

function bumpNumber(el, newValue) {
  const prevRaw = el.textContent.trim();
  const prevNum = Number(prevRaw);
  const nextNum = Number(newValue);
  const canAnimate = prevRaw !== "" && prevRaw !== "..." && Number.isFinite(prevNum) && Number.isFinite(nextNum) && prevNum !== nextNum;

  if (!canAnimate) {
    el.textContent = newValue;
    return;
  }

  if (nextNum > prevNum) spawnFloatingGain(el, nextNum - prevNum);

  // Petit effet "compteur qui defile" plutot qu'un saut sec au nouveau
  // chiffre : interpole la valeur affichee sur ~450ms.
  el.classList.remove("count-bump");
  void el.offsetWidth;
  el.classList.add("count-bump");

  const duration = 450;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(prevNum + (nextNum - prevNum) * eased);
    el.textContent = value;
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = newValue;
  }
  requestAnimationFrame(step);
}

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
  { href: "craft.html", label: "Craft & décomposer", icon: "&#10024;", auth: true, group: "collection" },
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
  const cached = API._cacheGet("2gatcha_cache_pending_trades", 45 * 1000);
  let pendingCount = cached;
  if (pendingCount == null) {
    try {
      const res = await API.listTrades(Session.userId);
      pendingCount = (res.trades || []).filter((t) => t.direction === "incoming" && t.status === "pending").length;
      API._cacheSet("2gatcha_cache_pending_trades", pendingCount);

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
    const cachedBoosters = API._cacheGet("2gatcha_cache_booster_count", 45 * 1000);
    let boosterCount = cachedBoosters;
    if (boosterCount == null) {
      const status = await API.getBoosterStatus(Session.userId);
      boosterCount = status.count || 0;
      API._cacheSet("2gatcha_cache_booster_count", boosterCount);
    }
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
    let rewardsCount = API._cacheGet("2gatcha_cache_rewards_count", 90 * 1000);
    if (rewardsCount == null) {
      const [quests, weekly, levelRewards] = await Promise.all([
        API.getQuestStatus(Session.userId).catch(() => null),
        API.getWeeklyQuestStatus(Session.userId).catch(() => null),
        API.getLevelRewardsStatus(Session.userId).catch(() => null)
      ]);
      rewardsCount = [quests?.canClaim, weekly?.canClaim, levelRewards?.hasPending].filter(Boolean).length;
      API._cacheSet("2gatcha_cache_rewards_count", rewardsCount);
    }
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
    let jeuxCount = API._cacheGet("2gatcha_cache_jeux_count", 90 * 1000);
    if (jeuxCount == null) {
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
      API._cacheSet("2gatcha_cache_jeux_count", jeuxCount);
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
  if (location.pathname.endsWith("maintenance.html")) return;
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
        let vault = API._cacheGet("2gatcha_cache_vault_progress", 90 * 1000);
        if (vault === null) {
          vault = await API.getVaultStatus(Session.userId).catch(() => null);
          API._cacheSet("2gatcha_cache_vault_progress", vault);
        }
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
    setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadHeaderBoosterBadge();
      loadNavBadges();
    }, 60000);
  }
});
