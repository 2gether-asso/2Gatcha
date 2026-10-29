// Configuration du site : adresse de l'API 2Gatcha (api/README.md) et
// application Discord.
window.APP_CONFIG = {
  // Adresse de l'API 2Gatcha. Quand le conteneur de l'API sert lui-meme le
  // site, il la reecrit a la volee en "/webhook/" (meme domaine).
  apiBaseUrl: "https://gatcha-api.2gether-asso.fr/webhook/",

  // A adapter : Client ID de ton application Discord (visible dans le
  // Developer Portal, il n'est pas secret). L'URI de redirection ci-dessous
  // doit correspondre EXACTEMENT a celle enregistree sur l'application.
  discordClientId: "1551531676335870104",
  discordRedirectUri: window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "auth-callback.html",
  discordScope: "identify guilds",

  // Memes ID Discord que la liste `adminDiscordIds` des workflows admin
  // (api/workflows/admin-*.json). Ne sert ici qu'a
  // afficher (ou pas) le lien "Admin" ; la verification qui compte est cote API.
  adminDiscordIds: ["785223211730075709", "184008667690041345"],

  // Suivi des erreurs du site dans GlitchTip (projet "2Gatcha Website").
  // Coller le DSN COMPLET affiche par GlitchTip, avec sa cle publique :
  // https://<cle>@glitchtip.matiboux.com/3 (vide = desactive). La cle
  // publique d'un DSN n'est pas un secret : elle ne permet que d'envoyer des
  // erreurs.
  glitchtipDsn: "https://335830613bd443a8853dc7e145f41def@glitchtip.matiboux.com/3",

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
    showcase: "/showcase",            // POST { userId, action: 'add'|'remove'|'list', cardId? } -> { showcase } (max 6 cartes, affichees sur le profil public)
    foilUpgrade: "/foil-upgrade",      // POST { userId, cardId, fromFinish } -> { upgraded, cardId, fromFinish, toFinish, serialNumber } | { error }
    unlockSecret: "/unlock-secret",    // POST { userId } -> { unlocked, card, serialNumber } | { error: 'no_secret_available' }
    weeklyQuests: "/weekly-quests",    // POST { userId, action: 'status'|'claim' } -> { weekStart, quests, completedCount, rewardClaimed, canClaim, justClaimedReward }
    cardQualityRepair: "/card-quality-repair", // POST { userId, cardId, fromQuality } -> { repaired, cardId, fromQuality, toQuality, serialNumber } | { error }
    badges: "/badges",                 // POST { userId, action: 'list'|'buy'|'select', badgeKey? } -> { badges, selectedBadge, newStardust? } | { error }
    eventCalendar: "/event-calendar",  // GET -> { events: [{ label, startsAt, expiresAt, isLive }] }
    communityBoss: "/community-boss",  // POST { userId, action: 'status'|'attack'|'adminCreate', cardId?, discordId?, bossName?, maxHp?, rewardBoosters? }
    guildChest: "/guild-chest",        // POST { userId, action: 'status'|'deposit'|'take'|'free', pullIds?, depositId?, pay? } (v2 natif, 2026-10-18)
    blackMarket: "/black-market",      // POST { userId, action: 'list'|'buy'|'adminCreate', offerId?, discordId?, cardId?, cost?, expiresInHours?, maxPurchases? }
    adminGift: "/admin-gift",          // POST { discordId, targetUserId, giftType: 'card'|'booster'|'dust', cardId?, finish?, quality?, quantity? } -> { gifted, giftType, quantity, ... } | { error }
    guessCard: "/guess-card",        // POST { userId, action: 'status'|'guess', cardId? }
    expedition: "/expedition",       // POST { userId, action: 'status'|'start'|'claim', hours?, cardId? }
    dig: "/dig",                       // POST { userId, action: 'status'|'dig' }
    bingo: "/bingo",                   // POST { userId, action: 'status'|'claim'|'adminSetGrid', discordId?, month?, cardIds?, rewardBoosters? }
    levelRewards: "/level-rewards",    // POST { userId, action: 'status'|'claim' } | { discordId, action: 'adminList'|'adminSet', rows? }
    skillsLeaderboard: "/skills-leaderboard", // GET -> { week, fishing, dig }
    challenges: "/challenges",          // POST { userId, action: 'status'|'pick'|'claim', keys? }
    communityGoal: "/community-goal",   // POST { userId, action: 'status'|'claim' }
    themes: "/themes",                  // POST { userId, action: 'status'|'claim', key? }
    cosmetics: "/cosmetics",            // POST { userId, action: 'status'|'buy'|'equip', key?, type? }
    reroll: "/reroll",                  // POST { userId, kind: 'weather'|'expedition' }
    economyRules: "/economy-rules",     // GET ?userId= -> prix des relances, taxe, os
    cardInfo: "/card-info",             // GET ?cardId=&userId=
    wishlistAlerts: "/wishlist-alerts", // POST { userId }
    profileWall: "/profile-wall",       // GET ?profileId= | POST { userId, action: 'post'|'delete' }
    discoveries: "/discoveries",             // POST { userId, action: 'reset' } (revoir les animations de decouverte)
    discoveriesCatalog: "/discoveries-catalog", // GET (previsualisation des animations, admin)
    dino: "/dino",                      // POST { userId, action: 'status'|'hatch'|'feed'|'play'|'clean'|'rename', dino?, food?, name? }
    garden: "/garden",                  // POST { userId, action: 'status'|'plant'|'harvest' }
    visuals: "/visuals",                // GET -> { overrides } (visuels modifies dans l'admin)
    ripen: "/ripen",                   // POST { userId, action: 'status'|'store'|'claim'|'cancel', items?, stage?, lotId? } (murissoir du distributeur, 2026-10-18)
    forbidden: "/forbidden",           // POST { userId, action: status|gear|scroll|craftKey|insertKey|spin|nudge|risk } (salle interdite, 2026-10-19)
    secrets: "/secrets",               // POST { userId, action } (petits secrets du site, 2026-10-19)
    secretCard: "/secret-card",        // GET -> { imageId, others } (glitch de la carte 404)
    timers: "/timers",                 // GET ?userId -> { now, items } (minuteurs de l'inventaire, 2026-10-18)
    seasonQuests: "/season-quests",   // POST { userId, action: 'status'|'claim', key? } (defis de saison, 2026-10-18)
    story: "/story",                   // POST/GET { userId, action: 'status'|'claim' } (quetes d'histoire)
    patchNotes: "/patch-notes",        // GET -> { notes, latest } (notes de mise a jour)
    adminSurprise: "/admin-surprise",  // POST { discordId, action: 'status'|'start'|'stop', key? } (evenements surprises)
    museum: "/museum",                 // POST/GET { userId } (musee du coffre-fort, 2026-10-18)
    artists: "/artists",               // GET [?userId] -> { artists } (artistes a l'honneur, 2026-10-30)
    artist: "/artist",                 // GET ?slug= [&userId] -> { artist, cards, extensions, stats }
    starter: "/starter",               // POST/GET { userId, action: 'status'|'claim', key? } (parcours du debutant, 2026-10-18)
    adminTestAccount: "/admin-test-account", // POST { discordId, action: 'status'|'login'|'set'|'reset'|'cards', levels?, resources?, mode? } (compte test, 2026-10-18)
    adminVisuals: "/admin-visuals",     // POST { discordId, action: 'list'|'set'|'reset'|'upload', key, label?, data?, mime? }
    guildWorks: "/guild-works",         // POST { userId, action: 'status'|'give', resource?, amount? } -> Grand Chantier de la semaine
    prestige: "/prestige",              // POST { userId, skill: 'fishing'|'dig'|'expedition'|'garden' }
    // Progression longue, quotidien, marche (2026-10-07)
    talents: "/talents",                // POST { userId, action: 'status'|'learn'|'reset', key? }
    mastery: "/mastery",                // POST { userId, action: 'status'|'claim', extensionId? }
    constellations: "/constellations",  // POST { userId, action: 'status'|'claim', key? }
    cardPrestige: "/card-prestige",     // POST { userId, pullIds: [a, b, c] }
    achievementTiers: "/achievement-tiers", // POST { userId, action: 'status'|'claim', key? }
    serverFeed: "/server-feed",         // GET ?since=
    dailyBox: "/daily-box",             // POST { userId, action: 'status'|'open' }
    dailyDice: "/daily-dice",           // POST { userId, action: 'status'|'roll' }
    welcomeBack: "/welcome-back",       // POST { userId, action: 'status'|'claim' }
    evening: "/evening",                // POST { userId, action: 'status'|'claim' }
    today: "/today",                    // GET ?userId= (action du jour, chance, boite, de, soir, retour)
    contracts: "/contracts",            // POST { userId, action: 'status'|'fulfill', key?, pullIds? }
    auctions: "/auctions",              // POST { userId, action: 'list'|'create'|'bid'|'cancel', ... }
    exchangeRates: "/exchange-rates",   // GET
    insurance: "/insurance",            // POST { userId, pullId, action: 'insure'|'remove' }
    boosterShop: "/booster-shop",       // POST { userId, action: 'status'|'buy' }
    shop: "/shop",                     // POST { userId, action: 'status'|'buy', key? } (objets et bonus)
    whatNow: "/what-now",               // GET ?userId=
    myStats: "/my-stats",               // GET ?userId=
    playerCard: "/player-card",         // GET ?pseudo=
    fishingTournament: "/fishing-tournament", // GET ?userId=
    uniqueCounter: "/unique-counter",   // POST { userId, action: 'status'|'redeem', cardId? } -> { tickets, cards, remaining }
    personalVault: "/personal-vault", // POST { userId, action: 'status'|'store'|'withdraw', pullId? } -> { unlocked, rows, boostersPerRow, dustPerRow, reward }
    vault: "/vault",                   // POST { userId, action: 'status'|'open' } -> { card, keysRequired, userKeys, alreadyOpened } | { opened, card, serialNumber, newKeyCount }
    // Fonctionnalites natives de l'API (api/src/native, 2026-10-04)
    setRewards: "/set-rewards",         // POST { userId, action: 'status'|'claim', extensionId? }
    setCompletions: "/set-completions", // GET ?pseudo=... -> { sets: [{ extensionId, name, claimedAt }] }
    tradeMatches: "/trade-matches",     // POST { userId, action: 'list' } -> { matches }
    loginStreak: "/login-streak",       // POST { userId, action: 'status'|'claim' }
    eventStatus: "/event-status",       // GET -> { active, label, dustMultiplier, finishMultiplier, endsAt }
    adminEvent: "/admin-event",         // POST { discordId, action: 'get'|'set', ... }
    bossLeaderboard: "/boss-leaderboard", // GET ?userId=... -> { boss, top, me, participants, rules }
    bossAttack: "/boss-attack",         // POST { userId, pullIds } -> attaque en salve sur des exemplaires precis
    adminEconomy: "/admin-economy",     // POST { discordId } -> tableau de bord de l'economie
    adminSimulate: "/admin-simulate",   // POST { discordId, action: 'config'|'run'|'pack', extensionId, boosters, modifiers } (aucune ecriture)
    pushConfig: "/push-config",         // GET -> { enabled, publicKey }
    chests: "/chests",                 // POST { userId, action: 'status'|'buy'|'open' } -> coffres (page d'ouverture)
    adminSettings: "/admin-settings",   // POST { discordId, action: 'get'|'set'|'reset', values?, key? } -> reglages du jeu
    season: "/season",                  // POST { userId, action: 'status'|'claim' } -> saison mensuelle
    adminSeason: "/admin-season",       // POST { discordId, action: 'get'|'setCard', season?, cardId? }
    fishing: "/fishing",                // POST { userId, action: 'status'|'cast', count? } -> jeu de peche
    aquarium: "/aquarium",              // POST { userId, action: 'status'|'claim' } -> especes et paliers de l'aquarium
    cat: "/cat",
    batchWrite: "/batch-write",         // POST { path, calls: [body...] } -> { results: [{ status, json }] } (decraft, autel, craft en lot)
    minerals: "/minerals",              // POST { userId, action: 'status'|'sell'|'trade', key?, count?, index? } -> comptoir des mineraux                        // POST { userId, action: 'status'|'feed', count? } -> Moka le chat
    // Lot 2026-10-09 : inflation, pity par rarete, course aux tresors, prestige, evenements planifies
    upgrades: "/upgrades",             // POST { userId, action: 'status'|'buy', key? } (chenil, serre, canne)
    finishReroll: "/finish-reroll",     // POST { userId, pullId, action: 'status'|'reroll' }
    adminModeFeatures: "/admin-mode-features", // POST { discordId, action: 'status'|'set'|'reset', matrix? }
    machineRoom: "/machine-room",
    cardHistory: "/card-history",            // GET ?cardId=&serial= (historique d'un exemplaire)
    cardPrice: "/card-price",                // GET ?cardId= (cote : ventes aux encheres)
    shareCard: "/share-card",                // POST { userId, cardId, image, ... } (partage Discord)
    adminModeSchedule: "/admin-mode-schedule", // POST { discordId, action: 'status'|'set'|'clear', preset?, at? }
    hardLeaderboard: "/hard-leaderboard",    // GET ?userId=
    seasonal: "/seasonal",                   // POST { userId, action: 'status'|'claim' }
    phantom: "/phantom",                     // GET ?userId=
    lottery: "/lottery",                     // POST { userId, action: 'status'|'buy', count? }
    wanted: "/wanted",                       // POST { userId, action: 'status'|'donate' }
    hallOfFame: "/hall-of-fame",             // GET
    teams: "/teams",                         // POST { userId }
    duoExpedition: "/duo-expedition",        // POST { userId, action, toPseudo?, pullId?, id? }       // POST { userId, action: 'status'|'advance'|'vote', mode? } (salle des machines)
    decraftUndo: "/decraft-undo",       // POST { userId, action: 'list'|'undo', id? } (mode Cool)
    weeklyGoal: "/weekly-goal",         // POST { userId, action: 'status'|'claim' } (mode Medium)
    // Regles par difficulte (2026-10-16, api/src/native/moderules.js, modefun.js, draft.js, chaosvote.js).
    adminModeRules: "/admin-mode-rules", // POST { discordId, action: 'status'|'set'|'mode'|'reset', key?, on?, mode? }
    modeRules: "/mode-rules",           // GET -> regles actives du mode en cours
    modeExtra: "/mode-extra",           // POST { userId, action, ... } -> fonctionnalites exclusives du mode
    draft: "/draft",                    // POST { userId, action: 'status'|'create'|'join'|'leave'|'start'|'pick', id?, index? }
    casino: "/casino",                   // POST { userId, game, action, ... } (casino de la salle interdite)
    archeo: "/archeo",                   // POST { userId, action: 'status'|'start'|'brush'|'finish', ops? } (tablettes anciennes)
    pets: "/pets",                       // POST { userId, action: 'status'|'cuddle'|'play'|'treat', pet: 'milo'|'moka'|'noisette'|'pistache' } (tendresse)
    walk: "/walk",                       // POST { userId, action: 'status'|'go', pet?, place? } (promenade, 2026-10-30)
    cook: "/cook",                       // POST { userId, action: 'status'|'cook', recipe? } (cuisine du village, 2026-10-30)
    skyTree: "/sky-tree",               // POST { userId, action: 'status'|'light'|'reset', key? } (arbre celeste)
    chaosVote: "/chaos-vote",           // POST { userId, action: 'status'|'vote', rule? }
    dogGift: "/dog-gift",               // POST { userId, action: 'status'|'claim' } -> trouvaille de Milo (le chien)
    sundayMarket: "/sunday-market",     // POST { userId, action: 'status'|'buy', cardId? }
    playerGift: "/player-gift",         // POST { userId, action: 'status'|'send'|'claim', toUserId?, kind? }
    weeklyRecap: "/weekly-recap",       // GET ?userId= -> recapitulatif de la semaine passee
    adminPreset: "/admin-preset",       // POST { discordId, action: 'status'|'apply', preset?, announce? } -> modes Chill / Medium / Hard
    adminEconomyLog: "/admin-economy-log", // POST { discordId, source?, userId?, boostersOnly? } -> journal detaille
    economyState: "/economy-state",     // GET -> { priceFactor, tight, avgWealth }
    rarityPity: "/rarity-pity",         // GET ?userId=&extensionId= -> { rarities: [{ name, left }] }
    treasureHunt: "/treasure-hunt",     // GET ?userId= | POST { userId, clue, page }
    accountPrestige: "/account-prestige", // GET ?userId= -> { stars, nextLevel }
    adminDiscord: "/admin-discord",       // POST { discordId, action: 'status'|'save'|'useLegacy'|'test'|'send', webhook?, templates?, message? } (annonces Discord)
    adminAudit: "/admin-audit",           // POST { discordId, action: 'list'|'undo', id?, limit? } (journal de l'equipe, annulation)
    adminExplorer: "/admin-explorer",     // POST { discordId, action: 'tables'|'rows'|'row'|'set'|'create'|'delete', table?, id?, q?, sort?, desc?, offset?, limit?, fields? } (Admin > Tout voir)
    adminPlayer: "/admin-player",         // POST { discordId, action: 'get'|'set'|'pull', targetUserId, fields?, tablets?, pullId?, changes?, remove? } (fiche joueur)
    adminRewards: "/admin-rewards",       // POST { discordId, action: 'catalog'|'codes'|'createCode'|'updateCode'|'redemptions'|'gift'|'preview', ... } (Codes & dons V2)
    adminCosmetics: "/admin-cosmetics",   // POST { discordId, action: 'list'|'save'|'delete'|'grant', item?, key?, userId? } (editeur de cosmetiques)
    adminEvents: "/admin-events",       // POST { discordId, action: 'list'|'save'|'delete', event?, id? }
    feedback: "/feedback",              // POST { userId?, kind: 'idea'|'bug'|'other', message, page?, mood?, context? } (avis -> GlitchTip, niveau Information)
    push: "/push"                       // POST { userId, action: 'status'|'subscribe'|'unsubscribe'|'test', subscription? }
  }
};

// Transitions de page natives (@view-transition, style.css) : quand une
// navigation est interrompue, Chrome rejette les promesses de la transition ;
// personne ne les ecoutait, d'ou des "unhandledrejection" (GlitchTip #6).
(function silenceViewTransitions() {
  var quiet = function (e) {
    var vt = e && e.viewTransition;
    if (!vt) return;
    ["ready", "finished", "updateCallbackDone"].forEach(function (k) { if (vt[k] && vt[k].catch) vt[k].catch(function () {}); });
  };
  window.addEventListener("pagereveal", quiet);
  window.addEventListener("pageswap", quiet);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    if (r && (r.name === "InvalidStateError" || r.name === "AbortError") && /transition/i.test(String(r.message))) e.preventDefault();
  });
})();

// Sens des transitions de page (2026-10-20, refonte.css) : vers une page plus
// a droite dans le menu, le contenu glisse vers la gauche ("forward"), et
// inversement ("back") ; retour arriere du navigateur = "back". Pose sur la
// page quittee (pageswap) et sur la page qui arrive (pagereveal).
(function viewTransitionDirection() {
  var ORDER = ["index.html", "ouverture.html", "collection.html", "jeux.html", "communaute.html", "trade.html", "artistes.html", "boutique.html", "progression.html", "coffre.html", "mode.html", "profile.html", "stats.html", "nouveautes.html"];
  var pos = function (url) {
    try { var p = new URL(url, location.href).pathname.split("/").pop() || "index.html"; return ORDER.indexOf(p); } catch (e) { return -1; }
  };
  var type = function (fromUrl, toUrl, navType) {
    var a = pos(fromUrl), b = pos(toUrl);
    if (navType === "traverse") return "back";
    if (a < 0 || b < 0 || a === b) return null;
    return b > a ? "forward" : "back";
  };
  window.addEventListener("pageswap", function (e) {
    if (!e.viewTransition || !e.activation || !e.activation.entry) return;
    var t = type(location.href, e.activation.entry.url, e.activation.navigationType);
    if (t) e.viewTransition.types.add(t);
  });
  window.addEventListener("pagereveal", function (e) {
    if (!e.viewTransition || !window.navigation || !navigation.activation || !navigation.activation.from) return;
    var t = type(navigation.activation.from.url, location.href, navigation.activation.navigationType);
    if (t) e.viewTransition.types.add(t);
  });
})();

// Remontee des erreurs (2026-10-29) : Monitor.capture(err, tags) pour celles
// que le code attrape lui-meme (toast d'erreur, repli silencieux...), qui
// n'arrivaient jamais dans GlitchTip. Avant le chargement du SDK, tout est mis
// en file (erreurs de chargement de la page comprises) puis envoye d'un coup.
var Monitor = {
  queue: [],
  seen: typeof WeakSet === "function" ? new WeakSet() : null,
  ready: false,
  capture: function (err, tags) {
    if (!err) return;
    if (typeof err === "object" && this.seen) { if (this.seen.has(err)) return; this.seen.add(err); }
    var e = err instanceof Error ? err : new Error(typeof err === "string" ? err : (err && err.message) || String(err));
    if (!this.ready) { if (this.queue.length < 30) this.queue.push([e, tags]); return; }
    this.send(e, tags);
  },
  send: function (e, tags) {
    window.Sentry.withScope(function (scope) {
      if (tags) Object.keys(tags).forEach(function (k) { if (tags[k] != null) scope.setTag(k, String(tags[k]).slice(0, 200)); });
      window.Sentry.captureException(e);
    });
  },
  // Erreur de code (TypeError, ReferenceError...) et non refus de l'API :
  // un bug a corriger, meme quand la page s'en remet.
  isBug: function (err) {
    return !!err && err instanceof Error && !err.code && /^(TypeError|ReferenceError|RangeError|SyntaxError|URIError|EvalError)$/.test(err.name) && !/Failed to fetch|NetworkError|Load failed|fetch/i.test(err.message);
  }
};
(function earlyErrors() {
  window.addEventListener("error", function (e) { if (!Monitor.ready && e.error) Monitor.capture(e.error, { phase: "avant-sdk" }); });
  window.addEventListener("unhandledrejection", function (e) { if (!Monitor.ready && e.reason instanceof Error) Monitor.capture(e.reason, { phase: "avant-sdk" }); });
  // console.error(err) du code (catch qui se contentent de journaliser).
  var orig = console.error;
  console.error = function () {
    for (var i = 0; i < arguments.length; i++) if (arguments[i] instanceof Error) { Monitor.capture(arguments[i], { via: "console.error" }); break; }
    return orig.apply(console, arguments);
  };
})();

// Suivi des erreurs (GlitchTip, compatible Sentry) : SDK navigateur officiel
// charge en asynchrone (ne bloque pas l'affichage), empreinte SRI verifiee.
// config.js est le premier script de chaque page : c'est le point le plus tot.
(function initErrorTracking() {
  var dsn = window.APP_CONFIG.glitchtipDsn;
  // Un DSN sans cle publique (https://<cle>@...) serait refuse par le SDK.
  if (!dsn || dsn.indexOf("@") === -1 || /^(localhost|127\.)/.test(window.location.hostname)) { Monitor.queue = []; Monitor.capture = function () {}; return; }
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
      environment: window.location.hostname,
      // Bruit sans consequence pour le joueur : transition de page annulee
      // (navigation interrompue), extensions du navigateur.
      ignoreErrors: [/Transition was aborted/i, /ViewTransition/i, /Transition was skipped/i, /ResizeObserver loop/i]
    });
    // Joueur connecte (memes cles que Session, core.js) : retrouver qui a
    // rencontre l'erreur.
    try {
      var userId = localStorage.getItem("2gatcha_userId");
      if (userId) window.Sentry.setUser({ id: userId, username: localStorage.getItem("2gatcha_pseudo") || undefined });
    } catch (e) { /* stockage bloque : erreurs anonymes */ }
    Monitor.ready = true;
    var q = Monitor.queue;
    Monitor.queue = [];
    q.forEach(function (x) { Monitor.send(x[0], x[1]); });
  };
  // SDK bloque (bloqueur de pub, reseau) : plus de file qui grossit.
  s.onerror = function () { Monitor.queue = []; Monitor.capture = function () {}; };
  document.head.appendChild(s);
})();
