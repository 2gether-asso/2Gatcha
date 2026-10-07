// Petite couche d'acces a l'API 2Gatcha (routes /webhook/<chemin>). Toutes les reponses sont du JSON.
const API = {
  base() {
    return window.APP_CONFIG.apiBaseUrl.replace(/\/$/, "");
  },

  url(name, query) {
    const path = window.APP_CONFIG.endpoints[name];
    const qs = query ? "?" + new URLSearchParams(query).toString() : "";
    return this.base() + path + qs;
  },

  // API injoignable (2026-10-02) : un vrai echec reseau ("Failed to fetch",
  // pas une erreur HTTP renvoyee par un workflow) declenche une verification
  // rapide ; si le serveur ne repond toujours pas, le joueur bascule sur la
  // page de maintenance, qui le ramene automatiquement des que l'API revient -
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

  // --- lectures partagees (refonte 2026-10-04) ----------------------------
  // Une meme LECTURE (GET, ou POST dont l'action est status/list/get) lancee
  // plusieurs fois en meme temps par differents bouts de la page (en-tete,
  // pastilles du menu, page elle-meme) ne part qu'une fois, et son resultat
  // reste valable quelques secondes. Toute ECRITURE vide ce cache : on ne
  // relit jamais un solde perime apres une action.
  READ_ACTIONS: ["status", "list", "get"],
  MEMO_MS: 5000,
  _memo: new Map(),
  _stable(v) {
    if (Array.isArray(v)) return "[" + v.map((x) => this._stable(x)).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + this._stable(v[k])).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  },
  _readKey(method, name, payload) {
    return method + " " + name + " " + this._stable(payload || {});
  },
  _isRead(method, body) {
    return method === "GET" || this.READ_ACTIONS.includes(body && body.action);
  },
  _shared(key, fn) {
    const hit = this._memo.get(key);
    if (hit && (hit.pending || Date.now() - hit.ts < this.MEMO_MS)) return hit.promise;
    const entry = { pending: true, ts: Date.now(), promise: null };
    entry.promise = fn().then((data) => {
      entry.pending = false;
      entry.ts = Date.now();
      return data;
    }, (err) => {
      if (this._memo.get(key) === entry) this._memo.delete(key);
      throw err;
    });
    this._memo.set(key, entry);
    return entry.promise;
  },
  // names (optionnel) : n'oublie que les lectures de ces endpoints.
  invalidate(names) {
    if (!names) { this._memo.clear(); return; }
    for (const key of [...this._memo.keys()]) {
      if (names.includes(key.split(" ")[1])) this._memo.delete(key);
    }
  },

  // Plusieurs lectures en UNE requete HTTP (route /webhook/batch de l'API).
  // calls : [{ name, query } | { name, body }]. Chaque resultat alimente le
  // cache ci-dessus : les appels individuels identiques faits ensuite par la
  // page repondent instantanement. Ancienne API sans /batch : appels
  // individuels, en parallele.
  _batchSupported: true,
  async batch(calls) {
    const list = calls.map((c) => {
      const method = c.body ? "POST" : "GET";
      return { ...c, method, key: this._readKey(method, c.name, method === "GET" ? c.query : c.body) };
    });
    const individual = (c) => (c.method === "GET" ? this.get(c.name, c.query) : this.post(c.name, c.body));
    const todo = list.filter((c) => {
      const hit = this._memo.get(c.key);
      return !(hit && (hit.pending || Date.now() - hit.ts < this.MEMO_MS));
    });
    if (todo.length && this._batchSupported) {
      // Entrees "en cours" posees tout de suite : un appel individuel lance
      // pendant le batch attend son resultat au lieu de repartir.
      const resolvers = new Map();
      todo.forEach((c) => {
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        promise.catch(() => {});
        const entry = { pending: true, ts: Date.now(), promise };
        this._memo.set(c.key, entry);
        resolvers.set(c.key, { entry, resolve, reject });
      });
      try {
        const res = await this._fetch(this.base() + "/batch", {
          method: "POST",
          headers: this._headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ calls: todo.map((c) => ({ path: window.APP_CONFIG.endpoints[c.name].replace(/^\//, ""), method: c.method, query: c.query, body: c.body })) })
        });
        if (res.status === 404) throw Object.assign(new Error("batch_unsupported"), { unsupported: true });
        if (res.status === 429) { this._onRejected(res, await res.json().catch(() => ({}))); }
        if (!res.ok) throw new Error("batch_failed");
        const { results } = await res.json();
        todo.forEach((c, i) => {
          const r = results[i] || { status: 500, json: {} };
          const { entry, resolve, reject } = resolvers.get(c.key);
          entry.pending = false;
          entry.ts = Date.now();
          if (r.status >= 200 && r.status < 300) resolve(r.json);
          else {
            if (r.status === 401) this._onRejected({ status: 401 }, r.json || {});
            const err = new Error((r.json && r.json.error) || `Erreur API (${c.name}): ${r.status}`);
            err.code = r.json && r.json.error;
            this._memo.delete(c.key);
            reject(err);
          }
        });
      } catch (e) {
        if (e.unsupported) this._batchSupported = false;
        // Repli : chaque lecture repart en individuel.
        todo.forEach((c) => {
          const { resolve, reject } = resolvers.get(c.key);
          this._memo.delete(c.key);
          individual(c).then(resolve, reject);
        });
      }
    }
    return Promise.all(list.map((c) => individual(c).catch(() => null)));
  },

  async post(name, body) {
    if (this._isRead("POST", body)) return this._shared(this._readKey("POST", name, body), () => this._post(name, body));
    this.invalidate();
    try {
      const data = await this._post(name, body);
      // Bonus d'un week-end evenement (api/src/native/events.js) : annonce.
      if (data && data.eventBonus && typeof Toast !== "undefined") {
        const b = data.eventBonus;
        if (b.dust) Toast.success(`&#127881; ${b.label} : +${b.dust} poussières bonus !`);
        else if (b.finishes) Toast.success(`&#127881; ${b.label} : ${b.finishes} finition${b.finishes > 1 ? "s" : ""} améliorée${b.finishes > 1 ? "s" : ""} !`);
      }
      return data;
    } finally {
      // Une ecriture peut avoir change n'importe quelle lecture faite pendant
      // qu'elle tournait.
      this.invalidate();
    }
  },

  // En-tetes communs : jeton signe du joueur connecte (voir api/src/native/auth.js).
  _headers(extra) {
    const h = { ...(extra || {}) };
    const token = typeof Session !== "undefined" ? Session.token : null;
    if (token) h.Authorization = "Bearer " + token;
    return h;
  },

  // Reponse refusee : session invalide (on deconnecte et on propose de se
  // reconnecter) ou trop de requetes (message, une fois par minute).
  _onRejected(res, data) {
    if (res.status === 401 && typeof Session !== "undefined" && Session.isLoggedIn()) {
      Session.clear();
      if (!/index\.html$|\/$/.test(location.pathname) || !location.search.includes("relogin")) location.replace("index.html?relogin=1");
    } else if (res.status === 429 && typeof Toast !== "undefined" && Date.now() - (this._lastRateToast || 0) > 60000) {
      this._lastRateToast = Date.now();
      Toast.error(`Doucement ! Trop d'actions d'affilée : réessaie dans ${data.retryAfter || 60} s.`);
    }
  },

  async _post(name, body) {
    if (typeof TopLoadingBar !== "undefined") TopLoadingBar.start();
    try {
      const res = await this._fetch(this.url(name), {
        method: "POST",
        headers: this._headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this._onRejected(res, data);
        const err = new Error(data.error || `Erreur API (${name}): ${res.status}`);
        err.code = data.error;
        err.data = data;
        // "Deja recupere" (bouton reste affiche apres une recuperation
        // ailleurs, double clic...) : pas une vraie erreur pour le joueur.
        if (this.BENIGN_ERRORS[data.error]) this._lastBenign = { code: data.error, at: Date.now() };
        throw err;
      }
      this._announce(data);
      // Une recuperation a eu lieu : les pages peuvent rafraichir leurs boutons.
      if (body && /claim|redeem/.test(String(body.action || ""))) window.dispatchEvent(new CustomEvent("api:claimed", { detail: { name, body } }));
      return data;
    } finally {
      if (typeof TopLoadingBar !== "undefined") TopLoadingBar.stop();
    }
  },

  BENIGN_ERRORS: { nothing_to_claim: "Rien à récupérer : c'est déjà fait.", already_claimed: "Déjà récupéré.", already_rerolled: "Déjà fait aujourd'hui.", goal_not_reached: "L'objectif n'est pas encore atteint." },

  // Annonces renvoyees par l'API apres une action (defi accompli, succes
  // secret, objectif commun atteint...) : un toast chacune.
  _announce(data) {
    if (!data || typeof Toast === "undefined") return;
    // Bonus personnels appliques apres coup (heure de chance, de, talents...).
    if (Array.isArray(data.bonuses) && data.bonuses.length) {
      const pos = data.bonuses.filter((b) => b.dust > 0);
      const neg = data.bonuses.filter((b) => b.dust < 0);
      if (pos.length) Toast.success(`&#10024; Bonus : ${pos.map((b) => `${b.label} +${b.dust}`).join(" · ")}`);
      if (neg.length) Toast.info(`${neg.map((b) => `${b.label} ${b.dust}`).join(" · ")} &#10024;`);
    }
    if (data.repairSurcharge) Toast.info(`&#129520; Restauration répétée cette semaine : +${data.repairSurcharge} poussières.`);
    if (!Array.isArray(data.notices)) return;
    data.notices.forEach((n, i) => setTimeout(() => {
      Toast.success(`${n.icon || "&#11088;"} ${n.label}`);
      if (n.kind === "achievement" && typeof confetti === "function") confetti({ particleCount: 70, spread: 80, origin: { y: 0.3 } });
    }, 400 + i * 900));
    if (typeof loadNavBadges === "function") setTimeout(() => loadNavBadges(), 600);
  },

  get(name, query) {
    return this._shared(this._readKey("GET", name, query), () => this._get(name, query));
  },

  async _get(name, query) {
    // "_ts" force une URL differente a chaque appel : evite qu'un cache
    // (navigateur ou CDN devant l'API) ne reserve indefiniment une vieille
    // reponse pour des endpoints dont la valeur change (stock de boosters...).
    if (typeof TopLoadingBar !== "undefined") TopLoadingBar.start();
    try {
      const bustedQuery = { ...(query || {}), _ts: Date.now() };
      const res = await this._fetch(this.url(name, bustedQuery), { cache: "no-store", headers: this._headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this._onRejected(res, data);
        const err = new Error(data.error || `Erreur API (${name}): ${res.status}`);
        err.code = data.error;
        err.data = data;
        throw err;
      }
      return data;
    } finally {
      if (typeof TopLoadingBar !== "undefined") TopLoadingBar.stop();
    }
  },

  // Petit cache navigateur (sessionStorage, par onglet) pour les donnees qui
  // changent rarement (catalogue de cartes, liste des joueurs) : evite de
  // refaire l'aller-retour a chaque changement de page.
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

  challenges(userId, action = "status", extra = {}) {
    return this.post("challenges", { userId, action, ...extra });
  },
  communityGoal(userId, action = "status") {
    return this.post("communityGoal", { userId, action });
  },
  themes(userId, action = "status", key) {
    return this.post("themes", { userId, action, key });
  },
  getHiddenAchievements(userId) {
    return this.get("hiddenAchievements", { userId });
  },
  cosmetics(userId, action = "status", extra = {}) {
    return this.post("cosmetics", { userId, action, ...extra });
  },
  reroll(userId, kind, current) {
    return this.post("reroll", { userId, kind, current });
  },
  getEconomyRules(userId) {
    return this.get("economyRules", { userId });
  },
  getCardInfo(cardId, userId) {
    return this.get("cardInfo", userId ? { cardId, userId } : { cardId });
  },
  wishlistAlerts(userId) {
    return this.post("wishlistAlerts", { userId, action: "status" });
  },
  getProfileWall(profileId) {
    return this.get("profileWall", { profileId });
  },
  postProfileWall(userId, profileId, text) {
    return this.post("profileWall", { userId, action: "post", profileId, text });
  },
  deleteProfileWall(userId, messageId) {
    return this.post("profileWall", { userId, action: "delete", messageId });
  },
  garden(userId, action = "status", extra = {}) {
    return this.post("garden", { userId, action, ...extra });
  },
  communityDig(userId, action = "status", tile) {
    return this.post("communityDig", { userId, action, tile });
  },
  prestige(userId, skill) {
    return this.post("prestige", { userId, skill });
  },
  // --- Progression longue, quotidien, marche (2026-10-07) -----------------
  talents(userId, action = "status", key) { return this.post("talents", { userId, action, key }); },
  mastery(userId, action = "status", extensionId) { return this.post("mastery", { userId, action, extensionId }); },
  constellations(userId, action = "status", key) { return this.post("constellations", { userId, action, key }); },
  cardPrestige(userId, pullIds) { return this.post("cardPrestige", { userId, pullIds }); },
  achievementTiers(userId, action = "status", key) { return this.post("achievementTiers", { userId, action, key }); },
  getServerFeed(since = 0) { return this.get("serverFeed", { since }); },
  dailyBox(userId, action = "status") { return this.post("dailyBox", { userId, action }); },
  dailyDice(userId, action = "status") { return this.post("dailyDice", { userId, action }); },
  welcomeBack(userId, action = "status") { return this.post("welcomeBack", { userId, action }); },
  evening(userId, action = "status") { return this.post("evening", { userId, action }); },
  getToday(userId) { return this.get("today", { userId }); },
  contracts(userId, action = "status", params = {}) { return this.post("contracts", { userId, action, ...params }); },
  auctions(userId, action = "list", params = {}) { return this.post("auctions", { userId, action, ...params }); },
  getExchangeRates() { return this.get("exchangeRates"); },
  insurance(userId, pullId, action) { return this.post("insurance", { userId, pullId, action }); },
  boosterShop(userId, action = "status") { return this.post("boosterShop", { userId, action }); },
  shop(userId, action = "status", key) { return this.post("shop", { userId, action, key }); },
  getWhatNow(userId) { return this.get("whatNow", { userId }); },
  getMyStats(userId) { return this.get("myStats", { userId }); },
  getPlayerCard(pseudo) { return this.get("playerCard", { pseudo }); },
  buyStreakFreeze(userId) { return this.post("loginStreak", { userId, action: "buyFreeze" }); },
  setPushPrefs(userId, prefs) { return this.post("push", { userId, action: "prefs", prefs }); },

  getFishingTournament(userId) {
    return this.get("fishingTournament", userId ? { userId } : {});
  },
  getSkillsLeaderboard() {
    return this.get("skillsLeaderboard");
  },
  uniqueCounter(userId, action, cardId) {
    return this.post("uniqueCounter", { userId, action, cardId });
  },
  personalVault(userId, action, pullId) {
    return this.post("personalVault", { userId, action, pullId });
  },
  getVaultStatus(userId) {
    return this.post("vault", { userId, action: "status" });
  },
  openVault(userId) {
    return this.post("vault", { userId, action: "open" });
  },

  // --- fonctionnalites natives (2026-10-04) ---
  getSetRewards(userId) {
    return this.post("setRewards", { userId, action: "status" });
  },
  claimSetReward(userId, extensionId) {
    return this.post("setRewards", { userId, action: "claim", extensionId });
  },
  getSetCompletions(pseudo) {
    return this.get("setCompletions", { pseudo });
  },
  getTradeMatches(userId) {
    return this.post("tradeMatches", { userId, action: "list" });
  },
  getLoginStreak(userId) {
    return this.post("loginStreak", { userId, action: "status" });
  },
  claimLoginStreak(userId) {
    return this.post("loginStreak", { userId, action: "claim" });
  },
  getEventStatus() {
    return this.get("eventStatus");
  },
  adminGetEvent(discordId) {
    return this.post("adminEvent", { discordId, action: "get" });
  },
  adminSetEvent(discordId, params) {
    return this.post("adminEvent", { discordId, action: "set", ...params });
  },
  bossAttack(userId, pullIds) {
    return this.post("bossAttack", { userId, pullIds });
  },
  getBossLeaderboard(userId) {
    return this.get("bossLeaderboard", { userId });
  },
  adminGetEconomy(discordId) {
    return this.post("adminEconomy", { discordId, action: "get" });
  },
  // Simulateur d'ouverture (admins) : pur calcul, rien n'est ajoute ni consomme.
  adminSimulate(discordId, action, params = {}) {
    return this.post("adminSimulate", { discordId, action, ...params });
  },
  getPushConfig() {
    return this.get("pushConfig");
  },
  adminGetSettings(discordId) {
    return this.post("adminSettings", { discordId, action: "get" });
  },
  adminSetSettings(discordId, values) {
    return this.post("adminSettings", { discordId, action: "set", values });
  },
  adminResetSetting(discordId, key) {
    return this.post("adminSettings", { discordId, action: "reset", key });
  },
  getSeason(userId) {
    return this.post("season", { userId, action: "status" });
  },
  claimSeason(userId) {
    return this.post("season", { userId, action: "claim" });
  },
  adminGetSeason(discordId) {
    return this.post("adminSeason", { discordId, action: "get" });
  },
  adminSetSeasonCard(discordId, season, cardId) {
    return this.post("adminSeason", { discordId, action: "setCard", season, cardId });
  },
  fishing(userId, action, count, bait) {
    return this.post("fishing", { userId, action, count, bait: !!bait });
  },
  chests(userId, action) {
    return this.post("chests", { userId, action });
  },
  pushAction(userId, action, subscription) {
    return this.post("push", { userId, action, subscription });
  }
};
