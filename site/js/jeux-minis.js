// Jeux : bingo, cage de Pepper (coffre-fort), devine la carte.
// Decoupage de jeux.js (Jeux V2, 2026-11-15) : scripts classiques charges
// dans l'ordre par jeux.html ; leurs declarations restent partagees entre fichiers.

// -----------------------------------------------------------------------
// Bingo
// -----------------------------------------------------------------------
async function loadBingo() {
  try {
    const res = await API.getBingoStatus(Session.userId);
    if (!res.hasGrid) {
      document.getElementById("bingo-no-grid").style.display = "block";
      document.getElementById("bingo-zone").style.display = "none";
      return;
    }
    document.getElementById("bingo-no-grid").style.display = "none";
    document.getElementById("bingo-zone").style.display = "block";
    document.getElementById("bingo-grid").innerHTML = (res.cells || []).map((c) => {
      const color = c.rarity?.colorHex || "#9aa0b4";
      const imgSrc = API.imageUrl(c.imageId) || PLACEHOLDER_IMG;
      return `
        <div class="bingo-cell ${c.owned ? "owned" : ""}" style="border-color:${c.owned ? color : "transparent"};">
          <img src="${imgSrc}" alt="${c.name}" loading="lazy" decoding="async" />
          <div class="bingo-cell-name">${c.name}</div>
          ${c.owned ? `<span class="bingo-cell-check">&#9989;</span>` : ""}
        </div>
      `;
    }).join("");
    const claimBtn = document.getElementById("bingo-claim-btn");
    const claimedLabel = document.getElementById("bingo-claimed-label");
    if (res.claimed) {
      claimBtn.style.display = "none";
      claimedLabel.style.display = "inline-flex";
    } else if (res.allOwned) {
      claimBtn.style.display = "inline-flex";
      claimedLabel.style.display = "none";
    } else {
      claimBtn.style.display = "none";
      claimedLabel.style.display = "none";
    }
  } catch (e) {
    document.getElementById("bingo-no-grid").style.display = "block";
    document.getElementById("bingo-no-grid").textContent = "Impossible de charger le bingo.";
  }
}

// Ancien bingo (9 cartes) : garde tant que l'API repond l'ancien format (jeux-bingo.js).
window.loadBingoLegacy = () => loadBingo();
async function claimBingo() {
  try {
    const res = await API.claimBingo(Session.userId);
    Toast.success(`Bingo complet ! +${res.rewardBoosters} boosters !`);
    if (typeof confetti === "function") confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } });
    await loadBingo();
  } catch (e) {
    Toast.error(e.code === "already_claimed" ? "Déjà réclamé ce mois-ci." : friendlyError(e));
  }
}

// -----------------------------------------------------------------------
// Coffre-fort : une carte promo arc-en-ciel vitrine, visible mais enfermee
// tant qu'on n'a pas 6 clefs secretes (memes clefs que la fouille/la roue
// quotidienne) - deverrouillage DEFINITIF, une seule fois par joueur (voir
// vault.json - pas de colonne d'etat dediee, juste une ligne Pulls au
// BatchId prefixe 'vault-').
// Cage a 6 cadenas (2026-10-17) : chaque clef possedee fait sauter un cadenas
// au clic (cote site, memorise localement) ; au dernier, le coffre s'ouvre
// (vault.json, les 6 clefs sont alors consommees). Une fois ouvert : coffre
// vide et lien vers le coffre personnel.
let vaultState = null;
const vaultPoppedKey = () => `2gatcha_vault_popped_${Session.userId}`;
function vaultPopped() { try { return Math.max(0, Number(localStorage.getItem(vaultPoppedKey())) || 0); } catch (e) { return 0; } }
function setVaultPopped(n) { try { localStorage.setItem(vaultPoppedKey(), String(n)); } catch (e) { /* stockage indisponible */ } }

async function loadVault() {
  try {
    const res = await API.getVaultStatus(Session.userId);
    vaultState = res;
    if (!res.card) {
      document.getElementById("vault-locked").innerHTML = `<div class="empty-state">Le coffre-fort n'est pas encore configuré.</div>`;
      return;
    }
    const lockedZone = document.getElementById("vault-locked");
    const openedZone = document.getElementById("vault-opened");
    if (res.alreadyOpened) {
      lockedZone.style.display = "none";
      openedZone.style.display = "flex";
      document.getElementById("vault-intro").hidden = true;
      document.getElementById("vault-opened-name").textContent = res.card.name;
      setVaultPopped(0);
      return;
    }
    lockedZone.style.display = "block";
    openedZone.style.display = "none";
    document.getElementById("vault-card-img").src = API.imageUrl(res.card.imageId) || PLACEHOLDER_IMG;
    document.getElementById("vault-card-img").alt = res.card.name;
    const vaultNameEl = document.getElementById("vault-card-name");
    vaultNameEl.classList.remove("skeleton-line");
    vaultNameEl.textContent = `Libère ${res.card.name}`;
    renderPadlocks();
  } catch (e) {
    Toast.error("Impossible de charger le coffre-fort.");
  }
}

function renderPadlocks() {
  const res = vaultState;
  const need = res.keysRequired || 6;
  const popped = Math.min(vaultPopped(), res.userKeys, need);
  const box = document.getElementById("vault-padlocks");
  box.innerHTML = Array.from({ length: need }, (_, i) => {
    const open = i < popped;
    const can = !open && i < res.userKeys;
    return `<button type="button" class="vault-padlock ${open ? "popped" : can ? "can" : "locked"}" data-i="${i}" ${can ? "" : "disabled"} aria-label="${open ? "Cadenas ouvert" : can ? "Faire sauter ce cadenas avec une clé" : "Il manque une clé"}">${open ? "&#128275;" : "&#128274;"}</button>`;
  }).join("");
  const left = Math.max(0, need - res.userKeys);
  document.getElementById("vault-keys-label").innerHTML = `<img class="ico-art" src="assets/${encodeURI(RES_ART.key)}" alt="" /> ${res.userKeys} / ${need} clés · ${popped} cadenas ouvert${popped > 1 ? "s" : ""}${left ? ` · encore ${left} clé${left > 1 ? "s" : ""} à trouver` : popped < need ? " · fais sauter les cadenas !" : ""}`;
}

async function popPadlock(btn) {
  const res = vaultState;
  const need = res.keysRequired || 6;
  const popped = Math.min(vaultPopped(), res.userKeys, need);
  if (popped >= res.userKeys) return;
  btn.classList.add("popping");
  if (typeof Sfx !== "undefined" && Sfx.click) Sfx.click();
  await new Promise((r) => setTimeout(r, 380));
  setVaultPopped(popped + 1);
  renderPadlocks();
  if (popped + 1 >= need) openVault();
}

async function openVault() {
  const frame = document.querySelector("#vault-locked .vault-card-frame");
  try {
    if (frame) frame.classList.add("vault-unlocking");
    const res = await API.openVault(Session.userId);
    setVaultPopped(0);
    Toast.success(`&#127881; La cage s'ouvre : ${res.card.name} est libre !`);
    if (typeof confetti === "function") confetti({ particleCount: 250, spread: 140, origin: { y: 0.5 } });
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    setTimeout(() => loadVault(), 1600);
  } catch (e) {
    if (frame) frame.classList.remove("vault-unlocking");
    setVaultPopped(0);
    Toast.error(e.code === "not_enough_keys" ? "Pas assez de clés." : e.code === "already_opened" ? "Déjà ouvert." : friendlyError(e));
    loadVault();
  }
}

// -----------------------------------------------------------------------
// Devine la carte v2 (api/src/native/guessgame.js, 2026-10-18) : 5 cartes
// par jour, 3 essais par carte (la proposition fausse disparait, le zoom
// recule, le gain baisse). Trouver une carte qu'on ne possede pas donne un
// bon de craft. La reponse n'arrive du serveur qu'une fois la manche finie.
// -----------------------------------------------------------------------
let guessBusy = false;
let guessData = null;
let guessRound = null;

function renderGuess(data) {
  guessData = data;
  if (!data.rounds || !data.rounds.length) { document.getElementById("guess-choices").innerHTML = `<div class="empty-state">Jeu indisponible pour le moment.</div>`; return; }
  if (guessRound == null || !data.rounds[guessRound]) { const next = data.rounds.find((r) => !r.done); guessRound = next ? next.index : 0; }
  const r = data.rounds[guessRound];
  const img = document.getElementById("guess-img");
  img.src = API.imageUrl(r.imageId) || "";
  const frame = document.getElementById("guess-frame");
  const z = r.zoom || { scale: 3, x: 50, y: 50 };
  img.style.transformOrigin = `${z.x}% ${z.y}%`;
  img.style.transform = r.done ? "scale(1)" : `scale(${z.scale})`;
  frame.classList.toggle("revealed", !!r.done);
  // Loupe : le zoom recule a chaque erreur.
  const zb = document.getElementById("guess-zoom");
  if (zb) { zb.hidden = !!r.done; zb.innerHTML = `&#128269; ×${String(Math.round((z.scale || 1) * 10) / 10).replace(".", ",")}`; }

  const next = data.boosterEvery - ((data.streak || 0) % data.boosterEvery);
  document.getElementById("guess-rounds").innerHTML = `<div class="guess-rounds">${data.rounds.map((x) => `<button type="button" class="guess-round ${x.index === guessRound ? "active" : ""} ${x.done ? (x.correct ? "win" : "lose") : ""}" data-guess-round="${x.index}" aria-label="Carte ${x.index + 1}">${x.done ? (x.correct ? "&#10004;" : "&#10008;") : x.index + 1}</button>`).join("")}</div>`;
  document.getElementById("guess-streak").innerHTML = `
    <span>&#128293; Série : <strong>${data.streak || 0}</strong> jour${(data.streak || 0) > 1 ? "s" : ""} · ${data.found} / ${data.rounds.length} trouvée${data.found > 1 ? "s" : ""} aujourd'hui</span>
    <span class="guess-streak-next">${data.streakMin} bonnes réponses par jour gardent la série · jeton booster dans ${next} jour${next > 1 ? "s" : ""} de série</span>`;

  const box = document.getElementById("guess-choices");
  box.innerHTML = r.choices.map((c) => {
    const cls = r.done ? (c.cardId === r.answerCardId ? "right" : c.wrong ? "wrong" : "") : c.wrong ? "wrong" : "";
    return `<button type="button" class="guess-choice ${cls}" data-card-id="${c.cardId}" ${r.done || c.wrong ? "disabled" : ""}><span class="gc-letter" aria-hidden="true">${"ABCD"[r.choices.indexOf(c)] || ""}</span><span class="gc-name">${escHtml(c.name)}</span></button>`;
  }).join("") + (r.done ? "" : `<div class="guess-tries">${"&#10084;&#65039;".repeat(r.triesLeft)}${"&#129293;".repeat(3 - r.triesLeft)} <small>${r.triesLeft} essai${r.triesLeft > 1 ? "s" : ""}</small></div>`);
  renderGuessGain(data, r);

  const res = document.getElementById("guess-result");
  const parts = [];
  if (r.done) parts.push(r.correct ? `&#127881; C'était bien <strong>${escHtml(r.answerName)}</strong> !` : `C'était <strong>${escHtml(r.answerName)}</strong>.`);
  if (data.finished) parts.push(`<div class="guess-next">Journée terminée : ${data.found} / ${data.rounds.length}. Nouvelles cartes demain !</div>`);
  else if (r.done) { const n = data.rounds.find((x) => !x.done); if (n) parts.push(`<button type="button" class="btn-secondary" data-guess-round="${n.index}">Carte suivante &rarr;</button>`); }
  if (data.coupons && data.coupons.length) parts.push(`<div class="guess-coupons"><strong>&#127915; Bons de craft (−${data.couponPct} %)</strong> ${data.coupons.map((c) => `<a href="collection.html#crafter" title="Valable jusqu'au ${new Date(c.until * 1000).toLocaleDateString("fr-FR")}">${escHtml(c.name)}</a>`).join(" · ")}</div>`);
  res.style.display = parts.length ? "block" : "none";
  res.className = `guess-result ${r.done ? (r.correct ? "win" : "lose") : ""}`;
  res.innerHTML = parts.join("");
}

// Gain possible de la carte (2026-10-19) : affiche des le debut, il descend
// en direct (compteur anime) a chaque erreur.
let guessGainShown = null;
function renderGuessGain(data, r) {
  const frame = document.getElementById("guess-frame");
  if (!frame || !data.gains) return;
  let el = document.getElementById("guess-gain");
  if (!el) { el = document.createElement("div"); el.id = "guess-gain"; el.className = "guess-gain"; frame.after(el); }
  const g = data.gains;
  const target = r.potential != null ? r.potential : g.base;
  const label = r.done ? (r.correct ? "Gagné" : "Consolation") : "Gain possible";
  const steps = g.mult.map((m, i) => `<span class="gg-step ${!r.done && i === 3 - r.triesLeft ? "on" : ""} ${!r.done && i < 3 - r.triesLeft ? "lost" : ""}">${Math.round(g.base * m)}</span>`).join("");
  const dayLeft = data.rounds.filter((x) => !x.done).reduce((t, x) => t + (x.potential || 0), 0) + data.rounds.filter((x) => x.done).reduce((t, x) => t + (x.potential || 0), 0);
  el.className = `guess-gain ${r.done ? (r.correct ? "won" : "lost") : ""}`;
  el.innerHTML = `<div class="gg-main"><small>${label}</small><strong><span class="gg-num">${guessGainShown != null && guessGainShown.round === r.index ? guessGainShown.value : target}</span> &#10024;</strong></div>
    ${r.done ? "" : `<div class="gg-steps" title="1er essai, 2e essai, 3e essai">${steps}</div>`}
    <div class="gg-day">Aujourd'hui : jusqu'à ${fmtNum(dayLeft + (data.finished ? 0 : g.perfect))} &#10024;${g.finishCoins ? ` + ${g.finishCoins} ${resIcon("coin")}` : ""}${g.perfect ? ` <span title="Toutes les cartes trouvées du premier coup">(dont ${fmtNum(g.perfect)} si journée parfaite)</span>` : ""}</div>`;
  const num = el.querySelector(".gg-num");
  const from = guessGainShown && guessGainShown.round === r.index ? guessGainShown.value : target;
  guessGainShown = { round: r.index, value: target };
  if (from !== target) {
    // Le gain fond sous les yeux du joueur.
    el.classList.add("gg-drop");
    const t0 = performance.now(), dur = 700;
    const step = (now) => { const p = Math.min(1, (now - t0) / dur); num.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); else el.classList.remove("gg-drop"); };
    requestAnimationFrame(step);
  }
}

async function loadGuess() {
  try {
    renderGuess(await API.guessCard(Session.userId, "status"));
  } catch (e) {
    document.getElementById("guess-choices").innerHTML = `<div class="empty-state">Jeu indisponible pour le moment.</div>`;
  }
}

async function submitGuess(cardId) {
  if (guessBusy || guessRound == null) return;
  guessBusy = true;
  try {
    const res = await API.post("guessCard", { userId: Session.userId, action: "guess", round: guessRound, cardId });
    renderGuess(res);
    if (typeof loadNavBadges === "function") loadNavBadges();
    const rw = res.reward || {};
    if (res.correct) Toast.success(`Bonne réponse ! +${rw.dust} poussières${rw.boosters ? " et +1 jeton booster" : ""}${rw.coins ? ` et +${rw.coins} ${resIcon("coin")}` : ""}${rw.perfect ? " (journée parfaite !)" : ""}.`);
    else if (res.done && rw.coins) Toast.info(`Journée terminée : +${rw.coins} ${resIcon("coin")} pour ta série.`);
    else if (res.done) Toast.info("Raté pour cette carte.");
    else Toast.info("Ce n'est pas ça : le zoom recule, essaie encore !");
    if (rw.coupon) setTimeout(() => Toast.success(`&#127915; Bon de craft : −${rw.coupon.pct} % sur <strong>${escHtml(rw.coupon.name)}</strong> pendant ${res.couponDays} jours !`), 400);
    if (res.correct && typeof confetti === "function") confetti({ particleCount: rw.perfect ? 200 : 70, spread: 80, origin: { y: 0.5 } });
    if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
  } catch (e) {
    Toast.error(e.code === "already_played" ? "Carte déjà jouée." : friendlyError(e));
    loadGuess();
  } finally {
    guessBusy = false;
  }
}
