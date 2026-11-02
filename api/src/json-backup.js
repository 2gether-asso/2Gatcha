// Sauvegardes JSON planifiees (2026-11-02) : le meme fichier que le bouton
// « Telecharger la sauvegarde » de l'admin (admin.js writeSave), compresse,
// garde a cote de la base, sans Azure. Frequence et nombre gardes : reglages
// JsonBackupDays (0 = arret) et JsonBackupKeep.
//   <dossier de la base>/sauvegardes-json/2gatcha-2026-11-02T03-00-00Z.json.gz

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';

const NAME_RE = /^2gatcha-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json\.gz$/;

export function createJsonBackups({ store, dbPath, withLock, writeSave, days, keep, log = console }) {
  const dir = path.join(path.dirname(path.resolve(dbPath)), 'sauvegardes-json');
  const status = { last: null, lastError: null, running: false };
  const list = () => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => NAME_RE.test(f)).map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, at: st.mtime.toISOString() };
    }).sort((a, b) => b.name.localeCompare(a.name));
  };
  const fileOf = (name) => (NAME_RE.test(String(name)) && fs.existsSync(path.join(dir, name)) ? path.join(dir, name) : null);
  async function run() {
    if (status.running) return status;
    status.running = true;
    const name = `2gatcha-${new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')}.json.gz`;
    const tmp = path.join(dir, name + '.part');
    try {
      fs.mkdirSync(dir, { recursive: true });
      const pass = new PassThrough();
      const done = pipeline(pass, zlib.createGzip({ level: 6 }), fs.createWriteStream(tmp));
      await writeSave(pass, { store, withLock, withImages: true });
      await done;
      fs.renameSync(tmp, path.join(dir, name));
      list().slice(Math.max(1, keep())).forEach((b) => fs.rmSync(path.join(dir, b.name), { force: true }));
      status.last = { name, at: new Date().toISOString(), size: fs.statSync(path.join(dir, name)).size };
      status.lastError = null;
      log.log(`[sauvegarde JSON] ${name}`);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      status.lastError = { message: e.message, at: new Date().toISOString() };
      log.error('[sauvegarde JSON] ECHEC : ' + e.message);
    } finally {
      status.running = false;
    }
    return status;
  }
  // Verification toutes les heures : une sauvegarde si la derniere a plus de « days » jours.
  function tick() {
    const d = Number(days()) || 0;
    if (d <= 0) return;
    const last = list()[0];
    if (!last || Date.now() - Date.parse(last.at) >= d * 86400 * 1000) run();
  }
  setTimeout(tick, 5 * 60 * 1000).unref();
  setInterval(tick, 3600 * 1000).unref();
  return { dir, list, fileOf, run, status };
}
