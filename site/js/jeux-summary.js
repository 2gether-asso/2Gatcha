// Jeux (2026-10-11) : recapitulatif en haut de page, pour voir d'un coup
// d'oeil ce qui attend (energie, chien, jardin, expedition, peche,
// devinette) sans passer d'onglet en onglet. Un clic ouvre le bon onglet.
//
// Carte du monde (2026-10-20) : le meme recapitulatif pose sur un paysage
// (mer, port, montagne, champs, jungle...) : chaque jeu est un lieu, avec son
// etat en direct. Le joueur peut revenir a la liste de pastilles (choix garde
// sur l'appareil). Un clic sur un lieu passe par le bouton d'onglet (les
// verrous des debutants, StarterLocks, s'appliquent donc aussi).

(function () {
  if (typeof Session === "undefined" || !Session.isLoggedIn()) return;
  const settled = (p) => p.then((v) => v, () => null);
  const VIEW_KEY = "2gatcha_games_view";

  // Lieux de la carte : position en % du paysage (x, y), icone, nom.
  const PLACES = [
    { tab: "fish", x: 11, y: 70, icon: "&#127907;", name: "Pêche", where: "La crique" },
    { tab: "expedition", x: 27, y: 56, icon: "&#129517;", name: "Expédition", where: "Le port" },
    { tab: "guess", x: 43, y: 44, icon: "&#10067;", name: "Devine la carte", where: "La tente de la voyante" },
    { tab: "garden", x: 50, y: 80, icon: "&#127793;", name: "Jardin", where: "Les champs" },
    { tab: "bingo", x: 61, y: 46, icon: "&#127922;", name: "Bingo", where: "La salle des fêtes" },
    { tab: "vault", x: 71, y: 78, icon: "&#128274;", name: "Coffre-fort", where: "La banque" },
    { tab: "dig", x: 84, y: 48, icon: "&#9935;&#65039;", name: "Fouille", where: "La mine" },
    { tab: "dino", x: 92, y: 80, icon: "&#129430;", name: "Dinos", where: "La jungle" }
  ];

  // Paysage dessine (aucun fichier a charger), 1000 x 360.
  const SCENE = `<svg class="wm-scene" viewBox="0 0 1000 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="wm-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="1" stop-color="#4c3a8a"/></linearGradient>
      <linearGradient id="wm-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e7490"/><stop offset="1" stop-color="#0c4a6e"/></linearGradient>
      <linearGradient id="wm-land" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f7d4a"/><stop offset="1" stop-color="#14532d"/></linearGradient>
      <linearGradient id="wm-rock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#78716c"/><stop offset="1" stop-color="#44403c"/></linearGradient>
    </defs>
    <rect width="1000" height="360" fill="url(#wm-sky)"/>
    <g fill="#fff" opacity="0.7"><circle cx="80" cy="40" r="1.6"/><circle cx="210" cy="24" r="1.2"/><circle cx="360" cy="60" r="1.4"/><circle cx="520" cy="30" r="1.1"/><circle cx="640" cy="70" r="1.5"/><circle cx="470" cy="90" r="1"/><circle cx="160" cy="100" r="1.1"/></g>
    <circle cx="590" cy="64" r="22" fill="#fde68a" opacity="0.9"/>
    <path d="M640 220 L740 70 L800 150 L850 40 L930 140 L1000 90 L1000 240 Z" fill="url(#wm-rock)"/>
    <path d="M850 40 L872 74 L858 70 L846 82 L834 66 Z M740 70 L758 98 L742 94 L730 104 Z" fill="#f5f5f4" opacity="0.85"/>
    <path d="M0 210 C120 200 260 190 360 200 C520 214 640 196 760 214 C860 228 940 214 1000 220 L1000 360 L0 360 Z" fill="url(#wm-land)"/>
    <path d="M0 214 C80 212 170 218 250 236 C300 248 320 290 300 360 L0 360 Z" fill="url(#wm-sea)"/>
    <path d="M250 236 C300 248 322 292 302 360 L326 360 C344 296 322 246 262 230 Z" fill="#d6b77a"/>
    <g stroke="#7dd3fc" stroke-width="2" fill="none" opacity="0.5" stroke-linecap="round"><path d="M30 260 q12 -6 24 0 t24 0"/><path d="M120 300 q12 -6 24 0 t24 0"/><path d="M60 330 q12 -6 24 0 t24 0"/><path d="M190 270 q10 -5 20 0 t20 0"/></g>
    <g><rect x="232" y="246" width="70" height="7" fill="#7c4a1e"/><rect x="238" y="253" width="4" height="22" fill="#5b3714"/><rect x="292" y="253" width="4" height="22" fill="#5b3714"/></g>
    <g transform="translate(190 236)"><path d="M0 18 L50 18 L42 30 L8 30 Z" fill="#7c2d12"/><rect x="23" y="-14" width="3" height="32" fill="#e7e5e4"/><path d="M26 -12 L46 12 L26 12 Z" fill="#f8fafc"/></g>
    <g transform="translate(410 168)"><path d="M0 40 L32 0 L64 40 Z" fill="#7c3aed"/><path d="M32 0 L40 40 L24 40 Z" fill="#a78bfa"/><circle cx="32" cy="22" r="4" fill="#fde68a"/></g>
    <g transform="translate(580 176)"><rect x="0" y="12" width="70" height="34" fill="#be185d"/><path d="M-6 14 L35 -6 L76 14 Z" fill="#9d174d"/><g fill="#fde68a"><circle cx="12" cy="26" r="3"/><circle cx="26" cy="26" r="3"/><circle cx="44" cy="26" r="3"/><circle cx="58" cy="26" r="3"/></g><rect x="29" y="32" width="12" height="14" fill="#4a044e"/></g>
    <g transform="translate(450 268)"><g fill="#78350f"><rect x="0" y="0" width="38" height="16" rx="3"/><rect x="46" y="0" width="38" height="16" rx="3"/><rect x="92" y="0" width="38" height="16" rx="3"/><rect x="0" y="24" width="38" height="16" rx="3"/><rect x="46" y="24" width="38" height="16" rx="3"/><rect x="92" y="24" width="38" height="16" rx="3"/></g><g fill="#4ade80"><circle cx="10" cy="6" r="3"/><circle cx="26" cy="9" r="3"/><circle cx="58" cy="6" r="3"/><circle cx="104" cy="30" r="3"/><circle cx="120" cy="8" r="3"/><circle cx="70" cy="32" r="3"/></g></g>
    <g transform="translate(680 262)"><rect x="0" y="10" width="64" height="40" fill="#475569"/><path d="M-4 12 L32 -8 L68 12 Z" fill="#334155"/><g fill="#94a3b8"><rect x="8" y="18" width="6" height="26"/><rect x="22" y="18" width="6" height="26"/><rect x="36" y="18" width="6" height="26"/><rect x="50" y="18" width="6" height="26"/></g></g>
    <g transform="translate(818 196)"><path d="M0 34 L0 14 A18 18 0 0 1 36 14 L36 34 Z" fill="#1c1917"/><path d="M-4 34 L40 34" stroke="#a16207" stroke-width="4"/><path d="M4 34 L4 12 M32 34 L32 12 M2 12 L34 12" stroke="#a16207" stroke-width="3" fill="none"/></g>
    <g fill="#166534"><circle cx="900" cy="300" r="26"/><circle cx="940" cy="282" r="22"/><circle cx="968" cy="312" r="24"/><circle cx="870" cy="320" r="18"/></g>
    <g fill="#22c55e" opacity="0.55"><circle cx="908" cy="292" r="10"/><circle cx="950" cy="276" r="8"/></g>
  </svg>`;

  function sync(el) {
    // Lieux des jeux caches (pas encore debloques) : masques aussi.
    el.querySelectorAll(".wm-pin").forEach((pin) => {
      const btn = document.getElementById(`tab-${pin.dataset.wmTab}-btn`);
      pin.hidden = !btn || getComputedStyle(btn).display === "none";
      pin.classList.toggle("active", !!btn && btn.getAttribute("aria-selected") === "true");
      pin.setAttribute("aria-pressed", String(pin.classList.contains("active")));
    });
  }

  function build(hub) {
    hub.innerHTML = `
      <div class="wm-wrap">
      <div class="wm-map" id="games-map">
        <div class="wm-world">
        ${SCENE}
        ${PLACES.map((p) => `<button type="button" class="wm-pin" data-wm-tab="${p.tab}" style="--x:${p.x}%;--y:${p.y}%" aria-pressed="false">
          <span class="wm-ico" aria-hidden="true">${p.icon}</span>
          <span class="wm-name">${p.name}</span>
          <span class="wm-status" data-wm-status></span>
        </button>`).join("")}
        </div>
      </div>
      <button type="button" class="wm-toggle btn-ghost" data-wm-view="list" title="Afficher la liste plutôt que la carte">&#9776; Liste</button>
      <button type="button" class="wm-quick btn-ghost" data-quick-session title="Récolte, explorateur, pioche gratuite et récompenses, d'un coup">&#9889; Session rapide</button>
      </div>
      <div class="games-summary" id="games-summary" aria-label="Où en sont tes jeux"></div>
      <button type="button" class="wm-toggle-back btn-ghost" data-wm-view="map">&#128506;&#65039; Carte du monde</button>`;
    const map = hub.querySelector("#games-map");
    sync(map);
    // Mobile : panorama a faire glisser, centre sur le jeu ouvert.
    requestAnimationFrame(() => {
      const pin = map.querySelector(".wm-pin.active") || map.querySelector(".wm-pin:not([hidden])");
      if (pin && map.scrollWidth > map.clientWidth) map.scrollLeft = pin.offsetLeft - map.clientWidth / 2;
    });
    // Onglets affiches ou masques plus tard (deblocages, jeux.js).
    document.querySelectorAll('.tabs [role="tab"]').forEach((t) => new MutationObserver(() => sync(map)).observe(t, { attributes: true, attributeFilter: ["style", "aria-selected", "class"] }));
  }

  async function render() {
    const el = document.getElementById("games-summary");
    if (!el) return;
    const uid = Session.userId;
    const [dig, garden, fish, expe, guess, dogGift] = await Promise.all([
      settled(API.getDigStatus(uid)), settled(API.garden(uid)), settled(API.fishing(uid, "status")),
      settled(API.expedition(uid, "status")), settled(API.guessCard(uid, "status")), settled(API.dogGift(uid))
    ]);
    const chips = [];
    // Etat principal de chaque lieu de la carte (le premier signale l'emporte).
    const status = {};
    const chip = (tab, icon, text, hot) => {
      chips.push(`<button type="button" class="gs-chip ${hot ? "hot" : ""}" data-gs-tab="${tab}"><span aria-hidden="true">${icon}</span> ${text}</button>`);
      if (!status[tab] || (hot && !status[tab].hot)) status[tab] = { text, hot };
    };
    if (dig) {
      chip("dig", "&#9935;&#65039;", `Énergie ${dig.energy}/${dig.maxEnergy}`, dig.energy >= dig.maxEnergy);
      const left = dig.dogSecondsLeft || 0;
      if (left > 0) chip("dig", "&#128021;", `Milo : encore ${Math.ceil(left / 3600)} h`, false);
      else if (dig.bones > 0 && dig.bonesLeftToday !== 0) chip("dig", resIcon("bone"), `${dig.bones} os à donner`, true);
    }
    if (dogGift && dogGift.available) chips.push(`<button type="button" class="gs-chip hot" data-gs-dog="1"><span aria-hidden="true">&#128021;</span> Trouvaille de Milo</button>`);
    if (garden) {
      const empty = garden.plots.filter((p) => !p.planted).length;
      if (garden.readyCount) chip("garden", "&#127803;", `${garden.readyCount} parcelle${garden.readyCount > 1 ? "s" : ""} à récolter`, true);
      else if (empty) chip("garden", "&#127793;", `${empty} parcelle${empty > 1 ? "s" : ""} vide${empty > 1 ? "s" : ""}`, false);
      else status.garden = { text: "Ça pousse…", hot: false };
    }
    if (fish) chip("fish", "&#127907;", fish.energy == null ? `${fish.worms} vers` : `${fish.energy}/${fish.maxEnergy} &#9889; · ${fish.worms} vers`, fish.energy > 0 && fish.worms >= fish.cost);
    if (expe) {
      const ex = expe.expedition || {};
      if (ex.active && ex.ready) chip("expedition", "&#129517;", "Expédition rentrée", true);
      else if (ex.active) chip("expedition", "&#129517;", "Expédition en cours", false);
      else chip("expedition", "&#129517;", "Explorateur disponible", true);
    }
    if (guess && !guess.played) chip("guess", "&#10067;", "Devinette du jour", true);
    else if (guess) status.guess = { text: "Déjà jouée", hot: false };
    el.innerHTML = chips.join("");
    el.hidden = !chips.length;
    // Carte : etat de chaque lieu.
    document.querySelectorAll("#games-map .wm-pin").forEach((pin) => {
      const s = status[pin.dataset.wmTab];
      pin.querySelector("[data-wm-status]").innerHTML = s ? s.text : "";
      pin.classList.toggle("hot", !!(s && s.hot));
      const name = pin.querySelector(".wm-name").textContent;
      pin.setAttribute("aria-label", s ? `${name} : ${s.text.replace(/<[^>]+>/g, "").replace(/&#\d+;/g, "")}` : name);
    });
  }

  function setView(hub, view) {
    hub.dataset.view = view;
    try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* stockage indisponible */ }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const old = document.getElementById("games-summary");
    if (!old) return;
    // Conteneur commun carte + pastilles, a la place de l'ancienne rangee.
    const hub = document.createElement("div");
    hub.className = "games-hub";
    let view = "map";
    try { view = localStorage.getItem(VIEW_KEY) || "map"; } catch (e) { /* stockage indisponible */ }
    hub.dataset.view = view;
    old.replaceWith(hub);
    build(hub);
    hub.addEventListener("click", (e) => {
      const v = e.target.closest("[data-wm-view]");
      if (v) { setView(hub, v.dataset.wmView); return; }
      const pin = e.target.closest(".wm-pin");
      if (pin) { document.getElementById(`tab-${pin.dataset.wmTab}-btn`)?.click(); return; }
      const dog = e.target.closest("[data-gs-dog]");
      if (dog) {
        dog.disabled = true;
        API.dogGift(Session.userId, "claim").then((r) => { Toast.success(`&#128021; Milo t'a rapporté ${r.gift.label} !`); if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); render(); })
          .catch(() => { dog.disabled = false; Toast.error("Milo n'a rien trouvé pour l'instant."); });
        return;
      }
      const b = e.target.closest("[data-gs-tab]");
      if (b) document.getElementById(`tab-${b.dataset.gsTab}-btn`)?.click();
    });
    render();
    // A jour apres chaque action (les reponses invalident le cache de l'API).
    window.addEventListener("api:claimed", () => setTimeout(render, 500));
    setInterval(render, 60000);
  });
})();
