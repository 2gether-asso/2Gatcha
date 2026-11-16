// Barre du compagnon (2026-10-25, refaite le 2026-11-16 pour les compagnons
// V2) : la meme partout, sous la carte du compagnon dans son jeu.
//  - Fouille (Milo), peche (Moka), jardin (Noisette), archeologie (Pistache) :
//    la carte existe dans jeux.html (#dig-kennel, #fish-cat, #garden-bunny,
//    #archeo-mole) ; la barre est ajoutee en bas.
//  - Coffre-fort (Praline), ouverture (Reglisse), salle (Paprika) : une carte
//    complete est creee a l'endroit du jeu (HOSTS), une fois adopte.
// Barre : niveau et XP, affection, envie du jour, mission, gestes (caresse,
// jeu, friandise), competence active du niveau 30, lien vers la fiche.
// Pastilles : un point sur chaque geste disponible, 💭 sur celui que le
// compagnon a envie, ⚡ sur la competence prete, et sur l'avatar le nombre de
// choses a faire. Donnees : routes pets (gestes) et companions (V2).
(function () {
  if (typeof API === "undefined") return;
  const esc = escHtml;
  const ERR = { pet_cooldown: "Encore un peu de patience avant le prochain geste.", daily_limit: "Plus de friandise aujourd'hui.", not_enough_dust: "Pas assez de poussières.", pets_closed: "La tendresse est en pause." };
  let state = null, comp = null, timer = null, busy = false;
  const wait = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.ceil((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`; };

  // Cartes des jeux (jeux.html) : avatar et carte.
  const AVATAR = { milo: "dig-kennel-dog-wrap", moka: "fish-cat-wrap", noisette: "garden-bunny-wrap", pistache: "archeo-mole-wrap", poivre: "cook-rat-wrap" };
  const HOME = { milo: "dig-kennel", moka: "fish-cat", noisette: "garden-bunny", pistache: "archeo-mole", poivre: "cook-rat" };
  // Nouveaux compagnons : ou creer leur carte.
  const HOSTS = {
    praline: ["#pv-zone", "afterbegin", "Praline la tortue", "Elle fait grossir les intérêts et l'XP du coffre-fort.", "coffre.html"],
    reglisse: ["main .panel > .lead", "afterend", "Réglisse la chouette", "Elle rapporte des poussières à chaque booster ouvert et, la nuit, parfois un jeton.", "ouverture.html"],
    paprika: ["#fd-machine-zone", "beforebegin", "Paprika le perroquet", "Il t'offre des tours gratuits à ta première visite du jour."]
  };
  const RELOAD = {
    milo: () => window.loadDig && window.loadDig(), moka: () => window.loadFishing && window.loadFishing(),
    noisette: () => window.loadGarden && window.loadGarden(), pistache: () => window.loadArcheo && window.loadArcheo(), poivre: () => window.Kitchen && window.Kitchen.load(),
    praline: () => typeof pvLoad === "function" && pvLoad(), reglisse: () => typeof loadHeaderBoosterBadge === "function" && loadHeaderBoosterBadge(), paprika: () => {}
  };
  const HAPPY = { milo: "remue la queue", moka: "ronronne de plaisir", noisette: "remue le bout du nez", pistache: "se roule en boule de bonheur", poivre: "frétille des moustaches", praline: "sort la tête de sa carapace", reglisse: "hulule doucement", paprika: "répète ton nom en boucle" };

  function chipHtml(p, c) {
    const tip = `${p.label} : ${p.love}/100 d'affection (${p.mood.label}). ${p.love ? `${p.speedPct} % plus rapide, +${p.lootPct} % de poussières${p.giftChance ? `, ${Math.round(p.giftChance * 100)} % de chance d'un cadeau` : ""}.` : `Plus rapide et plus généreux quand ${p.fem ? "elle" : "il"} t'adore.`} Baisse de ${String(p.decayPerHour).replace(".", ",")} par heure.${p.cooked ? " Tarte aux baies : travaille comme à 100 d'affection." : ""}`;
    return `${c ? `<b class="pet-chip-lv">Niv. ${c.level}</b>` : ""}<span class="pet-chip-heart" aria-hidden="true">${p.love >= 80 ? "💖" : p.love >= 40 ? "❤️" : p.love > 0 ? "🩷" : "🤍"}</span>${p.love}<span class="sr-only">${esc(tip)}</span>`;
  }
  // Ce qui attend le joueur : gestes prets, envie, competence.
  function todo(p, c) {
    const g = p.gestures;
    const ready = { cuddle: g.cuddle.wait <= 0, play: g.play.wait <= 0, treat: g.treat.left > 0 && (state.stardust || 0) >= g.treat.price };
    const away = c && c.mission;
    const wish = c && c.mood && !c.mood.done ? c.mood : null;
    const skill = c && c.active && c.level >= c.max && c.active.ready && !away;
    const back = away && !away.duoOf && away.ready;
    return { ready, wish, skill, back, away, count: (away ? 0 : Object.values(ready).filter(Boolean).length) + (wish && !away ? 1 : 0) + (skill ? 1 : 0) + (back ? 1 : 0) };
  }
  function barHtml(p, c) {
    const t = todo(p, c);
    const g = p.gestures;
    const gest = (k) => {
      const x = g[k];
      const on = t.ready[k] && !t.away;
      const want = t.wish && t.wish.kind === k;
      const sub = k === "treat" ? (x.left > 0 ? `${x.price} ✨ · encore ${x.left}` : "plus aujourd'hui") : x.wait > 0 ? `dans ${wait(x.wait)}` : `+${x.gain * (want ? 2 : 1)} 💗`;
      return `<button type="button" class="pb-act ${want ? "want" : ""}" data-pet-act="${k}" data-pet-id="${p.pet}" ${on ? "" : "disabled"} title="${esc(x.label)} · ${esc(sub)}${want ? " · son envie du jour : affection doublée" : ""}" aria-label="${esc(x.label)} (${esc(sub)})">
        <span class="pb-ico">${x.icon}</span><small>${esc(sub)}</small>${want && on ? `<i class="pb-badge wish" aria-hidden="true">💭</i>` : on ? `<i class="pb-badge" aria-hidden="true"></i>` : ""}</button>`;
    };
    const xp = c ? (c.xpTo ? Math.max(0, Math.min(100, ((c.xp - c.xpFrom) / Math.max(1, c.xpTo - c.xpFrom)) * 100)) : 100) : 0;
    let status = "";
    if (t.away) status = t.away.duoOf ? `<span class="pb-pill away">🧭 En mission en duo · retour dans ${wait(t.away.left)}</span>` : t.back ? `<a class="pb-pill back" href="compagnons.html">🧭 De retour de mission : viens l'accueillir !</a>` : `<span class="pb-pill away">🧭 En mission (${esc(t.away.placeLabel || "")}) · retour dans ${wait(t.away.left)} · ne travaille pas</span>`;
    else if (c && c.mood) status = `<span class="pb-pill mood ${c.mood.done ? "done" : ""}" title="La combler : affection doublée et +30 XP">${c.mood.done ? "💖 Envie comblée" : `💭 Envie : <b>${esc(c.mood.label)}</b>`}</span>${t.wish && t.wish.kind === "walk" ? `<a class="pb-pill walk" href="jeux.html#promenade">🐾 L'emmener</a>` : ""}`;
    const sk = c && c.active;
    const skill = sk ? (c.level >= c.max
      ? `<button type="button" class="pb-skill ${t.skill ? "ready" : ""}" data-pet-skill-use="${p.pet}" ${t.skill ? "" : "disabled"} title="${esc(sk.desc)}"><span class="pb-ico">⚡</span><span><b>${esc(sk.label)}</b><small>${t.away ? "en mission" : sk.usedToday ? "demain" : "prête"}</small></span>${t.skill ? `<i class="pb-badge skill" aria-hidden="true">⚡</i>` : ""}</button>`
      : `<span class="pb-skill locked" title="${esc(sk.desc)}"><span class="pb-ico">🔒</span><span><b>${esc(sk.label)}</b><small>niveau ${sk.level}</small></span></span>`) : "";
    return `<div class="pb-head">
        ${c ? `<a class="pb-level" href="compagnons.html" title="${c.xpTo ? `${c.xp - c.xpFrom} / ${c.xpTo - c.xpFrom} XP` : "Niveau maximum"}"><b>Niv. ${c.level}</b><span class="pb-xp"><i style="width:${xp}%"></i></span></a>` : ""}
        <span class="pb-love" title="Affection ${p.love}/100"><span class="pb-xp love"><i style="width:${p.love}%"></i></span>💗 ${p.love}</span>
        ${status}
      </div>
      <div class="pb-acts">${gest("cuddle")}${gest("play")}${gest("treat")}${skill}<a class="pb-more" href="compagnons.html" title="Fiche, voie, équipement, missions">📋 Fiche</a></div>`;
  }

  function badge(wrap, n) {
    if (!wrap) return;
    let b = wrap.querySelector(".pb-todo");
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("i"); b.className = "pb-todo"; b.setAttribute("aria-hidden", "true"); wrap.appendChild(b); }
    b.textContent = n;
  }
  function homeFor(pet) {
    if (HOME[pet]) return document.getElementById(HOME[pet]);
    const h = HOSTS[pet];
    // Seulement sur la page de son jeu (« main .panel > .lead » existe partout).
    if (h && h[4] && currentPage() !== h[4]) return null;
    const host = h && document.querySelector(h[0]);
    if (!host) return null;
    let home = document.querySelector(`[data-pet-home="${pet}"]`);
    if (!home) {
      home = document.createElement("div");
      home.className = "dig-kennel pet-corner pet-home pet-home-v2";
      home.dataset.petHome = pet;
      host.insertAdjacentElement(h[1], home);
    }
    return home;
  }

  function render() {
    const enabled = state && state.enabled;
    const pets = enabled ? state.pets : [];
    for (const pet of [...Object.keys(AVATAR), ...Object.keys(HOSTS)]) {
      const p = pets.find((x) => x.pet === pet);
      const c = comp && comp.pets ? comp.pets.find((x) => x.pet === pet) : null;
      const home = homeFor(pet);
      if (!home) continue;
      if (HOSTS[pet]) {
        if (!p) { home.hidden = true; continue; }
        home.hidden = false;
        if (!home.querySelector(".dig-kennel-body")) home.innerHTML = `<span class="dig-kennel-dog-wrap pet-medal" aria-hidden="true"><span class="pet-corner-pic">${p.icon}</span></span><div class="dig-kennel-body"><div class="dig-kennel-title">${esc(HOSTS[pet][2])} <span class="pet-chip" data-pet-chip="${pet}"></span></div><div class="dig-kennel-text">${esc(HOSTS[pet][3])}</div></div>`;
      }
      home.classList.add("pet-home");
      const chip = document.querySelector(`[data-pet-chip="${pet}"]`);
      const acts = document.querySelector(`[data-pet-acts="${pet}"]`);
      const av = document.getElementById(AVATAR[pet]) || home.querySelector(".dig-kennel-dog-wrap");
      if (acts) { acts.hidden = true; acts.innerHTML = ""; }
      if (chip) { chip.hidden = !p; if (p) { chip.innerHTML = chipHtml(p, c); chip.title = chip.querySelector(".sr-only").textContent; } }
      if (av) { av.classList.toggle("pet-loved", !!p); if (p) av.style.setProperty("--love", p.love); }
      let bar = home.querySelector(":scope > .pet-bar");
      if (!p) { if (bar) bar.remove(); badge(av, 0); continue; }
      if (!bar) { bar = document.createElement("div"); bar.className = "pet-bar"; home.appendChild(bar); }
      bar.innerHTML = barHtml(p, c);
      home.classList.toggle("pet-away", !!(c && c.mission));
      badge(av, todo(p, c).count);
      // Jauge de fatigue : visible quand il travaille (data-working pose par jeux.js).
      const fat = document.querySelector(`[data-pet-fatigue="${pet}"]`);
      if (fat && p.rhythm) {
        const r = p.rhythm;
        fat.hidden = false;
        fat.classList.toggle("resting", r.resting);
        fat.innerHTML = `<span class="pet-fatigue-label">${r.resting ? `💤 Petite pause, reprend dans ${wait(r.nextChange)}` : `⚡ Fatigue ${r.fatigue} % · pause dans ${wait(r.nextChange)}`}</span><span class="pet-fatigue-bar" aria-hidden="true"><span style="width:${r.fatigue}%"></span></span>`;
        fat.title = `Il travaille ${r.workMinutes} min puis se repose ${r.restMinutes} min (pauses plus courtes quand il t'adore).`;
      } else if (fat) fat.hidden = true;
    }
  }

  const present = () => Object.values(HOME).some((id) => document.getElementById(id)) || Object.values(HOSTS).some(([sel, , , , page]) => (!page || currentPage() === page) && document.querySelector(sel));
  async function load() {
    if (!present() || !Session.isLoggedIn() || !API.pets) return;
    const [s, c] = await Promise.all([API.pets(Session.userId).catch(() => null), API.post("companions", { userId: Session.userId, action: "status" }).catch(() => null)]);
    state = s; comp = c && c.enabled ? c : null;
    render();
    // Delais qui s'ecoulent : on recharge chaque minute tant que la page est ouverte.
    if (!timer) timer = setInterval(() => { if (!document.hidden) load(); }, 60000);
  }

  // Petits coeurs qui s'envolent du bouton.
  function hearts(from) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = from.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const h = document.createElement("span");
      h.className = "pet-heart";
      h.textContent = ["❤️", "💕", "💖"][i % 3];
      h.style.left = `${r.left + r.width / 2 + (Math.random() * 40 - 20)}px`;
      h.style.top = `${r.top}px`;
      h.style.animationDelay = `${i * 60}ms`;
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 1400);
    }
  }

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-pet-act]");
    const sk = e.target.closest("[data-pet-skill-use]");
    if ((!b && !sk) || busy) return;
    busy = true;
    (b || sk).disabled = true;
    try {
      if (b) {
        const res = await API.pets(Session.userId, b.dataset.petAct, b.dataset.petId);
        state = res;
        hearts(b);
        const p = res.pets.find((x) => x.pet === res.pet);
        Toast.success(`${p.icon} ${esc(p.label)} ${res.gesture === "cuddle" ? HAPPY[p.pet] || "est ravi" : res.gesture === "play" ? `s'amuse comme ${p.fem ? "une folle" : "un fou"}` : "se régale"} ! +${res.gained} d'affection${res.moodHit ? " · c'était son envie du jour 💖" : ""}${res.petXp ? ` · +${res.petXp} XP` : ""}${res.souvenir ? ` · souvenir : ${res.souvenir.icon} ${esc(res.souvenir.label)}` : ""}${res.levelUp ? ` · niveau ${res.levelUp} !` : ""}`);
        if (res.gesture === "treat" && typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
      } else {
        const pet = sk.dataset.petSkillUse;
        const r = await API.post("companions", { userId: Session.userId, action: "active", pet });
        comp = r;
        Toast.success(`⚡ ${esc(r.activeUsed.label)} : ${r.activeUsed.items.map((i) => `+${i.n} ${esc(i.label)}`).join(", ") || "c'est fait"} !`);
        if (typeof Haptics !== "undefined") Haptics.buzz([20, 40, 20]);
        try { RELOAD[pet](); } catch (x) { /* la page se mettra a jour au prochain passage */ }
      }
    } catch (err) {
      Toast.error(ERR[err.code] || friendlyError(err));
      if (err.data && err.data.pets && b) state = err.data;
    }
    busy = false;
    load();
  });

  // Coffre-fort et salle interdite affichent leur zone apres coup : on reessaie.
  const start = () => { load(); setTimeout(() => { if (state) render(); else load(); }, 2500); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.PetLove = { load, render };
})();
