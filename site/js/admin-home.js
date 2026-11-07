// Tableau de bord de l'admin (V2, 2026-11-07 ; vue d'ensemble depuis le
// 2026-10-11). Tous les indicateurs utiles en une lecture, chacun menant a sa
// rubrique : joueurs (actifs, nouveaux, en direct), boosters ouverts sur 7
// jours, economie du jour, mode de jeu et recommandation, sante du serveur,
// boss, evenement / surprise, codes actifs ; puis les actions planifiees a
// valider, ce qui arrive bientot et les points d'attention.
// Donnees : POST admin-dashboard (api/src/native/admin-v2.js) + les lectures
// d'avant (mode recommande, inflation, journal des boosters).

(function () {
  const esc = escHtml;
  const fr = (n, d = 1) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: d });
  const settle = (p) => p.then((v) => v, () => null);
  const PRESET_LABEL = { cool: "😎 Cool", chill: "🌴 Chill", medium: "⚖️ Medium", hard: "🔥 Hard", chaos: "👾 Chaos", custom: "Personnalisé" };
  const when = (s) => s ? new Date(s * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  const dur = (sec) => { sec = Number(sec) || 0; const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60); return d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };
  const KIND_ICON = { boss: "💀", event: "🎉", code: "🎫", discord: "📢" };

  function spark(values) {
    const max = Math.max(1, ...values);
    return `<span class="adm-spark" aria-hidden="true">${values.map((v) => `<i style="height:${Math.max(6, Math.round((v / max) * 100))}%"></i>`).join("")}</span>`;
  }
  const tile = (t) => `<button type="button" class="adm-tile ${t.tone || ""}" data-goto="${t.goto}"${t.focus ? ` data-focus="${t.focus}"` : ""}>
    <span class="adm-tile-k">${t.k}</span><strong class="adm-tile-v">${t.v}</strong>${t.s ? `<small>${t.s}</small>` : ""}${t.extra || ""}</button>`;

  async function render() {
    const box = document.getElementById("adm-overview");
    if (!box) return;
    const d = Session.discordId;
    const [dash, preset, eco, log, config] = await Promise.all([
      settle(API.adminDashboard(d)), settle(API.adminPreset(d)), settle(API.getEconomyState()),
      settle(API.adminEconomyLog(d, { boostersOnly: true, limit: 10 })), settle(API.adminGetConfig(d))
    ]);
    const rec = preset && preset.recommendation;
    const g = dash ? dash.game : null;
    const tiles = dash ? [
      { goto: "joueurs", k: "Joueurs actifs (24 h)", v: fr(dash.players.active24h, 0), s: `${dash.players.active7d} sur 7 j · ${dash.players.total} inscrits · +${dash.players.new7d} nouveaux (7 j)`, extra: dash.players.live ? `<span class="adm-live">● ${dash.players.live} en direct</span>` : "" },
      { goto: "economie", k: "Exemplaires obtenus aujourd'hui", v: fr(dash.pulls.today, 0), s: "7 derniers jours", extra: spark(dash.pulls.days.map((x) => x.n)) },
      { goto: "economie", k: "Économie du jour", v: `+${fr(dash.economy.today.boostersIn, 0)} 🃏`, s: `${fr(dash.economy.today.boostersOut, 0)} ouverts · +${fr(dash.economy.today.dustIn, 0)} / −${fr(dash.economy.today.dustOut, 0)} ✨ · hier +${fr(dash.economy.yesterday.boostersIn, 0)} 🃏` },
      { goto: "economie", k: "Mode de jeu", v: preset ? PRESET_LABEL[preset.current] || esc(g.mode) : esc(g.mode || "—"), s: rec ? `Recommandé : ${PRESET_LABEL[rec.key]} · ${fr(rec.perDay)} boosters / actif / jour (cible ${rec.target ? rec.target.target : 40})` : "", tone: rec && preset.current !== rec.key ? "warn" : "" },
      { goto: "sante", k: "Serveur", v: `${fr(dash.health.p50, 0)} ms`, s: `médiane · 95 % ${fr(dash.health.p95, 0)} ms · ${fr(dash.health.requests, 0)} req./h · ${dash.health.memoryMb} Mo · en ligne ${dur(dash.health.uptimeSeconds)}`, tone: dash.health.failed ? "bad" : dash.health.p50 > 800 ? "warn" : "" },
      { goto: "contenu", k: "Boss", v: g.boss ? esc(g.boss.name) : "Aucun", s: g.boss ? `${fr(g.boss.hp, 0)} / ${fr(g.boss.maxHp, 0)} PV` : "rien en cours", tone: g.boss ? "on" : "", extra: g.boss ? `<span class="adm-hp"><i style="width:${g.boss.maxHp ? Math.round((g.boss.hp / g.boss.maxHp) * 100) : 0}%"></i></span>` : "" },
      { goto: "evenements", k: "Événement", v: g.event ? esc(g.event.label) : g.surprise ? `${g.surprise.icon || "⚡"} ${esc(g.surprise.label)}` : "Aucun", s: g.event ? `fin ${when(g.event.endsAt)}` : g.surprise ? `surprise jusqu'à ${when(g.surprise.until)}` : g.nextEvents.length ? `prochain : ${esc(g.nextEvents[0].label)} ${when(g.nextEvents[0].startAt)}` : "rien de prévu", tone: g.event || g.surprise ? "on" : "" },
      { goto: "codes", k: "Codes actifs", v: String(g.codesCount), s: g.codes.length ? g.codes.slice(0, 3).map((c) => esc(c.code)).join(", ") : "aucun code en cours" },
      { goto: "economie", k: "En circulation", v: `${fr(dash.economy.boostersHeld, 0)} 🃏`, s: `${fr(dash.economy.dustHeld, 0)} ✨ chez les joueurs${eco ? ` · inflation ${eco.tight ? "anti-inflation" : "normale"} (prix ×${fr(eco.priceFactor, 2)})` : ""}`, tone: eco && eco.tight ? "warn" : "" }
    ] : [];

    // Points d'attention : serveur (admin-v2.js) + mode recommande, maintenance, journal.
    const alerts = dash ? dash.alerts.slice() : [{ tone: "bad", goto: "sante", text: "Tableau de bord indisponible (API pas à jour ?)." }];
    if (rec && preset.current !== rec.key) alerts.unshift({ goto: "economie", tone: "warn", text: `Mode recommandé : ${PRESET_LABEL[rec.key]} (actuel : ${PRESET_LABEL[preset.current]}). ${rec.reasons.join(" · ")}` });
    if (config && config.bannerEnabled) alerts.push({ goto: "site", tone: "info", text: `Bandeau affiché : « ${esc(config.bannerMessage || "")} »` });
    if (log && log.totals.some((t) => t.source.startsWith("inconnu"))) alerts.push({ goto: "economie", tone: "bad", text: "Des boosters ont été créés par une origine inconnue : voir le journal détaillé (lignes en rouge)." });

    const pending = dash ? dash.planner.pending : [];
    const next = dash ? dash.planner.next.filter((r) => !r.pendingAt) : [];
    const sources = dash ? dash.economy.today.top.filter((t) => t.boosters || t.dust) : [];
    box.innerHTML = `
      <div class="adm-dash-head"><span class="muted">Mis à jour ${dash ? new Date(dash.at * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span><button type="button" class="btn-ghost" data-dash-refresh>&#8635; Actualiser</button></div>
      <div class="adm-tiles">${tiles.map(tile).join("")}</div>
      ${pending.length ? `<section class="adm-card adm-pending">
        <header class="adm-card-head"><h2>&#9203; À valider</h2><p>Ces actions planifiées attendent ton feu vert.</p></header>
        <ul class="adm-plan-mini">${pending.map((r) => `<li><span>${KIND_ICON[r.kind] || "•"} <strong>${esc(r.label)}</strong> <small class="muted">prévu ${when(r.pendingAt)}</small></span>
          <span><button type="button" class="btn" data-plan-act="approve" data-id="${r.id}">Lancer</button> <button type="button" class="btn-ghost" data-plan-act="skip" data-id="${r.id}">Passer</button></span></li>`).join("")}</ul>
      </section>` : ""}
      <div class="adm-dash-cols">
        <section class="adm-card">
          <header class="adm-card-head"><h2>&#128276; Points d'attention</h2></header>
          ${alerts.length ? `<ul class="adm-alerts">${alerts.map((a) => `<li class="${a.tone}"><button type="button" data-goto="${a.goto}">${a.text}<span aria-hidden="true">&#8250;</span></button></li>`).join("")}</ul>` : '<p class="muted">Tout est en ordre.</p>'}
        </section>
        <section class="adm-card">
          <header class="adm-card-head"><h2>&#128198; Prochainement</h2></header>
          ${next.length || (g && g.nextEvents.length) ? `<ul class="adm-plan-mini">
            ${next.map((r) => `<li><span>${KIND_ICON[r.kind] || "•"} ${esc(r.label)}${r.approval ? ' <small class="adm-chip">à valider</small>' : ""}</span><small class="muted">${when(r.nextAt)}</small></li>`).join("")}
            ${(g ? g.nextEvents : []).map((e) => `<li><span>🎉 ${esc(e.label)}</span><small class="muted">${when(e.startAt)}</small></li>`).join("")}
          </ul>` : `<p class="muted">Rien de programmé.</p>`}
          <button type="button" class="btn-secondary" data-goto="planning">&#128198; Ouvrir le planning</button>
        </section>
        ${sources.length ? `<section class="adm-card">
          <header class="adm-card-head"><h2>&#127873; Sources du jour</h2></header>
          <ul class="adm-plan-mini">${sources.map((s) => `<li><span>${esc(s.source)}</span><small>${s.boosters ? `+${fr(s.boosters, 0)} 🃏 ` : ""}${s.dust ? `+${fr(s.dust, 0)} ✨` : ""}</small></li>`).join("")}</ul>
        </section>` : ""}
      </div>`;
    AdminNav.badge("economie", rec && preset.current !== rec.key ? "!" : "", "warn");
    AdminNav.badge("site", config && config.maintenanceMode ? "!" : "", "bad");
    AdminNav.badge("codes", g && g.codesCount ? String(g.codesCount) : "");
    AdminNav.badge("planning", pending.length ? String(pending.length) : "", "warn");
    AdminNav.badge("accueil", alerts.some((a) => a.tone === "bad") ? "!" : "", "bad");
  }

  async function planAct(action, id, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await API.adminPlanner(Session.discordId, action, { id });
      Toast.success(action === "skip" ? "Passé : rendez-vous au prochain passage." : (r.result && r.result.text) || "Lancé.");
      render();
      document.dispatchEvent(new CustomEvent("planner:changed"));
    } catch (e) { if (btn) btn.disabled = false; Toast.error(friendlyError(e)); }
  }

  window.AdminHome = { render };
  document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("adm-overview") || typeof AdminNav === "undefined") return;
    AdminNav.onFirstShow("accueil", render);
    // Retour sur le tableau de bord : chiffres a jour.
    document.getElementById("adm-nav")?.addEventListener("click", (e) => { if (e.target.closest('[data-pane="accueil"]') && AdminNav.shown.has("accueil")) render(); });
    document.getElementById("adm-overview").addEventListener("click", (e) => {
      if (e.target.closest("[data-dash-refresh]")) { render(); return; }
      const a = e.target.closest("[data-plan-act]");
      if (a) planAct(a.dataset.planAct, Number(a.dataset.id), a);
    });
    document.addEventListener("planner:changed", () => { if (AdminNav.current !== "accueil") AdminNav.shown.has("accueil") && render(); });
    // Rafraichi toutes les 2 minutes tant que l'onglet est visible.
    setInterval(() => { if (AdminNav.current === "accueil" && document.visibilityState === "visible") render(); }, 120000);
  });
})();
