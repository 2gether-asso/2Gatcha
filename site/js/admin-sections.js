// Admin : sommaire des rubriques longues (2026-10-29). Codes & dons,
// Evenements et Contenu empilaient une dizaine de cartes de formulaires :
// une barre de sections en haut montre une carte a la fois (titre, icone,
// petite description), « Tout afficher » les remet toutes. La section ouverte
// est retenue par rubrique. Un lien interne (AdminNav focus, recherche « / »)
// vers un champ d'une section cachee ouvre d'abord cette section.

const AdminSections = (() => {
  const PANES = ["codes", "evenements", "contenu"];
  const KEY = "2gatcha_admin_sections";
  const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } };
  const remember = (pane, id) => { try { localStorage.setItem(KEY, JSON.stringify({ ...saved(), [pane]: id })); } catch (e) { /* stockage indisponible */ } };
  const cardsOf = (pane) => [...pane.children].filter((el) => el.classList.contains("adm-card"));

  function titleOf(card) {
    const h = card.querySelector("h2") || card.querySelector("summary strong");
    const raw = (h ? h.textContent : "Section").trim();
    const m = /^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s*(.*)$/u.exec(raw);
    return m ? { icon: m[1], label: m[2] } : { icon: "•", label: raw };
  }

  function show(pane, id) {
    const cards = cardsOf(pane);
    cards.forEach((c) => {
      c.hidden = id !== "all" && c.dataset.section !== id;
      // Section repliable choisie seule : on la deplie.
      if (!c.hidden && id !== "all" && c.tagName === "DETAILS") c.open = true;
    });
    pane.querySelectorAll(".adm-sections [data-section]").forEach((b) => {
      const on = b.dataset.section === id;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    remember(pane.id, id);
  }

  function build(pane) {
    const cards = cardsOf(pane);
    if (cards.length < 2 || pane.querySelector(".adm-sections")) return;
    cards.forEach((c, i) => { c.dataset.section = c.id || `${pane.id}-s${i}`; });
    const bar = document.createElement("nav");
    bar.className = "adm-sections";
    bar.setAttribute("aria-label", "Sections de la rubrique");
    bar.innerHTML = cards.map((c) => {
      const t = titleOf(c);
      return `<button type="button" class="adm-section-chip" data-section="${c.dataset.section}" aria-pressed="false"><span aria-hidden="true">${t.icon}</span> ${escHtml(t.label)}</button>`;
    }).join("") + `<button type="button" class="adm-section-chip adm-section-all" data-section="all" aria-pressed="false">&#9776; Tout afficher</button>`;
    pane.insertBefore(bar, cards[0]);
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-section]");
      if (!b) return;
      show(pane, b.dataset.section);
      bar.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    const last = saved()[pane.id];
    show(pane, last && (last === "all" || cards.some((c) => c.dataset.section === last)) ? last : cards[0].dataset.section);
  }

  // Element vise dans une section cachee : on ouvre sa section.
  function reveal(el) {
    const card = el && el.closest && el.closest(".adm-card[data-section]");
    const pane = card && card.parentElement;
    if (card && card.hidden && pane) show(pane, card.dataset.section);
  }

  function init() { PANES.forEach((p) => { const pane = document.getElementById("pane-" + p); if (pane) build(pane); }); }
  document.addEventListener("DOMContentLoaded", init);
  return { reveal, show: (p, id) => { const pane = document.getElementById("pane-" + p); if (pane) show(pane, id); } };
})();
window.AdminSections = AdminSections;
