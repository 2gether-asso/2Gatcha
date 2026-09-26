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

const FINISH_LABELS = { holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
const QUALITY_LABELS = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };

let isBusy = false;
let skipToken = null;
let extensionsCache = [];
let boosterCount = 0;
let pendingReveals = 0;
let pityByExt = new Map();
let pityThreshold = 0;
let openQuantity = 1;
let lastRevealedCards = [];
let stackCardEls = [];
let stackIndex = 0;
let ownedCountMap = new Map();
let extProgressByExt = new Map();
let catalogCache = [];
let lastOpenedExtension = null;

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

// Le dos de la carte laisse deviner un peu d'intensite avant meme le flip
// (comme le "shine" d'un pack dans TCG Pocket) : pas la rarete exacte, juste
// une lueur plus ou moins marquee, pour nourrir l'anticipation sans gacher
// la surprise.
function buildCardBackEl(cardBackImageId, rarityKey, colorHex) {
  const back = document.createElement("div");
  back.className = "card-face card-back";
  if (rarityKey && rarityKey !== "commune") back.classList.add("card-back-shine", "shine-" + rarityKey);
  if (colorHex) back.style.setProperty("--shine-color", colorHex);
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
  // Meme attributs que .collection-card/.card-modal : la carte reveleee doit
  // montrer le meme traitement visuel marque (bordure/degrade/filtre) qu'une
  // finition/qualite speciale affichee ailleurs, pas juste un petit badge.
  wrap.dataset.finish = card.finish || "normal";
  wrap.dataset.quality = card.quality || "damaged";

  const color = card.rarity?.colorHex || "#9aa0b4";
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;

  const inner = document.createElement("div");
  inner.className = "card-inner";
  inner.appendChild(buildCardBackEl(cardBackImageId, card.rarity?.key, color));

  const dupeBadge = card.isFirstEver
    ? `<span class="new-badge first-ever-badge">&#127942; 1ère obtention du serveur !</span>`
    : card.isNewToPlayer
      ? `<span class="new-badge">Nouvelle !</span>`
      : `<span class="dupe-badge">×${card.ownedCountAfter}</span>`;
  // Finition ET qualite sont chacune un vrai tirage independant a 10% de
  // sortir mieux que la base (voir open-pack.json) - les deux se voient
  // d'un coup d'oeil des le reveal, pas seulement au survol.
  const finish = card.finish || "normal";
  const finishBadge = finish !== "normal" ? `<span class="finish-indicator" data-finish="${finish}">${FINISH_LABELS[finish] || finish}</span>` : "";
  const quality = card.quality || "damaged";
  const qualityBadge = `<span class="quality-indicator" data-quality="${quality}">${QUALITY_LABELS[quality] || quality}</span>`;
  const front = document.createElement("div");
  front.className = "card-face card-front";
  front.innerHTML = `
    ${dupeBadge}
    <div class="card-art">
      <img src="${imgSrc}" alt="${card.name}" />
      ${finishBadge}
      ${qualityBadge}
    </div>
    <div class="card-info">
      <div class="card-name">${card.name}</div>
      <div class="card-artist">${card.artist || ""}</div>
      <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">
        ${card.rarity?.name || "Commune"}
      </span>
    </div>
  `;
  inner.appendChild(front);
  wrap.appendChild(inner);

  // Pile de cartes : seule la carte "active" (au sommet, voir layoutStack)
  // reagit au clic. Premier tap : revele la carte, qui reste affichee tant
  // qu'on ne re-tape pas dessus. Deuxieme tap (carte deja revelee) : fait
  // avancer la pile vers la suivante - plus d'avancement automatique, il
  // faut un clic explicite pour que la carte parte dans la collection.
  const flip = () => {
    if (wrap.dataset.active !== "true") return;
    if (!wrap.classList.contains("revealed")) {
      wrap.classList.add("revealed");
      Sfx.flip();
      setTimeout(() => Sfx.reveal(card.rarity?.key), 260);
      celebrateRarity(card.rarity?.key, wrap, color);
      return;
    }
    advanceStack();
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

  // Precharge l'image de la carte suivante pendant qu'on regarde la carte
  // active : evite un petit flash/attente au moment ou elle passe au sommet.
  const next = lastRevealedCards[stackIndex + 1];
  if (next) {
    const src = API.imageUrl(next.imageId);
    if (src) { const img = new Image(); img.src = src; }
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

  // Recap de session (utile surtout apres un x5) : repartition par rarete
  // du lot qui vient d'etre revele, + rappel du solde restant.
  if (lastRevealedCards.length > 1) {
    const counts = {};
    lastRevealedCards.forEach((c) => {
      const key = c.rarity?.key || "commune";
      counts[key] = (counts[key] || 0) + 1;
    });
    const order = ["legendaire", "epique", "rare", "commune"];
    const parts = order.filter((k) => counts[k]).map((k) => `${counts[k]} ${rarityIcon(k)}`);
    if (hint) hint.innerHTML = `Terminé : ${parts.join(" · ")}`;
  } else if (hint) {
    hint.textContent = "Toutes les cartes sont révélées !";
  }
  if (boosterCount > 0) {
    Toast.info(`Il te reste ${boosterCount} booster${boosterCount > 1 ? "s" : ""} disponible${boosterCount > 1 ? "s" : ""}.`);
  }

  const shareBtn = document.getElementById("share-pull-btn");
  if (shareBtn && lastRevealedCards.length) shareBtn.style.display = "inline-flex";

  // Enchainer directement sur un autre booster de la meme extension, sans
  // repasser par le selecteur : le cas d'usage principal (ouvrir plusieurs
  // boosters d'affilee) ne devrait pas demander de fermer/rouvrir la modale
  // a chaque fois.
  const openAnotherBtn = document.getElementById("open-another-btn");
  if (openAnotherBtn) {
    if (lastOpenedExtension && boosterCount > 0) {
      const icon = String.fromCodePoint(128257);
      openAnotherBtn.textContent = `${icon} Ouvrir un autre (${boosterCount} restant${boosterCount > 1 ? "s" : ""})`;
      openAnotherBtn.style.display = "inline-flex";
    } else {
      openAnotherBtn.style.display = "none";
    }
  }
}

function loadImageCORS(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Dessine une image en mode "cover" (recadree, jamais deformee) dans une
// boite donnee - le drawImage brut precedent etirait l'art au format de la
// boite, ce qui donnait des visuels ecrases/deformes selon le ratio source.
function drawImageCover(ctx, img, x, y, w, h) {
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;
  let sx, sy, sw, sh;
  if (imgRatio > boxRatio) {
    sh = img.height; sw = sh * boxRatio; sx = (img.width - sw) / 2; sy = 0;
  } else {
    sw = img.width; sh = sw / boxRatio; sx = 0; sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Genere une image partageable (canvas) reprenant le plus beau tirage du
// lot dans un vrai cadre de carte (bordure/lueur couleur rarete, art
// recadre proprement), avec le reste du lot en bandeau et le branding du
// site - remplace l'ancienne version (une simple image etiree + du texte).
async function shareBestPull() {
  if (!lastRevealedCards.length) return;
  const shareBtn = document.getElementById("share-pull-btn");
  const originalLabel = shareBtn ? shareBtn.innerHTML : "";
  if (shareBtn) { shareBtn.disabled = true; shareBtn.innerHTML = "Génération..."; }

  try {
    const best = lastRevealedCards.reduce((a, b) => {
      const ka = a.rarity?.key || "commune", kb = b.rarity?.key || "commune";
      return (RARITY_ORDER[kb] ?? 0) > (RARITY_ORDER[ka] ?? 0) ? b : a;
    });
    const color = best.rarity?.colorHex || "#9aa0b4";
    const others = lastRevealedCards.filter((c) => c !== best).slice(0, 4);

    const [bestImg, ...otherImgs] = await Promise.all([
      loadImageCORS(API.imageUrl(best.imageId) || PLACEHOLDER_IMG),
      ...others.map((c) => loadImageCORS(API.imageUrl(c.imageId) || PLACEHOLDER_IMG).catch(() => null))
    ]);
    // Les polices web (Bungee/Inter) doivent etre chargees AVANT de dessiner
    // du texte sur le canvas, sinon le navigateur rend avec une police de
    // secours generique (c'etait l'une des causes du rendu "cheap" precedent).
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    const W = 1080, H = 1440;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.textAlign = "center";

    // Fond : couleur de base + halo colore rarete + legere trame d'etoiles,
    // dans l'esprit du fond ambiant du site (body::before/after).
    ctx.fillStyle = "#06070f";
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, 500, 60, W / 2, 500, 640);
    glow.addColorStop(0, color + "4d");
    glow.addColorStop(1, "#06070f00");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    for (let i = 0; i < 70; i++) {
      const sx = (i * 197) % W, sy = (i * 359 + 40) % H;
      ctx.beginPath();
      ctx.arc(sx, sy, i % 5 === 0 ? 1.6 : 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wordmark degrade (meme esprit que .brand en CSS).
    ctx.font = "400 46px Bungee, sans-serif";
    const wmGrad = ctx.createLinearGradient(W / 2 - 150, 0, W / 2 + 150, 0);
    wmGrad.addColorStop(0, "#8b5cf6");
    wmGrad.addColorStop(1, "#22d3ee");
    ctx.fillStyle = wmGrad;
    ctx.fillText("2GATCHA", W / 2, 88);
    ctx.font = "600 26px Inter, sans-serif";
    ctx.fillStyle = "#9a9cc4";
    ctx.fillText(lastOpenedExtension?.name || "Ouverture de booster", W / 2, 128);

    // Cadre de la carte principale : lueur douce, art recadre (jamais
    // deforme), double liseré colore comme les vraies cartes du site.
    const cardW = 560, cardH = 750;
    const cardX = (W - cardW) / 2, cardY = 168;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 80;
    roundRectPath(ctx, cardX, cardY, cardW, cardH, 28);
    ctx.fillStyle = "#14162e";
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, cardX, cardY, cardW, cardH, 28);
    ctx.clip();
    drawImageCover(ctx, bestImg, cardX, cardY, cardW, cardH);
    if (best.rarity?.key === "legendaire") {
      const sweep = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
      sweep.addColorStop(0, "rgba(255,255,255,0)");
      sweep.addColorStop(0.46, "rgba(255,255,255,0.24)");
      sweep.addColorStop(0.54, "rgba(255,255,255,0)");
      ctx.fillStyle = sweep;
      ctx.fillRect(cardX, cardY, cardW, cardH);
    }
    ctx.restore();

    roundRectPath(ctx, cardX, cardY, cardW, cardH, 28);
    ctx.lineWidth = 7;
    ctx.strokeStyle = color;
    ctx.stroke();
    roundRectPath(ctx, cardX + 9, cardY + 9, cardW - 18, cardH - 18, 21);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();

    // Nom + pastille de rarete (meme habillage que .rarity-badge en CSS).
    ctx.fillStyle = "#f5f5fc";
    ctx.font = "400 48px Bungee, sans-serif";
    ctx.fillText(best.name || "Carte", W / 2, cardY + cardH + 66);

    const rarityLabel = (best.rarity?.name || "Commune").toUpperCase();
    ctx.font = "400 26px Bungee, sans-serif";
    const pillW = ctx.measureText(rarityLabel).width + 74;
    const pillX = (W - pillW) / 2, pillY = cardY + cardH + 92, pillH = 48;
    roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = color + "26";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(rarityLabel, W / 2, pillY + 33);

    // Bandeau du reste du lot (si booster multi-cartes) : chaque vignette
    // garde le liseré de SA propre rarete.
    const validOthers = others.map((c, i) => ({ card: c, img: otherImgs[i] })).filter((o) => o.img);
    if (validOthers.length) {
      const stripY = pillY + 96;
      ctx.font = "600 24px Inter, sans-serif";
      ctx.fillStyle = "#9a9cc4";
      ctx.fillText("+ le reste du lot", W / 2, stripY - 14);

      const thumbW = 150, thumbH = 200, gap = 22;
      const totalW = validOthers.length * thumbW + (validOthers.length - 1) * gap;
      let sx = (W - totalW) / 2;
      validOthers.forEach(({ card, img }) => {
        const c = card.rarity?.colorHex || "#9aa0b4";
        ctx.save();
        roundRectPath(ctx, sx, stripY, thumbW, thumbH, 14);
        ctx.clip();
        drawImageCover(ctx, img, sx, stripY, thumbW, thumbH);
        ctx.restore();
        roundRectPath(ctx, sx, stripY, thumbW, thumbH, 14);
        ctx.lineWidth = 3;
        ctx.strokeStyle = c;
        ctx.stroke();
        sx += thumbW + gap;
      });
    }

    // Pied de page : pseudo + URL du site, pour la viralite.
    ctx.font = "600 24px Inter, sans-serif";
    ctx.fillStyle = "#9a9cc4";
    ctx.fillText((Session.pseudo ? Session.pseudo + "  ·  " : "") + "gatcha.2gether-asso.fr", W / 2, H - 36);

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
  } catch (e) {
    // Le partage necessite que get-image.json renvoie un en-tete
    // Access-Control-Allow-Origin (sinon le navigateur refuse de lire les
    // pixels de l'image sur le canvas et le chargement rejette ici).
    Toast.error("Impossible de générer l'image a partager (probleme de CORS sur le serveur d'images).");
  } finally {
    if (shareBtn) { shareBtn.disabled = false; shareBtn.innerHTML = originalLabel; }
  }
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
// A partir d'epique (pas seulement legendaire) : le flash plein ecran suit
// desormais la VRAIE couleur de la rarete (hexToRgba, main.js) et son
// intensite grandit avec le palier - jamais fige sur l'orange legendaire.
const RARITY_FLASH_TIERS = {
  epique: { alpha: 0.4, duration: "0.7s", brightness: 1.6, className: "tier-epique" },
  legendaire: { alpha: 0.55, duration: "0.9s", brightness: 2, className: "tier-legendaire" },
  mythique: { alpha: 0.7, duration: "1.2s", brightness: 2.6, className: "tier-mythique" }
};
const RARITY_FLASH_TOASTS = { legendaire: "Légendaire !", mythique: "Mythique !" };
function celebrateRarity(key, cardEl, colorHex) {
  spawnRarityBurst(key, colorHex, cardEl);
  const tier = RARITY_FLASH_TIERS[key];
  if (tier) {
    const flash = document.getElementById("legendary-flash");
    if (flash) {
      flash.style.setProperty("--flash-color", hexToRgba(colorHex, tier.alpha));
      flash.style.setProperty("--flash-duration", tier.duration);
      flash.className = "legendary-flash " + tier.className;
      void flash.offsetWidth;
      flash.classList.add("active");
    }
    if (cardEl) {
      cardEl.style.setProperty("--flash-duration", tier.duration);
      cardEl.style.setProperty("--flash-brightness", tier.brightness);
      cardEl.classList.remove("legendary-hit");
      void cardEl.offsetWidth;
      cardEl.classList.add("legendary-hit");
    }
    if (RARITY_FLASH_TOASTS[key]) Toast.success(RARITY_FLASH_TOASTS[key]);
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
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
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
    return;
  }
  // Sur tactile, pas de suivi du doigt (voir collection.js : le touchmove
  // pendant un scroll causait du lag). Le pack n'est en revanche pas dans
  // une grille qui scroll - l'inclinaison du telephone (gyroscope) donne le
  // meme effet sans ce probleme, puisqu'elle ne depend d'aucun geste tactile.
  attachPackGyroTilt(pack);
}

function attachPackGyroTilt(pack) {
  if (typeof DeviceOrientationEvent === "undefined") return;

  function onOrientation(e) {
    if (pack.classList.contains("charging") || pack.classList.contains("tearing")) return;
    const beta = Math.max(-30, Math.min(30, e.beta || 0));
    const gamma = Math.max(-30, Math.min(30, e.gamma || 0));
    pack.style.setProperty("--pack-ry", `${(gamma / 30) * 14}deg`);
    pack.style.setProperty("--pack-rx", `${(-beta / 30) * 14}deg`);
  }

  // iOS 13+ exige une autorisation explicite qui ne peut etre demandee que
  // suite a un geste utilisateur direct - on la demande donc au premier
  // toucher du pack plutot qu'au chargement de la page.
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    pack.addEventListener("touchstart", function requestOnce() {
      pack.removeEventListener("touchstart", requestOnce);
      DeviceOrientationEvent.requestPermission().then((state) => {
        if (state === "granted") window.addEventListener("deviceorientation", onOrientation);
      }).catch(() => {});
    }, { once: true, passive: true });
  } else {
    window.addEventListener("deviceorientation", onOrientation);
  }
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
  el.innerHTML = `<span class="credit-value">${boosterCount}</span> booster${boosterCount > 1 ? "s" : ""} disponible${boosterCount > 1 ? "s" : ""}`;
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
    const backImg = API.imageUrl(ext.cardBackImageId);
    const pity = pityByExt.get(ext.id) || 0;
    const pct = pityThreshold ? Math.min(100, Math.round((pity / pityThreshold) * 100)) : 0;
    const pityLabel = pityThreshold ? `${pity} / ${pityThreshold}` : `${pity} tirage${pity > 1 ? "s" : ""}`;
    const progress = extProgressByExt.get(ext.id);
    return `
      <div class="extension-tile ${disabled ? "disabled" : ""}" data-ext-id="${ext.id}" ${disabled ? "" : 'tabindex="0" role="button" aria-label="Ouvrir un booster ' + ext.name.replace(/"/g, "&quot;") + '"'}>
        <div class="ext-art">
          ${img ? `<img class="ext-art-front" src="${img}" alt="" />` : `<div class="booster-emoji" style="font-size:2rem;">&#127183;</div>`}
          ${backImg ? `<img class="ext-art-back" src="${backImg}" alt="" title="Dos de carte de cette extension" />` : ""}
        </div>
        <div class="ext-name">${ext.name}</div>
        <div class="ext-count">${progress ? `${progress.owned}/${progress.total} cartes` : "Ouvrir"}</div>
        <div class="pity-row" title="Progression vers la légendaire garantie">
          <span class="pity-icon">${rarityIcon("legendaire")}</span>
          <span class="pity-track"><span class="pity-fill" style="width:${pct}%;"></span></span>
          <span class="pity-label">${pityLabel}</span>
        </div>
        <button type="button" class="set-summary-link" data-ext-id="${ext.id}">Voir les cartes du set</button>
      </div>
    `;
  }).join("");

  el.querySelectorAll(".extension-tile:not(.disabled)").forEach((tile) => {
    tile.addEventListener("click", (e) => {
      if (e.target.closest(".set-summary-link")) return;
      openModalFor(Number(tile.dataset.extId));
    });
    tile.addEventListener("keydown", (e) => {
      if ((e.key !== "Enter" && e.key !== " ") || e.target.closest(".set-summary-link")) return;
      e.preventDefault();
      openModalFor(Number(tile.dataset.extId));
    });
  });
  el.querySelectorAll(".set-summary-link").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showSetSummary(Number(btn.dataset.extId));
    });
  });
}

// Sommaire du set : liste des cartes de l'extension (nom + rarete), sans
// reveler le contenu des cartes non decouvertes (silhouette "???", comme
// dans la collection) - un checklist consultable avant meme d'ouvrir.
function showSetSummary(extensionId) {
  const ext = extensionById(extensionId);
  const cards = catalogCache.filter((c) => c.extension?.id === extensionId);
  const overlay = document.createElement("div");
  overlay.className = "card-modal-overlay";
  const rows = cards
    .sort((a, b) => (a.rarity?.sortOrder || 0) - (b.rarity?.sortOrder || 0) || (a.name || "").localeCompare(b.name || ""))
    .map((c) => {
      const owned = ownedCountMap.has(c.cardId);
      const color = c.rarity?.colorHex || "#9aa0b4";
      return `
        <div class="set-summary-row">
          <span class="rarity-dot" style="background:${color};"></span>
          <span>${owned ? c.name : "???"}</span>
          ${c.isPromo ? '<span class="promo-badge">Promo</span>' : ""}
        </div>
      `;
    }).join("");
  overlay.innerHTML = `
    <div class="card-modal set-summary-modal">
      <button class="card-modal-close" aria-label="Fermer">&times;</button>
      <div class="card-modal-body">
        <div class="card-modal-name">${ext ? ext.name : "Extension"}</div>
        <p class="lead" style="font-size:0.8rem;">${cards.length} cartes au total. Les cartes non decouvertes restent masquees.</p>
        <div class="set-summary-list">${rows || `<div class="empty-state">Aucune carte pour l'instant.</div>`}</div>
      </div>
    </div>
  `;
  const close = () => { overlay.remove(); syncScrollLock(); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".card-modal-close").addEventListener("click", close);
  document.body.appendChild(overlay);
  syncScrollLock();
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
    const [extRes, statusRes, collectionRes] = await Promise.all([
      API.getExtensions(),
      API.getBoosterStatus(Session.userId),
      API.getCollection(Session.userId).catch(() => ({ owned: [] }))
    ]);
    extensionsCache = (extRes.extensions || []).filter((e) => e.active).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    boosterCount = statusRes.count || 0;
    pityThreshold = statusRes.pityThreshold || 0;
    pityByExt = new Map((statusRes.extensions || []).map((e) => [e.extensionId, e.pullsSinceTop || 0]));
    // Sert a detecter les doublons a la volee pendant le reveal (voir
    // startOpening) : combien d'exemplaires le joueur avait AVANT ce pack.
    ownedCountMap = new Map((collectionRes.owned || []).map((o) => [o.cardId, o.count]));
    catalogCache = collectionRes.cards || [];

    // Progression par extension (X/Y cartes decouvertes), affichee sur
    // chaque tuile - reutilise le catalogue complet deja renvoye par
    // get-collection.json, pas besoin d'un appel getCards() de plus.
    extProgressByExt = new Map();
    (collectionRes.cards || []).forEach((c) => {
      const extId = c.extension?.id;
      if (extId == null) return;
      if (!extProgressByExt.has(extId)) extProgressByExt.set(extId, { owned: 0, total: 0 });
      const entry = extProgressByExt.get(extId);
      entry.total++;
      if (ownedCountMap.has(c.cardId)) entry.owned++;
    });

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
  // Chaque nouvelle session repart en pile (mode par defaut) - "Tout
  // révéler" peut la basculer en ligne (voir startOpening), a remettre a
  // zero avant le prochain booster.
  grid.classList.remove("row-reveal");
  grid.classList.add("stacked");
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
    else { Sfx.click(); startOpening(ext); }
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
  const openAnotherBtn = document.getElementById("open-another-btn");
  if (openAnotherBtn) openAnotherBtn.style.display = "none";

  // Au cas ou une precedente fermeture animee (voir closeModal) n'aurait
  // pas eu le temps de se terminer avant une reouverture immediate.
  const stageEl = overlay.querySelector(".pack-modal-stage");
  if (stageEl) stageEl.classList.remove("closing");

  overlay.hidden = false;
  syncScrollLock();
  startAmbientParticles();
}

// Petite animation de "rangement" a la fermeture (la pile se replie) plutot
// qu'une disparition sechecomme - une session qui vient de se terminer
// merite une sortie aussi soignee que son entree.
function closeModal() {
  const overlay = document.getElementById("pack-modal-overlay");
  const stage = overlay.querySelector(".pack-modal-stage");
  if (stage && !stage.classList.contains("closing")) {
    stage.classList.add("closing");
    setTimeout(() => {
      stage.classList.remove("closing");
      overlay.hidden = true;
      syncScrollLock();
      stopAmbientParticles();
    }, 220);
  } else {
    overlay.hidden = true;
    syncScrollLock();
    stopAmbientParticles();
  }
}

async function startOpening(ext) {
  isBusy = true;
  lastOpenedExtension = ext;

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

    // Marque chaque carte comme nouvelle ou doublon AVANT de construire les
    // elements : incremente au fil du lot pour gerer aussi les doublons
    // internes a un x5 (deux fois la meme carte dans le meme paquet).
    allCards.forEach((card) => {
      const before = ownedCountMap.get(card.cardId) || 0;
      card.isNewToPlayer = before === 0;
      card.ownedCountAfter = before + 1;
      ownedCountMap.set(card.cardId, before + 1);
    });

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
        // "Tout révéler" bascule la pile en ligne : les cartes se posent
        // cote a cote (mise en page normale de .reveal-grid, plus de pile)
        // et se retournent toutes ensemble (léger décalage de quelques ms
        // entre chacune pour que les sons/effets ne se chevauchent pas
        // completement), au lieu de l'ancien enchainement carte par carte.
        revealAllBtn.disabled = true;
        grid.classList.remove("stacked");
        grid.classList.add("row-reveal");
        const progress = document.getElementById("stack-progress");
        if (progress) progress.textContent = "";
        // Si le joueur avait deja retourne quelques cartes a la main avant
        // de cliquer "Tout révéler", elles portent .discarded (envolees sur
        // le cote, invisibles) : on les remet dans le rang avec les autres.
        stackCardEls.forEach((el) => {
          el.classList.remove("discarded");
          el.style.transform = "";
          el.dataset.active = "true";
        });
        stackCardEls.forEach((el, i) => {
          if (el.classList.contains("revealed")) return;
          setTimeout(() => el._flip(), i * 90);
        });
        stackIndex = stackCardEls.length;
        setTimeout(onAllRevealed, stackCardEls.length * 90 + 500);
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
  document.getElementById("booster-zone").style.display = "block";

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

  const openAnotherBtn = document.getElementById("open-another-btn");
  if (openAnotherBtn) {
    openAnotherBtn.addEventListener("click", () => {
      if (isBusy || !lastOpenedExtension || boosterCount < 1) return;
      Sfx.click();
      openModalFor(lastOpenedExtension.id);
      startOpening(lastOpenedExtension);
    });
  }

  // Espace/Entree : tape le booster (avant ouverture) ou revele la carte
  // active de la pile - convention courante des jeux de cartes (Hearthstone
  // utilise Espace pour enchainer les etapes).
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    if (overlay.hidden) return;
    e.preventDefault();
    const pack = document.getElementById("booster-pack");
    if (!isBusy && pack.style.visibility !== "hidden") { pack.onclick && pack.onclick(); return; }
    const active = stackCardEls[stackIndex];
    if (active) active._flip();
  });

  refreshStatus();
});
