// Page collection - modes Atelier : Décrafter, Crafter, Autel, Finitions,
// Qualité (ancienne page craft.html). Donnees et filtres : collection-core.js.
//
// Decraft : une pile par variante (finition + etat), quantite reglable,
// selection multiple, et "Sélectionner les doublons" qui garde le meilleur
// exemplaire de chaque carte et ne touche jamais un #001, une arc-en-ciel ou
// un parfait etat. Les exemplaires detruits sont choisis ICI (numeros les
// plus hauts d'abord) et envoyes par pullId : aucune surprise cote serveur.

(() => {
  const { FINISH_ORDER, FINISH_LABELS, FINISH_LABELS_LONG, QUALITY_ORDER, QUALITY_LABELS, state, escapeHtml } = Coll;
  const $ = (id) => document.getElementById(id);
  const cardOf = (id) => state.byId.get(id);
  const variantKey = (cardId, finish, quality) => `${cardId}::${finish}::${quality}`;
  const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
  const variantLabel = (finish, quality) => `${finish !== "normal" ? FINISH_LABELS[finish] + ", " : ""}${QUALITY_LABELS[quality]}`;

  // ======================================================== Décrafter
  let dBulk = false;
  const dSelected = new Set();
  const dQty = new Map();
  let dVariants = new Map(); // key -> { card, variant, totalOwned }

  function disenchantable() {
    return state.cards.filter((c) => c.inCatalog && (!c.isPromo || c.isSecret) && state.ownedMap.has(c.cardId) && c.rarity?.disenchantValue != null);
  }

  function qtyOf(key) {
    const entry = dVariants.get(key);
    return entry ? Math.min(Math.max(dQty.get(key) || 1, 1), entry.variant.count) : 1;
  }

  function rewardText(card, variant, qty) {
    if (card.isSecret) return `+${plural(qty, "booster")}`;
    return `+${Coll.estimateDust(card.rarity.disenchantValue, variant.finish, variant.quality) * qty} poussières`;
  }

  function disenchantTile({ card, variant, totalOwned }) {
    const { finish, quality, count } = variant;
    const key = variantKey(card.cardId, finish, quality);
    const checked = dSelected.has(key);
    const qty = qtyOf(key);
    const hasFirst = variant.serialNumbers.includes(1);
    const lastCopies = totalOwned === count;
    // Carte secrete (contrepartie en boosters) exclue de la selection multiple.
    const checkable = dBulk && !card.isSecret;
    return `
      <div class="craft-card ${dBulk ? "bulk-mode" : ""} ${checked ? "selected" : ""}" data-card-id="${card.cardId}" data-variant-key="${key}" data-rarity="${card.rarity?.key || "commune"}" data-finish="${finish}" data-quality="${quality}">
        ${checkable ? `<label class="bulk-checkbox"><input type="checkbox" data-bulk-id="${key}" ${checked ? "checked" : ""} aria-label="Sélectionner ${escapeHtml(card.name)}" /></label>` : ""}
        <div class="card-art">
          <img src="${API.imageUrl(card.imageId) || PLACEHOLDER_IMG}" alt="${escapeHtml(card.name)}" loading="lazy" />
          ${finish !== "normal" ? `<span class="finish-indicator" data-finish="${finish}">${FINISH_LABELS[finish]}</span>` : ""}
          <span class="quality-indicator" data-quality="${quality}">${QUALITY_LABELS[quality]}</span>
          ${hasFirst ? `<span class="serial-one-badge" title="Premier exemplaire en circulation">#001</span>` : ""}
        </div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(card.name)}</div>
          <div class="owned-count">x${count}${totalOwned > count ? ` · ${totalOwned} en tout` : ""}${hasFirst ? " · dont le #001" : ""}</div>
          ${lastCopies ? `<div class="owned-count coll-last-copies">${count > 1 ? "Tes seuls exemplaires" : "Ton seul exemplaire"}</div>` : ""}
          <div class="craft-cost" data-reward="${key}">${rewardText(card, variant, qty)}</div>
          ${count > 1 ? `
            <div class="qty-stepper">
              <button type="button" class="qty-btn" data-dqty="-1" data-key="${key}" aria-label="Moins" ${qty <= 1 ? "disabled" : ""}>&minus;</button>
              <span class="qty-value" data-qty-display="${key}">${qty}</span>
              <button type="button" class="qty-btn" data-dqty="1" data-key="${key}" aria-label="Plus" ${qty >= count ? "disabled" : ""}>+</button>
            </div>` : ""}
          <button type="button" class="disenchant-btn" data-key="${key}" ${dBulk ? "disabled" : ""}>${qty > 1 ? `Décrafter x${qty}` : "Décrafter"}</button>
        </div>
      </div>`;
  }

  function renderDisenchant() {
    const grid = $("disenchant-grid");
    dVariants = new Map();
    const entries = [];
    Coll.filterCards(disenchantable()).forEach((card) => {
      const owned = state.ownedMap.get(card.cardId);
      Coll.buildVariants(owned).forEach((variant) => {
        const entry = { card, variant, totalOwned: owned.count || 0 };
        dVariants.set(variantKey(card.cardId, variant.finish, variant.quality), entry);
        entries.push(entry);
      });
    });
    // Les plus gros doublons d'abord, puis les plus rentables, puis par nom.
    entries.sort((a, b) =>
      (b.totalOwned - a.totalOwned) ||
      ((b.card.rarity?.disenchantValue || 0) - (a.card.rarity?.disenchantValue || 0)) ||
      a.card.name.localeCompare(b.card.name) || (a.card.cardId - b.card.cardId));
    [...dSelected].forEach((k) => { if (!dVariants.has(k)) dSelected.delete(k); });
    grid.innerHTML = entries.length
      ? entries.map(disenchantTile).join("")
      : `<div class="empty-state">Aucune carte décraftable ne correspond.</div>`;
    grid.querySelectorAll(".craft-card").forEach(Coll.attachTilt);
    $("select-all-disenchant-btn").style.display = dBulk ? "" : "none";
    updateDisenchantBar();
  }

  function adjustDisenchantQty(key, delta) {
    const entry = dVariants.get(key);
    if (!entry) return;
    const max = entry.variant.count;
    const next = Math.min(Math.max(qtyOf(key) + delta, 1), max);
    dQty.set(key, next);
    const tile = document.querySelector(`#disenchant-grid .craft-card[data-variant-key="${key}"]`);
    if (!tile) return;
    tile.querySelector(`[data-qty-display="${key}"]`).textContent = next;
    tile.querySelector(".disenchant-btn").textContent = next > 1 ? `Décrafter x${next}` : "Décrafter";
    tile.querySelector('[data-dqty="-1"]').disabled = next <= 1;
    tile.querySelector('[data-dqty="1"]').disabled = next >= max;
    tile.querySelector(`[data-reward="${key}"]`).textContent = rewardText(entry.card, entry.variant, next);
    if (dSelected.has(key)) updateDisenchantBar();
  }

  // Plan exact : quels exemplaires (pullId) partent, pour chaque variante.
  function disenchantPlan(keys) {
    return keys.map((key) => {
      const entry = dVariants.get(key);
      if (!entry) return null;
      const qty = qtyOf(key);
      const copies = Coll.copiesToSpend(entry.variant.copies, qty);
      const dust = entry.card.isSecret ? 0 : Coll.estimateDust(entry.card.rarity.disenchantValue, entry.variant.finish, entry.variant.quality) * copies.length;
      return { key, ...entry, copies, dust };
    }).filter(Boolean);
  }

  function updateDisenchantBar() {
    const bar = $("disenchant-bulk-bar");
    if (!dBulk || !dSelected.size) { bar.style.display = "none"; return; }
    const plan = disenchantPlan([...dSelected]);
    const copies = plan.reduce((s, p) => s + p.copies.length, 0);
    const dust = plan.reduce((s, p) => s + p.dust, 0);
    bar.style.display = "flex";
    $("disenchant-bulk-summary").textContent = `${plural(copies, "exemplaire")} (${plural(plan.length, "variante")}) · +${dust} poussières`;
  }

  function setDisenchantBulk(on) {
    dBulk = on;
    dSelected.clear();
    if (!on) dQty.clear();
    $("disenchant-bulk-toggle").classList.toggle("active", on);
    $("disenchant-bulk-toggle").setAttribute("aria-pressed", String(on));
    renderDisenchant();
  }

  // Garde le MEILLEUR exemplaire de chaque carte (finition, puis etat, puis
  // le plus petit numero) ; ne selectionne jamais un exemplaire precieux.
  function selectDuplicates() {
    const fRank = (c) => FINISH_ORDER.indexOf(Coll.finishOf(c));
    const qRank = (c) => QUALITY_ORDER.indexOf(Coll.qualityOf(c));
    const picks = new Map();
    let protectedCount = 0;
    Coll.filterCards(disenchantable()).forEach((card) => {
      if (card.isSecret) return;
      const owned = state.ownedMap.get(card.cardId);
      if (!owned || owned.count < 2) return;
      const best = [...owned.copies].sort((a, b) => (fRank(b) - fRank(a)) || (qRank(b) - qRank(a)) || ((a.serialNumber || 1e9) - (b.serialNumber || 1e9)));
      best.slice(1).forEach((c) => {
        if (Coll.isPrecious(c)) { protectedCount++; return; }
        const key = variantKey(card.cardId, Coll.finishOf(c), Coll.qualityOf(c));
        picks.set(key, (picks.get(key) || 0) + 1);
      });
    });
    if (!picks.size) {
      Toast.info(protectedCount ? `Aucun doublon ordinaire : ${plural(protectedCount, "exemplaire précieux")} gardé${protectedCount > 1 ? "s" : ""} (#001, arc-en-ciel, parfait état).` : "Aucun doublon à décrafter.");
      return;
    }
    dBulk = true;
    dSelected.clear();
    dQty.clear();
    picks.forEach((n, key) => { dSelected.add(key); dQty.set(key, n); });
    $("disenchant-bulk-toggle").classList.add("active");
    renderDisenchant();
    const total = [...picks.values()].reduce((s, n) => s + n, 0);
    Toast.info(`${plural(total, "doublon")} sélectionné${total > 1 ? "s" : ""}${protectedCount ? ` · ${protectedCount} précieux gardé${protectedCount > 1 ? "s" : ""}` : ""}. Vérifie puis valide en bas.`);
    $("disenchant-bulk-bar").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function runDisenchant(plan, btn) {
    let count = 0, dust = 0, boosters = 0, lastError = null;
    for (const p of plan) {
      for (const copy of p.copies) {
        try {
          const res = await API.disenchantCard(Session.userId, p.card.cardId, p.variant.finish, p.variant.quality, copy.pullId);
          dust += res.dustGained || 0;
          if (res.boosterGranted) boosters++;
          count++;
        } catch (e) { lastError = e; break; }
      }
    }
    if (!count) { Toast.error(Coll.errorText("disenchant", lastError)); return false; }
    const parts = [];
    if (dust) parts.push(`+${dust} poussières`);
    if (boosters) parts.push(`+${plural(boosters, "booster")}`);
    Toast.success(`${plural(count, "exemplaire")} décrafté${count > 1 ? "s" : ""} (${parts.join(", ") || "+0"}).`);
    if (boosters && typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    if (btn) await playDustDissolve(btn.closest(".craft-card"));
    return true;
  }

  function preciousWarning(plan) {
    const precious = plan.flatMap((p) => p.copies.filter(Coll.isPrecious).map((c) => `${p.card.name} ${Coll.serial(c.serialNumber)}`));
    return precious.length ? `<br><br>&#9888; Exemplaires précieux inclus : <strong>${escapeHtml(precious.join(", "))}</strong>.` : "";
  }

  async function disenchantOne(key, btn) {
    const plan = disenchantPlan([key]);
    if (!plan.length) return;
    const p = plan[0];
    const qty = p.copies.length;
    const serials = p.copies.map((c) => c.serialNumber).filter((n) => n != null).map(Coll.serial).join(", ");
    const lastOne = p.totalOwned === qty ? "<br>Ce sont tes <strong>derniers exemplaires</strong> de cette carte." : "";
    const ok = await Confirm.show(
      `Décrafter <strong>${qty > 1 ? qty + "x " : ""}${escapeHtml(p.card.name)}</strong> (${variantLabel(p.variant.finish, p.variant.quality)}${serials ? " · " + serials : ""}) contre <strong>${rewardText(p.card, p.variant, qty)}</strong> ?` +
      (p.card.isSecret ? "" : ` Solde : ${state.stardust} &rarr; <strong>${state.stardust + p.dust}</strong>.`) +
      ` Cette action est irréversible.${lastOne}${preciousWarning(plan)}`,
      { title: "Décrafter cette carte ?", confirmText: qty > 1 ? `Décrafter x${qty}` : "Décrafter", dangerous: true });
    if (!ok) return;
    if (btn) btn.disabled = true;
    if (await runDisenchant(plan, btn)) { dQty.delete(key); await Coll.refresh(); }
    else if (btn) btn.disabled = false;
  }

  async function disenchantSelection() {
    const plan = disenchantPlan([...dSelected]);
    if (!plan.length) return;
    const copies = plan.reduce((s, p) => s + p.copies.length, 0);
    const dust = plan.reduce((s, p) => s + p.dust, 0);
    const lines = plan.slice(0, 8).map((p) => `<li>${p.copies.length > 1 ? p.copies.length + "x " : ""}${escapeHtml(p.card.name)} — ${variantLabel(p.variant.finish, p.variant.quality)}</li>`).join("");
    const ok = await Confirm.show(
      `Décrafter <strong>${plural(copies, "exemplaire")}</strong> pour <strong>+${dust} poussières d'étoile</strong> ?` +
      `<ul style="text-align:left;margin:8px 0;font-size:0.85rem;">${lines}${plan.length > 8 ? `<li>… et ${plan.length - 8} autre(s)</li>` : ""}</ul>` +
      `Solde : ${state.stardust} &rarr; <strong>${state.stardust + dust}</strong>. Cette action est irréversible.${preciousWarning(plan)}`,
      { title: "Décrafter la sélection ?", confirmText: "Décrafter tout", dangerous: true });
    if (!ok) return;
    const btn = $("disenchant-bulk-btn");
    btn.disabled = true;
    await runDisenchant(plan, null);
    btn.disabled = false;
    dBulk = false;
    dSelected.clear();
    dQty.clear();
    $("disenchant-bulk-toggle").classList.remove("active");
    await Coll.refresh();
  }

  // ======================================================== Crafter
  let cBulk = false;
  const cSelected = new Set();
  const cQty = new Map();
  let hideOwned = false;

  const craftCost = (card) => card.rarity?.craftCost || 0;
  const maxAffordable = (card) => (craftCost(card) > 0 ? Math.floor(state.stardust / craftCost(card)) : 1);
  function craftableCards() {
    return state.cards.filter((c) => c.inCatalog && !c.isPromo && c.rarity?.craftCost != null);
  }
  function craftQtyOf(card) {
    return Math.min(Math.max(cQty.get(card.cardId) || 1, 1), Math.max(maxAffordable(card), 1));
  }

  function craftTile(card) {
    const cost = craftCost(card);
    const canAfford = state.stardust >= cost;
    const owned = state.ownedMap.get(card.cardId);
    const checked = cSelected.has(card.cardId);
    const qty = craftQtyOf(card);
    const showStepper = !cBulk && canAfford && maxAffordable(card) > 1;
    const wished = state.wishlist.has(card.cardId);
    // Carte jamais obtenue : nom visible (on la vise), image floutee comme au classeur.
    return `
      <div class="craft-card ${canAfford ? "" : "unavailable"} ${cBulk ? "bulk-mode" : ""} ${checked ? "selected" : ""} ${Coll.isDiscovered(card.cardId) ? "" : "coll-missing"}" data-card-id="${card.cardId}" data-rarity="${card.rarity?.key || "commune"}">
        ${cBulk ? `<label class="bulk-checkbox"><input type="checkbox" data-craft-bulk-id="${card.cardId}" ${checked ? "checked" : ""} ${canAfford ? "" : "disabled"} aria-label="Sélectionner ${escapeHtml(card.name)}" /></label>` : ""}
        ${wished ? `<span class="coll-wish-flag" title="Dans ta wishlist">&#9733;</span>` : ""}
        <img src="${API.imageUrl(card.imageId) || PLACEHOLDER_IMG}" alt="${escapeHtml(card.name)}" loading="lazy" />
        <div class="card-info">
          <div class="card-name">${escapeHtml(card.name)}</div>
          <div class="owned-count">${owned ? `Possédée x${owned.count}` : state.protectedMap.has(card.cardId) ? "&#128274; Au coffre-fort" : "<strong>Manquante</strong>"}</div>
          <div class="craft-cost">${cost} poussières</div>
          ${!canAfford ? `<div class="craft-missing">Il te manque ${cost - state.stardust} poussières</div>` : ""}
          ${showStepper ? `
            <div class="qty-stepper">
              <button type="button" class="qty-btn" data-cqty="-1" data-card-id="${card.cardId}" aria-label="Moins" ${qty <= 1 ? "disabled" : ""}>&minus;</button>
              <span class="qty-value" data-cqty-display="${card.cardId}">${qty}</span>
              <button type="button" class="qty-btn" data-cqty="1" data-card-id="${card.cardId}" aria-label="Plus" ${qty >= maxAffordable(card) ? "disabled" : ""}>+</button>
            </div>` : ""}
          <button type="button" class="craft-btn" data-card-id="${card.cardId}" ${canAfford && !cBulk ? "" : "disabled"}>${qty > 1 ? `Crafter x${qty}` : "Crafter"}</button>
        </div>
      </div>`;
  }

  function renderCraft() {
    let list = Coll.filterCards(craftableCards());
    if (hideOwned) list = list.filter((c) => !Coll.isDiscovered(c.cardId));
    // A portee d'abord, puis manquantes, puis wishlist, puis cout croissant.
    list = [...list].sort((a, b) =>
      ((state.stardust >= craftCost(a) ? 0 : 1) - (state.stardust >= craftCost(b) ? 0 : 1)) ||
      ((Coll.isDiscovered(a.cardId) ? 1 : 0) - (Coll.isDiscovered(b.cardId) ? 1 : 0)) ||
      ((state.wishlist.has(b.cardId) ? 1 : 0) - (state.wishlist.has(a.cardId) ? 1 : 0)) ||
      (craftCost(a) - craftCost(b)) || a.name.localeCompare(b.name));
    [...cSelected].forEach((id) => { const c = cardOf(id); if (!c || state.stardust < craftCost(c)) cSelected.delete(id); });
    $("craft-grid").innerHTML = list.length
      ? list.map(craftTile).join("")
      : `<div class="empty-state">${hideOwned ? "Aucune carte manquante ne correspond." : "Aucune carte craftable ne correspond."}</div>`;
    $("hide-owned-toggle").classList.toggle("active", hideOwned);
    $("hide-owned-toggle").setAttribute("aria-pressed", String(hideOwned));
    $("select-all-craft-btn").style.display = cBulk ? "" : "none";
    updateCraftBar();
  }

  function adjustCraftQty(cardId, delta) {
    const card = cardOf(cardId);
    if (!card) return;
    const max = Math.max(maxAffordable(card), 1);
    const next = Math.min(Math.max(craftQtyOf(card) + delta, 1), max);
    cQty.set(cardId, next);
    const tile = document.querySelector(`#craft-grid .craft-card[data-card-id="${cardId}"]`);
    if (!tile) return;
    tile.querySelector(`[data-cqty-display="${cardId}"]`).textContent = next;
    tile.querySelector(".craft-btn").textContent = next > 1 ? `Crafter x${next}` : "Crafter";
    tile.querySelector('[data-cqty="-1"]').disabled = next <= 1;
    tile.querySelector('[data-cqty="1"]').disabled = next >= max;
  }

  function updateCraftBar() {
    const bar = $("craft-bulk-bar");
    if (!cBulk || !cSelected.size) { bar.style.display = "none"; return; }
    const cost = [...cSelected].reduce((s, id) => s + craftCost(cardOf(id) || {}), 0);
    const ok = cost <= state.stardust;
    bar.style.display = "flex";
    $("craft-bulk-summary").textContent = `${plural(cSelected.size, "carte")} · ${cost} poussières` + (ok ? ` · reste ${state.stardust - cost}` : ` (solde insuffisant : ${state.stardust})`);
    $("craft-bulk-btn").disabled = !ok;
  }

  function setCraftBulk(on) {
    cBulk = on;
    cSelected.clear();
    $("craft-bulk-toggle").classList.toggle("active", on);
    $("craft-bulk-toggle").setAttribute("aria-pressed", String(on));
    renderCraft();
  }

  async function runCraft(ids) {
    let count = 0, lastError = null, lastName = "";
    for (const id of ids) {
      try { const res = await API.craftCard(Session.userId, id); lastName = res.card.name; count++; }
      catch (e) { lastError = e; if (ids.every((x) => x === ids[0])) break; }
    }
    if (!count) { Toast.error(Coll.errorText("craft", lastError)); return false; }
    if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
    Toast.success(ids.every((x) => x === ids[0]) ? (count > 1 ? `${count}x ${lastName} craftées !` : `${lastName} craftée !`) : `${plural(count, "carte")} craftée${count > 1 ? "s" : ""}.`);
    if (lastError) Toast.error(Coll.errorText("craft", lastError));
    return true;
  }

  async function craftOne(cardId) {
    const card = cardOf(cardId);
    if (!card) return;
    const qty = craftQtyOf(card);
    const total = craftCost(card) * qty;
    const ok = await Confirm.show(
      `Crafter <strong>${qty > 1 ? qty + "x " : ""}${escapeHtml(card.name)}</strong> pour <strong>${total} poussières d'étoile</strong> ? Solde : ${state.stardust} &rarr; <strong>${state.stardust - total}</strong>.`,
      { title: "Crafter cette carte ?", confirmText: qty > 1 ? `Crafter x${qty}` : "Crafter" });
    if (!ok) return;
    if (await runCraft(Array(qty).fill(cardId))) { cQty.delete(cardId); await Coll.refresh(); }
  }

  async function craftSelection() {
    const ids = [...cSelected];
    const cost = ids.reduce((s, id) => s + craftCost(cardOf(id) || {}), 0);
    if (!ids.length || cost > state.stardust) return;
    const ok = await Confirm.show(
      `Crafter ces <strong>${plural(ids.length, "carte")}</strong> pour <strong>${cost} poussières d'étoile</strong> au total ? Solde : ${state.stardust} &rarr; <strong>${state.stardust - cost}</strong>.`,
      { title: "Crafter la sélection ?", confirmText: "Crafter tout" });
    if (!ok) return;
    await runCraft(ids);
    cBulk = false;
    cSelected.clear();
    $("craft-bulk-toggle").classList.remove("active");
    await Coll.refresh();
  }

  // ======================================================== Autel
  // 3 emplacements remplis avec des exemplaires PRECIS (pullId).
  let altarSlots = [null, null, null];
  let altarSearch = "";

  // Exemplaires posables : cartes non promo possedees en 2+ exemplaires
  // (on en garde toujours 1), d'une rarete qui a un palier au-dessus.
  function altarCopies() {
    const pool = state.cards.filter((c) => c.inCatalog && !c.isPromo && c.rarity);
    const maxOrder = pool.length ? Math.max(...pool.map((c) => c.rarity.sortOrder ?? 0)) : 0;
    const list = [];
    pool.forEach((card) => {
      if ((card.rarity.sortOrder ?? 0) >= maxOrder) return;
      const owned = state.ownedMap.get(card.cardId);
      if (!owned || owned.count < 2) return;
      (owned.copies || []).forEach((c) => list.push({ ...c, card, ownedCount: owned.count }));
    });
    return list.sort((a, b) =>
      ((a.card.rarity.sortOrder ?? 0) - (b.card.rarity.sortOrder ?? 0)) ||
      a.card.name.localeCompare(b.card.name) ||
      (FINISH_ORDER.indexOf(Coll.finishOf(a)) - FINISH_ORDER.indexOf(Coll.finishOf(b))) ||
      (QUALITY_ORDER.indexOf(Coll.qualityOf(a)) - QUALITY_ORDER.indexOf(Coll.qualityOf(b))) ||
      ((b.serialNumber || 0) - (a.serialNumber || 0)));
  }

  const altarCopyLabel = (c) => [Coll.finishOf(c) !== "normal" ? FINISH_LABELS[c.finish] : null, QUALITY_LABELS[Coll.qualityOf(c)]].filter(Boolean).join(" · ");

  function renderAltar() {
    const root = $("altar-tiers");
    const copies = altarCopies();
    const byPull = new Map(copies.map((c) => [c.pullId, c]));
    altarSlots = altarSlots.map((id) => (id != null && byPull.has(id) ? id : null));
    const slotted = altarSlots.filter((id) => id != null).map((id) => byPull.get(id));
    const lockedRarity = slotted.length ? slotted[0].card.rarity.key : null;
    const perCard = new Map();
    slotted.forEach((c) => perCard.set(c.card.cardId, (perCard.get(c.card.cardId) || 0) + 1));
    let nextRarity = null;
    if (lockedRarity) {
      const order = slotted[0].card.rarity.sortOrder ?? 0;
      const higher = state.cards.filter((c) => c.inCatalog && c.rarity && !c.isPromo && (c.rarity.sortOrder ?? 0) > order)
        .sort((a, b) => (a.rarity.sortOrder ?? 0) - (b.rarity.sortOrder ?? 0))[0];
      nextRarity = higher ? higher.rarity : null;
    }
    const precious = slotted.filter(Coll.isPrecious);
    const q = Coll.normalize(altarSearch);

    const slotHtml = altarSlots.map((id, i) => {
      const c = id != null ? byPull.get(id) : null;
      if (!c) return `<div class="altar-slot empty"><span>Emplacement ${i + 1}</span></div>`;
      return `
        <button type="button" class="altar-slot filled" data-slot="${i}" title="Retirer de l'autel" style="--slot-color:${c.card.rarity.colorHex || "#9aa0b4"};">
          <img src="${API.imageUrl(c.card.imageId) || PLACEHOLDER_IMG}" alt="" />
          <span class="altar-slot-name">${escapeHtml(c.card.name)}</span>
          <span class="altar-slot-meta">${Coll.serial(c.serialNumber)} · ${altarCopyLabel(c)}</span>
          <span class="altar-slot-remove" aria-hidden="true">&times;</span>
        </button>`;
    }).join("");

    const visible = copies.filter((c) => !altarSlots.includes(c.pullId) && (!q || Coll.normalize(c.card.name).includes(q)));
    const gridHtml = visible.length ? visible.map((c) => {
      const keepsOne = c.ownedCount - (perCard.get(c.card.cardId) || 0) > 1;
      const sameRarity = !lockedRarity || c.card.rarity.key === lockedRarity;
      const full = slotted.length >= 3;
      const disabled = !keepsOne || !sameRarity || full;
      const reason = !sameRarity ? "Autre rareté que les cartes déjà posées" : !keepsOne ? "Tu dois garder au moins 1 exemplaire de cette carte" : full ? "L'autel est plein" : "Poser sur l'autel";
      return `
        <button type="button" class="altar-copy ${disabled ? "disabled" : ""}" data-pull="${c.pullId}" ${disabled ? "disabled" : ""} title="${reason}" data-rarity="${c.card.rarity.key}">
          <img src="${API.imageUrl(c.card.imageId) || PLACEHOLDER_IMG}" alt="" loading="lazy" />
          <span class="altar-copy-name">${escapeHtml(c.card.name)}</span>
          <span class="altar-copy-meta">${Coll.serial(c.serialNumber)} · ${altarCopyLabel(c)}</span>
          ${Coll.isPrecious(c) ? '<span class="altar-copy-precious">précieux</span>' : ""}
        </button>`;
    }).join("") : `<div class="empty-state">${copies.length ? "Aucun exemplaire ne correspond." : "Aucun doublon sacrifiable pour l'instant (il faut 2 exemplaires d'une carte, hors rareté maximale)."}</div>`;

    root.innerHTML = `
      <div class="altar-board">
        <div class="altar-slots">${slotHtml}</div>
        <div class="altar-odds">${lockedRarity
          ? `<strong>${escapeHtml(slotted[0].card.rarity.name)}</strong> &rarr; <strong>${nextRarity ? escapeHtml(nextRarity.name) : "?"}</strong> · 50% de réussite · échec : un os &#129460;`
          : "Pose 3 exemplaires d'une même rareté. 50% de réussite · échec : un os &#129460;"}</div>
        ${precious.length ? `<div class="altar-warning">&#9888; Tu poses des exemplaires précieux : ${precious.map((c) => Coll.serial(c.serialNumber) + " " + escapeHtml(c.card.name)).join(", ")}</div>` : ""}
        <div class="altar-actions">
          <button type="button" class="btn-ghost" data-altar="auto" ${slotted.length >= 3 ? "disabled" : ""} title="Complète l'autel avec les exemplaires les moins précieux d'une même rareté">&#10024; Remplir automatiquement</button>
          <button type="button" class="btn-ghost" data-altar="clear" ${slotted.length ? "" : "disabled"}>Vider l'autel</button>
          <button type="button" class="btn-danger altar-confirm-btn" data-altar="sacrifice" ${slotted.length === 3 ? "" : "disabled"}>&#128293; Sacrifier</button>
        </div>
      </div>
      <div class="craft-toolbar">
        <input type="text" id="altar-search" placeholder="Rechercher un exemplaire..." autocomplete="off" aria-label="Rechercher un exemplaire" value="${escapeHtml(altarSearch)}" />
      </div>
      <div class="altar-copy-grid">${gridHtml}</div>`;
  }

  // Remplissage auto : jamais d'exemplaire precieux, toujours 1 exemplaire
  // garde par carte, rarete des cartes deja posees (sinon la plus basse
  // qui permet de completer l'autel).
  function autoFillAltar() {
    const copies = altarCopies().filter((c) => !Coll.isPrecious(c) && !altarSlots.includes(c.pullId));
    const slotted = altarSlots.filter((id) => id != null).map((id) => altarCopies().find((c) => c.pullId === id)).filter(Boolean);
    const used = new Map();
    slotted.forEach((c) => used.set(c.card.cardId, (used.get(c.card.cardId) || 0) + 1));
    const rarities = slotted.length ? [slotted[0].card.rarity.key] : [...new Set(copies.map((c) => c.card.rarity.key))];
    for (const rk of rarities) {
      const picked = [];
      const u = new Map(used);
      for (const c of copies) {
        if (c.card.rarity.key !== rk) continue;
        if (c.ownedCount - (u.get(c.card.cardId) || 0) <= 1) continue;
        picked.push(c.pullId);
        u.set(c.card.cardId, (u.get(c.card.cardId) || 0) + 1);
        if (picked.length + slotted.length >= 3) break;
      }
      if (picked.length + slotted.length >= 3) {
        altarSlots = altarSlots.map((id) => (id != null ? id : picked.shift() ?? null));
        renderAltar();
        return;
      }
    }
    Toast.info("Pas assez de doublons ordinaires d'une même rareté pour remplir l'autel.");
  }

  async function sacrifice() {
    const pullIds = altarSlots.filter((id) => id != null);
    if (pullIds.length !== 3) return;
    const byPull = new Map(altarCopies().map((c) => [c.pullId, c]));
    const names = pullIds.map((id) => { const c = byPull.get(id); return c ? `${escapeHtml(c.card.name)} (${Coll.serial(c.serialNumber)})` : "?"; }).join(", ");
    const ok = await Confirm.show(
      `Sacrifier <strong>${names}</strong> pour tenter d'obtenir une carte aléatoire de la rareté supérieure ?<br><br>50% de réussite. En cas d'échec, ces 3 cartes sont perdues (l'autel te laisse un os &#129460;).`,
      { title: "Sacrifice à l'autel ?", confirmText: "Sacrifier", dangerous: true });
    if (!ok) return;
    const btn = document.querySelector(".altar-confirm-btn");
    if (btn) btn.disabled = true;
    try {
      const res = await API.altarSacrifice(Session.userId, pullIds);
      altarSlots = [null, null, null];
      await Coll.refresh();
      showAltarResult(res);
    } catch (e) {
      if (btn) btn.disabled = false;
      Toast.error(Coll.errorText("altar", e));
    }
  }

  // Resultat en modale a fermer soi-meme (jamais de disparition automatique).
  function showAltarResult(res) {
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay confirm-overlay";
    let body;
    if (res.success) {
      const card = res.card;
      const color = card.rarity?.colorHex || "#9aa0b4";
      body = `
        <div class="confirm-title">&#128293; Sacrifice réussi !</div>
        <img src="${API.imageUrl(card.imageId) || PLACEHOLDER_IMG}" alt="${escapeHtml(card.name)}" class="altar-result-img" style="box-shadow:0 0 24px ${color}88;" />
        <div class="confirm-message">
          <strong>${escapeHtml(card.name)}</strong> obtenue !<br />
          <span class="rarity-badge" style="margin-top:8px;background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">${escapeHtml(card.rarity?.name || "Commune")}</span>
          ${res.isFirstEver ? `<div class="first-obtainer-badge" style="margin-top:10px;">&#127942; Première obtention du serveur !</div>` : ""}
        </div>`;
    } else {
      body = `
        <div class="confirm-title">&#128165; Sacrifice échoué</div>
        <div class="confirm-message">Les 3 cartes sacrifiées sont perdues.${res.boneGained ? `<br><br><span class="altar-bone-gain">&#129460; L'autel te laisse un <strong>os</strong>${res.newBoneCount ? ` (tu en as ${res.newBoneCount})` : ""}. Un chien saura quoi en faire dans la Fouille...</span>` : ""}</div>`;
    }
    overlay.innerHTML = `<div class="confirm-box" role="dialog" aria-modal="true">${body}<div class="confirm-actions"><button type="button" class="altar-result-close-btn">Fermer</button></div></div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); syncScrollLock(); };
    overlay.querySelector(".altar-result-close-btn").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    syncScrollLock();
    if (res.success) {
      if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
      Sfx.reveal(res.card.rarity?.key);
    }
  }

  // ======================================================== Finitions / Qualité
  // Fusions deterministes : 5 identiques (finition) ou 3 identiques (etat).
  // Recherche par nom (2026-10-05) ; en Qualite, avec une recherche, toutes les
  // cartes restaurables apparaissent (les exemplaires manquants peuvent se
  // payer en poussieres).
  const fusionSearch = { finish: "", quality: "" };
  let repairDustPerCopy = 60;
  API.getEconomyRules(Session.isLoggedIn() ? Session.userId : undefined).then((r) => { repairDustPerCopy = r.repairDustPerCopy || 60; }).catch(() => {});
  function fusionList(kind) {
    const order = kind === "finish" ? FINISH_ORDER : QUALITY_ORDER;
    const need = kind === "finish" ? 5 : 3;
    const q = (fusionSearch[kind] || "").trim().toLowerCase();
    const out = [];
    state.ownedMap.forEach((owned, cardId) => {
      const card = cardOf(cardId);
      if (!card || card.isPromo) return;
      if (q && !card.name.toLowerCase().includes(q)) return;
      const counts = (kind === "finish" ? owned.finishCounts : owned.qualityCounts) || {};
      // Une piece detachee (pechee) peut remplacer un des exemplaires ; en
      // Qualite, une recherche montre aussi les cartes a 1 exemplaire.
      const minNeed = kind === "quality" && q ? 1 : need - (state.spareParts > 0 ? 1 : 0);
      for (let i = 0; i < order.length - 1; i++) {
        if ((counts[order[i]] || 0) >= minNeed) out.push({ card, from: order[i], to: order[i + 1], available: counts[order[i]], need, withPart: (counts[order[i]] || 0) < need });
      }
    });
    return out.sort((a, b) => a.card.name.localeCompare(b.card.name) || (order.indexOf(a.from) - order.indexOf(b.from)));
  }

  function renderFusions(kind) {
    const el = $(kind === "finish" ? "finish-tiers" : "quality-tiers");
    if (!el.previousElementSibling || !el.previousElementSibling.classList.contains("fusion-search")) {
      const input = document.createElement("input");
      input.type = "search";
      input.className = "fusion-search";
      input.placeholder = kind === "finish" ? "Rechercher une carte à fusionner…" : "Rechercher une carte à restaurer (même à 1 exemplaire)…";
      input.setAttribute("aria-label", "Rechercher une carte");
      input.addEventListener("input", () => { fusionSearch[kind] = input.value; renderFusions(kind); });
      el.parentNode.insertBefore(input, el);
    }
    const list = fusionList(kind);
    const labels = kind === "finish" ? FINISH_LABELS_LONG : QUALITY_LABELS;
    const tag = kind === "finish" ? "finish" : "quality";
    if (!list.length) {
      el.innerHTML = `<div class="empty-state">${kind === "finish"
        ? "Aucune fusion possible pour l'instant : il te faut 5 exemplaires identiques (même carte, même finition) d'un coup."
        : "Aucune restauration possible pour l'instant : il te faut 3 exemplaires identiques (même carte, même qualité) d'un coup."}</div>`;
      return;
    }
    el.innerHTML = list.map((u) => `
      <div class="finish-upgrade-row" data-card-id="${u.card.cardId}">
        <img src="${API.imageUrl(u.card.imageId) || PLACEHOLDER_IMG}" alt="${escapeHtml(u.card.name)}" loading="lazy" />
        <div class="finish-upgrade-info">
          <div class="finish-upgrade-name">${escapeHtml(u.card.name)}</div>
          <div class="finish-upgrade-path">
            <span class="${tag}-tag" data-${tag}="${u.from}">${labels[u.from]}</span>
            <span aria-hidden="true">&#8594;</span>
            <span class="${tag}-tag" data-${tag}="${u.to}">${labels[u.to]}</span>
          </div>
          <div class="finish-upgrade-count">${u.available} exemplaires disponibles (${u.need} requis${u.withPart ? (kind === "quality" ? " · compléter avec une pièce &#128297; ou des poussières &#10024;" : " · avec une pièce détachée &#128297;") : u.available >= u.need * 2 ? ` · ${Math.floor(u.available / u.need)} fusions possibles` : ""})</div>
        </div>
        <button type="button" class="btn-secondary" data-fuse="${kind}" data-card-id="${u.card.cardId}" data-from="${u.from}">${kind === "finish" ? "Fusionner" : "Restaurer"}</button>
      </div>`).join("");
  }

  async function fuse(kind, cardId, from) {
    const card = cardOf(cardId);
    const isFinish = kind === "finish";
    const order = isFinish ? FINISH_ORDER : QUALITY_ORDER;
    const labels = isFinish ? FINISH_LABELS_LONG : QUALITY_LABELS;
    const to = order[order.indexOf(from) + 1];
    const copies = (state.ownedMap.get(cardId)?.copies || []).filter((c) => (isFinish ? Coll.finishOf(c) : Coll.qualityOf(c)) === from);
    const selection = await FusionPicker.open(isFinish ? {
      title: "Fusionner en " + labels[to],
      intro: `Choisis les <strong>5 exemplaires ${labels[from]}</strong> de <strong>${escapeHtml(card?.name || "cette carte")}</strong> à sacrifier, et le numéro que gardera le nouvel exemplaire <strong>${labels[to]}</strong>. La meilleure qualité sacrifiée est conservée.`,
      copies, required: 5, parts: state.spareParts,
      otherRank: (c) => FUSION_QUALITY_RANK.indexOf(Coll.qualityOf(c))
    } : {
      title: "Restaurer en " + labels[to],
      intro: `Choisis les <strong>3 exemplaires ${labels[from]}</strong> de <strong>${escapeHtml(card?.name || "cette carte")}</strong> à consommer, et le numéro que gardera le nouvel exemplaire <strong>${labels[to]}</strong>. La meilleure finition consommée est conservée.`,
      copies, required: 3, parts: state.spareParts, dustPerCopy: repairDustPerCopy, stardust: state.stardust,
      otherRank: (c) => FUSION_FINISH_RANK.indexOf(Coll.finishOf(c)),
      confirmText: "Restaurer"
    });
    if (!selection) return;
    try {
      if (selection.parts) await screwPartAnimation();
      if (selection.dustCopies) Toast.info(`&#10024; ${selection.dustCopies * repairDustPerCopy} poussières à la place de ${selection.dustCopies} exemplaire${selection.dustCopies > 1 ? "s" : ""}.`);
      const res = isFinish
        ? await API.foilUpgrade(Session.userId, cardId, from, selection)
        : await API.repairCardQuality(Session.userId, cardId, from, selection);
      Toast.success(`${card?.name || "Carte"} passe en ${labels[isFinish ? res.toFinish : res.toQuality] || labels[to]} !${res.partsUsed ? " (une pièce détachée utilisée)" : ""}`);
      if (typeof confetti === "function") confetti({ particleCount: isFinish ? 130 : 100, spread: isFinish ? 100 : 90, origin: { y: 0.5 } });
      await Coll.refresh();
    } catch (e) {
      Toast.error(Coll.errorText(kind, e));
    }
  }

  // ======================================================== enregistrement
  Coll.registerPane("disenchant", {
    render: renderDisenchant,
    // Doublons decraftables (exemplaires au-dela du premier de chaque carte).
    count: () => disenchantable().reduce((s, c) => s + Math.max(0, (state.ownedMap.get(c.cardId)?.count || 0) - 1), 0),
    reset() { dBulk = false; dSelected.clear(); dQty.clear(); $("disenchant-bulk-toggle").classList.remove("active"); }
  });
  Coll.registerPane("craft", {
    render: renderCraft,
    // Cartes manquantes que le solde permet deja de crafter.
    count: () => craftableCards().filter((c) => !Coll.isDiscovered(c.cardId) && state.stardust >= craftCost(c)).length,
    reset() { hideOwned = false; cBulk = false; cSelected.clear(); cQty.clear(); $("craft-bulk-toggle").classList.remove("active"); },
    showMissingOnly() { hideOwned = true; }
  });
  Coll.registerPane("altar", { render: renderAltar });
  Coll.registerPane("finish", { render: () => renderFusions("finish"), count: () => fusionList("finish").length });
  Coll.registerPane("quality", { render: () => renderFusions("quality"), count: () => fusionList("quality").length });

  // ======================================================== evenements
  document.addEventListener("DOMContentLoaded", () => {
    if (!Session.isLoggedIn()) return;

    const dGrid = $("disenchant-grid");
    dGrid.addEventListener("click", (e) => {
      const step = e.target.closest("[data-dqty]");
      if (step) { adjustDisenchantQty(step.dataset.key, Number(step.dataset.dqty)); return; }
      const btn = e.target.closest(".disenchant-btn");
      if (btn) { disenchantOne(btn.dataset.key, btn); return; }
      // Selection multiple : clic n'importe ou sur la tuile.
      const tile = e.target.closest(".craft-card.bulk-mode");
      if (tile && !e.target.closest(".bulk-checkbox, .qty-stepper")) {
        const cb = tile.querySelector("[data-bulk-id]");
        if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true })); }
      }
    });
    dGrid.addEventListener("change", (e) => {
      const cb = e.target.closest("[data-bulk-id]");
      if (!cb) return;
      if (cb.checked) dSelected.add(cb.dataset.bulkId); else dSelected.delete(cb.dataset.bulkId);
      cb.closest(".craft-card").classList.toggle("selected", cb.checked);
      updateDisenchantBar();
    });
    $("disenchant-bulk-toggle").addEventListener("click", () => setDisenchantBulk(!dBulk));
    $("disenchant-bulk-btn").addEventListener("click", disenchantSelection);
    $("select-duplicates-btn").addEventListener("click", selectDuplicates);
    $("select-all-disenchant-btn").addEventListener("click", () => {
      dGrid.querySelectorAll("[data-bulk-id]").forEach((cb) => { if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); } });
    });

    const cGrid = $("craft-grid");
    cGrid.addEventListener("click", (e) => {
      const step = e.target.closest("[data-cqty]");
      if (step) { adjustCraftQty(Number(step.dataset.cardId), Number(step.dataset.cqty)); return; }
      const btn = e.target.closest(".craft-btn");
      if (btn) { craftOne(Number(btn.dataset.cardId)); return; }
      const tile = e.target.closest(".craft-card.bulk-mode");
      if (tile && !e.target.closest(".bulk-checkbox")) {
        const cb = tile.querySelector("[data-craft-bulk-id]:not(:disabled)");
        if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true })); }
      }
    });
    cGrid.addEventListener("change", (e) => {
      const cb = e.target.closest("[data-craft-bulk-id]");
      if (!cb) return;
      const id = Number(cb.dataset.craftBulkId);
      if (cb.checked) cSelected.add(id); else cSelected.delete(id);
      cb.closest(".craft-card").classList.toggle("selected", cb.checked);
      updateCraftBar();
    });
    $("craft-bulk-toggle").addEventListener("click", () => setCraftBulk(!cBulk));
    $("craft-bulk-btn").addEventListener("click", craftSelection);
    $("select-all-craft-btn").addEventListener("click", () => {
      cGrid.querySelectorAll("[data-craft-bulk-id]:not(:disabled)").forEach((cb) => { if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); } });
    });
    $("hide-owned-toggle").addEventListener("click", () => { hideOwned = !hideOwned; renderCraft(); Coll.updateCounts(); });

    const altar = $("altar-tiers");
    altar.addEventListener("click", (e) => {
      const slot = e.target.closest(".altar-slot.filled");
      if (slot) { altarSlots[Number(slot.dataset.slot)] = null; renderAltar(); return; }
      const copy = e.target.closest(".altar-copy:not(.disabled)");
      if (copy) {
        const free = altarSlots.indexOf(null);
        if (free >= 0) { altarSlots[free] = Number(copy.dataset.pull); renderAltar(); }
        return;
      }
      const act = e.target.closest("[data-altar]");
      if (!act) return;
      if (act.dataset.altar === "clear") { altarSlots = [null, null, null]; renderAltar(); }
      else if (act.dataset.altar === "auto") autoFillAltar();
      else if (act.dataset.altar === "sacrifice") sacrifice();
    });
    altar.addEventListener("input", (e) => {
      if (e.target.id !== "altar-search") return;
      altarSearch = e.target.value;
      const pos = e.target.selectionStart;
      renderAltar();
      const again = $("altar-search");
      again.focus();
      again.setSelectionRange(pos, pos);
    });

    ["finish-tiers", "quality-tiers"].forEach((id) => $(id).addEventListener("click", (e) => {
      const btn = e.target.closest("[data-fuse]");
      if (btn) fuse(btn.dataset.fuse, Number(btn.dataset.cardId), btn.dataset.from);
    }));
  });
})();
