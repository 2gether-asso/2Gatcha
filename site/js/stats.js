// Mes statistiques (stats.html, 2026-10-07) : chance face a la moyenne,
// grand livre des poussieres, actions par activite, plus beaux tirages du
// mois. Voir api/src/native/insights.js.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
  const FINISH = { holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const QUALITY = { damaged: "Abîmé", worn: "Usé", good: "Bon état", mint: "Parfait état" };
  // Sources du grand livre (chemins de l'API) -> libelles.
  const SOURCES = {
    "disenchant": "&#9851;&#65039; Décraft", "craft": "&#10024; Craft", "open-pack": "&#127183; Doublons des boosters", "dig": "&#9935;&#65039; Fouille", "fishing": "&#127907; Pêche",
    "expedition": "&#129517; Expéditions", "garden": "&#127793; Jardin", "chests": "&#129520; Coffres", "daily-wheel": "&#127920; Roue", "guess-card": "&#128269; Devine la carte",
    "quests": "&#128220; Quêtes du jour", "weekly-quests": "&#128197; Quêtes de la semaine", "login-streak": "&#128293; Série de connexion", "season": "&#127942; Saison",
    "challenges": "&#127919; Défis", "community-goal": "&#129309; Objectif commun", "themes": "&#127912; Collections thématiques", "trade": "&#128260; Taxes d'échange",
    "cosmetics": "&#128717;&#65039; Cosmétiques", "booster-shop": "&#127183; Boosters achetés", "auctions": "&#128296; Enchères", "insurance": "&#128737;&#65039; Assurances",
    "talents": "&#127795; Talents", "black-market": "&#127761; Marché noir", "card-quality-repair": "&#129520; Restaurations", "foil-upgrade": "&#127752; Fusions",
    "personal-vault": "&#128274; Coffre-fort", "mastery": "&#127941; Maîtrise", "constellations": "&#127756; Constellations", "achievement-tiers": "&#127941; Maîtrises de succès",
    "daily-box": "&#127873; Boîte du jour", "evening": "&#127769; Missions du soir", "contracts": "&#128221; Contrats", "welcome-back": "&#128075; Bonus de retour",
    "reroll": "&#127922; Relances", "community-dig": "&#128506;&#65039; Grande fouille", "boss-attack": "&#128128; Boss", "level-rewards": "&#11088; Niveaux",
    "set-rewards": "&#127942; Sets complets", "redeem-code": "&#127915; Codes", "altar-sacrifice": "&#128293; Autel", "unique-counter": "&#127808; Comptoir Unique"
  };
  const ACTIVITY = {
    boosterOpened: "&#127183; Boosters ouverts", cardsPulled: "&#127183; Cartes tirées", disenchant: "&#9851;&#65039; Décrafts", craft: "&#10024; Crafts", fusion: "&#127752; Fusions",
    repair: "&#129520; Restaurations", tradeDone: "&#128260; Échanges conclus", tradeProposed: "&#128260; Échanges proposés", dig: "&#9935;&#65039; Cases creusées",
    treasure: "&#128142; Trésors", board: "&#9935;&#65039; Grilles terminées", expedition: "&#129517; Expéditions", guess: "&#128269; Cartes devinées", wheel: "&#127920; Roues",
    fish: "&#127907; Lancers", chestOpened: "&#129520; Coffres ouverts", bossAttack: "&#128128; Cartes envoyées au boss", vaultRow: "&#128274; Lignes de coffre-fort",
    harvest: "&#127793; Récoltes", communityDig: "&#128506;&#65039; Grande fouille"
  };

  const bars = (entries, label) => {
    const max = Math.max(1, ...entries.map(([, v]) => v));
    return entries.length ? entries.map(([k, v]) => `<li><span class="mystats-bar-label">${label(k)}</span><span class="mystats-bar"><span style="width:${Math.max(2, (v / max) * 100)}%"></span></span><span class="mystats-bar-num">${fmt(v)}</span></li>`).join("") : '<li class="muted">Rien pour l’instant.</li>';
  };

  function render(s) {
    $("stats-loading").style.display = "none";
    $("stats-zone").hidden = false;
    // Indice de chance significatif seulement apres une dizaine de boosters.
    const luck = s.pulls.cards >= 50 ? s.pulls.luck : null;
    $("mystats-tiles").innerHTML = [
      ["&#127808; Indice de chance", luck == null ? "–" : `${luck} %`, luck == null ? "Calculé après une dizaine de boosters" : luck >= 110 ? "Plus chanceux que la moyenne" : luck <= 90 ? "Moins chanceux que la moyenne" : "Dans la moyenne"],
      ["&#127183; Cartes tirées", fmt(s.pulls.cards), `${fmt(s.pulls.packs)} booster${s.pulls.packs > 1 ? "s" : ""}`],
      ["&#127752; Finitions spéciales", `${s.pulls.specialFinishPct} %`, `attendu ≈ ${s.pulls.specialFinishExpected} % (sans bonus)`],
      [`${s.collection.rank.icon} Valeur de collection`, fmt(s.collection.value), `${esc(s.collection.rank.label)} · ${s.collection.position}e sur ${s.collection.players}`],
      ["&#10024; Gagnées / dépensées", `${fmt(s.dust.totalEarned)} / ${fmt(s.dust.totalSpent)}`, "depuis le début du suivi"]
    ].map(([k, v, sub]) => `<div class="mystats-tile"><span>${k}</span><strong>${v}</strong><small>${sub}</small></div>`).join("");
    $("luck-note").innerHTML = s.rebuilt
      ? "Calculé à partir des cartes de boosters encore dans ta collection (les cartes décraftées ou échangées avant le suivi ne comptent pas), puis tenu à jour à chaque booster."
      : "Toutes tes cartes de boosters depuis le début du suivi. Indice de chance : part d'Épiques et mieux comparée à la moyenne attendue (100 % = pile la moyenne).";
    $("luck-table").innerHTML = `<thead><tr><th scope="col">Rareté</th><th scope="col" class="num">Cartes</th><th scope="col" class="num">Moi</th><th scope="col" class="num">Attendu</th><th scope="col">Écart</th></tr></thead><tbody>` + s.pulls.rarities.map((r) => {
      const diff = r.pct - r.expected;
      return `<tr><th scope="row"><span class="rarity-dot" style="background:${esc(r.colorHex || "#888")}"></span>${esc(r.name)}</th><td class="num">${fmt(r.count)}</td><td class="num">${r.pct} %</td><td class="num">${r.expected} %</td><td class="${diff >= 0 ? "up" : "down"}">${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pt</td></tr>`;
    }).join("") + "</tbody>";
    const sorted = (o) => Object.entries(o || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const src = (k) => SOURCES[k] || esc(k);
    $("dust-earned").innerHTML = bars(sorted(s.dust.earned).slice(0, 12), src);
    $("dust-spent").innerHTML = bars(sorted(s.dust.spent).slice(0, 12), src);
    $("activity-bars").innerHTML = bars(sorted(s.activity).filter(([k]) => ACTIVITY[k] && k !== "cardsPulled").slice(0, 12), (k) => ACTIVITY[k]);
    $("best-pulls").innerHTML = s.best.length ? s.best.map((c) => `
      <figure class="mystats-card" data-rarity="${esc(c.rarity?.key || "commune")}" style="--r:${esc(c.rarity?.colorHex || "#888")}">
        <img src="${API.imageUrl(c.imageId) || ""}" alt="" loading="lazy" />
        <figcaption><strong>${esc(c.name)}${c.starred ? " &#9733;" : ""}</strong><small>${esc(c.rarity?.name || "")}${c.finish !== "normal" ? " · " + FINISH[c.finish] : ""} · ${QUALITY[c.quality]}${c.serialNumber != null ? " · #" + String(c.serialNumber).padStart(3, "0") : ""}</small><small>valeur ${fmt(c.value)} &#10024;</small></figcaption>
      </figure>`).join("") : '<p class="muted">Aucune carte obtenue ce mois-ci pour l’instant.</p>';
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!Session.isLoggedIn()) { $("stats-loading").style.display = "none"; $("stats-guest").style.display = ""; return; }
    try { render(await API.getMyStats(Session.userId)); } catch (e) { $("stats-loading").innerHTML = `<div class="error-box">Statistiques indisponibles. (${esc(e.message)})</div>`; }
  });
})();
