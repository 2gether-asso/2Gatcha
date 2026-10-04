// Configuration du site : adresse de l'API 2Gatcha (api/README.md) et
// application Discord.
window.APP_CONFIG = {
  // API maison (remplace n8n + Grist depuis le 2026-10-04). Le nom
  // "n8nBaseUrl" est garde pour ne rien casser ailleurs ; quand le conteneur
  // de l'API sert lui-meme le site, il le reecrit a la volee en "/webhook/".
  n8nBaseUrl: "https://gatcha-api.2gether-asso.fr/webhook/",

  // A adapter : Client ID de ton application Discord (visible dans le
  // Developer Portal, il n'est pas secret). L'URI de redirection ci-dessous
  // doit correspondre EXACTEMENT a celle enregistree sur l'application.
  discordClientId: "1551531676335870104",
  discordRedirectUri: window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "auth-callback.html",
  discordScope: "identify guilds",

  // Memes ID Discord que la liste `adminDiscordIds` des workflows admin
  // (n8n/workflows/admin-*.json, executes par l'API). Ne sert ici qu'a
  // afficher (ou pas) le lien "Admin" ; la verification qui compte est cote API.
  adminDiscordIds: ["785223211730075709", "184008667690041345"],

  // Suivi des erreurs du site dans GlitchTip (projet "2Gatcha Website").
  // Coller le DSN COMPLET affiche par GlitchTip, avec sa cle publique :
  // https://<cle>@glitchtip.matiboux.com/3 (vide = desactive). La cle
  // publique d'un DSN n'est pas un secret : elle ne permet que d'envoyer des
  // erreurs.
  glitchtipDsn: "https://glitchtip.matiboux.com/3",

  endpoints: {
    discordLogin: "/discord-login",   // POST { code } -> { userId, pseudo, discordUsername, discordAvatar }
    updatePseudo: "/update-pseudo",   // POST { userId, pseudo } -> { userId, pseudo }
    users: "/users",                  // GET -> { users: [{ userId, pseudo }] }
    cards: "/cards",                  // GET -> liste du catalogue complet
    extensions: "/extensions",        // GET -> { extensions: [{ id, name, key, active, packImageId, cardBackImageId }] }
    openPack: "/open-pack",           // POST { userId, extensionId } -> ouvre 1 booster (5 cartes) de cette extension
    notifyReveal: "/notify-reveal",   // POST { userId, batchIds: [...], action: 'auto'|'share' } -> { notified } - poste sur Discord (annonce auto Mythique/Legendaire/Epique, ou partage manuel), revalide toujours les cartes via BatchId cote serveur
    collection: "/collection",        // GET ?userId=... -> collection de l'utilisateur
    image: "/image",                  // GET ?id=... -> image (WebP) servie par l'API
    boosterStatus: "/booster-status", // GET ?userId=... -> { count, stardust, extensions: [{extensionId,name,key,sortOrder}] } (count = solde générique, commun a toutes les extensions)
    redeemCode: "/redeem-code",       // POST { userId, code } -> { type: 'booster'|'card', ... }
    adminCodes: "/admin-codes",       // POST { discordId, action: 'create'|'list'|'revoke', ... }
    trade: "/trade",                  // POST { userId, action: 'create'|'list'|'respond'|'cancel', ... }
    disenchant: "/disenchant",        // POST { userId, cardId } -> { disenchanted, cardName, dustGained, newStardust }
    craft: "/craft",                  // POST { userId, cardId } -> { crafted, card, craftCost, newStardust }
    adminConfig: "/admin-config",     // POST { discordId, action: 'get'|'set', pityThreshold?, topRarityKey? }
    adminExtensions: "/admin-extensions", // POST { discordId, action: 'create'|'update', ... }
    leaderboard: "/leaderboard",      // GET -> { topPullers, topLegendaries }
    recentPulls: "/recent-pulls",     // GET -> { pulls: [{pseudo,cardName,imageId,rarity,obtainedAt}] }
    publicProfile: "/public-profile", // GET ?pseudo=... -> { pseudo, totalPulls, uniqueCards, cards }
    wishlist: "/wishlist",            // POST { userId, action: 'add'|'remove'|'list', cardId? } -> { wishlist }
    quests: "/quests",                // POST { userId, action: 'status'|'claim' } -> { quests, completedCount, rewardClaimed, canClaim, justClaimedReward }
    adminReset: "/admin-reset",       // POST { discordId, confirm: 'RESET-V1', targetPseudo? } -> { reset: true, scope, targetPseudo, counts }
    siteBanner: "/site-banner",       // GET -> { enabled, type: 'info'|'maintenance', message }
    unlockConfig: "/unlock-config",   // GET -> { themes: {...}, features: {...}, sleeves: {...} }
    dailyWheel: "/daily-wheel",       // POST { userId, action: 'status'|'spin' } -> { canSpin } | { prize, newStardust, newBoosterCount }
    altarSacrifice: "/altar-sacrifice", // POST { userId, cardIds: [id,id,id] } -> { success, card?, isFirstEver? } | { error }
    achievements: "/achievements",    // GET ?userId=... -> { achievements: [{key,icon,name,description,unlocked,progress,goal}], unlockedCount, totalCount }
    pullLog: "/pull-log",             // GET ?userId=... -> { log: [{cardId,cardName,imageId,rarity,extension,source,obtainedAt}], total }
    showcase: "/showcase",            // POST { userId, action: 'add'|'remove'|'list', cardId? } -> { showcase } (max 5 cartes, affichees sur le profil public)
    foilUpgrade: "/foil-upgrade",      // POST { userId, cardId, fromFinish } -> { upgraded, cardId, fromFinish, toFinish, serialNumber } | { error }
    unlockSecret: "/unlock-secret",    // POST { userId } -> { unlocked, card, serialNumber } | { error: 'no_secret_available' }
    weeklyQuests: "/weekly-quests",    // POST { userId, action: 'status'|'claim' } -> { weekStart, quests, completedCount, rewardClaimed, canClaim, justClaimedReward }
    cardQualityRepair: "/card-quality-repair", // POST { userId, cardId, fromQuality } -> { repaired, cardId, fromQuality, toQuality, serialNumber } | { error }
    badges: "/badges",                 // POST { userId, action: 'list'|'buy'|'select', badgeKey? } -> { badges, selectedBadge, newStardust? } | { error }
    eventCalendar: "/event-calendar",  // GET -> { events: [{ label, startsAt, expiresAt, isLive }] }
    communityBoss: "/community-boss",  // POST { userId, action: 'status'|'attack'|'adminCreate', cardId?, discordId?, bossName?, maxHp?, rewardBoosters? }
    guildChest: "/guild-chest",        // POST { userId, action: 'status'|'deposit'|'draw', cardId? }
    blackMarket: "/black-market",      // POST { userId, action: 'list'|'buy'|'adminCreate', offerId?, discordId?, cardId?, cost?, expiresInHours?, maxPurchases? }
    adminGift: "/admin-gift",          // POST { discordId, targetUserId, giftType: 'card'|'booster'|'dust', cardId?, finish?, quality?, quantity? } -> { gifted, giftType, quantity, ... } | { error }
    guessCard: "/guess-card",        // POST { userId, action: 'status'|'guess', cardId? }
    expedition: "/expedition",       // POST { userId, action: 'status'|'start'|'claim', hours?, cardId? }
    dig: "/dig",                       // POST { userId, action: 'status'|'dig' }
    bingo: "/bingo",                   // POST { userId, action: 'status'|'claim'|'adminSetGrid', discordId?, month?, cardIds?, rewardBoosters? }
    levelRewards: "/level-rewards",    // POST { userId, action: 'status'|'claim' } | { discordId, action: 'adminList'|'adminSet', rows? }
    personalVault: "/personal-vault", // POST { userId, action: 'status'|'store'|'withdraw', pullId? } -> { unlocked, rows, boostersPerRow, dustPerRow, reward }
    vault: "/vault"                    // POST { userId, action: 'status'|'open' } -> { card, keysRequired, userKeys, alreadyOpened } | { opened, card, serialNumber, newKeyCount }
  }
};

// Suivi des erreurs (GlitchTip, compatible Sentry) : SDK navigateur officiel
// charge en asynchrone (ne bloque pas l'affichage), empreinte SRI verifiee.
// config.js est le premier script de chaque page : c'est le point le plus tot.
(function initErrorTracking() {
  var dsn = window.APP_CONFIG.glitchtipDsn;
  // Un DSN sans cle publique (https://<cle>@...) serait refuse par le SDK.
  if (!dsn || dsn.indexOf("@") === -1 || /^(localhost|127\.)/.test(window.location.hostname)) return;
  var s = document.createElement("script");
  s.src = "https://browser.sentry-cdn.com/11.4.0/bundle.tracing.min.js";
  s.integrity = "sha384-leCZtyH0v+/d38CQgHkDf/buaYk8uIH2vrAwzlLXVLKTcrvUWEUGan36c9ooM12N";
  s.crossOrigin = "anonymous";
  s.async = true;
  s.onload = function () {
    if (!window.Sentry) return;
    window.Sentry.init({
      dsn: dsn,
      tracesSampleRate: 0.01, // 1 % des chargements de page
      autoSessionTracking: false, // GlitchTip ne gere pas les sessions
      environment: window.location.hostname
    });
    // Joueur connecte (memes cles que Session, core.js) : retrouver qui a
    // rencontre l'erreur.
    try {
      var userId = localStorage.getItem("2gatcha_userId");
      if (userId) window.Sentry.setUser({ id: userId, username: localStorage.getItem("2gatcha_pseudo") || undefined });
    } catch (e) { /* stockage bloque : erreurs anonymes */ }
  };
  document.head.appendChild(s);
})();
