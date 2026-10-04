// Logique de la page Communauté : Calendrier, Boss commun, Coffre de guilde,
// Marché noir. Les onglets Boss/Coffre partagent le meme chargement de
// collection (allCards/ownedMap), comme craft.js.

const BOSS_ERRORS = {
  no_active_boss: "Aucun boss actif pour l'instant.",
  card_not_found: "Carte introuvable.",
  promo_not_donatable: "Cette carte promo ne peut pas être donnée.",
  card_not_owned: "Tu ne possèdes pas cette carte."
};
const CHEST_ERRORS = {
  card_not_found: "Carte introuvable.",
  promo_not_donatable: "Cette carte promo ne peut pas être donnée.",
  card_not_owned: "Tu ne possèdes pas cette carte.",
  variant_not_owned: "Tu ne possèdes plus cet exemplaire précis.",
  already_drawn_today: "Tu as déjà pioché aujourd'hui, reviens demain.",
  already_deposited_today: "Tu as déjà déposé une carte aujourd'hui, reviens demain.",
  chest_empty: "Le coffre est vide pour l'instant, reviens plus tard."
};
const MARKET_ERRORS = {
  offer_not_found: "Offre introuvable.",
  offer_inactive: "Cette offre n'est plus active.",
  offer_expired: "Cette offre a expiré.",
  offer_exhausted: "Cette offre est épuisée.",
  insufficient_dust: "Pas assez de poussières d'étoile.",
  sold_out: "Tous les exemplaires de cette carte ont déjà été distribués."
};

// Echelles finish/quality (voir docs/SCHEMA.md, meme ordre que partout
// ailleurs) : utilisees pour afficher une pile DISTINCTE par variante sur
// une vignette de depot du coffre, pour que le joueur choisisse VRAIMENT
// quel exemplaire il donne (pas un exemplaire au hasard parmi ses
// doublons - voir buildChestVariants/chestCardTile plus bas).
const FINISH_ORDER = ["normal", "holo", "gold", "ghost", "diamond", "rainbow"];
const FINISH_LABELS = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
const QUALITY_ORDER = ["damaged", "worn", "good", "mint"];
const QUALITY_LABELS = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };

let allCards = [];
let ownedMap = new Map();
let activeTab = "calendar";
let bossSearchQuery = "";
let chestSearchQuery = "";
let chestAlreadyDepositedToday = false;

function normalize(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Memorise le dernier onglet visite (QoL 2026-09-30).
const LAST_TAB_KEY = "2gatcha_last_tab_communaute";
function getInitialTab() {
  try { return localStorage.getItem(LAST_TAB_KEY) || "calendar"; } catch (e) { return "calendar"; }
}

// Signaux courants (voir CommunauteSignals, shell.js) : onglets visibles et
// pastilles de nouveaute.
let communauteSignals = null;

function renderTabDots() {
  if (!communauteSignals) return;
  CommunauteSignals.TABS.forEach((key) => {
    const btn = document.getElementById(`tab-${key}-btn`);
    btn.querySelectorAll(".tab-new-dot").forEach((d) => d.remove());
    if (CommunauteSignals.isUnseen(key, communauteSignals[key])) {
      const dot = document.createElement("span");
      dot.className = "tab-new-dot";
      dot.setAttribute("aria-label", "Nouveau");
      btn.appendChild(dot);
    }
  });
}

function setActiveTab(tab) {
  activeTab = tab;
  if (communauteSignals) {
    // Ouvrir l'onglet = "vu" : sa pastille (et celle du menu) disparait.
    CommunauteSignals.markSeen(tab, communauteSignals[tab]);
    renderTabDots();
    if (typeof loadNavBadges === "function") loadNavBadges();
  }
  ["calendar", "boss", "chest", "market"].forEach((key) => {
    document.getElementById(`tab-${key}-btn`).classList.toggle("active", tab === key);
    document.getElementById(`tab-${key}-btn`).setAttribute("aria-selected", String(tab === key));
    document.getElementById(`${key}-pane`).style.display = tab === key ? "block" : "none";
  });
  try { localStorage.setItem(LAST_TAB_KEY, tab); } catch (e) {}
  if (tab === "calendar") loadCalendar();
  if (tab === "boss") loadBoss();
  if (tab === "chest") loadChest();
  if (tab === "market") loadMarket();
}

async function loadCalendar() {
  const loading = document.getElementById("calendar-loading");
  const list = document.getElementById("calendar-list");
  try {
    const res = await API.getEventCalendar();
    const events = res.events || [];
    list.innerHTML = events.length ? events.map((e) => {
      const when = e.startsAt ? new Date(e.startsAt * 1000).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : null;
      return `
        <div class="quest-row ${e.isLive ? "done" : ""}">
          <span class="quest-icon">${e.isLive ? "&#128994;" : "&#128197;"}</span>
          <span class="quest-label">${e.label}${when ? ` — ${e.isLive ? "en cours" : `dès le ${when}`}` : ""}</span>
        </div>
      `;
    }).join("") : `<div class="empty-state">Aucun évènement prévu pour l'instant.</div>`;
  } catch (e) {
    list.innerHTML = `<div class="empty-state">Impossible de charger le calendrier.</div>`;
  } finally {
    loading.style.display = "none";
  }
}

async function ensureCollectionLoaded() {
  if (allCards.length) return;
  const [cardsRes, collectionRes] = await Promise.all([API.getCards(), API.getCollection(Session.userId)]);
  allCards = cardsRes.cards || [];
  ownedMap = new Map((collectionRes.owned || []).map((o) => [o.cardId, o]));
}

function donatableCardTile(card, actionLabel, actionClass) {
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  const owned = ownedMap.get(card.cardId);
  return `
    <div class="craft-card" data-card-id="${card.cardId}" data-rarity="${card.rarity?.key || "commune"}">
      <img src="${imgSrc}" alt="${card.name}" loading="lazy" />
      <div class="card-info">
        <div class="card-name">${card.name}</div>
        <div class="owned-count">Possède x${owned.count}</div>
        <button class="${actionClass}" data-card-id="${card.cardId}">${actionLabel}</button>
      </div>
    </div>
  `;
}

// Regroupe les exemplaires possedes d'une carte par variante EXACTE
// (finition+qualite), comme collection.js buildVariants - une pile par
// variante reellement distincte, jamais un simple total qui masquerait
// quel exemplaire precis part.
function buildChestVariants(owned) {
  if (!owned || !owned.copies || !owned.copies.length) return [];
  const map = new Map();
  owned.copies.forEach((c) => {
    const finish = c.finish || "normal";
    const quality = c.quality || "damaged";
    const key = finish + "::" + quality;
    if (!map.has(key)) map.set(key, { finish, quality, count: 0 });
    map.get(key).count++;
  });
  return [...map.values()].sort((a, b) =>
    (FINISH_ORDER.indexOf(a.finish) - FINISH_ORDER.indexOf(b.finish)) ||
    (QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality))
  );
}

// Vignette de depot du coffre : une ligne par variante VRAIMENT possedee
// (pas juste un total), pour que le joueur choisisse exactement quel
// exemplaire il donne - avant, le serveur prenait le premier trouve au
// hasard, qui pouvait etre le plus prestigieux (holo/mint) du joueur.
function chestCardTile(card) {
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;
  const owned = ownedMap.get(card.cardId);
  const variants = buildChestVariants(owned);
  return `
    <div class="craft-card" data-rarity="${card.rarity?.key || "commune"}">
      <img src="${imgSrc}" alt="${card.name}" loading="lazy" />
      <div class="card-info">
        <div class="card-name">${card.name}</div>
        ${variants.map((v) => `
          <div class="chest-variant-row">
            <span class="chest-variant-tags">
              ${v.finish !== "normal" ? `<span class="finish-tag" data-finish="${v.finish}">${FINISH_LABELS[v.finish]}</span>` : ""}
              ${v.quality ? `<span class="quality-tag" data-quality="${v.quality}">${QUALITY_LABELS[v.quality]}</span>` : ""}
              <span class="chest-variant-count">x${v.count}</span>
            </span>
            <button type="button" class="btn-secondary chest-deposit-btn" data-card-id="${card.cardId}" data-finish="${v.finish}" data-quality="${v.quality}">Déposer</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------
// Boss communautaire
// -----------------------------------------------------------------------
async function loadBoss() {
  if (!Session.isLoggedIn()) {
    document.getElementById("boss-guest-warning").style.display = "block";
    return;
  }
  document.getElementById("boss-zone").style.display = "block";
  try {
    await ensureCollectionLoaded();
    const res = await API.getBossStatus(Session.userId);
    loadBossLeaderboard();
    if (!res.active) {
      document.getElementById("boss-no-active").style.display = "block";
      document.getElementById("boss-active-zone").style.display = "none";
      return;
    }
    document.getElementById("boss-no-active").style.display = "none";
    document.getElementById("boss-active-zone").style.display = "block";
    document.getElementById("boss-name").textContent = `${res.bossName}`;
    document.getElementById("boss-my-contribution").textContent = `Tes dégâts : ${res.myContribution || 0}`;
    const pct = res.maxHp ? Math.max(0, Math.round((res.currentHp / res.maxHp) * 100)) : 0;
    document.getElementById("boss-hp-fill").style.width = pct + "%";
    document.getElementById("boss-hp-label").textContent = `${res.currentHp} / ${res.maxHp} PV`;
    bossState = res;
    renderBossRules();
    renderBossGrid();
  } catch (e) {
    Toast.error("Impossible de charger le boss.");
  }
}

// Classement des degats (api/src/native/boss.js) : boss actif, sinon le
// dernier vaincu, avec le joueur qui a porte le coup final.
async function loadBossLeaderboard() {
  const el = document.getElementById("boss-leaderboard");
  try {
    const lb = await API.getBossLeaderboard(Session.userId);
    if (lb.rules) { bossRules = lb.rules; renderBossRules(); if (bossState) renderBossGrid(); }
    if (!lb.boss || !lb.top.length) { el.style.display = "none"; return; }
    const medals = ["&#129351;", "&#129352;", "&#129353;"];
    const meIn = lb.me && lb.top.some((e) => e.userId === lb.me.userId);
    el.style.display = "";
    el.innerHTML = `
      <h3>&#127942; Classement ${lb.boss.active ? "en cours" : "du dernier boss"} : ${lb.boss.bossName}</h3>
      ${!lb.boss.active && lb.boss.finisher ? `<p class="boss-finisher">&#9876;&#65039; Coup final porté par <strong>${lb.boss.finisher}</strong></p>` : lb.boss.active && lb.finisherBonus ? `<p class="boss-finisher">&#9876;&#65039; Le coup final rapporte <strong>+${lb.finisherBonus} boosters</strong> en plus de la récompense commune.</p>` : ""}
      <ol class="boss-ranking">
        ${lb.top.map((e) => `<li class="${lb.me && e.userId === lb.me.userId ? "me" : ""}"><span class="boss-rank">${medals[e.rank - 1] || e.rank}</span><span class="boss-pseudo">${e.pseudo}</span><span class="boss-dmg">${e.damage.toLocaleString("fr-FR")} dégâts</span><span class="boss-hits">${e.hits} carte${e.hits > 1 ? "s" : ""}</span></li>`).join("")}
      </ol>
      ${lb.me && !meIn ? `<p class="boss-me">Ta place : ${lb.me.rank}e sur ${lb.participants} (${lb.me.damage} dégâts)</p>` : ""}`;
  } catch (e) {
    el.style.display = "none";
  }
}

// Attaque en salve (api/src/native/boss.js) : le joueur choisit les
// exemplaires precis qu'il sacrifie ; degats = base de rarete x finition x
// etat, le tout x multiplicateur de salve. Memes regles que le serveur
// (renvoyees par boss-leaderboard), donc l'apercu est exact.
let bossRules = { finish: { normal: 1, holo: 1.5, gold: 2, ghost: 2.5, diamond: 3, rainbow: 5 }, quality: { damaged: 0.75, worn: 1, good: 1.25, mint: 1.5 }, volleyStep: 0.1, maxCards: 10 };
let bossState = null;
const bossSelection = new Map(); // cle de variante -> quantite
const BOSS_FINISH_LABELS = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
const BOSS_QUALITY_LABELS = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };

const bossVolley = (n) => Math.round((1 + bossRules.volleyStep * Math.max(0, Math.min(n, bossRules.maxCards) - 1)) * 100) / 100;
const bossSerial = (n) => "#" + String(n ?? "?").padStart(3, "0");
function bossCardBase(card) { return Math.max(1, Number(card.rarity?.disenchantValue) || 0); }
function bossCopyMultiplier(finish, quality) { return (bossRules.finish[finish] || 1) * (bossRules.quality[quality] || 1); }

// Variantes possedees (non promo) : une entree par carte + finition + etat.
function bossVariants() {
  const out = [];
  allCards.filter((c) => !c.isPromo && ownedMap.has(c.cardId)).forEach((card) => {
    const owned = ownedMap.get(card.cardId);
    const groups = new Map();
    (owned.copies || []).forEach((cp) => {
      const finish = cp.finish || "normal", quality = cp.quality || "damaged";
      const key = card.cardId + "::" + finish + "::" + quality;
      if (!groups.has(key)) groups.set(key, { key, card, finish, quality, copies: [], totalOwned: owned.count });
      groups.get(key).copies.push(cp);
    });
    groups.forEach((g) => {
      // Exemplaires sacrifies en premier : numeros les plus hauts, le #001 en dernier.
      g.copies.sort((a, b) => (a.serialNumber === 1) - (b.serialNumber === 1) || (b.serialNumber || 0) - (a.serialNumber || 0));
      g.perCard = bossCardBase(card) * bossCopyMultiplier(g.finish, g.quality);
      out.push(g);
    });
  });
  return out;
}

function bossSelectedCount() { let n = 0; bossSelection.forEach((q) => { n += q; }); return n; }

function renderBossRules() {
  const el = document.getElementById("boss-rules");
  if (!el) return;
  const f = Object.entries(bossRules.finish).filter(([, m]) => m !== 1).map(([k, m]) => `${BOSS_FINISH_LABELS[k] || k} ×${m}`).join(" · ");
  const q = Object.entries(bossRules.quality).map(([k, m]) => `${BOSS_QUALITY_LABELS[k] || k} ×${m}`).join(" · ");
  el.innerHTML = `
    <span class="boss-rule"><strong>Finition</strong> ${f}</span>
    <span class="boss-rule"><strong>État</strong> ${q}</span>
    <span class="boss-rule"><strong>Salve</strong> +${Math.round(bossRules.volleyStep * 100)} % par carte en plus, jusqu'à ×${bossVolley(bossRules.maxCards)} (${bossRules.maxCards} cartes)</span>`;
}

function renderBossGrid() {
  const grid = document.getElementById("boss-card-grid");
  const dupesOnly = document.getElementById("boss-dupes-only")?.checked;
  let variants = bossVariants();
  if (dupesOnly) variants = variants.filter((v) => v.totalOwned > 1);
  if (bossSearchQuery) {
    const q = normalize(bossSearchQuery);
    variants = variants.filter((v) => normalize(v.card.name).includes(q));
  }
  variants.sort((a, b) => b.perCard - a.perCard || a.card.name.localeCompare(b.card.name));
  const full = bossSelectedCount() >= bossRules.maxCards;
  grid.innerHTML = variants.length ? variants.map((v) => {
    const qty = bossSelection.get(v.key) || 0;
    // On garde toujours au moins un exemplaire de la carte (doublons seulement).
    const maxQty = dupesOnly ? Math.min(v.copies.length, v.totalOwned - 1) : v.copies.length;
    const lastCopy = v.totalOwned - qty <= 0;
    return `
      <div class="craft-card boss-variant ${qty ? "selected" : ""}" data-card-id="${v.card.cardId}" data-rarity="${v.card.rarity?.key || "commune"}" data-finish="${v.finish}" data-quality="${v.quality}">
        <div class="card-art">
          <img src="${API.imageUrl(v.card.imageId) || PLACEHOLDER_IMG}" alt="${v.card.name}" loading="lazy" />
          ${v.finish !== "normal" ? `<span class="finish-indicator" data-finish="${v.finish}">${BOSS_FINISH_LABELS[v.finish]}</span>` : ""}
          <span class="quality-indicator" data-quality="${v.quality}">${BOSS_QUALITY_LABELS[v.quality]}</span>
        </div>
        <div class="card-info">
          <div class="card-name">${v.card.name}</div>
          <div class="owned-count">x${v.copies.length}${v.totalOwned > v.copies.length ? ` · ${v.totalOwned} en tout` : ""}</div>
          <div class="boss-dmg-chip">&#9876;&#65039; ${Math.round(v.perCard)} / carte</div>
          <div class="qty-stepper">
            <button type="button" class="qty-btn" data-boss-qty="-1" data-key="${v.key}" aria-label="Retirer" ${qty <= 0 ? "disabled" : ""}>&minus;</button>
            <span class="qty-value">${qty}</span>
            <button type="button" class="qty-btn" data-boss-qty="1" data-key="${v.key}" aria-label="Ajouter" ${qty >= maxQty || full ? "disabled" : ""}>+</button>
          </div>
          ${qty && lastCopy ? '<div class="boss-warn">Ton dernier exemplaire</div>' : ""}
        </div>
      </div>`;
  }).join("") : `<div class="empty-state">${dupesOnly ? "Aucun doublon à donner. Décoche « Seulement mes doublons » pour voir toutes tes cartes." : "Aucune carte à donner ne correspond."}</div>`;
  renderBossTray();
}

// Plan exact de la salve : quels exemplaires partent et combien ils frappent.
function bossPlan() {
  const byKey = new Map(bossVariants().map((v) => [v.key, v]));
  const n = bossSelectedCount();
  const volley = bossVolley(n);
  const lines = [];
  bossSelection.forEach((qty, key) => {
    const v = byKey.get(key);
    if (!v || !qty) return;
    const copies = v.copies.slice(0, qty);
    lines.push({ v, copies, each: Math.round(v.perCard * volley) });
  });
  const total = lines.reduce((s, l) => s + l.each * l.copies.length, 0);
  return { lines, n, volley, total };
}

function renderBossTray() {
  const tray = document.getElementById("boss-tray");
  if (!tray || !bossState) return;
  const plan = bossPlan();
  const hp = bossState.currentHp || 0, maxHp = bossState.maxHp || 1;
  const after = Math.max(0, hp - plan.total);
  const precious = plan.lines.flatMap((l) => l.copies.filter((c) => c.serialNumber === 1 || c.finish === "rainbow" || c.quality === "mint").map((c) => `${l.v.card.name} ${bossSerial(c.serialNumber)}`));
  tray.innerHTML = `
    <h3>&#9876;&#65039; Ton attaque</h3>
    ${plan.n ? `
      <ul class="boss-tray-lines">${plan.lines.map((l) => `
        <li>
          <span><strong>${l.copies.length}× ${l.v.card.name}</strong><small>${l.v.finish !== "normal" ? BOSS_FINISH_LABELS[l.v.finish] + " · " : ""}${BOSS_QUALITY_LABELS[l.v.quality]} · ${l.copies.map((c) => bossSerial(c.serialNumber)).join(", ")}</small></span>
          <span class="boss-tray-dmg">${(l.each * l.copies.length).toLocaleString("fr-FR")}</span>
        </li>`).join("")}
      </ul>
      <div class="boss-tray-row"><span>Multiplicateur de salve (${plan.n} carte${plan.n > 1 ? "s" : ""})</span><strong>×${plan.volley.toLocaleString("fr-FR")}</strong></div>
      <div class="boss-tray-row boss-tray-total"><span>Dégâts</span><strong>${plan.total.toLocaleString("fr-FR")}</strong></div>
      <div class="boss-tray-hp" title="PV du boss après l'attaque">
        <div class="boss-tray-hp-bar"><span class="boss-tray-hp-after" style="width:${(after / maxHp) * 100}%"></span><span class="boss-tray-hp-hit" style="width:${(Math.min(plan.total, hp) / maxHp) * 100}%"></span></div>
        <small>${after > 0 ? `PV après : ${after.toLocaleString("fr-FR")} / ${maxHp.toLocaleString("fr-FR")}` : `&#127942; Ce coup achève le boss !${bossRules.finisherBonus ? ` (+${bossRules.finisherBonus} boosters pour le coup final)` : ""}`}</small>
      </div>
      ${precious.length ? `<div class="boss-warn">&#9888; Exemplaires précieux dans la salve : ${precious.join(", ")}</div>` : ""}
      <div class="boss-tray-actions">
        <button type="button" class="btn-ghost" id="boss-clear-btn">Vider</button>
        <button type="button" class="btn-danger" id="boss-attack-btn">Attaquer (${plan.n} carte${plan.n > 1 ? "s" : ""})</button>
      </div>`
    : `<p class="boss-tray-empty">Ajoute des cartes avec <strong>+</strong> : jusqu'à ${bossRules.maxCards} par salve. Plus la salve est grande, plus chaque carte frappe fort.</p>`}`;
  const clear = document.getElementById("boss-clear-btn");
  if (clear) clear.addEventListener("click", () => { bossSelection.clear(); renderBossGrid(); });
  const attack = document.getElementById("boss-attack-btn");
  if (attack) attack.addEventListener("click", () => attackBoss());
}

async function attackBoss() {
  const plan = bossPlan();
  if (!plan.n) return;
  const list = plan.lines.map((l) => `<li>${l.copies.length}× ${l.v.card.name} (${l.copies.map((c) => bossSerial(c.serialNumber)).join(", ")}) — ${(l.each * l.copies.length).toLocaleString("fr-FR")}</li>`).join("");
  const ok = await Confirm.show(
    `Sacrifier ces <strong>${plan.n} carte${plan.n > 1 ? "s" : ""}</strong> pour infliger <strong>${plan.total.toLocaleString("fr-FR")} dégâts</strong> (salve ×${plan.volley}) ?<ul style="text-align:left;margin:8px 0;font-size:0.85rem;">${list}</ul>Les exemplaires seront définitivement détruits.`,
    { title: "Attaquer le boss ?", confirmText: "Attaquer", dangerous: true }
  );
  if (!ok) return;
  const btn = document.getElementById("boss-attack-btn");
  if (btn) btn.disabled = true;
  try {
    const res = await API.bossAttack(Session.userId, plan.lines.flatMap((l) => l.copies.map((c) => c.pullId)));
    bossSelection.clear();
    if (res.defeated) {
      Toast.success(`&#127942; ${res.bossName} est vaincu ! +${res.rewardBoosters} boosters pour tous les participants !`);
      if (res.finisherBonus) Toast.success(`&#9876;&#65039; Coup final ! +${res.finisherBonus.boosters} boosters bonus pour toi.`);
      if (typeof confetti === "function") confetti({ particleCount: 220, spread: 130, origin: { y: 0.5 } });
    } else {
      Toast.success(`&#9876;&#65039; -${res.damage.toLocaleString("fr-FR")} PV (salve ×${res.volleyMultiplier}) !`);
    }
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    allCards = [];
    await loadBoss();
  } catch (e) {
    if (btn) btn.disabled = false;
    const msg = { no_active_boss: "Le boss n'est plus actif.", card_not_owned: "Un exemplaire n'est plus dans ta collection : recharge la page.", too_many_cards: `${bossRules.maxCards} cartes maximum par salve.`, promo_not_donatable: "Les cartes promo ne peuvent pas être données." };
    Toast.error(msg[e.code] || BOSS_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

// -----------------------------------------------------------------------
// Coffre de guilde
// -----------------------------------------------------------------------
// Le pot commun exclut TOUJOURS les propres depots du joueur (on ne pioche
// jamais sa propre carte, voir docs/SCHEMA.md "Coffre de guilde mystere") :
// avec peu de joueurs actifs, deposer puis voir "0 carte disponible" peut
// donner l'impression que le coffre est casse alors que c'est simplement
// qu'aucun AUTRE joueur n'a encore rien depose. On separe donc clairement
// "ton depot est bien passe" de "ce qu'il y a a piocher pour toi", et on
// laisse toujours au moins une action possible (actualiser) plutot que de
// laisser un panneau vide sans aucun bouton.
async function loadChest() {
  if (!Session.isLoggedIn()) {
    document.getElementById("chest-guest-warning").style.display = "block";
    return;
  }
  document.getElementById("chest-zone").style.display = "block";
  try {
    await ensureCollectionLoaded();
    const res = await API.getGuildChestStatus(Session.userId);
    const statusText = document.getElementById("chest-status-text");
    const hint = document.getElementById("chest-status-hint");
    const drawBtn = document.getElementById("chest-draw-btn");
    const chestIcon = document.getElementById("chest-icon");
    statusText.classList.remove("skeleton-line");

    chestAlreadyDepositedToday = !!res.alreadyDepositedToday;
    renderChestKeyPool(res);

    // Le coffre "a l'air" rempli selon poolSize (embellissement 2026-09-30) :
    // ferme et terne a 0, entrouvert des 1+, dore et anime a partir de 3 -
    // un signal visuel immediat de "il y a quelque chose a piocher" avant
    // meme de lire le texte de statut.
    if (chestIcon) {
      chestIcon.classList.toggle("chest-empty", res.poolSize === 0);
      chestIcon.classList.toggle("chest-full", res.poolSize >= 3);
      chestIcon.textContent = res.poolSize === 0 ? "\u{1F4E6}" : "\u{1F381}";
    }

    if (res.alreadyDrawnToday) {
      statusText.textContent = "Tu as déjà pioché aujourd'hui, reviens demain.";
    } else if (res.poolSize > 0) {
      statusText.textContent = `${res.poolSize} carte${res.poolSize > 1 ? "s" : ""} d'autres joueurs disponible${res.poolSize > 1 ? "s" : ""} à piocher !`;
    } else {
      statusText.textContent = "Le pot commun est vide pour l'instant.";
    }
    drawBtn.style.display = (!res.alreadyDrawnToday && res.poolSize > 0) ? "inline-flex" : "none";

    if (chestAlreadyDepositedToday && !res.alreadyDrawnToday && res.poolSize === 0) {
      hint.textContent = "Ta carte est bien dans le pot commun. Reviens plus tard, ou clique sur Actualiser si quelqu'un vient de déposer.";
      hint.style.display = "block";
    } else if (chestAlreadyDepositedToday) {
      hint.textContent = "Tu as déjà déposé une carte aujourd'hui.";
      hint.style.display = "block";
    } else {
      hint.style.display = "none";
    }

    document.getElementById("chest-deposit-limit-msg").style.display = chestAlreadyDepositedToday ? "block" : "none";
    document.getElementById("chest-card-grid").style.display = chestAlreadyDepositedToday ? "none" : "";
    document.getElementById("chest-search-input").style.display = chestAlreadyDepositedToday ? "none" : "";
    renderChestGrid();
  } catch (e) {
    document.getElementById("chest-status-text").classList.remove("skeleton-line");
    Toast.error("Impossible de charger le coffre.");
  }
}

function renderChestGrid() {
  const grid = document.getElementById("chest-card-grid");
  let donatable = allCards.filter((c) => !c.isPromo && ownedMap.has(c.cardId));
  if (chestSearchQuery) {
    const q = normalize(chestSearchQuery);
    donatable = donatable.filter((c) => normalize(c.name).includes(q));
  }
  grid.innerHTML = donatable.length
    ? donatable.map((c) => chestCardTile(c)).join("")
    : `<div class="empty-state">Aucune carte à déposer ne correspond.</div>`;
  grid.querySelectorAll(".chest-deposit-btn").forEach((btn) => {
    btn.addEventListener("click", () => depositChest(Number(btn.dataset.cardId), btn.dataset.finish, btn.dataset.quality));
  });
}

// finish/quality precisent EXACTEMENT quelle variante deposer (vignette
// cliquee) - BUG REEL corrige ici (2026-09-29) : avant, le serveur prenait
// le premier exemplaire trouve au hasard (potentiellement le plus
// prestigieux du joueur) sans lui laisser le choix, et la finition/qualite
// etaient de toute facon silencieusement perdues au passage dans le coffre.
async function depositChest(cardId, finish, quality) {
  const card = allCards.find((c) => c.cardId === cardId);
  const variantLabel = finish && finish !== "normal" || (quality && quality !== "mint")
    ? ` (${finish !== "normal" ? FINISH_LABELS[finish] : ""}${finish !== "normal" && quality !== "mint" ? ", " : ""}${quality !== "mint" ? QUALITY_LABELS[quality] : ""})`
    : "";
  const ok = await Confirm.show(
    `Déposer <strong>${card?.name || "cette carte"}${variantLabel}</strong> dans le pot commun ? L'exemplaire quitte définitivement ta collection (un autre joueur pourra le piocher).`,
    { title: "Déposer cette carte ?", confirmText: "Déposer", dangerous: true }
  );
  if (!ok) return;
  try {
    await API.depositGuildChest(Session.userId, cardId, finish, quality);
    Toast.success(`${card?.name || "Carte"} déposée dans le coffre.`);
    allCards = [];
    await loadChest();
  } catch (e) {
    Toast.error(CHEST_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

// Pioche au choix contre 1 clef (2026-10-02) : le contenu du coffre n'est
// renvoye par le serveur que si le joueur possede une clef - sans clef, cette
// zone n'existe tout simplement pas pour lui (les clefs restent un secret).
const CHEST_FINISH_LABELS = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
const CHEST_QUALITY_LABELS = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };
function renderChestKeyPool(res) {
  const zone = document.getElementById("chest-key-zone");
  const pool = res.pool || [];
  if (!(res.keys > 0) || !pool.length) { zone.style.display = "none"; return; }
  zone.style.display = "";
  const sorted = [...pool].sort((a, b) => (b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0) || a.name.localeCompare(b.name));
  document.getElementById("chest-key-grid").innerHTML = sorted.map((p) => {
    const imgSrc = API.imageUrl(p.imageId) || PLACEHOLDER_IMG;
    return `
      <div class="craft-card" data-rarity="${p.rarity?.key || "commune"}" data-finish="${p.finish}" data-quality="${p.quality}">
        <div class="card-art">
          <img src="${imgSrc}" alt="${p.name}" loading="lazy" />
          ${p.finish !== "normal" ? `<span class="finish-indicator" data-finish="${p.finish}">${CHEST_FINISH_LABELS[p.finish]}</span>` : ""}
          <span class="quality-indicator" data-quality="${p.quality}">${CHEST_QUALITY_LABELS[p.quality]}</span>
          ${p.serialNumber === 1 ? `<span class="serial-one-badge">#001</span>` : ""}
        </div>
        <div class="card-info">
          <div class="card-name">${p.name}</div>
          <div class="owned-count">${p.rarity?.name || ""}${p.serialNumber != null ? " · #" + String(p.serialNumber).padStart(3, "0") : ""}</div>
          <button type="button" class="btn-secondary chest-key-pick-btn" data-deposit-id="${p.depositId}">Prendre (&minus;1 &#128273;)</button>
        </div>
      </div>
    `;
  }).join("");
  document.querySelectorAll(".chest-key-pick-btn").forEach((btn) => btn.addEventListener("click", () => pickChestWithKey(Number(btn.dataset.depositId), btn)));
}

async function pickChestWithKey(depositId, btn) {
  btn.disabled = true;
  try {
    const res = await API.drawGuildChest(Session.userId, depositId);
    Toast.success(`Tu as pris : ${res.card?.name || "une carte"} !`);
    if (typeof confetti === "function") confetti({ particleCount: 110, spread: 90, origin: { y: 0.5 } });
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    allCards = [];
    await loadChest();
  } catch (err) {
    btn.disabled = false;
    Toast.error(CHEST_ERRORS[err.code] || ({ no_key: "Il te faut une clé secrète.", deposit_unavailable: "Cette carte vient d'être prise par quelqu'un d'autre." }[err.code]) || ("Erreur. (" + err.message + ")"));
    if (err.code === "deposit_unavailable") { allCards = []; await loadChest(); }
  }
}

document.addEventListener("click", async (e) => {
  if (e.target && e.target.id === "chest-refresh-btn") {
    allCards = [];
    await loadChest();
    return;
  }
  if (e.target && e.target.id === "chest-draw-btn") {
    try {
      const res = await API.drawGuildChest(Session.userId);
      Toast.success(`Tu as pioché : ${res.card?.name || "une carte"} !`);
      if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
      allCards = [];
      await loadChest();
    } catch (err) {
      Toast.error(CHEST_ERRORS[err.code] || ("Erreur. (" + err.message + ")"));
    }
  }
});

// -----------------------------------------------------------------------
// Marché noir
// -----------------------------------------------------------------------
async function loadMarket() {
  if (!Session.isLoggedIn()) {
    document.getElementById("market-guest-warning").style.display = "block";
    return;
  }
  document.getElementById("market-zone").style.display = "block";
  const loading = document.getElementById("market-loading");
  const grid = document.getElementById("market-grid");
  try {
    const res = await API.listBlackMarket(Session.userId);
    const offers = res.offers || [];
    grid.innerHTML = offers.length ? offers.map((o) => {
      const imgSrc = API.imageUrl(o.card.imageId) || PLACEHOLDER_IMG;
      return `
        <div class="craft-card" data-rarity="${o.card.rarity?.key || "commune"}">
          <img src="${imgSrc}" alt="${o.card.name}" loading="lazy" />
          <div class="card-info">
            <div class="card-name">${o.card.name}</div>
            <div class="craft-cost">${o.cost} poussières${o.remaining != null ? ` · ${o.remaining} restant${o.remaining > 1 ? "s" : ""}` : ""}</div>
            <button class="btn-secondary market-buy-btn" data-offer-id="${o.offerId}">Acheter</button>
          </div>
        </div>
      `;
    }).join("") : `<div class="empty-state">Aucune offre active pour l'instant.</div>`;
    grid.querySelectorAll(".market-buy-btn").forEach((btn) => {
      btn.addEventListener("click", () => buyMarket(Number(btn.dataset.offerId)));
    });
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">Impossible de charger le marché noir.</div>`;
  } finally {
    loading.style.display = "none";
  }
}

async function buyMarket(offerId) {
  const ok = await Confirm.show(`Acheter cette offre du marché noir ?`, { title: "Confirmer l'achat", confirmText: "Acheter" });
  if (!ok) return;
  try {
    const res = await API.buyBlackMarket(Session.userId, offerId);
    Toast.success(`${res.cardName || "Carte"} achetée !`);
    if (typeof confetti === "function") confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
    await loadMarket();
  } catch (e) {
    Toast.error(MARKET_ERRORS[e.code] || ("Erreur. (" + e.message + ")"));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // N'affiche que les onglets qui ont quelque chose d'actif (pas de boss en
  // cours = pas d'onglet Boss, etc.). Hors connexion, on garde l'affichage
  // complet (les panneaux expliquent qu'il faut se connecter).
  if (Session.isLoggedIn()) {
    try { communauteSignals = await CommunauteSignals.fetch(); } catch (e) { communauteSignals = null; }
  }
  let initial = getInitialTab();
  if (communauteSignals) {
    CommunauteSignals.TABS.forEach((key) => {
      document.getElementById(`tab-${key}-btn`).style.display = communauteSignals[key].active ? "" : "none";
    });
    const firstUnseen = CommunauteSignals.TABS.find((k) => CommunauteSignals.isUnseen(k, communauteSignals[k]));
    if (!communauteSignals[initial] || !communauteSignals[initial].active) initial = firstUnseen || "chest";
    renderTabDots();
  }
  setActiveTab(initial);

  document.getElementById("tab-calendar-btn").addEventListener("click", () => setActiveTab("calendar"));
  document.getElementById("tab-boss-btn").addEventListener("click", () => setActiveTab("boss"));
  document.getElementById("tab-chest-btn").addEventListener("click", () => setActiveTab("chest"));
  document.getElementById("tab-market-btn").addEventListener("click", () => setActiveTab("market"));

  let bossSearchTimer = null;
  document.getElementById("boss-search-input").addEventListener("input", (e) => {
    clearTimeout(bossSearchTimer);
    bossSearchTimer = setTimeout(() => { bossSearchQuery = e.target.value; renderBossGrid(); }, 200);
  });
  document.getElementById("boss-card-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-boss-qty]");
    if (!btn) return;
    const key = btn.dataset.key;
    const next = Math.max(0, (bossSelection.get(key) || 0) + Number(btn.dataset.bossQty));
    if (next) bossSelection.set(key, next); else bossSelection.delete(key);
    renderBossGrid();
  });
  document.getElementById("boss-dupes-only").addEventListener("change", () => { bossSelection.clear(); renderBossGrid(); });
  let chestSearchTimer = null;
  document.getElementById("chest-search-input").addEventListener("input", (e) => {
    clearTimeout(chestSearchTimer);
    chestSearchTimer = setTimeout(() => { chestSearchQuery = e.target.value; renderChestGrid(); }, 200);
  });
});
