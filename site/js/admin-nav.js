// Navigation de la page admin (2026-10-11) : une rubrique visible a la fois
// (menu lateral sur ordinateur, onglets defilants sur mobile), adresse dans
// l'URL (#economie...), et chargement paresseux : chaque rubrique charge ses
// donnees la premiere fois qu'on l'ouvre (AdminNav.onFirstShow).

const AdminNav = {
  PANES: ["accueil", "codes", "economie", "modes", "visuels", "test", "evenements", "contenu", "reglages", "site", "doc"],
  current: null,
  firstShow: new Map(),
  shown: new Set(),

  // fn appelee la premiere fois que la rubrique est affichee (ou tout de
  // suite si elle l'est deja).
  onFirstShow(pane, fn) {
    if (this.shown.has(pane)) { fn(); return; }
    if (!this.firstShow.has(pane)) this.firstShow.set(pane, []);
    this.firstShow.get(pane).push(fn);
  },

  show(pane, { focus = null, push = true } = {}) {
    if (!this.PANES.includes(pane)) pane = "accueil";
    this.current = pane;
    document.querySelectorAll(".adm-pane").forEach((el) => { el.hidden = el.id !== "pane-" + pane; });
    document.querySelectorAll("#adm-nav [data-pane]").forEach((b) => {
      const on = b.dataset.pane === pane;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      if (on && b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "center" });
    });
    if (push && location.hash !== "#" + pane) history.replaceState(null, "", "#" + pane);
    const title = document.getElementById("pane-" + pane)?.dataset.title;
    document.title = (title ? title + " - " : "") + "Administration - 2Gatcha";
    if (!this.shown.has(pane)) {
      this.shown.add(pane);
      (this.firstShow.get(pane) || []).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
      this.firstShow.delete(pane);
    }
    if (focus) setTimeout(() => { const el = document.getElementById(focus); if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.focus({ preventScroll: true }); } }, 80);
    else window.scrollTo({ top: Math.min(window.scrollY, document.getElementById("admin-zone").offsetTop - 80), behavior: "smooth" });
  },

  // Badge sur une rubrique du menu (ex. nombre d'alertes).
  badge(pane, text, tone = "") {
    const b = document.querySelector(`#adm-nav [data-pane="${pane}"]`);
    if (!b) return;
    let el = b.querySelector(".adm-nav-badge");
    if (!text) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("span"); el.className = "adm-nav-badge"; b.appendChild(el); }
    el.textContent = text;
    el.dataset.tone = tone;
  },

  start() {
    document.getElementById("adm-nav")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pane]");
      if (b) this.show(b.dataset.pane);
    });
    document.addEventListener("click", (e) => {
      const g = e.target.closest && e.target.closest("[data-goto]");
      if (g) { e.preventDefault(); this.show(g.dataset.goto, { focus: g.dataset.focus || null }); }
    });
    window.addEventListener("hashchange", () => this.show(location.hash.slice(1), { push: false }));
    this.show(location.hash.slice(1) || "accueil", { push: false });
  }
};
