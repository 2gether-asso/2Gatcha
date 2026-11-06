// Vacances du mode Chill dans les pages du jeu (2026-11-02, api/src/native/vacation.js).
// Chaque activite s'affiche la ou l'on joue deja, plus dans la page « Mode du
// moment » (qui garde un sommaire avec des liens) :
//   accueil (#vacances)          sieste, coucher de soleil, apero, passeport
//   jeux : Peche                 lagon (peche sans appat, marees, poissons exotiques)
//          Fouille               plage (grille du coffre de pirate) et chateau de sable
//          Archeologie           bibliotheque engloutie
//          Promenade             transat des compagnons (photo souvenir)
//   collection : Qualite         doublons au soleil
//   profil (le sien)             passeport, titres, carnet exotique, cartes postales, amis
//   communaute : Ensemble        apero et chateau de sable commun
//   fenetre d'une carte          « Envoyer en carte postale » (VacationUI.postcard, card-extras.js)
// Rien ne s'affiche quand la regle du bloc n'est pas active (le serveur ne le renvoie pas).

const VacationUI = (function () {
  const esc = escHtml;
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const nowS = () => Math.floor(Date.now() / 1000);
  const fmtH = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`; };
  const QUA = { damaged: "Usé", worn: "Abîmé", good: "Bon état", mint: "Parfait état" };
  let st = null, friends = null, users = null, collection = null, kiosk = null;
  const bump = () => { if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); };
  const block = (id, icon, title, body) => `<section class="vac-card" id="vac-${id}"><h3>${icon} ${title}</h3>${body}</section>`;
  const img = (id) => (id ? (API.thumbUrl ? API.thumbUrl(id) : API.imageUrl(id)) : "");
  const mini = (c, sub = "") => (c ? `<span class="vac-mini">${c.imageId ? `<img src="${img(c.imageId)}" alt="" loading="lazy" decoding="async" />` : "🃏"}<span><strong>${esc(c.name)}</strong>${sub ? `<small>${sub}</small>` : ""}</span></span>` : "");

  // ---------------------------------------------------------------- blocs
  const R = {
    nap(v) {
      const a = v.nap;
      return a && block("nap", "🛌", "Sieste au hamac", a.claimed ? `<p class="muted">Sieste faite aujourd'hui. À demain !</p>`
        : a.until && a.until > nowS() ? `<p>Chut… encore <strong>${fmtH(a.until - nowS())}</strong>. Une action de jeu te réveillerait.</p>`
          : a.until ? `<button type="button" class="btn" data-vac="nap-claim">😌 Se réveiller (+${a.worms} vers, +${a.dust} ✨)</button>`
            : `<p>Ne joue pas pendant ${a.hours} h : +${a.worms} vers et +${a.dust} ✨ au réveil. Regarder les pages ne réveille pas.</p><button type="button" class="btn" data-vac="nap-start">🛌 S'installer</button>`);
    },
    sunset(v) {
      const s = v.sunset;
      return s && block("sunset", "🌅", "Coucher de soleil", s.active && !s.claimed ? `<p>Le ciel s'embrase !</p><button type="button" class="btn" data-vac="sunset-claim">🌅 Admirer (+${s.dust} ✨)</button>`
        : `<p class="muted">${s.claimed ? "Déjà admiré ce soir." : `Chaque soir à ${s.hour} h, pendant ${s.minutes} min : +${s.dust} ✨.`}</p>`);
    },
    apero(v) {
      const a = v.apero;
      return a && block("apero", "🥂", "Apéro du serveur", `<p>${a.gifted ? "Ta tournée du jour est servie. Santé !" : `Dès ${a.need} joueurs dans la même heure : +${a.dust} ✨ pour chacun.`}</p><p class="vac-meta">Cette heure-ci : ${a.here} joueur${a.here > 1 ? "s" : ""} au bar</p>`);
    },
    passport(v, full) {
      const p = v.passport;
      if (!p) return "";
      return block("passport", "🛂", "Passeport de vacances", `<p>${p.done ? "Carnet complet : tu es Globe-trotteur !" : "Un tampon par activité et par jour. Carnet complet : un titre et un cadre exclusifs."}</p>
        <div class="vac-bar"><span style="width:${Math.min(100, (p.total / p.goal) * 100)}%"></span></div><p class="vac-meta">${p.total} / ${p.goal} tampons${full ? "" : ` · <a href="profile.html#vacances">voir le carnet</a>`}</p>
        ${full ? `<div class="vac-stamps">${p.stamps.map((s) => `<span class="vac-stamp ${s.today ? "on" : ""}" title="${esc(s.label)}">${s.icon}<small>${esc(s.label)}</small></span>`).join("")}</div>` : ""}`);
    },
    lagon(v) {
      const f = v.beachFish;
      if (!f) return "";
      const tide = v.tide ? `<p class="vac-tide vac-tide-${v.tide.phase}">🌊 <strong>${esc(v.tide.label)}</strong> encore ${fmtH(v.tide.changeIn)} · ${v.tide.phase === "high" ? "les poissons rares mordent plus" : "des coquillages à chaque lancer"}</p>` : "";
      return block("lagon", "🏝️", "Le lagon (pêche sans appât)", `${tide}<p>${f.done ? "Tu as déjà pêché au lagon aujourd'hui." : `${f.casts} lancers sans ver ni prise vide.`}</p>
        ${f.done ? "" : '<button type="button" class="btn" data-vac="beach-fish">🎣 Lancer au lagon</button>'}
        <ul class="vac-book">${f.book.map((x) => `<li class="${x.count ? "" : "unknown"}"><span aria-hidden="true">${x.count ? x.icon : "❔"}</span> ${x.count ? `${esc(x.label)} ×${x.count} · ${x.best} cm` : "À découvrir"}</li>`).join("")}</ul>`);
    },
    beach(v) {
      const b = v.beachDig;
      if (!b) return "";
      const ICON = { chest: "🏴‍☠️", hot: "🔥", warm: "🌡️", cold: "❄️" };
      const over = b.found || b.left <= 0;
      const cells = Array.from({ length: b.tiles }, (_, i) => { const d = b.dug[i]; return `<button type="button" class="vac-sand ${d ? "dug" : ""}" data-vac="beach-dig" data-tile="${i}" ${d || over ? "disabled" : ""} aria-label="Case ${i + 1}">${d ? ICON[d] : b.chest === i ? "🏴‍☠️" : ""}</button>`; }).join("");
      const c = v.castle;
      const castle = c ? `<div class="vac-castle"><h4>🏰 Ton château de sable <small>(${c.level} / ${c.floors.length} étages ce mois-ci)</small></h4>
        <ol class="vac-floors">${c.floors.map((f) => `<li class="${f.built ? "built" : ""}">${f.built ? "✅" : "▫️"} ${esc(f.label)} <small>${f.sand} sable${f.shells ? ` + ${f.shells} coquillages` : ""} → ${f.reward.dust ? `${f.reward.dust} ✨` : `${f.reward.keys} clé`}</small></li>`).join("")}</ol>
        <p class="vac-meta">Tu as ${c.sand} sable et ${c.shells} coquillages.</p>
        ${c.next ? `<button type="button" class="btn-secondary" data-vac="castle-build" ${c.sand >= c.next.sand && c.shells >= (c.next.shells || 0) ? "" : "disabled"}>🏰 Bâtir : ${esc(c.next.label)}</button>` : "<p><strong>Drapeau planté !</strong> Un nouveau château le mois prochain.</p>"}</div>` : "";
      return block("plage", "🏴‍☠️", "La plage", `<p>${b.found ? "Coffre trouvé ! Reviens demain." : over ? "Plus de coups de pelle : le coffre était là. À demain !" : `Encore <strong>${b.left}</strong> coups de pelle pour le coffre du pirate (+${b.chestDust} ✨ et 1 clé). Sans énergie.`}</p>
        <div class="vac-grid" style="--side:${b.side}">${cells}</div>${castle}`);
    },
    lore(v) {
      const l = v.seaLore;
      return l && block("lore", "📜", "La bibliothèque engloutie", `<p>${l.found} / ${l.total} fragments retrouvés${l.open ? " : au lagon, sur la plage et en promenade à la plage." : "."}</p>
        <ol class="vac-lore">${l.pages.map((p) => `<li class="${p.text ? "" : "unknown"}">${p.text ? esc(p.text) : "Fragment encore sous l'eau…"}</li>`).join("")}</ol>`);
    },
    transat(v) {
      const h = v.petHoliday;
      return h && block("transat", "🏖️", "Transat des compagnons", `<p>L'affection de tes caresses, jeux et friandises compte double.${h.taken ? "" : ` Photo souvenir du jour : +${h.dust} ✨.`}</p>
        ${h.pets.length ? `<div class="vac-row">${h.pets.map((p) => `<button type="button" class="btn-secondary" data-vac="pet-photo" data-pet="${esc(p.pet)}">📸 ${p.icon} ${esc(p.label)}</button>`).join("")}</div>` : "<p class=\"muted\">Tu n'as pas encore de compagnon : ils viendront à toi en jouant…</p>"}`);
    },
    sunbath(v) {
      const s = v.sunbath;
      if (!s) return "";
      return block("sunbath", "☀️", "Doublons au soleil", `<p>24 h de bronzage : ${Math.round(s.chance * 100)} % de chance de gagner un cran d'état, jamais de perte.</p>
        ${s.list.length ? `<div class="vac-row">${s.list.map((c) => `<div class="vac-bath">${mini(c.card, c.ready ? "prêt !" : fmtH(c.until - nowS()))}${c.ready ? `<button type="button" class="btn-secondary" data-vac="sunbath-claim" data-pull="${c.pullId}">☀️ Récupérer</button>` : ""}</div>`).join("")}</div>` : ""}
        ${s.open && s.list.length < s.slots ? `<div class="vac-form"><select id="vac-sun-select"><option value="">Chargement…</option></select><button type="button" class="btn" id="vac-sun-btn">🏖️ Mettre au soleil (${s.list.length}/${s.slots})</button></div>` : ""}`);
    },
    shared(v) {
      const c = v.sharedCastle;
      if (!c) return "";
      const goal = c.goal * c.maxFloors;
      return block("shared-castle", "🏯", "Château de sable commun", `<p>Apporte le sable de ta plage : chaque étage donne +${c.reward} ✨ à tous ceux qui ont participé. Nouveau château chaque lundi.</p>
        <div class="vac-bar"><span style="width:${Math.min(100, (c.total / goal) * 100)}%"></span></div>
        <p class="vac-meta">Étage ${c.floors} / ${c.maxFloors} · ${c.total} / ${goal} sable · ${c.builders} bâtisseur${c.builders > 1 ? "s" : ""} · toi : ${c.mine}</p>
        ${c.floors < c.maxFloors ? `<div class="vac-form"><input type="number" id="vac-donate-n" min="1" max="${c.sand}" value="${Math.min(10, c.sand) || 1}" aria-label="Sable à apporter" /><button type="button" class="btn" id="vac-donate-btn" ${c.sand ? "" : "disabled"}>🏯 Apporter du sable (tu en as ${c.sand})</button></div>` : "<p><strong>Château terminé !</strong></p>"}`);
    },
    cosmetics(v) {
      const list = v.cosmetics;
      return list && block("titles", "🎖️", "Titres de vacances", `<ul class="vac-list">${list.map((c) => `<li>${c.owned ? "✅" : "▫️"} <strong>${esc(c.label)}</strong> <small>${esc(c.how)}${c.owned ? "" : ` (${c.progress} / ${c.need})`}</small></li>`).join("")}</ul>`);
    },
    book(v) {
      const b = v.book;
      if (!b) return "";
      return block("carnet", "📔", "Carnet exotique", `${b.sections.map((s) => `<div class="vac-book-sec"><strong>${esc(s.label)}</strong> ${s.have} / ${s.size}
          ${s.claimed ? "<small>✅ récompense reçue</small>" : s.have >= s.size ? `<button type="button" class="btn" data-vac="book-claim" data-section="${s.key}">Récupérer : ${s.reward.dust} ✨ + ${esc(s.reward.label)}</button>` : `<small>Complet : ${s.reward.dust} ✨ + ${esc(s.reward.label)}</small>`}</div>`).join("")}
        <ul class="vac-book">${b.fish.map((x) => `<li class="${x.count ? "" : "unknown"}">${x.count ? x.icon : "❔"} ${x.count ? esc(x.label) : "Poisson à découvrir"}</li>`).join("")}${b.shells.map((x) => `<li class="${x.count ? "" : "unknown"}">${x.count ? x.icon : "❔"} ${x.count ? `${esc(x.label)} ×${x.count}` : "Coquillage à découvrir"}</li>`).join("")}</ul>`);
    },
    postcards(v) {
      const list = v.postcards || [];
      return list.length ? block("postcards", "📬", "Cartes postales reçues", `<div class="vac-row">${list.map((p, i) => `<button type="button" class="vac-pc" data-postcard="${i}">${mini(p.card, `de ${esc(p.from)}`)}${p.message ? `<em>« ${esc(p.message)} »</em>` : ""}</button>`).join("")}</div>`) : "";
    },
    // Kiosque de la plage (regle chill.vacationShop) : cosmetiques de vacances, achat et equipement.
    kiosk() {
      const items = kiosk && (kiosk.shop || []).filter((c) => c.rule === "chill.vacationShop");
      if (!items || !items.length) return "";
      const eq = kiosk.equipped || {};
      const preview = (c) => c.type === "frame" ? `<span class="decor-avatar small decor-${esc(c.key)}"><span>${esc((Session.pseudo || "?")[0])}</span></span>` : c.type === "color" ? `<span class="decor-pseudo decor-${esc(c.key)}">${esc(Session.pseudo || "Pseudo")}</span>` : `<span class="vac-kiosk-title">« ${esc(c.label)} »</span>`;
      return block("kiosque", "🛍️", "Kiosque de la plage", `<p>Des souvenirs de vacances à garder toute l'année. Tu as ${kiosk.stardust} ✨.</p>
        <div class="vac-kiosk">${items.map((c) => `<div class="vac-kiosk-item">${preview(c)}<strong>${esc(c.label)}</strong>${c.desc ? `<small>${esc(c.desc)}</small>` : ""}
          ${c.owned ? (eq[c.type] === c.key ? '<span class="vac-meta">équipé</span>' : `<button type="button" class="btn-secondary" data-kiosk-equip="${esc(c.key)}" data-type="${c.type}">Équiper</button>`) : `<button type="button" class="btn" data-kiosk-buy="${esc(c.key)}" ${kiosk.stardust >= c.price ? "" : "disabled"}>${c.price} ✨</button>`}</div>`).join("")}</div>`);
    },
    friends() {
      if (!friends || !friends.enabled) return "";
      return block("amis", "🤝", "Mes amis", `${friends.friends.length ? `<ul class="vac-list">${friends.friends.map((f) => `<li><a href="profile.html?pseudo=${encodeURIComponent(f.pseudo)}">${esc(f.pseudo)}</a> <button type="button" class="btn-ghost vac-x" data-friend-remove="${f.userId}" aria-label="Retirer ${esc(f.pseudo)}">✕</button></li>`).join("")}</ul>` : '<p class="muted">Pas encore d\'amis : ajoute un joueur par son pseudo.</p>'}
        <div class="vac-form"><input type="text" id="vac-friend-add" list="vac-users" placeholder="Pseudo" autocomplete="off" /><datalist id="vac-users"></datalist><button type="button" class="btn-secondary" id="vac-friend-btn">Ajouter</button></div>`);
    }
  };
  // Bloc absent (regle inactive, `x && block(...)`) : chaine vide, sinon
  // « undefined » s'affiche dans les zones concatenees et zone() plante (GlitchTip #37).
  Object.keys(R).forEach((k) => { const f = R[k]; R[k] = (...a) => f(...a) || ""; });

  // ---------------------------------------------------------------- placement
  function zone(id, anchorSel, where, html) {
    document.getElementById(id)?.remove();
    const anchor = document.querySelector(anchorSel);
    if (!anchor || !html || !html.trim()) return;
    anchor.insertAdjacentHTML(where, `<div id="${id}" class="vac-zone">${html}</div>`);
  }
  const ownProfile = () => { const p = new URLSearchParams(location.search).get("pseudo"); return !p || (Session.pseudo && p.toLowerCase() === String(Session.pseudo).toLowerCase()); };
  function render() {
    const v = st || {};
    if (page === "index.html" || page === "") zone("vacances", "#today-panel", "afterend", R.sunset(v) + R.nap(v) + R.apero(v) + R.passport(v, false));
    if (page === "jeux.html") {
      zone("vac-zone-fish", "#fish-pane", "beforeend", R.lagon(v));
      zone("vac-zone-dig", "#dig-pane", "beforeend", R.beach(v));
      zone("vac-zone-archeo", "#archeo-pane", "beforeend", R.lore(v));
      zone("vac-zone-walk", "#walk-pane", "beforeend", R.transat(v));
    }
    if (page === "collection.html") zone("vac-zone-quality", "#pane-quality", "afterbegin", R.sunbath(v));
    if (page === "communaute.html") zone("vac-zone-together", "#together-pane", "beforeend", R.apero(v) + R.shared(v));
    if (page === "profile.html" && ownProfile()) {
      zone("vacances", "#profile-zone", "beforeend", R.passport(v, true) + R.cosmetics(v) + R.postcards(v));
      zone("carnet", "#profile-zone", "beforeend", R.book(v));
      zone("amis", "#profile-zone", "beforeend", R.friends());
      zone("kiosque", "#profile-zone", "beforeend", R.kiosk());
    }
    fillForms();
    const h = location.hash.slice(1);
    if (h && document.getElementById(h) && document.getElementById(h).classList.contains("vac-zone") && !render.scrolled) { render.scrolled = true; document.getElementById(h).scrollIntoView({ block: "start" }); }
  }

  async function ensureCollection() {
    if (collection) return collection;
    const c = await API.getCollection(Session.userId);
    const byId = new Map((c.cards || []).map((x) => [x.cardId, x]));
    collection = (c.owned || []).flatMap((o) => (o.copies || []).map((cp) => ({ ...cp, card: byId.get(o.cardId) }))).filter((x) => x.card);
    return collection;
  }
  async function fillForms() {
    const sun = document.getElementById("vac-sun-select");
    if (sun) {
      const all = await ensureCollection().catch(() => []);
      const count = new Map();
      all.forEach((c) => count.set(c.card.cardId, (count.get(c.card.cardId) || 0) + 1));
      const list = all.filter((c) => count.get(c.card.cardId) > 1 && c.quality !== "mint").sort((a, b) => (b.card.rarity?.sortOrder || 0) - (a.card.rarity?.sortOrder || 0));
      sun.innerHTML = list.length ? list.map((c) => `<option value="${c.pullId}">${esc(c.card.name)} · ${QUA[c.quality] || ""} ${fmtSerial(c.serialNumber)}</option>`).join("") : '<option value="">Aucun doublon à faire bronzer</option>';
    }
    const dl = document.getElementById("vac-users");
    if (dl) {
      if (!users) users = (await API.listUsers().catch(() => ({ users: [] }))).users || [];
      dl.innerHTML = users.filter((u) => String(u.userId) !== String(Session.userId)).map((u) => `<option value="${esc(u.pseudo)}"></option>`).join("");
    }
  }

  // ---------------------------------------------------------------- actions
  function report(r) {
    if (!r) return;
    if (r.toast) Toast.success(esc(r.toast));
    if (r.passport && r.passport.label) Toast.success(esc("🛂 " + r.passport.label));
    if (r.cosmetic) Toast.success(esc("🎖️ " + r.cosmetic));
  }
  async function load() {
    if (!Session.isLoggedIn()) return;
    [st, friends, kiosk] = await Promise.all([API.vacation(Session.userId).catch(() => null), page === "profile.html" ? API.post("friends", { userId: Session.userId, action: "status" }).catch(() => null) : Promise.resolve(friends), page === "profile.html" ? API.cosmetics(Session.userId).catch(() => null) : Promise.resolve(kiosk)]);
    render();
  }
  async function act(action, params = {}) {
    try {
      const r = await API.vacation(Session.userId, action, params);
      report(r);
      collection = null;
      await load();
      bump();
      return r;
    } catch (e) { Toast.error(friendlyError(e)); return null; }
  }
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-vac],[data-postcard],[data-friend-remove],[data-kiosk-buy],[data-kiosk-equip],#vac-sun-btn,#vac-donate-btn,#vac-friend-btn");
    if (!t || t.disabled || !Session.isLoggedIn()) return;
    if (t.dataset.kioskBuy || t.dataset.kioskEquip) {
      t.disabled = true;
      try {
        kiosk = t.dataset.kioskBuy ? await API.cosmetics(Session.userId, "buy", { key: t.dataset.kioskBuy }) : await API.cosmetics(Session.userId, "equip", { key: t.dataset.kioskEquip, type: t.dataset.type });
        Toast.success(t.dataset.kioskBuy ? "🛍️ Souvenir acheté : équipe-le quand tu veux." : "Équipé !");
        render();
        bump();
      } catch (err) { t.disabled = false; Toast.error(friendlyError(err)); }
      return;
    }
    if (t.dataset.vac) {
      const a = t.dataset.vac;
      t.disabled = true;
      if (a === "beach-dig") act(a, { tile: Number(t.dataset.tile) });
      else if (a === "sunbath-claim") act(a, { pullId: Number(t.dataset.pull) });
      else if (a === "book-claim") act(a, { section: t.dataset.section });
      else if (a === "pet-photo") {
        const r = await act(a, { pet: t.dataset.pet });
        if (r && r.photo) LazyJs.load("js/lazy/share-studio.js").then(() => ShareStudio.petPhoto(r.photo)).catch(LazyJs.fail("Photo indisponible pour le moment."));
      } else act(a);
      return;
    }
    if (t.dataset.postcard != null) {
      const p = (st.postcards || [])[Number(t.dataset.postcard)];
      if (p) LazyJs.load("js/lazy/share-studio.js").then(() => ShareStudio.card({ card: p.card, finish: p.finish, quality: p.quality, owner: `Carte postale de ${p.from}`, owned: false })).catch(LazyJs.fail("Image indisponible pour le moment."));
      return;
    }
    if (t.id === "vac-sun-btn") { const id = Number(document.getElementById("vac-sun-select").value); if (id) act("sunbath-start", { pullId: id }); return; }
    if (t.id === "vac-donate-btn") { const n = Number(document.getElementById("vac-donate-n").value) || 0; if (n > 0) act("castle-donate", { n }); return; }
    if (t.id === "vac-friend-btn" || t.dataset.friendRemove) {
      const body = t.dataset.friendRemove ? { action: "remove", friendId: Number(t.dataset.friendRemove) } : { action: "add", pseudo: document.getElementById("vac-friend-add").value.trim() };
      if (body.action === "add" && !body.pseudo) return;
      try { friends = await API.post("friends", { userId: Session.userId, ...body }); if (friends.toast) Toast.success(esc(friends.toast)); render(); } catch (err) { Toast.error(friendlyError(err)); }
    }
  });

  // ---------------------------------------------------------------- carte postale (fenetre d'une carte)
  // o : objet de card-extras.js (card, copies...). Une fois par jour.
  async function postcard(o) {
    const copies = (o.copies || []).filter((c) => c.pullId);
    if (!copies.length) return Toast.info("Il te faut un exemplaire de cette carte.");
    if (!friends) friends = await API.post("friends", { userId: Session.userId, action: "status" }).catch(() => null);
    if (!users) users = (await API.listUsers().catch(() => ({ users: [] }))).users || [];
    const known = new Set((friends && friends.friends || []).map((f) => f.pseudo));
    const names = [...known, ...users.map((u) => u.pseudo).filter((p) => p && !known.has(p) && p !== Session.pseudo)];
    const dlg = document.createElement("dialog");
    dlg.className = "vac-dialog";
    dlg.innerHTML = `<form method="dialog" class="vac-pc-form">
      <h3>💌 Envoyer « ${esc(o.card.name)} » en carte postale</h3>
      <p class="muted">Tu montres ta carte, tu ne la donnes pas. Ton ami reçoit un petit cadeau. Une carte postale par jour.</p>
      <label>À <input type="text" name="to" list="vac-pc-users" required autocomplete="off" placeholder="Pseudo d'un ami" /></label><datalist id="vac-pc-users">${names.map((p) => `<option value="${esc(p)}"></option>`).join("")}</datalist>
      <label>Un petit mot (facultatif) <input type="text" name="msg" maxlength="140" /></label>
      <label class="vac-check"><input type="checkbox" name="discord" /> Publier aussi sur Discord (ton mot reste privé)</label>
      <div class="vac-actions"><button type="button" class="btn-ghost" value="cancel" data-close>Annuler</button><button type="submit" class="btn">Envoyer</button></div>
    </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
    dlg.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const best = copies.slice().sort((a, b) => (a.serialNumber || 0) - (b.serialNumber || 0))[0];
      const r = await act("postcard", { pullId: best.pullId, toPseudo: String(f.get("to") || "").trim(), message: f.get("msg"), discord: !!f.get("discord") });
      if (r) dlg.close();
    });
    dlg.showModal();
  }

  document.addEventListener("DOMContentLoaded", () => { load(); });
  // Mises a jour en direct (shell.js) : on relit.
  document.addEventListener("live:refresh", () => { if (st) load(); });
  return { load, postcard, canPostcard: async () => { const v = st || (Session.isLoggedIn() ? await API.vacation(Session.userId).catch(() => null) : null); return !!(v && v.postcard && !v.postcard.sent); } };
})();
window.VacationUI = VacationUI;
