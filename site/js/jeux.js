// Logique de la page Jeux : fouille, devine la carte, expedition, bingo de
// collection et coffre-fort.


// Memorise le dernier onglet visite (QoL 2026-09-30) : revenir sur "Jeux"
// rouvrait toujours "Fouille" par defaut, meme si on passait le plus clair
// de son temps sur "Coffre-fort".
const LAST_TAB_KEY = "2gatcha_last_tab_jeux";
// Ancre d'URL de chaque onglet (2026-10-05) : jeux.html#peche, #jardin...
const TAB_HASH = { dig: "fouille", archeo: "archeologie", guess: "devine", expedition: "expedition", fish: "peche", garden: "jardin", walk: "promenade", cook: "cuisine", dino: "dinos", bingo: "bingo", vault: "coffre-fort" };
const HASH_TAB = Object.fromEntries(Object.entries(TAB_HASH).map(([k, v]) => [v, k]));
function getInitialTab() {
  const fromHash = HASH_TAB[location.hash.slice(1)];
  if (fromHash) return fromHash;
  try { return localStorage.getItem(LAST_TAB_KEY) || "dig"; } catch (e) { return "dig"; }
}

function setActiveTab(tab) {
  ["dig", "archeo", "guess", "expedition", "fish", "garden", "walk", "cook", "dino", "bingo", "vault"].forEach((key) => {
    document.getElementById(`tab-${key}-btn`).classList.toggle("active", tab === key);
    document.getElementById(`tab-${key}-btn`).setAttribute("aria-selected", String(tab === key));
    document.getElementById(`${key}-pane`).style.display = tab === key ? "block" : "none";
  });
  try { localStorage.setItem(LAST_TAB_KEY, tab); } catch (e) {}
  if (TAB_HASH[tab] && location.hash !== "#" + TAB_HASH[tab]) history.replaceState(null, "", "#" + TAB_HASH[tab]);
  if (tab === "garden") loadGarden();
  if (tab === "walk" && window.Companions) Companions.loadWalk();
  if (tab === "cook" && window.Companions) Companions.loadCook();
  if (tab === "dino" && window.loadDinos) window.loadDinos();
  if (tab === "dig") loadDig();
  if (tab === "archeo" && window.loadArcheo) window.loadArcheo();
  if (tab === "guess") loadGuess();
  if (tab === "expedition") loadExpedition();
  if (tab === "fish") loadFishing();
  if (tab === "bingo") (window.loadBingoFull || loadBingo)();
  if (tab === "vault") loadVault();
}

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
    p.dogSpeed ? `Milo ${Math.round(p.dogSpeed * 100)} % plus rapide, plus de flair` : ""
  ];
}
function fishPerkTexts(p = {}) {
  return [
    p.energyBonus ? `+${p.energyBonus} énergie de pêche max` : "",
    p.regenReduction ? `recharge ${Math.round(p.regenReduction * 100)} % plus rapide` : "",
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
  } catch (e) { Toast.error(e.code === "not_max_level" ? "Il faut être niveau 10." : friendlyError(e)); }
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
  } catch (e) { Toast.error({ already_rerolled: "Déjà fait aujourd'hui.", not_enough_dust: "Pas assez de poussières." }[e.code] || friendlyError(e)); }
}

async function renderFishExtras(st) {
  const box = document.getElementById("fish-extras");
  if (!box) return;
  const r = await loadEconomyRules();
  const parts = [];
  if (st.event) parts.push(`<span class="fish-chip fish-chip-event">&#127881; ${st.event.label}${st.event.fishingRare > 1 ? ` : prises rares ×${st.event.fishingRare}` : ""}${st.event.wormsMultiplier > 1 ? ` · vers ×${st.event.wormsMultiplier}` : ""}</span>`);
  if (st.tourney && st.tourney.active) parts.push(`<a class="fish-chip fish-chip-tourney" href="communaute.html#metiers">&#127942; Tournoi du week-end : ${st.tourney.score} pts · ${Math.max(0, st.tourney.max - st.tourney.casts)} lancer${st.tourney.max - st.tourney.casts > 1 ? "s" : ""} comptant encore</a>`);
  if (st.goldBait > 0) parts.push(`<label class="fish-chip fish-bait"><input type="checkbox" id="fish-bait" /> ${resIcon("bait")} Appât doré (${st.goldBait})</label>`);
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
let gardenSeed = (() => { try { return localStorage.getItem("2gatcha_garden_seed") || "mix"; } catch (e) { return "mix"; } })();
let gardenState = null;
// Refonte du 26 octobre : sachets de graines, champ (ciel jour / nuit,
// cloture, tournesols, abeilles, epouvantail), sillons, anneau de pousse,
// plantation parcelle par parcelle, « caca partout », gains qui s'envolent.
const SEED_ICONS = { mix: "&#127793;", worm: resIcon("worm"), bait: resIcon("bait"), dust: "&#127776;", catnip: "&#127807;", bone: "&#129460;", mushroom: "&#127812;", veggie: "&#129388;" };
// Culture prete : selon la graine (melange : legume different selon la parcelle).
const CROP_ART = { worm: "Jardin/Champi.PNG", bait: "Jardin/Blé.png", dust: "Jardin/Gingembre.PNG" };
const CROP_EMOJI = { catnip: "&#127807;", bone: "&#129460;", mushroom: "&#127812;", veggie: "&#129388;" };
const MIX_ART = ["Jardin/Carotte.png", "Jardin/Brocoli.png", "Jardin/Poivron.png"];
const gardenCrop = (p, i) => (CROP_EMOJI[p.seed] ? `<span class="gp-emoji">${CROP_EMOJI[p.seed]}</span>` : artImg(CROP_ART[p.seed] || MIX_ART[i % MIX_ART.length]));
const gardenLeft = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.ceil((s % 3600) / 60)).padStart(2, "0")}` : `${Math.max(1, Math.ceil(s / 60))} min`);
function renderGardenSeeds(st) {
  const el = document.getElementById("garden-seeds");
  if (!el || !st.seeds) return;
  if (!st.seeds.some((s) => s.key === gardenSeed && !s.locked)) gardenSeed = "mix";
  // Surprises (2026-10-29) : une graine pas encore debloquee n'est ni montree ni nommee.
  const hidden = st.seeds.filter((s) => s.locked);
  el.innerHTML = st.seeds.filter((s) => !s.locked).map((s) => `
    <button type="button" role="radio" aria-checked="${gardenSeed === s.key}" class="garden-seed seed-${s.key} ${gardenSeed === s.key ? "active" : ""} ${s.locked ? "locked" : ""}" data-seed="${s.key}" ${s.locked ? `disabled title="Se débloque au niveau ${s.level} de jardinage"` : ""}>
      <span class="garden-seed-icon" aria-hidden="true">${SEED_ICONS[s.key] || s.icon}</span>
      <span class="garden-seed-body"><strong>${escHtml(s.label)}</strong><small>${escHtml(s.desc)}</small>
        <span class="garden-seed-price">${s.cost} &#10024; · ${s.growHours} h</span></span>
    </button>`).join("") + (hidden.length ? `
    <span class="garden-seed mystery-slot" aria-label="Graines à découvrir"><span class="garden-seed-icon" aria-hidden="true">&#10067;</span>
      <span class="garden-seed-body"><strong>${hidden.length > 1 ? `${hidden.length} graines` : "Une graine"} à découvrir</strong><small>Continue de jardiner : elles se révéleront en montant de niveau.</small></span></span>` : "");
}
function gardenSky() {
  const h = new Date().getHours();
  return h >= 21 || h < 6 ? "night" : h < 8 ? "dawn" : h >= 19 ? "dusk" : "day";
}
function renderGarden(st) {
  gardenState = st;
  renderGardenSeeds(st);
  const seedCost = (st.seeds || []).find((s) => s.key === gardenSeed)?.cost ?? st.plantCost;
  const chip = (html, cls = "", title = "") => `<span class="gm-chip ${cls}"${title ? ` title="${title}"` : ""}>${html}</span>`;
  document.getElementById("garden-meta").innerHTML = `<div class="gm-chips">`
    + chip(`${resIcon("worm")} <strong>${st.worms}</strong> vers`)
    + chip(`${resIcon("bait")} <strong>${st.goldBait}</strong> appât${st.goldBait > 1 ? "s" : ""} doré${st.goldBait > 1 ? "s" : ""}`, "gold")
    + chip(`${POOP} <strong>${st.fertilizer || 0}</strong> engrais`, "poop", "Les cacas de tes dinos : pousse accélérée et récolte doublée")
    + (st.goldFertilizer ? chip(`${GOLD_POOP} <strong>${st.goldFertilizer}</strong> doré${st.goldFertilizer > 1 ? "s" : ""}`, "gold", "Parcelle prête tout de suite, appât doré garanti") : "")
    + (st.catFish ? chip(`&#128031; <strong>${st.catFish}</strong> pour Moka`) : "")
    + (st.bones ? chip(`&#129460; <strong>${st.bones}</strong> os`) : "")
    + (st.streak ? chip(`&#128293; <strong>${st.streak}</strong> jour${st.streak > 1 ? "s" : ""} d'affilée${st.rareChance ? ` · ${Math.round(st.rareChance * 100)} % de récolte rare` : ""}`, "streak", "Récolte rare dès 3 jours de suite") : "")
    + `</div><small class="gm-info">Pousse de base ${st.growHours} h · ${Math.round(st.baitChance * 100)} % de chances d'appât doré par récolte${st.wiltHours ? ` · une plante prête fane au bout de ${st.wiltHours} h` : " · tes plantes ne fanent pas"}</small>`;
  const t = Date.now() / 1000;
  const field = document.getElementById("garden-field");
  if (field) field.dataset.sky = gardenSky();
  document.getElementById("garden-plots").innerHTML = st.plots.map((p, i) => {
    if (!p.planted) return `<div class="garden-plot empty" data-plot="${i}"><span class="gp-furrows" aria-hidden="true"></span><button type="button" class="gp-plant" data-plant-plot="${i}" ${st.stardust < seedCost ? "disabled" : ""}>+ Planter ici<small>${SEED_ICONS[gardenSeed] || ""} ${seedCost} &#10024;</small></button></div>`;
    const pct = Math.min(100, Math.round(((t - p.plantedAt) / (p.readyAt - p.plantedAt)) * 100));
    const ready = pct >= 100;
    const stage = p.wilted ? artImg("Jardin/Fanee.PNG") : ready ? gardenCrop(p, i) : pct >= 25 ? artImg("Jardin/Pousse.png") : artImg("Jardin/Graine.png");
    const left = Math.max(0, Math.round(p.readyAt - t));
    const wiltLeft = p.wiltAt ? Math.max(0, Math.round(p.wiltAt - t)) : null;
    const seedName = (st.seeds || []).find((s) => s.key === p.seed)?.label || "Mélange";
    return `<div class="garden-plot ${ready ? "ready" : "growing"} ${p.wilted ? "wilted" : ""} ${p.fertilized ? "fert" : ""}" data-plot="${i}" style="--p:${pct}">
      <span class="gp-furrows" aria-hidden="true"></span>
      <span class="gp-tag" title="${escHtml(seedName)}">${SEED_ICONS[p.seed || "mix"] || ""}</span>
      ${p.goldFertilized ? `<span class="garden-fert-tag" title="Engrais doré : appât doré garanti">${GOLD_POOP}</span>` : p.fertilized ? `<span class="garden-fert-tag" title="Engrais de dino : pousse accélérée, récolte doublée">${POOP}</span>` : ""}
      <span class="garden-plant stage-${p.wilted ? "wilted" : ready ? "ready" : pct >= 25 ? "sprout" : "seed"}" aria-hidden="true">${stage}</span>
      ${ready && !p.wilted ? `<span class="gp-sparkles" aria-hidden="true"><i></i><i></i><i></i></span>` : ""}
      ${!ready ? `<span class="gp-ring" aria-hidden="true"></span>` : ""}
      <span class="garden-label">${p.wilted ? "Fanée : récolte réduite" : ready ? (wiltLeft != null && wiltLeft < 6 * 3600 ? `Prête ! Fane dans ${Math.max(1, Math.round(wiltLeft / 3600))} h` : "Prête à récolter !") : `Encore ${gardenLeft(left)}`}</span>
      ${!ready && (st.fertilizer && !p.fertilized || st.goldFertilizer && !p.goldFertilized) ? `<span class="gp-fert-btns">${st.fertilizer && !p.fertilized ? `<button type="button" class="garden-fert-btn" data-fertilize="${p.plot}" title="Engrais de dino : saute une partie de la pousse et double la récolte">${POOP}</button>` : ""}${st.goldFertilizer && !p.goldFertilized ? `<button type="button" class="garden-fert-btn gold" data-fertilize="${p.plot}" data-gold="1" title="Engrais doré : prête tout de suite, appât doré garanti">${GOLD_POOP}</button>` : ""}</span>` : ""}
    </div>`;
  }).join("");
  const free = st.plots.filter((p) => !p.planted).length;
  const plantBtn = document.getElementById("garden-plant-btn");
  plantBtn.disabled = !free || st.stardust < seedCost;
  plantBtn.innerHTML = `${SEED_ICONS[gardenSeed] || "&#127793;"} Tout planter${free ? ` (${free})` : ""}`;
  const buy = document.getElementById("garden-buyplot-btn");
  if (buy && st.extraPlot) {
    buy.hidden = st.extraPlot.price == null;
    buy.innerHTML = `&#10133; Parcelle (${st.extraPlot.owned}/${st.extraPlot.max}) · ${st.extraPlot.price} &#10024;`;
    buy.disabled = st.stardust < st.extraPlot.price;
  }
  // Caca partout : toutes les parcelles qui poussent et n'ont pas encore d'engrais.
  const poopable = st.plots.filter((p) => p.planted && !p.ready && !p.fertilized).length;
  const poop = document.getElementById("garden-poop-btn");
  if (poop) {
    poop.hidden = !st.fertilizer && !poopable;
    poop.disabled = !st.fertilizer || !poopable;
    poop.innerHTML = `${POOP} Mettre du caca partout${poopable && st.fertilizer ? ` (${Math.min(poopable, st.fertilizer)})` : ""}`;
    poop.title = !st.fertilizer ? "Plus d'engrais : ramasse les cacas de tes dinos" : !poopable ? "Aucune parcelle en train de pousser sans engrais" : "Un caca de dino sur chaque parcelle qui pousse : plus rapide, récolte doublée";
  }
  if (st.level) renderSkillLevel("garden-level", "&#127793;", "Jardin", st.level, gardenPerkTexts(st.level.perks));
  // Noisette la lapine et son rapport (companions.js).
  if (window.Companions) Companions.garden(st);
  document.getElementById("garden-harvest-btn").disabled = !st.readyCount;
  document.getElementById("garden-harvest-btn").innerHTML = `&#129530; Tout récolter${st.readyCount ? ` (${st.readyCount})` : ""}`;
  clearInterval(gardenTimer);
  if (st.plots.some((p) => p.planted && !p.ready)) gardenTimer = setInterval(() => renderGarden(st), 30000);
}

async function loadGarden() {
  try { renderGarden(await API.garden(Session.userId, "status", { takeReport: true })); }
  catch (e) { document.getElementById("garden-meta").textContent = "Impossible de charger le jardin."; }
}

// Pluie de cacas : un caca tombe sur chaque parcelle visee, puis « splotch ».
function gardenPoopRain(plots) {
  const field = document.getElementById("garden-field");
  if (!field || !plots.length || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return Promise.resolve();
  const fr = field.getBoundingClientRect();
  plots.forEach((el, k) => {
    const r = el.getBoundingClientRect();
    const d = document.createElement("span");
    d.className = "gp-poop-drop";
    d.textContent = "\u{1F4A9}";
    d.style.left = `${r.left - fr.left + r.width / 2}px`;
    d.style.setProperty("--fall", `${r.top - fr.top + r.height * 0.55}px`);
    d.style.animationDelay = `${k * 120}ms`;
    field.appendChild(d);
    setTimeout(() => {
      el.classList.add("splat");
      if (typeof Sfx !== "undefined" && Sfx._tone) { Sfx._tone(140 - k * 6, 0, 0.12, "sine", 0.08); Sfx._tone(90, 0.05, 0.1, "triangle", 0.05); }
      setTimeout(() => el.classList.remove("splat"), 700);
    }, 520 + k * 120);
    setTimeout(() => d.remove(), 900 + k * 120);
  });
  return new Promise((res) => setTimeout(res, 600 + plots.length * 120));
}
// Gains qui s'envolent au-dessus des parcelles recoltees.
function gardenFloat(items) {
  const field = document.getElementById("garden-field");
  if (!field) return;
  const fr = field.getBoundingClientRect();
  (items || []).forEach((it, k) => {
    const el = document.querySelector(`#garden-plots [data-plot="${it.plot}"]`);
    if (!el) return;
    const bits = [it.worms && `+${it.worms} ${resIcon("worm")}`, it.bait && `+${it.bait} ${resIcon("bait")}`, it.dust && `+${it.dust} &#10024;`, it.catFish && `+${it.catFish} &#128031;`, it.bones && `+${it.bones} &#129460;`, it.skulls && `+${it.skulls} &#128128;`, it.parts && `+${it.parts} &#128297;`, it.veg && `+${it.veg} &#129388;`, it.herb && `+${it.herb} &#127807;`, it.mush && `+${it.mush} &#127812;`, it.grubs && `+${it.grubs} &#128027;`].filter(Boolean);
    if (!bits.length) return;
    const r = el.getBoundingClientRect();
    const f = document.createElement("span");
    f.className = "gp-float";
    f.innerHTML = bits.join(" ");
    f.style.left = `${r.left - fr.left + r.width / 2}px`;
    f.style.top = `${r.top - fr.top + r.height * 0.35}px`;
    f.style.animationDelay = `${k * 90}ms`;
    field.appendChild(f);
    setTimeout(() => f.remove(), 1700 + k * 90);
  });
}

async function gardenAction(action, extra = {}) {
  try {
    if (action === "buyPlot" && !(await Confirm.show(`Acheter une parcelle de plus pour ${gardenState.extraPlot.price} poussières ?`, { title: "Agrandir le jardin", confirmText: "Acheter" }))) return;
    // Caca partout : on repere les parcelles avant l'appel (pour la pluie).
    const before = action === "fertilize" && extra.plot == null ? (gardenState?.plots || []).filter((p) => p.planted && !p.ready && !p.fertilized).map((p) => document.querySelector(`#garden-plots [data-plot="${p.plot}"]`)).filter(Boolean) : action === "fertilize" ? [document.querySelector(`#garden-plots [data-plot="${extra.plot}"]`)].filter(Boolean) : [];
    const res = await API.garden(Session.userId, action, action === "plant" ? { seed: gardenSeed, ...extra } : extra);
    if (action === "fertilize") await gardenPoopRain(before.slice(0, res.fertilized || before.length));
    if (action === "harvest") gardenFloat(res.items);
    renderGarden(res);
    if (action === "buyPlot") Toast.success("&#10133; Nouvelle parcelle !");
    else if (action === "fertilize") Toast.success(res.gold ? `${GOLD_POOP} Engrais doré : la plante est prête, et un appât doré t'attend !` : res.fertilized > 1 ? `${POOP} Caca partout : ${res.fertilized} parcelles fertilisées ! Ça pousse plus vite, et la récolte sera doublée.` : `${POOP} Engrais posé : ça pousse plus vite, et la récolte sera doublée !`);
    else if (action === "plant") Toast.success(`${SEED_ICONS[gardenSeed] || "&#127793;"} ${res.planted} parcelle${res.planted > 1 ? "s" : ""} plantée${res.planted > 1 ? "s" : ""} !`);
    else if (action === "harvest") {
      const g = res.gained;
      if (g.rare) setTimeout(() => Toast.success(`&#127775; Récolte rare : ${g.rare.icon} ${g.rare.label} !`), 600);
      if (g.wilted) setTimeout(() => Toast.info(`&#129344; ${g.wilted} plante${g.wilted > 1 ? "s" : ""} fanée${g.wilted > 1 ? "s" : ""} : récolte réduite. Repasse plus tôt la prochaine fois !`), 300);
      const parts = [g.worms && `+${g.worms} vers`, g.bait && `+${g.bait} appât${g.bait > 1 ? "s" : ""} doré${g.bait > 1 ? "s" : ""}`, g.dust && `+${g.dust} &#10024;`, g.catFish && `+${g.catFish} poisson${g.catFish > 1 ? "s" : ""} pour Moka`, g.bones && `+${g.bones} os pour Milo`, g.skulls && `+${g.skulls} crâne de dino`, g.parts && `+${g.parts} pièce${g.parts > 1 ? "s" : ""} détachée${g.parts > 1 ? "s" : ""}`, g.veg && `+${g.veg} légume${g.veg > 1 ? "s" : ""}`, g.herb && `+${g.herb} herbe${g.herb > 1 ? "s" : ""}`, g.mush && `+${g.mush} champignon${g.mush > 1 ? "s" : ""}`, g.grubs && PetText.mask(`+${g.grubs} ver${g.grubs > 1 ? "s" : ""} blanc${g.grubs > 1 ? "s" : ""} pour Pistache`)].filter(Boolean);
      Toast.success(`&#129530; Récolte : ${parts.join(", ") || "rien cette fois"} !`);
      if ((g.bait || g.skulls) && typeof confetti === "function") confetti({ particleCount: 80, spread: 80, origin: { y: 0.6 } });
      if (res.levelUp) LevelUpModal.show({ icon: "&#127793;", name: "Jardin", level: res.levelUp, perks: gardenPerkTexts(res.level && res.level.perks) });
    }
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error({ not_enough_dust: "Pas assez de poussières.", nothing_ready: "Rien n'est prêt.", no_free_plot: "Toutes les parcelles sont occupées.", max_plots: "Ton jardin est déjà au maximum.", no_fertilizer: "Plus d'engrais : ramasse les cacas de tes dinos.", nothing_to_fertilize: "Aucune parcelle en train de pousser sans engrais.", seed_locked: `Cette graine se débloque au niveau ${e.data && e.data.level} de jardinage.` }[e.code] || friendlyError(e));
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
  // Pioche (site/assets/Fouille) : la seconde a partir du niveau 5.
  const pick = document.getElementById("dig-pick-img");
  if (pick) { const key = `Fouille/${info.level >= 5 ? "Pioche_02" : "Pioche_01"}.PNG`; if (pick.dataset.pick !== key) { pick.dataset.pick = key; pick.dataset.vis = key; pick.setAttribute("src", "assets/" + key); if (typeof Visuals !== "undefined") Visuals.apply(pick); } }
  renderSkillLevel("dig-level", tool.icon, "Fouille", info, digPerkTexts(info.perks), tool);
  document.getElementById("dig-pane").dataset.shovel = tool.key;
  // Medaillon de Milo : anneau cuivre, bleu, or puis irise (niveau max).
  const dog = document.getElementById("dig-kennel-dog-wrap");
  if (dog) dog.dataset.tier = info.level >= 10 ? "cape" : info.level >= 7 ? "or" : info.level >= 4 ? "bleu" : "rouge";
}

function renderFishLevel(info) {
  if (!info) return;
  const rod = toolFor(FISH_RODS, info.level);
  renderSkillLevel("fish-level", "&#127907;", "Pêche", info, fishPerkTexts(info.perks), rod);
  // Medaillon de Moka : memes paliers que Milo, selon le niveau de peche.
  const cat = document.getElementById("fish-cat-wrap");
  if (cat) cat.dataset.tier = info.level >= 10 ? "cape" : info.level >= 7 ? "or" : info.level >= 4 ? "bleu" : "rouge";
  document.getElementById("fish-rod").dataset.rod = rod.key;
}

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
  if (!digDepthState || depth === digDepthState.depth || digBusy) return;
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
    Toast.error(e.code === "no_energy" ? "Plus assez d'énergie." : e.code === "tile_already_dug" ? "Cette tuile est déjà creusée." : friendlyError(e));
  } finally {
    digBusy = false;
  }
}

// -----------------------------------------------------------------------
// Peche (api/src/native/fishing.js) : chaque lancer coute des poussieres et
// ramene une prise tiree dans une table ponderee (reglable dans l'admin).
// -----------------------------------------------------------------------
// Visuels peints (site/assets, 2026-10-17). Les noms de fichiers sont sensibles
// a la casse sur le serveur : garder l'extension exacte (.PNG / .png).
const artImg = (file, alt = "") => `<img class="ico-art" src="assets/${encodeURI(file)}" alt="${alt}" loading="lazy" decoding="async">`;
const FISH_ICONS = { nothing: "&#129406;", dust: "&#10024;", bone: artImg("Os.PNG"), key: artImg("clés.PNG"), booster: artImg("JetonBooster.png"), chest: artImg("Coffres/1.PNG"), part: artImg("PieceDetachee.PNG"), pearl: artImg("Pêche/PerleNoire.png"), bait: artImg("Pêche/Vers.png").replace('class="ico-art"', 'class="ico-art ico-gold"') };
// Nourriture des dinos pechee en plus.
const FOOD_ART = { fish: "Pêche/Poisson_12.png", seaweed: "Pêche/Algues.png", shrimp: "Pêche/crevette.png" };
const foodIcon = (b) => (FOOD_ART[b.type] ? artImg(FOOD_ART[b.type]) : b.icon);
// Especes de l'aquarium : image si on en a une, sinon l'emoji du serveur.
const AQ_ART = { gardon: "Pêche/Poisson_5.png", perche: "Pêche/Poisson_20.png", carpe: "Pêche/Poisson_7.png", ecrevisse: "Pêche/crabe.png", brochet: "Pêche/Poisson_15.png", truite: "Pêche/Poisson_11.png", silure: "Pêche/Poisson_10.png", lune: "Pêche/Poisson_16.png", koi: "Pêche/Poisson_2.PNG", doree: "Pêche/Poisson_1.png", maquereau: "Pêche/Poisson_9.png", clown: "Pêche/Poisson_4.PNG", crevette: "Pêche/crevette.png", pieuvre: "Pêche/Poisson_3.png", requin: "Pêche/Poisson_6.png", lanterne: "Pêche/Poisson_14.png", baleine: "Pêche/Poisson_13.png", coelacanthe: "Pêche/Poisson_8.png" };
const aqIcon = (f) => (f.img ? artImg(f.img, "") : AQ_ART[f.key] ? artImg(AQ_ART[f.key], "") : f.icon);
let fishState = null;
// Zone de peche (2026-10-09) : rivage ou eaux profondes (niveau 10).
let fishZone = (() => { try { return localStorage.getItem("2gatcha_fish_zone") || "shore"; } catch (e) { return "shore"; } })();
function setFishZone(z) {
  fishZone = z;
  try { localStorage.setItem("2gatcha_fish_zone", z); } catch (e) { /* stockage indisponible */ }
  if (fishState) renderFishing(fishState);
}
// 5 lieux de peche (2026-10-18) : rivage, etang, riviere, eaux profondes, abysses.
function curZone(st) {
  const zones = (st && st.zones) || [];
  return zones.find((z) => z.key === fishZone && z.unlocked) || zones[0] || { key: "shore", pool: "shore", cost: st.cost, table: st.table, unlocked: true, mult: 1 };
}
function renderFishZones(st) {
  const el = document.getElementById("fish-zones");
  if (!el) return;
  const zones = st.zones || [];
  if (zones.length < 2) { el.hidden = true; return; }
  if (!zones.some((z) => z.key === fishZone && z.unlocked)) fishZone = zones[0].key;
  el.hidden = false;
  // Surprises (2026-10-29) : un lieu pas encore debloque n'est ni montre ni nomme.
  const unknown = zones.filter((z) => !z.unlocked).length;
  el.innerHTML = zones.filter((z) => z.unlocked).map((z) => `<button type="button" role="radio" aria-checked="${fishZone === z.key}" class="fish-zone fish-zone-${z.key} ${fishZone === z.key ? "active" : ""}" data-zone="${z.key}" title="${escHtml(z.label)} : ${z.cost} ver${z.cost > 1 ? "s" : ""} par lancer">${z.icon} ${escHtml(z.label)} <small>${z.cost} ${resIcon("worm")}</small></button>`).join("")
    + (unknown ? `<span class="fish-zone mystery-slot" title="D'autres coins de pêche t'attendent">&#10067; ${unknown > 1 ? `${unknown} lieux` : "Un lieu"} à découvrir</span>` : "");
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
  const zone = curZone(st);
  document.getElementById("fish-scene").dataset.zone = zone.pool === "deep" ? "deep" : "shore";
  document.getElementById("fish-scene").dataset.spot = zone.key;
  st = { ...st, cost: zone.cost, table: zone.table };
  renderFishExtras(st);
  renderFishLevel(st.level);
  renderFishWeather(st.weather);
  renderFishBook(st.records);
  if (st.aquarium) renderAquarium(st.aquarium);
  if (st.cat) renderCat(st.cat);
  renderScrollBtn(st);
  if (st.catReport) { showCatPostcard(st.catReport); st.catReport = null; fishState.catReport = null; }
  renderFishEnergy(st);
  const worms = st.worms ?? 0, energy = st.energy ?? 0;
  document.getElementById("fish-meta").innerHTML = `${st.cost} ${resIcon("worm")} + 1 &#9889; le lancer · tu as <strong>${worms} ver${worms > 1 ? "s" : ""} de terre</strong>${worms < st.cost ? " · termine une grille de fouille pour en trouver" : ""}`;
  document.getElementById("fish-cast-btn").innerHTML = `<span>&#127907; Lancer (${st.cost} ${resIcon("worm")})</span>`;
  document.getElementById("fish-cast-btn").disabled = fishBusy || worms < st.cost || energy < 1;
  document.getElementById("fish-cast5-btn").innerHTML = `<span>Lancer ×5 (${st.cost * 5} ${resIcon("worm")})</span>`;
  document.getElementById("fish-cast5-btn").disabled = fishBusy || worms < st.cost * 5 || energy < 5;
  // Tout pecher : autant de lancers que les vers (et l'energie) le permettent.
  const allBtn = document.getElementById("fish-castall-btn");
  if (allBtn) {
    const n = fishMaxCasts(st);
    allBtn.hidden = n < 2 || n === 5;
    allBtn.disabled = fishBusy;
    allBtn.dataset.count = String(n);
    allBtn.innerHTML = `&#127907; Tout pêcher (×${n})`;
    allBtn.title = `${n} lancers d'un coup${n === FISH_MAX_CASTS ? ` (${FISH_MAX_CASTS} au plus)` : ""}`;
  }
  document.getElementById("fish-table").innerHTML = `<thead><tr><th>Prise</th><th>Quantité</th><th>Chance</th></tr></thead><tbody>${st.table.map((x) => `
    <tr class="fish-row-${x.tier}"><td>${FISH_ICONS[x.type] || ""} ${x.label}</td><td>${x.type === "nothing" ? "—" : (x.min === x.max || x.max == null ? (x.min || 1) : `${x.min} à ${x.max}`)}</td><td>${x.chance} %</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="3" class="muted">&#129430; En plus, si tu as un dino ou un crâne : &#128031; poisson, &#127807; algues ou &#129424; crevette pour le nourrir.</td></tr></tfoot>`;
}

async function loadFishing() {
  try { renderFishing(await API.fishingStatusWithCat(Session.userId)); }
  catch (e) { document.getElementById("fish-status").textContent = "Impossible de charger la pêche."; }
}

// Energie de peche (comme la fouille) : jauge, decompte, rechargement de
// l'etat reel quand le prochain point revient.
let fishEnergyTimer = null;
let fishDeadline = 0;
function renderFishEnergy(st) {
  const bar = document.getElementById("fish-energy-bar");
  if (!bar || st.maxEnergy == null) return;
  if (fishEnergyTimer) { clearInterval(fishEnergyTimer); clearTimeout(fishEnergyTimer); fishEnergyTimer = null; }
  const energy = st.energy, max = st.maxEnergy;
  bar.innerHTML = Array.from({ length: max }, (_, i) => `<span class="dig-pip ${i < energy ? "filled" : ""}"></span>`).join("");
  bar.setAttribute("aria-label", `Énergie de pêche : ${energy} sur ${max}`);
  const text = document.getElementById("fish-energy-text");
  text.classList.remove("skeleton-line");
  const regen = Math.round((st.regenSeconds || 600) / 60);
  const fmt = (sec) => { const m = Math.floor(sec / 60), s = sec % 60; return `${m > 0 ? `${m} min ` : ""}${String(s).padStart(m > 0 ? 2 : 1, "0")} s`; };
  if (energy >= max || !st.secondsUntilNext) { fishDeadline = 0; text.textContent = `${energy} / ${max} énergie — +1 toutes les ${regen} min`; return; }
  // Decompte depuis l'heure d'arrivee du prochain point (voir renderDigEnergy).
  fishDeadline = Date.now() + st.secondsUntilNext * 1000;
  const left = () => Math.max(0, Math.ceil((fishDeadline - Date.now()) / 1000));
  const render = () => { text.textContent = `${energy} / ${max} énergie — ${energy ? "+1" : "prochaine"} dans ${fmt(left())}`; };
  render();
  fishEnergyTimer = setInterval(() => {
    if (left() <= 0) { clearInterval(fishEnergyTimer); fishEnergyTimer = null; fishDeadline = 0; if (!fishBusy) loadFishing(); return; }
    if (!document.hidden) render();
  }, 1000);
}

// Lancers possibles d'un coup : vers (cout de la zone), energie,
// appats dores si coches, et le plafond du serveur.
const FISH_MAX_CASTS = 50;
function fishMaxCasts(st) {
  const cost = Math.max(1, curZone(st).cost);
  let n = Math.floor((st.worms || 0) / cost);
  if (st.energy != null) n = Math.min(n, st.energy);
  if (document.getElementById("fish-bait")?.checked) n = Math.min(n, st.goldBait || 0);
  return Math.max(0, Math.min(n, FISH_MAX_CASTS));
}

// Moka le chat (api/src/native/cat.js) : on lui donne du poisson, il peche
// a ta place (sans ver ni energie, jamais de booster) ; ses prises arrivent
// dans une carte postale a ton retour.
let catTimer = null;
function catFeedable(c) {
  const maxByTime = Math.floor(((c.maxMinutes * 60) - c.secondsLeft) / (c.minutesPerFish * 60));
  const maxByDay = c.dailyFish > 0 ? c.dailyFish - c.fedToday : Infinity;
  return Math.max(0, Math.min(c.fish, maxByTime, maxByDay));
}
function renderCat(c) {
  const box = document.getElementById("fish-cat");
  if (!box) return;
  box.hidden = false;
  if (catTimer) { clearInterval(catTimer); catTimer = null; }
  const can = catFeedable(c);
  const active = c.secondsLeft > 0;
  box.dataset.working = active ? "1" : "0";
  document.getElementById("fish-cat-count").textContent = c.fish ? `${c.fish} poisson${c.fish > 1 ? "s" : ""}` : "";
  document.getElementById("fish-cat-pic").classList.toggle("fishing", active);
  const sit = document.getElementById("fish-cat-sit");
  if (sit) sit.hidden = !active;
  const b1 = document.getElementById("fish-cat-feed1");
  b1.disabled = can < 1;
  b1.innerHTML = active ? `&#128031; +${c.minutesPerFish} min de travail` : `&#128031; Faire travailler Moka (${c.minutesPerFish} min)`;
  const bm = document.getElementById("fish-cat-feedmax");
  bm.hidden = can < 2;
  bm.dataset.count = String(can);
  bm.innerHTML = `+${String(Math.round(can * c.minutesPerFish / 60 * 10) / 10).replace(".", ",")} h de travail (${can} poissons)`;
  const dayLeft = c.dailyFish > 0 ? Math.max(0, c.dailyFish - c.fedToday) : null;
  b1.title = dayLeft != null ? `Encore ${dayLeft} poisson${dayLeft > 1 ? "s" : ""} aujourd'hui` : "";
  const text = document.getElementById("fish-cat-text");
  const casts = Math.max(1, Math.round(c.minutesPerFish / c.castMinutes));
  if (active) {
    let remaining = c.secondsLeft;
    const render = () => { const h = Math.floor(remaining / 3600), m = Math.ceil((remaining % 3600) / 60); text.innerHTML = `<strong class="pet-work">Travaille encore ${h ? h + " h " : ""}${String(m).padStart(h ? 2 : 1, "0")} min</strong> · environ 1 lancer toutes les ${c.castMinutes} min, sans ver ni énergie. Reviens voir ce qu'il a attrapé 🐾`; };
    render();
    catTimer = setInterval(() => { remaining -= 30; if (remaining <= 0) { clearInterval(catTimer); catTimer = null; loadFishing(); return; } render(); }, 30000);
  } else {
    text.innerHTML = c.fish
      ? `<strong class="pet-work idle">Au repos</strong> · 1 poisson = ${c.minutesPerFish} min de travail (${casts} lancers environ) sans ver ni énergie, jusqu'à ${Math.round(c.maxMinutes / 60)} h d'avance. Il fait de petites pauses quand il est fatigué.`
      : `<strong class="pet-work idle">Au repos</strong> · Moka travaille contre du poisson : chaque espèce remontée pour l'aquarium lui en donne un (ou une boîte de sardines à la boutique).`;
  }
}

function showCatPostcard(r) {
  if (!r || !r.casts) return;
  const parts = (r.items || []).map((x) => `${FISH_ICONS[x.type] || ""} ${x.type === "dust" || x.type === "pearl" ? `+${x.amount} poussières` : `${x.label} ×${x.amount}`}`);
  (r.species || []).forEach((f) => parts.push(`${aqIcon(f)} ${escHtml(f.name)} ${f.size} cm (+${f.dust} ✨)${f.first ? " <strong>nouvelle espèce !</strong>" : ""}`));
  if (r.loveGift) parts.push(`${r.loveGift.icon} un petit cadeau pour toi : ${escHtml(r.loveGift.label)} ❤️`);
  const overlay = document.createElement("div");
  overlay.className = "card-modal-overlay dog-postcard-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Rapport de Moka");
  overlay.innerHTML = `
    <div class="dog-postcard cat-postcard">
      <div class="dog-postcard-stamp" aria-hidden="true">&#128062;</div>
      <div class="dog-postcard-pic" aria-hidden="true">&#128008;&#127907;</div>
      <div class="dog-postcard-text">
        <div class="dog-postcard-title">Miaou du ponton !</div>
        <p>Pendant ton absence, j'ai lancé ma ligne <strong>${r.casts} fois</strong>${r.done ? " et j'ai fini mon poisson" : ""}.</p>
        ${parts.length ? `<ul>${parts.map((p) => `<li>${p}</li>`).join("")}</ul>` : "<p>Rien n'a mordu… mais j'ai fait une belle sieste au soleil.</p>"}
        <div class="dog-postcard-sign">Ton chat, Moka &#128062;</div>
        ${r.hint ? `<p class="cat-postcard-ps">${escHtml(r.hint)}</p>` : ""}
      </div>
      <button type="button" class="btn dog-postcard-close">Merci Moka !</button>
    </div>`;
  const close = () => { overlay.remove(); syncScrollLock(); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest(".dog-postcard-close")) close(); });
  document.body.appendChild(overlay);
  syncScrollLock();
  if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
}

async function feedCat(count, btn) {
  btn.disabled = true;
  try {
    const r = await API.catFeed(Session.userId, count);
    Toast.success(`&#128008; Moka part pêcher ${count * r.cat.minutesPerFish} min de plus !`);
    if (r.catReport) showCatPostcard(r.catReport);
    if (fishState) { fishState = { ...fishState, cat: r.cat }; renderCat(r.cat); }
  } catch (e) {
    btn.disabled = false;
    Toast.error({ no_cat_fish: "Plus de poisson pour Moka : pêche des espèces pour l'aquarium ou achète des sardines.", cat_daily_limit: "Moka a assez mangé aujourd'hui : reviens demain !", cat_max_time: "Moka a déjà assez de pêche devant lui." }[e.code] || friendlyError(e));
  }
}

// Aquarium (api/src/native/aquarium.js) : especes, records, paliers de collection.
const AQ_RARITY = { commune: "Commune", rare: "Rare", epique: "Épique", legendaire: "Légendaire", mythique: "Mythique" };
function renderAquarium(aq) {
  const box = document.getElementById("fish-aquarium");
  if (!box) return;
  const ready = aq.milestones.filter((m) => m.reached && !m.claimed).length;
  document.getElementById("fish-aquarium-count").textContent = `${aq.found}/${aq.total}${ready ? " · palier à récupérer !" : ""}`;
  document.getElementById("fish-aquarium-count").classList.toggle("has-claim", !!ready);
  const rw = (r) => [r.dust ? `${r.dust} ✨` : "", r.boosters ? `${r.boosters} jetons booster` : "", r.chests ? `${r.chests} coffre` : "", r.title ? `titre « ${escHtml(r.title)} »` : ""].filter(Boolean).join(" + ");
  box.innerHTML = `
    <div class="aq-milestones">${aq.milestones.map((m) => `<span class="aq-ms ${m.claimed ? "claimed" : m.reached ? "ready" : ""}" title="${rw(m.reward)}">${m.claimed ? "✓" : m.reached ? "🎁" : "🔒"} ${escHtml(m.label)} <small>${rw(m.reward)}</small></span>`).join("")}
      ${ready ? '<button type="button" class="btn" id="aq-claim">Récupérer</button>' : ""}</div>
    <div class="aq-grid">${aq.species.map((s) => `
      <div class="aq-fish rar-${s.rarity} ${s.found ? "found" : ""} ${s.biteNow && !s.found ? "bite-now" : ""}" title="${escHtml(s.found ? s.name : "Espèce inconnue")} · ${escHtml(s.hint)}">
        <span class="aq-icon" aria-hidden="true">${s.found ? aqIcon(s) : "?"}</span>
        <strong>${escHtml(s.name)}</strong>
        <small>${AQ_RARITY[s.rarity]}${s.found ? ` · ×${s.count} · record ${s.best} cm` : `${s.biteNow ? " · mord en ce moment !" : ""}`}</small>
        <small class="aq-hint">${escHtml(s.hint)}</small>
      </div>`).join("")}</div>`;
}

// Ferrage (2026-10-18, remplace la jauge de timing, trop exigeante et
// sensible au decalage) : trois remous a la surface, on en choisit un (clic
// ou touches 1, 2, 3). Le serveur tire celui qui cachait la prise parfaite ;
// on le devoile ensuite.
function fishPick(scene) {
  return new Promise((resolve) => {
    const r = scene.getBoundingClientRect();
    const host = r.top >= 0 && r.bottom <= window.innerHeight ? scene : document.querySelector(".fish-controls");
    const g = document.createElement("div");
    g.className = "fish-pick" + (host === scene ? "" : " in-controls");
    g.innerHTML = `<div class="fp-label">Ça mord ! Trois remous : où ferres-tu ?</div><div class="fp-spots">${[0, 1, 2].map((i) => `<button type="button" class="fp-spot" data-fp="${i}" aria-label="Remous ${i + 1}"><span class="fp-ring"></span><span class="fp-ring fp-ring2"></span><span class="fp-n">${i + 1}</span></button>`).join("")}</div>`;
    host.appendChild(g);
    let done = false;
    const choose = (i) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      g.classList.add("fp-chosen");
      g.querySelector(`[data-fp="${i}"]`).classList.add("picked");
      if (typeof Haptics !== "undefined") Haptics.buzz(20);
      if (typeof Sfx !== "undefined" && Sfx.click) Sfx.click();
      resolve({ pick: i, el: g });
    };
    const onKey = (e) => { if (["1", "2", "3"].includes(e.key)) { e.preventDefault(); choose(Number(e.key) - 1); } };
    document.addEventListener("keydown", onKey);
    g.addEventListener("click", (e) => { const b = e.target.closest("[data-fp]"); if (b) choose(Number(b.dataset.fp)); });
    g.querySelector(".fp-spot").focus({ preventScroll: true });
  });
}
// Devoile le remous parfait apres la reponse du serveur, puis retire le choix.
function fishPickReveal(g, spots, pick) {
  return new Promise((resolve) => {
    if (!g) { resolve(); return; }
    if (Array.isArray(spots)) spots.forEach((s, i) => { const b = g.querySelector(`[data-fp="${i}"]`); if (b) b.classList.add(s === "perfect" ? "golden" : "plain"); });
    const perfect = Array.isArray(spots) && spots[pick] === "perfect";
    g.querySelector(".fp-label").textContent = perfect ? "Ferrage parfait !" : "Bien ferré";
    if (typeof Haptics !== "undefined") Haptics.buzz(perfect ? [20, 40, 20] : 25);
    setTimeout(() => { if (g.contains(document.activeElement)) document.activeElement.blur(); g.remove(); resolve(); }, perfect ? 900 : 700);
  });
}

// Pendant tout le lancer, Espace / Entree ne font pas defiler la page (un
// appui de trop apres le ferrage faisait "sauter" la fenetre d'un ecran).
function fishKeyGuard(e) {
  if ((e.key === " " || e.key === "Enter") && !e.target.closest("input, textarea, select, [contenteditable]")) e.preventDefault();
}

async function castFishing(count) {
  if (fishBusy || !fishState) return;
  // Jamais plus de lancers que d'energie (le serveur refuse aussi).
  if (fishState.energy != null && count > fishState.energy) {
    Toast.error(fishState.energy ? `Pas assez d'énergie : ${fishState.energy} lancer${fishState.energy > 1 ? "s" : ""} possible${fishState.energy > 1 ? "s" : ""} pour l'instant.` : "Plus d'énergie : elle se recharge avec le temps.");
    return;
  }
  fishBusy = true;
  document.addEventListener("keydown", fishKeyGuard);
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
    const zone = curZone(fishState).key;
    // On attend la touche, on ferre (plus dur avec plus de vers), puis on remonte la ligne.
    await fishWait(700);
    scene.classList.replace("casting", "waiting");
    status.textContent = "On attend que ça morde…";
    await fishWait(900 + Math.random() * 1400);
    scene.classList.replace("waiting", "bite");
    status.textContent = "Ça mord ! Choisis un remous…";
    if (typeof Sfx !== "undefined" && Sfx.click) Sfx.click();
    const { pick, el: pickEl } = await fishPick(scene);
    const res = await API.fishing(Session.userId, "cast", count, useBait, zone, pick);
    await fishPickReveal(pickEl, res.spots, pick);
    if (res.scroll) setTimeout(() => ScrollFx.open(true), 900);
    scene.classList.replace("bite", "caught");
    const best = res.catches.reduce((a, c) => (["nothing", "commune", "rare", "epique", "legendaire", "mythique"].indexOf(c.tier) > ["nothing", "commune", "rare", "epique", "legendaire", "mythique"].indexOf(a.tier) ? c : a), res.catches[0]);
    catchEl.hidden = false;
    catchEl.className = "fish-catch tier-" + best.tier;
    if (typeof Haptics !== "undefined" && ["epique", "legendaire", "mythique"].includes(best.tier)) Haptics.buzz(best.tier === "epique" ? [30, 50, 30] : [40, 60, 40, 60, 120]);
    catchEl.innerHTML = "";
    // Gros lot : prises regroupees par type plutot qu'une par une.
    if (res.catches.length > 6) {
      const groups = new Map();
      res.catches.forEach((c) => {
        const g = groups.get(c.type) || { ...c, n: 0, amount: 0, first: false };
        g.n++; g.amount += c.amount || 0; g.first = g.first || c.first;
        groups.set(c.type, g);
      });
      const order = ["mythique", "legendaire", "epique", "rare", "commune", "nothing"];
      [...groups.values()].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier)).forEach((g) => {
        catchEl.insertAdjacentHTML("beforeend", `<span class="fish-catch-item tier-${g.tier}"><span class="fish-catch-icon">${FISH_ICONS[g.type] || ""}</span>${g.type === "nothing" ? `${g.label} <strong>×${g.n}</strong>` : g.type === "dust" || g.type === "pearl" ? `${fishCatchText(g)} <small>(×${g.n})</small>` : `${g.label} <strong>×${g.amount || g.n}</strong>`}${g.first ? ' <span class="fish-new">1re !</span>' : ""}</span>`);
      });
    }
    for (const [i, c] of (res.catches.length > 6 ? [] : res.catches).entries()) {
      if (i) await fishWait(320);
      catchEl.insertAdjacentHTML("beforeend", `<span class="fish-catch-item tier-${c.tier}"><span class="fish-catch-icon">${FISH_ICONS[c.type] || ""}</span>${fishCatchText(c)}${c.first ? ' <span class="fish-new">1re !</span>' : c.record ? ' <span class="fish-new">record !</span>' : ""}</span>`);
      if (typeof Sfx !== "undefined" && Sfx.click && res.catches.length > 1) Sfx.click();
    }
    // Especes de poissons (aquarium) : une ligne par espece (regroupees pour les gros lots).
    const fishes = [...(res.species || []).reduce((m, f) => { const g = m.get(f.key) || { ...f, n: 0, dust: 0, size: 0, first: false, record: false }; g.n++; g.dust += f.dust; g.size = Math.max(g.size, f.size); g.first = g.first || f.first; g.record = g.record || f.record; return m.set(f.key, g); }, new Map()).values()];
    for (const f of fishes) {
      await fishWait(280);
      catchEl.insertAdjacentHTML("beforeend", `<span class="fish-catch-item fish-species tier-${f.tier}"><span class="fish-catch-icon">${aqIcon(f)}</span>${escHtml(f.name)}${f.n > 1 ? ` <strong>×${f.n}</strong>` : ""} · ${f.size} cm <small>(+${f.dust} ✨)</small>${f.first ? ' <span class="fish-new">nouvelle espèce !</span>' : f.record ? ' <span class="fish-new">record !</span>' : ""}</span>`);
      if (f.first && typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal(f.tier === "commune" ? "rare" : f.tier);
    }
    if (fishes.some((f) => f.first && ["epique", "legendaire", "mythique"].includes(f.tier)) && typeof confetti === "function") confetti({ particleCount: 120, spread: 100, colors: ["#38bdf8", "#22d3ee", "#fde68a", "#ffffff"], origin: { y: 0.5 } });
    // Nourriture des dinos : regroupee par type (utile pour les gros lots).
    const bycatch = [...(res.bycatch || []).reduce((m, b) => m.set(b.type, { ...b, amount: (m.get(b.type)?.amount || 0) + b.amount }), new Map()).values()];
    for (const b of bycatch) {
      await fishWait(250);
      catchEl.insertAdjacentHTML("beforeend", `<span class="fish-catch-item fish-bycatch">${foodIcon(b)} +${b.amount} ${b.label.toLowerCase()} <small>(pour tes dinos)</small></span>`);
    }
    status.textContent = (res.strike === "perfect" ? "Ferrage parfait ! " : "") + (res.catches.length > 1 ? `${res.catches.length} prises !` : (best.type === "nothing" && !fishes.length ? "Pas de chance…" : "Belle prise !")) + (res.baitUsed ? " (appât doré)" : "") + (res.reducedRewards ? " · rendement réduit" : "");
    if (["epique", "legendaire", "mythique"].includes(best.tier) && typeof confetti === "function") confetti({ particleCount: best.tier === "mythique" ? 180 : 90, spread: 90, origin: { y: 0.55 } });
    const log = document.getElementById("fish-log");
    log.insertAdjacentHTML("afterbegin", res.catches.map((c) => `<span class="fish-log-item tier-${c.tier}">${FISH_ICONS[c.type] || ""} ${fishCatchText(c)}</span>`).join("") + fishes.map((f) => `<span class="fish-log-item tier-${f.tier}">${aqIcon(f)} ${escHtml(f.name)} ${f.size} cm</span>`).join("") + bycatch.map((b) => `<span class="fish-log-item fish-bycatch">${foodIcon(b)} +${b.amount} ${b.label.toLowerCase()}</span>`).join(""));
    while (log.children.length > 20) log.lastElementChild.remove();
    fishBusy = false;
    document.removeEventListener("keydown", fishKeyGuard);
    renderFishing(res);
    if (res.levelUp) announceLevelUp("&#127907;", "Pêche", res.levelUp, res.level);
    if (res.catches.some((c) => c.type === "part")) Toast.info(resIcon("part") + " Pièce détachée : dans l'atelier (Finitions ou Qualité), elle remplace un des exemplaires à consommer.");
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    fishBusy = false;
    document.removeEventListener("keydown", fishKeyGuard);
    scene.classList.remove("casting", "waiting", "bite");
    status.textContent = "Prêt à pêcher";
    Toast.error({ not_enough_worms: "Plus de vers de terre : termine une grille de fouille ou récolte au jardin.", not_enough_bait: "Plus assez d'appâts dorés.", deep_locked: "Les eaux profondes se débloquent au niveau 10 de pêche.", zone_locked: "Ce lieu de pêche n'est pas encore débloqué.", no_energy: "Plus assez d'énergie : elle se recharge avec le temps." }[e.code] || friendlyError(e));
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
          <img src="${imgSrc}" alt="${c.name}" loading="lazy" decoding="async" />
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

// Ancien bingo (9 cartes) : garde tant que l'API repond l'ancien format (jeux-bingo.js).
window.loadBingoLegacy = () => loadBingo();
async function claimBingo() {
  try {
    const res = await API.claimBingo(Session.userId);
    Toast.success(`Bingo complet ! +${res.rewardBoosters} boosters !`);
    if (typeof confetti === "function") confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } });
    await loadBingo();
  } catch (e) {
    Toast.error(e.code === "already_claimed" ? "Déjà réclamé ce mois-ci." : friendlyError(e));
  }
}

// -----------------------------------------------------------------------
// Coffre-fort : une carte promo arc-en-ciel vitrine, visible mais enfermee
// tant qu'on n'a pas 6 clefs secretes (memes clefs que la fouille/la roue
// quotidienne) - deverrouillage DEFINITIF, une seule fois par joueur (voir
// vault.json - pas de colonne d'etat dediee, juste une ligne Pulls au
// BatchId prefixe 'vault-').
// Cage a 6 cadenas (2026-10-17) : chaque clef possedee fait sauter un cadenas
// au clic (cote site, memorise localement) ; au dernier, le coffre s'ouvre
// (vault.json, les 6 clefs sont alors consommees). Une fois ouvert : coffre
// vide et lien vers le coffre personnel.
let vaultState = null;
const vaultPoppedKey = () => `2gatcha_vault_popped_${Session.userId}`;
function vaultPopped() { try { return Math.max(0, Number(localStorage.getItem(vaultPoppedKey())) || 0); } catch (e) { return 0; } }
function setVaultPopped(n) { try { localStorage.setItem(vaultPoppedKey(), String(n)); } catch (e) { /* stockage indisponible */ } }

async function loadVault() {
  try {
    const res = await API.getVaultStatus(Session.userId);
    vaultState = res;
    if (!res.card) {
      document.getElementById("vault-locked").innerHTML = `<div class="empty-state">Le coffre-fort n'est pas encore configuré.</div>`;
      return;
    }
    const lockedZone = document.getElementById("vault-locked");
    const openedZone = document.getElementById("vault-opened");
    if (res.alreadyOpened) {
      lockedZone.style.display = "none";
      openedZone.style.display = "flex";
      document.getElementById("vault-intro").hidden = true;
      document.getElementById("vault-opened-name").textContent = res.card.name;
      setVaultPopped(0);
      return;
    }
    lockedZone.style.display = "block";
    openedZone.style.display = "none";
    document.getElementById("vault-card-img").src = API.imageUrl(res.card.imageId) || PLACEHOLDER_IMG;
    document.getElementById("vault-card-img").alt = res.card.name;
    const vaultNameEl = document.getElementById("vault-card-name");
    vaultNameEl.classList.remove("skeleton-line");
    vaultNameEl.textContent = `Libère ${res.card.name}`;
    renderPadlocks();
  } catch (e) {
    Toast.error("Impossible de charger le coffre-fort.");
  }
}

function renderPadlocks() {
  const res = vaultState;
  const need = res.keysRequired || 6;
  const popped = Math.min(vaultPopped(), res.userKeys, need);
  const box = document.getElementById("vault-padlocks");
  box.innerHTML = Array.from({ length: need }, (_, i) => {
    const open = i < popped;
    const can = !open && i < res.userKeys;
    return `<button type="button" class="vault-padlock ${open ? "popped" : can ? "can" : "locked"}" data-i="${i}" ${can ? "" : "disabled"} aria-label="${open ? "Cadenas ouvert" : can ? "Faire sauter ce cadenas avec une clé" : "Il manque une clé"}">${open ? "&#128275;" : "&#128274;"}</button>`;
  }).join("");
  const left = Math.max(0, need - res.userKeys);
  document.getElementById("vault-keys-label").innerHTML = `<img class="ico-art" src="assets/${encodeURI(RES_ART.key)}" alt="" /> ${res.userKeys} / ${need} clés · ${popped} cadenas ouvert${popped > 1 ? "s" : ""}${left ? ` · encore ${left} clé${left > 1 ? "s" : ""} à trouver` : popped < need ? " · fais sauter les cadenas !" : ""}`;
}

async function popPadlock(btn) {
  const res = vaultState;
  const need = res.keysRequired || 6;
  const popped = Math.min(vaultPopped(), res.userKeys, need);
  if (popped >= res.userKeys) return;
  btn.classList.add("popping");
  if (typeof Sfx !== "undefined" && Sfx.click) Sfx.click();
  await new Promise((r) => setTimeout(r, 380));
  setVaultPopped(popped + 1);
  renderPadlocks();
  if (popped + 1 >= need) openVault();
}

async function openVault() {
  const frame = document.querySelector("#vault-locked .vault-card-frame");
  try {
    if (frame) frame.classList.add("vault-unlocking");
    const res = await API.openVault(Session.userId);
    setVaultPopped(0);
    Toast.success(`&#127881; La cage s'ouvre : ${res.card.name} est libre !`);
    if (typeof confetti === "function") confetti({ particleCount: 250, spread: 140, origin: { y: 0.5 } });
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    setTimeout(() => loadVault(), 1600);
  } catch (e) {
    if (frame) frame.classList.remove("vault-unlocking");
    setVaultPopped(0);
    Toast.error(e.code === "not_enough_keys" ? "Pas assez de clés." : e.code === "already_opened" ? "Déjà ouvert." : friendlyError(e));
    loadVault();
  }
}

// -----------------------------------------------------------------------
// Devine la carte v2 (api/src/native/guessgame.js, 2026-10-18) : 5 cartes
// par jour, 3 essais par carte (la proposition fausse disparait, le zoom
// recule, le gain baisse). Trouver une carte qu'on ne possede pas donne un
// bon de craft. La reponse n'arrive du serveur qu'une fois la manche finie.
// -----------------------------------------------------------------------
let guessBusy = false;
let guessData = null;
let guessRound = null;

function renderGuess(data) {
  guessData = data;
  if (!data.rounds || !data.rounds.length) { document.getElementById("guess-choices").innerHTML = `<div class="empty-state">Jeu indisponible pour le moment.</div>`; return; }
  if (guessRound == null || !data.rounds[guessRound]) { const next = data.rounds.find((r) => !r.done); guessRound = next ? next.index : 0; }
  const r = data.rounds[guessRound];
  const img = document.getElementById("guess-img");
  img.src = API.imageUrl(r.imageId) || "";
  const frame = document.getElementById("guess-frame");
  const z = r.zoom || { scale: 3, x: 50, y: 50 };
  img.style.transformOrigin = `${z.x}% ${z.y}%`;
  img.style.transform = r.done ? "scale(1)" : `scale(${z.scale})`;
  frame.classList.toggle("revealed", !!r.done);
  // Loupe : le zoom recule a chaque erreur.
  const zb = document.getElementById("guess-zoom");
  if (zb) { zb.hidden = !!r.done; zb.innerHTML = `&#128269; ×${String(Math.round((z.scale || 1) * 10) / 10).replace(".", ",")}`; }

  const next = data.boosterEvery - ((data.streak || 0) % data.boosterEvery);
  document.getElementById("guess-rounds").innerHTML = `<div class="guess-rounds">${data.rounds.map((x) => `<button type="button" class="guess-round ${x.index === guessRound ? "active" : ""} ${x.done ? (x.correct ? "win" : "lose") : ""}" data-guess-round="${x.index}" aria-label="Carte ${x.index + 1}">${x.done ? (x.correct ? "&#10004;" : "&#10008;") : x.index + 1}</button>`).join("")}</div>`;
  document.getElementById("guess-streak").innerHTML = `
    <span>&#128293; Série : <strong>${data.streak || 0}</strong> jour${(data.streak || 0) > 1 ? "s" : ""} · ${data.found} / ${data.rounds.length} trouvée${data.found > 1 ? "s" : ""} aujourd'hui</span>
    <span class="guess-streak-next">${data.streakMin} bonnes réponses par jour gardent la série · jeton booster dans ${next} jour${next > 1 ? "s" : ""} de série</span>`;

  const box = document.getElementById("guess-choices");
  box.innerHTML = r.choices.map((c) => {
    const cls = r.done ? (c.cardId === r.answerCardId ? "right" : c.wrong ? "wrong" : "") : c.wrong ? "wrong" : "";
    return `<button type="button" class="guess-choice ${cls}" data-card-id="${c.cardId}" ${r.done || c.wrong ? "disabled" : ""}><span class="gc-letter" aria-hidden="true">${"ABCD"[r.choices.indexOf(c)] || ""}</span><span class="gc-name">${escHtml(c.name)}</span></button>`;
  }).join("") + (r.done ? "" : `<div class="guess-tries">${"&#10084;&#65039;".repeat(r.triesLeft)}${"&#129293;".repeat(3 - r.triesLeft)} <small>${r.triesLeft} essai${r.triesLeft > 1 ? "s" : ""}</small></div>`);
  renderGuessGain(data, r);

  const res = document.getElementById("guess-result");
  const parts = [];
  if (r.done) parts.push(r.correct ? `&#127881; C'était bien <strong>${escHtml(r.answerName)}</strong> !` : `C'était <strong>${escHtml(r.answerName)}</strong>.`);
  if (data.finished) parts.push(`<div class="guess-next">Journée terminée : ${data.found} / ${data.rounds.length}. Nouvelles cartes demain !</div>`);
  else if (r.done) { const n = data.rounds.find((x) => !x.done); if (n) parts.push(`<button type="button" class="btn-secondary" data-guess-round="${n.index}">Carte suivante &rarr;</button>`); }
  if (data.coupons && data.coupons.length) parts.push(`<div class="guess-coupons"><strong>&#127915; Bons de craft (−${data.couponPct} %)</strong> ${data.coupons.map((c) => `<a href="collection.html#crafter" title="Valable jusqu'au ${new Date(c.until * 1000).toLocaleDateString("fr-FR")}">${escHtml(c.name)}</a>`).join(" · ")}</div>`);
  res.style.display = parts.length ? "block" : "none";
  res.className = `guess-result ${r.done ? (r.correct ? "win" : "lose") : ""}`;
  res.innerHTML = parts.join("");
}

// Gain possible de la carte (2026-10-19) : affiche des le debut, il descend
// en direct (compteur anime) a chaque erreur.
let guessGainShown = null;
function renderGuessGain(data, r) {
  const frame = document.getElementById("guess-frame");
  if (!frame || !data.gains) return;
  let el = document.getElementById("guess-gain");
  if (!el) { el = document.createElement("div"); el.id = "guess-gain"; el.className = "guess-gain"; frame.after(el); }
  const g = data.gains;
  const target = r.potential != null ? r.potential : g.base;
  const label = r.done ? (r.correct ? "Gagné" : "Consolation") : "Gain possible";
  const steps = g.mult.map((m, i) => `<span class="gg-step ${!r.done && i === 3 - r.triesLeft ? "on" : ""} ${!r.done && i < 3 - r.triesLeft ? "lost" : ""}">${Math.round(g.base * m)}</span>`).join("");
  const dayLeft = data.rounds.filter((x) => !x.done).reduce((t, x) => t + (x.potential || 0), 0) + data.rounds.filter((x) => x.done).reduce((t, x) => t + (x.potential || 0), 0);
  el.className = `guess-gain ${r.done ? (r.correct ? "won" : "lost") : ""}`;
  el.innerHTML = `<div class="gg-main"><small>${label}</small><strong><span class="gg-num">${guessGainShown != null && guessGainShown.round === r.index ? guessGainShown.value : target}</span> &#10024;</strong></div>
    ${r.done ? "" : `<div class="gg-steps" title="1er essai, 2e essai, 3e essai">${steps}</div>`}
    <div class="gg-day">Aujourd'hui : jusqu'à ${fmtNum(dayLeft + (data.finished ? 0 : g.perfect))} &#10024;${g.finishCoins ? ` + ${g.finishCoins} ${resIcon("coin")}` : ""}${g.perfect ? ` <span title="Toutes les cartes trouvées du premier coup">(dont ${fmtNum(g.perfect)} si journée parfaite)</span>` : ""}</div>`;
  const num = el.querySelector(".gg-num");
  const from = guessGainShown && guessGainShown.round === r.index ? guessGainShown.value : target;
  guessGainShown = { round: r.index, value: target };
  if (from !== target) {
    // Le gain fond sous les yeux du joueur.
    el.classList.add("gg-drop");
    const t0 = performance.now(), dur = 700;
    const step = (now) => { const p = Math.min(1, (now - t0) / dur); num.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); else el.classList.remove("gg-drop"); };
    requestAnimationFrame(step);
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
  if (guessBusy || guessRound == null) return;
  guessBusy = true;
  try {
    const res = await API.post("guessCard", { userId: Session.userId, action: "guess", round: guessRound, cardId });
    renderGuess(res);
    if (typeof loadNavBadges === "function") loadNavBadges();
    const rw = res.reward || {};
    if (res.correct) Toast.success(`Bonne réponse ! +${rw.dust} poussières${rw.boosters ? " et +1 jeton booster" : ""}${rw.coins ? ` et +${rw.coins} ${resIcon("coin")}` : ""}${rw.perfect ? " (journée parfaite !)" : ""}.`);
    else if (res.done && rw.coins) Toast.info(`Journée terminée : +${rw.coins} ${resIcon("coin")} pour ta série.`);
    else if (res.done) Toast.info("Raté pour cette carte.");
    else Toast.info("Ce n'est pas ça : le zoom recule, essaie encore !");
    if (rw.coupon) setTimeout(() => Toast.success(`&#127915; Bon de craft : −${rw.coupon.pct} % sur <strong>${escHtml(rw.coupon.name)}</strong> pendant ${res.couponDays} jours !`), 400);
    if (res.correct && typeof confetti === "function") confetti({ particleCount: rw.perfect ? 200 : 70, spread: 80, origin: { y: 0.5 } });
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error(e.code === "already_played" ? "Carte déjà jouée." : friendlyError(e));
    loadGuess();
  } finally {
    guessBusy = false;
  }
}

// -----------------------------------------------------------------------
// Expedition (expedition.json + expedition2.js) : une carte part 2h / 8h /
// 24h vers une destination, butin tire au retour. Une seule a la fois.
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
  } catch (e) { Toast.error({ already_rerolled: "Déjà fait aujourd'hui.", not_enough_dust: "Pas assez de poussières.", no_expedition: "Aucune expédition en cours." }[e.code] || friendlyError(e)); }
}

async function loadExpeditionLevel() {
  try { const d = await API.expedition(Session.userId, "status"); if (d.expeditionLevel) renderSkillLevel("expe-level", "&#129517;", "Expédition", d.expeditionLevel, expePerkTexts(d.expeditionLevel.perks)); } catch (e) { /* niveau indisponible */ }
}

// Destinations (api/src/native/expedition2.js, 2026-10-18) : chaque lieu
// rapporte des ressources pour les autres jeux ; affinite du jour (rarete +
// extension) qui augmente ce butin.
let expeditionDest = (() => { try { return localStorage.getItem("2gatcha_expe_dest") || ""; } catch (e) { return ""; } })();
const EXPE_MULT = { 2: "×1", 8: "×2,5", 24: "×5" };
const expeRes = (r) => (r.img ? artImg(r.img, "").replace('class="ico-art"', `class="ico-art${r.gold ? " ico-gold" : ""}"`) : "&#127873;");
const expePerTrip = (n) => (n >= 1 ? `${Math.round(n * 10) / 10}` : `${Math.round(n * 100)} %`);
function expeMatch(card, dest) {
  const a = dest?.affinity || {};
  return { rarity: !!(a.rarity && card?.rarity?.key === a.rarity.key), extension: !!(a.extension && card?.extension?.id === a.extension.id) };
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
    const d = ex.destination;
    zone.innerHTML = `
      <div class="expe-active ${ex.ready ? "ready" : ""}">
        <div class="expe-explorer" style="--expe-color:${color}">
          <img src="${API.imageUrl(card?.imageId) || ""}" alt="${escHtml(card?.name || "")}" />
        </div>
        <div class="expe-info">
          <div class="expe-title">${escHtml(card?.name || "Ton explorateur")} est en route${d ? ` : ${d.icon} ${escHtml(d.name)}` : ""}</div>
          <div class="expe-sub">${ex.hours} h d'expédition${d && d.bonus > 1 ? ` · <span class="expe-aff-ok">${d.unique ? "&#127775; " : ""}bonus +${Math.round((d.bonus - 1) * 100)} % de ressources</span>` : ""}</div>
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
  const dests = data.destinations || [];
  if (!dests.some((d) => d.key === expeditionDest && d.unlocked)) expeditionDest = (dests.find((d) => d.unlocked) || {}).key || "";
  const pct = data.affinityPct || 0;
  const bonus = data.rarityBonus || {};
  zone.innerHTML = `
    <div class="expe-setup">
      ${dests.length ? `<div class="expe-label">Destination</div>
      <div class="expe-dests">${dests.map((d) => `
        <button type="button" class="expe-dest ${d.key === expeditionDest ? "active" : ""} ${d.unlocked ? "" : "locked"}" data-dest="${d.key}" ${d.unlocked ? "" : "disabled"}>
          <span class="expe-dest-head"><span class="expe-dest-ico" aria-hidden="true">${d.icon}</span><strong>${escHtml(d.name)}</strong>${d.unlocked ? "" : `<span class="expe-dest-lock">&#128274; niv. ${d.level}</span>`}</span>
          <span class="expe-dest-desc">${escHtml(d.desc)}</span>
          <span class="expe-dest-loot">${d.loot.map((l) => `<span class="expe-loot-chip" title="${escHtml(l.label)} (pour 2 h)">${expeRes(l)} ${expePerTrip(l.perTrip)}</span>`).join("")}</span>
          ${d.affinity && (d.affinity.rarity || d.affinity.extension) ? `<span class="expe-dest-aff">Aujourd'hui : ${d.affinity.rarity ? `<b style="color:${d.affinity.rarity.colorHex || "inherit"}">${escHtml(d.affinity.rarity.name)}</b>` : ""}${d.affinity.rarity && d.affinity.extension ? " · " : ""}${d.affinity.extension ? `<b>${escHtml(d.affinity.extension.name)}</b>` : ""}</span>` : ""}
        </button>`).join("")}</div>` : ""}
      <label class="expe-label" for="expe-card">Explorateur</label>
      <div class="expe-pick">
        <img id="expe-preview" class="expe-preview" src="" alt="" />
        <div class="expe-pick-side">
          <select id="expe-card">${cards.map((c) => `<option value="${c.cardId}">${escHtml(c.name)} — ${escHtml(c.rarity?.name || "Commune")}${c.extension ? ` · ${escHtml(c.extension.name)}` : ""}</option>`).join("")}</select>
          ${dests.length ? `<button type="button" class="btn-ghost expe-best" id="expe-best">&#10024; Meilleur explorateur pour ce lieu</button>` : ""}
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
            ${dests.length ? `<span class="expe-duration-loot">Ressources ${EXPE_MULT[d.hours] || ""}</span>` : ""}
          </button>`).join("")}
      </div>
    </div>`;
  const select = document.getElementById("expe-card");
  const updatePreview = () => {
    const c = cards.find((x) => x.cardId === Number(select.value));
    document.getElementById("expe-preview").src = API.imageUrl(c?.imageId) || "";
    const b = bonus[c?.rarity?.key] || 1;
    const dest = dests.find((d) => d.key === expeditionDest);
    const m = expeMatch(c, dest);
    const lines = [b > 1 ? `Bonus de rareté : +${Math.round((b - 1) * 100)}% de poussières` : "Pas de bonus de rareté"];
    // Carte Unique (2026-10-26, expedition2.js) : poussieres, ressources et chance de booster en plus.
    const ub = data.uniqueBonus;
    if (ub && c?.rarity?.key === "unique") lines.push(`<span class="expe-aff-ok">&#127775; Carte Unique : +${ub.dustPct} % de poussières, +${ub.lootPct} % de ressources${ub.boosterChance ? `, ${ub.boosterChance} % de chance d'un jeton booster en plus` : ""}</span>`);
    if (dest) lines.push(m.rarity || m.extension ? `<span class="expe-aff-ok">&#10004; Affinité ${[m.rarity && "rareté", m.extension && "extension"].filter(Boolean).join(" + ")} : +${pct * (m.rarity + m.extension)} % de ressources</span>` : `<span class="muted">Pas d'affinité avec ce lieu aujourd'hui</span>`);
    document.getElementById("expe-bonus").innerHTML = lines.join("<br>");
  };
  // Meilleur explorateur : rarete et extension du jour, puis la rarete la plus haute.
  const pickBest = () => {
    const dest = dests.find((d) => d.key === expeditionDest);
    const score = (c) => { const m = expeMatch(c, dest); return (m.rarity + m.extension) * 100 - EXPEDITION_RARITY_ORDER.indexOf(c.rarity?.key); };
    const best = [...cards].sort((a, b) => score(b) - score(a))[0];
    if (best) { select.value = String(best.cardId); updatePreview(); }
  };
  select.addEventListener("change", updatePreview);
  document.getElementById("expe-best")?.addEventListener("click", pickBest);
  zone.querySelectorAll(".expe-dest:not([disabled])").forEach((btn) => btn.addEventListener("click", () => {
    expeditionDest = btn.dataset.dest;
    try { localStorage.setItem("2gatcha_expe_dest", expeditionDest); } catch (e) { /* stockage indisponible */ }
    zone.querySelectorAll(".expe-dest").forEach((b) => b.classList.toggle("active", b === btn));
    updatePreview();
  }));
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
    const res = await API.expedition(Session.userId, "start", { hours, cardId, destination: expeditionDest || undefined });
    const d = res.expedition && res.expedition.destination;
    Toast.success(`C'est parti pour ${hours} h d'expédition${d ? ` : ${d.icon} ${escHtml(d.name)}` : ""} !`);
    await renderExpedition(res);
  } catch (e) {
    Toast.error({ already_running: "Une expédition est déjà en cours.", card_not_owned: "Tu ne possèdes plus cette carte.", destination_locked: `Destination débloquée au niveau ${e.data?.level || "?"} d'expédition.`, unknown_destination: "Destination inconnue." }[e.code] || friendlyError(e));
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
    const resList = (r.resources || []).map((x) => `<span class="expe-loot-chip">${expeRes(x)} +${x.n} ${escHtml(x.label)}</span>`).join("");
    const aff = r.affinity && r.affinity.bonus > 1 ? ` <span class="expe-report-bonus">(${r.unique ? "affinité et carte Unique" : "affinité"} +${Math.round((r.affinity.bonus - 1) * 100)} % de ressources)</span>` : "";
    zone.insertAdjacentHTML("afterbegin", `
      <div class="expe-report">
        <div class="expe-report-title">&#129517; ${escHtml(r.explorer?.name || "Ton explorateur")} ${r.destination ? `revient de ${r.destination.icon} ${escHtml(r.destination.name)} : il ` : ""}${r.story} !</div>
        <div class="expe-report-loot">+${r.dust} poussières${r.boosters ? ` · +${r.boosters} jeton${r.boosters > 1 ? "s" : ""} booster` : ""}${r.bonus > 1 ? ` <span class="expe-report-bonus">(bonus rareté +${Math.round((r.bonus - 1) * 100)}%)</span>` : ""}${r.unique ? ` <span class="expe-report-bonus">&#127775; carte Unique : +${r.unique.dust} poussières${r.unique.booster ? " et un jeton booster" : ""}</span>` : ""}</div>
        ${resList ? `<div class="expe-report-res">${resList}${aff}</div>` : ""}
      </div>`);
    Toast.success(`Butin : +${r.dust} poussières${r.boosters ? ` et +${r.boosters} jeton${r.boosters > 1 ? "s" : ""} booster` : ""}${(r.resources || []).length ? ", et des ressources !" : " !"}`);
    if (res.dinoCompanion) setTimeout(() => Toast.info(`&#129430; ${escHtml(res.dinoCompanion.name)} rentre de l'expédition${res.dinoCompanion.hungry ? " affamé : va vite le nourrir !" : ", ravi mais un peu affamé."}`), 700);
    if (res.levelUp) LevelUpModal.show({ icon: "&#129517;", name: "Expédition", level: res.levelUp, perks: expePerkTexts(res.expeditionLevel && res.expeditionLevel.perks) });
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error(e.code === "not_ready" ? "L'expédition n'est pas encore rentrée." : friendlyError(e));
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
  document.getElementById("tab-archeo-btn").addEventListener("click", () => setActiveTab("archeo"));
  document.getElementById("tab-expedition-btn").addEventListener("click", () => setActiveTab("expedition"));
  document.getElementById("tab-fish-btn").addEventListener("click", () => setActiveTab("fish"));
  // Lien de l'en-tete vers la peche alors qu'on est deja sur la page.
  window.addEventListener("hashchange", () => { const t = HASH_TAB[location.hash.slice(1)]; if (t) setActiveTab(t); });
  document.getElementById("tab-garden-btn").addEventListener("click", () => setActiveTab("garden"));
  document.getElementById("tab-walk-btn").addEventListener("click", () => setActiveTab("walk"));
  document.getElementById("tab-cook-btn").addEventListener("click", () => setActiveTab("cook"));
  document.getElementById("tab-dino-btn").addEventListener("click", () => setActiveTab("dino"));
  document.getElementById("garden-plots").addEventListener("click", (e) => {
    const b = e.target.closest("[data-fertilize]");
    if (b) { gardenAction("fertilize", { plot: Number(b.dataset.fertilize), ...(b.dataset.gold ? { gold: true } : {}) }); return; }
    const pl = e.target.closest("[data-plant-plot]");
    if (pl) { gardenAction("plant", { plot: Number(pl.dataset.plantPlot) }); return; }
    // Une parcelle prete : on recolte tout.
    if (e.target.closest(".garden-plot.ready")) gardenAction("harvest");
  });
  document.getElementById("garden-seeds").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seed]");
    if (!b || b.disabled) return;
    gardenSeed = b.dataset.seed;
    try { localStorage.setItem("2gatcha_garden_seed", gardenSeed); } catch (err) { /* stockage indisponible */ }
    renderGarden(gardenState);
  });
  document.getElementById("garden-poop-btn")?.addEventListener("click", () => gardenAction("fertilize"));
  document.getElementById("garden-plant-btn").addEventListener("click", () => gardenAction("plant"));
  document.getElementById("garden-harvest-btn").addEventListener("click", () => gardenAction("harvest"));
  document.getElementById("garden-buyplot-btn").addEventListener("click", () => gardenAction("buyPlot"));
  document.getElementById("fish-extras").addEventListener("click", (e) => { if (e.target.closest("#fish-reroll-btn")) rerollWeather(); });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-prestige]"); if (b) doPrestige(b.dataset.prestige); });
  document.getElementById("fish-cast-btn").addEventListener("click", () => castFishing(1));
  document.getElementById("fish-cat-feed1")?.addEventListener("click", (e) => feedCat(1, e.currentTarget));
  document.getElementById("fish-cat-feedmax")?.addEventListener("click", (e) => feedCat(Number(e.currentTarget.dataset.count) || 1, e.currentTarget));
  document.getElementById("fish-aquarium")?.addEventListener("click", async (e) => {
    const b = e.target.closest("#aq-claim");
    if (!b) return;
    b.disabled = true;
    try {
      const r = await API.aquarium(Session.userId, "claim");
      const c = r.claimed;
      Toast.success(`🐠 Aquarium : ${[c.dust ? `+${c.dust} ✨` : "", c.boosters ? `+${c.boosters} jetons booster` : "", c.chests ? `+${c.chests} coffre` : "", ...(c.titles || []).map((t) => `titre « ${escHtml(t)} »`)].filter(Boolean).join(", ")} !`);
      if (typeof confetti === "function") confetti({ particleCount: 90, spread: 90, origin: { y: 0.5 } });
      renderAquarium(r);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (err) { b.disabled = false; Toast.error(friendlyError(err)); }
  });
  document.getElementById("fish-cast5-btn").addEventListener("click", () => castFishing(5));
  document.getElementById("fish-castall-btn").addEventListener("click", (e) => { const n = Number(e.currentTarget.dataset.count) || 0; if (n > 0) castFishing(n); });
  document.getElementById("fish-extras").addEventListener("change", (e) => { if (e.target.id === "fish-bait" && fishState) renderFishing(fishState); });
  document.getElementById("tab-bingo-btn").addEventListener("click", () => setActiveTab("bingo"));
  document.getElementById("tab-vault-btn").addEventListener("click", () => setActiveTab("vault"));
  document.getElementById("bingo-claim-btn").addEventListener("click", claimBingo);
  document.getElementById("guess-pane").addEventListener("click", (e) => { const rb = e.target.closest("[data-guess-round]"); if (rb && guessData) { guessRound = Number(rb.dataset.guessRound); renderGuess(guessData); } });
  document.getElementById("guess-choices").addEventListener("click", (e) => {
    const btn = e.target.closest(".guess-choice");
    if (btn && !btn.disabled) submitGuess(Number(btn.dataset.cardId));
  });
  document.getElementById("vault-padlocks").addEventListener("click", (e) => { const b = e.target.closest(".vault-padlock.can"); if (b) popPadlock(b); });
  document.getElementById("dig-depths").addEventListener("click", (e) => { const b = e.target.closest(".dig-depth:not([disabled])"); if (b) setDigDepth(Number(b.dataset.depth)); });
  // Achat depuis un bandeau de la boutique : la partie concernee se rafraichit.
  document.addEventListener("shop:bought", (e) => {
    const k = e.detail && e.detail.key;
    if (k === "coffee" || k === "bone") loadDig();
    else if (k === "worms10" || k === "bait" || k === "thermos") loadFishing();
    else if (k === "fertilizer") loadGarden();
    else if (k === "compass") loadExpedition();
  });
  document.getElementById("dig-shop").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-shop-buy]");
    if (!b || window.ShopStrip) return;
    b.disabled = true;
    try { await API.shop(Session.userId, "buy", b.dataset.shopBuy); Toast.success("&#128722; Acheté !"); if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); await loadDig(); renderDigShop(); }
    catch (err) { b.disabled = false; Toast.error({ energy_full: "Ton énergie de fouille est déjà pleine.", weekly_cap: "Limite de la semaine atteinte.", not_enough_dust: "Pas assez de poussières." }[err.code] || friendlyError(err)); }
  });
  document.getElementById("dig-use-bone-btn").addEventListener("click", (e) => kennelAction("use", e.currentTarget));
  document.getElementById("dig-frenzy-btn").addEventListener("click", (e) => dogFrenzy(e.currentTarget));
  // Onglet Coffre-fort cache tant que le joueur n'a jamais eu de clef : les
  // clefs et leurs usages se decouvrent en explorant, pas dans un menu.
  const initial = getInitialTab();
  setActiveTab(initial === "vault" || initial === "dino" ? "dig" : initial);
  API.dino(Session.userId).then((res) => {
    if (!res.unlocked) return;
    document.getElementById("tab-dino-btn").style.display = "";
    if (initial === "dino") setActiveTab("dino");
  }).catch(() => {});
  API.getVaultStatus(Session.userId).then((res) => {
    if ((res.userKeys || 0) > 0 || res.alreadyOpened) {
      document.getElementById("tab-vault-btn").style.display = "";
      if (initial === "vault") setActiveTab("vault");
    }
  }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Le parchemin (2026-10-19, api/src/native/forbidden.js) : une prise de peche
// rare. Il se deroule dans une cinematique ; ses enigmes ne viennent que du
// serveur (et seulement pour qui l'a peche). On peut le relire depuis la peche.
// ---------------------------------------------------------------------------
function renderScrollBtn(st) {
  const host = document.querySelector(".fish-controls");
  if (!host) return;
  let b = document.getElementById("fish-scroll-btn");
  if (!st.hasScroll) { if (b) b.remove(); return; }
  if (b) return;
  b = document.createElement("button");
  b.type = "button";
  b.id = "fish-scroll-btn";
  b.className = "btn-ghost fish-scroll-btn";
  b.innerHTML = "&#128220; Le parchemin";
  b.title = "Relire le parchemin repêché";
  b.addEventListener("click", () => ScrollFx.open(false));
  host.appendChild(b);
}
const ScrollFx = {
  async open(fresh) {
    let data;
    try { data = await API.post("forbidden", { userId: Session.userId, action: "scroll" }); } catch (e) { return; }
    const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ov = document.createElement("div");
    ov.className = "scroll-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Le parchemin");
    ov.innerHTML = `
      ${fresh ? '<p class="scroll-catch">Ta ligne remonte… un parchemin détrempé, scellé de cire.</p>' : ""}
      <div class="scroll-paper">
        <div class="scroll-rod top" aria-hidden="true"></div>
        <div class="scroll-body">
          <span class="scroll-seal" aria-hidden="true">&#9881;&#65039;</span>
          <h2 class="scroll-title">${escHtml(data.title)}</h2>
          <ol class="scroll-riddles">${data.riddles.map((r, i) => `<li style="--d:${i}" class="${r.found ? "found" : ""}"><b>${r.roman}</b><span>${escHtml(r.text)}</span></li>`).join("")}</ol>
          <p class="scroll-outro">${escHtml(data.outro)}</p>
          <button type="button" class="btn scroll-close">Rouler le parchemin</button>
        </div>
        <div class="scroll-rod bottom" aria-hidden="true"></div>
      </div>`;
    document.body.appendChild(ov);
    if (typeof syncScrollLock === "function") syncScrollLock();
    if (typeof Sfx !== "undefined" && Sfx._tone) for (let i = 0; i < 6; i++) Sfx._tone(1800 + Math.random() * 900, i * 0.07, 0.04, "triangle", 0.012);
    if (typeof Haptics !== "undefined") Haptics.buzz([20, 40, 20]);
    requestAnimationFrame(() => ov.classList.add(reduced ? "open no-anim" : "open"));
    const close = () => {
      document.removeEventListener("keydown", onKey);
      ov.classList.add("closing");
      setTimeout(() => { ov.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); }, reduced ? 50 : 450);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    ov.querySelector(".scroll-close").addEventListener("click", close);
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    setTimeout(() => ov.querySelector(".scroll-close").focus({ preventScroll: true }), reduced ? 0 : 1800);
    if (fresh) setTimeout(() => { const b = document.getElementById("fish-scroll-btn"); if (!b && fishState) renderScrollBtn({ hasScroll: true }); }, 500);
  }
};

// Retour sur l'onglet (2026-10-21) : apres plus de 30 s ailleurs, ou si un
// point d'energie est arrive pendant ce temps, l'energie de fouille et de
// peche est relue tout de suite (les minuteries de l'onglet cache ont pu
// etre espacees par le navigateur).
const EnergySync = {
  hiddenAt: 0,
  init() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { this.hiddenAt = Date.now(); return; }
      const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
      const due = (digDeadline && Date.now() >= digDeadline) || (fishDeadline && Date.now() >= fishDeadline);
      if (away < 30000 && !due) return;
      if (API.invalidate) API.invalidate();
      if (digDeadline || away >= 30000) loadDig();
      if (typeof fishState !== "undefined" && fishState && !fishBusy) loadFishing();
    });
  }
};
EnergySync.init();
