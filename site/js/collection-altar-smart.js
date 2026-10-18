// Sacrifice intelligent (collection, mode Autel, 2026-10-18) : sacrifie en lot
// les doublons par groupes de 3 de meme rarete, selon des regles simples
// (raretes, exemplaires a garder, finitions / etats / wishlist a proteger),
// avec un apercu avant de lancer. Jamais touches : exemplaires assures, ★,
// numeros #1, editions limitees, cartes du coffre. Les sacrifices partent par
// paquets de 10 (/webhook/batch-write, 2026-10-18), arretables entre deux paquets.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const PREF_KEY = "2gatcha_altar_smart_prefs";

  const loadPrefs = () => {
    const def = { rarities: ["commune"], keep: 1, keepFinish: true, keepQuality: true, keepWishlist: true, keepBest: true };
    try { return { ...def, ...(JSON.parse(localStorage.getItem(PREF_KEY) || "{}")) }; } catch (e) { return def; }
  };
  const savePrefs = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* stockage indisponible */ } };

  // Raretes qui ont un palier au-dessus (la plus haute ne se sacrifie pas).
  function altarRarities() {
    const pool = Coll.state.cards.filter((c) => c.inCatalog && !c.isPromo && c.rarity);
    const max = pool.length ? Math.max(...pool.map((c) => c.rarity.sortOrder ?? 0)) : 0;
    return [...new Map(pool.filter((c) => (c.rarity.sortOrder ?? 0) < max).map((c) => [c.rarity.key, c.rarity])).values()]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  // Groupes de 3 exemplaires a sacrifier selon les regles.
  function plan(prefs) {
    const st = Coll.state;
    const allowed = new Set(altarRarities().map((r) => r.key));
    const byRarity = new Map();
    st.ownedMap.forEach((owned, cardId) => {
      const card = st.cards.find((c) => c.cardId === cardId);
      if (!card || !card.inCatalog || card.isPromo || !card.rarity || !allowed.has(card.rarity.key) || !prefs.rarities.includes(card.rarity.key)) return;
      if (prefs.keepWishlist && st.wishlist && st.wishlist.has(cardId)) return;
      const all = owned.copies || [];
      const free = all.filter((c) => !(st.insured && st.insured.has(c.pullId)) && !Coll.isPrecious(c) && !c.inVault);
      // On garde les plus beaux exemplaires, on sacrifie les moins precieux.
      const score = (c) => Coll.FINISH_ORDER.indexOf(Coll.finishOf(c)) * 10 + Coll.QUALITY_ORDER.indexOf(Coll.qualityOf(c));
      const sorted = [...free].sort((a, b) => score(b) - score(a) || (a.serialNumber || 1e9) - (b.serialNumber || 1e9));
      const keepN = Math.max(1, prefs.keep) - (all.length - free.length);
      // Toujours garder la plus belle finition et le meilleur etat de la carte.
      const best = prefs.keepBest ? Coll.keepBestIds(all, free) : new Set();
      sorted.slice(Math.max(0, keepN)).forEach((c) => {
        if (best.has(c.pullId)) return;
        const finish = Coll.finishOf(c), quality = Coll.qualityOf(c);
        if (prefs.keepFinish && finish !== "normal") return;
        if (prefs.keepQuality && (quality === "good" || quality === "mint")) return;
        if (!byRarity.has(card.rarity.key)) byRarity.set(card.rarity.key, { rarity: card.rarity, copies: [] });
        byRarity.get(card.rarity.key).copies.push({ card, copy: c, score: score(c) });
      });
    });
    const groups = [];
    byRarity.forEach(({ rarity, copies }) => {
      copies.sort((a, b) => a.score - b.score || a.card.name.localeCompare(b.card.name));
      for (let i = 0; i + 3 <= copies.length; i += 3) groups.push({ rarity, items: copies.slice(i, i + 3) });
    });
    return groups;
  }

  function open() {
    const prefs = loadPrefs();
    const rarities = altarRarities();
    let running = null;
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay recycle-overlay";
    overlay.innerHTML = `
      <div class="recycle-modal" role="dialog" aria-modal="true" aria-labelledby="altar-smart-title">
        <header class="contract-modal-head">
          <div><span aria-hidden="true">&#128293;</span> <strong id="altar-smart-title">Sacrifice intelligent</strong><small>Sacrifie tes doublons par 3, selon tes règles. 50 % de réussite par sacrifice, un os en cas d'échec.</small></div>
          <button type="button" class="card-modal-close" data-close aria-label="Fermer">&times;</button>
        </header>
        <div class="recycle-body">
          <fieldset class="recycle-group"><legend>Raretés à sacrifier</legend>
            <div class="recycle-chips">${rarities.map((r) => `<label class="recycle-chip" style="--r:${esc(r.colorHex || "#888")}"><input type="checkbox" data-rarity="${esc(r.key)}" ${prefs.rarities.includes(r.key) ? "checked" : ""} /> ${esc(r.name)}</label>`).join("")}</div>
          </fieldset>
          <fieldset class="recycle-group"><legend>Exemplaires à garder par carte</legend>
            <div class="recycle-chips">${[1, 2, 3].map((n) => `<label class="recycle-chip"><input type="radio" name="altar-keep" value="${n}" ${prefs.keep === n ? "checked" : ""} /> ${n}</label>`).join("")}</div>
          </fieldset>
          <fieldset class="recycle-group"><legend>Protéger</legend>
            <label class="recycle-check"><input type="checkbox" data-pref="keepBest" ${prefs.keepBest ? "checked" : ""} /> Toujours ma meilleure finition et mon meilleur état de chaque carte</label>
            <label class="recycle-check"><input type="checkbox" data-pref="keepFinish" ${prefs.keepFinish ? "checked" : ""} /> Les finitions spéciales (holo, dorée…)</label>
            <label class="recycle-check"><input type="checkbox" data-pref="keepQuality" ${prefs.keepQuality ? "checked" : ""} /> Les cartes en bon ou parfait état</label>
            <label class="recycle-check"><input type="checkbox" data-pref="keepWishlist" ${prefs.keepWishlist ? "checked" : ""} /> Les cartes de ma wishlist</label>
            <p class="recycle-note">Jamais touchés : exemplaires assurés, cartes ★, numéros #1, éditions limitées, cartes du coffre.</p>
          </fieldset>
          <div class="recycle-preview" id="altar-smart-preview" aria-live="polite"></div>
        </div>
        <footer class="contract-modal-foot">
          <span class="contract-count" id="altar-smart-count"></span>
          <button type="button" class="btn-ghost" data-close>Fermer</button>
          <button type="button" class="btn-danger" id="altar-smart-go">Sacrifier</button>
        </footer>
      </div>`;
    document.body.appendChild(overlay);
    if (typeof syncScrollLock === "function") syncScrollLock();
    const close = () => { if (running) running.stop = true; overlay.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); if (running && running.done) Coll.refresh(); };

    const draw = () => {
      const groups = plan(prefs);
      const byRarity = new Map();
      groups.forEach((g) => byRarity.set(g.rarity.name, (byRarity.get(g.rarity.name) || 0) + 1));
      $("altar-smart-preview").innerHTML = groups.length
        ? `<p><strong>${groups.length}</strong> sacrifice${groups.length > 1 ? "s" : ""} (${groups.length * 3} exemplaires) · ${[...byRarity].map(([k, n]) => `${n} × 3 ${esc(k)}`).join(", ")} · environ ${Math.round(groups.length / 2)} carte${groups.length >= 4 ? "s" : ""} de la rareté supérieure attendue${groups.length >= 4 ? "s" : ""}</p>
           <ul class="recycle-list">${groups.slice(0, 20).map((g, i) => `<li><span>${i + 1}. ${g.items.map((x) => esc(x.card.name)).join(" + ")}</span><small>${esc(g.rarity.name)}</small></li>`).join("")}${groups.length > 20 ? `<li class="recycle-more">… et ${groups.length - 20} autre${groups.length - 20 > 1 ? "s" : ""}</li>` : ""}</ul>`
        : `<p class="recycle-empty">Pas assez de doublons (3 de même rareté) avec ces règles.</p>`;
      $("altar-smart-count").textContent = "";
      $("altar-smart-go").disabled = !groups.length;
      $("altar-smart-go").textContent = groups.length ? `Lancer ${groups.length} sacrifice${groups.length > 1 ? "s" : ""}` : "Sacrifier";
    };
    draw();

    overlay.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.rarity) prefs.rarities = [...overlay.querySelectorAll("[data-rarity]:checked")].map((x) => x.dataset.rarity);
      else if (t.name === "altar-keep") prefs.keep = Number(t.value);
      else if (t.dataset.pref) prefs[t.dataset.pref] = t.checked;
      savePrefs(prefs);
      if (!running) draw();
    });

    overlay.addEventListener("click", async (e) => {
      if (e.target === overlay || e.target.closest("[data-close]")) { close(); return; }
      if (!e.target.closest("#altar-smart-go")) return;
      if (running && !running.done) { running.stop = true; return; }
      const groups = plan(prefs);
      if (!groups.length) return;
      const go = $("altar-smart-go");
      go.disabled = true;
      if (!(await Confirm.show(`Lancer <strong>${groups.length} sacrifice${groups.length > 1 ? "s" : ""}</strong> (${groups.length * 3} exemplaires) ? Chaque sacrifice a 50 % de chances de donner une carte de la rareté supérieure ; en cas d'échec, les 3 cartes sont perdues contre un os. C'est irréversible.`, { title: "Sacrifice intelligent ?", confirmText: "Sacrifier", dangerous: true }))) { go.disabled = false; return; }
      running = { stop: false, done: false };
      overlay.querySelectorAll("input").forEach((i) => { i.disabled = true; });
      go.disabled = false;
      go.textContent = "Arrêter";
      const won = [];
      let lost = 0, failed = 0;
      try {
        const results = await API.batchWrite("altar-sacrifice", groups.map((g) => ({ userId: Session.userId, pullIds: g.items.map((x) => x.copy.pullId) })), {
          chunk: 10, shouldStop: () => running.stop,
          onChunk: (done, total) => { $("altar-smart-count").innerHTML = `${done} / ${total}`; }
        });
        results.forEach((r) => { if (r.status === 200 && r.json && !r.json.error) { if (r.json.success && r.json.card) won.push(r.json.card); else lost++; } else failed++; });
      } catch (err) {
        Toast.error(friendlyError(err));
      }
      running.done = true;
      close();
      showSummary(won, lost, failed);
    });
  }

  // Bilan a fermer soi-meme : cartes obtenues et os gagnes.
  function showSummary(won, lost, failed) {
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-title">&#128293; Bilan de l'autel</div>
        <div class="confirm-message">
          <p><strong>${won.length}</strong> sacrifice${won.length > 1 ? "s" : ""} réussi${won.length > 1 ? "s" : ""} · <strong>${lost}</strong> os ${resIcon("bone")}${failed ? ` · ${failed} ignoré${failed > 1 ? "s" : ""}` : ""}</p>
          ${won.length ? `<ul class="recycle-list">${won.map((c) => `<li><span>${esc(c.name)}</span><small>${esc(c.rarity?.name || "")}</small></li>`).join("")}</ul>` : ""}
        </div>
        <div class="confirm-actions"><button type="button" class="btn" data-close>Fermer</button></div>
      </div>`;
    const close = () => { overlay.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest("[data-close]")) close(); });
    document.body.appendChild(overlay);
    if (typeof syncScrollLock === "function") syncScrollLock();
    if (won.length && typeof confetti === "function") confetti({ particleCount: 120, spread: 100, origin: { y: 0.5 } });
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  }

  window.AltarSmart = { open, plan };
})();
