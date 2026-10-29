// Module charge a la demande ([data-feedback-open], menu du joueur).
// Donner un avis (2026-10-29) : idee, bug ou autre, avec une humeur
// facultative. Envoye a l'API (POST feedback) qui le transmet a GlitchTip
// comme un evenement « Information » (pas une erreur), avec la page et le
// navigateur pour aider a reproduire un bug.

const Feedback = {
  KINDS: [["idea", "&#128161; Idée"], ["bug", "&#128027; Bug"], ["other", "&#128172; Autre"]],
  MOODS: [["love", "&#128525;", "J'adore"], ["ok", "&#128578;", "Ça va"], ["meh", "&#128533;", "Bof"]],
  ERRORS: { message_too_short: "Écris au moins quelques mots.", message_too_long: "2000 caractères au plus.", feedback_rate_limited: "Merci ! Tu as déjà envoyé plusieurs avis : réessaie dans une heure." },

  open(kind) {
    document.querySelector(".feedback-overlay")?.remove();
    const state = { kind: this.KINDS.some(([k]) => k === kind) ? kind : "idea", mood: "" };
    const ov = document.createElement("div");
    ov.className = "card-modal-overlay prefs-overlay feedback-overlay";
    ov.innerHTML = `<form class="prefs-box feedback-box" role="dialog" aria-modal="true" aria-label="Donner un avis">
      <header class="prefs-head"><h2>&#128172; Donner un avis</h2><button type="button" class="btn-ghost" data-fb-close aria-label="Fermer">&#10005;</button></header>
      <div class="prefs-body">
        <div class="prefs-seg" role="radiogroup" aria-label="Type d'avis">${this.KINDS.map(([k, label]) => `<button type="button" role="radio" data-fb-kind="${k}">${label}</button>`).join("")}</div>
        <label class="feedback-label" for="fb-message">Ton message</label>
        <textarea id="fb-message" rows="6" maxlength="2000" required placeholder="Ce qui te plaît, ce qui coince, ce que tu aimerais voir…"></textarea>
        <div class="feedback-foot">
          <div class="feedback-moods" role="radiogroup" aria-label="Ton humeur (facultatif)">${this.MOODS.map(([k, icon, label]) => `<button type="button" role="radio" aria-checked="false" data-fb-mood="${k}" title="${label}">${icon}</button>`).join("")}</div>
          <small class="feedback-count" id="fb-count">0 / 2000</small>
        </div>
      </div>
      <p class="prefs-note feedback-actions"><span>La page et ton navigateur sont joints pour aider l'équipe.</span><button type="submit" class="btn" id="fb-send">Envoyer</button></p>
    </form>`;
    document.body.appendChild(ov);
    if (typeof syncScrollLock === "function") syncScrollLock();
    const form = ov.querySelector("form");
    const text = ov.querySelector("#fb-message");
    const paint = () => {
      ov.querySelectorAll("[data-fb-kind]").forEach((b) => { const on = b.dataset.fbKind === state.kind; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
      ov.querySelectorAll("[data-fb-mood]").forEach((b) => { const on = b.dataset.fbMood === state.mood; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
      text.placeholder = state.kind === "bug" ? "Ce que tu faisais, ce qui s'est passé, ce que tu attendais…" : "Ce qui te plaît, ce qui coince, ce que tu aimerais voir…";
    };
    paint();
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); if (typeof syncScrollLock === "function") syncScrollLock(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    text.addEventListener("input", () => { ov.querySelector("#fb-count").textContent = `${text.value.length} / 2000`; });
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.closest("[data-fb-close]")) { close(); return; }
      const k = e.target.closest("[data-fb-kind]");
      if (k) { state.kind = k.dataset.fbKind; paint(); return; }
      const m = e.target.closest("[data-fb-mood]");
      if (m) { state.mood = state.mood === m.dataset.fbMood ? "" : m.dataset.fbMood; paint(); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const message = text.value.trim();
      if (message.length < 5) { Toast.error(this.ERRORS.message_too_short); text.focus(); return; }
      const btn = ov.querySelector("#fb-send");
      btn.disabled = true;
      try {
        let theme = "";
        try { theme = localStorage.getItem("2gatcha_theme") || ""; } catch (err) { /* stockage indisponible */ }
        await API.sendFeedback({
          kind: state.kind, mood: state.mood || undefined, message,
          page: location.pathname.split("/").pop() + location.hash,
          context: { ua: navigator.userAgent, screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`, theme, lang: navigator.language, online: String(navigator.onLine) }
        });
        close();
        Toast.success("&#128172; Merci ! Ton avis est bien arrivé à l'équipe.");
      } catch (err) {
        btn.disabled = false;
        Toast.error(this.ERRORS[err.code] || friendlyError(err));
      }
    });
    setTimeout(() => text.focus(), 30);
  }
};
