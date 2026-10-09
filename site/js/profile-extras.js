// Profil public plus vivant (profile.html, 2026-10-05) : decorations
// (titre, cadre, couleur), metiers, succes secrets, titres de collections et
// mur de messages. Donnees : res.extras (api/src/native/social.js).

(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let profileId = null;

  function stars(n) { return n ? ` <span class="skill-stars" title="Prestige ${n}">${"★".repeat(Math.min(n, 5))}${n > 5 ? "×" + n : ""}</span>` : ""; }

  window.renderProfileExtras = function (res) {
    const x = res && res.extras;
    if (!x) return;
    profileId = x.userId;
    const d = x.decor || {};
    const title = document.getElementById("profile-title");
    if (d.color) title.classList.add("decor-" + d.color);
    const avatar = document.getElementById("profile-avatar");
    if (d.frame && avatar) avatar.classList.add("decor-" + d.frame);
    // Rang de compte (valeur de la collection, 2026-10-07).
    if (x.rank) {
      const lvl = document.getElementById("profile-level-badge");
      let chip = document.getElementById("profile-rank-chip");
      if (!chip && lvl) { chip = document.createElement("span"); chip.id = "profile-rank-chip"; lvl.insertAdjacentElement("afterend", chip); }
      if (chip) { chip.className = "rank-chip rank-" + x.rank.key; chip.innerHTML = `${x.rank.icon} ${esc(x.rank.label)}`; chip.title = `Valeur de la collection : ${x.rank.value.toLocaleString("fr-FR")}${x.rank.next ? ` · prochain rang ${x.rank.next.label} à ${x.rank.next.min.toLocaleString("fr-FR")}` : ""}`; }
    }
    // Prestige du compte (2026-10-09).
    if (res.prestigeStars > 0) {
      const lvl = document.getElementById("profile-level-badge");
      let st = document.getElementById("profile-prestige");
      if (!st && lvl) { st = document.createElement("span"); st.id = "profile-prestige"; st.className = "header-prestige"; lvl.insertAdjacentElement("afterend", st); }
      if (st) { st.textContent = "★".repeat(Math.min(res.prestigeStars, 5)) + (res.prestigeStars > 5 ? " ×" + res.prestigeStars : ""); st.title = `Prestige du compte : ${res.prestigeStars} étoile${res.prestigeStars > 1 ? "s" : ""}`; }
    }
    const line = document.getElementById("profile-title-line");
    if (line) { line.textContent = d.title || ""; line.hidden = !d.title; }

    const box = document.getElementById("profile-extras");
    box.innerHTML = `
      <div class="profile-skills">
        <div class="profile-skill"><span aria-hidden="true">&#127907;</span> Pêche <strong>niv. ${x.skills.fishing.level}</strong>${stars(x.skills.fishing.prestige)}<small>${x.skills.fishing.caught} prise${x.skills.fishing.caught > 1 ? "s" : ""}</small></div>
        <div class="profile-skill"><span aria-hidden="true">&#9935;&#65039;</span> Fouille <strong>niv. ${x.skills.dig.level}</strong>${stars(x.skills.dig.prestige)}</div>
        ${x.skills.expedition ? `<div class="profile-skill"><span aria-hidden="true">&#129517;</span> Expédition <strong>niv. ${x.skills.expedition.level}</strong>${stars(x.skills.expedition.prestige)}</div>` : ""}
        ${x.skills.garden ? `<div class="profile-skill"><span aria-hidden="true">&#127793;</span> Jardin <strong>niv. ${x.skills.garden.level}</strong>${stars(x.skills.garden.prestige)}</div>` : ""}
        ${x.uniqueCount ? `<div class="profile-skill"><span aria-hidden="true">&#127808;</span> <strong>${x.uniqueCount}</strong> carte${x.uniqueCount > 1 ? "s" : ""} Unique</div>` : ""}
      </div>
      ${x.tiers && x.tiers.length ? `<div class="profile-block"><h3>&#127941; Maîtrises</h3><div class="profile-chips">${x.tiers.map((t) => `<span class="profile-chip tier-${t.level}" title="${esc(t.label)} : palier ${["I", "II", "III"][t.level - 1]}">${t.icon} ${esc(t.label)} <strong>${["I", "II", "III"][t.level - 1]}</strong></span>`).join("")}</div></div>` : ""}
      ${x.themes.length ? `<div class="profile-block"><h3>&#127912; Collections thématiques</h3><div class="profile-chips">${x.themes.map((t) => `<span class="profile-chip" title="${esc(t.label)}">${t.icon} ${esc(t.title)}</span>`).join("")}</div></div>` : ""}
      ${x.hidden.length ? `<div class="profile-block"><h3>&#128274; Succès secrets (${x.hidden.length})</h3><div class="profile-chips">${x.hidden.map((h) => `<span class="profile-chip" title="${esc(h.desc)}">${h.icon} ${esc(h.label)}</span>`).join("")}</div></div>` : ""}`;
    loadWall();
    if (typeof window.renderOwnProgress === "function" && Session.isLoggedIn() && Number(Session.userId) === Number(x.userId)) window.renderOwnProgress();
  };

  async function loadWall() {
    const wall = document.getElementById("profile-wall");
    if (!wall || !profileId) return;
    wall.hidden = false;
    const form = document.getElementById("wall-form");
    form.hidden = !Session.isLoggedIn();
    try { renderWall((await API.getProfileWall(profileId)).messages); } catch (e) { /* facultatif */ }
  }

  function renderWall(messages) {
    const mine = Session.isLoggedIn() ? String(Session.userId) : null;
    const owner = mine && String(profileId) === mine;
    document.getElementById("wall-list").innerHTML = messages.length ? messages.map((m) => `
      <li class="wall-msg">
        <span class="wall-avatar">${m.avatar ? `<img src="${m.avatar}" alt="" />` : esc(m.pseudo.slice(0, 1))}</span>
        <div class="wall-body">
          <div class="wall-head"><a href="profile.html?pseudo=${encodeURIComponent(m.pseudo)}">${esc(m.pseudo)}</a> <time>${new Date(m.at * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div>
          <p>${esc(m.text)}</p>
        </div>
        ${owner || (mine && String(m.authorId) === mine) ? `<button type="button" class="btn-ghost wall-del" data-wall-del="${m.id}" aria-label="Supprimer le message">&times;</button>` : ""}
      </li>`).join("") : `<li class="muted">Aucun message pour l'instant. Laisse le premier !</li>`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("wall-form");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("wall-input");
      const text = input.value.trim();
      if (!text) return;
      try {
        renderWall((await API.postProfileWall(Session.userId, profileId, text)).messages);
        input.value = "";
      } catch (err) {
        Toast.error({ slow_down: "Doucement : attends quelques secondes entre deux messages.", empty_message: "Message vide." }[err.code] || "Erreur. (" + err.message + ")");
      }
    });
    document.getElementById("wall-list")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-wall-del]");
      if (!btn) return;
      try { renderWall((await API.deleteProfileWall(Session.userId, Number(btn.dataset.wallDel))).messages); }
      catch (err) { Toast.error("Erreur. (" + err.message + ")"); }
    });
  });
})();
