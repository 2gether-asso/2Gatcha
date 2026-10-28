// Page Artistes (2026-10-30, api/src/native/artists.js) : les artistes de
// l'asso derriere les cartes. Sans parametre : la liste ; ?a=<slug> : la page
// d'un artiste (presentation, reseaux sociaux, chiffres, toutes ses cartes).
// Une carte touchee s'ouvre en grand (<dialog>).

(function () {
  const esc = escHtml;
  const img = (id) => (id ? API.imageUrl(id) : "");
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

  // ------------------------------------------------------------------ liste
  function renderList(root, artists) {
    const logged = Session.isLoggedIn();
    root.innerHTML = `
      <header class="art-intro">
        <h1>&#127912; Les artistes</h1>
        <p class="lead">Chaque carte de 2Gatcha est dessinée par un membre de l'asso. Découvre qui se cache derrière tes illustrations préférées, suis-les sur leurs réseaux et retrouve toutes leurs créations du jeu.</p>
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
        <span class="art-card-img">${c.imageId ? `<img src="${img(c.imageId)}" alt="${esc(c.name)}" loading="lazy" decoding="async" />` : ""}</span>
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
      else renderList(root, (await API.get("artists", userId ? { userId } : {})).artists);
    } catch (e) {
      root.innerHTML = e.code === "unknown_artist"
        ? '<p class="empty-state">Cet artiste est introuvable.</p><p style="text-align:center"><a href="artistes.html">&larr; Tous les artistes</a></p>'
        : `<p class="empty-state">${esc(typeof friendlyError === "function" ? friendlyError(e) : "Page indisponible pour le moment.")}</p>`;
    }
  });
})();
