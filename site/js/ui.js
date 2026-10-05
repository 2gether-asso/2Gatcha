// Composants d'interface reutilisables (ex-main.js, decoupe 2026-10-04).
// Toast, historique des notifications, Confirm, FusionPicker, menus
// deroulants (enhanceSelect), sons (Sfx), barre de chargement, couleurs de
// rarete, particules, verrou de defilement, compteurs animes.
// Ordre de chargement dans chaque page : config.js, api.js, core.js, ui.js,
// shell.js, puis le script de la page.

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
    : `<div class="notif-empty">Rien de nouveau pour l'instant.</div>`) + `<div id="push-toggle-row"></div>`;
  if (typeof PushNotifs !== "undefined") PushNotifs.renderRow(document.getElementById("push-toggle-row"));
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
  // parts : pieces detachees disponibles (pechees) ; cochee, une piece
  // remplace un des exemplaires requis.
  // dustPerCopy / stardust : exemplaires manquants payes en poussieres
  // (restauration de qualite uniquement).
  open({ title, intro, copies, required: baseRequired, otherRank, confirmText = "Fusionner", parts = 0, dustPerCopy = 0, stardust = 0 }) {
    return new Promise((resolve) => {
      const maxDust = dustPerCopy > 0 ? Math.min(baseRequired - 1, Math.floor(stardust / dustPerCopy)) : 0;
      // Piece cochee d'office seulement si les poussieres ne suffisent pas a combler.
      let usePart = parts > 0 && copies.length + maxDust < baseRequired;
      const partForced = parts > 0 && copies.length + maxDust < baseRequired;
      let dustCopies = Math.max(0, Math.min(maxDust, baseRequired - (usePart ? 1 : 0) - copies.length));
      let required = baseRequired - (usePart ? 1 : 0) - dustCopies;
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
          ${parts > 0 ? `<label class="fusion-part"><input type="checkbox" data-use-part ${usePart ? "checked" : ""} ${partForced ? "disabled" : ""} /> &#128297; Utiliser une <strong>pièce détachée</strong> à la place d'un exemplaire <span class="muted">(il t'en reste ${parts})</span></label>` : ""}
          ${maxDust > 0 ? `<label class="fusion-part fusion-dust">&#10024; Payer en poussières <select data-dust-copies>${Array.from({ length: maxDust + 1 }, (_, n) => `<option value="${n}" ${n === dustCopies ? "selected" : ""}>${n} exemplaire${n > 1 ? "s" : ""}${n ? ` (${n * dustPerCopy} ✨)` : ""}</option>`).join("")}</select> <span class="muted">(${dustPerCopy} ✨ chacun, tu as ${stardust} ✨)</span></label>` : ""}
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
      const trimSelection = () => {
        while (selected.size > required) {
          const drop = [...byDefault].reverse().find((c) => selected.has(c.pullId));
          selected.delete(drop.pullId);
        }
      };
      const dustSel = overlay.querySelector("[data-dust-copies]");
      if (dustSel) dustSel.addEventListener("change", () => {
        dustCopies = Number(dustSel.value) || 0;
        required = Math.max(1, baseRequired - (usePart ? 1 : 0) - dustCopies);
        trimSelection();
        refresh();
      });
      const partBox = overlay.querySelector("[data-use-part]");
      if (partBox) partBox.addEventListener("change", () => {
        usePart = partBox.checked;
        required = Math.max(1, baseRequired - (usePart ? 1 : 0) - dustCopies);
        // Trop d'exemplaires coches : on retire le plus precieux a garder.
        while (selected.size > required) {
          const drop = [...byDefault].reverse().find((c) => selected.has(c.pullId));
          selected.delete(drop.pullId);
        }
        refresh();
      });
      overlay.querySelectorAll("[data-pick]").forEach((cb) => cb.addEventListener("change", () => {
        const id = Number(cb.dataset.pick);
        if (cb.checked) selected.add(id); else selected.delete(id);
        refresh();
      }));
      overlay.querySelectorAll("[data-keep]").forEach((r) => r.addEventListener("change", () => { keep = Number(r.dataset.keep); refresh(); }));
      const finish = (result) => { overlay.remove(); syncScrollLock(); resolve(result); };
      overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(null); });
      overlay.querySelector(".confirm-cancel").addEventListener("click", () => finish(null));
      okBtn.addEventListener("click", () => finish({ pullIds: [...selected], keepPullId: keep, parts: usePart ? 1 : 0, dustCopies }));
      document.body.appendChild(overlay);
      syncScrollLock();
      refresh();
    });
  }
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
      mythique: [392, 523.25, 659.25, 783.99, 987.77, 1244.51],
      unique: [440, 554.37, 659.25, 880, 1108.73, 1318.51]
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
const RARITY_ICONS = { commune: "&#9679;", rare: "&#9670;", epique: "&#9733;", legendaire: "&#128081;", mythique: "&#128293;", unique: "&#127808;" };
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
const RARITY_PARTICLE_COUNTS = { commune: 5, rare: 12, epique: 24, legendaire: 42, mythique: 64, unique: 64 };
const RARITY_CONFETTI = {
  commune: { particleCount: 0, spread: 0 },
  rare: { particleCount: 45, spread: 65 },
  epique: { particleCount: 80, spread: 90 },
  legendaire: { particleCount: 150, spread: 120 },
  mythique: { particleCount: 220, spread: 140 },
  unique: { particleCount: 220, spread: 140 }
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

// Les couleurs de rareté viennent de la base (admin) et ne sont pas garanties d'avoir
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

// ---------------------------------------------------------------------------
// Passage de niveau d'un metier (peche, fouille) : carte plein ecran avec les
// bonus debloques, plutot qu'un simple toast.
// ---------------------------------------------------------------------------
const LevelUpModal = {
  show({ icon, name, level, perks = [], tool = "" }) {
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay levelup-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", `${name} niveau ${level}`);
    overlay.innerHTML = `
      <div class="levelup-card">
        <div class="levelup-icon" aria-hidden="true">${icon}</div>
        <div class="levelup-eyebrow">${name}</div>
        <div class="levelup-level">${typeof level === "number" ? "Niveau " + level : level}</div>
        ${tool ? `<div class="levelup-tool">Nouvel outil : <strong>${tool}</strong></div>` : ""}
        <ul class="levelup-perks">${perks.filter(Boolean).map((p) => `<li>${p}</li>`).join("")}</ul>
        <button type="button" class="btn levelup-close">Super !</button>
      </div>`;
    const close = () => { overlay.remove(); syncScrollLock(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest(".levelup-close")) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    syncScrollLock();
    overlay.querySelector(".levelup-close").focus();
    if (typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal("legendaire");
    if (typeof confetti === "function") confetti({ particleCount: 160, spread: 120, origin: { y: 0.55 } });
  }
};

// Piece detachee qui vient se visser a la place d'un exemplaire (atelier).
function screwPartAnimation() {
  return new Promise((resolve) => {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { resolve(); return; }
    const overlay = document.createElement("div");
    overlay.className = "part-screw-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `<div class="part-screw-slot"><span class="part-screw">&#128297;</span></div>`;
    document.body.appendChild(overlay);
    if (typeof Sfx !== "undefined" && Sfx.click) { Sfx.click(); setTimeout(() => Sfx.click(), 350); setTimeout(() => Sfx.click(), 650); }
    setTimeout(() => { overlay.remove(); resolve(); }, 1100);
  });
}
