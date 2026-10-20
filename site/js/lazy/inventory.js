// Module charge a la demande par shell-extras.js (LazyJs.load, core.js).
// Inventaire de l'en-tete.

// ---------------------------------------------------------------------------
// Inventaire (2026-10-08) : la barre de ressources de l'en-tete ouvre un
// panneau qui nomme chaque ressource, dit a quoi elle sert et ou l'utiliser.
// Les compteurs viennent du statut deja charge (booster-status) ; coffres,
// appats et os sont lus a l'ouverture (et ignores si indisponibles).
// ---------------------------------------------------------------------------
const Inventory = {
  extra: null,
  isOpen() { const p = document.getElementById("inventory-panel"); return !!p && !p.hidden; },
  async loadExtra() {
    const uid = Session.userId;
    const [chests, garden, dig, shop, timers] = await Promise.allSettled([API.chests(uid, "status"), API.garden(uid), API.getDigStatus(uid), API.shop ? API.shop(uid) : Promise.reject(), API.get("timers", { userId: uid })]);
    const v = (r) => (r.status === "fulfilled" ? r.value : null);
    const d = v(dig);
    this.extra = {
      chests: v(chests)?.chests, goldBait: v(garden)?.goldBait,
      bones: d ? (d.bones ?? d.dog?.bones ?? d.kennel?.bones) : undefined,
      luck: v(shop)?.luckCharges, xpUntil: v(shop)?.xpBoostUntil,
      timers: v(timers), timersAt: Date.now()
    };
    if (this.isOpen()) this.render();
  },
  render() {
    const st = window.__hdrStatus || {};
    const x = this.extra || {};
    const n = (v) => (v == null ? null : Number(v) || 0);
    const items = [
      { icon: '<img class="ico-token" src="assets/JetonBooster.png" alt="" />', name: "Jetons booster", count: n(st.count), desc: "1 jeton = 1 booster (5 cartes) de l'extension de ton choix, au distributeur.", url: "ouverture.html", cta: "Ouvrir" },
      { icon: "&#10024;", name: "Poussières d'étoile", count: n(st.stardust), desc: "Crafter des cartes, la boutique, les enchères.", url: "boutique.html", cta: "Dépenser" },
      { icon: resIcon("key"), name: "Clés", count: n(st.keys), desc: "Ouvrent les coffres du gatchapon et le grand coffre-fort.", url: "ouverture.html", cta: "Utiliser" },
      { icon: resIcon("coin"), name: "Pièces de gatchapon", count: n(x.chests), desc: "Une pièce = une boule au gatchapon, avec un coffre dedans (à ouvrir avec une clé).", url: "ouverture.html", cta: "Gatchapon" },
      { icon: resIcon("worm"), name: "Vers de terre", count: n(st.worms), desc: "Un par lancer de pêche.", url: "jeux.html#peche", cta: "Pêcher" },
      { icon: resIcon("bait"), name: "Appâts dorés", count: n(x.goldBait), desc: "Aucune prise vide et prises rares ×2,5.", url: "jeux.html#peche", cta: "Pêcher" },
      { icon: resIcon("bone"), name: "Os", count: n(x.bones), desc: "Envoient Milo, le chien, creuser pour toi.", url: "jeux.html#fouille", cta: "Chenil" },
      { icon: resIcon("part"), name: "Pièces détachées", count: n(st.spareParts), desc: "Remplacent un exemplaire dans une fusion ou une restauration.", url: "collection.html#finitions", cta: "Atelier" },
      { icon: "&#127915;", name: "Tickets Unique", count: n(st.uniqueTickets), desc: "Une carte Unique au choix au Comptoir.", url: "coffre.html#comptoir", cta: "Comptoir" },
      { icon: "&#129514;", name: "Élixir de chance", count: n(x.luck), desc: "Boosters restants avec +5 pts de finition spéciale.", url: "ouverture.html", cta: "Ouvrir" },
      { icon: "&#129513;", name: "Fragments de booster", count: st.shards ? n(st.shards.count) : null, desc: st.shards ? `${st.shards.per} fragments = 1 booster. Gagnés en jouant (fouille, jardin, pêche, expéditions…).` : "", url: "jeux.html", cta: "Jouer" }
    ];
    const boost = x.xpUntil && x.xpUntil > Date.now() / 1000 ? Math.ceil((x.xpUntil - Date.now() / 1000) / 60) : 0;
    const shown = items.filter((i) => i.count == null ? false : i.count > 0 || ["Boosters", "Poussières d'étoile"].includes(i.name));
    const empty = items.filter((i) => i.count === 0 && !["Boosters", "Poussières d'étoile"].includes(i.name));
    const fmt = (c) => Number(c).toLocaleString("fr-FR");
    document.getElementById("inventory-panel").innerHTML = `
      <div class="inv-head"><strong>&#127890; Inventaire</strong><a href="boutique.html" class="inv-shop">&#128717;&#65039; Boutique</a></div>
      ${boost ? `<div class="inv-boost">&#128216; XP ×2 encore ${boost} min</div>` : ""}
      ${this.timersHtml()}
      <ul class="inv-list">${shown.map((i) => `<li><a href="${i.url}"><span class="inv-icon" aria-hidden="true">${i.icon}</span><span class="inv-body"><strong>${i.name}</strong><small>${i.desc}</small></span><span class="inv-count">${fmt(i.count)}</span><span class="inv-cta">${i.cta} &#8250;</span></a></li>`).join("")}</ul>
      ${empty.length ? `<p class="inv-empty">Pas encore : ${empty.map((i) => `<span title="${i.desc}">${i.icon} ${i.name}</span>`).join(" · ")}</p>` : ""}
      ${Treasure.state && Treasure.state.enabled ? `<p class="inv-treasure"><img class="ico-token" src="assets/Boussole.PNG" alt="" /> Course aux trésors : <strong>${Treasure.state.found}/${Treasure.state.total}</strong> indices cette semaine${Treasure.state.found < Treasure.state.total ? ` · cachés sur : ${Treasure.state.clues.filter((c) => !c.found).map((c) => c.label).join(", ")}` : " · bravo !"}</p>` : ""}
      ${this.extra ? "" : '<p class="inv-empty">Chargement des coffres, appâts et os…</p>'}`;
    // Minuteurs : decompte en direct tant que le panneau est ouvert.
    clearInterval(this.tick);
    if (this.extra && this.extra.timers) this.tick = setInterval(() => { if (!this.isOpen()) { clearInterval(this.tick); return; } const box = document.getElementById("inv-timers"); if (box) box.outerHTML = this.timersHtml(); }, 1000);
  },
  // Minuteurs (2026-10-18, api/src/native/timers.js) : ce qui sera pret, et quand.
  timersHtml() {
    const tm = this.extra && this.extra.timers;
    if (!tm || !tm.items || !tm.items.length) return "";
    const nowS = tm.now + Math.floor((Date.now() - this.extra.timersAt) / 1000);
    const left = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h} h ${String(m).padStart(2, "0")}` : m ? `${m} min ${String(sec).padStart(2, "0")}` : `${sec} s`; };
    const icon = (k) => (k === "pick" ? '<img class="ico-token" src="assets/Fouille/Pioche_01.PNG" alt="" />' : RES_ART[k] ? resIcon(k) : k);
    return `<div class="inv-timers" id="inv-timers"><strong>&#9201;&#65039; Minuteurs</strong> <button type="button" class="inv-remind" data-reminders>&#9200; Me prévenir</button><ul>${tm.items.map((i) => { const s = i.at - nowS; return `<li class="${s <= 0 ? "ready" : ""}"><a href="${i.url}"><span class="inv-timer-ico" aria-hidden="true">${icon(i.icon)}</span><span class="inv-timer-label">${escHtml(i.label)}</span><span class="inv-timer-left">${s <= 0 ? "prêt !" : "dans " + left(s)}</span></a></li>`; }).join("")}</ul></div>`;
  },
  toggle(force) {
    const panel = document.getElementById("inventory-panel");
    const btn = document.getElementById("inventory-trigger");
    if (!panel || !btn) return;
    const open = force != null ? force : panel.hidden;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    document.getElementById("inventory")?.classList.toggle("open", open);
    if (open) { this.render(); this.loadExtra(); }
  },
  init() {
    const btn = document.getElementById("inventory-trigger");
    if (!btn) return;
    btn.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    document.addEventListener("click", (e) => { if (this.isOpen() && !document.getElementById("inventory").contains(e.target)) this.toggle(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.isOpen()) { this.toggle(false); btn.focus(); } });
  }
};
