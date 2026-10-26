// Admin > Contenu > Cosmetiques (2026-10-25) : editeur du catalogue de la
// boutique (titres, cadres d'avatar, couleurs de pseudo). Un cadre ou une
// couleur peut avoir son propre style (2 couleurs, halo, animation), sans
// toucher au CSS du site. Supprimer un objet deja possede le retire seulement
// de la vente. Donnees : api/src/native/cosmetics.js (admin-cosmetics).
// Secrets (2026-10-29) : onglet des cosmetiques gagnes hors boutique (codes
// secrets, secrets du site, salle interdite, prestige...) : nom, description
// et style ; cle et type restent ceux du jeu ; « Retablir » efface les
// modifications.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const TYPE = { title: "👑 Titre", frame: "🖼️ Cadre", color: "🎨 Couleur" };
  const ANIM = { none: "Aucune", pulse: "Pulsation", spin: "Arc-en-ciel tournant", shine: "Reflet qui glisse (couleurs)" };
  let items = [], secrets = [], filter = "all", editingSecret = false;

  function list() {
    if (filter === "secret") { secretTable(); return; }
    const rows = items.filter((i) => filter === "all" || i.type === filter).sort((a, b) => a.type.localeCompare(b.type) || (a.price || 0) - (b.price || 0));
    $("cosm-list").innerHTML = `<table><thead><tr><th>Aperçu</th><th>Nom</th><th>Prix</th><th>Joueurs</th><th></th></tr></thead><tbody>${rows.map((i) => `
      <tr class="${i.hidden ? "hidden-item" : ""}">
        <td>${sample(i)}</td>
        <td><strong>${esc(i.label)}</strong><br><small class="muted">${esc(i.key)}${i.tag ? " · " + esc(i.tag) : ""}${i.hidden ? " · retiré de la vente" : ""}</small></td>
        <td>${fmtNum(i.price || 0)} ✨</td><td>${i.owners}</td>
        <td><button type="button" class="btn-ghost" data-cosm-edit="${esc(i.key)}">Modifier</button></td>
      </tr>`).join("")}</tbody></table>`;
  }
  function secretTable() {
    const rows = secrets.slice().sort((a, b) => a.type.localeCompare(b.type) || String(a.source).localeCompare(String(b.source)) || a.label.localeCompare(b.label));
    $("cosm-list").innerHTML = rows.length ? `<table><thead><tr><th>Aperçu</th><th>Nom</th><th>Origine</th><th>Joueurs</th><th></th></tr></thead><tbody>${rows.map((i) => `
      <tr>
        <td>${sample(i)}</td>
        <td><strong>${esc(i.label)}</strong>${i.edited ? ` <span class="pill">modifié</span>` : ""}<br><small class="muted">${esc(i.key)}${i.edited && i.defaultLabel && i.defaultLabel !== i.label ? " · à l'origine « " + esc(i.defaultLabel) + " »" : ""}</small></td>
        <td><small>${esc(i.source || "")}</small></td><td>${i.owners}</td>
        <td><button type="button" class="btn-ghost" data-cosm-secret="${esc(i.key)}">Modifier</button></td>
      </tr>`).join("")}</tbody></table>` : `<p class="muted">Aucun cosmétique secret pour l'instant.</p>`;
  }
  function sample(i, pseudo = "Pseudo") {
    if (i.type === "frame") return `<span class="decor-avatar small decor-${esc(i.key)}"><span>A</span></span>`;
    if (i.type === "color") return `<span class="decor-pseudo decor-${esc(i.key)}">${esc(pseudo)}</span>`;
    return `<span class="shop-title-sample">« ${esc(i.label)} »</span>`;
  }

  function formValues() {
    const type = $("cosm-type").value;
    const v = {
      type, key: $("cosm-key").value.trim().toLowerCase(), label: $("cosm-label").value.trim(), price: Number($("cosm-price").value) || 0,
      desc: $("cosm-desc").value.trim(), tag: $("cosm-tag").value, hidden: $("cosm-hidden").checked
    };
    if (editingSecret) { v.secret = true; v.price = 0; delete v.tag; delete v.hidden; }
    if (type !== "title" && $("cosm-styled").checked) v.style = { c1: $("cosm-c1").value, c2: $("cosm-use-c2").checked ? $("cosm-c2").value : undefined, glow: Number($("cosm-glow").value) || 0, anim: $("cosm-anim").value };
    return v;
  }
  // Apercu en direct : la regle CSS est fabriquee comme sur le site (shell.js).
  function livePreview() {
    const v = formValues();
    const key = "preview-cosm";
    $("cosm-style-fields").hidden = v.type === "title";
    let css = "";
    if (v.style && typeof cosmeticCss === "function") css = cosmeticCss(key, { type: v.type, ...v.style });
    let el = document.getElementById("cosm-preview-style");
    if (!el) { el = document.createElement("style"); el.id = "cosm-preview-style"; document.head.appendChild(el); }
    el.textContent = css;
    const k = v.style ? key : v.key;
    $("cosm-preview").innerHTML = v.type === "frame" ? `<span class="decor-avatar decor-${esc(k)}"><span>A</span></span><span>${esc(v.label || "Cadre")}</span>`
      : v.type === "color" ? `<span class="decor-pseudo decor-${esc(k)}" style="font-size:1.3rem">${esc(Session.pseudo || "Pseudo")}</span>`
      : `<span class="decor-title">${esc(v.label || "Titre")}</span>`;
  }
  function fill(i, secret = false) {
    editingSecret = secret;
    const known = !!(secret && i);
    $("cosm-type").value = i ? i.type : "title";
    $("cosm-type").disabled = known;
    $("cosm-key").value = i ? i.key : "";
    $("cosm-key").readOnly = !!i;
    $("cosm-price-row").hidden = secret;
    $("cosm-shop-row").hidden = secret;
    $("cosm-source").hidden = !secret;
    $("cosm-source").innerHTML = secret ? (i ? `&#128274; Gagné hors boutique : <strong>${esc(i.source || "en jeu")}</strong>${i.owners ? ` · ${i.owners} joueur(s) l'ont` : ""}` : "&#128274; Nouveau cosmétique secret : jamais en vente, à offrir (dons, codes secrets).") : "";
    $("cosm-label").value = i ? i.label : "";
    $("cosm-price").value = i ? i.price || 0 : 500;
    $("cosm-desc").value = i ? i.desc || "" : "";
    $("cosm-tag").value = i ? i.tag || "" : "nouveau";
    $("cosm-hidden").checked = !!(i && i.hidden);
    $("cosm-styled").checked = !!(i && i.style) || !i;
    $("cosm-c1").value = i && i.style ? i.style.c1 : "#a855f7";
    $("cosm-use-c2").checked = !!(i && i.style && i.style.c2);
    $("cosm-c2").value = i && i.style && i.style.c2 ? i.style.c2 : "#22d3ee";
    $("cosm-glow").value = i && i.style ? i.style.glow || 0 : 12;
    $("cosm-anim").value = i && i.style ? i.style.anim || "none" : "none";
    $("cosm-delete").hidden = secret ? !(i && i.edited) : !i;
    $("cosm-delete").textContent = secret ? "Rétablir l'original" : "Supprimer";
    $("cosm-form-title").textContent = i ? `Modifier « ${i.label} »${secret ? " (secret)" : ""}` : secret ? "Nouveau cosmétique secret" : "Nouveau cosmétique";
    livePreview();
  }

  async function load(res) {
    try {
      const r = res || (await API.adminCosmetics(Session.discordId));
      items = r.items || [];
      secrets = r.secrets || [];
      // Les styles enregistres s'appliquent tout de suite aux apercus de la liste.
      if (typeof applyCosmeticStyles === "function") applyCosmeticStyles(Object.fromEntries([...items, ...secrets].filter((i) => i.style).map((i) => [i.key, { type: i.type, ...i.style }])));
      list();
    } catch (e) { $("cosm-list").innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const sec = $("cosmetics-admin");
    if (!sec || !Session.isLoggedIn()) return;
    $("cosm-anim").innerHTML = Object.entries(ANIM).map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
    AdminNav.onFirstShow("contenu", () => { load(); fill(null); });
    sec.addEventListener("input", (e) => {
      if (e.target.closest("#cosm-form")) {
        // Cle proposee a partir du type et du nom pour un nouvel objet.
        if ((e.target.id === "cosm-label" || e.target.id === "cosm-type") && !$("cosm-key").readOnly) $("cosm-key").value = `${$("cosm-type").value}-${normText($("cosm-label").value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)}`;
        livePreview();
      }
    });
    sec.addEventListener("change", (e) => { if (e.target.closest("#cosm-form")) livePreview(); });
    sec.addEventListener("click", async (e) => {
      const f = e.target.closest("[data-cosm-filter]");
      if (f) { filter = f.dataset.cosmFilter; sec.querySelectorAll("[data-cosm-filter]").forEach((b) => b.classList.toggle("active", b === f)); list(); if ((filter === "secret") !== editingSecret) fill(null, filter === "secret"); return; }
      const ed = e.target.closest("[data-cosm-edit]");
      if (ed) { fill(items.find((i) => i.key === ed.dataset.cosmEdit)); $("cosm-form").scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
      const sc = e.target.closest("[data-cosm-secret]");
      if (sc) { fill(secrets.find((i) => i.key === sc.dataset.cosmSecret), true); $("cosm-form").scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
      if (e.target.closest("#cosm-new")) { fill(null, filter === "secret"); return; }
      if (e.target.closest("#cosm-delete") && editingSecret) {
        const it = secrets.find((i) => i.key === $("cosm-key").value);
        if (!it || !(await Confirm.show(`Rétablir « ${esc(it.label)} » tel que le jeu le donne${it.defaultLabel ? ` (« ${esc(it.defaultLabel)} »)` : ""}, sans style personnalisé ?`, { title: "Cosmétique secret", confirmText: "Rétablir" }))) return;
        try { const r = await API.adminCosmetics(Session.discordId, "delete", { key: it.key }); Toast.success("Rétabli."); await load(r); const back = secrets.find((i) => i.key === it.key); back ? fill(back, true) : fill(null, true); } catch (err) { Toast.error(friendlyError(err)); }
        return;
      }
      if (e.target.closest("#cosm-delete")) {
        const key = $("cosm-key").value;
        const it = items.find((i) => i.key === key);
        if (!it || !(await Confirm.show(it.owners ? `${it.owners} joueur(s) possèdent « ${esc(it.label)} » : il sera seulement retiré de la vente (ils le gardent).` : `Supprimer « ${esc(it.label)} » du catalogue ?`, { title: "Cosmétique", confirmText: it.owners ? "Retirer de la vente" : "Supprimer", dangerous: !it.owners }))) return;
        try { const r = await API.adminCosmetics(Session.discordId, "delete", { key }); Toast.success(r.hiddenOnly ? "Retiré de la vente." : "Supprimé."); load(r); fill(null); } catch (err) { Toast.error(friendlyError(err)); }
        return;
      }
      if (e.target.closest("#cosm-grant")) {
        const userId = Number($("cosm-grant-user").value);
        if (!userId) { Toast.error("Indique l'ID du joueur."); return; }
        try { const r = await API.adminCosmetics(Session.discordId, "grant", { key: $("cosm-key").value, targetUserId: userId }); Toast.success(r.granted ? "Offert !" : "Il l'avait déjà."); load(r); } catch (err) { Toast.error(friendlyError(err)); }
      }
    });
    $("cosm-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const ERR = { invalid_key: "Clé invalide : type-nom-en-minuscules (ex. frame-aurore).", invalid_type: "La clé doit commencer par le type (title-, frame-, color-).", invalid_label: "Donne un nom.", invalid_style: "Couleur principale invalide.", key_taken: "Cette clé est déjà prise (boutique ou secrets)." };
      const secret = editingSecret;
      try {
        const r = await API.adminCosmetics(Session.discordId, "save", { item: formValues() });
        Toast.success(secret ? "Enregistré : nouveau nom et style pour tous ceux qui l'ont." : "Enregistré : visible en boutique au prochain chargement.");
        await load(r);
        fill((secret ? r.secrets : r.items).find((i) => i.key === r.saved), secret);
      } catch (err) { Toast.error(ERR[err.code] || friendlyError(err)); }
    });
  });
})();
