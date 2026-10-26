// Module charge a la demande ([data-prefs-open], menu du joueur).
// Preferences (2026-10-29) : tous les reglages de cet appareil au meme
// endroit, au lieu d'une dizaine de boutons a faire defiler dans le menu :
// theme, taille du texte, effets visuels, mode compact, son, vibrations,
// cinematiques (et « revoir les decouvertes »), rappels, notifications,
// raccourcis clavier. Memes reglages qu'avant (localStorage), effet immediat.

const Prefs = {
  open() {
    document.querySelector(".prefs-overlay")?.remove();
    const ov = document.createElement("div");
    ov.className = "card-modal-overlay prefs-overlay";
    ov.innerHTML = `<div class="prefs-box" role="dialog" aria-modal="true" aria-label="Préférences">
      <header class="prefs-head"><h2>&#9881;&#65039; Préférences</h2><button type="button" class="btn-ghost" data-prefs-close aria-label="Fermer">&#10005;</button></header>
      <div class="prefs-body" id="prefs-body"></div>
      <p class="prefs-note">Ces réglages sont propres à cet appareil.</p>
    </div>`;
    document.body.appendChild(ov);
    if (typeof syncScrollLock === "function") syncScrollLock();
    this.render();
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); if (typeof syncScrollLock === "function") syncScrollLock(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.closest("[data-prefs-close]")) { close(); return; }
      this.click(e);
    });
    ov.addEventListener("change", (e) => this.change(e));
    setTimeout(() => ov.querySelector("button, input")?.focus(), 30);
  },

  seg(name, options, current) {
    return `<div class="prefs-seg" role="radiogroup">${options.map(([v, label, locked]) => `<button type="button" role="radio" aria-checked="${v === current}" class="${v === current ? "on" : ""}" data-pref="${name}" data-value="${v}" ${locked ? `disabled title="${escHtml(locked)}"` : ""}>${label}</button>`).join("")}</div>`;
  },
  row(title, hint, control) {
    return `<div class="prefs-row"><span class="prefs-label"><strong>${title}</strong>${hint ? `<small>${hint}</small>` : ""}</span>${control}</div>`;
  },
  toggle(name, on) {
    return `<label class="prefs-switch"><input type="checkbox" data-pref-toggle="${name}" ${on ? "checked" : ""} /><span aria-hidden="true"></span></label>`;
  },

  render() {
    const body = document.getElementById("prefs-body");
    if (!body) return;
    let theme = "default";
    try { theme = localStorage.getItem("2gatcha_theme") || "default"; } catch (e) { /* stockage indisponible */ }
    const lvl = typeof knownProfileLevel !== "undefined" ? knownProfileLevel : 99;
    const themes = THEME_ORDER.map((k) => [k, THEME_LABELS[k], THEME_UNLOCK_LEVEL[k] > lvl ? `Niveau ${THEME_UNLOCK_LEVEL[k]}` : ""]);
    let reminders = false;
    try { reminders = !!(JSON.parse(localStorage.getItem("2gatcha_reminders") || "null") || {}).on; } catch (e) { /* stockage indisponible */ }
    body.innerHTML = `
      <section><h3>&#127912; Affichage</h3>
        ${this.row("Thème", "Les thèmes se débloquent avec le niveau du compte.", this.seg("theme", themes, theme))}
        ${this.row("Taille du texte", "", this.seg("text", TextSize.ORDER.map((v) => [v, TextSize.LABELS[v].charAt(0).toUpperCase() + TextSize.LABELS[v].slice(1)]), TextSize.get()))}
        ${this.row("Effets visuels", "Allégés : fond fixe, sans flou ni brillances en boucle (appareils qui saccadent).", this.seg("fx", FxLevel.ORDER.map((v) => [v, FxLevel.LABELS[v].charAt(0).toUpperCase() + FxLevel.LABELS[v].slice(1)]), FxLevel.get()))}
        ${this.row("Mode compact", "Sur mobile : interface resserrée, actions principales en bas de l'accueil.", this.toggle("compact", document.documentElement.dataset.compact === "1"))}
      </section>
      <section><h3>&#128266; Son et vibrations</h3>
        ${this.row("Sons", "", this.toggle("sound", !Sfx.muted))}
        ${this.row("Vibrations", "Sur mobile : ferrage, trésors, belles cartes.", this.toggle("haptics", Haptics.on))}
      </section>
      <section><h3>&#127916; Cinématiques</h3>
        ${this.row("Ouvertures, découvertes, niveaux, modes", "", this.seg("cine", CinePref.ORDER.map((v) => [v, CinePref.LABELS[v]]), CinePref.get()))}
        ${this.row("Découvertes", "Rejoue l'animation de chaque ressource que tu possèdes.", `<button type="button" class="btn-ghost" data-pref-action="discoveries">&#128270; Revoir</button>`)}
      </section>
      <section><h3>&#9200; Rappels et notifications</h3>
        ${this.row("Rappels", "Prévenu quand l'énergie, le jardin, l'expédition ou un lot est prêt.", `<button type="button" class="btn-ghost" data-reminders>${reminders ? "Activés · régler" : "Désactivés · activer"}</button>`)}
        <div class="prefs-push" id="prefs-push"></div>
      </section>
      <section class="only-fine-pointer"><h3>&#9000; Clavier</h3>
        ${this.row("Raccourcis clavier", "Touche ? pour les revoir n'importe où.", `<button type="button" class="btn-ghost" data-pref-action="keys">Voir</button>`)}
      </section>`;
    if (typeof PushNotifs !== "undefined" && PushNotifs.renderRow) PushNotifs.renderRow(document.getElementById("prefs-push")).catch(() => {});
  },

  click(e) {
    const b = e.target.closest("[data-pref]");
    if (b && !b.disabled) {
      const v = b.dataset.value;
      if (b.dataset.pref === "theme") { applyTheme(v); Toast.info(`Thème : ${THEME_LABELS[v]}`); }
      if (b.dataset.pref === "text") TextSize.set(v);
      if (b.dataset.pref === "fx") FxLevel.set(v);
      if (b.dataset.pref === "cine") CinePref.set(v);
      this.render();
      return;
    }
    const a = e.target.closest("[data-pref-action]");
    if (!a) return;
    if (a.dataset.prefAction === "keys" && typeof Shortcuts !== "undefined") Shortcuts.help();
    if (a.dataset.prefAction === "discoveries") this.resetDiscoveries();
  },
  change(e) {
    const t = e.target.closest("[data-pref-toggle]");
    if (!t) return;
    const on = t.checked;
    if (t.dataset.prefToggle === "sound") { Sfx.setMuted(!on); if (on) Sfx.click(); }
    if (t.dataset.prefToggle === "haptics") { Haptics.set(on); if (on) Haptics.buzz(30); }
    if (t.dataset.prefToggle === "compact" && typeof setCompact === "function") setCompact(on);
  },
  async resetDiscoveries() {
    CinePref.forget("discovery");
    const ok = await Confirm.show("Rejouer l'animation de découverte de chaque ressource que tu possèdes ? Les nouvelles ressources seront aussi annoncées à nouveau.", { title: "Revoir les découvertes", confirmText: "Revoir" });
    if (!ok) return;
    try {
      const res = await API.post("discoveries", { userId: Session.userId, action: "reset" });
      if (!res.discoveries || !res.discoveries.length) Toast.info("Rien à revoir pour l'instant : tu n'as encore aucune ressource à découvrir.");
    } catch (err) { Toast.error(friendlyError(err)); }
  }
};
window.Prefs = Prefs;
