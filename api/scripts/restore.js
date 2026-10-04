// Restaure une sauvegarde Azure Blob a la place de la base locale.
// L'API doit etre ARRETEE (docker compose stop api) pendant la restauration.
//
//   npm run restore -- latest
//   npm run restore -- 2gatcha-2026-10-04T12-00-00Z.sqlite.gz
//
// L'ancienne base n'est jamais supprimee : elle est renommee en
// <base>.avant-restauration-<date>.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../src/config.js';
import { AzureBackup } from '../src/backup.js';

if (!config.backup.sasUrl) {
  console.error('AZURE_BACKUP_SAS_URL manquant (voir .env.example).');
  process.exit(1);
}
const which = process.argv[2] || 'latest';
const backup = new AzureBackup({ sasUrl: config.backup.sasUrl, prefix: config.backup.prefix });
const dbPath = path.resolve(config.dbPath);
const tmp = `${dbPath}.restauration-en-cours`;

const name = await backup.download(which, tmp);

// Verifie que le fichier est bien une base 2Gatcha avant de toucher a quoi
// que ce soit.
const check = new DatabaseSync(tmp, { readOnly: true });
const tables = check.prepare('SELECT COUNT(*) AS n FROM meta_tables').get().n;
const rows = check.prepare('SELECT COUNT(*) AS n FROM rows').get().n;
const images = check.prepare('SELECT COUNT(*) AS n FROM attachments WHERE data IS NOT NULL').get().n;
check.close();
if (!tables) {
  fs.rmSync(tmp, { force: true });
  console.error(`${name} ne contient aucune table : restauration annulee.`);
  process.exit(1);
}

if (fs.existsSync(dbPath)) {
  const keep = `${dbPath}.avant-restauration-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.renameSync(dbPath, keep);
  console.log(`Ancienne base conservee : ${keep}`);
}
for (const sfx of ['-wal', '-shm']) fs.rmSync(dbPath + sfx, { force: true });
fs.renameSync(tmp, dbPath);
console.log(`Restauree depuis ${name} : ${tables} tables, ${rows} lignes, ${images} images.`);
console.log('Tu peux redemarrer l\'API (docker compose start api).');
