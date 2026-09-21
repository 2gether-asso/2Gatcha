// Logique de la page d'ouverture de booster.
// Contrat n8n "extensions" (GET) : { extensions: [{ id, name, key, active, packImageId, cardBackImageId }] }
// Contrat n8n "booster-status" (GET ?userId=...) :
// { count, stardust, extensions: [{ extensionId, name, key, sortOrder, pullsSinceTop }] }
// (count = solde Générique, commun a toutes les extensions ; c'est
// l'utilisateur qui choisit avec quelle extension le depenser)
// Contrat n8n "open-pack" (POST { userId, extensionId }) :
// { cards: [...], pity: { pullsSinceTop }, booster: { extensionId, count } }
// ou, si le stock est a 0 : { error: "no_boosters", count, extensionId }
//
// L'ouverture se fait dans un modal plein écran (#pack-modal-overlay), pas
// inline dans la page : la page ne montre que le choix du pack a ouvrir.

let isBusy = false;
let skipToken = null;
let extensionsCache = [];
let boosterCount = 0;
let pendingReveals = 0;
let pityByExt = new Map();
let openQuantity = 1;
let lastRevealedCards = [];
let stackCardEls = [];
let stackIndex = 0;

const RARITY_ORDER = { commune: 0, rare: 1, epique: 2, legendaire: 3 };

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
    ? `<img class="card-back-image" src="${src}" alt="" /><span class="tap-hint" style="position:relative;z-index:1;">Tape pour révéler</span>`
    : `<span>?</span><span class="tap-hint">Tape pour révéler</span>`;
  return back;
}

function buildCardEl(card, index, cardBackImageId) {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.dataset.rarity = card.rarity?.key || "commune";

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

  // Pile de cartes : seule la carte "active" (au sommet, voir layoutStack)
  // reagit au clic. On avance automatiquement vers la suivante une fois
  // l'effet de reveal joue, plutot que de tout montrer d'un coup.
  const flip = () => {
    if (wrap.classList.contains("revealed") || wrap.dataset.active !== "true") return;
    wrap.classList.add("revealed");
    celebrateRarity(card.rarity?.key, wrap, color);
    setTimeout(advanceStack, 850);
  };
  wrap.addEventListener("click", flip);
  wrap._flip = flip;
  return wrap;
}

// Positionne chaque carte de la pile : la carte a stackIndex est active
// (au sommet, cliquable) ; les suivantes sont decalees en pile derriere
// elle ; les precedentes (deja révélées) se sont envolees sur le cote.
function layoutStack() {
  stackCardEls.forEach((el, i) => {
    const rel = i - stackIndex;
    if (rel < 0) {
      el.classList.add("discarded");
      el.dataset.active = "false";
      el.style.transform = "translateX(-160%) rotate(-18deg)";
      return;
    }
    el.dataset.active = rel === 0 ? "true" : "false";
    const depth = Math.min(rel, 4);
    el.style.transform = `translate(${depth * 5}px, ${depth * 7}px) rotate(${depth * 2}deg) scale(${1 - depth * 0.03})`;
    el.style.zIndex = String(100 - depth);
  });
  const progress = document.getElementById("stack-progress");
  if (progress) {
    progress.textContent = stackCardEls.length
      ? `Carte ${Math.min(stackIndex + 1, stackCardEls.length)} / ${stackCardEls.length}`
      : "";
  }
}

function advanceStack() {
  stackIndex++;
  layoutStack();
  if (stackIndex >= stackCardEls.length) onAllRevealed();
}

function onAllRevealed() {
  const btn = document.getElementById("reveal-all-btn");
  if (btn) btn.remove();
  isBusy = false;
  const hint = document.getElementById("booster-hint");
  if (hint) hint.textContent = "Toutes les cartes sont révélées !";
  const shareBtn = document.getElementById("share-pull-btn");
  if (shareBtn && lastRevealedCards.length) shareBtn.style.display = "inline-flex";
}

// Genere une image partageable (canvas) reprenant le plus beau tirage du
// lot, dans le style d'une vraie carte, et declenche son telechargement.
function shareBestPull() {
  if (!lastRevealedCards.length) return;
  const best = lastRevealedCards.reduce((a, b) => {
    const ka = a.rarity?.key || "commune", kb = b.rarity?.key || "commune";
    return (RARITY_ORDER[kb] ?? 0) > (RARITY_ORDER[ka] ?? 0) ? b : a;
  });
  const color = best.rarity?.colorHex || "#9aa0b4";
  const imgSrc = API.imageUrl(best.imageId) || PLACEHOLDER_IMG;

  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 960;
  const ctx = canvas.getContext("2d");

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    ctx.fillStyle = "#0b0d20";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const grad = ctx.createRadialGradient(360, 300, 40, 360, 300, 500);
    grad.addColorStop(0, color + "55");
    grad.addColorStop(1, "#0b0d2000");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const artH = 620;
    ctx.drawImage(img, 40, 40, canvas.width - 80, artH);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.strokeRect(40, 40, canvas.width - 80, artH);

    ctx.fillStyle = "#f5f5fc";
    ctx.font = "700 34px Sora, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(best.name || "Carte", canvas.width / 2, artH + 100);

    ctx.fillStyle = color;
    ctx.font = "800 24px Sora, sans-serif";
    ctx.fillText((best.rarity?.name || "Commune").toUpperCase(), canvas.width / 2, artH + 145);

    ctx.fillStyle = "#9a9cc4";
    ctx.font = "500 20px Inter, sans-serif";
    ctx.fillText("2Gatcha – " + (Session.pseudo || ""), canvas.width / 2, canvas.height - 30);

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `2gatcha-${(best.name || "carte").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
  };
  // Note : le partage necessite que le workflow get-image.json renvoie un
  // en-tete Access-Control-Allow-Origin (sinon le navigateur refuse de lire
  // les pixels de l'image sur le canvas et declenche onerror ici plutot
  // qu'une erreur silencieuse).
  img.onerror = () => Toast.error("Impossible de générer l'image a partager (probleme de CORS sur le serveur d'images).");
  img.src = imgSrc;
}

// Important : l'effet legendaire n'anime JAMAIS le transform d'un ancetre
// des cartes (document.body notamment). Les cartes de reveal utilisent
// transform-style:preserve-3d pour le flip 3D ; animer le transform d'un
// parent commun casse ce rendu dans certains navigateurs (c'est ce qui
// provoquait un blocage de la page). L'effet est donc isole a un calque de
// flash plein écran + un filtre sur la carte elle-meme uniquement.
//
// Les particules (spawnRarityBurst, main.js) sont sur un calque a
// z-index:420, au-dessus du modal d'ouverture (400) et du flash legendaire
// (410) : elles restent visibles par-dessus toute la modale plein écran.
function celebrateRarity(key, cardEl, colorHex) {
  spawnRarityBurst(key, colorHex, cardEl);
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
    Toast.success("Légendaire !");
  }
}

function extensionById(id) {
  return extensionsCache.find((e) => e.id === id);
}

// Fondu enchaine entre le fond de la modale d'une extension a l'autre :
// on empile un nouveau calque avec opacity:0 -> 1 (transition CSS), puis on
// retire les calques precedents une fois le fondu termine. Un changement
// direct de `background-image` ne se fond pas de facon fiable entre
// navigateurs, d'ou ce calque dedie.
function crossfadeModalBackground(imgUrl) {
  const overlay = document.getElementById("pack-modal-overlay");
  if (!overlay) return;
  const layer = document.createElement("div");
  layer.className = "pack-modal-bg-layer";
  if (imgUrl) {
    layer.style.backgroundImage =
      `radial-gradient(circle at 50% 30%, rgba(139,92,246,0.25), transparent 55%), linear-gradient(rgba(4,5,12,0.88), rgba(4,5,12,0.96)), url(${imgUrl})`;
  }
  overlay.insertBefore(layer, overlay.firstChild);
  requestAnimationFrame(() => { layer.classList.add("visible"); });

  const previous = overlay.querySelectorAll(".pack-modal-bg-layer:not(:first-child)");
  setTimeout(() => previous.forEach((el) => el.remove()), 550);
}

// Leger tilt 3D du packet, qui suit le curseur avant meme d'etre tape
// (effet lenticulaire). Pointeur fin uniquement.
function attachPackTilt(pack) {
  if (pack._tiltAttached) return;
  pack._tiltAttached = true;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  pack.addEventListener("mousemove", (e) => {
    if (pack.classList.contains("charging") || pack.classList.contains("tearing")) return;
    const rect = pack.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    pack.style.setProperty("--pack-ry", `${px * 14}deg`);
    pack.style.setProperty("--pack-rx", `${py * -14}deg`);
  });
  pack.addEventListener("mouseleave", () => {
    pack.style.setProperty("--pack-rx", "0deg");
    pack.style.setProperty("--pack-ry", "0deg");
  });
}

// Poussière ambiante flottante dans la modale d'ouverture (distincte de la
// trainee qui suit le curseur) : quelques particules lentes qui montent et
// se dissipent, tant que la modale est ouverte.
let ambientParticleTimer = null;
function startAmbientParticles() {
  stopAmbientParticles();
  const overlay = document.getElementById("pack-modal-overlay");
  if (!overlay) return;
  ambientParticleTimer = setInterval(() => {
    if (overlay.hidden) return;
    const p = document.createElement("span");
    p.className = "ambient-dust";
    p.style.left = `${5 + Math.random() * 90}%`;
    p.style.animationDuration = `${4 + Math.random() * 3}s`;
    overlay.appendChild(p);
    setTimeout(() => p.remove(), 7000);
  }, 900);
}
function stopAmbientParticles() {
  if (ambientParticleTimer) clearInterval(ambientParticleTimer);
  ambientParticleTimer = null;
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
    const pity = pityByExt.get(ext.id) || 0;
    return `
      <div class="extension-tile ${disabled ? "disabled" : ""}" data-ext-id="${ext.id}">
        ${img ? `<img src="${img}" alt="" />` : `<div class="booster-emoji" style="font-size:2rem;">&#127183;</div>`}
        <div class="ext-name">${ext.name}</div>
        <div class="ext-count">Ouvrir</div>
        <div class="pity-row" title="Nombre de tirages depuis la dernière legendaire">
          <span>${rarityIcon("legendaire")}</span>
          <span>${pity} tirage${pity > 1 ? "s" : ""}</span>
        </div>
      </div>
    `;
  }).join("");

  el.querySelectorAll(".extension-tile:not(.disabled)").forEach((tile) => {
    tile.addEventListener("click", () => openModalFor(Number(tile.dataset.extId)));
  });
}

function renderExtensionPickerSkeleton() {
  const el = document.getElementById("extension-picker");
  if (!el) return;
  el.innerHTML = Array.from({ length: 3 }).map(() => `
    <div class="extension-tile skeleton-tile">
      <div class="skeleton-card" style="aspect-ratio:3/4;margin-bottom:8px;"></div>
      <div class="skeleton-row" style="height:14px;margin-bottom:0;"></div>
    </div>
  `).join("");
}

async function refreshStatus() {
  renderExtensionPickerSkeleton();
  try {
    const [extRes, statusRes] = await Promise.all([
      API.getExtensions(),
      API.getBoosterStatus(Session.userId)
    ]);
    extensionsCache = (extRes.extensions || []).filter((e) => e.active).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    boosterCount = statusRes.count || 0;
    pityByExt = new Map((statusRes.extensions || []).map((e) => [e.extensionId, e.pullsSinceTop || 0]));
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
  stackCardEls = [];
  stackIndex = 0;
  const progressEl = document.getElementById("stack-progress");
  if (progressEl) progressEl.textContent = "";
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

  // Skin de fond par extension : le packet flou en toile de fond de la
  // modale, pour que chaque extension ait une ambiance visuelle distincte.
  // Fondu enchaine plutot qu'un changement instantane quand on choisit une
  // autre extension (voir crossfadeModalBackground).
  crossfadeModalBackground(img);
  attachPackTilt(pack);

  const qtyPicker = document.getElementById("quantity-picker");
  if (qtyPicker) {
    qtyPicker.style.display = "flex";
    openQuantity = 1;
    qtyPicker.querySelectorAll("button").forEach((b) => {
      const qty = Number(b.dataset.qty);
      b.classList.toggle("active", qty === 1);
      b.disabled = qty > boosterCount;
    });
  }
  const shareBtn = document.getElementById("share-pull-btn");
  if (shareBtn) shareBtn.style.display = "none";

  overlay.hidden = false;
  syncScrollLock();
  startAmbientParticles();
}

function closeModal() {
  document.getElementById("pack-modal-overlay").hidden = true;
  syncScrollLock();
  stopAmbientParticles();
}

async function startOpening(ext) {
  isBusy = true;

  const pack = document.getElementById("booster-pack");
  const flash = document.getElementById("burst-flash");
  const grid = document.getElementById("reveal-grid");
  const skipHint = document.getElementById("skip-hint");
  const hint = document.getElementById("booster-hint");
  const qtyPicker = document.getElementById("quantity-picker");

  if (qtyPicker) qtyPicker.style.display = "none";
  skipHint.classList.add("visible");
  pack.classList.add("charging");

  try {
    // x1 ou x5 : on ouvre les boosters demandes a la suite (chaque appel
    // reste un tirage independant cote backend), puis on révélé tout
    // ensemble pour ne pas repeter l'animation de dechirure N fois.
    const quantity = Math.min(openQuantity, boosterCount);
    const allCards = [];
    let lastBoosterInfo = null;
    for (let i = 0; i < quantity; i++) {
      const res = await API.openPack(Session.userId, ext.id);
      if (res.error === "no_boosters") {
        if (i === 0) {
          pack.classList.remove("charging");
          skipHint.classList.remove("visible");
          await refreshStatus();
          Toast.error("Plus de booster disponible pour l'instant.");
          isBusy = false;
          closeModal();
          return;
        }
        break;
      }
      allCards.push(...(res.cards || []));
      lastBoosterInfo = res.booster;
    }

    // Intensifie le tremblement du pack selon la meilleure rareté deja
    // tiree (spoiler discret, courant dans les jeux gacha).
    const bestRarity = allCards.reduce((best, c) => {
      const k = c.rarity?.key || "commune";
      return (RARITY_ORDER[k] ?? 0) > (RARITY_ORDER[best] ?? 0) ? k : best;
    }, "commune");
    if (bestRarity === "legendaire" || bestRarity === "epique" || bestRarity === "rare") {
      pack.classList.add("charging-" + bestRarity);
    }

    // Sequence volontairement plus lente qu'avant : charge (750ms) ->
    // dechirure marquee (750ms, voir packTear) -> court silence (250ms)
    // avant l'apparition des cartes. Le pull est LE moment fort de la
    // page, il ne doit pas se sentir expedie.
    await wait(750);
    pack.classList.remove("charging", "charging-legendaire", "charging-epique", "charging-rare");
    pack.classList.add("tearing");
    flash.classList.add("flash-active");
    skipHint.classList.remove("visible");

    await wait(750);
    pack.classList.remove("tearing");
    pack.style.visibility = "hidden";

    await wait(250);
    hint.textContent = "Tape sur chaque carte pour la révéler";

    lastRevealedCards = allCards;
    stackIndex = 0;
    stackCardEls = allCards.map((card, i) => {
      const el = buildCardEl(card, i, ext.cardBackImageId);
      grid.appendChild(el);
      return el;
    });
    layoutStack();

    if (allCards.length) {
      const revealAllBtn = document.createElement("button");
      revealAllBtn.id = "reveal-all-btn";
      revealAllBtn.className = "btn-secondary";
      revealAllBtn.textContent = "Tout révéler";
      revealAllBtn.addEventListener("click", () => {
        // Meme en pile, on ne peut révéler qu'une carte a la fois (chacune
        // doit passer au sommet pour reagir au clic) : on enchaine les
        // reveals automatiquement au meme rythme que l'utilisateur.
        revealAllBtn.disabled = true;
        const playNext = () => {
          const active = stackCardEls[stackIndex];
          if (!active) return;
          active._flip();
          setTimeout(playNext, 950);
        };
        playNext();
      });
      grid.after(revealAllBtn);
    } else {
      onAllRevealed();
    }

    flash.classList.remove("flash-active");
    if (lastBoosterInfo) {
      boosterCount = lastBoosterInfo.count;
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

  const qtyPicker = document.getElementById("quantity-picker");
  if (qtyPicker) {
    qtyPicker.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (isBusy || btn.disabled) return;
        openQuantity = Number(btn.dataset.qty);
        qtyPicker.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
  }

  const shareBtn = document.getElementById("share-pull-btn");
  if (shareBtn) shareBtn.addEventListener("click", shareBestPull);

  refreshStatus();
});
