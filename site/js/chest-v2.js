// Coffres V2 (2026-11-16, api/src/native/chests.js) sur la page d'ouverture :
//  - bac par palier ET famille, choix de la cle (ordinaire jusqu'au palier
//    ChestOrdinaryKeyMaxTier, cle d'or, cle speciale), « tout ouvrir » ;
//  - pieces de couleur (la boule tombe dans la famille choisie) ;
//  - serrurier : fabrication des trois cles ;
//  - collection : 5 familles x 8 paliers, premiere ouverture recompensee ;
//  - scene d'ouverture : le coffre tremble selon son palier, la cle tourne,
//    les objets sortent un par un (le meilleur en dernier), bilan ; plusieurs
//    coffres : ouverture en cascade.
// Remplace le bac d'opening.js (renderChests est enveloppe) ; la machine,
// l'achat et les pieces ordinaires restent ceux d'opening.js.
(function () {
  if (typeof renderChests !== "function") return;
  const esc = escHtml;
  const RANK = { commune: 0, rare: 1, epique: 2, legendaire: 3, mythique: 4, unique: 5 };
  const FIN = { holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const KEY = { key: { icon: "🔑", label: "clé ordinaire" }, gold: { icon: GOLD_KEY, label: "clé d'or" }, room: { icon: resIcon("skey", "clé spéciale"), label: "clé spéciale" } };
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 60) : ms));
  const ERR = { key_too_weak: "Ce coffre est trop précieux pour une clé ordinaire : il faut une clé d'or (ou une clé spéciale).", missing_ingredients: "Il te manque des ingrédients pour cette clé.", unknown_key: "Clé inconnue." };
  let busy = false;
  const st = () => chestState;

  // ------------------------------------------------------------ panneau
  const base = renderChests;
  renderChests = function () {
    base();
    const s = st();
    if (!s || !s.groups) return;
    renderTray(s);
    renderExtras(s);
  };

  function keyButtons(g, s) {
    const btn = (kt, n) => {
      const have = kt === "key" ? s.keys : kt === "gold" ? s.goldKeys : s.roomKeys;
      if (kt === "room" && !s.room) return "";
      if (kt === "key" && !g.ordinary) return "";
      if (kt !== "key" && have < 1) return "";
      const c = Math.min(n, have, g.n, CHEST_MAX_BATCH);
      return `<button type="button" class="${kt === "key" ? "btn" : "btn-secondary"} cv2-open" data-cv2-open data-tier="${g.tier}" data-family="${g.family}" data-key="${kt}" data-n="${c}" ${have < 1 ? "disabled" : ""} title="Avec une ${KEY[kt].label}">${KEY[kt].icon} ${kt === "key" ? (c > 1 ? `Ouvrir ×${c}` : "Ouvrir") : kt === "gold" ? "Clé d'or" : "Clé spéciale"}</button>`;
    };
    return `${btn("key", 1)}${g.n > 1 ? btn("key", g.n) : ""}${btn("gold", 1)}${btn("room", 1)}${!g.ordinary && s.goldKeys < 1 && !(s.room && s.roomKeys) ? `<small class="cv2-need">${GOLD_KEY} Il faut une clé d'or (serrurier ci-dessous)</small>` : ""}`;
  }
  function renderTray(s) {
    const tray = document.getElementById("gatcha-tray");
    if (!tray) return;
    const ordinaryAll = s.groups.filter((g) => g.ordinary).reduce((n, g) => n + g.n, 0);
    tray.innerHTML = s.groups.length
      ? `<h3>Tes boules <small>${s.balls} coffre${s.balls > 1 ? "s" : ""} à ouvrir</small></h3>
        <div class="cv2-keys"><span title="Coffres jusqu'au palier ${s.ordinaryMax}">🔑 <b>${s.keys}</b> ordinaire${s.keys > 1 ? "s" : ""}</span><span title="Tout palier, bonus tirés deux fois">${GOLD_KEY} <b>${s.goldKeys}</b> d'or</span>${s.room ? `<span title="Clé spéciale de la forge : gros butin, finitions spéciales assurées">${resIcon("skey")} <b>${s.roomKeys}</b> spéciale${s.roomKeys > 1 ? "s" : ""}</span>` : ""}</div>
        ${s.balls > 1 ? `<div class="cv2-all"><button type="button" class="btn gatcha-open-all" data-cv2-all ${!(s.keys && ordinaryAll) && !s.goldKeys ? "disabled" : ""}>Ouvrir tous les coffres</button>${s.goldKeys ? `<label class="cv2-gold-toggle"><input type="checkbox" id="cv2-all-gold" /> utiliser aussi mes clés d'or sur les gros coffres</label>` : ""}</div>` : ""}
        <div class="gatcha-tray-grid">${s.groups.map((g) => {
          const t = (s.tiers || []).find((x) => x.tier === g.tier) || {};
          const fam = s.families.find((f) => f.key === g.family);
          return `<div class="gatcha-tier cv2-tier" style="--c:${fam ? fam.color : t.color};--tc:${t.color}">
            <span class="cv2-fam" title="${esc(fam ? fam.desc : "Coffre d'avant les familles : butin classique")}">${g.familyIcon} ${esc(g.familyLabel)}</span>
            <img src="${CHEST_ART(g.tier)}" alt="" />
            <strong>${esc(t.name || "Coffre")}</strong><small>×${g.n} · palier ${g.tier} · butin ×${t.mult}</small>
            <div class="cv2-btns">${keyButtons(g, s)}</div>
          </div>`;
        }).join("")}</div>`
      : `<p class="gatcha-empty">Ton bac est vide : glisse une pièce pour faire tomber une boule.</p>`;
  }

  function renderExtras(s) {
    const side = document.querySelector("#chest-panel .gatcha-side");
    if (!side) return;
    let box = document.getElementById("cv2-extras");
    if (!box) {
      box = document.createElement("div");
      box.id = "cv2-extras";
      document.getElementById("chest-panel").appendChild(box);
      box.addEventListener("click", onExtrasClick);
    }
    const coins = s.families.filter((f) => f.coins > 0);
    const col = s.collection;
    const T = (s.tiers || []).length || 8;
    box.innerHTML = `
      ${coins.length ? `<section class="cv2-coins"><h3>🪙 Pièces de couleur <small>la boule tombe dans la famille de la pièce</small></h3>
        <div class="cv2-coin-row">${coins.map((f) => `<button type="button" class="cv2-coin" style="--c:${f.color}" data-cv2-spin="${f.key}" title="${esc(f.desc)}"><span>${f.icon}</span><b>${esc(f.label)}</b><small>×${f.coins}</small></button>`).join("")}</div></section>` : ""}
      <details class="cv2-panel cv2-families"><summary>🎁 Les familles de coffres</summary>
        <p class="cv2-help">Chaque boule a un <strong>palier</strong> (du bois au mystique : la taille du butin) et une <strong>famille</strong> (ce qu'il y a dedans). La machine tire la famille au hasard ; une pièce de couleur la choisit.</p>
        <ul class="cv2-fam-list">${s.families.map((f) => `<li style="--c:${f.color}"><span>${f.icon}</span><div><b>${esc(f.label)}</b><small>${esc(f.desc)}</small></div></li>`).join("")}</ul>
        <p class="cv2-help">Pièces de couleur : Comptoir des maîtres (carnet des métiers), légendes de la semaine, expéditions de 8 h et plus (Explorateur), pourboires de la cuisine (Nature). Boules directes : coffres enfouis de la fouille profonde, boss de la communauté. Pièces ordinaires : boutique, pêche, niveaux, pass de saison, coffre-fort (tous les 10 niveaux).</p>
      </details>
      <details class="cv2-panel cv2-smith" open><summary>🛠️ Le serrurier</summary>
        <p class="cv2-help">Une <strong>clé ordinaire</strong> ouvre les coffres jusqu'au palier ${s.ordinaryMax} (les boules d'avant les familles : tous). Au-dessus, il faut une <strong>clé d'or</strong> (bonus tirés deux fois, finitions ×1,5)${s.room ? " ou une <strong>clé spéciale</strong>, celle de la forge (butin ×3, 3 jetons booster, 2 cartes assurées, finitions spéciales, 4 minéraux précieux, 60 jetons de la salle)" : ""}.</p>
        <div class="cv2-recipes">${s.recipes.map((r) => `<div class="cv2-recipe ${r.can ? "can" : ""}">
          <header><span>${r.kind === "gold" ? GOLD_KEY : r.kind === "room" ? resIcon("skey") : r.icon}</span><b>${esc(r.label)}</b></header>
          <ul>${r.need.map((n) => `<li class="${n.have >= n.n ? "ok" : "no"}">${esc(n.label)} <small>(${fmtNum(n.have)})</small></li>`).join("")}</ul>
          <div class="cv2-recipe-btns"><button type="button" class="btn${r.can ? "" : "-secondary"}" data-cv2-craft="${r.kind}" data-n="1" ${r.can ? "" : "disabled"}>Fabriquer</button>${r.max > 1 ? `<button type="button" class="btn-ghost" data-cv2-craft="${r.kind}" data-n="${Math.min(10, r.max)}">×${Math.min(10, r.max)}</button>` : ""}</div>
        </div>`).join("")}</div>
      </details>
      <details class="cv2-panel cv2-collection" id="coffres-collection"><summary>📚 Collection de coffres <small>${col.seen}/${col.total}</small></summary>
        <p class="cv2-help">Chaque coffre d'une famille et d'un palier ouvert pour la première fois rapporte ${col.firstDust} ✨ × son palier. Les ${col.total} : titre « Maître des coffres ».</p>
        <div class="cv2-grid" style="--cols:${T}">
          <span></span>${Array.from({ length: T }, (_, i) => `<span class="cv2-gh"><img src="${CHEST_ART(i + 1)}" alt="Palier ${i + 1}" title="${esc((s.tiers[i] || {}).name || "")}" /></span>`).join("")}
          ${s.families.map((f) => `<span class="cv2-gl" style="--c:${f.color}">${f.icon} ${esc(f.label)}</span>${Array.from({ length: T }, (_, i) => { const n = col.log[`${f.key}:${i + 1}`] || 0; return `<span class="cv2-cell ${n ? "on" : ""}" style="--c:${f.color}" title="${esc(f.label)} · ${esc((s.tiers[i] || {}).name || "")} : ${n ? `ouvert ${n} fois` : "jamais ouvert"}">${n ? (n > 99 ? "99+" : n) : ""}</span>`; }).join("")}`).join("")}
        </div>
      </details>`;
  }

  async function onExtrasClick(e) {
    const craft = e.target.closest("[data-cv2-craft]");
    if (craft && !busy) {
      busy = true; craft.disabled = true;
      try {
        chestState = await API.post("chests", { userId: Session.userId, action: "craftKey", kind: craft.dataset.cv2Craft, count: Number(craft.dataset.n) || 1 });
        const c = chestState.crafted;
        Toast.success(`🛠️ Le serrurier te remet ${c.n > 1 ? c.n + " × " : ""}${craft.dataset.cv2Craft === "gold" ? GOLD_KEY : craft.dataset.cv2Craft === "room" ? resIcon("skey") : c.icon} ${esc(c.label)} !`);
        if (typeof Sfx !== "undefined" && Sfx._tone) { Sfx._tone(880, 0, 0.08, "square", 0.03); Sfx._tone(1320, 0.1, 0.12, "triangle", 0.04); }
        renderChests();
      } catch (err) { Toast.error(ERR[err.code] || friendlyError(err)); craft.disabled = false; } finally { busy = false; }
      return;
    }
    const spin = e.target.closest("[data-cv2-spin]");
    if (spin && !busy) {
      busy = true;
      try {
        chestState = await API.post("chests", { userId: Session.userId, action: "spin", family: spin.dataset.cv2Spin });
        const d = chestState.drawn[0];
        Toast.success(`🪙 ${d.familyIcon} ${esc(d.name)} (${esc(d.familyLabel)}) tombe dans le bac !`);
        renderChests();
      } catch (err) { Toast.error(CHEST_ERRORS[err.code] || friendlyError(err)); } finally { busy = false; }
    }
  }

  document.addEventListener("click", (e) => {
    const o = e.target.closest("[data-cv2-open]");
    if (o) { e.stopPropagation(); scene({ tier: Number(o.dataset.tier), family: o.dataset.family, keyType: o.dataset.key, count: Number(o.dataset.n) || 1 }); return; }
    if (e.target.closest("[data-cv2-all]")) { const g = document.getElementById("cv2-all-gold"); scene({ all: true, gold: !!(g && g.checked) }); }
  }, true);

  // ------------------------------------------------------------ scene d'ouverture
  function overlay() {
    let ov = document.getElementById("cv2-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "cv2-overlay";
      ov.className = "cv2-overlay";
      ov.setAttribute("role", "dialog");
      ov.setAttribute("aria-modal", "true");
      ov.setAttribute("aria-label", "Ouverture de coffre");
      document.body.appendChild(ov);
    }
    ov.hidden = false;
    if (typeof syncScrollLock === "function") syncScrollLock(); else document.body.style.overflow = "hidden";
    return ov;
  }
  function closeScene() {
    const ov = document.getElementById("cv2-overlay");
    if (ov) { ov.hidden = true; ov.innerHTML = ""; }
    if (typeof syncScrollLock === "function") syncScrollLock(); else document.body.style.overflow = "";
    renderChests();
  }
  const itemScore = (it) => (it.type === "card" ? 100 + (RANK[it.card.rarity?.key] ?? 0) * 10 + (it.card.finish && it.card.finish !== "normal" ? 5 : 0) : it.type === "booster" ? 50 : it.type === "dust" ? 1 : 10);
  function itemHtml(it, i) {
    if (it.type === "card") {
      const c = it.card;
      const isNew = typeof ownedCountMap !== "undefined" && !(ownedCountMap.get(c.cardId) > 0);
      return `<div class="cv2-item card r-${esc(c.rarity?.key || "commune")}" style="--rc:${esc(c.rarity?.colorHex || "#9aa0b4")};--i:${i}">
        ${c.imageId ? `<img src="${API.imageUrl(c.imageId)}" alt="" />` : `<span class="cv2-ph">🃏</span>`}
        <b>${esc(c.name)}</b><small>${esc(c.rarity?.name || "")}${c.finish && c.finish !== "normal" ? ` · ${FIN[c.finish] || c.finish}` : ""}${c.serialNumber ? ` · #${String(c.serialNumber).padStart(3, "0")}` : ""}</small>
        ${isNew ? '<em class="cv2-new">NOUVELLE</em>' : ""}${c.isFirstEver ? '<em class="cv2-first">1re du serveur</em>' : ""}
      </div>`;
    }
    const ico = it.type === "dust" ? "✨" : it.type === "booster" ? "🃏" : it.img ? `<img class="cv2-res-img" src="assets/${encodeURI(it.img)}" alt="" />` : esc(it.icon || "🎁");
    const label = it.type === "dust" ? `+${fmtNum(it.amount)} poussières` : it.type === "booster" ? `+${it.count} jeton${it.count > 1 ? "s" : ""} booster` : esc(it.label);
    return `<div class="cv2-item res ${it.type}" style="--i:${i}"><span class="cv2-res-ico">${ico}</span><b>${label}</b></div>`;
  }

  async function scene(opts) {
    if (busy || !st()) return;
    const s = st();
    const g = opts.all ? null : s.groups.find((x) => x.tier === opts.tier && x.family === opts.family);
    const t = g ? (s.tiers || []).find((x) => x.tier === g.tier) : (s.tiers || [])[Math.max(0, Math.max(...s.groups.map((x) => x.tier)) - 1)];
    const fam = g ? s.families.find((f) => f.key === g.family) : null;
    const color = (fam && fam.color) || (t && t.color) || "#f59e0b";
    const many = opts.all || opts.count > 1;
    const ov = overlay();
    ov.style.setProperty("--c", color);
    ov.style.setProperty("--tc", (t && t.color) || color);
    const tier = g ? g.tier : t ? t.tier : 1;
    ov.innerHTML = `
      <button type="button" class="card-modal-close cv2-close" aria-label="Fermer">&times;</button>
      <div class="cv2-stage">
        <div class="cv2-title">${g ? `${g.familyIcon} ${esc(g.familyLabel)} · ` : ""}${opts.all ? "Tous tes coffres" : esc(t ? t.name : "Coffre")}${many && !opts.all ? ` ×${opts.count}` : ""}</div>
        <button type="button" class="cv2-chest shake-${Math.min(8, tier)}" id="cv2-chest" aria-label="Tourner la clé">
          <span class="cv2-glow" aria-hidden="true"></span>
          <img src="${CHEST_ART(tier)}" alt="" />
          <span class="cv2-key" aria-hidden="true">${KEY[opts.keyType || "key"].icon}</span>
        </button>
        <p class="cv2-hint" id="cv2-hint">Tape sur le coffre pour tourner la clé</p>
        <div class="cv2-cascade" id="cv2-cascade" hidden></div>
        <div class="cv2-items" id="cv2-items"></div>
        <div class="cv2-bilan" id="cv2-bilan" hidden></div>
      </div>`;
    ov.querySelector(".cv2-close").onclick = () => { if (!busy) closeScene(); };
    const chest = document.getElementById("cv2-chest");
    await new Promise((resolve) => { chest.onclick = resolve; if (reduced()) resolve(); });
    chest.onclick = null;
    busy = true;
    try {
      chest.classList.add("turning");
      if (typeof Sfx !== "undefined" && Sfx._tone) { Sfx._tone(220, 0, 0.08, "square", 0.03); Sfx._tone(330, 0.25, 0.08, "square", 0.03); }
      const body = opts.all ? { userId: Session.userId, action: "open", all: true, ...(opts.gold ? { gold: true } : {}) } : { userId: Session.userId, action: "open", tier: opts.tier, family: opts.family, keyType: opts.keyType, count: opts.count };
      const [res] = await Promise.all([API.post("chests", body), sleep(700)]);
      chestState = res;
      // Le coffre tremble plus fort quand il cache une belle carte (indice, jamais la rarete).
      const best = (res.items || []).filter((x) => x.type === "card").reduce((m, x) => Math.max(m, RANK[x.card.rarity?.key] ?? 0), 0);
      chest.classList.toggle("resist", best >= 2);
      await sleep(best >= 2 ? 1100 : 500);
      chest.classList.add("open");
      document.getElementById("cv2-hint").textContent = "";
      if (typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal(best >= 3 ? "legendaire" : best >= 2 ? "epique" : "rare");
      // Cascade : les coffres ouverts s'enchainent.
      if ((res.openedTiers || []).length && res.opened > 1) {
        const cas = document.getElementById("cv2-cascade");
        cas.hidden = false;
        cas.innerHTML = res.openedTiers.map((x, i) => `<span class="cv2-mini" style="--i:${i};--c:${x.color}"><img src="${CHEST_ART(x.tier)}" alt="" /><b>${x.familyIcon}${x.opened > 1 ? ` ×${x.opened}` : ""}</b></span>`).join("");
        await sleep(Math.min(1600, 160 * res.openedTiers.length + 400));
      }
      await sleep(350);
      chest.classList.add("gone");
      // Les objets sortent un par un, le meilleur en dernier.
      const items = [...(res.items || [])].sort((a, b) => itemScore(a) - itemScore(b));
      const box = document.getElementById("cv2-items");
      for (let i = 0; i < items.length; i++) {
        const last = i === items.length - 1;
        const big = last && items[i].type === "card" && (RANK[items[i].card.rarity?.key] ?? 0) >= 2;
        if (big) { box.classList.add("suspense"); await sleep(900); box.classList.remove("suspense"); }
        box.insertAdjacentHTML("beforeend", itemHtml(items[i], i));
        const el = box.lastElementChild;
        if (big) { el.classList.add("spot"); if (typeof confetti === "function") confetti({ particleCount: 120, spread: 90, origin: { y: 0.45 }, colors: [items[i].card.rarity?.colorHex || color, "#ffffff", "#fde68a"] }); }
        if (items[i].type === "card" && typeof ownedCountMap !== "undefined") ownedCountMap.set(items[i].card.cardId, (ownedCountMap.get(items[i].card.cardId) || 0) + 1);
        if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(523 + i * 40, 0, 0.06, "triangle", 0.025);
        await sleep(items.length > 12 ? 120 : 300);
      }
      renderBilan(res, opts);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      if (typeof boosterCount !== "undefined" && res.newBoosterCount != null) { boosterCount = res.newBoosterCount; if (typeof renderBoosterCountLabel === "function") renderBoosterCountLabel(); }
    } catch (err) {
      Toast.error(ERR[err.code] || CHEST_ERRORS[err.code] || friendlyError(err));
      busy = false;
      closeScene();
      return;
    }
    busy = false;
  }

  function renderBilan(res, opts) {
    const b = document.getElementById("cv2-bilan");
    const s = st();
    const again = !opts.all && s.groups.find((x) => x.tier === opts.tier && x.family === opts.family);
    const keysLeft = opts.keyType === "gold" ? s.goldKeys : opts.keyType === "room" ? s.roomKeys : s.keys;
    const used = res.keysUsed || {};
    b.hidden = false;
    b.innerHTML = `
      <h3>${res.opened > 1 ? `${res.opened} coffres ouverts` : "Coffre ouvert"}</h3>
      <p class="cv2-used">${Object.entries(used).filter(([, n]) => n).map(([k, n]) => `${KEY[k].icon} ${n} ${KEY[k].label}${n > 1 ? "s" : ""}`).join(" · ")} · +${fmtNum(res.dust)} ✨${res.boosters ? ` · +${res.boosters} jeton${res.boosters > 1 ? "s" : ""}` : ""}${res.cardCount ? ` · ${res.cardCount} carte${res.cardCount > 1 ? "s" : ""}` : ""}</p>
      ${(res.firsts || []).length ? `<p class="cv2-firsts">📚 Nouveau dans ta collection : ${res.firsts.map((f) => `${esc(f.familyLabel)} · ${esc(f.name)} (+${f.dust} ✨)`).join(", ")}</p>` : ""}
      ${res.masterTitle ? `<p class="cv2-firsts">🏆 Titre « ${esc(res.masterTitle)} » !</p>` : ""}
      <div class="cv2-bilan-btns">
        ${again && keysLeft > 0 ? `<button type="button" class="btn" id="cv2-again">${KEY[opts.keyType || "key"].icon} Ouvrir le suivant</button>` : ""}
        <a class="btn-secondary" href="collection.html">Voir la collection</a>
        <button type="button" class="btn-ghost" id="cv2-done">Fermer</button>
      </div>`;
    document.getElementById("cv2-done").onclick = closeScene;
    const a = document.getElementById("cv2-again");
    if (a) a.onclick = () => scene({ ...opts, count: 1 });
  }
})();
