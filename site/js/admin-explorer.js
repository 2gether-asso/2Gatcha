// Admin > Tout voir (2026-10-29) : toutes les tables de la base, a lire et a
// modifier sans quitter la page Admin (api/src/native/explorer.js,
// admin-explorer). Recherche libre ou « Colonne=valeur » (aussi ~ contient,
// > et <), tri par colonne, pagination ; une reference ouvre la ligne visee ;
// un clic sur une ligne ouvre l'editeur de tous ses champs (seuls les champs
// changes sont envoyes), avec duplication et suppression.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const ERR = { unknown_table: "Table introuvable.", unknown_row: "Ligne introuvable (supprimée ?).", unknown_column: "Colonne inconnue", formula_column: "Colonne calculée : non modifiable", invalid_json: "JSON invalide", nothing_to_change: "Rien à modifier.", write_failed: "Écriture refusée", forbidden: "Accès réservé aux admins." };
  const errText = (e) => (ERR[e.code] ? ERR[e.code] + (e.data && (e.data.column || e.data.message) ? ` (${esc(e.data.column || e.data.message)})` : "") : friendlyError(e));
  const api = (action, params = {}) => API.post("adminExplorer", { discordId: Session.discordId, action, ...params }).then((r) => {
    // Ecriture : visible tout de suite dans le journal de l'equipe (admin-audit.js).
    if (["set", "create", "delete"].includes(action) && window.AuditAdmin) AuditAdmin.load();
    return r;
  });
  const LAST_KEY = "2gatcha_admin_explorer";
  const st = { tables: [], tableQ: "", table: null, q: "", sort: "id", desc: false, offset: 0, limit: 50, data: null };

  const isDate = (c) => c.base === "DateTime" || c.base === "Date" || /(At|Until|Since|Time)$/.test(c.id);
  const fmtDate = (v) => (Number(v) > 1e8 ? new Date(Number(v) * 1000).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  const text = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  function cell(c, v) {
    const refs = (st.data && st.data.refs && c.ref && st.data.refs[c.ref]) || {};
    if (c.ref && (Array.isArray(v) || Number(v) > 0)) {
      const ids = Array.isArray(v) ? v.slice(v[0] === "L" ? 1 : 0) : [v];
      return ids.map((id) => `<button type="button" class="ex-ref" data-ref-table="${esc(c.ref)}" data-ref-id="${id}" title="Ouvrir ${esc(c.ref)} #${id}">${esc(refs[id] || "#" + id)}</button>`).join(" ");
    }
    if (c.base === "Bool") return v ? "&#10004;" : "<span class=\"muted\">—</span>";
    if (v == null || v === "") return "<span class=\"muted\">—</span>";
    if (isDate(c) && Number(v) > 1e8) return `<span title="${esc(String(v))}">${esc(fmtDate(v))}</span>`;
    return esc(text(v));
  }

  function sidebar() {
    const q = st.tableQ.trim().toLowerCase();
    return `<aside class="ex-side">
      <input type="search" id="ex-tq" placeholder="Filtrer les tables…" value="${esc(st.tableQ)}" autocomplete="off" />
      <div class="ex-tables">${st.tables.filter((t) => !q || t.name.toLowerCase().includes(q)).map((t) => `<button type="button" class="ex-table ${t.name === st.table ? "on" : ""}" data-table="${esc(t.name)}"><span>${esc(t.name)}</span><small>${t.rows}</small></button>`).join("")}</div>
    </aside>`;
  }
  function grid() {
    const d = st.data;
    if (!st.table) return `<p class="muted ex-empty">Choisis une table à gauche : joueurs (Users), cartes (Cards), exemplaires (Pulls), réglages (AppSettings)…</p>`;
    if (!d) return `<div class="loading-row"><div class="spinner"></div></div>`;
    const cols = d.columns;
    const pages = Math.max(1, Math.ceil(d.total / d.limit)), page = Math.floor(d.offset / d.limit) + 1;
    return `
      <div class="ex-bar">
        <strong class="ex-title">${esc(d.table)}</strong>
        <input type="search" id="ex-q" placeholder="Chercher… ou Colonne=valeur, Colonne~texte, Colonne>10" value="${esc(st.q)}" autocomplete="off" />
        <button type="button" class="btn-ghost" data-ex-new>&#10133; Nouvelle ligne</button>
      </div>
      <p class="ex-count muted">${d.total} ligne${d.total > 1 ? "s" : ""}${st.q ? " trouvée" + (d.total > 1 ? "s" : "") : ""} · tri ${esc(d.sort)} ${d.desc ? "&#8595;" : "&#8593;"}</p>
      <div class="ex-wrap"><table class="ex-grid">
        <thead><tr>${["id", ...cols.map((c) => c.id)].map((k) => `<th><button type="button" data-sort="${esc(k)}" class="${d.sort === k ? "on" : ""}">${esc(k)}${d.sort === k ? (d.desc ? " &#8595;" : " &#8593;") : ""}</button></th>`).join("")}</tr></thead>
        <tbody>${d.rows.map((r) => `<tr data-row="${r.id}" tabindex="0"><td class="ex-id">${r.id}</td>${cols.map((c) => `<td>${cell(c, r[c.id])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length + 1}" class="muted">Aucune ligne.</td></tr>`}</tbody>
      </table></div>
      <div class="ex-pager">
        <button type="button" class="btn-ghost" data-page="-1" ${page <= 1 ? "disabled" : ""}>&#8592;</button>
        <span>Page ${page} / ${pages}</span>
        <button type="button" class="btn-ghost" data-page="1" ${page >= pages ? "disabled" : ""}>&#8594;</button>
        <select id="ex-limit">${[25, 50, 100, 200].map((n) => `<option value="${n}" ${n === d.limit ? "selected" : ""}>${n} / page</option>`).join("")}</select>
      </div>`;
  }
  function render() {
    $("ex-app").innerHTML = `<div class="ex-layout">${sidebar()}<div class="ex-main" id="ex-main">${grid()}</div></div>`;
  }
  const save = () => { try { localStorage.setItem(LAST_KEY, JSON.stringify({ table: st.table, q: st.q, sort: st.sort, desc: st.desc, limit: st.limit })); } catch (e) { /* stockage indisponible */ } };

  async function load() {
    if (!st.table) { render(); return; }
    save();
    try { st.data = await api("rows", { table: st.table, q: st.q, sort: st.sort, desc: st.desc, offset: st.offset, limit: st.limit }); }
    catch (e) { st.data = null; Toast.error(errText(e)); }
    const main = $("ex-main");
    const focused = document.activeElement && document.activeElement.id === "ex-q";
    if (main) { main.innerHTML = grid(); if (focused) { const q = $("ex-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    else render();
  }
  function openTable(name, q = "") {
    Object.assign(st, { table: name, q, offset: 0, sort: "id", desc: false, data: null });
    render();
    load();
  }

  // Editeur d'une ligne : un champ par colonne, selon son type.
  function field(c, v) {
    const val = text(v);
    const id = "exf-" + c.id;
    const ro = c.formula ? "disabled" : "";
    let input;
    if (c.base === "Bool") input = `<input type="checkbox" id="${id}" data-col="${esc(c.id)}" data-orig="${v ? "1" : "0"}" ${v ? "checked" : ""} ${ro} />`;
    else if (["Numeric", "Int", "Ref", "Date", "DateTime"].includes(c.base)) input = `<input type="text" inputmode="decimal" id="${id}" data-col="${esc(c.id)}" data-orig="${esc(val)}" value="${esc(val)}" ${ro} />`;
    else if (val.length > 60 || /^[[{]/.test(val) || ["RefList", "Attachments", "ChoiceList"].includes(c.base)) input = `<textarea id="${id}" rows="${Math.min(12, Math.max(2, Math.ceil(val.length / 70)))}" data-col="${esc(c.id)}" data-orig="${esc(val)}" ${ro}>${esc(val)}</textarea>${/^[[{]/.test(val) ? `<button type="button" class="btn-ghost ex-fmt" data-fmt="${id}">Formater le JSON</button>` : ""}`;
    else input = `<input type="text" id="${id}" data-col="${esc(c.id)}" data-orig="${esc(val)}" value="${esc(val)}" ${ro} />`;
    const hint = isDate(c) && Number(v) > 1e8 ? fmtDate(v) : c.ref && Number(v) > 0 ? `→ ${c.ref}` : "";
    return `<label class="ex-field" for="${id}"><span><strong>${esc(c.id)}</strong> <small class="muted">${esc(c.type)}${c.formula ? " · calculée" : ""}</small></span>${input}${hint ? `<small class="muted">${esc(hint)}</small>` : ""}</label>`;
  }
  function changes(box) {
    const out = {};
    box.querySelectorAll("[data-col]").forEach((el) => {
      const now = el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value;
      if (now !== el.dataset.orig) out[el.dataset.col] = el.type === "checkbox" ? el.checked : now;
    });
    return out;
  }
  async function openRow(table, id, isNew = false, copy = null) {
    let res;
    try { res = isNew ? { table, columns: (st.data && st.table === table ? st.data.columns : (await api("rows", { table, limit: 1 })).columns), row: copy || { id: null } } : await api("row", { table, id }); }
    catch (e) { Toast.error(errText(e)); return; }
    const row = res.row;
    const ov = document.createElement("div");
    ov.className = "ex-modal-bg";
    ov.innerHTML = `<div class="ex-modal" role="dialog" aria-modal="true" aria-label="${esc(table)} ${row.id ? "#" + row.id : "nouvelle ligne"}">
      <header class="ex-modal-head"><h3>${esc(table)} ${row.id ? "#" + row.id : "· nouvelle ligne"}</h3><button type="button" class="btn-ghost" data-close aria-label="Fermer">&#10005;</button></header>
      <div class="ex-fields">${res.columns.map((c) => field(c, isNew && !copy ? undefined : row[c.id])).join("")}</div>
      <footer class="ex-modal-foot">
        ${row.id && !isNew ? `<button type="button" class="btn-ghost danger" data-del>Supprimer</button><button type="button" class="btn-ghost" data-dup>Dupliquer</button>` : ""}
        <span class="ex-changed muted" aria-live="polite"></span>
        <button type="button" class="btn" data-save>${isNew ? "Créer" : "Enregistrer"}</button>
      </footer></div>`;
    document.body.appendChild(ov);
    if (typeof syncScrollLock === "function") syncScrollLock();
    const close = () => { ov.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); };
    const box = ov.querySelector(".ex-modal");
    const count = () => { const n = Object.keys(changes(box)).length; ov.querySelector(".ex-changed").textContent = n ? `${n} champ${n > 1 ? "s" : ""} modifié${n > 1 ? "s" : ""}` : ""; };
    box.addEventListener("input", count);
    box.addEventListener("change", count);
    ov.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    ov.addEventListener("click", async (e) => {
      if (e.target === ov || e.target.closest("[data-close]")) { close(); return; }
      const f = e.target.closest("[data-fmt]");
      if (f) { const ta = $(f.dataset.fmt); try { ta.value = JSON.stringify(JSON.parse(ta.value), null, 2); ta.rows = Math.min(20, ta.value.split("\n").length + 1); count(); } catch (err) { Toast.error("JSON invalide."); } return; }
      if (e.target.closest("[data-dup]")) { close(); openRow(table, null, true, { ...row, id: null }); return; }
      if (e.target.closest("[data-del]")) {
        if (!(await Confirm.show(`Supprimer définitivement <strong>${esc(table)} #${row.id}</strong> ? Impossible à annuler (une sauvegarde reste possible depuis la page Base de données).`, { title: "Supprimer une ligne", confirmText: "Supprimer", dangerous: true }))) return;
        try { await api("delete", { table, id: row.id }); Toast.info("Ligne supprimée."); close(); load(); } catch (err) { Toast.error(errText(err)); }
        return;
      }
      if (e.target.closest("[data-save]")) {
        const fields = isNew ? Object.fromEntries([...box.querySelectorAll("[data-col]")].filter((el) => !el.disabled && (el.type === "checkbox" || el.value !== "")).map((el) => [el.dataset.col, el.type === "checkbox" ? el.checked : el.value])) : changes(box);
        if (!isNew && !Object.keys(fields).length) { Toast.info("Rien à modifier."); return; }
        try {
          const r = await api(isNew ? "create" : "set", { table, id: row.id, fields });
          Toast.success(isNew ? `Ligne #${r.row.id} créée.` : `${Object.keys(fields).length} champ(s) enregistré(s).`);
          close();
          if (st.table === table) load();
        } catch (err) { Toast.error(errText(err)); }
      }
    });
    setTimeout(() => box.querySelector("[data-col]:not([disabled])")?.focus(), 30);
  }

  let typing = null;
  function wire() {
    const app = $("ex-app");
    app.addEventListener("input", (e) => {
      if (e.target.id === "ex-tq") { st.tableQ = e.target.value; app.querySelector(".ex-side").outerHTML = sidebar(); const t = $("ex-tq"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return; }
      if (e.target.id === "ex-q") { st.q = e.target.value; st.offset = 0; clearTimeout(typing); typing = setTimeout(load, 300); }
    });
    app.addEventListener("change", (e) => { if (e.target.id === "ex-limit") { st.limit = Number(e.target.value) || 50; st.offset = 0; load(); } });
    app.addEventListener("click", (e) => {
      const t = e.target.closest("[data-table]");
      if (t) { openTable(t.dataset.table); return; }
      const ref = e.target.closest("[data-ref-table]");
      if (ref) { e.stopPropagation(); openRow(ref.dataset.refTable, Number(ref.dataset.refId)); return; }
      const s = e.target.closest("[data-sort]");
      if (s) { if (st.sort === s.dataset.sort) st.desc = !st.desc; else { st.sort = s.dataset.sort; st.desc = false; } st.offset = 0; load(); return; }
      const p = e.target.closest("[data-page]");
      if (p) { st.offset = Math.max(0, st.offset + Number(p.dataset.page) * st.limit); load(); return; }
      if (e.target.closest("[data-ex-new]")) { openRow(st.table, null, true); return; }
      const r = e.target.closest("tr[data-row]");
      if (r) openRow(st.table, Number(r.dataset.row));
    });
    app.addEventListener("keydown", (e) => { const r = e.target.closest && e.target.closest("tr[data-row]"); if (r && e.key === "Enter") openRow(st.table, Number(r.dataset.row)); });
  }

  async function init() {
    const app = $("ex-app");
    if (!app || !Session.discordId) return;
    try { st.tables = (await api("tables")).tables || []; }
    catch (e) {
      app.innerHTML = e.status === 404 || e.code === "not_found" ? `<p class="error-box">« Tout voir » demande la mise à jour du serveur (route admin-explorer). En attendant : page Base de données.</p>` : `<p class="error-box">${errText(e)}</p>`;
      return;
    }
    try { const last = JSON.parse(localStorage.getItem(LAST_KEY) || "null"); if (last && st.tables.some((t) => t.name === last.table)) Object.assign(st, last); } catch (e) { /* stockage indisponible */ }
    render();
    wire();
    load();
  }
  // Ouvre une table filtree depuis une autre rubrique (ex. fiche joueur).
  window.ExplorerAdmin = { open(table, q = "") { if (typeof AdminNav !== "undefined") AdminNav.show("tout"); setTimeout(() => openTable(table, q), 60); }, row: openRow };
  document.addEventListener("DOMContentLoaded", () => { if (typeof AdminNav !== "undefined") AdminNav.onFirstShow("tout", init); else init(); });
})();
