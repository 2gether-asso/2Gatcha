// Sauvegardes de la base vers Azure Blob Storage (API REST, sans SDK).
//
// Acces par URL SAS de CONTENEUR (AZURE_BACKUP_SAS_URL) :
//   https://<compte>.blob.core.windows.net/<conteneur>?sv=...&sig=...
// Droits necessaires sur le SAS : Read, Add/Create, Write, Delete, List
// (Delete/List servent uniquement a la retention).
//
// Chaque sauvegarde = une copie coherente (VACUUM INTO) compressee en gzip :
//   <prefixe>/2gatcha-2026-10-04T12-00-00Z.sqlite.gz
// Les tables, les comptes joueurs ET les images sont dans ce seul fichier.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const API_VERSION = '2021-08-06';
const NAME_RE = /2gatcha-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})Z\.sqlite\.gz$/;

export class AzureBackup {
  constructor({ sasUrl, prefix = 'backups', log = console }) {
    if (!sasUrl) throw new Error('AZURE_BACKUP_SAS_URL manquant');
    const u = new URL(sasUrl);
    this.base = `${u.origin}${u.pathname.replace(/\/$/, '')}`; // .../conteneur
    this.sas = u.search.replace(/^\?/, '');
    this.prefix = prefix.replace(/^\/|\/$/g, '');
    this.log = log;
  }

  blobUrl(name, extra = '') {
    return `${this.base}/${name.split('/').map(encodeURIComponent).join('/')}?${this.sas}${extra}`;
  }

  async request(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { 'x-ms-version': API_VERSION, ...(options.headers || {}) }, signal: AbortSignal.timeout(5 * 60 * 1000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const code = (body.match(/<Code>([^<]+)<\/Code>/) || [])[1];
      throw new Error(`Azure ${res.status}${code ? ' ' + code : ''} sur ${options.method || 'GET'} ${url.split('?')[0]}`);
    }
    return res;
  }

  // Sauvegarde maintenant. Renvoie { name, size }.
  async backup(store) {
    const tmp = path.join(os.tmpdir(), `2gatcha-backup-${process.pid}-${Date.now()}.sqlite`);
    try {
      store.snapshotTo(tmp);
      const data = await gzip(fs.readFileSync(tmp), { level: 9 });
      const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
      const name = `${this.prefix}/2gatcha-${stamp.replace(/Z$/, '')}Z.sqlite.gz`;
      await this.request(this.blobUrl(name), {
        method: 'PUT',
        headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/gzip', 'Content-Length': String(data.length) },
        body: data
      });
      return { name, size: data.length };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  // Liste des sauvegardes, de la plus recente a la plus ancienne.
  async list() {
    const out = [];
    let marker = '';
    do {
      const url = `${this.base}?restype=container&comp=list&prefix=${encodeURIComponent(this.prefix + '/')}${marker ? `&marker=${encodeURIComponent(marker)}` : ''}&${this.sas}`;
      const xml = await (await this.request(url)).text();
      for (const m of xml.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)) {
        const name = (m[1].match(/<Name>([^<]+)<\/Name>/) || [])[1];
        const size = Number((m[1].match(/<Content-Length>(\d+)<\/Content-Length>/) || [])[1] || 0);
        const stamp = name && (name.match(NAME_RE) || [])[1];
        if (!stamp) continue;
        const [d, t] = stamp.split('T');
        out.push({ name, size, date: new Date(`${d}T${t.replace(/-/g, ':')}Z`) });
      }
      marker = (xml.match(/<NextMarker>([^<]*)<\/NextMarker>/) || [])[1] || '';
    } while (marker);
    return out.sort((a, b) => b.date - a.date);
  }

  // Retention : garde tout ce qui a moins de `days` jours, et toujours au
  // moins les `keepMin` plus recentes (jamais de base sans sauvegarde).
  async prune(days, keepMin = 3) {
    const all = await this.list();
    const limit = Date.now() - days * 86400 * 1000;
    const doomed = all.slice(keepMin).filter((b) => b.date.getTime() < limit);
    for (const b of doomed) await this.request(this.blobUrl(b.name), { method: 'DELETE' });
    return doomed.length;
  }

  // Telecharge une sauvegarde (nom complet, ou "latest") et la decompresse
  // dans `dest`. Renvoie le nom de la sauvegarde restauree.
  async download(nameOrLatest, dest) {
    let name = nameOrLatest;
    if (!name || name === 'latest') {
      const [last] = await this.list();
      if (!last) throw new Error('Aucune sauvegarde trouvee dans le conteneur.');
      name = last.name;
    } else if (!name.includes('/')) name = `${this.prefix}/${name}`;
    const res = await this.request(this.blobUrl(name));
    const data = await gunzip(Buffer.from(await res.arrayBuffer()));
    fs.writeFileSync(dest, data);
    return name;
  }
}

// Planificateur integre au serveur : une sauvegarde toutes les `hours`
// heures (premiere 2 min apres le demarrage), sautee si rien n'a change
// depuis la precedente, puis application de la retention.
export function startBackupSchedule({ store, backup, hours, retentionDays, log = console }) {
  let lastChanges = -1;
  let running = false;
  const status = { lastBackup: null, lastError: null, nextAt: null };
  const run = async (force = false) => {
    if (running) return status;
    if (!force && store.changes === lastChanges) {
      log.log('[sauvegarde] aucune modification depuis la derniere sauvegarde, creneau saute');
      return status;
    }
    running = true;
    const changesAtStart = store.changes;
    try {
      const r = await backup.backup(store);
      lastChanges = changesAtStart;
      status.lastBackup = { ...r, at: new Date().toISOString() };
      status.lastError = null;
      const removed = await backup.prune(retentionDays).catch((e) => { log.error('[sauvegarde] retention : ' + e.message); return 0; });
      log.log(`[sauvegarde] ${r.name} (${(r.size / 1024).toFixed(0)} Ko)${removed ? `, ${removed} ancienne(s) supprimee(s)` : ''}`);
    } catch (e) {
      status.lastError = { message: e.message, at: new Date().toISOString() };
      log.error('[sauvegarde] ECHEC : ' + e.message);
    } finally {
      running = false;
    }
    return status;
  };
  const every = Math.max(0.25, hours) * 3600 * 1000;
  setTimeout(() => {
    run();
    setInterval(run, every).unref();
  }, 2 * 60 * 1000).unref();
  status.nextAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  return { run, status };
}
