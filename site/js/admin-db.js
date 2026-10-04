// Admin - Base de donnees (admin-db.html) : parle directement a l'API maison
// (routes /admin/api/..., voir api/src/admin.js), protegee par ADMIN_TOKEN.
//   - Images : import groupe par extension (association par nom de fichier
//     d'origine), remplacement unitaire ; conversion WebP + redimensionnement
//     faits ICI, dans le navigateur, avant l'envoi.
//   - Tables : edition directe des lignes (remplace l'edition dans Grist).

const ADB_URL_KEY = "2gatcha_admin_api_url";
const ADB_TOKEN_KEY = "2gatcha_admin_token";

const adb = {
  apiUrl: "",
  token: "",
  images: [],
  extensions: [],
  tables: [],
  table: null,
  offset: 0,
  limit: 100,
  total: 0,
  rows: [],
  plan: []
};

function adbStore(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) {}
}
function adbLoad(key) {
  try { return localStorage.getItem(key) || ""; } catch (e) { return ""; }
}

// Adresse de l'API par defaut : celle du site si elle pointe deja vers l'API
// maison (pas vers n8n), sinon l'origine de la page (conteneur qui sert
// aussi le site).
function defaultApiUrl() {
  const base = (window.APP_CONFIG && window.APP_CONFIG.n8nBaseUrl) || "";
  if (base && !base.includes("n8n.")) {
    try { return new URL(base, window.location.href).origin; } catch (e) {}
  }
  return window.location.origin;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return n + " o";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " Ko";
  return (n / 1024 / 1024).toFixed(2) + " Mo";
}

async function adbFetch(path, options = {}) {
  const res = await fetch(adb.apiUrl.replace(/\/$/, "") + path, {
    ...options,
    headers: { Authorization: `Bearer ${adb.token}`, ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function adbImageUrl(id) {
  return `${adb.apiUrl.replace(/\/$/, "")}/webhook/image?id=${id}`;
}

// ------------------------------------------------------------- conversion
// Redimensionne (cote le plus long <= maxSize, jamais d'agrandissement) puis
// encode en WebP. Si le navigateur ne sait pas produire du WebP, on garde le
// fichier d'origine.
async function toWebp(file, maxSize, quality) {
  if (file.type === "image/svg+xml") return { blob: file, width: null, height: null };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close && bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob || blob.type !== "image/webp") return { blob: file, width, height };
  // Une image deja tres compressee peut grossir en WebP : on garde la plus
  // legere des deux si aucun redimensionnement n'etait necessaire.
  if (scale === 1 && blob.size >= file.size && /^image\/(webp|jpeg)$/.test(file.type)) return { blob: file, width, height };
  return { blob, width, height };
}

function webpName(name) {
  return String(name || "image").replace(/\.[^.]+$/, "") + ".webp";
}

async function uploadImage({ method, path, blob, fileName }) {
  return adbFetch(path, { method, headers: { "Content-Type": blob.type, "X-File-Name": encodeURIComponent(fileName) }, body: blob });
}

// ------------------------------------------------------------- connexion
async function connect(e) {
  if (e) e.preventDefault();
  const errBox = document.getElementById("adb-login-error");
  errBox.style.display = "none";
  adb.apiUrl = document.getElementById("adb-api-url").value.trim();
  adb.token = document.getElementById("adb-token").value.trim();
  try {
    const { tables } = await adbFetch("/admin/api/tables");
    adb.tables = tables;
    adbStore(ADB_URL_KEY, adb.apiUrl);
    adbStore(ADB_TOKEN_KEY, adb.token);
    document.getElementById("adb-login").style.display = "none";
    document.getElementById("adb-zone").style.display = "";
    fillTableSelect();
    await loadImages();
  } catch (err) {
    errBox.textContent = err.status === 401 ? "Mot de passe incorrect." : err.status === 503 ? "Administration désactivée : ADMIN_TOKEN n'est pas configuré sur le serveur." : `Connexion impossible (${err.message}). Vérifie l'adresse de l'API.`;
    errBox.style.display = "";
  }
}

function logout() {
  adbStore(ADB_TOKEN_KEY, null);
  window.location.reload();
}

function setTab(tab) {
  ["images", "tables", "backups"].forEach((t) => {
    const btn = document.getElementById(`adb-tab-${t}`);
    btn.classList.toggle("active", t === tab);
    btn.setAttribute("aria-selected", String(t === tab));
    document.getElementById(`adb-${t}-pane`).style.display = t === tab ? "" : "none";
  });
  if (tab === "tables" && !adb.table && adb.tables.length) loadRows(document.getElementById("adb-table").value);
  if (tab === "backups") loadBackups();
}

// ------------------------------------------------------------- images
async function loadImages() {
  const { images, extensions } = await adbFetch("/admin/api/images");
  adb.images = images;
  adb.extensions = extensions;
  const extOptions = extensions.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("");
  const bulk = document.getElementById("adb-bulk-ext");
  const keepBulk = bulk.value;
  bulk.innerHTML = `<option value="">Toutes les extensions</option>${extOptions}`;
  bulk.value = keepBulk;
  const filterExt = document.getElementById("adb-img-ext");
  const keepFilter = filterExt.value;
  filterExt.innerHTML = `<option value="">Toutes les extensions</option>${extOptions}`;
  filterExt.value = keepFilter;
  const missing = images.filter((i) => i.missing).length;
  const total = images.reduce((s, i) => s + (i.size || 0), 0);
  document.getElementById("adb-img-summary").innerHTML = `
    <div class="stat-tile"><div class="stat-value">${images.length}</div><div class="stat-label">Images</div></div>
    <div class="stat-tile ${missing ? "adb-warn" : ""}"><div class="stat-value">${missing}</div><div class="stat-label">Manquantes</div></div>
    <div class="stat-tile"><div class="stat-value">${formatBytes(total)}</div><div class="stat-label">Poids total</div></div>`;
  renderImageGrid();
}

function imageExtensions(img) {
  return new Set(img.usedBy.map((u) => (u.table === "Extensions" ? u.rowId : u.extension)).filter((x) => x != null).map(Number));
}

function extName(id) {
  const x = adb.extensions.find((e) => e.id === Number(id));
  return x ? x.name : "";
}

function usageLabel(img) {
  if (!img.usedBy.length) return "<em>Non utilisée</em>";
  return img.usedBy.slice(0, 3).map((u) => {
    const ext = u.table === "Cards" && u.extension ? ` · ${escapeHtml(extName(u.extension))}` : "";
    const kind = u.table === "Cards" ? "" : `${escapeHtml(u.table)}.${escapeHtml(u.column)} `;
    return `${kind}<strong>${escapeHtml(u.label)}</strong>${ext}`;
  }).join("<br>") + (img.usedBy.length > 3 ? `<br>+${img.usedBy.length - 3}` : "");
}

function renderImageGrid() {
  const filter = document.getElementById("adb-img-filter").value;
  const ext = document.getElementById("adb-img-ext").value;
  let list = adb.images;
  if (filter === "missing") list = list.filter((i) => i.missing);
  if (ext) list = list.filter((i) => imageExtensions(i).has(Number(ext)));
  const grid = document.getElementById("adb-img-grid");
  if (!list.length) {
    grid.innerHTML = `<p class="adb-help">${filter === "missing" ? "Aucune image manquante 🎉" : "Aucune image."}</p>`;
    return;
  }
  grid.innerHTML = list.slice(0, 400).map((img) => `
    <div class="adb-img ${img.missing ? "missing" : ""}">
      <div class="adb-img-thumb">${img.missing ? `<span>Manquante</span>` : `<img src="${adbImageUrl(img.id)}" alt="" loading="lazy" />`}</div>
      <div class="adb-img-meta">
        <div class="adb-img-name">#${img.id} ${escapeHtml(img.fileName || "")}</div>
        <div class="adb-img-size">${img.missing ? "" : `${formatBytes(img.size)} · ${escapeHtml((img.mime || "").replace("image/", ""))}`}</div>
        <div class="adb-img-usage">${usageLabel(img)}</div>
        <label class="btn-secondary adb-replace">${img.missing ? "Importer" : "Remplacer"}<input type="file" accept="image/*" data-replace-id="${img.id}" hidden /></label>
      </div>
    </div>`).join("") + (list.length > 400 ? `<p class="adb-help">${list.length - 400} image(s) de plus : filtre par extension.</p>` : "");
}

async function replaceOne(id, file) {
  const maxSize = Number(document.getElementById("adb-max-size").value) || 900;
  const quality = Number(document.getElementById("adb-quality").value) / 100;
  try {
    const { blob } = await toWebp(file, maxSize, quality);
    const img = adb.images.find((i) => i.id === id);
    await uploadImage({ method: "PUT", path: `/admin/api/images/${id}`, blob, fileName: webpName((img && img.fileName) || file.name) });
    Toast.success(`Image #${id} importée (${formatBytes(file.size)} → ${formatBytes(blob.size)}).`);
    await loadImages();
  } catch (err) {
    Toast.error(`Échec de l'import : ${err.message}`);
  }
}

// --- import groupe ---------------------------------------------------------
function baseName(name) {
  return String(name || "").toLowerCase().replace(/\.[^.]+$/, "").trim();
}

function buildPlan(files) {
  const ext = document.getElementById("adb-bulk-ext").value;
  const onlyMissing = document.getElementById("adb-only-missing").checked;
  const candidates = adb.images.filter((img) => img.fileName && (!ext || imageExtensions(img).has(Number(ext))) && (!onlyMissing || img.missing));
  const byName = new Map();
  for (const img of candidates) {
    const k = baseName(img.fileName);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(img);
  }
  return files.map((file) => {
    const matches = byName.get(baseName(file.name)) || [];
    if (matches.length === 1) return { file, target: matches[0], status: "ok" };
    if (matches.length > 1) return { file, matches, status: "ambiguous" };
    return { file, status: "none" };
  });
}

function renderPlan() {
  const box = document.getElementById("adb-plan");
  if (!adb.plan.length) { box.innerHTML = ""; return; }
  const ok = adb.plan.filter((p) => p.status === "ok");
  const rows = adb.plan.map((p, i) => {
    let target;
    if (p.status === "ok") target = `#${p.target.id} ${usageLabel(p.target)}${p.target.missing ? "" : ' <span class="adb-tag">remplacement</span>'}`;
    else if (p.status === "ambiguous") target = `<select data-plan-index="${i}"><option value="">${p.matches.length} images portent ce nom : choisir…</option>${p.matches.map((m) => `<option value="${m.id}">#${m.id} ${escapeHtml(m.usedBy.map((u) => u.label + (u.extension ? " · " + extName(u.extension) : "")).join(", "))}</option>`).join("")}</select>`;
    else target = `<span class="adb-tag adb-tag-warn">aucune correspondance</span>`;
    return `<tr class="adb-plan-${p.status}" data-plan-row="${i}"><td>${escapeHtml(p.file.name)}</td><td>${formatBytes(p.file.size)}</td><td>${target}</td><td class="adb-plan-result"></td></tr>`;
  }).join("");
  box.innerHTML = `
    <div class="adb-table-wrap"><table class="adb-table"><thead><tr><th>Fichier</th><th>Poids</th><th>Image cible</th><th>Résultat</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="adb-row">
      <button type="button" class="btn" id="adb-run-plan" ${ok.length ? "" : "disabled"}>Convertir et importer ${ok.length} image${ok.length > 1 ? "s" : ""}</button>
      <button type="button" class="btn-secondary" id="adb-clear-plan">Annuler</button>
      <span id="adb-plan-progress" class="adb-help"></span>
    </div>`;
  box.querySelectorAll("select[data-plan-index]").forEach((sel) => sel.addEventListener("change", () => {
    const p = adb.plan[Number(sel.dataset.planIndex)];
    const target = p.matches.find((m) => m.id === Number(sel.value));
    if (target) { p.target = target; p.status = "ok"; }
    renderPlan();
  }));
  document.getElementById("adb-run-plan").addEventListener("click", runPlan);
  document.getElementById("adb-clear-plan").addEventListener("click", () => { adb.plan = []; renderPlan(); });
}

async function runPlan() {
  const btn = document.getElementById("adb-run-plan");
  btn.disabled = true;
  const maxSize = Number(document.getElementById("adb-max-size").value) || 900;
  const quality = Number(document.getElementById("adb-quality").value) / 100;
  const todo = adb.plan.map((p, i) => ({ p, i })).filter(({ p }) => p.status === "ok");
  let done = 0, before = 0, after = 0, failed = 0;
  for (const { p, i } of todo) {
    const cell = document.querySelector(`[data-plan-row="${i}"] .adb-plan-result`);
    try {
      const { blob, width, height } = await toWebp(p.file, maxSize, quality);
      await uploadImage({ method: "PUT", path: `/admin/api/images/${p.target.id}`, blob, fileName: webpName(p.target.fileName || p.file.name) });
      before += p.file.size; after += blob.size;
      cell.innerHTML = `✅ ${formatBytes(blob.size)}${width ? ` · ${width}×${height}` : ""}`;
    } catch (err) {
      failed++;
      cell.innerHTML = `❌ ${escapeHtml(err.message)}`;
    }
    done++;
    document.getElementById("adb-plan-progress").textContent = `${done} / ${todo.length}`;
  }
  const gain = before ? Math.round((1 - after / before) * 100) : 0;
  Toast.success(`${done - failed} image(s) importée(s) : ${formatBytes(before)} → ${formatBytes(after)} (-${gain} %).`);
  await loadImages();
}

function onFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  adb.plan = buildPlan(files);
  renderPlan();
}

// ------------------------------------------------------------- tables
function fillTableSelect() {
  const sel = document.getElementById("adb-table");
  sel.innerHTML = adb.tables.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)} (${t.rows})</option>`).join("");
  if (adb.tables.some((t) => t.name === "Cards")) sel.value = "Cards";
}

async function loadRows(table, offset = 0) {
  adb.table = table;
  adb.offset = offset;
  const q = encodeURIComponent(document.getElementById("adb-search").value.trim());
  const data = await adbFetch(`/admin/api/tables/${encodeURIComponent(table)}/rows?offset=${offset}&limit=${adb.limit}&q=${q}`);
  adb.rows = data.rows;
  adb.total = data.total;
  adb.columns = data.columns;
  renderGrid();
  renderSchema();
}

function colType(col) {
  return String((adb.columns[col] || {}).type || "Any").split(":")[0];
}

function cellHtml(row, col) {
  const v = row[col];
  const type = colType(col);
  if (type === "Attachments") {
    const ids = Array.isArray(v) ? v.slice(v[0] === "L" ? 1 : 0) : [];
    return `${ids.map((id) => `<img class="adb-cell-img" src="${adbImageUrl(id)}" alt="#${id}" title="#${id}" loading="lazy" />`).join("")}<label class="adb-cell-upload" title="Changer l'image">&#128247;<input type="file" accept="image/*" data-upload-row="${row.id}" data-upload-col="${escapeHtml(col)}" hidden /></label>`;
  }
  if (type === "Bool") return v ? "✅" : "—";
  if (v == null || v === "") return '<span class="adb-null">—</span>';
  if (typeof v === "object") return `<code>${escapeHtml(JSON.stringify(v))}</code>`;
  if ((type === "DateTime" || type === "Date") && typeof v === "number" && v > 1e8) return `${v} <span class="adb-null">${new Date(v * 1000).toLocaleString("fr-FR")}</span>`;
  const s = String(v);
  return escapeHtml(s.length > 80 ? s.slice(0, 80) + "…" : s);
}

function renderGrid() {
  const cols = Object.keys(adb.columns);
  const grid = document.getElementById("adb-grid");
  grid.innerHTML = `
    <thead><tr><th>id</th>${cols.map((c) => `<th class="adb-col-head" data-head-col="${escapeHtml(c)}" title="${escapeHtml(adb.columns[c].type)} - cliquer pour modifier la colonne">${escapeHtml(c)}<span class="adb-col-type">${escapeHtml(colType(c))}</span></th>`).join("")}<th></th></tr></thead>
    <tbody>${adb.rows.map((r) => `<tr data-row-id="${r.id}"><td class="adb-id">${r.id}</td>${cols.map((c) => `<td data-col="${escapeHtml(c)}" class="adb-cell adb-type-${colType(c).toLowerCase()}">${cellHtml(r, c)}</td>`).join("")}<td><button type="button" class="adb-del" data-del-row="${r.id}" title="Supprimer la ligne">&#128465;</button></td></tr>`).join("")}</tbody>`;
  const end = Math.min(adb.offset + adb.limit, adb.total);
  document.getElementById("adb-page-info").textContent = adb.total ? `Lignes ${adb.offset + 1}–${end} sur ${adb.total}` : "Aucune ligne";
  document.getElementById("adb-prev").disabled = adb.offset === 0;
  document.getElementById("adb-next").disabled = end >= adb.total;
}

// Convertit la saisie selon le type de la colonne.
function parseInput(type, raw) {
  const s = raw.trim();
  if (type === "Numeric" || type === "Int" || type === "Ref" || type === "Date" || type === "DateTime") {
    if (s === "") return type === "Ref" ? 0 : null;
    const n = Number(s.replace(",", "."));
    if (Number.isNaN(n)) throw new Error("Nombre attendu");
    return n;
  }
  if (type === "RefList" || type === "ChoiceList" || type === "Attachments" || type === "Any") {
    if (s === "") return null;
    if (/^[[{]/.test(s) || s === "true" || s === "false" || s === "null" || /^-?\d+(\.\d+)?$/.test(s)) return JSON.parse(s);
    return s;
  }
  return raw;
}

function startEdit(td) {
  if (td.querySelector("input")) return;
  const rowId = Number(td.parentElement.dataset.rowId);
  const col = td.dataset.col;
  const type = colType(col);
  const row = adb.rows.find((r) => r.id === rowId);
  if (type === "Attachments") return;
  if (type === "Bool") { saveCell(rowId, col, !row[col]); return; }
  const v = row[col];
  const input = document.createElement("input");
  input.className = "adb-cell-input";
  input.value = v == null ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v));
  td.innerHTML = "";
  td.appendChild(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    if (!save) { td.innerHTML = cellHtml(row, col); return; }
    try { await saveCell(rowId, col, parseInput(type, input.value)); }
    catch (err) { Toast.error(err.message); td.innerHTML = cellHtml(row, col); }
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
  input.addEventListener("blur", () => finish(true));
}

async function saveCell(rowId, col, value) {
  const { row } = await adbFetch(`/admin/api/tables/${encodeURIComponent(adb.table)}/rows/${rowId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { [col]: value } })
  });
  const i = adb.rows.findIndex((r) => r.id === rowId);
  adb.rows[i] = row;
  const td = document.querySelector(`tr[data-row-id="${rowId}"] td[data-col="${CSS.escape(col)}"]`);
  if (td) { td.innerHTML = cellHtml(row, col); td.classList.add("adb-saved"); setTimeout(() => td.classList.remove("adb-saved"), 800); }
}

async function addRow() {
  try {
    const { row } = await adbFetch(`/admin/api/tables/${encodeURIComponent(adb.table)}/rows`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: {} }) });
    Toast.success(`Ligne #${row.id} créée.`);
    await refreshTables();
    await loadRows(adb.table, 0);
  } catch (err) { Toast.error(err.message); }
}

async function deleteRow(id) {
  if (!(await Confirm.show(`Supprimer définitivement la ligne #${id} de <strong>${escapeHtml(adb.table)}</strong> ?`, { title: "Supprimer la ligne", confirmText: "Supprimer", dangerous: true }))) return;
  try {
    await adbFetch(`/admin/api/tables/${encodeURIComponent(adb.table)}/rows/${id}`, { method: "DELETE" });
    Toast.success(`Ligne #${id} supprimée.`);
    await refreshTables();
    await loadRows(adb.table, adb.offset);
  } catch (err) { Toast.error(err.message); }
}

// ------------------------------------------------------------- structure
// Types proposes (memes noms que Grist). Ref / RefList demandent la table visee.
const ADB_TYPES = [
  ["Text", "Texte"], ["Numeric", "Nombre"], ["Int", "Entier"], ["Bool", "Oui / non"],
  ["DateTime", "Date et heure"], ["Date", "Date"], ["Choice", "Choix"], ["ChoiceList", "Liste de choix"],
  ["Ref", "Référence →"], ["RefList", "Liste de références →"], ["Attachments", "Images"], ["Any", "Libre (Any)"]
];
const ADB_ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const jsonHeaders = { "Content-Type": "application/json" };

function tablePath(table = adb.table) {
  return `/admin/api/tables/${encodeURIComponent(table)}`;
}

function typeEditorHtml(fullType) {
  const [base, target = ""] = String(fullType || "Any").split(":");
  const known = ADB_TYPES.some(([k]) => k === base);
  const opts = (known ? ADB_TYPES : [[base, base], ...ADB_TYPES]).map(([k, label]) => `<option value="${k}" ${k === base ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const tables = adb.tables.map((t) => `<option value="${escapeHtml(t.name)}" ${t.name === target ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");
  const needsTarget = base === "Ref" || base === "RefList";
  return `<select class="adb-type-base" aria-label="Type">${opts}</select><select class="adb-type-target" aria-label="Table visée" ${needsTarget ? "" : "hidden"}>${tables}</select>`;
}

function readType(cell) {
  const base = cell.querySelector(".adb-type-base").value;
  const target = cell.querySelector(".adb-type-target");
  return base === "Ref" || base === "RefList" ? `${base}:${target.value}` : base;
}

function wireTypeEditor(cell, onChange) {
  const base = cell.querySelector(".adb-type-base");
  const target = cell.querySelector(".adb-type-target");
  base.addEventListener("change", () => { target.hidden = !(base.value === "Ref" || base.value === "RefList"); onChange && onChange(); });
  target.addEventListener("change", () => onChange && onChange());
}

function isFormulaCol(def) {
  return def.isFormula && String(def.formula || "").trim();
}

function renderSchema() {
  const box = document.getElementById("adb-schema");
  if (box.hidden || !adb.table) return;
  const cols = adb.columns || {};
  const ids = Object.keys(cols);
  document.getElementById("adb-schema-title").textContent = adb.table;
  document.getElementById("adb-schema-count").textContent = `${ids.length} colonne${ids.length > 1 ? "s" : ""} · ${adb.total} ligne${adb.total > 1 ? "s" : ""}`;
  document.getElementById("adb-schema-cols").innerHTML = ids.map((id) => {
    const def = cols[id];
    const state = isFormulaCol(def)
      ? `<span class="adb-tag adb-tag-warn" title="${escapeHtml(def.formula)}">formule Grist</span> <button type="button" class="btn-ghost adb-mini" data-col-action="unformula">Convertir en données</button>`
      : `<span class="adb-tag adb-tag-ok">données</span>`;
    return `<tr data-schema-col="${escapeHtml(id)}">
      <td><input type="text" class="adb-col-name" value="${escapeHtml(id)}" aria-label="Nom de la colonne ${escapeHtml(id)}" /></td>
      <td class="adb-type-cell">${typeEditorHtml(def.type)}</td>
      <td>${state}</td>
      <td class="adb-schema-actions"><button type="button" class="btn-secondary adb-mini" data-col-action="save" disabled>Enregistrer</button><button type="button" class="adb-del" data-col-action="drop" title="Supprimer la colonne ${escapeHtml(id)}" aria-label="Supprimer la colonne ${escapeHtml(id)}">&#128465;</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" class="adb-help">Aucune colonne : ajoute la première ci-dessous.</td></tr>`;
  document.querySelectorAll("#adb-schema-cols tr[data-schema-col]").forEach((tr) => {
    const id = tr.dataset.schemaCol;
    const saveBtn = tr.querySelector('[data-col-action="save"]');
    const nameInput = tr.querySelector(".adb-col-name");
    const typeCell = tr.querySelector(".adb-type-cell");
    const dirty = () => {
      const changed = nameInput.value.trim() !== id || readType(typeCell) !== cols[id].type;
      saveBtn.disabled = !changed;
      tr.classList.toggle("adb-dirty", changed);
    };
    nameInput.addEventListener("input", dirty);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !saveBtn.disabled) saveColumn(tr); if (e.key === "Escape") renderSchema(); });
    wireTypeEditor(typeCell, dirty);
  });
  const newType = document.getElementById("adb-new-col-type");
  newType.innerHTML = typeEditorHtml("Numeric");
  wireTypeEditor(newType);
  document.getElementById("adb-rename-table").value = adb.table;
  document.getElementById("adb-drop-table-name").textContent = adb.table;
  document.getElementById("adb-drop-table-confirm").value = "";
  document.getElementById("adb-drop-table-btn").disabled = true;
}

function toggleSchema(force) {
  const box = document.getElementById("adb-schema");
  box.hidden = force === undefined ? !box.hidden : !force;
  document.getElementById("adb-schema-toggle").setAttribute("aria-expanded", String(!box.hidden));
  renderSchema();
}

// Workflows qui mentionnent cette table / colonne : affiche dans la
// confirmation, pour ne pas casser un jeu en prod par megarde.
async function usageWarning(ident) {
  try {
    const { workflows } = await adbFetch(`${tablePath()}/usage?column=${encodeURIComponent(ident)}`);
    if (!workflows.length) return `<p>Aucun workflow ne mentionne <code>${escapeHtml(ident)}</code>.</p>`;
    return `<div class="error-box adb-usage"><strong>${workflows.length} workflow${workflows.length > 1 ? "s mentionnent" : " mentionne"} <code>${escapeHtml(ident)}</code></strong> (à vérifier : un nom courant peut désigner autre chose) :<br>${workflows.map((w) => `<code>${escapeHtml(w)}</code>`).join(" ")}<br>Ils échoueront tant que leur code n'est pas mis à jour.</div>`;
  } catch (err) {
    return `<p class="adb-help">Vérification des workflows impossible (${escapeHtml(err.message)}).</p>`;
  }
}

async function afterSchemaChange(message) {
  Toast.success(message);
  await refreshTables();
  await loadRows(adb.table, adb.offset);
}

async function saveColumn(tr) {
  const id = tr.dataset.schemaCol;
  const def = adb.columns[id];
  const newId = tr.querySelector(".adb-col-name").value.trim();
  const newType = readType(tr.querySelector(".adb-type-cell"));
  if (!ADB_ID_RE.test(newId)) { Toast.error("Nom invalide : lettres, chiffres et _, en commençant par une lettre."); return; }
  const changes = {};
  const parts = [];
  if (newId !== id) { changes.id = newId; parts.push(`renommer <code>${escapeHtml(id)}</code> en <code>${escapeHtml(newId)}</code>`); }
  if (newType !== def.type) { changes.type = newType; parts.push(`passer le type de <code>${escapeHtml(def.type)}</code> à <code>${escapeHtml(newType)}</code> (les ${adb.total} valeurs sont reconverties)`); }
  if (!parts.length) return;
  const warning = changes.id ? await usageWarning(id) : "";
  const ok = await Confirm.show(`<p>Dans <strong>${escapeHtml(adb.table)}</strong> : ${parts.join(", puis ")}.</p>${warning}`, { title: "Modifier la colonne", confirmText: "Appliquer", dangerous: !!changes.id });
  if (!ok) return;
  try {
    await adbFetch(`${tablePath()}/columns/${encodeURIComponent(id)}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(changes) });
    await afterSchemaChange(`Colonne ${newId} mise à jour.`);
  } catch (err) { Toast.error(err.message); }
}

async function unformulaColumn(id) {
  const def = adb.columns[id];
  const ok = await Confirm.show(`<p>La colonne <code>${escapeHtml(id)}</code> était calculée dans Grist par la formule <code>${escapeHtml(def.formula)}</code>, que l'API ne sait pas exécuter. La convertir en colonne de données garde ses valeurs actuelles et permet aux workflows et à cette page de l'écrire.</p>`, { title: "Convertir en données", confirmText: "Convertir" });
  if (!ok) return;
  try {
    await adbFetch(`${tablePath()}/columns/${encodeURIComponent(id)}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ formula: false }) });
    await afterSchemaChange(`Colonne ${id} convertie en données.`);
  } catch (err) { Toast.error(err.message); }
}

async function dropColumn(id) {
  const warning = await usageWarning(id);
  const ok = await Confirm.show(`<p>Supprimer la colonne <code>${escapeHtml(id)}</code> de <strong>${escapeHtml(adb.table)}</strong> et ses valeurs dans les ${adb.total} lignes ? Irréversible (hors restauration d'une sauvegarde).</p>${warning}`, { title: "Supprimer la colonne", confirmText: "Supprimer", dangerous: true });
  if (!ok) return;
  try {
    await adbFetch(`${tablePath()}/columns/${encodeURIComponent(id)}`, { method: "DELETE" });
    await afterSchemaChange(`Colonne ${id} supprimée.`);
  } catch (err) { Toast.error(err.message); }
}

async function addColumn() {
  const input = document.getElementById("adb-new-col-name");
  const id = input.value.trim();
  if (!ADB_ID_RE.test(id)) { Toast.error("Nom invalide : lettres, chiffres et _, en commençant par une lettre."); input.focus(); return; }
  if (adb.columns[id]) { Toast.error(`La colonne ${id} existe déjà.`); input.focus(); return; }
  const type = readType(document.getElementById("adb-new-col-type"));
  try {
    await adbFetch(`${tablePath()}/columns`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ id, type }) });
    input.value = "";
    await afterSchemaChange(`Colonne ${id} (${type}) ajoutée.`);
  } catch (err) { Toast.error(err.message); }
}

async function renameTable() {
  const newName = document.getElementById("adb-rename-table").value.trim();
  if (newName === adb.table) return;
  if (!ADB_ID_RE.test(newName)) { Toast.error("Nom invalide : lettres, chiffres et _, en commençant par une lettre."); return; }
  const warning = await usageWarning(adb.table);
  const ok = await Confirm.show(`<p>Renommer la table <strong>${escapeHtml(adb.table)}</strong> en <strong>${escapeHtml(newName)}</strong> ? Les colonnes référence des autres tables suivent automatiquement.</p>${warning}`, { title: "Renommer la table", confirmText: "Renommer", dangerous: true });
  if (!ok) return;
  try {
    await adbFetch(tablePath(), { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ name: newName }) });
    adb.table = newName;
    await afterSchemaChange(`Table renommée en ${newName}.`);
  } catch (err) { Toast.error(err.message); }
}

async function dropTable() {
  const name = adb.table;
  if (document.getElementById("adb-drop-table-confirm").value.trim() !== name) return;
  try {
    await adbFetch(`${tablePath()}?confirm=${encodeURIComponent(name)}`, { method: "DELETE" });
    Toast.success(`Table ${name} supprimée.`);
    adb.table = null;
    await refreshTables();
    toggleSchema(false);
    const sel = document.getElementById("adb-table");
    if (sel.value) await loadRows(sel.value);
  } catch (err) { Toast.error(err.message); }
}

function toggleNewTable(force) {
  const form = document.getElementById("adb-new-table");
  form.hidden = force === undefined ? !form.hidden : !force;
  document.getElementById("adb-new-table-toggle").setAttribute("aria-expanded", String(!form.hidden));
  if (!form.hidden) document.getElementById("adb-new-table-name").focus();
}

async function createTable(e) {
  e.preventDefault();
  const input = document.getElementById("adb-new-table-name");
  const name = input.value.trim();
  if (!ADB_ID_RE.test(name)) { Toast.error("Nom invalide : lettres, chiffres et _, en commençant par une lettre."); return; }
  try {
    await adbFetch("/admin/api/tables", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name }) });
    input.value = "";
    toggleNewTable(false);
    Toast.success(`Table ${name} créée.`);
    adb.table = name;
    await refreshTables();
    await loadRows(name, 0);
    toggleSchema(true);
    document.getElementById("adb-new-col-name").focus();
  } catch (err) { Toast.error(err.message); }
}

async function uploadForRow(rowId, col, file) {
  const maxSize = Number(document.getElementById("adb-max-size").value) || 900;
  const quality = Number(document.getElementById("adb-quality").value) / 100;
  try {
    const { blob } = await toWebp(file, maxSize, quality);
    await uploadImage({ method: "POST", path: `/admin/api/images?table=${encodeURIComponent(adb.table)}&rowId=${rowId}&column=${encodeURIComponent(col)}`, blob, fileName: webpName(file.name) });
    Toast.success(`Image changée (${formatBytes(file.size)} → ${formatBytes(blob.size)}).`);
    await loadRows(adb.table, adb.offset);
    loadImages();
  } catch (err) { Toast.error(err.message); }
}

async function refreshTables() {
  const { tables } = await adbFetch("/admin/api/tables");
  adb.tables = tables;
  const current = adb.table;
  fillTableSelect();
  if (current) document.getElementById("adb-table").value = current;
}

// ------------------------------------------------------------- sauvegardes
async function loadBackups() {
  const statusBox = document.getElementById("adb-backup-status");
  const listBox = document.getElementById("adb-backup-list");
  try {
    const { status, backups } = await adbFetch("/admin/api/backups");
    const last = status.lastBackup;
    statusBox.innerHTML = (last ? `<p>Dernière sauvegarde depuis le démarrage de l'API : <strong>${new Date(last.at).toLocaleString("fr-FR")}</strong> (${formatBytes(last.size)})</p>` : "")
      + (status.lastError ? `<div class="error-box">Dernier échec (${new Date(status.lastError.at).toLocaleString("fr-FR")}) : ${escapeHtml(status.lastError.message)}</div>` : "");
    listBox.innerHTML = backups.length
      ? `<div class="adb-table-wrap"><table class="adb-table"><thead><tr><th>Date</th><th>Taille</th><th>Nom (pour npm run restore)</th></tr></thead><tbody>${backups.map((b) => `<tr><td>${new Date(b.date).toLocaleString("fr-FR")}</td><td>${formatBytes(b.size)}</td><td><code>${escapeHtml(b.name.split("/").pop())}</code></td></tr>`).join("")}</tbody></table></div>`
      : `<p class="adb-help">Aucune sauvegarde pour l'instant.</p>`;
  } catch (err) {
    statusBox.innerHTML = `<div class="error-box">${err.status === 503 ? "Sauvegardes désactivées : AZURE_BACKUP_SAS_URL n'est pas configuré sur le serveur." : escapeHtml(err.message)}</div>`;
    listBox.innerHTML = "";
  }
}

async function backupNow(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const { status } = await adbFetch("/admin/api/backups", { method: "POST" });
    Toast.success(`Sauvegarde envoyée (${formatBytes(status.lastBackup.size)}).`);
    await loadBackups();
  } catch (err) {
    Toast.error(`Échec de la sauvegarde : ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------- init
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("adb-api-url").value = adbLoad(ADB_URL_KEY) || defaultApiUrl();
  document.getElementById("adb-token").value = adbLoad(ADB_TOKEN_KEY);
  document.getElementById("adb-login").addEventListener("submit", connect);
  document.getElementById("adb-logout").addEventListener("click", logout);
  document.getElementById("adb-tab-images").addEventListener("click", () => setTab("images"));
  document.getElementById("adb-tab-tables").addEventListener("click", () => setTab("tables"));
  document.getElementById("adb-tab-backups").addEventListener("click", () => setTab("backups"));
  document.getElementById("adb-backup-now").addEventListener("click", backupNow);

  const quality = document.getElementById("adb-quality");
  quality.addEventListener("input", () => { document.getElementById("adb-quality-label").textContent = quality.value; });
  document.getElementById("adb-files").addEventListener("change", (e) => { onFiles(e.target.files); e.target.value = ""; });
  const drop = document.getElementById("adb-drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => onFiles(e.dataTransfer.files));
  ["adb-bulk-ext", "adb-only-missing"].forEach((id) => document.getElementById(id).addEventListener("change", () => {
    if (adb.plan.length) { adb.plan = buildPlan(adb.plan.map((p) => p.file)); renderPlan(); }
  }));
  document.getElementById("adb-img-filter").addEventListener("change", renderImageGrid);
  document.getElementById("adb-img-ext").addEventListener("change", renderImageGrid);
  document.getElementById("adb-img-grid").addEventListener("change", (e) => {
    const input = e.target.closest("input[data-replace-id]");
    if (input && input.files[0]) replaceOne(Number(input.dataset.replaceId), input.files[0]);
  });

  document.getElementById("adb-table").addEventListener("change", (e) => { document.getElementById("adb-search").value = ""; loadRows(e.target.value); });
  let searchTimer = null;
  document.getElementById("adb-search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadRows(adb.table, 0), 300); });
  document.getElementById("adb-prev").addEventListener("click", () => loadRows(adb.table, Math.max(0, adb.offset - adb.limit)));
  document.getElementById("adb-next").addEventListener("click", () => loadRows(adb.table, adb.offset + adb.limit));
  document.getElementById("adb-add-row").addEventListener("click", addRow);
  document.getElementById("adb-add-col").addEventListener("click", addColumn);
  document.getElementById("adb-new-col-name").addEventListener("keydown", (e) => { if (e.key === "Enter") addColumn(); });
  document.getElementById("adb-schema-toggle").addEventListener("click", () => toggleSchema());
  document.getElementById("adb-new-table-toggle").addEventListener("click", () => toggleNewTable());
  document.getElementById("adb-new-table-cancel").addEventListener("click", () => toggleNewTable(false));
  document.getElementById("adb-new-table").addEventListener("submit", createTable);
  document.getElementById("adb-rename-table-btn").addEventListener("click", renameTable);
  document.getElementById("adb-drop-table-btn").addEventListener("click", dropTable);
  document.getElementById("adb-drop-table-confirm").addEventListener("input", (e) => {
    document.getElementById("adb-drop-table-btn").disabled = e.target.value.trim() !== adb.table;
  });
  document.getElementById("adb-schema-cols").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-col-action]");
    if (!btn) return;
    const tr = btn.closest("tr[data-schema-col]");
    const action = btn.dataset.colAction;
    if (action === "save") saveColumn(tr);
    else if (action === "drop") dropColumn(tr.dataset.schemaCol);
    else if (action === "unformula") unformulaColumn(tr.dataset.schemaCol);
  });
  const grid = document.getElementById("adb-grid");
  grid.addEventListener("click", (e) => {
    const head = e.target.closest("[data-head-col]");
    if (head) {
      toggleSchema(true);
      const tr = document.querySelector(`#adb-schema-cols tr[data-schema-col="${CSS.escape(head.dataset.headCol)}"]`);
      if (tr) { tr.scrollIntoView({ block: "center", behavior: "smooth" }); const input = tr.querySelector(".adb-col-name"); input.focus(); input.select(); }
      return;
    }
    const del = e.target.closest("[data-del-row]");
    if (del) { deleteRow(Number(del.dataset.delRow)); return; }
    if (e.target.closest(".adb-cell-upload")) return;
    const td = e.target.closest("td.adb-cell");
    if (td) startEdit(td);
  });
  grid.addEventListener("change", (e) => {
    const input = e.target.closest("input[data-upload-row]");
    if (input && input.files[0]) uploadForRow(Number(input.dataset.uploadRow), input.dataset.uploadCol, input.files[0]);
  });

  if (adbLoad(ADB_TOKEN_KEY)) connect();
});
