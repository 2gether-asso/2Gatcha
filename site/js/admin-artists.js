// Admin - Artistes (admin-db.html, 2026-10-30) : fiches de la page publique
// artistes.html (api/src/native/artists.js, table Artists). Les cartes d'un
// artiste viennent du champ texte Cards.Artist (nom ou autres noms de la
// fiche) ; un nom trouve sur des cartes sans fiche est propose ici.
// S'appuie sur admin-db.js (adbFetch, toWebp, uploadImage...) et
// admin-content.js (acRows, acRef, acImg, acSlug, acEnsureColumn).

const AA = { rows: [], cards: [], sel: null };
const aaNorm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
const aaNames = (r) => [r.Name, ...String(r.Aliases || "").split(/[,;\n]/)].map(aaNorm).filter(Boolean);
const aaVisible = (r) => r.Active !== false && r.Active !== 0;
const aaJson = (body) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function aaLoad() {
  let rows = [];
  try { rows = (await acRows("Artists")).rows; } catch (e) { if (!/404|introuvable|not.found/i.test(e.message)) throw e; }
  AA.rows = rows.sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0) || String(a.Name || "").localeCompare(String(b.Name || ""), "fr"));
  AA.cards = (await acRows("Cards")).rows.filter((c) => c.Active && !c.IsSecret);
  if (AA.sel && !AA.rows.some((r) => r.id === AA.sel)) AA.sel = null;
  aaRender();
}

function aaCardsOf(row) { const names = new Set(aaNames(row)); return AA.cards.filter((c) => names.has(aaNorm(c.Artist))); }

function aaRender() {
  const known = new Set(AA.rows.flatMap(aaNames));
  const orphans = new Map();
  for (const c of AA.cards) { const n = aaNorm(c.Artist); if (n && !known.has(n)) { const o = orphans.get(n) || { name: String(c.Artist).trim(), count: 0 }; o.count++; orphans.set(n, o); } }
  acEl("aa-list").innerHTML = AA.rows.map((r) => {
    const av = acImg(r.Avatar), n = aaCardsOf(r).length;
    return `<button type="button" class="ac-ext ${r.id === AA.sel ? "selected" : ""} ${aaVisible(r) ? "" : "inactive"}" data-artist="${r.id}">
      <span class="ac-ext-imgs">${av ? `<img class="aa-av" src="${adbImageUrl(av)}" alt="" loading="lazy" decoding="async" />` : '<span class="ac-noimg aa-av">photo ?</span>'}</span>
      <span class="ac-ext-body"><strong>${escapeHtml(r.Name || "(sans nom)")}</strong><small>${n} carte${n > 1 ? "s" : ""}${String(r.Links || "").trim() ? " · réseaux ✓" : ""}${String(r.Bio || "").trim() ? " · présentation ✓" : ""}</small><small>${aaVisible(r) ? "visible" : "masquée"} · ordre ${r.SortOrder || 0}</small></span>
    </button>`;
  }).join("") + [...orphans.values()].sort((a, b) => b.count - a.count).map((o) => `
    <button type="button" class="ac-ext ac-ext-new" data-orphan="${escapeHtml(o.name)}"><span>&#10133;</span><span class="ac-ext-body"><strong>${escapeHtml(o.name)}</strong><small>${o.count} carte${o.count > 1 ? "s" : ""}, pas de fiche · Créer la fiche</small></span></button>`).join("")
    + `<button type="button" class="ac-ext ac-ext-new" data-orphan=""><span>&#10133;</span><strong>Nouvelle fiche</strong></button>`;
  const r = AA.rows.find((x) => x.id === AA.sel);
  acEl("aa-edit").hidden = !r;
  if (!r) return;
  acEl("aa-title").textContent = r.Name || "(sans nom)";
  acEl("aa-view").href = artistHref(r.Slug || r.Name);
  acEl("aa-name").value = r.Name || "";
  acEl("aa-aliases").value = r.Aliases || "";
  acEl("aa-tagline").value = r.Tagline || "";
  acEl("aa-slug").value = r.Slug || "";
  const color = /^#[0-9a-f]{6}$/i.test(String(r.Color || "").trim()) ? r.Color.trim() : "";
  acEl("aa-color").value = color || "#8b5cf6";
  acEl("aa-color-on").checked = !!color;
  acEl("aa-order").value = r.SortOrder || 0;
  acEl("aa-active").checked = aaVisible(r);
  acEl("aa-bio").value = r.Bio || "";
  acEl("aa-links").value = r.Links || "";
  const cards = aaCardsOf(r), feat = acRef(r.FeaturedCard);
  acEl("aa-featured").innerHTML = '<option value="0">— automatique (sa carte la plus rare) —</option>' + cards.map((c) => `<option value="${c.id}" ${c.id === feat ? "selected" : ""}>${escapeHtml(c.Name || "#" + c.id)}</option>`).join("");
  const av = acImg(r.Avatar), bn = acImg(r.Banner);
  acEl("aa-avatar-preview").innerHTML = av ? `<img src="${adbImageUrl(av)}" alt="Photo" />` : '<span class="ac-noimg">Aucune photo</span>';
  acEl("aa-banner-preview").innerHTML = bn ? `<img src="${adbImageUrl(bn)}" alt="Bannière" />` : '<span class="ac-noimg">Aucune bannière</span>';
}

async function aaCreate(name) {
  const label = name || prompt("Nom de l'artiste ?");
  if (!label || !label.trim()) return;
  const { row } = await adbFetch("/admin/api/tables/Artists/rows", { method: "POST", ...aaJson({ fields: { Name: label.trim(), Active: true, SortOrder: AA.rows.length + 1 } }) });
  AA.sel = row.id;
  Toast.success(`Fiche de ${label.trim()} créée.`);
  await aaLoad();
  acEl("aa-bio").focus();
}

async function aaSave() {
  const r = AA.rows.find((x) => x.id === AA.sel);
  if (!r) return;
  const fields = {
    Name: acEl("aa-name").value.trim(), Aliases: acEl("aa-aliases").value.trim(), Tagline: acEl("aa-tagline").value.trim(),
    Slug: acSlug(acEl("aa-slug").value), Color: acEl("aa-color-on").checked ? acEl("aa-color").value : "",
    SortOrder: Number(acEl("aa-order").value) || 0, Active: acEl("aa-active").checked,
    Bio: acEl("aa-bio").value.trim(), Links: acEl("aa-links").value.trim(), FeaturedCard: Number(acEl("aa-featured").value) || 0
  };
  if (!fields.Name) { Toast.error("Le nom est obligatoire."); return; }
  const slug = fields.Slug || acSlug(fields.Name);
  if (AA.rows.some((x) => x.id !== r.id && (x.Slug ? acSlug(x.Slug) : acSlug(x.Name)) === slug)) { Toast.error(`L'adresse « ${slug} » est déjà prise par une autre fiche.`); return; }
  try {
    await adbFetch(`/admin/api/tables/Artists/rows/${r.id}`, { method: "PATCH", ...aaJson({ fields }) });
    Toast.success("Fiche enregistrée.");
    await aaLoad();
  } catch (err) { Toast.error(err.message); }
}

async function aaUpload(col, file, maxSize) {
  await acEnsureColumn("Artists", col, "Attachments");
  const { blob } = await toWebp(file, maxSize, 0.85);
  return uploadImage({ method: "POST", path: `/admin/api/images?table=Artists&rowId=${AA.sel}&column=${col}`, blob, fileName: webpName(file.name) });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!acEl("adb-artists-pane")) return;
  acEl("adb-tab-artists").addEventListener("click", () => { setTab("artists"); aaLoad().catch((e) => Toast.error(e.message)); });
  acEl("aa-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-artist]");
    if (b) { AA.sel = Number(b.dataset.artist); aaRender(); acEl("aa-edit").scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    const o = e.target.closest("[data-orphan]");
    if (o) aaCreate(o.dataset.orphan).catch((err) => Toast.error(err.message));
  });
  acEl("aa-save").addEventListener("click", aaSave);
  acEl("aa-delete").addEventListener("click", async () => {
    const r = AA.rows.find((x) => x.id === AA.sel);
    if (!r || !confirm(`Supprimer la fiche de ${r.Name} ? Ses cartes restent dans le jeu (et sa page, sans présentation).`)) return;
    try { await adbFetch(`/admin/api/tables/Artists/rows/${r.id}`, { method: "DELETE" }); AA.sel = null; Toast.success("Fiche supprimée."); await aaLoad(); } catch (err) { Toast.error(err.message); }
  });
  for (const [id, col, size] of [["aa-avatar", "Avatar", 600], ["aa-banner", "Banner", 1600]]) {
    acEl(id).addEventListener("change", async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f || !AA.sel) return;
      try { await aaUpload(col, f, size); Toast.success("Image mise à jour."); await aaLoad(); } catch (err) { Toast.error(err.message); }
    });
  }
});
