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
// 2026-10-26 (2e passe, visuel) : terre en relief (eclairage rasant), strates
// qui apparaissent en creusant, cailloux et racines, roche veinee, tablette
// gravee selon sa sorte, quadrillage de fouille, empreinte des blocs extraits,
// curseur qui montre la taille de l'outil et la pression, poussiere et eclats
// dessines dans la scene ; raccourcis 1-5 pour les outils, "bloc suivant".
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
  const TOOL_KEY = "2gatcha_archeo_tool";
  let st = null, mode = "dig", tool = (() => { try { return localStorage.getItem(TOOL_KEY) || "brush"; } catch (e) { return "brush"; } })(), work = null;
  let TOOLS = { brush: { r: 1.5, dig: 0.3, hard: 0.35, cost: 1 }, scraper: { r: 0.85, dig: 0.7, hard: 1, cost: 1 }, pick: { r: 2.1, dig: 1.25, hard: 2.4, cost: 3 } };
  let BARE = 0.05;
  // Seuils de casse envoyes par le serveur (st.limits).
  let LIM = { normal: 1.4, fragile: 0.9 };

  // ------------------------------------------------------------------ moteur de grattage
  const eng = { w: 0, h: 0, depth: null, hard: null, fragile: new Set(), fragileAll: false, energy: Infinity, max: 0, peek: new Set(), glints: [], mask: null, art: null, queue: [], timer: null, sending: false, down: false, last: null, hover: null, pressure: 0, raf: 0, send: null, after: null, cv: null, ctx: null, parts: [], lastT: 0, kind: "clay" };
  // Seuil de casse : plus bas sur une piece fragile.
  const limitAt = (c) => (eng.fragileAll || eng.fragile.has(c) ? LIM.fragile : LIM.normal);
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

  // Rendu : les cartes du serveur (profondeur, roche, blocs) sont
  // interpolees sur une image plus fine (RES pixels par case), refaite
  // seulement quand la terre change ; le relief vient d'un eclairage rasant
  // (haut-gauche) calcule sur la profondeur. Reflets, quadrillage, curseur et
  // particules sont redessines a chaque image.
  let RES = 12;
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  // Bruit de valeur a plusieurs octaves (grain doux, sans "neige").
  function fbm(RW, RH, scales, rnd) {
    const out = new Float32Array(RW * RH);
    let total = 0;
    scales.forEach(([cell, amp]) => {
      total += amp;
      const gw = Math.ceil(RW / cell) + 2, gh = Math.ceil(RH / cell) + 2;
      const grid = new Float32Array(gw * gh).map(() => rnd() * 2 - 1);
      for (let y = 0; y < RH; y++) {
        const gy = y / cell, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
        for (let x = 0; x < RW; x++) {
          const gx = x / cell, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
          const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1], c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
          out[y * RW + x] += (lerp(lerp(a, b, sx), lerp(c, d, sx), sy)) * amp;
        }
      }
    });
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  // Agrandit une carte de cases (w x h) en image fine (bilineaire).
  function upsample(arr, w, h, out) {
    const RW = w * RES, RH = h * RES;
    for (let py = 0; py < RH; py++) {
      const gy = Math.max(0, Math.min(h - 1, (py + 0.5) / RES - 0.5)), y0 = Math.floor(gy), y1 = Math.min(h - 1, y0 + 1), fy = gy - y0;
      for (let px = 0; px < RW; px++) {
        const gx = Math.max(0, Math.min(w - 1, (px + 0.5) / RES - 0.5)), x0 = Math.floor(gx), x1 = Math.min(w - 1, x0 + 1), fx = gx - x0;
        out[py * RW + px] = (arr[y0 * w + x0] * (1 - fx) + arr[y0 * w + x1] * fx) * (1 - fy) + (arr[y1 * w + x0] * (1 - fx) + arr[y1 * w + x1] * fx) * fy;
      }
    }
    return out;
  }
  // Flou de boite separable (deux passes ~ gaussien) : efface les marches
  // de l'interpolation case par case avant l'eclairage.
  function blur(src, RW, RH, r, tmp) {
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < RH; y++) {
        let acc = 0; const o = y * RW;
        for (let x = -r; x <= r; x++) acc += src[o + Math.max(0, Math.min(RW - 1, x))];
        for (let x = 0; x < RW; x++) { tmp[o + x] = acc / (2 * r + 1); acc += src[o + Math.min(RW - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; }
      }
      for (let x = 0; x < RW; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(RH - 1, y)) * RW + x];
        for (let y = 0; y < RH; y++) { src[y * RW + x] = acc / (2 * r + 1); acc += tmp[Math.min(RH - 1, y + r + 1) * RW + x] - tmp[Math.max(0, y - r) * RW + x]; }
      }
    }
    return src;
  }
  // Palettes : strates de la terre (de la surface vers le fond), gangue du bloc.
  const STRATA = [[212, 178, 128], [176, 128, 80], [128, 86, 54], [84, 56, 36], [58, 40, 28]];
  const GANGUE = [[200, 192, 180], [160, 152, 142], [122, 114, 106], [92, 86, 80], [70, 66, 62]];
  function strata(pal, d, out) {
    const t = Math.max(0, Math.min(0.999, d / 2.6)) * (pal.length - 1), i = Math.floor(t), f = t - i;
    for (let ch = 0; ch < 3; ch++) out[ch] = lerp(pal[i][ch], pal[i + 1][ch], f);
    return out;
  }
  function rebuild() {
    eng.dirty = false;
    const RW = eng.w * RES, RH = eng.h * RES, N = RW * RH;
    const soil = eng.soilImg, under = eng.underImg, grain = eng.grain, mott = eng.mott, deco = eng.deco;
    const br = Math.round(RES / 3);
    const D = blur(upsample(eng.depth, eng.w, eng.h, eng.bufD), RW, RH, br, eng.bufT);
    const HV = eng.hard ? blur(upsample(eng.hard, eng.w, eng.h, eng.bufH), RW, RH, br, eng.bufT) : null;
    let P = null, X = null;
    if (!eng.mask) {
      const pk = new Float32Array(eng.w * eng.h), ho = new Float32Array(eng.w * eng.h);
      eng.peek.forEach((c) => { pk[c] = 1; });
      (eng.extracted || []).forEach((e) => e.cells.forEach((c) => { ho[c] = 1; pk[c] = 0; }));
      P = blur(upsample(pk, eng.w, eng.h, eng.bufP), RW, RH, br, eng.bufT);
      X = blur(upsample(ho, eng.w, eng.h, eng.bufX), RW, RH, br, eng.bufT);
    }
    const pal = eng.mask ? GANGUE : STRATA, col = [0, 0, 0];
    const at = (arr, i) => arr[i < 0 ? 0 : i >= N ? N - 1 : i];
    // Hauteur pour l'eclairage : terre + cailloux en bosse (une passe).
    const HT = eng.bufT;
    for (let i = 0; i < N; i++) HT[i] = D[i] + (deco ? deco[i * 2] * 0.22 * smooth(0.35, 0.7, D[i]) : 0);
    for (let py = 0; py < RH; py++) {
      for (let px = 0; px < RW; px++) {
        const i = py * RW + px, k = i * 4, n = grain[i], m = mott[i];
        const raw = D[i];
        const pebble = deco ? deco[i * 2] * smooth(0.35, 0.7, raw) : 0, root = deco ? deco[i * 2 + 1] * smooth(1.3, 1.7, raw) : 0;
        const hx = at(HT, i + 2) - at(HT, i - 2), hy = at(HT, i + RW * 2) - at(HT, i - RW * 2);
        const light = Math.max(0.6, Math.min(1.4, 1 + (hx + hy) * (eng.mask ? 1.7 : 2.6)));
        const d = raw + m * 0.18;
        strata(pal, d, col);
        // Lignes de strates : on voit les couches en creusant.
        const band = 1 + Math.sin(d * 11 + m * 3) * 0.045;
        let r = col[0], g = col[1], b = col[2];
        const hv = HV ? smooth(0.42, 0.58, HV[i] + m * 0.45) : 0;
        if (hv > 0) {
          // Roche dure : ardoise veinee de clair.
          const vein = Math.abs(Math.sin(px * 0.11 + py * 0.05 + m * 6));
          const v = vein < 0.07 ? 1.35 : 1;
          const rk = lerp(140, 84, Math.min(1, d / 2.4)) * (1 + m * 0.12);
          r = lerp(r, rk * 0.97 * v, hv); g = lerp(g, rk * 0.99 * v, hv); b = lerp(b, rk * 1.05 * v, hv);
        }
        if (pebble > 0.05) { const pv = 0.9 + n * 0.2, a = pebble * 0.7; r = lerp(r, (r * 0.45 + 92) * pv, a); g = lerp(g, (g * 0.45 + 86) * pv, a); b = lerp(b, (b * 0.45 + 78) * pv, a); }
        if (root > 0.05) { r = lerp(r, 52, root * 0.8); g = lerp(g, 34, root * 0.8); b = lerp(b, 22, root * 0.8); }
        const s = light * band * (1 + n * 0.07) * (0.88 + 0.12 * smooth(0.05, 0.45, raw));
        soil.data[k] = r * s; soil.data[k + 1] = g * s; soil.data[k + 2] = b * s;
        // Bord net mais doux ; rebord plus clair la ou la terre devient mince.
        soil.data[k + 3] = raw <= 0.035 ? 0 : 255 * smooth(0.03, 0.14, raw + n * 0.03);
        if (P) {
          const pv = P[i], xv = X[i];
          if (xv > 0.3) {
            // Empreinte d'un bloc extrait : creux sombre, ombre interne.
            const sh = 1 - ((at(X, i + 2) - at(X, i - 2)) + (at(X, i + RW * 2) - at(X, i - RW * 2))) * 1.6;
            under.data[k] = 70 * sh; under.data[k + 1] = 50 * sh; under.data[k + 2] = 38 * sh;
            under.data[k + 3] = 230 * smooth(0.3, 0.6, xv);
          } else {
            // Bloc brut qui affleure : pierre grise en bosse.
            const sh = Math.max(0.6, Math.min(1.5, 1 + ((at(P, i + 2) - at(P, i - 2)) + (at(P, i + RW * 2) - at(P, i - RW * 2))) * 2.2));
            const c0 = (138 + m * 22 + n * 10) * sh;
            under.data[k] = c0; under.data[k + 1] = c0 * 0.97; under.data[k + 2] = c0 * 0.93;
            under.data[k + 3] = 255 * smooth(0.35, 0.55, pv);
          }
        }
      }
    }
    eng.soil.getContext("2d").putImageData(soil, 0, 0);
    if (P) eng.under.getContext("2d").putImageData(under, 0, 0);
  }
  // Fond de la tablette : pierre de la sorte choisie, gravee de signes.
  function tabletBg(kind, W, H, seed) {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), rnd = rng(seed);
    const pal = { clay: ["#e2c194", "#b68558", "#7a4e2c"], stone: ["#d3d6dc", "#9aa1ad", "#5b6270"], gold: ["#fdeeb4", "#dcae3c", "#8a6118"] }[kind] || ["#e2c194", "#b68558", "#7a4e2c"];
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, pal[0]); bg.addColorStop(1, pal[1]);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      const x = rnd() * W, y = rnd() * H, r = (0.05 + rnd() * 0.12) * W;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, rnd() < 0.5 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)"); rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
    // Lignes de signes en coins (gravure : creux sombre + levre claire).
    const rows = 7, lh = H / (rows + 1), u = lh * 0.22;
    for (let r = 1; r <= rows; r++) {
      let x = W * 0.06;
      const y = r * lh;
      g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(W * 0.04, y + lh * 0.42, W * 0.92, Math.max(1, H / 400));
      while (x < W * 0.94) {
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const a = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4][Math.floor(rnd() * 4)], len = u * (1.2 + rnd() * 1.4);
          const wedge = (dx, dy, color) => {
            g.save(); g.translate(x + dx, y + dy); g.rotate(a); g.fillStyle = color;
            g.beginPath(); g.moveTo(0, -u * 0.45); g.lineTo(u * 0.9, 0); g.lineTo(0, u * 0.45); g.closePath(); g.fill();
            g.fillRect(u * 0.6, -u * 0.08, len, u * 0.16); g.restore();
          };
          wedge(1, 1.2, "rgba(255,255,255,0.28)");
          wedge(0, 0, `rgba(40,24,10,${kind === "gold" ? 0.3 : 0.38})`);
          x += u * 1.3;
        }
        x += u * (1 + rnd() * 2);
      }
    }
    if (kind === "gold") {
      const sh = g.createLinearGradient(0, 0, W, H);
      sh.addColorStop(0, "rgba(255,255,255,0)"); sh.addColorStop(0.45, "rgba(255,250,220,0.35)"); sh.addColorStop(0.5, "rgba(255,255,255,0)"); sh.addColorStop(0.75, "rgba(255,250,220,0.2)"); sh.addColorStop(0.8, "rgba(255,255,255,0)");
      g.fillStyle = sh; g.fillRect(0, 0, W, H);
    }
    // Biseau du bord.
    g.lineWidth = W / 90;
    g.strokeStyle = "rgba(255,255,255,0.35)"; g.beginPath(); g.moveTo(0, H); g.lineTo(0, 0); g.lineTo(W, 0); g.stroke();
    g.strokeStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.moveTo(W, 0); g.lineTo(W, H); g.lineTo(0, H); g.stroke();
    return c;
  }
  // Cailloux (rouge) et racines (vert) de la terre, fixes pour la tablette.
  function decoMap(RW, RH, seed) {
    const c = document.createElement("canvas"); c.width = RW; c.height = RH;
    const g = c.getContext("2d"), rnd = rng(seed);
    g.globalCompositeOperation = "lighter";
    const nPeb = Math.round((RW * RH) / (RES * RES * 9));
    for (let i = 0; i < nPeb; i++) {
      const x = rnd() * RW, y = rnd() * RH, rx = RES * (0.1 + rnd() * rnd() * 0.32), ry = rx * (0.6 + rnd() * 0.4);
      const rg = g.createRadialGradient(x, y, 0, x, y, rx);
      rg.addColorStop(0, "rgba(255,0,0,0.85)"); rg.addColorStop(0.7, "rgba(255,0,0,0.6)"); rg.addColorStop(1, "rgba(255,0,0,0)");
      g.fillStyle = rg; g.beginPath(); g.ellipse(x, y, rx, ry, rnd() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = "rgba(0,255,0,0.9)"; g.lineCap = "round";
    for (let i = 0; i < Math.max(3, Math.round(RW / (RES * 4))); i++) {
      let x = rnd() * RW, y = rnd() * RH * 0.4, a = Math.PI / 2 + (rnd() - 0.5);
      g.lineWidth = RES * (0.08 + rnd() * 0.08);
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 8; s++) { a += (rnd() - 0.5) * 0.8; x += Math.cos(a) * RES * 0.9; y += Math.sin(a) * RES * 0.9; g.lineTo(x, y); }
      g.stroke();
    }
    const img = g.getImageData(0, 0, RW, RH).data, out = new Float32Array(RW * RH * 2);
    for (let i = 0; i < RW * RH; i++) { out[i * 2] = img[i * 4] / 255; out[i * 2 + 1] = img[i * 4 + 1] / 255; }
    return out;
  }
  // Particules : poussiere (pinceau, soufflet), miettes (grattoir), eclats (pioche).
  function spawn(p, t) {
    if (reduced() || eng.parts.length > 220) return;
    const c = Math.max(0, Math.min(eng.w * eng.h - 1, Math.floor(p.y * eng.h) * eng.w + Math.floor(p.x * eng.w)));
    const pal = eng.mask ? GANGUE : STRATA, col = strata(pal, eng.depth[c] + 0.3, [0, 0, 0]);
    const n = t === "pick" ? 4 : t === "scraper" ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const big = t === "pick";
      eng.parts.push({
        x: p.x, y: p.y, vx: (Math.random() - 0.5) * (big ? 0.012 : 0.004), vy: -(Math.random() * (big ? 0.012 : 0.004)) - 0.001,
        g: big || t === "scraper" ? 0.0006 : -0.00002, life: 0, max: big ? 34 : t === "scraper" ? 26 : 42,
        s: big ? 2.4 + Math.random() * 2.4 : t === "scraper" ? 1.4 + Math.random() : 1 + Math.random() * 1.6, dust: !big && t !== "scraper",
        c: `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`
      });
    }
  }
  function draw(time = 0) {
    const { ctx, cv } = eng;
    if (!ctx) return;
    if (eng.dirty) rebuild();
    const W = cv.width, H = cv.height, cw = W / eng.w, ch = H / eng.h;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (eng.mask) {
      // Atelier : tapis de travail eclaire, la trouvaille sous la gangue.
      const bg = ctx.createRadialGradient(W * 0.45, H * 0.4, 0, W / 2, H / 2, W * 0.75);
      bg.addColorStop(0, "#4b443d"); bg.addColorStop(1, "#1f1b18");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      const s = Math.min(W, H) * 0.66;
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = W / 40; ctx.shadowOffsetY = W / 120;
      if (eng.art && eng.art.complete && eng.art.naturalWidth) ctx.drawImage(eng.art, (W - s) / 2, (H - s) / 2, s, s);
      else if (eng.artIcon) { ctx.font = `${Math.round(s * 0.83)}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(eng.artIcon, W / 2, H / 2 + H * 0.03); }
      ctx.restore();
    } else {
      if (eng.bg) ctx.drawImage(eng.bg, 0, 0, W, H);
      ctx.drawImage(eng.under, 0, 0, W, H);
    }
    // Ombre portee de la terre sur ce qui est degage, puis la terre.
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = Math.max(4, W / 110); ctx.shadowOffsetX = W / 500; ctx.shadowOffsetY = W / 400; ctx.drawImage(eng.soil, 0, 0, W, H); ctx.restore();
    if (eng.mask) {
      // La zone qui compte (le coeur de la trouvaille), en pointilles discrets.
      ctx.save(); ctx.setLineDash([W / 60, W / 70]); ctx.lineWidth = Math.max(1.5, W / 260); ctx.strokeStyle = eng.fragileAll ? "rgba(248, 113, 113, 0.7)" : "rgba(253, 230, 138, 0.5)";
      ctx.beginPath(); ctx.ellipse(W / 2, H / 2, cw * 3.5, ch * 3.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    } else {
      // Quadrillage de fouille : ficelles tendues tous les 4 carres, reperes A-F / 1-4.
      ctx.save();
      ctx.lineWidth = Math.max(1, W / 700);
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? "rgba(246, 236, 210, 0.42)" : "rgba(0, 0, 0, 0.28)";
        const o = pass ? 0 : Math.max(1, W / 600);
        ctx.beginPath();
        for (let x = 4; x < eng.w; x += 4) { ctx.moveTo(x * cw + o, 0); ctx.lineTo(x * cw + o, H); }
        for (let y = 4; y < eng.h; y += 4) { ctx.moveTo(0, y * ch + o); ctx.lineTo(W, y * ch + o); }
        ctx.stroke();
      }
      ctx.font = `700 ${Math.max(9, Math.round(cw * 0.42))}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255, 248, 230, 0.7)"; ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 3;
      ctx.textBaseline = "top";
      for (let x = 0; x < eng.w / 4; x++) ctx.fillText(String.fromCharCode(65 + x), x * 4 * cw + cw * 0.25, ch * 0.18);
      for (let y = 1; y < eng.h / 4; y++) ctx.fillText(String(y + 1), cw * 0.25, y * 4 * ch + ch * 0.18);
      ctx.restore();
    }
    // Oeil exerce : contour rouge sur les parties a nu des pieces fragiles.
    if (!eng.mask && eng.fragile.size) {
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
      eng.glints.forEach((c, i) => {
        const a = 0.3 + 0.45 * Math.max(0, Math.sin(time / 420 + i * 1.7));
        const x = ((c % eng.w) + 0.5) * cw, y = (Math.floor(c / eng.w) + 0.5) * ch, r = Math.max(2, cw * 0.12);
        ctx.fillStyle = `rgba(255, 244, 200, ${a})`;
        ctx.beginPath(); ctx.moveTo(x, y - r * 2); ctx.lineTo(x + r * 0.5, y); ctx.lineTo(x, y + r * 2); ctx.lineTo(x - r * 0.5, y); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - r * 2, y); ctx.lineTo(x, y + r * 0.5); ctx.lineTo(x + r * 2, y); ctx.lineTo(x, y - r * 0.5); ctx.closePath(); ctx.fill();
      });
    }
    // Particules.
    if (eng.parts.length) {
      const dt = Math.min(3, Math.max(0.5, (time - (eng.lastT || time)) / 16.7));
      const k = W / 400;
      eng.parts = eng.parts.filter((q) => {
        q.life += dt; q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt;
        if (q.life > q.max) return false;
        const a = 1 - q.life / q.max;
        ctx.globalAlpha = q.dust ? a * 0.45 : a;
        ctx.fillStyle = q.c;
        if (q.dust) { ctx.beginPath(); ctx.arc(q.x * W, q.y * H, q.s * k * (1 + q.life / q.max), 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(q.x * W - q.s * k / 2, q.y * H - q.s * k / 2, q.s * k, q.s * k * 0.8);
        return true;
      });
      ctx.globalAlpha = 1;
    }
    eng.lastT = time;
    // Curseur : taille de l'outil, couleur de la pression.
    if (eng.hover && TOOLS[tool]) {
      const x = eng.hover.x * W, y = eng.hover.y * H, r = TOOLS[tool].r * cw;
      const lim = eng.fragileAll ? LIM.fragile : LIM.normal;
      const c = !eng.down ? "rgba(255,255,255,0.75)" : eng.pressure > lim ? "#ef4444" : eng.pressure > lim * 0.7 ? "#f59e0b" : "#4ade80";
      ctx.save();
      ctx.lineWidth = Math.max(1.5, W / 400);
      ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.beginPath(); ctx.arc(x + 1, y + 1, r, 0, Math.PI * 2); ctx.stroke();
      if (!eng.down) ctx.setLineDash([r / 3, r / 4]);
      ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, W / 500), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function loop(t) { draw(t); eng.raf = requestAnimationFrame(loop); }
  function mount(canvas, w, h, kind) {
    cancelAnimationFrame(eng.raf);
    eng.cv = canvas; eng.ctx = canvas.getContext("2d");
    eng.w = w; eng.h = h; eng.parts = []; eng.hover = null; eng.kind = kind || "clay";
    RES = eng.mask ? 16 : 12;
    const RW = w * RES, RH = h * RES, N = RW * RH;
    eng.soil = document.createElement("canvas"); eng.soil.width = RW; eng.soil.height = RH;
    eng.under = document.createElement("canvas"); eng.under.width = RW; eng.under.height = RH;
    eng.soilImg = eng.soil.getContext("2d").createImageData(RW, RH);
    eng.underImg = eng.under.getContext("2d").createImageData(RW, RH);
    ["bufD", "bufH", "bufP", "bufX", "bufT"].forEach((k) => { eng[k] = new Float32Array(N); });
    // Graine stable pour une tablette : memes cailloux et memes signes a chaque visite.
    const seed = Math.round((eng.hard || []).reduce((a, v, i) => a + v * (i + 7), 0) + w * 131 + h * 7 + (eng.mask ? eng.mask.size * 977 : (st && st.tablet ? st.tablet.total * 4099 + st.tablet.max : 1)));
    const rnd = rng(seed);
    eng.grain = fbm(RW, RH, [[2, 1], [5, 0.6]], rnd);
    eng.mott = fbm(RW, RH, [[RES * 3, 1], [RES, 0.5]], rnd);
    eng.deco = eng.mask ? null : decoMap(RW, RH, seed + 1);
    eng.bg = eng.mask ? null : tabletBg(eng.kind, RW * 2, RH * 2, seed + 2);
    eng.dirty = true;
    const fit = () => { const r = canvas.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); if (reduced()) draw(); };
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
      if (Math.random() < (tool === "pick" ? 0.7 : 0.45)) spawn(p, tool);
      gauges();
      if (reduced()) draw();
      // Paquets espaces (limite de debit de l'API) : toutes les 1,5 s, ou au lacher.
      if (!eng.timer) eng.timer = setTimeout(flush, 1500);
      if (eng.queue.length >= 200) flush();
    };
    // Creusage tout seul (corrige le 30/10) : le geste restait "appuye" apres un
    // clic droit (le menu contextuel avalait le lacher), un lacher hors de la
    // fenetre, une capture perdue ou une surface remplacee en plein geste.
    // Seul le bouton principal creuse, et un mouvement sans bouton enfonce
    // termine le geste.
    eng.down = false; eng.pressure = 0; eng.pointer = null;
    canvas.oncontextmenu = (e) => e.preventDefault();
    canvas.onpointerdown = (e) => {
      if (e.button !== 0 || (e.pointerType === "mouse" && !(e.buttons & 1))) return;
      e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      eng.down = true; eng.pointer = e.pointerId; eng.last = pos(e); eng.hover = eng.last; eng.speed = null; emit(eng.last, 0.5);
    };
    canvas.onpointermove = (e) => {
      if (eng.down && (e.pointerId !== eng.pointer || (e.pointerType === "mouse" && !(e.buttons & 1)))) { up(e); return; }
      const p = pos(e);
      if (e.pointerType === "mouse" || eng.down) eng.hover = p;
      if (!eng.down) { if (reduced()) draw(); return; }
      const l = eng.last;
      const dx = (p.x - l.x) * eng.w, dy = (p.y - l.y) * eng.h, dist = Math.hypot(dx, dy);
      if (dist < 0.5) return;
      // Vitesse lissee (2026-10-28) : un a-coup d'un evenement ne fait plus
      // flamber la jauge ; mesuree a l'ecran (une case de reference = 26 px,
      // celle d'une tablette sur ordinateur), le meme geste du doigt ne va plus
      // deux fois plus vite sur une petite tablette de telephone.
      const cellPx = canvas.getBoundingClientRect().width / eng.w;
      const raw = (dist * Math.min(1, cellPx / 26)) / Math.max(16, p.t - l.t) * 100;
      eng.speed = eng.speed == null ? raw : eng.speed * 0.6 + raw * 0.4;
      const speed = eng.speed;
      const n = Math.min(12, Math.floor(dist / 0.5));
      for (let i = 1; i <= n; i++) emit({ x: l.x + (p.x - l.x) * (i / n), y: l.y + (p.y - l.y) * (i / n) }, speed);
      eng.last = p;
    };
    function up(e) { if (e && e.pointerType !== "mouse") eng.hover = null; if (!eng.down) return; eng.down = false; eng.pointer = null; eng.pressure = 0; gauges(); flush(); }
    canvas.onpointerup = up; canvas.onpointercancel = up; canvas.onlostpointercapture = up;
    if (!eng.blurHooked) { eng.blurHooked = true; window.addEventListener("blur", () => { if (eng.down) { eng.down = false; eng.pointer = null; eng.pressure = 0; gauges(); flush(); } }); }
    canvas.onpointerleave = () => { if (!eng.down) eng.hover = null; };
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
    if (g) { const v = Math.min(2, eng.pressure) / 2; g.querySelector("span").style.width = `${Math.round(v * 100)}%`; const lim = eng.fragileAll ? LIM.fragile : LIM.normal; g.classList.toggle("red", eng.pressure > lim); g.classList.toggle("amber", eng.pressure > lim * 0.7 && eng.pressure <= lim); }
    const e = $("ar-energy");
    if (e && Number.isFinite(eng.energy)) {
      const pct = Math.round((eng.energy / eng.max) * 100);
      e.querySelector("span").style.width = `${pct}%`; e.classList.toggle("low", pct <= 15);
      $("ar-energy-n").textContent = Math.max(0, Math.round(eng.energy));
    }
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
    // Pistache le herisson et son rapport (companions.js).
    if (window.Companions) Companions.archeo(st);
    stop();
    if (!st.enabled) { box.innerHTML = '<p class="empty-state">L\'archéologie est fermée pour le moment.</p>'; return; }
    const nFinds = (st.finds || []).length;
    const lv = st.level || { level: 1, xp: 0, prev: 0, next: null, perks: {} };
    const pct = lv.next ? Math.round(((lv.xp - lv.prev) / (lv.next - lv.prev)) * 100) : 100;
    const stock = st.stock || [];
    box.innerHTML = `
      <div class="ar-top">
        <details class="ar-level">
          <summary>
            <span class="ar-level-badge" title="Niveau d'archéologue">${lv.level}</span>
            <span class="ar-level-main"><strong>Archéologue niv. ${lv.level}</strong><span class="ar-bar ar-xp"><span style="width:${pct}%"></span></span>
              <small>${lv.next ? `${lv.xp - lv.prev} / ${lv.next - lv.prev} XP${lv.nextPerk ? ` · une surprise t’attend plus loin` : ""}` : "Niveau maximum !"}</small></span>
            <span class="ar-level-more" aria-hidden="true">▾</span>
          </summary>
          <ul class="ar-perks">${Object.entries(lv.perks || {}).map(([n, txt]) => (lv.level >= Number(n) ? `<li class="on"><b>Nv ${n}</b> ${esc(txt)}</li>` : `<li><b>Nv ${n}</b> &#10067; À découvrir</li>`)).join("")}</ul>
          <p class="muted">XP : 3 par bloc extrait (+5 si la tablette est parfaite), puis 5 / 4 / 2 / 1 par trouvaille libérée intacte / rayée / fissurée / cassée. ×1,5 pour la pierre gravée, ×2 pour la tablette dorée.</p>
        </details>
        <div class="ar-stock" title="Tablettes en réserve">${stock.length ? stock.map((k) => `<span class="ar-stock-kind ${k.count ? "" : "none"}" style="--kc:${KIND_FX[k.kind] || "#b07a4c"}" title="${esc(k.label)}"><span class="ar-mini-tab ${k.kind}" aria-hidden="true"></span><b>${k.count}</b></span>`).join("") : `<span class="ar-stock-kind"><span class="ar-mini-tab clay" aria-hidden="true"></span><b>${st.tablets}</b></span>`}
          <small>${st.done ? `${st.done} fouillée${st.done > 1 ? "s" : ""}` : ""}${st.freedTotal ? ` · ${st.freedTotal} trouvaille${st.freedTotal > 1 ? "s" : ""}` : ""}</small></div>
        <nav class="tabs ar-modes" role="tablist">
          <button type="button" role="tab" class="tab ${mode === "dig" ? "active" : ""}" aria-selected="${mode === "dig"}" data-mode="dig">⛏️ 1. Extraction${st.tablet ? ` <span class="ar-count live" title="Tablette en cours">●</span>` : ""}</button>
          <button type="button" role="tab" class="tab ${mode === "clean" ? "active" : ""}" aria-selected="${mode === "clean"}" data-mode="clean">🧽 2. Atelier${nFinds ? ` <span class="ar-count">${nFinds}</span>` : ""}</button>
        </nav>
      </div>
      <div id="ar-body"></div>`;
    if (mode === "dig") renderDig(); else if (work) renderWork(); else renderShelf();
  }
  function toolBar(fragileAll = false) {
    const keys = Object.keys(TOOL_UI).filter((k) => TOOLS[k]);
    return `<div class="ar-toolbar">
      <div class="ar-tools-dock" role="radiogroup" aria-label="Outil">${keys.map((k, i) => { const t = TOOL_UI[k]; return `<button type="button" role="radio" class="ar-tool-btn ${tool === k ? "on" : ""}" data-tool="${k}" aria-checked="${tool === k}" title="${t.sub} (touche ${i + 1})"><span class="ar-tool-ico" aria-hidden="true">${t.icon}</span><span class="ar-tool-txt"><b>${t.label}</b><small>${t.sub.split(" · ")[0]}</small></span><kbd>${i + 1}</kbd></button>`; }).join("")}</div>
      <div class="ar-gauge" title="Pression : dureté de l'outil × vitesse du geste. Dans le rouge sur une trouvaille à nu, elle s'abîme. Le cercle du curseur prend la même couleur."><small>Pression</small><div class="ar-bar ar-pressure" id="ar-pressure"><span></span><i class="ar-mark" style="left:${(fragileAll ? LIM.fragile : LIM.normal) / 2 * 100}%"></i></div></div>
    </div>`;
  }
  const kindOf = (k) => (st.stock || []).find((x) => x.kind === k);

  // ------------------------------------------------------------------ 1. extraction
  function renderDig() {
    const body = $("ar-body");
    const t = st.tablet;
    if (!t) {
      const stock = st.stock || [];
      body.innerHTML = `<div class="ar-empty">
        <p>${st.tablets ? "Choisis une tablette puis gratte la terre à la souris ou au doigt : les blocs bruts (gris) affleurent au fil du geste. Un bloc dégagé aux trois quarts est <strong>extrait</strong>, à nettoyer ensuite à l'atelier pour découvrir ce que c'est." : "Termine des grilles de fouille (ou laisse Milo le faire) : il y a des tablettes anciennes enfouies dans la terre. Plus tu creuses profond, plus les belles tablettes sont fréquentes."}</p>
        <div class="ar-kinds">${stock.map((k) => `<button type="button" class="ar-kind ${k.kind} ${k.count ? "" : "none"}" data-start="${k.kind}" ${k.count ? "" : "disabled"} style="--kc:${KIND_FX[k.kind] || "#b07a4c"}">
            <span class="ar-kind-tab ${k.kind}" aria-hidden="true"><i></i><i></i><i></i></span>
            <strong>${esc(k.label)}</strong><small class="ar-kind-rar">${esc(k.rarity)}</small>
            <span class="ar-kind-n">×${k.count}</span>
            <small>${esc(k.hint)}</small>
            <small class="muted">Jusqu'au palier ${k.maxTier}</small>
          </button>`).join("")}</div>
        ${(st.finds || []).length ? `<button type="button" class="btn-secondary" data-mode="clean">🧽 ${st.finds.length} bloc${st.finds.length > 1 ? "s" : ""} t'attend${st.finds.length > 1 ? "ent" : ""} à l'atelier</button>` : ""}</div>`;
      return;
    }
    const kindInfo = kindOf(t.kind);
    const hasRock = Array.isArray(t.hard) && t.hard.some(Boolean);
    const pips = (n, of) => Array.from({ length: of }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("");
    body.innerHTML = `
      <div class="ar-dig-head">
        <div class="ar-tablet-title" style="--kc:${KIND_FX[t.kind] || "#b07a4c"}"><span class="ar-mini-tab ${t.kind}" aria-hidden="true"></span><strong>${esc(t.label || (kindInfo && kindInfo.label) || "Tablette")}</strong>${hasRock ? ` <small>· veines grises = roche dure : pioche ou grattoir</small>` : ""}</div>
        <button type="button" class="btn-ghost" id="ar-finish">Ranger la tablette</button>
      </div>
      ${toolBar()}
      <div class="ar-slab ${t.kind}"><canvas class="ar-canvas" id="ar-cv" style="aspect-ratio:${t.w} / ${t.h}" aria-label="Tablette à gratter"></canvas></div>
      <div class="ar-foot">
        <div class="ar-gauge"><small>Endurance</small><div class="ar-bar ar-energy" id="ar-energy"><span style="width:${Math.round((t.energy / t.max) * 100)}%"></span></div><strong id="ar-energy-n">${t.energy}</strong></div>
        <div class="ar-blocks" id="ar-count-txt" title="Blocs extraits"><span class="ar-pips">${pips(t.extracted.length, t.total)}</span><span>${t.extracted.length}/${t.total} extrait${t.total > 1 ? "s" : ""}</span></div>
        <small class="muted ar-legend">✨ presque à nu · ▢ creux = déjà extrait</small>
      </div>`;
    Object.assign(eng, { depth: t.depth.slice(), hard: hasRock ? t.hard : null, fragile: new Set(t.fragile || []), fragileAll: false, energy: t.energy, max: t.max, peek: new Set(t.peek), glints: t.glints, extracted: t.extracted, mask: null, art: null, artIcon: null, warned: false });
    eng.send = (pts) => API.archeo(Session.userId, "scrape", { pts });
    eng.after = (res) => {
      if (res.hurt) Toast.error("💥 Trop brusque : une trouvaille a pris un coup.");
      if (res.finished) { if (settled()) digResult(res); else setTimeout(() => digResult(res), 600); return; }
      st = res;
      const t2 = res.tablet;
      eng.peek = new Set(t2.peek); eng.glints = t2.glints; eng.extracted = t2.extracted; eng.fragile = new Set(t2.fragile || []); eng.dirty = true;
      if (settled()) { eng.depth = t2.depth.slice(); eng.energy = t2.energy; eng.dirty = true; gauges(); }
      if (res.fresh) { Toast.success(`🪨 ${res.fresh > 1 ? res.fresh + " blocs extraits" : "Un bloc extrait"} ! À nettoyer à l'atelier.`); tone(660, 0.18, "triangle", 0.05); }
      const c = $("ar-count-txt"); if (c) c.innerHTML = `<span class="ar-pips">${pips(t2.extracted.length, t2.total)}</span><span>${t2.extracted.length}/${t2.total} extrait${t2.total > 1 ? "s" : ""}</span>`;
    };
    mount($("ar-cv"), t.w, t.h, t.kind);
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
  // Les blocs deja entames d'abord, puis ceux qui brillent.
  const shelfOrder = (finds) => finds.slice().sort((a, b) => (b.progress > 0) - (a.progress > 0) || b.shiny - a.shiny || b.size - a.size);
  function renderShelf() {
    const body = $("ar-body");
    const finds = shelfOrder(st.finds || []);
    body.innerHTML = finds.length ? `
      <p class="muted ar-shelf-lead">Choisis un bloc brut et gratte sa gangue : la trouvaille apparaît dessous. Elle est <strong>libérée</strong> quand son cœur est à nu.</p>
      <div class="ar-shelf">${finds.map((f) => `<button type="button" class="ar-rock ${f.shiny ? "shiny" : ""} ${f.state} from-${f.from || "clay"}" data-find="${f.id}" style="--s:${Math.min(4, f.size)};--p:${f.progress || 0}">
          <span class="ar-rock-stone" aria-hidden="true">${f.progress ? `<span class="ar-rock-ring"></span>` : ""}</span>
          <small>${f.size >= 3 ? "Gros bloc" : f.size === 2 ? "Bloc moyen" : "Petit bloc"}${f.shiny ? " · ça brille…" : ""}</small>
          <em class="ar-rock-from">${f.from === "gold" ? "🟨 doré" : f.from === "stone" ? "🪨 pierre gravée" : "🟫 argile"}</em>
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
      <div class="ar-work-head"><button type="button" class="btn-ghost" id="ar-back">← L'atelier</button><span class="ar-state ${w.state}" id="ar-state">${STATE[w.state][1]} ${STATE[w.state][0]}</span>
        <div class="ar-gauge ar-prog-g"><small>Cœur à nu</small><div class="ar-bar ar-prog"><span id="ar-prog-bar" style="width:${w.progress}%"></span></div><strong id="ar-prog">${w.progress} %</strong></div></div>
      ${toolBar(!!w.fragile)}
      <div class="ar-stone from-${w.from || "clay"}"><canvas class="ar-canvas" id="ar-cv" style="aspect-ratio:1" aria-label="Bloc brut à nettoyer"></canvas></div>
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
      const p = $("ar-prog"); if (p) p.textContent = `${work.progress} %`;
      const pb = $("ar-prog-bar"); if (pb) pb.style.width = `${work.progress}%`;
    };
    mount($("ar-cv"), w.g, w.g, w.from);
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
      const next = shelfOrder(st.finds || [])[0];
      render();
      $("ar-body").insertAdjacentHTML("afterbegin", `<div class="ar-result ar-freed ${f.state}">
        <div class="ar-freed-art">${f.img ? `<img src="assets/${encodeURI(f.img)}" alt="" />` : `<span>${f.icon || "🏺"}</span>`}</div>
        <h3>${f.state === "broken" ? "💔 Cassé…" : "✨ Libéré !"} ${esc(f.name)}</h3>
        <p>${STATE[f.state][1]} ${STATE[f.state][0]} · ${reward}${f.reward && f.state !== "broken" ? ` : ${esc(f.reward)}` : ""}${f.tier ? ` · palier ${f.tier}` : ""}${f.xp ? ` · +${f.xp} XP` : ""}</p>
        ${levelUpHtml(f.levelUp)}
        ${next ? `<button type="button" class="btn" data-find="${next.id}">Bloc suivant →</button>` : `<button type="button" class="btn-secondary" data-mode="dig">⛏️ Retour à l'extraction</button>`}
      </div>`);
    }, reduced() ? 0 : 700);
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  }

  async function load() {
    try { st = await API.archeo(Session.userId, "status", { takeReport: true }); } catch (e) { st = null; $("archeo-zone").innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`; return; }
    if (st.tools) TOOLS = st.tools;
    if (!TOOLS[tool]) tool = "brush";
    if (st.bare != null) BARE = st.bare;
    if (st.limits) LIM = st.limits;
    if (work && !(st.finds || []).some((f) => f.id === work.id)) work = null;
    render();
  }
  function pickTool(k) {
    if (!TOOLS[k]) return;
    tool = k;
    try { localStorage.setItem(TOOL_KEY, k); } catch (e) { /* stockage indisponible */ }
    document.querySelectorAll("#archeo-zone [data-tool]").forEach((b) => { const on = b.dataset.tool === k; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
    tone(500, 0.03);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const zone = $("archeo-zone");
    if (!zone) return;
    zone.addEventListener("click", async (e) => {
      const m = e.target.closest("[data-mode]");
      if (m) { await flush(); mode = m.dataset.mode; work = null; render(); return; }
      const tb = e.target.closest("[data-tool]");
      if (tb) { pickTool(tb.dataset.tool); return; }
      const rock = e.target.closest("[data-find]");
      if (rock) { mode = "clean"; openWork(rock.dataset.find); return; }
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
    // Raccourcis : 1-5 pour les outils, tant qu'une surface a gratter est affichee.
    document.addEventListener("keydown", (e) => {
      if (!eng.ctx || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) return;
      const keys = Object.keys(TOOL_UI).filter((k) => TOOLS[k]);
      const i = Number(e.key) - 1;
      if (i >= 0 && i < keys.length && zone.offsetParent) { pickTool(keys[i]); e.preventDefault(); }
    });
    // Onglet cache ou page quittee : on envoie le geste en attente.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  });

  window.loadArcheo = load;
})();
