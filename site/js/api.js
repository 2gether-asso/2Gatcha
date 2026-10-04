// Petite couche d'accès a l'API 2Gatcha (memes adresses que les anciens webhooks n8n). Toutes les reponses sont du JSON.
const API = {
  base() {
    return window.APP_CONFIG.n8nBaseUrl.replace(/\/$/, "");
  },

  url(name, query) {
    const path = window.APP_CONFIG.endpoints[name];
    const qs = query ? "?" + new URLSearchParams(query).toString() : "";
    return this.base() + path + qs;
  },

  // n8n injoignable (2026-10-02) : un vrai echec reseau ("Failed to fetch",
  // pas une erreur HTTP renvoyee par un workflow) declenche une verification
  // rapide ; si le serveur ne repond toujours pas, le joueur bascule sur la
  // page de maintenance, qui le ramene automatiquement des que n8n revient -
  // plutot qu'une page a moitie cassee couverte de toasts d'erreur.
  _offlineCheck: null,
  async _fetch(url, opts) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      if (e instanceof TypeError) this._handleOffline();
      throw e;
    }
  },
  _handleOffline() {
    if (location.pathname.endsWith("maintenance.html") || document.body.hasAttribute("data-no-maintenance") || this._offlineCheck) return;
    this._offlineCheck = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        await fetch(this.url("siteBanner", { _ts: Date.now() }), { cache: "no-store", signal: ctrl.signal });
        return; // le serveur repond : simple echec ponctuel, on reste ici
      } catch (e) {
        try { sessionStorage.setItem("2gatcha_offline_return", location.pathname.split("/").pop() + location.search); } catch (_) {}
        location.replace("maintenance.html?offline=1");
      } finally {
        clearTimeout(timer);
        this._offlineCheck = null;
      }
    })();
  },

  async post(name, body) {
    if (typeof TopLoadingBar !== "undefined") TopLoadingBar.start();
    try {
      const res = await this._fetch(this.url(name), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || `Erreur API (${name}): ${res.status}`);
        err.code = data.error;
        throw err;
      }
      return data;
    } finally {
      if (typeof TopLoadingBar !== "undefined") TopLoadingBar.stop();
    }
  },

  async get(name, query) {
    // "_ts" force une URL differente a chaque appel : evite qu'un cache
    // (navigateur ou CDN devant n8n) ne reserve indefiniment une vieille
    // reponse pour des endpoints dont la valeur change (stock de boosters...).
    if (typeof TopLoadingBar !== "undefined") TopLoadingBar.start();
    try {
      const bustedQuery = { ...(query || {}), _ts: Date.now() };
      const res = await this._fetch(this.url(name, bustedQuery), { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || `Erreur API (${name}): ${res.status}`);
        err.code = data.error;
        throw err;
      }
      return data;
    } finally {
      if (typeof TopLoadingBar !== "undefined") TopLoadingBar.stop();
    }
  },

  // Petit cache navigateur (sessionStorage, par onglet) pour les donnees qui
  // changent rarement (catalogue de cartes, liste des joueurs) : evite de
  // refaire l'aller-retour Grist a chaque changement de page.
  _cacheGet(key, ttlMs) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) || "null");
      if (cached && Date.now() - cached.ts < ttlMs) return cached.data;
    } catch (e) {}
    return null;
  },

  _cacheSet(key, data) {
    try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
  },

  discordLoginUrl() {
    const params = new URLSearchParams({
      client_id: window.APP_CONFIG.discordClientId,
      redirect_uri: window.APP_CONFIG.discordRedirectUri,
      response_type: "code",
      scope: window.APP_CONFIG.discordScope
    });
    return "https://discord.com/api/oauth2/authorize?" + params.toString();
  },

  discordLogin(code) {
    return this.post("discordLogin", { code });
  },

  updatePseudo(userId, pseudo) {
    return this.post("updatePseudo", { userId, pseudo });
  },

  async listUsers() {
    const cached = this._cacheGet("2gatcha_cache_users", 60 * 1000);
    if (cached) return cached;
    const data = await this.get("users");
    this._cacheSet("2gatcha_cache_users", data);
    return data;
  },

  async getCards() {
    const cached = this._cacheGet("2gatcha_cache_cards", 5 * 60 * 1000);
    if (cached) return cached;
    const data = await this.get("cards");
    this._cacheSet("2gatcha_cache_cards", data);
    return data;
  },

  async getExtensions() {
    const cached = this._cacheGet("2gatcha_cache_extensions", 5 * 60 * 1000);
    if (cached) return cached;
    const data = await this.get("extensions");
    this._cacheSet("2gatcha_cache_extensions", data);
    return data;
  },

  openPack(userId, extensionId) {
    return this.post("openPack", { userId, extensionId });
  },

  // Annonce Discord automatique (Mythique/Legendaire/Epique) - appelee par
  // le front une fois le reveal termine, jamais par le backend au tirage
  // (voir opening.js onAllRevealed).
  notifyReveal(userId, batchIds) {
    return this.post("notifyReveal", { userId, batchIds, action: "auto" });
  },

  // pullId (optionnel) : exemplaire precis a decrafter.
  disenchantCard(userId, cardId, finish, quality, pullId) {
    return this.post("disenchant", { userId, cardId, finish, quality, pullId });
  },

  craftCard(userId, cardId) {
    return this.post("craft", { userId, cardId });
  },

  getCollection(userId) {
    return this.get("collection", { userId });
  },

  imageUrl(imageId) {
    if (!imageId) return null;
    return this.url("image", { id: imageId });
  },

  getBoosterStatus(userId) {
    return this.get("boosterStatus", { userId });
  },

  redeemCode(userId, code) {
    return this.post("redeemCode", { userId, code });
  },

  adminCreateCode(discordId, params) {
    return this.post("adminCodes", { discordId, action: "create", ...params });
  },

  adminListCodes(discordId) {
    return this.post("adminCodes", { discordId, action: "list" });
  },

  adminRevokeCode(discordId, code) {
    return this.post("adminCodes", { discordId, action: "revoke", code });
  },

  adminGetStats(discordId) {
    return this.post("adminCodes", { discordId, action: "stats" });
  },

  adminResetV1(discordId, confirm, targetPseudo) {
    return this.post("adminReset", { discordId, confirm, targetPseudo });
  },

  getSiteBanner() {
    return this.get("siteBanner");
  },

  getUnlockConfig() {
    return this.get("unlockConfig");
  },

  getDailyWheelStatus(userId) {
    return this.post("dailyWheel", { userId, action: "status" });
  },

  spinDailyWheel(userId, useKey) {
    return this.post("dailyWheel", { userId, action: "spin", useKey: !!useKey });
  },

  // pullIds : les 3 exemplaires EXACTS poses dans les slots de l'autel.
  altarSacrifice(userId, pullIds) {
    return this.post("altarSacrifice", { userId, pullIds });
  },

  getAchievements(userId) {
    return this.get("achievements", { userId });
  },

  getPullLog(userId) {
    return this.get("pullLog", { userId });
  },

  createTrade(userId, toPseudo, offeredCardId, offeredPullId, requestedCardId) {
    return this.post("trade", { userId, action: "create", toPseudo, offeredCardId, offeredPullId, requestedCardId });
  },

  counterTrade(userId, originalTradeId, offeredCardId, offeredPullId, requestedCardId) {
    return this.post("trade", { userId, action: "counter", originalTradeId, offeredCardId, offeredPullId, requestedCardId });
  },

  listTrades(userId) {
    return this.post("trade", { userId, action: "list" });
  },

  respondTrade(userId, tradeId, accept, requestedPullId) {
    return this.post("trade", { userId, action: "respond", tradeId, accept, requestedPullId });
  },

  cancelTrade(userId, tradeId) {
    return this.post("trade", { userId, action: "cancel", tradeId });
  },

  adminGetConfig(discordId) {
    return this.post("adminConfig", { discordId, action: "get" });
  },

  adminSetConfig(discordId, params) {
    return this.post("adminConfig", { discordId, action: "set", ...params });
  },

  adminUpdateRarity(discordId, rarityId, params) {
    return this.post("adminConfig", { discordId, action: "updateRarity", rarityId, ...params });
  },

  adminUpdateFinish(discordId, finishId, params) {
    return this.post("adminConfig", { discordId, action: "updateFinish", finishId, ...params });
  },

  adminUpdateQuality(discordId, qualityId, params) {
    return this.post("adminConfig", { discordId, action: "updateQuality", qualityId, ...params });
  },

  adminCreateExtension(discordId, params) {
    return this.post("adminExtensions", { discordId, action: "create", ...params });
  },

  adminUpdateExtension(discordId, params) {
    return this.post("adminExtensions", { discordId, action: "update", ...params });
  },

  getLeaderboard() {
    return this.get("leaderboard");
  },

  getRecentPulls() {
    return this.get("recentPulls");
  },

  getPublicProfile(pseudo) {
    return this.get("publicProfile", { pseudo });
  },

  listWishlist(userId) {
    return this.post("wishlist", { userId, action: "list" });
  },

  addToWishlist(userId, cardId) {
    return this.post("wishlist", { userId, action: "add", cardId });
  },

  removeFromWishlist(userId, cardId) {
    return this.post("wishlist", { userId, action: "remove", cardId });
  },

  listShowcase(userId) {
    return this.post("showcase", { userId, action: "list" });
  },

  addToShowcase(userId, cardId) {
    return this.post("showcase", { userId, action: "add", cardId });
  },

  removeFromShowcase(userId, cardId) {
    return this.post("showcase", { userId, action: "remove", cardId });
  },

  // selection (optionnelle) : { pullIds, keepPullId } - voir FusionPicker.
  foilUpgrade(userId, cardId, fromFinish, selection) {
    return this.post("foilUpgrade", { userId, cardId, fromFinish, ...(selection || {}) });
  },

  repairCardQuality(userId, cardId, fromQuality, selection) {
    return this.post("cardQualityRepair", { userId, cardId, fromQuality, ...(selection || {}) });
  },

  unlockSecret(userId) {
    return this.post("unlockSecret", { userId });
  },

  getQuestStatus(userId) {
    return this.post("quests", { userId, action: "status" });
  },
  claimQuestReward(userId) {
    return this.post("quests", { userId, action: "claim" });
  },

  getWeeklyQuestStatus(userId) {
    return this.post("weeklyQuests", { userId, action: "status" });
  },
  claimWeeklyQuestReward(userId) {
    return this.post("weeklyQuests", { userId, action: "claim" });
  },

  listBadges(userId) {
    return this.post("badges", { userId, action: "list" });
  },
  buyBadge(userId, badgeKey) {
    return this.post("badges", { userId, action: "buy", badgeKey });
  },
  selectBadge(userId, badgeKey) {
    return this.post("badges", { userId, action: "select", badgeKey });
  },

  getEventCalendar() {
    return this.get("eventCalendar");
  },

  getBossStatus(userId) {
    return this.post("communityBoss", { userId, action: "status" });
  },
  attackBoss(userId, cardId) {
    return this.post("communityBoss", { userId, action: "attack", cardId });
  },

  getGuildChestStatus(userId) {
    return this.post("guildChest", { userId, action: "status" });
  },
  depositGuildChest(userId, cardId, finish, quality) {
    return this.post("guildChest", { userId, action: "deposit", cardId, finish, quality });
  },
  // depositId + useKey : pioche AU CHOIX contre 1 clef secrete.
  drawGuildChest(userId, depositId) {
    return this.post("guildChest", depositId != null ? { userId, action: "draw", useKey: true, depositId } : { userId, action: "draw" });
  },

  listBlackMarket(userId) {
    return this.post("blackMarket", { userId, action: "list" });
  },
  buyBlackMarket(userId, offerId) {
    return this.post("blackMarket", { userId, action: "buy", offerId });
  },

  getDigStatus(userId) {
    return this.post("dig", { userId, action: "status" });
  },
  guessCard(userId, action, cardId) {
    return this.post("guessCard", { userId, action, cardId });
  },
  expedition(userId, action, extra) {
    return this.post("expedition", { userId, action, ...(extra || {}) });
  },
  dig(userId, tileIndex) {
    return this.post("dig", { userId, action: "dig", tileIndex });
  },
  // Chenil (2026-10-02) : acheter un os contre des poussieres / lancer le chien.
  buyBone(userId) {
    return this.post("dig", { userId, action: "buyBone" });
  },
  useBone(userId) {
    return this.post("dig", { userId, action: "useBone" });
  },

  getBingoStatus(userId) {
    return this.post("bingo", { userId, action: "status" });
  },
  claimBingo(userId) {
    return this.post("bingo", { userId, action: "claim" });
  },

  adminCreateBoss(discordId, params) {
    return this.post("communityBoss", { discordId, action: "adminCreate", ...params });
  },
  adminCreateMarketOffer(discordId, params) {
    return this.post("blackMarket", { discordId, action: "adminCreate", ...params });
  },
  adminSetBingoGrid(discordId, params) {
    return this.post("bingo", { discordId, action: "adminSetGrid", ...params });
  },
  adminGift(discordId, params) {
    return this.post("adminGift", { discordId, ...params });
  },

  getLevelRewardsStatus(userId) {
    return this.post("levelRewards", { userId, action: "status" });
  },
  claimLevelRewards(userId) {
    return this.post("levelRewards", { userId, action: "claim" });
  },
  adminListLevelRewards(discordId) {
    return this.post("levelRewards", { discordId, action: "adminList" });
  },
  adminSetLevelRewards(discordId, rows) {
    return this.post("levelRewards", { discordId, action: "adminSet", rows });
  },

  personalVault(userId, action, pullId) {
    return this.post("personalVault", { userId, action, pullId });
  },
  getVaultStatus(userId) {
    return this.post("vault", { userId, action: "status" });
  },
  openVault(userId) {
    return this.post("vault", { userId, action: "open" });
  }
};
