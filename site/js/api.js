// Petite couche d'acces a l'API n8n. Tous les webhooks n8n retournent du JSON.
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
  },

  async get(name, query) {
    // "_ts" force une URL differente a chaque appel : evite qu'un cache
    // (navigateur ou CDN devant n8n) ne reserve indefiniment une vieille
    // reponse pour des endpoints dont la valeur change (stock de boosters...).
    const bustedQuery = { ...(query || {}), _ts: Date.now() };
    const res = await fetch(this.url(name, bustedQuery), { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Erreur API (${name}): ${res.status}`);
      err.code = data.error;
      throw err;
    }
    return data;
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

  listUsers() {
    return this.get("users");
  },

  getCards() {
    return this.get("cards");
  },

  openPack(userId) {
    return this.post("openPack", { userId });
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
  }
};
