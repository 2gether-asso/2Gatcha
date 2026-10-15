// Previsualisation des animations (page Admin, 2026-10-15) : decouvertes de
// ressources (ui.js DiscoveryFx), cinematiques et suspense d'ouverture,
// choix / dechirure / god pack du booster (opening-fx.js), sons, montee de
// niveau. Purement local : aucune action n'est envoyee au serveur.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="300" height="420" fill="url(#g)"/><text x="150" y="230" font-size="90" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="800">2G</text></svg>');
  const FINISHES = { normal: "Normale", holo: "Holo", gold: "Dorée", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  let RARITIES = [
    { key: "commune", name: "Commune", colorHex: "#9aa0b4" }, { key: "rare", name: "Rare", colorHex: "#60a5fa" },
    { key: "epique", name: "Épique", colorHex: "#a855f7" }, { key: "legendaire", name: "Légendaire", colorHex: "#f5a524" },
    { key: "mythique", name: "Mythique", colorHex: "#ef4444" }, { key: "unique", name: "Unique", colorHex: "#22c55e" }
  ];
  let cards = [];
  let discoveries = [];

  const card = () => cards.find((c) => String(c.cardId) === $("ap-card").value) || null;
  // Meme structure qu'une carte revelee a l'ouverture.
  function cardHtml(rarity, { revealed = true } = {}) {
    const c = card();
    const img = c && c.imageId ? API.imageUrl(c.imageId) : PLACEHOLDER;
    const finish = $("ap-finish").value || "normal";
    return `<div class="card ${revealed ? "revealed" : ""}" data-rarity="${rarity.key}" data-finish="${finish}" data-quality="mint" data-active="true">
      <div class="card-inner">
        <div class="card-face card-back"><span class="tap-hint">Tape pour révéler</span></div>
        <div class="card-face card-front">
          <div class="card-art"><img src="${img}" alt="" />${finish !== "normal" ? `<span class="finish-indicator" data-finish="${finish}">${FINISHES[finish]}</span>` : ""}</div>
          <div class="card-info"><div class="card-name">${esc(c ? c.name : "Carte de démonstration")}</div><div class="card-artist">${esc(c ? c.artist || "" : "2Gatcha")}</div><span class="rarity-badge" style="--r:${rarity.colorHex}">${esc(rarity.name)}</span></div>
        </div>
      </div>
    </div>`;
  }

  // Cinematique : construite sur une carte hors ecran (OpeningFx copie sa face).
  function cinematic(rarity, label) {
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-9999px;top:0;width:200px;";
    holder.innerHTML = cardHtml(rarity);
    document.body.appendChild(holder);
    const el = holder.firstElementChild;
    if (typeof Sfx !== "undefined") { Sfx.flip && Sfx.flip(); setTimeout(() => Sfx.reveal && Sfx.reveal(rarity.key), 260); }
    OpeningFx.cinematic(el, { rarity }, rarity.colorHex, label || rarity.name + " !", OpeningFx.tierOf(rarity.key, label === "GOD PACK !")).then(() => holder.remove());
  }

  async function suspense(rarity) {
    const grid = $("ap-suspense-grid");
    grid.innerHTML = cardHtml(rarity, { revealed: false });
    const el = grid.firstElementChild;
    await new Promise((r) => setTimeout(r, 250));
    await OpeningFx.suspense(el, rarity.key, rarity.colorHex);
    el.classList.add("revealed");
    if (typeof Sfx !== "undefined") { Sfx.flip && Sfx.flip(); setTimeout(() => Sfx.reveal && Sfx.reveal(rarity.key), 260); }
    const f = $("ap-finish").value;
    if (f && f !== "normal" && Sfx.finish) Sfx.finish(f);
  }

  // Booster : eventail de 3, puis dechirure au doigt.
  function packReset() {
    const pack = $("ap-pack");
    pack.classList.remove("god-pack", "tearing");
    pack.style.visibility = "visible";
    $("ap-pack-note").textContent = "Choisis ton booster";
    OpeningFx.packChoice(pack, pack.innerHTML, () => { $("ap-pack-note").textContent = "Glisse sur le booster pour le déchirer, ou tape dessus"; });
  }
  function packTorn() {
    const pack = $("ap-pack");
    if (Sfx.tear) Sfx.tear();
    OpeningFx.vibrate(35);
    pack.classList.add("tearing");
    $("ap-pack-note").textContent = pack.classList.contains("god-pack") ? "🌟 Déchiré : god pack !" : "Déchiré !";
    setTimeout(() => { pack.classList.remove("tearing"); }, 900);
  }

  function renderButtons() {
    $("ap-discoveries").innerHTML = discoveries.length
      ? discoveries.map((d) => `<button type="button" class="btn-secondary" data-disc="${d.key}">${d.icon} ${esc(d.name)}</button>`).join("")
      : '<span class="muted">Catalogue indisponible (serveur injoignable).</span>';
    // En jeu : legendaire et mieux (ou la derniere carte d'un god pack).
    const big = RARITIES.filter((r) => ["legendaire", "mythique", "unique"].includes(r.key));
    $("ap-cinematics").innerHTML = RARITIES.map((r) => `<button type="button" class="btn-secondary" data-cine="${r.key}" style="--r:${r.colorHex}">${esc(r.name)}${big.includes(r) ? "" : " (jamais en jeu)"}</button>`).join("")
      + '<button type="button" class="btn" data-cine="god">🌟 GOD PACK !</button>';
    $("ap-suspense").innerHTML = RARITIES.map((r) => `<button type="button" class="btn-secondary" data-sus="${r.key}">${esc(r.name)}</button>`).join("");
    const sounds = [
      ...RARITIES.map((r) => [`reveal:${r.key}`, `Révélation ${r.name}`]),
      ...Object.entries(FINISHES).filter(([k]) => k !== "normal").map(([k, v]) => [`finish:${k}`, `Finition ${v}`]),
      ["tear", "Déchirure"], ["whoosh", "Souffle"], ["heartbeat", "Battement de cœur"], ["pick", "Choix du booster"], ["fanfare", "Fanfare"], ["flip", "Retournement"]
    ];
    $("ap-sounds").innerHTML = sounds.map(([k, label]) => `<button type="button" class="btn-ghost" data-snd="${k}">${esc(label)}</button>`).join("");
  }
  const paintSound = () => { $("ap-sound").innerHTML = Sfx.muted ? "&#128264; Son coupé : l'activer" : "&#128266; Son actif : le couper"; };

  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !e.target.closest("#main-content")) return;
    if (b.dataset.disc) return DiscoveryFx.show(discoveries.find((d) => d.key === b.dataset.disc), 0);
    if (b.dataset.cine === "god") return cinematic(RARITIES.find((r) => r.key === "epique") || RARITIES[2], "GOD PACK !");
    if (b.dataset.cine) return cinematic(RARITIES.find((r) => r.key === b.dataset.cine));
    if (b.dataset.sus) return suspense(RARITIES.find((r) => r.key === b.dataset.sus));
    if (b.dataset.snd) {
      const [k, arg] = b.dataset.snd.split(":");
      if (Sfx.muted) Toast.info("Son coupé : active-le avec le bouton en haut.");
      if (k === "reveal") return Sfx.reveal(arg);
      if (k === "finish") return Sfx.finish(arg);
      return Sfx[k] && Sfx[k]();
    }
    if (b.id === "ap-sound") { Sfx.setMuted(!Sfx.muted); paintSound(); return; }
    if (b.id === "ap-pack-reset") return packReset();
    if (b.id === "ap-pack-god") {
      const pack = $("ap-pack");
      pack.classList.toggle("god-pack");
      if (pack.classList.contains("god-pack")) { Sfx.fanfare && Sfx.fanfare(); OpeningFx.vibrate([60, 40, 60, 40, 120]); }
      return;
    }
    if (b.id === "ap-levelup") return LevelUpModal.show({ icon: "&#127907;", name: "Pêche", level: 5, perks: ["+8 lancers par jour", "24 % de prises vides en moins", "+32 % de chances de prises rares"] });
    if (b.id === "ap-confetti") return typeof confetti === "function" && confetti({ particleCount: 200, spread: 120, origin: { y: 0.55 } });
    if (b.id === "ap-multi") return DiscoveryFx.show(discoveries.slice(0, 3), 0);
  });

  document.addEventListener("DOMContentLoaded", async () => {
    $("ap-finish").innerHTML = Object.entries(FINISHES).map(([k, v]) => `<option value="${k}" ${k === "gold" ? "selected" : ""}>${v}</option>`).join("");
    paintSound();
    const pack = $("ap-pack");
    pack.addEventListener("click", () => { if (pack._swiped) { pack._swiped = false; return; } if (!pack.classList.contains("tearing")) packTorn(); });
    OpeningFx.attachSwipe(pack, packTorn);
    renderButtons();
    packReset();
    const [cat, disc] = await Promise.allSettled([API.getCards(), API.get("discoveriesCatalog")]);
    if (cat.status === "fulfilled") {
      cards = (cat.value.cards || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      const seen = new Map();
      cards.forEach((c) => { if (c.rarity && c.rarity.key && !seen.has(c.rarity.key)) seen.set(c.rarity.key, { key: c.rarity.key, name: c.rarity.name, colorHex: c.rarity.colorHex || "#9aa0b4", sortOrder: c.rarity.sortOrder || 0 }); });
      // Toutes les raretes du jeu restent (meme sans carte au catalogue, ex.
      // aucune mythique) ; celles du catalogue donnent noms et couleurs.
      const ORDER = ["commune", "rare", "epique", "legendaire", "mythique", "unique"];
      RARITIES = [...RARITIES.map((r) => seen.get(r.key) || r), ...[...seen.values()].filter((r) => !ORDER.includes(r.key))]
        .sort((a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99));
      $("ap-card").innerHTML = '<option value="">— illustration de démonstration —</option>' + cards.map((c) => `<option value="${c.cardId}">${esc(c.name)}${c.rarity ? " · " + esc(c.rarity.name) : ""}</option>`).join("");
      if (cards[0]) $("ap-card").value = String(cards[0].cardId);
    } else $("ap-card").innerHTML = '<option value="">— illustration de démonstration —</option>';
    if (disc.status === "fulfilled") discoveries = disc.value.items || [];
    renderButtons();
  });
})();
