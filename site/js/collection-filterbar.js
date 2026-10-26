// Collection (2026-10-26) : filtres actifs en pastilles et barre collante.
//  - Pastilles : chaque filtre en cours (rarete, recherche, extension,
//    artiste, finition, etat, edition, #001, manquantes, favoris) au-dessus
//    de la grille, une croix pour le retirer, "Tout effacer".
//  - Barre collante : quand la barre d'outils sort de l'ecran, une barre
//    compacte reste sous l'en-tete (recherche, pastilles, retour aux filtres).
// Le module lit et pilote les controles existants (memes evenements qu'un
// clic ou une saisie) : collection-core.js reste la seule source des filtres.

(function () {
  const $ = (id) => document.getElementById(id);
  const SELECTS = [["extension-filter", "📦"], ["artist-filter", "🎨"], ["finish-filter", "✨"], ["quality-filter", "🧽"], ["edition-filter", "🏷️"]];
  const TOGGLES = [["first-serial-toggle", "#001"], ["missing-toggle", "Manquantes"], ["favorites-toggle", "★ Favoris"], ["hide-owned-toggle", "Manquantes"]];
  const GRID_MODES = ["binder", "disenchant", "craft"];
  const currentMode = () => { const b = document.querySelector(".coll-mode.active, .coll-mode[aria-selected='true']"); return b ? b.dataset.mode : "binder"; };
  // Un controle compte s'il appartient au mode affiche (lignes data-only-mode),
  // meme replie sur telephone.
  const inMode = (el) => { const row = el && el.closest("[data-only-mode]"); return !row || row.dataset.onlyMode.split(" ").includes(currentMode()); };

  function active() {
    const out = [];
    const r = document.querySelector("#rarity-filters button.active");
    if (r && r.dataset.filter !== "all") out.push({ label: r.textContent.trim(), clear: () => { const all = document.querySelector('#rarity-filters [data-filter="all"]'); if (all) all.click(); } });
    const q = $("search-input");
    if (q && q.value.trim()) out.push({ label: `« ${q.value.trim()} »`, clear: () => { q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); } });
    SELECTS.forEach(([id, icon]) => {
      const s = $(id);
      if (!s || !s.value || s.style.display === "none" || !inMode(s)) return;
      const opt = s.options[s.selectedIndex];
      out.push({ label: `${icon} ${opt ? opt.textContent.trim() : s.value}`, clear: () => { s.value = ""; s.dispatchEvent(new Event("change", { bubbles: true })); if (s._fancyRefresh) s._fancyRefresh(); } });
    });
    TOGGLES.forEach(([id, label]) => { const b = $(id); if (b && b.classList.contains("active") && inMode(b)) out.push({ label, clear: () => b.click() }); });
    return out;
  }

  let items = [];
  function chipsHtml() {
    return items.map((it, i) => `<button type="button" class="coll-chip" data-chip="${i}" title="Retirer ce filtre">${escHtml(it.label)} <span aria-hidden="true">✕</span></button>`).join("")
      + (items.length > 1 ? `<button type="button" class="coll-chip clear-all" data-chip="all">Tout effacer</button>` : "");
  }
  function render() {
    items = GRID_MODES.includes(currentMode()) ? active() : [];
    const html = chipsHtml();
    const box = $("coll-chips");
    if (box) { box.innerHTML = html; box.hidden = !items.length; }
    const sbox = document.querySelector("#coll-sticky .coll-sticky-chips");
    if (sbox) sbox.innerHTML = html;
    const sq = document.querySelector("#coll-sticky input");
    const q = $("search-input");
    if (sq && q && document.activeElement !== sq) { sq.value = q.value; sq.placeholder = q.placeholder; }
  }
  const later = () => setTimeout(render, 0);
  function onChip(e) {
    const b = e.target.closest("[data-chip]");
    if (!b) return;
    if (b.dataset.chip === "all") {
      [...items].reverse().forEach((it) => it.clear());
    } else { const it = items[Number(b.dataset.chip)]; if (it) it.clear(); }
    later();
  }

  // Barre collante.
  function sticky() {
    const bar = document.createElement("div");
    bar.id = "coll-sticky";
    bar.className = "coll-sticky";
    bar.hidden = true;
    bar.innerHTML = `<input type="search" aria-label="Rechercher une carte" autocomplete="off" />
      <div class="coll-sticky-chips"></div>
      <button type="button" class="btn-ghost coll-sticky-up" title="Remonter aux filtres">⚙️ Filtres ↑</button>`;
    document.body.appendChild(bar);
    const input = bar.querySelector("input");
    input.addEventListener("input", () => { const q = $("search-input"); if (!q) return; q.value = input.value; q.dispatchEvent(new Event("input", { bubbles: true })); later(); });
    bar.querySelector(".coll-sticky-up").addEventListener("click", () => { const t = $("shared-toolbar"); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); });
    bar.querySelector(".coll-sticky-chips").addEventListener("click", onChip);
    let raf = 0;
    const check = () => {
      raf = 0;
      const tb = $("shared-toolbar"), header = $("site-header");
      if (!tb || !GRID_MODES.includes(currentMode()) || tb.offsetParent === null) { bar.hidden = true; return; }
      const top = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      const r = tb.getBoundingClientRect();
      const panes = [...document.querySelectorAll(".coll-pane")].find((p) => p.offsetParent !== null);
      const pr = panes ? panes.getBoundingClientRect() : null;
      const show = r.bottom < top && (!pr || pr.bottom > top + 120);
      bar.style.top = `${top}px`;
      if (show === bar.hidden) { bar.hidden = !show; if (show) render(); }
    };
    window.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(check); }, { passive: true });
    window.addEventListener("resize", () => { if (!raf) raf = requestAnimationFrame(check); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const tb = $("shared-toolbar");
    if (!tb) return;
    const box = document.createElement("div");
    box.id = "coll-chips";
    box.className = "coll-chips";
    box.hidden = true;
    box.setAttribute("aria-label", "Filtres actifs");
    tb.after(box);
    box.addEventListener("click", onChip);
    tb.addEventListener("click", later);
    tb.addEventListener("change", later);
    tb.addEventListener("input", later);
    document.querySelector(".coll-modes")?.addEventListener("click", later);
    $("reset-filters-btn")?.addEventListener("click", later);
    window.addEventListener("hashchange", later);
    sticky();
    // Apres le premier rendu de collection-core (filtres retenus).
    setTimeout(render, 600);
  });
})();
