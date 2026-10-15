// Previsualisation de carte (Admin, 2026-10-15) : toutes les apparences d'une
// carte (rarete, finition, etat, edition limitee, marques) avec le balisage
// reel du site : carte revelee (opening.js) et vignette de collection
// (collection-binder.js). Rien n'est envoye au serveur.

(function () {
  const esc = escHtml;
  const FINISHES = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const QUALITIES = { damaged: "Usé", worn: "Abîmé", good: "Bon état", mint: "Parfait état" };
  // Raretes par defaut (remplacees par celles du catalogue quand il repond).
  let RARITIES = [
    { key: "commune", name: "Commune", colorHex: "#9aa0b4" }, { key: "rare", name: "Rare", colorHex: "#3b82f6" },
    { key: "epique", name: "Épique", colorHex: "#a855f7" }, { key: "legendaire", name: "Légendaire", colorHex: "#f59e0b" },
    { key: "mythique", name: "Mythique", colorHex: "#ef4444" }, { key: "unique", name: "Unique", colorHex: "#22c55e" }
  ];
  let cards = [], uploaded = null, axis = "finish";
  const $ = (id) => document.getElementById(id);

  // Etat courant du formulaire.
  function current() {
    const card = cards.find((c) => String(c.cardId) === $("pt-card").value);
    return {
      img: uploaded || (card ? API.imageUrl(card.imageId) : "") || PLACEHOLDER_IMG,
      name: $("pt-name").value || "Nom de la carte",
      artist: $("pt-artist").value,
      rarity: RARITIES.find((r) => r.key === $("pt-rarity").value) || RARITIES[0],
      finish: $("pt-finish").value, quality: $("pt-quality").value, edition: $("pt-edition").value,
      serial: $("pt-serial").checked, star: $("pt-star").checked, forged: $("pt-forged").checked
    };
  }

  const badges = (v) => `
    ${v.finish !== "normal" ? `<span class="finish-indicator" data-finish="${v.finish}">${FINISHES[v.finish]}</span>` : ""}
    <span class="quality-indicator" data-quality="${v.quality}">${QUALITIES[v.quality]}</span>
    ${v.serial ? '<span class="serial-one-badge" title="Premier exemplaire en circulation">#001</span>' : ""}
    ${v.edition ? editionBadge(v.edition) : ""}`;
  const rarityBadge = (r) => `<span class="rarity-badge" style="background:${r.colorHex}22;color:${rarityTextColor(r.colorHex)};border:1px solid ${r.colorHex};">${esc(r.name)}</span>`;

  // Meme structure que buildCardEl (opening.js), deja retournee.
  function revealHtml(v) {
    return `<div class="card revealed pt-card" data-rarity="${v.rarity.key}" data-finish="${v.finish}" data-quality="${v.quality}"${v.edition ? ` data-edition="${v.edition}"` : ""}>
      <div class="card-inner">
        <div class="card-face card-back"><span>?</span></div>
        <div class="card-face card-front">
          <div class="card-art"><img src="${v.img}" alt="" />${badges(v)}</div>
          <div class="card-info"><div class="card-name">${esc(v.name)}</div><div class="card-artist">${esc(v.artist || "")}</div>${rarityBadge(v.rarity)}</div>
        </div>
      </div>
    </div>`;
  }
  // Meme structure que la vignette de collection (collection-binder.js).
  function tileHtml(v, caption) {
    return `<div class="pt-tile">
      <div class="collection-card ${v.star ? "has-star" : ""}" data-rarity="${v.rarity.key}" data-finish="${v.finish}" data-quality="${v.quality}"${v.edition ? ` data-edition="${v.edition}"` : ""}>
        <div class="card-art">
          <img src="${v.img}" alt="" />${badges(v)}
          <span class="tile-marks">${v.star ? '<span class="star-badge" title="Exemplaire ★">&#9733;</span>' : ""}${v.forged ? '<span class="forged-badge" title="Forgée dans les flammes">&#128293;</span>' : ""}</span>
        </div>
        <div class="card-info"><div class="card-name">${esc(v.name)}</div>${rarityBadge(v.rarity)}<div class="count-badge">x1</div></div>
      </div>
      ${caption ? `<small class="pt-caption">${caption}</small>` : ""}
    </div>`;
  }

  function renderGallery(v) {
    let items = [], note = "";
    if (axis === "finish") { items = Object.keys(FINISHES).map((f) => [{ ...v, finish: f }, FINISHES[f]]); note = `Les 6 finitions, en ${QUALITIES[v.quality].toLowerCase()}, rareté ${v.rarity.name}.`; }
    if (axis === "quality") { items = Object.keys(QUALITIES).map((q) => [{ ...v, quality: q }, QUALITIES[q]]); note = `Les 4 états (de l'usure au parfait état), finition ${FINISHES[v.finish]}.`; }
    if (axis === "edition") { items = [["", "Sans édition"], ...Object.entries(EDITIONS).map(([k, e]) => [k, `${e.icon} ${e.label}`])].map(([k, label]) => [{ ...v, edition: k }, label]); note = "Les éditions limitées : une par mode de jeu, une par événement saisonnier, et Fantôme (carte du mois)."; }
    if (axis === "rarity") { items = RARITIES.map((r) => [{ ...v, rarity: r }, r.name]); note = `Toutes les raretés, finition ${FINISHES[v.finish]}, ${QUALITIES[v.quality].toLowerCase()}.`; }
    if (axis === "matrix") {
      items = Object.keys(FINISHES).flatMap((f) => Object.keys(QUALITIES).map((q) => [{ ...v, finish: f, quality: q }, `${FINISHES[f]} · ${QUALITIES[q]}`]));
      note = "Les 24 combinaisons finition × état (lignes : finitions, colonnes : états).";
    }
    $("pt-gallery-note").textContent = note;
    $("pt-gallery").className = "pt-gallery" + (axis === "matrix" ? " matrix" : "");
    $("pt-gallery").innerHTML = items.map(([iv, label]) => tileHtml(iv, esc(label))).join("");
  }

  function render() {
    const v = current();
    $("pt-reveal").innerHTML = revealHtml(v);
    $("pt-tile").innerHTML = tileHtml(v, "");
    if (window.CardTilt) { CardTilt.attach($("pt-reveal").querySelector(".card"), { gyro: true }); CardTilt.attach($("pt-tile").querySelector(".collection-card")); }
    renderGallery(v);
  }

  function fillSelect(id, entries, selected) {
    $(id).innerHTML = entries.map(([k, label]) => `<option value="${k}" ${k === selected ? "selected" : ""}>${esc(label)}</option>`).join("");
  }
  function fillRarities() {
    const keep = $("pt-rarity").value || "legendaire";
    fillSelect("pt-rarity", RARITIES.map((r) => [r.key, r.name]), RARITIES.some((r) => r.key === keep) ? keep : RARITIES[0].key);
  }

  async function loadCatalog() {
    try {
      const res = await API.getCards();
      cards = (res.cards || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      // Raretes reelles du catalogue (couleurs et noms de la prod).
      const seen = new Map();
      cards.forEach((c) => { if (c.rarity && c.rarity.key && !seen.has(c.rarity.key)) seen.set(c.rarity.key, { key: c.rarity.key, name: c.rarity.name, colorHex: c.rarity.colorHex || "#9aa0b4", sortOrder: c.rarity.sortOrder || 0 }); });
      if (seen.size) RARITIES = [...seen.values(), ...RARITIES.filter((r) => !seen.has(r.key))].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
      fillRarities();
      $("pt-card").innerHTML = `<option value="">— aucune (image importée) —</option>` + cards.map((c) => `<option value="${c.cardId}">${esc(c.name)}${c.rarity ? " · " + esc(c.rarity.name) : ""}</option>`).join("");
      if (cards[0]) { $("pt-card").value = String(cards[0].cardId); pickCard(); }
    } catch (e) {
      $("pt-card").innerHTML = `<option value="">Catalogue indisponible : importe une image</option>`;
    }
    render();
  }
  // Une carte du catalogue reprend son nom, son artiste et sa rarete.
  function pickCard() {
    const card = cards.find((c) => String(c.cardId) === $("pt-card").value);
    if (!card) return;
    uploaded = null;
    $("pt-image").value = "";
    $("pt-name").value = card.name;
    $("pt-artist").value = card.artist || "";
    if (card.rarity && RARITIES.some((r) => r.key === card.rarity.key)) $("pt-rarity").value = card.rarity.key;
  }

  document.addEventListener("DOMContentLoaded", () => {
    fillRarities();
    fillSelect("pt-finish", Object.entries(FINISHES), "holo");
    fillSelect("pt-quality", Object.entries(QUALITIES), "mint");
    fillSelect("pt-edition", [["", "Aucune"], ...Object.entries(EDITIONS).map(([k, e]) => [k, `${e.icon} ${e.label}`])], "");
    $("pt-card").addEventListener("change", () => { pickCard(); render(); });
    $("pt-image").addEventListener("change", () => {
      const file = $("pt-image").files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => { uploaded = e.target.result; $("pt-card").value = ""; render(); };
      reader.readAsDataURL(file);
    });
    $("preview-form").addEventListener("input", (e) => { if (e.target.id !== "pt-card" && e.target.id !== "pt-image") render(); });
    $("pt-random").addEventListener("click", () => {
      const pick = (o) => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
      $("pt-finish").value = pick(FINISHES);
      $("pt-quality").value = pick(QUALITIES);
      $("pt-edition").value = Math.random() < 0.5 ? "" : pick(EDITIONS);
      $("pt-rarity").value = RARITIES[Math.floor(Math.random() * RARITIES.length)].key;
      render();
    });
    document.querySelector(".pt-axes").addEventListener("click", (e) => {
      const b = e.target.closest("[data-axis]");
      if (!b) return;
      axis = b.dataset.axis;
      document.querySelectorAll(".pt-axes [data-axis]").forEach((x) => x.classList.toggle("active", x === b));
      renderGallery(current());
    });
    render();
    loadCatalog();
  });
})();
