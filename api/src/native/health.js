// Admin > Sante (2026-11-02) : un coup d'oeil sur le serveur sans ouvrir les
// journaux. Temps de reponse et erreurs (metrics.js), base, sauvegardes,
// flux en direct, dernier envoi Discord, mode en cours.
//   POST /webhook/admin-health { discordId }

import { ok, fail, isAdmin } from './common.js';
import { snapshot } from '../metrics.js';
import { deliveryStatus } from './discord.js';
import { currentMode } from './presets.js';

function handle({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  const tables = Object.fromEntries([...store.tables.values()].map((t) => [t.name, t.rows.size]));
  return ok({
    ...snapshot(),
    discord: deliveryStatus(),
    mode: currentMode(store),
    data: { tables: Object.keys(tables).length, rows: Object.values(tables).reduce((s, n) => s + n, 0), players: tables.Users || 0, pulls: tables.Pulls || 0 }
  });
}

export const routes = { 'POST admin-health': handle };
