// Admin > Discord (2026-10-26) : adresse du webhook, modeles des annonces du
// jeu (nouveau code, carte Unique, carte partagee) et message libre, avec un
// apercu facon Discord. api/src/native/discord.js (admin-discord).

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const ERR = { invalid_webhook: "Adresse refusée : il faut une adresse de webhook Discord (https://discord.com/api/webhooks/…).", discord_unavailable: "Aucun webhook configuré.", empty_message: "Écris au moins un titre ou un texte.", no_legacy_webhook: "Aucune adresse dans les anciens workflows.", forbidden: "Accès réservé aux admins." };
  const errText = (e) => ERR[e.code] || friendlyError(e);
  const api = (action, params = {}) => API.post("adminDiscord", { discordId: Session.discordId, action, ...params });
  const SAMPLE = {
    code: { code: "SOIREE20", label: "Soirée jeux du 20/11", rewards: "🃏 +3 jetons booster\n🪱 +20 vers de terre", dates: "jusqu'au ven. 20 nov., 23:59", quota: " · 30 joueurs max" },
    unique: { pseudo: "Helldwin", card: "Sterling In The Lake", serial: "001", first: " : premier exemplaire du serveur !" },
    cardShare: { pseudo: "Helldwin", card: "Carte 7", details: "Légendaire · Diamant · Parfait état · #004" }
  };
  let st = null;

  // Apercu : meme remplacement des variables que le serveur, mise en forme
  // Discord simplifiee (gras, retours a la ligne).
  const fill = (t, vars) => String(t || "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
  const embed = (title, text, color, image) => `<div class="dc-embed" style="--c:${esc(color || "#8b5cf6")}"><div class="dc-head"><span class="dc-bot">2G</span><b>2Gatcha</b><small>BOT</small></div>${title ? `<strong class="dc-title">${md(title)}</strong>` : ""}${text ? `<div class="dc-text">${md(text)}</div>` : ""}${image ? `<img src="${esc(image)}" alt="" />` : ""}</div>`;

  function render() {
    const w = st.webhook;
    $("dc-app").innerHTML = `
      <section class="dc-block">
        <h3>🔗 Webhook du serveur</h3>
        <p class="muted">${w.configured ? `Annonces envoyées à <code>${esc(w.masked)}</code> (${w.source === "admin" ? "réglée ici" : "variable DISCORD_WEBHOOK_URL du serveur"}).` : "Aucune adresse : rien n'est annoncé sur Discord pour l'instant."}</p>
        <div class="dc-row"><input type="url" id="dc-hook" placeholder="https://discord.com/api/webhooks/…" autocomplete="off" /><button type="button" class="btn-secondary" id="dc-hook-save">Enregistrer l'adresse</button>
          ${w.legacy && w.source !== "admin" ? `<button type="button" class="btn-ghost" id="dc-legacy" title="${esc(w.legacy)}">Reprendre l'adresse des anciens workflows</button>` : ""}
          <button type="button" class="btn-ghost" id="dc-test" ${w.configured ? "" : "disabled"}>✅ Envoyer un test</button></div>
        <small class="muted">Discord : Paramètres du salon → Intégrations → Webhooks → Copier l'URL. L'adresse n'est jamais montrée en entier ici.</small>
      </section>
      <section class="dc-block">
        <h3>📣 Annonces du jeu</h3>
        <p class="muted">Clique une variable pour l'ajouter au texte. <code>**gras**</code> et les retours à la ligne passent tels quels sur Discord.</p>
        ${st.templates.map((t) => `
        <details class="dc-tpl" data-tpl="${t.key}" ${t.enabled === false ? "" : "open"}>
          <summary><label class="adm-check" onclick="event.stopPropagation()"><input type="checkbox" data-f="enabled" ${t.enabled === false ? "" : "checked"} /> <strong>${esc(t.label)}</strong></label> <small class="muted">${esc(t.when)}</small></summary>
          <div class="dc-tpl-body">
            <div class="dc-form">
              <label>Titre<input type="text" data-f="title" maxlength="256" value="${esc(t.title)}" /></label>
              <label>Texte<textarea data-f="text" rows="5" maxlength="4000">${esc(t.text)}</textarea></label>
              <div class="dc-vars">${Object.entries(t.vars).map(([k, d]) => `<button type="button" class="rw-chip" data-var="${k}" title="${esc(d)}">{${k}}</button>`).join("")}</div>
              <div class="dc-row"><label>Couleur <input type="color" data-f="color" value="${esc(t.color)}" /></label><button type="button" class="btn-ghost" data-reset="${t.key}">Texte d'origine</button></div>
            </div>
            <div class="dc-preview" data-preview="${t.key}"></div>
          </div>
        </details>`).join("")}
        <div class="dc-actions"><span class="muted" id="dc-pending"></span><button type="button" class="btn" id="dc-save">Enregistrer les annonces</button></div>
      </section>
      <section class="dc-block">
        <h3>✍️ Message libre</h3>
        <p class="muted">Annonce ponctuelle (soirée, maintenance, nouveauté…), envoyée tout de suite.</p>
        <div class="dc-tpl-body">
          <div class="dc-form">
            <label>Titre<input type="text" id="dc-m-title" maxlength="256" placeholder="ex : 🎉 Soirée 2Gatcha ce vendredi !" /></label>
            <label>Texte<textarea id="dc-m-text" rows="5" maxlength="4000" placeholder="Ce qui se passe, quand, où…"></textarea></label>
            <label>Image (lien https, facultatif)<input type="url" id="dc-m-image" placeholder="https://…" /></label>
            <div class="dc-row"><label>Couleur <input type="color" id="dc-m-color" value="#8b5cf6" /></label><button type="button" class="btn" id="dc-send" ${w.configured ? "" : "disabled"}>Envoyer sur Discord</button></div>
          </div>
          <div class="dc-preview" id="dc-m-preview"></div>
        </div>
      </section>`;
    st.templates.forEach((t) => preview(t.key));
    previewFree();
    wire();
  }
  function tplValues(key) {
    const box = document.querySelector(`[data-tpl="${key}"]`);
    const v = (f) => box.querySelector(`[data-f="${f}"]`);
    return { enabled: v("enabled").checked, title: v("title").value, text: v("text").value, color: v("color").value };
  }
  function preview(key) {
    const t = tplValues(key);
    const box = document.querySelector(`[data-preview="${key}"]`);
    box.innerHTML = t.enabled ? embed(fill(t.title, SAMPLE[key] || {}), fill(t.text, SAMPLE[key] || {}), t.color) : `<p class="muted">Annonce désactivée : rien n'est posté.</p>`;
    const orig = st.templates.find((x) => x.key === key);
    const changed = JSON.stringify(t) !== JSON.stringify({ enabled: orig.enabled !== false, title: orig.title, text: orig.text, color: orig.color });
    box.closest(".dc-tpl").classList.toggle("dirty", changed);
    const n = document.querySelectorAll(".dc-tpl.dirty").length;
    $("dc-pending").textContent = n ? `${n} annonce${n > 1 ? "s" : ""} modifiée${n > 1 ? "s" : ""}, pas encore enregistrée${n > 1 ? "s" : ""}` : "";
  }
  function previewFree() { $("dc-m-preview").innerHTML = embed($("dc-m-title").value, $("dc-m-text").value, $("dc-m-color").value, /^https:\/\//.test($("dc-m-image").value) ? $("dc-m-image").value : ""); }
  function wire() {
    const app = $("dc-app");
    app.oninput = (e) => { const tpl = e.target.closest("[data-tpl]"); if (tpl) preview(tpl.dataset.tpl); else if (e.target.id && e.target.id.startsWith("dc-m-")) previewFree(); };
    app.onchange = app.oninput;
    app.onclick = async (e) => {
      const v = e.target.closest("[data-var]");
      if (v) { const ta = v.closest(".dc-form").querySelector("textarea"); const pos = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, pos) + `{${v.dataset.var}}` + ta.value.slice(ta.selectionEnd ?? pos); ta.focus(); preview(v.closest("[data-tpl]").dataset.tpl); return; }
      const r = e.target.closest("[data-reset]");
      if (r) { const t = st.templates.find((x) => x.key === r.dataset.reset); const box = r.closest("[data-tpl]"); box.querySelector('[data-f="title"]').value = t.def.title; box.querySelector('[data-f="text"]').value = t.def.text; box.querySelector('[data-f="color"]').value = t.def.color; preview(t.key); return; }
      const id = e.target.id;
      try {
        if (id === "dc-hook-save") { const w = $("dc-hook").value.trim(); if (!w && !(await Confirm.show("Effacer l'adresse réglée ici ? Le serveur reprendra sa variable DISCORD_WEBHOOK_URL si elle existe.", { title: "Effacer le webhook", confirmText: "Effacer" }))) return; st = await api("save", { webhook: w }); Toast.success(w ? "Adresse enregistrée." : "Adresse effacée."); render(); }
        else if (id === "dc-legacy") { st = await api("useLegacy"); Toast.success("Adresse des anciens workflows reprise."); render(); }
        else if (id === "dc-test") { await api("test"); Toast.success("Test envoyé : regarde le salon Discord."); }
        else if (id === "dc-save") { const templates = Object.fromEntries(st.templates.map((t) => [t.key, tplValues(t.key)])); st = await api("save", { templates }); Toast.success("Annonces enregistrées."); render(); }
        else if (id === "dc-send") {
          const message = { title: $("dc-m-title").value.trim(), text: $("dc-m-text").value.trim(), color: $("dc-m-color").value, image: $("dc-m-image").value.trim() };
          if (!message.title && !message.text) return Toast.info(ERR.empty_message);
          if (!(await Confirm.show(`Envoyer ce message sur le serveur Discord ?${embed(message.title, message.text, message.color)}`, { title: "Annoncer sur Discord", confirmText: "Envoyer" }))) return;
          await api("send", { message });
          Toast.success("Message envoyé sur Discord.");
          ["dc-m-title", "dc-m-text", "dc-m-image"].forEach((x) => { $(x).value = ""; });
          previewFree();
        }
      } catch (err) { Toast.error(errText(err)); }
    };
  }
  async function init() {
    const app = $("dc-app");
    if (!app || !Session.discordId) return;
    try { st = await api("status"); render(); }
    catch (e) { app.innerHTML = `<p class="error-box">${e.status === 404 || e.code === "not_found" ? "Cette page demande la mise à jour du serveur (route admin-discord)." : esc(errText(e))}</p>`; }
  }
  document.addEventListener("DOMContentLoaded", () => { if (typeof AdminNav !== "undefined" && AdminNav.onFirstShow) AdminNav.onFirstShow("discord", init); else setTimeout(init, 0); });
})();
