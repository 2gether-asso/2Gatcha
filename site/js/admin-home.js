// Vue d'ensemble de l'admin (2026-10-11) : l'essentiel en un coup d'oeil
// (mode de jeu, boosters crees, inflation, evenement, codes, boss) et les
// points d'attention, chacun menant a la bonne rubrique.

(function () {
  const esc = escHtml;
  const fr = (n, d = 1) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: d });
  const settle = (p) => p.then((v) => v, () => null);
  const PRESET_LABEL = { cool: "😎 Cool", chill: "🌴 Chill", medium: "⚖️ Medium", hard: "🔥 Hard", chaos: "👾 Chaos", custom: "Personnalisé" };

  async function render() {
    const box = document.getElementById("adm-overview");
    if (!box) return;
    const d = Session.discordId;
    const [preset, eco, events, boss, config, season, log] = await Promise.all([
      settle(API.adminPreset(d)), settle(API.getEconomyState()), settle(API.adminEvents(d)), settle(API.getBossStatus(Session.userId)),
      settle(API.adminGetConfig(d)), settle(API.adminGetSeason(d)), settle(API.adminEconomyLog(d, { boostersOnly: true, limit: 10 }))
    ]);
    const codes = typeof codesCache !== "undefined" ? codesCache : [];
    const activeCodes = codes.filter((c) => c.status === "active");
    const rec = preset && preset.recommendation;
    const upcoming = events ? events.events.filter((e) => e.status === "upcoming") : [];
    const tiles = [
      { goto: "economie", k: "Mode de jeu", v: preset ? PRESET_LABEL[preset.current] : "—", s: rec ? `Recommandé : ${PRESET_LABEL[rec.key]}` : "", tone: rec && preset.current !== rec.key ? "warn" : "" },
      { goto: "economie", k: "Boosters / joueur actif / jour", v: rec ? fr(rec.perDay) : "—", s: rec ? `cible ${rec.target ? `${rec.target.target} (${rec.target.low} à ${rec.target.high})` : "40"} hors codes · ${rec.activePlayers} joueur${rec.activePlayers > 1 ? "s" : ""} actif${rec.activePlayers > 1 ? "s" : ""} (7 j)` : "", tone: rec && rec.target && rec.perDay > rec.target.high ? "bad" : rec && rec.target && rec.perDay < rec.target.low ? "warn" : "" },
      { goto: "economie", k: "Inflation", v: eco ? (eco.tight ? "Mode anti-inflation" : "Normale") : "—", s: eco ? `prix ×${fr(eco.priceFactor, 2)} · solde moyen ${fr(eco.avgWealth, 0)} ✨` : "", tone: eco && eco.tight ? "warn" : "" },
      { goto: "evenements", k: "Événement", v: events && events.current.active ? esc(events.current.label) : "Aucun", s: events && events.current.active && events.current.endsAt ? `fin ${new Date(events.current.endsAt * 1000).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : upcoming.length ? `${upcoming.length} à venir` : "rien de planifié", tone: events && events.current.active ? "on" : "" },
      { goto: "codes", k: "Codes actifs", v: String(activeCodes.length), s: activeCodes.length ? activeCodes.slice(0, 3).map((c) => esc(c.code)).join(", ") : "aucun code en cours" },
      { goto: "contenu", k: "Boss", v: boss && boss.active ? esc(boss.bossName) : "Aucun", s: boss && boss.active ? `${fr(boss.currentHp, 0)} / ${fr(boss.maxHp, 0)} PV` : "", tone: boss && boss.active ? "on" : "" }
    ];

    // Points d'attention.
    const alerts = [];
    if (rec && preset.current !== rec.key) alerts.push({ goto: "economie", tone: "warn", text: `Mode recommandé : ${PRESET_LABEL[rec.key]} (actuel : ${PRESET_LABEL[preset.current]}). ${rec.reasons.join(" · ")}` });
    if (config && config.maintenanceMode) alerts.push({ goto: "site", tone: "bad", text: "Le mode maintenance est actif : les joueurs ne peuvent pas accéder au site." });
    if (config && config.bannerEnabled) alerts.push({ goto: "site", tone: "info", text: `Bandeau affiché : « ${esc(config.bannerMessage || "")} »` });
    if (log && log.totals.some((t) => t.source.startsWith("inconnu"))) alerts.push({ goto: "economie", tone: "bad", text: "Des boosters ont été créés par une origine inconnue : voir le journal détaillé (lignes en rouge)." });
    if (season && season.seasons && season.seasons[1] && !season.seasons[1].card) alerts.push({ goto: "contenu", tone: "info", text: `Pas encore de carte exclusive pour la saison ${esc(season.seasons[1].label)}.` });
    if (events && !events.current.active && !upcoming.length) alerts.push({ goto: "evenements", tone: "info", text: "Aucun événement en cours ni planifié." });
    const top = log && log.totals[0];
    if (top) alerts.push({ goto: "economie", tone: "info", text: `Première source de boosters sur 7 jours : ${esc(top.source)} (${top.boosters}).` });

    box.innerHTML = `
      <div class="adm-tiles">${tiles.map((t) => `
        <button type="button" class="adm-tile ${t.tone}" data-goto="${t.goto}">
          <span class="adm-tile-k">${t.k}</span><strong class="adm-tile-v">${t.v}</strong>${t.s ? `<small>${t.s}</small>` : ""}
        </button>`).join("")}</div>
      <section class="adm-card">
        <header class="adm-card-head"><h2>&#128276; Points d'attention</h2></header>
        ${alerts.length ? `<ul class="adm-alerts">${alerts.map((a) => `<li class="${a.tone}"><button type="button" data-goto="${a.goto}">${a.text}<span aria-hidden="true">&#8250;</span></button></li>`).join("")}</ul>` : '<p class="muted">Tout est en ordre.</p>'}
      </section>`;
    AdminNav.badge("economie", rec && preset.current !== rec.key ? "!" : "", "warn");
    AdminNav.badge("site", config && config.maintenanceMode ? "!" : "", "bad");
    AdminNav.badge("codes", activeCodes.length ? String(activeCodes.length) : "");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("adm-overview") || typeof AdminNav === "undefined") return;
    AdminNav.onFirstShow("accueil", render);
    // Retour sur la vue d'ensemble : chiffres a jour.
    document.getElementById("adm-nav")?.addEventListener("click", (e) => { if (e.target.closest('[data-pane="accueil"]') && AdminNav.shown.has("accueil")) render(); });
  });
})();
