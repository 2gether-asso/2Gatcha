// Page collection - mode Classeur : grille par extension (repliable), une
// vignette par variante possedee, modale avec navigation, actions rapides
// (decraft, echange, vitrine, fusion, restauration, craft d'une carte
// manquante), favoris, wishlist, cartes vues, selection multiple, grille
// compacte, plein ecran, couleur du classeur et pochettes.
// Donnees et filtres : collection-core.js (Coll).

(() => {
  const { FINISH_ORDER, FINISH_LABELS, QUALITY_ORDER, QUALITY_LABELS, state, escapeHtml } = Coll;
  const NEW_BADGE_WINDOW_SECONDS = 24 * 3600;
  const FAVORITES_KEY = "2gatcha_favorites";
  const SEEN_KEY = "2gatcha_seen_cards";
  const COLLAPSED_EXT_KEY = "2gatcha_collapsed_extensions";

  const prefs = Coll.prefs;
  let sortMode = prefs.sortMode || "extension";
  let missingOnly = !!prefs.missingOnly;
  let favoritesOnly = false;
  let bulkSelectMode = false;
  const bulkSelected = new Set();
  const favorites = Coll.loadSet(FAVORITES_KEY);
  const seenCards = Coll.loadSet(SEEN_KEY);
  const collapsedExtensions = Coll.loadSet(COLLAPSED_EXT_KEY);

  const $ = (id) => document.getElementById(id);
  const cardOf = (id) => state.byId.get(id);
  const navKeyOf = (cardId, finish, quality) => `${cardId}::${finish}::${quality}`;
  function parseNavKey(navKey) {
    const [id, finish, quality] = navKey.split("::");
    return { cardId: Number(id), finish: finish || null, quality: quality || null };
  }
  function variantCopies(owned, finish, quality) {
    return (owned?.copies || []).filter((c) => Coll.finishOf(c) === finish && Coll.qualityOf(c) === quality);
  }
  // Fusion / restauration possibles pour CETTE variante (assez de doublons
  // identiques + palier de niveau atteint).
  function upgrades(card, owned, finish, quality) {
    const canAct = !card.isPromo && !!owned;
    const nextFinish = FINISH_ORDER[FINISH_ORDER.indexOf(finish) + 1];
    const nextQuality = QUALITY_ORDER[QUALITY_ORDER.indexOf(quality) + 1];
    return {
      nextFinish, nextQuality,
      finish: canAct && !!nextFinish && state.level >= FEATURE_UNLOCK_LEVEL.finish && (owned.finishCounts?.[finish] || 0) >= 5,
      quality: canAct && !!nextQuality && state.level >= FEATURE_UNLOCK_LEVEL.quality && (owned.qualityCounts?.[quality] || 0) >= 3
    };
  }
  function canDisenchant(card) {
    return (!card.isPromo || card.isSecret) && card.rarity?.disenchantValue != null;
  }
  function disenchantLabel(card, finish, quality) {
    return card.isSecret ? "1 booster" : `${Coll.estimateDust(card.rarity.disenchantValue, finish, quality)} poussières`;
  }

  // ---------------------------------------------------------------- personnalisation
  function applyBinderAccent(hex) {
    if (hex) {
      document.documentElement.style.setProperty("--accent", hex);
      document.documentElement.style.setProperty("--accent-2", lightenColor(hex, 0.35));
    } else {
      document.documentElement.style.removeProperty("--accent");
      document.documentElement.style.removeProperty("--accent-2");
    }
    document.querySelectorAll(".binder-swatch").forEach((s) => s.classList.toggle("active", (s.dataset.accent || "") === (hex || "")));
  }

  // Pochettes : verrouillees selon le niveau (SLEEVE_UNLOCK_LEVEL, core.js,
  // pilotable par l'admin ; data-level de l'HTML en repli).
  function sleeveLevel(sw) {
    return (typeof SLEEVE_UNLOCK_LEVEL !== "undefined" && SLEEVE_UNLOCK_LEVEL[sw.dataset.sleeve] != null)
      ? SLEEVE_UNLOCK_LEVEL[sw.dataset.sleeve] : (Number(sw.dataset.level) || 1);
  }
  function applySleeve(sleeve) {
    if (sleeve) document.body.dataset.sleeve = sleeve; else delete document.body.dataset.sleeve;
    document.querySelectorAll(".sleeve-swatch").forEach((s) => s.classList.toggle("active", (s.dataset.sleeve || "") === (sleeve || "")));
  }
  function refreshSleeveLocks() {
    let currentIsLocked = false;
    const current = Coll.loadPrefs().sleeve || "";
    document.querySelectorAll(".sleeve-swatch").forEach((sw) => {
      const required = sleeveLevel(sw);
      const locked = state.level < required;
      sw.classList.toggle("locked", locked);
      sw.title = locked ? `Débloqué au niveau ${required}` : "";
      if (locked && sw.dataset.sleeve === current) currentIsLocked = true;
    });
    if (currentIsLocked) { applySleeve(""); Coll.savePrefs({ sleeve: "" }); }
  }

  // ---------------------------------------------------------------- vignettes
  function protectedTilesHtml(card) {
    const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
    return (state.protectedMap.get(card.cardId) || []).map((c) => `
      <a class="collection-card protected-card" href="coffre.html" data-card-id="${card.cardId}" data-rarity="${card.rarity?.key || "commune"}" data-finish="${Coll.finishOf(c)}" data-quality="mint" title="Rangée dans ton coffre-fort : clique pour la gérer">
        <div class="card-art">
          <img src="${imgSrc}" alt="${escapeHtml(card.name)}" loading="lazy" />
          ${Coll.finishOf(c) !== "normal" ? `<span class="finish-indicator" data-finish="${c.finish}">${FINISH_LABELS[c.finish]}</span>` : ""}
          <span class="quality-indicator" data-quality="mint">${QUALITY_LABELS.mint}</span>
          ${c.serialNumber === 1 ? `<span class="serial-one-badge">#001</span>` : ""}
        </div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(card.name)}</div>
          <span class="protected-badge">&#128274; Protégé</span>
        </div>
      </a>`);
  }

  function lockedTileHtml(card) {
    const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
    const craftCost = card.rarity?.craftCost;
    const craftable = card.inCatalog && !card.isPromo && craftCost != null && state.stardust >= craftCost && !Coll.isLocked("craft");
    const inWishlist = state.wishlist.has(card.cardId);
    const wl = inWishlist ? "Retirer de ma wishlist" : "Ajouter à ma wishlist";
    return `
      <div class="collection-card locked" data-rarity="${card.rarity?.key || "commune"}" data-card-id="${card.cardId}" data-promo="0">
        <button type="button" class="wishlist-btn ${inWishlist ? "active" : ""}" data-wishlist-id="${card.cardId}" title="${wl}" aria-label="${wl}">&#9733;</button>
        <div class="card-art">
          <img src="${imgSrc}" alt="Carte non découverte" loading="lazy" />
          <span class="locked-card-number">${Coll.serial(state.cardNumber.get(card.cardId) || 0)}</span>
        </div>
        <div class="card-info">
          <div class="card-name">???</div>
          ${Coll.rarityBadge(card)}
          ${craftable ? `<button type="button" class="card-quick-action quick-craft-btn" data-card-id="${card.cardId}">&#10024; Crafter (${craftCost})</button>` : ""}
        </div>
      </div>`;
  }

  // Une vignette par VARIANTE possedee (finition + qualite) : le decraft
  // d'une vignette cible exactement sa variante.
  function cardTilesHtml(card, now) {
    const owned = state.ownedMap.get(card.cardId);
    const protectedTiles = protectedTilesHtml(card);
    if (!owned) return protectedTiles.length ? protectedTiles : [lockedTileHtml(card)];

    const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
    const isFav = favorites.has(card.cardId);
    const inShowcase = state.showcase.has(card.cardId);
    const canQuickAct = !card.isPromo;
    const disenchantable = canDisenchant(card);
    const bulkEligible = canQuickAct && card.rarity?.disenchantValue != null;
    const isNew = !!(owned.lastObtainedAt && (now - owned.lastObtainedAt) < NEW_BADGE_WINDOW_SECONDS && !seenCards.has(card.cardId));
    const name = escapeHtml(card.name);

    return Coll.buildVariants(owned).map((variant, i) => {
      const { finish, quality, count } = variant;
      const navKey = navKeyOf(card.cardId, finish, quality);
      const inBulk = bulkSelectMode && bulkEligible;
      const checked = inBulk && bulkSelected.has(navKey);
      const up = upgrades(card, owned, finish, quality);
      return `
        <div class="collection-card ${inBulk ? "bulk-mode" : ""} ${checked ? "selected" : ""}" data-rarity="${card.rarity?.key || "commune"}" data-card-id="${card.cardId}" data-nav-key="${navKey}" data-promo="${card.isPromo ? "1" : "0"}" data-finish="${finish}" data-quality="${quality}">
          ${isNew && i === 0 ? '<span class="new-badge">New</span>' : ""}
          ${inBulk ? `<label class="bulk-checkbox"><input type="checkbox" data-bulk-key="${navKey}" ${checked ? "checked" : ""} aria-label="Sélectionner ${name}" /></label>` : `<button type="button" class="fav-btn ${isFav ? "active" : ""}" data-fav-id="${card.cardId}" title="Favori" aria-label="Marquer comme favori">&#9733;</button>`}
          <div class="card-art" tabindex="0" role="button" aria-label="Voir la carte ${name}">
            <img src="${imgSrc}" alt="" loading="lazy" />
            ${finish !== "normal" ? `<span class="finish-indicator" data-finish="${finish}">${FINISH_LABELS[finish]}</span>` : ""}
            <span class="quality-indicator" data-quality="${quality}">${QUALITY_LABELS[quality]}</span>
            ${variant.serialNumbers.includes(1) ? `<span class="serial-one-badge" title="Premier exemplaire en circulation">#001</span>` : ""}
          </div>
          <div class="card-info">
            <div class="card-name">${name}${card.isPromo ? '<span class="promo-badge">Promo</span>' : ""}</div>
            ${Coll.rarityBadge(card)}
            <div class="count-badge">x${count}</div>
            ${(canQuickAct || disenchantable) ? `
              <div class="quick-actions-row">
                ${disenchantable ? `<button type="button" class="card-quick-action" data-act="disenchant" data-finish="${finish}" data-quality="${quality}" title="Décrafter contre ${disenchantLabel(card, finish, quality)}" aria-label="Décrafter">&#9851;</button>` : ""}
                ${canQuickAct ? `<button type="button" class="card-quick-action" data-act="trade" title="Proposer un échange" aria-label="Proposer un échange">&#8644;</button>` : ""}
                ${canQuickAct ? `<button type="button" class="card-quick-action quick-showcase-btn ${inShowcase ? "active" : ""}" data-act="showcase" title="${inShowcase ? "Retirer de ma vitrine" : "Ajouter à ma vitrine"}" aria-label="${inShowcase ? "Retirer de ma vitrine" : "Ajouter à ma vitrine"}">&#128444;</button>` : ""}
                ${up.finish ? `<button type="button" class="card-quick-action" data-act="finish" data-finish="${finish}" title="Fusionner 5x ${FINISH_LABELS[finish]} en ${FINISH_LABELS[up.nextFinish]}" aria-label="Améliorer la finition">&#10024;</button>` : ""}
                ${up.quality ? `<button type="button" class="card-quick-action" data-act="quality" data-quality="${quality}" title="Restaurer 3x ${QUALITY_LABELS[quality]} en ${QUALITY_LABELS[up.nextQuality]}" aria-label="Améliorer la qualité">&#128295;</button>` : ""}
              </div>` : ""}
          </div>
        </div>`;
    }).concat(protectedTiles);
  }

  // ---------------------------------------------------------------- grille
  function visibleCards() {
    let cards = Coll.filterCards(state.cards, { ownedOnlySearch: true });
    if (missingOnly) cards = cards.filter((c) => !state.ownedMap.has(c.cardId) && !state.protectedMap.has(c.cardId));
    if (favoritesOnly) cards = cards.filter((c) => favorites.has(c.cardId));
    return cards;
  }

  function sortCards(cards) {
    const num = (c) => state.cardNumber.get(c.cardId) || 0;
    if (sortMode === "name") return [...cards].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    if (sortMode === "artist") return [...cards].sort((a, b) => (a.artist || "").localeCompare(b.artist || "") || (a.name || "").localeCompare(b.name || ""));
    if (sortMode === "recent") return [...cards].sort((a, b) => (state.ownedMap.get(b.cardId)?.lastObtainedAt || 0) - (state.ownedMap.get(a.cardId)?.lastObtainedAt || 0));
    // Par extension (SortOrder puis cle unique, pour garder chaque extension
    // contigue), puis numero de catalogue.
    return [...cards].sort((a, b) =>
      ((a.extension?.sortOrder ?? 999) - (b.extension?.sortOrder ?? 999)) ||
      (a.extension?.key || "").localeCompare(b.extension?.key || "") ||
      (num(a) - num(b)));
  }

  function render() {
    const container = $("collection-grid");
    const now = Math.floor(Date.now() / 1000);
    const cards = visibleCards();
    if (!cards.length) {
      container.innerHTML = `<div class="empty-state">Aucune carte ne correspond.${missingOnly && !state.cards.some((c) => !state.ownedMap.has(c.cardId)) ? " Il ne te manque aucune carte !" : ""}</div>`;
      updateBulkBar();
      return;
    }
    const sorted = sortCards(cards);
    let groups;
    if (sortMode === "extension") {
      groups = [];
      let current = null;
      for (const card of sorted) {
        const key = card.extension?.key || "__none__";
        if (!current || current.key !== key) { current = { key, name: card.extension?.name || "Sans extension", cards: [] }; groups.push(current); }
        current.cards.push(card);
      }
    } else {
      groups = [{ key: "__flat__", name: "", cards: sorted }];
    }
    const isDense = document.body.classList.contains("dense-view");
    const showHeadings = groups.length > 1;
    container.innerHTML = groups.map((group) => {
      const ownedCount = group.cards.filter((c) => state.ownedMap.has(c.cardId)).length;
      const collapsed = showHeadings && collapsedExtensions.has(group.key);
      return `
        <div class="collection-ext-group ${collapsed ? "collapsed" : ""}" data-ext-key="${escapeHtml(group.key)}">
          ${showHeadings ? `
            <h2 class="collection-extension-heading">
              <button type="button" class="ext-fold-toggle" aria-label="${collapsed ? "Déplier" : "Plier"} ${escapeHtml(group.name)}" aria-expanded="${!collapsed}">&#9662;</button>
              <span class="ext-heading-name">${escapeHtml(group.name)}</span>
              <span class="ext-heading-count">${ownedCount}/${group.cards.length}</span>
            </h2>` : ""}
          <div class="collection-grid ${isDense ? "dense" : ""}">${group.cards.flatMap((c) => cardTilesHtml(c, now)).join("")}</div>
        </div>`;
    }).join("");
    container.querySelectorAll(".collection-card:not(.locked):not(.protected-card)").forEach(Coll.attachTilt);
    updateBulkBar();
  }

  function visibleNavKeys() {
    return [...document.querySelectorAll("#collection-grid .collection-card[data-nav-key]")].map((el) => el.dataset.navKey);
  }

  // Delegation : un seul jeu d'ecouteurs pour toute la grille, pose une fois.
  function wireGrid() {
    const container = $("collection-grid");
    container.addEventListener("click", (e) => {
      const heading = e.target.closest(".collection-extension-heading");
      if (heading) {
        const groupEl = heading.closest(".collection-ext-group");
        const collapsed = groupEl.classList.toggle("collapsed");
        heading.querySelector(".ext-fold-toggle").setAttribute("aria-expanded", String(!collapsed));
        if (collapsed) collapsedExtensions.add(groupEl.dataset.extKey); else collapsedExtensions.delete(groupEl.dataset.extKey);
        Coll.saveSet(COLLAPSED_EXT_KEY, collapsedExtensions);
        return;
      }
      const tile = e.target.closest(".collection-card");
      if (!tile) return;
      const cardId = Number(tile.dataset.cardId);
      const fav = e.target.closest(".fav-btn");
      if (fav) {
        if (favorites.has(cardId)) favorites.delete(cardId); else favorites.add(cardId);
        Coll.saveSet(FAVORITES_KEY, favorites);
        fav.classList.toggle("active", favorites.has(cardId));
        return;
      }
      const wl = e.target.closest(".wishlist-btn");
      if (wl) { toggleWishlist(cardId, wl); return; }
      if (e.target.closest(".quick-craft-btn")) { craftQuick(cardId); return; }
      const act = e.target.closest("[data-act]");
      if (act) {
        const a = act.dataset.act;
        if (a === "disenchant") disenchantQuick(cardId, act.dataset.finish, act.dataset.quality, tile);
        else if (a === "trade") openQuickTrade(cardId);
        else if (a === "showcase") toggleShowcase(cardId, act);
        else if (a === "finish") upgradeFinish(cardId, act.dataset.finish);
        else if (a === "quality") repairQuality(cardId, act.dataset.quality);
        return;
      }
      if (!tile.dataset.navKey) return;
      // Selection multiple : un clic n'importe ou sur la vignette la coche.
      if (bulkSelectMode && tile.classList.contains("bulk-mode")) {
        if (e.target.closest(".bulk-checkbox")) return;
        const cb = tile.querySelector("[data-bulk-key]");
        if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true })); }
        return;
      }
      showCardModal(tile.dataset.navKey, visibleNavKeys());
    });
    container.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const art = e.target.closest(".card-art[role=button]");
      const tile = art && art.closest(".collection-card[data-nav-key]");
      if (!tile || e.target !== art) return;
      e.preventDefault();
      showCardModal(tile.dataset.navKey, visibleNavKeys());
    });
    container.addEventListener("change", (e) => {
      const cb = e.target.closest("[data-bulk-key]");
      if (!cb) return;
      if (cb.checked) bulkSelected.add(cb.dataset.bulkKey); else bulkSelected.delete(cb.dataset.bulkKey);
      cb.closest(".collection-card").classList.toggle("selected", cb.checked);
      updateBulkBar();
    });
  }

  // ---------------------------------------------------------------- modale
  function showCardModal(navKey, navList) {
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay";
    document.body.appendChild(overlay);
    let index = Math.max(0, navList.indexOf(navKey));

    function renderAt(newIndex, direction) {
      index = newIndex;
      const { cardId, finish: vf, quality: vq } = parseNavKey(navList[index]);
      const card = cardOf(cardId);
      if (!card) return;
      const owned = state.ownedMap.get(cardId);
      const finish = owned ? (vf || "normal") : "normal";
      const quality = owned ? (vq || "damaged") : "mint";
      const copies = owned ? variantCopies(owned, finish, quality) : [];
      const serials = copies.map((c) => c.serialNumber).filter((n) => n != null).sort((a, b) => a - b);
      const up = upgrades(card, owned, finish, quality);
      const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
      const isFirstObtainer = card.firstObtainedBy && card.firstObtainedBy === Session.pseudo;
      const disenchantable = owned && canDisenchant(card);
      overlay.innerHTML = `
        <div class="card-modal ${direction ? "slide-" + direction : ""}" data-rarity="${card.rarity?.key || "commune"}" data-finish="${finish}" data-quality="${quality}" role="dialog" aria-modal="true" aria-label="${escapeHtml(card.name)}">
          <button class="card-modal-close" aria-label="Fermer">&times;</button>
          <div class="card-art">
            <img src="${imgSrc}" alt="${escapeHtml(card.name)}" />
            ${navList.length > 1 ? `<span class="card-modal-position">${index + 1} / ${navList.length}</span>
              <button class="card-modal-nav prev" aria-label="Carte précédente">&#10094;</button>
              <button class="card-modal-nav next" aria-label="Carte suivante">&#10095;</button>` : ""}
          </div>
          <div class="card-modal-body">
            <div class="card-modal-name">${escapeHtml(card.name)}${card.isPromo ? '<span class="promo-badge">Promo</span>' : ""}</div>
            <div class="card-modal-artist">${escapeHtml(card.artist || "")}${card.extension ? " &middot; " + escapeHtml(card.extension.name) : ""}</div>
            <div class="card-modal-badges">
              ${Coll.rarityBadge(card)}
              ${owned && finish !== "normal" ? `<span class="finish-indicator" data-finish="${finish}" style="position:static;">${FINISH_LABELS[finish]}</span>` : ""}
              ${owned ? `<span class="quality-indicator" data-quality="${quality}" style="position:static;">${QUALITY_LABELS[quality]}</span>` : ""}
              ${serials.includes(1) ? `<span class="serial-one-badge" style="position:static;" title="Premier exemplaire en circulation">#001</span>` : ""}
            </div>
            ${owned ? `<div class="card-modal-stats"><span>Possédée &times;${copies.length}${owned.count > copies.length ? ` (${owned.count} toutes variantes)` : ""}</span>${serials.length ? `<span>${serials.map(Coll.serial).join(", ")}</span>` : ""}</div>` : ""}
            ${card.description ? `<p class="card-modal-description">${escapeHtml(card.description)}</p>` : ""}
            ${card.firstObtainedBy ? `<div class="first-obtainer-badge">&#127942; ${isFirstObtainer ? "C'est toi qui as" : `<strong>${escapeHtml(card.firstObtainedBy)}</strong> a`} obtenu cette carte en premier sur le serveur !</div>` : ""}
            <div class="card-modal-actions">
              ${disenchantable ? `<button type="button" class="btn-ghost" data-modal-act="disenchant">&#9851; Décrafter (${card.isSecret ? "+1 booster" : "+" + Coll.estimateDust(card.rarity.disenchantValue, finish, quality)})</button>` : ""}
              ${owned && !card.isPromo ? `<button type="button" class="btn-secondary" data-modal-act="trade">&#8644; Échanger</button>` : ""}
              ${up.finish ? `<button type="button" class="btn-secondary" data-modal-act="finish">&#10024; Fusionner en ${FINISH_LABELS[up.nextFinish]}</button>` : ""}
              ${up.quality ? `<button type="button" class="btn-secondary" data-modal-act="quality">&#128295; Restaurer en ${QUALITY_LABELS[up.nextQuality]}</button>` : ""}
              ${owned && (owned.count > 1) && !card.isPromo ? `<button type="button" class="btn-ghost" data-modal-act="workshop" title="Voir cette carte dans le mode Décrafter">&#9881; Atelier</button>` : ""}
            </div>
          </div>
        </div>`;
      overlay.querySelector(".card-modal-close").addEventListener("click", close);
      overlay.querySelector(".card-modal-nav.prev")?.addEventListener("click", () => go(-1));
      overlay.querySelector(".card-modal-nav.next")?.addEventListener("click", () => go(1));
      overlay.querySelectorAll("[data-modal-act]").forEach((btn) => btn.addEventListener("click", () => {
        close();
        const a = btn.dataset.modalAct;
        if (a === "disenchant") disenchantQuick(cardId, finish, quality, null);
        else if (a === "trade") openQuickTrade(cardId);
        else if (a === "finish") upgradeFinish(cardId, finish);
        else if (a === "quality") repairQuality(cardId, quality);
        else if (a === "workshop") {
          Coll.filters.search = card.name;
          document.getElementById("search-input").value = card.name;
          Coll.setMode("disenchant");
        }
      }));
      if (finish !== "normal") Coll.attachTilt(overlay.querySelector(".card-modal"));
    }
    function go(delta) { renderAt((index + delta + navList.length) % navList.length, delta > 0 ? "left" : "right"); }
    function close() { overlay.remove(); syncScrollLock(); document.removeEventListener("keydown", onKey); }
    // Echap est gere globalement par ui.js (retire l'overlay) : on se
    // desinscrit si l'overlay a deja disparu.
    function onKey(e) {
      if (!document.body.contains(overlay)) { document.removeEventListener("keydown", onKey); return; }
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    let touchStartX = null;
    overlay.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    overlay.addEventListener("touchend", (e) => {
      if (touchStartX == null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      touchStartX = null;
    }, { passive: true });
    renderAt(index, null);
    syncScrollLock();
  }

  // ---------------------------------------------------------------- actions
  async function craftQuick(cardId) {
    const card = cardOf(cardId);
    const cost = card?.rarity?.craftCost || 0;
    const ok = await Confirm.show(
      `Crafter <strong>${escapeHtml(card?.name || "cette carte")}</strong> pour <strong>${cost} poussières d'étoile</strong> ? Solde : ${state.stardust} &rarr; <strong>${state.stardust - cost}</strong>.`,
      { title: "Crafter cette carte ?", confirmText: "Crafter" });
    if (!ok) return;
    try {
      const res = await API.craftCard(Session.userId, cardId);
      Toast.success(`${res.card.name} craftée !`);
      if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
      await Coll.refresh();
    } catch (e) {
      Toast.error(Coll.errorText("craft", e));
    }
  }

  // Decraft d'UN exemplaire de la variante cliquee : le numero le plus haut,
  // jamais le #001 tant qu'il en reste un autre.
  async function disenchantQuick(cardId, finish, quality, tile) {
    const card = cardOf(cardId);
    const owned = state.ownedMap.get(cardId);
    if (!card || !owned) return;
    const copy = Coll.copiesToSpend(variantCopies(owned, finish, quality), 1)[0];
    const label = `${card.name} (${finish !== "normal" ? FINISH_LABELS[finish] + ", " : ""}${QUALITY_LABELS[quality]}${copy && copy.serialNumber != null ? " " + Coll.serial(copy.serialNumber) : ""})`;
    const warn = copy && Coll.isPrecious(copy) ? `<br><br>&#9888; Exemplaire précieux${copy.serialNumber === 1 ? " : c'est le <strong>#001</strong>" : ""}.` : "";
    const lastOne = owned.count === 1 ? "<br>C'est ton <strong>dernier exemplaire</strong> de cette carte." : "";
    const ok = await Confirm.show(
      `Décrafter <strong>${escapeHtml(label)}</strong> contre <strong>${disenchantLabel(card, finish, quality)}</strong> ? Cette action est irréversible.${lastOne}${warn}`,
      { title: "Décrafter cette carte ?", confirmText: "Décrafter", dangerous: true });
    if (!ok) return;
    try {
      const res = await API.disenchantCard(Session.userId, cardId, finish, quality, copy?.pullId);
      Toast.success(res.boosterGranted ? `+1 booster (${res.cardName})` : `+${res.dustGained} poussières (${res.cardName})`);
      if (res.boosterGranted && typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      await playDustDissolve(tile);
      await Coll.refresh();
    } catch (e) {
      Toast.error(Coll.errorText("disenchant", e));
    }
  }

  async function upgradeFinish(cardId, fromFinish) {
    const card = cardOf(cardId);
    const toFinish = FINISH_ORDER[FINISH_ORDER.indexOf(fromFinish) + 1];
    const copies = (state.ownedMap.get(cardId)?.copies || []).filter((c) => Coll.finishOf(c) === fromFinish);
    const selection = await FusionPicker.open({
      title: "Fusionner en " + FINISH_LABELS[toFinish],
      intro: `Choisis les <strong>5 exemplaires ${FINISH_LABELS[fromFinish]}</strong> de <strong>${escapeHtml(card?.name || "cette carte")}</strong> à sacrifier, et le numéro que gardera le nouvel exemplaire <strong>${FINISH_LABELS[toFinish]}</strong>. La meilleure qualité sacrifiée est conservée.`,
      copies, required: 5,
      otherRank: (c) => FUSION_QUALITY_RANK.indexOf(Coll.qualityOf(c))
    });
    if (!selection) return;
    try {
      const res = await API.foilUpgrade(Session.userId, cardId, fromFinish, selection);
      Toast.success(`${card?.name || "Carte"} passe en ${FINISH_LABELS[res.toFinish]} !`);
      if (typeof confetti === "function") confetti({ particleCount: 130, spread: 100, origin: { y: 0.5 } });
      await Coll.refresh();
    } catch (e) {
      Toast.error(Coll.errorText("finish", e));
    }
  }

  async function repairQuality(cardId, fromQuality) {
    const card = cardOf(cardId);
    const toQuality = QUALITY_ORDER[QUALITY_ORDER.indexOf(fromQuality) + 1];
    const copies = (state.ownedMap.get(cardId)?.copies || []).filter((c) => Coll.qualityOf(c) === fromQuality);
    const selection = await FusionPicker.open({
      title: "Restaurer en " + QUALITY_LABELS[toQuality],
      intro: `Choisis les <strong>3 exemplaires ${QUALITY_LABELS[fromQuality]}</strong> de <strong>${escapeHtml(card?.name || "cette carte")}</strong> à consommer, et le numéro que gardera le nouvel exemplaire <strong>${QUALITY_LABELS[toQuality]}</strong>. La meilleure finition consommée est conservée.`,
      copies, required: 3,
      otherRank: (c) => FUSION_FINISH_RANK.indexOf(Coll.finishOf(c)),
      confirmText: "Restaurer"
    });
    if (!selection) return;
    try {
      const res = await API.repairCardQuality(Session.userId, cardId, fromQuality, selection);
      Toast.success(`${card?.name || "Carte"} passe en ${QUALITY_LABELS[res.toQuality]} !`);
      if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
      await Coll.refresh();
    } catch (e) {
      Toast.error(Coll.errorText("quality", e));
    }
  }

  async function openQuickTrade(cardId) {
    const card = cardOf(cardId);
    if (!card) return;
    if (state.level < FEATURE_UNLOCK_LEVEL.trade) {
      Toast.info(`${FEATURE_LABELS.trade || "L'échange"} se débloque au niveau ${FEATURE_UNLOCK_LEVEL.trade} (tu es niveau ${state.level}).`);
      return;
    }
    let usersRes;
    try { usersRes = await API.listUsers(); } catch (e) { Toast.error("Impossible de charger la liste des joueurs."); return; }
    const others = (usersRes.users || []).filter((u) => String(u.userId) !== String(Session.userId));
    if (!others.length) { Toast.info("Aucun autre joueur à qui proposer un échange pour l'instant."); return; }

    // Exemplaires proposables : les moins precieux d'abord.
    const copies = Coll.copiesToSpend(state.ownedMap.get(cardId)?.copies || [], Infinity);
    const pullOptions = copies.map((c) => `<option value="${c.pullId}">${c.serialNumber != null ? Coll.serial(c.serialNumber) : "?"} · ${Coll.finishOf(c) !== "normal" ? FINISH_LABELS[c.finish] + ", " : ""}${QUALITY_LABELS[Coll.qualityOf(c)]}</option>`).join("");
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-box quick-trade-box" role="dialog" aria-modal="true">
        <div class="confirm-title">Échanger ${escapeHtml(card.name)}</div>
        <div class="quick-trade-form">
          <label>Exemplaire à donner <select id="qt-pull">${pullOptions || `<option value="">Aucun exemplaire</option>`}</select></label>
          <label>À qui ? <select id="qt-target">${others.map((u) => `<option value="${escapeHtml(u.pseudo)}">${escapeHtml(u.pseudo)}</option>`).join("")}</select></label>
          <label>Contre quelle carte ? (optionnel) <select id="qt-requested"><option value="">Choisis d'abord un joueur cible</option></select></label>
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn-ghost qt-cancel">Annuler</button>
          <button type="button" class="qt-submit">Proposer l'échange</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    syncScrollLock();
    const pullSelect = overlay.querySelector("#qt-pull");
    const targetSelect = overlay.querySelector("#qt-target");
    const requestedSelect = overlay.querySelector("#qt-requested");
    // La carte demandee ne peut porter que sur ce que la cible possede.
    async function refreshRequested() {
      requestedSelect.innerHTML = `<option value="">Chargement...</option>`;
      if (requestedSelect._fancyRefresh) requestedSelect._fancyRefresh();
      try {
        const profile = await API.getPublicProfile(targetSelect.value);
        const options = (profile.cards || []).filter((c) => !c.isPromo);
        requestedSelect.innerHTML = `<option value="">Aucune (don)</option>` + options.map((c) => `<option value="${c.cardId}">${escapeHtml(c.name)} (x${c.count})</option>`).join("");
      } catch (e) {
        requestedSelect.innerHTML = `<option value="">Aucune (don)</option>`;
      }
      if (requestedSelect._fancyRefresh) requestedSelect._fancyRefresh();
    }
    targetSelect.addEventListener("change", refreshRequested);
    refreshRequested();
    enhanceSelect(pullSelect);
    enhanceSelect(targetSelect);
    enhanceSelect(requestedSelect);
    function close() { overlay.remove(); syncScrollLock(); }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".qt-cancel").addEventListener("click", close);
    overlay.querySelector(".qt-submit").addEventListener("click", async () => {
      const offeredPullId = Number(pullSelect.value);
      const requestedCardId = requestedSelect.value ? Number(requestedSelect.value) : null;
      if (!offeredPullId) { Toast.error("Aucun exemplaire disponible à offrir."); return; }
      try {
        await API.createTrade(Session.userId, targetSelect.value, cardId, offeredPullId, requestedCardId);
        Toast.success(`Échange proposé à ${targetSelect.value}.`);
        close();
      } catch (e) {
        Toast.error(Coll.errorText("trade", e));
      }
    });
  }

  // Wishlist / vitrine : mise a jour optimiste du Set local et du bouton.
  async function toggleWishlist(cardId, btn) {
    const wasIn = state.wishlist.has(cardId);
    try {
      if (wasIn) { await API.removeFromWishlist(Session.userId, cardId); state.wishlist.delete(cardId); Toast.info("Retirée de ta wishlist."); }
      else { await API.addToWishlist(Session.userId, cardId); state.wishlist.add(cardId); Toast.success("Ajoutée à ta wishlist !"); }
      btn.classList.toggle("active", !wasIn);
      btn.title = !wasIn ? "Retirer de ma wishlist" : "Ajouter à ma wishlist";
      btn.setAttribute("aria-label", btn.title);
    } catch (e) {
      Toast.error("Erreur. (" + e.message + ")");
    }
  }

  async function toggleShowcase(cardId, btn) {
    if (state.level < FEATURE_UNLOCK_LEVEL.showcase) {
      Toast.info(`${FEATURE_LABELS.showcase} se débloque au niveau ${FEATURE_UNLOCK_LEVEL.showcase} (tu es niveau ${state.level}).`);
      return;
    }
    const wasIn = state.showcase.has(cardId);
    try {
      if (wasIn) { await API.removeFromShowcase(Session.userId, cardId); state.showcase.delete(cardId); Toast.info("Retirée de ta vitrine."); }
      else { await API.addToShowcase(Session.userId, cardId); state.showcase.add(cardId); Toast.success("Ajoutée à ta vitrine !"); }
      document.querySelectorAll(`#collection-grid .collection-card[data-card-id="${cardId}"] .quick-showcase-btn`).forEach((b) => {
        b.classList.toggle("active", !wasIn);
        b.title = !wasIn ? "Retirer de ma vitrine" : "Ajouter à ma vitrine";
        b.setAttribute("aria-label", b.title);
      });
    } catch (e) {
      Toast.error(Coll.errorText("showcase", e));
    }
  }

  // ---------------------------------------------------------------- selection multiple
  function bulkTotal() {
    return [...bulkSelected].reduce((sum, key) => {
      const { cardId, finish, quality } = parseNavKey(key);
      return sum + Coll.estimateDust(cardOf(cardId)?.rarity?.disenchantValue || 0, finish, quality);
    }, 0);
  }

  function updateBulkBar() {
    const bar = $("bulk-disenchant-bar");
    if (!bulkSelectMode || !bulkSelected.size) { bar.style.display = "none"; return; }
    bar.style.display = "flex";
    $("bulk-disenchant-summary").textContent = `${bulkSelected.size} carte${bulkSelected.size > 1 ? "s" : ""} sélectionnée${bulkSelected.size > 1 ? "s" : ""} · +${bulkTotal()} poussières`;
  }

  function setBulkMode(on) {
    bulkSelectMode = on;
    bulkSelected.clear();
    $("bulk-select-toggle").classList.toggle("active", on);
    $("bulk-select-toggle").setAttribute("aria-pressed", String(on));
    render();
  }

  async function bulkDisenchant() {
    const keys = [...bulkSelected];
    if (!keys.length) return;
    const ok = await Confirm.show(
      `Décrafter ces <strong>${keys.length} cartes</strong> pour <strong>+${bulkTotal()} poussières d'étoile</strong> ? Un seul exemplaire de chaque variante sélectionnée sera détruit (le numéro le plus haut). Cette action est irréversible.`,
      { title: "Décrafter la sélection ?", confirmText: "Décrafter tout", dangerous: true });
    if (!ok) return;
    const btn = $("bulk-disenchant-btn");
    btn.disabled = true;
    let successCount = 0, dust = 0;
    for (const key of keys) {
      const { cardId, finish, quality } = parseNavKey(key);
      const copy = Coll.copiesToSpend(variantCopies(state.ownedMap.get(cardId), finish, quality), 1)[0];
      try {
        const res = await API.disenchantCard(Session.userId, cardId, finish, quality, copy?.pullId);
        dust += res.dustGained || 0;
        successCount++;
      } catch (e) { /* on continue avec les suivantes */ }
    }
    btn.disabled = false;
    Toast.success(`${successCount} carte${successCount > 1 ? "s" : ""} décraftée${successCount > 1 ? "s" : ""} (+${dust} poussières).`);
    bulkSelectMode = false;
    bulkSelected.clear();
    $("bulk-select-toggle").classList.remove("active");
    await Coll.refresh();
  }

  // ---------------------------------------------------------------- compteur + reset
  function newCount() {
    const now = Math.floor(Date.now() / 1000);
    let n = 0;
    state.ownedMap.forEach((o, id) => { if (o.lastObtainedAt && (now - o.lastObtainedAt) < NEW_BADGE_WINDOW_SECONDS && !seenCards.has(id)) n++; });
    return n;
  }

  function reset() {
    sortMode = "extension";
    missingOnly = false;
    favoritesOnly = false;
    bulkSelectMode = false;
    bulkSelected.clear();
    document.body.classList.remove("dense-view", "cinema-mode");
    applyBinderAccent("");
    Coll.savePrefs({ sortMode, missingOnly, denseView: false, binderAccent: "" });
    $("sort-select").value = sortMode;
    ["missing-toggle", "favorites-toggle", "dense-toggle", "cinema-toggle", "bulk-select-toggle"].forEach((id) => $(id).classList.remove("active"));
  }

  Coll.registerPane("binder", {
    render() { refreshSleeveLocks(); render(); },
    count: newCount,
    reset
  });

  // ---------------------------------------------------------------- init
  document.addEventListener("DOMContentLoaded", () => {
    if (!Session.isLoggedIn()) return;
    wireGrid();
    $("sort-select").value = sortMode;
    $("missing-toggle").classList.toggle("active", missingOnly);
    if (prefs.denseView) { document.body.classList.add("dense-view"); $("dense-toggle").classList.add("active"); }
    if (prefs.binderAccent) applyBinderAccent(prefs.binderAccent);
    if (prefs.sleeve) applySleeve(prefs.sleeve);

    document.querySelectorAll(".binder-swatch").forEach((sw) => sw.addEventListener("click", () => {
      applyBinderAccent(sw.dataset.accent);
      Coll.savePrefs({ binderAccent: sw.dataset.accent });
    }));
    document.querySelectorAll(".sleeve-swatch").forEach((sw) => sw.addEventListener("click", () => {
      if (sw.classList.contains("locked")) { Toast.info(`Pochette débloquée au niveau ${sleeveLevel(sw)}.`); return; }
      applySleeve(sw.dataset.sleeve);
      Coll.savePrefs({ sleeve: sw.dataset.sleeve });
    }));
    $("sort-select").addEventListener("change", (e) => { sortMode = e.target.value; Coll.savePrefs({ sortMode }); render(); });
    $("missing-toggle").addEventListener("click", (e) => {
      missingOnly = !missingOnly;
      Coll.savePrefs({ missingOnly });
      e.currentTarget.classList.toggle("active", missingOnly);
      render();
    });
    $("favorites-toggle").addEventListener("click", (e) => {
      favoritesOnly = !favoritesOnly;
      e.currentTarget.classList.toggle("active", favoritesOnly);
      render();
    });
    $("mark-seen-btn").addEventListener("click", () => {
      const now = Math.floor(Date.now() / 1000);
      let count = 0;
      state.ownedMap.forEach((o, id) => {
        if (o.lastObtainedAt && (now - o.lastObtainedAt) < NEW_BADGE_WINDOW_SECONDS && !seenCards.has(id)) { seenCards.add(id); count++; }
      });
      Coll.saveSet(SEEN_KEY, seenCards);
      render();
      Coll.updateCounts();
      Toast.info(count ? `${count} carte${count > 1 ? "s" : ""} marquée${count > 1 ? "s" : ""} comme vue${count > 1 ? "s" : ""}.` : "Rien de nouveau à marquer.");
    });
    $("dense-toggle").addEventListener("click", (e) => {
      const isDense = document.body.classList.toggle("dense-view");
      Coll.savePrefs({ denseView: isDense });
      e.currentTarget.classList.toggle("active", isDense);
      render();
    });
    $("cinema-toggle").addEventListener("click", (e) => {
      e.currentTarget.classList.toggle("active", document.body.classList.toggle("cinema-mode"));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.body.classList.contains("cinema-mode")) {
        document.body.classList.remove("cinema-mode");
        $("cinema-toggle").classList.remove("active");
      }
    });
    $("bulk-select-toggle").addEventListener("click", () => setBulkMode(!bulkSelectMode));
    $("bulk-disenchant-btn").addEventListener("click", bulkDisenchant);
  });
})();
