// Sauvegarde immediate vers Azure Blob (meme format que les sauvegardes
// automatiques), puis retention.
//
//   npm run backup
//   npm run backup -- --list      (liste les sauvegardes existantes)

import { Store } from '../src/store.js';
import { config } from '../src/config.js';
import { AzureBackup } from '../src/backup.js';

if (!config.backup.sasUrl) {
  console.error('AZURE_BACKUP_SAS_URL manquant (voir .env.example).');
  process.exit(1);
}
const backup = new AzureBackup({ sasUrl: config.backup.sasUrl, prefix: config.backup.prefix });

if (process.argv.includes('--list')) {
  const list = await backup.list();
  if (!list.length) console.log('Aucune sauvegarde.');
  for (const b of list) console.log(`${b.date.toISOString()}  ${(b.size / 1024).toFixed(0).padStart(7)} Ko  ${b.name}`);
  process.exit(0);
}

const store = new Store(config.dbPath);
const r = await backup.backup(store);
console.log(`Sauvegarde envoyee : ${r.name} (${(r.size / 1024).toFixed(0)} Ko)`);
const removed = await backup.prune(config.backup.retentionDays);
if (removed) console.log(`${removed} sauvegarde(s) de plus de ${config.backup.retentionDays} jours supprimee(s).`);
