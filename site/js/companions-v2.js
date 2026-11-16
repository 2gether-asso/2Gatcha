// Page Compagnons (V2, 2026-11-16, api/src/native/companions.js) : fiches
// (niveau, affection, envie du jour, voie et competences, equipement,
// competence active), missions (seul ou en duo, le compagnon ne travaille pas
// dans son jeu pendant ce temps), album de souvenirs, amities et concours de
// la semaine, adoption des nouveaux compagnons.
(function () {
  if (typeof API === "undefined") return;
  const $ = (id) => document.getElementById(id);
  const esc = escHtml;
  const root = $("cp-root");
  if (!root) return;
  const TAB_KEY = "2gatcha_cp_tab";
  let pets = {}, data = null, busy = false, tab = "fiches", lastReport = null, visit = null;
  try { tab = localStorage.getItem(TAB_KEY) || "fiches"; } catch (e) { /* stockage indisponible */ }
  const fmtLeft = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, "0")}` : m ? `${m} min` : `${s % 60} s`; };
  const byPet = (k) => (data.pets || []).find((p) => p.pet === k);
  const nameOf = (k) => { const p = byPet(k); return p ? `${p.icon} ${esc(p.label)}` : esc(k); };
  const e_ = (p, m, f) => (p.fem ? f : m);

  async function call(body, okMsg) {
    if (busy) return null;
    busy = true;
    try {
      const r = await API.post("companions", { userId: Session.userId, ...body });
      data = r;
      if (okMsg) Toast.success(typeof okMsg === "function" ? okMsg(r) : okMsg);
      render();
      return r;
    } catch (e) {
      Toast.error(friendlyError(e));
      return null;
    } finally { busy = false; }
  }
  async function load() {
    if (!Session.isLoggedIn()) { root.innerHTML = `<div class="error-box">Connecte-toi pour retrouver tes compagnons.</div>`; return; }
    try {
      const [d, pv] = await Promise.all([API.post("companions", { userId: Session.userId, action: "status" }), API.post("pets", { userId: Session.userId, action: "status" }).catch(() => null)]);
      data = d;
      if (pv && pv.pets) pets = Object.fromEntries(pv.pets.map((x) => [x.pet, x]));
      render();
    }
    catch (e) { root.innerHTML = `<div class="error-box">${esc(friendlyError(e))}</div>`; }
  }

  // ---------------------------------------------------------------- fiches
  function bar(v, max, cls) { const pct = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 100; return `<span class="cp-bar ${cls || ""}"><i style="width:${pct}%"></i></span>`; }
  function fxText(fx) {
    if (!fx) return "";
    const bits = [];
    if (fx.speed) bits.push(`+${Math.round(fx.speed * 100)} % vitesse`);
    if (fx.loot) bits.push(`+${Math.round(fx.loot * 100)} % butin`);
    if (fx.gift) bits.push(`+${Math.round(fx.gift * 100)} % cadeaux`);
    if (fx.decay) bits.push(`affection ${Math.round(fx.decay * 100)} % plus durable`);
    if (fx.xp) bits.push(`+${Math.round(fx.xp * 100)} % XP`);
    return bits.join(" · ");
  }
  function moodHtml(p) {
    const m = p.mood;
    if (!m) return "";
    return `<div class="cp-mood ${m.done ? "done" : ""}" title="Comble son envie : affection doublée et +30 XP">${m.done ? "💖" : "💭"} Envie du jour : <b>${esc(m.label)}</b>${m.done ? " · comblée !" : ""}</div>`;
  }
  function missionBadge(p) {
    const m = p.mission;
    if (!m) return "";
    if (m.duoOf) return `<div class="cp-away">🧭 En mission avec ${nameOf(m.duoOf)} · retour dans <span data-left="${m.end}">${fmtLeft(m.left)}</span></div>`;
    return `<div class="cp-away ${m.ready ? "ready" : ""}">🧭 ${esc(m.placeLabel || "")} (${m.hours} h)${m.duo ? ` avec ${nameOf(m.duo)}` : ""} · ${m.ready ? "<b>de retour !</b>" : `retour dans <span data-left="${m.end}">${fmtLeft(m.left)}</span>`}</div>`;
  }
  function pathHtml(p) {
    if (p.level < p.pathAt && !p.path) return `<p class="cp-muted">Au niveau ${p.pathAt}, ${esc(p.label)} choisira une voie. Aperçu :</p>${p.paths.map((x) => `<div class="cp-path preview"><b>${x.icon} ${esc(x.label)}</b> <small>${esc(x.desc)}</small></div>`).join("")}`;
    if (!p.path) return `<p class="cp-hint">✨ ${esc(p.label)} est prêt${e_(p, "", "e")} à choisir sa voie (changeable plus tard contre ${fmtNum(data.respecDust)} ✨) :</p>
      <div class="cp-paths">${p.paths.map((x) => `<div class="cp-path"><b>${x.icon} ${esc(x.label)}</b><small>${esc(x.desc)}</small><ul>${x.skills.map((s) => `<li><span class="cp-lv">Niv. ${s.lvl}</span> ${s.active ? "⚡ " : ""}<b>${esc(s.label)}</b> : ${esc(s.desc)}</li>`).join("")}</ul><button type="button" class="btn" data-cp-path="${x.key}" data-pet="${p.pet}">Choisir ${esc(x.label)}</button></div>`).join("")}</div>`;
    const x = p.paths.find((y) => y.chosen);
    return `<div class="cp-path chosen"><b>${x.icon} Voie : ${esc(x.label)}</b><small>${esc(x.desc)}</small>
      <ul>${x.skills.map((s) => `<li class="${s.unlocked ? "on" : "off"}"><span class="cp-lv">Niv. ${s.lvl}</span> ${s.unlocked ? "✅" : "🔒"} ${s.active ? "⚡ " : ""}<b>${esc(s.label)}</b> : ${esc(s.desc)}</li>`).join("")}</ul>
      <button type="button" class="btn-ghost cp-respec" data-cp-respec="${p.pet}">Changer de voie (${fmtNum(data.respecDust)} ✨)</button></div>`;
  }
  function gearHtml(p) {
    const minsOk = data.forbidden;
    return `<div class="cp-gear">${p.gear.map((g) => `<div class="cp-slot t${g.tier}">
        <div class="cp-slot-head"><span class="cp-slot-ico">${g.icon}</span><div><b>${esc(g.label)}</b><small>${g.tier ? `${esc(g.name)} · palier ${g.tier}/3` : "rien pour l'instant"}</small></div></div>
        ${g.tier ? `<p class="cp-fx">${fxText(g.fx)}</p>` : ""}
        ${g.next ? `<details class="cp-next"><summary>${g.tier ? "Améliorer" : "Fabriquer"} : ${esc(g.next.name)}</summary><p class="cp-fx">${fxText(g.next.fx)}</p><ul>${g.next.need.map((n) => `<li class="${n.ok ? "ok" : "no"}">${esc(n.label)}</li>`).join("")}</ul><button type="button" class="btn${g.next.can ? "" : "-secondary"}" data-cp-gear="${g.slot}" data-pet="${p.pet}" ${g.next.can ? "" : "disabled"}>${g.tier ? "Améliorer" : "Fabriquer"}</button></details>` : `<p class="cp-fx">⭐ Meilleur palier</p>`}
        ${g.slot === "charm" && minsOk && g.tier ? `<div class="cp-gem">${p.gem ? `💎 Serti : <b>${esc(p.gem.name)}</b> (palier ${p.gem.tier}, +${p.gem.tier * 2} % butin, +${p.gem.tier * 3} % XP)` : "💎 Sertis une pierre de palier 3+ (consommée) : +2 % de butin et +3 % d'XP par palier."}${data.gems.length ? `<span class="cp-gem-pick"><select data-cp-gem-sel="${p.pet}" aria-label="Pierre à sertir">${data.gems.map((m) => `<option value="${m.key}">${esc(m.name)} (palier ${m.tier}, ×${m.n})</option>`).join("")}</select><button type="button" class="btn-ghost" data-cp-socket="${p.pet}">${p.gem ? "Remplacer" : "Sertir"}</button></span>` : `<small class="cp-muted">Aucune pierre de palier 3+ en réserve.</small>`}</div>` : ""}
      </div>`).join("")}</div>`;
  }
  // Gestes (route pets) : caresse, jeu, friandise.
  function gesturesHtml(p) {
    const v = pets[p.pet];
    if (!v || !v.gestures) return "";
    const g = v.gestures;
    const btn = (k) => {
      const x = g[k];
      const off = k === "treat" ? x.left <= 0 : x.wait > 0;
      const sub = k === "treat" ? (x.left > 0 ? `${x.price} ✨ · encore ${x.left}` : "plus aujourd'hui") : x.wait > 0 ? `dans ${fmtLeft(x.wait)}` : `+${x.gain} 💗`;
      const want = p.mood && !p.mood.done && p.mood.kind === k;
      return `<button type="button" class="cp-gest ${want ? "want" : ""}" data-cp-gesture="${k}" data-pet="${p.pet}" ${off ? "disabled" : ""}>${x.icon} ${esc(x.label)}<small>${esc(sub)}</small></button>`;
    };
    const walk = p.mood && !p.mood.done && p.mood.kind === "walk" ? `<a class="cp-gest want" href="jeux.html#promenade">🐾 Promenade<small>${esc(p.mood.placeLabel || "")}</small></a>` : "";
    return `<div class="cp-gests">${btn("cuddle")}${btn("play")}${btn("treat")}${walk}</div>`;
  }
  function petHtml(p) {
    const xpSpan = p.xpTo ? p.xpTo - p.xpFrom : 1, xpIn = p.xpTo ? p.xp - p.xpFrom : 1;
    const perks = p.perks;
    const chips = [perks.speedPct && `⚡ +${perks.speedPct} % vitesse`, perks.lootPct && `💰 +${perks.lootPct} % butin`, perks.giftPct && `🎁 +${perks.giftPct} % cadeaux`, perks.xpPct && `📈 +${perks.xpPct} % XP`, perks.restPct && `😴 pauses −${perks.restPct} %`, perks.decayPct && `💞 affection ${perks.decayPct} % plus durable`].filter(Boolean);
    return `<article class="cp-card ${p.mission ? "away" : ""}" data-pet="${p.pet}">
      <header class="cp-card-head">
        <span class="cp-ava" aria-hidden="true">${p.icon}</span>
        <div class="cp-id"><h3>${esc(p.label)} <span class="cp-level">Niv. ${p.level}${p.level >= p.max ? " ⭐" : ""}</span></h3>
          <div class="cp-xp" title="${fmtNum(p.xp)} XP">${bar(xpIn, xpSpan, "xp")}<small>${p.xpTo ? `${fmtNum(xpIn)} / ${fmtNum(xpSpan)} XP` : "Niveau maximum"}</small></div>
          <div class="cp-love" title="Affection">${bar(p.love, 100, "love")}<small>💗 ${p.love}/100</small></div></div>
      </header>
      ${missionBadge(p)}
      ${moodHtml(p)}
      ${gesturesHtml(p)}
      <p class="cp-does">${p.game.url ? `<a href="${p.game.url}">${esc(p.game.label)}</a>` : esc(p.game.label)} : ${esc(p.label)} ${esc(p.game.does)}.${p.mission ? " <b>En pause pendant la mission.</b>" : ""}</p>
      ${chips.length ? `<div class="cp-chips">${chips.map((c) => `<span>${c}</span>`).join("")}</div>` : ""}
      ${p.active ? `<div class="cp-active ${p.active.ready ? "ready" : ""}"><b>⚡ ${esc(p.active.label)}</b><small>${esc(p.active.desc)}</small>${p.level >= p.max ? `<button type="button" class="btn" data-cp-active="${p.pet}" ${p.active.ready && !p.mission ? "" : "disabled"}>${p.active.usedToday ? "Utilisée aujourd'hui" : "Utiliser"}</button>` : `<small class="cp-muted">Au niveau ${p.active.level}.</small>`}</div>` : ""}
      <details class="cp-more"><summary>Voie, compétences et équipement</summary>
        ${pathHtml(p)}
        <h4>Équipement</h4>${gearHtml(p)}
      </details>
    </article>`;
  }
  function adoptHtml() {
    if (!data.adopt.length) return "";
    return `<section class="cp-adopt"><h2>🥚 Nouveaux compagnons</h2><div class="cp-adopt-grid">${data.adopt.map((a) => `<div class="cp-quest ${a.progress >= a.need ? "ready" : ""}">
      <span class="cp-ava" aria-hidden="true">${a.icon}</span><div><b>${esc(a.label)}</b><p>${esc(a.text)}</p><p class="cp-muted">Une fois ${e_(a, "adopté", "adoptée")}, ${esc(a.label)} ${esc(a.does)}.</p>
      ${bar(a.progress, a.need, "xp")}<small>${a.progress} / ${a.need}</small>
      ${a.progress >= a.need ? `<button type="button" class="btn" data-cp-adopt="${a.pet}">Adopter ${esc(a.label)}</button>` : ""}</div></div>`).join("")}</div></section>`;
  }
  function fiches() {
    return `${adoptHtml()}<div class="cp-grid">${data.pets.map(petHtml).join("")}</div>
      ${data.log.length ? `<section class="cp-log"><h2>📓 Journal</h2><ul>${data.log.map((l) => `<li><span>${nameOf(l.pet).split(" ")[0]}</span> ${esc(l.text)}</li>`).join("")}</ul></section>` : ""}`;
  }

  // -------------------------------------------------------------- missions
  let form = { pet: "", duo: "", place: "", hours: 2 };
  function reportHtml(r) {
    if (!r) return "";
    const lu = Object.entries(r.levelUps || {}).map(([k, v]) => `${nameOf(k)} passe au niveau ${v} !`).join(" ");
    return `<div class="cp-report"><button type="button" class="cp-x" data-cp-close aria-label="Fermer">×</button>
      <h3>${r.placeIcon} Retour de mission : ${esc(r.placeLabel)} (${r.hours} h)</h3>
      <p class="cp-story">${esc(r.story)}</p>${r.event ? `<p class="cp-event">✨ ${esc(r.event)}</p>` : ""}
      <ul class="cp-loot">${r.items.map((it) => `<li>${it.img ? `<img src="assets/${encodeURI(it.img)}" alt="" />` : `<span>${it.icon}</span>`}<b>+${it.n}</b> ${esc(it.label)}</li>`).join("")}</ul>
      <p class="cp-muted">+${r.xp} XP${r.duo ? " chacun" : ""}${r.friendLevel != null ? ` · amitié niveau ${r.friendLevel}` : ""}${lu ? ` · ${lu}` : ""}</p>
      ${r.souvenir ? `<p class="cp-souv">${r.souvenir.icon} Souvenir : <b>${esc(r.souvenir.label)}</b>${r.souvenir.first ? " (nouveau !)" : ""}${r.souvenir.setDone ? ` · série complète : titre « ${esc(r.souvenir.setDone.title)} » et +${r.souvenir.setDone.dust} ✨` : ""}</p>` : ""}</div>`;
  }
  function missions() {
    const free = data.pets.filter((p) => !p.mission);
    const away = data.pets.filter((p) => p.mission && !p.mission.duoOf);
    if (!form.pet || !free.some((p) => p.pet === form.pet)) form.pet = free[0] ? free[0].pet : "";
    if (form.duo && (form.duo === form.pet || !free.some((p) => p.pet === form.duo))) form.duo = "";
    const lead = byPet(form.pet);
    const places = data.places;
    if (!form.place || !places.some((p) => p.key === form.place && p.open)) form.place = (places.find((p) => p.open) || {}).key || "";
    const canLong = lead && lead.level >= data.longAt;
    if (form.hours === 8 && !canLong) form.hours = 4;
    return `${reportHtml(lastReport)}
      <section class="cp-box"><h2>🧭 Partir en mission</h2>
      <p class="cp-muted">Le compagnon part 2, 4 ou 8 h dans un lieu du village et en rapporte un butin (meilleur dans son lieu préféré ❤️), de l'XP, des fragments d'équipement et parfois un souvenir ou un coffre. <b>Pendant la mission, il ne travaille pas dans son jeu</b> : sa session reprend à son retour, sans rien perdre. À deux, le butin est plus gros et leur amitié grandit.</p>
      ${free.length ? `<div class="cp-form">
        <label>Qui part ?<select id="cp-f-pet">${free.map((p) => `<option value="${p.pet}" ${p.pet === form.pet ? "selected" : ""}>${p.icon} ${esc(p.label)} (niv. ${p.level})</option>`).join("")}</select></label>
        <label>Avec (duo)<select id="cp-f-duo"><option value="">Seul${lead && lead.fem ? "e" : ""}</option>${free.filter((p) => p.pet !== form.pet).map((p) => `<option value="${p.pet}" ${p.pet === form.duo ? "selected" : ""}>${p.icon} ${esc(p.label)}</option>`).join("")}</select></label>
        <div class="cp-hours" role="radiogroup" aria-label="Durée">${data.hours.map((h) => `<button type="button" role="radio" aria-checked="${form.hours === h}" class="${form.hours === h ? "on" : ""}" data-cp-hours="${h}" ${h >= 8 && !canLong ? `disabled title="Niveau ${data.longAt} requis"` : ""}>${h} h</button>`).join("")}</div>
      </div>
      <div class="cp-places">${places.map((p) => `<button type="button" class="cp-place ${p.key === form.place ? "on" : ""}" data-cp-place="${p.key}" ${p.open ? "" : "disabled"}>
        <span>${p.icon}</span><b>${esc(p.label)}</b><small>${esc(p.desc)}</small>${p.fav.some((f) => f === form.pet || f === form.duo) ? `<em>❤️ lieu préféré</em>` : ""}${p.night && !p.open ? `<em>🌙 la nuit seulement</em>` : ""}</button>`).join("")}</div>
      <button type="button" class="btn cp-go" data-cp-go ${form.place ? "" : "disabled"}>Partir ${form.hours} h${form.duo ? " en duo" : ""}</button>` : `<p>Tous tes compagnons sont en vadrouille !</p>`}
      </section>
      ${away.length ? `<section class="cp-box"><h2>🗺️ En route</h2><ul class="cp-trips">${away.map((p) => `<li class="${p.mission.ready ? "ready" : ""}"><span>${p.icon}${p.mission.duo ? nameOf(p.mission.duo).split(" ")[0] : ""}</span><div><b>${esc(p.label)}${p.mission.duo ? ` et ${esc(byPet(p.mission.duo).label)}` : ""}</b><small>${esc(p.mission.placeLabel)} · ${p.mission.hours} h · ${p.mission.ready ? "de retour !" : `retour dans <span data-left="${p.mission.end}">${fmtLeft(p.mission.left)}</span>`}</small></div>
        ${p.mission.ready ? `<button type="button" class="btn" data-cp-claim="${p.pet}">Accueillir</button>` : `<button type="button" class="btn-ghost" data-cp-recall="${p.pet}" title="Il revient tout de suite, sans butin">Rappeler</button>`}</li>`).join("")}</ul></section>` : ""}`;
  }

  // ----------------------------------------------------------------- album
  function album() {
    const owned = data.souvenirs.reduce((n, s) => n + s.items.filter((i) => i.n).length, 0), total = data.souvenirs.reduce((n, s) => n + s.items.length, 0);
    return `<section class="cp-box"><h2>📔 Album de souvenirs <small>${owned}/${total}</small></h2>
      <p class="cp-muted">Les balades (25 %), les missions (plus elles sont longues, plus c'est probable) et les envies du jour comblées rapportent des souvenirs du lieu. Chaque série complète : un titre et ${data.souvSetDust} ✨. Les cinq lieux du village : le titre « Mémoire du village » et ${fmtNum(data.souvAllDust)} ✨.</p>
      <div class="cp-album">${data.souvenirs.map((s) => `<div class="cp-set ${s.done ? "done" : ""}"><h3>${esc(s.label)} <small>${s.done ? `🏅 ${esc(s.title)}` : `titre : ${esc(s.title)}`}</small></h3>
        <div class="cp-souvs">${s.items.map((i) => `<span class="cp-souv-item ${i.n ? "on" : ""}" title="${i.n ? esc(i.label) + (i.n > 1 ? ` (×${i.n})` : "") : "Pas encore trouvé"}"><i>${i.n ? i.icon : "?"}</i><small>${i.n ? esc(i.label) : "???"}</small></span>`).join("")}</div></div>`).join("")}</div></section>`;
  }

  // ------------------------------------------------------- amities, concours
  function social() {
    const c = data.contest;
    const hearts = (lv) => "💗".repeat(lv) + "🤍".repeat(5 - lv);
    return `<section class="cp-box"><h2>💞 Amitiés</h2><p class="cp-muted">Chaque mission en duo rapproche deux compagnons (+10 par heure). Chaque niveau d'amitié donne une chance de butin en plus ; dès le niveau 3, un « trésor du duo » peut tomber (boule Compagnons).</p>
      ${(() => {
        if (!data.friends.length) return "<p>Adopte au moins deux compagnons.</p>";
        const row = (f) => `<li><span>${nameOf(f.a)} & ${nameOf(f.b)}</span><b title="Niveau ${f.level}">${hearts(f.level)}</b><small>${f.next ? `${f.xp}/${f.next}` : "Inséparables"}</small></li>`;
        const sorted = [...data.friends].sort((a, b) => b.xp - a.xp);
        const met = sorted.filter((f) => f.xp > 0), rest = sorted.filter((f) => !f.xp);
        return `${met.length ? `<ul class="cp-friends">${met.map(row).join("")}</ul>` : `<p class="cp-muted">Aucun duo encore : envoie deux compagnons ensemble en mission.</p>`}${rest.length ? `<details class="cp-last"><summary>${rest.length} duo${rest.length > 1 ? "s" : ""} jamais formé${rest.length > 1 ? "s" : ""}</summary><ul class="cp-friends">${rest.map(row).join("")}</ul></details>` : ""}`;
      })()}</section>
      <section class="cp-box"><h2>🏆 Concours de la semaine</h2><p class="cp-muted">Le joueur dont les compagnons gagnent le plus d'XP dans la semaine (lundi → dimanche) remporte ${fmtNum(c.prizes[0])} ✨ et le titre « Ami des bêtes » ; ${c.prizes.slice(1, 3).map((n, i) => `${i + 2}e : ${fmtNum(n)} ✨`).join(", ")}, jusqu'au 10e : ${fmtNum(c.prizes[c.prizes.length - 1])} ✨. Ta semaine : <b>${fmtNum(c.me)} XP</b>.</p>
      ${c.board.length ? `<ol class="cp-board">${c.board.map((r) => `<li class="${r.userId === Number(Session.userId) ? "me" : ""}"><span>#${r.rank}</span><b>${esc(r.pseudo)}</b><small>${fmtNum(r.xp)} XP · ${r.pets} compagnon${r.pets > 1 ? "s" : ""}</small><button type="button" class="btn-ghost" data-cp-visit="${r.userId}">Rendre visite</button></li>`).join("")}</ol>` : "<p>Personne encore cette semaine : à toi de jouer !</p>"}
      ${c.last && c.last.winners && c.last.winners.length ? `<details class="cp-last"><summary>Semaine précédente</summary><ol>${c.last.winners.slice(0, 3).map((w) => `<li>${esc(w.pseudo)} · ${fmtNum(w.xp)} XP · +${fmtNum(w.dust)} ✨</li>`).join("")}</ol></details>` : ""}
      ${visit ? `<div class="cp-visit"><button type="button" class="cp-x" data-cp-close-visit aria-label="Fermer">×</button><h3>🏡 Les compagnons de ${esc(visit.pseudo)}</h3><div class="cp-visit-grid">${visit.pets.map((p) => `<div><span class="cp-ava">${p.icon}</span><b>${esc(p.label)}</b><small>Niv. ${p.level}${p.path ? ` · ${esc(p.path)}` : ""} · 💗 ${p.love}</small><small>${p.gear.map((g) => (g.tier ? `${g.icon} ${esc(g.name)}` : "")).filter(Boolean).join(" · ") || "Pas d'équipement"}</small></div>`).join("")}</div><p class="cp-muted">Souvenirs : ${visit.souvenirs}/${visit.souvTotal}</p></div>` : ""}
      </section>`;
  }

  function render() {
    if (!data) return;
    if (!data.enabled) { root.innerHTML = `<div class="error-box">Les compagnons font une pause.</div>`; return; }
    const away = data.pets.filter((p) => p.mission && !p.mission.duoOf && p.mission.ready).length;
    const tabs = [["fiches", "🐾 Fiches"], ["missions", `🧭 Missions${away ? ` <i class="cp-dot">${away}</i>` : ""}`], ["album", "📔 Souvenirs"], ["social", "💞 Amitiés & concours"]];
    root.innerHTML = `<div class="cp-top"><span>🧩 <b>${fmtNum(data.frags)}</b> fragments d'équipement</span><span>✨ <b>${fmtNum(data.stardust)}</b></span><span>${data.night ? "🌙 C'est la nuit" : "☀️ C'est le jour"}</span></div>
      <nav class="tabs tabs-scroll cp-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" class="tab ${tab === k ? "active" : ""}" role="tab" aria-selected="${tab === k}" data-cp-tab="${k}">${l}</button>`).join("")}</nav>
      <div class="cp-pane">${tab === "missions" ? missions() : tab === "album" ? album() : tab === "social" ? social() : fiches()}</div>`;
  }

  // Comptes a rebours.
  setInterval(() => {
    if (!data) return;
    const t = Date.now() / 1000;
    let done = false;
    document.querySelectorAll("#cp-root [data-left]").forEach((el) => { const left = Number(el.dataset.left) - t; if (left <= 0) done = true; el.textContent = fmtLeft(left); });
    if (done && !busy) load();
  }, 15000);

  root.addEventListener("change", (e) => {
    if (e.target.id === "cp-f-pet") { form.pet = e.target.value; render(); }
    if (e.target.id === "cp-f-duo") { form.duo = e.target.value; render(); }
  });
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("button, [data-cp-close]");
    if (!el) return;
    const d = el.dataset;
    if (d.cpGesture) {
      if (busy) return;
      busy = true;
      try {
        const r = await API.post("pets", { userId: Session.userId, action: d.cpGesture, pet: d.pet });
        Toast.success(`${r.moodHit ? "💖 C'était son envie du jour ! " : ""}+${r.gained} 💗${r.petXp ? ` · +${r.petXp} XP` : ""}${r.souvenir ? ` · souvenir : ${r.souvenir.icon} ${r.souvenir.label}` : ""}${r.levelUp ? ` · niveau ${r.levelUp} !` : ""}`);
      } catch (x) { Toast.error(friendlyError(x)); }
      busy = false;
      load();
      return;
    }
    if (d.cpTab) { tab = d.cpTab; try { localStorage.setItem(TAB_KEY, tab); } catch (x) { /* stockage indisponible */ } render(); return; }
    if (d.cpHours) { form.hours = Number(d.cpHours); render(); return; }
    if (d.cpPlace) { form.place = d.cpPlace; render(); return; }
    if ("cpClose" in d) { lastReport = null; render(); return; }
    if ("cpCloseVisit" in d) { visit = null; render(); return; }
    if ("cpGo" in d) { const r = await call({ action: "mission", pet: form.pet, duo: form.duo || undefined, place: form.place, hours: form.hours }, () => `🧭 ${byPet(form.pet).label}${form.duo ? ` et ${byPet(form.duo).label}` : ""} partent pour ${form.hours} h !`); if (r) { form.duo = ""; } return; }
    if (d.cpClaim) { const r = await call({ action: "claim", pet: d.cpClaim }); if (r && r.mission) { lastReport = r.mission; render(); if (typeof Haptics !== "undefined") Haptics.buzz([20, 40, 20]); } return; }
    if (d.cpRecall) { if (!confirm("Le rappeler maintenant ? Il revient sans butin et reprend son travail.")) return; await call({ action: "recall", pet: d.cpRecall }, "Il est de retour."); return; }
    if (d.cpPath) { await call({ action: "path", pet: d.pet, path: d.cpPath }, "Voie choisie !"); return; }
    if (d.cpRespec) { if (!confirm(`Changer de voie coûte ${fmtNum(data.respecDust)} poussières. Continuer ?`)) return; await call({ action: "respec", pet: d.cpRespec }, "Tu peux choisir une nouvelle voie."); return; }
    if (d.cpGear) { await call({ action: "gear", pet: d.pet, slot: d.cpGear }, (r) => `🛠️ ${r.crafted.name} !`); return; }
    if (d.cpActive) { await call({ action: "active", pet: d.cpActive }, (r) => `⚡ ${r.activeUsed.label} : ${r.activeUsed.items.map((i) => `+${i.n} ${i.label}`).join(", ") || "c'est fait"}`); return; }
    if (d.cpAdopt) { const r = await call({ action: "adopt", pet: d.cpAdopt }, (x) => `🎉 ${byPet(x.adopted).label} rejoint la famille !`); if (r && typeof UnlockFx !== "undefined" && UnlockFx.play) try { UnlockFx.play({ icon: byPet(r.adopted).icon, title: byPet(r.adopted).label }); } catch (x) { /* facultatif */ } return; }
    if (d.cpSocket) {
      const sel = root.querySelector(`[data-cp-gem-sel="${d.cpSocket}"]`);
      if (!sel || !sel.value) return;
      if (!confirm("La pierre est consommée (une nouvelle remplace l'ancienne). Sertir ?")) return;
      await call({ action: "socket", pet: d.cpSocket, mineral: sel.value }, (r) => `💎 ${r.socketed.mineral} serti !`);
      return;
    }
    if (d.cpVisit) {
      try { const r = await API.post("companions", { userId: Session.userId, action: "visit", targetId: Number(d.cpVisit) }); visit = r.visit; render(); } catch (x) { Toast.error(friendlyError(x)); }
    }
  });

  load();
})();
