// Tendresse pour Milo et Moka (2026-10-25) : jauge d'affection et trois
// gestes (caresse, jeu, friandise) dans le chenil de Milo (fouille) et le
// coin de Moka (peche). Donnees : api/src/native/pets.js.
// Elements : [data-pet-chip="milo|moka"] (titre), [data-pet-acts] (actions), anneau sur l'avatar.

(function () {
  const esc = escHtml;
  const ERR = { pet_cooldown: "Encore un peu de patience avant le prochain geste.", daily_limit: "Plus de friandise aujourd'hui.", not_enough_dust: "Pas assez de poussières.", pets_closed: "La tendresse est en pause." };
  let state = null, timer = null;
  const wait = (s) => { const h = Math.floor(s / 3600), m = Math.ceil((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`; };

  // Affichage discret (2026-10-26) : une pastille dans le titre (details au
  // survol), un anneau d'affection autour de l'avatar, trois petits boutons
  // ronds avec les actions de l'animal.
  const AVATAR = { milo: "dig-kennel-dog-wrap", moka: "fish-cat-wrap" };
  function chipHtml(p) {
    const tip = `${p.label} : ${p.love}/100 d'affection (${p.mood.label}). ${p.love ? `${p.speedPct} % plus rapide, +${p.lootPct} % de poussières${p.giftChance ? `, ${Math.round(p.giftChance * 100)} % de chance d'un cadeau` : ""}.` : `Jusqu'à ${p.maxSpeedPct} % plus rapide et +${p.maxLootPct} % de poussières quand ${p.pet === "moka" ? "elle" : "il"} t'adore.`} Baisse de ${String(p.decayPerHour).replace(".", ",")} par heure.`;
    return `<span class="pet-chip-heart" aria-hidden="true">${p.love >= 80 ? "💖" : p.love >= 40 ? "❤️" : p.love > 0 ? "🩷" : "🤍"}</span>${p.love}${p.love ? `<small>+${p.speedPct} %</small>` : ""}<span class="sr-only">${esc(tip)}</span>`;
  }
  function actsHtml(p) {
    const g = p.gestures;
    const b = (k) => {
      const x = g[k];
      const off = k === "treat" ? x.left <= 0 || (state.stardust || 0) < x.price : x.wait > 0;
      const sub = k === "treat" ? (x.left > 0 ? `${x.price} ✨ · encore ${x.left}` : "plus de friandise aujourd'hui") : x.wait > 0 ? `dans ${wait(x.wait)}` : `+${x.gain} d'affection`;
      return `<button type="button" class="pet-act" data-pet-act="${k}" data-pet-id="${p.pet}" ${off ? "disabled" : ""} title="${esc(x.label)} · ${esc(sub)}" aria-label="${esc(x.label)} (${esc(sub)})">${x.icon}${!off ? '<i class="pet-ready"></i>' : ""}</button>`;
    };
    return `${b("cuddle")}${b("play")}${b("treat")}`;
  }

  function render() {
    const enabled = state && state.enabled;
    ["milo", "moka"].forEach((pet) => {
      const p = enabled ? state.pets.find((x) => x.pet === pet) : null;
      const chip = document.querySelector(`[data-pet-chip="${pet}"]`);
      const acts = document.querySelector(`[data-pet-acts="${pet}"]`);
      const av = document.getElementById(AVATAR[pet]);
      if (chip) { chip.hidden = !p; if (p) { chip.innerHTML = chipHtml(p); chip.title = chip.querySelector(".sr-only").textContent; } }
      if (acts) { acts.hidden = !p; if (p) acts.innerHTML = actsHtml(p); }
      if (av) { av.classList.toggle("pet-loved", !!p); if (p) av.style.setProperty("--love", p.love); }
      // Jauge de fatigue (2026-10-26) : visible quand il travaille (data-working pose par jeux.js).
      const fat = document.querySelector(`[data-pet-fatigue="${pet}"]`);
      if (fat && p && p.rhythm) {
        const r = p.rhythm;
        fat.hidden = false;
        fat.classList.toggle("resting", r.resting);
        fat.innerHTML = `<span class="pet-fatigue-label">${r.resting ? `💤 Petite pause, reprend dans ${wait(r.nextChange)}` : `⚡ Fatigue ${r.fatigue} % · pause dans ${wait(r.nextChange)}`}</span><span class="pet-fatigue-bar" aria-hidden="true"><span style="width:${r.fatigue}%"></span></span>`;
        fat.title = `Il travaille ${r.workMinutes} min puis se repose ${r.restMinutes} min (pauses plus courtes quand il t'adore).`;
      } else if (fat) fat.hidden = true;
    });
  }

  async function load() {
    if (!document.querySelector("[data-pet-acts]") || !Session.isLoggedIn() || !API.pets) return;
    try { state = await API.pets(Session.userId); } catch (e) { state = null; }
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
    if (!b) return;
    b.disabled = true;
    try {
      const res = await API.pets(Session.userId, b.dataset.petAct, b.dataset.petId);
      state = res;
      hearts(b);
      const p = res.pets.find((x) => x.pet === res.pet);
      Toast.success(`${p.icon} ${esc(p.label)} ${res.gesture === "cuddle" ? "ronronne de plaisir" : res.gesture === "play" ? "s'amuse comme un fou" : "se régale"} ! +${res.gained} d'affection`.replace("ronronne de plaisir", p.pet === "milo" ? "remue la queue" : "ronronne de plaisir"));
      render();
      if (res.gesture === "treat" && typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge();
    } catch (err) {
      b.disabled = false;
      Toast.error(ERR[err.code] || friendlyError(err));
      if (err.data && err.data.pets) { state = err.data; render(); }
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
  window.PetLove = { load, render };
})();
