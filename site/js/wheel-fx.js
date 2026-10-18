// Roue de la fortune en cinematique (2026-10-18) : scene plein ecran comme les
// autres cinematiques. La roue tourne doucement pendant que le serveur tire le
// lot, accelere puis ralentit jusqu'a la case gagnante (le pointeur bascule a
// chaque picot : tic sonore et vibration legere), la case s'illumine, puis le
// lot apparait en grand (rayons, accord, confettis ; flash et pluie de pieces
// au jackpot). Le lot est decide par le serveur (daily-wheel.json) : la roue
// ne fait que s'arreter sur une case de ce type.
//   const fx = WheelFx.open(); await fx.spinTo(tier, { label, sfx, confetti, icon }); fx.abort();

const WheelFx = (() => {
  // 12 cases depuis le haut, sens horaire (memes types que daily-wheel.json).
  const SEGMENTS = ["small", "booster", "big", "key", "small", "jackpot", "big", "booster", "small", "key", "big", "small"];
  const TYPES = {
    small: { label: "Poussières", icon: { emoji: "✨" }, a: "#4c1d95", b: "#7c3aed" },
    big: { label: "Trésor", icon: { emoji: "💎" }, a: "#0e7490", b: "#22d3ee" },
    booster: { label: "Booster", icon: { img: "JetonBooster.png" }, a: "#9d174d", b: "#f472b6" },
    key: { label: "Clé", icon: { img: "cléSpeciale.png" }, a: "#92400e", b: "#f59e0b" },
    jackpot: { label: "JACKPOT", icon: { emoji: "🌟" }, a: "#a16207", b: "#fde047" }
  };
  const C = 200, R = 168;
  const pt = (deg, r) => { const a = (deg * Math.PI) / 180; return [C + r * Math.sin(a), C - r * Math.cos(a)]; };
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function wheelSvg() {
    const seg = 360 / SEGMENTS.length;
    const defs = Object.entries(TYPES).map(([k, t]) => `<radialGradient id="wf-${k}" cx="200" cy="200" r="180" gradientUnits="userSpaceOnUse"><stop offset="0.15" stop-color="${t.a}"/><stop offset="1" stop-color="${t.b}"/></radialGradient>`).join("");
    const slices = SEGMENTS.map((k, i) => {
      const [x0, y0] = pt(i * seg, R), [x1, y1] = pt((i + 1) * seg, R);
      return `<path class="wf-seg wf-seg-${k}" data-i="${i}" d="M ${C} ${C} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="url(#wf-${k})"/>`;
    }).join("");
    const labels = SEGMENTS.map((k, i) => {
      const t = TYPES[k], mid = i * seg + seg / 2;
      const icon = t.icon.img ? `<image href="assets/${encodeURI(t.icon.img)}" x="${C - 19}" y="${C - 146}" width="38" height="38"/>` : `<text x="${C}" y="${C - 118}" class="wf-emoji">${t.icon.emoji}</text>`;
      // Libelle sous l'icone, assez loin du centre pour ne pas chevaucher les voisins (mots longs resserres).
      const fit = t.label.length >= 7 ? ` textLength="50" lengthAdjust="spacingAndGlyphs"` : "";
      return `<g transform="rotate(${mid} ${C} ${C})">${icon}<text x="${C}" y="${C - 98}" class="wf-label ${k === "jackpot" ? "wf-label-jackpot" : ""}"${fit}>${t.label}</text></g>`;
    }).join("");
    const pegs = SEGMENTS.map((_, i) => { const [x, y] = pt(i * seg, R - 4); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4.2" class="wf-peg"/>`; }).join("");
    const bulbs = Array.from({ length: 24 }, (_, i) => { const [x, y] = pt(i * 15 + 7.5, 184); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4.6" class="wf-bulb" style="--i:${i}"/>`; }).join("");
    return `<svg class="wf-svg" viewBox="0 0 400 400" role="img" aria-label="Roue de la fortune">
      <defs>${defs}
        <linearGradient id="wf-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset="0.35" stop-color="#e2b33c"/><stop offset="0.7" stop-color="#9a6a12"/><stop offset="1" stop-color="#f6d77a"/></linearGradient>
        <radialGradient id="wf-hub" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffffff"/><stop offset="0.25" stop-color="#c4b5fd"/><stop offset="1" stop-color="#4c1d95"/></radialGradient>
      </defs>
      <circle cx="${C}" cy="${C}" r="197" fill="url(#wf-gold)"/>
      <circle cx="${C}" cy="${C}" r="190" fill="#1a0b2e"/>
      ${bulbs}
      <g class="wf-rotor">
        <circle cx="${C}" cy="${C}" r="${R + 2}" fill="url(#wf-gold)"/>
        ${slices}
        ${SEGMENTS.map((_, i) => { const [x, y] = pt(i * seg, R); return `<line x1="${C}" y1="${C}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" class="wf-sep"/>`; }).join("")}
        ${labels}
        ${pegs}
      </g>
      <circle cx="${C}" cy="${C}" r="40" fill="url(#wf-gold)"/>
      <circle cx="${C}" cy="${C}" r="33" fill="url(#wf-hub)" class="wf-hub"/>
      <text x="${C}" y="${C + 9}" class="wf-hub-text">2G</text>
    </svg>`;
  }

  function open() {
    const ov = document.createElement("div");
    ov.className = "wf-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "Roue de la fortune");
    ov.innerHTML = `
      <div class="wf-rays" aria-hidden="true"></div>
      <div class="wf-stage">
        <div class="wf-pointer" aria-hidden="true"><svg viewBox="0 0 40 56"><defs><linearGradient id="wf-pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset="0.5" stop-color="#e2b33c"/><stop offset="1" stop-color="#9a6a12"/></linearGradient></defs><path d="M20 54 L4 14 A16 16 0 1 1 36 14 Z" fill="url(#wf-pg)" stroke="#5b3a06" stroke-width="2"/><circle cx="20" cy="16" r="6" fill="#fff8dc"/></svg></div>
        <div class="wf-wheel">${wheelSvg()}</div>
      </div>
      <p class="wf-hint">La roue tourne…</p>
      <div class="wf-prize" hidden></div>`;
    document.body.appendChild(ov);
    if (typeof syncScrollLock === "function") syncScrollLock();
    requestAnimationFrame(() => ov.classList.add("wf-in"));
    const rotor = ov.querySelector(".wf-rotor");
    const pointer = ov.querySelector(".wf-pointer");
    let angle = 0, raf = 0, idle = true, last = performance.now(), lastTick = 0;
    const setAngle = (a) => { rotor.setAttribute("transform", `rotate(${a % 360} ${C} ${C})`); };
    // Attente du serveur : rotation lente.
    const idleLoop = (now) => { const dt = (now - last) / 1000; last = now; if (idle) { angle += 50 * dt; setAngle(angle); raf = requestAnimationFrame(idleLoop); } };
    raf = requestAnimationFrame(idleLoop);
    ov.classList.add("wf-spinning");
    const tick = (now) => {
      if (now - lastTick < 45) return;
      lastTick = now;
      pointer.classList.remove("wf-kick"); void pointer.offsetWidth; pointer.classList.add("wf-kick");
      if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(1400, 0, 0.025, "square", 0.025);
      if (typeof Haptics !== "undefined") Haptics.buzz(6);
    };
    const close = () => { cancelAnimationFrame(raf); ov.classList.add("wf-out"); setTimeout(() => { ov.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); }, 400); };

    function spinTo(tier, meta = {}) {
      return new Promise((resolve) => {
        idle = false;
        cancelAnimationFrame(raf);
        const seg = 360 / SEGMENTS.length;
        const options = SEGMENTS.map((k, i) => (k === tier ? i : -1)).filter((i) => i >= 0);
        const idx = options.length ? options[Math.floor(Math.random() * options.length)] : 0;
        const target = idx * seg + seg / 2 + (Math.random() - 0.5) * seg * 0.6;
        const start = angle;
        const base = ((360 - target) % 360 + 360) % 360;
        const turns = reduced() ? 1 : 6;
        const end = start - (start % 360) + turns * 360 + base + (base < (start % 360) ? 360 : 0);
        const dur = reduced() ? 1200 : 5600;
        const t0 = performance.now();
        let prevPeg = Math.floor(start / seg);
        const step = (now) => {
          const p = Math.min(1, (now - t0) / dur);
          const e = 1 - Math.pow(1 - p, 4);
          angle = start + (end - start) * e;
          setAngle(angle);
          const peg = Math.floor(angle / seg);
          if (peg !== prevPeg) { prevPeg = peg; tick(now); }
          if (p < 1) { raf = requestAnimationFrame(step); return; }
          ov.classList.remove("wf-spinning");
          ov.classList.add("wf-won");
          const win = ov.querySelector(`.wf-seg[data-i="${idx}"]`);
          if (win) win.classList.add("wf-seg-win");
          if (typeof Haptics !== "undefined") Haptics.buzz(tier === "jackpot" ? [60, 40, 60, 40, 160] : [30, 50, 60]);
          setTimeout(() => reveal(tier, meta, resolve), reduced() ? 400 : 1100);
        };
        raf = requestAnimationFrame(step);
      });
    }

    function reveal(tier, meta, resolve) {
      const t = TYPES[tier] || TYPES.small;
      const icon = meta.icon || (t.icon.img ? `<img src="assets/${encodeURI(t.icon.img)}" alt="" />` : `<span>${t.icon.emoji}</span>`);
      const box = ov.querySelector(".wf-prize");
      ov.querySelector(".wf-hint").textContent = "";
      box.hidden = false;
      box.className = `wf-prize wf-prize-${tier}`;
      box.innerHTML = `<div class="wf-prize-icon">${icon}</div><div class="wf-prize-k">${tier === "jackpot" ? "JACKPOT !" : "Gagné !"}</div><div class="wf-prize-label">${meta.label || ""}</div><button type="button" class="btn wf-close">Super !</button>`;
      requestAnimationFrame(() => box.classList.add("wf-show"));
      if (typeof Sfx !== "undefined" && Sfx.reveal) Sfx.reveal(meta.sfx || "rare");
      if (typeof confetti === "function" && meta.confetti) confetti({ ...meta.confetti, origin: { y: 0.45 }, zIndex: 3000 });
      if (tier === "jackpot") {
        ov.classList.add("wf-flash");
        const rain = document.createElement("div");
        rain.className = "wf-coins";
        rain.innerHTML = Array.from({ length: 26 }, (_, i) => `<span style="left:${(i * 37) % 100}%;animation-delay:${(i % 9) * 0.12}s">🪙</span>`).join("");
        ov.appendChild(rain);
      }
      const done = () => { close(); resolve(); };
      box.querySelector(".wf-close").addEventListener("click", done);
      box.querySelector(".wf-close").focus();
    }

    return { spinTo, abort: close };
  }

  return { open, SEGMENTS };
})();
