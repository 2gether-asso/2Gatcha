// Admin > Tout voir > Journal de l'equipe (2026-10-29, api/src/native/audit.js,
// admin-audit) : chaque ecriture de l'equipe (Tout voir, dons, codes, fiche
// joueur, cosmetiques, reglages), ce qu'elle a change, et « Annuler ».
// Une quantite (ressource, XP) est annulee par ecart : ce que le joueur a
// gagne depuis est garde ; un autre champ modifie depuis est laisse tel quel.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const api = (action, params = {}) => API.post("adminAudit", { discordId: Session.discordId, action, ...params });
  const date = (t) => new Date(t * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const OP = { update: "✏️", create: "➕", delete: "🗑️" };
  const val = (v) => { const s = v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v); return esc(s.length > 60 ? s.slice(0, 60) + "…" : s); };
  let entries = [], filter = "";

  function render() {
    const q = filter.trim().toLowerCase();
    const rows = entries.filter((e) => !q || e.summary.toLowerCase().includes(q));
    $("au-app").innerHTML = `
      <div class="au-bar"><input type="search" id="au-q" placeholder="Filtrer (joueur, code, table…)" value="${esc(filter)}" /><button type="button" class="btn-ghost" id="au-refresh">&#8635; Actualiser</button></div>
      ${rows.length ? `<ol class="au-list">${rows.map((e) => `
        <li class="au-entry ${e.undoneAt ? "undone" : ""}">
          <div class="au-head">
            <span class="au-when">${date(e.at)}</span>
            <strong>${esc(e.summary)}</strong>
            ${e.undoneAt ? `<span class="rw-status off">Annulé le ${date(e.undoneAt)}</span>` : `<button type="button" class="btn-ghost danger" data-undo="${e.id}">&#8630; Annuler</button>`}
          </div>
          <details><summary>Détail</summary><ul class="au-changes">${e.changes.map((c) => `<li>${OP[c.op] || ""} <code>${esc(c.table)} #${c.id}</code>${c.fields.length ? " : " + c.fields.map((f) => `${esc(f.key)} ${val(f.before)} &rarr; ${val(f.after)}`).join(" · ") : c.op === "create" ? " créée" : " supprimée"}</li>`).join("")}${e.more ? `<li class="muted">… et ${e.more} autre(s)</li>` : ""}</ul>
          ${e.undoNote ? `<p class="muted">Non annulé (changé depuis) : ${esc(e.undoNote)}</p>` : ""}</details>
        </li>`).join("")}</ol>` : `<p class="muted">Aucune action de l'équipe enregistrée pour l'instant.</p>`}`;
  }
  async function load() {
    try { entries = (await api("list", { limit: 150 })).entries || []; render(); }
    catch (e) { $("au-app").innerHTML = e.status === 404 || e.code === "not_found" ? `<p class="error-box">Le journal demande la mise à jour du serveur (route admin-audit).</p>` : `<p class="error-box">${esc(friendlyError(e))}</p>`; }
  }
  function wire() {
    const app = $("au-app");
    app.addEventListener("input", (e) => { if (e.target.id === "au-q") { filter = e.target.value; render(); const i = $("au-q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
    app.addEventListener("click", async (e) => {
      if (e.target.closest("#au-refresh")) { load(); return; }
      const b = e.target.closest("[data-undo]");
      if (!b) return;
      const en = entries.find((x) => x.id === Number(b.dataset.undo));
      if (!(await Confirm.show(`Annuler « ${esc(en.summary)} » ?<br><small>Les ressources données ou retirées sont rendues par écart : ce que le joueur a gagné depuis est gardé.</small>`, { title: "Annuler une action", confirmText: "Annuler l'action", dangerous: true }))) return;
      try {
        const r = await api("undo", { id: en.id });
        Toast.success(r.skipped.length ? `Annulé, sauf ${r.skipped.length} champ(s) modifié(s) depuis.` : "Action annulée.");
        load();
      } catch (err) { Toast.error(err.code === "already_undone" ? "Déjà annulée." : friendlyError(err)); }
    });
  }
  // Rafraichi apres une ecriture de l'equipe (dons, Tout voir...).
  window.AuditAdmin = { load };
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("au-app") || !Session.discordId) return;
    wire();
    if (typeof AdminNav !== "undefined") AdminNav.onFirstShow("tout", load); else load();
  });
})();
