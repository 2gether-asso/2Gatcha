// Module charge a la demande (coffre.js, collection-binder.js, profile.html).
// Vitrine du profil (2026-10-26) :
//  - vitrine pleine (6/6) : au lieu d'une erreur, on choisit la carte a
//    remplacer ;
//  - ordre : l'API range la vitrine par ordre d'ajout (pas de route pour
//    reordonner) ; on retire puis remet les cartes a partir de la premiere
//    position qui change, dans le nouvel ordre (12 actions au plus).

const ShowcaseKit = (function () {
  const esc = escHtml;
  const MAX = 6;
  async function list() { const r = await API.listShowcase(Session.userId); return r.showcase || []; }
  const thumb = (c) => `<span class="collection-card skit-card" data-rarity="${esc(c.rarity?.key || "commune")}"><span class="card-art"><img src="${API.imageUrl(c.imageId) || PLACEHOLDER_IMG}" alt="" loading="lazy" decoding="async" /></span></span>`;

  function overlay(html, cls) {
    const ov = document.createElement("div");
    ov.className = `card-modal-overlay confirm-overlay ${cls}`;
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `<div class="confirm-box skit-box">${html}</div>`;
    document.body.appendChild(ov);
    if (typeof syncScrollLock === "function") syncScrollLock();
    return ov;
  }
  function closeOv(ov) { ov.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); }

  // Vitrine pleine : quelle carte laisse sa place ? Resout son cardId ou null.
  function pickReplace(items, incomingName) {
    return new Promise((resolve) => {
      const ov = overlay(`
        <div class="confirm-title">Vitrine pleine (${items.length}/${MAX})</div>
        <div class="confirm-message">Quelle carte laisse sa place à <strong>${esc(incomingName || "la nouvelle")}</strong> ?</div>
        <div class="skit-grid">${items.map((c) => `<button type="button" class="skit-pick" data-id="${c.cardId}" title="Remplacer ${esc(c.name)}">${thumb(c)}<small>${esc(c.name)}</small></button>`).join("")}</div>
        <div class="confirm-actions"><button type="button" class="btn-ghost" data-skit="cancel">Annuler</button></div>`, "skit-replace");
      const done = (v) => { document.removeEventListener("keydown", onKey); closeOv(ov); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") done(null); };
      document.addEventListener("keydown", onKey);
      ov.addEventListener("click", (e) => {
        if (e.target === ov || e.target.closest('[data-skit="cancel"]')) return done(null);
        const b = e.target.closest(".skit-pick");
        if (b) done(Number(b.dataset.id));
      });
      ov.querySelector(".skit-pick")?.focus();
    });
  }

  // Ajoute une carte ; vitrine pleine : propose d'en remplacer une.
  // Resout { items, replaced } ou null si annule.
  async function add(cardId, name) {
    let items = await list();
    if (items.some((c) => c.cardId === cardId)) return { items, replaced: null };
    let replaced = null;
    if (items.length >= MAX) {
      replaced = await pickReplace(items, name);
      if (!replaced) return null;
      await API.removeFromShowcase(Session.userId, replaced);
    }
    await API.addToShowcase(Session.userId, cardId);
    items = await list();
    return { items, replaced };
  }

  // Applique un nouvel ordre (liste de cardId).
  async function reorder(current, next) {
    let k = 0;
    while (k < next.length && current[k] === next[k]) k++;
    const tail = next.slice(k);
    // Retraits puis ajouts dans l'ordre, en un seul appel HTTP (2026-10-29).
    if (tail.length) await API.batchWrite("showcase", [...tail.map((cardId) => ({ userId: Session.userId, action: "remove", cardId })), ...tail.map((cardId) => ({ userId: Session.userId, action: "add", cardId }))]);
    return list();
  }

  // Editeur d'ordre : glisser-deposer (souris) ou fleches (tactile, clavier).
  function editOrder(items) {
    return new Promise((resolve) => {
      let order = items.slice();
      const ov = overlay(`
        <div class="confirm-title">Ordonner ma vitrine</div>
        <div class="confirm-message">Glisse les cartes ou utilise les flèches : la première est la plus en vue sur ton profil et sur l'image partagée.</div>
        <ol class="skit-order"></ol>
        <div class="confirm-actions"><button type="button" class="btn-ghost" data-skit="cancel">Annuler</button><button type="button" class="confirm-ok" data-skit="save">Enregistrer</button></div>`, "skit-reorder");
      const ol = ov.querySelector(".skit-order");
      const paint = (focusId) => {
        ol.innerHTML = order.map((c, i) => `<li class="skit-item" draggable="true" data-i="${i}">
          <span class="skit-pos">${i + 1}</span>${thumb(c)}<small>${esc(c.name)}</small>
          <span class="skit-arrows"><button type="button" data-mv="-1" data-i="${i}" aria-label="Avancer ${esc(c.name)}" ${i === 0 ? "disabled" : ""}>◀</button><button type="button" data-mv="1" data-i="${i}" aria-label="Reculer ${esc(c.name)}" ${i === order.length - 1 ? "disabled" : ""}>▶</button></span>
        </li>`).join("");
        if (focusId != null) { const j = order.findIndex((c) => c.cardId === focusId); const b = ol.querySelector(`[data-i="${j}"] [data-mv="${j === 0 ? 1 : -1}"]`); if (b) b.focus(); }
      };
      const move = (i, j) => { if (j < 0 || j >= order.length || i === j) return; const [c] = order.splice(i, 1); order.splice(j, 0, c); paint(c.cardId); };
      paint();
      let dragFrom = null;
      ol.addEventListener("dragstart", (e) => { const li = e.target.closest(".skit-item"); if (!li) return; dragFrom = Number(li.dataset.i); li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
      ol.addEventListener("dragover", (e) => { e.preventDefault(); ol.querySelectorAll(".over").forEach((x) => x.classList.remove("over")); e.target.closest(".skit-item")?.classList.add("over"); });
      ol.addEventListener("drop", (e) => { e.preventDefault(); const li = e.target.closest(".skit-item"); if (li && dragFrom != null) move(dragFrom, Number(li.dataset.i)); dragFrom = null; });
      ol.addEventListener("dragend", () => { dragFrom = null; ol.querySelectorAll(".dragging, .over").forEach((x) => x.classList.remove("dragging", "over")); });
      const done = (v) => { document.removeEventListener("keydown", onKey); closeOv(ov); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") done(null); };
      document.addEventListener("keydown", onKey);
      ov.addEventListener("click", async (e) => {
        if (e.target === ov || e.target.closest('[data-skit="cancel"]')) return done(null);
        const mv = e.target.closest("[data-mv]");
        if (mv) { const i = Number(mv.dataset.i); move(i, i + Number(mv.dataset.mv)); return; }
        const save = e.target.closest('[data-skit="save"]');
        if (save) {
          const next = order.map((c) => c.cardId), cur = items.map((c) => c.cardId);
          if (next.join() === cur.join()) return done(items);
          save.disabled = true; save.textContent = "Enregistrement…";
          try { const fresh = await reorder(cur, next); Toast.success("Ordre de la vitrine enregistré."); done(fresh); }
          catch (err) { Toast.error(friendlyError(err)); save.disabled = false; save.textContent = "Enregistrer"; }
        }
      });
    });
  }

  return { list, add, reorder, editOrder, pickReplace, MAX };
})();
window.ShowcaseKit = ShowcaseKit;
