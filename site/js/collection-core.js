// Page collection fusionnee (2026-10-04) : Classeur + Atelier (decraft,
// craft, autel, finitions, qualite) sur une seule page, qui remplace
// collection.js + craft.js.
//
// Ce fichier = le socle commun :
//   - chargement UNIQUE des donnees (collection, catalogue, solde, wishlist,
//     vitrine), rechargement silencieux apres chaque action ;
//   - filtres partages (rarete, recherche, extension, artiste) : on garde son
//     filtre en passant du classeur au decraft ou au craft ;
//   - modes de la page, avec ancre dans l'URL (#classeur, #decrafter,
//     #crafter, #autel, #finitions, #qualite) et compteur sur chaque onglet ;
//   - bandeau progression / poussieres / stats, toujours visible.
// collection-binder.js et collection-workshop.js s'y enregistrent via
// Coll.registerPane(mode, { render, count, reset }).

const Coll = (() => {
  const FINISH_ORDER = ["normal", "holo", "gold", "ghost", "diamond", "rainbow"];
  const FINISH_LABELS = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const FINISH_LABELS_LONG = { normal: "Normal", holo: "Holographique", gold: "Doré", ghost: "Ghost Rare", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const QUALITY_ORDER = ["damaged", "worn", "good", "mint"];
  const QUALITY_LABELS = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };

  const SOLD_OUT = "Tous les exemplaires de cette carte ont déjà été distribués.";
  const ERRORS = {
    disenchant: {
      card_not_found: "Carte introuvable.",
      promo_not_disenchantable: "Cette carte promo ne peut pas être décraftée.",
      card_not_owned: "Tu ne possèdes pas cette carte.",
      variant_not_owned: "Cet exemplaire n'est plus dans ta collection."
    },
    craft: {
      card_not_found: "Carte introuvable.",
      promo_not_craftable: "Cette carte promo ne peut pas être craftée.",
      card_inactive: "Cette carte n'est plus disponible.",
      insufficient_dust: "Pas assez de poussières d'étoile.",
      sold_out: SOLD_OUT
    },
    finish: {
      card_not_found: "Carte introuvable.",
      promo_not_upgradable: "Cette carte promo ne peut pas être fusionnée.",
      card_inactive: "Cette carte n'est plus disponible.",
      invalid_finish: "Cette finition ne peut pas être fusionnée davantage.",
      not_enough_duplicates: "Il te faut 5 exemplaires identiques pour fusionner (ou 4 et une pièce détachée).",
      no_spare_part: "Tu n'as plus de pièce détachée (elles se pêchent).",
      sold_out: SOLD_OUT
    },
    quality: {
      card_not_found: "Carte introuvable.",
      promo_not_repairable: "Cette carte promo ne peut pas être restaurée.",
      card_inactive: "Cette carte n'est plus disponible.",
      invalid_quality: "Cette qualité ne peut pas être restaurée davantage.",
      not_enough_duplicates: "Il te faut 3 exemplaires identiques pour restaurer (ou 2 et une pièce détachée).",
      no_spare_part: "Tu n'as plus de pièce détachée (elles se pêchent).",
      sold_out: SOLD_OUT
    },
    trade: {
      user_not_found: "Aucun joueur ne porte ce pseudo.",
      cannot_trade_self: "Tu ne peux pas t'échanger une carte avec toi-même.",
      card_not_owned: "Tu ne possèdes pas cette carte.",
      promo_not_tradeable: "Les cartes promo ne sont pas echangeables."
    },
    showcase: {
      card_not_owned: "Tu ne possèdes pas cette carte.",
      showcase_full: "Ta vitrine est déjà pleine (5 cartes max) : retire-en une avant d'en ajouter une nouvelle."
    },
    altar: {
      not_enough_duplicates: "Tu dois garder au moins 1 exemplaire de chaque carte.",
      mixed_rarity: "Les 3 cartes doivent être de la même rareté.",
      invalid_selection: "Sélection invalide (un exemplaire n'est plus disponible ?).",
      no_target_card: "Toutes les cartes de la rareté supérieure sont épuisées.",
      no_higher_tier: "Cette rareté est déjà la plus haute."
    }
  };
  function errorText(kind, e) {
    return (ERRORS[kind] && ERRORS[kind][e && e.code]) || ("Erreur. (" + (e && e.message) + ")");
  }

  // Modes : cle interne -> ancre d'URL + palier de niveau (FEATURE_UNLOCK_LEVEL).
  const MODES = {
    binder: { hash: "classeur", label: "Classeur" },
    disenchant: { hash: "decrafter", label: "Décrafter" },
    craft: { hash: "crafter", label: "Crafter", lock: "craft" },
    altar: { hash: "autel", label: "Autel", lock: "altar" },
    finish: { hash: "finitions", label: "Finitions", lock: "finish" },
    quality: { hash: "qualite", label: "Qualité", lock: "quality" }
  };
  // Modes qui travaillent sur une grille de cartes filtrable.
  const GRID_MODES = ["binder", "disenchant", "craft"];
  const LAST_MODE_KEY = "2gatcha_collection_mode";
  const PREFS_KEY = "2gatcha_collection_prefs";

  // ---------------------------------------------------------------- outils
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch (e) { return {}; }
  }
  function savePrefs(patch) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch })); } catch (e) {}
  }
  function loadSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch (e) { return new Set(); }
  }
  function saveSet(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch (e) {}
  }

  function normalize(str) {
    return (str || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function serial(n) {
    return "#" + String(n ?? "?").padStart(3, "0");
  }
  function finishOf(c) { return c.finish || "normal"; }
  function qualityOf(c) { return c.quality || "damaged"; }
  function isPrecious(c) { return c.serialNumber === 1 || finishOf(c) === "rainbow" || qualityOf(c) === "mint"; }

  // Montant de decraft reel : valeur de base de la rarete x multiplicateur
  // de finition x multiplicateur de qualite (meme calcul que disenchant.json).
  function estimateDust(baseValue, finish, quality) {
    const fm = state.finishMultipliers[finish] != null ? state.finishMultipliers[finish] : 1;
    const qm = state.qualityMultipliers[quality] != null ? state.qualityMultipliers[quality] : 1;
    return Math.round((baseValue || 0) * fm * qm);
  }

  // Exemplaires d'une carte regroupes par VARIANTE EXACTE (finition +
  // qualite), du moins au plus prestigieux.
  function buildVariants(owned) {
    if (!owned || !owned.copies || !owned.copies.length) return [];
    const map = new Map();
    owned.copies.forEach((c) => {
      const finish = finishOf(c), quality = qualityOf(c);
      const key = finish + "::" + quality;
      if (!map.has(key)) map.set(key, { finish, quality, count: 0, serialNumbers: [], copies: [] });
      const v = map.get(key);
      v.count++;
      v.copies.push(c);
      if (c.serialNumber != null) v.serialNumbers.push(c.serialNumber);
    });
    return [...map.values()].sort((a, b) =>
      (FINISH_ORDER.indexOf(a.finish) - FINISH_ORDER.indexOf(b.finish)) ||
      (QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality)));
  }

  // Exemplaires d'une variante a sacrifier en premier : numeros les plus
  // hauts d'abord, le #001 en tout dernier.
  function copiesToSpend(copies, qty) {
    return [...copies].sort((a, b) => {
      if (a.serialNumber === 1) return 1;
      if (b.serialNumber === 1) return -1;
      return (b.serialNumber || 0) - (a.serialNumber || 0);
    }).slice(0, qty);
  }

  // Bascule 3D + reflet qui suit le curseur (finitions holo/diamant/...).
  function attachTilt(el) {
    const update = (clientX, clientY) => {
      const rect = el.getBoundingClientRect();
      const px = (clientX - rect.left) / rect.width - 0.5;
      const py = (clientY - rect.top) / rect.height - 0.5;
      el.style.setProperty("--ry", `${px * 16}deg`);
      el.style.setProperty("--rx", `${py * -16}deg`);
      el.style.setProperty("--shine-x", `${(px + 0.5) * 100}%`);
      el.style.setProperty("--shine-y", `${(py + 0.5) * 100}%`);
    };
    const reset = () => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
      el.style.setProperty("--shine-x", "50%");
      el.style.setProperty("--shine-y", "50%");
      el.style.willChange = "auto";
    };
    // Pas de suivi tactile : sur mobile, un simple scroll recalculait le
    // style de chaque carte survolee (lag).
    el.addEventListener("mouseenter", () => { el.style.willChange = "transform"; });
    el.addEventListener("mousemove", (e) => update(e.clientX, e.clientY));
    el.addEventListener("mouseleave", reset);
  }

  function rarityBadge(card) {
    const color = card.rarity?.colorHex || "#9aa0b4";
    return `<span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">${rarityIcon(card.rarity?.key)} ${card.rarity?.name || "Commune"}</span>`;
  }

  // ---------------------------------------------------------------- etat
  const state = {
    cards: [],              // catalogue complet (collection), rarete enrichie des couts craft/decraft
    byId: new Map(),
    cardNumber: new Map(),  // numero #001... par extension
    ownedMap: new Map(),    // cardId -> { count, copies: [{ pullId, serialNumber, finish, quality }], finishCounts, qualityCounts, lastObtainedAt }
    protectedMap: new Map(),// cardId -> exemplaires ranges au coffre-fort
    stardust: 0,
    level: 1,
    finishMultipliers: {},
    qualityMultipliers: {},
    wishlist: new Set(),
    showcase: new Set(),
    rarities: [],
    extensions: [],
    stats: { owned: 0, total: 0 },
    sets: [],               // recompenses de set complet (api/src/native/sets.js)
    collectionValue: 0,
    offline: false,
    loaded: false
  };

  const prefs = loadPrefs();
  const filters = { rarity: "all", search: "", extension: prefs.extensionFilter || "", artist: "" };
  const panes = {};
  let mode = "binder";

  function registerPane(name, pane) { panes[name] = pane; }

  // Carte decouverte = possedee en collection OU rangee au coffre-fort : une
  // carte mise a l'abri reste comptee dans la progression et les stats.
  function isDiscovered(cardId) {
    return state.ownedMap.has(cardId) || state.protectedMap.has(cardId);
  }

  function isLocked(m) {
    const lock = MODES[m] && MODES[m].lock;
    return !!lock && state.level < FEATURE_UNLOCK_LEVEL[lock];
  }

  // Cartes passant les filtres partages. ownedOnlySearch : dans le classeur,
  // la recherche ne trouve que les cartes deja decouvertes (pas de nom
  // revele pour une carte jamais obtenue).
  function filterCards(list, { ownedOnlySearch = false } = {}) {
    let out = list;
    if (filters.rarity !== "all") out = out.filter((c) => c.rarity?.key === filters.rarity);
    if (filters.extension) out = out.filter((c) => String(c.extension?.id ?? "") === filters.extension);
    if (filters.artist) out = out.filter((c) => (c.artist || "") === filters.artist);
    if (filters.search) {
      const q = normalize(filters.search);
      out = out.filter((c) => (!ownedOnlySearch || isDiscovered(c.cardId)) && normalize(c.name).includes(q));
    }
    return out;
  }

  // ---------------------------------------------------------------- chargement
  async function fetchAll() {
    const OFFLINE_CACHE_KEY = "2gatcha_offline_collection_" + Session.userId;
    try {
      const [collection, status, catalog, wishlist, showcase, sets] = await Promise.all([
        API.getCollection(Session.userId),
        API.getBoosterStatus(Session.userId).catch(() => ({ stardust: 0 })),
        API.getCards().catch(() => ({ cards: [] })),
        API.listWishlist(Session.userId).catch(() => ({ wishlist: [] })),
        API.listShowcase(Session.userId).catch(() => ({ showcase: [] })),
        API.getSetRewards(Session.userId).catch(() => ({ sets: [] }))
      ]);
      try { localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(collection)); } catch (e) {}
      return { collection, status, catalog, wishlist, showcase, sets, offline: false };
    } catch (e) {
      // Reseau coupe : derniere collection connue plutot qu'un ecran vide.
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(OFFLINE_CACHE_KEY) || "null"); } catch (e2) {}
      if (!cached) throw e;
      return { collection: cached, status: { stardust: 0 }, catalog: { cards: [] }, wishlist: { wishlist: [] }, showcase: { showcase: [] }, sets: { sets: [] }, offline: true };
    }
  }

  function ingest({ collection, status, catalog, wishlist, showcase, sets, offline }) {
    const catalogById = new Map((catalog.cards || []).map((c) => [c.cardId, c]));
    state.cards = (collection.cards || []).map((c) => {
      const cat = catalogById.get(c.cardId);
      return {
        ...c,
        // Couts craft/decraft : seulement pour les cartes du catalogue actif.
        rarity: { ...(c.rarity || {}), ...(cat && cat.rarity ? cat.rarity : {}) },
        isSecret: !!(c.isSecret || (cat && cat.isSecret)),
        inCatalog: !!cat
      };
    });
    state.byId = new Map(state.cards.map((c) => [c.cardId, c]));
    // Numero de catalogue stable PAR EXTENSION, de commune a mythique.
    state.cardNumber = new Map();
    const byExt = new Map();
    state.cards.forEach((c) => {
      const k = c.extension?.id ?? "__none__";
      if (!byExt.has(k)) byExt.set(k, []);
      byExt.get(k).push(c);
    });
    byExt.forEach((cards) => {
      [...cards].sort((a, b) => (a.rarity?.sortOrder ?? 999) - (b.rarity?.sortOrder ?? 999) || a.cardId - b.cardId)
        .forEach((c, i) => state.cardNumber.set(c.cardId, i + 1));
    });
    state.ownedMap = new Map((collection.owned || []).map((o) => [o.cardId, o]));
    state.protectedMap = new Map((collection.protectedCards || []).map((o) => [o.cardId, o.copies || []]));
    state.stardust = status.stardust || 0;
    state.spareParts = status.spareParts || 0;
    state.level = status.xp?.level || state.level || 1;
    knownProfileLevel = state.level;
    state.finishMultipliers = catalog.finishMultipliers || {};
    state.qualityMultipliers = catalog.qualityMultipliers || {};
    state.wishlist = new Set((wishlist.wishlist || []).map((w) => w.cardId));
    state.showcase = new Set((showcase.showcase || []).map((s) => s.cardId));
    state.stats = { owned: state.cards.filter((c) => isDiscovered(c.cardId)).length, total: (collection.stats && collection.stats.total) || state.cards.length };
    state.offline = offline;
    state.sets = (sets && sets.sets) || [];

    const rarityByKey = new Map();
    const extById = new Map();
    state.cards.forEach((c) => {
      if (c.rarity?.key && !rarityByKey.has(c.rarity.key)) rarityByKey.set(c.rarity.key, { key: c.rarity.key, name: c.rarity.name || c.rarity.key, sortOrder: c.rarity.sortOrder ?? 999 });
      if (c.extension && !extById.has(c.extension.id)) extById.set(c.extension.id, c.extension);
    });
    state.rarities = [...rarityByKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    state.extensions = [...extById.values()].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || String(a.name).localeCompare(String(b.name)));
    state.loaded = true;
  }

  // Premier chargement (squelette) ou rechargement silencieux apres une
  // action : l'API repond en quelques ms, inutile de rapiecer l'etat a la main.
  async function load({ silent = false } = {}) {
    const zone = document.getElementById("collection-zone");
    const loading = document.getElementById("loading-zone");
    if (!silent) { loading.style.display = "grid"; zone.style.display = "none"; }
    else zone.classList.add("coll-busy");
    try {
      const data = await fetchAll();
      ingest(data);
      if (data.offline && !silent) Toast.info("Mode hors-ligne : dernière collection connue affichée (peut-être obsolète).");
      renderToolbar();
      renderSummary();
      applyLocks();
      zone.style.display = "block";
      if (!panes[mode] || isLocked(mode)) mode = "binder";
      showMode(mode);
      if (silent && typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (e) {
      Toast.error("Impossible de charger la collection. (" + e.message + ")");
    } finally {
      loading.style.display = "none";
      zone.classList.remove("coll-busy");
    }
  }
  const refresh = () => load({ silent: true });

  // ---------------------------------------------------------------- bandeau
  function renderSummary() {
    const { owned, total } = state.stats;
    document.getElementById("progress-label").textContent = `${owned} / ${total} cartes découvertes` + (state.offline ? " (hors-ligne)" : "");
    document.getElementById("progress-fill").style.width = (total ? Math.round((owned / total) * 100) : 0) + "%";
    document.getElementById("stardust-amount").textContent = state.stardust.toLocaleString("fr-FR");
    renderRarityProgress();
    renderStats();
    renderDustReminder();
    renderSetRewards();
  }

  // Sets complets dont la recompense n'a pas encore ete reclamee.
  function renderSetRewards() {
    const el = document.getElementById("set-reward-banner");
    const ready = state.sets.filter((x) => x.complete && !x.claimed);
    if (!ready.length) { el.style.display = "none"; return; }
    el.style.display = "";
    el.innerHTML = ready.map((x) => `
      <div class="set-reward-row">
        <span>&#127942; <strong>Set complet : ${escapeHtml(x.name)}</strong> (${x.total} cartes) ! Récompense : ${x.reward.boosters} booster${x.reward.boosters > 1 ? "s" : ""} + ${x.reward.dust} poussières, et un badge sur ton profil.</span>
        <button type="button" class="btn" data-claim-set="${x.extensionId}">&#127873; Réclamer</button>
      </div>`).join("");
  }

  async function claimSet(extensionId, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await API.claimSetReward(Session.userId, extensionId);
      Toast.success(`&#127942; Set ${res.name} complété : +${res.boosters} booster${res.boosters > 1 ? "s" : ""} et +${res.dust} poussières !`);
      if (typeof confetti === "function") confetti({ particleCount: 180, spread: 120, origin: { y: 0.5 } });
      await refresh();
      if (typeof loadNavBadges === "function") loadNavBadges();
    } catch (e) {
      if (btn) btn.disabled = false;
      Toast.error({ set_incomplete: "Il manque encore des cartes à ce set.", already_claimed: "Récompense déjà récupérée." }[e.code] || ("Erreur. (" + e.message + ")"));
    }
  }

  // Valeur estimee (poussieres au decraft) de tous les exemplaires possedes,
  // coffre-fort compris ; un point par jour garde en local pour l'evolution.
  function computeValue() {
    let value = 0;
    const add = (card, finish, quality) => {
      if (!card || card.isPromo || card.rarity?.disenchantValue == null) return;
      value += estimateDust(card.rarity.disenchantValue, finish, quality);
    };
    state.ownedMap.forEach((o, id) => (o.copies || []).forEach((c) => add(state.byId.get(id), finishOf(c), qualityOf(c))));
    state.protectedMap.forEach((copies, id) => copies.forEach((c) => add(state.byId.get(id), finishOf(c), "mint")));
    return value;
  }
  function valueTrend(value) {
    if (state.offline) return null;
    const key = "2gatcha_coll_value_" + Session.userId;
    let hist = {};
    try { hist = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) {}
    const today = new Date().toISOString().slice(0, 10);
    hist[today] = value;
    const daysKept = Object.keys(hist).sort().slice(-40);
    hist = Object.fromEntries(daysKept.map((d) => [d, hist[d]]));
    try { localStorage.setItem(key, JSON.stringify(hist)); } catch (e) {}
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const ref = daysKept.filter((d) => d < today && d >= weekAgo)[0] || daysKept.filter((d) => d < today).slice(-1)[0];
    if (!ref) return null;
    return { delta: value - hist[ref], since: ref };
  }

  function rarityBuckets() {
    const byRarity = new Map();
    state.cards.forEach((c) => {
      const key = c.rarity?.key || "commune";
      if (!byRarity.has(key)) byRarity.set(key, { key, name: c.rarity?.name || key, colorHex: c.rarity?.colorHex || "#9aa0b4", sortOrder: c.rarity?.sortOrder || 0, total: 0, owned: 0 });
      const entry = byRarity.get(key);
      entry.total++;
      if (isDiscovered(c.cardId)) entry.owned++;
    });
    return [...byRarity.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Une ligne par rarete, cliquable : filtre la grille sur cette rarete.
  function renderRarityProgress() {
    const el = document.getElementById("rarity-progress");
    el.innerHTML = rarityBuckets().map((r) => {
      const pct = r.total ? Math.round((r.owned / r.total) * 100) : 0;
      return `
        <button type="button" class="rarity-progress-row coll-rarity-row ${filters.rarity === r.key ? "active" : ""}" data-rarity-filter="${r.key}" title="Afficher seulement les ${escapeHtml(r.name)}">
          <span class="rp-label" style="color:${r.colorHex};">${escapeHtml(r.name)}</span>
          <span class="rp-track"><span class="rp-fill" style="width:${pct}%;background:${r.colorHex};"></span></span>
          <span class="rp-count">${r.owned}/${r.total}</span>
        </button>`;
    }).join("");
  }

  function renderStats() {
    let totalCopies = 0;
    let bestRarity = null;
    let discovered = 0;
    state.cards.forEach((c) => {
      if (!isDiscovered(c.cardId)) return;
      discovered++;
      // Exemplaires au coffre inclus : ils appartiennent toujours au joueur.
      totalCopies += (state.ownedMap.get(c.cardId)?.count || 0) + (state.protectedMap.get(c.cardId) || []).length;
      if (!bestRarity || (c.rarity?.sortOrder || 0) > bestRarity.sortOrder) bestRarity = { name: c.rarity?.name || "Commune", sortOrder: c.rarity?.sortOrder || 0, colorHex: c.rarity?.colorHex || "#9aa0b4" };
    });
    const buckets = rarityBuckets();
    const legendary = buckets.find((r) => normalize(r.name) === "legendaire");
    const legendaryShare = totalCopies && legendary ? Math.round((legendary.owned / totalCopies) * 100) : 0;
    const duplicates = totalCopies - discovered;
    // Halo du panel : couleur de la carte la plus rare possedee.
    const value = computeValue();
    state.collectionValue = value;
    const trend = valueTrend(value);
    const panelEl = document.querySelector(".panel");
    if (panelEl && bestRarity) panelEl.style.setProperty("--rarity-glow", bestRarity.colorHex);
    document.getElementById("stats-grid").innerHTML = `
      <div class="stat-tile"><div class="stat-value">${discovered}</div><div class="stat-label">Cartes uniques</div></div>
      <div class="stat-tile"><div class="stat-value">${totalCopies}</div><div class="stat-label">Exemplaires au total</div></div>
      <div class="stat-tile"><div class="stat-value">${duplicates}</div><div class="stat-label">Doublons</div></div>
      <div class="stat-tile"><div class="stat-value" style="color:${bestRarity?.colorHex || "inherit"};">${bestRarity ? escapeHtml(bestRarity.name) : "-"}</div><div class="stat-label">Meilleur pull</div></div>
      <div class="stat-tile"><div class="stat-value">${legendaryShare}%</div><div class="stat-label">Part de légendaires</div></div>
      <div class="stat-tile coll-value-tile" title="Total des poussières que rapporterait le décraft de tous tes exemplaires (coffre-fort compris)"><div class="stat-value">&#10024; ${value.toLocaleString("fr-FR")}</div><div class="stat-label">Valeur estimée${trend && trend.delta ? ` <span class="coll-value-trend ${trend.delta > 0 ? "up" : "down"}">${trend.delta > 0 ? "+" : ""}${trend.delta.toLocaleString("fr-FR")} depuis le ${new Date(trend.since).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>` : ""}</div></div>`;

    const milestoneEl = document.getElementById("milestone-banner");
    const next = buckets.filter((r) => r.owned < r.total).sort((a, b) => (a.total - a.owned) - (b.total - b.owned))[0];
    milestoneEl.style.display = "flex";
    if (next) {
      const missing = next.total - next.owned;
      milestoneEl.innerHTML = `<span>&#127919; Encore <strong>${missing} carte${missing > 1 ? "s" : ""} ${escapeHtml(next.name)}</strong> pour compléter cette rareté !</span>`;
    } else {
      milestoneEl.innerHTML = "<span>&#127942; Collection complète, félicitations !</span>";
    }
  }

  // Poussieres qui dorment : assez pour crafter au moins une carte manquante.
  function renderDustReminder() {
    const el = document.getElementById("unused-dust-reminder");
    const missing = state.cards.filter((c) => c.inCatalog && !c.isPromo && !isDiscovered(c.cardId) && c.rarity?.craftCost != null);
    const affordable = missing.filter((c) => state.stardust >= c.rarity.craftCost);
    if (!affordable.length || mode === "craft" || isLocked("craft")) { el.style.display = "none"; return; }
    const cheapest = Math.min(...affordable.map((c) => c.rarity.craftCost));
    el.style.display = "flex";
    el.innerHTML = `<span>&#10024; Tes poussières suffisent pour crafter <strong>${affordable.length} carte${affordable.length > 1 ? "s" : ""} manquante${affordable.length > 1 ? "s" : ""}</strong> (dès ${cheapest}).</span>
      <button type="button" class="btn-secondary coll-reminder-btn" data-goto-mode="craft" data-missing-only="1">Voir les cartes à crafter</button>`;
  }

  // ---------------------------------------------------------------- barre d'outils
  function renderToolbar() {
    const el = document.getElementById("rarity-filters");
    el.innerHTML = [{ key: "all", name: "Toutes" }, ...state.rarities].map(({ key, name }) =>
      `<button type="button" data-filter="${key}" class="btn-secondary ${key === filters.rarity ? "active" : ""}">${escapeHtml(name)}</button>`).join("");

    const ext = document.getElementById("extension-filter");
    ext.innerHTML = `<option value="">Toutes les extensions</option>` + state.extensions.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("");
    if (!state.extensions.some((x) => String(x.id) === filters.extension)) filters.extension = "";
    ext.value = filters.extension;
    ext.style.display = state.extensions.length > 1 ? "" : "none";

    const artist = document.getElementById("artist-filter");
    const artists = [...new Set(state.cards.map((c) => c.artist).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    artist.innerHTML = `<option value="">Tous les artistes</option>` + artists.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
    if (!artists.includes(filters.artist)) filters.artist = "";
    artist.value = filters.artist;
  }

  function setRarityFilter(key) {
    filters.rarity = key;
    document.querySelectorAll("#rarity-filters button").forEach((b) => b.classList.toggle("active", b.dataset.filter === key));
    document.querySelectorAll("[data-rarity-filter]").forEach((b) => b.classList.toggle("active", b.dataset.rarityFilter === key));
    renderActive();
  }

  // ---------------------------------------------------------------- modes
  function applyLocks() {
    document.querySelectorAll(".coll-mode").forEach((btn) => {
      const m = btn.dataset.mode;
      const locked = isLocked(m);
      btn.classList.toggle("locked", locked);
      btn.title = locked ? `Débloqué au niveau ${FEATURE_UNLOCK_LEVEL[MODES[m].lock]}` : "";
    });
  }

  function updateCounts() {
    document.querySelectorAll(".coll-mode").forEach((btn) => {
      const pane = panes[btn.dataset.mode];
      const span = btn.querySelector(".tab-count");
      if (!span) return;
      const n = pane && pane.count && !isLocked(btn.dataset.mode) ? pane.count() : 0;
      span.textContent = n ? String(n) : "";
    });
  }

  function renderActive() {
    if (panes[mode]) panes[mode].render();
    updateCounts();
  }

  // Affiche un mode sans verification (deja validee par setMode / load).
  function showMode(m) {
    mode = m;
    document.querySelectorAll(".coll-mode").forEach((btn) => {
      const on = btn.dataset.mode === m;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
      btn.tabIndex = on ? 0 : -1;
      // Onglets defilants sur mobile : l'onglet actif reste visible.
      // (defilement horizontal de la barre seule : jamais de saut de page).
      if (on) {
        const nav = btn.parentElement;
        const b = btn.getBoundingClientRect(), n = nav.getBoundingClientRect();
        if (b.left < n.left) nav.scrollLeft -= n.left - b.left + 8;
        else if (b.right > n.right) nav.scrollLeft += b.right - n.right + 8;
      }
    });
    document.querySelectorAll(".coll-pane").forEach((p) => { p.style.display = p.id === "pane-" + m ? "" : "none"; });
    document.getElementById("shared-toolbar").style.display = GRID_MODES.includes(m) ? "" : "none";
    document.querySelectorAll("[data-only-mode]").forEach((el) => {
      el.style.display = el.dataset.onlyMode.split(" ").includes(m) ? "" : "none";
    });
    // Tri du classeur seulement (decraft / craft ont leur propre ordre utile).
    document.getElementById("sort-select").style.display = m === "binder" ? "" : "none";
    document.getElementById("search-input").placeholder = m === "craft" ? "Rechercher une carte à crafter..." : m === "disenchant" ? "Rechercher parmi mes cartes..." : "Rechercher une carte...";
    document.body.dataset.collMode = m;
    renderDustReminder();
    renderActive();
  }

  function setMode(m, { fromHash = false } = {}) {
    if (!MODES[m]) m = "binder";
    if (isLocked(m)) {
      const lock = MODES[m].lock;
      Toast.info(`${FEATURE_LABELS[lock] || MODES[m].label} se débloque au niveau ${FEATURE_UNLOCK_LEVEL[lock]} (tu es niveau ${state.level}).`);
      if (fromHash) m = "binder"; else return;
    }
    try { localStorage.setItem(LAST_MODE_KEY, m); } catch (e) {}
    const hash = "#" + MODES[m].hash;
    if (window.location.hash !== hash) history.replaceState(null, "", window.location.pathname + window.location.search + hash);
    if (state.loaded) showMode(m); else mode = m;
  }

  function modeFromHash() {
    const h = window.location.hash.replace(/^#/, "");
    return Object.keys(MODES).find((m) => MODES[m].hash === h) || null;
  }

  function initialMode() {
    const fromHash = modeFromHash();
    if (fromHash) return fromHash;
    try { return localStorage.getItem(LAST_MODE_KEY) || "binder"; } catch (e) { return "binder"; }
  }

  // ?cardId=... (recherche globale, liens directs) : met la carte en evidence
  // dans le mode affiche, une seule fois apres le premier rendu.
  function highlightFromQuery() {
    const cardId = new URLSearchParams(window.location.search).get("cardId");
    if (!cardId) return;
    const pane = document.getElementById("pane-" + mode);
    const el = pane && pane.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`);
    if (!el) return;
    const group = el.closest(".collection-ext-group.collapsed");
    if (group) group.classList.remove("collapsed");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("highlighted");
    setTimeout(() => el.classList.remove("highlighted"), 2600);
  }

  function resetFilters() {
    filters.rarity = "all";
    filters.search = "";
    filters.extension = "";
    filters.artist = "";
    savePrefs({ extensionFilter: "", hideStats: false });
    document.getElementById("search-input").value = "";
    document.body.classList.remove("hide-stats");
    applyStatsLabel(false);
    Object.values(panes).forEach((p) => p.reset && p.reset());
    renderToolbar();
    renderRarityProgress();
    renderActive();
    Toast.info("Filtres réinitialisés.");
  }

  function applyStatsLabel(hidden) {
    const btn = document.getElementById("stats-toggle");
    btn.innerHTML = hidden ? "&#128202; Afficher les stats" : "&#128202; Masquer les stats";
    btn.setAttribute("aria-expanded", String(!hidden));
  }

  // ---------------------------------------------------------------- init
  function init() {
    if (!Session.isLoggedIn()) {
      document.getElementById("guest-warning").style.display = "block";
      return;
    }
    mode = initialMode();
    const hashMode = modeFromHash();

    if (prefs.hideStats) { document.body.classList.add("hide-stats"); applyStatsLabel(true); }
    document.getElementById("stats-toggle").addEventListener("click", () => {
      const hidden = document.body.classList.toggle("hide-stats");
      savePrefs({ hideStats: hidden });
      applyStatsLabel(hidden);
    });

    const nav = document.querySelector(".coll-modes");
    nav.addEventListener("click", (e) => {
      const btn = e.target.closest(".coll-mode");
      if (btn) setMode(btn.dataset.mode);
    });
    // Fleches gauche/droite entre les onglets (pattern ARIA tablist).
    nav.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const btns = [...nav.querySelectorAll(".coll-mode:not(.locked)")];
      const i = btns.findIndex((b) => b.dataset.mode === mode);
      const next = btns[(i + (e.key === "ArrowRight" ? 1 : -1) + btns.length) % btns.length];
      if (next) { setMode(next.dataset.mode); next.focus(); }
    });
    window.addEventListener("hashchange", () => {
      const m = modeFromHash();
      if (m && m !== mode) setMode(m, { fromHash: true });
    });

    document.getElementById("rarity-filters").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-filter]");
      if (btn) setRarityFilter(btn.dataset.filter);
    });
    document.getElementById("rarity-progress").addEventListener("click", (e) => {
      const row = e.target.closest("[data-rarity-filter]");
      if (!row) return;
      const key = row.dataset.rarityFilter;
      setRarityFilter(filters.rarity === key ? "all" : key);
      if (!GRID_MODES.includes(mode)) setMode("binder");
    });
    let searchTimer = null;
    document.getElementById("search-input").addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { filters.search = e.target.value; renderActive(); }, 150);
    });
    document.getElementById("extension-filter").addEventListener("change", (e) => {
      filters.extension = e.target.value;
      savePrefs({ extensionFilter: filters.extension });
      renderActive();
    });
    document.getElementById("artist-filter").addEventListener("change", (e) => { filters.artist = e.target.value; renderActive(); });
    document.getElementById("reset-filters-btn").addEventListener("click", resetFilters);
    document.getElementById("set-reward-banner").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-claim-set]");
      if (btn) claimSet(Number(btn.dataset.claimSet), btn);
    });
    document.getElementById("unused-dust-reminder").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-goto-mode]");
      if (!btn) return;
      if (btn.dataset.missingOnly && panes.craft && panes.craft.showMissingOnly) panes.craft.showMissingOnly();
      setMode(btn.dataset.gotoMode);
    });

    load().then(() => {
      if (hashMode && isLocked(hashMode)) setMode(hashMode, { fromHash: true });
      highlightFromQuery();
    });
  }

  document.addEventListener("DOMContentLoaded", init);

  return {
    FINISH_ORDER, FINISH_LABELS, FINISH_LABELS_LONG, QUALITY_ORDER, QUALITY_LABELS,
    state, filters, prefs,
    get mode() { return mode; },
    registerPane, setMode, isLocked, isDiscovered, claimSet, refresh, renderActive, updateCounts, renderSummary,
    filterCards, errorText, estimateDust, buildVariants, copiesToSpend, attachTilt,
    normalize, escapeHtml, serial, finishOf, qualityOf, isPrecious, rarityBadge,
    loadPrefs, savePrefs, loadSet, saveSet
  };
})();
