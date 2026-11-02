// Admin > Sante (2026-11-02, api/src/native/health.js) : le serveur en un coup
// d'oeil, sans ouvrir les journaux. Relu a l'ouverture et toutes les 30 s.
(function () {
  const esc = escHtml;
  const $ = (id) => document.getElementById(id);
  const ago = (iso) => { if (!iso) return "jamais"; const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 90 ? `il y a ${s} s` : s < 5400 ? `il y a ${Math.round(s / 60)} min` : s < 172800 ? `il y a ${Math.round(s / 3600)} h` : new Date(iso).toLocaleString("fr-FR"); };
  const up = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };
  const tile = (label, value, warn) => `<div class="stat-tile ${warn ? "adb-warn" : ""}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
  const rows = (list) => list.map((r) => `<tr><td><code>${esc(r.path)}</code></td><td>${r.count}</td><td>${r.p50} ms</td><td>${r.p95} ms</td><td>${r.failed || ""}</td></tr>`).join("");
  let timer = null;

  async function load() {
    const box = $("health-zone");
    if (!box) return;
    let h;
    try { h = await API.post("adminHealth", { discordId: Session.discordId }); } catch (e) { box.innerHTML = `<p class="error-box">${esc(e.code === "not_found" ? "Cette page demande la mise à jour du serveur." : friendlyError(e))}</p>`; return; }
    const d = h.discord || {};
    const lastDiscord = d.last ? `${d.last.ok ? "accepté" : `refusé (${d.last.status || d.last.detail})`}, ${ago(d.last.at)}` : "aucun envoi";
    const az = h.backups || {}, js = h.jsonBackups || {};
    box.innerHTML = `
      <div class="adb-summary">
        ${tile("En ligne depuis", up(h.uptimeSeconds))}
        ${tile("Requêtes (1 h)", h.requests.lastHour)}
        ${tile("Temps médian / lent", `${h.requests.p50} / ${h.requests.p95} ms`, h.requests.p95 > 800)}
        ${tile("Erreurs 5xx (1 h)", h.requests.failed, h.requests.failed > 0)}
        ${tile("Erreurs depuis le démarrage", h.errors.sinceStart, h.errors.sinceStart > 0)}
        ${tile("Mémoire", `${h.memoryMb} Mo`, h.memoryMb > 900)}
        ${tile("Base", `${h.database ? h.database.sizeMb : "?"} Mo · ${h.data.rows.toLocaleString("fr-FR")} lignes`)}
        ${tile("Joueurs en direct", h.live ? `${h.live.players} (${h.live.streams} onglets)` : "—")}
      </div>
      <div class="health-grid">
        <section><h3>&#128226; Discord</h3><p>Dernier envoi : ${esc(lastDiscord)}</p><p>Annonces parties en texte faute d'image : <strong>${d.textFallbacks || 0}</strong>${d.lastFallback ? ` (dernière ${ago(d.lastFallback.at)})` : ""}</p><p>En attente d'image : ${d.waiting || 0}</p></section>
        <section><h3>&#9729;&#65039; Sauvegardes</h3><p>Azure : ${az.enabled ? (az.lastError ? `<span class="adb-warn">échec ${ago(az.lastError.at)} : ${esc(az.lastError.message)}</span>` : `dernière ${ago(az.last && az.last.at)}`) : "non configurées"}</p>
          <p>Fichier JSON sur le serveur : ${js.lastError ? `<span class="adb-warn">échec ${ago(js.lastError.at)}</span>` : js.files && js.files.length ? `dernier ${ago(js.files[0].at)} (${js.files.length} gardé${js.files.length > 1 ? "s" : ""})` : "aucun pour l'instant"}</p></section>
        <section><h3>&#127922; Jeu</h3><p>Mode : ${h.mode ? `${h.mode.icon} ${esc(h.mode.label)}` : "?"}</p><p>${h.data.players} comptes · ${h.data.pulls.toLocaleString("fr-FR")} exemplaires</p></section>
      </div>
      <h3>Routes les plus lentes (dernière heure)</h3>
      <div class="adb-table-wrap"><table class="adb-table"><thead><tr><th>Route</th><th>Appels</th><th>Médiane</th><th>95 %</th><th>5xx</th></tr></thead><tbody>${rows(h.requests.slowest) || '<tr><td colspan="5">Rien pour l\'instant.</td></tr>'}</tbody></table></div>
      <h3>Dernières erreurs (aussi dans GlitchTip)</h3>
      ${h.errors.recent.length ? `<ul class="health-errors">${h.errors.recent.map((e) => `<li><small>${ago(e.at)}${e.where ? ` · ${esc(e.where)}` : ""}</small> ${esc(e.message)}</li>`).join("")}</ul>` : "<p class=\"muted\">Aucune erreur depuis le démarrage.</p>"}
      <p class="muted">Relu toutes les 30 s · démarré le ${new Date(h.startedAt).toLocaleString("fr-FR")}.</p>`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const start = () => { load(); clearInterval(timer); timer = setInterval(() => { if (document.visibilityState === "visible" && $("pane-sante") && !$("pane-sante").hidden) load(); }, 30000); };
    if (typeof AdminNav !== "undefined" && AdminNav.onFirstShow) AdminNav.onFirstShow("sante", start); else setTimeout(start, 0);
  });
})();
