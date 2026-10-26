// Admin > Joueurs (2026-10-26) : la fiche d'un joueur, pour reparer apres un
// bug. Ressources, XP / prestiges, energies, serie, tablettes, et chaque
// exemplaire de carte (finition, etat, edition, coffre, etoile, assurance,
// suppression). api/src/native/playeradmin.js (admin-player). Pour donner
// quelque chose en plus : bouton « Faire un don » (Codes & dons).

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const FIN = { normal: "Normale", holo: "Holo", gold: "Dorée", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel", emerald: "Émeraude" };
  const QUA = { damaged: "Usée", worn: "Abîmée", good: "Bon état", mint: "Parfait état" };
  const ERR = { field_not_editable: "Ce champ ne se modifie pas ici (page Base de données).", invalid_value: "Valeur refusée", pull_not_found: "Cet exemplaire n'existe plus.", nothing_to_change: "Rien à modifier.", unknown_user: "Joueur introuvable.", forbidden: "Accès réservé aux admins." };
  const errText = (e) => (ERR[e.code] ? ERR[e.code] + (e.data && e.data.field ? ` (${e.data.field}${e.data.max ? `, max ${e.data.max}` : ""})` : "") : friendlyError(e));
  const api = (action, params = {}) => API.post("adminPlayer", { discordId: Session.discordId, action, ...params });
  const date = (t) => (t ? new Date(t * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const RECENT_KEY = "2gatcha_admin_recent_players";
  let users = [], data = null, pullQ = "", pullLimit = 60, query = "";

  const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch (e) { return []; } };
  const remember = (id) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recent().filter((x) => x !== id)].slice(0, 8))); } catch (e) { /* stockage indisponible */ } };

  function picker() {
    const q = query.trim().toLowerCase();
    const list = q ? users.filter((u) => (u.pseudo || "").toLowerCase().includes(q) || String(u.userId) === q) : recent().map((id) => users.find((u) => u.userId === id)).filter(Boolean);
    return `
      <div class="pa-picker">
        <input type="search" id="pa-q" placeholder="Pseudo ou numéro du joueur…" value="${esc(query)}" autocomplete="off" />
        <div class="pa-results">${list.slice(0, 30).map((u) => `<button type="button" class="rw-chip ${data && data.user.userId === u.userId ? "on" : ""}" data-open="${u.userId}">${esc(u.pseudo || "#" + u.userId)}</button>`).join("") || `<small class="muted">${q ? "Aucun joueur." : "Cherche un joueur : les derniers ouverts s'affichent ici."}</small>`}</div>
      </div>`;
  }
  function render() {
    const app = $("pa-app");
    app.innerHTML = picker() + `<div id="pa-sheet">${data ? sheetHtml() : ""}</div>`;
    wire();
  }
  function fieldsHtml() {
    const groups = [...new Set(data.fields.map((f) => f.group))];
    return groups.map((g) => `
      <fieldset class="pa-group"><legend>${esc(g)}</legend><div class="pa-fields">${data.fields.filter((f) => f.group === g).map((f) => `
        <label class="pa-field" data-key="${f.key}"><span>${f.icon} ${esc(f.label)}</span>
          <input type="number" min="0" step="1" data-field="${f.key}" data-orig="${f.value}" value="${f.value}" />
          <small class="pa-delta"></small></label>`).join("")}
      ${g === "Ressources" ? data.tabletKinds.map((k) => `<label class="pa-field"><span>${k.icon} ${esc(k.label)}</span><input type="number" min="0" step="1" data-tablet="${k.key}" data-orig="${data.tablets[k.key] || 0}" value="${data.tablets[k.key] || 0}" /><small class="pa-delta"></small></label>`).join("") : ""}
      </div></fieldset>`).join("");
  }
  function pullsHtml() {
    const q = pullQ.trim().toLowerCase();
    const list = data.pulls.filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.serial) === q.replace("#", "") || (p.rarity?.name || "").toLowerCase().includes(q));
    const o = data.options;
    const sel = (name, opts, val, label) => `<select data-pf="${name}">${opts.map((k) => `<option value="${k}" ${k === val ? "selected" : ""}>${esc(label(k))}</option>`).join("")}</select>`;
    return `
      <div class="pa-pull-bar"><input type="search" id="pa-pull-q" placeholder="Filtrer les cartes (nom, rareté, numéro)…" value="${esc(pullQ)}" /><small class="muted">${list.length} exemplaire${list.length > 1 ? "s" : ""} sur ${data.pulls.length}</small></div>
      <div class="table-scroll"><table class="admin-table pa-pulls"><thead><tr><th>Carte</th><th>Finition</th><th>État</th><th>Édition</th><th>Coffre</th><th>★ / 🛡️</th><th></th></tr></thead><tbody>
      ${list.slice(0, pullLimit).map((p) => `<tr data-pull="${p.pullId}">
        <td class="pa-card"><img src="${API.imageUrl(p.imageId) || PLACEHOLDER_IMG}" alt="" loading="lazy" /><span><strong>${esc(p.name)}</strong><small style="color:${rarityTextColor(p.rarity?.colorHex || "#9aa0b4")}">${esc(p.rarity?.name || "")} · #${String(p.serial ?? 0).padStart(3, "0")}</small><small class="muted">${date(p.obtainedAt)}</small></span></td>
        <td>${sel("finish", o.finishes, p.finish, (k) => FIN[k] || k)}</td>
        <td>${sel("quality", o.qualities, p.quality, (k) => QUA[k] || k)}</td>
        <td><select data-pf="edition"><option value="">—</option>${o.editions.map((e) => `<option value="${e.key}" ${e.key === p.edition ? "selected" : ""}>${e.icon} ${esc(e.label)}</option>`).join("")}</select></td>
        <td><input type="checkbox" data-pf="inVault" ${p.inVault ? "checked" : ""} title="Rangée au coffre-fort${p.locked ? " (émeraude verrouillée)" : ""}" /></td>
        <td><input type="checkbox" data-pf="starred" ${p.starred ? "checked" : ""} title="★ Favori protégé" /> <input type="checkbox" data-pf="insured" ${p.insured ? "checked" : ""} title="🛡️ Assurée" /></td>
        <td class="pa-row-actions"><button type="button" class="btn-ghost" data-save-pull hidden>✓ Enregistrer</button><button type="button" class="btn-ghost danger" data-del-pull title="Supprimer cet exemplaire">🗑</button></td>
      </tr>`).join("")}
      </tbody></table></div>
      ${list.length > pullLimit ? `<button type="button" class="btn-ghost" id="pa-more">Afficher plus (${list.length - pullLimit})</button>` : ""}`;
  }
  function sheetHtml() {
    const u = data.user, lv = data.levels;
    return `
      <header class="pa-head">
        <div><h3>${esc(u.pseudo || "#" + u.userId)} <small class="muted">#${u.userId}${u.discordId ? " · Discord " + esc(u.discordId) : ""}</small></h3>
          <small class="muted">Inscrit le ${date(u.createdAt)} · vu le ${date(u.lastSeenAt)}</small>
          <div class="pa-levels"><span class="rw-pill">Profil niv. ${lv.profile}</span><span class="rw-pill">Fouille ${lv.dig}</span>${lv.fishing ? `<span class="rw-pill">Pêche ${lv.fishing}</span>` : ""}<span class="rw-pill">Expédition ${lv.expedition}</span><span class="rw-pill">Jardin ${lv.garden}</span></div></div>
        <div class="pa-head-actions">
          <button type="button" class="btn-secondary" data-gift="${u.userId}">🎁 Faire un don</button>
          <a class="btn-ghost" href="profile.html?pseudo=${encodeURIComponent(u.pseudo || "")}" target="_blank" rel="noopener">👤 Profil</a>
          <a class="btn-ghost" href="admin-db.html#tables" target="_blank" rel="noopener">🗄️ Base de données</a>
        </div>
      </header>
      <p class="muted pa-warn">⚠️ Outil de réparation : les valeurs remplacent celles du joueur (pas d'ajout). Chaque changement est inscrit au journal de l'économie. Pour <em>ajouter</em> quelque chose, préfère « Faire un don ».</p>
      <form id="pa-form">${fieldsHtml()}
        <div class="pa-save"><span id="pa-pending" class="muted">Aucune modification.</span><button type="button" class="btn-ghost" id="pa-undo" hidden>Annuler</button><button type="submit" class="btn" id="pa-save" disabled>Enregistrer</button></div>
      </form>
      <h3>🎴 Cartes</h3>
      <div id="pa-pulls">${pullsHtml()}</div>`;
  }

  function pending() {
    const ch = [];
    document.querySelectorAll("#pa-form input[data-orig]").forEach((i) => {
      const o = Number(i.dataset.orig), v = Number(i.value);
      const d = i.parentElement.querySelector(".pa-delta");
      const diff = v - o;
      i.parentElement.classList.toggle("changed", diff !== 0);
      d.textContent = diff ? (diff > 0 ? "+" : "") + diff.toLocaleString("fr-FR") : "";
      if (diff) ch.push({ el: i, label: i.parentElement.querySelector("span").textContent.trim(), from: o, to: v });
    });
    $("pa-pending").textContent = ch.length ? `${ch.length} modification${ch.length > 1 ? "s" : ""} en attente` : "Aucune modification.";
    $("pa-save").disabled = !ch.length;
    $("pa-undo").hidden = !ch.length;
    return ch;
  }
  async function open(id) {
    try { data = await api("get", { targetUserId: id }); remember(id); pullQ = ""; pullLimit = 60; render(); }
    catch (e) { Toast.error(errText(e)); }
  }
  function wire() {
    const q = $("pa-q");
    q.oninput = () => { query = q.value; const pos = q.selectionStart; render(); const n = $("pa-q"); n.focus(); n.setSelectionRange(pos, pos); };
    $("pa-app").querySelector(".pa-results").onclick = (e) => { const b = e.target.closest("[data-open]"); if (b) open(Number(b.dataset.open)); };
    if (!data) return;
    const form = $("pa-form");
    form.oninput = pending;
    $("pa-undo").onclick = () => { form.querySelectorAll("input[data-orig]").forEach((i) => { i.value = i.dataset.orig; }); pending(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const ch = pending();
      if (!ch.length) return;
      if (!(await Confirm.show(`Modifier <strong>${esc(data.user.pseudo)}</strong> :<br>${ch.map((c) => `${esc(c.label)} : ${c.from.toLocaleString("fr-FR")} → <strong>${c.to.toLocaleString("fr-FR")}</strong>`).join("<br>")}`, { title: "Confirmer la correction", confirmText: "Enregistrer" }))) return;
      const fields = {}, tablets = {};
      ch.forEach((c) => { if (c.el.dataset.field) fields[c.el.dataset.field] = c.to; else tablets[c.el.dataset.tablet] = c.to; });
      try { data = await api("set", { targetUserId: data.user.userId, fields, ...(Object.keys(tablets).length ? { tablets } : {}) }); Toast.success("Fiche mise à jour."); render(); }
      catch (err) { Toast.error(errText(err)); }
    };
    const pz = $("pa-pulls");
    const pq = $("pa-pull-q");
    pq.oninput = () => { pullQ = pq.value; const pos = pq.selectionStart; pz.innerHTML = pullsHtml(); wire(); const n = $("pa-pull-q"); n.focus(); n.setSelectionRange(pos, pos); };
    pz.onchange = (e) => { const tr = e.target.closest("tr[data-pull]"); if (tr) tr.querySelector("[data-save-pull]").hidden = false; };
    pz.onclick = async (e) => {
      if (e.target.id === "pa-more") { pullLimit += 100; pz.innerHTML = pullsHtml(); wire(); return; }
      const tr = e.target.closest("tr[data-pull]");
      if (!tr) return;
      const pullId = Number(tr.dataset.pull);
      const p = data.pulls.find((x) => x.pullId === pullId);
      if (e.target.closest("[data-save-pull]")) {
        const v = (k) => tr.querySelector(`[data-pf="${k}"]`);
        const changes = { finish: v("finish").value, quality: v("quality").value, edition: v("edition").value, inVault: v("inVault").checked, starred: v("starred").checked, insured: v("insured").checked };
        try { data = await api("pull", { targetUserId: data.user.userId, pullId, changes }); Toast.success(`${p.name} #${p.serial} mise à jour.`); pz.innerHTML = pullsHtml(); wire(); }
        catch (err) { Toast.error(errText(err)); }
        return;
      }
      if (e.target.closest("[data-del-pull]")) {
        if (!(await Confirm.show(`Supprimer définitivement <strong>${esc(p.name)} #${p.serial}</strong> (${esc(FIN[p.finish])}, ${esc(QUA[p.quality])}) de la collection de ${esc(data.user.pseudo)} ?`, { title: "Supprimer un exemplaire", confirmText: "Supprimer", dangerous: true }))) return;
        try { data = await api("pull", { targetUserId: data.user.userId, pullId, remove: true }); Toast.info("Exemplaire supprimé."); pz.innerHTML = pullsHtml(); wire(); }
        catch (err) { Toast.error(errText(err)); }
      }
    };
    $("pa-sheet").querySelector("[data-gift]").onclick = () => { if (window.RewardsAdmin) RewardsAdmin.giftTo(data.user.userId); };
  }

  async function init() {
    const app = $("pa-app");
    if (!app || !Session.discordId) return;
    try { users = ((await API.listUsers()).users || []).slice().sort((a, b) => (a.pseudo || "").localeCompare(b.pseudo || "")); } catch (e) { users = []; }
    render();
    // Le serveur n'a pas encore la route : on le dit tout de suite.
    try { if (users[0]) await api("get", { targetUserId: users[0].userId }); }
    catch (e) { if (e.status === 404 || e.code === "not_found") app.insertAdjacentHTML("afterbegin", `<p class="error-box">La fiche joueur demande la mise à jour du serveur (route admin-player). En attendant : page Base de données.</p>`); }
  }
  window.PlayerAdmin = { open };
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0));
})();
