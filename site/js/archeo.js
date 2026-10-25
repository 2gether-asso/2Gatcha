// Archeologie (2026-10-25 ; grattage libre en deux etapes depuis le
// 2026-10-26), onglet de la page Jeux.
//  1) Extraction : on gratte librement la terre d'une tablette ; les blocs
//     bruts affleurent au fil du geste, un bloc degage est extrait.
//  2) Atelier : meme geste sur la gangue d'un bloc ; la trouvaille apparait
//     dessous et est liberee quand elle est entierement a nu.
// Outils : pinceau, grattoir, pioche. Jauge de pression = durete x vitesse :
// dans le rouge sur une trouvaille deja a nu, elle s'abime.
// 2026-10-27 : trois sortes de tablettes (argile, pierre gravee avec veines de
// roche dure, tablette doree aux pieces fragiles) a choisir avant d'ouvrir, et
// un niveau d'archeologue (barre en tete) qui debloque outils et avantages.
// Le serveur (api/src/native/archeo.js) garde le plan et fait foi ; la page
// applique le meme calcul tout de suite pour l'affichage, envoie les points
// du geste par paquets et se recale sur la reponse.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const ERR = { no_tablet: "Pas de tablette : termine des grilles de fouille pour en trouver.", tablet_in_progress: "Une tablette est déjà ouverte.", no_tablet_open: "Aucune tablette ouverte.", archeo_closed: "L'archéologie est fermée pour le moment.", no_find: "Ce bloc n'existe plus." };
  const STATE = { intact: ["Intact", "✨"], scratched: ["Rayé", "〰️"], cracked: ["Fissuré", "⚡"], broken: ["Cassé", "💔"] };
  const TOOL_UI = {
    brush: { icon: "🖌️", label: "Pinceau", sub: "large et doux" },
    scraper: { icon: "🪛", label: "Grattoir", sub: "fin et précis" },
    pick: { icon: "⛏️", label: "Pioche", sub: "gros éclats · ×3 d'endurance · seule à bien entamer la roche dure" },
    fine: { icon: "🪶", label: "Pinceau fin", sub: "très précis, ne casse jamais" },
    air: { icon: "💨", label: "Soufflet", sub: "balaie large, sans aucun risque" }
  };
  const KIND_FX = { clay: "#b07a4c", stone: "#8b94a3", gold: "#e3b341" };
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tone = (f, d = 0.05, t = "square", g = 0.03) => { if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(f, 0, d, t, g); };
  let st = null, mode = "dig", tool = "brush", work = null;
  let TOOLS = { brush: { r: 1.5, dig: 0.3, hard: 0.35, cost: 1 }, scraper: { r: 0.85, dig: 0.7, hard: 1, cost: 1 }, pick: { r: 2.1, dig: 1.25, hard: 2.4, cost: 3 } };
  let BARE = 0.05;

  // ------------------------------------------------------------------ moteur de grattage
  const eng = { w: 0, h: 0, depth: null, hard: null, fragile: new Set(), fragileAll: false, energy: Infinity, max: 0, peek: new Set(), glints: [], mask: null, art: null, queue: [], timer: null, sending: false, down: false, last: null, pressure: 0, raf: 0, send: null, after: null, cv: null, ctx: null, off: null, under: null };
  // Seuil de casse : 0,8 sur une piece fragile, 1,3 sinon.
  const limitAt = (c) => (eng.fragileAll || eng.fragile.has(c) ? 0.8 : 1.3);
  function scrapeLocal(p) {
    const t = TOOLS[p.t];
    const cx = p.x * eng.w, cy = p.y * eng.h, r = t.r;
    let hurt = false;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(eng.h - 1, Math.floor(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(eng.w - 1, Math.floor(cx + r)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const c = y * eng.w + x, f = 1 - d / (r + 0.35);
        const before = eng.depth[c];
        const k = eng.hard && eng.hard[c] ? (t.rock ?? 1) : 1;
        eng.depth[c] = Math.max(0, before - t.dig * f * k);
        eng.dirty = true;
        const onFind = eng.mask ? eng.mask.has(c) : eng.peek.has(c);
        if (before <= BARE && onFind && p.pressure > limitAt(c)) hurt = true;
      }
    }
    return hurt;
  }
  // Rendu : la carte de profondeur est interpolee sur une image plus fine
  // (RES pixels par case) avec du grain et un bord net, refaite seulement
  // quand la terre change ; les reflets sont redessines a chaque image.
  const RES = 12;
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function sample(arr, w, h, gx, gy) {
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(gx))), y0 = Math.max(0, Math.min(h - 1, Math.floor(gy)));
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, gx - x0)), fy = Math.max(0, Math.min(1, gy - y0));
    const a = arr[y0 * w + x0], b = arr[y0 * w + x1], c = arr[y1 * w + x0], d = arr[y1 * w + x1];
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  }
  function rebuild() {
    eng.dirty = false;
    const RW = eng.w * RES, RH = eng.h * RES;
    const soil = eng.soilImg, under = eng.underImg, noise = eng.noise;
    const peekArr = eng.mask ? null : new Float32Array(eng.w * eng.h);
    if (peekArr) { eng.peek.forEach((c) => { peekArr[c] = 1; }); (eng.extracted || []).forEach((e) => e.cells.forEach((c) => { peekArr[c] = 2; })); }
    const dark = eng.mask ? [82, 78, 73] : [70, 48, 32], light = eng.mask ? [176, 170, 164] : [196, 160, 112];
    // Roche dure : teinte gris-bleu, plus marquee.
    const rockDark = [58, 62, 72], rockLight = [140, 146, 158];
    const hardArr = eng.hard;
    for (let py = 0; py < RH; py++) {
      const gy = (py + 0.5) / RES - 0.5;
      for (let px = 0; px < RW; px++) {
        const gx = (px + 0.5) / RES - 0.5, i = py * RW + px, k = i * 4, n = noise[i];
        const raw = sample(eng.depth, eng.w, eng.h, gx, gy);
        // Grain seulement la ou il reste de la terre : les zones a nu restent propres.
        const d = raw + n * 0.12 * Math.min(1, raw / 0.5);
        const m = Math.min(1, Math.max(0, d / 2.4)), g = 1 + n * 0.18;
        const hv = hardArr ? smooth(0.3, 0.7, sample(hardArr, eng.w, eng.h, gx, gy)) : 0;
        for (let ch = 0; ch < 3; ch++) {
          const soilC = light[ch] + (dark[ch] - light[ch]) * m, rockC = rockLight[ch] + (rockDark[ch] - rockLight[ch]) * m;
          soil.data[k + ch] = (soilC + (rockC - soilC) * hv) * (g + hv * n * 0.15);
        }
        soil.data[k + 3] = raw <= 0.04 ? 0 : 255 * smooth(0.03, 0.16, d);
        if (peekArr) {
          const v = sample(peekArr, eng.w, eng.h, gx, gy);
          const rock = v > 1.2 ? [190, 184, 178] : [128, 121, 116], rg = 1 + n * 0.1;
          under.data[k] = rock[0] * rg; under.data[k + 1] = rock[1] * rg; under.data[k + 2] = rock[2] * rg;
          under.data[k + 3] = 255 * smooth(0.35, 0.55, Math.min(1, v));
        }
      }
    }
    eng.soil.getContext("2d").putImageData(soil, 0, 0);
    if (peekArr) eng.under.getContext("2d").putImageData(under, 0, 0);
  }
  function draw(time = 0) {
    const { ctx, cv } = eng;
    if (!ctx) return;
    if (eng.dirty) rebuild();
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (eng.mask) {
      // Atelier : la trouvaille sous la gangue.
      ctx.fillStyle = "#3f3a36"; ctx.fillRect(0, 0, W, H);
      if (eng.art && eng.art.complete && eng.art.naturalWidth) { const s = Math.min(W, H) * 0.66; ctx.drawImage(eng.art, (W - s) / 2, (H - s) / 2, s, s); }
      else if (eng.artIcon) { ctx.font = `${Math.round(Math.min(W, H) * 0.55)}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(eng.artIcon, W / 2, H / 2 + H * 0.03); }
    } else {
      // Tablette : pierre claire du fond, blocs bruts qui affleurent.
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#ddcca9"); g.addColorStop(1, "#b39871");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(eng.under, 0, 0, W, H);
    }
    // Ombre portee de la terre sur ce qui est degage, puis la terre.
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = Math.max(4, W / 120); ctx.drawImage(eng.soil, 0, 0, W, H); ctx.restore();
    // Atelier : la zone qui compte (le coeur de la trouvaille), en pointilles discrets.
    if (eng.mask) {
      ctx.save(); ctx.setLineDash([W / 60, W / 70]); ctx.lineWidth = Math.max(1.5, W / 260); ctx.strokeStyle = eng.fragileAll ? "rgba(248, 113, 113, 0.7)" : "rgba(253, 230, 138, 0.45)";
      ctx.beginPath(); ctx.ellipse(W / 2, H / 2, (W / eng.w) * 3.5, (H / eng.h) * 3.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    // Oeil exerce : contour rouge sur les parties a nu des pieces fragiles.
    if (!eng.mask && eng.fragile.size) {
      const cw = W / eng.w, ch = H / eng.h;
      ctx.save(); ctx.strokeStyle = `rgba(248, 113, 113, ${0.55 + 0.3 * Math.sin(time / 300)})`; ctx.lineWidth = Math.max(1.5, cw / 10);
      eng.fragile.forEach((c) => {
        const x = c % eng.w, y = Math.floor(c / eng.w);
        const edge = (nx, ny) => nx < 0 || ny < 0 || nx >= eng.w || ny >= eng.h || !eng.fragile.has(ny * eng.w + nx);
        ctx.beginPath();
        if (edge(x, y - 1)) { ctx.moveTo(x * cw, y * ch); ctx.lineTo((x + 1) * cw, y * ch); }
        if (edge(x, y + 1)) { ctx.moveTo(x * cw, (y + 1) * ch); ctx.lineTo((x + 1) * cw, (y + 1) * ch); }
        if (edge(x - 1, y)) { ctx.moveTo(x * cw, y * ch); ctx.lineTo(x * cw, (y + 1) * ch); }
        if (edge(x + 1, y)) { ctx.moveTo((x + 1) * cw, y * ch); ctx.lineTo((x + 1) * cw, (y + 1) * ch); }
        ctx.stroke();
      });
      ctx.restore();
    }
    // Reflets : il reste peu de terre au-dessus de quelque chose.
    if (!eng.mask && eng.glints.length) {
      const cw = W / eng.w, ch = H / eng.h;
      eng.glints.forEach((c, i) => {
        const a = 0.3 + 0.4 * Math.max(0, Math.sin(time / 420 + i * 1.7));
        const x = ((c % eng.w) + 0.5) * cw, y = (Math.floor(c / eng.w) + 0.5) * ch, r = Math.max(2, cw * 0.12);
        ctx.fillStyle = `rgba(255, 244, 200, ${a})`;
        ctx.beginPath(); ctx.moveTo(x, y - r * 2); ctx.lineTo(x + r * 0.5, y); ctx.lineTo(x, y + r * 2); ctx.lineTo(x - r * 0.5, y); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - r * 2, y); ctx.lineTo(x, y + r * 0.5); ctx.lineTo(x + r * 2, y); ctx.lineTo(x, y - r * 0.5); ctx.closePath(); ctx.fill();
      });
    }
  }
  function loop(t) { draw(t); eng.raf = requestAnimationFrame(loop); }
  function mount(canvas, w, h) {
    cancelAnimationFrame(eng.raf);
    eng.cv = canvas; eng.ctx = canvas.getContext("2d");
    eng.w = w; eng.h = h;
    const RW = w * RES, RH = h * RES;
    eng.soil = document.createElement("canvas"); eng.soil.width = RW; eng.soil.height = RH;
    eng.under = document.createElement("canvas"); eng.under.width = RW; eng.under.height = RH;
    eng.soilImg = eng.soil.getContext("2d").createImageData(RW, RH);
    eng.underImg = eng.under.getContext("2d").createImageData(RW, RH);
    // Grain fixe de la terre (bruit doux).
    eng.noise = new Float32Array(RW * RH);
    for (let i = 0; i < eng.noise.length; i++) eng.noise[i] = Math.random() * 2 - 1;
    for (let pass = 0; pass < 2; pass++) for (let i = RW + 1; i < eng.noise.length - RW - 1; i++) eng.noise[i] = (eng.noise[i] * 2 + eng.noise[i - 1] + eng.noise[i + 1] + eng.noise[i - RW] + eng.noise[i + RW]) / 6 * 1.6;
    eng.dirty = true;
    const fit = () => { const r = canvas.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); };
    fit();
    new ResizeObserver(fit).observe(canvas);
    if (reduced()) draw(); else eng.raf = requestAnimationFrame(loop);
    // Geste : un point toutes les demi-cases, vitesse en cases par 100 ms.
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, t: performance.now() }; };
    const emit = (p, speed) => {
      const t = TOOLS[tool];
      if (eng.energy < t.cost) { if (!eng.warned) { eng.warned = true; Toast.info("Plus d'endurance pour cette tablette."); } return; }
      if (Number.isFinite(eng.energy)) eng.energy -= t.cost;
      const pressure = t.hard * Math.max(0.2, Math.min(3, speed));
      eng.pressure = pressure;
      const hurt = scrapeLocal({ x: p.x, y: p.y, t: tool, pressure });
      if (hurt) crack();
      eng.queue.push({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000, t: tool, s: Math.round(speed * 100) / 100 });
      if (Math.random() < 0.25) tone(tool === "pick" ? 120 + Math.random() * 60 : 1100 + Math.random() * 500, tool === "pick" ? 0.05 : 0.015, tool === "pick" ? "square" : "sawtooth", tool === "pick" ? 0.03 : 0.006);
      if (tool === "pick" && Math.random() < 0.5) chips(p);
      gauges();
      if (reduced()) draw();
      // Paquets espaces (limite de debit de l'API) : toutes les 1,5 s, ou au lacher.
      if (!eng.timer) eng.timer = setTimeout(flush, 1500);
      if (eng.queue.length >= 200) flush();
    };
    canvas.onpointerdown = (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); eng.down = true; eng.last = pos(e); emit(eng.last, 0.5); };
    canvas.onpointermove = (e) => {
      if (!eng.down) return;
      const p = pos(e), l = eng.last;
      const dx = (p.x - l.x) * eng.w, dy = (p.y - l.y) * eng.h, dist = Math.hypot(dx, dy);
      if (dist < 0.5) return;
      const speed = dist / Math.max(8, p.t - l.t) * 100;
      const n = Math.min(12, Math.floor(dist / 0.5));
      for (let i = 1; i <= n; i++) emit({ x: l.x + (p.x - l.x) * (i / n), y: l.y + (p.y - l.y) * (i / n) }, speed);
      eng.last = p;
    };
    const up = () => { if (!eng.down) return; eng.down = false; eng.pressure = 0; gauges(); flush(); };
    canvas.onpointerup = up; canvas.onpointercancel = up;
  }
  function chips(p) {
    if (reduced()) return;
    const r = eng.cv.getBoundingClientRect();
    for (let k = 0; k < 2; k++) {
      const d = document.createElement("span");
      d.className = "ar-dust";
      d.style.left = `${r.left + p.x * r.width}px`; d.style.top = `${r.top + p.y * r.height}px`;
      d.style.setProperty("--dx", `${Math.random() * 50 - 25}px`); d.style.setProperty("--dy", `${-10 - Math.random() * 30}px`);
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 650);
    }
  }
  let crackAt = 0;
  function crack() {
    const t = performance.now();
    if (t - crackAt < 350) return;
    crackAt = t;
    tone(90, 0.12, "sawtooth", 0.05);
    if (navigator.vibrate) navigator.vibrate(25);
    const el = eng.cv && eng.cv.parentElement;
    if (el && !reduced()) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }
    const g = $("ar-pressure"); if (g) g.classList.add("hit");
    setTimeout(() => { const g2 = $("ar-pressure"); if (g2) g2.classList.remove("hit"); }, 400);
  }
  function gauges() {
    const g = $("ar-pressure");
    if (g) { const v = Math.min(2, eng.pressure) / 2; g.querySelector("span").style.width = `${Math.round(v * 100)}%`; const lim = eng.fragileAll ? 0.8 : 1.3; g.classList.toggle("red", eng.pressure > lim); g.classList.toggle("amber", eng.pressure > lim * 0.7 && eng.pressure <= lim); }
    const e = $("ar-energy");
    if (e && Number.isFinite(eng.energy)) { e.querySelector("span").style.width = `${Math.round((eng.energy / eng.max) * 100)}%`; $("ar-energy-n").textContent = Math.max(0, Math.round(eng.energy)); }
  }
  async function flush() {
    clearTimeout(eng.timer); eng.timer = null;
    if (eng.sending || !eng.queue.length) return;
    const pts = eng.queue.splice(0, 200);
    eng.sending = true;
    try { eng.after(await eng.send(pts)); }
    catch (e) { Toast.error(ERR[e.code] || friendlyError(e)); eng.queue = []; load(); }
    finally { eng.sending = false; if (eng.queue.length) flush(); }
  }
  // Recalage sur le serveur quand plus rien n'est en route.
  const settled = () => !eng.down && !eng.queue.length;
  function stop() { cancelAnimationFrame(eng.raf); eng.ctx = null; }

  // ------------------------------------------------------------------ cadre
  function render() {
    const box = $("archeo-zone");
    if (!box || !st) return;
    stop();
    if (!st.enabled) { box.innerHTML = '<p class="empty-state">L\'archéologie est fermée pour le moment.</p>'; return; }
    const nFinds = (st.finds || []).length;
    const lv = st.level || { level: 1, xp: 0, prev: 0, next: null, perks: {} };
    const pct = lv.next ? Math.round(((lv.xp - lv.prev) / (lv.next - lv.prev)) * 100) : 100;
    box.innerHTML = `
      <details class="ar-level">
        <summary>
          <span class="ar-level-badge">Nv ${lv.level}</span>
          <span class="ar-level-main"><strong>Archéologue</strong><span class="ar-bar ar-xp"><span style="width:${pct}%"></span></span>
            <small>${lv.next ? `${lv.xp - lv.prev} / ${lv.next - lv.prev} XP${lv.nextPerk ? ` · prochain : ${esc(lv.nextPerk)}` : ""}` : "Niveau maximum !"}</small></span>
        </summary>
        <ul class="ar-perks">${Object.entries(lv.perks || {}).map(([n, txt]) => `<li class="${lv.level >= Number(n) ? "on" : ""}"><b>Nv ${n}</b> ${esc(txt)}</li>`).join("")}</ul>
        <p class="muted">XP : 3 par bloc extrait (+5 si la tablette est parfaite), puis 5 / 4 / 2 / 1 par trouvaille libérée intacte / rayée / fissurée / cassée. ×1,5 pour la pierre gravée, ×2 pour la tablette dorée.</p>
      </details>
      <div class="ar-head">
        <div class="ar-stock"><span class="ar-tablet-ico" aria-hidden="true"></span><strong>${st.tablets}</strong><small>tablette${st.tablets > 1 ? "s" : ""}${st.done ? ` · ${st.done} fouillée${st.done > 1 ? "s" : ""}` : ""}${st.freedTotal ? ` · ${st.freedTotal} trouvaille${st.freedTotal > 1 ? "s" : ""} libérée${st.freedTotal > 1 ? "s" : ""}` : ""}</small></div>
        <nav class="tabs ar-modes" role="tablist">
          <button type="button" role="tab" class="tab ${mode === "dig" ? "active" : ""}" data-mode="dig">⛏️ 1. Extraction</button>
          <button type="button" role="tab" class="tab ${mode === "clean" ? "active" : ""}" data-mode="clean">🧽 2. Atelier${nFinds ? ` <span class="ar-count">${nFinds}</span>` : ""}</button>
        </nav>
      </div>
      <div id="ar-body"></div>`;
    if (mode === "dig") renderDig(); else if (work) renderWork(); else renderShelf();
  }
  function toolBar() {
    return `<div class="ar-toolbar">
      <div class="tabs" role="radiogroup" aria-label="Outil">${Object.entries(TOOL_UI).filter(([k]) => TOOLS[k]).map(([k, t]) => `<button type="button" role="radio" class="tab ${tool === k ? "active" : ""}" data-tool="${k}" aria-checked="${tool === k}" title="${t.sub}">${t.icon} ${t.label}</button>`).join("")}</div>
      <div class="ar-gauge" title="Pression : dureté de l'outil × vitesse du geste. Dans le rouge sur une trouvaille à nu, elle s'abîme."><small>Pression</small><div class="ar-bar ar-pressure" id="ar-pressure"><span></span></div></div>
    </div>`;
  }

  // ------------------------------------------------------------------ 1. extraction
  function renderDig() {
    const body = $("ar-body");
    const t = st.tablet;
    if (!t) {
      const stock = st.stock || [];
      body.innerHTML = `<div class="ar-empty">
        <p>${st.tablets ? "Choisis une tablette puis gratte la terre à la souris ou au doigt : les blocs bruts (gris) affleurent au fil du geste. Un bloc dégagé aux trois quarts est <strong>extrait</strong>, à nettoyer ensuite à l'atelier pour découvrir ce que c'est." : "Termine des grilles de fouille (ou laisse Milo le faire) : il y a des tablettes anciennes enfouies dans la terre. Plus tu creuses profond, plus les belles tablettes sont fréquentes."}</p>
        <div class="ar-kinds">${stock.map((k) => `<button type="button" class="ar-kind ${k.kind} ${k.count ? "" : "none"}" data-start="${k.kind}" ${k.count ? "" : "disabled"} style="--kc:${KIND_FX[k.kind] || "#b07a4c"}">
            <span class="ar-kind-ico" aria-hidden="true">${k.icon}</span>
            <strong>${esc(k.label)}</strong><small class="ar-kind-rar">${esc(k.rarity)}</small>
            <span class="ar-kind-n">×${k.count}</span>
            <small>${esc(k.hint)}</small>
            <small class="muted">Jusqu'au palier ${k.maxTier}</small>
          </button>`).join("")}</div></div>`;
      return;
    }
    const kindInfo = (st.stock || []).find((k) => k.kind === t.kind);
    body.innerHTML = `
      <div class="ar-tablet-title" style="--kc:${KIND_FX[t.kind] || "#b07a4c"}">${kindInfo ? kindInfo.icon : "🏺"} <strong>${esc(t.label || "Tablette")}</strong>${t.hard ? ` <small>· veines grises = roche dure : pioche ou grattoir</small>` : ""}</div>
      ${toolBar()}
      <div class="ar-slab"><canvas class="ar-canvas" id="ar-cv" style="aspect-ratio:${t.w} / ${t.h}" aria-label="Tablette à gratter"></canvas></div>
      <div class="ar-foot">
        <div class="ar-gauge"><small>Endurance</small><div class="ar-bar ar-energy" id="ar-energy"><span style="width:${Math.round((t.energy / t.max) * 100)}%"></span></div><strong id="ar-energy-n">${t.energy}</strong></div>
        <span class="muted" id="ar-count-txt">${t.extracted.length}/${t.total} bloc${t.total > 1 ? "s" : ""} extrait${t.total > 1 ? "s" : ""} · ✨ = presque à nu</span>
        <button type="button" class="btn-ghost" id="ar-finish">Ranger la tablette</button>
      </div>`;
    Object.assign(eng, { depth: t.depth.slice(), hard: t.hard, fragile: new Set(t.fragile || []), fragileAll: false, energy: t.energy, max: t.max, peek: new Set(t.peek), glints: t.glints, extracted: t.extracted, mask: null, art: null, artIcon: null, warned: false });
    eng.send = (pts) => API.archeo(Session.userId, "scrape", { pts });
    eng.after = (res) => {
      if (res.hurt) Toast.error("💥 Trop brusque : une trouvaille a pris un coup.");
      if (res.finished) { const go = () => digResult(res); if (settled()) go(); else setTimeout(() => digResult(res), 600); return; }
      st = res;
      const t2 = res.tablet;
      eng.peek = new Set(t2.peek); eng.glints = t2.glints; eng.extracted = t2.extracted; eng.fragile = new Set(t2.fragile || []); eng.dirty = true;
      if (settled()) { eng.depth = t2.depth.slice(); eng.energy = t2.energy; eng.dirty = true; gauges(); }
      if (res.fresh) { Toast.success(`🪨 ${res.fresh > 1 ? res.fresh + " blocs extraits" : "Un bloc extrait"} ! À nettoyer à l'atelier.`); tone(660, 0.18, "triangle", 0.05); }
      const c = $("ar-count-txt"); if (c) c.textContent = `${t2.extracted.length}/${t2.total} bloc${t2.total > 1 ? "s" : ""} extrait${t2.total > 1 ? "s" : ""} · ✨ = presque à nu`;
    };
    mount($("ar-cv"), t.w, t.h);
  }
  function levelUpHtml(up) {
    if (!up) return "";
    setTimeout(() => { tone(523, 0.12, "triangle", 0.05); setTimeout(() => tone(784, 0.2, "triangle", 0.05), 130); }, 300);
    return `<p class="ar-levelup">🎓 Niveau d'archéologue ${up.level} !${up.perk ? ` ${esc(up.perk)}` : ""}</p>`;
  }
  function digResult(res) {
    const f = res.finished;
    st = res;
    render();
    $("ar-body").insertAdjacentHTML("afterbegin", `<div class="ar-result">
      <h3>${f.perfect ? "📜 Tablette parfaitement fouillée !" : res.auto === "no_energy" ? "🖌️ Plus d'endurance…" : res.auto === "all_found" ? "🪨 Tout est extrait !" : "🏺 Tablette rangée"}</h3>
      <p>${f.extracted.length ? `<strong>${f.extracted.length} bloc${f.extracted.length > 1 ? "s" : ""} brut${f.extracted.length > 1 ? "s" : ""}</strong> rejoigne${f.extracted.length > 1 ? "nt" : ""} l'atelier.` : "Aucun bloc extrait cette fois."}${f.lost ? ` ${f.lost} trouvaille${f.lost > 1 ? "s" : ""} reste${f.lost > 1 ? "nt" : ""} dans la pierre.` : ""}${f.bonus ? ` Bonus +${f.bonus} ✨.` : ""} <strong>+${f.xp} XP d'archéologue.</strong></p>
      ${levelUpHtml(f.levelUp)}
      ${f.extracted.length ? `<button type="button" class="btn" data-mode="clean">🧽 Aller nettoyer</button>` : ""}
    </div>`);
    if (f.perfect && typeof confetti === "function") confetti({ particleCount: 80, spread: 70, origin: { y: 0.55 }, colors: ["#d6b98c", "#fde68a", "#34d399"] });
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  }

  // ------------------------------------------------------------------ 2. atelier
  function renderShelf() {
    const body = $("ar-body");
    const finds = st.finds || [];
    body.innerHTML = finds.length ? `
      <p class="muted">Choisis un bloc brut et gratte sa gangue : la trouvaille apparaît dessous. Elle est <strong>libérée</strong> quand elle est entièrement à nu.</p>
      <div class="ar-shelf">${finds.map((f) => `<button type="button" class="ar-rock ${f.shiny ? "shiny" : ""} ${f.state}" data-find="${f.id}" style="--s:${Math.min(4, f.size)}">
          <span class="ar-rock-stone" aria-hidden="true"></span>
          <small>${f.size >= 3 ? "Gros bloc" : f.size === 2 ? "Bloc moyen" : "Petit bloc"}${f.shiny ? " · ça brille…" : ""}${f.from === "gold" ? " · doré" : f.from === "stone" ? " · pierre gravée" : ""}</small>
          ${f.fragile ? `<em class="ar-fragile">⚠️ Fragile</em>` : ""}
          ${f.state !== "intact" ? `<em>${STATE[f.state][1]} ${STATE[f.state][0]}</em>` : ""}${f.progress ? `<em>${f.progress} % dégagé</em>` : ""}
        </button>`).join("")}</div>`
      : `<div class="ar-empty"><p>L'atelier est vide. Extrais des blocs d'une tablette pour les nettoyer ici.</p><button type="button" class="btn-secondary" data-mode="dig">⛏️ Aller à l'extraction</button></div>`;
  }
  async function openWork(id) {
    try { const r = await API.archeo(Session.userId, "cleanStatus", { findId: id }); st = r; work = r.work; render(); } catch (e) { Toast.error(ERR[e.code] || friendlyError(e)); }
  }
  function renderWork() {
    const body = $("ar-body");
    const w = work;
    body.innerHTML = `
      <div class="ar-work-head"><button type="button" class="btn-ghost" id="ar-back">← L'atelier</button><span class="ar-state ${w.state}" id="ar-state">${STATE[w.state][1]} ${STATE[w.state][0]}</span><span class="muted" id="ar-prog">${w.progress} % de la trouvaille à nu</span></div>
      ${toolBar()}
      <div class="ar-stone"><canvas class="ar-canvas" id="ar-cv" style="aspect-ratio:1" aria-label="Bloc brut à nettoyer"></canvas></div>
      ${w.fragile ? `<p class="ar-fragile-note">⚠️ Pièce fragile : elle s'abîme dès que la pression passe l'orange. Pinceau, pinceau fin ou soufflet conseillés.</p>` : ""}
      <p class="muted ar-hint">Dégage l'intérieur du cercle pointillé : la trouvaille est libérée quand son cœur est à nu (pas besoin de tout gratter). Pinceau sans risque ; pression dans le rouge sur ce qui est déjà à nu = elle s'abîme.</p>`;
    const art = new Image();
    if (w.art.img) art.src = `assets/${encodeURI(w.art.img)}`;
    Object.assign(eng, { depth: w.depth.slice(), hard: null, fragile: new Set(), fragileAll: !!w.fragile, energy: Infinity, max: 0, peek: new Set(), glints: [], extracted: [], mask: new Set(w.mask), art: w.art.img ? art : null, artIcon: w.art.icon, warned: false });
    eng.send = (pts) => API.archeo(Session.userId, "clean", { findId: w.id, pts });
    eng.after = (res) => {
      st = res;
      if (res.hurt) Toast.error("💥 Trop brusque ! La trouvaille s'abîme.");
      if (res.freed) { const go = () => freedFx(res); if (settled()) go(); else setTimeout(go, 500); return; }
      work = res.work;
      if (settled()) { eng.depth = work.depth.slice(); eng.dirty = true; }
      const s = $("ar-state"); if (s) { s.className = `ar-state ${work.state}`; s.textContent = `${STATE[work.state][1]} ${STATE[work.state][0]}`; }
      const p = $("ar-prog"); if (p) p.textContent = `${work.progress} % de la trouvaille à nu`;
    };
    mount($("ar-cv"), w.g, w.g);
  }
  function freedFx(res) {
    const f = res.freed;
    st = res; work = null;
    stop();
    const stone = document.querySelector(".ar-stone");
    if (stone) stone.classList.add("freed");
    const reward = f.amount ? `×${f.amount}` : f.dust ? `+${f.dust} ✨ (éclats)` : "";
    tone(f.state === "broken" ? 160 : 880, 0.3, "triangle", 0.05);
    if (f.state !== "broken" && typeof confetti === "function") confetti({ particleCount: 70, spread: 70, origin: { y: 0.5 }, colors: ["#fde68a", "#ffffff", "#34d399"] });
    setTimeout(() => {
      render();
      $("ar-body").insertAdjacentHTML("afterbegin", `<div class="ar-result ar-freed ${f.state}">
        <div class="ar-freed-art">${f.img ? `<img src="assets/${encodeURI(f.img)}" alt="" />` : `<span>${f.icon || "🏺"}</span>`}</div>
        <h3>${f.state === "broken" ? "💔 Cassé…" : "✨ Libéré !"} ${esc(f.name)}</h3>
        <p>${STATE[f.state][1]} ${STATE[f.state][0]} · ${reward}${f.reward && f.state !== "broken" ? ` : ${esc(f.reward)}` : ""}${f.tier ? ` · palier ${f.tier}` : ""}${f.xp ? ` · +${f.xp} XP` : ""}</p>
        ${levelUpHtml(f.levelUp)}
      </div>`);
    }, reduced() ? 0 : 700);
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  }

  async function load() {
    try { st = await API.archeo(Session.userId); } catch (e) { st = null; $("archeo-zone").innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; return; }
    if (st.tools) TOOLS = st.tools;
    if (!TOOLS[tool]) tool = "brush";
    if (st.bare != null) BARE = st.bare;
    if (work && !(st.finds || []).some((f) => f.id === work.id)) work = null;
    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const zone = $("archeo-zone");
    if (!zone) return;
    zone.addEventListener("click", async (e) => {
      const m = e.target.closest("[data-mode]");
      if (m) { await flush(); mode = m.dataset.mode; work = null; render(); return; }
      const tb = e.target.closest("[data-tool]");
      if (tb) { tool = tb.dataset.tool; zone.querySelectorAll("[data-tool]").forEach((b) => { b.classList.toggle("active", b === tb); b.setAttribute("aria-checked", String(b === tb)); }); tone(500, 0.03); return; }
      const rock = e.target.closest("[data-find]");
      if (rock) { openWork(rock.dataset.find); return; }
      if (e.target.closest("#ar-back")) { await flush(); work = null; load(); return; }
      const sb = e.target.closest("[data-start]");
      if (sb) {
        try { st = await API.archeo(Session.userId, "start", { kind: sb.dataset.start }); render(); } catch (err) { Toast.error(ERR[err.code] || friendlyError(err)); }
        return;
      }
      if (e.target.closest("#ar-finish")) {
        if (!(await Confirm.show("Ranger la tablette maintenant ? Seuls les blocs entièrement dégagés sont extraits, le reste reste dans la pierre.", { title: "Ranger la tablette", confirmText: "Ranger" }))) return;
        await flush();
        try { digResult(await API.archeo(Session.userId, "finish")); } catch (err) { Toast.error(ERR[err.code] || friendlyError(err)); }
      }
    });
  });

  window.loadArcheo = load;
})();
