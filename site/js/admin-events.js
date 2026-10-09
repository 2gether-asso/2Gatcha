// Tableau de bord des evenements (admin, 2026-10-09) : ce qui est actif en
// ce moment (evenement, mode anti-inflation, prix indexes) et les
// evenements planifies a l'avance (api/src/native/events.js, table
// ScheduledEvents), appliques tout seuls a leurs dates.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const STATUS = { live: ["En cours", "live"], upcoming: ["À venir", "upcoming"], past: ["Terminé", "past"], off: ["Désactivé", "off"] };
  const PRESETS = {
    stars: { label: "Week-end des étoiles", dust: 2, finish: 1.5, fishing: 1, worms: 1 },
    fishing: { label: "Semaine de la pêche", dust: 1, finish: 1, fishing: 2, worms: 1.5 },
    worms: { label: "Chasse aux vers", dust: 1, finish: 1, fishing: 1, worms: 3 },
    finish: { label: "Nuit des finitions", dust: 1, finish: 2.5, fishing: 1, worms: 1 }
  };
  let events = [];

  const toLocal = (t) => { const d = new Date(t * 1000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const fromLocal = (v) => (v ? Math.floor(new Date(v).getTime() / 1000) : 0);
  const fmtDate = (t) => new Date(t * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const mults = (e) => [
    e.dustMultiplier > 1 ? `&#10024; ×${e.dustMultiplier}` : "", e.finishMultiplier > 1 ? `&#127752; finitions ×${e.finishMultiplier}` : "",
    e.fishingRare > 1 ? `&#127907; ×${e.fishingRare}` : "", e.wormsMultiplier > 1 ? `&#129713; ×${e.wormsMultiplier}` : ""
  ].filter(Boolean).join(" · ") || "aucun bonus";

  function renderNow(res, eco) {
    const c = res.current;
    $("evd-now").innerHTML = `
      <div class="evd-tile ${c.active ? "on" : ""}"><span class="evd-tile-k">Événement</span>
        <strong>${c.active ? esc(c.label) : "Aucun"}</strong>
        <small>${c.active ? `${mults(c)}${c.endsAt ? ` · fin ${fmtDate(c.endsAt)}` : ""}${c.scheduled ? " · planifié" : " · manuel"}` : "Rien d'actif en ce moment"}</small></div>
      <div class="evd-tile ${eco && eco.tight ? "warn" : ""}"><span class="evd-tile-k">Mode anti-inflation</span>
        <strong>${eco ? (eco.tight ? "Actif" : "Inactif") : "—"}</strong>
        <small>${eco ? (eco.forced === 1 ? "Forcé dans les réglages" : eco.forced === 2 ? "Désactivé dans les réglages" : eco.tight ? `Retour à la normale après ${eco.calmDays}/3 j calmes` : `${eco.alertDays} jour${eco.alertDays > 1 ? "s" : ""} d'alerte d'affilée (7 pour l'activer)`) : ""}</small></div>
      <div class="evd-tile"><span class="evd-tile-k">Prix indexés</span>
        <strong>${eco ? "×" + String(eco.priceFactor).replace(".", ",") : "—"}</strong>
        <small>${eco ? `Solde moyen des joueurs actifs : ${Number(eco.avgWealth).toLocaleString("fr-FR")} ✨` : ""}</small></div>`;
  }

  function renderList() {
    const t = Date.now() / 1000;
    const span = events.length ? [Math.min(t, ...events.map((e) => e.startAt)), Math.max(t + 86400, ...events.map((e) => e.endAt))] : null;
    const pos = (x) => (span ? ((x - span[0]) / (span[1] - span[0])) * 100 : 0);
    $("evd-list").innerHTML = events.length ? `
      <div class="evd-timeline" aria-hidden="true">
        ${events.filter((e) => e.status !== "off").map((e) => `<span class="evd-bar ${e.status}" style="left:${pos(e.startAt)}%;width:${Math.max(1.5, pos(e.endAt) - pos(e.startAt))}%" title="${esc(e.label)}"></span>`).join("")}
        <span class="evd-now-line" style="left:${pos(t)}%"></span>
      </div>
      <ul class="evd-items">${events.map((e) => `
        <li class="evd-item ${e.status}">
          <span class="evd-badge ${STATUS[e.status][1]}">${STATUS[e.status][0]}</span>
          <div class="evd-item-body"><strong>${esc(e.label)}</strong><small>${fmtDate(e.startAt)} → ${fmtDate(e.endAt)} · ${mults(e)}</small></div>
          <div class="evd-item-actions">
            <button type="button" class="btn-ghost" data-evd-edit="${e.id}">Modifier</button>
            <button type="button" class="btn-ghost" data-evd-copy="${e.id}" title="Même événement, une semaine plus tard">+1 semaine</button>
            <button type="button" class="btn-ghost evd-del" data-evd-del="${e.id}" aria-label="Supprimer">&times;</button>
          </div>
        </li>`).join("")}</ul>` : `<p class="empty-state">Aucun événement planifié. Programme le prochain ci-dessous : il démarrera et s'arrêtera tout seul.</p>`;
  }

  function fill(e) {
    $("evd-id").value = e ? e.id || "" : "";
    $("evd-label").value = e ? e.label : "";
    $("evd-start").value = e ? toLocal(e.startAt) : "";
    $("evd-end").value = e ? toLocal(e.endAt) : "";
    $("evd-dust").value = e ? e.dustMultiplier : 1;
    $("evd-finish").value = e ? e.finishMultiplier : 1;
    $("evd-fishing").value = e ? e.fishingRare : 1;
    $("evd-worms").value = e ? e.wormsMultiplier : 1;
    $("evd-enabled").checked = e ? e.enabled : true;
    $("evd-submit").textContent = e && e.id ? "Enregistrer les modifications" : "Planifier l'événement";
  }

  async function load() {
    try {
      const [res, eco] = await Promise.all([API.adminEvents(Session.discordId), API.getEconomyState().catch(() => null)]);
      events = res.events || [];
      renderNow(res, eco);
      renderList();
    } catch (err) {
      $("evd-now").innerHTML = `<p class="empty-state">${err.code === "forbidden" ? "Accès réservé aux admins." : "Impossible de charger les événements (" + esc(err.message) + ")."}</p>`;
    }
  }

  async function save(e) {
    e.preventDefault();
    const event = {
      id: Number($("evd-id").value) || undefined, label: $("evd-label").value.trim(),
      startAt: fromLocal($("evd-start").value), endAt: fromLocal($("evd-end").value),
      dustMultiplier: Number($("evd-dust").value), finishMultiplier: Number($("evd-finish").value),
      fishingRare: Number($("evd-fishing").value), wormsMultiplier: Number($("evd-worms").value), enabled: $("evd-enabled").checked
    };
    try {
      await API.adminEvents(Session.discordId, "save", { event });
      Toast.success(event.id ? "Événement modifié." : "Événement planifié.");
      fill(null);
      load();
    } catch (err) { Toast.error(err.code === "invalid_dates" ? "La fin doit être après le début." : "Erreur. (" + err.message + ")"); }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const section = $("events-dashboard");
    if (!section || !Session.isLoggedIn()) return;
    section.addEventListener("toggle", () => { if (section.open) load(); });
    $("evd-form").addEventListener("submit", save);
    $("evd-reset").addEventListener("click", () => fill(null));
    section.addEventListener("click", async (e) => {
      const p = e.target.closest("[data-evd-preset]");
      if (p) {
        const x = PRESETS[p.dataset.evdPreset];
        $("evd-label").value = x.label; $("evd-dust").value = x.dust; $("evd-finish").value = x.finish; $("evd-fishing").value = x.fishing; $("evd-worms").value = x.worms;
        if (!$("evd-start").value) {
          const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); d.setHours(10, 0, 0, 0);
          $("evd-start").value = toLocal(d.getTime() / 1000);
          $("evd-end").value = toLocal(d.getTime() / 1000 + 38 * 3600 - 60);
        }
        return;
      }
      const edit = e.target.closest("[data-evd-edit]");
      if (edit) { fill(events.find((x) => x.id === Number(edit.dataset.evdEdit))); $("evd-form").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      const copy = e.target.closest("[data-evd-copy]");
      if (copy) {
        const src = events.find((x) => x.id === Number(copy.dataset.evdCopy));
        fill({ ...src, id: null, startAt: src.startAt + 7 * 86400, endAt: src.endAt + 7 * 86400 });
        $("evd-form").scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const del = e.target.closest("[data-evd-del]");
      if (del) {
        const ev = events.find((x) => x.id === Number(del.dataset.evdDel));
        if (!(await Confirm.show(`Supprimer « ${esc(ev ? ev.label : "")} » ?`, { title: "Supprimer l'événement", confirmText: "Supprimer", dangerous: true }))) return;
        try { await API.adminEvents(Session.discordId, "delete", { id: Number(del.dataset.evdDel) }); load(); } catch (err) { Toast.error("Erreur. (" + err.message + ")"); }
      }
    });
  });
})();
