// Jeux : expedition.
// Decoupage de jeux.js (Jeux V2, 2026-11-15) : scripts classiques charges
// dans l'ordre par jeux.html ; leurs declarations restent partagees entre fichiers.

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
