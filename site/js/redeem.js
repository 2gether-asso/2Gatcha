// Logique de la page de reclamation de code d'événement.
// Contrat de la route "redeem-code" (POST { userId, code }):
// { "type": "booster", "quantity": 3, "newBoosterCount": 5 }
// ou
// { "type": "card", "cards": [ { cardId, name, artist, description, imageId,
//                                 rarity: { id, name, key, colorHex } } ] }

const ERROR_MESSAGES = {
  invalid_code: "Ce code n'existe pas.",
  code_inactive: "Ce code a été désactivé.",
  code_expired: "Ce code a expiré.",
  already_redeemed: "Tu as déjà réclamé ce code.",
  code_exhausted: "Ce code a atteint son nombre maximum d'utilisations.",
  unknown_user: "Utilisateur introuvable, reconnecte-toi.",
  code_misconfigured: "Ce code est mal configure, previens un admin.",
  code_not_started: "Ce code n'est pas encore ouvert : reviens un peu plus tard !",
  sold_out: "Tous les exemplaires de cette carte ont déjà été distribués."
};

const UNLOCK_ERROR_MESSAGES = {
  no_key: "Il te faut une clé pour ouvrir cette serrure (fouille, pêche, roue…).",
  no_secret_available: "Aucune carte secrète n'est disponible pour le moment.",
  unknown_user: "Utilisateur introuvable, reconnecte-toi."
};

const REDEEM_FINISH_LABELS = { holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
const REDEEM_QUALITY_LABELS = { damaged: "Usé", worn: "Abîmé", good: "Bon état", mint: "Parfait état" };

function buildCardEl(card, index) {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.dataset.rarity = card.rarity?.key || "commune";
  // Meme traitement visuel que l'ouverture de booster (finition, etat, #001) :
  // une carte secrete arc-en-ciel doit se voir comme telle.
  const finish = card.finish || "normal";
  const quality = card.quality || null;
  wrap.dataset.finish = finish;
  if (quality) wrap.dataset.quality = quality;
  wrap.style.animationDelay = `${index * 90}ms`;

  const color = card.rarity?.colorHex || "#9aa0b4";
  const imgSrc = API.imageUrl(card.imageId) || PLACEHOLDER_IMG;

  wrap.innerHTML = `
    <div class="card-inner">
      <div class="card-face card-back">?</div>
      <div class="card-face card-front">
        <div class="card-art">
          <img src="${imgSrc}" alt="${card.name}" />
          ${finish !== "normal" ? `<span class="finish-indicator" data-finish="${finish}">${REDEEM_FINISH_LABELS[finish] || finish}</span>` : ""}
          ${quality ? `<span class="quality-indicator" data-quality="${quality}">${REDEEM_QUALITY_LABELS[quality] || quality}</span>` : ""}
          ${card.serialNumber === 1 ? `<span class="serial-one-badge" title="Premier exemplaire en circulation">#001</span>` : ""}
        </div>
        <div class="card-info">
          <div class="card-name">${card.name}</div>
          <div class="card-artist">${card.artist || ""}</div>
          <span class="rarity-badge" style="background:${color}22;color:${rarityTextColor(color)};border:1px solid ${color};">
            ${card.rarity?.name || "Commune"}
          </span>
        </div>
      </div>
    </div>
  `;
  return wrap;
}

// A partir d'epique (pas seulement legendaire) : le flash plein ecran suit
// desormais la VRAIE couleur de la rarete (hexToRgba, ui.js) et son
// intensite grandit avec le palier - jamais fige sur l'orange legendaire.
const RARITY_FLASH_TIERS = {
  epique: { alpha: 0.4, duration: "0.7s", brightness: 1.6, className: "tier-epique" },
  legendaire: { alpha: 0.55, duration: "0.9s", brightness: 2, className: "tier-legendaire" },
  mythique: { alpha: 0.7, duration: "1.2s", brightness: 2.6, className: "tier-mythique" }
};
const RARITY_FLASH_TOASTS = { legendaire: "Légendaire !", mythique: "Mythique !" };
function celebrateRarity(key, cardEl, colorHex) {
  // Particules proportionnelles a la rareté (spawnRarityBurst, ui.js),
  // toujours au-dessus de tout (z-index:420).
  spawnRarityBurst(key, colorHex, cardEl);
  const tier = RARITY_FLASH_TIERS[key];
  if (tier) {
    // Pas de transform sur un ancetre des cartes (voir opening.js) : on
    // isole l'effet a un flash plein écran + un filtre sur la carte.
    const flash = document.getElementById("legendary-flash");
    if (flash) {
      flash.style.setProperty("--flash-color", hexToRgba(colorHex, tier.alpha));
      flash.style.setProperty("--flash-duration", tier.duration);
      flash.className = "legendary-flash " + tier.className;
      void flash.offsetWidth;
      flash.classList.add("active");
    }
    if (cardEl) {
      cardEl.style.setProperty("--flash-duration", tier.duration);
      cardEl.style.setProperty("--flash-brightness", tier.brightness);
      cardEl.classList.remove("legendary-hit");
      void cardEl.offsetWidth;
      cardEl.classList.add("legendary-hit");
    }
    if (RARITY_FLASH_TOASTS[key]) Toast.success(RARITY_FLASH_TOASTS[key]);
  }
}

async function refreshBoosterStat() {
  const grid = document.getElementById("redeem-stats-grid");
  if (!grid) return;
  try {
    const status = await API.getBoosterStatus(Session.userId);
    grid.innerHTML = `
      <div class="stat-tile">
        <div class="stat-value">&#127183; ${status.count ?? 0}</div>
        <div class="stat-label">Booster${status.count > 1 ? "s" : ""} en stock</div>
      </div>
    `;
  } catch (e) { /* pas bloquant : le formulaire reste utilisable sans ce chiffre */ }
}

async function redeem() {
  const input = document.getElementById("code-input");
  const btn = document.getElementById("redeem-btn");
  const code = input.value.trim();
  if (!code) return;

  document.getElementById("reward-zone").innerHTML = "";
  document.getElementById("reveal-grid").innerHTML = "";
  btn.disabled = true;

  try {
    const res = await API.redeemCode(Session.userId, code);

    // Cinematique de deblocage commune a tous les codes (ui.js, UnlockFx).
    if (res.type === "booster") {
      document.getElementById("reward-zone").innerHTML =
        `<div class="reward-banner">+${res.quantity} jeton${res.quantity > 1 ? "s" : ""} booster ! Tu en as maintenant ${res.newBoosterCount}.</div>`;
      await UnlockFx.show({ title: "Code réclamé", rewards: [{ icon: "🃏", label: `+${res.quantity} jeton${res.quantity > 1 ? "s" : ""} booster` }] });
      refreshBoosterStat();
    } else if (res.type === "reward") {
      // Code secret : cosmetiques, ressources, parfois une carte.
      document.getElementById("reward-zone").innerHTML = `<div class="reward-banner">${escHtml(res.title)} : ${res.rewards.map((r) => escHtml(r.label)).join(" · ")}${res.cards && res.cards.length ? ` · ${res.cards.length} carte${res.cards.length > 1 ? "s" : ""}` : ""}</div>`;
      await UnlockFx.show({ title: res.title, subtitle: res.source === "event" ? "Code événement" : "Un code secret !", rewards: res.rewards, cards: res.cards || [], tone: res.source === "event" ? "gold" : "violet" });
      refreshBoosterStat();
    } else if (res.type === "secret") {
      // Le mot des rouages : cinematique, puis la porte.
      try { localStorage.setItem("2gatcha_forbidden", res.page); } catch (e) { /* stockage indisponible */ }
      input.value = "";
      secretCinematic(res);
      return;
    } else if (res.type === "card") {
      document.getElementById("reward-zone").innerHTML = `<div class="reward-banner">Carte reçue !</div>`;
      await UnlockFx.show({ title: res.cards.length > 1 ? "Cartes débloquées" : "Carte débloquée", cards: res.cards });
      const grid = document.getElementById("reveal-grid");
      res.cards.forEach((card, i) => {
        const el = buildCardEl(card, i);
        grid.appendChild(el);
        setTimeout(() => {
          el.classList.add("revealed");
          Sfx.flip();
          setTimeout(() => Sfx.reveal(card.rarity?.key), 260);
          // Voir opening.js : celebrateRarity force un reflow synchrone
          // (getBoundingClientRect) qui peut casser la transition CSS du flip
          // si elle est lue dans le meme tick que le classList.add ci-dessus.
          requestAnimationFrame(() => celebrateRarity(card.rarity?.key, el, card.rarity?.colorHex));
        }, 300 + i * 220);
      });
    }

    input.value = "";
    loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error(ERROR_MESSAGES[e.code] || ("Erreur lors de la reclamation. (" + e.message + ")"));
  } finally {
    btn.disabled = false;
  }
}

// Serrure cachee (easter egg cartes secretes) : 5 clics sur le cadeau le
// decalent sur le cote et revelent une serrure ; cliquer la serrure consomme
// une clef secrete (trouvee en fouillant, voir jeux.js) et donne une carte
// IsSecret au hasard. Remplace l'ancien Konami code.
let giftClickCount = 0;
let lockRevealed = false;
let unlockBusy = false;

// Nombre de clefs du joueur (lu au chargement) : sans clef, le cadeau ne
// revele rien - les clefs et leurs usages restent un secret a decouvrir.
let playerKeys = 0;

function onGiftClick() {
  if (lockRevealed || playerKeys < 1) return;
  giftClickCount++;
  if (giftClickCount >= 5) {
    lockRevealed = true;
    document.getElementById("redeem-gift-icon").classList.add("gift-shifted");
    document.getElementById("redeem-lock-icon").classList.add("lock-revealed");
  }
}

async function onLockClick() {
  if (unlockBusy) return;
  unlockBusy = true;
  try {
    const res = await API.unlockSecret(Session.userId);
    playerKeys = res.newKeyCount != null ? res.newKeyCount : Math.max(0, playerKeys - 1);
    document.getElementById("reward-zone").innerHTML = `<div class="reward-banner">Carte secrète débloquée !</div>`;
    const grid = document.getElementById("reveal-grid");
    grid.innerHTML = "";
    const el = buildCardEl(res.card, 0);
    grid.appendChild(el);
    setTimeout(() => {
      el.classList.add("revealed");
      Sfx.flip();
      setTimeout(() => Sfx.reveal(res.card.rarity?.key), 260);
      requestAnimationFrame(() => celebrateRarity(res.card.rarity?.key || "legendaire", el, res.card.rarity?.colorHex || "#8b5cf6"));
    }, 300);
    loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error(UNLOCK_ERROR_MESSAGES[e.code] || friendlyError(e));
  } finally {
    unlockBusy = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!Session.isLoggedIn()) {
    document.getElementById("guest-warning").style.display = "block";
    return;
  }
  document.getElementById("redeem-zone").style.display = "block";
  document.getElementById("redeem-info-panel").style.display = "block";
  refreshBoosterStat();
  document.getElementById("redeem-btn").addEventListener("click", redeem);
  document.getElementById("code-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") redeem();
  });
  document.getElementById("redeem-gift-icon").addEventListener("click", onGiftClick);
  document.getElementById("redeem-lock-icon").addEventListener("click", onLockClick);
  API.getBoosterStatus(Session.userId).then((s) => { playerKeys = s.keys || 0; }).catch(() => {});

  // Prefill depuis un QR code génère par l'admin (redeem.html?code=XXXX).
  const prefill = new URLSearchParams(window.location.search).get("code");
  if (prefill) {
    document.getElementById("code-input").value = prefill.toUpperCase();
  }
});

// Le mot des rouages (2026-10-19) : ecran noir, grondement, dix rouages qui
// s'eveillent, quelques mots, une faille de lumiere… puis la porte. Aucune
// explication : le joueur arrive devant la porte sans mode d'emploi.
function secretCinematic(res) {
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lines = res.first
    ? ["…", "Le mot a été entendu.", "Sous les cartes, sous les pages, quelque chose s'éveille.", "Suis le grincement."]
    : ["…", "La porte se souvient de toi."];
  const ov = document.createElement("div");
  ov.className = "sc-overlay";
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-label", "…");
  ov.innerHTML = `<div class="sc-gears" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<span style="--i:${i}">&#9881;&#65039;</span>`).join("")}</div>
    <p class="sc-line" aria-live="polite"></p><div class="sc-crack" aria-hidden="true"></div>`;
  document.body.appendChild(ov);
  if (typeof syncScrollLock === "function") syncScrollLock();
  const tone = (f, t, d, type = "sine", v = 0.05) => { if (typeof Sfx !== "undefined" && Sfx._tone) Sfx._tone(f, t, d, type, v); };
  // Grondement sourd + cliquetis.
  tone(55, 0, 2.5, "sawtooth", 0.04); tone(41, 0.8, 3, "sine", 0.06);
  for (let i = 0; i < 10; i++) tone(700 + (i % 3) * 90, 1 + i * 0.32, 0.03, "square", 0.02);
  if (typeof Haptics !== "undefined") Haptics.buzz([40, 120, 40, 120, 200]);
  requestAnimationFrame(() => ov.classList.add("sc-in"));
  const line = ov.querySelector(".sc-line");
  const step = reduced ? 700 : 1700;
  const typeLine = (txt) => {
    line.classList.remove("sc-show"); void line.offsetWidth;
    line.textContent = "";
    line.classList.add("sc-show");
    if (reduced) { line.textContent = txt; return; }
    let i = 0;
    const t = setInterval(() => { line.textContent = txt.slice(0, ++i); if (i >= txt.length) clearInterval(t); }, Math.max(18, 900 / Math.max(10, txt.length)));
  };
  let k = 0;
  const go = () => {
    try { sessionStorage.setItem("2gatcha_fd_arrival", "1"); } catch (e) { /* stockage indisponible */ }
    location.href = res.page;
  };
  const next = () => {
    if (k < lines.length) { typeLine(lines[k++]); timer = setTimeout(next, step); return; }
    ov.classList.add("sc-open");
    tone(220, 0, 1.2, "triangle", 0.05); tone(330, 0.2, 1.4, "sine", 0.04);
    if (typeof Haptics !== "undefined") Haptics.buzz(300);
    timer = setTimeout(go, reduced ? 400 : 2200);
  };
  let timer = setTimeout(next, reduced ? 200 : 1200);
  // Un clic accelere (apres un court instant), jamais d'explication.
  let skippable = false;
  setTimeout(() => { skippable = true; }, 1500);
  ov.addEventListener("click", () => { if (!skippable) return; clearTimeout(timer); go(); });
}
