// Compte test admin (2026-10-18) : identifiant du compte (setting
// TestAccountId, 9 par defaut, 0 = aucun). Module minuscule, importable
// partout sans cycle (feed, challenges, index...).

import { rawSetting } from './settings.js';
import { currentContext } from './context.js';

export function testAccountId(store) {
  try { return Number(rawSetting(store, 'TestAccountId')) || 0; } catch (e) { return 0; }
}
export const isTestUser = (store, userId) => { const t = testAccountId(store); return t > 0 && Number(userId) === t; };
// La requete en cours est-elle jouee par le compte test ?
export const inTestRequest = (store) => isTestUser(store, currentContext().userId);
