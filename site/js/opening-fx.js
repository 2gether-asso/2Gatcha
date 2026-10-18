// Mise en scene de l'ouverture (2026-10-15) : choix du booster parmi 3,
// dechirure au doigt, suspense de la derniere carte, cinematique des grands
// tirages, vibrations et sons supplementaires. Utilise par opening.js.

// --- Sons supplementaires (WebAudio, voir Sfx dans ui.js).
(function () {
  if (typeof Sfx === "undefined") return;
  // Bruit filtre : dechirure, souffle.
  Sfx._noise = function (duration, from, to, gain, type = "bandpass") {
    if (this._muted) return;
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume();
      const len = Math.floor(ctx.sampleRate * duration);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.setValueAtTime(from, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(filter); filter.connect(g); g.connect(ctx.destination);
      src.start();
    } catch (e) { /* audio indisponible */ }
  };
  Sfx.tear = function () { this._noise(0.45, 900, 4200, 0.35); };
  Sfx.whoosh = function () { this._noise(0.7, 300, 2600, 0.22, "lowpass"); };
  // Coup sourd facon grosse caisse : la note chute de f0 a f1 (les premiers
  // instants, plus aigus, restent audibles sur les petits haut-parleurs ou un
  // simple 70 Hz ne s'entendait pas), avec un leger choc filtre pour l'attaque.
  Sfx._thump = function (start, f0, f1, gain) {
    if (this._muted) return;
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume();
      const t0 = ctx.currentTime + start;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f0, t0);
      osc.frequency.exponentialRampToValueAtTime(f1, t0 + 0.14);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + 0.3);
      const len = Math.floor(ctx.sampleRate * 0.05);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 700;
      const ng = ctx.createGain();
      ng.gain.value = gain * 0.5;
      src.connect(lp); lp.connect(ng); ng.connect(ctx.destination);
      src.start(t0);
    } catch (e) { /* audio indisponible */ }
  };
  // "Boum-boum" : un coup fort puis un plus doux.
  Sfx.heartbeat = function () { this._thump(0, 190, 55, 0.7); this._thump(0.2, 160, 50, 0.5); };
  Sfx.pick = function () { this._tone(660, 0, 0.08, "triangle", 0.08); this._tone(990, 0.06, 0.1, "triangle", 0.06); };
  // Scintillement propre a chaque finition (arpege aigu).
  Sfx.finish = function (finish) {
    const sets = { holo: [1318, 1568, 1976], gold: [1046, 1318, 1568, 2093], ghost: [880, 830, 784], diamond: [1760, 2217, 2637, 3520], rainbow: [1046, 1175, 1318, 1568, 1760, 2093] };
    (sets[finish] || []).forEach((f, i) => this._tone(f, 0.32 + i * 0.06, 0.4, finish === "ghost" ? "sine" : "triangle", 0.04));
  };
  Sfx.fanfare = function () { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this._tone(f, i * 0.09, 0.6, "triangle", 0.08)); };
})();

const OpeningFx = (function () {
  const RANK = { commune: 0, rare: 1, epique: 2, legendaire: 3, mythique: 4, unique: 5 };
  const vibrate = (p) => { if (typeof Haptics !== "undefined") Haptics.buzz(p); else { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* non supporte */ } } };
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Choix du booster : 3 paquets en eventail, on choisit lequel dechirer.
  function packChoice(pack, packHtml, onChosen) {
    const stage = pack.parentElement;
    const old = stage.querySelector(".pack-fan");
    if (old) old.remove();
    pack.style.visibility = "hidden";
    const fan = document.createElement("div");
    fan.className = "pack-fan";
    fan.innerHTML = [0, 1, 2].map((i) => `<button type="button" class="pack-choice" data-i="${i}" aria-label="Choisir le booster ${i + 1}">${packHtml}</button>`).join("");
    stage.appendChild(fan);
    fan.addEventListener("click", (e) => {
      const b = e.target.closest(".pack-choice");
      if (!b || fan.classList.contains("done")) return;
      fan.classList.add("done");
      b.classList.add("chosen");
      fan.querySelectorAll(".pack-choice").forEach((x) => { if (x !== b) x.classList.add("away"); });
      Sfx.pick();
      vibrate(15);
      setTimeout(() => { fan.remove(); pack.style.visibility = "visible"; pack.classList.add("pack-arrive"); setTimeout(() => pack.classList.remove("pack-arrive"), 400); onChosen && onChosen(); }, reduced() ? 50 : 420);
    });
  }

  // Dechirure au doigt : glisser de gauche a droite sur le haut du paquet.
  function attachSwipe(pack, onTear) {
    if (pack._swipeBound) return;
    pack._swipeBound = true;
    let start = null;
    const set = (v) => pack.style.setProperty("--tear", String(v));
    pack.addEventListener("pointerdown", (e) => {
      if (pack.classList.contains("charging") || pack.classList.contains("tearing")) return;
      start = { x: e.clientX, y: e.clientY, moved: false };
      try { pack.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    pack.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (Math.abs(dx) > 8) start.moved = true;
      if (!start.moved) return;
      const w = pack.getBoundingClientRect().width;
      const v = Math.max(0, Math.min(1, dx / (w * 0.65)));
      pack.classList.add("tear-drag");
      set(v);
      if (v >= 1) {
        start = null;
        pack._swiped = true;
        pack.classList.remove("tear-drag");
        set(0);
        vibrate([20, 30, 40]);
        onTear();
      }
    });
    const end = () => {
      if (start && start.moved) pack._swiped = true;
      start = null;
      pack.classList.remove("tear-drag");
      set(0);
    };
    pack.addEventListener("pointerup", end);
    pack.addEventListener("pointercancel", end);
  }

  // Suspense de la derniere carte : elle tremble, puis la lumiere filtre par
  // ses bords si elle est epique ou mieux. Resout quand il faut la retourner.
  function suspense(cardEl, rarityKey, color) {
    const strong = (RANK[rarityKey] ?? 0) >= RANK.epique;
    if (reduced()) return Promise.resolve();
    cardEl.style.setProperty("--sus-color", strong ? color : "rgba(255,255,255,0.35)");
    cardEl.classList.add("suspense", strong ? "suspense-strong" : "suspense-soft");
    if (strong) { Sfx.heartbeat(); setTimeout(() => Sfx.heartbeat(), 520); vibrate([30, 120, 30, 120, 60]); }
    return new Promise((res) => setTimeout(() => { cardEl.classList.remove("suspense", "suspense-strong", "suspense-soft"); res(); }, strong ? 1250 : 520));
  }

  // Cinematique des grands tirages (legendaire et mieux, ou god pack).
  // 4 paliers d'intensite, bien distincts : 1 legendaire, 2 mythique (plus
  // de rayons, etincelles, secousse), 3 unique (double couronne de rayons,
  // onde de choc), 4 GOD PACK (tout ca en multicolore, flash, ondes en serie).
  const TIER_OF = { legendaire: 1, mythique: 2, unique: 3 };
  const tierOf = (rarityKey, god) => (god ? 4 : TIER_OF[rarityKey] || 1);
  function cinematic(cardEl, card, color, label, tier = 1) {
    if (reduced()) return Promise.resolve();
    const front = cardEl.querySelector(".card-front");
    if (!front) return Promise.resolve();
    const ov = document.createElement("div");
    ov.className = `cine-overlay cine-tier-${tier}${tier === 4 ? " cine-god" : ""}`;
    ov.style.setProperty("--c", color || "#f5a524");
    const sparks = tier >= 2 ? `<div class="cine-sparks" aria-hidden="true">${Array.from({ length: tier * 8 }, (_, i) => `<i style="--a:${Math.round((360 / (tier * 8)) * i + Math.random() * 12)}deg;--d:${(0.9 + Math.random() * 0.9).toFixed(2)}s;--delay:${(1.2 + Math.random() * 0.5).toFixed(2)}s"></i>`).join("")}</div>` : "";
    const rings = tier >= 3 ? `<div class="cine-rings" aria-hidden="true">${Array.from({ length: tier === 4 ? 3 : 1 }, (_, i) => `<span style="--delay:${(1.45 + i * 0.35).toFixed(2)}s"></span>`).join("")}</div>` : "";
    ov.innerHTML = `${tier === 4 ? '<div class="cine-flash" aria-hidden="true"></div>' : ""}<div class="cine-rays" aria-hidden="true"></div>${tier >= 3 ? '<div class="cine-rays cine-rays-rev" aria-hidden="true"></div>' : ""}<div class="cine-vignette" aria-hidden="true"></div><div class="cine-glow" aria-hidden="true"></div>${rings}${sparks}
      <div class="cine-spin"><div class="card revealed cine-card" data-rarity="${cardEl.dataset.rarity}" data-finish="${cardEl.dataset.finish}" data-quality="${cardEl.dataset.quality}"${cardEl.dataset.edition ? ` data-edition="${cardEl.dataset.edition}"` : ""}><div class="card-inner"><div class="${front.className}">${front.innerHTML}</div></div></div></div>
      <div class="cine-label">${label || card.rarity?.name || ""}</div><div class="cine-skip">Tape pour continuer</div>`;
    document.body.appendChild(ov);
    Sfx.whoosh();
    setTimeout(() => Sfx.fanfare(), 900);
    if (tier >= 2) setTimeout(() => Sfx.heartbeat && Sfx.heartbeat(), 250);
    if (tier >= 3) setTimeout(() => Sfx.fanfare(), 1500);
    if (tier === 4) {
      setTimeout(() => Sfx.fanfare(), 2100);
      setTimeout(() => { if (typeof confetti === "function") ["#f472b6", "#facc15", "#4ade80", "#22d3ee", "#a78bfa"].forEach((c, i) => setTimeout(() => confetti({ particleCount: 60, spread: 120, startVelocity: 45, colors: [c], origin: { x: 0.15 + i * 0.175, y: 0.6 } }), i * 120)); }, 1500);
    }
    vibrate(tier === 4 ? [60, 40, 60, 40, 60, 40, 200] : tier === 3 ? [50, 50, 50, 50, 150] : [40, 60, 40, 60, 120]);
    return new Promise((res) => {
      let done = false;
      const close = () => { if (done) return; done = true; ov.classList.add("cine-out"); setTimeout(() => { ov.remove(); res(); }, 320); };
      // Reste affichee jusqu'au tap (ou Echap / Entree / Espace) : plus de
      // fermeture automatique, le joueur profite de son grand tirage.
      ov.addEventListener("click", close);
      document.addEventListener("keydown", function onKey(e) {
        if (!["Escape", "Enter", " "].includes(e.key)) return;
        // Capture + arret : la touche ne retourne pas aussi la carte suivante.
        e.preventDefault();
        e.stopImmediatePropagation();
        document.removeEventListener("keydown", onKey, true);
        close();
      }, true);
    });
  }

  return { RANK, vibrate, packChoice, attachSwipe, suspense, cinematic, tierOf };
})();
