// Bonus personnels (2026-10-07), appliques APRES les workflows (meme principe
// que events.js) : heure de chance, de du jour, talents, maitrise des
// extensions, cours du decraft, cartes ★, niveau d'expedition. Chaque bonus
// est detaille dans la reponse (`bonuses: [{ label, dust }]`) pour que le
// site l'affiche.

import { refId } from './common.js';
import { setting } from './settings.js';
import { talentValue } from './talents.js';
import { luckyState, diceFace } from './daily.js';
import { masteryFinishBonus } from './progression.js';
import { rateFactor } from './market.js';
import { stockFactor } from './modefun.js';
import { expeditionLevel } from './levels.js';
import { isTight } from './inflation.js';
import { dinoTalent, companionBonus } from './dino.js';
import { upgradeValue } from './upgrades.js';

const QUALITY_UP = { damaged: 'worn', worn: 'good', good: 'mint' };

function credit(store, userId, delta) {
  if (!delta) return null;
  const u = store.get('Users', userId);
  return store.update('Users', userId, { StardustCount: Math.max(0, (Number(u.StardustCount) || 0) + delta) }).StardustCount;
}

// Applique une liste de bonus (fraction du gain de base) a un gain de poussieres.
function applyDust(store, userId, json, base, parts) {
  const bonuses = parts.filter((p) => p.k).map((p) => ({ label: p.label, dust: Math.round(base * p.k) })).filter((b) => b.dust);
  const total = bonuses.reduce((s, b) => s + b.dust, 0);
  if (!total) return 0;
  const newStardust = credit(store, userId, total);
  json.bonuses = [...(json.bonuses || []), ...bonuses];
  if (newStardust != null && 'newStardust' in json) json.newStardust = newStardust;
  return total;
}

function upgradeCards(store, json, finishChance, qualityChance) {
  const finishes = store.tables.has('Finishes') ? store.getAll('Finishes').filter((f) => f.Key !== 'normal' && (f.DropWeight || 0) > 0) : [];
  const total = finishes.reduce((s, f) => s + (f.DropWeight || 0), 0);
  const pulls = store.getAll('Pulls').filter((p) => p.BatchId === json.batchId);
  let f = 0, q = 0;
  for (const card of json.cards) {
    const pull = pulls.find((p) => refId(p.Card) === card.cardId && p.SerialNumber === card.serialNumber);
    if (!pull) continue;
    const fields = {};
    if (finishChance > 0 && total && (card.finish || 'normal') === 'normal' && Math.random() < finishChance) {
      let roll = Math.random() * total;
      let key = finishes[finishes.length - 1].Key;
      for (const x of finishes) { roll -= x.DropWeight || 0; if (roll <= 0) { key = x.Key; break; } }
      fields.Finish = key; card.finish = key; card.boosted = true; f++;
    }
    const up = QUALITY_UP[card.quality || 'damaged'];
    if (qualityChance > 0 && up && Math.random() < qualityChance) { fields.Quality = up; card.quality = up; card.qualityBoosted = true; q++; }
    if (Object.keys(fields).length) store.update('Pulls', pull.id, fields);
  }
  return { finishes: f, qualities: q };
}

export function afterWorkflow({ store, path, request, response }) {
  if (response.status !== 200 || !response.json || response.raw || typeof response.json !== 'object') return;
  const body = request.body || {};
  const userId = Number(body.userId);
  const user = userId ? store.get('Users', userId) : null;
  if (!user) return;
  const json = response.json;
  const lucky = luckyState().active ? setting(store, 'LuckyHourDustBonus') : 0;
  const face = diceFace(user);
  const luckyLabel = '🍀 Heure de chance';

  if (path === 'disenchant' && json.disenchanted && json.dustGained > 0) {
    const card = store.get('Cards', Number(body.cardId));
    const rarity = card ? store.get('Rarities', refId(card.Rarity)) : null;
    const rate = rarity ? rateFactor(store, rarity.Key) : 1;
    const starMult = request._starred ? setting(store, 'StarDecraftMultiplier') - 1 : 0;
    applyDust(store, userId, json, json.dustGained, [
      { k: rate - 1, label: rate >= 1 ? '📈 Cours du décraft' : '📉 Cours du décraft' },
      { k: stockFactor(store, Number(body.cardId)) - 1, label: '📊 Bourse des cartes' },
      { k: isTight(store) ? -0.1 : 0, label: '🏦 Mode anti-inflation' },
      { k: starMult, label: '⭐ Carte ★' },
      { k: talentValue(user, 'patron'), label: '💰 Talent Mécène' },
      { k: card && store.countBy('Pulls', 'Card', card.id) < setting(store, 'RareOnServerCopies') ? setting(store, 'RareOnServerDecraftBonus') : 0, label: '💎 Carte rare sur le serveur' },
      { k: face === 4 ? 0.25 : 0, label: '🎲 Dé du jour' },
      { k: lucky, label: luckyLabel }
    ]);
    // Edition Interdite (2026-10-28) : ForbiddenDecraftMult du total, bonus compris.
    if (request._forbidden) {
      const gross = json.dustGained + (json.bonuses || []).reduce((s, b) => s + b.dust, 0);
      applyDust(store, userId, json, gross, [{ k: setting(store, 'ForbiddenDecraftMult') - 1, label: '⛓️ Carte Interdite' }]);
    }
    json.dustGained += (json.bonuses || []).reduce((s, b) => s + b.dust, 0);
  } else if (path === 'dig' && body.action === 'dig' && json.dug && json.dustGained > 0) {
    const added = applyDust(store, userId, json, json.dustGained, [
      { k: talentValue(user, 'tireless'), label: '⛏️ Talent Fouilleur infatigable' },
      { k: upgradeValue(user, 'pickaxe'), label: '⛏️ Pioche affûtée' },
      { k: dinoTalent(user, 'rex') ? 0.25 : 0, label: '🦖 Tyrannosaure' },
      { k: face === 2 ? 0.25 : 0, label: '🎲 Dé du jour' },
      { k: lucky, label: luckyLabel }
    ]);
    json.dustGained += added;
  } else if (path === 'expedition' && body.action === 'claim' && json.reward && json.reward.dust > 0) {
    const lvl = expeditionLevel(store, user);
    const added = applyDust(store, userId, json, json.reward.dust, [
      { k: lvl.perks.dustBonus, label: `🧭 Niveau d’expédition ${lvl.level}` },
      { k: talentValue(user, 'explorer'), label: '🗺️ Talent Explorateur' },
      { k: upgradeValue(user, 'compass'), label: '🧭 Boussole' },
      { k: companionBonus(user), label: '🦖 Dino compagnon' },
      { k: face === 5 ? 0.25 : 0, label: '🎲 Dé du jour' },
      { k: lucky, label: luckyLabel }
    ]);
    json.reward.dust += added;
  } else if (path === 'open-pack' && !body.dryRun && Array.isArray(json.cards) && json.batchId) {
    const extra = masteryFinishBonus(store, userId, json.booster ? json.booster.extensionId : body.extensionId)
      + talentValue(user, 'lynx') + (face === 6 ? 0.05 : 0) + (luckyState().active ? setting(store, 'LuckyHourFinishBonus') : 0)
      + (request._mystery ? setting(store, 'MysteryFinishBonus') : 0)
      // Booster muri (comfort.js) : +1 point par jour sans ouverture.
      + (Number(request._ripe) || 0) * 0.01
      // Coup de chance du jour (mode Medium, modeperks.js) : chance de base doublee.
      + (request._luckyOpen ? setting(store, 'SpecialFinishChance') : 0);
    // Elixir de chance (boutique) : +5 points tant qu'il reste des charges.
    const luck = (Number(user.LuckCharges) || 0) > 0 ? 0.05 : 0;
    if (luck) { store.update('Users', userId, { LuckCharges: (Number(user.LuckCharges) || 0) - 1 }); json.luckChargesLeft = (Number(user.LuckCharges) || 0) - 1; }
    const up = upgradeCards(store, json, Math.min(0.9, extra + luck), talentValue(user, 'born'));
    if (up.finishes || up.qualities) json.personalBoost = up;
    // Talent Recycleur : plus de poussieres de doublons.
    const dup = json.duplicateDust && json.duplicateDust.total;
    const k = talentValue(user, 'recycler');
    if (dup && k) {
      const bonus = Math.round(dup * k);
      const ns = credit(store, userId, bonus);
      json.duplicateDust.total += bonus;
      json.duplicateDust.newStardust = ns;
      json.bonuses = [...(json.bonuses || []), { label: '♻️ Talent Recycleur', dust: bonus }];
    }
  } else if (path === 'archeo' && (json.finished || json.freed)) {
    // Archeologie (2026-11-16) : talent Archeologue et Pinceau d'archeologue,
    // sur le bonus de tablette parfaite et les poussieres des trouvailles.
    const freed = Array.isArray(json.freed) ? json.freed : json.freed ? [json.freed] : [];
    const base = (Number(json.finished && json.finished.bonus) || 0) + freed.reduce((n, f) => n + (Number(f && f.dust) || 0), 0);
    if (base > 0) applyDust(store, userId, json, base, [
      { k: talentValue(user, 'archeologist'), label: '🏺 Talent Archéologue' },
      { k: upgradeValue(user, 'brush'), label: '🖌️ Pinceau d’archéologue' }
    ]);
  } else if (path === 'cook' && body.action === 'deliver' && json.delivered && json.delivered.dust > 0) {
    const added = applyDust(store, userId, json, json.delivered.dust, [
      { k: talentValue(user, 'chef'), label: '👨‍🍳 Talent Cordon-bleu' },
      { k: upgradeValue(user, 'oven'), label: '🍳 Four de chef' }
    ]);
    json.delivered.dust += added;
  } else if (path === 'garden' && body.action === 'harvest' && json.harvested && json.gained) {
    // Talent Recolteur : chaque parcelle a sa chance de recolte double (vers et appats).
    const k = talentValue(user, 'harvester');
    const n = Number(json.harvested) || 0;
    let doubled = 0;
    for (let i = 0; i < n; i++) if (Math.random() < k) doubled++;
    if (doubled) {
      const worms = Math.round((Number(json.gained.worms) || 0) * doubled / n), bait = Math.round((Number(json.gained.bait) || 0) * doubled / n);
      if (worms || bait) {
        const u = store.get('Users', userId);
        store.update('Users', userId, { Worms: (Number(u.Worms) || 0) + worms, GoldBait: (Number(u.GoldBait) || 0) + bait });
        json.gained.worms = (Number(json.gained.worms) || 0) + worms;
        json.gained.bait = (Number(json.gained.bait) || 0) + bait;
        json.harvesterBonus = { plots: doubled, worms, bait };
        json.notices = [...(json.notices || []), { kind: 'talent', icon: '🧺', label: `Talent Récolteur : récolte double sur ${doubled} parcelle${doubled > 1 ? 's' : ''} (+${worms} vers${bait ? `, +${bait} appât${bait > 1 ? 's' : ''} doré${bait > 1 ? 's' : ''}` : ''})` }];
      }
    }
  } else if (path === 'craft' && json.crafted && json.card) {
    const k = talentValue(user, 'thrifty');
    const rarity = json.card.rarity ? store.get('Rarities', Number(json.card.rarity.id)) : null;
    const refund = rarity ? Math.round((Number(rarity.CraftCost) || 0) * k) : 0;
    if (refund) { const ns = credit(store, userId, refund); json.bonuses = [{ label: '🪙 Talent Économe (remboursé)', dust: refund }]; if (ns != null) json.newStardust = ns; }
  } else if ((path === 'foil-upgrade' && json.upgraded) || (path === 'card-quality-repair' && json.repaired)) {
    const k = talentValue(user, 'founder');
    if (k && Math.random() < k) {
      const card = store.get('Cards', Number(body.cardId));
      const rarity = card ? store.get('Rarities', refId(card.Rarity)) : null;
      const dust = Math.max(10, Number(rarity && rarity.DisenchantValue) || 0);
      credit(store, userId, dust);
      json.bonuses = [...(json.bonuses || []), { label: '🔥 Talent Fondeur', dust }];
    }
  }
}

// Routes natives (jardin, archeologie, cuisine) : memes bonus (index.js run).
export const afterNative = (ctx) => { if (['archeo', 'cook', 'garden'].includes(ctx.path)) afterWorkflow(ctx); };
