// Les pierres de la salle interdite (2026-11-06, api/src/native/stones.js),
// sous la machine une fois la porte ouverte :
//  - Coeur de la salle : on le nourrit de mineraux, 6 paliers d'avantages ;
//  - Atelier (charge a l'ouverture) : forge interdite (un exemplaire sans
//    edition + des mineraux d'un palier = chance de le passer en Interdite,
//    une fissure par echec) et sertissage (une pierre sur une carte Interdite).
// 2026-11-16 : un seul espace « Les pierres » (ancre #pierres, #coeur, #forge,
// #sertissage) avec 3 onglets (Coeur, Forge, Sertissage), une introduction qui
// explique a quoi servent les mineraux, et les liens vers ce qui s'en sert
// ailleurs (Transmutation dans l'atelier de la collection, Ecrin du coffre-fort).
// La machine (js/forbidden.js) previent par « forbidden:machine » quand elle
// s'affiche et par « stones:refresh » quand le sac de mineraux a change.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const fmt = fmtNum;
  const img = (p, cls = "") => `<img class="${cls}" src="assets/${encodeURI(p)}" alt="" loading="lazy" decoding="async" />`;
  const pct = (x) => `${Math.round(x * 100)} %`;
  const ERR = { not_enough_minerals: "Pas assez de minéraux.", not_forgeable: "Cet exemplaire ne peut plus passer à la forge.", not_forbidden_copy: "Seule une carte Interdite se sertit.", in_vault: "Cette carte est rangée au coffre-fort : retire-la de l'écrin pour changer sa pierre.", same_gem: "Cette pierre y est déjà sertie.", locked: "La porte est fermée." };
  const errText = (e) => ERR[e.code] || friendlyError(e);
  const FINISH = { normal: "", holo: "Holo", gold: "Or", ghost: "Fantôme", diamond: "Diamant", rainbow: "Arc-en-ciel", emerald: "Émeraude" };
  const HASH_TAB = { coeur: "heart", forge: "forge", sertissage: "gem", pierres: "heart" };
  let heart = null, atelier = null, tab = HASH_TAB[location.hash.slice(1)] || "heart", busy = false, shown = false;
  const sel = { forge: null, gem: null, tier: null, mineral: null, q: "" };

  function shell() {
    const z = $("fs-zone");
    z.hidden = false;
    z.id = "fs-zone";
    z.innerHTML = `
      <span id="pierres" class="anchor"></span>
      <header class="fs-head">
        <h2>&#128142; Les pierres</h2>
        <p class="fs-dim">Les <strong>minéraux</strong> trouvés à la fouille, en expédition ou dans les géodes prennent ici tout leur pouvoir. Trois façons de s'en servir dans la salle, et deux ailleurs :</p>
        <ul class="fs-uses">
          <li><b>&#10084;&#65039; Le Cœur</b> : nourris-le de pierres, il monte de palier et renforce la salle (machine, forge…).</li>
          <li><b>&#128293; La forge</b> : une carte sans édition + des pierres d'un palier = une chance de la passer en édition Interdite.</li>
          <li><b>&#128142; Le sertissage</b> : une pierre sur une carte Interdite, qui brille dans ta collection et va dans l'<a href="coffre.html">écrin du coffre-fort</a> (points de prestige, récompenses par palier).</li>
          <li><b>&#9879;&#65039; La transmutation</b> : de l'Or ou des Diamants changent la finition d'une carte, dans l'<a href="collection.html#finitions">atelier de la collection</a>.</li>
        </ul>
      </header>
      <nav class="fs-tabs fs-main-tabs" role="tablist" aria-label="Les pierres">
        <button type="button" role="tab" data-tab="heart">&#10084;&#65039; Le Cœur</button>
        <button type="button" role="tab" data-tab="forge">&#128293; Forge interdite</button>
        <button type="button" role="tab" data-tab="gem">&#128142; Sertissage</button>
      </nav>
      <section class="fs-panel fs-heart" id="fs-heart"></section>
      <section class="fs-panel fs-atelier" id="fs-atelier"><div id="fs-tab"></div></section>`;
    syncTabs();
    if (location.hash && HASH_TAB[location.hash.slice(1)]) setTimeout(() => $("pierres")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
    z.addEventListener("click", onClick);
    z.addEventListener("input", (e) => { if (e.target.id === "fs-q") { sel.q = e.target.value; renderList(); } });
  }

  // ------------------------------------------------------------ coeur de la salle
  function renderHeart() {
    const h = heart;
    const lvPct = h.next ? Math.round(((h.points - h.prev) / Math.max(1, h.next - h.prev)) * 100) : 100;
    $("fs-heart").innerHTML = `
      <div class="fs-heart-top">
        <div class="fs-core lv-${h.level}" aria-hidden="true"><span></span></div>
        <div class="fs-heart-txt">
          <h3>Le Cœur de la salle</h3>
          <p class="fs-dim">Sous les machines, quelque chose bat encore. Il se nourrit de pierres.</p>
          <div class="fs-bar"><div style="width:${lvPct}%"></div></div>
          <small class="fs-dim">${fmt(h.points)} point${h.points > 1 ? "s" : ""}${h.next ? ` · palier ${h.level + 1} à ${fmt(h.next)}` : " · le Cœur bat à pleine force"}</small>
        </div>
      </div>
      <ol class="fs-steps">${h.steps.map((s, i) => `<li class="${s.done ? "done" : ""}"><b>${["I", "II", "III", "IV", "V", "VI"][i] || i + 1}</b><span>${esc(s.label)}</span><small>${fmt(s.at)}</small></li>`).join("")}</ol>
      <h4>Nourrir le Cœur <small class="fs-dim">(${h.pointsPerTier.join(" / ")} points par minéral, du commun au légendaire)</small></h4>
      ${h.minerals.length ? `<div class="fs-feed">${h.minerals.map((m) => `
        <div class="fs-feed-row tier-${m.tier}" title="${esc(m.name)} : ${m.points} point${m.points > 1 ? "s" : ""}">
          ${img(m.img)}<span><strong>${esc(m.name)}</strong> <small>×${m.own}</small></span>
          <button type="button" class="btn-ghost" data-feed="${m.key}" data-n="1">1</button>
          ${m.own > 1 ? `<button type="button" class="btn-ghost" data-feed="${m.key}" data-n="all">Tout · +${fmt(m.own * m.points)}</button>` : ""}
        </div>`).join("")}</div>` : `<p class="fs-dim">Ton sac est vide : les minéraux se trouvent à la fouille, en expédition, en promenade… et dans les géodes.</p>`}`;
  }
  async function loadHeart() {
    try { heart = (await API.post("forbidden", { userId: Session.userId, action: "heart" })).heart; renderHeart(); } catch (e) { /* plus tard */ }
  }
  async function feed(key, n) {
    if (busy) return; busy = true;
    try {
      const res = await API.post("forbidden", { userId: Session.userId, action: "feed", key, count: n });
      const up = res.heart.level > heart.level;
      heart = res.heart;
      renderHeart();
      const core = document.querySelector(".fs-core");
      if (core) { core.classList.remove("gulp", "surge"); void core.offsetWidth; core.classList.add(up ? "surge" : "gulp"); }
      if (typeof Sfx !== "undefined" && Sfx._tone) { Sfx._tone(70, 0, 0.16, "sine", 0.1); Sfx._tone(60, 0.2, 0.14, "sine", 0.08); }
      if (typeof Haptics !== "undefined") Haptics.buzz(up ? [40, 80, 160] : 25);
      Toast.success(`&#10084;&#65039;&#8205;&#128293; ${res.fed.count} ${esc(res.fed.name)} : +${fmt(res.fed.points)} points`);
      (res.notices || []).forEach((x, i) => setTimeout(() => Toast.success(`${x.icon} ${esc(x.text)}`), 500 + i * 700));
      if (up) {
        if (typeof confetti === "function") confetti({ particleCount: 140, spread: 100, origin: { y: 0.5 }, colors: ["#f97316", "#ef4444", "#fde68a"] });
        document.dispatchEvent(new CustomEvent("forbidden:refresh"));
      }
      if (atelier) { atelier = null; if (tab !== "heart") loadAtelier(); }
    } catch (e) { Toast.error(errText(e)); } finally { busy = false; }
  }

  // ------------------------------------------------------------ atelier
  async function loadAtelier() {
    $("fs-tab").innerHTML = `<p class="fs-dim">La forge s'allume…</p>`;
    try { atelier = await API.post("forbidden", { userId: Session.userId, action: "atelier" }); renderTab(); } catch (e) { $("fs-tab").innerHTML = `<p class="fs-dim">${esc(errText(e))}</p>`; }
  }
  const forgeChance = (card) => Math.min(0.95, sel.tier.chance + (card ? card.cracks * atelier.forge.crackBonus : 0));
  // Onglet affiche : le Coeur, ou l'atelier (forge / sertissage, charge a la demande).
  function syncTabs() {
    document.querySelectorAll(".fs-main-tabs [data-tab]").forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
    $("fs-heart").hidden = tab !== "heart";
    $("fs-atelier").hidden = tab === "heart";
    if (tab !== "heart") { if (atelier) renderTab(); else loadAtelier(); }
  }
  function renderTab() {
    if (tab === "heart") return;
    document.querySelectorAll(".fs-main-tabs [data-tab]").forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
    const box = $("fs-tab");
    if (tab === "forge") {
      const f = atelier.forge;
      if (!sel.tier || !f.tiers.some((t) => t.tier === sel.tier.tier)) sel.tier = f.tiers.find((t) => t.owned >= 3) || f.tiers[0]; // le moins precieux d'abord
      sel.tier = f.tiers.find((t) => t.tier === sel.tier.tier);
      box.innerHTML = `
        <p class="fs-dim">Pose une carte sans édition sur l'enclume et jette des pierres d'un même palier dans le feu. Si la forge prend, la carte ressort en édition <strong>&#9939;&#65039; Interdite</strong> (elle garde sa valeur de décraft). Sinon, les pierres brûlent et la carte se fissure : chaque fissure ajoute ${pct(f.crackBonus)} de chances à la suivante.${f.heartBonus ? ` Le Cœur ajoute ${pct(f.heartBonus)}.` : ""}</p>
        <div class="fs-tiers" role="radiogroup" aria-label="Palier des pierres">${f.tiers.map((t) => `<button type="button" role="radio" class="fs-tier tier-${t.tier} ${t.tier === sel.tier.tier ? "on" : ""}" data-tier="${t.tier}" aria-checked="${t.tier === sel.tier.tier}"><strong>${esc(t.name)}</strong><small>${fmt(t.owned)} · ${pct(t.chance)}</small></button>`).join("")}</div>
        <input type="search" id="fs-q" class="fs-q" placeholder="Chercher une carte…" value="${esc(sel.q)}" />
        <div class="fs-cards" id="fs-list"></div>
        <div class="fs-action" id="fs-action"></div>`;
    } else {
      const g = atelier.gems;
      box.innerHTML = `
        <p class="fs-dim">Sertis une pierre sur une carte Interdite : ${g.cost} minéraux du même type. Elle brille dans ta collection et peut rejoindre l'<a href="coffre.html">écrin du coffre-fort</a> : une place par minéral, des points de prestige selon le palier de la pierre et une récompense par palier complet. Une nouvelle pierre remplace l'ancienne ; une fusion la perd ; une carte rangée dans l'écrin garde la sienne.</p>
        <input type="search" id="fs-q" class="fs-q" placeholder="Chercher une carte Interdite…" value="${esc(sel.q)}" />
        <div class="fs-cards" id="fs-list"></div>
        <div class="fs-action" id="fs-action"></div>`;
    }
    renderList();
  }
  function cardTile(c, picked) {
    const fin = FINISH[c.finish] || "";
    const gem = c.gem && atelier.gems.minerals.find((m) => m.key === c.gem);
    return `<button type="button" class="fs-card ${picked ? "on" : ""} ${c.cracks ? "cracked" : ""}" data-pull="${c.pullId}" data-card-id="${c.cardId}" style="--rc:${esc(c.rarity.colorHex)}" title="${esc(c.name)}${fin ? " · " + fin : ""}">
      ${c.imageId ? `<img src="${API.imageUrl(c.imageId)}" alt="" loading="lazy" decoding="async" />` : `<span class="fs-ph">?</span>`}
      ${c.cracks ? `<span class="fs-crack" aria-hidden="true"></span><span class="fs-tag">fissurée ×${c.cracks}</span>` : ""}
      ${gem ? `<span class="fs-gem">${img(gem.img)}</span>` : ""}
      <small>${esc(c.name)}</small><em>${esc(c.rarity.name)}${fin ? " · " + fin : ""}${c.count > 1 ? ` · ×${c.count}` : ""}</em>
    </button>`;
  }
  function renderList() {
    const list = $("fs-list");
    if (!list || !atelier) return;
    const cards = (tab === "forge" ? atelier.forge.cards : atelier.gems.cards);
    const q = sel.q.trim().toLowerCase();
    const shownCards = (q ? cards.filter((c) => c.name.toLowerCase().includes(q)) : cards).slice(0, 60);
    const picked = sel[tab];
    list.innerHTML = shownCards.length ? shownCards.map((c) => cardTile(c, picked && picked.pullId === c.pullId)).join("") + (cards.length > shownCards.length && !q ? `<p class="fs-dim fs-more">${cards.length - shownCards.length} autres : cherche par nom.</p>` : "")
      : `<p class="fs-dim">${tab === "forge" ? "Aucune carte sans édition." : "Aucune carte Interdite : la machine en donne, la forge aussi."}</p>`;
    renderAction();
  }
  function renderAction() {
    const box = $("fs-action");
    if (!box) return;
    const c = sel[tab];
    if (!c) { box.innerHTML = `<p class="fs-dim">Choisis une carte.</p>`; return; }
    if (tab === "forge") {
      const enough = sel.tier.owned >= c.cost;
      box.innerHTML = `<div class="fs-act-row"><strong>${esc(c.name)}</strong><span>${c.cost} minéraux ${esc(sel.tier.name.toLowerCase())}s · chance ${pct(forgeChance(c))}</span>
        <button type="button" class="btn fs-go" id="fs-forge" ${enough ? "" : "disabled"}>&#128293; Forger</button></div>${enough ? "" : `<small class="fs-dim">Il te manque ${c.cost - sel.tier.owned} minéraux de ce palier.</small>`}`;
    } else {
      const g = atelier.gems;
      const usable = g.minerals.filter((m) => m.own >= g.cost);
      box.innerHTML = `<div class="fs-act-row"><strong>${esc(c.name)}</strong><span>${c.gem ? "Pierre actuelle : " + esc((g.minerals.find((m) => m.key === c.gem) || {}).name || c.gem) : "Aucune pierre"}</span></div>
        ${usable.length ? `<div class="fs-gems">${usable.map((m) => `<button type="button" class="fs-gem-pick tier-${m.tier} ${sel.mineral === m.key ? "on" : ""} ${c.gem === m.key ? "same" : ""}" data-gem="${m.key}" title="${esc(m.name)} (×${m.own})" ${c.gem === m.key ? "disabled" : ""}>${img(m.img)}<small>${esc(m.name)}</small></button>`).join("")}</div>
        <button type="button" class="btn fs-go" id="fs-set" ${sel.mineral && sel.mineral !== c.gem ? "" : "disabled"}>&#128142; Sertir · ${g.cost} pierres</button>` : `<small class="fs-dim">Il faut ${g.cost} minéraux d'un même type.</small>`}`;
    }
  }

  async function doForge() {
    const c = sel.forge;
    if (busy || !c) return; busy = true;
    const tile = document.querySelector(`.fs-card[data-pull="${c.pullId}"]`);
    tile?.classList.add("heating");
    if (typeof Sfx !== "undefined" && Sfx._tone) for (let i = 0; i < 5; i++) Sfx._tone(110 + i * 40, i * 0.18, 0.16, "sawtooth", 0.04);
    try {
      const [res] = await Promise.all([API.post("forbidden", { userId: Session.userId, action: "forge", pullId: c.pullId, tier: sel.tier.tier }), new Promise((r) => setTimeout(r, 1100))]);
      atelier = res;
      const r = res.result;
      tile?.classList.remove("heating");
      tile?.classList.add(r.success ? "forged" : "cracking");
      await new Promise((ok) => setTimeout(ok, 700));
      if (r.success) {
        sel.forge = null;
        if (typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal("legendaire");
        if (typeof confetti === "function") confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ["#dc2626", "#450a0a", "#fbbf24"] });
        Toast.success(`&#9939;&#65039; ${esc(r.cardName)} sort des flammes en édition Interdite !`);
      } else {
        sel.forge = res.forge.cards.find((x) => x.pullId === r.pullId) || null;
        if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(90, 0, 0.3, "square", 0.06);
        if (typeof Haptics !== "undefined") Haptics.buzz([30, 30, 30]);
        Toast.info(`La forge n'a pas pris : ${esc(r.cardName)} se fissure (×${r.cracks}). Les pierres ont brûlé.`);
      }
      renderTab();
      loadHeart();
    } catch (e) { tile?.classList.remove("heating"); Toast.error(errText(e)); if (e.data && e.data.forge) { atelier = e.data; renderTab(); } } finally { busy = false; }
  }
  async function doGem() {
    const c = sel.gem;
    if (busy || !c || !sel.mineral) return; busy = true;
    try {
      const res = await API.post("forbidden", { userId: Session.userId, action: "gem", pullId: c.pullId, key: sel.mineral });
      atelier = res;
      sel.gem = res.gems.cards.find((x) => x.pullId === c.pullId) || null;
      sel.mineral = null;
      renderTab();
      document.querySelector(`.fs-card[data-pull="${c.pullId}"]`)?.classList.add("gemmed");
      if (typeof Sfx !== "undefined" && Sfx._tone) { Sfx._tone(1200, 0, 0.08, "triangle", 0.04); Sfx._tone(1600, 0.09, 0.12, "triangle", 0.03); }
      Toast.success(`&#128142; ${esc(res.set.name)} sertie sur ${esc(c.name)}${res.set.replaced ? " (l'ancienne pierre est perdue)" : ""}.`);
      loadHeart();
    } catch (e) { Toast.error(errText(e)); if (e.data && e.data.gems) { atelier = e.data; renderTab(); } } finally { busy = false; }
  }

  function onClick(e) {
    const t = e.target;
    const fd = t.closest("[data-feed]");
    if (fd) { feed(fd.dataset.feed, fd.dataset.n === "all" ? "all" : 1); return; }
    const tb = t.closest("[data-tab]");
    if (tb) {
      tab = tb.dataset.tab; sel.q = "";
      const h = { heart: "coeur", forge: "forge", gem: "sertissage" }[tab];
      if (h) history.replaceState(null, "", "#" + h);
      syncTabs(); return;
    }
    const tr = t.closest("[data-tier]");
    if (tr) { sel.tier = atelier.forge.tiers.find((x) => x.tier === Number(tr.dataset.tier)); renderTab(); return; }
    const cd = t.closest(".fs-card[data-pull]");
    if (cd) {
      const list = tab === "forge" ? atelier.forge.cards : atelier.gems.cards;
      const c = list.find((x) => x.pullId === Number(cd.dataset.pull));
      sel[tab] = sel[tab] && sel[tab].pullId === c.pullId ? null : c;
      sel.mineral = null;
      renderList();
      return;
    }
    const gp = t.closest("[data-gem]");
    if (gp) { sel.mineral = gp.dataset.gem; renderAction(); return; }
    if (t.closest("#fs-forge")) doForge();
    else if (t.closest("#fs-set")) doGem();
  }

  document.addEventListener("forbidden:machine", () => {
    if (!shown) { shown = true; shell(); }
    loadHeart();
  });
  // Le sac a change (incrustation, geode) : le Coeur se met a jour, l'atelier sera recharge.
  document.addEventListener("stones:refresh", () => {
    if (!shown) return;
    loadHeart();
    atelier = null;
    if (tab !== "heart") loadAtelier();
  });
})();
