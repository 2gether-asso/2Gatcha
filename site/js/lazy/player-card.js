// Module charge a la demande par shell-extras.js (LazyJs.load, core.js).
// Carte de joueur au survol d'un pseudo.

// ---------------------------------------------------------------------------
// Carte de joueur au survol d'un pseudo (2026-10-07) : rang, titre, niveau
// et vitrine (6 cartes), sur ordinateur seulement.
// ---------------------------------------------------------------------------
const PlayerCard = {
  cache: new Map(),
  el: null,
  timer: null,
  init() {
    if (!window.matchMedia || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    document.addEventListener("mouseover", (e) => {
      const a = e.target.closest && e.target.closest('a[href*="profile.html?pseudo="]');
      if (!a || a.closest(".player-card-pop")) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.show(a), 380);
    });
    document.addEventListener("mouseout", (e) => {
      const a = e.target.closest && e.target.closest('a[href*="profile.html?pseudo="]');
      if (a && !a.contains(e.relatedTarget)) { clearTimeout(this.timer); this.hideSoon(); }
    });
  },
  hideSoon() { setTimeout(() => { if (this.el && !this.el.matches(":hover")) this.el.remove(); }, 200); },
  async show(a) {
    const pseudo = new URL(a.href, location.href).searchParams.get("pseudo");
    if (!pseudo) return;
    let data = this.cache.get(pseudo);
    if (!data) { try { data = await API.getPlayerCard(pseudo); this.cache.set(pseudo, data); } catch (e) { return; } }
    if (!a.matches(":hover")) return;
    const esc = escHtml;
    if (this.el) this.el.remove();
    const el = document.createElement("div");
    el.className = "player-card-pop";
    el.innerHTML = `
      <div class="pcp-head">
        ${data.avatar ? `<img class="pcp-avatar ${data.decor && data.decor.frame ? "decor-" + data.decor.frame : ""}" src="${data.avatar}" alt="" />` : ""}
        <div><strong class="${data.decor && data.decor.color ? "decor-" + data.decor.color : ""}">${esc(data.pseudo)}</strong>
          ${data.decor && data.decor.title ? `<small class="decor-title">${esc(data.decor.title)}</small>` : ""}
          <small>Niv. ${data.level}${data.prestigeStars > 0 ? ` <span class="header-prestige" title="Prestige du compte">★${data.prestigeStars > 1 ? data.prestigeStars : ""}</span>` : ""} · ${data.rank.icon} ${esc(data.rank.label)} · &#127907; ${data.skills.fishing} · &#9935;&#65039; ${data.skills.dig}</small></div>
      </div>
      ${data.starDino ? `<div class="pcp-dino" data-pcp-dino>${window.DinoArt ? DinoArt.svg(data.starDino, { scale: 1 }) : ""}<small>&#129430; ${esc(data.starDino.name)} · ${esc(data.starDino.speciesLabel)}</small></div>` : ""}
      ${data.showcase.length ? `<div class="pcp-showcase">${data.showcase.map((c) => `<img src="${API.imageUrl(c.imageId)}" alt="${esc(c.name)}" title="${esc(c.name)}" style="--r:${esc(c.rarity?.colorHex || "#888")}" loading="lazy" />`).join("")}</div>` : '<small class="muted">Vitrine vide</small>'}`;
    document.body.appendChild(el);
    if (data.starDino && !window.DinoArt) {
      LazyJs.load("js/dino-art.js").then(() => { const box = el.querySelector("[data-pcp-dino]"); if (box && window.DinoArt) box.insertAdjacentHTML("afterbegin", DinoArt.svg(data.starDino, { scale: 1 })); }).catch(() => {});
    }
    const r = a.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + "px";
    el.style.top = (r.bottom + h + 12 > window.innerHeight ? r.top - h - 8 : r.bottom + 8) + "px";
    el.addEventListener("mouseleave", () => el.remove());
    this.el = el;
  }
};
