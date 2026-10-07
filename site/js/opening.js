// Logique de la page d'ouverture de booster.
// Contrat API "extensions" (GET) : { extensions: [{ id, name, key, active, packImageId, cardBackImageId }] }
// Contrat API "booster-status" (GET ?userId=...) :
// { count, stardust, extensions: [{ extensionId, name, key, sortOrder, pullsSinceTop }] }
// (count = solde Générique, commun a toutes les extensions ; c'est
// l'utilisateur qui choisit avec quelle extension le depenser)
// Contrat API "open-pack" (POST { userId, extensionId }) :
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
let pityByExt = new Map();
let pityThreshold = 0;
let openQuantity = 1;
// Plafond de "Tout ouvrir" : reste sous la limite d'actions par minute de l'API.
const OPEN_ALL_MAX = 30;
let lastRevealedCards = [];
// BatchId de chaque booster ouvert dans la session en cours (x1/x5/x10) :
// sert a reference les VRAIS pulls en base depuis le backend (notify-reveal,
// partage) plutot que de lui faire confiance sur des donnees carte envoyees
// par le client.
let sessionBatchIds = [];
let stackCardEls = [];
let stackIndex = 0;
let ownedCountMap = new Map();
let extProgressByExt = new Map();
let catalogCache = [];
let lastOpenedExtension = null;
// Niveau de maitrise par extension (api/src/native/progression.js).
let masteryByExt = new Map();
// Simulateur admin (2026-10-05, js/opening-sim.js) : quand il est actif, les
// ouvertures passent par /admin-simulate (modificateurs) au lieu d'open-pack :
// aucun booster consomme, aucune carte ni XP, aucune annonce Discord.
let simMode = null;
function setSimMode(modifiers) {
  simMode = modifiers || null;
  document.body.classList.toggle("sim-mode", !!simMode);
  renderExtensionPicker();
}
const usableBoosters = () => (simMode ? OPEN_ALL_MAX : boosterCount);

const RARITY_ORDER = { commune: 0, rare: 1, epique: 2, legendaire: 3, mythique: 4, unique: 5 };

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
    ? `<span class="card-back-fill" style="background-image:url('${src}')" aria-hidden="true"></span><img class="card-back-image" src="${src}" alt="" /><span class="tap-hint" style="position:relative;z-index:1;">Tape pour révéler</span>`
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

  // Butin de coffre qui n'est pas une carte (poussieres, boosters) : meme
  // carte a retourner, face avant illustree.
  if (card.lootType) {
    const front = document.createElement("div");
    front.className = "card-face card-front loot-front loot-" + card.lootType;
    front.innerHTML = `
      <div class="card-art loot-art"><span class="loot-icon" aria-hidden="true">${card.lootType === "dust" ? "&#10024;" : "&#127873;"}</span></div>
      <div class="card-info">
        <div class="card-name">${card.name}</div>
        <div class="card-artist">Trouvé dans le coffre</div>
        <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">${card.rarity.name}</span>
      </div>`;
    inner.appendChild(front);
    wrap.appendChild(inner);
  } else {
  const dupeBadge = card.isFirstEver
    ? `<span class="new-badge first-ever-badge">&#127942; 1ère obtention du serveur !</span>`
    : card.isNewToPlayer
      ? `<span class="new-badge">Nouvelle !</span>`
      : `<span class="dupe-badge">×${card.ownedCountAfter}${card.duplicateDust ? ` · +${card.duplicateDust}&#10024;` : ""}</span>`;
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
    ${card.isBonusCard ? '<span class="bonus-card-ribbon">&#127873; Carte bonus</span>' : ""}
    <div class="card-art">
      <img src="${imgSrc}" alt="${card.name}" />
      ${finishBadge}
      ${qualityBadge}
      ${card.serialNumber === 1 ? `<span class="serial-one-badge" title="Premier exemplaire en circulation">#001</span>` : ""}
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
  }

  // Pile de cartes : seule la carte "active" (au sommet, voir layoutStack)
  // reagit au clic. Premier tap : revele la carte, qui reste affichee tant
  // qu'on ne re-tape pas dessus. Deuxieme tap (carte deja revelee) : fait
  // avancer la pile vers la suivante - plus d'avancement automatique, il
  // faut un clic explicite pour que la carte parte dans la collection.
  // quiet : revelation de masse ("Tout reveler") - ni son de rarete ni
  // celebration, sauf pour la derniere (meilleure) carte.
  const flip = (quiet) => {
    if (wrap.dataset.active !== "true") return;
    const rowMode = !!(wrap.parentElement && wrap.parentElement.classList.contains("row-reveal"));
    if (!wrap.classList.contains("revealed")) {
      wrap.classList.add("revealed");
      if (quiet === true) { renderStackPips(); return; }
      Sfx.flip();
      setTimeout(() => Sfx.reveal(card.rarity?.key), 260);
      // celebrateRarity lit getBoundingClientRect() (spawnRarityBurst) : lu a
      // chaud, dans le meme tick que le classList.add ci-dessus, ca force un
      // reflow synchrone qui peut faire sauter la transition CSS du flip sur
      // certains moteurs (bug reel signale : le flip ne se joue plus des que
      // la rarete declenche des particules/confettis, jamais sur commune qui
      // n'a pas ce chemin). On laisse le navigateur demarrer la transition du
      // flip AVANT de forcer ce reflow, sur la frame suivante.
      requestAnimationFrame(() => celebrateRarity(card.rarity?.key, wrap, color));
      renderStackPips();
      return;
    }
    // Vue en ligne : jamais advanceStack() (qui remettait les cartes en pile
    // par-dessus la grille, d'ou les cartes superposees) - on agrandit.
    if (rowMode) { zoomRevealedCard(wrap); return; }
    advanceStack();
  };
  wrap.addEventListener("click", () => flip(false));
  wrap._flip = flip;
  attachCardShine(wrap);
  return wrap;
}

// Reflet holographique qui suit le curseur (finitions holo/diamant, voir
// style.css [data-finish] ...::after, jusque-la fige a 50%/50% dans cette
// page car rien ne posait --shine-x/--shine-y ici - contrairement a
// collection.js/craft.js qui le font deja via attachTilt). On se contente des
// coordonnees du reflet, jamais de rotateX/rotateY : le wrap (.card) voit son
// `transform` entierement pilote en inline par layoutStack (position dans la
// pile), un tilt CSS base sur ces memes vars serait donc immediatement
// ecrase et sans effet.
function attachCardShine(el) {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  el.addEventListener("mousemove", (e) => {
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    el.style.setProperty("--shine-x", `${px * 100}%`);
    el.style.setProperty("--shine-y", `${py * 100}%`);
  });
  el.addEventListener("mouseleave", () => {
    el.style.setProperty("--shine-x", "50%");
    el.style.setProperty("--shine-y", "50%");
  });
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
      el.style.filter = "";
      return;
    }
    el.dataset.active = rel === 0 ? "true" : "false";
    const depth = Math.min(rel, 4);
    el.style.transform = `translate(${depth * 5}px, ${depth * 7}px) rotate(${depth * 2}deg) scale(${1 - depth * 0.03})`;
    el.style.zIndex = String(100 - depth);
    // Profondeur de champ : la pile derriere la carte active se floute
    // progressivement (effet bokeh), plutot que de rester nette a plat.
    el.style.filter = depth > 0 ? `blur(${Math.min(depth * 1.1, 3.5)}px)` : "";
  });
  const progress = document.getElementById("stack-progress");
  if (progress) {
    progress.textContent = stackCardEls.length
      ? `Carte ${Math.min(stackIndex + 1, stackCardEls.length)} / ${stackCardEls.length}`
      : "";
  }
  renderStackPips();

  // Precharge l'image de la carte suivante pendant qu'on regarde la carte
  // active : evite un petit flash/attente au moment ou elle passe au sommet.
  const next = lastRevealedCards[stackIndex + 1];
  if (next) {
    const src = API.imageUrl(next.imageId);
    if (src) { const img = new Image(); img.src = src; }
  }
}

// Pips de progression (au-dessus de la pile) : un point par carte du lot,
// colore avec la vraie rarete de la carte des qu'elle est revelee - repere
// visuel immediat sur la qualite du lot en cours, la ou "Carte 2/5" (texte)
// ne donne aucune indication avant d'y arriver.
function renderStackPips() {
  const el = document.getElementById("stack-pips");
  if (!el) return;
  if (!lastRevealedCards.length) { el.innerHTML = ""; return; }
  el.innerHTML = lastRevealedCards.map((c, i) => {
    const cardEl = stackCardEls[i];
    const revealed = cardEl && cardEl.classList.contains("revealed");
    const color = revealed ? (c.rarity?.colorHex || "#9aa0b4") : "";
    const current = i === stackIndex ? "current" : "";
    return `<span class="stack-pip ${revealed ? "revealed" : ""} ${current}" style="${color ? `--pip-color:${color}` : ""}"></span>`;
  }).join("");
}

function advanceStack() {
  stackIndex++;
  layoutStack();
  if (stackIndex >= stackCardEls.length) onAllRevealed();
}

// Loupe sur une carte de la vue en ligne : la face avant en grand.
function zoomRevealedCard(cardEl) {
  const front = cardEl.querySelector(".card-front");
  if (!front) return;
  const overlay = document.createElement("div");
  overlay.className = "reveal-zoom-overlay";
  overlay.innerHTML = `<div class="card revealed reveal-zoom-card" data-rarity="${cardEl.dataset.rarity}" data-finish="${cardEl.dataset.finish}" data-quality="${cardEl.dataset.quality}"><div class="card-inner"><div class="${front.className}">${front.innerHTML}</div></div></div>`;
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
}

// Resume du butin apres la revelation (surtout utile en x5 / x10 / coffre).
function renderRevealSummary() {
  const el = document.getElementById("reveal-summary");
  if (!el) return;
  const items = lastRevealedCards || [];
  if (items.length < 2) { el.hidden = true; el.innerHTML = ""; return; }
  const cards = items.filter((c) => !c.lootType);
  const order = ["mythique", "legendaire", "epique", "rare", "commune"];
  const counts = {};
  const colors = {};
  cards.forEach((c) => { const k = c.rarity?.key || "commune"; counts[k] = (counts[k] || 0) + 1; colors[k] = c.rarity?.colorHex || "#9aa0b4"; });
  const pills = order.filter((k) => counts[k]).map((k) => `<span class="summary-pill" style="--pill-color:${colors[k]};">${rarityIcon(k)} ${counts[k]} ${cards.find((c) => (c.rarity?.key || "commune") === k).rarity?.name || k}</span>`);
  items.filter((c) => c.lootType).forEach((c) => pills.push(`<span class="summary-pill" style="--pill-color:${c.rarity.colorHex};">${c.lootType === "dust" ? "&#10024;" : "&#127873;"} ${c.name}</span>`));
  const notable = [];
  const seen = new Set();
  cards.forEach((c) => {
    const reasons = [];
    if (c.isFirstEver) reasons.push("1ère du serveur");
    else if (c.isNewToPlayer) reasons.push("nouvelle");
    if ((RARITY_ORDER[c.rarity?.key || "commune"] ?? 0) >= (RARITY_ORDER.epique ?? 2)) reasons.push(c.rarity.name);
    if (c.finish && c.finish !== "normal") reasons.push(FINISH_LABELS[c.finish] || c.finish);
    if (c.serialNumber === 1) reasons.push("#001");
    if (c.isBonusCard) reasons.push("bonus");
    const key = c.cardId + ":" + reasons.join();
    if (!reasons.length || seen.has(key)) return;
    seen.add(key);
    notable.push(`<li style="--pill-color:${c.rarity?.colorHex || "#9aa0b4"};"><strong>${c.name}</strong> <span>${reasons.join(" · ")}</span></li>`);
  });
  const fresh = cards.filter((c) => c.isNewToPlayer).length;
  el.hidden = false;
  el.innerHTML = `
    <div class="summary-head"><strong>${items.length} objet${items.length > 1 ? "s" : ""}</strong>${fresh ? ` · <span class="summary-new">${fresh} nouvelle${fresh > 1 ? "s" : ""} carte${fresh > 1 ? "s" : ""}</span>` : ""}</div>
    <div class="summary-pills">${pills.join("")}</div>
    ${notable.length ? `<ul class="summary-notable">${notable.slice(0, 12).join("")}</ul>` : ""}
    <p class="summary-hint">Clique sur une carte pour la voir en grand.</p>`;
}

// Etiquettes visibles pendant toute la revelation (le toast seul passait
// inapercu) : booster shiny, cartes bonus, ou contenu d'un coffre.
function renderPackTags(tags) {
  const el = document.getElementById("pack-tags");
  if (!el) return;
  el.innerHTML = (tags || []).map((t) => `<span class="pack-tag pack-tag-${t.kind}">${t.html}</span>`).join("");
}
let lastPackTags = [];

function resetRevealView() {
  const stage = document.querySelector("#pack-modal-overlay .pack-modal-stage");
  if (stage) stage.classList.remove("reveal-row");
  const sum = document.getElementById("reveal-summary");
  if (sum) { sum.hidden = true; sum.innerHTML = ""; }
}

function onAllRevealed() {
  const btn = document.getElementById("reveal-all-btn");
  if (btn) btn.remove();
  isBusy = false;
  renderRevealSummary();
  const hint = document.getElementById("booster-hint");

  // Recap de session (utile surtout apres un x5) : repartition par rarete
  // du lot qui vient d'etre revele, + rappel du solde restant.
  if (lastRevealedCards.length > 1) {
    const counts = {};
    lastRevealedCards.filter((c) => !c.lootType).forEach((c) => {
      const key = c.rarity?.key || "commune";
      counts[key] = (counts[key] || 0) + 1;
    });
    const order = ["mythique", "legendaire", "epique", "rare", "commune"];
    const parts = order.filter((k) => counts[k]).map((k) => `${counts[k]} ${rarityIcon(k)}`);
    // Le resume detaille (renderRevealSummary) prend le relais : pas de phrase en double.
    if (hint) hint.textContent = document.getElementById("reveal-summary")?.hidden === false ? "" : `Terminé : ${parts.join(" · ")}`;
  } else if (hint) {
    hint.textContent = "Toutes les cartes sont révélées !";
  }
  if (boosterCount > 0 && lastOpenMode !== "sim") {
    Toast.info(`Il te reste ${boosterCount} booster${boosterCount > 1 ? "s" : ""} disponible${boosterCount > 1 ? "s" : ""}.`);
  }


  // Annonce Discord automatique (Mythique/Legendaire/Epique) : envoyee ICI,
  // une fois que le JOUEUR a fini de reveler ses cartes (tap manuel ou
  // "Tout reveler"), jamais au moment du tirage cote backend - sinon le
  // message arriverait sur Discord avant meme que le joueur ait vu sa
  // propre carte, ce qui spoilerait sa surprise. Fire-and-forget : le
  // backend revalide lui-meme les cartes via BatchId (jamais les donnees
  // envoyees ici), donc peu importe si cet appel echoue silencieusement.
  if (sessionBatchIds.length) {
    API.notifyReveal(Session.userId, sessionBatchIds).catch(() => {});
  }

  // Enchainer directement sur un autre booster de la meme extension, sans
  // repasser par le selecteur : le cas d'usage principal (ouvrir plusieurs
  // boosters d'affilee) ne devrait pas demander de fermer/rouvrir la modale
  // a chaque fois.
  const openAnotherBtn = document.getElementById("open-another-btn");
  if (openAnotherBtn && lastOpenMode === "chest") {
    const can = chestState && chestState.chests > 0 && chestState.keys > 0;
    openAnotherBtn.innerHTML = can ? `&#129520; Ouvrir un autre coffre (${chestState.chests} restant${chestState.chests > 1 ? "s" : ""})` : "";
    openAnotherBtn.style.display = can ? "inline-flex" : "none";
  } else if (openAnotherBtn) {
    if (lastOpenedExtension && lastOpenMode === "sim") {
      openAnotherBtn.textContent = `${String.fromCodePoint(129514)} Simuler un autre booster`;
      openAnotherBtn.style.display = "inline-flex";
    } else if (lastOpenedExtension && boosterCount > 0) {
      const icon = String.fromCodePoint(128257);
      openAnotherBtn.textContent = `${icon} Ouvrir un autre (${boosterCount} restant${boosterCount > 1 ? "s" : ""})`;
      openAnotherBtn.style.display = "inline-flex";
    } else {
      openAnotherBtn.style.display = "none";
    }
  }
}

// Important : l'effet legendaire n'anime JAMAIS le transform d'un ancetre
// des cartes (document.body notamment). Les cartes de reveal utilisent
// transform-style:preserve-3d pour le flip 3D ; animer le transform d'un
// parent commun casse ce rendu dans certains navigateurs (c'est ce qui
// provoquait un blocage de la page). L'effet est donc isole a un calque de
// flash plein écran + un filtre sur la carte elle-meme uniquement.
//
// Les particules (spawnRarityBurst, ui.js) sont sur un calque a
// z-index:420, au-dessus du modal d'ouverture (400) et du flash legendaire
// (410) : elles restent visibles par-dessus toute la modale plein écran.
// A partir d'epique (pas seulement legendaire) : le flash plein ecran suit
// desormais la VRAIE couleur de la rarete (hexToRgba, ui.js) et son
// intensite grandit avec le palier - jamais fige sur l'orange legendaire.
// Rare est desormais le palier d'entree de la "vraie" animation autour de la
// carte (demande explicite, 2026-09-30, en remplacement de l'idee des eclats
// de foil colores par extension) : jusqu'ici seule une epique+ declenchait le
// flash plein ecran/le pulse de luminosite (voir plus bas), une rare tiree se
// distinguait uniquement par son halo STATIQUE (.card-face, style.css) sans
// aucune animation. Chaque palier ajoute son propre anneau lumineux qui
// eclate autour de la carte (spawnCardAuraRing), avec un nombre de pulsations
// et une taille croissants ; le flash plein ecran/le zoom cinematique restent
// reserves a epique+ (heroZoom) pour ne pas rendre une simple rare aussi
// spectaculaire qu'une mythique.
const RARITY_FLASH_TIERS = {
  rare: { alpha: 0.22, duration: "0.5s", brightness: 1.25, className: "tier-rare", ringPulses: 1, ringScale: 1.3 },
  epique: { alpha: 0.4, duration: "0.7s", brightness: 1.6, className: "tier-epique", ringPulses: 2, ringScale: 1.5, heroZoom: true, heroScale: 1.14 },
  legendaire: { alpha: 0.55, duration: "0.9s", brightness: 2, className: "tier-legendaire", ringPulses: 3, ringScale: 1.7, heroZoom: true, heroScale: 1.2 },
  mythique: { alpha: 0.7, duration: "1.2s", brightness: 2.6, className: "tier-mythique", ringPulses: 4, ringScale: 1.9, heroZoom: true, heroScale: 1.28 }
};
const RARITY_FLASH_TOASTS = { legendaire: "Légendaire !", mythique: "Mythique !" };

// Anneau lumineux qui eclate autour de la carte (voir commentaire ci-dessus) :
// element ephemere ajoute comme enfant direct de la carte (.card doit rester
// position:relative, voir style.css), auto-supprime a la fin de sa propre
// animation (animationend ne se declenche qu'une fois, apres TOUTES les
// iterations de l'animation-iteration-count).
function spawnCardAuraRing(cardEl, colorHex, tier) {
  if (!cardEl || !tier || !tier.ringPulses) return;
  const ring = document.createElement("div");
  ring.className = "card-aura-ring";
  ring.style.setProperty("--aura-color", colorHex || "#9aa0b4");
  ring.style.setProperty("--aura-scale", String(tier.ringScale || 1.3));
  ring.style.setProperty("--aura-pulses", String(tier.ringPulses));
  cardEl.appendChild(ring);
  ring.addEventListener("animationend", () => ring.remove());
}

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
      if (tier.heroZoom) {
        cardEl.style.setProperty("--hero-scale", String(tier.heroScale));
        cardEl.classList.remove("hero-zoom");
        void cardEl.offsetWidth;
        cardEl.classList.add("hero-zoom");
      }
    }
    spawnCardAuraRing(cardEl, colorHex, tier);
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
  const disabled = usableBoosters() < 1;
  el.innerHTML = extensionsCache.map((ext) => {
    const img = API.imageUrl(ext.packImageId);
    const backImg = API.imageUrl(ext.cardBackImageId);
    const pity = pityByExt.get(ext.id) || 0;
    const pct = pityThreshold ? Math.min(100, Math.round((pity / pityThreshold) * 100)) : 0;
    const pityLabel = pityThreshold ? `${pity} / ${pityThreshold}` : `${pity} tirage${pity > 1 ? "s" : ""}`;
    const progress = extProgressByExt.get(ext.id);
    return `
      <div class="extension-tile ${disabled ? "disabled" : ""}" data-ext-id="${ext.id}">
        <div class="ext-art" ${disabled ? "" : 'tabindex="0" role="button" aria-label="Ouvrir un booster ' + ext.name.replace(/"/g, "&quot;") + '"'}>
          ${img ? `<img class="ext-art-front" src="${img}" alt="" />` : `<div class="booster-emoji" style="font-size:2rem;">&#127183;</div>`}
          ${backImg ? `<img class="ext-art-back" src="${backImg}" alt="" title="Dos de carte de cette extension" />` : ""}
        </div>
        <div class="ext-name">${ext.name}${masteryByExt.get(ext.id) > 1 ? ` <span class="ext-mastery" title="Maîtrise de l'extension niveau ${masteryByExt.get(ext.id)} : plus de finitions spéciales dans ces boosters">&#127941; ${masteryByExt.get(ext.id)}</span>` : ""}</div>
        <div class="ext-count">${progress ? `${progress.owned}/${progress.total} cartes (${progress.total ? Math.floor((progress.owned / progress.total) * 100) : 0}%)` : "Ouvrir"}</div>
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
      if ((e.key !== "Enter" && e.key !== " ") || !e.target.closest(".ext-art")) return;
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
          ${c.isPromo && c.rarity?.key !== "unique" ? '<span class="promo-badge">Promo</span>' : ""}
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
  if (Session.isLoggedIn() && !masteryByExt.size) API.mastery(Session.userId).then((m) => { masteryByExt = new Map((m.extensions || []).map((e) => [e.extensionId, e.level])); if (extensionsCache.length) renderExtensionPicker(); }).catch(() => {});
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
    Toast.error("Impossible de récupérer les extensions/boosters. (" + e.message + ")");
  }
}

// Ouvre le modal sur le pack de l'extension choisie, pret a etre tape pour
// demarrer l'ouverture (le tirage reel n'a pas encore eu lieu a ce stade).
function openModalFor(extensionId) {
  if (isBusy || usableBoosters() < 1) return;
  const ext = extensionById(extensionId);
  if (!ext) return;
  lastOpenMode = simMode ? "sim" : "pack";
  renderPackTags([]);
  lastPackTags = [];
  resetRevealView();
  document.getElementById("booster-pack").classList.remove("chest-pack");

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
  const pipsEl = document.getElementById("stack-pips");
  if (pipsEl) pipsEl.innerHTML = "";
  const oldRevealAll = document.getElementById("reveal-all-btn");
  if (oldRevealAll) oldRevealAll.remove();
  pack.classList.remove("locked", "charging", "tearing", "pack-shiny", "charging-special");
  pack.style.visibility = "visible";

  // Halo ambiant proportionnel a la pity (voir .booster-pack.charging,
  // style.css) : plus on approche du palier legendaire garanti sur cette
  // extension, plus la charge du pack rougeoie fort avant meme de savoir ce
  // qui va sortir - jusque-la la pity n'etait visible que sur l'ecran de
  // selection d'extension, jamais pendant l'ouverture elle-meme.
  const pityRatio = pityThreshold ? Math.min(1, (pityByExt.get(ext.id) || 0) / pityThreshold) : 0;
  pack.style.setProperty("--pity-ratio", String(pityRatio));

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
      // "Tout ouvrir" (2026-10-05) : tous les boosters, jusqu'a OPEN_ALL_MAX.
      if (b.dataset.qty === "all") {
        const n = Math.min(usableBoosters(), OPEN_ALL_MAX);
        b.textContent = `Tout ouvrir (${n})`;
        b.dataset.count = String(n);
        b.disabled = usableBoosters() < 2;
        b.classList.remove("active");
        return;
      }
      const qty = Number(b.dataset.qty);
      b.classList.toggle("active", qty === 1);
      b.disabled = qty > usableBoosters();
    });
  }
  renderPackTags(simMode ? [{ kind: "sim", html: "&#129514; Simulation : rien n'est gagné ni dépensé" }] : []);
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

// Embellissement (2026-09-30) : petits eclats de foil qui explosent depuis
// le pack au moment exact de la dechirure (classe .tearing), en plus du
// flash/tremblement deja en place. Reutilise la meme couche partagee que
// spawnRarityBurst (ui.js) pour ne pas dupliquer un conteneur fixe de plus.
function spawnFoilShards(originEl) {
  const rect = originEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ["#ff6ec7", "#ffd76e", "#7dd3fc", "#a78bfa", "#f5a524"];
  const layer = getParticleLayer();
  for (let i = 0; i < 26; i++) {
    const shard = document.createElement("span");
    shard.className = "foil-shard";
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 160;
    shard.style.left = cx + "px";
    shard.style.top = cy + "px";
    shard.style.background = colors[Math.floor(Math.random() * colors.length)];
    shard.style.setProperty("--dx", (Math.cos(angle) * dist) + "px");
    shard.style.setProperty("--dy", (Math.sin(angle) * dist + 60) + "px");
    shard.style.setProperty("--rot", (360 + Math.random() * 360) + "deg");
    shard.style.animationDuration = (0.6 + Math.random() * 0.4) + "s";
    shard.style.animationDelay = (Math.random() * 0.08) + "s";
    layer.appendChild(shard);
    setTimeout(() => shard.remove(), 1200);
  }
}

// Bouton "Tout reveler" (boosters et coffres) : bascule la pile en grille.
function addRevealAllButton(grid) {
  const revealAllBtn = document.createElement("button");
  revealAllBtn.id = "reveal-all-btn";
  revealAllBtn.className = "btn-secondary";
  revealAllBtn.textContent = "Tout révéler";
  revealAllBtn.addEventListener("click", () => {
    // "Tout révéler" bascule la pile en ligne : les cartes se posent
    // cote a cote (mise en page normale de .reveal-grid, plus de pile).
    // FLIP (First-Last-Invert-Play) : on capture la position actuelle de
    // chaque carte AVANT de changer les classes, pour animer un vrai
    // glissement pile -> ligne plutot qu'un saut instantane (stacked ->
    // row-reveal recalcule toute la grille CSS d'un coup, sans
    // transition possible directement sur cette bascule).
    revealAllBtn.disabled = true;
    const firstRects = stackCardEls.map((el) => el.getBoundingClientRect());

    // Si le joueur avait deja retourne quelques cartes a la main avant
    // de cliquer "Tout révéler", elles portent .discarded (envolees sur
    // le cote, invisibles) : on les remet dans le rang avec les autres.
    stackCardEls.forEach((el) => {
      el.classList.remove("discarded");
      el.style.transform = "";
      el.style.filter = "";
      el.dataset.active = "true";
    });
    grid.classList.remove("stacked");
    grid.classList.add("row-reveal");
    const stageEl = document.querySelector("#pack-modal-overlay .pack-modal-stage");
    if (stageEl) stageEl.classList.add("reveal-row");
    // Meilleures cartes en tete de grille (l'ordre de revelation, lui,
    // reste croissant pour finir sur la meilleure).
    const rank = (i) => (RARITY_ORDER[lastRevealedCards[i].rarity?.key || "commune"] ?? 0) * 10 + (lastRevealedCards[i].isNewToPlayer ? 1 : 0);
    stackCardEls.map((el, i) => ({ el, i })).sort((a, b) => rank(b.i) - rank(a.i)).forEach(({ el }) => grid.appendChild(el));
    const progress = document.getElementById("stack-progress");
    if (progress) progress.textContent = "";
    const pips = document.getElementById("stack-pips");
    if (pips) pips.innerHTML = "";

    // Reflow force : necessaire pour lire la position FINALE (en ligne)
    // juste apres avoir bascule les classes ci-dessus.
    void grid.offsetWidth;
    stackCardEls.forEach((el, i) => {
      const last = el.getBoundingClientRect();
      const dx = firstRects[i].left - last.left;
      const dy = firstRects[i].top - last.top;
      if (!dx && !dy) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth;
      el.style.transition = "transform 0.5s cubic-bezier(.2,.8,.2,1)";
      el.style.transform = "";
    });

    // Ordre de reveal trie par rareté croissante (garde la meilleure
    // carte du lot pour la fin, avec une pause suspendue juste avant)
    // plutot que l'ordre brut du tirage - convention courante des jeux
    // gacha pour finir sur un point culminant au lieu d'un flip uniforme.
    const order = stackCardEls.map((_, i) => i).filter((i) => !stackCardEls[i].classList.contains("revealed"));
    order.sort((a, b) => (RARITY_ORDER[lastRevealedCards[a].rarity?.key || "commune"] ?? 0) - (RARITY_ORDER[lastRevealedCards[b].rarity?.key || "commune"] ?? 0));
    let totalDelay = 0;
    order.forEach((idx, k) => {
      const delay = k * 90 + (k === order.length - 1 && order.length > 1 ? 550 : 0);
      totalDelay = Math.max(totalDelay, delay);
      setTimeout(() => stackCardEls[idx]._flip(k !== order.length - 1), delay);
    });
    stackIndex = stackCardEls.length;
    // Le recap "Termine : ..." doit attendre la fin du zoom cinematique de
    // la derniere carte (epique+, voir heroZoom) avant de s'afficher -
    // sinon il apparait par-dessus une carte encore en train de grossir,
    // ce qui casse net l'effet de point culminant qu'on cherche a creer.
    const lastKey = order.length ? (lastRevealedCards[order[order.length - 1]].rarity?.key || "commune") : "commune";
    const lastTier = RARITY_FLASH_TIERS[lastKey];
    const lastTierMs = lastTier ? parseFloat(lastTier.duration) * 1000 : 0;
    setTimeout(onAllRevealed, totalDelay + Math.max(500, lastTierMs + 250));
  });
  grid.after(revealAllBtn);
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
    const sim = simMode;
    const quantity = Math.min(openQuantity, usableBoosters());
    const allCards = [];
    const batchIds = [];
    // Raretes de booster (2026-10-02) : booster shiny (0.1%) et carte bonus.
    let packShiny = false;
    let bonusCards = 0;
    let duplicateDust = 0;
    // Cartes ameliorees par les bonus perso (maitrise, heure de chance, de, talents).
    let boosted = 0;
    let lastBoosterInfo = null;
    for (let i = 0; i < quantity; i++) {
      const res = sim
        ? await API.adminSimulate(Session.discordId, "pack", { extensionId: ext.id, modifiers: sim })
        : await API.openPack(Session.userId, ext.id);
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
      if (res.batchId && !sim) batchIds.push(res.batchId);
      if (res.pack?.shiny) packShiny = true;
      if (res.pack?.bonusCard) bonusCards++;
      if (res.duplicateDust) duplicateDust += res.duplicateDust.total || 0;
      if (res.personalBoost) boosted += (res.personalBoost.finishes || 0) + (res.personalBoost.qualities || 0);
      lastBoosterInfo = res.booster;
    }

    // Revelation de la moins rare a la plus rare (aussi sur un x5, ou les
    // boosters sont concatenes) : la meilleure carte arrive en dernier.
    allCards.sort((a, b) => (RARITY_ORDER[a.rarity?.key || "commune"] ?? 0) - (RARITY_ORDER[b.rarity?.key || "commune"] ?? 0));
    // Indice SUBTIL (2026-10-02, demande explicite) : on sent qu'il y a
    // quelque chose, sans savoir quoi - un seul fremissement neutre des une
    // epique, plus de tremblement/couleur differents par rarete qui
    // revelaient le contenu avant meme la dechirure.
    const bestRarity = allCards.reduce((best, c) => {
      const k = c.rarity?.key || "commune";
      return (RARITY_ORDER[k] ?? 0) > (RARITY_ORDER[best] ?? 0) ? k : best;
    }, "commune");
    const somethingSpecial = (RARITY_ORDER[bestRarity] ?? 0) >= (RARITY_ORDER.epique ?? 2);
    if (somethingSpecial) pack.classList.add("charging-special");
    if (packShiny) {
      pack.classList.add("pack-shiny");
      Toast.success("&#127752; Booster SHINY ! Ses cartes sont meilleures que d'habitude.");
    }

    // Jauge de charge visible autour du pack (anneau SVG, voir ouverture.html
    // #charge-ring) : jusqu'ici la charge de 750ms n'etait qu'un tremblement
    // CSS sans aucun repere de progression. L'anneau se remplit exactement
    // sur la duree du wait() qui suit, et prend la couleur de la meilleure
    // rareté deja tiree (meme "spoiler discret" que le tremblement).
    const chargeRing = document.getElementById("charge-ring");
    if (chargeRing) {
      chargeRing.style.setProperty("--charge-ring-color", packShiny ? "#ff6ec7" : "#8b5cf6");
      chargeRing.classList.remove("active");
      void chargeRing.offsetWidth;
      chargeRing.classList.add("active");
    }

    // Sequence volontairement plus lente qu'avant : charge (750ms) ->
    // dechirure marquee (750ms, voir packTear) -> court silence (250ms)
    // avant l'apparition des cartes. Le pull est LE moment fort de la
    // page, il ne doit pas se sentir expedie.
    await wait(750);
    pack.classList.remove("charging", "charging-special", "charging-legendaire", "charging-epique", "charging-rare", "charging-mythique");
    if (bonusCards) Toast.info(`&#127873; +${bonusCards} carte${bonusCards > 1 ? "s" : ""} bonus dans ce booster !`);
    lastPackTags = sim ? [{ kind: "sim", html: "&#129514; Simulation", short: "simulation" }] : [];
    if (packShiny) lastPackTags.push({ kind: "shiny", html: "&#127752; Booster shiny : meilleures cartes", short: "booster shiny" });
    if (duplicateDust) lastPackTags.push({ kind: "dust", html: `&#10024; +${duplicateDust} poussières (doublons)`, short: `+${duplicateDust} poussières de doublons` });
    if (boosted) lastPackTags.push({ kind: "bonus", html: `&#127808; ${boosted} carte${boosted > 1 ? "s" : ""} améliorée${boosted > 1 ? "s" : ""} par tes bonus`, short: `${boosted} améliorée${boosted > 1 ? "s" : ""}` });
    if (bonusCards) lastPackTags.push({ kind: "bonus", html: `&#127873; ${bonusCards} carte${bonusCards > 1 ? "s" : ""} bonus`, short: `${bonusCards} carte${bonusCards > 1 ? "s" : ""} bonus` });
    renderPackTags(lastPackTags);
    pack.classList.add("tearing");
    if (chargeRing) chargeRing.classList.remove("active");
    spawnFoilShards(pack);
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
    // Simulation : compteur sur une copie, la collection reelle ne bouge pas.
    const counts = sim ? new Map(ownedCountMap) : ownedCountMap;
    allCards.forEach((card) => {
      const before = counts.get(card.cardId) || 0;
      card.isNewToPlayer = before === 0;
      card.ownedCountAfter = before + 1;
      counts.set(card.cardId, before + 1);
    });

    lastRevealedCards = allCards;
    sessionBatchIds = batchIds;
    stackIndex = 0;
    stackCardEls = allCards.map((card, i) => {
      const el = buildCardEl(card, i, ext.cardBackImageId);
      grid.appendChild(el);
      return el;
    });
    layoutStack();

    if (allCards.length) addRevealAllButton(grid);
    else onAllRevealed();

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

// ---------------------------------------------------------------------------
// Coffres (api/src/native/chests.js) : achetes contre des poussieres ou
// gagnes tous les 5 niveaux, ouverts avec une clef (une clef tous les 10
// niveaux). S'ouvrent dans la meme scene qu'un booster : charge, ouverture,
// pile de cartes a retourner ; poussieres et boosters sont des cartes
// speciales de la pile.
// ---------------------------------------------------------------------------
let chestState = null;
let lastOpenMode = "pack";
const CHEST_ERRORS = { not_enough_dust: "Pas assez de poussières.", no_chest: "Tu n'as pas de coffre.", no_key: "Il te faut une clé pour ouvrir un coffre." };

function renderChests() {
  const panel = document.getElementById("chest-panel");
  if (!panel || !chestState) return;
  const st = chestState;
  panel.style.display = "";
  document.getElementById("chest-count").innerHTML = `&#129520; ${st.chests} coffre${st.chests > 1 ? "s" : ""}`;
  document.getElementById("chest-keys").innerHTML = `&#128273; ${st.keys} clé${st.keys > 1 ? "s" : ""}`;
  document.getElementById("chest-next").textContent = `Prochain coffre offert au niveau ${st.nextChestLevel}, prochaine clé au niveau ${st.nextKeyLevel} (tu es niveau ${st.level}).`;
  const openBtn = document.getElementById("chest-open-btn");
  openBtn.disabled = !(st.chests > 0 && st.keys > 0);
  openBtn.title = st.chests < 1 ? "Aucun coffre" : st.keys < 1 ? "Il te faut une clé" : "";
  const buyBtn = document.getElementById("chest-buy-btn");
  buyBtn.innerHTML = `Acheter un coffre (${st.cost} &#10024;)`;
  buyBtn.disabled = st.stardust < st.cost;
  buyBtn.title = st.stardust < st.cost ? `Il te faut ${st.cost} poussières (tu en as ${st.stardust})` : "";
}

function announceLevelGrant(g) {
  if (!g) return;
  const parts = [];
  if (g.chests) parts.push(`${g.chests} coffre${g.chests > 1 ? "s" : ""}`);
  if (g.keys) parts.push(`${g.keys} clé${g.keys > 1 ? "s" : ""}`);
  Toast.success(`&#127881; Récompense de niveau : +${parts.join(" et ")} !`);
}

async function loadChests() {
  try {
    chestState = await API.chests(Session.userId, "status");
    renderChests();
    announceLevelGrant(chestState.levelGrant);
    if (chestState.levelGrant) loadHeaderBoosterBadge();
  } catch (e) { /* panneau facultatif */ }
}

async function buyChest(btn) {
  const cost = chestState ? chestState.cost : 100;
  if (!(await Confirm.show(`Acheter un coffre pour <strong>${cost} poussières d'étoile</strong> ?`, { title: "Acheter un coffre", confirmText: "Acheter" }))) return;
  btn.disabled = true;
  try {
    chestState = await API.chests(Session.userId, "buy");
    Toast.success("&#129520; Coffre acheté !");
    loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error(CHEST_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
  renderChests();
}

// Meme modale que les boosters, avec un coffre a la place du pack.
function openChestModal() {
  if (isBusy || !chestState || chestState.chests < 1 || chestState.keys < 1) return;
  lastOpenMode = "chest";
  lastPackTags = [];
  renderPackTags([]);
  resetRevealView();
  const overlay = document.getElementById("pack-modal-overlay");
  const pack = document.getElementById("booster-pack");
  const grid = document.getElementById("reveal-grid");
  grid.innerHTML = "";
  grid.classList.remove("row-reveal");
  grid.classList.add("stacked");
  stackCardEls = [];
  stackIndex = 0;
  ["stack-progress", "stack-pips"].forEach((id) => { const el = document.getElementById(id); if (el) el.innerHTML = ""; });
  const oldRevealAll = document.getElementById("reveal-all-btn");
  if (oldRevealAll) oldRevealAll.remove();
  pack.classList.remove("locked", "charging", "tearing", "pack-shiny", "charging-special");
  pack.classList.add("chest-pack");
  pack.style.visibility = "visible";
  pack.style.setProperty("--pity-ratio", "0");
  pack.innerHTML = `<div class="booster-emoji chest-emoji">&#129520;</div><div class="booster-title">Coffre</div><div class="booster-sub">&#128273; 1 clé</div>`;
  document.getElementById("booster-hint").textContent = "Tape sur le coffre pour l'ouvrir avec une clé";
  pack.onclick = () => { if (!isBusy) { Sfx.click(); startChestOpening(); } };
  crossfadeModalBackground(null);
  attachPackTilt(pack);
  const qtyPicker = document.getElementById("quantity-picker");
  if (qtyPicker) qtyPicker.style.display = "none";
  const openAnotherBtn = document.getElementById("open-another-btn");
  if (openAnotherBtn) openAnotherBtn.style.display = "none";
  const stageEl = overlay.querySelector(".pack-modal-stage");
  if (stageEl) stageEl.classList.remove("closing");
  overlay.hidden = false;
  syncScrollLock();
  startAmbientParticles();
}

// Butin du coffre -> cartes de la pile (poussieres et boosters en cartes speciales).
function chestItemsToCards(items) {
  return items.map((it) => {
    if (it.type === "dust") return { lootType: "dust", cardId: 0, name: `+${it.amount} poussières`, rarity: { key: "commune", name: "Poussières", colorHex: "#f472b6" } };
    if (it.type === "booster") return { lootType: "booster", cardId: 0, name: `+${it.count} booster${it.count > 1 ? "s" : ""}`, rarity: { key: "rare", name: "Booster", colorHex: "#22d3ee" } };
    return it.card;
  });
}

async function startChestOpening() {
  isBusy = true;
  const pack = document.getElementById("booster-pack");
  const flash = document.getElementById("burst-flash");
  const grid = document.getElementById("reveal-grid");
  const hint = document.getElementById("booster-hint");
  pack.classList.add("charging");
  try {
    const res = await API.chests(Session.userId, "open");
    chestState = res;
    const cards = chestItemsToCards(res.items || []);
    const realCards = cards.filter((c) => !c.lootType);
    const best = realCards.reduce((b, c) => Math.max(b, RARITY_ORDER[c.rarity?.key || "commune"] ?? 0), 0);
    if (best >= (RARITY_ORDER.epique ?? 2)) pack.classList.add("charging-special");
    const chargeRing = document.getElementById("charge-ring");
    if (chargeRing) {
      chargeRing.style.setProperty("--charge-ring-color", "#f5a524");
      chargeRing.classList.remove("active");
      void chargeRing.offsetWidth;
      chargeRing.classList.add("active");
    }
    await wait(750);
    pack.classList.remove("charging", "charging-special");
    pack.classList.add("tearing");
    if (chargeRing) chargeRing.classList.remove("active");
    spawnFoilShards(pack);
    flash.classList.add("flash-active");
    await wait(750);
    pack.classList.remove("tearing");
    pack.style.visibility = "hidden";
    await wait(250);
    hint.textContent = "Tape sur chaque objet pour le révéler";
    lastPackTags = [{ kind: "chest", html: `&#129520; Coffre : ${res.items.length} objet${res.items.length > 1 ? "s" : ""}`, short: "coffre ouvert" }];
    renderPackTags(lastPackTags);
    realCards.forEach((card) => {
      const before = ownedCountMap.get(card.cardId) || 0;
      card.isNewToPlayer = before === 0;
      card.ownedCountAfter = before + 1;
      ownedCountMap.set(card.cardId, before + 1);
    });
    lastRevealedCards = cards;
    sessionBatchIds = [];
    stackIndex = 0;
    stackCardEls = cards.map((card, i) => { const el = buildCardEl(card, i, null); grid.appendChild(el); return el; });
    layoutStack();
    if (cards.length > 1) addRevealAllButton(grid);
    flash.classList.remove("flash-active");
    renderChests();
    boosterCount = res.newBoosterCount ?? boosterCount;
    renderBoosterCountLabel();
    loadHeaderBoosterBadge();
  } catch (e) {
    pack.classList.remove("charging", "tearing");
    pack.style.visibility = "visible";
    Toast.error(CHEST_ERRORS[e.code] || ("Erreur lors de l'ouverture du coffre. (" + e.message + ")"));
    isBusy = false;
    closeModal();
    loadChests();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("booster-zone").style.display = "block";
  loadChests();
  document.getElementById("chest-buy-btn").addEventListener("click", (e) => buyChest(e.currentTarget));
  document.getElementById("chest-open-btn").addEventListener("click", openChestModal);

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
        openQuantity = btn.dataset.qty === "all" ? Number(btn.dataset.count) || 1 : Number(btn.dataset.qty);
        qtyPicker.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
  }


  const openAnotherBtn = document.getElementById("open-another-btn");
  if (openAnotherBtn) {
    openAnotherBtn.addEventListener("click", () => {
      if (lastOpenMode === "chest") {
        if (isBusy) return;
        Sfx.click();
        openChestModal();
        startChestOpening();
        return;
      }
      if (isBusy || !lastOpenedExtension || usableBoosters() < 1) return;
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
