// Admin > Difficultes (2026-10-16) : recapitulatif de TOUTES les regles par
// mode de jeu (bonus, malus, fonctionnalites exclusives), un interrupteur par
// regle, tout activer / desactiver par mode, reglages chiffres du mode et
// fonctionnalites fermees. Donnees : api/src/native/moderules.js.

(function () {
  const esc = escHtml;
  const KIND = { bonus: { label: "Bonus", cls: "bonus" }, malus: { label: "Malus", cls: "malus" }, extra: { label: "Exclusivité", cls: "extra" } };
  let state = null;
  let open = null; // mode deplie

  const fmtVal = (v) => (typeof v === "number" ? (v > 0 && v < 1 ? Math.round(v * 100) + " %" : v.toLocaleString("fr-FR")) : v === true ? "oui" : v === false ? "non" : esc(String(v)));

  function ruleRow(r) {
    const k = KIND[r.kind] || KIND.extra;
    return `
      <li class="amr-rule ${r.on ? "" : "is-off"}">
        <span class="amr-rule-icon" aria-hidden="true">${r.icon}</span>
        <div class="amr-rule-text">
          <strong>${esc(r.label)}</strong>${r.isNew ? ' <span class="amr-new">nouveau</span>' : ""} <span class="amr-kind amr-kind-${k.cls}">${k.label}</span>
          <p>${esc(r.desc)}</p>
        </div>
        <label class="amr-switch" title="${r.on ? "Désactiver" : "Activer"}">
          <input type="checkbox" data-rule="${r.key}" ${r.on ? "checked" : ""} aria-label="${esc(r.label)}" />
          <span class="amr-slider" aria-hidden="true"></span>
        </label>
      </li>`;
  }

  function modeCard(m) {
    const on = m.rules.filter((r) => r.on).length;
    const expanded = open === m.key;
    return `
      <section class="amr-mode ${m.current ? "is-current" : ""}" data-mode="${m.key}">
        <header class="amr-mode-head">
          <button type="button" class="amr-toggle" data-open="${m.key}" aria-expanded="${expanded}">
            <span class="amr-mode-icon" aria-hidden="true">${m.icon}</span>
            <span class="amr-mode-title"><strong>${esc(m.label)}</strong>${m.current ? ' <span class="amr-current">mode en cours</span>' : ""}<small>${esc(m.desc)}</small></span>
            <span class="amr-count">${on} / ${m.rules.length} règles actives</span>
          </button>
          <div class="amr-mode-actions">
            <button type="button" class="btn-ghost" data-bulk="${m.key}" data-on="1">Tout activer</button>
            <button type="button" class="btn-ghost" data-bulk="${m.key}" data-on="0">Tout désactiver</button>
            ${m.current ? "" : `<button type="button" class="btn-secondary" data-apply="${m.key}">Passer en ${esc(m.label)}</button>`}
          </div>
        </header>
        <div class="amr-mode-body" ${expanded ? "" : "hidden"}>
          <ul class="amr-rules">${m.rules.map(ruleRow).join("")}</ul>
          <div class="amr-extra">
            <details>
              <summary>&#128290; Réglages chiffrés du mode (${m.presets.length})</summary>
              <div class="table-scroll"><table class="admin-table amr-presets"><tbody>${m.presets.map((p) => `<tr><td>${esc(p.label)}</td><td class="num">${fmtVal(p.value)}</td></tr>`).join("")}</tbody></table></div>
              <p class="muted">Appliqués d'un coup quand on passe dans ce mode (Économie &rarr; Mode de jeu).</p>
            </details>
            <div class="amr-closed">
              <strong>&#128683; Fermé dans ce mode :</strong>
              ${m.closed.length ? m.closed.map((f) => `<span class="amr-chip">${f.icon} ${esc(f.label)}</span>`).join("") : '<span class="muted">rien</span>'}
              <a href="#economie" class="amr-link" data-goto="economie">modifier</a>
            </div>
          </div>
        </div>
      </section>`;
  }

  function render() {
    const box = document.getElementById("modes-admin-zone");
    if (!box || !state) return;
    box.classList.remove("empty-state");
    const total = state.modes.reduce((s, m) => s + m.rules.length, 0);
    const on = state.modes.reduce((s, m) => s + m.rules.filter((r) => r.on).length, 0);
    box.innerHTML = `
      <div class="amr-summary">
        <span><strong>${on}</strong> / ${total} règles actives</span>
        <div class="amr-legend"><span class="amr-kind amr-kind-bonus">Bonus</span><span class="amr-kind amr-kind-malus">Malus</span><span class="amr-kind amr-kind-extra">Exclusivité</span><span class="amr-new">nouveau</span></div>
        <button type="button" class="btn-ghost" id="amr-reset">Tout réactiver</button>
      </div>
      ${state.modes.map(modeCard).join("")}`;
  }

  async function call(action, params = {}, okMsg = "") {
    try {
      state = await API.post("adminModeRules", { discordId: Session.discordId, action, ...params });
      if (!open) open = state.current;
      render();
      if (okMsg) Toast.success(okMsg);
    } catch (err) {
      Toast.error("Difficultés : " + friendlyError(err));
      render();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const box = document.getElementById("modes-admin-zone");
    if (!box) return;
    const load = () => call("status");
    if (typeof AdminNav !== "undefined" && AdminNav.onFirstShow) AdminNav.onFirstShow("modes", load); else load();
    box.addEventListener("change", (e) => {
      const cb = e.target.closest("[data-rule]");
      if (cb) call("set", { key: cb.dataset.rule, on: cb.checked }, cb.checked ? "Règle activée." : "Règle désactivée.");
    });
    box.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-open],[data-bulk],[data-apply],#amr-reset,[data-goto]");
      if (!t) return;
      if (t.dataset.open) { open = open === t.dataset.open ? null : t.dataset.open; render(); return; }
      if (t.dataset.goto) { e.preventDefault(); if (typeof AdminNav !== "undefined") AdminNav.show(t.dataset.goto); return; }
      if (t.id === "amr-reset") {
        if (await Confirm.show("Réactiver toutes les règles de tous les modes ?", { title: "Tout réactiver", confirmText: "Réactiver" })) call("reset", {}, "Toutes les règles sont actives.");
        return;
      }
      if (t.dataset.bulk) {
        const on = t.dataset.on === "1";
        const m = state.modes.find((x) => x.key === t.dataset.bulk);
        if (!on && !(await Confirm.show(`Désactiver les ${m.rules.length} règles du mode ${esc(m.label)} ? Le mode gardera ses réglages chiffrés (prix, boosters…).`, { title: "Tout désactiver", confirmText: "Désactiver" }))) return;
        open = t.dataset.bulk;
        call("mode", { mode: t.dataset.bulk, on }, on ? "Toutes les règles du mode sont actives." : "Règles du mode désactivées.");
        return;
      }
      if (t.dataset.apply) {
        const m = state.modes.find((x) => x.key === t.dataset.apply);
        if (!(await Confirm.show(`Passer le serveur en mode <strong>${esc(m.label)}</strong> maintenant ? Ses réglages chiffrés sont appliqués d'un coup et ses règles actives prennent effet.`, { title: "Changer de mode", confirmText: `Passer en ${esc(m.label)}` }))) return;
        try {
          await API.adminPreset(Session.discordId, "apply", { preset: m.key, announce: true });
          open = m.key;
          await call("status", {}, `Mode ${m.label} appliqué.`);
        } catch (err) { Toast.error(friendlyError(err)); }
      }
    });
  });
})();
