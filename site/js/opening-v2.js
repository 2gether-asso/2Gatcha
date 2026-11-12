// Ouverture V2 (2026-11-13) : la revelation d'un lot de boosters devient une
// scene, booster par booster.
// - Chaque booster se dechire a son tour (le 1er dans startOpening, les
//   suivants ici), ses cartes jaillissent du paquet et se posent face cachee.
// - On retourne les cartes dans l'ordre qu'on veut : note qui monte a chaque
//   carte (combo), fond teinte a la couleur de la meilleure carte du booster,
//   jauge de pity qui avance en direct.
// - « Projecteur » : une carte qui compte (rare+, nouvelle, finition, #001)
//   vient au centre en grand, titre de rarete qui claque, tampons ; legendaire
//   et mieux gardent la cinematique (opening-fx.js).
// - La meilleure carte (epique+) se fait attendre : ralenti + battement de coeur.
// - Le paquet « resiste » quand il contient une epique ou mieux (indice neutre,
//   meme regle que le fremissement d'avant : jamais la couleur de la rarete).
// - Bilan final : meilleure carte (partage), compteurs, repartition, progression
//   des extensions, toutes les cartes avec tampon NOUVELLE.
// Les coffres gardent la pile classique (opening.js). Utilise les globales
// d'opening.js (wait, requestSkip, celebrateRarity, celebrateFirstOfRarity,
// zoomRevealedCard, onAllRevealed, catalogCache, ownedCountMap, pityByExt...).

const OpeningV2 = (function () {
  const RANK = { commune: 0, rare: 1, epique: 2, legendaire: 3, mythique: 4, unique: 5 };
  // Gamme pentatonique : chaque carte retournee du booster monte d'une note.
  const NOTES = [392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
  const FINISH = { holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel", emerald: "Émeraude" };
  const rank = (c) => RANK[(c && c.rarity && c.rarity.key) || "commune"] ?? 0;
  const colorOf = (c) => (c && c.rarity && c.rarity.colorHex) || "#9aa0b4";
  const score = (c) => rank(c) * 100 + (c.finish && c.finish !== "normal" ? 10 : 0) + (c.serialNumber === 1 ? 5 : 0) + (c.isFirstEver ? 4 : 0) + (c.isNewToPlayer ? 1 : 0);
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const plural = (n, s, p) => (n > 1 ? p || s + "s" : s);

  let st = null;

  function stageEl() { return document.querySelector("#pack-modal-overlay .pack-modal-stage"); }

  // ------------------------------------------------------------ squelette
  function mount() {
    const stage = stageEl();
    let root = $("ov2");
    if (!root) {
      root = document.createElement("div");
      root.id = "ov2";
      root.className = "ov2";
      stage.querySelector(".booster-stage").after(root);
    }
    root.innerHTML = `
      <div class="ov2-top">
        <div class="ov2-packs" id="ov2-packs"></div>
        <div class="ov2-pity" id="ov2-pity" hidden></div>
      </div>
      <div class="ov2-btags" id="ov2-btags"></div>
      <div class="reveal-grid ov2-row" id="ov2-row"></div>
      <div class="ov2-actions" id="ov2-actions"></div>`;
    let tint = document.querySelector("#pack-modal-overlay .ov2-tint");
    if (!tint) {
      tint = document.createElement("div");
      tint.className = "ov2-tint";
      const overlay = $("pack-modal-overlay");
      overlay.insertBefore(tint, stage);
    }
    tint.style.setProperty("--ov2-tint-a", "0");
    stage.classList.add("ov2-on");
    stage.classList.remove("ov2-bilan-on");
    return root;
  }

  function reset() {
    if (st) st.dead = true;
    st = null;
    const stage = stageEl();
    if (stage) stage.classList.remove("ov2-on", "ov2-cards", "ov2-bilan-on");
    const root = $("ov2");
    if (root) root.remove();
    const tint = document.querySelector("#pack-modal-overlay .ov2-tint");
    if (tint) tint.style.setProperty("--ov2-tint-a", "0");
    document.querySelectorAll(".ov2-spot").forEach((s) => s.remove());
  }

  // ------------------------------------------------------------ tension
  // Le paquet resiste : trois secousses, des fissures de lumiere (blanches,
  // jamais a la couleur de la rarete), un battement de coeur a chacune.
  async function resist(pack) {
    if (reduced()) return;
    pack.classList.add("ov2-resist");
    for (let i = 0; i < 3; i++) {
      pack.classList.remove("ov2-jolt"); void pack.offsetWidth; pack.classList.add("ov2-jolt");
      pack.style.setProperty("--ov2-crack", String((i + 1) / 3));
      if (Sfx._thump) Sfx._thump(0, 170 - i * 10, 50, 0.45 + i * 0.12);
      OpeningFx.vibrate(25 + i * 15);
      await wait(380);
    }
    pack.classList.remove("ov2-resist", "ov2-jolt");
    pack.style.removeProperty("--ov2-crack");
  }

  function combo(i) {
    if (!Sfx._tone) return;
    const f = NOTES[Math.min(i, NOTES.length - 1)];
    Sfx._tone(f, 0, 0.22, "triangle", 0.06);
    if (i >= 4) Sfx._tone(f * 1.5, 0.05, 0.18, "sine", 0.03);
  }

  function setTint(color, strength) {
    const tint = document.querySelector("#pack-modal-overlay .ov2-tint");
    if (!tint) return;
    tint.style.setProperty("--ov2-tint", color);
    tint.style.setProperty("--ov2-tint-a", String(strength));
  }

  // ------------------------------------------------------------ pity
  function renderPity(animateFrom) {
    const el = $("ov2-pity");
    if (!el || !st) return;
    const b = st.boosters[st.bi];
    if (st.sim || !pityThreshold || !b) { el.hidden = true; return; }
    el.hidden = false;
    const v = Math.max(0, Math.min(pityThreshold, st.pity.get(b.ext.id) || 0));
    const left = Math.max(0, pityThreshold - v);
    el.innerHTML = `<span class="ov2-pity-ico">${typeof rarityIcon === "function" ? rarityIcon("legendaire") : "&#11088;"}</span>
      <span class="ov2-pity-track"><span class="ov2-pity-fill" style="width:${Math.round(((animateFrom ?? v) / pityThreshold) * 100)}%"></span></span>
      <span class="ov2-pity-txt">${left ? `Légendaire garantie dans <b>${left}</b>` : "<b>Légendaire garantie</b> au prochain tirage"}</span>`;
    if (animateFrom != null) requestAnimationFrame(() => { const f = el.querySelector(".ov2-pity-fill"); if (f) f.style.width = Math.round((v / pityThreshold) * 100) + "%"; });
    el.classList.toggle("hot", v / pityThreshold >= 0.8);
  }
  function bumpPity(card) {
    if (!st || st.sim || !pityThreshold) return;
    const b = st.boosters[st.bi];
    const id = b.ext.id;
    const before = st.pity.get(id) || 0;
    if (rank(card) >= RANK.legendaire) {
      st.pity.set(id, 0);
      renderPity(before);
      const el = $("ov2-pity");
      if (el) { el.classList.remove("reset"); void el.offsetWidth; el.classList.add("reset"); }
    } else {
      st.pity.set(id, before + 1);
      renderPity(before);
    }
  }

  // ------------------------------------------------------------ boosters
  function renderPackDots() {
    const el = $("ov2-packs");
    if (!el || !st) return;
    if (st.boosters.length < 2) { el.innerHTML = ""; return; }
    el.innerHTML = `<span class="ov2-packs-label">Booster <b>${Math.min(st.bi + 1, st.boosters.length)}</b> / ${st.boosters.length}</span><span class="ov2-dots">${st.boosters.map((b, i) => {
      const best = b.done ? b.cards.reduce((m, c) => (rank(c) > rank(m) ? c : m), b.cards[0]) : null;
      return `<span class="ov2-dot ${b.done ? "done" : ""} ${i === st.bi && !st.inBilan ? "cur" : ""}" style="${best ? `--d:${colorOf(best)}` : ""}" title="${escHtml(b.ext.name || "Booster")}"></span>`;
    }).join("")}</span>`;
  }

  function boosterTags(b) {
    const r = b.res || {};
    const tags = [];
    if (b.planned && b.planned.mystery) tags.push(`<span class="ov2-btag mystery">&#10067; ${escHtml(b.ext.name || "Mystère")}</span>`);
    else if (st.boosters.length > 1 || st.multiExt) tags.push(`<span class="ov2-btag">${escHtml(b.ext.name || "")}</span>`);
    if (r.pack && r.pack.godPack) tags.push('<span class="ov2-btag god">&#127775; God pack</span>');
    if (r.pack && r.pack.shiny) tags.push('<span class="ov2-btag shiny">&#127752; Shiny</span>');
    if (r.pack && r.pack.bonusCard) tags.push('<span class="ov2-btag">&#127873; Carte bonus</span>');
    if (r.rarityPity) tags.push(`<span class="ov2-btag">&#127919; ${escHtml(r.rarityPity.name)} garantie</span>`);
    return tags.join("");
  }

  function packHtml(e) {
    const img = API.imageUrl(e.packImageId);
    if (e.mystery) return `<div class="booster-emoji mystery-q">?</div><div class="booster-title">Booster mystère</div><div class="booster-sub">Extension surprise</div>`;
    return img
      ? `<img src="${img}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:16px;position:absolute;inset:0;" />`
      : `<div class="booster-emoji">&#127183;</div><div class="booster-title">${escHtml(e.name || "Booster")}</div><div class="booster-sub">5 cartes</div>`;
  }

  // Boosters 2..n : le paquet revient, on le tape (ou le glisse) pour l'ouvrir.
  function packPhase(b) {
    return new Promise((resolve) => {
      const stage = stageEl();
      const pack = $("booster-pack");
      const hint = $("booster-hint");
      stage.classList.remove("ov2-cards");
      // Eventail « choisis ton booster » reste d'avant : il capterait le tap.
      stage.querySelectorAll(".pack-fan").forEach((f) => f.remove());
      $("ov2-row").innerHTML = "";
      $("ov2-btags").innerHTML = "";
      setActions([]);
      setTint("#000", 0);
      pack.className = "booster-pack";
      pack.classList.toggle("mystery-pack", !!b.planned.mystery);
      pack.innerHTML = packHtml(b.planned);
      pack.style.visibility = "visible";
      pack.style.setProperty("--pity-ratio", String(pityThreshold ? Math.min(1, (st.pity.get(b.ext.id) || 0) / pityThreshold) : 0));
      pack.classList.add("pack-arrive");
      setTimeout(() => pack.classList.remove("pack-arrive"), 400);
      hint.textContent = st.auto ? "Ouverture automatique…" : `Booster ${st.bi + 1} / ${st.boosters.length} : tape ou glisse pour l'ouvrir`;
      setActions(st.auto ? [["auto-off", "&#9208; Arrêter l'auto", "btn-ghost"]] : [["bilan", "&#9197; Passer au bilan", "btn-ghost"], ["auto", "&#9654;&#9654; Auto", "btn-ghost"]]);
      let started = false;
      const go = async () => {
        if (started || !st || st.dead) return;
        started = true;
        pack.onclick = () => requestSkip();
        const special = b.cards.some((c) => rank(c) >= RANK.epique);
        Sfx.click();
        pack.classList.add("charging");
        if (special) pack.classList.add("charging-special");
        await wait(st.auto ? 300 : 450);
        if (special) await resist(pack);
        pack.classList.remove("charging", "charging-special");
        if (!st || st.dead) return;
        pack.classList.add("tearing");
        Sfx.tear();
        OpeningFx.vibrate(30);
        spawnFoilShards(pack);
        await wait(520);
        pack.classList.remove("tearing");
        pack.style.visibility = "hidden";
        resolve();
      };
      st.packGo = go;
      pack.onclick = () => { pack._swiped = false; go(); };
      if (st.auto) setTimeout(go, 350);
    });
  }

  // ------------------------------------------------------------ cartes
  function dealBooster(b, fromRect) {
    const stage = stageEl();
    const row = $("ov2-row");
    stage.classList.add("ov2-cards");
    row.innerHTML = "";
    row.classList.toggle("many", b.cards.length > 6);
    $("ov2-btags").innerHTML = boosterTags(b);
    st.combo = 0;
    st.bestShown = 0;
    b.best = b.cards.reduce((m, c) => (score(c) > score(m) ? c : m), b.cards[0]);
    b.slots = b.cards.map((card, i) => {
      const el = buildCardEl(card, i, b.backImageId);
      // buildCardEl ne reagit que si data-active="true" : on garde la main.
      el.dataset.active = "false";
      const slot = document.createElement("div");
      slot.className = "ov2-slot";
      slot.style.setProperty("--i", String(i));
      slot.appendChild(el);
      slot.addEventListener("click", () => onSlot(b, i));
      row.appendChild(slot);
      return { card, el, slot, revealed: false };
    });
    // Envol depuis le paquet : chaque emplacement part du centre du paquet.
    if (fromRect && !reduced()) {
      const cx = fromRect.left + fromRect.width / 2;
      const cy = fromRect.top + fromRect.height / 2;
      b.slots.forEach((s) => {
        const r = s.slot.getBoundingClientRect();
        s.slot.style.setProperty("--fx", `${cx - (r.left + r.width / 2)}px`);
        s.slot.style.setProperty("--fy", `${cy - (r.top + r.height / 2)}px`);
        s.slot.classList.add("dealing");
      });
      b.slots.forEach((s, i) => setTimeout(() => { if (Sfx._tone) Sfx._tone(1200 + i * 60, 0, 0.04, "square", 0.015); }, 80 + i * 90));
    }
    const hint = $("booster-hint");
    hint.textContent = "Retourne les cartes dans l'ordre que tu veux";
    renderPackDots();
    renderPity();
    actionsDuring(b);
    if (st.auto) setTimeout(() => revealAll(b), 500 + b.cards.length * 90);
  }

  function actionsDuring(b) {
    const left = b.slots.filter((s) => !s.revealed).length;
    const acts = [];
    if (left > 1) acts.push(["all", "Tout révéler", "btn-secondary"]);
    if (st.boosters.length > 1) acts.push(st.auto ? ["auto-off", "&#9208; Arrêter l'auto", "btn-ghost"] : ["bilan", "&#9197; Passer au bilan", "btn-ghost"]);
    if (st.boosters.length > 2 && !st.auto) acts.push(["auto", "&#9654;&#9654; Auto", "btn-ghost"]);
    setActions(acts);
  }

  function setActions(list) {
    const el = $("ov2-actions");
    if (!el) return;
    el.innerHTML = list.map(([k, label, cls]) => `<button type="button" class="${cls}" data-ov2="${k}">${label}</button>`).join("");
  }

  function onSlot(b, i) {
    if (!st || st.busy || st.dead) return;
    const s = b.slots[i];
    if (s.revealed) { zoomRevealedCard(s.el); return; }
    reveal(b, s, false);
  }

  // Retourne une carte. quiet : « Tout reveler » (pas de projecteur).
  async function reveal(b, s, quiet) {
    if (s.revealed || s.pending) return;
    s.pending = true;
    const c = s.card;
    const r = rank(c);
    const isBest = s.card === b.best && r >= RANK.epique;
    if (isBest && !quiet) {
      st.busy = true;
      s.slot.classList.add("ov2-focus");
      await OpeningFx.suspense(s.el, c.rarity && c.rarity.key, colorOf(c));
      s.slot.classList.remove("ov2-focus");
      st.busy = false;
    }
    if (!st || st.dead) return;
    s.revealed = true;
    s.el.classList.add("revealed");
    s.slot.classList.add("is-revealed", "r" + r);
    s.slot.style.setProperty("--r", colorOf(c));
    if (c.isNewToPlayer) s.slot.classList.add("is-new");
    Sfx.flip();
    combo(st.combo++);
    bumpPity(c);
    if (r > st.bestShown) { st.bestShown = r; if (r >= 1) setTint(colorOf(c), 0.14 + r * 0.08); }
    if (!quiet) {
      setTimeout(() => Sfx.reveal(c.rarity && c.rarity.key), 240);
      if (c.finish && c.finish !== "normal") Sfx.finish(c.finish);
      if (r >= 1) OpeningFx.vibrate(r >= 3 ? [40, 50, 80] : r === 2 ? [30, 40, 30] : 20);
      requestAnimationFrame(() => {
        if (r >= 1) celebrateRarity(c.rarity && c.rarity.key, s.el, colorOf(c));
        if (c.firstOfRarity) celebrateFirstOfRarity(c, s.el, colorOf(c));
      });
      await showcase(b, s);
    } else if (c.firstOfRarity) celebrateFirstOfRarity(c, s.el, colorOf(c), true);
    s.pending = false;
    if (st && !st.dead) {
      actionsDuring(b);
      if (b.slots.every((x) => x.revealed)) boosterDone(b);
    }
  }

  // Projecteur / cinematique selon ce que vaut la carte.
  async function showcase(b, s) {
    const c = s.card;
    const r = rank(c);
    const god = !!(b.res && b.res.pack && b.res.pack.godPack && c === b.best);
    if (r >= RANK.legendaire || god) {
      const tier = OpeningFx.tierOf(c.rarity && c.rarity.key, god);
      if (typeof CinePref === "undefined" || CinePref.allow("opening", god ? "god" : (c.rarity && c.rarity.key) || "")) {
        st.busy = true;
        await sleep(650);
        await OpeningFx.cinematic(s.el, c, colorOf(c), god ? "GOD PACK !" : ((c.rarity && c.rarity.name) || "") + " !", tier);
        if (st) st.busy = false;
        return;
      }
    }
    const worth = r >= RANK.rare || c.isNewToPlayer || (c.finish && c.finish !== "normal") || c.serialNumber === 1 || c.isFirstEver || c.edition;
    if (!worth) return;
    st.busy = true;
    await sleep(r >= 1 ? 520 : 380);
    await spotlight(s, c);
    if (st) st.busy = false;
  }

  function spotlight(s, c) {
    return new Promise((resolve) => {
      if (!st || st.dead) { resolve(); return; }
      const front = s.el.querySelector(".card-front");
      if (!front) { resolve(); return; }
      const r = rank(c);
      const color = colorOf(c);
      const stamps = [];
      if (c.isFirstEver) stamps.push(["first", "1ère du serveur"]);
      else if (c.isNewToPlayer) stamps.push(["new", "Nouvelle !"]);
      if (c.finish && c.finish !== "normal") stamps.push(["finish", FINISH[c.finish] || c.finish]);
      if (c.serialNumber === 1) stamps.push(["serial", "#001"]);
      if (c.edition && typeof EDITIONS !== "undefined" && EDITIONS[c.edition]) stamps.push(["edition", `${EDITIONS[c.edition].icon || ""} ${EDITIONS[c.edition].label}`]);
      const title = r >= 1 ? ((c.rarity && c.rarity.name) || "") : c.isNewToPlayer ? "Nouvelle carte" : (c.rarity && c.rarity.name) || "";
      const ov = document.createElement("div");
      ov.className = `ov2-spot r${r}`;
      ov.style.setProperty("--c", color);
      ov.innerHTML = `
        <div class="ov2-spot-bg" aria-hidden="true"></div>
        ${r >= 2 ? '<div class="ov2-spot-rays" aria-hidden="true"></div>' : ""}
        <div class="ov2-spot-inner">
          <div class="ov2-spot-title">${escHtml(title)}</div>
          <div class="reveal-grid ov2-spot-grid"><div class="ov2-spot-cardwrap">
            <div class="card revealed ov2-spot-card" data-rarity="${s.el.dataset.rarity}" data-finish="${s.el.dataset.finish}" data-quality="${s.el.dataset.quality}"${s.el.dataset.edition ? ` data-edition="${s.el.dataset.edition}"` : ""}><div class="card-inner"><div class="${front.className}">${front.innerHTML}</div></div></div>
          </div></div>
          <div class="ov2-spot-name">${escHtml(c.name || "")}</div>
          <div class="ov2-stamps">${stamps.map(([k, t], i) => `<span class="ov2-stamp ${k}" style="--d:${0.45 + i * 0.22}s">${escHtml(t)}</span>`).join("")}</div>
          <div class="ov2-spot-skip">Tape pour continuer</div>
        </div>`;
      document.body.appendChild(ov);
      if (r >= 1 && typeof spawnRarityBurst === "function") setTimeout(() => { const cw = ov.querySelector(".ov2-spot-card"); if (cw) spawnRarityBurst(c.rarity.key, color, cw); }, 260);
      stamps.forEach((_, i) => setTimeout(() => { if (Sfx._thump) Sfx._thump(0, 140, 60, 0.35); }, 450 + i * 220));
      if (r >= 2) setTimeout(() => Sfx.fanfare && Sfx.fanfare(), 200);
      let done = false;
      const close = () => {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey, true);
        ov.classList.add("out");
        setTimeout(() => { ov.remove(); resolve(); }, 260);
      };
      const onKey = (e) => {
        if (!["Escape", "Enter", " "].includes(e.key)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      };
      ov.addEventListener("click", close);
      document.addEventListener("keydown", onKey, true);
      // Les petites cartes repartent seules ; une epique (ou une finition) attend le tap.
      const hold = r >= 2 || (c.finish && c.finish !== "normal") || c.serialNumber === 1 || c.isFirstEver;
      if (!hold || st.auto) setTimeout(close, st.auto ? 1500 : r >= 1 ? 1700 : 1150);
    });
  }

  async function revealAll(b) {
    if (!st || st.busy) return;
    const order = b.slots.filter((s) => !s.revealed).sort((a, b2) => score(a.card) - score(b2.card));
    const last = order[order.length - 1];
    const step = st.auto ? 90 : 130;
    for (const s of order) {
      if (!st || st.dead) return;
      const loud = s === last && rank(s.card) >= RANK.epique;
      if (loud) { await sleep(300); await reveal(b, s, false); }
      else { reveal(b, s, true); await sleep(step); }
    }
  }

  function boosterDone(b) {
    if (b.done) return;
    b.done = true;
    // Valeur exacte du serveur une fois le booster fini.
    if (!st.sim && b.res && b.res.pity && b.res.pity.pullsSinceTop != null) {
      const before = st.pity.get(b.ext.id) || 0;
      st.pity.set(b.ext.id, Number(b.res.pity.pullsSinceTop) || 0);
      renderPity(before);
    }
    renderPackDots();
    const fresh = b.cards.filter((c) => c.isNewToPlayer).length;
    const best = b.cards.reduce((m, c) => (rank(c) > rank(m) ? c : m), b.cards[0]);
    const hint = $("booster-hint");
    const more = st.bi < st.boosters.length - 1;
    hint.innerHTML = `${st.boosters.length > 1 ? `Booster ${st.bi + 1} terminé` : "Booster terminé"} : meilleure <b style="color:${colorOf(best)}">${escHtml((best.rarity && best.rarity.name) || "")}</b>${fresh ? ` · ${fresh} ${plural(fresh, "nouvelle")}` : ""}`;
    if (more) {
      setActions(st.auto
        ? [["auto-off", "&#9208; Arrêter l'auto", "btn-ghost"]]
        : [["next", `Booster suivant &#9654;`, "btn"], ["bilan", "&#9197; Passer au bilan", "btn-ghost"]]);
      if (st.auto) setTimeout(() => { if (st && !st.dead && st.auto && b === st.boosters[st.bi]) next(); }, 900);
    } else {
      setActions([["bilan", "Voir le bilan &#9654;", "btn"]]);
      if (st.auto) setTimeout(() => { if (st && !st.dead) bilan(); }, 900);
    }
  }

  async function next() {
    if (!st || st.busy || st.dead) return;
    if (st.bi >= st.boosters.length - 1) { bilan(); return; }
    st.bi++;
    const b = st.boosters[st.bi];
    renderPackDots();
    renderPity();
    await packPhase(b);
    if (!st || st.dead) return;
    dealBooster(b, $("booster-pack").getBoundingClientRect());
  }

  // Passer au bilan : tout le reste est retourne d'un coup ; la plus grosse
  // carte encore jamais vue (legendaire+) a quand meme sa cinematique.
  async function skipToBilan() {
    if (!st || st.busy || st.dead) return;
    st.auto = false;
    let unseen = null;
    st.boosters.forEach((b, i) => {
      const pending = i < st.bi ? [] : i === st.bi && b.slots ? b.slots.filter((s) => !s.revealed).map((s) => s.card) : b.cards;
      pending.forEach((c) => { if (!unseen || score(c) > score(unseen)) unseen = c; });
      if (i === st.bi && b.slots) b.slots.forEach((s) => { if (!s.revealed) { s.revealed = true; s.el.classList.add("revealed"); } });
      if (!st.sim && b.res && b.res.pity && b.res.pity.pullsSinceTop != null) st.pity.set(b.ext.id, Number(b.res.pity.pullsSinceTop) || 0);
      b.done = true;
    });
    if (unseen && rank(unseen) >= RANK.legendaire && (typeof CinePref === "undefined" || CinePref.allow("opening", unseen.rarity.key))) {
      const tmp = buildCardEl(unseen, 0, null);
      tmp.classList.add("revealed");
      const host = document.createElement("div");
      host.className = "reveal-grid ov2-ghost-host";
      host.appendChild(tmp);
      document.body.appendChild(host);
      st.busy = true;
      await OpeningFx.cinematic(tmp, unseen, colorOf(unseen), (unseen.rarity.name || "") + " !", OpeningFx.tierOf(unseen.rarity.key, false));
      host.remove();
      if (st) st.busy = false;
    }
    bilan();
  }

  // ------------------------------------------------------------ bilan
  function countUp(el, to, ms = 900) {
    if (!el) return;
    if (reduced() || to <= 0) { el.textContent = String(to); return; }
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function bilan() {
    if (!st || st.dead || st.inBilan) return;
    st.inBilan = true;
    st.auto = false;
    const stage = stageEl();
    const pack = $("booster-pack");
    pack.style.visibility = "hidden";
    stage.classList.add("ov2-cards", "ov2-bilan-on");
    stage.scrollTop = 0;
    renderPackDots();
    $("ov2-pity").hidden = true;
    $("ov2-btags").innerHTML = "";
    $("booster-hint").textContent = "";

    // Fin de session cote opening.js : annonce Discord, isBusy, bouton « Ouvrir un autre ».
    onAllRevealed();
    if (!st) return;

    const all = st.boosters.flatMap((b) => b.cards);
    const cards = all.filter((c) => !c.lootType);
    const best = cards.slice().sort((a, b) => score(b) - score(a))[0];
    const fresh = cards.filter((c) => c.isNewToPlayer).length;
    const special = cards.filter((c) => c.finish && c.finish !== "normal").length;
    const dust = st.boosters.reduce((n, b) => n + ((b.res && b.res.duplicateDust && b.res.duplicateDust.total) || 0), 0);
    const high = cards.filter((c) => rank(c) >= RANK.epique).length;

    // Repartition par rarete (barre empilee).
    const order = ["commune", "rare", "epique", "legendaire", "mythique", "unique"];
    const byR = new Map();
    cards.forEach((c) => { const k = (c.rarity && c.rarity.key) || "commune"; const e = byR.get(k) || { n: 0, name: c.rarity.name, color: colorOf(c) }; e.n++; byR.set(k, e); });
    const segs = order.filter((k) => byR.has(k)).map((k) => byR.get(k));

    // Progression des extensions touchees : avant -> apres.
    const catalogById = new Map(catalogCache.map((c) => [c.cardId, c]));
    const exts = new Map();
    cards.forEach((c) => {
      const ext = catalogById.get(c.cardId) && catalogById.get(c.cardId).extension;
      if (!ext) return;
      const e = exts.get(ext.id) || { name: ext.name, fresh: new Set() };
      if (c.isNewToPlayer) e.fresh.add(c.cardId);
      exts.set(ext.id, e);
    });
    const progress = [...exts.entries()].map(([id, e]) => {
      const list = catalogCache.filter((c) => c.extension && c.extension.id === id);
      const ownedNow = list.filter((c) => (ownedCountMap.get(c.cardId) || 0) > 0).length;
      const before = st.sim ? ownedNow : Math.max(0, ownedNow - e.fresh.size);
      const after = before + e.fresh.size;
      return { name: e.name, total: list.length || 1, before, after, added: e.fresh.size };
    }).sort((a, b) => b.added - a.added);

    const row = $("ov2-row");
    row.innerHTML = "";
    let bil = $("ov2-bilan");
    if (!bil) { bil = document.createElement("div"); bil.id = "ov2-bilan"; bil.className = "ov2-bilan"; row.after(bil); }
    const n = st.boosters.length;
    bil.innerHTML = `
      <h2 class="ov2-bilan-title">${st.sim ? "Simulation · " : ""}${n} ${plural(n, "booster")} · ${cards.length} ${plural(cards.length, "carte")}</h2>
      ${best ? `<div class="ov2-hero" style="--c:${colorOf(best)}">
        <div class="ov2-hero-card reveal-grid" id="ov2-hero-card"></div>
        <div class="ov2-hero-txt">
          <span class="ov2-hero-kicker">&#11088; Meilleure carte</span>
          <strong class="ov2-hero-name">${escHtml(best.name || "")}</strong>
          <span class="ov2-hero-meta">${escHtml((best.rarity && best.rarity.name) || "")}${best.finish && best.finish !== "normal" ? ` · ${escHtml(FINISH[best.finish] || best.finish)}` : ""}${best.serialNumber === 1 ? " · #001" : ""}${best.isNewToPlayer ? " · <b>nouvelle</b>" : ""}</span>
          ${!st.sim && typeof LazyJs !== "undefined" ? '<button type="button" class="btn-secondary ov2-share" data-ov2="share">&#128228; Partager</button>' : ""}
        </div>
      </div>` : ""}
      <div class="ov2-stats">
        <div class="ov2-stat ${fresh ? "hot" : ""}"><b data-to="${fresh}">0</b><span>${plural(fresh, "nouvelle carte", "nouvelles cartes")}</span></div>
        <div class="ov2-stat"><b data-to="${high}">0</b><span>épique${high > 1 ? "s" : ""} ou mieux</span></div>
        <div class="ov2-stat"><b data-to="${special}">0</b><span>${plural(special, "finition spéciale", "finitions spéciales")}</span></div>
        <div class="ov2-stat"><b data-to="${dust}">0</b><span>&#10024; poussières (doublons)</span></div>
      </div>
      <div class="ov2-dist" aria-label="Répartition par rareté">${segs.map((s, i) => `<span class="ov2-seg" style="--c:${s.color};--w:${s.n};--d:${0.1 + i * 0.08}s" title="${s.n} ${escHtml(s.name || "")}"></span>`).join("")}</div>
      <div class="ov2-dist-legend">${segs.map((s) => `<span style="--c:${s.color}"><i></i>${s.n} ${escHtml(s.name || "")}</span>`).join("")}</div>
      ${progress.length ? `<ul class="ov2-exts">${progress.map((p, i) => `<li><span class="ov2-ext-name">${escHtml(p.name)}</span><span class="ov2-ext-track"><span class="ov2-ext-before" style="width:${(p.before / p.total) * 100}%"></span><span class="ov2-ext-gain" style="left:${(p.before / p.total) * 100}%;--w:${((p.after - p.before) / p.total) * 100}%;--d:${0.4 + i * 0.12}s"></span></span><span class="ov2-ext-count">${p.after}/${p.total}${p.added ? ` <b>+${p.added}</b>` : ""}</span></li>`).join("")}</ul>` : ""}
      <div class="reveal-grid row-reveal ov2-grid ${cards.length > 30 ? "big-lot" : ""}" id="ov2-grid"></div>
      <div class="ov2-bilan-actions" id="ov2-bilan-actions"></div>`;

    // Toutes les cartes, meilleures d'abord ; tampon NOUVELLE en cascade.
    const els = st.boosters.flatMap((b) => (b.slots ? b.slots.map((s) => ({ c: s.card, el: s.el })) : b.cards.map((c) => { const el = buildCardEl(c, 0, b.backImageId); el.dataset.active = "false"; el.classList.add("revealed"); return { c, el }; })));
    els.sort((a, b) => score(b.c) - score(a.c));
    const grid = $("ov2-grid");
    els.forEach(({ c, el }, i) => {
      el.classList.add("revealed");
      el.classList.remove("hero-zoom", "legendary-hit", "suspense", "suspense-strong", "suspense-soft");
      el.style.transform = "";
      el.style.filter = "";
      if (c.isNewToPlayer) { el.classList.add("ov2-new"); el.style.setProperty("--d", `${Math.min(i, 30) * 0.05 + 0.6}s`); }
      el.onclick = () => zoomRevealedCard(el);
      grid.appendChild(el);
    });
    if (best) {
      const heroSrc = els.find((x) => x.c === best);
      const host = $("ov2-hero-card");
      if (heroSrc && host) {
        const front = heroSrc.el.querySelector(".card-front");
        host.innerHTML = `<div class="card revealed" data-rarity="${heroSrc.el.dataset.rarity}" data-finish="${heroSrc.el.dataset.finish}" data-quality="${heroSrc.el.dataset.quality}"${heroSrc.el.dataset.edition ? ` data-edition="${heroSrc.el.dataset.edition}"` : ""}><div class="card-inner"><div class="${front.className}">${front.innerHTML}</div></div></div>`;
        if (typeof attachCardShine === "function") attachCardShine(host.firstElementChild);
      }
      setTint(colorOf(best), 0.12 + rank(best) * 0.06);
      if (rank(best) >= RANK.epique && typeof spawnRarityBurst === "function") setTimeout(() => { const h = $("ov2-hero-card"); if (h) spawnRarityBurst(best.rarity.key, colorOf(best), h); }, 350);
    }
    bil.querySelectorAll(".ov2-stat b[data-to]").forEach((b, i) => setTimeout(() => countUp(b, Number(b.dataset.to) || 0), 200 + i * 120));
    if (Sfx.fanfare && (fresh || high)) setTimeout(() => Sfx.fanfare(), 150);
    else if (Sfx._tone) [523.25, 659.25, 783.99].forEach((f, i) => Sfx._tone(f, i * 0.08, 0.3, "triangle", 0.05));

    // Boutons : « Ouvrir un autre / Suivant » repris d'opening.js.
    const acts = $("ov2-bilan-actions");
    const again = $("open-another-btn");
    const againOn = again && again.style.display !== "none" && again.textContent.trim();
    acts.innerHTML = `${againOn ? `<button type="button" class="btn" data-ov2="again">${again.innerHTML}</button>` : ""}
      ${st.sim ? "" : '<a class="btn-secondary" href="collection.html">&#128218; Voir la collection</a>'}
      <button type="button" class="btn-ghost" data-ov2="close">Fermer</button>`;
  }

  // ------------------------------------------------------------ entree
  // o : { boosters: [{ planned, ext, cards, res }], sim, backImageId }
  function run(o) {
    reset();
    mount();
    // Pity de depart par extension (avant ce lot), puis valeurs finales pour
    // les cases du distributeur.
    const pity = new Map();
    o.boosters.forEach((b) => { if (!pity.has(b.ext.id)) pity.set(b.ext.id, pityByExt.get(b.ext.id) || 0); });
    if (!o.sim) {
      o.boosters.forEach((b) => { if (b.res && b.res.pity && b.res.pity.pullsSinceTop != null) pityByExt.set(b.ext.id, Number(b.res.pity.pullsSinceTop) || 0); });
      renderExtensionPicker();
    }
    o.boosters.forEach((b) => { b.backImageId = b.ext.cardBackImageId || o.backImageId || null; b.cards = (b.cards || []).filter(Boolean); });
    const boosters = o.boosters.filter((b) => b.cards.length);
    st = { boosters, bi: 0, sim: !!o.sim, pity, combo: 0, busy: false, auto: false, multiExt: new Set(boosters.map((b) => b.ext.id)).size > 1 };
    if (!boosters.length) { bilan(); return; }
    dealBooster(boosters[0], o.fromRect || null);
  }

  // Fenetre fermee en plein milieu : on termine proprement (annonce, isBusy).
  function abort() {
    if (!st || st.dead) return;
    const was = st;
    if (!was.inBilan) { was.inBilan = true; onAllRevealed(); }
    was.dead = true;
    document.querySelectorAll(".ov2-spot").forEach((s) => s.remove());
    // Laisse la fermeture animee de la fenetre se jouer avant de vider la scene.
    setTimeout(() => { if (st === was) reset(); }, 240);
  }

  // ------------------------------------------------------------ evenements
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ov2]");
    if (!b || !st) return;
    const k = b.dataset.ov2;
    const cur = st.boosters[st.bi];
    if (k === "all" && cur) revealAll(cur);
    else if (k === "next") next();
    else if (k === "bilan") { if (cur && cur.done && st.bi === st.boosters.length - 1) bilan(); else skipToBilan(); }
    else if (k === "auto") {
      st.auto = true;
      if (st.packGo && !(cur && cur.slots)) st.packGo();
      else if (cur && cur.done) next();
      else if (cur) revealAll(cur);
      if (cur) actionsDuring(cur);
    } else if (k === "auto-off") { st.auto = false; if (cur && cur.slots && !cur.done) actionsDuring(cur); else if (cur && cur.done) boosterDone(Object.assign(cur, { done: false })); else setActions([["bilan", "&#9197; Passer au bilan", "btn-ghost"], ["auto", "&#9654;&#9654; Auto", "btn-ghost"]]); }
    else if (k === "again") { const a = $("open-another-btn"); if (a) a.click(); }
    else if (k === "close") { const c = $("pack-modal-close"); if (c) c.click(); }
    else if (k === "share") {
      const cards = st.boosters.flatMap((x) => x.cards);
      const best = cards.slice().sort((a, b2) => score(b2) - score(a))[0];
      if (!best) return;
      b.disabled = true;
      LazyJs.load("js/lazy/share-studio.js")
        .then(() => ShareStudio.card({ card: best, finish: best.finish || "normal", quality: best.quality, edition: best.edition || null, serial: best.serialNumber || null, owned: true }))
        .catch(LazyJs.fail("Partage indisponible pour le moment."))
        .finally(() => { b.disabled = false; });
    }
  });

  // Espace / Entree : carte suivante (la moins rare d'abord), puis booster suivant.
  document.addEventListener("keydown", (e) => {
    if (!st || st.dead || (e.key !== " " && e.key !== "Enter")) return;
    const overlay = $("pack-modal-overlay");
    if (!overlay || overlay.hidden) return;
    if (document.querySelector(".cine-overlay, .ov2-spot, .reveal-zoom-overlay")) return;
    if (e.target && e.target.closest && e.target.closest("button, a, input")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (st.inBilan || st.busy) return;
    const cur = st.boosters[st.bi];
    if (!cur) return;
    if (!cur.slots) { if (st.packGo) st.packGo(); return; }
    const left = cur.slots.filter((s) => !s.revealed && !s.pending).sort((a, b) => score(a.card) - score(b.card));
    if (left.length) reveal(cur, left[0], false);
    else if (cur.done) next();
  }, true);

  // Croix de la fenetre pendant la scene.
  document.addEventListener("DOMContentLoaded", () => {
    const x = $("pack-modal-close");
    if (x) x.addEventListener("click", () => abort());
    const overlay = $("pack-modal-overlay");
    if (overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay && st && st.inBilan) abort(); });
  });

  return { run, reset, resist, abort, active: () => !!st && !st.dead };
})();
