// Logique de la page d'ouverture de booster.
// Contrat n8n "extensions" (GET) : { extensions: [{ id, name, key, active, packImageId, cardBackImageId }] }
// Contrat n8n "booster-status" (GET ?userId=...) :
// { count, stardust, extensions: [{ extensionId, name, key, sortOrder, count }] }
// Contrat n8n "open-pack" (POST { userId, extensionId }) :
// { cards: [...], pity: { pullsSinceTop }, booster: { extensionId, count } }
// ou, si le stock est a 0 : { error: "no_boosters", count, extensionId }

let isBusy = false;
let skipToken = null;
let extensionsCache = [];
let statusByExtension = new Map();
let selectedExtensionId = null;
let pendingReveals = 0;

function wait(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    skipToken = () => { clearTimeout(timer); resolve(); };
  });
}
function requestSkip() {
  if (skipToken) { const fn = skipToken; skipToken = null; fn(); }
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
    celebrateRarity(card.rarity?.key);
    pendingReveals--;
    if (pendingReveals <= 0) {
      const btn = document.getElementById("reveal-all-btn");
      if (btn) btn.remove();
      isBusy = false;
    }
  };
  wrap.addEventListener("click", flip);
  wrap._flip = flip;
  return wrap;
}

function celebrateRarity(key) {
  if (key === "legendaire") {
    document.body.classList.remove("screen-shake");
    void document.body.offsetWidth;
    document.body.classList.add("screen-shake");
    if (typeof confetti === "function") {
      confetti({ particleCount: 220, spread: 120, origin: { y: 0.5 }, colors: ["#f5a524", "#ffd166", "#ffffff"] });
      setTimeout(() => confetti({ particleCount: 140, spread: 160, origin: { y: 0.4 }, colors: ["#f5a524", "#ffffff"] }), 250);
      setTimeout(() => confetti({ particleCount: 100, angle: 60, spread: 70, origin: { x: 0, y: 0.6 } }), 400);
      setTimeout(() => confetti({ particleCount: 100, angle: 120, spread: 70, origin: { x: 1, y: 0.6 } }), 400);
    }
    Toast.success("Legendaire !");
  } else if (key === "epique" && typeof confetti === "function") {
    confetti({ particleCount: 90, spread: 90, origin: { y: 0.5 }, colors: ["#a855f7", "#d8b4fe"] });
  }
}

function currentExtension() {
  return extensionsCache.find((e) => e.id === selectedExtensionId);
}

function renderExtensionPicker() {
  const el = document.getElementById("extension-picker");
  if (!extensionsCache.length) {
    el.innerHTML = `<div class="empty-state">Aucune extension configuree pour l'instant.</div>`;
    return;
  }
  el.innerHTML = extensionsCache.map((ext) => {
    const count = (statusByExtension.get(ext.id) || {}).count || 0;
    const img = API.imageUrl(ext.packImageId);
    const disabled = count < 1;
    return `
      <div class="extension-tile ${disabled ? "disabled" : ""} ${ext.id === selectedExtensionId ? "selected" : ""}" data-ext-id="${ext.id}">
        ${img ? `<img src="${img}" alt="" />` : `<div class="booster-emoji" style="font-size:2rem;">&#127183;</div>`}
        <div class="ext-name">${ext.name}</div>
        <div class="ext-count">${count} booster${count > 1 ? "s" : ""}</div>
      </div>
    `;
  }).join("");

  el.querySelectorAll(".extension-tile:not(.disabled)").forEach((tile) => {
    tile.addEventListener("click", () => {
      if (isBusy) return;
      selectExtension(Number(tile.dataset.extId));
    });
  });
}

function selectExtension(extensionId) {
  selectedExtensionId = extensionId;
  document.querySelectorAll(".extension-tile").forEach((t) => {
    t.classList.toggle("selected", Number(t.dataset.extId) === extensionId);
  });
  renderHero();
}

function renderHero() {
  const ext = currentExtension();
  const heroZone = document.getElementById("booster-hero-zone");
  const pack = document.getElementById("booster-pack");
  const labelEl = document.getElementById("stock-label");
  const hintEl = document.getElementById("booster-hint");
  if (!ext) {
    heroZone.style.display = "none";
    return;
  }
  heroZone.style.display = "flex";
  const count = (statusByExtension.get(ext.id) || {}).count || 0;
  const img = API.imageUrl(ext.packImageId);

  pack.innerHTML = img
    ? `<img src="${img}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:16px;position:absolute;inset:0;" />`
    : `<div class="booster-emoji">&#127183;</div><div class="booster-title">${ext.name}</div><div class="booster-sub">5 cartes</div>`;

  labelEl.textContent = `${ext.name} - ${count} booster${count > 1 ? "s" : ""} disponible${count > 1 ? "s" : ""}`;
  pack.classList.toggle("locked", count < 1);
  hintEl.innerHTML = count > 0
    ? "Tape sur le booster pour l'ouvrir"
    : `Reclame un code d'evenement pour recevoir des boosters (page <a href="redeem.html">Reclamer un code</a>)`;
}

async function refreshStatus(keepSelection) {
  try {
    const [extRes, statusRes] = await Promise.all([
      API.getExtensions(),
      API.getBoosterStatus(Session.userId)
    ]);
    extensionsCache = (extRes.extensions || []).filter((e) => e.active).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    statusByExtension = new Map((statusRes.extensions || []).map((e) => [e.extensionId, e]));

    if (!keepSelection || !currentExtension()) {
      const firstAvailable = extensionsCache.find((e) => (statusByExtension.get(e.id) || {}).count > 0);
      selectedExtensionId = (firstAvailable || extensionsCache[0] || {}).id ?? null;
    }
    renderExtensionPicker();
    renderHero();
  } catch (e) {
    Toast.error("Impossible de recuperer les extensions/boosters. (" + e.message + ")");
  }
}

async function openBooster() {
  const ext = currentExtension();
  if (isBusy || !ext) return;
  const count = (statusByExtension.get(ext.id) || {}).count || 0;
  if (count < 1) return;
  isBusy = true;

  const pack = document.getElementById("booster-pack");
  const flash = document.getElementById("burst-flash");
  const grid = document.getElementById("reveal-grid");
  const skipHint = document.getElementById("skip-hint");
  grid.innerHTML = "";
  grid.classList.add("hearthstone");
  const oldRevealAll = document.getElementById("reveal-all-btn");
  if (oldRevealAll) oldRevealAll.remove();
  skipHint.classList.add("visible");

  pack.classList.add("charging");

  try {
    const res = await API.openPack(Session.userId, ext.id);

    if (res.error === "no_boosters") {
      pack.classList.remove("charging");
      skipHint.classList.remove("visible");
      await refreshStatus(true);
      Toast.error("Plus de booster disponible pour l'instant.");
      isBusy = false;
      return;
    }

    await wait(500);
    pack.classList.remove("charging");
    pack.classList.add("tearing");
    flash.classList.add("flash-active");

    await wait(480);
    skipHint.classList.remove("visible");
    pack.classList.remove("tearing");

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
    }

    flash.classList.remove("flash-active");
    if (res.booster) {
      statusByExtension.set(res.booster.extensionId, { ...(statusByExtension.get(res.booster.extensionId) || {}), count: res.booster.count });
      renderExtensionPicker();
      renderHero();
    }
    loadHeaderBoosterBadge();
    // isBusy repasse a false une fois toutes les cartes tapees (voir buildCardEl).
  } catch (e) {
    pack.classList.remove("charging", "tearing");
    skipHint.classList.remove("visible");
    Toast.error("Erreur lors de l'ouverture du booster. (" + e.message + ")");
    isBusy = false;
  }
}

// Petite trainee d'etincelles qui suit le curseur, ambiance gacha.
function initSparkleTrail() {
  if (window.matchMedia("(hover: none)").matches) return; // pas sur tactile
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
  document.getElementById("booster-pack").addEventListener("click", () => {
    if (isBusy) requestSkip();
    else openBooster();
  });
  refreshStatus(false);
  initSparkleTrail();
});
