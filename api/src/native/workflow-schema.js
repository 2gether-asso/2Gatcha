// Garde-fou de schema : au demarrage, verifie que toutes les colonnes ECRITES
// par les workflows (noeuds de table create/update, champs declares) existent, et
// cree celles qui manquent. Une colonne absente passe a la lecture mais
// l'ecriture est refusee ("Invalid column ...") : une colonne oubliee lors
// d'un deploiement donnait un 500 au premier clic (ex. Users.LastRewardedLevel
// pour la reclamation des recompenses de niveau).

import fs from 'node:fs';
import path from 'node:path';

const NUMERIC = /(At|Until|Count|Level|Hp|Damage|Cost|Streak|Number|Value|Multiplier|Weight|Quantity|Boosters|Reward|Serial|Energy|Total|Pulls|Since|Threshold|Target|Order|Duration|Max|Min|Dust|XP)$/;
const BOOL = /^(Is|Has|Active|Enabled|InVault|Claimed|Opened)/;

export function guessType(field) {
  if (BOOL.test(field)) return 'Bool';
  if (NUMERIC.test(field)) return 'Numeric';
  return 'Any';
}

// { table: Set(colonnes) } d'apres les workflows.
export function writtenColumns(dir) {
  const out = {};
  if (!dir || !fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let wf;
    try { wf = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    for (const n of wf.nodes || []) {
      const p = n.parameters || {};
      if (n.type !== 'n8n-nodes-base.grist' || (p.operation !== 'create' && p.operation !== 'update')) continue;
      const table = String(p.tableId || '');
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(table)) continue;
      for (const prop of (p.fieldsToSend && p.fieldsToSend.properties) || []) {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(prop.fieldId || '')) continue;
        (out[table] = out[table] || new Set()).add(prop.fieldId);
      }
    }
  }
  return out;
}

// Spec pour ensureSchema : seulement les tables existantes (une table entiere
// absente est un oubli plus gros, on ne l'invente pas).
export function workflowSchemaSpec(store, dir) {
  const spec = {};
  for (const [table, cols] of Object.entries(writtenColumns(dir))) {
    if (!store.tables.has(table)) continue;
    for (const col of cols) {
      if (store.table(table).columns[col]) continue;
      (spec[table] = spec[table] || {})[col] = { type: guessType(col) };
    }
  }
  return spec;
}
