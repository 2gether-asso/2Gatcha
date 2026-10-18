// Page Nouveautes (2026-10-18, api/src/native/patchnotes.js) : notes de mise a
// jour utiles aux joueurs, de la plus recente a la plus ancienne. Visiter la
// page marque tout comme lu (pastille du menu, shell.js).

(function () {
  const esc = escHtml;
  const fmt = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  document.addEventListener("DOMContentLoaded", async () => {
    const box = document.getElementById("patch-notes");
    if (!box) return;
    let seen = "";
    try { seen = localStorage.getItem("2gatcha_notes_seen") || ""; } catch (e) { /* stockage indisponible */ }
    try {
      const r = await API.get("patchNotes");
      box.innerHTML = r.notes.map((n) => `
        <article class="pn-entry ${seen && n.date > seen ? "is-new" : ""}">
          <header><time datetime="${esc(n.date)}">${fmt(n.date)}</time><h2>${esc(n.title)}</h2>${seen && n.date > seen ? '<span class="pn-new">nouveau</span>' : ""}</header>
          <ul>${n.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        </article>`).join("");
      if (r.latest) { try { localStorage.setItem("2gatcha_notes_seen", r.latest); } catch (e) { /* stockage indisponible */ } }
      document.querySelectorAll("[data-notes-dot]").forEach((d) => d.remove());
    } catch (e) { box.innerHTML = '<p class="empty-state">Notes indisponibles pour le moment.</p>'; }
  });
})();
