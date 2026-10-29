// Jeux (2026-10-11) : recapitulatif en haut de page, pour voir d'un coup
// d'oeil ce qui attend (energie, chien, jardin, expedition, peche,
// devinette) sans passer d'onglet en onglet. Un clic ouvre le bon onglet.
//
// Carte du monde (2026-10-20) : le meme recapitulatif pose sur un paysage
// (mer, port, montagne, champs, jungle...) : chaque jeu est un lieu, avec son
// etat en direct. Le joueur peut revenir a la liste de pastilles (choix garde
// sur l'appareil). Un clic sur un lieu passe par le bouton d'onglet (les
// verrous des debutants, StarterLocks, s'appliquent donc aussi).
//
// Monde etendu (2026-10-29) : un seul panorama pour les jeux ET la
// communaute. A gauche la nature (jeux, dont le site archeologique au pied de
// la montagne), a droite le village (calendrier, boss, machines, marche...).
// La carte s'affiche aussi en haut de communaute.html (centree sur le
// village) ; un lieu de l'autre page y mene directement (page#onglet).
//
// Jour et nuit (2026-10-30) : le ciel suit l'heure du joueur (aube, jour,
// crepuscule, nuit), avec le soleil ou la lune sur leur course, les fenetres
// et les reverberes qui s'allument le soir et des lucioles la nuit. La
// clairiere aux lucioles (promenade) n'apparait que la nuit. Les lieux sont
// des reperes poses au-dessus de leur batiment (il reste visible dessous) et
// les boutons sont sortis de la carte (ils ne cachent plus de lieu).

(function () {
  if (typeof Session === "undefined" || !Session.isLoggedIn()) return;
  const settled = (p) => p.then((v) => v, () => null);
  const VIEW_KEY = "2gatcha_games_view";
  // Onglets de jeux caches par jeux.js (dinos, cage) : retenus pour la carte de la communaute.
  const HIDDEN_KEY = "2gatcha_wm_hidden";
  const PAGE = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const W = 1900, H = 360;

  // Lieux : page et ancre de l'onglet, point du batiment ou pointe le repere
  // (x, y dans le paysage de 1900 x 360), icone, nom.
  const GAMES = "jeux.html", TOWN = "communaute.html";
  const PLACES = [
    { tab: "fish", page: GAMES, hash: "peche", x: 96, y: 292, icon: "&#127907;", name: "Pêche", where: "La crique" },
    { tab: "expedition", page: GAMES, hash: "expedition", x: 214, y: 218, icon: "&#129517;", name: "Expédition", where: "Le port" },
    { tab: "walk", page: GAMES, hash: "promenade", x: 376, y: 296, icon: "&#128062;", name: "Promenade", where: "Le sentier" },
    { tab: "guess", page: GAMES, hash: "devine", x: 442, y: 166, icon: "&#10067;", name: "Devine la carte", where: "La tente de la voyante" },
    { tab: "garden", page: GAMES, hash: "jardin", x: 515, y: 264, icon: "&#127793;", name: "Jardin", where: "Les champs" },
    { tab: "bingo", page: GAMES, hash: "bingo", x: 615, y: 168, icon: "&#127922;", name: "Bingo", where: "La salle des fêtes" },
    { tab: "vault", page: GAMES, hash: "coffre-fort", x: 712, y: 254, icon: "&#128274;", name: "Cage de Pepper", where: "La banque" },
    { id: "glade", night: true, tab: "walk", page: GAMES, hash: "promenade", x: 806, y: 326, icon: "&#10024;", name: "Clairière", where: "La clairière aux lucioles (seulement la nuit)" },
    { tab: "dig", page: GAMES, hash: "fouille", x: 836, y: 192, icon: "&#9935;&#65039;", name: "Fouille", where: "La mine" },
    { tab: "dino", page: GAMES, hash: "dinos", x: 930, y: 262, icon: "&#129430;", name: "Dinos", where: "La jungle" },
    { tab: "archeo", page: GAMES, hash: "archeologie", x: 1022, y: 188, icon: "&#127994;", name: "Archéologie", where: "Les ruines" },
    { tab: "cook", page: GAMES, hash: "cuisine", x: 1128, y: 296, icon: "&#127858;", name: "Cuisine", where: "L'auberge" },
    { tab: "calendar", page: TOWN, hash: "calendrier", x: 1162, y: 146, icon: "&#128197;", name: "Calendrier", where: "La mairie" },
    { tab: "board", page: TOWN, hash: "affichage", x: 1212, y: 258, icon: "&#128204;", name: "Affichage", where: "Le panneau du village" },
    { tab: "boss", page: TOWN, hash: "boss", x: 1292, y: 138, icon: "&#128128;", name: "Boss", where: "Le donjon" },
    { tab: "together", page: TOWN, hash: "ensemble", x: 1364, y: 248, icon: "&#129309;", name: "Ensemble", where: "La place" },
    { tab: "teams", page: TOWN, hash: "equipes", x: 1440, y: 136, icon: "&#127987;&#65039;", name: "Équipes", where: "Le camp" },
    { tab: "machine", page: TOWN, hash: "machines", x: 1513, y: 226, icon: "&#9881;&#65039;", name: "Machines", where: "L'usine" },
    { tab: "skills", page: TOWN, hash: "metiers", x: 1586, y: 266, icon: "&#127942;", name: "Classements", where: "L'arène" },
    { tab: "market", page: TOWN, hash: "marche", x: 1661, y: 222, icon: "&#127761;", name: "Marché noir", where: "La ruelle" },
    { tab: "auctions", page: TOWN, hash: "encheres", x: 1743, y: 156, icon: "&#128296;", name: "Enchères", where: "La salle des ventes" },
    { tab: "chest", page: TOWN, hash: "coffre", x: 1836, y: 228, icon: "&#127873;", name: "Coffre de guilde", where: "La taverne" }
  ].map((p) => ({ ...p, id: p.id || p.tab }));
  const HOME = PAGE === TOWN ? TOWN : GAMES;

  // Moment de la journee (heure du joueur ; window.__WM_HOUR pour essayer).
  const hourNow = () => { const f = Number(window.__WM_HOUR); if (Number.isFinite(f) && window.__WM_HOUR != null) return f; const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
  const phaseOf = (h) => (h >= 21 || h < 6 ? "night" : h < 8 ? "dawn" : h >= 19 ? "dusk" : "day");
  const PHASE_LABEL = { night: "&#127769; Nuit", dawn: "&#127749; Aube", day: "&#9728;&#65039; Jour", dusk: "&#127751; Crépuscule" };

  // Fenetres et reverberes qui s'allument le soir (x, y, rayon).
  const LIGHTS = [[215, 250, 14], [442, 192, 16], [592, 202, 12], [606, 202, 10], [624, 202, 10], [638, 202, 12], [712, 292, 16], [836, 220, 18], [1144, 184, 12], [1180, 184, 12], [1162, 162, 10], [1276, 190, 10],
    [1490, 278, 10], [1536, 278, 10], [1680, 258, 18], [1730, 200, 14], [1814, 264, 12], [1852, 264, 12], [1118, 318, 12], [1146, 318, 12], [1240, 300, 20], [1430, 292, 20], [1612, 290, 20], [1770, 290, 20], [1022, 230, 10]];
  const ROAD_LAMPS = [[1240, 300], [1430, 292], [1612, 290], [1770, 290]];
  const FLIES = [[760, 300], [778, 318], [800, 292], [818, 322], [770, 336], [808, 340], [792, 306], [746, 326]];

  // Paysage dessine (aucun fichier a charger), 1900 x 360 : nature puis village.
  const SCENE = `<svg class="wm-scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="wm-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color: var(--wm-s1)"/><stop offset="1" style="stop-color: var(--wm-s2)"/></linearGradient>
      <linearGradient id="wm-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e7490"/><stop offset="1" stop-color="#0c4a6e"/></linearGradient>
      <linearGradient id="wm-land" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f9a5c"/><stop offset="1" stop-color="#166534"/></linearGradient>
      <linearGradient id="wm-rock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a817c"/><stop offset="1" stop-color="#4b4540"/></linearGradient>
      <radialGradient id="wm-lamp"><stop offset="0" stop-color="#fde68a" stop-opacity="0.95"/><stop offset="0.35" stop-color="#fbbf24" stop-opacity="0.45"/><stop offset="1" stop-color="#fbbf24" stop-opacity="0"/></radialGradient>
      <radialGradient id="wm-sunglow"><stop offset="0" stop-color="#fef3c7" stop-opacity="0.9"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></radialGradient>
      <radialGradient id="wm-fly"><stop offset="0" stop-color="#fef9c3"/><stop offset="0.4" stop-color="#bef264" stop-opacity="0.7"/><stop offset="1" stop-color="#bef264" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#wm-sky)"/>
    <g class="wm-stars" fill="#fff"><circle cx="80" cy="40" r="1.6"/><circle cx="210" cy="24" r="1.2"/><circle cx="360" cy="60" r="1.4"/><circle cx="520" cy="30" r="1.1"/><circle cx="640" cy="70" r="1.5"/><circle cx="470" cy="90" r="1"/><circle cx="160" cy="100" r="1.1"/><circle cx="760" cy="26" r="1.2"/><circle cx="960" cy="50" r="1"/><circle cx="1080" cy="34" r="1.3"/><circle cx="1290" cy="60" r="1.1"/><circle cx="1400" cy="28" r="1.5"/><circle cx="1560" cy="52" r="1.2"/><circle cx="1700" cy="30" r="1.4"/><circle cx="1760" cy="90" r="1"/><circle cx="1850" cy="44" r="1.2"/></g>
    <g class="wm-sun" data-wm-orb="sun"><circle r="46" fill="url(#wm-sunglow)"/><circle r="20" fill="#fde047"/></g>
    <g class="wm-moon" data-wm-orb="moon"><circle r="34" fill="url(#wm-sunglow)" opacity="0.35"/><circle r="17" fill="#e2e8f0"/><circle cx="6" cy="-4" r="15" style="fill: var(--wm-s1)" opacity="0.92"/></g>
    <g class="wm-clouds" fill="#fff"><g class="wm-cloud c1"><ellipse cx="300" cy="70" rx="46" ry="14"/><ellipse cx="330" cy="60" rx="28" ry="14"/></g><g class="wm-cloud c2"><ellipse cx="980" cy="56" rx="54" ry="15"/><ellipse cx="1010" cy="46" rx="30" ry="14"/></g><g class="wm-cloud c3"><ellipse cx="1560" cy="84" rx="44" ry="12"/><ellipse cx="1586" cy="76" rx="24" ry="11"/></g></g>
    <path d="M640 220 L740 70 L800 150 L850 40 L930 140 L1000 90 L1040 150 L1060 240 Z" fill="url(#wm-rock)"/>
    <path d="M850 40 L872 74 L858 70 L846 82 L834 66 Z M740 70 L758 98 L742 94 L730 104 Z" fill="#f5f5f4" opacity="0.85"/>
    <path d="M1220 222 Q1292 112 1368 222 Z" fill="#52525b"/>
    <path d="M0 210 C120 200 260 190 360 200 C520 214 640 196 760 214 C860 228 940 214 1000 220 C1100 210 1200 224 1300 214 C1450 204 1600 222 ${W} 212 L${W} ${H} L0 ${H} Z" fill="url(#wm-land)"/>
    <path d="M0 214 C80 212 170 218 250 236 C300 248 320 290 300 360 L0 360 Z" fill="url(#wm-sea)"/>
    <path d="M250 236 C300 248 322 292 302 360 L326 360 C344 296 322 246 262 230 Z" fill="#d6b77a"/>
    <g class="wm-waves" stroke="#7dd3fc" stroke-width="2" fill="none" opacity="0.5" stroke-linecap="round"><path d="M30 260 q12 -6 24 0 t24 0"/><path d="M120 316 q12 -6 24 0 t24 0"/><path d="M40 340 q12 -6 24 0 t24 0"/><path d="M190 280 q10 -5 20 0 t20 0"/></g>
    <g><rect x="232" y="246" width="70" height="7" fill="#7c4a1e"/><rect x="238" y="253" width="4" height="22" fill="#5b3714"/><rect x="292" y="253" width="4" height="22" fill="#5b3714"/></g>
    <g transform="translate(190 236)"><path d="M0 18 L50 18 L42 30 L8 30 Z" fill="#7c2d12"/><rect x="23" y="-14" width="3" height="32" fill="#e7e5e4"/><path d="M26 -12 L46 12 L26 12 Z" fill="#f8fafc"/><circle cx="12" cy="14" r="2.5" fill="#fde68a"/></g>
    <g transform="translate(330 296)"><path d="M0 40 C30 26 60 30 92 12" stroke="#d6b77a" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.8"/><rect x="40" y="6" width="26" height="4" rx="1" fill="#92400e"/><rect x="42" y="10" width="3" height="9" fill="#78350f"/><rect x="61" y="10" width="3" height="9" fill="#78350f"/><rect x="10" y="-4" width="3" height="26" fill="#78350f"/><path d="M13 -2 L36 -2 L41 3 L36 8 L13 8 Z" fill="#a16207"/><text x="26" y="6" font-size="7" font-weight="700" text-anchor="middle" fill="#fef3c7">Balade</text></g>
    <g transform="translate(410 168)"><path d="M0 40 L32 0 L64 40 Z" fill="#7c3aed"/><path d="M32 0 L40 40 L24 40 Z" fill="#a78bfa"/><circle cx="32" cy="22" r="4" fill="#fde68a"/></g>
    <g transform="translate(580 176)"><rect x="0" y="12" width="70" height="34" fill="#be185d"/><path d="M-6 14 L35 -6 L76 14 Z" fill="#9d174d"/><g fill="#fde68a"><circle cx="12" cy="26" r="3"/><circle cx="26" cy="26" r="3"/><circle cx="44" cy="26" r="3"/><circle cx="58" cy="26" r="3"/></g><rect x="29" y="32" width="12" height="14" fill="#4a044e"/></g>
    <g transform="translate(450 268)"><g fill="#78350f"><rect x="0" y="0" width="38" height="16" rx="3"/><rect x="46" y="0" width="38" height="16" rx="3"/><rect x="92" y="0" width="38" height="16" rx="3"/><rect x="0" y="24" width="38" height="16" rx="3"/><rect x="46" y="24" width="38" height="16" rx="3"/><rect x="92" y="24" width="38" height="16" rx="3"/></g><g fill="#4ade80"><circle cx="10" cy="6" r="3"/><circle cx="26" cy="9" r="3"/><circle cx="58" cy="6" r="3"/><circle cx="104" cy="30" r="3"/><circle cx="120" cy="8" r="3"/><circle cx="70" cy="32" r="3"/></g></g>
    <g transform="translate(680 262)"><rect x="0" y="10" width="64" height="40" fill="#475569"/><path d="M-4 12 L32 -8 L68 12 Z" fill="#334155"/><g fill="#94a3b8"><rect x="8" y="18" width="6" height="26"/><rect x="22" y="18" width="6" height="26"/><rect x="36" y="18" width="6" height="26"/><rect x="50" y="18" width="6" height="26"/></g></g>
    <g fill="#14532d"><circle cx="748" cy="330" r="16"/><circle cx="832" cy="334" r="18"/><circle cx="790" cy="346" r="14"/></g>
    <g transform="translate(994 190)"><ellipse cx="26" cy="40" rx="40" ry="9" fill="#a16207" opacity="0.7"/><g fill="#d6d3d1"><rect x="0" y="8" width="9" height="32"/><rect x="20" y="2" width="9" height="38"/><rect x="40" y="18" width="9" height="22"/><rect x="-3" y="2" width="35" height="7"/></g><path d="M40 18 L44 12 L49 18 Z" fill="#d6d3d1"/><rect x="54" y="32" width="12" height="7" rx="2" fill="#e7e5e4" transform="rotate(-12 60 35)"/></g>
    <g transform="translate(818 196)"><path d="M0 34 L0 14 A18 18 0 0 1 36 14 L36 34 Z" fill="#1c1917"/><path d="M-4 34 L40 34" stroke="#a16207" stroke-width="4"/><path d="M4 34 L4 12 M32 34 L32 12 M2 12 L34 12" stroke="#a16207" stroke-width="3" fill="none"/></g>
    <g fill="#166534"><circle cx="900" cy="300" r="26"/><circle cx="940" cy="282" r="22"/><circle cx="968" cy="312" r="24"/><circle cx="870" cy="320" r="18"/></g>
    <g fill="#22c55e" opacity="0.55"><circle cx="908" cy="292" r="10"/><circle cx="950" cy="276" r="8"/></g>
    <g transform="translate(1092 296)"><rect x="0" y="14" width="66" height="38" fill="#9a3412"/><path d="M-6 16 L33 -6 L72 16 Z" fill="#7c2d12"/><rect x="50" y="-6" width="8" height="16" fill="#57534e"/><g class="wm-smoke" fill="#e7e5e4" opacity="0.55"><circle cx="54" cy="-12" r="5"/><circle cx="58" cy="-22" r="7"/></g><g fill="#fde68a"><rect x="8" y="22" width="12" height="10"/><rect x="46" y="22" width="12" height="10"/></g><rect x="27" y="30" width="12" height="22" fill="#451a03"/><rect x="66" y="20" width="14" height="2" fill="#78350f"/><circle cx="76" cy="27" r="5" fill="#57534e"/></g>
    <g transform="translate(100 0)">
    <path d="M890 334 C1050 316 1300 340 1450 312 C1580 290 1700 318 1800 300" stroke="#a8a29e" stroke-width="16" fill="none" opacity="0.35" stroke-linecap="round"/>
    <g transform="translate(966 246)"><rect x="0" y="0" width="4" height="40" fill="#78350f"/><path d="M4 4 L44 4 L52 11 L44 18 L4 18 Z" fill="#a16207"/><text x="26" y="15" font-size="9" font-weight="700" text-anchor="middle" fill="#fef3c7">Village</text></g>
    <g transform="translate(1032 150)"><rect x="0" y="20" width="60" height="44" fill="#a16207"/><path d="M-6 22 L30 0 L66 22 Z" fill="#78350f"/><circle cx="30" cy="12" r="5" fill="#fde68a"/><g fill="#fde68a"><rect x="8" y="30" width="9" height="10"/><rect x="43" y="30" width="9" height="10"/></g><rect x="24" y="44" width="12" height="20" fill="#451a03"/></g>
    <g transform="translate(1090 262)"><rect x="6" y="18" width="4" height="22" fill="#5b3714"/><rect x="34" y="18" width="4" height="22" fill="#5b3714"/><rect x="0" y="0" width="44" height="24" rx="2" fill="#92400e"/><g fill="#fef3c7"><rect x="5" y="4" width="12" height="9"/><rect x="21" y="6" width="10" height="12"/><rect x="34" y="4" width="6" height="7"/></g></g>
    <g transform="translate(1166 156)"><rect x="0" y="20" width="52" height="40" fill="#52525b"/><rect x="-8" y="8" width="14" height="52" fill="#3f3f46"/><rect x="46" y="8" width="14" height="52" fill="#3f3f46"/><g fill="#3f3f46"><rect x="-8" y="2" width="4" height="6"/><rect x="-1" y="2" width="4" height="6"/><rect x="46" y="2" width="4" height="6"/><rect x="53" y="2" width="4" height="6"/></g><path d="M18 60 L18 42 A8 8 0 0 1 34 42 L34 60 Z" fill="#18181b"/><rect x="25" y="-16" width="2" height="36" fill="#a1a1aa"/><path d="M27 -16 L42 -10 L27 -4 Z" fill="#dc2626"/><circle cx="10" cy="34" r="2.5" fill="#f87171"/></g>
    <g transform="translate(1238 252)"><ellipse cx="24" cy="22" rx="28" ry="9" fill="#64748b"/><ellipse cx="24" cy="20" rx="22" ry="6" fill="#38bdf8" opacity="0.8"/><rect x="21" y="2" width="6" height="18" fill="#94a3b8"/><g fill="#7dd3fc"><circle cx="16" cy="6" r="2"/><circle cx="32" cy="6" r="2"/><circle cx="24" cy="0" r="2"/></g></g>
    <g transform="translate(1306 148)"><g fill="#78716c"><rect x="0" y="0" width="3" height="64"/><rect x="26" y="-8" width="3" height="72"/><rect x="52" y="4" width="3" height="60"/></g><path d="M3 2 L22 8 L3 14 Z" fill="#ef4444"/><path d="M29 -6 L48 0 L29 6 Z" fill="#3b82f6"/><path d="M55 6 L74 12 L55 18 Z" fill="#22c55e"/></g>
    <g transform="translate(1380 250)"><rect x="0" y="14" width="66" height="42" fill="#57534e"/><rect x="8" y="-12" width="9" height="28" fill="#44403c"/><rect x="44" y="-20" width="9" height="36" fill="#44403c"/><g class="wm-smoke" fill="#a8a29e" opacity="0.5"><circle cx="12" cy="-20" r="6"/><circle cx="18" cy="-30" r="8"/><circle cx="50" cy="-30" r="7"/></g><circle cx="33" cy="34" r="10" fill="none" stroke="#f59e0b" stroke-width="4" stroke-dasharray="4 3"/><g fill="#fde68a"><rect x="6" y="24" width="8" height="8"/><rect x="52" y="24" width="8" height="8"/></g></g>
    <g transform="translate(1459 261) scale(0.8)"><ellipse cx="34" cy="44" rx="44" ry="14" fill="#b45309"/><ellipse cx="34" cy="40" rx="34" ry="9" fill="#d97706"/><rect x="12" y="20" width="14" height="20" fill="#e5e7eb"/><rect x="27" y="10" width="14" height="30" fill="#facc15"/><rect x="42" y="26" width="14" height="14" fill="#d97706" stroke="#92400e"/></g>
    <g transform="translate(1530 240)"><rect x="0" y="0" width="62" height="54" fill="#1e1b2e"/><path d="M-4 2 L31 -14 L66 2 Z" fill="#2e1065"/><circle cx="50" cy="18" r="3.5" fill="#c084fc"/><path d="M18 54 L18 30 A10 10 0 0 1 38 30 L38 54 Z" fill="#0b0a14"/><circle cx="28" cy="36" r="2" fill="#a855f7"/></g>
    <g transform="translate(1612 154)"><rect x="0" y="22" width="62" height="40" fill="#7c2d12"/><path d="M-6 24 L31 4 L68 24 Z" fill="#9a3412"/><g fill="#fed7aa"><rect x="6" y="28" width="5" height="34"/><rect x="20" y="28" width="5" height="34"/><rect x="37" y="28" width="5" height="34"/><rect x="51" y="28" width="5" height="34"/></g><rect x="27" y="10" width="8" height="5" fill="#fde68a"/></g>
    <g transform="translate(1702 236)"><rect x="0" y="14" width="62" height="42" fill="#854d0e"/><path d="M-6 16 L31 -4 L68 16 Z" fill="#713f12"/><g fill="#fde68a"><rect x="7" y="24" width="10" height="9"/><rect x="45" y="24" width="10" height="9"/></g><rect x="24" y="34" width="14" height="22" fill="#451a03"/><rect x="62" y="18" width="16" height="2" fill="#78350f"/><rect x="66" y="20" width="12" height="9" rx="2" fill="#ca8a04"/></g>
    <g fill="#166534"><circle cx="1350" cy="326" r="14"/><circle cx="1500" cy="336" r="18"/><circle cx="1790" cy="320" r="20"/></g>
    </g>
    <g fill="#3f3f46">${ROAD_LAMPS.map(([x, y]) => `<rect x="${x - 1.5}" y="${y - 2}" width="3" height="30"/><rect x="${x - 5}" y="${y - 8}" width="10" height="7" rx="2"/>`).join("")}</g>
    <g fill="#15803d"><circle cx="1010" cy="318" r="18"/><circle cx="1050" cy="300" r="14"/><circle cx="1074" cy="336" r="14"/></g>
    <rect class="wm-shade" width="${W}" height="${H}" fill="#0a1033"/>
    <g class="wm-lights">${LIGHTS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#wm-lamp)"/>`).join("")}</g>
    <g class="wm-flies">${FLIES.map(([x, y], i) => `<circle class="wm-fly" style="--d:${(i * 0.7).toFixed(1)}s" cx="${x}" cy="${y}" r="6" fill="url(#wm-fly)"/>`).join("")}</g>
  </svg>`;

  const placeUrl = (p) => `${p.page}#${p.hash}`;
  const tabBtn = (tab) => document.getElementById(`tab-${tab}-btn`);
  // Lieu visible ? Onglet masque par sa page (style en ligne), puis une sonde
  // au meme id, qui recoit les memes regles CSS (verrous, mode de jeu).
  function placeShown(p) {
    if (p.page === PAGE) {
      // Onglet range dans une autre rubrique (communaute, .cm-out) : le lieu reste.
      const b = tabBtn(p.tab);
      if (!b || b.style.display === "none") return false;
    } else if (p.page === GAMES) {
      try { if ((JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]") || []).includes(p.tab)) return false; } catch (e) { /* stockage indisponible */ }
      if (p.tab === "dino" || p.tab === "vault") { try { if (localStorage.getItem(HIDDEN_KEY) == null) return false; } catch (e) { return false; } }
    }
    const probe = document.createElement("button");
    probe.id = `tab-${p.tab}-btn`;
    probe.className = "tab";
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    const shown = getComputedStyle(probe).display !== "none";
    probe.remove();
    return shown;
  }

  function sync(el) {
    const night = el.dataset.phase === "night";
    // Lieux caches (pas encore debloques, fermes dans le mode, clairiere de jour) : masques aussi.
    el.querySelectorAll(".wm-pin").forEach((pin) => {
      const p = PLACES.find((x) => x.id === pin.dataset.wmId);
      pin.hidden = !placeShown(p) || (p.night && !night);
      const btn = p.page === PAGE ? tabBtn(p.tab) : null;
      pin.classList.toggle("active", !!btn && btn.getAttribute("aria-selected") === "true" && !p.night);
      pin.setAttribute("aria-pressed", String(pin.classList.contains("active")));
    });
    // Onglets de jeux masques par la page (dinos, cage) : retenus pour l'autre carte.
    if (PAGE === GAMES) {
      const hidden = PLACES.filter((p) => p.page === GAMES && !p.night && (!tabBtn(p.tab) || tabBtn(p.tab).style.display === "none")).map((p) => p.tab);
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden)); } catch (e) { /* stockage indisponible */ }
    }
  }

  // Ciel du moment : phase, soleil ou lune sur leur course (de l'est a l'ouest).
  function sky(map) {
    const h = hourNow();
    const phase = phaseOf(h);
    const changed = map.dataset.phase !== phase;
    map.dataset.phase = phase;
    const arc = (p) => [80 + p * (W - 160), 150 - Math.sin(Math.PI * p) * 112];
    const sun = h >= 6 && h <= 21 ? arc((h - 6) / 15) : null;
    const moonP = ((h - 20 + 24) % 24) / 11;
    const moon = moonP <= 1 ? arc(moonP) : null;
    const place = (sel, pos) => { const g = map.querySelector(sel); if (!g) return; g.style.display = pos ? "" : "none"; if (pos) g.setAttribute("transform", `translate(${pos[0].toFixed(0)} ${pos[1].toFixed(0)})`); };
    place('[data-wm-orb="sun"]', sun);
    place('[data-wm-orb="moon"]', moon);
    const clock = map.closest(".wm-wrap")?.querySelector("[data-wm-clock]");
    if (clock) clock.innerHTML = PHASE_LABEL[phase] + (phase === "night" ? " · la clairière est ouverte" : "");
    if (changed) sync(map);
  }

  function jump(map, where) {
    const world = map.querySelector(".wm-world");
    const x = where === TOWN ? (world.offsetWidth * 1100) / W - 40 : 0;
    map.scrollTo({ left: Math.max(0, x), behavior: "smooth" });
  }

  function build(hub) {
    const games = PAGE === GAMES;
    hub.innerHTML = `
      <div class="wm-wrap">
      <div class="wm-bar">
        <div class="wm-jumps" role="group" aria-label="Aller vers">
          <button type="button" class="btn-ghost" data-wm-jump="${GAMES}">&#127794; Nature</button>
          <button type="button" class="btn-ghost" data-wm-jump="${TOWN}">&#127960;&#65039; Village</button>
        </div>
        <span class="wm-clock" data-wm-clock aria-live="polite"></span>
        ${games ? `<span class="wm-bar-end"><button type="button" class="wm-quick btn-ghost" data-quick-session title="Récolte, explorateur, pioche gratuite et récompenses, d'un coup">&#9889; Session rapide</button>
        <button type="button" class="wm-toggle btn-ghost" data-wm-view="list" title="Afficher la liste plutôt que la carte">&#9776; Liste</button></span>` : ""}
      </div>
      <div class="wm-map" id="games-map">
        <div class="wm-world">
        ${SCENE}
        ${PLACES.map((p) => `<${p.page === PAGE ? "button type=\"button\"" : `a href="${placeUrl(p)}"`} class="wm-pin ${p.page === TOWN ? "wm-town" : ""} ${p.night ? "wm-night" : ""}" data-wm-id="${p.id}" data-wm-tab="${p.tab}" style="--x:${((100 * p.x) / W).toFixed(2)}%;--y:${((100 * p.y) / H).toFixed(2)}%" aria-pressed="false" title="${p.where}">
          <span class="wm-ico" aria-hidden="true">${p.icon}</span>
          <span class="wm-txt"><span class="wm-name">${p.name}</span>${p.night ? "" : "<span class=\"wm-status\" data-wm-status></span>"}</span><span class="wm-tail" aria-hidden="true"></span>
        </${p.page === PAGE ? "button" : "a"}>`).join("")}
        </div>
      </div>
      </div>
      ${games ? `<div class="games-summary" id="games-summary" aria-label="Où en sont tes jeux"></div>
      <button type="button" class="wm-toggle-back btn-ghost" data-wm-view="map">&#128506;&#65039; Carte du monde</button>` : ""}`;
    const map = hub.querySelector("#games-map");
    sky(map);
    sync(map);
    // Panorama a faire glisser, centre sur le lieu ouvert (ou le debut de la region de la page), sans animation.
    requestAnimationFrame(() => {
      map.style.scrollBehavior = "auto";
      const pin = map.querySelector(".wm-pin.active");
      if (pin && map.scrollWidth > map.clientWidth) map.scrollLeft = Math.max(0, pin.offsetLeft - map.clientWidth / 2);
      else if (HOME === TOWN) jump(map, TOWN);
      map.style.scrollBehavior = "";
    });
    // Onglets affiches ou masques plus tard (deblocages, jeux.js), verrous relus.
    document.querySelectorAll('.tabs [role="tab"]').forEach((t) => new MutationObserver(() => sync(map)).observe(t, { attributes: true, attributeFilter: ["style", "aria-selected", "class"] }));
    // Verrous du debutant poses (ou leves) apres l'affichage de la carte : la
    // feuille de style de StarterLocks arrive apres la lecture de l'API.
    document.addEventListener("starter:locks", () => sync(map));
    ["starter-locks-style", "mode-features-style"].forEach((id) => { const st = document.getElementById(id); if (st) new MutationObserver(() => sync(map)).observe(st, { childList: true, characterData: true, subtree: true }); });
    return map;
  }

  const setStatus = (status) => {
    document.querySelectorAll("#games-map .wm-pin").forEach((pin) => {
      if (!(pin.dataset.wmTab in status)) return;
      const s = status[pin.dataset.wmTab];
      const st = pin.querySelector("[data-wm-status]");
      if (st) st.innerHTML = s ? s.text : "";
      pin.classList.toggle("hot", !!(s && s.hot));
      const name = pin.querySelector(".wm-name").textContent;
      pin.setAttribute("aria-label", s ? `${name} : ${s.text.replace(/<[^>]+>/g, "").replace(/&#\d+;/g, "")}` : name);
    });
  };

  // Village : ce qui bouge (boss en cours, offres, carte a piocher), signaux de la communaute.
  async function renderTown() {
    if (typeof CommunauteSignals === "undefined") return;
    const sig = await CommunauteSignals.fetch().catch(() => null);
    if (!sig) return;
    setStatus({
      boss: sig.boss && sig.boss.active ? { text: "En cours", hot: true } : null,
      market: sig.market && sig.market.active ? { text: "Offres du jour", hot: true } : null,
      chest: sig.chest && sig.chest.sig ? { text: "Carte à piocher", hot: true } : null,
      calendar: CommunauteSignals.isUnseen("calendar", sig.calendar) ? { text: "Nouveautés", hot: true } : null
    });
  }

  async function render() {
    const el = document.getElementById("games-summary");
    if (!el) return;
    const uid = Session.userId;
    const [dig, garden, fish, expe, guess, dogGift, walk, cook] = await Promise.all([
      settled(API.getDigStatus(uid)), settled(API.garden(uid)), settled(API.fishing(uid, "status")),
      settled(API.expedition(uid, "status")), settled(API.guessCard(uid, "status")), settled(API.dogGift(uid)),
      API.walk ? settled(API.walk(uid)) : null, API.cook ? settled(API.cook(uid)) : null
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
      else if (dig.bones > 0 && dig.bonesLeftToday !== 0 && !(typeof StarterLocks !== "undefined" && StarterLocks.pets.milo === false)) chip("dig", resIcon("bone"), `${dig.bones} os à donner`, true);
    }
    if (dogGift && dogGift.available) chips.push(`<button type="button" class="gs-chip hot" data-gs-dog="1"><span aria-hidden="true">&#128021;</span> Trouvaille de Milo</button>`);
    if (garden) {
      const empty = garden.plots.filter((p) => !p.planted).length;
      const bunny = garden.bunny && garden.bunny.secondsLeft > 0;
      if (garden.readyCount && !bunny) chip("garden", "&#127803;", `${garden.readyCount} parcelle${garden.readyCount > 1 ? "s" : ""} à récolter`, true);
      else if (bunny) chip("garden", "&#128007;", PetText.mask(`Noisette : encore ${Math.ceil(garden.bunny.secondsLeft / 3600)} h`), false);
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
    if (walk && walk.enabled && walk.pets.length) {
      if (walk.left) chip("walk", "&#128062;", `${walk.left} balade${walk.left > 1 ? "s" : ""} à faire`, true);
      else status.walk = { text: "À demain !", hot: false };
    }
    if (cook && cook.enabled) {
      const on = cook.buffs.filter((b) => b.until).length;
      const can = cook.recipes.filter((r) => r.can).length;
      if (on) status.cook = { text: `${on} bonus actif${on > 1 ? "s" : ""}`, hot: false };
      if (can && !on) chip("cook", "&#127858;", `${can} plat${can > 1 ? "s" : ""} à cuisiner`, true);
    }
    el.innerHTML = chips.join("");
    el.hidden = !chips.length;
    // Carte : etat de chaque lieu.
    setStatus(Object.fromEntries(PLACES.filter((p) => p.page === GAMES).map((p) => [p.tab, status[p.tab] || null])));
  }

  function setView(hub, view) {
    hub.dataset.view = view;
    try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* stockage indisponible */ }
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Jeux : a la place de l'ancienne rangee de pastilles. Communaute : emplacement dedie.
    const old = document.getElementById("games-summary") || document.getElementById("world-map-slot");
    if (!old) return;
    const hub = document.createElement("div");
    hub.className = "games-hub" + (PAGE === TOWN ? " wm-on-town" : "");
    let view = "map";
    try { view = localStorage.getItem(VIEW_KEY) || "map"; } catch (e) { /* stockage indisponible */ }
    hub.dataset.view = PAGE === GAMES ? view : "map";
    old.replaceWith(hub);
    const map = build(hub);
    hub.addEventListener("click", (e) => {
      const v = e.target.closest("[data-wm-view]");
      if (v) { setView(hub, v.dataset.wmView); return; }
      const j = e.target.closest("[data-wm-jump]");
      if (j) { jump(map, j.dataset.wmJump); return; }
      const pin = e.target.closest("button.wm-pin");
      if (pin) { tabBtn(pin.dataset.wmTab)?.click(); return; }
      const dog = e.target.closest("[data-gs-dog]");
      if (dog) {
        dog.disabled = true;
        API.dogGift(Session.userId, "claim").then((r) => { Toast.success(`&#128021; Milo t'a rapporté ${r.gift.label} !`); if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); render(); })
          .catch(() => { dog.disabled = false; Toast.error("Milo n'a rien trouvé pour l'instant."); });
        return;
      }
      const b = e.target.closest("[data-gs-tab]");
      if (b) tabBtn(b.dataset.gsTab)?.click();
    });
    const refresh = () => { sky(map); render(); renderTown(); };
    refresh();
    // A jour apres chaque action (les reponses invalident le cache de l'API).
    window.addEventListener("api:claimed", () => setTimeout(refresh, 500));
    setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    // Retour sur l'onglet apres plus de 30 s : etat relu tout de suite (2026-10-21).
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => { if (document.hidden) { hiddenAt = Date.now(); return; } if (hiddenAt && Date.now() - hiddenAt > 30000) refresh(); });
  });
})();
