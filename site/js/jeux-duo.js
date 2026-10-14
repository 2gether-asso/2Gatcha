// Expedition en duo (Jeux > Expedition, 2026-10-15) : inviter un joueur,
// accepter une invitation, recuperer le butin partage.
// Donnees : api/src/native/duo.js.

(function () {
  const esc = escHtml;
  const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
  const left = (t) => { const s = Math.max(0, t - Date.now() / 1000); const h = Math.floor(s / 3600), m = Math.ceil((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
  let cards = null, users = null;

  // Mes cartes (une ligne par carte, le meilleur exemplaire) pour l'invitation.
  async function myCards() {
    if (cards) return cards;
    const coll = await API.getCollection(Session.userId);
    const byId = new Map((coll.cards || []).map((c) => [c.cardId, c]));
    cards = (coll.owned || []).filter((o) => (o.copies || []).length).map((o) => ({ pullId: o.copies[0].pullId, card: byId.get(o.cardId) })).filter((x) => x.card)
      .sort((a, b) => (b.card.rarity?.sortOrder || 0) - (a.card.rarity?.sortOrder || 0) || a.card.name.localeCompare(b.card.name));
    return cards;
  }
  async function partners() {
    if (users) return users;
    users = ((await API.listUsers()).users || []).filter((u) => String(u.userId) !== String(Session.userId));
    return users;
  }
  const cardOptions = (list) => list.map((x) => `<option value="${x.pullId}">${esc(x.card.name)}${x.card.rarity ? " · " + esc(x.card.rarity.name) : ""}</option>`).join("");

  function itemHtml(d, list) {
    const pair = `<span class="duo-pair"><b>${esc(d.from)}</b>${d.fromCard ? ` (${esc(d.fromCard.name)})` : ""} &amp; <b>${esc(d.to)}</b>${d.toCard ? ` (${esc(d.toCard.name)})` : ""}</span>`;
    if (d.status === "invited" && d.role === "to") return `<li class="duo-item">${pair}<p>${esc(d.from)} t'invite en expédition. Choisis ta carte :</p>
      <div class="duo-row"><select data-duo-card="${d.id}">${cardOptions(list)}</select><button type="button" class="btn" data-duo="accept" data-id="${d.id}">Partir</button><button type="button" class="btn-ghost" data-duo="decline" data-id="${d.id}">Refuser</button></div></li>`;
    if (d.status === "invited") return `<li class="duo-item">${pair}<p>En attente de la réponse de ${esc(d.to)}…</p><button type="button" class="btn-ghost" data-duo="cancel" data-id="${d.id}">Annuler l'invitation</button></li>`;
    if (d.ready) return `<li class="duo-item ready">${pair}<p>&#127881; L'expédition est rentrée ! Butin pour chacun : ${fmt(d.loot.dust)} &#10024;, ${d.loot.xp} XP${d.loot.booster ? ", 1 booster" : ""}.</p><button type="button" class="btn" data-duo="claim" data-id="${d.id}">Récupérer</button></li>`;
    return `<li class="duo-item">${pair}<p>&#129517; En route… retour dans ${left(d.endAt)}. Butin prévu : ${fmt(d.loot.dust)} &#10024;, ${d.loot.xp} XP${d.loot.booster ? ", 1 booster" : ""}.</p></li>`;
  }

  async function load() {
    const box = document.getElementById("duo-expedition");
    if (!box || !Session.isLoggedIn() || !API.duoExpedition) return;
    let st;
    try { st = await API.duoExpedition(Session.userId); } catch (e) { box.hidden = true; return; }
    if (!st.enabled) { box.hidden = true; return; }
    box.hidden = false;
    const needCards = !st.busy || st.items.some((d) => d.status === "invited" && d.role === "to");
    const [list, people] = needCards ? await Promise.all([myCards().catch(() => []), st.busy ? Promise.resolve([]) : partners().catch(() => [])]) : [[], []];
    box.innerHTML = `
      <h3>&#128111; Expédition en duo</h3>
      <p class="lead" style="font-size:0.82rem;">Pars à deux : chacun envoie une carte, l'expédition dure ${st.hours} h et chacun récupère le même butin, plus gros qu'en solo (selon la rareté des deux cartes). Les cartes restent dans vos collections.</p>
      ${st.items.length ? `<ul class="duo-list">${st.items.map((d) => itemHtml(d, list)).join("")}</ul>` : ""}
      ${st.busy ? "" : `
      <form class="duo-form" id="duo-form">
        <label>Partenaire<input list="duo-partners" name="partner" placeholder="Pseudo" required autocomplete="off" /></label>
        <datalist id="duo-partners">${people.map((u) => `<option value="${esc(u.pseudo)}"></option>`).join("")}</datalist>
        <label>Ta carte<select name="pull">${cardOptions(list)}</select></label>
        <button type="submit" class="btn">Inviter</button>
      </form>`}`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const box = document.getElementById("duo-expedition");
    if (!box) return;
    load();
    box.addEventListener("submit", async (e) => {
      if (e.target.id !== "duo-form") return;
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector("button");
      btn.disabled = true;
      try {
        const r = await API.duoExpedition(Session.userId, "invite", { toPseudo: f.partner.value.trim(), pullId: Number(f.pull.value) });
        Toast.success(`&#128111; Invitation envoyée à ${esc(r.invited)} !`);
        load();
      } catch (err) {
        btn.disabled = false;
        Toast.error({ unknown_partner: "Joueur introuvable.", already_busy: "Tu as déjà une expédition en duo en cours.", invalid_card: "Choisis une de tes cartes." }[err.code] || "Erreur. (" + err.message + ")");
      }
    });
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-duo]");
      if (!b) return;
      const id = Number(b.dataset.id), action = b.dataset.duo;
      const params = { id };
      if (action === "accept") params.pullId = Number(box.querySelector(`[data-duo-card="${id}"]`).value);
      b.disabled = true;
      try {
        const r = await API.duoExpedition(Session.userId, action, params);
        if (action === "claim") Toast.success(`&#127881; Butin récupéré : +${fmt(r.loot.dust)} ✨${r.loot.booster ? " et 1 booster" : ""} !`);
        if (action === "accept") Toast.success("&#129517; C'est parti pour l'expédition en duo !");
        if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
        load();
      } catch (err) {
        b.disabled = false;
        Toast.error({ not_ready: "L'expédition n'est pas encore rentrée.", not_pending: "Cette invitation n'est plus valable.", already_busy: "Tu as déjà une expédition en duo en cours." }[err.code] || "Erreur. (" + err.message + ")");
      }
    });
  });
})();
