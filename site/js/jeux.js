// Logique de la page Jeux : fouille, devine la carte, expedition, bingo de
// collection et coffre-fort.


// Memorise le dernier onglet visite (QoL 2026-09-30) : revenir sur "Jeux"
// rouvrait toujours "Fouille" par defaut, meme si on passait le plus clair
// de son temps sur "Coffre-fort".
const LAST_TAB_KEY = "2gatcha_last_tab_jeux";
// Ancre d'URL de chaque onglet (2026-10-05) : jeux.html#peche, #jardin...
const TAB_HASH = { dig: "fouille", guess: "devine", expedition: "expedition", fish: "peche", garden: "jardin", bingo: "bingo", vault: "coffre-fort" };
const HASH_TAB = Object.fromEntries(Object.entries(TAB_HASH).map(([k, v]) => [v, k]));
function getInitialTab() {
  const fromHash = HASH_TAB[location.hash.slice(1)];
  if (fromHash) return fromHash;
  try { return localStorage.getItem(LAST_TAB_KEY) || "dig"; } catch (e) { return "dig"; }
}

function setActiveTab(tab) {
  ["dig", "guess", "expedition", "fish", "garden", "bingo", "vault"].forEach((key) => {
    document.getElementById(`tab-${key}-btn`).classList.toggle("active", tab === key);
    document.getElementById(`tab-${key}-btn`).setAttribute("aria-selected", String(tab === key));
    document.getElementById(`${key}-pane`).style.display = tab === key ? "block" : "none";
  });
  try { localStorage.setItem(LAST_TAB_KEY, tab); } catch (e) {}
  if (TAB_HASH[tab] && location.hash !== "#" + TAB_HASH[tab]) history.replaceState(null, "", "#" + TAB_HASH[tab]);
  if (tab === "garden") loadGarden();
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
// Outil affiche selon le niveau (purement visuel).
const DIG_TOOLS = [
  { min: 1, key: "bois", name: "Pelle en bois", icon: "&#129706;" },
  { min: 4, key: "fer", name: "Pelle en fer", icon: "&#9935;&#65039;" },
  { min: 7, key: "or", name: "Pelle dorée", icon: "&#9935;&#65039;" },
  { min: 10, key: "legende", name: "Pelle de légende", icon: "&#10024;" }
];
const FISH_RODS = [
  { min: 1, key: "bambou", name: "Canne en bambou" },
  { min: 4, key: "carbone", name: "Canne en carbone" },
  { min: 7, key: "or", name: "Canne dorée" },
  { min: 10, key: "legende", name: "Canne de légende" }
];
const toolFor = (list, level) => [...list].reverse().find((t) => level >= t.min) || list[0];
let digLevelCache = 1;

function digPerkTexts(p = {}) {
  return [
    p.energyBonus ? `+${p.energyBonus} énergie max` : "",
    p.regenReduction ? `recharge ${Math.round(p.regenReduction * 100)} % plus rapide` : "",
    p.dustBonus ? `+${Math.round(p.dustBonus * 100)} % de poussières trouvées` : "",
    p.dogSpeed ? `chien ${Math.round(p.dogSpeed * 100)} % plus rapide, plus de flair` : ""
  ];
}
function fishPerkTexts(p = {}) {
  return [
    p.extraCasts ? `+${p.extraCasts} lancers par jour` : "",
    p.emptyReduction ? `${Math.round(p.emptyReduction * 100)} % de prises vides en moins` : "",
    p.rareBoost ? `+${Math.round(p.rareBoost * 100)} % de chances de prises rares` : ""
  ];
}

function renderSkillLevel(id, icon, name, info, perks, tool) {
  const el = document.getElementById(id);
  if (!el || !info) return;
  el.hidden = false;
  const pct = info.next == null ? 100 : Math.min(100, ((info.xp - info.current) / (info.next - info.current)) * 100);
  el.innerHTML = `
    <div class="skill-level-head">
      <span class="skill-level-badge">${icon} ${name} <strong>niv. ${info.level}</strong>${info.level >= info.max ? " (max)" : ""}${info.prestige ? ` <span class="skill-stars" title="Prestige ${info.prestige}">${"★".repeat(Math.min(info.prestige, 5))}${info.prestige > 5 ? "×" + info.prestige : ""}</span>` : ""}${tool ? ` <span class="skill-tool tool-${tool.key}">${tool.name}</span>` : ""}</span>
      <span class="skill-level-xp">${info.next == null ? `${info.xp} XP` : `${info.xp - info.current} / ${info.next - info.current} XP`}</span>
    </div>
    <div class="skill-level-bar" role="progressbar" aria-label="Progression ${name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="skill-level-fill" style="width:${pct}%"></div></div>
    <div class="skill-level-perks">${perks.filter(Boolean).map((p) => `<span>${p}</span>`).join("") || "<span>Joue pour monter de niveau : chaque niveau donne un bonus.</span>"}</div>
    ${info.level >= info.max ? `<button type="button" class="btn-secondary skill-prestige" data-prestige="${SKILL_OF_LEVEL_ID[id] || "fishing"}">&#11088; Passer en prestige (repartir niv. 1, bonus permanent)</button>` : ""}`;
}
const SKILL_OF_LEVEL_ID = { "dig-level": "dig", "fish-level": "fishing", "expe-level": "expedition", "garden-level": "garden" };
// Metiers d'expedition et de jardin (2026-10-07, api/src/native/levels.js).
const SKILL_INFO = {
  dig: { name: "Fouille", the: "la fouille", bonus: "+5 % de poussières trouvées", icon: "&#9935;&#65039;" },
  fishing: { name: "Pêche", the: "la pêche", bonus: "+3 % de prises rares", icon: "&#127907;" },
  expedition: { name: "Expédition", the: "l'expédition", bonus: "+5 % de poussières rapportées", icon: "&#129517;" },
  garden: { name: "Jardin", the: "le jardin", bonus: "+3 % de vitesse de pousse", icon: "&#127793;" }
};
const expePerkTexts = (p) => [p && p.dustBonus ? `+${Math.round(p.dustBonus * 100)} % de poussières rapportées` : "", p && p.timeReduction ? `expéditions ${Math.round(p.timeReduction * 100)} % plus courtes` : ""];
const gardenPerkTexts = (p) => [p && p.growReduction ? `pousse ${Math.round(p.growReduction * 100)} % plus vite` : "", p && p.baitBonus ? `+${Math.round(p.baitBonus * 100)} pts de chance d'appât doré` : ""];

// Prestige (api/src/native/levels.js) : niveau 10 -> niveau 1 + une etoile.
async function doPrestige(skill) {
  const info = SKILL_INFO[skill] || SKILL_INFO.fishing;
  const name = info.the;
  const bonus = info.bonus;
  if (!(await Confirm.show(`Repartir du niveau 1 en ${name} contre une étoile de prestige permanente (${bonus} par étoile) ? Les bonus de niveau sont à regagner.`, { title: "Prestige", confirmText: "Passer en prestige" }))) return;
  try {
    const res = await API.prestige(Session.userId, skill);
    LevelUpModal.show({ icon: "&#11088;", name: info.name, level: `Prestige ${res.prestige}`, perks: [bonus + " (permanent)", "Retour au niveau 1 : tous les bonus de niveau sont à regagner"] });
    if (skill === "dig") loadDig(); else if (skill === "expedition") loadExpeditionLevel(); else if (skill === "garden") loadGarden(); else loadFishing();
  } catch (e) { Toast.error(e.code === "not_max_level" ? "Il faut être niveau 10." : "Erreur. (" + e.message + ")"); }
}

// Prix des relances payantes (api/src/native/rules.js).
let economyRules = null;
async function loadEconomyRules(force) {
  if (!economyRules || force) { try { economyRules = await API.getEconomyRules(Session.userId); } catch (e) { economyRules = null; } }
  return economyRules;
}

async function rerollWeather() {
  const r = await loadEconomyRules();
  if (!r) return;
  if (!(await Confirm.show(`Changer la météo de ta pêche pour aujourd'hui contre ${r.weatherRerollCost} poussières ? (une fois par jour)`, { title: "Changer la météo", confirmText: "Changer" }))) return;
  try {
    await API.reroll(Session.userId, "weather", fishState && fishState.weather && fishState.weather.key);
    await loadEconomyRules(true);
    Toast.success("&#127780;&#65039; La météo a changé !");
    loadFishing();
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) { Toast.error({ already_rerolled: "Déjà fait aujourd'hui.", not_enough_dust: "Pas assez de poussières." }[e.code] || "Erreur. (" + e.message + ")"); }
}

async function renderFishExtras(st) {
  const box = document.getElementById("fish-extras");
  if (!box) return;
  const r = await loadEconomyRules();
  const parts = [];
  if (st.event) parts.push(`<span class="fish-chip fish-chip-event">&#127881; ${st.event.label}${st.event.fishingRare > 1 ? ` : prises rares ×${st.event.fishingRare}` : ""}${st.event.wormsMultiplier > 1 ? ` · vers ×${st.event.wormsMultiplier}` : ""}</span>`);
  if (st.tourney && st.tourney.active) parts.push(`<a class="fish-chip fish-chip-tourney" href="communaute.html#metiers">&#127942; Tournoi du week-end : ${st.tourney.score} pts · ${Math.max(0, st.tourney.max - st.tourney.casts)} lancer${st.tourney.max - st.tourney.casts > 1 ? "s" : ""} comptant encore</a>`);
  if (st.goldBait > 0) parts.push(`<label class="fish-chip fish-bait"><input type="checkbox" id="fish-bait" /> &#10024;&#129713; Appât doré (${st.goldBait})</label>`);
  if (r) parts.push(`<button type="button" class="fish-chip fish-reroll" id="fish-reroll-btn" ${r.weatherRerolledToday ? "disabled" : ""}>&#127780;&#65039; ${r.weatherRerolledToday ? "Météo déjà changée aujourd'hui" : `Changer la météo (${r.weatherRerollCost} ✨)`}</button>`);
  if (st.fullRewardsLeft != null) parts.push(`<span class="fish-chip ${st.fullRewardsLeft ? "" : "fish-chip-warn"}">${st.fullRewardsLeft ? `Plein rendement : encore ${st.fullRewardsLeft} lancer${st.fullRewardsLeft > 1 ? "s" : ""}` : "Rendement réduit pour aujourd'hui"}</span>`);
  const keepBait = document.getElementById("fish-bait")?.checked;
  box.innerHTML = parts.join("");
  if (keepBait && document.getElementById("fish-bait")) document.getElementById("fish-bait").checked = true;
}

// -----------------------------------------------------------------------
// Jardin (api/src/native/garden.js) : 4 parcelles, vers et appats dores.
// -----------------------------------------------------------------------
let gardenTimer = null;
let gardenSeed = "mix";
let gardenState = null;
const SEED_ICONS = { mix: "&#127793;", worm: "&#129713;", bait: "&#127804;", dust: "&#127776;" };
function renderGardenSeeds(st) {
  const el = document.getElementById("garden-seeds");
  if (!el || !st.seeds) return;
  el.innerHTML = st.seeds.map((s) => `
    <button type="button" role="radio" aria-checked="${gardenSeed === s.key}" class="garden-seed ${gardenSeed === s.key ? "active" : ""}" data-seed="${s.key}">
      <span class="garden-seed-icon" aria-hidden="true">${SEED_ICONS[s.key] || s.icon}</span>
      <span class="garden-seed-body"><strong>${s.label}</strong><small>${s.desc}</small><small>${s.cost} &#10024; · ${s.growHours} h</small></span>
    </button>`).join("");
  el.querySelectorAll(".garden-seed").forEach((b) => b.addEventListener("click", () => { gardenSeed = b.dataset.seed; renderGarden(gardenState); }));
}
function renderGarden(st) {
  gardenState = st;
  renderGardenSeeds(st);
  const seedCost = (st.seeds || []).find((s) => s.key === gardenSeed)?.cost ?? st.plantCost;
  document.getElementById("garden-meta").innerHTML = `&#129713; <strong>${st.worms}</strong> vers · &#10024;&#129713; <strong>${st.goldBait}</strong> appât${st.goldBait > 1 ? "s" : ""} doré${st.goldBait > 1 ? "s" : ""} · une plantation coûte ${st.plantCost} &#10024; et pousse ${st.growHours} h · ${Math.round(st.baitChance * 100)} % de chances d'appât par récolte`;
  const t = Date.now() / 1000;
  document.getElementById("garden-plots").innerHTML = st.plots.map((p) => {
    if (!p.planted) return `<div class="garden-plot empty"><span class="garden-soil" aria-hidden="true"></span><span class="garden-label">Parcelle libre</span></div>`;
    const pct = Math.min(100, Math.round(((t - p.plantedAt) / (p.readyAt - p.plantedAt)) * 100));
    const stage = pct >= 100 ? "&#127803;" : pct >= 60 ? "&#127807;" : pct >= 25 ? "&#127793;" : "&#127792;";
    const left = Math.max(0, Math.round(p.readyAt - t));
    return `<div class="garden-plot ${pct >= 100 ? "ready" : ""}">${p.seed && p.seed !== "mix" ? `<span class="garden-seed-tag" title="${(st.seeds || []).find((s) => s.key === p.seed)?.label || ""}">${SEED_ICONS[p.seed] || ""}</span>` : ""}<span class="garden-plant" aria-hidden="true">${stage}</span>
      <div class="challenge-bar"><div style="width:${pct}%"></div></div>
      <span class="garden-label">${pct >= 100 ? "Prête à récolter !" : `Encore ${left >= 3600 ? Math.floor(left / 3600) + " h " : ""}${Math.ceil((left % 3600) / 60)} min`}</span></div>`;
  }).join("");
  document.getElementById("garden-plant-btn").disabled = !st.plots.some((p) => !p.planted) || st.stardust < seedCost;
  const buy = document.getElementById("garden-buyplot-btn");
  if (buy && st.extraPlot) {
    buy.hidden = st.extraPlot.price == null;
    buy.innerHTML = `&#10133; Parcelle (${st.extraPlot.owned}/${st.extraPlot.max}) · ${st.extraPlot.price} &#10024;`;
    buy.disabled = st.stardust < st.extraPlot.price;
  }
  if (st.level) renderSkillLevel("garden-level", "&#127793;", "Jardin", st.level, gardenPerkTexts(st.level.perks));
  document.getElementById("garden-harvest-btn").disabled = !st.readyCount;
  document.getElementById("garden-harvest-btn").innerHTML = `&#129530; Tout récolter${st.readyCount ? ` (${st.readyCount})` : ""}`;
  clearInterval(gardenTimer);
  if (st.plots.some((p) => p.planted && !p.ready)) gardenTimer = setInterval(() => renderGarden(st), 30000);
}

async function loadGarden() {
  try { renderGarden(await API.garden(Session.userId)); }
  catch (e) { document.getElementById("garden-meta").textContent = "Impossible de charger le jardin."; }
}

async function gardenAction(action) {
  try {
    if (action === "buyPlot" && !(await Confirm.show(`Acheter une parcelle de plus pour ${gardenState.extraPlot.price} poussières ?`, { title: "Agrandir le jardin", confirmText: "Acheter" }))) return;
    const res = await API.garden(Session.userId, action, action === "plant" ? { seed: gardenSeed } : {});
    renderGarden(res);
    if (action === "buyPlot") Toast.success("&#10133; Nouvelle parcelle !");
    else if (action === "plant") Toast.success(`&#127793; ${res.planted} parcelle${res.planted > 1 ? "s" : ""} plantée${res.planted > 1 ? "s" : ""} !`);
    else {
      const g = res.gained;
      Toast.success(`&#129530; Récolte : +${g.worms} vers${g.bait ? `, +${g.bait} appât${g.bait > 1 ? "s" : ""} doré${g.bait > 1 ? "s" : ""}` : ""}${g.dust ? `, +${g.dust} &#10024;` : ""} !`);
      if (g.bait && typeof confetti === "function") confetti({ particleCount: 80, spread: 80, origin: { y: 0.6 } });
      if (res.levelUp) LevelUpModal.show({ icon: "&#127793;", name: "Jardin", level: res.levelUp, perks: gardenPerkTexts(res.level && res.level.perks) });
    }
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error({ not_enough_dust: "Pas assez de poussières.", nothing_ready: "Rien n'est prêt.", no_free_plot: "Toutes les parcelles sont occupées.", max_plots: "Ton jardin est déjà au maximum." }[e.code] || "Erreur. (" + e.message + ")");
  }
}

function announceLevelUp(icon, name, level, info) {
  const isDig = name === "Fouille";
  const list = isDig ? DIG_TOOLS : FISH_RODS;
  const tool = toolFor(list, level);
  const newTool = toolFor(list, level - 1).key !== tool.key ? tool.name : "";
  LevelUpModal.show({ icon, name, level, tool: newTool, perks: (isDig ? digPerkTexts : fishPerkTexts)(info && info.perks) });
}

function renderDigLevel(info) {
  if (!info) return;
  digLevelCache = info.level;
  const tool = toolFor(DIG_TOOLS, info.level);
  renderSkillLevel("dig-level", tool.icon, "Fouille", info, digPerkTexts(info.perks), tool);
  document.getElementById("dig-pane").dataset.shovel = tool.key;
  // Collier du chien : couleur selon le niveau, cape au niveau max.
  const dog = document.getElementById("dig-kennel-dog-wrap");
  if (dog) dog.dataset.tier = info.level >= 10 ? "cape" : info.level >= 7 ? "or" : info.level >= 4 ? "bleu" : "rouge";
}

function renderFishLevel(info) {
  if (!info) return;
  const rod = toolFor(FISH_RODS, info.level);
  renderSkillLevel("fish-level", "&#127907;", "Pêche", info, fishPerkTexts(info.perks), rod);
  document.getElementById("fish-rod").dataset.rod = rod.key;
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
    if (r.worms) parts.push(`+${r.worms} vers de terre &#129713;`);
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
  overlay.setAttribute("aria-label", "Rapport du chien");
  overlay.innerHTML = `
    <div class="dog-postcard">
      <div class="dog-postcard-stamp" aria-hidden="true">&#128062;</div>
      <div class="dog-postcard-pic" aria-hidden="true">&#128021;&#9935;&#65039;</div>
      <div class="dog-postcard-text">
        <div class="dog-postcard-title">Bons baisers du chantier !</div>
        <p>Pendant ton absence, j'ai creusé <strong>${r.tiles} tuile${r.tiles > 1 ? "s" : ""}</strong>.</p>
        ${parts.length ? `<ul>${parts.map((p) => `<li>${p}</li>`).join("")}</ul>` : "<p>Rien trouvé cette fois… mais j'ai bien remué la terre !</p>"}
        <div class="dog-postcard-sign">Ton chien, Wouf &#128062;</div>
      </div>
      <button type="button" class="btn dog-postcard-close">Merci !</button>
    </div>`;
  const close = () => { overlay.remove(); syncScrollLock(); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest(".dog-postcard-close")) close(); });
  document.body.appendChild(overlay);
  syncScrollLock();
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
    if (res.levelUp) announceLevelUp(toolFor(DIG_TOOLS, res.levelUp).icon, "Fouille", res.levelUp, res.digLevel);

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

    if (res.reducedRewards) resultEl.insertAdjacentHTML("beforeend", `<div class="dig-reduced">Rendement réduit : plus de poussières à plein tarif aujourd'hui (reviens demain).</div>`);
    if (res.wormsFound) {
      resultEl.insertAdjacentHTML("beforeend", `<div class="dig-worms">&#129713; +${res.wormsFound} vers de terre dans la terre qui restait${res.leftoverTiles ? ` (${res.leftoverTiles} case${res.leftoverTiles > 1 ? "s" : ""} jamais creusée${res.leftoverTiles > 1 ? "s" : ""})` : ""} : de quoi pêcher !</div>`);
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
const FISH_ICONS = { nothing: "&#129406;", dust: "&#10024;", bone: "&#129460;", key: "&#128273;", booster: "&#127873;", chest: "&#129520;", part: "&#128297;", pearl: "&#129450;", bait: "&#127804;" };
let fishState = null;
// Zone de peche (2026-10-09) : rivage ou eaux profondes (niveau 10).
let fishZone = (() => { try { return localStorage.getItem("2gatcha_fish_zone") === "deep" ? "deep" : "shore"; } catch (e) { return "shore"; } })();
function setFishZone(z) {
  fishZone = z;
  try { localStorage.setItem("2gatcha_fish_zone", z); } catch (e) { /* stockage indisponible */ }
  if (fishState) renderFishing(fishState);
}
function renderFishZones(st) {
  const el = document.getElementById("fish-zones");
  if (!el) return;
  const deep = st.deep;
  if (!deep) { el.hidden = true; return; }
  if (!deep.unlocked && fishZone === "deep") fishZone = "shore";
  el.hidden = false;
  el.innerHTML = `
    <button type="button" role="radio" aria-checked="${fishZone === "shore"}" class="fish-zone ${fishZone === "shore" ? "active" : ""}" data-zone="shore">&#127958;&#65039; Rivage <small>${st.cost} &#129713;</small></button>
    <button type="button" role="radio" aria-checked="${fishZone === "deep"}" class="fish-zone fish-zone-deep ${fishZone === "deep" ? "active" : ""}" data-zone="deep" ${deep.unlocked ? "" : "disabled"} title="${deep.unlocked ? "Perles noires, appâts dorés et prises plus rares" : `Débloquées au niveau ${deep.level} de pêche`}">&#127754; Eaux profondes <small>${deep.unlocked ? `${deep.cost} &#129713;` : `&#128274; niveau ${deep.level}`}</small></button>`;
  el.querySelectorAll(".fish-zone:not([disabled])").forEach((b) => b.addEventListener("click", () => setFishZone(b.dataset.zone)));
}
let fishBusy = false;
const fishWait = (ms) => new Promise((r) => setTimeout(r, ms));

function fishCatchText(c) {
  if (c.type === "nothing") return c.label;
  if (c.type === "dust") return `+${c.amount} poussières`;
  if (c.type === "pearl") return `${c.label} (+${c.amount} poussières)`;
  return `${c.amount > 1 ? c.amount + " × " : ""}${c.label}`;
}

function renderFishBook(records) {
  const el = document.getElementById("fish-book");
  if (!el || !records) return;
  const fmt = (t) => (t ? new Date(t * 1000).toLocaleDateString("fr-FR") : "—");
  el.innerHTML = `<div class="fish-book-grid">${records.map((r) => `
    <div class="fish-book-entry tier-${r.tier} ${r.count ? "" : "unseen"}">
      <span class="fish-book-icon" aria-hidden="true">${r.count ? FISH_ICONS[r.type] || "" : "&#10067;"}</span>
      <span class="fish-book-name">${r.count ? r.label : "???"}</span>
      <span class="fish-book-meta">${r.count ? `${r.count} prise${r.count > 1 ? "s" : ""} · 1re le ${fmt(r.first)}${r.type === "dust" && r.best ? ` · record ${r.best} &#10024;` : ""}` : "Jamais pêché"}</span>
    </div>`).join("")}</div>`;
}

function renderFishWeather(w) {
  if (!w) return;
  const scene = document.getElementById("fish-scene");
  scene.dataset.weather = w.key;
  document.getElementById("fish-weather").innerHTML = `<span>${w.icon} ${w.label}</span> <small>${w.effect}</small>`;
}

function renderFishing(st) {
  fishState = st;
  renderFishZones(st);
  const deepOn = fishZone === "deep" && st.deep && st.deep.unlocked;
  document.getElementById("fish-scene").dataset.zone = deepOn ? "deep" : "shore";
  if (deepOn) st = { ...st, cost: st.deep.cost, table: st.deep.table };
  renderFishExtras(st);
  renderFishLevel(st.level);
  renderFishWeather(st.weather);
  renderFishBook(st.records);
  const left = st.castsLeft == null ? "illimités" : `${st.castsLeft} restant${st.castsLeft > 1 ? "s" : ""} aujourd'hui`;
  const worms = st.worms ?? 0;
  document.getElementById("fish-meta").innerHTML = `${st.cost} &#129713; le lancer · ${left} · tu as <strong>${worms} ver${worms > 1 ? "s" : ""} de terre</strong>${worms < st.cost ? " · termine une grille de fouille pour en trouver" : ""}`;
  document.getElementById("fish-cast-btn").innerHTML = `&#127907; Lancer (${st.cost} &#129713;)`;
  document.getElementById("fish-cast-btn").disabled = fishBusy || worms < st.cost || st.castsLeft === 0;
  document.getElementById("fish-cast5-btn").innerHTML = `Lancer ×5 (${st.cost * 5} &#129713;)`;
  document.getElementById("fish-cast5-btn").disabled = fishBusy || worms < st.cost * 5 || (st.castsLeft != null && st.castsLeft < 5);
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
    const useBait = !!document.getElementById("fish-bait")?.checked;
    const request = API.fishing(Session.userId, "cast", count, useBait, fishZone === "deep" && fishState.deep && fishState.deep.unlocked ? "deep" : "shore");
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
    catchEl.innerHTML = "";
    for (const [i, c] of res.catches.entries()) {
      if (i) await fishWait(320);
      catchEl.insertAdjacentHTML("beforeend", `<span class="fish-catch-item tier-${c.tier}"><span class="fish-catch-icon">${FISH_ICONS[c.type] || ""}</span>${fishCatchText(c)}${c.first ? ' <span class="fish-new">1re !</span>' : c.record ? ' <span class="fish-new">record !</span>' : ""}</span>`);
      if (typeof Sfx !== "undefined" && Sfx.click && res.catches.length > 1) Sfx.click();
    }
    status.textContent = (res.catches.length > 1 ? `${res.catches.length} prises !` : (best.type === "nothing" ? "Pas de chance…" : "Belle prise !")) + (res.baitUsed ? " (appât doré)" : "") + (res.reducedRewards ? " · rendement réduit" : "");
    if (["epique", "legendaire", "mythique"].includes(best.tier) && typeof confetti === "function") confetti({ particleCount: best.tier === "mythique" ? 180 : 90, spread: 90, origin: { y: 0.55 } });
    const log = document.getElementById("fish-log");
    log.insertAdjacentHTML("afterbegin", res.catches.map((c) => `<span class="fish-log-item tier-${c.tier}">${FISH_ICONS[c.type] || ""} ${fishCatchText(c)}</span>`).join(""));
    while (log.children.length > 20) log.lastElementChild.remove();
    fishBusy = false;
    renderFishing(res);
    if (res.levelUp) announceLevelUp("&#127907;", "Pêche", res.levelUp, res.level);
    if (res.catches.some((c) => c.type === "part")) Toast.info("&#128297; Pièce détachée : dans l'atelier (Finitions ou Qualité), elle remplace un des exemplaires à consommer.");
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    fishBusy = false;
    scene.classList.remove("casting", "waiting", "bite");
    status.textContent = "Prêt à pêcher";
    Toast.error({ not_enough_worms: "Plus de vers de terre : termine une grille de fouille ou récolte au jardin.", not_enough_bait: "Plus assez d'appâts dorés.", deep_locked: "Les eaux profondes se débloquent au niveau 10 de pêche.", daily_limit: "Plus de lancers pour aujourd'hui : reviens demain !" }[e.code] || ("Erreur. (" + e.message + ")"));
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

// Retour accelere (api/src/native/rules.js) : temps restant / 2, une fois par jour.
async function rushExpedition() {
  const r = await loadEconomyRules(true);
  if (!r) return;
  if (r.expeditionRushedToday) { Toast.info("Déjà accéléré aujourd'hui."); return; }
  if (!(await Confirm.show(`Diviser par deux le temps restant de l'expédition contre ${r.expeditionRushCost} poussières ? (une fois par jour)`, { title: "Accélérer le retour", confirmText: "Accélérer" }))) return;
  try {
    await API.reroll(Session.userId, "expedition");
    Toast.success("&#9889; Ton explorateur presse le pas !");
    loadExpedition();
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) { Toast.error({ already_rerolled: "Déjà fait aujourd'hui.", not_enough_dust: "Pas assez de poussières.", no_expedition: "Aucune expédition en cours." }[e.code] || "Erreur. (" + e.message + ")"); }
}

async function loadExpeditionLevel() {
  try { const d = await API.expedition(Session.userId, "status"); if (d.expeditionLevel) renderSkillLevel("expe-level", "&#129517;", "Expédition", d.expeditionLevel, expePerkTexts(d.expeditionLevel.perks)); } catch (e) { /* niveau indisponible */ }
}

async function renderExpedition(data) {
  clearInterval(expeditionTimer);
  if (data && data.expeditionLevel) renderSkillLevel("expe-level", "&#129517;", "Expédition", data.expeditionLevel, expePerkTexts(data.expeditionLevel.perks));
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
          ${ex.ready ? "" : `<button type="button" class="btn-secondary" id="expe-rush-btn">&#9889; Accélérer le retour</button>`}
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
    document.getElementById("expe-rush-btn")?.addEventListener("click", rushExpedition);
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
    if (res.levelUp) LevelUpModal.show({ icon: "&#129517;", name: "Expédition", level: res.levelUp, perks: expePerkTexts(res.expeditionLevel && res.expeditionLevel.perks) });
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
  // Lien de l'en-tete vers la peche alors qu'on est deja sur la page.
  window.addEventListener("hashchange", () => { const t = HASH_TAB[location.hash.slice(1)]; if (t) setActiveTab(t); });
  document.getElementById("tab-garden-btn").addEventListener("click", () => setActiveTab("garden"));
  document.getElementById("garden-plant-btn").addEventListener("click", () => gardenAction("plant"));
  document.getElementById("garden-harvest-btn").addEventListener("click", () => gardenAction("harvest"));
  document.getElementById("garden-buyplot-btn").addEventListener("click", () => gardenAction("buyPlot"));
  document.getElementById("fish-extras").addEventListener("click", (e) => { if (e.target.closest("#fish-reroll-btn")) rerollWeather(); });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-prestige]"); if (b) doPrestige(b.dataset.prestige); });
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
