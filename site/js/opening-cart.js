// Panier du distributeur de boosters (2026-10-18) : un clic sur une case
// ajoute un booster de cette extension (1 jeton chacun, dans la limite des
// jetons). Le monnayeur liste la selection ; "Ouvrir la selection" lance la
// fenetre d'ouverture avec une barre de toute la selection : on ouvre une
// extension a la fois (ses N boosters d'un coup) et on enchaine avec "Suivant".
// S'appuie sur opening.js (openModalFor, startOpening, openQuantity...).
// Murissoir (2026-10-18, js/ripen.js) : « Laisser murir » au lieu d'ouvrir,
// avec le choix de la duree ; un lot mur revient remplir le panier (fill).

(function () {
  const KEY = "2gatcha_booster_cart";
  let items = new Map();
  try { items = new Map(JSON.parse(sessionStorage.getItem(KEY) || "[]")); } catch (e) { items = new Map(); }
  let current = null;
  let ripenPick = false;
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify([...items])); } catch (e) { /* stockage indisponible */ } };
  const total = () => [...items.values()].reduce((s, n) => s + n, 0);
  const keyOf = (id) => (id === "mystery" ? "mystery" : Number(id));
  const nameOf = (id) => { const e = extensionById(keyOf(id)); return e ? e.name : "?"; };

  // Retire les extensions disparues et borne au nombre de jetons.
  function clamp() {
    for (const id of [...items.keys()]) if (!extensionById(keyOf(id))) items.delete(id);
    let over = total() - usableBoosters();
    for (const id of [...items.keys()].reverse()) {
      if (over <= 0) break;
      const n = items.get(id), cut = Math.min(n, over);
      if (n - cut > 0) items.set(id, n - cut); else items.delete(id);
      over -= cut;
    }
    save();
  }

  function add(id, delta = 1) {
    const k = keyOf(id);
    const n = (items.get(k) || 0) + delta;
    if (delta > 0 && total() + delta > usableBoosters()) { Toast.info(usableBoosters() ? "Plus de jeton à glisser : ta sélection utilise déjà tous tes jetons." : "Plus de jeton booster pour l'instant."); return; }
    if (n > 0) items.set(k, n); else items.delete(k);
    save();
    if (delta > 0 && typeof Sfx !== "undefined" && Sfx.click) Sfx.click();
    render();
  }

  function render() {
    clamp();
    const box = document.getElementById("vend-cart");
    if (!box) return;
    const n = total();
    box.innerHTML = n
      ? `<div class="vend-cart-head">Sélection <strong>${n}</strong> / ${usableBoosters()} jeton${usableBoosters() > 1 ? "s" : ""}</div>
         <ul class="vend-cart-list">${[...items].map(([id, q]) => `<li><span>${escHtml(nameOf(id))}</span><span class="vend-cart-qty"><button type="button" data-cart-dec="${id}" aria-label="Retirer un booster">−</button><b>${q}</b><button type="button" data-cart-inc="${id}" aria-label="Ajouter un booster">+</button></span></li>`).join("")}</ul>
         <button type="button" class="btn vend-cart-go" data-cart-open>&#127183; Ouvrir la sélection</button>
         ${ripenHtml()}
         <button type="button" class="btn-ghost vend-cart-clear" data-cart-clear>Vider</button>`
      : `<p class="vend-cart-empty">Clique sur des cases pour choisir tes boosters.</p>`;
    // Pastille du nombre choisi sur chaque case.
    document.querySelectorAll("#extension-picker .extension-tile[data-ext-id]").forEach((tile) => {
      const q = items.get(keyOf(tile.dataset.extId)) || 0;
      let badge = tile.querySelector(".vend-qty");
      if (!q) { if (badge) badge.remove(); return; }
      if (!badge) { badge = document.createElement("span"); badge.className = "vend-qty"; tile.appendChild(badge); }
      badge.textContent = `×${q}`;
    });
    // Noms des extensions connus : les lots du murissoir se redessinent.
    if (window.Ripen && Ripen.render) Ripen.render();
    renderBar();
  }

  // Laisser murir : choix de la duree (stades du murissoir).
  function ripenHtml() {
    const r = window.Ripen && Ripen.state;
    if (!r || !r.enabled || !r.slots.total) return "";
    const free = r.slots.open - r.lots.length;
    if (!ripenPick) return `<button type="button" class="btn-secondary vend-cart-ripen" data-cart-ripen ${free > 0 ? "" : "disabled"} title="${free > 0 ? "Mettre la sélection de côté : elle s'ouvrira plus tard, avec un bonus" : r.slots.open < r.slots.total ? `Un lot de plus au niveau ${r.slots.nextLevel}` : "Mûrissoir plein"}">&#127823; Laisser mûrir <small>(${r.lots.length} / ${r.slots.open} lot${r.slots.open > 1 ? "s" : ""})</small></button>`;
    return `<div class="vend-ripen-pick"><span>Laisser mûrir combien de temps ?</span>${r.stages.map((s, i) => `<button type="button" class="vend-ripen-stage" data-cart-ripen-stage="${i}"><b>${s.icon || "🍎"} ${s.hours} h</b><span>${escHtml(s.label)} : +${s.finish} pts de finition par booster${s.special ? ", une finition spéciale garantie chacun" : ""}</span></button>`).join("")}<button type="button" class="btn-ghost" data-cart-ripen-cancel>Annuler</button></div>`;
  }

  // Barre de la selection dans la fenetre d'ouverture.
  function renderBar() {
    const bar = document.getElementById("cart-bar");
    if (!bar) return;
    if (!current || !total()) { bar.hidden = true; bar.innerHTML = ""; return; }
    bar.hidden = false;
    bar.innerHTML = `<span class="cart-bar-label">Ta sélection :</span>${[...items].map(([id, q]) => `<button type="button" class="cart-chip ${id === current ? "active" : ""}" data-cart-pick="${id}">${escHtml(nameOf(id))} <b>×${q}</b></button>`).join("")}`;
  }

  function openFrom(id) {
    const k = keyOf(id);
    const q = Math.min(items.get(k) || 0, usableBoosters());
    if (q < 1) return;
    current = k;
    openModalFor(k);
    openQuantity = q;
    const qty = document.getElementById("quantity-picker");
    if (qty) qty.style.display = "none";
    const hint = document.getElementById("booster-hint");
    if (hint && q > 1) hint.textContent = `${q} boosters ${nameOf(k)} : choisis ton booster, ils s'ouvrent tous d'un coup`;
    renderBar();
  }

  // Appele par opening.js apres une ouverture reussie.
  function consumed(id, n) {
    if (current == null || keyOf(id) !== current) return;
    const left = (items.get(current) || 0) - n;
    if (left > 0) items.set(current, left); else items.delete(current);
    save();
    render();
  }
  const next = () => (current != null && items.size ? [...items.keys()][0] : null);
  function openNext() { const id = next(); if (id != null) openFrom(id); }
  function close() { current = null; renderBar(); render(); }
  // Lot mur repris (js/ripen.js) : il devient la selection.
  function fill(obj) { items = new Map(Object.entries(obj || {}).map(([k, n]) => [keyOf(k), Number(n)])); ripenPick = false; save(); render(); }
  function openFirst() { const id = [...items.keys()][0]; if (id != null) openFrom(id); }

  document.addEventListener("click", (e) => {
    const t = e.target;
    const inc = t.closest("[data-cart-inc]"), dec = t.closest("[data-cart-dec]");
    if (inc) add(inc.dataset.cartInc, 1);
    else if (dec) add(dec.dataset.cartDec, -1);
    else if (t.closest("[data-cart-clear]")) { items.clear(); ripenPick = false; save(); render(); }
    else if (t.closest("[data-cart-ripen]")) { ripenPick = true; render(); }
    else if (t.closest("[data-cart-ripen-cancel]")) { ripenPick = false; render(); }
    else if (t.closest("[data-cart-ripen-stage]") && window.Ripen) {
      const b = t.closest("[data-cart-ripen-stage]");
      b.disabled = true;
      Ripen.store(Object.fromEntries([...items].map(([k, n]) => [String(k), n])), Number(b.dataset.cartRipenStage)).then((done) => { if (done) { items.clear(); ripenPick = false; save(); } render(); });
    }
    else if (t.closest("[data-cart-open]")) { const id = [...items.keys()][0]; if (id != null) openFrom(id); }
    else if (t.closest("[data-cart-pick]") && typeof isBusy !== "undefined" && !isBusy) openFrom(t.closest("[data-cart-pick]").dataset.cartPick);
  });

  window.BoosterCart = { add, render, consumed, next, openNext, close, fill, openFirst, get active() { return current != null; }, nameOf };
})();
