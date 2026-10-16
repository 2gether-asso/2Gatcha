// Dessin des dinos de compagnie en SVG (2026-10-15) : espece, teinte, motif,
// couleurs nommees (albinos, obsidienne, or, fossile vivant), chromatique,
// accessoire, costume de saison, sommeil et tas d'os. Utilise par
// jeux-dino.js, le profil public et la carte de joueur (shell.js).

const DinoArt = (function () {
  let uid = 0;
  const esc = escHtml; // core.js
  const HEADS = {
    rex: { x: 90, y: 38, r: 15 }, long: { x: 98, y: 16, r: 9 }, trice: { x: 92, y: 56, r: 12 },
    stego: { x: 92, y: 60, r: 9 }, raptor: { x: 92, y: 44, r: 10 }, ptero: { x: 88, y: 36, r: 10 }
  };
  // Couleurs de base selon la teinte, ou couleur nommee.
  function palette(d, id) {
    const h = d.hue || 0;
    const p = { body: `hsl(${h} 62% 56%)`, dark: `hsl(${h} 55% 36%)`, belly: `hsl(${h} 75% 82%)`, eye: "#1b1b2a", defs: "" };
    if (d.color === "albino") Object.assign(p, { body: "#f4f1f1", dark: "#d9cfd0", belly: "#ffffff", eye: "#e11d48" });
    if (d.color === "obsidian") Object.assign(p, { body: "#221d36", dark: "#0d0b17", belly: "#3d3266", eye: "#d8b4fe" });
    if (d.color === "fossil") Object.assign(p, { body: "#b3aca6", dark: "#7d756e", belly: "#d9d4cf", eye: "#2b2622" });
    if (d.color === "gold") Object.assign(p, { body: `url(#dg${id})`, dark: "#9a5b0c", belly: "#fff4c7", eye: "#3b2405",
      defs: `<linearGradient id="dg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1a8"/><stop offset=".45" stop-color="#f5b82e"/><stop offset="1" stop-color="#b8710f"/></linearGradient>` });
    if (d.pattern === "galaxy") p.defs += `<radialGradient id="dx${id}" cx=".4" cy=".4" r=".7"><stop offset="0" stop-color="#a78bfa" stop-opacity=".9"/><stop offset="1" stop-color="#1e1b4b" stop-opacity=".85"/></radialGradient>`;
    return p;
  }
  function accessory(key, head, dark) {
    const { x, y, r } = head;
    switch (key) {
      case "hat": return `<rect x="${x - r * 0.75}" y="${y - r - 4}" width="${r * 1.5}" height="3.5" rx="1.5" fill="#1f1f2b"/><rect x="${x - r * 0.45}" y="${y - r - 17}" width="${r * 0.9}" height="14" rx="2" fill="#1f1f2b"/><rect x="${x - r * 0.45}" y="${y - r - 8}" width="${r * 0.9}" height="3" fill="#e11d48"/>`;
      case "bow": return `<path d="M${x - 4} ${y - r + 1} l-8 -6 v12 Z M${x - 4} ${y - r + 1} l8 -6 v12 Z" fill="#f472b6"/><circle cx="${x - 4}" cy="${y - r + 1}" r="2.6" fill="#db2777"/>`;
      case "glasses": return `<g stroke="#111" stroke-width="1.6"><circle cx="${x + r * 0.35}" cy="${y - r * 0.2}" r="4.2" fill="rgba(20,20,30,.85)"/><circle cx="${x + r * 0.35 - 9}" cy="${y - r * 0.2}" r="4.2" fill="rgba(20,20,30,.85)"/><path d="M${x + r * 0.35 - 4.8} ${y - r * 0.2} h1.6" fill="none"/></g>`;
      case "scarf": return `<path d="M${x - r - 2} ${y + r - 3} q${r} 7 ${r * 2 + 2} -2 l1 5 q-${r} 8 -${r * 2 + 4} 2 Z" fill="#ef4444"/><path d="M${x - r + 1} ${y + r + 1} l-3 11 l5 -1 Z" fill="#dc2626"/>`;
      case "crown": return `<path d="M${x - r * 0.7} ${y - r + 2} l0 -9 l${r * 0.35} 5 l${r * 0.35} -8 l${r * 0.35} 8 l${r * 0.35} -5 l0 9 Z" fill="#facc15" stroke="#b45309" stroke-width="1"/><circle cx="${x}" cy="${y - r - 3}" r="1.6" fill="#ef4444"/>`;
      default: return "";
    }
  }
  // Costumes de saison (automatiques pendant l'evenement).
  function costume(season, head) {
    const { x, y, r } = head;
    switch (season) {
      case "halloween": return `<path d="M${x - r - 4} ${y - r + 3} h${2 * r + 8} l-${r + 4} -3 Z" fill="#2e1065"/><path d="M${x - r * 0.6} ${y - r + 1} L${x + 3} ${y - r - 18} L${x + r * 0.6} ${y - r + 1} Z" fill="#3b0764"/><rect x="${x - r * 0.6}" y="${y - r - 3}" width="${r * 1.2}" height="3" fill="#f97316"/>`;
      case "christmas": return `<path d="M${x - r * 0.8} ${y - r + 3} Q${x} ${y - r - 18} ${x + r + 6} ${y - r - 6} L${x + r * 0.8} ${y - r + 3} Z" fill="#dc2626"/><rect x="${x - r * 0.9}" y="${y - r + 1}" width="${r * 1.8}" height="4" rx="2" fill="#fff"/><circle cx="${x + r + 6}" cy="${y - r - 6}" r="3" fill="#fff"/>`;
      case "newyear": return `<path d="M${x - r * 0.5} ${y - r + 2} L${x} ${y - r - 15} L${x + r * 0.5} ${y - r + 2} Z" fill="#a855f7"/><circle cx="${x}" cy="${y - r - 15}" r="2.4" fill="#facc15"/>`;
      case "valentine": return `<path d="M${x + r + 6} ${y - r - 4} c-3 -5 -10 -2 -6 4 l6 6 l6 -6 c4 -6 -3 -9 -6 -4 Z" fill="#f43f5e"/>`;
      case "easter": return `<ellipse cx="${x - 4}" cy="${y - r - 8}" rx="3" ry="9" fill="#fce7f3" stroke="#f9a8d4"/><ellipse cx="${x + 4}" cy="${y - r - 8}" rx="3" ry="9" fill="#fce7f3" stroke="#f9a8d4"/>`;
      case "aprilfools": return `<path d="M${x - r - 12} ${y + 2} q6 -6 12 0 q-6 6 -12 0 Z M${x - r - 12} ${y + 2} l-4 -4 v8 Z" fill="#60a5fa"/>`;
      case "summer": return `<path d="M${x - r} ${y - 2} a${r} ${r} 0 0 1 ${2 * r} 0" fill="none" stroke="#111" stroke-width="2.4"/><rect x="${x - r - 3}" y="${y - 4}" width="5" height="8" rx="2" fill="#22d3ee"/><rect x="${x + r - 2}" y="${y - 4}" width="5" height="8" rx="2" fill="#22d3ee"/>`;
      default: return "";
    }
  }
  function bones() {
    const bone = (x, y, a) => `<g transform="translate(${x} ${y}) rotate(${a})"><rect x="-14" y="-2.6" width="28" height="5.2" rx="2.6" fill="#e7e2d7"/><circle cx="-14" cy="-3" r="3.6" fill="#e7e2d7"/><circle cx="-14" cy="3" r="3.6" fill="#e7e2d7"/><circle cx="14" cy="-3" r="3.6" fill="#e7e2d7"/><circle cx="14" cy="3" r="3.6" fill="#e7e2d7"/></g>`;
    return `<svg class="dino-svg dino-bones" viewBox="0 0 120 92" role="img" aria-label="Tas d'os"><ellipse cx="60" cy="84" rx="40" ry="6" fill="rgba(0,0,0,.25)"/>${bone(44, 78, 12)}${bone(74, 79, -18)}${bone(60, 70, 4)}${bone(52, 62, -30)}${bone(70, 62, 26)}<path d="M50 44 a12 11 0 1 1 22 0 v8 h-22 Z" fill="#efeadf"/><circle cx="56" cy="44" r="3" fill="#3b342c"/><circle cx="66" cy="44" r="3" fill="#3b342c"/></svg>`;
  }

  function svg(d, opts = {}) {
    if (d.dead) return bones();
    const id = ++uid;
    const p = palette(d, id);
    const head = HEADS[d.species] || HEADS.rex;
    const scale = d.stage === "bebe" ? 0.7 : d.stage === "jeune" ? 0.85 : 1;
    const parts = [];
    const behind = [];
    if (d.acc === "cape") behind.push(`<path d="M76 46 Q60 40 34 50 L28 78 Q50 70 72 72 Z" fill="#dc2626" opacity=".95"/>`);
    if (d.species === "stego") behind.push(`<path d="M38 46 L44 30 L50 44 L56 26 L62 43 L68 28 L74 45 Z" fill="${p.dark}"/>`);
    if (d.species === "trice") behind.push(`<circle cx="${head.x - 6}" cy="${head.y - 4}" r="17" fill="${p.dark}"/>`);
    if (d.species === "ptero") behind.push(`<path d="M58 52 L14 22 L30 56 Z" fill="${p.dark}" opacity=".9"/><path d="M62 52 L106 60 L72 66 Z" fill="${p.dark}" opacity=".75"/>`);
    // Queue, pattes, corps.
    const slim = d.species === "raptor" || d.species === "ptero";
    parts.push(`<path d="M36 60 Q14 58 4 ${d.species === "raptor" ? 46 : d.species === "ptero" ? 62 : 70} Q20 70 40 70 Z" fill="${p.body}"/>`);
    parts.push(`<rect x="44" y="70" width="9" height="16" rx="4" fill="${p.dark}"/><rect x="66" y="70" width="9" height="16" rx="4" fill="${p.dark}"/>`);
    parts.push(`<ellipse cx="58" cy="60" rx="${slim ? 23 : 28}" ry="${slim ? 15 : 19}" fill="${p.body}"/>`);
    if (d.pattern === "belly") parts.push(`<ellipse cx="60" cy="68" rx="20" ry="9" fill="${p.belly}"/>`);
    if (d.pattern === "spots") parts.push(`<g fill="${p.dark}" opacity=".55"><circle cx="50" cy="52" r="4"/><circle cx="64" cy="49" r="3"/><circle cx="70" cy="60" r="3.5"/><circle cx="42" cy="62" r="2.5"/></g>`);
    if (d.pattern === "stripes") parts.push(`<path d="M46 43 q3 8 0 16 M56 41 q3 9 0 18 M66 42 q3 8 0 16" stroke="${p.dark}" stroke-width="3" fill="none" opacity=".55" stroke-linecap="round"/>`);
    if (d.pattern === "zigzag") parts.push(`<path d="M36 58 l6 -6 l6 6 l6 -6 l6 6 l6 -6 l6 6 l6 -6" stroke="${p.dark}" stroke-width="3" fill="none" opacity=".6" stroke-linejoin="round"/>`);
    if (d.pattern === "galaxy") parts.push(`<ellipse cx="58" cy="58" rx="${slim ? 19 : 24}" ry="${slim ? 11 : 15}" fill="url(#dx${id})"/><g fill="#fff"><circle cx="48" cy="54" r="1"/><circle cx="60" cy="50" r="1.3"/><circle cx="68" cy="60" r="0.9"/><circle cx="54" cy="64" r="1.1"/><circle cx="72" cy="52" r="0.8"/></g>`);
    if (d.color === "fossil") parts.push(`<path d="M44 50 l6 6 l-3 6 M64 46 l-4 8 l5 5 M70 64 l-6 -3" stroke="#6b635c" stroke-width="1.4" fill="none"/>`);
    // Cou puis tete.
    if (d.species === "long") parts.push(`<path d="M74 52 Q92 40 ${head.x - 2} ${head.y + 6} L${head.x + 4} ${head.y + 9} Q96 48 80 62 Z" fill="${p.body}"/>`);
    else parts.push(`<path d="M76 50 Q${head.x - 6} ${head.y} ${head.x} ${head.y + 4} L${head.x + 2} ${head.y + 12} Q84 62 78 66 Z" fill="${p.body}"/>`);
    parts.push(`<circle cx="${head.x}" cy="${head.y}" r="${head.r}" fill="${p.body}"/>`);
    if (d.species === "ptero") parts.push(`<path d="M${head.x - 4} ${head.y - 6} L${head.x - 22} ${head.y - 14} L${head.x - 2} ${head.y - 1} Z" fill="${p.dark}"/><path d="M${head.x + 6} ${head.y + 1} L${head.x + 22} ${head.y + 4} L${head.x + 6} ${head.y + 6} Z" fill="${p.belly}"/>`);
    if (d.species === "rex") parts.push(`<path d="M${head.x - 2} ${head.y + 6} q12 2 18 -2" stroke="${p.dark}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M76 62 l6 4" stroke="${p.dark}" stroke-width="3" stroke-linecap="round"/>`);
    if (d.species === "trice") parts.push(`<path d="M${head.x + 6} ${head.y - 8} l8 -10 l-2 11 Z M${head.x - 2} ${head.y - 10} l3 -12 l3 12 Z M${head.x + 10} ${head.y + 2} l9 -2 l-8 5 Z" fill="${p.belly}"/>`);
    // Yeux : fermes s'il dort, joue rose s'il est aux anges.
    const ex = head.x + head.r * 0.35, ey = head.y - head.r * 0.2;
    const mood = d.mood ? d.mood.key : "ok";
    parts.push(d.sleeping || mood === "sleep"
      ? `<path d="M${ex - 3} ${ey + 0.5} q3 2.5 6 0" stroke="${p.eye === "#1b1b2a" ? "#1b1b2a" : p.dark}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
      : `<circle cx="${ex}" cy="${ey}" r="2.8" fill="${p.eye}"/><circle cx="${ex + 0.9}" cy="${ey - 0.9}" r="0.9" fill="#fff"/>`);
    if (mood === "happy") parts.push(`<circle cx="${head.x + head.r * 0.1}" cy="${head.y + head.r * 0.4}" r="2.6" fill="#ff7aa8" opacity=".7"/>`);
    if (mood === "sad" || mood === "dying") parts.push(`<path d="M${ex + 2} ${ey + 4} q1 3 0 5" stroke="#7dd3fc" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);
    // Accessoire, sinon costume de saison.
    const top = d.acc && d.acc !== "cape" ? accessory(d.acc, head, p.dark) : "";
    const season = !opts.noCostume && opts.season && !["hat", "crown"].includes(d.acc) ? costume(opts.season, head) : "";
    const zzz = d.sleeping ? `<g class="dino-zzz" fill="#e0e7ff" font-family="sans-serif" font-weight="700"><text x="${head.x + 8}" y="${head.y - head.r - 2}" font-size="9">z</text><text x="${head.x + 15}" y="${head.y - head.r - 10}" font-size="11">z</text><text x="${head.x + 23}" y="${head.y - head.r - 20}" font-size="13">Z</text></g>` : "";
    const cls = ["dino-svg", d.shiny ? "dino-shiny" : "", d.color ? "dino-" + d.color : "", d.season === "halloween" && d.species === "ptero" ? "dino-ghost" : "", "mood-" + mood, d.sleeping ? "is-sleeping" : ""].filter(Boolean).join(" ");
    return `<svg class="${cls}" viewBox="0 0 120 92" style="--dino-scale:${opts.scale ?? scale}" role="img" aria-label="${esc(d.speciesLabel || "Dinosaure")} ${esc(d.name || "")}">${p.defs ? `<defs>${p.defs}</defs>` : ""}<g class="dino-body">${behind.join("")}${parts.join("")}${top}${season}</g>${zzz}</svg>`;
  }
  return { svg, bones };
})();
window.DinoArt = DinoArt;
