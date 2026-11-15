// Jeux : peche, meteo, Moka le chat, aquarium.
// Decoupage de jeux.js (Jeux V2, 2026-11-15) : scripts classiques charges
// dans l'ordre par jeux.html ; leurs declarations restent partagees entre fichiers.

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
// Peche (api/src/native/fishing.js) : chaque lancer coute des poussieres et
// ramene une prise tiree dans une table ponderee (reglable dans l'admin).
// -----------------------------------------------------------------------
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
