// Import complet du document Grist vers la base SQLite de l'API.
//
//   GRIST_API_KEY=... npm run import
//
// Lecture seule cote Grist. Remplace INTEGRALEMENT le contenu de la base
// locale (tables, lignes, images). A lancer au moment de la bascule, site en
// maintenance pour qu'aucune action ne se perde entre l'import et le
// changement d'URL (voir README).

import { Store } from '../src/store.js';
import { config } from '../src/config.js';

const GRIST_URL = (process.env.GRIST_URL || 'https://grist.matiboux.com/o/2gether').replace(/\/$/, '');
const DOC = process.env.GRIST_DOC || 'cRP1WgZQv7KmwmVrUbuEF8';
const KEY = process.env.GRIST_API_KEY;
if (!KEY) {
  console.error('GRIST_API_KEY manquant (Grist > Profil > API key).');
  process.exit(1);
}
const SKIP_IMAGES = process.env.SKIP_IMAGES === '1';
// IMAGES_ONLY=1 : ne rapatrie que les images manquantes, sans toucher aux
// donnees (utile si le stockage des pieces jointes Grist etait indisponible).
const IMAGES_ONLY = process.env.IMAGES_ONLY === '1';

async function grist(pathname, asBuffer = false) {
  const res = await fetch(`${GRIST_URL}/api/docs/${DOC}${pathname}`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`Grist ${res.status} sur ${pathname}: ${(await res.text()).slice(0, 200)}`);
  return asBuffer ? { data: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') } : res.json();
}

const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

const store = new Store(config.dbPath);
const t0 = Date.now();
const { tables } = await grist('/tables');
const report = { tables: {}, formulas: [], triggerFormulas: [], missingImages: [] };
const dataByTable = {};

for (const t of IMAGES_ONLY ? [] : tables) {
  const tableId = t.id;
  const { columns } = await grist(`/tables/${tableId}/columns`);
  const cols = {};
  for (const c of columns) {
    if (c.id.startsWith('gristHelper_') || c.id === 'manualSort') continue;
    const f = c.fields || {};
    cols[c.id] = { type: f.type || 'Any', isFormula: !!f.isFormula, formula: f.formula || '' };
    if (f.isFormula && f.formula) report.formulas.push(`${tableId}.${c.id} = ${f.formula}`);
    else if (f.formula) report.triggerFormulas.push(`${tableId}.${c.id} = ${f.formula}`);
  }
  const { records } = await grist(`/tables/${tableId}/records`);
  dataByTable[tableId] = { cols, records };
  report.tables[tableId] = records.length;
}

let images = 0;
const attachmentRows = [];
if (!SKIP_IMAGES) {
  const { records } = await grist('/attachments');
  for (const a of records) {
    if (IMAGES_ONLY && store.getAttachment(a.id)) continue;
    const name = (a.fields && a.fields.fileName) || `attachment-${a.id}`;
    let file;
    try {
      file = await grist(`/attachments/${a.id}/download`, true);
    } catch (e) {
      // Piece jointe deja introuvable cote Grist (fichier perdu dans son
      // stockage) : deja cassee en production, on continue sans elle.
      report.missingImages.push(`#${a.id} ${name}`);
      // Garde la trace (nom d'origine) pour la re-importer depuis l'admin.
      if (!store.getAttachment(a.id)) attachmentRows.push([a.id, name, MIME_BY_EXT[name.split('.').pop().toLowerCase()] || null, null]);
      continue;
    }
    const ext = name.split('.').pop().toLowerCase();
    attachmentRows.push([a.id, name, MIME_BY_EXT[ext] || file.type || 'application/octet-stream', file.data]);
    images++;
    if (images % 25 === 0) process.stdout.write(`  ${images} images...\r`);
  }
}

// Ecriture en une seule transaction : la base n'est jamais a moitie importee.
store.transaction(() => {
  if (!IMAGES_ONLY) store.db.exec('DELETE FROM rows; DELETE FROM meta_tables;');
  for (const [tableId, { cols, records }] of Object.entries(dataByTable)) {
    store.stmt.upsertTable.run(tableId, JSON.stringify(cols));
    for (const r of records) store.stmt.upsertRow.run(tableId, r.id, JSON.stringify({ id: r.id, ...r.fields }));
  }
  for (const row of attachmentRows) store.stmt.putAttachment.run(...row);
});

console.log(`Import termine en ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${config.dbPath}`);
console.table(report.tables);
console.log(`${images} image(s) importee(s)${SKIP_IMAGES ? ' (images ignorees : SKIP_IMAGES=1)' : ''}.`);
if (report.missingImages.length) {
  console.log(`
${report.missingImages.length} image(s) introuvable(s) cote Grist (deja cassees en production) :`);
  report.missingImages.forEach((m) => console.log('  - ' + m));
}
if (report.formulas.length) {
  console.log('\nColonnes FORMULE (valeurs figees a l\'import, plus recalculees par l\'API) :');
  report.formulas.forEach((f) => console.log('  - ' + f));
}
if (report.triggerFormulas.length) {
  console.log('\nFormules de valeur par defaut (seules NOW()/TODAY() sont imitees) :');
  report.triggerFormulas.forEach((f) => console.log('  - ' + f));
}
