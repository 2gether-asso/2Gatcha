// Jeux : fouille, profondeurs, chenil de Milo, « Tout fouiller ».
// Decoupage de jeux.js (Jeux V2, 2026-11-15) : scripts classiques charges
// dans l'ordre par jeux.html ; leurs declarations restent partagees entre fichiers.

// -----------------------------------------------------------------------
// Fouille : grille de 16 tuiles a creuser. Certains tresors sont etales sur
// plusieurs tuiles (voir docs/SCHEMA.md) - une tuile "partielle" le signale
// discretement (une fissure de plus, pas la position exacte des autres
// tuiles du meme tresor) sans jamais reveler ce qui est cache ailleurs.
// -----------------------------------------------------------------------
let digEnergy = 0;
// Heure (ms) d'arrivee du prochain point d'energie de fouille, 0 si pleine.
let digDeadline = 0;
let digMaxEnergy = 5;
let digRegenSeconds = 60;
let digBusy = false;

const DIG_REWARD_ICON = { smallDust: "&#10024;", bigDust: "&#127775;", booster: "&#127183;", card: "&#127942;", rareCard: "&#127775;", mineral: "&#128142;" };
// Fouille v2 (2026-10-18) : profondeurs, sac de mineraux, raccourcis de la boutique.
let digDepthState = null;
let digTilesCache = [];
function renderDigDepths(dd) {
  if (!dd) return;
  digDepthState = dd;
  const el = document.getElementById("dig-depths");
  // Surprises (2026-10-29) : seules les profondeurs atteintes sont nommees.
  const deeper = dd.depths.filter((d) => !d.unlocked).length;
  el.innerHTML = dd.depths.filter((d) => d.unlocked).map((d) => `<button type="button" role="radio" aria-checked="${d.depth === dd.depth}" class="dig-depth ${d.depth === dd.depth ? "active" : ""}" data-depth="${d.depth}" title="Profondeur ${d.depth} : ${escHtml(d.label)}"><span class="dig-depth-n">${d.depth}</span> ${d.icon} ${escHtml(d.label)}</button>`).join("")
    + (deeper ? `<span class="dig-depth mystery-slot" title="Plus bas, la terre cache encore des surprises">&#10067; Plus profond…</span>` : "");
  const site = document.querySelector(".dig-site");
  const cur = dd.depths.find((d) => d.depth === dd.depth);
  if (site && cur) {
    const changed = site.dataset.depth && site.dataset.depth !== String(cur.depth);
    site.dataset.depth = String(Math.min(5, Math.max(1, cur.depth)));
    let banner = site.querySelector(".dig-depth-banner");
    if (!banner) { banner = document.createElement("div"); banner.className = "dig-depth-banner"; site.prepend(banner); }
    banner.innerHTML = `<span class="ddb-icon" aria-hidden="true">${cur.icon}</span><span><small>Profondeur ${cur.depth}</small><strong>${escHtml(cur.label)}</strong></span>`;
    // Descente : petit fondu du decor.
    if (changed) { site.classList.remove("dig-site-enter"); void site.offsetWidth; site.classList.add("dig-site-enter"); }
  }
  document.getElementById("dig-bag").innerHTML = `<img class="ico-art" src="assets/Fouille/Pioche_01.PNG" alt="" /> Sac : <strong>${dd.minerals}</strong> minér${dd.minerals > 1 ? "aux" : "al"} · <a href="communaute.html#marche">Comptoir des minéraux &rarr;</a>`;
}
async function setDigDepth(depth) {
  // Case « Plus profond… » (pas de data-depth) : rien a choisir (GlitchTip #39).
  if (!digDepthState || !Number.isInteger(depth) || depth === digDepthState.depth || digBusy) return;
  const started = digTilesCache.some((t) => t.dug);
  if (started && !(await Confirm.show(`Changer de profondeur abandonne la grille en cours (les trésors déjà libérés sont gardés). Descendre à la profondeur <strong>${depth}</strong> ?`, { title: "Changer de profondeur ?", confirmText: "Changer" }))) return;
  try {
    const res = await API.digSetDepth(Session.userId, depth);
    renderDigDepths(res.digDepth);
    await loadDig();
  } catch (e) { Toast.error(e.code === "depth_locked" ? `Niveau ${e.data?.level || ""} de fouille requis.` : friendlyError(e)); }
}
// Raccourcis de la boutique : bandeaux generiques (js/shop-strip.js). Garde
// pour compatibilite : rafraichit tous les bandeaux de la page.
async function renderDigShop() {
  if (window.ShopStrip) return ShopStrip.load();
  const el = document.getElementById("dig-shop");
  if (!el) return;
  try {
    const st = await API.shop(Session.userId);
    const keys = ["coffee", "bone", "xp1h"];
    const items = keys.map((k) => st.items.find((it) => it.key === k)).filter(Boolean);
    el.innerHTML = items.length ? `<span class="dig-shop-label">Boutique :</span>${items.map((it) => `<button type="button" class="btn-ghost dig-shop-btn" data-shop-buy="${it.key}" ${it.left === 0 || st.stardust < it.price ? "disabled" : ""} title="${escHtml(it.desc)}${it.left != null ? ` · encore ${it.left} cette semaine` : ""}">${it.icon} ${escHtml(it.label)} <small>${it.price} &#10024;</small></button>`).join("")}<a class="dig-shop-more" href="boutique.html#bonus">Tout voir</a>` : "";
  } catch (e) { el.innerHTML = ""; }
}

async function loadDig() {
  try {
    const res = await API.getDigStatus(Session.userId);
    digEnergy = res.energy;
    digMaxEnergy = res.maxEnergy || 5;
    digRegenSeconds = res.regenSeconds || 60;
    renderDigEnergy(res.energy, digMaxEnergy, res.secondsUntilNext);
    renderDigBoard(res.tiles || [], res.sniffTile);
    renderKennel(res);
    renderDigLevel(res.digLevel);
    renderDigDepths(res.digDepth);
    if (!window.ShopStrip && !document.getElementById("dig-shop").childElementCount) renderDigShop();
    const regenSeconds = res.regenSeconds || 60;
    const regenLabel = regenSeconds < 60 ? `${regenSeconds}s` : regenSeconds === 60 ? "minute" : `${Math.round(regenSeconds / 60)} min`;
    document.getElementById("dig-intro").textContent =
      `Creuse les tuiles pour trouver des trésors cachés — certains sont étalés sur plusieurs tuiles, il faut toutes les creuser pour libérer l'objet. Chaque tuile coûte 1 point d'énergie (régénère +1 chaque ${regenLabel}, jusqu'à ${digMaxEnergy}).`;
  } catch (e) {
    document.getElementById("dig-status-text").classList.remove("skeleton-line");
    document.getElementById("dig-status-text").textContent = "Impossible de charger l'énergie.";
  }
}

// Compte a rebours en direct (2026-09-30) : auparavant un texte fige, qui
// affichait "prochaine dans 3 min" indefiniment tant que la page n'etait pas
// rechargee a la main, meme une fois l'energie reellement revenue. Decompte
// cote client (pas de nouvel appel reseau chaque seconde) puis re-verifie le
// vrai etat serveur une fois le delai ecoule.
let digCountdownTimer = null;
function renderDigEnergy(energy, maxEnergy, secondsUntilNext) {
  if (digCountdownTimer) { clearInterval(digCountdownTimer); clearTimeout(digCountdownTimer); digCountdownTimer = null; }
  // Tout fouiller : autant de tuiles que l'energie le permet.
  const allBtn = document.getElementById("dig-all-btn");
  // Toujours affiche (avis joueur GlitchTip #59 : on ne le voyait pas, il
  // disparaissait sous 2 d'energie), grise quand il n'y a plus d'energie.
  allBtn.hidden = false;
  allBtn.disabled = digBusy || energy < 1;
  allBtn.innerHTML = energy >= 1 ? `&#9935;&#65039; Tout fouiller (×${energy})` : "&#9935;&#65039; Tout fouiller · plus d'énergie";
  document.getElementById("dig-energy-bar").innerHTML = Array.from({ length: maxEnergy }, (_, i) => `
    <span class="dig-pip ${i < energy ? "filled" : ""}"></span>
  `).join("");
  const statusText = document.getElementById("dig-status-text");
  statusText.classList.remove("skeleton-line");
  const fmt = (sec) => { const m = Math.floor(sec / 60), s2 = sec % 60; return `${m > 0 ? `${m} min ` : ""}${String(s2).padStart(m > 0 ? 2 : 1, "0")} s`; };
  if (energy >= maxEnergy) {
    digDeadline = 0;
    statusText.textContent = `${energy} / ${maxEnergy} énergie — chaque tuile en coûte 1`;
    return;
  }
  // Delai reel renvoye par le serveur (statut ET reponse de fouille depuis
  // 2026-10-01) plutot qu'un 60s suppose. Decompte calcule depuis l'heure
  // d'arrivee du prochain point (2026-10-21) : onglet en arriere-plan, le
  // navigateur espace les minuteries (jusqu'a une par minute) et l'ancien
  // « -1 par tic » prenait du retard, d'ou un compteur fige et une jauge
  // rechargee bien trop tard. Retour sur l'onglet : voir EnergySync.
  digDeadline = Date.now() + (secondsUntilNext || digRegenSeconds || 60) * 1000;
  const left = () => Math.max(0, Math.ceil((digDeadline - Date.now()) / 1000));
  const render = () => {
    statusText.textContent = energy > 0
      ? `${energy} / ${maxEnergy} énergie — +1 dans ${fmt(left())}`
      : `Énergie épuisée — prochaine dans ${fmt(left())}`;
  };
  render();
  digCountdownTimer = setInterval(() => {
    if (left() <= 0) {
      clearInterval(digCountdownTimer);
      digCountdownTimer = null;
      digDeadline = 0;
      loadDig();
      return;
    }
    if (!document.hidden) render();
  }, 1000);
}

// Meme icone pour toutes les tuiles d'un MEME tresor, des le premier coup de
// pioche (pas seulement une fois complet) : c'est ce qui permet de relier
// visuellement des tuiles deja creusees a un tresor commun, plutot qu'une
// fissure generique identique pour tous les tresors en cours.
function digTileContent(tile) {
  if (!tile.dug) return { cls: "", html: "", reward: "" };
  if (!tile.treasure) return { cls: "dug empty", html: "", reward: "" };
  const icon = DIG_REWARD_ICON[tile.treasure.reward] || "&#10024;";
  if (tile.treasure.done) return { cls: "dug revealed", html: `<span class="dig-treasure-glow"></span><span class="dig-treasure-icon">${icon}</span>`, reward: tile.treasure.reward };
  return { cls: "dug partial", html: `<span class="dig-partial-icon">${icon}</span><span class="dig-remaining">-${tile.treasure.remaining}</span>`, reward: tile.treasure.reward };
}

// sniffTile : tuile a tresor signalee par le chien quand il est actif.
function renderDigBoard(tiles, sniffTile) {
  digTilesCache = tiles;
  const board = document.getElementById("dig-board");
  board.innerHTML = tiles.map((t, i) => {
    const { cls, html, reward } = digTileContent(t);
    const disabled = t.dug || digEnergy < 1 || digBusy;
    // Variante de texture (1 a 4, voir [data-variant] en CSS) plutot qu'un
    // unique motif de terre repete a l'identique sur les 16 tuiles - evite
    // l'effet "papier peint" d'un sol parfaitement uniforme.
    const variant = (i % 4) + 1;
    const sniffed = !t.dug && i === sniffTile;
    return `<button type="button" class="dig-tile ${cls} ${sniffed ? "sniffed" : ""}" title="${sniffed ? "Milo flaire quelque chose ici !" : ""}" data-tile-index="${i}" data-variant="${variant}" ${reward ? `data-reward="${reward}"` : ""} ${disabled ? "disabled" : ""} aria-label="${t.dug ? "Tuile creusée" : "Creuser cette tuile"}">${html}${sniffed ? `<span class="dig-sniff-paw" aria-hidden="true">&#128062;</span>` : ""}</button>`;
  }).join("");
  board.querySelectorAll(".dig-tile:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => doDig(Number(btn.dataset.tileIndex), btn));
  });
}

// Petite volee de terre au moment du coup de pioche (embellissement,
// 2026-09-30) : reutilise le calque de particules partage (getParticleLayer,
// ui.js, deja utilise par les eclats de foil a l'ouverture de booster)
// plutot que d'en creer un nouveau conteneur fixe de plus.
function spawnDigDustBurst(tileEl) {
  if (!tileEl || typeof getParticleLayer !== "function") return;
  const rect = tileEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = digLevelCache >= 10 ? ["#f5d76e", "#ffe9b8", "#a9815a", "#22c55e"] : digLevelCache >= 7 ? ["#d4af37", "#a9815a", "#6b4f36", "#f5d76e"] : ["#8a6a4a", "#6b4f36", "#a9815a", "#5a4229"];
  const layer = getParticleLayer();
  const specks = 10 + Math.min(18, digLevelCache * 2);
  for (let i = 0; i < specks; i++) {
    const speck = document.createElement("span");
    speck.className = "dig-dust-speck";
    const angle = Math.PI + Math.random() * Math.PI; // vers le haut, en eventail
    const dist = 20 + Math.random() * 46;
    speck.style.left = cx + "px";
    speck.style.top = cy + "px";
    speck.style.background = colors[Math.floor(Math.random() * colors.length)];
    speck.style.setProperty("--dx", (Math.cos(angle) * dist) + "px");
    speck.style.setProperty("--dy", (Math.sin(angle) * dist) + "px");
    speck.style.animationDuration = (0.45 + Math.random() * 0.25) + "s";
    layer.appendChild(speck);
    setTimeout(() => speck.remove(), 800);
  }
}

// ---------------------------------------------------------------------
// Chenil (2026-10-02) : un os (achete ici contre des poussieres, ou laisse
// par un sacrifice rate a l'autel) envoie le chien creuser a ta place pendant
// 2 h, une tuile toutes les 5 min (2026-10-04), sans energie. Ses trouvailles sont
// creditees a ton retour (voir dig.json "Chien de fouille").
// ---------------------------------------------------------------------
let kennelTimer = null;
function renderKennel(res) {
  const zone = document.getElementById("dig-kennel");
  if (res.boneCost == null) { zone.style.display = "none"; return; } // workflow pas encore a jour
  zone.style.display = "";
  const bones = res.bones || 0;
  const left = res.dogSecondsLeft || 0;
  document.getElementById("dig-kennel-bones").textContent = bones ? `${bones} os` : "";
  const useBtn = document.getElementById("dig-use-bone-btn");
  // Os cumulables (2026-10-04) : redonner un os prolonge la sortie de 2 h,
  // tant que le chien n'a pas deja plus de 10 h devant lui.
  // Plus de limite d'os par jour (2026-10-26) : la fatigue (pets.js) fait des pauses.
  const tired = res.dogTiredSecondsLeft || 0;
  useBtn.disabled = bones < 1 || left > 10 * 3600 || tired > 0;
  zone.dataset.working = left > 0 && !tired ? "1" : "0";
  // Mode excite : beaucoup d'os d'un coup, plusieurs grilles tout de suite.
  const frenzyBtn = document.getElementById("dig-frenzy-btn");
  if (frenzyBtn) {
    const need = res.frenzyBones || 0;
    frenzyBtn.hidden = !need || (bones < need && !tired);
    frenzyBtn.disabled = bones < need || left > 0 || tired > 0;
    frenzyBtn.innerHTML = `&#129322; Mode excité (${need} os)`;
    frenzyBtn.title = left > 0 ? "Attends que Milo rentre de sa sortie" : tired ? "Milo se repose" : `${need} os d'un coup : il creuse ${res.frenzyBoards} grilles tout de suite (poussières ×2), rapporte un crâne de dinosaure garanti, puis il dort ${res.frenzyRestHours} h`;
    frenzyBtn.dataset.boards = res.frenzyBoards || "";
    frenzyBtn.dataset.rest = res.frenzyRestHours || "";
  }
  document.getElementById("dig-kennel-dog").classList.toggle("tired", tired > 0);
  useBtn.title = bones < 1 ? "Il te faut un os (boutique ci-dessus)" : left > 10 * 3600 ? "Il a déjà plus de 10 h de travail devant lui" : "1 os = 2 h de travail";
  useBtn.innerHTML = left > 0 ? resIcon("bone") + " +2 h de travail" : resIcon("bone") + " Faire travailler Milo (2 h)";
  document.getElementById("dig-kennel-dog").classList.toggle("digging", left > 0);
  const text = document.getElementById("dig-kennel-text");
  if (kennelTimer) { clearInterval(kennelTimer); kennelTimer = null; }
  if (tired > 0) {
    const h = Math.floor(tired / 3600), m = Math.floor((tired % 3600) / 60);
    text.textContent = `😴 Épuisé après sa folie de fouille, Milo dort encore ${h ? h + " h " : ""}${m} min. Ni os ni mode excité d'ici là.`;
  } else if (left > 0) {
    let remaining = left;
    const render = () => {
      const h = Math.floor(remaining / 3600), m = Math.floor((remaining % 3600) / 60);
      text.innerHTML = `<strong class="pet-work">Travaille encore ${h ? h + " h " : ""}${String(m).padStart(h ? 2 : 1, "0")} min</strong> · 1 tuile toutes les ${Math.round((res.dogInterval || 300) / 60)} min en moyenne, il flaire les trésors et te montre où creuser 🐾`;
    };
    render();
    kennelTimer = setInterval(() => { remaining -= 30; if (remaining <= 0) { clearInterval(kennelTimer); kennelTimer = null; loadDig(); return; } render(); }, 30000);
  } else {
    text.innerHTML = bones
      ? `<strong class="pet-work idle">Au repos</strong> · un os = 2 h de travail : il creuse sans énergie, flaire les trésors et rapporte cartes et poussières. Il fait de petites pauses quand il est fatigué.`
      : `<strong class="pet-work idle">Au repos</strong> · un os (boutique ci-dessus) envoie Milo creuser 2 h à ta place. Il fait de petites pauses quand il est fatigué.`;
  }
  announceDogReport(res.dogReport);
}

function announceDogReport(r) {
  if (r && r.tiles > 0) {
    const parts = [];
    if (r.dust) parts.push(`+${r.dust} poussières`);
    if (r.boosters) parts.push(`+${r.boosters} jeton${r.boosters > 1 ? "s" : ""} booster`);
    if (r.kennelBonus) parts.push(`(dont +${r.kennelBonus} grâce au chenil)`);
    if (r.tablets) parts.push(`🏺 ${r.tablets} tablette${r.tablets > 1 ? "s" : ""} ancienne${r.tablets > 1 ? "s" : ""} (onglet Archéologie)`);
    if (r.loveBonus) parts.push(`(dont +${r.loveBonus} grâce à ta tendresse ❤️)`);
    if (r.loveGift) parts.push(`${r.loveGift.icon} un petit cadeau : ${escHtml(r.loveGift.label)}`);
    if (r.keys) parts.push(`+${r.keys} ${resIcon("key")}`);
    if (r.worms) parts.push(`+${r.worms} vers de terre ${resIcon("worm")}`);
    (r.mineralItems || []).forEach((m) => parts.push(`<img class="ico-art" src="assets/${encodeURI(m.img)}" alt="" /> ${escHtml(m.name)} (palier ${m.tier})`));
    (r.cards || []).forEach((c) => parts.push(`&#127183; ${c.name}${c.serialNumber != null ? " #" + String(c.serialNumber).padStart(3, "0") : ""}`));
    showDogPostcard(r, parts);
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  }
}

// Carte postale du chien : ce qu'il a rapporte pendant ton absence.
function showDogPostcard(r, parts) {
  const overlay = document.createElement("div");
  overlay.className = "card-modal-overlay dog-postcard-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Rapport de Milo");
  overlay.innerHTML = `
    <div class="dog-postcard">
      <div class="dog-postcard-stamp" aria-hidden="true">&#128062;</div>
      <div class="dog-postcard-pic" aria-hidden="true">&#128021;&#9935;&#65039;</div>
      <div class="dog-postcard-text">
        <div class="dog-postcard-title">${r.frenzy ? "WOUAF WOUAF WOUAF !!!" : "Bons baisers du chantier !"}</div>
        <p>${r.frenzy ? `Mode excité : j'ai retourné <strong>${r.boards || (r.frenzy && r.frenzy.boards) || ""} grilles</strong> d'un coup (${r.tiles} tuiles). Maintenant… je suis crevé. Zzz.` : `Pendant ton absence, j'ai creusé <strong>${r.tiles} tuile${r.tiles > 1 ? "s" : ""}</strong>.`}</p>
        ${parts.length ? `<ul>${parts.map((p) => `<li>${p}</li>`).join("")}</ul>` : "<p>Rien trouvé cette fois… mais j'ai bien remué la terre !</p>"}
        <div class="dog-postcard-sign">Ton chien, Milo &#128062;</div>
      </div>
      <button type="button" class="btn dog-postcard-close">Merci !</button>
    </div>`;
  const close = () => { overlay.remove(); syncScrollLock(); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest(".dog-postcard-close")) close(); });
  document.body.appendChild(overlay);
  syncScrollLock();
}

// Mode excite : confirmation, chien surexcite, puis carte postale speciale.
async function dogFrenzy(btn) {
  const need = btn.textContent.match(/\d+/);
  const okGo = await Confirm.show(`Donner <strong>${need ? need[0] : ""} os d'un coup</strong> à Milo ? Surexcité, il creuse <strong>${btn.dataset.boards} grilles entières</strong> tout de suite (poussières ×2) et rapporte à coup sûr un <strong>crâne de dinosaure</strong> 💀, puis il dort <strong>${btn.dataset.rest} h</strong> : ni os ni mode excité pendant ce temps.`, { title: "Mode excité", confirmText: "C'est parti !" });
  if (!okGo) return;
  btn.disabled = true;
  const dog = document.getElementById("dig-kennel-dog");
  dog.classList.add("frenzy");
  try {
    const res = await API.dogFrenzy(Session.userId);
    await new Promise((r) => setTimeout(r, 1200));
    dog.classList.remove("frenzy");
    if (res.dogReport) res.dogReport.frenzy = res.frenzy || true;
    announceDogReport(res.dogReport);
    if (typeof confetti === "function") confetti({ particleCount: 160, spread: 110, origin: { y: 0.55 } });
    // Crane de dinosaure garanti (api/src/native/dino.js).
    if (res.dinoSkull) {
      document.getElementById("tab-dino-btn").style.display = "";
      setTimeout(() => Toast.success(`💀 Milo a déterré un CRÂNE DE DINOSAURE ! Tu en as ${res.dinoSkull.total}. Avec ${res.dinoSkull.hatchBones} os, ramène-le à la vie dans l'onglet Dinos.`), 900);
    }
    await loadDig();
  } catch (e) {
    dog.classList.remove("frenzy");
    btn.disabled = false;
    Toast.error({ not_enough_bones: "Pas assez d'os pour le mode excité.", dog_tired: "Milo se repose encore.", dog_busy: "Attends que Milo rentre de sa sortie." }[e.code] || friendlyError(e));
  }
}

async function kennelAction(kind, btn) {
  btn.disabled = true;
  try {
    if (kind === "buy") { await API.buyBone(Session.userId); Toast.success(resIcon("bone") + " Os acheté !"); }
    else { await API.useBone(Session.userId); Toast.success(btn.textContent.includes("Prolonger") ? "&#128021; 2 h de fouille en plus !" : "&#128021; Milo part creuser pour 2 h !"); }
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    await loadDig();
  } catch (e) {
    btn.disabled = false;
    const msg = { not_enough_dust: "Pas assez de poussières.", no_bone: "Il te faut un os.", dog_already_active: "Milo creuse déjà !", dog_max_time: "Milo a déjà assez de travail pour le moment.", dog_daily_limit: "Milo a assez creusé aujourd'hui : reviens demain !" };
    Toast.error(msg[e.code] || friendlyError(e));
  }
}

// Tout fouiller (2026-10-31) : toute l'energie en une requete, le serveur tire
// les tuiles (tileIndex "auto", api/src/native/digdepth.js) et les grilles
// terminees s'enchainent. Memes regles qu'a la main ; bilan unique a la fin.
async function digAll(btn) {
  const n = digEnergy;
  if (digBusy || n < 1) return;
  digBusy = true;
  btn.disabled = true;
  const resultEl = document.getElementById("dig-result");
  try {
    const results = await API.batchWrite("dig", Array.from({ length: n }, () => ({ userId: Session.userId, action: "dig", tileIndex: "auto" })));
    const dug = results.filter((r) => r.status === 200 && r.json && r.json.dug).map((r) => r.json);
    if (!dug.length) { Toast.error(results[0]?.json?.error === "no_energy" ? "Plus assez d'énergie." : "La fouille n'a pas pu se faire."); return; }
    const sum = (key) => dug.reduce((s, d) => s + (Number(d[key]) || 0), 0);
    const cards = dug.filter((d) => d.outcome === "card" && d.card).map((d) => d.card);
    const minerals = dug.filter((d) => d.outcome === "mineral" && d.mineral).map((d) => d.mineral);
    const boosters = dug.filter((d) => d.boosterGranted).length;
    const keys = dug.filter((d) => d.foundKey).length;
    const skull = dug.filter((d) => d.dinoSkull).pop()?.dinoSkull;
    const grids = dug.filter((d) => d.boardCleared).length;
    const kinds = dug.flatMap((d) => d.tabletKinds || []);
    const parts = [];
    if (sum("dustGained")) parts.push(`+${sum("dustGained")} poussières`);
    if (boosters) parts.push(`+${boosters} jeton${boosters > 1 ? "s" : ""} booster`);
    if (keys) parts.push(`+${keys} ${resIcon("key")}`);
    if (sum("wormsFound")) parts.push(`+${sum("wormsFound")} ${resIcon("worm")}`);
    if (sum("carrotsFound")) parts.push(`+${sum("carrotsFound")} &#129365;`);
    if (sum("tabletsFound")) parts.push(`&#127994; ${sum("tabletsFound")} tablette${sum("tabletsFound") > 1 ? "s" : ""}`);
    const lines = [
      ...cards.map((c) => `<li>&#127183; <strong>${escHtml(c.name)}</strong>${c.rarity ? ` (${escHtml(c.rarity.name)})` : ""}</li>`),
      ...minerals.map((m) => `<li><img class="ico-art" src="assets/${encodeURI(m.img)}" alt="" /> ${escHtml(m.name)} <span class="mineral-tier tier-${m.tier}">palier ${m.tier}</span></li>`),
      ...kinds.map((k) => `<li>${k.icon} ${escHtml(k.label)}</li>`)
    ];
    resultEl.style.display = "block";
    resultEl.innerHTML = `&#9935;&#65039; <strong>${dug.length} tuile${dug.length > 1 ? "s" : ""} creusée${dug.length > 1 ? "s" : ""}</strong>${grids ? `, ${grids} grille${grids > 1 ? "s" : ""} terminée${grids > 1 ? "s" : ""}` : ""} : ${parts.join(" · ") || "rien trouvé cette fois"}.${lines.length ? `<ul>${lines.join("")}</ul>` : ""}`;
    if (skull) {
      document.getElementById("tab-dino-btn").style.display = "";
      resultEl.insertAdjacentHTML("beforeend", `<div class="dig-skull"><img class="ico-art" src="assets/CraneDeDino.png" alt="" /> <strong>Incroyable : un crâne de dinosaure !</strong> Avec ${skull.hatchBones} os, ramène-le à la vie dans l'onglet <a href="jeux.html#dinos">Dinos</a>.</div>`);
      Toast.success("&#128128; Tu as déterré un CRÂNE DE DINOSAURE !");
    }
    if (dug.some((d) => d.reducedRewards)) resultEl.insertAdjacentHTML("beforeend", `<div class="dig-reduced">Rendement réduit : plus de poussières à plein tarif aujourd'hui (reviens demain).</div>`);
    if (kinds.length || sum("tabletsFound")) resultEl.insertAdjacentHTML("beforeend", `<div class="dig-worms"><a href="jeux.html#archeologie">Va dégager tes tablettes</a></div>`);
    const up = dug.filter((d) => d.levelUp).pop();
    if (up) announceLevelUp(toolFor(DIG_TOOLS, up.levelUp).icon, "Fouille", up.levelUp, up.digLevel);
    announceDogReport(dug.find((d) => d.dogReport && d.dogReport.tiles > 0)?.dogReport);
    if ((skull || cards.length) && typeof confetti === "function") confetti({ particleCount: skull ? 250 : 150, spread: skull ? 140 : 100, origin: { y: 0.5 } });
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error(friendlyError(e));
  } finally {
    digBusy = false;
    await loadDig();
  }
}

async function doDig(tileIndex, tileEl) {
  if (digBusy || digEnergy < 1) return;
  digBusy = true;
  spawnDigDustBurst(tileEl);
  const resultEl = document.getElementById("dig-result");
  try {
    const res = await API.dig(Session.userId, tileIndex);
    digEnergy = res.newEnergy;
    digBusy = false;
    renderDigEnergy(res.newEnergy, res.maxEnergy || digMaxEnergy, res.secondsUntilNext || null);
    renderDigBoard(res.tiles || [], res.sniffTile);
    announceDogReport(res.dogReport);
    renderDigLevel(res.digLevel);
    renderDigDepths(res.digDepth);
    if (res.levelUp) announceLevelUp(toolFor(DIG_TOOLS, res.levelUp).icon, "Fouille", res.levelUp, res.digLevel);

    resultEl.style.display = "block";
    if (res.outcome === "partial") {
      resultEl.innerHTML = `&#9889; Un objet se cache ici, mais il faut creuser encore <strong>${res.remaining}</strong> tuile${res.remaining > 1 ? "s" : ""} pour le libérer.`;
    } else if (res.outcome === "nothing") {
      resultEl.innerHTML = `&#128269; Rien trouvé sous cette tuile.`;
    } else if (res.outcome === "dust") {
      resultEl.innerHTML = `&#10024; Trésor libéré : +${res.dustGained} poussières d'étoile !${res.levelDustBonus ? ` <span class="muted">(dont +${res.levelDustBonus} grâce à ton niveau)</span>` : ""}`;
    } else if (res.outcome === "mineral" && res.mineral) {
      resultEl.innerHTML = `<img class="dig-mineral-img" src="assets/${encodeURI(res.mineral.img)}" alt="" /> Minéral trouvé : <strong>${escHtml(res.mineral.name)}</strong> <span class="mineral-tier tier-${res.mineral.tier}">palier ${res.mineral.tier}</span> !`;
      if (res.mineral.tier >= 4 && typeof confetti === "function") confetti({ particleCount: 120, spread: 90, origin: { y: 0.5 } });
    } else if (res.outcome === "booster") {
      if (typeof Haptics !== "undefined") Haptics.buzz([20, 40, 20]);
      resultEl.innerHTML = `&#127183; Trésor libéré : +1 jeton booster !`;
      if (typeof confetti === "function") confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 } });
    } else if (res.outcome === "card") {
      const isRare = res.card.rarity && res.card.rarity.key !== "commune";
      if (typeof Haptics !== "undefined") Haptics.buzz(isRare ? [30, 50, 30, 50, 80] : [20, 40, 20]);
      const icon = isRare ? "&#127775;" : "&#127942;";
      const rarityLabel = res.card.rarity ? ` (${res.card.rarity.name})` : "";
      resultEl.innerHTML = `${icon} Trésor libéré : tu as trouvé <strong>${res.card.name}</strong>${rarityLabel} !`;
      if (typeof confetti === "function") confetti({ particleCount: isRare ? 220 : 150, spread: isRare ? 130 : 100, origin: { y: 0.5 } });
    }

    if (res.dinoSkull) {
      document.getElementById("tab-dino-btn").style.display = "";
      resultEl.insertAdjacentHTML("beforeend", `<div class="dig-skull"><img class="ico-art" src="assets/CraneDeDino.png" alt="" /> <strong>Incroyable : un crâne de dinosaure !</strong> Avec ${res.dinoSkull.hatchBones} os, ramène-le à la vie dans l'onglet <a href="jeux.html#dinos">Dinos</a>.</div>`);
      Toast.success("&#128128; Tu as déterré un CRÂNE DE DINOSAURE !");
      if (typeof confetti === "function") confetti({ particleCount: 250, spread: 140, origin: { y: 0.5 } });
    }
    if (res.foundKey) {
      if (typeof Haptics !== "undefined") Haptics.buzz(30);
      Toast.success(resIcon("key") + " Tu as trouvé une clé !");
      if (typeof confetti === "function") confetti({ particleCount: 60, spread: 60, origin: { y: 0.5 } });
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    }

    if (res.reducedRewards) resultEl.insertAdjacentHTML("beforeend", `<div class="dig-reduced">Rendement réduit : plus de poussières à plein tarif aujourd'hui (reviens demain).</div>`);
    // Tablette ancienne (api/src/native/archeo.js) : a degager dans l'onglet Archeologie.
    if (res.carrotsFound) resultEl.insertAdjacentHTML("beforeend", `<div class="dig-worms">&#129365; ${res.carrotsFound > 1 ? `${res.carrotsFound} carottes sauvages` : "Une carotte sauvage"} ${PetText.mask("pour Noisette")} !</div>`);
    if (res.tabletsFound) {
      resultEl.insertAdjacentHTML("beforeend", `<div class="dig-worms">${res.tabletKinds && res.tabletKinds.length ? res.tabletKinds.map((k) => `${k.icon} <strong>${escHtml(k.label)}</strong>${k.rarity !== "commune" ? ` (${escHtml(k.rarity)})` : ""}`).join(", ") : `🏺 ${res.tabletsFound > 1 ? res.tabletsFound + " tablettes anciennes" : "Une tablette ancienne"}`} sous la terre ! <a href="jeux.html#archeologie">Va la dégager</a></div>`);
      Toast.success(`🏺 Tablette ancienne trouvée ! Onglet Archéologie.`);
    }
    if (res.wormsFound) {
      resultEl.insertAdjacentHTML("beforeend", `<div class="dig-worms">${resIcon("worm")} +${res.wormsFound} vers de terre dans la terre qui restait${res.leftoverTiles ? ` (${res.leftoverTiles} case${res.leftoverTiles > 1 ? "s" : ""} jamais creusée${res.leftoverTiles > 1 ? "s" : ""})` : ""} : de quoi pêcher !</div>`);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    }
    if (res.boardCleared) {
      setTimeout(() => {
        Toast.info("Tous les trésors sont trouvés : nouvelle grille !");
        loadDig();
      }, 1400);
    }
  } catch (e) {
    // Tuile creusee entre-temps (Milo, autre onglet) : la grille affichee
    // etait en retard, on la recharge sans erreur (GlitchTip #32).
    if (e.code === "tile_already_dug") { digBusy = false; Toast.info("Cette tuile a déjà été creusée : la grille est à jour."); loadDig(); return; }
    Toast.error(e.code === "no_energy" ? "Plus assez d'énergie." : friendlyError(e));
  } finally {
    digBusy = false;
  }
}
