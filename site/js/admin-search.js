// Admin : recherche globale (2026-10-26). Un champ en tete de l'admin trouve
// une section (titre d'un encadre de n'importe quel onglet), un reglage
// (nom, aide, cle : registre de l'API) ou un joueur, et y emmene. Touche « / »
// pour y aller depuis n'importe ou.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let settings = null, players = null, active = -1, results = [];

  function sections() {
    return [...document.querySelectorAll(".adm-pane")].flatMap((pane) => {
      const paneTitle = pane.dataset.title || "";
      return [...pane.querySelectorAll(".adm-card-head h2, .adm-card > summary strong")].map((h) => ({ kind: "section", label: h.textContent.trim(), hint: paneTitle, pane: pane.id.replace("pane-", ""), el: h.closest(".adm-card"), text: norm(h.textContent + " " + (h.closest(".adm-card-head")?.querySelector("p")?.textContent || "") + " " + paneTitle) }));
    });
  }
  async function loadSettings() {
    if (settings) return;
    try { settings = ((await API.adminGetSettings(Session.discordId)).settings || []).map((s) => ({ kind: "setting", label: s.label, hint: "Réglages · " + s.group, key: s.key, text: norm(s.label + " " + (s.help || "") + " " + s.key + " " + s.group) })); } catch (e) { settings = []; }
  }
  async function loadPlayers() {
    if (players) return;
    try { players = ((await API.listUsers()).users || []).map((u) => ({ kind: "player", label: u.pseudo || "#" + u.userId, hint: "Fiche joueur", userId: u.userId, text: norm(u.pseudo) })); } catch (e) { players = []; }
  }
  function search(q) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const match = (x) => words.every((w) => x.text.includes(w));
    return [...sections().filter(match).slice(0, 8), ...(settings || []).filter(match).slice(0, 12), ...(players || []).filter(match).slice(0, 5)];
  }
  const ICON = { section: "📂", setting: "⚙️", player: "👤" };
  function paint() {
    const box = $("adm-search-results");
    box.hidden = !results.length && !$("adm-search").value.trim();
    box.innerHTML = results.length ? results.map((r, i) => `<button type="button" role="option" class="adm-sr ${i === active ? "on" : ""}" data-i="${i}" aria-selected="${i === active}"><span>${ICON[r.kind]} ${esc(r.label)}</span><small>${esc(r.hint)}</small></button>`).join("") : `<p class="muted">Rien trouvé.</p>`;
  }
  function go(r) {
    $("adm-search-results").hidden = true;
    if (r.kind === "section") { AdminNav.show(r.pane); setTimeout(() => { if (r.el.tagName === "DETAILS") r.el.open = true; r.el.scrollIntoView({ behavior: "smooth", block: "start" }); r.el.classList.add("flash"); setTimeout(() => r.el.classList.remove("flash"), 1600); }, 80); }
    else if (r.kind === "setting") {
      AdminNav.show("reglages");
      const tryOpen = (n) => { if (window.openSetting && window.openSetting(r.key)) return; if (n > 0) setTimeout(() => tryOpen(n - 1), 300); };
      tryOpen(15);
    } else if (r.kind === "player") { AdminNav.show("joueurs"); setTimeout(() => window.PlayerAdmin && PlayerAdmin.open(r.userId), 100); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    const top = document.querySelector(".adm-top");
    if (!top || !$("admin-zone")) return;
    top.insertAdjacentHTML("afterend", `<div class="adm-search" role="search"><input type="search" id="adm-search" placeholder="🔎 Chercher un outil, un réglage ou un joueur… (touche /)" autocomplete="off" aria-label="Recherche dans l'administration" aria-controls="adm-search-results" /><div class="adm-search-results" id="adm-search-results" role="listbox" hidden></div></div>`);
    const input = $("adm-search");
    input.addEventListener("focus", () => { loadSettings(); loadPlayers(); });
    input.addEventListener("input", async () => { await Promise.all([loadSettings(), loadPlayers()]); results = search(input.value); active = results.length ? 0 : -1; paint(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!results.length) return; active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length; paint(); }
      else if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active]); }
      else if (e.key === "Escape") { $("adm-search-results").hidden = true; }
    });
    $("adm-search-results").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) go(results[Number(b.dataset.i)]); });
    document.addEventListener("click", (e) => { if (!e.target.closest(".adm-search")) $("adm-search-results").hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); input.focus(); } });
  });
})();
