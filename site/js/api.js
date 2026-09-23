// Petite couche d'accès a l'API n8n. Tous les webhooks n8n retournent du JSON.
const API = {
  base() {
    return window.APP_CONFIG.n8nBaseUrl.replace(/\/$/, "");
  },

  url(name, query) {
    const path = window.APP_CONFIG.endpoints[name];
    const qs = query ? "?" + new URLSearchParams(query).toString() : "";
    return this.base() + path + qs;
  },

  async post(name, body) {
    if (typeof TopLoadingBar !== "undefined") TopLoadingBar.start();
    try {
      const res = await fetch(this.url(name), {
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
      const res = await fetch(this.url(name, bustedQuery), { cache: "no-store" });
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

  disenchantCard(userId, cardId) {
    return this.post("disenchant", { userId, cardId });
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

  adminResetV1(discordId, confirm) {
    return this.post("adminReset", { discordId, confirm });
  },

  getDailyWheelStatus(userId) {
    return this.post("dailyWheel", { userId, action: "status" });
  },

  spinDailyWheel(userId) {
    return this.post("dailyWheel", { userId, action: "spin" });
  },

  altarSacrifice(userId, rarityKey) {
    return this.post("altarSacrifice", { userId, rarityKey });
  },

  getAchievements(userId) {
    return this.get("achievements", { userId });
  },

  createTrade(userId, toPseudo, offeredCardId, requestedCardId) {
    return this.post("trade", { userId, action: "create", toPseudo, offeredCardId, requestedCardId });
  },

  listTrades(userId) {
    return this.post("trade", { userId, action: "list" });
  },

  respondTrade(userId, tradeId, accept) {
    return this.post("trade", { userId, action: "respond", tradeId, accept });
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

  getQuestStatus(userId) {
    return this.post("quests", { userId });
  }
};
