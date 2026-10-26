// Module charge a la demande par card-extras.js (bouton "Inspecter").
// Inspecteur de carte (2026-10-20) : la carte en plein ecran avec tous ses
// effets (rarete, finition, etat, edition, effet de carte secrete), la
// lumiere qui suit la souris ou l'inclinaison du telephone (CardTilt), un
// zoom (molette, pincement, double-clic, boutons) avec deplacement, et le
// bandeau des variantes possedees pour les comparer d'un clic.

const CardInspector = (function () {
  const esc = escHtml;
  const FINISH = { normal: "Normale", holo: "Holo", gold: "Dorée", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel", emerald: "Émeraude" };
  const QUALITY = { damaged: "Usé", worn: "Abîmé", good: "Bon état", mint: "Parfait état" };
  const FINISH_ORDER = ["normal", "holo", "gold", "ghost", "diamond", "rainbow", "emerald"];
  const QUALITY_ORDER = ["damaged", "worn", "good", "mint"];
  const MIN = 1, MAX = 4;

  const label = (v) => [FINISH[v.finish] || v.finish, QUALITY[v.quality] || v.quality, v.edition && typeof EDITIONS !== "undefined" && EDITIONS[v.edition] ? EDITIONS[v.edition].label : ""].filter(Boolean).join(" · ");
  const attrs = (card, v) => `data-card-id="${card.cardId}" data-rarity="${esc(card.rarity?.key || "commune")}" data-finish="${esc(v.finish || "normal")}" data-quality="${esc(v.quality || "good")}"${v.edition ? ` data-edition="${esc(v.edition)}"` : ""}`;

  function open(o) {
    const card = o.card;
    const img = (typeof API !== "undefined" && API.imageUrl(card.imageId)) || "";
    const current = { finish: o.finish || "normal", quality: o.quality || "good", edition: o.edition || "" };
    const variants = (o.variants || []).slice().sort((a, b) =>
      FINISH_ORDER.indexOf(a.finish) - FINISH_ORDER.indexOf(b.finish) || QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality) || String(a.edition || "").localeCompare(String(b.edition || "")));
    const prevFocus = document.activeElement;

    const ov = document.createElement("div");
    ov.className = "ci-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Inspecter " + card.name);
    ov.innerHTML = `
      <div class="ci-top">
        <div class="ci-title"><strong>${esc(card.name)}</strong><span class="ci-sub" aria-live="polite"></span></div>
        <div class="ci-tools" role="toolbar" aria-label="Zoom">
          <button type="button" class="btn-ghost" data-ci="out" aria-label="Dézoomer">&minus;</button>
          <output class="ci-zoom" aria-live="polite">100 %</output>
          <button type="button" class="btn-ghost" data-ci="in" aria-label="Zoomer">+</button>
          <button type="button" class="btn-ghost" data-ci="reset" aria-label="Taille normale">&#10227;</button>
          ${(o.actions || []).map((a) => `<a class="btn-ghost ci-action" href="${esc(a.href)}">${esc(a.label)}</a>`).join("")}
          <button type="button" class="btn-ghost ci-close" data-ci="close" aria-label="Fermer l'inspecteur">&times;</button>
        </div>
      </div>
      <div class="ci-stage">
        <div class="ci-pan">
          <div class="collection-card ci-card" ${attrs(card, current)}>
            <div class="card-art"><img src="${esc(img)}" alt="${esc(card.name)}" draggable="false" /></div>
          </div>
        </div>
      </div>
      ${variants.length > 1 ? `<div class="ci-variants" role="radiogroup" aria-label="Variantes possédées">${variants.map((v, i) => `
        <button type="button" class="ci-variant" role="radio" data-i="${i}" aria-checked="false" title="${esc(label(v))}">
          <span class="collection-card ci-mini" ${attrs(card, v)}><span class="card-art"><img src="${esc(img)}" alt="" loading="lazy" decoding="async" /></span></span>
          <small>${esc(label(v))}${v.count > 1 ? ` <b>×${v.count}</b>` : ""}</small>
        </button>`).join("")}</div>` : ""}
      <p class="ci-hint">${matchMedia("(hover: hover) and (pointer: fine)").matches ? "Bouge la souris sur la carte pour faire jouer la lumière · molette pour zoomer · glisser pour déplacer · double-clic : zoom ×2" : "Incline ton téléphone pour faire jouer la lumière · pince pour zoomer · glisse pour déplacer · double-tape : zoom ×2"}</p>`;
    document.body.appendChild(ov);
    document.documentElement.classList.add("ci-open");

    const big = ov.querySelector(".ci-card");
    const pan = ov.querySelector(".ci-pan");
    const stage = ov.querySelector(".ci-stage");
    const zoomOut = ov.querySelector(".ci-zoom");
    const sub = ov.querySelector(".ci-sub");
    if (window.CardTilt) CardTilt.attach(big, { gyro: true });
    if (typeof SecretFx !== "undefined") SecretFx.apply();

    // Variante affichee.
    const show = (v) => {
      big.dataset.finish = v.finish || "normal";
      big.dataset.quality = v.quality || "good";
      if (v.edition) big.dataset.edition = v.edition; else delete big.dataset.edition;
      sub.textContent = [card.rarity?.name, label(v)].filter(Boolean).join(" · ");
      ov.querySelectorAll(".ci-variant").forEach((b) => {
        const w = variants[Number(b.dataset.i)];
        const on = w.finish === (v.finish || "normal") && w.quality === v.quality && (w.edition || "") === (v.edition || "");
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      });
    };
    show(current);
    ov.querySelector(".ci-variants")?.addEventListener("click", (e) => {
      const b = e.target.closest(".ci-variant");
      if (b) show(variants[Number(b.dataset.i)]);
    });
    ov.querySelector(".ci-variants")?.addEventListener("keydown", (e) => {
      if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
      const list = [...ov.querySelectorAll(".ci-variant")];
      const i = list.indexOf(document.activeElement);
      const next = list[(i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length];
      next.focus(); next.click(); e.preventDefault();
    });

    // Zoom et deplacement.
    let scale = 1, tx = 0, ty = 0;
    const apply = () => {
      if (scale <= MIN) { scale = MIN; tx = 0; ty = 0; }
      const r = stage.getBoundingClientRect();
      const lim = (v, size) => Math.max(-size * (scale - 1) / 2, Math.min(size * (scale - 1) / 2, v));
      tx = lim(tx, r.width); ty = lim(ty, r.height);
      pan.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      zoomOut.textContent = Math.round(scale * 100) + " %";
      stage.classList.toggle("zoomed", scale > 1);
    };
    const zoomTo = (s, cx, cy) => {
      const r = stage.getBoundingClientRect();
      const ns = Math.max(MIN, Math.min(MAX, s));
      // Garde le point vise (cx, cy) sous le doigt / le curseur.
      const ox = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2), oy = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2);
      tx = ox - (ox - tx) * (ns / scale); ty = oy - (oy - ty) * (ns / scale);
      scale = ns;
      apply();
    };
    stage.addEventListener("wheel", (e) => { e.preventDefault(); zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });
    stage.addEventListener("dblclick", (e) => zoomTo(scale > 1 ? 1 : 2, e.clientX, e.clientY));
    const pts = new Map();
    let pinch = null, drag = null, lastTap = 0, moved = false, downAt = null;
    stage.addEventListener("pointerdown", (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.setPointerCapture(e.pointerId);
      if (pts.size === 1) { moved = false; downAt = { x: e.clientX, y: e.clientY }; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale }; drag = null; }
      else if (pts.size === 1) {
        drag = { x: e.clientX - tx, y: e.clientY - ty };
        if (e.pointerType === "touch") { const now = Date.now(); if (now - lastTap < 300) zoomTo(scale > 1 ? 1 : 2, e.clientX, e.clientY); lastTap = now; }
      }
    });
    stage.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) moved = true;
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        zoomTo(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (drag && scale > 1) { tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null; };
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);

    // Fermeture : bouton, Echap (avant le gestionnaire global de ui.js), clic sur le fond.
    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      ov.remove();
      document.documentElement.classList.remove("ci-open");
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); close(); }
      else if (e.key === "+" || e.key === "=") zoomTo(scale * 1.25);
      else if (e.key === "-") zoomTo(scale / 1.25);
      else if (e.key === "0") zoomTo(1);
      else if (e.key === "Tab") {
        // Le focus reste dans l'inspecteur.
        const f = [...ov.querySelectorAll("button:not([tabindex='-1'])")];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    ov.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ci]");
      if (b) {
        const a = b.dataset.ci;
        if (a === "close") close();
        else if (a === "in") zoomTo(scale * 1.25);
        else if (a === "out") zoomTo(scale / 1.25);
        else if (a === "reset") zoomTo(1);
        return;
      }
      // Clic sur le fond (pas la fin d'un glisser) : fermeture.
      if (!moved && (e.target === ov || e.target === stage)) close();
    });
    ov.querySelector(".ci-close").focus();
    return { close };
  }
  return { open };
})();
window.CardInspector = CardInspector;
