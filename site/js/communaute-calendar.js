// Calendrier des evenements (Communaute, 2026-10-15) : tout ce qui arrive,
// regroupe par mois, avec un filtre et "Ajouter a mon agenda" (.ics).
// Sources : evenements de l'asso (get-event-calendar), evenement et heure
// doree en cours (event-status), evenements saisonniers (calcules ici, memes
// dates que api/src/native/seasonal.js), rendez-vous reguliers (tournoi de
// peche du week-end, fin du vote de la salle des machines, tirages de la
// loterie et fin de la guerre des equipes quand l'API les propose).

(function () {
  const esc = escHtml;
  const DAY = 86400;
  const nowS = () => Math.floor(Date.now() / 1000);

  function seasonItems(horizon) {
    return SeasonCalendar.upcoming(horizon).map((s) => {
      const ed = (typeof EDITIONS !== "undefined" && EDITIONS[s.edition]) || { label: s.edition, icon: "" };
      return { kind: "season", icon: s.icon, label: s.label, start: s.start, end: s.end, cls: "season-" + s.key,
        desc: `Édition limitée ${ed.icon} ${ed.label} dans les boosters, cadeau du jour (${s.treat}), trouvailles en jouant${s.boss ? `, et ${s.boss} à affronter au boss commun` : ""}.` };
    });
  }

  // Tournoi de peche : chaque samedi et dimanche.
  function tourneyItems(horizon) {
    const out = [];
    const today = new Date();
    for (let i = 0; i < 70; i++) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i));
      if (d.getUTCDay() !== 6) continue;
      const start = SeasonCalendar.parisMidnight(d.toISOString().slice(0, 10)), end = start + 2 * DAY;
      if (end < nowS() || start > horizon) continue;
      out.push({ kind: "rdv", icon: "🎣", label: "Tournoi de pêche du week-end", start, end, desc: "Tes premiers lancers du week-end comptent. Prix en poussières et titre « Roi de la pêche ».", href: "communaute.html#metiers" });
    }
    return out.slice(0, 4);
  }

  // ------------------------------------------------------------------ affichage
  const fmtDay = (t, opts = {}) => new Date(t * 1000).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", ...opts });
  const fmtTime = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  function whenLabel(it) {
    const oneDay = it.end - it.start <= DAY && fmtTime(it.start) === "00:00";
    if (it.point) return `${fmtDay(it.start)} à ${fmtTime(it.start)}`;
    if (oneDay) return fmtDay(it.start, { weekday: "long" });
    const endShown = fmtTime(it.end) === "00:00" ? it.end - 60 : it.end;
    return `du ${fmtDay(it.start)} au ${fmtDay(endShown)}${fmtTime(it.start) !== "00:00" ? ` (${fmtTime(it.start)} → ${fmtTime(endShown)})` : ""}`;
  }
  function countdown(it) {
    const t = nowS();
    if (it.start <= t && (it.point ? false : t < it.end)) {
      const left = it.end - t;
      return `<span class="cal-badge live">En cours · encore ${left > DAY ? Math.ceil(left / DAY) + " j" : Math.ceil(left / 3600) + " h"}</span>`;
    }
    const d = it.start - t;
    if (d <= 0) return "";
    return `<span class="cal-badge">${d < 3600 ? "dans " + Math.ceil(d / 60) + " min" : d < DAY ? "dans " + Math.ceil(d / 3600) + " h" : d < 2 * DAY ? "demain" : "dans " + Math.ceil(d / DAY) + " j"}</span>`;
  }

  // Fichier .ics d'un evenement (Ajouter a mon agenda).
  function ics(it) {
    const z = (t) => new Date(t * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const clean = (s) => String(s).replace(/<[^>]+>/g, "").replace(/([,;])/g, "\\$1").replace(/\n/g, " ");
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//2Gatcha//Calendrier//FR", "BEGIN:VEVENT",
      `UID:${it.kind}-${it.start}@2gatcha`, `DTSTAMP:${z(nowS())}`, `DTSTART:${z(it.start)}`, `DTEND:${z(it.point ? it.start + 1800 : it.end)}`,
      `SUMMARY:${clean("2Gatcha : " + it.label)}`, `DESCRIPTION:${clean(it.desc || "")}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  }

  const KINDS = { all: "Tout", season: "Saisons", event: "Bonus", rdv: "Rendez-vous", irl: "Asso" };
  let items = [], filter = "all";
  try { filter = localStorage.getItem("2gatcha_cal_filter") || "all"; } catch (e) { /* stockage indisponible */ }

  function render() {
    const list = document.getElementById("calendar-list");
    if (!list) return;
    const shown = items.filter((it) => filter === "all" || it.kind === filter);
    const months = new Map();
    shown.forEach((it) => {
      const key = new Date(Math.max(it.start, nowS()) * 1000).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(it);
    });
    list.className = "cal";
    list.innerHTML = `
      <div class="cal-filters" role="group" aria-label="Filtrer le calendrier">${Object.entries(KINDS).map(([k, v]) => `<button type="button" class="cal-filter ${filter === k ? "active" : ""}" data-cal-filter="${k}" aria-pressed="${filter === k}">${v}</button>`).join("")}</div>
      ${shown.length ? [...months].map(([m, list2]) => `
        <section class="cal-month"><h2>${esc(m.charAt(0).toUpperCase() + m.slice(1))}</h2>
          <ul>${list2.map((it, i) => `
            <li class="cal-item kind-${it.kind} ${it.cls || ""} ${it.start <= nowS() && !it.point ? "live" : ""}">
              <span class="cal-icon" aria-hidden="true">${it.icon}</span>
              <div class="cal-body">
                <div class="cal-title"><strong>${esc(it.label)}</strong>${countdown(it)}</div>
                <small class="cal-when">${esc(whenLabel(it))}</small>
                ${it.desc ? `<p>${it.descHtml ? it.desc : esc(it.desc)}</p>` : ""}
              </div>
              <div class="cal-actions">
                ${it.href ? `<a class="btn-ghost" href="${it.href}">Y aller</a>` : ""}
                <button type="button" class="btn-ghost" data-cal-ics="${items.indexOf(it)}" title="Télécharger pour ton agenda (Google, Apple, Outlook)">&#128197; Agenda</button>
              </div>
            </li>`).join("")}</ul>
        </section>`).join("") : `<div class="empty-state">Rien de prévu dans cette catégorie pour l'instant.</div>`}`;
  }

  async function load() {
    const loading = document.getElementById("calendar-loading");
    const horizon = nowS() + 366 * DAY;
    const settle = (p) => (p ? p.then((v) => v, () => null) : Promise.resolve(null));
    const logged = typeof Session !== "undefined" && Session.isLoggedIn();
    const [cal, ev, machine, lottery, teams] = await Promise.all([
      settle(API.getEventCalendar()), settle(API.getEventStatus()),
      logged && API.machineRoom ? settle(API.machineRoom(Session.userId)) : null,
      logged && API.lottery ? settle(API.lottery(Session.userId)) : null,
      logged && API.teams ? settle(API.teams(Session.userId)) : null
    ]);
    const out = [...seasonItems(horizon), ...tourneyItems(horizon)];
    (cal && cal.events || []).forEach((e) => out.push({ kind: "irl", icon: "🎟️", label: e.label, start: e.startsAt || nowS(), end: e.expiresAt || (e.startsAt || nowS()) + DAY, desc: "Évènement de l'asso : le code est donné sur place ou à l'écran.", href: "redeem.html" }));
    if (ev && ev.active && !ev.golden) {
      const perks = [ev.dustMultiplier > 1 && `poussières ×${ev.dustMultiplier}`, ev.finishMultiplier > 1 && `finitions ×${ev.finishMultiplier}`, ev.fishingRare > 1 && `pêche rare ×${ev.fishingRare}`, ev.wormsMultiplier > 1 && `vers ×${ev.wormsMultiplier}`].filter(Boolean);
      out.push({ kind: "event", icon: "🎉", label: ev.label || "Événement", start: nowS() - 60, end: ev.endsAt || nowS() + DAY, desc: perks.length ? "Bonus : " + perks.join(", ") + "." : "" });
    }
    if (ev && ev.goldenHour && ev.goldenHour.enabled && ev.goldenHour.end > nowS()) out.push({ kind: "event", icon: "🌅", label: "Heure dorée", start: ev.goldenHour.start, end: ev.goldenHour.end, desc: `Finitions ×${ev.goldenHour.multiplier || 2} pendant une heure.`, href: "ouverture.html" });
    if (machine && machine.voteClosesAt) out.push({ kind: "rdv", icon: "⚙️", label: "Fin du vote de la salle des machines", start: machine.voteClosesAt - 60, point: true, desc: machine.appliesNextMonth ? "Le mode le plus voté s'applique au début du mois suivant." : "Le mode le plus voté s'applique aussitôt.", href: "communaute.html#machines" });
    if (lottery && lottery.enabled && lottery.drawAt) for (let w = 0; w < 4; w++) out.push({ kind: "rdv", icon: "🎟️", label: "Tirage de la loterie", start: lottery.drawAt + w * 7 * DAY, point: true, desc: w === 0 ? `Cagnotte actuelle : ${Number(lottery.pot || 0).toLocaleString("fr-FR")} poussières.` : "Tirage du dimanche soir.", href: "communaute.html#affichage" });
    if (teams && teams.enabled && teams.endsAt) out.push({ kind: "rdv", icon: "🏳️", label: "Fin de la guerre des équipes", start: teams.endsAt - 60, point: true, desc: "Les membres de l'équipe gagnante reçoivent un titre de champion.", href: "communaute.html#equipes" });
    items = out.filter((it) => (it.point ? it.start >= nowS() - 3600 : it.end > nowS()) && it.start <= horizon).sort((a, b) => a.start - b.start);
    if (loading) loading.style.display = "none";
    render();
  }
  window.loadCalendarFull = load;

  document.addEventListener("click", (e) => {
    const f = e.target.closest && e.target.closest("[data-cal-filter]");
    if (f) { filter = f.dataset.calFilter; try { localStorage.setItem("2gatcha_cal_filter", filter); } catch (err) { /* stockage indisponible */ } render(); return; }
    const b = e.target.closest && e.target.closest("[data-cal-ics]");
    if (!b) return;
    const it = items[Number(b.dataset.calIcs)];
    if (!it) return;
    const url = URL.createObjectURL(new Blob([ics(it)], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url; a.download = `2gatcha-${it.label.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  // Les comptes a rebours restent justes si la page reste ouverte.
  setInterval(() => { if (!document.hidden && items.length && document.getElementById("calendar-pane")?.offsetParent) render(); }, 60000);
})();
