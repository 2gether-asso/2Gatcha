// Admin > Planning (Admin V2, 2026-11-07) : regles du planificateur
// semi-automatique (api/src/native/admin-v2.js). Modeles en un clic (boss du
// lundi, week-end bonus, code du vendredi, annonce), formulaire par type,
// apercu des 5 prochains passages, lancer maintenant, activer / desactiver,
// valider ou passer une regle en attente.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const REPEAT = { once: "Une fois", daily: "Chaque jour", weekly: "Chaque semaine", monthly: "Chaque mois" };
  const KIND = { boss: { icon: "💀", label: "Boss communautaire" }, event: { icon: "🎉", label: "Événement (bonus)" }, code: { icon: "🎫", label: "Code à distribuer" }, discord: { icon: "📢", label: "Annonce Discord" } };
  let rules = [];
  let editing = null;

  // Prochain jour de semaine (0 = dimanche) a l'heure donnee, heure locale.
  function nextWeekday(day, hour) {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    let add = (day - d.getDay() + 7) % 7;
    if (add === 0 && d.getTime() <= Date.now()) add = 7;
    d.setDate(d.getDate() + add);
    return Math.floor(d.getTime() / 1000);
  }
  const TEMPLATES = [
    { key: "boss", icon: "💀", label: "Boss chaque lundi", rule: () => ({ kind: "boss", label: "Boss de la semaine", repeat: "weekly", nextAt: nextWeekday(1, 10), approval: false, config: { names: "Kraken des abysses, Golem de cristal, Dragon d'ombre, Hydre dorée", hp: 3000, hpPerPlayer: 400, rewardBoosters: 2, onlyIfNone: true } }) },
    { key: "weekend", icon: "🎉", label: "Week-end bonus (à valider)", rule: () => ({ kind: "event", label: "Week-end étoilé", repeat: "weekly", nextAt: nextWeekday(5, 18), approval: true, config: { label: "Week-end étoilé : poussières ×2", hours: 54, dust: 2, finish: 1.5, fishingRare: 1, worms: 1.5 } }) },
    { key: "code", icon: "🎫", label: "Code du vendredi", rule: () => ({ kind: "code", label: "Code du vendredi", repeat: "weekly", nextAt: nextWeekday(5, 17), approval: false, config: { prefix: "VENDREDI", label: "Le code du vendredi", hours: 24, maxRedemptions: 0, announce: true, rewards: [{ type: "resource", key: "booster", n: 3 }] } }) },
    { key: "discord", icon: "📢", label: "Rappel Discord", rule: () => ({ kind: "discord", label: "Rappel du dimanche", repeat: "weekly", nextAt: nextWeekday(0, 18), approval: true, config: { title: "Dernier jour de la semaine !", text: "Pensez à finir vos quêtes de la semaine et à attaquer le boss 💀" } }) },
    { key: "blank", icon: "➕", label: "Règle vide", rule: () => ({ kind: "boss", label: "", repeat: "once", nextAt: Math.floor(Date.now() / 1000) + 3600, approval: false, config: {} }) }
  ];

  const toLocal = (s) => { const d = new Date((s || Date.now() / 1000) * 1000); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fromLocal = (v) => Math.floor(new Date(v).getTime() / 1000);
  const when = (s) => s ? new Date(s * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  function nextAfter(at, repeat) {
    if (repeat === "daily") return at + 86400;
    if (repeat === "weekly") return at + 7 * 86400;
    if (repeat === "monthly") { const d = new Date(at * 1000); d.setMonth(d.getMonth() + 1); return Math.floor(d.getTime() / 1000); }
    return 0;
  }
  function previewOf(at, repeat) { const out = []; let n = at; for (let i = 0; i < 5 && n; i++) { out.push(n); if (repeat === "once") break; n = nextAfter(n, repeat); } return out; }

  // ------------------------------------------------------------ liste
  function renderList() {
    const box = $("apl-list");
    if (!box) return;
    if (!rules.length) { box.innerHTML = `<p class="muted">Aucune règle pour l'instant : pars d'un modèle ci-dessus.</p>`; return; }
    box.innerHTML = rules.map((r) => {
      const k = KIND[r.kind] || { icon: "•", label: r.kind };
      const state = r.pendingAt ? `<span class="adm-chip warn">en attente depuis ${when(r.pendingAt)}</span>` : !r.active ? `<span class="adm-chip">en pause</span>` : r.nextAt ? `<span class="adm-chip on">prochain : ${when(r.nextAt)}</span>` : `<span class="adm-chip">terminée</span>`;
      return `<article class="apl-rule ${r.active ? "" : "off"} ${r.pendingAt ? "pending" : ""}" data-id="${r.id}">
        <div class="apl-rule-main">
          <div class="apl-rule-title"><span class="apl-ico" aria-hidden="true">${k.icon}</span><strong>${esc(r.label)}</strong><small class="muted">${k.label} · ${REPEAT[r.repeat] || r.repeat}${r.approval ? " · à valider" : " · automatique"}</small></div>
          <div class="apl-rule-meta">${state}${r.runs ? `<span class="muted">${r.runs} passage${r.runs > 1 ? "s" : ""}</span>` : ""}${r.lastRunAt ? `<span class="muted" title="${esc(r.lastResult)}">dernier : ${when(r.lastRunAt)} — ${esc(r.lastResult)}</span>` : ""}</div>
        </div>
        <div class="apl-rule-tools">
          ${r.pendingAt ? `<button type="button" class="btn" data-apl="approve">Lancer</button><button type="button" class="btn-ghost" data-apl="skip">Passer</button>` : `<button type="button" class="btn-secondary" data-apl="run" title="Lancer tout de suite (la date prévue avance ensuite)">&#9654; Maintenant</button>`}
          <button type="button" class="btn-ghost" data-apl="edit">Modifier</button>
          <button type="button" class="btn-ghost" data-apl="toggle">${r.active ? "Pause" : "Reprendre"}</button>
          <button type="button" class="btn-ghost danger" data-apl="delete" aria-label="Supprimer ${esc(r.label)}">&#128465;</button>
        </div>
      </article>`;
    }).join("");
  }

  // ------------------------------------------------------------ formulaire
  const field = (id, label, input, help = "") => `<label class="apl-field" for="${id}"><span>${label}</span>${input}${help ? `<small class="muted">${help}</small>` : ""}</label>`;
  const num = (id, v, step = 1, min = 0) => `<input type="number" id="${id}" value="${v ?? ""}" step="${step}" min="${min}" />`;
  const txt = (id, v, ph = "") => `<input type="text" id="${id}" value="${esc(v ?? "")}" placeholder="${esc(ph)}" />`;
  const rewardN = (cfg, key) => { const l = (cfg.rewards || []).find((x) => x.type === "resource" && x.key === key); return l ? l.n : ""; };
  function kindFields(kind, cfg) {
    if (kind === "boss") return field("apl-names", "Noms (à tour de rôle)", txt("apl-names", cfg.names, "Kraken, Golem…"), "Séparés par des virgules : un nom différent à chaque passage.")
      + field("apl-hp", "PV minimum", num("apl-hp", cfg.hp ?? 3000, 100))
      + field("apl-hpp", "PV par joueur actif (7 j)", num("apl-hpp", cfg.hpPerPlayer ?? 0, 50), "Le boss s'adapte au nombre de joueurs : le plus grand des deux.")
      + field("apl-rb", "Boosters de récompense", num("apl-rb", cfg.rewardBoosters ?? 2))
      + `<label class="apl-check"><input type="checkbox" id="apl-only" ${cfg.onlyIfNone !== false ? "checked" : ""} /> Seulement si aucun boss n'est en vie (sinon il le remplace)</label>`;
    if (kind === "event") return field("apl-elabel", "Nom affiché", txt("apl-elabel", cfg.label, "Week-end étoilé"))
      + field("apl-hours", "Durée (heures)", num("apl-hours", cfg.hours ?? 48, 1, 1))
      + field("apl-dust", "Poussières ×", num("apl-dust", cfg.dust ?? 2, 0.1, 1))
      + field("apl-finish", "Finitions ×", num("apl-finish", cfg.finish ?? 1, 0.1, 1))
      + field("apl-fish", "Pêche rare ×", num("apl-fish", cfg.fishingRare ?? 1, 0.1, 1))
      + field("apl-worms", "Vers ×", num("apl-worms", cfg.worms ?? 1, 0.1, 1));
    if (kind === "code") return field("apl-prefix", "Début du code", txt("apl-prefix", cfg.prefix, "VENDREDI"), "Le code devient VENDREDI-1107 (la date du jour).")
      + field("apl-clabel", "Libellé", txt("apl-clabel", cfg.label))
      + field("apl-chours", "Valable (heures)", num("apl-chours", cfg.hours ?? 24, 1, 1))
      + field("apl-max", "Joueurs max (0 = illimité)", num("apl-max", cfg.maxRedemptions ?? 0))
      + field("apl-rbo", "🃏 Jetons booster", num("apl-rbo", rewardN(cfg, "booster")))
      + field("apl-rdu", "✨ Poussières", num("apl-rdu", rewardN(cfg, "dust"), 10))
      + field("apl-rke", "🔑 Clés", num("apl-rke", rewardN(cfg, "key")))
      + field("apl-rch", "🪙 Pièces de gatchapon", num("apl-rch", rewardN(cfg, "chest")))
      + `<label class="apl-check"><input type="checkbox" id="apl-announce" ${cfg.announce !== false ? "checked" : ""} /> Publier le code dans le calendrier et sur Discord</label>`;
    return field("apl-title", "Titre", txt("apl-title", cfg.title))
      + field("apl-text", "Message", `<textarea id="apl-text" rows="4">${esc(cfg.text || "")}</textarea>`);
  }
  function readConfig(kind) {
    const v = (id) => $(id) ? $(id).value : "";
    const n = (id) => Number(v(id)) || 0;
    if (kind === "boss") return { names: v("apl-names").trim(), hp: n("apl-hp"), hpPerPlayer: n("apl-hpp"), rewardBoosters: n("apl-rb"), onlyIfNone: $("apl-only").checked };
    if (kind === "event") return { label: v("apl-elabel").trim(), hours: n("apl-hours"), dust: n("apl-dust"), finish: n("apl-finish"), fishingRare: n("apl-fish"), worms: n("apl-worms") };
    if (kind === "code") {
      const rewards = [["booster", "apl-rbo"], ["dust", "apl-rdu"], ["key", "apl-rke"], ["chest", "apl-rch"]].filter(([, id]) => n(id) > 0).map(([key, id]) => ({ type: "resource", key, n: n(id) }));
      // Autres lignes deja presentes (cartes, cosmetiques...) : gardees telles quelles.
      const others = ((editing && editing.config && editing.config.rewards) || []).filter((l) => !(l.type === "resource" && ["booster", "dust", "key", "chest"].includes(l.key)));
      return { prefix: v("apl-prefix").trim(), label: v("apl-clabel").trim(), hours: n("apl-chours"), maxRedemptions: n("apl-max"), announce: $("apl-announce").checked, rewards: [...rewards, ...others] };
    }
    return { title: v("apl-title").trim(), text: v("apl-text").trim() };
  }
  function renderForm() {
    const zone = $("apl-form-zone");
    if (!zone) return;
    if (!editing) { zone.innerHTML = ""; return; }
    const r = editing;
    zone.innerHTML = `<form class="apl-form" id="apl-form">
      <h3>${r.id ? "Modifier la règle" : "Nouvelle règle"}</h3>
      <div class="apl-grid">
        ${field("apl-kind", "Type", `<select id="apl-kind">${Object.entries(KIND).map(([k, x]) => `<option value="${k}" ${k === r.kind ? "selected" : ""}>${x.icon} ${x.label}</option>`).join("")}</select>`)}
        ${field("apl-label", "Nom de la règle", txt("apl-label", r.label, "Boss de la semaine"))}
        ${field("apl-at", "Premier passage", `<input type="datetime-local" id="apl-at" value="${toLocal(r.nextAt)}" />`)}
        ${field("apl-repeat", "Répétition", `<select id="apl-repeat">${Object.entries(REPEAT).map(([k, x]) => `<option value="${k}" ${k === r.repeat ? "selected" : ""}>${x}</option>`).join("")}</select>`)}
      </div>
      <label class="apl-check"><input type="checkbox" id="apl-approval" ${r.approval ? "checked" : ""} /> <strong>À valider</strong> : à l'heure prévue, la règle t'attend sur le tableau de bord (« Lancer » ou « Passer ») au lieu de partir seule.</label>
      <div class="apl-grid" id="apl-kind-fields">${kindFields(r.kind, r.config || {})}</div>
      <p class="apl-preview" id="apl-preview"></p>
      <div class="apl-actions"><button type="button" class="btn-ghost" data-apl-cancel>Annuler</button><button type="submit" class="btn">Enregistrer</button></div>
    </form>`;
    const paintPreview = () => { const list = previewOf(fromLocal($("apl-at").value), $("apl-repeat").value); $("apl-preview").innerHTML = list.length ? `Passages : ${list.map(when).join(" · ")}${$("apl-repeat").value !== "once" ? " …" : ""}` : ""; };
    $("apl-kind").addEventListener("change", (e) => { editing = { ...editing, kind: e.target.value, config: {} }; $("apl-kind-fields").innerHTML = kindFields(e.target.value, {}); });
    $("apl-at").addEventListener("input", paintPreview);
    $("apl-repeat").addEventListener("change", paintPreview);
    paintPreview();
    zone.querySelector("[data-apl-cancel]").addEventListener("click", () => { editing = null; renderForm(); });
    $("apl-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const kind = $("apl-kind").value;
      const rule = { id: r.id || undefined, kind, label: $("apl-label").value.trim(), nextAt: fromLocal($("apl-at").value), repeat: $("apl-repeat").value, approval: $("apl-approval").checked, active: r.active !== false, config: readConfig(kind) };
      const btn = e.submitter || zone.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const res = await API.adminPlanner(Session.discordId, "save", { rule });
        rules = res.rules || [];
        editing = null;
        renderForm(); renderList();
        Toast.success("Règle enregistrée.");
        document.dispatchEvent(new CustomEvent("planner:changed"));
      } catch (err) {
        btn.disabled = false;
        Toast.error({ invalid_rewards: "Récompenses du code invalides (au moins une ligne).", empty_message: "Le message est vide.", invalid_date: "Date invalide." }[err.code] || friendlyError(err));
      }
    });
    zone.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function act(action, id, btn) {
    const r = rules.find((x) => x.id === id);
    if (!r) return;
    if (action === "edit") { editing = JSON.parse(JSON.stringify(r)); renderForm(); return; }
    if (action === "delete" && !(await Confirm.show(`Supprimer la règle « ${esc(r.label)} » ?`, { title: "Supprimer ?", confirmText: "Supprimer" }))) return;
    if (action === "run" && !(await Confirm.show(`Lancer « ${esc(r.label)} » tout de suite ?`, { title: "Lancer maintenant ?", confirmText: "Lancer" }))) return;
    if (btn) btn.disabled = true;
    try {
      const res = action === "toggle"
        ? await API.adminPlanner(Session.discordId, "save", { rule: { ...r, active: !r.active } })
        : await API.adminPlanner(Session.discordId, action, { id });
      rules = res.rules || [];
      renderList();
      if (res.result) { if (res.result.error) Toast.error(esc(res.result.text)); else Toast.success(esc(res.result.text)); }
      else if (action === "skip") Toast.info("Passé : rendez-vous au prochain passage.");
      document.dispatchEvent(new CustomEvent("planner:changed"));
    } catch (e) { if (btn) btn.disabled = false; Toast.error(friendlyError(e)); }
  }

  async function load() {
    try { rules = (await API.adminPlanner(Session.discordId, "list")).rules || []; }
    catch (e) { $("apl-list").innerHTML = `<p class="error-box">Planning indisponible : ${esc(friendlyError(e))} (API pas encore déployée ?)</p>`; return; }
    renderList();
  }

  window.AdminPlanner = { newFrom(key) { const t = TEMPLATES.find((x) => x.key === key) || TEMPLATES[TEMPLATES.length - 1]; AdminNav.show("planning"); editing = t.rule(); setTimeout(renderForm, 60); } };
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("pane-planning") || typeof AdminNav === "undefined") return;
    $("apl-templates").innerHTML = `<span class="muted">Partir d'un modèle :</span>` + TEMPLATES.map((t) => `<button type="button" class="adm-shortcut" data-apl-tpl="${t.key}"><span aria-hidden="true">${t.icon}</span>${esc(t.label)}</button>`).join("");
    $("apl-templates").addEventListener("click", (e) => { const b = e.target.closest("[data-apl-tpl]"); if (b) { editing = TEMPLATES.find((t) => t.key === b.dataset.aplTpl).rule(); renderForm(); } });
    $("apl-list").addEventListener("click", (e) => { const b = e.target.closest("[data-apl]"); if (b) act(b.dataset.apl, Number(b.closest("[data-id]").dataset.id), b); });
    AdminNav.onFirstShow("planning", load);
    document.addEventListener("planner:changed", () => { if (AdminNav.shown.has("planning")) load(); });
  });
})();
