// Logique de la page d'ouverture de booster.
// Contrat n8n "extensions" (GET) : { extensions: [{ id, name, key, active, packImageId, cardBackImageId }] }
// Contrat n8n "booster-status" (GET ?userId=...) :
// { count, stardust, extensions: [{ extensionId, name, key, sortOrder, pullsSinceTop }] }
// (count = solde GENERIQUE, commun a toutes les extensions ; c'est
// l'utilisateur qui choisit avec quelle extension le depenser)
// Contrat n8n "open-pack" (POST { userId, extensionId }) :
// { cards: [...], pity: { pullsSinceTop }, booster: { extensionId, count } }
// ou, si le stock est a 0 : { error: "no_boosters", count, extensionId }
//
// L'ouverture se fait dans un modal plein ecran (#pack-modal-overlay), pas
// inline dans la page : la page ne montre que le choix du pack a ouvrir.

let isBusy = false;
let skipToken = null;
let extensionsCache = [];
let boosterCount = 0;
let pendingReveals = 0;

// Attend `ms` millisecondes, sauf si l'utilisateur tape pour accelerer.
function wait(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    skipToken = () => { clearTimeout(timer); resolve(); };
  });
}
function requestSkip() {
  if (skipToken) {
    const fn = skipToken;
    skipToken = null;
    fn();
  }
}

function buildCardBackEl(cardBackImageId) {
  const back = document.createElement("div");
  back.className = "card-face card-back";
  const src = API.imageUrl(cardBackImageId);
  back.innerHTML = src
    ? `<img class="card-back-image" src="${src}" alt="" /><span class="tap-hint" style="position:relative;z-index:1;">Tape pour reveler</span>`
    : `<span>?</span><span class="tap-hint">Tape pour reveler</span>`;
  return back;
}

function buildCardEl(card, index, cardBackImageId) {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.dataset.rarity = card.rarity?.key || "commune";
  wrap.style.animationDelay = `${index * 90}ms`;

  const color = card.rarity?.colorHex || "#9aa0b4";
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;

  const inner = document.createElement("div");
  inner.className = "card-inner";
  inner.appendChild(buildCardBackEl(cardBackImageId));

  const front = document.createElement("div");
  front.className = "card-face card-front";
  front.innerHTML = `
    <img src="${imgSrc}" alt="${card.name}" />
    <div class="card-info">
      <div class="card-name">${card.name}</div>
      <div class="card-artist">${card.artist || ""}</div>
      <span class="rarity-badge" style="background:${color}22;color:${color};border:1px solid ${color};">
        ${card.rarity?.name || "Commune"}
      </span>
    </div>
  `;
  inner.appendChild(front);
  wrap.appendChild(inner);

  const flip = () => {
    if (wrap.classList.contains("revealed")) return;
    wrap.classList.add("revealed");
    celebrateRarity(card.rarity?.key, wrap);
    pendingReveals--;
    if (pendingReveals <= 0) onAllRevealed();
  };
  wrap.addEventListener("click", flip);
  wrap._flip = flip;
  return wrap;
}

function onAllRevealed() {
  const btn = document.getElementById("reveal-all-btn");
  if (btn) btn.remove();
  isBusy = false;
  const hint = document.getElementById("booster-hint");
  if (hint) hint.textContent = "Toutes les cartes sont revelees !";
}

// Important : l'effet legendaire n'anime JAMAIS le transform d'un ancetre
// des cartes (document.body notamment). Les cartes de reveal utilisent
// transform-style:preserve-3d pour le flip 3D ; animer le transform d'un
// parent commun casse ce rendu dans certains navigateurs (c'est ce qui
// provoquait un blocage de la page). L'effet est donc isole a un calque de
// flash plein ecran + un filtre sur la carte elle-meme uniquement.
function celebrateRarity(key, cardEl) {
  if (key === "legendaire") {
    const flash = document.getElementById("legendary-flash");
    if (flash) {
      flash.classList.remove("active");
      void flash.offsetWidth;
      flash.classList.add("active");
    }
    if (cardEl) {
      cardEl.classList.remove("legendary-hit");
      void cardEl.offsetWidth;
      cardEl.classList.add("legendary-hit");
    }
    if (typeof confetti === "function") {
      confetti({ particleCount: 160, spread: 110, origin: { y: 0.5 }, colors: ["#f5a524", "#ffd166", "#ffffff"] });
      setTimeout(() => confetti({ particleCount: 90, spread: 140, origin: { y: 0.4 }, colors: ["#f5a524", "#ffffff"] }), 220);
    }
    Toast.success("Legendaire !");
  } else if (key === "epique" && typeof confetti === "function") {
    confetti({ particleCount: 70, spread: 85, origin: { y: 0.5 }, colors: ["#a855f7", "#d8b4fe"] });
  }
}

function extensionById(id) {
  return extensionsCache.find((e) => e.id === id);
}

function renderBoosterCountLabel() {
  const el = document.getElementById("booster-count-label");
  if (!el) return;
  el.textContent = `${boosterCount} booster${boosterCount > 1 ? "s" : ""} disponible${boosterCount > 1 ? "s" : ""}`;
}

function renderExtensionPicker() {
  renderBoosterCountLabel();
  const el = document.getElementById("extension-picker");
  if (!extensionsCache.length) {
    el.innerHTML = `<div class="empty-state">Aucune extension configuree pour l'instant.</div>`;
    return;
  }
  const disabled = boosterCount < 1;
  el.innerHTML = extensionsCache.map((ext) => {
    const img = API.imageUrl(ext.packImageId);
    return `
      <div class="extension-tile ${disabled ? "disabled" : ""}" data-ext-id="${ext.id}">
        ${img ? `<img src="${img}" alt="" />` : `<div class="booster-emoji" style="font-size:2rem;">&#127183;</div>`}
        <div class="ext-name">${ext.name}</div>
        <div class="ext-count">Ouvrir</div>
      </div>
    `;
  }).join("");

  el.querySelectorAll(".extension-tile:not(.disabled)").forEach((tile) => {
    tile.addEventListener("click", () => openModalFor(Number(tile.dataset.extId)));
  });
}

async function refreshStatus() {
  try {
    const [extRes, statusRes] = await Promise.all([
      API.getExtensions(),
      API.getBoosterStatus(Session.userId)
    ]);
    extensionsCache = (extRes.extensions || []).filter((e) => e.active).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    boosterCount = statusRes.count || 0;
    renderExtensionPicker();
  } catch (e) {
    Toast.error("Impossible de recuperer les extensions/boosters. (" + e.message + ")");
  }
}

// Ouvre le modal sur le pack de l'extension choisie, pret a etre tape pour
// demarrer l'ouverture (le tirage reel n'a pas encore eu lieu a ce stade).
function openModalFor(extensionId) {
  if (isBusy || boosterCount < 1) return;
  const ext = extensionById(extensionId);
  if (!ext) return;

  const overlay = document.getElementById("pack-modal-overlay");
  const pack = document.getElementById("booster-pack");
  const grid = document.getElementById("reveal-grid");
  const hint = document.getElementById("booster-hint");

  grid.innerHTML = "";
  const oldRevealAll = document.getElementById("reveal-all-btn");
  if (oldRevealAll) oldRevealAll.remove();
  pack.classList.remove("locked", "charging", "tearing");
  pack.style.visibility = "visible";

  const img = API.imageUrl(ext.packImageId);
  pack.innerHTML = img
    ? `<img src="${img}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:16px;position:absolute;inset:0;" />`
    : `<div class="booster-emoji">&#127183;</div><div class="booster-title">${ext.name}</div><div class="booster-sub">5 cartes</div>`;
  hint.textContent = "Tape sur le booster pour l'ouvrir";

  pack.onclick = () => {
    if (isBusy) requestSkip();
    else startOpening(ext);
  };

  overlay.hidden = false;
}

function closeModal() {
  document.getElementById("pack-modal-overlay").hidden = true;
}

async function startOpening(ext) {
  isBusy = true;

  const pack = document.getElementById("booster-pack");
  const flash = document.getElementById("burst-flash");
  const grid = document.getElementById("reveal-grid");
  const skipHint = document.getElementById("skip-hint");
  const hint = document.getElementById("booster-hint");

  skipHint.classList.add("visible");
  pack.classList.add("charging");

  try {
    const res = await API.openPack(Session.userId, ext.id);

    if (res.error === "no_boosters") {
      pack.classList.remove("charging");
      skipHint.classList.remove("visible");
      await refreshStatus();
      Toast.error("Plus de booster disponible pour l'instant.");
      isBusy = false;
      closeModal();
      return;
    }

    await wait(500);
    pack.classList.remove("charging");
    pack.classList.add("tearing");
    flash.classList.add("flash-active");

    await wait(480);
    skipHint.classList.remove("visible");
    pack.classList.remove("tearing");
    pack.style.visibility = "hidden";
    hint.textContent = "Tape sur chaque carte pour la reveler";

    const cards = res.cards || [];
    pendingReveals = cards.length;
    cards.forEach((card, i) => {
      const el = buildCardEl(card, i, ext.cardBackImageId);
      grid.appendChild(el);
    });

    if (cards.length) {
      const revealAllBtn = document.createElement("button");
      revealAllBtn.id = "reveal-all-btn";
      revealAllBtn.className = "btn-secondary";
      revealAllBtn.textContent = "Tout reveler";
      revealAllBtn.addEventListener("click", () => {
        grid.querySelectorAll(".card:not(.revealed)").forEach((el, i) => {
          setTimeout(() => el._flip && el._flip(), i * 160);
        });
      });
      grid.after(revealAllBtn);
    } else {
      onAllRevealed();
    }

    flash.classList.remove("flash-active");
    if (res.booster) {
      boosterCount = res.booster.count;
      renderExtensionPicker();
    }
    loadHeaderBoosterBadge();
    // isBusy repasse a false une fois toutes les cartes tapees (voir onAllRevealed).
  } catch (e) {
    pack.classList.remove("charging", "tearing");
    pack.style.visibility = "visible";
    skipHint.classList.remove("visible");
    Toast.error("Erreur lors de l'ouverture du booster. (" + e.message + ")");
    isBusy = false;
    closeModal();
  }
}

// Petite trainee d'etincelles qui suit le curseur, ambiance gacha (pointeur
// fin uniquement, jamais sur tactile).
function initSparkleTrail() {
  if (window.matchMedia("(hover: none)").matches) return;
  let last = 0;
  document.addEventListener("mousemove", (e) => {
    const now = Date.now();
    if (now - last < 60) return;
    last = now;
    const s = document.createElement("div");
    s.className = "sparkle-trail";
    s.style.left = e.clientX + "px";
    s.style.top = e.clientY + "px";
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 650);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("booster-zone").style.display = "flex";

  const overlay = document.getElementById("pack-modal-overlay");
  document.getElementById("pack-modal-close").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && !isBusy) closeModal();
  });

  refreshStatus();
  initSparkleTrail();
});
