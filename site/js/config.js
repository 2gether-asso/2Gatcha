// Configuration du site - a adapter avec l'URL de ton instance n8n et ton
// application Discord (voir n8n/README.md, section "Discord").
window.APP_CONFIG = {
  n8nBaseUrl: "https://n8n.matiboux.com/webhook/",

  // A adapter : Client ID de ton application Discord (visible dans le
  // Developer Portal, il n'est pas secret). L'URI de redirection ci-dessous
  // doit correspondre EXACTEMENT a celle enregistree sur l'application.
  discordClientId: "1551531676335870104",
  discordRedirectUri: window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "auth-callback.html",
  discordScope: "identify guilds",

  // A adapter : memes ID Discord que la liste `adminDiscordIds` codee en dur
  // dans n8n/workflows/admin-codes.json. Ne sert ici qu'a afficher (ou pas)
  // le lien "Admin" dans le menu ; la verification qui compte est cote n8n.
  adminDiscordIds: ["785223211730075709", "184008667690041345"],

  endpoints: {
    discordLogin: "/discord-login",   // POST { code } -> { userId, pseudo, discordUsername, discordAvatar }
    updatePseudo: "/update-pseudo",   // POST { userId, pseudo } -> { userId, pseudo }
    users: "/users",                  // GET -> { users: [{ userId, pseudo }] }
    cards: "/cards",                  // GET -> liste du catalogue complet
    extensions: "/extensions",        // GET -> { extensions: [{ id, name, key, active, packImageId, cardBackImageId }] }
    openPack: "/open-pack",           // POST { userId, extensionId } -> ouvre 1 booster (5 cartes) de cette extension
    collection: "/collection",        // GET ?userId=... -> collection de l'utilisateur
    image: "/image",                  // GET ?id=... -> proxy binaire vers une piece jointe Grist
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
    wishlist: "/wishlist"             // POST { userId, action: 'add'|'remove'|'list', cardId? } -> { wishlist }
  }
};
