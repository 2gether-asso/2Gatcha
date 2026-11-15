// Jeux : jardin (parcelles, graines, engrais, recolte).
// Decoupage de jeux.js (Jeux V2, 2026-11-15) : scripts classiques charges
// dans l'ordre par jeux.html ; leurs declarations restent partagees entre fichiers.

// -----------------------------------------------------------------------
// Jardin (api/src/native/garden.js) : 4 parcelles, vers et appats dores.
// -----------------------------------------------------------------------
let gardenTimer = null;
let gardenSeed = (() => { try { return localStorage.getItem("2gatcha_garden_seed") || "mix"; } catch (e) { return "mix"; } })();
let gardenState = null;
// Refonte du 26 octobre : sachets de graines, champ (ciel jour / nuit,
// cloture, tournesols, abeilles, epouvantail), sillons, anneau de pousse,
// plantation parcelle par parcelle, « caca partout », gains qui s'envolent.
const SEED_ICONS = { mix: "&#127793;", worm: resIcon("worm"), bait: resIcon("bait"), dust: "&#127776;", catnip: "&#127807;", bone: "&#129460;", mushroom: "&#127812;", veggie: "&#129388;", honey: "&#127855;", tropical: "&#129389;" };
// Culture prete : selon la graine (melange : legume different selon la parcelle).
const CROP_ART = { worm: "Jardin/Champi.PNG", bait: "Jardin/Blé.png", dust: "Jardin/Gingembre.PNG" };
const CROP_EMOJI = { catnip: "&#127807;", bone: "&#129460;", mushroom: "&#127812;", veggie: "&#129388;", tropical: "&#129389;", honey: "&#127855;" };
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
    const bits = [it.worms && `+${it.worms} ${resIcon("worm")}`, it.bait && `+${it.bait} ${resIcon("bait")}`, it.dust && `+${it.dust} &#10024;`, it.catFish && `+${it.catFish} &#128031;`, it.bones && `+${it.bones} &#129460;`, it.skulls && `+${it.skulls} &#128128;`, it.parts && `+${it.parts} &#128297;`, it.veg && `+${it.veg} &#129388;`, it.herb && `+${it.herb} &#127807;`, it.mush && `+${it.mush} &#127812;`, it.fruit && `+${it.fruit} &#129389;`, it.honey && `+${it.honey} &#127855;`, it.grubs && `+${it.grubs} &#128027;`].filter(Boolean);
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
      const parts = [g.worms && `+${g.worms} vers`, g.bait && `+${g.bait} appât${g.bait > 1 ? "s" : ""} doré${g.bait > 1 ? "s" : ""}`, g.dust && `+${g.dust} &#10024;`, g.catFish && `+${g.catFish} poisson${g.catFish > 1 ? "s" : ""} pour Moka`, g.bones && `+${g.bones} os pour Milo`, g.skulls && `+${g.skulls} crâne de dino`, g.parts && `+${g.parts} pièce${g.parts > 1 ? "s" : ""} détachée${g.parts > 1 ? "s" : ""}`, g.fruit && `+${g.fruit} fruit${g.fruit > 1 ? "s" : ""} exotique${g.fruit > 1 ? "s" : ""}`, g.honey && `+${g.honey} pot${g.honey > 1 ? "s" : ""} de miel`, g.veg && `+${g.veg} légume${g.veg > 1 ? "s" : ""}`, g.herb && `+${g.herb} herbe${g.herb > 1 ? "s" : ""}`, g.mush && `+${g.mush} champignon${g.mush > 1 ? "s" : ""}`, g.grubs && PetText.mask(`+${g.grubs} ver${g.grubs > 1 ? "s" : ""} blanc${g.grubs > 1 ? "s" : ""} pour Pistache`)].filter(Boolean);
      Toast.success(`&#129530; Récolte : ${parts.join(", ") || "rien cette fois"} !`);
      if ((g.bait || g.skulls) && typeof confetti === "function") confetti({ particleCount: 80, spread: 80, origin: { y: 0.6 } });
      if (res.levelUp) LevelUpModal.show({ icon: "&#127793;", name: "Jardin", level: res.levelUp, perks: gardenPerkTexts(res.level && res.level.perks) });
    }
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    // Noisette (ou un autre onglet) a deja tout recolte : le jardin se recale (GlitchTip #32).
    if (e.code === "nothing_ready" && e.data && e.data.plots) {
      renderGarden(e.data);
      Toast.info(e.data.bunny && e.data.bunny.secondsLeft > 0 ? "&#128007; Noisette est passée avant toi : regarde son rapport." : "Rien n'est prêt : le jardin est à jour.");
      return;
    }
    Toast.error({ not_enough_dust: "Pas assez de poussières.", nothing_ready: "Rien n'est prêt.", no_free_plot: "Toutes les parcelles sont occupées.", max_plots: "Ton jardin est déjà au maximum.", no_fertilizer: "Plus d'engrais : ramasse les cacas de tes dinos.", nothing_to_fertilize: "Aucune parcelle en train de pousser sans engrais.", seed_locked: `Cette graine se débloque au niveau ${e.data && e.data.level} de jardinage.` }[e.code] || friendlyError(e));
  }
}
