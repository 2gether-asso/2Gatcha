// Admin > Codes & dons V2 (2026-10-26) : une seule fabrique de recompenses
// pour les codes evenement et les dons directs (api/src/native/rewards.js,
// route admin-rewards). Tout ce qui se donne dans le jeu : boosters,
// poussieres, cles, vers, os, tablettes, jetons du casino, XP x2, cartes
// precises ou au hasard (finition, etat, edition), cosmetiques. Un code peut
// cumuler plusieurs recompenses, commencer plus tard, avoir un quota ; un don
// peut viser plusieurs joueurs. Tant que l'API n'a pas cette route (serveur
// pas encore mis a jour), les anciens formulaires restent affiches.
// Affichage revu (2026-10-29) : chiffres du moment en tete, nouveau code en
// 3 etapes (recompenses, periode, annonce) avec l'apercu de ce que voit le
// joueur, codes en cartes (statut, jauge, actions nommees).

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const STATUS = { active: ["Actif", "ok"], scheduled: ["Programmé", "info"], exhausted: ["Épuisé", "warn"], expired: ["Terminé", "off"], disabled: ["Désactivé", "off"] };
  const PRESETS = [
    { label: "🃏 3 boosters", lines: [{ type: "resource", key: "booster", n: 3 }] },
    { label: "✨ 500 poussières", lines: [{ type: "resource", key: "dust", n: 500 }] },
    { label: "🎣 Pack pêcheur", lines: [{ type: "resource", key: "worms", n: 20 }, { type: "resource", key: "bait", n: 2 }] },
    { label: "⛏️ Pack fouilleur", lines: [{ type: "resource", key: "bone", n: 3 }, { type: "resource", key: "key", n: 1 }] },
    { label: "🏺 Pack archéologue", lines: [{ type: "resource", key: "tabletStone", n: 2 }, { type: "resource", key: "tabletClay", n: 2 }] },
    { label: "🎲 Carte épique au hasard", lines: [{ type: "randomCard", rarity: "epique", n: 1, finish: "normal", quality: "good", edition: "" }] }
  ];
  let cat = null, cards = [], users = [], codes = [];
  const builders = {};
  let tab = "code", listFilter = "live", listQuery = "";

  const api = (action, params = {}) => API.post("adminRewards", { discordId: Session.discordId, action, ...params });
  const fmtDate = (t) => (t ? new Date(t * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const toLocal = (t) => { const d = new Date(t * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const fromLocal = (v) => (v ? Math.floor(new Date(v).getTime() / 1000) : 0);
  const nowS = () => Math.floor(Date.now() / 1000);
  const ERR = {
    no_reward: "Ajoute au moins une récompense.", unknown_resource: "Ressource inconnue.", invalid_amount: "Quantité hors limites.", card_not_found: "Carte introuvable.",
    unknown_edition: "Édition inconnue.", unknown_rarity: "Rareté inconnue.", unknown_cosmetic: "Cosmétique introuvable.", too_many_rewards: "Trop de lignes (12 au plus).",
    invalid_code_format: "Code : 3 à 24 caractères, lettres, chiffres, - ou _.", code_taken: "Ce code existe déjà.", invalid_dates: "La fin doit être après le début (et dans le futur).",
    no_user: "Choisis au moins un joueur.", too_many_users: "100 joueurs au plus par don.", unknown_user: "Un des joueurs n'existe plus.", legacy_code: "Les anciens codes ne se modifient pas (désactive-le et crée-en un nouveau).", forbidden: "Accès réservé aux admins."
  };
  const errText = (e) => (ERR[e.code] ? ERR[e.code] + (e.data && e.data.max ? ` (max ${e.data.max})` : "") : friendlyError(e));

  // ---------------------------------------------------------------- texte d'une ligne (meme logique que le serveur)
  function describe(l) {
    if (l.type === "resource") { const r = cat.resources.find((x) => x.key === l.key); return `${r ? r.icon : "🎁"} +${Number(l.n || 0).toLocaleString("fr-FR")} ${r ? r.label : l.key}`; }
    const ed = cat.editions.find((e) => e.key === l.edition);
    const extra = [l.finish && l.finish !== "normal" ? (cat.finishes.find((f) => f.key === l.finish) || {}).label : "", (cat.qualities.find((q) => q.key === l.quality) || {}).label, ed ? `${ed.icon} ${ed.label}` : ""].filter(Boolean).join(", ");
    if (l.type === "card") { const c = cards.find((x) => x.cardId === Number(l.cardId)); return `🎴 ${l.n > 1 ? l.n + "× " : ""}${c ? c.name : "?"}${extra ? ` (${extra})` : ""}`; }
    if (l.type === "randomCard") { const r = cat.rarities.find((x) => x.key === l.rarity); return `🎲 ${l.n > 1 ? l.n + " cartes" : "1 carte"} ${r ? r.name.toLowerCase() : "?"} au hasard${extra ? ` (${extra})` : ""}`; }
    if (l.type === "cosmetic") { const c = cat.cosmetics.find((x) => x.key === l.key); return `🎨 ${c ? c.label : l.key}`; }
    return "?";
  }

  // ---------------------------------------------------------------- fabrique de recompenses
  const opt = (list, val, label = (x) => x.label) => list.map((x) => `<option value="${esc(x.key)}" ${x.key === val ? "selected" : ""}>${esc(label(x))}</option>`).join("");
  const cardOpts = (val) => cards.map((c) => `<option value="${c.cardId}" ${c.cardId === Number(val) ? "selected" : ""}>${esc(c.name)} · ${esc(c.rarity?.name || "")}${c.isPromo ? " (promo)" : ""}${c.isSecret ? " (secrète)" : ""}</option>`).join("");
  function resOpts(val) {
    const groups = [...new Set(cat.resources.map((r) => r.group))];
    return groups.map((g) => `<optgroup label="${esc(g)}">${cat.resources.filter((r) => r.group === g).map((r) => `<option value="${r.key}" ${r.key === val ? "selected" : ""}>${r.icon} ${esc(r.label)}</option>`).join("")}</optgroup>`).join("");
  }
  const variant = (l, i) => `
    <select data-f="finish" data-i="${i}" aria-label="Finition">${opt(cat.finishes, l.finish || "normal", (x) => "Finition " + x.label)}</select>
    <select data-f="quality" data-i="${i}" aria-label="État">${opt(cat.qualities, l.quality || "good", (x) => x.label)}</select>
    <select data-f="edition" data-i="${i}" aria-label="Édition"><option value="">Sans édition</option>${opt(cat.editions, l.edition || "", (x) => x.icon + " " + x.label)}</select>`;
  function lineHtml(l, i) {
    const res = l.type === "resource" ? cat.resources.find((r) => r.key === l.key) : null;
    const body = l.type === "resource"
      ? `<select data-f="key" data-i="${i}" aria-label="Ressource">${resOpts(l.key)}</select><input type="number" data-f="n" data-i="${i}" min="1" max="${res ? res.max : 1}" value="${l.n}" aria-label="Quantité" /><small class="muted">max ${res ? res.max.toLocaleString("fr-FR") : ""}</small>`
      : l.type === "card"
        ? `<select data-f="cardId" data-i="${i}" class="rw-card-sel" aria-label="Carte">${cardOpts(l.cardId)}</select><input type="number" data-f="n" data-i="${i}" min="1" max="50" value="${l.n}" aria-label="Exemplaires" />${variant(l, i)}`
        : l.type === "randomCard"
          ? `<select data-f="rarity" data-i="${i}" aria-label="Rareté">${opt(cat.rarities, l.rarity, (x) => x.name)}</select><input type="number" data-f="n" data-i="${i}" min="1" max="50" value="${l.n}" aria-label="Nombre de cartes" />${variant(l, i)}`
          : `<select data-f="key" data-i="${i}" aria-label="Cosmétique">${opt(cat.cosmetics, l.key, (x) => ({ title: "🏷️ Titre", frame: "🖼️ Cadre", color: "🎨 Couleur" }[x.type] + " · " + x.label))}</select>`;
    const kind = { resource: "Ressource", card: "Carte précise", randomCard: "Carte au hasard", cosmetic: "Cosmétique" }[l.type];
    return `<li class="rw-line" data-type="${l.type}"><span class="rw-kind">${kind}</span><div class="rw-fields">${body}</div><button type="button" class="btn-ghost rw-del" data-del="${i}" aria-label="Retirer cette ligne">✕</button></li>`;
  }
  function builder(id) {
    const b = builders[id];
    return `
      <div class="rw-builder" data-builder="${id}">
        <div class="rw-presets"><small class="muted">Raccourcis :</small>${PRESETS.map((p, i) => `<button type="button" class="rw-chip" data-preset="${i}">${esc(p.label)}</button>`).join("")}</div>
        <ol class="rw-lines">${b.lines.map(lineHtml).join("") || `<li class="rw-empty muted">Aucune récompense : ajoute-en avec les boutons ci-dessous ou un raccourci.</li>`}</ol>
        <div class="rw-add">
          <button type="button" class="btn-secondary" data-add="resource">+ Ressource</button>
          <button type="button" class="btn-secondary" data-add="card">+ Carte précise</button>
          <button type="button" class="btn-secondary" data-add="randomCard">+ Carte au hasard</button>
          ${cat.cosmetics.length ? `<button type="button" class="btn-secondary" data-add="cosmetic">+ Cosmétique</button>` : ""}
        </div>
        <div class="rw-summary" data-summary="${id}">${summary(id)}</div>
      </div>`;
  }
  const summary = (id) => (builders[id].lines.length ? `<strong>Le joueur reçoit :</strong> ${builders[id].lines.map((l) => `<span class="rw-pill">${esc(describe(l))}</span>`).join("")}` : "");
  const fresh = (type) => ({ resource: { type, key: "booster", n: 1 }, card: { type, cardId: cards[0] ? cards[0].cardId : 0, n: 1, finish: "normal", quality: "good", edition: "" }, randomCard: { type, rarity: (cat.rarities[0] || {}).key, n: 1, finish: "normal", quality: "good", edition: "" }, cosmetic: { type, key: (cat.cosmetics[0] || {}).key } }[type]);
  function wireBuilder(root, id) {
    const b = builders[id];
    const redraw = () => { root.querySelector(`[data-builder="${id}"]`).outerHTML = builder(id); wire(); };
    const wire = () => {
      const el = root.querySelector(`[data-builder="${id}"]`);
      el.onclick = (e) => {
        const add = e.target.closest("[data-add]"); if (add) { if (b.lines.length >= cat.limits.lines) return Toast.info(`${cat.limits.lines} lignes au plus.`); b.lines.push(fresh(add.dataset.add)); redraw(); return; }
        const del = e.target.closest("[data-del]"); if (del) { b.lines.splice(Number(del.dataset.del), 1); redraw(); return; }
        const pr = e.target.closest("[data-preset]"); if (pr) { PRESETS[Number(pr.dataset.preset)].lines.forEach((l) => { if (b.lines.length < cat.limits.lines) b.lines.push({ ...l }); }); redraw(); }
      };
      el.oninput = el.onchange = (e) => {
        const f = e.target.dataset.f; if (!f) return;
        const l = b.lines[Number(e.target.dataset.i)]; if (!l) return;
        l[f] = ["n", "cardId"].includes(f) ? Number(e.target.value) : e.target.value;
        if (f === "key" && l.type === "resource" && e.type === "change") { redraw(); return; }
        el.querySelector(`[data-summary="${id}"]`).innerHTML = summary(id);
      };
    };
    wire();
  }
  const clean = (lines) => lines.map((l) => ({ ...l, n: Math.max(1, Number(l.n) || 1) }));

  // ---------------------------------------------------------------- onglets
  function render() {
    const app = $("rw-app");
    const live = codes.filter((c) => c.status === "active"), soon = codes.filter((c) => c.status === "scheduled");
    const endingSoon = live.filter((c) => c.expiresAt && c.expiresAt - nowS() < 86400).length;
    app.innerHTML = `
      <div class="rw-stats">
        <button type="button" class="rw-stat" data-goto-list="live"><strong>${live.length}</strong><span>code${live.length > 1 ? "s" : ""} actif${live.length > 1 ? "s" : ""}</span>${endingSoon ? `<small>${endingSoon} finit dans moins de 24 h</small>` : ""}</button>
        <button type="button" class="rw-stat" data-goto-list="live"><strong>${soon.length}</strong><span>programmé${soon.length > 1 ? "s" : ""}</span></button>
        <button type="button" class="rw-stat" data-goto-list="all"><strong>${codes.reduce((n, c) => n + (Number(c.used) || 0), 0).toLocaleString("fr-FR")}</strong><span>réclamations au total</span></button>
        <button type="button" class="rw-stat" data-tab-go="gift"><strong>&#127873;</strong><span>Faire un don</span></button>
      </div>
      <nav class="adm-seg rw-tabs" role="tablist">
        <button type="button" class="btn-secondary ${tab === "code" ? "active" : ""}" data-tab="code">🎟️ Nouveau code</button>
        <button type="button" class="btn-secondary ${tab === "gift" ? "active" : ""}" data-tab="gift">🎁 Don direct</button>
        <button type="button" class="btn-secondary ${tab === "list" ? "active" : ""}" data-tab="list">📋 Codes (${codes.filter((c) => ["active", "scheduled"].includes(c.status)).length} en cours)</button>
      </nav>
      <div id="rw-pane"></div>`;
    app.querySelector(".rw-tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(); } };
    app.querySelector(".rw-stats").onclick = (e) => {
      const l = e.target.closest("[data-goto-list]"); if (l) { listFilter = l.dataset.gotoList; tab = "list"; render(); return; }
      const g = e.target.closest("[data-tab-go]"); if (g) { tab = g.dataset.tabGo; render(); }
    };
    ({ code: paneCode, gift: paneGift, list: paneList })[tab]();
  }

  // Ce que le joueur verra en reclamant le code (page « Reclamer un code »).
  function playerPreview() {
    const d = builders.code.draft || {};
    const lines = builders.code.lines;
    const start = d.startsAt || 0, end = d.expiresAt || 0;
    return `<div class="rw-player">
      <small class="muted">Aperçu côté joueur</small>
      <div class="rw-player-card">
        <span class="rw-player-code">${esc((d.code || "").toUpperCase() || "CODE")}</span>
        <strong>${esc(d.label || "Code événement")}</strong>
        <div class="rw-player-gifts">${lines.length ? lines.map((l) => `<span class="rw-pill">${esc(describe(l))}</span>`).join("") : `<span class="muted">Ajoute une récompense…</span>`}</div>
        <small class="muted">${start ? `À partir du ${fmtDate(start)} · ` : ""}${end ? `jusqu'au ${fmtDate(end)}` : ""}${d.maxRedemptions ? ` · ${d.maxRedemptions} joueurs max` : ""}</small>
      </div></div>`;
  }
  function paneCode() {
    const p = $("rw-pane");
    const t = nowS();
    p.innerHTML = `
      <div class="rw-code-layout">
      <div class="rw-steps">
      <section class="rw-step"><h3><span class="rw-step-n">1</span> Ce que le joueur reçoit</h3>
      ${builder("code")}
      </section>
      <section class="rw-step"><h3><span class="rw-step-n">2</span> Le code et sa période</h3>
      <div class="rw-grid">
        <label>Code <small class="muted">(vide = généré)</small><input type="text" id="rw-code" maxlength="24" placeholder="ex : SOIREE20" value="${esc(builders.code.draft.code || "")}" /></label>
        <label>Titre <small class="muted">(vu par le joueur, et note interne)</small><input type="text" id="rw-label" maxlength="60" placeholder="ex : Soirée jeux du 20/11" value="${esc(builders.code.draft.label || "")}" /></label>
        <label>Début <small class="muted">(vide = tout de suite)</small><input type="datetime-local" id="rw-start" value="${builders.code.draft.startsAt ? toLocal(builders.code.draft.startsAt) : ""}" /></label>
        <label>Fin<input type="datetime-local" id="rw-end" value="${toLocal(builders.code.draft.expiresAt || t + 4 * 3600)}" /></label>
        <div class="rw-quick"><small class="muted">Durée depuis le début :</small>${[["2 h", 2], ["4 h", 4], ["1 jour", 24], ["3 jours", 72], ["1 semaine", 168], ["1 mois", 720]].map(([l, h]) => `<button type="button" class="rw-chip" data-dur="${h}">${l}</button>`).join("")}</div>
        <label>Joueurs max <small class="muted">(0 = illimité)</small><input type="number" id="rw-max" min="0" value="${builders.code.draft.maxRedemptions || 0}" /></label>
      </div>
      </section>
      <section class="rw-step"><h3><span class="rw-step-n">3</span> L'annonce</h3>
        <label class="adm-check rw-announce"><input type="checkbox" id="rw-announce" ${builders.code.draft.announce ? "checked" : ""} /> &#128227; Annoncer sur le serveur <small class="muted">(message Discord, et le code s'affiche dans le calendrier des évènements ; texte réglable dans Admin &rarr; Discord)</small></label>
        <div class="rw-actions"><button type="button" class="btn" id="rw-create">Créer le code</button></div>
      </section>
      </div>
      <aside class="rw-side" id="rw-preview">${playerPreview()}</aside>
      </div>
      <div id="rw-created"></div>`;
    wireBuilder(p, "code");
    p.querySelector(".rw-quick").onclick = (e) => {
      const d = e.target.closest("[data-dur]"); if (!d) return;
      const start = fromLocal($("rw-start").value) || nowS();
      $("rw-end").value = toLocal(start + Number(d.dataset.dur) * 3600);
      $("rw-end").dispatchEvent(new Event("input"));
    };
    $("rw-create").onclick = async (e) => {
      const btn = e.currentTarget;
      const body = { code: $("rw-code").value.trim(), label: $("rw-label").value.trim(), startsAt: fromLocal($("rw-start").value), expiresAt: fromLocal($("rw-end").value), maxRedemptions: Number($("rw-max").value) || 0, announce: $("rw-announce").checked, rewards: clean(builders.code.lines) };
      btn.disabled = true;
      try {
        const r = await api("createCode", body);
        codes = r.codes || codes;
        const c = r.created;
        const msg = `🎁 Code ${c.code} : ${c.lines.map((l) => l.label).join(", ")}${c.startsAt ? ` · à partir du ${fmtDate(c.startsAt)}` : ""} · jusqu'au ${fmtDate(c.expiresAt)}${c.maxRedemptions ? ` · ${c.maxRedemptions} joueurs max` : ""}. À réclamer sur la page « Réclamer un code » !`;
        $("rw-created").innerHTML = `<div class="rw-created"><span class="rw-code-big">${esc(c.code)}</span><button type="button" class="btn-secondary" data-copy="${esc(c.code)}">📋 Copier le code</button><button type="button" class="btn-secondary" data-copy="${esc(msg)}">💬 Copier l'annonce</button><p class="muted">${esc(msg)}</p></div>`;
        Toast.success(`Code ${c.code} créé.${body.announce ? (r.posted ? " Annoncé sur Discord et dans le calendrier." : " Visible dans le calendrier (pas de message Discord : webhook absent ou annonce désactivée).") : ""}`);
        builders.code.lines = []; builders.code.draft = {};
        $("rw-code").value = ""; $("rw-label").value = "";
        p.querySelector(`[data-builder="code"]`).outerHTML = builder("code"); wireBuilder(p, "code");
      } catch (err) { Toast.error(errText(err)); }
      finally { btn.disabled = false; }
    };
    const syncDraft = () => { builders.code.draft = { code: $("rw-code").value, label: $("rw-label").value, startsAt: fromLocal($("rw-start").value), expiresAt: fromLocal($("rw-end").value), maxRedemptions: Number($("rw-max").value) || 0, announce: $("rw-announce").checked }; $("rw-preview").innerHTML = playerPreview(); };
    ["rw-code", "rw-label", "rw-start", "rw-end", "rw-max", "rw-announce"].forEach((id) => $(id).addEventListener(id === "rw-announce" ? "change" : "input", syncDraft));
    // Recompenses changees (fabrique) : apercu a jour.
    p.querySelector(".rw-steps").addEventListener("click", () => setTimeout(() => { if ($("rw-preview")) $("rw-preview").innerHTML = playerPreview(); }, 0));
    p.querySelector(".rw-steps").addEventListener("input", () => { if ($("rw-preview")) $("rw-preview").innerHTML = playerPreview(); });
  }

  function paneGift() {
    const p = $("rw-pane");
    const sel = builders.gift.users;
    p.innerHTML = `
      <h3>Joueurs <small class="muted">(${sel.size} choisi${sel.size > 1 ? "s" : ""})</small></h3>
      <div class="rw-users">
        <div class="rw-user-bar"><input type="search" id="rw-user-q" placeholder="Rechercher un pseudo…" value="${esc(builders.gift.q || "")}" /><button type="button" class="btn-ghost" id="rw-user-all">Tout cocher (liste filtrée)</button><button type="button" class="btn-ghost" id="rw-user-none">Tout décocher</button></div>
        <div class="rw-user-chips">${[...sel].map((id) => { const u = users.find((x) => x.userId === id); return `<button type="button" class="rw-chip on" data-unsel="${id}">${esc(u ? u.pseudo : "#" + id)} ✕</button>`; }).join("")}</div>
        <ul class="rw-user-list" id="rw-user-list"></ul>
      </div>
      <h3>Récompenses</h3>
      ${builder("gift")}
      <div class="rw-actions"><button type="button" class="btn" id="rw-send">Envoyer le don</button></div>
      <div id="rw-gift-result"></div>`;
    const list = () => {
      const q = (builders.gift.q || "").trim().toLowerCase();
      const shown = users.filter((u) => !q || (u.pseudo || "").toLowerCase().includes(q)).slice(0, 200);
      $("rw-user-list").innerHTML = shown.map((u) => `<li><label><input type="checkbox" data-user="${u.userId}" ${sel.has(u.userId) ? "checked" : ""} /> ${esc(u.pseudo || "#" + u.userId)}</label></li>`).join("") || `<li class="muted">Aucun joueur.</li>`;
      return shown;
    };
    list();
    $("rw-user-q").oninput = (e) => { builders.gift.q = e.target.value; list(); };
    $("rw-user-list").onchange = (e) => { const id = Number(e.target.dataset.user); if (!id) return; if (e.target.checked) sel.add(id); else sel.delete(id); paneGift(); };
    $("rw-user-all").onclick = () => { list().forEach((u) => sel.add(u.userId)); paneGift(); };
    $("rw-user-none").onclick = () => { sel.clear(); paneGift(); };
    p.querySelector(".rw-user-chips").onclick = (e) => { const b = e.target.closest("[data-unsel]"); if (b) { sel.delete(Number(b.dataset.unsel)); paneGift(); } };
    wireBuilder(p, "gift");
    $("rw-send").onclick = async (e) => {
      const btn = e.currentTarget;
      if (!sel.size) return Toast.info(ERR.no_user);
      if (!builders.gift.lines.length) return Toast.info(ERR.no_reward);
      const who = [...sel].map((id) => (users.find((u) => u.userId === id) || {}).pseudo || "#" + id);
      const ok = await Confirm.show(`Envoyer à <strong>${who.length > 5 ? who.length + " joueurs" : who.map(esc).join(", ")}</strong> :<br>${builders.gift.lines.map((l) => esc(describe(l))).join("<br>")}`, { title: "Confirmer le don", confirmText: "Envoyer" });
      if (!ok) return;
      btn.disabled = true;
      try {
        const r = await api("gift", { userIds: [...sel], rewards: clean(builders.gift.lines) });
        Toast.success(`Don envoyé à ${r.gifted} joueur${r.gifted > 1 ? "s" : ""}.`);
        $("rw-gift-result").innerHTML = `<div class="rw-created"><strong>✅ Don envoyé</strong><ul>${r.results.map((x) => `<li>${esc(x.pseudo)} : ${x.rewards.map((l) => esc(l.icon + " " + l.label)).join(", ")}</li>`).join("")}</ul></div>`;
      } catch (err) { Toast.error(errText(err)); }
      finally { btn.disabled = false; }
    };
  }

  function paneList() {
    const p = $("rw-pane");
    const F = { live: (c) => ["active", "scheduled"].includes(c.status), done: (c) => !["active", "scheduled"].includes(c.status), all: () => true };
    const q = listQuery.trim().toLowerCase();
    const rows = codes.filter(F[listFilter]).filter((c) => !q || c.code.toLowerCase().includes(q) || (c.label || "").toLowerCase().includes(q));
    p.innerHTML = `
      <div class="rw-list-bar">
        <div class="adm-seg">${[["live", "En cours"], ["done", "Terminés"], ["all", "Tous"]].map(([k, l]) => `<button type="button" class="btn-secondary ${listFilter === k ? "active" : ""}" data-lf="${k}">${l}</button>`).join("")}</div>
        <input type="search" id="rw-list-q" placeholder="Chercher un code ou une note…" value="${esc(listQuery)}" />
        <button type="button" class="btn-ghost" id="rw-refresh">↻ Actualiser</button>
      </div>
      ${rows.length ? `<div class="rw-code-cards">${rows.map((c) => {
        const [sl, sc] = STATUS[c.status] || [c.status, "off"];
        const pct = c.maxRedemptions ? Math.min(100, Math.round((c.used / c.maxRedemptions) * 100)) : 0;
        const left = c.expiresAt ? c.expiresAt - nowS() : 0;
        // Decompte en direct (shell-extras.js Countdown).
        const when = c.status === "scheduled" ? `Commence dans <strong data-countdown-to="${c.startsAt}" data-countdown-done="un instant"></strong> (${fmtDate(c.startsAt)})` : c.status === "active" ? (c.expiresAt ? `Finit dans <strong data-countdown-to="${c.expiresAt}" data-countdown-done="un instant"></strong>${left >= 86400 ? ` (${fmtDate(c.expiresAt)})` : ""}` : "Sans fin") : `Fini le ${fmtDate(c.expiresAt)}`;
        const live = ["active", "scheduled"].includes(c.status);
        return `<article class="rw-code-card ${sc}">
          <header><button type="button" class="rw-code" data-copy="${esc(c.code)}" title="Copier le code">${esc(c.code)} <span aria-hidden="true">&#128203;</span></button><span class="rw-status ${sc}">${sl}</span>${c.announced ? ' <span class="rw-status info" title="Annoncé sur Discord et affiché dans le calendrier">&#128227; annoncé</span>' : ""}</header>
          ${c.label ? `<p class="rw-code-label">${esc(c.label)}</p>` : ""}
          <div class="rw-code-gifts">${c.lines.map((l) => `<span class="rw-pill">${esc(l.icon + " " + l.label)}</span>`).join("")}</div>
          <div class="rw-code-usage"><span><strong>${c.used}</strong>${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""} joueur${c.used > 1 ? "s" : ""}${c.maxRedemptions ? "" : " · illimité"}</span>${c.maxRedemptions ? `<span class="rw-bar wide"><span style="width:${pct}%"></span></span>` : ""}</div>
          <p class="rw-code-when muted">${when}</p>
          <footer class="rw-code-actions">
            <button type="button" class="btn-ghost" data-who="${esc(c.code)}">&#128101; Qui ?</button>
            ${!c.announced && live ? `<button type="button" class="btn-ghost" data-announce="${esc(c.code)}">&#128227; Annoncer</button>` : ""}
            <button type="button" class="btn-ghost" data-extend="${esc(c.code)}">+1 jour</button>
            <button type="button" class="btn-ghost" data-toggle="${esc(c.code)}" data-on="${c.active ? 1 : 0}">${c.active ? "&#9208; Désactiver" : "&#9654; Réactiver"}</button>
            ${c.kind === "bundle" || c.kind === "booster" || c.kind === "card" ? `<button type="button" class="btn-ghost" data-dup="${esc(c.code)}">&#10697; Dupliquer</button>` : ""}
          </footer>
        </article>`;
      }).join("")}</div>` : `<p class="muted">Aucun code ici.</p>`}
      <div id="rw-who"></div>`;
    p.querySelector(".rw-list-bar .adm-seg").onclick = (e) => { const b = e.target.closest("[data-lf]"); if (b) { listFilter = b.dataset.lf; paneList(); } };
    $("rw-list-q").oninput = (e) => { listQuery = e.target.value; const pos = e.target.selectionStart; paneList(); const i = $("rw-list-q"); i.focus(); i.setSelectionRange(pos, pos); };
    $("rw-refresh").onclick = async () => { await loadCodes(); paneList(); };
    p.onclick = async (e) => {
      const who = e.target.closest("[data-who]");
      if (who) {
        try { const r = await api("redemptions", { code: who.dataset.who }); $("rw-who").innerHTML = `<div class="rw-created"><strong>👥 ${esc(r.code)} : ${r.redemptions.length} joueur${r.redemptions.length > 1 ? "s" : ""}</strong><ul>${r.redemptions.map((x) => `<li>${esc(x.pseudo)} <small class="muted">${fmtDate(x.at)}</small></li>`).join("") || "<li class='muted'>Personne pour l'instant.</li>"}</ul></div>`; $("rw-who").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
        catch (err) { Toast.error(errText(err)); }
        return;
      }
      const an = e.target.closest("[data-announce]");
      if (an) {
        if (!(await Confirm.show(`Annoncer le code <strong>${esc(an.dataset.announce)}</strong> sur Discord et l'afficher dans le calendrier des évènements ?`, { title: "Annoncer le code", confirmText: "Annoncer" }))) return;
        try { const r = await api("updateCode", { code: an.dataset.announce, announce: true }); codes = r.codes; Toast.success(r.posted ? "Annoncé sur Discord et dans le calendrier." : "Affiché dans le calendrier (pas de message Discord : webhook absent ou annonce désactivée)."); paneList(); } catch (err) { Toast.error(errText(err)); }
        return;
      }
      const ext = e.target.closest("[data-extend]");
      if (ext) { const c = codes.find((x) => x.code === ext.dataset.extend); try { const r = await api("updateCode", { code: c.code, expiresAt: Math.max(nowS(), c.expiresAt || 0) + 86400, active: true }); codes = r.codes; Toast.success(`${c.code} prolongé d'un jour.`); paneList(); } catch (err) { Toast.error(errText(err)); } return; }
      const tg = e.target.closest("[data-toggle]");
      if (tg) { try { const r = await api("updateCode", { code: tg.dataset.toggle, active: tg.dataset.on !== "1" }); codes = r.codes; paneList(); } catch (err) { Toast.error(errText(err)); } return; }
      const dup = e.target.closest("[data-dup]");
      if (dup) {
        const c = codes.find((x) => x.code === dup.dataset.dup);
        builders.code.lines = c.rewards.map((l) => ({ ...l }));
        builders.code.draft = { label: c.label, maxRedemptions: c.maxRedemptions, expiresAt: nowS() + Math.max(3600, (c.expiresAt || 0) - (c.startsAt || c.createdAt || nowS())) };
        tab = "code"; render(); Toast.info("Récompenses reprises : choisis le nouveau code et les dates.");
      }
    };
  }

  async function loadCodes() { try { codes = (await api("codes")).codes || []; } catch (e) { /* liste vide */ } }

  // Copier (code, annonce).
  document.addEventListener("click", (e) => {
    const c = e.target.closest("#rw-app [data-copy]");
    if (!c) return;
    navigator.clipboard.writeText(c.dataset.copy).then(() => Toast.success("Copié !"), () => Toast.error("Copie impossible."));
  });

  async function init() {
    const app = $("rw-app");
    if (!app || !Session.discordId) return;
    builders.code = { lines: [], draft: {} };
    builders.gift = { lines: [], users: new Set(), q: "" };
    try { cat = await api("catalog"); }
    catch (e) {
      // Serveur injoignable : les formulaires classiques restent utilisables.
      app.innerHTML = `<p class="error-box">Codes et dons indisponibles pour l'instant (${escHtml(friendlyError(e))}). Les formulaires classiques ci-dessous restent utilisables.</p>`;
      const legacy = $("codes-legacy"); if (legacy) legacy.open = true;
      return;
    }
    const [cr, ur] = await Promise.allSettled([API.getCards(), API.listUsers()]);
    cards = cr.status === "fulfilled" ? (cr.value.cards || []).slice().sort((a, b) => a.name.localeCompare(b.name)) : [];
    users = ur.status === "fulfilled" ? (ur.value.users || []).slice().sort((a, b) => (a.pseudo || "").localeCompare(b.pseudo || "")) : [];
    await loadCodes();
    render();
  }
  // Depuis la fiche d'un joueur (admin-player.js) : don pre-rempli.
  window.RewardsAdmin = {
    giftTo(userId) {
      const nav = document.querySelector('[data-pane="codes"]');
      if (nav) nav.click();
      if (!cat) return;
      builders.gift.users.add(userId);
      tab = "gift"; render();
      document.getElementById("rw-app").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0));
})();
