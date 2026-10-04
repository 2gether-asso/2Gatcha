// Logique de la page Jeux : fouille, devine la carte, expedition, bingo de
// collection et coffre-fort.


// Memorise le dernier onglet visite (QoL 2026-09-30) : revenir sur "Jeux"
// rouvrait toujours "Fouille" par defaut, meme si on passait le plus clair
// de son temps sur "Coffre-fort".
const LAST_TAB_KEY = "2gatcha_last_tab_jeux";
function getInitialTab() {
  try { return localStorage.getItem(LAST_TAB_KEY) || "dig"; } catch (e) { return "dig"; }
}

function setActiveTab(tab) {
  ["dig", "guess", "expedition", "fish", "bingo", "vault"].forEach((key) => {
    document.getElementById(`tab-${key}-btn`).classList.toggle("active", tab === key);
    document.getElementById(`tab-${key}-btn`).setAttribute("aria-selected", String(tab === key));
    document.getElementById(`${key}-pane`).style.display = tab === key ? "block" : "none";
  });
  try { localStorage.setItem(LAST_TAB_KEY, tab); } catch (e) {}
  if (tab === "dig") loadDig();
  if (tab === "guess") loadGuess();
  if (tab === "expedition") loadExpedition();
  if (tab === "fish") loadFishing();
  if (tab === "bingo") loadBingo();
  if (tab === "vault") loadVault();
}

// -----------------------------------------------------------------------
// Fouille : grille de 16 tuiles a creuser. Certains tresors sont etales sur
// plusieurs tuiles (voir docs/SCHEMA.md) - une tuile "partielle" le signale
// discretement (une fissure de plus, pas la position exacte des autres
// tuiles du meme tresor) sans jamais reveler ce qui est cache ailleurs.
// -----------------------------------------------------------------------
let digEnergy = 0;
let digMaxEnergy = 5;
let digRegenSeconds = 60;
let digBusy = false;

// -----------------------------------------------------------------------
// Niveaux de metier (api/src/native/levels.js) : peche et fouille, 1 a 10.
// -----------------------------------------------------------------------
function renderSkillLevel(id, icon, name, info, perks) {
  const el = document.getElementById(id);
  if (!el || !info) return;
  el.hidden = false;
  const pct = info.next == null ? 100 : Math.min(100, ((info.xp - info.current) / (info.next - info.current)) * 100);
  el.innerHTML = `
    <div class="skill-level-head">
      <span class="skill-level-badge">${icon} ${name} <strong>niv. ${info.level}</strong>${info.level >= info.max ? " (max)" : ""}</span>
      <span class="skill-level-xp">${info.next == null ? `${info.xp} XP` : `${info.xp - info.current} / ${info.next - info.current} XP`}</span>
    </div>
    <div class="skill-level-bar" role="progressbar" aria-label="Progression ${name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="skill-level-fill" style="width:${pct}%"></div></div>
    <div class="skill-level-perks">${perks.filter(Boolean).map((p) => `<span>${p}</span>`).join("") || "<span>Joue pour monter de niveau : chaque niveau donne un bonus.</span>"}</div>`;
}

function announceLevelUp(icon, name, level) {
  Toast.success(`${icon} ${name} : niveau ${level} atteint !`);
  if (typeof confetti === "function") confetti({ particleCount: 120, spread: 100, origin: { y: 0.6 } });
}

function renderDigLevel(info) {
  if (!info) return;
  const p = info.perks || {};
  renderSkillLevel("dig-level", "&#9935;&#65039;", "Fouille", info, [
    p.energyBonus ? `+${p.energyBonus} énergie max` : "",
    p.regenReduction ? `recharge ${Math.round(p.regenReduction * 100)} % plus rapide` : "",
    p.dustBonus ? `+${Math.round(p.dustBonus * 100)} % de poussières trouvées` : "",
    p.dogSpeed ? `chien ${Math.round(p.dogSpeed * 100)} % plus rapide, plus de flair` : ""
  ]);
}

function renderFishLevel(info) {
  if (!info) return;
  const p = info.perks || {};
  renderSkillLevel("fish-level", "&#127907;", "Pêche", info, [
    p.extraCasts ? `+${p.extraCasts} lancers par jour` : "",
    p.emptyReduction ? `${Math.round(p.emptyReduction * 100)} % de prises vides en moins` : "",
    p.rareBoost ? `+${Math.round(p.rareBoost * 100)} % de chances de prises rares` : ""
  ]);
}

const DIG_REWARD_ICON = { smallDust: "&#10024;", bigDust: "&#128142;", booster: "&#127183;", card: "&#127942;", rareCard: "&#127775;" };

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
  document.getElementById("dig-energy-bar").innerHTML = Array.from({ length: maxEnergy }, (_, i) => `
    <span class="dig-pip ${i < energy ? "filled" : ""}"></span>
  `).join("");
  const statusText = document.getElementById("dig-status-text");
  statusText.classList.remove("skeleton-line");
  if (energy > 0) {
    statusText.textContent = `${energy} / ${maxEnergy} énergie — chaque tuile en coûte 1`;
    // Jauge pas pleine : on recharge l'etat reel au moment ou le prochain
    // point revient, au lieu d'attendre un rechargement manuel de la page.
    if (energy < maxEnergy && secondsUntilNext) {
      digCountdownTimer = setTimeout(() => { digCountdownTimer = null; loadDig(); }, (secondsUntilNext + 1) * 1000);
    }
    return;
  }
  // Delai reel renvoye par le serveur (statut ET reponse de fouille depuis
  // 2026-10-01) plutot qu'un 60s suppose : avec un delai de regen configure
  // plus long, l'ancien decompte annoncait "moins d'une minute" a tort.
  let remaining = secondsUntilNext || digRegenSeconds || 60;
  const render = () => {
    const m = Math.floor(remaining / 60), s = remaining % 60;
    statusText.textContent = `Énergie épuisée — prochaine dans ${m > 0 ? `${m} min ` : ""}${String(s).padStart(m > 0 ? 2 : 1, "0")} s`;
  };
  render();
  digCountdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(digCountdownTimer);
      digCountdownTimer = null;
      loadDig();
      return;
    }
    render();
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
  const board = document.getElementById("dig-board");
  board.innerHTML = tiles.map((t, i) => {
    const { cls, html, reward } = digTileContent(t);
    const disabled = t.dug || digEnergy < 1 || digBusy;
    // Variante de texture (1 a 4, voir [data-variant] en CSS) plutot qu'un
    // unique motif de terre repete a l'identique sur les 16 tuiles - evite
    // l'effet "papier peint" d'un sol parfaitement uniforme.
    const variant = (i % 4) + 1;
    const sniffed = !t.dug && i === sniffTile;
    return `<button type="button" class="dig-tile ${cls} ${sniffed ? "sniffed" : ""}" title="${sniffed ? "Le chien flaire quelque chose ici !" : ""}" data-tile-index="${i}" data-variant="${variant}" ${reward ? `data-reward="${reward}"` : ""} ${disabled ? "disabled" : ""} aria-label="${t.dug ? "Tuile creusée" : "Creuser cette tuile"}">${html}${sniffed ? `<span class="dig-sniff-paw" aria-hidden="true">&#128062;</span>` : ""}</button>`;
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
  const colors = ["#8a6a4a", "#6b4f36", "#a9815a", "#5a4229"];
  const layer = getParticleLayer();
  for (let i = 0; i < 10; i++) {
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
  const buyBtn = document.getElementById("dig-buy-bone-btn");
  buyBtn.innerHTML = `Acheter un os (${res.boneCost} &#10024;)`;
  const useBtn = document.getElementById("dig-use-bone-btn");
  // Os cumulables (2026-10-04) : redonner un os prolonge la sortie de 2 h,
  // tant que le chien n'a pas deja plus de 10 h devant lui.
  useBtn.disabled = bones < 1 || left > 10 * 3600;
  useBtn.innerHTML = left > 0 ? "&#129460; Prolonger de 2 h" : "&#129460; Lancer le chien";
  document.getElementById("dig-kennel-dog").classList.toggle("digging", left > 0);
  const text = document.getElementById("dig-kennel-text");
  if (kennelTimer) { clearInterval(kennelTimer); kennelTimer = null; }
  if (left > 0) {
    let remaining = left;
    const render = () => {
      const h = Math.floor(remaining / 3600), m = Math.floor((remaining % 3600) / 60);
      text.textContent = `Le chien creuse pour toi encore ${h ? h + " h " : ""}${m} min (1 tuile toutes les ${Math.round((res.dogInterval || 300) / 60)} min). Il flaire les trésors et te montre où creuser 🐾`;
    };
    render();
    kennelTimer = setInterval(() => { remaining -= 30; if (remaining <= 0) { clearInterval(kennelTimer); kennelTimer = null; loadDig(); return; } render(); }, 30000);
  } else {
    text.textContent = bones
      ? "Donne-lui un os : il creuse 2 h pour toi sans énergie (24 tuiles), flaire les trésors, rapporte les cartes trouvées et te montre où creuser."
      : "Un os envoie le chien creuser 2 h à ta place : 24 tuiles, du flair pour les trésors et les vraies cartes rapportées.";
  }
  announceDogReport(res.dogReport);
}

function announceDogReport(r) {
  if (r && r.tiles > 0) {
    const parts = [];
    if (r.dust) parts.push(`+${r.dust} poussières`);
    if (r.boosters) parts.push(`+${r.boosters} booster${r.boosters > 1 ? "s" : ""}`);
    if (r.keys) parts.push(`+${r.keys} &#128273;`);
    (r.cards || []).forEach((c) => parts.push(`&#127183; ${c.name}${c.serialNumber != null ? " #" + String(c.serialNumber).padStart(3, "0") : ""}`));
    Toast.success(`&#128021; Le chien a creusé ${r.tiles} tuile${r.tiles > 1 ? "s" : ""}${parts.length ? " : " + parts.join(", ") : " (rien trouvé)"}.`);
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  }
}

async function kennelAction(kind, btn) {
  btn.disabled = true;
  try {
    if (kind === "buy") { await API.buyBone(Session.userId); Toast.success("&#129460; Os acheté !"); }
    else { await API.useBone(Session.userId); Toast.success(btn.textContent.includes("Prolonger") ? "&#128021; 2 h de fouille en plus !" : "&#128021; Le chien part creuser pour 2 h !"); }
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    await loadDig();
  } catch (e) {
    btn.disabled = false;
    const msg = { not_enough_dust: "Pas assez de poussières.", no_bone: "Il te faut un os.", dog_already_active: "Le chien creuse déjà !", dog_max_time: "Le chien a déjà assez de travail pour le moment." };
    Toast.error(msg[e.code] || ("Erreur. (" + e.message + ")"));
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
    if (res.levelUp) announceLevelUp("&#9935;&#65039;", "Fouille", res.levelUp);

    resultEl.style.display = "block";
    if (res.outcome === "partial") {
      resultEl.innerHTML = `&#9889; Un objet se cache ici, mais il faut creuser encore <strong>${res.remaining}</strong> tuile${res.remaining > 1 ? "s" : ""} pour le libérer.`;
    } else if (res.outcome === "nothing") {
      resultEl.innerHTML = `&#128269; Rien trouvé sous cette tuile.`;
    } else if (res.outcome === "dust") {
      resultEl.innerHTML = `&#10024; Trésor libéré : +${res.dustGained} poussières d'étoile !${res.levelDustBonus ? ` <span class="muted">(dont +${res.levelDustBonus} grâce à ton niveau)</span>` : ""}`;
    } else if (res.outcome === "booster") {
      resultEl.innerHTML = `&#127183; Trésor libéré : +1 booster !`;
      if (typeof confetti === "function") confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 } });
    } else if (res.outcome === "card") {
      const isRare = res.card.rarity && res.card.rarity.key !== "commune";
      const icon = isRare ? "&#127775;" : "&#127942;";
      const rarityLabel = res.card.rarity ? ` (${res.card.rarity.name})` : "";
      resultEl.innerHTML = `${icon} Trésor libéré : tu as trouvé <strong>${res.card.name}</strong>${rarityLabel} !`;
      if (typeof confetti === "function") confetti({ particleCount: isRare ? 220 : 150, spread: isRare ? 130 : 100, origin: { y: 0.5 } });
    }

    if (res.foundKey) {
      Toast.success("&#128273; Tu as trouvé une clef secrète !");
      if (typeof confetti === "function") confetti({ particleCount: 60, spread: 60, origin: { y: 0.5 } });
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    }

    if (res.boardCleared) {
      setTimeout(() => {
        Toast.info("Tous les trésors sont trouvés : nouvelle grille !");
        loadDig();
      }, 1400);
    }
  } catch (e) {
    Toast.error(e.code === "no_energy" ? "Plus assez d'énergie." : e.code === "tile_already_dug" ? "Cette tuile est déjà creusée." : ("Erreur. (" + e.message + ")"));
  } finally {
    digBusy = false;
  }
}

// -----------------------------------------------------------------------
// Peche (api/src/native/fishing.js) : chaque lancer coute des poussieres et
// ramene une prise tiree dans une table ponderee (reglable dans l'admin).
// -----------------------------------------------------------------------
const FISH_ICONS = { nothing: "&#129406;", dust: "&#10024;", bone: "&#129460;", key: "&#128273;", booster: "&#127873;", chest: "&#129520;", part: "&#128297;" };
let fishState = null;
let fishBusy = false;
const fishWait = (ms) => new Promise((r) => setTimeout(r, ms));

function fishCatchText(c) {
  if (c.type === "nothing") return c.label;
  if (c.type === "dust") return `+${c.amount} poussières`;
  return `${c.amount > 1 ? c.amount + " × " : ""}${c.label}`;
}

function renderFishing(st) {
  fishState = st;
  renderFishLevel(st.level);
  const left = st.castsLeft == null ? "illimités" : `${st.castsLeft} restant${st.castsLeft > 1 ? "s" : ""} aujourd'hui`;
  document.getElementById("fish-meta").innerHTML = `${st.cost} &#10024; le lancer · ${left} · tu as ${st.stardust} &#10024;`;
  document.getElementById("fish-cast-btn").innerHTML = `&#127907; Lancer (${st.cost} &#10024;)`;
  document.getElementById("fish-cast-btn").disabled = fishBusy || st.stardust < st.cost || st.castsLeft === 0;
  document.getElementById("fish-cast5-btn").innerHTML = `Lancer ×5 (${st.cost * 5} &#10024;)`;
  document.getElementById("fish-cast5-btn").disabled = fishBusy || st.stardust < st.cost * 5 || (st.castsLeft != null && st.castsLeft < 5);
  document.getElementById("fish-table").innerHTML = `<thead><tr><th>Prise</th><th>Quantité</th><th>Chance</th></tr></thead><tbody>${st.table.map((x) => `
    <tr class="fish-row-${x.tier}"><td>${FISH_ICONS[x.type] || ""} ${x.label}</td><td>${x.type === "nothing" ? "—" : (x.min === x.max || x.max == null ? (x.min || 1) : `${x.min} à ${x.max}`)}</td><td>${x.chance} %</td></tr>`).join("")}</tbody>`;
}

async function loadFishing() {
  try { renderFishing(await API.fishing(Session.userId, "status")); }
  catch (e) { document.getElementById("fish-status").textContent = "Impossible de charger la pêche."; }
}

async function castFishing(count) {
  if (fishBusy || !fishState) return;
  fishBusy = true;
  renderFishing(fishState);
  const scene = document.getElementById("fish-scene");
  const status = document.getElementById("fish-status");
  const catchEl = document.getElementById("fish-catch");
  catchEl.hidden = true;
  scene.classList.remove("bite", "caught");
  scene.classList.add("casting");
  status.textContent = "La ligne file…";
  try {
    const request = API.fishing(Session.userId, "cast", count);
    await fishWait(700);
    scene.classList.replace("casting", "waiting");
    status.textContent = "On attend que ça morde…";
    const [res] = await Promise.all([request, fishWait(900 + Math.random() * 1100)]);
    scene.classList.replace("waiting", "bite");
    status.textContent = "Ça mord !";
    if (typeof Sfx !== "undefined" && Sfx.click) Sfx.click();
    await fishWait(550);
    scene.classList.replace("bite", "caught");
    const best = res.catches.reduce((a, c) => (["nothing", "commune", "rare", "epique", "legendaire", "mythique"].indexOf(c.tier) > ["nothing", "commune", "rare", "epique", "legendaire", "mythique"].indexOf(a.tier) ? c : a), res.catches[0]);
    catchEl.hidden = false;
    catchEl.className = "fish-catch tier-" + best.tier;
    catchEl.innerHTML = res.catches.map((c) => `<span class="fish-catch-item tier-${c.tier}"><span class="fish-catch-icon">${FISH_ICONS[c.type] || ""}</span>${fishCatchText(c)}</span>`).join("");
    status.textContent = res.catches.length > 1 ? `${res.catches.length} prises !` : (best.type === "nothing" ? "Pas de chance…" : "Belle prise !");
    if (["epique", "legendaire", "mythique"].includes(best.tier) && typeof confetti === "function") confetti({ particleCount: best.tier === "mythique" ? 180 : 90, spread: 90, origin: { y: 0.55 } });
    const log = document.getElementById("fish-log");
    log.insertAdjacentHTML("afterbegin", res.catches.map((c) => `<span class="fish-log-item tier-${c.tier}">${FISH_ICONS[c.type] || ""} ${fishCatchText(c)}</span>`).join(""));
    while (log.children.length > 20) log.lastElementChild.remove();
    fishBusy = false;
    renderFishing(res);
    if (res.levelUp) announceLevelUp("&#127907;", "Pêche", res.levelUp);
    if (res.catches.some((c) => c.type === "part")) Toast.info("&#128297; Pièce détachée : dans l'atelier (Finitions ou Qualité), elle remplace un des exemplaires à consommer.");
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    fishBusy = false;
    scene.classList.remove("casting", "waiting", "bite");
    status.textContent = "Prêt à pêcher";
    Toast.error({ not_enough_dust: "Pas assez de poussières.", daily_limit: "Plus de lancers pour aujourd'hui : reviens demain !" }[e.code] || ("Erreur. (" + e.message + ")"));
    loadFishing();
  }
}

// -----------------------------------------------------------------------
// Bingo
// -----------------------------------------------------------------------
async function loadBingo() {
  try {
    const res = await API.getBingoStatus(Session.userId);
    if (!res.hasGrid) {
      document.getElementById("bingo-no-grid").style.display = "block";
      document.getElementById("bingo-zone").style.display = "none";
      return;
    }
    document.getElementById("bingo-no-grid").style.display = "none";
    document.getElementById("bingo-zone").style.display = "block";
    document.getElementById("bingo-grid").innerHTML = (res.cells || []).map((c) => {
      const color = c.rarity?.colorHex || "#9aa0b4";
      const imgSrc = API.imageUrl(c.imageId) || PLACEHOLDER_IMG;
      return `
        <div class="bingo-cell ${c.owned ? "owned" : ""}" style="border-color:${c.owned ? color : "transparent"};">
          <img src="${imgSrc}" alt="${c.name}" loading="lazy" />
          <div class="bingo-cell-name">${c.name}</div>
          ${c.owned ? `<span class="bingo-cell-check">&#9989;</span>` : ""}
        </div>
      `;
    }).join("");
    const claimBtn = document.getElementById("bingo-claim-btn");
    const claimedLabel = document.getElementById("bingo-claimed-label");
    if (res.claimed) {
      claimBtn.style.display = "none";
      claimedLabel.style.display = "inline-flex";
    } else if (res.allOwned) {
      claimBtn.style.display = "inline-flex";
      claimedLabel.style.display = "none";
    } else {
      claimBtn.style.display = "none";
      claimedLabel.style.display = "none";
    }
  } catch (e) {
    document.getElementById("bingo-no-grid").style.display = "block";
    document.getElementById("bingo-no-grid").textContent = "Impossible de charger le bingo.";
  }
}

async function claimBingo() {
  try {
    const res = await API.claimBingo(Session.userId);
    Toast.success(`Bingo complet ! +${res.rewardBoosters} boosters !`);
    if (typeof confetti === "function") confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } });
    await loadBingo();
  } catch (e) {
    Toast.error(e.code === "already_claimed" ? "Déjà réclamé ce mois-ci." : ("Erreur. (" + e.message + ")"));
  }
}

// -----------------------------------------------------------------------
// Coffre-fort : une carte promo arc-en-ciel vitrine, visible mais enfermee
// tant qu'on n'a pas 6 clefs secretes (memes clefs que la fouille/la roue
// quotidienne) - deverrouillage DEFINITIF, une seule fois par joueur (voir
// vault.json - pas de colonne d'etat dediee, juste une ligne Pulls au
// BatchId prefixe 'vault-').
async function loadVault() {
  try {
    const res = await API.getVaultStatus(Session.userId);
    if (!res.card) {
      document.getElementById("vault-locked").innerHTML = `<div class="empty-state">Le coffre-fort n'est pas encore configuré.</div>`;
      return;
    }
    document.getElementById("vault-card-img").src = API.imageUrl(res.card.imageId) || PLACEHOLDER_IMG;
    document.getElementById("vault-card-img").alt = res.card.name;
    const vaultNameEl = document.getElementById("vault-card-name");
    vaultNameEl.classList.remove("skeleton-line");
    vaultNameEl.textContent = res.card.name;
    const pct = Math.min(100, Math.round((res.userKeys / res.keysRequired) * 100));
    document.getElementById("vault-keys-fill").style.width = pct + "%";
    document.getElementById("vault-keys-label").innerHTML = `&#128273; ${res.userKeys} / ${res.keysRequired} clefs`;
    const openBtn = document.getElementById("vault-open-btn");
    const lockedZone = document.getElementById("vault-locked");
    const openedZone = document.getElementById("vault-opened");
    if (res.alreadyOpened) {
      lockedZone.style.display = "none";
      openedZone.style.display = "flex";
      document.getElementById("vault-opened-img").src = API.imageUrl(res.card.imageId) || PLACEHOLDER_IMG;
      document.getElementById("vault-opened-img").alt = res.card.name;
      document.getElementById("vault-opened-name").textContent = res.card.name;
    } else {
      lockedZone.style.display = "block";
      openedZone.style.display = "none";
      openBtn.style.display = res.userKeys >= res.keysRequired ? "inline-flex" : "none";
    }
  } catch (e) {
    Toast.error("Impossible de charger le coffre-fort.");
  }
}

async function openVault() {
  const ok = await Confirm.show(
    `Ouvrir le coffre-fort consomme <strong>6 clefs secrètes</strong> et débloque définitivement la carte arc-en-ciel qu'il contient. Continuer ?`,
    { title: "Ouvrir le coffre-fort ?", confirmText: "Ouvrir" }
  );
  if (!ok) return;
  try {
    const res = await API.openVault(Session.userId);
    Toast.success(`Coffre-fort ouvert : ${res.card.name} !`);
    if (typeof confetti === "function") confetti({ particleCount: 250, spread: 140, origin: { y: 0.5 } });
    const frame = document.querySelector("#vault-locked .vault-card-frame");
    if (frame) frame.classList.add("vault-unlocking");
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    setTimeout(() => loadVault(), 1000);
  } catch (e) {
    Toast.error(e.code === "not_enough_keys" ? "Pas assez de clefs." : e.code === "already_opened" ? "Déjà ouvert." : ("Erreur. (" + e.message + ")"));
  }
}

// -----------------------------------------------------------------------
// Devine la carte (guess-card.json) : un zoom quotidien sur l'illustration
// d'une carte, 4 propositions, un seul essai. La reponse n'arrive du
// serveur qu'une fois le jeu du jour joue.
// -----------------------------------------------------------------------
let guessBusy = false;

function renderGuess(data) {
  const img = document.getElementById("guess-img");
  img.src = API.imageUrl(data.imageId) || "";
  const frame = document.getElementById("guess-frame");
  const z = data.zoom || { scale: 3, x: 50, y: 50 };
  // Une fois joue, on dezoome pour devoiler l'illustration entiere.
  img.style.transformOrigin = `${z.x}% ${z.y}%`;
  img.style.transform = data.played ? "scale(1)" : `scale(${z.scale})`;
  frame.classList.toggle("revealed", !!data.played);

  const next = data.boosterEvery - ((data.streak || 0) % data.boosterEvery);
  document.getElementById("guess-streak").innerHTML = `<span>&#128293; Série : <strong>${data.streak || 0}</strong> jour${(data.streak || 0) > 1 ? "s" : ""}</span>` +
    `<span class="guess-streak-next">Booster bonus dans ${next} bonne${next > 1 ? "s" : ""} réponse${next > 1 ? "s" : ""} d'affilée</span>`;

  const box = document.getElementById("guess-choices");
  box.innerHTML = data.choices.map((c) => {
    let cls = "";
    if (data.played) {
      if (c.cardId === data.answerCardId) cls = "right";
      else if (c.cardId === data.myChoice) cls = "wrong";
    }
    return `<button type="button" class="guess-choice ${cls}" data-card-id="${c.cardId}" ${data.played ? "disabled" : ""}>${c.name}</button>`;
  }).join("");

  const res = document.getElementById("guess-result");
  if (data.played) {
    res.style.display = "block";
    res.className = `guess-result ${data.correct ? "win" : "lose"}`;
    const rw = data.reward;
    res.innerHTML = data.correct
      ? `&#127881; Bravo, c'était <strong>${data.answerName}</strong> !${rw ? ` +${rw.dust} poussières${rw.boosters ? ` et +${rw.boosters} booster` : ""}.` : ""}`
      : `C'était <strong>${data.answerName}</strong>.${rw ? ` +${rw.dust} poussières de consolation.` : ""}`;
    res.innerHTML += `<div class="guess-next">Nouvelle carte demain !</div>`;
  } else {
    res.style.display = "none";
  }
}

async function loadGuess() {
  try {
    renderGuess(await API.guessCard(Session.userId, "status"));
  } catch (e) {
    document.getElementById("guess-choices").innerHTML = `<div class="empty-state">Jeu indisponible pour le moment.</div>`;
  }
}

async function submitGuess(cardId) {
  if (guessBusy) return;
  guessBusy = true;
  try {
    const res = await API.guessCard(Session.userId, "guess", cardId);
    renderGuess({ ...res, myChoice: cardId });
    if (typeof loadNavBadges === "function") loadNavBadges();
    if (res.correct) Toast.success(`Bonne réponse ! +${res.reward.dust} poussières${res.reward.boosters ? " et +1 booster" : ""}.`);
    else Toast.info(`Raté, c'était ${res.answerName}.`);
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error(e.code === "already_played" ? "Tu as déjà joué aujourd'hui." : ("Erreur. (" + e.message + ")"));
    loadGuess();
  } finally {
    guessBusy = false;
  }
}

// -----------------------------------------------------------------------
// Expedition (expedition.json) : une carte part 2h / 8h / 24h, butin tire
// au retour. Une seule expedition a la fois.
// -----------------------------------------------------------------------
let expeditionTimer = null;
let expeditionBusy = false;
let expeditionOwned = null;
const EXPEDITION_RARITY_ORDER = ["mythique", "legendaire", "epique", "rare", "commune"];

function formatLongDuration(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  if (h) return `${h} h ${String(m).padStart(2, "0")}`;
  if (m) return `${m} min ${String(s).padStart(2, "0")}`;
  return `${s} s`;
}

async function expeditionOwnedCards() {
  if (expeditionOwned) return expeditionOwned;
  const col = await API.getCollection(Session.userId);
  const ownedIds = new Set((col.owned || []).filter((o) => o.count > 0).map((o) => o.cardId));
  expeditionOwned = (col.cards || []).filter((c) => ownedIds.has(c.cardId)).sort((a, b) =>
    EXPEDITION_RARITY_ORDER.indexOf(a.rarity?.key) - EXPEDITION_RARITY_ORDER.indexOf(b.rarity?.key) || a.name.localeCompare(b.name));
  return expeditionOwned;
}

async function renderExpedition(data) {
  clearInterval(expeditionTimer);
  const zone = document.getElementById("expedition-zone");
  const ex = data.expedition || { active: false };
  if (ex.active) {
    const card = ex.explorer;
    const color = card?.rarity?.colorHex || "#9aa0b4";
    const endAt = Date.now() + (ex.secondsLeft || 0) * 1000;
    zone.innerHTML = `
      <div class="expe-active ${ex.ready ? "ready" : ""}">
        <div class="expe-explorer" style="--expe-color:${color}">
          <img src="${API.imageUrl(card?.imageId) || ""}" alt="${card?.name || ""}" />
        </div>
        <div class="expe-info">
          <div class="expe-title">${card?.name || "Ton explorateur"} est en route</div>
          <div class="expe-sub">${ex.hours} h d'expédition</div>
          <div class="expe-progress"><div class="expe-progress-fill" id="expe-fill"></div></div>
          <div class="expe-countdown" id="expe-countdown"></div>
          <button type="button" class="btn" id="expe-claim-btn" ${ex.ready ? "" : "disabled"}>&#127873; Récupérer le butin</button>
        </div>
      </div>`;
    const total = ex.hours * 3600;
    const tick = () => {
      const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      const fill = document.getElementById("expe-fill");
      if (!fill) { clearInterval(expeditionTimer); return; }
      fill.style.width = `${Math.min(100, 100 * (1 - left / total))}%`;
      document.getElementById("expe-countdown").textContent = left > 0 ? `Retour dans ${formatLongDuration(left)}` : "De retour ! Le butin t'attend.";
      if (left <= 0) {
        document.getElementById("expe-claim-btn").disabled = false;
        zone.querySelector(".expe-active").classList.add("ready");
        clearInterval(expeditionTimer);
      }
    };
    tick();
    expeditionTimer = setInterval(tick, 1000);
    document.getElementById("expe-claim-btn").addEventListener("click", claimExpedition);
    return;
  }

  let cards = [];
  try { cards = await expeditionOwnedCards(); } catch (e) {}
  if (!cards.length) {
    zone.innerHTML = `<div class="empty-state">Il te faut au moins une carte pour partir en expédition.</div>`;
    return;
  }
  const bonus = data.rarityBonus || {};
  zone.innerHTML = `
    <div class="expe-setup">
      <label class="expe-label" for="expe-card">Explorateur</label>
      <div class="expe-pick">
        <img id="expe-preview" class="expe-preview" src="" alt="" />
        <div class="expe-pick-side">
          <select id="expe-card">${cards.map((c) => `<option value="${c.cardId}">${c.name} — ${c.rarity?.name || "Commune"}</option>`).join("")}</select>
          <div class="expe-bonus" id="expe-bonus"></div>
        </div>
      </div>
      <div class="expe-label">Durée</div>
      <div class="expe-durations">
        ${data.durations.map((d) => `
          <button type="button" class="expe-duration" data-hours="${d.hours}">
            <span class="expe-duration-h">${d.hours} h</span>
            <span class="expe-duration-name">${d.label}</span>
            <span class="expe-duration-loot">${d.dust[0]}–${d.dust[1]} poussières</span>
            <span class="expe-duration-loot">${d.guaranteed ? `1 booster garanti + ${Math.round(d.boosterChance * 100)}% d'en avoir un 2e` : `${Math.round(d.boosterChance * 100)}% de chance de booster`}</span>
          </button>`).join("")}
      </div>
    </div>`;
  const select = document.getElementById("expe-card");
  const updatePreview = () => {
    const c = cards.find((x) => x.cardId === Number(select.value));
    document.getElementById("expe-preview").src = API.imageUrl(c?.imageId) || "";
    const b = bonus[c?.rarity?.key] || 1;
    document.getElementById("expe-bonus").textContent = b > 1 ? `Bonus de rareté : +${Math.round((b - 1) * 100)}% de poussières` : "Pas de bonus de rareté";
  };
  select.addEventListener("change", updatePreview);
  updatePreview();
  zone.querySelectorAll(".expe-duration").forEach((btn) => btn.addEventListener("click", () => startExpedition(Number(btn.dataset.hours), Number(select.value))));
}

async function loadExpedition() {
  try {
    await renderExpedition(await API.expedition(Session.userId, "status"));
  } catch (e) {
    document.getElementById("expedition-zone").innerHTML = `<div class="empty-state">Expéditions indisponibles pour le moment.</div>`;
  }
}

async function startExpedition(hours, cardId) {
  if (expeditionBusy) return;
  expeditionBusy = true;
  try {
    const res = await API.expedition(Session.userId, "start", { hours, cardId });
    Toast.success(`C'est parti pour ${hours} h d'expédition !`);
    await renderExpedition(res);
  } catch (e) {
    Toast.error({ already_running: "Une expédition est déjà en cours.", card_not_owned: "Tu ne possèdes plus cette carte." }[e.code] || ("Erreur. (" + e.message + ")"));
    loadExpedition();
  } finally {
    expeditionBusy = false;
  }
}

async function claimExpedition() {
  if (expeditionBusy) return;
  expeditionBusy = true;
  try {
    const res = await API.expedition(Session.userId, "claim");
    const r = res.reward;
    if (typeof loadNavBadges === "function") loadNavBadges();
    await renderExpedition(res);
    const zone = document.getElementById("expedition-zone");
    zone.insertAdjacentHTML("afterbegin", `
      <div class="expe-report">
        <div class="expe-report-title">&#129517; ${r.explorer?.name || "Ton explorateur"} ${r.story} !</div>
        <div class="expe-report-loot">+${r.dust} poussières${r.boosters ? ` · +${r.boosters} booster${r.boosters > 1 ? "s" : ""}` : ""}${r.bonus > 1 ? ` <span class="expe-report-bonus">(bonus rareté +${Math.round((r.bonus - 1) * 100)}%)</span>` : ""}</div>
      </div>`);
    Toast.success(`Butin : +${r.dust} poussières${r.boosters ? ` et +${r.boosters} booster${r.boosters > 1 ? "s" : ""}` : ""} !`);
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error(e.code === "not_ready" ? "L'expédition n'est pas encore rentrée." : ("Erreur. (" + e.message + ")"));
    loadExpedition();
  } finally {
    expeditionBusy = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("tab-dig-btn").addEventListener("click", () => setActiveTab("dig"));
  document.getElementById("tab-guess-btn").addEventListener("click", () => setActiveTab("guess"));
  document.getElementById("tab-expedition-btn").addEventListener("click", () => setActiveTab("expedition"));
  document.getElementById("tab-fish-btn").addEventListener("click", () => setActiveTab("fish"));
  document.getElementById("fish-cast-btn").addEventListener("click", () => castFishing(1));
  document.getElementById("fish-cast5-btn").addEventListener("click", () => castFishing(5));
  document.getElementById("tab-bingo-btn").addEventListener("click", () => setActiveTab("bingo"));
  document.getElementById("tab-vault-btn").addEventListener("click", () => setActiveTab("vault"));
  document.getElementById("bingo-claim-btn").addEventListener("click", claimBingo);
  document.getElementById("guess-choices").addEventListener("click", (e) => {
    const btn = e.target.closest(".guess-choice");
    if (btn && !btn.disabled) submitGuess(Number(btn.dataset.cardId));
  });
  document.getElementById("vault-open-btn").addEventListener("click", openVault);
  document.getElementById("dig-buy-bone-btn").addEventListener("click", (e) => kennelAction("buy", e.currentTarget));
  document.getElementById("dig-use-bone-btn").addEventListener("click", (e) => kennelAction("use", e.currentTarget));
  // Onglet Coffre-fort cache tant que le joueur n'a jamais eu de clef : les
  // clefs et leurs usages se decouvrent en explorant, pas dans un menu.
  const initial = getInitialTab();
  setActiveTab(initial === "vault" ? "dig" : initial);
  API.getVaultStatus(Session.userId).then((res) => {
    if ((res.userKeys || 0) > 0 || res.alreadyOpened) {
      document.getElementById("tab-vault-btn").style.display = "";
      if (initial === "vault") setActiveTab("vault");
    }
  }).catch(() => {});
});
