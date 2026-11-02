// Page Artistes (2026-10-30, api/src/native/artists.js) : les artistes de
// l'asso derriere les cartes. Sans parametre : la liste ; ?a=<slug> : la page
// d'un artiste (presentation, reseaux sociaux, chiffres, toutes ses cartes).
// Une carte touchee s'ouvre en grand (<dialog>).

(function () {
  const esc = escHtml;
  const img = (id) => (id ? API.imageUrl(id) : "");
  const thumb = (id) => (id ? API.thumbUrl(id) : "");
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const badge = (r) => (r ? `<span class="rarity-badge" style="--r:${esc(r.colorHex || "#94a3b8")}">${esc(r.name)}</span>` : "");
  const pageUrl = (slug) => `artistes.html?a=${encodeURIComponent(slug)}`;

  function avatar(a, cls = "") {
    const style = a.color ? ` style="--art-c:${esc(a.color)}"` : "";
    return a.avatarId
      ? `<span class="art-avatar ${cls}"${style}><img src="${img(a.avatarId)}" alt="" loading="lazy" decoding="async" /></span>`
      : `<span class="art-avatar art-avatar-initials ${cls}"${style} aria-hidden="true">${esc(initials(a.name))}</span>`;
  }
  const linkPills = (links, compact) => links.map((l) => compact
    ? `<a class="art-link-ico" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.label)}${l.handle ? " " + esc(l.handle) : ""}" aria-label="${esc(l.label)}">${l.icon}</a>`
    : `<a class="art-link" data-net="${esc(l.network)}" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">${l.icon}</span><span>${esc(l.label)}${l.handle ? ` <small>${esc(l.handle)}</small>` : ""}</span></a>`).join("");

  // ------------------------------------------------------------------ ma fiche
  // Fiche reliee au compte par l'equipe (api artist-profile) : l'artiste la tient a jour.
  async function toDataUrl(file, max) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const webp = c.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/jpeg", 0.85);
  }
  const ERR = { not_linked: "Cette fiche n'est pas reliée à ton compte.", invalid_color: "Couleur invalide.", not_your_card: "Choisis une de tes cartes.", invalid_image: "Image refusée.", image_too_large: "Image trop lourde, même réduite." };
  const profileApi = (action, slug, params = {}) => API.post("artistProfile", { userId: Session.userId, slug, action, ...params });
  async function openEditor(slug) {
    let p;
    try { p = (await profileApi("status", slug)).profile; } catch (e) { Toast.error(ERR[e.code] || friendlyError(e)); return; }
    const dlg = document.createElement("dialog");
    dlg.className = "art-lightbox art-editor";
    dlg.setAttribute("aria-label", "Modifier ma fiche");
    const pic = (id, label) => (id ? `<img src="${img(id)}" alt="${label}" />` : `<span class="muted">${label} : aucune</span>`);
    dlg.innerHTML = `
      <button type="button" class="art-lb-close" data-close aria-label="Fermer">&times;</button>
      <h2>&#9999;&#65039; Ma fiche d'artiste</h2>
      <p class="muted">Ton nom (${esc(p.name)}) et la visibilité de la page restent gérés par l'équipe.</p>
      <form class="art-ed-form">
        <div class="art-ed-imgs">
          <label class="art-ed-img art-ed-avatar">${pic(p.avatarId, "Photo")}<small>Changer la photo</small><input type="file" accept="image/*" data-img="Avatar" hidden /></label>
          <label class="art-ed-img art-ed-banner">${pic(p.bannerId, "Bannière")}<small>Changer la bannière</small><input type="file" accept="image/*" data-img="Banner" hidden /></label>
        </div>
        <label>Phrase d'accroche <input type="text" name="tagline" maxlength="120" value="${esc(p.tagline)}" placeholder="ex. Illustratrice, fan de chats et d'aquarelle" /></label>
        <label>Présentation (une ligne vide = nouveau paragraphe) <textarea name="bio" rows="6" maxlength="3000">${esc(p.bio)}</textarea></label>
        <label>Réseaux : une adresse par ligne, ou « Libellé | adresse » <textarea name="links" rows="4" maxlength="2000" placeholder="https://www.instagram.com/…">${esc(p.links)}</textarea></label>
        <label>Carte phare <select name="featuredCard"><option value="0">— automatique (ta carte la plus rare) —</option>${p.cards.map((c) => `<option value="${c.cardId}" ${c.cardId === p.featuredCard ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
        <div class="art-ed-color"><label><input type="checkbox" name="colorOn" ${p.color ? "checked" : ""} /> Couleur de ma page</label><input type="color" name="color" value="${esc(p.color || "#8b5cf6")}" aria-label="Couleur" /></div>
        <div class="art-ed-actions"><button type="button" class="btn-ghost" data-close>Annuler</button><button type="submit" class="btn">Enregistrer</button></div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
    dlg.querySelectorAll("[data-img]").forEach((inp) => inp.addEventListener("change", async () => {
      const f = inp.files[0];
      inp.value = "";
      if (!f) return;
      try {
        const res = await profileApi("image", slug, { column: inp.dataset.img, image: await toDataUrl(f, inp.dataset.img === "Banner" ? 1600 : 600) });
        const id = inp.dataset.img === "Banner" ? res.profile.bannerId : res.profile.avatarId;
        inp.closest("label").querySelector("img, span")?.replaceWith(Object.assign(document.createElement("img"), { src: img(id), alt: "" }));
        dlg.dataset.changed = "1";
        Toast.success("Image mise à jour.");
      } catch (e) { Toast.error(ERR[e.code] || friendlyError(e)); }
    }));
    dlg.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await profileApi("save", slug, { fields: { tagline: fd.get("tagline"), bio: fd.get("bio"), links: fd.get("links"), featuredCard: Number(fd.get("featuredCard")) || 0, color: fd.get("colorOn") ? fd.get("color") : "" } });
        Toast.success("Fiche enregistrée.");
        dlg.dataset.changed = "1";
        dlg.close();
      } catch (err) { Toast.error(ERR[err.code] || friendlyError(err)); }
    });
    dlg.addEventListener("close", () => { if (dlg.dataset.changed) location.replace(pageUrl(slug)); });
    dlg.showModal();
  }

  // ------------------------------------------------------------------ liste
  function renderList(root, artists, mine) {
    const logged = Session.isLoggedIn();
    root.innerHTML = `
      <header class="art-intro">
        <h1>&#127912; Les artistes</h1>
        <p class="lead">Chaque carte de 2Gatcha est dessinée par un membre de l'asso. Découvre qui se cache derrière tes illustrations préférées, suis-les sur leurs réseaux et retrouve toutes leurs créations du jeu.</p>
        ${mine ? `<a class="btn art-edit" href="${pageUrl(mine)}&edit=1">&#9999;&#65039; Modifier ma fiche d'artiste</a>` : ""}
      </header>
      ${artists.length ? `<div class="art-grid">${artists.map((a) => `
        <article class="art-tile"${a.color ? ` style="--art-c:${esc(a.color)}"` : ""}>
          <a class="art-tile-main" href="${pageUrl(a.slug)}">
            <span class="art-tile-cover">${a.bannerId || a.cover?.imageId ? `<img src="${img(a.bannerId || a.cover.imageId)}" alt="" loading="lazy" decoding="async" />` : ""}</span>
            ${avatar(a, "art-avatar-md")}
            <strong class="art-tile-name">${esc(a.name)}</strong>
            ${a.tagline ? `<span class="art-tile-tag">${esc(a.tagline)}</span>` : ""}
            <span class="art-tile-count">${plural(a.cardCount, "carte", "cartes")}${logged && a.owned != null && a.cardCount ? ` · ${a.owned} à toi` : ""}</span>
          </a>
          ${a.links.length ? `<div class="art-tile-links">${linkPills(a.links, true)}</div>` : ""}
        </article>`).join("")}</div>` : '<p class="empty-state">Les artistes arrivent bientôt.</p>'}`;
  }

  // ------------------------------------------------------------------ fiche
  function renderArtist(root, d) {
    const a = d.artist, s = d.stats, logged = d.cards.some((c) => "owned" in c);
    document.title = `${a.name} - Artistes - 2Gatcha`;
    const state = { ext: 0, missing: false };
    const tile = (c) => `
      <button type="button" class="art-card ${logged && !c.owned ? "is-missing" : ""}" data-card="${c.cardId}" style="--r:${esc(c.rarity?.colorHex || "#94a3b8")}">
        <span class="art-card-img">${c.imageId ? `<img src="${thumb(c.imageId)}" alt="${esc(c.name)}" loading="lazy" decoding="async" />` : ""}</span>
        <span class="art-card-info"><strong>${esc(c.name)}</strong>${badge(c.rarity)}</span>
        ${logged ? `<span class="art-card-own" title="${c.owned ? "Dans ta collection" : "Pas encore dans ta collection"}">${c.owned ? "&#10003;" : "?"}</span>` : ""}
      </button>`;
    const pct = logged && s.cards ? Math.round((100 * a.owned) / s.cards) : 0;
    root.innerHTML = `
      <a class="art-back" href="artistes.html">&larr; Tous les artistes</a>
      <section class="art-hero"${a.color ? ` style="--art-c:${esc(a.color)}"` : ""}>
        <div class="art-hero-bg">${a.bannerId || a.cover?.imageId ? `<img src="${img(a.bannerId || a.cover.imageId)}" alt="" decoding="async" />` : ""}</div>
        <div class="art-hero-body">
          ${avatar(a, "art-avatar-lg")}
          <div class="art-hero-text">
            <span class="art-kicker">Artiste de 2Gatcha</span>
            <h1>${esc(a.name)}</h1>
            ${a.tagline ? `<p class="art-tagline">${esc(a.tagline)}</p>` : ""}
          </div>
          <button type="button" class="btn-ghost art-share" id="art-share">&#128279; Partager</button>
          ${d.editable ? '<button type="button" class="btn art-edit" id="art-edit">&#9999;&#65039; Modifier ma fiche</button>' : ""}
        </div>
      </section>
      <div class="art-layout">
        <div class="art-about">
          ${a.bio ? `<div class="art-bio">${esc(a.bio).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>").replace(/^/, "<p>")}</p></div>` : (a.hasProfile ? "" : '<p class="art-bio muted">La présentation de cet artiste arrive bientôt.</p>')}
          ${a.links.length ? `<h2 class="art-h2">Suivre ${esc(a.name)}</h2><div class="art-links">${linkPills(a.links, false)}</div>` : ""}
          <div class="art-stats">
            <div><strong>${s.cards}</strong><span>${s.cards > 1 ? "cartes" : "carte"}</span></div>
            <div><strong>${s.extensions}</strong><span>${s.extensions > 1 ? "extensions" : "extension"}</span></div>
            <div><strong>${s.copies}</strong><span>exemplaires chez les joueurs</span></div>
            <div><strong>${s.collectors}</strong><span>${s.collectors > 1 ? "collectionneurs" : "collectionneur"}</span></div>
          </div>
          ${logged ? `<div class="art-progress"><span>Tu as <strong>${a.owned}</strong> de ses ${plural(s.cards, "carte", "cartes")}</span><span class="art-bar"><span style="width:${pct}%"></span></span></div>` : ""}
        </div>
        ${a.cover ? `<button type="button" class="art-feature" data-card="${a.cover.cardId}" style="--r:${esc(a.cover.rarity?.colorHex || "#94a3b8")}">
          <span class="art-feature-label">&#11088; Carte phare</span>
          ${a.cover.imageId ? `<img src="${img(a.cover.imageId)}" alt="${esc(a.cover.name)}" decoding="async" />` : ""}
          <span class="art-feature-name">${esc(a.cover.name)} ${badge(a.cover.rarity)}</span>
        </button>` : ""}
      </div>
      <section class="art-gallery">
        <div class="art-gallery-head">
          <h2 class="art-h2">Ses créations dans le jeu</h2>
          <div class="art-filters" role="group" aria-label="Filtrer">
            ${d.extensions.length > 1 ? `<button type="button" class="art-chip active" data-ext="0">Toutes <small>${s.cards}</small></button>${d.extensions.map((e) => `<button type="button" class="art-chip" data-ext="${e.id}">${esc(e.name)} <small>${e.count}</small></button>`).join("")}` : ""}
            ${logged && a.owned < s.cards ? '<label class="art-missing"><input type="checkbox" id="art-missing" /> Celles qui me manquent</label>' : ""}
          </div>
        </div>
        <div class="art-cards" id="art-cards"></div>
      </section>`;

    const grid = root.querySelector("#art-cards");
    const paint = () => {
      const list = d.cards.filter((c) => (!state.ext || c.extensionId === state.ext) && (!state.missing || !c.owned));
      grid.innerHTML = list.map(tile).join("") || '<p class="empty-state">Tu les as toutes. Bravo !</p>';
    };
    paint();
    root.querySelectorAll("[data-ext]").forEach((b) => b.addEventListener("click", () => {
      state.ext = Number(b.dataset.ext);
      root.querySelectorAll("[data-ext]").forEach((x) => x.classList.toggle("active", x === b));
      paint();
    }));
    root.querySelector("#art-missing")?.addEventListener("change", (e) => { state.missing = e.target.checked; paint(); });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-card]");
      if (b) openCard(d, Number(b.dataset.card));
    });
    root.querySelector("#art-edit")?.addEventListener("click", () => openEditor(a.slug));
    if (d.editable && new URLSearchParams(location.search).get("edit") === "1") openEditor(a.slug);
    root.querySelector("#art-share").addEventListener("click", async () => {
      const url = location.origin + location.pathname + "?a=" + encodeURIComponent(a.slug);
      try {
        if (navigator.share) await navigator.share({ title: `${a.name} sur 2Gatcha`, url });
        else { await navigator.clipboard.writeText(url); Toast.success("Lien copié."); }
      } catch (err) { /* partage annule */ }
    });
  }

  function openCard(d, cardId) {
    const c = d.cards.find((x) => x.cardId === cardId);
    const dlg = document.getElementById("art-lightbox");
    if (!c || !dlg) return;
    const ext = d.extensions.find((e) => e.id === c.extensionId);
    document.getElementById("art-lb-body").innerHTML = `
      <div class="art-lb-img" style="--r:${esc(c.rarity?.colorHex || "#94a3b8")}">${c.imageId ? `<img src="${img(c.imageId)}" alt="${esc(c.name)}" />` : ""}</div>
      <div class="art-lb-info">
        <h2>${esc(c.name)}</h2>
        ${badge(c.rarity)}
        <p class="muted">Illustration : ${esc(d.artist.name)}${ext ? " · " + esc(ext.name) : ""}</p>
        ${c.description ? `<p class="art-lb-lore">« ${esc(c.description)} »</p>` : ""}
        <p class="muted">${c.copies ? plural(c.copies, "exemplaire", "exemplaires") + " chez les joueurs" : "Personne ne l'a encore tirée"}${"owned" in c ? ` · ${c.owned ? "&#10003; dans ta collection" : "pas encore à toi"}` : ""}</p>
      </div>`;
    dlg.showModal();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const root = document.getElementById("artists-root");
    if (!root) return;
    const dlg = document.getElementById("art-lightbox");
    dlg?.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
    const slug = new URLSearchParams(location.search).get("a");
    const userId = Session.isLoggedIn() ? Session.userId : undefined;
    try {
      if (slug) renderArtist(root, await API.get("artist", { slug, ...(userId ? { userId } : {}) }));
      else { const res = await API.get("artists", userId ? { userId } : {}); renderList(root, res.artists, res.mine); }
    } catch (e) {
      root.innerHTML = e.code === "unknown_artist"
        ? '<p class="empty-state">Cet artiste est introuvable.</p><p style="text-align:center"><a href="artistes.html">&larr; Tous les artistes</a></p>'
        : `<p class="empty-state">${esc(typeof friendlyError === "function" ? friendlyError(e) : "Page indisponible pour le moment.")}</p>`;
    }
  });
})();
