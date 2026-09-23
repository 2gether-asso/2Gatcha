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
  success(msg) { this.show(msg, "success"); },
  error(msg) { this.show(msg, "error"); },
  info(msg) { this.show(msg, "info"); }
};

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
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  wrap.appendChild(menu);

  const label = trigger.querySelector(".fancy-select-label");
  let highlighted = -1;

  function renderLabel() {
    const opt = selectEl.options[selectEl.selectedIndex];
    label.textContent = opt ? opt.textContent : "";
  }

  function renderOptions() {
    menu.innerHTML = "";
    highlighted = selectEl.selectedIndex;
    [...selectEl.options].forEach((opt, i) => {
      const item = document.createElement("div");
      item.className = "fancy-select-option";
      item.setAttribute("role", "option");
      item.dataset.index = String(i);
      item.textContent = opt.textContent;
      if (i === selectEl.selectedIndex) item.setAttribute("aria-selected", "true");
      item.addEventListener("mouseenter", () => setHighlighted(i));
      item.addEventListener("click", () => choose(i));
      menu.appendChild(item);
    });
  }

  function setHighlighted(i) {
    highlighted = i;
    [...menu.children].forEach((el, idx) => el.classList.toggle("highlighted", idx === i));
  }

  function choose(i) {
    if (selectEl.selectedIndex !== i) {
      selectEl.selectedIndex = i;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    renderLabel();
    closeMenu();
  }

  function openMenu() {
    renderOptions();
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    wrap.classList.add("open");
    setHighlighted(selectEl.selectedIndex);
    document.addEventListener("click", onOutsideClick);
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

  trigger.addEventListener("click", () => {
    if (menu.hidden) openMenu(); else closeMenu();
  });
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeMenu(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (menu.hidden) { openMenu(); return; }
      const count = selectEl.options.length;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setHighlighted((highlighted + dir + count) % count);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (menu.hidden) openMenu();
      else if (highlighted >= 0) choose(highlighted);
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
      legendaire: [392, 523.25, 659.25, 783.99, 987.77]
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
const RARITY_PARTICLE_COUNTS = { commune: 5, rare: 12, epique: 24, legendaire: 42 };
const RARITY_CONFETTI = {
  commune: { particleCount: 0, spread: 0 },
  rare: { particleCount: 45, spread: 65 },
  epique: { particleCount: 80, spread: 90 },
  legendaire: { particleCount: 150, spread: 120 }
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
function bumpNumber(el, newValue) {
  const prevRaw = el.textContent.trim();
  const prevNum = Number(prevRaw);
  const nextNum = Number(newValue);
  const canAnimate = prevRaw !== "" && prevRaw !== "..." && Number.isFinite(prevNum) && Number.isFinite(nextNum) && prevNum !== nextNum;

  if (!canAnimate) {
    el.textContent = newValue;
    return;
  }

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

const NAV_ITEMS = [
  { href: "index.html", label: "Accueil", icon: "&#127968;", auth: false },
  { href: "ouverture.html", label: "Boosters", icon: "&#127873;", auth: false, badgeKey: "boosters" },
  { href: "collection.html", label: "Collection", icon: "&#128218;", auth: false },
  { href: "craft.html", label: "Craft", icon: "&#10024;", auth: true },
  { href: "redeem.html", label: "Code", icon: "&#127915;", auth: true },
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
  el.innerHTML = visibleNavItems().map((item) => `
    <a href="${item.href}" class="${item.href === page ? "active" : ""}" data-badge-key="${item.badgeKey || ""}">
      <span class="bn-icon">${item.icon}</span>
      <span>${item.label}</span>
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
        Toast.info(`Nouvelle proposition d'échange recue ! (${pendingCount} en attente)`);
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
          <div class="header-stats" title="Tes ressources">
            <span id="header-booster-badge" class="stat-chip" title="Boosters disponibles">
              <span class="icon">&#127183;</span><span class="count">...</span>
            </span>
            <span class="stat-divider" aria-hidden="true"></span>
            <span id="header-stardust-badge" class="stat-chip" title="Poussières d'étoile (craft/décraft)">
              <span class="icon">&#10024;</span><span class="count">...</span>
            </span>
          </div>
          <div class="user-menu" id="user-menu">
            <button type="button" class="user-menu-trigger" id="user-menu-trigger">
              ${avatar}
              <span id="header-pseudo">${Session.pseudo}</span>
              <span class="caret">&#9660;</span>
            </button>
            <div class="user-menu-dropdown" id="user-menu-dropdown">
              <button id="edit-pseudo-btn" type="button">&#9998; Modifier le pseudo</button>
              <a id="view-profile-link" href="profile.html?pseudo=${encodeURIComponent(Session.pseudo || "")}">&#128100; Voir mon profil</a>
              <button id="copy-profile-link-btn" type="button">&#128279; Copier le lien de mon profil</button>
              <button id="mute-toggle-btn" type="button">${Sfx.muted ? "&#128264; Son coupe" : "&#128266; Son actif"}</button>
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
    document.getElementById("mute-toggle-btn").addEventListener("click", (e) => {
      Sfx.setMuted(!Sfx.muted);
      e.target.innerHTML = Sfx.muted ? "&#128264; Son coupe" : "&#128266; Son actif";
      if (!Sfx.muted) Sfx.click();
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

  // Banniere beta : ajoutee en enfant du header (pas un element separe) pour
  // que sa hauteur soit automatiquement comptee dans --header-h
  // (syncHeaderOffset) sans code special. A retirer au lancement de la V1.
  el.insertAdjacentHTML("afterbegin", `
    <div class="beta-banner">
      &#128679; <strong>Version bêta</strong> — toutes les données (cartes, boosters, échanges) seront réinitialisées au lancement de la V1.
    </div>
  `);
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
  renderHeader();
  syncHeaderOffset();
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
  // Les polices web (Sora/Inter) peuvent legerement changer la hauteur du
  // header une fois chargees : on recale une fois qu'elles sont pretes.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeaderOffset);
});
