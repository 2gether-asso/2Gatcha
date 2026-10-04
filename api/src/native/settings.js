// Reglages du jeu modifiables depuis l'admin (site/admin.html, "Reglages
// avances").
//
// Un registre unique decrit chaque reglage : libelle, groupe, type, defaut,
// bornes et aide. Deux stockages :
//   - 'app'    : table AppSettings (cle -> valeur JSON). "Jamais regle" et
//                "regle a 0" se distinguent : pour les fonctionnalites natives.
//   - 'config' : colonne de la ligne Config, pour les reglages LUS PAR LES
//                WORKFLOWS (vide ou 0 = defaut, convention des workflows).
//   GET/POST /webhook/admin-settings  { discordId, action: 'get' | 'set' | 'reset', values?, key? }

import { ok, fail, isAdmin, configRow } from './common.js';

const pct = (label, def, group, help) => ({ label, type: 'number', def, min: 0, max: 1, step: 0.001, group, help, unit: 'probabilité (0 à 1)' });
const int = (label, def, group, help, min = 0, max = 100000) => ({ label, type: 'number', def, min, max, step: 1, group, help });

export const REGISTRY = {
  // --- Securite
  RateLimitWritesPerMinute: { ...int('Actions par minute et par joueur', 60, 'Sécurité', "Au-delà, l'API répond « trop de requêtes » jusqu'à la minute suivante.", 5, 1000), storage: 'app' },
  RateLimitReadsPerMinute: { ...int('Lectures par minute et par joueur', 400, 'Sécurité', 'Consultations (statuts, listes).', 20, 10000), storage: 'app' },
  AuthTokenDays: { ...int('Durée de connexion (jours)', 60, 'Sécurité', 'Après ce délai, le joueur doit se reconnecter avec Discord.', 1, 365), storage: 'app' },

  // --- Boosters (lus par le workflow open-pack)
  SpecialFinishChance: { ...pct('Chance de finition spéciale', 0.10, 'Boosters', 'Holo, doré, ghost… par carte tirée.'), storage: 'config' },
  ShinyPackChance: { ...pct('Chance de booster shiny', 0.001, 'Boosters', 'Booster aux cartes meilleures que d’habitude.'), storage: 'config' },
  BonusCardChance: { ...pct('Chance de carte bonus', 0.10, 'Boosters', 'Une 6e carte dans le booster.'), storage: 'config' },
  XpPerBoosterOpen: { ...int('XP par booster ouvert', 10, 'Boosters', ''), storage: 'config' },
  DuplicateDustCommon: { ...int('Poussières par doublon commun', 5, 'Boosters', 'Gagnées automatiquement à l’ouverture.'), storage: 'app' },
  DuplicateDustOther: { ...int('Poussières par doublon (rare et plus)', 10, 'Boosters', ''), storage: 'app' },

  // --- Coffres
  ChestCost: { ...int('Prix d’un coffre (poussières)', 100, 'Coffres', '', 1), storage: 'app' },
  ChestEveryLevels: { ...int('Un coffre offert tous les N niveaux', 5, 'Coffres', '0 = jamais.'), storage: 'app' },
  KeyEveryLevels: { ...int('Une clé offerte tous les N niveaux', 10, 'Coffres', '0 = jamais.'), storage: 'app' },
  ChestDustMin: { ...int('Poussières minimum', 40, 'Coffres', ''), storage: 'app' },
  ChestDustMax: { ...int('Poussières maximum', 120, 'Coffres', ''), storage: 'app' },
  ChestCardChance: { ...pct('Chance d’une carte', 0.7, 'Coffres', ''), storage: 'app' },
  ChestSecondCardChance: { ...pct('Chance d’une 2e carte', 0.2, 'Coffres', ''), storage: 'app' },
  ChestBoosterChance: { ...pct('Chance d’un booster', 0.35, 'Coffres', ''), storage: 'app' },
  ChestDoubleBoosterChance: { ...pct('Chance de 2 boosters', 0.08, 'Coffres', ''), storage: 'app' },
  ChestSpecialFinishChance: { ...pct('Chance de finition spéciale (cartes du coffre)', 0.15, 'Coffres', ''), storage: 'app' },

  // --- Peche
  FishingCost: { ...int('Prix d’un lancer (poussières)', 30, 'Pêche', '', 1), storage: 'app' },
  FishingDailyCasts: { ...int('Lancers par jour', 20, 'Pêche', '0 = illimité.'), storage: 'app' },
  FishingLoot: {
    label: 'Table des prises', type: 'json', group: 'Pêche', storage: 'app',
    help: 'Liste de prises : type (nothing, dust, bone, key, booster, chest), poids (chance relative), min/max (quantité).',
    def: [
      { type: 'nothing', weight: 28, label: 'Une vieille botte' },
      { type: 'dust', weight: 30, min: 10, max: 45 },
      { type: 'bone', weight: 18, min: 1, max: 1 },
      { type: 'booster', weight: 11, min: 1, max: 1 },
      { type: 'chest', weight: 8, min: 1, max: 1 },
      { type: 'key', weight: 5, min: 1, max: 1 }
    ]
  },

  // --- Saison
  SeasonEnabled: { label: 'Saisons activées', type: 'bool', def: true, group: 'Saison', storage: 'app', help: '' },
  SeasonTiers: { ...int('Nombre de paliers', 10, 'Saison', '', 1, 50), storage: 'app' },
  SeasonXpPerTier: { ...int('XP par palier', 120, 'Saison', 'XP gagnée pendant le mois.', 1), storage: 'app' },
  SeasonRewards: {
    label: 'Récompenses des paliers', type: 'json', group: 'Saison', storage: 'app',
    help: 'Un objet par palier (dans l’ordre) : dust, boosters, chests, keys. Le dernier palier donne aussi la carte de la saison si elle est choisie.',
    def: [
      { dust: 50 }, { boosters: 1 }, { dust: 80 }, { chests: 1 }, { dust: 120 },
      { boosters: 2 }, { dust: 150 }, { keys: 1 }, { boosters: 2, dust: 150 }, { chests: 1, boosters: 3 }
    ]
  },

  // --- Serie de connexion
  LoginStreakRewards: {
    label: 'Cadeaux des 7 jours', type: 'json', group: 'Série de connexion', storage: 'app',
    help: '7 objets : dust et/ou boosters.',
    def: [{ dust: 20 }, { dust: 30 }, { dust: 40 }, { boosters: 1 }, { dust: 60 }, { dust: 80 }, { boosters: 2, dust: 150 }]
  },

  // --- Sets complets
  SetRewardBoosters: { ...int('Boosters par set complet', 3, 'Sets complets', ''), storage: 'app' },
  SetRewardDust: { ...int('Poussières par set complet', 300, 'Sets complets', ''), storage: 'app' },

  // --- Boss
  BossFinisherBoosters: { ...int('Boosters bonus du coup final', 2, 'Boss', '0 = pas de bonus.'), storage: 'app' },
  BossVolleyStep: { label: 'Bonus de salve par carte en plus', type: 'number', def: 0.1, min: 0, max: 1, step: 0.01, group: 'Boss', storage: 'app', help: '0,1 = +10 % par carte.' },
  BossMaxCards: { ...int('Cartes max par salve', 10, 'Boss', '', 1, 50), storage: 'app' },
  BossFinishMultipliers: { label: 'Multiplicateurs de finition', type: 'json', group: 'Boss', storage: 'app', help: '', def: { normal: 1, holo: 1.5, gold: 2, ghost: 2.5, diamond: 3, rainbow: 5 } },
  BossQualityMultipliers: { label: 'Multiplicateurs d’état', type: 'json', group: 'Boss', storage: 'app', help: '', def: { damaged: 0.75, worn: 1, good: 1.25, mint: 1.5 } },

  // --- Fouille / coffre-fort perso (lus par les workflows)
  DogBoneCost: { ...int('Prix d’un os (poussières)', 150, 'Fouille', 'Envoie le chien creuser 2 h.', 1), storage: 'config' },
  VaultBoostersPerRow: { ...int('Coffre-fort : boosters par ligne complète', 6, 'Coffre-fort perso', ''), storage: 'config' },
  VaultDustPerRow: { ...int('Coffre-fort : poussières par ligne complète', 200, 'Coffre-fort perso', ''), storage: 'config' },

  // --- Notifications
  PushQuietStart: { ...int('Pas de notification à partir de (heure)', 22, 'Notifications', 'Heure de Paris.', 0, 23), storage: 'app' },
  PushQuietEnd: { ...int('Reprise des notifications à (heure)', 9, 'Notifications', '', 0, 23), storage: 'app' }
};

// Colonnes Config a creer pour les reglages lus par les workflows.
export const schema = {
  AppSettings: { Key: { type: 'Text' }, Value: { type: 'Text' } },
  Config: Object.fromEntries(Object.entries(REGISTRY).filter(([, r]) => r.storage === 'config').map(([k]) => [k, { type: 'Numeric' }]))
};

function appRow(store, key) {
  return store.tables.has('AppSettings') ? store.getAll('AppSettings').find((r) => r.Key === 'setting:' + key) : null;
}

// Valeur effective d'un reglage (defaut si jamais regle).
export function setting(store, key) {
  const r = REGISTRY[key];
  if (!r) throw new Error('Reglage inconnu : ' + key);
  if (r.storage === 'config') {
    const v = configRow(store)[key];
    return v == null || v === '' || Number(v) === 0 ? r.def : Number(v);
  }
  const row = appRow(store, key);
  if (!row) return r.def;
  try { return JSON.parse(row.Value); } catch (e) { return r.def; }
}

function validate(key, raw) {
  const r = REGISTRY[key];
  if (r.type === 'bool') return !!raw;
  if (r.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${r.label} : nombre attendu`);
    if (r.min != null && n < r.min) throw new Error(`${r.label} : minimum ${r.min}`);
    if (r.max != null && n > r.max) throw new Error(`${r.label} : maximum ${r.max}`);
    return n;
  }
  if (r.type === 'json') {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(r.def) !== Array.isArray(v) || typeof v !== 'object' || v === null) throw new Error(`${r.label} : format attendu ${Array.isArray(r.def) ? 'liste [...]' : 'objet {...}'}`);
    if (key === 'LoginStreakRewards' && v.length !== 7) throw new Error(`${r.label} : il faut exactement 7 jours`);
    if (key === 'FishingLoot' && (!v.length || v.some((x) => !x || !['nothing', 'dust', 'bone', 'key', 'booster', 'chest'].includes(x.type) || !(Number(x.weight) > 0)))) throw new Error(`${r.label} : chaque prise a un type connu et un poids > 0`);
    return v;
  }
  return String(raw);
}

function writeSetting(store, key, value) {
  const r = REGISTRY[key];
  if (r.storage === 'config') {
    const cfg = store.getAll('Config')[0];
    if (cfg) store.update('Config', cfg.id, { [key]: value }); else store.create('Config', { [key]: value });
    return;
  }
  const row = appRow(store, key);
  if (row) store.update('AppSettings', row.id, { Value: JSON.stringify(value) });
  else store.create('AppSettings', { Key: 'setting:' + key, Value: JSON.stringify(value) });
}

function listSettings(store) {
  return Object.entries(REGISTRY).map(([key, r]) => {
    const custom = r.storage === 'config' ? (() => { const v = configRow(store)[key]; return !(v == null || v === '' || Number(v) === 0); })() : !!appRow(store, key);
    return { key, label: r.label, group: r.group, type: r.type, help: r.help || '', unit: r.unit || '', min: r.min, max: r.max, step: r.step, def: r.def, value: setting(store, key), custom };
  });
}

function handleSettings({ store, body }) {
  if (!isAdmin(body.discordId)) return fail('forbidden', 403);
  if (body.action === 'set') {
    const values = body.values || {};
    const errors = [];
    const clean = {};
    for (const [k, v] of Object.entries(values)) {
      if (!REGISTRY[k]) { errors.push(`Réglage inconnu : ${k}`); continue; }
      try { clean[k] = validate(k, v); } catch (e) { errors.push(e.message); }
    }
    if (errors.length) return fail('invalid_settings', 400, { errors });
    for (const [k, v] of Object.entries(clean)) writeSetting(store, k, v);
  } else if (body.action === 'reset' && REGISTRY[body.key]) {
    const r = REGISTRY[body.key];
    if (r.storage === 'config') writeSetting(store, body.key, 0);
    else { const row = appRow(store, body.key); if (row) store.delete('AppSettings', row.id); }
  }
  return ok({ settings: listSettings(store) });
}

export const routes = { 'POST admin-settings': handleSettings };
