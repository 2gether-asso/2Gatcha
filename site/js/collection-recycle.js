// Recyclage intelligent (collection, mode Décrafter, 2026-10-09) : decrafte
// en lot les doublons selon des regles simples (raretes, exemplaires a
// garder, finitions et etats a proteger), avec un apercu avant de lancer.
// Les exemplaires assures, ★ et les numeros #1 ne sont jamais touches. Les
// decrafts partent un par un, espaces (moins de 60 par minute), et le lot
// peut etre arrete a tout moment.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const PREF_KEY = "2gatcha_recycle_prefs";
  const PACE_MS = 1100;
  const RARITY_ORDER = ["commune", "rare", "epique", "legendaire", "mythique"];

  const loadPrefs = () => {
    const def = { rarities: ["commune", "rare"], keep: 1, keepFinish: true, keepQuality: true, keepWishlist: true };
    try { return { ...def, ...(JSON.parse(localStorage.getItem(PREF_KEY) || "{}")) }; } catch (e) { return def; }
  };
  const savePrefs = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* stockage indisponible */ } };

  // Exemplaires a decrafter selon les regles.
  function plan(prefs) {
    const st = Coll.state;
    const out = [];
    st.ownedMap.forEach((owned, cardId) => {
      const card = st.cards.find((c) => c.cardId === cardId);
      if (!card || card.isPromo || card.rarity?.disenchantValue == null) return;
      if (!prefs.rarities.includes(card.rarity?.key)) return;
      if (prefs.keepWishlist && st.wishlist && st.wishlist.has(cardId)) return;
      const copies = (owned.copies || []).filter((c) =>
        !(st.insured && st.insured.has(c.pullId)) && !(st.starred && st.starred.has(c.pullId)) && c.serialNumber !== 1 && !c.inVault);
      // On garde d'abord les plus beaux exemplaires.
      const score = (c) => Coll.FINISH_ORDER.indexOf(Coll.finishOf(c)) * 10 + Coll.QUALITY_ORDER.indexOf(Coll.qualityOf(c));
      const sorted = [...copies].sort((a, b) => score(b) - score(a) || (a.serialNumber || 1e9) - (b.serialNumber || 1e9));
      const protectedCount = (owned.copies || []).length - copies.length;
      const keepN = Math.max(0, prefs.keep - protectedCount);
      sorted.slice(keepN).forEach((c) => {
        const finish = Coll.finishOf(c), quality = Coll.qualityOf(c);
        if (prefs.keepFinish && finish !== "normal") return;
        if (prefs.keepQuality && (quality === "good" || quality === "mint")) return;
        out.push({ card, copy: c, finish, quality, dust: Coll.estimateDust(card.rarity.disenchantValue, finish, quality) });
      });
    });
    return out;
  }

  function open() {
    let prefs = loadPrefs();
    let running = null;
    const rarities = [...new Map(Coll.state.cards.filter((c) => c.rarity && c.rarity.key !== "unique").map((c) => [c.rarity.key, c.rarity])).values()]
      .sort((a, b) => RARITY_ORDER.indexOf(a.key) - RARITY_ORDER.indexOf(b.key));
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay recycle-overlay";
    overlay.innerHTML = `
      <div class="recycle-modal" role="dialog" aria-modal="true" aria-labelledby="recycle-title">
        <header class="contract-modal-head">
          <div><span aria-hidden="true">&#9851;&#65039;</span> <strong id="recycle-title">Recyclage intelligent</strong><small>Décrafte tes doublons en un clic, selon tes règles.</small></div>
          <button type="button" class="card-modal-close" data-close aria-label="Fermer">&times;</button>
        </header>
        <div class="recycle-body">
          <fieldset class="recycle-group"><legend>Raretés à recycler</legend>
            <div class="recycle-chips">${rarities.map((r) => `<label class="recycle-chip" style="--r:${esc(r.colorHex || "#888")}"><input type="checkbox" data-rarity="${esc(r.key)}" ${prefs.rarities.includes(r.key) ? "checked" : ""} /> ${esc(r.name)}</label>`).join("")}</div>
          </fieldset>
          <fieldset class="recycle-group"><legend>Exemplaires à garder par carte</legend>
            <div class="recycle-chips">${[1, 2, 3].map((n) => `<label class="recycle-chip"><input type="radio" name="recycle-keep" value="${n}" ${prefs.keep === n ? "checked" : ""} /> ${n}</label>`).join("")}</div>
          </fieldset>
          <fieldset class="recycle-group"><legend>Protéger</legend>
            <label class="recycle-check"><input type="checkbox" data-pref="keepFinish" ${prefs.keepFinish ? "checked" : ""} /> Les finitions spéciales (holo, dorée…)</label>
            <label class="recycle-check"><input type="checkbox" data-pref="keepQuality" ${prefs.keepQuality ? "checked" : ""} /> Les cartes en bon ou parfait état</label>
            <label class="recycle-check"><input type="checkbox" data-pref="keepWishlist" ${prefs.keepWishlist ? "checked" : ""} /> Les cartes de ma wishlist</label>
            <p class="recycle-note">Jamais touchés : exemplaires assurés, cartes ★, numéros #1.</p>
          </fieldset>
          <div class="recycle-preview" id="recycle-preview" aria-live="polite"></div>
        </div>
        <footer class="contract-modal-foot">
          <span class="contract-count" id="recycle-count"></span>
          <button type="button" class="btn-ghost" data-close id="recycle-cancel">Fermer</button>
          <button type="button" class="btn-danger" id="recycle-go">Recycler</button>
        </footer>
      </div>`;
    document.body.appendChild(overlay);
    if (typeof syncScrollLock === "function") syncScrollLock();
    const close = () => { if (running) running.stop = true; overlay.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); if (running && running.done) Coll.refresh(); };

    const draw = () => {
      const list = plan(prefs);
      const total = list.reduce((s, x) => s + x.dust, 0);
      const byRarity = new Map();
      list.forEach((x) => { const k = x.card.rarity.name; byRarity.set(k, (byRarity.get(k) || 0) + 1); });
      $("recycle-preview").innerHTML = list.length
        ? `<p><strong>${list.length}</strong> exemplaire${list.length > 1 ? "s" : ""} · ${[...byRarity].map(([k, n]) => `${n} ${esc(k)}`).join(", ")}</p>
           <ul class="recycle-list">${list.slice(0, 40).map((x) => `<li><span>${esc(x.card.name)}</span><small>${Coll.serial ? Coll.serial(x.copy.serialNumber) : ""} ${x.finish !== "normal" ? Coll.FINISH_LABELS[x.finish] || x.finish : ""} ${Coll.QUALITY_LABELS[x.quality] || ""}</small><b>+${x.dust}</b></li>`).join("")}${list.length > 40 ? `<li class="recycle-more">… et ${list.length - 40} autre${list.length - 40 > 1 ? "s" : ""}</li>` : ""}</ul>`
        : `<p class="recycle-empty">Rien à recycler avec ces règles.</p>`;
      $("recycle-count").innerHTML = list.length ? `+<strong>${total.toLocaleString("fr-FR")}</strong> poussières estimées` : "";
      $("recycle-go").disabled = !list.length;
      $("recycle-go").textContent = list.length ? `Recycler ${list.length} exemplaire${list.length > 1 ? "s" : ""}` : "Recycler";
      return list;
    };
    draw();

    overlay.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.rarity) prefs.rarities = [...overlay.querySelectorAll("[data-rarity]:checked")].map((x) => x.dataset.rarity);
      else if (t.name === "recycle-keep") prefs.keep = Number(t.value);
      else if (t.dataset.pref) prefs[t.dataset.pref] = t.checked;
      savePrefs(prefs);
      if (!running) draw();
    });

    overlay.addEventListener("click", async (e) => {
      if (e.target === overlay || e.target.closest("[data-close]")) { close(); return; }
      if (!e.target.closest("#recycle-go")) return;
      if (running && !running.done) { running.stop = true; return; }
      const list = plan(prefs);
      if (!list.length) return;
      const total = list.reduce((s, x) => s + x.dust, 0);
      const go = $("recycle-go");
      go.disabled = true;
      if (!(await Confirm.show(`Recycler <strong>${list.length} exemplaires</strong> pour environ <strong>+${total.toLocaleString("fr-FR")} poussières</strong> ? C'est irréversible.`, { title: "Recycler ces doublons ?", confirmText: "Recycler", dangerous: true }))) { go.disabled = false; return; }
      running = { stop: false, done: false };
      overlay.querySelectorAll("input").forEach((i) => { i.disabled = true; });
      go.disabled = false;
      go.textContent = "Arrêter";
      let ok = 0, dust = 0, failed = 0;
      for (const [i, x] of list.entries()) {
        if (running.stop) break;
        $("recycle-count").innerHTML = `${i + 1} / ${list.length} · +${dust.toLocaleString("fr-FR")} poussières`;
        try {
          const res = await API.disenchantCard(Session.userId, x.card.cardId, x.finish, x.quality, x.copy.pullId);
          ok++; dust += res.dustGained || 0;
        } catch (err) {
          failed++;
          if (err.code === "rate_limited" || err.status === 429) await new Promise((r) => setTimeout(r, 5000));
        }
        if (i < list.length - 1) await new Promise((r) => setTimeout(r, PACE_MS));
      }
      running.done = true;
      Toast.success(`&#9851;&#65039; ${ok} exemplaire${ok > 1 ? "s" : ""} recyclé${ok > 1 ? "s" : ""} : +${dust.toLocaleString("fr-FR")} poussières${failed ? ` (${failed} ignoré${failed > 1 ? "s" : ""})` : ""}.`);
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      close();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = $("smart-recycle-btn");
    if (btn) btn.addEventListener("click", () => { if (Coll.state.ownedMap.size) open(); else Toast.info("Ta collection charge encore…"); });
  });
})();
