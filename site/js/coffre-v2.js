// Coffre-fort perso V2 (2026-11-07), autour de coffre.js :
//  - Niveau du coffre (api/src/native/personal-vault.js, data.level) : porte
//    dont le metal suit le niveau, points de prestige, palier suivant,
//    recompenses de palier et interets du jour a recuperer.
//  - Porte qui s'ouvre a la premiere visite de la session (passable d'un clic,
//    jamais en mouvement reduit ni en mode fluide).
//  - Depot guide : tout ce qui peut etre range (toutes editions), les lignes
//    qui se completeraient et ce qu'elles rapportent ; fenetre de revue pour
//    choisir les exemplaires, puis un seul appel (pvStoreMany de coffre.js).
//  - Tiroirs : sans recherche ni filtre, une vue d'ensemble par extension au
//    lieu de la longue liste ; un tiroir ouvert = le filtre Extension.
//  - Vitrine du profil (onglet Vitrine) : les 6 places dans l'ordre, deplacer
//    / retirer, au-dessus de la salle des tresors (ordre : ShowcaseKit.reorder).
// coffre.js reste la source du rendu des lignes : pvRender est enveloppe.

const CoffreV2 = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escHtml(s);
  const METALS = ["iron", "bronze", "silver", "gold", "emerald"];
  const metalOf = (lv) => METALS[Math.min(METALS.length - 1, Math.floor((Math.max(1, lv) - 1) / 2))];
  let last = null;
  let busy = false;

  // ------------------------------------------------------------ niveau
  function renderHall(data) {
    const box = $("pv2-hall");
    const lv = data && data.level;
    if (!box) return;
    if (!lv) { box.hidden = true; return; }
    box.hidden = false;
    const next = lv.next;
    const span = next ? Math.max(1, next.xp - lv.floor) : 1;
    const pct = next ? Math.min(100, Math.round(((lv.xp - lv.floor) / span) * 100)) : 100;
    const pendB = lv.pending.reduce((a, l) => a + l.boosters, 0), pendD = lv.pending.reduce((a, l) => a + l.dust, 0);
    box.dataset.metal = metalOf(lv.level);
    box.innerHTML = `
      <div class="pv2-door-badge" aria-hidden="true"><span class="pv2-door-wheel"></span><strong>${lv.level}</strong></div>
      <div class="pv2-hall-main">
        <div class="pv2-hall-title"><strong>${esc(lv.name)}</strong><span>Niveau ${lv.level}${lv.levels ? ` / ${lv.levels.length}` : ""}</span></div>
        <div class="pv2-xp" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Prestige du coffre"><span style="width:${pct}%"></span></div>
        <div class="pv2-hall-sub">
          <span><strong>${lv.xp}</strong> pts de prestige${next ? ` · encore <strong>${next.xp - lv.xp}</strong> pour <em>${esc(next.name)}</em>` : " · niveau maximum"}</span>
          <span class="muted" title="Points de prestige">${lv.perCard} par carte rangée · ${lv.perRow} par ligne complète</span>
        </div>
        ${next ? `<div class="pv2-next">Palier suivant : ${[next.boosters ? `+${next.boosters} boosters` : "", next.dust ? `+${next.dust} &#10024;` : "", next.interest ? `intérêts ${next.interest} &#10024;/jour` : ""].filter(Boolean).join(" · ")}</div>` : ""}
      </div>
      <div class="pv2-hall-actions">
        ${lv.pending.length ? `<button type="button" class="btn pv2-claim" data-pv2="claimLevel">&#127873; Palier${lv.pending.length > 1 ? "s" : ""} : +${pendB} boosters +${pendD} &#10024;</button>` : ""}
        ${lv.interest ? (lv.interestReady
          ? `<button type="button" class="btn-secondary pv2-interest" data-pv2="interest">&#128176; Intérêts du jour : +${lv.interest} &#10024;</button>`
          : `<span class="pv2-interest-done" title="Reviens demain">&#10004; Intérêts récupérés (${lv.interest} &#10024;/jour)</span>`) : `<span class="muted pv2-interest-done">Intérêts dès le niveau 2</span>`}
      </div>`;
  }
  async function act(action, btn) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try {
      const res = await API.personalVault(Session.userId, action);
      pvRender(res);
      if (res.levelReward) {
        const r = res.levelReward;
        Toast.success(`&#128274; ${esc(r.name)} : +${r.boosters} boosters et +${r.dust} poussières !`);
        if (typeof confetti === "function") confetti({ particleCount: 160, spread: 110, origin: { y: 0.4 } });
      }
      if (res.interestGained) Toast.success(`&#128176; Intérêts du coffre : +${res.interestGained} poussières.`);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (e) {
      if (btn) btn.disabled = false;
      Toast.error({ nothing_to_claim: "Aucun palier à récupérer.", already_claimed_today: "Intérêts déjà récupérés aujourd'hui.", no_interest: "Pas encore d'intérêts à ce niveau." }[e.code] || friendlyError(e));
    } finally { busy = false; }
  }

  // Porte : une fois par session.
  function door(data) {
    let seen = false;
    try { seen = sessionStorage.getItem("2gatcha_pv_door") === "1"; sessionStorage.setItem("2gatcha_pv_door", "1"); } catch (e) { seen = true; }
    if (seen || document.documentElement.dataset.fx === "light" || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    const lv = (data.level && data.level.level) || 1;
    const ov = document.createElement("div");
    ov.className = "pv2-door-intro";
    ov.dataset.metal = metalOf(lv);
    ov.setAttribute("aria-hidden", "true");
    ov.innerHTML = `<div class="pv2-door-half left"></div><div class="pv2-door-half right"></div><div class="pv2-door-dial"><span></span></div><div class="pv2-door-name">${esc((data.level && data.level.name) || "Coffre-fort")}</div>`;
    const done = () => ov.remove();
    ov.addEventListener("click", done);
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("turn"));
    setTimeout(() => { ov.classList.add("open"); if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(140, 0, 0.25, "sawtooth", 0.03); }, 650);
    setTimeout(done, 1700);
  }

  // ------------------------------------------------------------ depot
  // Toutes les lignes (classique + editions), avec leurs exemplaires rangeables.
  function storableAll(data) {
    const tabs = [{ key: "", label: "", icon: "", rows: data.rows || [] }, ...(data.editions || [])];
    const items = [];
    tabs.forEach((t) => (t.rows || []).forEach((r) => {
      const ids = pvStorable(r);
      if (!ids.length) return;
      const finishes = ids.map((id) => (r.slots.find((s) => s.candidates.some((c) => c.pullId === id)) || {}).finish);
      items.push({ row: r, tab: t, ids, finishes });
    }));
    return items;
  }
  function forecast(data, items, chosen) {
    let cards = 0, rows = 0;
    items.forEach((it) => {
      const n = it.ids.filter((id) => chosen.has(id)).length;
      cards += n;
      if (n && !it.row.claimed && it.row.filled + n >= 6) rows++;
    });
    const lv = data.level;
    const xp = lv ? cards * lv.perCard + rows * lv.perRow : 0;
    let up = null;
    if (lv && lv.levels) { const after = lv.xp + xp; const reach = lv.levels.filter((l) => l.level > lv.level && after >= l.xp); if (reach.length) up = reach[reach.length - 1]; }
    return { cards, rows, boosters: rows * (data.boostersPerRow || 0), dust: rows * (data.dustPerRow || 0), tickets: data.unique ? rows : 0, xp, up };
  }
  const forecastHtml = (f) => [
    `<strong>${f.cards}</strong> carte${f.cards > 1 ? "s" : ""}`,
    f.rows ? `<strong>${f.rows}</strong> ligne${f.rows > 1 ? "s" : ""} complète${f.rows > 1 ? "s" : ""} : +${f.boosters} boosters, +${f.dust} &#10024;${f.tickets ? `, +${f.tickets} &#127915;` : ""}, ${f.rows} émeraude${f.rows > 1 ? "s" : ""}` : "",
    f.xp ? `+${f.xp} pts de prestige${f.up ? ` &rarr; <strong>${esc(f.up.name)}</strong> !` : ""}` : ""
  ].filter(Boolean).join(" · ");

  function renderDeposit(data) {
    const box = $("pv2-deposit");
    if (!box) return;
    const items = storableAll(data);
    if (!items.length) { box.hidden = true; return; }
    const all = new Set(items.flatMap((it) => it.ids));
    box.hidden = false;
    box.innerHTML = `<span class="pv2-deposit-ico" aria-hidden="true">&#128229;</span>
      <div class="pv2-deposit-txt"><strong>À ranger maintenant</strong><span>${forecastHtml(forecast(data, items, all))}</span></div>
      <button type="button" class="btn" data-pv2="deposit">Préparer le dépôt</button>`;
  }
  function openDeposit() {
    const data = last;
    if (!data) return;
    const items = storableAll(data);
    if (!items.length) return;
    const chosen = new Set(items.flatMap((it) => it.ids));
    const ov = document.createElement("div");
    ov.className = "card-modal-overlay confirm-overlay pv2-dep-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Dépôt au coffre-fort");
    const rowHtml = (it, i) => {
      const r = it.row, img = API.thumbUrl ? API.thumbUrl(r.imageId) : API.imageUrl(r.imageId);
      const completes = !r.claimed && r.filled + it.ids.length >= 6;
      return `<li class="pv2-dep-row ${completes ? "completes" : ""}" style="--r:${r.rarity?.colorHex || "#9aa0b4"}">
        <img src="${img || PLACEHOLDER_IMG}" alt="" loading="lazy" decoding="async" />
        <div class="pv2-dep-info"><strong>${esc(r.name)}</strong><small>${r.filled}/6 au coffre${it.tab.key ? ` · ${it.tab.icon} ${esc(it.tab.label)}` : ""}${completes ? " · <b>ligne complète !</b>" : ""}</small></div>
        <div class="pv2-dep-chips">${it.ids.map((id, k) => `<label class="pv2-dep-chip" data-finish="${it.finishes[k]}"><input type="checkbox" data-dep="${id}" checked /> ${PV_FINISH_LABELS[it.finishes[k]] || it.finishes[k]}</label>`).join("")}</div>
      </li>`;
    };
    ov.innerHTML = `<div class="confirm-box pv2-dep-box">
      <div class="confirm-title">&#128229; Dépôt au coffre-fort</div>
      <div class="confirm-message">Les exemplaires en parfait état qui ont une case libre. Décoche ce que tu veux garder en collection (échanges, fusions…).</div>
      <div class="pv2-dep-tools"><button type="button" class="btn-ghost" data-dep-all="1">Tout cocher</button><button type="button" class="btn-ghost" data-dep-all="0">Tout décocher</button><button type="button" class="btn-ghost" data-dep-rows="1">Seulement les lignes complètes</button></div>
      <ul class="pv2-dep-list">${items.map(rowHtml).join("")}</ul>
      <div class="pv2-dep-recap" aria-live="polite"></div>
      <div class="confirm-actions"><button type="button" class="btn-ghost" data-dep-cancel>Annuler</button><button type="button" class="confirm-ok" data-dep-go>Ranger</button></div>
    </div>`;
    const paint = () => {
      const f = forecast(data, items, chosen);
      ov.querySelector(".pv2-dep-recap").innerHTML = forecastHtml(f) || "Rien de sélectionné.";
      const go = ov.querySelector("[data-dep-go]");
      go.disabled = !f.cards;
      go.textContent = f.cards ? `Ranger ${f.cards} carte${f.cards > 1 ? "s" : ""}` : "Ranger";
      ov.querySelectorAll("[data-dep]").forEach((cb) => { cb.checked = chosen.has(Number(cb.dataset.dep)); });
    };
    const close = () => { document.removeEventListener("keydown", onKey); ov.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    ov.addEventListener("change", (e) => { const cb = e.target.closest("[data-dep]"); if (!cb) return; const id = Number(cb.dataset.dep); if (cb.checked) chosen.add(id); else chosen.delete(id); paint(); });
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.closest("[data-dep-cancel]")) return close();
      const all = e.target.closest("[data-dep-all]");
      if (all) { chosen.clear(); if (all.dataset.depAll === "1") items.forEach((it) => it.ids.forEach((id) => chosen.add(id))); paint(); return; }
      if (e.target.closest("[data-dep-rows]")) { chosen.clear(); items.forEach((it) => { if (!it.row.claimed && it.row.filled + it.ids.length >= 6) it.ids.forEach((id) => chosen.add(id)); }); paint(); return; }
      if (e.target.closest("[data-dep-go]")) { const ids = [...chosen]; close(); pvStoreMany(ids); }
    });
    document.body.appendChild(ov);
    if (typeof syncScrollLock === "function") syncScrollLock();
    paint();
    ov.querySelector("[data-dep-go]").focus();
  }

  // ------------------------------------------------------------ tiroirs
  function drawerMode() {
    const v = pvView();
    const q = ($("pv-search")?.value || "").trim();
    return v.ext === "all" && !q && v.filter === "all";
  }
  function setExt(id) {
    const sel = $("pv-ext");
    if (!sel) return;
    sel.value = String(id);
    if (sel._fancyRefresh) sel._fancyRefresh();
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    $("pv-zone")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function renderDrawers() {
    const rowsBox = $("pv-rows"), box = $("pv2-drawers"), head = $("pv2-drawer-head");
    if (!box || !rowsBox || !last) return;
    const rows = pvCurrentRows();
    const v = pvView();
    // Une extension ouverte : en-tete du tiroir avec retour.
    if (v.ext !== "all") {
      const r0 = rows.find((r) => String(pvExtId(r)) === String(v.ext));
      head.hidden = !r0;
      if (r0) head.innerHTML = `<button type="button" class="btn-ghost" data-pv2-ext="all">&larr; Tous les tiroirs</button><strong>&#128452;&#65039; ${esc(r0.extension ? r0.extension.name : "Hors extension")}</strong>`;
    } else head.hidden = true;
    const on = drawerMode() && rows.length > 6;
    box.hidden = !on;
    rowsBox.hidden = on;
    if (!on) return;
    const exts = new Map();
    rows.forEach((r) => {
      const id = pvExtId(r);
      const e = exts.get(id) || { id, name: r.extension ? r.extension.name : "Hors extension", order: r.extension ? r.extension.sortOrder : 1e9, n: 0, done: 0, filled: 0, emerald: 0, ready: 0, almost: 0, thumbs: [] };
      e.n++; e.filled += r.filled; if (r.complete) e.done++; if (r.emerald) e.emerald++;
      const ready = pvStorable(r).length; e.ready += ready;
      if (!r.complete && r.filled + ready >= 6) e.almost++;
      if (r.filled && e.thumbs.length < 4) e.thumbs.push(r.imageId);
      exts.set(id, e);
    });
    const list = [...exts.values()].sort((a, b) => a.order - b.order || a.id - b.id);
    box.innerHTML = list.map((e) => {
      const pct = e.n ? Math.round((e.filled / (e.n * 6)) * 100) : 0;
      return `<button type="button" class="pv2-drawer ${e.ready ? "has-ready" : ""} ${e.done === e.n ? "full" : ""}" data-pv2-ext="${e.id}" style="--p:${pct}">
        <span class="pv2-drawer-handle" aria-hidden="true"></span>
        <span class="pv2-drawer-thumbs" aria-hidden="true">${e.thumbs.map((id) => `<img src="${(API.thumbUrl ? API.thumbUrl(id) : API.imageUrl(id)) || PLACEHOLDER_IMG}" alt="" loading="lazy" decoding="async" />`).join("")}</span>
        <span class="pv2-drawer-name">${esc(e.name)}</span>
        <span class="pv2-drawer-meta"><span>${e.done}/${e.n} ligne${e.n > 1 ? "s" : ""}</span>${e.emerald ? `<span>&#128154; ${e.emerald}</span>` : ""}<span>${e.filled} carte${e.filled > 1 ? "s" : ""}</span></span>
        <span class="pv2-drawer-bar" aria-hidden="true"><span></span></span>
        ${e.ready ? `<span class="pv2-drawer-ready">&#128229; ${e.ready} à ranger${e.almost ? ` · ${e.almost} ligne${e.almost > 1 ? "s" : ""} complète${e.almost > 1 ? "s" : ""}` : ""}</span>` : ""}
      </button>`;
    }).join("");
  }

  // ------------------------------------------------------------ vitrine du profil
  let showcase = null;
  async function loadShowcase() {
    try { showcase = (await API.listShowcase(Session.userId)).showcase || []; } catch (e) { showcase = showcase || []; }
    pvShowcase = new Set(showcase.map((c) => c.cardId));
    renderShowcase();
  }
  function renderShowcase() {
    const box = $("pv2-showcase");
    if (!box || !showcase) return;
    const MAX = 6;
    const slots = [];
    for (let i = 0; i < MAX; i++) {
      const c = showcase[i];
      if (!c) { slots.push(`<li class="pv2-sc-slot empty"><span class="pv2-sc-pos">${i + 1}</span><span class="pv2-sc-plus" aria-hidden="true">+</span><small>Place libre</small></li>`); continue; }
      slots.push(`<li class="pv2-sc-slot" data-card="${c.cardId}">
        <span class="pv2-sc-pos">${i + 1}</span>
        <span class="collection-card pv2-sc-card" data-rarity="${esc(c.rarity?.key || "commune")}"><span class="card-art"><img src="${API.imageUrl(c.imageId) || PLACEHOLDER_IMG}" alt="" loading="lazy" decoding="async" /></span></span>
        <small class="pv2-sc-name">${esc(c.name)}</small>
        <span class="pv2-sc-tools">
          <button type="button" data-sc-mv="-1" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Avancer ${esc(c.name)}">&#9664;</button>
          <button type="button" data-sc-rm="${c.cardId}" aria-label="Retirer ${esc(c.name)} de la vitrine">&#10005;</button>
          <button type="button" data-sc-mv="1" data-i="${i}" ${i >= showcase.length - 1 ? "disabled" : ""} aria-label="Reculer ${esc(c.name)}">&#9654;</button>
        </span>
      </li>`);
    }
    box.innerHTML = `<header class="pv2-sc-head"><div><h2>&#128444;&#65039; Vitrine de ton profil</h2><p class="muted">Les 6 cartes que tout le monde voit sur ton profil, dans cet ordre. Ajoute une carte avec &#128444;&#65039; dans la salle des trésors ci-dessous, ou depuis ta <a href="collection.html">collection</a>.</p></div>
      <a class="btn-ghost" href="profile.html">Voir mon profil</a></header>
      <ol class="pv2-sc-grid">${slots.join("")}</ol>`;
  }
  async function moveShowcase(i, d) {
    const j = i + d;
    if (!showcase || j < 0 || j >= showcase.length || busy) return;
    busy = true;
    const cur = showcase.map((c) => c.cardId);
    const next = cur.slice();
    [next[i], next[j]] = [next[j], next[i]];
    // Affichage tout de suite, enregistrement ensuite.
    const was = showcase;
    showcase = next.map((id) => was.find((c) => c.cardId === id));
    renderShowcase();
    try {
      await LazyJs.load("js/lazy/showcase.js");
      showcase = await ShowcaseKit.reorder(cur, next);
      renderShowcase();
    } catch (e) { showcase = was; renderShowcase(); Toast.error(friendlyError(e)); }
    finally { busy = false; }
  }
  async function removeShowcase(cardId) {
    try {
      await API.removeFromShowcase(Session.userId, cardId);
      Toast.info("Retirée de ta vitrine.");
      await loadShowcase();
      pvSyncShowcaseBtns();
    } catch (e) { Toast.error(friendlyError(e)); }
  }

  // ------------------------------------------------------------ branchements
  function after(data) {
    if (!data || !data.unlocked) return;
    const first = !last;
    last = data;
    renderHall(data);
    renderDeposit(data);
    renderDrawers();
    if (first) door(data);
  }
  function init() {
    if (!Session.isLoggedIn() || typeof pvRender !== "function") return;
    const base = pvRender;
    // eslint-disable-next-line no-global-assign
    pvRender = function (data) { base(data); after(data); };
    const baseSync = pvSyncShowcaseBtns;
    // Vitrine modifiee depuis une ligne ou la salle des tresors : la liste est relue.
    // eslint-disable-next-line no-global-assign
    pvSyncShowcaseBtns = function () { baseSync(); if (showcase && pvShowcase.size !== showcase.length) loadShowcase(); };
    const baseGallery = window.pvRenderGallery;
    window.pvRenderGallery = function () { if (baseGallery) baseGallery(); if (!showcase) loadShowcase(); else renderShowcase(); };
    document.addEventListener("click", (e) => {
      const a = e.target.closest("[data-pv2]");
      if (a) {
        if (a.dataset.pv2 === "deposit") openDeposit();
        else act(a.dataset.pv2, a);
        return;
      }
      const ext = e.target.closest("[data-pv2-ext]");
      if (ext) { setExt(ext.dataset.pv2Ext); return; }
      const mv = e.target.closest("[data-sc-mv]");
      if (mv) { moveShowcase(Number(mv.dataset.i), Number(mv.dataset.scMv)); return; }
      const rm = e.target.closest("[data-sc-rm]");
      if (rm) { removeShowcase(Number(rm.dataset.scRm)); return; }
      if (e.target.closest(".pv2-sc-slot.empty")) { $("pv-gallery")?.scrollIntoView({ behavior: "smooth", block: "start" }); Toast.info("Touche &#128444;&#65039; sous une carte pour la mettre en vitrine."); }
    });
  }
  document.addEventListener("DOMContentLoaded", init);
  return { openDeposit, metalOf };
})();
window.CoffreV2 = CoffreV2;
