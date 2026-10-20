// Module charge a la demande par shell-extras.js (rappels actives, ou bouton
// [data-reminders]).
// Rappels personnalises (2026-10-20) : le joueur choisit quoi surveiller
// parmi les minuteurs connus (GET timers, api/src/native/timers.js : energie
// de fouille et de peche, expedition, jardin, Milo, lots qui murissent,
// nouveau jour). La page programme chaque rappel ; a l'heure dite :
// notification du systeme si l'onglet est en arriere-plan (permission
// accordee), sinon un message dans la page. Limite sans serveur : il faut
// qu'un onglet 2Gatcha soit ouvert (meme en arriere-plan) ; les rappels
// manques sont resumes a la visite suivante. Pour etre prevenu site ferme :
// notifications push du menu des notifications.

const Reminders = (function () {
  const KEY = "2gatcha_reminders";
  const FIRED = "2gatcha_reminders_fired";
  const KINDS = [
    { kind: "dig", icon: "&#9935;&#65039;", label: "Énergie de fouille pleine", on: true },
    { kind: "fish", icon: "&#127907;", label: "Énergie de pêche pleine", on: true },
    { kind: "expedition", icon: "&#129517;", label: "Retour de l'expédition", on: true },
    { kind: "garden", icon: "&#127793;", label: "Première récolte du jardin", on: true },
    { kind: "garden-all", icon: "&#127803;", label: "Tout le jardin est prêt", on: false },
    { kind: "dog", icon: "&#128021;", label: "Milo rentre de sa fouille", on: true },
    { kind: "dog-rest", icon: "&#128164;", label: "Milo a fini de se reposer", on: false },
    { kind: "ripen", icon: "&#127817;", label: "Un lot de boosters a mûri", on: true },
    { kind: "day", icon: "&#127873;", label: "Nouveau jour (boîte, dé, roue, devinette)", on: false }
  ];
  const kindOf = (key) => (String(key).startsWith("ripen-") ? "ripen" : key);
  const esc = escHtml;
  let timers = [];
  let data = null;

  function prefs() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { /* stockage indisponible */ }
    const kinds = {};
    KINDS.forEach((k) => { kinds[k.kind] = p && p.kinds && k.kind in p.kinds ? !!p.kinds[k.kind] : k.on; });
    return { on: !!(p && p.on), kinds, seen: (p && p.seen) || 0 };
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* stockage indisponible */ } }
  function firedSet() { try { return JSON.parse(localStorage.getItem(FIRED) || "{}") || {}; } catch (e) { return {}; } }
  // Un rappel = une cle + son heure : jamais deux fois, meme avec plusieurs onglets.
  function markFired(id) {
    const f = firedSet();
    if (f[id]) return false;
    f[id] = Date.now();
    const old = Date.now() - 3 * 86400000;
    Object.keys(f).forEach((k) => { if (f[k] < old) delete f[k]; });
    try { localStorage.setItem(FIRED, JSON.stringify(f)); } catch (e) { /* stockage indisponible */ }
    return true;
  }

  async function load() {
    data = await API.get("timers", { userId: Session.userId });
    // Ecart d'horloge entre le serveur et l'appareil.
    data.skew = Date.now() / 1000 - data.now;
    return data;
  }

  async function fire(item) {
    if (!markFired(item.key + "@" + item.at)) return;
    const text = item.label.replace(/<[^>]+>/g, "");
    if (document.visibilityState === "visible" || !("Notification" in window) || Notification.permission !== "granted") {
      if (typeof Toast !== "undefined") Toast.success(`&#9200; ${esc(text)} — <a href="${esc(item.url)}">y aller</a>`);
      if (typeof Haptics !== "undefined") Haptics.buzz([20, 60, 20]);
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) reg.showNotification("2Gatcha", { body: "⏰ " + text, tag: "reminder-" + item.key, data: { url: item.url } });
      else new Notification("2Gatcha", { body: "⏰ " + text });
    } catch (e) { /* notification refusee */ }
  }

  async function schedule() {
    timers.forEach(clearTimeout);
    timers = [];
    const p = prefs();
    if (!p.on || !Session.isLoggedIn()) return;
    try { await load(); } catch (e) { return; }
    const nowS = Date.now() / 1000 - data.skew;
    const missed = [];
    (data.items || []).forEach((it) => {
      if (!p.kinds[kindOf(it.key)]) return;
      const wait = (it.at - nowS) * 1000;
      if (wait > 0) {
        if (wait < 24 * 3600 * 1000) timers.push(setTimeout(() => fire(it), wait + 1500));
      } else if (p.seen && it.at > p.seen && nowS - it.at < 12 * 3600 && markFired(it.key + "@" + it.at)) missed.push(it);
    });
    if (missed.length && typeof Toast !== "undefined") Toast.info(`&#9200; Pendant ton absence : ${missed.map((m) => esc(m.label)).join(" · ")}`);
    save({ ...p, seen: Math.floor(nowS) });
  }

  const inText = (s) => { const h = Math.floor(s / 3600), m = Math.ceil((s % 3600) / 60); return s <= 0 ? "prêt" : h ? `dans ${h} h ${String(m).padStart(2, "0")}` : `dans ${m} min`; };

  async function openSettings() {
    const p = prefs();
    let st = null;
    try { st = await load(); } catch (e) { /* liste sans heures */ }
    const nowS = Date.now() / 1000 - (st ? st.skew : 0);
    const next = {};
    ((st && st.items) || []).forEach((it) => { const k = kindOf(it.key); if (!(k in next) || it.at < next[k]) next[k] = it.at; });
    const perm = "Notification" in window ? Notification.permission : "unsupported";
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay contract-overlay";
    overlay.innerHTML = `
      <div class="contract-modal rm-modal" role="dialog" aria-modal="true" aria-labelledby="rm-title">
        <header class="contract-modal-head"><div><span aria-hidden="true">&#9200;</span> <strong id="rm-title">Rappels</strong></div>
          <button type="button" class="card-modal-close" data-rm-close aria-label="Fermer">&times;</button></header>
        <label class="rm-master"><input type="checkbox" data-rm-on ${p.on ? "checked" : ""} /> <span><strong>Me prévenir quand c'est prêt</strong><small>Sur cet appareil, tant qu'un onglet 2Gatcha est ouvert (même en arrière-plan). Ceux que tu rates sont résumés à ta visite suivante. Site fermé : active plutôt les notifications push (menu &#128276;).</small></span></label>
        <ul class="rm-list">${KINDS.map((k) => `<li><label><input type="checkbox" data-rm-kind="${k.kind}" ${p.kinds[k.kind] ? "checked" : ""} ${p.on ? "" : "disabled"} /> <span aria-hidden="true">${k.icon}</span> ${k.label}</label>${k.kind in next ? `<small>${inText(next[k.kind] - nowS)}</small>` : '<small class="muted">rien en cours</small>'}</li>`).join("")}</ul>
        ${perm === "denied" ? '<p class="rm-note">Les notifications sont bloquées dans ton navigateur : les rappels s\'afficheront seulement dans la page.</p>' : ""}
        <footer class="contract-modal-foot"><button type="button" class="btn" data-rm-save>Enregistrer</button></footer>
      </div>`;
    document.body.appendChild(overlay);
    if (typeof syncScrollLock === "function") syncScrollLock();
    const close = () => { overlay.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest("[data-rm-close]")) close(); });
    overlay.querySelector("[data-rm-on]").addEventListener("change", (e) => overlay.querySelectorAll("[data-rm-kind]").forEach((c) => { c.disabled = !e.target.checked; }));
    overlay.querySelector("[data-rm-save]").addEventListener("click", async () => {
      const on = overlay.querySelector("[data-rm-on]").checked;
      const kinds = {};
      overlay.querySelectorAll("[data-rm-kind]").forEach((c) => { kinds[c.dataset.rmKind] = c.checked; });
      save({ on, kinds, seen: Math.floor(Date.now() / 1000 - (st ? st.skew : 0)) });
      // Autorisation demandee ici (geste du joueur), une seule fois.
      if (on && "Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch (e) { /* refus */ } }
      close();
      if (typeof Toast !== "undefined") Toast.success(on ? "&#9200; Rappels activés sur cet appareil." : "Rappels désactivés.");
      document.querySelectorAll("[data-reminders-label]").forEach((l) => { l.textContent = on ? "activés" : "désactivés"; });
      schedule();
    });
  }

  // Reprogramme apres chaque action (les minuteurs changent) et toutes les 15 min.
  let tick = null;
  function start() {
    schedule();
    if (tick) return;
    window.addEventListener("api:claimed", () => setTimeout(schedule, 800));
    tick = setInterval(schedule, 15 * 60000);
  }
  return { start, schedule, openSettings, prefs };
})();
window.Reminders = Reminders;
