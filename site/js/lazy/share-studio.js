// Module charge a la demande : bouton « Partager » de la fenetre de carte
// (card-extras.js), du recap de la semaine (home-recap.js) et du profil
// (profile.html).
// Studio de partage (2026-10-21) : images dessinees dans l'univers du site
// (fond etoile aux couleurs du theme / du mode / de la saison, capsules de
// gacha, rayons de rarete, carte avec cadre, finition, etat, edition et
// numero), en trois formats : publication (1080 x 1350), story (1080 x 1920)
// et carre (1080 x 1080). Partager (telephone), telecharger, copier, et pour
// une carte possedee : publier sur le Discord de l'asso (POST share-card).

const ShareStudio = (function () {
  const esc = escHtml;
  const FORMATS = { post: { w: 1080, h: 1350, label: "Publication" }, story: { w: 1080, h: 1920, label: "Story" }, square: { w: 1080, h: 1080, label: "Carré" } };
  const FINISH = { normal: "Normale", holo: "Holo", gold: "Dorée", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const QUALITY = { damaged: "Usé", worn: "Abîmé", good: "Bon état", mint: "Parfait état" };
  const RAINBOW = ["#ff5aaa", "#ffbe46", "#6ee682", "#46beff", "#aa6eff"];
  const SANS = "Inter, 'Segoe UI', system-ui, sans-serif";
  const BRAND = "Bungee, 'Segoe UI', system-ui, sans-serif";

  // ------------------------------------------------------------ outils
  function palette() {
    const css = getComputedStyle(document.documentElement);
    const v = (n, d) => css.getPropertyValue(n).trim() || d;
    return { void: v("--bg-void", "#06070f"), deep: v("--bg-deep", "#0d0f22"), panel: v("--bg-panel-solid", "#14162e"), a1: v("--accent", "#8b5cf6"), a2: v("--accent-2", "#22d3ee"), a3: v("--accent-3", "#f472b6"), text: "#ffffff", dim: "rgba(255,255,255,0.68)" };
  }
  function editionColor(ed) {
    const el = document.createElement("div");
    el.className = "card-modal";
    el.dataset.edition = ed;
    el.style.cssText = "position:absolute;visibility:hidden;width:0;height:0;animation:none";
    document.body.appendChild(el);
    const c = getComputedStyle(el).getPropertyValue("--ed").trim();
    el.remove();
    return c || "#e9d5ff";
  }
  // Generateur pseudo-aleatoire a graine : le meme partage donne la meme image.
  function rng(seed) {
    let s = 0;
    for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    s = s || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  const loadImg = (src) => new Promise((res, rej) => {
    if (!src) { rej(new Error("no src")); return; }
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
  const tryImg = (src) => loadImg(src).catch(() => null);
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function shade(hex, k) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))));
    return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
  }
  function alpha(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  function fitText(g, text, maxW, size, weight, family) {
    let s = size;
    g.font = `${weight} ${s}px ${family}`;
    while (s > 14 && g.measureText(text).width > maxW) { s -= 2; g.font = `${weight} ${s}px ${family}`; }
    return s;
  }
  function sparkle(g, x, y, r, color, a = 1) {
    g.save();
    g.globalAlpha *= a;
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = r * 1.5;
    g.beginPath();
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x + r * 0.16, y - r * 0.16, x + r, y);
    g.quadraticCurveTo(x + r * 0.16, y + r * 0.16, x, y + r);
    g.quadraticCurveTo(x - r * 0.16, y + r * 0.16, x - r, y);
    g.quadraticCurveTo(x - r * 0.16, y - r * 0.16, x, y - r);
    g.fill();
    g.restore();
  }
  // Capsule de gacha (demi-sphere coloree + demi-sphere nacree + bande).
  function capsule(g, x, y, r, c1, c2, a) {
    g.save();
    g.globalAlpha = a;
    g.translate(x, y);
    const top = g.createLinearGradient(-r, -r, r, 0);
    top.addColorStop(0, shade(c1, 0.35)); top.addColorStop(1, c2);
    g.fillStyle = top;
    g.beginPath(); g.arc(0, 0, r, Math.PI, 0); g.closePath(); g.fill();
    g.fillStyle = "rgba(240,240,255,0.85)";
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI); g.closePath(); g.fill();
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.fillRect(-r, -r * 0.09, r * 2, r * 0.18);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.beginPath(); g.ellipse(-r * 0.38, -r * 0.5, r * 0.32, r * 0.16, -0.5, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // ------------------------------------------------------------ decor
  function background(g, W, H, pal, glow, seed) {
    const R = rng(seed);
    g.fillStyle = pal.void;
    g.fillRect(0, 0, W, H);
    const blob = (x, y, r, c, a) => { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, alpha(c, a)); rg.addColorStop(1, alpha(c, 0)); g.fillStyle = rg; g.fillRect(0, 0, W, H); };
    blob(W * 0.12, H * 0.08, W * 0.85, pal.a1, 0.55);
    blob(W * 0.95, H * 0.95, W * 0.9, pal.a2, 0.42);
    blob(W * 0.85, H * 0.18, W * 0.45, pal.a3, 0.2);
    if (glow) blob(W / 2, H * 0.48, W * 0.7, glow, 0.38);
    // Quadrillage tres fin (effet « salle d'arcade »).
    g.save();
    g.globalAlpha = 0.05;
    g.strokeStyle = "#ffffff";
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 54) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += 54) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.restore();
    // Capsules flottantes.
    for (let i = 0; i < 9; i++) {
      const r = 22 + R() * 46;
      capsule(g, R() * W, R() * H, r, [pal.a1, pal.a2, pal.a3][i % 3], [pal.a2, pal.a3, pal.a1][i % 3], 0.07 + R() * 0.08);
    }
    // Etoiles et etincelles.
    for (let i = 0; i < 240; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + R() * 0.6})`;
      const s = R() < 0.9 ? 0.6 + R() * 1.4 : 2 + R() * 1.6;
      g.beginPath(); g.arc(R() * W, R() * H, s, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 14; i++) sparkle(g, R() * W, R() * H, 6 + R() * 14, i % 2 ? "#fde68a" : "#e0f2fe", 0.55 + R() * 0.4);
    // Vignette.
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }
  function rays(g, cx, cy, R, color, n = 18, a = 0.18) {
    g.save();
    g.translate(cx, cy);
    for (let i = 0; i < n; i++) {
      g.rotate((Math.PI * 2) / n);
      const lg = g.createLinearGradient(0, 0, R, 0);
      lg.addColorStop(0, alpha(color, a)); lg.addColorStop(1, alpha(color, 0));
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(R, -R * 0.07); g.lineTo(R, R * 0.07); g.closePath(); g.fill();
    }
    g.restore();
  }
  function brand(g, x, y, size, pal, align = "center") {
    g.save();
    g.font = `400 ${size}px ${BRAND}`;
    g.textAlign = align;
    g.textBaseline = "alphabetic";
    const w = g.measureText("2GATCHA").width;
    const x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    const lg = g.createLinearGradient(x0, 0, x0 + w, 0);
    lg.addColorStop(0, shade(pal.a1, 0.35)); lg.addColorStop(0.55, shade(pal.a2, 0.25)); lg.addColorStop(1, shade(pal.a3, 0.3));
    g.shadowColor = alpha(pal.a1, 0.9);
    g.shadowBlur = size * 0.5;
    g.fillStyle = lg;
    g.fillText("2GATCHA", x, y);
    g.shadowBlur = 0;
    g.lineWidth = Math.max(1, size / 26);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.strokeText("2GATCHA", x, y);
    g.restore();
    capsule(g, x0 - size * 0.62, y - size * 0.36, size * 0.36, pal.a1, pal.a2, 0.95);
  }
  function chip(g, text, x, y, color, { size = 26, fill = 0.18, align = "left" } = {}) {
    g.save();
    g.font = `700 ${size}px ${SANS}`;
    const w = g.measureText(text).width + size * 1.2, h = size * 1.7;
    const x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    rr(g, x0, y, w, h, h / 2);
    g.fillStyle = alpha(color, fill);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = alpha(color, 0.75);
    g.stroke();
    g.fillStyle = "#fff";
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillText(text, x0 + size * 0.6, y + h / 2 + 1);
    g.restore();
    return w;
  }
  function chipsRow(g, items, cx, y, size) {
    g.save();
    g.font = `700 ${size}px ${SANS}`;
    const gap = size * 0.6;
    const widths = items.map(([t]) => g.measureText(t).width + size * 1.2);
    const total = widths.reduce((s, w) => s + w, 0) + gap * (items.length - 1);
    g.restore();
    let x = cx - total / 2;
    items.forEach(([t, c], i) => { chip(g, t, x, y, c, { size }); x += widths[i] + gap; });
  }
  function footer(g, W, H, pal, text) {
    g.save();
    g.textAlign = "center";
    g.fillStyle = pal.dim;
    g.font = `600 26px ${SANS}`;
    g.fillText(text || "Collection d'art de l'asso 2GETHER", W / 2, H - 52);
    g.fillStyle = alpha(pal.a2, 0.55);
    g.fillRect(W / 2 - 60, H - 96, 120, 3);
    g.restore();
  }

  // ------------------------------------------------------------ la carte
  // Carte dessinee a l'origine (0,0) : largeur w, hauteur w * 1.4.
  function drawCard(g, w, c, img, opt = {}) {
    const h = w * 1.4, R = w * 0.06;
    const col = (c.rarity && c.rarity.colorHex) || "#8b5cf6";
    const finish = opt.finish || "normal";
    const rand = rng((c.cardId || c.name) + finish);
    // Lueur et ombre portee.
    g.save();
    g.shadowColor = alpha(col, 0.85);
    g.shadowBlur = w * 0.14;
    rr(g, 0, 0, w, h, R);
    g.fillStyle = col;
    g.fill();
    g.restore();
    // Cadre metallique.
    const frame = g.createLinearGradient(0, 0, w, h);
    if (finish === "rainbow") RAINBOW.forEach((cc, i) => frame.addColorStop(i / (RAINBOW.length - 1), cc));
    else if (finish === "gold") { frame.addColorStop(0, "#fff3c4"); frame.addColorStop(0.45, "#f5b82e"); frame.addColorStop(1, "#9a5b0c"); }
    else { frame.addColorStop(0, shade(col, 0.55)); frame.addColorStop(0.5, col); frame.addColorStop(1, shade(col, -0.45)); }
    rr(g, 0, 0, w, h, R);
    g.fillStyle = frame;
    g.fill();
    rr(g, w * 0.012, w * 0.012, w * 0.976, h - w * 0.024, R * 0.85);
    g.lineWidth = Math.max(1, w * 0.005);
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.stroke();
    // Corps sombre.
    const pad = w * 0.045;
    rr(g, pad, pad, w - pad * 2, h - pad * 2, R * 0.7);
    const body = g.createLinearGradient(0, 0, 0, h);
    body.addColorStop(0, "#151832"); body.addColorStop(1, "#0a0b19");
    g.fillStyle = body;
    g.fill();
    // Illustration.
    const ax = pad * 1.5, ay = pad * 1.5, aw = w - pad * 3, ah = aw * 1.08;
    g.save();
    rr(g, ax, ay, aw, ah, R * 0.45);
    g.clip();
    if (img) {
      const r = Math.max(aw / img.width, ah / img.height), sw = aw / r, sh = ah / r;
      const q = { damaged: "saturate(0.45) sepia(0.25) brightness(0.86)", worn: "saturate(0.7) brightness(0.94)", mint: "saturate(1.08) contrast(1.05)" }[opt.quality] || "";
      const f = { gold: "sepia(0.45) saturate(1.6)", ghost: "grayscale(0.55) brightness(1.2)", diamond: "saturate(0.8) contrast(1.15) brightness(1.08)", holo: "saturate(1.25)", rainbow: "saturate(1.3)" }[finish] || "";
      g.filter = (q + " " + f).trim() || "none";
      g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, ax, ay, aw, ah);
      g.filter = "none";
    } else {
      const ph = g.createLinearGradient(ax, ay, ax + aw, ay + ah);
      ph.addColorStop(0, shade(col, -0.3)); ph.addColorStop(1, "#111");
      g.fillStyle = ph;
      g.fillRect(ax, ay, aw, ah);
    }
    // Finitions.
    const sheen = (stops, a, op = "overlay") => {
      g.globalCompositeOperation = op;
      g.globalAlpha = a;
      const lg = g.createLinearGradient(ax, ay, ax + aw, ay + ah);
      stops.forEach((s, i) => lg.addColorStop(i / (stops.length - 1), s));
      g.fillStyle = lg;
      g.fillRect(ax, ay, aw, ah);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    };
    if (finish === "holo") { sheen(["#ff3cb4", "#3cc8ff", "#ffe03c", "#3cff9c", "#a05aff", "#ff3cb4"], 0.55); sheen(["#ffffff00", "#ffffff", "#ffffff00"], 0.18, "screen"); }
    if (finish === "gold") sheen(["#fff1b0", "#c88a14", "#ffe9a0", "#a8700c"], 0.4, "soft-light");
    if (finish === "ghost") sheen(["#ffffff", "#c7d2fe", "#ffffff"], 0.35, "screen");
    if (finish === "rainbow") sheen(RAINBOW.concat(RAINBOW[0]), 0.45);
    if (finish === "diamond") {
      sheen(["#bae6fd", "#2896f5", "#e0f2fe"], 0.3, "soft-light");
      g.globalCompositeOperation = "screen";
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(186, 230, 253, ${0.08 + rand() * 0.16})`;
        const x = ax + rand() * aw, y = ay + rand() * ah, s = aw * (0.06 + rand() * 0.12);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + s * 0.3); g.lineTo(x + s * 0.4, y + s); g.closePath(); g.fill();
      }
      g.globalCompositeOperation = "source-over";
      for (let i = 0; i < 6; i++) sparkle(g, ax + rand() * aw, ay + rand() * ah, aw * (0.02 + rand() * 0.03), "#ffffff", 0.9);
    }
    // Reflet de vitre.
    const glare = g.createLinearGradient(ax, ay, ax + aw, ay + ah);
    glare.addColorStop(0, "rgba(255,255,255,0)"); glare.addColorStop(0.38, "rgba(255,255,255,0)"); glare.addColorStop(0.47, "rgba(255,255,255,0.22)"); glare.addColorStop(0.53, "rgba(255,255,255,0)");
    g.fillStyle = glare;
    g.fillRect(ax, ay, aw, ah);
    // Usure.
    if (opt.quality === "damaged" || opt.quality === "worn") {
      g.strokeStyle = "rgba(255,255,255,0.45)";
      g.lineWidth = Math.max(1, w * 0.0025);
      for (let i = 0; i < (opt.quality === "damaged" ? 34 : 14); i++) {
        const x = ax + rand() * aw, y = ay + rand() * ah, l = aw * (0.03 + rand() * 0.08), a = (rand() < 0.5 ? 58 : -32) * Math.PI / 180;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
    }
    g.restore();
    rr(g, ax, ay, aw, ah, R * 0.45);
    g.lineWidth = Math.max(1, w * 0.006);
    g.strokeStyle = opt.quality === "mint" ? "rgba(224,242,254,0.95)" : alpha(col, 0.9);
    g.stroke();
    // Edition : bandeau en coin.
    if (opt.edition && EDITIONS[opt.edition]) {
      const ec = editionColor(opt.edition);
      g.save();
      rr(g, ax, ay, aw, ah, R * 0.45);
      g.clip();
      g.translate(ax + aw, ay);
      g.rotate(Math.PI / 4);
      g.fillStyle = ec;
      g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 8;
      g.fillRect(-aw * 0.6, aw * 0.17, aw * 1.2, aw * 0.09);
      g.shadowBlur = 0;
      g.fillStyle = "#111";
      g.textAlign = "center"; g.textBaseline = "middle";
      fitText(g, EDITIONS[opt.edition].label.toUpperCase(), aw * 0.36, Math.round(aw * 0.045), 800, SANS);
      g.fillText(EDITIONS[opt.edition].label.toUpperCase(), 0, aw * 0.215);
      g.restore();
    }
    // Numero d'exemplaire.
    if (opt.serial) {
      const t = "#" + String(opt.serial).padStart(3, "0");
      g.save();
      g.font = `800 ${Math.round(w * 0.045)}px ${SANS}`;
      const tw = g.measureText(t).width + w * 0.04, th = w * 0.07;
      rr(g, ax + w * 0.02, ay + ah - th - w * 0.02, tw, th, th / 2);
      g.fillStyle = opt.serial === 1 ? "#fbbf24" : "rgba(6,7,15,0.82)";
      g.fill();
      g.fillStyle = opt.serial === 1 ? "#111" : "#fff";
      g.textBaseline = "middle";
      g.fillText(t, ax + w * 0.04, ay + ah - th / 2 - w * 0.02 + 1);
      g.restore();
    }
    // Plaque : nom, rarete, extension, numero.
    const py = ay + ah + w * 0.03;
    g.save();
    g.textAlign = "center";
    g.fillStyle = "#fff";
    fitText(g, c.name || "", aw * 0.94, Math.round(w * 0.075), 800, SANS);
    g.fillText(c.name || "", w / 2, py + w * 0.075);
    // Gemme de rarete.
    const gy = py + w * 0.135, gs = w * 0.03;
    g.font = `700 ${Math.round(w * 0.043)}px ${SANS}`;
    const rname = (c.rarity && c.rarity.name) || "";
    const rw = g.measureText(rname).width;
    const gx = w / 2 - rw / 2 - gs * 1.6;
    g.fillStyle = col;
    g.shadowColor = col; g.shadowBlur = gs;
    g.beginPath(); g.moveTo(gx, gy - gs); g.lineTo(gx + gs * 0.8, gy); g.lineTo(gx, gy + gs); g.lineTo(gx - gs * 0.8, gy); g.closePath(); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = shade(col, 0.45);
    g.textBaseline = "middle";
    g.fillText(rname, w / 2 + gs * 0.6, gy + 1);
    g.textBaseline = "alphabetic";
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.font = `600 ${Math.round(w * 0.034)}px ${SANS}`;
    const sub = [c.extension && c.extension.name, opt.number ? "N° " + String(opt.number).padStart(3, "0") : ""].filter(Boolean).join("  ·  ");
    if (sub) g.fillText(sub, w / 2, h - pad * 2.1);
    g.restore();
  }
  // Carte inclinee, centree en (cx, cy).
  function placeCard(g, cx, cy, w, angle, c, img, opt) {
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    g.translate(-w / 2, -w * 0.7);
    drawCard(g, w, c, img, opt);
    g.restore();
  }

  // ------------------------------------------------------------ gabarits
  async function renderCard(fmt, o, pal) {
    const { w: W, h: H } = FORMATS[fmt];
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const c = o.card;
    const col = (c.rarity && c.rarity.colorHex) || pal.a1;
    const tier = (c.rarity && c.rarity.sortOrder) || 0;
    const img = await tryImg(API.imageUrl(c.imageId));
    background(g, W, H, pal, col, "card" + c.cardId + fmt);
    const opt = { finish: o.finish, quality: o.quality, edition: o.edition, serial: o.serial, number: o.number };
    const bits = [[(c.rarity && c.rarity.name) || "Commune", col]];
    if (o.finish && o.finish !== "normal") bits.push([FINISH[o.finish] || o.finish, o.finish === "gold" ? "#fbbf24" : pal.a2]);
    if (o.quality) bits.push([QUALITY[o.quality] || o.quality, "#94a3b8"]);
    if (o.edition && EDITIONS[o.edition]) bits.push([`Édition ${EDITIONS[o.edition].label}`, editionColor(o.edition)]);
    const owner = Session.pseudo ? `Dans la collection de ${Session.pseudo}` : "";
    if (fmt === "square") {
      const cw = 470;
      rays(g, 330, 560, 640, col, 20, tier >= 3 ? 0.22 : 0.12);
      placeCard(g, 330, 560, cw, -0.06, c, img, opt);
      brand(g, 1030, 120, 58, pal, "right");
      g.save();
      g.textAlign = "left";
      g.fillStyle = "#fff";
      const ns = fitText(g, c.name, 400, 64, 800, SANS);
      g.fillText(c.name, 610, 330);
      g.fillStyle = pal.dim;
      g.font = `600 28px ${SANS}`;
      if (c.artist) g.fillText(`Illustration : ${c.artist}`, 610, 330 + ns * 0.85);
      g.restore();
      let y = 430;
      bits.forEach(([t, cc]) => { chip(g, t, 610, y, cc, { size: 28 }); y += 66; });
      if (owner) { g.save(); g.fillStyle = pal.dim; fitText(g, owner, 430, 28, 600, SANS); g.fillText(owner, 610, y + 40); g.restore(); }
      footer(g, W, H, pal);
      return cv;
    }
    const story = fmt === "story";
    const cw = story ? 760 : 560;
    const cy = story ? 930 : 650;
    brand(g, W / 2 + 30, story ? 230 : 140, story ? 92 : 76, pal);
    if (story) { g.save(); g.textAlign = "center"; g.fillStyle = pal.dim; g.font = `600 34px ${SANS}`; g.fillText("Une carte de ma collection", W / 2, 300); g.restore(); }
    rays(g, W / 2, cy, story ? 900 : 760, col, 22, tier >= 3 ? 0.24 : 0.12);
    // Halo au sol.
    const fl = g.createRadialGradient(W / 2, cy + cw * 0.72, 0, W / 2, cy + cw * 0.72, cw * 0.7);
    fl.addColorStop(0, alpha(col, 0.45)); fl.addColorStop(1, alpha(col, 0));
    g.fillStyle = fl;
    g.fillRect(0, cy, W, cw);
    placeCard(g, W / 2, cy, cw, -0.035, c, img, opt);
    const R = rng("sp" + c.cardId);
    for (let i = 0; i < (tier >= 3 ? 10 : 5); i++) sparkle(g, W / 2 + (R() - 0.5) * cw * 1.5, cy + (R() - 0.5) * cw * 1.6, 10 + R() * 18, i % 2 ? "#fde68a" : "#ffffff", 0.9);
    const by = cy + cw * 0.7 + (story ? 90 : 50);
    chipsRow(g, bits, W / 2, by, story ? 32 : 28);
    if (owner) { g.save(); g.textAlign = "center"; g.fillStyle = "#fff"; fitText(g, owner, W - 160, story ? 38 : 32, 700, SANS); g.fillText(owner, W / 2, by + (story ? 130 : 100)); g.restore(); }
    footer(g, W, H, pal, story ? "Ouvre tes boosters sur 2Gatcha · asso 2GETHER" : null);
    return cv;
  }

  async function renderRecap(fmt, d, pal) {
    const { w: W, h: H } = FORMATS[fmt];
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const r = d.r;
    const best = (r.best || []).slice(0, 3);
    const imgs = await Promise.all(best.map((c) => tryImg(API.imageUrl(c.imageId))));
    background(g, W, H, pal, best[0] && best[0].rarity ? best[0].rarity.colorHex : null, "recap" + r.week + fmt);
    const story = fmt === "story", square = fmt === "square";
    let y = story ? 200 : square ? 110 : 130;
    brand(g, W / 2 + 26, y, story ? 84 : 66, pal);
    g.save();
    g.textAlign = "center";
    g.fillStyle = pal.dim;
    g.font = `700 ${story ? 40 : 32}px ${SANS}`;
    y += story ? 80 : 62;
    g.fillText(`MA SEMAINE DU ${String(d.from).toUpperCase()}`, W / 2, y);
    g.fillStyle = "#fff";
    y += story ? 90 : 70;
    const name = (r.pseudo || Session.pseudo || "") + (r.prestigeStars ? "  " + "★".repeat(Math.min(5, r.prestigeStars)) : "");
    fitText(g, name, W - 160, story ? 76 : 60, 800, SANS);
    g.fillText(name, W / 2, y);
    g.restore();
    if (r.level) chip(g, `Niveau ${r.level}`, W / 2, y + 22, pal.a2, { size: 26, align: "center" });
    y += story ? 110 : 86;
    // Tuiles de stats.
    const pct = r.collection && r.collection.total ? Math.round((r.collection.after / r.collection.total) * 100) : 0;
    const gain = r.collection && r.collection.total ? pct - Math.round((r.collection.before / r.collection.total) * 100) : 0;
    const pl = (n, a, b) => (Number(n) > 1 ? b : a);
    const tiles = [
      [String(r.newCards || 0), pl(r.newCards, "nouvelle carte", "nouvelles cartes"), pal.a1],
      [String(r.boosters || 0), pl(r.boosters, "booster ouvert", "boosters ouverts"), pal.a2],
      [pct + " %", gain > 0 ? `collection (+${gain} %)` : "de la collection", pal.a3]
    ];
    if (r.place) tiles.push([r.place + (r.place === 1 ? "er" : "e"), `sur ${r.players || "?"} joueurs`, "#fbbf24"]);
    const cols = square ? tiles.length : 2;
    const tw = (W - 120 - (cols - 1) * 24) / cols, th = square ? 150 : story ? 190 : 160;
    tiles.forEach(([n, label, c], i) => {
      const x = 60 + (i % cols) * (tw + 24), ty = y + Math.floor(i / cols) * (th + 24);
      rr(g, x, ty, tw, th, 26);
      const tg = g.createLinearGradient(x, ty, x + tw, ty + th);
      tg.addColorStop(0, alpha(c, 0.28)); tg.addColorStop(1, "rgba(255,255,255,0.04)");
      g.fillStyle = tg; g.fill();
      g.lineWidth = 2; g.strokeStyle = alpha(c, 0.6); g.stroke();
      g.save();
      g.textAlign = "center"; g.fillStyle = "#fff";
      g.shadowColor = c; g.shadowBlur = 18;
      // Bungee n'a pas de minuscules (« 2e ») : Inter pour les rangs.
      g.font = /[a-z]/.test(n) ? `800 ${square ? 52 : story ? 76 : 64}px ${SANS}` : `400 ${square ? 52 : story ? 76 : 66}px ${BRAND}`;
      g.fillText(n, x + tw / 2, ty + th * 0.56);
      g.shadowBlur = 0;
      g.fillStyle = pal.dim;
      fitText(g, label, tw - 24, square ? 22 : 28, 600, SANS);
      g.fillText(label, x + tw / 2, ty + th * 0.84);
      g.restore();
    });
    y += Math.ceil(tiles.length / cols) * (th + 24) + (story ? 30 : 14);
    // Repartition par rarete.
    const rar = (r.rarities || []).filter((x) => x.count > 0);
    if (rar.length) {
      const total = rar.reduce((s, x) => s + x.count, 0) || 1;
      let x = 60;
      rr(g, 60, y, W - 120, 22, 11);
      g.save(); g.clip();
      rar.forEach((it) => { const ww = ((W - 120) * it.count) / total; g.fillStyle = it.colorHex || "#888"; g.fillRect(x, y, ww, 22); x += ww; });
      g.restore();
      y += 40;
      chipsRow(g, rar.slice(0, 5).map((it) => [`${it.count} ${it.name}`, it.colorHex || "#888"]), W / 2, y, square ? 20 : 24);
      y += square ? 50 : 70;
    }
    // Plus belles prises : eventail de cartes.
    if (best.length) {
      g.save(); g.textAlign = "center"; g.fillStyle = "#fff"; g.font = `800 ${story ? 40 : square ? 28 : 32}px ${SANS}`; g.fillText("Mes plus belles prises", W / 2, y + 20); g.restore();
      const cw = story ? 300 : square ? 190 : 200;
      const cy = Math.min(y + 50 + cw * 0.7, H - 130 - cw * 0.7);
      const n = best.length;
      best.forEach((c, i) => {
        const k = n === 1 ? 0 : i / (n - 1) - 0.5;
        const angle = k * 0.42;
        placeCard(g, W / 2 + k * cw * 1.45, cy + Math.abs(k) * 40, cw, angle, c, imgs[i], { finish: c.finish, quality: c.quality });
      });

    }
    footer(g, W, H, pal);
    return cv;
  }

  async function renderPlayer(fmt, p, pal) {
    const { w: W, h: H } = FORMATS[fmt];
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const showcase = (p.showcase || []).slice(0, 3);
    const [avatar, ...imgs] = await Promise.all([tryImg(p.discordAvatar), ...showcase.map((c) => tryImg(API.imageUrl(c.imageId)))]);
    background(g, W, H, pal, null, "player" + p.pseudo + fmt);
    const story = fmt === "story", square = fmt === "square";
    let y = story ? 190 : square ? 100 : 120;
    brand(g, W / 2 + 26, y, story ? 80 : 60, pal);
    y += story ? 210 : square ? 140 : 170;
    // Avatar avec anneau degrade.
    const ar = story ? 130 : square ? 92 : 110, ax = W / 2;
    const ring = g.createLinearGradient(ax - ar, y - ar, ax + ar, y + ar);
    ring.addColorStop(0, pal.a1); ring.addColorStop(0.5, pal.a2); ring.addColorStop(1, pal.a3);
    g.save();
    g.shadowColor = alpha(pal.a1, 0.9); g.shadowBlur = 40;
    g.beginPath(); g.arc(ax, y, ar + 10, 0, Math.PI * 2); g.fillStyle = ring; g.fill();
    g.restore();
    g.save();
    g.beginPath(); g.arc(ax, y, ar, 0, Math.PI * 2); g.clip();
    if (avatar) g.drawImage(avatar, ax - ar, y - ar, ar * 2, ar * 2);
    else { g.fillStyle = pal.panel; g.fillRect(ax - ar, y - ar, ar * 2, ar * 2); g.fillStyle = "#fff"; g.font = `400 ${ar}px ${BRAND}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText((p.pseudo || "?").slice(0, 1).toUpperCase(), ax, y + 4); }
    g.restore();
    if (p.level) chip(g, `Niv. ${p.level}`, ax, y + ar - 10, "#fbbf24", { size: 26, align: "center", fill: 0.9 });
    y += ar + (story ? 110 : 90);
    g.save();
    g.textAlign = "center"; g.fillStyle = "#fff";
    g.shadowColor = alpha(pal.a1, 0.8); g.shadowBlur = 20;
    fitText(g, p.pseudo || "", W - 140, story ? 84 : 66, 400, BRAND);
    g.fillText(p.pseudo || "", W / 2, y);
    g.shadowBlur = 0;
    const sub = [p.selectedBadge && p.selectedBadge.name, p.prestigeStars ? "★".repeat(Math.min(5, p.prestigeStars)) : "", p.extras && p.extras.rank ? p.extras.rank.label : ""].filter(Boolean).join("  ·  ");
    if (sub) { g.fillStyle = pal.dim; g.font = `700 ${story ? 34 : 28}px ${SANS}`; g.fillText(sub, W / 2, y + (story ? 56 : 46)); }
    g.restore();
    y += story ? 110 : 84;
    // Anneau de completion + stats.
    const pct = p.totalCards ? Math.min(1, (p.uniqueCards || 0) / p.totalCards) : 0;
    const stats = [[`${p.uniqueCards || 0}${p.totalCards ? "/" + p.totalCards : ""}`, "cartes uniques"], [String(p.totalPulls || 0), "tirages"], [String((p.completedSets || []).length), "sets complets"]];
    const rr2 = square ? 70 : 84, rx = square ? 230 : W / 2 - 300, ry = y + rr2 + 10;
    g.save();
    g.lineWidth = 16; g.lineCap = "round";
    g.strokeStyle = "rgba(255,255,255,0.1)";
    g.beginPath(); g.arc(rx, ry, rr2, 0, Math.PI * 2); g.stroke();
    const ag = g.createLinearGradient(rx - rr2, ry, rx + rr2, ry);
    ag.addColorStop(0, pal.a1); ag.addColorStop(1, pal.a2);
    g.strokeStyle = ag; g.shadowColor = pal.a2; g.shadowBlur = 16;
    g.beginPath(); g.arc(rx, ry, rr2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct); g.stroke();
    g.shadowBlur = 0;
    g.textAlign = "center"; g.fillStyle = "#fff"; g.font = `400 ${square ? 36 : 44}px ${BRAND}`;
    g.fillText(Math.round(pct * 100) + "%", rx, ry + 14);
    g.restore();
    stats.forEach(([n, label], i) => {
      const sx = rx + rr2 + 50, sy = ry - 62 + i * 62;
      g.save();
      g.fillStyle = "#fff"; g.font = `800 ${square ? 34 : 40}px ${SANS}`; g.textAlign = "left";
      g.fillText(n, sx, sy + 14);
      const nw = g.measureText(n).width;
      g.fillStyle = pal.dim; g.font = `600 ${square ? 24 : 28}px ${SANS}`;
      g.fillText(label, sx + nw + 14, sy + 14);
      g.restore();
    });
    y = ry + rr2 + (story ? 90 : 60);
    // Vitrine en eventail.
    if (showcase.length && !square) {
      g.save(); g.textAlign = "center"; g.fillStyle = "#fff"; g.font = `800 ${story ? 38 : 30}px ${SANS}`; g.fillText("Ma vitrine", W / 2, y); g.restore();
      const cw = story ? 300 : 210;
      const cy = y + 40 + cw * 0.7;
      showcase.forEach((c, i) => {
        const k = showcase.length === 1 ? 0 : i / (showcase.length - 1) - 0.5;
        placeCard(g, W / 2 + k * cw * 1.45, cy + Math.abs(k) * 36, cw, k * 0.4, c, imgs[i], {});
      });
    } else if (showcase.length) {
      // Carre : petit eventail a droite des statistiques.
      const cw = 150;
      showcase.forEach((c, i) => {
        const k = showcase.length === 1 ? 0 : i / (showcase.length - 1) - 0.5;
        placeCard(g, 850 + k * cw * 1.1, ry + 30 + Math.abs(k) * 24, cw, k * 0.4, c, imgs[i], {});
      });
    }
    if (p.memberSince) footer(g, W, H, pal, `Membre depuis ${new Date(p.memberSince * 1000).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} · 2Gatcha, asso 2GETHER`);
    else footer(g, W, H, pal);
    return cv;
  }

  // ------------------------------------------------------------ studio
  async function fontsReady() {
    try { await Promise.all([document.fonts.load(`400 60px ${BRAND}`), document.fonts.load(`800 40px ${SANS}`), document.fonts.load(`600 30px ${SANS}`)]); } catch (e) { /* polices systeme */ }
  }
  const blobOf = (cv, type = "image/png", q) => new Promise((res) => cv.toBlob(res, type, q));

  async function open({ kind, title, file, render, discord }) {
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay contract-overlay ss-overlay";
    const canCopy = !!(navigator.clipboard && window.ClipboardItem);
    overlay.innerHTML = `<div class="contract-modal ss-modal" role="dialog" aria-modal="true" aria-labelledby="ss-title">
      <header class="contract-modal-head"><div><strong id="ss-title">&#128444;&#65039; ${esc(title)}</strong><small>Une image aux couleurs de 2Gatcha, prête à partager.</small></div>
        <button type="button" class="card-modal-close" data-ss-close aria-label="Fermer">&times;</button></header>
      <div class="ss-formats" role="radiogroup" aria-label="Format">${Object.entries(FORMATS).map(([k, f], i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-ss-fmt="${k}"><i class="ss-fmt-${k}" aria-hidden="true"></i>${f.label}</button>`).join("")}</div>
      <div class="ss-stage"><div class="loading-row"><div class="spinner"></div></div></div>
      <footer class="contract-modal-foot ss-actions">
        ${discord ? '<button type="button" class="btn-secondary" data-ss-act="discord">&#128172; Publier sur le Discord de l\'asso</button>' : ""}
        ${canCopy ? '<button type="button" class="btn-secondary" data-ss-act="copy">&#128203; Copier</button>' : ""}
        <button type="button" class="btn-secondary" data-ss-act="download">&#11015;&#65039; Télécharger</button>
        <button type="button" class="btn" data-ss-act="share">&#128228; Partager</button>
      </footer>
    </div>`;
    document.body.appendChild(overlay);
    if (typeof syncScrollLock === "function") syncScrollLock();
    const close = () => { overlay.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); };
    const stage = overlay.querySelector(".ss-stage");
    const cache = {};
    let fmt = "post", current = null;
    await fontsReady();
    const pal = palette();
    async function show(f) {
      fmt = f;
      overlay.querySelectorAll("[data-ss-fmt]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.ssFmt === f)));
      stage.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';
      try {
        cache[f] = cache[f] || await render(f, pal);
        if (fmt !== f || !overlay.isConnected) return;
        current = cache[f];
        current.className = "ss-canvas";
        current.setAttribute("role", "img");
        current.setAttribute("aria-label", title);
        stage.replaceChildren(current);
      } catch (e) {
        stage.innerHTML = '<p class="cmp-empty">Image impossible à créer.</p>';
      }
    }
    const fileName = () => `${file}-${fmt}.png`;
    async function act(what, btn) {
      if (!current) return;
      btn.disabled = true;
      try {
        if (what === "discord") {
          const data = current.toDataURL("image/jpeg", 0.9);
          await discord(data);
          Toast.success("&#128228; Image publiée sur le Discord de l'asso !");
        } else {
          const blob = await blobOf(current);
          if (!blob) throw new Error("blob");
          const f = new File([blob], fileName(), { type: "image/png" });
          if (what === "share" && navigator.canShare && navigator.canShare({ files: [f] })) {
            try { await navigator.share({ files: [f], title: "2Gatcha" }); } catch (e) { if (!e || e.name !== "AbortError") throw e; }
          } else if (what === "copy") {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            Toast.success("&#128203; Image copiée : colle-la où tu veux !");
          } else {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = fileName();
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            Toast.success(what === "share" ? "&#128228; Image téléchargée : partage-la où tu veux !" : "&#11015;&#65039; Image téléchargée.");
          }
        }
      } catch (e) {
        if (what === "discord") Toast.error({ share_cooldown: `Attends encore ${e.data && e.data.wait ? Math.ceil(e.data.wait / 60) + " min" : "un peu"} avant de republier.`, discord_unavailable: "Le partage Discord n'est pas configuré.", card_not_owned: "Tu ne possèdes pas cette carte." }[e.code] || "Publication impossible. (" + e.message + ")");
        else Toast.error(what === "copy" ? "Copie impossible sur ce navigateur : télécharge l'image." : "Partage impossible pour le moment.");
      }
      btn.disabled = false;
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-ss-close]")) { close(); return; }
      const f = e.target.closest("[data-ss-fmt]");
      if (f) { show(f.dataset.ssFmt); return; }
      const a = e.target.closest("[data-ss-act]");
      if (a) act(a.dataset.ssAct, a);
    });
    overlay.querySelector("[data-ss-close]").focus();
    show("post");
  }

  return {
    FORMATS,
    renderCard, renderRecap, renderPlayer,
    // o : { card, finish, quality, edition, serial, number, owned } (card-extras.js)
    card(o) {
      return open({
        kind: "card", title: o.card.name, file: "2gatcha-" + String(o.card.name || "carte").toLowerCase().replace(/[^a-z0-9]+/gi, "-"),
        render: (f, pal) => renderCard(f, o, pal),
        discord: o.owned ? (image) => API.post("shareCard", { userId: Session.userId, cardId: o.card.cardId, finish: o.finish, quality: o.quality, edition: o.edition || null, serial: o.serial || null, image }) : null
      });
    },
    recap(r, from) {
      return open({ kind: "recap", title: `Ma semaine du ${from}`, file: "2gatcha-semaine", render: (f, pal) => renderRecap(f, { r, from }, pal) });
    },
    player(p) {
      return open({ kind: "player", title: `Profil de ${p.pseudo}`, file: "2gatcha-" + String(p.pseudo || "profil").toLowerCase().replace(/[^a-z0-9]+/gi, "-"), render: (f, pal) => renderPlayer(f, p, pal) });
    }
  };
})();
