// Page "Mode du moment" (2026-10-16) : regles du mode en cours et ses
// fonctionnalites exclusives (api/src/native/moderules.js, modefun.js,
// draft.js, chaosvote.js). Chaque bloc n'apparait que si sa regle est active.

(function () {
  const esc = escHtml;
  const FIN = { normal: "Normal", holo: "Holo", gold: "Doré", ghost: "Ghost", diamond: "Diamant", rainbow: "Arc-en-ciel" };
  const QUA = { damaged: "Usé", worn: "Abîmé", good: "Bon état", mint: "Parfait état" };
  const KIND = { bonus: "Bonus", malus: "Malus", extra: "Exclusivité" };
  const serial = fmtSerial; // core.js
  const fmtH = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`; };
  const nowS = () => Math.floor(Date.now() / 1000);
  let vac = null;
  let rules = null, extra = null, draftSt = null, voteSt = null, collection = null, users = null;
  let draftTimer = null;

  // Petite carte (image + nom + rarete).
  function mini(card, sub = "", attrs = "") {
    if (!card) return "";
    const img = card.imageId ? API.imageUrl(card.imageId) : "";
    return `<div class="md-card" data-rarity="${card.rarity?.key || "commune"}" ${attrs}>
      <div class="md-card-art">${img ? `<img src="${img}" alt="" loading="lazy" decoding="async" />` : "🃏"}</div>
      <div class="md-card-name">${esc(card.name || "?")}</div>
      <div class="md-card-sub">${card.rarity ? `<span style="color:${card.rarity.colorHex || "inherit"}">${esc(card.rarity.name || "")}</span>` : ""}${sub ? " · " + sub : ""}</div>
    </div>`;
  }
  const block = (id, icon, title, body, cls = "") => `<section class="md-block ${cls}" id="md-${id}"><h2>${icon} ${title}</h2>${body}</section>`;
  const copyLabel = (c) => [serial(c.serialNumber), FIN[c.finish] || "", QUA[c.quality] || "", c.edition && EDITIONS[c.edition] ? EDITIONS[c.edition].icon + " " + EDITIONS[c.edition].label : ""].filter(Boolean).join(" · ");

  async function ensureCollection() {
    if (collection) return collection;
    const c = await API.getCollection(Session.userId);
    const byId = new Map((c.cards || []).map((x) => [x.cardId, x]));
    collection = (c.owned || []).flatMap((o) => (o.copies || []).map((cp) => ({ ...cp, card: byId.get(o.cardId), edition: (c.editionPulls || {})[cp.pullId] || "" }))).filter((x) => x.card);
    return collection;
  }

  // ---------------------------------------------------------------- rendu
  function renderRules() {
    const hero = document.getElementById("md-hero");
    hero.querySelector("h1").innerHTML = `${rules.icon} Mode ${esc(rules.label)}`;
    document.getElementById("md-rules").innerHTML = rules.rules.map((r) => `
      <li class="md-rule md-rule-${r.kind}">
        <span class="md-rule-icon" aria-hidden="true">${r.icon}</span>
        <div><strong>${esc(r.label)}</strong>${r.isNew ? ' <span class="md-new">nouveau</span>' : ""} <span class="md-kind">${KIND[r.kind] || ""}</span><p>${esc(r.desc)}</p></div>
      </li>`).join("") || '<li class="muted">Aucune règle particulière en ce moment.</li>';
    const banners = [];
    if (rules.happyHour) banners.push(rules.happyHour.active ? `<div class="md-banner md-banner-happy">🍹 <strong>Happy hour en cours</strong> : boutique à -${Math.round(rules.happyHour.discount * 100)} % jusqu'à ${rules.happyHour.to} h ! <a href="boutique.html">Y aller</a></div>` : `<div class="md-banner">🍹 Happy hour chaque jour de ${rules.happyHour.from} h à ${rules.happyHour.to} h : boutique à -${Math.round(rules.happyHour.discount * 100)} %.</div>`);
    if (rules.storm) {
      const s = rules.storm;
      banners.push(s.active ? `<div class="md-banner md-banner-storm">⛈️ <strong>Tempête !</strong> ${s.label} est fermée jusqu'à ${s.to} h.</div>` : s.soon ? `<div class="md-banner md-banner-storm">⛈️ Une tempête approche : ${s.label} fermera de ${s.from} h à ${s.to} h. Fais tes provisions !</div>` : s.over ? "" : `<div class="md-banner">⛈️ Tempête prévue aujourd'hui sur ${s.label}, de ${s.from} h à ${s.to} h.</div>`);
    }
    document.getElementById("md-banners").innerHTML = banners.join("");
  }

  function renderWidgets() {
    const out = [];
    const x = extra || {};
    if (x.wishbox) {
      const w = x.wishbox;
      out.push(block("wishbox", "🎀", "Boîte à souhaits", w.set
        ? `<div class="md-row">${mini(w.card, w.done ? "reçue ✅" : `dans les ${w.left} prochains boosters`)}<p>${w.done ? "Ton souhait de la semaine est exaucé ! Reviens lundi pour en faire un autre." : `Elle tombera forcément dans un des <strong>${w.left}</strong> prochains boosters que tu ouvres.`}</p></div>`
        : w.wishlist.length ? `<p>Choisis une carte de ta liste de souhaits : elle tombera dans un de tes 10 prochains boosters. Une fois par semaine.</p><div class="md-grid">${w.wishlist.map((c) => `<button type="button" class="md-pick" data-wish="${c.cardId}">${mini(c)}</button>`).join("")}</div>`
          : `<p class="muted">Ta liste de souhaits est vide : ajoute des cartes depuis ta <a href="collection.html">collection</a> (étoile ⭐).</p>`));
    }
    if (x.freeRepair) {
      out.push(block("repair", "🧰", "Atelier gratuit", x.freeRepair.available
        ? `<p>Une restauration offerte aujourd'hui : un exemplaire gagne un cran d'état, sans rien sacrifier.</p><div class="md-form"><select id="md-repair-select"><option value="">Chargement…</option></select><button type="button" class="btn" id="md-repair-btn">Restaurer</button></div>`
        : `<p class="muted">Déjà utilisé aujourd'hui : reviens demain.</p>`));
    }
    if (x.secondChance) {
      const s = x.secondChance;
      out.push(block("second", "🔁", "Seconde chance", !s.available ? `<p class="muted">Déjà utilisée aujourd'hui.</p>` : s.cards.length
        ? `<p>Relance une carte de ton dernier booster : même rareté, même finition, même état, carte différente.</p><div class="md-grid">${s.cards.map((c) => `<button type="button" class="md-pick" data-second="${c.pullId}">${mini(c, copyLabel(c))}</button>`).join("")}</div>`
        : `<p class="muted">Ouvre un booster : tu pourras relancer une de ses cartes pendant 24 h.</p>`));
    }
    if (x.garden) {
      const g = x.garden;
      const wait = g.nextWaterAt - nowS();
      out.push(block("garden", "🌻", "Jardin partagé", `
        <p>Tout le monde arrose la même parcelle. À ${g.goal} arrosages, elle fleurit : 25 ✨ par arrosage (300 max) et 1 booster dès 3 arrosages.</p>
        <div class="md-progress"><span style="width:${Math.min(100, (g.total / g.goal) * 100)}%"></span></div>
        <p class="md-meta">${g.total} / ${g.goal} arrosages · ${g.gardeners} jardinier${g.gardeners > 1 ? "s" : ""} · toi : ${g.mine}</p>
        <button type="button" class="btn" id="md-water-btn" ${wait > 0 ? "disabled" : ""}>💧 ${wait > 0 ? `Arroser dans ${fmtH(wait)}` : "Arroser"}</button>`));
    }
    if (x.quest) {
      const q = x.quest;
      out.push(block("quest", "🗺️", `Quête : ${esc(q.title)}`, `
        <ol class="md-steps">${q.steps.map((s, i) => `<li class="md-step md-step-${s.state}"><span>${s.state === "done" ? "✅" : s.state === "current" ? "▶️" : "🔒"}</span> ${s.state === "locked" ? `Étape ${i + 1}` : esc(s.text)}</li>`).join("")}</ol>
        ${q.done ? `<p><strong>Quête terminée !</strong> Une nouvelle histoire lundi.</p>` : q.step ? `<div class="md-progress"><span style="width:${(q.step.progress / q.step.target) * 100}%"></span></div><p class="md-meta">${q.step.progress} / ${q.step.target} · récompense : ${esc(q.step.reward)}</p>${q.step.ready ? `<button type="button" class="btn" id="md-quest-btn">Récupérer et continuer</button>` : ""}` : ""}`));
    }
    if (x.stock) {
      const row = (l) => l.map((s) => `<li>${esc(s.card.name)} <strong class="${s.factor >= 1 ? "md-up" : "md-down"}">×${s.factor.toLocaleString("fr-FR")}</strong></li>`).join("") || '<li class="muted">—</li>';
      out.push(block("stock", "📊", "Bourse des cartes", `<p>Au décraft et au craft, chaque carte vaut selon sa rareté réelle sur le serveur.</p><div class="md-cols"><div><h3>📈 Les plus recherchées</h3><ul class="md-list">${row(x.stock.up)}</ul></div><div><h3>📉 Les plus répandues</h3><ul class="md-list">${row(x.stock.down)}</ul></div></div>`));
    }
    if (x.ironman) {
      const i = x.ironman;
      out.push(block("ironman", "🛡️", "Ironman", i.pledged
        ? `<p><strong>Serment en cours</strong> : aucun décraft jusqu'à la fin du mode Hard. À la clé : 5 boosters, le titre « Ironman 🛡️ » et le Cadre d'acier.</p><button type="button" class="btn-ghost" id="md-iron-abandon">Renoncer au serment</button>`
        : i.canPledge ? `<p>Jure de ne <strong>rien décrafter</strong> de toute la période Hard. Possible jusqu'au ${new Date(i.deadline * 1000).toLocaleString("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" })}.</p><button type="button" class="btn" id="md-iron-pledge">Prêter serment</button>`
          : i.broken ? `<p class="muted">Serment rompu pour cette période.</p>` : `<p class="muted">Le serment se prête dans les 48 premières heures du mode Hard.</p>`));
    }
    if (x.bounty) {
      const b = x.bounty;
      out.push(block("bounty", "💰", "Prime de chasse", b.card ? `
        <div class="md-row">${mini(b.card, b.winner ? `remportée par ${esc(b.winner)}` : "recherchée")}
        <div><p>${b.winner ? `La prime a été remportée par <strong>${esc(b.winner)}</strong>. Une nouvelle arrive bientôt.` : `Le premier qui livre un exemplaire gagne <strong>${b.reward.boosters} boosters + ${b.reward.dust} ✨</strong>. Fin : ${new Date(b.until * 1000).toLocaleString("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" })}.`}</p>
        ${!b.winner && b.copies.length ? `<div class="md-form"><select id="md-bounty-select">${b.copies.map((c) => `<option value="${c.pullId}">${esc(copyLabel(c))}</option>`).join("")}</select><button type="button" class="btn" id="md-bounty-btn">Livrer</button></div>` : !b.winner ? `<p class="muted">Tu n'en as aucun exemplaire livrable.</p>` : ""}</div></div>` : `<p class="muted">Aucune prime pour l'instant.</p>`));
    }
    if (x.cursed) {
      out.push(block("cursed", "🕯️", "Cartes maudites", x.cursed.length
        ? `<p>Purifie-les avant la fin du délai, sinon elles perdent un cran d'état.</p><ul class="md-cursed">${x.cursed.map((c) => `<li>${mini(c.card, copyLabel(c))}<div><span class="md-meta">${c.until > nowS() ? `encore ${fmtH(c.until - nowS())}` : "échue"}</span><button type="button" class="btn-secondary" data-purify="${c.pullId}">Purifier (${c.cost} ✨)</button></div></li>`).join("")}</ul>`
        : `<p class="muted">Aucune carte maudite. 5 % des cartes tirées en mode Hard le sont.</p>`));
    }
    if (x.theft) {
      const t = x.theft;
      out.push(block("theft", "🦹", "Larcin", `<p>Une clé pour tenter de voler un doublon à un joueur (${Math.round(t.chance * 100)} % de réussite). Les cartes assurées, au coffre, ★ ou en édition sont intouchables. Tentatives aujourd'hui : ${t.tries} / ${t.max} · clés : ${t.keys}.</p>
        <div class="md-form"><input type="text" id="md-theft-target" list="md-theft-users" placeholder="Pseudo de la cible" autocomplete="off" /><datalist id="md-theft-users"></datalist><button type="button" class="btn-danger" id="md-theft-btn" ${t.tries >= t.max || t.keys < 1 ? "disabled" : ""}>${resIcon("key")} Tenter</button></div>`));
    }
    if (x.unstable) {
      const u = x.unstable;
      out.push(block("unstable", "🌀", "Carte instable", u.card ? `<div class="md-row">${mini(u.card, `${FIN[u.card.finish] || ""} · change chaque jour`, `data-edition="glitch"`)}<p>Ta carte instable change d'image et de finition chaque jour tant que dure le Chaos, puis se fige.</p></div>`
        : u.canClaim ? `<p>Une carte Glitch offerte pour cette période Chaos : elle changera chaque jour…</p><button type="button" class="btn" id="md-unstable-btn">Récupérer ma carte instable</button>` : `<p class="muted">Déjà récupérée pour cette période.</p>`));
    }
    if (x.bugs) {
      out.push(block("bugs", "🐛", "Chasse aux bugs", `<p>Des « bugs » se cachent dans les pages du site aujourd'hui : un bouton qui fuit, un texte à l'envers, un pixel qui clignote… Clique dessus pour gagner ${x.bugs.dust} ✨ chacun.</p><p class="md-meta">Trouvés aujourd'hui : <strong>${x.bugs.found} / ${x.bugs.total}</strong></p>`));
    }
    renderVacation(out);
    if (voteSt && voteSt.active) {
      out.push(block("vote", "🗳️", "Règle de demain", `<p>Vote pour la règle du Chaos de demain (${voteSt.total} vote${voteSt.total > 1 ? "s" : ""}).</p><div class="md-vote">${voteSt.candidates.map((c) => `<button type="button" class="md-vote-opt ${voteSt.mine === c.key ? "is-mine" : ""}" data-vote="${c.key}"><span>${c.icon}</span><span>${esc(c.label)}</span><strong>${c.votes}</strong></button>`).join("")}</div>`));
    }
    if (draftSt) out.push(renderDraft());
    document.getElementById("md-widgets").innerHTML = out.join("");
    fillForms();
  }

  // Vacances du mode Chill (api/src/native/vacation.js).
  function renderVacation(out) {
    const v = vac || {};
    const left = (at) => fmtH(at - nowS());
    if (v.sunset) {
      const s = v.sunset;
      out.push(block("sunset", "🌅", "Coucher de soleil", s.active && !s.claimed
        ? `<p>Le ciel s'embrase : profites-en !</p><button type="button" class="btn" data-vac="sunset-claim">🌅 Admirer (+${s.dust} ✨)</button>`
        : `<p class="muted">${s.claimed ? "Déjà admiré ce soir. À demain !" : `Chaque soir à ${s.hour} h, pendant ${s.minutes} minutes : +${s.dust} ✨.`}</p>`));
    }
    if (v.nap) {
      const a = v.nap;
      out.push(block("nap", "🛌", "Sieste au hamac", a.claimed ? `<p class="muted">Tu as déjà fait ta sieste aujourd'hui.</p>`
        : a.until && a.until > nowS() ? `<p>Chut… encore <strong>${left(a.until)}</strong> de sieste. Une action de jeu te réveillerait.</p>`
          : a.until ? `<p>Bien dormi ?</p><button type="button" class="btn" data-vac="nap-claim">😌 Se réveiller (+${a.worms} vers, +${a.dust} ✨)</button>`
            : `<p>Ne joue pas pendant ${a.hours} h : +${a.worms} vers et +${a.dust} ✨ au réveil. Tu peux regarder les pages sans te réveiller.</p><button type="button" class="btn" data-vac="nap-start">🛌 S'installer</button>`));
    }
    if (v.beachDig) {
      const b = v.beachDig;
      const ICON = { chest: "🏴‍☠️", hot: "🔥", warm: "🌡️", cold: "❄️" };
      const over = b.found || b.left <= 0;
      const cells = Array.from({ length: b.tiles }, (_, i) => {
        const d = b.dug[i];
        return `<button type="button" class="md-sand ${d ? "dug" : ""}" data-vac="beach-dig" data-tile="${i}" ${d || over ? "disabled" : ""} aria-label="Case ${i + 1}">${d ? ICON[d] : b.chest === i ? "🏴‍☠️" : ""}</button>`;
      }).join("");
      out.push(block("beachdig", "🏴‍☠️", "Fouille de plage", `<p>${b.found ? "Coffre trouvé ! Reviens demain." : over ? "Plus de coups de pelle : le coffre était là. À demain !" : `Encore <strong>${b.left}</strong> coups de pelle pour trouver le coffre du pirate (+${b.chestDust} ✨ et 1 clé). Sans énergie.`}</p><div class="md-beach" style="--side:${b.side}">${cells}</div>`));
    }
    if (v.beachFish) {
      const f = v.beachFish;
      out.push(block("beachfish", "🐠", "Pêche sans appât", `<p>${f.done ? "Tu as déjà pêché aujourd'hui." : `${f.casts} lancers, sans ver et sans prise vide.`}</p>${f.done ? "" : '<button type="button" class="btn" data-vac="beach-fish">🎣 Lancer la ligne</button>'}
        <ul class="md-fishbook">${f.book.map((x) => `<li class="${x.count ? "" : "unknown"}"><span aria-hidden="true">${x.count ? x.icon : "❔"}</span> ${x.count ? `${esc(x.label)} ×${x.count} · ${x.best} cm` : "À découvrir"}</li>`).join("")}</ul>`));
    }
    if (v.postcard) {
      out.push(block("postcard", "💌", "Carte postale", v.postcard.sent ? `<p class="muted">Carte postale envoyée aujourd'hui. À demain !</p>`
        : `<p>Montre une de tes cartes à un ami (elle reste à toi) : il reçoit ${v.postcard.gift} ✨.</p>
          <div class="md-form"><select id="md-post-card"><option value="">Chargement…</option></select><input type="text" id="md-post-to" list="md-post-users" placeholder="Pseudo de l'ami" autocomplete="off" /><datalist id="md-post-users"></datalist><input type="text" id="md-post-msg" maxlength="140" placeholder="Un petit mot (facultatif)" /></div>
          <label class="md-check"><input type="checkbox" id="md-post-discord" /> Publier aussi sur Discord (ton mot reste privé)</label>
          <button type="button" class="btn" id="md-post-btn">💌 Envoyer</button>`));
    }
    if (v.postcards && v.postcards.length) {
      out.push(block("postcards", "📬", "Cartes reçues", `<div class="md-grid">${v.postcards.map((p, i) => `<button type="button" class="md-pick" data-postcard="${i}">${mini(p.card, `de ${esc(p.from)}`)}${p.message ? `<span class="md-meta">« ${esc(p.message)} »</span>` : ""}</button>`).join("")}</div>`));
    }
    if (v.petHoliday) {
      const h = v.petHoliday;
      out.push(block("transat", "🏖️", "Transat des compagnons", `<p>L'affection de tes gestes compte double.${h.taken ? "" : ` Une photo souvenir aujourd'hui : +${h.dust} ✨.`}</p>${h.pets.length ? `<div class="md-row">${h.pets.map((p) => `<button type="button" class="btn-secondary" data-vac="pet-photo" data-pet="${esc(p.pet)}">📸 ${p.icon} ${esc(p.label)}</button>`).join("")}</div>` : '<p class="muted">Tu n\'as pas encore de compagnon. Ils viendront à toi en jouant…</p>'}`));
    }
    if (v.sunbath) {
      const s = v.sunbath;
      out.push(block("sunbath", "☀️", "Doublons au soleil", `<p>24 h de bronzage : ${Math.round(s.chance * 100)} % de chance de gagner un cran d'état, jamais de perte.</p>
        ${s.list.length ? `<div class="md-grid">${s.list.map((c) => `<div>${mini(c.card, c.ready ? "prêt !" : left(c.until))}${c.ready ? `<button type="button" class="btn-secondary" data-vac="sunbath-claim" data-pull="${c.pullId}">☀️ Récupérer</button>` : ""}</div>`).join("")}</div>` : ""}
        ${s.open && s.list.length < s.slots ? `<div class="md-form"><select id="md-sun-select"><option value="">Chargement…</option></select><button type="button" class="btn" id="md-sun-btn">🏖️ Mettre au soleil (${s.list.length}/${s.slots})</button></div>` : ""}`));
    }
    if (v.apero) {
      const a = v.apero;
      out.push(block("apero", "🥂", "Apéro du serveur", `<p>${a.gifted ? "Tu as eu ta tournée aujourd'hui. Santé !" : `Dès ${a.need} joueurs dans la même heure : +${a.dust} ✨ pour chacun.`}</p><p class="md-meta">Cette heure-ci : ${a.here} joueur${a.here > 1 ? "s" : ""} au bar</p>`));
    }
    if (v.passport) {
      const p = v.passport;
      out.push(block("passport", "🛂", "Passeport de vacances", `<p>${p.done ? "Carnet complet : tu es Globe-trotteur !" : "Un tampon par activité et par jour. Carnet complet : un titre et un cadre exclusifs."}</p>
        <div class="md-progress"><span style="width:${Math.min(100, (p.total / p.goal) * 100)}%"></span></div><p class="md-meta">${p.total} / ${p.goal} tampons</p>
        <div class="md-stamps">${p.stamps.map((s) => `<span class="md-stamp ${s.today ? "on" : ""}" title="${esc(s.label)}">${s.icon}<small>${esc(s.label)}</small></span>`).join("")}</div>`));
    }
  }

  function renderDraft() {
    const d = draftSt;
    const cur = d.current;
    let body;
    if (cur && cur.status === "running") {
      body = `<p class="md-meta">${cur.myTurn ? "<strong>À toi de piocher !</strong>" : `Au tour de <strong>${esc(cur.turnPseudo || "?")}</strong>`} · ensuite : ${cur.upcoming.slice(1).map(esc).join(", ") || "—"}${cur.turnEndsAt ? ` · pioche auto dans ${fmtH(cur.turnEndsAt - nowS())}` : ""}</p>
        <div class="md-grid md-draft-pool">${cur.pool.map((p) => `<button type="button" class="md-pick ${p.takenBy ? "is-taken" : ""} ${p.mine ? "is-mine" : ""}" data-draft-pick="${p.index}" ${p.takenBy || !cur.myTurn ? "disabled" : ""}>${mini(p.card, p.takenBy ? `pris par ${esc(p.takenBy)}` : FIN[p.finish] + " · " + QUA[p.quality], p.finish !== "normal" ? `data-finish="${p.finish}"` : "")}</button>`).join("")}</div>
        <p class="md-meta">${cur.players.map((p) => `${esc(p.pseudo)} : ${p.picks}`).join(" · ")}</p>`;
    } else if (cur) {
      body = `<p>Salon de <strong>${esc(cur.hostPseudo)}</strong> : ${cur.players.map((p) => esc(p.pseudo)).join(", ")} (${cur.players.length} / ${cur.max}).</p>
        <div class="md-form">${cur.host === Number(Session.userId) ? `<button type="button" class="btn" data-draft="start" data-id="${cur.id}" ${cur.players.length < 2 ? "disabled" : ""}>Lancer le draft</button>` : ""}<button type="button" class="btn-ghost" data-draft="leave" data-id="${cur.id}">${cur.host === Number(Session.userId) ? "Annuler (boosters rendus)" : "Quitter (booster rendu)"}</button></div>`;
    } else if (d.active) {
      body = `<p>Mise <strong>1 booster</strong> pour rejoindre un draft (2 à 4 joueurs) : 5 cartes par booster misé sont étalées au centre et chacun pioche à son tour. Tu as ${d.boosters} jeton${d.boosters > 1 ? "s" : ""} booster.</p>
        ${d.lobbies.length ? `<ul class="md-list">${d.lobbies.map((l) => `<li>Salon de <strong>${esc(l.hostPseudo)}</strong> · ${l.players.length} / ${l.max} <button type="button" class="btn-secondary" data-draft="join" data-id="${l.id}">Rejoindre</button></li>`).join("")}</ul>` : `<p class="muted">Aucun salon ouvert.</p>`}
        <button type="button" class="btn" data-draft="create">Ouvrir un salon</button>`;
    } else return "";
    if (d.recent && d.recent.length && !cur) body += `<details><summary>Mes derniers drafts</summary><ul class="md-list">${d.recent.map((r) => `<li>${r.players.map((p) => esc(p.pseudo)).join(", ")} : ${r.pool.filter((p) => p.mine).map((p) => esc(p.card?.name || "?")).join(", ")}</li>`).join("")}</ul></details>`;
    return block("draft", "🃏", "Draft", body);
  }

  async function fillForms() {
    const sel = document.getElementById("md-repair-select");
    if (sel) {
      const list = (await ensureCollection().catch(() => [])).filter((c) => c.quality !== "mint").sort((a, b) => (b.card.rarity?.sortOrder || 0) - (a.card.rarity?.sortOrder || 0));
      sel.innerHTML = list.length ? list.map((c) => `<option value="${c.pullId}">${esc(c.card.name)} ${esc(copyLabel(c))}</option>`).join("") : '<option value="">Aucune carte à restaurer</option>';
    }
    const postSel = document.getElementById("md-post-card");
    if (postSel) {
      const list = (await ensureCollection().catch(() => [])).slice().sort((a, b) => (b.card.rarity?.sortOrder || 0) - (a.card.rarity?.sortOrder || 0));
      postSel.innerHTML = list.length ? list.map((c) => `<option value="${c.pullId}">${esc(c.card.name)} ${esc(copyLabel(c))}</option>`).join("") : '<option value="">Aucune carte</option>';
    }
    const sunSel = document.getElementById("md-sun-select");
    if (sunSel) {
      const all = await ensureCollection().catch(() => []);
      const count = new Map();
      all.forEach((c) => count.set(c.card.cardId, (count.get(c.card.cardId) || 0) + 1));
      const list = all.filter((c) => count.get(c.card.cardId) > 1 && c.quality !== "mint").sort((a, b) => (b.card.rarity?.sortOrder || 0) - (a.card.rarity?.sortOrder || 0));
      sunSel.innerHTML = list.length ? list.map((c) => `<option value="${c.pullId}">${esc(c.card.name)} ${esc(copyLabel(c))}</option>`).join("") : '<option value="">Aucun doublon à faire bronzer</option>';
    }
    const postUsers = document.getElementById("md-post-users");
    if (postUsers) {
      if (!users) users = (await API.listUsers().catch(() => ({ users: [] }))).users || [];
      postUsers.innerHTML = users.filter((u) => String(u.userId) !== String(Session.userId)).map((u) => `<option value="${esc(u.pseudo)}"></option>`).join("");
    }
    const dl = document.getElementById("md-theft-users");
    if (dl) {
      if (!users) users = (await API.listUsers().catch(() => ({ users: [] }))).users || [];
      dl.innerHTML = users.filter((u) => String(u.userId) !== String(Session.userId)).map((u) => `<option value="${esc(u.pseudo)}"></option>`).join("");
    }
  }

  // ---------------------------------------------------------------- donnees
  async function load() {
    try {
      rules = await API.modeRules();
      const on = new Set(rules.on || []);
      const [x, d, v, vc] = await Promise.all([
        API.modeExtra(Session.userId).catch(() => null),
        on.has("medium.draft") ? API.draft(Session.userId).catch(() => null) : Promise.resolve(null),
        on.has("chaos.vote") ? API.chaosVote(Session.userId).catch(() => null) : Promise.resolve(null),
        API.vacation(Session.userId).catch(() => null)
      ]);
      extra = x; voteSt = v; vac = vc;
      // Un draft commence continue meme apres un changement de mode.
      draftSt = d || (await API.draft(Session.userId).then((r) => (r.current ? r : null)).catch(() => null));
      renderRules();
      renderWidgets();
      (x && x.notes || []).forEach((n) => Toast.info(`${n.icon} ${esc(n.text)}`));
      pollDraft();
    } catch (e) {
      document.getElementById("md-widgets").innerHTML = `<p class="error-box">${esc(friendlyError(e))}</p>`;
    }
  }
  // Draft (2026-10-20) : actualise toutes les 6 s dans TOUS les etats (avant :
  // seulement une fois lance, donc l'hote ne voyait pas arriver les joueurs et
  // les invites ne voyaient jamais le depart). Seul le bloc Draft est
  // redessine (les champs des autres blocs ne sont pas effaces), et le joueur
  // est prevenu au depart, a son tour et a la fin.
  function paintDraft() {
    const el = document.getElementById("md-draft");
    const html = draftSt ? renderDraft() : "";
    if (el && html) el.outerHTML = html;
    else if (el || html) renderWidgets();
  }
  function draftNews(prev, next) {
    const a = prev && prev.current, b = next && next.current;
    if (a && a.status === "open" && b && b.status === "running") Toast.success("🃏 Le draft commence !");
    if (b && b.status === "running" && b.myTurn && !(a && a.status === "running" && a.myTurn)) {
      Toast.info("🃏 <strong>À toi de piocher</strong> dans le draft !");
      if (typeof Haptics !== "undefined") Haptics.buzz([20, 40, 20]);
    }
    if (a && a.status === "open" && b && b.status === "open" && b.players.length > a.players.length) Toast.info(`🃏 ${esc(b.players[b.players.length - 1].pseudo)} a rejoint le salon.`);
    if (a && a.status === "running" && !b) {
      Toast.success("🃏 Draft terminé : tes cartes sont dans ta collection.");
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    }
  }
  async function refreshDraft() {
    const prev = draftSt;
    try { draftSt = await API.draft(Session.userId); draftNews(prev, draftSt); paintDraft(); } catch (e) { /* reessai au prochain tour */ }
    pollDraft();
  }
  function pollDraft() {
    clearTimeout(draftTimer);
    if (draftSt && (draftSt.current || draftSt.active)) draftTimer = setTimeout(() => { if (document.hidden) pollDraft(); else refreshDraft(); }, 6000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && draftSt && (draftSt.current || draftSt.active)) refreshDraft(); });
  async function vacAct(action, params = {}, done = null) {
    try {
      const res = await API.vacation(Session.userId, action, params);
      if (res.toast) Toast.success(esc(res.toast));
      if (res.passport && res.passport.label) Toast.success(esc("🛂 " + res.passport.label));
      if (done) done(res);
      collection = null;
      await load();
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (e) { Toast.error(friendlyError(e)); }
  }
  async function act(action, params, done) {
    try {
      const r = await API.modeExtra(Session.userId, action, params);
      if (done) done(r);
      collection = null;
      await load();
      if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (e) { if (e.code !== "edition_kept") Toast.error(friendlyError(e)); else Toast.info(friendlyError(e)); }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!Session.isLoggedIn()) { document.getElementById("md-guest").style.display = "block"; return; }
    load();
    document.getElementById("md-widgets").addEventListener("click", async (e) => {
      const t = e.target.closest("button");
      if (!t || t.disabled) return;
      if (t.dataset.vac) {
        const a = t.dataset.vac;
        t.disabled = true;
        if (a === "beach-dig") vacAct(a, { tile: Number(t.dataset.tile) });
        else if (a === "pet-photo") vacAct(a, { pet: t.dataset.pet }, (r) => { LazyJs.load("js/lazy/share-studio.js").then(() => ShareStudio.petPhoto(r.photo)).catch(LazyJs.fail("Photo indisponible pour le moment.")); });
        else if (a === "sunbath-claim") vacAct(a, { pullId: Number(t.dataset.pull) });
        else vacAct(a);
        return;
      }
      if (t.dataset.postcard != null) {
        const p = vac.postcards[Number(t.dataset.postcard)];
        LazyJs.load("js/lazy/share-studio.js").then(() => ShareStudio.card({ card: p.card, finish: p.finish, quality: p.quality, owner: `Carte postale de ${p.from}`, owned: false })).catch(LazyJs.fail("Image indisponible pour le moment."));
        return;
      }
      if (t.id === "md-post-btn") {
        const pullId = Number(document.getElementById("md-post-card").value);
        const toPseudo = document.getElementById("md-post-to").value.trim();
        if (!pullId || !toPseudo) { Toast.info("Choisis une carte et un ami."); return; }
        vacAct("postcard", { pullId, toPseudo, message: document.getElementById("md-post-msg").value, discord: document.getElementById("md-post-discord").checked });
        return;
      }
      if (t.id === "md-sun-btn") {
        const pullId = Number(document.getElementById("md-sun-select").value);
        if (pullId) vacAct("sunbath-start", { pullId });
        return;
      }
      if (t.dataset.wish) {
        if (await Confirm.show("Choisir cette carte pour ta boîte à souhaits de la semaine ? Tu ne pourras plus en changer.", { title: "Boîte à souhaits", confirmText: "Choisir" })) act("wishbox", { cardId: Number(t.dataset.wish) }, () => Toast.success("🎀 Souhait enregistré !"));
      } else if (t.id === "md-repair-btn") {
        const id = Number(document.getElementById("md-repair-select").value);
        if (id) act("free-repair", { pullId: id }, (r) => Toast.success(`🧰 ${QUA[r.from]} → ${QUA[r.to]} !`));
      } else if (t.dataset.second) {
        if (await Confirm.show("Relancer cette carte ? Elle sera remplacée par une autre carte de même rareté (finition et état conservés).", { title: "Seconde chance", confirmText: "Relancer" })) act("second-chance", { pullId: Number(t.dataset.second) }, (r) => Toast.success(`🔁 ${esc(r.from || "")} devient <strong>${esc(r.card.name)}</strong> !`));
      } else if (t.id === "md-water-btn") {
        act("garden-water", {}, (r) => Toast.success(r.harvest ? "🌻 Le jardin a fleuri ! Récolte partagée." : "💧 Arrosé, merci !"));
      } else if (t.id === "md-quest-btn") {
        act("quest-claim", {}, (r) => Toast.success(r.reward.boosters ? `🗺️ Quête terminée : +${r.reward.boosters} boosters et le titre « ${r.reward.title} » !` : `🗺️ Étape terminée : +${r.reward.dust} ✨`));
      } else if (t.id === "md-iron-pledge") {
        if (await Confirm.show("Prêter serment ? Tu ne pourras plus rien décrafter jusqu'à la fin du mode Hard (renoncer reste possible, sans récompense).", { title: "Serment Ironman", confirmText: "Je le jure" })) act("ironman-pledge", {}, () => Toast.success("🛡️ Serment prêté !"));
      } else if (t.id === "md-iron-abandon") {
        if (await Confirm.show("Renoncer au serment ? Tu perds la récompense de cette période.", { title: "Renoncer", confirmText: "Renoncer", dangerous: true })) act("ironman-abandon");
      } else if (t.id === "md-bounty-btn") {
        const id = Number(document.getElementById("md-bounty-select").value);
        if (id && await Confirm.show("Livrer cet exemplaire ? Il est donné en échange de la prime.", { title: "Prime de chasse", confirmText: "Livrer" })) act("bounty-deliver", { pullId: id }, (r) => Toast.success(`💰 Prime remportée : +${r.reward.boosters} boosters, +${r.reward.dust} ✨ !`));
      } else if (t.dataset.purify) {
        act("purify", { pullId: Number(t.dataset.purify) }, (r) => Toast.success(`🕯️ Carte purifiée (-${r.cost} ✨).`));
      } else if (t.id === "md-theft-btn") {
        const target = document.getElementById("md-theft-target").value.trim();
        if (!target) { Toast.info("Indique le pseudo de ta cible."); return; }
        if (await Confirm.show(`Tenter un larcin chez <strong>${esc(target)}</strong> ? Ça coûte une clé, réussi ou non.`, { title: "Larcin", confirmText: "Tenter" })) act("steal", { toPseudo: target }, (r) => (r.success ? Toast.success(`🦹 Réussi : tu repars avec <strong>${esc(r.card?.name || "une carte")}</strong> ${serial(r.card?.serialNumber)} !`) : Toast.info("🚨 Raté ! L'alarme a sonné.")));
      } else if (t.id === "md-unstable-btn") {
        act("unstable-claim", {}, () => Toast.success("🌀 Carte instable récupérée !"));
      } else if (t.dataset.vote) {
        try { voteSt = await API.chaosVote(Session.userId, "vote", t.dataset.vote); renderWidgets(); Toast.success("🗳️ Vote enregistré."); } catch (err) { Toast.error(friendlyError(err)); }
      } else if (t.dataset.draft) {
        const a = t.dataset.draft;
        if (a === "create" || a === "join") { if (!(await Confirm.show("Miser 1 booster pour ce draft ? Il est rendu si le salon est annulé avant le départ.", { title: "Draft", confirmText: "Miser 1 booster" }))) return; }
        try { draftSt = await API.draft(Session.userId, a, { id: Number(t.dataset.id) || undefined }); paintDraft(); if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); pollDraft(); } catch (err) { Toast.error(friendlyError(err)); refreshDraft(); }
      } else if (t.dataset.draftPick != null) {
        const prev = draftSt;
        try { draftSt = await API.draft(Session.userId, "pick", { id: draftSt.current.id, index: Number(t.dataset.draftPick) }); Toast.success("🃏 Carte piochée !"); draftNews(prev && prev.current ? { current: { ...prev.current, myTurn: true } } : prev, draftSt); paintDraft(); pollDraft(); } catch (err) { Toast.error(friendlyError(err)); refreshDraft(); }
      }
    });
  });
})();
