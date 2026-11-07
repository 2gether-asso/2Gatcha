// Collection V2 (2026-11-07) : ce qui entoure les grilles.
//  - Rail des extensions (progression, pages d'album a reclamer, set complet) :
//    un clic filtre la grille sur l'extension (meme menu que la barre d'outils).
//  - Pages d'album recompensees (api/src/native/collection-v2.js) : etat
//    charge apres chaque chargement de la collection (evenement coll:loaded),
//    reclamation par page (album) ou tout d'un coup (bandeau).
//  - Bandeau : pages a reclamer, valeur de la collection.
//  - Atelier : une ligne d'aide sous chaque outil ("12 doublons", "3 cartes
//    craftables"...) pour savoir tout de suite ou agir.
//  - Menus Filtres / Affichage (un seul ouvert, fermes au clic dehors),
//    compteur de filtres actifs, vignettes "par carte" ou "par exemplaire".
// Donnees : Coll (collection-core.js) ; rendu des grilles : binder / workshop.

const CollV2 = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escHtml(s);
  const state = Coll.state;
  let albumBusy = false;

  // ------------------------------------------------------------ pages d'album
  async function loadAlbum() {
    if (state.offline) return;
    try {
      const before = JSON.stringify(state.album || null);
      state.album = await API.albumPages(Session.userId, "status");
      renderRail(); renderHeroChips();
      // Album ouvert : les en-tetes de page dependent de ces donnees.
      if (before !== JSON.stringify(state.album) && Coll.mode === "binder" && document.body.classList.contains("album-view")) Coll.renderActive();
    } catch (e) { /* ancien serveur : pas de pages recompensees */ }
  }
  function gained(c) {
    return [c.boosters ? `+${c.boosters} jeton${c.boosters > 1 ? "s" : ""} booster` : "", c.dust ? `+${c.dust} poussières` : ""].filter(Boolean).join(" et ");
  }
  async function claimPage(extensionId, page, btn) {
    if (albumBusy) return;
    albumBusy = true;
    if (btn) btn.disabled = true;
    try {
      const res = await API.albumPages(Session.userId, "claim", extensionId, page);
      state.album = res;
      Toast.success(`&#128214; Page ${page} de ${esc(res.extensionName || "l'album")} complète : ${gained(res.claimed)} !`);
      if (typeof confetti === "function") confetti({ particleCount: 90, spread: 80, origin: { y: 0.6 } });
      await Coll.refresh();
    } catch (e) {
      if (btn) btn.disabled = false;
      Toast.error({ page_incomplete: "Il manque encore des cartes sur cette page.", already_claimed: "Page déjà récompensée." }[e.code] || friendlyError(e));
    } finally { albumBusy = false; }
  }
  async function claimAll(btn) {
    if (albumBusy) return;
    albumBusy = true;
    if (btn) btn.disabled = true;
    try {
      const res = await API.albumPages(Session.userId, "claimAll");
      state.album = res;
      Toast.success(`&#128214; ${res.claimed.pages} page${res.claimed.pages > 1 ? "s" : ""} d'album récompensée${res.claimed.pages > 1 ? "s" : ""} : ${gained(res.claimed)} !`);
      if (typeof confetti === "function") confetti({ particleCount: 140, spread: 110, origin: { y: 0.5 } });
      await Coll.refresh();
    } catch (e) {
      if (btn) btn.disabled = false;
      Toast.error(e.code === "nothing_to_claim" ? "Aucune page à récompenser pour l'instant." : friendlyError(e));
    } finally { albumBusy = false; }
  }

  // ------------------------------------------------------------ rail
  function extStats() {
    const map = new Map();
    state.cards.forEach((c) => {
      if (!c.extension) return;
      const e = map.get(c.extension.id) || { ext: c.extension, owned: 0, total: 0 };
      e.total++;
      if (Coll.isDiscovered(c.cardId)) e.owned++;
      map.set(c.extension.id, e);
    });
    return state.extensions.map((x) => map.get(x.id)).filter(Boolean);
  }
  function renderRail() {
    const rail = $("cv2-rail");
    if (!rail || !state.loaded) return;
    const list = extStats();
    if (list.length < 2) { rail.hidden = true; document.body.classList.remove("cv2-has-rail"); return; }
    rail.hidden = false;
    document.body.classList.add("cv2-has-rail");
    const cur = Coll.filters.extension;
    const pages = new Map(((state.album && state.album.extensions) || []).map((e) => [e.extensionId, e]));
    const owned = state.stats.owned, total = state.stats.total;
    const item = (id, name, o, t, extra) => {
      const pct = t ? Math.round((o / t) * 100) : 0;
      return `<button type="button" class="cv2-rail-item ${String(cur) === String(id) ? "on" : ""} ${t && o === t ? "done" : ""}" data-rail-ext="${id}" aria-pressed="${String(cur) === String(id)}" style="--p:${pct}">
        <span class="cv2-rail-name">${esc(name)}</span>
        <span class="cv2-rail-meta"><span>${o}/${t}</span>${extra}</span>
        <span class="cv2-rail-bar" aria-hidden="true"><span></span></span>
      </button>`;
    };
    rail.innerHTML = `<div class="cv2-rail-title">Extensions</div>`
      + item("", "Toutes", owned, total, "")
      + list.map((e) => {
        const pg = pages.get(e.ext.id);
        const set = state.sets.find((x) => x.extensionId === e.ext.id);
        const extra = (pg && pg.claimable ? `<span class="cv2-rail-gift" title="${pg.claimable} page${pg.claimable > 1 ? "s" : ""} d'album à récompenser">&#127873; ${pg.claimable}</span>` : "")
          + (set && set.complete ? `<span class="cv2-rail-set" title="${set.claimed ? "Set complet" : "Set complet : récompense à récupérer"}">&#127942;${set.claimed ? "" : "!"}</span>` : "")
          + (pg ? `<span class="cv2-rail-pages" title="Pages d'album complètes">&#128214; ${pg.pages.filter((p) => p.complete).length}/${pg.pages.length}</span>` : "");
        return item(e.ext.id, e.ext.name, e.owned, e.total, extra);
      }).join("");
  }
  function pickExtension(id) {
    const sel = $("extension-filter");
    if (!sel) return;
    sel.value = id;
    if (sel._fancyRefresh) sel._fancyRefresh();
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    renderRail();
    const grid = $("collection-grid");
    if (grid && grid.getBoundingClientRect().top < 0) grid.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------ bandeau
  function renderHeroChips() {
    const box = $("cv2-hero-chips");
    if (!box || !state.loaded) return;
    const chips = [];
    const n = state.album ? state.album.claimable : 0;
    if (n) chips.push(`<button type="button" class="cv2-chip gift" data-album-claim-all>&#127873; ${n} page${n > 1 ? "s" : ""} d'album à récompenser</button>`);
    const sets = state.sets.filter((x) => x.complete && !x.claimed).length;
    if (sets) chips.push(`<span class="cv2-chip">&#127942; ${sets} set${sets > 1 ? "s" : ""} complet${sets > 1 ? "s" : ""} à réclamer</span>`);
    if (state.collectionValue) chips.push(`<span class="cv2-chip" title="Poussières que rapporterait le décraft de tous tes exemplaires, coffre compris">&#10024; valeur ${state.collectionValue.toLocaleString("fr-FR")}</span>`);
    const vault = [...state.protectedMap.values()].reduce((a, l) => a + l.length, 0);
    if (vault) chips.push(`<a class="cv2-chip" href="coffre.html">&#128274; ${vault} au coffre</a>`);
    box.innerHTML = chips.join("");
  }

  // ------------------------------------------------------------ atelier
  function hints() {
    const out = { disenchant: "", craft: "", quality: "", finish: "", altar: "" };
    let dupes = 0;
    const byRarity = new Map();
    let quality = 0, finish = 0;
    state.ownedMap.forEach((o, id) => {
      const card = state.byId.get(id);
      if (!card || card.isPromo) return;
      const extra = Math.max(0, (o.count || 0) - 1);
      dupes += extra;
      const r = card.rarity?.key || "?";
      byRarity.set(r, (byRarity.get(r) || 0) + extra);
      Object.entries(o.qualityCounts || {}).forEach(([q, n]) => { if (q !== "mint" && n >= 3) quality++; });
      Object.entries(o.finishCounts || {}).forEach(([f, n]) => { if (f !== "rainbow" && n >= 5) finish++; });
    });
    const missing = state.cards.filter((c) => c.inCatalog && !c.isPromo && !Coll.isDiscovered(c.cardId) && c.rarity?.craftCost != null);
    const affordable = missing.filter((c) => Coll.canCraftNow(c)).length;
    const triples = [...byRarity.values()].reduce((a, n) => a + Math.floor(n / 3), 0);
    out.disenchant = dupes ? `${dupes} doublon${dupes > 1 ? "s" : ""}` : "aucun doublon";
    out.craft = affordable ? `${affordable} à portée` : missing.length ? `${missing.length} manquante${missing.length > 1 ? "s" : ""}` : "rien à crafter";
    out.quality = quality ? `${quality} restauration${quality > 1 ? "s" : ""} possible${quality > 1 ? "s" : ""}` : "3 identiques requis";
    out.finish = finish ? `${finish} fusion${finish > 1 ? "s" : ""} possible${finish > 1 ? "s" : ""}` : "5 identiques requis";
    out.altar = triples ? `${triples} offrande${triples > 1 ? "s" : ""}` : "3 doublons requis";
    return out;
  }
  function renderHints() {
    if (!state.loaded) return;
    const h = hints();
    document.querySelectorAll(".cv2-tool-hint[data-hint]").forEach((el) => {
      const btn = el.closest(".coll-mode");
      const t = btn && btn.classList.contains("locked") ? (btn.title || "verrouillé") : h[el.dataset.hint] || "";
      if (el.textContent !== t) el.textContent = t; // jamais d'ecriture inutile : l'observateur ci-dessous relancerait
    });
    // Compteurs des deux espaces : nouveautes du classeur, actions de l'atelier.
    const n = (m) => { const b = document.querySelector(`.coll-mode[data-mode="${m}"] .tab-count`); return b ? Number(b.textContent) || 0 : 0; };
    const bn = $("cv2-top-binder-n"), wn = $("cv2-top-ws-n");
    const set = (el, v) => { if (el && el.textContent !== String(v)) el.textContent = v; };
    set(bn, n("binder") || "");
    set(wn, ["disenchant", "craft", "quality", "finish", "altar"].reduce((a, m) => a + n(m), 0) || "");
  }

  // ------------------------------------------------------------ menus
  function activeFilters() {
    const pop = $("cv2-filters");
    if (!pop) return 0;
    const mode = Coll.mode;
    const inMode = (el) => { const row = el.closest("[data-only-mode]"); return !row || row.dataset.onlyMode.split(" ").includes(mode); };
    let n = 0;
    pop.querySelectorAll("select").forEach((s) => { if (s.value && inMode(s)) n++; });
    pop.querySelectorAll(".btn-secondary.active").forEach((b) => { if (inMode(b) && !b.closest("#rarity-filters")) n++; });
    if (Coll.filters.rarity !== "all") n++;
    return n;
  }
  function paintCount() {
    const el = $("adv-count");
    if (!el) return;
    const n = activeFilters();
    el.textContent = n; el.hidden = !n;
  }
  function paintGroup() {
    const g = Coll.prefs.cv2Group === "variant" ? "variant" : "card";
    document.querySelectorAll("[data-group]").forEach((b) => { const on = b.dataset.group === g; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  }

  function init() {
    if (!Session.isLoggedIn()) return;
    document.addEventListener("coll:loaded", () => { renderRail(); renderHeroChips(); renderHints(); paintCount(); loadAlbum(); });
    // Les compteurs des onglets changent a chaque rendu (filtres, actions).
    const tools = document.querySelector(".coll-modes");
    let hintRaf = 0;
    if (tools) new MutationObserver(() => { if (!hintRaf) hintRaf = requestAnimationFrame(() => { hintRaf = 0; renderHints(); }); }).observe(tools, { subtree: true, childList: true, characterData: true });
    $("cv2-rail")?.addEventListener("click", (e) => { const b = e.target.closest("[data-rail-ext]"); if (b) pickExtension(b.dataset.railExt); });
    $("extension-filter")?.addEventListener("change", () => setTimeout(renderRail, 0));
    $("cv2-hero-chips")?.addEventListener("click", (e) => { const b = e.target.closest("[data-album-claim-all]"); if (b) claimAll(b); });
    // Un seul menu ouvert ; clic dehors ou Echap : ferme.
    const pops = [...document.querySelectorAll(".cv2-pop")];
    pops.forEach((d) => d.addEventListener("toggle", () => { if (d.open) pops.forEach((o) => { if (o !== d) o.open = false; }); }));
    document.addEventListener("click", (e) => { pops.forEach((d) => { if (d.open && !d.contains(e.target)) d.open = false; }); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") pops.forEach((d) => { d.open = false; }); });
    const bar = $("shared-toolbar");
    bar?.addEventListener("change", () => setTimeout(paintCount, 0));
    bar?.addEventListener("click", () => setTimeout(paintCount, 0));
    paintGroup();
    document.querySelectorAll("[data-group]").forEach((b) => b.addEventListener("click", () => {
      Coll.prefs.cv2Group = b.dataset.group;
      Coll.savePrefs({ cv2Group: b.dataset.group });
      paintGroup();
      Coll.renderActive();
    }));
  }
  document.addEventListener("DOMContentLoaded", init);

  return { claimPage, claimAll, loadAlbum };
})();
window.CollV2 = CollV2;
