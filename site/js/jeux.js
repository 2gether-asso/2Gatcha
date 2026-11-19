// Logique de la page Jeux : fouille, devine la carte, expedition, bingo de
// collection et coffre-fort.


// Memorise le dernier onglet visite (QoL 2026-09-30) : revenir sur "Jeux"
// rouvrait toujours "Fouille" par defaut, meme si on passait le plus clair
// de son temps sur "Coffre-fort".
const LAST_TAB_KEY = "2gatcha_last_tab_jeux";
// Ancre d'URL de chaque onglet (2026-10-05) : jeux.html#peche, #jardin...
const TAB_HASH = { village: "village", dig: "fouille", archeo: "archeologie", guess: "devine", expedition: "expedition", fish: "peche", garden: "jardin", walk: "promenade", cook: "cuisine", dino: "dinos", bingo: "bingo", vault: "coffre-fort" };
const HASH_TAB = Object.fromEntries(Object.entries(TAB_HASH).map(([k, v]) => [v, k]));
function getInitialTab() {
  const fromHash = HASH_TAB[location.hash.slice(1)];
  if (fromHash) return fromHash;
  // Jeux V2 (2026-11-15) : sans ancre, on arrive au village.
  return "village";
}

// Script d'un jeu pas charge (reseau coupe, mise a jour en cours) : on le
// dit au joueur au lieu de planter (GlitchTip #102 « loadFishing is not defined »).
function runLoader(name) {
  const f = window[name];
  if (typeof f === "function") return f();
  if (typeof Toast !== "undefined") Toast.info("Ce jeu n'a pas fini de charger : recharge la page.");
}

function setActiveTab(tab) {
  ["village", "dig", "archeo", "guess", "expedition", "fish", "garden", "walk", "cook", "dino", "bingo", "vault"].forEach((key) => {
    document.getElementById(`tab-${key}-btn`).classList.toggle("active", tab === key);
    document.getElementById(`tab-${key}-btn`).setAttribute("aria-selected", String(tab === key));
    document.getElementById(`${key}-pane`).style.display = tab === key ? "block" : "none";
  });
  try { localStorage.setItem(LAST_TAB_KEY, tab); } catch (e) {}
  // Jeux V2 : un jeu ouvert passe en plein ecran sur telephone (css/village.css).
  document.body.classList.toggle("jeux-in-game", tab !== "village");
  document.body.dataset.jeuxTab = tab;
  if (window.Village && Village.markLeads) requestAnimationFrame(Village.markLeads);
  if (TAB_HASH[tab] && location.hash !== "#" + TAB_HASH[tab]) history.replaceState(null, "", "#" + TAB_HASH[tab]);
  if (tab === "village" && window.Village) Village.load();
  if (tab === "garden") runLoader("loadGarden");
  if (tab === "walk" && window.Companions) Companions.loadWalk();
  if (tab === "cook" && window.Companions) Companions.loadCook();
  if (tab === "dino" && window.loadDinos) window.loadDinos();
  if (tab === "dig") runLoader("loadDig");
  if (tab === "archeo" && window.loadArcheo) window.loadArcheo();
  if (tab === "guess") runLoader("loadGuess");
  if (tab === "expedition") runLoader("loadExpedition");
  if (tab === "fish") runLoader("loadFishing");
  if (tab === "bingo") { const f = window.loadBingoFull || window.loadBingo; if (f) f(); }
  if (tab === "vault") runLoader("loadVault");
}

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

// Visuels peints (site/assets, 2026-10-17). Les noms de fichiers sont sensibles
// a la casse sur le serveur : garder l'extension exacte (.PNG / .png).
const artImg = (file, alt = "") => `<img class="ico-art" src="assets/${encodeURI(file)}" alt="${alt}" loading="lazy" decoding="async">`;
