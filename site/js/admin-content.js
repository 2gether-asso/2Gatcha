// Admin - Extensions et cartes (admin-db.html, 2026-10-08) : creer une
// extension (visuel du pack, dos de carte), y importer des cartes en lot a
// partir de leurs images, et retoucher les cartes existantes.
// Passe uniquement par les routes /admin/api deja en place (lignes, colonnes,
// images) : aucune mise a jour de l'API necessaire.
// S'appuie sur admin-db.js (adbFetch, toWebp, uploadImage, escapeHtml...).

const AC = { extensions: [], cards: [], rarities: [], ext: null, pending: [], busy: false };
const acEl = (id) => document.getElementById(id);

// --- donnees ---------------------------------------------------------------------
async function acRows(table) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const d = await adbFetch(`/admin/api/tables/${encodeURIComponent(table)}/rows?offset=${offset}&limit=500`);
    out.push(...d.rows);
    if (out.length >= d.total || !d.rows.length) return { rows: out, columns: d.columns };
  }
}
const acRef = (v) => (Array.isArray(v) ? Number(v[1]) : Number(v) || 0);
const acImg = (v) => { const ids = Array.isArray(v) ? v.slice(v[0] === "L" ? 1 : 0) : []; return ids.length ? Number(ids[0]) : null; };
const acSlug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const acNameFromFile = (f) => String(f).replace(/\.[^.]+$/, "").replace(/^\d+[\s._-]+/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

// Colonnes d'images manquantes (base importee sans visuels) : creees au besoin.
async function acEnsureColumn(table, col, type) {
  const t = (adb.tables || []).find((x) => x.name === table);
  if (t && t.columns && t.columns[col]) return;
  await adbFetch(`/admin/api/tables/${encodeURIComponent(table)}/columns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: col, type }) }).catch((e) => { if (!/existe/.test(e.message)) throw e; });
  await refreshTables();
}

async function acLoad() {
  const [ext, cards, rar] = await Promise.all([acRows("Extensions"), acRows("Cards"), acRows("Rarities")]);
  AC.extensions = ext.rows.sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0) || a.id - b.id);
  AC.cards = cards.rows;
  AC.rarities = rar.rows.sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
  if (!AC.ext || !AC.extensions.some((e) => e.id === AC.ext)) AC.ext = AC.extensions[0]?.id || null;
  const def = acEl("ac-default-rarity");
  if (AC.rarities.length) def.innerHTML = acRarityOptions(def.value || AC.rarities[0].id);
  acRenderExtensions();
  acRenderCards();
}

// --- extensions ---------------------------------------------------------------------
function acRenderExtensions() {
  acEl("ac-ext-list").innerHTML = AC.extensions.map((e) => {
    const n = AC.cards.filter((c) => acRef(c.Extension) === e.id).length;
    const active = AC.cards.filter((c) => acRef(c.Extension) === e.id && c.Active).length;
    const pack = acImg(e.PackImage), back = acImg(e.CardBackImage);
    return `<button type="button" class="ac-ext ${e.id === AC.ext ? "selected" : ""} ${e.Active === false || !e.Active ? "inactive" : ""}" data-ext="${e.id}">
      <span class="ac-ext-imgs">${pack ? `<img src="${adbImageUrl(pack)}" alt="" loading="lazy" />` : '<span class="ac-noimg">pack ?</span>'}${back ? `<img src="${adbImageUrl(back)}" alt="" loading="lazy" />` : '<span class="ac-noimg">dos ?</span>'}</span>
      <span class="ac-ext-body"><strong>${escapeHtml(e.Name || "(sans nom)")}</strong><small>${escapeHtml(e.Key || "")} · ordre ${e.SortOrder || 0}</small><small>${active}/${n} carte${n > 1 ? "s" : ""} active${active > 1 ? "s" : ""}${e.Active ? "" : " · masquée"}</small></span>
    </button>`;
  }).join("") + `<button type="button" class="ac-ext ac-ext-new" id="ac-new-ext-btn"><span>&#10133;</span><strong>Nouvelle extension</strong></button>`;
  const e = AC.extensions.find((x) => x.id === AC.ext);
  acEl("ac-ext-edit").hidden = !e;
  if (!e) return;
  acEl("ac-ext-title").textContent = e.Name || "(sans nom)";
  acEl("ac-ext-name").value = e.Name || "";
  acEl("ac-ext-key").value = e.Key || "";
  acEl("ac-ext-order").value = e.SortOrder || 0;
  acEl("ac-ext-active").checked = !!e.Active;
  const pack = acImg(e.PackImage), back = acImg(e.CardBackImage);
  acEl("ac-ext-pack-preview").innerHTML = pack ? `<img src="${adbImageUrl(pack)}" alt="Pack" />` : '<span class="ac-noimg">Aucun visuel</span>';
  acEl("ac-ext-back-preview").innerHTML = back ? `<img src="${adbImageUrl(back)}" alt="Dos" />` : '<span class="ac-noimg">Aucun visuel</span>';
}

async function acSaveExtension() {
  const e = AC.extensions.find((x) => x.id === AC.ext);
  if (!e) return;
  const fields = { Name: acEl("ac-ext-name").value.trim(), Key: acSlug(acEl("ac-ext-key").value) || acSlug(acEl("ac-ext-name").value), SortOrder: Number(acEl("ac-ext-order").value) || 0, Active: acEl("ac-ext-active").checked };
  if (!fields.Name) { Toast.error("Le nom est obligatoire."); return; }
  if (AC.extensions.some((x) => x.id !== e.id && x.Key === fields.Key)) { Toast.error(`La clé « ${fields.Key} » est déjà utilisée.`); return; }
  try {
    await adbFetch(`/admin/api/tables/Extensions/rows/${e.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
    Toast.success("Extension enregistrée.");
    await acLoad();
  } catch (err) { Toast.error(err.message); }
}

async function acUploadTo(table, rowId, col, file) {
  await acEnsureColumn(table, col, "Attachments");
  const maxSize = Number(acEl("ac-max-size").value) || 900;
  const { blob } = await toWebp(file, maxSize, 0.85);
  return uploadImage({ method: "POST", path: `/admin/api/images?table=${encodeURIComponent(table)}&rowId=${rowId}&column=${encodeURIComponent(col)}`, blob, fileName: webpName(file.name) });
}

async function acCreateExtension(ev) {
  ev.preventDefault();
  const name = acEl("ac-new-name").value.trim();
  const key = acSlug(acEl("ac-new-key").value) || acSlug(name);
  if (!name || !key) { Toast.error("Nom et clé obligatoires."); return; }
  if (AC.extensions.some((x) => x.Key === key)) { Toast.error(`La clé « ${key} » est déjà utilisée.`); return; }
  const btn = ev.submitter || acEl("ac-new-submit");
  btn.disabled = true;
  try {
    const order = AC.extensions.reduce((m, x) => Math.max(m, Number(x.SortOrder) || 0), 0) + 1;
    const { row } = await adbFetch("/admin/api/tables/Extensions/rows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { Name: name, Key: key, SortOrder: order, Active: acEl("ac-new-active").checked } }) });
    const pack = acEl("ac-new-pack").files[0], back = acEl("ac-new-back").files[0];
    if (pack) await acUploadTo("Extensions", row.id, "PackImage", pack);
    if (back) await acUploadTo("Extensions", row.id, "CardBackImage", back);
    Toast.success(`Extension « ${escapeHtml(name)} » créée. Ajoute maintenant ses cartes.`);
    acEl("ac-new-form").reset();
    acEl("ac-new-form").hidden = true;
    AC.ext = row.id;
    await refreshTables();
    await acLoad();
    acEl("ac-cards-section").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) { Toast.error(err.message); }
  btn.disabled = false;
}

// --- import de cartes -------------------------------------------------------------
function acRarityOptions(selected) {
  return AC.rarities.map((r) => `<option value="${r.id}" ${Number(selected) === r.id ? "selected" : ""}>${escapeHtml(r.Name || r.Key)}</option>`).join("");
}

function acAddFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/"));
  const defRarity = Number(acEl("ac-default-rarity").value) || AC.rarities[0]?.id;
  for (const f of files) AC.pending.push({ file: f, url: URL.createObjectURL(f), name: acNameFromFile(f.name), rarity: defRarity, artist: acEl("ac-default-artist").value.trim(), promo: false });
  acRenderPending();
}

function acRenderPending() {
  const box = acEl("ac-pending");
  acEl("ac-import-bar").hidden = !AC.pending.length;
  acEl("ac-import-count").textContent = `${AC.pending.length} carte${AC.pending.length > 1 ? "s" : ""} à créer`;
  box.innerHTML = AC.pending.map((p, i) => `
    <div class="ac-pending-card" data-i="${i}">
      <img src="${p.url}" alt="" />
      <input type="text" value="${escapeHtml(p.name)}" data-f="name" aria-label="Nom de la carte" />
      <select data-f="rarity" aria-label="Rareté">${acRarityOptions(p.rarity)}</select>
      <input type="text" value="${escapeHtml(p.artist)}" data-f="artist" placeholder="Artiste" aria-label="Artiste" />
      <label class="ac-inline"><input type="checkbox" data-f="promo" ${p.promo ? "checked" : ""} /> Promo</label>
      <button type="button" class="adb-del" data-remove="${i}" title="Retirer">&#10005;</button>
    </div>`).join("");
}

async function acImport() {
  if (AC.busy || !AC.pending.length) return;
  const ext = AC.extensions.find((x) => x.id === AC.ext);
  if (!ext) { Toast.error("Choisis d'abord une extension."); return; }
  if (AC.pending.some((p) => !p.name.trim())) { Toast.error("Chaque carte doit avoir un nom."); return; }
  AC.busy = true;
  acEl("ac-import-btn").disabled = true;
  const active = acEl("ac-import-active").checked;
  const bar = acEl("ac-progress");
  let done = 0, failed = 0;
  try { await acEnsureColumn("Cards", "Image", "Attachments"); } catch (e) { /* tentee a nouveau carte par carte */ }
  for (const p of [...AC.pending]) {
    try {
      const { row } = await adbFetch("/admin/api/tables/Cards/rows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { Name: p.name.trim(), Artist: p.artist || "", Rarity: Number(p.rarity), Extension: ext.id, Active: active, IsPromo: !!p.promo, IsSecret: false } }) });
      await acUploadTo("Cards", row.id, "Image", p.file);
      AC.pending.splice(AC.pending.indexOf(p), 1);
      URL.revokeObjectURL(p.url);
      done++;
    } catch (err) { failed++; console.error(err); }
    bar.style.width = `${Math.round(((done + failed) / (done + failed + AC.pending.length - failed)) * 100)}%`;
  }
  AC.busy = false;
  acEl("ac-import-btn").disabled = false;
  bar.style.width = "0%";
  if (done) Toast.success(`${done} carte${done > 1 ? "s" : ""} créée${done > 1 ? "s" : ""} dans « ${escapeHtml(ext.Name)} ».`);
  if (failed) Toast.error(`${failed} carte${failed > 1 ? "s n'ont" : " n'a"} pas pu être créée${failed > 1 ? "s" : ""} (elles restent dans la liste).`);
  acRenderPending();
  await refreshTables();
  await acLoad();
}

// --- cartes de l'extension -----------------------------------------------------------
function acRenderCards() {
  const ext = AC.extensions.find((x) => x.id === AC.ext);
  acEl("ac-cards-section").hidden = !ext;
  if (!ext) return;
  acEl("ac-cards-title").textContent = ext.Name || "";
  const q = (acEl("ac-card-search").value || "").toLowerCase();
  const list = AC.cards.filter((c) => acRef(c.Extension) === ext.id && (!q || String(c.Name || "").toLowerCase().includes(q)))
    .sort((a, b) => (AC.rarities.findIndex((r) => r.id === acRef(a.Rarity)) - AC.rarities.findIndex((r) => r.id === acRef(b.Rarity))) || String(a.Name).localeCompare(String(b.Name), "fr"));
  acEl("ac-cards").innerHTML = list.length ? list.map((c) => {
    const img = acImg(c.Image);
    const rar = AC.rarities.find((r) => r.id === acRef(c.Rarity));
    return `<div class="ac-card ${c.Active ? "" : "inactive"}" data-card="${c.id}" style="--r:${escapeHtml(rar?.ColorHex || "#888")}">
      <label class="ac-card-img" title="Changer l'image">${img ? `<img src="${adbImageUrl(img)}" alt="" loading="lazy" />` : '<span class="ac-noimg">image ?</span>'}<input type="file" accept="image/*" data-card-img="${c.id}" hidden /></label>
      <input type="text" value="${escapeHtml(c.Name || "")}" data-cf="Name" aria-label="Nom" />
      <select data-cf="Rarity" aria-label="Rareté">${acRarityOptions(acRef(c.Rarity))}</select>
      <input type="text" value="${escapeHtml(c.Artist || "")}" data-cf="Artist" placeholder="Artiste" aria-label="Artiste" />
      <div class="ac-card-flags">
        <label class="ac-inline"><input type="checkbox" data-cf="Active" ${c.Active ? "checked" : ""} /> Active</label>
        <label class="ac-inline"><input type="checkbox" data-cf="IsPromo" ${c.IsPromo ? "checked" : ""} /> Promo</label>
        <span class="adb-help">#${c.id}</span>
      </div>
    </div>`;
  }).join("") : '<p class="adb-help">Aucune carte dans cette extension pour l\'instant : dépose leurs images ci-dessus.</p>';
  acEl("ac-cards-count").textContent = `${list.length} carte${list.length > 1 ? "s" : ""}`;
}

async function acPatchCard(id, fields, el) {
  try {
    const { row } = await adbFetch(`/admin/api/tables/Cards/rows/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
    const i = AC.cards.findIndex((c) => c.id === id);
    if (i >= 0) AC.cards[i] = row;
    if (el) { el.classList.add("adb-saved"); setTimeout(() => el.classList.remove("adb-saved"), 800); }
    if ("Active" in fields || "Rarity" in fields) { acRenderCards(); acRenderExtensions(); }
  } catch (err) { Toast.error(err.message); }
}

// --- branchement --------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  if (!acEl("adb-content-pane")) return;
  acEl("adb-tab-content").addEventListener("click", () => { setTab("content"); acLoad().catch((e) => Toast.error(e.message)); });
  acEl("ac-ext-list").addEventListener("click", (e) => {
    if (e.target.closest("#ac-new-ext-btn")) { acEl("ac-new-form").hidden = false; acEl("ac-new-name").focus(); return; }
    const b = e.target.closest("[data-ext]");
    if (b) { AC.ext = Number(b.dataset.ext); acRenderExtensions(); acRenderCards(); }
  });
  acEl("ac-new-name").addEventListener("input", (e) => { if (!acEl("ac-new-key").dataset.touched) acEl("ac-new-key").value = acSlug(e.target.value); });
  acEl("ac-new-key").addEventListener("input", (e) => { e.target.dataset.touched = "1"; });
  acEl("ac-new-form").addEventListener("submit", acCreateExtension);
  acEl("ac-new-cancel").addEventListener("click", () => { acEl("ac-new-form").reset(); acEl("ac-new-form").hidden = true; });
  acEl("ac-ext-save").addEventListener("click", acSaveExtension);
  for (const [id, col] of [["ac-ext-pack", "PackImage"], ["ac-ext-back", "CardBackImage"]]) {
    acEl(id).addEventListener("change", async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f || !AC.ext) return;
      try { await acUploadTo("Extensions", AC.ext, col, f); Toast.success("Visuel mis à jour."); await acLoad(); } catch (err) { Toast.error(err.message); }
    });
  }
  const drop = acEl("ac-drop");
  acEl("ac-files").addEventListener("change", (e) => { acAddFiles(e.target.files); e.target.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => acAddFiles(e.dataTransfer.files));
  acEl("ac-pending").addEventListener("input", (e) => {
    const card = e.target.closest("[data-i]");
    if (!card) return;
    const p = AC.pending[Number(card.dataset.i)];
    const f = e.target.dataset.f;
    if (f === "promo") p.promo = e.target.checked; else if (f) p[f] = e.target.value;
  });
  acEl("ac-pending").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]");
    if (!rm) return;
    const [p] = AC.pending.splice(Number(rm.dataset.remove), 1);
    if (p) URL.revokeObjectURL(p.url);
    acRenderPending();
  });
  acEl("ac-apply-all").addEventListener("click", () => {
    const r = acEl("ac-default-rarity").value, a = acEl("ac-default-artist").value.trim();
    AC.pending.forEach((p) => { p.rarity = r; if (a) p.artist = a; });
    acRenderPending();
  });
  acEl("ac-clear").addEventListener("click", () => { AC.pending.forEach((p) => URL.revokeObjectURL(p.url)); AC.pending = []; acRenderPending(); });
  acEl("ac-import-btn").addEventListener("click", acImport);
  acEl("ac-card-search").addEventListener("input", acRenderCards);
  const cards = acEl("ac-cards");
  cards.addEventListener("change", async (e) => {
    const box = e.target.closest("[data-card]");
    if (!box) return;
    const id = Number(box.dataset.card);
    if (e.target.dataset.cardImg) {
      const f = e.target.files[0];
      if (!f) return;
      try { await acUploadTo("Cards", id, "Image", f); Toast.success("Image changée."); await acLoad(); } catch (err) { Toast.error(err.message); }
      return;
    }
    const col = e.target.dataset.cf;
    if (!col) return;
    const v = e.target.type === "checkbox" ? e.target.checked : col === "Rarity" ? Number(e.target.value) : e.target.value.trim();
    acPatchCard(id, { [col]: v }, e.target);
  });
});
