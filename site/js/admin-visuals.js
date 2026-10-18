// Admin > Visuels (2026-10-18) : chaque image de site/assets est un
// emplacement modifiable : nom affiche (mineraux, coffres du gatchapon,
// especes de l'aquarium...) et image de remplacement televersee. Donnees :
// api/src/native/visuals.js ; liste : js/visuals-manifest.js.

(function () {
  const esc = escHtml;
  let overrides = {};
  let filter = "";

  const defaultLabel = (p) => p.split("/").pop().replace(/\.[^.]+$/, "").replace(/_/g, " ");

  function render() {
    const zone = document.getElementById("visuals-admin-zone");
    if (!zone) return;
    const q = filter.trim().toLowerCase();
    const list = (window.VISUALS_MANIFEST || []).filter((v) => !q || (v.path + " " + v.use + " " + ((overrides[v.path] || {}).label || "")).toLowerCase().includes(q));
    const groups = [...new Set(list.map((v) => v.group))];
    const changed = Object.keys(overrides).length;
    zone.classList.remove("empty-state");
    zone.innerHTML = `
      <div class="avis-bar"><input type="search" id="avis-search" placeholder="Rechercher un visuel…" value="${esc(filter)}" /><span>${changed} visuel${changed > 1 ? "s" : ""} modifié${changed > 1 ? "s" : ""}</span></div>
      ${groups.map((g) => `
        <h3 class="avis-group">${esc(g)}</h3>
        <div class="avis-grid">${list.filter((v) => v.group === g).map((v) => {
          const o = overrides[v.path] || {};
          const src = o.imageId ? API.imageUrl(o.imageId) : "assets/" + encodeURI(v.path);
          return `<div class="avis-card ${o.label || o.imageId ? "changed" : ""}">
            <img src="${src}" alt="" loading="lazy" data-novis="1" />
            <code>${esc(v.path)}</code>
            ${v.use ? `<small>${esc(v.use)}</small>` : ""}
            <input type="text" maxlength="60" data-vis-label="${esc(v.path)}" value="${esc(o.label || "")}" placeholder="${esc(defaultLabel(v.path))}" aria-label="Nom affiché" />
            <div class="avis-actions">
              <button type="button" class="btn-ghost" data-vis-save="${esc(v.path)}">Renommer</button>
              <label class="btn-ghost avis-upload">Remplacer<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-vis-file="${esc(v.path)}" hidden /></label>
              ${o.label || o.imageId ? `<button type="button" class="btn-ghost" data-vis-reset="${esc(v.path)}">Réinitialiser</button>` : ""}
            </div>
          </div>`;
        }).join("")}</div>`).join("")}`;
  }

  async function call(action, extra, okMsg) {
    try {
      const r = await API.adminVisuals(Session.discordId, action, extra);
      overrides = r.overrides || {};
      if (okMsg) Toast.success(okMsg);
      if (typeof Visuals !== "undefined") Visuals.set(overrides);
      render();
    } catch (e) { Toast.error(e.code === "invalid_image" ? "Image refusée (PNG, JPEG, WebP ou GIF, 3 Mo au plus)." : friendlyError(e)); }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const zone = document.getElementById("visuals-admin-zone");
    if (!zone) return;
    const load = () => call("list");
    if (typeof AdminNav !== "undefined" && AdminNav.onFirstShow) AdminNav.onFirstShow("visuels", load); else load();
    zone.addEventListener("input", (e) => { if (e.target.id === "avis-search") { filter = e.target.value; const pos = e.target.selectionStart; render(); const s = document.getElementById("avis-search"); s.focus(); s.setSelectionRange(pos, pos); } });
    zone.addEventListener("click", (e) => {
      const save = e.target.closest("[data-vis-save]");
      if (save) { const key = save.dataset.visSave; const input = zone.querySelector(`[data-vis-label="${CSS.escape(key)}"]`); call("set", { key, label: input ? input.value : "" }, "Nom enregistré."); return; }
      const reset = e.target.closest("[data-vis-reset]");
      if (reset) call("reset", { key: reset.dataset.visReset }, "Visuel d'origine rétabli.");
    });
    zone.addEventListener("change", (e) => {
      const input = e.target.closest("[data-vis-file]");
      if (!input || !input.files[0]) return;
      const file = input.files[0];
      if (file.size > 3 * 1024 * 1024) { Toast.error("Image trop lourde (3 Mo au plus)."); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result).split(",")[1] || "";
        call("upload", { key: input.dataset.visFile, data, mime: file.type, fileName: file.name }, "Image remplacée.");
      };
      reader.readAsDataURL(file);
    });
  });
})();
